// Jalankan: node tests/run-tests.js
'use strict';
globalThis.LunaTA = require('../js/ta.js');
globalThis.LunaBacktest = require('../js/backtest.js');
const Pine = require('../js/pine.js');
const { EXAMPLES } = require('../js/scripts.js');

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { console.log('  FAIL ' + msg); failed++; }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// data simulasi deterministik
function makeBars(n, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bars = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o * (1 + (rnd() - 0.5) * 0.04);
    const h = Math.max(o, c) * (1 + rnd() * 0.01);
    const l = Math.min(o, c) * (1 - rnd() * 0.01);
    bars.push({ time: Date.UTC(2024, 0, 1) + i * 3600e3, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: 100 + rnd() * 50 });
    p = c;
  }
  return bars;
}
const bars = makeBars(600);
const run = (src, inputs) => Pine.run(Pine.compile(src), bars, { inputs });

console.log('Contoh bawaan');
for (const ex of EXAMPLES) {
  const r = run(ex.code);
  ok(!r.error, `${ex.name} jalan tanpa error ${r.error || ''}`);
  if (r.strategy) console.log(`       trades=${r.strategy.metrics.totalTrades} net=${r.strategy.metrics.netProfit.toFixed(2)} winrate=${r.strategy.metrics.winRate.toFixed(1)}%`);
}

console.log('Indikator vs perhitungan manual');
{
  const r = run(`indicator("t")\nplot(ta.sma(close, 5))\nplot(ta.ema(close, 5))\nplot(close[2])\nplot(ta.rsi(close, 14))`);
  const sma = r.plots[0].values, ema = r.plots[1].values, lag = r.plots[2].values;
  const i = 100;
  const manual = bars.slice(i - 4, i + 1).reduce((a, b) => a + b.close, 0) / 5;
  ok(near(sma[i], manual), 'ta.sma benar');
  ok(Number.isNaN(sma[3]) && !Number.isNaN(sma[4]), 'ta.sma NaN sebelum cukup data');
  let e = bars.slice(0, 5).reduce((a, b) => a + b.close, 0) / 5;
  for (let k = 5; k <= i; k++) e = (2 / 6) * bars[k].close + (1 - 2 / 6) * e;
  ok(near(ema[i], e), 'ta.ema benar (seed SMA)');
  ok(lag[i] === bars[i - 2].close && Number.isNaN(lag[1]), 'close[2] histori benar');
  const rsi = r.plots[3].values;
  ok(rsi[200] > 0 && rsi[200] < 100, 'ta.rsi dalam rentang 0..100');
}

console.log('var, :=, if/else, for, fungsi');
{
  const r = run(`indicator("t")
var count = 0
x = 0
if close > open
    count := count + 1
    x := 1
else if close < open
    x := -1
else
    x := 0
total = 0.0
for i = 1 to 3
    total += i
f(a, b = 2) => a * b
g(v) =>
    s = ta.sma(v, 3)
    s * 2
plot(count)
plot(x)
plot(total)
plot(f(3))
plot(g(close))
plot(f(a = 5, b = 3))`);
  ok(!r.error, 'kompilasi & jalan ' + (r.error || ''));
  const ups = bars.filter((b) => b.close > b.open).length;
  ok(r.plots[0].values[bars.length - 1] === ups, 'var count akumulasi benar');
  ok(r.plots[1].values[10] === Math.sign(bars[10].close - bars[10].open), 'if/else if/else benar');
  ok(r.plots[2].values[5] === 6, 'for loop benar');
  ok(r.plots[3].values[5] === 6, 'fungsi dengan default param');
  const i = 50;
  ok(near(r.plots[4].values[i], 2 * (bars[i].close + bars[i - 1].close + bars[i - 2].close) / 3), 'fungsi blok dengan ta.* di dalamnya');
  ok(r.plots[5].values[5] === 15, 'argumen bernama untuk fungsi user');
}

console.log('Input override');
{
  const src = `indicator("t")\nlen = input.int(5, "Len")\nplot(ta.sma(close, len))`;
  const a = run(src), b = run(src, { Len: 10 });
  ok(a.inputs.length === 1 && a.inputs[0].defval === 5, 'input terdeteksi');
  ok(Number.isNaN(b.plots[0].values[8]) && !Number.isNaN(a.plots[0].values[8]), 'override input dipakai');
}

console.log('Backtest');
{
  // beli di bar 10, tutup di bar 20 -> isi di open bar 11 & open bar 21
  const r = run(`strategy("t", initial_capital=1000)
if bar_index == 10
    strategy.entry("L", strategy.long, qty=2)
if bar_index == 20
    strategy.close("L")`);
  const t = r.strategy.trades[0];
  ok(r.strategy.trades.length === 1, 'satu trade');
  ok(t.entryPrice === bars[11].open && t.exitPrice === bars[21].open, 'isi di open bar berikutnya');
  ok(near(t.pnl, (bars[21].open - bars[11].open) * 2), 'PnL benar');
  ok(near(r.strategy.equity[bars.length - 1], 1000 + t.pnl), 'equity akhir benar');
}
{
  // reversal long -> short
  const r = run(`strategy("t")
if bar_index == 10
    strategy.entry("L", strategy.long)
if bar_index == 20
    strategy.entry("S", strategy.short)`);
  ok(r.strategy.trades.length === 1 && r.strategy.openTrades.length === 1 && r.strategy.openTrades[0].dir === -1, 'reversal long ke short');
}
{
  // stop loss / take profit
  const r = run(`strategy("t")
if bar_index == 10
    strategy.entry("L", strategy.long)
    strategy.exit("X", "L", stop=close * 0.97, limit=close * 1.03)`);
  const t = r.strategy.trades[0];
  ok(t && (near(t.exitPrice, bars[10].close * 0.97) || near(t.exitPrice, bars[10].close * 1.03) || t.exitPrice === bars[t.exitBar].open), 'exit stop/limit terisi di level yang benar');
  // verifikasi tidak ada bar sebelum exit yang menyentuh level
  let hitEarlier = false;
  for (let k = 11; k < t.exitBar; k++) if (bars[k].low <= bars[10].close * 0.97 || bars[k].high >= bars[10].close * 1.03) hitEarlier = true;
  ok(!hitEarlier, 'exit pada bar pertama yang menyentuh level');
}
{
  // komisi persen
  const r = run(`strategy("t", commission_value=0.1)
if bar_index == 10
    strategy.entry("L", strategy.long, qty=1)
if bar_index == 12
    strategy.close("L")`);
  const t = r.strategy.trades[0];
  const exp = t.exitPrice - t.entryPrice - 0.001 * (t.entryPrice + t.exitPrice);
  ok(near(t.pnl, exp), 'komisi dihitung');
}

console.log('Pesan error');
{
  const cases = [
    ['plot(foo)', 'belum dideklarasikan'],
    ['x = 1\nx = = 2', ''],
    ['if close > open\nplot(close)', 'kosong'],
    ['plot(close, warna=color.red)', 'tidak punya parameter'],
  ];
  for (const [src, expect] of cases) {
    let msg = '';
    try { Pine.compile(src); } catch (e) { msg = e.message; }
    ok(msg && msg.includes(expect) && /Baris \d+/.test(msg), `error terdeteksi: ${msg}`);
  }
}

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes lulus');
process.exit(failed ? 1 : 0);
