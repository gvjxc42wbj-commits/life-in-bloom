'use strict';

// Run with: TZ=America/New_York node --test tests/data.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../bloom-data.js');

const OBSERVED_AT = '2026-11-04T14:15:00.000Z';

test('partial activity logging does not establish zero sleep, while an entirely awake day does', () => {
  const blank = Data.blankRecord();
  assert.equal(Data.hasSleepTotal(blank), false);
  const cooking = Data.setRange(blank, 0, 2, 'awake', 'cooking');
  assert.equal(Data.hasSleepTotal(cooking), false);
  const unsure = Data.setRange(blank, 0, 48, 'rest');
  assert.equal(Data.hasSleepTotal(unsure), false);
  const allAwake = Data.setRange(blank, 0, 48, 'awake');
  assert.equal(Data.hasSleepTotal(allAwake), true);
  assert.equal(Data.hasSleepTotal(Data.setSlot(allAwake, 20, 'rest')), false);
  assert.equal(Data.hasSleepTotal(Data.setSlot(cooking, 20, 'sleep')), true);
});

function memoryStorage(seed = {}, options = {}) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  return {
    writes,
    getItem(key) {
      if (options.failRead) throw new Error('Storage access denied');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (options.failWrite) throw new Error('Storage quota exceeded');
      values.set(key, value);
      writes.push({ key, value });
    },
    snapshot() { return Object.fromEntries(values); }
  };
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

function legacyRecords() {
  return {
    '2026-11-03': {
      slots: { 0: 'awake', 1: 'rest', 2: 'sleep', 3: 'sleep', 47: 'awake' },
      quality: 'Okay',
      notes: 'A nap, then piano.\nKeep this note exactly. 🌙'
    },
    '2026-11-04': {
      slots: { 0: 'rest', 46: 'sleep', 47: 'sleep' },
      quality: 'Restful',
      notes: 'The last hour crosses into tomorrow.'
    }
  };
}

function richData() {
  let record = Data.setRange(Data.blankRecord(), 0, 2, 'awake', 'cooking');
  record = Data.setSlot(record, 1, 'awake', 'plant-care');
  record = Data.setMood(record, 0, {
    feeling: 'Content', note: 'Cooking and tending my plants.', updatedAt: OBSERVED_AT
  });
  record = Data.setRange(record, 32, 34, 'awake', 'language');
  record = Data.setMood(record, 16, {
    feeling: 'Tired', note: 'After midnight.', updatedAt: OBSERVED_AT
  });
  record.quality = 'Okay';
  record.notes = 'Keep the daily notes as well as the hourly notes.';
  return Data.normalizeData({
    records: { '2026-11-03': record },
    activities: [{ id: 'plant-care', name: 'Plant care', icon: '🪴', color: '#aBcDeF' }]
  });
}

test('migrating v1 preserves every sleep record and leaves the original stored copy intact', () => {
  const records = legacyRecords();
  const original = JSON.stringify(records);
  const storage = memoryStorage({ [Data.LEGACY_KEY]: original });

  const loaded = Data.loadData(storage);

  assert.equal(loaded.migrated, true);
  assert.equal(loaded.readOnly, false);
  assert.equal(loaded.warning, '');
  assert.equal(loaded.data.version, 2);
  assert.equal(storage.getItem(Data.LEGACY_KEY), original);
  assert.deepEqual(Object.keys(loaded.data.records), Object.keys(records));
  for (const [date, oldRecord] of Object.entries(records)) {
    const migrated = loaded.data.records[date];
    assert.deepEqual(migrated.slots, oldRecord.slots);
    assert.equal(migrated.quality, oldRecord.quality);
    assert.equal(migrated.notes, oldRecord.notes);
    assert.deepEqual(migrated.activities, {});
    assert.deepEqual(migrated.moods, {});
  }
  assert.equal(loaded.data.records['2026-11-03'].slots[1], 'rest');
  assert.deepEqual(Data.loadData(storage).data, loaded.data);
  assert.equal(Data.loadData(storage).migrated, false);
  assert.equal(storage.writes.length, 1);
});

