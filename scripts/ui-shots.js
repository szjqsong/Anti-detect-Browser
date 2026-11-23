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
store.updateSettings({ apiPort: 54399 });
const demo = [
  { name: '美國店舖-01', group: 'Amazon US', notes: 'seller central', proxy: 'socks5://u:p@203.0.113.10:1080', fingerprint: { platform: 'macos' } },
  { name: '美國店舖-02', group: 'Amazon US', proxy: 'http://198.51.100.22:8000', fingerprint: { platform: 'macos' } },
  { name: '德國站', group: 'Amazon EU', notes: 'DE marketplace', proxy: '192.0.2.44:9000:user:pw', fingerprint: { platform: 'windows' } },
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
    const click = (text) =>
      js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().includes(${JSON.stringify(text)}))?.click()`);
    try {
      await sleep(800);
      await shot('1-profiles');
      await js(`document.querySelectorAll('tbody input[type=checkbox]')[0].click(); document.querySelectorAll('tbody input[type=checkbox]')[1].click();`);
      await shot('2-batch');
      await js(`document.querySelectorAll('tbody input[type=checkbox]')[0].click(); document.querySelectorAll('tbody input[type=checkbox]')[1].click();`);
      await click('新建環境');
      await sleep(400);
      await shot('3-drawer-basic');
      await click('指紋');
      await click('Windows');
      await shot('4-drawer-fingerprint-mismatch');
      await click('進階');
      await shot('5-drawer-advanced');
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
