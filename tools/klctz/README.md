# Riset KLCTZ: optimasi + machine learning

Alat untuk mengulang optimasi setelan dan pelatihan model ML untuk script
**Key Level Confluence [PhenLabs]** (`js/scripts-klctz.js`).

- `engine.js`: replika logika Pine (zona, sinyal, rencana) dalam JS. Hasilnya identik dengan Pine,
  tetapi ~100× lebih cepat. Simulasinya dibuat seperti broker: isi di open berikutnya, stop dicek dulu,
  SL ke BE setelah TP1, komisi 0,1% per sisi.
- `fetch.js`: unduh data 16 koin (4H 8000 bar, 1H 26000 bar).
- `opt.js <tf> [K]`: grid 216 konfigurasi zona × K setelan sinyal/exit acak → `opt-<tf>.json`.
- `select.js <tf>`: urutkan menurut t-stat periode **latih**, pilih 20 teratas, ambil yang terbaik di **validasi**,
  lalu laporkan **tes** sekali.
- `ml.js <tf> [cfgJSON]`: regresi logistik & boosted stumps; ambang dipilih di validasi.
- `final.js`: model akhir (latih + validasi) → `model.json`. Koefisiennya ditempel ke konstanta `ML`
  di `js/scripts-klctz.js`.

Periode: latih < 1 Mar 2025, validasi 1 Mar – 31 Okt 2025, tes ≥ 1 Nov 2025.

```
node tools/klctz/fetch.js
node tools/klctz/opt.js 4h 15 && node tools/klctz/select.js 4h
node tools/klctz/final.js
```

## Luna AI Signal 1H

- `ai.js`: 29 fitur kausal per candle 1H (tren, momentum, volatilitas, volume, siklus 30 hari, level harian/mingguan,
  jam & hari), label trade bracket (SL 3×ATR, TP1 1R 50% → BE, TP2 2R, time exit 72 jam, komisi 0,1%),
  boosted trees kedalaman 2, dan evaluasi berurutan per koin (satu posisi sekaligus).
- `ai-test.js`: model dilatih di periode latih saja, lalu dinilai di validasi & tes.
- `ai-train.js`: model final (latih + validasi) → `luna-ai-model.json`, yang dibenamkan di `js/scripts-ai.js`.

```
SYM=1 CYC720=1 NO1200=1 WARM=800 node --max-old-space-size=7000 tools/klctz/ai-test.js
```

## Luna AI v2 (Nov 2026): walk-forward + koin baru

- `ai-walkforward.js`: latih ulang tiap kuartal (expanding window), uji 3 bulan berikutnya, 8 fold (2025–2026).
  Varian lewat env: `NT`, `LR`, `ML` (minLeaf), `KEEP` (porsi skor teratas), `ENS`, `EX` (exit), `TRAIL`, `COSTMAX`.
  `HOLD=1` juga menguji 16 koin yang tidak dipakai saat memilih desain (data di `data/klctz-new`).
- Hasil (komisi 0,1%): model lama 228R (16 koin) / 232R (koin baru); **v2** (150 pohon, lr 0.05, minLeaf 1500,
  top 8%, filter biaya 0,15R) **268–324R / 298R**.
- `ai-deploy.js`: model final dari 32 koin sampai data terbaru → `luna-ai-model.json`.
