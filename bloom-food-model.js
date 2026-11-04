/* Shared food, portion, stock and monthly money calculations. No personal records. */
(function (root) {
  'use strict';

  const NUTRIENTS = [
    { key: 'calories_kcal', label: 'Calories', unit: 'kcal' },
    { key: 'protein_g', label: 'Protein', unit: 'g' },
    { key: 'carbs_g', label: 'Carbohydrates', unit: 'g' },
    { key: 'fat_g', label: 'Fat', unit: 'g' },
    { key: 'fiber_g', label: 'Fiber', unit: 'g' },
    { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
    { key: 'calcium_mg', label: 'Calcium', unit: 'mg' },
    { key: 'iron_mg', label: 'Iron', unit: 'mg' },
    { key: 'potassium_mg', label: 'Potassium', unit: 'mg' },
    { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg' },
    { key: 'fluid_ml', label: 'Beverage volume', unit: 'mL' }
  ];
  const UNITS = [
    { value: 'each', label: 'each', family: 'count', factor: 1 },
    { value: 'g', label: 'grams (g)', family: 'mass', factor: 1 },
    { value: 'kg', label: 'kilograms (kg)', family: 'mass', factor: 1000 },
    { value: 'oz', label: 'ounces by weight (oz)', family: 'mass', factor: 28.349523125 },
    { value: 'lb', label: 'pounds (lb)', family: 'mass', factor: 453.59237 },
    { value: 'ml', label: 'milliliters (mL)', family: 'volume', factor: 1 },
    { value: 'l', label: 'liters (L)', family: 'volume', factor: 1000 },
    { value: 'fl_oz', label: 'US fluid ounces (fl oz)', family: 'volume', factor: 29.5735295625 },
    { value: 'cup', label: 'US cups', family: 'volume', factor: 236.5882365 },
    { value: 'tbsp', label: 'US tablespoons', family: 'volume', factor: 14.78676478125 },
    { value: 'tsp', label: 'US teaspoons', family: 'volume', factor: 4.92892159375 }
  ];
  const AISLES = [
    { value: 'produce', label: 'Produce', icon: '🍇' },
    { value: 'meat', label: 'Meat', icon: '🥩' },
    { value: 'seafood', label: 'Seafood', icon: '🐟' },
    { value: 'deli', label: 'Deli & prepared food', icon: '🥪' },
    { value: 'dairy-eggs', label: 'Dairy & eggs', icon: '🥚' },
    { value: 'beverages', label: 'Beverages', icon: '🥤' },
    { value: 'bakery', label: 'Bread & bakery', icon: '🍞' },
    { value: 'frozen', label: 'Frozen', icon: '❄️' },
    { value: 'grains', label: 'Rice, pasta & beans', icon: '🍚' },
    { value: 'baking', label: 'Baking & cooking', icon: '🧁' },
    { value: 'condiments', label: 'Condiments & sauces', icon: '🍅' },
    { value: 'canned', label: 'Soups & canned goods', icon: '🥫' },
    { value: 'breakfast', label: 'Breakfast', icon: '🥣' },
    { value: 'snacks', label: 'Snacks', icon: '🍪' },
    { value: 'household', label: 'Household supplies', icon: '🧽' },
    { value: 'other', label: 'Other', icon: '🛒' }
  ];
  const DATE_LABELS = { best_before: 'Best before', use_by: 'Use by', sell_by: 'Sell by', expiry: 'Expiration date', unknown: 'Recorded package date' };
  const UNIT_ALIASES = { grams: 'g', gram: 'g', kilograms: 'kg', kilogram: 'kg', ounces: 'oz', ounce: 'oz', pounds: 'lb', pound: 'lb', lbs: 'lb', milliliters: 'ml', milliliter: 'ml', liters: 'l', liter: 'l', 'fl oz': 'fl_oz', 'fl. oz.': 'fl_oz', cups: 'cup', tablespoons: 'tbsp', tablespoon: 'tbsp', teaspoons: 'tsp', teaspoon: 'tsp', count: 'each', pieces: 'each', piece: 'each' };
  const KEYS = NUTRIENTS.map(value => value.key);
  const DAY = 86400000;

  function number(value) {
    if (value == null || !['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  function positive(value) { const parsed = number(value); return parsed != null && parsed > 0 ? parsed : null; }
  function cents(value) { const parsed = number(value); return Number.isSafeInteger(parsed) ? parsed : null; }
  function tidy(value) { return Number.isFinite(value) ? Number(value.toPrecision(13)) : null; }
  function normalizeUnit(value) {
    const unit = String(value || '').trim().toLowerCase();
    return UNIT_ALIASES[unit] || unit;
  }
  function convertQuantity(quantity, from, to) {
    const amount = number(quantity);
    const first = UNITS.find(unit => unit.value === normalizeUnit(from));
    const last = UNITS.find(unit => unit.value === normalizeUnit(to));
    if (amount == null || !first || !last || first.family !== last.family) return null;
    return tidy(amount * first.factor / last.factor);
  }
  function dateNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2200) return null;
    const stamp = Date.UTC(year, month - 1, day);
    const date = new Date(stamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? stamp / DAY : null;
  }
  function monthDetails(value) {
    const month = String(value || '').slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || dateNumber(month + '-01') == null) throw new Error('Choose a valid month.');
    const [year, index] = month.split('-').map(Number);
    const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
    return { month, days, first: month + '-01', last: month + '-' + String(days).padStart(2, '0') };
  }
  function indexProducts(products) {
    if (products instanceof Map) return products;
    if (!Array.isArray(products)) return new Map(Object.entries(products || {}));
    return new Map(products.filter(Boolean).map(product => [product.id, product]));
  }
  function unknownNutrition() {
    return { values: Object.fromEntries(KEYS.map(key => [key, null])), missing: Object.fromEntries(KEYS.map(key => [key, 1])), complete: false };
  }
  function productNutrition(product, servings) {
    const amount = servings == null ? 1 : positive(servings);
    if (!product || amount == null || !positive(product.serving_quantity) || !UNITS.some(unit => unit.value === normalizeUnit(product.serving_unit))) return unknownNutrition();
    const result = { values: {}, missing: {}, complete: true };
    for (const key of KEYS) {
      const value = number(product.nutrients && product.nutrients[key]);
      result.values[key] = value == null ? null : tidy(value * amount);
      result.missing[key] = result.values[key] == null ? 1 : 0;
      if (result.missing[key]) result.complete = false;
    }
    return result;
  }
  function nutritionProvenance(snapshot) {
    if (!snapshot || snapshot.estimated !== true) return {};
    const result = { estimated: true };
    if (typeof snapshot.basis === 'string' && snapshot.basis.trim()) result.basis = snapshot.basis.trim();
    if (typeof snapshot.source === 'string' && snapshot.source.trim()) result.source = snapshot.source.trim();
    if (Array.isArray(snapshot.sources)) {
      const sources = [...new Set(snapshot.sources.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
      if (sources.length) result.sources = sources;
    }
    return result;
  }
  function nutritionTotals(entries) {
    const sources = Array.isArray(entries) ? entries.map(entry => entry && (entry.nutrition_snapshot || entry)) : [];
    const result = { values: {}, missing: {}, complete: sources.length > 0 };
    const estimates = sources.filter(snapshot => snapshot && snapshot.estimated === true);
    if (estimates.length) {
      result.estimated = true;
      result.basis = 'nutrition_total';
      result.sources = [...new Set(estimates.flatMap(snapshot => {
        const metadata = nutritionProvenance(snapshot);
        return [metadata.source, ...(metadata.sources || [])].filter(Boolean);
      }))];
      if (result.sources.length === 1) result.source = result.sources[0];
    }
    for (const key of KEYS) {
      let sum = 0, known = 0, missing = 0;
      for (const snapshot of sources) {
        const value = number(snapshot && snapshot.values && snapshot.values[key]);
        const absent = number(snapshot && snapshot.missing && snapshot.missing[key]);
        if (value != null) { sum += value; known++; }
        missing += absent != null && Number.isInteger(absent) ? Math.max(value == null ? 1 : 0, absent) : (value == null ? 1 : 0);
      }
      result.values[key] = known ? tidy(sum) : null;
      result.missing[key] = missing;
      if (!known || missing || result.values[key] == null) result.complete = false;
    }
    return result;
  }
  function recipeNutrition(recipe, products, servings) {
    const count = servings == null ? 1 : positive(servings);
    const yieldCount = positive(recipe && recipe.servings);
    if (!recipe || !yieldCount || count == null) return unknownNutrition();
    if (recipe.nutrition_mode === 'reference') {
      const result = { values: {}, missing: {}, complete: true, estimated: true, basis: 'recipe_reference', source: typeof recipe.nutrition_source === 'string' ? recipe.nutrition_source.trim() : '' };
      for (const key of KEYS) {
        const raw = recipe.nutrition_reference && recipe.nutrition_reference[key];
        const value = typeof raw === 'number' ? number(raw) : null;
        result.values[key] = value == null ? null : tidy(value * count / yieldCount);
        result.missing[key] = result.values[key] == null ? 1 : 0;
        if (result.missing[key]) result.complete = false;
      }
      return result;
    }
    if (recipe.nutrition_mode != null && recipe.nutrition_mode !== 'ingredients') return unknownNutrition();
    if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) return unknownNutrition();
    const catalog = indexProducts(products);
    const result = nutritionTotals(recipe.ingredients.map(ingredient => {
      const product = ingredient && catalog.get(ingredient.product_id);
      const amount = ingredient && positive(ingredient.quantity);
      if (!product || amount == null || !positive(product.serving_quantity)) return unknownNutrition();
      const converted = convertQuantity(amount * count / yieldCount, ingredient.unit, product.serving_unit);
      return converted == null ? unknownNutrition() : productNutrition(product, converted / Number(product.serving_quantity));
    }));
    // A free-form list can include foods that have not been linked. Without a
    // verified mapping, label totals are known subtotals, not a complete recipe.
    if (typeof recipe.ingredient_text === 'string' && recipe.ingredient_text.trim()) {
      for (const key of KEYS) result.missing[key]++;
      result.complete = false;
    }
    return result;
  }
  function effectiveDate(item) {
    if (!item) return null;
    if (item.location === 'freezer' && dateNumber(item.freezer_use_by) != null) {
      return { date: item.freezer_use_by, label: 'Freezer reminder date', kind: 'freezer_use_by' };
    }
    if (dateNumber(item.expires_on) != null) {
      return { date: item.expires_on, label: DATE_LABELS[item.date_type] || DATE_LABELS.unknown, kind: item.date_type || 'unknown' };
    }
    return null;
  }
  function uniqueRows(rows) {
    const seen = new Set();
    return (rows || []).filter((row, index) => {
      if (!row) return false;
      const key = row.id || 'index:' + index;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function dueItems(inventory, today) {
    const current = dateNumber(today);
    if (current == null) return [];
    return uniqueRows(inventory).flatMap(item => {
      const due = effectiveDate(item);
      if (!positive(item.quantity) || !due) return [];
      const days = dateNumber(due.date) - current;
      const entered = Number(item.reminder_days);
      const reminder = item.reminder_days != null && Number.isInteger(entered) && entered >= 0 && entered <= 30 ? entered : 3;
      if (days > reminder) return [];
      return [{ ...item, due_on: due.date, days_until: days, date_label: due.label, date_kind: due.kind, status: days < 0 ? 'overdue' : days === 0 ? 'today' : 'soon', reminder_days: reminder }];
    }).sort((a, b) => a.days_until - b.days_until || String(a.name).localeCompare(String(b.name)));
  }
  function stockPool(inventory, today) {
    const current = dateNumber(today);
    return uniqueRows(inventory).filter(item => {
      const due = effectiveDate(item);
      return item.product_id && positive(item.quantity) && (!due || current == null || dateNumber(due.date) >= current);
    }).map(item => ({ ...item, remaining: Number(item.quantity) })).sort((a, b) => {
      const left = effectiveDate(a), right = effectiveDate(b);
      return (left ? dateNumber(left.date) : Infinity) - (right ? dateNumber(right.date) : Infinity) || String(a.id).localeCompare(String(b.id));
    });
  }
  function recipeSuggestions(recipes, products, inventory, today) {
    const catalog = indexProducts(products);
    const due = dueItems(inventory, today).filter(item => item.status !== 'overdue' && item.product_id);
    const result = [];
    for (const recipe of uniqueRows(recipes)) {
      if (recipe.archived || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) continue;
      const ingredientIds = new Set(recipe.ingredients.map(ingredient => ingredient.product_id));
      const matches = due.filter(item => ingredientIds.has(item.product_id));
      if (!matches.length) continue;
      const pool = stockPool(inventory, today);
      const missing = [];
      const allergens = new Set();
      let available = 0;
      for (const ingredient of recipe.ingredients) {
        const product = catalog.get(ingredient.product_id);
        if (product && String(product.allergens || '').trim()) allergens.add(String(product.allergens).trim());
        let needed = positive(ingredient.quantity);
        let incompatible = false;
        if (needed == null || !UNITS.some(unit => unit.value === normalizeUnit(ingredient.unit))) {
          missing.push({ product_id: ingredient.product_id, name: product ? product.name : 'Unknown ingredient', quantity: needed, unit: ingredient.unit, reason: 'Review this ingredient quantity and unit.' });
          continue;
        }
        for (const batch of pool.filter(item => item.product_id === ingredient.product_id && item.remaining > 0)) {
          const compatible = convertQuantity(batch.remaining, batch.unit, ingredient.unit);
          if (compatible == null) { incompatible = true; continue; }
          const used = Math.min(needed, compatible);
          const removed = convertQuantity(used, ingredient.unit, batch.unit);
          batch.remaining = Math.max(0, batch.remaining - removed);
          needed = Math.max(0, tidy(needed - used));
          if (needed <= 1e-9) break;
        }
        if (needed > 1e-9) missing.push({ product_id: ingredient.product_id, name: product ? product.name : 'Unknown ingredient', quantity: tidy(needed), unit: ingredient.unit, reason: incompatible ? 'Some recorded stock uses an incompatible unit.' : 'More is needed for the full recipe.' });
        else available++;
      }
      const writtenIngredientsUnverified = typeof recipe.ingredient_text === 'string' && !!recipe.ingredient_text.trim();
      result.push({ recipe_id: recipe.id, name: recipe.name, recipe, matching_items: matches, missing_ingredients: missing, ingredient_count: recipe.ingredients.length, available_count: available, written_ingredients_unverified: writtenIngredientsUnverified, complete_stock: missing.length === 0 && !writtenIngredientsUnverified, known_allergens: [...allergens], days_until: Math.min(...matches.map(item => item.days_until)), soonest_date: matches[0].due_on });
    }
    return result.sort((a, b) => a.days_until - b.days_until || b.matching_items.length - a.matching_items.length || a.missing_ingredients.length - b.missing_ingredients.length || String(a.name).localeCompare(String(b.name)));
  }
  function recurringPlan(recurring, products, inventory, month) {
    const period = monthDetails(month);
    const catalog = indexProducts(products);
    const groups = new Map(), issues = [];
    for (const pattern of uniqueRows(recurring)) {
      if (pattern.active === false) continue;
      const product = catalog.get(pattern.product_id);
      const quantity = positive(pattern.quantity), interval = positive(pattern.every_days);
      if (!product || product.archived || !positive(product.package_quantity) || !UNITS.some(unit => unit.value === normalizeUnit(product.package_unit)) || quantity == null || interval == null || !['units', 'packs'].includes(pattern.basis)) {
        issues.push('Review recurring product ' + (product ? product.name : pattern.product_id || 'with no product') + '.');
        continue;
      }
      if (!groups.has(product.id)) groups.set(product.id, { product, required: 0, recurring_ids: [], person_slots: new Set() });
      const group = groups.get(product.id);
      group.required += quantity * period.days / interval * (pattern.basis === 'packs' ? Number(product.package_quantity) : 1);
      if (pattern.id) group.recurring_ids.push(pattern.id);
      group.person_slots.add(pattern.person_slot == null ? null : Number(pattern.person_slot));
    }
    const items = [];
    let total = 0, missingPrices = 0;
    for (const [id, group] of groups) {
      const product = group.product;
      const required = tidy(group.required);
      const notes = [];
      let allocated = 0;
      const pool = stockPool(inventory, period.first).filter(item => item.product_id === id);
      for (const batch of pool) {
        const compatible = convertQuantity(batch.remaining, batch.unit, product.package_unit);
        if (compatible == null) { notes.push('Review ' + batch.name + ': stock unit ' + batch.unit + ' does not match this product.'); continue; }
        const due = effectiveDate(batch);
        const usableDays = due ? Math.max(0, Math.min(period.days, dateNumber(due.date) - dateNumber(period.first) + 1)) : period.days;
        const beforeDate = required * usableDays / period.days;
        const use = Math.min(compatible, Math.max(0, beforeDate - allocated), Math.max(0, required - allocated));
        allocated += use;
        if (!due && use > 0) notes.push('Check the date on ' + batch.name + ' before using this stock.');
        if (due && usableDays < period.days && compatible > use) notes.push('Only the amount planned before ' + due.date + ' was counted from ' + batch.name + '.');
      }
      const shortage = Math.max(0, tidy(required - allocated));
      const packs = Math.max(0, Math.ceil(shortage / Number(product.package_quantity) - 1e-10));
      const price = cents(product.price_cents);
      let estimate = packs === 0 ? 0 : price == null ? null : price * packs;
      if (!Number.isSafeInteger(estimate)) estimate = null;
      if (estimate == null) missingPrices++; else total += estimate;
      items.push({ product_id: id, name: product.name, category: product.category === 'household' ? 'household' : 'food', required_quantity: required, stock_quantity: tidy(allocated), shortage_quantity: shortage, package_quantity: Number(product.package_quantity), package_unit: product.package_unit, packs, estimate_cents: estimate, price_cents: price, price_date: product.price_date || null, person_slots: [...group.person_slots].sort((a, b) => (a == null ? 3 : a) - (b == null ? 3 : b)), recurring_ids: group.recurring_ids, notes });
    }
    return { month: period.month, days: period.days, items, known_total_cents: total, missing_prices: missingPrices, complete: missingPrices === 0 && issues.length === 0, issues };
  }
  function monthlyMoney(snapshot, month) {
    const period = monthDetails(month);
    const data = snapshot || {};
    const budget = (data.budgets || []).find(row => row.month === period.first);
    const amounts = { food: { budget_cents: budget ? cents(budget.amount_cents) : null, spent_cents: 0, planned_cents: 0, missing_prices: 0 }, household: { budget_cents: budget ? cents(budget.household_amount_cents) : null, spent_cents: 0, planned_cents: 0, missing_prices: 0 } };
    let income = 0, expense = 0;
    const paidBills = new Set(), seenEntries = new Set(), seenReceipts = new Set();
    const voidReceipts = new Set((data.receipts || []).filter(row => row.voided_at).map(row => row.id));
    for (const entry of data.moneyEntries || []) {
      if (!entry || entry.voided_at || voidReceipts.has(entry.receipt_id) || String(entry.occurred_on || '').slice(0, 7) !== period.month) continue;
      const value = cents(entry.amount_cents);
      if (value == null || !['income', 'expense'].includes(entry.direction)) continue;
      if (entry.id && seenEntries.has(entry.id)) continue;
      if (entry.id) seenEntries.add(entry.id);
      if (entry.receipt_id) {
        const key = entry.receipt_id + ':' + entry.category;
        if (seenReceipts.has(key)) continue;
        seenReceipts.add(key);
      }
      if (entry.direction === 'income') income += value; else expense += value;
      if (amounts[entry.category]) amounts[entry.category].spent_cents += entry.direction === 'income' ? -value : value;
      if (entry.bill_id && entry.direction === 'expense') paidBills.add(entry.bill_id);
    }
    for (const item of uniqueRows(data.shoppingItems)) {
      if (item.checked || String(item.month || '').slice(0, 7) !== period.month) continue;
      const category = item.category === 'household' ? amounts.household : amounts.food;
      const estimate = cents(item.estimate_cents);
      if (estimate == null) category.missing_prices++; else category.planned_cents += estimate;
    }
    for (const category of Object.values(amounts)) {
      category.remaining_before_plan_cents = category.budget_cents == null ? null : category.budget_cents - category.spent_cents;
      category.known_available_cents = category.budget_cents == null ? null : category.budget_cents - category.spent_cents - category.planned_cents;
      category.available_cents = category.missing_prices ? null : category.known_available_cents;
    }
    let billsPlanned = 0, billsMissing = 0, billsPending = 0;
    for (const bill of uniqueRows(data.bills)) {
      if (bill.month !== period.first) continue;
      const value = cents(bill.amount_cents);
      if (value == null) billsMissing++; else { billsPlanned += value; if (!paidBills.has(bill.id)) billsPending += value; }
    }
    return { month: period.month, ...amounts, total_income_cents: income, total_expense_cents: expense, net_cents: income - expense, bills_planned_cents: billsPlanned, bills_pending_cents: billsPending, bills_missing_amounts: billsMissing, paid_bill_ids: [...paidBills] };
  }

  const api = { NUTRIENTS, UNITS, AISLES, convertQuantity, recipeNutrition, productNutrition, nutritionTotals, nutritionProvenance, dueItems, recipeSuggestions, recurringPlan, monthlyMoney, dateNumber, monthDetails, effectiveDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomFoodModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
