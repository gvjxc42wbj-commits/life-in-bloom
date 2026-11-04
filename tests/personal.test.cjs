'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../bloom-data.js');
const P = require('../bloom-personal.js');
function storage() {
  const values = new Map();
  return { values, getItem: k => values.has(k) ? values.get(k) : null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
}
const user = { id: '11111111-1111-4111-8111-111111111111' };
const other = { id: '22222222-2222-4222-8222-222222222222' };
function seed(s) {
  const data = D.normalizeData({ records: { '2026-11-04': { notes: 'Private reflection' } }, ideaNotes: [{ id: 'private', title: 'Private idea', body: 'Only me' }] });
  D.saveData(s, data);
  return s.getItem(D.STORAGE_KEY);
}
test('first sign-in requests explicit ownership and never copies personal content automatically', () => {
  const s = storage(); const raw = seed(s); const m = P.createManager(s);
  assert.equal(m.open(null).mode, 'legacy');
  const opened = m.open(user);
  assert.equal(opened.mode, 'choose');
  assert.equal(opened.loaded, undefined);
  assert.equal(m.marker().legacyOwner, null);
  assert.equal(m.scoped(user.id).getItem(D.STORAGE_KEY), null);
  assert.equal(s.getItem(D.STORAGE_KEY), raw);
  assert.equal(m.open(null).mode, 'locked');
});
test('explicit legacy claim preserves original and separates later accounts and signout', () => {
  const s = storage(); const raw = seed(s); const m = P.createManager(s);
  m.open(user);
  const owned = m.claimLegacy(user.id);
  assert.equal(owned.loaded.data.records['2026-11-04'].notes, 'Private reflection');
  assert.equal(s.getItem(D.STORAGE_KEY), raw);
  assert.equal(m.open(null).loaded, undefined);
  const next = m.open(other);
  assert.equal(next.mode, 'account');
  assert.deepEqual(next.loaded.data.records, {});
  assert.equal(next.loaded.data.ideaNotes.length, 0);
  assert.throws(() => m.claimLegacy(other.id), /another account/);
  D.saveData(next.storage, D.normalizeData({ records: { '2026-11-05': { notes: 'Second person' } } }));
  assert.equal(m.open(user).loaded.data.records['2026-11-05'], undefined);
});
test('start fresh retains the earlier journal for its eventual explicit owner', () => {
  const s = storage(); const raw = seed(s); const m = P.createManager(s);
  m.open(other); const fresh = m.startFresh(other.id);
  assert.deepEqual(fresh.loaded.data.records, {});
  assert.equal(m.marker().legacyOwner, null);
  assert.equal(s.getItem(D.STORAGE_KEY), raw);
  assert.equal(m.open(user).mode, 'choose');
  assert.equal(m.claimLegacy(user.id).loaded.data.ideaNotes.length, 1);
});
test('corrupt account ownership or source never silently resets or overwrites records', () => {
  const s = storage(); const raw = seed(s); const m = P.createManager(s);
  s.setItem(P.MARKER, 'broken');
  assert.equal(m.open(user).mode, 'locked');
  assert.equal(s.getItem(D.STORAGE_KEY), raw);
  s.removeItem(P.MARKER); s.setItem(D.STORAGE_KEY, 'broken');
  assert.throws(() => m.claimLegacy(user.id), /could not be opened/);
  assert.equal(m.scoped(user.id).getItem(D.STORAGE_KEY), null);
  assert.equal(s.getItem(D.STORAGE_KEY), 'broken');
});
test('v1 legacy migration copies to account without modifying original format', () => {
  const s = storage(); const raw = JSON.stringify({ '2026-11-04': { slots: { 0: 'sleep' } } });
  s.setItem(D.LEGACY_KEY, raw); const m = P.createManager(s);
  const owned = m.claimLegacy(user.id);
  assert.equal(owned.loaded.data.records['2026-11-04'].slots[0], 'sleep');
  assert.equal(s.getItem(D.STORAGE_KEY), null);
  assert.equal(s.getItem(D.LEGACY_KEY), raw);
});
