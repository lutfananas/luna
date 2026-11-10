const fs = require('fs');
const SPLIT = Date.UTC(2026, 8, 1);
const res = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter((x) => !x.err);
const st = (T) => { const n = T.length; if (!n) return { n: 0, wr: NaN, m: NaN, tot: 0 }; const tot = T.reduce((s, x) => s + x[1], 0); return { n, wr: T.filter((x) => x[1] > 0).length / n, m: tot / n, tot }; };
for (const r of res) { r.a = st(r.T.filter((x) => x[0] < SPLIT)); r.b = st(r.T.filter((x) => x[0] >= SPLIT)); }
const nm = (c) => `${c.tf}/CRT ${c.htf} · ${c.model} · TBS ${c.tbs ? 'wajib' : '-'} · KL ${c.kl ? 'wajib' : '-'} · EMA ${c.emaF}${c.emaLv ? ' + sweep di EMA' : ''} · KZ ${c.kz ? 'ya' : '-'}`;
const f = (s) => `n ${String(s.n).padStart(3)} WR ${isNaN(s.wr) ? ' -- ' : (100 * s.wr).toFixed(0).padStart(3) + '%'} R ${isNaN(s.m) ? '  -- ' : (s.m >= 0 ? '+' : '') + s.m.toFixed(3)} tot ${s.tot.toFixed(1)}`;
// pengaruh tiap faktor: rata-rata R per trade terkumpul (pool semua trade) dari semua konfigurasi dengan nilai itu
console.log('=== Pengaruh tiap komponen (pool semua setelan) ===');
for (const key of ['tf', 'model', 'tbs', 'kl', 'emaF', 'emaLv', 'kz']) {
  const vals = [...new Set(res.map((r) => (key === 'tf' ? r.c.tf + '/' + r.c.htf : String(r.c[key]))))];
  for (const v of vals) {
    const g = res.filter((r) => (key === 'tf' ? r.c.tf + '/' + r.c.htf : String(r.c[key])) === v);
    const pool = (k) => { let n = 0, s = 0, w = 0; for (const r of g) { n += r[k].n; s += r[k].tot; w += (r[k].wr || 0) * r[k].n; } return `n ${n} WR ${(100 * w / n).toFixed(0)}% R ${(s / n).toFixed(3)}`; };
    console.log(`${key.padEnd(6)} ${v.padEnd(16)} | sebelum Sep ${pool('a')} | Sep-Nov ${pool('b')}`);
  }
}
const pos = res.filter((r) => r.a.n >= 10 && r.a.m > 0);
console.log(`\nsetelan positif sebelum Sep (n≥10): ${pos.length}/${res.length}; dari itu positif juga di Sep-Nov: ${pos.filter((r) => r.b.n > 0 && r.b.m > 0).length}`);
const cand = res.filter((r) => r.a.n >= 15).sort((p, q) => q.a.m - p.a.m);
console.log(`\n=== 10 teratas sebelum Sep (n≥15) dari ${cand.length} ===`);
cand.slice(0, 10).forEach((r, k) => console.log(String(k + 1).padStart(2), nm(r.c), '\n     sebelum Sep', f(r.a), '| Sep-Nov', f(r.b)));
const wrc = res.filter((r) => r.a.n >= 15 && r.a.m > 0).sort((p, q) => q.a.wr - p.a.wr);
console.log(`\n=== WR tertinggi sebelum Sep (n≥15, R>0) ===`);
wrc.slice(0, 5).forEach((r, k) => console.log(String(k + 1).padStart(2), nm(r.c), '\n     sebelum Sep', f(r.a), '| Sep-Nov', f(r.b)));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(cand.slice(0, 5).map((r) => r.c).concat(wrc.slice(0, 3).map((r) => r.c))));
