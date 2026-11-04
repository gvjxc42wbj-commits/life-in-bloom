'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Commerce = require('../bloom-commerce.js');
const Model = require('../bloom-food-model.js');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function product(overrides = {}) {
  return { id: 'product-one', revision: 1, name: 'Example cartons', category: 'food', aisle: 'beverages', brand: 'Example', package_quantity: 12, package_unit: 'each', item_label: 'carton', price_cents: 2400, price_date: '2026-10-31', store: 'Example store', serving_quantity: null, serving_unit: 'each', nutrients: {}, archived: false, ...overrides };
}
function ready(overrides = {}) {
  return { status: 'ready', user: { id: 'person-one' }, household: { id: 'house-one' }, members: [{ user_id: 'person-one', role: 'owner' }], products: [], recurringProducts: [], shoppingItems: [], budgets: [], inventory: [], bills: [], moneyEntries: [], receipts: [], foodFiles: [], ...overrides };
}
function memoryDrafts() {
  const values = new Map();
  return { values,
    read(user, household, area) { return values.get([user, household, area].join(':')) || null; },
    write(user, household, area, data) { values.set([user, household, area].join(':'), { savedAt: '2026-11-04T12:00:00Z', data: structuredClone(data) }); return true; }
  };
}
function harness(initial = ready(), options = {}) {
  let current = initial, confirmation = true;
  const calls = [], notices = [], methods = {}, refreshes = [], confirmations = [];
  const store = { snapshot: () => current };
  for (const name of ['refresh', 'ensureBillMonth', 'stopBillSeries', 'saveProduct', 'saveRecurringProduct', 'saveShoppingItem', 'saveShoppingItems', 'recordReceipt', 'voidReceipt', 'saveBill', 'recordMoneyEntry', 'voidMoneyEntry', 'saveBudget', 'uploadFoodFile', 'getFoodFileUrl', 'deleteFoodFile']) store[name] = async (...args) => {
    calls.push({ name, args: structuredClone(args) });
    return methods[name] ? methods[name](...args) : {};
  };
  const controller = Commerce.createController({ store, model: Model, getNow: () => new Date(2026, 10, 4, 12), confirm: message => { confirmations.push(message); return confirmation; }, refresh: selector => refreshes.push(selector), notify: (message, error) => notices.push({ message, error }), ...options });
  controller.render('catalog');
  const click = (action, data = {}) => {
    const handled = controller.handleClick({ target: { closest: () => ({ dataset: { commerceAction: action, ...data } }) } });
    assert.equal(handled, true, action + ' is synchronously handled');
    return handled;
  };
  const input = (field, value, extra = {}) => controller.handleInput({ target: { dataset: { commerceField: field }, value: String(value), checked: value === true, ...extra } });
  const line = (key, name, value, extra = {}) => controller.handleInput({ target: { dataset: { commerceLine: key, lineField: name }, value: String(value), checked: value === true, ...extra } });
  const purchaseKey = () => controller.renderPurchase().match(/data-commerce-line="([^"]+)"/)?.[1];
  const purchaseLine = (name, value, extra = {}) => controller.handleInput({ target: { dataset: { commerceLine: purchaseKey(), commerceLineGroup: 'purchase', lineField: name }, value: String(value), checked: value === true, ...extra } });
  const submit = (group, fields = {}) => {
    let prevented = false;
    const result = controller.handleSubmit({ target: { dataset: { commerceForm: group }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]), checked: fields[name] === true } : null } }, preventDefault: () => { prevented = true; } });
    assert.equal(result, true); assert.equal(prevented, true); return result;
  };
  const keys = () => Array.from(new Set(Array.from(controller.render('receipts').matchAll(/data-commerce-line="([^"]+)"/g), match => match[1])));
  return { controller, store, calls, notices, methods, refreshes, confirmations, click, input, line, purchaseKey, purchaseLine, submit, keys, idle: () => controller.whenIdle(), get state() { return current; }, set state(value) { current = value; }, set confirmation(value) { confirmation = value; } };
}

function assertProductDisclosure(h, open, label = 'Add a product') {
  const html = h.controller.render('catalog');
  const toggle = html.match(/<button\b(?=[^>]*\bdata-commerce-action="toggle-product")[^>]*>[\s\S]*?<\/button>/)?.[0];
  const body = html.match(/<[^/!][^>]*\bid="commerce-product-editor"[^>]*>/)?.[0];
  assert.ok(toggle, 'the product editor has an accessible disclosure button');
  assert.ok(body, 'the controlled product editor region exists even when closed');
  assert.match(toggle, /aria-controls="commerce-product-editor"/);
  assert.match(toggle, new RegExp('aria-expanded="' + open + '"'));
  assert.ok(toggle.includes(label), 'the disclosure describes the current product form');
  assert.match(toggle, open ? /\bOpen\b/ : /\bClosed\b/);
  if (open) {
    assert.doesNotMatch(body, /\shidden(?:\s|=|>)/);
    assert.match(html, /data-commerce-form="product"/);
  } else {
    assert.match(body, /\shidden(?:\s|=|>)/);
    assert.doesNotMatch(html, /data-commerce-form="product"/);
  }
  return html;
}

test('Add a product starts as a closed disclosure without a mounted form', () => {
  const h = harness();
  assertProductDisclosure(h, false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.confirmations.length, 0);
});

test('closing and reopening the product disclosure retains the draft and request ID without asking to discard', async () => {
  const draftStore = memoryDrafts(), h = harness(ready(), { draftStore });
  h.confirmation = false;
  h.click('toggle-product'); assertProductDisclosure(h, true);
  h.input('product.name', 'Draft <carrots>'); h.input('product.brand', 'My brand');
  const original = structuredClone(draftStore.read('person-one', 'house-one', 'commerce').data.drafts.product);
  assert.match(original.request_id, uuidPattern);
  h.click('toggle-product'); assertProductDisclosure(h, false);
  assert.deepEqual(draftStore.read('person-one', 'house-one', 'commerce').data.drafts.product, original);
  h.click('toggle-product');
  const html = assertProductDisclosure(h, true);
  assert.match(html, /value="Draft &lt;carrots&gt;"/);
  assert.match(html, /value="My brand"/);
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.calls.length, 0, 'disclosure changes do not save product records');
  h.submit('product'); await h.idle();
  assert.equal(h.calls[0].name, 'saveProduct');
  assert.equal(h.calls[0].args[0].request_id, original.request_id);
  assert.equal(h.calls[0].args[0].name, 'Draft <carrots>');
  assertProductDisclosure(h, false);
});

