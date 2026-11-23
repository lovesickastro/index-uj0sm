'use strict';
// Minimal static file server: correct MIME types (the proxy's .mjs/.wasm files need them), Range requests
// (the 45 MB VirtualXP image), Last-Modified/304, and path-traversal protection.
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream', '.iso': 'application/octet-stream',
};

/** Serve `rel` (a URL path, relative) from `root`. Resolves true if a file was sent, false if not found. */
function serve(req, res, root, rel, extraHeaders = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = decodeURIComponent(rel); } catch { return resolve(false); }
    if (p.includes('\0')) return resolve(false);
    const file = path.join(root, path.normalize('/' + p));
    if (file !== root && !file.startsWith(root + path.sep)) return resolve(false);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return resolve(false);
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString(), ...extraHeaders,
      };
      const ims = Date.parse(req.headers['if-modified-since'] || '');
      if (!req.headers.range && ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(ims / 1000)) { res.writeHead(304, headers); res.end(); return resolve(true); }

      let start = 0, end = st.size - 1, status = 200;
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = parseInt(m[1], 10); if (m[2]) end = Math.min(end, parseInt(m[2], 10)); }
        else { start = Math.max(0, st.size - parseInt(m[2], 10)); }
        if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return resolve(true); }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      }
      headers['Content-Length'] = end - start + 1;
      res.writeHead(status, headers);
      if (req.method === 'HEAD') { res.end(); return resolve(true); }
      const rs = fs.createReadStream(file, { start, end });
      rs.on('error', () => res.destroy());
      res.on('close', () => rs.destroy());
      rs.pipe(res);
      resolve(true);
    });
  });
}

module.exports = { serve };
