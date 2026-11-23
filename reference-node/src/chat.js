'use strict';
/*
 * Global chat: one shared room for everyone connected to this server (WebSocket).
 * Messages are broadcast live, the last HISTORY are kept (and saved to chat_history.json so a restart
 * doesn't wipe the room). Text is always sent as plain text and the browser shows it as text, never HTML.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { clean, cleanNick, clientIp, sameSite } = require('./netutil');

const MAX_LEN = 300;                    // characters per message
const HISTORY = 100;                    // messages kept and replayed to new joiners
const RATE_COUNT = 5, RATE_WINDOW = 10000;   // at most 5 messages per 10 seconds per connection
const MAX_PER_IP = 6;                   // simultaneous connections per address
const MAX_TOTAL = 500;                  // simultaneous connections overall
const MAX_FRAME = 4096;                 // largest incoming frame (characters)
const HISTORY_FILE = process.env.CHAT_FILE || path.join(__dirname, '..', 'chat_history.json');

const tagFor = (salt, ip) => crypto.createHash('sha256').update(salt + ip).digest('hex').slice(0, 4);

class Client {
  constructor(ws, ip, salt) {
    this.ws = ws; this.ip = ip;
    this.nick = cleanNick('');
    this.tag = tagFor(salt, ip);
    this.times = [];
    this.lastText = ''; this.lastTime = 0;
    this.dead = false;
  }
  push(obj) {
    if (this.dead || this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > 1 << 20) { this.dead = true; this.ws.terminate(); return; }   // not keeping up
    this.ws.send(JSON.stringify(obj));
  }
}

class Room {
  constructor() {
    this.clients = new Set();
    this.perIp = new Map();
    this.history = [];
    this.salt = crypto.randomBytes(8).toString('hex');
    this.nextId = 1;
    this.saveTimer = null;
    this.load();
  }

  // persistence: messages + the salt, so name tags stay the same after a restart
  load() {
    try {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      this.salt = String(data.salt || this.salt);
      for (const m of (data.msgs || []).slice(-HISTORY)) {
        if (['id', 'nick', 'tag', 'text', 'ts'].every((k) => k in m)) this.history.push({ id: m.id, nick: m.nick, tag: m.tag, text: m.text, ts: m.ts });
      }
      if (this.history.length) this.nextId = Math.max(...this.history.map((m) => m.id)) + 1;
    } catch { /* first run */ }
  }
  save() {
    this.saveTimer = null;
    const tmp = HISTORY_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify({ salt: this.salt, msgs: this.history }), (err) => {
      if (!err) fs.rename(tmp, HISTORY_FILE, () => {});
    });
  }
  scheduleSave() { if (!this.saveTimer) { this.saveTimer = setTimeout(() => this.save(), 2000); this.saveTimer.unref(); } }

  broadcast(make) { for (const c of [...this.clients]) c.push(make(c)); }
  announceOnline() { const n = this.clients.size; this.broadcast(() => ({ t: 'online', n })); }

  post(c, raw) {
    const text = clean(raw, MAX_LEN);
    if (!text) return;
    const now = Date.now();
    c.times = c.times.filter((t) => now - t <= RATE_WINDOW);
    if (c.times.length >= RATE_COUNT) return c.push({ t: 'error', text: "You're sending messages too fast. Wait a few seconds." });
    if (text === c.lastText && now - c.lastTime < 10000) return c.push({ t: 'error', text: "Don't repeat the same message." });
    c.times.push(now);
    c.lastText = text; c.lastTime = now;
    const m = { id: this.nextId++, nick: c.nick, tag: c.tag, text, ts: Math.floor(now / 1000) };
    this.history.push(m);
    if (this.history.length > HISTORY) this.history.shift();
    this.scheduleSave();
    this.broadcast((cl) => ({ t: 'msg', me: cl === c, ...m }));
  }
}

const ROOM = new Room();

function handleChat(ws, req) {
  const ip = clientIp(req);
  if (!sameSite(req)) return ws.close(1008);
  if ((ROOM.perIp.get(ip) || 0) >= MAX_PER_IP || ROOM.clients.size >= MAX_TOTAL) return ws.close(1013);
  const c = new Client(ws, ip, ROOM.salt);
  ROOM.clients.add(c);
  ROOM.perIp.set(ip, (ROOM.perIp.get(ip) || 0) + 1);
  c.push({ t: 'you', nick: c.nick, tag: c.tag });
  c.push({ t: 'history', msgs: ROOM.history });
  ROOM.announceOnline();

  ws.on('message', (data) => {
    const raw = data.toString('utf8');
    if (raw.length > MAX_FRAME) return c.push({ t: 'error', text: 'That was too big.' });
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    if (d.t === 'hello') { c.nick = cleanNick(d.nick); c.push({ t: 'you', nick: c.nick, tag: c.tag }); }
    else if (d.t === 'msg') ROOM.post(c, d.text);
  });
  let gone = false;
  const bye = () => {
    if (gone) return; gone = true;
    c.dead = true;
    ROOM.clients.delete(c);
    const n = (ROOM.perIp.get(ip) || 1) - 1;
    if (n <= 0) ROOM.perIp.delete(ip); else ROOM.perIp.set(ip, n);
    ROOM.announceOnline();
  };
  ws.on('close', bye);
  ws.on('error', bye);
}

module.exports = { handleChat, ROOM, tagFor };
