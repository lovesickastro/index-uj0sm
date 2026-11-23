'use strict';
/*
 * Voice/video calls: WebSocket signalling for peer-to-peer WebRTC.
 *
 * Audio and video go directly between browsers; this server only relays the small setup messages
 * (offers, answers, ICE candidates), keeps track of rooms, and rings people.
 *
 * - Rooms: anyone can join a named public room (default "lobby"), up to MAX_ROOM people.
 * - Direct calls: ring someone who has switched on "Available for calls" (OFF by default). The two of you
 *   get a private room that nobody else can join.
 */
const crypto = require('crypto');
const { cleanNick, clientIp, sameSite } = require('./netutil');
const { ROOM: CHAT_ROOM, tagFor } = require('./chat');

const MAX_ROOM = 8;                     // mesh calls get heavy past this
const MAX_PER_IP = 6;
const MAX_TOTAL = 300;
const MAX_FRAME = 32768;                // SDP offers can be several KB
const RING_MS = parseInt(process.env.RING_SECONDS || '30', 10) * 1000;
const RATE_MSGS = 400, RATE_WINDOW = 10000;   // all messages (ICE candidates arrive in bursts)
const CALLS_PER_MIN = 4;
const ROOM_RE = /^[a-z0-9][a-z0-9 _-]{0,23}$/;
const hex = (n) => crypto.randomBytes(n).toString('hex');

class Client {
  constructor(ws, ip) {
    this.ws = ws; this.ip = ip;
    this.id = hex(4);
    this.nick = cleanNick('');
    this.tag = tagFor(CHAT_ROOM.salt, ip);   // same tag as in chat
    this.available = false;
    this.room = null;
    this.mic = true; this.cam = false;
    this.ringingIn = null;                   // private room name we're being rung for
    this.ringingOut = null;                  // private room name we rang
    this.times = [];
    this.callTimes = [];
    this.dead = false;
  }
  meta() { return { id: this.id, nick: this.nick, tag: this.tag, mic: this.mic, cam: this.cam }; }
  push(obj) {
    if (this.dead || this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > 1 << 20) { this.dead = true; this.ws.terminate(); return; }
    this.ws.send(JSON.stringify(obj));
  }
}

class Invite {
  constructor(caller, callee) { this.caller = caller; this.callee = callee; this.answered = false; this.timer = null; }
}

class Hub {
  constructor() {
    this.clients = new Map();
    this.perIp = new Map();
    this.rooms = new Map();      // name -> [Client]
    this.invites = new Map();    // private room name -> Invite
    this.listsPending = false;
  }

  // ---------------------------------------------------------------- lists
  scheduleLists() {
    if (this.listsPending) return;
    this.listsPending = true;
    setTimeout(() => this.sendLists(), 250).unref();
  }
  sendLists() {
    this.listsPending = false;
    const people = [...this.clients.values()].filter((c) => c.available)
      .map((c) => ({ id: c.id, nick: c.nick, tag: c.tag, busy: !!(c.room || c.ringingIn) }));
    const rooms = [...this.rooms].filter(([n, m]) => !n.startsWith('~') && m.length).map(([name, m]) => ({ name, count: m.length }));
    for (const c of this.clients.values()) c.push({ t: 'lists', people: c.available ? people : [], rooms });
  }
  toRoom(name, obj, skip = null) {
    for (const m of [...(this.rooms.get(name) || [])]) if (m !== skip) m.push(obj);
  }

  // ---------------------------------------------------------------- rooms
  join(c, name) {
    this.leave(c);
    let inv = null;
    if (typeof name === 'string' && name.startsWith('~')) {
      inv = this.invites.get(name);
      if (!inv || (c.id !== inv.caller && c.id !== inv.callee)) return c.push({ t: 'error', text: 'That call is no longer available.' });
    } else {
      name = String(name || 'lobby').replace(/\s+/g, ' ').trim().toLowerCase() || 'lobby';
      if (!ROOM_RE.test(name)) return c.push({ t: 'error', text: 'Room names use letters, numbers, spaces, - and _ (max 24).' });
    }
    if (!this.rooms.has(name)) this.rooms.set(name, []);
    const members = this.rooms.get(name);
    if (members.length >= MAX_ROOM) return c.push({ t: 'error', text: `That room is full (${MAX_ROOM} people max).` });
    const peers = members.map((m) => m.meta());
    members.push(c);
    c.room = name; c.mic = true; c.cam = false;
    if (inv && c.id === inv.callee) {
      inv.answered = true;
      clearTimeout(inv.timer);
      c.ringingIn = null;
      const caller = this.clients.get(inv.caller);
      if (caller) caller.ringingOut = null;   // call connected: the caller is free to ring again later
    }
    c.push({ t: 'joined', room: name, you: c.meta(), peers });
    this.toRoom(name, { t: 'peer-join', peer: c.meta() }, c);
    this.scheduleLists();
  }

  leave(c) {
    const name = c.room;
    if (!name) return;
    c.room = null;
    const members = this.rooms.get(name) || [];
    const i = members.indexOf(c);
    if (i >= 0) members.splice(i, 1);
    const inv = this.invites.get(name);
    if (inv && !inv.answered && c.id === inv.caller) this.endInvite(name, 'cancelled');   // caller hung up before anyone answered
    if (!members.length) { this.rooms.delete(name); this.invites.delete(name); }
    else this.toRoom(name, { t: 'peer-leave', id: c.id });
    this.scheduleLists();
  }

