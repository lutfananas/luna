# 🌙 Luna — Dashboard Trading Crypto Pribadi

> **Versi terbaru: 5 November 2026** — unduh **[luna-dashboard.zip](luna-dashboard.zip)** (klik file → tombol *Download raw file*), ekstrak ke folder baru, buka `index.html`, lalu tekan **Ctrl+Shift+R**.
> Isi terbaru: **alat gambar** (Fibonacci, range harga & %, garis, kotak, posisi long/short), indikator **Cycle Low (DCL / WCL)** tanpa repaint + prediksi harga **(selalu dihitung dari data harian — angkanya sama di 15m/1H/4H/1D)**, status siklus (**✕ DCL ditembus**, **⚠ translasi kiri**) & panel **siklus 4 tahunan BTC (halving)**, preset ENAUSDT, penanda news (termasuk **hack Binance 29 Okt 2026**), tab **📰 Siklus & News** + tambah news sendiri, scanner sinyal, pair Binance Futures. Script bawaan yang belum Anda edit diperbarui otomatis saat aplikasi dibuka.


Dashboard trading pribadi ala TradingView yang berjalan sepenuhnya di browser Anda:

- **Watchlist ★ Koin** di sidebar: favorit + 100 koin USDT teratas (volume 24 jam) dengan harga realtime — klik untuk membuka chart.
- **Chart candlestick** data Binance (pemilih koin dengan pencarian & favorit untuk semua pair spot, timeframe 1m–1w, sampai 20.000 bar) + update **live** via WebSocket.
- **Script mirip Pine Script v5** — tulis indikator & strategi sendiri, tambahkan sesuka hati, ubah input lewat ⚙.
- **Backtest otomatis** untuk setiap `strategy(...)`: net profit, win rate, profit factor, max drawdown, kurva equity vs buy & hold, daftar trade.
- **Bar Replay** — mundur ke titik mana pun lalu putar ulang candle satu per satu (▶, →, ←, kecepatan 1x–30x). Hasil backtest ikut menyesuaikan posisi replay.
- **Paper trading manual saat replay** — BUY / SELL / Tutup + Stop Loss / Take Profit, dengan statistik P&L sendiri.
- Data juga bisa dari **file CSV** sendiri, atau **data Demo** (offline).
- **SATTAM | CRT+TBS** — indikator Candle Range Theory + Turtle Body Soup (HTF otomatis, key level OB/FVG/OHP/OLP, 3 entry model, daily bias, kill zone, Donchian 2H) beserta versi strategy-nya. Lihat [docs/CRT-TBS.md](docs/CRT-TBS.md).
- **MyTT Trend Pullback** + indikator **MyTT KDJ + DMI** — rumus BBI, KDJ, DMI (versi 通达信) dan TAQ dari [MyTT](https://github.com/mpquant/MyTT), ditulis ulang di Pine. Ikut tren (BBI naik, PDI > MDI, ADX ≥ 20), masuk saat KDJ golden cross setelah J < 20; SL di luar swing, TP1–TP3 di zona pivot/TAQ.
- **EMA Cross Strategy** — entry limit di zona EMA, SL di luar swing, TP1–TP3 di zona resistance/support.
- **Cycle Low (DCL / WCL)** — teori siklus Hurst / Bob Loukas, **tanpa repaint**: label **DCL** (Daily Cycle Low) dan **WCL** (Weekly Cycle Low) ditulis saat terkonfirmasi dan tidak pernah berubah; failed cycle merah. **Prediksi harga & waktu** DCL/WCL berikutnya: close di awal timing band × (1 − median penurunan historis), terkunci sejak awal band, dengan zona harga 50% (kuartil 25–75%). Preset **ENAUSDT** hasil tuning (siklus minimum 35 hari). Penanda **News** di atas candle: peristiwa besar (perang, hack, krisis, halving, pemilu), opsional FOMC & unlock ENA, termasuk jadwal yang akan datang. Tab **📰 Siklus & News** di panel bawah: tabel tiap siklus (tanggal & harga low, durasi, DCL/WCL/failed, news selama siklus) dengan baris siklus berjalan berisi prediksi, timing band, dan daftar **berjaga-jaga** (jadwal mendatang, guncangan baru).
- **Pair Binance Futures** (mis. **XAUUSDT** emas, **NVDAUSDT**, **SANDISKUSDT**): pair yang tidak ada di spot otomatis diambil dari Binance Futures USDⓈ-M (candle, harga realtime, live), diberi label PERP. Ketiganya sudah ada di Favorit.
- **Alat gambar seperti TradingView** (toolbar kiri chart): garis tren, garis horizontal, **Fibonacci retracement**, **range harga & tanggal** (Δ harga, Δ %, jumlah candle, durasi), kotak (tinggi %), **posisi long/short** (entry/SL/TP, R:R), magnet OHLC. Disimpan per koin, tetap di tempatnya saat ganti timeframe.
- **📡 Scanner sinyal** (tab Sinyal di kanan): menjalankan EMA Cross zona atau MyTT di koin Favorit + Top 30/50/100 pada 15m/1H/4H, hanya memakai candle yang sudah close. Setiap titik entry baru tampil sebagai kartu (Entry, SL, TP1–TP3, R) dengan notifikasi browser + bunyi; mode **Online** memindai otomatis tiap candle close. Klik kartu untuk membuka chart-nya.
- Alat uji di folder `tools/`: `tune-crt.js` (grid + verifikasi out-of-sample) dan `robust-crt.js` (banyak koin + walk-forward).
- Semua script & pengaturan tersimpan di browser (localStorage). Bisa **ekspor/impor** ke file JSON.

Tidak perlu server, tidak perlu install apa pun, tidak ada data yang dikirim ke mana-mana selain request harga ke Binance.

## Cara menjalankan

**Cara paling mudah:** buka file `index.html` dengan Chrome / Edge / Firefox (klik dua kali).

Atau jalankan server lokal (disarankan jika browser membatasi file lokal):

```bash
python3 -m http.server 8000
# lalu buka http://localhost:8000
```

Bisa juga di-hosting gratis lewat **GitHub Pages** (Settings → Pages → branch ini, folder root).

> Jika Binance tidak bisa diakses dari jaringan Anda, dashboard otomatis memakai data Demo. Gunakan VPN, atau impor CSV.

## Menulis script

Buka tab **Editor**, klik **+ Indikator** atau **+ Strategi**, tulis kode, tekan **Ctrl+Enter**.

```pine
//@version=5
strategy("Strategi Saya", overlay=true, initial_capital=1000,
     default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_value=0.1)

fast = ta.ema(close, input.int(9, "EMA Cepat"))
slow = ta.ema(close, input.int(21, "EMA Lambat"))
plot(fast, "Cepat", color=color.orange)
plot(slow, "Lambat", color=color.blue)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
    strategy.exit("SL/TP", "Long", stop=close * 0.98, limit=close * 1.05)
if ta.crossunder(fast, slow)
    strategy.close("Long")
```

Daftar lengkap fungsi yang didukung ada di tab **Bantuan** di dashboard. Ringkasnya:

| Kategori | Didukung |
|---|---|
| Sintaks | variabel, `var`, `:=`, `+=`, `if/else if/else`, `switch`, `x = if …`, `for … to … by`, `for x in arr`, `while`, ternary, `and/or/not`, histori `x[1]`, tuple `[a, b] = …`, fungsi `f(x) =>`, method `arr.push(x)`, `array<float>`, argumen bernama |
| HTF | `timeframe.change("1D")`, `timeframe.in_seconds()`, `request.security(…, "240", high[1])` untuk OHLCV (tanpa repaint) |
| Gambar | `box.new`, `line.new`, `label.new`, `table.new` + `set_*`/`get_*`/`delete` — ikut posisi Bar Replay |
| `array.*` | new_float/int/bool/string/box/line, push, pop, shift, get, set, size, remove, max, min, avg, sort, … |
| `ta.*` | sma, ema, rma, wma, hma, vwma, rsi, macd, bb, kc, atr, supertrend, stoch, cci, mfi, dmi, vwap, obv, highest/lowest, crossover/crossunder, pivothigh/pivotlow, sar, linreg, barssince, valuewhen, dll. |
| Plot | `plot` (line, stepline, histogram, columns, area, circles), `plotshape`, `plotchar`, `plotarrow`, `hline`, `bgcolor`, `barcolor` |
| Strategi | `strategy.entry/exit/close/close_all/cancel`, stop & limit, profit/loss (tick), pyramiding, komisi, slippage, `position_size`, `position_avg_price`, `equity`, … |
| Input | `input.int/float/bool/string/source/color` → bisa diubah dari panel ⚙ |

Belum didukung: `request.security` dengan ekspresi kompleks, `type`/`method` buatan sendiri, `map/matrix`, trailing stop, partial exit.

### Aturan eksekusi backtest

Mengikuti default TradingView: order market diisi di **open bar berikutnya** (atau close bar sekarang jika `process_orders_on_close=true`). Stop/limit dicek di dalam bar dengan asumsi jalur harga open → high/low terdekat → sisi lain → close. Posisi bersifat net; entry arah berlawanan = reversal.

## Shortcut

| Tombol | Fungsi |
|---|---|
| `/` | Pilih koin (cari dari semua pair Binance, ★ favorit) |
| `R` | Masuk/keluar replay |
| `Spasi` | Play / pause replay |
| `→` / `←` | Maju / mundur 1 bar |
| `B` / `S` / `C` | Buy / Sell / Tutup posisi (paper trading saat replay) |
| `Ctrl+Enter` | Simpan & terapkan script |

## Struktur kode

```
index.html          tampilan
css/style.css       gaya (tema gelap)
js/app.js           UI: chart, daftar script, editor, tester, replay, paper trading
js/pine.js          penerjemah Pine-like → JavaScript + runtime
js/pine-ext.js      timeframe/HTF, array, objek gambar (box/line/label/table)
js/draw-layer.js    renderer objek gambar di chart + tabel
js/scripts-crt.js   SATTAM CRT+TBS (indikator & strategy)
js/scripts-mytt.js  MyTT KDJ + DMI (indikator) & MyTT Trend Pullback (strategy)
js/scanner.js       scanner sinyal multi-koin (EMA Cross zona / MyTT)
js/user-draw.js     alat gambar manual (fibo, range harga & %, garis, kotak, posisi)
js/scripts-cycle.js indikator Cycle Low (DCL / WCL)
js/ta.js            library indikator (ta.*)
js/backtest.js      mesin backtest (strategy.*) + metrik
js/data.js          Binance REST/WebSocket, CSV, data demo
js/scripts.js       contoh script bawaan
js/vendor/          TradingView Lightweight Charts v5 (Apache-2.0)
tests/run-tests.js  tes otomatis (node tests/run-tests.js)
```

> ⚠️ Untuk belajar & riset pribadi. Hasil backtest tidak menjamin hasil di masa depan.