test('a restored product draft starts closed even if an older saved draft marked it open', () => {
  const draftStore = memoryDrafts(), h = harness(ready(), { draftStore });
  h.click('toggle-product'); h.input('product.name', 'Restored product');
  const saved = draftStore.read('person-one', 'house-one', 'commerce');
  saved.data.productOpen = true;
  const original = structuredClone(saved.data.drafts.product);
  const restored = harness(h.state, { draftStore });
  assertProductDisclosure(restored, false);
  restored.confirmation = false;
  restored.click('toggle-product');
  assert.match(assertProductDisclosure(restored, true), /value="Restored product"/);
  assert.deepEqual(draftStore.read('person-one', 'house-one', 'commerce').data.drafts.product, original);
  assert.equal(restored.confirmations.length, 0);
});

test('Details and edit opens the existing product, failed saving keeps it open, and successful saving closes it', async () => {
  const row = product({ revision: 9 }), h = harness(ready({ products: [row] }));
  assertProductDisclosure(h, false);
  h.click('edit-product', { id: row.id });
  assert.match(assertProductDisclosure(h, true, 'Edit product'), /value="Example cartons"/);
  h.input('product.name', 'Updated cartons');
  h.confirmation = false; h.click('toggle-product'); assertProductDisclosure(h, false, 'Edit product');
  h.click('toggle-product'); assert.match(assertProductDisclosure(h, true, 'Edit product'), /value="Updated cartons"/);
  assert.equal(h.confirmations.length, 0);
  h.methods.saveProduct = () => { throw new Error('Save connection lost'); };
  h.submit('product'); await h.idle();
  assertProductDisclosure(h, true, 'Edit product');
  const payload = h.calls[0].args[0]; assert.equal(payload.id, row.id); assert.equal(payload.revision, 9);
  h.methods.saveProduct = () => ({});
  h.submit('product'); await h.idle();
  assert.deepEqual(h.calls[1].args[0], payload);
  assertProductDisclosure(h, false);
});

test('discarding product changes closes the disclosure and creates a fresh draft only after confirmation', () => {
  const draftStore = memoryDrafts(), h = harness(ready(), { draftStore });
  h.click('toggle-product'); h.input('product.name', 'Discard this draft');
  const originalId = draftStore.read('person-one', 'house-one', 'commerce').data.drafts.product.request_id;
  h.confirmation = false; h.click('discard', { group: 'product' });
  assert.match(assertProductDisclosure(h, true), /value="Discard this draft"/);
  h.confirmation = true; h.click('discard', { group: 'product' }); assertProductDisclosure(h, false);
  const replacement = draftStore.read('person-one', 'house-one', 'commerce').data.drafts.product;
  assert.equal(replacement.name, ''); assert.notEqual(replacement.request_id, originalId);
  h.click('toggle-product'); assertProductDisclosure(h, true);
  assert.equal(h.confirmations.length, 2, 'only the two explicit discard attempts ask for confirmation');
  assert.equal(h.calls.length, 0);
});

test('catalog keeps all products, pages them, escapes user text, and preserves unknown prices', () => {
  const products = Array.from({ length: 45 }, (_, i) => product({ id: 'p' + i, name: 'Product ' + String(i).padStart(2, '0'), price_cents: i === 44 ? null : 0 }));
  products[0].name = '<img onerror=alert(1)>';
  const h = harness(ready({ products }));
  let html = h.controller.render('catalog');
  assert.match(html, /45 matching products/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /\$0\.00/);
  h.click('catalog-next');
  html = h.controller.render('catalog');
  assert.match(html, /Product 44/); assert.match(html, /Price needed/);
  assert.equal(h.calls.length, 0);
});

test('product saves preserve unknown nutrition and stable retry IDs, and reject unsafe reference links', async () => {
  const h = harness(); h.click('new-product');
  h.submit('product', { name: 'A <food>', price: '', source_url: 'javascript:alert(1)' });
  assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /http or https/);
  h.methods.saveProduct = () => { throw new Error('Connection lost'); };
  h.submit('product', { source_url: 'https://example.test/product' }); await h.idle();
  const first = h.calls[0].args[0];
  assert.match(first.request_id, uuidPattern); assert.equal(first.price_cents, null);
  assert.equal(first.serving_quantity, null); assert.ok(Object.values(first.nutrients).every(value => value === null));
  assert.match(h.controller.render('catalog'), /A &lt;food&gt;/);
  h.submit('product', { request_id: 'tampered' }); await h.idle();
  assert.equal(h.calls[1].args[0].request_id, first.request_id);
  h.submit('product', { protein_g: '8' }); await h.idle();
  assert.equal(h.calls.length, 2); assert.match(h.notices.at(-1).message, /serving size/);
});

test('quick add retries the same request without creating an expense or a second list row', async () => {
  const drafts = memoryDrafts(), h = harness(ready({ products: [product()] }), { draftStore: drafts });
  h.methods.saveShoppingItem = () => { throw new Error('Response lost'); };
  h.click('product-to-list', { id: 'product-one' }); await h.idle();
  const first = h.calls[0].args[0]; assert.match(first.request_id, uuidPattern);
  h.click('product-to-list', { id: 'product-one' }); await h.idle();
  assert.deepEqual(h.calls[1].args[0], first);
  const restored = harness(h.state, { draftStore: drafts });
  restored.click('product-to-list', { id: 'product-one' }); await restored.idle();
  assert.deepEqual(restored.calls[0].args[0], first);
  restored.click('product-to-list', { id: 'product-one' }); await restored.idle();
  assert.notEqual(restored.calls[1].args[0].request_id, first.request_id);
  assert.ok([...h.calls, ...restored.calls].every(call => call.name === 'saveShoppingItem'));
});

