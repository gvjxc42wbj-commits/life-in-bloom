'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../bloom-data.js');
process.env.TZ = 'America/New_York';

function raw(overrides = {}) {
  return {
    id: 'piano-lesson', title: 'Piano lesson', startDate: '2026-11-04',
    startTime: '14:00', endTime: '15:00', endNextDay: false,
    color: '#edc1d7', notes: 'Bring my music.',
    recurrence: { frequency: 'none' }, excludedDates: [], ...overrides
  };
}

function local(key, time = '00:00') {
  const value = Data.parseDate(key);
  const [hour, minute] = time.split(':').map(Number);
  value.setHours(hour, minute, 0, 0);
  return value;
}

function inWindow(appointments, from, to, fromTime = '00:00', toTime = '00:00') {
  return Data.appointmentsInWindow(appointments, local(from, fromTime), local(to, toTime));
}

function dates(occurrences) { return occurrences.map(occurrence => occurrence.occurrenceDate); }

function dataWith(appointments = []) {
  let record = Data.setRange(Data.blankRecord(), 0, 2, 'awake', 'cooking');
  record = Data.setRange(record, 32, 46, 'sleep');
  record = Data.setMood(record, 0, { feeling: 'Content', note: 'After breakfast.', updatedAt: '2026-11-04T14:00:00Z' });
  record.notes = 'Keep my observed entries separate from plans.';
  return Data.normalizeData({ records: { '2026-11-03': record }, appointments });
}

function freeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); });
  return Object.freeze(value);
}

function storageWith(seed = {}, failWrite = false) {
  const values = new Map(Object.entries(seed));
  return {
    writes: [],
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (failWrite) throw new Error('quota'); values.set(key, value); this.writes.push(key); },
    snapshot() { return Object.fromEntries(values); }
  };
}

test('appointment validation preserves text and normalizes bounded recurrence settings', () => {
  const appointment = Data.normalizeAppointment(raw({ title: '  Sewing & piano  ', color: 'url(x)' }));
  assert.equal(appointment.title, 'Sewing & piano');
  assert.match(appointment.color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(appointment.recurrence, { frequency: 'none', interval: 1, weekdays: [], until: '' });
  const weekly = Data.normalizeAppointment(raw({ recurrence: { frequency: 'weekly', interval: 2 } }));
  assert.deepEqual(weekly.recurrence.weekdays, [3]);
  const days = Data.normalizeAppointment(raw({ recurrence: { frequency: 'weekly', weekdays: [5, 1, 5] } }));
  assert.deepEqual(days.recurrence.weekdays, [1, 5]);
  assert.equal(Data.normalizeAppointment(raw({ startTime: '08:00', endTime: '08:00', endNextDay: true })).endNextDay, true);
});

test('invalid dates, times, durations, IDs, or repeat rules fail before entering saved data', () => {
  const invalid = [
    { id: '<script>' }, { title: ' ' }, { startDate: '2026-02-30' },
    { startTime: '24:00' }, { startTime: '9:00' }, { endTime: '15:60' },
    { startTime: '14:00', endTime: '14:00' },
    { startTime: '14:00', endTime: '13:00' },
    { startTime: '14:00', endTime: '15:00', endNextDay: true },
    { endNextDay: 'false' },
    { recurrence: { frequency: 'yearly' } },
    { recurrence: { frequency: 'daily', interval: 0 } },
    { recurrence: { frequency: 'monthly', interval: 53 } },
    { recurrence: { frequency: 'weekly', interval: 1.5 } },
    { recurrence: { frequency: 'weekly', weekdays: [] } },
    { recurrence: { frequency: 'weekly', weekdays: [7] } },
    { recurrence: { frequency: 'daily', until: '2026-11-03' } },
    { excludedDates: ['2026-02-30'] }
  ];
  for (const patch of invalid) assert.throws(() => Data.normalizeAppointment(raw(patch)), JSON.stringify(patch));
  assert.throws(() => Data.normalizeData({ records: {}, appointments: {} }));
  assert.throws(() => Data.normalizeData({ records: {}, appointments: [raw(), raw()] }), /same identifier/);
  assert.throws(() => Data.normalizeData({ records: {}, appointments: Array.from({ length: 2001 }, (_, index) => raw({ id: 'a-' + index })) }), /2,000/);
});

test('v2 migration keeps hourly moods and activities and preserves both earlier saved copies', () => {
  const current = dataWith();
  const previous = { version: 2, records: current.records, activities: current.activities };
  const previousText = JSON.stringify(previous);
  const legacyText = JSON.stringify({ '2020-01-01': { slots: {}, quality: '', notes: 'Earlier v1 copy' } });
  const storage = storageWith({ [Data.PREVIOUS_KEY]: previousText, [Data.LEGACY_KEY]: legacyText });
  const loaded = Data.loadData(storage);
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.readOnly, false);
  assert.equal(loaded.sourceKey, Data.PREVIOUS_KEY);
  assert.equal(loaded.data.version, 3);
  assert.deepEqual(loaded.data.records, current.records);
  assert.deepEqual(loaded.data.activities, current.activities);
  assert.deepEqual(loaded.data.appointments, []);
  assert.equal(storage.getItem(Data.PREVIOUS_KEY), previousText);
  assert.equal(storage.getItem(Data.LEGACY_KEY), legacyText);
  assert.deepEqual(Data.STORAGE_KEYS, [Data.STORAGE_KEY, Data.PREVIOUS_KEY, Data.LEGACY_KEY]);
  assert.deepEqual(storage.writes, [Data.STORAGE_KEY]);
  assert.deepEqual(Data.loadData(storage).data, loaded.data);
});

