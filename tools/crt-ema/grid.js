// grid SATTAM CRT+TBS + CISD + EMA 48/380 MTF (strategy Pine asli) di satu pasar
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const SPLIT = Date.UTC(2026, 8, 1);
function cfgs() {
  const out = [];
  for (const [tf, htf] of [['5m', '240'], ['15m', '240'], ['5m', '60'], ['15m', '60'], ['1h', '1D']])
    for (const model of ['Model #1', 'CISD', 'MSS+FVG', 'All']) for (const tbs of [false, true]) for (const kl of [false, true])
      for (const emaF of ['Mati', 'Searah 4H', 'Searah 4H & 1H']) for (const emaLv of [false, true]) for (const kz of [false, true])
        out.push({ tf, htf, model, tbs, kl, emaF, emaLv, kz });
  return out;
}
function runOne(Pine, C, compiled, barsBy, c, sym) {
  const inputs = { 'HTF Mode': 'Manual', 'Manual HTF': c.htf, 'Entry Model': c.model, 'Require TBS on the Sweep': c.tbs, 'Require Key Level': c.kl, 'Filter tren EMA 48/380': c.emaF, 'Sweep harus di EMA 48/380 (4H/1H)': c.emaLv, 'Kill Zones Only (New York time)': c.kz, 'Draw Trade Plan (Entry · SL · TP1-3)': false };
  const r = Pine.run(compiled, barsBy[c.tf], { timeframe: c.tf === '1h' ? '1h' : c.tf, symbol: sym, inputs });
  if (r.error) return { err: r.error };
  const eq = r.strategy.equity, pos = new Map();
  for (const t of r.strategy.trades) { const e = pos.get(t.entryBar) || { pnl: 0, base: eq[t.entryBar - 1] || 1000, t: t.entryTime }; e.pnl += t.pnl; pos.set(t.entryBar, e); }
  return { T: [...pos.values()].map((p) => [p.t, p.pnl / (0.01 * p.base)]) };
}
function loadBars(file) {
  const Data = require('../../js/data.js'), M = require('../ema-mtf/mtf.js');
  const b5 = Data.parseCSV(fs.readFileSync(file, 'utf8')); for (const x of b5) if (x.time > 1e14) x.time = Math.floor(x.time / 1000);
  return { '5m': b5, '15m': M.agg(b5, M.MS['15m']), '1h': M.agg(b5, M.MS['1h']) };
}
if (!isMainThread) {
  const Pine = require('../../js/pine.js'), C = require('../../js/scripts-crt.js');
  const compiled = Pine.compile(C.strategy.replace('commission_value = 0.1', 'commission_value = 0.05'));
  const barsBy = loadBars(workerData.file);
  const out = [];
  for (const c of workerData.list) out.push({ c, ...runOne(Pine, C, compiled, barsBy, c, workerData.sym) });
  parentPort.postMessage(out);
} else if (require.main === module) {
  const file = process.argv[2], sym = process.argv[3], outFile = process.argv[4], only = process.argv[5] ? JSON.parse(fs.readFileSync(process.argv[5], 'utf8')) : null;
  const list = only || cfgs(), t0 = Date.now();
  const parts = [0, 1, 2, 3].map((w) => list.filter((_, i) => i % 4 === w));
  Promise.all(parts.map((l) => new Promise((ok) => { const wk = new Worker(__filename, { workerData: { file, sym, list: l } }); wk.on('message', ok); wk.on('error', (e) => { console.error(e); ok([]); }); }))).then((ps) => {
    const res = ps.flat(); fs.writeFileSync(outFile, JSON.stringify(res)); console.log(sym, res.length, 'run', ((Date.now() - t0) / 1000).toFixed(0) + 's', 'error', res.filter((x) => x.err).length);
  });
}
module.exports = { cfgs, SPLIT };
