// Proxy handling.
// fingerprint-chromium's --proxy-server does not support username/password, so every
// profile with a proxy gets a local, unauthenticated forwarder (proxy-chain) that
// injects credentials and talks to the real upstream (http/https/socks4/socks5).
const http = require('http');
const net = require('net');
const { Server } = require('proxy-chain');

const SCHEMES = ['http', 'https', 'socks4', 'socks5'];

/**
 * Accepts:
 *   scheme://user:pass@host:port
 *   user:pass@host:port          (http assumed)
 *   host:port
 *   host:port:user:pass
 * Returns a normalized URL string, or null for empty input.
 */
function normalizeProxy(input) {
  const s = (input || '').trim();
  if (!s) return null;

  if (/^[a-z0-9]+:\/\//i.test(s)) {
    const u = new URL(s);
    const scheme = u.protocol.replace(':', '').toLowerCase();
    const mapped = scheme === 'socks' ? 'socks5' : scheme;
    if (!SCHEMES.includes(mapped)) throw new Error(`Unsupported proxy scheme: ${scheme}`);
    if (!u.hostname || !u.port) throw new Error('Proxy must include host and port');
    u.protocol = `${mapped}:`;
    return u.toString().replace(/\/$/, '');
  }

  // host:port:user:pass (checked first: the password itself may contain "@")
  const parts = s.split(':');
  if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
    const [host, port, user, ...rest] = parts;
    const pass = rest.join(':');
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }

  if (s.includes('@')) return normalizeProxy(`http://${s}`);

  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[1])) throw new Error('Proxy port must be a number');
    return `http://${parts[0]}:${parts[1]}`;
  }
  throw new Error('Unrecognized proxy format');
}

function maskProxy(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Starts a local forwarder. Returns { url, close }. */
async function startForwarder(upstreamUrl) {
  const port = await getFreePort();
  const server = new Server({
    port,
    host: '127.0.0.1',
    verbose: false,
    prepareRequestFunction: () => ({ upstreamProxyUrl: upstreamUrl }),
  });
  await server.listen();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(true),
  };
}

// Minimal country -> browser language map; extend as needed.
const COUNTRY_LANG = {
  US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IE: 'en-IE', SG: 'en-SG',
  IN: 'en-IN', PH: 'en-PH', TW: 'zh-TW', HK: 'zh-HK', CN: 'zh-CN', JP: 'ja-JP', KR: 'ko-KR',
  DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', FR: 'fr-FR', BE: 'fr-BE', ES: 'es-ES', MX: 'es-MX',
  AR: 'es-AR', CO: 'es-CO', IT: 'it-IT', PT: 'pt-PT', BR: 'pt-BR', NL: 'nl-NL', PL: 'pl-PL',
  RU: 'ru-RU', UA: 'uk-UA', TR: 'tr-TR', SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI',
  TH: 'th-TH', VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY', SA: 'ar-SA', AE: 'ar-AE', IL: 'he-IL',
};

function languageForCountry(code) {
  return COUNTRY_LANG[code] || 'en-US';
}

/**
 * Looks up the exit IP's location. If localProxyUrl is given the request goes through it.
 * Uses ip-api.com (free tier, HTTP only).
 */
function lookupGeo(localProxyUrl, timeoutMs = 10000) {
  const target = 'http://ip-api.com/json/?fields=status,message,query,country,countryCode,city,timezone,lat,lon';
  return new Promise((resolve, reject) => {
    let opts;
    if (localProxyUrl) {
      const p = new URL(localProxyUrl);
      opts = { host: p.hostname, port: p.port, path: target, headers: { Host: 'ip-api.com' } };
    } else {
      opts = target;
    }
    const req = http.get(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.status !== 'success') return reject(new Error(j.message || 'Geo lookup failed'));
          resolve({
            ip: j.query,
            country: j.country,
            countryCode: j.countryCode,
            city: j.city,
            timezone: j.timezone,
            latitude: j.lat,
            longitude: j.lon,
            language: languageForCountry(j.countryCode),
          });
        } catch {
          reject(new Error(`Unexpected geo response (HTTP ${res.statusCode})`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Proxy check timed out')));
    req.on('error', reject);
  });
}

/** Tests a proxy end to end and returns its exit geo info and latency. */
async function checkProxy(input) {
  const upstream = normalizeProxy(input);
  const started = Date.now();
  if (!upstream) return { ...(await lookupGeo(null)), latencyMs: Date.now() - started, direct: true };
  const fwd = await startForwarder(upstream);
  try {
    const geo = await lookupGeo(fwd.url);
    return { ...geo, latencyMs: Date.now() - started, direct: false };
  } finally {
    await fwd.close();
  }
}

module.exports = { normalizeProxy, maskProxy, startForwarder, lookupGeo, checkProxy, getFreePort };
