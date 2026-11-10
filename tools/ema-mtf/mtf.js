// EMA 48 / EMA 380 multi-timeframe: tren di TF besar, pantulan di EMA (support/resistance), eksekusi di TF kecil.
'use strict';
const fs = require('fs'), Data = require('../../js/data.js');
const MS = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5 };

function agg(b5, ms) {
  const out = []; let cur = null;
  for (const b of b5) {
    const t = Math.floor(b.time / ms) * ms;
    if (!cur || cur.time !== t) { cur = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }; out.push(cur); }
    else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; }
  }
  return out;
}
// EMA ala Pine (seed SMA), ATR 14 (RMA)
function ema(c, n) { const o = new Float64Array(c.length).fill(NaN); let v = NaN, s = 0; const a = 2 / (n + 1); for (let i = 0; i < c.length; i++) { if (isNaN(v)) { s += c[i]; if (i >= n - 1) { v = s / n; o[i] = v; } continue; } v = a * c[i] + (1 - a) * v; o[i] = v; } return o; }
function atr(b, n) { const o = new Float64Array(b.length).fill(NaN); let v = NaN, s = 0; for (let i = 0; i < b.length; i++) { const tr = i ? Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close)) : b[i].high - b[i].low; if (isNaN(v)) { s += tr; if (i >= n - 1) { v = s / n; o[i] = v; } continue; } v = (tr + (n - 1) * v) / n; o[i] = v; } return o; }

function prepare(b5) {
  const tf = {};
  for (const k of ['5m', '15m', '1h', '4h']) {
    const b = k === '5m' ? b5 : agg(b5, MS[k]), c = b.map((x) => x.close);
    tf[k] = { bars: b, e48: ema(c, 48), e380: ema(c, 380), atr: atr(b, 14) };
  }
  return tf;
}
// indeks candle TF besar terakhir yang SUDAH close pada saat candle eksekusi i close
function mapIdx(X, H, msX, msH) {
  const m = new Int32Array(X.length); let k = -1;
  for (let i = 0; i < X.length; i++) { const tc = X[i].time + msX; while (k + 1 < H.length && H[k + 1].time + msH <= tc) k++; m[i] = k; }
  return m;
}

function simulate(tf, p, fee) {
  const X = tf[p.X].bars, Lv = tf[p.Lv], T = tf[p.T], msX = MS[p.X];
  const mL = mapIdx(X, Lv.bars, msX, MS[p.Lv]), mT = mapIdx(X, T.bars, msX, MS[p.T]);
  const maxB = Math.round((p.tp === 'T' ? 120 : p.hold || 72) * 36e5 / msX);
  const trades = []; let busy = -1;
  for (let i = p.F + 1; i < X.length - 1; i++) {
    if (i <= busy) continue;
    const kT = mT[i], kL = mL[i]; if (kT < 0 || kL < 0) continue;
    const e48T = T.e48[kT], e380T = T.e380[kT]; if (isNaN(e380T) || isNaN(e48T)) continue;
    let dir = e48T > e380T ? 1 : e48T < e380T ? -1 : 0;
    if (p.strict && dir !== 0 && (T.bars[kT].close - e380T) * dir <= 0) dir = 0;
    if (!dir) continue;
    const a = Lv.atr[kL]; if (!(a > 0)) continue;
    const lvls = p.which === 48 ? [Lv.e48[kL]] : p.which === 380 ? [Lv.e380[kL]] : [Lv.e48[kL], Lv.e380[kL]];
    if (p.which === 'zone' && (Lv.e48[kL] - Lv.e380[kL]) * dir <= 0) continue;
    let L = NaN;
    for (const lv of lvls) {
      if (isNaN(lv)) continue;
      const b = X[i], zone = lv + dir * p.tol * a;
      const touch = (dir === 1 ? b.low <= zone && b.close > lv : b.high >= zone && b.close < lv) && (!p.conf || (b.close - b.open) * dir > 0);
      if (!touch) continue;
      let fresh = true; // sentuhan pertama: F candle sebelumnya belum menyentuh zona
      for (let k = 1; k <= p.F && fresh; k++) { const q = X[i - k]; if (dir === 1 ? q.low <= zone : q.high >= zone) fresh = false; }
      if (!fresh) continue;
      L = lv; break;
    }
    if (isNaN(L)) continue;
    const slBase = p.which === 'zone' ? Lv.e380[kL] : L;
    const fill = X[i + 1].open, sl = slBase - dir * p.m * a, risk = (fill - sl) * dir;
    if (!(risk > 0.2 * a)) continue;
    const R = (px) => ((px - fill) * dir) / risk, cost = (2 * fee * fill) / risk;
    const tp1 = fill + dir * risk * (p.tp === 'P' ? 1 : p.tp), tp2 = fill + dir * risk * 2;
    let s = sl, rem = 1, acc = 0, h1 = false, out = null;
    for (let j = i + 1; j < X.length; j++) {
      const b = X[j];
      if (dir === 1 ? b.low <= s : b.high >= s) { const px = j === i + 1 ? s : dir === 1 ? Math.min(s, b.open) : Math.max(s, b.open); out = { r: acc + rem * R(px) - cost, j }; break; }
      if (p.tp === 'T') {
        if (!h1 && (dir === 1 ? b.high >= fill + dir * risk : b.low <= fill + dir * risk)) { h1 = true; s = fill; }
        const kk = mL[j], e = kk >= 0 ? Lv.e48[kk] : NaN;
        if (h1 && !isNaN(e) && (b.close - e) * dir < 0) { out = { r: R(b.close) - cost, j }; break; }
      } else if (p.tp !== 'P') { if (dir === 1 ? b.high >= tp1 : b.low <= tp1) { out = { r: R(tp1) - cost, j }; break; } }
      else {
        if (!h1 && (dir === 1 ? b.high >= tp1 : b.low <= tp1)) { h1 = true; acc += 0.5 * R(tp1); rem = 0.5; s = fill; }
        if (h1 && (dir === 1 ? b.high >= tp2 : b.low <= tp2)) { out = { r: acc + 0.5 * R(tp2) - cost, j }; break; }
      }
      if (j - i >= maxB) { out = { r: acc + rem * R(b.close) - cost, j }; break; }
    }
    if (!out) break;
    trades.push({ t: X[i].time, dir, r: out.r, lvl: L === Lv.e48[kL] ? 48 : 380 });
    busy = out.j;
  }
  return trades;
}
const stats = (tr) => { const n = tr.length; if (!n) return { n: 0, wr: NaN, m: NaN, tot: 0 }; const tot = tr.reduce((s, x) => s + x.r, 0); return { n, wr: tr.filter((x) => x.r > 0).length / n, m: tot / n, tot }; };
const COMBOS = [['4h', '4h', '15m'], ['4h', '4h', '5m'], ['4h', '1h', '15m'], ['4h', '1h', '5m'], ['4h', '15m', '5m'], ['1h', '1h', '15m'], ['1h', '1h', '5m'], ['1h', '15m', '5m']];
function grid() {
  const g = [];
  for (const [T, Lv, X] of COMBOS) for (const which of [48, 380, 0]) for (const tol of [0, 0.2]) for (const m of [0.3, 0.7]) for (const tp of [1, 1.5, 2, 'P']) for (const F of [6, 24]) for (const strict of [false, true]) g.push({ T, Lv, X, which, tol, m, tp, F, strict });
  return g;
}
function grid2() {
  const g = [];
  for (const [T, Lv, X] of COMBOS) for (const which of [48, 380, 0, 'zone']) for (const tol of [0, 0.2]) for (const m of [0.3, 0.7]) for (const tp of [1, 2, 3, 'P', 'T']) for (const conf of [false, true]) g.push({ T, Lv, X, which, tol, m, tp, F: 6, strict: false, conf });
  return g;
}
const name = (p) => `tren ${p.T} · level ${p.Lv} EMA${p.which === 'zone' ? ' zona 48–380' : p.which || '48+380'} · eksekusi ${p.X} · tol ${p.tol} · SL ${p.m}ATR · TP ${p.tp === 'P' ? '1R½+2R' : p.tp === 'T' ? 'ikut tren' : p.tp + 'R'}${p.conf ? ' · konfirmasi' : ''} · fresh ${p.F} · ${p.strict ? 'harga>EMA380' : 'cross'}`;
module.exports = { prepare, simulate, stats, grid, grid2, name, COMBOS, agg, MS, ema };