test('an intentionally empty v2 save does not resurrect older v1 entries', () => {
  const storage = memoryStorage({
    [Data.LEGACY_KEY]: JSON.stringify(legacyRecords()),
    [Data.STORAGE_KEY]: JSON.stringify({ version: 2, records: {}, activities: [] })
  });
  const before = storage.snapshot();

  const loaded = Data.loadData(storage);

  assert.deepEqual(loaded.data.records, {});
  assert.equal(loaded.readOnly, false);
  assert.equal(loaded.migrated, false);
  assert.deepEqual(storage.snapshot(), before);
  assert.equal(storage.writes.length, 0);
});

test('unreadable or unsupported v2 saves become read-only without falling back or replacing data', () => {
  for (const saved of ['{broken', 'null', JSON.stringify({ version: 3, records: {} })]) {
    const storage = memoryStorage({
      [Data.LEGACY_KEY]: JSON.stringify(legacyRecords()),
      [Data.STORAGE_KEY]: saved
    });
    const before = storage.snapshot();

    const loaded = Data.loadData(storage);

    assert.equal(loaded.readOnly, true);
    assert.equal(loaded.migrated, false);
    assert.ok(loaded.warning.length > 0);
    assert.deepEqual(storage.snapshot(), before);
    assert.equal(storage.writes.length, 0);
  }
});

test('v2 backup round trips preserve custom activities, two activities in an hour, moods, and notes', () => {
  const original = deepFreeze(richData());
  const backup = Data.makeBackup(original, new Date(OBSERVED_AT));
  const imported = Data.parseBackup(JSON.stringify(backup));

  assert.equal(backup.version, 2);
  assert.equal(backup.exportedAt, OBSERVED_AT);
  assert.deepEqual(imported, original);
  assert.deepEqual(imported.records['2026-11-03'].activities, original.records['2026-11-03'].activities);
  assert.deepEqual(imported.records['2026-11-03'].moods, original.records['2026-11-03'].moods);
  assert.deepEqual(imported.activities.find(activity => activity.id === 'plant-care'), {
    id: 'plant-care', name: 'Plant care', icon: '🪴', color: '#aBcDeF'
  });

  const storage = memoryStorage();
  Data.saveData(storage, imported);
  assert.deepEqual(Data.loadData(storage).data, original);
  assert.deepEqual(Data.parseBackup(JSON.stringify({ ...backup, app: 'Life in Bloom' })), original);
});

test('v1 exported backups remain importable with their notes, quality, and Unsure data', () => {
  const records = legacyRecords();
  const imported = Data.parseBackup(JSON.stringify({ app: 'Sleep in Bloom', version: 1, records }));

  for (const [date, record] of Object.entries(records)) {
    assert.deepEqual(imported.records[date].slots, record.slots);
    assert.equal(imported.records[date].quality, record.quality);
    assert.equal(imported.records[date].notes, record.notes);
  }
  assert.equal(imported.version, 2);
  assert.ok(imported.activities.some(activity => activity.id === 'cooking' && activity.icon === '👩🏾‍🍳'));
});

test('invalid imports fail before a caller can save them over existing records', () => {
  const data = richData();
  const storage = memoryStorage({ [Data.STORAGE_KEY]: JSON.stringify(data) });
  const before = storage.snapshot();
  const malformed = [
    '{broken',
    'null',
    JSON.stringify({ app: 'Sleep in Bloom', version: 99, records: {} }),
    JSON.stringify({ app: 'Unrelated app', version: 2, records: {} }),
    JSON.stringify({ app: 'Sleep in Bloom', version: 2, records: [] }),
    JSON.stringify({ app: 'Sleep in Bloom', version: 2, records: { '2026-02-30': {} } }),
    JSON.stringify({ app: 'Sleep in Bloom', version: 2, records: { '2026-11-03': { slots: { 48: 'awake' } } } }),
    JSON.stringify({ app: 'Sleep in Bloom', version: 2, records: { '2026-11-03': { slots: { 0: 'awake' }, activities: { 0: 'missing-definition' } } } })
  ];

  for (const content of malformed) {
    assert.throws(() => {
      const imported = Data.parseBackup(content);
      Data.saveData(storage, imported);
    });
    assert.deepEqual(storage.snapshot(), before);
  }
  assert.equal(storage.writes.length, 0);
});

