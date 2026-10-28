/*
 * Luna — scanner sinyal: menjalankan strategi bawaan (EMA Cross zona / MyTT Trend Pullback)
 * di banyak koin dan mengambil titik entry terbaru beserta Entry, SL, TP1-3.
 * Hanya memakai candle yang sudah close, jadi sinyal tidak repaint.
 */
(function (root) {
  'use strict';

  const Pine = root.LunaPine || (typeof require !== 'undefined' ? require('./pine.js') : null);

  // Variabel internal tiap strategi dibaca lewat plot tersembunyi.
  const ADAPTERS = {
    ema: {
      label: 'EMA Cross (zona)',
      scriptName: 'EMA Cross Strategy',
      exampleKey: 'ema-cross',
      probe: [
        'plot(sDir, "__dir", display = display.none)',
        'plot(sLive ? 1 : 0, "__live", display = display.none)',
        'plot(sOk ? 1 : 0, "__ok", display = display.none)',
        'plot(sBar, "__bar", display = display.none)',
        'plot(sE, "__e", display = display.none)',
        'plot(sSL, "__sl", display = display.none)',
        'plot(sT1, "__t1", display = display.none)',
        'plot(sT2, "__t2", display = display.none)',
        'plot(sT3, "__t3", display = display.none)',
      ],
      // setup menunggu pullback (order limit aktif) atau entry yang baru terisi
      read(P, bars, maxAge) {
        const L = bars.length - 1;
        const dir = P.__dir[L];
        if (!dir) return null;
        const lv = { entry: P.__e[L], sl: P.__sl[L], tp1: P.__t1[L], tp2: P.__t2[L], tp3: P.__t3[L] };
        if (!P.__live[L]) {
          if (!P.__ok[L]) return null;
          const sb = Math.max(0, Math.min(L, P.__bar[L]));
          return { dir, status: 'limit', signalTime: bars[sb].time, age: L - sb, ...lv };
        }
        let k = L;
        while (k > 0 && P.__live[k - 1] && P.__dir[k - 1] === dir) k--;
        if (L - k > maxAge) return null;
        return { dir, status: 'filled', signalTime: bars[k].time, age: L - k, ...lv };
      },
    },
    mytt: {
      label: 'MyTT Trend Pullback',
      scriptName: 'MyTT Trend Pullback',
      exampleKey: 'mytt-strat',
      probe: [
        'plot(tDir, "__dir", display = display.none)',
        'plot(newSetup ? 1 : 0, "__new", display = display.none)',
        'plot(tLive ? 1 : 0, "__live", display = display.none)',
        'plot(tE, "__e", display = display.none)',
        'plot(tSL, "__sl", display = display.none)',
        'plot(tT1, "__t1", display = display.none)',
        'plot(tT2, "__t2", display = display.none)',
        'plot(tT3, "__t3", display = display.none)',
      ],
      // sinyal market di close bar sinyal; masih relevan selama posisinya belum selesai
      read(P, bars, maxAge) {
        const L = bars.length - 1;
        if (!P.__dir[L]) return null;
        for (let k = L; k >= Math.max(0, L - maxAge); k--) {
          if (!P.__new[k]) continue;
          return {
            dir: P.__dir[k], status: P.__live[L] ? 'filled' : 'signal', signalTime: bars[k].time, age: L - k,
            entry: P.__e[k], sl: P.__sl[k], tp1: P.__t1[k], tp2: P.__t2[k], tp3: P.__t3[k],
          };
        }
        return null;
      },
    },
  };

  // buang candle terakhir jika belum close
  function closedBars(bars, tfMs, now) {
    if (!bars.length) return bars;
    const last = bars[bars.length - 1];
    return last.time + tfMs > (now || Date.now()) ? bars.slice(0, -1) : bars;
  }

  const cache = new Map();
  function compiled(adapterKey, code) {
    const key = adapterKey + '\n' + code;
    let c = cache.get(key);
    if (!c) {
      try {
        c = Pine.compile(code + '\n' + ADAPTERS[adapterKey].probe.join('\n') + '\n');
      } catch (e) {
        throw new Error(`Script "${ADAPTERS[adapterKey].scriptName}" tidak cocok untuk scanner (sudah diubah?): ${e.message}`);
      }
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      cache.set(key, c);
    }
    return c;
  }

  /**
   * Jalankan satu strategi di satu koin. Mengembalikan sinyal terbaru atau null.
   * opts: { tf, symbol, inputs, maxAge (bar), now }
   */
  function evaluate(adapterKey, code, bars, opts) {
    const ad = ADAPTERS[adapterKey];
    if (!ad) throw new Error('Strategi scanner tidak dikenal: ' + adapterKey);
    const o = opts || {};
    if (bars.length < 50) return null;
    const inputs = Object.assign({}, o.inputs, { 'Gambar zona & level': false });
    const r = Pine.run(compiled(adapterKey, code), bars, { inputs, timeframe: o.tf, symbol: o.symbol });
    if (r.error) throw new Error(r.error);
    const P = {};
    for (const p of r.plots) if (p.title.startsWith('__')) P[p.title] = p.values;
    if (!P.__dir) throw new Error('Script tidak cocok untuk scanner (variabel strategi tidak ditemukan).');
    const s = ad.read(P, bars, o.maxAge === undefined ? 3 : o.maxAge);
    if (!s || ![s.entry, s.sl, s.tp1, s.tp2, s.tp3].every((v) => typeof v === 'number' && isFinite(v))) return null;
    const risk = Math.abs(s.entry - s.sl);
    if (!(risk > 0)) return null;
    const last = bars[bars.length - 1];
    return Object.assign(s, {
      symbol: o.symbol, tf: o.tf, strategy: adapterKey, price: last.close, barTime: last.time,
      rr1: ((s.tp1 - s.entry) * s.dir) / risk, rr2: ((s.tp2 - s.entry) * s.dir) / risk, rr3: ((s.tp3 - s.entry) * s.dir) / risk,
      key: [o.symbol, o.tf, adapterKey, s.dir, s.signalTime].join('|'),
    });
  }

  const api = { ADAPTERS, evaluate, closedBars };
  root.LunaScanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
