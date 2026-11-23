# Rel Zone — Cloudflare Workers edition

This is a Cloudflare Workers adaptation of the uploaded Rel Zone Node.js project. The original frontend and vendor assets are carried over without a redesign. The original Node.js server/modules and original end-to-end test file are also retained in `reference-node/` for comparison and rollback; they are not part of the Cloudflare deployment entrypoint. The application remains JavaScript; this edition replaces the Node HTTP/WebSocket server runtime with Cloudflare Workers, a Durable Object for realtime features, Workers TCP sockets for Wisp, and browser IndexedDB for each visitor’s VirtualXP ISO.

## Preserved application features

- Original `public/` frontend, CSS, browser JavaScript, service worker and meme soundboard assets.
- Original Scramjet, bare-mux and libcurl vendor files and their URL paths.
- Full Scramjet proxy. The browser tunnels through the Worker's own `/bare/request` (HTTP) and `/bare/ws` (WebSocket) endpoints, which use `fetch()`, so sites hosted on Cloudflare work. The older Wisp TCP endpoint (`/wisp/`) is still present but unused, because Workers cannot open TCP sockets to Cloudflare IP ranges.
- Basic `/proxy` fallback with redirects, HTML/CSS URL rewriting, forms and binary pass-through.
- Rel AI (`/api/chat`) with Groq streaming, model fallback, `/api/health`, and `/api/ice`.
- Global chat at `/ws/chat`, including nicknames, IP-derived tags, message history, anti-spam limits and online counts. History and tag salt persist in Durable Object storage.
- WebRTC call signaling at `/ws/call`: public rooms, peer state, available-for-calls lists, direct ringing, accept/decline/cancel/missed-call messages and signaling relay.
- VirtualXP frontend/runtime files. Each visitor downloads `VirtualXP.iso` from the configured pCloud share, uploads it once, and the browser stores it in IndexedDB for later sessions. The ISO is never included in the Worker deployment bundle.
- Existing browser UI, games, soundboard, piano and settings remain as supplied in the source archive.

## Requirements

- A Cloudflare account with Workers and Durable Objects enabled. R2 is not required.
- Node.js 18+ and npm for local tooling.
- A Groq API key if Rel AI should work.
- `wrangler` login for deployment.

## Setup

1. Install dependencies:

   ```sh
   npm install
   npx wrangler login
   ```

2. Set the Groq key as a Worker secret (never put it in the frontend):

   ```sh
   npx wrangler secret put GROQ_API_KEY
   ```

3. Test locally and deploy:

   ```sh
   npm run dev
   npm run check
   npm run deploy
   ```

`wrangler.toml` binds the static assets and the `RealtimeHub` Durable Object. The Durable Object migration is included; no R2 bucket or ISO upload is needed.

## Configuration

Edit `[vars]` in `wrangler.toml` for `GROQ_MODEL` and `RING_SECONDS`. Set optional secrets/vars with Wrangler as needed:

- `GROQ_API_KEY` — required for Rel AI.
- `GROQ_URL` — optional OpenAI-compatible API URL (default Groq endpoint).
- `GROQ_MODEL` — optional primary model (default `openai/gpt-oss-120b`).
- `CHAT_FILTER_API` — Groq API key used by the global chat filter (set with `npx wrangler secret put CHAT_FILTER_API`). Every chat message is classified by AI before it is sent; flagged messages are dropped and the sender is muted for 5 minutes (by IP, persisted). If the key is missing or the check fails, messages are blocked (with the reason shown in chat) unless `CHAT_FILTER_FAIL_OPEN = "1"` is set in `[vars]`. Optional: `CHAT_FILTER_MODEL` (default `llama-3.1-8b-instant`), `CHAT_FILTER_URL`.
- `ICE_SERVERS` — optional JSON array of STUN/TURN configuration.
- `RING_SECONDS` — direct-call ring timeout in seconds.

## Important platform notes

- **Wisp/TCP:** the Wisp endpoint uses `cloudflare:sockets` to make outbound TCP connections to public destinations after DNS-over-HTTPS checks. Cloudflare's network/runtime can restrict destinations or ports, and this is not an inbound TCP server. If the account/runtime does not permit a destination, that Wisp stream will fail. The Wisp feature is implemented rather than removed; test the exact Scramjet destinations you use after deployment.
- **Basic proxy DNS safety:** it checks DNS answers against private/reserved address ranges before fetching and validates each redirect. Because Workers' standard `fetch()` performs its own DNS resolution, this is not as strong as the Node version's custom pinned DNS lookup against the exact socket connection. Do not expose an unrestricted public proxy without authentication/abuse controls.
- **Realtime scaling:** one Durable Object instance per global chat and calls hub preserves the original single-global-room semantics. Durable Objects serialize state changes. High traffic may require deliberate sharding, which would change the current global-room topology.
- **VirtualXP ISO:** users download the ISO from the pCloud link shown in the VM setup screen, then upload it into Rel Zone. It is stored in that browser’s IndexedDB and is not sent to the server. Clearing site data, using a different browser, or changing devices requires uploading it again. IndexedDB quota varies by browser/device. Do not publish or redistribute Microsoft Windows XP installation media unless you have the necessary rights. The VirtualXP author's own redistribution terms also need to be checked.
- **Static assets:** all supplied frontend and vendor assets are in `assets/`. The large ISO is excluded from the deployment bundle and kept locally by each user in IndexedDB, avoiding Worker asset-size limits and server-side ISO storage.

## Smoke checks

`npm test` checks core URL rewriting and static project assumptions. It is not a substitute for deployment tests of browser WebSockets, Cloudflare TCP sockets, Groq, browser IndexedDB ISO persistence, or the full Scramjet proxy against real websites.
