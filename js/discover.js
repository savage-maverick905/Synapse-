/* Synapse · discover.js
   "Did you know?" facts and quotes — pulled from the real web (Wikipedia for facts, a public
   quotes API for quotes), not written by an AI. Facts are picked around topics the learner has
   actually studied when possible. Everything degrades gracefully: if the network or a source is
   unavailable, a small hand-written local set steps in so the card is never empty — including
   fully offline. Cards can be saved as a Synapse-styled PNG image.
   No AI provider is ever involved, so this never touches an API key or quota. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { downloadBlob, safeName } = S.util;

  /* ---------- bundled fallback content (used only if the live web can't be reached) ---------- */
  const FALLBACK_FACTS = [
    'Honey never spoils — sealed jars found in 3,000-year-old Egyptian tombs are still edible today.',
    'A day on Venus is longer than its year: it rotates once every 243 Earth days but orbits the Sun in 225.',
    'Octopuses have three hearts, and two of them stop beating when the animal swims.',
    'The Great Wall of China is not one continuous wall but a network of walls built over many centuries.',
    'Bananas are botanically classified as berries, while strawberries are not.',
    'Sharks existed before trees: they predate them by roughly 50 million years.',
    'A single bolt of lightning is about five times hotter than the surface of the Sun.',
    'The human brain generates enough electricity while awake to power a small LED bulb.',
    'Wombat droppings are cube-shaped, which keeps them from rolling away and marks territory.',
    'There are more possible chess games than atoms in the observable universe.',
    "Antarctica is technically the world's largest desert, defined by how little precipitation it gets.",
    'The first computer programmer, Ada Lovelace, wrote her algorithm in the 1840s — decades before computers existed.',
    'Glass is an amorphous solid: its atoms are arranged more like a very slow-moving liquid than a crystal.',
    'The Eiffel Tower grows about 15 cm taller in summer as the iron expands in the heat.',
    'Some metals, like sodium, are so reactive they must be stored underwater — or in oil — to keep from combusting.',
    'A group of flamingos is called a "flamboyance."',
    'The shortest war in recorded history lasted about 38 minutes, between Britain and Zanzibar in 1896.',
    'Water can boil and freeze at the same time at a specific pressure and temperature called its triple point.',
    'The Mona Lisa has no eyebrows — it was fashionable in Renaissance Florence to pluck them.',
    'Neurons in the human brain can transmit signals at speeds up to 120 meters per second.',
    'Mount Everest grows about 4 millimeters higher each year due to tectonic plate movement.',
    'The inventor of the Pringles can, Fredric Baur, was buried in one at his request.',
    'DNA from every human on Earth would fit in a teaspoon, yet stretched out could reach the Sun and back many times.',
    'Butterflies taste with their feet, using sensors that detect sugars in what they land on.',
  ];

  const FALLBACK_QUOTES = [
    { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
    { text: 'Curiosity is the wick in the candle of learning.', author: 'William Arthur Ward' },
    { text: 'It is not that I am so smart. But I stay with the questions much longer.', author: 'Albert Einstein' },
    { text: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', author: 'Mahatma Gandhi' },
    { text: 'The beautiful thing about learning is that no one can take it away from you.', author: 'B.B. King' },
    { text: 'Nothing in life is to be feared, it is only to be understood.', author: 'Marie Curie' },
    { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin' },
    { text: 'Education is not the filling of a pail, but the lighting of a fire.', author: 'W. B. Yeats' },
    { text: 'The more that you read, the more things you will know.', author: 'Dr. Seuss' },
    { text: 'I have not failed. I have just found 10,000 ways that won\u2019t work.', author: 'Thomas Edison' },
    { text: 'The important thing is not to stop questioning.', author: 'Albert Einstein' },
    { text: 'Anyone who stops learning is old, whether at twenty or eighty.', author: 'Henry Ford' },
    { text: 'The roots of education are bitter, but the fruit is sweet.', author: 'Aristotle' },
    { text: 'Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.', author: 'Richard Feynman' },
    { text: 'The mind is not a vessel to be filled but a fire to be kindled.', author: 'Plutarch' },
    { text: 'You don\u2019t have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
    { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison' },
    { text: 'What we know is a drop, what we don\u2019t know is an ocean.', author: 'Isaac Newton' },
    { text: 'Somewhere, something incredible is waiting to be known.', author: 'Carl Sagan' },
    { text: 'The beginning of knowledge is the discovery of something we do not understand.', author: 'Frank Herbert' },
  ];

  /* ---------- helpers ---------- */
  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 7000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  const todayKey = () => new Date().toISOString().slice(0, 10);

  /** A stable pseudo-random index for "today", so the daily pick doesn't change on refresh. */
  function seededIndex(seed, n) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
    return n > 0 ? h % n : 0;
  }

  async function topicsFromLibrary() {
    try {
      const list = await S.store.courses.list();
      const topics = [];
      list.forEach((c) => { if (c.title) topics.push(c.title); });
      return topics;
    } catch (e) {
      return [];
    }
  }

  /* ---------- facts (Wikipedia) ---------- */
  function firstSentence(text) {
    text = String(text || '').trim();
    const m = /^(.{20,220}?[.!?])(\s|$)/.exec(text);
    return (m ? m[1] : text.slice(0, 200)).trim();
  }

  async function wikipediaSummaryFor(topic, signal) {
    const search = await fetchWithTimeout(
      'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&namespace=0&limit=1&search=' + encodeURIComponent(topic)
    );
    const title = search && search[1] && search[1][0];
    if (!title) throw new Error('no matching article');
    return wikipediaSummaryByTitle(title);
  }

  async function wikipediaSummaryByTitle(title) {
    const j = await fetchWithTimeout('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
    if (!j || !j.extract || j.type === 'disambiguation') throw new Error('no usable extract');
    return {
      text: firstSentence(j.extract),
      sourceTitle: j.title,
      sourceUrl: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(title)),
    };
  }

  async function wikipediaRandomSummary() {
    const j = await fetchWithTimeout('https://en.wikipedia.org/api/rest_v1/page/random/summary');
    if (!j || !j.extract) throw new Error('no usable extract');
    return {
      text: firstSentence(j.extract),
      sourceTitle: j.title,
      sourceUrl: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || '',
    };
  }

  async function freshFact() {
    const topics = await topicsFromLibrary();
    try {
      if (topics.length) {
        const topic = topics[seededIndex(todayKey() + '|fact', topics.length)];
        const r = await wikipediaSummaryFor(topic);
        return { kind: 'fact', text: r.text, attribution: r.sourceTitle + ' · Wikipedia', sourceUrl: r.sourceUrl, topic };
      }
      const r = await wikipediaRandomSummary();
      return { kind: 'fact', text: r.text, attribution: r.sourceTitle + ' · Wikipedia', sourceUrl: r.sourceUrl, topic: '' };
    } catch (e) {
      const i = seededIndex(todayKey() + '|factfallback|' + Math.random(), FALLBACK_FACTS.length);
      return { kind: 'fact', text: FALLBACK_FACTS[i], attribution: 'Synapse', sourceUrl: '', topic: '', offline: true };
    }
  }

  /* ---------- quotes ---------- */
  async function freshQuote() {
    try {
      const j = await fetchWithTimeout('https://api.quotable.io/random?maxLength=180');
      const text = j && (j.content || j.quote);
      if (!text) throw new Error('no quote content');
      return { kind: 'quote', text, attribution: j.author || 'Unknown', sourceUrl: 'https://quotable.io', topic: '' };
    } catch (e) {
      const i = seededIndex(todayKey() + '|quotefallback|' + Math.random(), FALLBACK_QUOTES.length);
      const q = FALLBACK_QUOTES[i];
      return { kind: 'quote', text: q.text, attribution: q.author, sourceUrl: '', topic: '', offline: true };
    }
  }

  /* ---------- feed: many distinct items at once, for continuous scrolling ---------- */
  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function topicPool() {
    const titles = await topicsFromLibrary();
    try {
      const list = await S.store.courses.list();
      const recs = await Promise.all(list.slice(0, 10).map((s) => S.store.courses.get(s.id)));
      recs.forEach((r) => { if (r && r.course) r.course.modules.forEach((m) => { if (m.title) titles.push(m.title); }); });
    } catch (e) { /* topics-only is fine if this fails */ }
    return shuffleArr(titles);
  }

  /** `count` distinct fact or quote cards for a scrolling feed — not tied to the once-a-day pick.
      Cycles through different topics from the library (module titles too, for more variety than
      just course titles) so a feed session doesn't repeat itself. Falls back per-item, so one
      failed lookup never breaks the rest of the batch. */
  async function feedBatch(kind, count, seenTexts) {
    seenTexts = seenTexts || new Set();
    const topics = kind === 'fact' ? await topicPool() : [];
    const out = [];
    let topicIdx = 0;
    let guard = 0;
    while (out.length < count && guard < count * 5 + 6) {
      guard++;
      let card;
      try {
        if (kind === 'quote') {
          card = await freshQuote();
        } else if (topics.length) {
          const topic = topics[topicIdx % topics.length];
          topicIdx++;
          const r = await wikipediaSummaryFor(topic);
          card = { kind: 'fact', text: r.text, attribution: r.sourceTitle + ' · Wikipedia', sourceUrl: r.sourceUrl, topic };
        } else {
          const r = await wikipediaRandomSummary();
          card = { kind: 'fact', text: r.text, attribution: r.sourceTitle + ' · Wikipedia', sourceUrl: r.sourceUrl, topic: '' };
        }
      } catch (e) {
        const pool = kind === 'quote' ? FALLBACK_QUOTES : FALLBACK_FACTS;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        card = kind === 'quote'
          ? { kind: 'quote', text: pick.text, attribution: pick.author, sourceUrl: '', topic: '', offline: true }
          : { kind: 'fact', text: pick, attribution: 'Synapse', sourceUrl: '', topic: '', offline: true };
      }
      if (!card || !card.text || seenTexts.has(card.text)) continue;
      seenTexts.add(card.text);
      out.push(card);
    }
    return out;
  }

  /* ---------- daily cache ---------- */
  const cacheKey = (kind) => 'synapse.discover.' + kind + '.' + todayKey();

  async function today(kind) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(kind)) || 'null');
      if (cached) return cached;
    } catch (e) { /* ignore corrupt cache */ }
    const card = await (kind === 'quote' ? freshQuote() : freshFact());
    try { localStorage.setItem(cacheKey(kind), JSON.stringify(card)); } catch (e) { /* best-effort */ }
    return card;
  }

  /** Force a new pick (ignoring today's cache), used by the "Show me another" action. It still
      becomes the day's cached card, so revisiting the page keeps showing this new one. */
  async function another(kind) {
    const card = await (kind === 'quote' ? freshQuote() : freshFact());
    try { localStorage.setItem(cacheKey(kind), JSON.stringify(card)); } catch (e) { /* best-effort */ }
    return card;
  }

  /* ---------- Synapse-styled shareable card image ---------- */
  function wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  async function renderCardPng(card) {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* draw with fallback fonts */ } }
    const SIZE = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'left';

    // Background
    ctx.fillStyle = '#1E1E1E';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Corner border, echoing the certificate's frame
    ctx.strokeStyle = '#3A3A3A';
    ctx.lineWidth = 2;
    ctx.strokeRect(48, 48, SIZE - 96, SIZE - 96);

    // The synapse mark (two nodes + spark), top-left
    const mx = 120, my = 130;
    ctx.strokeStyle = '#5A5A5A';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx - 46, my + 8); ctx.lineTo(mx - 18, my - 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx + 46, my - 12); ctx.lineTo(mx + 18, my - 2); ctx.stroke();
    ctx.fillStyle = '#ED6627'; ctx.beginPath(); ctx.arc(mx - 22, my, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1E1E1E'; ctx.beginPath(); ctx.arc(mx - 22, my, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00ADEF'; ctx.beginPath(); ctx.arc(mx + 26, my - 8, 10, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#8A8A8A';
    ctx.font = '700 22px "Bricolage Grotesque", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SYNAPSE', mx + 56, my + 8);

    const kicker = card.kind === 'quote' ? 'QUOTE OF THE DAY' : 'DID YOU KNOW?';
    ctx.fillStyle = '#ED6627';
    ctx.font = '800 30px "Bricolage Grotesque", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(kicker, 118, 240);

    // Decorative giant quote mark for quotes
    if (card.kind === 'quote') {
      ctx.fillStyle = '#2A2A2A';
      ctx.font = '900 220px Georgia, serif';
      ctx.fillText('\u201C', 96, 470);
    }

    // Main text, wrapped and vertically centered in the remaining space
    ctx.fillStyle = '#F2F2F2';
    ctx.font = (card.kind === 'quote' ? 'italic 500 54px' : '600 50px') + ' "Newsreader", Georgia, serif';
    const maxWidth = SIZE - 240;
    const lines = wrapCanvasText(ctx, card.text, maxWidth);
    const lineHeight = 68;
    const blockHeight = lines.length * lineHeight;
    let y = SIZE / 2 - blockHeight / 2 + 40;
    lines.forEach((line) => { ctx.fillText(line, 120, y); y += lineHeight; });

    // Attribution + footer
    ctx.fillStyle = '#00ADEF';
    ctx.font = '700 30px "Bricolage Grotesque", sans-serif';
    ctx.fillText((card.kind === 'quote' ? '\u2014 ' : '') + card.attribution, 120, y + 20);

    ctx.fillStyle = '#6E6E6E';
    ctx.font = '400 22px "Bricolage Grotesque", sans-serif';
    ctx.fillText('Turn curiosity into a course · synapse', 120, SIZE - 90);

    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas encode failed'))), 'image/png'));
  }

  async function downloadCard(card) {
    const blob = await renderCardPng(card);
    const name = safeName((card.kind === 'quote' ? 'Quote' : 'Fact') + ' - ' + card.attribution, card.kind);
    downloadBlob(blob, name + '.png');
    return blob;
  }

  S.discover = { today, another, feedBatch, downloadCard, renderCardPng, FALLBACK_FACTS, FALLBACK_QUOTES };
})();