if (require.main === module) {
  const file = process.argv[2] || require('path').join(__dirname, '../../data/ema/SNDKUSDT-5m.csv'), fee = +(process.env.FEE || 0.0005);
  const SPLIT = Date.UTC(2026, 8, 1);
  const tf = prepare(Data.parseCSV(fs.readFileSync(file, 'utf8')));
  const res = grid().map((p) => { const tr = simulate(tf, p, fee); return { p, a: stats(tr.filter((x) => x.t < SPLIT)), b: stats(tr.filter((x) => x.t >= SPLIT)) }; });
  fs.writeFileSync(require('path').join(require('os').tmpdir(), 'grid-sndk.json'), JSON.stringify(res));
  const f = (s) => `n ${String(s.n).padStart(3)} WR ${isNaN(s.wr) ? ' -- ' : (100 * s.wr).toFixed(0).padStart(3) + '%'} R ${isNaN(s.m) ? '  --  ' : (s.m >= 0 ? '+' : '') + s.m.toFixed(3)}`;
  // 1) kombinasi timeframe: median semua setelan (gambaran umum, tidak memilih satu yang kebetulan bagus)
  console.log('=== Median per kombinasi timeframe (semua setelan) ===');
  for (const [T, Lv, X] of COMBOS) {
    const rs = res.filter((x) => x.p.T === T && x.p.Lv === Lv && x.p.X === X && x.a.n >= 10);
    const med = (arr) => { const v = arr.filter(isFinite).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : NaN; };
    console.log(`tren ${T.padEnd(3)} level ${Lv.padEnd(3)} eksekusi ${X.padEnd(3)} | sebelum Sep: R ${med(rs.map((x) => x.a.m)).toFixed(3)} WR ${(100 * med(rs.map((x) => x.a.wr))).toFixed(0)}% n~${med(rs.map((x) => x.a.n))} | Sep-Nov: R ${med(rs.map((x) => x.b.m)).toFixed(3)} WR ${(100 * med(rs.map((x) => x.b.wr))).toFixed(0)}% | setelan positif sebelum Sep ${rs.filter((x) => x.a.m > 0).length}/${rs.length}`);
  }
  // 2) aturan pilih (ditetapkan sebelum melihat Sep-Nov): n≥20, WR≥55%, R tertinggi sebelum Sep
  const cand = res.filter((x) => x.a.n >= 20 && x.a.wr >= 0.55).sort((p, q) => q.a.m - p.a.m);
  console.log(`\n=== 10 teratas sebelum Sep (n≥20, WR≥55%) dari ${cand.length} kandidat ===`);
  cand.slice(0, 10).forEach((x, k) => console.log(String(k + 1).padStart(2), name(x.p), '\n     sebelum Sep', f(x.a), '| Sep-Nov', f(x.b)));
  fs.writeFileSync(require('path').join(require('os').tmpdir(), 'pick-sndk.json'), JSON.stringify(cand.slice(0, 10).map((x) => x.p)));
}
