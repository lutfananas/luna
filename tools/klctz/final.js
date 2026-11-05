const DATA = process.env.KLC_DATA || require('path').join(__dirname, '../../data/klctz');
const M = require('./ml.js'), fs = require('fs');
const cfg = { tol: 0.75, minSrc: 3, swing: 20, round: false, piv: 0, prof: 3, mode: 2, side: 0, slBuf: 1, r1: 1.5, r2: 3, r3: 4.5, w1: 0.5, w2: 0.3, magnet: true, maxBars: 120 };
const rows = M.gather('4h', cfg);
const trv = rows.filter((r) => r.p < 2);
const m = M.logistic(trv, 0.01, 600);
const sc = trv.map((r) => m.score(r.x)).sort((a, b) => a - b);
const th = sc[Math.floor(0.7 * (sc.length - 1))];
console.log('tanpa ML  latih+valid', M.fmt({ ...M.evalSeq(rows, null, 0, 0) }), '\n           TES        ', M.fmt(M.evalSeq(rows, null, 0, 2)));
for (const p of [0, 1, 2]) console.log('ML top30% periode', p, M.fmt(M.evalSeq(rows, m, th, p)));
// per koin di tes
const per = {}; for (const r of rows) if (r.p === 2) (per[r.coin] = per[r.coin] || []).push(r);
console.log('threshold z', th.toFixed(4), 'prob', (1 / (1 + Math.exp(-th))).toFixed(3));
console.log(JSON.stringify({ feats: M.FEATS, m: m.S.m, sd: m.S.sd, w: m.w, b: m.b, th }));
fs.writeFileSync(DATA + '/model.json', JSON.stringify({ feats: M.FEATS, m: m.S.m, sd: m.S.sd, w: m.w, b: m.b, th, cfg }));
// dir split in test
for (const d of [1, -1]) { const rr = rows.map((r) => ({ ...r })).filter((r) => r.x[0] === d); console.log('arah', d, 'TES ML', M.fmt(M.evalSeq(rr, m, th, 2)), '| tanpa', M.fmt(M.evalSeq(rr, null, 0, 2))); }
