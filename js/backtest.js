/*
 * Luna — mesin backtest (setara `strategy.*` di Pine Script).
 *
 * Aturan eksekusi (mengikuti default TradingView):
 *  - Order market yang dibuat di bar N diisi di harga OPEN bar N+1
 *    (atau di CLOSE bar N jika process_orders_on_close = true).
 *  - Order stop/limit dicek di dalam bar memakai jalur harga
 *    open -> high/low (yang lebih dekat dulu) -> low/high -> close.
 *  - Satu posisi bersih (net). Entry arah berlawanan = reversal.
 */
(function (root) {
  'use strict';

  const isNa = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));
  const num = (v, d) => (isNa(v) ? d : Number(v));

  class Broker {
    constructor(bars) {
      this.bars = bars;
      this.cfg = {
        initial_capital: 10000,
        default_qty_type: 'fixed',
        default_qty_value: 1,
        commission_type: 'percent',
        commission_value: 0,
        pyramiding: 1,
        slippage: 0,
        process_orders_on_close: false,
        mintick: 0.01,
      };
      this.entries = []; // posisi terbuka: {id, dir, qty, price, bar, time, comm}
      this.trades = []; // trade tertutup
      this.pending = []; // order entry/close yang menunggu
      this.exits = new Map(); // strategy.exit aktif
      this.realized = 0;
      this.commissionPaid = 0;
      this.equity = [];
      this.i = 0;
      this.lastPrice = NaN;
    }

    configure(opts) {
      for (const k of Object.keys(opts)) if (!isNa(opts[k])) this.cfg[k] = opts[k];
      if (this.cfg.pyramiding < 1) this.cfg.pyramiding = 1;
    }

    // ---------- status posisi ----------
    get positionSize() {
      let s = 0;
      for (const e of this.entries) s += e.dir * e.qty;
      return s;
    }
    get avgPrice() {
      let q = 0, v = 0;
      for (const e of this.entries) { q += e.qty; v += e.qty * e.price; }
      return q ? v / q : NaN;
    }
    openProfit(price) {
      if (isNa(price)) price = this.lastPrice;
      let p = 0;
      for (const e of this.entries) p += e.dir * (price - e.price) * e.qty;
      return p;
    }
    equityAt(price) {
      return this.cfg.initial_capital + this.realized + this.openProfit(price);
    }

    commission(qty, price) {
      const c = this.cfg;
      if (c.commission_type === 'cash_per_contract') return c.commission_value * qty;
      if (c.commission_type === 'cash_per_order') return c.commission_value;
      return (c.commission_value / 100) * qty * price;
    }

    calcQty(price, qty) {
      if (!isNa(qty)) return qty;
      const c = this.cfg;
      if (c.default_qty_type === 'percent_of_equity') return (this.equityAt(price) * c.default_qty_value) / 100 / price;
      if (c.default_qty_type === 'cash') return c.default_qty_value / price;
      return c.default_qty_value;
    }

    // ---------- API untuk script ----------
    entry(id, direction, qty, limit, stop, comment) {
      const dir = direction === 'short' ? -1 : 1;
      this.pending = this.pending.filter((o) => !(o.kind === 'entry' && o.id === id));
      this.pending.push({
        kind: 'entry', id: String(id), dir, qty: isNa(qty) ? NaN : qty,
        limit: num(limit, NaN), stop: num(stop, NaN), comment, bar: this.i,
      });
    }
    order(id, direction, qty, limit, stop, comment) {
      this.entry(id, direction, qty, limit, stop, comment);
    }
    close(id, comment, qty, qtyPercent, immediately) {
      const o = { kind: 'close', id: String(id), comment, qtyPercent: num(qtyPercent, 100), qty: num(qty, NaN), bar: this.i };
      if (immediately) this.fillClose(o, this.bars[this.i].close, this.i);
      else if (!this.pending.some((p) => p.kind === 'close' && p.id === o.id)) this.pending.push(o);
    }
    closeAll(comment, immediately) {
      const o = { kind: 'close', id: null, comment, qtyPercent: 100, qty: NaN, bar: this.i };
      if (immediately) this.fillClose(o, this.bars[this.i].close, this.i);
      else if (!this.pending.some((p) => p.kind === 'close' && p.id === null)) this.pending.push(o);
    }
    exit(id, fromEntry, qty, qtyPercent, profit, limit, loss, stop, comment) {
      const prev = this.exits.get(String(id));
      this.exits.set(String(id), {
        id: String(id), from: fromEntry === undefined || fromEntry === null ? '' : String(fromEntry),
        profit: num(profit, NaN), limit: num(limit, NaN), loss: num(loss, NaN), stop: num(stop, NaN),
        comment, armed: prev ? prev.armed : false,
      });
    }
    cancel(id) {
      this.pending = this.pending.filter((o) => o.id !== String(id));
      this.exits.delete(String(id));
    }
    cancelAll() {
      this.pending = [];
      this.exits.clear();
    }

    // ---------- eksekusi ----------
    slip(price, side) {
      return price + side * this.cfg.slippage * this.cfg.mintick;
    }

    openEntry(o, price, i) {
      const posDir = Math.sign(this.positionSize);
      // reversal: tutup posisi berlawanan dulu
      if (posDir !== 0 && posDir !== o.dir) this.closeEntries(this.entries.slice(), price, i, o.id, 'reverse');
      const same = this.entries.filter((e) => e.dir === o.dir).length;
      if (same >= this.cfg.pyramiding) return false;
      const qty = this.calcQty(price, o.qty);
      if (!(qty > 0)) return false;
      const comm = this.commission(qty, price);
      this.commissionPaid += comm;
      this.realized -= comm;
      this.entries.push({ id: o.id, dir: o.dir, qty, price, bar: i, time: this.bars[i].time, comm, comment: o.comment });
      return true;
    }

    closeEntries(list, price, i, exitId, comment, fraction) {
      for (const e of list) {
        const f = fraction === undefined ? 1 : fraction;
        const qty = e.qty * f;
        const comm = this.commission(qty, price);
        const entryComm = e.comm * f;
        const gross = e.dir * (price - e.price) * qty;
        this.realized += gross - comm;
        this.commissionPaid += comm;
        this.trades.push({
          entryId: e.id, exitId: exitId || e.id, dir: e.dir, qty,
          entryPrice: e.price, exitPrice: price, entryBar: e.bar, exitBar: i,
          entryTime: e.time, exitTime: this.bars[i].time,
          pnl: gross - comm - entryComm, pnlPct: ((e.dir * (price - e.price)) / e.price) * 100,
          commission: comm + entryComm, comment,
        });
        if (f >= 1) this.entries.splice(this.entries.indexOf(e), 1);
        else { e.qty -= qty; e.comm -= entryComm; }
      }
      this.cleanupExits();
    }

    fillClose(o, price, i) {
      const list = this.entries.filter((e) => o.id === null || e.id === o.id);
      if (!list.length) return;
      const side = -Math.sign(this.positionSize);
      this.closeEntries(list, this.slip(price, side), i, o.id === null ? 'Close all' : 'Close ' + o.id, o.comment, Math.min(1, o.qtyPercent / 100));
    }

    cleanupExits() {
      for (const [k, x] of this.exits) {
        const has = this.entries.some((e) => !x.from || e.id === x.from);
        if (x.armed && !has) this.exits.delete(k);
      }
    }

    // harga di mana level `p` pertama kali tersentuh di jalur bar, atau null
    static hitTime(path, p) {
      for (let k = 0; k < path.length - 1; k++) {
        const a = path[k], b = path[k + 1];
        if ((p >= Math.min(a, b)) && (p <= Math.max(a, b))) return k + (a === b ? 0 : Math.abs(p - a) / Math.abs(b - a));
      }
      return null;
    }

    // Dipanggil sebelum script berjalan di bar i.
    onBarOpen(i) {
      this.i = i;
      const bar = this.bars[i];
      // 1) order market dari bar sebelumnya diisi di open
      if (!this.cfg.process_orders_on_close) this.fillMarket(i, bar.open);
      // 2) order stop/limit di dalam bar
      this.processIntrabar(i, bar);
    }

    fillMarket(i, price) {
      const keep = [];
      for (const o of this.pending) {
        if (o.bar >= i && !this.cfg.process_orders_on_close) { keep.push(o); continue; }
        if (o.kind === 'close') { this.fillClose(o, price, i); continue; }
        if (!isNa(o.limit) || !isNa(o.stop)) { keep.push(o); continue; }
        this.openEntry(o, this.slip(price, o.dir), i);
      }
      this.pending = keep;
    }

    processIntrabar(i, bar) {
      const firstHigh = bar.high - bar.open < bar.open - bar.low;
      const path = firstHigh ? [bar.open, bar.high, bar.low, bar.close] : [bar.open, bar.low, bar.high, bar.close];
      for (let guard = 0; guard < 20; guard++) {
        let best = null;
        // entry stop/limit
        for (const o of this.pending) {
          if (o.kind !== 'entry' || (isNa(o.limit) && isNa(o.stop)) || o.bar >= i) continue;
          const cands = [];
          if (!isNa(o.limit)) cands.push({ p: o.limit, gapFill: o.dir > 0 ? bar.open <= o.limit : bar.open >= o.limit, stop: false });
          if (!isNa(o.stop)) cands.push({ p: o.stop, gapFill: o.dir > 0 ? bar.open >= o.stop : bar.open <= o.stop, stop: true });
          for (const c of cands) {
            const t = c.gapFill ? 0 : Broker.hitTime(path, c.p);
            if (t === null) continue;
            if (!best || t < best.t) best = { t, type: 'entry', o, price: c.gapFill ? bar.open : c.p, stop: c.stop };
          }
        }
        // exit bracket
        const pos = this.positionSize;
        if (pos !== 0) {
          for (const x of this.exits.values()) {
            const list = this.entries.filter((e) => !x.from || e.id === x.from);
            if (!list.length) continue;
            x.armed = true;
            const d = list[0].dir;
            let q = 0, v = 0;
            for (const e of list) { q += e.qty; v += e.qty * e.price; }
            const avg = v / q;
            let tp = x.limit, sl = x.stop;
            if (isNa(tp) && !isNa(x.profit)) tp = avg + d * x.profit * this.cfg.mintick;
            if (isNa(sl) && !isNa(x.loss)) sl = avg - d * x.loss * this.cfg.mintick;
            const cands = [];
            if (!isNa(tp)) cands.push({ p: tp, gapFill: d > 0 ? bar.open >= tp : bar.open <= tp, stop: false });
            if (!isNa(sl)) cands.push({ p: sl, gapFill: d > 0 ? bar.open <= sl : bar.open >= sl, stop: true });
            for (const c of cands) {
              // jangan memicu exit di bar entry sebelum harga bergerak (selain jalur setelah open)
              const t = c.gapFill ? 0 : Broker.hitTime(path, c.p);
              if (t === null) continue;
              if (!best || t < best.t) best = { t, type: 'exit', x, list, price: c.gapFill ? bar.open : c.p, stop: c.stop };
            }
          }
        }
        if (!best) break;
        if (best.type === 'entry') {
          this.pending.splice(this.pending.indexOf(best.o), 1);
          this.openEntry(best.o, best.stop ? this.slip(best.price, best.o.dir) : best.price, i);
        } else {
          this.exits.delete(best.x.id);
          const d = best.list[0].dir;
          this.closeEntries(best.list, best.stop ? this.slip(best.price, -d) : best.price, i, best.x.id, best.x.comment);
        }
      }
    }

    // Dipanggil setelah script berjalan di bar i.
    onBarClose(i) {
      const bar = this.bars[i];
      if (this.cfg.process_orders_on_close) {
        this.fillMarket(i, bar.close);
      }
      for (const x of this.exits.values()) if (this.entries.some((e) => !x.from || e.id === x.from)) x.armed = true;
      this.lastPrice = bar.close;
      this.equity[i] = this.equityAt(bar.close);
    }

    // tutup paksa posisi terbuka di akhir data? (TradingView membiarkannya terbuka)
    openTradesSnapshot() {
      const last = this.bars.length - 1;
      const price = this.bars[last].close;
      return this.entries.map((e) => ({
        entryId: e.id, exitId: null, dir: e.dir, qty: e.qty, entryPrice: e.price, exitPrice: price,
        entryBar: e.bar, exitBar: null, entryTime: e.time, exitTime: null,
        pnl: e.dir * (price - e.price) * e.qty, pnlPct: ((e.dir * (price - e.price)) / e.price) * 100, open: true,
      }));
    }
  }

  /**
   * Hitung metrik performa dari daftar trade & kurva equity.
   * `upto` (opsional): hanya pakai data sampai bar ini (untuk mode replay).
   */
  function computeMetrics(res, bars, upto) {
    const last = upto === undefined ? bars.length - 1 : upto;
    const init = res.initialCapital;
    const trades = res.trades.filter((t) => t.exitBar <= last);
    const equity = res.equity.slice(0, last + 1);
    let gp = 0, gl = 0, wins = 0, losses = 0, lw = 0, ll = 0, bars_ = 0, comm = 0;
    for (const t of trades) {
      if (t.pnl > 0) { gp += t.pnl; wins++; lw = Math.max(lw, t.pnl); }
      else { gl += -t.pnl; losses++; ll = Math.min(ll, t.pnl); }
      bars_ += t.exitBar - t.entryBar;
      comm += t.commission || 0;
    }
    let peak = -Infinity, mdd = 0, mddPct = 0;
    for (const e of equity) {
      if (isNa(e)) continue;
      if (e > peak) peak = e;
      const dd = peak - e;
      if (dd > mdd) mdd = dd;
      const ddp = peak > 0 ? (dd / peak) * 100 : 0;
      if (ddp > mddPct) mddPct = ddp;
    }
    const finalEq = equity.length ? equity[equity.length - 1] : init;
    const n = trades.length;
    const firstBar = bars.findIndex((b) => !isNa(b.close));
    const bh = bars[last] && bars[firstBar] ? ((bars[last].close - bars[firstBar].close) / bars[firstBar].close) * 100 : NaN;
    const netProfit = gp - gl;
    return {
      initialCapital: init,
      finalEquity: finalEq,
      netProfit,
      netProfitPct: (netProfit / init) * 100,
      openProfit: finalEq - init - netProfit,
      grossProfit: gp,
      grossLoss: gl,
      profitFactor: gl ? gp / gl : gp > 0 ? Infinity : NaN,
      totalTrades: n,
      wins,
      losses,
      winRate: n ? (wins / n) * 100 : NaN,
      avgTrade: n ? netProfit / n : NaN,
      avgWin: wins ? gp / wins : NaN,
      avgLoss: losses ? -gl / losses : NaN,
      ratioWinLoss: wins && losses ? gp / wins / (gl / losses) : NaN,
      largestWin: lw,
      largestLoss: ll,
      maxDrawdown: mdd,
      maxDrawdownPct: mddPct,
      buyHoldPct: bh,
      avgBarsInTrade: n ? bars_ / n : NaN,
      commissionPaid: comm,
    };
  }

  const api = { Broker, computeMetrics };
  root.LunaBacktest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
