/*
 * Luna — library indikator teknikal (setara namespace `ta.` di Pine Script).
 * Setiap fungsi menerima `st` (state per call-site) sebagai argumen pertama,
 * lalu argumen seperti di Pine. `R` adalah konteks bar yang sedang berjalan.
 */
(function (root) {
  'use strict';

  const isNa = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));
  const sub = (st, k) => st[k] || (st[k] = {});

  // Menyimpan `len` nilai terakhir (paling baru di akhir).
  function win(st, v, len) {
    const b = st.b || (st.b = []);
    b.push(v);
    while (b.length > len) b.shift();
    return b;
  }
  // Riwayat nilai (paling baru di akhir) untuk akses src[n].
  function hist(st, v, keep) {
    const b = st.h || (st.h = []);
    b.push(v);
    while (b.length > keep) b.shift();
    return b;
  }

  function makeTA(R) {
    const ta = {};

    ta.sma = (st, src, len) => {
      len = Math.max(1, Math.round(len));
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      let s = 0;
      for (let k = 0; k < len; k++) { if (isNa(b[k])) return NaN; s += b[k]; }
      return s / len;
    };

    function emaLike(st, src, len, alpha) {
      len = Math.max(1, Math.round(len));
      if (isNa(src)) return isNa(st.v) ? NaN : st.v;
      if (isNa(st.v)) {
        st.seed = st.seed || [];
        st.seed.push(src);
        if (st.seed.length < len) return NaN;
        st.v = st.seed.reduce((a, c) => a + c, 0) / len;
        st.seed = null;
        return st.v;
      }
      st.v = alpha * src + (1 - alpha) * st.v;
      return st.v;
    }
    ta.ema = (st, src, len) => emaLike(st, src, len, 2 / (Math.round(len) + 1));
    ta.rma = (st, src, len) => emaLike(st, src, len, 1 / Math.round(len));

    ta.wma = (st, src, len) => {
      len = Math.max(1, Math.round(len));
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      let s = 0, w = 0;
      for (let k = 0; k < len; k++) { if (isNa(b[k])) return NaN; s += b[k] * (k + 1); w += k + 1; }
      return s / w;
    };

    ta.hma = (st, src, len) => {
      const half = ta.wma(sub(st, 'a'), src, Math.floor(len / 2));
      const full = ta.wma(sub(st, 'b'), src, len);
      return ta.wma(sub(st, 'c'), 2 * half - full, Math.floor(Math.sqrt(len)));
    };

    ta.vwma = (st, src, len) =>
      ta.sma(sub(st, 'a'), src * R.volume, len) / ta.sma(sub(st, 'b'), R.volume, len);

    ta.swma = (st, src) => {
      const b = win(st, src, 4);
      if (b.length < 4) return NaN;
      return (b[0] + 2 * b[1] + 2 * b[2] + b[3]) / 6;
    };

    ta.stdev = (st, src, len, biased) => {
      len = Math.max(1, Math.round(len));
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      let m = 0;
      for (const v of b) { if (isNa(v)) return NaN; m += v; }
      m /= len;
      let s = 0;
      for (const v of b) s += (v - m) * (v - m);
      return Math.sqrt(s / (biased === false ? len - 1 : len));
    };
    ta.variance = (st, src, len, biased) => {
      const sd = ta.stdev(st, src, len, biased);
      return sd * sd;
    };
    ta.dev = (st, src, len) => {
      len = Math.max(1, Math.round(len));
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      const m = b.reduce((a, c) => a + c, 0) / len;
      return b.reduce((a, c) => a + Math.abs(c - m), 0) / len;
    };

    ta.change = (st, src, len) => {
      len = len === undefined ? 1 : Math.round(len);
      const h = hist(st, src, len + 1);
      if (h.length <= len) return NaN;
      const prev = h[h.length - 1 - len];
      if (typeof src === 'boolean') return src !== prev;
      return src - prev;
    };
    ta.mom = (st, src, len) => ta.change(st, src, len);
    ta.roc = (st, src, len) => {
      len = Math.round(len);
      const h = hist(st, src, len + 1);
      if (h.length <= len) return NaN;
      const prev = h[h.length - 1 - len];
      return (100 * (src - prev)) / prev;
    };

    ta.rsi = (st, src, len) => {
      const prev = st.p;
      st.p = src;
      if (isNa(prev) || isNa(src)) return NaN;
      const ch = src - prev;
      const up = ta.rma(sub(st, 'u'), Math.max(ch, 0), len);
      const dn = ta.rma(sub(st, 'd'), -Math.min(ch, 0), len);
      if (isNa(up) || isNa(dn)) return NaN;
      if (dn === 0) return 100;
      if (up === 0) return 0;
      return 100 - 100 / (1 + up / dn);
    };

    ta.macd = (st, src, fast, slow, sig) => {
      const m = ta.ema(sub(st, 'f'), src, fast) - ta.ema(sub(st, 's'), src, slow);
      const s = ta.ema(sub(st, 'g'), m, sig);
      return [m, s, m - s];
    };

    ta.bb = (st, src, len, mult) => {
      const basis = ta.sma(sub(st, 'm'), src, len);
      const dev = mult * ta.stdev(sub(st, 'd'), src, len);
      return [basis, basis + dev, basis - dev];
    };
    ta.bbw = (st, src, len, mult) => {
      const [b, u, l] = ta.bb(st, src, len, mult);
      return ((u - l) / b) * 100;
    };

    ta.kc = (st, src, len, mult, useTrueRange) => {
      const basis = ta.ema(sub(st, 'm'), src, len);
      const range = useTrueRange === false ? R.high - R.low : ta.tr(sub(st, 't'), true);
      const r = ta.ema(sub(st, 'r'), range, len);
      return [basis, basis + r * mult, basis - r * mult];
    };

    ta.tr = (st, handleNa) => {
      const pc = R.prevClose;
      if (isNa(pc)) return handleNa === false ? NaN : R.high - R.low;
      return Math.max(R.high - R.low, Math.abs(R.high - pc), Math.abs(R.low - pc));
    };
    ta.atr = (st, len) => ta.rma(sub(st, 'r'), ta.tr(sub(st, 't'), true), len);

    ta.supertrend = (st, factor, atrPeriod) => {
      const src = (R.high + R.low) / 2;
      const atr = ta.atr(sub(st, 'a'), atrPeriod);
      let up = src + factor * atr;
      let lo = src - factor * atr;
      const pLo = isNa(st.lo) ? 0 : st.lo;
      const pUp = isNa(st.up) ? 0 : st.up;
      const pc = R.prevClose;
      lo = lo > pLo || pc < pLo ? lo : pLo;
      up = up < pUp || pc > pUp ? up : pUp;
      let dir;
      if (isNa(st.prevAtr)) dir = 1;
      else if (st.st === pUp) dir = R.close > up ? -1 : 1;
      else dir = R.close < lo ? 1 : -1;
      const val = dir === -1 ? lo : up;
      st.prevAtr = atr;
      st.lo = lo; st.up = up; st.st = val;
      return [val, dir];
    };

    ta.highest = (st, src, len) => {
      if (len === undefined) { len = src; src = R.high; }
      len = Math.max(1, Math.round(len));
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      return Math.max(...b);
    };
    ta.lowest = (st, src, len) => {
      if (len === undefined) { len = src; src = R.low; }
      len = Math.max(1, Math.round(len));
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      return Math.min(...b);
    };
    ta.highestbars = (st, src, len) => {
      if (len === undefined) { len = src; src = R.high; }
      const b = win(st, src, Math.round(len));
      if (b.length < len) return NaN;
      const m = Math.max(...b);
      return -(b.length - 1 - b.lastIndexOf(m));
    };
    ta.lowestbars = (st, src, len) => {
      if (len === undefined) { len = src; src = R.low; }
      const b = win(st, src, Math.round(len));
      if (b.length < len) return NaN;
      const m = Math.min(...b);
      return -(b.length - 1 - b.lastIndexOf(m));
    };

    ta.crossover = (st, a, b) => {
      const r = !isNa(st.a) && !isNa(st.b) && a > b && st.a <= st.b;
      st.a = a; st.b = b;
      return r;
    };
    ta.crossunder = (st, a, b) => {
      const r = !isNa(st.a) && !isNa(st.b) && a < b && st.a >= st.b;
      st.a = a; st.b = b;
      return r;
    };
    ta.cross = (st, a, b) => {
      const r = !isNa(st.a) && !isNa(st.b) && ((a > b && st.a <= st.b) || (a < b && st.a >= st.b));
      st.a = a; st.b = b;
      return r;
    };

    ta.cum = (st, src) => {
      st.s = (st.s || 0) + (isNa(src) ? 0 : src);
      return st.s;
    };

    ta.vwap = (st, src) => {
      if (src === undefined) src = (R.high + R.low + R.close) / 3;
      const day = Math.floor(R.time / 86400000);
      if (st.day !== day) { st.day = day; st.pv = 0; st.v = 0; }
      st.pv += src * R.volume;
      st.v += R.volume;
      return st.v ? st.pv / st.v : NaN;
    };

    ta.obv = (st) => {
      const pc = R.prevClose;
      const d = isNa(pc) ? 0 : Math.sign(R.close - pc);
      st.s = (st.s || 0) + d * R.volume;
      return st.s;
    };

    ta.stoch = (st, src, high, low, len) => {
      const hh = ta.highest(sub(st, 'h'), high, len);
      const ll = ta.lowest(sub(st, 'l'), low, len);
      return (100 * (src - ll)) / (hh - ll);
    };

    ta.cci = (st, src, len) => {
      const m = ta.sma(sub(st, 'm'), src, len);
      const d = ta.dev(sub(st, 'd'), src, len);
      return (src - m) / (0.015 * d);
    };

    ta.mfi = (st, src, len) => {
      const prev = st.p;
      st.p = src;
      const mf = src * R.volume;
      const up = ta.sma(sub(st, 'u'), !isNa(prev) && src > prev ? mf : 0, len) * len;
      const dn = ta.sma(sub(st, 'd'), !isNa(prev) && src < prev ? mf : 0, len) * len;
      if (isNa(prev)) return NaN;
      return 100 - 100 / (1 + up / dn);
    };

    ta.dmi = (st, diLen, adxLen) => {
      const ph = st.ph, pl = st.pl;
      st.ph = R.high; st.pl = R.low;
      const upM = isNa(ph) ? NaN : R.high - ph;
      const dnM = isNa(pl) ? NaN : pl - R.low;
      const plusDM = isNa(upM) ? NaN : upM > dnM && upM > 0 ? upM : 0;
      const minusDM = isNa(dnM) ? NaN : dnM > upM && dnM > 0 ? dnM : 0;
      const trur = ta.rma(sub(st, 't'), ta.tr(sub(st, 'tt'), true), diLen);
      const plus = (100 * ta.rma(sub(st, 'p'), plusDM, diLen)) / trur;
      const minus = (100 * ta.rma(sub(st, 'm'), minusDM, diLen)) / trur;
      const sum = plus + minus;
      const adx = 100 * ta.rma(sub(st, 'a'), Math.abs(plus - minus) / (sum === 0 ? 1 : sum), adxLen);
      return [plus, minus, adx];
    };

    ta.barssince = (st, cond) => {
      if (cond) st.n = 0;
      else if (st.n !== undefined) st.n++;
      return st.n === undefined ? NaN : st.n;
    };

    ta.valuewhen = (st, cond, src, occ) => {
      occ = occ || 0;
      const v = st.v || (st.v = []);
      if (cond) v.push(src);
      if (v.length > 500) v.shift();
      const k = v.length - 1 - occ;
      return k >= 0 ? v[k] : NaN;
    };

    ta.rising = (st, src, len) => {
      const h = hist(st, src, Math.round(len) + 1);
      if (h.length <= len) return false;
      for (let k = 0; k < h.length - 1; k++) if (!(src > h[k])) return false;
      return true;
    };
    ta.falling = (st, src, len) => {
      const h = hist(st, src, Math.round(len) + 1);
      if (h.length <= len) return false;
      for (let k = 0; k < h.length - 1; k++) if (!(src < h[k])) return false;
      return true;
    };

    function pivot(st, src, left, right, isHigh) {
      const n = left + right + 1;
      const b = win(st, src, n);
      if (b.length < n) return NaN;
      const c = b[left];
      for (let k = 0; k < n; k++) {
        if (k === left) continue;
        if (isHigh ? b[k] > c || (k > left && b[k] === c) : b[k] < c || (k > left && b[k] === c)) return NaN;
      }
      return c;
    }
    ta.pivothigh = (st, src, left, right) => {
      if (right === undefined) { right = left; left = src; src = R.high; }
      return pivot(st, src, Math.round(left), Math.round(right), true);
    };
    ta.pivotlow = (st, src, left, right) => {
      if (right === undefined) { right = left; left = src; src = R.low; }
      return pivot(st, src, Math.round(left), Math.round(right), false);
    };

    ta.linreg = (st, src, len, offset) => {
      len = Math.round(len);
      const b = win(st, src, len);
      if (b.length < len) return NaN;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let k = 0; k < len; k++) { sx += k; sy += b[k]; sxy += k * b[k]; sxx += k * k; }
      const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
      const icpt = (sy - slope * sx) / len;
      return icpt + slope * (len - 1 - (offset || 0));
    };

    ta.median = (st, src, len) => {
      const b = win(st, src, Math.round(len));
      if (b.length < len) return NaN;
      const s = [...b].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    ta.percentrank = (st, src, len) => {
      const h = hist(st, src, Math.round(len) + 1);
      if (h.length <= len) return NaN;
      let c = 0;
      for (let k = 0; k < h.length - 1; k++) if (h[k] <= src) c++;
      return (100 * c) / len;
    };

    ta.wpr = (st, len) => {
      const hh = ta.highest(sub(st, 'h'), R.high, len);
      const ll = ta.lowest(sub(st, 'l'), R.low, len);
      return (100 * (R.close - hh)) / (hh - ll);
    };

    ta.sar = (st, start, inc, max) => {
      // Parabolic SAR (implementasi klasik Wilder)
      if (st.init === undefined) {
        st.init = 1;
        st.long = true; st.sar = R.low; st.ep = R.high; st.af = start;
        st.ph = R.high; st.pl = R.low;
        return NaN;
      }
      let sar = st.sar + st.af * (st.ep - st.sar);
      if (st.long) {
        sar = Math.min(sar, st.pl);
        if (R.low < sar) { st.long = false; sar = st.ep; st.ep = R.low; st.af = start; }
        else if (R.high > st.ep) { st.ep = R.high; st.af = Math.min(st.af + inc, max); }
      } else {
        sar = Math.max(sar, st.ph);
        if (R.high > sar) { st.long = true; sar = st.ep; st.ep = R.high; st.af = start; }
        else if (R.low < st.ep) { st.ep = R.low; st.af = Math.min(st.af + inc, max); }
      }
      st.sar = sar; st.ph = R.high; st.pl = R.low;
      return sar;
    };

    return ta;
  }

  const api = { makeTA, isNa };
  root.LunaTA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
