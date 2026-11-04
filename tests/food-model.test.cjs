'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../bloom-food-model.js');

const completeNutrients = overrides => Object.fromEntries(M.NUTRIENTS.map(({ key }) => [key, Object.hasOwn(overrides || {}, key) ? overrides[key] : 0]));
const product = (id, values = {}) => ({ id, name: id, category: 'food', package_quantity: 1, package_unit: 'each', serving_quantity: 1, serving_unit: 'each', nutrients: completeNutrients({ calories_kcal: 100, protein_g: 10 }), price_cents: 100, ...values });

test('quantity conversion distinguishes weight, volume, and counts and preserves fractional amounts', () => {
  assert.equal(M.convertQuantity(1.5, 'kg', 'g'), 1500);
  assert.equal(M.convertQuantity(2, 'cup', 'fl_oz'), 16);
  assert.equal(M.convertQuantity(1, 'lb', 'oz'), 16);
  assert.equal(M.convertQuantity(500, 'ml', 'l'), 0.5);
  assert.equal(M.convertQuantity(0, 'each', 'each'), 0);
  assert.equal(M.convertQuantity(1, 'g', 'ml'), null);
  assert.equal(M.convertQuantity(1, 'each', 'g'), null);
  assert.equal(M.convertQuantity(1, 'pack', 'each'), null);
  assert.equal(M.convertQuantity(-1, 'kg', 'g'), null);
  assert.equal(M.convertQuantity(Infinity, 'kg', 'g'), null);
  assert.equal(M.convertQuantity('  ', 'kg', 'g'), null);
  assert.equal(M.convertQuantity([], 'each', 'each'), null);
});

test('planning ingredient templates preserve whole-recipe measures and optional choices without parsing prose', () => {
  const recipe = {
    servings: 4, ingredient_text: '3 garlic cloves, optional parsley to taste',
    ingredients: [{ product_id: 'milk', quantity: 99, unit: 'cup' }],
    planning_ingredients: [
      { name: ' Garlic ', quantity: 3, unit: 'cloves', product_id: null, notes: 'Minced' },
      { name: 'Parsley', quantity: null, unit: 'to taste', optional: true, notes: 'Optional garnish' },
      { name: 'Milk', quantity: '2', unit: 'cup', product_id: 'milk', optional: true, included: true }
    ]
  };
  const before = structuredClone(recipe);
  const rows = M.recipePlanningIngredients(recipe, [product('milk', { name: 'Catalog milk' })]);
  assert.equal(rows.length, 3, 'the saved template replaces the optional linked-ingredient fallback');
  assert.equal(rows[0].name, 'Garlic');
  assert.equal(rows[0].quantity, 3);
  assert.equal(rows[0].unit, 'cloves');
  assert.equal(rows[0].product_id, null);
  assert.equal(rows[0].included, true);
  assert.equal(rows[1].quantity, null);
  assert.equal(rows[1].included, false);
  assert.equal(rows[1].notes, 'Optional garnish');
  assert.equal(rows[2].quantity, 2);
  assert.equal(rows[2].included, true, 'an explicitly selected optional ingredient remains selected');
  assert.deepEqual(recipe, before);
  assert.deepEqual(M.recipePlanningIngredients({ ingredient_text: '2 eggs and 1 cup milk' }, []), []);
});

test('planning falls back to linked ingredients and exposes an unverified written list', () => {
  const products = [product('eggs', { name: 'Large eggs' })];
  const recipe = { servings: 2, ingredient_text: '2 eggs plus an unlinked ingredient', planning_ingredients: [], ingredients: [{ product_id: 'eggs', quantity: 2, unit: 'each' }] };
  const rows = M.recipePlanningIngredients(recipe, products);
  assert.deepEqual(rows, [{ name: 'Large eggs', quantity: 2, unit: 'each', product_id: 'eggs', optional: false, notes: '', included: true }]);
  const preview = M.cookingPlanPreview(recipe, rows, 2, products);
  assert.equal(preview.rows[0].required_quantity, 2);
  assert.equal(preview.complete, false, 'some linked rows cannot establish that the whole written list is covered');
  assert.match(preview.issues.join(' '), /written ingredient list/i);
});

