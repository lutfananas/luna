#!/usr/bin/env node
/*
 * Tuning & backtest SATTAM CRT+TBS Strategy.
 *
 *   node tools/tune-crt.js --symbol ENAUSDT --tf 15m --bars 20000
 *   node tools/tune-crt.js --csv data/ENAUSDT-15m.csv --tf 15m
 *   node tools/tune-crt.js --csv data/ENAUSDT-15m.csv --tf 15m --grid partial   (TP1/TP2/TP3)
 *
 * Data dibagi: 70% awal untuk tuning (in-sample), 30% akhir untuk verifikasi
 * (out-of-sample). Kandidat hanya dinilai lolos jika tetap bagus di data verifikasi.
 */
'use strict';
const fs = require('fs');
const path = require('path');
globalThis.LunaTA = require('../js/ta.js');
globalThis.LunaBacktest = require('../js/backtest.js');
globalThis.LunaPineExt = require('../js/pine-ext.js');
const Pine = require('../js/pine.js');
const CRT = require('../js/scripts-crt.js');
const Data = require('../js/data.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SYMBOL = arg('symbol', 'ENAUSDT');
const TF = arg('tf', '15m');
const BARS = +arg('bars', 20000);
const CSV = arg('csv', null);
const SPLIT = +arg('split', 0.7);
const MIN_TRADES = +arg('min-trades', 30);
const TARGET_WR = +arg('target-wr', 60);
const GRID_NAME = arg('grid', 'single');

async function loadBars() {
  if (CSV) return Data.parseCSV(fs.readFileSync(CSV, 'utf8'));
  const cache = path.join(__dirname, '..', 'data', `${SYMBOL}-${TF}.csv`);
  const bars = await Data.fetchBinance(SYMBOL, TF, BARS, (n, t) => process.stderr.write(`\rmengunduh ${n}/${t}`));
  process.stderr.write('\n');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, 'time,open,high,low,close,volume\n' + bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume].join(',')).join('\n'));
  console.log(`data disimpan: ${cache}`);
  return bars;
}

const compiled = Pine.compile(CRT.strategy);
function test(bars, inputs) {
  const r = Pine.run(compiled, bars, { inputs, timeframe: TF, symbol: SYMBOL });
  if (r.error) throw new Error(r.error);
  return withSetups(r.strategy);
}

// Partial exit memecah satu posisi menjadi beberapa trade (seperti TradingView).
// "setup" = satu posisi utuh (semua bagiannya): menang jika total PnL-nya > 0.
function withSetups(st) {
  const m = { ...st.metrics };
  const by = new Map();
  for (const t of st.trades) {
    const k = t.entryId + '@' + t.entryBar;
    by.set(k, (by.get(k) || 0) + t.pnl);
  }
  const pnls = [...by.values()];
  const wins = pnls.filter((x) => x > 0).length;
  m.setups = pnls.length;
  m.setupWinRate = pnls.length ? (100 * wins) / pnls.length : 0;
  return m;
}

// ruang pencarian (judul input persis seperti di script)
const GRIDS = {};
GRIDS.single = {
  'Take Profit': ['Fixed R', 'T1 (50% Range)', 'T2 (Opposite Extreme)'],
  'Fixed R Multiple': [0.5, 0.75, 1.0, 1.5],
  'Entry Model': ['All', 'Model #1', 'CISD', 'MSS+FVG'],
  'Require Key Level': [true, false],
  'Min Risk:Reward (to T2)': [0, 1.5],
  'Min Stop Distance (× ATR)': [0.5, 1.0],
  'Trade With Daily Bias Only': [false, true],
  'Kill Zones Only (New York time)': [false, true],
};
// TP berjenjang: TP1 = R tetap, TP2 = EQ, TP3 = ujung range; SL sisa bisa digeser
GRIDS.partial = {
  'Take Profit': ['TP1 / TP2 / TP3 (Partial)'],
  'Fixed R Multiple': [0.5, 0.6, 0.75, 1.0],
  'TP1 Close %': [30, 50, 70],
  'TP2 Close %': [20, 30],
  'Move SL After TP': ['None', 'Break-even after TP1', 'BE after TP1, TP1 after TP2'],
  'Entry Model': ['CISD', 'All'],
  'Require Key Level': [true],
  'Min Risk:Reward (to T2)': [1.5],
  'Min Stop Distance (× ATR)': [0.5],
  'Trade With Daily Bias Only': [false],
  'Kill Zones Only (New York time)': [true, false],
};
const GRID = GRIDS[GRID_NAME];
if (!GRID) throw new Error('grid tidak dikenal: ' + GRID_NAME);

