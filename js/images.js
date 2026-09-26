/* Synapse · images.js
   Course images come from two honest sources:
     1. generated diagrams (drawn locally by diagrams.js), and
     2. real photographs found on Wikimedia Commons, stored with their licence and
        attribution. The AI only supplies a short search phrase — it never supplies URLs.
   If nothing reliable is found the image is silently omitted. Photos are shrunk to a
   JPEG before being stored or exported so packages stay small. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { isHttpUrl, blobToDataUrl } = S.util;

  const MAX_W = 900;

  async function optimize(blob, maxW, quality) {
    maxW = maxW || MAX_W;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const out = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality || 0.78));
    return { blob: out, dataUrl: await blobToDataUrl(out), width: w, height: h };
  }

  const stripHtml = (html) => {
    const d = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);

  const FREE_LICENSE = /^(cc[ -]?(by|0)|public domain|pd|attribution)/i;

  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 12000);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: (opts && opts.signal) || ctrl.signal }));
    } finally {
      clearTimeout(t);
    }
  }

  async function searchCommons(query, signal) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*',
      generator: 'search', gsrsearch: query + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '8',
      prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', iiurlwidth: String(MAX_W),
      iiextmetadatafilter: 'LicenseShortName|Artist|Credit|ImageDescription|Restrictions|ObjectName',
    });
    const res = await fetchWithTimeout('https://commons.wikimedia.org/w/api.php?' + params, { signal }, 12000);
    if (!res.ok) return [];
    const json = await res.json();
    const pages = (json.query && json.query.pages) || {};
    return Object.values(pages).sort((a, b) => (a.index || 0) - (b.index || 0));
  }

  /** Try to attach a real, attributed photo. Returns true on success. */
  async function resolvePhoto(img, signal) {
    if (img.dataUrl) return true;
    try {
      if (img.url && isHttpUrl(img.url)) {
        if (!img.attribution && !img.sourceUrl) return false; // never show an unattributed external image
        const res = await fetchWithTimeout(img.url, { signal }, 12000);
        if (!res.ok) return false;
        const o = await optimize(await res.blob());
        img.dataUrl = o.dataUrl;
        return true;
      }
      if (!img.searchQuery) return false;
      const pages = await searchCommons(img.searchQuery, signal);
      const want = tokens(img.searchQuery);
      for (const p of pages) {
        const info = p.imageinfo && p.imageinfo[0];
        if (!info || !/^image\/(jpeg|png)$/.test(info.mime) || info.width < 400) continue;
        const meta = info.extmetadata || {};
        const lic = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
        if (!lic || !FREE_LICENSE.test(lic) || /-(nc|nd)\b|\bnc\b|\bnd\b/i.test(lic)) continue;
        if (meta.Restrictions && stripHtml(meta.Restrictions.value)) continue;
        const hay = tokens(p.title + ' ' + stripHtml(meta.ImageDescription && meta.ImageDescription.value) + ' ' + stripHtml(meta.ObjectName && meta.ObjectName.value));
        if (want.length && !want.some((t) => hay.includes(t))) continue;
        const thumb = info.thumburl || info.url;
        const res = await fetchWithTimeout(thumb, { signal }, 15000);
        if (!res.ok) continue;
        const o = await optimize(await res.blob());
        const artist = stripHtml(meta.Artist && meta.Artist.value) || stripHtml(meta.Credit && meta.Credit.value) || 'Unknown author';
        const name = p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
        img.dataUrl = o.dataUrl;
        img.license = lic;
        img.attribution = '"' + name + '" by ' + artist.slice(0, 120) + ', ' + lic + ', via Wikimedia Commons';
        img.sourceUrl = info.descriptionurl || '';
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError' && signal && signal.aborted) throw S.util.abortError();
    }
    return false;
  }

  /** Resolve every photo request in a course; drop the ones that cannot be verified. */
  async function resolveCourse(course, { signal, onProgress, limit } = {}) {
    const todo = [];
    course.modules.forEach((m) => m.lessons.forEach((l) => l.images.forEach((img) => { if (img.type === 'photo' && !img.dataUrl) todo.push({ l, img }); })));
    const cap = limit || 20;
    let done = 0, found = 0;
    for (const t of todo.slice(0, cap)) {
      if (onProgress) onProgress(done, Math.min(todo.length, cap));
      const ok = await resolvePhoto(t.img, signal);
      if (ok) found++;
      done++;
    }
    // Remove anything unresolved so no broken image ever renders.
    course.modules.forEach((m) => m.lessons.forEach((l) => { l.images = l.images.filter(isRenderable); }));
    if (onProgress) onProgress(done, Math.min(todo.length, cap));
    return { requested: todo.length, found };
  }

  const isRenderable = (img) => img && ((img.type === 'diagram' && img.diagram) || (img.type === 'photo' && !!img.dataUrl));

  /** Files for the ZIP `images/` folder. */
  function collectForExport(course) {
    const files = [];
    let n = 0;
    course.modules.forEach((m, mi) => m.lessons.forEach((l, li) => l.images.forEach((img) => {
      if (!isRenderable(img)) return;
      n++;
      const base = 'fig-' + String(n).padStart(2, '0') + ' (' + (mi + 1) + '.' + (li + 1) + ')';
      if (img.type === 'photo') {
        files.push({ name: base + '.jpg', blob: S.util.dataUrlToBlob(img.dataUrl), caption: img.caption });
      } else {
        const r = S.diagrams.render(img.diagram, { mode: 'print', fontFamily: 'Helvetica, Arial, sans-serif', label: img.description });
        if (r && r.svg) files.push({ name: base + '.svg', text: '<?xml version="1.0" encoding="UTF-8"?>\n' + r.svg, caption: img.caption });
      }
    })));
    return files;
  }

  S.images = { optimize, resolvePhoto, resolveCourse, collectForExport, isRenderable };
})();
