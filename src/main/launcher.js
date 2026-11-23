// Starts/stops one kernel process per profile and tracks them.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { resolveExecutable, buildArgs, buildEnv } = require('./kernel');
const { normalizeProxy, startForwarder, lookupGeo, getFreePort } = require('./proxy');
const { waitForDebugger } = require('./cdp');
const { startEmulation } = require('./emulation');
const { withDefaults } = require('./fingerprint');

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
    this.extensionsDir = opts.extensionsDir || null;
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

  /** Executable + type actually used to launch (bundled kernel when no custom path). */
  kernel() {
    const settings = this.store.getSettings();
    const useBundled = !settings.kernelPath && this.bundledKernel;
    return {
      exe: resolveExecutable(useBundled ? this.bundledKernel : settings.kernelPath),
      kernelType: useBundled ? 'fingerprint-chromium' : settings.kernelType,
      kernelId: useBundled ? `bundled:${this.bundledKernel}` : `custom:${settings.kernelPath}`,
    };
  }

  builtinExtensions() {
    const settings = this.store.getSettings();
    if (!this.extensionsDir || settings.defaultSearch === 'kernel') return [];
    const dir = require('path').join(this.extensionsDir, 'google-search');
    return require('fs').existsSync(dir) ? [dir] : [];
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
      const { exe, kernelType } = this.kernel();
      const fp = withDefaults(profile.fingerprint);

      const upstream = normalizeProxy(profile.proxy);
      if (upstream) forwarder = await startForwarder(upstream);

      // Resolve "auto" timezone/language from the exit IP so they match the proxy.
      let geo = null;
      const geoAuto = fp.geolocation.permission !== 'block' && fp.geolocation.source === 'auto';
      const needsGeo = fp.timezone === 'auto' || fp.language === 'auto' || geoAuto;
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

      // Geolocation is always overridden (unless blocked) so the OS location never leaks.
      let geolocation = null;
      if (fp.geolocation.permission !== 'block') {
        const g = fp.geolocation;
        const lat = g.source === 'custom' ? Number(g.latitude) : geo?.latitude;
        const lon = g.source === 'custom' ? Number(g.longitude) : geo?.longitude;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          geolocation = { latitude: lat, longitude: lon, accuracy: Number(g.accuracy) || 50 };
        }
      }
      const screen = fp.screen.mode === 'custom'
        ? { width: Number(fp.screen.width), height: Number(fp.screen.height), dpr: Number(fp.screen.dpr) || 1 }
        : null;

      const debugPort = await getFreePort();
      const ctx = {
        kernelType,
        userDataDir: this.store.userDataDir(id),
        debugPort,
        proxyUrl: forwarder ? forwarder.url : null,
        timezone,
        language,
        screen,
        extensions: this.builtinExtensions(),
      };
      const proc = spawn(exe, buildArgs({ ...profile, fingerprint: fp }, ctx), { env: buildEnv(ctx), stdio: 'ignore' });
      proc.on('error', () => {}); // surfaced via waitForDebugger / exit
      const entry = { proc, forwarder, debugPort, wsEndpoint: null, geo, emulation: null };

      proc.on('exit', () => {
        if (this.running.get(id) === entry) this.running.delete(id);
        if (entry.emulation) entry.emulation.close();
        if (forwarder) forwarder.close().catch(() => {});
        this._emit(id);
      });

      const version = await waitForDebugger(debugPort, proc);
      entry.wsEndpoint = version.webSocketDebuggerUrl;
      try {
        entry.emulation = await startEmulation(entry.wsEndpoint,
          { screen, geolocation, geoPermission: fp.geolocation.permission },
          profile.startUrls || []);
      } catch (err) {
        proc.kill('SIGKILL');
        throw new Error(`Failed to apply screen/geolocation overrides: ${err.message}`);
      }
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
