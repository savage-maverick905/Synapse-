/* Synapse · markdown.js
   A small, safe Markdown-subset parser. It produces a block tree that both the
   HTML reader and the PDF exporter render, so a lesson looks the same in both.
   Everything is escaped; raw HTML from the AI is never injected. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { esc } = S.util;

  /* ---------- LaTeX-ish → readable Unicode ---------- */
  const SYMBOLS = {
    times: '×', cdot: '·', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
    approx: '≈', infty: '∞', sum: 'Σ', prod: '∏', int: '∫', partial: '∂', nabla: '∇', sqrt: '√',
    rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', leftrightarrow: '↔',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ',
    chi: 'χ', psi: 'ψ', omega: 'ω', Delta: 'Δ', Gamma: 'Γ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π',
    Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', ldots: '…', dots: '…', cdots: '⋯', degree: '°',
    circ: '∘', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃',
    propto: '∝', equiv: '≡', ll: '≪', gg: '≫', div: '÷', ohm: 'Ω',
  };
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
  const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ', i: 'ᵢ', j: 'ⱼ', r: 'ᵣ', u: 'ᵤ', v: 'ᵥ' };

  function mapAll(str, table) {
    let out = '';
    for (const ch of str) {
      if (!table[ch]) return null;
      out += table[ch];
    }
    return out;
  }

  function prettyMath(src) {
    let s = String(src == null ? '' : src).trim();
    s = s.replace(/\\ /g, ' ').replace(/\\(?:left|right|big|Big|bigg|Bigg)\b\s*/g, '').replace(/\\[,;:!]/g, ' ').replace(/\\quad|\\qquad/g, '  ');
    // \text{..} \mathrm{..} \mathbf{..} \operatorname{..}
    s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf|mathbb)\s*\{([^{}]*)\}/g, '$1');
    // \frac{a}{b}, repeated for nesting
    for (let i = 0; i < 4; i++) {
      s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => {
        const wrap = (x) => (/^[\w.]+$/.test(x) ? x : '(' + x + ')');
        return wrap(a) + '/' + wrap(b);
      });
      s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, a) => '√' + (/^[\w.]+$/.test(a) ? a : '(' + a + ')'));
    }
    s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (SYMBOLS[name] != null ? SYMBOLS[name] : name));
    s = s.replace(/\^\s*\{([^{}]*)\}|\^\s*([A-Za-z0-9+\-])/g, (m, a, b) => {
      const body = a != null ? a : b;
      const mapped = mapAll(body, SUP);
      return mapped != null ? mapped : '^(' + body + ')';
    });
    s = s.replace(/_\s*\{([^{}]*)\}|_\s*([A-Za-z0-9])/g, (m, a, b) => {
      const body = a != null ? a : b;
      const mapped = mapAll(body, SUB);
      return mapped != null ? mapped : '_' + body;
    });
    s = s.replace(/[{}]/g, '').replace(/\s{3,}/g, '  ');
    return s;
  }

  /* ---------- inline ---------- */
  function inline(text) {
    text = String(text || '');
    const out = [];
    let buf = '';
    let i = 0;
    const flush = () => {
      if (buf) {
        out.push({ t: 'text', v: buf });
        buf = '';
      }
    };
    while (i < text.length) {
      const c = text[i];
      if (c === '\\' && i + 1 < text.length && /[\\`*_{}\[\]()#+\-.!$|<>~]/.test(text[i + 1])) {
        buf += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '`') {
        const j = text.indexOf('`', i + 1);
        if (j > i) {
          flush();
          out.push({ t: 'code', v: text.slice(i + 1, j) });
          i = j + 1;
          continue;
        }
      }
      if (c === '$' && text[i + 1] && !/\s/.test(text[i + 1])) {
        const j = text.indexOf('$', i + 1);
        if (j > i + 1 && !/\s/.test(text[j - 1]) && !/\d/.test(text[j + 1] || '')) {
          flush();
          out.push({ t: 'math', v: prettyMath(text.slice(i + 1, j)) });
          i = j + 1;
          continue;
        }
      }
      if (c === '*' || c === '_') {
        const dbl = text[i + 1] === c;
        const mark = dbl ? c + c : c;
        const start = i + mark.length;
        const end = text.indexOf(mark, start);
        const wordBefore = i > 0 && /\w/.test(text[i - 1]);
        if (end > start && !/\s/.test(text[start]) && !/\s/.test(text[end - 1]) && !(c === '_' && wordBefore)) {
          flush();
          out.push({ t: dbl ? 'strong' : 'em', c: inline(text.slice(start, end)) });
          i = end + mark.length;
          continue;
        }
      }
      if (c === '[') {
        const m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(text.slice(i));
        if (m) {
          flush();
          out.push({ t: 'link', href: m[2], c: inline(m[1]) });
          i += m[0].length;
          continue;
        }
      }
      if (c === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i))) {
        const m = /^https?:\/\/[^\s)<]+/.exec(text.slice(i));
        if (m) {
          const url = m[0].replace(/[.,;:!?]+$/, '');
          flush();
          out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
          i += url.length;
          continue;
        }
      }
      if (c === '<') {
        const m = /^<br\s*\/?>/i.exec(text.slice(i));
        if (m) {
          flush();
          out.push({ t: 'br' });
          i += m[0].length;
          continue;
        }
      }
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /* ---------- blocks ---------- */
  const RE_FENCE = /^\s*(```+|~~~+)\s*([\w+#.\-]*)\s*$/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const RE_LIST = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
  const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  }

  function parse(src) {
    src = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    if (src.indexOf('\n') === -1 && src.indexOf('\\n') !== -1) src = src.replace(/\\n/g, '\n');
    const lines = src.split('\n');
    return parseLines(lines);
  }

  function isBlockStart(line) {
    return RE_FENCE.test(line) || RE_HEADING.test(line) || RE_HR.test(line) || RE_LIST.test(line) || /^\s*>/.test(line);
  }

  function parseLines(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      let m = RE_FENCE.exec(line);
      if (m) {
        const fence = m[1];
        const lang = (m[2] || '').toLowerCase();
        const body = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++;
        const text = body.join('\n').replace(/\s+$/, '');
        if (['equation', 'math', 'latex', 'tex'].includes(lang)) blocks.push({ type: 'equation', text: prettyMath(text.replace(/^\$\$|\$\$$/g, '')) });
        else blocks.push({ type: 'code', lang, text });
        continue;
      }
      m = RE_HEADING.exec(line);
      if (m) {
        blocks.push({ type: 'heading', level: m[1].length <= 3 ? 3 : 4, c: inline(m[2]) });
        i++;
        continue;
      }
      if (RE_HR.test(line)) {
        blocks.push({ type: 'hr' });
        i++;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const header = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left'));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        const n = header.length;
        blocks.push({
          type: 'table',
          aligns: header.map((_, k) => aligns[k] || 'left'),
          head: header.map(inline),
          rows: rows.map((r) => header.map((_, k) => inline(r[k] || ''))).slice(0, 60),
          cols: n,
        });
        continue;
      }
      if (/^\s*>/.test(line)) {
        const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        blocks.push({ type: 'quote', blocks: parseLines(q) });
        continue;
      }
      if (RE_LIST.test(line)) {
        const res = parseList(lines, i);
        blocks.push(res.block);
        i = res.next;
        continue;
      }
      // paragraph
      const para = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]))) {
        para.push(lines[i].trim());
        i++;
      }
      blocks.push({ type: 'p', c: inline(para.join(' ')) });
    }
    return blocks;
  }

  function parseList(lines, start) {
    const first = RE_LIST.exec(lines[start]);
    const baseIndent = first[1].replace(/\t/g, '    ').length;
    const ordered = /\d/.test(first[2]);
    const items = [];
    let i = start;
    while (i < lines.length) {
      const m = RE_LIST.exec(lines[i]);
      if (!m) {
        // continuation line (indented, non-blank) belongs to previous item
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length && !isBlockStart(lines[i])) {
          const it = items[items.length - 1];
          it.text += ' ' + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      const indent = m[1].replace(/\t/g, '    ').length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        if (!items.length) break;
        const sub = parseList(lines, i);
        const it = items[items.length - 1];
        it.children = sub.block;
        i = sub.next;
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ text: m[3], children: null });
      i++;
    }
    return {
      block: {
        type: 'list',
        ordered,
        items: items.map((it) => ({ c: inline(it.text), children: it.children })),
      },
      next: i,
    };
  }

  /* ---------- plain text (for word counts, search) ---------- */
  function inlineText(nodes) {
    return (nodes || [])
      .map((n) => (n.c ? inlineText(n.c) : n.t === 'br' ? ' ' : n.v || ''))
      .join('');
  }

  function blocksText(blocks) {
    return (blocks || [])
      .map((b) => {
        switch (b.type) {
          case 'p':
          case 'heading':
            return inlineText(b.c);
          case 'list':
            return b.items.map((it) => inlineText(it.c) + (it.children ? ' ' + blocksText([it.children]) : '')).join(' ');
          case 'table':
            return [b.head, ...b.rows].map((r) => r.map(inlineText).join(' ')).join(' ');
          case 'code':
          case 'equation':
            return b.text;
          case 'quote':
            return blocksText(b.blocks);
          default:
            return '';
        }
      })
      .join(' ');
  }

  /* ---------- figure placement ---------- */
  /** Spread images through the body instead of dumping them at the end. */
  function placeImages(blocks, images) {
    const n = blocks.length;
    const out = blocks.map((b) => ({ block: b }));
    if (!images || !images.length) return out;
    const k = images.length;
    const slots = [];
    images.forEach((img, i) => {
      let pos = Math.round(((i + 1) * n) / (k + 1)) - 1;
      pos = Math.max(0, Math.min(n - 1, pos));
      while (pos < n - 1 && blocks[pos] && blocks[pos].type === 'heading') pos++;
      slots.push({ pos, img });
    });
    const result = [];
    for (let idx = 0; idx < out.length; idx++) {
      result.push(out[idx]);
      slots.filter((s) => s.pos === idx).forEach((s) => result.push({ image: s.img }));
    }
    if (!n) images.forEach((img) => result.push({ image: img }));
    return result;
  }

  /* ---------- HTML ---------- */
  function inlineHtml(nodes) {
    return (nodes || [])
      .map((n) => {
        switch (n.t) {
          case 'text': return esc(n.v);
          case 'strong': return '<strong>' + inlineHtml(n.c) + '</strong>';
          case 'em': return '<em>' + inlineHtml(n.c) + '</em>';
          case 'code': return '<code>' + esc(n.v) + '</code>';
          case 'math': return '<span class="math">' + esc(n.v) + '</span>';
          case 'link': return '<a href="' + esc(n.href) + '" target="_blank" rel="noopener noreferrer">' + inlineHtml(n.c) + '</a>';
          case 'br': return '<br>';
          default: return '';
        }
      })
      .join('');
  }

  function blockHtml(b) {
    switch (b.type) {
      case 'p': return '<p>' + inlineHtml(b.c) + '</p>';
      case 'heading': return '<h' + b.level + ' class="sec">' + inlineHtml(b.c) + '</h' + b.level + '>';
      case 'hr': return '<hr>';
      case 'equation': return '<div class="equation" role="math">' + esc(b.text) + '</div>';
      case 'code':
        return (
          '<figure class="codeblock"><figcaption><span>' + esc(b.lang || 'code') + '</span>' +
          '<button type="button" class="link-btn" data-copy>Copy</button></figcaption>' +
          '<pre tabindex="0"><code>' + esc(b.text) + '</code></pre></figure>'
        );
      case 'quote': return '<blockquote>' + b.blocks.map(blockHtml).join('') + '</blockquote>';
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        return '<' + tag + '>' + b.items.map((it) => '<li>' + inlineHtml(it.c) + (it.children ? blockHtml(it.children) : '') + '</li>').join('') + '</' + tag + '>';
      }
      case 'table': {
        const th = b.head.map((c, k) => '<th style="text-align:' + b.aligns[k] + '">' + inlineHtml(c) + '</th>').join('');
        const body = b.rows.map((r) => '<tr>' + r.map((c, k) => '<td style="text-align:' + b.aligns[k] + '">' + inlineHtml(c) + '</td>').join('') + '</tr>').join('');
        return '<div class="table-wrap" tabindex="0"><table><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
      }
      default: return '';
    }
  }

  const toHtml = (blocks) => (blocks || []).map(blockHtml).join('');

  S.md = { parse, inline, inlineText, blocksText, placeImages, toHtml, inlineHtml, blockHtml, prettyMath };
})();