test('monthly recurrence requires review, rounds after household aggregation, and skips previously added source keys', async () => {
  const p = product();
  const h = harness(ready({ products: [p], recurringProducts: [{ id: 'r1', product_id: p.id, person_slot: 1, quantity: 1, basis: 'units', every_days: 1, active: true }, { id: 'r2', product_id: p.id, person_slot: 2, quantity: 1, basis: 'units', every_days: 1, active: true }] }));
  h.controller.render('recurring'); h.click('confirm-recurring'); assert.equal(h.calls.length, 0);
  h.click('review-recurring'); assert.match(h.controller.render('recurring'), /30 days/); assert.equal(h.calls.length, 0);
  h.click('confirm-recurring'); await h.idle();
  assert.equal(h.calls[0].name, 'saveShoppingItems');
  const rows = h.calls[0].args[0]; assert.equal(rows.length, 1); assert.equal(rows[0].packs, 5);
  assert.equal(rows[0].estimate_cents, 12000); assert.equal(rows[0].source_key, 'recurring:2026-11:product-one');
  h.state = { ...h.state, shoppingItems: [{ ...rows[0], id: 'saved', checked: true }] };
  h.click('review-recurring'); h.click('confirm-recurring'); await h.idle(); assert.equal(h.calls.length, 1);
  h.controller.setMonth('2026-12'); h.click('review-recurring'); h.click('confirm-recurring'); await h.idle();
  assert.equal(h.calls[1].args[0][0].packs, 6); assert.equal(h.calls[1].args[0][0].month, '2026-12-01');
});

test('a saved-stock change invalidates a recurring review before a batch is posted', async () => {
  const h = harness(ready({ products: [product()], recurringProducts: [{ id: 'r', product_id: 'product-one', quantity: 1, basis: 'units', every_days: 1, active: true }] }));
  h.click('review-recurring'); h.state = { ...h.state, inventory: [{ id: 'new-stock', product_id: 'product-one', quantity: 12, unit: 'each' }] };
  h.click('confirm-recurring'); await h.idle(); assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /changed/);
});