test('cooking preview scales whole-recipe quantities by chosen yield without quoting a grocery shortage', () => {
  const products = [product('milk', { package_quantity: 64, package_unit: 'fl_oz' }), product('rice', { package_quantity: 1, package_unit: 'kg' })];
  const recipe = { servings: 4, planning_ingredients: [
    { name: 'Milk', product_id: 'milk', quantity: 4, unit: 'cup' },
    { name: 'Rice', product_id: 'rice', quantity: 0.8, unit: 'kg' }
  ] };
  const before = structuredClone({ recipe, products });
  const rows = M.recipePlanningIngredients(recipe, products);
  const preview = M.cookingPlanPreview(recipe, rows, 2, products);
  assert.equal(preview.scale, 0.5);
  assert.equal(preview.recipe_servings, 4);
  assert.equal(preview.servings, 2);
  assert.equal(preview.rows[0].quantity, 4, 'the original recipe quantity is retained for editing');
  assert.equal(preview.rows[0].required_quantity, 2);
  assert.equal(preview.rows[0].required_package_quantity, 16, 'two cups are sixteen fluid ounces, not sixteen packages');
  assert.equal(preview.rows[0].package_quantity, 64);
  assert.equal(preview.rows[1].required_quantity, 0.4);
  assert.equal(preview.complete, true);
  assert.deepEqual(preview.issues, []);
  assert.equal(Object.hasOwn(preview.rows[0], 'packs'), false, 'stock subtraction and combined package rounding belong to the server');
  assert.deepEqual({ recipe, products }, before);
});

test('cooking preview keeps custom measures and unresolved quantities explicit', () => {
  const products = [product('garlic', { package_quantity: 1, package_unit: 'each' }), product('flour', { package_quantity: 500, package_unit: 'g' })];
  const recipe = { servings: 4, planning_ingredients: [
    { name: 'Garlic', product_id: 'garlic', quantity: 6, unit: 'cloves' },
    { name: 'Flour', product_id: 'flour', quantity: 2, unit: 'cup' },
    { name: 'Salt', quantity: null, unit: 'to taste', product_id: null },
    { name: 'Celery', quantity: 2, unit: 'stalks', product_id: null }
  ] };
  const preview = M.cookingPlanPreview(recipe, null, 2, products);
  assert.equal(preview.rows[0].unit, 'cloves');
  assert.equal(preview.rows[0].required_quantity, 3);
  assert.equal(preview.rows[0].required_package_quantity, null, 'cloves do not become whole bulbs or each');
  assert.equal(preview.rows[1].required_quantity, 1);
  assert.equal(preview.rows[1].required_package_quantity, null, 'volume is not converted to mass without a supplied conversion');
  assert.equal(preview.rows[2].required_quantity, null, 'to taste is never assigned an invented number');
  assert.equal(preview.rows[3].required_quantity, 1);
  assert.equal(preview.rows[3].unit, 'stalks');
  assert.equal(preview.complete, false);
  assert.match(preview.rows[0].issues.join(' '), /cannot be converted/);
  assert.match(preview.rows[2].issues.join(' '), /unknown/);
  assert.match(preview.rows[3].issues.join(' '), /Matching named stock can be checked/);
});

test('unselected optional ingredients do not add quantities or review failures until included', () => {
  const recipe = { servings: 2, planning_ingredients: [
    { name: 'Eggs', product_id: 'eggs', quantity: 2, unit: 'each' },
    { name: 'Optional herbs', quantity: null, unit: 'to taste', optional: true }
  ] };
  const products = [product('eggs')], rows = M.recipePlanningIngredients(recipe, products);
  const without = M.cookingPlanPreview(recipe, rows, 4, products);
  assert.equal(without.rows[0].required_quantity, 4);
  assert.equal(without.rows[1].required_quantity, 0);
  assert.deepEqual(without.rows[1].issues, []);
  assert.equal(without.complete, true);
  const withHerbs = M.cookingPlanPreview(recipe, rows.map(row => ({ ...row, included: true })), 4, products);
  assert.equal(withHerbs.rows[1].required_quantity, null);
  assert.equal(withHerbs.complete, false);
  assert.equal(rows[1].included, false, 'preview never mutates the retained selection');
});

test('cooking preview cannot claim resolved quantities with missing yield, unusable links or invalid amounts', () => {
  const rows = [
    { name: 'Missing item', product_id: 'missing', quantity: 2, unit: 'each' },
    { name: 'Archived food', product_id: 'archived', quantity: 1, unit: 'each' },
    { name: 'Soap', product_id: 'soap', quantity: 1, unit: 'each' },
    { name: 'Unknown amount', product_id: 'eggs', quantity: '', unit: 'each' }
  ];
  const products = [product('archived', { archived: true }), product('soap', { category: 'household' }), product('eggs')];
  const preview = M.cookingPlanPreview({ servings: null }, rows, 2, products);
  assert.equal(preview.scale, null);
  assert.ok(preview.rows.every(row => row.required_quantity === null));
  assert.equal(preview.complete, false);
  assert.match(preview.issues.join(' '), /saved recipe makes/);
  for (const row of preview.rows.slice(0, 3)) assert.match(row.issues.join(' '), /link an available Food product/);
  for (const value of [0, -1, Infinity, '', null]) {
    const invalid = M.cookingPlanPreview({ servings: 2 }, [{ name: 'Eggs', product_id: 'eggs', quantity: 2, unit: 'each' }], value, products);
    assert.equal(invalid.rows[0].required_quantity, null);
    assert.equal(invalid.complete, false);
  }
  assert.equal(M.cookingPlanPreview({ servings: 1e-308 }, [{ name: 'Eggs', product_id: 'eggs', quantity: 2, unit: 'each' }], 1e308, products).complete, false);
  assert.equal(M.cookingPlanPreview({ servings: 2 }, [], 2, products).complete, false);
});

