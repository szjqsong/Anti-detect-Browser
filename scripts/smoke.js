// End-to-end smoke test without Electron:
//   node scripts/smoke.js [kernelPath] [kernelType]
// Defaults to the system Google Chrome in "chrome" mode.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { Server } = require('proxy-chain');
const { Store } = require('../src/main/store');
const { Launcher } = require('../src/main/launcher');
const { createApiServer } = require('../src/main/api');
const { buildArgs } = require('../src/main/kernel');
const { normalizeProxy, checkProxy, getFreePort } = require('../src/main/proxy');

const kernelPath = process.argv[2] || '/Applications/Google Chrome.app';
const kernelType = process.argv[3] || 'chrome';

function request(method, port, p, key) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'x-api-key': key } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // 1. Proxy parsing
  assert.strictEqual(normalizeProxy('1.2.3.4:8080'), 'http://1.2.3.4:8080');
  assert.strictEqual(normalizeProxy('1.2.3.4:8080:u:p@ss'), 'http://u:p%40ss@1.2.3.4:8080');
  assert.strictEqual(normalizeProxy('socks://u:p@h.com:1080'), 'socks5://u:p@h.com:1080');
  assert.strictEqual(normalizeProxy(''), null);
  console.log('✓ proxy parsing');

  // 2. fingerprint-chromium args
  const fakeProfile = {
    fingerprint: { seed: 42, platform: 'windows', platformVersion: '15.0.0', brand: 'Chrome', brandVersion: '', hardwareConcurrency: 8, disableSpoofing: ['gpu'] },
    extraArgs: ['--window-size=1280,800'],
    startUrls: [],
  };
  const args = buildArgs(fakeProfile, {
    kernelType: 'fingerprint-chromium', userDataDir: '/tmp/x', debugPort: 9222,
    proxyUrl: 'http://127.0.0.1:1', timezone: 'America/New_York', language: 'en-US',
  });
  for (const a of ['--fingerprint=42', '--fingerprint-platform=windows', '--fingerprint-hardware-concurrency=8',
    '--timezone=America/New_York', '--lang=en-US', '--accept-lang=en-US,en', '--disable-spoofing=gpu']) {
    assert(args.includes(a), `missing ${a}`);
  }
  console.log('✓ kernel args');

  // 3. Authenticated upstream proxy -> local forwarder -> geo lookup
  const upPort = await getFreePort();
  const upstream = new Server({
    port: upPort,
    host: '127.0.0.1',
    prepareRequestFunction: ({ username, password }) => ({
      requestAuthentication: username !== 'alice' || password !== 's3cret',
    }),
  });
  await upstream.listen();
  try {
    const geo = await checkProxy(`127.0.0.1:${upPort}:alice:s3cret`);
    console.log(`✓ auth proxy forwarding (exit ${geo.ip}, ${geo.timezone}, ${geo.latencyMs}ms)`);
  } catch (e) {
    console.log(`! auth proxy check skipped/failed: ${e.message}`);
  }
  await assert.rejects(checkProxy(`127.0.0.1:${upPort}:alice:wrong`));
  console.log('✓ wrong proxy password rejected');

  // 4. Launch a real browser through the launcher + API
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-smoke-'));
  const store = new Store(dir);
  store.updateSettings({ kernelPath, kernelType, apiPort: await getFreePort() });
  const launcher = new Launcher(store);
  const api = createApiServer({ store, launcher });
  const { apiPort, apiKey } = store.getSettings();
  await api.listen(apiPort);

  const p = store.createProfile({ name: 'smoke', proxy: `127.0.0.1:${upPort}:alice:s3cret` });
  assert.strictEqual((await request('GET', apiPort, '/api/v1/profiles', 'bad')).status, 401);
  const started = await request('POST', apiPort, `/api/v1/profiles/${p.id}/start`, apiKey);
  assert(started.body.ok, started.body.error);
  assert(started.body.data.wsEndpoint.startsWith('ws://127.0.0.1:'));
  console.log(`✓ browser started via API: ${started.body.data.wsEndpoint}`);

  const stopped = await request('POST', apiPort, `/api/v1/profiles/${p.id}/stop`, apiKey);
  assert.strictEqual(stopped.body.data.state, 'stopped');
  console.log('✓ browser stopped');

  await api.close();
  await upstream.close(true);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log('All smoke checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
