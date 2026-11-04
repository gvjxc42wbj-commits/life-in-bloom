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
  const reference = (key, value) => assert.equal(controller.handleInput({ target: { dataset: { foodReference: key }, value: String(value) } }), true);
  const ingredient = (index, part, value) => assert.equal(controller.handleInput({ target: { dataset: { foodIngredient: String(index), foodPart: part }, value: String(value) } }), true);
  const submit = (kind, fields = {}) => { let prevented = false; assert.equal(controller.handleSubmit({ target: { dataset: { foodForm: kind }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]) } : null } }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  return { controller, store, calls, notices, refreshes, links, downloads, methods, persistence, click, input, reference, ingredient, submit, get state() { return current; }, set state(value) { current = value; }, set consent(value) { consent = value; }, idle: () => controller.whenIdle() };
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

test('written ingredients and whole-recipe estimates save without invented catalog links', async () => {
  const h = harness(state({ products: [], recipes: [] }));
  h.methods.saveRecipe = payload => {
    const row = { ...payload, id: payload.request_id, revision: 1 };
    h.state = { ...h.state, recipes: [row] };
    return row;
  };
  h.click('new-recipe');
  h.submit('recipe', {
    name: 'Example vegetable dish', servings: 5,
    ingredient_text: '2–4 sample vegetables\nSeasoning to taste\nOptional <garnish>',
    instructions: 'Prepare and serve.', nutrition_mode: 'reference',
    nutrition_reference_calories_kcal: '1500', nutrition_reference_protein_g: '50',
    nutrition_reference_fiber_g: '0', nutrition_reference_sodium_mg: '',
    nutrition_source: 'Example <recipe card> estimate'
  });
  await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'saveRecipe');
  const payload = h.calls[0].args[0];
  assert.deepEqual(payload.ingredients, [], 'the untouched blank link row is not saved as an ingredient');
  assert.equal(payload.ingredient_text, '2–4 sample vegetables\nSeasoning to taste\nOptional <garnish>');
  assert.equal(payload.nutrition_mode, 'reference');
  assert.equal(payload.nutrition_reference.calories_kcal, 1500);
  assert.equal(payload.nutrition_reference.protein_g, 50);
  assert.equal(payload.nutrition_reference.fiber_g, 0);
  assert.equal(payload.nutrition_reference.sodium_mg, null);
  const html = h.controller.render();
  assert.match(html, /Ingredients as written/);
  assert.match(html, /2–4 sample vegetables\nSeasoning to taste\nOptional &lt;garnish&gt;/);
  assert.match(html, /300 kcal/);
  assert.match(html, /10 g protein/);
  assert.match(html, /Recipe estimate/);
  assert.match(html, /Example &lt;recipe card&gt; estimate/);
  assert.doesNotMatch(html, /<garnish>|<recipe card>|0 ingredients/);
  assert.equal(h.state.products.length, 0);
});

test('optional catalog links reject partial or broken entries instead of silently losing them', async () => {
  const h = harness();
  h.click('new-recipe');
  const base = { name: 'Written dish', servings: 2, ingredient_text: 'A written ingredient list' };
  h.submit('recipe', { ...base, ingredient_0_product_id: 'rice', ingredient_0_quantity: '', ingredient_0_unit: 'g' });
  await h.idle(); assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /Ingredient amount/);
  h.submit('recipe', { ingredient_0_product_id: '', ingredient_0_quantity: '20' });
  await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('recipe', { ingredient_0_product_id: 'unavailable' });
  await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('recipe', { ingredient_0_product_id: '', ingredient_0_quantity: '', ingredient_0_unit: 'g' });
  await h.idle(); assert.equal(h.calls.length, 0, 'a changed unit is a partial row, not an untouched row');
  h.click('remove-ingredient', { index: '0' });
  h.submit('recipe', { ingredient_text: '' });
  await h.idle(); assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /ingredient list or link/);
  h.submit('recipe', { ingredient_text: 'x'.repeat(12001) });
  await h.idle(); assert.equal(h.calls.length, 0);
  h.submit('recipe', { ingredient_text: base.ingredient_text });
  await h.idle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].args[0].ingredients, []);
  assert.equal(h.calls[0].args[0].nutrition_mode, 'ingredients');
});

