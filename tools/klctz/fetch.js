// Unduh data 4H/1H 16 koin ke data/klctz (atau $KLC_DATA):  node tools/klctz/fetch.js
const fs = require('fs'), path = require('path'), Data = require('../../js/data.js');
const DATA = process.env.KLC_DATA || path.join(__dirname, '../../data/klctz');
const { SY } = require('./opt.js');
fs.mkdirSync(DATA, { recursive: true });
(async () => {
  for (const [tf, n] of [['4h', 8000], ['1h', 26000]]) for (const s of SY) {
    const f = path.join(DATA, `${s}-${tf}-${n}.csv`);
    if (fs.existsSync(f)) continue;
    const b = await Data.fetchBinance(s, tf, n, () => {});
    fs.writeFileSync(f, 'time,open,high,low,close,volume\n' + b.map((x) => [x.time, x.open, x.high, x.low, x.close, x.volume].join(',')).join('\n'));
    console.log(s, tf, b.length);
  }
})();
