'use strict';

// Rendering and asynchronous interaction boundaries; these do not replace a visual browser check.
const test = require('node:test');
const assert = require('node:assert/strict');
const Grocery = require('../bloom-grocery.js');
const Model = require('../bloom-food-model.js');

function readyState(overrides = {}) {
  return {
    status: 'ready', user: { id: 'user-one', email: 'one@example.test' },
    household: { id: 'home-one', name: 'Our household' },
    members: [{ household_id: 'home-one', user_id: 'user-one', role: 'owner' }],
    privateProfile: null, dietProfiles: [], budgets: [], inventory: [], shoppingItems: [],
    ...overrides
  };
}
function harness(initial = readyState(), localItems = [], options = {}) {
  let current = initial;
  let confirmation = true;
  const calls = [];
  const notices = [];
  const refreshes = [];
  const methods = {};
  const store = { snapshot: () => current };
  for (const name of ['init', 'refresh', 'signIn', 'signUp', 'resetPassword', 'updatePassword', 'signOut', 'createHousehold', 'joinHousehold', 'createInvite', 'savePrivateProfile', 'saveDietProfile', 'saveBudget', 'saveInventory', 'deleteInventory', 'saveShoppingItem', 'toggleShoppingItem', 'deleteShoppingItem', 'importLocalShopping', 'exportHousehold', 'importHouseholdBackup']) {
    store[name] = async (...args) => {
      calls.push({ name, args });
      if (methods[name]) return methods[name](...args);
      return {};
    };
  }
  const controller = Grocery.createController({
    store, model: Model, getLocalShopping: () => localItems,
    refresh: selector => refreshes.push(selector), notify: (message, error) => notices.push({ message, error }),
    confirm: () => confirmation, getNow: () => new Date(2026, 10, 4, 12), ...options
  });
  controller.render();
  function input(key, value) { return controller.handleInput({ target: { dataset: { groceryField: key }, value } }); }
  function click(action, data = {}) {
    const element = { dataset: { groceryAction: action, ...data } };
    const handled = controller.handleClick({ target: { closest: () => element } });
    assert.equal(handled, true, action + ' must be synchronously handled');
    return handled;
  }
  function submit(kind, fields = {}) {
    let prevented = false;
    const handled = controller.handleSubmit({
      target: { dataset: { groceryForm: kind }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]) } : null } },
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true);
    assert.equal(handled, true);
    return handled;
  }
  function changeMonth(value) {
    const field = { dataset: { groceryMonth: '' }, value };
    assert.equal(controller.handleChange({ target: field }), true);
    return field;
  }
  return {
    controller, store, calls, notices, refreshes, methods, input, click, submit, changeMonth,
    get state() { return current; }, set state(value) { current = value; },
    set confirmation(value) { confirmation = value; },
    idle: () => controller.whenIdle()
  };
}

test('Grocery opens the shared shopping list with real counts and escaped household data', () => {
  const h = harness(readyState({
    household: { id: 'home-one', name: '<script>Bad()</script>' },
    shoppingItems: [
      { id: 'one', name: 'Eggs <large>', quantity: '1 pack', checked: false, revision: 2 },
      { id: 'two', name: 'Milk', quantity: '2 cartons', checked: true, revision: 1 }
    ]
  }));
  const html = h.controller.render();
  assert.match(html, /Your grocery list/);
  assert.match(html, /1 to buy/);
  assert.match(html, /&lt;script&gt;Bad\(\)&lt;\/script&gt;/);
  assert.match(html, /Eggs &lt;large&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-tab="list" aria-current="page"/);
  assert.deepEqual(h.controller.getHomeSummary(), { count: 1, title: '1 item to buy', description: 'Shared with <script>Bad()</script>', status: 'ready' });
  assert.equal(h.calls.length, 0);
});

