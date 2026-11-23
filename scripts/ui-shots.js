// Electron entry that seeds demo data in a temp dir and screenshots each UI page.
//   npx electron scripts/ui-shots.js <outDir>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const outDir = path.resolve(process.argv[process.argv.length - 1]);
fs.mkdirSync(outDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-ui-'));
app.setPath('userData', dataDir);

const { Store } = require('../src/main/store');
const store = new Store(dataDir);
store.updateSettings({ apiPort: 54399, language: process.env.UI_LANG || '' });
// Probe results mirroring the user's report: seeds 100001 and 300003 share an audio bucket.
const probe = (audioHash, extra = {}) => ({ audioHash, gpuRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', gpuVendor: 'Google Inc. (Apple)', deviceMemory: 16, ...extra });
const demo = [
  { name: '美國店舖-01', group: 'Amazon US', notes: 'seller central', proxy: 'socks5://u:p@203.0.113.10:1080', fingerprint: { platform: 'macos', seed: 100001, probe: probe('0fd9739f94cc41f5') } },
  { name: '美國店舖-02', group: 'Amazon US', proxy: 'http://198.51.100.22:8000', fingerprint: { platform: 'macos', seed: 200002, probe: probe('f76bc24abf063a8a') } },
  { name: '德國站', group: 'Amazon EU', notes: 'DE marketplace', proxy: '192.0.2.44:9000:user:pw', fingerprint: { platform: 'windows', seed: 300003, probe: probe('0fd9739f94cc41f5') } },
  { name: '日本站', group: 'Amazon EU', fingerprint: { platform: 'macos', seed: 6, probe: probe('ce2c0c6216ae4270', { audioNoNoise: true }) } },
  { name: '社群帳號 A', group: '社群', fingerprint: { platform: 'macos' } },
  { name: '測試環境', fingerprint: { platform: 'linux' } },
];
for (const d of demo) store.createProfile(d);
store.updateProfile(store.listProfiles()[0].id, { lastOpenedAt: new Date(Date.now() - 3600e3).toISOString() });

require('../src/main/index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  win.setSize(1320, 820);
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name) => {
      await sleep(500);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    };
    // Button labels are written in zh-TW here and translated with the UI's own dictionary.
    const lang = process.env.UI_LANG;
    const localeFile = lang && path.join(__dirname, '..', 'src', 'renderer', 'src', 'locales', `${lang}.js`);
    const dict = localeFile && fs.existsSync(localeFile)
      ? (0, eval)(fs.readFileSync(localeFile, 'utf8').replace(/^export default/m, '(').replace(/;\s*$/, '') + ')')
      : {};
    const click = (text) => {
      const label = dict[text] ?? text;
      // exact match first, then substring
      return js(`(() => { const bs = [...document.querySelectorAll('button')]; const l = ${JSON.stringify(label)};
        (bs.find(b => b.textContent.trim() === l) || bs.find(b => b.textContent.trim().includes(l)))?.click(); })()`);
    };
    try {
      await sleep(800);
      await shot('1-profiles');
      await js(`document.querySelectorAll('tbody input[type=checkbox]')[0].click(); document.querySelectorAll('tbody input[type=checkbox]')[1].click();`);
      await shot('2-batch');
      await js(`document.querySelectorAll('tbody input[type=checkbox]')[0].click(); document.querySelectorAll('tbody input[type=checkbox]')[1].click();`);
      await click('新建環境');
      await sleep(7000); // smart seed probes the kernel
      await shot('3a-drawer-new-smartseed');
      await shot('3-drawer-basic');
      await click('指紋');
      await click('Windows');
      await shot('4-drawer-fingerprint-mismatch');
      await click('進階');
      await shot('5-drawer-advanced');
      await click('裝置與硬體');
      await shot('5b-device');
      await click('自訂');
      await shot('5c-device-custom-screen');
      await click('檢測');
      await sleep(6000);
      await js(`document.querySelector('.drawer-main').closest('.drawer-body').scrollTop = 99999`);
      await shot('5d-device-probed');
      await click('取消');
      await click('分組管理');
      await shot('6-groups');
      await click('API 與自動化');
      await shot('7-api');
      await click('系統設定');
      await shot('8-settings');
    } catch (e) {
      console.error(e);
    }
    app.exit(0);
  });
});

app.on('quit', () => fs.rmSync(dataDir, { recursive: true, force: true }));
