// Fetch-based proxy transport for Scramjet. Unlike Wisp (raw TCP), fetch() can reach sites hosted on Cloudflare.
//   POST /bare/request  -> one HTTP request through the Worker
//   GET  /bare/ws       -> WebSocket (Upgrade) relayed to the target
const DROP_REQ = /^(host|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|accept-encoding|expect|proxy-.*|cf-.*|x-forwarded-.*|x-real-ip|x-rz-.*|sec-websocket-.*)$/i;
const DROP_RES = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive)$/i;
const CHUNK = 3000;

const isPublicV4 = s => {
  const p = s.split('.').map(Number); if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
};

export function validBareTarget(raw, allowLocal = false) {
  let u; try { u = new URL(raw || ''); } catch { return null; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) || u.username || u.password) return null;
  if (allowLocal) return u;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h) || h.includes(':') || h.startsWith('[') || !h.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && !isPublicV4(h)) return null;
  return u;
}

function readHeaderMap(h, prefix) {
  const n = Number(h.get(prefix + 'n') || 0); let s = '';
  for (let i = 0; i < n && i < 40; i++) s += h.get(prefix + i) || '';
  try { return JSON.parse(decodeURIComponent(s)); } catch { return null; }
}
function writeHeaderMap(out, prefix, value) {
  const enc = encodeURIComponent(JSON.stringify(value)), parts = enc.match(new RegExp('.{1,' + CHUNK + '}', 'g')) || [];
  parts.forEach((p, i) => out.set(prefix + i, p)); out.set(prefix + 'n', String(parts.length));
}
const fail = (msg, status = 502) => new Response(null, { status, headers: { 'x-rz-error': encodeURIComponent(String(msg).slice(0, 300)), 'Cache-Control': 'no-store' } });

export async function bareRequest(request, env, limited, ip) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  if (limited('bare', ip, 3000, 60)) return fail('Too many requests, slow down.', 429);
  const target = validBareTarget(request.headers.get('x-rz-url'), env.RZ_ALLOW_LOCAL === '1');
  if (!target || !/^https?:$/.test(target.protocol)) return fail('That address is not allowed.', 400);
  const method = (request.headers.get('x-rz-method') || 'GET').toUpperCase();
  const given = readHeaderMap(request.headers, 'x-rz-h') || {};
  const headers = new Headers();
  for (const [k, v] of Object.entries(given)) { if (DROP_REQ.test(k)) continue; try { headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)); } catch {} }
  let upstream;
  try {
    upstream = await fetch(target.href, { method, headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(method) ? undefined : request.body });
  } catch (e) { return fail('Could not reach ' + target.hostname + ': ' + (e?.message || e)); }
  const pairs = [];
  upstream.headers.forEach((v, k) => { if (k !== 'set-cookie' && !DROP_RES.test(k)) pairs.push([k, v]); });
  for (const c of upstream.headers.getSetCookie?.() || []) pairs.push(['set-cookie', c]);
  const out = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream', 'x-rz-status': String(upstream.status), 'x-rz-statustext': encodeURIComponent(upstream.statusText || '') });
  writeHeaderMap(out, 'x-rz-rh', pairs);
  return new Response([101, 204, 205, 304].includes(upstream.status) ? null : upstream.body, { status: 200, headers: out });
}

const safeClose = c => (c >= 1000 && c <= 4999 && ![1004, 1005, 1006, 1015].includes(c)) ? c : 1000;

export async function bareWebSocket(request, env, limited, ip) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  if (limited('barews', ip, 300, 60)) return new Response('Too many requests', { status: 429 });
  const q = new URL(request.url).searchParams, target = validBareTarget(q.get('u'), env.RZ_ALLOW_LOCAL === '1');
  if (!target || !/^wss?:$/.test(target.protocol)) return new Response('That address is not allowed.', { status: 400 });
  let given = {}; try { given = JSON.parse(q.get('h') || '{}') || {}; } catch {}
  const headers = new Headers();
  for (const [k, v] of Object.entries(given)) { if (DROP_REQ.test(k) || /^(accept-language|cache-control|pragma|accept)$/i.test(k)) continue; try { headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)); } catch {} }
  headers.set('Upgrade', 'websocket');
  const protos = request.headers.get('Sec-WebSocket-Protocol'); if (protos) headers.set('Sec-WebSocket-Protocol', protos);
  let resp;
  try { resp = await fetch(target.href.replace(/^ws/, 'http'), { headers }); } catch (e) { return new Response('Could not connect: ' + (e?.message || e), { status: 502 }); }
  const up = resp.webSocket; if (!up) return new Response('The site refused the WebSocket (HTTP ' + resp.status + ')', { status: 502 });
  up.accept();
  const { 0: client, 1: server } = new WebSocketPair(); server.accept();
  let done = false;
  const end = (code, reason) => { if (done) return; done = true; try { up.close(safeClose(code), String(reason || '').slice(0, 100)); } catch {} try { server.close(safeClose(code), String(reason || '').slice(0, 100)); } catch {} };
  server.addEventListener('message', e => { try { up.send(e.data); } catch { end(1011, 'send failed'); } });
  up.addEventListener('message', e => { try { server.send(e.data); } catch { end(1011, 'send failed'); } });
  server.addEventListener('close', e => end(e.code, e.reason)); up.addEventListener('close', e => end(e.code, e.reason));
  server.addEventListener('error', () => end(1011, 'error')); up.addEventListener('error', () => end(1011, 'error'));
  const selected = resp.headers.get('Sec-WebSocket-Protocol');
  return new Response(null, { status: 101, webSocket: client, headers: selected ? { 'Sec-WebSocket-Protocol': selected } : {} });
}
