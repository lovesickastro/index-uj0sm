'use strict';
/*
 * The "basic" proxy at /proxy: fetches a page on the server and rewrites it so links, images, forms and CSS
 * come back through /proxy. Scripts are removed (the full Scramjet proxy is what runs JavaScript).
 * No HTML-parser dependency: a small tag tokenizer is enough for this job.
 *
 * Safety: every connection (including redirects) goes through a DNS lookup that refuses private/internal
 * addresses, so a hostname can't be pointed at localhost or your LAN (no SSRF, no DNS rebinding).
 */
const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');
const { Transform, pipeline } = require('stream');
const { isPublic, clientIp, limited } = require('./netutil');

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';   // only for local testing
const MAX_HTML = 5 * 1024 * 1024;
const MAX_ASSET = 15 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------------------------------------------------------- safe fetching
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true, family: options.family || 0 }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => isPublic(a.address));
    if (!ok.length) return cb(Object.assign(new Error("That address isn't allowed."), { code: 'EBLOCKED' }));
    if (options.all) cb(null, ok); else cb(null, ok[0].address, ok[0].family);
  });
}

class UserError extends Error {}

function assertSafe(u) {
  if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new UserError("That address isn't allowed.");
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (!ALLOW_PRIVATE && net.isIP(bare) && !isPublic(bare)) throw new UserError("That address isn't allowed.");   // literals skip DNS
}

function requestOnce(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    assertSafe(u);
    const headers = {
      'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Encoding': 'gzip, deflate, br',
    };
    if (body != null) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method, headers, timeout: 20000, ...(ALLOW_PRIVATE ? {} : { lookup: safeLookup }),
    }, resolve);
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

/** Fetch with manual redirects so every hop is checked. Resolves { res, stream, url } (stream is already decompressed). */
async function fetchSafe(method, url, body) {
  for (let hop = 0; hop < 6; hop++) {
    const res = await requestOnce(method, url, body);
    const loc = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
      res.resume();
      url = new URL(loc, url).href;
      if ([301, 302, 303].includes(res.statusCode)) { method = 'GET'; body = null; }
      continue;
    }
    const enc = String(res.headers['content-encoding'] || '').toLowerCase();
    let stream = res;
    const dec = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip() : enc === 'deflate' ? zlib.createInflate()
      : enc === 'br' ? zlib.createBrotliDecompress() : null;
    if (dec) { stream = res.pipe(dec); res.on('error', (e) => dec.destroy(e)); }
    return { res, stream, url };
  }
  throw new UserError('Too many redirects.');
}