test('a mixed receipt records its full set of lines in one RPC after explicit review, not separate money writes', async () => {
  const h = harness(ready({ products: [product(), product({ id: 'soap', name: 'Soap', category: 'household', package_quantity: 1, price_cents: 350 })] }));
  h.controller.startReceipt([{ id: 'cartons', name: 'Cartons', checked: true, product_id: 'product-one', packs: 2 }, { id: 'soap-list', name: 'Soap', checked: true, product_id: 'soap', packs: 1 }, { id: 'unbought', name: 'Not bought', checked: false }], '2026-11');
  h.submit('receipt', { store: 'A store', payer_slot: '1' });
  assert.equal(h.calls.length, 0); assert.match(h.controller.render('receipts'), /Record receipt, inventory &amp; spending|Record receipt, inventory & spending/);
  h.click('confirm-receipt'); h.click('confirm-receipt'); await h.idle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'recordReceipt');
  const receipt = h.calls[0].args[0]; assert.match(receipt.id, uuidPattern); assert.equal(receipt.items.length, 2);
  assert.deepEqual(receipt.items.map(row => [row.category, row.line_total_cents, row.stock_quantity]), [['food', 4800, 24], ['household', 350, null]]);
  assert.deepEqual(receipt.items.map(row => row.shopping_item_id), ['cartons', 'soap-list']);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('failed receipt retains the reviewed payload and its exact stable ID across retry and reload', async () => {
  const drafts = memoryDrafts(), h = harness(ready({ products: [product()] }), { draftStore: drafts });
  h.controller.startReceipt([{ id: 'list', product_id: 'product-one', name: 'Cartons', checked: true }]);
  h.submit('receipt'); h.methods.recordReceipt = () => { throw new Error('Response lost after receipt save'); };
  h.click('confirm-receipt'); await h.idle(); const first = h.calls[0].args[0];
  assert.match(h.controller.render('receipts'), /Confirm actual spending/);
  h.click('confirm-receipt'); await h.idle(); assert.deepEqual(h.calls[1].args[0], first);
  const restored = harness(h.state, { draftStore: drafts });
  restored.click('confirm-receipt'); assert.equal(restored.calls.length, 0, 'reload requires a fresh review');
  restored.submit('receipt'); restored.click('confirm-receipt'); await restored.idle();
  assert.deepEqual(restored.calls[0].args[0], first);
});

test('linked receipts preserve the selected shopping revision through stale snapshots, form tampering, retry, and reload', async () => {
  const drafts = memoryDrafts(), row = { id: 'list', revision: 7, product_id: 'product-one', name: 'Cartons', checked: true };
  const h = harness(ready({ products: [product()], shoppingItems: [row] }), { draftStore: drafts });
  h.controller.startReceipt([row]); const key = h.keys()[0];
  h.state = { ...h.state, shoppingItems: [{ ...row, revision: 8, packs: 4 }] };
  assert.equal(h.line(key, 'shopping_revision', '8'), false);
  h.submit('receipt', { ['line.' + key + '.shopping_revision']: '8' });
  h.methods.recordReceipt = () => { throw new Error('Shopping item changed; refresh and review it again.'); };
  h.click('confirm-receipt'); await h.idle();
  const original = h.calls[0].args[0];
  assert.equal(original.items[0].shopping_revision, 7);
  h.click('confirm-receipt'); await h.idle(); assert.deepEqual(h.calls[1].args[0], original);
  const restored = harness(h.state, { draftStore: drafts });
  restored.submit('receipt'); restored.click('confirm-receipt'); await restored.idle();
  assert.deepEqual(restored.calls[0].args[0], original, 'reload must not substitute the latest shopping version into an older receipt draft');
});

test('receipt pack changes update real form fields, while edited actual costs and quantities remain authoritative', async () => {
  const h = harness(ready({ products: [product()] }));
  h.controller.startReceipt([{ id: 'list', product_id: 'product-one', name: 'Cartons', checked: true }]);
  const key = h.keys()[0], fields = { ['line.' + key + '.stock_quantity']: { value: '12' }, ['line.' + key + '.line_total']: { value: '24.00' } };
  const form = { elements: { namedItem: name => fields[name] || null } };
  h.line(key, 'packs', '2', { form }); assert.equal(fields['line.' + key + '.stock_quantity'].value, '24'); assert.equal(fields['line.' + key + '.line_total'].value, '48.00');
  h.line(key, 'line_total', '45.50'); h.line(key, 'stock_quantity', '20');
  h.line(key, 'packs', '3', { form });
  h.submit('receipt'); h.click('confirm-receipt'); await h.idle();
  assert.equal(h.calls[0].args[0].items[0].line_total_cents, 4550); assert.equal(h.calls[0].args[0].items[0].stock_quantity, 20);
});

test('receipt never treats a missing actual price as free and rejects impossible dates and payer values', async () => {
  const h = harness(); h.click('new-receipt'); const key = h.keys()[0];
  h.line(key, 'name', 'A manual purchase'); h.submit('receipt'); assert.equal(h.calls.length, 0); assert.match(h.notices.at(-1).message, /dollars and cents/);
  h.line(key, 'line_total', '0'); h.submit('receipt', { purchased_on: '2026-02-30' }); assert.match(h.notices.at(-1).message, /valid purchase date/);
  h.submit('receipt', { purchased_on: '2026-11-04', payer_slot: '9' }); assert.match(h.notices.at(-1).message, /who paid/);
  h.submit('receipt', { payer_slot: '' }); h.click('confirm-receipt'); await h.idle(); assert.equal(h.calls[0].args[0].items[0].line_total_cents, 0);
});

test('checking a list item opens one purchase confirmation and one save posts all purchase effects once', async () => {
  const row = { id: 'cartons', revision: 4, name: 'Example cartons', product_id: 'product-one', packs: 2, quantity: '2 packs of 12 cartons', estimate_cents: 4600, category: 'food', month: '2026-11-01', checked: false };
  const h = harness(ready({ products: [product()], shoppingItems: [row] }));
  assert.equal(h.controller.startPurchase(row, '2026-11'), true);
  let html = h.controller.renderPurchase();
  assert.match(html, /id="commerce-purchase-line-total"[^>]*value="46\.00"/);
  assert.match(html, /List estimate: \$46\.00/);
  assert.match(html, /data-commerce-form="purchase"/);
  assert.equal(h.controller.getPendingPurchaseId(), row.id);
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.shoppingItems[0].checked, false, 'opening purchase must not mark the row bought');
  const refreshes = h.refreshes.length;
  h.purchaseLine('line_total', '45.25');
  assert.equal(h.refreshes.length, refreshes, 'typing a price must keep the active input in place');
  h.purchaseLine('location', 'refrigerator');
  h.submit('purchase', { payer_slot: '2' }); h.submit('purchase');
  await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'recordReceipt');
  const receipt = h.calls[0].args[0], line = receipt.items[0];
  assert.match(receipt.id, uuidPattern);
  assert.equal(receipt.payer_slot, 2);
  assert.equal(receipt.items.length, 1);
  assert.deepEqual([line.shopping_item_id, line.shopping_revision, line.packs, line.stock_quantity, line.stock_unit, line.location, line.line_total_cents], ['cartons', 4, 2, 24, 'each', 'refrigerator', 4525]);
  assert.deepEqual([line.expires_on, line.frozen_on, line.freezer_use_by], [null, null, null]);
  assert.equal(h.controller.getPendingPurchaseId(), null);
  html = h.controller.renderPurchase();
  assert.match(html, /Purchase saved/);
  for (const destination of ['inventory', 'receipts', 'budget', 'money']) assert.ok(html.includes('data-destination="' + destination + '"'));
  assert.equal(h.confirmations.length, 0, 'the explicit Save purchase does not need a second confirmation');
});

test('manual checked food requires price and real inventory quantity while household purchases skip food stock', async () => {
  const food = { id: 'loose-food', revision: 1, name: 'Loose vegetables', product_id: null, packs: null, category: 'food', month: '2026-11-01', checked: true };
  const h = harness(ready({ shoppingItems: [food] }));
  h.controller.startPurchase(food, '2026-11');
  h.submit('purchase'); await h.idle(); assert.equal(h.calls.length, 0);
  h.purchaseLine('line_total', '0'); h.purchaseLine('packs', '1');
  h.submit('purchase'); await h.idle(); assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /food amount/i);
  h.purchaseLine('stock_quantity', '0'); h.submit('purchase'); await h.idle(); assert.equal(h.calls.length, 0);
  h.purchaseLine('stock_quantity', '0.75'); h.purchaseLine('stock_unit', 'lb');
  h.purchaseLine('expires_on', '2026-02-30'); h.submit('purchase'); await h.idle(); assert.equal(h.calls.length, 0);
  h.purchaseLine('expires_on', '');
  h.submit('purchase'); await h.idle();
  assert.equal(h.calls[0].args[0].items[0].line_total_cents, 0, 'an explicitly confirmed free purchase is valid');
  assert.equal(h.calls[0].args[0].items[0].stock_quantity, 0.75);
  assert.equal(h.calls[0].args[0].items[0].product_id, null);
  const supply = { id: 'supply', revision: 2, name: 'Example soap', packs: 1, estimate_cents: 350, category: 'household', month: '2026-11-01' };
  h.state = { ...h.state, shoppingItems: [supply] };
  h.controller.startPurchase(supply, '2026-11');
  assert.doesNotMatch(h.controller.renderPurchase(), /Add to Food already at home/);
  h.submit('purchase'); await h.idle();
  const item = h.calls.at(-1).args[0].items[0];
  assert.equal(item.category, 'household'); assert.equal(item.stock_quantity, null); assert.equal(item.line_total_cents, 350);
});

