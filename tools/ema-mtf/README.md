# Riset EMA 48 / EMA 380 multi-timeframe (Nov 2026)

- `download.py <folder> 5m SNDKUSDT MUUSDT ...`: candle 5m dari arsip Binance Futures (data.binance.vision).
- `mtf.js [SNDKUSDT-5m.csv]`: 3.072 setelan pantulan EMA (tren TF besar · level EMA48/380 · eksekusi TF kecil ·
  toleransi · SL · TP · sentuhan pertama). Data sebelum Sep 2026 untuk memilih, Sep–Nov untuk menilai.
- `cross.js`: 1.280 setelan (+ konfirmasi candle, TP 3R, ikut tren, zona 48–380) di SNDK, saham perpetual & 16 crypto.
- `aifilter.js`: sinyal Luna AI walk-forward, searah vs berlawanan tren EMA48/380 4H & 1H.

Hasil (komisi 0,05%):
- Pantulan EMA sebagai sinyal entry: median **negatif di semua 8 kombinasi timeframe** (SNDK, saham, crypto);
  hanya 29/1.280 setelan positif di saham *dan* crypto (setara kebetulan). Terbaik: tren 4H, zona EMA48–380 4H,
  eksekusi 5m, SL 0,7 ATR, TP 3R ≈ impas (+0,004 s/d +0,009R, WR 38–44%).
- Sebagai filter Luna AI di crypto: searah tren 4H WR 61% vs 57% (2026), R/trade naik, jumlah trade ±setengah.
  Di SNDK & saham perpetual tidak membantu.
- Luna AI v2 di SNDKUSDT (tidak pernah dilatih di SNDK): sebelum Sep WR 71% +0,31R (38 trade),
  Sep–Nov WR 76% +0,65R (17 trade).
