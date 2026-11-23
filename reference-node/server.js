'use strict';
/*
 * Rel Zone (Node.js): static site + in-browser web proxy (Scramjet, via a built-in Wisp server)
 * + Groq AI chat + global chat + voice/video call signalling + VirtualXP.
 *
 * Run:  npm install && npm start   ->  http://127.0.0.1:5000
 */
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

require('./src/env').loadEnv();
const { clientIp } = require('./src/netutil');
const ai = require('./src/ai');
const { proxy } = require('./src/proxy');
const { handleWisp } = require('./src/wisp');
const { handleChat } = require('./src/chat');
const { handleCalls } = require('./src/calls');
const { serve } = require('./src/static');

const VERSION = '9-virtualxp-node';
const PUBLIC = path.join(__dirname, 'public');
const VENDOR = path.join(__dirname, 'vendor');
// Proxy engine files (Scramjet, bare-mux, libcurl transport) and VirtualXP, shipped in ./vendor
const MOUNTS = { scram: 'scram', baremux: 'baremux', libcurl: 'libcurl', virtualxp: 'virtualxp' };
const ISOLATE = process.env.ISOLATE === '1';
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';

const notFound = (res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };

const server = http.createServer(async (req, res) => {
  try {
    // OFF by default. Cross-origin isolation can blank proxied pages in some browsers.
    if (ISOLATE) { res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); }
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/api/ice' && req.method === 'GET') return ai.ice(req, res);
    if (p === '/api/health' && req.method === 'GET') return await ai.health(req, res);
    if (p === '/api/chat' && req.method === 'POST') return await ai.chat(req, res);
    if (p === '/proxy' && (req.method === 'GET' || req.method === 'POST')) return await proxy(req, res, url.searchParams);

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }

    const top = p.split('/')[1];
    if (MOUNTS[top]) {
      const ok = await serve(req, res, path.join(VENDOR, MOUNTS[top]), p.slice(top.length + 2), { 'Cache-Control': 'no-cache' });
      return ok ? undefined : notFound(res);
    }
    if (p === '/' || p === '/index.html') {
      return (await serve(req, res, PUBLIC, 'index.html', { 'Cache-Control': 'no-store' })) ? undefined : notFound(res);   // never serve a stale page
    }
    if (p === '/sw.js') {
      return (await serve(req, res, PUBLIC, 'sw.js', { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' })) ? undefined : notFound(res);
    }
    const cache = p.startsWith('/memes/') ? { 'Cache-Control': 'public, max-age=3600' } : { 'Cache-Control': 'no-cache' };
    if (!(await serve(req, res, PUBLIC, p.slice(1), cache))) notFound(res);
  } catch (e) {
    console.error('request error:', e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error'); } else res.destroy();
  }
});

// ---------------------------------------------------------------- websockets: /wisp/, /ws/chat, /ws/call
const wisp = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, handleProtocols: (set) => set.values().next().value });   // browsers drop the socket unless an offered protocol is echoed
const chat = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const calls = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '');
  const target = p === '/wisp' ? [wisp, (ws) => handleWisp(ws, clientIp(req), { allowPrivate: ALLOW_PRIVATE })]
    : p === '/ws/chat' ? [chat, (ws) => handleChat(ws, req)]
    : p === '/ws/call' ? [calls, (ws) => handleCalls(ws, req)] : null;
  if (!target) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
  socket.on('error', () => {});
  target[0].handleUpgrade(req, socket, head, target[1]);
});
server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '5000', 10);
server.listen(PORT, HOST, () => {
  if (!process.env.GROQ_API_KEY) console.log("! GROQ_API_KEY isn't set, so Rel AI won't work. Put it in .env");
  else console.log('Groq key loaded.');
  console.log(`Rel Zone v${VERSION} running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}   (AI check: /api/health)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