function* combos() {
  const keys = Object.keys(GRID);
  const idx = keys.map(() => 0);
  for (;;) {
    const c = {};
    keys.forEach((k, j) => (c[k] = GRID[k][idx[j]]));
    if (GRID_NAME !== 'single' || c['Take Profit'] === 'Fixed R' || c['Fixed R Multiple'] === 1.0) yield c; // R hanya relevan untuk Fixed R / Partial
    let j = keys.length - 1;
    while (j >= 0 && ++idx[j] === GRID[keys[j]].length) idx[j--] = 0;
    if (j < 0) return;
  }
}

const fmt = (m) => `setup=${String(m.setups).padStart(4)} WRsetup=${m.setupWinRate.toFixed(1).padStart(5)}% | trades=${String(m.totalTrades).padStart(4)} WR=${m.winRate.toFixed(1).padStart(5)}% PF=${(isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞').padStart(5)} net=${m.netProfitPct.toFixed(1).padStart(6)}% DD=${m.maxDrawdownPct.toFixed(1).padStart(5)}%`;

(async () => {
  const bars = await loadBars();
  const cut = Math.floor(bars.length * SPLIT);
  const train = bars.slice(0, cut), testSet = bars.slice(cut);
  const d = (b) => new Date(b.time).toISOString().slice(0, 10);
  console.log(`${SYMBOL} ${TF}: ${bars.length} bar (${d(bars[0])} → ${d(bars[bars.length - 1])})`);
  console.log(`tuning: ${d(train[0])} → ${d(train[train.length - 1])} | verifikasi: ${d(testSet[0])} → ${d(testSet[testSet.length - 1])}\n`);
  console.log('Default     :', fmt(test(bars, {})));

  const results = [];
  let n = 0;
  const t0 = Date.now();
  for (const c of combos()) {
    const m = test(train, c);
    n++;
    if (n % 50 === 0) process.stderr.write(`\r${n} kombinasi diuji (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (m.totalTrades >= MIN_TRADES) results.push({ c, m });
  }
  process.stderr.write('\n');
  // syarat: WR tinggi DAN tetap untung (PF > 1.1) di data tuning.
  // urut WR lalu PF. Untuk partial dipakai WR per setup (satu posisi utuh), bukan per potongan exit.
  const wrOf = (m) => (GRID_NAME === 'single' ? m.winRate : m.setupWinRate);
  const good = results.filter((r) => r.m.profitFactor > 1.1).sort((a, b) => wrOf(b.m) - wrOf(a.m) || b.m.profitFactor - a.m.profitFactor);
  console.log(`\n${n} kombinasi, ${good.length} untung di data tuning. 10 teratas (WR), lalu diverifikasi:\n`);
  const out = [];
  for (const r of good.slice(0, 10)) {
    const v = test(testSet, r.c);
    out.push({ ...r, v });
    console.log('IN :', fmt(r.m));
    const wr = GRID_NAME === 'single' ? v.winRate : v.setupWinRate;
    console.log('OUT:', fmt(v), wr >= TARGET_WR && v.profitFactor > 1 ? '  ✅ lolos' : '  ❌');
    console.log('    ', JSON.stringify(r.c), '\n');
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', `tune-${SYMBOL}-${TF}-${GRID_NAME}.json`), JSON.stringify(out, null, 2));
})().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