test('unknown label nutrients remain missing and a known zero is retained', () => {
  const p = product('drink', { nutrients: { calories_kcal: 0, protein_g: null, fluid_ml: 250 } });
  const result = M.productNutrition(p, 2);
  assert.equal(result.values.calories_kcal, 0);
  assert.equal(result.missing.calories_kcal, 0);
  assert.equal(result.values.protein_g, null);
  assert.equal(result.missing.protein_g, 1);
  assert.equal(result.values.fluid_ml, 500);
  assert.equal(result.complete, false);
  assert.equal(M.productNutrition({ ...p, serving_quantity: null }, 2).values.fluid_ml, null);
});

test('recipe nutrition accounts for full-recipe yield, different portions and compatible ingredient units', () => {
  const products = [product('oats', { serving_quantity: 50, serving_unit: 'g', nutrients: completeNutrients({ calories_kcal: 200, protein_g: 8 }) }), product('milk', { serving_quantity: 1, serving_unit: 'cup', nutrients: completeNutrients({ calories_kcal: 100, protein_g: 7 }) })];
  const recipe = { servings: 4, ingredients: [{ product_id: 'oats', quantity: 0.2, unit: 'kg' }, { product_id: 'milk', quantity: 16, unit: 'fl_oz' }] };
  const first = M.recipeNutrition(recipe, products, 1);
  const second = M.recipeNutrition(recipe, products, 1.5);
  assert.equal(first.values.calories_kcal, 250);
  assert.equal(first.values.protein_g, 11.5);
  assert.equal(second.values.calories_kcal, 375);
  assert.equal(second.values.protein_g, 17.25);
  assert.equal(first.complete, true);
  assert.equal(recipe.ingredients[0].quantity, 0.2);
});

test('partial recipe totals show known subtotals while unidentified ingredients remain explicit', () => {
  const result = M.recipeNutrition({ servings: 2, ingredients: [{ product_id: 'known', quantity: 2, unit: 'each' }, { product_id: 'missing', quantity: 20, unit: 'g' }] }, [product('known')], 1);
  assert.equal(result.values.calories_kcal, 100);
  assert.equal(result.missing.calories_kcal, 1);
  assert.equal(result.complete, false);
  const volumeToWeight = M.recipeNutrition({ servings: 1, ingredients: [{ product_id: 'flour', quantity: 1, unit: 'cup' }] }, [product('flour', { serving_unit: 'g', serving_quantity: 100 })], 1);
  assert.equal(volumeToWeight.values.calories_kcal, null);
  assert.equal(volumeToWeight.missing.calories_kcal, 1);
});

test('reference nutrition scales whole-recipe values by yield and portion without mixing catalog labels', () => {
  const recipe = {
    servings: 5, nutrition_mode: 'reference', ingredient_text: 'A written ingredient list',
    nutrition_reference: { protein_g: 100, carbs_g: 250, fat_g: 50, fiber_g: 0, calories_kcal: null },
    nutrition_source: '  Example cookbook estimate  ',
    ingredients: [{ product_id: 'linked', quantity: 5, unit: 'each' }]
  };
  const before = JSON.stringify(recipe), products = [product('linked')];
  const portion = M.recipeNutrition(recipe, products, 1.5);
  assert.equal(portion.values.protein_g, 30);
  assert.equal(portion.values.carbs_g, 75);
  assert.equal(portion.values.fat_g, 15);
  assert.equal(portion.values.fiber_g, 0);
  assert.equal(portion.missing.fiber_g, 0);
  assert.equal(portion.values.calories_kcal, null, 'linked label calories must not fill a missing recipe estimate');
  assert.equal(portion.missing.calories_kcal, 1);
  assert.equal(portion.complete, false);
  assert.equal(portion.estimated, true);
  assert.equal(portion.basis, 'recipe_reference');
  assert.equal(portion.source, 'Example cookbook estimate');
  assert.equal(M.recipeNutrition({ ...recipe, ingredients: [] }, [], 1).values.protein_g, 20, 'references do not require catalog links');
  assert.equal(M.recipeNutrition({ ...recipe, servings: 10 }, products, 1).values.protein_g, 10, 'changing the yield repartitions the same whole-recipe amount');
  assert.equal(JSON.stringify(recipe), before);
});

