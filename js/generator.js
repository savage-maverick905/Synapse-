/* Synapse · generator.js
   Turns a topic into a validated course in several real, resumable steps:

     1. outline      one call: title, objectives, modules and lesson titles
     2. references   one grounded web-search call (only if the provider supports it)
     3. lessons      one call per module (falls back to one call per lesson)
     4. images       look up photographs on Wikimedia Commons (diagrams are drawn locally)
     5. assemble     validate everything with schema.js

   Progress is reported as real counts ("module 3 of 6"), never a made-up percentage.
   If something fails, the job keeps everything finished so far and can be resumed. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { SynapseError, uid, hostOf, isHttpUrl } = S.util;

  const SYSTEM =
    'You are Synapse, an expert curriculum designer and textbook author. You write genuine teaching material: precise, concrete, ' +
    'well organised, and never padded with filler, hype or generic motivation. You always reply with ONE valid JSON object and nothing ' +
    'else: no Markdown code fences around it, no commentary before or after it.';

  const DEPTH = {
    Quick: { lessons: 2, words: 380, questions: 2 },
    Standard: { lessons: 3, words: 750, questions: 3 },
    Deep: { lessons: 4, words: 1200, questions: 4 },
  };
  const LEVEL_GUIDE = {
    Beginner: '(assume no prior knowledge; define every term, use everyday analogies, small steps)',
    Intermediate: '(assume the basics; focus on how things work, trade-offs and real practice)',
    Advanced: '(assume solid fundamentals; be rigorous, cover edge cases, theory and expert practice)',
  };
  const STYLE_GUIDE = {
    Mixed: '(balance explanation, worked examples, diagrams and practice)',
    Visual: '(lean on diagrams, comparisons, tables and spatial explanations; include at least one diagram per lesson)',
    Reading: '(rich, well-argued prose that reads like a good textbook chapter)',
    'Hands-on': '(learn by doing: concrete tasks, code or step-by-step activities in every lesson)',
  };

  const DIAGRAM_SPEC =
    'Diagram objects (drawn by the app, so keep them small and clear):\n' +
    '  {"type":"diagram","description":"<what it shows>","caption":"<one line>","diagram":{"kind":"flow","nodes":[{"id":"a","label":"Sensor"},{"id":"b","label":"Controller"}],"edges":[{"from":"a","to":"b","label":"signal"}]}}\n' +
    '  kinds: "flow" (2-10 nodes, edges optional), "cycle" (3-8 nodes in a loop, optional "center" label), ' +
    '"layers" ({"layers":[{"label":"...","detail":"..."}]}, top to bottom, 2-7 items), "comparison" ({"columns":[{"title":"...","points":["..."]}]}, 2-3 columns).\n' +
    '  Node labels must be short (under 5 words).\n' +
    'Photo objects (only for real physical things where a photograph truly helps):\n' +
    '  {"type":"photo","description":"<what it shows>","caption":"<one line>","searchQuery":"<2-5 word concrete noun phrase, e.g. Arduino Uno board>"}\n' +
    '  NEVER include a URL for an image. The app finds licensed photos itself.';

  const MD_RULES =
    'Lesson "content" is a Markdown string using ONLY: paragraphs, ### subheadings, **bold**, *italic*, `inline code`, bullet and numbered lists, ' +
    'pipe tables (with a header separator row), > blockquotes for definitions or callouts, fenced code blocks with a language (```python), ' +
    'and ```equation fenced blocks for formulas written in plain text or simple LaTeX. No HTML. Do NOT repeat the lesson title as a heading. ' +
    'Escape newlines inside JSON strings as \\n.';

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /* ---------- job ---------- */
  function createJob(input) {
    const depth = DEPTH[input.depth] || DEPTH.Standard;
    const flags = { quizzes: !!input.quizzes, projects: !!input.projects, examples: !!input.examples, images: !!input.images, references: !!input.references };
    const job = {
      id: uid(),
      input: Object.assign({}, input, { flags }),
      plan: { modules: input.modules, lessonsPerModule: depth.lessons, words: depth.words, questions: depth.questions },
      outline: null,
      refs: [],
      suggested: [],
      refsDone: false,
      modules: [],
      writing: { done: 0, total: input.modules, current: '' },
      imageProgress: { done: 0, total: 0 },
      course: null,
      status: 'idle',
      error: null,
      notice: '',
      warnings: [],
      startedAt: Date.now(),
    };
    job.steps = [
      { id: 'outline', label: 'Analyzing your topic and building the curriculum', status: 'pending' },
      { id: 'refs', label: 'Gathering references', status: flags.references ? 'pending' : 'skipped' },
      { id: 'lessons', label: 'Writing lessons, exercises and quizzes', status: 'pending' },
      { id: 'images', label: 'Finding images', status: flags.images ? 'pending' : 'skipped' },
      { id: 'finish', label: 'Preparing your course', status: 'pending' },
    ];
    return job;
  }

  const step = (job, id) => job.steps.find((s) => s.id === id);
  function setStep(job, id, status, detail) {
    const s = step(job, id);
    if (!s) return;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
  }

  /* ---------- model calls ---------- */
  // Failures where trying the next configured AI is worth it, instead of just retrying the same one.
  const CHAIN_WORTHY = new Set(['quota', 'server', 'model_not_found', 'invalid_key', 'missing_key', 'rate_limit', 'bad_request', 'too_large']);
  const cur = (ctx) => ctx.chain[ctx.chainIndex];
  const describeFailure = (code) =>
    code === 'quota' ? 'ran out of free quota'
    : code === 'invalid_key' || code === 'missing_key' ? 'had no working key'
    : code === 'model_not_found' ? "didn't have a usable model"
    : 'was unavailable';

  /** Runs one JSON-producing prompt. Retries malformed JSON on the same AI, and switches to the
      next AI in the chain (in order: writer, then each enabled backup) if the current one is out
      of quota, overloaded, missing a key, or otherwise unavailable — so one AI running out mid-course
      doesn't stop the course. */
  async function callJSON(job, ctx, prompt, opts) {
    opts = opts || {};
    let guard = 0;
    for (;;) {
      if (++guard > ctx.chain.length * 2 + 4) throw new SynapseError('unknown', 'Every configured AI failed.', { hint: 'Check your API keys in Settings.' });
      const entry = cur(ctx);
      let failure = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await entry.provider.generateJSON({
            apiKey: entry.apiKey,
            model: entry.model,
            system: SYSTEM,
            prompt: attempt ? prompt + '\n\nIMPORTANT: your previous reply was not valid JSON. Reply again with ONE complete, valid JSON object only.' : prompt,
            signal: ctx.signal,
            temperature: attempt ? 0.3 : opts.temperature,
            maxTokens: opts.maxTokens,
            onNotice: (n) => { job.notice = n; ctx.onUpdate(job); },
          });
          job.notice = '';
          return { data: S.schema.parseModelJSON(r.text).data, truncated: r.truncated };
        } catch (e) {
          if (e.code === 'aborted') throw e;
          failure = e;
          if (CHAIN_WORTHY.has(e.code)) break; // no point burning the 2nd same-provider attempt
        }
      }
      if (CHAIN_WORTHY.has(failure.code) && ctx.chainIndex < ctx.chain.length - 1) {
        ctx.chainIndex++;
        job.chainIndex = ctx.chainIndex;
        const next = cur(ctx);
        job.warnings.push(entry.provider.name + ' ' + describeFailure(failure.code) + ', so Synapse switched to ' + next.provider.name + '.');
        job.notice = '';
        ctx.onUpdate(job);
        continue;
      }
      throw failure;
    }
  }

  /* ---------- 1. outline ---------- */
  function outlinePrompt(job) {
    const i = job.input, p = job.plan;
    return (
      'Design a complete course.\n\n' +
      'LEARNER REQUEST:\n"""\n' + i.topic + '\n"""\n\n' +
      'Level: ' + i.level + ' ' + (LEVEL_GUIDE[i.level] || '') + '\n' +
      'Depth: ' + i.depth + '\n' +
      'Learning style: ' + i.style + ' ' + (STYLE_GUIDE[i.style] || '') + '\n' +
      'Structure: exactly ' + p.modules + ' modules, each with exactly ' + p.lessonsPerModule + ' lessons.\n\n' +
      'Rules:\n' +
      '- Modules must progress logically from foundations to more advanced ideas; each one builds on the previous.\n' +
      '- Lesson titles are specific and concrete (avoid bare titles like "Introduction").\n' +
      '- Objectives are measurable ("Explain...", "Build...", "Compare...").\n' +
      "- Cover the learner's goal end to end. If they name a concrete outcome (for example building something), the final modules must deliver it.\n" +
      (i.flags.projects ? '- Plan for a practical project at the end of modules where it makes sense.\n' : '') +
      "- Write in the same language as the learner's request.\n\n" +
      'Return exactly this JSON shape:\n' +
      '{\n  "title": "string",\n  "subtitle": "string",\n  "description": "2-4 sentences on what the course covers and who it is for",\n' +
      '  "level": "Beginner | Intermediate | Advanced",\n  "objectives": ["5-8 strings"],\n  "prerequisites": ["0-4 strings"],\n' +
      '  "modules": [ { "title": "string", "description": "1-3 sentences", "lessons": [ { "title": "string", "summary": "one sentence" } ] } ],\n' +
      '  "exploreNext": [ { "title": "a topic to explore afterwards", "description": "why" } ]\n}'
    );
  }

  async function buildOutline(job, ctx) {
    const { data } = await callJSON(job, ctx, outlinePrompt(job), { temperature: 0.6, maxTokens: Math.min(12000, cur(ctx).provider.maxTokens || 12000) });
    const o = S.schema.normalizeOutline(data);
    o.modules = o.modules.slice(0, job.plan.modules).map((m) => Object.assign({}, m, { lessons: m.lessons.slice(0, job.plan.lessonsPerModule) }));
    if (o.modules.length < job.plan.modules) job.warnings.push('The AI planned ' + o.modules.length + ' modules instead of ' + job.plan.modules + '.');
    job.writing.total = o.modules.length;
    return o;
  }

  /* ---------- 2. references (grounded web search) ---------- */
  const normDomain = (s) => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  const domainLike = (s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(s || '').trim());

  function parseRefLines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.replace(/^[\s\-*•\d.)]+/, '').replace(/\*\*/g, '').trim())
      .filter((l) => l.includes('|'))
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter((p) => p.length >= 2 && p[0] && !/^title$/i.test(p[0]))
      .map((p) => ({ title: p[0].slice(0, 160), website: normDomain(p[1]), description: (p[2] || '').slice(0, 300) }));
  }

  async function gatherRefs(job, ctx) {
    const o = job.outline;
    const prompt =
      'Use Google Search to find high-quality web pages for someone learning: "' + o.title + '" (' + o.description + ').\n' +
      'Topics covered: ' + o.modules.map((m) => m.title).join('; ') + '.\n\n' +
      'Find 6 to 10 different, authoritative, freely readable resources (official documentation, university course pages, reputable tutorials, encyclopedias). ' +
      'Reply ONLY with a list, one resource per line, in exactly this format:\n' +
      'Title | website domain | one sentence on what the reader will find there\n' +
      'Only list resources that actually appeared in your search results.';
    const sc = ctx.searchCtx;
    const r = await sc.provider.searchWeb({
      apiKey: sc.apiKey, model: sc.model, prompt, signal: ctx.signal,
      onNotice: (n) => { job.notice = n; ctx.onUpdate(job); },
    });
    job.notice = '';
    const items = parseRefLines(r.text);
    const used = new Set();
    const verified = [];
    const suggested = [];
    const chunkDomain = (c) => (domainLike(c.title) ? normDomain(c.title) : '');

    items.forEach((it) => {
      const k = r.chunks.findIndex((c, idx) => {
        if (used.has(idx)) return false;
        const cd = chunkDomain(c);
        if (cd && it.website && (cd === it.website || cd.endsWith('.' + it.website) || it.website.endsWith('.' + cd))) return true;
        if (!cd && it.title && norm(c.title) && (norm(c.title).includes(norm(it.title)) || norm(it.title).includes(norm(c.title)))) return true;
        return false;
      });
      if (k >= 0) {
        used.add(k);
        const c = r.chunks[k];
        verified.push({ title: it.title, website: chunkDomain(c) || it.website, url: c.uri, description: it.description, verified: true, via: 'Google Search grounding' });
      } else {
        suggested.push({ title: it.title, description: (it.description + (it.website ? ' (' + it.website + ')' : '')).trim(), query: (it.title + ' ' + it.website).trim(), url: '' });
      }
    });
    // Sources the search actually returned but the list didn't mention.
    r.chunks.forEach((c, idx) => {
      if (used.has(idx) || verified.length >= 10) return;
      const sup = r.supports.find((s) => s.chunkIndices.includes(idx) && s.text);
      const dom = chunkDomain(c);
      verified.push({ title: dom || c.title, website: dom, url: c.uri, description: sup ? sup.text.slice(0, 200) : '', verified: true, via: 'Google Search grounding' });
    });
    return { verified: verified.filter((v) => isHttpUrl(v.url)).slice(0, 10), suggested: suggested.slice(0, 8) };
  }

  /* ---------- 3. lessons ---------- */
  function modulePrompt(job, mi, idxs, wantProject) {
    const o = job.outline, i = job.input, p = job.plan, f = i.flags;
    const mod = o.modules[mi];
    const map = o.modules.map((m, k) => (k + 1) + '. ' + m.title + ' — ' + m.lessons.map((l) => l.title).join(' | ')).join('\n');
    const todo = idxs.map((k) => '- Lesson ' + (mi + 1) + '.' + (k + 1) + ' "' + mod.lessons[k].title + '": ' + mod.lessons[k].summary).join('\n');
    const refs = job.refs.length ? job.refs.map((r, k) => '[' + k + '] ' + r.title + (r.website ? ' (' + r.website + ')' : '') + (r.description ? ' — ' + r.description : '')).join('\n') : '(none available)';
    const lessonShape =
      '    {\n      "title": "exactly the lesson title given",\n      "content": "Markdown, about ' + p.words + ' words",\n' +
      '      "keyPoints": ["3-5 short takeaways"],\n' +
      '      "examples": ' + (f.examples ? '[ { "title": "string", "body": "Markdown; a worked, concrete example" } ]  (1-2 examples)' : '[]') + ',\n' +
      '      "exercise": { "prompt": "a practical task the learner can do", "hint": "a nudge, not the answer" },\n' +
      '      "reflection": ["1-2 questions that make the learner think"],\n' +
      '      "quiz": ' + (f.quizzes ? '{ "questions": [ { "question": "string", "options": ["4 options"], "answerIndex": 0, "explanation": "why it is right" } ] }  (' + p.questions + ' questions testing understanding, not trivia; vary the correct position)' : '{ "questions": [] }') + ',\n' +
      '      "images": ' + (f.images ? '[ 0-2 image objects, see IMAGES below ]' : '[]') + ',\n' +
      '      "sourceRefs": [indexes from REFERENCES that genuinely support this lesson; [] if none]\n    }';
    return (
      'Write the lessons for one module of a course.\n\n' +
      'COURSE: ' + o.title + ' — ' + o.description + '\n' +
      'Level: ' + i.level + ' ' + (LEVEL_GUIDE[i.level] || '') + '\n' +
      'Learning style: ' + i.style + ' ' + (STYLE_GUIDE[i.style] || '') + '\n' +
      "Learner's original request: " + JSON.stringify(i.topic.slice(0, 600)) + '\n\n' +
      'FULL CURRICULUM (for continuity; do not repeat material from earlier modules, and do not jump ahead):\n' + map + '\n\n' +
      'THIS MODULE: ' + (mi + 1) + '. ' + mod.title + ' — ' + mod.description + '\n' +
      'WRITE THESE LESSONS, in this order:\n' + todo + '\n\n' +
      'REFERENCES you may cite by index (never invent others, never write URLs):\n' + refs + '\n\n' +
      'Quality rules:\n' +
      '- Teach for real: explain the why, define terms when first used, give concrete numbers, names and worked examples. No filler, no "in this lesson we will", no closing pep talks.\n' +
      '- Match the level. Build on what earlier lessons established and keep terminology consistent.\n' +
      "- Use the same language as the learner's request.\n" +
      '- Include a table, code block or equation only where it genuinely helps.\n' +
      '- ' + MD_RULES + '\n' +
      (f.images ? '\nIMAGES:\n' + DIAGRAM_SPEC + '\n' : '') +
      '\nReturn exactly this JSON shape:\n{\n  "lessons": [\n' + lessonShape + '\n  ],\n' +
      '  "project": ' + (f.projects && wantProject
        ? '{ "title": "string", "brief": "Markdown-free paragraph: what the learner builds and why", "steps": ["5-8 concrete steps"], "deliverable": "what they should have at the end" }  (a practical project that applies this whole module)'
        : 'null') + '\n}'
    );
  }

  async function callModule(job, ctx, mi, idxs, wantProject) {
    const { data } = await callJSON(job, ctx, modulePrompt(job, mi, idxs, wantProject), { temperature: 0.7, maxTokens: cur(ctx).provider.maxTokens || 24000 });
    const rawLessons = Array.isArray(data) ? data : Array.isArray(data.lessons) ? data.lessons : data.title || data.content ? [data] : [];
    const mod = job.outline.modules[mi];
    const pool = rawLessons.slice();
    const lessons = [];
    idxs.forEach((k, pos) => {
      let at = pool.findIndex((r) => r && norm(r.title) === norm(mod.lessons[k].title));
      if (at < 0) at = pool.findIndex(Boolean);
      const raw = at >= 0 ? pool.splice(at, 1)[0] : null;
      const n = raw ? S.schema.normalizeLesson(raw, mod.lessons[k].title, job.refs) : null;
      if (n) {
        n.title = mod.lessons[k].title;
        n.summary = n.summary || mod.lessons[k].summary;
        if (!job.input.flags.quizzes) n.quiz = { questions: [] };
        if (!job.input.flags.images) n.images = [];
        if (!job.input.flags.examples) n.examples = [];
      }
      lessons.push(n);
    });
    return { lessons, project: job.input.flags.projects ? S.schema.normalizeProject(data && data.project) : null };
  }

  const RECOVERABLE = ['malformed', 'schema', 'empty', 'too_large'];

  async function writeModule(job, ctx, mi) {
    const mod = job.outline.modules[mi];
    const all = mod.lessons.map((_, k) => k);
    let lessons = new Array(all.length).fill(null);
    let project = null;
    // Providers with small per-minute budgets (perLesson) skip the big whole-module request.
    if (!cur(ctx).provider.perLesson) {
      try {
        const r = await callModule(job, ctx, mi, all, true);
        lessons = r.lessons;
        project = r.project;
      } catch (e) {
        if (!RECOVERABLE.includes(e.code)) throw e;
      }
    }
    // Anything missing or cut off is regenerated one lesson at a time.
    for (const k of all) {
      if (lessons[k]) continue;
      job.writing.current = mod.title + ' — ' + mod.lessons[k].title;
      ctx.onUpdate(job);
      try {
        const r = await callModule(job, ctx, mi, [k], !project && k === all[all.length - 1]);
        lessons[k] = r.lessons[0] || null;
        project = project || r.project;
      } catch (e) {
        if (!RECOVERABLE.includes(e.code)) throw e;
      }
    }
    const done = lessons.filter(Boolean);
    if (!done.length) throw new SynapseError('schema', 'Module ' + (mi + 1) + ' could not be written.', { retryable: true, hint: 'Resume to try this module again.' });
    if (done.length < all.length) job.warnings.push('Module ' + (mi + 1) + ' is missing ' + (all.length - done.length) + ' lesson(s) the AI could not produce.');
    return { lessons: done, project };
  }

  /* ---------- run ---------- */
  async function run(job, ctx) {
    const emit = () => ctx.onUpdate(job);
    job.status = 'running';
    job.error = null;
    job.notice = '';
    ctx.chainIndex = Math.min(job.chainIndex || 0, ctx.chain.length - 1);
    let active = null;
    const mark = (id, status, detail) => { active = id; setStep(job, id, status, detail); emit(); };
    try {
      if (!job.outline) {
        mark('outline', 'active');
        job.outline = await buildOutline(job, ctx);
        setStep(job, 'outline', 'done');
      }

      if (!job.refsDone) {
        if (job.input.flags.references && ctx.searchCtx) {
          mark('refs', 'active');
          try {
            const r = await gatherRefs(job, ctx);
            job.refs = r.verified;
            job.suggested = r.suggested;
            setStep(job, 'refs', 'done', r.verified.length + ' verified');
          } catch (e) {
            if (['aborted', 'invalid_key', 'missing_key'].includes(e.code)) throw e;
            job.warnings.push("Web references couldn't be verified, so they are listed as suggested topics only.");
            setStep(job, 'refs', 'done', 'unavailable');
          }
        } else if (job.input.flags.references) {
          setStep(job, 'refs', 'done', 'unavailable');
        }
        if (job.input.flags.references) {
          job.suggested = job.suggested.concat(job.outline.exploreNext.map((t) => ({ title: t.title, description: t.description, query: t.title, url: '' })));
        }
        job.refsDone = true;
      }

      mark('lessons', 'active');
      for (let mi = 0; mi < job.outline.modules.length; mi++) {
        if (job.modules[mi]) continue;
        job.writing.current = job.outline.modules[mi].title;
        emit();
        job.modules[mi] = await writeModule(job, ctx, mi);
        job.writing.done = job.modules.filter(Boolean).length;
        emit();
      }
      job.writing.current = '';
      setStep(job, 'lessons', 'done');

      mark('finish', 'active');
      const o = job.outline;
      const course = S.schema.normalizeCourse({
        title: o.title, subtitle: o.subtitle, description: o.description,
        level: o.level || job.input.level, objectives: o.objectives, prerequisites: o.prerequisites,
        modules: o.modules.map((m, i) => ({ title: m.title, description: m.description, lessons: job.modules[i].lessons, project: job.modules[i].project })),
        references: job.refs,
        suggestedTopics: job.suggested,
        meta: {
          topic: job.input.topic, provider: ctx.chain[0].provider.id, model: ctx.chain[0].model || ctx.chain[0].provider.defaultModel,
          usedFallback: ctx.chainIndex > 0, generatedAt: Date.now(),
          preferences: { level: job.input.level, depth: job.input.depth, style: job.input.style, modules: job.input.modules },
        },
      });
      setStep(job, 'finish', 'pending');

      if (job.input.flags.images && step(job, 'images').status !== 'done') {
        mark('images', 'active');
        try {
          const res = await S.images.resolveCourse(course, {
            signal: ctx.signal,
            onProgress: (d, t) => { job.imageProgress = { done: d, total: t }; emit(); },
          });
          setStep(job, 'images', 'done', res.requested ? res.found + ' of ' + res.requested + ' photos found' : undefined);
        } catch (e) {
          if (e.code === 'aborted') throw e;
          setStep(job, 'images', 'done', 'skipped');
        }
      }
      mark('finish', 'active');
      job.course = course;
      setStep(job, 'finish', 'done');
      job.status = 'done';
      emit();
      return course;
    } catch (e) {
      job.status = e.code === 'aborted' ? 'aborted' : 'error';
      job.error = e instanceof SynapseError ? e : new SynapseError('unknown', 'Something went wrong while generating the course.', { retryable: true, cause: e, hint: String(e && e.message || '').slice(0, 200) });
      if (active) setStep(job, active, job.status === 'aborted' ? 'pending' : 'error');
      emit();
      throw job.error;
    }
  }

  S.generator = { createJob, run, DEPTH };
})();
