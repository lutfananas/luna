/* Luna — contoh script bawaan. Bebas diubah / ditambah dari dashboard. */
(function (root) {
  'use strict';

  const EXAMPLES = [
    {
      name: 'EMA Cross Strategy',
      enabled: true,
      code: `//@version=5
strategy("EMA Cross Strategy", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.1)

fastLen = input.int(9, "EMA Cepat", minval=1)
slowLen = input.int(21, "EMA Lambat", minval=1)

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

plot(fast, "EMA Cepat", color=color.orange, linewidth=2)
plot(slow, "EMA Lambat", color=color.blue, linewidth=2)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
`,
    },
    {
      name: 'RSI',
      enabled: true,
      code: `//@version=5
indicator("RSI", overlay=false)

len = input.int(14, "Panjang RSI", minval=1)
src = input.source(close, "Sumber")
ob = input.int(70, "Overbought")
os = input.int(30, "Oversold")

r = ta.rsi(src, len)
plot(r, "RSI", color=color.purple, linewidth=2)
hline(ob, "Overbought", color=color.red)
hline(50, "Tengah", color=color.gray)
hline(os, "Oversold", color=color.green)
bgcolor(r > ob ? color.new(color.red, 85) : r < os ? color.new(color.green, 85) : na)
`,
    },
    {
      name: 'MACD',
      enabled: false,
      code: `//@version=5
indicator("MACD", overlay=false)

fastLen = input.int(12, "Fast")
slowLen = input.int(26, "Slow")
sigLen = input.int(9, "Signal")

[macdLine, signalLine, hist] = ta.macd(close, fastLen, slowLen, sigLen)

histColor = hist >= 0 ? (hist > hist[1] ? color.new(color.green, 0) : color.new(color.green, 50)) : (hist < hist[1] ? color.new(color.red, 0) : color.new(color.red, 50))
plot(hist, "Histogram", color=histColor, style=plot.style_columns)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
hline(0, "Nol", color=color.gray)
`,
    },
    {
      name: 'Bollinger Bands',
      enabled: false,
      code: `//@version=5
indicator("Bollinger Bands", overlay=true)

length = input.int(20, "Panjang")
mult = input.float(2.0, "Deviasi", step=0.1)

[basis, upper, lower] = ta.bb(close, length, mult)
plot(basis, "Basis", color=color.orange)
plot(upper, "Atas", color=color.teal)
plot(lower, "Bawah", color=color.teal)
plotshape(ta.crossunder(close, lower), "Tembus bawah", shape.triangleup, location.belowbar, color.green)
plotshape(ta.crossover(close, upper), "Tembus atas", shape.triangledown, location.abovebar, color.red)
`,
    },
    {
      name: 'Supertrend Strategy',
      enabled: false,
      code: `//@version=5
strategy("Supertrend Strategy", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.1)

atrLen = input.int(10, "ATR Length")
factor = input.float(3.0, "Faktor", step=0.1)
allowShort = input.bool(false, "Izinkan Short")

[st, dir] = ta.supertrend(factor, atrLen)
plot(dir < 0 ? st : na, "Up", color=color.green, linewidth=2, style=plot.style_linebr)
plot(dir > 0 ? st : na, "Down", color=color.red, linewidth=2, style=plot.style_linebr)

if ta.change(dir) < 0
    strategy.entry("Long", strategy.long)
if ta.change(dir) > 0
    if allowShort
        strategy.entry("Short", strategy.short)
    else
        strategy.close("Long")
`,
    },
    {
      name: 'RSI Reversal + SL/TP',
      enabled: false,
      code: `//@version=5
strategy("RSI Reversal + SL/TP", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=50, commission_value=0.1)

rsiLen = input.int(14, "RSI Length")
level = input.int(30, "Level Oversold")
slPct = input.float(2.0, "Stop Loss %", step=0.1)
tpPct = input.float(4.0, "Take Profit %", step=0.1)
trendLen = input.int(200, "Filter EMA")

r = ta.rsi(close, rsiLen)
trend = ta.ema(close, trendLen)
plot(trend, "EMA Trend", color=color.gray)

longSignal = ta.crossover(r, level) and close > trend
plotshape(longSignal, "Sinyal", shape.labelup, location.belowbar, color.green, text="BUY")

if longSignal and strategy.position_size == 0
    strategy.entry("Long", strategy.long)

if strategy.position_size > 0
    entryPrice = strategy.position_avg_price
    strategy.exit("SL/TP", "Long", stop=entryPrice * (1 - slPct / 100), limit=entryPrice * (1 + tpPct / 100))
`,
    },
    {
      name: 'Contoh: fungsi & var',
      enabled: false,
      code: `//@version=5
indicator("Contoh fungsi & var", overlay=true)

// fungsi buatan sendiri (bisa memakai ta.* di dalamnya)
myBand(src, len, mult) =>
    mid = ta.sma(src, len)
    dev = ta.stdev(src, len)
    [mid + dev * mult, mid - dev * mult]

[up, dn] = myBand(close, 30, 1.5)
plot(up, "Atas", color=color.new(color.aqua, 30))
plot(dn, "Bawah", color=color.new(color.aqua, 30))

// variabel 'var' menyimpan nilai antar bar
var int naikBeruntun = 0
if close > open
    naikBeruntun := naikBeruntun + 1
else
    naikBeruntun := 0

plotchar(naikBeruntun >= 4, "4 hijau beruntun", "▲", location.belowbar, color.lime)
barcolor(naikBeruntun >= 4 ? color.lime : na)
`,
    },
  ];

  const TEMPLATE_INDICATOR = `//@version=5
indicator("Indikator Baru", overlay=true)

length = input.int(20, "Panjang")
ma = ta.sma(close, length)
plot(ma, "SMA", color=color.yellow, linewidth=2)
`;

  const TEMPLATE_STRATEGY = `//@version=5
strategy("Strategi Baru", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.1)

length = input.int(50, "Panjang MA")
ma = ta.sma(close, length)
plot(ma, "MA", color=color.yellow)

if ta.crossover(close, ma)
    strategy.entry("Long", strategy.long)
if ta.crossunder(close, ma)
    strategy.close("Long")
`;

  const api = { EXAMPLES, TEMPLATE_INDICATOR, TEMPLATE_STRATEGY };
  root.LunaScripts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