test('reference nutrition keeps malformed or unavailable values unknown and explicit zero known', () => {
  const result = M.recipeNutrition({
    servings: 2, nutrition_mode: 'reference', nutrition_source: 'Example source',
    nutrition_reference: { calories_kcal: Infinity, protein_g: NaN, carbs_g: -3, fat_g: '8', fiber_g: 0, sodium_mg: null, unsupported: 99 },
    ingredients: [{ product_id: 'linked', quantity: 2, unit: 'each' }]
  }, [product('linked')], 1);
  for (const key of ['calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodium_mg']) {
    assert.equal(result.values[key], null);
    assert.equal(result.missing[key], 1);
  }
  assert.equal(result.values.fiber_g, 0);
  assert.equal(Object.hasOwn(result.values, 'unsupported'), false);
  assert.equal(result.complete, false);
  assert.equal(M.recipeNutrition({ servings: 2, nutrition_mode: 'reference', nutrition_reference: {} }, [], 0).values.protein_g, null);
});

test('ingredient mode ignores stored references and written lists keep uncertain link coverage incomplete', () => {
  const recipe = { servings: 2, nutrition_mode: 'ingredients', nutrition_reference: { calories_kcal: 9000 }, ingredients: [{ product_id: 'linked', quantity: 2, unit: 'each' }] };
  const labels = M.recipeNutrition(recipe, [product('linked')], 1);
  assert.equal(labels.values.calories_kcal, 100);
  assert.equal(labels.complete, true);
  assert.notEqual(labels.estimated, true);
  const partial = M.recipeNutrition({ ...recipe, ingredient_text: 'A linked food and another unlinked ingredient' }, [product('linked')], 1);
  assert.equal(partial.values.calories_kcal, 100);
  assert.equal(partial.missing.calories_kcal, 1);
  assert.equal(partial.complete, false);
  const unlinked = M.recipeNutrition({ servings: 2, ingredient_text: 'Ingredients without catalog links', ingredients: [] }, [], 1);
  assert.equal(unlinked.values.calories_kcal, null);
  assert.equal(unlinked.complete, false);
  assert.equal(M.recipeNutrition({ ...recipe, nutrition_mode: 'unsupported' }, [product('linked')], 1).values.calories_kcal, null);
});

test('nutrition totals retain estimate provenance across mixed and combined snapshots', () => {
  const reference = source => M.recipeNutrition({ servings: 2, nutrition_mode: 'reference', nutrition_reference: { protein_g: 20 }, nutrition_source: source, ingredients: [] }, [], 1);
  const first = reference('Example source A'), second = reference('Example source B');
  const label = M.productNutrition(product('known'), 1);
  const before = JSON.stringify([first, second, label]);
  const partial = M.nutritionTotals([{ nutrition_snapshot: first }, { nutrition_snapshot: label }, { nutrition_snapshot: first }]);
  assert.equal(partial.values.protein_g, 30);
  assert.equal(partial.values.calories_kcal, 100);
  assert.equal(partial.missing.calories_kcal, 2);
  assert.equal(partial.estimated, true);
  assert.equal(partial.basis, 'nutrition_total');
  assert.equal(partial.source, 'Example source A');
  assert.deepEqual(partial.sources, ['Example source A']);
  const combined = M.nutritionTotals([partial, second]);
  assert.equal(combined.values.protein_g, 40);
  assert.equal(combined.missing.calories_kcal, 3);
  assert.deepEqual(combined.sources, ['Example source A', 'Example source B']);
  assert.equal(combined.estimated, true);
  assert.equal(combined.complete, false);
  assert.equal(JSON.stringify([first, second, label]), before);
});

test('daily totals use saved snapshots and preserve missing contributions without inventing an empty-day zero', () => {
  const first = M.productNutrition(product('first'), 1);
  const partial = M.productNutrition(product('second', { nutrients: { calories_kcal: null, protein_g: 5 } }), 2);
  const total = M.nutritionTotals([{ nutrition_snapshot: first }, { nutrition_snapshot: partial }]);
  assert.equal(total.values.calories_kcal, 100);
  assert.equal(total.missing.calories_kcal, 1);
  assert.equal(total.values.protein_g, 20);
  assert.equal(total.missing.protein_g, 0);
  assert.equal(total.complete, false);
  assert.equal(M.nutritionTotals([]).values.calories_kcal, null);
  assert.equal(M.nutritionTotals([]).complete, false);
});

test('food reminders use each recorded date and threshold and do not reset dates when freezing', () => {
  const inventory = [
    { id: 'soon', name: 'Soon', quantity: 1, location: 'refrigerator', expires_on: '2026-11-06', date_type: 'use_by', reminder_days: 3 },
    { id: 'late', name: 'Past date', quantity: 1, location: 'freezer', expires_on: '2026-11-03', frozen_on: '2026-11-02' },
    { id: 'frozen', name: 'Frozen', quantity: 1, location: 'freezer', expires_on: '2026-11-03', freezer_use_by: '2026-12-01', frozen_on: '2026-11-02' },
    { id: 'zero', name: 'Empty', quantity: 0, expires_on: '2026-11-01' },
    { id: 'narrow', name: 'Narrow', quantity: 1, expires_on: '2026-11-06', reminder_days: 1 },
    { id: 'bad', name: 'Invalid', quantity: 1, expires_on: '2026-02-30' }
  ];
  const result = M.dueItems(inventory, '2026-11-04');
  assert.deepEqual(result.map(item => item.id), ['late', 'soon']);
  assert.equal(result[0].status, 'overdue');
  assert.equal(result[1].days_until, 2);
  assert.equal(result[1].date_label, 'Use by');
  assert.equal(M.dueItems(inventory, 'not-a-date').length, 0);
  assert.equal(inventory[1].expires_on, '2026-11-03');
});