test('a failed asynchronous save retains the draft and duplicate submits are blocked', async () => {
  const h = harness();
  let reject;
  h.methods.saveShoppingItem = () => new Promise((resolve, fail) => { reject = fail; });
  h.submit('shopping', { name: 'Bread <whole wheat>', quantity: '1 loaf' });
  assert.equal(h.controller.isBusy(), true);
  h.submit('shopping', { name: 'Ignored duplicate', quantity: '3 loaves' });
  await Promise.resolve();
  assert.equal(h.calls.length, 1);
  reject(new Error('Connection lost'));
  await h.idle();
  assert.equal(h.controller.isBusy(), false);
  assert.equal(h.controller.hasUnsavedDraft(), true);
  assert.match(h.controller.render(), /value="Bread &lt;whole wheat&gt;"/);
  assert.match(h.notices.at(-1).message, /Connection lost/);
  h.methods.saveShoppingItem = payload => {
    h.state = { ...h.state, shoppingItems: [{ ...payload, id: 'saved-item', revision: 1 }] };
  };
  h.submit('shopping');
  await h.idle();
  assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.equal(h.state.shoppingItems[0].name, 'Bread <whole wheat>');
  assert.match(h.controller.render(), /Bread &lt;whole wheat&gt;/);
});

test('checkbox updates carry the saved revision and do not claim a failed change succeeded', async () => {
  const row = { id: 'item-one', name: 'Tea', quantity: '', checked: false, revision: 7 };
  const h = harness(readyState({ shoppingItems: [row] }));
  h.methods.toggleShoppingItem = () => { throw new Error('Another person changed this item. Refresh and try again.'); };
  const field = { dataset: { groceryShoppingToggle: row.id }, checked: true };
  assert.equal(h.controller.handleChange({ target: field }), true);
  assert.equal(field.checked, false);
  await h.idle();
  assert.deepEqual(h.calls[0], { name: 'toggleShoppingItem', args: [row, true] });
  assert.equal(h.state.shoppingItems[0].checked, false);
  assert.match(h.notices.at(-1).message, /Another person changed/);
});

test('inventory saves exact fields, preserves its revision, and rejects invalid dates', async () => {
  const row = { id: 'stock-one', name: 'Rice', brand: '', quantity: 2, unit: 'lb', location: 'pantry', expires_on: null, notes: 'Opened', revision: 3 };
  const h = harness(readyState({ inventory: [row] }));
  h.click('tab', { tab: 'inventory' });
  h.click('edit-inventory', { id: row.id });
  h.submit('inventory', { quantity: '1.5', location: 'freezer', expires_on: '2026-02-30' });
  await h.idle();
  assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /valid package date/);
  h.submit('inventory', { quantity: '1.5', location: 'freezer', expires_on: '2026-11-20' });
  await h.idle();
  const { request_id, ...saved } = h.calls[0].args[0];
  assert.match(request_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(saved, { id: row.id, revision: 3, name: 'Rice', brand: '', quantity: 1.5, unit: 'lb', location: 'freezer', expires_on: '2026-11-20', notes: 'Opened', product_id: null, frozen_on: null, opened_on: null, date_type: 'unknown', freezer_use_by: null, reminder_days: 3 });
});

test('budget uses exact cents and real months, while incomplete totals remain unknown', async () => {
  const h = harness(readyState({ budgets: [
    { month: '2026-10-01', amount_cents: 42037, currency: 'USD', revision: 2 },
    { month: '2026-11-01', amount_cents: 50000, currency: 'USD', revision: 1 }
  ], shoppingItems: [{ id: 'unpriced', name: 'Vegetables', month: '2026-11-01', category: 'food', checked: false, estimate_cents: null }] }));
  h.click('tab', { tab: 'budget' });
  let html = h.controller.render();
  assert.match(html, /November 2026/);
  assert.match(html, /\$500\.00/);
  assert.match(html, /incomplete/);
  assert.match(html, /Household/);
  assert.match(html, /Choose your amount/);
  assert.match(html, /\$0\.00/);
  h.submit('budget', { amount: '510.07' });
  await h.idle();
  assert.deepEqual(h.calls[0], { name: 'saveBudget', args: [{ month: '2026-11-01', amount_cents: 51007, household_amount_cents: null, currency: 'USD', revision: 1 }] });
  assert.equal(Grocery.centsFromInput('0'), 0);
  assert.equal(Grocery.centsFromInput('3.1'), 310);
  assert.throws(() => Grocery.centsFromInput('12.345'));
  assert.throws(() => Grocery.centsFromInput('-3'));
  h.click('tab', { tab: 'history' });
  html = h.controller.render();
  assert.match(html, /October 2026/);
  assert.match(html, /\$420\.37/);
  h.click('open-budget', { month: '2026-10' });
  assert.match(h.controller.render(), /value="420\.37"/);
});

