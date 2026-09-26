/* Synapse · diagrams.js
   The AI describes a diagram as small structured data (never raw SVG).
   This module validates that data and draws it deterministically:
     flow, cycle, layers  → SVG   (web theme uses CSS variables; print theme uses hex)
     comparison           → simple CSS/HTML in the reader, a table in the PDF
   All SVG is 360 units wide so it stays legible on a phone. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { esc } = S.util;

  const W = 360;
  const KINDS = {
    flow: 'flow', flowchart: 'flow', process: 'flow', sequence: 'flow', pipeline: 'flow', steps: 'flow', diagram: 'flow', block: 'flow', graph: 'flow',
    cycle: 'cycle', loop: 'cycle', circular: 'cycle', feedback: 'cycle',
    layers: 'layers', stack: 'layers', layered: 'layers', hierarchy: 'layers', levels: 'layers', pyramid: 'layers',
    comparison: 'comparison', compare: 'comparison', versus: 'comparison', table: 'comparison', columns: 'comparison',
  };

  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80);

  /* ---------- validation ---------- */
  function clean(spec) {
    if (!spec || typeof spec !== 'object') return null;
    const kind = KINDS[String(spec.kind || spec.type || 'flow').toLowerCase()];
    if (!kind) return null;

    if (kind === 'flow' || kind === 'cycle') {
      let nodes = Array.isArray(spec.nodes) ? spec.nodes : Array.isArray(spec.steps) ? spec.steps : [];
      nodes = nodes
        .map((n, i) => {
          if (typeof n === 'string') return { id: 'n' + i, label: str(n, 60) };
          if (!n || typeof n !== 'object') return null;
          return { id: str(n.id != null ? n.id : 'n' + i, 40), label: str(n.label || n.title || n.name || n.id, 60), group: Number.isFinite(+n.group) ? +n.group : 0 };
        })
        .filter((n) => n && n.label)
        .slice(0, kind === 'cycle' ? 8 : 12);
      const minNodes = kind === 'cycle' ? 3 : 2;
      if (nodes.length < minNodes) return null;
      const ids = new Set();
      nodes.forEach((n, i) => {
        if (ids.has(n.id)) n.id = n.id + '_' + i;
        ids.add(n.id);
      });
      if (kind === 'cycle') return { kind, nodes, center: str(spec.center, 40) };
      const byLabel = new Map(nodes.map((n) => [n.label.toLowerCase(), n.id]));
      const resolve = (r) => {
        if (ids.has(String(r))) return String(r);
        const k = byLabel.get(String(r).toLowerCase());
        if (k) return k;
        if (Number.isInteger(+r) && nodes[+r]) return nodes[+r].id;
        return null;
      };
      let edges = (Array.isArray(spec.edges) ? spec.edges : Array.isArray(spec.links) ? spec.links : [])
        .map((e) => {
          if (!e || typeof e !== 'object') return null;
          const from = resolve(e.from != null ? e.from : e.source);
          const to = resolve(e.to != null ? e.to : e.target);
          if (from == null || to == null || from === to) return null;
          return { from, to, label: str(e.label, 24) };
        })
        .filter(Boolean)
        .slice(0, 20);
      if (!edges.length) edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, label: '' }));
      return { kind, nodes, edges };
    }

    if (kind === 'layers') {
      const layers = (Array.isArray(spec.layers) ? spec.layers : Array.isArray(spec.items) ? spec.items : [])
        .map((l) => (typeof l === 'string' ? { label: str(l, 60), detail: '' } : l && typeof l === 'object' ? { label: str(l.label || l.title || l.name, 60), detail: str(l.detail || l.description, 110) } : null))
        .filter((l) => l && l.label)
        .slice(0, 8);
      return layers.length >= 2 ? { kind, layers } : null;
    }

    // comparison
    const columns = (Array.isArray(spec.columns) ? spec.columns : Array.isArray(spec.items) ? spec.items : [])
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const points = (Array.isArray(c.points) ? c.points : Array.isArray(c.items) ? c.items : []).map((p) => str(p, 120)).filter(Boolean).slice(0, 7);
        return { title: str(c.title || c.label || c.name, 50), points };
      })
      .filter((c) => c && c.title)
      .slice(0, 3);
    return columns.length >= 2 ? { kind, columns } : null;
  }

  /* ---------- theming ---------- */
  function theme(mode, fontFamily) {
    const web = mode === 'web';
    const tints = web
      ? ['var(--d-tint-0)', 'var(--d-tint-1)', 'var(--d-tint-2)', 'var(--d-tint-3)']
      : ['#ECEEFF', '#E3F6F2', '#FFF3DC', '#F1E9FC'];
    const strokes = web
      ? ['var(--d-stroke-0)', 'var(--d-stroke-1)', 'var(--d-stroke-2)', 'var(--d-stroke-3)']
      : ['#3140F5', '#0E9F8A', '#B26B00', '#7B4BD6'];
    const c = web
      ? { text: 'var(--d-text)', muted: 'var(--d-muted)', line: 'var(--d-line)', bg: 'var(--d-bg)', accent: 'var(--d-accent)' }
      : { text: '#1B2233', muted: '#5B6478', line: '#7A8499', bg: '#FFFFFF', accent: '#3140F5' };
    const font = web ? 'var(--font-ui)' : fontFamily || 'Helvetica, Arial, sans-serif';
    const shape = ({ fill, stroke, sw, dash }) =>
      web
        ? 'style="fill:' + (fill || 'none') + ';stroke:' + (stroke || 'none') + ';stroke-width:' + (sw || 0) + (dash ? ';stroke-dasharray:' + dash : '') + '"'
        : 'fill="' + (fill || 'none') + '" stroke="' + (stroke || 'none') + '" stroke-width="' + (sw || 0) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '');
    const text = ({ x, y, size, weight, fill, anchor, content }) =>
      web
        ? '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'middle') + '" style="font:' + (weight || 500) + ' ' + size + 'px ' + font + ';fill:' + fill + '">' + esc(content) + '</text>'
        : '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'middle') + '" font-family="' + font + '" font-size="' + size + '"' + (weight >= 600 ? ' font-weight="bold"' : '') + ' fill="' + fill + '">' + esc(content) + '</text>';
    return { web, tints, strokes, c, font, shape, text };
  }

  /* ---------- geometry helpers ---------- */
  function wrap(label, maxChars) {
    const words = String(label).split(' ');
    const lines = [];
    let cur = '';
    words.forEach((w) => {
      while (w.length > maxChars) {
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, maxChars - 1) + '-');
        w = w.slice(maxChars - 1);
      }
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.slice(0, 4);
  }

  const CHAR_W = 6.7; // average glyph width at 12px
  function nodeBox(label, maxW, size) {
    size = size || 12;
    const cw = (CHAR_W * size) / 12;
    const maxChars = Math.max(6, Math.floor((maxW - 18) / cw));
    const lines = wrap(label, maxChars);
    const longest = Math.max(...lines.map((l) => l.length));
    const w = Math.min(maxW, Math.max(74, Math.round(longest * cw + 20)));
    const h = 16 + lines.length * (size + 3.5);
    return { lines, w, h, size };
  }

  function arrowHead(p, q, size, T) {
    // arrow tip at q, pointing away from p
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const bx = q.x - ux * size, by = q.y - uy * size;
    const nx = -uy * (size * 0.5), ny = ux * (size * 0.5);
    return '<polygon points="' + q.x.toFixed(1) + ',' + q.y.toFixed(1) + ' ' + (bx + nx).toFixed(1) + ',' + (by + ny).toFixed(1) + ' ' + (bx - nx).toFixed(1) + ',' + (by - ny).toFixed(1) + '" ' + T.shape({ fill: T.c.line }) + '/>';
  }

  function rectEdge(cx, cy, w, h, dx, dy, pad) {
    // intersection of ray from centre toward (dx,dy) with the rect border (plus padding)
    const hw = w / 2 + (pad || 0), hh = h / 2 + (pad || 0);
    const t = Math.min(hw / (Math.abs(dx) || 1e-6), hh / (Math.abs(dy) || 1e-6));
    return { x: cx + dx * t, y: cy + dy * t };
  }

  function textLines(T, lines, cx, top, size, weight, fill) {
    const lh = size + 3.5;
    return lines.map((l, i) => T.text({ x: cx, y: (top + size * 0.86 + i * lh).toFixed(1), size, weight, fill, content: l })).join('');
  }

  function wrapSvg(inner, H, label, T, mode) {
    const open = T.web
      ? '<svg class="diagram" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    return open + inner + '</svg>';
  }

  /* ---------- flow ---------- */
  function flowSvg(spec, T, label) {
    const nodes = spec.nodes;
    const n = nodes.length;
    const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
    const edges = spec.edges.filter((e) => idx.has(e.from) && idx.has(e.to));

    // 1. break cycles (DFS), then layer by longest path
    const adj = nodes.map(() => []);
    edges.forEach((e, k) => adj[idx.get(e.from)].push({ to: idx.get(e.to), k }));
    const indeg0 = new Array(n).fill(0);
    edges.forEach((e) => indeg0[idx.get(e.to)]++);
    const state = new Array(n).fill(0);
    const back = new Set();
    const dfs = (u) => {
      state[u] = 1;
      adj[u].forEach(({ to, k }) => {
        if (state[to] === 0) dfs(to);
        else if (state[to] === 1) back.add(k);
      });
      state[u] = 2;
    };
    for (let i = 0; i < n; i++) if (indeg0[i] === 0 && state[i] === 0) dfs(i);
    for (let i = 0; i < n; i++) if (state[i] === 0) dfs(i);

    const fwd = edges.map((e, k) => ({ a: idx.get(e.from), b: idx.get(e.to), k })).filter((e) => !back.has(e.k));
    const indeg = new Array(n).fill(0);
    fwd.forEach((e) => indeg[e.b]++);
    const layer = new Array(n).fill(0);
    const queue = [];
    for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
    const seen = [];
    while (queue.length) {
      const u = queue.shift();
      seen.push(u);
      fwd.filter((e) => e.a === u).forEach((e) => {
        layer[e.b] = Math.max(layer[e.b], layer[u] + 1);
        if (--indeg[e.b] === 0) queue.push(e.b);
      });
    }

    // 2. rows: layers split into chunks of ≤3
    const layers = [];
    for (let i = 0; i < n; i++) (layers[layer[i]] = layers[layer[i]] || []).push(i);
    const rows = [];
    layers.filter(Boolean).forEach((ids) => {
      for (let k = 0; k < ids.length; k += 3) rows.push(ids.slice(k, k + 3));
    });

    const PAD = 14, GAP = 14, ROWGAP = 38;
    const hasBack = edges.some((e, k) => back.has(k));
    const AV = hasBack ? W - 66 : W; // leave a right-hand lane for loop-back arrows
    const pos = new Array(n);
    let y = 16;
    rows.forEach((row) => {
      const k = row.length;
      const cap = (AV - 2 * PAD - (k - 1) * GAP) / k;
      const boxes = row.map((i) => nodeBox(nodes[i].label, cap));
      const rowH = Math.max(...boxes.map((b) => b.h));
      const total = boxes.reduce((s, b) => s + b.w, 0) + (k - 1) * GAP;
      let x = (AV - total) / 2;
      row.forEach((i, j) => {
        const b = boxes[j];
        pos[i] = { x, y: y + (rowH - b.h) / 2, w: b.w, h: b.h, lines: b.lines, size: b.size, cx: x + b.w / 2, cy: y + rowH / 2 };
        x += b.w + GAP;
      });
      y += rowH + ROWGAP;
    });
    const H = Math.round(y - ROWGAP + 16);

    // 3. draw edges first, then nodes on top
    let g = '';
    let labels = '';
    edges.forEach((e, k) => {
      const A = pos[idx.get(e.from)], B = pos[idx.get(e.to)];
      const isBack = back.has(k);
      let p0, p1, path, tail, mid;
      if (!isBack && B.cy > A.cy + 1) {
        p0 = { x: A.cx, y: A.y + A.h };
        p1 = { x: B.cx, y: B.y };
        const dy = Math.max(12, (p1.y - p0.y) * 0.5);
        path = 'M' + p0.x.toFixed(1) + ',' + p0.y.toFixed(1) + ' C' + p0.x.toFixed(1) + ',' + (p0.y + dy).toFixed(1) + ' ' + p1.x.toFixed(1) + ',' + (p1.y - dy).toFixed(1) + ' ' + p1.x.toFixed(1) + ',' + (p1.y - 0.5).toFixed(1);
        tail = { x: p1.x, y: p1.y - dy };
        mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        if (Math.abs(p0.x - p1.x) < 1) path = 'M' + p0.x.toFixed(1) + ',' + p0.y.toFixed(1) + ' L' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1);
        if (Math.abs(p0.x - p1.x) < 1) tail = { x: p0.x, y: p0.y };
      } else if (Math.abs(B.cy - A.cy) < 1) {
        // same row: connect sides
        const left = A.cx < B.cx;
        p0 = { x: left ? A.x + A.w : A.x, y: A.cy };
        p1 = { x: left ? B.x : B.x + B.w, y: B.cy };
        path = 'M' + p0.x.toFixed(1) + ',' + p0.y.toFixed(1) + ' L' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1);
        tail = p0;
        mid = { x: (p0.x + p1.x) / 2, y: p0.y - 8 };
      } else {
        // back edge: loop around the right-hand side
        p0 = { x: A.x + A.w, y: A.cy };
        p1 = { x: B.x + B.w, y: B.cy };
        const out = Math.min(W - 62, Math.max(p0.x, p1.x) + 20);
        path = 'M' + p0.x.toFixed(1) + ',' + p0.y.toFixed(1) + ' C' + out + ',' + p0.y.toFixed(1) + ' ' + out + ',' + p1.y.toFixed(1) + ' ' + (p1.x + 0.5).toFixed(1) + ',' + p1.y.toFixed(1);
        tail = { x: out, y: p1.y };
        mid = { x: out + 8, y: (p0.y + p1.y) / 2, side: true };
      }
      g += '<path d="' + path + '" ' + T.shape({ stroke: T.c.line, sw: 1.4 }) + '/>';
      g += arrowHead(tail, p1, 7, T);
      if (e.label && mid.side) {
        wrap(e.label, 10).slice(0, 2).forEach((ln, li, all) => {
          labels += T.text({ x: mid.x.toFixed(1), y: (mid.y + 4 + (li - (all.length - 1) / 2) * 12).toFixed(1), size: 10, weight: 500, fill: T.c.muted, anchor: 'start', content: ln });
        });
      } else if (e.label) {
        const w = e.label.length * 5.6 + 10;
        labels += '<rect x="' + (mid.x - w / 2).toFixed(1) + '" y="' + (mid.y - 8).toFixed(1) + '" width="' + w.toFixed(1) + '" height="15" rx="4" ' + T.shape({ fill: T.c.bg }) + '/>';
        labels += T.text({ x: mid.x.toFixed(1), y: (mid.y + 3).toFixed(1), size: 10, weight: 500, fill: T.c.muted, content: e.label });
      }
    });
    nodes.forEach((nd, i) => {
      const p = pos[i];
      const gi = ((nd.group || 0) % 4 + 4) % 4;
      g += '<rect x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" width="' + p.w + '" height="' + p.h + '" rx="9" ' + T.shape({ fill: T.tints[gi], stroke: T.strokes[gi], sw: 1.3 }) + '/>';
      g += textLines(T, p.lines, p.cx.toFixed(1), p.y + 8, p.size, 600, T.c.text);
    });
    return { svg: wrapSvg(g + labels, H, label, T), width: W, height: H };
  }

  /* ---------- cycle ---------- */
  function cycleSvg(spec, T, label) {
    const n = spec.nodes.length;
    const nw = n > 6 ? 84 : 98;
    const R = (W - nw) / 2 - 10;
    const cx = W / 2;
    const boxes = spec.nodes.map((nd) => nodeBox(nd.label, nw, n > 6 ? 11 : 12));
    const nh = Math.max(...boxes.map((b) => b.h));
    const cy = R + nh / 2 + 14;
    const H = Math.round(2 * R + nh + 28);
    const pts = spec.nodes.map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
    let g = '';
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const bi = boxes[i], bj = boxes[(i + 1) % n];
      const s = rectEdge(a.x, a.y, nw, bi.h, ux, uy, 4);
      const e = rectEdge(b.x, b.y, nw, bj.h, -ux, -uy, 5);
      g += '<line x1="' + s.x.toFixed(1) + '" y1="' + s.y.toFixed(1) + '" x2="' + e.x.toFixed(1) + '" y2="' + e.y.toFixed(1) + '" ' + T.shape({ stroke: T.c.line, sw: 1.4 }) + '/>';
      g += arrowHead(s, e, 7, T);
    }
    if (spec.center) {
      const cl = wrap(spec.center, 14);
      g += textLines(T, cl, cx, cy - (cl.length * 15.5) / 2 + 2, 13, 700, T.c.accent);
    }
    spec.nodes.forEach((nd, i) => {
      const b = boxes[i], p = pts[i];
      const x = p.x - nw / 2, y = p.y - b.h / 2;
      const gi = i % 4;
      g += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + nw + '" height="' + b.h + '" rx="9" ' + T.shape({ fill: T.tints[gi], stroke: T.strokes[gi], sw: 1.3 }) + '/>';
      g += textLines(T, b.lines, p.x.toFixed(1), y + 8, b.size, 600, T.c.text);
    });
    return { svg: wrapSvg(g, H, label, T), width: W, height: H };
  }

  /* ---------- layers ---------- */
  function layersSvg(spec, T, label) {
    let y = 12;
    let g = '';
    const x = 14, w = W - 28;
    spec.layers.forEach((l, i) => {
      const titleLines = wrap(l.label, 44);
      const detailLines = l.detail ? wrap(l.detail, 52).slice(0, 2) : [];
      const h = 14 + titleLines.length * 16 + detailLines.length * 14 + 4;
      const gi = i % 4;
      g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="9" ' + T.shape({ fill: T.tints[gi], stroke: T.strokes[gi], sw: 1.3 }) + '/>';
      g += textLines(T, titleLines, x + 14, y + 8, 12.5, 700, T.c.text).replace(/text-anchor="middle"/g, 'text-anchor="start"');
      if (detailLines.length) g += textLines(T, detailLines, x + 14, y + 8 + titleLines.length * 16, 11, 500, T.c.muted).replace(/text-anchor="middle"/g, 'text-anchor="start"');
      y += h + 6;
    });
    const H = Math.round(y + 6);
    return { svg: wrapSvg(g, H, label, T), width: W, height: H };
  }

  /* ---------- public ---------- */
  const isCss = (spec) => !!spec && spec.kind === 'comparison';

  function comparisonHtml(spec) {
    return (
      '<div class="cmp" style="--cols:' + spec.columns.length + '">' +
      spec.columns.map((c) => '<div class="cmp-col"><h4>' + esc(c.title) + '</h4><ul>' + c.points.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></div>').join('') +
      '</div>'
    );
  }

  /** Returns { html } for the reader or { svg, width, height } for print. */
  function render(spec, opts) {
    opts = opts || {};
    spec = clean(spec);
    if (!spec) return null;
    const mode = opts.mode === 'print' ? 'print' : 'web';
    if (spec.kind === 'comparison') return { css: true, spec, html: comparisonHtml(spec) };
    const T = theme(mode, opts.fontFamily);
    const label = opts.label || 'Diagram';
    const r = spec.kind === 'flow' ? flowSvg(spec, T, label) : spec.kind === 'cycle' ? cycleSvg(spec, T, label) : layersSvg(spec, T, label);
    return { css: false, spec, svg: r.svg, html: r.svg, width: r.width, height: r.height };
  }

  S.diagrams = { clean, render, isCss, W };
})();
