'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../bloom-drafts.js');
function memory() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }

test('drafts restore only within the same account, household and screen area', () => {
  const storage = memory(), drafts = create({ storage });
  assert.equal(drafts.write('one', 'home', 'food', { name: 'Soup', servings: '4', ingredients: [] }), true);
  const restored = create({ storage });
  assert.equal(restored.read('one', 'home', 'food').data.name, 'Soup');
  assert.equal(restored.read('two', 'home', 'food'), null);
  assert.equal(restored.read('one', 'another', 'food'), null);
  assert.equal(restored.read('one', 'home', 'commerce'), null);
  assert.equal(restored.clear('one', 'home', 'food'), true);
  assert.equal(restored.read('one', 'home', 'food'), null);
});

test('drafts reject credentials and cannot claim success when device storage fails', () => {
  const storage = memory(), drafts = create({ storage });
  for (const value of [{ password: 'private' }, { deep: { access_token: 'private' } }, { items: [{ inviteCode: 'private' }] }]) {
    assert.equal(drafts.write('one', 'home', 'food', value), false);
    assert.equal(drafts.read('one', 'home', 'food'), null);
  }
  assert.equal(drafts.hasFailedWrites(), true);
  assert.equal(drafts.write('one', 'home', 'food', { name: 'Soup' }), true);
  assert.equal(drafts.hasFailedWrites(), false);
  const broken = create({ storage: { ...storage, setItem() { throw new Error('Quota full'); } } });
  assert.equal(broken.write('one', 'home', 'food', { name: 'Updated soup' }), false);
  assert.equal(broken.hasFailedWrites(), true);
  assert.equal(drafts.read('one', 'home', 'food').data.name, 'Soup');
});
