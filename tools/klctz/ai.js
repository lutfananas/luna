// Luna AI 1H: fitur kausal per candle + label bracket (ala broker) + boosted trees berbasis histogram.
'use strict';
const fs = require('fs'), Data = require('../../js/data.js');
const DIR = process.env.KLC_DATA || require('path').join(__dirname, '../../data/klctz');
const SY = 'ENAUSDT,BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,SUIUSDT,WLDUSDT,ARBUSDT,OPUSDT,NEARUSDT,LTCUSDT'.split(',');
const T1 = Date.UTC(2025, 2, 1), T2 = Date.UTC(2025, 10, 1);
const DAY = 864e5, WEEK = 7 * DAY;

const ema = (x, n) => { const o = new Float64Array(x.length).fill(NaN); let v = NaN, s = 0, c = 0; const a = 2 / (n + 1); for (let i = 0; i < x.length; i++) { if (isNaN(v)) { s += x[i]; c++; if (c >= n) v = s / n; o[i] = v; continue; } v = a * x[i] + (1 - a) * v; o[i] = v; } return o; };
const rma = (x, n) => { const o = new Float64Array(x.length).fill(NaN); let v = NaN, s = 0, c = 0; for (let i = 0; i < x.length; i++) { if (isNaN(x[i])) { o[i] = v; continue; } if (isNaN(v)) { s += x[i]; c++; if (c >= n) v = s / n; o[i] = v; continue; } v = (x[i] + (n - 1) * v) / n; o[i] = v; } return o; };
const sma = (x, n) => { const o = new Float64Array(x.length).fill(NaN); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
// highest/lowest + barsince via deque
function rollExt(x, n, isMax) { const o = new Float64Array(x.length), ob = new Int32Array(x.length), dq = []; for (let i = 0; i < x.length; i++) { while (dq.length && (isMax ? x[dq[dq.length - 1]] <= x[i] : x[dq[dq.length - 1]] >= x[i])) dq.pop(); dq.push(i); while (dq[0] <= i - n) dq.shift(); o[i] = x[dq[0]]; ob[i] = i - dq[0]; } return [o, ob]; }
function htfPrev(bars, bucketOf) { const n = bars.length, H = new Float64Array(n).fill(NaN), L = new Float64Array(n).fill(NaN), C = new Float64Array(n).fill(NaN); let cur = null, prev = null, id = null; for (let i = 0; i < n; i++) { const b = bars[i], k = bucketOf(b.time); if (k !== id) { prev = cur; cur = { h: b.high, l: b.low, c: b.close }; id = k; } else { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; } if (prev) { H[i] = prev.h; L[i] = prev.l; C[i] = prev.c; } } return { H, L, C }; }
const cl = (v, a, b) => (isFinite(v) ? Math.max(a, Math.min(b, v)) : 0);

const FEATS = ['t50', 't200', 't480', 't1200', 'sl50', 'sl200', 'rsi14', 'rsi4h', 'roc24', 'roc168', 'atrPct', 'atrReg', 'bbw', 'vol', 'pos24', 'pos480', 'cycDays', 'cycUp', 'cycHiDays', 'dayPos', 'wkPos', 'dPDH', 'dPDL', 'body', 'uw', 'lw', 'hs', 'hc', 'dow'];

function features(bars) {
  const n = bars.length, C = bars.map((b) => b.close), H = bars.map((b) => b.high), L = bars.map((b) => b.low), V = bars.map((b) => b.volume || 0);
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - C[i - 1]), Math.abs(b.low - C[i - 1])) : b.high - b.low));
  const atr = rma(tr, 14), atrL = sma(Array.from(atr).map((v) => (isNaN(v) ? 0 : v)), 720);
  const e50 = ema(C, 50), e200 = ema(C, 200), e480 = ema(C, 480), e1200 = ema(C, 1200);
  const up = C.map((c, i) => (i ? Math.max(c - C[i - 1], 0) : NaN)), dn = C.map((c, i) => (i ? Math.max(C[i - 1] - c, 0) : NaN));
  const ru = rma(up, 14), rd = rma(dn, 14), rsi = Array.from(ru).map((u, i) => (rd[i] === 0 ? 100 : 100 - 100 / (1 + u / rd[i])));
  const ru4 = rma(up, 56), rd4 = rma(dn, 56), rsi4 = Array.from(ru4).map((u, i) => (rd4[i] === 0 ? 100 : 100 - 100 / (1 + u / rd4[i])));
  const s20 = sma(C, 20), sq = sma(C.map((c) => c * c), 20);
  const vma = sma(V, 168);
  const [h24] = rollExt(H, 24, true), [l24] = rollExt(L, 24, false), [h480] = rollExt(H, 480, true), [l480] = rollExt(L, 480, false);
  const CYC = process.env.CYC720 ? 720 : 1440;
  const [l1440, lb1440] = rollExt(L, CYC, false); // siklus: low 60 hari
  const D = htfPrev(bars, (t) => Math.floor(t / DAY)), W = htfPrev(bars, (t) => Math.floor((t - 4 * DAY) / WEEK));
  const X = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = atr[i], c = C[i], b = bars[i];
    if (i < (process.env.WARM ? +process.env.WARM : 1300) || !(a > 0)) { X[i] = null; continue; }
    const rng = Math.max(b.high - b.low, 1e-12), sd = Math.sqrt(Math.max(sq[i] - s20[i] * s20[i], 0));
    // hari sejak low 60 hari, dan high tertinggi setelah low itu (fase siklus / translasi)
    const lowIdx = i - lb1440[i]; let hi = -Infinity, hiIdx = lowIdx; for (let k = lowIdx; k <= i; k += 1) if (H[k] > hi) { hi = H[k]; hiIdx = k; }
    const hr = new Date(b.time).getUTCHours();
    X[i] = [
      cl((c - e50[i]) / a, -15, 15), cl((c - e200[i]) / a, -30, 30), cl((c - e480[i]) / a, -40, 40), process.env.NO1200 ? 0 : cl((c - e1200[i]) / a, -60, 60),
      cl((e50[i] - e50[i - 24]) / a, -10, 10), cl((e200[i] - e200[i - 24]) / a, -5, 5),
      rsi[i] / 100, rsi4[i] / 100, cl((c / C[i - 24] - 1) * 100, -30, 30), cl((c / C[i - 168] - 1) * 100, -60, 60),
      (a / c) * 100, cl(a / atrL[i], 0, 4), cl((4 * sd) / c * 100, 0, 40), cl(V[i] / Math.max(vma[i], 1e-9), 0, 8),
      (c - l24[i]) / Math.max(h24[i] - l24[i], 1e-12), (c - l480[i]) / Math.max(h480[i] - l480[i], 1e-12),
      lb1440[i] / 24, cl((c / l1440[i] - 1) * 100, 0, 300), (hiIdx - lowIdx) / 24,
      isNaN(D.H[i]) ? 0.5 : cl((c - D.L[i]) / Math.max(D.H[i] - D.L[i], 1e-12), -2, 3), isNaN(W.H[i]) ? 0.5 : cl((c - W.L[i]) / Math.max(W.H[i] - W.L[i], 1e-12), -2, 3),
      isNaN(D.H[i]) ? 0 : cl((D.H[i] - c) / a, -20, 20), isNaN(D.L[i]) ? 0 : cl((c - D.L[i]) / a, -20, 20),
      (c - b.open) / rng, (b.high - Math.max(b.open, c)) / rng, (Math.min(b.open, c) - b.low) / rng,
      Math.sin((2 * Math.PI * hr) / 24), Math.cos((2 * Math.PI * hr) / 24), process.env.NODOW ? 0 : new Date(b.time).getUTCDay(),
    ];
  }
  return { X, atr };
}

