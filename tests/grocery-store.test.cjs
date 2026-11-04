'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../bloom-grocery-store.js');

const USER = { id: 'person-one', email: 'one@example.test', user_metadata: { ignored: 'not a permission' } };
const OTHER = { id: 'person-two', email: 'two@example.test' };
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function harness(options = {}) {
  const rows = {
    bloom_households: [{ id: 'house-one', name: 'Our household', owner_user_id: USER.id }],
    bloom_household_members: [{ household_id: 'house-one', user_id: USER.id, role: 'owner' }],
    bloom_private_profiles: [{ user_id: USER.id, display_name: 'One', weight_kg: 60, revision: 1 }],
    bloom_diet_profiles: [], bloom_budgets: [], bloom_inventory: [],
    bloom_shopping_items: [{ id: 'cloud-one', household_id: 'house-one', name: 'Rice', quantity: '1 bag', checked: false, revision: 1 }],
    ...copy(options.rows || {})
  };
  let session = options.signedOut ? null : { user: USER };
  let listener;
  let counter = 0;
  const calls = [];
  const changes = [];
  const controls = { beforeQuery: null, beforeSignOut: null, nextWriteError: null, nextReadError: null, afterWrite: null, limit: null };

  class Query {
    constructor(table) { this.table = table; this.operation = 'select'; this.filters = []; this.orders = []; this.start = 0; this.end = Infinity; this.payload = null; }
    select(columns, opts) { this.columns = columns; this.wantCount = Boolean(opts && opts.count); return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    order(key) { this.orders.push(key); return this; }
    range(start, end) { this.start = start; this.end = end; return this; }
    insert(payload) { this.operation = 'insert'; this.payload = copy(payload); return this; }
    update(payload) { this.operation = 'update'; this.payload = copy(payload); return this; }
    delete() { this.operation = 'delete'; return this; }
    upsert(payload, opts) { this.operation = 'upsert'; this.payload = copy(payload); this.upsertOptions = opts; return this; }
    then(resolve, reject) { return execute(this).then(resolve, reject); }
  }
  async function execute(query) {
    calls.push(copy({ table: query.table, operation: query.operation, filters: query.filters, payload: query.payload,
      start: query.start, end: query.end, upsertOptions: query.upsertOptions }));
    if (controls.beforeQuery) await controls.beforeQuery(query);
    const writing = query.operation !== 'select';
    const problem = writing ? controls.nextWriteError : controls.nextReadError;
    if (problem) {
      if (writing) controls.nextWriteError = null; else controls.nextReadError = null;
      return { data: null, error: { message: problem } };
    }
    const table = rows[query.table] || (rows[query.table] = []);
    const matches = row => query.filters.every(([key, value]) => row[key] === value);
    if (query.operation === 'select') {
      let result = table.filter(matches).map(copy);
      result.sort((a, b) => { for (const key of query.orders) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; } return 0; });
      const count = result.length;
      result = result.slice(query.start, query.end + 1);
      if (controls.limit) result = result.slice(0, controls.limit);
      return { data: result, error: null, count: query.wantCount ? count : null };
    }
    if (query.operation === 'update') {
      const result = [];
      for (const row of table.filter(matches)) { Object.assign(row, query.payload); row.revision++; result.push(copy(row)); }
      return { data: result, error: null };
    }
    if (query.operation === 'delete') {
      const result = table.filter(matches).map(copy);
      rows[query.table] = table.filter(row => !matches(row));
      return { data: result, error: null };
    }
    const result = [];
    for (const item of Array.isArray(query.payload) ? query.payload : [query.payload]) {
      const conflictKeys = query.upsertOptions && query.upsertOptions.onConflict.split(',');
      if (query.operation === 'upsert' && table.some(row => conflictKeys.every(key => row[key] === item[key]))) continue;
      const row = { id: 'generated-' + (++counter), revision: 1, ...item };
      table.push(row); result.push(copy(row));
    }
    if (controls.afterWrite) await controls.afterWrite(query);
    return { data: result, error: null };
  }
  const client = {
    from: table => new Query(table),
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: name === 'bloom_create_invite' ? { invite_code: 'test-code', expires_at: '2026-11-11' } : 'house-one', error: null }; },
    auth: {
      onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() { listener = null; } } } }; },
      async getSession() { return { data: { session }, error: null }; },
      async getUser() { return { data: { user: session && session.user }, error: null }; },
      async signInWithPassword(value) { calls.push({ auth: 'signInWithPassword', value }); session = { user: USER }; if (listener) listener('SIGNED_IN', session); return { data: { session, user: USER }, error: null }; },
      async signUp(value) { calls.push({ auth: 'signUp', value }); return { data: { user: USER, session: null }, error: null }; },
      async resetPasswordForEmail(email, opts) { calls.push({ auth: 'resetPasswordForEmail', email, opts }); return { data: {}, error: null }; },
      async updateUser(value) { calls.push({ auth: 'updateUser', value }); return { data: { user: session.user }, error: null }; },
      async signOut(value) { calls.push({ auth: 'signOut', value }); if (controls.beforeSignOut) await controls.beforeSignOut(); session = null; if (listener) listener('SIGNED_OUT', null); return { data: {}, error: null }; },
      stopAutoRefresh() { calls.push({ auth: 'stopAutoRefresh' }); }
    }
  };
  const store = createStore({ client, onChange: value => changes.push(value), redirectTo: 'http://127.0.0.1:8000/' });
  function emit(event, user) { session = user ? { user } : null; if (listener) listener(event, session); }
  return { store, client, rows, calls, changes, controls, emit };
}

