'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../bloom-dog-model.js');
const Dog = require('../bloom-dog.js');
const task = (changes = {}) => ({ id: 'care-one', revision: 1, domain: 'dog', name: 'Morning meal', category: 'feeding', frequency: 'daily', interval_days: 1, interval_months: 1, anchor_on: '2026-11-01', end_on: null, times: ['07:30'], rolling: true, active: true, dose_text: '', notes: '', ...changes });
const supply = (changes = {}) => ({ id: 'supply-one', revision: 1, product_id: 'dog-food', name: 'Dog food', unit_label: 'roll', stock_quantity: 2, refill_threshold: 1, needs_refill: false, reference_price_cents: 649, notes: '', ...changes });
const state = (changes = {}) => ({ status: 'ready', user: { id: 'owner' }, household: { id: 'house-one' }, members: [{ user_id: 'owner', role: 'owner' }, { user_id: 'member', role: 'member' }], dogProfiles: [], dogWeights: [], routineTasks: [], routineLogs: [], dogNotes: [], dogSupplies: [], dogStockEffects: [], products: [{ id: 'dog-food', name: 'Dog food', category: 'household', price_cents: 649 }, { id: 'rice', name: 'Rice', category: 'food' }], shoppingItems: [], receipts: [], ...changes });
function draftStorage() {
  const values = new Map();
  return { values, read(user, home, area) { return values.get(user + ':' + home + ':' + area); }, write(user, home, area, data) { values.set(user + ':' + home + ':' + area, { data: JSON.parse(JSON.stringify(data)) }); return true; }, clear(user, home, area) { values.delete(user + ':' + home + ':' + area); return true; } };
}
function harness(initial = state(), persistence = draftStorage()) {
  let current = initial, now = new Date('2026-11-04T17:00:00Z'), consent = true;
  const calls = [], notices = [], refreshes = [], links = [], downloads = [], methods = {};
  const lists = { saveDogProfile: 'dogProfiles', saveDogWeight: 'dogWeights', saveRoutineTask: 'routineTasks', saveRoutineLog: 'routineLogs', saveDogNote: 'dogNotes', saveDogSupply: 'dogSupplies' };
  const store = { snapshot: () => current };
  for (const method of [...Object.keys(lists), 'archiveLifeRecord', 'addDogSupplyToShopping', 'recordReceipt', 'refresh']) store[method] = async (...args) => {
    calls.push({ method, args: JSON.parse(JSON.stringify(args)) });
    if (methods[method]) return methods[method](...args);
    if (lists[method]) {
      const row = { ...args[0], revision: (args[0].revision || 0) + 1, last_request_id: args[0].request_id };
      if (method === 'saveRoutineLog') row.task_snapshot = (current.routineLogs.find(value => value.id === row.id) || {}).task_snapshot || { ...current.routineTasks.find(value => value.id === row.task_id) };
      const key = lists[method]; current = { ...current, [key]: [...current[key].filter(value => value.id !== row.id), row] };
      return row;
    }
    if (method === 'recordReceipt') { current = { ...current, receipts: [...current.receipts, args[0]] }; return args[0]; }
    return {};
  };
  const controller = Dog.createController({ store, draftStore: persistence, refresh: focus => refreshes.push(focus), notify: (message, error) => notices.push({ message, error }), navigate: page => links.push(page), openGrocery: (tab, month) => links.push('grocery:' + tab + (month ? ':' + month : '')), openReceipt: id => links.push('receipt:' + id), download: (name, content, mime) => downloads.push({ name, content, mime }), confirm: () => consent, getNow: () => now });
  controller.render();
  const click = (action, extra = {}) => { let prevented = false; const element = { dataset: { dogAction: action, ...extra } }; assert.equal(controller.handleClick({ target: { closest: () => element }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  const input = (field, value) => assert.equal(controller.handleInput({ type: 'input', target: { dataset: { dogField: field }, value: String(value), checked: typeof value === 'boolean' ? value : undefined } }), true);
  const control = (name, value) => assert.equal(controller.handleChange({ target: { dataset: { dogControl: name }, value: String(value), checked: typeof value === 'boolean' ? value : undefined } }), true);
  const complete = (id, slot, checked) => assert.equal(controller.handleChange({ target: { dataset: { dogComplete: id, dogSlot: slot }, checked } }), true);
  const submit = (group, fields = {}) => { let prevented = false; assert.equal(controller.handleSubmit({ target: { dataset: { dogForm: group }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]), checked: typeof fields[name] === 'boolean' ? fields[name] : undefined } : null } }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  return { controller, calls, notices, refreshes, links, downloads, methods, persistence, click, input, control, complete, submit, idle: () => controller.whenIdle(), get state() { return current; }, set state(value) { current = value; }, set now(value) { now = new Date(value); }, set consent(value) { consent = value; } };
}

test('Dog opens with the supplied illustration and unknown personal data, and Housework shares its navigation', () => {
  const h = harness(); const html = h.controller.render('dog');
  assert.match(html, /icons\/dog-companion\.jpeg/);
  assert.match(html, /Date of birth not set/);
  assert.match(html, /Weight not recorded/);
  assert.doesNotMatch(html, /4 years old|0 kg/);
  h.click('housework'); assert.deepEqual(h.links, ['housework']);
  assert.match(h.controller.render('housework'), /Household chores and Dog care share one completion history/);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.controller.getHomeSummary('2026-11-04'), { dueCount: 0, completedCount: 0, dogName: 'Your dog', needsRefillCount: 0 });
});

test('reviewable care starters never create tasks or personal care logs until saved', async () => {
  const h = harness(); h.click('task-template', { template: 'coat' });
  const html = h.controller.render();
  assert.match(html, /Coat brush-through/); assert.match(html, /value="2"/);
  assert.equal(h.calls.length, 0);
  h.submit('task'); await h.idle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'saveRoutineTask');
  const value = h.calls[0].args[0];
  assert.equal(value.interval_days, 2); assert.equal(value.rolling, true); assert.equal(value.domain, 'dog');
  assert.deepEqual(value.times, []); assert.equal(h.state.routineLogs.length, 0);
});

test('medication directions, valid recurrence dates, and distinct time slots are required', async () => {
  const h = harness(); h.click('task-template', { template: 'medicine' });
  h.submit('task', { name: 'Medication from saved label' }); await h.idle();
  assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /prescribed directions/);
  h.submit('task', { dose_text: 'x'.repeat(501) }); await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('task', { dose_text: 'As written on the label', times_text: '08:00,08:00' }); await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('task', { times_text: '08:00, 20:00', end_on: '2026-11-03' }); await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('task', { end_on: '2026-12-01' }); await h.idle();
  assert.deepEqual(h.calls[0].args[0].times, ['08:00', '20:00']);
  assert.equal(h.calls[0].args[0].dose_text, 'As written on the label');
});

test('weight conversions preserve exact measurements and reject future dates and invalid weights', async () => {
  const h = harness(); h.click('new-weight');
  h.submit('weight', { weight: '10', weight_unit: 'lb', occurred_on: '2026-11-05' }); await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('weight', { weight: '301', weight_unit: 'kg', occurred_on: '2026-11-04' }); await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('weight', { weight: '10', weight_unit: 'lb', notes: 'Recorded after walk' }); await h.idle();
  assert.equal(h.calls[0].args[0].weight_kg, 4.5359237);
  assert.equal(h.calls[0].args[0].occurred_on, '2026-11-04');
  assert.match(h.controller.render(), /10 lb/);
});

test('Dog and Housework use one actual-day completion and preserve Person 2 attribution on undo', async () => {
  const h = harness(state({ routineTasks: [task()] }));
  assert.match(h.controller.render(), /data-dog-slot="07:30"/);
  assert.doesNotMatch(h.controller.render(), /\sdata-slot=/, 'Dog time slots must not trigger the Sleep click handler');
  h.click('person', { person: '2' }); h.complete('care-one', '07:30', true); await h.idle();
  const saved = h.calls[0].args[0];
  assert.equal(saved.person_slot, 2); assert.equal(saved.occurred_on, '2026-11-04'); assert.equal(saved.done, true);
  assert.equal(h.state.routineLogs.length, 1);
  const housework = h.controller.render('housework');
  assert.match(housework, /Person 2 completed this/); assert.match(housework, /data-dog-complete="care-one"[^>]*checked/);
  assert.equal(h.controller.getHomeSummary('2026-11-04').completedCount, 1);
  h.click('person', { person: '1' }); h.complete('care-one', '07:30', false); await h.idle();
  const undone = h.calls[1].args[0];
  assert.equal(undone.id, saved.id); assert.equal(undone.revision, 1); assert.equal(undone.person_slot, 2); assert.equal(undone.done, false);
  assert.equal(h.state.routineLogs.length, 1);
  h.control('date', '2026-11-05'); h.complete('care-one', '07:30', true); await h.idle();
  assert.equal(h.calls.length, 2, 'future plans cannot create completed care records');
  assert.match(h.notices.at(-1).message, /future/);
});

test('Housework custom chores have their own domain and Dog visibility can be filtered', async () => {
  const h = harness(state({ routineTasks: [task(), task({ id: 'chore', domain: 'housework', name: 'Vacuum' })] }));
  h.controller.render('housework'); h.control('show-dog', false);
  const html = h.controller.render('housework'); assert.match(html, /Vacuum/); assert.doesNotMatch(html, /data-dog-complete="care-one"/);
  h.click('new-task'); h.submit('task', { name: 'Kitchen counters' }); await h.idle();
  assert.equal(h.calls[0].args[0].domain, 'housework');
});

test('historical correction works after archival and displays the saved name and directions', async () => {
  const h = harness(state({ routineTasks: [task({ archived: true, active: false, name: 'Changed name' })], routineLogs: [{ id: 'old-log', revision: 2, task_id: 'care-one', occurred_on: '2026-11-01', slot: '07:30', person_slot: 2, done: true, task_snapshot: { domain: 'dog', name: 'Original name', dose_text: 'Original label directions', times: ['07:30'] } }] }));
  h.click('tab', { tab: 'history' });
  const html = h.controller.render(); assert.match(html, /Original name/); assert.match(html, /Original label directions/);
  h.click('undo-log', { id: 'old-log' }); await h.idle();
  assert.equal(h.calls[0].args[0].done, false); assert.equal(h.calls[0].args[0].occurred_on, '2026-11-01');
  assert.equal(h.calls[0].args[0].person_slot, 2);
});

test('typed notes save drafts without replacing the focused editor or inventing training duration', async () => {
  const h = harness(); h.click('new-note'); const refreshCount = h.refreshes.length;
  h.input('note.notes', 'Practice <stay>\nThen walk');
  assert.equal(h.refreshes.length, refreshCount);
  assert.equal(h.controller.hasUnpersistedChanges(), false);
  assert.match(h.controller.render(), /Practice &lt;stay&gt;\nThen walk/);
  h.submit('note', { kind: 'training' }); await h.idle();
  assert.equal(h.calls[0].args[0].minutes, null);
  assert.equal(h.calls[0].args[0].notes, 'Practice <stay>\nThen walk');
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('supply stock corrections are separate from purchases and cannot use a human food catalog product', async () => {
  const h = harness(); h.click('new-supply');
  h.submit('supply', { name: 'Pet supplies', unit_label: 'box', product_id: 'rice', stock_quantity: '0', refill_threshold: '1' }); await h.idle();
  assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /Household catalog product/);
  h.submit('supply', { product_id: '', reference_price: '' }); await h.idle();
  assert.equal(h.calls[0].method, 'saveDogSupply');
  assert.equal(h.calls[0].args[0].stock_quantity, 0); assert.equal(h.calls[0].args[0].product_id, null);
  assert.equal(h.calls[0].args[0].reference_price_cents, null);
  assert.equal(h.state.receipts.length, 0);
});

test('Dog list additions use one idempotent Household shopping request and no ledger write', async () => {
  const h = harness(state({ dogSupplies: [supply()] }));
  h.methods.addDogSupplyToShopping = () => { throw new Error('Connection lost'); };
  h.click('add-supply-shopping', { id: 'supply-one' }); await h.idle();
  const first = h.calls[0].args;
  assert.equal(first[1].month, '2026-11-01'); assert.equal(first[1].packs, 1);
  assert.match(first[1].request_id, /^[a-f0-9-]{36}$/);
  assert.equal(h.controller.hasUnsavedDraft(), true);
  h.methods.addDogSupplyToShopping = () => ({ id: 'shopping-one' });
  h.click('retry'); await h.idle();
  assert.deepEqual(h.calls[1].args, first);
  assert.equal(h.calls.every(row => row.method === 'addDogSupplyToShopping'), true);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('a purchase uses actual cost and the shopping revision captured when its form opened', async () => {
  const h = harness(state({ dogSupplies: [supply()], shoppingItems: [{ id: 'shop', revision: 3, product_id: 'dog-food', category: 'household', month: '2026-11-01', packs: 2, checked: false }] }));
  h.click('purchase-supply', { id: 'supply-one' });
  h.submit('purchase'); await h.idle(); assert.equal(h.calls.length, 0, 'the reference price is not charged automatically');
  h.state = { ...h.state, shoppingItems: [{ ...h.state.shoppingItems[0], revision: 4 }] };
  h.submit('purchase', { amount: '12.98', payer_slot: '2', store: 'Shop' }); await h.idle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'recordReceipt');
  const payload = h.calls[0].args[0];
  assert.equal(payload.payer_slot, 2); assert.equal(payload.purchased_on, '2026-11-04');
  assert.deepEqual(payload.items, [{ product_id: 'dog-food', name: 'Dog food', category: 'household', packs: 2, line_total_cents: 1298, shopping_item_id: 'shop', shopping_revision: 3 }]);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('uncertain purchase retries keep exact data across edits and reload, then use receipt readback', async () => {
  const persistence = draftStorage(), initial = state({ dogSupplies: [supply()] });
  const first = harness(initial, persistence); first.click('purchase-supply', { id: 'supply-one' });
  first.methods.recordReceipt = () => { throw new Error('Connection lost'); };
  first.submit('purchase', { amount: '6.49', packs: '1', notes: 'Original details' }); await first.idle();
  const request = first.calls[0].args[0];
  first.input('purchase.amount', '99');
  const restored = harness(initial, persistence);
  assert.match(restored.controller.render(), /Confirming your saved change/);
  restored.methods.recordReceipt = () => { throw new Error('Still disconnected'); };
  restored.click('retry'); await restored.idle();
  assert.deepEqual(restored.calls[0].args[0], request);
  restored.methods.refresh = () => { restored.state = { ...restored.state, receipts: [{ ...request }] }; };
  restored.click('check-result'); await restored.idle();
  assert.equal(restored.calls.filter(row => row.method === 'recordReceipt').length, 1);
  assert.equal(restored.controller.hasUnsavedDraft(), false);
});

test('stale purchase rejection keeps draft until an explicit reload captures fresh shopping data', async () => {
  const h = harness(state({ dogSupplies: [supply()], shoppingItems: [{ id: 'shop', revision: 1, product_id: 'dog-food', category: 'household', month: '2026-11-01', packs: 1, checked: false }] }));
  h.click('purchase-supply', { id: 'supply-one' });
  h.methods.recordReceipt = () => { throw Object.assign(new Error('Shopping item changed'), { code: '40001' }); };
  h.submit('purchase', { amount: '6.49' }); await h.idle();
  assert.match(h.controller.render(), /Reload purchase details/);
  const id = h.calls[0].args[0].id;
  h.methods.refresh = () => { h.state = { ...h.state, shoppingItems: [{ ...h.state.shoppingItems[0], revision: 2, packs: 3 }] }; };
  h.click('reload-form', { group: 'purchase' }); await h.idle();
  delete h.methods.recordReceipt;
  h.submit('purchase', { amount: '19.47' }); await h.idle();
  const second = h.calls.findLast(row => row.method === 'recordReceipt').args[0];
  assert.notEqual(second.id, id); assert.equal(second.items[0].shopping_revision, 2); assert.equal(second.items[0].packs, 3);
});

test('retrying a purchase reversed on another device does not claim its stock or spending was saved', async () => {
  const h = harness(state({ dogSupplies: [supply()] }));
  h.click('purchase-supply', { id: 'supply-one' });
  h.methods.recordReceipt = () => { throw new Error('Response lost'); };
  h.submit('purchase', { amount: '6.49' }); await h.idle();
  const request = h.calls[0].args[0];
  h.methods.recordReceipt = () => {
    const row = { ...request, voided_at: '2026-11-04T19:00:00Z' };
    h.state = { ...h.state, receipts: [row] }; return row;
  };
  h.click('retry'); await h.idle();
  assert.match(h.notices.at(-1).message, /purchase was reversed/);
  assert.equal(h.notices.some(row => /Purchase saved\./.test(row.message)), false);
  assert.match(h.controller.render(), /Reload purchase details/);
  assert.equal(h.controller.hasUnsavedDraft(), true);
});

test('offline edits remain account-scoped drafts and no save is attempted', async () => {
  const h = harness(state({ offline: true })); h.click('new-note'); h.input('note.notes', 'Offline observation');
  h.submit('note'); await h.idle(); assert.equal(h.calls.length, 0);
  assert.equal(h.controller.hasUnpersistedChanges(), false);
  h.state = state({ user: { id: 'member' } });
  assert.doesNotMatch(h.controller.render(), /Offline observation/);
  h.state = state({ offline: true }); assert.match(h.controller.render(), /Offline observation/);
});

test('account changes before the queued save starts prevent an old draft being sent to a new household', async () => {
  const h = harness(); h.click('new-note'); h.submit('note', { notes: 'Owner observation' });
  h.state = state({ user: { id: 'member' }, household: { id: 'house-two' } }); h.controller.render();
  await h.idle(); assert.equal(h.calls.length, 0);
  assert.doesNotMatch(h.controller.render(), /Owner observation/);
  h.state = state(); assert.match(h.controller.render(), /Owner observation/);
});

test('late responses from a former account cannot clear the current person’s draft', async () => {
  const h = harness(); let release;
  h.methods.saveDogNote = () => new Promise(resolve => { release = resolve; });
  h.click('new-note'); h.submit('note', { notes: 'Owner observation' });
  await Promise.resolve(); assert.equal(typeof release, 'function');
  h.state = state({ user: { id: 'member' } }); h.controller.render();
  h.click('new-note'); h.input('note.notes', 'Member observation');
  release({ id: 'saved-old' }); await h.idle();
  assert.match(h.controller.render(), /Member observation/);
  assert.equal(h.controller.hasUnsavedDraft(), true);
});

test('New York midnight advances the clean date picker while retaining a dirty draft’s date', () => {
  const h = harness();
  h.now = '2026-11-05T05:00:01Z'; assert.match(h.controller.render(), /data-dog-control="date"[^>]*value="2026-11-05"/);
  h.click('new-note'); h.input('note.notes', 'A note in progress');
  h.now = '2026-11-06T05:00:01Z'; assert.match(h.controller.render(), /data-dog-control="date"[^>]*value="2026-11-05"/);
  assert.match(h.controller.render(), /A note in progress/);
});

test('saved purchase history uses the original supply label and opens the exact receipt', () => {
  const h = harness(state({ dogSupplies: [supply({ name: 'Renamed current supply' })], receipts: [{ id: 'receipt-one', purchased_on: '2026-11-04', store: 'Store' }], dogStockEffects: [{ id: 'effect', receipt_id: 'receipt-one', supply_id: 'supply-one', purchased_on: '2026-11-04', supply_name: 'Original supply', unit_label: 'roll', quantity: 2, amount_cents: 1298 }] }));
  h.click('tab', { tab: 'history' }); const html = h.controller.render();
  assert.match(html, /Original supply/); assert.match(html, /2 roll · \$12.98/);
  h.click('open-receipt', { id: 'receipt-one' }); assert.deepEqual(h.links, ['receipt:receipt-one']);
});

test('care calendar export is a reminder download and creates no completed action', () => {
  const h = harness(state({ routineTasks: [task()] }));
  h.click('care-calendar', { id: 'care-one', dogSlot: '07:30', date: '2026-11-05' });
  assert.equal(h.downloads.length, 1); assert.match(h.downloads[0].content, /DTSTART:20261105T123000Z/);
  assert.equal(h.calls.length, 0); assert.equal(h.state.routineLogs.length, 0);
});
