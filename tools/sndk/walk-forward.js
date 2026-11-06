// walk-forward bulanan SNDK: latih dengan semua bulan sebelumnya (label selesai sebelum bulan uji), uji bulan itu
const V = require('./spike.js'), A = require('../klctz/ai.js');
const tf = process.env.TF || '15m', bpd = tf === '15m' ? 96 : 24;
const ex = JSON.parse(process.env.EX || (tf === '15m' ? '{"k":4,"r1":1,"r2":2,"w1":0.5,"maxB":96}' : '{"k":2,"r1":1,"r2":2,"w1":0.5,"maxB":48}'));
const fee = +(process.env.FEE || 0.0005), perDayTarget = +(process.env.PD || 1.2), minLeaf = +(process.env.ML || 300), nTrees = +(process.env.NT || 40);
const onlySpike = +(process.env.SPK || 0);
const bars = V.load(tf), { X, atr, vSlot } = V.features(bars, bpd);
const rows = [];
for (let i = 0; i < bars.length; i++) {
  if (!X[i]) continue;
  if (onlySpike && !(vSlot[i] >= onlySpike)) continue;
  for (const d of [1, -1]) { const l = V.label(bars, atr, i, d, ex, fee); if (!l) continue; rows.push({ i, dd: d, d: 0, time: bars[i].time, exitT: bars[l.exit].time, r: l.r, exit: l.exit, x: V.sym(X[i], d) }); }
}
const months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const out = {};
for (const M of months) {
  const t0 = Date.parse(M + '-01T00:00:00Z'), t1 = M === '2026-11' ? Infinity : Date.parse((M.slice(5) === '12' ? '2027-01' : M.slice(0, 5) + String(+M.slice(5) + 1).padStart(2, '0')) + '-01T00:00:00Z');
  const tr = rows.filter((r) => r.exitT < t0), te = rows.filter((r) => r.time >= t0 && r.time < t1);
  const m = A.boost(tr, { nTrees, lr: 0.1, minLeaf, nb: 16 });
  // ambang: kuantil skor latih yang memberi ≈ perDayTarget trade/hari (dihitung dari bar per hari ×2 arah)
  const sc = tr.map((r) => m.score(r)).sort((a, b) => a - b);
  const candPerDay = (onlySpike ? tr.length / ((tr[tr.length - 1].time - tr[0].time) / 864e5) : bpd * 2);
  const q = Math.max(0, 1 - (perDayTarget * 2.5) / candPerDay); // ×2.5: sebagian sinyal terblokir posisi berjalan
  const th = sc[Math.floor(q * (sc.length - 1))];
  // eval berurutan
  const byBar = new Map(); for (const r of te) (byBar.get(r.i) || byBar.set(r.i, []).get(r.i)).push(r);
  let busy = -1; const R = [];
  for (const [i, list] of [...byBar.entries()].sort((a, b) => a[0] - b[0])) {
    if (i < busy) continue; let best = null, bs = -Infinity; for (const r of list) { const s = m.score(r); if (s > bs) { bs = s; best = r; } }
    if (bs < th) continue; busy = best.exit; R.push(best.r);
  }
  const days = (Math.min(t1, bars[bars.length - 1].time) - t0) / 864e5;
  out[M] = R;
  console.log(M, `latih ${tr.length} baris`, `uji: n ${R.length} (${(R.length / days).toFixed(2)}/hari) WR ${(100 * R.filter((x) => x > 0).length / R.length).toFixed(0)}% R/trade ${(R.reduce((s, v) => s + v, 0) / R.length).toFixed(3)} total ${R.reduce((s, v) => s + v, 0).toFixed(1)}R`);
}
const agg = (ms) => { const a = ms.flatMap((m) => out[m]); return `n ${a.length} WR ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0)}% R/trade ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3)} total ${a.reduce((s, v) => s + v, 0).toFixed(1)}R`; };
console.log('VALIDASI Jul-Agu:', agg(['2026-07', '2026-08']));
if (process.env.SHOWTEST) console.log('TES Sep-Nov    :', agg(['2026-09', '2026-10', '2026-11']));
