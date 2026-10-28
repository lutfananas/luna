#!/usr/bin/env node
/*
 * Uji ketahanan SATTAM CRT+TBS Strategy: banyak koin + walk-forward.
 *
 *   node tools/robust-crt.js
 *   node tools/robust-crt.js --symbols ENAUSDT,BTCUSDT --tf 15m --bars 90000 --train 6 --test 3
 *
 * Ukuran utama = expectancy dalam R per setup (setelah komisi), di mana
 * 1R = jarak entry → SL awal × ukuran posisi. Ukuran ini tidak bergantung pada
 * sizing, sehingga hasil dari banyak koin bisa digabung.
 *
 * A) Default saat ini dinilai di semua koin & seluruh periode.
 * B) Walk-forward: tiap jendela, kombinasi parameter dipilih dari data
 *    "train" (gabungan semua koin) lalu dinilai di jendela "test" sesudahnya.
 *    Aturan pilih (ditetapkan sebelum melihat hasil): expectancy train tertinggi
 *    dengan minimal --min-setups setup. Gabungan semua jendela test = perkiraan
 *    jujur performa proses tuning ini di data yang belum pernah dilihat.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
globalThis.LunaTA = require('../js/ta.js');
globalThis.LunaBacktest = require('../js/backtest.js');
globalThis.LunaPineExt = require('../js/pine-ext.js');
const Pine = require('../js/pine.js');
const CRT = require('../js/scripts-crt.js');
const Data = require('../js/data.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SYMBOLS = arg('symbols', 'ENAUSDT,BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,SUIUSDT,WLDUSDT,ARBUSDT,OPUSDT,NEARUSDT,LTCUSDT').split(',');
const TF = arg('tf', '15m');
const BARS = +arg('bars', 90000);
const TRAIN_M = +arg('train', 6);
const TEST_M = +arg('test', 3);
const MIN_SETUPS = +arg('min-setups', 100);
const WORKERS = +arg('workers', os.cpus().length);
const DATA_DIR = path.join(__dirname, '..', 'data');

// ruang pencarian kecil: makin sedikit kombinasi, makin kecil peluang "menang kebetulan"
const GRID = {
  'Take Profit': ['TP1 / TP2 / TP3 (Partial)', 'Fixed R'],
  'Fixed R Multiple': [0.6, 1.0, 1.5],
  'Entry Model': ['CISD', 'All'],
  'Require Key Level': [true, false],
  'Kill Zones Only (New York time)': [true, false],
};
// visual dimatikan agar cepat (tidak memengaruhi sinyal)
const FAST = { 'Draw Trade Plan (Entry · SL · TP1-3)': false, 'Show Table': false, 'Draw Range Box': false, 'Show CRT Type (1–4)': false };

function combos() {
  const keys = Object.keys(GRID);
  const out = [{ name: 'DEFAULT', inputs: {} }];
  const rec = (j, cur) => {
    if (j === keys.length) { out.push({ name: JSON.stringify(cur), inputs: { ...cur } }); return; }
    for (const v of GRID[keys[j]]) rec(j + 1, { ...cur, [keys[j]]: v });
  };
  rec(0, {});
  return out;
}

const cacheFile = (sym) => path.join(DATA_DIR, `${sym}-${TF}-${BARS}.csv`);
function readBars(sym) { return Data.parseCSV(fs.readFileSync(cacheFile(sym), 'utf8')); }

// ───────────────────────────── worker ─────────────────────────────
// Menjalankan semua kombinasi untuk satu koin; mengembalikan daftar setup {t, R} per kombinasi.
if (!isMainThread) {
  const { sym, list } = workerData;
  const bars = readBars(sym);
  // stop awal dibaca lewat plot tersembunyi (tanpa mengubah script)
  const src = CRT.strategy + '\nplot(bullStop, "zStopL", display = display.none)\nplot(bearStop, "zStopS", display = display.none)\n';
  const compiled = Pine.compile(src);
  const out = {};
  for (const c of list) {
    const r = Pine.run(compiled, bars, { inputs: { ...FAST, ...c.inputs }, timeframe: TF, symbol: sym });
    if (r.error) throw new Error(sym + ': ' + r.error);
    const stopL = r.plots.find((p) => p.title === 'zStopL').values;
    const stopS = r.plots.find((p) => p.title === 'zStopS').values;
    const by = new Map();
    for (const t of r.strategy.trades) {
      const k = t.entryId + '@' + t.entryBar;
      let s = by.get(k);
      if (!s) by.set(k, (s = { bar: t.entryBar, dir: t.dir, entry: t.entryPrice, qty: 0, pnl: 0 }));
      s.qty += t.qty;
      s.pnl += t.pnl;
    }
    const setups = [];
    for (const s of by.values()) {
      const stop = (s.dir > 0 ? stopL : stopS)[s.bar - 1]; // sinyal di bar sebelum entry terisi
      const risk = Math.abs(s.entry - stop) * s.qty;
      if (!(risk > 0)) continue;
      setups.push([bars[s.bar].time, +(s.pnl / risk).toFixed(4)]);
    }
    out[c.name] = setups;
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: out });
  return;
}

// ───────────────────────────── statistik ─────────────────────────────
function stats(rs) {
  const n = rs.length;
  if (!n) return { n: 0, exp: NaN, lo: NaN, hi: NaN, wr: NaN, pf: NaN, dd: NaN, sum: 0 };
  let sum = 0, gp = 0, gl = 0, wins = 0, peak = 0, cum = 0, dd = 0;
  for (const r of rs) {
    sum += r; cum += r;
    if (r > 0) { gp += r; wins++; } else gl -= r;
    peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
  }
  // bootstrap 95% untuk expectancy (seed tetap agar hasil bisa diulang)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const means = [];
  for (let b = 0; b < 2000; b++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += rs[Math.floor(rnd() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return { n, exp: sum / n, lo: means[50], hi: means[1949], wr: (100 * wins) / n, pf: gl ? gp / gl : Infinity, dd, sum };
}
const f2 = (x) => (isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '  ∞ ');
const fmt = (s) => s.n
  ? `n=${String(s.n).padStart(5)}  exp=${f2(s.exp)}R  95%[${f2(s.lo)}, ${f2(s.hi)}]  WR=${s.wr.toFixed(1).padStart(5)}%  PF=${(isFinite(s.pf) ? s.pf.toFixed(2) : '∞').padStart(5)}  total=${s.sum.toFixed(1).padStart(7)}R  DD=${s.dd.toFixed(1)}R`
  : 'n=    0';
const short = (name) => name === 'DEFAULT' ? 'DEFAULT' : Object.values(JSON.parse(name)).map((v) => (v === true ? 'Y' : v === false ? 'N' : v === 'TP1 / TP2 / TP3 (Partial)' ? 'Partial' : v)).join(' · ');
const day = (t) => new Date(t).toISOString().slice(0, 10);

// ───────────────────────────── main ─────────────────────────────
(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const sym of SYMBOLS) {
    if (fs.existsSync(cacheFile(sym))) continue;
    const bars = await Data.fetchBinance(sym, TF, BARS, (n) => process.stderr.write(`\r${sym}: ${n} bar`));
    process.stderr.write('\n');
    fs.writeFileSync(cacheFile(sym), 'time,open,high,low,close,volume\n' + bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume].join(',')).join('\n'));
  }
  const span = {};
  for (const sym of SYMBOLS) { const b = readBars(sym); span[sym] = [b[0].time, b[b.length - 1].time, b.length]; }

  const C = combos();
  const total = C.length * SYMBOLS.length;
  console.log(`${SYMBOLS.length} koin × ${C.length} kombinasi = ${total} backtest, ${WORKERS} worker, timeframe ${TF}`);
  for (const sym of SYMBOLS) console.log(`  ${sym.padEnd(9)} ${day(span[sym][0])} → ${day(span[sym][1])} (${span[sym][2]} bar)`);

  // bagi pekerjaan: (koin, potongan kombinasi)
  const jobs = [];
  const CHUNK = Math.ceil(C.length / 4);
  for (const sym of SYMBOLS) for (let k = 0; k < C.length; k += CHUNK) jobs.push({ sym, list: C.slice(k, k + CHUNK) });
  const res = {}; // res[combo][sym] = setups
  for (const c of C) res[c.name] = {};
  let doneRuns = 0;
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    let next = 0, active = 0;
    const launch = () => {
      if (next >= jobs.length) { if (!active) resolve(); return; }
      const job = jobs[next++];
      active++;
      const w = new Worker(__filename, { workerData: job, argv: process.argv.slice(2) });
      w.on('message', (m) => {
        if (m.progress) {
          doneRuns++;
          const el = (Date.now() - t0) / 1000;
          process.stderr.write(`\r${doneRuns}/${total} backtest (${el.toFixed(0)} s, sisa ±${((el / doneRuns) * (total - doneRuns) / 60).toFixed(0)} mnt)   `);
        }
        if (m.done) for (const [name, s] of Object.entries(m.done)) res[name][job.sym] = s;
      });
      w.on('error', reject);
      w.on('exit', () => { active--; launch(); });
    };
    for (let k = 0; k < WORKERS; k++) launch();
  });
  process.stderr.write('\n');
  fs.writeFileSync(path.join(DATA_DIR, `robust-${TF}.json`), JSON.stringify({ symbols: SYMBOLS, span, res }));

  const pool = (name, from = -Infinity, to = Infinity, syms = SYMBOLS) => {
    const all = [];
    for (const sym of syms) for (const [t, r] of res[name][sym] || []) if (t >= from && t < to) all.push([t, r]);
    all.sort((a, b) => a[0] - b[0]);
    return all.map((x) => x[1]);
  };

  // ── A) default saat ini ──
  console.log('\n══ A) Default saat ini (hasil tuning ENAUSDT 15m) ══');
  console.log('Semua koin, seluruh periode      :', fmt(stats(pool('DEFAULT'))));
  const others = SYMBOLS.filter((s) => s !== 'ENAUSDT');
  console.log('Tanpa ENAUSDT (belum pernah dilihat):', fmt(stats(pool('DEFAULT', -Infinity, Infinity, others))));
  if (SYMBOLS.includes('ENAUSDT')) console.log('ENAUSDT sebelum periode tuning   :', fmt(stats(pool('DEFAULT', -Infinity, Date.UTC(2026, 3, 2), ['ENAUSDT']))));
  console.log('Per koin:');
  for (const sym of SYMBOLS) console.log(`  ${sym.padEnd(9)}`, fmt(stats(pool('DEFAULT', -Infinity, Infinity, [sym]))));

  // ── semua kombinasi di seluruh data (hanya gambaran, BUKAN dasar pemilihan) ──
  console.log('\n══ Semua kombinasi, seluruh data (gambaran; memilih dari sini = overfitting) ══');
  const overall = C.map((c) => ({ c, s: stats(pool(c.name)) })).sort((a, b) => b.s.exp - a.s.exp);
  for (const { c, s } of overall.slice(0, 8)) console.log(`  ${short(c.name).padEnd(40)}`, fmt(s));
  console.log('  …');
  for (const { c, s } of overall.slice(-3)) console.log(`  ${short(c.name).padEnd(40)}`, fmt(s));

  // ── B) walk-forward ──
  const MONTH = 30.44 * 864e5;
  const start = Math.min(...SYMBOLS.map((s) => span[s][0]));
  const end = Math.max(...SYMBOLS.map((s) => span[s][1]));
  console.log(`\n══ B) Walk-forward: train ${TRAIN_M} bln → test ${TEST_M} bln, digeser ${TEST_M} bln; min ${MIN_SETUPS} setup di train ══`);
  const oos = [], picks = {};
  for (let s = start; s + (TRAIN_M + TEST_M) * MONTH <= end + TEST_M * MONTH * 0.5; s += TEST_M * MONTH) {
    const trEnd = s + TRAIN_M * MONTH, teEnd = Math.min(trEnd + TEST_M * MONTH, end + 1);
    let best = null;
    for (const c of C) {
      if (c.name === 'DEFAULT') continue; // default sendiri lahir dari data akhir → tidak boleh ikut
      const st = stats(pool(c.name, s, trEnd));
      if (st.n >= MIN_SETUPS && (!best || st.exp > best.st.exp)) best = { c, st };
    }
    if (!best) { console.log(`  ${day(s)} → ${day(trEnd)}: tidak ada kombinasi dengan ≥ ${MIN_SETUPS} setup`); continue; }
    const test = pool(best.c.name, trEnd, teEnd);
    oos.push(...test);
    picks[short(best.c.name)] = (picks[short(best.c.name)] || 0) + 1;
    console.log(`  train ${day(s)}→${day(trEnd)} pilih [${short(best.c.name)}] exp ${f2(best.st.exp)}R (n=${best.st.n})`);
    console.log(`     test ${day(trEnd)}→${day(teEnd)}:`, fmt(stats(test)));
  }
  console.log('\nGabungan semua jendela test (out-of-sample):', fmt(stats(oos)));
  console.log('Kombinasi yang terpilih:', Object.entries(picks).map(([k, v]) => `${v}× [${k}]`).join('  '));
  console.log('\nKolom: Take Profit · Fixed R · Entry Model · Key Level · Kill Zones');
})().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
