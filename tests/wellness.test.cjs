'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Wellness = require('../bloom-wellness.js');
const copy = value => JSON.parse(JSON.stringify(value));
const META = { household_id: 'house-one', user_id: null, revision: 1, archived: false, created_at: '2026-11-04T12:00:00Z' };
const settings = (person = 1, extra = {}) => ({ ...META, id: 'settings-' + person, kind: 'hydration_settings', person_slot: person, container_ml: 250, goal_ml: null, ...extra });
const entry = (id = 'water-one', extra = {}) => ({ ...META, id, kind: 'hydration_entry', person_slot: 1, occurred_on: '2026-11-04', amount_ml: 250, container_ml: 250, notes: '', ...extra });
const state = (extra = {}) => ({ status: 'ready', user: { id: 'owner' }, household: { id: 'house-one' }, offline: false, hydrationSettings: [], hydrationEntries: [], products: [], mealEntries: [], moneyEntries: [], ...extra });
function draftStore() {
  const values = new Map(), writes = [];
  return { values, writes,
    read(user, household, area) { return values.get(user + ':' + household + ':' + area); },
    write(user, household, area, data) { writes.push({ user, household, area, data: copy(data) }); values.set(user + ':' + household + ':' + area, { data: copy(data) }); return true; },
    clear(user, household, area) { values.delete(user + ':' + household + ':' + area); return true; }
  };
}
function harness(initial = state(), persistence = draftStore(), summaries = {}) {
  let current = copy(initial), consent = true, now = new Date('2026-11-04T17:00:00Z');
  const calls = [], notices = [], refreshes = [], links = [], foodLogs = [], dateChanges = [], methods = {};
  const store = { snapshot: () => current };
  for (const method of ['saveHydrationEntry', 'saveHydrationSettings', 'archiveLifeRecord', 'refresh']) store[method] = async (...args) => {
    calls.push({ method, args: copy(args) });
    if (methods[method]) return methods[method](...args);
    if (method === 'archiveLifeRecord') { current.hydrationEntries = current.hydrationEntries.map(row => row.id === args[0].id ? { ...row, archived: true, revision: row.revision + 1 } : row); return {}; }
    if (method === 'refresh') return current;
    const key = method === 'saveHydrationEntry' ? 'hydrationEntries' : 'hydrationSettings', value = args[0], id = value.id || value.request_id;
    const old = current[key].find(row => row.id === id);
    const saved = { ...META, ...copy(value), household_id: current.household.id, id, revision: old ? old.revision + 1 : 1, kind: key === 'hydrationEntries' ? 'hydration_entry' : 'hydration_settings' };
    current[key] = [...current[key].filter(row => row.id !== id), saved]; return saved;
  };
  const controller = Wellness.createController({ store, draftStore: persistence, getNow: () => now, confirm: () => consent, notify: (message, error) => notices.push({ message, error }), refresh: selector => refreshes.push(selector), navigate: page => { links.push(page); return true; }, onDateChange: date => dateChanges.push(date), openFoodLog: (productId, person) => foodLogs.push({ productId, person }), getHabitsSummary: () => summaries.habits || {}, getDogSummary: () => summaries.dog || {} });
  controller.renderWater();
  const click = (action, data = {}) => { let prevented = false; assert.equal(controller.handleClick({ target: { closest: () => ({ dataset: { wellnessAction: action, ...data } }) }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  const input = (name, value) => { const element = { dataset: { wellnessField: name }, value: String(value) }; assert.equal(controller.handleInput({ target: element }), true); return element.value; };
  const submit = (fields = {}) => { let prevented = false; assert.equal(controller.handleSubmit({ target: { dataset: { wellnessForm: 'water' }, elements: { namedItem: key => Object.hasOwn(fields, key) ? { value: String(fields[key]) } : null } }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  return { controller, calls, methods, notices, links, foodLogs, dateChanges, refreshes, persistence, click, input, submit, idle: () => controller.whenIdle(), get state() { return current; }, set state(value) { current = value; }, set now(value) { now = new Date(value); }, set consent(value) { consent = value; } };
}

test('water dates use New York midnight and reject impossible or unsupported dates', () => {
  assert.equal(Wellness.dayKey(new Date('2026-11-05T04:59:00Z')), '2026-11-04');
  assert.equal(Wellness.dayKey(new Date('2026-11-05T05:00:00Z')), '2026-11-05');
  assert.equal(Wellness.validDate('2028-02-29'), true);
  for (const value of ['2026-02-29', '2026-11-31', 'not a date', '1899-12-31', '2201-01-01']) assert.equal(Wellness.validDate(value), false);
});

test('each person’s amounts, containers and goals are independent and archived or foreign records are excluded', () => {
  const h = harness(state({ hydrationSettings: [settings(1, { container_ml: 500, goal_ml: 2000 }), settings(2, { container_ml: 300 })], hydrationEntries: [entry(), entry('two', { person_slot: 2, amount_ml: 300 }), entry('more', { amount_ml: 500 }), entry('removed', { amount_ml: 999, archived: true }), entry('other-house', { household_id: 'house-two', amount_ml: 999 }), entry('past', { occurred_on: '2026-11-03', amount_ml: 1000 })] }));
  const totals = h.controller.getHomeSummary('2026-11-04');
  assert.equal(totals[0].totalMl, 750); assert.equal(totals[0].containerCount, 1.5); assert.equal(totals[0].goalMl, 2000);
  assert.equal(totals[1].totalMl, 300); assert.equal(totals[1].containerCount, 1); assert.equal(totals[1].goalMl, null);
  assert.equal(h.controller.getHomeSummary()[0].totalMl, 750);
  assert.match(h.controller.renderWater(), /person-1/); assert.match(h.controller.renderWater(), /person-2/);
});

test('opening a clean water form does not create a log or prompt that data is unsaved', () => {
  const h = harness(); h.click('custom', { person: '1', date: '2026-11-04' });
  assert.equal(h.calls.length, 0); assert.equal(h.controller.hasUnsavedDraft(), false); assert.equal(h.controller.hasUnpersistedChanges(), false);
  assert.equal(h.controller.getHomeSummary('2026-11-04')[0].logged, false);
  assert.match(h.controller.renderWater(), /Daily goal not set/);
});

test('typing a water note and amount saves the draft without replacing input nodes', async () => {
  const h = harness(); h.click('custom', { person: '2', date: '2026-11-04' });
  const before = h.refreshes.length;
  for (const value of ['W', 'Wa', 'Wat', 'Water after lunch']) h.input('notes', value);
  h.input('amount_ml', '375.5');
  assert.equal(h.refreshes.length, before);
  assert.equal(h.persistence.writes.at(-1).data.form.notes, 'Water after lunch');
  h.submit(); await h.idle();
  assert.equal(h.calls[0].args[0].person_slot, 2); assert.equal(h.calls[0].args[0].amount_ml, 375.5);
  assert.equal(h.controller.getHomeSummary('2026-11-04')[1].totalMl, 375.5);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('quick add uses that person’s saved container and a stable identity without duplicating after retry and reload', async () => {
  const persistence = draftStore(), h = harness(state({ hydrationSettings: [settings(2, { container_ml: 500 })] }), persistence);
  h.methods.saveHydrationEntry = () => { throw new Error('Response lost'); };
  h.click('add', { person: '2', date: '2026-11-04' }); await h.idle();
  const exact = h.calls[0].args[0];
  assert.equal(exact.amount_ml, 500); assert.equal(exact.container_ml, 500); assert.equal(exact.person_slot, 2);
  assert.match(exact.request_id, /^[0-9a-f-]{36}$/);
  h.input('amount_ml', 999);
  const reloaded = harness(state(), persistence); reloaded.click('retry'); await reloaded.idle();
  assert.deepEqual(reloaded.calls[0].args[0], exact);
  assert.equal(reloaded.state.hydrationEntries.length, 1); assert.equal(reloaded.state.hydrationEntries[0].amount_ml, 500);
});

test('entry and setting bounds match the database and optional goals remain unknown', async () => {
  const h = harness(); h.click('settings', { person: '1' });
  h.submit({ container_ml: 10000, goal_ml: 30000 }); await h.idle();
  assert.equal(h.state.hydrationSettings[0].goal_ml, 30000);
  h.click('settings', { person: '1' });
  h.submit({ container_ml: 250, goal_ml: '' }); await h.idle();
  assert.equal(h.state.hydrationSettings[0].goal_ml, null);
  h.click('settings', { person: '1' }); const before = h.calls.length;
  for (const fields of [{ container_ml: 0 }, { container_ml: 10000.1 }, { container_ml: 250, goal_ml: 0 }, { goal_ml: 30001 }, { goal_ml: 'Infinity' }]) { h.submit(fields); await h.idle(); }
  assert.equal(h.calls.length, before);
  h.click('close'); h.click('custom', { person: '1', date: '2026-11-04' });
  for (const fields of [{ amount_ml: 0 }, { amount_ml: 30001 }, { amount_ml: 'NaN' }, { amount_ml: 250, occurred_on: '2026-11-05' }, { occurred_on: '1899-01-01' }]) { h.submit(fields); await h.idle(); }
  assert.equal(h.calls.length, before);
  h.submit({ amount_ml: 30000, occurred_on: '2026-11-04' }); await h.idle();
  assert.equal(h.state.hydrationEntries[0].amount_ml, 30000);
});

test('undo removes an entry from shared daily totals while retaining its visible archived history and an unrelated draft', async () => {
  const h = harness(state({ hydrationEntries: [entry('one', { notes: 'Morning <water>' })] }));
  h.click('custom', { person: '2', date: '2026-11-04' }); h.input('notes', 'Keep Person 2 draft'); h.input('amount_ml', 300);
  h.click('remove', { id: 'one' }); await h.idle();
  assert.equal(h.state.hydrationEntries[0].archived, true);
  assert.equal(h.controller.getHomeSummary('2026-11-04')[0].totalMl, 0);
  const html = h.controller.renderWater();
  assert.match(html, /Archived water entries|Removed water entries/);
  assert.match(html, /Morning &lt;water&gt;/); assert.match(html, /Keep Person 2 draft/);
  h.submit(); await h.idle(); assert.equal(h.state.hydrationEntries.find(row => !row.archived).person_slot, 2);
});

test('undo requires confirmation and never removes a record from another household', async () => {
  const h = harness(state({ hydrationEntries: [entry(), entry('foreign', { household_id: 'house-two' })] }));
  h.consent = false; h.click('remove', { id: 'water-one' }); await h.idle(); assert.equal(h.calls.length, 0);
  h.consent = true; h.click('remove', { id: 'foreign' }); await h.idle(); assert.equal(h.calls.length, 0);
});

test('a clean open form advances at New York midnight, while a typed draft stays on its original day', () => {
  const h = harness(); h.click('custom', { person: '1', date: '2026-11-04' });
  h.now = '2026-11-05T04:59:59Z'; assert.match(h.controller.renderWater(), /name="occurred_on"[^>]*value="2026-11-04"/);
  h.now = '2026-11-05T05:00:00Z'; assert.match(h.controller.renderWater(), /name="occurred_on"[^>]*value="2026-11-05"/);
  assert.equal(h.controller.hasUnsavedDraft(), false);
  const dirty = harness(); dirty.click('custom', { person: '1', date: '2026-11-04' }); dirty.input('notes', 'Finish this day'); dirty.now = '2026-11-05T05:00:00Z';
  assert.match(dirty.controller.renderWater(), /name="occurred_on"[^>]*value="2026-11-04"/);
  assert.equal(dirty.controller.getSelectedDate(), '2026-11-04');
});

test('canceling replacement of a water draft preserves its original selected date and text', () => {
  const h = harness(); h.input('selectedDate', '2026-11-03'); h.click('custom', { person: '1', date: '2026-11-03' }); h.input('notes', 'Earlier day');
  h.consent = false; h.click('custom', { person: '2', date: '2026-11-04' });
  assert.equal(h.controller.getSelectedDate(), '2026-11-03');
  assert.match(h.controller.renderWater(), /Earlier day/);
});

test('the shared Wellness date emits user changes once and an external date setter preserves a restored draft date', () => {
  const persistence = draftStore(), h = harness(state(), persistence);
  h.click('custom', { person: '1', date: '2026-11-04' }); h.input('notes', 'A draft for November 4');
  h.input('selectedDate', '2026-11-03'); h.input('selectedDate', '2026-11-03');
  assert.deepEqual(h.dateChanges, ['2026-11-03']);
  assert.equal(h.controller.setSelectedDate('2026-11-02'), true);
  assert.equal(h.controller.getSelectedDate(), '2026-11-02');
  assert.deepEqual(h.dateChanges, ['2026-11-03']);
  const restored = harness(state(), persistence);
  assert.equal(restored.controller.setSelectedDate('2026-11-01'), true);
  assert.match(restored.controller.renderWater(), /name="occurred_on"[^>]*value="2026-11-04"/);
  assert.match(restored.controller.renderWater(), /A draft for November 4/);
  assert.equal(restored.controller.setSelectedDate('not a date'), false);
});

test('future Wellness days can be viewed but their water add controls cannot create actual entries', async () => {
  const h = harness();
  h.input('selectedDate', '2026-11-09');
  assert.equal(h.controller.getSelectedDate(), '2026-11-09');
  assert.deepEqual(h.dateChanges, ['2026-11-09']);
  const html = h.controller.renderWater();
  assert.match(html, /Wellness date/); assert.match(html, /Viewing a future day/);
  assert.match(html, /data-wellness-action="add"[^>]*disabled/);
  assert.match(html, /data-wellness-action="custom"[^>]*disabled/);
  h.click('add', { person: '1', date: '2026-11-09' }); await h.idle();
  h.click('custom', { person: '2', date: '2026-11-09' }); await h.idle();
  assert.equal(h.calls.length, 0); assert.equal(h.state.hydrationEntries.length, 0);
  assert.doesNotMatch(h.controller.renderWater(), /data-wellness-form="water"/);
});

test('saving a custom water date synchronizes the visible day when the user has not changed views during the request', async () => {
  const h = harness(); h.click('custom', { person: '1', date: '2026-11-04' });
  h.submit({ occurred_on: '2026-11-03', amount_ml: 300 }); await h.idle();
  assert.equal(h.controller.getSelectedDate(), '2026-11-03');
  assert.deepEqual(h.dateChanges, ['2026-11-03']);
  assert.equal(h.state.hydrationEntries[0].occurred_on, '2026-11-03');
});

test('setter-only viewing changes during a pending save keep its exact payload and prevent a late date override', async () => {
  const h = harness(); let complete;
  h.methods.saveHydrationEntry = () => new Promise(resolve => { complete = resolve; });
  h.click('custom', { person: '1', date: '2026-11-04' }); h.submit({ occurred_on: '2026-11-03', amount_ml: 300 });
  await Promise.resolve(); const exact = copy(h.calls[0].args[0]);
  assert.equal(h.controller.setSelectedDate('2026-11-07'), true);
  assert.match(h.controller.renderWater(), /name="occurred_on"[^>]*value="2026-11-03"/);
  assert.equal(h.controller.setSelectedDate('2026-11-04'), true, 'even changing away and back counts as a new view choice');
  assert.deepEqual(h.dateChanges, []);
  complete({}); await h.idle();
  assert.equal(h.controller.getSelectedDate(), '2026-11-04');
  assert.deepEqual(h.calls[0].args[0], exact); assert.deepEqual(h.dateChanges, []);
});

test('offline quick add remains a reviewable draft until reconnected and saved', async () => {
  const h = harness(state({ offline: true }));
  h.click('add', { person: '1', date: '2026-11-04' }); await h.idle();
  assert.equal(h.calls.length, 0); assert.match(h.controller.renderWater(), /Log water you drank/);
  h.state = { ...h.state, offline: false }; h.submit(); await h.idle();
  assert.equal(h.state.hydrationEntries.length, 1); assert.equal(h.state.hydrationEntries[0].amount_ml, 250);
});

test('a local storage exception preserves the live draft and produces an actionable warning', () => {
  const persistence = draftStore(); persistence.write = () => { throw new Error('Quota exceeded'); };
  const h = harness(state(), persistence); h.click('custom', { person: '1' });
  assert.doesNotThrow(() => h.input('notes', 'Still here'));
  assert.equal(h.controller.hasUnpersistedChanges(), true); assert.match(h.controller.renderWater(), /Still here/);
  assert.match(h.notices.at(-1).message, /could not save your water draft/);
  const brokenRead = draftStore(); brokenRead.read = () => { throw new Error('Storage blocked'); };
  assert.doesNotThrow(() => harness(state(), brokenRead));
});

test('a temporary store error does not lose the exact pending request or reset account identity', async () => {
  const h = harness();
  h.methods.saveHydrationEntry = () => { h.state = { ...h.state, status: 'error' }; throw new Error('Could not refresh records'); };
  h.click('add', { person: '1', date: '2026-11-04' }); await h.idle();
  assert.equal(h.controller.hasUnsavedDraft(), true);
  h.state = { ...h.state, status: 'ready' };
  const exact = h.calls[0].args[0];
  h.methods.saveHydrationEntry = payload => { h.state.hydrationEntries.push(entry(payload.request_id, payload)); return {}; };
  h.click('retry'); await h.idle(); assert.deepEqual(h.calls[1].args[0], exact);
});

test('switching accounts before the request starts prevents old water drafts being submitted under the new account', async () => {
  const h = harness(); h.click('add', { person: '1', date: '2026-11-04' });
  h.state = state({ user: { id: 'member' } }); h.controller.renderWater(); await h.idle();
  assert.equal(h.calls.length, 0); assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('a late response cannot clear the new account’s draft or issue a misleading saved notice', async () => {
  const h = harness(); let complete;
  h.methods.saveHydrationEntry = () => new Promise(resolve => { complete = resolve; });
  h.click('add', { person: '1', date: '2026-11-04' }); await Promise.resolve();
  h.state = state({ user: { id: 'member' } }); h.controller.renderWater(); h.click('custom', { person: '2' }); h.input('notes', 'Member draft');
  complete({}); await h.idle();
  assert.match(h.controller.renderWater(), /Member draft/);
  assert.equal(h.notices.some(row => /Water saved/.test(row.message)), false);
  assert.equal(h.persistence.values.get('owner:house-one:wellness').data.pending.payload.person_slot, 1);
});

test('Home Boost uses actual active portions for the chosen person and not planned, archived, or other-household records', () => {
  const current = state({ products: [{ household_id: 'house-one', id: 'boost', category: 'food', name: 'BOOST Plus Chocolate' }], mealEntries: [
    { household_id: 'house-one', product_id: 'boost', kind: 'eaten', person_slot: 1, occurred_on: '2026-11-04', servings: 2 },
    { household_id: 'house-one', product_id: 'boost', kind: 'planned', person_slot: 1, occurred_on: '2026-11-04', servings: 9 },
    { household_id: 'house-one', product_id: 'boost', kind: 'eaten', person_slot: 2, occurred_on: '2026-11-04', servings: 3 },
    { household_id: 'house-one', product_id: 'boost', kind: 'eaten', person_slot: 1, occurred_on: '2026-11-04', servings: 8, archived: true },
    { household_id: 'house-two', product_id: 'boost', kind: 'eaten', person_slot: 1, occurred_on: '2026-11-04', servings: 7 }
  ] });
  const h = harness(current);
  assert.equal(Wellness.boostSummary(current, '2026-11-04', 1).servings, 2);
  assert.equal(Wellness.boostSummary(current, '2026-11-04', 2).servings, 3);
  assert.match(h.controller.renderHome(), /2 servings/);
  h.click('boost', { product: 'boost' }); assert.deepEqual(h.foodLogs, [{ productId: 'boost', person: 1 }]);
});

test('Home uses real monthly expense records and labels smoking estimates without importing screenshot prices', () => {
  const h = harness(state({ moneyEntries: [
    { household_id: 'house-one', direction: 'expense', occurred_on: '2026-11-04', amount_cents: 1234 },
    { household_id: 'house-one', direction: 'income', occurred_on: '2026-11-04', amount_cents: 50000 },
    { household_id: 'house-one', direction: 'expense', occurred_on: '2026-10-31', amount_cents: 8888 },
    { household_id: 'house-one', direction: 'expense', occurred_on: '2026-11-04', amount_cents: 9999, voided_at: '2026-11-04' },
    { household_id: 'house-two', direction: 'expense', occurred_on: '2026-11-04', amount_cents: 2222 }
  ] }), draftStore(), { habits: { dueSkills: 2, practiceMinutes: 15, smokingDay: { joints: 0, cigars: 0 }, smokingEstimate: { dailyCents: 0, baselineCents: 800, savingsCents: 800 } }, dog: { dogName: '<Clover>', dueCount: 3, completedCount: 2 } });
  const html = h.controller.renderHome({ personalAvailable: true, today: '2026-11-03', sleepText: 'Sleep not logged yet', moodCount: 0, noteCount: 2, grocerySummary: { title: '4 items to buy' } });
  assert.match(html, /\$12\.34/); assert.match(html, /\$8\.00/); assert.match(html, /estimated smoking cost below your baseline today/);
  assert.match(html, /0 joints · 0 cigars/); assert.match(html, /2 reviews due/); assert.match(html, /15 practice minutes/); assert.match(html, /&lt;Clover&gt;/);
  assert.match(html, /data-date="2026-11-03"/); assert.match(html, /4 items to buy/);
  assert.doesNotMatch(html, /\$62\.93|1,887\.86|11 hours/);
});

test('Home missing smoking records remain unknown and do not imply reference prices were missing', () => {
  const h = harness(); const html = h.controller.renderHome();
  assert.match(html, /Not logged today/); assert.doesNotMatch(html, /0 joints · 0 cigars/);
  assert.match(html, /Log your smoking day/);
  assert.doesNotMatch(html, /Add smoking reference prices/);
});

test('signed-out Home and Wellness do not show stale household records', () => {
  const h = harness(state({ user: null, household: null, hydrationEntries: [entry('secret', { notes: 'Hidden household note' })] }));
  assert.match(h.controller.renderWater(), /sign-in/i); assert.doesNotMatch(h.controller.renderWater(), /Hidden household note/);
  assert.match(h.controller.renderHome(), /Open sign-in/);
  h.click('signin'); assert.deepEqual(h.links, ['grocery']);
});
