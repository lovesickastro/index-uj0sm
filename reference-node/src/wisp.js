'use strict';
/*
 * A small Wisp server (https://github.com/MercuryWorkshop/wisp-protocol), TCP only.
 *
 * Wisp multiplexes many TCP connections over one WebSocket. The in-browser proxy (Scramjet + libcurl)
 * uses it to open real network connections, which is what lets JavaScript games work.
 * Written from the public protocol spec (v1, plus the v2 handshake with no extensions).
 */
const dns = require('dns');
const net = require('net');
const { isPublic } = require('./netutil');

const CONNECT = 1, DATA = 2, CONTINUE = 3, CLOSE = 4, INFO = 5;

const BUFFER = 128;                 // packets the client may send per stream before waiting for CONTINUE
const MAX_STREAMS = 256;            // per websocket connection
const MAX_CONNECTIONS_PER_IP = 12;
const CONNECT_TIMEOUT = 10000;
const DNS_TIMEOUT = 8000;
const BLOCKED_PORTS = new Set([25, 465, 587]);   // outgoing mail (spam abuse)
const WS_HIGH_WATER = 1 << 20;      // pause a remote socket while this much is waiting to go to the browser
const DEBUG = process.env.WISP_DEBUG === '1';
const dbg = (...a) => { if (DEBUG) console.log('[wisp]', ...a); };

class StreamError extends Error {
  constructor(code) { super('wisp stream error 0x' + code.toString(16)); this.code = code; }
}

const active = new Map();   // ip -> open websocket count

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/** Resolve a name, keeping only addresses we are allowed to connect to. */
async function resolve(host, allowPrivate) {
  let infos;
  try {
    infos = await Promise.race([
      dns.promises.lookup(host, { all: true }),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('dns timeout'), { code: 'DNS_TIMEOUT' })), DNS_TIMEOUT).unref()),
    ]);
  } catch (e) {
    throw new StreamError(e.code === 'DNS_TIMEOUT' ? 0x43 : 0x42);
  }
  let addrs = [...new Set(infos.map((i) => i.address))];
  if (!allowPrivate) {
    addrs = addrs.filter(isPublic);
    if (!addrs.length) throw new StreamError(0x48);
  }
  return addrs;
}

function connectOnce(addr, port) {
  return new Promise((resolveP, reject) => {
    const s = net.connect({ host: addr, port });
    const timer = setTimeout(() => { s.destroy(); reject(new StreamError(0x43)); }, CONNECT_TIMEOUT);
    s.once('connect', () => { clearTimeout(timer); s.removeAllListeners('error'); resolveP(s); });
    s.once('error', (e) => { clearTimeout(timer); s.destroy(); reject(new StreamError(e.code === 'ECONNREFUSED' ? 0x44 : 0x42)); });
  });
}

class Stream {
  constructor(conn, sid) {
    this.conn = conn; this.sid = sid;
    this.socket = null;
    this.backlog = [];      // client data that arrived before the remote connection was up
    this.pending = 0;       // writes handed to the socket but not yet flushed
    this.consumed = 0;
    this.done = false;
  }

  async open(host, port) {
    if (!host || !(port > 0 && port < 65536)) throw new StreamError(0x41);
    if (BLOCKED_PORTS.has(port)) throw new StreamError(0x48);
    const addrs = await resolve(host, this.conn.allowPrivate);
    let last = 0x42;
    for (const a of addrs.slice(0, 4)) {   // connect to the vetted IP itself, so DNS can't swap in a private one
      try { return await connectOnce(a, port); } catch (e) { last = e.code || 0x42; }
    }
    throw new StreamError(last);
  }

  start(host, port) {
    this.open(host, port).then((socket) => {
      if (this.done) { socket.destroy(); return; }
      this.socket = socket;
      socket.setNoDelay(true);
      socket.on('data', (chunk) => this.fromRemote(chunk));
      socket.on('end', () => this.shutdown(0x02));
      socket.on('error', () => this.shutdown(0x03));
      socket.on('close', () => this.shutdown(0x02));
      const q = this.backlog; this.backlog = [];
      q.forEach((d) => this.write(d));
    }).catch((e) => this.shutdown(e instanceof StreamError ? e.code : 0x03));
  }

  /** remote -> browser */
  fromRemote(chunk) {
    this.conn.sendPacket(DATA, this.sid, chunk);
    const ws = this.conn.ws;
    if (ws.bufferedAmount > WS_HIGH_WATER && this.socket) {   // browser is slow: stop reading until it catches up
      this.socket.pause();
      const t = setInterval(() => {
        if (this.done || this.conn.closed) { clearInterval(t); return; }
        if (ws.bufferedAmount < WS_HIGH_WATER / 4) { clearInterval(t); this.socket && this.socket.resume(); }
      }, 20);
    }
  }

