// apakah sinyal Luna AI (walk-forward) lebih baik bila searah tren EMA48/EMA380 4H (dan 1H)?
const M = require('./mtf.js'), Data = require('../../js/data.js'), fs = require('fs');
const S = process.env.EMA_DATA || require('path').join(__dirname, '../../data');
const sig = JSON.parse(fs.readFileSync(`${S}/opt2/signals.json`, 'utf8'));
const by = {}; for (const s of sig) (by[s.coin] = by[s.coin] || []).push(s);
const grp = {}; const add = (k, r, t) => { const g = grp[k] = grp[k] || { a: [], b: [] }; (t < Date.UTC(2026, 0, 1) ? g.a : g.b).push(r); };
for (const [coin, list] of Object.entries(by)) {
  const h1 = Data.parseCSV(fs.readFileSync(`${S}/klc/${coin}-1h-26000.csv`, 'utf8'));
  const h4 = M.agg(h1, M.MS['4h']);
  const E = (bars) => { const c = bars.map((x) => x.close); return { b: bars, e48: M.ema(c, 48), e380: M.ema(c, 380) }; };
  const A1 = E(h1), A4 = E(h4);
  const last = (A, t, ms) => { let lo = 0, hi = A.b.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (A.b[m].time + ms <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  // sinyal "independen": ambil sinyal terbaik per 24 jam per koin agar tidak dobel hitung
  list.sort((p, q) => p.t - q.t); let lastT = -Infinity;
  for (const s of list) {
    if (s.t - lastT < 24 * 36e5) continue; lastT = s.t;
    const tc = s.t + 36e5, k4 = last(A4, tc, M.MS['4h']), k1 = last(A1, tc, M.MS['1h']);
    if (k4 < 0 || isNaN(A4.e380[k4]) || isNaN(A1.e380[k1])) continue;
    const t4 = Math.sign(A4.e48[k4] - A4.e380[k4]) * s.d, t1 = Math.sign(A1.e48[k1] - A1.e380[k1]) * s.d;
    add('semua sinyal AI', s.r1h, s.t);
    add(t4 > 0 ? '4H searah' : '4H berlawanan', s.r1h, s.t);
    add(t1 > 0 ? '1H searah' : '1H berlawanan', s.r1h, s.t);
    add(t4 > 0 && t1 > 0 ? '4H & 1H searah' : t4 < 0 && t1 < 0 ? '4H & 1H berlawanan' : 'campur', s.r1h, s.t);
  }
}
const f = (a) => `n ${String(a.length).padStart(4)} WR ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0)}% R ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3)}`;
for (const [k, g] of Object.entries(grp)) console.log(k.padEnd(20), '| 2025:', f(g.a), '| 2026:', f(g.b));