  // ---------------------------------------------------------------- ringing
  /** outcome: cancelled (caller hung up) | declined | missed (nobody answered) */
  endInvite(name, outcome, who) {
    const inv = this.invites.get(name);
    if (!inv) return;
    this.invites.delete(name);
    clearTimeout(inv.timer);
    const caller = this.clients.get(inv.caller), callee = this.clients.get(inv.callee);
    if (callee) callee.ringingIn = null;
    if (caller) caller.ringingOut = null;
    if (outcome === 'cancelled' && callee) callee.push({ t: 'cancelled', room: name });
    else if (outcome === 'declined' && caller) caller.push({ t: 'declined', room: name, nick: who || 'They' });
    else if (outcome === 'missed') for (const x of [caller, callee]) if (x) x.push({ t: 'missed', room: name });
    this.scheduleLists();
  }

  call(c, toId) {
    const now = Date.now();
    c.callTimes = c.callTimes.filter((t) => now - t <= 60000);
    if (c.callTimes.length >= CALLS_PER_MIN) return c.push({ t: 'error', text: "You're calling too often. Wait a minute." });
    const callee = this.clients.get(toId);
    if (!callee || callee === c || !callee.available) return c.push({ t: 'error', text: "That person isn't available." });
    if (c.room || c.ringingOut) return c.push({ t: 'error', text: 'Leave your current call first.' });
    if (callee.room || callee.ringingIn) return c.push({ t: 'busy', nick: callee.nick });
    c.callTimes.push(now);
    const room = '~' + hex(5);
    const inv = new Invite(c.id, callee.id);
    this.invites.set(room, inv);
    c.ringingOut = room; callee.ringingIn = room;
    inv.timer = setTimeout(() => this.endInvite(room, 'missed'), RING_MS);
    callee.push({ t: 'incoming', from: c.meta(), room, seconds: RING_MS / 1000 });
    c.push({ t: 'ringing', to: callee.meta(), room });
    this.scheduleLists();
  }

  respond(c, room, accept) {
    const inv = this.invites.get(room);
    if (!inv || inv.callee !== c.id || inv.answered) return;
    if (!accept) this.endInvite(room, 'declined', c.nick);
  }

  cancel(c, room) {
    const inv = this.invites.get(room);
    if (inv && inv.caller === c.id && !inv.answered) this.endInvite(room, 'cancelled');
  }

  // ---------------------------------------------------------------- relay
  signal(c, toId, data) {
    const t = this.clients.get(toId);
    if (!t || !c.room || t.room !== c.room || !data || typeof data !== 'object') return;
    if (JSON.stringify(data).length > 24000) return;
    t.push({ t: 'signal', from: c.id, data });
  }

  drop(c) {
    c.dead = true;
    const ro = c.ringingOut, ri = c.ringingIn;
    this.leave(c);
    if (ro) this.endInvite(ro, 'cancelled');
    if (ri) this.endInvite(ri, 'declined', c.nick);
    this.clients.delete(c.id);
    const n = (this.perIp.get(c.ip) || 1) - 1;
    if (n <= 0) this.perIp.delete(c.ip); else this.perIp.set(c.ip, n);
    this.scheduleLists();
  }
}

const HUB = new Hub();

function handleCalls(ws, req) {
  const ip = clientIp(req);
  if (!sameSite(req)) return ws.close(1008);
  if ((HUB.perIp.get(ip) || 0) >= MAX_PER_IP || HUB.clients.size >= MAX_TOTAL) return ws.close(1013);
  const c = new Client(ws, ip);
  HUB.clients.set(c.id, c);
  HUB.perIp.set(ip, (HUB.perIp.get(ip) || 0) + 1);
  c.push({ t: 'you', ...c.meta() });
  HUB.scheduleLists();

  ws.on('message', (data) => {
    const raw = data.toString('utf8');
    if (raw.length > MAX_FRAME) return;
    const now = Date.now();
    c.times = c.times.filter((t) => now - t <= RATE_WINDOW);
    if (c.times.length >= RATE_MSGS) return;
    c.times.push(now);
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    switch (d.t) {
      case 'hello':
        c.nick = cleanNick(d.nick);
        c.push({ t: 'you', ...c.meta() });
        HUB.scheduleLists();
        if (c.room) HUB.toRoom(c.room, { t: 'peer-info', peer: c.meta() }, c);
        break;
      case 'avail': c.available = !!d.on; HUB.scheduleLists(); break;
      case 'join': HUB.join(c, d.room); break;
      case 'leave': HUB.leave(c); break;
      case 'signal': HUB.signal(c, d.to, d.data); break;
      case 'state':
        if (!c.room) break;
        c.mic = !!d.mic; c.cam = !!d.cam;
        HUB.toRoom(c.room, { t: 'peer-state', id: c.id, mic: c.mic, cam: c.cam }, c);
        break;
      case 'call': HUB.call(c, d.to); break;
      case 'respond': HUB.respond(c, d.room, !!d.accept); break;
      case 'cancel': HUB.cancel(c, d.room); break;
    }
  });
  let gone = false;
  const bye = () => { if (!gone) { gone = true; HUB.drop(c); } };
  ws.on('close', bye);
  ws.on('error', bye);
}

module.exports = { handleCalls };
