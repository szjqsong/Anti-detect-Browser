// Local HTTP API for automation (Puppeteer/Playwright connect via the returned wsEndpoint).
// Bound to 127.0.0.1 and protected by an API key header. Browsers cannot send a custom
// header cross-origin without a CORS preflight, which we never approve, so web pages
// cannot drive this API.
const http = require('http');
const { maskProxy, normalizeProxy } = require('./proxy');

function publicProfile(p, status) {
  let proxy = '';
  try {
    proxy = maskProxy(normalizeProxy(p.proxy));
  } catch {
    proxy = '(invalid)';
  }
  return { id: p.id, name: p.name, group: p.group, proxy, fingerprint: p.fingerprint, status };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
  });
}

function createApiServer({ store, launcher }) {
  const routes = [
    ['GET', /^\/api\/v1\/profiles$/, () => store.listProfiles().map((p) => publicProfile(p, launcher.status(p.id)))],
    ['POST', /^\/api\/v1\/profiles$/, async (req) => {
      const p = store.createProfile(await readBody(req));
      return publicProfile(p, launcher.status(p.id));
    }],
    ['GET', /^\/api\/v1\/profiles\/([\w-]+)$/, (req, [id]) => {
      const p = store.getProfile(id);
      if (!p) throw Object.assign(new Error('Profile not found'), { status: 404 });
      return publicProfile(p, launcher.status(id));
    }],
    ['POST', /^\/api\/v1\/profiles\/([\w-]+)\/start$/, (req, [id]) => launcher.start(id)],
    ['POST', /^\/api\/v1\/profiles\/([\w-]+)\/stop$/, (req, [id]) => launcher.stop(id)],
    ['GET', /^\/api\/v1\/status$/, () => ({ ok: true, running: launcher.running.size })],
  ];

  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers['x-api-key'] !== store.getSettings().apiKey) {
      return send(401, { ok: false, error: 'Missing or invalid x-api-key' });
    }
    const url = new URL(req.url, 'http://localhost');
    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (m && req.method === method) {
        try {
          return send(200, { ok: true, data: await handler(req, m.slice(1)) });
        } catch (err) {
          return send(err.status || 500, { ok: false, error: err.message });
        }
      }
    }
    send(404, { ok: false, error: 'Not found' });
  });

  return {
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(port));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createApiServer };
