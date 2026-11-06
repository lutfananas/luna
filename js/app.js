/* Luna — aplikasi dashboard: chart, daftar script, editor, strategy tester, replay & paper trading. */
(function () {
  'use strict';

  const LW = window.LightweightCharts;
  const Pine = window.LunaPine;
  const Data = window.LunaData;
  const BT = window.LunaBacktest;
  const Examples = window.LunaScripts;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNa = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));

  // ------------------------------------------------------------------
  // Penyimpanan lokal (localStorage)
  // ------------------------------------------------------------------
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('luna.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('luna.' + k, JSON.stringify(v)); } catch (e) { /* abaikan */ }
    },
  };
  const uid = () => Math.random().toString(36).slice(2, 10);

  const TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
  const GAP = 'rgba(0,0,0,0)';
  const PALETTE = ['#2962FF', '#FF9800', '#E040FB', '#00BCD4', '#F7C948', '#4CAF50', '#FF5252'];
  // news tambahan pengguna: [{d: 'YYYY-MM-DD', k: 0|1, s: teks}]
  let customNews = store.get('customNews', []);
  const settings = store.get('settings', { symbol: 'BTCUSDT', tf: '1h', count: 3000, bottomH: 280, collapsed: false });
  if (Data.ALIAS && Data.ALIAS[settings.symbol]) settings.symbol = Data.ALIAS[settings.symbol];

  const S = {
    bars: [],
    source: 'binance',
    scripts: store.get('scripts', null),
    results: new Map(),
    inputDefs: store.get('inputDefs', {}),
    compiled: new Map(),
    selectedStrategy: store.get('selectedStrategy', null),
    editingId: null,
    priceDec: 2,
    replay: { active: false, picking: false, idx: null, playing: false, timer: null },
    liveStop: null,
    paper: null,
  };
  // contoh bawaan: install baru dapat semua; install lama hanya dapat contoh yang belum pernah ditawarkan
  {
    const fresh = !S.scripts;
    if (fresh) S.scripts = [];
    const seen = new Set(store.get('seenExamples', fresh ? [] : Examples.ORIGINAL_KEYS));
    for (const e of Examples.EXAMPLES) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      if (S.scripts.some((x) => x.name === e.name)) continue; // sudah ada (mis. data browser terhapus sebagian)
      S.scripts.push({ id: uid(), name: e.name, code: e.code, enabled: e.enabled, inputs: {}, exampleKey: e.key, exampleHash: Examples.hashCode(e.code) });
    }
    // contoh bawaan yang diperbarui: ganti hanya jika kode tersimpan masih persis versi bawaan
    // (sama dengan versi saat dipasang, atau salah satu versi lama di HISTORY) — script yang diedit tidak disentuh
    const updated = [];
    for (const e of Examples.EXAMPLES) {
      const cur = Examples.hashCode(e.code);
      const olds = new Set(((Examples.HISTORY && Examples.HISTORY[e.key]) || []).concat(((Examples.LEGACY && Examples.LEGACY[e.key]) || []).map(Examples.hashCode)));
      for (const sc of S.scripts) {
        const h = Examples.hashCode(sc.code);
        const pristine = (sc.exampleKey === e.key && sc.exampleHash === h) || olds.has(h);
        if (!pristine || (sc.exampleKey && sc.exampleKey !== e.key)) continue;
        if (h !== cur) { sc.code = e.code; updated.push(e.name); }
        sc.exampleKey = e.key;
        sc.exampleHash = cur;
      }
    }
    if (updated.length) setTimeout(() => log(`Script bawaan diperbarui ke versi terbaru: ${[...new Set(updated)].join(', ')}`), 0);
    store.set('seenExamples', [...seen]);
    store.set('scripts', S.scripts);
  }
  const saveScripts = () => store.set('scripts', S.scripts);
  const saveSettings = () => store.set('settings', settings);

  // ------------------------------------------------------------------
  // Log & status
  // ------------------------------------------------------------------
  let logErrors = 0;
  function log(msg, isErr) {
    const el = $('log');
    const line = document.createElement('div');
    if (isErr) line.className = 'e';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    if (isErr) {
      logErrors++;
      $('log-badge').textContent = logErrors;
      $('log-badge').classList.remove('hidden');
    }
  }
  function status(msg, isErr) {
    const el = $('status');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
  }

  // ------------------------------------------------------------------
  // Chart utama
  // ------------------------------------------------------------------
  const TZ = -new Date().getTimezoneOffset() * 60; // tampilkan dalam zona waktu lokal
  const ct = (ms) => Math.floor(ms / 1000) + TZ;
  const fromCt = (t) => (t - TZ) * 1000;

  const chartOpts = {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#131722' }, textColor: '#b2b5be', fontSize: 11, panes: { separatorColor: '#2a2e39', separatorHoverColor: '#2962ff55', enableResize: true } },
    grid: { vertLines: { color: '#1c2030' }, horzLines: { color: '#1c2030' } },
    crosshair: { mode: LW.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 10 },
  };
  const chart = LW.createChart($('chart'), chartOpts);
  const candle = chart.addSeries(LW.CandlestickSeries, {
    upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645',
  }, 0);
  const volume = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }, 0);
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const candleMarkerApi = LW.createSeriesMarkers(candle, []);
  // alat gambar manual (fibo, range harga & %, garis, kotak, posisi) — disimpan per koin
  const userDraw = window.LunaUserDraw ? window.LunaUserDraw.attach({
    chart, series: candle, getBars: () => S.bars, store, symbol: () => settings.symbol,
    isBusy: () => S.replay.picking, status, host: document.querySelector('.chart-wrap'), chartEl: $('chart'),
  }) : null;

  const view = {
    series: [], // {api, pts, script, title, color}
    candlePts: [],
    volPts: [],
    candleMarkers: [], // {i, m}
    paneMarkers: [], // {api, plugin, list}
    priceLines: [], // {series, line}
    prims: [], // {series, prim} — box/line/label dari script
    tables: [], // objek table.new dari script aktif
  };

  function endIdx() {
    return S.replay.active && S.replay.idx !== null ? S.replay.idx : S.bars.length - 1;
  }

  const SHAPES = {
    triangleup: ['arrowUp'], arrowup: ['arrowUp'], labelup: ['arrowUp'], triangledown: ['arrowDown'], arrowdown: ['arrowDown'],
    labeldown: ['arrowDown'], circle: ['circle'], square: ['square'], diamond: ['square'], xcross: ['circle'], cross: ['circle'], flag: ['square'], char: ['circle'],
  };
  const LOCS = { abovebar: 'aboveBar', top: 'aboveBar', belowbar: 'belowBar', bottom: 'belowBar', absolute: 'atPriceMiddle' };
  const SIZES = { tiny: 0.5, small: 0.8, normal: 1, auto: 1, large: 1.5, huge: 2 };

  function clearView() {
    for (const s of view.series) chart.removeSeries(s.api);
    for (const p of view.priceLines) p.series.removePriceLine(p.line);
    for (const p of view.prims) { try { p.series.detachPrimitive(p.prim); } catch (e) { /* seri sudah dihapus */ } }
    view.prims = [];
    view.tables = [];
    view.series = [];
    view.paneMarkers = [];
    view.priceLines = [];
    for (let k = chart.panes().length - 1; k >= 1; k--) {
      try { chart.removePane(k); } catch (e) { /* pane sudah hilang */ }
    }
  }

  function selectedStrategyResult() {
    const strats = S.scripts.filter((s) => s.enabled && S.results.get(s.id) && S.results.get(s.id).strategy);
    if (!strats.length) return null;
    const sc = strats.find((s) => s.id === S.selectedStrategy) || strats[0];
    return { script: sc, res: S.results.get(sc.id), all: strats };
  }

  function buildView() {
    clearView();
    const bars = S.bars;
    const n = bars.length;
    // warna bar dari barcolor()
    let barColors = null;
    for (const sc of S.scripts) {
      const r = sc.enabled && S.results.get(sc.id);
      if (r && r.barcolors) barColors = barColors ? barColors.map((c, i) => r.barcolors[i] || c) : r.barcolors.slice();
    }
    view.candlePts = bars.map((b, i) => {
      const p = { time: ct(b.time), open: b.open, high: b.high, low: b.low, close: b.close };
      const c = barColors && barColors[i];
      if (c && typeof c === 'string') { p.color = c; p.wickColor = c; p.borderColor = c; }
      return p;
    });
    view.volPts = bars.map((b) => ({ time: ct(b.time), value: b.volume, color: b.close >= b.open ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)' }));

    const cm = [];
    let pane = 1;
    let colorIdx = 0;
    for (const sc of S.scripts) {
      if (!sc.enabled) continue;
      const res = S.results.get(sc.id);
      if (!res) continue;
      const overlay = res.decl.overlay;
      const dr = res.drawings || { box: [], line: [], label: [], table: [] };
      const paneDrawings = !overlay && [...dr.box, ...dr.line, ...dr.label].some((o) => !o.props.force_overlay);
      const hasPaneContent = res.plots.some((p) => !p.hidden && !p.forceOverlay) || res.hlines.length || res.bgcolors.length || paneDrawings;
      const paneIdx = overlay ? 0 : hasPaneContent ? pane++ : 0;
      let first = overlay ? candle : null;

      for (const bg of res.bgcolors) {
        const api = chart.addSeries(LW.HistogramSeries, {
          priceScaleId: 'bg-' + sc.id + bg.id, lastValueVisible: false, priceLineVisible: false, base: 0,
        }, paneIdx);
        api.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        const pts = bars.map((b, i) => {
          const c = bg.colors[i];
          return typeof c === 'string' ? { time: ct(b.time), value: 1, color: c } : { time: ct(b.time) };
        });
        view.series.push({ api, pts, script: sc.name, title: null });
      }

      for (const p of res.plots) {
        if (p.hidden) continue;
        const pi = p.forceOverlay ? 0 : paneIdx;
        const base = typeof p.color0 === 'string' ? p.color0 : PALETTE[colorIdx++ % PALETTE.length];
        let api;
        const common = { lastValueVisible: true, priceLineVisible: false, title: '', priceFormat: { type: 'price', precision: overlay ? S.priceDec : 2, minMove: overlay ? Math.pow(10, -S.priceDec) : 0.01 } };
        if (p.style === 'histogram' || p.style === 'columns') {
          api = chart.addSeries(LW.HistogramSeries, Object.assign({ color: base, base: p.histbase || 0 }, common), pi);
        } else if (p.style === 'area') {
          api = chart.addSeries(LW.AreaSeries, Object.assign({ lineColor: base, topColor: hexA(base, 0.35), bottomColor: hexA(base, 0.02), lineWidth: p.linewidth }, common), pi);
        } else {
          api = chart.addSeries(LW.LineSeries, Object.assign({
            color: base, lineWidth: p.linewidth,
            lineType: p.style === 'step' ? 1 : 0,
            lineVisible: p.style !== 'circles', pointMarkersVisible: p.style === 'circles', pointMarkersRadius: 2,
            crosshairMarkerVisible: true,
          }, common), pi);
        }
        const pts = new Array(n);
        for (let i = 0; i < n; i++) {
          const v = p.values[i];
          const c = p.colors[i];
          if (isNa(v) || typeof c === 'number') pts[i] = { time: ct(bars[i].time) };
          else pts[i] = typeof c === 'string' ? { time: ct(bars[i].time), value: v, color: c } : { time: ct(bars[i].time), value: v };
        }
        if (p.style !== 'histogram' && p.style !== 'columns') {
          // library menyambung garis melintasi data kosong; buat segmen sebelum celah transparan (seperti plot.style_linebr)
          for (let i = 0; i < n - 1; i++) if (pts[i].value !== undefined && pts[i + 1].value === undefined) pts[i] = Object.assign({}, pts[i], { color: GAP });
        }
        view.series.push({ api, pts, script: sc.name, title: p.title, color: base });
        if (!first && pi === paneIdx) first = api;
      }

      if (!first && res.hlines.length && paneIdx > 0) {
        // pane tanpa plot: buat seri bayangan agar garis horizontal bisa digambar
        first = chart.addSeries(LW.LineSeries, { color: 'rgba(0,0,0,0)', lastValueVisible: false, priceLineVisible: false }, paneIdx);
        const lo = Math.min(...res.hlines.map((h) => h.price)), hi = Math.max(...res.hlines.map((h) => h.price));
        view.series.push({ api: first, pts: bars.map((b, i) => ({ time: ct(b.time), value: i % 2 ? lo : hi })), script: sc.name, title: null });
      }
      for (const h of res.hlines) {
        if (h.hidden || !first || isNa(h.price)) continue;
        const line = first.createPriceLine({
          price: h.price, color: typeof h.color === 'string' ? h.color : '#787B86', lineWidth: h.linewidth,
          lineStyle: h.linestyle === 'solid' ? 0 : h.linestyle === 'dotted' ? 1 : 2, axisLabelVisible: false, title: h.title,
        });
        view.priceLines.push({ series: first, line });
      }

      const pm = [];
      for (const s of res.shapes) {
        if (s.hidden) continue;
        const toCandle = overlay || s.forceOverlay || !first;
        for (const h of s.hits) {
          if (h.i < 0 || h.i >= n) continue;
          const m = {
            time: ct(bars[h.i].time), position: LOCS[s.location] || 'aboveBar',
            color: typeof h.color === 'string' ? h.color : '#2962FF',
            shape: (SHAPES[s.style] || ['circle'])[0], text: h.text || '', size: SIZES[s.size] || 1,
          };
          if (m.position === 'atPriceMiddle') {
            if (isNa(h.value)) m.position = 'aboveBar';
            else m.price = h.value;
          }
          (toCandle ? cm : pm).push({ i: h.i, m });
        }
      }
      if (pm.length && first && first !== candle) {
        pm.sort((a, b) => a.i - b.i);
        view.paneMarkers.push({ plugin: LW.createSeriesMarkers(first, []), list: pm });
      }

      // objek gambar: box / line / label
      const toMain = { box: [], line: [], label: [] }, toPane = { box: [], line: [], label: [] };
      for (const k of ['box', 'line', 'label']) for (const o of dr[k]) (overlay || o.props.force_overlay ? toMain : toPane)[k].push(o);
      const attach = (series, items) => {
        if (!items.box.length && !items.line.length && !items.label.length) return;
        const prim = new LunaDrawLayer.DrawingPrimitive({ items, getEnd: endIdx, getBars: () => S.bars });
        series.attachPrimitive(prim);
        view.prims.push({ series, prim });
      };
      attach(candle, toMain);
      if (toPane.box.length || toPane.line.length || toPane.label.length) {
        if (!first) {
          // pane tanpa plot: seri bayangan dengan rentang harga dari objek gambar
          const ys = [];
          for (const o of toPane.box) ys.push(o.props.top, o.props.bottom);
          for (const o of toPane.line) ys.push(o.props.y1, o.props.y2);
          for (const o of toPane.label) ys.push(o.props.y);
          const fin = ys.filter((v) => typeof v === 'number' && isFinite(v));
          const lo = fin.length ? Math.min(...fin) : 0, hi = fin.length ? Math.max(...fin) : 1;
          first = chart.addSeries(LW.LineSeries, { color: 'rgba(0,0,0,0)', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, paneIdx);
          view.series.push({ api: first, pts: bars.map((b, i) => ({ time: ct(b.time), value: i % 2 ? lo : hi })), script: sc.name, title: null });
        }
        attach(first, toPane);
      }
      view.tables.push(...dr.table);
    }

    // marker trade dari strategi terpilih
    const sel = selectedStrategyResult();
    if (sel) {
      const st = sel.res.strategy;
      const seenEntry = new Set(); // partial exit = beberapa trade dari satu entry → satu marker entry saja
      const mk = (t, open) => {
        const long = t.dir > 0;
        const ek = t.entryId + '@' + t.entryBar;
        if (!seenEntry.has(ek)) {
          seenEntry.add(ek);
          cm.push({ i: t.entryBar, m: { time: ct(bars[t.entryBar].time), position: long ? 'belowBar' : 'aboveBar', color: long ? '#2962FF' : '#F23645', shape: long ? 'arrowUp' : 'arrowDown', text: t.entryId } });
        }
        if (!open) {
          cm.push({ i: t.exitBar, m: { time: ct(bars[t.exitBar].time), position: long ? 'aboveBar' : 'belowBar', color: '#B2B5BE', shape: long ? 'arrowDown' : 'arrowUp', text: `${t.exitId} ${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl, 2)}` }, exit: true });
        }
      };
      st.trades.forEach((t) => mk(t, false));
      st.openTrades.forEach((t) => mk(t, true));
    }
    // news tambahan pengguna → penanda di atas candle (bersama penanda news indikator Cycle Low)
    if (customNews.length && S.scripts.some((x) => x.enabled && /indicator\("Cycle Low/.test(x.code)) && bars.length) {
      for (const n of customNews) {
        const t = Date.parse(n.d + 'T00:00:00Z');
        if (t < bars[0].time || t > bars[bars.length - 1].time + 864e5) continue;
        let i = bars.findIndex((b) => b.time + (bars.length > 1 ? bars[1].time - bars[0].time : 864e5) > t);
        if (i < 0) i = bars.length - 1;
        cm.push({ i, m: { time: ct(bars[i].time), position: 'aboveBar', color: +n.k ? '#5d6b8a' : '#e91e63', shape: 'square', text: (+n.k ? '📌 ' : '📰 ') + n.s } });
      }
    }
    cm.sort((a, b) => a.i - b.i);
    view.candleMarkers = cm;

    const panes = chart.panes();
    for (let k = 1; k < panes.length; k++) panes[k].setHeight(130);
    applyData(endIdx());
    renderLegend(null);
  }

  function hexA(c, a) {
    const p = Pine.parseColor(c);
    return p ? `rgba(${p[0]},${p[1]},${p[2]},${a})` : c;
  }

  function applyMarkers(end) {
    const paper = S.paper && S.replay.active ? S.paper.markers : [];
    const all = paper.length ? view.candleMarkers.concat(paper).sort((a, b) => a.i - b.i) : view.candleMarkers;
    candleMarkerApi.setMarkers(all.filter((x) => x.i <= end).map((x) => x.m));
    for (const p of view.paneMarkers) p.plugin.setMarkers(p.list.filter((x) => x.i <= end).map((x) => x.m));
  }

  function applyData(end) {
    if (!S.bars.length) return;
    candle.setData(view.candlePts.slice(0, end + 1));
    volume.setData(view.volPts.slice(0, end + 1));
    for (const s of view.series) s.api.setData(s.pts.slice(0, end + 1));
    applyMarkers(end);
    LunaDrawLayer.renderTables($('pine-tables'), view.tables, end);
  }

  function appendData(idx) {
    candle.update(view.candlePts[idx]);
    volume.update(view.volPts[idx]);
    for (const s of view.series) s.api.update(s.pts[idx]);
    applyMarkers(idx);
    LunaDrawLayer.renderTables($('pine-tables'), view.tables, idx);
  }

  // ------------------------------------------------------------------
  // Legend (OHLC + nilai indikator di posisi crosshair)
  // ------------------------------------------------------------------
  function fmt(v, d) {
    if (isNa(v)) return '—';
    if (!isFinite(v)) return v > 0 ? '∞' : '-∞';
    if (d === undefined) d = S.priceDec;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtTime(ms) {
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // desimal nilai indikator di legend: ikuti harga koin (PEPE butuh 8 desimal, RSI cukup 2–4)
  function legendDec(v) {
    const a = Math.abs(v);
    if (a >= 1000) return 2;
    if (a >= 1) return Math.min(Math.max(S.priceDec, 2), 4);
    return Math.max(S.priceDec, 4);
  }

  function renderLegend(param) {
    const n = S.bars.length;
    if (!n) { $('legend').innerHTML = ''; return; }
    let i = endIdx();
    if (param && param.logical !== undefined && param.logical !== null) i = Math.max(0, Math.min(endIdx(), Math.round(param.logical)));
    const b = S.bars[i];
    const prev = S.bars[i - 1] || b;
    const ch = b.close - prev.close;
    const cls = ch >= 0 ? 'up' : 'down';
    let html = `<div><span class="sym">${esc(settings.symbol)} · ${esc(S.source === 'binance' ? settings.tf : S.source)}</span>` +
      `<span class="${cls}">O ${fmt(b.open)} H ${fmt(b.high)} L ${fmt(b.low)} C ${fmt(b.close)} ` +
      `${ch >= 0 ? '+' : ''}${fmt(ch)} (${fmt((ch / prev.close) * 100, 2)}%)</span> <span class="ind">Vol ${fmt(b.volume, 2)} · ${fmtTime(b.time)}</span></div>`;
    const groups = new Map();
    for (const s of view.series) {
      if (!s.title) continue;
      const pt = s.pts[i];
      if (!groups.has(s.script)) groups.set(s.script, []);
      groups.get(s.script).push(`<b style="color:${esc(pt && pt.color && pt.color !== GAP ? pt.color : s.color)}">${pt && pt.value !== undefined ? fmt(pt.value, legendDec(pt.value)) : '—'}</b>`);
    }
    for (const [name, vals] of groups) html += `<div class="ind">${esc(name)} ${vals.join(' ')}</div>`;
    $('legend').innerHTML = html;
  }
  chart.subscribeCrosshairMove((p) => renderLegend(p.time ? p : null));

  // ------------------------------------------------------------------
  // Menjalankan script
  // ------------------------------------------------------------------
  function getCompiled(code) {
    let c = S.compiled.get(code);
    if (!c) {
      c = Pine.compile(code);
      S.compiled.set(code, c);
      if (S.compiled.size > 50) S.compiled.delete(S.compiled.keys().next().value);
    }
    return c;
  }

  // ------------------------------------------------------------------
  // Cycle Low selalu dihitung dari data HARIAN (riwayat panjang) di timeframe apa pun,
  // lalu label/kotak/garis & plot dipetakan ke candle chart → prediksi sama persis di 15m, 1H, 4H, 1D.
  // ------------------------------------------------------------------
  const isCycleCode = (code) => /indicator\("Cycle Low/.test(code);
  const dailyCache = { key: '', bars: null, at: 0, loading: null, loadingKey: '', failedAt: 0 };
  function dailyBarsFor(sym) {
    if (dailyCache.key === sym && dailyCache.bars && Date.now() - dailyCache.at < 30 * 60e3) return dailyCache.bars;
    if ((!dailyCache.loading || dailyCache.loadingKey !== sym) && Date.now() - dailyCache.failedAt > 60e3) {
      dailyCache.loadingKey = sym;
      log(`Cycle Low: memuat data harian ${sym} (dipakai di semua timeframe)…`);
      dailyCache.loading = Data.fetchBinance(sym, '1d', 2000).then((b) => {
        Object.assign(dailyCache, { key: sym, bars: b, at: Date.now(), loading: null });
        if (settings.symbol === sym && settings.tf !== '1d') runAll();
      }).catch((e) => {
        Object.assign(dailyCache, { loading: null, failedAt: Date.now() });
        log(`Cycle Low: gagal memuat data harian (${e.message}) — sementara dihitung dari data chart`, true);
      });
    }
    return dailyCache.key === sym ? dailyCache.bars : null; // data lama (kedaluwarsa) tetap dipakai sambil memuat ulang
  }
  function mapDailyResult(res, daily, bars) {
    const DAY = 864e5, n = bars.length, last = bars[n - 1];
    const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 3600e3;
    const dayT = (d) => (d < daily.length ? daily[Math.max(0, d)].time : daily[daily.length - 1].time + (d - (daily.length - 1)) * DAY);
    const idxAt = (t) => { // candle chart yang memuat waktu t
      if (t > last.time + step) return n - 1 + Math.round((t - last.time) / step);
      if (t < bars[0].time) return -1;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].time <= t) lo = m; else hi = m - 1; }
      return lo;
    };
    const startIdx = (d) => { const t = dayT(d); const i = idxAt(t); return i >= 0 ? i : (t + DAY > bars[0].time ? 0 : -1); };
    const endIdx2 = (d) => Math.min(n - 1, Math.max(0, idxAt(dayT(d) + DAY - 1)));
    const lowIdx = (d) => { // candle dengan low terendah di hari itu (letak label DCL/WCL yang presisi)
      const t0 = dayT(d), t1 = t0 + DAY;
      let a = idxAt(t0); if (a < 0) a = 0;
      if (a >= n) return a;
      let best = -1;
      for (let i = a; i < n && bars[i].time < t1; i++) if (bars[i].time >= t0 - step && (best < 0 || bars[i].low < bars[best].low)) best = i;
      return best >= 0 ? best : startIdx(d);
    };
    const XK = ['x', 'left', 'right', 'x1', 'x2'];
    const mapProps = (p, atLow) => {
      if (!p) return p;
      const q = Object.assign({}, p);
      if (q.xloc && q.xloc !== 'bar_index') return q;
      for (const k of XK) if (typeof q[k] === 'number') q[k] = atLow && k === 'x' ? lowIdx(q[k]) : startIdx(q[k]);
      return q;
    };
    const out = { box: [], line: [], label: [], table: (res.drawings && res.drawings.table) || [] };
    for (const kind of ['box', 'line', 'label']) {
      for (const o of (res.drawings && res.drawings[kind]) || []) {
        const atLow = kind === 'label' && /^(DCL|WCL)$/.test(o.props.text);
        // waktu asli (dari data harian) untuk tabel — tetap benar walau titiknya di luar data chart
        const tx = typeof o.props.x === 'number' ? (atLow && lowIdx(o.props.x) >= 0 && lowIdx(o.props.x) < n && bars[lowIdx(o.props.x)].time >= dayT(o.props.x) ? bars[lowIdx(o.props.x)].time : dayT(o.props.x)) : undefined;
        out[kind].push(Object.assign({}, o, {
          tx, tl: typeof o.props.left === 'number' ? dayT(o.props.left) : undefined, tr: typeof o.props.right === 'number' ? dayT(o.props.right) : undefined,
          created: endIdx2(o.created), deleted: o.deleted === null ? null : endIdx2(o.deleted),
          init: mapProps(o.init, atLow), props: mapProps(o.props, atLow),
          hist: o.hist.map((h) => ({ i: endIdx2(h.i), k: h.k, v: XK.includes(h.k) && typeof h.v === 'number' ? startIdx(h.v) : h.v })),
        }));
      }
    }
    // plot: nilai hari yang memuat candle chart
    const dIdx = (t) => { let lo = 0, hi = daily.length - 1; if (t < daily[0].time) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (daily[m].time <= t) lo = m; else hi = m - 1; } return lo; };
    const map = bars.map((b) => dIdx(b.time));
    const plots = res.plots.map((p) => Object.assign({}, p, { values: map.map((d) => (d >= 0 ? p.values[d] : NaN)), colors: p.colors ? map.map((d) => (d >= 0 ? p.colors[d] : undefined)) : p.colors }));
    return Object.assign({}, res, { drawings: out, plots, shapes: [], bgcolors: [], barcolors: null, dailyBased: true });
  }

  function runScript(sc) {
    if (!S.bars.length) return null;
    const t0 = performance.now();
    let res;
    try {
      const daily = isCycleCode(sc.code) && S.source === 'binance' && settings.tf !== '1d' ? dailyBarsFor(settings.symbol) : null;
      if (daily && daily.length > 60) {
        res = Pine.run(getCompiled(sc.code), daily, { inputs: sc.inputs, symbol: settings.symbol, timeframe: '1d' });
        if (!res.error) res = mapDailyResult(res, daily, S.bars);
      } else res = Pine.run(getCompiled(sc.code), S.bars, { inputs: sc.inputs, symbol: settings.symbol, timeframe: S.source === 'csv' ? null : settings.tf });
    } catch (e) {
      res = { decl: Object.assign(Pine.peekDecl(sc.code), { overlay: true }), plots: [], shapes: [], hlines: [], bgcolors: [], barcolors: null, inputs: [], strategy: null, error: e.message };
    }
    sc.name = res.error && !res.plots.length ? Pine.peekDecl(sc.code).title || sc.name : res.decl.title || sc.name;
    S.results.set(sc.id, res);
    if (res.inputs.length) { S.inputDefs[sc.id] = res.inputs; store.set('inputDefs', S.inputDefs); }
    const ms = (performance.now() - t0).toFixed(0);
    for (const w of res.warnings || []) log(`${sc.name}: ⚠ ${w}`);
    if (res.error) log(`${sc.name}: ${res.error}`, true);
    else log(`${sc.name}: OK (${ms} ms${res.strategy ? `, ${res.strategy.trades.length} trade` : ''}${res.dailyBased ? ', dihitung dari data harian' : ''})`);
    return res;
  }

  function runAll() {
    S.results.clear();
    for (const sc of S.scripts) if (sc.enabled) runScript(sc);
    saveScripts();
    refreshAll();
  }

  function refreshAll() {
    buildView();
    renderScriptList();
    renderTester(true);
    renderCycles();
  }

  // ------------------------------------------------------------------
  // Tabel "Siklus & News" (dari indikator Cycle Low): tiap siklus + news selama siklus,
  // dan baris siklus berjalan berisi daftar "berjaga-jaga" (jadwal mendatang & guncangan baru)
  // ------------------------------------------------------------------
  const CycleLib = window.LunaCycle;
  const allEvents = () => ((CycleLib && CycleLib.EVENTS) || []).map((e) => ({ t: Date.parse(e[0] + 'T00:00:00Z'), k: e[1], s: e[2], l: e[3] }))
    .concat(customNews.map((n) => ({ t: Date.parse(n.d + 'T00:00:00Z'), k: +n.k, s: (+n.k ? '📌 ' : '📰 ') + n.s, l: n.s + ' (news tambahan Anda)', custom: true })))
    .sort((a, b) => a.t - b.t);
  const fmtDay = (t) => new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const EV_KIND = ['besar', 'FOMC', 'unlock ENA'];
  // ── Siklus 4 tahunan BTC (halving) — dari data BTC harian ──
  const HALVINGS = [['2016-07-09', 'Juli 2016'], ['2020-05-11', 'Mei 2020'], ['2024-04-20', 'April 2024'], ['2028-04-15', '±April 2028 (perkiraan)']].map(([d, n]) => ({ t: Date.parse(d + 'T00:00:00Z'), n }));
  const btcDaily = { bars: null, at: 0, loading: false };
  function btcDailyBars() {
    if (settings.symbol === 'BTCUSDT' && dailyCache.key === 'BTCUSDT' && dailyCache.bars) return dailyCache.bars;
    if (btcDaily.bars && Date.now() - btcDaily.at < 6 * 3600e3) return btcDaily.bars;
    if (!btcDaily.loading && S.source === 'binance') {
      btcDaily.loading = true;
      Data.fetchBinance('BTCUSDT', '1d', 2000).then((b) => { Object.assign(btcDaily, { bars: b, at: Date.now(), loading: false }); renderCycles(); })
        .catch(() => { btcDaily.loading = false; });
    }
    return btcDaily.bars;
  }
  function fourYearHtml() {
    const b = btcDailyBars();
    if (!b || b.length < 400) return '<span class="muted">Memuat data BTC harian untuk siklus 4 tahunan…</span>';
    const M = 30.44 * 864e5, now = b[b.length - 1];
    const h = HALVINGS.filter((x) => x.t <= now.time).pop(), next = HALVINGS.find((x) => x.t > now.time);
    let pk = null; for (const x of b) if (x.time >= h.t && (!pk || x.high > pk.high)) pk = x;
    let lo = null; for (const x of b) if (x.time > pk.time && (!lo || x.low < lo.low)) lo = x;
    const mo = (now.time - h.t) / M, fromPk = (now.time - pk.time) / M;
    const sma = (n) => (b.length >= n ? b.slice(-n).reduce((s2, x) => s2 + x.close, 0) / n : NaN);
    const ma200 = sma(200), ma200w = sma(1400);
    // tahun ke berapa dalam siklus 4 tahunan (dihitung dari tanggal halving)
    const Y = 365.25 * 864e5;
    const yr = Math.min(4, Math.floor((now.time - h.t) / Y) + 1), dayInYr = Math.floor(((now.time - h.t) % Y) / 864e5) + 1;
    const YEARS = [
      ['Tahun 1', 'Pasca-halving: bull awal', 'Mei 2020–21 +562% · Apr 2024–25 +31%'],
      ['Tahun 2', 'Puncak siklus (bln 17–18) lalu awal bear', 'Mei 2021–22 −41% · Apr 2025–26 −13% (puncak Okt 2025)'],
      ['Tahun 3', 'Dasar bear market (low Des 2018 / Nov 2022) lalu mulai pulih', 'Jul 2018–19 +99% · Mei 2022–23 −7%'],
      ['Tahun 4', 'Pemulihan menuju halving berikutnya', 'Jul 2019–20 −24% (COVID) · Mei 2023–24 +127%'],
    ];
    const yStart = (k) => fmtDay(h.t + (k - 1) * Y).slice(3);
    const tl = YEARS.map((y, k) => `<span class="yr ${k + 1 === yr ? 'now' : k + 1 < yr ? 'past' : ''}" title="${esc(y[2])}"><b>${y[0]}</b> <span class="muted">${yStart(k + 1)}</span><br>${esc(y[1])}${k + 1 === yr ? `<br><b>◀ SEKARANG · hari ke-${dayInYr}/365</b>` : ''}</span>`).join('');
    const fp = (v) => '$' + Math.round(v).toLocaleString('en-US');
    return `<b>Siklus 4 tahunan BTC</b> (halving ${esc(h.n)} → ${esc(next ? next.n : '?')}): sekarang <b>TAHUN KE-${yr} dari 4</b>
      <div class="yr-line">${tl}</div>
      <span class="muted">Puncak siklus ini ${fmtDay(pk.time)} ${fp(pk.high)} (${((pk.time - h.t) / M).toFixed(1)} bln setelah halving; historis 17,3 & 18,0) ·
      ${lo ? `low sejak puncak ${fmtDay(lo.time)} ${fp(lo.low)} (−${(100 * (1 - lo.low / pk.high)).toFixed(0)}%, ${((lo.time - pk.time) / M).toFixed(1)} bln setelah puncak; historis −84%/−78% sekitar 12 bln setelah puncak)` : ''} ·
      BTC ${fp(now.close)} ${now.close > ma200 ? 'di atas' : 'di bawah'} MA200 hari (${fp(ma200)})${isFinite(ma200w) ? ` & ${now.close > ma200w ? 'di atas' : 'di bawah'} MA200 minggu (${fp(ma200w)})` : ''}.
      Historis setelah low bear: 12 bln kemudian BTC +126% (2019) / +131% (2023).</span>`;
  }
  function renderCycles(force) {
    if (!force && !document.querySelector('[data-pane="cycles"]').classList.contains('active')) return;
    const sc = S.scripts.find((x) => x.enabled && /indicator\("Cycle Low/.test(x.code));
    const res = sc && S.results.get(sc.id);
    const bars = S.bars;
    if (!res || res.error || !res.drawings || !bars.length) {
      $('cycles-empty').classList.remove('hidden');
      $('cycles').classList.add('hidden');
      return;
    }
    $('cycles-empty').classList.add('hidden');
    $('cycles').classList.remove('hidden');
    const end = endIdx();
    const live = end >= bars.length - 1;
    const step = bars.length > 1 ? bars[1].time - bars[0].time : 864e5;
    const tOf = (x) => (x <= bars.length - 1 ? bars[Math.max(0, Math.round(x))].time : bars[bars.length - 1].time + (x - (bars.length - 1)) * step);
    const tX = (l) => (l.tx !== undefined ? l.tx : tOf(l.props.x)); // waktu asli (hasil harian) bila ada
    const labs = res.drawings.label.filter((l) => !l.deleted && l.created <= end);
    const tsort = (l) => (l.tx !== undefined ? l.tx : l.props.x);
    const dcl = labs.filter((l) => l.props.text === 'DCL').sort((a, b) => tsort(a) - tsort(b));
    const wclX = new Set(labs.filter((l) => l.props.text === 'WCL').map((l) => (l.tx !== undefined ? l.tx : l.props.x)));
    const events = allEvents();
    const evIn = (t0, t1, kinds) => events.filter((e) => e.t >= t0 && e.t < t1 && kinds.includes(e.k));
    const evTxt = (list) => list.map((e) => `<span class="ev ev${e.k}" title="${esc(fmtDay(e.t) + ' · ' + e.l)}">${esc(e.s)} <span class="muted">${fmtDay(e.t).slice(0, 6)}</span></span>`).join(' ') || '<span class="muted">—</span>';
    const nowT = bars[end].time;
    let html = '<thead><tr><th>Siklus</th><th>Low siklus</th><th>Harga low</th><th>Durasi</th><th>Status</th><th>News selama siklus / berjaga-jaga</th></tr></thead><tbody>';
    // siklus berjalan
    if (dcl.length) {
      const last = dcl[dcl.length - 1];
      const t0 = tX(last);
      const days = Math.floor(nowT / 864e5) - Math.floor(t0 / 864e5);
      const band = live && res.drawings.box.find((b) => !b.deleted && /^zona DCL/.test(b.props.text || ''));
      const pred = live && labs.find((l) => /^DCL /.test(l.props.text) && /Prediksi/.test(l.props.tooltip || ''));
      const bL = band && (band.tl !== undefined ? band.tl : tOf(band.props.left)), bR = band && (band.tr !== undefined ? band.tr : tOf(band.props.right));
      const bandTxt = band ? `band ${fmtDay(bL).slice(0, 6)} – ${fmtDay(bR).slice(0, 6)}` : '';
      const horizon = band ? Math.max(bR, nowT + 30 * 864e5) : nowT + 45 * 864e5;
      const upcoming = live ? evIn(nowT + 1, horizon + 7 * 864e5, [0, 1, 2]) : [];
      const recentShock = events.filter((e) => e.k === 0 && e.t <= nowT && e.t > nowT - 7 * 864e5);
      const watch = [];
      for (const e of recentShock) watch.push(`<span class="ev ev0 warn" title="${esc(e.l)}">⚠ ${esc(e.s)} ${fmtDay(e.t).slice(0, 6)}: guncangan baru — low siklus bisa datang lebih cepat / lebih dalam</span>`);
      for (const e of upcoming) watch.push(`<span class="ev ev${e.k}" title="${esc(e.l)}">${esc(e.s)} ${fmtDay(e.t).slice(0, 6)} <span class="muted">(${Math.round((e.t - nowT) / 864e5)} hari lagi)</span></span>`);
      const sinceNews = evIn(t0 + 1, nowT + 1, [0]);
      const stPlot = res.plots.find((p) => p.title === 'Status siklus');
      const stv = stPlot ? stPlot.values[Math.min(end, stPlot.values.length - 1)] : 0;
      const STAT = [
        '<span class="muted">Status: hari < 15 — belum bisa dinilai (cek lagi di hari ke-15–25)</span>',
        '<span class="ev ev2">✓ Status: NORMAL / translasi kanan — historis 66–77% siklus seperti ini naik, DCL ditembus hanya 23–39%</span>',
        '<span class="ev ev0 warn">⚠ Status: TRANSLASI KIRI — historis 62–74% DCL kemudian ditembus. JANGAN entry/tambah long baru; posisi yang ada tetap ikuti SL · BE · MA 10 hari (keluar otomatis di tanda ini tidak terbukti lebih baik)</span>',
        '<span class="ev ev0 warn">✕ Status: DCL DITEMBUS (failed cycle) — historis low berikutnya median 14% di bawah DCL. Tunggu DCL baru terkonfirmasi</span>',
      ];
      const statTxt = '<br>' + (STAT[stv] || STAT[0]);
      html += `<tr class="cur" data-x="${last.props.x}"><td><b>▶ Berjalan</b></td><td>sejak DCL ${fmtDay(t0)}</td>
        <td>${pred ? `<b>prediksi ${esc(pred.props.text.replace(/^DCL /, ''))}</b>` : '<span class="muted">—</span>'}</td>
        <td>hari ke-${days}</td><td class="muted">${esc(bandTxt)}</td>
        <td class="wrap">${sinceNews.length ? 'Sudah terjadi: ' + evTxt(sinceNews) + '<br>' : ''}<b>Berjaga-jaga:</b> ${watch.join(' ') || '<span class="muted">tidak ada jadwal kejadian dalam band ini</span>'}${statTxt}</td></tr>`;
    }
    for (let k = dcl.length - 1; k >= 0; k--) {
      const l = dcl[k], t0 = tX(l), t1 = k + 1 < dcl.length ? tX(dcl[k + 1]) : null;
      const failed = /failed/.test(l.props.tooltip || '');
      const isW = wclX.has(l.tx !== undefined ? l.tx : l.props.x);
      // kejadian ≤3 hari sebelum sebuah low dihitung ke siklus yang low-nya dipicu kejadian itu
      const news = evIn(t0 - 3 * 864e5, t1 ? t1 - 3 * 864e5 : nowT + 1, [0]);
      html += `<tr data-x="${l.props.x}"><td>#${k + 1}</td><td>${fmtDay(t0)}</td><td>${fmtPx(l.props.y)}</td>
        <td>${t1 ? Math.round(Math.floor(t1 / 864e5) - Math.floor(t0 / 864e5)) + ' hari' : '<span class="muted">berjalan</span>'}</td>
        <td>${isW ? '<span class="tag w">WCL</span> ' : ''}${failed ? '<span class="tag f">failed</span>' : '<span class="tag d">DCL</span>'}</td>
        <td class="wrap">${evTxt(news)}</td></tr>`;
    }
    $('cycles-table').innerHTML = html + '</tbody>';
    $('cycles-4y').innerHTML = fourYearHtml();
    $('cycles-note').innerHTML = `Klik baris untuk melihat siklus di chart. News "selama siklus" = peristiwa besar dari 3 hari sebelum low sampai low berikutnya.
      Studi Apr 2024 – Nov 2026: ±17–20% cycle low (ENA/BTC) terjadi dekat guncangan (perang, hack, krisis) vs ±7% kebetulan; setelah guncangan, low ENA langsung terbentuk ≤7 hari hanya di 5 dari 14 kasus.
      FOMC & unlock ENA tidak terbukti memengaruhi waktu low. Guncangan tak terjadwal tidak bisa diprediksi — daftar news perlu diperbarui manual.<br>
      Cycle Low dihitung dari data harian di semua timeframe.<br>
      Studi 1.028 daily cycle (21 koin): DCL ditembus di 64% siklus (rally median +29%, puncak di 30% durasi) vs bertahan 36% (rally +84%, puncak di 75%).
      Penanda terbaik arah siklus: <b>translasi kiri</b> di hari 15–25 setelah DCL → 62–74% DCL kemudian ditembus (vs 23–39%). Setup DCL saat koin di bawah MA200 hari historis lebih baik (+0.30R) daripada di atasnya (−0.35R).`;
  }
  function renderNewsList() {
    $('nw-list').innerHTML = customNews.length
      ? customNews.map((n, i) => `<span class="ev ev${+n.k ? 1 : 0}">${esc(n.d)} · ${esc(n.s)} <button class="x" data-del="${i}" title="Hapus">×</button></span>`).join(' ')
      : '';
  }
  $('nw-date').value = new Date().toISOString().slice(0, 10);
  $('nw-add').onclick = () => {
    const d = $('nw-date').value, txt = $('nw-text').value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !txt) { log('News: isi tanggal dan teks kejadian dulu.', true); return; }
    customNews.push({ d, k: +$('nw-kind').value, s: txt });
    customNews.sort((a, b) => (a.d < b.d ? -1 : 1));
    store.set('customNews', customNews);
    $('nw-text').value = '';
    renderNewsList();
    buildView();
    renderCycles(true);
  };
  $('nw-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    customNews.splice(+b.dataset.del, 1);
    store.set('customNews', customNews);
    renderNewsList();
    buildView();
    renderCycles(true);
  });
  renderNewsList();

  $('cycles-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-x]');
    if (!tr) return;
    const x = +tr.dataset.x;
    if (x < 0) { status('Siklus ini di luar data chart — tambah jumlah bar atau pakai timeframe 1d', true); return; }
    const w = settings.tf === '1d' ? 60 : settings.tf === '4h' ? 240 : 720;
    chart.timeScale().setVisibleLogicalRange({ from: x - w, to: x + w });
  });
  document.querySelector('[data-tabs="bottom"] [data-tab="cycles"]').addEventListener('click', () => renderCycles(true));

  // ------------------------------------------------------------------
  // Daftar script
  // ------------------------------------------------------------------
  const openInputs = new Set();

  function renderScriptList() {
    const ul = $('script-list');
    ul.innerHTML = '';
    for (const sc of S.scripts) {
      const res = S.results.get(sc.id);
      const decl = Pine.peekDecl(sc.code);
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="script-row">
          <input type="checkbox" ${sc.enabled ? 'checked' : ''} title="Tampilkan di chart" />
          <span class="name" title="Klik untuk edit">${esc(sc.name || decl.title)}</span>
          <span class="tag ${decl.type}">${decl.type === 'strategy' ? 'strategi' : 'indikator'}</span>
          <button data-a="inputs" title="Pengaturan input">⚙</button>
          <button data-a="edit" title="Edit kode">✎</button>
          <button data-a="dup" title="Duplikat">⧉</button>
          <button data-a="del" title="Hapus">🗑</button>
        </div>`;
      if (res && res.error && sc.enabled) {
        const e = document.createElement('div');
        e.className = 'script-err';
        e.textContent = res.error;
        li.appendChild(e);
      }
      if (openInputs.has(sc.id)) li.appendChild(renderInputs(sc));
      li.querySelector('input[type=checkbox]').onchange = (ev) => {
        sc.enabled = ev.target.checked;
        if (sc.enabled) runScript(sc);
        else S.results.delete(sc.id);
        saveScripts();
        refreshAll();
      };
      li.querySelector('.name').onclick = () => openEditor(sc.id);
      li.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const a = b.dataset.a;
          if (a === 'edit') openEditor(sc.id);
          if (a === 'inputs') {
            if (openInputs.has(sc.id)) openInputs.delete(sc.id);
            else {
              openInputs.add(sc.id);
              if (!S.inputDefs[sc.id]) { runScript(sc); if (!sc.enabled) S.results.delete(sc.id); }
            }
            renderScriptList();
          }
          if (a === 'dup') {
            const copy = { id: uid(), name: sc.name + ' (salinan)', code: sc.code, enabled: false, inputs: Object.assign({}, sc.inputs) };
            S.scripts.splice(S.scripts.indexOf(sc) + 1, 0, copy);
            saveScripts();
            renderScriptList();
          }
          if (a === 'del') {
            if (!confirm(`Hapus script "${sc.name}"?`)) return;
            S.scripts.splice(S.scripts.indexOf(sc), 1);
            S.results.delete(sc.id);
            if (S.editingId === sc.id) S.editingId = null;
            saveScripts();
            refreshAll();
          }
        };
      });
      ul.appendChild(li);
    }
    if (!S.scripts.length) ul.innerHTML = '<div class="empty">Belum ada script. Klik “+ Indikator”.</div>';
  }

  function renderInputs(sc) {
    const box = document.createElement('div');
    box.className = 'inputs';
    const defs = S.inputDefs[sc.id] || [];
    if (!defs.length) {
      box.innerHTML = '<span class="muted" style="grid-column:1/-1">Script ini tidak punya input.</span>';
      return box;
    }
    const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'];
    for (const d of defs) {
      const cur = Object.prototype.hasOwnProperty.call(sc.inputs, d.key) ? sc.inputs[d.key] : d.defval;
      const lab = document.createElement('label');
      lab.textContent = d.title;
      lab.title = d.title;
      let inp;
      if (d.type === 'bool') {
        inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = cur === true || cur === 'true';
      } else if (d.type === 'source' || d.type === 'timeframe' || Array.isArray(d.options)) {
        inp = document.createElement('select');
        const TFOPTS = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', '1D', '3D', '1W', '1M', '3M'];
        const opts = d.type === 'source' ? SOURCES : Array.isArray(d.options) ? d.options : TFOPTS.includes(String(cur)) ? TFOPTS : [String(cur), ...TFOPTS];
        for (const o of opts) {
          const op = document.createElement('option');
          op.value = o; op.textContent = o;
          if (String(o) === String(cur)) op.selected = true;
          inp.appendChild(op);
        }
      } else if (d.type === 'color') {
        inp = document.createElement('input');
        inp.type = 'color';
        const p = Pine.parseColor(cur);
        inp.value = p ? '#' + p.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('') : '#2962ff';
      } else {
        inp = document.createElement('input');
        const numeric = d.type === 'int' || d.type === 'float' || typeof d.defval === 'number';
        inp.type = numeric ? 'number' : 'text';
        if (numeric) {
          inp.step = d.step || (d.type === 'int' ? 1 : 'any');
          if (!isNa(d.minval)) inp.min = d.minval;
          if (!isNa(d.maxval)) inp.max = d.maxval;
        }
        inp.value = cur;
      }
      inp.onchange = () => {
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (inp.type === 'number') {
          v = Number(v);
          if (!isNa(d.minval)) v = Math.max(d.minval, v);
          if (!isNa(d.maxval)) v = Math.min(d.maxval, v);
        }
        sc.inputs[d.key] = v;
        saveScripts();
        if (sc.enabled) { runScript(sc); refreshAll(); }
      };
      box.appendChild(lab);
      box.appendChild(inp);
    }
    const rs = document.createElement('button');
    rs.className = 'reset ghost';
    rs.textContent = 'Kembalikan default';
    rs.onclick = () => {
      sc.inputs = {};
      saveScripts();
      if (sc.enabled) { runScript(sc); refreshAll(); } else renderScriptList();
    };
    box.appendChild(rs);
    return box;
  }

  // ------------------------------------------------------------------
  // Editor
  // ------------------------------------------------------------------
  const code = $('code');
  const gutter = $('gutter');
  let errLine = null;

  function renderGutter() {
    const lines = code.value.split('\n').length;
    let h = '';
    for (let k = 1; k <= lines; k++) h += k === errLine ? `<span class="err">${k}</span>\n` : k + '\n';
    gutter.innerHTML = h;
    gutter.scrollTop = code.scrollTop;
  }
  code.addEventListener('input', renderGutter);
  code.addEventListener('scroll', () => { gutter.scrollTop = code.scrollTop; });

  function setEditorError(msg) {
    const box = $('editor-error');
    if (!msg) { box.classList.add('hidden'); errLine = null; renderGutter(); return; }
    box.textContent = msg;
    box.classList.remove('hidden');
    const m = /Baris (\d+)/.exec(msg);
    errLine = m ? +m[1] : null;
    renderGutter();
  }

  function openEditor(id) {
    const sc = S.scripts.find((s) => s.id === id);
    if (!sc) return;
    S.editingId = id;
    code.value = sc.code;
    $('editor-title').textContent = 'Mengedit: ' + sc.name;
    const res = S.results.get(id);
    setEditorError(res && res.error ? res.error : null);
    switchTab('side', 'editor');
    code.focus();
  }

  function saveEditor(asNew) {
    const src = code.value;
    let sc = asNew ? null : S.scripts.find((s) => s.id === S.editingId);
    if (!sc) {
      sc = { id: uid(), name: Pine.peekDecl(src).title, code: src, enabled: true, inputs: {} };
      S.scripts.push(sc);
      S.editingId = sc.id;
    }
    sc.code = src;
    sc.enabled = true;
    // cek kompilasi dulu agar error tampil di editor
    try {
      getCompiled(src);
    } catch (e) {
      setEditorError(e.message);
      log(`${sc.name}: ${e.message}`, true);
      saveScripts();
      S.results.delete(sc.id);
      refreshAll();
      return;
    }
    const res = runScript(sc);
    setEditorError(res && res.error ? res.error : null);
    $('editor-title').textContent = 'Mengedit: ' + sc.name;
    saveScripts();
    refreshAll();
    status(res && !res.error ? `"${sc.name}" disimpan & diterapkan` : `"${sc.name}" disimpan, tapi ada error`, !!(res && res.error));
  }

  code.addEventListener('keydown', (e) => {
    const v = code.value;
    const s = code.selectionStart, en = code.selectionEnd;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 's')) {
      e.preventDefault();
      saveEditor(false);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (s === en && !e.shiftKey) {
        code.setRangeText('    ', s, en, 'end');
      } else {
        const block = v.slice(ls, en);
        const out = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    ');
        code.setRangeText(out, ls, en, 'select');
      }
      renderGutter();
      return;
    }
    if (e.key === 'Enter') {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(ls, s);
      let ind = (/^\s*/.exec(line) || [''])[0];
      const t = line.trim();
      if (/=>\s*$/.test(t) || /^(if|else|for|while)\b/.test(t)) ind += '    ';
      e.preventDefault();
      code.setRangeText('\n' + ind, s, en, 'end');
      renderGutter();
    }
  });

  $('btn-save').onclick = () => saveEditor(false);
  $('btn-save-new').onclick = () => saveEditor(true);
  function newScript(tpl) {
    S.editingId = null;
    code.value = tpl;
    $('editor-title').textContent = 'Script baru (belum disimpan)';
    setEditorError(null);
    switchTab('side', 'editor');
    code.focus();
  }
  $('btn-new-ind').onclick = () => newScript(Examples.TEMPLATE_INDICATOR);
  $('btn-new-strat').onclick = () => newScript(Examples.TEMPLATE_STRATEGY);
  $('btn-reset-examples').onclick = () => {
    for (const e of Examples.EXAMPLES) S.scripts.push({ id: uid(), name: e.name, code: e.code, enabled: false, inputs: {}, exampleKey: e.key, exampleHash: Examples.hashCode(e.code) });
    saveScripts();
    renderScriptList();
  };
  $('btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(S.scripts.map(({ name, code: c, enabled, inputs }) => ({ name, code: c, enabled, inputs })), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'luna-scripts.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('import-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    try {
      if (/\.json$/i.test(f.name)) {
        const arr = JSON.parse(text);
        for (const x of Array.isArray(arr) ? arr : [arr]) S.scripts.push({ id: uid(), name: x.name || 'Impor', code: x.code, enabled: false, inputs: x.inputs || {} });
      } else {
        S.scripts.push({ id: uid(), name: Pine.peekDecl(text).title, code: text, enabled: false, inputs: {} });
      }
      saveScripts();
      renderScriptList();
      status(`Impor ${f.name} berhasil — centang script untuk menampilkannya`);
    } catch (err) {
      status('Gagal impor: ' + err.message, true);
    }
  };

  // ------------------------------------------------------------------
  // Strategy Tester
  // ------------------------------------------------------------------
  let eqChart = null, eqSeries = null, bhSeries = null;
  let lastTesterRender = 0;

  function ensureEquityChart() {
    if (eqChart) return;
    eqChart = LW.createChart($('equity-chart'), Object.assign({}, chartOpts, {
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
      handleScroll: true, handleScale: true,
    }));
    bhSeries = eqChart.addSeries(LW.LineSeries, { color: '#787B86', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, title: 'Buy & Hold' });
    eqSeries = eqChart.addSeries(LW.BaselineSeries, {
      baseValue: { type: 'price', price: 0 }, lineWidth: 2, priceLineVisible: false,
      topLineColor: '#089981', topFillColor1: 'rgba(8,153,129,0.28)', topFillColor2: 'rgba(8,153,129,0.03)',
      bottomLineColor: '#f23645', bottomFillColor1: 'rgba(242,54,69,0.03)', bottomFillColor2: 'rgba(242,54,69,0.28)',
    });
  }

  function metricBox(k, v, cls) {
    return `<div class="metric"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div></div>`;
  }
  const sign = (v) => (isNa(v) ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');

  function renderTester(force) {
    const now = performance.now();
    if (!force && now - lastTesterRender < 150) return;
    lastTesterRender = now;
    const sel = selectedStrategyResult();
    const selEl = $('strategy-select');
    if (!sel) {
      $('tester-empty').classList.remove('hidden');
      $('tester').classList.add('hidden');
      selEl.classList.add('hidden');
      $('trades-table').innerHTML = '<tbody><tr><td class="muted">Belum ada strategi aktif.</td></tr></tbody>';
      return;
    }
    if (sel.all.length > 1) {
      selEl.classList.remove('hidden');
      const html = sel.all.map((s) => `<option value="${s.id}" ${s.id === sel.script.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      if (selEl.innerHTML !== html) selEl.innerHTML = html;
    } else selEl.classList.add('hidden');

    $('tester-empty').classList.add('hidden');
    $('tester').classList.remove('hidden');
    const st = sel.res.strategy;
    const end = endIdx();
    const m = BT.computeMetrics(st, S.bars, end);
    const ccy = '';
    $('metrics').innerHTML = [
      metricBox('Net Profit', `${fmt(m.netProfit, 2)}${ccy} <small>(${fmt(m.netProfitPct, 2)}%)</small>`, sign(m.netProfit)),
      metricBox('Equity Akhir', fmt(m.finalEquity, 2)),
      metricBox('Total Trade', m.totalTrades),
      metricBox('Win Rate', `${fmt(m.winRate, 1)}% <small>(${m.wins}/${m.totalTrades})</small>`),
      metricBox('Profit Factor', fmt(m.profitFactor, 2), m.profitFactor >= 1 ? 'pos' : 'neg'),
      metricBox('Max Drawdown', `${fmt(m.maxDrawdown, 2)} <small>(${fmt(m.maxDrawdownPct, 2)}%)</small>`, 'neg'),
      metricBox('Rata-rata Trade', fmt(m.avgTrade, 2), sign(m.avgTrade)),
      metricBox('Avg Win / Avg Loss', `${fmt(m.avgWin, 2)} / ${fmt(m.avgLoss, 2)}`),
      metricBox('Rasio Win/Loss', fmt(m.ratioWinLoss, 2)),
      metricBox('Win Terbesar', fmt(m.largestWin, 2), 'pos'),
      metricBox('Loss Terbesar', fmt(m.largestLoss, 2), 'neg'),
      metricBox('Gross Profit / Loss', `${fmt(m.grossProfit, 2)} / ${fmt(m.grossLoss, 2)}`),
      metricBox('Open P&L', fmt(m.openProfit, 2), sign(m.openProfit)),
      metricBox('Buy & Hold', `${fmt(m.buyHoldPct, 2)}%`, sign(m.buyHoldPct)),
      metricBox('Rata-rata Bar/Trade', fmt(m.avgBarsInTrade, 1)),
      metricBox('Komisi Dibayar', fmt(m.commissionPaid, 2)),
    ].join('');
    $('replay-note').textContent = S.replay.active ? `(sampai bar replay: ${fmtTime(S.bars[end].time)})` : '';

    ensureEquityChart();
    const eq = [], bh = [];
    const c0 = S.bars[0].close;
    for (let i = 0; i <= end; i++) {
      const t = ct(S.bars[i].time);
      const v = st.equity[i];
      eq.push(isNa(v) ? { time: t } : { time: t, value: v });
      bh.push({ time: t, value: st.initialCapital * (S.bars[i].close / c0) });
    }
    eqSeries.applyOptions({ baseValue: { type: 'price', price: st.initialCapital } });
    eqSeries.setData(eq);
    bhSeries.setData(bh);
    if (force) eqChart.timeScale().fitContent();

    renderTrades(st, end);
  }

  function renderTrades(st, end) {
    const rows = [];
    const closed = st.trades.filter((t) => t.exitBar <= end);
    // posisi yang masih terbuka di titik `end`
    const open = st.trades.filter((t) => t.entryBar <= end && t.exitBar > end).concat(st.openTrades.filter((t) => t.entryBar <= end));
    const px = S.bars[end].close;
    const list = closed.map((t, k) => ({ t, k: k + 1, open: false }))
      .concat(open.map((t) => ({ t: Object.assign({}, t, { exitPrice: px, exitBar: end, pnl: t.dir * (px - t.entryPrice) * t.qty, pnlPct: ((t.dir * (px - t.entryPrice)) / t.entryPrice) * 100 }), k: '•', open: true })));
    list.reverse();
    for (const { t, k, open: isOpen } of list.slice(0, 500)) {
      rows.push(`<tr data-e="${t.entryBar}" data-x="${t.exitBar}">
        <td>${k}</td><td class="${t.dir > 0 ? 'pos' : 'neg'}">${t.dir > 0 ? 'Long' : 'Short'}</td>
        <td>${fmtTime(S.bars[t.entryBar].time)}</td><td>${fmt(t.entryPrice)}</td>
        <td>${isOpen ? '<i class="muted">terbuka</i>' : fmtTime(S.bars[t.exitBar].time)}</td><td>${fmt(t.exitPrice)}</td>
        <td>${fmt(t.qty, 4)}</td><td class="${sign(t.pnl)}">${fmt(t.pnl, 2)}</td><td class="${sign(t.pnl)}">${fmt(t.pnlPct, 2)}%</td>
        <td>${t.exitBar - t.entryBar}</td><td class="muted">${esc(t.entryId)} → ${esc(isOpen ? '' : t.exitId || '')}</td></tr>`);
    }
    $('trades-table').innerHTML = `<thead><tr><th>#</th><th>Tipe</th><th>Masuk</th><th>Harga</th><th>Keluar</th><th>Harga</th><th>Qty</th><th>P&amp;L</th><th>P&amp;L %</th><th>Bar</th><th>Sinyal</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="11" class="muted">Belum ada trade.</td></tr>'}</tbody>`;
  }
  $('trades-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-e]');
    if (!tr) return;
    const a = +tr.dataset.e, b = +tr.dataset.x;
    chart.timeScale().setVisibleLogicalRange({ from: a - 40, to: b + 40 });
  });
  $('strategy-select').onchange = (e) => {
    S.selectedStrategy = e.target.value;
    store.set('selectedStrategy', S.selectedStrategy);
    buildView();
    renderTester(true);
    renderCycles();
  };

  // ------------------------------------------------------------------
  // Replay
  // ------------------------------------------------------------------
  const R = S.replay;

  function enterReplay() {
    if (!S.bars.length) return;
    stopLive();
    R.active = true;
    R.picking = true;
    R.idx = null;
    if (!S.paper) resetPaper();
    $('btn-replay').classList.add('on');
    $('replay-controls').classList.remove('hidden');
    $('replay-hint').classList.remove('hidden');
    document.querySelector('.chart-wrap').classList.add('picking');
    $('paper-off').classList.add('hidden');
    $('paper').classList.remove('hidden');
    status('Replay: klik candle di chart untuk titik mulai');
  }

  function startReplayAt(idx) {
    idx = Math.max(1, Math.min(S.bars.length - 1, idx));
    R.picking = false;
    R.idx = idx;
    $('replay-hint').classList.add('hidden');
    document.querySelector('.chart-wrap').classList.remove('picking');
    applyData(idx);
    chart.timeScale().setVisibleLogicalRange({ from: idx - 120, to: idx + 15 });
    afterReplayMove();
  }

  function afterReplayMove() {
    renderLegend(null);
    renderTester(false);
    renderCycles();
    renderPaper();
    const b = S.bars[R.idx];
    status(`Replay: ${fmtTime(b.time)} · bar ${R.idx + 1}/${S.bars.length}`);
  }

  function stepReplay(dir) {
    if (!R.active || R.idx === null) return;
    if (dir > 0) {
      if (R.idx >= S.bars.length - 1) { pauseReplay(); status('Replay: sudah sampai bar terakhir'); return; }
      R.idx++;
      appendData(R.idx);
      paperOnBar(R.idx);
    } else {
      if (R.idx <= 1) return;
      R.idx--;
      applyData(R.idx);
    }
    afterReplayMove();
  }

  function playReplay() {
    if (!R.active || R.idx === null) return;
    pauseReplay();
    R.playing = true;
    $('rp-play').textContent = '⏸';
    R.timer = setInterval(() => stepReplay(1), +$('rp-speed').value);
  }
  function pauseReplay() {
    R.playing = false;
    clearInterval(R.timer);
    R.timer = null;
    $('rp-play').textContent = '▶';
  }
  function exitReplay() {
    pauseReplay();
    R.active = false;
    R.picking = false;
    R.idx = null;
    $('btn-replay').classList.remove('on');
    $('replay-controls').classList.add('hidden');
    $('replay-hint').classList.add('hidden');
    document.querySelector('.chart-wrap').classList.remove('picking');
    $('paper-off').classList.remove('hidden');
    $('paper').classList.add('hidden');
    applyData(endIdx());
    renderTester(true);
    renderCycles();
    renderLegend(null);
    status('Replay selesai');
  }

  chart.subscribeClick((p) => {
    if (!R.active || !R.picking || p.logical === undefined || p.logical === null) return;
    startReplayAt(Math.round(p.logical));
  });

  $('btn-replay').onclick = () => (R.active ? exitReplay() : enterReplay());
  $('rp-exit').onclick = exitReplay;
  $('rp-pick').onclick = () => {
    pauseReplay();
    R.picking = true;
    applyData(S.bars.length - 1);
    $('replay-hint').classList.remove('hidden');
    document.querySelector('.chart-wrap').classList.add('picking');
  };
  $('rp-play').onclick = () => (R.playing ? pauseReplay() : playReplay());
  $('rp-step').onclick = () => { pauseReplay(); stepReplay(1); };
  $('rp-back').onclick = () => { pauseReplay(); stepReplay(-1); };
  $('rp-speed').onchange = () => { if (R.playing) playReplay(); };
  $('rp-date').onchange = (e) => {
    const t = new Date(e.target.value).getTime();
    if (!isFinite(t)) return;
    let idx = S.bars.findIndex((b) => b.time >= t);
    if (idx < 0) idx = S.bars.length - 1;
    pauseReplay();
    startReplayAt(idx);
  };

  // ------------------------------------------------------------------
  // Paper trading saat replay
  // ------------------------------------------------------------------
  function resetPaper() {
    const cap = +$('pp-capital').value || 10000;
    S.paper = { capital: cap, balance: cap, pos: null, trades: [], markers: [] };
    renderPaper();
    if (R.active && R.idx !== null) applyMarkers(R.idx);
  }
  const feeRate = () => (+$('pp-fee').value || 0) / 100;
  const optNum = (id) => { const v = $(id).value; return v === '' ? NaN : +v; };

  function paperMarker(i, dir, text, color, exit) {
    S.paper.markers.push({ i, exit, m: { time: ct(S.bars[i].time), position: dir > 0 ? 'belowBar' : 'aboveBar', color, shape: exit ? 'circle' : dir > 0 ? 'arrowUp' : 'arrowDown', text } });
  }

  function paperOrder(dir) {
    if (!R.active || R.idx === null) return;
    const P = S.paper;
    const i = R.idx;
    const price = S.bars[i].close;
    if (P.pos && P.pos.dir !== dir) { paperClose(price, 'Manual', i); return; }
    const amount = +$('pp-amount').value;
    if (!(amount > 0)) { status('Isi nominal order (USDT) dulu', true); return; }
    const qty = amount / price;
    const fee = amount * feeRate();
    P.balance -= fee;
    if (P.pos) {
      P.pos.price = (P.pos.price * P.pos.qty + price * qty) / (P.pos.qty + qty);
      P.pos.qty += qty;
      P.pos.fees += fee;
    } else {
      P.pos = { dir, qty, price, bar: i, fees: fee, sl: optNum('pp-sl'), tp: optNum('pp-tp') };
    }
    paperMarker(i, dir, dir > 0 ? 'BUY' : 'SELL', '#F7C948', false);
    applyMarkers(i);
    renderPaper();
  }

  function paperClose(price, reason, i) {
    const P = S.paper;
    if (!P.pos) return;
    const p = P.pos;
    const fee = p.qty * price * feeRate();
    const gross = p.dir * (price - p.price) * p.qty;
    P.balance += gross - fee;
    const pnl = gross - fee - p.fees;
    P.trades.push({ dir: p.dir, qty: p.qty, entry: p.price, exit: price, entryBar: p.bar, exitBar: i, pnl, pct: ((p.dir * (price - p.price)) / p.price) * 100, reason });
    paperMarker(i, -p.dir, `${reason} ${pnl >= 0 ? '+' : ''}${fmt(pnl, 2)}`, pnl >= 0 ? '#089981' : '#F23645', true);
    P.pos = null;
    applyMarkers(i);
    renderPaper();
  }

  // cek SL/TP saat bar baru muncul
  function paperOnBar(i) {
    const P = S.paper;
    if (!P || !P.pos) return;
    const p = P.pos;
    const b = S.bars[i];
    const long = p.dir > 0;
    const slHit = !isNa(p.sl) && (long ? b.low <= p.sl : b.high >= p.sl);
    const tpHit = !isNa(p.tp) && (long ? b.high >= p.tp : b.low <= p.tp);
    if (!slHit && !tpHit) return;
    let which = slHit && tpHit ? ((b.high - b.open < b.open - b.low) === long ? 'TP' : 'SL') : slHit ? 'SL' : 'TP';
    const lvl = which === 'SL' ? p.sl : p.tp;
    const gap = which === 'SL' ? (long ? b.open <= lvl : b.open >= lvl) : (long ? b.open >= lvl : b.open <= lvl);
    paperClose(gap ? b.open : lvl, which, i);
  }

  function renderPaper() {
    const P = S.paper;
    if (!P) return;
    const i = R.idx === null ? S.bars.length - 1 : R.idx;
    const px = S.bars[i] ? S.bars[i].close : NaN;
    const upnl = P.pos ? P.pos.dir * (px - P.pos.price) * P.pos.qty : 0;
    const realized = P.balance - P.capital;
    const wins = P.trades.filter((t) => t.pnl > 0).length;
    $('pp-stats').innerHTML = [
      metricBox('Equity', fmt(P.balance + upnl, 2), sign(P.balance + upnl - P.capital)),
      metricBox('Saldo', fmt(P.balance, 2)),
      metricBox('Posisi', P.pos ? `${P.pos.dir > 0 ? 'LONG' : 'SHORT'} ${fmt(P.pos.qty, 4)}` : 'Flat', P.pos ? (P.pos.dir > 0 ? 'pos' : 'neg') : ''),
      metricBox('Harga Rata-rata', P.pos ? fmt(P.pos.price) : '—'),
      metricBox('P&L Berjalan', fmt(upnl, 2), sign(upnl)),
      metricBox('P&L Terealisasi', fmt(realized, 2), sign(realized)),
      metricBox('SL / TP', P.pos ? `${fmt(P.pos.sl)} / ${fmt(P.pos.tp)}` : '—'),
      metricBox('Trade / Win Rate', `${P.trades.length} / ${P.trades.length ? fmt((wins / P.trades.length) * 100, 1) + '%' : '—'}`),
    ].join('');
    const rows = P.trades.slice().reverse().map((t, k) => `<tr data-e="${t.entryBar}" data-x="${t.exitBar}"><td>${P.trades.length - k}</td>
      <td class="${t.dir > 0 ? 'pos' : 'neg'}">${t.dir > 0 ? 'Long' : 'Short'}</td><td>${fmtTime(S.bars[t.entryBar].time)}</td><td>${fmt(t.entry)}</td>
      <td>${fmtTime(S.bars[t.exitBar].time)}</td><td>${fmt(t.exit)}</td><td>${fmt(t.qty, 4)}</td>
      <td class="${sign(t.pnl)}">${fmt(t.pnl, 2)}</td><td class="${sign(t.pnl)}">${fmt(t.pct, 2)}%</td><td>${t.reason}</td></tr>`).join('');
    $('pp-table').innerHTML = `<thead><tr><th>#</th><th>Tipe</th><th>Masuk</th><th>Harga</th><th>Keluar</th><th>Harga</th><th>Qty</th><th>P&amp;L</th><th>%</th><th>Alasan</th></tr></thead><tbody>${rows || '<tr><td colspan="10" class="muted">Belum ada trade. Tekan BUY / SELL saat replay.</td></tr>'}</tbody>`;
  }
  $('pp-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-e]');
    if (tr) chart.timeScale().setVisibleLogicalRange({ from: +tr.dataset.e - 40, to: +tr.dataset.x + 40 });
  });
  $('pp-buy').onclick = () => paperOrder(1);
  $('pp-sell').onclick = () => paperOrder(-1);
  $('pp-close').onclick = () => R.idx !== null && paperClose(S.bars[R.idx].close, 'Manual', R.idx);
  $('pp-reset').onclick = () => { if (!S.paper || !S.paper.trades.length || confirm('Reset akun paper trading?')) resetPaper(); };
  ['pp-sl', 'pp-tp'].forEach((id) => {
    $(id).onchange = () => {
      if (S.paper && S.paper.pos) { S.paper.pos.sl = optNum('pp-sl'); S.paper.pos.tp = optNum('pp-tp'); renderPaper(); }
    };
  });

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  function priceDecimals(bars) {
    let dec = 2;
    for (let k = Math.max(0, bars.length - 300); k < bars.length; k++) {
      const s = String(bars[k].close);
      if (s.includes('e-')) return 8;
      const d = s.includes('.') ? s.split('.')[1].length : 0;
      if (d > dec) dec = d;
    }
    return Math.min(dec, 8);
  }

  function setBars(bars, source) {
    if (R.active) exitReplay();
    S.bars = bars;
    S.source = source;
    S.priceDec = priceDecimals(bars);
    candle.applyOptions({ priceFormat: { type: 'price', precision: S.priceDec, minMove: Math.pow(10, -S.priceDec) } });
    if (S.paper) resetPaper();
    runAll();
    chart.timeScale().setVisibleLogicalRange({ from: bars.length - 160, to: bars.length + 8 });
    $('btn-live').disabled = source !== 'binance';
    document.title = `${settings.symbol} · Luna`;
  }

  let loading = false;
  async function loadBinance() {
    if (loading) return;
    loading = true;
    stopLive();
    settings.symbol = (settings.symbol || 'BTCUSDT').toUpperCase();
    $('symbol-label').textContent = settings.symbol;
    settings.count = +$('barcount').value;
    saveSettings();
    status(`Memuat ${settings.symbol} ${settings.tf}…`);
    try {
      const bars = await Data.fetchBinance(settings.symbol, settings.tf, settings.count, (got, total) => status(`Memuat ${settings.symbol} ${settings.tf}… ${got}/${total}`));
      if (!bars.length) throw new Error('Data kosong');
      setBars(bars, 'binance');
      status(`${settings.symbol} ${settings.tf} · ${bars.length} bar dari Binance`);
      log(`Data dimuat: ${settings.symbol} ${settings.tf}, ${bars.length} bar`);
    } catch (e) {
      const msg = `Gagal memuat dari Binance (${e.message}).`;
      log(msg, true);
      if (!S.bars.length) {
        setBars(Data.demo(settings.count, settings.tf), 'demo');
        status(msg + ' Menampilkan data DEMO.', true);
      } else status(msg, true);
    } finally {
      loading = false;
    }
  }

  // ---- live ----
  let liveTimer = null;
  function startLive() {
    if (S.source !== 'binance' || R.active) return;
    stopLive();
    $('btn-live').classList.add('on');
    S.liveStop = Data.subscribe(settings.symbol, settings.tf, onKline, (st) => {
      if (st === 'live') status(`${settings.symbol} ${settings.tf} · LIVE`);
      if (st === 'reconnect') status('Live terputus, menyambung ulang…', true);
    });
  }
  function stopLive() {
    if (S.liveStop) S.liveStop();
    S.liveStop = null;
    $('btn-live').classList.remove('on');
  }
  function onKline(bar, closed) {
    const bars = S.bars;
    const last = bars[bars.length - 1];
    if (!last || bar.time < last.time) return;
    const isNew = bar.time > last.time;
    if (isNew) bars.push(bar);
    else bars[bars.length - 1] = bar;
    const i = bars.length - 1;
    // update candle langsung, indikator dihitung ulang berkala
    candle.update({ time: ct(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    volume.update({ time: ct(bar.time), value: bar.volume, color: bar.close >= bar.open ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)' });
    if (i === bars.length - 1 && !liveTimer) {
      liveTimer = setTimeout(() => {
        liveTimer = null;
        if (R.active) return;
        S.results.clear();
        for (const sc of S.scripts) if (sc.enabled) runScriptQuiet(sc);
        buildView();
        renderTester(true);
        renderCycles();
      }, closed || isNew ? 50 : 3000);
    }
    renderLegend(null);
  }
  function runScriptQuiet(sc) {
    try {
      S.results.set(sc.id, Pine.run(getCompiled(sc.code), S.bars, { inputs: sc.inputs, symbol: settings.symbol, timeframe: S.source === 'csv' ? null : settings.tf }));
    } catch (e) { /* error sudah tampil saat run awal */ }
  }

  // ------------------------------------------------------------------
  // UI umum: tabs, timeframe, resizer, shortcut
  // ------------------------------------------------------------------
  function switchTab(group, name) {
    const nav = document.querySelector(`[data-tabs="${group}"]`);
    nav.querySelectorAll('button[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    const body = nav.nextElementSibling;
    body.querySelectorAll(':scope > .pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    if (name === 'log') { logErrors = 0; $('log-badge').classList.add('hidden'); }
    if (group === 'bottom' && $('bottom').classList.contains('collapsed')) toggleBottom(false);
  }
  document.querySelectorAll('[data-tabs] > button[data-tab]').forEach((b) => {
    b.onclick = () => switchTab(b.parentElement.dataset.tabs, b.dataset.tab);
  });

  const tfBox = $('tfs');
  for (const tf of TFS) {
    const b = document.createElement('button');
    b.textContent = tf;
    b.onclick = () => {
      settings.tf = tf;
      tfBox.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.textContent === tf));
      loadBinance();
    };
    if (tf === settings.tf) b.classList.add('active');
    tfBox.appendChild(b);
  }
  $('symbol-label').textContent = settings.symbol;
  $('barcount').value = String(settings.count);
  $('btn-load').onclick = loadBinance;
  $('btn-live').onclick = () => (S.liveStop ? stopLive() : startLive());
  $('btn-demo').onclick = () => {
    stopLive();
    setBars(Data.demo(+$('barcount').value, settings.tf), 'demo');
    status('Data DEMO (acak) dimuat');
  };
  $('csv-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const bars = Data.parseCSV(await f.text());
      stopLive();
      settings.symbol = f.name.replace(/\.[^.]+$/, '').toUpperCase();
      $('symbol-label').textContent = settings.symbol;
      setBars(bars, 'csv');
      status(`CSV ${f.name}: ${bars.length} bar`);
    } catch (err) {
      status('Gagal membaca CSV: ' + err.message, true);
    }
  };

  function toggleBottom(force) {
    const b = $('bottom');
    const col = force === undefined ? !b.classList.contains('collapsed') : force;
    b.classList.toggle('collapsed', col);
    $('btn-collapse').textContent = col ? '▴' : '▾';
    settings.collapsed = col;
    saveSettings();
  }
  $('btn-collapse').onclick = () => toggleBottom();
  document.documentElement.style.setProperty('--bottom-h', settings.bottomH + 'px');
  if (settings.collapsed) toggleBottom(true);
  (function resizer() {
    const el = $('resizer');
    let startY = 0, startH = 0;
    const move = (e) => {
      const h = Math.max(80, Math.min(window.innerHeight - 200, startH + (startY - e.clientY)));
      settings.bottomH = h;
      document.documentElement.style.setProperty('--bottom-h', h + 'px');
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveSettings();
    };
    el.addEventListener('mousedown', (e) => {
      if ($('bottom').classList.contains('collapsed')) toggleBottom(false);
      startY = e.clientY;
      startH = $('bottom').getBoundingClientRect().height;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  })();

  // ------------------------------------------------------------------
  // Pemilih koin
  // ------------------------------------------------------------------
  const picker = { list: null, live: false, loadedAt: 0, quote: store.get('pickerQuote', 'USDT'), sel: 0, rows: [] };
  const favs = new Set(store.get('favorites', ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']));
  // tambahan favorit (sekali saja, agar yang sudah dihapus pengguna tidak muncul lagi)
  if (!store.get('favAdded1', false)) {
    for (const s of ['SNDKUSDT', 'NVDAUSDT', 'XAUUSDT']) favs.add(s);
    store.set('favorites', [...favs]);
    store.set('favAdded1', true);
  }
  // SANDISKUSDT tidak ada di Binance; simbol yang benar SNDKUSDT
  for (const [old, cur] of Object.entries(Data.ALIAS || {})) if (favs.has(old)) { favs.delete(old); favs.add(cur); store.set('favorites', [...favs]); }
  const perpTag = (x) => (x.market === 'futures' || Data.marketOf(x.symbol) === 'futures' ? ' <span class="perp" title="Binance Futures (perpetual)">PERP</span>' : '');

  function fmtVol(v) {
    if (isNa(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  }
  function fmtPx(v) {
    if (isNa(v)) return '—';
    const d = v >= 1000 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 6 : 8;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
  }

  async function openPicker() {
    $('sym-modal').classList.remove('hidden');
    const inp = $('sym-search');
    inp.value = '';
    inp.focus();
    picker.sel = 0;
    renderPicker();
    if (!picker.list || Date.now() - picker.loadedAt > 60e3) {
      $('sym-info').textContent = 'Memuat daftar koin dari Binance…';
      await ensureSymbols(60e3);
      renderPicker();
      renderWatch(true);
    }
  }
  function closePicker() {
    $('sym-modal').classList.add('hidden');
  }

  function renderPicker() {
    const list = picker.list || [];
    // tombol filter mata uang quote (yang ada di data saja)
    const quotes = ['★', ...Data.QUOTES.filter((q) => list.some((x) => x.quote === q)), 'Semua'];
    if (!quotes.includes(picker.quote)) picker.quote = 'USDT';
    $('sym-quotes').innerHTML = quotes.map((q) => `<button data-q="${q}" class="${q === picker.quote ? 'active' : ''}">${q === '★' ? '★ Favorit' : q}</button>`).join('');
    const term = $('sym-search').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    let rows = list.filter((x) => {
      if (term) return x.symbol.includes(term) || x.base.startsWith(term);
      if (picker.quote === '★') return favs.has(x.symbol);
      return picker.quote === 'Semua' || x.quote === picker.quote;
    });
    if (term) {
      // saat mencari: pair USDT & kecocokan awal nama koin di atas
      rows.sort((a, b) => (b.base === term) - (a.base === term) || (b.base.startsWith(term)) - (a.base.startsWith(term))
        || (b.quote === 'USDT') - (a.quote === 'USDT') || (b.quoteVolume || 0) - (a.quoteVolume || 0));
    } else {
      rows.sort((a, b) => favs.has(b.symbol) - favs.has(a.symbol) || (b.quoteVolume || 0) - (a.quoteVolume || 0));
    }
    // simbol yang diketik persis tapi tidak ada di daftar (mis. Binance tidak terjangkau) tetap bisa dipilih
    if (term.length >= 5 && !rows.some((x) => x.symbol === term)) {
      const sp = Data.splitSymbol(term);
      rows.unshift({ symbol: term, base: sp.base, quote: sp.quote, price: NaN, change: NaN, quoteVolume: NaN, typed: true });
    }
    picker.rows = rows.slice(0, 400);
    picker.sel = Math.min(picker.sel, Math.max(0, picker.rows.length - 1));
    $('sym-list').innerHTML = picker.rows.map((x, k) => `
      <div class="sym-row ${k === picker.sel ? 'sel' : ''} ${x.symbol === settings.symbol ? 'cur' : ''}" data-k="${k}">
        <span class="star ${favs.has(x.symbol) ? 'on' : ''}" data-fav="${x.symbol}" title="Favorit">★</span>
        <span><b>${esc(x.base)}</b><span class="q">${x.quote ? '/' + esc(x.quote) : ''}</span>${perpTag(x)}${x.typed ? ' <span class="q">(ketik)</span>' : ''}</span>
        <span>${fmtPx(x.price)}</span>
        <span class="${sign(x.change)}">${isNa(x.change) ? '—' : (x.change > 0 ? '+' : '') + x.change.toFixed(2) + '%'}</span>
        <span class="muted">${fmtVol(x.quoteVolume)}</span>
      </div>`).join('') || '<div class="empty">Tidak ada koin yang cocok.</div>';
    const total = list.length;
    $('sym-info').textContent = !picker.list ? 'Memuat…'
      : picker.live ? `${total} pair aktif di Binance · urut volume 24 jam · ↑↓ Enter untuk memilih · ★ untuk favorit`
        : 'Binance tidak terjangkau — menampilkan koin populer. Ketik simbol lengkap (mis. ARBUSDT) lalu Enter.';
    const selEl = $('sym-list').querySelector('.sym-row.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  function chooseSymbol(sym) {
    closePicker();
    if (!sym) return;
    settings.symbol = sym;
    $('symbol-label').textContent = sym;
    renderWatch(true);
    loadBinance();
  }

  $('symbol-btn').onclick = openPicker;
  $('sym-close').onclick = closePicker;
  $('sym-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'sym-modal') closePicker(); });
  $('sym-search').addEventListener('input', () => { picker.sel = 0; renderPicker(); });
  $('sym-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePicker(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { picker.sel = Math.min(picker.rows.length - 1, picker.sel + 1); renderPicker(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { picker.sel = Math.max(0, picker.sel - 1); renderPicker(); e.preventDefault(); }
    else if (e.key === 'Enter') { const r = picker.rows[picker.sel]; chooseSymbol(r && r.symbol); }
  });
  $('sym-quotes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]');
    if (!b) return;
    picker.quote = b.dataset.q;
    store.set('pickerQuote', picker.quote);
    $('sym-search').value = '';
    picker.sel = 0;
    renderPicker();
    $('sym-search').focus();
  });
  $('sym-list').addEventListener('click', (e) => {
    const star = e.target.closest('[data-fav]');
    if (star) {
      const s = star.dataset.fav;
      if (favs.has(s)) favs.delete(s); else favs.add(s);
      store.set('favorites', [...favs]);
      renderPicker();
      renderWatch(true);
      startWatchStream();
      return;
    }
    const row = e.target.closest('.sym-row[data-k]');
    if (row) chooseSymbol(picker.rows[+row.dataset.k].symbol);
  });

  // ------------------------------------------------------------------
  // Watchlist: favorit + 100 koin USDT teratas (volume 24 jam), klik untuk membuka chart
  // ------------------------------------------------------------------
  const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'BUSD', 'EUR', 'AEUR', 'EURI', 'USDE', 'PYUSD', 'XUSD', 'BFUSD', 'USD1', 'RLUSD', 'UST', 'USTC', 'PAXG']);
  const watch = { stop: null, streamKey: '', lastRender: 0, timer: null, prev: new Map(), loading: false };

  async function ensureSymbols(maxAge) {
    if (picker.list && picker.live && Date.now() - picker.loadedAt < maxAge) return;
    const r = await Data.fetchSymbols();
    picker.list = r.list;
    picker.live = r.live;
    picker.loadedAt = r.live ? Date.now() : 0;
  }

  function watchData() {
    const all = picker.list || [];
    const bySym = new Map(all.map((x) => [x.symbol, x]));
    const top = all.filter((x) => x.quote === 'USDT' && x.market !== 'futures' && !STABLES.has(x.base))
      .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0)).slice(0, 100);
    const fav = [...favs].map((sym) => bySym.get(sym) || Object.assign({ symbol: sym, price: NaN, change: NaN, quoteVolume: NaN }, Data.splitSymbol(sym)));
    return { top, fav };
  }

  async function loadWatch(force) {
    if (watch.loading) return;
    watch.loading = true;
    $('watch-info').textContent = 'Memuat daftar koin…';
    try {
      await ensureSymbols(force ? 0 : 5 * 60e3);
    } finally {
      watch.loading = false;
    }
    renderWatch(true);
    startWatchStream();
  }

  // harga realtime hanya untuk koin yang tampil di watchlist
  function startWatchStream() {
    if (!picker.live) return;
    const { top, fav } = watchData();
    const syms = [...new Set([...fav.map((x) => x.symbol), ...top.map((x) => x.symbol)])].sort();
    const key = syms.join(',');
    if (key === watch.streamKey && watch.stop) return;
    if (watch.stop) watch.stop();
    watch.streamKey = key;
    const bySym = new Map((picker.list || []).map((x) => [x.symbol, x]));
    watch.stop = Data.subscribeTickers(syms, (t) => {
      const x = bySym.get(t.symbol);
      if (!x) return;
      x.price = t.price;
      x.change = t.open ? ((t.price - t.open) / t.open) * 100 : x.change;
      x.quoteVolume = t.quoteVolume;
      renderWatch(false);
    });
  }

  function watchVisible() {
    return document.querySelector('[data-pane="watch"]').classList.contains('active') && !document.hidden;
  }

  function renderWatch(force) {
    if (!force) {
      // update realtime dibatasi ±1x per detik dan hanya saat panel terlihat
      if (!watchVisible()) return;
      const wait = 1000 - (Date.now() - watch.lastRender);
      if (wait > 0) {
        if (!watch.timer) watch.timer = setTimeout(() => { watch.timer = null; renderWatch(false); }, wait);
        return;
      }
    }
    watch.lastRender = Date.now();
    const term = $('watch-search').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = (x) => !term || x.symbol.includes(term) || x.base.startsWith(term);
    const { top, fav } = watchData();
    const row = (x, rank) => {
      const before = watch.prev.get(x.symbol);
      const flash = isNa(before) || isNa(x.price) || before === x.price ? '' : x.price > before ? 'flash-up' : 'flash-down';
      watch.prev.set(x.symbol, x.price);
      return `<div class="watch-row ${x.symbol === settings.symbol ? 'cur' : ''}" data-sym="${esc(x.symbol)}" title="${esc(x.symbol)} — klik untuk membuka chart">
        <span class="star ${favs.has(x.symbol) ? 'on' : ''}" data-fav="${esc(x.symbol)}" title="Favorit">★</span>
        <span>${rank ? `<span class="rank">${rank}</span>` : ''}<b>${esc(x.base)}</b><span class="q">${x.quote && x.quote !== 'USDT' ? '/' + esc(x.quote) : ''}</span>${perpTag(x)}</span>
        <span class="${flash}">${fmtPx(x.price)}</span>
        <span><span class="chg ${sign(x.change)}">${isNa(x.change) ? '—' : (x.change > 0 ? '+' : '') + x.change.toFixed(2) + '%'}</span></span>
      </div>`;
    };
    const favRows = fav.filter(match);
    const topRows = top.map((x, k) => [x, k + 1]).filter(([x]) => match(x));
    let html = '';
    html += `<div class="watch-section">★ Favorit (${favRows.length})</div>`;
    html += favRows.length ? favRows.map((x) => row(x)).join('') : `<div class="empty" style="padding:10px">${term ? 'Tidak ada yang cocok.' : 'Klik ★ di daftar bawah untuk menambah favorit.'}</div>`;
    html += `<div class="watch-section">${picker.live ? 'Top 100 · volume 24 jam' : 'Koin populer'} (${topRows.length})</div>`;
    html += topRows.map(([x, k]) => row(x, picker.live ? k : null)).join('');
    if (!picker.live) html += (picker.list || []).filter((x) => !top.includes(x) && match(x)).map((x) => row(x)).join('');
    const box = $('watch-list');
    const scroll = box.scrollTop;
    box.innerHTML = html;
    box.scrollTop = scroll;
    $('watch-info').textContent = !picker.list ? 'Memuat…'
      : picker.live ? 'Harga realtime dari Binance · klik koin untuk membuka chart · ★ = favorit'
        : 'Binance tidak terjangkau — daftar koin populer tanpa harga. Klik ↻ untuk mencoba lagi.';
  }

  $('watch-list').addEventListener('click', (e) => {
    const star = e.target.closest('[data-fav]');
    if (star) {
      const sym = star.dataset.fav;
      if (favs.has(sym)) favs.delete(sym); else favs.add(sym);
      store.set('favorites', [...favs]);
      renderWatch(true);
      startWatchStream();
      return;
    }
    const r = e.target.closest('.watch-row[data-sym]');
    if (r && r.dataset.sym !== settings.symbol) chooseSymbol(r.dataset.sym);
  });
  $('watch-search').addEventListener('input', () => renderWatch(true));
  $('watch-refresh').onclick = () => loadWatch(true);
  document.querySelector('[data-tabs="side"] [data-tab="watch"]').addEventListener('click', () => renderWatch(true));
  setInterval(() => { if (watchVisible()) loadWatch(false); }, 5 * 60e3); // segarkan peringkat top 100

  // ------------------------------------------------------------------
  // Scanner sinyal (tab 📡 Sinyal): jalankan strategi di banyak koin, tampilkan titik entry
  // ------------------------------------------------------------------
  const Scanner = window.LunaScanner;
  const sig = Object.assign({ strat: 'ema', tf: '1h', universe: '30', online: false, notify: false }, store.get('scanner', {}));
  const scan = { running: false, timer: null, list: [], seen: new Set(store.get('scannerSeen', [])), newKeys: new Set(), unread: 0, nextAt: 0 };
  $('sig-strat').innerHTML = Object.entries(Scanner.ADAPTERS).map(([k, a]) => `<option value="${k}">${esc(a.label)}</option>`).join('');
  $('sig-strat').value = sig.strat;
  $('sig-tf').value = sig.tf;
  $('sig-universe').value = sig.universe;
  $('sig-online').checked = sig.online;
  $('sig-notify').checked = sig.notify;
  const saveSig = () => store.set('scanner', sig);
  const hhmm = (t) => new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  // pakai salinan script milik pengguna (beserta input yang diatur) bila ada, selain itu contoh bawaan
  function scanCode(key) {
    const ad = Scanner.ADAPTERS[key];
    const sc = S.scripts.find((x) => x.name === ad.scriptName);
    const ex = Examples.EXAMPLES.find((e) => e.key === ad.exampleKey);
    return sc ? { code: sc.code, inputs: sc.inputs || {} } : { code: ex.code, inputs: {} };
  }

  async function scanUniverse() {
    await ensureSymbols(10 * 60e3);
    const { top, fav } = watchData();
    const n = sig.universe === 'fav' ? 0 : +sig.universe;
    return [...new Set([...fav.map((x) => x.symbol), ...top.slice(0, n).map((x) => x.symbol)])];
  }

  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.4);
    } catch (e) { /* abaikan */ }
  }
  function notifyNew(list) {
    if (!sig.notify || !list.length) return;
    beep();
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const s0 = list[0];
    const title = list.length > 1 ? `${list.length} sinyal baru · ${sig.tf}` : `${s0.dir > 0 ? 'BUY' : 'SELL'} ${s0.symbol} · ${sig.tf}`;
    const body = list.slice(0, 4).map((x) => `${x.dir > 0 ? 'BUY' : 'SELL'} ${x.symbol} @ ${fmtPx(x.entry)} · SL ${fmtPx(x.sl)} · TP1 ${fmtPx(x.tp1)}`).join('\n');
    try { new Notification(title, { body, tag: 'luna-signal' }); } catch (e) { /* abaikan */ }
  }

  async function runScan() {
    if (scan.running || !Scanner) return;
    scan.running = true;
    $('sig-scan').disabled = true;
    const out = [];
    let done = 0, errs = 0, lastErr = '', syms = [];
    try {
      syms = await scanUniverse();
      if (!syms.length) throw new Error('Daftar koin kosong — tambahkan favorit (★) atau pilih Top N.');
      const { code, inputs } = scanCode(sig.strat);
      const tf = sig.tf, ms = Data.INTERVAL_MS[tf];
      let next = 0;
      const worker = async () => {
        while (next < syms.length) {
          const sym = syms[next++];
          try {
            const bars = Scanner.closedBars(await Data.fetchBinance(sym, tf, Scanner.ADAPTERS[sig.strat].bars || 600), ms);
            const s = Scanner.evaluate(sig.strat, code, bars, { tf, symbol: sym, inputs });
            if (s) out.push(s);
          } catch (e) { errs++; lastErr = `${sym}: ${e.message}`; }
          done++;
          $('sig-status').textContent = `Scan ${done}/${syms.length} koin…`;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // terbaru dulu; setup limit yang menunggu pullback di bawah entry yang sudah jalan
      const rank = { signal: 0, filled: 1, limit: 2 };
      out.sort((a, b) => a.age - b.age || rank[a.status] - rank[b.status] || b.rr3 - a.rr3);
      const fresh = out.filter((x) => !scan.seen.has(x.key));
      scan.newKeys = new Set(fresh.map((x) => x.key));
      for (const x of fresh) scan.seen.add(x.key);
      store.set('scannerSeen', [...scan.seen].slice(-500));
      scan.list = out;
      scan.at = Date.now();
      scan.meta = { n: syms.length, errs, lastErr };
      if (fresh.length) {
        notifyNew(fresh);
        if (!document.querySelector('[data-pane="signal"]').classList.contains('active')) {
          scan.unread += fresh.length;
          $('sig-badge').textContent = scan.unread;
          $('sig-badge').classList.remove('hidden');
        }
        log(`Scanner: ${fresh.length} sinyal baru (${fresh.map((x) => x.symbol).join(', ')})`);
      }
      if (errs) log(`Scanner: ${errs} koin gagal di-scan (${lastErr})`, errs === syms.length);
    } catch (e) {
      scan.meta = { n: syms.length, errs: 1, lastErr: e.message };
      scan.at = Date.now();
    } finally {
      scan.running = false;
      $('sig-scan').disabled = false;
      renderSignals();
    }
  }

  function renderSignals() {
    const m = scan.meta;
    let st = !scan.at ? 'Belum di-scan.' : `Scan ${hhmm(scan.at)} · ${m.n} koin · ${scan.list.length} sinyal`;
    if (m && m.errs) st += ` · ${m.errs} gagal (${m.lastErr})`;
    if (sig.online && scan.nextAt) st += ` · scan berikutnya ${hhmm(scan.nextAt)}`;
    else if (!sig.online) st += ' · Online mati';
    $('sig-status').textContent = st;
    const label = Scanner.ADAPTERS[sig.strat].label;
    const stateTxt = (s) => s.status === 'limit' ? 'limit di zona EMA · tunggu pullback' : s.status === 'signal' ? 'entry di open candle berikut' : 'sudah terisi';
    const rr = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
    const card = (s) => {
      const base = Data.splitSymbol(s.symbol).base || s.symbol;
      const dist = ((s.entry - s.price) / s.price) * 100;
      return `<div class="sig-card ${s.dir < 0 ? 'short' : ''} ${scan.newKeys.has(s.key) ? 'new' : ''}" data-sym="${esc(s.symbol)}" title="Klik untuk membuka chart ${esc(s.symbol)} ${esc(s.tf)}">
        <div class="sig-top"><b>${esc(base)}</b><span class="sig-dir">${s.dir > 0 ? 'BUY' : 'SELL'}</span><span class="sig-state">${stateTxt(s)}</span>
          <span class="sig-age">${s.age === 0 ? 'candle terakhir' : s.age + ' candle lalu'} · ${hhmm(s.signalTime)}</span></div>
        <div class="sig-grid">
          <span class="k">Entry</span><span>${fmtPx(s.entry)}</span><span class="r">${s.status === 'limit' ? (dist > 0 ? '+' : '') + dist.toFixed(2) + '% dari harga' : ''}</span>
          <span class="k">SL</span><span class="sl">${fmtPx(s.sl)}</span><span class="r">-1R</span>
          <span class="k">TP1</span><span class="tp">${fmtPx(s.tp1)}</span><span class="r">${rr(s.rr1)}</span>
          <span class="k">TP2</span><span class="tp">${fmtPx(s.tp2)}</span><span class="r">${rr(s.rr2)}</span>
          <span class="k">TP3</span><span class="tp">${fmtPx(s.tp3)}</span><span class="r">${rr(s.rr3)}</span>
        </div>
        <div class="sig-foot">Harga ${fmtPx(s.price)} · ${esc(s.tf)} · ${esc(label)}</div>
      </div>`;
    };
    $('sig-list').innerHTML = scan.list.length ? scan.list.map(card).join('')
      : `<div class="sig-empty">${scan.at ? 'Belum ada titik entry yang sesuai strategi saat ini.' : 'Klik <b>Scan sekarang</b>, atau nyalakan <b>Online</b> untuk scan otomatis setiap candle close.'}</div>`;
  }

  function scheduleScan() {
    clearTimeout(scan.timer);
    scan.timer = null;
    scan.nextAt = 0;
    if (sig.online) {
      const ms = Data.INTERVAL_MS[sig.tf];
      scan.nextAt = Math.ceil((Date.now() + 1000) / ms) * ms + 8000; // beberapa detik setelah candle close
      scan.timer = setTimeout(async () => { await runScan(); scheduleScan(); }, scan.nextAt - Date.now());
    }
    renderSignals();
  }
  // tab di background: setTimeout bisa tertunda → kejar saat tab aktif lagi
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sig.online && scan.nextAt && Date.now() > scan.nextAt + 60e3 && !scan.running) runScan().then(scheduleScan);
  });

  // buka chart dari kartu sinyal: koin + timeframe scanner, strategi ikut ditampilkan
  function openSignal(sym) {
    const ad = Scanner.ADAPTERS[sig.strat];
    let sc = S.scripts.find((x) => x.name === ad.scriptName);
    if (!sc) {
      const ex = Examples.EXAMPLES.find((e) => e.key === ad.exampleKey);
      sc = { id: uid(), name: ex.name, code: ex.code, enabled: true, inputs: {} };
      S.scripts.push(sc);
    }
    sc.enabled = true;
    S.selectedStrategy = sc.id;
    store.set('selectedStrategy', sc.id);
    saveScripts();
    renderScriptList();
    if (settings.tf !== sig.tf) {
      settings.tf = sig.tf;
      tfBox.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.textContent === sig.tf));
    }
    chooseSymbol(sym);
  }

  $('sig-list').addEventListener('click', (e) => {
    const c = e.target.closest('.sig-card[data-sym]');
    if (c) openSignal(c.dataset.sym);
  });
  $('sig-scan').onclick = () => runScan().then(scheduleScan);
  for (const [id, k] of [['sig-strat', 'strat'], ['sig-tf', 'tf'], ['sig-universe', 'universe']]) {
    $(id).onchange = () => { sig[k] = $(id).value; saveSig(); scan.list = []; scan.at = 0; scheduleScan(); if (sig.online) runScan().then(scheduleScan); };
  }
  $('sig-online').onchange = () => {
    sig.online = $('sig-online').checked;
    saveSig();
    if (sig.online) runScan().then(scheduleScan); else scheduleScan();
  };
  $('sig-notify').onchange = async () => {
    sig.notify = $('sig-notify').checked;
    saveSig();
    if (sig.notify) {
      beep(); // juga membuka izin audio browser
      if ('Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch (e) { /* abaikan */ }
      }
    }
  };
  document.querySelector('[data-tabs="side"] [data-tab="signal"]').addEventListener('click', () => {
    scan.unread = 0;
    $('sig-badge').classList.add('hidden');
  });
  renderSignals();
  if (sig.online) runScan().then(scheduleScan);

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (!$('sym-modal').classList.contains('hidden')) return;
    if (k === '/') { openPicker(); e.preventDefault(); return; }
    if (k === 'r') { R.active ? exitReplay() : enterReplay(); e.preventDefault(); return; }
    if (k === 'escape' && R.active) {
      if (R.picking && R.idx !== null) { R.picking = false; $('replay-hint').classList.add('hidden'); document.querySelector('.chart-wrap').classList.remove('picking'); applyData(R.idx); }
      else exitReplay();
      return;
    }
    if (!R.active || R.idx === null) return;
    if (k === ' ') { R.playing ? pauseReplay() : playReplay(); e.preventDefault(); }
    else if (k === 'arrowright') { pauseReplay(); stepReplay(1); e.preventDefault(); }
    else if (k === 'arrowleft') { pauseReplay(); stepReplay(-1); e.preventDefault(); }
    else if (k === 'b') paperOrder(1);
    else if (k === 's') paperOrder(-1);
    else if (k === 'c') $('pp-close').click();
  });

  // ------------------------------------------------------------------
  // Mulai
  // ------------------------------------------------------------------
  renderScriptList();
  renderGutter();
  $('btn-live').disabled = true;
  loadBinance();
  loadWatch(false);

  // untuk debugging dari console browser
  window.Luna = { S, chart, runAll, setBars };
})();