test('uncertain purchase retry keeps one frozen payload through edits, close, and device reload', async () => {
  const drafts = memoryDrafts(), row = { id: 'buy', revision: 8, name: 'Cartons', product_id: 'product-one', packs: 1, category: 'food', estimate_cents: 2400 };
  const initial = ready({ products: [product()], shoppingItems: [row] });
  const h = harness(initial, { draftStore: drafts });
  h.controller.startPurchase(row, '2026-11'); h.purchaseLine('line_total', '22.50');
  h.methods.recordReceipt = () => { throw Object.assign(new Error('The purchase was saved but could not be refreshed'), { code: 'WRITE_READBACK_UNCONFIRMED' }); };
  h.submit('purchase'); await h.idle();
  const original = structuredClone(h.calls[0].args[0]);
  assert.match(h.controller.renderPurchase(), /Retry save/);
  assert.match(h.controller.renderPurchase(), /id="commerce-purchase-line-total"[^>]* disabled/);
  h.purchaseLine('line_total', '99.99'); h.input('purchase.purchased_on', '2026-12-01');
  h.submit('purchase'); await h.idle(); assert.deepEqual(h.calls[1].args[0], original);
  h.click('cancel-purchase');
  assert.equal(h.controller.getPendingPurchaseId(), row.id);
  assert.match(h.controller.renderPurchase(), /Resume purchase/);
  const restored = harness(initial, { draftStore: drafts });
  assert.equal(restored.controller.getPendingPurchaseId(), row.id);
  restored.controller.startPurchase(row, '2026-12');
  restored.submit('purchase', { purchased_on: '2026-12-01', ['line.' + restored.purchaseKey() + '.line_total']: '99.99' });
  await restored.idle();
  assert.deepEqual(restored.calls[0].args[0], original, 'reload and hidden/form edits never replace an uncertain original purchase');
  assert.equal(restored.controller.getPendingPurchaseId(), null);
});

test('definitive purchase rejection stays correctable and a stale item is rebased only by explicit reload', async () => {
  const row = { id: 'buy', revision: 2, name: 'Cartons', product_id: 'product-one', packs: 2, category: 'food', estimate_cents: 4800 };
  const h = harness(ready({ products: [product()], shoppingItems: [row] }));
  h.controller.startPurchase(row, '2026-11');
  h.state = { ...h.state, shoppingItems: [{ ...row, revision: 3, packs: 1, estimate_cents: 2400 }] };
  h.methods.recordReceipt = () => { throw Object.assign(new Error('The shopping list changed'), { code: '40001' }); };
  h.submit('purchase'); await h.idle();
  const originalId = h.calls[0].args[0].id;
  assert.equal(h.calls[0].args[0].items[0].shopping_revision, 2);
  let html = h.controller.renderPurchase();
  assert.match(html, /Reload list item/);
  assert.doesNotMatch(html.match(/<input[^>]*id="commerce-purchase-line-total"[^>]*>/)[0], / disabled/);
  assert.equal(h.purchaseLine('shopping_revision', '3'), false);
  h.click('reload-purchase'); await h.idle();
  assert.equal(h.calls.at(-1).name, 'refresh');
  html = h.controller.renderPurchase(); assert.doesNotMatch(html, /Reload list item/);
  h.methods.recordReceipt = () => ({});
  h.submit('purchase'); await h.idle();
  const retried = h.calls.at(-1).args[0];
  assert.equal(retried.id, originalId);
  assert.equal(retried.items[0].shopping_revision, 3);
  assert.equal(retried.items[0].packs, 1);
  assert.equal(retried.items[0].line_total_cents, 2400);
});

test('a verified reversed request gets a fresh purchase ID only after explicit reload and review', async () => {
  const row = { id: 'buy', revision: 2, name: 'Cartons', product_id: 'product-one', packs: 1, category: 'food', estimate_cents: 2400 };
  const h = harness(ready({ products: [product()], shoppingItems: [row] }));
  h.controller.startPurchase(row, '2026-11');
  h.methods.recordReceipt = () => { throw new Error('Accepted response was lost'); };
  h.submit('purchase'); await h.idle();
  const earlier = h.calls[0].args[0];
  h.state = { ...h.state, shoppingItems: [{ ...row, revision: 4 }], receipts: [{ ...earlier, total_cents: 2400, voided_at: '2026-11-04T14:00:00Z' }] };
  h.methods.recordReceipt = () => { throw Object.assign(new Error('This receipt was reversed'), { code: '23514' }); };
  h.submit('purchase'); await h.idle();
  assert.equal(h.calls[1].args[0].id, earlier.id, 'a plain retry never gets a new ID');
  h.click('reload-purchase'); await h.idle();
  assert.match(h.notices.at(-1).message, /earlier purchase was reversed/i);
  h.methods.recordReceipt = () => ({});
  h.submit('purchase'); await h.idle();
  const fresh = h.calls.at(-1).args[0];
  assert.notEqual(fresh.id, earlier.id);
  assert.equal(fresh.items[0].shopping_revision, 4);
});

test('purchase storage defaults use a saved location first and never invent food dates', async () => {
  for (const [aisle, prior, expected] of [['dairy-eggs', null, 'refrigerator'], ['meat', null, 'refrigerator'], ['seafood', null, 'refrigerator'], ['deli', null, 'refrigerator'], ['frozen', null, 'freezer'], ['dairy-eggs', 'freezer', 'freezer']]) {
    const row = { id: 'buy', revision: 1, name: 'Example food', product_id: 'product-one', packs: 1, category: 'food', estimate_cents: 2400 };
    const h = harness(ready({ products: [product({ aisle })], shoppingItems: [row], inventory: prior ? [{ product_id: 'product-one', location: prior }] : [] }));
    h.controller.startPurchase(row, '2026-11'); h.submit('purchase'); await h.idle();
    const line = h.calls[0].args[0].items[0];
    assert.equal(line.location, expected);
    assert.deepEqual([line.expires_on, line.frozen_on, line.freezer_use_by], [null, null, null]);
  }
});

