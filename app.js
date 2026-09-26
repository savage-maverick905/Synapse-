/* Synapse · app.js
   The interface: hash router, home / generation / overview / reader / library / settings,
   export actions and PWA registration. All heavy lifting lives in js/*.js. */
(function () {
  'use strict';
  const S = window.Synapse;
  const { esc, SynapseError, safeName, downloadBlob, fmtDate, fmtDuration } = S.util;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const main = $('#main');
  const topbar = $('#topbar');

  const state = { record: null, unsaved: new Map(), progress: null, token: 0, freshNav: false, pwa: { status: 'checking', deferred: null } };

  /* ============================== helpers ============================== */
  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    pkg: '<path d="M3 8l9-5 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8"/>',
    text: '<path d="M3 19L8 6l5 13M5 14h6M15.5 19l3-7 3 7M16.5 17h4"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    gear: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9z"/>',
    stack: '<path d="M12 4l9 4.5-9 4.5-9-4.5L12 4z"/><path d="M3 13l9 4.5 9-4.5"/>',
    queue: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M7 5l12 7-12 7V5z"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    bell: '<path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    key: '<circle cx="8" cy="12" r="3.5"/><path d="M11 12h10M17 12v4M20 12v3"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    backup: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>',
  };
  const icon = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
  const LOGO =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1E1E1E"/>' +
    '<g stroke="#5A5A5A" stroke-width="1.6" stroke-linecap="round"><path d="M19 37 8 27M19 37 6 44M19 37 14 54M46 28 57 19M46 28 58 33M46 28 51 11"/></g>' +
    '<circle cx="19" cy="37" r="11" fill="#ED6627"/><circle cx="19" cy="37" r="5.4" fill="#1E1E1E"/>' +
    '<circle cx="46" cy="28" r="7.5" fill="#00ADEF"/><circle cx="32.5" cy="32.5" r="2.4" fill="#fff"/></svg>';

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3600);
  }

  const explain = (e) =>
    e instanceof SynapseError ? { title: e.message, hint: e.hint, code: e.code } : { title: 'Something went wrong.', hint: String((e && e.message) || '').slice(0, 200), code: 'unknown' };

  function openDialog(html) {
    const d = $('#dialog');
    d.innerHTML = html;
    if (!d.open) d.showModal();
    return d;
  }
  const closeDialog = () => { const d = $('#dialog'); if (d.open) d.close(); };

  function confirmDialog({ title, body, confirm, danger }) {
    return new Promise((resolve) => {
      const d = openDialog(
        '<h2>' + esc(title) + '</h2><p>' + esc(body) + '</p><div class="btn-row"><button class="btn btn-quiet" data-no>Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-yes>' + esc(confirm) + '</button></div>'
      );
      let result = false;
      d.querySelector('[data-yes]').onclick = () => { result = true; d.close(); };
      d.querySelector('[data-no]').onclick = () => d.close();
      d.onclose = () => resolve(result);
    });
  }

  const readingPct = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  };

  const gotoHash = (h) => { if (location.hash === h) route(); else location.hash = h; };

  /* ============================== theme / top bar ============================== */
  function themeButtonHtml() {
    const dark = S.store.theme.resolved() === 'dark';
    return '<button class="icon-btn" data-theme-toggle aria-label="' + (dark ? 'Switch to light mode' : 'Switch to dark mode') + '">' + icon(dark ? 'sun' : 'moon') + '</button>';
  }
  function toggleTheme() {
    S.store.theme.set(S.store.theme.resolved() === 'dark' ? 'light' : 'dark');
    S.store.theme.apply();
    $$('[data-theme-toggle]').forEach((b) => { b.outerHTML = themeButtonHtml(); });
  }

  function renderTopbar(active) {
    topbar.innerHTML =
      '<a class="brand" href="#/" aria-label="Synapse home">' + LOGO + '<span>SYNAPSE</span></a><span class="spacer"></span>' +
      '<nav aria-label="Main" class="topnav-links">' +
      '<a class="nav-link" href="#/library"' + (active === 'library' ? ' aria-current="page"' : '') + '>Saved courses</a>' +
      '<a class="nav-link" href="#/queue"' + (active === 'queue' ? ' aria-current="page"' : '') + '>Pending' + queueBadgeHtml() + '</a>' +
      '<a class="nav-link" href="#/settings"' + (active === 'settings' ? ' aria-current="page"' : '') + '>Settings</a>' +
      '</nav>' + themeButtonHtml();
  }

  const TABS = [
    ['', 'home', 'Home'],
    ['library', 'stack', 'Saved'],
    ['queue', 'queue', 'Pending'],
    ['settings', 'gear', 'Settings'],
  ];
  function renderBottomNav(active) {
    const nav = $('#bottomnav');
    if (!nav) return;
    nav.innerHTML = TABS.map(([id, ic, label]) =>
      '<a class="tab-link" href="#/' + id + '"' + (active === id ? ' aria-current="page"' : '') + '>' + icon(ic) + (id === 'queue' ? queueBadgeHtml() : '') + '<span>' + label + '</span></a>'
    ).join('');
  }

  let queueCount = 0;
  function queueBadgeHtml() { return queueCount ? '<span class="badge-dot" aria-hidden="true">' + (queueCount > 9 ? '9+' : queueCount) + '</span>' : ''; }
  async function refreshQueueBadge() {
    const list = await S.store.queue.list();
    queueCount = list.filter((i) => i.status !== 'done').length;
    if ($('#bottomnav')) renderBottomNav(currentActiveNav());
    const link = $('.topnav-links a[href="#/queue"]');
    if (link) link.innerHTML = 'Pending' + queueBadgeHtml();
  }
  let lastNav = '';
  function currentActiveNav() { return lastNav; }

  /* ============================== router ============================== */
  async function route() {
    const token = ++state.token;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const [a, id, b, c] = parts;
    document.body.classList.remove('reading');
    document.documentElement.style.removeProperty('--rs');
    window.onscroll = null;
    closeDialog();
    try {
      if (!a) await viewHome(token);
      else if (a === 'library') await viewLibrary(token);
      else if (a === 'settings') await viewSettings(token);
      else if (a === 'queue' && id) await viewQueueItem(token, id);
      else if (a === 'queue') await viewQueueList(token);
      else if (a === 'course' && id && b === 'read') await viewReader(token, id, c);
      else if (a === 'course' && id) await viewOverview(token, id);
      else await viewHome(token);
    } catch (e) {
      if (token !== state.token) return;
      const x = explain(e);
      renderTopbar('');
      main.innerHTML = '<div class="page"><h1 class="title">That did not load</h1><p class="lede">' + esc(x.title) + ' ' + esc(x.hint) + '</p><p style="margin-top:18px"><a class="btn btn-primary" href="#/">Back to home</a></p></div>';
    }
    if (token === state.token) main.focus({ preventScroll: true });
  }

  function show(token, html, opts) {
    if (token !== state.token) return false;
    opts = opts || {};
    document.body.classList.toggle('reading', !!opts.reading);
    lastNav = opts.nav || '';
    if (opts.reading) topbar.innerHTML = '';
    else renderTopbar(lastNav);
    renderBottomNav(opts.reading ? '\u0000' : lastNav);
    main.innerHTML = html;
    if (!opts.keepScroll) window.scrollTo(0, 0);
    if (opts.title) document.title = opts.title + ' · Synapse';
    return true;
  }

  async function getRecord(id) {
    if (state.record && state.record.id === id) return state.record;
    if (state.unsaved.has(id)) return (state.record = state.unsaved.get(id));
    const rec = await S.store.courses.get(id);
    if (!rec) throw new SynapseError('missing', "That course isn't saved in this browser.", { hint: 'It may have been deleted, or it was made on another device.' });
    rec.course = S.schema.normalizeCourse(rec.course);
    state.record = rec;
    return rec;
  }

  /* ============================== home ============================== */
  const MOTIF = '<svg class="motif" id="motif" viewBox="0 0 340 54" aria-hidden="true"><path class="dend" d="M20 27 L4 12 M20 27 L2 34 M20 27 L10 50"/><path class="dend" d="M300 24 L322 8 M300 24 L336 28 M300 24 L318 48"/><circle class="cell-a" cx="26" cy="27" r="16"/><circle cx="26" cy="27" r="7" fill="var(--paper)"/><line class="gap-line" x1="46" y1="27" x2="288" y2="27"/><circle class="cell-b" cx="304" cy="26" r="11"/><circle class="spark" cx="52" cy="27" r="4.5"/></svg>';

  const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
  const STYLES = [['Mixed', 'Mixed'], ['Visual', 'Visual, diagram-led'], ['Reading', 'Reading-focused'], ['Hands-on', 'Hands-on, learn by doing']];
  const DEPTHS = ['Quick', 'Standard', 'Deep'];
  const LENGTHS = [4, 6, 8, 12];
  const TOGGLES = [['quizzes', 'Include quizzes'], ['projects', 'Include practical projects'], ['examples', 'Include examples'], ['images', 'Include images and diagrams'], ['references', 'Include web references']];

  function homeHtml(p) {
    const seg = (name, opts, cur, fmt) =>
      '<div class="seg" role="radiogroup">' + opts.map((o) => '<label><input type="radio" name="' + name + '" value="' + esc(o) + '"' + (String(o) === String(cur) ? ' checked' : '') + '><span>' + esc(fmt ? fmt(o) : o) + '</span></label>').join('') + '</div>';
    return (
      '<div class="page">' +
      '<section class="hero"><span class="beta">Beta</span><h1 class="wordmark">SYNAPSE</h1><p class="tagline">Turn curiosity into a course.</p>' + MOTIF +
      '<p class="lede">Tell Synapse what you want to learn.<br>We’ll turn it into a structured course you can actually study.</p></section>' +
      '<form id="gen-form" novalidate>' +
      '<div class="ask-wrap"><label class="ask-label" for="topic">What do you want to learn?</label>' +
      '<textarea id="topic" class="ask" rows="3" maxlength="2000" placeholder="Teach me robotics from the fundamentals to building my first Arduino-based robot."></textarea>' +
      '<div id="form-error" class="form-error" role="alert"></div></div>' +
      '<div class="spec">' +
      '<div class="row"><label class="k" for="level">Level</label><div class="select"><select id="level" name="level">' + LEVELS.map((l) => '<option' + (l === p.level ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div></div>' +
      '<div class="row"><span class="k">Depth</span>' + seg('depth', DEPTHS, p.depth) + '</div>' +
      '<div class="row"><label class="k" for="style">Learning style</label><div class="select"><select id="style" name="style">' + STYLES.map((s) => '<option value="' + s[0] + '"' + (s[0] === p.style ? ' selected' : '') + '>' + esc(s[1]) + '</option>').join('') + '</select></div></div>' +
      '<div class="row"><span class="k">Course length, in modules</span>' + seg('modules', LENGTHS, p.modules) + '</div>' +
      '</div>' +
      '<p class="toggles-head">Include</p>' +
      '<div class="spec"><div class="row switches">' + TOGGLES.map((t) => '<label class="switch"><span>' + t[1] + '</span><input type="checkbox" name="' + t[0] + '"' + (p[t[0]] ? ' checked' : '') + '><span class="track"></span></label>').join('') + '</div></div>' +
      '<div class="actionbar"><div class="btn-row">' +
      '<button class="btn btn-primary" id="btn-now" type="submit">Generate now</button>' +
      '<button class="btn btn-quiet" id="btn-queue" type="button">' + icon('plus') + 'Add to queue</button>' +
      '</div></div>' +
      '</form>' +
      '<div class="subtle-row"><a href="#/settings">AI: ' + esc(currentProvider().name) + ' · key and settings</a><button class="link-btn" id="sample" type="button">Explore a sample course</button></div>' +
      '<section id="pending"></section>' +
      '<section id="recent"></section></div>'
    );
  }

  async function viewHome(token) {
    const p = S.store.prefs.get();
    if (!show(token, homeHtml(p), { nav: '', title: 'Turn curiosity into a course' })) return;
    document.title = 'Synapse · Turn curiosity into a course';
    const form = $('#gen-form');
    const ta = $('#topic');
    const motif = $('#motif');
    ta.value = state.draft || sessionStorage.getItem('synapse.draft') || '';
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 130) + 'px'; };
    fit();
    ta.addEventListener('input', () => {
      fit();
      state.draft = ta.value;
      try { sessionStorage.setItem('synapse.draft', ta.value); } catch (e) { /* ignore */ }
      motif.classList.remove('fire'); void motif.getBoundingClientRect(); motif.classList.add('fire');
    });
    form.addEventListener('change', () => S.store.prefs.set(readForm(form).prefs));
    form.addEventListener('submit', (e) => { e.preventDefault(); submitCourse(form, 'now'); });
    $('#btn-queue').addEventListener('click', () => submitCourse(form, 'queue'));
    $('#sample').addEventListener('click', openSample);
    loadPending(token, '#pending', true);
    loadRecent(token);
  }

  function readForm(form) {
    const val = (n) => { const el = form.elements[n]; return el ? el.value : ''; };
    const checked = (n) => (form.elements[n] ? form.elements[n].checked : false);
    const prefs = { level: val('level'), depth: val('depth'), style: val('style'), modules: +val('modules') || 6 };
    ['quizzes', 'projects', 'examples', 'images', 'references'].forEach((k) => { prefs[k] = checked(k); });
    return { topic: ($('#topic').value || '').trim(), prefs };
  }

  function formError(msg, actions) {
    const el = $('#form-error');
    el.innerHTML = esc(msg) + (actions || '');
    el.classList.add('show');
  }

  function validateForm(form) {
    const { topic, prefs } = readForm(form);
    $('#form-error').classList.remove('show');
    if (!topic) {
      formError('Tell Synapse what you want to learn. Even one sentence is enough.');
      $('#topic').focus();
      return null;
    }
    if (!buildChain().length) {
      formError('Add at least one AI API key to generate courses. It stays in this browser.', '<div style="margin-top:8px"><a class="btn btn-quiet" href="#/settings">Add API key</a></div>');
      return null;
    }
    S.store.prefs.set(prefs);
    return Object.assign({ topic }, prefs);
  }

  async function submitCourse(form, mode) {
    const input = validateForm(form);
    if (!input) return;
    if (mode === 'now' && !navigator.onLine) {
      formError("You're offline, so Synapse can't reach an AI right now. Add it to the queue instead — it'll be ready to start as soon as you're back online.");
      return;
    }
    const item = await runner.enqueue(input);
    sessionStorage.removeItem('synapse.draft');
    state.draft = '';
    if (mode === 'now') {
      runner.start(item.id);
      location.hash = '#/queue/' + item.id;
    } else {
      if (S.store.settings.get().notify === undefined) { /* no-op, default already false */ }
      toast('Added to Pending courses. Start it anytime, or from another tab.');
      location.hash = '#/';
    }
  }

  async function loadRecent(token) {
    const list = await S.store.courses.list();
    if (token !== state.token || !$('#recent')) return;
    if (!list.length) return;
    const items = await Promise.all(list.slice(0, 3).map(async (c) => ({ c, p: await S.store.progress.get(c.id) })));
    if (token !== state.token || !$('#recent')) return;
    $('#recent').innerHTML =
      '<div class="section-head"><h2>Continue learning</h2><a href="#/library">All saved courses</a></div>' + courseRows(items);
  }

  async function loadPending(token, sel, linkToAll) {
    const list = await S.store.queue.list();
    const el = $(sel);
    if (token !== state.token || !el) return;
    if (!list.length) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div class="section-head"><h2>Pending courses</h2>' + (linkToAll ? '<a href="#/queue">View all</a>' : '') + '</div>' + queueRows(list);
    wireQueueRows(el);
  }

  function pctDone(c, p) {
    const done = Object.keys(p.completed || {}).filter((k) => k !== 'references').length;
    return c.steps ? Math.min(1, done / c.steps) : 0;
  }

  function courseRows(items, withDelete) {
    return (
      '<ul class="course-rows">' +
      items.map(({ c, p }) => {
        const pct = Math.round(pctDone(c, p) * 100);
        return (
          '<li class="course-row"><a class="name" href="#/course/' + esc(c.id) + '">' + esc(c.title) + '</a>' +
          (withDelete ? '<button class="icon-btn" data-del="' + esc(c.id) + '" aria-label="Delete ' + esc(c.title) + '">' + icon('trash') + '</button>' : '<span></span>') +
          '<div class="sub"><span>' + esc(c.level) + '</span><span>' + c.modules + ' modules, ' + c.lessons + ' lessons</span><span>' + (pct ? pct + '% done' : 'Not started') + '</span>' + (withDelete ? '<span>Saved ' + fmtDate(c.updatedAt) + '</span>' : '') + '</div>' +
          (pct ? '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><span style="width:' + pct + '%"></span></div>' : '') +
          '</li>'
        );
      }).join('') + '</ul>'
    );
  }

  /* ---------- queue (pending / background generation) ---------- */
  function jobSummary(job) {
    const total = job.writing.total || 0;
    const activeStep = job.steps.find((s) => s.status === 'active');
    let label = 'Queued';
    if (job.status === 'running' && activeStep) {
      if (activeStep.id === 'outline') label = 'Planning the curriculum…';
      else if (activeStep.id === 'refs') label = 'Searching the web for sources…';
      else if (activeStep.id === 'lessons') label = 'Writing module ' + Math.min(job.writing.done + 1, total) + ' of ' + total;
      else if (activeStep.id === 'images') label = 'Finding images…';
      else label = 'Almost there…';
    } else if (job.status === 'error') label = 'Needs attention';
    else if (job.status === 'aborted') label = 'Paused';
    const pct = total ? Math.round((job.writing.done / total) * 100) : 0;
    return { label, pct, total, done: job.writing.done };
  }

  function queueRows(list) {
    return '<ul class="course-rows">' + list.map((item) => {
      const s = jobSummary(item.job);
      const busy = item.status === 'running';
      const errored = item.status === 'error';
      return (
        '<li class="course-row queue-row"><a class="name" href="#/queue/' + esc(item.id) + '">' + esc(item.job.outline ? item.job.outline.title : item.topic) + '</a>' +
        '<div class="row-actions">' +
        (busy ? '<button class="icon-btn" data-q-cancel="' + esc(item.id) + '" aria-label="Cancel">' + icon('pause') + '</button>'
          : '<button class="icon-btn" data-q-start="' + esc(item.id) + '" aria-label="Start">' + icon('play') + '</button>') +
        '<button class="icon-btn" data-q-remove="' + esc(item.id) + '" aria-label="Remove">' + icon('trash') + '</button>' +
        '</div>' +
        '<div class="sub"><span class="qstatus ' + (errored ? 'bad' : busy ? 'live' : '') + '">' + esc(s.label) + '</span>' + (s.total ? '<span>' + s.done + ' of ' + s.total + ' modules</span>' : '') + '</div>' +
        (s.total ? '<div class="bar" role="progressbar" aria-valuenow="' + s.pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><span style="width:' + s.pct + '%"></span></div>' : '') +
        '</li>'
      );
    }).join('') + '</ul>';
  }

  function wireQueueRows(root) {
    $$('[data-q-start]', root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); runner.start(b.dataset.qStart); }));
    $$('[data-q-cancel]', root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); runner.cancel(b.dataset.qCancel); }));
    $$('[data-q-remove]', root).forEach((b) => (b.onclick = async (e) => {
      e.preventDefault();
      const ok = await confirmDialog({ title: 'Remove this pending course?', body: 'Any progress writing it will be lost.', confirm: 'Remove', danger: true });
      if (ok) { await runner.remove(b.dataset.qRemove); route(); }
    }));
  }

  function buildChain() {
    const s = S.store.settings.get();
    const ids = [s.provider].concat(s.backups || []).filter((v, i, a) => v && a.indexOf(v) === i);
    return ids
      .map((id) => {
        const provider = S.providers.get(id);
        const apiKey = provider && S.store.apiKey.get(id);
        return apiKey ? { provider, apiKey, model: S.store.settings.getModel(id) || provider.defaultModel } : null;
      })
      .filter(Boolean);
  }

  function buildSearchCtx(chain) {
    const s = S.store.settings.get();
    const tryId = (id) => {
      const provider = id && S.providers.get(id);
      if (!provider || !provider.supportsSearch) return null;
      const apiKey = S.store.apiKey.get(id);
      return apiKey ? { provider, apiKey, model: S.store.settings.getModel(id) || provider.defaultModel } : null;
    };
    return tryId(s.referenceProvider) || chain.find((e) => e.provider.supportsSearch) || null;
  }

  const runner = {
    activeId: null, abortCtl: null, listener: null,
    watch(id, fn) { runner.listener = { id, fn }; },
    unwatch(id) { if (runner.listener && runner.listener.id === id) runner.listener = null; },
    emit(item) { if (runner.listener && runner.listener.id === item.id) runner.listener.fn(item); refreshQueueBadge(); },

    async enqueue(input) {
      const job = S.generator.createJob(input);
      const item = { id: job.id, topic: input.topic, status: 'queued', createdAt: Date.now(), job };
      await S.store.queue.save(item);
      refreshQueueBadge();
      return item;
    },

    async start(id) {
      if (runner.activeId) {
        toast(runner.activeId === id ? 'This course is already generating.' : 'Another course is generating right now. Wait for it to finish, or cancel it first.', 'bad');
        return;
      }
      const item = await S.store.queue.get(id);
      if (!item) return;
      const chain = buildChain();
      if (!chain.length) { toast('Add an API key in Settings first.', 'bad'); location.hash = '#/settings'; return; }
      const searchCtx = buildSearchCtx(chain);
      runner.activeId = id;
      item.status = 'running';
      item.error = null;
      item.startedAt = item.startedAt || Date.now();
      await S.store.queue.save(item);
      runner.emit(item);
      const abort = new AbortController();
      runner.abortCtl = abort;
      const ctx = {
        chain, chainIndex: item.job.chainIndex || 0, searchCtx, signal: abort.signal,
        onUpdate: (job) => { item.job = job; S.store.queue.save(item); runner.emit(item); },
      };
      try {
        const course = await S.generator.run(item.job, ctx);
        course.meta.warnings = (item.job.warnings || []).slice();
        const rec = { id: item.id, topic: item.topic, course };
        try {
          await S.store.courses.save(rec);
        } catch (e) {
          state.unsaved.set(item.id, rec);
          toast(explain(e).title + ' You can still read and download it now.', 'bad');
        }
        await S.store.queue.remove(item.id);
        state.record = rec;
        runner.activeId = null;
        runner.abortCtl = null;
        runner.emit(Object.assign({}, item, { status: 'done' }));
        if (!document.hidden) toast('“' + course.title + '” is ready.');
        S.store.notify.fire('Course ready', '“' + course.title + '” finished generating.', item.id);
      } catch (e) {
        runner.activeId = null;
        runner.abortCtl = null;
        item.status = e.code === 'aborted' ? 'queued' : 'error';
        item.error = e instanceof SynapseError ? { code: e.code, message: e.message, hint: e.hint } : { code: 'unknown', message: String((e && e.message) || e), hint: '' };
        await S.store.queue.save(item);
        runner.emit(item);
        if (item.status === 'error') S.store.notify.fire('A course needs attention', item.topic + ' — ' + item.error.message, item.id);
      }
    },

    cancel(id) { if (runner.activeId === id && runner.abortCtl) runner.abortCtl.abort(); },

    async remove(id) {
      if (runner.activeId === id) runner.cancel(id);
      await S.store.queue.remove(id);
      refreshQueueBadge();
    },
  };

  function queueDetailHtml(item) {
    const job = item.job;
    const st = jobSummary(job);
    const running = item.status === 'running';
    const chainHtml = Array.from({ length: st.total }, (_, i) =>
      '<li class="' + (i < st.done ? 'done' : running && i === st.done ? 'active' : '') + '"></li>'
    ).join('');
    const stepsHtml = job.steps.map((s) => {
      let detail = s.detail || '';
      if (s.id === 'lessons' && (s.status === 'active' || s.status === 'error') && job.outline) detail = st.done + ' of ' + st.total + ' modules written';
      if (s.id === 'images' && s.status === 'active' && job.imageProgress.total) detail = job.imageProgress.done + ' of ' + job.imageProgress.total + ' checked';
      return '<li class="' + s.status + '"><span class="dot"></span><span>' + esc(s.label) + (detail ? '<span class="detail">' + esc(detail) + '</span>' : '') + '</span></li>';
    }).join('');
    let err = '';
    if (item.status === 'error') {
      const x = item.error || {};
      const keyIssue = ['invalid_key', 'missing_key', 'model_not_found'].includes(x.code);
      err =
        '<div class="err-box" role="alert"><strong>' + esc(x.message || 'Something went wrong.') + '</strong>' + (x.hint ? '<p>' + esc(x.hint) + '</p>' : '') +
        '<div class="btn-row">' +
        (keyIssue ? '<a class="btn btn-primary" href="#/settings">Open settings</a>' : '<button class="btn btn-primary" data-resume>' + (job.outline ? 'Resume' : 'Try again') + '</button>') +
        (['server', 'rate_limit', 'quota'].includes(x.code) ? '<a class="btn btn-quiet" href="#/settings">Add a backup AI</a>' : '') +
        '<button class="btn btn-quiet" data-remove>Remove</button></div></div>';
    }
    const title = job.outline ? job.outline.title : item.topic;
    return (
      '<div class="page gen"><a class="link-btn" href="#/queue">&larr; Pending courses</a>' +
      '<h1>' + (item.status === 'error' ? 'Generation paused' : item.status === 'queued' ? 'Ready to generate' : 'Building your course') + '</h1>' +
      '<p class="gen-topic">“' + esc(job.input.topic) + '”</p>' +
      (st.total ? '<ol class="chain" aria-label="Modules written" style="--seg:' + Math.max(6, Math.min(40, Math.floor(300 / Math.max(st.total, 1)) - 14)) + 'px">' + chainHtml + '</ol>' : '') +
      '<p class="chain-cap" role="status">' + esc(running ? st.label : item.status === 'queued' ? 'Not started yet. Tap Start when you’re ready.' : '') + '</p>' +
      '<ol class="steps">' + stepsHtml + '</ol>' +
      (job.notice && running ? '<p class="notice" role="status">' + esc(job.notice) + '</p>' : '') +
      (job.warnings && job.warnings.length ? '<p class="notice">' + job.warnings.map(esc).join(' ') + '</p>' : '') +
      err +
      '<div class="btn-row">' +
      (running ? '<button class="btn btn-quiet" data-cancel>Pause</button>'
        : item.status === 'queued' ? '<button class="btn btn-primary" data-start>' + icon('play') + 'Start generating</button>'
        : '') +
      (!running && item.status !== 'error' ? '<button class="btn btn-danger" data-remove>Remove</button>' : '') +
      '</div>' +
      '<p class="help" style="margin-top:22px">Keep this tab open while a course generates — Synapse works in the background across the app, but not once the browser is fully closed. Turn on notifications in Settings to hear about it either way.</p>' +
      '</div>'
    );
  }

  function renderQueueDetail(item) {
    if (location.hash !== '#/queue/' + item.id) return;
    if (item.status === 'done') { location.hash = '#/course/' + item.id; return; }
    main.innerHTML = queueDetailHtml(item);
    wireQueueDetail(item);
  }

  function wireQueueDetail(item) {
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    on('[data-start]', () => runner.start(item.id));
    on('[data-resume]', () => runner.start(item.id));
    on('[data-cancel]', () => runner.cancel(item.id));
    on('[data-remove]', async () => {
      const ok = await confirmDialog({ title: 'Remove this pending course?', body: 'Any progress writing it will be lost.', confirm: 'Remove', danger: true });
      if (ok) { await runner.remove(item.id); location.hash = '#/queue'; }
    });
  }

  window.addEventListener('beforeunload', (e) => {
    if (runner.activeId) { e.preventDefault(); e.returnValue = ''; }
  });

  async function viewQueueItem(token, id) {
    const item = await S.store.queue.get(id);
    if (!item) { toast("That pending course isn't there anymore.", 'bad'); location.hash = '#/queue'; return; }
    if (!show(token, queueDetailHtml(item), { nav: 'queue', title: item.job.outline ? item.job.outline.title : item.topic })) return;
    wireQueueDetail(item);
    runner.watch(id, renderQueueDetail);
  }

  async function viewQueueList(token) {
    const list = await S.store.queue.list();
    const html =
      '<div class="page"><h1 class="title">Pending courses</h1>' +
      '<p class="lede" style="font-size:1.05rem;margin-top:8px">Courses you started or queued. Synapse keeps working through them while this tab stays open, even if you switch to another screen.</p>' +
      (list.length ? '<div style="margin-top:22px">' + queueRows(list) + '</div>' : '<div class="empty" style="margin-top:22px"><strong>Nothing pending.</strong>Add a course to the queue from the home screen, or generate one right away.</div>') +
      '<p style="margin-top:24px"><a class="btn btn-primary" href="#/">New course</a></p></div>';
    if (!show(token, html, { nav: 'queue', title: 'Pending courses' })) return;
    wireQueueRows(main);
  }

  async function openSample() {
    const id = 'sample-arduino';
    let rec = await S.store.courses.get(id);
    if (!rec) {
      rec = { id, topic: 'Sample course', course: S.mock.course() };
      try { await S.store.courses.save(rec); } catch (e) { state.unsaved.set(id, rec); }
    }
    location.hash = '#/course/' + id;
  }

  /* ============================== overview ============================== */
  function buildSteps(course) {
    const steps = [];
    course.modules.forEach((m, mi) => {
      m.lessons.forEach((l, li) => steps.push({ id: l.id, kind: 'lesson', mi, li, title: l.title, lesson: l, module: m }));
      if (m.project) steps.push({ id: m.id + '-project', kind: 'project', mi, title: m.project.title, project: m.project, module: m });
    });
    if (course.references.length || course.suggestedTopics.length) steps.push({ id: 'references', kind: 'refs', title: 'References' });
    return steps;
  }

  const isDone = (p, id) => !!(p.completed && p.completed[id]);

  async function viewOverview(token, id) {
    const rec = await getRecord(id);
    const p = await S.store.progress.get(id);
    const c = rec.course;
    const st = S.schema.stats(c);
    const steps = buildSteps(c);
    const counted = steps.filter((s) => s.kind !== 'refs');
    const done = counted.filter((s) => isDone(p, s.id)).length;
    const cur = steps.find((s) => s.id === p.current) || steps.find((s) => !isDone(p, s.id) && s.kind !== 'refs') || steps[0];
    const started = done > 0 || !!p.current;
    const warnings = (c.meta && c.meta.warnings) || [];
    const html =
      '<div class="page overview"><h1 class="title">' + esc(c.title) + '</h1>' +
      (c.subtitle ? '<p class="subtitle">' + esc(c.subtitle) + '</p>' : '') +
      '<dl class="facts"><div><dt>Level</dt><dd>' + esc(c.level) + '</dd></div><div><dt>Time</dt><dd>' + esc(c.estimatedTime.replace(/^About\s+/i, '')) + '</dd></div><div><dt>Modules</dt><dd>' + st.modules + '</dd></div><div><dt>Lessons</dt><dd>' + st.lessons + '</dd></div>' +
      '<div><dt>Progress</dt><dd>' + done + ' of ' + counted.length + '</dd></div></dl>' +
      '<p class="desc">' + esc(c.description) + '</p>' +
      (warnings.length ? '<p class="notice" style="margin-top:16px">' + warnings.map(esc).join(' ') + '</p>' : '') +
      '<div class="btn-row"><a class="btn btn-primary" href="#/course/' + esc(id) + '/read/' + esc(cur.id) + '">' + (started ? 'Continue reading' : 'Start reading') + icon('right') + '</a>' +
      '<button class="btn btn-quiet" id="dl-pdf">' + icon('download') + 'Download PDF</button>' +
      '<button class="btn btn-quiet" id="dl-zip">' + icon('pkg') + 'Download package</button></div>' +
      '<p class="export-status" id="export-status" role="status"></p>' +
      (state.unsaved.has(id) ? '<p class="notice">This course could not be saved in your browser, so it will disappear when you close the tab. Download it now.</p>' : '') +
      (c.objectives.length ? '<h2 class="h2">What you will learn</h2><ul class="objectives">' + c.objectives.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' : '') +
      (c.prerequisites.length ? '<h2 class="h2">Before you start</h2><ul class="objectives">' + c.prerequisites.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' : '') +
      '<h2 class="h2">Contents</h2><div class="toc-list">' +
      c.modules.map((m, mi) =>
        '<section class="toc-mod"><h3><span class="n">' + (mi + 1) + '</span><span>' + esc(m.title) + '</span></h3><p class="d">' + esc(m.description) + '</p><ol>' +
        m.lessons.map((l) => tocLink(id, l.id, l.title, p, cur, S.schema.lessonMinutes(l) + ' min')).join('') +
        (m.project ? tocLink(id, m.id + '-project', 'Project: ' + m.project.title, p, cur, '') : '') + '</ol></section>'
      ).join('') + '</div>' +
      (steps.some((s) => s.kind === 'refs') ? '<p style="margin-top:26px"><a href="#/course/' + esc(id) + '/read/references">References and suggested reading</a></p>' : '') +
      '<p class="help" style="margin-top:34px">Made with ' + esc((c.meta && c.meta.model) || 'Synapse') + (c.meta && c.meta.generatedAt ? ' on ' + fmtDate(c.meta.generatedAt) : '') + (c.meta && c.meta.sample ? '. This is a hand-written sample course.' : '. AI-written courses can contain mistakes; check important facts.') + '</p></div>';
    if (!show(token, html, { nav: '', title: c.title })) return;
    $('#dl-pdf').onclick = () => exportPdf(rec);
    $('#dl-zip').onclick = () => openZipDialog(rec);
    prefetchLibs();
  }

  function tocLink(id, stepId, title, p, cur, mins) {
    const cls = isDone(p, stepId) ? 'done' : cur && cur.id === stepId && (p.current || Object.keys(p.completed).length) ? 'now' : '';
    return '<li><a href="#/course/' + esc(id) + '/read/' + esc(stepId) + '"><span class="tick ' + cls + '"></span><span>' + esc(title) + '</span>' + (mins ? '<span class="mins">' + mins + '</span>' : '') + '</a></li>';
  }

  function prefetchLibs() {
    const c = navigator.connection;
    if (c && (c.saveData || !/4g/.test(c.effectiveType || '4g'))) return;
    const go = () => { S.pdf.prefetch(); S.zip.ensureZip().catch(() => {}); };
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 6000 }); else setTimeout(go, 3000);
  }

  /* ---------- exports ---------- */
  let exporting = false;
  const setExportStatus = (t) => { const el = $('#export-status'); if (el) el.textContent = t; };
  const setExportBusy = (busy) => ['#dl-pdf', '#dl-zip'].forEach((s) => { const b = $(s); if (b) b.setAttribute('aria-busy', busy ? 'true' : 'false'); });

  async function exportPdf(rec) {
    if (exporting) return;
    exporting = true;
    setExportBusy(true);
    try {
      const blob = await S.pdf.generate(rec.course, { scope: 'full', onStatus: setExportStatus });
      downloadBlob(blob, safeName(rec.course.title) + '.pdf');
      setExportStatus('PDF created. Check your downloads.');
      toast('PDF downloaded.');
    } catch (e) {
      const x = explain(e);
      setExportStatus('');
      toast(x.title + ' ' + x.hint, 'bad');
    } finally {
      exporting = false;
      setExportBusy(false);
    }
  }

  function openZipDialog(rec) {
    if (exporting) return;
    const st = S.schema.stats(rec.course);
    const rec2 = S.zip.suggestMode(rec.course);
    const d = openDialog(
      '<h2>Download course package</h2><p>A ZIP with beautifully typeset PDFs, a references PDF and every image, ready for an offline library.</p>' +
      '<div class="choice"><label><input type="radio" name="zmode" value="single"' + (rec2 === 'single' ? ' checked' : '') + '><span><b>One complete PDF</b><small>About ' + st.pagesEstimate + ' pages, plus References.pdf</small></span></label>' +
      '<label><input type="radio" name="zmode" value="modules"' + (rec2 === 'modules' ? ' checked' : '') + '><span><b>One PDF per module</b><small>' + st.modules + ' smaller files' + (rec2 === 'modules' ? ' (recommended for a course this large)' : '') + '</small></span></label></div>' +
      '<div class="btn-row"><button class="btn btn-quiet" data-no>Cancel</button><button class="btn btn-primary" data-go>Create ZIP</button></div>'
    );
    d.querySelector('[data-no]').onclick = () => d.close();
    d.querySelector('[data-go]').onclick = () => { const mode = d.querySelector('input[name=zmode]:checked').value; d.close(); exportZip(rec, mode); };
  }

  async function exportZip(rec, mode) {
    if (exporting) return;
    exporting = true;
    setExportBusy(true);
    try {
      const blob = await S.zip.buildPackage(rec.course, { mode, onStatus: setExportStatus });
      downloadBlob(blob, safeName(rec.course.title) + '.zip');
      setExportStatus('Package created. Check your downloads.');
      toast('Package downloaded.');
    } catch (e) {
      const x = explain(e);
      setExportStatus('');
      toast(x.title + ' ' + x.hint, 'bad');
    } finally {
      exporting = false;
      setExportBusy(false);
    }
  }

  /* ============================== library ============================== */
  async function viewLibrary(token) {
    const list = await S.store.courses.list();
    const items = await Promise.all(list.map(async (c) => ({ c, p: await S.store.progress.get(c.id) })));
    const html =
      '<div class="page"><h1 class="title">Saved courses</h1>' +
      (items.length ? courseRows(items, true) : '<div class="empty"><strong>Nothing here yet.</strong>Courses you generate are saved in this browser so you can read them offline. <p style="margin-top:14px"><a class="btn btn-primary" href="#/">Make your first course</a></p></div>') +
      '<p class="help" style="margin-top:28px">Courses live only in this browser. Download the PDF or package to keep a copy elsewhere.</p></div>';
    if (!show(token, html, { nav: 'library', title: 'Saved courses' })) return;
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      const it = items.find((x) => x.c.id === b.dataset.del);
      const ok = await confirmDialog({ title: 'Delete this course?', body: '“' + it.c.title + '” and your progress will be removed from this browser.', confirm: 'Delete', danger: true });
      if (!ok) return;
      await S.store.courses.remove(it.c.id);
      if (state.record && state.record.id === it.c.id) state.record = null;
      toast('Course deleted.');
      route();
    }));
  }

  /* ============================== settings ============================== */
  function pwaStatusText() {
    const p = state.pwa;
    if (p.status === 'ready') return 'Offline ready. Synapse and your saved courses open without a connection.';
    if (p.status === 'insecure') return 'Offline mode and installation need HTTPS or localhost. This page is on ' + location.protocol + '//' + (location.host || 'a local file') + '. Host the folder on any HTTPS static host, or run a local server (for example: python3 -m http.server) and open http://localhost:8000.';
    if (p.status === 'unsupported') return 'This browser does not support service workers, so offline mode is unavailable.';
    if (p.status === 'error') return 'Offline mode could not be enabled: ' + (p.error || 'unknown error') + '.';
    return 'Setting up offline mode…';
  }

  function currentProvider() {
    const s = S.store.settings.get();
    return S.providers.get(s.provider) || S.providers.get('groq');
  }

  function providerRowHtml(p, s, key) {
    const model = S.store.settings.getModel(p.id);
    const isWriter = s.provider === p.id;
    const isBackup = (s.backups || []).includes(p.id);
    const isRef = s.referenceProvider === p.id;
    const open = isWriter || !!key;
    return (
      '<details class="prov-row"' + (open ? ' open' : '') + ' data-prov="' + p.id + '">' +
      '<summary><span class="prov-name">' + esc(p.name) + (p.id === 'groq' ? ' <em>· free, easiest</em>' : '') + '</span>' +
      '<span class="prov-tags">' + (isWriter ? '<span class="tag tag-accent">Writer</span>' : '') + (isBackup ? '<span class="tag">Backup</span>' : '') + (isRef ? '<span class="tag tag-signal">References</span>' : '') + (key ? '<span class="tag tag-ok">Key saved</span>' : '') + '</span></summary>' +
      '<div class="stack" style="margin-top:12px">' +
      '<p class="help">' + esc(p.note || '') + '</p>' +
      (p.custom ? '<div class="field"><label for="base-' + p.id + '">API base URL</label><input class="input" id="base-' + p.id + '" value="' + esc(s.customBaseUrl || '') + '" placeholder="https://api.example.com/v1" autocapitalize="none" spellcheck="false"></div>' : '') +
      '<div class="field"><label for="key-' + p.id + '">' + esc(p.name) + ' API key</label><div class="key-row"><input class="input" id="key-' + p.id + '" type="password" value="' + esc(key) + '" placeholder="' + esc(p.keyHint || 'Paste your key') + '" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="icon-btn" data-eye type="button" aria-label="Show key">' + icon('eye') + '</button></div>' +
      '<span class="help">' + esc(p.keySteps || '') + (p.keyUrl ? ' <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(p.keyLabel || 'the site') + '</a>' : '') + '</span></div>' +
      '<div class="field"><label for="model-' + p.id + '">Model</label><input class="input" id="model-' + p.id + '" list="models-' + p.id + '" placeholder="' + esc(p.defaultModel || 'model name') + '" value="' + esc(model) + '" autocomplete="off" autocapitalize="none" spellcheck="false"><datalist id="models-' + p.id + '">' + p.models.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>').join('') + '</datalist></div>' +
      '<label class="switch"><span>Remember this key on this device</span><input type="checkbox" data-remember' + (S.store.apiKey.isRemembered(p.id) ? ' checked' : '') + '><span class="track"></span></label>' +
      '<div class="btn-row"><button class="btn btn-quiet" data-test>Test key</button><button class="btn btn-quiet" data-clear>Remove key</button></div>' +
      '<p class="status-line" data-status role="status"></p>' +
      '<div class="role-toggles">' +
      (isWriter ? '<p class="help">This is the writer — it drafts every course by default.</p>' : '<label class="switch"><span>Use as a backup writer if the writer is busy or out of quota</span><input type="checkbox" data-role="backup"' + (isBackup ? ' checked' : '') + '><span class="track"></span></label>') +
      (p.supportsSearch ? '<label class="switch"><span>Use to find verified web references</span><input type="checkbox" data-role="reference"' + (isRef ? ' checked' : '') + '><span class="track"></span></label>' : '') +
      (!isWriter ? '<button class="link-btn" data-make-writer type="button">Make this the writer</button>' : '') +
      '</div></div></details>'
    );
  }

  async function viewSettings(token) {
    const s = S.store.settings.get();
    const theme = S.store.theme.get();
    const notifyPerm = S.store.notify.permission();
    const providers = S.providers.list();
    const configured = providers.filter((p) => S.store.apiKey.get(p.id)).length;
    const html =
      '<div class="page"><h1 class="title">Settings</h1>' +
      '<section class="settings-sec"><h2>AI providers</h2>' +
      '<p class="help">Synapse can hold a key for more than one AI at once. Pick a <b>writer</b> to draft courses, and turn on others as <b>backups</b> — if the writer runs out of free quota or is overloaded, Synapse switches to a backup automatically, mid-course. Only Gemini currently offers live web search, so turn it on as your <b>references</b> source even if it isn\'t your writer.</p>' +
      '<div class="field" style="margin-top:10px"><label for="prov">Writer</label><div class="select"><select id="prov">' + providers.map((p) => '<option value="' + p.id + '"' + (p.id === s.provider ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div></div>' +
      '<p class="help" style="margin:10px 0 4px">' + configured + ' of ' + providers.length + ' providers have a saved key.</p>' +
      '<div class="prov-list">' + providers.map((p) => providerRowHtml(p, s, S.store.apiKey.get(p.id))).join('') + '</div>' +
      '</section>' +
      '<section class="settings-sec"><h2>Notifications</h2>' +
      '<label class="switch"><span>Notify me when a queued course finishes generating</span><input type="checkbox" id="notify"' + (s.notify ? ' checked' : '') + '><span class="track"></span></label>' +
      '<p class="help" style="margin-top:8px" id="notify-status">' + (notifyPerm === 'denied' ? 'Notifications are blocked for Synapse in this browser. Allow them in your browser\'s site settings to use this.' : notifyPerm === 'unsupported' ? 'This browser does not support notifications.' : 'You\'ll get a system notification, so you can start a course and go do something else.') + '</p>' +
      '</section>' +
      '<section class="settings-sec"><h2>Appearance</h2><div class="seg" role="radiogroup" aria-label="Theme">' + [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map((t) => '<label><input type="radio" name="theme" value="' + t[0] + '"' + (theme === t[0] ? ' checked' : '') + '><span>' + t[1] + '</span></label>').join('') + '</div></section>' +
      '<section class="settings-sec"><h2>Offline and install</h2><p id="pwa-text" class="help" style="font-size:.98rem">' + esc(pwaStatusText()) + '</p><div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="install"' + (state.pwa.deferred ? '' : ' hidden') + '>Install Synapse</button></div></section>' +
      '<section class="settings-sec"><h2>Your data</h2><p class="help" style="font-size:.98rem" id="usage">Courses and progress are stored only in this browser.</p><div class="btn-row" style="margin-top:12px"><button class="btn btn-quiet" id="backup">Export a backup</button><button class="btn btn-danger" id="wipe">Delete all saved courses</button></div>' +
      '<p class="help" style="margin-top:18px">Privacy: Synapse has no accounts and no analytics. Your topic and lesson requests are sent only to the AI providers you configure. Photo look-ups contact Wikimedia Commons with a short search phrase. Fonts and PDF libraries are loaded from public CDNs and cached. Nothing else leaves your device.</p></section></div>';
    if (!show(token, html, { nav: 'settings', title: 'Settings' })) return;

    $('#prov').addEventListener('change', (e) => {
      const id = e.target.value;
      S.store.settings.set({ provider: id, backups: (s.backups || []).filter((x) => x !== id) });
      viewSettings(state.token);
    });
    $$('input[name=theme]').forEach((r) => r.addEventListener('change', () => { S.store.theme.set(r.value); S.store.theme.apply(); }));

    $$('.prov-row').forEach((row) => {
      const pid = row.dataset.prov;
      const p = S.providers.get(pid);
      const keyEl = $('#key-' + pid, row);
      const status = $('[data-status]', row);
      const say = (t, cls) => { status.textContent = t; status.className = 'status-line ' + (cls || ''); };
      const saveKey = () => S.store.apiKey.set(pid, keyEl.value.trim(), $('[data-remember]', row).checked);
      keyEl.addEventListener('change', () => { saveKey(); say(keyEl.value.trim() ? 'Key saved.' : ''); refreshQueueBadge(); });
      $('[data-remember]', row).addEventListener('change', saveKey);
      $('[data-eye]', row).onclick = () => { keyEl.type = keyEl.type === 'password' ? 'text' : 'password'; };
      $('#model-' + pid, row).addEventListener('change', (e) => S.store.settings.setModel(pid, e.target.value.trim()));
      const baseEl = $('#base-' + pid, row);
      if (baseEl) baseEl.addEventListener('change', (e) => S.store.settings.set({ customBaseUrl: e.target.value.trim() }));
      $('[data-clear]', row).onclick = () => { keyEl.value = ''; saveKey(); say('Key removed.'); row.querySelector('.tag-ok') && row.querySelector('.tag-ok').remove(); refreshQueueBadge(); };
      $('[data-test]', row).onclick = async () => {
        saveKey();
        if (baseEl) S.store.settings.set({ customBaseUrl: baseEl.value.trim() });
        if (!keyEl.value.trim()) return say('Paste a key first.', 'bad');
        say('Checking…');
        try {
          const r = await p.testKey({ apiKey: keyEl.value.trim() });
          const dl = $('#models-' + pid, row);
          if (dl && r.models.length) dl.innerHTML = r.models.map((m) => '<option value="' + esc(m) + '"></option>').join('');
          const using = S.store.settings.getModel(pid) || p.defaultModel;
          say('This key works. ' + r.models.length + ' models available' + (using ? '. Synapse will start with ' + using + '.' : '.'), 'ok');
        } catch (e) { const x = explain(e); say(x.title + ' ' + x.hint, 'bad'); }
      };
      const backupToggle = row.querySelector('[data-role="backup"]');
      if (backupToggle) backupToggle.addEventListener('change', (e) => { S.store.settings.toggleBackup(pid, e.target.checked); });
      const refToggle = row.querySelector('[data-role="reference"]');
      if (refToggle) refToggle.addEventListener('change', (e) => { S.store.settings.set({ referenceProvider: e.target.checked ? pid : '' }); viewSettings(state.token); });
      const makeWriter = $('[data-make-writer]', row);
      if (makeWriter) makeWriter.onclick = () => { S.store.settings.set({ provider: pid, backups: (S.store.settings.get().backups || []).filter((x) => x !== pid) }); viewSettings(state.token); };
    });

    $('#notify').addEventListener('change', async (e) => {
      if (e.target.checked) {
        const perm = await S.store.notify.request();
        if (perm !== 'granted') {
          e.target.checked = false;
          $('#notify-status').textContent = perm === 'denied' ? "Notifications are blocked for Synapse in this browser. Allow them in your browser's site settings, then try again." : 'Notifications need to be allowed to use this.';
          return;
        }
      }
      S.store.settings.set({ notify: e.target.checked });
      $('#notify-status').textContent = e.target.checked ? "You'll get a system notification when a queued course finishes." : 'Notifications are off.';
    });

    $('#install').onclick = async () => {
      const d = state.pwa.deferred;
      if (!d) return;
      d.prompt();
      await d.userChoice.catch(() => {});
      state.pwa.deferred = null;
      $('#install').hidden = true;
    };
    $('#backup').onclick = exportBackup;
    $('#wipe').onclick = async () => {
      const ok = await confirmDialog({ title: 'Delete all saved courses?', body: 'Every course and all reading progress will be removed from this browser. This cannot be undone.', confirm: 'Delete everything', danger: true });
      if (!ok) return;
      await S.store.courses.clearAll();
      state.record = null;
      toast('All saved courses deleted.');
      viewSettings(state.token);
    };
    S.store.estimateUsage().then((u) => { const el = $('#usage'); if (u && el) el.textContent = 'Courses and progress are stored only in this browser. Using about ' + (u.usage / 1048576).toFixed(1) + ' MB.'; });
  }

  async function exportBackup() {
    try {
      const [courses, prefs, settings] = await Promise.all([S.store.courses.list().then((l) => Promise.all(l.map((s) => S.store.courses.get(s.id)))), S.store.prefs.get(), S.store.settings.get()]);
      const data = { kind: 'synapse-backup', version: 1, exportedAt: Date.now(), prefs, settings, courses };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      downloadBlob(blob, 'synapse-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      toast('Backup downloaded. It does not include your API keys.');
    } catch (e) { toast('Could not create a backup on this device.', 'bad'); }
  }

  /* ============================== reader ============================== */
  const RS = [0.9, 1, 1.15, 1.32];
  const RS_NAMES = ['Small', 'Medium', 'Large', 'Extra large'];
  const md = (t) => S.md.inlineHtml(S.md.inline(t));

  function figureHtml(img) {
    let inner;
    if (img.type === 'diagram') {
      const r = S.diagrams.render(img.diagram, { mode: 'web', label: img.description });
      if (!r) return '';
      inner = r.html;
    } else if (img.dataUrl) {
      inner = '<img src="' + esc(img.dataUrl) + '" alt="' + esc(img.description) + '" loading="lazy" decoding="async">';
    } else return '';
    const credit = img.type === 'photo' && img.attribution ? '<span class="credit">' + (img.sourceUrl ? '<a href="' + esc(img.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(img.attribution) + '</a>' : esc(img.attribution)) + '</span>' : '';
    return '<figure class="fig">' + inner + (img.caption || credit ? '<figcaption>' + esc(img.caption || '') + credit + '</figcaption>' : '') + '</figure>';
  }

  function sourcesHtml(list, heading) {
    if (!list.length) return '';
    return '<section class="further"><h2>' + esc(heading) + '</h2><ul class="ref-list">' + list.map((r) =>
      '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + '</a>' + (r.website ? '<span class="site">' + esc(r.website) + '</span>' : '') + (r.description ? '<span class="desc">' + esc(r.description) + '</span>' : '') + '</li>').join('') + '</ul></section>';
  }

  function lessonBodyHtml(step) {
    const l = step.lesson;
    const items = S.md.placeImages(S.md.parse(l.content), l.images.filter(S.images.isRenderable));
    const body = items.map((it) => (it.block ? S.md.blockHtml(it.block) : figureHtml(it.image))).join('');
    return (
      '<div class="lesson-body">' + body + '</div>' +
      (l.keyPoints.length ? '<aside class="box key"><h2>Key points</h2><ul>' + l.keyPoints.map((k) => '<li>' + md(k) + '</li>').join('') + '</ul></aside>' : '') +
      l.examples.map((e) => '<aside class="box example"><h3>Example: ' + esc(e.title) + '</h3>' + S.md.toHtml(S.md.parse(e.body)) + '</aside>').join('') +
      (l.exercise ? '<aside class="box exercise"><h2>Try it yourself</h2><p>' + md(l.exercise.prompt) + '</p>' + (l.exercise.hint ? '<details><summary>Show a hint</summary><p>' + md(l.exercise.hint) + '</p></details>' : '') + '</aside>' : '') +
      (l.reflection.length ? '<aside class="box reflect"><h2>Reflect</h2><ul>' + l.reflection.map((q) => '<li>' + md(q) + '</li>').join('') + '</ul></aside>' : '') +
      (l.quiz.questions.length ? quizHtml(l.quiz.questions) : '') +
      sourcesHtml(l.sources, 'Further reading')
    );
  }

  function quizHtml(qs) {
    return '<section class="quiz" aria-labelledby="quiz-h"><h2 id="quiz-h">Check your understanding</h2><p class="score" data-score></p>' +
      qs.map((q, qi) => '<fieldset class="qcard" data-q="' + qi + '"><legend>' + (qi + 1) + '. ' + md(q.question) + '</legend><div class="opts" role="radiogroup">' +
        q.options.map((o, oi) => '<button type="button" class="opt" role="radio" aria-checked="false" data-o="' + oi + '"><span class="l">' + 'ABCDEF'[oi] + '</span><span>' + md(o) + '</span></button>').join('') +
        '</div><div class="explain" hidden></div></fieldset>').join('') + '</section>';
  }

  function applyQuiz(step, p) {
    const qs = step.lesson.quiz.questions;
    const saved = (p.quiz && p.quiz[step.id]) || {};
    let answered = 0, right = 0;
    $$('.qcard').forEach((fs) => {
      const qi = +fs.dataset.q;
      const q = qs[qi];
      const chosen = saved[qi];
      const ex = $('.explain', fs);
      $$('.opt', fs).forEach((b) => {
        const oi = +b.dataset.o;
        b.setAttribute('aria-checked', chosen === oi ? 'true' : 'false');
        b.classList.toggle('correct', chosen != null && oi === q.answerIndex);
        b.classList.toggle('wrong', chosen != null && oi === chosen && chosen !== q.answerIndex);
      });
      if (chosen != null) {
        answered++;
        const ok = chosen === q.answerIndex;
        if (ok) right++;
        ex.hidden = false;
        ex.innerHTML = '<b>' + (ok ? 'Correct.' : 'Not quite.') + '</b> ' + (ok ? '' : 'The answer is ' + 'ABCDEF'[q.answerIndex] + '. ') + md(q.explanation || '');
      } else ex.hidden = true;
    });
    const sc = $('[data-score]');
    if (sc) sc.textContent = answered === qs.length ? right + ' of ' + qs.length + ' correct' : answered ? answered + ' of ' + qs.length + ' answered' : 'Pick an answer for each question.';
  }

  function projectBodyHtml(step) {
    const pr = step.project;
    return '<div class="lesson-body"><p>' + md(pr.brief) + '</p></div>' +
      (pr.steps.length ? '<aside class="box project"><h2>Steps</h2><ol class="steps-list">' + pr.steps.map((s) => '<li>' + md(s) + '</li>').join('') + '</ol></aside>' : '') +
      (pr.deliverable ? '<aside class="box key"><h2>What you should have at the end</h2><p>' + md(pr.deliverable) + '</p></aside>' : '');
  }

  function refsBodyHtml(course) {
    const verified = course.references.filter((r) => r.verified);
    const other = course.suggestedTopics.concat(course.references.filter((r) => !r.verified));
    return '<div class="refs-page">' +
      (verified.length ? '<h2 class="grp">Verified references <span class="badge ok">Found via web search</span></h2><p class="muted">These links came from a live search, not from the AI’s memory.</p>' + sourcesHtml(verified, 'Sources').replace(/<section class="further"><h2>Sources<\/h2>/, '<section class="further">') : '') +
      (other.length ? '<h2 class="grp">Suggested topics to explore <span class="badge soft">Not verified</span></h2><p class="muted">Ideas for what to look up next. Synapse has not checked these against live sources.</p><ul class="ref-list">' +
        other.map((t) => '<li>' + (t.url ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' + esc(t.title) + '</a>' : '<strong>' + esc(t.title) + '</strong>') + (t.description ? '<span class="desc">' + esc(t.description) + '</span>' : '') +
          (!t.url && t.query ? '<span class="desc"><a href="https://www.google.com/search?q=' + encodeURIComponent(t.query) + '" target="_blank" rel="noopener noreferrer">Search the web for this</a></span>' : '') + '</li>').join('') + '</ul>' : '') +
      (!verified.length && !other.length ? '<p class="muted">This course has no references.</p>' : '') + '</div>';
  }

  function tocPanelHtml(course, id, steps, p, cur) {
    const link = (s, label) => '<li><a href="#/course/' + esc(id) + '/read/' + esc(s.id) + '"' + (s.id === cur.id ? ' aria-current="step"' : '') + '><span class="tick ' + (isDone(p, s.id) ? 'done' : '') + '"></span><span>' + esc(label) + '</span></a></li>';
    return '<div class="head"><strong>Contents</strong><button class="icon-btn close-toc" data-close-toc aria-label="Close contents">' + icon('close') + '</button></div>' +
      '<a class="toc-single" href="#/course/' + esc(id) + '">Course overview</a>' +
      course.modules.map((m, mi) => {
        const own = steps.filter((s) => s.mi === mi && s.kind !== 'refs');
        return '<details' + (own.some((s) => s.id === cur.id) ? ' open' : '') + '><summary><span class="n">' + (mi + 1) + '</span><span>' + esc(m.title) + '</span></summary><ol>' +
          own.map((s) => link(s, s.kind === 'project' ? 'Project: ' + s.title : s.title)).join('') + '</ol></details>';
      }).join('') +
      (steps.some((s) => s.kind === 'refs') ? '<ol style="list-style:none;padding:8px 0">' + link(steps[steps.length - 1], 'References') + '</ol>' : '');
  }

  async function viewReader(token, id, stepId) {
    const rec = await getRecord(id);
    const course = rec.course;
    const p = await S.store.progress.get(id);
    state.progress = p;
    const steps = buildSteps(course);
    let idx = steps.findIndex((s) => s.id === (stepId || p.current));
    if (idx < 0) idx = Math.max(0, steps.findIndex((s) => !isDone(p, s.id) && s.kind !== 'refs'));
    const step = steps[idx];
    const prev = steps[idx - 1], next = steps[idx + 1];
    const counted = steps.filter((s) => s.kind !== 'refs');
    const rsIdx = Math.min(RS.length - 1, Math.max(0, S.store.prefs.get().readSize));

    let header, body;
    if (step.kind === 'lesson') {
      header = '<div class="lesson-kicker"><span>Module ' + (step.mi + 1) + ': ' + esc(step.module.title) + '</span><span>Lesson ' + (step.li + 1) + ' of ' + step.module.lessons.length + '</span><span>' + S.schema.lessonMinutes(step.lesson) + ' min</span></div><h1>' + esc(step.title) + '</h1>' + (step.lesson.summary ? '<p class="lesson-lede">' + esc(step.lesson.summary) + '</p>' : '');
      body = lessonBodyHtml(step);
    } else if (step.kind === 'project') {
      header = '<div class="lesson-kicker"><span>Module ' + (step.mi + 1) + ': ' + esc(step.module.title) + '</span><span>Project</span></div><h1>' + esc(step.title) + '</h1>';
      body = projectBodyHtml(step);
    } else {
      header = '<div class="lesson-kicker"><span>End of course</span></div><h1>References</h1>';
      body = refsBodyHtml(course);
    }
    const doneNow = isDone(p, step.id);
    const nextLabel = next ? (doneNow || step.kind === 'refs' ? 'Next' : 'Complete and continue') : (doneNow ? 'Back to overview' : 'Finish course');

    const html =
      '<div class="reader-bar"><div class="row"><a class="icon-btn" href="#/course/' + esc(id) + '" aria-label="Course overview">' + icon('back') + '</a><span class="ttl">' + esc(course.title) + '</span>' +
      '<button class="icon-btn" data-size aria-label="Text size">' + icon('text') + '</button>' + themeButtonHtml() +
      '<button class="icon-btn open-toc" data-open-toc aria-label="Contents" aria-controls="toc">' + icon('menu') + '</button></div>' +
      '<div class="reader-progress" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="' + counted.length + '"><span id="rp"></span></div></div>' +
      '<div class="reader-layout"><aside class="toc-panel" id="toc" aria-label="Contents">' + tocPanelHtml(course, id, steps, p, step) + '</aside><div class="toc-backdrop" data-close-toc></div>' +
      '<article class="lesson" id="lesson">' + header + body + '</article></div>' +
      '<nav class="reader-nav" aria-label="Lesson navigation"><div class="in">' +
      (prev ? '<a class="btn btn-quiet prev" href="#/course/' + esc(id) + '/read/' + esc(prev.id) + '" aria-label="Previous: ' + esc(prev.title) + '">' + icon('back') + '</a>' : '') +
      '<button class="btn btn-primary" id="next">' + esc(nextLabel) + (next ? icon('right') : icon('check')) + '</button></div></nav>';

    if (!show(token, html, { reading: true, title: step.title, keepScroll: true })) return;
    document.documentElement.style.setProperty('--rs', RS[rsIdx]);
    const setBar = () => {
      const n = counted.filter((s) => isDone(state.progress, s.id)).length;
      const bar = $('#rp');
      if (bar) { bar.style.width = (n / counted.length) * 100 + '%'; bar.parentElement.setAttribute('aria-valuenow', n); }
    };
    setBar();
    if (step.kind === 'lesson' && step.lesson.quiz.questions.length) applyQuiz(step, p);

    // scroll: restore when returning to the same lesson, otherwise start at the top
    const resume = !state.freshNav && p.current === step.id && p.scroll > 0.02 && p.scroll < 0.97;
    state.freshNav = false;
    window.scrollTo(0, 0);
    if (resume) requestAnimationFrame(() => window.scrollTo(0, p.scroll * (document.documentElement.scrollHeight - innerHeight)));

    p.current = step.id;
    let t;
    window.onscroll = () => {
      clearTimeout(t);
      t = setTimeout(() => { p.scroll = readingPct(); S.store.progress.save(p); }, 500);
    };
    S.store.progress.save(p);

    // interactions
    const toc = $('#toc'), back = $('.toc-backdrop');
    const setToc = (open) => { toc.classList.toggle('open', open); back.classList.toggle('open', open); };
    $$('[data-open-toc]').forEach((b) => (b.onclick = () => setToc(true)));
    $$('[data-close-toc]').forEach((b) => (b.onclick = () => setToc(false)));
    $$('#toc a').forEach((a) => a.addEventListener('click', () => { state.freshNav = true; setToc(false); }));
    $$('.reader-nav a').forEach((a) => a.addEventListener('click', () => { state.freshNav = true; }));
    $('[data-size]').onclick = () => {
      const cur = Math.min(RS.length - 1, Math.max(0, S.store.prefs.get().readSize));
      const n = (cur + 1) % RS.length;
      S.store.prefs.set({ readSize: n });
      document.documentElement.style.setProperty('--rs', RS[n]);
      toast('Text size: ' + RS_NAMES[n]);
    };
    $('#next').onclick = async () => {
      if (step.kind !== 'refs' && !doneNow) { p.completed[step.id] = Date.now(); p.scroll = 0; await S.store.progress.save(p); }
      state.freshNav = true;
      if (next) location.hash = '#/course/' + id + '/read/' + next.id;
      else {
        if (!doneNow) toast('Course complete. Well done!');
        location.hash = '#/course/' + id;
      }
    };
    const article = $('#lesson');
    article.addEventListener('click', async (e) => {
      const opt = e.target.closest('.opt');
      if (opt) {
        const qi = +opt.closest('.qcard').dataset.q;
        p.quiz[step.id] = p.quiz[step.id] || {};
        p.quiz[step.id][qi] = +opt.dataset.o;
        applyQuiz(step, p);
        S.store.progress.save(p);
        return;
      }
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const text = $('pre', copy.closest('.codeblock')).innerText;
        try { await navigator.clipboard.writeText(text); toast('Code copied.'); } catch (err) { toast('Could not copy on this device.', 'bad'); }
      }
    });
  }

  /* ============================== PWA ============================== */
  function initPwa() {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!('serviceWorker' in navigator)) state.pwa.status = 'unsupported';
    else if (!secure) state.pwa.status = 'insecure';
    else {
      navigator.serviceWorker.register('service-worker.js').then(() => navigator.serviceWorker.ready).then(() => {
        state.pwa.status = 'ready';
        const el = $('#pwa-text'); if (el) el.textContent = pwaStatusText();
      }).catch((e) => {
        state.pwa.status = 'error';
        state.pwa.error = String((e && e.message) || e).slice(0, 120);
      });
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.pwa.deferred = e;
      const b = $('#install'); if (b) b.hidden = false;
    });
    window.addEventListener('appinstalled', () => { state.pwa.deferred = null; toast('Synapse installed.'); });
    const banner = $('#offline-banner');
    const sync = () => { banner.hidden = navigator.onLine; };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  }

  /* ============================== boot ============================== */
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) toggleTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.store.theme.get() === 'system') S.store.theme.apply(); });
  S.store.theme.apply();
  window.addEventListener('hashchange', route);
  initPwa();

  /** A queue item can be left mid-flight only if the tab actually closed, so nothing is really
      still running. Mark it paused rather than silently continuing to spend API calls unasked. */
  async function resetStuckQueue() {
    const list = await S.store.queue.list();
    await Promise.all(list.filter((i) => i.status === 'running').map((i) => { i.status = 'queued'; return S.store.queue.save(i); }));
  }

  S.store.ready()
    .then(resetStuckQueue)
    .then(refreshQueueBadge)
    .then(route);
})();
