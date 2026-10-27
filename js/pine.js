/*
 * Luna — interpreter "Pine Script-like".
 *
 * Script ditulis dengan sintaks mirip Pine Script v5, lalu diterjemahkan
 * (transpile) menjadi JavaScript dan dijalankan bar demi bar, persis seperti
 * cara kerja Pine di TradingView: setiap bar script dijalankan ulang, variabel
 * biasa dihitung ulang, variabel `var` mempertahankan nilainya, dan `x[1]`
 * mengambil nilai bar sebelumnya.
 */
(function (root) {
  'use strict';

  const TA = root.LunaTA || (typeof require !== 'undefined' ? require('./ta.js') : null);
  const BT = root.LunaBacktest || (typeof require !== 'undefined' ? require('./backtest.js') : null);
  const EXT = root.LunaPineExt || (typeof require !== 'undefined' ? require('./pine-ext.js') : null);

  class PineError extends Error {
    constructor(msg, line) {
      super(line ? `Baris ${line}: ${msg}` : msg);
      this.line = line;
    }
  }

  // ------------------------------------------------------------------
  // Tokenizer
  // ------------------------------------------------------------------
  const TOKEN_RE = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(:=|\+=|-=|\*=|\/=|%=|==|!=|<=|>=|=>|[=<>+\-*\/%?:(),\[\]]))/y;

  function tokenize(text, line) {
    const out = [];
    TOKEN_RE.lastIndex = 0;
    let pos = 0;
    while (pos < text.length) {
      if (/^\s*$/.test(text.slice(pos))) break;
      TOKEN_RE.lastIndex = pos;
      const m = TOKEN_RE.exec(text);
      if (!m) throw new PineError(`Karakter tidak dikenal: "${text.slice(pos).trim()[0]}"`, line);
      pos = TOKEN_RE.lastIndex;
      if (m[1] !== undefined) out.push({ t: 'num', v: m[1] });
      else if (m[2] !== undefined) out.push({ t: 'str', v: m[2] });
      else if (m[3] !== undefined) out.push({ t: 'str', v: JSON.stringify(m[3]) });
      else if (m[4] !== undefined) out.push({ t: 'id', v: m[4] });
      else out.push({ t: 'op', v: m[5] });
    }
    return out;
  }

  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '/' && s[i + 1] === '/') return s.slice(0, i);
    }
    return s;
  }

  function indentOf(s) {
    let n = 0;
    for (const c of s) {
      if (c === ' ') n++;
      else if (c === '\t') n += 4;
      else break;
    }
    return n;
  }

  const CONT_END = new Set([',', '(', '[', '+', '-', '*', '/', '%', '?', ':', '=', ':=', '==', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not']);

  // Gabungkan baris lanjutan menjadi baris logis.
  function logicalLines(src) {
    const raw = src.replace(/\r/g, '').split('\n');
    const lines = [];
    let cur = null;
    for (let i = 0; i < raw.length; i++) {
      const s = stripComment(raw[i]);
      if (!s.trim()) continue;
      const ind = indentOf(s);
      const toks = tokenize(s.trim(), i + 1);
      if (cur && (cur.depth > 0 || cur.cont || (ind > cur.indent && ind % 4 !== 0))) {
        cur.tokens.push(...toks);
      } else {
        if (cur) lines.push(cur);
        cur = { indent: ind, tokens: toks, line: i + 1 };
      }
      let d = 0;
      for (const t of cur.tokens) {
        if (t.t === 'op' && (t.v === '(' || t.v === '[')) d++;
        else if (t.t === 'op' && (t.v === ')' || t.v === ']')) d--;
      }
      cur.depth = d;
      const lastTok = cur.tokens[cur.tokens.length - 1];
      cur.cont = !!lastTok && CONT_END.has(lastTok.v) && lastTok.t !== 'str';
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ------------------------------------------------------------------
  // Tabel builtin
  // ------------------------------------------------------------------
  const SERIES = new Set(['open', 'high', 'low', 'close', 'volume', 'time', 'time_close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'bar_index', 'last_bar_index']);
  const NS = new Set(['ta', 'math', 'color', 'strategy', 'input', 'str', 'shape', 'location', 'size', 'plot', 'hline', 'display',
    'position', 'barstate', 'syminfo', 'timeframe', 'dayofweek', 'extend', 'xloc', 'yloc', 'label', 'line', 'box', 'table',
    'array', 'request', 'format', 'text', 'font', 'currency', 'scale', 'ticker', 'session', 'barmerge', 'alert', 'order', 'chart', 'runtime', 'log', 'linefill']);
  const TIME_VARS = new Set(['year', 'month', 'weekofyear', 'dayofmonth', 'dayofweek', 'hour', 'minute', 'second']);
  const PLAIN_FUNCS = new Set(['na', 'nz', 'fixnan', 'int', 'float', 'bool', 'string', 'plot', 'plotshape', 'plotchar', 'plotarrow',
    'plotcandle', 'plotbar', 'hline', 'bgcolor', 'barcolor', 'fill', 'indicator', 'study', 'strategy', 'input', 'alert',
    'alertcondition', 'timestamp', 'max_bars_back', 'color', 'library', 'runtime']);
  const SITED = new Set(['plot', 'plotshape', 'plotchar', 'plotarrow', 'hline', 'bgcolor', 'barcolor', 'fill', 'input']);
  const TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'series', 'simple', 'const', 'line', 'label', 'box', 'table', 'linefill']);

  // Nama parameter (agar argumen bernama seperti `color=color.red` bisa dipetakan).
  const SIGS = {
    plot: ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset', 'join', 'editable', 'show_last', 'display', 'format', 'precision', 'force_overlay'],
    plotshape: ['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'format', 'precision', 'force_overlay'],
    plotchar: ['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'format', 'precision', 'force_overlay'],
    plotarrow: ['series', 'title', 'colorup', 'colordown', 'offset', 'minheight', 'maxheight', 'editable', 'show_last', 'display'],
    hline: ['price', 'title', 'color', 'linestyle', 'linewidth', 'editable', 'display'],
    bgcolor: ['color', 'offset', 'editable', 'show_last', 'title', 'display', 'force_overlay'],
    barcolor: ['color', 'offset', 'editable', 'show_last', 'title', 'display'],
    fill: ['plot1', 'plot2', 'color', 'title', 'editable', 'show_last', 'fillgaps', 'display'],
    indicator: ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'max_bars_back', 'timeframe', 'timeframe_gaps', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count', 'max_polylines_count'],
    strategy: ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'pyramiding', 'calc_on_order_fills', 'calc_on_every_tick', 'max_bars_back', 'backtest_fill_limits_assumption', 'default_qty_type', 'default_qty_value', 'initial_capital', 'currency', 'slippage', 'commission_type', 'commission_value', 'process_orders_on_close', 'close_entries_rule', 'margin_long', 'margin_short', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count', 'risk_free_rate', 'use_bar_magnifier', 'fill_orders_on_standard_ohlc', 'max_polylines_count'],
    input: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.int': ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'options', 'display'],
    'input.float': ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'options', 'display'],
    'input.bool': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.string': ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.source': ['defval', 'title', 'tooltip', 'inline', 'group', 'display'],
    'input.color': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.timeframe': ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.price': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.time': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.symbol': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.session': ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display'],
    'input.text_area': ['defval', 'title', 'tooltip', 'group', 'confirm', 'display'],
    'strategy.entry': ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert'],
    'strategy.order': ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert'],
    'strategy.exit': ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price', 'trail_points', 'trail_offset', 'oca_name', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message', 'alert_profit', 'alert_loss', 'alert_trailing', 'disable_alert'],
    'strategy.close': ['id', 'comment', 'qty', 'qty_percent', 'alert_message', 'immediately', 'disable_alert'],
    'strategy.close_all': ['comment', 'alert_message', 'immediately', 'disable_alert'],
    'strategy.cancel': ['id'],
    'color.new': ['color', 'transp'],
    'color.rgb': ['red', 'green', 'blue', 'transp'],
    'color.from_gradient': ['value', 'bottom_value', 'top_value', 'bottom_color', 'top_color'],
    'ta.sma': ['source', 'length'], 'ta.ema': ['source', 'length'], 'ta.rma': ['source', 'length'], 'ta.wma': ['source', 'length'],
    'ta.hma': ['source', 'length'], 'ta.vwma': ['source', 'length'], 'ta.stdev': ['source', 'length', 'biased'],
    'ta.rsi': ['source', 'length'], 'ta.macd': ['source', 'fastlen', 'slowlen', 'siglen'], 'ta.bb': ['series', 'length', 'mult'],
    'ta.bbw': ['series', 'length', 'mult'], 'ta.kc': ['series', 'length', 'mult', 'useTrueRange'],
    'ta.atr': ['length'], 'ta.supertrend': ['factor', 'atrPeriod'], 'ta.highest': ['source', 'length'], 'ta.lowest': ['source', 'length'],
    'ta.crossover': ['source1', 'source2'], 'ta.crossunder': ['source1', 'source2'], 'ta.cross': ['source1', 'source2'],
    'ta.change': ['source', 'length'], 'ta.mom': ['source', 'length'], 'ta.roc': ['source', 'length'], 'ta.stoch': ['source', 'high', 'low', 'length'],
    'ta.cci': ['source', 'length'], 'ta.mfi': ['series', 'length'], 'ta.dmi': ['diLength', 'adxSmoothing'], 'ta.valuewhen': ['condition', 'source', 'occurrence'],
    'ta.pivothigh': ['source', 'leftbars', 'rightbars'], 'ta.pivotlow': ['source', 'leftbars', 'rightbars'], 'ta.linreg': ['source', 'length', 'offset'],
    'ta.sar': ['start', 'inc', 'max'], 'ta.tr': ['handle_na'], 'ta.vwap': ['source'], 'ta.cum': ['source'], 'ta.wpr': ['length'],
    'math.round': ['number', 'precision'],
    'box.new': ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign', 'text_wrap', 'text_font_family', 'force_overlay', 'text_formatting'],
    'line.new': ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width', 'force_overlay'],
    'label.new': ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip', 'text_font_family', 'force_overlay', 'text_formatting'],
    'table.new': ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width', 'force_overlay'],
    'table.cell': ['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family', 'text_formatting'],
    'timeframe.change': ['timeframe'], 'timeframe.in_seconds': ['timeframe'],
    'array.new_float': ['size', 'initial_value'], 'array.new_int': ['size', 'initial_value'], 'array.new_bool': ['size', 'initial_value'],
    'array.new_string': ['size', 'initial_value'], 'array.new_box': ['size', 'initial_value'], 'array.new_line': ['size', 'initial_value'],
    'array.new_label': ['size', 'initial_value'], 'array.new': ['size', 'initial_value'],
    'str.format_time': ['time', 'format', 'timezone'],
    'str.tostring': ['value', 'format'],
  };

  // ------------------------------------------------------------------
  // Transpiler
  // ------------------------------------------------------------------
  class Transpiler {
    constructor() {
      this.site = 0;
      this.globals = new Set();
      this.userFuncs = new Map(); // nama -> daftar parameter
      this.scopes = []; // scope lokal (fungsi & loop)
      this.funcDepth = 0;
      this.line = 0;
    }

    err(msg) { throw new PineError(msg, this.line); }

    siteKey() {
      const id = ++this.site;
      return this.funcDepth ? `__site+':${id}'` : `'${id}'`;
    }

    isLocal(name) {
      for (let k = this.scopes.length - 1; k >= 0; k--) if (this.scopes[k].has(name)) return true;
      return false;
    }

    // ---- ekspresi ----
    expr(toks) {
      if (!toks.length) this.err('Ekspresi kosong');
      let out = '';
      let i = 0;
      while (i < toks.length) {
        const t = toks[i];
        const nx = toks[i + 1];
        if (t.t === 'num') { out += t.v; i++; continue; }
        if (t.t === 'str') { out += t.v; i++; continue; }
        if (t.t === 'op') {
          if (t.v === '(') {
            const j = this.match(toks, i);
            out += '(' + this.expr(toks.slice(i + 1, j)) + ')';
            i = j + 1;
            continue;
          }
          if (t.v === '[') {
            const j = this.match(toks, i);
            out += '[' + this.splitArgs(toks.slice(i + 1, j)).map((a) => this.expr(a)).join(', ') + ']';
            i = j + 1;
            continue;
          }
          if (t.v === ')' || t.v === ']') this.err(`Tanda "${t.v}" tidak berpasangan`);
          if (t.v === '=') this.err('Gunakan "==" untuk perbandingan, atau ":=" untuk mengubah nilai variabel');
          if (t.v === ':=' || /^[+\-*/%]=$/.test(t.v)) this.err(`Operator "${t.v}" tidak boleh berada di dalam ekspresi`);
          if (t.v === '=>') this.err('Definisi fungsi harus berada di awal baris');
          out += ' ' + t.v + ' ';
          i++;
          continue;
        }
        // identifier
        const name = t.v;
        if (name === 'and') { out += ' && '; i++; continue; }
        if (name === 'or') { out += ' || '; i++; continue; }
        if (name === 'not') { out += ' !'; i++; continue; }
        if (name === 'true' || name === 'false') { out += name; i++; continue; }
        if (nx && nx.t === 'op' && nx.v === '<' && /^(array|map|matrix)\.new$/.test(name) && toks[i + 2] && toks[i + 3] && toks[i + 3].v === '>' && toks[i + 4] && toks[i + 4].v === '(') {
          const j = this.match(toks, i + 4);
          out += this.call(name, toks.slice(i + 5, j));
          i = j + 1;
          continue;
        }
        if (nx && nx.t === 'op' && nx.v === '(') {
          const j = this.match(toks, i + 1);
          out += this.call(name, toks.slice(i + 2, j));
          i = j + 1;
          if (toks[i] && toks[i].t === 'op' && toks[i].v === '[') this.err('Akses histori pada hasil fungsi (mis. ta.sma(close,10)[1]) belum didukung — simpan dulu ke variabel');
          continue;
        }
        if (name === 'na') { out += 'NaN'; i++; continue; }
        if (nx && nx.t === 'op' && nx.v === '[') {
          const j = this.match(toks, i + 1);
          const idx = this.expr(toks.slice(i + 2, j));
          out += this.history(name, idx);
          i = j + 1;
          continue;
        }
        out += this.ident(name);
        i++;
      }
      return out;
    }

    match(toks, i) {
      const open = toks[i].v;
      const close = open === '(' ? ')' : ']';
      let d = 0;
      for (let j = i; j < toks.length; j++) {
        const t = toks[j];
        if (t.t !== 'op') continue;
        if (t.v === '(' || t.v === '[') d++;
        else if (t.v === ')' || t.v === ']') {
          d--;
          if (d === 0) {
            if (t.v !== close) this.err(`Kurung tidak cocok: "${open}" ditutup dengan "${t.v}"`);
            return j;
          }
        }
      }
      this.err(`Kurung "${open}" tidak ditutup`);
    }

    splitArgs(toks) {
      const args = [];
      let cur = [];
      let d = 0;
      for (const t of toks) {
        if (t.t === 'op') {
          if (t.v === '(' || t.v === '[') d++;
          else if (t.v === ')' || t.v === ']') d--;
          else if (t.v === ',' && d === 0) { args.push(cur); cur = []; continue; }
        }
        cur.push(t);
      }
      if (cur.length) args.push(cur);
      return args;
    }

    ident(name) {
      if (this.isLocal(name)) return 'v_' + name;
      if (this.globals.has(name)) return `$s[${JSON.stringify(name)}]`;
      if (SERIES.has(name)) return `$s.${name}`;
      if (TIME_VARS.has(name)) return `$.t.${name}()`;
      const dot = name.indexOf('.');
      if (dot > 0) {
        const ns = name.slice(0, dot);
        if (ns === 'ta') return `$.ta.${name.slice(3)}($st(${this.siteKey()}))`; // ta.tr, ta.obv, ta.vwap ...
        if (NS.has(ns)) return '$.' + name;
      }
      if (this.userFuncs.has(name)) this.err(`"${name}" adalah fungsi, panggil dengan ${name}(...)`);
      this.err(`Variabel "${name}" belum dideklarasikan`);
    }

    history(name, idx) {
      if (this.isLocal(name)) this.err(`Akses histori "${name}[...]" untuk variabel lokal fungsi belum didukung`);
      if (this.globals.has(name) || SERIES.has(name)) return `$h(${JSON.stringify(name)}, ${idx})`;
      this.err(`Variabel "${name}" belum dideklarasikan`);
    }

    // request.security: data timeframe lain dibangun dari bar chart (tanpa repaint jika lookahead off)
    security(raw) {
      const sig = ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead', 'ignore_invalid_symbol', 'currency', 'calc_bars_count'];
      const args = [];
      raw.forEach((a, k) => {
        if (a.length >= 2 && a[0].t === 'id' && a[1].t === 'op' && a[1].v === '=') args[sig.indexOf(a[0].v)] = a.slice(2);
        else args[k] = a;
      });
      if (!args[1] || !args[2]) this.err('request.security() membutuhkan timeframe dan ekspresi');
      const tf = this.expr(args[1]);
      const la = args[4] ? this.expr(args[4]) : 'undefined';
      const conv = (tk) => {
        if (tk.length === 1 && tk[0].t === 'id' && SERIES.has(tk[0].v)) return `$.htf(${tf}, '${tk[0].v}', 0, ${la})`;
        if (tk.length >= 4 && tk[0].t === 'id' && SERIES.has(tk[0].v) && tk[1].v === '[' && tk[tk.length - 1].v === ']' && this.match(tk, 1) === tk.length - 1) {
          return `$.htf(${tf}, '${tk[0].v}', ${this.expr(tk.slice(2, -1))}, ${la})`;
        }
        return null;
      };
      const e = args[2];
      if (e[0].t === 'op' && e[0].v === '[' && this.match(e, 0) === e.length - 1) {
        const parts = this.splitArgs(e.slice(1, -1)).map(conv);
        if (parts.every((x) => x)) return `[${parts.join(', ')}]`;
      } else {
        const c = conv(e);
        if (c) return c;
      }
      return `$.securityFallback(${this.expr(e)})`;
    }

    call(name, argToks) {
      const raw = argToks.length ? this.splitArgs(argToks) : [];
      if (name === 'request.security' || name === 'security') return this.security(raw);
      const pos = [];
      const named = {};
      for (const a of raw) {
        if (a.length >= 2 && a[0].t === 'id' && a[1].t === 'op' && a[1].v === '=') {
          if (!a.slice(2).length) this.err(`Argumen "${a[0].v}" kosong`);
          named[a[0].v] = this.expr(a.slice(2));
        } else {
          if (Object.keys(named).length) this.err('Argumen posisi tidak boleh setelah argumen bernama');
          pos.push(this.expr(a));
        }
      }
      // pemanggilan method: obj.metode(...), mis. arr.push(x) atau myBox.set_right(bar_index)
      const dot = name.indexOf('.');
      if (dot > 0) {
        const rootName = name.slice(0, dot);
        if (!NS.has(rootName) && (this.isLocal(rootName) || this.globals.has(rootName))) {
          if (Object.keys(named).length) this.err(`Argumen bernama belum didukung untuk method .${name.slice(dot + 1)}()`);
          return `$.method(${JSON.stringify(name.slice(dot + 1))}, ${this.ident(rootName)}${pos.length ? ', ' + pos.join(', ') : ''})`;
        }
      }
      let sig = SIGS[name];
      let target;
      let sited = false;
      if (this.userFuncs.has(name)) {
        sig = this.userFuncs.get(name);
        target = `$u[${JSON.stringify(name)}]`;
        sited = true;
      } else if (name.startsWith('ta.')) {
        target = '$.' + name;
        sited = true;
      } else if (PLAIN_FUNCS.has(name)) {
        target = name === 'strategy' ? '$.strategyDecl' : name === 'input' ? '$.input.any' : name === 'color' ? '$.color.any' : '$.' + name;
        sited = SITED.has(name);
      } else {
        const ns = name.split('.')[0];
        if (!NS.has(ns)) this.err(`Fungsi "${name}" tidak dikenal`);
        target = '$.' + name;
        sited = ns === 'input';
      }
      let args = pos;
      const names = Object.keys(named);
      if (names.length) {
        if (!sig) this.err(`Argumen bernama belum didukung untuk ${name}()`);
        args = pos.slice();
        for (const k of names) {
          const idx = sig.indexOf(k);
          if (idx < 0) this.err(`${name}() tidak punya parameter "${k}"`);
          while (args.length <= idx) args.push('undefined');
          args[idx] = named[k];
        }
      }
      if (sited) {
        const key = this.siteKey();
        args = [name.startsWith('ta.') || this.userFuncs.has(name) ? `$st(${key})` : key, ...args];
        if (this.userFuncs.has(name)) args[0] = key;
      }
      return `${target}(${args.join(', ')})`;
    }

    // ---- statement ----
    compile(src) {
      const lines = logicalLines(src);
      const out = [];
      // frame: {indent, kind, scope?, returns?, lastExpr?, subject?, armCount?}
      // `returns` = ekspresi terakhir di blok ini menjadi nilai kembali (badan fungsi, cabang if/switch ekspresi)
      const stack = [];
      let swCount = 0;
      const finishReturn = (f) => {
        if (f.returns && f.lastExpr) out[f.lastExpr.idx] = `$.L=${f.lastExpr.line}; return ${f.lastExpr.js};`;
      };
      const closeFrame = (f) => {
        finishReturn(f);
        if (f.kind === 'func') {
          out.push('};');
          this.funcDepth--;
          this.scopes.pop();
        } else if (f.kind === 'iife') {
          out.push('return NaN; })();');
        } else if (f.kind === 'switch') {
          // cabang switch sudah ditutup masing-masing
        } else {
          out.push('}');
          if (f.scope) this.scopes.pop();
        }
      };
      const curFunc = () => {
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'func') return stack[k];
        return null;
      };
      const topLevelIndex = (toks, v) => {
        let d = 0;
        for (let k = 0; k < toks.length; k++) {
          const t = toks[k];
          if (t.t === 'op' && (t.v === '(' || t.v === '[')) d++;
          else if (t.t === 'op' && (t.v === ')' || t.v === ']')) d--;
          else if (d === 0 && t.v === v) return k;
        }
        return -1;
      };

      for (let li = 0; li < lines.length; li++) {
        const L = lines[li];
        this.line = L.line;
        const toks = L.tokens;
        const first = toks[0];
        const isElse = first.t === 'id' && first.v === 'else';
        let elseReturns = false;
        let elseOk = false;
        while (stack.length && L.indent <= stack[stack.length - 1].indent) {
          const f = stack[stack.length - 1];
          if (isElse && f.kind === 'if' && L.indent === f.indent) {
            stack.pop();
            finishReturn(f);
            out.push('}');
            elseReturns = !!f.returns;
            elseOk = true;
            break;
          }
          stack.pop();
          closeFrame(f);
        }
        const fn = curFunc();
        const parentFrame = stack[stack.length - 1];
        const retFrame = parentFrame && parentFrame.returns ? parentFrame : null;
        if (retFrame) retFrame.lastExpr = null;
        const tag = `$.L=${L.line}; `;
        const opensBlock = (kind, extra) => {
          const nextL = lines[li + 1];
          if (!nextL || nextL.indent <= L.indent) this.err(`Blok "${kind}" kosong — baris berikutnya harus diindentasi`);
          stack.push(Object.assign({ indent: L.indent, kind }, extra || {}));
        };
        const declTarget = (name, isVar) => {
          if (fn) {
            this.scopes[this.scopes.length - 1].add(name);
            return `let v_${name} = `;
          }
          if (this.isLocal(name)) this.err(`"${name}" sudah dipakai sebagai variabel loop`);
          this.globals.add(name);
          const key = JSON.stringify(name);
          return isVar ? `if (!(${key} in $s)) $s[${key}] = ` : `$s[${key}] = `;
        };
        // `x = if ...` / `x = switch ...` → fungsi anonim yang langsung dipanggil
        const openExprBlock = (prefix, rhs) => {
          out.push(`${tag}${prefix}(() => {`);
          stack.push({ indent: L.indent, kind: 'iife' });
          if (rhs[0].v === 'if') {
            out.push(`if (${this.expr(rhs.slice(1))}) {`);
            opensBlock('if', { returns: true });
          } else {
            const subject = this.openSwitchSubject(rhs.slice(1), () => ++swCount, out);
            opensBlock('switch', { subject, armCount: 0, returns: true });
          }
        };
        const isBlockExpr = (rhs) => rhs[0] && rhs[0].t === 'id' && (rhs[0].v === 'if' || rhs[0].v === 'switch');

        // cabang switch:  nilai => hasil   |   => default
        if (parentFrame && parentFrame.kind === 'switch') {
          const sw = parentFrame;
          const ai = topLevelIndex(toks, '=>');
          if (ai < 0) this.err('Cabang switch harus berformat:  nilai => hasil');
          const left = toks.slice(0, ai);
          const right = toks.slice(ai + 1);
          const cond = left.length ? (sw.subject ? `${sw.subject} === (${this.expr(left)})` : `(${this.expr(left)})`) : null;
          const kw = sw.armCount++ === 0 ? '' : 'else ';
          const head = cond ? `${kw}if (${cond})` : kw ? 'else' : '';
          if (right.length) {
            let body;
            if (sw.returns) body = `return (${this.expr(right)});`;
            else if (right[0].t === 'id' && right[1] && right[1].t === 'op' && (right[1].v === ':=' || /^[+\-*/%]=$/.test(right[1].v))) {
              body = `${this.ident(right[0].v)} ${right[1].v === ':=' ? '=' : right[1].v} ${this.expr(right.slice(2))};`;
            } else body = this.expr(right) + ';';
            out.push(`${head} { ${tag}${body} }`);
          } else {
            out.push(`${head} {`);
            opensBlock('arm', { returns: !!sw.returns });
          }
          continue;
        }

        // else / else if
        if (isElse) {
          if (!elseOk) this.err('"else" tanpa "if"');
          if (toks[1] && toks[1].v === 'if') {
            out.push(`else if (${this.expr(toks.slice(2))}) {`);
          } else {
            if (toks.length > 1) this.err('Sintaks "else" tidak valid');
            out.push('else {');
          }
          opensBlock('if', { returns: elseReturns });
          continue;
        }
        if (first.t === 'id' && first.v === 'if') {
          out.push(`${tag}if (${this.expr(toks.slice(1))}) {`);
          opensBlock('if');
          continue;
        }
        if (first.t === 'id' && first.v === 'switch') {
          const subject = this.openSwitchSubject(toks.slice(1), () => ++swCount, out, tag);
          opensBlock('switch', { subject, armCount: 0, returns: false });
          continue;
        }
        if (first.t === 'id' && first.v === 'while') {
          out.push(`${tag}while ($.guard() && (${this.expr(toks.slice(1))})) {`);
          opensBlock('while');
          continue;
        }
        if (first.t === 'id' && first.v === 'for') {
          // for x in arr  |  for [i, x] in arr
          const inIdx = topLevelIndex(toks, 'in');
          if (inIdx > 0) {
            const head = toks.slice(1, inIdx);
            const arr = this.expr(toks.slice(inIdx + 1));
            let names;
            if (head.length === 1 && head[0].t === 'id') {
              names = [head[0].v];
              out.push(`${tag}for (const v_${names[0]} of $.iter(${arr})) {`);
            } else if (head[0].v === '[') {
              names = this.splitArgs(head.slice(1, -1)).map((a) => a[0].v);
              if (names.length !== 2) this.err('Format: for [i, x] in array');
              out.push(`${tag}for (const [v_${names[0]}, v_${names[1]}] of $.iter(${arr}).entries()) {`);
            } else this.err('Format: for x in array');
            this.scopes.push(new Set(names));
            opensBlock('for', { scope: true });
            continue;
          }
          if (!(toks[1] && toks[1].t === 'id' && toks[2] && toks[2].v === '=')) this.err('Format: for i = awal to akhir [by langkah]');
          const rest = toks.slice(3);
          let d = 0, toIdx = -1, byIdx = -1;
          rest.forEach((t, k) => {
            if (t.t === 'op' && (t.v === '(' || t.v === '[')) d++;
            else if (t.t === 'op' && (t.v === ')' || t.v === ']')) d--;
            else if (d === 0 && t.t === 'id' && t.v === 'to' && toIdx < 0) toIdx = k;
            else if (d === 0 && t.t === 'id' && t.v === 'by') byIdx = k;
          });
          if (toIdx < 0) this.err('"for" membutuhkan "to"');
          const a = this.expr(rest.slice(0, toIdx));
          const b = this.expr(rest.slice(toIdx + 1, byIdx < 0 ? undefined : byIdx));
          const step = byIdx < 0 ? 'undefined' : this.expr(rest.slice(byIdx + 1));
          const v = toks[1].v;
          out.push(`${tag}for (const v_${v} of $.range(${a}, ${b}, ${step})) {`);
          this.scopes.push(new Set([v]));
          opensBlock('for', { scope: true });
          continue;
        }
        if (first.t === 'id' && (first.v === 'break' || first.v === 'continue')) {
          out.push(first.v + ';');
          continue;
        }
        if (first.t === 'id' && ['type', 'method', 'export', 'import', 'enum'].includes(first.v) && toks[1] && toks[1].t === 'id') {
          this.err(`"${first.v}" belum didukung di Luna`);
        }

        // definisi fungsi: nama(a, b) => ...
        if (first.t === 'id' && !first.v.includes('.') && toks[1] && toks[1].v === '(') {
          const j = this.match(toks, 1);
          if (toks[j + 1] && toks[j + 1].v === '=>') {
            if (fn) this.err('Fungsi tidak boleh didefinisikan di dalam fungsi');
            const params = [];
            const defs = [];
            for (const p of this.splitArgs(toks.slice(2, j))) {
              let k = this.skipType(p, 0);
              if (!p[k] || p[k].t !== 'id') this.err('Parameter fungsi tidak valid');
              params.push(p[k].v);
              defs.push(p[k + 1] && p[k + 1].v === '=' ? this.expr(p.slice(k + 2)) : null);
            }
            const name = first.v;
            this.userFuncs.set(name, params);
            const plist = params.map((p, k) => (defs[k] ? `v_${p} = ${defs[k]}` : `v_${p}`)).join(', ');
            this.scopes.push(new Set(params));
            this.funcDepth++;
            const body = toks.slice(j + 2);
            if (body.length) {
              const js = this.expr(body);
              out.push(`${tag}$u[${JSON.stringify(name)}] = function(__site${plist ? ', ' + plist : ''}) { return ${js}; };`);
              this.scopes.pop();
              this.funcDepth--;
            } else {
              out.push(`${tag}$u[${JSON.stringify(name)}] = function(__site${plist ? ', ' + plist : ''}) {`);
              opensBlock('func', { returns: true });
            }
            continue;
          }
        }

        // deklarasi tuple: [a, b] = ...
        if (first.t === 'op' && first.v === '[') {
          const j = this.match(toks, 0);
          const op = toks[j + 1];
          if (op && (op.v === '=' || op.v === ':=')) {
            const names = this.splitArgs(toks.slice(1, j)).map((a) => {
              const k = this.skipType(a, 0);
              if (a.length !== k + 1 || a[k].t !== 'id') this.err('Deklarasi tuple tidak valid');
              return a[k].v;
            });
            const rhsToks = toks.slice(j + 2);
            if (fn) {
              if (op.v === '=') names.forEach((n) => this.scopes[this.scopes.length - 1].add(n));
              const target = `${op.v === '=' ? 'let ' : ''}[${names.map((n) => 'v_' + n).join(', ')}] = `;
              if (isBlockExpr(rhsToks)) openExprBlock(target, rhsToks);
              else out.push(`${tag}${target}${this.expr(rhsToks)};`);
            } else {
              if (op.v === '=') names.forEach((n) => this.globals.add(n));
              const target = `[${names.map((n) => this.ident(n)).join(', ')}] = `;
              if (isBlockExpr(rhsToks)) openExprBlock(target, rhsToks);
              else out.push(`${tag}${target}${this.expr(rhsToks)};`);
            }
            continue;
          }
        }

        // deklarasi: [var|varip] [tipe] nama = expr
        {
          let k = 0;
          let isVar = false;
          if (toks[k] && toks[k].t === 'id' && (toks[k].v === 'var' || toks[k].v === 'varip')) { isVar = true; k++; }
          k = this.skipType(toks, k);
          const nameTok = toks[k];
          const eq = toks[k + 1];
          if (nameTok && nameTok.t === 'id' && !nameTok.v.includes('.') && eq && eq.t === 'op' && eq.v === '=') {
            const name = nameTok.v;
            if (SERIES.has(name)) this.err(`"${name}" adalah variabel bawaan dan tidak bisa dideklarasikan ulang`);
            const rhsToks = toks.slice(k + 2);
            if (!rhsToks.length) this.err(`Nilai untuk "${name}" kosong`);
            if (isBlockExpr(rhsToks)) {
              openExprBlock(declTarget(name, isVar), rhsToks);
            } else {
              const rhs = this.expr(rhsToks);
              out.push(`${tag}${declTarget(name, isVar)}${rhs};`);
            }
            continue;
          }
        }

        // reassign: nama := expr, nama += expr
        if (first.t === 'id' && toks[1] && toks[1].t === 'op' && (toks[1].v === ':=' || /^[+\-*/%]=$/.test(toks[1].v))) {
          const name = first.v;
          if (!this.isLocal(name) && !this.globals.has(name)) this.err(`Variabel "${name}" belum dideklarasikan (gunakan "=" untuk deklarasi pertama)`);
          const op = toks[1].v === ':=' ? '=' : toks[1].v;
          const rhsToks = toks.slice(2);
          if (op === '=' && isBlockExpr(rhsToks)) openExprBlock(`${this.ident(name)} = `, rhsToks);
          else out.push(`${tag}${this.ident(name)} ${op} ${this.expr(rhsToks)};`);
          continue;
        }

        // statement ekspresi
        const js = this.expr(toks);
        out.push(`${tag}${js};`);
        if (retFrame) retFrame.lastExpr = { idx: out.length - 1, js, line: L.line };
      }
      while (stack.length) closeFrame(stack.pop());
      return out.join('\n');
    }

    openSwitchSubject(subjToks, nextId, out, tag) {
      if (!subjToks.length) return null;
      const name = `$sw${nextId()}`;
      out.push(`${tag || ''}const ${name} = ${this.expr(subjToks)};`);
      return name;
    }

    // lompati penanda tipe: float, var int, array<float>, map<string, float>, series float, ...
    skipType(toks, k) {
      for (;;) {
        const t = toks[k];
        if (!t || t.t !== 'id') return k;
        if (/^(array|map|matrix)$/.test(t.v) && toks[k + 1] && toks[k + 1].v === '<') {
          let j = k + 1;
          while (toks[j] && toks[j].v !== '>') j++;
          if (!toks[j]) this.err('Tipe generik tidak ditutup dengan ">"');
          k = j + 1;
          continue;
        }
        if ((TYPES.has(t.v) || t.v === 'chart.point') && toks[k + 1] && toks[k + 1].t === 'id' && !['and', 'or', 'not'].includes(toks[k + 1].v)) {
          k++;
          continue;
        }
        return k;
      }
    }
  }

  function transpile(src) {
    const tr = new Transpiler();
    return tr.compile(src);
  }

  function compile(src) {
    const js = transpile(src);
    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('$', '$s', '$h', '$st', '$u', '"use strict";\n' + js);
    } catch (e) {
      throw new PineError('Gagal membangun script: ' + e.message);
    }
    return { src, js, fn };
  }

  // ------------------------------------------------------------------
  // Warna
  // ------------------------------------------------------------------
  const COLORS = {
    red: '#F23645', green: '#089981', blue: '#2962FF', orange: '#FF9800', yellow: '#FFEB3B', purple: '#9C27B0',
    aqua: '#00BCD4', lime: '#00E676', teal: '#009688', fuchsia: '#E040FB', white: '#FFFFFF', black: '#363A45',
    gray: '#787B86', silver: '#B2B5BE', maroon: '#880E4F', navy: '#311B92', olive: '#808000',
  };

  function parseColor(c) {
    if (typeof c !== 'string') return null;
    let m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) c = '#' + m[1].split('').map((x) => x + x).join('');
    m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(c);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), m[4] ? parseInt(m[4], 16) / 255 : 1];
    m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) {
      const p = m[1].split(',').map(Number);
      return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
    }
    return null;
  }
  function rgba(r, g, b, a) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})`;
  }

  function makeColorNS() {
    const ns = Object.assign({}, COLORS);
    ns.new = (c, transp) => {
      const p = parseColor(c);
      if (!p) return c;
      return rgba(p[0], p[1], p[2], 1 - (transp || 0) / 100);
    };
    ns.rgb = (r, g, b, transp) => rgba(r, g, b, 1 - (transp || 0) / 100);
    ns.any = (c) => c;
    ns.r = (c) => (parseColor(c) || [NaN])[0];
    ns.g = (c) => (parseColor(c) || [0, NaN])[1];
    ns.b = (c) => (parseColor(c) || [0, 0, NaN])[2];
    ns.t = (c) => 100 - 100 * (parseColor(c) || [0, 0, 0, NaN])[3];
    ns.from_gradient = (v, lo, hi, c1, c2) => {
      const a = parseColor(c1), b = parseColor(c2);
      if (!a || !b || Number.isNaN(v)) return null;
      const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      return rgba(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
    };
    return ns;
  }

  // ------------------------------------------------------------------
  // Runtime
  // ------------------------------------------------------------------
  const isNa = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));

  function guessMintick(bars) {
    let dec = 0;
    for (let k = Math.max(0, bars.length - 200); k < bars.length; k++) {
      for (const v of [bars[k].open, bars[k].close]) {
        const s = String(v);
        const d = s.includes('e-') ? 8 : s.includes('.') ? s.split('.')[1].length : 0;
        if (d > dec) dec = d;
      }
    }
    return Math.pow(10, -Math.min(dec, 8));
  }

  /**
   * Jalankan script yang sudah dikompilasi pada data bar.
   * bars: [{time(ms), open, high, low, close, volume}]
   * opts: { inputs: {judul: nilai}, symbol, timeframe }
   */
  function run(compiled, bars, opts) {
    opts = opts || {};
    const overrides = opts.inputs || {};
    const n = bars.length;
    const $s = {};
    const H = {};
    const states = new Map();
    const $u = {};
    const result = {
      decl: { type: 'indicator', title: 'Script', overlay: false },
      plots: [], shapes: [], hlines: [], bgcolors: [], barcolors: null, inputs: [], strategy: null, error: null, warnings: [], drawings: null,
    };
    const plotMap = new Map(), shapeMap = new Map(), hlineMap = new Map(), bgMap = new Map(), inputMap = new Map();
    let i = 0;
    let guardCount = 0;
    const R = { time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0, prevClose: NaN };
    const broker = new BT.Broker(bars);
    broker.cfg.mintick = guessMintick(bars);
    let isStrategy = false;

    const $st = (key) => {
      let s = states.get(key);
      if (!s) { s = {}; states.set(key, s); }
      return s;
    };
    const $h = (name, k) => {
      k = Math.round(k);
      if (!k) return $s[name];
      if (k < 0) throw new PineError('Indeks histori tidak boleh negatif', $.L);
      const a = H[name];
      const j = i - k;
      return a && j >= 0 ? a[j] : NaN;
    };
    const numOr = (v, d) => (isNa(v) ? d : v);

    const plotObj = (site, kind, title, extra) => {
      let p = plotMap.get(site);
      if (!p) {
        p = Object.assign({ id: 'p' + site, kind, title: title || 'Plot', values: new Array(n).fill(NaN), colors: new Array(n).fill(null) }, extra);
        plotMap.set(site, p);
        result.plots.push(p);
      }
      return p;
    };

    const inputFn = (type) => (site, defval, title, a3, a4, a5, a6, a7, a8, a9, a10) => {
      const key = title || 'Input ' + site;
      let def = inputMap.get(key);
      if (!def) {
        def = { key, type, defval, title: key };
        if (type === 'int' || type === 'float') { def.minval = a3; def.maxval = a4; def.step = a5; def.options = a10; }
        if (type === 'string' || type === 'timeframe') def.options = a3;
        if (type === 'source') def.defval = sourceName(defval);
        inputMap.set(key, def);
        result.inputs.push(def);
      }
      const has = Object.prototype.hasOwnProperty.call(overrides, key);
      if (type === 'source') return has && $s[overrides[key]] !== undefined ? $s[overrides[key]] : defval;
      let v = has ? overrides[key] : defval;
      if (type === 'int') v = Math.round(Number(v));
      else if (type === 'float') v = Number(v);
      else if (type === 'bool') v = v === true || v === 'true';
      return v;
    };
    // tebak nama sumber (close/open/...) dari nilai default pada bar pertama
    function sourceName(val) {
      for (const k of ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume']) if ($s[k] === val) return k;
      return 'close';
    }

    const strategyNS = {
      long: 'long', short: 'short', fixed: 'fixed', cash: 'cash', percent_of_equity: 'percent_of_equity',
      commission: { percent: 'percent', cash_per_contract: 'cash_per_contract', cash_per_order: 'cash_per_order' },
      direction: { all: 'all', long: 'long', short: 'short' },
      oca: { none: 'none', cancel: 'cancel', reduce: 'reduce' },
      entry: (id, dir, qty, limit, stop, oca, ocat, comment) => broker.entry(id, dir, qty, limit, stop, comment),
      order: (id, dir, qty, limit, stop, oca, ocat, comment) => broker.order(id, dir, qty, limit, stop, comment),
      exit: (id, from, qty, qtyp, profit, limit, loss, stop, tp, tpts, toff, oca, comment) => broker.exit(id, from, qty, qtyp, profit, limit, loss, stop, comment),
      close: (id, comment, qty, qtyp, am, immediately) => broker.close(id, comment, qty, qtyp, immediately),
      close_all: (comment, am, immediately) => broker.closeAll(comment, immediately),
      cancel: (id) => broker.cancel(id),
      cancel_all: () => broker.cancelAll(),
    };
    Object.defineProperties(strategyNS, {
      position_size: { get: () => broker.positionSize },
      position_avg_price: { get: () => broker.avgPrice },
      equity: { get: () => broker.equityAt(R.close) },
      netprofit: { get: () => broker.trades.reduce((a, t) => a + t.pnl, 0) },
      openprofit: { get: () => broker.openProfit(R.close) },
      closedtrades: { get: () => broker.trades.length },
      opentrades: { get: () => broker.entries.length },
      wintrades: { get: () => broker.trades.filter((t) => t.pnl > 0).length },
      losstrades: { get: () => broker.trades.filter((t) => t.pnl <= 0).length },
      initial_capital: { get: () => broker.cfg.initial_capital },
      grossprofit: { get: () => broker.trades.reduce((a, t) => a + Math.max(0, t.pnl), 0) },
      grossloss: { get: () => broker.trades.reduce((a, t) => a + Math.max(0, -t.pnl), 0) },
    });

    const mathNS = {
      abs: Math.abs, max: (...a) => Math.max(...a), min: (...a) => Math.min(...a), sqrt: Math.sqrt, pow: Math.pow,
      log: Math.log, log10: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
      sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
      round: (x, p) => (p ? Math.round(x * 10 ** p) / 10 ** p : Math.round(x)),
      avg: (...a) => a.reduce((x, y) => x + y, 0) / a.length,
      random: (lo, hi) => (lo === undefined ? Math.random() : lo + Math.random() * ((hi === undefined ? 1 : hi) - lo)),
      pi: Math.PI, e: Math.E, phi: 1.618033988749895, rphi: 0.618033988749895,
      todegrees: (r) => (r * 180) / Math.PI, toradians: (d) => (d * Math.PI) / 180,
      round_to_mintick: (x) => Math.round(x / broker.cfg.mintick) * broker.cfg.mintick,
    };

    const noop = () => null;
    const extCtx = { i: () => i, bars, tf: opts.timeframe, limits: { box: 50, line: 50, label: 50 } };
    const TF = EXT.makeTimeframe(extCtx);
    const ARR = EXT.makeArray();
    const DRAW = EXT.makeDrawings(extCtx);
    result.drawings = DRAW.store;
    const warnOnce = new Set();
    const warn = (msg) => { if (!warnOnce.has(msg)) { warnOnce.add(msg); result.warnings.push(msg); } };
    const setLimits = (l, lb, b) => {
      if (!isNa(l)) extCtx.limits.line = Math.min(500, l);
      if (!isNa(lb)) extCtx.limits.label = Math.min(500, lb);
      if (!isNa(b)) extCtx.limits.box = Math.min(500, b);
    };
    const objNoop = new Proxy({}, { get: () => noop });
    const d = () => new Date(R.time);

    const $ = {
      L: 0,
      ta: TA.makeTA(R),
      math: mathNS,
      color: makeColorNS(),
      str: {
        tostring: (v, f) => {
          if (typeof v !== 'number') return String(v);
          if (Number.isNaN(v)) return 'NaN';
          if (f === 'mintick' || f === 'price') {
            const d = Math.max(0, Math.round(-Math.log10(broker.cfg.mintick)));
            return v.toFixed(d);
          }
          if (f === 'volume') return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(2);
          if (f === 'percent') return v.toFixed(2) + '%';
          if (typeof f === 'string' && /^[#0]+$/.test(f)) return String(Math.round(v));
          if (typeof f === 'string' && f.includes('.')) return v.toFixed(f.split('.')[1].length);
          return String(+v.toFixed(8));
        },
        tonumber: (s) => Number(s),
        length: (s) => String(s).length,
        contains: (s, x) => String(s).includes(x),
        upper: (s) => String(s).toUpperCase(),
        lower: (s) => String(s).toLowerCase(),
        format: (f, ...a) => String(f).replace(/\{(\d+)(?:,[^}]*)?\}/g, (m, k) => a[+k]),
        replace_all: (s, a, b) => String(s).split(a).join(b),
        replace: (s, a, b) => String(s).replace(a, b),
        split: (s, sep) => String(s).split(sep),
        substring: (s, a, b) => String(s).substring(a, b),
        startswith: (s, x) => String(s).startsWith(x),
        endswith: (s, x) => String(s).endsWith(x),
        pos: (s, x) => { const k = String(s).indexOf(x); return k < 0 ? NaN : k; },
        trim: (s) => String(s).trim(),
        repeat: (s, n, sep) => new Array(Math.max(0, n)).fill(s).join(sep || ''),
        format_time: (t, fmt) => {
          const d = new Date(t);
          const p = (x) => String(x).padStart(2, '0');
          return String(fmt || 'yyyy-MM-dd HH:mm').replace('yyyy', d.getUTCFullYear()).replace('MM', p(d.getUTCMonth() + 1)).replace('dd', p(d.getUTCDate()))
            .replace('HH', p(d.getUTCHours())).replace('mm', p(d.getUTCMinutes())).replace('ss', p(d.getUTCSeconds()));
        },
      },
      shape: { xcross: 'xcross', cross: 'cross', circle: 'circle', triangleup: 'triangleup', triangledown: 'triangledown', flag: 'flag', arrowup: 'arrowup', arrowdown: 'arrowdown', labelup: 'labelup', labeldown: 'labeldown', square: 'square', diamond: 'diamond' },
      location: { abovebar: 'abovebar', belowbar: 'belowbar', top: 'top', bottom: 'bottom', absolute: 'absolute' },
      size: { auto: 'auto', tiny: 'tiny', small: 'small', normal: 'normal', large: 'large', huge: 'huge' },
      display: { all: 'all', none: 'none', pane: 'pane', data_window: 'data_window', price_scale: 'price_scale', status_line: 'status_line' },
      position: {}, extend: { none: 'none', right: 'right', left: 'left', both: 'both' },
      xloc: { bar_index: 'bar_index', bar_time: 'bar_time' }, yloc: { price: 'price', abovebar: 'abovebar', belowbar: 'belowbar' },
      text: { align_left: 'left', align_center: 'center', align_right: 'right', align_top: 'top', align_bottom: 'bottom', wrap_auto: 'auto', wrap_none: 'none', format_bold: 'bold', format_italic: 'italic', format_none: 'none' },
      font: { family_default: 'default', family_monospace: 'monospace' }, format: { price: 'price', volume: 'volume', percent: 'percent', mintick: 'mintick', inherit: 'inherit' },
      scale: { right: 'right', left: 'left', none: 'none' }, currency: {}, barmerge: {}, session: {},
      label: DRAW.label, line: DRAW.line, box: DRAW.box, table: DRAW.table, chart: DRAW.chart, linefill: objNoop, array: ARR, log: objNoop,
      order: { ascending: 'ascending', descending: 'descending' },
      htf: TF.htf,
      securityFallback: (v) => {
        warn('request.security() dengan ekspresi kompleks belum didukung: dihitung di timeframe chart. Gunakan open/high/low/close/volume (boleh dengan [n]) atau timeframe.change().');
        return v;
      },
      iter: (a) => (Array.isArray(a) ? a : []),
      method: (m, o, ...a) => {
        let ns = null;
        if (Array.isArray(o)) ns = ARR;
        else if (o && typeof o === 'object' && o.__kind) ns = DRAW[o.__kind];
        else if (typeof o === 'string') ns = $.str;
        else if (isNa(o)) return NaN; // method pada objek na (mis. b.delete()) diabaikan, seperti Pine
        if (!ns || typeof ns[m] !== 'function') throw new Error(`Method .${m}() tidak dikenal`);
        return ns[m](o, ...a);
      }, runtime: { error: (m) => { throw new PineError(m, $.L); } },
      request: {
        security: (sym, tf, expr) => expr,
      },
      barstate: {},
      syminfo: { ticker: opts.symbol || '', tickerid: opts.symbol || '', mintick: broker.cfg.mintick, currency: 'USDT', basecurrency: '', type: 'crypto', timezone: 'UTC' },
      timeframe: TF.timeframe,
      dayofweek: { sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 },
      t: {
        year: () => d().getUTCFullYear(), month: () => d().getUTCMonth() + 1, dayofmonth: () => d().getUTCDate(),
        dayofweek: () => d().getUTCDay() + 1, hour: () => d().getUTCHours(), minute: () => d().getUTCMinutes(), second: () => d().getUTCSeconds(),
        weekofyear: () => { const x = d(); const s = Date.UTC(x.getUTCFullYear(), 0, 1); return Math.ceil(((x - s) / 86400000 + new Date(s).getUTCDay() + 1) / 7); },
      },
      na: (v) => isNa(v),
      nz: (v, r) => (isNa(v) ? (r === undefined ? 0 : r) : v),
      fixnan: (v) => v,
      int: (v) => (isNa(v) ? NaN : Math.trunc(v)),
      float: (v) => (isNa(v) ? NaN : Number(v)),
      bool: (v) => !!v,
      string: (v) => String(v),
      timestamp: (...a) => {
        if (typeof a[0] === 'string' && a.length === 1) return Date.parse(a[0]);
        const nums = a.filter((x) => typeof x === 'number');
        return Date.UTC(nums[0], (nums[1] || 1) - 1, nums[2] || 1, nums[3] || 0, nums[4] || 0, nums[5] || 0);
      },
      alert: noop, alertcondition: noop, max_bars_back: noop, library: noop,
      range: (a, b, step) => {
        const r = [];
        const s = step === undefined ? (a <= b ? 1 : -1) : Math.abs(step) * (a <= b ? 1 : -1);
        if (s === 0) return r;
        for (let x = a; s > 0 ? x <= b : x >= b; x += s) { r.push(x); if (r.length > 1e6) break; }
        return r;
      },
      guard: () => {
        if (++guardCount > 2e6) throw new PineError('Loop terlalu lama (kemungkinan loop tak berujung)', $.L);
        return true;
      },
      indicator: (title, shorttitle, overlay, format, precision, scale, mbb, tf, tfg, zorder, maxLines, maxLabels, maxBoxes) => {
        if (i !== 0) return;
        result.decl = { type: 'indicator', title: title || 'Indikator', overlay: !!overlay };
        setLimits(maxLines, maxLabels, maxBoxes);
      },
      study: (title, shorttitle, overlay) => $.indicator(title, shorttitle, overlay),
      strategyDecl: (title, shorttitle, overlay, format, precision, scale, pyramiding, cooF, cEveryTick, mbb, bfla, qtyType, qtyValue, capital, currency, slippage, commType, commValue, pooc, cer, ml, ms, zorder, maxLines, maxLabels, maxBoxes) => {
        if (i !== 0) return;
        setLimits(maxLines, maxLabels, maxBoxes);
        isStrategy = true;
        result.decl = { type: 'strategy', title: title || 'Strategy', overlay: !!overlay };
        broker.configure({
          initial_capital: numOr(capital, 10000), default_qty_type: qtyType || 'fixed', default_qty_value: numOr(qtyValue, 1),
          commission_type: commType || 'percent', commission_value: numOr(commValue, 0), pyramiding: numOr(pyramiding, 1),
          slippage: numOr(slippage, 0), process_orders_on_close: !!pooc,
        });
      },
      strategy: strategyNS,
      plot: (site, series, title, color, linewidth, style, trackprice, histbase, offset, join, editable, showLast, display, format, precision, forceOverlay) => {
        const p = plotObj(site, 'plot', title, { style: style || 'line', linewidth: numOr(linewidth, 1), color0: color, hidden: display === 'none', forceOverlay: !!forceOverlay, histbase: numOr(histbase, 0) });
        const j = i + (offset || 0);
        if (j >= 0 && j < n) {
          p.values[j] = typeof series === 'boolean' ? +series : isNa(series) ? NaN : series;
          p.colors[j] = color === undefined ? null : color;
        }
        return p.id;
      },
      plotshape: (site, series, title, style, location, color, offset, text, textcolor, editable, size, showLast, display, format, precision, forceOverlay) => {
        let s = shapeMap.get(site);
        if (!s) {
          s = { id: 's' + site, title: title || 'Shape', style: style || 'xcross', location: location || 'abovebar', size: size || 'auto', hits: [], hidden: display === 'none', forceOverlay: !!forceOverlay };
          shapeMap.set(site, s);
          result.shapes.push(s);
        }
        if (series && !isNa(series)) {
          const val = typeof series === 'number' && s.location === 'absolute' ? series : NaN;
          s.hits.push({ i: i + (offset || 0), color: color || COLORS.blue, text: text || '', value: val });
        }
      },
      plotchar: (site, series, title, ch, location, color, offset, text, textcolor, editable, size, showLast, display, format, precision, forceOverlay) =>
        $.plotshape(site, series, title, 'char', location, color, offset, (ch || '★') + (text ? ' ' + text : ''), textcolor, editable, size, showLast, display, format, precision, forceOverlay),
      plotarrow: (site, series, title, colorup, colordown) => {
        if (isNa(series) || !series) return;
        $.plotshape(site + (series > 0 ? 'u' : 'd'), true, title, series > 0 ? 'arrowup' : 'arrowdown', series > 0 ? 'belowbar' : 'abovebar', series > 0 ? colorup || COLORS.green : colordown || COLORS.red);
      },
      plotcandle: noop, plotbar: noop,
      hline: (site, price, title, color, linestyle, linewidth, editable, display) => {
        if (!hlineMap.has(site)) {
          const h = { id: 'h' + site, price, title: title || '', color: color || COLORS.gray, linestyle: linestyle || 'dashed', linewidth: numOr(linewidth, 1), hidden: display === 'none' };
          hlineMap.set(site, h);
          result.hlines.push(h);
        }
        return 'h' + site;
      },
      bgcolor: (site, color, offset) => {
        let b = bgMap.get(site);
        if (!b) {
          b = { id: 'bg' + site, colors: new Array(n).fill(null) };
          bgMap.set(site, b);
          result.bgcolors.push(b);
        }
        const j = i + (offset || 0);
        if (j >= 0 && j < n) b.colors[j] = color || null;
      },
      barcolor: (site, color, offset) => {
        if (!result.barcolors) result.barcolors = new Array(n).fill(null);
        const j = i + (offset || 0);
        if (j >= 0 && j < n) result.barcolors[j] = color || null;
      },
      fill: noop,
      input: Object.assign(inputFn('any'), {
        any: inputFn('any'), int: inputFn('int'), float: inputFn('float'), bool: inputFn('bool'), string: inputFn('string'),
        source: inputFn('source'), color: inputFn('color'), timeframe: inputFn('timeframe'), price: inputFn('float'),
        time: inputFn('any'), symbol: inputFn('string'), session: inputFn('string'), text_area: inputFn('string'),
      }),
    };
    $.plot.style_line = 'line'; $.plot.style_linebr = 'line'; $.plot.style_stepline = 'step'; $.plot.style_stepline_diamond = 'step';
    $.plot.style_histogram = 'histogram'; $.plot.style_columns = 'columns'; $.plot.style_area = 'area'; $.plot.style_areabr = 'area';
    $.plot.style_circles = 'circles'; $.plot.style_cross = 'circles';
    $.hline.style_solid = 'solid'; $.hline.style_dashed = 'dashed'; $.hline.style_dotted = 'dotted';
    Object.assign($.position, {
      top_left: 'top_left', top_center: 'top_center', top_right: 'top_right', middle_left: 'middle_left', middle_center: 'middle_center',
      middle_right: 'middle_right', bottom_left: 'bottom_left', bottom_center: 'bottom_center', bottom_right: 'bottom_right',
    });
    Object.assign($.barmerge, { lookahead_on: 'on', lookahead_off: 'off', gaps_on: 'gaps_on', gaps_off: 'gaps_off' });
    Object.defineProperties($.barstate, {
      isfirst: { get: () => i === 0 },
      islast: { get: () => i === n - 1 },
      ishistory: { get: () => i < n - 1 },
      isrealtime: { get: () => false },
      isnew: { get: () => true },
      isconfirmed: { get: () => true },
      islastconfirmedhistory: { get: () => i === n - 1 },
    });
    // bantu hitung input.source: nilai default `close` dicari di $s
    const fn = compiled.fn;

    try {
      for (i = 0; i < n; i++) {
        const b = bars[i];
        R.time = b.time; R.open = b.open; R.high = b.high; R.low = b.low; R.close = b.close; R.volume = b.volume;
        R.prevClose = i > 0 ? bars[i - 1].close : NaN;
        $s.open = b.open; $s.high = b.high; $s.low = b.low; $s.close = b.close; $s.volume = b.volume;
        $s.time = b.time; $s.time_close = i + 1 < n ? bars[i + 1].time : b.time;
        $s.hl2 = (b.high + b.low) / 2; $s.hlc3 = (b.high + b.low + b.close) / 3;
        $s.ohlc4 = (b.open + b.high + b.low + b.close) / 4; $s.hlcc4 = (b.high + b.low + 2 * b.close) / 4;
        $s.bar_index = i; $s.last_bar_index = n - 1;
        guardCount = 0;
        if (isStrategy) broker.onBarOpen(i);
        fn($, $s, $h, $st, $u);
        if (isStrategy) broker.onBarClose(i);
        for (const k in $s) (H[k] || (H[k] = new Array(n)))[i] = $s[k];
      }
    } catch (e) {
      const msg = e instanceof PineError ? e.message : `Baris ${$.L}: ${e.message}`;
      result.error = msg + ` (bar #${i})`;
    }

    if (isStrategy) {
      result.strategy = {
        initialCapital: broker.cfg.initial_capital,
        trades: broker.trades,
        openTrades: broker.entries.length ? broker.openTradesSnapshot() : [],
        equity: broker.equity,
        cfg: broker.cfg,
      };
      result.strategy.metrics = BT.computeMetrics(result.strategy, bars);
    }
    return result;
  }

  // Ambil judul & jenis script tanpa menjalankan seluruh data.
  function peekDecl(src) {
    const m = /^\s*(indicator|strategy|study)\s*\(\s*(?:title\s*=\s*)?["']([^"']*)["']/m.exec(src);
    return m ? { type: m[1] === 'strategy' ? 'strategy' : 'indicator', title: m[2] } : { type: 'indicator', title: 'Script' };
  }

  const api = { tokenize, logicalLines, transpile, compile, run, peekDecl, PineError, COLORS, parseColor };
  root.LunaPine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