test('changing an Awake activity replaces it without erasing Awake or mutating the old record', () => {
  const cooking = deepFreeze(Data.setSlot(Data.blankRecord(), 3, 'awake', 'cooking'));
  const piano = Data.setSlot(cooking, 3, 'awake', 'piano');

  assert.equal(piano.slots[3], 'awake');
  assert.equal(piano.activities[3], 'piano');
  assert.equal(cooking.slots[3], 'awake');
  assert.equal(cooking.activities[3], 'cooking');
  assert.deepEqual(Data.setSlot(piano, 3, 'awake', 'piano'), piano);

  const erased = Data.setSlot(piano, 3, 'erase');
  assert.equal(erased.slots[3], undefined);
  assert.equal(erased.activities[3], undefined);
  assert.equal(piano.activities[3], 'piano');
});

test('range edits include the first block and exclude the end, including the final 7:30 a.m. block', () => {
  const original = deepFreeze(Data.setRange(Data.blankRecord(), 0, 48, 'sleep'));
  const changed = Data.setRange(original, 32, 34, 'awake', 'language');

  assert.equal(changed.slots[31], 'sleep');
  assert.equal(changed.slots[32], 'awake');
  assert.equal(changed.slots[33], 'awake');
  assert.equal(changed.slots[34], 'sleep');
  assert.deepEqual(changed.activities, { 32: 'language', 33: 'language' });
  assert.equal(Object.values(changed.slots).filter(value => value === 'sleep').length, 46);
  assert.equal(Object.values(original.slots).filter(value => value === 'sleep').length, 48);

  const lastBlock = Data.setRange(changed, 47, 48, 'rest');
  assert.equal(lastBlock.slots[46], 'sleep');
  assert.equal(lastBlock.slots[47], 'rest');
  for (const [start, end] of [[-1, 1], [1, 1], [2, 1], [47, 49], [0.5, 2]]) {
    assert.throws(() => Data.setRange(original, start, end, 'awake', 'cooking'));
  }
});

test('one awake half-hour permits an hourly mood and retains distinct activities within the hour', () => {
  const first = Data.setSlot(Data.blankRecord(), 0, 'awake', 'cooking');
  const both = Data.setSlot(first, 1, 'awake', 'piano');
  const withMood = Data.setMood(both, 0, { feeling: 'Calm', note: 'An hourly check-in.', updatedAt: OBSERVED_AT });

  assert.equal(Data.hasAwake(first, 0), true);
  assert.equal(Data.hasAwake(first, 1), false);
  assert.deepEqual(Data.awakeActivities(withMood, 0, Data.DEFAULT_ACTIVITIES).map(activity => activity.id), ['cooking', 'piano']);
  assert.deepEqual(withMood.slots, both.slots);
  assert.deepEqual(withMood.activities, both.activities);
  assert.equal(withMood.moods[0].feeling, 'Calm');
  assert.equal(both.moods[0], undefined);
  assert.throws(() => Data.setMood(withMood, 1, { feeling: 'Happy' }));
});

test('correcting sleep status preserves existing mood observations and keeps them editable', () => {
  let awake = Data.setRange(Data.blankRecord(), 0, 2, 'awake', 'cooking');
  awake = deepFreeze(Data.setMood(awake, 0, { feeling: 'Tired', note: 'Before correcting my times.', updatedAt: OBSERVED_AT }));
  const sleeping = Data.setRange(awake, 0, 2, 'sleep');

  assert.equal(Data.hasAwake(sleeping, 0), false);
  assert.deepEqual(sleeping.activities, {});
  assert.deepEqual(sleeping.moods, awake.moods);
  const corrected = Data.setMood(sleeping, 0, { feeling: 'Calm', note: 'Corrected observation.', updatedAt: OBSERVED_AT });
  assert.equal(corrected.moods[0].feeling, 'Calm');
  assert.equal(sleeping.moods[0].feeling, 'Tired');
  assert.deepEqual(Data.setMood(corrected, 0, null).moods, {});
  assert.equal(corrected.moods[0].feeling, 'Calm');
  assert.throws(() => Data.setMood(Data.blankRecord(), 0, { feeling: 'Calm' }));
});

