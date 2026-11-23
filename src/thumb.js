// /api/thumb?u=<https game url>: finds a game's preview image (og:image etc.) and serves it from our own origin.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_HTML = 300 * 1024, MAX_IMG = 3 * 1024 * 1024;
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? decode(m[1] ?? m[2] ?? m[3]) : ''; };

export function validTarget(raw) {
  let u; try { u = new URL(raw || ''); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) || /^\d+(\.\d+){3}$/.test(u.hostname)) return null;
  return u;
}

// Candidate image URLs found in a page, best first.
export function imageCandidates(html, base) {
  const meta = [], icons = [];
  for (const tag of html.match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    if (/^<meta/i.test(tag)) {
      const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase(), val = attr(tag, 'content');
      if (!val) continue;
      const rank = { 'og:image:secure_url': 0, 'og:image': 1, 'og:image:url': 1, 'twitter:image': 2, 'twitter:image:src': 2 }[key];
      if (rank !== undefined) meta.push([rank, val]);
    } else {
      const rel = attr(tag, 'rel').toLowerCase(), href = attr(tag, 'href');
      if (href && /apple-touch-icon|\bicon\b/.test(rel)) icons.push([/apple-touch/.test(rel) ? 0 : 1, parseInt(attr(tag, 'sizes'), 10) || 0, href]);
    }
  }
  meta.sort((a, b) => a[0] - b[0]); icons.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out = [];
  for (const href of [...meta.map(m => m[1]), ...icons.map(i => i[2]), '/apple-touch-icon.png', '/favicon.ico']) {
    try { const u = new URL(href, base); if (u.protocol === 'https:' && !out.includes(u.href)) out.push(u.href); } catch {}
  }
  return out;
}

async function readLimited(r, max) {
  const reader = r.body?.getReader(); if (!reader) return new Uint8Array(await r.arrayBuffer());
  const chunks = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; if (n > max) { try { await reader.cancel(); } catch {} break; } }
  const out = new Uint8Array(Math.min(n, max)); let o = 0; for (const c of chunks) { if (o >= out.length) break; out.set(c.subarray(0, out.length - o), o); o += c.length; } return out;
}

const withTimeout = (ms, fn) => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms); return fn(ctl.signal).finally(() => clearTimeout(t)); };

export async function fetchThumb(target) {
  let html = '';
  try {
    html = await withTimeout(6000, async signal => {
      const r = await fetch(target.href, { signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!r.ok) return '';
      return new TextDecoder().decode(await readLimited(r, MAX_HTML));
    });
  } catch {}
  const urls = imageCandidates(html, target.href);
  for (const href of urls.slice(0, 5)) {
    try {
      const got = await withTimeout(6000, async signal => {
        const r = await fetch(href, { signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*' }, cf: { cacheTtl: 86400, cacheEverything: true } });
        const ct = (r.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        if (!r.ok || !/^image\/(png|jpe?g|webp|gif|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(ct)) return null;
        const len = Number(r.headers.get('Content-Length') || 0); if (len > MAX_IMG) return null;
        const buf = await readLimited(r, MAX_IMG + 1); if (buf.length > MAX_IMG || buf.length < 100) return null;
        return { buf, ct };
      });
      if (got) return { ...got, source: href };
    } catch {}
  }
  return null;
}

export async function thumbResponse(url, limitedFn, ip) {
  if (limitedFn('thumb', ip, 600, 60)) return new Response('Too many requests', { status: 429 });
  const target = validTarget(url.searchParams.get('u'));
  if (!target) return new Response('Bad url', { status: 400 });
  const cache = globalThis.caches?.default, key = new Request(url.origin + '/api/thumb?u=' + encodeURIComponent(target.href));
  try { const hit = cache && await cache.match(key); if (hit) return hit; } catch {}
  const got = await fetchThumb(target);
  if (!got) return new Response('No thumbnail', { status: 404, headers: { 'Cache-Control': 'public, max-age=600' } });
  const res = new Response(got.buf, { headers: { 'Content-Type': got.ct, 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  try { if (cache) await cache.put(key, res.clone()); } catch {}
  return res;
}
