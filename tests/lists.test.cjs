'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../bloom-data.js');

const CREATED = '2026-10-02T12:00:00.000Z';
const UPDATED = '2026-10-03T15:30:00.000Z';

function storageWith(seed = {}, failWrite = false) {
  const values = new Map(Object.entries(seed));
  return {
    writes: [],
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (failWrite) throw new Error('Storage quota exceeded');
      values.set(key, value);
      this.writes.push(key);
    },
    snapshot() { return Object.fromEntries(values); }
  };
}

function freeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); });
  return Object.freeze(value);
}

function appointment(overrides = {}) {
  return {
    id: 'piano-lesson', title: 'Piano lesson', startDate: '2026-11-04',
    startTime: '14:00', endTime: '15:00',
    recurrence: { frequency: 'weekly', weekdays: [3], until: '2027-02-24' },
    excludedDates: ['2026-12-23'], ...overrides
  };
}

function earlierData() {
  let record = Data.setRange(Data.blankRecord(), 0, 2, 'awake', 'gardening');
  record = Data.setRange(record, 32, 46, 'sleep');
  record = Data.setMood(record, 0, { feeling: 'Content', note: 'After watering my plants.', updatedAt: CREATED });
  record.notes = 'Keep this older sleep record.';
  return {
    version: 3,
    records: { '2026-11-03': record },
    activities: [{ id: 'gardening', name: 'Gardening', icon: '🪴', color: '#c7dec8' }],
    appointments: [appointment()]
  };
}

function item(overrides = {}) {
  return { id: 'shopping-milk', name: 'Milk', quantity: '1 carton', checked: false, createdAt: CREATED, updatedAt: UPDATED, ...overrides };
}

function note(overrides = {}) {
  return { id: 'idea-garden', title: 'Garden ideas', body: 'Herbs by the window.\nBasil, mint & thyme. 🌱', createdAt: CREATED, updatedAt: UPDATED, ...overrides };
}

function fullData() {
  return Data.normalizeData({ ...earlierData(), version: 4, shoppingList: [item()], ideaNotes: [note()] });
}

test('v3 migrates all saved observations, custom activities and appointment exceptions into v4 once', () => {
  const previous = earlierData();
  const v3Text = JSON.stringify(previous);
  const v2Text = JSON.stringify({ version: 2, records: {}, activities: [] });
  const legacyText = JSON.stringify({ '2020-01-01': { notes: 'An older copy', slots: {} } });
  const storage = storageWith({ [Data.V3_KEY]: v3Text, [Data.PREVIOUS_KEY]: v2Text, [Data.LEGACY_KEY]: legacyText });
  const loaded = Data.loadData(storage);

  assert.equal(loaded.data.version, 4);
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.readOnly, false);
  assert.equal(loaded.sourceKey, Data.V3_KEY);
  assert.equal(loaded.warning, '');
  assert.deepEqual(loaded.data.records, previous.records);
  assert.deepEqual(loaded.data.appointments, previous.appointments.map(Data.normalizeAppointment));
  assert.deepEqual(loaded.data.activities.find(activity => activity.id === 'gardening'), previous.activities[0]);
  assert.deepEqual(loaded.data.shoppingList, []);
  assert.deepEqual(loaded.data.ideaNotes, []);
  assert.equal(storage.getItem(Data.V3_KEY), v3Text);
  assert.equal(storage.getItem(Data.PREVIOUS_KEY), v2Text);
  assert.equal(storage.getItem(Data.LEGACY_KEY), legacyText);
  assert.deepEqual(storage.writes, [Data.STORAGE_KEY]);
  const reopened = Data.loadData(storage);
  assert.deepEqual(reopened.data, loaded.data);
  assert.equal(reopened.migrated, false);
  assert.equal(reopened.sourceKey, Data.STORAGE_KEY);
  assert.deepEqual(storage.writes, [Data.STORAGE_KEY]);
});

test('empty v3 is authoritative and malformed v3 never falls back to older data', () => {
  const older = JSON.stringify({ ...earlierData(), version: 2 });
  const emptyV3 = JSON.stringify({ version: 3, records: {}, activities: [], appointments: [] });
  const storage = storageWith({ [Data.V3_KEY]: emptyV3, [Data.PREVIOUS_KEY]: older });
  const loaded = Data.loadData(storage);
  assert.deepEqual(loaded.data.records, {});
  assert.equal(loaded.sourceKey, Data.V3_KEY);
  assert.equal(loaded.readOnly, false);
  for (const invalid of ['{broken', JSON.stringify({ version: 4, records: {} }), JSON.stringify({ ...earlierData(), appointments: 'lost' })]) {
    const corrupt = storageWith({ [Data.V3_KEY]: invalid, [Data.PREVIOUS_KEY]: older });
    const before = corrupt.snapshot();
    assert.equal(Data.loadData(corrupt).readOnly, true);
    assert.deepEqual(corrupt.snapshot(), before);
    assert.deepEqual(corrupt.writes, []);
  }
});

