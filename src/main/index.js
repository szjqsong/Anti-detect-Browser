// Electron entry: window, IPC bridge, local API lifecycle.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { Store } = require('./store');
const { Launcher } = require('./launcher');
const { createApiServer } = require('./api');
const { generateFingerprint, randomSeed, hostPlatform, withDefaults } = require('./fingerprint');
const { pickSeed, describe } = require('./seeds');
const { checkProxy } = require('./proxy');

let mainWindow = null;
let store;
let launcher;
let api;
let apiError = null;

// Kernel shipped with the app: <Resources>/kernel when packaged, vendor/kernel in dev.
function findBundledKernel() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'kernel')
    : path.join(__dirname, '..', '..', 'vendor', 'kernel');
  const appPath = path.join(dir, 'Chromium.app');
  if (!fs.existsSync(appPath)) return null;
  let version = '';
  try {
    version = fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim();
  } catch {}
  return { path: appPath, version };
}
const bundledKernel = findBundledKernel();
const extensionsDir = app.isPackaged
  ? path.join(process.resourcesPath, 'extensions')
  : path.join(__dirname, '..', '..', 'build', 'extensions');

async function restartApi() {
  if (api) await api.close();
  api = createApiServer({ store, launcher, prepareProfile });
  try {
    await api.listen(store.getSettings().apiPort);
    apiError = null;
  } catch (err) {
    apiError = err.message;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    title: 'Anti-detect Browser',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }
}

// Wraps handlers so errors reach the renderer as { ok:false, error } instead of
// Electron's noisy "Error invoking remote method" message.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// Audio-aware seed selection only makes sense on the fingerprint kernel.
function fpKernel() {
  const k = launcher.kernel();
  if (k.kernelType !== 'fingerprint-chromium') throw new Error('目前的核心不支援指紋偽裝');
  return k;
}

async function smartSeed(fp, excludeId) {
  const { exe, kernelId } = fpKernel();
  return pickSeed({ exe, kernelId, fp: withDefaults(fp), profiles: store.listProfiles(), excludeId });
}

// New profiles (UI or API) without an explicit seed get an audio-checked seed.
async function prepareProfile(input = {}) {
  const fp = { ...generateFingerprint(input.fingerprint?.platform), ...(input.fingerprint || {}) };
  if (input.fingerprint?.seed) return { ...input, fingerprint: fp };
  try {
    const { seed, probe } = await smartSeed(fp);
    return { ...input, fingerprint: { ...fp, seed, probe } };
  } catch (err) {
    console.warn('[prepareProfile] smart seed failed, using a random seed:', err.message);
    return { ...input, fingerprint: fp }; // no fingerprint kernel: plain random seed
  }
}

function registerIpc() {
  handle('profiles:list', () => ({ profiles: store.listProfiles(), status: launcher.allStatus() }));
  handle('profiles:create', async (input) => store.createProfile(await prepareProfile(input)));
  handle('profiles:update', (id, patch) => store.updateProfile(id, patch));
  handle('profiles:delete', async (id) => {
    await launcher.stop(id);
    return store.deleteProfile(id);
  });
  handle('profiles:start', (id) => launcher.start(id));
  handle('profiles:stop', (id) => launcher.stop(id));

  handle('fingerprint:generate', (platform) => generateFingerprint(platform));
  handle('fingerprint:seed', () => randomSeed());
  // Picks a seed for fp that adds audio noise and avoids audio buckets in use.
  handle('fingerprint:smartSeed', (fp, excludeId) => smartSeed(fp, excludeId));
  // Reads back the kernel-derived values (GPU, deviceMemory, audio bucket) for fp.
  handle('fingerprint:probe', (fp, excludeId) => {
    const { exe, kernelId } = fpKernel();
    return describe(exe, kernelId, withDefaults(fp), store.listProfiles(), excludeId);
  });
  handle('proxy:check', (proxy) => checkProxy(proxy));

  const settingsView = () => ({ ...store.getSettings(), apiError, bundledKernel, hostPlatform: hostPlatform(), systemLocale: app.getLocale() });
  handle('settings:get', () => settingsView());
  handle('settings:update', async (patch) => {
    const prevPort = store.getSettings().apiPort;
    const next = store.updateSettings(patch);
    if (next.apiPort !== prevPort) await restartApi();
    return settingsView();
  });
  handle('dialog:pickKernel', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select browser kernel',
      properties: process.platform === 'darwin' ? ['openFile', 'treatPackageAsDirectory'] : ['openFile'],
      filters: process.platform === 'darwin' ? [] : [{ name: 'Executable', extensions: ['exe', '*'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  launcher.on('status', (id, status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('profile:status', id, status);
  });
}

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  launcher = new Launcher(store, { bundledKernel: bundledKernel?.path, extensionsDir });
  registerIpc();
  await restartApi();
  createWindow();
  // Warm the kernel (and cache the no-noise audio baseline) so the first smart-seed
  // pick isn't a cold start from a compressed DMG.
  try {
    const k = launcher.kernel();
    if (k.kernelType === 'fingerprint-chromium') require('./probe').audioBaseline(k.exe).catch(() => {});
  } catch {}
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  await launcher.stopAll().catch(() => {});
  if (api) await api.close().catch(() => {});
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
