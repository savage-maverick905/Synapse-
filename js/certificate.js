/* Synapse · certificate.js
   A "Certificate of Completion" PDF, built entirely from a course already sitting in the
   learner's library. No AI call is involved — this is pure client-side document assembly,
   reusing pdf.js's font-loading and rendering pipeline. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { safeName } = S.util;

  const PAGE = { width: 792, height: 612 }; // 11 x 8.5 in, landscape
  const MARGIN = [56, 56, 56, 56];

  const C = {
    ink: '#1E1E1E', muted: '#5C5C5C', accent: '#B8460F', accentFill: '#ED6627',
    signal: '#006E9E', rule: '#DADADA', paper: '#FCFAF7',
  };

  const T = (s) => String(s == null ? '' : s).replace(/[\u200B-\u200F\u2060\uFE0E\uFE0F\uFEFF]/g, '').replace(/[\u{10000}-\u{10FFFF}]/gu, '');

  /** A short, human-friendly certificate code — deterministic from the course id and date, not a secret. */
  function certCode(courseId, when) {
    let h = 0;
    const s = String(courseId) + '|' + when;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return 'SYN-' + h.toString(36).toUpperCase().slice(0, 6).padStart(6, '0');
  }

  function border(w, h, inset, color) {
    return [
      { type: 'rect', x: inset, y: inset, w: w - inset * 2, h: h - inset * 2, r: 4, lineColor: color, lineWidth: 1.4 },
      { type: 'rect', x: inset + 6, y: inset + 6, w: w - inset * 2 - 12, h: h - inset * 2 - 12, r: 2, lineColor: color, lineWidth: 0.6 },
    ];
  }

  /** The small synapse mark: two nodes and a spark, echoing the app icon. */
  function mark(cx, cy, scale) {
    scale = scale || 1;
    return [
      { type: 'line', x1: cx - 34 * scale, y1: cy + 4 * scale, x2: cx - 14 * scale, y2: cy - 6 * scale, lineColor: '#B8B8B8', lineWidth: 1 },
      { type: 'line', x1: cx + 34 * scale, y1: cy - 8 * scale, x2: cx + 14 * scale, y2: cy - 3 * scale, lineColor: '#B8B8B8', lineWidth: 1 },
      { type: 'ellipse', x: cx - 20 * scale, y: cy, r1: 11 * scale, r2: 11 * scale, color: C.accentFill },
      { type: 'ellipse', x: cx - 20 * scale, y: cy, r1: 5 * scale, r2: 5 * scale, color: C.paper },
      { type: 'ellipse', x: cx + 20 * scale, y: cy - 6 * scale, r1: 7.5 * scale, r2: 7.5 * scale, color: C.signal },
      { type: 'ellipse', x: cx, y: cy - 2 * scale, r1: 2.2 * scale, r2: 2.2 * scale, color: C.ink },
    ];
  }

  function buildDoc(course, opts) {
    const name = T(opts.learnerName || 'A curious mind');
    const when = opts.completedAt || Date.now();
    const dateStr = new Date(when).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const st = S.schema.stats(course);
    const code = certCode(opts.courseId || course.title, dateStr);
    const W = PAGE.width, H = PAGE.height;

    return {
      info: { title: 'Certificate of Completion — ' + T(course.title), author: 'Synapse', creator: 'Synapse' },
      pageSize: PAGE,
      pageMargins: [0, 0, 0, 0],
      defaultStyle: { font: 'Serif', color: C.ink },
      background: () => ({
        canvas: [
          { type: 'rect', x: 0, y: 0, w: W, h: H, color: C.paper },
          ...border(W, H, 22, C.accentFill),
        ],
      }),
      content: [
        { text: 'SYNAPSE', font: 'Sans', bold: true, fontSize: 11, characterSpacing: 4, color: C.accent, alignment: 'center', margin: [0, 54, 0, 0] },
        { text: 'CERTIFICATE OF COMPLETION', font: 'Sans', bold: true, fontSize: 15, characterSpacing: 2, color: C.muted, alignment: 'center', margin: [0, 6, 0, 30] },
        { text: 'This certifies that', font: 'Serif', italics: true, fontSize: 13, color: C.muted, alignment: 'center' },
        { text: name, font: 'Sans', bold: true, fontSize: 32, color: C.ink, alignment: 'center', margin: [40, 10, 40, 10] },
        { canvas: [{ type: 'line', x1: W / 2 - 110, y1: 0, x2: W / 2 + 110, y2: 0, lineWidth: 1, lineColor: C.rule }], margin: [0, 0, 0, 16] },
        { text: 'has successfully completed the course', font: 'Serif', italics: true, fontSize: 13, color: C.muted, alignment: 'center' },
        { text: T(course.title), font: 'Sans', bold: true, fontSize: 22, color: C.accent, alignment: 'center', margin: [50, 8, 50, 4] },
        course.subtitle ? { text: T(course.subtitle), font: 'Serif', italics: true, fontSize: 12, color: C.muted, alignment: 'center', margin: [60, 0, 60, 0] } : null,
        {
          columns: [
            { width: '*', text: '' },
            { width: 'auto', text: st.modules + ' modules  ·  ' + st.lessons + ' lessons  ·  Level: ' + T(course.level), font: 'Sans', fontSize: 9.5, color: C.muted },
            { width: '*', text: '' },
          ],
          margin: [0, 14, 0, 0],
        },
        {
          absolutePosition: { x: 0, y: H - 118 },
          columns: [
            { width: 90, text: '' },
            {
              width: 200,
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 1, lineColor: C.rule }], margin: [0, 0, 0, 6] },
                { text: dateStr, font: 'Sans', fontSize: 10, bold: true },
                { text: 'Date completed', font: 'Sans', fontSize: 8, color: C.muted },
              ],
            },
            { width: '*', stack: [{ canvas: mark(106, 6, 1) }], margin: [0, -6, 0, 0] },
            {
              width: 200,
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 190, y2: 0, lineWidth: 1, lineColor: C.rule }], margin: [0, 0, 0, 6] },
                { text: 'Synapse', font: 'Serif', italics: true, fontSize: 13 },
                { text: 'Turn curiosity into a course', font: 'Sans', fontSize: 8, color: C.muted },
              ],
            },
            { width: 90, text: '' },
          ],
        },
        { text: 'Certificate ' + code, font: 'Sans', fontSize: 8, color: C.muted, alignment: 'center', absolutePosition: { x: 0, y: H - 34 }, characterSpacing: 0.4 },
      ].filter(Boolean),
    };
  }

  async function generate(course, opts) {
    opts = opts || {};
    const doc = buildDoc(course, opts);
    return S.pdf.renderCustomDoc(doc, opts);
  }

  async function download(course, opts) {
    const blob = await generate(course, opts);
    S.util.downloadBlob(blob, safeName(course.title, 'Course') + ' - Certificate.pdf');
    return blob;
  }

  S.certificate = { buildDoc, generate, download, certCode };
})();
