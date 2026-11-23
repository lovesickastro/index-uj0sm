import { connect } from 'cloudflare:sockets';

const CONNECT = 1, DATA = 2, CONTINUE = 3, CLOSE = 4, INFO = 5;
const MAX_STREAMS = 256, MAX_PER_IP = 12, BUFFER = 128;
const BLOCKED_PORTS = new Set([25, 465, 587]);
const activeByIp = new Map();
const u32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const packet = (type, sid, payload = new Uint8Array()) => { const out = new Uint8Array(5 + payload.length); out[0] = type; new DataView(out.buffer).setUint32(1, sid, true); out.set(payload, 5); return out; };
const isPublicV4 = s => {
  const p = s.split('.').map(Number); if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a,b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0)) return false;
  return true;
};
const isPublicIp = s => s.includes('.') ? isPublicV4(s) : (/^[23]/i.test(s) && !/^2001:(?:0|db8|10):/i.test(s) && !/^3fff:/i.test(s));
async function resolvePublic(host) {
  if (/^[0-9.]+$/.test(host) || host.includes(':')) return isPublicIp(host) ? [host] : [];
  const out = [];
  for (const type of ['A','AAAA']) {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
      const j = await r.json(); for (const a of j.Answer || []) if (a.type === (type === 'A' ? 1 : 28) && isPublicIp(a.data)) out.push(a.data);
    } catch {}
  }
  return [...new Set(out)].slice(0, 4);
}

export function handleWisp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if ((activeByIp.get(ip) || 0) >= MAX_PER_IP) return new Response('Too many Wisp connections', { status: 429 });
  activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1);
  const pair = new WebSocketPair(), client = pair[0], ws = pair[1]; ws.accept();
  const protocols = request.headers.get('Sec-WebSocket-Protocol') || '';
  const v2 = protocols.split(',').map(s => s.trim()).includes('wisp-v2');
  const streams = new Map(); let closed = false, awaitingInfo = false;
  const send = (type, sid, payload) => { if (!closed && ws.readyState === 1) { try { ws.send(packet(type, sid, payload)); } catch { closeAll(); } } };
  const closeStream = (sid, reason = null) => {
    const s = streams.get(sid); if (!s) return; streams.delete(sid); s.closed = true;
    try { s.reader?.cancel(); } catch {} try { s.writer?.abort(); } catch {} try { s.socket?.close(); } catch {}
    if (reason !== null) send(CLOSE, sid, new Uint8Array([reason]));
  };
  const closeAll = () => { if (closed) return; closed = true; for (const id of [...streams.keys()]) closeStream(id); const n = (activeByIp.get(ip) || 1) - 1; n ? activeByIp.set(ip,n) : activeByIp.delete(ip); try { ws.close(); } catch {} };
  const openStream = async (sid, host, port) => {
    if (!host || !port || port > 65535 || BLOCKED_PORTS.has(port)) return send(CLOSE, sid, new Uint8Array([0x48]));
    const addrs = await resolvePublic(host); if (!addrs.length) return closeStream(sid, 0x48);
    let socket = null, last = 0x42;
    for (const address of addrs) {
      try { socket = connect({ hostname: address, port }, { secureTransport: 'off', allowHalfOpen: false }); await socket.opened; break; }
      catch (e) { last = e?.code === 'ECONNREFUSED' ? 0x44 : 0x42; try { socket?.close(); } catch {} socket = null; }
    }
    const st = streams.get(sid); if (!socket || !st || st.closed || closed) { try { socket?.close(); } catch {} if (st) closeStream(sid, last); return; }
    st.socket = socket; st.writer = socket.writable.getWriter(); st.reader = socket.readable.getReader();
    (async () => { try { while (!st.closed) { const { value, done } = await st.reader.read(); if (done) break; if (value?.length) { while (!st.closed && ws.readyState === 1 && ws.bufferedAmount > (1 << 20)) await new Promise(r => setTimeout(r, 20)); if (!st.closed) send(DATA, sid, value); } } closeStream(sid, 0x02); } catch { closeStream(sid, 0x03); } })();
    if (st.backlog.length) { const q = st.backlog.splice(0); for (const b of q) { try { await writeToStream(st, b); } catch { closeStream(sid,0x03); break; } } }
  };
  const writeToStream = async (st, data) => { await st.writer.write(data); st.consumed = (st.consumed || 0) + 1; if (st.consumed >= 64) { st.consumed = 0; const pending = st.backlog?.length || 0; send(CONTINUE, st.sid, u32(Math.max(0, BUFFER - pending))); } };
  const handle = async bytes => {
    if (bytes.length < 5) return;
    const type = bytes[0], sid = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true), payload = bytes.subarray(5);
    if (type === CONNECT) {
      if (!sid || streams.has(sid)) return send(CLOSE, sid, new Uint8Array([0x41]));
      if (streams.size >= MAX_STREAMS) return send(CLOSE, sid, new Uint8Array([0x49]));
      if (payload.length < 4 || payload[0] !== 1) return send(CLOSE, sid, new Uint8Array([0x41]));
      const port = payload[1] | (payload[2] << 8), host = new TextDecoder().decode(payload.subarray(3));
      const st = { sid, socket: null, writer: null, reader: null, backlog: [], closed: false, consumed: 0 }; streams.set(sid, st); openStream(sid, host, port);
    } else if (type === DATA) {
      const st = streams.get(sid); if (!st) return;
      if (!st.writer) { st.backlog.push(payload.slice()); if (st.backlog.reduce((n,x)=>n+x.length,0) > 1<<20) closeStream(sid,0x49); }
      else { try { await writeToStream(st, payload); } catch { closeStream(sid,0x03); } }
    } else if (type === CLOSE) closeStream(sid);
    else if (type === CONTINUE) { /* flow-control acknowledgement; browser controls its send rate */ }
  };
  ws.addEventListener('message', async ev => { try { const b = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data instanceof Blob ? new Uint8Array(await ev.data.arrayBuffer()) : null; if (!b) return; if (awaitingInfo) { awaitingInfo = false; send(CONTINUE,0,u32(BUFFER)); if (b[0] === INFO) return; } await handle(b); } catch {} });
  ws.addEventListener('close', closeAll); ws.addEventListener('error', closeAll);
  if (v2) { send(INFO, 0, new Uint8Array([2,0])); awaitingInfo = true; } else send(CONTINUE, 0, u32(BUFFER));
  const headers = v2 ? { 'Sec-WebSocket-Protocol': 'wisp-v2' } : {};
  return new Response(null, { status: 101, webSocket: client, headers });
}
