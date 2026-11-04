'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../bloom-dog-model.js');
const task = (changes = {}) => ({ id: 'care', domain: 'dog', name: 'Coat care', category: 'grooming', frequency: 'interval', interval_days: 2, interval_months: 1, anchor_on: '2026-11-01', end_on: null, times: [], rolling: true, active: true, ...changes });
const log = (on, slot = '', changes = {}) => ({ id: 'log-' + on + slot, task_id: 'care', occurred_on: on, slot, person_slot: 1, done: true, ...changes });

test('care dates use the household calendar across midnight and daylight saving', () => {
  assert.equal(M.dayKey(new Date('2026-11-04T04:59:59Z')), '2026-11-03');
  assert.equal(M.dayKey(new Date('2026-11-04T05:00:00Z')), '2026-11-04');
  assert.equal(M.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(M.dateNumber('2026-02-29'), null);
  assert.equal(M.dateNumber('2024-02-29') != null, true);
  assert.equal(M.dateNumber('2026-11-31'), null);
  assert.equal(M.dateNumber('1899-12-31'), null);
  assert.equal(M.dateNumber('2201-01-01'), null);
});

test('identity, age and weight come from real saved entries, with unknowns left unknown', () => {
  assert.equal(M.ageLabel(null, '2026-11-04'), 'Add date of birth');
  assert.equal(M.ageLabel('2027-01-01', '2026-11-04'), 'Check date of birth');
  assert.equal(M.ageLabel('2022-10-05', '2026-11-04'), '4 years old');
  assert.equal(M.ageLabel('2026-11-03', '2026-11-04'), '1 day old');
  const current = { dogWeights: [{ id: 'old', occurred_on: '2026-11-01', weight_kg: 5 }, { id: 'future', occurred_on: '2026-11-06', weight_kg: 7 }, { id: 'removed', occurred_on: '2026-11-03', weight_kg: 9, archived: true }] };
  assert.equal(M.latestWeight(current, '2026-11-04').id, 'old');
  assert.equal(M.latestWeight(current, '2026-10-01'), null);
  assert.equal(M.money(null), 'Not recorded');
  assert.equal(M.money(0), '$0.00');
});

test('daily presentation starts a new day while preserving yesterday’s completion records', () => {
  const value = task({ frequency: 'daily', times: ['07:30', '18:00'] });
  const history = [log('2026-11-03', '07:30'), log('2026-11-03', '18:00')];
  assert.equal(M.dueTasks([value], history, '2026-11-03').filter(row => row.done).length, 2);
  const today = M.dueTasks([value], history, '2026-11-04');
  assert.equal(today.length, 2);
  assert.equal(today.every(row => !row.done && row.due_on === '2026-11-04'), true);
  assert.equal(history.length, 2);
});

test('a rolling care interval advances from actual completion only after all times are completed', () => {
  const value = task({ times: ['08:00', '20:00'] });
  const partial = [log('2026-11-03', '08:00')];
  assert.equal(M.nextDue(value, partial, '2026-11-03'), '2026-11-01');
  const complete = [...partial, log('2026-11-03', '20:00')];
  assert.equal(M.nextDue(value, complete, '2026-11-03'), '2026-11-05');
  assert.equal(M.taskOccurrences(value, complete, '2026-11-04').length, 0);
  assert.equal(M.taskOccurrences(value, complete, '2026-11-05').every(row => !row.done), true);
  assert.equal(M.taskOccurrences(value, complete, '2026-11-03').every(row => row.done), true, 'today remains visible for correction');
  const undone = [...partial, log('2026-11-03', '20:00', { done: false })];
  assert.equal(M.nextDue(value, undone, '2026-11-04'), '2026-11-01');
});

test('fixed intervals keep their anchor while rolling intervals follow actual late completion', () => {
  const history = [log('2026-11-04')];
  assert.equal(M.nextDue(task({ rolling: false }), history, '2026-11-04'), '2026-11-05');
  assert.equal(M.nextDue(task({ rolling: true }), history, '2026-11-04'), '2026-11-06');
  assert.equal(M.taskOccurrences(task(), [], '2026-11-04')[0].due_on, '2026-11-01');
});

test('monthly schedules use calendar months and retain a 31st-day anchor', () => {
  const value = task({ frequency: 'monthly', anchor_on: '2026-01-31' });
  assert.equal(M.nextAfter(value, '2026-01-31'), '2026-02-28');
  assert.equal(M.nextAfter(value, '2026-02-28'), '2026-03-31');
  assert.equal(M.nextAfter(value, '2026-03-02'), '2026-03-31');
  assert.equal(M.nextAfter({ ...value, interval_months: 2 }, '2026-01-31'), '2026-03-31');
  assert.equal(M.addMonths('2024-01-31', 1), '2024-02-29');
});

test('ended, inactive and archived routines stop generating reminders', () => {
  for (const value of [task({ active: false }), task({ archived: true }), task({ end_on: '2026-11-03' })]) {
    assert.deepEqual(M.taskOccurrences(value, [], '2026-11-04'), []);
    assert.equal(M.nextDue(value, [], '2026-11-04'), null);
  }
  const once = task({ frequency: 'once' });
  assert.equal(M.nextDue(once, [log('2026-11-02')], '2026-11-04'), null);
  assert.equal(M.taskOccurrences(task({ anchor_on: '2026-11-05' }), [], '2026-11-04').length, 0);
});

test('past completion bundles use the saved task snapshot after a routine is edited', () => {
  const changed = task({ times: ['08:00', '20:00'] });
  const history = [log('2026-11-03', '', { task_snapshot: { name: 'Old name', times: [] } })];
  assert.deepEqual(M.completionDays(changed, history, '2026-11-04'), ['2026-11-03']);
  assert.equal(M.nextDue(changed, history, '2026-11-04'), '2026-11-05');
  assert.equal(M.snapshotBody(history[0]).name, 'Old name');
});

test('Home and Housework counts use the exact same Dog completion records', () => {
  const current = { dogProfiles: [{ name: 'Sample dog' }], routineTasks: [task({ frequency: 'daily' }), task({ id: 'chore', domain: 'housework', frequency: 'daily' })], routineLogs: [log('2026-11-04')], dogSupplies: [{ stock_quantity: 0, refill_threshold: 1 }, { stock_quantity: 2, refill_threshold: 1 }, { stock_quantity: 5, refill_threshold: 1, needs_refill: true }] };
  assert.deepEqual(M.summary(current, '2026-11-04'), { dueCount: 0, completedCount: 1, dogName: 'Sample dog', needsRefillCount: 2 });
  assert.equal(M.dueTasks(current.routineTasks, current.routineLogs, '2026-11-04').filter(row => row.done).length, 1);
  assert.equal(M.dueTasks(current.routineTasks, current.routineLogs, '2026-11-05').filter(row => row.done).length, 0);
});

test('Dog spending derives actual receipt effects and excludes voids and other months', () => {
  const current = { receipts: [{ id: 'receipt-a', purchased_on: '2026-11-03' }, { id: 'receipt-b', purchased_on: '2026-11-03', voided_at: '2026-11-04' }], dogStockEffects: [
    { id: 'one', receipt_id: 'receipt-a', supply_id: 'food', amount_cents: 649, quantity: 1 },
    { id: 'two', receipt_id: 'receipt-b', supply_id: 'brush', amount_cents: 2000, quantity: 1 },
    { id: 'three', receipt_id: 'missing-receipt', purchased_on: '2026-10-01', amount_cents: 1499 },
    { id: 'four', purchased_on: '2026-11-04', amount_cents: 999, voided_at: '2026-11-04' }
  ] };
  assert.deepEqual(M.expenses(current, '2026-11'), { cents: 649, count: 1, incomplete: false });
  assert.equal(M.purchaseHistory(current).filter(row => row.reversed).length, 2);
  current.dogStockEffects.push({ id: 'unknown', purchased_on: '2026-11-04', amount_cents: null });
  assert.deepEqual(M.expenses(current, '2026-11'), { cents: 649, count: 2, incomplete: true });
});

test('calendar reminders preserve clock times through DST and safely escape arbitrary notes', () => {
  const calendar = M.calendarForOccurrence({ id: 'care', on: '2026-11-04', time: '07:30', title: 'Meal; brush, walk', notes: 'Line one\nLine two' }, new Date('2026-11-04T12:00:00Z'));
  assert.match(calendar, /DTSTART:20261104T123000Z/);
  assert.match(calendar, /DTEND:20261104T124500Z/);
  assert.match(calendar, /SUMMARY:Meal\\; brush\\, walk/);
  assert.match(calendar, /BEGIN:VALARM/);
  assert.match(calendar, /Line one\\nLine two/);
  assert.equal(M.careInstant('2026-07-01', '07:30').toISOString(), '2026-07-01T11:30:00.000Z');
  assert.equal(M.careInstant('2026-11-01', '01:30').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(M.careInstant('2026-03-08', '02:30'), null);
  assert.throws(() => M.calendarForOccurrence({ on: '2026-03-08', time: '02:30' }), /does not occur/);
  assert.match(M.calendarForOccurrence({ on: '2026-11-04' }), /DTSTART;VALUE=DATE:20261104/);
});