test('recipe suggestions match due ingredients and allocate each stock batch once within a recipe', () => {
  const recipes = [
    { id: 'use-eggs', name: 'Egg recipe', servings: 2, ingredients: [{ product_id: 'eggs', quantity: 2, unit: 'each' }, { product_id: 'eggs', quantity: 2, unit: 'each' }] },
    { id: 'old-only', name: 'Past-date ingredient', ingredients: [{ product_id: 'old', quantity: 1, unit: 'each' }] },
    { id: 'archived', name: 'Archived', archived: true, ingredients: [{ product_id: 'eggs', quantity: 1, unit: 'each' }] }
  ];
  const inventory = [
    { id: 'one-batch', product_id: 'eggs', name: 'Eggs', quantity: 3, unit: 'each', expires_on: '2026-11-05' },
    { id: 'old-batch', product_id: 'old', name: 'Old stock', quantity: 9, unit: 'each', expires_on: '2026-11-03' }
  ];
  const result = M.recipeSuggestions(recipes, [product('eggs', { allergens: 'Eggs' }), product('old')], inventory, '2026-11-04');
  assert.equal(result.length, 1);
  assert.equal(result[0].recipe_id, 'use-eggs');
  assert.equal(result[0].missing_ingredients[0].quantity, 1);
  assert.equal(result[0].complete_stock, false);
  assert.deepEqual(result[0].known_allergens, ['Eggs']);
  assert.equal(inventory[0].quantity, 3);
});

test('written recipe lists keep stock coverage unverified even when linked foods are covered', () => {
  const linked = { product_id: 'rice', quantity: 2, unit: 'each' };
  const written = '2 portions of rice\n1 portion of vegetables';
  const recipes = [
    { id: 'linked-only', name: 'Linked dish', ingredients: [linked] },
    { id: 'partial-links', name: 'Written dish', ingredient_text: written, ingredients: [linked] },
    { id: 'short-linked-food', name: 'Larger written dish', ingredient_text: written, ingredients: [{ ...linked, quantity: 4 }] },
    { id: 'no-links', name: 'Unlinked written dish', ingredient_text: written, ingredients: [] }
  ];
  const inventory = [{ id: 'rice-batch', product_id: 'rice', name: 'Rice', quantity: 3, unit: 'each', expires_on: '2026-11-05' }];
  const results = new Map(M.recipeSuggestions(recipes, [product('rice')], inventory, '2026-11-04').map(value => [value.recipe_id, value]));
  assert.equal(results.size, 3, 'written text alone cannot establish a product match');
  assert.equal(results.get('linked-only').written_ingredients_unverified, false);
  assert.equal(results.get('linked-only').complete_stock, true);
  assert.equal(results.get('partial-links').written_ingredients_unverified, true);
  assert.equal(results.get('partial-links').complete_stock, false);
  assert.deepEqual(results.get('partial-links').missing_ingredients, []);
  assert.equal(results.get('short-linked-food').written_ingredients_unverified, true);
  assert.equal(results.get('short-linked-food').complete_stock, false);
  assert.equal(results.get('short-linked-food').missing_ingredients[0].quantity, 1);
  assert.equal(inventory[0].quantity, 3);
});

test('recurring quantities combine both people before stock allocation and package rounding', () => {
  const patterns = [{ id: 'one', product_id: 'drink', person_slot: 1, quantity: 2, every_days: 1, basis: 'units', active: true }, { id: 'two', product_id: 'drink', person_slot: 2, quantity: 1, every_days: 1, basis: 'units', active: true }];
  const stock = { id: 'stock', product_id: 'drink', name: 'Drink', quantity: 12, unit: 'each' };
  const result = M.recurringPlan(patterns, [product('drink', { package_quantity: 12, price_cents: 2000 })], [stock, stock], '2026-11');
  assert.equal(result.days, 30);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].required_quantity, 90);
  assert.equal(result.items[0].stock_quantity, 12);
  assert.equal(result.items[0].shortage_quantity, 78);
  assert.equal(result.items[0].packs, 7);
  assert.equal(result.known_total_cents, 14000);
  assert.deepEqual(result.items[0].person_slots, [1, 2]);
});

