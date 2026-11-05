const DATA = process.env.KLC_DATA || require('path').join(__dirname, '../../data/klctz');
const fs = require('fs'), E = require('./engine.js'), Data = require('../../js/data.js');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const SY = 'ENAUSDT,BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,SUIUSDT,WLDUSDT,ARBUSDT,OPUSDT,NEARUSDT,LTCUSDT'.split(',');
const T1 = Date.UTC(2025, 2, 1), T2 = Date.UTC(2025, 10, 1);
const per = (t) => (t < T1 ? 0 : t < T2 ? 1 : 2);
function load(tf) { const n = tf === '4h' ? 8000 : 26000; return SY.map((s) => { const f = `${DATA}/${s}-${tf}-${n}.csv`; return fs.existsSync(f) ? { s, bars: Data.parseCSV(fs.readFileSync(f, 'utf8')) } : null; }).filter(Boolean); }
const zkey = (c) => [c.tol, c.minSrc, c.swing, c.round, c.piv].join('|');
function evalCfg(coins, cfg, zc) {
  const st = [0, 1, 2].map(() => ({ n: 0, s: 0, s2: 0, w: 0, coinPos: 0 }));
  const per3 = coins.map(() => [0, 0, 0]);
  coins.forEach((c, ci) => {
    const k = zkey(cfg); if (!zc[ci][k]) zc[ci][k] = E.zones(c.B, cfg);
    const sig = E.sequential(E.allSignals(c.B, zc[ci][k], cfg));
    for (const x of sig) { const p = per(x.time), o = st[p]; o.n++; o.s += x.r; o.s2 += x.r * x.r; if (x.r > 0) o.w++; per3[ci][p] += x.r; }
  });
  per3.forEach((v) => v.forEach((x, p) => { if (x > 0) st[p].coinPos++; }));
  return st.map((o) => { const m = o.s / o.n, sd = Math.sqrt(o.s2 / o.n - m * m); return { n: o.n, mean: m, wr: o.w / o.n, t: (m / sd) * Math.sqrt(o.n), coinPos: o.coinPos }; });
}
const pick = (a, r) => a[Math.floor(r() * a.length)];
function randCfg(r) {
  const R = pick([[1, 2, 3], [0.75, 1.5, 2.5], [1.5, 3, 4.5], [0.5, 1, 2], [1, 1.5, 2], [2, 3, 4]], r);
  const W = pick([[0.5, 0.3], [1, 0], [0.5, 0.5], [0.33, 0.33]], r);
  return { tol: pick([0.2, 0.35, 0.5, 0.75], r), minSrc: pick([2, 3, 4], r), swing: pick([5, 10, 20], r), round: pick([true, false], r), piv: pick([0, 1, 2], r),
    prof: pick([0, 1, 2, 3], r), mode: pick([0, 1, 2], r), side: pick([0, 1, -1], r), slBuf: pick([0.1, 0.25, 0.5, 1], r), r1: R[0], r2: R[1], r3: R[2], w1: W[0], w2: W[1], magnet: pick([true, false], r), maxBars: pick([20, 40, 60, 120], r) };
}
const DEF = { tol: 0.35, minSrc: 2, swing: 10, round: true, piv: 0, prof: 0, mode: 0, side: 0, slBuf: 0.25, r1: 1, r2: 2, r3: 3, w1: 0.5, w2: 0.3, magnet: true, maxBars: 60 };
function zoneGrid() { const g = []; for (const tol of [0.2, 0.35, 0.5, 0.75]) for (const minSrc of [2, 3, 4]) for (const swing of [5, 10, 20]) for (const round of [true, false]) for (const piv of [0, 1, 2]) g.push({ tol, minSrc, swing, round, piv }); return g; }
if (!isMainThread) {
  const coins = load(workerData.tf); coins.forEach((c) => (c.B = E.base(c.bars)));
  let seed = workerData.seed; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const res = [];
  for (const zcfg of workerData.zones) {
    const zc = coins.map(() => ({}));
    for (let k = 0; k < workerData.k; k++) {
      const cfg = Object.assign(randCfg(r), zcfg);
      res.push({ cfg, st: evalCfg(coins, cfg, zc) });
    }
    const isDef = zkey(zcfg) === zkey(DEF);
    if (isDef) { res.push({ cfg: DEF, st: evalCfg(coins, DEF, zc), def: true }); for (let p = 1; p < 4; p++) { const c = { ...DEF, prof: p }; res.push({ cfg: c, st: evalCfg(coins, c, zc), def: true }); } }
  }
  parentPort.postMessage(res);
} else if (require.main === module) {
  const tf = process.argv[2], K = +process.argv[3] || 15;
  const t0 = Date.now(), Z = zoneGrid();
  const parts = [0, 1, 2, 3].map((w) => Z.filter((_, i) => i % 4 === w));
  Promise.all(parts.map((zones, w) => new Promise((ok) => { const wk = new Worker(__filename, { workerData: { tf, k: K, seed: 1000 + w * 7919, zones } }); wk.on('message', ok); wk.on('error', (e) => { console.error(e); ok([]); }); }))).then((ps) => {
    const all = ps.flat();
    fs.writeFileSync(`${DATA}/opt-${tf}.json`, JSON.stringify(all));
    console.log(tf, all.length, 'konfigurasi', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  });
}
module.exports = { load, evalCfg, DEF, per, T1, T2, SY };
