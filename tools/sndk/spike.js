// Fitur volume spike + konteks untuk SNDKUSDT (15m / 1h), label bracket, utilitas walk-forward
'use strict';
const fs = require('fs'), Data = require('../../js/data.js');
const DAY = 864e5;
const ema = (x, n) => { const o = new Float64Array(x.length).fill(NaN); let v = NaN, s = 0, c = 0; const a = 2 / (n + 1); for (let i = 0; i < x.length; i++) { if (isNaN(v)) { s += x[i]; c++; if (c >= n) v = s / n; o[i] = v; continue; } v = a * x[i] + (1 - a) * v; o[i] = v; } return o; };
const rma = (x, n) => { const o = new Float64Array(x.length).fill(NaN); let v = NaN, s = 0, c = 0; for (let i = 0; i < x.length; i++) { if (isNaN(x[i])) { o[i] = v; continue; } if (isNaN(v)) { s += x[i]; c++; if (c >= n) v = s / n; o[i] = v; continue; } v = (x[i] + (n - 1) * v) / n; o[i] = v; } return o; };
const sma = (x, n) => { const o = new Float64Array(x.length).fill(NaN); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const cl = (v, a, b) => (isFinite(v) ? Math.max(a, Math.min(b, v)) : 0);
function load(tf) { return Data.parseCSV(fs.readFileSync(`${process.env.SNDK_DATA || require('path').join(__dirname, '../../data/sndk')}/SNDKUSDT-${tf}.csv`, 'utf8')); }

const FEATS = ['vRel', 'vSlot', 'vZ', 'vSpikeDir', 'vMax4', 'barsSinceSpike', 'spikeDirLast', 'delta8', 'delta32', 'body', 'clv', 'rngAtr',
  't20', 't100', 't400', 'sl20', 'rsi', 'roc4', 'roc32', 'roc96', 'atrPct', 'atrReg', 'pos32', 'pos400', 'vwapD', 'dayPos', 'dPDH', 'dPDL', 'hs', 'hc', 'dow'];

// bpd = bar per hari (96 untuk 15m, 24 untuk 1h)
function features(bars, bpd) {
  const n = bars.length, C = bars.map((b) => b.close), H = bars.map((b) => b.high), L = bars.map((b) => b.low), V = bars.map((b) => b.volume), O = bars.map((b) => b.open);
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - C[i - 1]), Math.abs(b.low - C[i - 1])) : b.high - b.low));
  const atr = rma(tr, 14), atrL = sma(Array.from(atr).map((v) => (isNaN(v) ? 0 : v)), bpd * 10);
  const e20 = ema(C, 20), e100 = ema(C, 100), e400 = ema(C, 400);
  const up = C.map((c, i) => (i ? Math.max(c - C[i - 1], 0) : NaN)), dn = C.map((c, i) => (i ? Math.max(C[i - 1] - c, 0) : NaN));
  const ru = rma(up, 14), rd = rma(dn, 14);
  const vma = sma(V, bpd), lv = V.map((v) => Math.log(1 + v)), lvm = sma(lv, bpd), lvq = sma(lv.map((x) => x * x), bpd);
  const sv = V.map((v, i) => Math.sign(C[i] - O[i]) * v);
  const sv8 = sma(sv, 8), v8 = sma(V, 8), sv32 = sma(sv, 32), v32 = sma(V, 32);
  // rata-rata volume pada slot waktu yang sama (10 hari terakhir), tanpa candle sekarang
  const slot = new Float64Array(n).fill(NaN);
  for (let i = bpd * 10; i < n; i++) { let s = 0; for (let k = 1; k <= 10; k++) s += V[i - k * bpd]; slot[i] = s / 10; }
  const D = { H: new Float64Array(n).fill(NaN), L: new Float64Array(n).fill(NaN) };
  { let cur = null, prev = null, id = null; for (let i = 0; i < n; i++) { const k = Math.floor(bars[i].time / DAY); if (k !== id) { prev = cur; cur = { h: H[i], l: L[i] }; id = k; } else { cur.h = Math.max(cur.h, H[i]); cur.l = Math.min(cur.l, L[i]); } if (prev) { D.H[i] = prev.h; D.L[i] = prev.l; } } }
  // VWAP harian (UTC)
  const vwap = new Float64Array(n); { let id = null, pv = 0, vv = 0; for (let i = 0; i < n; i++) { const k = Math.floor(bars[i].time / DAY); if (k !== id) { id = k; pv = 0; vv = 0; } const tp = (H[i] + L[i] + C[i]) / 3; pv += tp * V[i]; vv += V[i]; vwap[i] = vv ? pv / vv : C[i]; } }
  const X = new Array(n), vSlotArr = new Float64Array(n).fill(NaN);
  let lastSpike = -1e9, lastSpikeDir = 0;
  const WARM = Math.max(400, bpd * 10 + 1);
  for (let i = 0; i < n; i++) {
    const a = atr[i], c = C[i];
    const vs = slot[i] > 0 ? V[i] / slot[i] : NaN; vSlotArr[i] = vs;
    if (vs >= 3) { lastSpike = i; lastSpikeDir = Math.sign(C[i] - O[i]); }
    if (i < WARM || !(a > 0)) { X[i] = null; continue; }
    const rng = Math.max(H[i] - L[i], 1e-12), sd = Math.sqrt(Math.max(lvq[i] - lvm[i] * lvm[i], 1e-9));
    let h32 = -Infinity, l32 = Infinity, h400 = -Infinity, l400 = Infinity, vm4 = 0;
    for (let k = 0; k < 32; k++) { h32 = Math.max(h32, H[i - k]); l32 = Math.min(l32, L[i - k]); }
    for (let k = 0; k < 400; k++) { h400 = Math.max(h400, H[i - k]); l400 = Math.min(l400, L[i - k]); }
    for (let k = 0; k < 4; k++) vm4 = Math.max(vm4, vSlotArr[i - k] || 0);
    const hr = new Date(bars[i].time).getUTCHours() + new Date(bars[i].time).getUTCMinutes() / 60;
    X[i] = [
      cl(V[i] / vma[i], 0, 20), cl(vs, 0, 20), cl((lv[i] - lvm[i]) / sd, -5, 5), cl(Math.sign(c - O[i]) * vs, -20, 20), cl(vm4, 0, 20),
      Math.min(i - lastSpike, 200) / bpd, lastSpikeDir, cl(sv8[i] / v8[i], -1, 1), cl(sv32[i] / v32[i], -1, 1),
      (c - O[i]) / rng, (2 * c - H[i] - L[i]) / rng, cl(rng / a, 0, 10),
      cl((c - e20[i]) / a, -15, 15), cl((c - e100[i]) / a, -30, 30), cl((c - e400[i]) / a, -60, 60), cl((e20[i] - e20[i - 4]) / a, -5, 5),
      rd[i] === 0 ? 1 : 1 - 1 / (1 + ru[i] / rd[i]),
      cl((c / C[i - 4] - 1) * 100, -20, 20), cl((c / C[i - 32] - 1) * 100, -40, 40), cl((c / C[i - bpd] - 1) * 100, -60, 60),
      (a / c) * 100, cl(a / atrL[i], 0, 5), (c - l32) / Math.max(h32 - l32, 1e-12), (c - l400) / Math.max(h400 - l400, 1e-12),
      cl((c - vwap[i]) / a, -20, 20), isNaN(D.H[i]) ? 0.5 : cl((c - D.L[i]) / Math.max(D.H[i] - D.L[i], 1e-12), -2, 3),
      isNaN(D.H[i]) ? 0 : cl((D.H[i] - c) / a, -30, 30), isNaN(D.L[i]) ? 0 : cl((c - D.L[i]) / a, -30, 30),
      Math.sin((2 * Math.PI * hr) / 24), Math.cos((2 * Math.PI * hr) / 24), new Date(bars[i].time).getUTCDay(),
    ];
  }
  return { X, atr, vSlot: vSlotArr };
}
// cermin untuk short
const NEG = [3, 6, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 24], INV = [16, 22, 23, 25];
function sym(x, d) { if (d === 1) return x; const y = x.slice(); for (const j of NEG) y[j] = -x[j]; for (const j of INV) y[j] = 1 - x[j]; y[26] = x[27]; y[27] = x[26]; return y; }

