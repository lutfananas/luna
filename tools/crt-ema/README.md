# Riset SATTAM CRT + TBS + CISD + EMA 48/380 MTF (Nov 2026)

- `grid.js <SYMBOL-5m.csv> <SYMBOL> <out.json> [konfigurasi.json]`: menjalankan **strategy Pine asli**
  (`js/scripts-crt.js`) untuk 960 kombinasi: pasangan TF (5m/15m × CRT 4H/1H, 1H × 1D), model entry
  (Model #1, CISD, MSS+FVG, semua), TBS wajib, key level, filter tren EMA 48/380 (mati/4H/4H+1H),
  sweep di EMA, kill zone. Komisi 0,05%, 4 worker paralel.
- `analyze.js <out.json> [pick.json]`: pengaruh tiap komponen (pool semua setelan), setelan teratas sebelum Sep 2026,
  hasilnya di Sep–Nov.

Hasil SNDKUSDT (7 Apr – 8 Nov 2026): semua setelan pool ±−0,09R/trade. CISD menaikkan WR (56% vs 46%) tanpa
menaikkan R. Sweep di EMA 48/380 menaikkan WR ±10 poin di kedua periode (R Sep–Nov −0,01 vs −0,09).
TBS wajib & kill zone tidak membantu. Setelan WR 76–88% sebelum Sep turun di Sep–Nov, dan di 15 saham
perpetual semuanya rugi (−0,07 s/d −0,13R/trade, WR 47–50%).
