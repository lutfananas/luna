const M = require('./mtf.js'), Data = require('../../js/data.js'), fs = require('fs');
const S = process.env.EMA_DATA || require('path').join(__dirname, '../../data');
const fee = 0.0005, SPLIT = Date.UTC(2026, 8, 1);
const G = M.grid2();
const markets = [];
for (const f of fs.readdirSync(`${S}/ema`)) if (/USDT-5m\.csv$/.test(f) && !f.startsWith('SNDK')) markets.push({ name: f.replace('-5m.csv', ''), file: `${S}/ema/${f}`, kind: 'saham' });
for (const f of fs.readdirSync(`${S}/m5`)) if (/USDT-5m\.csv$/.test(f)) markets.push({ name: f.replace('-5m.csv', ''), file: `${S}/m5/${f}`, kind: 'crypto' });
const acc = G.map(() => ({ saham: { n: 0, s: 0, w: 0, pos: 0, k: 0 }, crypto: { n: 0, s: 0, w: 0, pos: 0, k: 0 } }));
const sndk = M.prepare(Data.parseCSV(fs.readFileSync(`${S}/ema/SNDKUSDT-5m.csv`, 'utf8')));
const sres = G.map((p) => { const tr = M.simulate(sndk, p, fee); return { a: M.stats(tr.filter((x) => x.t < SPLIT)), b: M.stats(tr.filter((x) => x.t >= SPLIT)) }; });
for (const mk of markets) {
  const b = Data.parseCSV(fs.readFileSync(mk.file, 'utf8')); for (const x of b) if (x.time > 1e14) x.time = Math.floor(x.time / 1000);
  const tf = M.prepare(b);
  G.forEach((p, k) => { const st = M.stats(M.simulate(tf, p, fee)); const o = acc[k][mk.kind]; o.k++; if (!st.n) return; o.n += st.n; o.s += st.tot; o.w += st.wr * st.n; if (st.tot > 0) o.pos++; });
  process.stderr.write(mk.name + ' ');
}
const out = G.map((p, k) => ({ p, sndk: sres[k], saham: acc[k].saham, crypto: acc[k].crypto }));
fs.writeFileSync(require('path').join(require('os').tmpdir(), 'ema-cross.json'), JSON.stringify(out));
const R = (o) => (o.n ? o.s / o.n : NaN), W = (o) => (o.n ? o.w / o.n : NaN);
console.log('\n=== Per kombinasi timeframe: median dari semua setelan ===');
for (const [T, Lv, X] of M.COMBOS) {
  const rs = out.filter((x) => x.p.T === T && x.p.Lv === Lv && x.p.X === X);
  const med = (arr) => { const v = arr.filter(isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; };
  console.log(`tren ${T.padEnd(3)} level ${Lv.padEnd(3)} eks ${X.padEnd(3)} | SNDK <Sep R ${med(rs.map((x) => x.sndk.a.m)).toFixed(3)} | SNDK Sep-Nov R ${med(rs.map((x) => x.sndk.b.m)).toFixed(3)} | saham R ${med(rs.map((x) => R(x.saham))).toFixed(3)} WR ${(100 * med(rs.map((x) => W(x.saham)))).toFixed(0)}% | crypto R ${med(rs.map((x) => R(x.crypto))).toFixed(3)} WR ${(100 * med(rs.map((x) => W(x.crypto)))).toFixed(0)}%`);
}
const pos = out.filter((x) => R(x.saham) > 0 && R(x.crypto) > 0);
console.log(`\nsetelan yang positif di saham DAN crypto: ${pos.length}/${out.length}`);
const best = out.filter((x) => x.sndk.a.n >= 15).map((x) => ({ x, sc: Math.min(R(x.saham), R(x.crypto)) })).sort((a, b) => b.sc - a.sc).slice(0, 8);
const f = (o) => `n ${o.n} WR ${(100 * W(o)).toFixed(0)}% R ${R(o) >= 0 ? '+' : ''}${R(o).toFixed(3)} pasar+ ${o.pos}/${o.k}`;
const fs2 = (s) => `n ${s.n} WR ${isNaN(s.wr) ? '--' : (100 * s.wr).toFixed(0) + '%'} R ${isNaN(s.m) ? '--' : s.m.toFixed(3)}`;
console.log('\n=== 8 setelan terbaik menurut pasar LAIN (min R saham & crypto) ===');
for (const { x } of best) console.log(M.name(x.p), '\n   saham', f(x.saham), '| crypto', f(x.crypto), '| SNDK <Sep', fs2(x.sndk.a), '| SNDK Sep-Nov', fs2(x.sndk.b));
