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

test('bill plans remain separate from actual payments and preserve unknown variable bills', () => {
  const result = M.monthlyMoney({ bills: [{ id: 'paid', month: '2026-11-01', amount_cents: 1000 }, { id: 'unpaid', month: '2026-11-01', amount_cents: 500 }, { id: 'variable', month: '2026-11-01', amount_cents: null }], moneyEntries: [{ id: 'payment', bill_id: 'paid', occurred_on: '2026-11-02', direction: 'expense', category: 'bill', amount_cents: 1000 }] }, '2026-11');
  assert.equal(result.bills_planned_cents, 1500);
  assert.equal(result.bills_pending_cents, 500);
  assert.equal(result.bills_missing_amounts, 1);
  assert.equal(result.total_expense_cents, 1000);
  assert.deepEqual(result.paid_bill_ids, ['paid']);
});