function readLimited(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    stream.on('data', (c) => { size += c.length; if (size > limit) { stream.destroy(); resolve(Buffer.concat(chunks)); } else chunks.push(c); });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('close', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------- rewriting
const purl = (u) => '/proxy?url=' + encodeURIComponent(u);

/** Skip search-engine click-tracking redirects. */
function unwrap(u) {
  try {
    const p = new URL(u), h = p.hostname;
    if (h.endsWith('duckduckgo.com') && p.pathname === '/l/' && p.searchParams.get('uddg')) return p.searchParams.get('uddg');
    if (h.includes('google.') && p.pathname === '/url' && p.searchParams.get('q')) return p.searchParams.get('q');
  } catch { /* not a URL */ }
  return u;
}

const SKIP = /^(javascript:|mailto:|tel:|data:|blob:|about:|#)/i;
function rw(u, base) {
  u = (u || '').trim();
  if (!u || SKIP.test(u)) return u;
  try { return purl(unwrap(new URL(u, base).href)); } catch { return u; }
}

const CSS_URL = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(["'])(.*?)\1/gi;
const rwCss = (css, base) =>
  css.replace(CSS_URL, (_, q, u) => `url(${q}${rw(u, base)}${q})`).replace(CSS_IMPORT, (_, q, u) => `@import ${q}${rw(u, base)}${q}`);

function rwSrcset(v, base) {
  return v.trim().split(/,\s+/).map((part) => {
    const bits = part.trim().split(/\s+/);
    if (bits[0]) bits[0] = rw(bits[0].replace(/,$/, ''), base);
    return bits.join(' ');
  }).filter(Boolean).join(', ');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()];
});
const encodeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const URL_ATTRS = {
  a: ['href'], area: ['href'], link: ['href'], img: ['src', 'data-src'], source: ['src'], video: ['src', 'poster'],
  audio: ['src'], track: ['src'], embed: ['src'], iframe: ['src'], object: ['data'], input: ['src'],
};
const DROP_REL = new Set(['preload', 'prefetch', 'preconnect', 'dns-prefetch', 'modulepreload', 'prerender']);
const DROP_ATTRS = new Set(['integrity', 'crossorigin', 'nonce', 'target']);

const TAG_RE = /<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(s) {
  const out = []; let m;
  ATTR_RE.lastIndex = 0;
  s = s.replace(/\/\s*$/, '');
  while ((m = ATTR_RE.exec(s))) out.push([m[1], m[2] ?? m[3] ?? m[4] ?? null]);
  return out;
}

function rewriteHtml(html, pageUrl, nonce) {
  html = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*>/gi, '')
    .replace(/<\/?noscript\b[^>]*>/gi, '');
  let base = pageUrl;
  const b = html.match(/<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (b) { try { base = new URL(decodeEntities(b[1] ?? b[2] ?? b[3]), pageUrl).href; } catch { /* keep page url */ } }
  html = html.replace(/<base\b[^>]*>/gi, '');

  html = html.replace(TAG_RE, (whole, rawName, rawAttrs) => {
    const name = rawName.toLowerCase();
    let attrs = parseAttrs(rawAttrs).filter(([k]) => !k.toLowerCase().startsWith('on') && !DROP_ATTRS.has(k.toLowerCase()));
    const get = (k) => { const a = attrs.find(([n]) => n.toLowerCase() === k); return a ? a[1] : null; };
    const set = (k, v) => { const a = attrs.find(([n]) => n.toLowerCase() === k); if (a) a[1] = v; else attrs.push([k, v]); };
    const del = (k) => { attrs = attrs.filter(([n]) => n.toLowerCase() !== k); };

    if (name === 'meta') {
      const he = (get('http-equiv') || '').toLowerCase();
      if (he === 'refresh' || he === 'content-security-policy') return '';
    }
    if (name === 'link' && (get('rel') || '').toLowerCase().split(/\s+/).some((x) => DROP_REL.has(x))) return '';

    for (const a of URL_ATTRS[name] || []) {
      const v = get(a);
      if (v) set(a, rw(decodeEntities(v), base));
    }
    if (name === 'img' && !get('src') && get('data-src')) set('src', get('data-src'));
    for (const a of ['srcset', 'data-srcset']) { const v = get(a); if (v) set(a, rwSrcset(decodeEntities(v), base)); }
    const st = get('style');
    if (st) set('style', rwCss(decodeEntities(st), base));

    let extra = '';
    if (name === 'form') {
      const action = new URL(decodeEntities(get('action') || '') || pageUrl, base).href;
      const method = (get('method') || 'get').toLowerCase() === 'post' ? 'post' : 'get';
      del('enctype'); set('action', '/proxy'); set('method', method);
      extra = `<input type="hidden" name="__u" value="${encodeAttr(action)}">`;
    }
    const str = attrs.map(([k, v]) => (v === null ? k : `${k}="${encodeAttr(URL_ATTRS[name]?.includes(k.toLowerCase()) || /^(data-)?srcset$|^style$|^action$/i.test(k) ? v : decodeEntities(v))}"`)).join(' ');
    return `<${rawName}${str ? ' ' + str : ''}>${extra}`;
  });

  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, a, css, c) => a + rwCss(css, base) + c);
  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (m) => m + '<meta charset="utf-8">') : '<meta charset="utf-8">' + html;
  return html + reporter(pageUrl, nonce);
}