test('weeks remain seven local tracking dates when crossing a year or daylight-saving change', () => {
  const start = Data.weekStart('2027-01-01');
  assert.equal(start, '2026-12-28');
  assert.deepEqual(Array.from({ length: 7 }, (_, offset) => Data.shiftDate(start, offset)), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'
  ]);
  assert.equal(Data.weekStart('2027-01-03'), start);
  assert.equal(Data.weekStart('2027-01-04'), '2027-01-04');
  assert.equal(Data.shiftDate('2026-03-08', 1), '2026-03-09');
  assert.equal(Data.shiftDate('2026-11-01', 1), '2026-11-02');
  assert.equal(Data.shiftDate('2028-02-28', 1), '2028-02-29');
  assert.ok(Number.isNaN(Data.parseDate('2026-02-29').getTime()));
  assert.throws(() => Data.weekStart('not-a-date'));
});

test('after-midnight hours belong to the next calendar date within the original tracking day', () => {
  const midnight = Data.hourDateTime('2026-12-31', 16);
  const lastHour = Data.hourDateTime('2026-12-31', 23);

  assert.equal(Data.dateKey(midnight.getFullYear(), midnight.getMonth(), midnight.getDate()), '2027-01-01');
  assert.equal(midnight.getHours(), 0);
  assert.equal(Data.dateKey(lastHour.getFullYear(), lastHour.getMonth(), lastHour.getDate()), '2027-01-01');
  assert.equal(lastHour.getHours(), 7);
  assert.equal(Data.hourDateTime('2026-12-31', 0).getHours(), 8);
  assert.equal(Data.clockLabel(32), '12:00 AM');
  assert.equal(Data.clockLabel(47), '7:30 AM');
  assert.equal(Data.clockLabel(48), '8:00 AM');
  for (const hour of [-1, 24, 0.5]) assert.throws(() => Data.hourDateTime('2026-12-31', hour));
});

test('custom labels remain text data while unsupported CSS color values are replaced', () => {
  const label = '<img src=x onerror=alert(1)>';
  const data = Data.normalizeData({
    records: {},
    activities: [{ id: 'custom-label', name: label, icon: '<svg>', color: 'url(javascript:alert(1))' }]
  });
  const custom = data.activities.find(activity => activity.id === 'custom-label');

  // Rendering and escaping are UI responsibilities; this test only checks the data boundary.
  assert.equal(custom.name, label);
  assert.equal(typeof custom.name, 'string');
  assert.equal(custom.icon, '<svg>');
  assert.match(custom.color, /^#[0-9a-f]{6}$/i);
  assert.notEqual(custom.color, 'url(javascript:alert(1))');
  assert.deepEqual(Data.parseBackup(JSON.stringify(Data.makeBackup(data))).activities, data.activities);
});

test('storage read failures surface as read-only without attempting to replace the saved copy', () => {
  const original = JSON.stringify(richData());
  const storage = memoryStorage({ [Data.STORAGE_KEY]: original }, { failRead: true });

  const loaded = Data.loadData(storage);

  assert.equal(loaded.readOnly, true);
  assert.ok(loaded.warning.length > 0);
  assert.equal(storage.snapshot()[Data.STORAGE_KEY], original);
  assert.equal(storage.writes.length, 0);
});

test('failed migration writes still expose legacy entries for export and retain the legacy copy', () => {
  const original = JSON.stringify(legacyRecords());
  const storage = memoryStorage({ [Data.LEGACY_KEY]: original }, { failWrite: true });

  const loaded = Data.loadData(storage);

  assert.equal(loaded.migrated, true);
  assert.ok(loaded.warning.length > 0);
  assert.deepEqual(loaded.data.records['2026-11-03'].slots, legacyRecords()['2026-11-03'].slots);
  assert.equal(storage.snapshot()[Data.LEGACY_KEY], original);
  assert.equal(storage.snapshot()[Data.STORAGE_KEY], undefined);
  assert.deepEqual(Data.parseBackup(JSON.stringify(Data.makeBackup(loaded.data))), loaded.data);
});

test('save failures throw so callers can report unsaved changes without damaging the prior save', () => {
  const data = richData();
  const original = JSON.stringify(data);
  const storage = memoryStorage({ [Data.STORAGE_KEY]: original }, { failWrite: true });
  const edited = {
    ...data,
    records: { ...data.records, '2026-11-03': Data.setSlot(data.records['2026-11-03'], 5, 'awake', 'piano') }
  };

  assert.throws(() => Data.saveData(storage, edited), /quota/i);
  assert.equal(storage.snapshot()[Data.STORAGE_KEY], original);
  assert.equal(data.records['2026-11-03'].slots[5], undefined);
});
