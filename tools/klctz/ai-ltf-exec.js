// Simulasi eksekusi LTF (15m/5m) untuk sinyal Luna AI 1H (walk-forward, tanpa lookahead).
'use strict';
const fs = require('fs'), Data = require('../../js/data.js');
const H = 3600e3;
const FEE = +(process.env.FEE || 0.001), FEE_IN = +(process.env.FEE_IN || FEE), FEE_OUT = +(process.env.FEE_OUT || FEE);

function loadLTF(file) {
  const b = Data.parseCSV(fs.readFileSync(file, 'utf8'));
  for (const x of b) if (x.time > 1e14) x.time = Math.floor(x.time / 1000); // arsip spot 2025+: mikrodetik
  b.sort((p, q) => p.time - q.time);
  return b;
}
function idxAt(bars, t) { let lo = 0, hi = bars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].time < t) lo = m + 1; else hi = m; } return lo; }

// kelola posisi dari bar j0 (entry di open/limit sudah terjadi di harga fill pada bar jf)
function manage(L, jf, fill, d, sl0, t1, t2, tEnd, fromFillBar) {
  let sl = sl0, rem = 1, acc = 0, h1 = false;
  const risk = Math.abs(fill - sl0), R = (p) => ((p - fill) * d) / risk, cost = ((FEE_IN + FEE_OUT) * fill) / risk;
  for (let j = jf; j < L.length; j++) {
    const b = L[j];
    if (b.time + (L[1].time - L[0].time) > tEnd) return { r: acc + rem * R(b.open) - cost, exitT: b.time, risk };
    const first = j === jf && fromFillBar;
    if (d === 1 ? b.low <= sl : b.high >= sl) { const px = first ? sl : d === 1 ? Math.min(sl, b.open) : Math.max(sl, b.open); return { r: acc + rem * R(px) - cost, exitT: b.time, risk }; }
    if (!h1 && (d === 1 ? b.high >= t1 : b.low <= t1)) { h1 = true; acc += 0.5 * R(t1); rem -= 0.5; sl = fill; }
    if (h1 && (d === 1 ? b.high >= t2 : b.low <= t2)) return { r: acc + rem * R(t2) - cost, exitT: b.time, risk };
  }
  return null;
}

// satu sinyal → hasil eksekusi (atau null = tidak terisi)
function execute(L, sig, m) {
  const d = sig.d, a = sig.a, rk = 3 * a, t0 = sig.t + H; // candle sinyal close
  const tEnd = t0 + 72 * H;
  const j0 = idxAt(L, t0); if (j0 >= L.length || L[j0].time - t0 > 2 * H) return null;
  if (m.kind === 'E0') {
    const fill = L[j0].open;
    return manage(L, j0, fill, d, fill - d * rk, fill + d * rk, fill + 2 * d * rk, tEnd, false);
  }
  if (m.kind === 'E1') { // limit pullback, SL/TP di harga rencana (dari close sinyal)
    const lim = sig.c - d * m.x * a, sl = sig.c - d * rk, t1 = sig.c + d * rk, t2 = sig.c + 2 * d * rk;
    for (let j = j0; j < L.length && L[j].time < t0 + m.w * H; j++) {
      const b = L[j];
      if (d === 1 ? b.high >= t1 : b.low <= t1) return { miss: true, exitT: b.time }; // harga lari ke TP1 sebelum terisi → batal
      if (d === 1 ? b.low <= lim : b.high >= lim) { const fill = d === 1 ? Math.min(lim, b.open) : Math.max(lim, b.open); if (d === 1 ? fill <= sl : fill >= sl) return { miss: true, exitT: b.time }; return manage(L, j, fill, d, sl, t1, t2, tEnd, true); }
    }
    return { miss: true, exitT: t0 + m.w * H };
  }
  if (m.kind === 'E2') { // trigger breakout LTF + SL swing LTF
    const N = m.n || 4, M = m.sw || 8;
    for (let j = Math.max(j0, M); j < L.length - 1 && L[j].time < t0 + m.w * H; j++) {
      let hh = -Infinity, ll = Infinity; for (let k = 1; k <= N; k++) { hh = Math.max(hh, L[j - k].high); ll = Math.min(ll, L[j - k].low); }
      const trig = d === 1 ? L[j].close > hh : L[j].close < ll;
      if (!trig) continue;
      let sw = d === 1 ? Infinity : -Infinity; for (let k = 0; k < M; k++) sw = d === 1 ? Math.min(sw, L[j - k].low) : Math.max(sw, L[j - k].high);
      const fill = L[j + 1].open;
      let risk = Math.abs(fill - sw) + 0.1 * a; risk = Math.min(Math.max(risk, m.minR * a), 3 * a);
      const sl = fill - d * risk;
      return manage(L, j + 1, fill, d, sl, fill + d * risk * (m.r1 || 1), fill + d * risk * (m.r2 || 2), tEnd, false);
    }
    return { miss: true, exitT: t0 + m.w * H };
  }
}

