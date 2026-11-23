# Rel Zone (Node.js)

A Node.js remake of Rel Zone: front end in plain HTML / CSS / JavaScript, back end in Node.js.
Same features and the same front-end/back-end protocol as the Python version.

    npm install        # installs one dependency: ws
    cp .env.example .env   # then put your Groq key in it
    npm start          # http://localhost:5000

Needs Node 18 or newer. `npm test` runs the end-to-end tests (chat, calls, Wisp, proxy, SSRF checks).

## Layout
    server.js          HTTP server + websocket routing (/wisp/, /ws/chat, /ws/call)
    src/ai.js          Rel AI (/api/chat streams Groq, /api/health, /api/ice)
    src/proxy.js       basic proxy (/proxy): rewrites pages, blocks private addresses
    src/wisp.js        Wisp server (TCP over WebSocket) for the full Scramjet proxy
    src/chat.js        global chat room (history saved to chat_history.json)
    src/calls.js       call signalling: rooms, ringing, WebRTC relay
    src/netutil.js     public-address check, client IP, same-site check, rate limits
    src/static.js      static files with Range support (for the 45 MB VM image)
    public/            index.html, css/style.css, js/app.js, sw.js, memes/
    vendor/            Scramjet, bare-mux, libcurl transport, VirtualXP (unchanged)
    test/run.js        end-to-end tests

## What works the same as before
* **Full proxy** (Scramjet + built-in Wisp at `/wisp/`) needs a secure context: `http://localhost:5000` or https.
  On plain `http://` at another address the site falls back to the **basic proxy** (no JavaScript, so games won't run).
* **Global chat, calls, VM tab, soundboard, piano, settings**: unchanged.
* Put the Groq key in `.env` as `GROQ_API_KEY=...` (server-side only).

## Environment variables
`HOST` (`0.0.0.0` for other devices), `PORT`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_URL`, `WISP_DEBUG=1`,
`ISOLATE=1`, `CHAT_FILE`, `ICE_SERVERS` (JSON list, add TURN here), `RING_SECONDS`,
`TRUST_PROXY=1` (behind Cloudflare/nginx/a tunnel), `ALLOW_PRIVATE=1` (local testing only: lets the proxies reach private addresses).

## Differences from the Python version
* One runtime dependency (`ws`). No Express/Cheerio: routing, static files and the basic proxy's HTML rewriting use Node built-ins.
* The basic proxy checks the address at connection time (custom DNS lookup), so redirects and DNS tricks can't reach localhost or your LAN.
* Remote sockets are paused when the browser can't keep up (Wisp back-pressure).

## Safety
The proxy fetches pages for anyone who can reach the server. Keep it on your own machine, or put a login in front of it
before exposing it to the internet. Scramjet, bare-mux and libcurl are AGPL-3.0; VirtualXP came without a license file,
so check the author's terms before hosting publicly (see `vendor/virtualxp/ABOUT-REL-ZONE.txt`).