test('an empty v2 is migrated as empty rather than falling through to populated v1', () => {
  const storage = storageWith({
    [Data.PREVIOUS_KEY]: JSON.stringify({ version: 2, records: {}, activities: [] }),
    [Data.LEGACY_KEY]: JSON.stringify(dataWith().records)
  });
  const loaded = Data.loadData(storage);
  assert.equal(loaded.migrated, true);
  assert.deepEqual(loaded.data.records, {});
  assert.equal(loaded.sourceKey, Data.PREVIOUS_KEY);
});

test('a valid empty v3 never resurrects v2 entries; a corrupt v2 never falls through to v1', () => {
  const empty = Data.normalizeData({ records: {} });
  const storage = storageWith({
    [Data.STORAGE_KEY]: JSON.stringify(empty),
    [Data.PREVIOUS_KEY]: JSON.stringify({ ...dataWith(), version: 2 })
  });
  assert.deepEqual(Data.loadData(storage).data, empty);
  assert.equal(storage.writes.length, 0);
  const corrupt = storageWith({ [Data.PREVIOUS_KEY]: '{broken', [Data.LEGACY_KEY]: JSON.stringify(dataWith().records) });
  const original = corrupt.snapshot();
  const loaded = Data.loadData(corrupt);
  assert.equal(loaded.readOnly, true);
  assert.equal(loaded.sourceKey, Data.PREVIOUS_KEY);
  assert.deepEqual(corrupt.snapshot(), original);
});

test('failed v2 migration writes leave the original exportable and never claim a successful save', () => {
  const v2 = { ...dataWith(), version: 2 };
  const storage = storageWith({ [Data.PREVIOUS_KEY]: JSON.stringify(v2) }, true);
  const loaded = Data.loadData(storage);
  assert.equal(loaded.migrated, true);
  assert.ok(loaded.warning.includes('could not save'));
  assert.equal(storage.getItem(Data.STORAGE_KEY), null);
  assert.equal(storage.getItem(Data.PREVIOUS_KEY), JSON.stringify(v2));
  assert.deepEqual(Data.parseBackup(JSON.stringify(Data.makeBackup(loaded.data))), loaded.data);
});

test('v3 backups include repeating appointment rules and exceptions; v2 backups still import', () => {
  const original = freeze(dataWith([raw({ recurrence: { frequency: 'weekly', weekdays: [3, 5], until: '2027-03-31' }, excludedDates: ['2026-11-11'] })]));
  const backup = Data.makeBackup(original, new Date('2026-11-04T14:00:00Z'));
  assert.equal(backup.app, 'Life in Bloom');
  assert.equal(backup.version, 3);
  assert.deepEqual(Data.parseBackup(JSON.stringify(backup)), original);
  const old = Data.parseBackup(JSON.stringify({ app: 'Sleep in Bloom', version: 2, records: original.records, activities: original.activities }));
  assert.deepEqual(old.records, original.records);
  assert.deepEqual(old.activities, original.activities);
  assert.deepEqual(old.appointments, []);
  assert.throws(() => Data.parseBackup(JSON.stringify({ ...backup, appointments: [raw({ endTime: '13:00' })] })));
});

test('one-time appointments appear only when their interval overlaps the requested window', () => {
  const definition = raw({ startDate: '2030-05-15' });
  const result = inWindow([definition], '2030-05-15', '2030-05-16');
  assert.equal(result.length, 1);
  assert.equal(result[0].appointmentId, definition.id);
  assert.equal(result[0].occurrenceDate, '2030-05-15');
  assert.equal(result[0].start.getHours(), 14);
  assert.equal(result[0].end.getHours(), 15);
  assert.equal(result[0].timeAdjusted, false);
  assert.deepEqual(inWindow([definition], '2030-05-15', '2030-05-15', '15:00', '16:00'), []);
  assert.deepEqual(inWindow([definition], '2030-05-15', '2030-05-15', '13:00', '14:00'), []);
  assert.equal(inWindow([definition], '2030-05-15', '2030-05-15', '14:30', '14:45').length, 1);
});

