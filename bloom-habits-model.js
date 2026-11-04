/* Personal practice and smoking estimates. Scheduling scores are heuristics. */
(function (root) {
  'use strict';
  const CATEGORIES = Object.freeze([
    { key: 'piano', label: 'Piano', icon: '🎹', memory_type: 'procedural' },
    { key: 'sewing', label: 'Sewing', icon: '🧵', memory_type: 'procedural' },
    { key: 'math', label: 'Math', icon: '🧮', memory_type: 'knowledge' },
    { key: 'language', label: 'Language', icon: '🇪🇸', memory_type: 'knowledge' },
    { key: 'reading', label: 'Reading', icon: '📖', memory_type: 'knowledge' },
    { key: 'science', label: 'Science', icon: '🧪', memory_type: 'knowledge' },
    { key: 'cooking', label: 'Cooking', icon: '👩🏾‍🍳', memory_type: 'mixed' },
    { key: 'engineering', label: 'Engineering', icon: '⚙️', memory_type: 'mixed' },
    { key: 'writing', label: 'Writing', icon: '✍🏾', memory_type: 'mixed' },
    { key: 'painting', label: 'Painting', icon: '🖌️', memory_type: 'procedural' },
    { key: 'animation', label: 'Animation', icon: '🎞️', memory_type: 'mixed' },
    { key: 'me', label: 'Me', icon: '💛', memory_type: 'mixed' }
  ]);
  const REVIEW_INTERVALS = Object.freeze([1, 3, 7, 14, 30, 60, 90, 180]);
  const REVIEW_RESULTS = Object.freeze([
    { key: 'practice', label: 'Practice only · no recall check' },
    { key: 'again', label: 'Try again · I could not recall or perform it' },
    { key: 'hard', label: 'Hard · I needed help or several attempts' },
    { key: 'good', label: 'Good · I recalled or performed it' },
    { key: 'easy', label: 'Easy · I recalled or performed it confidently' }
  ]);
  const TRIGGERS = Object.freeze([
    { key: 'stress', label: 'Stress', icon: '⚡' },
    { key: 'boredom', label: 'Boredom', icon: '🛋️' },
    { key: 'habit', label: 'Habit', icon: '↻' },
    { key: 'other', label: 'Other', icon: '•••' }
  ]);
  function dateNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2200) return null;
    const time = Date.UTC(year, month - 1, day), date = new Date(time);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time / 86400000 : null;
  }
  function dayKey(date) {
    const value = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    if (!Number.isFinite(value.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const find = name => parts.find(part => part.type === name).value;
    return find('year') + '-' + find('month') + '-' + find('day');
  }
  function addDays(value, days) {
    const day = dateNumber(value);
    if (day == null || !Number.isInteger(days)) return null;
    const result = new Date((day + days) * 86400000).toISOString().slice(0, 10);
    return dateNumber(result) == null ? null : result;
  }
  function finite(value, minimum, maximum, integer) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= minimum && result <= maximum && (!integer || Number.isInteger(result)) ? result : null;
  }
  function category(key) { return CATEGORIES.find(item => item.key === key) || CATEGORIES[CATEGORIES.length - 1]; }
  function skillProgress(skill, sessions, asOf) {
    const today = typeof asOf === 'string' ? asOf : dayKey(asOf);
    const todayNumber = dateNumber(today);
    const history = (sessions || []).filter(row => row && !row.archived && !row.voided_at && !row.deleted && row.skill_id === skill.id && dateNumber(row.occurred_on) != null && (todayNumber == null || row.occurred_on <= today)).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id || '').localeCompare(String(b.id || '')));
    const byDate = new Map();
    for (const session of history) if (['again', 'hard', 'good', 'easy'].includes(session.result)) byDate.set(session.occurred_on, session);
    let step = -1, lastReview = null, successfulDays = 0;
    for (const session of byDate.values()) {
      if (session.result === 'again') step = 0;
      else if (session.result === 'hard') step = Math.max(0, step - 1);
      else { step = Math.min(REVIEW_INTERVALS.length - 1, step + (session.result === 'easy' ? 2 : 1)); successfulDays++; }
      lastReview = session;
    }
    const interval = lastReview ? REVIEW_INTERVALS[Math.max(0, step)] : null;
    const nextReviewOn = lastReview ? addDays(lastReview.occurred_on, interval) : null;
    const elapsed = lastReview && todayNumber != null ? Math.max(0, todayNumber - dateNumber(lastReview.occurred_on)) : null;
    const startingReadiness = lastReview ? lastReview.result === 'again' ? 0.25 : lastReview.result === 'hard' ? 0.75 : 1 : null;
    // 0.8 is a chosen scheduling target, not a fitted probability for this user.
    const readiness = elapsed == null ? null : Math.max(0, Math.min(1, startingReadiness * Math.pow(0.8, elapsed / interval)));
    const score = readiness == null ? null : Math.max(1, Math.min(10, 1 + Math.round(9 * readiness)));
    return {
      score, readiness, interval_days: interval, next_review_on: nextReviewOn,
      due: Boolean(nextReviewOn && todayNumber != null && nextReviewOn <= today),
      days_overdue: nextReviewOn && todayNumber != null ? Math.max(0, todayNumber - dateNumber(nextReviewOn)) : 0,
      last_review_on: lastReview && lastReview.occurred_on || null,
      last_result: lastReview && lastReview.result || null,
      last_practice_on: history.length ? history[history.length - 1].occurred_on : null,
      minutes: history.reduce((sum, row) => sum + (finite(row.minutes, 0, 1440, false) || 0), 0),
      sessions: history.length, successful_review_days: successfulDays,
      observed_level: finite(skill.observed_level, 1, 10, true),
      heuristic: true
    };
  }
  function smokingEstimate(counts, reference) {
    counts = counts || {}; reference = reference || {};
    const joints = finite(counts.joints, 0, 1000, true), cigars = finite(counts.cigars, 0, 1000, true);
    const grams = finite(counts.grams_per_joint, 0.01, 10, false);
    const gramPrice = finite(reference.price_per_gram_cents, 0, 1000000000, true);
    const cigarPrice = finite(reference.cigar_price_cents, 0, 1000000000, true);
    const cannabisCost = joints === 0 ? 0 : joints != null && grams != null && gramPrice != null ? Math.round(joints * grams * gramPrice) : null;
    const cigarCost = cigars === 0 ? 0 : cigars != null && cigarPrice != null ? Math.round(cigars * cigarPrice) : null;
    const missing = [];
    if (joints == null) missing.push('joint count');
    if (joints !== 0 && grams == null) missing.push('grams per joint');
    if (joints !== 0 && gramPrice == null) missing.push('cannabis reference price');
    if (cigars == null) missing.push('cigar count');
    if (cigars !== 0 && cigarPrice == null) missing.push('cigar reference price');
    const complete = cannabisCost != null && cigarCost != null;
    const cost = complete ? cannabisCost + cigarCost : null;
    return { cost_cents: cost, known_cents: (cannabisCost || 0) + (cigarCost || 0), cannabis_cents: cannabisCost, cigars_cents: cigarCost, grams: joints != null && grams != null ? joints * grams : null, missing, complete, thirty_day_cents: cost == null ? null : cost * 30 };
  }
  function smokingComparison(counts, reference) {
    const daily = smokingEstimate(counts, reference);
    const baseline = smokingEstimate({ joints: reference && reference.baseline_joints, cigars: reference && reference.baseline_cigars, grams_per_joint: reference && reference.baseline_grams_per_joint }, reference);
    return { daily, baseline, savings_cents: daily.cost_cents == null || baseline.cost_cents == null ? null : baseline.cost_cents - daily.cost_cents };
  }
  function smokingMonth(days, month) {
    const rows = (days || []).filter(row => row && !row.archived && !row.voided_at && !row.deleted && dateNumber(row.occurred_on) != null && row.occurred_on.slice(0, 7) === month);
    const totals = { days_recorded: rows.length, joints: 0, cigars: 0, estimated_cost_cents: 0, estimated_savings_cents: 0, costs_complete: true, savings_complete: true };
    for (const row of rows) {
      const reference = row.reference_snapshot || {};
      const value = smokingComparison(row, reference);
      totals.joints += finite(row.joints, 0, 1000, true) || 0;
      totals.cigars += finite(row.cigars, 0, 1000, true) || 0;
      if (value.daily.cost_cents == null) totals.costs_complete = false;
      totals.estimated_cost_cents += value.daily.known_cents;
      if (value.savings_cents == null) totals.savings_complete = false; else totals.estimated_savings_cents += value.savings_cents;
    }
    if (!rows.length) { totals.estimated_cost_cents = null; totals.estimated_savings_cents = null; totals.costs_complete = false; totals.savings_complete = false; }
    return totals;
  }
  const api = { CATEGORIES, REVIEW_INTERVALS, REVIEW_RESULTS, TRIGGERS, dateNumber, dayKey, addDays, category, skillProgress, smokingEstimate, smokingComparison, smokingMonth };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomHabitsModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