// label: masuk di open i+1, SL = k·ATR, TP1 = r1 (sebagian w1, lalu BE), TP2 = r2, time exit maxB
function label(bars, atr, i, d, ex, fee) {
  const n = bars.length; if (i + 1 >= n) return null;
  const fill = bars[i + 1].open, rk = ex.k * atr[i], sl0 = fill - d * rk, t1 = fill + d * rk * ex.r1, t2 = fill + d * rk * ex.r2;
  let sl = sl0, rem = 1, acc = 0, h1 = false;
  const R = (p) => ((p - fill) * d) / rk, cost = (2 * fee * fill) / rk;
  for (let j = i + 1; j < n; j++) {
    const b = bars[j];
    if (d === 1 ? b.low <= sl : b.high >= sl) { const px = j === i + 1 ? sl : d === 1 ? Math.min(sl, b.open) : Math.max(sl, b.open); return { r: acc + rem * R(px) - cost, exit: j }; }
    if (!h1 && (d === 1 ? b.high >= t1 : b.low <= t1)) { h1 = true; acc += ex.w1 * R(t1); rem -= ex.w1; sl = fill; if (rem <= 1e-9) return { r: acc - cost, exit: j }; }
    if (h1 && (d === 1 ? b.high >= t2 : b.low <= t2)) return { r: acc + rem * R(t2) - cost, exit: j };
    if (j - i >= ex.maxB) return { r: acc + rem * R(b.close) - cost, exit: j };
  }
  return null;
}