test('reference editor validates sources and finite nonnegative values while retaining blanks and zero', async () => {
  const h = harness();
  h.click('new-recipe');
  h.input('recipe.nutrition_mode', 'reference');
  const html = h.controller.render();
  assert.match(html, /Nutrition estimates for the whole recipe/);
  assert.match(html, /Use recipe estimates/);
  assert.match(html, /Source and assumptions/);
  assert.match(html, /id="food-recipe-reference-protein_g"/);
  h.submit('recipe', { name: 'Estimated dish', servings: 3, ingredient_text: 'An ingredient list' });
  await h.idle(); assert.equal(h.calls.length, 0);
  assert.match(h.notices.at(-1).message, /source and assumptions/);
  h.input('recipe.nutrition_source', 'Example estimate');
  for (const invalid of ['-1', 'Infinity', 'not a number', '1000000001']) {
    h.reference('protein_g', invalid);
    h.submit('recipe'); await h.idle();
    assert.equal(h.calls.length, 0, invalid + ' must not be saved');
  }
  h.reference('protein_g', '');
  h.reference('fiber_g', '0');
  h.input('recipe.nutrition_source', 'x'.repeat(2001));
  h.submit('recipe'); await h.idle(); assert.equal(h.calls.length, 0);
  h.input('recipe.nutrition_source', 'Example estimate');
  h.input('recipe.nutrition_mode', 'unsupported');
  h.submit('recipe'); await h.idle(); assert.equal(h.calls.length, 0);
  h.input('recipe.nutrition_mode', 'reference');
  h.submit('recipe'); await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[0].nutrition_reference.protein_g, null);
  assert.equal(h.calls[0].args[0].nutrition_reference.fiber_g, 0);
});

test('switching to ingredient labels keeps invalid retained estimates visible and preserves valid values', async () => {
  const h = harness();
  h.click('new-recipe');
  h.input('recipe.name', 'Retained estimates dish');
  h.input('recipe.servings', '2');
  h.input('recipe.ingredient_text', 'A written ingredient list');
  h.input('recipe.nutrition_mode', 'reference');
  h.input('recipe.nutrition_source', 'Example recipe estimate');
  h.reference('protein_g', '-1');
  h.reference('calories_kcal', '600');
  h.reference('fiber_g', '8');
  h.input('recipe.nutrition_mode', 'ingredients');
  const html = h.controller.render();
  assert.match(html, /value="ingredients" selected/);
  assert.match(html, /Correct the retained recipe estimates below before saving/);
  assert.match(html, /Protein for the whole recipe must be a number/);
  assert.match(html, /id="food-recipe-reference-protein_g"[^>]*value="-1"/);
  assert.doesNotMatch(html, /<textarea[^>]*id="food-recipe-nutrition_source"[^>]*required/);
  h.submit('recipe'); await h.idle();
  assert.equal(h.calls.length, 0, 'retained invalid data must still fail validation');
  h.reference('protein_g', '');
  h.submit('recipe'); await h.idle();
  assert.equal(h.calls.length, 1);
  const payload = h.calls[0].args[0];
  assert.equal(payload.nutrition_mode, 'ingredients');
  assert.equal(payload.nutrition_reference.protein_g, null);
  assert.equal(payload.nutrition_reference.calories_kcal, 600);
  assert.equal(payload.nutrition_reference.fiber_g, 8);
  assert.equal(payload.nutrition_source, 'Example recipe estimate');
});

