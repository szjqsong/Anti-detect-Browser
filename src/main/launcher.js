// Starts/stops one kernel process per profile and tracks them.
const { spawn } = require('child_process');
const http = require('http');
const { EventEmitter } = require('events');
const { resolveExecutable, buildArgs, buildEnv } = require('./kernel');
const { normalizeProxy, startForwarder, lookupGeo, getFreePort } = require('./proxy');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function waitForDebugger(port, proc, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Kernel exited early (code ${proc.exitCode})`);
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('Timed out waiting for the browser DevTools endpoint');
}

class Launcher extends EventEmitter {
  /**
   * @param {Store} store
   * @param {object} [opts]
   * @param {string|null} [opts.bundledKernel] kernel shipped inside the app, used when
   *   no custom kernel path is configured
   */
  constructor(store, opts = {}) {
    super();
    this.store = store;
    this.bundledKernel = opts.bundledKernel || null;
    this.running = new Map(); // id -> { proc, forwarder, debugPort, wsEndpoint, geo }
    this.starting = new Set();
  }

  status(id) {
    if (this.starting.has(id)) return { state: 'starting' };
    const r = this.running.get(id);
    if (!r) return { state: 'stopped' };
    return { state: 'running', debugPort: r.debugPort, wsEndpoint: r.wsEndpoint, geo: r.geo };
  }

  allStatus() {
    const out = {};
    for (const p of this.store.listProfiles()) out[p.id] = this.status(p.id);
    return out;
  }

  _emit(id) {
    this.emit('status', id, this.status(id));
  }

  async start(id) {
    if (this.running.has(id)) return this.status(id);
    if (this.starting.has(id)) throw new Error('Profile is already starting');
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    this.starting.add(id);
    this._emit(id);
    let forwarder = null;
    try {
      const settings = this.store.getSettings();
      // No custom path -> bundled fingerprint-chromium (always fingerprint mode).
      const useBundled = !settings.kernelPath && this.bundledKernel;
      const exe = resolveExecutable(useBundled ? this.bundledKernel : settings.kernelPath);
      const kernelType = useBundled ? 'fingerprint-chromium' : settings.kernelType;
      const fp = profile.fingerprint || {};

      const upstream = normalizeProxy(profile.proxy);
      if (upstream) forwarder = await startForwarder(upstream);

      // Resolve "auto" timezone/language from the exit IP so they match the proxy.
      let geo = null;
      const needsGeo = fp.timezone === 'auto' || fp.language === 'auto';
      if (needsGeo) {
        try {
          geo = await lookupGeo(forwarder ? forwarder.url : null);
        } catch (err) {
          if (forwarder) throw new Error(`Proxy check failed: ${err.message}`);
          // Direct connection and geo lookup failed: fall back to system defaults.
        }
      }
      const timezone = fp.timezone === 'auto' ? geo?.timezone || null : fp.timezone || null;
      const language = fp.language === 'auto' ? geo?.language || null : fp.language || null;

      const debugPort = await getFreePort();
      const ctx = {
        kernelType,
        userDataDir: this.store.userDataDir(id),
        debugPort,
        proxyUrl: forwarder ? forwarder.url : null,
        timezone,
        language,
      };
      const proc = spawn(exe, buildArgs(profile, ctx), { env: buildEnv(ctx), stdio: 'ignore' });
      proc.on('error', () => {}); // surfaced via waitForDebugger / exit
      const entry = { proc, forwarder, debugPort, wsEndpoint: null, geo };

      proc.on('exit', () => {
        if (this.running.get(id) === entry) this.running.delete(id);
        if (forwarder) forwarder.close().catch(() => {});
        this._emit(id);
      });

      const version = await waitForDebugger(debugPort, proc);
      entry.wsEndpoint = version.webSocketDebuggerUrl;
      this.running.set(id, entry);
      this.starting.delete(id);
      this.store.updateProfile(id, { lastOpenedAt: new Date().toISOString() });
      return this.status(id);
    } catch (err) {
      if (forwarder) await forwarder.close().catch(() => {});
      throw err;
    } finally {
      this.starting.delete(id);
      this._emit(id);
    }
  }

  async stop(id) {
    const r = this.running.get(id);
    if (!r) return this.status(id);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        r.proc.kill('SIGKILL');
        resolve();
      }, 5000);
      r.proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      r.proc.kill('SIGTERM');
    });
    return this.status(id);
  }

  async stopAll() {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}

module.exports = { Launcher };
