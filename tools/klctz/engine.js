// Mesin riset KLCTZ: replika logika Pine (zona, sinyal, rencana) + simulasi ala broker + fitur ML.
'use strict';
const DAY = 864e5, WEEK = 7 * DAY;

function rmaSeries(x, len) { const o = new Array(x.length).fill(NaN); let v = NaN, seed = []; const a = 1 / len; for (let i = 0; i < x.length; i++) { if (isNaN(v)) { seed.push(x[i]); if (seed.length >= len) { v = seed.reduce((s, c) => s + c, 0) / len; } o[i] = v; continue; } v = a * x[i] + (1 - a) * v; o[i] = v; } return o; }
function emaSeries(x, len) { const o = new Array(x.length).fill(NaN); let v = NaN, seed = []; const a = 2 / (len + 1); for (let i = 0; i < x.length; i++) { if (isNaN(v)) { seed.push(x[i]); if (seed.length >= len) v = seed.reduce((s, c) => s + c, 0) / len; o[i] = v; continue; } v = a * x[i] + (1 - a) * v; o[i] = v; } return o; }
function smaSeries(x, len) { const o = new Array(x.length).fill(NaN); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= len) s -= x[i - len]; if (i >= len - 1) o[i] = s / len; } return o; }

// HTF: candle sebelumnya (lookahead on, [1]) dari agregasi bar chart
function htfPrev(bars, bucketOf) {
  const n = bars.length, H = new Array(n).fill(NaN), L = new Array(n).fill(NaN), C = new Array(n).fill(NaN);
  let cur = null, prev = null, id = null;
  for (let i = 0; i < n; i++) {
    const b = bars[i], k = bucketOf(b.time);
    if (k !== id) { prev = cur; cur = { h: b.high, l: b.low, c: b.close }; id = k; }
    else { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; }
    if (prev) { H[i] = prev.h; L[i] = prev.l; C[i] = prev.c; }
  }
  return { H, L, C };
}
function piv(pt, h, l, c) {
  const p = (h + l + c) / 3, rg = h - l;
  if (pt === 0) return [p, 2 * p - l, p + rg, h + 2 * (p - l), 2 * p - h, p - rg, l - 2 * (h - p)];
  if (pt === 1) return [p, p + 0.382 * rg, p + 0.618 * rg, p + rg, p - 0.382 * rg, p - 0.618 * rg, p - rg];
  return [p, c + rg * 1.1 / 12, c + rg * 1.1 / 6, c + rg * 1.1 / 4, c - rg * 1.1 / 12, c - rg * 1.1 / 6, c - rg * 1.1 / 4];
}
function mintickOf(bars) { let dec = 0; for (let k = Math.max(0, bars.length - 200); k < bars.length; k++) for (const v of [bars[k].open, bars[k].close]) { const s = String(v); const d = s.includes('e-') ? 8 : s.includes('.') ? s.split('.')[1].length : 0; if (d > dec) dec = d; } return Math.pow(10, -dec); }

// Seri dasar yang tidak bergantung pada konfigurasi
function base(bars) {
  const n = bars.length;
  const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
  const atr = rmaSeries(tr, 14);
  const vol = bars.map((b) => b.volume || 0);
  const vma = smaSeries(vol, 20);
  let cum = 0; const hasVol = vol.map((v) => (cum += v) > 0);
  const act = bars.map((b, i) => (hasVol[i] ? vol[i] / Math.max(isNaN(vma[i]) ? 0 : vma[i], 1e-9) : (b.high - b.low) / Math.max(isNaN(atr[i]) ? 0 : atr[i], 1e-9)));
  const D = htfPrev(bars, (t) => Math.floor(t / DAY)), W = htfPrev(bars, (t) => Math.floor((t - 4 * DAY) / WEEK));
  const close = bars.map((b) => b.close);
  const ema50 = emaSeries(close, 50), ema200 = emaSeries(close, 200);
  // RSI 14 (rma)
  const up = close.map((c, i) => (i ? Math.max(c - close[i - 1], 0) : NaN)), dn = close.map((c, i) => (i ? Math.max(close[i - 1] - c, 0) : NaN));
  const ru = rmaSeries(up.slice(1), 14), rd = rmaSeries(dn.slice(1), 14);
  const rsi = [NaN].concat(ru.map((u, k) => (rd[k] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[k]))));
  return { n, atr, act, D, W, ema50, ema200, rsi, mintick: mintickOf(bars), bars };
}