test('initial load uses current account and household, and exposes no tokens or editable auth metadata', async () => {
  const h = harness();
  const state = await h.store.init();
  assert.equal(state.status, 'ready');
  assert.deepEqual(state.user, { id: USER.id, email: USER.email });
  assert.equal(state.household.id, 'house-one');
  assert.equal(state.privateProfile.weight_kg, 60);
  assert.equal(state.shoppingItems[0].name, 'Rice');
  state.shoppingItems[0].name = 'Modified outside store';
  assert.equal(h.store.snapshot().shoppingItems[0].name, 'Rice');
  h.store.destroy();
});

test('signed-out initialization neither loads household data nor invents accounts', async () => {
  const h = harness({ signedOut: true });
  assert.equal((await h.store.init()).status, 'signed-out');
  assert.equal(h.calls.filter(call => call.table).length, 0);
  await assert.rejects(h.store.saveShoppingItem({ name: 'Eggs' }), /Sign in/);
  h.store.destroy();
});

test('membership removal clears every shared cache while keeping only the individual private profile', async () => {
  const h = harness(); await h.store.init();
  h.rows.bloom_household_members = [];
  const state = await h.store.refresh();
  assert.equal(state.status, 'no-household');
  assert.equal(state.household, null);
  assert.deepEqual(state.shoppingItems, []);
  assert.deepEqual(state.inventory, []);
  assert.equal(state.privateProfile.user_id, USER.id);
  h.store.destroy();
});

test('sign-out clears private and shared views before awaiting the network; late refresh cannot repopulate them', async () => {
  const h = harness(); await h.store.init();
  const read = deferred(), logout = deferred();
  h.controls.beforeQuery = query => query.table === 'bloom_shopping_items' ? read.promise : undefined;
  const refresh = h.store.refresh();
  await new Promise(resolve => setImmediate(resolve));
  h.controls.beforeSignOut = () => logout.promise;
  const signOut = h.store.signOut();
  assert.equal(h.store.snapshot().status, 'signed-out');
  assert.equal(h.store.snapshot().user, null);
  assert.equal(h.store.snapshot().privateProfile, null);
  read.resolve(); await refresh;
  assert.deepEqual(h.store.snapshot().shoppingItems, []);
  logout.resolve(); await signOut;
  assert.equal(h.store.snapshot().status, 'signed-out');
  h.store.destroy();
});

test('account change discards the previous account cache and ignores an old read', async () => {
  const h = harness(); await h.store.init();
  const read = deferred();
  h.controls.beforeQuery = query => query.table === 'bloom_shopping_items' ? read.promise : undefined;
  const old = h.store.refresh(); await new Promise(resolve => setImmediate(resolve));
  h.emit('SIGNED_IN', OTHER);
  assert.equal(h.store.snapshot().user.id, OTHER.id);
  assert.equal(h.store.snapshot().privateProfile, null);
  assert.deepEqual(h.store.snapshot().shoppingItems, []);
  read.resolve(); await old;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.store.snapshot().user.id, OTHER.id);
  assert.equal(h.store.snapshot().status, 'no-household');
  assert.deepEqual(h.store.snapshot().shoppingItems, []);
  h.store.destroy();
});

