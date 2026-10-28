/*
 * SATTAM | CRT + TBS — edisi Luna.
 * Satu sumber kode menghasilkan dua script: indikator (visual + statistik sinyal)
 * dan strategy (untuk Strategy Tester). Logika sinyal keduanya identik.
 */
(function (root) {
  'use strict';

  function build(isStrategy) {
    // versi strategy: visual minimal agar tidak dobel saat dipakai bersama indikatornya
    const vis = isStrategy ? 'false' : 'true';
    // default strategy hasil tuning ENAUSDT 15m (tools/tune-crt.js); indikator tetap memakai default umum
    const defModel = isStrategy ? '"CISD"' : 'S_ALL';
    const defKZ = isStrategy ? 'true' : 'false';
    const header = isStrategy
      ? 'strategy("SATTAM | CRT+TBS Strategy", overlay = true, initial_capital = 1000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_value = 0.1, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)'
      : 'indicator("SATTAM | CRT+TBS", overlay = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)';

    const strategyInputs = isStrategy ? String.raw`
g7 = "⑦  Strategy"
targetMode = input.string(S_SCALE, "Take Profit", options = [S_SCALE, S_T1, S_T2, S_RR], group = g7, tooltip = "Partial = tutup bertahap di TP1 / TP2 / TP3 (lihat grup ⑧). Mode lain menutup 100% di satu target.")
allowLong  = input.bool(true, "Allow Long", group = g7)
allowShort = input.bool(true, "Allow Short", group = g7)
riskPct    = input.float(1.0, "Risk per Trade (% equity)", minval = 0.1, maxval = 100, step = 0.1, group = g7, tooltip = "Ukuran posisi = risiko / jarak stop, dibatasi 100% equity (tanpa leverage).")
` : '';

    const strategyExec = isStrategy ? String.raw`
// ══════════════════════════════ Strategy ══════════════════════════════
riskQty(stop) =>
    math.min(strategy.equity * riskPct / 100 / math.abs(close - stop), strategy.equity / close)
scaleOut = targetMode == S_SCALE
q1 = math.min(tp1Pct, 90)
q2 = math.min(tp2Pct, 95 - q1)
var float eQty = 0.0
var int   eStage = 0
var float eT1 = na
var float eT2 = na
var float eT3 = na
if sigBear and allowShort and strategy.position_size == 0
    q = riskQty(bearStop)
    strategy.entry("CRT S", strategy.short, qty = q)
    if scaleOut
        eQty := q
        eStage := 0
        eT1 := bearTP1
        eT2 := bearTP2
        eT3 := bearTP3
        strategy.exit("TP1", "CRT S", qty_percent = q1, stop = bearStop, limit = bearTP1)
        strategy.exit("TP2", "CRT S", qty_percent = q2, stop = bearStop, limit = bearTP2)
        strategy.exit("TP3", "CRT S", qty_percent = 100, stop = bearStop, limit = bearTP3)
    else
        strategy.exit("XS", "CRT S", stop = bearStop, limit = targetMode == S_RR ? bearTP1 : targetMode == S_T1 ? bearT1 : bearT2)
if sigBull and allowLong and strategy.position_size == 0
    q = riskQty(bullStop)
    strategy.entry("CRT L", strategy.long, qty = q)
    if scaleOut
        eQty := q
        eStage := 0
        eT1 := bullTP1
        eT2 := bullTP2
        eT3 := bullTP3
        strategy.exit("TP1", "CRT L", qty_percent = q1, stop = bullStop, limit = bullTP1)
        strategy.exit("TP2", "CRT L", qty_percent = q2, stop = bullStop, limit = bullTP2)
        strategy.exit("TP3", "CRT L", qty_percent = 100, stop = bullStop, limit = bullTP3)
    else
        strategy.exit("XL", "CRT L", stop = bullStop, limit = targetMode == S_RR ? bullTP1 : targetMode == S_T1 ? bullT1 : bullT2)
// geser SL sisa posisi setelah TP1 / TP2 terisi (dibaca dari ukuran posisi yang tersisa)
if scaleOut and strategy.position_size != 0 and eQty > 0
    rem = math.abs(strategy.position_size) / eQty
    stage = rem < 1 - (q1 + q2) / 100 + 0.001 ? 2 : rem < 1 - q1 / 100 + 0.001 ? 1 : 0
    if stage > eStage and slMove != S_NONE
        fromId = strategy.position_size > 0 ? "CRT L" : "CRT S"
        be = strategy.position_avg_price
        if stage == 1
            strategy.exit("TP2", fromId, qty_percent = q2, stop = be, limit = eT2)
            strategy.exit("TP3", fromId, qty_percent = 100, stop = be, limit = eT3)
        else
            strategy.exit("TP3", fromId, qty_percent = 100, stop = slMove == S_BE_T1 ? eT1 : be, limit = eT3)
    eStage := math.max(eStage, stage)
` : '';
    // awal & akhir garis rencana: strategy mengikuti posisi sungguhan, indikator mengikuti sinyal
    const planBear = isStrategy ? 'sigBear and allowShort and strategy.position_size == 0' : 'sigBear and pDir == 0';
    const planBull = isStrategy ? 'sigBull and allowLong and strategy.position_size == 0 and not planStartBear' : 'sigBull and pDir == 0 and not planStartBear';
    const planFlat = isStrategy ? 'bar_index > pBar + 1 and strategy.position_size == 0' : 'false';

    return String.raw`//@version=6
${header}

// ══════════════════════════════════════════════════════════════════════════
//   SATTAM CRT + TBS  ·  edisi Luna
//   ①  Settings      ②  HTF Engine     ③  Key Levels    ④  TBS / Liquidity
//   ⑤  CRT Engine    ⑥  Entry Models   ⑦  Time Filter   ⑧  Drawing   ⑨  Table
//   +  Daily Bias · AMD Phase · 2H Donchian · Signal Outcome Stats
//
//   CRT (Candle Range Theory):
//     C1 = candle HTF sebelumnya (range).  C2 = candle HTF berjalan.
//     Bearish: C2 menembus high C1 (manipulasi) lalu close kembali di bawah high C1
//              → target EQ (50%) lalu low C1 (distribusi).  Bullish = kebalikannya.
//   Tipe CRT:
//     1 = sweep & reclaim di bar LTF yang sama (wick rejection / turtle soup)
//     2 = reclaim dalam ≤ "Max Bars" bar LTF setelah sweep
//     3 = CRT klasik 3-candle: C2 HTF sudah close kembali di dalam C1 → entry di C3
//     4 = C2 outside bar (menyapu dua sisi) tapi close di dalam C1 — kualitas terendah
//   Tidak repaint: candle HTF dibangun dari bar chart yang sudah close.
// ══════════════════════════════════════════════════════════════════════════


// ══════════════════════════════ ① Settings ══════════════════════════════
S_AUTO   = "Auto"
S_MANUAL = "Manual"
S_ALL    = "All"
S_WINTER = "Winter"
S_SUMMER = "Summer"
S_TOP_R  = "Top Right"
S_TOP_L  = "Top Left"
S_BOT_R  = "Bottom Right"
S_BOT_L  = "Bottom Left"
S_T1     = "T1 (50% Range)"
S_T2     = "T2 (Opposite Extreme)"
S_RR     = "Fixed R"
S_SCALE  = "TP1 / TP2 / TP3 (Partial)"
S_NONE   = "None"
S_BE     = "Break-even after TP1"
S_BE_T1  = "BE after TP1, TP1 after TP2"

g1 = "①  Higher Timeframe"
htfMode   = input.string(S_AUTO, "HTF Mode", options = [S_AUTO, S_MANUAL], group = g1, tooltip = "Auto = tabel pasangan timeframe: MN→1D · 1W→4H · 1D→1H · 4H→5M · 1H→1M")
htfManual = input.timeframe("240", "Manual HTF", group = g1)

g2 = "②  CRT Engine"
crtMaxWait   = input.int(4, "Max Bars to Await Reclaim", minval = 1, maxval = 12, group = g2)
crtShowBox   = input.bool(true, "Draw Range Box", group = g2)
crtShowType  = input.bool(true, "Show CRT Type (1–4)", group = g2)
crtShowRange = input.bool(${vis}, "Plot HTF Range (H / EQ / L)", group = g2)
crtClassic   = input.bool(true, "Detect Classic 3-Candle CRT (Type 3/4)", group = g2)
colBear      = input.color(color.new(#e53935, 0), "Bearish", inline = "cc", group = g2)
colBull      = input.color(color.new(#43a047, 0), "Bullish", inline = "cc", group = g2)

g3 = "③  Key Levels"
klRequire  = input.bool(true, "Require Key Level", group = g3, tooltip = "Level HTF yang disapu harus berdekatan dengan OHP/OLP, OB, atau FVG searah.")
klTolATR   = input.float(0.25, "Touch Tolerance (× ATR)", minval = 0.0, step = 0.05, group = g3)
klPivotLen = input.int(5, "Pivot Length for OHP / OLP", minval = 2, maxval = 20, group = g3)
klOBMult   = input.float(1.5, "Displacement Body Mult", minval = 1.0, step = 0.1, group = g3)
klMax      = input.int(12, "Max Zones", minval = 2, maxval = 40, group = g3)
klShowOHP  = input.bool(${vis}, "OHP  Old High", group = g3, tooltip = "Hanya tampilan. Semua zona tetap dipakai untuk sinyal.")
klShowOLP  = input.bool(${vis}, "OLP  Old Low", group = g3)
klShowOB   = input.bool(false, "OB  Order Block", group = g3)
klShowFVG  = input.bool(false, "FVG  Fair Value Gap", group = g3)

g4 = "④  TBS & Entry Models"
entryModel   = input.string(${defModel}, "Entry Model", options = [S_ALL, "Model #1", "CISD", "MSS+FVG"], group = g4)
tbsPivotLen  = input.int(3, "TBS Liquidity Pivot Length", minval = 1, maxval = 15, group = g4)
tbsRequire   = input.bool(false, "Require TBS on the Sweep", group = g4)
confirmClose = input.bool(true, "Confirmed Bars Only", group = g4)
minRR        = input.float(1.5, "Min Risk:Reward (to T2)", minval = 0.0, step = 0.1, group = g4)
slBufATR     = input.float(0.1, "Stop Buffer (× ATR)", minval = 0.0, step = 0.05, group = g4)
minStopATR   = input.float(0.5, "Min Stop Distance (× ATR)", minval = 0.0, step = 0.1, group = g4, tooltip = "Stop yang terlalu dekat mudah tersentuh wick & biaya komisi memakan sebagian besar R.")

g5 = "⑤  Filters"
useBias  = input.bool(false, "Trade With Daily Bias Only", group = g5)
useTime  = input.bool(${defKZ}, "Kill Zones Only (New York time)", group = g5)
dstMode  = input.string(S_AUTO, "Daylight Saving", options = [S_AUTO, S_WINTER, S_SUMMER], group = g5)
kzLondon = input.bool(true, "London 02:00–05:00", group = g5)
kzNyAm   = input.bool(true, "NY AM 07:00–10:00", group = g5)
kzNyPm   = input.bool(false, "NY PM 13:30–16:00", group = g5)

g6 = "⑥  Extras"
showDon    = input.bool(${vis}, "2H Donchian", group = g6)
donLen     = input.int(20, "Donchian Length (2H bars)", minval = 2, maxval = 200, group = g6)
showSweeps = input.bool(${vis}, "Mark Liquidity Sweeps (TBS)", group = g6)
showTrades = input.bool(true, "Draw Trade Plan (Entry · SL · TP1-3)", group = g6)
showTable  = input.bool(${vis}, "Show Table", group = g6)
tablePos   = input.string(S_TOP_R, "Table Position", options = [S_TOP_R, S_TOP_L, S_BOT_R, S_BOT_L], group = g6)

g8 = "⑧  Trade Plan"
tpR    = input.float(0.6, "Fixed R Multiple", minval = 0.2, step = 0.1, group = g8, tooltip = "TP1 = entry ± R × jarak stop. TP2 = EQ 50% range HTF (jika berjarak ≥ 0.25R dari TP1 & TP3, selain itu titik tengah TP1–TP3). TP3 = ujung range HTF seberang.")
tp1Pct = input.float(70, "TP1 Close %", minval = 5, maxval = 90, step = 5, group = g8)
tp2Pct = input.float(20, "TP2 Close %", minval = 5, maxval = 90, step = 5, group = g8, tooltip = "Sisa posisi ditutup di TP3.")
slMove = input.string(S_BE_T1, "Move SL After TP", options = [S_NONE, S_BE, S_BE_T1], group = g8)
${strategyInputs}

// ══════════════════════════════ ② HTF Engine ══════════════════════════════
autoHtf() =>
    s = timeframe.in_seconds()
    s <= 60 ? "60" : s <= 900 ? "240" : s <= 3600 ? "1D" : s <= 14400 ? "1W" : s <= 86400 ? "1M" : "3M"

htf      = htfMode == S_AUTO ? autoHtf() : htfManual
htfValid = timeframe.in_seconds(htf) > timeframe.in_seconds()
atr      = ta.atr(14)
tol      = klTolATR * nz(atr)
slBuf    = slBufATR * nz(atr)
canSignal = not confirmClose or barstate.isconfirmed

newHtf = htfValid and timeframe.change(htf)
// C0 = dua candle HTF lalu, C1 = candle HTF terakhir yang sudah close, C2 = candle HTF berjalan
var float c0H = na
var float c0L = na
var float c1H = na
var float c1L = na
var float c1C = na
var int   c1Start = na
var int   c0Start = na
var float c2H = na
var float c2L = na
var int   c2Start = na
if newHtf
    c0H := c1H
    c0L := c1L
    c0Start := c1Start
    c1H := c2H
    c1L := c2L
    c1C := close[1]
    c1Start := c2Start
    c2H := high
    c2L := low
    c2Start := bar_index
else if htfValid
    c2H := math.max(nz(c2H, high), high)
    c2L := math.min(nz(c2L, low), low)


// ══════════════════════════════ ③ Key Levels ══════════════════════════════
var zTop  = array.new_float()
var zBot  = array.new_float()
var zDir  = array.new_int()
var zBox  = array.new_box()
var zLine = array.new_line()

removeZone(k) =>
    box.delete(array.remove(zBox, k))
    line.delete(array.remove(zLine, k))
    array.remove(zTop, k)
    array.remove(zBot, k)
    array.remove(zDir, k)

addZone(top, bot, dir, kind, startBar) =>
    show = kind == "OHP" ? klShowOHP : kind == "OLP" ? klShowOLP : kind == "OB" ? klShowOB : klShowFVG
    col = dir < 0 ? colBear : colBull
    b = na
    l = na
    if show
        if top == bot
            l := line.new(startBar, top, bar_index, top, color = color.new(col, 35), style = line.style_dashed, extend = extend.right)
        else
            b := box.new(startBar, top, bar_index, bot, border_color = na, bgcolor = color.new(col, 86), extend = extend.right, text = kind, text_size = size.tiny, text_color = color.new(col, 25), text_halign = text.align_right)
    array.push(zTop, top)
    array.push(zBot, bot)
    array.push(zDir, dir)
    array.push(zBox, b)
    array.push(zLine, l)
    if array.size(zTop) > klMax
        removeZone(0)

// Apakah ada zona searah "dir" yang bersinggungan dengan rentang [lo, hi] (± toleransi)?
klHit(lo, hi, dir) =>
    hit = false
    n = array.size(zTop)
    if n > 0
        for k = 0 to n - 1
            if array.get(zDir, k) == dir and array.get(zTop, k) >= lo - tol and array.get(zBot, k) <= hi + tol
                hit := true
                break
    hit

// zona yang sudah ditembus (close di luar) dihapus
nZ = array.size(zTop)
if nZ > 0
    for k = nZ - 1 to 0
        zt = array.get(zTop, k)
        zb = array.get(zBot, k)
        broken = array.get(zDir, k) < 0 ? close > zt + tol : close < zb - tol
        if broken
            removeZone(k)

ph = ta.pivothigh(high, klPivotLen, klPivotLen)
pl = ta.pivotlow(low, klPivotLen, klPivotLen)
if not na(ph)
    addZone(ph, ph, -1, "OHP", bar_index - klPivotLen)
if not na(pl)
    addZone(pl, pl, 1, "OLP", bar_index - klPivotLen)

body     = math.abs(close - open)
avgBody  = ta.sma(body, 20)
dispBull = close > open and body > klOBMult * avgBody
dispBear = close < open and body > klOBMult * avgBody
if dispBull and close[1] < open[1]
    addZone(high[1], low[1], 1, "OB", bar_index - 1)
if dispBear and close[1] > open[1]
    addZone(high[1], low[1], -1, "OB", bar_index - 1)

fvgBull = low > high[2] and low - high[2] > 0.1 * nz(atr)
fvgBear = high < low[2] and low[2] - high > 0.1 * nz(atr)
if fvgBull
    addZone(low, high[2], 1, "FVG", bar_index - 2)
if fvgBear
    addZone(low[2], high, -1, "FVG", bar_index - 2)


// ══════════════════════════════ ④ TBS / Liquidity ══════════════════════════════
// TBS = wick menembus swing LTF terakhir tetapi BODY close kembali (likuiditas diambil)
swH = ta.pivothigh(high, tbsPivotLen, tbsPivotLen)
swL = ta.pivotlow(low, tbsPivotLen, tbsPivotLen)
var float liqH = na     // likuiditas di atas (swing high yang belum diambil)
var float liqL = na
var float structH = na  // swing terakhir untuk MSS (tidak dihapus saat diambil)
var float structL = na
tbsBear = not na(liqH) and high > liqH and math.max(open, close) < liqH
tbsBull = not na(liqL) and low < liqL and math.min(open, close) > liqL
if not na(liqH) and high > liqH
    liqH := na
if not na(liqL) and low < liqL
    liqL := na
if not na(swH)
    liqH := swH
    structH := swH
if not na(swL)
    liqL := swL
    structL := swL
plotshape(showSweeps and tbsBear, "TBS Bear", shape.xcross, location.abovebar, color.new(colBear, 35), size = size.tiny)
plotshape(showSweeps and tbsBull, "TBS Bull", shape.xcross, location.belowbar, color.new(colBull, 35), size = size.tiny)

// CISD: open candle pertama dari rangkaian candle searah terakhir
var float bullRunOpen = na
var float bearRunOpen = na
if close > open
    bullRunOpen := close[1] > open[1] ? bullRunOpen : open
if close < open
    bearRunOpen := close[1] < open[1] ? bearRunOpen : open


// ══════════════════════════════ ⑦ Time Filter & Daily Bias ══════════════════════════════
isUsDst() =>
    lastSun = dayofmonth - (dayofweek - 1)
    month > 3 and month < 11 ? true : month == 3 ? lastSun >= 8 : month == 11 ? lastSun < 1 : false

nyOff  = dstMode == S_SUMMER ? -4 : dstMode == S_WINTER ? -5 : isUsDst() ? -4 : -5
nyMin  = ((hour * 60 + minute + nyOff * 60) % 1440 + 1440) % 1440
inLon  = nyMin >= 120 and nyMin < 300
inNyAm = nyMin >= 420 and nyMin < 600
inNyPm = nyMin >= 810 and nyMin < 960
kzName = inLon ? "London" : inNyAm ? "NY AM" : inNyPm ? "NY PM" : "—"
timeOn = useTime and timeframe.isintraday and timeframe.in_seconds() <= 3600
timeOk = not timeOn or (kzLondon and inLon) or (kzNyAm and inNyAm) or (kzNyPm and inNyPm)
bgcolor(timeOn and timeOk ? color.new(color.gray, 93) : na)

newDay = timeframe.change("1D")
var float dH = na
var float dL = na
var float pdH = na
var float pdL = na
var float pdC = na
var float ppdH = na
var float ppdL = na
if newDay
    ppdH := pdH
    ppdL := pdL
    pdH := dH
    pdL := dL
    pdC := close[1]
    dH := high
    dL := low
else
    dH := math.max(nz(dH, high), high)
    dL := math.min(nz(dL, low), low)
// +1 bullish / -1 bearish / 0 netral, dari candle harian kemarin terhadap hari sebelumnya
bias = na(ppdH) ? 0 : pdC > ppdH ? 1 : pdC < ppdL ? -1 : pdL < ppdL and pdC > ppdL ? 1 : pdH > ppdH and pdC < ppdH ? -1 : 0


// ══════════════════════════════ ⑤ CRT Engine ══════════════════════════════
// state: 0 menunggu · 1 sweep (menunggu reclaim) · 2 armed · 3 selesai / gagal
var int   bearState = 0
var int   bullState = 0
var float bearRH = na
var float bearRL = na
var float bullRH = na
var float bullRL = na
var float bearExt = na
var float bullExt = na
var int   bearSweepBar = na
var int   bullSweepBar = na
var int   bearArmBar = na
var int   bullArmBar = na
var int   bearStart = na
var int   bullStart = na
var int   bearType = na
var int   bullType = na
var bool  bearKL = false
var bool  bullKL = false
var bool  bearTBS = false
var bool  bullTBS = false
var float bearCISD = na
var float bullCISD = na
var float bearMSS = na
var float bullMSS = na
var bool  bearM1 = false
var bool  bearCi = false
var bool  bearMs = false
var bool  bullM1 = false
var bool  bullCi = false
var bool  bullMs = false
var box   bearBox = na
var box   bullBox = na
armBear = false
armBull = false

if newHtf
    bearState := 0
    bullState := 0
    bearM1 := false
    bearCi := false
    bearMs := false
    bullM1 := false
    bullCi := false
    bullMs := false

// CRT klasik: C1 (baru close) menyapu C0 lalu close kembali di dalam C0 → siap di C3
if newHtf and crtClassic and not na(c0H) and not na(c1C)
    sweptH = c1H > c0H
    sweptL = c1L < c0L
    inside = c1C < c0H and c1C > c0L
    eq0 = (c0H + c0L) / 2
    if inside and sweptH and (not sweptL or c1C < eq0)
        bearState := 2
        bearRH := c0H
        bearRL := c0L
        bearExt := c1H
        bearStart := c0Start
        bearSweepBar := bar_index
        bearArmBar := bar_index
        bearType := sweptL ? 4 : 3
        bearKL := klHit(c0H, c1H, -1)
        bearTBS := true
        bearCISD := bullRunOpen
        bearMSS := structL
        armBear := true
    if inside and sweptL and (not sweptH or c1C >= eq0)
        bullState := 2
        bullRH := c0H
        bullRL := c0L
        bullExt := c1L
        bullStart := c0Start
        bullSweepBar := bar_index
        bullArmBar := bar_index
        bullType := sweptH ? 4 : 3
        bullKL := klHit(c1L, c0L, 1)
        bullTBS := true
        bullCISD := bearRunOpen
        bullMSS := structH
        armBull := true

// CRT intra-candle: C2 menyapu high/low C1
if htfValid and bearState == 0 and not na(c1H) and high > c1H
    bearState := 1
    bearSweepBar := bar_index
    bearExt := high
    bearRH := c1H
    bearRL := c1L
    bearStart := c1Start
    bearCISD := bullRunOpen
    bearMSS := structL
    bearKL := klHit(c1H, high, -1)
    bearTBS := tbsBear
if htfValid and bullState == 0 and not na(c1L) and low < c1L
    bullState := 1
    bullSweepBar := bar_index
    bullExt := low
    bullRH := c1H
    bullRL := c1L
    bullStart := c1Start
    bullCISD := bearRunOpen
    bullMSS := structH
    bullKL := klHit(low, c1L, 1)
    bullTBS := tbsBull

if bearState == 1
    if high > bearExt
        bearExt := high
        bearCISD := bullRunOpen
        bearKL := bearKL or klHit(bearRH, high, -1)
    bearTBS := bearTBS or tbsBear
    if close < bearRH
        bearState := 2
        bearType := bar_index == bearSweepBar ? 1 : 2
        bearArmBar := bar_index
        armBear := true
    else if bar_index - bearSweepBar >= crtMaxWait
        bearState := 3
if bullState == 1
    if low < bullExt
        bullExt := low
        bullCISD := bearRunOpen
        bullKL := bullKL or klHit(low, bullRL, 1)
    bullTBS := bullTBS or tbsBull
    if close > bullRL
        bullState := 2
        bullType := bar_index == bullSweepBar ? 1 : 2
        bullArmBar := bar_index
        armBull := true
    else if bar_index - bullSweepBar >= crtMaxWait
        bullState := 3

// setup armed batal jika ekstrem manipulasi ditembus, atau target sudah tercapai tanpa entry
if bearState == 2 and not armBear and (high > bearExt or low <= bearRL)
    bearState := 3
if bullState == 2 and not armBull and (low < bullExt or high >= bullRH)
    bullState := 3


// ══════════════════════════════ ⑥ Entry Models ══════════════════════════════
wantM1 = entryModel == S_ALL or entryModel == "Model #1"
wantCi = entryModel == S_ALL or entryModel == "CISD"
wantMs = entryModel == S_ALL or entryModel == "MSS+FVG"
fvgBearRecent = fvgBear or fvgBear[1] or fvgBear[2]
fvgBullRecent = fvgBull or fvgBull[1] or fvgBull[2]

minStop  = minStopATR * nz(atr)
bearStop = math.max(bearExt + slBuf, close + minStop)
bearT1   = (bearRH + bearRL) / 2
bearT2   = bearRL
bullStop = math.min(bullExt - slBuf, close - minStop)
bullT1   = (bullRH + bullRL) / 2
bullT2   = bullRH
// rencana TP berjenjang: TP1 = R tetap · TP2 = EQ (50%) · TP3 = ujung range seberang
bearTP1  = close - tpR * (bearStop - close)
bearTP3  = math.min(bearT2, bearTP1)
bearGap  = 0.25 * (bearStop - close)
bearTP2  = bearT1 < bearTP1 - bearGap and bearT1 > bearTP3 + bearGap ? bearT1 : (bearTP1 + bearTP3) / 2
bullTP1  = close + tpR * (close - bullStop)
bullTP3  = math.max(bullT2, bullTP1)
bullGap  = 0.25 * (close - bullStop)
bullTP2  = bullT1 > bullTP1 + bullGap and bullT1 < bullTP3 - bullGap ? bullT1 : (bullTP1 + bullTP3) / 2
bearRR   = bearStop > close and close > bearT2 ? (close - bearT2) / (bearStop - close) : 0.0
bullRR   = bullStop < close and close < bullT2 ? (bullT2 - close) / (close - bullStop) : 0.0

gateBear = bearState == 2 and canSignal and timeOk and (not klRequire or bearKL) and (not tbsRequire or bearTBS) and (not useBias or bias < 0) and bearRR >= minRR
gateBull = bullState == 2 and canSignal and timeOk and (not klRequire or bullKL) and (not tbsRequire or bullTBS) and (not useBias or bias > 0) and bullRR >= minRR

sigBear = false
sigBull = false
nameBear = ""
nameBull = ""
if gateBear
    if wantM1 and not bearM1 and bar_index == bearArmBar
        bearM1 := true
        sigBear := true
        nameBear := "M1"
    if wantCi and not bearCi and not na(bearCISD) and close < bearCISD
        bearCi := true
        sigBear := true
        nameBear := nameBear == "" ? "CISD" : nameBear + "+CISD"
    if wantMs and not bearMs and not na(bearMSS) and close < bearMSS and fvgBearRecent
        bearMs := true
        sigBear := true
        nameBear := nameBear == "" ? "MSS" : nameBear + "+MSS"
if gateBull
    if wantM1 and not bullM1 and bar_index == bullArmBar
        bullM1 := true
        sigBull := true
        nameBull := "M1"
    if wantCi and not bullCi and not na(bullCISD) and close > bullCISD
        bullCi := true
        sigBull := true
        nameBull := nameBull == "" ? "CISD" : nameBull + "+CISD"
    if wantMs and not bullMs and not na(bullMSS) and close > bullMSS and fvgBullRecent
        bullMs := true
        sigBull := true
        nameBull := nameBull == "" ? "MSS" : nameBull + "+MSS"


// ══════════════════════════════ ⑧ Drawing ══════════════════════════════
crtTag(t, kl) =>
    (crtShowType ? " T" + str.tostring(t) : "") + (kl ? " · KL" : "")

if armBear
    if crtShowBox
        bearBox := box.new(bearStart, bearRH, bar_index, bearRL, border_color = color.new(colBear, 40), border_width = 1, bgcolor = color.new(colBear, 92), text = "CRT ▼" + crtTag(bearType, bearKL), text_size = size.small, text_color = color.new(colBear, 10), text_halign = text.align_left, text_valign = text.align_top)
    label.new(bearSweepBar, bearExt, "▼", color = na, style = label.style_label_down, textcolor = colBear, size = size.small)
if armBull
    if crtShowBox
        bullBox := box.new(bullStart, bullRH, bar_index, bullRL, border_color = color.new(colBull, 40), border_width = 1, bgcolor = color.new(colBull, 92), text = "CRT ▲" + crtTag(bullType, bullKL), text_size = size.small, text_color = color.new(colBull, 10), text_halign = text.align_left, text_valign = text.align_bottom)
    label.new(bullSweepBar, bullExt, "▲", color = na, style = label.style_label_up, textcolor = colBull, size = size.small)
if bearState == 2 and not na(bearBox)
    bearBox.set_right(bar_index)
if bullState == 2 and not na(bullBox)
    bullBox.set_right(bar_index)

if sigBear
    label.new(bar_index, high, "SELL " + nameBear + "\nRR " + str.tostring(bearRR, "#.##"), color = colBear, style = label.style_label_down, textcolor = color.white, size = size.small)
if sigBull
    label.new(bar_index, low, "BUY " + nameBull + "\nRR " + str.tostring(bullRR, "#.##"), color = colBull, style = label.style_label_up, textcolor = color.white, size = size.small)

plot(crtShowRange and htfValid and not newHtf ? c1H : na, "HTF High", color = color.new(colBear, 45), style = plot.style_linebr)
plot(crtShowRange and htfValid and not newHtf ? (c1H + c1L) / 2 : na, "HTF EQ", color = color.new(color.gray, 40), style = plot.style_linebr)
plot(crtShowRange and htfValid and not newHtf ? c1L : na, "HTF Low", color = color.new(colBull, 45), style = plot.style_linebr)

// 2H Donchian dari candle 2 jam yang sudah close (tidak repaint)
new2h = timeframe.change("120")
var h2Hi = array.new_float()
var h2Lo = array.new_float()
var float cur2H = na
var float cur2L = na
if new2h
    if not na(cur2H)
        array.push(h2Hi, cur2H)
        array.push(h2Lo, cur2L)
        if array.size(h2Hi) > donLen
            array.shift(h2Hi)
            array.shift(h2Lo)
    cur2H := high
    cur2L := low
else
    cur2H := math.max(nz(cur2H, high), high)
    cur2L := math.min(nz(cur2L, low), low)
donUp = array.size(h2Hi) >= donLen ? array.max(h2Hi) : na
donDn = array.size(h2Lo) >= donLen ? array.min(h2Lo) : na
plot(showDon ? donUp : na, "Donchian 2H Up", color = color.new(color.aqua, 55))
plot(showDon ? (donUp + donDn) / 2 : na, "Donchian 2H Mid", color = color.new(color.aqua, 75), style = plot.style_circles)
plot(showDon ? donDn : na, "Donchian 2H Down", color = color.new(color.aqua, 55))


// ══════════════════════ Statistik hasil sinyal (T2 vs SL, konservatif) ══════════════════════
var int   tDir = 0
var float tStop = na
var float tT1 = na
var float tT2 = na
var bool  tGotT1 = false
var int   sWin = 0
var int   sLoss = 0
var int   sT1 = 0
var int   sTotal = 0
if tDir != 0
    hitSL = tDir < 0 ? high >= tStop : low <= tStop
    hitT2 = tDir < 0 ? low <= tT2 : high >= tT2
    hitT1 = tDir < 0 ? low <= tT1 : high >= tT1
    if hitT1 and not tGotT1
        tGotT1 := true
        sT1 += 1
    if hitSL
        sLoss += 1
        tDir := 0
    else if hitT2
        sWin += 1
        tDir := 0
if (sigBear or sigBull) and tDir == 0
    tDir := sigBear ? -1 : 1
    tStop := sigBear ? bearStop : bullStop
    tT1 := sigBear ? bearT1 : bullT1
    tT2 := sigBear ? bearT2 : bullT2
    tGotT1 := false
    sTotal += 1
${strategyExec}
// ══════════════════ Garis rencana trade: Entry · SL · TP1 · TP2 · TP3 ══════════════════
var int   pDir = 0
var int   pBar = 0
var int   pStage = 0
var float pEntry = na
var float pRisk = na
var float pSL = na
var float pTP1 = na
var float pTP2 = na
var float pTP3 = na
var line  lnE = na
var line  lnSL = na
var line  lnT1 = na
var line  lnT2 = na
var line  lnT3 = na
var label lbE = na
var label lbSL = na
var label lbT1 = na
var label lbT2 = na
var label lbT3 = na
colEntry = color.new(#2962ff, 0)
colTP    = color.new(#26a69a, 0)
planLine(y, c, st) =>
    line.new(bar_index, y, bar_index, y, color = c, style = st, width = 1)
planLabel(y, t, c) =>
    label.new(bar_index, y, t, color = color.new(c, 85), style = label.style_label_left, textcolor = c, size = size.tiny)
rTxt(y, e, r) =>
    v = (y - e) * pDir / r
    (v >= 0 ? "+" : "") + str.tostring(v, "#.##") + "R · " + str.tostring(y, format.mintick)

planStartBear = ${planBear}
planStartBull = ${planBull}
if pDir != 0 and bar_index > pBar
    up = pDir > 0
    hitSL = up ? low <= pSL : high >= pSL
    hit1 = up ? high >= pTP1 : low <= pTP1
    hit2 = up ? high >= pTP2 : low <= pTP2
    hit3 = up ? high >= pTP3 : low <= pTP3
    newSL = pSL
    done = ${planFlat}
    if hitSL
        done := true
        lbSL.set_text((pStage > 0 ? "SL (sisa) ✕ " : "SL ✕ ") + rTxt(pSL, pEntry, pRisk))
    else
        if hit1 and pStage < 1
            pStage := 1
            lbT1.set_text("TP1 ✓ " + str.tostring(tp1Pct, "#") + "% · " + rTxt(pTP1, pEntry, pRisk))
            if slMove != S_NONE
                newSL := pEntry
        if hit2 and pStage < 2
            pStage := 2
            lbT2.set_text("TP2 ✓ " + str.tostring(tp2Pct, "#") + "% · " + rTxt(pTP2, pEntry, pRisk))
            if slMove == S_BE_T1
                newSL := pTP1
        if hit3
            done := true
            lbT3.set_text("TP3 ✓ sisa · " + rTxt(pTP3, pEntry, pRisk))
    lnE.set_x2(bar_index)
    lnSL.set_x2(bar_index)
    lnT1.set_x2(bar_index)
    lnT2.set_x2(bar_index)
    lnT3.set_x2(bar_index)
    lbE.set_x(bar_index)
    lbSL.set_x(bar_index)
    lbT1.set_x(bar_index)
    lbT2.set_x(bar_index)
    lbT3.set_x(bar_index)
    if newSL != pSL and not done
        pSL := newSL
        lnSL := planLine(pSL, colBear, line.style_dashed)
        lbSL.set_y(pSL)
        lbSL.set_text((pStage >= 2 and slMove == S_BE_T1 ? "SL → TP1 · " : "SL → BE · ") + str.tostring(pSL, format.mintick))
    if done
        pDir := 0
if showTrades and (planStartBear or planStartBull)
    pDir := planStartBear ? -1 : 1
    pBar := bar_index
    pStage := 0
    pEntry := close
    pSL := planStartBear ? bearStop : bullStop
    pRisk := math.abs(pEntry - pSL)
    pTP1 := planStartBear ? bearTP1 : bullTP1
    pTP2 := planStartBear ? bearTP2 : bullTP2
    pTP3 := planStartBear ? bearTP3 : bullTP3
    lnE := planLine(pEntry, colEntry, line.style_solid)
    lnSL := planLine(pSL, colBear, line.style_solid)
    lnT1 := planLine(pTP1, colTP, line.style_dashed)
    lnT2 := planLine(pTP2, colTP, line.style_dashed)
    lnT3 := planLine(pTP3, colTP, line.style_solid)
    lbE := planLabel(pEntry, (planStartBear ? "SELL " : "BUY ") + str.tostring(pEntry, format.mintick), colEntry)
    lbSL := planLabel(pSL, "SL · -1R · " + str.tostring(pSL, format.mintick), colBear)
    lbT1 := planLabel(pTP1, "TP1 " + str.tostring(tp1Pct, "#") + "% · " + rTxt(pTP1, pEntry, pRisk), colTP)
    lbT2 := planLabel(pTP2, "TP2 " + str.tostring(tp2Pct, "#") + "% · " + rTxt(pTP2, pEntry, pRisk), colTP)
    lbT3 := planLabel(pTP3, "TP3 sisa · " + rTxt(pTP3, pEntry, pRisk), colTP)

// ══════════════════════════════ ⑨ Table ══════════════════════════════
tbPos = switch tablePos
    S_TOP_L => position.top_left
    S_BOT_R => position.bottom_right
    S_BOT_L => position.bottom_left
    => position.top_right
var tb = table.new(tbPos, 2, 8, bgcolor = color.new(#131722, 8), border_color = color.new(#2a2e39, 0), border_width = 1)

stateText(s) =>
    s == 0 ? "Waiting" : s == 1 ? "Sweep → wait close" : s == 2 ? "Armed" : "Done / Failed"
row(r, k, v, c) =>
    table.cell(tb, 0, r, k, text_color = color.gray, text_halign = text.align_left, text_size = size.small)
    table.cell(tb, 1, r, v, text_color = c, text_halign = text.align_right, text_size = size.small)

phase = not htfValid ? "—" : bearState == 2 or bullState == 2 ? "Distribution" : bearState == 1 or bullState == 1 ? "Manipulation" : bearState == 3 or bullState == 3 ? "Expansion" : "Accumulation"
closedN = sWin + sLoss
if showTable
    row(0, "HTF", htfValid ? htf : "chart ≥ HTF", color.white)
    row(1, "Daily Bias", bias > 0 ? "Bullish ▲" : bias < 0 ? "Bearish ▼" : "Neutral", bias > 0 ? colBull : bias < 0 ? colBear : color.gray)
    row(2, "AMD Phase", phase, color.white)
    row(3, "Bear CRT", stateText(bearState), bearState == 2 ? colBear : color.gray)
    row(4, "Bull CRT", stateText(bullState), bullState == 2 ? colBull : color.gray)
    row(5, "Kill Zone", kzName, kzName == "—" ? color.gray : color.yellow)
    row(6, "Signals W/L", str.tostring(sWin) + " / " + str.tostring(sLoss) + (closedN > 0 ? "  (" + str.tostring(100 * sWin / closedN, "#") + "%)" : ""), color.white)
    row(7, "T1 Hit", sTotal > 0 ? str.tostring(100 * sT1 / sTotal, "#") + "%" : "—", color.white)

alertcondition(sigBear, "CRT Bearish Signal", "SATTAM CRT: bearish entry")
alertcondition(sigBull, "CRT Bullish Signal", "SATTAM CRT: bullish entry")
`;
  }

  const api = { indicator: build(false), strategy: build(true) };
  root.LunaCRT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
