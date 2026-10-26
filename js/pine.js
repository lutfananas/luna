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

    call(name, argToks) {
      const raw = argToks.length ? this.splitArgs(argToks) : [];
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
      const stack = []; // {indent, kind, scope?, lastExpr?}
      const closeFrame = (f) => {
        if (f.kind === 'func') {
          if (f.lastExpr) out[f.lastExpr.idx] = `$.L=${f.lastExpr.line}; return ${f.lastExpr.js};`;
          out.push('};');
          this.funcDepth--;
          this.scopes.pop();
        } else {
          out.push('}');
          if (f.scope) this.scopes.pop();
        }
      };
      const curFunc = () => {
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'func') return stack[k];
        return null;
      };

      for (let li = 0; li < lines.length; li++) {
        const L = lines[li];
        this.line = L.line;
        const toks = L.tokens;
        const first = toks[0];
        const isElse = first.t === 'id' && first.v === 'else';
        while (stack.length && L.indent <= stack[stack.length - 1].indent) {
          const f = stack[stack.length - 1];
          if (isElse && f.kind === 'if' && L.indent === f.indent) {
            stack.pop();
            out.push('}');
            break;
          }
          stack.pop();
          closeFrame(f);
        }
        const fn = curFunc();
        const parentFrame = stack[stack.length - 1];
        // reset kandidat return jika statement berada langsung di badan fungsi
        const directInFunc = fn && parentFrame === fn;
        const tag = `$.L=${L.line}; `;
        const opensBlock = (kind, extra) => {
          const nextL = lines[li + 1];
          if (!nextL || nextL.indent <= L.indent) this.err(`Blok "${kind}" kosong — baris berikutnya harus diindentasi`);
          stack.push(Object.assign({ indent: L.indent, kind }, extra || {}));
        };
        if (directInFunc) fn.lastExpr = null;

        // else / else if
        if (isElse) {
          if (out[out.length - 1] !== '}') this.err('"else" tanpa "if"');
          if (toks[1] && toks[1].v === 'if') {
            out.push(`else if (${this.expr(toks.slice(2))}) {`);
          } else {
            if (toks.length > 1) this.err('Sintaks "else" tidak valid');
            out.push('else {');
          }
          opensBlock('if');
          continue;
        }
        if (first.t === 'id' && first.v === 'if') {
          out.push(`${tag}if (${this.expr(toks.slice(1))}) {`);
          opensBlock('if');
          continue;
        }
        if (first.t === 'id' && first.v === 'while') {
          out.push(`${tag}while ($.guard() && (${this.expr(toks.slice(1))})) {`);
          opensBlock('while');
          continue;
        }
        if (first.t === 'id' && first.v === 'for') {
          if (!(toks[1] && toks[1].t === 'id' && toks[2] && toks[2].v === '=')) {
            if (toks[2] && toks[2].v === 'in') this.err('"for ... in" belum didukung');
            this.err('Format: for i = awal to akhir [by langkah]');
          }
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
        if (first.t === 'id' && first.v === 'switch') this.err('"switch" belum didukung, gunakan if / else if');

        // definisi fungsi: nama(a, b) => ...
        if (first.t === 'id' && !first.v.includes('.') && toks[1] && toks[1].v === '(') {
          const j = this.match(toks, 1);
          if (toks[j + 1] && toks[j + 1].v === '=>') {
            if (fn) this.err('Fungsi tidak boleh didefinisikan di dalam fungsi');
            const params = [];
            const defs = [];
            for (const p of this.splitArgs(toks.slice(2, j))) {
              let k = 0;
              while (p[k] && p[k].t === 'id' && TYPES.has(p[k].v) && p[k + 1] && p[k + 1].t === 'id') k++;
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
              opensBlock('func');
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
              if (a.length !== 1 || a[0].t !== 'id') this.err('Deklarasi tuple tidak valid');
              return a[0].v;
            });
            const rhs = this.expr(toks.slice(j + 2));
            if (fn) {
              if (op.v === '=') names.forEach((n) => this.scopes[this.scopes.length - 1].add(n));
              out.push(`${tag}${op.v === '=' ? 'let ' : ''}[${names.map((n) => 'v_' + n).join(', ')}] = ${rhs};`);
            } else {
              if (op.v === '=') names.forEach((n) => this.globals.add(n));
              out.push(`${tag}[${names.map((n) => this.ident(n)).join(', ')}] = ${rhs};`);
            }
            continue;
          }
        }

        // deklarasi: [var|varip] [tipe] nama = expr
        {
          let k = 0;
          let isVar = false;
          if (toks[k] && toks[k].t === 'id' && (toks[k].v === 'var' || toks[k].v === 'varip')) { isVar = true; k++; }
          while (toks[k] && toks[k].t === 'id' && TYPES.has(toks[k].v) && toks[k + 1] && toks[k + 1].t === 'id' && !(toks[k + 1].v === 'and' || toks[k + 1].v === 'or')) {
            // lompati tipe, termasuk generic sederhana seperti array<float> tidak didukung
            k++;
          }
          const nameTok = toks[k];
          const eq = toks[k + 1];
          if (nameTok && nameTok.t === 'id' && !nameTok.v.includes('.') && eq && eq.t === 'op' && eq.v === '=') {
            const name = nameTok.v;
            if (SERIES.has(name)) this.err(`"${name}" adalah variabel bawaan dan tidak bisa dideklarasikan ulang`);
            const rhsToks = toks.slice(k + 2);
            if (rhsToks[0] && rhsToks[0].t === 'id' && (rhsToks[0].v === 'if' || rhsToks[0].v === 'switch')) this.err(`"${rhsToks[0].v}" sebagai ekspresi belum didukung — deklarasikan variabel dulu lalu isi dengan ":=" di dalam if`);
            if (fn) {
              const rhs = this.expr(rhsToks);
              this.scopes[this.scopes.length - 1].add(name);
              out.push(`${tag}let v_${name} = ${rhs};`);
            } else {
              const loopLocal = this.isLocal(name);
              if (loopLocal) this.err(`"${name}" sudah dipakai sebagai variabel loop`);
              const rhs = this.expr(rhsToks);
              this.globals.add(name);
              const key = JSON.stringify(name);
              out.push(isVar ? `${tag}if (!(${key} in $s)) $s[${key}] = ${rhs};` : `${tag}$s[${key}] = ${rhs};`);
            }
            continue;
          }
        }

        // reassign: nama := expr, nama += expr
        if (first.t === 'id' && toks[1] && toks[1].t === 'op' && (toks[1].v === ':=' || /^[+\-*/%]=$/.test(toks[1].v))) {
          const name = first.v;
          if (!this.isLocal(name) && !this.globals.has(name)) this.err(`Variabel "${name}" belum dideklarasikan (gunakan "=" untuk deklarasi pertama)`);
          const op = toks[1].v === ':=' ? '=' : toks[1].v;
          out.push(`${tag}${this.ident(name)} ${op} ${this.expr(toks.slice(2))};`);
          continue;
        }

        // statement ekspresi
        const js = this.expr(toks);
        out.push(`${tag}${js};`);
        if (directInFunc) fn.lastExpr = { idx: out.length - 1, js, line: L.line };
      }
      while (stack.length) closeFrame(stack.pop());
      return out.join('\n');
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
      plots: [], shapes: [], hlines: [], bgcolors: [], barcolors: null, inputs: [], strategy: null, error: null,
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
          if (f === 'percent') return v.toFixed(2) + '%';
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
      },
      shape: { xcross: 'xcross', cross: 'cross', circle: 'circle', triangleup: 'triangleup', triangledown: 'triangledown', flag: 'flag', arrowup: 'arrowup', arrowdown: 'arrowdown', labelup: 'labelup', labeldown: 'labeldown', square: 'square', diamond: 'diamond' },
      location: { abovebar: 'abovebar', belowbar: 'belowbar', top: 'top', bottom: 'bottom', absolute: 'absolute' },
      size: { auto: 'auto', tiny: 'tiny', small: 'small', normal: 'normal', large: 'large', huge: 'huge' },
      display: { all: 'all', none: 'none', pane: 'pane', data_window: 'data_window', price_scale: 'price_scale', status_line: 'status_line' },
      position: {}, extend: {}, xloc: {}, yloc: {}, text: {}, font: {}, format: { price: 'price', volume: 'volume', percent: 'percent', mintick: 'mintick', inherit: 'inherit' },
      scale: { right: 'right', left: 'left', none: 'none' }, currency: {}, barmerge: {}, session: {}, order: {},
      label: objNoop, line: objNoop, box: objNoop, table: objNoop, linefill: objNoop, array: objNoop, log: objNoop, runtime: { error: (m) => { throw new PineError(m, $.L); } },
      request: {
        security: (sym, tf, expr) => expr,
      },
      barstate: {},
      syminfo: { ticker: opts.symbol || '', tickerid: opts.symbol || '', mintick: broker.cfg.mintick, currency: 'USDT', basecurrency: '', type: 'crypto', timezone: 'UTC' },
      timeframe: { period: opts.timeframe || '', isintraday: true, isdaily: false, isweekly: false, ismonthly: false, multiplier: 1 },
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
      indicator: (title, shorttitle, overlay) => {
        if (i === 0) result.decl = { type: 'indicator', title: title || 'Indikator', overlay: !!overlay };
      },
      study: (title, shorttitle, overlay) => $.indicator(title, shorttitle, overlay),
      strategyDecl: (title, shorttitle, overlay, format, precision, scale, pyramiding, cooF, cEveryTick, mbb, bfla, qtyType, qtyValue, capital, currency, slippage, commType, commValue, pooc) => {
        if (i !== 0) return;
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
    Object.assign($.position, { top_left: 'top_left', top_right: 'top_right', bottom_left: 'bottom_left', bottom_right: 'bottom_right', middle_center: 'middle_center' });
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
