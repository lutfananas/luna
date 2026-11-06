// model final: 150 pohon (lr 0.05, minLeaf 1500), dilatih di 32 koin sampai data terbaru, ambang top 8% / 3%
process.env.HOLD = '1';
const fs = require('fs');
let src = fs.readFileSync(__dirname + '/ai-walkforward.js', 'utf8');
src = src.slice(0, src.indexOf('const folds = '));
src += `
const all = base.concat(hold);
const tr = all; // semua label yang sudah selesai
const m = A.boost(tr, { nTrees: 150, lr: 0.05, minLeaf: 1500 });
const sc = tr.filter((_, k) => k % 3 === 0).map((r) => m.score(r)).sort((x, y) => x - y);
const thN = sc[Math.floor(0.92 * (sc.length - 1))], thK = sc[Math.floor(0.97 * (sc.length - 1))];
fs.writeFileSync(__dirname + '/luna-ai-model.json', JSON.stringify({ f0: m.f0, trees: m.trees, thN, thK, coins: [...new Set(tr.map((r) => r.coin))], until: new Date(tr.reduce((a, r) => Math.max(a, r.exitT), 0)).toISOString() }));
console.log('baris', tr.length, 'pohon', m.trees.length, 'thN', thN, 'thK', thK, ((Date.now() - t0) / 1000).toFixed(0) + 's');
`;
fs.writeFileSync(__dirname + '/deploy-run.js', src);
