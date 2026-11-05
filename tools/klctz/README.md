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
