'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../bloom-food-model.js');
const Food = require('../bloom-food.js');

function product(id = 'rice', overrides = {}) { return { id, name: 'Rice', category: 'food', package_quantity: 1000, package_unit: 'g', serving_quantity: 100, serving_unit: 'g', nutrients: { calories_kcal: 200, protein_g: 5 }, ...overrides }; }
function recipe(id = 'rice-dish', overrides = {}) { return { id, household_id: 'house-one', name: 'Rice dish', servings: 2, ingredients: [{ product_id: 'rice', quantity: 200, unit: 'g' }], instructions: 'Cook gently.\nThen serve.', source_url: '', notes: '', archived: false, revision: 1, ...overrides }; }
function state(overrides = {}) { return { status: 'ready', user: { id: 'owner' }, household: { id: 'house-one', name: 'Our household' }, members: [{ user_id: 'owner', role: 'owner' }, { user_id: 'member', role: 'member' }], dietProfiles: [], products: [product()], recipes: [recipe()], inventory: [], mealEntries: [], foodFiles: [], ...overrides }; }
function savedDraftStore() {
  const values = new Map(), writes = [];
  return { values, writes, read(user, home, area) { return values.get(user + ':' + home + ':' + area) || null; }, write(user, home, area, data) { writes.push({ user, home, area, data: JSON.parse(JSON.stringify(data)) }); values.set(user + ':' + home + ':' + area, { savedAt: '2026-11-04', data: JSON.parse(JSON.stringify(data)) }); return true; }, clear(user, home, area) { values.delete(user + ':' + home + ':' + area); return true; } };
}
function harness(initial = state(), persistence = savedDraftStore()) {
  let current = initial, consent = true;
  const calls = [], notices = [], refreshes = [], links = [], downloads = [], methods = {};
  const store = { snapshot: () => current };
  for (const method of ['saveRecipe', 'saveMealEntry', 'deleteMealEntry', 'uploadFoodFile', 'getFoodFileUrl', 'deleteFoodFile']) store[method] = async (...args) => { calls.push({ method, args }); return methods[method] ? methods[method](...args) : {}; };
  const controller = Food.createController({ store, draftStore: persistence, notify: (message, error) => notices.push({ message, error }), refresh: selector => refreshes.push(selector), navigate: page => links.push(page), openGrocery: tab => links.push('grocery:' + tab), confirm: () => consent, getNow: () => new Date(2026, 10, 4, 12), download: (name, content, type) => downloads.push({ name, content, type }) });
  controller.render();
  const click = (action, extra = {}) => { let prevented = false; const element = { dataset: { foodAction: action, ...extra } }; assert.equal(controller.handleClick({ target: { closest: () => element }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  const input = (field, value) => assert.equal(controller.handleInput({ target: { dataset: { foodField: field }, value: String(value) } }), true);
  const ingredient = (index, part, value) => assert.equal(controller.handleInput({ target: { dataset: { foodIngredient: String(index), foodPart: part }, value: String(value) } }), true);
  const submit = (kind, fields = {}) => { let prevented = false; assert.equal(controller.handleSubmit({ target: { dataset: { foodForm: kind }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]) } : null } }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  return { controller, store, calls, notices, refreshes, links, downloads, methods, persistence, click, input, ingredient, submit, get state() { return current; }, set state(value) { current = value; }, set consent(value) { consent = value; }, idle: () => controller.whenIdle() };
}

test('Food opens a real saved collection with prominent Grocery shortcuts and escaped content', () => {
  const h = harness(state({ recipes: [recipe('one', { name: '<script>Recipe</script>' })] }));
  const html = h.controller.render('food');
  assert.match(html, /Grocery list/);
  assert.match(html, /Food at home/);
  assert.match(html, /Saved recipes/);
  assert.match(html, /&lt;script&gt;Recipe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  h.click('grocery', { tab: 'list' });
  h.click('grocery', { tab: 'inventory' });
  assert.deepEqual(h.links, ['grocery:list', 'grocery:inventory']);
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.hasUnpersistedChanges(), false);
});

test('recipe saves exact ingredient quantities and a failed retry keeps its stable request identifier', async () => {
  const h = harness();
  h.click('new-recipe');
  const fields = { name: 'Lunch <rice>', servings: '4', ingredient_0_product_id: 'rice', ingredient_0_quantity: '400', ingredient_0_unit: 'g', instructions: 'Line one\nLine two', source_url: 'https://example.test/recipe', notes: 'Keep this' };
  h.methods.saveRecipe = () => { throw new Error('Connection lost'); };
  h.submit('recipe', fields);
  await h.idle();
  assert.equal(h.controller.hasUnsavedDraft(), true);
  assert.match(h.controller.render(), /Lunch &lt;rice&gt;/);
  const payload = h.calls[0].args[0];
  assert.equal(payload.name, 'Lunch <rice>');
  assert.equal(payload.servings, 4);
  assert.deepEqual(payload.ingredients, [{ product_id: 'rice', quantity: 400, unit: 'g' }]);
  assert.equal(payload.instructions, 'Line one\nLine two');
  assert.match(payload.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(Object.hasOwn(payload, 'height_cm'), false);
  h.methods.saveRecipe = value => { const row = { ...value, id: value.request_id, revision: 1 }; h.state = { ...h.state, recipes: [...h.state.recipes, row] }; return row; };
  h.submit('recipe');
  await h.idle();
  assert.equal(h.calls[1].args[0].request_id, payload.request_id);
  assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.match(h.notices.at(-1).message, /recipe was saved/);
});

test('recipe validation refuses missing catalog products, bad yields, and executable source URLs', async () => {
  const h = harness();
  h.click('new-recipe');
  h.submit('recipe', { name: 'Recipe', servings: '0', ingredient_0_product_id: 'rice', ingredient_0_quantity: '100', ingredient_0_unit: 'g' });
  await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('recipe', { servings: '1', ingredient_0_product_id: 'unavailable' });
  await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('recipe', { ingredient_0_product_id: 'rice', source_url: 'javascript:alert(1)' });
  await h.idle(); assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /http or https/);
});

test('recipe and food drafts survive subsection changes and restore only for the same account and household', () => {
  const persistence = savedDraftStore();
  const h = harness(state(), persistence);
  h.click('new-recipe');
  h.input('recipe.name', 'My saved draft');
  h.input('recipe.instructions', 'A private household draft');
  h.consent = false;
  h.click('tab', { tab: 'soon' });
  h.click('tab', { tab: 'recipes' });
  assert.match(h.controller.render(), /My saved draft/);
  const reopened = harness(state(), persistence);
  assert.match(reopened.controller.render(), /My saved draft/);
  assert.match(reopened.controller.render(), /Draft saved on this device/);
  reopened.state = state({ user: { id: 'different' } });
  assert.doesNotMatch(reopened.controller.render(), /My saved draft|A private household draft/);
  reopened.state = state({ household: { id: 'different-house', name: 'Another' } });
  assert.doesNotMatch(reopened.controller.render(), /My saved draft/);
  assert.equal(persistence.writes[0].area, 'food');
  assert.equal(persistence.writes[0].user, 'owner');
});

test('different portions update one person and preserve unknown nutrients instead of claiming zero', async () => {
  const h = harness();
  h.click('log-recipe', { id: 'rice-dish', person: '2' });
  h.submit('log', { servings: '1.5', occurred_on: '2026-11-04', kind: 'eaten' });
  await h.idle();
  const payload = h.calls[0].args[0];
  assert.equal(h.calls[0].method, 'saveMealEntry');
  assert.equal(payload.person_slot, 2);
  assert.equal(payload.kind, 'eaten');
  assert.equal(payload.recipe_id, 'rice-dish');
  assert.equal(payload.product_id, null);
  assert.equal(payload.nutrition_snapshot.values.calories_kcal, 300);
  assert.equal(payload.nutrition_snapshot.values.protein_g, 7.5);
  assert.equal(payload.nutrition_snapshot.values.fiber_g, null);
  assert.equal(payload.nutrition_snapshot.missing.fiber_g, 1);
  assert.equal(h.calls.length, 1);
});

test('nutrition screens keep Person 1, Person 2, planned and eaten portions separate', () => {
  const eaten = M.productNutrition(product(), 1);
  const planned = M.productNutrition(product(), 3);
  const h = harness(state({ dietProfiles: [{ user_id: 'owner', display_name: 'First person', calories_kcal: 1500 }, { user_id: 'member', display_name: 'Second person', protein_g: 80 }], mealEntries: [
    { id: 'one', occurred_on: '2026-11-04', person_slot: 1, kind: 'eaten', label: 'First eaten', servings: 1, nutrition_snapshot: eaten },
    { id: 'two', occurred_on: '2026-11-04', person_slot: 1, kind: 'planned', label: 'First planned', servings: 3, nutrition_snapshot: planned }
  ] }));
  const html = h.controller.render('wellness');
  assert.match(html, /food-person-pink/);
  assert.match(html, /food-person-purple/);
  assert.match(html, /Actually eaten/);
  assert.match(html, /200 kcal/);
  assert.match(html, /600 kcal/);
  assert.doesNotMatch(html, /800 kcal/);
  assert.match(html, /No eaten portions logged for this date/);
  assert.match(html, /1,500 kcal/);
  assert.match(html, /80 g/);
});

test('editing a historical portion scales its saved nutrition instead of recomputing an edited recipe', async () => {
  const historical = M.productNutrition(product('rice', { nutrients: { calories_kcal: 100, protein_g: 4 } }), 1);
  const row = { id: 'meal-one', occurred_on: '2026-11-03', person_slot: 1, kind: 'eaten', recipe_id: 'rice-dish', product_id: null, label: 'Original recipe name', servings: 1, nutrition_snapshot: historical, notes: '', revision: 6 };
  const h = harness(state({ recipes: [recipe('rice-dish', { name: 'Edited recipe name' })], mealEntries: [row] }));
  h.click('edit-log', { id: row.id });
  h.submit('log', { servings: '2', notes: 'Corrected portion' });
  await h.idle();
  const payload = h.calls[0].args[0];
  assert.equal(payload.nutrition_snapshot.values.calories_kcal, 200);
  assert.equal(payload.nutrition_snapshot.values.protein_g, 8);
  assert.equal(payload.label, 'Original recipe name');
  assert.equal(payload.revision, 6);
  assert.equal(payload.id, row.id);
  assert.equal(payload.occurred_on, '2026-11-03');
});

test('logging an eaten portion from a plan creates a separate entry and preserves the plan', async () => {
  const row = { id: 'planned-one', occurred_on: '2026-11-04', person_slot: 2, kind: 'planned', recipe_id: 'rice-dish', product_id: null, label: 'Planned dish', servings: 1, nutrition_snapshot: M.productNutrition(product(), 1), notes: '', revision: 2 };
  const h = harness(state({ mealEntries: [row] }));
  h.click('eaten-from-plan', { id: row.id });
  h.submit('log', { servings: '.5' });
  await h.idle();
  const payload = h.calls[0].args[0];
  assert.equal(payload.id, '');
  assert.equal(payload.revision, null);
  assert.equal(payload.kind, 'eaten');
  assert.equal(payload.person_slot, 2);
  assert.equal(payload.nutrition_snapshot.values.calories_kcal, 100);
  assert.equal(h.state.mealEntries[0].kind, 'planned');
});

test('use-soon screen visibly distinguishes past dates and suggests only matching upcoming food', () => {
  const h = harness(state({ inventory: [
    { id: 'near', product_id: 'rice', name: 'Rice batch', quantity: 400, unit: 'g', location: 'freezer', expires_on: '2026-11-05', frozen_on: '2026-11-01', reminder_days: 3, date_type: 'best_before' },
    { id: 'old', product_id: 'other', name: 'Past-date batch', quantity: 1, unit: 'each', expires_on: '2026-11-02' },
    { id: 'unknown', product_id: 'rice', name: 'Undated rice', quantity: 100, unit: 'g' }
  ], recipes: [recipe(), recipe('old-recipe', { name: 'Past-date only recipe', ingredients: [{ product_id: 'other', quantity: 1, unit: 'each' }] })] }));
  h.click('tab', { tab: 'soon' });
  const html = h.controller.render();
  assert.match(html, /Past recorded date · review/);
  assert.match(html, /Best before/);
  assert.match(html, /Frozen Nov 1, 2026/);
  assert.match(html, /Undated rice/);
  assert.match(html, /Rice dish/);
  assert.doesNotMatch(html, /Past-date only recipe/);
  assert.match(html, /1 food without a recorded date/);
});

test('recorded allergy matches are shown beside recipes and for the selected person', () => {
  const h = harness(state({ products: [product('rice', { name: 'Milk rice', allergens: 'Contains milk' })], dietProfiles: [{ user_id: 'owner', allergies: 'Dairy' }] }));
  h.click('view-recipe', { id: 'rice-dish' });
  assert.match(h.controller.render(), /Recorded allergy match/);
  assert.match(h.controller.render(), /Person 1 — milk/);
  h.click('log-recipe', { id: 'rice-dish', person: '2' });
  assert.doesNotMatch(h.controller.render(), /Person 1 — milk/);
});

test('calendar reminders download on the user action and safely escape text and dates', () => {
  const item = { id: 'item-one', name: 'Rice, beans;\nEND:VEVENT', quantity: 1, expires_on: '2026-11-05', date_type: 'best_before', reminder_days: 2 };
  const h = harness(state({ inventory: [item] }));
  assert.equal(h.downloads.length, 0);
  h.click('calendar', { id: item.id });
  assert.equal(h.downloads.length, 1);
  const file = h.downloads[0];
  assert.match(file.content, /DTSTART;VALUE=DATE:20261105/);
  assert.match(file.content, /DTEND;VALUE=DATE:20261106/);
  assert.match(file.content, /TRIGGER:-P2D/);
  assert.match(file.content, /Rice\\, beans\\;\\nEND:VEVENT/);
  assert.equal((file.content.match(/\r\nEND:VEVENT\r\n/g) || []).length, 1);
  assert.doesNotMatch(file.content, /ATTENDEE|ORGANIZER/);
  assert.equal(h.calls.length, 0);
});

test('recipe files require a supported type and an explicit upload action', async () => {
  const h = harness();
  h.click('view-recipe', { id: 'rice-dish' });
  const rejected = { dataset: { foodFileInput: 'rice-dish' }, files: [{ name: 'danger.svg', type: 'image/svg+xml', size: 200 }], value: 'danger.svg' };
  assert.equal(h.controller.handleChange({ target: rejected }), true);
  assert.equal(rejected.value, '');
  assert.equal(h.calls.length, 0);
  const file = { name: 'Recipe.pdf', type: 'application/pdf', size: 3000 };
  assert.equal(h.controller.handleChange({ target: { dataset: { foodFileInput: 'rice-dish' }, files: [file] } }), true);
  assert.equal(h.calls.length, 0);
  h.click('upload-file', { id: 'rice-dish' });
  assert.equal(h.controller.hasUnpersistedChanges(), true);
  await h.idle();
  assert.deepEqual(h.calls[0], { method: 'uploadFoodFile', args: [{ recipe_id: 'rice-dish', file }] });
  assert.equal(h.controller.hasUnpersistedChanges(), false);
});

test('portion preview and local draft indicator update without replacing the active input', () => {
  const h = harness();
  h.click('log-recipe', { id: 'rice-dish', person: '1' });
  const preview = { innerHTML: '' }, indicator = { hidden: true, textContent: '' };
  const previous = global.document;
  global.document = { querySelector: selector => selector === '#food-log-nutrition-values' ? preview : selector === '[data-food-draft-status="log"]' ? indicator : null };
  try {
    const count = h.refreshes.length;
    h.input('log.servings', '1.5');
    assert.match(preview.innerHTML, /300 kcal/);
    assert.equal(indicator.hidden, false);
    assert.match(indicator.textContent, /Draft saved on this device/);
    assert.equal(h.refreshes.length, count);
    assert.equal(h.controller.hasUnpersistedChanges(), false);
  } finally { global.document = previous; }
});

test('Use-soon deep links retain a recipe draft and open the requested section', () => {
  const h = harness();
  h.click('new-recipe'); h.input('recipe.name', 'Keep my recipe');
  h.consent = false;
  assert.equal(h.controller.selectTab('soon'), true);
  assert.match(h.controller.render(), /Food dates to check/);
  assert.equal(h.controller.selectTab('recipes'), true);
  assert.match(h.controller.render(), /Keep my recipe/);
  assert.equal(h.controller.selectTab('unknown'), false);
});

test('offline drafts remain editable while posting a meal is refused and no success is claimed', async () => {
  const h = harness(state({ offline: true }));
  h.click('log-recipe', { id: 'rice-dish', person: '1' });
  h.input('log.notes', 'Keep this offline note');
  h.submit('log');
  await h.idle();
  assert.equal(h.calls.length, 0);
  assert.match(h.controller.render(), /Keep this offline note/);
  assert.match(h.controller.render(), /Offline · showing the saved device copy/);
  assert.match(h.notices.at(-1).message, /offline/);
  assert.ok(h.persistence.values.size);
});

test('late recipe completion cannot replace a different account draft', async () => {
  const h = harness();
  let resolve;
  h.methods.saveRecipe = () => new Promise(done => { resolve = done; });
  h.click('new-recipe');
  h.submit('recipe', { name: 'Old household recipe', servings: 1, ingredient_0_product_id: 'rice', ingredient_0_quantity: 100, ingredient_0_unit: 'g' });
  await Promise.resolve();
  h.state = state({ user: { id: 'new-user' }, household: { id: 'new-house', name: 'New home' } });
  h.controller.render();
  h.click('new-recipe');
  h.input('recipe.name', 'New household draft');
  resolve({ id: 'old-recipe' });
  await h.idle();
  const html = h.controller.render();
  assert.match(html, /New household draft/);
  assert.doesNotMatch(html, /Old household recipe/);
});

test('unrelated events are not captured and signed-out records are not displayed', () => {
  const h = harness(state({ status: 'signed-out', user: null, household: null }));
  assert.match(h.controller.render(), /Open Grocery/);
  assert.doesNotMatch(h.controller.render(), /Rice dish/);
  assert.equal(h.controller.handleInput({ target: { dataset: { groceryField: 'auth.password' }, value: 'not-a-food-field' } }), false);
  assert.equal(h.controller.handleSubmit({ target: { dataset: { groceryForm: 'auth' } } }), false);
  assert.equal(h.controller.handleClick({ target: { closest: () => ({ dataset: { groceryAction: 'signout' } }) } }), false);
});