/** Tells the Rel Zone shell which page the frame is showing (for the address bar). */
function reporter(url, nonce) {
  const js = JSON.stringify(url).replace(/</g, '\\u003c');
  return `<script nonce="${nonce}">(function(){try{parent.postMessage({rz:1,url:${js},title:document.title},'*')}catch(e){}})();</script>`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newNonce = () => crypto.randomBytes(12).toString('base64url');

function errorPage(res, msg, status, url = '') {
  const nonce = newNonce();
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;color:#556;padding:28px;line-height:1.5"><h3>Couldn't load that page</h3><p>${escapeHtml(msg)}</p>${url ? reporter(url, nonce) : ''}</body>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': `sandbox allow-scripts; script-src 'nonce-${nonce}'`,
  });
  res.end(html);
}

function decodeBody(buf, charset) {
  if (!charset) {   // no header: look for <meta charset> near the top
    const m = buf.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i);
    charset = m && m[1];
  }
  try { return new TextDecoder(charset || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) req.destroy(); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

async function proxy(req, res, query) {
  if (limited('proxy', clientIp(req), 300, 60)) return errorPage(res, 'Too many requests. Wait a moment and try again.', 429);
  let method = 'GET', data = null, target;
  let form = query.has('__u') ? query : null;
  if (!form && req.method === 'POST') { const p = new URLSearchParams(await readBody(req)); if (p.has('__u')) form = p; }
  if (form) {   // a form submitted from a proxied page
    target = form.get('__u');
    const fields = new URLSearchParams([...form.entries()].filter(([k]) => k !== '__u'));
    if (req.method === 'POST') { method = 'POST'; data = fields.toString(); }
    else { try { const u = new URL(target); u.search = fields.toString(); target = u.href; } catch { /* reported below */ } }
  } else target = query.get('url') || '';
  target = unwrap(target.trim());
  if (target && !target.includes('://')) target = 'https://' + target;
  if (!target) return errorPage(res, 'No address given.', 400);

  let got;
  try { got = await fetchSafe(method, target, data); }
  catch (e) {
    if (e instanceof UserError || e.code === 'EBLOCKED' || e instanceof TypeError) return errorPage(res, e instanceof TypeError ? 'That address is not valid.' : e.message === 'timeout' ? 'Timed out.' : e.message, 400, target);
    return errorPage(res, "Couldn't reach that site. It may be down or blocking proxies.", 502, target);
  }
  const { res: up, stream, url: final } = got;
  const ct = up.headers['content-type'] || 'application/octet-stream';
  const mime = ct.split(';')[0].trim().toLowerCase();
  const charset = (ct.match(/charset=([\w-]+)/i) || [])[1];
  const nonce = newNonce();
  const headers = {
    'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin',
    // Opaque origin + only our nonce'd script may run, so proxied pages can't touch the hub.
    'Content-Security-Policy': `sandbox allow-scripts allow-forms; script-src 'nonce-${nonce}'`,
  };
  const status = up.statusCode >= 200 && up.statusCode < 600 ? up.statusCode : 200;
  try {
    if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      const out = rewriteHtml(decodeBody(await readLimited(stream, MAX_HTML), charset), final, nonce);
      res.writeHead(status, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(out);
    }
    if (mime === 'text/css') {
      const css = decodeBody(await readLimited(stream, MAX_HTML), charset);
      res.writeHead(status, { ...headers, 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(rwCss(css, final));
    }
  } catch { return errorPage(res, "Couldn't reach that site. It may be down or blocking proxies.", 502, target); }

  res.writeHead(status, { ...headers, 'Content-Type': ct, 'Cache-Control': 'public, max-age=300' });
  let size = 0;
  const cap = new Transform({ transform(chunk, _, cb) { size += chunk.length; if (size > MAX_ASSET) { this.push(null); stream.destroy(); return cb(); } cb(null, chunk); } });
  pipeline(stream, cap, res, () => {});
}

module.exports = { proxy, rewriteHtml, rwCss };
