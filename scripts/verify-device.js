// Verifies audio-aware seed selection and the CDP screen/geolocation overrides.
//   node scripts/verify-device.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { Store } = require('../src/main/store');
const { Launcher } = require('../src/main/launcher');
const { pickSeed, describe } = require('../src/main/seeds');
const { audioBaseline } = require('../src/main/probe');
const { CdpConnection, fetchJson } = require('../src/main/cdp');

const KERNEL = path.join(__dirname, '..', 'vendor', 'kernel', 'Chromium.app');

function servers() {
  // Same port on two different sites (127.0.0.1 vs localhost) => cross-site OOPIF.
  return new Promise((resolve) => {
    const srv = http.createServer((q, s) => {
      s.writeHead(200, { 'Content-Type': 'text/html' });
      if (q.url.startsWith('/frame')) {
        return s.end("<!doctype html><script>parent.postMessage({ screen: screen.width + 'x' + screen.height, dpr: devicePixelRatio, origin: location.origin }, '*')</script>");
      }
      s.end(`<!doctype html><script>window.__frame = new Promise((r) => addEventListener('message', (e) => r(e.data)));</script>
        <body><iframe id="f" src="http://localhost:${srv.address().port}/frame"></iframe></body>`);
    });
    srv.listen(0, () => resolve(srv));
  });
}

const PAGE_PROBE = `(async () => {
  await new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', r)));
  const geo = await new Promise((res) => navigator.geolocation.getCurrentPosition(
    (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
    (e) => res({ error: e.code }), { timeout: 5000 }));
  const frame = await Promise.race([window.__frame, new Promise((r) => setTimeout(() => r(null), 3000))]);
  return { frame, href: location.href, screen: screen.width + 'x' + screen.height, dpr: devicePixelRatio,
    outer: outerWidth + 'x' + outerHeight, geo,
    native: /\\[native code\\]/.test(Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get)) };
})()`;
const FRAME_PROBE = `({ screen: screen.width + 'x' + screen.height, dpr: devicePixelRatio, origin: location.origin })`;

async function evalIn(conn, sessionId, expression) {
  const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-dev-'));
  const srv = await servers();
  const port = srv.address().port;
  const store = new Store(dir);
  const launcher = new Launcher(store, { bundledKernel: KERNEL, extensionsDir: path.join(__dirname, '..', 'build', 'extensions') });
  const { exe, kernelId } = launcher.kernel();
  try {
    // ---- 1. audio-aware seeds ----
    const baseline = await audioBaseline(exe);
    const buckets = [];
    for (let i = 0; i < 4; i++) {
      const fpTemplate = { platform: 'macos', platformVersion: '15.2.0', brand: 'Chrome', brandVersion: '', hardwareConcurrency: 8 };
      const { seed, probe } = await pickSeed({ exe, kernelId, fp: fpTemplate, profiles: store.listProfiles() });
      store.createProfile({ name: `p${i}`, fingerprint: { ...fpTemplate, seed, probe } });
      buckets.push(probe.audioHash);
      assert.notStrictEqual(probe.audioHash, baseline, 'picked a no-noise seed');
      console.log(`  seed ${seed} -> audio ${probe.audioHash} | ${probe.gpuRenderer} | mem ${probe.deviceMemory}`);
    }
    const distinct = new Set(buckets).size;
    console.log(`${distinct === buckets.length ? '✓' : '!'} 4 seeds: no no-noise seed, ${distinct} distinct audio buckets (baseline ${baseline})`);

    // The user's colliding pair should be flagged.
    const tpl = { platform: 'macos', brand: 'Chrome', brandVersion: '', hardwareConcurrency: 8 };
    const a = await describe(exe, kernelId, { ...tpl, seed: 100001 }, [], null);
    const c = await describe(exe, kernelId, { ...tpl, seed: 300003 }, [{ id: 'x', fingerprint: { ...tpl, seed: 100001, probe: a } }], null);
    assert.strictEqual(a.audioHash, c.audioHash);
    assert.strictEqual(c.audioSharedWith, 1);
    console.log(`✓ seeds 100001 / 300003 detected as sharing audio ${a.audioHash}`);

    // ---- 2. screen + geolocation + start URL ----
    const p = store.createProfile({
      name: 'device',
      startUrls: [`http://127.0.0.1:${port}/`],
      fingerprint: {
        platform: 'windows', seed: 777, timezone: 'America/New_York', language: 'en-US',
        screen: { mode: 'custom', width: 1920, height: 1080, dpr: 1 },
        geolocation: { permission: 'allow', source: 'custom', latitude: 40.7128, longitude: -74.006, accuracy: 30 },
      },
    });
    const st = await launcher.start(p.id);
    await new Promise((r) => setTimeout(r, 1500));
    const conn = await CdpConnection.connect(st.wsEndpoint);
    const targets = (await conn.send('Target.getTargets')).targetInfos;
    const page = targets.find((t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${port}`));
    assert(page, `start URL not opened; targets: ${targets.map((t) => t.url).join(', ')}`);
    const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const r = await evalIn(conn, sessionId, PAGE_PROBE);
    console.log('  page:', JSON.stringify(r));
    assert.strictEqual(r.screen, '1920x1080');
    assert.strictEqual(r.dpr, 1);
    assert.strictEqual(r.native, true);
    assert.deepStrictEqual([r.geo.lat, r.geo.lon], [40.7128, -74.006]);
    const [ow, oh] = r.outer.split('x').map(Number);
    assert(ow <= 1920 && oh <= 1080, 'window larger than emulated screen');
    console.log('✓ screen 1920x1080@1, geolocation override, window fits screen, getters native');
    // Known, accepted limitation: site isolation stays on (disabling it fails Cloudflare
    // Turnstile), so out-of-process cross-site iframes still report the real screen.
    assert(r.frame, 'cross-site iframe did not report');
    console.log(`  (known limitation) cross-site iframe ${r.frame.origin} reports ${r.frame.screen}@${r.frame.dpr}`);

    // Default search engine (ungoogled-chromium ships "No Search")
    const { targetId: sTarget } = await conn.send('Target.createTarget', { url: 'chrome://settings/searchEngines' });
    const { sessionId: sSess } = await conn.send('Target.attachToTarget', { targetId: sTarget, flatten: true });
    await new Promise((res) => setTimeout(res, 2000));
    const engines = await evalIn(conn, sSess, `import('chrome://resources/js/cr.js').then((m) => m.sendWithPromise('getSearchEnginesList')).then((l) => l.defaults.filter((e) => e.default).map((e) => e.name))`);
    assert.deepStrictEqual(engines, ['Google'], `default search engine is ${engines}`);
    console.log('✓ default search engine: Google');
    conn.close();
    await launcher.stop(p.id);
    console.log('All device checks passed.');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  process.exit(0);
})().catch((e) => {
  console.error('✗', e.message || e);
  process.exit(1);
});