test('a recorded checkbox opens its original trip and the shared month guard can cancel before any reset', () => {
  const row = { id: 'buy', revision: 3, name: 'Cartons', checked: true };
  const receipt = { id: 'saved-trip', purchased_on: '2026-10-31', total_cents: 2400, items: [{ name: 'Cartons', packs: 1, category: 'food', line_total_cents: 2400, shopping_item_id: row.id }], shopping_effects: [{ id: row.id, after: { checked: true } }] };
  const destinations = [], sections = [];
  const h = harness(ready({ shoppingItems: [row], receipts: [receipt] }), { navigate: value => destinations.push(value) });
  h.controller.setSectionHandler((section, month) => sections.push([section, month]));
  h.input('budget.amount', '88.00');
  h.controller.setMonthGuard(() => false);
  assert.equal(h.controller.openReceipt(receipt.id), false);
  assert.equal(h.controller.getMonth(), '2026-11');
  assert.equal(h.confirmations.length, 0, 'a rejected shared guard runs before any commerce draft discard');
  assert.match(h.controller.render('money'), /id="commerce-budget-amount"[^>]*value="88\.00"/);
  assert.equal(destinations.length, 0);
  h.controller.setMonthGuard(() => true);
  assert.equal(h.controller.startPurchase(row, '2026-11'), true);
  assert.equal(h.controller.getMonth(), '2026-10');
  assert.deepEqual(sections.at(-1), ['receipts', '2026-10']);
  assert.equal(destinations.at(-1), 'grocery');
  assert.match(h.controller.render('receipts'), /id="commerce-receipt-saved-trip"[^>]* open/);
  assert.equal(h.controller.getPendingPurchaseId(), null);
  assert.equal(h.calls.length, 0, 'opening a recorded item never posts or reverses it');
});

test('offline purchase details stay as a draft and linked bulk food cannot omit inventory amounts', async () => {
  const row = { id: 'buy', revision: 1, name: 'Food bought', packs: 1, category: 'food', estimate_cents: 1200, checked: true };
  const h = harness(ready({ offline: true, shoppingItems: [row] }));
  h.controller.startPurchase(row, '2026-11'); h.purchaseLine('stock_quantity', '2');
  assert.match(h.controller.renderPurchase(), /Connect to save this purchase/);
  h.submit('purchase'); await h.idle(); assert.equal(h.calls.length, 0);
  h.state = { ...h.state, offline: false };
  h.click('cancel-purchase'); h.controller.startReceipt([row], '2026-11');
  assert.match(h.controller.render('receipts'), /Enter a food amount greater than zero/);
  h.submit('receipt'); await h.idle(); assert.equal(h.calls.length, 0);
  const key = h.keys()[0]; h.line(key, 'stock_quantity', '2'); h.line(key, 'stock_unit', 'lb');
  h.submit('receipt'); h.click('confirm-receipt'); await h.idle();
  assert.equal(h.calls[0].args[0].items[0].stock_quantity, 2);
});

test('money distinguishes fixed and unknown variable bills and opens saved monthly comparisons', () => {
  const bills = [
    { id: 'old', month: '2026-10-01', name: 'Fixed example', variable: false, amount_cents: 9000 },
    { id: 'new', month: '2026-11-01', name: 'Fixed example', variable: false, amount_cents: 10000 },
    { id: 'variable', month: '2026-11-01', name: 'Variable example', variable: true, amount_cents: null, notes: 'Earlier range <example>' }
  ];
  const payment = { id: 'payment', bill_id: 'old', category: 'bill', direction: 'expense', amount_cents: 9000, occurred_on: '2026-11-04' };
  const h = harness(ready({ bills, moneyEntries: [payment] }));
  let html = h.controller.render('money');
  assert.match(html, /Fixed monthly bills<\/span><strong>\$100\.00/);
  assert.match(html, /Variable monthly bills<\/span><strong>\$0\.00<\/strong><small>1 amount\(s\) not recorded · total incomplete/);
  assert.match(html, /Earlier range &lt;example&gt;/);
  assert.match(html, /Monthly bill history/);
  assert.match(html, /Payments recorded/);
  assert.match(html, /data-commerce-action="open-bill-month" data-month="2026-10"/);
  h.click('open-bill-month', { month: '2026-10' });
  html = h.controller.render('money');
  assert.match(html, /Fixed monthly bills<\/span><strong>\$90\.00/);
  const currentBills = html.match(/<ul class="commerce-record-list">([\s\S]*?)<\/ul>/)[1];
  assert.match(currentBills, /Paid \$90\.00 · Nov 4, 2026/);
  assert.doesNotMatch(currentBills, /Record payment/);
  assert.equal(h.calls.length, 0);
});

test('opening Money prepares recurring monthly bills once per version and exposes failures for retry', async () => {
  const h = harness(ready({ billRules: [{ id: 'rule', revision: 1 }] }));
  h.input('budget.amount', '77.00');
  h.methods.ensureBillMonth = () => { throw new Error('Monthly bills could not be loaded'); };
  let html = h.controller.render('money');
  assert.match(html, /Opening this month’s recurring bills/);
  assert.doesNotMatch(html, /Fixed monthly bills<\/span><strong>\$0\.00/);
  await h.idle();
  html = h.controller.render('money');
  assert.match(html, /Retry loading bills/);
  assert.match(html, /id="commerce-budget-amount"[^>]*value="77\.00"/);
  assert.equal(h.calls.filter(call => call.name === 'ensureBillMonth').length, 1);
  h.controller.render('money'); await h.idle();
  assert.equal(h.calls.filter(call => call.name === 'ensureBillMonth').length, 1, 'a failed render does not repeat its request indefinitely');
  h.methods.ensureBillMonth = requestedMonth => {
    h.state = { ...h.state, bills: [...h.state.bills.filter(bill => bill.month !== requestedMonth + '-01'), { id: requestedMonth, month: requestedMonth + '-01', name: 'Recurring example', amount_cents: 15000, variable: false }] };
    return {};
  };
  h.click('retry-bills'); await h.idle();
  html = h.controller.render('money');
  assert.match(html, /Fixed monthly bills<\/span><strong>\$150\.00/);
  assert.match(html, /id="commerce-budget-amount"[^>]*value="77\.00"/);
  h.controller.render('money'); await h.idle();
  assert.equal(h.calls.filter(call => call.name === 'ensureBillMonth').length, 2);
  assert.equal(h.controller.openMoneyMonth('2026-12'), true); await h.idle();
  assert.equal(h.calls.at(-1).name, 'ensureBillMonth'); assert.equal(h.calls.at(-1).args[0], '2026-12');
  h.state = { ...h.state, billRules: [{ id: 'rule', revision: 2 }] };
  h.controller.render('money'); await h.idle();
  assert.equal(h.calls.filter(call => call.name === 'ensureBillMonth').length, 4, 'a changed rule gets a fresh month check');
});

