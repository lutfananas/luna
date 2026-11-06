// uji independen aturan SNDK di saham/komoditas perpetual lain (parameter dikunci dari SNDK sebelum Sep)
const V = require('./spike.js'), Data = require('../../js/data.js'), fs = require('fs');
const files = fs.readdirSync(process.env.PERP_DATA || require('path').join(__dirname, '../../data/perps')).filter((f) => f.endsWith('-15m.csv'));
const fee = 0.0005;
const cfgs = { '15m': { bpd: 96, ex: { k: 4, r1: 1, r2: 2, w1: 0.5, maxB: 96 } }, '1h': { bpd: 24, ex: { k: 2, r1: 1, r2: 2, w1: 0.5, maxB: 48 } } };
for (const tf of ['15m', '1h']) for (const mode of ['ikut', 'lawan']) {
  const all = []; const rows = []; let pos = 0, n = 0;
  for (const f of files) {
    const sym = f.replace('-15m.csv', ''), path = `${process.env.PERP_DATA || require('path').join(__dirname, '../../data/perps')}/${sym}-${tf}.csv`;
    if (!fs.existsSync(path)) continue;
    const bars = Data.parseCSV(fs.readFileSync(path, 'utf8')); if (bars.length < 1500) continue;
    const { X, atr, vSlot } = V.features(bars, cfgs[tf].bpd);
    let busy = -1, sum = 0, cnt = 0;
    for (let i = 0; i < bars.length; i++) {
      if (!X[i] || i < busy || !(vSlot[i] >= 5)) continue;
      const sg = Math.sign(bars[i].close - bars[i].open); if (!sg) continue;
      const l = V.label(bars, atr, i, mode === 'ikut' ? sg : -sg, cfgs[tf].ex, fee); if (!l) continue;
      busy = l.exit; all.push(l.r); sum += l.r; cnt++;
    }
    n++; if (sum > 0) pos++; rows.push(`${sym.replace('USDT', '')}:${cnt}/${sum >= 0 ? '+' : ''}${sum.toFixed(1)}`);
  }
  const m = all.reduce((s, v) => s + v, 0) / all.length, sd = Math.sqrt(all.reduce((s, v) => s + (v - m) ** 2, 0) / all.length);
  console.log(`${tf} ${mode.padEnd(5)} spike≥5×: n ${all.length} WR ${(100 * all.filter((x) => x > 0).length / all.length).toFixed(0)}% R/trade ${m.toFixed(3)} t ${(m / sd * Math.sqrt(all.length)).toFixed(2)} pasar+ ${pos}/${n}`);
  if (mode === 'ikut') console.log('   ', rows.join(' '));
}