test('changing months protects an unsaved budget and keeps history rows independent', () => {
  const h = harness(readyState({ budgets: [{ month: '2026-11-01', amount_cents: 50000, revision: 1 }] }));
  h.click('tab', { tab: 'budget' });
  h.controller.render();
  h.input('budget.amount', '600.55');
  h.confirmation = false;
  const field = h.changeMonth('2026-12');
  assert.equal(field.value, '2026-11');
  assert.match(h.controller.render(), /value="600\.55"/);
  h.confirmation = true;
  h.changeMonth('2026-12');
  const html = h.controller.render();
  assert.match(html, /December 2026/);
  assert.match(html, /Choose your amount/);
  assert.equal(h.state.budgets[0].amount_cents, 50000);
});

test('private measurements and shared nutrition profiles have separate payloads', async () => {
  const h = harness(readyState({
    privateProfile: { user_id: 'user-one', display_name: 'Private name', age_years: 29, height_cm: 165.1, weight_kg: 54.431, notes: 'Private observations', revision: 2 },
    dietProfiles: [{ user_id: 'user-one', household_id: 'home-one', display_name: 'Household name', calories_kcal: null, protein_g: 0, carbs_g: null, fat_g: null, fiber_g: null, color: 'pink', preferences: '', allergies: '', restrictions: '', notes: '', revision: 3 }]
  }));
  h.click('tab', { tab: 'profiles' });
  const html = h.controller.render();
  assert.match(html, /Visible only to your account/);
  assert.match(html, /Shared with your household/);
  assert.match(html, /Not set/);
  assert.match(html, /<dd>0 g<\/dd>/);
  h.submit('diet', { display_name: 'Public name', allergies: 'Check peanut labels', calories_kcal: '', protein_g: '75', color: 'purple' });
  await h.idle();
  const publicPayload = h.calls[0].args[0];
  assert.equal(publicPayload.calories_kcal, null);
  assert.equal(publicPayload.protein_g, 75);
  assert.equal(publicPayload.color, 'pink', 'Person 1 stays pink even if a form attempts to change the fixed role color');
  assert.equal(publicPayload.revision, 3);
  assert.equal(Object.hasOwn(publicPayload, 'height_cm'), false);
  assert.equal(Object.hasOwn(publicPayload, 'weight_kg'), false);
  assert.equal(Object.hasOwn(publicPayload, 'age_years'), false);
  assert.doesNotMatch(JSON.stringify(publicPayload), /Private observations/);
  h.submit('private', { height_value: '65', height_unit: 'in', weight_value: '120', weight_unit: 'lb' });
  await h.idle();
  const privatePayload = h.calls[1].args[0];
  assert.equal(privatePayload.height_cm, 165.1);
  assert.equal(privatePayload.weight_kg, 54.431);
  assert.equal(privatePayload.revision, 2);
  assert.equal(Object.hasOwn(privatePayload, 'allergies'), false);
});

test('profile rendering never uses another user’s private row and background refresh retains edits', () => {
  const h = harness(readyState({ privateProfile: { user_id: 'other-user', display_name: 'Secret other name', notes: 'Secret other note', revision: 9 } }));
  h.click('tab', { tab: 'profiles' });
  assert.doesNotMatch(h.controller.render(), /Secret other/);
  h.input('diet.preferences', 'Keep my unsaved changes');
  h.state = { ...h.state, dietProfiles: [{ user_id: 'user-one', display_name: 'Updated remotely', preferences: 'Different', revision: 8 }] };
  const html = h.controller.render();
  assert.match(html, /Keep my unsaved changes/);
  assert.equal(h.controller.hasUnsavedDraft(), true);
});