test('a failed v3 migration remains exportable without changing its saved source', () => {
  const original = JSON.stringify(earlierData());
  const storage = storageWith({ [Data.V3_KEY]: original }, true);
  const loaded = Data.loadData(storage);
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.readOnly, false);
  assert.match(loaded.warning, /could not save/);
  assert.equal(storage.getItem(Data.V3_KEY), original);
  assert.equal(storage.getItem(Data.STORAGE_KEY), null);
  assert.deepEqual(Data.parseBackup(JSON.stringify(Data.makeBackup(loaded.data))), loaded.data);
});

test('v4 backup and saved-data round trips preserve grocery checkmarks and complete idea notes with all earlier sections', () => {
  const original = freeze(Data.normalizeData({ ...fullData(), shoppingList: [item({ checked: true }), item({ id: 'shopping-eggs', name: 'Eggs', quantity: '1 dozen' })] }));
  const backup = Data.makeBackup(original, new Date(UPDATED));
  const restored = Data.parseBackup(JSON.stringify(backup));
  assert.equal(backup.app, 'Life in Bloom');
  assert.equal(backup.version, 4);
  assert.equal(backup.exportedAt, UPDATED);
  assert.deepEqual(restored, original);
  const storage = storageWith();
  Data.saveData(storage, restored);
  assert.deepEqual(Data.loadData(storage).data, original);
  assert.deepEqual(storage.writes, [Data.STORAGE_KEY]);
});

test('v1, v2 and v3 backups acquire empty grocery and ideas sections without losing their original data', () => {
  const previous = earlierData();
  for (const version of [1, 2, 3]) {
    const old = {
      app: version === 3 ? 'Life in Bloom' : 'Sleep in Bloom', version,
      records: version === 1 ? { '2026-11-03': { slots: { 0: 'rest' }, notes: 'Old note', quality: 'Okay' } } : previous.records,
      ...(version > 1 ? { activities: previous.activities } : {}),
      ...(version > 2 ? { appointments: previous.appointments } : {})
    };
    const imported = Data.parseBackup(JSON.stringify(old));
    assert.equal(imported.version, 4);
    assert.deepEqual(imported.shoppingList, []);
    assert.deepEqual(imported.ideaNotes, []);
    assert.deepEqual(imported.records['2026-11-03'].slots, old.records['2026-11-03'].slots);
    assert.equal(imported.records['2026-11-03'].notes, old.records['2026-11-03'].notes);
    assert.equal(imported.appointments.length, version === 3 ? 1 : 0);
  }
});

