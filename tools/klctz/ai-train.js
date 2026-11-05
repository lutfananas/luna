// Jalankan: SYM=1 CYC720=1 NO1200=1 WARM=800 node tools/klctz/ai-train.js
const A = require('./ai.js'), fs = require('fs');
const ex = { k: 3, r1: 1, r2: 2, w1: 0.5, maxB: 72 };
const rows = A.dataset('1h', ex, 0.001), trv = rows.filter((r) => r.p < 2);
const m = A.boost(trv, { nTrees: 80, lr: 0.1, minLeaf: 3000 });
const sc = trv.map((r) => m.score(r)).sort((a, b) => a - b);
const th5 = sc[Math.floor(0.95 * (sc.length - 1))], th1 = sc[Math.floor(0.99 * (sc.length - 1))];
for (const [nm, th] of [['Normal 5%', th5], ['Ketat 1%', th1]]) console.log(nm, 'TES (model final)', A.fmt(A.evalSeq(rows, m, th, 2)));
fs.writeFileSync(__dirname + '/luna-ai-model.json', JSON.stringify({ f0: m.f0, trees: m.trees, th5, th1 }));
console.log('trees', m.trees.length, 'th5', th5, 'th1', th1);