test('copying a device list requires a reviewed household and sends only checklist fields', async () => {
  const local = [{ id: 'old-tea', name: 'Tea', quantity: '1 box', checked: false, records: { secret: 'sleep' }, ideaNotes: ['secret note'], notes: 'private extras' }];
  const h = harness(readyState(), local);
  h.controller.render();
  assert.equal(h.calls.length, 0);
  h.click('confirm-import');
  await h.idle();
  assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /Review the device list/);
  h.click('review-import');
  const html = h.controller.render();
  assert.match(html, /Copy 1 item to Our household/);
  assert.doesNotMatch(html, /secret note|private extras|secret.*sleep/);
  h.click('confirm-import');
  await h.idle();
  assert.deepEqual(h.calls[0], { name: 'importLocalShopping', args: [[{ id: 'old-tea', name: 'Tea', quantity: '1 box', checked: false }]] });
  assert.equal(local[0].records.secret, 'sleep');
  assert.equal(local.length, 1);
});

test('changing account clears reviewed imports and private drafts before any new render', async () => {
  const h = harness(readyState(), [{ id: 'old-item', name: 'Old household item', quantity: '', checked: false }]);
  h.click('review-import');
  h.input('private.notes', 'Keep this only with first account');
  h.state = readyState({ user: { id: 'user-two', email: 'two@example.test' }, household: { id: 'home-two', name: 'Other household' }, members: [{ user_id: 'user-two', role: 'owner' }] });
  h.click('confirm-import');
  await h.idle();
  assert.equal(h.calls.length, 0);
  h.click('tab', { tab: 'profiles' });
  assert.doesNotMatch(h.controller.render(), /Keep this only with first account/);
});

test('late save completion cannot clear a different account’s new draft', async () => {
  const h = harness();
  let finish;
  h.methods.saveShoppingItem = () => new Promise(resolve => { finish = resolve; });
  h.submit('shopping', { name: 'First account item', quantity: '1' });
  await Promise.resolve();
  h.state = readyState({ user: { id: 'user-two' }, household: { id: 'home-two', name: 'Second home' } });
  h.controller.render();
  h.input('shopping.name', 'Second account unsaved item');
  finish({});
  await h.idle();
  assert.match(h.controller.render(), /value="Second account unsaved item"/);
  assert.equal(h.controller.hasUnsavedDraft(), true);
  assert.equal(h.notices.some(notice => /was saved/.test(notice.message)), false);
});

test('signup clears the password after success and maps email-delivery setup errors', async () => {
  const h = harness({ status: 'signed-out', user: null });
  h.click('auth-mode', { groceryMode: 'signup' });
  h.methods.signUp = () => { throw new Error('Email address not authorized'); };
  h.submit('auth', { email: 'person@example.test', password: 'a-long-password-value', confirmation: 'a-long-password-value' });
  await h.idle();
  assert.match(h.notices.at(-1).message, /Email delivery for new accounts still needs/);
  assert.match(h.controller.render(), /person@example.test/);
  h.methods.signUp = () => ({});
  h.submit('auth');
  await h.idle();
  const html = h.controller.render();
  assert.doesNotMatch(html, /a-long-password-value/);
  assert.match(h.notices.at(-1).message, /Check your email/);
});

test('deletion needs an explicit confirmation and carries the revision being removed', async () => {
  const row = { id: 'remove-one', name: 'Milk', quantity: '1 carton', checked: false, revision: 5 };
  const h = harness(readyState({ shoppingItems: [row] }));
  h.click('confirm-delete', { kind: 'shopping', id: row.id });
  assert.equal(h.calls.length, 0);
  h.click('delete-shopping', { id: row.id });
  assert.match(h.controller.render(), /Remove Milk\?/);
  h.click('keep-item');
  assert.doesNotMatch(h.controller.render(), /Remove Milk\?/);
  h.click('delete-shopping', { id: row.id });
  h.click('confirm-delete', { kind: 'shopping', id: row.id });
  await h.idle();
  assert.deepEqual(h.calls[0], { name: 'deleteShoppingItem', args: [row] });
});

test('unrelated application events remain unhandled and signed-out writes are refused', async () => {
  const h = harness({ status: 'signed-out', user: null });
  assert.equal(h.controller.handleClick({ target: { closest: () => ({ dataset: { pageAction: 'open-day' } }) } }), false);
  assert.equal(h.controller.handleSubmit({ target: { dataset: { bloomForm: 'idea' } } }), false);
  assert.equal(h.controller.handleInput({ target: { dataset: { pageField: 'idea-title' }, value: 'A thought' } }), false);
  assert.equal(h.controller.handleChange({ target: { dataset: { shoppingToggle: 'old' }, checked: true } }), false);
  assert.doesNotMatch(h.controller.render(), /\bdata-mode=/);
  h.submit('shopping', { name: 'No account item' });
  await h.idle();
  assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /Sign in and open your household/);
});

