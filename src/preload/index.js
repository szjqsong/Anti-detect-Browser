const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

contextBridge.exposeInMainWorld('api', {
  listProfiles: () => call('profiles:list'),
  createProfile: (input) => call('profiles:create', input),
  updateProfile: (id, patch) => call('profiles:update', id, patch),
  deleteProfile: (id) => call('profiles:delete', id),
  startProfile: (id) => call('profiles:start', id),
  stopProfile: (id) => call('profiles:stop', id),
  generateFingerprint: (platform) => call('fingerprint:generate', platform),
  randomSeed: () => call('fingerprint:seed'),
  checkProxy: (proxy) => call('proxy:check', proxy),
  getSettings: () => call('settings:get'),
  updateSettings: (patch) => call('settings:update', patch),
  pickKernel: () => call('dialog:pickKernel'),
  onStatus: (cb) => {
    const listener = (_e, id, status) => cb(id, status);
    ipcRenderer.on('profile:status', listener);
    return () => ipcRenderer.removeListener('profile:status', listener);
  },
});