test('grocery edits and checkmarks keep existing details, original creation date and unrelated sections intact', () => {
  const original = freeze(fullData());
  const checked = Data.upsertShoppingItem(original, { id: 'shopping-milk', checked: true });
  assert.equal(checked.shoppingList[0].checked, true);
  assert.equal(checked.shoppingList[0].name, 'Milk');
  assert.equal(checked.shoppingList[0].quantity, '1 carton');
  assert.equal(checked.shoppingList[0].createdAt, CREATED);
  assert.match(checked.shoppingList[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(original.shoppingList[0].checked, false);
  assert.deepEqual(checked.records, original.records);
  assert.deepEqual(checked.activities, original.activities);
  assert.deepEqual(checked.appointments, original.appointments);
  assert.deepEqual(checked.ideaNotes, original.ideaNotes);
  const edited = Data.upsertShoppingItem(checked, { id: 'shopping-milk', name: 'Oat milk', quantity: '  2 cartons  ', createdAt: UPDATED });
  assert.equal(edited.shoppingList[0].name, 'Oat milk');
  assert.equal(edited.shoppingList[0].quantity, '2 cartons');
  assert.equal(edited.shoppingList[0].checked, true);
  assert.equal(edited.shoppingList[0].createdAt, CREATED);
  const unchecked = Data.upsertShoppingItem(edited, { id: 'shopping-milk', checked: false });
  assert.equal(unchecked.shoppingList[0].checked, false);
  const removed = Data.removeShoppingItem(unchecked, 'shopping-milk');
  assert.deepEqual(removed.shoppingList, []);
  assert.deepEqual(removed.ideaNotes, original.ideaNotes);
  assert.equal(unchecked.shoppingList.length, 1);
  assert.throws(() => Data.removeShoppingItem(original, 'missing'), /could not be found/);
});

test('new groceries and notes receive timestamps and sensible defaults without mutating their source', () => {
  const original = freeze(Data.normalizeData({ records: {} }));
  const added = Data.upsertShoppingItem(original, { id: 'shopping-eggs', name: ' Eggs ' });
  const grocery = added.shoppingList[0];
  assert.equal(grocery.name, 'Eggs');
  assert.equal(grocery.quantity, '');
  assert.equal(grocery.checked, false);
  assert.ok(Number.isFinite(Date.parse(grocery.createdAt)));
  assert.equal(grocery.createdAt, grocery.updatedAt);
  const withNote = Data.upsertIdeaNote(added, { id: 'idea-one', body: 'A thought to keep. 🌸' });
  assert.equal(withNote.ideaNotes[0].title, '');
  assert.equal(withNote.ideaNotes[0].body, 'A thought to keep. 🌸');
  assert.ok(Number.isFinite(Date.parse(withNote.ideaNotes[0].createdAt)));
  assert.equal(withNote.ideaNotes[0].createdAt, withNote.ideaNotes[0].updatedAt);
  assert.deepEqual(original.shoppingList, []);
  assert.deepEqual(original.ideaNotes, []);
});

test('idea edits preserve paragraphs, Unicode and creation date, and removal leaves other saved information intact', () => {
  const original = freeze(fullData());
  const body = '  First thought.\n\nSecond paragraph with <b>plain text</b> & 🌺.\n';
  const edited = Data.upsertIdeaNote(original, { id: 'idea-garden', title: '  Plant ideas  ', body });
  assert.equal(edited.ideaNotes[0].title, 'Plant ideas');
  assert.equal(edited.ideaNotes[0].body, body);
  assert.equal(edited.ideaNotes[0].createdAt, CREATED);
  assert.deepEqual(edited.shoppingList, original.shoppingList);
  assert.deepEqual(edited.records, original.records);
  assert.equal(original.ideaNotes[0].body, note().body);
  const removed = Data.removeIdeaNote(edited, 'idea-garden');
  assert.deepEqual(removed.ideaNotes, []);
  assert.deepEqual(removed.shoppingList, original.shoppingList);
  assert.deepEqual(removed.appointments, original.appointments);
  assert.throws(() => Data.removeIdeaNote(original, 'missing'), /could not be found/);
});

test('editing appointments through existing helpers preserves newly saved groceries and ideas', () => {
  const original = freeze(fullData());
  const edited = Data.upsertAppointment(original, appointment({ title: 'Piano with teacher' }));
  const skipped = Data.removeAppointment(edited, 'piano-lesson', '2026-11-11', 'occurrence');
  const removed = Data.removeAppointment(skipped, 'piano-lesson');
  for (const data of [edited, skipped, removed]) {
    assert.deepEqual(data.shoppingList, original.shoppingList);
    assert.deepEqual(data.ideaNotes, original.ideaNotes);
  }
});

test('invalid list content is rejected before import or save can replace the prior records', () => {
  const original = fullData();
  const storage = storageWith({ [Data.STORAGE_KEY]: JSON.stringify(original) });
  const before = storage.snapshot();
  const invalid = [
    { shoppingList: {} }, { ideaNotes: null },
    { shoppingList: [item({ id: '<script>' })] },
    { shoppingList: [item({ id: 'x'.repeat(65) })] },
    { shoppingList: [item({ name: '   ' })] },
    { shoppingList: [item({ name: 'x'.repeat(161) })] },
    { shoppingList: [item({ quantity: 3 })] },
    { shoppingList: [item({ quantity: 'x'.repeat(121) })] },
    { shoppingList: [item({ checked: 'false' })] },
    { shoppingList: [item({ createdAt: '2026-02-30T12:00:00Z' })] },
    { shoppingList: [item({ updatedAt: 'yesterday' })] },
    { shoppingList: [item(), item()] },
    { ideaNotes: [note({ id: 'a b' })] },
    { ideaNotes: [note({ title: 7 })] },
    { ideaNotes: [note({ title: 'x'.repeat(161) })] },
    { ideaNotes: [note({ body: [] })] },
    { ideaNotes: [note({ body: 'x'.repeat(20001) })] },
    { ideaNotes: [note({ title: '', body: ' \n ' })] },
    { ideaNotes: [note({ createdAt: null })] },
    { ideaNotes: [note(), note()] }
  ];
  for (const patch of invalid) {
    assert.throws(() => {
      const imported = Data.parseBackup(JSON.stringify({ ...Data.makeBackup(original), ...patch }));
      Data.saveData(storage, imported);
    });
    assert.deepEqual(storage.snapshot(), before);
  }
  assert.deepEqual(storage.writes, []);
});

test('list size limits fail rather than silently dropping a saved entry', () => {
  const groceryList = Array.from({ length: 2000 }, (_, index) => item({ id: `shopping-${index}` }));
  const notes = Array.from({ length: 500 }, (_, index) => note({ id: `idea-${index}` }));
  const filled = Data.normalizeData({ records: {}, shoppingList: groceryList, ideaNotes: notes });
  assert.equal(Data.upsertShoppingItem(filled, { id: 'shopping-1999', checked: true }).shoppingList.length, 2000);
  assert.equal(Data.upsertIdeaNote(filled, { id: 'idea-499', body: 'Edited' }).ideaNotes.length, 500);
  assert.throws(() => Data.upsertShoppingItem(filled, { id: 'shopping-new', name: 'Extra' }), /2,000/);
  assert.throws(() => Data.upsertIdeaNote(filled, { id: 'idea-new', body: 'Extra' }), /500/);
  assert.throws(() => Data.normalizeData({ records: {}, shoppingList: [...groceryList, item()] }), /2,000/);
  assert.throws(() => Data.normalizeData({ records: {}, ideaNotes: [...notes, note()] }), /500/);
});

test('invalid or future v4 data stays read-only even when valid older data is present', () => {
  for (const malformed of [
    { ...fullData(), shoppingList: [item({ checked: 'yes' })] },
    { ...fullData(), ideaNotes: [note({ body: 123 })] },
    { ...fullData(), version: 5 }
  ]) {
    const storage = storageWith({ [Data.STORAGE_KEY]: JSON.stringify(malformed), [Data.V3_KEY]: JSON.stringify(earlierData()) });
    const before = storage.snapshot();
    const loaded = Data.loadData(storage);
    assert.equal(loaded.readOnly, true);
    assert.equal(loaded.migrated, false);
    assert.equal(loaded.sourceKey, Data.STORAGE_KEY);
    assert.deepEqual(storage.snapshot(), before);
    assert.deepEqual(storage.writes, []);
  }
  assert.throws(() => Data.normalizeData({ ...fullData(), version: 5 }), /different app version/);
  assert.throws(() => Data.parseBackup(JSON.stringify({ ...Data.makeBackup(fullData()), version: 5 })));
});

test('missing imported list timestamps remain unknown across normalization and edits', () => {
  const data = Data.normalizeData({ records: {}, shoppingList: [{ id: 'old-item', name: 'Rice' }], ideaNotes: [{ id: 'old-note', body: 'An earlier thought.' }] });
  assert.equal(data.shoppingList[0].createdAt, '');
  assert.equal(data.shoppingList[0].updatedAt, '');
  assert.equal(data.ideaNotes[0].createdAt, '');
  assert.deepEqual(Data.normalizeData(data), data);
  assert.deepEqual(Data.parseBackup(JSON.stringify(Data.makeBackup(data))), data);
  assert.equal(Data.upsertShoppingItem(data, { id: 'old-item', checked: true }).shoppingList[0].createdAt, '');
  assert.equal(Data.upsertIdeaNote(data, { id: 'old-note', title: 'A title' }).ideaNotes[0].createdAt, '');
});

test('failed saves of grocery or ideas changes retain the exact prior stored copy', () => {
  const original = freeze(fullData());
  const originalText = JSON.stringify(original);
  const storage = storageWith({ [Data.STORAGE_KEY]: originalText }, true);
  for (const candidate of [
    Data.upsertShoppingItem(original, { id: 'shopping-milk', checked: true }),
    Data.removeShoppingItem(original, 'shopping-milk'),
    Data.upsertIdeaNote(original, { id: 'idea-garden', body: 'A new thought.' }),
    Data.removeIdeaNote(original, 'idea-garden')
  ]) {
    assert.throws(() => Data.saveData(storage, candidate), /quota/);
    assert.equal(storage.getItem(Data.STORAGE_KEY), originalText);
  }
  assert.deepEqual(Data.loadData(storage).data, original);
});