function swings(bars, len) {
  const n = bars.length, sh1 = new Array(n).fill(NaN), sh2 = new Array(n).fill(NaN), sl1 = new Array(n).fill(NaN), sl2 = new Array(n).fill(NaN);
  let a = NaN, b = NaN, c = NaN, d = NaN;
  for (let i = 0; i < n; i++) {
    const m = i - len;
    if (m - len >= 0) {
      const ch = bars[m].high, cl = bars[m].low; let isH = true, isL = true;
      for (let k = m - len; k <= i; k++) { if (k === m) continue; const after = k > m; if (bars[k].high > ch || (after && bars[k].high === ch)) isH = false; if (bars[k].low < cl || (after && bars[k].low === cl)) isL = false; }
      if (isH) { b = a; a = ch; }
      if (isL) { d = c; c = cl; }
    }
    sh1[i] = a; sh2[i] = b; sl1[i] = c; sl2[i] = d;
  }
  return { sh1, sh2, sl1, sl2 };
}

// zona per bar: [{t,b,score,cnt,wk}] untuk konfigurasi zona
function zones(B, z) {
  const { bars, n, atr } = B, sw = swings(bars, z.swing), out = new Array(n);
  for (let i = 0; i < n; i++) {
    const lv = [];
    const add = (v, src, tier) => { if (!isNaN(v)) lv.push([v, src, tier]); };
    const c = bars[i].close;
    if (!isNaN(B.D.H[i])) { const [p, r1, r2, r3, s1, s2, s3] = piv(z.piv, B.D.H[i], B.D.L[i], B.D.C[i]); add(B.D.H[i], 0, 1); add(B.D.L[i], 0, 1); add(B.D.C[i], 0, 1); for (const v of [p, r1, r2, r3, s1, s2, s3]) add(v, 1, 1); }
    if (!isNaN(B.W.H[i])) { const [p, r1, , , s1] = piv(z.piv, B.W.H[i], B.W.L[i], B.W.C[i]); add(B.W.H[i], 0, 2); add(B.W.L[i], 0, 2); add(p, 1, 2); add(r1, 1, 2); add(s1, 1, 2); }
    add(sw.sh1[i], 0, 3); add(sw.sh2[i], 0, 3); add(sw.sl1[i], 0, 3); add(sw.sl2[i], 0, 3);
    if (z.round && c > 0) { const st = Math.pow(10, Math.floor(Math.log10(c)) - 1) * 5; const dn = Math.floor(c / st) * st; add(dn, 1, 0); add(dn + st, 1, 0); }
    const zs = [];
    if (lv.length >= 2 && !isNaN(atr[i])) {
      const idx = lv.map((_, k) => k).sort((p, q) => (lv[p][0] > lv[q][0] ? 1 : lv[p][0] < lv[q][0] ? -1 : p - q));
      const tol = z.tol * atr[i];
      let g = null;
      const fin = () => { if (g && g.cnt >= z.minSrc && g.S && g.F) { const mid = (g.lo + g.hi) / 2, h = Math.max(g.hi - g.lo, 0.12 * atr[i]); zs.push({ t: mid + h / 2, b: mid - h / 2, score: Math.min(100, Math.min(g.cnt, 5) * 18 + (g.W ? 8 : 0) + (g.Sw ? 6 : 0)), cnt: g.cnt, wk: g.W }); } };
      for (const j of idx) {
        const [v, src, tier] = lv[j];
        if (!g || v - g.hi > tol || v - g.lo > 2 * tol) { fin(); g = { cnt: 0, S: false, F: false, W: false, Sw: false, lo: v, hi: v }; }
        g.hi = v; g.cnt++; g.S = g.S || src === 0; g.F = g.F || src === 1; g.W = g.W || tier === 2; g.Sw = g.Sw || tier === 3;
      }
      fin();
    }
    out[i] = zs;
  }
  return out;
}

