/*
 * EMA 48/380 MTF (support & resistance): EMA 48 dan EMA 380 dari timeframe besar (default 4H & 1H)
 * digambar di chart mana pun, dihitung dari candle besar yang SUDAH close (tanpa repaint).
 * Pantulan ke EMA ditandai sebagai informasi. Hasil uji (lihat README): sebagai sinyal entry tersendiri,
 * pantulan EMA 48/380 tidak menguntungkan; paling berguna sebagai peta tren & support/resistance.
 */
(function (root) {
  'use strict';

  // EMA ala Pine (seed SMA) dari close candle TF besar yang sudah selesai.
  // Update di candle chart terakhir dalam satu candle besar (waktu tutupnya = waktu tutup candle besar).
  function htfEma(p, tfVar, lens) {
    const L = lens.map((n) => `
var float ${p}e${n} = na
var float ${p}s${n} = 0.0`).join('');
    const U = lens.map((n) => `
    if ${p}n <= ${n}
        ${p}s${n} := ${p}s${n} + ${p}c
        if ${p}n == ${n}
            ${p}e${n} := ${p}s${n} / ${n}
    else
        ${p}e${n} := 2.0 / (${n} + 1) * ${p}c + (1 - 2.0 / (${n} + 1)) * ${p}e${n}`).join('');
    return `
// ── EMA ${lens.join('/')} dari TF besar (${tfVar}) ──
${p}ms = timeframe.in_seconds(${tfVar}) * 1000
${p}same = timeframe.in_seconds() >= timeframe.in_seconds(${tfVar})
var int ${p}n = 0
var int ${p}lastB = -1${L}
${p}bk = math.floor(time / ${p}ms)
${p}endBar = (time + timeframe.in_seconds() * 1000) % ${p}ms == 0
float ${p}c = na
int ${p}upd = -1
if not ${p}same and ${p}endBar and ${p}lastB != ${p}bk
    ${p}c := close
    ${p}upd := ${p}bk
else if not ${p}same and bar_index > 0 and ${p}bk != ${p}bk[1] and ${p}lastB != ${p}bk[1]
    ${p}c := close[1]
    ${p}upd := ${p}bk[1]
if ${p}upd >= 0
    ${p}lastB := ${p}upd
    ${p}n := ${p}n + 1${U}
${lens.map((n) => `${p}E${n} = ${p}same ? ta.ema(close, ${n}) : ${p}e${n}`).join('\n')}
`;
  }

  const indicator = String.raw`//@version=6
// EMA 48/380 MTF — dibuat oleh Luna. Garis EMA timeframe besar tanpa repaint + peta support/resistance.
indicator("EMA 48/380 MTF (S/R)", overlay = true, max_labels_count = 300)
gT = "Timeframe"
tfA = input.timeframe("240", "TF besar 1 (tren utama)", group = gT)
tfB = input.timeframe("60", "TF besar 2", group = gT)
showChart = input.bool(false, "Tampilkan juga EMA timeframe chart", group = gT)
gS = "Support / Resistance"
showZone = input.bool(true, "Zona antara EMA 48 & 380 (TF besar 1)", group = gS)
showBounce = input.bool(true, "Tandai pantulan (informasi)", group = gS, tooltip = "Harga menyentuh EMA 48/380 TF besar 1 searah tren lalu close kembali. Hanya informasi: di uji 3.000+ trade (SNDK, saham, crypto), entry pantulan EMA saja tidak menguntungkan.")
tol = input.float(0.2, "Toleransi sentuhan (× ATR TF chart)", minval = 0, step = 0.05, group = gS)
showTbl = input.bool(true, "Panel tren & level", group = gS)
c48 = input.color(#FF9800, "EMA 48", group = gS)
c380 = input.color(#AB47BC, "EMA 380", group = gS)
${htfEma('a', 'tfA', [48, 380])}${htfEma('b', 'tfB', [48, 380])}
k48 = ta.ema(close, 48)
k380 = ta.ema(close, 380)
atrV = ta.atr(14)
lo6 = ta.lowest(low, 6)
hi6 = ta.highest(high, 6)
lo6p = lo6[1]
hi6p = hi6[1]

trendA = na(aE380) ? 0 : aE48 > aE380 ? 1 : aE48 < aE380 ? -1 : 0
trendB = na(bE380) ? 0 : bE48 > bE380 ? 1 : bE48 < bE380 ? -1 : 0
trendK = na(k380) ? 0 : k48 > k380 ? 1 : k48 < k380 ? -1 : 0

pA48 = plot(aE48, "EMA 48 TF besar 1", color = c48, linewidth = 2, style = plot.style_stepline)
pA380 = plot(aE380, "EMA 380 TF besar 1", color = c380, linewidth = 3, style = plot.style_stepline)
plot(bE48, "EMA 48 TF besar 2", color = color.new(c48, 45), linewidth = 1, style = plot.style_stepline)
plot(bE380, "EMA 380 TF besar 2", color = color.new(c380, 45), linewidth = 1, style = plot.style_stepline)
plot(showChart ? k48 : na, "EMA 48 chart", color = color.new(c48, 65))
plot(showChart ? k380 : na, "EMA 380 chart", color = color.new(c380, 65))
fill(pA48, pA380, color = showZone ? (trendA > 0 ? color.new(#26a69a, 88) : trendA < 0 ? color.new(#ef5350, 88) : na) : na, title = "Zona EMA 48–380")

// pantulan: sentuh EMA TF besar 1 searah tren lalu close kembali (sentuhan pertama dalam 6 candle)
float lvTouched = na
bounce = 0
if showBounce and trendA != 0 and not na(atrV)
    for lv in array.from(aE48, aE380)
        if na(lvTouched) and not na(lv)
            z = lv + trendA * tol * atrV
            hit = trendA > 0 ? low <= z and close > lv : high >= z and close < lv
            fresh = trendA > 0 ? lo6p > z : hi6p < z
            if hit and fresh
                lvTouched := lv
                bounce := trendA
plotshape(bounce > 0, "Pantul support", style = shape.triangleup, location = location.belowbar, color = color.new(#26a69a, 0), size = size.tiny, text = "S")
plotshape(bounce < 0, "Pantul resistance", style = shape.triangledown, location = location.abovebar, color = color.new(#ef5350, 0), size = size.tiny, text = "R")

// level terdekat dari 4 EMA TF besar
tfName(t) =>
    t == "240" ? "4H" : t == "60" ? "1H" : t == "D" ? "1D" : t == "15" ? "15m" : t
levels = array.from(aE48, aE380, bE48, bE380)
names = array.from("EMA48 " + tfName(tfA), "EMA380 " + tfName(tfA), "EMA48 " + tfName(tfB), "EMA380 " + tfName(tfB))
float sup = na
float res = na
string supN = "—"
string resN = "—"
for i = 0 to 3
    v = array.get(levels, i)
    if not na(v)
        if v < close and (na(sup) or v > sup)
            sup := v
            supN := array.get(names, i)
        if v > close and (na(res) or v < res)
            res := v
            resN := array.get(names, i)

trTxt(t) =>
    t > 0 ? "NAIK (48 > 380)" : t < 0 ? "TURUN (48 < 380)" : "— (data kurang)"
var table tb = table.new(position.top_right, 3, 7, bgcolor = color.new(chart.bg_color, 8), border_color = color.new(chart.fg_color, 85), border_width = 1)
if barstate.islast and showTbl
    fg = chart.fg_color
    table.cell(tb, 0, 0, "EMA 48/380 MTF", text_color = #F5C542, text_size = size.small)
    table.cell(tb, 1, 0, "Tren", text_color = color.new(fg, 30), text_size = size.small)
    table.cell(tb, 2, 0, "Harga vs EMA380", text_color = color.new(fg, 30), text_size = size.small)
    table.cell(tb, 0, 1, tfName(tfA), text_color = fg, text_size = size.small)
    table.cell(tb, 1, 1, trTxt(trendA), text_color = trendA > 0 ? #26a69a : trendA < 0 ? #ef5350 : fg, text_size = size.small)
    table.cell(tb, 2, 1, na(aE380) ? "—" : close > aE380 ? "di atas" : "di bawah", text_color = fg, text_size = size.small)
    table.cell(tb, 0, 2, tfName(tfB), text_color = fg, text_size = size.small)
    table.cell(tb, 1, 2, trTxt(trendB), text_color = trendB > 0 ? #26a69a : trendB < 0 ? #ef5350 : fg, text_size = size.small)
    table.cell(tb, 2, 2, na(bE380) ? "—" : close > bE380 ? "di atas" : "di bawah", text_color = fg, text_size = size.small)
    table.cell(tb, 0, 3, "chart", text_color = fg, text_size = size.small)
    table.cell(tb, 1, 3, trTxt(trendK), text_color = trendK > 0 ? #26a69a : trendK < 0 ? #ef5350 : fg, text_size = size.small)
    table.cell(tb, 2, 3, na(k380) ? "—" : close > k380 ? "di atas" : "di bawah", text_color = fg, text_size = size.small)
    table.cell(tb, 0, 4, "Support", text_color = #26a69a, text_size = size.small)
    table.cell(tb, 1, 4, na(sup) ? "—" : str.tostring(sup, format.mintick) + " (" + supN + ")", text_color = fg, text_size = size.small)
    table.cell(tb, 2, 4, na(sup) ? "" : "-" + str.tostring((close - sup) / close * 100, "#.##") + "%", text_color = fg, text_size = size.small)
    table.cell(tb, 0, 5, "Resistance", text_color = #ef5350, text_size = size.small)
    table.cell(tb, 1, 5, na(res) ? "—" : str.tostring(res, format.mintick) + " (" + resN + ")", text_color = fg, text_size = size.small)
    table.cell(tb, 2, 5, na(res) ? "" : "+" + str.tostring((res - close) / close * 100, "#.##") + "%", text_color = fg, text_size = size.small)
    table.cell(tb, 0, 6, "Catatan", text_color = color.new(fg, 40), text_size = size.tiny)
    table.cell(tb, 1, 6, na(aE380) ? "EMA380 " + tfName(tfA) + " butuh 380 candle " + tfName(tfA) + " — tambah jumlah bar" : "peta tren & S/R, bukan sinyal entry", text_color = color.new(fg, 40), text_size = size.tiny)

alertcondition(bounce > 0, "Pantul support EMA", "Harga memantul di support EMA 48/380 {{ticker}} @ {{close}}")
alertcondition(bounce < 0, "Pantul resistance EMA", "Harga memantul di resistance EMA 48/380 {{ticker}} @ {{close}}")
`;

  const api = { indicator, htfEma };
  root.LunaEMA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
