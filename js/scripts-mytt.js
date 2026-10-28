/*
 * MyTT Trend Pullback — strategi & indikator dari rumus ala MyTT / 通达信 (TongDaXin).
 * Rumus BBI, KDJ, DMI dan TAQ mengikuti definisi di https://github.com/mpquant/MyTT
 * (ditulis ulang dalam Pine; tidak menyalin kode Python-nya).
 *
 * Ide: ikut tren (BBI naik + DMI searah + ADX cukup kuat), masuk saat koreksi
 * selesai (KDJ golden cross setelah J turun ke area jenuh jual).
 */
(function (root) {
  'use strict';

  // rumus MyTT dalam Pine (dipakai indikator & strategy)
  const FORMULAS = String.raw`
// ── rumus MyTT ──
// SUM(X, N) = jumlah N bar terakhir
mySum(x, n) =>
    ta.sma(x, n) * n
// BBI = (MA3 + MA6 + MA12 + MA20) / 4
bbi = (ta.sma(close, bbi1) + ta.sma(close, bbi2) + ta.sma(close, bbi3) + ta.sma(close, bbi4)) / 4
// KDJ: RSV = (C - LLV(L,N)) / (HHV(H,N) - LLV(L,N)) × 100, K = EMA(RSV, 2·M1-1), D = EMA(K, 2·M2-1), J = 3K - 2D
kdjLo = ta.lowest(low, kdjN)
kdjHi = ta.highest(high, kdjN)
rsv = kdjHi > kdjLo ? (close - kdjLo) / (kdjHi - kdjLo) * 100 : 50
kK = ta.ema(rsv, kdjM1 * 2 - 1)
kD = ta.ema(kK, kdjM2 * 2 - 1)
kJ = 3 * kK - 2 * kD
// DMI (versi 通达信): TR, +DM, -DM dijumlah M1 bar; ADX = MA(|MDI-PDI| / (PDI+MDI) × 100, M2)
trRaw = math.max(math.max(high - low, math.abs(high - nz(close[1], close))), math.abs(low - nz(close[1], close)))
hd = high - nz(high[1], high)
ld = nz(low[1], low) - low
dmTR = mySum(trRaw, dmiM1)
pdi = dmTR > 0 ? mySum(hd > 0 and hd > ld ? hd : 0.0, dmiM1) * 100 / dmTR : 0.0
mdi = dmTR > 0 ? mySum(ld > 0 and ld > hd ? ld : 0.0, dmiM1) * 100 / dmTR : 0.0
adx = ta.sma(pdi + mdi > 0 ? math.abs(mdi - pdi) / (pdi + mdi) * 100 : 0.0, dmiM2)
// TAQ (Donchian / turtle): UP = HHV(H,N), DOWN = LLV(L,N)
taqUp = ta.highest(high, taqN)
taqDn = ta.lowest(low, taqN)

// ── sinyal ──
trendUp = close > bbi and bbi > bbi[1] and pdi > mdi and adx >= adxMin
trendDn = close < bbi and bbi < bbi[1] and mdi > pdi and adx >= adxMin
dipLong  = ta.lowest(kJ, dipBars) <= jLow
dipShort = ta.highest(kJ, dipBars) >= jHigh
sigLong  = ta.crossover(kK, kD) and dipLong and trendUp
sigShort = ta.crossunder(kK, kD) and dipShort and trendDn
`;

  const INPUTS = String.raw`
gB = "BBI & TAQ"
bbi1 = input.int(3, "BBI MA 1", minval = 1, group = gB)
bbi2 = input.int(6, "BBI MA 2", minval = 1, group = gB)
bbi3 = input.int(12, "BBI MA 3", minval = 1, group = gB)
bbi4 = input.int(20, "BBI MA 4", minval = 1, group = gB)
taqN = input.int(20, "TAQ (Donchian) N", minval = 2, group = gB)
gK = "KDJ"
kdjN  = input.int(9, "KDJ N", minval = 2, group = gK)
kdjM1 = input.int(3, "KDJ M1", minval = 1, group = gK)
kdjM2 = input.int(3, "KDJ M2", minval = 1, group = gK)
jLow  = input.float(20, "J jenuh jual (long)", group = gK, tooltip = "Long hanya jika J sempat turun ke bawah level ini (koreksi) dalam beberapa bar terakhir.")
jHigh = input.float(80, "J jenuh beli (short)", group = gK)
dipBars = input.int(5, "Bar untuk mencari koreksi J", minval = 1, group = gK)
gD = "DMI"
dmiM1  = input.int(14, "DMI M1", minval = 2, group = gD)
dmiM2  = input.int(6, "DMI M2 (ADX)", minval = 1, group = gD)
adxMin = input.float(20, "ADX minimum", minval = 0, group = gD, tooltip = "Tren dianggap cukup kuat jika ADX ≥ nilai ini.")
`;

  const indicator = String.raw`//@version=5
indicator("MyTT KDJ + DMI", overlay = false)
${INPUTS}
showDmi = input.bool(true, "Tampilkan PDI / MDI / ADX", group = gD)
${FORMULAS}
hline(80, "80", color = color.new(color.gray, 50), linestyle = hline.style_dashed)
hline(50, "50", color = color.new(color.gray, 70), linestyle = hline.style_dotted)
hline(20, "20", color = color.new(color.gray, 50), linestyle = hline.style_dashed)
plot(kK, "K", color = color.new(#f5f5f5, 0))
plot(kD, "D", color = color.new(#ffb300, 0))
plot(kJ, "J", color = color.new(#e040fb, 0))
plot(showDmi ? pdi : na, "PDI", color = color.new(#26a69a, 40))
plot(showDmi ? mdi : na, "MDI", color = color.new(#ef5350, 40))
plot(showDmi ? adx : na, "ADX", color = color.new(#2962ff, 20), linewidth = 2)
plotshape(sigLong, "Sinyal Long", shape.triangleup, location.bottom, color.new(#26a69a, 0), size = size.tiny)
plotshape(sigShort, "Sinyal Short", shape.triangledown, location.top, color.new(#ef5350, 0), size = size.tiny)
`;

  const strategy = String.raw`//@version=5
strategy("MyTT Trend Pullback", overlay = true, initial_capital = 1000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_value = 0.1, max_lines_count = 500, max_labels_count = 500, max_boxes_count = 500)

// Rumus BBI / KDJ / DMI / TAQ ala MyTT (通达信). Tambahkan indikator "MyTT KDJ + DMI" untuk melihat KDJ & DMI.
// Sinyal : tren naik (close > BBI, BBI naik, PDI > MDI, ADX ≥ min) + koreksi selesai
//          (J sempat < 20, lalu K memotong D ke atas). Short = kebalikannya.
// Entry  : close bar sinyal.
// SL     : di luar swing low/high koreksi (zona yang jika ditembus berarti tren gagal) + buffer ATR.
// TP     : zona resistance/support terdekat: pivot high/low, batas TAQ (Donchian),
//          lalu ekstensi Fibonacci dari swing bila zona di atasnya kosong.
// Keluar : 50% / 30% / sisa di TP1 / TP2 / TP3, SL ke BE setelah TP1,
//          setelah TP1 sisa ditutup jika close kembali menembus BBI (tren berakhir).
${INPUTS}
gR = "Zona SL & TP"
allowShort = input.bool(false, "Izinkan Short", group = gR)
swingLen = input.int(10, "Lookback swing (zona SL)", minval = 2, group = gR)
slBufATR = input.float(0.25, "Buffer SL (× ATR)", minval = 0, step = 0.05, group = gR)
pivLen   = input.int(5, "Panjang pivot (zona TP)", minval = 2, group = gR)
minRR1   = input.float(0.5, "Min R:R ke TP1", minval = 0, step = 0.1, group = gR, tooltip = "Setup dilewati jika zona TP terdekat terlalu dekat dibanding jarak SL.")
tp1Pct   = input.float(50, "TP1 Tutup %", minval = 5, maxval = 90, step = 5, group = gR)
tp2Pct   = input.float(30, "TP2 Tutup %", minval = 5, maxval = 90, step = 5, group = gR, tooltip = "Sisa posisi ditutup di TP3.")
moveBE   = input.bool(true, "SL ke Break-even setelah TP1", group = gR)
exitBBI  = input.bool(true, "Setelah TP1: tutup sisa saat close menembus BBI", group = gR)
riskPct  = input.float(1.0, "Risiko per trade (% equity)", minval = 0.1, maxval = 100, step = 0.1, group = gR, tooltip = "Ukuran posisi = risiko / jarak SL, dibatasi 100% equity.")
showPlan = input.bool(true, "Gambar zona & level", group = gR)
${FORMULAS}
atr = ta.atr(14)
plot(bbi, "BBI", color = color.new(#ffb300, 0), linewidth = 2)
plot(taqUp, "TAQ Atas", color = color.new(#26a69a, 60), style = plot.style_stepline)
plot(taqDn, "TAQ Bawah", color = color.new(#ef5350, 60), style = plot.style_stepline)
swingLo = ta.lowest(low, swingLen)
swingHi = ta.highest(high, swingLen)

// zona pivot high (resistance) & pivot low (support) yang sudah terkonfirmasi
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

// ── state trade ──
var int   tDir = 0
var bool  tLive = false
var int   tStage = 0
var float tE = na
var float tSL = na
var float tT1 = na
var float tT2 = na
var float tT3 = na
var float tQty = 0.0
var float tSwing = na
var int   nClosed = 0
pos = strategy.position_size
q1 = math.min(tp1Pct, 90)
q2 = math.min(tp2Pct, 95 - q1)
idOf(d) =>
    d > 0 ? "Long" : "Short"

closedNew = strategy.closedtrades > nClosed
nClosed := strategy.closedtrades
startedNow = false
endedNow = false
if tDir != 0 and not tLive and pos != 0
    tLive := true
    startedNow := true
if tDir != 0 and pos == 0 and (tLive or closedNew)
    // posisi selesai (termasuk yang terisi & tertutup di bar yang sama)
    startedNow := startedNow or not tLive
    tLive := false
    endedNow := true

// setup baru saat flat
newSetup = false
d0 = sigLong ? 1 : allowShort and sigShort ? -1 : 0
if pos == 0 and not endedNow and d0 != 0 and (tDir == 0 or not tLive)
    sl = d0 > 0 ? swingLo - slBufATR * atr : swingHi + slBufATR * atr
    e = close
    risk = (e - sl) * d0
    span = d0 > 0 ? taqUp - swingLo : swingHi - taqDn
    ext0 = d0 > 0 ? taqUp : taqDn
    cand = array.copy(d0 > 0 ? res : sup)
    array.push(cand, ext0)
    array.push(cand, ext0 + d0 * span * 0.272)
    array.push(cand, ext0 + d0 * span * 0.618)
    array.push(cand, ext0 + d0 * span * 1.0)
    array.push(cand, ext0 + d0 * span * 1.618)
    array.push(cand, ext0 + d0 * span * 2.618)
    t1 = nearestLvl(cand, e + d0 * 0.1 * atr, d0)
    t2 = na(t1) ? na : nearestLvl(cand, t1 + d0 * 0.5 * atr, d0)
    t3 = na(t2) ? na : nearestLvl(cand, t2 + d0 * 0.5 * atr, d0)
    if risk > 0 and not na(t3) and (t1 - e) * d0 / risk >= minRR1
        newSetup := true
        tDir := d0
        tStage := 0
        tE := e
        tSL := sl
        tT1 := t1
        tT2 := t2
        tT3 := t3
        tSwing := d0 > 0 ? swingLo : swingHi
        tQty := math.min(strategy.equity * riskPct / 100 / risk, strategy.equity / e)
        id = idOf(d0)
        strategy.entry(id, d0 > 0 ? strategy.long : strategy.short, qty = tQty)
        strategy.exit("TP1", id, qty_percent = q1, stop = sl, limit = t1)
        strategy.exit("TP2", id, qty_percent = q2, stop = sl, limit = t2)
        strategy.exit("TP3", id, qty_percent = 100, stop = sl, limit = t3)

// posisi berjalan: SL ke BE setelah TP1, tutup sisa saat tren (BBI) patah
slMoved = false
bbiExit = false
if tLive and pos != 0
    id = idOf(tDir)
    rem = math.abs(pos) / tQty
    stage = rem < 1 - (q1 + q2) / 100 + 0.001 ? 2 : rem < 1 - q1 / 100 + 0.001 ? 1 : 0
    if stage > tStage and moveBE and tStage == 0
        be = strategy.position_avg_price
        tSL := be
        slMoved := true
        if stage == 1
            strategy.exit("TP2", id, qty_percent = q2, stop = be, limit = tT2)
        strategy.exit("TP3", id, qty_percent = 100, stop = be, limit = tT3)
    tStage := math.max(tStage, stage)
    if exitBBI and tStage >= 1 and (tDir > 0 ? close < bbi : close > bbi)
        strategy.close(id, comment = "Tembus BBI")
        bbiExit := true
if endedNow
    tDir := 0

// ── gambar: zona SL, Entry, SL, TP1-3 ──
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
var int   dD = 0
var bool  h1 = false
var bool  h2 = false
var bool  h3 = false
var bool  hB = false
colE  = color.new(#2962ff, 0)
colSL = color.new(#ef5350, 0)
colTP = color.new(#26a69a, 0)
rTxt(y) =>
    r = math.abs(tE - tSL)
    v = r > 0 ? (y - tE) * dD / r : 0.0
    (v >= 0 ? "+" : "") + str.tostring(v, "#.##") + "R · " + str.tostring(y, format.mintick)
mkLine(y, c, st) =>
    line.new(bar_index, y, bar_index, y, color = c, style = st)
mkLabel(y, t, c) =>
    label.new(bar_index, y, t, color = color.new(c, 85), style = label.style_label_left, textcolor = c, size = size.tiny)

if showPlan
    if (tLive or endedNow) and not startedNow and dD != 0
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
    if (tLive or endedNow) and dD != 0
        if not h1 and (dD > 0 ? high >= tT1 : low <= tT1)
            h1 := true
            b1.set_text("TP1 ✓ " + str.tostring(q1, "#") + "% · " + str.tostring(tT1, format.mintick))
        if not h2 and (dD > 0 ? high >= tT2 : low <= tT2)
            h2 := true
            b2.set_text("TP2 ✓ " + str.tostring(q2, "#") + "% · " + str.tostring(tT2, format.mintick))
        if not h3 and (dD > 0 ? high >= tT3 : low <= tT3)
            h3 := true
            b3.set_text("TP3 ✓ sisa · " + str.tostring(tT3, format.mintick))
        if bbiExit
            hB := true
        if slMoved
            lS := mkLine(tSL, colSL, line.style_dashed)
            bS.set_y(tSL)
            bS.set_text("SL → BE · " + str.tostring(tSL, format.mintick))
        if endedNow and not h3
            bS.set_text(hB ? "Ditutup: tembus BBI" : (h1 ? "SL (sisa) ✕ · " : "SL ✕ · ") + str.tostring(tSL, format.mintick))
    if newSetup
        dD := tDir
        h1 := false
        h2 := false
        h3 := false
        hB := false
        slBox := box.new(bar_index, tSwing, bar_index, tSL, border_color = na, bgcolor = color.new(colSL, 82), text = "Zona SL (swing)", text_size = size.tiny, text_color = color.new(colSL, 30), text_halign = text.align_left)
        lE := mkLine(tE, colE, line.style_solid)
        lS := mkLine(tSL, colSL, line.style_solid)
        l1 := mkLine(tT1, colTP, line.style_dashed)
        l2 := mkLine(tT2, colTP, line.style_dashed)
        l3 := mkLine(tT3, colTP, line.style_solid)
        bE := mkLabel(tE, (tDir > 0 ? "BUY " : "SELL ") + str.tostring(tE, format.mintick), colE)
        bS := mkLabel(tSL, "SL · -1R · " + str.tostring(tSL, format.mintick), colSL)
        b1 := mkLabel(tT1, "TP1 " + str.tostring(q1, "#") + "% · " + rTxt(tT1), colTP)
        b2 := mkLabel(tT2, "TP2 " + str.tostring(q2, "#") + "% · " + rTxt(tT2), colTP)
        b3 := mkLabel(tT3, "TP3 sisa · " + rTxt(tT3), colTP)
`;

  const api = { indicator, strategy };
  root.LunaMyTT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