test('cloud failure clears the household view and is reported as failure rather than a successful save', async () => {
  const h = harness(); await h.store.init();
  const before = h.store.snapshot().shoppingItems;
  h.controls.nextWriteError = 'Connection interrupted';
  await assert.rejects(h.store.saveShoppingItem({ id: '', request_id: '11111111-1111-4111-8111-111111111111', revision: null, name: 'Eggs', quantity: '6', checked: false }), /Connection interrupted/);
  assert.deepEqual(h.store.snapshot().shoppingItems, before);
  assert.equal(h.rows.bloom_shopping_items.length, 1);
  h.controls.nextReadError = 'Cannot refresh';
  await assert.rejects(h.store.refresh(), /Cannot refresh/);
  assert.equal(h.store.snapshot().status, 'error');
  assert.deepEqual(h.store.snapshot().shoppingItems, []);
  assert.equal((await h.store.refresh()).status, 'ready');
  h.store.destroy();
});

test('shopping updates use current household and saved revision; stale edits cannot silently overwrite changes', async () => {
  const h = harness(); await h.store.init();
  const row = h.store.snapshot().shoppingItems[0];
  await h.store.toggleShoppingItem({ ...row, household_id: 'attacker-house' }, true);
  const call = h.calls.find(call => call.operation === 'update');
  assert.deepEqual(call.payload, { checked: true });
  assert.deepEqual(call.filters, [['household_id', 'house-one'], ['id', row.id], ['revision', 1]]);
  assert.equal(h.store.snapshot().shoppingItems[0].revision, 2);
  await assert.rejects(h.store.saveShoppingItem({ ...row, name: 'An old edit' }), /changed or is no longer available/);
  assert.equal(h.rows.bloom_shopping_items[0].name, 'Rice');
  await assert.rejects(h.store.deleteShoppingItem(row), /changed or was already removed/);
  assert.equal(h.rows.bloom_shopping_items.length, 1);
  h.store.destroy();
});

test('profile writes strip unrelated records and enforce current owner identity', async () => {
  const h = harness(); await h.store.init();
  await h.store.savePrivateProfile({ user_id: OTHER.id, display_name: 'My name', height_cm: 165, revision: 1,
    records: { secret: 'Sleep log' }, ideaNotes: [{ body: 'Private idea' }], household_id: 'unwanted' });
  const call = h.calls.find(call => call.operation === 'update');
  assert.deepEqual(call.payload, { display_name: 'My name', height_cm: 165 });
  assert.deepEqual(call.filters, [['user_id', USER.id], ['revision', 1]]);
  await h.store.saveDietProfile({ user_id: OTHER.id, household_id: 'attacker', revision: null,
    display_name: 'My shared name', color: 'pink', calories_kcal: 2100, weight_kg: 60, notes: 'Optional shared note' });
  const dietCall = h.calls.find(call => call.table === 'bloom_diet_profiles' && call.operation === 'upsert');
  assert.equal(dietCall.payload.user_id, USER.id);
  assert.equal(dietCall.payload.household_id, 'house-one');
  assert.equal(dietCall.payload.color, 'pink');
  assert.equal(Object.hasOwn(dietCall.payload, 'weight_kg'), false);
  h.store.destroy();
});

test('explicit local-list import transmits only checklist fields and retries do not duplicate rows', async () => {
  const h = harness(); await h.store.init();
  const local = [{ id: 'local-eggs', name: ' Eggs ', quantity: ' 1 carton ', checked: false,
    records: { mood: 'private' }, ideaNotes: ['secret'], updatedAt: 'old timestamp', price: 20 }];
  assert.deepEqual(await h.store.importLocalShopping(local), { imported: 1, alreadyPresent: 0 });
  const call = h.calls.find(call => call.operation === 'upsert');
  assert.deepEqual(call.payload, [{ household_id: 'house-one', name: 'Eggs', quantity: '1 carton', checked: false, source_key: 'local-v4:local-eggs' }]);
  assert.deepEqual(call.upsertOptions, { onConflict: 'household_id,source_key', ignoreDuplicates: true });
  assert.deepEqual(await h.store.importLocalShopping(local), { imported: 0, alreadyPresent: 1 });
  assert.equal(h.rows.bloom_shopping_items.length, 2);
  await assert.rejects(h.store.importLocalShopping({ records: {}, shoppingList: local }), /not a complete backup/);
  await assert.rejects(h.store.importLocalShopping([...local, ...local]), /duplicate item/);
  h.store.destroy();
});

