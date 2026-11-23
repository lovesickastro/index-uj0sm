'use strict';
// Shared helpers: public-address check, client address, same-site check, text cleaning, rate limiting.
const net = require('net');

// ---------------------------------------------------------------- public address check
const V4_BLOCKED = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) V4_BLOCKED.addSubnet(a, p, 'ipv4');

const V6_BLOCKED = new net.BlockList();   // inside 2000::/3, the only range we ever allow
for (const [a, p] of [['2001::', 32], ['2001:db8::', 32], ['2001:10::', 28], ['3fff::', 20]]) V6_BLOCKED.addSubnet(a, p, 'ipv6');
const V6_GLOBAL = new net.BlockList();
V6_GLOBAL.addSubnet('2000::', 3, 'ipv6');

/** Expand an IPv6 string to 8 numbers (handles "::" and a trailing dotted IPv4). */
function hextets(addr) {
  let s = addr;
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const b = m[1].split('.').map(Number);
    s = s.slice(0, -m[1].length) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  const parts = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return parts.map((x) => parseInt(x || '0', 16));
}
const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True only for globally routable addresses (blocks localhost, LAN, link-local, cloud metadata...). */
function isPublic(addr) {
  addr = String(addr).split('%')[0].replace(/^\[|\]$/g, '');
  const fam = net.isIP(addr);
  if (fam === 4) return !V4_BLOCKED.check(addr, 'ipv4');
  if (fam !== 6) return false;
  const h = hextets(addr);
  if (h.length !== 8 || h.some(Number.isNaN)) return false;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isPublic(v4From(h[6], h[7]));   // ::ffff:a.b.c.d
  if (h[0] === 0x2002) return isPublic(v4From(h[1], h[2]));                                           // 6to4
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isPublic(v4From(h[6], h[7])); // NAT64
  return V6_GLOBAL.check(addr, 'ipv6') && !V6_BLOCKED.check(addr, 'ipv6');
}

// ---------------------------------------------------------------- requests
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/** Visitor address. Behind Cloudflare/nginx/a tunnel pass TRUST_PROXY=1 to use the real one. */
function clientIp(req) {
  let ip = req.socket.remoteAddress || '?';
  if (TRUST_PROXY) {
    const real = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]).trim();
    if (real) ip = real;
  }
  return ip.replace(/^::ffff:/i, '');
}

/** Reject websockets opened by other websites (cross-site hijacking). */
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return host === (req.headers.host || '') || host === (req.headers['x-forwarded-host'] || '\0');
}

// ---------------------------------------------------------------- text cleaning
// control characters, zero-width characters and right-to-left overrides (used to fake text)
const HIDDEN = /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const NICK_BAD = /[^\p{L}\p{N}_ \-.]/gu;
const cut = (s, n) => { const a = Array.from(s); return a.length > n ? a.slice(0, n).join('') : s; };

function clean(s, limit) {
  return cut(String(s ?? '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim(), limit);
}
function cleanNick(s) {
  const n = clean(clean(s, 40).replace(NICK_BAD, ''), 20);
  return Array.from(n).length >= 2 ? n : 'guest' + (1000 + Math.floor(Math.random() * 9000));
}

// ---------------------------------------------------------------- rate limit
const HITS = new Map();
/** true if this address has used `bucket` more than `limit` times in the last `windowSec` seconds. */
function limited(bucket, ip, limit, windowSec) {
  const key = bucket + '|' + ip, now = Date.now();
  let q = HITS.get(key);
  if (!q) HITS.set(key, (q = []));
  while (q.length && now - q[0] > windowSec * 1000) q.shift();
  if (q.length >= limit) return true;
  q.push(now);
  return false;
}
setInterval(() => {   // forget idle addresses
  const now = Date.now();
  for (const [k, q] of HITS) if (!q.length || now - q[q.length - 1] > 120000) HITS.delete(k);
}, 60000).unref();

module.exports = { isPublic, clientIp, sameSite, clean, cleanNick, limited };
