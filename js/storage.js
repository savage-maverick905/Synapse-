/* Synapse · storage.js
   All persistence is local to this browser.
   - localStorage:  small things (theme, preferences, settings, optional API key)
   - IndexedDB:     courses (can be large, include images) and reading progress
   Falls back to in-memory storage if the browser blocks IndexedDB (private mode). */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});

  const LS = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  const DEFAULT_PREFS = {
    level: 'Beginner', depth: 'Standard', style: 'Mixed', modules: 6,
    quizzes: true, projects: true, examples: true, images: true, references: true,
    readSize: 1,
  };
  const DEFAULT_SETTINGS = {
    provider: 'groq',          // the "writer" that drafts the course
    backups: [],                // provider ids to fall back to, in priority order, when the writer is busy or out of quota
    referenceProvider: '',      // provider id used to fetch verified web references (only providers with search support)
    models: {}, customBaseUrl: '', rememberKey: false,
    notify: false,               // ask permission and notify when a queued course finishes
  };

  /* ---------- preferences / settings / key ---------- */
  const prefs = {
    get() { return Object.assign({}, DEFAULT_PREFS, LS.get('synapse.prefs', {})); },
    set(patch) { const p = Object.assign(prefs.get(), patch); LS.set('synapse.prefs', p); return p; },
  };

  const settings = {
    get() { return Object.assign({}, DEFAULT_SETTINGS, LS.get('synapse.settings', {})); },
    set(patch) { const s = Object.assign(settings.get(), patch); LS.set('synapse.settings', s); return s; },
    /** The model chosen for one provider ('' = use that provider's default). */
    getModel(pid) {
      const s = settings.get();
      if (s.models && s.models[pid] !== undefined) return s.models[pid];
      return pid === 'gemini' ? s.model || '' : '';
    },
    setModel(pid, model) { settings.set({ models: Object.assign({}, settings.get().models, { [pid]: model }) }); },
    /** Toggle a provider in the backup-writer chain (used automatically when the main one is busy). */
    toggleBackup(pid, on) {
      const s = settings.get();
      const list = (s.backups || []).filter((x) => x !== pid);
      if (on) list.push(pid);
      settings.set({ backups: list });
    },
  };

  const theme = {
    get() { return LS.get('synapse.theme', 'system'); },
    set(v) { LS.set('synapse.theme', v); },
    resolved() {
      const t = theme.get();
      if (t === 'light' || t === 'dark') return t;
      return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    apply() {
      const r = theme.resolved();
      document.documentElement.setAttribute('data-theme', r);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', r === 'dark' ? '#1E1E1E' : '#F2F2F2');
    },
  };

  /** The key lives in sessionStorage unless the user opts to remember it on this device. */
  const apiKey = {
    get(providerId) {
      const k = 'synapse.key.' + providerId;
      try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch (e) { return ''; }
    },
    set(providerId, value, remember) {
      const k = 'synapse.key.' + providerId;
      try {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
        if (!value) return;
        (remember ? localStorage : sessionStorage).setItem(k, value);
      } catch (e) { /* storage blocked */ }
    },
    isRemembered(providerId) {
      try { return !!localStorage.getItem('synapse.key.' + providerId); } catch (e) { return false; }
    },
  };

  const profile = {
    get() { return Object.assign({ name: '' }, LS.get('synapse.profile', {})); },
    set(patch) { const p = Object.assign(profile.get(), patch); LS.set('synapse.profile', p); return p; },
  };

  /* ---------- IndexedDB ---------- */
  const DB_NAME = 'synapse';
  const DB_VERSION = 2;
  let dbPromise = null;
  const mem = { courses: new Map(), summaries: new Map(), progress: new Map(), queue: new Map() };
  let usingMemory = false;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!window.indexedDB) { usingMemory = true; return resolve(null); }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { usingMemory = true; return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        ['courses', 'summaries', 'progress', 'queue'].forEach((n) => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' }); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { usingMemory = true; resolve(null); };
      req.onblocked = () => { usingMemory = true; resolve(null); };
    });
    return dbPromise;
  }

  function tx(storeNames, mode, work) {
    return openDb().then((db) => {
      if (!db) return work(null);
      return new Promise((resolve, reject) => {
        let t;
        try { t = db.transaction(storeNames, mode); } catch (e) { return reject(e); }
        let result;
        Promise.resolve(work(t)).then((r) => { result = r; }, reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaction aborted'));
      });
    });
  }

  const reqP = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

  function summarize(rec) {
    const c = rec.course;
    const st = S.schema.stats(c);
    return {
      id: rec.id, title: c.title, subtitle: c.subtitle, level: c.level, topic: rec.topic || '',
      modules: st.modules, lessons: st.lessons, steps: st.lessons + st.projects, minutes: st.minutes,
      createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    };
  }

  const courses = {
    /** rec = { id, topic, course, createdAt?, updatedAt? } */
    async save(rec) {
      rec.createdAt = rec.createdAt || Date.now();
      rec.updatedAt = Date.now();
      const sum = summarize(rec);
      try {
        await tx(['courses', 'summaries'], 'readwrite', (t) => {
          if (!t) { mem.courses.set(rec.id, rec); mem.summaries.set(rec.id, sum); return; }
          t.objectStore('courses').put(rec);
          t.objectStore('summaries').put(sum);
        });
      } catch (e) {
        const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)));
        throw new S.util.SynapseError('storage', quota ? 'Your browser is out of storage space.' : "Couldn't save this course in your browser.", {
          hint: quota ? 'Delete a saved course you no longer need, then try again.' : 'Storage may be disabled (for example in a private window). You can still download the course as a PDF.',
          cause: e,
        });
      }
      return rec;
    },
    async get(id) {
      return tx(['courses'], 'readonly', (t) => (t ? reqP(t.objectStore('courses').get(id)) : mem.courses.get(id))).then((r) => r || null);
    },
    async list() {
      const list = await tx(['summaries'], 'readonly', (t) => (t ? reqP(t.objectStore('summaries').getAll()) : Array.from(mem.summaries.values())));
      return (list || []).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async remove(id) {
      await tx(['courses', 'summaries', 'progress'], 'readwrite', (t) => {
        if (!t) { mem.courses.delete(id); mem.summaries.delete(id); mem.progress.delete(id); return; }
        t.objectStore('courses').delete(id);
        t.objectStore('summaries').delete(id);
        t.objectStore('progress').delete(id);
      });
    },
    async clearAll() {
      await tx(['courses', 'summaries', 'progress'], 'readwrite', (t) => {
        if (!t) { mem.courses.clear(); mem.summaries.clear(); mem.progress.clear(); return; }
        ['courses', 'summaries', 'progress'].forEach((n) => t.objectStore(n).clear());
      });
    },
  };

  const progress = {
    blank(id) { return { id, current: null, scroll: 0, completed: {}, quiz: {}, updatedAt: Date.now() }; },
    async get(id) {
      const r = await tx(['progress'], 'readonly', (t) => (t ? reqP(t.objectStore('progress').get(id)) : mem.progress.get(id)));
      return Object.assign(progress.blank(id), r || {});
    },
    async save(p) {
      p.updatedAt = Date.now();
      try {
        await tx(['progress'], 'readwrite', (t) => { if (!t) mem.progress.set(p.id, p); else t.objectStore('progress').put(p); });
      } catch (e) { /* progress is best-effort */ }
    },
  };

  /** Pending / running / finished generation jobs. Each item's `job` field is the plain,
      JSON-safe object generator.js works with, so a job can be resumed after a reload. */
  const queue = {
    async save(item) {
      item.updatedAt = Date.now();
      try {
        await tx(['queue'], 'readwrite', (t) => { if (!t) mem.queue.set(item.id, item); else t.objectStore('queue').put(item); });
      } catch (e) { /* best-effort */ }
      return item;
    },
    async get(id) {
      return tx(['queue'], 'readonly', (t) => (t ? reqP(t.objectStore('queue').get(id)) : mem.queue.get(id))).then((r) => r || null);
    },
    async list() {
      const list = await tx(['queue'], 'readonly', (t) => (t ? reqP(t.objectStore('queue').getAll()) : Array.from(mem.queue.values())));
      return (list || []).sort((a, b) => a.createdAt - b.createdAt);
    },
    async remove(id) {
      await tx(['queue'], 'readwrite', (t) => { if (!t) mem.queue.delete(id); else t.objectStore('queue').delete(id); });
    },
  };

  /** Ask once, remember the answer, and only ever ask again if the person changes it in Settings. */
  const notify = {
    permission() { return ('Notification' in window) ? Notification.permission : 'unsupported'; },
    async request() {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'default') { try { return await Notification.requestPermission(); } catch (e) { return 'denied'; } }
      return Notification.permission;
    },
    fire(title, body, tag) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png' }));
        } else {
          new Notification(title, { body, tag, icon: 'assets/icons/icon-192.png' });
        }
      } catch (e) { /* notifications are best-effort */ }
    },
  };

  async function estimateUsage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }
    } catch (err) { /* ignore */ }
    return null;
  }

  S.store = {
    prefs, settings, theme, apiKey, courses, progress, queue, notify, profile, estimateUsage,
    isMemoryOnly: () => usingMemory,
    ready: () => openDb(),
    DEFAULT_PREFS,
  };
})();
