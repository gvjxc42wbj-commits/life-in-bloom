'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../bloom-habits-model.js');
const skill = { id: 'scale', name: 'C major scale', observed_level: 6 };
const session = (day, result = 'good', extra = {}) => ({ id: day, skill_id: skill.id, occurred_on: day, minutes: 10, result, ...extra });

test('habit dates use New York calendar days and calendar arithmetic across daylight saving', () => {
  assert.equal(M.dayKey(new Date('2026-11-05T02:00:00Z')), '2026-11-04');
  assert.equal(M.dayKey(new Date('2026-11-05T06:00:00Z')), '2026-11-05');
  assert.equal(M.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(M.addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(M.dateNumber('2026-02-29'), null);
  assert.equal(M.dateNumber('2028-02-29') != null, true);
});

test('a skill has no estimated readiness before a recall check and retains its observed level', () => {
  const result = M.skillProgress(skill, [session('2026-11-04', 'practice'), session('2026-11-06')], '2026-11-04');
  assert.equal(result.score, null);
  assert.equal(result.next_review_on, null);
  assert.equal(result.observed_level, 6);
  assert.equal(result.minutes, 10);
  assert.equal(result.sessions, 1);
});

test('successful review days use expanding intervals and decay only a labeled scheduling estimate', () => {
  const history = [session('2026-11-01'), session('2026-11-02'), session('2026-11-05')];
  const before = JSON.stringify(history);
  assert.equal(M.skillProgress(skill, history.slice(0, 1), '2026-11-01').next_review_on, '2026-11-02');
  assert.equal(M.skillProgress(skill, history.slice(0, 2), '2026-11-02').next_review_on, '2026-11-05');
  const result = M.skillProgress(skill, history, '2026-11-12');
  assert.equal(result.next_review_on, '2026-11-12');
  assert.equal(result.interval_days, 7);
  assert.equal(result.score, 8);
  assert.equal(result.due, true);
  assert.equal(result.observed_level, 6);
  assert.equal(result.heuristic, true);
  assert.equal(JSON.stringify(history), before);
});

test('several checks on the same day cannot advance through several long review intervals', () => {
  const history = [session('2026-11-04', 'good', { id: 'a', created_at: '2026-11-04T10:00:00Z' }), session('2026-11-04', 'good', { id: 'b', created_at: '2026-11-04T10:02:00Z' }), session('2026-11-04', 'good', { id: 'c', created_at: '2026-11-04T10:03:00Z' })];
  const result = M.skillProgress(skill, history, '2026-11-04');
  assert.equal(result.interval_days, 1);
  assert.equal(result.successful_review_days, 1);
  assert.equal(result.sessions, 3);
  assert.equal(result.minutes, 30);
});

test('failed recall creates a short revisit with a low estimate instead of implying perfect recall', () => {
  const history = [session('2026-11-01'), session('2026-11-02'), session('2026-11-04', 'again')];
  const result = M.skillProgress(skill, history, '2026-11-04');
  assert.equal(result.next_review_on, '2026-11-05');
  assert.equal(result.interval_days, 1);
  assert.ok(result.score < 6);
  assert.equal(result.observed_level, 6);
  assert.equal(M.skillProgress(skill, history, '2200-12-31').score, 1);
});

test('ordinary practice does not silently claim a successful recall or delay its review', () => {
  const history = [session('2026-11-01'), session('2026-11-03', 'practice')];
  const result = M.skillProgress(skill, history, '2026-11-04');
  assert.equal(result.last_practice_on, '2026-11-03');
  assert.equal(result.last_review_on, '2026-11-01');
  assert.equal(result.next_review_on, '2026-11-02');
  assert.equal(result.days_overdue, 2);
});

test('removed sessions and another skill cannot change this skill’s schedule', () => {
  const result = M.skillProgress(skill, [session('2026-11-01'), session('2026-11-02', 'easy', { voided_at: '2026-11-02' }), session('2026-11-03', 'easy', { skill_id: 'another' }), session('2026-11-03', 'easy', { archived: true })], '2026-11-04');
  assert.equal(result.sessions, 1);
  assert.equal(result.next_review_on, '2026-11-02');
});

test('an explicitly recorded zero smoking day is different from missing counts and prices', () => {
  assert.equal(M.smokingEstimate({ joints: 0, cigars: 0, grams_per_joint: 0.5 }, {}).cost_cents, 0);
  assert.equal(M.smokingEstimate({}, {}).cost_cents, null);
  const result = M.smokingEstimate({ joints: 1, cigars: 0, grams_per_joint: 0.5 }, {});
  assert.equal(result.cost_cents, null);
  assert.deepEqual(result.missing, ['cannabis reference price']);
});

test('smoking estimates use grams and integer-cent reference prices, without inventing missing components', () => {
  const reference = { price_per_gram_cents: 975, cigar_price_cents: 140 };
  const result = M.smokingEstimate({ joints: 3, cigars: 2, grams_per_joint: 0.5 }, reference);
  assert.equal(result.cannabis_cents, 1463);
  assert.equal(result.cigars_cents, 280);
  assert.equal(result.cost_cents, 1743);
  assert.equal(result.thirty_day_cents, 52290);
  const partial = M.smokingEstimate({ joints: 3, cigars: 2, grams_per_joint: 0.5 }, { cigar_price_cents: 140 });
  assert.equal(partial.cost_cents, null);
  assert.equal(partial.known_cents, 280);
  assert.equal(partial.complete, false);
});

test('a baseline comparison stays unknown until configured and can show an increase', () => {
  const daily = { joints: 3, cigars: 0, grams_per_joint: 0.5 };
  assert.equal(M.smokingComparison(daily, { price_per_gram_cents: 100 }).savings_cents, null);
  const result = M.smokingComparison(daily, { price_per_gram_cents: 100, cigar_price_cents: 100, baseline_joints: 2, baseline_cigars: 0, baseline_grams_per_joint: 0.5 });
  assert.equal(result.savings_cents, -50);
});

test('monthly smoking totals use each saved day’s reference snapshot and only recorded days', () => {
  const rows = [
    { occurred_on: '2026-11-01', joints: 1, cigars: 0, grams_per_joint: 0.5, reference_snapshot: { price_per_gram_cents: 200, baseline_joints: 2, baseline_cigars: 0, baseline_grams_per_joint: 0.5 } },
    { occurred_on: '2026-11-03', joints: 1, cigars: 0, grams_per_joint: 0.5, reference_snapshot: { price_per_gram_cents: 300, baseline_joints: 2, baseline_cigars: 0, baseline_grams_per_joint: 0.5 } },
    { occurred_on: '2026-10-31', joints: 50, cigars: 1, grams_per_joint: 0.5, reference_snapshot: {} }
  ];
  const result = M.smokingMonth(rows, '2026-11');
  assert.equal(result.days_recorded, 2);
  assert.equal(result.joints, 2);
  assert.equal(result.cigars, 0);
  assert.equal(result.estimated_cost_cents, 250);
  assert.equal(result.estimated_savings_cents, 250);
  assert.equal(result.costs_complete, true);
  assert.equal(M.smokingMonth([], '2026-11').estimated_cost_cents, null);
});

test('a monthly total signals incomplete reference prices instead of treating unknown days as free', () => {
  const result = M.smokingMonth([{ occurred_on: '2026-11-04', joints: 1, cigars: 0, grams_per_joint: 0.5, reference_snapshot: {} }], '2026-11');
  assert.equal(result.days_recorded, 1);
  assert.equal(result.costs_complete, false);
  assert.equal(result.estimated_cost_cents, 0);
});


test('archived smoking days are excluded and partial known components remain in the monthly subtotal', () => {
  const result = M.smokingMonth([
    { occurred_on: '2026-11-01', joints: 1, cigars: 2, grams_per_joint: 0.5, reference_snapshot: { cigar_price_cents: 125 } },
    { occurred_on: '2026-11-02', joints: 50, cigars: 50, grams_per_joint: 0.5, archived: true, reference_snapshot: { cigar_price_cents: 125 } }
  ], '2026-11');
  assert.equal(result.days_recorded, 1);
  assert.equal(result.joints, 1);
  assert.equal(result.cigars, 2);
  assert.equal(result.estimated_cost_cents, 250);
  assert.equal(result.costs_complete, false);
});