test('daily repeats use calendar intervals, inclusive end dates, and skipped dates', () => {
  const definition = raw({ recurrence: { frequency: 'daily', interval: 2, until: '2026-11-10' }, excludedDates: ['2026-11-06'] });
  assert.deepEqual(dates(inWindow([definition], '2026-11-01', '2026-11-15')), ['2026-11-04', '2026-11-08', '2026-11-10']);
  assert.deepEqual(dates(inWindow([raw({ startDate: '2000-01-01', recurrence: { frequency: 'daily' } })], '2040-06-01', '2040-06-08')),
    ['2040-06-01', '2040-06-02', '2040-06-03', '2040-06-04', '2040-06-05', '2040-06-06', '2040-06-07']);
});

test('weekly multi-day intervals are anchored to Monday weeks and never generate before the first date', () => {
  const definition = raw({ recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3, 5], until: '2026-11-20' } });
  assert.deepEqual(dates(inWindow([definition], '2026-11-01', '2026-12-01')),
    ['2026-11-04', '2026-11-06', '2026-11-16', '2026-11-18', '2026-11-20']);
  const sunday = raw({ startDate: '2026-11-01', recurrence: { frequency: 'weekly', interval: 2, weekdays: [0, 1], until: '2026-11-15' } });
  assert.deepEqual(dates(inWindow([sunday], '2026-10-25', '2026-11-20')), ['2026-11-01', '2026-11-09', '2026-11-15']);
});

