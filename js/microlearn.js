/* Synapse · microlearn.js
   Two bite-sized study tools built entirely from courses already sitting in the library:
     - flashcards: one lesson's key points, front (lesson title) / back (a point)
     - quick quiz: quiz questions pooled from every saved course, shuffled together
   Nothing here reads the network or calls an AI — it only reshapes data the learner already has. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function loadCourses(limit) {
    const summaries = await S.store.courses.list();
    const recs = await Promise.all(summaries.slice(0, limit || 20).map((s) => S.store.courses.get(s.id)));
    return recs.filter(Boolean).map((r) => {
      try {
        return { id: r.id, course: S.schema.normalizeCourse(r.course) };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }

  /** One card per key point, across every saved course. */
  async function flashcardDeck(opts) {
    opts = opts || {};
    const recs = await loadCourses();
    const cards = [];
    recs.forEach(({ id, course }) => {
      course.modules.forEach((m) => {
        m.lessons.forEach((l) => {
          l.keyPoints.forEach((point) => {
            cards.push({
              courseId: id, courseTitle: course.title, moduleTitle: m.title, lessonTitle: l.title,
              front: l.title, back: point,
            });
          });
        });
      });
    });
    return { cards: opts.shuffled === false ? cards : shuffle(cards), courseCount: recs.length };
  }

  /** One entry per quiz question, across every saved course, each remembering which course/lesson it's from. */
  async function quizPool(opts) {
    opts = opts || {};
    const recs = await loadCourses();
    const items = [];
    recs.forEach(({ id, course }) => {
      course.modules.forEach((m) => {
        m.lessons.forEach((l) => {
          l.quiz.questions.forEach((q) => {
            items.push({
              courseId: id, courseTitle: course.title, lessonTitle: l.title,
              question: q.question, options: q.options, answerIndex: q.answerIndex, explanation: q.explanation,
            });
          });
        });
      });
    });
    return { items: opts.shuffled === false ? items : shuffle(items), courseCount: recs.length };
  }

  S.microlearn = { flashcardDeck, quizPool, shuffle };
})();
