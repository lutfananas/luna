# SATTAM | CRT + TBS — edisi Luna

Kode sumber: `js/scripts-crt.js` (satu sumber → indikator **dan** strategy, logika identik).
Di dashboard: script **SATTAM | CRT+TBS** (indikator, aktif) dan **SATTAM | CRT+TBS Strategy** (untuk Strategy Tester).

> Catatan: kode asli yang ditempel terpotong setelah bagian Settings (`confirmClose = input.bool(...`).
> Engine CRT/TBS/KL/entry model di bawah ini dibangun ulang dari struktur settings tersebut dan konsep CRT/TBS standar.
> Jika ingin port 1:1, kirim kode lengkapnya (sebagai file `.pine` lewat tombol **Impor**).

## Cara kerja

| Bagian | Isi |
|---|---|
| ② HTF | Auto: chart 1m→1H · 5m/15m→4H · 30m/1H→1D · 2H/4H→1W · ≤1D→1M. Candle HTF dibangun dari bar chart yang sudah close → **tidak repaint**. |
| ③ Key Levels | OHP/OLP (pivot), OB (candle berlawanan sebelum displacement), FVG. Disimpan di array (maks *Max Zones*), dihapus saat ditembus close. |
| ④ TBS | Wick menembus swing LTF terakhir tapi body close kembali → likuiditas diambil (tanda ✕ kecil). |
| ⑤ CRT | C1 = candle HTF sebelumnya, C2 = berjalan. Sweep high/low C1 → reclaim (close kembali ke dalam) dalam ≤ *Max Bars* → **armed**. Batal jika ekstrem sweep ditembus atau target tercapai tanpa entry. |
| Tipe | **T1** sweep+reclaim di bar yang sama · **T2** reclaim tertunda · **T3** CRT klasik 3-candle (C2 HTF close kembali di dalam C1, entry di C3) · **T4** C2 outside bar. |
| ⑥ Entry | **Model #1** close reclaim · **CISD** close melewati open awal rangkaian candle yang membuat ekstrem · **MSS+FVG** tembus swing struktur + FVG searah dalam 3 bar. *All* = semua model (masing-masing sekali per setup). |
| Target | T1 = EQ (50%) range C1, T2 = sisi seberang range. Stop = ekstrem sweep + buffer. |
| Filter | Key Level wajib, TBS wajib (opsional), Min RR, Daily Bias, Kill Zone New York (DST otomatis). |
| Ekstra | Fase AMD, Daily Bias, Donchian 2H (dari candle 2H yang sudah close), tabel status, statistik W/L sinyal. |

## Analisa & perbaikan dibanding versi yang ditempel

1. **Bisa diukur.** Versi asli hanya indikator. Sekarang ada versi strategy + statistik W/L di tabel, jadi setiap perubahan setting bisa dinilai dengan angka (Strategy Tester, kurva equity vs buy & hold).
2. **Tidak repaint & tidak bocor masa depan.** HTF dibangun dari bar yang sudah close (bukan `request.security` dengan lookahead). Ada tes otomatis: sinyal sebelum bar K identik dengan/ tanpa data setelah K.
3. **Jarak stop minimum (× ATR).** Stop tepat di atas wick sweep sering < 0,5% dari harga; dengan komisi 0,1% per sisi, biaya bisa memakan ±40–70% dari 1R. Diagnosa di data acak: stop ketat + komisi = PF jatuh jauh di bawah 1.
4. **Ukuran posisi berbasis risiko** (strategy): qty = equity × risiko% ÷ jarak stop, dibatasi 100% equity. Versi "100% equity per trade" membuat drawdown ditentukan oleh jarak stop, bukan oleh Anda.
5. **Min RR terhadap T2** dan **satu sinyal per model per setup** → mencegah sinyal berulang di setup yang sama.
6. **Invalidasi eksplisit**: setup batal jika ekstrem manipulasi ditembus atau target sudah tercapai sebelum entry (menghindari entry terlambat).
7. **Daily Bias & Kill Zone** sebagai filter opsional, bukan hanya tampilan.

## Yang perlu diketahui (jujur)

- Di data **acak** (random walk), strategi ini impas sebelum komisi dan rugi setelah komisi — itu normal dan membuktikan tidak ada "kecurangan" lookahead. Keunggulan (edge) hanya bisa dinilai di data pasar nyata: muat BTCUSDT/ETHUSDT di 15m/1H, jalankan Strategy Tester, lalu ubah filter satu per satu.
- Win rate CRT secara alami rendah bila target T2 jauh (RR tinggi). Nilai yang lebih bermakna: **Profit Factor**, **rata-rata trade**, dan **max drawdown**. Coba juga *Take Profit = T1*.
- Hindari optimasi berlebihan: uji di satu periode, lalu verifikasi di periode lain (pakai jumlah bar berbeda atau **Replay**).
- "Confirmed Bars Only": di Luna semua bar historis sudah close; saat Live, bar terakhir yang masih berjalan ikut dihitung ulang setiap update.
