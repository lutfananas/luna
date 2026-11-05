const DATA = process.env.KLC_DATA || require('path').join(__dirname, '../../data/klctz');
const fs = require('fs');
const tf = process.argv[2];
const all = JSON.parse(fs.readFileSync(`${DATA}/opt-${tf}.json`, 'utf8'));
const f = (o) => `n ${String(o.n).padStart(5)} WR ${(100 * o.wr).toFixed(1)}% R ${o.mean >= 0 ? '+' : ''}${o.mean.toFixed(3)} t ${o.t.toFixed(2)} koin+ ${o.coinPos}`;
const short = (c) => `tol${c.tol} src${c.minSrc} sw${c.swing} rnd${+c.round} piv${c.piv} prof${c.prof} mode${c.mode} side${c.side} buf${c.slBuf} R${c.r1}/${c.r2}/${c.r3} w${c.w1}/${c.w2} mag${+c.magnet} max${c.maxBars}`;
console.log('DEFAULT:'); all.filter((x) => x.def).forEach((x) => console.log(' ', short(x.cfg), '\n   latih', f(x.st[0]), '| valid', f(x.st[1]), '| TES', f(x.st[2])));
// aturan dipilih SEBELUM melihat tes: urut t-stat latih (n ≥ 300, koin+ ≥ 10), top 20 → pilih R validasi terbaik (n ≥ 100)
const cand = all.filter((x) => x.st[0].n >= 300 && x.st[0].coinPos >= 10).sort((a, b) => b.st[0].t - a.st[0].t).slice(0, 20);
console.log(`\nTOP 20 menurut latih (dari ${all.length}):`);
cand.forEach((x, k) => console.log(String(k + 1).padStart(2), short(x.cfg), '\n    latih', f(x.st[0]), '| valid', f(x.st[1])));
const best = cand.filter((x) => x.st[1].n >= 100).sort((a, b) => b.st[1].mean - a.st[1].mean)[0];
console.log('\n→ DIPILIH (validasi terbaik):', short(best.cfg));
console.log('   latih', f(best.st[0]), '\n   valid', f(best.st[1]), '\n   TES  ', f(best.st[2]));
const tests = cand.map((x) => x.st[2].mean).sort((a, b) => a - b);
console.log('\nsebaran R tes top-20: min', tests[0].toFixed(3), 'median', tests[10].toFixed(3), 'max', tests[19].toFixed(3), '| positif', tests.filter((v) => v > 0).length + '/20');
const allTest = all.map((x) => x.st[2].mean).filter(isFinite).sort((a, b) => a - b);
console.log('semua konfigurasi di tes: positif', allTest.filter((v) => v > 0).length + '/' + allTest.length);
fs.writeFileSync(`${DATA}/best-${tf}.json`, JSON.stringify(best.cfg));
