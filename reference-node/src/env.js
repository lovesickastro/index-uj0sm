'use strict';
// Tiny .env loader (no dependency). Real environment variables win over the file, unless they're empty.
const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { console.log(`! No .env file found at ${file}`); return; }
  text = text.replace(/^\uFEFF/, '');                    // Notepad can add an invisible BOM that breaks the first key
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim().replace(/^export\s+/, '');
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 1) continue;
    const k = l.slice(0, i).trim();
    const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '').trim();
    if (!process.env[k]) process.env[k] = v;             // an empty variable counts as unset
  }
}

module.exports = { loadEnv };
