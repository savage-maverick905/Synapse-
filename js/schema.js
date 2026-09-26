/* Synapse · schema.js
   Everything the AI returns passes through here before it is rendered or saved.
   - parseModelJSON():  recovers JSON from fenced / truncated / slightly broken output
   - normalizeOutline(), normalizeLessons(): validate one generation step
   - normalizeCourse():  the final, canonical course object
   Nothing here trusts the model: URLs, "verified" flags and image sources are
   only kept when the app itself has established them. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { SynapseError, countWords, isHttpUrl, readingMinutes, fmtDuration } = S.util;

  const SCHEMA_VERSION = 1;
  const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
  const text = (v, max) => {
    if (v == null) return '';
    if (typeof v === 'object') v = v.text || v.content || v.body || v.value || '';
    return String(v).trim().slice(0, max || 20000);
  };
  const strList = (v, maxItems, maxLen) =>
    arr(v).map((x) => text(x, maxLen || 400)).filter(Boolean).slice(0, maxItems || 20);

  /* ---------- JSON recovery ---------- */
  function extractJson(raw) {
    let s = String(raw == null ? '' : raw).trim();
    s = s.replace(/^\uFEFF/, '');
    const fence = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(s);
    if (fence && fence[1].trim().startsWith('{')) s = fence[1].trim();
    const start = s.indexOf('{');
    if (start < 0) return '';
    return s.slice(start);
  }

  /** Walks the text once: escapes raw control characters inside strings, drops trailing
      commas, and closes anything left open by a truncated response. */
  function repairJson(s) {
    let out = '';
    const stack = [];
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) { out += c; esc = false; continue; }
        if (c === '\\') { out += c; esc = true; continue; }
        if (c === '"') {
          // A quote inside a string is the end only if followed by a structural char.
          let j = i + 1;
          while (j < s.length && /\s/.test(s[j])) j++;
          const nx = s[j];
          if (nx === undefined || nx === ',' || nx === '}' || nx === ']' || nx === ':') { inStr = false; out += c; }
          else out += '\\"';
          continue;
        }
        if (c === '\n') { out += '\\n'; continue; }
        if (c === '\r') continue;
        if (c === '\t') { out += '\\t'; continue; }
        if (c < ' ') continue;
        out += c;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); out += c; continue; }
      if (c === '}' || c === ']') {
        out = out.replace(/,\s*$/, '');
        if (stack.length && stack[stack.length - 1] === c) stack.pop();
        out += c;
        if (!stack.length) break;
        continue;
      }
      out += c;
    }
    if (inStr) out += '"';
    out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
    // A dangling key with no value, e.g. {"a": 1, "b"
    out = out.replace(/,\s*"[^"]*"\s*$/, '');
    while (stack.length) out += stack.pop();
    return out.replace(/,(\s*[}\]])/g, '$1');
  }

  function parseModelJSON(raw) {
    const s = extractJson(raw);
    if (!s) throw new SynapseError('malformed', 'The AI reply did not contain any course data.', { retryable: true });
    try {
      return { data: JSON.parse(s), repaired: false };
    } catch (e) {
      /* fall through to repair */
    }
    try {
      return { data: JSON.parse(repairJson(s)), repaired: true };
    } catch (e) {
      throw new SynapseError('malformed', 'The AI reply could not be read as course data.', { retryable: true, cause: e });
    }
  }

  /* ---------- pieces ---------- */
  function normalizeQuiz(q) {
    const raw = Array.isArray(q) ? q : q && Array.isArray(q.questions) ? q.questions : [];
    const questions = [];
    raw.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const question = text(item.question || item.prompt || item.q, 500);
      let options = arr(item.options || item.choices || item.answers).map((o) => text(o, 300).replace(/^[A-Da-d][).]\s+/, '')).filter(Boolean).slice(0, 6);
      if (!question || options.length < 2) return;
      let idx = item.answerIndex != null ? item.answerIndex : item.correctIndex != null ? item.correctIndex : item.correct != null ? item.correct : item.answer;
      if (typeof idx === 'string') {
        const t = idx.trim();
        if (/^[A-Fa-f]$/.test(t)) idx = t.toUpperCase().charCodeAt(0) - 65;
        else if (/^\d+$/.test(t)) idx = +t;
        else idx = options.findIndex((o) => o.toLowerCase() === t.toLowerCase());
      }
      idx = Number(idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return;
      questions.push({ question, options, answerIndex: idx, explanation: text(item.explanation || item.rationale, 600) });
    });
    return { questions: questions.slice(0, 8) };
  }

  function normalizeImage(img) {
    if (!img || typeof img !== 'object') return null;
    const type = String(img.type || (img.diagram ? 'diagram' : img.searchQuery || img.url ? 'photo' : 'diagram')).toLowerCase();
    const description = text(img.description || img.alt, 400);
    const caption = text(img.caption || img.description, 300);
    if (type === 'diagram' || type === 'svg' || type === 'illustration') {
      const spec = S.diagrams.clean(img.diagram || img.spec || img);
      if (!spec) return null;
      return { type: 'diagram', description: description || caption || 'Diagram', caption: caption || description, diagram: spec };
    }
    // photo: needs either a search query (resolved later) or an already-resolved, attributed image
    const url = isHttpUrl(img.url) ? String(img.url) : '';
    const query = text(img.searchQuery || img.query, 120);
    const out = {
      type: 'photo',
      description: description || caption || 'Photograph',
      caption: caption || description,
      searchQuery: query,
      url: url,
      dataUrl: typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:image/') ? img.dataUrl : '',
      attribution: text(img.attribution || img.credit, 500),
      license: text(img.license, 80),
      sourceUrl: isHttpUrl(img.sourceUrl) ? String(img.sourceUrl) : '',
    };
    if (!out.dataUrl && !out.searchQuery && !out.url) return null;
    return out;
  }

  function normalizeExamples(v) {
    return arr(v)
      .map((e, i) => {
        if (typeof e === 'string') return { title: 'Example ' + (i + 1), body: e.trim() };
        if (!e || typeof e !== 'object') return null;
        const body = text(e.body || e.content || e.description || e.text, 4000);
        return body ? { title: text(e.title || e.name, 120) || 'Example ' + (i + 1), body } : null;
      })
      .filter(Boolean)
      .slice(0, 5);
  }

  function normalizeExercise(v) {
    if (!v) return null;
    if (typeof v === 'string') return v.trim() ? { prompt: v.trim().slice(0, 3000), hint: '' } : null;
    if (typeof v === 'object') {
      const prompt = text(v.prompt || v.task || v.question || v.instructions || v.description, 3000);
      return prompt ? { prompt, hint: text(v.hint || v.solutionHint, 1200) } : null;
    }
    return null;
  }

  function normalizeProject(p) {
    if (!p || typeof p !== 'object') return null;
    const title = text(p.title, 160);
    const brief = text(p.brief || p.description || p.overview, 3000);
    if (!title || !brief) return null;
    return { title, brief, steps: strList(p.steps, 14, 500), deliverable: text(p.deliverable || p.outcome, 500) };
  }

  /** `refs` = the course's verified references; the model only picks indexes into it. */
  function normalizeLesson(raw, fallbackTitle, refs) {
    if (!raw || typeof raw !== 'object') return null;
    const content = text(raw.content || raw.body || raw.text, 40000);
    if (countWords(content) < 25) return null;
    const sources = [];
    arr(raw.sourceRefs).forEach((i) => {
      const r = refs && refs[Number(i)];
      if (r && !sources.includes(r)) sources.push(r);
    });
    return {
      title: text(raw.title, 160) || fallbackTitle || 'Lesson',
      summary: text(raw.summary, 400),
      content,
      keyPoints: strList(raw.keyPoints || raw.takeaways, 8, 300),
      examples: normalizeExamples(raw.examples),
      exercise: normalizeExercise(raw.exercise),
      reflection: strList(raw.reflection || raw.reflectionQuestions, 4, 400),
      quiz: normalizeQuiz(raw.quiz),
      images: arr(raw.images).map(normalizeImage).filter(Boolean).slice(0, 3),
      sources: sources.map((r) => ({ title: r.title, website: r.website, url: r.url, description: r.description })),
    };
  }

  /* ---------- outline (step 1 of generation) ---------- */
  function normalizeOutline(raw) {
    if (!raw || typeof raw !== 'object') throw new SynapseError('schema', 'The AI returned an empty curriculum.', { retryable: true });
    const modules = arr(raw.modules)
      .map((m) => {
        if (!m || typeof m !== 'object') return null;
        const lessons = arr(m.lessons)
          .map((l) => (typeof l === 'string' ? { title: l, summary: '' } : l && typeof l === 'object' ? { title: text(l.title, 160), summary: text(l.summary || l.description, 400) } : null))
          .filter((l) => l && l.title);
        const title = text(m.title, 160);
        return title && lessons.length ? { title, description: text(m.description, 600), lessons } : null;
      })
      .filter(Boolean);
    if (!modules.length) throw new SynapseError('schema', 'The AI returned a curriculum with no modules.', { retryable: true });
    return {
      title: text(raw.title, 200) || 'Untitled course',
      subtitle: text(raw.subtitle, 300),
      description: text(raw.description, 1500),
      level: text(raw.level, 40),
      objectives: strList(raw.objectives, 10, 300),
      prerequisites: strList(raw.prerequisites, 8, 300),
      exploreNext: arr(raw.exploreNext || raw.suggestedTopics)
        .map((t) => (typeof t === 'string' ? { title: t, description: '' } : t && typeof t === 'object' ? { title: text(t.title, 140), description: text(t.description || t.why, 300) } : null))
        .filter((t) => t && t.title)
        .slice(0, 8),
      modules,
    };
  }

  /* ---------- final course ---------- */
  function normalizeReferences(list) {
    return arr(list)
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const url = isHttpUrl(r.url) ? String(r.url) : '';
        const title = text(r.title, 200) || S.util.hostOf(url);
        if (!title) return null;
        return {
          title,
          website: text(r.website, 120) || S.util.hostOf(url),
          url,
          description: text(r.description, 400),
          verified: r.verified === true && !!url,
          via: text(r.via, 60),
        };
      })
      .filter(Boolean)
      .slice(0, 40);
  }

  function normalizeCourse(raw, opts) {
    opts = opts || {};
    if (!raw || typeof raw !== 'object') throw new SynapseError('schema', 'This course data is not valid.');
    const modules = arr(raw.modules)
      .map((m, mi) => {
        if (!m || typeof m !== 'object') return null;
        const lessons = arr(m.lessons)
          .map((l, li) => {
            const n = normalizeLesson(l, 'Lesson ' + (li + 1), []);
            if (!n) return null;
            // Sources are only ever links the app itself attached (verified references).
            if (l && Array.isArray(l.sources)) {
              n.sources = l.sources
                .filter((s) => s && isHttpUrl(s.url))
                .map((s) => ({ title: text(s.title, 200), website: text(s.website, 120), url: String(s.url), description: text(s.description, 300) }));
            }
            return n;
          })
          .filter(Boolean);
        if (!lessons.length) return null;
        lessons.forEach((l, li) => { l.id = 'm' + (mi + 1) + '-l' + (li + 1); });
        return { id: 'm' + (mi + 1), title: text(m.title, 160) || 'Module ' + (mi + 1), description: text(m.description, 800), lessons, project: normalizeProject(m.project) };
      })
      .filter(Boolean);
    if (!modules.length) throw new SynapseError('schema', 'This course has no readable lessons.');
    modules.forEach((m, i) => { m.id = 'm' + (i + 1); m.lessons.forEach((l, j) => { l.id = 'm' + (i + 1) + '-l' + (j + 1); }); });

    const course = {
      schemaVersion: SCHEMA_VERSION,
      title: text(raw.title, 200) || 'Untitled course',
      subtitle: text(raw.subtitle, 300),
      description: text(raw.description, 1500),
      level: text(raw.level, 40) || 'All levels',
      estimatedTime: text(raw.estimatedTime, 60),
      objectives: strList(raw.objectives, 12, 300),
      prerequisites: strList(raw.prerequisites, 8, 300),
      modules,
      references: normalizeReferences(raw.references),
      suggestedTopics: arr(raw.suggestedTopics)
        .map((t) => (t && typeof t === 'object' ? { title: text(t.title, 160), description: text(t.description, 300), query: text(t.query, 160), url: isHttpUrl(t.url) ? String(t.url) : '' } : null))
        .filter((t) => t && t.title)
        .slice(0, 12),
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    };
    const st = stats(course);
    if (!course.estimatedTime) course.estimatedTime = st.durationLabel;
    return course;
  }

  /* ---------- stats ---------- */
  function lessonWords(l) {
    return (
      countWords(l.content) +
      l.keyPoints.reduce((s, k) => s + countWords(k), 0) +
      l.examples.reduce((s, e) => s + countWords(e.body), 0) +
      (l.exercise ? countWords(l.exercise.prompt) : 0)
    );
  }

  function lessonMinutes(l) {
    return readingMinutes(lessonWords(l)) + (l.exercise ? 5 : 0) + (l.quiz.questions.length ? Math.ceil(l.quiz.questions.length * 0.6) : 0);
  }

  function stats(course) {
    let lessons = 0, words = 0, minutes = 0, projects = 0, quizzes = 0, images = 0;
    course.modules.forEach((m) => {
      m.lessons.forEach((l) => {
        lessons++;
        words += lessonWords(l);
        minutes += lessonMinutes(l);
        quizzes += l.quiz.questions.length;
        images += l.images.length;
      });
      if (m.project) { projects++; minutes += 25; words += countWords(m.project.brief); }
    });
    return { modules: course.modules.length, lessons, words, minutes, projects, quizzes, images, durationLabel: 'About ' + fmtDuration(minutes), pagesEstimate: Math.round(words / 260 + lessons * 1.3 + course.modules.length * 1.5 + 6) };
  }

  S.schema = {
    SCHEMA_VERSION, parseModelJSON, repairJson, extractJson,
    normalizeOutline, normalizeLesson, normalizeQuiz, normalizeProject, normalizeReferences, normalizeCourse,
    stats, lessonMinutes, lessonWords,
  };
})();
