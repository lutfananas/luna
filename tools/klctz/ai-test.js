// Jalankan: SYM=1 CYC720=1 NO1200=1 WARM=800 node tools/klctz/ai-test.js
const A = require('./ai.js'), fs = require('fs');
const ex = { k: 3, r1: 1, r2: 2, w1: 0.5, maxB: 72 };
const rows = A.dataset('1h', ex, +(process.env.FEE || 0.001)), tr = rows.filter((r) => r.p === 0);
const m = A.boost(tr, { nTrees: 80, lr: 0.1, minLeaf: 3000 });
const sc = tr.map((r) => m.score(r)).sort((a, b) => a - b);
for (const q of [0.95, 0.99]) {
  const th = sc[Math.floor(q * (sc.length - 1))];
  console.log(`== top ${((1 - q) * 100).toFixed(0)}% fee ${process.env.FEE || 0.001}`);
  for (const p of [0, 1, 2]) console.log(['latih', 'valid', 'TES  '][p], A.fmt(A.evalSeq(rows, m, th, p)));
  for (const d of [1, -1]) console.log('TES ' + (d > 0 ? 'long ' : 'short'), A.fmt(A.evalSeq(rows.filter((r) => r.dd === d), m, th, 2)));
}
