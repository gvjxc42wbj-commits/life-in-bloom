'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../bloom-data.js');
const I = require('../bloom-insights.js');

function record(hours, feelings = []) {
  let result = D.blankRecord();
  if (hours === 0) result = D.setRange(result, 0, 48, 'awake');
  else if (hours !== null) result = D.setRange(result, 48 - hours * 2, 48, 'sleep');
  feelings.forEach((feeling, hour) => {
    result = D.setSlot(result, hour * 2, 'awake', 'cooking');
    result = D.setMood(result, hour, { feeling });
  });
  return result;
}

test('a date history joins sleep and hourly moods without weighting frequently logged hours more heavily', () => {
  const data = { records: {
    '2026-11-01': record(8, ['Calm', 'calm', 'Calm']),
    '2026-11-02': record(4, ['Calm']),
    '2026-11-03': record(10, [])
  } };
  const result = I.summarizeMonth(data, 2026, 10);
  assert.equal(result.pairedDays, 2);
  assert.equal(result.moodEntryCount, 4);
  assert.deepEqual(result.comparisons, [{ feeling: 'Calm', days: 2, moodEntries: 4, averageSleep: 6, minSleep: 4, maxSleep: 8 }]);
  assert.equal(result.daysWithSleep, 3);
  assert.equal(result.sleepHoursTotal, 22);
  assert.equal(result.recordedDays[0].key, '2026-11-01');
  assert.equal(result.recordedDays[0].moods[0].entries, 3);
});

test('unrecorded sleep is excluded while a deliberately all-awake day contributes zero', () => {
  const data = { records: {
    '2026-11-01': record(null, ['Happy']),
    '2026-11-02': record(0, ['Happy']),
    '2026-11-03': record(8, ['Happy'])
  } };
  const result = I.summarizeMonth(data, 2026, 10);
  assert.equal(result.daysWithMood, 3);
  assert.equal(result.pairedDays, 2);
  assert.equal(result.comparisons[0].averageSleep, 4);
  assert.equal(result.recordedDays[0].sleepHours, null);
  assert.equal(result.recordedDays[1].sleepHours, 0);
});

test('one day can contribute once to several feelings without inventing a numeric mood scale', () => {
  const result = I.summarizeMonth({ records: { '2026-11-04': record(7, ['Calm', 'Anxious', 'Calm']) } }, 2026, 10);
  assert.equal(result.pairedDays, 1);
  assert.equal(result.comparisons.length, 2);
  for (const comparison of result.comparisons) {
    assert.equal(comparison.days, 1);
    assert.equal(comparison.averageSleep, 7);
    assert.equal(Object.hasOwn(comparison, 'moodScore'), false);
  }
});

test('month boundaries, leap days and empty months preserve correct dates without extrapolated data', () => {
  const data = { records: { '2024-02-29': record(8, ['Content']), '2024-03-01': record(4, ['Low']) } };
  const february = I.summarizeMonth(data, 2024, 1);
  assert.equal(february.totalDays, 29);
  assert.equal(february.recordedDays.length, 1);
  assert.equal(february.recordedDays[0].key, '2024-02-29');
  const empty = I.summarizeMonth(data, 2026, 11);
  assert.equal(empty.totalDays, 31);
  assert.equal(empty.averageSleep, null);
  assert.deepEqual(empty.comparisons, []);
});

test('partial and Unsure time remain visible qualifications on recorded sleep totals', () => {
  let partial = record(8, ['Calm']);
  partial = D.setSlot(partial, 20, 'rest');
  const result = I.summarizeMonth({ records: { '2026-11-04': partial } }, 2026, 10);
  assert.equal(result.incompleteSleepDays, 1);
  assert.equal(result.recordedDays[0].unsureHours, 0.5);
  assert.ok(result.recordedDays[0].unknownHours > 0);
});

test('planned appointments never contribute sleep or moods to the analytics', () => {
  const result = I.summarizeMonth({ records: {}, appointments: [{ title: 'Piano lesson' }] }, 2026, 10);
  assert.equal(result.daysWithSleep, 0);
  assert.equal(result.moodEntryCount, 0);
  assert.equal(result.recordedDays.length, 0);
});
