// bare-mux transport that tunnels through this site's own Worker (/bare/*) using fetch().
// Works for sites on Cloudflare, which the raw-TCP Wisp transport cannot reach.
const CHUNK = 3000, NO_BODY = [101, 204, 205, 304];

function flatten(headers) {
  const out = {}; if (!headers) return out;
  const each = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [k, v] of each) out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  return out;
}

export default class RzFetchTransport {
  ready = false;
  constructor(opts) { this.base = ((opts && opts.base) || '/bare/').replace(/\/?$/, '/'); }
  async init() { this.ready = true; }
  async meta() {}

  async request(remote, method, body, headers, signal) {
    let payload = null;
    if (body != null && !['GET', 'HEAD'].includes(method)) payload = body instanceof ReadableStream ? await new Response(body).arrayBuffer() : body;
    const enc = encodeURIComponent(JSON.stringify(flatten(headers))), parts = enc.match(new RegExp('.{1,' + CHUNK + '}', 'g')) || [];
    const h = { 'x-rz-url': remote.href, 'x-rz-method': method, 'x-rz-hn': String(parts.length) };
    parts.forEach((p, i) => { h['x-rz-h' + i] = p; });
    const r = await fetch(this.base + 'request', { method: 'POST', headers: h, body: payload, signal, cache: 'no-store' });
    const err = r.headers.get('x-rz-error');
    if (err) throw new Error(decodeURIComponent(err));
    if (!r.headers.has('x-rz-status')) throw new Error('Proxy server returned an unexpected reply (HTTP ' + r.status + ')');
    const status = Number(r.headers.get('x-rz-status')), n = Number(r.headers.get('x-rz-rhn') || 0);
    let s = ''; for (let i = 0; i < n; i++) s += r.headers.get('x-rz-rh' + i) || '';
    const pairs = s ? JSON.parse(decodeURIComponent(s)) : [], respheaders = {};
    for (const [k, v] of pairs) (respheaders[k] = respheaders[k] || []).push(v);
    return { body: NO_BODY.includes(status) ? null : r.body, headers: respheaders, status, statusText: decodeURIComponent(r.headers.get('x-rz-statustext') || '') };
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
    const wsBase = self.location.origin.replace(/^http/, 'ws') + this.base + 'ws';
    const q = new URLSearchParams({ u: url.href, h: JSON.stringify(flatten(requestHeaders)) });
    const ws = new WebSocket(wsBase + '?' + q, protocols && protocols.length ? protocols : undefined);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => onopen(ws.protocol);
    ws.onmessage = e => onmessage(e.data);
    ws.onclose = e => onclose(e.code, e.reason);
    ws.onerror = () => onerror('WebSocket connection failed');
    return [data => ws.send(data), (code, reason) => ws.close(code, reason)];
  }
}