test('a full list larger than an API response page is retrieved using explicit stable pagination', async () => {
  const shopping = Array.from({ length: 240 }, (_, i) => ({ id: 'item-' + String(i).padStart(4, '0'), household_id: 'house-one', name: 'Food ' + i, checked: false, revision: 1 }));
  const h = harness({ rows: { bloom_shopping_items: shopping } });
  const state = await h.store.init();
  assert.equal(state.shoppingItems.length, 240);
  const calls = h.calls.filter(call => call.table === 'bloom_shopping_items');
  assert.deepEqual(calls.map(call => call.start), [0, 100, 200]);
  h.store.destroy();
});

test('a lower configured API row cap is detected instead of silently showing an incomplete shopping list', async () => {
  const shopping = Array.from({ length: 45 }, (_, i) => ({ id: 'item-' + i, household_id: 'house-one', name: 'Food', revision: 1 }));
  const h = harness({ rows: { bloom_shopping_items: shopping } });
  h.controls.limit = 25;
  await assert.rejects(h.store.init(), /complete list/);
  const state = h.store.snapshot();
  assert.equal(state.status, 'error');
  assert.match(state.error, /complete list/);
  assert.deepEqual(state.shoppingItems, []);
  h.store.destroy();
});

test('budgets preserve explicit zero and reject missing, fractional-cent, negative, or invalid-month values', async () => {
  const h = harness(); await h.store.init();
  await h.store.saveBudget({ month: '2026-11-01', amount_cents: 0, revision: null, currency: 'EUR' });
  const call = h.calls.find(call => call.table === 'bloom_budgets' && call.operation === 'upsert');
  assert.deepEqual(call.payload, { household_id: 'house-one', month: '2026-11-01', amount_cents: 0, currency: 'USD' });
  for (const amount of ['', null, -1, 1.5, NaN]) await assert.rejects(h.store.saveBudget({ month: '2026-12-01', amount_cents: amount }), /valid budget/);
  await assert.rejects(h.store.saveBudget({ month: '2026-13-01', amount_cents: 100 }), /valid month/);
  h.store.destroy();
});

test('auth uses supplied callback URL and clears recovery only after a confirmed password update', async () => {
  const h = harness({ signedOut: true }); await h.store.init();
  const result = await h.store.signUp(' one@example.test ', 'long-enough-password');
  assert.equal(result.confirmationRequired, true);
  assert.equal(h.store.snapshot().user, null);
  assert.deepEqual(h.calls.find(call => call.auth === 'signUp').value.options, { emailRedirectTo: 'http://127.0.0.1:8000/' });
  await h.store.resetPassword('one@example.test');
  assert.deepEqual(h.calls.find(call => call.auth === 'resetPasswordForEmail').opts, { redirectTo: 'http://127.0.0.1:8000/' });
  await h.store.signIn('one@example.test', 'long-enough-password');
  h.emit('PASSWORD_RECOVERY', USER);
  assert.equal(h.store.snapshot().recovery, true);
  await assert.rejects(h.store.updatePassword('short'), /12 characters/);
  assert.equal(h.store.snapshot().recovery, true);
  await h.store.updatePassword('a-new-long-password');
  assert.equal(h.store.snapshot().recovery, false);
  h.store.destroy();
});

