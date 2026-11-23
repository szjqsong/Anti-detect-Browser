// Fingerprint audit: local consistency/tamper checks + public detection sites.
//   node scripts/audit-fingerprint.js [--platform windows|macos|linux] [--seed N] [--proxy URL]
//        [--disable canvas,audio,font,clientrects,gpu] [--sites creepjs,browserscan,pixelscan,browserleaks-webrtc] [--no-sites]
// Writes a JSON report and site screenshots to ./audit-output/<timestamp>/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Store } = require('../src/main/store');
const { Launcher } = require('../src/main/launcher');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const PLATFORM = opt('platform', 'windows');
const SEED = Number(opt('seed', 123456));
const PROXY = opt('proxy', '');
const WITH_SITES = !argv.includes('--no-sites');
const DISABLE = (opt('disable', '') || '').split(',').filter(Boolean); // e.g. canvas,audio
const ONLY_SITES = (opt('sites', '') || '').split(',').filter(Boolean); // e.g. pixelscan,creepjs
const KERNEL = path.join(__dirname, '..', 'vendor', 'kernel', 'Chromium.app');
const OUT = path.join(__dirname, '..', 'audit-output', new Date().toISOString().replace(/[:.]/g, '-'));

const SITES = [
  { name: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs/', wait: 25000 },
  { name: 'browserscan', url: 'https://www.browserscan.net/', wait: 20000 },
  { name: 'pixelscan', url: 'https://pixelscan.net/fingerprint-check', wait: 25000 },
  { name: 'browserleaks-webrtc', url: 'https://browserleaks.com/webrtc', wait: 12000 },
];

// ---------- CDP ----------
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

class Cdp {
  static open(wsUrl) {
    return new Promise((resolve, reject) => {
      const c = new Cdp();
      c.ws = new WebSocket(wsUrl);
      c.id = 0;
      c.pending = new Map();
      c.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        const p = c.pending.get(m.id);
        if (!p) return;
        c.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      };
      c.ws.onopen = () => resolve(c);
      c.ws.onerror = () => reject(new Error('CDP connect failed'));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

// ---------- probes (run inside the page) ----------
// Same probe body runs on the main thread, in an iframe and in a dedicated worker.
const PROBE_BODY = `
  const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const out = {
    ua: navigator.userAgent,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory,
    languages: (navigator.languages || []).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffset: new Date().getTimezoneOffset(),
  };
  if (navigator.userAgentData) {
    out.uaBrands = navigator.userAgentData.brands.map((b) => b.brand + '/' + b.version).join(', ');
    out.uaPlatform = navigator.userAgentData.platform;
    const hi = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'architecture', 'fullVersionList']);
    out.uaPlatformVersion = hi.platformVersion;
    out.uaArch = hi.architecture;
  }
  try {
    const cv = new OffscreenCanvas(256, 64);
    const gl = cv.getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.glVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
    out.glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch (e) { out.glError = String(e); }
  try {
    const cv = new OffscreenCanvas(300, 80);
    const x = cv.getContext('2d');
    x.textBaseline = 'top'; x.font = '18px Arial';
    x.fillStyle = '#f60'; x.fillRect(10, 10, 100, 30);
    x.fillStyle = '#069'; x.fillText('audit probe', 2, 15);
    x.fillStyle = 'rgba(102,204,0,0.7)'; x.fillText('audit probe', 4, 17);
    const d = x.getImageData(0, 0, 300, 80).data;
    let s = 0; for (let i = 0; i < d.length; i++) s = (s * 31 + d[i]) | 0;
    out.canvas = s;
  } catch (e) { out.canvasError = String(e); }
  return out;
`;

const MAIN_EXTRAS = `(async () => {
  const probe = async () => { ${PROBE_BODY} };
  const main = await probe();

  // iframe
  const f = document.createElement('iframe');
  document.body.appendChild(f);
  const iframe = await f.contentWindow.eval('(async () => { ' + ${JSON.stringify(PROBE_BODY)} + ' })()');

  // dedicated worker
  const blob = new Blob(['onmessage = async () => { postMessage(await (async () => { ' + ${JSON.stringify(PROBE_BODY)} + ' })()); };'], { type: 'text/javascript' });
  const w = new Worker(URL.createObjectURL(blob));
  const worker = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage(0); setTimeout(() => res({ error: 'timeout' }), 5000); });

  // tamper checks: patched functions/getters must still look native
  const isNative = (fn) => typeof fn === 'function' && /\\{\\s*\\[native code\\]\\s*\\}\\s*$/.test(Function.prototype.toString.call(fn));
  const getter = (proto, k) => Object.getOwnPropertyDescriptor(proto, k)?.get;
  const tamper = {
    'Navigator.hardwareConcurrency': isNative(getter(Navigator.prototype, 'hardwareConcurrency')),
    'Navigator.userAgent': isNative(getter(Navigator.prototype, 'userAgent')),
    'Navigator.platform': isNative(getter(Navigator.prototype, 'platform')),
    'Navigator.languages': isNative(getter(Navigator.prototype, 'languages')),
    'Canvas.toDataURL': isNative(HTMLCanvasElement.prototype.toDataURL),
    'Canvas2D.getImageData': isNative(CanvasRenderingContext2D.prototype.getImageData),
    'WebGL.getParameter': isNative(WebGLRenderingContext.prototype.getParameter),
    'Element.getBoundingClientRect': isNative(Element.prototype.getBoundingClientRect),
    'Intl.DateTimeFormat': isNative(Intl.DateTimeFormat),
    'Function.toString': isNative(Function.prototype.toString),
    'navigator has no own props': Object.getOwnPropertyNames(navigator).length === 0,
  };

  // fonts: which OS's system fonts are present?
  const fontSets = {
    windows: ['Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'MS Gothic', 'Segoe UI Emoji'],
    macos: ['Helvetica Neue', 'Menlo', 'PingFang SC', 'Apple Color Emoji', 'Avenir', 'Geneva'],
    linux: ['DejaVu Sans', 'Liberation Sans', 'Ubuntu', 'Noto Sans', 'Cantarell'],
  };
  const span = document.createElement('span');
  span.textContent = 'mmmmmmmmmmlli1WQ@#';
  span.style.cssText = 'position:absolute;font-size:72px;visibility:hidden';
  document.body.appendChild(span);
  const width = (font) => { span.style.fontFamily = font; return span.getBoundingClientRect().width; };
  const base = { monospace: width('monospace'), serif: width('serif'), 'sans-serif': width('sans-serif') };
  const has = (f) => Object.keys(base).some((b) => width("'" + f + "'," + b) !== base[b]);
  const fonts = {};
  for (const [os, list] of Object.entries(fontSets)) fonts[os] = list.filter(has);

  const automation = {
    webdriver: navigator.webdriver,
    cdcProps: Object.keys(window).filter((k) => /^cdc_|^\\$cdc_|__playwright|__puppeteer/.test(k)),
    pluginsLength: navigator.plugins.length,
    windowChrome: typeof window.chrome,
  };

  return {
    main, iframe, worker, tamper, fonts, automation,
    screen: { w: screen.width, h: screen.height, avail: screen.availWidth + 'x' + screen.availHeight, dpr: devicePixelRatio, colorDepth: screen.colorDepth },
  };
})()`;

// ---------- helpers ----------
function pageServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((q, s) => {
      s.writeHead(200, { 'Content-Type': 'text/html' });
      s.end('<!doctype html><html><body></body></html>');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function openTab(debugPort, url) {
  const t = await getJson(`http://127.0.0.1:${debugPort}/json/new?${url}`, 'PUT');
  const cdp = await Cdp.open(t.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  return { cdp, targetId: t.id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELDS = ['ua', 'platform', 'cores', 'languages', 'timezone', 'uaPlatform', 'uaPlatformVersion', 'glVendor', 'glRenderer', 'canvas'];

function grade(local, profile, fp) {
  const checks = [];
  const add = (cat, name, pass, detail = '') => checks.push({ cat, name, pass, detail });
  const m = local.main;

  // 1. applied
  const expectUa = { windows: /Windows NT/, macos: /Macintosh/, linux: /X11; Linux/ }[fp.platform];
  add('1 生效', 'UA 系統', expectUa.test(m.ua), m.ua);
  add('1 生效', 'userAgentData.platform', m.uaPlatform === { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[fp.platform], m.uaPlatform);
  if (fp.platformVersion) add('1 生效', '系統版本 (UA-CH)', m.uaPlatformVersion === fp.platformVersion, m.uaPlatformVersion);
  add('1 生效', 'CPU 核心數', m.cores === fp.hardwareConcurrency, String(m.cores));
  if (profile.expectTimezone) add('1 生效', '時區', m.timezone === profile.expectTimezone, m.timezone);
  if (profile.expectLanguage) add('1 生效', '語言', m.languages.startsWith(profile.expectLanguage), m.languages);

  // 2. cross-context
  for (const ctx of ['iframe', 'worker']) {
    const other = local[ctx];
    const diffs = FIELDS.filter((k) => k in m && JSON.stringify(m[k]) !== JSON.stringify(other[k]));
    add('2 一致', `主頁面 vs ${ctx}`, diffs.length === 0, diffs.map((k) => `${k}: ${m[k]} ≠ ${other[k]}`).join('; '));
  }

  // 3. tamper
  for (const [k, v] of Object.entries(local.tamper)) add('3 無篡改', k, v);

  // 6. coherence
  // Any OS-exclusive font from another platform is a giveaway (e.g. Helvetica Neue on "Windows").
  const foreign = Object.entries(local.fonts).filter(([o]) => o !== fp.platform).flatMap(([, l]) => l);
  add('6 自洽', '沒有其他系統的專有字型', foreign.length === 0, `偵測到 ${JSON.stringify(local.fonts)}`);
  const gpuOk = {
    windows: /Direct3D|D3D11|ANGLE \((Intel|NVIDIA|AMD)/.test(m.glRenderer || ''),
    macos: /Apple|Metal|OpenGL Engine/.test(m.glRenderer || ''),
    linux: /Mesa|OpenGL|Vulkan|llvmpipe/.test(m.glRenderer || ''),
  }[fp.platform];
  add('6 自洽', 'GPU 與系統相符', gpuOk, m.glRenderer);
  if (profile.geo) add('6 自洽', '時區與 IP 所在地相符', m.timezone === profile.geo.timezone, `IP ${profile.geo.ip} → ${profile.geo.timezone}; 瀏覽器 ${m.timezone}`);
  const brandVer = (m.uaBrands || '').match(/Google Chrome\/(\d+)/)?.[1];
  const uaVer = m.ua.match(/Chrome\/(\d+)/)?.[1];
  add('6 自洽', 'UA 版本與 Client Hints 一致', brandVer === uaVer, `UA ${uaVer} / CH ${brandVer}`);

  // 7. automation
  add('7 無洩漏', 'navigator.webdriver = false', local.automation.webdriver === false, String(local.automation.webdriver));
  add('7 無洩漏', '無自動化全域變數', local.automation.cdcProps.length === 0, local.automation.cdcProps.join(','));
  return checks;
}

async function siteText(cdp) {
  return cdp.eval('document.body ? document.body.innerText : ""');
}

// ---------- main ----------
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-audit-'));
  const store = new Store(dir);
  const launcher = new Launcher(store, { bundledKernel: KERNEL });
  const srv = await pageServer();
  const localUrl = `http://127.0.0.1:${srv.address().port}/`;
  const report = { platform: PLATFORM, seed: SEED, proxy: PROXY ? '(set)' : 'direct', runs: [] };

  const fp = { seed: SEED, platform: PLATFORM, timezone: 'auto', language: 'auto', hardwareConcurrency: 8, brand: 'Chrome', brandVersion: '', disableSpoofing: DISABLE,
    platformVersion: { windows: '15.0.0', macos: '15.2.0', linux: '' }[PLATFORM] };
  const profile = store.createProfile({ name: 'audit', proxy: PROXY, fingerprint: fp, extraArgs: ['--window-size=1366,900'] });
  const other = store.createProfile({ name: 'audit-other', proxy: PROXY, fingerprint: { ...fp, seed: SEED + 1 } });

  const runLocal = async (id) => {
    const st = await launcher.start(id);
    const tab = await openTab(st.debugPort, localUrl);
    await sleep(800);
    const local = await tab.cdp.eval(MAIN_EXTRAS);
    return { st, tab, local };
  };

  // Run 1 (+ sites), run 2 (same seed, restart), run 3 (different seed)
  const r1 = await runLocal(profile.id);
  const geo = r1.st.geo;
  const checks = grade(r1.local, { geo, expectTimezone: geo?.timezone, expectLanguage: geo?.language }, profile.fingerprint);

  const sites = [];
  if (WITH_SITES) {
    for (const s of SITES.filter((x) => !ONLY_SITES.length || ONLY_SITES.includes(x.name))) {
      process.stdout.write(`  visiting ${s.name} ...\n`);
      try {
        const { cdp } = await openTab(r1.st.debugPort, s.url);
        await sleep(s.wait);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const png = path.join(OUT, `${s.name}.png`);
        fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
        const text = await siteText(cdp);
        fs.writeFileSync(path.join(OUT, `${s.name}.txt`), text);
        sites.push({ name: s.name, screenshot: png, chars: text.length });
        cdp.close();
      } catch (e) {
        sites.push({ name: s.name, error: e.message });
      }
    }
  }
  r1.tab.cdp.close();
  await launcher.stop(profile.id);

  const r2 = await runLocal(profile.id);
  r2.tab.cdp.close();
  await launcher.stop(profile.id);
  const r3 = await runLocal(other.id);
  r3.tab.cdp.close();
  await launcher.stop(other.id);

  const stableKeys = ['canvas', 'glRenderer', 'ua', 'cores'];
  const changed = (a, b) => stableKeys.filter((k) => a.main[k] !== b.main[k]);
  const c12 = changed(r1.local, r2.local);
  const c13 = changed(r1.local, r3.local);
  checks.push({ cat: '4 穩定', name: '同種子重開指紋不變', pass: c12.length === 0, detail: c12.join(',') || `canvas ${r1.local.main.canvas}` });
  checks.push({ cat: '5 唯一', name: '不同種子 Canvas 不同', pass: r1.local.main.canvas !== r3.local.main.canvas, detail: `${r1.local.main.canvas} vs ${r3.local.main.canvas}` });
  checks.push({ cat: '5 唯一', name: '不同種子 GPU 不同', pass: r1.local.main.glRenderer !== r3.local.main.glRenderer, detail: `${r1.local.main.glRenderer} vs ${r3.local.main.glRenderer}` });

  report.geo = geo;
  report.local = r1.local;
  report.checks = checks;
  report.sites = sites;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  // console summary
  let cat = '';
  for (const c of checks) {
    if (c.cat !== cat) console.log(`\n[${(cat = c.cat)}]`);
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log(`Report: ${OUT}`);

  srv.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exit(0);
})().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
