const V = require('./spike.js');
const TEST = Date.UTC(2026, 8, 1);
const fee = 0.0005;
for (const [tf, bpd, ex] of [['15m', 96, { k: 4, r1: 1, r2: 2, w1: 0.5, maxB: 96 }], ['1h', 24, { k: 2, r1: 1, r2: 2, w1: 0.5, maxB: 48 }]]) {
  const bars = V.load(tf), { X, atr, vSlot } = V.features(bars, bpd);
  console.log(`\n== ${tf}  exit ${JSON.stringify(ex)} fee ${fee * 100}%`);
  // baseline: setiap candle, long / short
  for (const d of [1, -1]) { const a = [[], []]; for (let i = 0; i < bars.length; i += 3) { if (!X[i]) continue; const l = V.label(bars, atr, i, d, ex, fee); if (l) a[bars[i].time < TEST ? 0 : 1].push(l.r); } const m = (x) => (x.reduce((s, v) => s + v, 0) / x.length).toFixed(3); console.log(`  acak ${d > 0 ? 'long ' : 'short'}  sebelum Sep ${m(a[0])}  Sep-Nov ${m(a[1])}`); }
  for (const k of [2, 3, 5])
    for (const mode of ['ikut', 'lawan']) {
      const res = { tr: [], te: [] }, mon = {};
      let busy = -1;
      for (let i = 0; i < bars.length; i++) {
        if (!X[i] || i < busy || !(vSlot[i] >= k)) continue;
        const s = Math.sign(bars[i].close - bars[i].open); if (!s) continue;
        const d = mode === 'ikut' ? s : -s;
        const l = V.label(bars, atr, i, d, ex, fee); if (!l) continue;
        busy = l.exit; (bars[i].time < TEST ? res.tr : res.te).push(l.r);
        const mo = V.monthOf(bars[i].time); (mon[mo] = mon[mo] || []).push(l.r);
      }
      const f = (a) => `n ${String(a.length).padStart(3)} WR ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0).padStart(3)}% R ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3).padStart(6)}`;
      console.log(`  spike ≥${k}× ${mode.padEnd(5)} | sebelum Sep ${f(res.tr)} | Sep-Nov ${f(res.te)} | per bulan ${Object.entries(mon).map(([m, a]) => m.slice(5) + ':' + (a.reduce((s, v) => s + v, 0)).toFixed(1)).join(' ')}`);
    }
}