const SYM = !!process.env.SYM;
// cermin fitur untuk short: tren/momentum dikali arah, posisi dalam range dibalik
function sym(x, d) {
  if (d === 1) return x;
  const y = x.slice();
  for (const j of [0, 1, 2, 3, 4, 5, 8, 9, 23]) y[j] = -x[j];
  for (const j of [6, 7, 14, 15]) y[j] = 1 - x[j];
  y[19] = 1 - x[19]; y[20] = 1 - x[20];
  y[21] = x[22]; y[22] = x[21]; y[24] = x[25]; y[25] = x[24];
  return y;
}
function dataset(tf, ex, fee) {
  const rows = [];
  for (const s of SY) {
    const f = `${DIR}/${s}-${tf}-26000.csv`; if (!fs.existsSync(f)) continue;
    const bars = Data.parseCSV(fs.readFileSync(f, 'utf8'));
    const { X, atr } = features(bars);
    for (let i = 0; i < bars.length; i++) {
      if (!X[i]) continue;
      for (const d of [1, -1]) { const l = label(bars, atr, i, d, ex, fee); if (!l) continue; rows.push({ coin: s, i, d: SYM ? 0 : d, dd: d, time: bars[i].time, p: bars[i].time < T1 ? 0 : bars[i].time < T2 ? 1 : 2, r: l.r, exit: l.exit, x: SYM ? sym(X[i], d) : X[i] }); }
    }
  }
  return rows;
}

