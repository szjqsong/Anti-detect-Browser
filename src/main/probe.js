// Headless probe: launches the kernel with a fingerprint and reads back the values the
// kernel derives from the seed (Audio noise bucket, WebGL GPU, deviceMemory, cores).
// These cannot be set directly on fingerprint-chromium 148, only observed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { CdpConnection, fetchJson, waitForDebugger } = require('./cdp');
const { getFreePort } = require('./proxy');

// Standard OfflineAudioContext fingerprint (oscillator -> compressor), hashed in-page.
const PROBE_JS = `(async () => {
  const ac = new OfflineAudioContext(1, 5000, 44100);
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000;
  const c = ac.createDynamicsCompressor();
  for (const [k, v] of [['threshold', -50], ['knee', 40], ['ratio', 12], ['attack', 0], ['release', 0.25]]) c[k].setValueAtTime(v, 0);
  o.connect(c); c.connect(ac.destination); o.start(0);
  const data = (await ac.startRendering()).getChannelData(0);
  const digest = await crypto.subtle.digest('SHA-256', data.buffer);
  const audioHash = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    audioHash,
    gpuVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
    gpuRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
})()`;

function fingerprintArgs(fp) {
  const a = [];
  if (!fp) return a;
  a.push(`--fingerprint=${fp.seed}`);
  if (fp.platform) a.push(`--fingerprint-platform=${fp.platform}`);
  if (fp.platformVersion) a.push(`--fingerprint-platform-version=${fp.platformVersion}`);
  if (fp.brand) a.push(`--fingerprint-brand=${fp.brand}`);
  if (fp.brandVersion) a.push(`--fingerprint-brand-version=${fp.brandVersion}`);
  if (fp.hardwareConcurrency) a.push(`--fingerprint-hardware-concurrency=${fp.hardwareConcurrency}`);
  const disabled = fp.disableSpoofing || [];
  if (disabled.length) a.push(`--disable-spoofing=${disabled.join(',')}`);
  return a;
}

let pageServer = null;
function getPageServer() {
  if (!pageServer) {
    pageServer = new Promise((resolve) => {
      const srv = http.createServer((q, s) => {
        s.writeHead(200, { 'Content-Type': 'text/html' });
        s.end('<!doctype html><title>probe</title>');
      });
      srv.unref();
      // 127.0.0.1 is a secure context, so deviceMemory / crypto.subtle are available.
      srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}/`));
    });
  }
  return pageServer;
}

/**
 * @param {string} exe kernel executable
 * @param {object|null} fp fingerprint (null = no spoofing, used for the baseline)
 */
async function probe(exe, fp, timeoutMs = 20000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-probe-'));
  const port = await getFreePort();
  const url = await getPageServer();
  const proc = spawn(
    exe,
    [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
      '--headless=new', '--no-first-run', '--no-default-browser-check', ...fingerprintArgs(fp), 'about:blank'],
    { stdio: 'ignore' }
  );
  proc.on('error', () => {});
  let conn;
  try {
    await waitForDebugger(port, proc, timeoutMs);
    const target = (await fetchJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page');
    conn = await CdpConnection.connect(target.webSocketDebuggerUrl);
    await conn.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 300));
    const r = await conn.send('Runtime.evaluate', { expression: PROBE_JS, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'probe failed');
    return r.result.value;
  } finally {
    if (conn) conn.close();
    await new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      proc.kill('SIGTERM');
    });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// Audio output with spoofing off = the machine's real audio fingerprint.
const baselineCache = new Map();
function audioBaseline(exe) {
  if (!baselineCache.has(exe)) {
    baselineCache.set(exe, probe(exe, null).then((r) => r.audioHash).catch((e) => {
      baselineCache.delete(exe);
      throw e;
    }));
  }
  return baselineCache.get(exe);
}

module.exports = { probe, audioBaseline, fingerprintArgs };
