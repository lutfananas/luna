// Walk-forward kuartalan untuk Luna AI: latih (expanding) → uji 3 bulan berikutnya, 8 fold.
process.env.SYM = '1'; process.env.CYC720 = '1'; process.env.NO1200 = '1'; process.env.WARM = '800';
const fs = require('fs'), Data = require('../../js/data.js');
const A = require('../klctz/ai.js');
const KLC = process.env.KLC_DATA || require('path').join(__dirname, '../../data/klctz');
const OPT = process.env.KLC_NEW || require('path').join(__dirname, '../../data/klctz-new');
const BASE = 'ENAUSDT,BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,SUIUSDT,WLDUSDT,ARBUSDT,OPUSDT,NEARUSDT,LTCUSDT'.split(',');
const NEW = 'TRXUSDT,DOTUSDT,APTUSDT,INJUSDT,TIAUSDT,SEIUSDT,PEPEUSDT,FILUSDT,ATOMUSDT,UNIUSDT,AAVEUSDT,ETCUSDT,HBARUSDT,ICPUSDT,FETUSDT,WIFUSDT'.split(',');
const env = process.env;
const ex = JSON.parse(env.EX || '{"k":3,"r1":1,"r2":2,"w1":0.5,"maxB":72}');
const fee = +(env.FEE || 0.001), NT = +(env.NT || 80), LR = +(env.LR || 0.1), MINLEAF = +(env.ML || 3000), KEEP = +(env.KEEP || 0.05), ENS = +(env.ENS || 1);
const COSTMAX = +(env.COSTMAX || 99);
const TRAIL = +(env.TRAIL || 0); // >0: setelah TP1, sisa posisi trailing stop di (close tertinggi − TRAIL·R)