function run(signals, ltfDir, tf, methods, coins) {
  const by = {}; for (const s of signals) if (!coins || coins.includes(s.coin)) (by[s.coin] = by[s.coin] || []).push(s);
  const res = {}; for (const k of Object.keys(methods)) res[k] = { R: [], miss: 0, coinSum: {} };
  for (const [coin, list] of Object.entries(by)) {
    const f = `${ltfDir}/${coin}-${tf}.csv`; if (!fs.existsSync(f)) continue;
    const L = loadLTF(f); const tMax = L[L.length - 1].time - 80 * H, tMin = L[0].time + 24 * H;
    list.sort((p, q) => p.t - q.t);
    for (const [k, m] of Object.entries(methods)) {
      let busy = -Infinity;
      for (const s of list) {
        if (s.t < tMin || s.t > tMax || s.t + H <= busy) continue;
        const o = execute(L, s, m); if (!o) continue;
        busy = o.exitT;
        if (o.miss) { res[k].miss++; continue; }
        res[k].R.push(o.r); res[k].coinSum[coin] = (res[k].coinSum[coin] || 0) + o.r;
      }
    }
  }
  return res;
}
const fmt = (o, days) => { const R = o.R, m = R.reduce((s, v) => s + v, 0) / R.length, sd = Math.sqrt(R.reduce((s, v) => s + (v - m) ** 2, 0) / R.length); return `n ${String(R.length).padStart(5)} (${(R.length / days).toFixed(2)}/hari total) batal ${String(o.miss).padStart(4)} WR ${(100 * R.filter((x) => x > 0).length / R.length).toFixed(1)}% R/trade ${m >= 0 ? '+' : ''}${m.toFixed(3)} total ${(m * R.length).toFixed(0)}R t ${(m / sd * Math.sqrt(R.length)).toFixed(2)} koin+ ${Object.values(o.coinSum).filter((v) => v > 0).length}/${Object.keys(o.coinSum).length}`; };
module.exports = { run, execute, loadLTF, fmt };

if (require.main === module) {
  const sig = JSON.parse(fs.readFileSync(__dirname + '/' + (process.env.SIG || 'signals.json'), 'utf8'));
  const tf = process.env.TF || '15m', dir = process.env.LTF_DIR || require('path').join(__dirname, '../../data'), suffix = process.env.SUF !== undefined ? process.env.SUF : '-90000';
  const methods = JSON.parse(process.env.M || JSON.stringify({
    'E0 langsung': { kind: 'E0' },
    'E1 pullback 0.25ATR 4j': { kind: 'E1', x: 0.25, w: 4 },
    'E1 pullback 0.5ATR 4j': { kind: 'E1', x: 0.5, w: 4 },
    'E1 pullback 0.5ATR 12j': { kind: 'E1', x: 0.5, w: 12 },
    'E2 trigger SL swing (min 1ATR)': { kind: 'E2', w: 6, minR: 1 },
    'E2 trigger SL swing (min 0.5ATR)': { kind: 'E2', w: 6, minR: 0.5 },
    'E2 trigger SL swing (min 1.5ATR)': { kind: 'E2', w: 6, minR: 1.5 },
  }));
  // salin file agar nama {coin}-{tf}.csv
  const tmp = __dirname + '/ltf-' + tf; fs.mkdirSync(tmp, { recursive: true });
  for (const f of fs.readdirSync(dir)) { const mm = f.match(new RegExp(`^([A-Z0-9]+)-${tf}${suffix}\\.csv$`)); if (mm && !fs.existsSync(`${tmp}/${mm[1]}-${tf}.csv`)) fs.symlinkSync(`${dir}/${f}`, `${tmp}/${mm[1]}-${tf}.csv`); }
  const res = run(sig, tmp, tf, methods);
  const days = (Date.UTC(2026, 9, 24) - Date.UTC(2025, 0, 1)) / 864e5;
  for (const [k, o] of Object.entries(res)) console.log(k.padEnd(34), fmt(o, days));
}