test('sharing codes are shown only after the owner requests one, and no email is sent', async () => {
  const h = harness();
  h.methods.createInvite = () => ({ invite_code: 'safe-test-code', expires_at: '2026-11-06T12:00:00Z' });
  h.click('tab', { tab: 'household' });
  assert.doesNotMatch(h.controller.render(), /safe-test-code/);
  h.click('create-invite');
  await h.idle();
  assert.match(h.controller.render(), /value="safe-test-code"/);
  assert.deepEqual(h.calls.map(call => call.name), ['createInvite']);
  h.state = { ...h.state, members: [{ user_id: 'user-one', role: 'member' }] };
  h.click('create-invite');
  assert.equal(h.calls.length, 1);
  assert.match(h.notices.at(-1).message, /Only the household owner/);
});

test('household and nutrition boundaries match the database before a request is sent', async () => {
  const setup = harness(readyState({ status: 'no-household', household: null, members: [] }));
  setup.submit('household-create', { name: 'A'.repeat(81) });
  await setup.idle();
  assert.equal(setup.calls.length, 0);
  assert.match(setup.notices.at(-1).message, /Household name is too long/);
  setup.submit('household-create', { name: 'A'.repeat(80) });
  await setup.idle();
  assert.equal(setup.calls[0].args[0].length, 80);

  const h = harness();
  h.click('tab', { tab: 'profiles' });
  const html = h.controller.render();
  assert.match(html, /name="calories_kcal"[^>]*max="20000"/);
  assert.match(html, /name="protein_g"[^>]*max="2000"/);
  for (const [key, maximum] of [['calories_kcal', 20000], ['protein_g', 2000], ['carbs_g', 2000], ['fat_g', 2000], ['fiber_g', 2000]]) {
    h.click('clear-diet');
    h.submit('diet', { display_name: 'My profile', [key]: maximum + 1 });
    await h.idle();
    assert.equal(h.calls.length, 0, key + ' above maximum is rejected locally');
  }
  h.click('clear-diet');
  h.submit('diet', { display_name: 'My profile', calories_kcal: '20000', protein_g: '2000', carbs_g: '2000', fat_g: '2000', fiber_g: '2000' });
  await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[0].calories_kcal, 20000);
  assert.equal(h.calls[0].args[0].fiber_g, 2000);
});

test('private measurements require positive converted values within database limits', async () => {
  const h = harness();
  for (const fields of [
    { height_value: '0', height_unit: 'cm' },
    { height_value: '301', height_unit: 'cm' },
    { height_value: '119', height_unit: 'in' },
    { weight_value: '0', weight_unit: 'kg' },
    { weight_value: '701', weight_unit: 'kg' },
    { weight_value: '1544', weight_unit: 'lb' }
  ]) {
    h.click('clear-private');
    h.submit('private', fields);
    await h.idle();
    assert.equal(h.calls.length, 0);
    assert.match(h.notices.at(-1).message, /must be greater than 0/);
  }
  h.click('clear-private');
  h.submit('private', { height_value: '300', height_unit: 'cm', weight_value: '700', weight_unit: 'kg' });
  await h.idle();
  assert.equal(h.calls[0].args[0].height_cm, 300);
  assert.equal(h.calls[0].args[0].weight_kg, 700);
  h.submit('private', { height_value: '', height_unit: 'in', weight_value: '', weight_unit: 'lb' });
  await h.idle();
  assert.equal(h.calls[1].args[0].height_cm, null);
  assert.equal(h.calls[1].args[0].weight_kg, null);

  const measureField = { max: '118.11023622047244' };
  assert.equal(h.controller.handleChange({ target: {
    dataset: { groceryField: 'private.height_unit' }, value: 'cm',
    form: { elements: { namedItem: name => name === 'height_value' ? measureField : null } }
  } }), true);
  assert.equal(measureField.max, '300');
});

