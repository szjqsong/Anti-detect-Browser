// Diagnoses Cloudflare Turnstile failures by comparing launch configurations.
//   node scripts/turnstile-check.js [url] [--only name1,name2]
// Each case runs headed (Turnstile treats headless differently). A case passes when
// the page's hidden `cf-turnstile-response` input receives a token.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Store } = require('../src/main/store');
const { Launcher } = require('../src/main/launcher');
const { CdpConnection, waitForDebugger } = require('../src/main/cdp');
const { getFreePort } = require('../src/main/proxy');

const URL_ = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://nopecha.com/demo/turnstile';
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1].split(',') : null;
const KERNEL = path.join(__dirname, '..', 'vendor', 'kernel', 'Chromium.app');
const EXE = path.join(KERNEL, 'Contents', 'MacOS', 'Chromium');
const EXT = path.join(__dirname, '..', 'build', 'extensions');
const WAIT_MS = 25000;

// Reads the token without enabling any CDP domain on the page beforehand.
const READ = `(() => {
  const inputs = [...document.querySelectorAll('input[name="cf-turnstile-response"], input[name="g-recaptcha-response"]')];
  const text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
  // ippure.com-style status lines: "当前状态 X 服务端验证 Y"
  const status = [...text.matchAll(/当前状态\s*(\S+)\s*服务端验证\s*(\S+)/g)].map((m) => m[1] + '/' + m[2]);
  return { tokens: inputs.map((i) => (i.value || '').length), status, title: document.title };
})()`;

async function readTokens(wsEndpoint, url) {
  const conn = await CdpConnection.connect(wsEndpoint);
  try {
    const { targetInfos } = await conn.send('Target.getTargets');
    // Match by host: the page may redirect (e.g. /cloudflare.html -> /cloudflare).
    const host = new URL(url).host;
    const page = targetInfos.find((t) => t.type === 'page' && t.url.startsWith('http') && new URL(t.url).host === host);
    if (!page) return { error: 'page not found', urls: targetInfos.map((t) => t.url) };
    const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const r = await conn.send('Runtime.evaluate', { expression: READ, returnByValue: true }, sessionId);
    return r.result.value;
  } finally {
    conn.close();
  }
}

async function screenshot(wsEndpoint, file) {
  const conn = await CdpConnection.connect(wsEndpoint);
  try {
    const { targetInfos } = await conn.send('Target.getTargets');
    const host = new URL(URL_).host;
    const page = targetInfos.find((t) => t.type === 'page' && t.url.startsWith('http') && new URL(t.url).host === host)
      || targetInfos.find((t) => t.type === 'page' && t.url.startsWith('http'));
    const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const shot = await conn.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  } finally {
    conn.close();
  }
}

// Case A: bare kernel, only --fingerprint, no CDP until the very end.
async function rawCase(extraArgs, exe = EXE, shotName = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-ts-'));
  const port = await getFreePort();
  const proc = spawn(exe, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--no-first-run',
    '--no-default-browser-check', ...extraArgs, URL_], { stdio: 'ignore' });
  try {
    const v = await waitForDebugger(port, proc);
    await new Promise((r) => setTimeout(r, WAIT_MS));
    const res = await readTokens(v.webSocketDebuggerUrl, URL_);
    if (shotName && process.env.SHOT_DIR) await screenshot(v.webSocketDebuggerUrl, path.join(process.env.SHOT_DIR, `${shotName}.png`));
    return res;
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// Cases B+: through the real launcher (emulation agent, extension, etc).
let caseName = '';
async function launcherCase(fpPatch, settingsPatch = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-ts-'));
  const store = new Store(dir);
  store.updateSettings(settingsPatch);
  const launcher = new Launcher(store, { bundledKernel: KERNEL, extensionsDir: EXT });
  const p = store.createProfile({
    name: 'ts',
    startUrls: [URL_],
    fingerprint: { seed: 424242, platform: 'macos', platformVersion: '15.2.0', hardwareConcurrency: 8, ...fpPatch },
  });
  try {
    const st = await launcher.start(p.id);
    await new Promise((r) => setTimeout(r, WAIT_MS));
    const res = await readTokens(st.wsEndpoint, URL_);
    if (process.env.SHOT_DIR) await screenshot(st.wsEndpoint, path.join(process.env.SHOT_DIR, `${caseName}.png`)).catch(() => {});
    return res;
  } finally {
    await launcher.stop(p.id).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CASES = [
  ['Z-system-chrome', () => rawCase([], SYSTEM_CHROME, 'Z-system-chrome')],
  ['A0-raw-no-fp', () => rawCase([], EXE, 'A0-raw-no-fp')],
  ['A-raw-kernel', () => rawCase(['--fingerprint=424242', '--fingerprint-platform=macos'], EXE, 'A-raw-kernel')],
  // Bisect the kernel's own spoofing (same seed, one feature disabled at a time).
  ...['canvas', 'gpu', 'audio', 'font', 'clientrects', 'canvas,gpu,audio,font,clientrects'].map((d) => [
    `A-off-${d.includes(',') ? 'all' : d}`,
    () => rawCase(['--fingerprint=424242', '--fingerprint-platform=macos', `--disable-spoofing=${d}`], EXE, `A-off-${d.includes(',') ? 'all' : d}`),
  ]),
  ['A-brand-chrome', () => rawCase(['--fingerprint=424242', '--fingerprint-platform=macos', '--fingerprint-brand=Chrome'], EXE, 'A-brand-chrome')],
  ['B-launcher-default', () => launcherCase({})],
  ['C-no-search-ext', () => launcherCase({}, { defaultSearch: 'kernel' })],
  ['D-geo-block', () => launcherCase({ geolocation: { permission: 'block', source: 'auto' } })],
  ['E-custom-screen', () => launcherCase({ screen: { mode: 'custom', width: 1920, height: 1080, dpr: 1 } })],
  ['F-windows-on-mac', () => launcherCase({ platform: 'windows', platformVersion: '15.0.0' })],
  // Same launcher cases with canvas spoofing off
  ['B-canvas-off', () => launcherCase({ disableSpoofing: ['canvas'] })],
  ['E-canvas-off', () => launcherCase({ disableSpoofing: ['canvas'], screen: { mode: 'custom', width: 1920, height: 1080, dpr: 1 } })],
  // Split the custom-screen case: site isolation off alone (no CDP), and Windows on a real screen.
  ['G-noSI-raw', () => rawCase(['--fingerprint=424242', '--fingerprint-platform=macos', '--disable-spoofing=canvas',
    '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'], EXE, 'G-noSI-raw')],
  ['F-win-realscreen', () => launcherCase({ disableSpoofing: ['canvas'], platform: 'windows', platformVersion: '15.0.0', screen: { mode: 'real' } })],
  ['F-canvas-off', () => launcherCase({ disableSpoofing: ['canvas'], platform: 'windows', platformVersion: '15.0.0' })],
];

(async () => {
  console.log(`URL: ${URL_}\n`);
  for (const [name, run] of CASES) {
    if (ONLY && !ONLY.includes(name)) continue;
    try {
      caseName = name;
      const r = await run();
      const ok = (r.tokens && r.tokens.some((n) => n > 0)) || (r.status && r.status.length > 0 && r.status.every((x) => !/异常|失败|ERROR|FAIL/i.test(x)));
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`ERR   ${name.padEnd(20)} ${e.message}`);
    }
  }
  process.exit(0);
})();
