/*
 * Luna — renderer objek gambar Pine (box / line / label) sebagai "series primitive"
 * Lightweight Charts, plus tabel (table.new) sebagai overlay HTML.
 * Keadaan objek diambil per bar (LunaPineExt.stateAt) sehingga Bar Replay akurat.
 */
(function (root) {
  'use strict';

  const Ext = root.LunaPineExt;
  const FONT = '-apple-system, "Segoe UI", Roboto, sans-serif';
  const TEXT_PX = { tiny: 9, small: 10, normal: 12, auto: 11, large: 15, huge: 20 };
  const isColor = (c) => typeof c === 'string' && c !== '';
  const dash = (style) => (style === 'dotted' ? [2, 3] : style === 'dashed' ? [6, 4] : []);

  function timeToIndex(bars, t) {
    let lo = 0, hi = bars.length - 1;
    if (!bars.length) return NaN;
    if (t >= bars[hi].time) return hi + (t - bars[hi].time) / Math.max(1, bars[hi].time - (bars[hi - 1] || bars[hi]).time || 1);
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (bars[m].time < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  class DrawingPrimitive {
    /**
     * @param {object} o  { items: {box:[], line:[], label:[]}, getEnd: () => idx, getBars: () => bars }
     */
    constructor(o) {
      this.o = o;
      const self = this;
      this._renderer = {
        drawBackground(target) { self._draw(target, true); },
        draw(target) { self._draw(target, false); },
      };
      this._view = { zOrder: () => 'normal', renderer: () => this._renderer };
    }
    attached(p) { this.chart = p.chart; this.series = p.series; }
    detached() { this.chart = null; this.series = null; }
    updateAllViews() {}
    paneViews() { return [this._view]; }

    _draw(target, background) {
      if (!this.chart || !this.series) return;
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const end = this.o.getEnd();
        const bars = this.o.getBars();
        const ts = this.chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        if (!range) return;
        const W = mediaSize.width;
        const xOf = (x, xloc) => {
          const li = xloc === 'bar_time' ? timeToIndex(bars, x) : x;
          if (typeof li !== 'number' || !isFinite(li)) return null;
          return ts.logicalToCoordinate(li);
        };
        const yOf = (p) => (typeof p === 'number' && isFinite(p) ? this.series.priceToCoordinate(p) : null);
        const outside = (a, b, ext) => ext === 'none' && (Math.max(a, b) < range.from - 2 || Math.min(a, b) > range.to + 2);
        ctx.save();
        if (background) {
          for (const o of this.o.items.box) {
            const p = Ext.stateAt(o, end);
            if (!p) continue;
            const l = p.xloc === 'bar_time' ? timeToIndex(bars, p.left) : p.left;
            const r = p.xloc === 'bar_time' ? timeToIndex(bars, p.right) : p.right;
            if (outside(l, r, p.extend)) continue;
            let x1 = xOf(p.left, p.xloc), x2 = xOf(p.right, p.xloc);
            const y1 = yOf(p.top), y2 = yOf(p.bottom);
            if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
            if (p.extend === 'right' || p.extend === 'both') x2 = W;
            if (p.extend === 'left' || p.extend === 'both') x1 = 0;
            const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
            if (isColor(p.bgcolor)) {
              ctx.fillStyle = p.bgcolor;
              ctx.fillRect(x, y, Math.max(1, w), Math.max(1, h));
            }
            if (isColor(p.border_color) && p.border_width > 0) {
              ctx.strokeStyle = p.border_color;
              ctx.lineWidth = p.border_width;
              ctx.setLineDash(dash(p.border_style));
              ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w), Math.max(1, h));
            }
          }
          ctx.restore();
          return;
        }
        // teks di dalam box
        for (const o of this.o.items.box) {
          const p = Ext.stateAt(o, end);
          if (!p || !p.text) continue;
          let x1 = xOf(p.left, p.xloc), x2 = xOf(p.right, p.xloc);
          const y1 = yOf(p.top), y2 = yOf(p.bottom);
          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
          if (p.extend === 'right' || p.extend === 'both') x2 = W;
          const px = TEXT_PX[p.text_size] || 11;
          ctx.font = `${px}px ${FONT}`;
          ctx.fillStyle = isColor(p.text_color) ? p.text_color : '#d1d4dc';
          const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2);
          ctx.textAlign = p.text_halign === 'left' ? 'left' : p.text_halign === 'right' ? 'right' : 'center';
          ctx.textBaseline = p.text_valign === 'top' ? 'top' : p.text_valign === 'bottom' ? 'bottom' : 'middle';
          const tx = p.text_halign === 'left' ? xa + 4 : p.text_halign === 'right' ? xb - 4 : (xa + xb) / 2;
          const ty = p.text_valign === 'top' ? ya + 3 : p.text_valign === 'bottom' ? yb - 3 : (ya + yb) / 2;
          ctx.fillText(String(p.text), tx, ty);
        }
        // garis
        for (const o of this.o.items.line) {
          const p = Ext.stateAt(o, end);
          if (!p || !isColor(p.color)) continue;
          const a = p.xloc === 'bar_time' ? timeToIndex(bars, p.x1) : p.x1;
          const b = p.xloc === 'bar_time' ? timeToIndex(bars, p.x2) : p.x2;
          if (outside(a, b, p.extend)) continue;
          let x1 = xOf(p.x1, p.xloc), x2 = xOf(p.x2, p.xloc), y1 = yOf(p.y1), y2 = yOf(p.y2);
          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
          if (p.extend !== 'none' && x1 !== x2) {
            const k = (y2 - y1) / (x2 - x1);
            const left = x1 < x2;
            if (p.extend === 'right' || p.extend === 'both') {
              if (left) { y2 = y2 + k * (W - x2); x2 = W; } else { y1 = y1 + k * (W - x1); x1 = W; }
            }
            if (p.extend === 'left' || p.extend === 'both') {
              if (left) { y1 = y1 - k * x1; x1 = 0; } else { y2 = y2 - k * x2; x2 = 0; }
            }
          }
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width || 1;
          ctx.setLineDash(dash(p.style));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          const arrow = (xa, ya, xb, yb) => {
            const ang = Math.atan2(yb - ya, xb - xa);
            const s = 6 + (p.width || 1) * 2;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.moveTo(xb, yb);
            ctx.lineTo(xb - s * Math.cos(ang - 0.45), yb - s * Math.sin(ang - 0.45));
            ctx.lineTo(xb - s * Math.cos(ang + 0.45), yb - s * Math.sin(ang + 0.45));
            ctx.closePath();
            ctx.fill();
          };
          if (p.style === 'arrow_right' || p.style === 'arrow_both') arrow(x1, y1, x2, y2);
          if (p.style === 'arrow_left' || p.style === 'arrow_both') arrow(x2, y2, x1, y1);
        }
        // label
        for (const o of this.o.items.label) {
          const p = Ext.stateAt(o, end);
          if (!p) continue;
          const xi = p.xloc === 'bar_time' ? timeToIndex(bars, p.x) : p.x;
          if (!(xi >= range.from - 2 && xi <= range.to + 2)) continue;
          const x = xOf(p.x, p.xloc);
          let price = p.y;
          const bi = Math.round(xi);
          let style = p.style;
          if (p.yloc === 'abovebar' && bars[bi]) { price = bars[bi].high; if (style === 'label_up') style = 'label_down'; }
          if (p.yloc === 'belowbar' && bars[bi]) { price = bars[bi].low; if (style === 'label_down') style = 'label_up'; }
          let y = yOf(price);
          if (x === null || y === null) continue;
          if (p.yloc === 'abovebar') y -= 4;
          if (p.yloc === 'belowbar') y += 4;
          drawLabel(ctx, x, y, p, style);
        }
        ctx.restore();
      });
    }
  }

  function drawLabel(ctx, x, y, p, style) {
    const px = TEXT_PX[p.size] || 12;
    ctx.font = `${px}px ${FONT}`;
    const lines = String(p.text || '').split('\n');
    const tw = lines.length && lines[0] !== '' ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0;
    const lh = px * 1.25;
    const pad = 4;
    const w = tw + pad * 2;
    const h = (lines[0] === '' ? 0 : lines.length * lh) + pad * 2;
    const bg = isColor(p.color) ? p.color : null;
    const tc = isColor(p.textcolor) ? p.textcolor : '#ffffff';
    const shape = (s) => {
      const r = 4 + px / 3;
      if (!bg) return;
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (s === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
      else if (s === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
      else if (s === 'triangleup') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); }
      else { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y - r); }
      ctx.fill();
      return r;
    };
    let bx, by;
    const ptr = 5;
    if (style === 'circle' || style === 'square' || style === 'triangleup' || style === 'triangledown') {
      const r = shape(style) || 4;
      bx = x - w / 2; by = style === 'triangleup' ? y + r + 2 : y - r - 2 - h;
      if (lines[0] !== '') textBlock(ctx, lines, bx, by, w, lh, pad, tc, null, p.textalign);
      return;
    }
    if (style === 'label_down') { bx = x - w / 2; by = y - ptr - h; }
    else if (style === 'label_up') { bx = x - w / 2; by = y + ptr; }
    else if (style === 'label_left') { bx = x + ptr; by = y - h / 2; }
    else if (style === 'label_right') { bx = x - ptr - w; by = y - h / 2; }
    else { bx = x - w / 2; by = y - h / 2; }
    if (bg && style !== 'none') {
      ctx.fillStyle = bg;
      roundRect(ctx, bx, by, w, h, 3);
      ctx.fill();
      ctx.beginPath();
      if (style === 'label_down') { ctx.moveTo(x - ptr, by + h); ctx.lineTo(x + ptr, by + h); ctx.lineTo(x, y); }
      else if (style === 'label_up') { ctx.moveTo(x - ptr, by); ctx.lineTo(x + ptr, by); ctx.lineTo(x, y); }
      else if (style === 'label_left') { ctx.moveTo(bx, y - ptr); ctx.lineTo(bx, y + ptr); ctx.lineTo(x, y); }
      else if (style === 'label_right') { ctx.moveTo(bx + w, y - ptr); ctx.lineTo(bx + w, y + ptr); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fill();
    }
    if (lines[0] !== '') textBlock(ctx, lines, bx, by, w, lh, pad, style === 'none' && !isColor(p.textcolor) && bg ? bg : tc, null, p.textalign);
  }

  function textBlock(ctx, lines, bx, by, w, lh, pad, color, bg, align) {
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
    const tx = align === 'left' ? bx + pad : align === 'right' ? bx + w - pad : bx + w / 2;
    lines.forEach((l, k) => ctx.fillText(l, tx, by + pad + k * lh + 1));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Render semua tabel (table.new) ke kontainer HTML `host` sesuai keadaan pada bar `end`. */
  function renderTables(host, tables, end) {
    const slots = {};
    host.innerHTML = '';
    for (const t of tables) {
      const p = Ext.stateAt(t, end);
      if (!p) continue;
      const cols = p.columns || 1, rows = p.rows || 1;
      let html = '';
      let any = false;
      for (let r = 0; r < rows; r++) {
        let tr = '';
        let rowAny = false;
        for (let c = 0; c < cols; c++) {
          const cell = p[`cell:${c}:${r}`];
          if (cell) { rowAny = true; any = true; }
          const st = cell ? `color:${isColor(cell.text_color) ? cell.text_color : '#d1d4dc'};${isColor(cell.bgcolor) ? 'background:' + cell.bgcolor + ';' : ''}text-align:${cell.text_halign === 'left' ? 'left' : cell.text_halign === 'right' ? 'right' : 'center'};font-size:${TEXT_PX[cell.text_size] || 12}px` : '';
          tr += `<td style="${st}">${cell ? esc(cell.text) : ''}</td>`;
        }
        if (rowAny) html += `<tr>${tr}</tr>`;
      }
      if (!any) continue;
      const pos = p.position || 'top_right';
      if (!slots[pos]) {
        slots[pos] = document.createElement('div');
        slots[pos].className = 'pine-tables pos-' + pos.replace('_', '-');
        host.appendChild(slots[pos]);
      }
      const tb = document.createElement('table');
      tb.className = 'pine-table';
      if (isColor(p.bgcolor)) tb.style.background = p.bgcolor;
      if (isColor(p.border_color)) tb.style.setProperty('--tb', p.border_color);
      tb.innerHTML = html;
      slots[pos].appendChild(tb);
    }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n/g, '<br>');

  const api = { DrawingPrimitive, renderTables };
  root.LunaDrawLayer = api;
})(typeof window !== 'undefined' ? window : globalThis);
