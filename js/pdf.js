/* Synapse · pdf.js
   Builds a real, selectable-text PDF "book" in the browser with pdfmake.
   The page is 6 × 9 in (a trade paperback), which also reads well on a phone.
   Content is typeset from the same parsed lesson blocks the reader uses; diagrams are
   embedded as vector SVG. IBM Plex fonts are fetched once and cached for offline use;
   if they can't be loaded, the bundled Roboto font is used instead. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { blobToBase64, loadScript, nextFrame } = S.util;

  const PDFMAKE_URLS = [
    'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
  ];
  const VFS_URLS = [
    'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js',
  ];

  const PAGE = { width: 432, height: 648 };
  const MARGIN = [54, 62, 54, 62];
  const TEXT_W = PAGE.width - MARGIN[0] - MARGIN[2];

  const C = {
    ink: '#1E1E1E', muted: '#5C5C5C', faint: '#8A8A8A', accent: '#B8460F', accentBg: '#FDEDE4',
    signal: '#006E9E', signalBg: '#E3F4FC', warn: '#9A5B00', warnBg: '#FFF3DA', neutral: '#5C5C5C', neutralBg: '#ECECEC',
    rule: '#DADADA', codeBg: '#ECECEC', navy: '#1E1E1E', navy2: '#3A3A3A', lav: '#ED6627', mint: '#00ADEF',
  };

  /* ---------- text sanitising (emoji and odd glyphs have no font coverage) ---------- */
  const T = (s) =>
    String(s == null ? '' : s)
      .replace(/[\u200B-\u200F\u2060\uFE0E\uFE0F\uFEFF]/g, '')
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\t/g, '  ');

  /* ---------- libraries & fonts ---------- */
  const ensureLibs = async () => {
    await loadScript(PDFMAKE_URLS, () => window.pdfMake && typeof window.pdfMake.createPdf === 'function');
    await loadScript(VFS_URLS, () => window.pdfMake && window.pdfMake.vfs && Object.keys(window.pdfMake.vfs).length > 0);
  };

  const PLEX = {
    Serif: { dir: 'ibmplexserif', prefix: 'IBMPlexSerif', files: { normal: 'Regular', bold: 'Bold', italics: 'Italic', bolditalics: 'BoldItalic' } },
    Sans: { dir: 'ibmplexsans', prefix: 'IBMPlexSans', files: { normal: 'Regular', bold: 'Bold' } },
    Mono: { dir: 'ibmplexmono', prefix: 'IBMPlexMono', files: { normal: 'Regular' } },
  };
  const fontUrls = (dir, file) => [
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/' + dir + '/' + file,
    'https://raw.githubusercontent.com/google/fonts/main/ofl/' + dir + '/' + file,
  ];

  async function fetchFont(urls) {
    for (const url of urls) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size < 10000) continue;
        return await blobToBase64(blob);
      } catch (e) { /* try next */ }
    }
    return null;
  }

  let fontsPromise = null;
  function loadFonts() {
    if (fontsPromise) return fontsPromise;
    fontsPromise = (async () => {
      const roboto = { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' };
      const fonts = { Roboto: roboto, Serif: roboto, Sans: roboto, Mono: roboto };
      const vfs = Object.assign({}, window.pdfMake.vfs);
      let enhanced = 0;
      await Promise.all(
        Object.keys(PLEX).map(async (fam) => {
          const def = PLEX[fam];
          const got = {};
          await Promise.all(
            Object.keys(def.files).map(async (style) => {
              const b64 = await fetchFont(fontUrls(def.dir, def.prefix + '-' + def.files[style] + '.ttf'));
              if (b64) got[style] = b64;
            })
          );
          if (Object.keys(got).length !== Object.keys(def.files).length) return;
          const name = (style) => 'Plex' + fam + '-' + style + '.ttf';
          Object.keys(got).forEach((style) => { vfs[name(style)] = got[style]; });
          const has = (s) => (got[s] ? name(s) : null);
          fonts[fam] = {
            normal: has('normal'),
            bold: has('bold') || has('normal'),
            italics: has('italics') || has('normal'),
            bolditalics: has('bolditalics') || has('bold') || has('normal'),
          };
          enhanced++;
        })
      );
      return { fonts, vfs, enhanced };
    })().catch((e) => { fontsPromise = null; throw e; });
    return fontsPromise;
  }

  /* ---------- inline / block conversion ---------- */
  function runs(nodes, base) {
    base = base || {};
    const out = [];
    (nodes || []).forEach((n) => {
      switch (n.t) {
        case 'text': out.push(Object.assign({}, base, { text: T(n.v) })); break;
        case 'strong': out.push(...runs(n.c, Object.assign({}, base, { bold: true }))); break;
        case 'em': out.push(...runs(n.c, Object.assign({}, base, { italics: true }))); break;
        case 'math': out.push(Object.assign({}, base, { text: T(n.v), italics: true })); break;
        case 'code': out.push(Object.assign({}, base, { text: T(n.v), font: 'Mono', fontSize: (base.fontSize || 10.5) * 0.86, background: C.codeBg })); break;
        case 'link': out.push(...runs(n.c, Object.assign({}, base, { link: n.href, color: C.accent, decoration: 'underline' }))); break;
        case 'br': out.push({ text: '\n' }); break;
        default: break;
      }
    });
    return out.length ? out : [{ text: '' }];
  }

  function listNode(b) {
    const items = b.items.map((it) => (it.children ? { stack: [{ text: runs(it.c) }, listNode(it.children)] } : { text: runs(it.c) }));
    const node = b.ordered ? { ol: items } : { ul: items, markerColor: C.accent };
    node.style = 'list';
    return node;
  }

  function codeNode(b) {
    const lines = T(b.text).split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += 20) chunks.push(lines.slice(i, i + 20).join('\n'));
    const body = chunks.map((c) => [{ text: c || ' ', font: 'Mono', fontSize: 8, lineHeight: 1.28, preserveLeadingSpaces: true, color: C.ink, fillColor: C.codeBg }]);
    if (b.lang) body.unshift([{ text: b.lang, font: 'Sans', fontSize: 7, color: C.faint, fillColor: C.codeBg }]);
    return { table: { widths: ['*'], body }, layout: 'codeBox', margin: [0, 2, 0, 10] };
  }

  function tableNode(b) {
    const head = b.head.map((c, k) => ({ text: runs(c, { bold: true }), alignment: b.aligns[k], style: 'th', fillColor: C.accentBg }));
    const rows = b.rows.map((r) => r.map((c, k) => ({ text: runs(c), alignment: b.aligns[k], style: 'td' })));
    return { table: { headerRows: 1, widths: b.head.map(() => '*'), body: [head, ...rows] }, layout: 'synTable', margin: [0, 2, 0, 10] };
  }

  function blockNodes(b) {
    switch (b.type) {
      case 'p': return [{ text: runs(b.c), style: 'p' }];
      case 'heading': return [{ text: runs(b.c), style: b.level === 3 ? 'h3' : 'h4', headlineLevel: b.level }];
      case 'list': return [listNode(b)];
      case 'table': return [tableNode(b)];
      case 'code': return [codeNode(b)];
      case 'equation': return [{ text: T(b.text), style: 'equation' }];
      case 'quote': return [{ table: { widths: ['*'], body: [[{ stack: blocksToPdf(b.blocks), fillColor: C.neutralBg }]] }, layout: 'quoteBox', margin: [0, 2, 0, 9] }];
      case 'hr': return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: TEXT_W, y2: 0, lineWidth: 0.5, lineColor: C.rule }], margin: [0, 6, 0, 10] }];
      default: return [];
    }
  }
  const blocksToPdf = (blocks) => [].concat(...blocks.map(blockNodes));
  const mdNodes = (text) => blocksToPdf(S.md.parse(text));

  const KIND = {
    accent: { bg: C.accentBg, bar: C.accent, ink: C.accent },
    signal: { bg: C.signalBg, bar: C.signal, ink: C.signal },
    warn: { bg: C.warnBg, bar: C.warn, ink: C.warn },
    neutral: { bg: C.neutralBg, bar: C.faint, ink: C.muted },
  };

  /** A callout that can split across pages: one table row per block, one continuous rule at the left. */
  function box(kind, title, nodes) {
    const K = KIND[kind];
    const body = [[{ stack: [{ text: T(title), style: 'boxTitle', color: K.ink }], fillColor: K.bg }]];
    nodes.forEach((n) => body.push([{ stack: [n], fillColor: K.bg }]));
    return { table: { headerRows: 1, keepWithHeaderRows: 1, widths: ['*'], body }, layout: 'box_' + kind, margin: [0, 4, 0, 10] };
  }

  /* ---------- figures ---------- */
  function comparisonNode(spec) {
    const n = spec.columns.length;
    const rows = Math.max(...spec.columns.map((c) => c.points.length));
    const body = [spec.columns.map((c) => ({ text: T(c.title), style: 'th', fillColor: C.accentBg }))];
    for (let i = 0; i < rows; i++) body.push(spec.columns.map((c) => ({ text: c.points[i] ? '• ' + T(c.points[i]) : '', style: 'td' })));
    return { table: { headerRows: 1, widths: new Array(n).fill('*'), body }, layout: 'synTable' };
  }

  function figureNodes(img, ctx) {
    let body;
    if (img.type === 'diagram') {
      const r = S.diagrams.render(img.diagram, { mode: 'print', fontFamily: 'Sans', label: img.description });
      if (!r) return [];
      const png = ctx.raster && ctx.raster.get(img);
      body = r.css ? comparisonNode(r.spec) : png ? { image: png, width: Math.min(300, TEXT_W), alignment: 'center' } : { svg: r.svg, width: Math.min(300, TEXT_W), alignment: 'center' };
    } else if (img.dataUrl) {
      body = { image: img.dataUrl, fit: [Math.min(320, TEXT_W), 260], alignment: 'center' };
    } else return [];
    ctx.fig++;
    const stack = [body];
    if (img.caption) stack.push({ text: [{ text: 'Figure ' + ctx.fig + '. ', bold: true }, { text: T(img.caption) }], style: 'caption' });
    if (img.type === 'photo' && img.attribution) stack.push({ text: T(img.attribution), style: 'credit' });
    return [{ stack, unbreakable: true, margin: [0, 6, 0, 12] }];
  }

  /* ---------- content sections ---------- */
  const TOC_MODULE = { bold: true, font: 'Sans', fontSize: 10 };
  const TOC_LESSON = { font: 'Serif', fontSize: 9.5 };

  function lessonNodes(course, mi, li, ctx) {
    const l = course.modules[mi].lessons[li];
    const out = [];
    out.push({ text: 'Lesson ' + (mi + 1) + '.' + (li + 1), style: 'kicker', pageBreak: 'before' });
    out.push({ text: T(l.title), style: 'h2', tocItem: 'main', tocStyle: TOC_LESSON, tocMargin: [14, 1, 0, 1], tocNumberStyle: TOC_LESSON });
    if (l.summary) out.push({ text: T(l.summary), style: 'lede' });
    out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 48, y2: 0, lineWidth: 2, lineColor: C.accent }], margin: [0, 0, 0, 12] });

    const images = l.images.filter(S.images.isRenderable);
    S.md.placeImages(S.md.parse(l.content), images).forEach((item) => {
      if (item.block) out.push(...blockNodes(item.block));
      else out.push(...figureNodes(item.image, ctx));
    });

    if (l.keyPoints.length) out.push(box('accent', 'Key points', [{ ul: l.keyPoints.map((k) => ({ text: runs(S.md.inline(k)) })), markerColor: C.accent, style: 'list' }]));
    l.examples.forEach((ex) => out.push(box('signal', 'Example: ' + ex.title, mdNodes(ex.body))));
    if (l.exercise) {
      const nodes = [{ text: runs(S.md.inline(l.exercise.prompt)), style: 'p' }];
      if (l.exercise.hint) nodes.push({ text: [{ text: 'Hint: ', bold: true }, ...runs(S.md.inline(l.exercise.hint))], style: 'p', italics: true });
      out.push(box('warn', 'Try it yourself', nodes));
    }
    if (l.reflection.length) out.push(box('neutral', 'Reflect', [{ ul: l.reflection.map((q) => ({ text: runs(S.md.inline(q)) })), style: 'list' }]));

    if (l.quiz.questions.length) {
      out.push({ text: 'Check your understanding', style: 'h4', headlineLevel: 4, margin: [0, 10, 0, 6] });
      l.quiz.questions.forEach((q, qi) => {
        out.push({
          unbreakable: true,
          margin: [0, 0, 0, 6],
          stack: [
            { text: [{ text: (qi + 1) + '.  ', bold: true, font: 'Sans' }, ...runs(S.md.inline(q.question))], style: 'q' },
            { ol: q.options.map((o) => ({ text: runs(S.md.inline(o)) })), type: 'upper-alpha', style: 'opts' },
          ],
        });
      });
      out.push({ text: 'Answers are in the answer key at the end.', style: 'credit', alignment: 'left' });
    }

    if (l.sources.length) {
      out.push({ text: 'Further reading', style: 'h4', headlineLevel: 4, margin: [0, 10, 0, 4] });
      out.push({ ul: l.sources.map((s) => ({ text: [{ text: T(s.title), link: s.url, color: C.accent, decoration: 'underline' }, { text: s.website ? '  ' + T(s.website) : '', color: C.faint, fontSize: 8.5 }] })), style: 'list' });
    }
    return out;
  }

  function projectNodes(m, mi) {
    const p = m.project;
    const out = [
      { text: 'Module ' + (mi + 1) + ' project', style: 'kicker', pageBreak: 'before' },
      { text: T(p.title), style: 'h2', tocItem: 'main', tocStyle: TOC_LESSON, tocMargin: [14, 1, 0, 1], tocNumberStyle: TOC_LESSON },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 48, y2: 0, lineWidth: 2, lineColor: C.warn }], margin: [0, 0, 0, 12] },
      { text: runs(S.md.inline(p.brief)), style: 'p' },
    ];
    if (p.steps.length) {
      out.push({ text: 'Steps', style: 'h3', headlineLevel: 3 });
      out.push({ ol: p.steps.map((s) => ({ text: runs(S.md.inline(s)) })), style: 'list' });
    }
    if (p.deliverable) out.push(box('warn', 'What you should have at the end', [{ text: runs(S.md.inline(p.deliverable)), style: 'p' }]));
    return out;
  }

  function moduleNodes(course, mi, ctx) {
    const m = course.modules[mi];
    const out = [
      { text: 'Module ' + (mi + 1), style: 'kicker', pageBreak: 'before' },
      { text: T(m.title), style: 'moduleTitle', tocItem: 'main', tocStyle: TOC_MODULE, tocMargin: [0, 9, 0, 1], tocNumberStyle: TOC_MODULE },
    ];
    if (m.description) out.push({ text: T(m.description), style: 'lede' });
    out.push({ text: 'In this module', style: 'h4', margin: [0, 10, 0, 4] });
    out.push({ ul: m.lessons.map((l) => ({ text: T(l.title) })).concat(m.project ? [{ text: 'Project: ' + T(m.project.title), italics: true }] : []), style: 'list' });
    m.lessons.forEach((_, li) => out.push(...lessonNodes(course, mi, li, ctx)));
    if (m.project) out.push(...projectNodes(m, mi));
    return out;
  }

  function answerKeyNodes(course, moduleIdxs) {
    const out = [];
    moduleIdxs.forEach((mi) => {
      course.modules[mi].lessons.forEach((l, li) => {
        if (!l.quiz.questions.length) return;
        out.push({ text: (mi + 1) + '.' + (li + 1) + '  ' + T(l.title), style: 'h4', headlineLevel: 4, margin: [0, 8, 0, 3] });
        out.push({
          ul: l.quiz.questions.map((q, qi) => ({
            text: [{ text: 'Q' + (qi + 1) + ': ' + String.fromCharCode(65 + q.answerIndex) + '. ', bold: true, font: 'Sans' }, ...runs(S.md.inline(q.explanation || q.options[q.answerIndex]))],
          })),
          style: 'list', fontSize: 9.5,
        });
      });
    });
    if (!out.length) return [];
    return [{ text: 'Answer key', style: 'h1', pageBreak: 'before', tocItem: 'main', tocStyle: TOC_MODULE, tocMargin: [0, 9, 0, 1], tocNumberStyle: TOC_MODULE }, ...out];
  }

  function referencesNodes(course) {
    const verified = course.references.filter((r) => r.verified);
    const suggested = course.suggestedTopics.concat(course.references.filter((r) => !r.verified).map((r) => ({ title: r.title, description: r.description, url: r.url })));
    if (!verified.length && !suggested.length) return [];
    const out = [{ text: 'References', style: 'h1', pageBreak: 'before', tocItem: 'main', tocStyle: TOC_MODULE, tocMargin: [0, 9, 0, 1], tocNumberStyle: TOC_MODULE }];
    if (verified.length) {
      out.push({ text: 'Verified references', style: 'h3', headlineLevel: 3 });
      out.push({ text: 'Found through live web search. Links open the page directly.', style: 'credit', margin: [0, 0, 0, 6] });
      verified.forEach((r) => out.push({
        margin: [0, 0, 0, 7],
        stack: [
          { text: T(r.title), link: r.url, color: C.accent, decoration: 'underline', bold: true, font: 'Sans', fontSize: 9.5 },
          { text: T([r.website, r.description].filter(Boolean).join(' — ')), fontSize: 9.5, color: C.muted },
        ],
      }));
    }
    if (suggested.length) {
      out.push({ text: 'Suggested topics to explore', style: 'h3', headlineLevel: 3, margin: [0, 12, 0, 4] });
      out.push({ text: 'Ideas for what to look up next. Synapse has not checked these against live sources.', style: 'credit', margin: [0, 0, 0, 6] });
      suggested.forEach((t) => out.push({
        margin: [0, 0, 0, 6],
        stack: [
          t.url ? { text: T(t.title), link: t.url, color: C.accent, decoration: 'underline', bold: true, font: 'Sans', fontSize: 9.5 } : { text: T(t.title), bold: true, font: 'Sans', fontSize: 9.5 },
          { text: T(t.description || ''), fontSize: 9.5, color: C.muted },
        ],
      }));
    }
    return out;
  }

  /* ---------- cover ---------- */
  function rng(seed) {
    let a = 0;
    for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function coverArt(size, seed) {
    const r = rng(seed);
    const canvas = [{ type: 'rect', x: 0, y: 0, w: size.width, h: size.height, color: C.navy }];
    const pts = [];
    for (let i = 0; i < 30; i++) pts.push({ x: 20 + r() * (size.width - 40), y: size.height * 0.5 + r() * (size.height * 0.45), r: 1.2 + r() * 2.6, hot: r() < 0.14 });
    pts.forEach((a, i) => pts.slice(i + 1).forEach((b) => {
      if (Math.hypot(a.x - b.x, a.y - b.y) < 92) canvas.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, lineWidth: 0.6, lineColor: C.navy2 });
    }));
    pts.forEach((p) => canvas.push({ type: 'ellipse', x: p.x, y: p.y, r1: p.r, r2: p.r, color: p.hot ? C.mint : C.lav }));
    // the synapse: two cells with a gap and a spark
    const cy = size.height * 0.74;
    canvas.push({ type: 'ellipse', x: size.width * 0.3, y: cy, r1: 26, r2: 26, color: C.lav });
    canvas.push({ type: 'ellipse', x: size.width * 0.3, y: cy, r1: 12, r2: 12, color: C.navy });
    canvas.push({ type: 'ellipse', x: size.width * 0.7, y: cy - 22, r1: 17, r2: 17, color: C.mint });
    canvas.push({ type: 'ellipse', x: size.width * 0.5, y: cy - 8, r1: 3.4, r2: 3.4, color: '#FFFFFF' });
    return { canvas };
  }

  function coverNodes(c) {
    const size = c.title.length > 60 ? 22 : c.title.length > 34 ? 27 : 32;
    const out = [
      { text: 'SYNAPSE', font: 'Sans', bold: true, fontSize: 9, characterSpacing: 3, color: '#FFAD80', margin: [0, 24, 0, 0] },
      { text: T(c.kicker || ''), font: 'Sans', fontSize: 10, color: '#FFAD80', margin: [0, 84, 0, 8] },
      { text: T(c.title), font: 'Sans', bold: true, fontSize: size, lineHeight: 1.08, color: '#FFFFFF' },
    ];
    if (c.subtitle) out.push({ text: T(c.subtitle), font: 'Serif', italics: true, fontSize: 13, lineHeight: 1.3, color: '#F0C9B3', margin: [0, 14, 30, 0] });
    if (c.meta && c.meta.length) {
      out.push({
        absolutePosition: { x: MARGIN[0], y: PAGE.height - 104 },
        stack: c.meta.map((m) => ({ text: T(m), font: 'Sans', fontSize: 9, color: '#B8B8B8', margin: [0, 0, 0, 3] })),
      });
    }
    out.push({ text: '', pageBreak: 'after' });
    return out;
  }

  /* ---------- document ---------- */
  const layouts = (() => {
    const boxLayout = (color) => ({
      hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => color,
      paddingLeft: () => 12, paddingRight: () => 10,
      paddingTop: (i) => (i === 0 ? 8 : 1), paddingBottom: (i, node) => (i === node.table.body.length - 1 ? 8 : 1),
    });
    return {
      synTable: {
        hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.9 : 0.4), vLineWidth: () => 0,
        hLineColor: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? C.accent : C.rule),
        paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
      },
      codeBox: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 2.5 : 0), vLineColor: () => C.accent, paddingLeft: () => 9, paddingRight: () => 6, paddingTop: () => 3, paddingBottom: () => 3 },
      quoteBox: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 2.5 : 0), vLineColor: () => C.signal, paddingLeft: () => 10, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 2 },
      box_accent: boxLayout(C.accent), box_signal: boxLayout(C.signal), box_warn: boxLayout(C.warn), box_neutral: boxLayout(C.faint),
    };
  })();

  const STYLES = {
    p: { fontSize: 10.5, lineHeight: 1.38, margin: [0, 0, 0, 7] },
    list: { fontSize: 10.5, lineHeight: 1.32, margin: [0, 0, 0, 7] },
    h1: { font: 'Sans', bold: true, fontSize: 22, margin: [0, 0, 0, 14] },
    h2: { font: 'Sans', bold: true, fontSize: 20, lineHeight: 1.12, margin: [0, 0, 0, 8] },
    moduleTitle: { font: 'Sans', bold: true, fontSize: 26, lineHeight: 1.08, margin: [0, 0, 0, 10] },
    h3: { font: 'Sans', bold: true, fontSize: 13, margin: [0, 12, 0, 4] },
    h4: { font: 'Sans', bold: true, fontSize: 10.5, color: C.muted, margin: [0, 8, 0, 3] },
    kicker: { font: 'Sans', bold: true, fontSize: 9, color: C.accent, characterSpacing: 1, margin: [0, 0, 0, 6] },
    lede: { fontSize: 12, italics: true, color: C.muted, lineHeight: 1.4, margin: [0, 0, 0, 12] },
    caption: { font: 'Sans', fontSize: 8.5, color: C.muted, alignment: 'center', margin: [12, 5, 12, 0] },
    credit: { font: 'Sans', fontSize: 7.5, color: C.faint, alignment: 'center', margin: [12, 2, 12, 0] },
    boxTitle: { font: 'Sans', bold: true, fontSize: 9, characterSpacing: 0.4 },
    equation: { font: 'Serif', italics: true, fontSize: 12, alignment: 'center', margin: [0, 4, 0, 11], color: C.ink },
    th: { font: 'Sans', bold: true, fontSize: 8.5, color: C.ink },
    td: { fontSize: 9.2, lineHeight: 1.25 },
    q: { fontSize: 10.5, lineHeight: 1.3, margin: [0, 0, 0, 3] },
    opts: { fontSize: 10, lineHeight: 1.25, margin: [14, 0, 0, 0] },
  };

  const factsTable = (course, st) => ({
    table: {
      widths: [70, '*'],
      body: [
        ['Level', course.level], ['Duration', course.estimatedTime],
        ['Structure', st.modules + ' modules, ' + st.lessons + ' lessons' + (st.projects ? ', ' + st.projects + ' projects' : '')],
      ].map((r) => [{ text: r[0], font: 'Sans', bold: true, fontSize: 9, color: C.muted }, { text: T(r[1]), fontSize: 10.5 }]),
    },
    layout: { hLineWidth: (i, n) => (i === 0 || i === n.table.body.length ? 0.8 : 0.4), vLineWidth: () => 0, hLineColor: () => C.rule, paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 0 },
    margin: [0, 6, 0, 14],
  });

  function aboutNodes(course, st) {
    const out = [
      { text: 'About this course', style: 'h1' },
      { text: T(course.description), style: 'p', fontSize: 11.5, lineHeight: 1.45 },
      factsTable(course, st),
    ];
    if (course.objectives.length) {
      out.push({ text: 'What you will learn', style: 'h3', headlineLevel: 3 });
      out.push({ ul: course.objectives.map((o) => ({ text: T(o) })), style: 'list', markerColor: C.accent });
    }
    if (course.prerequisites.length) {
      out.push({ text: 'Before you start', style: 'h3', headlineLevel: 3 });
      out.push({ ul: course.prerequisites.map((o) => ({ text: T(o) })), style: 'list' });
    }
    out.push({ text: '', pageBreak: 'after' });
    return out;
  }

  const tocNode = (title) => ({ toc: { id: 'main', title: { text: title || 'Contents', style: 'h1' }, textMargin: [0, 1, 0, 1] } });

  function outlineNodes(course) {
    const out = [{ text: 'Course outline', style: 'h1' }];
    course.modules.forEach((m, mi) => {
      out.push({ text: 'Module ' + (mi + 1) + ': ' + T(m.title), style: 'h3', headlineLevel: 3 });
      out.push({ ul: m.lessons.map((l) => ({ text: T(l.title) })).concat(m.project ? [{ text: 'Project: ' + T(m.project.title), italics: true }] : []), style: 'list' });
    });
    return out;
  }

  /**
   * scope: 'full' | 'module' | 'overview' | 'references'
   * opts:  { moduleIndex }
   */
  function buildDoc(course, opts) {
    opts = opts || {};
    const scope = opts.scope || 'full';
    const st = S.schema.stats(course);
    const ctx = { fig: 0, raster: opts.raster || null };
    const content = [];
    let cover, headerTitle = course.title;

    if (scope === 'module') {
      const mi = opts.moduleIndex || 0;
      const m = course.modules[mi];
      cover = { kicker: course.title, title: m.title, subtitle: m.description, meta: ['Module ' + (mi + 1) + ' of ' + course.modules.length, m.lessons.length + ' lessons', 'Level: ' + course.level] };
      content.push(...coverNodes(cover), tocNode('Contents'), ...moduleNodes(course, mi, ctx), ...answerKeyNodes(course, [mi]));
      headerTitle = course.title + ' · Module ' + (mi + 1);
    } else if (scope === 'overview') {
      cover = { kicker: 'Course overview', title: course.title, subtitle: course.subtitle, meta: ['Level: ' + course.level, 'Duration: ' + course.estimatedTime, st.modules + ' modules, ' + st.lessons + ' lessons'] };
      content.push(...coverNodes(cover), ...aboutNodes(course, st), ...outlineNodes(course));
    } else if (scope === 'references') {
      cover = { kicker: course.title, title: 'References', subtitle: 'Sources and suggestions for further study', meta: [] };
      const refNodes = referencesNodes(course);
      content.push(...coverNodes(cover), ...(refNodes.length ? refNodes : [{ text: 'This course has no references.', style: 'p' }]));
    } else {
      cover = { kicker: course.level + ' course', title: course.title, subtitle: course.subtitle, meta: ['Level: ' + course.level, 'Duration: ' + course.estimatedTime, st.modules + ' modules, ' + st.lessons + ' lessons'] };
      content.push(...coverNodes(cover), ...aboutNodes(course, st), tocNode('Contents'));
      course.modules.forEach((_, mi) => content.push(...moduleNodes(course, mi, ctx)));
      content.push(...answerKeyNodes(course, course.modules.map((_, i) => i)), ...referencesNodes(course));
    }
    return {
      info: { title: T(scope === 'references' ? course.title + ' — References' : course.title), subject: T(course.description).slice(0, 200), author: 'Synapse', creator: 'Synapse' },
      pageSize: PAGE,
      pageMargins: MARGIN,
      defaultStyle: { font: 'Serif', fontSize: 10.5, color: C.ink, lineHeight: 1.3 },
      styles: STYLES,
      background: (page, size) => (page === 1 ? coverArt(size, course.title) : null),
      header: (page) => (page === 1 ? null : { text: T(headerTitle), alignment: page % 2 ? 'right' : 'left', font: 'Sans', fontSize: 7.5, color: C.faint, margin: [MARGIN[0], 30, MARGIN[2], 0] }),
      footer: (page) => (page === 1 ? null : { text: String(page), alignment: 'center', font: 'Sans', fontSize: 8.5, color: C.muted, margin: [0, 22, 0, 0] }),
      pageBreakBefore: (node, following) => !!node.headlineLevel && node.headlineLevel >= 3 && following.length === 0,
      content,
    };
  }

  async function generate(course, opts) {
    opts = opts || {};
    const status = opts.onStatus || (() => {});
    status('Loading the PDF engine…');
    await ensureLibs();
    status('Preparing fonts…');
    const { fonts, vfs } = await loadFonts();
    status('Typesetting pages…');
    await nextFrame();
    let doc;
    try {
      doc = buildDoc(course, opts);
    } catch (e) {
      throw new S.util.SynapseError('pdf', "Couldn't lay out this course as a PDF.", { hint: String(e && e.message || '').slice(0, 200), cause: e });
    }
    const render = (d) => renderBlob(window.pdfMake.createPdf(d, layouts, fonts, vfs));
    try {
      return await render(doc);
    } catch (e) {
      // Vector diagrams are the most exotic part of the document. If the engine chokes on them,
      // retry once with the same diagrams as flat images so the export still succeeds.
      if (!hasDiagrams(course) || opts.raster) throw e;
      status('Retrying with flat diagrams…');
      const raster = await rasterizeDiagrams(course);
      return render(buildDoc(course, Object.assign({}, opts, { raster })));
    }
  }

  function renderBlob(pdf) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new S.util.SynapseError('pdf', 'PDF generation took too long.', { hint: 'Very large courses can be exported one module at a time from the package option.' })), 240000);
      try {
        const done = (blob) => { clearTimeout(timer); resolve(blob); };
        const r = pdf.getBlob(done);
        if (r && typeof r.then === 'function') r.then(done, (e) => { clearTimeout(timer); reject(wrapErr(e)); });
      } catch (e) {
        clearTimeout(timer);
        reject(wrapErr(e));
      }
    });
  }

  const hasDiagrams = (course) => course.modules.some((m) => m.lessons.some((l) => l.images.some((i) => i.type === 'diagram')));

  async function rasterizeDiagrams(course) {
    const map = new Map();
    for (const m of course.modules) for (const l of m.lessons) for (const img of l.images) {
      if (img.type !== 'diagram') continue;
      const r = S.diagrams.render(img.diagram, { mode: 'print', fontFamily: 'Helvetica, Arial, sans-serif', label: img.description });
      if (!r || r.css) continue;
      try {
        const el = new Image();
        await new Promise((res, rej) => { el.onload = res; el.onerror = rej; el.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg); });
        const k = 3, canvas = document.createElement('canvas');
        canvas.width = r.width * k; canvas.height = r.height * k;
        const cx = canvas.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
        cx.drawImage(el, 0, 0, canvas.width, canvas.height);
        map.set(img, canvas.toDataURL('image/png'));
      } catch (e) { /* leave this one out of the map; it will fall back to vector */ }
    }
    return map;
  }

  const wrapErr = (e) => new S.util.SynapseError('pdf', "The PDF couldn't be created.", { hint: String((e && e.message) || e || '').slice(0, 200), cause: e });

  /** Warm the cache so exporting works offline later. Safe to call repeatedly. */
  function prefetch() {
    return ensureLibs().then(() => loadFonts()).catch(() => {});
  }

  S.pdf = { buildDoc, generate, prefetch, layouts, PAGE };
})();
