/* Synapse · stats.js
   Streaks, XP, levels and achievements — entirely local, derived from courses you've already
   generated. Nothing here ever calls an AI provider, so using it never touches your API quota.

   Data shape (localStorage 'synapse.stats'):
     { xp, streak: {current, best, lastDate}, activeDates: {'YYYY-MM-DD': count},
       totals: {lessonsCompleted, projectsCompleted, coursesCompleted, quizzesTaken,
                correctAnswers, perfectQuizzes, nightOwlDone, earlyBirdDone, maxLessonsInDay},
       unlocked: {achievementId: timestamp} } */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});

  const KEY = 'synapse.stats';
  const HISTORY_DAYS = 371; // a bit over a year of heatmap history

  const DEFAULTS = () => ({
    xp: 0,
    streak: { current: 0, best: 0, lastDate: '' },
    activeDates: {},
    totals: {
      lessonsCompleted: 0, projectsCompleted: 0, coursesCompleted: 0,
      quizzesTaken: 0, correctAnswers: 0, perfectQuizzes: 0,
      nightOwlDone: false, earlyBirdDone: false, maxLessonsInDay: 0,
      nightOwlCount: 0, cardsSaved: 0,
    },
    unlocked: {},
  });

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw) return DEFAULTS();
      const d = DEFAULTS();
      return {
        xp: Number(raw.xp) || 0,
        streak: Object.assign(d.streak, raw.streak),
        activeDates: raw.activeDates && typeof raw.activeDates === 'object' ? raw.activeDates : {},
        totals: Object.assign(d.totals, raw.totals),
        unlocked: raw.unlocked && typeof raw.unlocked === 'object' ? raw.unlocked : {},
      };
    } catch (e) {
      return DEFAULTS();
    }
  }

  function save(stats) {
    // Prune very old heatmap entries so localStorage doesn't grow forever.
    const cutoff = dateKey(new Date(Date.now() - HISTORY_DAYS * 86400000));
    Object.keys(stats.activeDates).forEach((k) => { if (k < cutoff) delete stats.activeDates[k]; });
    try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) { /* best-effort */ }
    return stats;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

  /* ---------- levels ---------- */
  // Each level costs a bit more than the last: level n needs 100 + (n-1)*40 XP beyond the previous one.
  function levelFromXp(xp) {
    let level = 1, need = 100, total = 0;
    while (xp >= total + need) {
      total += need;
      level += 1;
      need = 100 + (level - 1) * 40;
    }
    return { level, xpIntoLevel: xp - total, xpForNext: need, totalXp: xp };
  }

  /* ---------- achievements ---------- */
  const ACHIEVEMENTS = [
    { id: 'first_lesson', icon: '📘', title: 'First Steps', desc: 'Complete your first lesson.', test: (s) => s.totals.lessonsCompleted >= 1 },
    { id: 'five_lessons', icon: '📗', title: 'Getting Somewhere', desc: 'Complete 5 lessons.', test: (s) => s.totals.lessonsCompleted >= 5 },
    { id: 'twentyfive_lessons', icon: '📚', title: 'Bookworm', desc: 'Complete 25 lessons.', test: (s) => s.totals.lessonsCompleted >= 25 },
    { id: 'first_project', icon: '🛠️', title: 'Builder', desc: 'Complete your first project.', test: (s) => s.totals.projectsCompleted >= 1 },
    { id: 'first_course', icon: '🎓', title: 'Graduate', desc: 'Finish your first course.', test: (s) => s.totals.coursesCompleted >= 1 },
    { id: 'three_courses', icon: '🏛️', title: 'Lifelong Learner', desc: 'Finish 3 courses.', test: (s) => s.totals.coursesCompleted >= 3 },
    { id: 'streak_3', icon: '🔥', title: 'On a Roll', desc: 'Reach a 3-day study streak.', test: (s) => s.streak.best >= 3 },
    { id: 'streak_7', icon: '🔥', title: 'Committed', desc: 'Reach a 7-day study streak.', test: (s) => s.streak.best >= 7 },
    { id: 'streak_30', icon: '💎', title: 'Unstoppable', desc: 'Reach a 30-day study streak.', test: (s) => s.streak.best >= 30 },
    { id: 'quiz_perfect', icon: '🎯', title: 'Sharp Shooter', desc: 'Score perfectly on a quiz.', test: (s) => s.totals.perfectQuizzes >= 1 },
    { id: 'quiz_master', icon: '🧠', title: 'Quiz Master', desc: 'Answer 50 quiz questions correctly.', test: (s) => s.totals.correctAnswers >= 50 },
    { id: 'night_owl', icon: '🦉', title: 'Night Owl', desc: 'Complete a lesson between midnight and 4am.', test: (s) => s.totals.nightOwlDone },
    { id: 'early_bird', icon: '🐦', title: 'Early Bird', desc: 'Complete a lesson before 7am.', test: (s) => s.totals.earlyBirdDone },
    { id: 'speed_runner', icon: '⚡', title: 'Speed Runner', desc: 'Complete 5 lessons in a single day.', test: (s) => s.totals.maxLessonsInDay >= 5 },
    { id: 'explorer', icon: '🧭', title: 'Explorer', desc: 'Save 3 different courses.', test: (s, extra) => !!extra && extra.savedCourseCount >= 3 },
    { id: 'night_shift', icon: '🌌', title: 'Night Shift', desc: 'Complete lessons after midnight on 3 different occasions.', secret: true, test: (s) => s.totals.nightOwlCount >= 3 },
    { id: 'collector', icon: '🗂️', title: 'Collector', desc: 'Save 5 fact or quote cards.', secret: true, test: (s) => s.totals.cardsSaved >= 5 },
  ];

  function checkAchievements(stats, extra) {
    const gained = [];
    ACHIEVEMENTS.forEach((a) => {
      if (stats.unlocked[a.id]) return;
      if (a.test(stats, extra)) {
        stats.unlocked[a.id] = Date.now();
        gained.push(a);
      }
    });
    return gained;
  }

  /* ---------- recording a completion ---------- */
  const XP = { lesson: 10, project: 25, course: 50, correctAnswer: 5, card: 5 };

  /**
   * kind: 'lesson' | 'project' | 'course'
   * quiz: { correct, total } — only for a lesson that had a quiz
   * extra: { savedCourseCount } — only needed to evaluate the 'explorer' achievement
   */
  function recordCompletion({ kind, quiz, extra }) {
    const stats = load();
    const now = new Date();
    const today = dateKey(now);
    const before = levelFromXp(stats.xp);

    // streak
    const last = stats.streak.lastDate;
    let isNewDay = false;
    if (last !== today) {
      isNewDay = true;
      stats.streak.current = last && daysBetween(last, today) === 1 ? stats.streak.current + 1 : 1;
      stats.streak.best = Math.max(stats.streak.best, stats.streak.current);
      stats.streak.lastDate = today;
    }
    stats.activeDates[today] = (stats.activeDates[today] || 0) + 1;

    // xp + totals
    let xpGained = 0;
    if (kind === 'lesson') {
      stats.totals.lessonsCompleted += 1;
      xpGained += XP.lesson;
      stats.totals.maxLessonsInDay = Math.max(stats.totals.maxLessonsInDay, stats.activeDates[today]);
      const hour = now.getHours();
      if (hour < 4) { stats.totals.nightOwlDone = true; stats.totals.nightOwlCount += 1; }
      else if (hour >= 5 && hour < 7) stats.totals.earlyBirdDone = true;
    } else if (kind === 'project') {
      stats.totals.projectsCompleted += 1;
      xpGained += XP.project;
    } else if (kind === 'course') {
      stats.totals.coursesCompleted += 1;
      xpGained += XP.course;
    }
    if (quiz && quiz.total > 0) {
      stats.totals.quizzesTaken += 1;
      stats.totals.correctAnswers += quiz.correct;
      xpGained += quiz.correct * XP.correctAnswer;
      if (quiz.correct === quiz.total) stats.totals.perfectQuizzes += 1;
    }
    stats.xp += xpGained;

    const newAchievements = checkAchievements(stats, extra);
    save(stats);
    const after = levelFromXp(stats.xp);
    return {
      xpGained, newAchievements, isNewDay,
      leveledUp: after.level > before.level, level: after.level,
      streak: Object.assign({}, stats.streak),
    };
  }

  /** A small, separate reward path for saving a fact/quote card — a few XP, no streak/day logic. */
  function recordCardSaved() {
    const stats = load();
    const before = levelFromXp(stats.xp);
    stats.totals.cardsSaved += 1;
    stats.xp += XP.card;
    const newAchievements = checkAchievements(stats);
    save(stats);
    const after = levelFromXp(stats.xp);
    return { xpGained: XP.card, newAchievements, leveledUp: after.level > before.level, level: after.level };
  }

  /** A round of pooled practice questions (Quick Quiz) — same scoring as a lesson quiz, without
      touching the streak or lesson/course totals, since no lesson was actually completed. */
  function recordQuizRound({ correct, total }) {
    const stats = load();
    const before = levelFromXp(stats.xp);
    stats.totals.quizzesTaken += 1;
    stats.totals.correctAnswers += correct;
    const xpGained = correct * XP.correctAnswer;
    if (total > 0 && correct === total) stats.totals.perfectQuizzes += 1;
    stats.xp += xpGained;
    const newAchievements = checkAchievements(stats);
    save(stats);
    const after = levelFromXp(stats.xp);
    return { xpGained, newAchievements, leveledUp: after.level > before.level, level: after.level };
  }

  /* ---------- reading ---------- */
  function heatmapDays(n) {
    n = n || 84;
    const stats = load();
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const k = dateKey(d);
      out.push({ date: k, count: stats.activeDates[k] || 0, weekday: d.getDay() });
    }
    return out;
  }

  function summary() {
    const stats = load();
    const level = levelFromXp(stats.xp);
    // A streak "counts" as still active through the day after last activity (so it doesn't
    // look broken the moment you wake up before studying).
    const today = dateKey(new Date());
    const current = stats.streak.lastDate && daysBetween(stats.streak.lastDate, today) <= 1 ? stats.streak.current : 0;
    return {
      xp: stats.xp, level: level.level, xpIntoLevel: level.xpIntoLevel, xpForNext: level.xpForNext,
      streakCurrent: current, streakBest: stats.streak.best,
      totals: Object.assign({}, stats.totals),
      unlockedIds: Object.keys(stats.unlocked),
      unlocked: stats.unlocked,
    };
  }

  function achievementsList() {
    const stats = load();
    return ACHIEVEMENTS.map((a) => Object.assign({}, a, { unlockedAt: stats.unlocked[a.id] || null }));
  }

  S.stats = { load, save, levelFromXp, recordCompletion, recordCardSaved, recordQuizRound, heatmapDays, summary, achievementsList, ACHIEVEMENTS, dateKey };
})();