test('an old rejected checkout cannot unlock or replace another household’s pending purchase', async () => {
  const first = { id: 'first-list', revision: 1, name: 'First food', product_id: 'product-one', packs: 1, category: 'food', estimate_cents: 2400 };
  const h = harness(ready({ products: [product()], shoppingItems: [first] }));
  let rejectOld;
  h.methods.recordReceipt = () => new Promise((resolve, reject) => { rejectOld = reject; });
  h.controller.startPurchase(first, '2026-11'); h.submit('purchase');
  const oldWork = h.controller.whenIdle(); await Promise.resolve();
  const second = { ...first, id: 'second-list', name: 'Second food' };
  h.state = ready({ user: { id: 'another-user' }, household: { id: 'another-home' }, products: [product()], shoppingItems: [second] });
  h.controller.renderPurchase();
  h.methods.recordReceipt = () => { throw new Error('Second household response was lost'); };
  h.controller.startPurchase(second, '2026-11'); h.submit('purchase'); await h.idle();
  rejectOld(Object.assign(new Error('Old item changed'), { code: '40001' })); await oldWork;
  const html = h.controller.renderPurchase();
  assert.match(html, /Second food/);
  assert.match(html, /Retry save/);
  assert.doesNotMatch(html, /Reload list item|First food/);
  assert.equal(h.controller.getPendingPurchaseId(), second.id);
});

test('bill plans create no spending, payments require confirmation, and ledger totals do not count the receipt twice', async () => {
  const h = harness(ready({ receipts: [{ id: 'receipt', purchased_on: '2026-11-03', total_cents: 1000, items: [] }], moneyEntries: [{ id: 'expense', receipt_id: 'receipt', occurred_on: '2026-11-03', direction: 'expense', category: 'food', amount_cents: 1000 }], budgets: [{ month: '2026-11-01', amount_cents: 10000, household_amount_cents: null }] }));
  const html = h.controller.render('money'); assert.match(html, /Recorded expenses<\/span><strong>\$10\.00/); assert.doesNotMatch(html, /Recorded expenses<\/span><strong>\$20\.00/); assert.match(html, /Household allocation<\/span><strong>Not set/);
  h.click('new-bill'); h.submit('bill', { name: 'Variable utility', variable: true, amount: '' }); await h.idle();
  assert.equal(h.calls[0].name, 'saveBill'); assert.equal(h.calls[0].args[0].amount_cents, null);
  h.state = { ...h.state, bills: [{ id: 'bill-one', name: 'Variable utility', month: '2026-11-01', amount_cents: null }] };
  h.click('pay-bill', { id: 'bill-one' }); h.confirmation = false; h.submit('money', { amount: '42.37' }); await h.idle(); assert.equal(h.calls.length, 1);
  h.confirmation = true; h.submit('money'); await h.idle(); assert.equal(h.calls[1].name, 'recordMoneyEntry'); assert.equal(h.calls[1].args[0].amount_cents, 4237); assert.equal(h.calls[1].args[0].bill_id, 'bill-one');
});

test('new bills repeat when chosen and existing recurring edits default to this month only', async () => {
  const h = harness();
  h.click('new-bill');
  assert.match(h.controller.render('money'), /data-commerce-field="bill.repeat_monthly" checked/);
  h.submit('bill', { name: 'Fixed example', amount: '123.45' }); await h.idle();
  assert.equal(h.calls[0].name, 'saveBill');
  assert.equal(h.calls[0].args[0].repeat_monthly, true);
  assert.equal(h.calls[0].args[0].apply_future, false);
  assert.equal(h.calls.some(call => call.name === 'recordMoneyEntry'), false);
  const saved = { id: 'bill', revision: 4, month: '2026-11-01', name: 'Fixed example', amount_cents: 12345, variable: false, series_id: 'series', rule_id: 'rule' };
  h.state = { ...h.state, bills: [saved] };
  h.click('edit-bill', { id: saved.id });
  let html = h.controller.render('money');
  assert.match(html, /Also use these settings for future monthly bills/);
  assert.doesNotMatch(html.match(/<input[^>]*data-commerce-field="bill.apply_future"[^>]*>/)[0], / checked/);
  h.submit('bill', { amount: '124.00' }); await h.idle();
  let payload = h.calls.at(-1).args[0];
  assert.equal(payload.repeat_monthly, true); assert.equal(payload.apply_future, false); assert.equal(payload.amount_cents, 12400);
  h.click('edit-bill', { id: saved.id }); h.input('bill.apply_future', true);
  h.submit('bill', { amount: '130.00' }); await h.idle();
  payload = h.calls.at(-1).args[0];
  assert.equal(payload.repeat_monthly, true); assert.equal(payload.apply_future, true); assert.equal(payload.amount_cents, 13000);
  assert.equal(Object.hasOwn(payload, 'series_id'), false, 'the server resolves series identity from the saved bill');
});