// boosted trees kedalaman 2 berbasis histogram (16 bin), regresi pada R (di-clip), fitur + arah
function binner(rows, nb) {
  const F = rows[0].x.length + 1, edges = [];
  for (let j = 0; j < F; j++) { const v = rows.filter((_, k) => k % 7 === 0).map((r) => (j < F - 1 ? r.x[j] : r.d)).sort((a, b) => a - b); const e = []; for (let q = 1; q < nb; q++) e.push(v[Math.floor((q / nb) * (v.length - 1))]); edges.push([...new Set(e)]); }
  const bin = (r, j) => { const v = j < F - 1 ? r.x[j] : r.d, e = edges[j]; let lo = 0; while (lo < e.length && v > e[lo]) lo++; return lo; };
  return { F, edges, bin };
}
function boost(rows, opt) {
  const { nTrees = 80, lr = 0.1, nb = 16, minLeaf = 2000, clip = 2 } = opt || {};
  const B = binner(rows, nb), N = rows.length, F = B.F;
  const bins = Array.from({ length: F }, (_, j) => Uint8Array.from(rows, (r) => B.bin(r, j)));
  const y = Float64Array.from(rows, (r) => Math.max(-clip, Math.min(clip, r.r)));
  const f0 = y.reduce((a, v) => a + v, 0) / N, Fx = new Float64Array(N).fill(f0), trees = [];
  const bestSplit = (idx, res) => { let best = null; let tot = 0; for (const k of idx) tot += res[k]; for (let j = 0; j < F; j++) { const nbj = B.edges[j].length + 1, s = new Float64Array(nbj), c = new Float64Array(nbj); for (const k of idx) { s[bins[j][k]] += res[k]; c[bins[j][k]]++; } let sl = 0, nl = 0; for (let t = 0; t < nbj - 1; t++) { sl += s[t]; nl += c[t]; const nr = idx.length - nl; if (nl < minLeaf || nr < minLeaf) continue; const g = (sl * sl) / nl + ((tot - sl) * (tot - sl)) / nr; if (!best || g > best.g) best = { j, t, g }; } } return best; };
  const all = Array.from({ length: N }, (_, k) => k);
  for (let it = 0; it < nTrees; it++) {
    const res = new Float64Array(N); for (let k = 0; k < N; k++) res[k] = y[k] - Fx[k];
    const s1 = bestSplit(all, res); if (!s1) break;
    const L = all.filter((k) => bins[s1.j][k] <= s1.t), R = all.filter((k) => bins[s1.j][k] > s1.t);
    const node = { j: s1.j, th: B.edges[s1.j][s1.t], kids: [] };
    for (const part of [L, R]) {
      const s2 = bestSplit(part, res);
      if (!s2) { const m = part.reduce((a, k) => a + res[k], 0) / part.length; node.kids.push({ leaf: lr * m }); continue; }
      const LL = part.filter((k) => bins[s2.j][k] <= s2.t), RR = part.filter((k) => bins[s2.j][k] > s2.t);
      const mean = (p) => p.reduce((a, k) => a + res[k], 0) / p.length;
      node.kids.push({ j: s2.j, th: B.edges[s2.j][s2.t], l: lr * mean(LL), r: lr * mean(RR) });
    }
    trees.push(node);
    for (let k = 0; k < N; k++) Fx[k] += predTree(node, rows[k]);
  }
  return { f0, trees, F, score: (r) => trees.reduce((a, t) => a + predTree(t, r), f0) };
}
function fv(r, j) { return j < r.x.length ? r.x[j] : r.d; }
function predTree(t, r) { const k = t.kids[fv(r, t.j) <= t.th ? 0 : 1]; return 'leaf' in k ? k.leaf : fv(r, k.j) <= k.th ? k.l : k.r; }

// eval berurutan per koin: per bar pilih arah dengan skor tertinggi; ambil jika skor ≥ th
function evalSeq(rows, model, th, p) {
  const by = {}; for (const r of rows) if (r.p === p) (by[r.coin] = by[r.coin] || new Map()).set(r.i * 2 + ((r.dd || r.d) === 1 ? 0 : 1), r);
  let n = 0, s = 0, w = 0, s2 = 0, coinPos = 0, days = 0; const cs = [];
  for (const [coin, m] of Object.entries(by)) {
    const keys = [...m.keys()].sort((a, b) => a - b); let busy = -1, sum = 0, t0 = Infinity, t1 = 0;
    const byBar = new Map(); for (const k of keys) { const r = m.get(k); (byBar.get(r.i) || byBar.set(r.i, []).get(r.i)).push(r); }
    for (const [i, list] of [...byBar.entries()].sort((a, b) => a[0] - b[0])) {
      t0 = Math.min(t0, list[0].time); t1 = Math.max(t1, list[0].time);
      if (i < busy) continue;
      let best = null, bs = -Infinity; for (const r of list) { const sc = model.score(r); if (sc > bs) { bs = sc; best = r; } }
      if (bs < th) continue;
      busy = best.exit; n++; s += best.r; s2 += best.r * best.r; sum += best.r; if (best.r > 0) w++;
    }
    days += (t1 - t0) / DAY; if (sum > 0) coinPos++; cs.push([coin, sum]);
  }
  const m = s / n; return { n, mean: m, wr: w / n, t: (m / Math.sqrt(s2 / n - m * m)) * Math.sqrt(n), coinPos, perDay: n / days, totalR: s };
}
const fmt = (o) => `n ${String(o.n).padStart(5)} (${o.perDay.toFixed(2)}/hari/koin)  WR ${(100 * o.wr).toFixed(1)}%  R/trade ${o.mean >= 0 ? '+' : ''}${o.mean.toFixed(3)}  t ${o.t.toFixed(2)}  koin+ ${o.coinPos}/16`;
module.exports = { sym, features, label, dataset, boost, evalSeq, fmt, FEATS, predTree, SY, T1, T2 };