test('monthly recurrence uses leap days, flexible package frequencies, and explicit missing prices', () => {
  const patterns = [{ id: 'r', product_id: 'coffee', quantity: 1, basis: 'packs', every_days: 14, active: true }];
  const products = [product('coffee', { package_quantity: 500, package_unit: 'g', price_cents: null })];
  assert.equal(M.recurringPlan(patterns, products, [], '2028-02').days, 29);
  assert.equal(M.recurringPlan(patterns, products, [], '2028-02').items[0].packs, 3);
  assert.equal(M.recurringPlan(patterns, products, [], '2027-02').items[0].packs, 2);
  const missing = M.recurringPlan(patterns, products, [], '2028-02');
  assert.equal(missing.known_total_cents, 0);
  assert.equal(missing.missing_prices, 1);
  assert.equal(missing.items[0].estimate_cents, null);
  assert.equal(missing.complete, false);
  assert.throws(() => M.recurringPlan(patterns, products, [], '2026-13'));
});

test('recurring plans do not allocate food past its recorded date or more than use before a nearer date', () => {
  const pattern = [{ id: 'r', product_id: 'milk', quantity: 1, every_days: 1, basis: 'units' }];
  const products = [product('milk', { package_quantity: 1, package_unit: 'l' })];
  const stock = [{ id: 'old', product_id: 'milk', quantity: 20, unit: 'l', expires_on: '2026-10-31' }, { id: 'near', product_id: 'milk', name: 'Milk', quantity: 10, unit: 'l', expires_on: '2026-11-02' }];
  const plan = M.recurringPlan(pattern, products, stock, '2026-11');
  assert.equal(plan.items[0].stock_quantity, 2);
  assert.equal(plan.items[0].packs, 28);
  assert.match(plan.items[0].notes.join(' '), /before 2026-11-02/);
});

test('monthly money uses posted ledger expenses once and keeps plans, voids, and months separate', () => {
  const receiptEntry = { id: 'ledger-one', receipt_id: 'receipt-one', occurred_on: '2026-11-04', direction: 'expense', category: 'food', amount_cents: 1200 };
  const result = M.monthlyMoney({
    budgets: [{ month: '2026-11-01', amount_cents: 5000, household_amount_cents: 2000 }],
    receipts: [{ id: 'receipt-one', total_cents: 1200 }, { id: 'void', total_cents: 9999, voided_at: '2026-11-04' }],
    moneyEntries: [receiptEntry, receiptEntry, { ...receiptEntry, id: 'duplicate-category' }, { id: 'void-ledger', receipt_id: 'void', occurred_on: '2026-11-04', direction: 'expense', category: 'food', amount_cents: 9999 }, { id: 'income', occurred_on: '2026-11-01', direction: 'income', category: 'other', amount_cents: 10000 }, { id: 'old', occurred_on: '2026-10-31', direction: 'expense', category: 'food', amount_cents: 1000 }],
    shoppingItems: [{ id: 'planned', month: '2026-11-01', category: 'food', estimate_cents: 800, checked: false }, { id: 'bought', month: '2026-11-01', category: 'food', estimate_cents: 1200, checked: true }]
  }, '2026-11');
  assert.equal(result.food.spent_cents, 1200);
  assert.equal(result.food.planned_cents, 800);
  assert.equal(result.food.available_cents, 3000);
  assert.equal(result.total_expense_cents, 1200);
  assert.equal(result.net_cents, 8800);
  assert.equal(result.household.spent_cents, 0);
});

test('unknown budgets and item prices stay incomplete while negative availability remains visible', () => {
  const unknown = M.monthlyMoney({ shoppingItems: [{ id: 'item', month: '2026-11-01', estimate_cents: null }] }, '2026-11');
  assert.equal(unknown.food.budget_cents, null);
  assert.equal(unknown.food.available_cents, null);
  assert.equal(unknown.food.missing_prices, 1);
  const overspent = M.monthlyMoney({ budgets: [{ month: '2026-11-01', amount_cents: 0, household_amount_cents: null }], moneyEntries: [{ id: 'expense', occurred_on: '2026-11-04', direction: 'expense', category: 'food', amount_cents: 500 }] }, '2026-11');
  assert.equal(overspent.food.budget_cents, 0);
  assert.equal(overspent.food.available_cents, -500);
  assert.equal(overspent.household.budget_cents, null);
});

