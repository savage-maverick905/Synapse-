/* Synapse · zip.js
   "Download course package": a folder you can extract into an offline learning library.

     Course Name/
       Course Name - Complete Course.pdf      (or, for very large courses:)
       00 - Course Overview.pdf
       01 - Module Name.pdf ...
       References.pdf
       images/  (every photo and diagram used, as JPG / SVG)

   No HTML is ever included. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { safeName, loadScript, nextFrame, SynapseError } = S.util;

  const JSZIP_URLS = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  ];

  const ensureZip = () => loadScript(JSZIP_URLS, () => typeof window.JSZip === 'function');

  /** Recommend one PDF per module once the book would pass ~220 pages. */
  const suggestMode = (course) => (S.schema.stats(course).pagesEstimate > 220 ? 'modules' : 'single');

  async function buildPackage(course, opts) {
    opts = opts || {};
    const status = opts.onStatus || (() => {});
    const mode = opts.mode === 'modules' ? 'modules' : 'single';
    status('Loading the ZIP library…');
    await ensureZip();

    const root = safeName(course.title, 'Course');
    const zip = new window.JSZip();
    const folder = zip.folder(root);

    status('Collecting images…');
    const files = S.images.collectForExport(course);
    if (files.length) {
      const imgs = folder.folder('images');
      files.forEach((f) => imgs.file(f.name, f.blob || f.text));
    }

    const pdfOpts = (extra) => Object.assign({ onStatus: () => {} }, extra);

    if (mode === 'single') {
      status('Creating the complete course PDF…');
      const blob = await S.pdf.generate(course, pdfOpts({ scope: 'full', onStatus: status }));
      folder.file(root + ' - Complete Course.pdf', blob);
    } else {
      status('Creating the course overview…');
      folder.file('00 - Course Overview.pdf', await S.pdf.generate(course, pdfOpts({ scope: 'overview', onStatus: status })));
      for (let i = 0; i < course.modules.length; i++) {
        status('Creating module ' + (i + 1) + ' of ' + course.modules.length + '…');
        await nextFrame();
        const blob = await S.pdf.generate(course, pdfOpts({ scope: 'module', moduleIndex: i, onStatus: () => {} }));
        folder.file(String(i + 1).padStart(2, '0') + ' - ' + safeName(course.modules[i].title, 'Module ' + (i + 1)) + '.pdf', blob);
      }
    }

    status('Creating the references PDF…');
    await nextFrame();
    folder.file('References.pdf', await S.pdf.generate(course, pdfOpts({ scope: 'references', onStatus: () => {} })));

    status('Compressing the package…');
    await nextFrame();
    try {
      return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    } catch (e) {
      throw new SynapseError('zip', "The ZIP file couldn't be created.", { hint: 'Your device may be low on memory. Try one PDF per module, or download only the PDF.', cause: e });
    }
  }

  S.zip = { buildPackage, suggestMode, ensureZip };
})();
