'use strict';
// Rel AI: a thin, server-side client for Groq's OpenAI-compatible API. The key never reaches the browser.
const { Readable } = require('stream');
const { clientIp, limited } = require('./netutil');

const SYS = 'You are Rel AI, a friendly, concise assistant inside a site called Rel Zone. ' +
  'Help with questions, homework, writing and brainstorming. Show your reasoning on math. ' +
  'Use plain text, no markdown tables.';
// If the first model is retired/unavailable, the server tries these in order.
const FALLBACK_MODELS = ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const working = { model: null };

const cfg = () => ({
  key: process.env.GROQ_API_KEY || '',
  url: process.env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions',
  model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
});

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

async function errorDetail(r) {
  const text = await r.text().catch(() => '');
  try { const j = JSON.parse(text); return (j.error && j.error.message) || text.slice(0, 200); } catch { return text.slice(0, 200); }
}

function modelMissing(status, detail) {
  const d = (detail || '').toLowerCase();
  return (status === 400 || status === 404) && d.includes('model') &&
    ['does not exist', 'decommission', 'no access', 'not have access', 'deprecated', 'not found'].some((w) => d.includes(w));
}

/** Call Groq, falling back to other models if one has been retired. Resolves { res, model } or { status, detail }. */
async function groqCall(messages, stream, maxTokens, abort) {
  const { key, url, model: primary } = cfg();
  const seen = new Set();
  let last = null;
  for (const model of [working.model, primary, ...FALLBACK_MODELS]) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const body = { model, messages, stream, max_tokens: maxTokens };
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';   // reasoning tokens count toward max_tokens
    else body.temperature = 0.7;
    const wait = setTimeout(() => abort.abort(), 20000);                    // time allowed to start answering
    let r;
    try {
      r = await fetch(url, {
        method: 'POST', signal: abort.signal, body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      });
    } finally { clearTimeout(wait); }
    if (r.ok) {
      if (working.model !== model) console.log('Using Groq model:', model);
      working.model = model;
      return { res: r, model };
    }
    const detail = await errorDetail(r);
    last = { status: r.status, detail };
    if (modelMissing(r.status, detail)) { console.log(`! Groq model ${model} unavailable (${detail}). Trying next...`); continue; }
    break;
  }
  return last;
}

function readJson(req, limit = 65536) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

/** POST /api/chat -> streams Groq's server-sent events straight through. */
async function chat(req, res) {
  if (!cfg().key) return json(res, 500, { error: 'no_key' });
  if (limited('chat', clientIp(req), 20, 60)) return json(res, 429, { error: 'rate_limited' });
  const data = (await readJson(req)) || {};
  const msgs = [];
  for (const m of (Array.isArray(data.messages) ? data.messages : []).slice(-12)) {
    if (m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && m.content) {
      msgs.push({ role: m.role, content: String(m.content).slice(0, 4000) });
    }
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json(res, 400, { error: 'bad_request' });

  const abort = new AbortController();
  res.on('close', () => abort.abort());      // browser hit "new" or left: stop paying for tokens
  let out;
  try { out = await groqCall([{ role: 'system', content: SYS }, ...msgs], true, 2048, abort); }
  catch (e) {
    if (abort.signal.aborted && res.destroyed) return;
    console.log("! Couldn't reach Groq:", e.message);
    return json(res, 502, { error: 'upstream_unreachable', detail: "Server couldn't reach Groq (network/firewall?)" });
  }
  if (!out.res) {
    console.log(`! Groq returned ${out.status}: ${out.detail}`);
    return json(res, [401, 403, 429].includes(out.status) ? out.status : 502, { error: 'upstream', status: out.status, detail: out.detail });
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  Readable.fromWeb(out.res.body).on('error', () => res.end()).pipe(res);
}

/** GET /api/health -> shows exactly why the AI isn't working. */
async function health(req, res) {
  const { key, model } = cfg();
  const info = { version: '9-virtualxp-node', key_loaded: !!key, model };
  if (!key) { info.problem = 'GROQ_API_KEY not found. Put it in a file named .env next to server.js.'; return json(res, 200, info); }
  if (limited('health', clientIp(req), 10, 60)) { info.problem = 'Too many checks, wait a minute.'; return json(res, 429, info); }
  try {
    const out = await groqCall([{ role: 'user', content: 'hi' }], false, 64, new AbortController());
    if (out.res) {
      await out.res.arrayBuffer().catch(() => {});
      Object.assign(info, { groq_status: 200, model_in_use: out.model, result: 'OK, Groq accepted the key and the model. The AI should work.' });
    } else { info.groq_status = out.status; info.problem = out.detail; }
  } catch (e) { info.problem = "Server couldn't reach Groq: " + e.message; }
  json(res, 200, info);
}

/** GET /api/ice -> STUN/TURN servers browsers use to find each other for calls. Set ICE_SERVERS (a JSON list) to add TURN. */
function ice(req, res) {
  let servers = null;
  try { if (process.env.ICE_SERVERS !== undefined) servers = JSON.parse(process.env.ICE_SERVERS); } catch { servers = null; }
  if (!Array.isArray(servers)) servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  json(res, 200, servers);
}

module.exports = { chat, health, ice, json };