test('an overlong retained estimate source remains correctable in ingredient-label mode', async () => {
  const h = harness();
  h.click('new-recipe');
  h.input('recipe.name', 'Source correction dish');
  h.input('recipe.servings', '2');
  h.input('recipe.ingredient_text', 'A written ingredient list');
  h.input('recipe.nutrition_mode', 'reference');
  h.reference('protein_g', '24');
  h.input('recipe.nutrition_source', 'x'.repeat(2001));
  h.input('recipe.nutrition_mode', 'ingredients');
  const html = h.controller.render();
  assert.match(html, /Correct the retained recipe estimates below before saving/);
  assert.match(html, /Estimate source and assumptions is too long/);
  assert.match(html, /id="food-recipe-nutrition_source"/);
  assert.match(html, /id="food-recipe-reference-protein_g"[^>]*value="24"/);
  h.submit('recipe'); await h.idle(); assert.equal(h.calls.length, 0);
  h.input('recipe.nutrition_source', 'A corrected example source');
  assert.doesNotMatch(h.controller.render(), /Correct the retained recipe estimates below before saving/);
  h.submit('recipe'); await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[0].nutrition_mode, 'ingredients');
  assert.equal(h.calls[0].args[0].nutrition_reference.protein_g, 24);
  assert.equal(h.calls[0].args[0].nutrition_source, 'A corrected example source');
});

test('reference drafts restore their values and older drafts default to ingredient calculation', async () => {
  const persistence = savedDraftStore(), h = harness(state(), persistence);
  h.click('new-recipe');
  h.input('recipe.name', 'Draft example');
  h.input('recipe.servings', '4');
  h.input('recipe.ingredient_text', 'A written ingredient list');
  h.input('recipe.nutrition_mode', 'reference');
  h.input('recipe.nutrition_source', 'Example estimate');
  const count = h.refreshes.length;
  h.reference('protein_g', '64'); h.reference('fiber_g', '0');
  assert.equal(h.refreshes.length, count, 'reference typing must not replace the active field');
  const restored = harness(state(), persistence);
  const html = restored.controller.render();
  assert.match(html, /value="reference" selected/);
  assert.match(html, /id="food-recipe-reference-protein_g"[^>]*value="64"/);
  assert.match(html, /id="food-recipe-reference-fiber_g"[^>]*value="0"/);
  restored.submit('recipe'); await restored.idle();
  assert.equal(restored.calls[0].args[0].nutrition_reference.protein_g, 64);
  assert.equal(restored.calls[0].args[0].nutrition_source, 'Example estimate');

  const oldPersistence = savedDraftStore(), older = harness(state(), oldPersistence);
  older.click('new-recipe');
  older.input('recipe.name', 'Older draft'); older.input('recipe.servings', '2');
  older.ingredient(0, 'product_id', 'rice'); older.ingredient(0, 'quantity', '200');
  const saved = oldPersistence.read('owner', 'house-one', 'food');
  for (const target of [saved.data.drafts.recipe, saved.data.baselines.recipe]) {
    for (const key of ['ingredient_text', 'nutrition_mode', 'nutrition_reference', 'nutrition_source']) delete target[key];
  }
  const reopened = harness(state(), oldPersistence);
  assert.match(reopened.controller.render(), /value="ingredients" selected/);
  reopened.submit('recipe'); await reopened.idle();
  assert.equal(reopened.calls[0].args[0].nutrition_mode, 'ingredients');
  assert.equal(reopened.calls[0].args[0].nutrition_reference.protein_g, null);
  assert.equal(M.recipeNutrition(reopened.calls[0].args[0], reopened.state.products, 1).values.calories_kcal, 200);
});

