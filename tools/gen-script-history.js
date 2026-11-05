#!/usr/bin/env node
// Kumpulkan hash semua versi lama kode contoh bawaan dari riwayat git → tempel hasilnya ke HISTORY di js/scripts.js.
// Jalankan setiap kali kode contoh bawaan diubah (sesudah commit):  node tools/gen-script-history.js
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-hist-'));
const hash = (s) => { s = String(s).trim(); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const commits = execSync('git log --format=%H -- js/scripts.js js/scripts-crt.js js/scripts-mytt.js js/scripts-cycle.js js/scripts-klctz.js js/scripts-ai.js', { cwd: ROOT }).toString().trim().split('\n');
const out = {};
for (const c of commits) {
  const dir = path.join(S, 'hist', c.slice(0, 8));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['scripts.js', 'scripts-crt.js', 'scripts-mytt.js', 'scripts-cycle.js', 'scripts-klctz.js', 'scripts-ai.js']) {
    try { fs.writeFileSync(path.join(dir, f), execSync(`git show ${c}:js/${f}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { /* file belum ada */ }
  }
  for (const k of Object.keys(globalThis)) if (/^Luna/.test(k)) delete globalThis[k];
  let ex;
  try { delete require.cache[require.resolve(path.join(dir, 'scripts.js'))]; ex = require(path.join(dir, 'scripts.js')).EXAMPLES; } catch (e) { console.error('lewati', c.slice(0, 8), e.message); continue; }
  for (const e of ex) (out[e.key] = out[e.key] || new Set()).add(hash(e.code));
}
const cur = require(path.join(ROOT, 'js/scripts.js')).EXAMPLES;
const res = {};
for (const e of cur) { const s = out[e.key] || new Set(); s.delete(hash(e.code)); if (s.size) res[e.key] = [...s].sort(); }
console.log(JSON.stringify(res, null, 2));