test('monthly repeats keep their numbered date, skip short months, and honor intervals', () => {
  const definition = raw({ startDate: '2027-01-31', recurrence: { frequency: 'monthly' } });
  assert.deepEqual(dates(inWindow([definition], '2027-01-01', '2027-08-01')), ['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
  const everyOther = raw({ startDate: '2027-01-30', recurrence: { frequency: 'monthly', interval: 2 } });
  assert.deepEqual(dates(inWindow([everyOther], '2027-01-01', '2027-08-01')), ['2027-01-30', '2027-03-30', '2027-05-30', '2027-07-30']);
  const leap = raw({ startDate: '2028-02-29', recurrence: { frequency: 'monthly', interval: 12 } });
  assert.deepEqual(inWindow([leap], '2029-02-01', '2029-03-01'), []);
  assert.deepEqual(dates(inWindow([leap], '2032-02-01', '2032-03-01')), ['2032-02-29']);
});

test('overnight and early-morning appointments overlap the correct 8 AM tracking windows', () => {
  const overnight = raw({ id: 'overnight', startDate: '2026-11-03', startTime: '23:30', endTime: '01:00', endNextDay: true });
  const morning = raw({ id: 'morning', startDate: '2026-11-04', startTime: '07:30', endTime: '08:30' });
  const earlierDay = inWindow([overnight, morning], '2026-11-03', '2026-11-04', '08:00', '08:00');
  assert.deepEqual(earlierDay.map(item => item.id), ['overnight', 'morning']);
  assert.equal(Data.dateKey(earlierDay[0].end.getFullYear(), earlierDay[0].end.getMonth(), earlierDay[0].end.getDate()), '2026-11-04');
  const followingDay = inWindow([overnight, morning], '2026-11-04', '2026-11-05', '08:00', '08:00');
  assert.deepEqual(followingDay.map(item => item.id), ['morning']);
  assert.equal(followingDay[0].occurrenceDate, '2026-11-04');
});

test('daily appointments retain their local clock time across daylight-saving changes', () => {
  const spring = raw({ startDate: '2026-03-07', startTime: '09:00', endTime: '10:00', recurrence: { frequency: 'daily', until: '2026-03-09' } });
  const result = inWindow([spring], '2026-03-07', '2026-03-10');
  assert.deepEqual(result.map(item => item.start.getHours()), [9, 9, 9]);
  assert.equal((result[1].start - result[0].start) / 3600000, 23);
  const fall = raw({ startDate: '2026-10-31', startTime: '09:00', endTime: '10:00', recurrence: { frequency: 'daily', until: '2026-11-02' } });
  const autumn = inWindow([fall], '2026-10-31', '2026-11-03');
  assert.deepEqual(autumn.map(item => item.start.getHours()), [9, 9, 9]);
  assert.equal((autumn[1].start - autumn[0].start) / 3600000, 25);
});

test('a nonexistent spring-forward time remains visible with an explicit adjustment flag', () => {
  const definition = raw({ startDate: '2026-03-01', startTime: '02:30', endTime: '03:00', recurrence: { frequency: 'weekly', weekdays: [0] } });
  const result = inWindow([definition], '2026-03-08', '2026-03-09');
  assert.equal(result.length, 1);
  assert.equal(result[0].timeAdjusted, true);
  assert.equal(result[0].start.getHours(), 3);
  assert.ok(result[0].end > result[0].start);
});

test('invalid or overly broad expansion ranges fail explicitly', () => {
  assert.throws(() => Data.appointmentsInWindow([], new Date(NaN), new Date()));
  assert.throws(() => inWindow([], '2026-11-04', '2026-11-04'));
  assert.throws(() => inWindow([], '2026-11-05', '2026-11-04'));
  assert.throws(() => inWindow([], '2026-01-01', '2027-02-01'), /370/);
  assert.throws(() => inWindow([raw({ startDate: 'bad' })], '2026-11-01', '2026-11-08'));
});

test('adding, editing, and removing an appointment never changes recorded observations', () => {
  const original = freeze(dataWith());
  const added = Data.upsertAppointment(original, raw());
  assert.deepEqual(original.appointments, []);
  assert.deepEqual(added.records, original.records);
  assert.deepEqual(added.activities, original.activities);
  const changed = Data.upsertAppointment(freeze(added), raw({ title: 'Piano with teacher', startTime: '15:00', endTime: '16:00' }));
  assert.equal(changed.appointments.length, 1);
  assert.equal(changed.appointments[0].title, 'Piano with teacher');
  assert.equal(added.appointments[0].title, 'Piano lesson');
  const removed = Data.removeAppointment(changed, 'piano-lesson');
  assert.deepEqual(removed.appointments, []);
  assert.deepEqual(removed.records, original.records);
  assert.throws(() => Data.removeAppointment(original, 'missing'));
});

test('removing one repeat skips only that date; deleting a series removes its future instances', () => {
  const original = freeze(dataWith([raw({ recurrence: { frequency: 'weekly', weekdays: [3] } })]));
  const skipped = Data.removeAppointment(original, 'piano-lesson', '2026-11-11', 'occurrence');
  assert.deepEqual(skipped.appointments[0].excludedDates, ['2026-11-11']);
  assert.deepEqual(dates(inWindow(skipped.appointments, '2026-11-01', '2026-11-20')), ['2026-11-04', '2026-11-18']);
  assert.deepEqual(original.appointments[0].excludedDates, []);
  assert.throws(() => Data.removeAppointment(skipped, 'piano-lesson', '2026-11-11', 'occurrence'));
  assert.throws(() => Data.removeAppointment(original, 'piano-lesson', '2026-11-12', 'occurrence'));
  assert.throws(() => Data.removeAppointment(original, 'piano-lesson', '', 'unknown'));
  assert.deepEqual(Data.removeAppointment(skipped, 'piano-lesson', '', 'series').appointments, []);
  assert.deepEqual(Data.removeAppointment(dataWith([raw()]), 'piano-lesson', '2026-11-04', 'occurrence').appointments, []);
});

test('editing one occurrence creates a standalone replacement and preserves the remaining series', () => {
  const original = freeze(dataWith([raw({ recurrence: { frequency: 'weekly', weekdays: [3] } })]));
  const replacement = raw({ id: 'piano-exception', title: 'Rescheduled piano', startDate: '2026-11-12', startTime: '16:00', endTime: '17:00' });
  const changed = Data.updateAppointmentOccurrence(original, 'piano-lesson', '2026-11-11', replacement);
  assert.deepEqual(dates(inWindow(changed.appointments, '2026-11-01', '2026-11-20')), ['2026-11-04', '2026-11-12', '2026-11-18']);
  assert.equal(changed.appointments.find(item => item.id === 'piano-exception').recurrence.frequency, 'none');
  assert.deepEqual(changed.records, original.records);
  assert.equal(original.appointments.length, 1);
  assert.deepEqual(original.appointments[0].excludedDates, []);
  assert.throws(() => Data.updateAppointmentOccurrence(original, 'piano-lesson', '2026-11-11', raw()));
  assert.throws(() => Data.updateAppointmentOccurrence(original, 'piano-lesson', '2026-11-11', { ...replacement, recurrence: { frequency: 'daily' } }));
  const collision = Data.upsertAppointment(original, replacement);
  assert.throws(() => Data.updateAppointmentOccurrence(collision, 'piano-lesson', '2026-11-11', replacement));
});