function label(bars, atr, i, d) {
  if (!TRAIL) return A.label(bars, atr, i, d, ex, fee);
  const n = bars.length; if (i + 1 >= n) return null;
  const fill = bars[i + 1].open, rk = ex.k * atr[i], t1 = fill + d * rk * ex.r1, t2 = fill + d * rk * ex.r2;
  let sl = fill - d * rk, rem = 1, acc = 0, h1 = false, best = fill;
  const R = (p) => ((p - fill) * d) / rk, cost = (2 * fee * fill) / rk;
  for (let j = i + 1; j < n; j++) {
    const b = bars[j];
    if (d === 1 ? b.low <= sl : b.high >= sl) { const px = j === i + 1 ? sl : d === 1 ? Math.min(sl, b.open) : Math.max(sl, b.open); return { r: acc + rem * R(px) - cost, exit: j }; }
    if (!h1 && (d === 1 ? b.high >= t1 : b.low <= t1)) { h1 = true; acc += ex.w1 * R(t1); rem -= ex.w1; sl = fill; }
    if (h1 && ex.r2 < 50 && (d === 1 ? b.high >= t2 : b.low <= t2)) return { r: acc + rem * R(t2) - cost, exit: j };
    if (h1) { best = d === 1 ? Math.max(best, b.close) : Math.min(best, b.close); const ts = best - d * TRAIL * rk; sl = d === 1 ? Math.max(sl, ts) : Math.min(sl, ts); }
    if (j - i >= ex.maxB) return { r: acc + rem * R(b.close) - cost, exit: j };
  }
  return null;
}
function rowsFor(file, coin) {
  const bars = Data.parseCSV(fs.readFileSync(file, 'utf8')), { X, atr } = A.features(bars), out = [];
  for (let i = 0; i < bars.length; i++) {
    if (!X[i]) continue;
    for (const d of [1, -1]) { const l = label(bars, atr, i, d); if (!l) continue; out.push({ coin, i, dd: d, d: 0, time: bars[i].time, exitT: bars[l.exit].time, exit: l.exit, r: l.r, cost: (2 * fee * bars[i].close) / (ex.k * atr[i]), x: A.sym(X[i], d) }); }
  }
  return out;
}
function seqEval(rows, scoreFn, th) {
  const by = {}; for (const r of rows) (by[r.coin] = by[r.coin] || []).push(r);
  const res = []; const perCoin = {};
  for (const [coin, list] of Object.entries(by)) {
    const byBar = new Map(); for (const r of list) (byBar.get(r.i) || byBar.set(r.i, []).get(r.i)).push(r);
    let busy = -1;
    for (const [i, l] of [...byBar.entries()].sort((a, b) => a[0] - b[0])) {
      if (i < busy) continue; let best = null, bs = -Infinity; for (const r of l) { const s = scoreFn(r); if (s > bs) { bs = s; best = r; } }
      if (bs < th || best.cost > COSTMAX) continue; busy = best.exit; res.push(best.r); perCoin[coin] = (perCoin[coin] || 0) + best.r;
    }
  }
  return { R: res, perCoin };
}
function train(tr) {
  if (ENS <= 1) { const m = A.boost(tr, { nTrees: NT, lr: LR, minLeaf: MINLEAF }); return { score: (r) => m.score(r), models: [m] }; }
  const coins = [...new Set(tr.map((r) => r.coin))], models = [];
  for (let e = 0; e < ENS; e++) { // bagging per koin: tiap model tanpa ±1/ENS koin
    const drop = new Set(coins.filter((_, k) => k % ENS === e));
    models.push(A.boost(tr.filter((r) => !drop.has(r.coin)), { nTrees: NT, lr: LR, minLeaf: MINLEAF }));
  }
  return { score: (r) => models.reduce((a, m) => a + m.score(r), 0) / models.length, models };
}
const t0 = Date.now();
const base = BASE.flatMap((s) => rowsFor(`${KLC}/${s}-1h-26000.csv`, s));
const hold = env.HOLD ? NEW.filter((s) => fs.existsSync(`${OPT}/${s}-1h-26000.csv`)).flatMap((s) => rowsFor(`${OPT}/${s}-1h-26000.csv`, s)) : [];
const folds = [[2025,0],[2025,3],[2025,6],[2025,9],[2026,0],[2026,3],[2026,6],[2026,9]].map(([y, m]) => [Date.UTC(y, m, 1), Date.UTC(y, m + 3, 1)]);
const agg = { base: [], hold: [] }, foldMeans = [], holdMeans = [];
const tag = env.TAG || 'variant';
for (const [a, b] of folds) {
  const tr = base.filter((r) => r.exitT < a);
  const M = train(tr);
  const sc = tr.filter((_, k) => k % 5 === 0).map((r) => M.score(r)).sort((x, y) => x - y), th = sc[Math.floor((1 - KEEP) * (sc.length - 1))];
  const te = seqEval(base.filter((r) => r.time >= a && r.time < b), M.score, th);
  agg.base.push(...te.R); const fm = te.R.reduce((s, v) => s + v, 0) / te.R.length; foldMeans.push(fm);
  let hs = '';
  if (hold.length) { const h = seqEval(hold.filter((r) => r.time >= a && r.time < b), M.score, th); agg.hold.push(...h.R); const hm = h.R.reduce((s, v) => s + v, 0) / h.R.length; holdMeans.push(hm); hs = ` | koin baru n ${h.R.length} R ${hm.toFixed(3)}`; }
  console.log(`${tag} ${new Date(a).toISOString().slice(0, 7)} latih ${tr.length} | 16 koin n ${te.R.length} R ${fm.toFixed(3)}${hs}`);
}
const st = (R) => { const m = R.reduce((s, v) => s + v, 0) / R.length, sd = Math.sqrt(R.reduce((s, v) => s + (v - m) ** 2, 0) / R.length); return `n ${R.length} WR ${(100 * R.filter((x) => x > 0).length / R.length).toFixed(1)}% R/trade ${m.toFixed(3)} t ${(m / sd * Math.sqrt(R.length)).toFixed(2)}`; };
console.log(`== ${tag} 16 koin WF: ${st(agg.base)} | fold positif ${foldMeans.filter((v) => v > 0).length}/${foldMeans.length} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (hold.length) console.log(`== ${tag} KOIN BARU WF: ${st(agg.hold)} | fold positif ${holdMeans.filter((v) => v > 0).length}/${holdMeans.length}`);
