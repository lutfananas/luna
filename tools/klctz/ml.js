// ML filter untuk setup KLCTZ: regresi logistik (L2) & boosted stumps, dilatih di periode latih,
// ambang dipilih di validasi, dinilai sekali di tes. Semua fitur dihitung dari data sampai candle sinyal.
'use strict';
const E = require('./engine.js');
const { load, per } = require('./opt.js');
const FEATS = ['dir', 'hold', 'cnt', 'score', 'wk', 'zoneH', 'riskAtr', 'act', 'body', 'wick', 'trend200', 'trend50', 'slope50', 'rsi', 'atrPct', 'room', 'dayPos', 'wkPos'];

function gather(tf, cfg) {
  const coins = load(tf), rows = [];
  for (const c of coins) {
    const B = E.base(c.bars), Z = E.zones(B, cfg);
    const sig = E.allSignals(B, Z, cfg);
    for (const s of sig) rows.push({ coin: c.s, i: s.i, exit: s.exit, time: s.time, p: per(s.time), r: s.r, x: FEATS.map((k) => (isFinite(s.f[k]) ? s.f[k] : 0)) });
  }
  return rows;
}

function standardizer(rows) {
  const m = FEATS.map((_, j) => rows.reduce((a, r) => a + r.x[j], 0) / rows.length);
  const sd = FEATS.map((_, j) => Math.sqrt(rows.reduce((a, r) => a + (r.x[j] - m[j]) ** 2, 0) / rows.length) || 1);
  return { m, sd, z: (x) => x.map((v, j) => (v - m[j]) / sd[j]) };
}
function logistic(rows, lambda, iters) {
  const S = standardizer(rows), X = rows.map((r) => S.z(r.x)), y = rows.map((r) => (r.r > 0 ? 1 : 0));
  const d = FEATS.length; let w = new Array(d).fill(0), b = 0; const lr = 0.1;
  for (let it = 0; it < (iters || 400); it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let k = 0; k < X.length; k++) { let z = b; for (let j = 0; j < d; j++) z += w[j] * X[k][j]; const p = 1 / (1 + Math.exp(-z)); const e = p - y[k]; gb += e; for (let j = 0; j < d; j++) gw[j] += e * X[k][j]; }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / X.length + lambda * w[j]);
    b -= lr * gb / X.length;
  }
  return { kind: 'logistic', w, b, S, score: (x) => { const z0 = S.z(x); let z = b; for (let j = 0; j < d; j++) z += w[j] * z0[j]; return z; } };
}
// gradient boosted stumps (regresi kuadrat pada R) — mudah ditulis ulang di Pine
function stumps(rows, nTrees, lr) {
  const qs = FEATS.map((_, j) => { const v = rows.map((r) => r.x[j]).sort((a, b) => a - b); return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((q) => v[Math.floor(q * (v.length - 1))]).filter((x, k, a) => a.indexOf(x) === k); });
  const y = rows.map((r) => Math.max(-1.5, Math.min(3, r.r))); const F = new Array(rows.length).fill(0); const trees = [];
  const f0 = y.reduce((a, v) => a + v, 0) / y.length; F.fill(f0);
  for (let t = 0; t < nTrees; t++) {
    const res = y.map((v, k) => v - F[k]); let best = null;
    for (let j = 0; j < FEATS.length; j++) for (const th of qs[j]) {
      let sl = 0, nl = 0, sr = 0, nr = 0;
      for (let k = 0; k < rows.length; k++) { if (rows[k].x[j] <= th) { sl += res[k]; nl++; } else { sr += res[k]; nr++; } }
      if (nl < 50 || nr < 50) continue;
      const gain = (sl * sl) / nl + (sr * sr) / nr;
      if (!best || gain > best.gain) best = { j, th, l: sl / nl, r: sr / nr, gain };
    }
    if (!best) break;
    trees.push({ j: best.j, th: best.th, l: lr * best.l, r: lr * best.r });
    for (let k = 0; k < rows.length; k++) F[k] += rows[k].x[best.j] <= best.th ? lr * best.l : lr * best.r;
  }
  return { kind: 'stumps', f0, trees, score: (x) => trees.reduce((a, t) => a + (x[t.j] <= t.th ? t.l : t.r), f0) };
}

// evaluasi berurutan per koin (satu posisi sekaligus) dengan filter skor ≥ th
function evalSeq(rows, model, th, p) {
  const byCoin = {};
  for (const r of rows) if (r.p === p) (byCoin[r.coin] = byCoin[r.coin] || []).push(r);
  let n = 0, s = 0, w = 0, s2 = 0, coinPos = 0, coins = 0;
  for (const list of Object.values(byCoin)) {
    list.sort((a, b) => a.i - b.i);
    let busy = -1, cs = 0; coins++;
    for (const r of list) { if (r.i < busy) continue; if (model && model.score(r.x) < th) continue; busy = r.exit; n++; s += r.r; s2 += r.r * r.r; cs += r.r; if (r.r > 0) w++; }
    if (cs > 0) coinPos++;
  }
  const m = s / n; return { n, mean: m, wr: w / n, t: (m / Math.sqrt(s2 / n - m * m)) * Math.sqrt(n), coinPos, coins, totalR: s };
}
const fmt = (o) => `n ${String(o.n).padStart(5)}  WR ${(100 * o.wr).toFixed(1)}%  R/trade ${o.mean >= 0 ? '+' : ''}${o.mean.toFixed(3)}  total ${o.totalR >= 0 ? '+' : ''}${o.totalR.toFixed(0)}R  t ${o.t.toFixed(2)}  koin+ ${o.coinPos}/${o.coins}`;

function run(tf, cfg, label) {
  const rows = gather(tf, cfg), tr = rows.filter((r) => r.p === 0);
  console.log(`\n=== ${label} (${tf}) — ${rows.length} setup independen, latih ${tr.length} ===`);
  console.log('tanpa filter   latih', fmt(evalSeq(rows, null, 0, 0)));
  console.log('               valid', fmt(evalSeq(rows, null, 0, 1)));
  console.log('               TES  ', fmt(evalSeq(rows, null, 0, 2)));
  const models = [logistic(tr, 0.01), stumps(tr, 60, 0.3)];
  let chosen = null;
  for (const m of models) {
    const sc = tr.map((r) => m.score(r.x)).sort((a, b) => a - b);
    for (const keep of [0.5, 0.3, 0.2]) {
      const th = sc[Math.floor((1 - keep) * (sc.length - 1))];
      const v = evalSeq(rows, m, th, 1), l = evalSeq(rows, m, th, 0);
      console.log(`${m.kind.padEnd(8)} top ${keep * 100}%  latih ${fmt(l)}\n                  valid ${fmt(v)}`);
      if (v.n >= 150 && (!chosen || v.mean > chosen.v.mean)) chosen = { m, th, keep, v };
    }
  }
  if (chosen) {
    console.log(`→ dipilih di VALIDASI: ${chosen.m.kind} top ${chosen.keep * 100}%`);
    console.log('  TES (sekali)  ', fmt(evalSeq(rows, chosen.m, chosen.th, 2)));
  }
  return { rows, chosen, models };
}
module.exports = { run, gather, logistic, stumps, evalSeq, FEATS, fmt };
if (require.main === module) {
  const { DEF } = require('./opt.js');
  const tf = process.argv[2] || '4h';
  const cfg = process.argv[3] ? JSON.parse(process.argv[3]) : DEF;
  run(tf, cfg, process.argv[4] || 'default PhenLabs (Balanced)');
}