test('a fulfilled receipt removes stale unchecked estimates while partial purchases keep the remainder planned', () => {
  const snapshot = {
    budgets: [{ month: '2026-11-01', amount_cents: 5000 }],
    shoppingItems: [
      { id: 'already-bought', month: '2026-11-01', checked: false, category: 'food', estimate_cents: 400 },
      { id: 'remaining', month: '2026-11-01', checked: false, category: 'food', estimate_cents: 250 }
    ],
    receipts: [{ id: 'purchase', purchased_on: '2026-11-04', shopping_effects: [
      { id: 'already-bought', after: { checked: true } },
      { id: 'remaining', after: { checked: false } }
    ] }],
    moneyEntries: [{ id: 'cost', receipt_id: 'purchase', occurred_on: '2026-11-04', direction: 'expense', category: 'food', amount_cents: 600 }]
  };
  const current = M.monthlyMoney(snapshot, '2026-11');
  assert.equal(current.food.spent_cents, 600);
  assert.equal(current.food.planned_cents, 250);
  assert.equal(current.food.available_cents, 4150);
  snapshot.receipts[0].voided_at = '2026-11-04T14:00:00Z';
  const reversed = M.monthlyMoney(snapshot, '2026-11');
  assert.equal(reversed.food.spent_cents, 0);
  assert.equal(reversed.food.planned_cents, 650);
});

test('bill plans remain separate from actual payments and preserve unknown variable bills', () => {
  const result = M.monthlyMoney({ bills: [{ id: 'paid', month: '2026-11-01', amount_cents: 1000 }, { id: 'unpaid', month: '2026-11-01', amount_cents: 500 }, { id: 'variable', month: '2026-11-01', amount_cents: null }], moneyEntries: [{ id: 'payment', bill_id: 'paid', occurred_on: '2026-11-02', direction: 'expense', category: 'bill', amount_cents: 1000 }] }, '2026-11');
  assert.equal(result.bills_planned_cents, 1500);
  assert.equal(result.bills_pending_cents, 500);
  assert.equal(result.bills_missing_amounts, 1);
  assert.equal(result.total_expense_cents, 1000);
  assert.deepEqual(result.paid_bill_ids, ['paid']);
});

test('monthly bill summaries separate fixed and variable plans from actual payments and unknown amounts', () => {
  const fixed = { id: 'fixed', month: '2026-11-01', amount_cents: 4000, variable: false };
  const payment = { id: 'paid-once', bill_id: 'fixed', occurred_on: '2026-11-02', direction: 'expense', category: 'bill', amount_cents: 3900 };
  const result = M.monthlyMoney({
    bills: [fixed, fixed, { id: 'fixed-unknown', month: '2026-11-01', amount_cents: null, variable: false }, { id: 'variable-known', month: '2026-11-01', amount_cents: 1500, variable: true }, { id: 'variable-unknown', month: '2026-11-01', amount_cents: null, variable: true }],
    moneyEntries: [payment, payment, { id: 'food', occurred_on: '2026-11-04', direction: 'expense', category: 'food', amount_cents: 700 }, { id: 'reversed', bill_id: 'variable-known', occurred_on: '2026-11-03', direction: 'expense', category: 'bill', amount_cents: 1400, voided_at: '2026-11-04' }]
  }, '2026-11');
  assert.equal(result.bills_fixed_planned_cents, 4000);
  assert.equal(result.bills_variable_planned_cents, 1500);
  assert.equal(result.bills_planned_cents, 5500);
  assert.equal(result.bills_fixed_missing_amounts, 1);
  assert.equal(result.bills_variable_missing_amounts, 1);
  assert.equal(result.bills_missing_amounts, 2);
  assert.equal(result.bills_pending_cents, 1500);
  assert.equal(result.bills_unpaid_missing_amounts, 2);
  assert.equal(result.bills_paid_cents, 3900);
  assert.equal(result.bills_paid_count, 1);
  assert.equal(result.bills_unpaid_count, 3);
  assert.equal(result.bill_expense_cents, 3900);
  assert.equal(result.total_expense_cents, 4600);
  assert.equal(result.food.spent_cents, 700);
});

test('a late bill payment clears its billing month while spending stays in its actual payment month', () => {
  const bills = [{ id: 'late-bill', month: '2026-11-01', amount_cents: 1200, variable: false }];
  const payment = { id: 'later-payment', bill_id: 'late-bill', occurred_on: '2026-12-02', direction: 'expense', category: 'bill', amount_cents: 1350 };
  const november = M.monthlyMoney({ bills, moneyEntries: [payment] }, '2026-11');
  const december = M.monthlyMoney({ bills, moneyEntries: [payment] }, '2026-12');
  assert.deepEqual(november.paid_bill_ids, ['late-bill']);
  assert.equal(november.bills_pending_cents, 0);
  assert.equal(november.bills_unpaid_count, 0);
  assert.equal(november.bills_paid_cents, 1350);
  assert.equal(november.bill_expense_cents, 0);
  assert.equal(november.total_expense_cents, 0);
  assert.equal(december.bill_expense_cents, 1350);
  assert.equal(december.total_expense_cents, 1350);
  assert.equal(december.bills_paid_cents, 0, 'there is no December bill row to mark paid');
  assert.equal(M.monthlyMoney({ bills, moneyEntries: [{ ...payment, voided_at: '2026-12-03' }] }, '2026-11').bills_pending_cents, 1200);
});

