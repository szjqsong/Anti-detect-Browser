// Minimal Chrome DevTools Protocol client (flattened sessions) over `ws`.
// Electron 33's main process runs Node 20, which has no global WebSocket.
const http = require('http');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

class CdpConnection extends EventEmitter {
  static connect(wsUrl, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('CDP connect timeout'));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(new CdpConnection(ws));
      });
      ws.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  constructor(ws) {
    super();
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
      } else {
        this.emit('event', msg);
        this.emit(msg.method, msg.params, msg.sessionId);
      }
    });
    ws.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('CDP connection closed'));
      this.pending.clear();
      this.emit('close');
    });
    ws.on('error', () => {});
  }

  send(method, params = {}, sessionId) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP connection closed'));
    const id = ++this.nextId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

function fetchJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function waitForDebugger(port, proc, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) throw new Error(`Kernel exited early (code ${proc.exitCode})`);
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('Timed out waiting for the browser DevTools endpoint');
}

module.exports = { CdpConnection, fetchJson, waitForDebugger };
