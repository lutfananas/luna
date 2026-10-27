// Jalankan: node tests/run-tests.js
'use strict';
globalThis.LunaTA = require('../js/ta.js');
globalThis.LunaBacktest = require('../js/backtest.js');
globalThis.LunaPineExt = require('../js/pine-ext.js');
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
const run = (src, inputs, tf = '1h') => Pine.run(Pine.compile(src), bars, { inputs, timeframe: tf });

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


console.log('switch, if-ekspresi, for-in, array, method');
{
  const r = run(`indicator("t")
mode = input.string("b", "Mode")
v = switch mode
    "a" => 1
    "b" => 2
    => 3
w = if close > open
    10
else
    -10
k = switch
    close > open => 1
    => 0
var arr = array.new_float()
arr.push(close)
if arr.size() > 3
    arr.shift()
total = 0.0
for x in arr
    total += x
cnt = 0
for [i, x] in arr
    cnt += i
s = 0
switch mode
    "b" =>
        s := 5
    => s := 7
array<float> ga = array.new<float>(2, 1.5)
plot(v)
plot(w)
plot(total)
plot(cnt)
plot(s)
plot(array.sum(ga))
plot(k)`);
  ok(!r.error, 'kompilasi & jalan ' + (r.error || ''));
  ok(r.plots[0].values[5] === 2, 'switch dengan subjek');
  ok(r.plots[1].values[10] === (bars[10].close > bars[10].open ? 10 : -10), 'if sebagai ekspresi');
  ok(near(r.plots[2].values[50], bars[48].close + bars[49].close + bars[50].close), 'array + method push/shift/size + for-in');
  ok(r.plots[3].values[50] === 3, 'for [i, x] in array');
  ok(r.plots[4].values[5] === 5, 'switch sebagai statement dengan blok');
  ok(r.plots[5].values[5] === 3, 'array.new<float>(2, 1.5) + tipe generik');
  ok(r.plots[6].values[10] === (bars[10].close > bars[10].open ? 1 : 0), 'switch tanpa subjek');
}

console.log('Timeframe & HTF');
{
  const r = run(`indicator("t")
newDay = timeframe.change("D")
var float dHigh = na
var float prevDayHigh = na
if newDay
    prevDayHigh := dHigh
    dHigh := high
else
    dHigh := math.max(dHigh, high)
sec = request.security(syminfo.tickerid, "D", high[1], lookahead = barmerge.lookahead_on)
plot(prevDayHigh)
plot(sec)
plot(timeframe.in_seconds())
plot(timeframe.in_seconds("240"))`);
  ok(!r.error, 'jalan ' + (r.error || ''));
  const i = 300;
  const day = Math.floor(bars[i].time / 864e5);
  const prevDay = bars.filter((b) => Math.floor(b.time / 864e5) === day - 1);
  const ph = Math.max(...prevDay.map((b) => b.high));
  ok(near(r.plots[0].values[i], ph), 'high hari sebelumnya via timeframe.change');
  ok(near(r.plots[1].values[i], ph), 'request.security HTF high[1] (tanpa repaint)');
  ok(r.plots[2].values[0] === 3600 && r.plots[3].values[0] === 14400, 'timeframe.in_seconds');
}

console.log('Objek gambar (box/line/label/table) & replay');
{
  const r = run(`indicator("t", overlay=true, max_boxes_count=3)
var box b = na
if bar_index == 10
    b := box.new(bar_index, high, bar_index, low, bgcolor=color.new(color.red, 80))
if bar_index > 10 and bar_index <= 20
    b.set_right(bar_index)
if bar_index % 50 == 0
    box.new(bar_index, high, bar_index + 5, low)
l = label.new(bar_index, high, "x")
label.delete(l[1])
var t = table.new(position.top_right, 2, 2)
if barstate.islast
    table.cell(t, 0, 0, "Bias", text_color=color.white)`);
  ok(!r.error, 'jalan ' + (r.error || ''));
  const Ext = globalThis.LunaPineExt;
  const b0 = r.drawings.box.find((x) => x.created === 10);
  ok(Ext.stateAt(b0, 15).right === 15 && Ext.stateAt(b0, 9) === null && b0.props.right === 20, 'riwayat box per bar (aman untuk replay)');
  ok(r.drawings.box.filter((x) => x.deleted === null).length === 3, 'batas max_boxes_count menghapus yang paling lama');
  const visibleLabels = r.drawings.label.filter((x) => Ext.stateAt(x, 100));
  ok(visibleLabels.length === 1, 'label.delete(l[1]) — hanya label terbaru yang tampil');
  ok(r.drawings.table[0].props['cell:0:0'].text === 'Bias' && !Ext.stateAt(r.drawings.table[0], 100)['cell:0:0'], 'sel tabel muncul hanya mulai bar terakhir');
}


console.log('SATTAM CRT+TBS');
{
  const CRT = require('../js/scripts-crt.js');
  // random walk dengan jalur intrabar yang konsisten, 1 jam
  let p = 50000, seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rwBars = [];
  for (let i = 0; i < 3000; i++) {
    const o = p; let h = p, l = p;
    for (let k = 0; k < 30; k++) { p *= 1 + (rnd() - 0.5) * 0.003; h = Math.max(h, p); l = Math.min(l, p); }
    rwBars.push({ time: Date.UTC(2024, 0, 1) + i * 3600e3, open: o, high: h, low: l, close: p, volume: 100 });
  }
  const runOn = (src, b, inputs) => Pine.run(Pine.compile(src), b, { timeframe: '1h', inputs });
  const ind = runOn(CRT.indicator, rwBars);
  // default strategy sudah di-tuning (sangat selektif); uji mesin trade dengan filter longgar
  const st = runOn(CRT.strategy, rwBars, { 'Entry Model': 'All', 'Kill Zones Only (New York time)': false });
  ok(!ind.error && !st.error, 'indikator & strategy jalan ' + (ind.error || st.error || ''));
  const sigs = (r, upto) => r.drawings.label.filter((l) => /^(SELL|BUY)/.test(l.props.text) && l.created < upto).map((l) => l.created + ':' + l.props.text);
  ok(sigs(ind, 1e9).length > 5, `sinyal muncul (${sigs(ind, 1e9).length})`);
  ok(st.strategy.trades.length > 5, `strategy menghasilkan trade (${st.strategy.trades.length})`);
  const K = 2000;
  const cut = runOn(CRT.indicator, rwBars.slice(0, K));
  ok(JSON.stringify(sigs(cut, K)) === JSON.stringify(sigs(ind, K)), 'tidak repaint: sinyal sebelum bar K sama dengan/ tanpa data masa depan');
  const tbl = ind.drawings.table[0];
  ok(tbl && tbl.props['cell:0:0'].text === 'HTF' && tbl.props['cell:1:0'].text === '1D', 'tabel status + HTF otomatis 1H → 1D');
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