const PROF = [
  { minS: 36, wk: 0.35, bd: 0.5, buf: 0.1, act: 0.9, rs: 1, slm: 1 },
  { minS: 54, wk: 0.45, bd: 0.6, buf: 0.15, act: 1.1, rs: 1, slm: 1 },
  { minS: 36, wk: 0.3, bd: 0.45, buf: 0.05, act: 0.8, rs: 0.75, slm: 0.75 },
  { minS: 36, wk: 0.4, bd: 0.55, buf: 0.2, act: 1.0, rs: 1.5, slm: 1.5 },
];

// sinyal pada bar i (f_signal + f_plan) → null atau objek rencana + fitur
function signalAt(B, Z, i, P, cfg) {
  const { bars, atr, act, mintick } = B, b = bars[i], a = atr[i], zs = Z[i];
  if (i < 1 || isNaN(a) || !zs.length || act[i] < P.act) return null;
  const pc = bars[i - 1].close, rng = Math.max(b.high - b.low, mintick);
  const lw = (Math.min(b.open, b.close) - b.low) / rng, uw = (b.high - Math.max(b.open, b.close)) / rng, bodyR = Math.abs(b.close - b.open) / rng;
  let dir = 0, kind = 0, zi = -1, best = -1;
  for (let k = 0; k < zs.length; k++) {
    const { t, b: bt, score: s } = zs[k];
    if (!(s >= P.minS && s > best)) continue;
    let d = 0, kk = 0;
    if (cfg.mode !== 2) {
      if (b.low <= t && b.low >= bt - 0.5 * a && b.close > t && b.close > b.open && lw >= P.wk && pc > bt) { d = 1; kk = 1; }
      else if (b.high >= bt && b.high <= t + 0.5 * a && b.close < bt && b.close < b.open && uw >= P.wk && pc < t) { d = -1; kk = 1; }
    }
    if (d === 0 && cfg.mode !== 1) {
      if (pc <= t && b.close > t + P.buf * a && b.close > b.open && bodyR >= P.bd) { d = 1; kk = 2; }
      else if (pc >= bt && b.close < bt - P.buf * a && b.close < b.open && bodyR >= P.bd) { d = -1; kk = 2; }
    }
    if (d !== 0 && (!cfg.side || d === cfg.side)) { dir = d; kind = kk; zi = k; best = s; }
  }
  if (!dir) return null;
  const Zn = zs[zi], e = b.close;
  let s = dir === 1 ? Math.min(Zn.b, b.low) - cfg.slBuf * P.slm * a : Math.max(Zn.t, b.high) + cfg.slBuf * P.slm * a;
  const rk = Math.min(Math.max(Math.abs(e - s), 0.5 * a), 3 * a);
  s = e - dir * rk;
  const t1 = e + dir * rk * cfg.r1 * P.rs, t3 = e + dir * rk * cfg.r3 * P.rs; let t2 = e + dir * rk * cfg.r2 * P.rs;
  let opp = Infinity;
  for (const zz of zs) { const edge = dir === 1 ? zz.b : zz.t; if ((edge - e) * dir > 0) opp = Math.min(opp, Math.abs(edge - e)); }
  if (cfg.magnet) {
    let be = NaN, bd = 1e18;
    for (const zz of zs) { const edge = dir === 1 ? zz.b : zz.t; const inside = dir === 1 ? edge > t1 && edge < t3 : edge < t1 && edge > t3; if (inside && Math.abs(edge - e) < bd) { bd = Math.abs(edge - e); be = edge; } }
    if (!isNaN(be)) { const snap = be - dir * 0.05 * a; t2 = dir === 1 ? Math.max(snap, t1 + mintick) : Math.min(snap, t1 - mintick); }
  }
  // fitur ML (semua dihitung dari data sampai bar i)
  const f = {
    dir, hold: kind === 1 ? 1 : 0, cnt: Zn.cnt, score: Zn.score / 100, wk: Zn.wk ? 1 : 0,
    zoneH: (Zn.t - Zn.b) / a, riskAtr: rk / a, act: Math.min(act[i], 5), body: bodyR, wick: dir === 1 ? lw : uw,
    trend200: Math.max(-10, Math.min(10, ((e - B.ema200[i]) / a) * dir)), trend50: Math.max(-10, Math.min(10, ((e - B.ema50[i]) / a) * dir)),
    slope50: Math.max(-3, Math.min(3, ((B.ema50[i] - B.ema50[Math.max(0, i - 10)]) / a) * dir)),
    rsi: ((B.rsi[i] - 50) / 50) * dir, atrPct: (a / e) * 100, room: Math.min(opp / rk, 5),
    dayPos: isNaN(B.D.H[i]) ? 0 : Math.max(-2, Math.min(3, ((e - B.D.L[i]) / Math.max(B.D.H[i] - B.D.L[i], mintick) - 0.5) * dir)),
    wkPos: isNaN(B.W.H[i]) ? 0 : Math.max(-2, Math.min(3, ((e - B.W.L[i]) / Math.max(B.W.H[i] - B.W.L[i], mintick) - 0.5) * dir)),
  };
  return { i, time: b.time, dir, kind, e, s, rk, t1, t2, t3, f };
}

