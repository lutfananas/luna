# Riset SNDKUSDT (SanDisk perpetual): volume spike + ML

Data diambil dari arsip publik Binance (data.binance.vision), karena API Futures bisa diblokir per lokasi.

- `download.py [folder]`: unduh candle SNDKUSDT 1H/15m/5m (listing 7 Apr 2026) ke `data/sndk`.
- `spike.js`: fitur volume spike relatif terhadap **jam yang sama** (rata-rata 10 hari), arah spike,
  delta volume, VWAP harian, level harian, sesi; label trade bracket.
- `event-study.js`: aturan sederhana (ikut / lawan spike ≥2/3/5×) per bulan.
- `walk-forward.js`: ML khusus SNDK dengan walk-forward bulanan (latih semua bulan sebelumnya, uji bulan itu).

Hasil (komisi 0,05%, sebelum Sep 2026 = desain, Sep–Nov 2026 = tes):
- Ikut spike ≥5× (15m): sebelum Sep +0,10R/trade, Sep–Nov +0,20R/trade. Melawan spike: rugi di semua periode.
- Konfirmasi di 16 koin crypto 1H (2023–2026): ikut spike ≥5× +0,05R (13/16 koin untung), melawan spike −0,09R (0/16).
- ML khusus SNDK: validasi Jul–Agu +0,15 s/d +0,26R, tetapi **tes Sep–Nov −0,08R** → tidak dipakai (data 7 bulan terlalu sedikit).