test('new-item request IDs survive failed retries and cannot be replaced by form fields', async () => {
  const h = harness();
  h.methods.saveShoppingItem = () => { throw new Error('Response lost after saving'); };
  h.submit('shopping', { name: 'Rice', quantity: '1 bag' });
  await h.idle();
  const firstId = h.calls[0].args[0].request_id;
  assert.match(firstId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(h.input('shopping.request_id', 'tampered'), false);
  h.submit('shopping', { request_id: 'tampered' });
  await h.idle();
  assert.equal(h.calls[1].args[0].request_id, firstId);
  h.click('clear-shopping');
  h.submit('shopping', { name: 'Bread' });
  await h.idle();
  assert.notEqual(h.calls[2].args[0].request_id, firstId);
  const secondId = h.calls[2].args[0].request_id;
  h.methods.saveShoppingItem = () => ({});
  h.submit('shopping');
  await h.idle();
  assert.equal(h.calls[3].args[0].request_id, secondId);
  h.submit('shopping', { name: 'Oats' });
  await h.idle();
  assert.notEqual(h.calls[4].args[0].request_id, secondId);

  h.methods.saveInventory = () => { throw new Error('Inventory response lost'); };
  h.submit('inventory', { name: 'Beans', quantity: '2' });
  await h.idle();
  const inventoryId = h.calls.at(-1).args[0].request_id;
  h.submit('inventory', { request_id: 'tampered' });
  await h.idle();
  assert.equal(h.calls.at(-1).args[0].request_id, inventoryId);
  h.controller.discardDraft();
  h.submit('inventory', { name: 'Beans', quantity: '2' });
  await h.idle();
  assert.notEqual(h.calls.at(-1).args[0].request_id, inventoryId);
});

test('historical shopping stays in its month while Home always counts this month', () => {
  const h = harness(readyState({ shoppingItems: [
    { id: 'old', name: 'October item', month: '2026-10-01', checked: false, category: 'food', estimate_cents: 250 },
    { id: 'now', name: 'November item', month: '2026-11-01', checked: false, category: 'food', estimate_cents: null },
    { id: 'future', name: 'December item', month: '2026-12-01', checked: false, category: 'household', estimate_cents: 0 }
  ] }));
  assert.match(h.controller.render(), /November item/); assert.doesNotMatch(h.controller.render(), /October item|December item/);
  h.changeMonth('2026-10'); assert.match(h.controller.render(), /October item/); assert.doesNotMatch(h.controller.render(), /November item/);
  assert.equal(h.controller.getHomeSummary().count, 1);
  h.state = readyState({ user: { id: 'new-user' }, household: { id: 'new-home' } });
  assert.match(h.controller.render(), /value="2026-11"/);
});

test('freezing preserves printed dates and requires saving a reviewed inventory draft', async () => {
  const h = harness(readyState({ inventory: [{ id: 'stock', name: 'Soup', quantity: 2, unit: 'cup', location: 'refrigerator', expires_on: '2026-11-06', date_type: 'use_by', opened_on: '2026-11-03', revision: 2 }] }));
  h.controller.selectTab('inventory'); h.click('freeze-inventory', { id: 'stock' });
  assert.equal(h.calls.length, 0); const html = h.controller.render();
  assert.match(html, /value="2026-11-04"/); assert.match(html, /value="2026-11-06"/);
  h.submit('inventory', { freezer_use_by: '2027-01-15' }); await h.idle();
  const row = h.calls[0].args[0]; assert.equal(row.location, 'freezer'); assert.equal(row.frozen_on, '2026-11-04'); assert.equal(row.expires_on, '2026-11-06'); assert.equal(row.opened_on, '2026-11-03'); assert.equal(row.freezer_use_by, '2027-01-15');
});

function householdBackup() {
  return { app: 'Life in Bloom Household', version: 1, household_id: 'home-one', exported_at: '2026-11-04T12:00:00Z', data: Object.fromEntries(['products', 'recurringProducts', 'budgets', 'inventory', 'shoppingItems', 'bills', 'recipes', 'mealEntries', 'receipts', 'moneyEntries', 'foodFiles'].map(key => [key, []])) };
}

test('household backup import previews same-household records and retains a failed restore for retry', async () => {
  const h = harness(); h.controller.selectTab('household');
  const data = householdBackup(); data.data.products.push({ id: 'sample', name: 'Sample' }); data.data.receipts.push({ id: 'receipt', total_cents: 500 });
  const choose = payload => h.controller.handleChange({ target: { dataset: { groceryHouseholdImport: '' }, files: [{ name: '<saved>.json', size: 1000, text: async () => JSON.stringify(payload) }] } });
  choose({ ...data, household_id: 'another-household' }); await h.idle(); assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /same household/);
  choose(data); await h.idle(); assert.equal(h.calls.length, 0);
  let html = h.controller.render(); assert.match(html, /Review &lt;saved&gt;\.json/); assert.match(html, /1 products · 1 receipts/); assert.match(html, /without recording the purchases again/);
  h.methods.importHouseholdBackup = () => { throw new Error('Existing record differs; nothing was changed.'); };
  h.click('restore-household'); await h.idle(); assert.equal(h.calls[0].name, 'importHouseholdBackup'); assert.deepEqual(h.calls[0].args[0], data);
  html = h.controller.render(); assert.match(html, /Restore missing records/); assert.match(html, /&lt;saved&gt;\.json/);
  h.methods.importHouseholdBackup = () => ({ skippedFiles: 1 }); h.click('restore-household'); await h.idle(); assert.equal(h.calls.length, 2); assert.match(h.notices.at(-1).message, /1 unavailable attachment/);
  assert.doesNotMatch(h.controller.render(), /Review &lt;saved&gt;/);
});

