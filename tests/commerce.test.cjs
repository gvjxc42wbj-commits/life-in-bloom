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
  for (const name of ['saveProduct', 'saveRecurringProduct', 'saveShoppingItem', 'saveShoppingItems', 'recordReceipt', 'voidReceipt', 'saveBill', 'recordMoneyEntry', 'voidMoneyEntry', 'saveBudget', 'uploadFoodFile', 'getFoodFileUrl', 'deleteFoodFile']) store[name] = async (...args) => {
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
  const submit = (group, fields = {}) => {
    let prevented = false;
    const result = controller.handleSubmit({ target: { dataset: { commerceForm: group }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]), checked: fields[name] === true } : null } }, preventDefault: () => { prevented = true; } });
    assert.equal(result, true); assert.equal(prevented, true); return result;
  };
  const keys = () => Array.from(new Set(Array.from(controller.render('receipts').matchAll(/data-commerce-line="([^"]+)"/g), match => match[1])));
  return { controller, store, calls, notices, methods, refreshes, confirmations, click, input, line, submit, keys, idle: () => controller.whenIdle(), get state() { return current; }, set state(value) { current = value; }, set confirmation(value) { confirmation = value; } };
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

test('bill plans create no spending, payments require confirmation, and ledger totals do not count the receipt twice', async () => {
  const h = harness(ready({ receipts: [{ id: 'receipt', purchased_on: '2026-11-03', total_cents: 1000, items: [] }], moneyEntries: [{ id: 'expense', receipt_id: 'receipt', occurred_on: '2026-11-03', direction: 'expense', category: 'food', amount_cents: 1000 }], budgets: [{ month: '2026-11-01', amount_cents: 10000, household_amount_cents: null }] }));
  const html = h.controller.render('money'); assert.match(html, /Recorded expenses<\/span><strong>\$10\.00/); assert.doesNotMatch(html, /Recorded expenses<\/span><strong>\$20\.00/); assert.match(html, /Household allocation<\/span><strong>Not set/);
  h.click('new-bill'); h.submit('bill', { name: 'Variable utility', variable: true, amount: '' }); await h.idle();
  assert.equal(h.calls[0].name, 'saveBill'); assert.equal(h.calls[0].args[0].amount_cents, null);
  h.state = { ...h.state, bills: [{ id: 'bill-one', name: 'Variable utility', month: '2026-11-01', amount_cents: null }] };
  h.click('pay-bill', { id: 'bill-one' }); h.confirmation = false; h.submit('money', { amount: '42.37' }); await h.idle(); assert.equal(h.calls.length, 1);
  h.confirmation = true; h.submit('money'); await h.idle(); assert.equal(h.calls[1].name, 'recordMoneyEntry'); assert.equal(h.calls[1].args[0].amount_cents, 4237); assert.equal(h.calls[1].args[0].bill_id, 'bill-one');
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
