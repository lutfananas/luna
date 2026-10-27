/*
 * Luna — ekstensi runtime Pine: timeframe & data HTF, array, dan objek gambar
 * (box / line / label / table).
 *
 * Setiap objek gambar menyimpan bar saat dibuat, bar saat dihapus, dan riwayat
 * perubahan properti per bar. Dengan begitu chart bisa menampilkan keadaan
 * objek persis pada bar mana pun (penting untuk Bar Replay: tidak ada bocoran
 * informasi dari masa depan).
 */
(function (root) {
  'use strict';

  const isNa = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));

  // ------------------------------------------------------------------
  // Timeframe
  // ------------------------------------------------------------------
  const MONTH = 2592000, WEEK = 604800, DAY = 86400;

  /** "60" / "240" / "1D" / "D" / "W" / "3M" / "30S" / "1h" / "4h" / "1d" → detik */
  function tfToSeconds(tf) {
    if (isNa(tf) || tf === '') return null;
    const s = String(tf).trim();
    let m = /^(\d+)(s|m|h|d|w)$/.exec(s); // gaya Binance (huruf kecil)
    if (m) return +m[1] * { s: 1, m: 60, h: 3600, d: DAY, w: WEEK }[m[2]];
    m = /^(\d*)([SDWM]?)$/.exec(s); // gaya Pine
    if (!m || (m[1] === '' && m[2] === '')) return null;
    const n = m[1] === '' ? 1 : +m[1];
    switch (m[2]) {
      case '': return n * 60;
      case 'S': return n;
      case 'D': return n * DAY;
      case 'W': return n * WEEK;
      case 'M': return n * MONTH;
    }
    return null;
  }

  function secondsToTf(sec) {
    if (!sec) return '';
    if (sec % MONTH === 0) return sec / MONTH + 'M';
    if (sec % WEEK === 0) return sec / WEEK + 'W';
    if (sec % DAY === 0) return sec / DAY + 'D';
    if (sec % 60 === 0) return String(sec / 60);
    return sec + 'S';
  }

  /** Nomor "ember" HTF untuk waktu (ms). Hari mulai 00:00 UTC, minggu mulai Senin (seperti Binance). */
  function bucket(t, sec) {
    if (sec % MONTH === 0) {
      const d = new Date(t);
      return Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / (sec / MONTH));
    }
    if (sec % WEEK === 0) return Math.floor((t - 4 * DAY * 1000) / (sec * 1000));
    return Math.floor(t / (sec * 1000));
  }

  function chartSeconds(bars, tf) {
    const s = tfToSeconds(tf);
    if (s) return s;
    const diffs = [];
    for (let k = 1; k < Math.min(bars.length, 200); k++) diffs.push((bars[k].time - bars[k - 1].time) / 1000);
    diffs.sort((a, b) => a - b);
    const med = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 3600;
    // bulan & minggu tidak persis
    if (med >= 27 * DAY) return MONTH;
    return Math.round(med);
  }

  function makeTimeframe(ctx) {
    const sec = chartSeconds(ctx.bars, ctx.tf);
    const caches = new Map();
    const series = (tf) => {
      const s = tfToSeconds(tf);
      if (!s) throw new Error(`Timeframe "${tf}" tidak valid`);
      let c = caches.get(s);
      if (c) return c;
      // agregasi seluruh bar chart ke candle HTF
      const bars = ctx.bars;
      const idx = new Array(bars.length);
      const agg = [];
      const last = [];
      let prev = null;
      for (let k = 0; k < bars.length; k++) {
        const b = bars[k];
        const id = bucket(b.time, s);
        if (id !== prev) {
          agg.push({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
          prev = id;
        } else {
          const a = agg[agg.length - 1];
          if (b.high > a.high) a.high = b.high;
          if (b.low < a.low) a.low = b.low;
          a.close = b.close;
          a.volume += b.volume;
        }
        idx[k] = agg.length - 1;
        last[agg.length - 1] = k;
      }
      c = { sec: s, idx, agg, last };
      caches.set(s, c);
      return c;
    };
    const field = (a, f) => {
      switch (f) {
        case 'hl2': return (a.high + a.low) / 2;
        case 'hlc3': return (a.high + a.low + a.close) / 3;
        case 'ohlc4': return (a.open + a.high + a.low + a.close) / 4;
        case 'hlcc4': return (a.high + a.low + 2 * a.close) / 4;
        case 'time_close': return a.time + 0;
        case 'bar_index': return NaN;
        default: return a[f];
      }
    };
    const tfNS = {
      period: secondsToTf(sec),
      main_period: secondsToTf(sec),
      multiplier: sec % MONTH === 0 ? sec / MONTH : sec % WEEK === 0 ? sec / WEEK : sec % DAY === 0 ? sec / DAY : sec >= 60 ? sec / 60 : sec,
      isseconds: sec < 60,
      isminutes: sec >= 60 && sec < DAY,
      isintraday: sec < DAY,
      isdaily: sec >= DAY && sec % DAY === 0 && sec < WEEK,
      isweekly: sec % WEEK === 0 && sec < MONTH,
      ismonthly: sec % MONTH === 0,
      isdwm: sec >= DAY,
      isticks: false,
      in_seconds: (tf) => (tf === undefined ? sec : tfToSeconds(tf)),
      from_seconds: (s) => secondsToTf(s),
      change: (tf) => {
        const i = ctx.i();
        const s = tf === undefined ? sec : tfToSeconds(tf);
        if (!s) throw new Error(`Timeframe "${tf}" tidak valid`);
        if (i === 0) return true;
        return bucket(ctx.bars[i].time, s) !== bucket(ctx.bars[i - 1].time, s);
      },
    };
    /**
     * Nilai `f` dari candle HTF.
     * lookahead off (default, tanpa repaint): candle HTF dianggap ada setelah ditutup.
     * lookahead on: memakai candle HTF yang sedang berjalan (nilai akhirnya — bocor masa depan!).
     */
    const htf = (tf, f, k, lookahead) => {
      const c = series(tf);
      const i = ctx.i();
      const h = c.idx[i];
      k = Math.round(k || 0);
      let j;
      if (lookahead === 'on') j = h - k;
      else j = (c.last[h] === i ? h : h - 1) - k;
      return j >= 0 && j < c.agg.length ? field(c.agg[j], f) : NaN;
    };
    return { timeframe: tfNS, htf, chartSec: sec };
  }

  // ------------------------------------------------------------------
  // Array
  // ------------------------------------------------------------------
  function makeArray() {
    const idx = (a, i) => {
      i = Math.trunc(i);
      if (i < 0) i += a.length;
      if (!(i >= 0 && i < a.length)) throw new Error(`Indeks array ${i} di luar batas (ukuran ${a.length})`);
      return i;
    };
    const nums = (a) => a.filter((v) => typeof v === 'number' && !Number.isNaN(v));
    const mk = (n, v) => new Array(Math.max(0, Math.trunc(isNa(n) ? 0 : n))).fill(v === undefined ? NaN : v);
    const A = {
      new_float: mk, new_int: mk, new_bool: (n, v) => mk(n, v === undefined ? false : v), new_string: mk, new_color: mk,
      new_box: mk, new_line: mk, new_label: mk, new_table: mk, new_linefill: mk, new: mk,
      from: (...a) => a,
      size: (a) => (a ? a.length : NaN),
      push: (a, v) => { a.push(v); },
      pop: (a) => { if (!a.length) throw new Error('array.pop() pada array kosong'); return a.pop(); },
      shift: (a) => { if (!a.length) throw new Error('array.shift() pada array kosong'); return a.shift(); },
      unshift: (a, v) => { a.unshift(v); },
      get: (a, i) => a[idx(a, i)],
      set: (a, i, v) => { a[idx(a, i)] = v; },
      first: (a) => a[idx(a, 0)],
      last: (a) => a[idx(a, -1)],
      insert: (a, i, v) => { a.splice(Math.trunc(i), 0, v); },
      remove: (a, i) => a.splice(idx(a, i), 1)[0],
      clear: (a) => { a.length = 0; },
      includes: (a, v) => a.includes(v),
      indexof: (a, v) => a.indexOf(v),
      lastindexof: (a, v) => a.lastIndexOf(v),
      max: (a, nth) => { const s = nums(a).sort((x, y) => y - x); return s.length ? s[nth || 0] : NaN; },
      min: (a, nth) => { const s = nums(a).sort((x, y) => x - y); return s.length ? s[nth || 0] : NaN; },
      sum: (a) => nums(a).reduce((x, y) => x + y, 0),
      avg: (a) => { const s = nums(a); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN; },
      median: (a) => { const s = nums(a).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
      range: (a) => A.max(a) - A.min(a),
      stdev: (a) => { const s = nums(a); if (!s.length) return NaN; const m = A.avg(s); return Math.sqrt(s.reduce((x, y) => x + (y - m) * (y - m), 0) / s.length); },
      slice: (a, f, t) => a.slice(f, t),
      copy: (a) => a.slice(),
      reverse: (a) => { a.reverse(); },
      sort: (a, order) => { a.sort((x, y) => (order === 'descending' ? (y > x ? 1 : y < x ? -1 : 0) : (x > y ? 1 : x < y ? -1 : 0))); },
      concat: (a, b) => { a.push(...b); return a; },
      join: (a, sep) => a.join(sep === undefined ? ',' : sep),
      fill: (a, v, f, t) => { a.fill(v, f || 0, t === undefined ? a.length : t); },
      abs: (a) => a.map((v) => Math.abs(v)),
      every: (a) => a.every(Boolean),
      some: (a) => a.some(Boolean),
    };
    return A;
  }

  // ------------------------------------------------------------------
  // Objek gambar
  // ------------------------------------------------------------------
  const DEF_BLUE = '#2962FF';

  function makeDrawings(ctx) {
    let seq = 0;
    const store = { box: [], line: [], label: [], table: [] };
    const live = { box: [], line: [], label: [], table: [] };

    function create(kind, props) {
      const o = { __kind: kind, id: ++seq, created: ctx.i(), deleted: null, script: ctx.scriptId, init: Object.assign({}, props), props, hist: [] };
      store[kind].push(o);
      live[kind].push(o);
      const max = kind === 'table' ? 100 : ctx.limits[kind] || 50;
      while (live[kind].length > max) del(live[kind][0]);
      return o;
    }
    function ok(o) { return o && typeof o === 'object' && o.__kind && o.deleted === null; }
    function set(o, k, v) {
      if (!ok(o)) return;
      const cur = o.props[k];
      if (cur === v || (typeof v === 'number' && typeof cur === 'number' && Number.isNaN(v) && Number.isNaN(cur))) return;
      if (v && cur && typeof v === 'object' && typeof cur === 'object' && JSON.stringify(v) === JSON.stringify(cur)) return;
      o.props[k] = v;
      o.hist.push({ i: ctx.i(), k, v });
    }
    function del(o) {
      if (!ok(o)) return;
      o.deleted = ctx.i();
      const l = live[o.__kind];
      const p = l.indexOf(o);
      if (p >= 0) l.splice(p, 1);
    }
    function copy(o) {
      if (!o || !o.__kind) return NaN;
      return create(o.__kind, Object.assign({}, o.props));
    }
    const getter = (k) => (o) => (o && o.props ? o.props[k] : NaN);
    const setter = (k) => (o, v) => set(o, k, v);

    const box = {
      new: (left, top, right, bottom, border_color, border_width, border_style, extend, xloc, bgcolor, text, text_size, text_color, text_halign, text_valign, text_wrap, text_font_family, force_overlay) => {
        if (left && typeof left === 'object' && left.__point) {
          // box.new(top_left, bottom_right, ...)
          const tl = left, br = top;
          return box.new(tl.index, tl.price, br.index, br.price, right, bottom, border_color, border_width, border_style, extend, xloc, bgcolor, text, text_size, text_color, text_halign, text_valign, text_wrap);
        }
        return create('box', {
          left, top, right, bottom,
          border_color: border_color === undefined ? DEF_BLUE : border_color, border_width: isNa(border_width) ? 1 : border_width,
          border_style: border_style || 'solid', extend: extend || 'none', xloc: xloc || 'bar_index',
          bgcolor: bgcolor === undefined ? 'rgba(41,98,255,0.2)' : bgcolor, text: text || '', text_size: text_size || 'auto',
          text_color: text_color === undefined ? '#d1d4dc' : text_color, text_halign: text_halign || 'center', text_valign: text_valign || 'center',
          force_overlay: !!force_overlay,
        });
      },
      delete: del, copy,
      set_left: setter('left'), set_right: setter('right'), set_top: setter('top'), set_bottom: setter('bottom'),
      set_lefttop: (o, l, t) => { set(o, 'left', l); set(o, 'top', t); },
      set_rightbottom: (o, r, b) => { set(o, 'right', r); set(o, 'bottom', b); },
      set_top_left_point: (o, p) => { set(o, 'left', p.index); set(o, 'top', p.price); },
      set_bottom_right_point: (o, p) => { set(o, 'right', p.index); set(o, 'bottom', p.price); },
      set_bgcolor: setter('bgcolor'), set_border_color: setter('border_color'), set_border_width: setter('border_width'),
      set_border_style: setter('border_style'), set_extend: setter('extend'), set_text: setter('text'),
      set_text_color: setter('text_color'), set_text_size: setter('text_size'), set_text_halign: setter('text_halign'),
      set_text_valign: setter('text_valign'), set_text_wrap: () => {}, set_text_font_family: () => {}, set_xloc: (o, l, r, x) => { set(o, 'left', l); set(o, 'right', r); set(o, 'xloc', x); },
      get_left: getter('left'), get_right: getter('right'), get_top: getter('top'), get_bottom: getter('bottom'),
    };
    Object.defineProperty(box, 'all', { get: () => live.box.slice() });

    const line = {
      new: (x1, y1, x2, y2, xloc, extend, color, style, width, force_overlay) => {
        if (x1 && typeof x1 === 'object' && x1.__point) {
          const a = x1, b = y1;
          return line.new(a.index, a.price, b.index, b.price, x2, y2, xloc, extend, color, style);
        }
        return create('line', {
          x1, y1, x2, y2, xloc: xloc || 'bar_index', extend: extend || 'none',
          color: color === undefined ? DEF_BLUE : color, style: style || 'solid', width: isNa(width) ? 1 : width, force_overlay: !!force_overlay,
        });
      },
      delete: del, copy,
      set_x1: setter('x1'), set_x2: setter('x2'), set_y1: setter('y1'), set_y2: setter('y2'),
      set_xy1: (o, x, y) => { set(o, 'x1', x); set(o, 'y1', y); },
      set_xy2: (o, x, y) => { set(o, 'x2', x); set(o, 'y2', y); },
      set_first_point: (o, p) => { set(o, 'x1', p.index); set(o, 'y1', p.price); },
      set_second_point: (o, p) => { set(o, 'x2', p.index); set(o, 'y2', p.price); },
      set_color: setter('color'), set_style: setter('style'), set_width: setter('width'), set_extend: setter('extend'),
      set_xloc: (o, a, b, x) => { set(o, 'x1', a); set(o, 'x2', b); set(o, 'xloc', x); },
      get_x1: getter('x1'), get_x2: getter('x2'), get_y1: getter('y1'), get_y2: getter('y2'),
      get_price: (o, x) => {
        if (!o || !o.props) return NaN;
        const p = o.props;
        if (p.x2 === p.x1) return p.y1;
        return p.y1 + ((p.y2 - p.y1) * (x - p.x1)) / (p.x2 - p.x1);
      },
    };
    Object.defineProperty(line, 'all', { get: () => live.line.slice() });

    const label = {
      new: (x, y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip, text_font_family, force_overlay) => {
        if (x && typeof x === 'object' && x.__point) {
          return label.new(x.index, x.price, y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip);
        }
        return create('label', {
          x, y, text: isNa(text) ? '' : String(text), xloc: xloc || 'bar_index', yloc: yloc || 'price',
          color: color === undefined ? DEF_BLUE : color, style: style || 'label_down', textcolor: textcolor === undefined ? '#ffffff' : textcolor,
          size: size || 'normal', textalign: textalign || 'center', tooltip: tooltip || '', force_overlay: !!force_overlay,
        });
      },
      delete: del, copy,
      set_x: setter('x'), set_y: setter('y'), set_xy: (o, x, y) => { set(o, 'x', x); set(o, 'y', y); },
      set_point: (o, p) => { set(o, 'x', p.index); set(o, 'y', p.price); },
      set_text: (o, t) => set(o, 'text', isNa(t) ? '' : String(t)), set_color: setter('color'), set_textcolor: setter('textcolor'),
      set_style: setter('style'), set_size: setter('size'), set_tooltip: setter('tooltip'), set_yloc: setter('yloc'),
      set_textalign: setter('textalign'), set_xloc: (o, x, xl) => { set(o, 'x', x); set(o, 'xloc', xl); }, set_text_font_family: () => {},
      get_x: getter('x'), get_y: getter('y'), get_text: getter('text'),
    };
    Object.defineProperty(label, 'all', { get: () => live.label.slice() });
    Object.assign(label, {
      style_none: 'none', style_label_down: 'label_down', style_label_up: 'label_up', style_label_left: 'label_left',
      style_label_right: 'label_right', style_label_center: 'label_center', style_label_lower_left: 'label_up',
      style_label_lower_right: 'label_up', style_label_upper_left: 'label_down', style_label_upper_right: 'label_down',
      style_circle: 'circle', style_square: 'square', style_diamond: 'square', style_cross: 'circle', style_xcross: 'circle',
      style_triangleup: 'triangleup', style_triangledown: 'triangledown', style_arrowup: 'triangleup', style_arrowdown: 'triangledown',
      style_flag: 'square', style_text_outline: 'none',
    });
    Object.assign(line, {
      style_solid: 'solid', style_dotted: 'dotted', style_dashed: 'dashed',
      style_arrow_left: 'arrow_left', style_arrow_right: 'arrow_right', style_arrow_both: 'arrow_both',
    });

    const cellKey = (c, r) => `cell:${c}:${r}`;
    const table = {
      new: (position, columns, rows, bgcolor, frame_color, frame_width, border_color, border_width, force_overlay) =>
        create('table', { position: position || 'top_right', columns, rows, bgcolor: bgcolor === undefined ? null : bgcolor, frame_color, frame_width, border_color, border_width }),
      delete: del,
      cell: (t, column, row, text, width, height, text_color, text_halign, text_valign, text_size, bgcolor) => {
        set(t, cellKey(column, row), {
          text: isNa(text) ? '' : String(text), text_color: text_color === undefined ? '#d1d4dc' : text_color,
          text_halign: text_halign || 'center', text_size: text_size || 'normal', bgcolor: bgcolor === undefined ? null : bgcolor,
        });
      },
      cell_set_text: (t, c, r, v) => { if (ok(t)) set(t, cellKey(c, r), Object.assign({}, t.props[cellKey(c, r)], { text: isNa(v) ? '' : String(v) })); },
      cell_set_text_color: (t, c, r, v) => { if (ok(t)) set(t, cellKey(c, r), Object.assign({}, t.props[cellKey(c, r)], { text_color: v })); },
      cell_set_bgcolor: (t, c, r, v) => { if (ok(t)) set(t, cellKey(c, r), Object.assign({}, t.props[cellKey(c, r)], { bgcolor: v })); },
      cell_set_text_size: (t, c, r, v) => { if (ok(t)) set(t, cellKey(c, r), Object.assign({}, t.props[cellKey(c, r)], { text_size: v })); },
      cell_set_text_halign: () => {}, cell_set_text_valign: () => {}, cell_set_width: () => {}, cell_set_height: () => {},
      cell_set_tooltip: () => {}, cell_set_text_font_family: () => {}, merge_cells: () => {},
      clear: (t, c1, r1, c2, r2) => {
        if (!ok(t)) return;
        c2 = c2 === undefined ? c1 : c2;
        r2 = r2 === undefined ? r1 : r2;
        for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) set(t, cellKey(c, r), null);
      },
      set_position: setter('position'), set_bgcolor: setter('bgcolor'), set_frame_color: () => {}, set_frame_width: () => {},
      set_border_color: () => {}, set_border_width: () => {},
    };
    Object.defineProperty(table, 'all', { get: () => live.table.slice() });

    const chart = {
      point: {
        new: (time, index, price) => ({ __point: true, time, index, price }),
        from_index: (index, price) => ({ __point: true, index, price }),
        from_time: (time, price) => ({ __point: true, time, index: NaN, price }),
        now: (price) => ({ __point: true, index: ctx.i(), time: ctx.bars[ctx.i()].time, price }),
        copy: (p) => Object.assign({}, p),
      },
      bg_color: '#131722', fg_color: '#d1d4dc',
    };

    return { box, line, label, table, chart, store };
  }

  /**
   * Keadaan sebuah objek gambar pada bar `idx` (null jika belum dibuat / sudah dihapus).
   * Dipakai oleh renderer di app.js.
   */
  function stateAt(o, idx) {
    if (o.created > idx) return null;
    if (o.deleted !== null && o.deleted <= idx) return null;
    if (!o.hist.length || o.hist[o.hist.length - 1].i <= idx) return o.props;
    const p = Object.assign({}, o.init);
    for (const h of o.hist) {
      if (h.i > idx) break;
      p[h.k] = h.v;
    }
    return p;
  }

  const api = { makeTimeframe, makeArray, makeDrawings, stateAt, tfToSeconds, secondsToTf, bucket };
  root.LunaPineExt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