test('only an owner can import a household backup; export sends a reviewable data file', async () => {
  const downloads = [], h = harness(readyState(), [], { download: (data, name) => downloads.push({ data, name }) });
  const data = householdBackup(); h.methods.exportHousehold = () => data;
  h.click('export-household'); await h.idle(); assert.deepEqual(downloads[0].data, data); assert.match(downloads[0].name, /life-in-bloom-household-2026-11-04\.json/);
  h.state = { ...h.state, members: [{ user_id: 'user-one', role: 'member' }] };
  h.controller.handleChange({ target: { dataset: { groceryHouseholdImport: '' }, files: [{ name: 'backup.json', size: 100, text: async () => JSON.stringify(data) }] } });
  await h.idle(); assert.equal(h.calls.length, 1); assert.match(h.notices.at(-1).message, /Only the household owner/);
});

test('autosaved shopping drafts restore per account without authentication or sharing-code data', () => {
  const values = new Map(), draftStore = {
    read: (u, household, area) => values.get([u, household, area].join(':')),
    write: (u, household, area, data) => { values.set([u, household, area].join(':'), { data: structuredClone(data) }); return true; }
  };
  const h = harness(readyState(), [], { draftStore });
  h.input('auth.password', 'secret-password'); h.input('household.code', 'private-sharing-code'); h.input('shopping.name', 'Draft carrots');
  const saved = values.get('user-one:home-one:grocery'); assert.doesNotMatch(JSON.stringify(saved), /secret-password|private-sharing-code/);
  const restored = harness(readyState(), [], { draftStore }); assert.match(restored.controller.render(), /value="Draft carrots"/);
  const switched = harness(readyState({ user: { id: 'different-user' } }), [], { draftStore }); assert.doesNotMatch(switched.controller.render(), /Draft carrots/);
  assert.equal(restored.controller.hasUnpersistedChanges(), false);
});

test('use-soon opens the specific Food section and private measurements remain unavailable offline', () => {
  const opened = [], h = harness(readyState({ offline: true, privateProfile: null }), [], { openFood: tab => opened.push(tab) });
  h.controller.selectTab('inventory'); h.click('use-soon'); assert.deepEqual(opened, ['soon']);
  h.controller.selectTab('profiles'); const html = h.controller.render(); assert.doesNotMatch(html, /data-grocery-form="private"/); assert.match(html, /Reconnect/);
});

test('signout protects an unsaved attachment in another section without prompting for persisted drafts', async () => {
  let otherUnpersisted = true;
  const draftStore = { read: () => null, write: () => true };
  const h = harness(readyState(), [], { draftStore, hasOtherUnpersistedChanges: () => otherUnpersisted });
  h.confirmation = false; h.click('signout'); await h.idle(); assert.equal(h.calls.length, 0);
  otherUnpersisted = false; h.input('shopping.name', 'Persisted item draft');
  h.click('signout'); await h.idle(); assert.equal(h.calls[0].name, 'signOut');
});
