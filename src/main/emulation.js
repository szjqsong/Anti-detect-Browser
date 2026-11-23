// Per-profile overrides the kernel has no flags for, applied through CDP Emulation.
// These are implemented inside Blink (not JS injection), so getters stay native and
// iframes/media queries agree. Every new target is paused on creation
// (waitForDebuggerOnStart) until the overrides are applied, so no page script can
// observe the real values first.
const { CdpConnection } = require('./cdp');

/**
 * @param {string} wsEndpoint browser-level DevTools websocket
 * @param {object} cfg
 * @param {{width:number,height:number,dpr:number}|null} cfg.screen
 * @param {{latitude:number,longitude:number,accuracy:number}|null} cfg.geolocation
 * @param {'ask'|'allow'|'block'} cfg.geoPermission
 * @param {string[]} startUrls opened after overrides are in place
 */
async function startEmulation(wsEndpoint, cfg, startUrls = []) {
  const conn = await CdpConnection.connect(wsEndpoint);

  const applyToPage = (sessionId) => {
    const tasks = [];
    if (cfg.screen) {
      tasks.push(
        conn.send('Emulation.setDeviceMetricsOverride', {
          width: 0, // 0 = keep the real viewport, only override screen + DPR
          height: 0,
          deviceScaleFactor: cfg.screen.dpr || 1,
          mobile: false,
          screenWidth: cfg.screen.width,
          screenHeight: cfg.screen.height,
        }, sessionId)
      );
    }
    if (cfg.geolocation) {
      tasks.push(conn.send('Emulation.setGeolocationOverride', cfg.geolocation, sessionId));
    } else if (cfg.geoPermission === 'block') {
      // Position unavailable instead of falling through to the real OS location.
      tasks.push(conn.send('Emulation.setGeolocationOverride', {}, sessionId));
    }
    return tasks;
  };

  const firstPage = new Promise((resolve) => {
    conn.on('Target.attachedToTarget', async (params, parentSession) => {
      const { sessionId, targetInfo } = params;
      // Out-of-process iframes have their own renderer and do NOT inherit the page's
      // screen override, so they need it applied as well.
      const tasks = targetInfo.type === 'page' || targetInfo.type === 'iframe' ? applyToPage(sessionId) : [];
      // Recurse into OOPIFs / workers so they are paused + released too.
      tasks.push(conn.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId));
      await Promise.allSettled(tasks);
      await conn.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
      if (targetInfo.type === 'page' && !parentSession) resolve(sessionId);
    });
  });

  if (cfg.geoPermission === 'allow') {
    await conn.send('Browser.grantPermissions', { permissions: ['geolocation'] }).catch(() => {});
  } else if (cfg.geoPermission === 'block') {
    await conn.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied' }).catch(() => {});
  }

  // Also attaches to the already-open about:blank tab.
  await conn.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const urls = startUrls.filter(Boolean);
  if (urls.length) {
    const sessionId = await Promise.race([firstPage, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (sessionId) await conn.send('Page.navigate', { url: urls[0] }, sessionId).catch(() => {});
    for (const url of urls.slice(1)) await conn.send('Target.createTarget', { url }).catch(() => {});
  }

  return { close: () => conn.close() };
}

module.exports = { startEmulation };
