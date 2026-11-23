// Launches the bundled kernel with a known fingerprint and reads the values back
// through CDP, to prove the spoofing flags actually take effect.
//   node scripts/verify-fingerprint.js [kernelPath]
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { Store } = require('../src/main/store');
const { Launcher } = require('../src/main/launcher');

const kernel = process.argv[2] || path.join(__dirname, '..', 'vendor', 'kernel', 'Chromium.app');

const getJson = (url, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.end();
  });

function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== 1) return;
      ws.close();
      if (msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
      else resolve(msg.result.result.value);
    };
    ws.onerror = (e) => reject(e.error || new Error('ws error'));
  });
}

const PROBE = `(async () => {
  // Colored fills + translucent text: noise is applied to these pixels.
  const c = document.createElement('canvas'); c.width = 300; c.height = 80;
  const x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '18px Arial';
  x.fillStyle = '#f60'; x.fillRect(10, 10, 100, 30);
  x.fillStyle = '#069'; x.fillText('fingerprint probe', 2, 15);
  x.fillStyle = 'rgba(102,204,0,0.7)'; x.fillText('fingerprint probe', 4, 17);
  const ac = new OfflineAudioContext(1, 44100, 44100); const osc = ac.createOscillator();
  osc.type = 'triangle'; osc.frequency.value = 10000; const comp = ac.createDynamicsCompressor();
  osc.connect(comp); comp.connect(ac.destination); osc.start(0);
  const ch = (await ac.startRendering()).getChannelData(0);
  let audio = 0; for (let i = 4500; i < 5000; i++) audio += Math.abs(ch[i]);
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const uad = navigator.userAgentData;
  const hi = uad ? await uad.getHighEntropyValues(['platformVersion']) : {};
  return {
    ua: navigator.userAgent,
    platform: navigator.platform,
    uadPlatform: uad && uad.platform,
    platformVersion: hi.platformVersion,
    brands: uad && uad.brands.map(b => b.brand + ' ' + b.version).join(', '),
    cores: navigator.hardwareConcurrency,
    languages: navigator.languages.join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webdriver: navigator.webdriver,
    canvasHash: [...c.toDataURL()].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0),
    audio,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
  };
})()`;

// navigator.userAgentData only exists in secure contexts; localhost qualifies.
let pageUrl;
function startPageServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>probe</title>');
    });
    srv.listen(0, '127.0.0.1', () => {
      pageUrl = `http://127.0.0.1:${srv.address().port}/`;
      resolve(srv);
    });
  });
}

async function probe(launcher, id) {
  const st = await launcher.start(id);
  try {
    const target = await getJson(`http://127.0.0.1:${st.debugPort}/json/new?${pageUrl}`, 'PUT');
    await new Promise((r) => setTimeout(r, 500));
    return await cdpEval(target.webSocketDebuggerUrl, PROBE);
  } finally {
    await launcher.stop(id);
  }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-fp-'));
  const pageServer = await startPageServer();
  try {
    const store = new Store(dir);
    const launcher = new Launcher(store, { bundledKernel: kernel });
    const base = { platform: 'windows', platformVersion: '15.0.0', brand: 'Chrome', brandVersion: '',
      hardwareConcurrency: 12, language: 'de-DE', timezone: 'Europe/Berlin', disableSpoofing: [] };
    const a = store.createProfile({ name: 'A', fingerprint: { ...base, seed: 1111 } });
    const b = store.createProfile({ name: 'B', fingerprint: { ...base, seed: 2222 } });

    const ra = await probe(launcher, a.id);
    console.log('Profile A:', ra);
    assert.match(ra.ua, /Windows NT 10\.0/);
    assert.strictEqual(ra.uadPlatform, 'Windows');
    assert.strictEqual(ra.cores, 12);
    assert.strictEqual(ra.timezone, 'Europe/Berlin');
    assert(ra.languages.startsWith('de-DE'));
    assert.strictEqual(ra.webdriver, false);

    const ra2 = await probe(launcher, a.id);
    assert.strictEqual(ra2.canvasHash, ra.canvasHash, 'same seed should give same canvas');
    const rb = await probe(launcher, b.id);
    assert.strictEqual(ra2.audio, ra.audio, 'same seed should give same audio');
    assert.notStrictEqual(rb.canvasHash, ra.canvasHash, 'different seed should change canvas');
    assert.notStrictEqual(rb.audio, ra.audio, 'different seed should change audio');
    console.log(`canvas: A=${ra.canvasHash} A(again)=${ra2.canvasHash} B=${rb.canvasHash}`);
    console.log(`audio:  A=${ra.audio} A(again)=${ra2.audio} B=${rb.audio}`);
    console.log('✓ fingerprint spoofing verified');
  } finally {
    pageServer.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  process.exit(0);
})().catch((e) => {
  console.error('✗', e.message || e);
  process.exit(1);
});