test('missing SDK is recoverable through init retry, and browser sessions use per-tab storage with implicit flow', async () => {
  const original = globalThis.supabase;
  const h = harness({ signedOut: true });
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  let createdOptions;
  try {
    delete globalThis.supabase;
    const store = createStore({ config: { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_example' }, storage });
    assert.equal((await store.init()).status, 'unavailable');
    globalThis.supabase = { createClient(url, key, opts) { createdOptions = opts; return h.client; } };
    assert.equal((await store.init()).status, 'signed-out');
    assert.equal(createdOptions.auth.storage, storage);
    assert.equal(createdOptions.auth.flowType, 'implicit');
    assert.equal(createdOptions.auth.detectSessionInUrl, true);
    store.destroy();
  } finally { if (original === undefined) delete globalThis.supabase; else globalThis.supabase = original; h.store.destroy(); }
});

test('ordinary shopping insert retries reuse the form identifier after a lost accepted-write response', async () => {
  const h = harness(); await h.store.init();
  const draft = { id: '', request_id: '22222222-2222-4222-8222-222222222222', revision: null,
    name: 'Eggs', quantity: '6', checked: false };
  h.controls.afterWrite = () => { h.controls.afterWrite = null; throw new Error('Response lost after commit'); };
  await assert.rejects(h.store.saveShoppingItem(draft), /Response lost/);
  assert.equal(h.rows.bloom_shopping_items.length, 2);
  const saved = await h.store.saveShoppingItem({ ...draft });
  assert.equal(saved.id, draft.request_id);
  assert.equal(h.rows.bloom_shopping_items.length, 2);
  const writes = h.calls.filter(call => call.table === 'bloom_shopping_items' && call.operation === 'upsert');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].payload.id, writes[1].payload.id);
  assert.equal(Object.hasOwn(writes[0].payload, 'request_id'), false);
  assert.deepEqual(writes[0].upsertOptions, { onConflict: 'id', ignoreDuplicates: true });
  h.store.destroy();
});

test('inventory retry after a failed refresh preserves household identity and creates only one stock record', async () => {
  const h = harness(); await h.store.init();
  const draft = { id: '', request_id: '33333333-3333-4333-8333-333333333333', revision: null,
    name: 'Rice', brand: '', quantity: 1, unit: 'bag', location: 'pantry', expires_on: null, notes: '' };
  h.controls.afterWrite = () => { h.controls.afterWrite = null; h.controls.nextReadError = 'Refresh disconnected'; };
  await assert.rejects(h.store.saveInventory(draft), /Refresh disconnected/);
  assert.equal(h.store.snapshot().status, 'error');
  assert.equal(h.store.snapshot().household.id, 'house-one');
  assert.deepEqual(h.store.snapshot().inventory, []);
  assert.equal(h.rows.bloom_inventory.length, 1);
  await h.store.init();
  const saved = await h.store.saveInventory({ ...draft });
  assert.equal(saved.id, draft.request_id);
  assert.equal(h.rows.bloom_inventory.length, 1);
  h.store.destroy();
});

test('a changed retry cannot duplicate or overwrite the row that an earlier attempt already saved', async () => {
  const h = harness(); await h.store.init();
  const draft = { id: '', request_id: '44444444-4444-4444-8444-444444444444', revision: null,
    name: 'Milk', quantity: '1 carton', checked: false };
  h.controls.afterWrite = () => { h.controls.afterWrite = null; throw new Error('Response lost after commit'); };
  await assert.rejects(h.store.saveShoppingItem(draft), /Response lost/);
  await assert.rejects(h.store.saveShoppingItem({ ...draft, quantity: '2 cartons' }), /earlier version.*already saved/i);
  const saved = h.rows.bloom_shopping_items.find(row => row.id === draft.request_id);
  assert.equal(saved.quantity, '1 carton');
  assert.equal(saved.revision, 1);
  assert.equal(h.rows.bloom_shopping_items.length, 2);
  assert.equal(h.store.snapshot().shoppingItems.length, 2);
  h.store.destroy();
});

test('natural profile and month keys are retry-safe without overwriting a concurrent change', async () => {
  const h = harness(); await h.store.init();
  const budget = { month: '2026-11-01', amount_cents: 32000, revision: null };
  h.controls.afterWrite = () => { h.controls.afterWrite = null; throw new Error('Response lost after commit'); };
  await assert.rejects(h.store.saveBudget(budget), /Response lost/);
  await h.store.saveBudget({ ...budget });
  assert.equal(h.rows.bloom_budgets.length, 1);
  h.rows.bloom_budgets[0].amount_cents = 40000;
  h.rows.bloom_budgets[0].revision = 2;
  await assert.rejects(h.store.saveBudget({ ...budget }), /earlier version.*already saved/i);
  assert.equal(h.rows.bloom_budgets[0].amount_cents, 40000);
  h.store.destroy();
});

test('signing in after signing out keeps the SDK automatic session-refresh lifecycle running', async () => {
  const h = harness(); await h.store.init();
  await h.store.signOut();
  assert.equal(h.store.snapshot().status, 'signed-out');
  await h.store.signIn('one@example.test', 'long-enough-password');
  assert.equal(h.store.snapshot().status, 'ready');
  assert.equal(h.calls.some(call => call.auth === 'stopAutoRefresh'), false);
  h.emit('TOKEN_REFRESHED', USER);
  assert.equal(h.store.snapshot().status, 'ready');
  assert.equal(h.store.snapshot().user.id, USER.id);
  h.store.destroy();
});
