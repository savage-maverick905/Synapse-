/* Synapse · util.js
   Small helpers shared by every module. No dependencies. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});

  /** A human-readable error with a machine code. `hint` says what to do next. */
  class SynapseError extends Error {
    constructor(code, message, opts) {
      super(message);
      opts = opts || {};
      this.name = 'SynapseError';
      this.code = code;
      this.hint = opts.hint || '';
      this.retryable = !!opts.retryable;
      this.status = opts.status || 0;
      this.cause = opts.cause;
    }
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  const uid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const countWords = (s) => {
    const m = String(s || '').trim().match(/\S+/g);
    return m ? m.length : 0;
  };

  const readingMinutes = (words) => Math.max(1, Math.round(words / 210));

  /** Filename-safe version of a title. */
  const safeName = (s, fallback) => {
    const t = String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
      .replace(/[. ]+$/, '');
    return t || fallback || 'Course';
  };

  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const t = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(t);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });

  const abortError = () => new SynapseError('aborted', 'Cancelled.');

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /** Load a classic script, trying each URL in turn until `test()` passes. */
  const scriptPromises = {};
  function loadScript(urls, test) {
    const key = urls.join('|');
    if (test && test()) return Promise.resolve();
    if (scriptPromises[key]) return scriptPromises[key];
    scriptPromises[key] = (async () => {
      let lastErr;
      for (const url of urls) {
        try {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => {
              s.remove();
              reject(new Error('Failed to load ' + url));
            };
            document.head.appendChild(s);
          });
          if (!test || test()) return;
        } catch (e) {
          lastErr = e;
        }
      }
      delete scriptPromises[key];
      throw new SynapseError('library', "Couldn't load a required library.", {
        hint: navigator.onLine
          ? 'The library host may be unreachable. Try again in a moment.'
          : "You're offline. Open the feature once while online so it can be saved for offline use.",
        cause: lastErr,
      });
    })();
    return scriptPromises[key];
  }

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  const blobToBase64 = async (blob) => (await blobToDataUrl(blob)).split(',')[1] || '';

  const dataUrlToBlob = (dataUrl) => {
    const [head, b64] = String(dataUrl).split(',');
    const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const fmtDate = (ts) => {
    try {
      return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  };

  const fmtDuration = (minutes) => {
    minutes = Math.max(1, Math.round(minutes));
    if (minutes < 60) return minutes + ' min';
    const h = minutes / 60;
    if (h < 10) return (Math.round(h * 2) / 2).toString().replace(/\.0$/, '') + ' h';
    return Math.round(h) + ' h';
  };

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  };

  const isHttpUrl = (u) => {
    try {
      const p = new URL(u);
      return p.protocol === 'http:' || p.protocol === 'https:';
    } catch (e) {
      return false;
    }
  };

  S.util = {
    SynapseError, esc, uid, clamp, countWords, readingMinutes, safeName, sleep, abortError,
    nextFrame, debounce, loadScript, blobToDataUrl, blobToBase64, dataUrlToBlob,
    downloadBlob, fmtDate, fmtDuration, hostOf, isHttpUrl,
  };
})();