function label(bars, atr, i, d, ex, fee) {
  const n = bars.length; if (i + 1 >= n) return null;
  const fill = bars[i + 1].open, rk = ex.k * atr[i], t1 = fill + d * rk * ex.r1, t2 = fill + d * rk * ex.r2;
  let sl = fill - d * rk, rem = 1, acc = 0, h1 = false;
  const R = (p) => ((p - fill) * d) / rk, cost = (2 * fee * fill) / rk;
  for (let j = i + 1; j < n; j++) {
    const b = bars[j];
    if (d === 1 ? b.low <= sl : b.high >= sl) { const px = j === i + 1 ? sl : d === 1 ? Math.min(sl, b.open) : Math.max(sl, b.open); return { r: acc + rem * R(px) - cost, exit: j }; }
    if (!h1 && (d === 1 ? b.high >= t1 : b.low <= t1)) { h1 = true; acc += ex.w1 * R(t1); rem -= ex.w1; sl = fill; }
    if (h1 && (d === 1 ? b.high >= t2 : b.low <= t2)) return { r: acc + rem * R(t2) - cost, exit: j };
    if (j - i >= ex.maxB) return { r: acc + rem * R(b.close) - cost, exit: j };
  }
  return null;
}
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
module.exports = { load, features, sym, label, FEATS, monthOf, DAY };
