/*
 * Luna — alat gambar manual seperti TradingView: garis tren, garis horizontal,
 * Fibonacci retracement, range harga & tanggal (ukur), kotak, posisi long/short.
 * Titik disimpan sebagai {t: waktu ms, p: harga} per simbol (localStorage), jadi tetap
 * di tempat yang benar saat timeframe diganti.
 */
(function (root) {
  'use strict';

  const FIB = [
    [0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'],
    [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff'],
  ];
  const TOOLS = [
    ['cursor', '↖', 'Pilih / hapus gambar (klik gambar lalu tekan Delete)', 0],
    ['trend', '／', 'Garis tren (2 klik)', 2],
    ['hline', '―', 'Garis horizontal (1 klik)', 1],
    ['fib', '𝐅', 'Fibonacci retracement (2 klik: dari swing awal ke swing akhir)', 2],
    ['measure', '↕', 'Range harga & tanggal: Δ harga, Δ %, jumlah candle, durasi (2 klik)', 2],
    ['rect', '▭', 'Kotak / zona (2 klik)', 2],
    ['position', '⚖', 'Posisi long/short (3 klik: entry → SL → TP)', 3],
  ];
  const NPTS = Object.fromEntries(TOOLS.map((t) => [t[0], t[3]]));

  function fmtNum(v) {
    const a = Math.abs(v);
    const d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
  }
  function fmtDur(ms) {
    const m = Math.round(Math.abs(ms) / 60000);
    if (m < 60) return m + ' mnt';
    const h = Math.floor(m / 60);
    if (h < 48) return h + ' jam' + (m % 60 ? ' ' + (m % 60) + ' mnt' : '');
    const d = Math.floor(h / 24);
    return d + ' hari' + (h % 24 ? ' ' + (h % 24) + ' jam' : '');
  }
  const pct = (a, b) => ((b - a) / a) * 100;
  const sgn = (v) => (v >= 0 ? '+' : '');

  let curW = Infinity; // lebar area gambar saat ini (agar label tidak keluar ke skala harga)
  function attach(o) {
    const { chart, series, getBars, store, symbol, isBusy, status } = o;
    const ts = chart.timeScale();
    const host = o.host;
    let all = store.get('userDrawings', {});
    let tool = 'cursor', pending = null, hover = null, selected = null, magnet = store.get('drawMagnet', true);
    let requestUpdate = () => {};

    const list = () => all[symbol()] || (all[symbol()] = []);
    const save = () => store.set('userDrawings', all);
    const uid = () => Math.random().toString(36).slice(2, 9);

    // waktu ↔ indeks logis (interpolasi; di luar data diekstrapolasi dengan jarak candle terakhir)
    function step(b) { return b.length > 1 ? b[b.length - 1].time - b[b.length - 2].time : 60000; }
    function tToL(t) {
      const b = getBars(); if (!b.length) return NaN;
      const n = b.length;
      if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / step(b);
      if (t <= b[0].time) return (t - b[0].time) / (b.length > 1 ? b[1].time - b[0].time : step(b));
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
      return lo + (t - b[lo].time) / Math.max(1, b[hi].time - b[lo].time);
    }
    function lToT(l) {
      const b = getBars(); if (!b.length) return NaN;
      const n = b.length;
      if (l >= n - 1) return b[n - 1].time + (l - (n - 1)) * step(b);
      if (l <= 0) return b[0].time + l * (n > 1 ? b[1].time - b[0].time : step(b));
      const i = Math.floor(l), f = l - i;
      return b[i].time + f * (b[i + 1].time - b[i].time);
    }
    const X = (pt) => ts.logicalToCoordinate(tToL(pt.t));
    const Y = (pt) => series.priceToCoordinate(pt.p);

    // titik dari posisi mouse; magnet = menempel ke OHLC candle terdekat (≤ 10 px)
    function pointFrom(param) {
      if (!param || !param.point || param.logical === undefined || param.logical === null) return null;
      const b = getBars();
      let l = param.logical, p = series.coordinateToPrice(param.point.y);
      if (p === null || p === undefined) return null;
      if (magnet && b.length) {
        const i = Math.max(0, Math.min(b.length - 1, Math.round(l)));
        let best = null;
        for (const v of [b[i].open, b[i].high, b[i].low, b[i].close]) {
          const dy = Math.abs(series.priceToCoordinate(v) - param.point.y);
          if (dy <= 10 && (!best || dy < best.dy)) best = { dy, v };
        }
        if (best) { p = best.v; l = i; }
        else if (l >= 0 && l <= b.length - 1) l = Math.round(l);
      }
      return { t: lToT(l), p };
    }

    // ── gambar ──
    function pill(ctx, x, y, text, bg, align) {
      ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
      const w = ctx.measureText(text).width + 10, h = 17;
      let x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      if (x0 + w > curW - 2) x0 = Math.max(2, curW - 2 - w);
      if (x0 < 2) x0 = 2;
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, y - h / 2, w, h, 3); else ctx.rect(x0, y - h / 2, w, h);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x0 + 5, y + 0.5);
    }
    function line(ctx, x1, y1, x2, y2, color, width, dash) {
      ctx.strokeStyle = color; ctx.lineWidth = width || 1.5; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    }
    function drawOne(ctx, d, W, sel) {
      const P = d.pts.map((pt) => ({ x: X(pt), y: Y(pt), pt }));
      if (P.some((q) => q.x === null || q.y === null || !isFinite(q.x) || !isFinite(q.y))) {
        if (d.type !== 'hline' || P[0].y === null) return;
      }
      const hl = sel ? 2.5 : 1.5;
      // pratinjau: titik pertama sudah diklik, mouse belum memberi titik berikutnya
      if (d.type !== 'hline' && d.type !== 'position' && P.length < 2) {
        if (P[0] && P[0].x !== null && P[0].y !== null) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(P[0].x, P[0].y, 3, 0, 7); ctx.fill(); }
        return;
      }
      if (d.type === 'hline') {
        line(ctx, 0, P[0].y, W, P[0].y, d.color || '#f7c948', hl, [6, 4]);
        pill(ctx, W - 4, P[0].y, fmtNum(d.pts[0].p), d.color || '#b38f00', 'right');
      } else if (d.type === 'trend') {
        const [a, b] = P;
        line(ctx, a.x, a.y, b.x, b.y, d.color || '#2962ff', hl);
        for (const q of P) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q.x, q.y, sel ? 4 : 2.5, 0, 7); ctx.fill(); }
        if (P.length === 2) pill(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, `${sgn(pct(a.pt.p, b.pt.p))}${pct(a.pt.p, b.pt.p).toFixed(2)}%`, 'rgba(41,98,255,.85)', 'center');
      } else if (d.type === 'rect') {
        const [a, b] = P;
        ctx.fillStyle = 'rgba(41,98,255,0.12)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = sel ? '#fff' : 'rgba(41,98,255,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        const top = Math.max(a.pt.p, b.pt.p), bot = Math.min(a.pt.p, b.pt.p);
        pill(ctx, Math.max(a.x, b.x) + 4, Math.min(a.y, b.y) + 9, `${fmtNum(top)} – ${fmtNum(bot)} · ${((top / bot - 1) * 100).toFixed(2)}%`, 'rgba(41,98,255,.85)', 'left');
      } else if (d.type === 'fib') {
        const [a, b] = P;
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x, x1 + 40);
        const pA = a.pt.p, pB = b.pt.p;
        let prevY = null, prevC = null;
        for (const [lv, c] of FIB) {
          const price = pB - (pB - pA) * lv, y = series.priceToCoordinate(price);
          if (y === null) continue;
          if (prevY !== null) { ctx.fillStyle = prevC + '1f'; ctx.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY)); }
          line(ctx, x1, y, x2, y, c, sel ? 2 : 1);
          ctx.font = '10px -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = c; ctx.textBaseline = 'bottom';
          const txt = `${lv} (${fmtNum(price)})`;
          ctx.fillText(txt, Math.max(2, x1 - ctx.measureText(txt).width - 4), y + 5);
          prevY = y; prevC = c;
        }
        line(ctx, a.x, a.y, b.x, b.y, 'rgba(178,181,190,.6)', 1, [4, 4]);
      } else if (d.type === 'measure') {
        const [a, b] = P;
        const up = b.pt.p >= a.pt.p, col = up ? 'rgba(41,98,255,' : 'rgba(242,54,69,';
        ctx.fillStyle = col + '0.15)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        line(ctx, (a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, col + '0.9)', 1);
        line(ctx, a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, col + '0.9)', 1);
        const dp = b.pt.p - a.pt.p, bars = Math.round(tToL(b.pt.t) - tToL(a.pt.t));
        const txt1 = `${sgn(dp)}${fmtNum(dp)} (${sgn(dp)}${pct(a.pt.p, b.pt.p).toFixed(2)}%)`;
        const txt2 = `${Math.abs(bars)} candle · ${fmtDur(b.pt.t - a.pt.t)}`;
        const ly = up ? Math.min(a.y, b.y) - 22 : Math.max(a.y, b.y) + 22;
        pill(ctx, (a.x + b.x) / 2, ly - 9, txt1, col + '0.92)', 'center');
        pill(ctx, (a.x + b.x) / 2, ly + 9, txt2, col + '0.92)', 'center');
      } else if (d.type === 'position') {
        const [a, s, tp] = P;
        if (!s) { line(ctx, a.x - 20, a.y, a.x + 60, a.y, '#2962ff', 1.5); return; }
        const long = s.pt.p < a.pt.p;
        const xr = Math.max(a.x + 60, ...(P.map((q) => q.x)));
        const e = a.pt.p, slp = s.pt.p, risk = Math.abs(e - slp);
        ctx.fillStyle = 'rgba(242,54,69,0.18)'; ctx.fillRect(a.x, Math.min(a.y, s.y), xr - a.x, Math.abs(s.y - a.y));
        if (tp) { ctx.fillStyle = 'rgba(8,153,129,0.18)'; ctx.fillRect(a.x, Math.min(a.y, tp.y), xr - a.x, Math.abs(tp.y - a.y)); }
        line(ctx, a.x, a.y, xr, a.y, '#b2b5be', sel ? 2 : 1);
        const slPct = Math.abs(pct(e, slp));
        pill(ctx, xr + 4, s.y, `SL ${fmtNum(slp)} (−${slPct.toFixed(2)}%)`, 'rgba(242,54,69,.9)', 'left');
        pill(ctx, xr + 4, a.y, `${long ? 'LONG' : 'SHORT'} ${fmtNum(e)}`, 'rgba(120,123,134,.9)', 'left');
        if (tp) {
          const rr = risk > 0 ? Math.abs(tp.pt.p - e) / risk : 0;
          pill(ctx, xr + 4, tp.y, `TP ${fmtNum(tp.pt.p)} (+${Math.abs(pct(e, tp.pt.p)).toFixed(2)}%) · R:R ${rr.toFixed(2)}`, 'rgba(8,153,129,.9)', 'left');
        }
      }
    }
    const primitive = {
      attached(p) { requestUpdate = p.requestUpdate || requestUpdate; },
      detached() {},
      updateAllViews() {},
      paneViews() {
        return [{
          zOrder: () => 'top',
          renderer: () => ({
            draw(target) {
              target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
                curW = mediaSize.width;
                for (const d of list()) drawOne(ctx, d, mediaSize.width, d.id === selected);
                if (pending) {
                  const pts = hover ? pending.pts.concat([hover]) : pending.pts;
                  if (pts.length) drawOne(ctx, { type: pending.type, pts }, mediaSize.width, true);
                }
              });
            },
          }),
        }];
      },
    };
    series.attachPrimitive(primitive);
    const redraw = () => { requestUpdate(); };

    // ── pilih: jarak titik ke gambar (px) ──
    function distSeg(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
      return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
    }
    function hit(x, y) {
      let best = null;
      for (const d of list()) {
        const P = d.pts.map((pt) => ({ x: X(pt), y: Y(pt) }));
        let dist = Infinity;
        if (d.type === 'hline') dist = P[0].y === null ? Infinity : Math.abs(y - P[0].y);
        else if (P.some((q) => q.x === null || q.y === null)) continue;
        else if (d.type === 'trend') dist = distSeg(x, y, P[0].x, P[0].y, P[1].x, P[1].y);
        else {
          const xs = P.map((q) => q.x), ys = P.map((q) => q.y);
          let x1 = Math.min(...xs), x2 = Math.max(...xs);
          if (d.type === 'position') x2 = Math.max(x2, P[0].x + 60);
          if (d.type === 'fib') {
            dist = Math.min(...FIB.map(([lv]) => { const yy = series.priceToCoordinate(d.pts[1].p - (d.pts[1].p - d.pts[0].p) * lv); return yy === null ? Infinity : distSeg(x, y, x1, yy, Math.max(x2, x1 + 40), yy); }));
          } else {
            const y1 = Math.min(...ys), y2 = Math.max(...ys);
            dist = x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4 ? 0 : Infinity;
          }
        }
        if (dist <= 6 && (!best || dist < best.dist)) best = { d, dist };
      }
      return best && best.d;
    }

    // ── toolbar ──
    const bar = document.createElement('div');
    bar.className = 'draw-toolbar';
    bar.innerHTML = TOOLS.map(([k, ic, tip]) => `<button data-tool="${k}" title="${tip}">${ic}</button>`).join('')
      + `<span class="sep"></span><button data-act="magnet" title="Magnet: titik menempel ke open/high/low/close candle">🧲</button>`
      + `<button data-act="clear" title="Hapus semua gambar di koin ini">🗑</button>`;
    host.appendChild(bar);
    function syncBar() {
      bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
      bar.querySelector('[data-act="magnet"]').classList.toggle('active', magnet);
      host.classList.toggle('drawing', tool !== 'cursor');
    }
    function setTool(t) {
      tool = t; pending = null; hover = null;
      if (t !== 'cursor') { selected = null; status(`Gambar ${TOOLS.find((x) => x[0] === t)[2]} — klik di chart · Esc batal`); }
      syncBar(); redraw();
    }
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool === tool && tool !== 'cursor' ? 'cursor' : b.dataset.tool);
      else if (b.dataset.act === 'magnet') { magnet = !magnet; store.set('drawMagnet', magnet); syncBar(); }
      else if (b.dataset.act === 'clear') {
        if (list().length && confirm(`Hapus semua ${list().length} gambar di ${symbol()}?`)) { all[symbol()] = []; selected = null; save(); redraw(); }
      }
    });
    syncBar();

    // ── interaksi chart ──
    // klik kedua yang cepat dikirim library sebagai double-click → diperlakukan sebagai klik juga
    const onClick = (param) => {
      if (isBusy && isBusy()) return;
      if (tool === 'cursor') {
        if (!param.point) return;
        const d = hit(param.point.x, param.point.y);
        selected = d ? d.id : null;
        if (d) status('Gambar dipilih — tekan Delete untuk menghapus, Esc untuk batal');
        redraw();
        return;
      }
      const pt = pointFrom(param); if (!pt) return;
      if (!pending) pending = { type: tool, pts: [] };
      pending.pts.push(pt);
      if (pending.pts.length >= NPTS[tool]) {
        list().push({ id: uid(), type: tool, pts: pending.pts });
        save();
        pending = null; hover = null;
        status('Gambar tersimpan (per koin). Pilih ↖ lalu klik gambar untuk menghapus.');
      } else status(tool === 'position' ? (pending.pts.length === 1 ? 'Klik harga Stop Loss' : 'Klik harga Take Profit') : 'Klik titik berikutnya');
      redraw();
    };
    // event mouse langsung dari elemen chart (klik cepat tidak tertelan sebagai double-click)
    const el = o.chartEl;
    const paramAt = (ev) => {
      const r = el.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (x < 0 || y < 0 || x > ts.width() || y > r.height) return null;
      return { point: { x, y }, logical: ts.coordinateToLogical(x) };
    };
    let down = null;
    el.addEventListener('pointerdown', (ev) => { if (ev.button === 0) down = { x: ev.clientX, y: ev.clientY }; }, true);
    el.addEventListener('pointerup', (ev) => {
      if (!down || ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 5) return; // geser chart, bukan klik
      const param = paramAt(ev);
      if (param) onClick(param);
    }, true);
    el.addEventListener('pointermove', (ev) => {
      if (!pending) return;
      const param = paramAt(ev);
      hover = param ? pointFrom(param) : null;
      redraw();
    });
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Escape' && (pending || tool !== 'cursor' || selected)) { selected = null; setTool('cursor'); e.stopImmediatePropagation(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        all[symbol()] = list().filter((d) => d.id !== selected); selected = null; save(); redraw(); e.preventDefault();
      }
    }, true);

    return {
      refresh: () => { all = store.get('userDrawings', {}); selected = null; pending = null; redraw(); },
      redraw,
      setTool,
      count: () => list().length,
    };
  }

  const api = { attach, TOOLS, FIB };
  root.LunaUserDraw = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
