/*
 * Cycle Low (DCL / WCL) — teori siklus Hurst / Bob Loukas.
 * DCL = Daily Cycle Low, WCL = Weekly Cycle Low. Label padat = cycle low,
 * label pudar = proyeksi / kandidat yang belum terkonfirmasi.
 */
(function (root) {
  'use strict';

  const indicator = String.raw`//@version=5
indicator("Cycle Low (DCL / WCL)", overlay = true, max_labels_count = 500, max_boxes_count = 50)

// Teori siklus (J.M. Hurst, dipopulerkan di kripto oleh Bob Loukas).
// Cara membaca cycle low seperti analis: dari seluruh chart, setelah kejadian.
// DCL : lembah harga (low terendah ±10 hari). Lembah terdalam dipilih lebih dulu, dengan jarak
//       minimal 40 hari antar DCL (daily cycle BTC ±50–70 hari). DCL lebih rendah dari DCL
//       sebelumnya = failed cycle (merah).
// WCL : DCL terdalam, dengan jarak minimal 16 minggu antar WCL (weekly cycle ±20–26 minggu).
// Siklus yang sedang berjalan: low terendah setelah DCL terakhir + jarak minimal.
//       Terkonfirmasi (label padat) saat ada candle tutup di atas high hari sebelumnya DAN
//       di atas MA 10 hari. Belum terkonfirmasi → label pudar tepat di bawah candle kandidat.
//       Sebelum timing band → label pudar di tanggal proyeksi + kotak timing band.
// Durasi dalam hari, otomatis dikonversi ke jumlah bar timeframe chart (paling pas di 1D).
// Label riwayat bisa berubah saat data baru masuk (analisis siklus memang dibaca setelah kejadian).
// Ini kerangka analisis, bukan aturan pasti — durasi siklus bisa memanjang/memendek.

gD = "Daily Cycle (DCL)"
dMin    = input.int(40, "Jarak minimal antar DCL (hari)", minval = 5, group = gD)
dMax    = input.int(70, "Batas akhir timing band (hari)", minval = 10, group = gD)
dAvg0   = input.int(60, "Durasi awal untuk proyeksi (hari)", minval = 5, group = gD, tooltip = "Dipakai sampai ada 3 DCL; setelah itu rata-rata 4 siklus terakhir.")
pivDays = input.int(10, "Lembah = low terendah ± N hari", minval = 2, group = gD)
maDays  = input.int(10, "MA konfirmasi (hari)", minval = 2, group = gD)
gW = "Weekly Cycle (WCL)"
wMin   = input.int(16, "Jarak minimal antar WCL (minggu)", minval = 2, group = gW)
wMax   = input.int(30, "Batas akhir timing band (minggu)", minval = 3, group = gW)
wAvg0  = input.int(23, "Durasi awal untuk proyeksi (minggu)", minval = 2, group = gW)
gS = "Tampilan"
showProj = input.bool(true, "Proyeksi cycle low berikutnya", group = gS)
showBand = input.bool(true, "Timing band proyeksi", group = gS)
showMA   = input.bool(false, "Tampilkan MA konfirmasi", group = gS)
colD     = input.color(color.new(#26a69a, 0), "Warna DCL", group = gS)
colW     = input.color(color.new(#ff9800, 0), "Warna WCL", group = gS)
colFail  = input.color(color.new(#ef5350, 0), "Warna failed cycle", group = gS)

// hari → jumlah bar di timeframe chart
bpd = 86400.0 / timeframe.in_seconds()
toBars(d) =>
    math.max(1, math.round(d * bpd))
dGap = toBars(dMin)
dEnd = toBars(dMax)
wGap = toBars(wMin * 7)
wEnd = toBars(wMax * 7)
R    = toBars(pivDays)
ma = ta.sma(close, math.max(2, toBars(maDays)))
dayHigh = ta.highest(high, toBars(1))
prevDayHigh = dayHigh[1]
yRef = ta.lowest(low, toBars(5))
plot(showMA ? ma : na, "MA konfirmasi", color = color.new(color.gray, 30))

// simpan riwayat per bar (dipakai di bar terakhir)
var lows = array.new_float()
var conf = array.new_int()
array.push(lows, low)
array.push(conf, close > prevDayHigh and close > ma ? 1 : 0)

// pilih lembah terdalam lebih dulu dengan jarak minimal "gap" (cand = indeks bar, urut waktu)
pickDeepest(cand, gap) =>
    nC = array.size(cand)
    used = array.new_int(nC, 0)
    acc = array.new_int()
    if nC > 0
        for r = 0 to nC - 1
            best = -1
            for k = 0 to nC - 1
                if array.get(used, k) == 0 and (best < 0 or array.get(lows, array.get(cand, k)) < array.get(lows, array.get(cand, best)))
                    best := k
            array.set(used, best, 1)
            bi = array.get(cand, best)
            ok = true
            nA = array.size(acc)
            if nA > 0
                for q = 0 to nA - 1
                    if math.abs(array.get(acc, q) - bi) < gap
                        ok := false
                        break
            if ok
                array.push(acc, bi)
    array.sort(acc)
    acc
avgGap(arr, def) =>
    n = array.size(arr)
    k0 = math.max(1, n - 4)
    s = 0.0
    if n >= 3
        for k = k0 to n - 1
            s += array.get(arr, k) - array.get(arr, k - 1)
    n >= 3 ? s / (n - k0) : def

var drawn = array.new_label()
var boxes = array.new_box()
if barstate.islast
    for l in drawn
        label.delete(l)
    for b in boxes
        box.delete(b)
    array.clear(drawn)
    array.clear(boxes)
    n = array.size(lows)
    // 1) lembah: low terendah dalam ±R bar (butuh R bar di kanan)
    piv = array.new_int()
    if n > 2 * R
        for i = 0 to n - 1 - R
            lo = array.get(lows, i)
            isPiv = true
            for k = math.max(0, i - R) to i + R
                if array.get(lows, k) < lo
                    isPiv := false
                    break
            if isPiv and (array.size(piv) == 0 or i - array.get(piv, array.size(piv) - 1) > 1)
                array.push(piv, i)
    D = pickDeepest(piv, dGap)
    W = pickDeepest(D, wGap)
    // 2) label riwayat
    off = bar_index - (n - 1)
    nD = array.size(D)
    prevLo = 0.0
    if nD > 0
        for k = 0 to nD - 1
            i = array.get(D, k)
            lo = array.get(lows, i)
            isW = array.includes(W, i)
            failed = k > 0 and lo < prevLo
            array.push(drawn, label.new(i + off, lo, isW ? "WCL" : "DCL", style = label.style_label_up, color = isW ? colW : failed ? colFail : colD, textcolor = color.white, size = isW ? size.normal : size.small, tooltip = isW ? "Weekly Cycle Low" : failed ? "DCL — failed cycle (lebih rendah dari DCL sebelumnya)" : "Daily Cycle Low"))
            prevLo := lo
    // 3) siklus yang sedang berjalan
    if showProj and nD > 0
        lastD = array.get(D, nD - 1)
        lastW = array.size(W) > 0 ? array.get(W, array.size(W) - 1) : na
        avgD = avgGap(D, toBars(dAvg0))
        avgW = avgGap(W, toBars(wAvg0 * 7))
        // kandidat: low terendah setelah DCL terakhir + jarak minimal
        cand = -1
        if lastD + dGap <= n - 1
            for i = lastD + dGap to n - 1
                if cand < 0 or array.get(lows, i) < array.get(lows, cand)
                    cand := i
        candOk = false
        if cand >= 0 and cand < n - 1
            for i = cand + 1 to n - 1
                if array.get(conf, i) == 1
                    candOk := true
                    break
        dX = 0
        dY = 0.0
        if cand >= 0
            dX := cand
            dY := array.get(lows, cand)
            failedNow = dY < array.get(lows, lastD)
            array.push(drawn, label.new(cand + off, dY, "DCL", style = label.style_label_up, color = candOk ? (failedNow ? colFail : colD) : color.new(colD, 70), textcolor = color.white, size = size.small, tooltip = candOk ? "DCL terkonfirmasi (siklus berjalan)" : "Proyeksi DCL: kandidat low siklus (belum terkonfirmasi)"))
        else
            dX := math.max(lastD + math.round(avgD), n)
            dY := yRef
            array.push(drawn, label.new(dX + off, dY, "DCL", style = label.style_label_up, color = color.new(colD, 70), textcolor = color.white, size = size.small, tooltip = "Proyeksi DCL berikutnya (perkiraan waktu)"))
        if showBand
            array.push(boxes, box.new(lastD + dGap + off, yRef * 0.93, lastD + dEnd + off, yRef * 0.92, border_color = color.new(colD, 60), border_style = line.style_dashed, bgcolor = color.new(colD, 90), text = "timing band DCL", text_size = size.tiny, text_color = color.new(colD, 20)))
        if not na(lastW)
            // kandidat WCL: low terendah setelah WCL terakhir + jarak minimal (jika sudah masuk band)
            wc = -1
            if lastW + wGap <= n - 1
                for i = lastW + wGap to n - 1
                    if wc < 0 or array.get(lows, i) < array.get(lows, wc)
                        wc := i
            isLastW = wc >= 0 and array.includes(W, wc)
            if not isLastW
                wX = wc >= 0 ? wc : math.max(lastW + math.round(avgW), n)
                wY = wc >= 0 ? array.get(lows, wc) : yRef
                // di candle yang sama dengan label DCL → ditumpuk tepat di bawahnya
                if wX == dX
                    wY := dY * 0.97
                array.push(drawn, label.new(wX + off, wY, "WCL", style = label.style_label_up, color = color.new(colW, 70), textcolor = color.white, size = size.normal, tooltip = wc >= 0 ? "Proyeksi WCL: kandidat low weekly cycle (belum terkonfirmasi)" : "Proyeksi WCL berikutnya (perkiraan waktu)"))
            if showBand
                array.push(boxes, box.new(lastW + wGap + off, yRef * 0.91, lastW + wEnd + off, yRef * 0.90, border_color = color.new(colW, 60), border_style = line.style_dashed, bgcolor = color.new(colW, 90), text = "timing band WCL", text_size = size.tiny, text_color = color.new(colW, 20)))
`;

  const api = { indicator };
  root.LunaCycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