test('editing a reference recipe preserves whole-recipe totals while changed yield changes future portions', async () => {
  const saved = recipe('estimated', { servings: 4, ingredients: [], ingredient_text: 'A complete written list', nutrition_mode: 'reference', nutrition_reference: { calories_kcal: 1200, protein_g: 80 }, nutrition_source: 'Example estimate', revision: 8 });
  const before = structuredClone(saved), h = harness(state({ recipes: [saved] }));
  h.click('edit-recipe', { id: saved.id });
  assert.match(h.controller.render(), /value="reference" selected/);
  assert.match(h.controller.render(), /id="food-recipe-reference-protein_g"[^>]*value="80"/);
  h.submit('recipe', { servings: 8, notes: 'Smaller portions' }); await h.idle();
  const payload = h.calls[0].args[0];
  assert.equal(payload.revision, 8);
  assert.equal(payload.ingredient_text, saved.ingredient_text);
  assert.equal(payload.nutrition_reference.protein_g, 80);
  assert.equal(payload.nutrition_source, saved.nutrition_source);
  assert.equal(M.recipeNutrition(payload, [], 1).values.protein_g, 10);
  assert.deepEqual(saved, before, 'editing a draft must not mutate the stored recipe object');
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

test('recipe estimate portions stay separate by person and planned versus eaten, with labeled totals', async () => {
  const dish = recipe('estimate-dish', { servings: 4, ingredients: [], ingredient_text: 'An example ingredient list', nutrition_mode: 'reference', nutrition_reference: { calories_kcal: 800, protein_g: 80 }, nutrition_source: 'Example <card> estimate' });
  const h = harness(state({ recipes: [dish], products: [] }));
  h.methods.saveMealEntry = payload => {
    const row = { ...payload, id: 'entry-' + h.calls.length, revision: 1 };
    h.state = { ...h.state, mealEntries: [...h.state.mealEntries, row] };
    return row;
  };
  h.click('log-recipe', { id: dish.id, person: '1' });
  h.submit('log', { servings: '1.5', kind: 'planned' }); await h.idle();
  h.click('log-recipe', { id: dish.id, person: '2' });
  h.submit('log', { servings: '.5', kind: 'eaten' }); await h.idle();
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.method === 'saveMealEntry'));
  const [planned, eaten] = h.state.mealEntries;
  assert.equal(planned.person_slot, 1); assert.equal(planned.kind, 'planned');
  assert.equal(planned.nutrition_snapshot.values.calories_kcal, 300);
  assert.equal(planned.nutrition_snapshot.values.protein_g, 30);
  assert.equal(eaten.person_slot, 2); assert.equal(eaten.kind, 'eaten');
  assert.equal(eaten.nutrition_snapshot.values.calories_kcal, 100);
  assert.equal(eaten.nutrition_snapshot.values.protein_g, 10);
  for (const entry of [planned, eaten]) {
    assert.equal(entry.nutrition_snapshot.estimated, true);
    assert.equal(entry.nutrition_snapshot.basis, 'recipe_reference');
    assert.equal(entry.nutrition_snapshot.source, dish.nutrition_source);
    assert.equal(entry.nutrition_snapshot.values.fiber_g, null);
  }
  const html = h.controller.render('wellness');
  const pink = html.split('<section class="panel food-person-pink">')[1].split('</section>')[0];
  const purple = html.split('<section class="panel food-person-purple">')[1].split('</section>')[0];
  assert.match(pink, /300 kcal/); assert.doesNotMatch(pink, /100 kcal/);
  assert.match(pink, /No eaten portions logged/);
  assert.match(purple, /100 kcal/); assert.doesNotMatch(purple, /300 kcal/);
  assert.match(purple, /No planned portions/);
  assert.match(pink, /Includes estimates/); assert.match(purple, /Includes estimates/);
  assert.match(html, /Example &lt;card&gt; estimate/);
  assert.doesNotMatch(html, /<card>/);
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

test('historical estimate edits and eaten portions keep their original provenance after the recipe changes', async () => {
  const original = recipe('estimated', { servings: 4, ingredients: [], ingredient_text: 'An ingredient list', nutrition_mode: 'reference', nutrition_reference: { calories_kcal: 800, protein_g: 80 }, nutrition_source: 'Earlier example estimate' });
  const snapshot = M.recipeNutrition(original, [], 1);
  const row = { id: 'earlier-plan', occurred_on: '2026-11-03', person_slot: 2, kind: 'planned', recipe_id: original.id, product_id: null, label: 'Earlier dish', servings: 1, nutrition_snapshot: snapshot, notes: '', revision: 5 };
  const before = structuredClone(row);
  const revised = { ...original, nutrition_reference: { calories_kcal: 4000, protein_g: 400 }, nutrition_source: 'Later replacement estimate' };
  const h = harness(state({ recipes: [revised], mealEntries: [row] }));
  h.click('edit-log', { id: row.id });
  h.submit('log', { servings: '.5' }); await h.idle();
  let payload = h.calls[0].args[0];
  assert.equal(payload.nutrition_snapshot.values.calories_kcal, 100);
  assert.equal(payload.nutrition_snapshot.values.protein_g, 10);
  assert.equal(payload.nutrition_snapshot.source, original.nutrition_source);
  assert.equal(payload.nutrition_snapshot.basis, 'recipe_reference');
  assert.equal(payload.nutrition_snapshot.estimated, true);
  assert.equal(payload.label, row.label);
  h.click('eaten-from-plan', { id: row.id });
  h.submit('log', { servings: '2' }); await h.idle();
  payload = h.calls[1].args[0];
  assert.equal(payload.id, '');
  assert.equal(payload.kind, 'eaten');
  assert.equal(payload.person_slot, 2);
  assert.equal(payload.nutrition_snapshot.values.calories_kcal, 400);
  assert.equal(payload.nutrition_snapshot.values.protein_g, 40);
  assert.equal(payload.nutrition_snapshot.source, original.nutrition_source);
  assert.equal(payload.nutrition_snapshot.estimated, true);
  assert.equal(payload.nutrition_snapshot.values.fiber_g, null);
  assert.deepEqual(row, before, 'the original plan and its snapshot remain untouched');
  const total = M.nutritionTotals([snapshot]);
  const scaled = Food.scaledSnapshot(total, 2);
  assert.deepEqual(scaled.sources, ['Earlier example estimate']);
  assert.equal(scaled.basis, 'nutrition_total');
  scaled.sources.push('Another example');
  assert.deepEqual(total.sources, ['Earlier example estimate']);
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

test('use-soon written recipes show unverified coverage without an empty shortages list', () => {
  const h = harness(state({
    inventory: [{ id: 'near', product_id: 'rice', name: 'Rice batch', quantity: 400, unit: 'g', expires_on: '2026-11-05' }],
    recipes: [recipe('written-dish', { ingredient_text: '200 g rice\n1 portion of vegetables' })]
  }));
  h.click('tab', { tab: 'soon' });
  let html = h.controller.render();
  assert.match(html, /Check the written ingredient list for any foods not linked yet/);
  assert.doesNotMatch(html, /Recorded quantities cover this recipe/);
  assert.doesNotMatch(html, /Also needed or needing review/);
  assert.doesNotMatch(html, /<ul>\s*<\/ul>/);
  h.state = { ...h.state, inventory: [{ ...h.state.inventory[0], quantity: 100 }] };
  html = h.controller.render();
  assert.match(html, /Check the written ingredient list for any foods not linked yet/);
  assert.match(html, /Also needed or needing review/);
  assert.match(html, /Rice — 100 g/);
  assert.doesNotMatch(html, /Recorded quantities cover this recipe/);
});

test('recorded allergy matches are shown beside recipes and for the selected person', () => {
  const h = harness(state({ products: [product('rice', { name: 'Milk rice', allergens: 'Contains milk' })], dietProfiles: [{ user_id: 'owner', allergies: 'Dairy' }] }));
  h.click('view-recipe', { id: 'rice-dish' });
  assert.match(h.controller.render(), /Recorded allergy match/);
  assert.match(h.controller.render(), /Person 1 — milk/);
  h.click('log-recipe', { id: 'rice-dish', person: '2' });
  assert.doesNotMatch(h.controller.render(), /Person 1 — milk/);
});

test('written ingredients can surface recorded allergy matches before any catalog links exist', () => {
  const dish = recipe('written', { ingredient_text: 'Milk and an egg\nOptional garnish', ingredients: [] });
  const h = harness(state({ products: [], recipes: [dish], dietProfiles: [{ user_id: 'owner', allergies: 'Milk, eggs' }] }));
  h.click('view-recipe', { id: dish.id });
  assert.match(h.controller.render(), /Recorded allergy match/);
  assert.deepEqual(Food.allergyMatches(dish, [], h.state, 1), [{ person_slot: 1, allergens: ['milk', 'egg'] }]);
  assert.equal(Food.allergyMatches(dish, [], h.state, 2).length, 0);
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