// simulasi ala broker: isi di open bar berikutnya, stop dicek dulu, BE setelah TP1, time exit di close
function simulate(B, sig, cfg) {
  const { bars } = B, n = bars.length, d = sig.dir;
  if (sig.i + 1 >= n) return null;
  const fill = bars[sig.i + 1].open;
  if ((d === 1 && fill <= sig.s) || (d === -1 && fill >= sig.s) || (d === 1 && fill >= sig.t1) || (d === -1 && fill <= sig.t1)) return { r: -0.0 - (0.002 * fill) / sig.rk, exit: sig.i + 1, skip: true }; // gap melewati level: anggap batal (biaya saja)
  let sl = sig.s, rem = 1, acc = 0, h1 = false, h2 = false;
  const w1 = cfg.w1, w2 = cfg.w2, R = (p) => ((p - fill) * d) / sig.rk;
  for (let j = sig.i + 1; j < n; j++) {
    const b = bars[j];
    const stopHit = d === 1 ? b.low <= sl : b.high >= sl;
    if (stopHit) { const px = d === 1 ? Math.min(sl, b.open) : Math.max(sl, b.open); acc += rem * R(j === sig.i + 1 ? sl : px); return { r: acc - (0.002 * fill) / sig.rk, exit: j }; }
    if (!h1 && (d === 1 ? b.high >= sig.t1 : b.low <= sig.t1)) { h1 = true; acc += w1 * R(sig.t1); rem -= w1; sl = fill; if (rem <= 1e-9) return { r: acc - (0.002 * fill) / sig.rk, exit: j }; }
    if (h1 && !h2 && (d === 1 ? b.high >= sig.t2 : b.low <= sig.t2)) { h2 = true; acc += w2 * R(sig.t2); rem -= w2; if (rem <= 1e-9) return { r: acc - (0.002 * fill) / sig.rk, exit: j }; }
    if (h2 && (d === 1 ? b.high >= sig.t3 : b.low <= sig.t3)) { acc += rem * R(sig.t3); return { r: acc - (0.002 * fill) / sig.rk, exit: j }; }
    if (j - sig.i >= cfg.maxBars) { acc += rem * R(b.close); return { r: acc - (0.002 * fill) / sig.rk, exit: j }; }
  }
  return null; // belum selesai
}

// semua sinyal (independen) + hasilnya
function allSignals(B, Z, cfg) {
  const P = PROF[cfg.prof], out = [];
  for (let i = 1; i < B.n; i++) { const s = signalAt(B, Z, i, P, cfg); if (!s) continue; const r = simulate(B, s, cfg); if (!r) continue; s.r = r.r; s.exit = r.exit; out.push(s); }
  return out;
}
// ambil berurutan (satu posisi sekaligus), opsional filter
function sequential(sigs, keep) {
  const out = []; let busy = -1;
  for (const s of sigs) { if (s.i < busy) continue; if (keep && !keep(s)) continue; out.push(s); busy = s.exit; }
  return out;
}
module.exports = { base, zones, allSignals, sequential, signalAt, simulate, PROF };
