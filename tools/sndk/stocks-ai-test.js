process.env.SYM = '1'; process.env.CYC720 = '1'; process.env.NO1200 = '1'; process.env.WARM = '800';
const A = require('../klctz/ai.js'), Data = require('../../js/data.js'), fs = require('fs');
const M = require('../klctz/luna-ai-model.json');
const score = (x) => M.trees.reduce((a, t) => a + A.predTree(t, { x, d: 0 }), M.f0);
const ex = { k: 3, r1: 1, r2: 2, w1: 0.5, maxB: 72 };
const syms = fs.readdirSync(process.env.PERP_DATA || require('path').join(__dirname, '../../data/perps')).filter((f) => f.endsWith('-1h.csv')).map((f) => f.replace('-1h.csv', ''));
for (const fee of [0.0005, 0.001]) for (const [nm, th] of [['Normal', M.th5], ['Ketat', M.th1]]) {
  const all = [], rows = []; let pos = 0, n = 0;
  for (const s of syms) {
    const bars = Data.parseCSV(fs.readFileSync(`${process.env.PERP_DATA || require('path').join(__dirname, '../../data/perps')}/${s}-1h.csv`, 'utf8')); if (bars.length < 1500) continue;
    const { X, atr } = A.features(bars); let busy = -1, sum = 0, c = 0;
    for (let i = 0; i < bars.length; i++) {
      if (!X[i] || i < busy) continue;
      const sl = score(X[i]), ss = score(A.sym(X[i], -1)), d = sl >= ss ? 1 : -1;
      if (Math.max(sl, ss) < th) continue;
      const l = A.label(bars, atr, i, d, ex, fee); if (!l) continue;
      busy = l.exit; all.push(l.r); sum += l.r; c++;
    }
    n++; if (sum > 0) pos++; rows.push(`${s.replace('USDT', '')}:${c}/${sum >= 0 ? '+' : ''}${sum.toFixed(1)}`);
  }
  const m = all.reduce((q, v) => q + v, 0) / all.length, sd = Math.sqrt(all.reduce((q, v) => q + (v - m) ** 2, 0) / all.length);
  console.log(`Luna AI ${nm} fee ${fee * 100}% di 19 saham/komoditas 1H: n ${all.length} WR ${(100 * all.filter((x) => x > 0).length / all.length).toFixed(0)}% R/trade ${m.toFixed(3)} t ${(m / sd * Math.sqrt(all.length)).toFixed(2)} pasar+ ${pos}/${n}`);
  if (fee === 0.0005 && nm === 'Normal') console.log('   ', rows.join(' '));
}
