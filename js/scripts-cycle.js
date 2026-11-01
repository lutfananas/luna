/*
 * Cycle Low (DCL / WCL) — teori siklus Hurst / Bob Loukas, TANPA REPAINT.
 * Label DCL/WCL ditulis saat terkonfirmasi dan tidak pernah dipindah/dihapus.
 * Proyeksi (pudar) = prediksi waktu & harga DCL / WCL berikutnya.
 */
(function (root) {
  'use strict';

  // Daftar kejadian (tanggal UTC). k: 0 = peristiwa besar (guncangan, halving, pemilu), 1 = FOMC, 2 = unlock ENA.
  // Diverifikasi dari pemberitaan; tanggal unlock ENA & FOMC Des 2026 = perkiraan.
  const EVENTS = [
    ['2020-03-12', 0, '📉 COVID', 'Crash pandemi COVID-19 (Black Thursday)'],
    ['2020-05-11', 0, '₿ Halving', 'Bitcoin halving ke-3'],
    ['2022-02-24', 0, '⚔ Rusia–Ukraina', 'Rusia menginvasi Ukraina'],
    ['2022-05-09', 0, '💥 LUNA', 'Runtuhnya Terra/LUNA & stablecoin UST'],
    ['2022-11-08', 0, '💥 FTX', 'Runtuhnya bursa FTX'],
    ['2023-03-10', 0, '🏦 SVB', 'Bank SVB runtuh, USDC sempat depeg'],
    ['2024-04-13', 0, '⚔ Iran→Israel', 'Iran menyerang Israel dengan drone & rudal'],
    ['2024-04-19', 0, '⚔ Israel→Iran', 'Israel membalas serangan ke Iran'],
    ['2024-04-20', 0, '₿ Halving', 'Bitcoin halving ke-4'],
    ['2024-08-05', 0, '📉 Yen carry', 'Unwind yen carry trade, crash pasar global'],
    ['2024-10-01', 0, '⚔ Rudal Iran', 'Iran menembakkan rudal ke Israel'],
    ['2024-11-05', 0, '🗳 Pemilu AS', 'Pemilihan presiden AS'],
    ['2025-01-27', 0, '📉 DeepSeek', 'DeepSeek memicu aksi jual saham AI'],
    ['2025-02-21', 0, '🔓 Hack Bybit', 'Bursa Bybit diretas ±$1,5 miliar'],
    ['2025-04-02', 0, '🏛 Tarif AS', 'Tarif "Liberation Day" AS → crash sampai 7 April'],
    ['2025-06-13', 0, '⚔ Israel→Iran', 'Israel menyerang Iran'],
    ['2025-06-22', 0, '⚔ AS→Iran', 'AS menyerang situs nuklir Iran'],
    ['2025-10-10', 0, '🏛 Tarif China', 'Ancaman tarif 100% ke China → likuidasi $19 miliar; USDe sempat depeg di Binance'],
    ['2026-02-05', 0, '📉 Likuidasi', 'Likuidasi paksa (dana Hong Kong), BTC sempat ke $60 ribu'],
    ['2026-06-09', 0, '⚔ AS→Iran', 'Serangan AS ke Iran (9–11 Juni)'],
    ['2026-09-24', 0, '🔓 Hack Bitget', 'Bursa Bitget diretas ±$352 juta'],
    ['2026-10-09', 0, '📉 Deleveraging', 'Gelombang likuidasi long, BTC turun ke ±$77 ribu'],
  ];
  for (const d of ['2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18', '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10', '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']) EVENTS.push([d, 1, '🏦 FOMC', 'Keputusan suku bunga The Fed (FOMC)' + (d === '2026-12-09' ? ' — tanggal perkiraan' : '')]);
  for (let m = 0; m < 18; m++) EVENTS.push([new Date(Date.UTC(2025, 3 + m, 2)).toISOString().slice(0, 10), 2, '🔑 Unlock', 'Unlock token ENA bulanan (tanggal perkiraan)']);
  EVENTS.push(['2026-10-05', 2, '🔑 Unlock', 'Pelepasan terakhir porsi investor ENA (dilaporkan; setelah buyback 27 Agu 2026)']);
  EVENTS.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const q = (t) => '"' + String(t).replace(/"/g, "'") + '"';
  const NEWS = String.raw`
// ── News: penanda kejadian di atas candle (tanggal UTC) ──
gN = "News"
showBig  = input.bool(true, "Peristiwa besar (perang, hack, krisis, halving, pemilu)", group = gN)
showFomc = input.bool(false, "FOMC (rapat suku bunga The Fed)", group = gN)
showUnl  = input.bool(false, "Unlock token ENA", group = gN)
var evT  = array.from(` + EVENTS.map((e) => Date.parse(e[0] + 'T00:00:00Z')).join(', ') + String.raw`)
var evK  = array.from(` + EVENTS.map((e) => e[1]).join(', ') + String.raw`)
var evS  = array.from(` + EVENTS.map((e) => q(e[2])).join(', ') + String.raw`)
var evL  = array.from(` + EVENTS.map((e) => q(e[0] + ' · ' + e[3])).join(', ') + String.raw`)
evOn(k) =>
    k == 0 ? showBig : k == 1 ? showFomc : showUnl
evCol(k) =>
    k == 0 ? color.new(#9c27b0, 15) : k == 1 ? color.new(#5d6b8a, 15) : color.new(#00838f, 15)
tfMs = timeframe.in_seconds() * 1000
var int evI = 0
// lewati kejadian sebelum data dimulai
if bar_index == 0
    while evI < array.size(evT) and array.get(evT, evI) < time
        evI += 1
while evI < array.size(evT) and array.get(evT, evI) < time + tfMs
    k = array.get(evK, evI)
    if evOn(k)
        label.new(bar_index, high, array.get(evS, evI), yloc = yloc.abovebar, style = label.style_label_down, color = evCol(k), textcolor = color.white, size = size.tiny, tooltip = array.get(evL, evI))
    evI += 1
// kejadian terjadwal yang akan datang (di area masa depan chart)
var futureNews = array.new_label()
if barstate.islast
    for l in futureNews
        label.delete(l)
    array.clear(futureNews)
    if evI < array.size(evT)
        for j = evI to array.size(evT) - 1
            k = array.get(evK, j)
            if evOn(k)
                array.push(futureNews, label.new(bar_index + math.max(1, math.round((array.get(evT, j) - time) / tfMs)), high * 1.03, array.get(evS, j), style = label.style_label_down, color = color.new(evCol(k), 60), textcolor = color.white, size = size.tiny, tooltip = array.get(evL, j) + " (akan datang)"))
`;

  const indicator = String.raw`//@version=5
indicator("Cycle Low (DCL / WCL)", overlay = true, max_labels_count = 500, max_boxes_count = 50, max_lines_count = 50)
// News: penanda peristiwa besar / FOMC / unlock ENA di atas candle (grup \"News\").

// Teori siklus (J.M. Hurst, dipopulerkan di kripto oleh Bob Loukas) — TANPA REPAINT.
// Candle diproses dari kiri ke kanan seperti saat live; label yang sudah ditulis tidak pernah berubah.
// DCL : kandidat = low terendah (sekaligus low terendah 10 hari) setelah DCL sebelumnya + 40 hari,
//       atau setelah 20 hari jika menembus DCL sebelumnya (failed cycle, merah).
//       Terkonfirmasi saat candle tutup di atas high hari sebelumnya DAN di atas MA 10 hari.
// WCL : DCL terdalam setelah WCL sebelumnya + 16 minggu (atau yang menembus WCL sebelumnya).
//       Ditulis saat DCL berikutnya membentuk low yang lebih tinggi.
// Proyeksi (pudar, dihitung ulang di candle terakhir):
//       waktu = DCL/WCL terakhir + median durasi siklus; kotak = timing band.
//       harga = close di candle pertama timing band × (1 − median penurunan historis dari titik
//       itu ke low siklus); TERKUNCI sejak awal band. Sebelum band = "sementara" (ikut close terakhir).
//       zona harga = kuartil 25–75% penurunan historis (± separuh kasus jatuh di zona ini).
// Durasi dalam hari, otomatis dikonversi ke jumlah bar timeframe chart (paling pas di 1D).
// Ini kerangka analisis, bukan aturan pasti — durasi & kedalaman siklus bisa berbeda.

gP = "Preset"
preset = input.string("Auto", "Preset", options = ["Auto", "Manual (pakai input di bawah)", "ENAUSDT (hasil tuning)"], group = gP, tooltip = "Auto: chart ENAUSDT memakai setelan hasil tuning ENA (durasi minimum siklus 35 hari); koin lain memakai input di bawah.")
gD = "Daily Cycle (DCL)"
dMin    = input.int(40, "Durasi minimum siklus (hari)", minval = 5, group = gD)
dMax    = input.int(70, "Batas akhir timing band (hari)", minval = 10, group = gD)
dAvg0   = input.int(60, "Durasi awal (sebelum ada data siklus)", minval = 5, group = gD)
dDrop0  = input.float(8, "Penurunan awal awal-band→DCL (%)", minval = 0, group = gD, tooltip = "Dipakai sampai ada 3 siklus terkonfirmasi.")
failDays = input.int(20, "Failed cycle: siklus baru paling cepat (hari)", minval = 1, group = gD, tooltip = "Low yang menembus DCL sebelumnya baru dihitung sebagai siklus baru (failed) setelah N hari.")
dipDays = input.int(10, "Kandidat = low terendah N hari", minval = 2, group = gD)
maDays  = input.int(10, "MA konfirmasi (hari)", minval = 2, group = gD)
gW = "Weekly Cycle (WCL)"
wMin   = input.int(16, "Durasi minimum siklus (minggu)", minval = 2, group = gW)
wMax   = input.int(30, "Batas akhir timing band (minggu)", minval = 3, group = gW)
wAvg0  = input.int(23, "Durasi awal (minggu)", minval = 2, group = gW)
wDrop0 = input.float(12, "Penurunan awal awal-band→WCL (%)", minval = 0, group = gW)
gS = "Tampilan"
showProj = input.bool(true, "Prediksi DCL & WCL berikutnya", group = gS)
showMA   = input.bool(false, "Tampilkan MA konfirmasi", group = gS)
colD     = input.color(color.new(#26a69a, 0), "Warna DCL", group = gS)
colW     = input.color(color.new(#ff9800, 0), "Warna WCL", group = gS)
colFail  = input.color(color.new(#ef5350, 0), "Warna failed cycle", group = gS)

// hari → jumlah bar di timeframe chart
bpd = 86400.0 / timeframe.in_seconds()
toBars(d) =>
    math.max(1, math.round(d * bpd))
// preset ENAUSDT: hasil tuning data ENA 1D (tuning Apr 2024–Des 2025, verifikasi Des 2025–Nov 2026)
isEna = preset == "ENAUSDT (hasil tuning)" or (preset == "Auto" and str.contains(syminfo.ticker, "ENAUSDT"))
dGap = toBars(isEna ? 35 : dMin)
dEnd = toBars(dMax)
wGap = toBars(wMin * 7)
wEnd = toBars(wMax * 7)
ma = ta.sma(close, math.max(2, toBars(maDays)))
dayHigh = ta.highest(high, toBars(1))
prevDayHigh = dayHigh[1]
dipLow = ta.lowest(low, toBars(dipDays))
plot(showMA ? ma : na, "MA konfirmasi", color = color.new(color.gray, 30))

fmtP(p) =>
    p >= 1000 ? str.tostring(math.round(p)) : p >= 1 ? str.tostring(p, "#.##") : str.tostring(p, "#.######")
med(arr, def) =>
    array.size(arr) >= 3 ? array.median(arr) : def
quant(arr, q, def) =>
    n = array.size(arr)
    c = array.copy(arr)
    array.sort(c)
    n >= 3 ? array.get(c, math.min(n - 1, math.max(0, math.round(q * (n - 1))))) : def

// ── state (semuanya kausal: hanya memakai candle sampai saat ini) ──
var int   lastD = na
var float lastDLow = na
var int   candBar = na
var float candLow = na
var dLens = array.new_float()
var dDrops = array.new_float()
var int   dLockBar = na
var float dLockClose = na
var int   lastW = na
var float lastWLow = na
var int   wCandBar = na
var float wCandLow = na
var wLens = array.new_float()
var wDrops = array.new_float()
var int   wLockBar = na
var float wLockClose = na

// harga acuan prediksi dikunci di candle pertama timing band (tidak berubah sampai siklus selesai)
if not na(lastD) and na(dLockBar) and bar_index - lastD >= dGap
    dLockBar := bar_index
    dLockClose := close
if not na(lastW) and na(wLockBar) and bar_index - lastW >= wGap
    wLockBar := bar_index
    wLockClose := close

// kandidat DCL
inWindow = na(lastD) or bar_index - lastD >= dGap or (bar_index - lastD >= toBars(failDays) and low < lastDLow)
if inWindow and low <= dipLow and (na(candBar) or low < candLow)
    candBar := bar_index
    candLow := low

// konfirmasi DCL → label permanen
if not na(candBar) and bar_index > candBar and close > prevDayHigh and close > ma
    failed = not na(lastDLow) and candLow < lastDLow
    if not na(lastD)
        array.push(dLens, candBar - lastD)
    if not na(dLockBar) and candBar >= dLockBar
        array.push(dDrops, 1 - candLow / dLockClose)
    label.new(candBar, candLow, "DCL", style = label.style_label_up, color = failed ? colFail : colD, textcolor = color.white, size = size.small, tooltip = (failed ? "DCL — failed cycle" : "Daily Cycle Low") + " · " + fmtP(candLow))
    // WCL: kandidat sebelumnya terkonfirmasi jika DCL baru lebih tinggi
    if not na(wCandBar) and candLow > wCandLow
        if not na(lastW)
            array.push(wLens, wCandBar - lastW)
        if not na(wLockBar) and wCandBar >= wLockBar
            array.push(wDrops, 1 - wCandLow / wLockClose)
        label.new(wCandBar, wCandLow * 0.97, "WCL", style = label.style_label_up, color = colW, textcolor = color.white, size = size.normal, tooltip = "Weekly Cycle Low · " + fmtP(wCandLow))
        lastW := wCandBar
        lastWLow := wCandLow
        wLockBar := na
        wLockClose := na
        wCandBar := na
        wCandLow := na
        if bar_index - lastW >= wGap
            wLockBar := bar_index
            wLockClose := close
    // DCL ini jadi kandidat WCL?
    sinceW = na(lastW) ? 1000000 : candBar - lastW
    if (sinceW >= wGap or (not na(lastWLow) and candLow < lastWLow)) and (na(wCandBar) or candLow < wCandLow)
        wCandBar := candBar
        wCandLow := candLow
    lastD := candBar
    lastDLow := candLow
    candBar := na
    candLow := na
    dLockBar := na
    dLockClose := na
    if bar_index - lastD >= dGap
        dLockBar := bar_index
        dLockClose := close

// ── prediksi harga: close acuan × (1 − median penurunan historis close-acuan → low) ──
// acuan = close candle pertama timing band (terkunci); sebelum band = close terakhir (sementara)
mDrop = med(dDrops, dDrop0 / 100)
lDrop = quant(dDrops, 0.25, dDrop0 / 100 * 0.5)
hDrop = quant(dDrops, 0.75, dDrop0 / 100 * 1.5)
refD = na(dLockClose) ? close : dLockClose
predD = refD * (1 - mDrop)
mDropW = med(wDrops, wDrop0 / 100)
lDropW = quant(wDrops, 0.25, wDrop0 / 100 * 0.5)
hDropW = quant(wDrops, 0.75, wDrop0 / 100 * 1.5)
refW = na(wLockClose) ? close : wLockClose
predW = refW * (1 - mDropW)
plot(predD, "Prediksi harga DCL", display = display.none)
plot(predW, "Prediksi harga WCL", display = display.none)

var label pD = na
var label pW = na
var box   bD = na
var box   bW = na
if barstate.islast and showProj and not na(lastD)
    label.delete(pD)
    label.delete(pW)
    box.delete(bD)
    box.delete(bW)
    lockedD = not na(dLockClose)
    lenD = med(dLens, toBars(dAvg0))
    xD = math.max(lastD + math.round(lenD), bar_index + 1)
    zLoD = refD * (1 - hDrop)
    zHiD = refD * (1 - lDrop)
    bD := box.new(lastD + dGap, zHiD, math.max(lastD + dEnd, xD + 1), zLoD, border_color = color.new(colD, 50), border_style = line.style_dashed, bgcolor = color.new(colD, 92), text = "zona DCL " + fmtP(zLoD) + " – " + fmtP(zHiD), text_size = size.tiny, text_color = color.new(colD, 10), text_valign = text.align_bottom)
    pD := label.new(xD, predD, "DCL " + fmtP(predD) + (lockedD ? "" : " (sementara)"), style = label.style_label_up, color = color.new(colD, lockedD ? 55 : 75), textcolor = color.white, size = size.small, tooltip = "Prediksi DCL berikutnya: " + fmtP(predD) + " (zona 50%: " + fmtP(zLoD) + " – " + fmtP(zHiD) + "), sekitar hari ke-" + str.tostring(math.round(lenD / bpd)) + " siklus" + (isEna ? " · preset ENAUSDT" : "") + ". " + (lockedD ? "Terkunci sejak awal timing band." : "Sementara: mengikuti close terakhir sampai timing band dimulai."))
    if not na(lastW)
        lockedW = not na(wLockClose)
        lenW = med(wLens, toBars(wAvg0 * 7))
        xW = math.max(lastW + math.round(lenW), bar_index + 1)
        zLoW = refW * (1 - hDropW)
        zHiW = refW * (1 - lDropW)
        bW := box.new(lastW + wGap, zHiW, math.max(lastW + wEnd, xW + 1), zLoW, border_color = color.new(colW, 50), border_style = line.style_dashed, bgcolor = color.new(colW, 95), text = "zona WCL " + fmtP(zLoW) + " – " + fmtP(zHiW), text_size = size.tiny, text_color = color.new(colW, 10), text_valign = text.align_bottom)
        pW := label.new(xW, predW * (xW == xD and math.abs(predW - predD) < predD * 0.03 ? 0.97 : 1), "WCL " + fmtP(predW) + (lockedW ? "" : " (sementara)"), style = label.style_label_up, color = color.new(colW, lockedW ? 55 : 75), textcolor = color.white, size = size.normal, tooltip = "Prediksi WCL berikutnya: " + fmtP(predW) + " (zona 50%: " + fmtP(zLoW) + " – " + fmtP(zHiW) + "), sekitar minggu ke-" + str.tostring(math.round(lenW / bpd / 7)) + " siklus. " + (lockedW ? "Terkunci sejak awal timing band." : "Sementara: mengikuti close terakhir sampai timing band dimulai."))
` + NEWS;

  const api = { indicator };
  root.LunaCycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
