/* Luna — contoh script bawaan. Bebas diubah / ditambah dari dashboard. */
(function (root) {
  'use strict';

  const EXAMPLES = [
    {
      key: 'ema-cross',
      name: 'EMA Cross Strategy',
      enabled: true,
      code: `//@version=5
strategy("EMA Cross Strategy", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.1, max_lines_count=500, max_labels_count=500, max_boxes_count=500)

// Default (12/26, swing 5, TP1 90%, min R:R 0.3) hasil optimasi win rate di ENAUSDT 1H,
// diverifikasi di 30% data akhir & 15 koin lain.
// Sinyal : EMA cepat memotong EMA lambat, searah filter tren.
// Entry  : limit di ZONA EMA (antara EMA cepat & lambat) saat harga pullback,
//          bukan mengejar candle cross yang biasanya sudah jauh dari rata-rata.
// SL     : di luar swing low/high yang membentuk pembalikan (zona yang jika ditembus
//          berarti setup batal) + buffer ATR.
// TP     : zona resistance/support terdekat (pivot high/low terkonfirmasi), ditambah
//          level ekstensi Fibonacci dari swing bila zona di atasnya kosong.

gS = "Sinyal"
fastLen    = input.int(12, "EMA Cepat", minval=1, group=gS)
slowLen    = input.int(26, "EMA Lambat", minval=1, group=gS)
trendLen   = input.int(200, "Filter Tren EMA (0 = mati)", minval=0, group=gS)
allowShort = input.bool(false, "Izinkan Short", group=gS)

gZ = "Zona Entry & SL"
entryMode = input.string("Pullback ke zona EMA", "Mode Entry", options=["Pullback ke zona EMA", "Close saat cross"], group=gZ, tooltip="Pullback = order limit di EMA cepat (tepi zona EMA), menunggu harga kembali ke zona.")
maxWait   = input.int(12, "Maks. bar menunggu pullback", minval=1, group=gZ)
swingLen  = input.int(5, "Lookback swing (zona SL)", minval=2, group=gZ, tooltip="SL di luar swing low/high terendah/tertinggi N bar terakhir.")
slBufATR  = input.float(0.25, "Buffer SL (× ATR)", minval=0, step=0.05, group=gZ)

gT = "Target & Manajemen"
pivLen    = input.int(5, "Panjang pivot (zona TP)", minval=2, group=gT)
minRR1    = input.float(0.3, "Min R:R ke TP1", minval=0, step=0.1, group=gT, tooltip="Setup dilewati jika zona TP terdekat terlalu dekat dibanding jarak SL.")
tp1Pct    = input.float(90, "TP1 Tutup %", minval=5, maxval=90, step=5, group=gT)
tp2Pct    = input.float(5, "TP2 Tutup %", minval=5, maxval=90, step=5, group=gT, tooltip="Sisa posisi ditutup di TP3.")
moveBE    = input.bool(true, "SL ke Break-even setelah TP1", group=gT)
exitCross = input.bool(true, "Tutup sisa saat cross berlawanan", group=gT)
riskPct   = input.float(1.0, "Risiko per trade (% equity)", minval=0.1, maxval=100, step=0.1, group=gT, tooltip="Ukuran posisi = risiko / jarak SL, dibatasi 100% equity.")
showPlan  = input.bool(true, "Gambar zona & level", group=gT)

fast  = ta.ema(close, fastLen)
slow  = ta.ema(close, slowLen)
trend = ta.ema(close, math.max(trendLen, 1))
atr   = ta.atr(14)
plot(fast, "EMA Cepat", color=color.orange, linewidth=2)
plot(slow, "EMA Lambat", color=color.blue, linewidth=2)
plot(trendLen > 0 ? trend : na, "EMA Tren", color=color.gray)

crossUp = ta.crossover(fast, slow)
crossDn = ta.crossunder(fast, slow)
swingLo = ta.lowest(low, swingLen)
swingHi = ta.highest(high, swingLen)
rangeHi = ta.highest(high, swingLen * 3)
rangeLo = ta.lowest(low, swingLen * 3)

// ── zona resistance (pivot high) & support (pivot low) yang sudah terkonfirmasi ──
ph = ta.pivothigh(high, pivLen, pivLen)
pl = ta.pivotlow(low, pivLen, pivLen)
var res = array.new_float()
var sup = array.new_float()
if not na(ph)
    array.unshift(res, ph)
    if array.size(res) > 40
        array.pop(res)
if not na(pl)
    array.unshift(sup, pl)
    if array.size(sup) > 40
        array.pop(sup)

// level terdekat di arah d (1 = di atas lvl, -1 = di bawah lvl)
nearestLvl(arr, lvl, d) =>
    best = 0.0
    found = false
    n = array.size(arr)
    if n > 0
        for k = 0 to n - 1
            v = array.get(arr, k)
            if ((d > 0 and v > lvl) or (d < 0 and v < lvl)) and (not found or math.abs(v - lvl) < math.abs(best - lvl))
                best := v
                found := true
    found ? best : na

// ── state setup ──
var int   sDir = 0
var int   sBar = 0
var bool  sLive = false
var int   sStage = 0
var bool  sOk = false
var float sSL = na
var float sE = na
var float sT1 = na
var float sT2 = na
var float sT3 = na
var float sQty = 0.0
var float sZoneHi = na
var float sZoneLo = na
var float sExtA = na
var float sExtB = na

pos = strategy.position_size
pullback = entryMode == "Pullback ke zona EMA"
q1 = math.min(tp1Pct, 90)
q2 = math.min(tp2Pct, 95 - q1)
idOf(d) =>
    d > 0 ? "Long" : "Short"

var int nClosed = 0
closedNew = strategy.closedtrades > nClosed
nClosed := strategy.closedtrades
endedNow = false
startedNow = false
cancelledNow = false
crossExit = false
if sLive and pos == 0
    sLive := false
    sDir := 0
    endedNow := true
else if sDir != 0 and not sLive and pos != 0
    sLive := true
    startedNow := true
else if sDir != 0 and not sLive and pos == 0 and closedNew
    // entry terisi dan semua exit tersentuh di bar yang sama
    startedNow := true
    endedNow := true
    sDir := 0

// sinyal baru (hanya saat flat; menggantikan setup lama yang belum terisi)
newLong  = pos == 0 and crossUp and (trendLen == 0 or close > trend)
newShort = pos == 0 and allowShort and crossDn and (trendLen == 0 or close < trend)
newSetup = newLong or newShort
if newSetup
    if sDir != 0
        strategy.cancel(idOf(sDir))
        cancelledNow := true
    sDir := newLong ? 1 : -1
    sBar := bar_index
    sStage := 0
    sSL := newLong ? swingLo - slBufATR * atr : swingHi + slBufATR * atr
    // ekstensi Fibonacci dari swing terakhir (cadangan bila tidak ada zona pivot)
    sExtA := newLong ? swingLo : swingHi
    sExtB := newLong ? rangeHi : rangeLo

// selama menunggu pullback: perbarui level, batalkan jika setup tidak valid lagi
if sDir != 0 and not sLive and pos == 0 and not endedNow
    d = sDir
    e = pullback ? fast : close
    span = math.abs(sExtB - sExtA)
    cand = array.copy(d > 0 ? res : sup)
    array.push(cand, sExtB + d * span * 0.272)
    array.push(cand, sExtB + d * span * 0.618)
    array.push(cand, sExtB + d * span * 1.0)
    array.push(cand, sExtB + d * span * 1.618)
    array.push(cand, sExtB + d * span * 2.618)
    t1 = nearestLvl(cand, e + d * 0.1 * atr, d)
    t2 = na(t1) ? na : nearestLvl(cand, t1 + d * 0.5 * atr, d)
    t3 = na(t2) ? na : nearestLvl(cand, t2 + d * 0.5 * atr, d)
    risk = (e - sSL) * d
    broken = d > 0 ? (close <= sSL or crossDn) : (close >= sSL or crossUp)
    missed = not na(sT1) and bar_index > sBar and (d > 0 ? high >= sT1 : low <= sT1)
    expired = bar_index - sBar > maxWait
    if broken or missed or expired or na(t3) or risk <= 0
        strategy.cancel(idOf(d))
        sDir := 0
        cancelledNow := true
    else
        sE := e
        sT1 := t1
        sT2 := t2
        sT3 := t3
        sZoneHi := math.max(fast, slow)
        sZoneLo := math.min(fast, slow)
        sOk := (t1 - e) * d / risk >= minRR1
        if sOk
            sQty := math.min(strategy.equity * riskPct / 100 / risk, strategy.equity / e)
            id = idOf(d)
            if pullback
                strategy.entry(id, d > 0 ? strategy.long : strategy.short, qty=sQty, limit=e)
            else
                strategy.entry(id, d > 0 ? strategy.long : strategy.short, qty=sQty)
            strategy.exit("TP1", id, qty_percent=q1, stop=sSL, limit=t1)
            strategy.exit("TP2", id, qty_percent=q2, stop=sSL, limit=t2)
            strategy.exit("TP3", id, qty_percent=100, stop=sSL, limit=t3)
        else
            strategy.cancel(id = idOf(d))

// posisi berjalan: geser SL ke BE setelah TP1, tutup sisa saat cross berlawanan
slNew = false
if sLive and pos != 0
    id = idOf(sDir)
    rem = math.abs(pos) / sQty
    stage = rem < 1 - (q1 + q2) / 100 + 0.001 ? 2 : rem < 1 - q1 / 100 + 0.001 ? 1 : 0
    if stage > sStage and moveBE and sStage == 0
        be = strategy.position_avg_price
        sSL := be
        slNew := true
        if stage == 1
            strategy.exit("TP2", id, qty_percent=q2, stop=be, limit=sT2)
        strategy.exit("TP3", id, qty_percent=100, stop=be, limit=sT3)
    sStage := math.max(sStage, stage)
    if exitCross and (sDir > 0 ? crossDn : crossUp)
        strategy.close(id, comment="Cross berlawanan")
        crossExit := true

// ── gambar: zona entry, zona SL, Entry, SL, TP1-3 ──
var box   zBox = na
var box   slBox = na
var line  lE = na
var line  lS = na
var line  l1 = na
var line  l2 = na
var line  l3 = na
var label bE = na
var label bS = na
var label b1 = na
var label b2 = na
var label b3 = na
colL = color.new(#2962ff, 0)
colSL = color.new(#ef5350, 0)
colTP = color.new(#26a69a, 0)
rTxt(y, e, sl, d) =>
    r = math.abs(e - sl)
    v = r > 0 ? (y - e) * d / r : 0.0
    (v >= 0 ? "+" : "") + str.tostring(v, "#.##") + "R · " + str.tostring(y, format.mintick)
mkLabel(y, c) =>
    label.new(bar_index, y, "", color=color.new(c, 85), style=label.style_label_left, textcolor=c, size=size.tiny)
clearPlan() =>
    box.delete(zBox)
    box.delete(slBox)
    line.delete(lE)
    line.delete(lS)
    line.delete(l1)
    line.delete(l2)
    line.delete(l3)
    label.delete(bE)
    label.delete(bS)
    label.delete(b1)
    label.delete(b2)
    label.delete(b3)

var bool  drawPending = false
var int   dD = 0
var bool  h1 = false
var bool  h2 = false
var bool  h3 = false
var bool  hX = false
if showPlan
    d = sDir
    // 1) trade yang sedang/baru selesai berjalan
    if sLive or endedNow
        if startedNow
            // terisi: kunci level di harga fill sebenarnya
            drawPending := false
            ep = pos != 0 ? strategy.position_avg_price : sE
            sE := ep
            lE.set_style(line.style_solid)
            lE.set_xy1(bar_index, ep)
            lE.set_y2(ep)
            bE.set_text((dD > 0 ? "BUY " : "SELL ") + str.tostring(ep, format.mintick))
            zBox.set_right(bar_index)
        lE.set_x2(bar_index)
        lS.set_x2(bar_index)
        l1.set_x2(bar_index)
        l2.set_x2(bar_index)
        l3.set_x2(bar_index)
        slBox.set_right(bar_index)
        bE.set_x(bar_index)
        bS.set_x(bar_index)
        b1.set_x(bar_index)
        b2.set_x(bar_index)
        b3.set_x(bar_index)
        // tanda level yang tersentuh harga setelah entry
        if not h1 and (dD > 0 ? high >= sT1 : low <= sT1)
            h1 := true
            b1.set_text("TP1 ✓ " + str.tostring(q1, "#") + "% · " + str.tostring(sT1, format.mintick))
        if not h2 and (dD > 0 ? high >= sT2 : low <= sT2)
            h2 := true
            b2.set_text("TP2 ✓ " + str.tostring(q2, "#") + "% · " + str.tostring(sT2, format.mintick))
        if not h3 and (dD > 0 ? high >= sT3 : low <= sT3)
            h3 := true
            b3.set_text("TP3 ✓ sisa · " + str.tostring(sT3, format.mintick))
        if crossExit
            hX := true
        if endedNow and not h3
            bS.set_text(hX ? "Ditutup: cross berlawanan" : (h1 ? "SL (sisa) ✕ · " : "SL ✕ · ") + str.tostring(sSL, format.mintick))
        if slNew
            lS := line.new(bar_index, sSL, bar_index, sSL, color=colSL, style=line.style_dashed)
            bS.set_y(sSL)
            bS.set_text("SL → BE · " + str.tostring(sSL, format.mintick))
    // 2) setup yang belum terisi dibatalkan/diganti → hapus gambarnya
    if cancelledNow and drawPending
        clearPlan()
        drawPending := false
    // 3) setup baru yang valid → buat gambar
    if newSetup and d != 0 and not sLive
        drawPending := true
        dD := d
        h1 := false
        h2 := false
        h3 := false
        hX := false
        zBox := box.new(bar_index, sZoneHi, bar_index, sZoneLo, border_color=na, bgcolor=color.new(colL, 85), text="Zona entry (EMA)", text_size=size.tiny, text_color=color.new(colL, 30), text_halign=text.align_left)
        slBox := box.new(bar_index, sExtA, bar_index, sSL, border_color=na, bgcolor=color.new(colSL, 82), text="Zona SL (swing)", text_size=size.tiny, text_color=color.new(colSL, 30), text_halign=text.align_left)
        lE := line.new(bar_index, sE, bar_index, sE, color=colL, style=line.style_dashed)
        lS := line.new(bar_index, sSL, bar_index, sSL, color=colSL)
        l1 := line.new(bar_index, sT1, bar_index, sT1, color=colTP, style=line.style_dashed)
        l2 := line.new(bar_index, sT2, bar_index, sT2, color=colTP, style=line.style_dashed)
        l3 := line.new(bar_index, sT3, bar_index, sT3, color=colTP)
        bE := mkLabel(sE, colL)
        bS := mkLabel(sSL, colSL)
        b1 := mkLabel(sT1, colTP)
        b2 := mkLabel(sT2, colTP)
        b3 := mkLabel(sT3, colTP)
    // 4) menunggu pullback: level ikut bergerak bersama EMA
    if drawPending and d != 0 and not sLive
        zBox.set_right(bar_index)
        zBox.set_top(sZoneHi)
        zBox.set_bottom(sZoneLo)
        slBox.set_right(bar_index)
        lE.set_xy1(sBar, sE)
        lE.set_xy2(bar_index, sE)
        l1.set_xy1(sBar, sT1)
        l1.set_xy2(bar_index, sT1)
        l2.set_xy1(sBar, sT2)
        l2.set_xy2(bar_index, sT2)
        l3.set_xy1(sBar, sT3)
        l3.set_xy2(bar_index, sT3)
        lS.set_x2(bar_index)
        bE.set_xy(bar_index, sE)
        bE.set_text((d > 0 ? "BUY" : "SELL") + (pullback ? " LIMIT " : " ") + str.tostring(sE, format.mintick) + (sOk ? "" : " · R:R TP1 kurang"))
        bS.set_xy(bar_index, sSL)
        bS.set_text("SL · " + rTxt(sSL, sE, sSL, d))
        b1.set_xy(bar_index, sT1)
        b1.set_text("TP1 " + str.tostring(q1, "#") + "% · " + rTxt(sT1, sE, sSL, d))
        b2.set_xy(bar_index, sT2)
        b2.set_text("TP2 " + str.tostring(q2, "#") + "% · " + rTxt(sT2, sE, sSL, d))
        b3.set_xy(bar_index, sT3)
        b3.set_text("TP3 sisa · " + rTxt(sT3, sE, sSL, d))
`,
    },
    {
      key: 'rsi',
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
      key: 'macd',
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
      key: 'bb',
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
      key: 'supertrend',
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
      key: 'rsi-sltp',
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
      key: 'fn-var',
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

  const CRT = root.LunaCRT || (typeof require !== 'undefined' ? require('./scripts-crt.js') : null);
  if (CRT) {
    EXAMPLES.push(
      { key: 'crt-ind', name: 'SATTAM | CRT+TBS', enabled: true, code: CRT.indicator },
      { key: 'crt-strat', name: 'SATTAM | CRT+TBS Strategy', enabled: false, code: CRT.strategy },
    );
  }
  const MYTT = root.LunaMyTT || (typeof require !== 'undefined' ? require('./scripts-mytt.js') : null);
  if (MYTT) {
    EXAMPLES.push(
      { key: 'mytt-ind', name: 'MyTT KDJ + DMI', enabled: false, code: MYTT.indicator },
      { key: 'mytt-strat', name: 'MyTT Trend Pullback', enabled: false, code: MYTT.strategy },
    );
  }
  // kode lama contoh bawaan: script tersimpan yang masih persis sama (belum diedit pengguna)
  // diperbarui otomatis ke versi baru
  const LEGACY = {
    'ema-cross': [String.raw`//@version=5
strategy("EMA Cross Strategy", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.1, max_lines_count=500, max_labels_count=500, max_boxes_count=500)

// Sinyal : EMA cepat memotong EMA lambat, searah filter tren.
// Entry  : limit di ZONA EMA (antara EMA cepat & lambat) saat harga pullback,
//          bukan mengejar candle cross yang biasanya sudah jauh dari rata-rata.
// SL     : di luar swing low/high yang membentuk pembalikan (zona yang jika ditembus
//          berarti setup batal) + buffer ATR.
// TP     : zona resistance/support terdekat (pivot high/low terkonfirmasi), ditambah
//          level ekstensi Fibonacci dari swing bila zona di atasnya kosong.

gS = "Sinyal"
fastLen    = input.int(9, "EMA Cepat", minval=1, group=gS)
slowLen    = input.int(21, "EMA Lambat", minval=1, group=gS)
trendLen   = input.int(200, "Filter Tren EMA (0 = mati)", minval=0, group=gS)
allowShort = input.bool(false, "Izinkan Short", group=gS)

gZ = "Zona Entry & SL"
entryMode = input.string("Pullback ke zona EMA", "Mode Entry", options=["Pullback ke zona EMA", "Close saat cross"], group=gZ, tooltip="Pullback = order limit di EMA cepat (tepi zona EMA), menunggu harga kembali ke zona.")
maxWait   = input.int(12, "Maks. bar menunggu pullback", minval=1, group=gZ)
swingLen  = input.int(10, "Lookback swing (zona SL)", minval=2, group=gZ, tooltip="SL di luar swing low/high terendah/tertinggi N bar terakhir.")
slBufATR  = input.float(0.25, "Buffer SL (× ATR)", minval=0, step=0.05, group=gZ)

gT = "Target & Manajemen"
pivLen    = input.int(5, "Panjang pivot (zona TP)", minval=2, group=gT)
minRR1    = input.float(0.5, "Min R:R ke TP1", minval=0, step=0.1, group=gT, tooltip="Setup dilewati jika zona TP terdekat terlalu dekat dibanding jarak SL.")
tp1Pct    = input.float(50, "TP1 Tutup %", minval=5, maxval=90, step=5, group=gT)
tp2Pct    = input.float(30, "TP2 Tutup %", minval=5, maxval=90, step=5, group=gT, tooltip="Sisa posisi ditutup di TP3.")
moveBE    = input.bool(true, "SL ke Break-even setelah TP1", group=gT)
exitCross = input.bool(true, "Tutup sisa saat cross berlawanan", group=gT)
riskPct   = input.float(1.0, "Risiko per trade (% equity)", minval=0.1, maxval=100, step=0.1, group=gT, tooltip="Ukuran posisi = risiko / jarak SL, dibatasi 100% equity.")
showPlan  = input.bool(true, "Gambar zona & level", group=gT)

fast  = ta.ema(close, fastLen)
slow  = ta.ema(close, slowLen)
trend = ta.ema(close, math.max(trendLen, 1))
atr   = ta.atr(14)
plot(fast, "EMA Cepat", color=color.orange, linewidth=2)
plot(slow, "EMA Lambat", color=color.blue, linewidth=2)
plot(trendLen > 0 ? trend : na, "EMA Tren", color=color.gray)

crossUp = ta.crossover(fast, slow)
crossDn = ta.crossunder(fast, slow)
swingLo = ta.lowest(low, swingLen)
swingHi = ta.highest(high, swingLen)
rangeHi = ta.highest(high, swingLen * 3)
rangeLo = ta.lowest(low, swingLen * 3)

// ── zona resistance (pivot high) & support (pivot low) yang sudah terkonfirmasi ──
ph = ta.pivothigh(high, pivLen, pivLen)
pl = ta.pivotlow(low, pivLen, pivLen)
var res = array.new_float()
var sup = array.new_float()
if not na(ph)
    array.unshift(res, ph)
    if array.size(res) > 40
        array.pop(res)
if not na(pl)
    array.unshift(sup, pl)
    if array.size(sup) > 40
        array.pop(sup)

// level terdekat di arah d (1 = di atas lvl, -1 = di bawah lvl)
nearestLvl(arr, lvl, d) =>
    best = 0.0
    found = false
    n = array.size(arr)
    if n > 0
        for k = 0 to n - 1
            v = array.get(arr, k)
            if ((d > 0 and v > lvl) or (d < 0 and v < lvl)) and (not found or math.abs(v - lvl) < math.abs(best - lvl))
                best := v
                found := true
    found ? best : na

// ── state setup ──
var int   sDir = 0
var int   sBar = 0
var bool  sLive = false
var int   sStage = 0
var bool  sOk = false
var float sSL = na
var float sE = na
var float sT1 = na
var float sT2 = na
var float sT3 = na
var float sQty = 0.0
var float sZoneHi = na
var float sZoneLo = na
var float sExtA = na
var float sExtB = na

pos = strategy.position_size
pullback = entryMode == "Pullback ke zona EMA"
q1 = math.min(tp1Pct, 90)
q2 = math.min(tp2Pct, 95 - q1)
idOf(d) =>
    d > 0 ? "Long" : "Short"

var int nClosed = 0
closedNew = strategy.closedtrades > nClosed
nClosed := strategy.closedtrades
endedNow = false
startedNow = false
cancelledNow = false
crossExit = false
if sLive and pos == 0
    sLive := false
    sDir := 0
    endedNow := true
else if sDir != 0 and not sLive and pos != 0
    sLive := true
    startedNow := true
else if sDir != 0 and not sLive and pos == 0 and closedNew
    // entry terisi dan semua exit tersentuh di bar yang sama
    startedNow := true
    endedNow := true
    sDir := 0

// sinyal baru (hanya saat flat; menggantikan setup lama yang belum terisi)
newLong  = pos == 0 and crossUp and (trendLen == 0 or close > trend)
newShort = pos == 0 and allowShort and crossDn and (trendLen == 0 or close < trend)
newSetup = newLong or newShort
if newSetup
    if sDir != 0
        strategy.cancel(idOf(sDir))
        cancelledNow := true
    sDir := newLong ? 1 : -1
    sBar := bar_index
    sStage := 0
    sSL := newLong ? swingLo - slBufATR * atr : swingHi + slBufATR * atr
    // ekstensi Fibonacci dari swing terakhir (cadangan bila tidak ada zona pivot)
    sExtA := newLong ? swingLo : swingHi
    sExtB := newLong ? rangeHi : rangeLo

// selama menunggu pullback: perbarui level, batalkan jika setup tidak valid lagi
if sDir != 0 and not sLive and pos == 0 and not endedNow
    d = sDir
    e = pullback ? fast : close
    span = math.abs(sExtB - sExtA)
    cand = array.copy(d > 0 ? res : sup)
    array.push(cand, sExtB + d * span * 0.272)
    array.push(cand, sExtB + d * span * 0.618)
    array.push(cand, sExtB + d * span * 1.0)
    array.push(cand, sExtB + d * span * 1.618)
    array.push(cand, sExtB + d * span * 2.618)
    t1 = nearestLvl(cand, e + d * 0.1 * atr, d)
    t2 = na(t1) ? na : nearestLvl(cand, t1 + d * 0.5 * atr, d)
    t3 = na(t2) ? na : nearestLvl(cand, t2 + d * 0.5 * atr, d)
    risk = (e - sSL) * d
    broken = d > 0 ? (close <= sSL or crossDn) : (close >= sSL or crossUp)
    missed = not na(sT1) and bar_index > sBar and (d > 0 ? high >= sT1 : low <= sT1)
    expired = bar_index - sBar > maxWait
    if broken or missed or expired or na(t3) or risk <= 0
        strategy.cancel(idOf(d))
        sDir := 0
        cancelledNow := true
    else
        sE := e
        sT1 := t1
        sT2 := t2
        sT3 := t3
        sZoneHi := math.max(fast, slow)
        sZoneLo := math.min(fast, slow)
        sOk := (t1 - e) * d / risk >= minRR1
        if sOk
            sQty := math.min(strategy.equity * riskPct / 100 / risk, strategy.equity / e)
            id = idOf(d)
            if pullback
                strategy.entry(id, d > 0 ? strategy.long : strategy.short, qty=sQty, limit=e)
            else
                strategy.entry(id, d > 0 ? strategy.long : strategy.short, qty=sQty)
            strategy.exit("TP1", id, qty_percent=q1, stop=sSL, limit=t1)
            strategy.exit("TP2", id, qty_percent=q2, stop=sSL, limit=t2)
            strategy.exit("TP3", id, qty_percent=100, stop=sSL, limit=t3)
        else
            strategy.cancel(id = idOf(d))

// posisi berjalan: geser SL ke BE setelah TP1, tutup sisa saat cross berlawanan
slNew = false
if sLive and pos != 0
    id = idOf(sDir)
    rem = math.abs(pos) / sQty
    stage = rem < 1 - (q1 + q2) / 100 + 0.001 ? 2 : rem < 1 - q1 / 100 + 0.001 ? 1 : 0
    if stage > sStage and moveBE and sStage == 0
        be = strategy.position_avg_price
        sSL := be
        slNew := true
        if stage == 1
            strategy.exit("TP2", id, qty_percent=q2, stop=be, limit=sT2)
        strategy.exit("TP3", id, qty_percent=100, stop=be, limit=sT3)
    sStage := math.max(sStage, stage)
    if exitCross and (sDir > 0 ? crossDn : crossUp)
        strategy.close(id, comment="Cross berlawanan")
        crossExit := true

// ── gambar: zona entry, zona SL, Entry, SL, TP1-3 ──
var box   zBox = na
var box   slBox = na
var line  lE = na
var line  lS = na
var line  l1 = na
var line  l2 = na
var line  l3 = na
var label bE = na
var label bS = na
var label b1 = na
var label b2 = na
var label b3 = na
colL = color.new(#2962ff, 0)
colSL = color.new(#ef5350, 0)
colTP = color.new(#26a69a, 0)
rTxt(y, e, sl, d) =>
    r = math.abs(e - sl)
    v = r > 0 ? (y - e) * d / r : 0.0
    (v >= 0 ? "+" : "") + str.tostring(v, "#.##") + "R · " + str.tostring(y, format.mintick)
mkLabel(y, c) =>
    label.new(bar_index, y, "", color=color.new(c, 85), style=label.style_label_left, textcolor=c, size=size.tiny)
clearPlan() =>
    box.delete(zBox)
    box.delete(slBox)
    line.delete(lE)
    line.delete(lS)
    line.delete(l1)
    line.delete(l2)
    line.delete(l3)
    label.delete(bE)
    label.delete(bS)
    label.delete(b1)
    label.delete(b2)
    label.delete(b3)

var bool  drawPending = false
var int   dD = 0
var bool  h1 = false
var bool  h2 = false
var bool  h3 = false
var bool  hX = false
if showPlan
    d = sDir
    // 1) trade yang sedang/baru selesai berjalan
    if sLive or endedNow
        if startedNow
            // terisi: kunci level di harga fill sebenarnya
            drawPending := false
            ep = pos != 0 ? strategy.position_avg_price : sE
            sE := ep
            lE.set_style(line.style_solid)
            lE.set_xy1(bar_index, ep)
            lE.set_y2(ep)
            bE.set_text((dD > 0 ? "BUY " : "SELL ") + str.tostring(ep, format.mintick))
            zBox.set_right(bar_index)
        lE.set_x2(bar_index)
        lS.set_x2(bar_index)
        l1.set_x2(bar_index)
        l2.set_x2(bar_index)
        l3.set_x2(bar_index)
        slBox.set_right(bar_index)
        bE.set_x(bar_index)
        bS.set_x(bar_index)
        b1.set_x(bar_index)
        b2.set_x(bar_index)
        b3.set_x(bar_index)
        // tanda level yang tersentuh harga setelah entry
        if not h1 and (dD > 0 ? high >= sT1 : low <= sT1)
            h1 := true
            b1.set_text("TP1 ✓ " + str.tostring(q1, "#") + "% · " + str.tostring(sT1, format.mintick))
        if not h2 and (dD > 0 ? high >= sT2 : low <= sT2)
            h2 := true
            b2.set_text("TP2 ✓ " + str.tostring(q2, "#") + "% · " + str.tostring(sT2, format.mintick))
        if not h3 and (dD > 0 ? high >= sT3 : low <= sT3)
            h3 := true
            b3.set_text("TP3 ✓ sisa · " + str.tostring(sT3, format.mintick))
        if crossExit
            hX := true
        if endedNow and not h3
            bS.set_text(hX ? "Ditutup: cross berlawanan" : (h1 ? "SL (sisa) ✕ · " : "SL ✕ · ") + str.tostring(sSL, format.mintick))
        if slNew
            lS := line.new(bar_index, sSL, bar_index, sSL, color=colSL, style=line.style_dashed)
            bS.set_y(sSL)
            bS.set_text("SL → BE · " + str.tostring(sSL, format.mintick))
    // 2) setup yang belum terisi dibatalkan/diganti → hapus gambarnya
    if cancelledNow and drawPending
        clearPlan()
        drawPending := false
    // 3) setup baru yang valid → buat gambar
    if newSetup and d != 0 and not sLive
        drawPending := true
        dD := d
        h1 := false
        h2 := false
        h3 := false
        hX := false
        zBox := box.new(bar_index, sZoneHi, bar_index, sZoneLo, border_color=na, bgcolor=color.new(colL, 85), text="Zona entry (EMA)", text_size=size.tiny, text_color=color.new(colL, 30), text_halign=text.align_left)
        slBox := box.new(bar_index, sExtA, bar_index, sSL, border_color=na, bgcolor=color.new(colSL, 82), text="Zona SL (swing)", text_size=size.tiny, text_color=color.new(colSL, 30), text_halign=text.align_left)
        lE := line.new(bar_index, sE, bar_index, sE, color=colL, style=line.style_dashed)
        lS := line.new(bar_index, sSL, bar_index, sSL, color=colSL)
        l1 := line.new(bar_index, sT1, bar_index, sT1, color=colTP, style=line.style_dashed)
        l2 := line.new(bar_index, sT2, bar_index, sT2, color=colTP, style=line.style_dashed)
        l3 := line.new(bar_index, sT3, bar_index, sT3, color=colTP)
        bE := mkLabel(sE, colL)
        bS := mkLabel(sSL, colSL)
        b1 := mkLabel(sT1, colTP)
        b2 := mkLabel(sT2, colTP)
        b3 := mkLabel(sT3, colTP)
    // 4) menunggu pullback: level ikut bergerak bersama EMA
    if drawPending and d != 0 and not sLive
        zBox.set_right(bar_index)
        zBox.set_top(sZoneHi)
        zBox.set_bottom(sZoneLo)
        slBox.set_right(bar_index)
        lE.set_xy1(sBar, sE)
        lE.set_xy2(bar_index, sE)
        l1.set_xy1(sBar, sT1)
        l1.set_xy2(bar_index, sT1)
        l2.set_xy1(sBar, sT2)
        l2.set_xy2(bar_index, sT2)
        l3.set_xy1(sBar, sT3)
        l3.set_xy2(bar_index, sT3)
        lS.set_x2(bar_index)
        bE.set_xy(bar_index, sE)
        bE.set_text((d > 0 ? "BUY" : "SELL") + (pullback ? " LIMIT " : " ") + str.tostring(sE, format.mintick) + (sOk ? "" : " · R:R TP1 kurang"))
        bS.set_xy(bar_index, sSL)
        bS.set_text("SL · " + rTxt(sSL, sE, sSL, d))
        b1.set_xy(bar_index, sT1)
        b1.set_text("TP1 " + str.tostring(q1, "#") + "% · " + rTxt(sT1, sE, sSL, d))
        b2.set_xy(bar_index, sT2)
        b2.set_text("TP2 " + str.tostring(q2, "#") + "% · " + rTxt(sT2, sE, sSL, d))
        b3.set_xy(bar_index, sT3)
        b3.set_text("TP3 sisa · " + rTxt(sT3, sE, sSL, d))
`, String.raw`//@version=5
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
`],
  };
  // contoh yang sudah ada sejak versi pertama (untuk migrasi data lama)
  const ORIGINAL_KEYS = ['ema-cross', 'rsi', 'macd', 'bb', 'supertrend', 'rsi-sltp', 'fn-var'];

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

  const api = { EXAMPLES, LEGACY, ORIGINAL_KEYS, TEMPLATE_INDICATOR, TEMPLATE_STRATEGY };
  root.LunaScripts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