test('stopping repeats is explicit, preserves an unsaved bill draft, and excludes stopped plans', async () => {
  const bill = { id: 'bill', revision: 1, month: '2026-11-01', name: 'Fixed example', amount_cents: 10000, variable: false, series_id: 'series' };
  const stopped = { id: 'stopped', revision: 1, month: '2026-11-01', name: 'Stopped example', amount_cents: 99000, variable: false, cancelled: true };
  const rule = { id: 'rule', series_id: 'series', revision: 1, effective_month: '2026-11-01', active: true };
  const h = harness(ready({ bills: [bill, stopped], billRules: [rule] }));
  h.controller.render('money'); await h.idle();
  let html = h.controller.render('money');
  assert.match(html, /Fixed monthly bills<\/span><strong>\$100\.00/);
  assert.match(html, /1 stopped automatic bill/);
  assert.doesNotMatch(html.match(/<ul class="commerce-record-list">([\s\S]*?)<\/ul>/)[1], /Stopped example/);
  h.click('edit-bill', { id: bill.id }); h.input('bill.amount', '111.00');
  h.click('stop-bill', { id: bill.id }); await h.idle();
  assert.equal(h.calls.some(call => call.name === 'stopBillSeries'), false);
  assert.match(h.notices.at(-1).message, /Save or discard this bill draft/);
  assert.match(h.controller.render('money'), /id="commerce-bill-amount"[^>]*value="111\.00"/);
  h.click('discard', { group: 'bill' });
  h.confirmation = false; h.click('stop-bill', { id: bill.id }); await h.idle();
  assert.equal(h.calls.some(call => call.name === 'stopBillSeries'), false);
  h.confirmation = true; h.click('stop-bill', { id: bill.id, month: '2026-01' }); await h.idle();
  const calls = h.calls.filter(call => call.name === 'stopBillSeries');
  assert.equal(calls.length, 1); assert.equal(calls[0].args[0].id, bill.id); assert.equal(calls[0].args[1], '2026-12');
});

test('a late full bill payment uses its actual date and a single atomic payment call', async () => {
  const bill = { id: 'old-variable', revision: 1, month: '2026-10-01', name: 'Variable example', amount_cents: null, variable: true };
  const h = harness(ready({ bills: [bill] }));
  h.controller.setMonth('2026-10'); h.click('pay-bill', { id: bill.id });
  const html = h.controller.render('money');
  assert.match(html, /id="commerce-money-occurred-on"[^>]*value="2026-11-04"/);
  assert.match(html, /Record one full bill payment/);
  assert.doesNotMatch(html, /data-commerce-field="money.direction"|data-commerce-field="money.category"/);
  h.submit('money', { amount: '42.37' }); await h.idle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'recordMoneyEntry');
  assert.equal(h.calls[0].args[0].occurred_on, '2026-11-04');
  assert.equal(h.calls[0].args[0].bill_id, bill.id);
});

test('late completion and saved drafts never overwrite a different account’s form', async () => {
  const drafts = memoryDrafts(), h = harness(ready(), { draftStore: drafts }); let resolve;
  h.methods.saveProduct = () => new Promise(done => { resolve = done; });
  h.click('new-product'); h.submit('product', { name: 'First household draft' }); await Promise.resolve();
  h.state = ready({ user: { id: 'person-two' }, household: { id: 'house-two' } }); h.controller.render('catalog');
  h.click('new-product'); h.input('product.name', 'Second household draft'); resolve({}); await h.idle();
  const html = h.controller.render('catalog'); assert.match(html, /Second household draft/); assert.doesNotMatch(html, /First household draft/);
  const firstDraft = drafts.read('person-one', 'house-one', 'commerce'); assert.equal(firstDraft.data.drafts.product.name, 'First household draft');
  assert.equal(drafts.read('person-two', 'house-two', 'commerce').data.drafts.product.name, 'Second household draft');
});

test('uploads validate file type and size before a private store request; signed links are escaped', async () => {
  const fileRow = { id: 'file-one', product_id: 'product-one', name: '<receipt>.pdf' };
  const h = harness(ready({ products: [product()], foodFiles: [fileRow] })); h.click('edit-product', { id: 'product-one' });
  const selectFile = file => h.controller.handleChange({ target: { dataset: { commerceUpload: 'product-one' }, files: [file] } });
  selectFile({ name: 'unsafe.html', size: 80, type: 'text/html' }); h.click('upload-file', { id: 'product-one' }); assert.equal(h.calls.length, 0);
  selectFile({ name: 'huge.pdf', size: 10 * 1024 * 1024 + 1, type: 'application/pdf' }); h.click('upload-file', { id: 'product-one' }); assert.equal(h.calls.length, 0);
  const file = { name: 'label.pdf', size: 1024, type: 'application/pdf' }; selectFile(file);
  h.methods.uploadFoodFile = () => { throw new Error('Upload connection lost'); }; h.click('upload-file', { id: 'product-one' }); await h.idle();
  assert.deepEqual(h.calls[0].args[0], { product_id: 'product-one', file }); assert.equal(h.controller.hasUnsavedDraft(), true);
  h.methods.getFoodFileUrl = () => 'https://private.example.test/file?token=a&b=c';
  h.click('open-file', { id: 'file-one' }); await h.idle();
  const html = h.controller.render('catalog'); assert.match(html, /&lt;receipt&gt;\.pdf/); assert.match(html, /token=a&amp;b=c/); assert.match(html, /rel="noopener noreferrer"/);
});

test('offline changes stay as drafts when the store refuses saving and unrelated events pass through', async () => {
  const h = harness(ready({ offline: true })); assert.match(h.controller.render('catalog'), /Offline — saved device copy/);
  h.methods.saveProduct = () => { throw new Error('Reconnect to save online.'); }; h.click('new-product'); h.submit('product', { name: 'Offline draft' }); await h.idle();
  assert.match(h.controller.render('catalog'), /Offline draft/); assert.equal(h.controller.hasUnsavedDraft(), true);
  assert.equal(h.controller.handleClick({ target: { closest: () => ({ dataset: { groceryAction: 'tab' } }) } }), false);
  assert.equal(h.controller.handleInput({ target: { dataset: { groceryField: 'shopping.name' }, value: 'Tea' } }), false);
  assert.equal(h.controller.handleSubmit({ target: { dataset: { groceryForm: 'shopping' } } }), false);
});
