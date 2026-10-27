/* Luna — sumber data harga: Binance (REST + WebSocket), CSV, dan data demo. */
(function (root) {
  'use strict';

  const REST = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
  const WS = ['wss://data-stream.binance.vision/ws', 'wss://stream.binance.com:9443/ws'];

  const INTERVAL_MS = {
    '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
    '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '6h': 21600e3, '8h': 28800e3, '12h': 43200e3,
    '1d': 86400e3, '3d': 259200e3, '1w': 604800e3, '1M': 2592000e3,
  };

  const toBar = (k) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

  async function fetchJSON(path) {
    let lastErr;
    for (const base of REST) {
      try {
        const r = await fetch(base + path);
        if (!r.ok) {
          const body = await r.text();
          lastErr = new Error(`HTTP ${r.status}: ${body.slice(0, 160)}`);
          if (r.status === 400) throw lastErr; // simbol salah: tidak perlu coba server lain
          continue;
        }
        return await r.json();
      } catch (e) {
        lastErr = e;
        if (String(e.message).startsWith('HTTP 400')) break;
      }
    }
    throw lastErr || new Error('Gagal mengambil data');
  }

  /** Ambil `total` candle terakhir dari Binance (dengan paginasi mundur). */
  async function fetchBinance(symbol, interval, total, onProgress) {
    symbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let out = [];
    let endTime = null;
    while (out.length < total) {
      const limit = Math.min(1000, total - out.length);
      const q = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
      const rows = await fetchJSON(q);
      if (!rows.length) break;
      out = rows.map(toBar).concat(out);
      endTime = rows[0][0] - 1;
      if (onProgress) onProgress(out.length, total);
      if (rows.length < limit) break;
    }
    // jaga-jaga: urutkan & buang timestamp ganda (chart menolak data yang tidak naik)
    out.sort((a, b) => a.time - b.time);
    return out.filter((b, i) => i === 0 || b.time !== out[i - 1].time);
  }

  /** Langganan candle realtime. onKline(bar, isClosed). Mengembalikan fungsi untuk berhenti. */
  function subscribe(symbol, interval, onKline, onStatus) {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    let ws = null;
    let stopped = false;
    let attempt = 0;
    const connect = () => {
      if (stopped) return;
      const url = `${WS[attempt % WS.length]}/${stream}`;
      ws = new WebSocket(url);
      ws.onopen = () => onStatus && onStatus('live');
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (!m.k) return;
        const k = m.k;
        onKline({ time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, !!k.x);
      };
      ws.onclose = () => {
        if (stopped) return;
        onStatus && onStatus('reconnect');
        attempt++;
        setTimeout(connect, Math.min(15000, 1000 * attempt));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      stopped = true;
      if (ws) ws.close();
      onStatus && onStatus('off');
    };
  }

  /** Parse CSV: kolom time,open,high,low,close[,volume]. Waktu boleh ms, detik, atau teks tanggal. */
  function parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (!lines.length) throw new Error('File CSV kosong');
    const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    let cols = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 };
    let start = 0;
    const head = lines[0].split(sep).map((s) => s.trim().toLowerCase().replace(/"/g, ''));
    if (head.some((h) => /[a-z]/.test(h) && isNaN(Date.parse(h)))) {
      const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
      cols = {
        time: find('time', 'date', 'timestamp', 'open time', 'datetime'),
        open: find('open', 'o'), high: find('high', 'h'), low: find('low', 'l'), close: find('close', 'c'), volume: find('volume', 'vol', 'v'),
      };
      if (cols.time < 0) cols.time = 0;
      if ([cols.open, cols.high, cols.low, cols.close].some((c) => c < 0)) throw new Error('Kolom open/high/low/close tidak ditemukan di header CSV');
      start = 1;
    }
    const bars = [];
    for (let i = start; i < lines.length; i++) {
      const p = lines[i].split(sep).map((s) => s.trim().replace(/"/g, ''));
      let t = p[cols.time];
      let ms;
      if (/^\d+(\.\d+)?$/.test(t)) {
        ms = Number(t);
        if (ms < 1e11) ms *= 1000; // detik -> ms
        if (ms > 1e14) ms /= 1000; // mikrodetik -> ms
      } else {
        ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z');
      }
      const b = { time: ms, open: +p[cols.open], high: +p[cols.high], low: +p[cols.low], close: +p[cols.close], volume: cols.volume >= 0 ? +p[cols.volume] || 0 : 0 };
      if ([b.time, b.open, b.high, b.low, b.close].some((v) => !isFinite(v))) continue;
      bars.push(b);
    }
    if (!bars.length) throw new Error('Tidak ada baris data yang valid di CSV');
    bars.sort((a, b) => a.time - b.time);
    return bars.filter((b, i) => i === 0 || b.time !== bars[i - 1].time);
  }

  /**
   * Data acak (random walk) untuk mencoba dashboard tanpa internet.
   * Tiap candle dibangun dari 30 langkah kecil sehingga high/low konsisten dengan
   * jalur harga (wick tidak dibuat-buat) — hasil backtest di data ini mendekati impas.
   */
  function demo(n, interval) {
    const step = INTERVAL_MS[interval] || 3600e3;
    const now = Math.floor(Date.now() / step) * step;
    const scale = Math.sqrt(step / 3600e3); // volatilitas mengikuti timeframe
    let p = 60000;
    let vol = 0.006;
    const bars = [];
    for (let i = 0; i < n; i++) {
      vol = Math.max(0.002, Math.min(0.02, vol * (1 + (Math.random() - 0.5) * 0.2)));
      const o = p;
      let h = p, l = p;
      const sub = 30;
      const sd = (vol * scale) / Math.sqrt(sub);
      for (let k = 0; k < sub; k++) {
        p *= 1 + (Math.random() - 0.5) * 3.46 * sd;
        if (p > h) h = p;
        if (p < l) l = p;
      }
      bars.push({ time: now - (n - 1 - i) * step, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +p.toFixed(2), volume: +(50 + Math.random() * 200).toFixed(3) });
    }
    return bars;
  }

  const QUOTES = ['USDT', 'FDUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR', 'BRL', 'JPY', 'DAI', 'TUSD'];
  const POPULAR = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'TON', 'SUI', 'DOT', 'LTC', 'BCH',
    'NEAR', 'APT', 'UNI', 'ICP', 'PEPE', 'SHIB', 'FET', 'RENDER', 'ARB', 'OP', 'INJ', 'ATOM', 'FIL', 'HBAR', 'XLM', 'ETC',
    'TIA', 'SEI', 'WIF', 'BONK', 'FLOKI', 'AAVE', 'MKR', 'LDO', 'STX', 'IMX', 'GALA', 'SAND', 'MANA', 'AXS', 'JUP', 'PYTH',
    'ENA', 'WLD', 'ORDI', 'TAO', 'ONDO', 'TRUMP', 'PENGU', 'VIRTUAL', 'HYPE', 'POL', 'ALGO', 'VET', 'CRV'];

  function splitSymbol(sym) {
    for (const q of QUOTES) if (sym.endsWith(q) && sym.length > q.length) return { base: sym.slice(0, -q.length), quote: q };
    return { base: sym, quote: '' };
  }

  /**
   * Daftar semua pair spot Binance yang aktif diperdagangkan + statistik 24 jam.
   * Jika Binance tidak bisa diakses, kembalikan daftar koin populer (tanpa harga).
   */
  async function fetchSymbols() {
    try {
      const rows = await fetchJSON('/api/v3/ticker/24hr?type=MINI');
      const out = [];
      for (const r of rows) {
        const qv = +r.quoteVolume;
        if (!(qv > 0) || +r.closeTime < Date.now() - 2 * 86400e3) continue; // pair yang tidak aktif
        const { base, quote } = splitSymbol(r.symbol);
        const open = +r.openPrice, last = +r.lastPrice;
        out.push({ symbol: r.symbol, base, quote, price: last, change: open ? ((last - open) / open) * 100 : NaN, quoteVolume: qv });
      }
      return { list: out, live: true };
    } catch (e) {
      return { list: POPULAR.map((b) => ({ symbol: b + 'USDT', base: b, quote: 'USDT', price: NaN, change: NaN, quoteVolume: NaN })), live: false, error: e.message };
    }
  }

  const api = { fetchBinance, fetchSymbols, splitSymbol, subscribe, parseCSV, demo, INTERVAL_MS, QUOTES };
  root.LunaData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