  /** browser -> remote */
  write(data) {
    if (!this.socket) { this.backlog.push(data); return; }
    this.pending++;
    this.socket.write(data, () => {
      this.pending--;
      if (this.done) return;
      this.consumed++;
      if (this.consumed >= BUFFER / 2) {
        this.consumed = 0;
        this.conn.sendPacket(CONTINUE, this.sid, u32(Math.max(0, BUFFER - this.pending - this.backlog.length)));
      }
    });
  }

  shutdown(reason = null) {
    if (this.done) return;
    this.done = true;
    if (this.conn.streams.get(this.sid) === this) this.conn.streams.delete(this.sid);
    dbg('stream', this.sid, 'closed', reason !== null ? '0x' + reason.toString(16) : 'by client');
    if (reason !== null) this.conn.sendPacket(CLOSE, this.sid, Buffer.from([reason]));
    if (this.socket) this.socket.destroy();
  }
}

class Connection {
  constructor(ws, allowPrivate) {
    this.ws = ws; this.allowPrivate = allowPrivate;
    this.streams = new Map();
    this.closed = false;
    this.awaitingInfo = false;
  }

  sendPacket(type, sid, payload = Buffer.alloc(0)) {
    if (this.closed || this.ws.readyState !== 1) return;
    const head = Buffer.alloc(5);
    head.writeUInt8(type, 0);
    head.writeUInt32LE(sid, 1);
    try { this.ws.send(Buffer.concat([head, payload]), { binary: true }); } catch { this.closed = true; }
  }

  /** v2 clients offer a subprotocol: we say hello with INFO first, then wait for theirs. */
  begin(v2) {
    if (v2) { this.sendPacket(INFO, 0, Buffer.from([2, 0])); this.awaitingInfo = true; }
    else this.sendPacket(CONTINUE, 0, u32(BUFFER));
  }

  onMessage(data) {
    if (!Buffer.isBuffer(data) || data.length < 5) return;
    if (this.awaitingInfo) {
      this.awaitingInfo = false;
      this.sendPacket(CONTINUE, 0, u32(BUFFER));
      if (data[0] === INFO) return;     // otherwise an older client that skipped INFO: treat as v1 and handle it
    }
    this.handle(data);
  }

  handle(data) {
    const type = data.readUInt8(0), sid = data.readUInt32LE(1), payload = data.subarray(5);
    if (type === CONNECT) {
      if (sid === 0 || this.streams.has(sid)) return this.sendPacket(CLOSE, sid, Buffer.from([0x41]));
      if (this.streams.size >= MAX_STREAMS) return this.sendPacket(CLOSE, sid, Buffer.from([0x49]));
      if (payload.length < 4) return this.sendPacket(CLOSE, sid, Buffer.from([0x41]));
      const stype = payload[0], port = payload.readUInt16LE(1), host = payload.toString('utf8', 3);
      if (stype !== 1) return this.sendPacket(CLOSE, sid, Buffer.from([0x41]));   // TCP only
      dbg('CONNECT', sid, host, port);
      const s = new Stream(this, sid);
      this.streams.set(sid, s);
      s.start(host, port);
    } else if (type === DATA) {
      const s = this.streams.get(sid);
      if (s) s.write(Buffer.from(payload));
    } else if (type === CLOSE) {
      const s = this.streams.get(sid);
      if (s) s.shutdown(null);
    }
  }

  closeAll() {
    this.closed = true;
    for (const s of [...this.streams.values()]) s.shutdown(null);
  }
}

/** Called with an already-upgraded WebSocket and the client's address. */
function handleWisp(ws, ip, { allowPrivate = false } = {}) {
  if ((active.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) { ws.close(1013); return; }
  active.set(ip, (active.get(ip) || 0) + 1);
  const conn = new Connection(ws, allowPrivate);
  conn.begin(ws.protocol !== '');
  ws.on('message', (data, isBinary) => { if (isBinary) conn.onMessage(Buffer.isBuffer(data) ? data : Buffer.concat(data)); });
  const end = () => {
    if (conn.closed && !active.has(ip)) return;
    conn.closeAll();
    const n = (active.get(ip) || 1) - 1;
    if (n <= 0) active.delete(ip); else active.set(ip, n);
  };
  let ended = false;
  const once = () => { if (!ended) { ended = true; end(); } };
  ws.on('close', once);
  ws.on('error', once);
}

module.exports = { handleWisp };
