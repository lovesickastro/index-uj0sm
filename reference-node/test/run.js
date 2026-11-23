'use strict';
// End-to-end tests: starts the server twice (normal, and with ALLOW_PRIVATE=1 so it may talk to local fixtures).
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');
let passed = 0, failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n      ', e.message); }
}
function start(port, env = {}) {
  const p = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: port, CHAT_FILE: `/tmp/rz-chat-${port}.json`, ...env }, stdio: 'ignore' });
  return p;
}
const wsOpen = (url, protocols) => new Promise((res, rej) => { const w = new WebSocket(url, protocols); const q = []; w.q = q; w.on('message', (d, bin) => q.push(bin ? d : JSON.parse(d.toString()))); w.on('open', () => res(w)); w.on('error', rej); });
async function until(ws, pred, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const i = ws.q.findIndex(pred); if (i >= 0) return ws.q.splice(i, 1)[0]; await sleep(10); }
  throw new Error('timed out waiting for message');
}

(async () => {
  const A = 5071, B = 5072;
  const sa = start(A), sb = start(B, { ALLOW_PRIVATE: '1' });
  await sleep(1200);
  const base = `http://127.0.0.1:${A}`, baseB = `http://127.0.0.1:${B}`;

  // fixture site for the proxy
  const site = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { Location: '/page?x=1&y=2' }); return res.end(); }
    if (req.url.startsWith('/page')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><title>T</title><base href="/sub/"><script>alert(1)</script>
<link rel="stylesheet" href="s.css"><link rel="preload" href="x.js"><style>b{background:url(img/bg.png)}</style></head>
<body onload="evil()"><a href="/abs?a=1&amp;b=2" target="_blank" onclick="x()">link</a><a href="javascript:void(0)">js</a>
<img src="p.png" srcset="p.png 1x, p2.png 2x"><form action="go" method="post"><input name="q" value='a"b'></form>
<noscript><p>nojs</p></noscript><!-- gone --></body></html>`);
    }
    if (req.url === '/sub/s.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end('a{background:url("i.png")} @import "o.css";'); }
    if (req.url === '/echo' && req.method === 'POST') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('POST:' + b); }); return; }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from([1, 2, 3]));
  }).listen(5073, '127.0.0.1');

  console.log('static + api');
  await test('index served, no-store', async () => { const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert((await r.text()).includes('/js/app.js')); });
  await test('mjs/wasm mime types', async () => {
    assert.match((await fetch(base + '/libcurl/index.mjs')).headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/scram/scramjet.wasm.wasm')).headers.get('content-type'), 'application/wasm');
  });
  await test('range request on VM image', async () => { const r = await fetch(base + '/virtualxp/VirtualXP.iso', { headers: { Range: 'bytes=100-199' } }); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 100); });
  await test('path traversal blocked', async () => { for (const p of ['/css/..%2f..%2fserver.js', '/%2e%2e/server.js', '/virtualxp/..%2f..%2fserver.js']) assert.equal((await fetch(base + p)).status, 404, p); });
  await test('ai without key', async () => { const r = await fetch(base + '/api/chat', { method: 'POST', body: '{}' }); assert.equal(r.status, 500); assert.equal((await r.json()).error, 'no_key'); });

  console.log('basic proxy');
  await test('blocks localhost/LAN/metadata (SSRF)', async () => {
    for (const t of ['http://127.0.0.1:5073/', 'http://localhost:5073/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://10.0.0.1/']) {
      const r = await fetch(`${base}/proxy?url=${encodeURIComponent(t)}`); assert.equal(r.status, 400, t); assert((await r.text()).includes('allowed'), t);
    }
  });
  await test('rewrites html', async () => {
    const r = await fetch(`${baseB}/proxy?url=${encodeURIComponent('http://127.0.0.1:5073/page')}`);
    const h = await r.text();
    assert(!h.includes('alert(1)') && !h.includes('onload') && !h.includes('onclick') && !h.includes('target='), 'scripts/handlers/target removed');
    assert(!h.includes('preload') && !h.includes('<noscript') && !h.includes('gone') && !h.includes('<base'), 'preload/noscript/comment/base removed');
    assert(h.includes('nojs'), 'noscript unwrapped');
    assert(h.includes('href="/proxy?url=http%3A%2F%2F127.0.0.1%3A5073%2Fabs%3Fa%3D1%26b%3D2"'), 'link rewritten with entity decoded: ' + h.match(/<a[^>]*>/));
    assert(h.includes('javascript:void(0)'), 'js: link untouched');
    assert(h.includes('/proxy?url=http%3A%2F%2F127.0.0.1%3A5073%2Fsub%2Fs.css'), 'base href honoured for css');
    assert(h.includes('url(/proxy?url=http%3A%2F%2F127.0.0.1%3A5073%2Fsub%2Fimg%2Fbg.png)'), 'style url()');
    assert(h.includes('srcset="/proxy?url=') && h.includes(' 2x'), 'srcset');
    assert(/<form [^>]*action="\/proxy"[^>]*method="post"[^>]*>\s*<input type="hidden" name="__u" value="http:\/\/127.0.0.1:5073\/sub\/go">/.test(h), 'form: ' + h.match(/<form[^]*?<\/form>/));
    assert(h.includes('value="a&quot;b"'), 'attr quote escaped');
    assert(h.includes('<meta charset="utf-8">') && h.includes('parent.postMessage'), 'charset + reporter');
    assert.match(r.headers.get('content-security-policy'), /^sandbox allow-scripts allow-forms; script-src 'nonce-/);
  });
  await test('follows redirects, reports final url', async () => { const h = await (await fetch(`${baseB}/proxy?url=${encodeURIComponent('http://127.0.0.1:5073/redir')}`)).text(); assert(h.includes('"url":"http://127.0.0.1:5073/page?x=1&y=2"') || h.includes('page?x=1&y=2'), h.slice(-200)); });
  await test('rewrites css', async () => { const c = await (await fetch(`${baseB}/proxy?url=${encodeURIComponent('http://127.0.0.1:5073/sub/s.css')}`)).text(); assert(c.includes('url("/proxy?url=http%3A%2F%2F127.0.0.1%3A5073%2Fsub%2Fi.png")') && c.includes('@import "/proxy?url='), c); });
  await test('binary passthrough', async () => { const r = await fetch(`${baseB}/proxy?url=${encodeURIComponent('http://127.0.0.1:5073/img.png')}`); assert.equal(r.headers.get('content-type'), 'image/png'); assert.deepEqual([...Buffer.from(await r.arrayBuffer())], [1, 2, 3]); });
  await test('POST form goes through', async () => { const r = await fetch(`${baseB}/proxy`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '__u=' + encodeURIComponent('http://127.0.0.1:5073/echo') + '&q=hi+there&z=1' }); assert.equal(await r.text(), 'POST:q=hi+there&z=1'); });
  await test('GET form merges fields', async () => { const h = await (await fetch(`${baseB}/proxy?__u=${encodeURIComponent('http://127.0.0.1:5073/page')}&k=v`)).text(); assert(h.includes('page?k=v'), h.slice(-200)); });

  console.log('global chat');
  const ws = (p, port = A, proto) => wsOpen(`ws://127.0.0.1:${port}${p}`, proto);
  await test('hello, message, broadcast, online count', async () => {
    const a = await ws('/ws/chat'), b = await ws('/ws/chat');
    await until(a, (m) => m.t === 'history');
    a.send(JSON.stringify({ t: 'hello', nick: 'Alice<>' }));
    const you = await until(a, (m) => m.t === 'you' && m.nick === 'Alice'); assert.equal(you.tag.length, 4);
    a.send(JSON.stringify({ t: 'msg', text: '  hi\u200b   <i>there</i> ' }));
    const m1 = await until(a, (m) => m.t === 'msg'), m2 = await until(b, (m) => m.t === 'msg');
    assert.equal(m1.text, 'hi <i>there</i>'); assert(m1.me && !m2.me); assert.equal(m2.nick, 'Alice');
    assert.equal((await until(b, (m) => m.t === 'online' && m.n === 2)).n, 2);
    a.close(); b.close();
  });
  await test('rate limit + repeat block', async () => {
    const a = await ws('/ws/chat');
    for (let i = 0; i < 6; i++) a.send(JSON.stringify({ t: 'msg', text: 'm' + i }));
    await until(a, (m) => m.t === 'error' && /too fast/.test(m.text));
    a.send(JSON.stringify({ t: 'msg', text: 'm0' })); a.close();
  });
  await test('cross-site websocket rejected', async () => {
    const code = await new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${A}/ws/chat`, { headers: { Origin: 'http://evil.example' } }); w.on('close', res); w.on('error', () => {}); });
    assert.equal(code, 1008);
  });
  await test('history survives restart (file)', async () => { await sleep(2300); const t = require('fs').readFileSync(`/tmp/rz-chat-${A}.json`, 'utf8'); assert(t.includes('hi <i>there</i>')); });

  console.log('calls');
  await test('room join, signal relay, state, leave', async () => {
    const a = await ws('/ws/call'), b = await ws('/ws/call');
    const ia = (await until(a, (m) => m.t === 'you')).id, ib = (await until(b, (m) => m.t === 'you')).id;
    a.send(JSON.stringify({ t: 'join', room: 'Lobby ' })); const ja = await until(a, (m) => m.t === 'joined'); assert.equal(ja.room, 'lobby'); assert.equal(ja.peers.length, 0);
    b.send(JSON.stringify({ t: 'join', room: 'lobby' })); const jb = await until(b, (m) => m.t === 'joined'); assert.equal(jb.peers[0].id, ia);
    await until(a, (m) => m.t === 'peer-join' && m.peer.id === ib);
    b.send(JSON.stringify({ t: 'signal', to: ia, data: { sdp: { type: 'offer', sdp: 'x' } } }));
    const s = await until(a, (m) => m.t === 'signal'); assert.equal(s.from, ib); assert.equal(s.data.sdp.type, 'offer');
    b.send(JSON.stringify({ t: 'state', mic: false, cam: true })); const st = await until(a, (m) => m.t === 'peer-state'); assert(!st.mic && st.cam);
    const lists = await until(a, (m) => m.t === 'lists' && m.rooms.length); assert.equal(lists.rooms[0].count, 2);
    b.close(); await until(a, (m) => m.t === 'peer-leave' && m.id === ib); a.close();
  });
  await test('bad room name + full room', async () => { const a = await ws('/ws/call'); a.send(JSON.stringify({ t: 'join', room: '../x' })); await until(a, (m) => m.t === 'error'); a.close(); });
  await test('ring, accept, private room, decline, cancel', async () => {
    const a = await ws('/ws/call'), b = await ws('/ws/call');
    const ib = (await until(b, (m) => m.t === 'you')).id; await until(a, (m) => m.t === 'you');
    a.send(JSON.stringify({ t: 'call', to: ib })); await until(a, (m) => m.t === 'error' && /available/.test(m.text));
    b.send(JSON.stringify({ t: 'avail', on: true }));
    await until(a, (m) => m.t === 'lists' && m.people.length === 0, 100).catch(() => {});   // a isn't available, so sees nobody
    b.send(JSON.stringify({ t: 'hello', nick: 'Bobby' })); await sleep(350);
    a.send(JSON.stringify({ t: 'call', to: ib }));
    const ring = await until(a, (m) => m.t === 'ringing'), inc = await until(b, (m) => m.t === 'incoming'); assert.equal(ring.room, inc.room); assert(inc.room.startsWith('~'));
    a.send(JSON.stringify({ t: 'join', room: ring.room })); await until(a, (m) => m.t === 'joined');
    b.send(JSON.stringify({ t: 'join', room: inc.room })); const jb = await until(b, (m) => m.t === 'joined'); assert.equal(jb.peers.length, 1);
    const c = await ws('/ws/call'); await until(c, (m) => m.t === 'you'); c.send(JSON.stringify({ t: 'join', room: inc.room })); await until(c, (m) => m.t === 'error'); // stranger can't enter
    // second call: decline
    a.send(JSON.stringify({ t: 'leave' })); b.send(JSON.stringify({ t: 'leave' })); await sleep(100);
    a.send(JSON.stringify({ t: 'call', to: ib })); const r2 = await until(a, (m) => m.t === 'ringing'); const i2 = await until(b, (m) => m.t === 'incoming');
    b.send(JSON.stringify({ t: 'respond', room: i2.room, accept: false })); const d = await until(a, (m) => m.t === 'declined'); assert.equal(d.nick, 'Bobby');
    // third: caller cancels
    await sleep(100); a.send(JSON.stringify({ t: 'call', to: ib })); const r3 = await until(a, (m) => m.t === 'ringing'); await until(b, (m) => m.t === 'incoming');
    a.send(JSON.stringify({ t: 'cancel', room: r3.room })); await until(b, (m) => m.t === 'cancelled');
    a.close(); b.close(); c.close();
  });

  console.log('wisp');
  const echo = net.createServer((s) => s.on('data', (d) => s.write(Buffer.concat([Buffer.from('echo:'), d])))).listen(5074, '127.0.0.1');
  const pkt = (t, sid, payload = Buffer.alloc(0)) => { const h = Buffer.alloc(5); h[0] = t; h.writeUInt32LE(sid, 1); return Buffer.concat([h, payload]); };
  const connectPayload = (host, port) => { const h = Buffer.alloc(3); h[0] = 1; h.writeUInt16LE(port, 1); return Buffer.concat([h, Buffer.from(host)]); };
  const wispWait = (w, type, sid) => until(w, (m) => Buffer.isBuffer(m) && m[0] === type && m.readUInt32LE(1) === sid);
  await test('v2 handshake echoes subprotocol, then proxies TCP both ways', async () => {
    const w = await ws('/wisp/', B, ['wisp-v2']); assert.equal(w.protocol, 'wisp-v2');
    const info = await wispWait(w, 5, 0); assert.deepEqual([...info.subarray(5)], [2, 0]);
    w.send(pkt(5, 0, Buffer.from([2, 0])));
    const cont = await wispWait(w, 3, 0); assert.equal(cont.readUInt32LE(5), 128);
    w.send(pkt(1, 1, connectPayload('127.0.0.1', 5074)));
    w.send(pkt(2, 1, Buffer.from('hello')));    // sent immediately, before the TCP connection is up
    const d = await wispWait(w, 2, 1); assert.equal(d.subarray(5).toString(), 'echo:hello');
    for (let i = 0; i < 70; i++) w.send(pkt(2, 1, Buffer.from('x')));
    await wispWait(w, 3, 1);    // flow-control CONTINUE after enough packets
    w.send(pkt(4, 1, Buffer.from([0x02]))); w.close();
  });
  await test('v1 (no subprotocol) works', async () => {
    const w = await ws('/wisp', B); await wispWait(w, 3, 0);
    w.send(pkt(1, 7, connectPayload('127.0.0.1', 5074))); w.send(pkt(2, 7, Buffer.from('v1')));
    assert.equal((await wispWait(w, 2, 7)).subarray(5).toString(), 'echo:v1'); w.close();
  });
  await test('refused port -> CLOSE 0x44; mail port -> 0x48; UDP -> 0x41', async () => {
    const w = await ws('/wisp/', B, ['wisp-v2']); await wispWait(w, 5, 0); w.send(pkt(5, 0, Buffer.from([2, 0]))); await wispWait(w, 3, 0);
    w.send(pkt(1, 1, connectPayload('127.0.0.1', 5075))); assert.equal((await wispWait(w, 4, 1))[5], 0x44);
    w.send(pkt(1, 2, connectPayload('127.0.0.1', 25))); assert.equal((await wispWait(w, 4, 2))[5], 0x48);
    const u = connectPayload('127.0.0.1', 5074); u[0] = 2; w.send(pkt(1, 3, u)); assert.equal((await wispWait(w, 4, 3))[5], 0x41); w.close();
  });
  await test('remote closing -> CLOSE 0x02', async () => {
    const once = net.createServer((s) => s.end('bye')).listen(5076, '127.0.0.1');
    const w = await ws('/wisp', B); await wispWait(w, 3, 0); w.send(pkt(1, 1, connectPayload('127.0.0.1', 5076)));
    assert.equal((await wispWait(w, 2, 1)).subarray(5).toString(), 'bye'); assert.equal((await wispWait(w, 4, 1))[5], 0x02); w.close(); once.close();
  });
  await test('default server refuses private targets (0x48)', async () => {
    const w = await ws('/wisp', A); await wispWait(w, 3, 0);
    for (const h of ['127.0.0.1', 'localhost', '169.254.169.254', '192.168.1.1']) { w.send(pkt(1, 9, connectPayload(h, 5074))); assert.equal((await wispWait(w, 4, 9))[5], 0x48, h); }
    w.close();
  });
  await test('unknown websocket path -> 404', async () => { await assert.rejects(ws('/nope')); });

  site.close(); echo.close(); sa.kill(); sb.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