test('cancelled future bills stop counting as obligations without erasing history or actual payments', () => {
  const snapshot = {
    bills: [
      { id: 'historical-fixed', series_id: 'stopped-series', month: '2026-11-01', amount_cents: 900, variable: false },
      { id: 'active-fixed', month: '2026-12-01', amount_cents: 1200, variable: false },
      { id: 'active-variable', month: '2026-12-01', amount_cents: 300, variable: true },
      { id: 'unknown-variable', month: '2026-12-01', amount_cents: null, variable: true },
      { id: 'cancelled-fixed', series_id: 'stopped-series', month: '2026-12-01', amount_cents: 900, variable: false, cancelled: true },
      { id: 'cancelled-variable', month: '2026-12-01', amount_cents: 800, variable: true, cancelled: true },
      { id: 'cancelled-unknown-fixed', month: '2026-12-01', amount_cents: null, variable: false, cancelled: true },
      { id: 'cancelled-unknown-variable', month: '2026-12-01', amount_cents: null, variable: true, cancelled: true },
      { id: 'cancelled-with-payment', month: '2026-12-01', amount_cents: 400, variable: false, cancelled: true },
      { id: 'cancelled-only-month', month: '2027-01-01', amount_cents: null, variable: true, cancelled: true }
    ],
    moneyEntries: [{ id: 'actual-payment', bill_id: 'cancelled-with-payment', occurred_on: '2026-12-03', direction: 'expense', category: 'bill', amount_cents: 450 }]
  };
  const original = structuredClone(snapshot);
  const december = M.monthlyMoney(snapshot, '2026-12');
  assert.equal(december.bills_fixed_planned_cents, 1200);
  assert.equal(december.bills_variable_planned_cents, 300);
  assert.equal(december.bills_planned_cents, 1500);
  assert.equal(december.bills_pending_cents, 1500);
  assert.equal(december.bills_fixed_missing_amounts, 0);
  assert.equal(december.bills_variable_missing_amounts, 1);
  assert.equal(december.bills_missing_amounts, 1);
  assert.equal(december.bills_unpaid_count, 3);
  assert.equal(december.bills_unpaid_missing_amounts, 1);
  assert.equal(december.bills_paid_count, 1);
  assert.equal(december.bills_paid_cents, 450);
  assert.deepEqual(december.paid_bill_ids, ['cancelled-with-payment']);
  assert.equal(december.bill_expense_cents, 450);
  assert.equal(december.total_expense_cents, 450);
  const history = M.monthlyBillHistory(snapshot);
  assert.deepEqual(history.map(row => row.month), ['2027-01', '2026-12', '2026-11']);
  assert.equal(history[0].bills_planned_cents, 0);
  assert.equal(history[0].bills_pending_cents, 0);
  assert.equal(history[0].bills_unpaid_count, 0);
  assert.equal(history[0].bills_missing_amounts, 0);
  assert.equal(history[2].bills_fixed_planned_cents, 900, 'stopping a future occurrence does not change an earlier month');
  assert.deepEqual(snapshot, original);
});

test('bill history uses saved monthly amounts and includes payment-only and reversed months', () => {
  const snapshot = {
    bills: [
      { id: 'old-fixed', month: '2026-10-01', amount_cents: 1000, variable: false },
      { id: 'nov-variable', month: '2026-11-01', amount_cents: null, variable: true },
      { id: 'new-fixed', month: '2026-12-01', amount_cents: 2000, variable: false },
      { id: 'invalid-month', month: '2026-13-01', amount_cents: 9999, variable: false }
    ],
    moneyEntries: [
      { id: 'late-payment', bill_id: 'old-fixed', occurred_on: '2026-11-05', direction: 'expense', category: 'bill', amount_cents: 900 },
      { id: 'reversed-payment', occurred_on: '2027-01-02', direction: 'expense', category: 'bill', amount_cents: 500, voided_at: '2027-01-03' },
      { id: 'food-only', occurred_on: '2026-09-01', direction: 'expense', category: 'food', amount_cents: 700 }
    ]
  };
  const original = structuredClone(snapshot);
  const history = M.monthlyBillHistory(snapshot);
  assert.deepEqual(history.map(row => row.month), ['2027-01', '2026-12', '2026-11', '2026-10']);
  const byMonth = Object.fromEntries(history.map(row => [row.month, row]));
  assert.equal(byMonth['2026-10'].bills_fixed_planned_cents, 1000);
  assert.equal(byMonth['2026-10'].bill_expense_cents, 0);
  assert.equal(byMonth['2026-11'].bill_expense_cents, 900);
  assert.equal(byMonth['2026-11'].bills_variable_missing_amounts, 1);
  assert.equal(byMonth['2026-12'].bills_fixed_planned_cents, 2000);
  assert.equal(byMonth['2027-01'].bill_expense_cents, 0);
  assert.deepEqual(snapshot, original);
  assert.deepEqual(M.monthlyBillHistory({}), []);
});
