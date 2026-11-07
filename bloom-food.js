/* Saved recipes, food-date reminders and separate planned/eaten nutrition logs. */
(function (root) {
  'use strict';
  const M = root.BloomFoodModel || (typeof require === 'function' ? require('./bloom-food-model.js') : null);
  const RECIPE_FIELDS = ['name', 'servings', 'ingredient_text', 'instructions', 'source_url', 'notes', 'nutrition_mode', 'nutrition_source'];
  const LOG_FIELDS = ['occurred_on', 'person_slot', 'kind', 'source_kind', 'recipe_id', 'product_id', 'servings', 'notes'];
  const PLAN_FIELDS = ['recipe_id', 'cook_on', 'meal_type', 'servings', 'person1_servings', 'person2_servings', 'notes'];
  const PLAN_REJECTIONS = new Set(['22023', '23514', '23503', '23505', '40001', '42501']);
  const uuid = () => {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const dayKey = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const fmt = value => Number.isFinite(Number(value)) && value != null ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value)) : 'Not recorded';
  const money = centsValue => Number.isFinite(Number(centsValue)) && centsValue != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(centsValue) / 100) : 'Not recorded';
  function dateLabel(value) {
    if (M.dateNumber(value) == null) return 'Date not recorded';
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function text(value, label, max, required) {
    const result = String(value == null ? '' : value).trim();
    if (required && !result) throw new Error('Enter ' + label.toLowerCase() + '.');
    if (result.length > max) throw new Error(label + ' is too long.');
    return result;
  }
  function quantity(value, label, maximum) {
    const number = Number(value);
    if (String(value == null ? '' : value).trim() === '' || !Number.isFinite(number) || number <= 0 || number > (maximum || 1000000)) throw new Error(label + ' must be greater than zero and no more than ' + (maximum || 1000000) + '.');
    return number;
  }
  function referenceNumber(value, label) {
    if (value == null || (typeof value === 'string' && !value.trim())) return null;
    const amount = Number(value);
    if (!['string', 'number'].includes(typeof value) || !Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new Error(label + ' must be a number from 0 to 1,000,000,000, or left blank when unknown.');
    return amount;
  }
  function referenceDraft(values) {
    return Object.fromEntries(M.NUTRIENTS.map(({ key }) => [key, values && Object.hasOwn(values, key) && values[key] != null ? values[key] : '']));
  }
  function retainedReferenceIssue(value) {
    try {
      text(value.nutrition_source, 'Estimate source and assumptions', 2000, false);
      for (const { key, label } of M.NUTRIENTS) referenceNumber(value.nutrition_reference && value.nutrition_reference[key], label + ' for the whole recipe');
      return '';
    } catch (error) { return error.message; }
  }
  function safeUrl(value) {
    const address = String(value || '').trim();
    if (!address) return '';
    try { const parsed = new URL(address); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; }
    catch (_) { return ''; }
  }
  function shoppingIngredientDraft() { return { name: '', quantity: '', unit: '', product_id: '', optional: false, notes: '', included: true }; }
  function recipeDraft() { return { id: '', request_id: uuid(), revision: null, name: '', servings: '', ingredient_text: '', ingredients: [{ product_id: '', quantity: '', unit: 'each' }], planning_ingredients: [], instructions: '', source_url: '', notes: '', nutrition_mode: 'ingredients', nutrition_reference: referenceDraft(), nutrition_source: '', archived: false }; }
  function logDraft(date) { return { id: '', request_id: uuid(), revision: null, occurred_on: date, person_slot: '1', kind: 'eaten', source_kind: 'recipe', recipe_id: '', product_id: '', servings: '1', notes: '', nutrition_original: null, original_servings: null, original_recipe_id: null, original_product_id: null, original_label: '' }; }
  function planDraft(date) { return { id: '', request_id: uuid(), revision: null, recipe_id: '', recipe_revision: null, recipe_name: '', base_servings: null, shopping_month: null, cook_on: date, meal_type: 'dinner', servings: '', person1_servings: '', person2_servings: '', notes: '', ingredients: [] }; }
  function planningRows(recipe, products) {
    if (!recipe) return [];
    const explicit = Array.isArray(recipe.planning_ingredients) && recipe.planning_ingredients.length;
    if (!explicit && String(recipe.ingredient_text || '').trim()) return [];
    const rows = typeof M.recipePlanningIngredients === 'function' ? M.recipePlanningIngredients(recipe, products || []) : explicit ? recipe.planning_ingredients : (recipe.ingredients || []).map(item => ({ ...item, name: ((products || []).find(product => product.id === item.product_id) || {}).name || '', optional: false, notes: '' }));
    return rows.map(item => ({ ...shoppingIngredientDraft(), ...copy(item), quantity: item.quantity == null ? '' : item.quantity, product_id: item.product_id || '', included: Object.hasOwn(item, 'included') ? item.included !== false : item.optional !== true }));
  }
  function portionDivision(value, label) {
    if (value == null || String(value).trim() === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000) throw new Error(label + ' must be from 0 to 10,000, or left blank.');
    return amount;
  }
  function scaledSnapshot(snapshot, multiplier) {
    if (!snapshot || !snapshot.values || typeof snapshot.values !== 'object' || !Number.isFinite(multiplier) || multiplier <= 0) return null;
    return { ...M.nutritionProvenance(snapshot), values: Object.fromEntries(M.NUTRIENTS.map(({ key }) => [key, snapshot.values[key] == null ? null : Number((Number(snapshot.values[key]) * multiplier).toPrecision(13))])), missing: Object.fromEntries(M.NUTRIENTS.map(({ key }) => [key, Number(snapshot.missing && snapshot.missing[key]) || (snapshot.values[key] == null ? 1 : 0)])), complete: snapshot.complete === true };
  }
  function personProfile(current, slot) {
    const member = (current.members || []).find(value => slot === 1 ? value.role === 'owner' : value.role === 'member');
    return member ? (current.dietProfiles || []).find(value => value.user_id === member.user_id) || null : null;
  }
  function allergyMatches(recipe, products, current, slot) {
    const productMap = new Map((products || []).map(value => [value.id, value]));
    const ingredientText = (String(recipe.ingredient_text || '') + ' ' + (recipe.ingredients || []).map(value => productMap.get(value.product_id)).filter(Boolean).map(value => (value.allergens || '') + ' ' + value.name).join(' ')).toLowerCase();
    const aliases = { milk: ['milk', 'dairy'], egg: ['egg', 'eggs'], peanut: ['peanut', 'peanuts'], 'tree nuts': ['tree nuts', 'almond', 'almonds', 'walnut', 'walnuts', 'cashew', 'cashews', 'pecan', 'pecans', 'pistachio', 'pistachios'], wheat: ['wheat'], gluten: ['gluten', 'wheat', 'barley', 'rye'], soy: ['soy', 'soya', 'soybean'], fish: ['fish', 'salmon', 'tuna', 'cod'], shellfish: ['shellfish', 'shrimp', 'crab', 'lobster'], sesame: ['sesame'] };
    const contains = (haystack, needle) => new RegExp('(?:^|[^a-z])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i').test(haystack);
    const matches = [];
    for (const person of slot ? [Number(slot)] : [1, 2]) {
      const profile = personProfile(current, person);
      const allergies = String(profile && profile.allergies || '').toLowerCase();
      if (!allergies) continue;
      const found = new Set();
      for (const [name, words] of Object.entries(aliases)) if (words.some(word => contains(allergies, word)) && words.some(word => contains(ingredientText, word))) found.add(name);
      for (const raw of allergies.split(/[,;\n]+/)) {
        const word = raw.trim();
        if (word.length > 1 && !/^(none|no allergies|unknown|not sure)$/.test(word) && contains(ingredientText, word)) found.add(word);
      }
      if (found.size) matches.push({ person_slot: person, allergens: [...found] });
    }
    return matches;
  }
  function calendarEscape(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function foldCalendar(line) {
    const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
    let output = '', count = 0;
    for (const character of line) {
      const length = encoder ? encoder.encode(character).length : unescape(encodeURIComponent(character)).length;
      if (count + length > 73) { output += '\r\n '; count = 1; }
      output += character; count += length;
    }
    return output;
  }
  function buildExpiryCalendar(item, now) {
    const due = M.effectiveDate(item);
    if (!due) throw new Error('Add a package or freezer reminder date first.');
    const next = new Date((M.dateNumber(due.date) + 1) * 86400000).toISOString().slice(0, 10);
    const days = Number.isInteger(Number(item.reminder_days)) ? Math.max(0, Math.min(30, Number(item.reminder_days))) : 3;
    const name = String(item.name || 'Food');
    const description = due.label + ': ' + due.date + '. Review the food and package instructions before use. This calendar date is a reminder, not a food-safety assessment.' + (item.frozen_on ? '\nFrozen on ' + item.frozen_on + '.' : '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life in Bloom//Food date reminder//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + calendarEscape((item.id || uuid()) + '-' + due.date + '@life-in-bloom.local'), 'DTSTAMP:' + (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'), 'DTSTART;VALUE=DATE:' + due.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + next.replace(/-/g, ''), 'SUMMARY:' + calendarEscape('Check ' + name), 'DESCRIPTION:' + calendarEscape(description), 'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + calendarEscape('Check ' + name + ': ' + due.label.toLowerCase() + ' ' + due.date), 'TRIGGER:' + (days ? '-P' + days + 'D' : 'PT0M'), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].map(foldCalendar).join('\r\n') + '\r\n';
  }

  // Water is recorded once in shared hydration history, then included in the
  // same person/date's actual fluid total. Planning never enters this total.
  function actualNutrition(current, date, person) {
    const actual = (current.mealEntries || []).filter(entry => !entry.archived && Number(entry.person_slot) === Number(person) && entry.occurred_on === date && entry.kind === 'eaten');
    const water = (current.hydrationEntries || []).filter(entry => !entry.archived && Number(entry.person_slot) === Number(person) && entry.occurred_on === date && Number(entry.amount_ml) > 0);
    const nutrition = M.nutritionTotals(actual);
    const waterMl = water.reduce((sum, entry) => sum + Number(entry.amount_ml), 0);
    if (water.length) nutrition.values.fluid_ml = Number(nutrition.values.fluid_ml || 0) + waterMl;
    return { actual, water, waterMl, nutrition };
  }
  function createController(options) {
    if (!M) throw new Error('Food calculations could not load. Please refresh.');
    const store = options.store;
    if (!store || typeof store.snapshot !== 'function') throw new Error('The household store is not available.');
    const refresh = options.refresh || (() => {}), notify = options.notify || (() => {}), navigate = options.navigate || (() => {});
    const confirm = options.confirm || (message => typeof root.confirm === 'function' && root.confirm(message));
    const getNow = options.getNow || (() => new Date());
    const draftStore = options.draftStore || null;
    const openGrocery = options.openGrocery || (() => navigate('grocery'));
    let identity = null, generation = 0, busy = null, pending = Promise.resolve(), currentPage = 'food';
    let tab = 'home', selectedDate = dayKey(getNow()), search = '', editor = false, openedRecipeId = '', logging = false, planning = false;
    let selectedFile = null, fileUrls = new Map(), draftSaved = false, draftWarningShown = false;
    let recipeReturn = null;
    let cookbookSelectedRecipeId = '';
    let liveCookRecipeId = '';
    let liveCookStep = 0;
    let liveCookTimerEnd = 0;
    let liveCookTimerHandle = null;
    let cookbookPdfPage = 1;
    const COOKBOOK_PAGES = {1:4,2:6,3:7,4:8,5:9,6:10,7:11,8:12,9:13,10:14,11:15,12:16,13:17,14:18,15:20,16:21,17:22,18:23,19:24,20:25,21:26,22:27,23:29,24:30,25:31,26:33,27:35,28:36,29:37,30:38,31:40,32:41,33:42,34:43,35:44,36:45,37:46,38:47,39:48,40:49,41:50,42:51,43:52,44:54,45:55};
    const COOKBOOK_SECTIONS = [
      ['Main Dishes',1,7],['Family Recipes',8,10],['Breakfast',11,11],['Drinks',12,12],
      ['New Recipes',13,22],['More Favorites',23,32],['Final Additions · Main Dishes',33,42],
      ['Soups',43,43],['Side Dishes',44,44],['Desserts',45,45]
    ];
    let planAttempt = null, planProblem = '', planIngredientsOpen = false;
    let drafts = { recipe: recipeDraft(), log: logDraft(selectedDate), plan: planDraft(selectedDate) }, baselines = copy(drafts);

    const dirty = group => JSON.stringify(drafts[group]) !== JSON.stringify(baselines[group]);
    function resetGroup(group, value) { drafts[group] = copy(value); baselines[group] = copy(value); if (group === 'plan') planIngredientsOpen = !(value.ingredients || []).length; }
    function restoreDrafts(saved) {
      if (!saved || saved.version !== 1 || !saved.drafts || !saved.baselines || !Array.isArray(saved.drafts.recipe && saved.drafts.recipe.ingredients) || saved.drafts.recipe.ingredients.length > 100) return false;
      for (const group of ['recipe', 'log', 'plan']) {
        const empty = group === 'recipe' ? recipeDraft() : group === 'log' ? logDraft(selectedDate) : planDraft(selectedDate);
        const restore = source => {
          const result = copy(empty);
          for (const key of Object.keys(empty)) if (source && Object.hasOwn(source, key)) result[key] = copy(source[key]);
          if (group === 'recipe') {
            result.nutrition_reference = referenceDraft(result.nutrition_reference);
            if (!Array.isArray(result.planning_ingredients) || result.planning_ingredients.length > 100) result.planning_ingredients = [];
          }
          if (group === 'plan' && (!Array.isArray(result.ingredients) || result.ingredients.length > 100)) return copy(empty);
          return result;
        };
        drafts[group] = restore(saved.drafts[group]); baselines[group] = restore(saved.baselines[group]);
      }
      tab = ['home','cookbook','recipes','plans','cooking','soon','log'].includes(saved.tab) ? saved.tab : 'home';
      selectedDate = M.dateNumber(saved.selectedDate) == null ? dayKey(getNow()) : saved.selectedDate;
      editor = Boolean(saved.editor); logging = Boolean(saved.logging); planning = Boolean(saved.planning); openedRecipeId = String(saved.openedRecipeId || '');
      if (saved.planAttempt && ['save', 'cancel'].includes(saved.planAttempt.action) && saved.planAttempt.payload && typeof saved.planAttempt.payload === 'object' && typeof saved.planAttempt.payload.request_id === 'string') planAttempt = copy(saved.planAttempt);
      planProblem = String(saved.planProblem || '');
      planIngredientsOpen = typeof saved.planIngredientsOpen === 'boolean' ? saved.planIngredientsOpen : !drafts.plan.ingredients.length;
      return true;
    }
    function snapshot() {
      const current = store.snapshot() || {};
      const key = (current.user && current.user.id || '') + ':' + (current.household && current.household.id || '');
      if (key !== identity) {
        identity = key; generation++; busy = null; selectedDate = dayKey(getNow()); tab = 'home'; search = ''; editor = false; logging = false; planning = false; planAttempt = null; planProblem = ''; planIngredientsOpen = false; openedRecipeId = ''; recipeReturn = null; cookbookSelectedRecipeId = ''; liveCookRecipeId = ''; liveCookStep = 0; stopLiveTimer(); selectedFile = null; fileUrls = new Map();
        drafts = { recipe: recipeDraft(), log: logDraft(selectedDate), plan: planDraft(selectedDate) }; baselines = copy(drafts); draftSaved = false; draftWarningShown = false;
        if (draftStore && current.user && current.household) {
          try { const saved = draftStore.read(current.user.id, current.household.id, 'food'); draftSaved = Boolean(saved && restoreDrafts(saved.data)); }
          catch (_) { notify('A saved Food draft could not be opened. Your stored copy has not been changed.', true); }
        }
      }
      return current;
    }
    function updateDraftIndicators() {
      if (!root.document || typeof root.document.querySelector !== 'function') return;
      for (const group of ['recipe', 'log', 'plan']) {
        const element = root.document.querySelector('[data-food-draft-status="' + group + '"]');
        if (element) { element.hidden = !dirty(group); element.textContent = draftSaved ? 'Draft saved on this device. Choose Save to share the finished entry with your household.' : 'Draft in progress. Save before closing this page.'; }
      }
    }
    function persist() {
      const current = snapshot();
      if (!draftStore || !current.user || !current.household) { updateDraftIndicators(); return; }
      try {
        const changed = dirty('recipe') || dirty('log') || dirty('plan') || Boolean(planAttempt);
        const ok = changed ? draftStore.write(current.user.id, current.household.id, 'food', { version: 1, drafts, baselines, tab, selectedDate, editor, logging, planning, openedRecipeId, planAttempt, planProblem, planIngredientsOpen }) : draftStore.clear(current.user.id, current.household.id, 'food');
        draftSaved = changed && ok !== false;
        if (ok === false && !draftWarningShown) { draftWarningShown = true; notify('This browser could not save your Food draft. Keep this page open until you save it online.', true); }
      } catch (_) { draftSaved = false; if (!draftWarningShown) { draftWarningShown = true; notify('Your Food draft could not be saved on this device. Keep the page open until you save it online.', true); } }
      updateDraftIndicators();
    }
    function hasUnsavedDraft() { snapshot(); return Boolean(busy || selectedFile || dirty('recipe') || dirty('log') || dirty('plan') || planAttempt); }
    function discardDraft() {
      if (busy) return false;
      if (planAttempt) { notify('Confirm the pending meal-plan save before discarding it. Its exact request is kept for a safe retry.', true); return false; }
      resetGroup('recipe', recipeDraft()); resetGroup('log', logDraft(selectedDate)); resetGroup('plan', planDraft(dayKey(getNow()))); planProblem = ''; selectedFile = null; editor = false; logging = false; planning = false; persist(); return true;
    }
    function ready(current) {
      if (!current.user || !current.household || current.status !== 'ready') throw new Error('Open Grocery and connect your household before saving Food records.');
      if (current.offline) throw new Error('You are offline. Your draft stays on this device. Reconnect to save it to your household.');
    }
    function run(label, work, success, focus, onError) {
      if (busy) return false;
      const token = generation; busy = { label }; refresh();
      pending = Promise.resolve().then(work).then(result => { snapshot(); if (token !== generation) return; if (success) success(result); persist(); }).catch(error => { snapshot(); if (token !== generation) return; if (onError) onError(error); persist(); notify(error && error.message || 'This change could not be saved. Your draft is still here.', true); }).finally(() => { snapshot(); if (token !== generation) return; busy = null; refresh(focus); });
      return true;
    }
    function button(action, label, data, primary, disabled) {
      return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-food-action="' + action + '"' + (data || '') + (busy || disabled ? ' disabled' : '') + '>' + label + '</button>';
    }
    function field(group, name, label, type, attrs) {
      const value = drafts[group][name];
      return '<label class="food-field" for="food-' + group + '-' + name + '"><span>' + label + '</span><input id="food-' + group + '-' + name + '" name="' + name + '" type="' + (type || 'text') + '" data-food-field="' + group + '.' + name + '" value="' + esc(value) + '"' + (attrs || '') + (busy || group === 'plan' && planAttempt ? ' disabled' : '') + '></label>';
    }
    function textarea(group, name, label, limit, attrs) {
      return '<label class="food-field" for="food-' + group + '-' + name + '"><span>' + label + '</span><textarea id="food-' + group + '-' + name + '" name="' + name + '" data-food-field="' + group + '.' + name + '" maxlength="' + limit + '"' + (attrs || '') + (busy || group === 'plan' && planAttempt ? ' disabled' : '') + '>' + esc(drafts[group][name]) + '</textarea></label>';
    }
    function estimateNotice(value) {
      if (!value || value.estimated !== true) return '';
      const metadata = M.nutritionProvenance(value);
      const sources = [...new Set([metadata.source, ...(metadata.sources || [])].filter(Boolean))];
      return '<p class="food-help food-prose"><strong>' + (metadata.basis === 'recipe_reference' ? 'Recipe estimate.' : 'Includes recipe estimates.') + '</strong>' + (sources.length ? ' ' + sources.map(esc).join('\n') : ' These values are approximate.') + '</p>';
    }
    function nutritionTable(value, headline) {
      const data = value || M.nutritionTotals([]);
      return '<div class="food-nutrition"><h4>' + esc(headline || 'Nutrition') + '</h4>' + estimateNotice(data) + '<dl>' + M.NUTRIENTS.map(nutrient => '<div><dt>' + nutrient.label + '</dt><dd>' + (data.values[nutrient.key] == null ? '<span class="food-unknown">Not recorded</span>' : esc(fmt(data.values[nutrient.key])) + ' ' + nutrient.unit + ((data.missing || {})[nutrient.key] ? ' <small>known · incomplete</small>' : '')) + '</dd></div>').join('') + '</dl>' + (!data.complete ? '<p class="food-help">Missing nutrition values remain unknown. A shown subtotal may be incomplete.</p>' : '') + '</div>';
    }
    function briefNutrition(value) {
      return (value.estimated === true ? '<span>' + (value.basis === 'recipe_reference' ? 'Recipe estimate' : 'Includes estimates') + '</span>' : '') + [['calories_kcal', 'kcal'], ['protein_g', 'g protein']].map(([key, unit]) => value.values[key] == null ? '<span>' + (key === 'calories_kcal' ? 'Calories' : 'Protein') + ': not recorded</span>' : '<span>' + esc(fmt(value.values[key])) + ' ' + unit + ((value.missing || {})[key] ? ' known · incomplete' : '') + '</span>').join('');
    }
    function recipeCostMarkup(recipe, current, compact) {
      if (!M.recipeCost) return '';
      const cost = M.recipeCost(recipe, current.products || [], current.inventory || [], dayKey(getNow()));
      const makeLabel = cost.complete ? 'Estimated cost to make' : 'Estimated cost so far';
      const shoppingLabel = cost.shopping_complete ? 'Estimated shopping total' : 'Estimated shopping total so far';
      const perServing = cost.complete && Number(recipe.servings) > 0 ? Math.round(cost.known_make_cost_cents / Number(recipe.servings)) : null;
      const review = [];
      if (cost.missing_links) review.push(cost.missing_links + ' unlinked ingredient' + (cost.missing_links === 1 ? '' : 's'));
      if (cost.incompatible_units) review.push(cost.incompatible_units + ' amount/unit review' + (cost.incompatible_units === 1 ? '' : 's'));
      if (cost.missing_prices) review.push(cost.missing_prices + ' missing price' + (cost.missing_prices === 1 ? '' : 's'));
      const makeValue = money(cost.known_make_cost_cents) + (cost.complete ? '' : '+');
      const shopValue = money(cost.estimated_shopping_total_cents) + (cost.shopping_complete ? '' : '+');
      let html = '<div class="food-cost-summary' + (compact ? ' is-compact' : '') + '"><div><span>' + makeLabel + '</span><strong>' + makeValue + '</strong>' + (perServing != null ? '<small>' + money(perServing) + ' per serving</small>' : '') + '</div><div><span>' + shoppingLabel + '</span><strong>' + shopValue + '</strong><small>' + money(cost.known_shopping_subtotal_cents) + ' subtotal + ' + money(cost.estimated_shopping_tax_cents) + ' estimated tax</small></div></div>';
      if (!compact && cost.to_buy.length) html += '<div class="food-buy-recommendation"><h4>Recommended to buy or review</h4><ul>' + cost.to_buy.slice(0, 12).map(item => '<li><span><strong>' + esc(item.name) + '</strong>' + (item.shortage_quantity != null ? '<small>' + esc(fmt(item.shortage_quantity)) + ' ' + esc(item.unit || '') + ' still needed</small>' : '<small>Amount needs review</small>') + '</span><span>' + (item.packs != null && item.packs > 0 ? esc(item.packs) + ' package' + (item.packs === 1 ? '' : 's') : 'Review') + (item.shopping_cost_cents != null ? '<small>' + money(item.shopping_cost_cents) + '</small>' : '') + '</span></li>').join('') + '</ul><p class="food-help">Plan this meal to send its reviewed shortages to Grocery. Shopping totals use current reference prices and include the generic 3% tax estimate.</p></div>';
      if (cost.estimated_conversions) html += '<p class="food-help"><strong>Includes estimated kitchen conversions.</strong> ' + esc((cost.conversion_notes || []).join(' · ')) + '</p>';
      if (review.length) html += '<p class="food-help"><strong>Still needs review:</strong> ' + esc(review.join(' · ')) + '. The + means the shown total is a minimum known estimate, not the final recipe cost.</p>';
      return html;
    }
    function allergyNotice(recipe, current, slot) {
      const matches = allergyMatches(recipe, current.products || [], current, slot);
      return matches.length ? '<p class="food-alert" role="note"><strong>Recorded allergy match:</strong> ' + matches.map(match => 'Person ' + match.person_slot + ' — ' + esc(match.allergens.join(', '))).join('; ') + '. Review the current product labels and recipe.</p>' : '';
    }
    function personalNotes(current, slot) {
      const profile = personProfile(current, slot);
      if (!profile) return '<p class="food-help">Nutrition goals and dietary notes have not been set for this person.</p>';
      return ['allergies', 'restrictions', 'preferences'].filter(key => profile[key]).map(key => '<p class="food-help"><strong>' + key[0].toUpperCase() + key.slice(1) + ':</strong> ' + esc(profile[key]) + '</p>').join('');
    }
    function renderFiles(current, recipe) {
      const files = (current.foodFiles || []).filter(file => file.recipe_id === recipe.id);
      let html = '<div class="food-files"><h3>Recipe photos & files</h3><p class="food-help">Attach a photo, label, or PDF for your household. Files do not automatically become recipe ingredients or nutrition facts.</p>';
      if (files.length) html += '<ul class="food-file-list">' + files.map(file => '<li><span>' + esc(file.name) + '</span><div class="food-actions">' + (fileUrls.has(file.id) ? '<a class="button" href="' + esc(fileUrls.get(file.id)) + '" target="_blank" rel="noopener noreferrer">Open file ↗</a>' : button('view-file', 'View file', ' data-id="' + esc(file.id) + '"')) + button('remove-file', 'Remove', ' data-id="' + esc(file.id) + '"', false, current.offline) + '</div></li>').join('') + '</ul>';
      html += '<label class="food-field" for="food-recipe-file"><span>Add a file <small>JPG, PNG, WebP or PDF · up to 10 MB</small></span><input id="food-recipe-file" type="file" data-food-file-input="' + esc(recipe.id) + '" accept="image/jpeg,image/png,image/webp,application/pdf"' + (busy || current.offline ? ' disabled' : '') + '></label>';
      if (selectedFile) html += '<p class="food-help">Ready to upload: ' + esc(selectedFile.name) + '</p>';
      return html + '<div class="food-actions">' + button('upload-file', 'Save file to this recipe', ' data-id="' + esc(recipe.id) + '"', false, !selectedFile || current.offline) + '</div></div>';
    }
    function shoppingIngredientEditor(group, current) {
      const rows = group === 'recipe' ? drafts.recipe.planning_ingredients : drafts.plan.ingredients;
      const locked = Boolean(busy || group === 'plan' && planAttempt);
      const dis = locked ? ' disabled' : '';
      const products = (current.products || []).filter(product => product.category !== 'household' && (!product.archived || rows.some(item => item.product_id === product.id)));
      const count = drafts.plan.base_servings;
      let html = '<fieldset class="food-ingredient-editor food-planning-editor"><legend>' + (group === 'recipe' ? 'Shopping ingredients for the whole recipe' : 'Ingredients for this meal') + '</legend><p class="food-help">The amounts in these rows are for the original recipe' + (group === 'plan' && Number(count) > 0 ? ' that makes <strong>' + esc(fmt(count)) + ' servings</strong>' : '') + '. ' + (group === 'recipe' ? 'Use the whole-recipe serving count entered above. Save each ingredient once; planning scales these amounts to the servings you choose.' : 'The app scales them to the servings you chose above. Changes here apply to this meal only.') + ' Leave an uncertain amount blank for review.</p>';
      if (!rows.length) html += '<p class="food-alert">Add the recipe’s shopping ingredients below. Its written list is kept as a reference; uncertain amounts are never guessed.</p>';
      html += '<datalist id="food-' + group + '-planning-units">' + M.UNITS.map(unit => '<option value="' + esc(unit.value) + '">' + esc(unit.label) + '</option>').join('') + ['clove', 'stalk', 'slice', 'piece', 'pinch'].map(unit => '<option value="' + unit + '"></option>').join('') + '</datalist>';
      html += rows.map((ingredient, index) => {
        const prefix = 'food-' + group + '-shopping-' + index;
        const data = ' data-food-planning-group="' + group + '" data-food-planning-index="' + index + '"';
        return '<div class="food-planning-row' + (group === 'plan' && ingredient.included === false ? ' is-excluded' : '') + '"><div class="food-planning-row-heading"><strong>Ingredient ' + (index + 1) + '</strong>' + (group === 'plan' ? '<label class="food-checkbox"><input type="checkbox" name="planning_' + index + '_included"' + data + ' data-food-planning-part="included"' + (ingredient.included !== false ? ' checked' : '') + dis + '> Include in this meal' + (ingredient.optional ? ' · optional' : '') + '</label>' : '<label class="food-checkbox"><input type="checkbox" name="planning_' + index + '_optional"' + data + ' data-food-planning-part="optional"' + (ingredient.optional ? ' checked' : '') + dis + '> Optional ingredient</label>') + '</div><div class="food-planning-amounts"><label class="food-field" for="' + prefix + '-name"><span>Ingredient name</span><input id="' + prefix + '-name" name="planning_' + index + '_name"' + data + ' data-food-planning-part="name" maxlength="160" value="' + esc(ingredient.name) + '"' + dis + '></label><label class="food-field" for="' + prefix + '-quantity"><span>Whole-recipe amount</span><input id="' + prefix + '-quantity" name="planning_' + index + '_quantity"' + data + ' data-food-planning-part="quantity" type="number" min="0.000001" max="1000000000" step="any" inputmode="decimal" placeholder="Unknown" value="' + esc(ingredient.quantity) + '"' + dis + '></label><label class="food-field" for="' + prefix + '-unit"><span>Unit</span><input id="' + prefix + '-unit" name="planning_' + index + '_unit"' + data + ' data-food-planning-part="unit" list="food-' + group + '-planning-units" maxlength="30" placeholder="g, cup, each…" value="' + esc(ingredient.unit) + '"' + dis + '></label></div><label class="food-field" for="' + prefix + '-product"><span>Catalog product (optional)</span><select id="' + prefix + '-product" name="planning_' + index + '_product_id"' + data + ' data-food-planning-part="product_id"' + dis + '><option value="">Choose later · add an ingredient reminder</option>' + products.map(product => '<option value="' + esc(product.id) + '"' + (ingredient.product_id === product.id ? ' selected' : '') + '>' + esc(product.name + (product.brand ? ' · ' + product.brand : '')) + '</option>').join('') + '</select></label><label class="food-field" for="' + prefix + '-notes"><span>Ingredient notes (optional)</span><input id="' + prefix + '-notes" name="planning_' + index + '_notes"' + data + ' data-food-planning-part="notes" maxlength="1000" value="' + esc(ingredient.notes) + '"' + dis + '></label><div class="food-actions">' + button('remove-shopping-ingredient', 'Remove ingredient', ' data-group="' + group + '" data-index="' + index + '"', false, locked) + '</div></div>';
      }).join('');
      html += '<div class="food-actions">' + button('add-shopping-ingredient', '+ Add shopping ingredient', ' data-group="' + group + '"', false, locked || rows.length >= 100) + button('grocery', 'Open product catalog ↗', ' data-tab="catalog"') + '</div><p class="food-help">Catalog links let the app compare food at home, package sizes, and reference prices. Unlinked ingredients remain visible on the list for review. Measurements such as cloves and stalks keep their own units.</p></fieldset>';
      return html;
    }
    function planPreview(current, value) {
      const recipe = { ...(current.recipes || []).find(row => row.id === value.recipe_id), name: value.recipe_name, servings: value.base_servings, planning_ingredients: value.ingredients };
      return M.cookingPlanPreview(recipe, value.ingredients, value.servings, current.products || []);
    }
    function renderPlanPreview(current) {
      const preview = planPreview(current, drafts.plan);
      return '<h3>Recipe amounts for ' + (preview.servings == null ? 'your chosen' : esc(fmt(preview.servings))) + ' servings</h3><p class="food-help">These are the meal’s full ingredient needs. Saving checks your available stock and other planned meals, then updates what still needs buying.</p>' + (preview.rows.length ? '<ul class="food-plan-requirements">' + preview.rows.map(item => '<li' + (!item.included ? ' class="is-excluded"' : '') + '><strong>' + esc(item.name || 'Unnamed ingredient') + '</strong><span>' + (!item.included ? 'Not included' : item.required_quantity == null ? 'Amount needs review' : esc(fmt(item.required_quantity)) + ' ' + esc(item.unit || '· unit needs review')) + '</span></li>').join('') + '</ul>' : '') + (preview.issues.length ? '<details class="food-plan-review"><summary>' + preview.issues.length + ' ingredient detail' + (preview.issues.length === 1 ? '' : 's') + ' to review</summary><ul>' + preview.issues.map(issue => '<li>' + esc(issue) + '</li>').join('') + '</ul>' : '');
    }
    function updatePlanPreview(current) {
      if (!root.document || typeof root.document.querySelector !== 'function') return;
      const preview = root.document.querySelector('#food-plan-preview');
      if (preview) preview.innerHTML = renderPlanPreview(current);
    }
    function renderPlanForm(current) {
      const value = drafts.plan;
      const recipe = (current.recipes || []).find(row => row.id === value.recipe_id);
      const locked = Boolean(busy || planAttempt);
      const saveButton = '<button type="submit" class="button primary"' + (busy || current.offline || planAttempt && planAttempt.action !== 'save' ? ' disabled' : '') + '>' + (planAttempt && planAttempt.action === 'save' ? 'Retry the same meal save' : 'Save meal & update grocery list') + '</button>';
      let html = '<section class="panel food-plan-panel"><p class="page-kicker">Cook on a day you choose</p><h2>' + (value.id ? 'Edit your planned meal' : 'Plan this meal') + '</h2><p class="food-help">Save the date and servings. Missing ingredients go onto your current grocery list immediately, with the cooking date beside them.</p><form id="food-plan-form" class="food-form" data-food-form="plan">';
      if (value.id) html += '<h3>' + esc(value.recipe_name || recipe && recipe.name || 'Saved recipe') + '</h3>';
      else html += '<label class="food-field" for="food-plan-recipe_id"><span>Saved recipe</span><select id="food-plan-recipe_id" name="recipe_id" data-food-field="plan.recipe_id" required' + (locked ? ' disabled' : '') + '><option value="">Choose a recipe</option>' + (current.recipes || []).filter(row => !row.archived).map(row => '<option value="' + esc(row.id) + '"' + (row.id === value.recipe_id ? ' selected' : '') + '>' + esc(row.name) + '</option>').join('') + '</select></label>';
      html += '<div class="food-form-grid">' + field('plan', 'cook_on', 'Day you want to cook', 'date', ' required min="' + dayKey(getNow()) + '" max="2200-12-31"') + '<label class="food-field" for="food-plan-meal_type"><span>Meal type</span><select id="food-plan-meal_type" name="meal_type" data-food-field="plan.meal_type"' + (locked ? ' disabled' : '') + '>' + [['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snack']].map(([value,label])=>'<option value="'+value+'"'+(drafts.plan.meal_type===value?' selected':'')+'>'+label+'</option>').join('') + '</select></label>' + field('plan', 'servings', 'Total servings to make', 'number', ' required min="0.000001" max="10000" step="any" inputmode="decimal"') + '</div>';
      html += '<section id="food-plan-preview" class="food-plan-preview" aria-label="Scaled recipe ingredients">' + renderPlanPreview(current) + '</section>';
      if (recipe && Number(recipe.revision) !== Number(value.recipe_revision)) html += '<p class="food-alert">The saved recipe has changed since this plan was opened. Load its latest ingredients and review them before saving.</p>' + button('reload-plan-recipe', 'Load latest recipe ingredients', '', false, Boolean(planAttempt));
      if (recipe) html += allergyNotice(recipe, current);
      if (planProblem) html += '<p class="food-alert">This draft needs a fresh review before saving. You can reload the saved plan, or load the latest recipe ingredients when the recipe changed.</p><div class="food-actions">' + button('reload-plan', 'Reload saved plan') + button('reload-plan-recipe', 'Load latest recipe ingredients', '', false, Boolean(planAttempt)) + '</div>';
      html += '<div class="food-actions">' + saveButton + button('close-plan', 'Close for now') + '</div>';
      html += '<details class="food-plan-ingredient-details"' + (planIngredientsOpen ? ' open' : '') + '><summary id="food-plan-ingredients-toggle" data-food-action="toggle-plan-ingredients">Adjust ingredients</summary>' + shoppingIngredientEditor('plan', current) + '</details>';
      html += '<details class="food-plan-portions"><summary>Divide the servings between people (optional)</summary><div class="food-form-grid"><div class="food-person-pink">' + field('plan', 'person1_servings', 'Person 1 servings', 'number', ' min="0" max="10000" step="any" inputmode="decimal"') + '</div><div class="food-person-purple">' + field('plan', 'person2_servings', 'Person 2 servings', 'number', ' min="0" max="10000" step="any" inputmode="decimal"') + '</div></div><p class="food-help">You can leave extra servings for leftovers. This division belongs to the cooking plan; log eaten portions in the Food log when you eat them.</p></details>';
      html += textarea('plan', 'notes', 'Meal notes (optional)', 4000);
      if (recipe && recipe.ingredient_text) html += '<details><summary>Original written ingredient list</summary><p class="food-prose">' + esc(recipe.ingredient_text) + '</p></details>';
      html += '<div class="food-actions">' + saveButton + (!planAttempt ? button('discard-plan', 'Discard meal draft') : '') + '</div>' + draftStatus('plan') + '</form></section>';
      return html;
    }
    function planRequirementRows(plan, current) {
      return M.cookingPlanPreview({ servings: plan.base_servings, planning_ingredients: plan.ingredients || [] }, plan.ingredients || [], plan.servings, current.products || []).rows;
    }
    function planCostMarkup(plan, current) {
      if (!M.recipeCost) return '';
      const savedRecipe=(current.recipes||[]).find(row=>row.id===plan.recipe_id);
      const currentByName=new Map(((savedRecipe&&savedRecipe.planning_ingredients)||[]).map(row=>[String(row.name||'').trim().toLowerCase(),row]));
      const planRows=(plan.ingredients||[]).map(row=>{
        if(row.product_id) return row;
        const fresh=currentByName.get(String(row.name||'').trim().toLowerCase());
        return fresh&&fresh.product_id?{...row,product_id:fresh.product_id}:row;
      });
      const cost=M.recipeCost({servings:plan.base_servings,planning_ingredients:planRows},current.products||[],current.inventory||[],dayKey(getNow()),plan.servings);
      const review=[];
      if(cost.missing_links) review.push(cost.missing_links+' unlinked');
      if(cost.incompatible_units) review.push(cost.incompatible_units+' unit review');
      if(cost.missing_prices) review.push(cost.missing_prices+' price');
      let html='<div class="food-cost-summary"><div><span>'+(cost.complete?'Estimated meal cost':'Estimated meal cost so far')+'</span><strong>'+money(cost.known_make_cost_cents)+(cost.complete?'':'+')+'</strong></div><div><span>'+(cost.shopping_complete?'Estimated shopping needed':'Estimated shopping needed so far')+'</span><strong>'+money(cost.estimated_shopping_total_cents)+(cost.shopping_complete?'':'+')+'</strong><small>'+money(cost.known_shopping_subtotal_cents)+' subtotal + '+money(cost.estimated_shopping_tax_cents)+' estimated tax</small></div></div>';
      if(cost.estimated_conversions) html+='<p class="food-help"><strong>Includes estimated kitchen conversions.</strong> '+esc((cost.conversion_notes||[]).join(' · '))+'</p>';
      if(review.length) html+='<p class="food-help"><strong>Still needs review:</strong> '+esc(review.join(' · '))+'. The + means the shown total is the minimum currently supported by linked prices.</p>';
      return html;
    }
    function renderPlanCard(plan, current, history) {
      const refs = (current.mealShoppingLinks || []).filter(link => (link.plan_refs || []).some(ref => ref.plan_id === plan.id));
      const rows = planRequirementRows(plan, current).filter(row => row.included);
      const issues = Array.isArray(plan.issues) ? plan.issues : [];
      let html = '<article class="food-meal-card"><div class="food-heading"><div><span class="food-date-badge">' + (plan.status === 'cancelled' ? 'Cancelled' : history ? 'Past cooking date · saved plan' : dateLabel(plan.cook_on)) + '</span><h3>' + esc(plan.recipe_name || 'Saved recipe') + '</h3><small>' + esc((plan.meal_type || 'dinner').replace(/^./,c=>c.toUpperCase())) + '</small></div><strong>' + esc(fmt(plan.servings)) + ' servings</strong></div><p class="food-help">' + (history ? dateLabel(plan.cook_on) + ' · ' : '') + 'Recipe makes ' + esc(fmt(plan.base_servings)) + ' servings before scaling.' + (plan.person1_servings != null ? ' Person 1: ' + esc(fmt(plan.person1_servings)) + '.' : '') + (plan.person2_servings != null ? ' Person 2: ' + esc(fmt(plan.person2_servings)) + '.' : '') + '</p>';
      html += planCostMarkup(plan, current);
      if (plan.notes) html += '<p class="food-prose">' + esc(plan.notes) + '</p>';
      html += '<details><summary>Ingredients for this meal</summary><ul class="food-plan-requirements">' + rows.map(item => '<li><strong>' + esc(item.name) + '</strong><span>' + (item.required_quantity == null ? 'Amount needs review' : esc(fmt(item.required_quantity)) + ' ' + esc(item.unit || '· unit needs review')) + '</span></li>').join('') + '</ul></details>';
      if (!history && plan.status === 'planned') {
        if (issues.length) html += '<details class="food-plan-review" open><summary>Shopping details to review</summary><ul>' + issues.map(issue => '<li>' + esc(typeof issue === 'string' ? issue : issue.message || JSON.stringify(issue)) + '</li>').join('') + '</ul></details>';
        html += '<p class="food-help">' + (refs.length ? refs.length + ' grocery item' + (refs.length === 1 ? '' : 's') + ' linked to this meal.' : 'Saved for grocery planning. Open the list to review what still needs buying.') + '</p><div class="food-actions">' + button('grocery', 'Open grocery list', ' data-tab="list" data-month="' + esc(String(plan.shopping_month || dayKey(getNow())).slice(0, 7)) + '"', true) + button('edit-plan', 'Edit date or servings', ' data-id="' + esc(plan.id) + '"', false, Boolean(planAttempt)) + button('cancel-plan', 'Cancel meal', ' data-id="' + esc(plan.id) + '"', false, Boolean(planAttempt) || current.offline) + '</div>';
      } else html += '<p class="food-help">' + (plan.status === 'cancelled' ? 'The saved plan remains in history. Actual purchases stay recorded.' : 'A past cooking date does not mark food cooked or eaten.') + '</p>';
      return html + '</article>';
    }
    function renderPlans(current) {
      const today = dayKey(getNow());
      const all = [...(current.cookingPlans || [])].sort((left, right) => String(left.cook_on).localeCompare(String(right.cook_on)) || String(left.id).localeCompare(String(right.id)));
      const upcoming = all.filter(plan => plan.status === 'planned' && plan.cook_on >= today);
      const history = all.filter(plan => plan.status !== 'planned' || plan.cook_on < today);
      let html = '<section class="food-menu-page" id="food-plans"><div class="food-menu-heading"><div><p class="page-kicker">Cook on a day you choose</p><h2>Food planning</h2><p>Plan meals ahead, prep with confidence, and keep your grocery list in sync.</p></div></div>'
        + '<details class="food-plan-dropdown"' + (planning ? ' open' : '') + '><summary><span>🗓️</span><strong>' + (planning ? 'Plan this meal' : 'Plan a meal') + '</strong><small>Choose a recipe, date, servings, and meal type</small><b>⌄</b></summary>'
        + '<div class="food-plan-dropdown-body"><div class="food-actions">' + (!planning ? button('new-plan','Start a new meal plan','',true,Boolean(planAttempt)) : button('close-plan','Close planner')) + '</div>'
        + (planAttempt ? '<section class="food-plan-pending"><h3>' + (planAttempt.action === 'cancel' ? 'Confirming your cancellation' : 'Confirming your saved meal') + '</h3><p class="food-help">The last request has not been confirmed on this device. Retry keeps the exact same request, so it cannot create a second meal or duplicate groceries.</p><div class="food-actions">' + button('retry-plan','Retry the same request','',true,current.offline) + button('reload-plan','Check saved result','',false,current.offline) + '</div></section>' : '')
        + (planning ? renderPlanForm(current) : '')
        + '</div></details>'
        + '<section class="panel food-upcoming-primary"><div class="food-heading"><div><p class="page-kicker">Your menu</p><h2>Upcoming meals</h2></div><div class="food-actions">' + button('grocery','Open grocery list',' data-tab="list"') + button('refresh-meal-shopping','Check groceries','',false,current.offline || Boolean(planAttempt)) + '</div></div>'
        + (upcoming.length ? '<div class="food-meal-list">' + upcoming.map(plan => renderPlanCard(plan,current,false)).join('') + '</div>' : '<div class="food-empty"><h3>No meals planned yet</h3><p>Use the Plan a meal dropdown above or plan directly from any cookbook recipe.</p></div>') + '</section>';
      if (dirty('plan') && !planning) html += '<section class="panel"><p>You have a meal-plan draft saved on this device.</p>' + button('resume-plan','Resume meal draft','',true) + '</section>';
      if (history.length) html += '<section class="panel"><details><summary>Saved meal history · ' + history.length + '</summary><div class="food-meal-list">' + history.reverse().map(plan => renderPlanCard(plan,current,true)).join('') + '</div></details></section>';
      return html + '</section>';
    }

    function renderRecipeDetail(current, recipe) {
      const products = new Map((current.products || []).map(product => [product.id, product]));
      const backLabel = recipeReturn && recipeReturn.tab === 'cookbook' ? '← Back to Cookbook' : '← Back';
      let html = '<section class="panel food-recipe-detail" id="food-recipe-detail-' + esc(recipe.id) + '" tabindex="-1"><nav class="food-recipe-jump" aria-label="Recipe navigation">' + button('recipe-back', backLabel) + button('scroll-top', '↑ Top') + '</nav><p class="page-kicker">' + esc(recipe.category_label || 'Saved recipe') + '</p><h2>' + esc(recipe.name) + '</h2>' + (recipe.time_text ? '<p class="food-recipe-meta">Time · ' + esc(recipe.time_text) + '</p>' : '') + '<p class="food-help">Makes ' + esc(fmt(recipe.servings)) + ' servings. Ingredient quantities below are for the whole recipe.</p>' + recipeCostMarkup(recipe, current, false) + allergyNotice(recipe, current);
      if (recipe.ingredient_text) html += '<h3>Ingredients as written</h3><p class="food-prose">' + esc(recipe.ingredient_text) + '</p>';
      if ((recipe.ingredients || []).length) html += '<h3>Foods linked to your catalog</h3><ul class="food-ingredients">' + recipe.ingredients.map(item => '<li><strong>' + esc(products.get(item.product_id) && products.get(item.product_id).name || 'Ingredient no longer available') + '</strong><span>' + esc(fmt(item.quantity)) + ' ' + esc(item.unit) + '</span></li>').join('') + '</ul>';
      else html += '<p class="food-help">You can link catalog foods when you want pantry matches or calculations from their nutrition labels.</p>';
      if ((recipe.planning_ingredients || []).length) html += '<details><summary>Shopping ingredients for meal planning</summary><ul class="food-plan-requirements">' + recipe.planning_ingredients.map(item => '<li><strong>' + esc(item.name) + (item.optional ? ' <small>optional</small>' : '') + '</strong><span>' + (item.quantity == null ? 'Amount needs review' : esc(fmt(item.quantity)) + ' ' + esc(item.unit)) + '</span></li>').join('') + '</ul><p class="food-help">Amounts are for the whole recipe. Planning scales them to the servings you choose.</p></details>';
      if (recipe.instructions) html += '<h3>Instructions</h3><p class="food-prose">' + esc(recipe.instructions) + '</p>';
      if (recipe.notes) html += '<p class="food-prose food-help">' + esc(recipe.notes) + '</p>';
      if (recipe.source_name) html += '<p class="food-help"><strong>Recipe source:</strong> ' + esc(recipe.source_name) + '</p>';
      if (safeUrl(recipe.source_url)) html += '<p><a href="' + esc(safeUrl(recipe.source_url)) + '" target="_blank" rel="noopener noreferrer">Original recipe ↗</a></p>';
      html += nutritionTable(M.recipeNutrition(recipe, current.products || [], 1), 'Nutrition per recipe serving');
      html += '<div class="food-actions">' + button('cook-recipe', '▶ Cook this recipe live', ' data-id="' + esc(recipe.id) + '"', true) + button('plan-recipe', 'Plan this meal', ' data-id="' + esc(recipe.id) + '"', false, Boolean(planAttempt)) + button('log-recipe', 'Log for Person 1', ' data-id="' + esc(recipe.id) + '" data-person="1"') + button('log-recipe', 'Log for Person 2', ' data-id="' + esc(recipe.id) + '" data-person="2"') + button('edit-recipe', 'Edit recipe', ' data-id="' + esc(recipe.id) + '"') + button('archive-recipe', 'Archive recipe', ' data-id="' + esc(recipe.id) + '"', false, current.offline) + '</div>';
      return html + renderFiles(current, recipe) + '</section>';
    }
    function renderRecipeForm(current) {
      const value = drafts.recipe;
      const products = (current.products || []).filter(product => product.category !== 'household' && (!product.archived || value.ingredients.some(item => item.product_id === product.id)));
      let html = '<section class="panel"><p class="page-kicker">' + (value.id ? 'Edit your recipe' : 'A recipe to keep') + '</p><h2>' + (value.id ? 'Edit recipe' : 'Save a recipe') + '</h2><p class="food-help">Keep the original ingredient list, including ranges and optional ingredients. Link catalog foods when you want pantry matches or calculations from their labels.</p><form id="food-recipe-form" class="food-form" data-food-form="recipe"><div class="food-form-grid">' + field('recipe', 'name', 'Recipe name', 'text', ' maxlength="160" required') + field('recipe', 'servings', 'Servings made by the whole recipe', 'number', ' min="0.01" max="10000" step="any" required') + '</div>' + textarea('recipe', 'ingredient_text', 'Ingredients as written', 12000) + '<fieldset class="food-ingredient-editor"><legend>Optional catalog links for the whole recipe</legend>';
      html += value.ingredients.map((ingredient, index) => '<div class="food-ingredient-row"><label class="food-field" for="food-ingredient-' + index + '-product"><span>Ingredient ' + (index + 1) + '</span><select id="food-ingredient-' + index + '-product" name="ingredient_' + index + '_product_id" data-food-ingredient="' + index + '" data-food-part="product_id"' + (busy ? ' disabled' : '') + '><option value="">Choose a catalog product</option>' + products.map(product => '<option value="' + esc(product.id) + '"' + (product.id === ingredient.product_id ? ' selected' : '') + '>' + esc(product.name + (product.brand ? ' · ' + product.brand : '')) + '</option>').join('') + '</select></label><label class="food-field" for="food-ingredient-' + index + '-quantity"><span>Amount</span><input id="food-ingredient-' + index + '-quantity" name="ingredient_' + index + '_quantity" data-food-ingredient="' + index + '" data-food-part="quantity" type="number" min="0.000001" max="1000000000" step="any" value="' + esc(ingredient.quantity) + '"' + (busy ? ' disabled' : '') + '></label><label class="food-field" for="food-ingredient-' + index + '-unit"><span>Unit</span><select id="food-ingredient-' + index + '-unit" name="ingredient_' + index + '_unit" data-food-ingredient="' + index + '" data-food-part="unit"' + (busy ? ' disabled' : '') + '>' + M.UNITS.map(unit => '<option value="' + unit.value + '"' + (ingredient.unit === unit.value ? ' selected' : '') + '>' + unit.label + '</option>').join('') + '</select></label>' + button('remove-ingredient', 'Remove', ' data-index="' + index + '"') + '</div>').join('');
      html += '<div class="food-actions">' + button('add-ingredient', '+ Link an ingredient', '', false, value.ingredients.length >= 100) + button('grocery', 'Add a product to the catalog ↗', ' data-tab="catalog"') + '</div><p class="food-help">Use a definite quantity for each catalog link. Keep ranges, alternatives, and “to taste” amounts in Ingredients as written. A cup cannot be converted into grams without a food-specific measurement.</p></fieldset>';
      html += shoppingIngredientEditor('recipe', current);
      html += '<label class="food-field" for="food-recipe-nutrition_mode"><span>Nutrition calculation</span><select id="food-recipe-nutrition_mode" name="nutrition_mode" data-food-field="recipe.nutrition_mode"' + (busy ? ' disabled' : '') + '><option value="ingredients"' + (value.nutrition_mode !== 'reference' ? ' selected' : '') + '>Calculate from ingredient labels</option><option value="reference"' + (value.nutrition_mode === 'reference' ? ' selected' : '') + '>Use recipe estimates</option></select></label>';
      const referenceMode = value.nutrition_mode === 'reference';
      const retainedIssue = referenceMode ? '' : retainedReferenceIssue(value);
      if (!referenceMode) html += '<p class="food-help">Nutrition is calculated from the catalog foods you link. Unlinked foods and missing label values keep the calculation incomplete.</p>';
      if (retainedIssue) html += '<p class="food-alert" role="alert"><strong>Correct the retained recipe estimates below before saving.</strong> Ingredient-label mode keeps these values for later. ' + esc(retainedIssue) + '</p>';
      if (referenceMode || retainedIssue) {
        html += '<fieldset class="food-ingredient-editor"><legend>Nutrition estimates for the whole recipe</legend><p class="food-help">Enter totals for the entire recipe. The app divides them by the number of servings, then uses each person’s portion. Leave unknown values blank; use 0 only when the source says zero. Update these estimates if you change the ingredients.</p><div class="food-form-grid">' + M.NUTRIENTS.map(({ key, label, unit }) => '<label class="food-field" for="food-recipe-reference-' + key + '"><span>' + esc(label) + ' (' + esc(unit) + ')</span><input id="food-recipe-reference-' + key + '" name="nutrition_reference_' + key + '" data-food-reference="' + key + '" type="number" min="0" max="1000000000" step="any" inputmode="decimal" placeholder="Unknown" value="' + esc(value.nutrition_reference && value.nutrition_reference[key]) + '"' + (busy ? ' disabled' : '') + '></label>').join('') + '</div>' + textarea('recipe', 'nutrition_source', 'Source and assumptions for these estimates', 2000, referenceMode ? ' required' : '') + '</fieldset>';
      }
      html += textarea('recipe', 'instructions', 'Instructions', 20000) + field('recipe', 'source_url', 'Recipe link (optional)', 'url', ' maxlength="2048"') + textarea('recipe', 'notes', 'Notes (optional)', 4000);
      html += '<div class="food-actions"><button type="submit" class="button primary"' + (busy || current.offline ? ' disabled' : '') + '>Save recipe</button>' + button('discard-recipe', 'Discard recipe draft') + '</div>' + draftStatus('recipe') + '</form></section>';
      return html;
    }
    function draftStatus(group) {
      return '<p class="food-draft-state" data-food-draft-status="' + group + '" role="status"' + (!dirty(group) ? ' hidden' : '') + '>' + (draftSaved ? 'Draft saved on this device. Choose Save to share the finished entry with your household.' : 'Draft in progress. Save before closing this page.') + '</p>';
    }
    function cookbookNumber(recipe) {
      const match = String(recipe && recipe.source_key || '').match(/^food_in_bloom_(\d{2})$/);
      return match ? Number(match[1]) : null;
    }
    function afterRenderScroll(selector, block) {
      if (!selector || !root.document) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = root.document.querySelector(selector);
        if (!target) return;
        target.scrollIntoView({ block: block || 'start', behavior: 'smooth' });
        if (typeof target.focus === 'function') {
          try { target.focus({ preventScroll: true }); } catch (_) {}
        }
      }));
    }
    function openRecipeAndScroll(recipeId, originTab) {
      const current = snapshot();
      const recipe = (current.recipes || []).find(row => row.id === recipeId && !row.archived);
      if (!recipe) throw new Error('Refresh to find this saved recipe.');
      recipeReturn = { tab: originTab || tab, y: Number(root.scrollY || root.pageYOffset || 0) };
      openedRecipeId = recipe.id; editor = false; selectedFile = null; tab = 'recipes';
      persist(); refresh();
      afterRenderScroll('#food-recipe-detail-' + recipe.id, 'start');
      return true;
    }
    function recipeSteps(recipe) {
      const raw = String(recipe && recipe.instructions || '').replace(/\r/g, ' ').trim();
      if (!raw) return ['Read through the recipe, gather the ingredients, and begin when you are ready.'];
      const matches = [...raw.matchAll(/(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=(?:\s+\d+\.\s)|$)/g)];
      const steps = matches.map(match => match[2].trim()).filter(Boolean);
      if (steps.length) return steps;
      return raw.split(/\n+/).map(value => value.trim()).filter(Boolean);
    }
    function liveStepMinutes(value) {
      const match = String(value || '').match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*min(?:ute)?s?/i);
      return match ? Math.max(1, Number(match[1])) : 0;
    }
    function stopLiveTimer() {
      if (liveCookTimerHandle && root.clearInterval) root.clearInterval(liveCookTimerHandle);
      liveCookTimerHandle = null; liveCookTimerEnd = 0;
    }
    function startLiveTimer(minutes) {
      stopLiveTimer();
      const amount = Math.max(1, Math.min(240, Number(minutes) || 1));
      liveCookTimerEnd = Date.now() + amount * 60000;
      if (root.setInterval) liveCookTimerHandle = root.setInterval(() => {
        if (!liveCookTimerEnd) return;
        if (Date.now() >= liveCookTimerEnd) {
          stopLiveTimer();
          notify('Cooking timer finished.');
        }
        refresh('#food-live-timer');
      }, 1000);
    }
    function liveTimerText() {
      if (!liveCookTimerEnd) return '';
      const seconds = Math.max(0, Math.ceil((liveCookTimerEnd - Date.now()) / 1000));
      return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function speakLiveStep(recipe) {
      const steps = recipeSteps(recipe), step = steps[Math.max(0, Math.min(liveCookStep, steps.length - 1))] || '';
      if (!root.speechSynthesis || typeof root.SpeechSynthesisUtterance !== 'function') {
        notify('Audio guidance is not available in this browser.', true); return;
      }
      root.speechSynthesis.cancel();
      const utterance = new root.SpeechSynthesisUtterance('Step ' + (liveCookStep + 1) + '. ' + step);
      utterance.rate = 0.92; utterance.pitch = 1; utterance.volume = 1;
      root.speechSynthesis.speak(utterance);
    }
    function cookbookRecipeNumber(recipe) { return cookbookNumber(recipe) || ''; }
    function cookbookVisual(recipe, extraClass) {
      const number = cookbookRecipeNumber(recipe);
      return '<div class="food-book-visual ' + (extraClass || '') + '"><span class="food-book-page-no">p. ' + esc(COOKBOOK_PAGES[number] || '') + '</span><span class="food-book-dish" aria-hidden="true">🍽️</span><strong>' + esc(recipe && recipe.name || 'Food In Bloom') + '</strong><small>' + esc(recipe && recipe.category_label || 'Cookbook recipe') + '</small></div>';
    }
    function renderLiveCook(current, recipe) {
      const steps = recipeSteps(recipe), index = Math.max(0, Math.min(liveCookStep, steps.length - 1)), step = steps[index];
      const minutes = liveStepMinutes(step), timerText = liveTimerText();
      const dots = steps.map((_, position) => '<span class="' + (position === index ? 'is-current' : position < index ? 'is-done' : '') + '">' + (position + 1) + '</span>').join('');
      return '<aside class="food-live-panel" id="food-live-cook"><div class="food-live-topbar">' + button('cook-exit', '← Back') + '<span>🔖 &nbsp; ⋯</span></div>'
        + '<div class="food-live-hero"><span aria-hidden="true">🍳</span></div>'
        + '<h2>' + esc(recipe.name) + '</h2><p class="food-live-meta">Serves: ' + esc(fmt(recipe.servings)) + (recipe.time_text ? ' &nbsp; | &nbsp; Time: ' + esc(recipe.time_text) : '') + '</p>'
        + '<div class="food-live-tabs">' + button('cook-open-recipe', 'Recipe', ' data-id="' + esc(recipe.id) + '"') + '<span class="is-active">▶ Cook Live</span><span>Nutrition</span><span>Notes</span></div>'
        + '<section class="food-live-step-card"><div class="food-live-step-head"><div><span class="food-live-dot"></span><strong>Live Cook: Step-by-Step</strong><small>Hands-free guided cooking with audio and timers.</small></div><span aria-hidden="true">⚙</span></div>'
        + '<div class="food-live-progress-dots">' + dots + '</div>'
        + '<div class="food-live-step-body"><div class="food-live-step-visual"><span aria-hidden="true">🔪</span></div><div><small>Step ' + (index + 1) + ' of ' + steps.length + '</small><h3>' + (index === 0 ? 'Get started' : 'Keep cooking') + '</h3><p>' + esc(step) + '</p></div></div>'
        + '<div class="food-live-controls">' + button('cook-speak', '🔊 Audio') + button('cook-replay', '↻ Replay') + (index > 0 ? button('cook-prev', '← Previous') : '') + (index < steps.length - 1 ? button('cook-next', 'Next Step →', '', true) : '<span class="food-live-finished">✓ Final step</span>') + '</div></section>'
        + '<div class="food-live-tools"><div><strong>🎙 Hands-Free</strong><small>Audio guidance</small></div><div id="food-live-timer"><strong>⏱ ' + (timerText || (minutes ? minutes + ':00' : 'Timer')) + '</strong><small>' + (timerText ? 'Timer running' : minutes ? 'Suggested from this step' : 'No timed step detected') + '</small></div><div><strong>🔊 Step Voice</strong><small>Warm, steady pace</small></div></div>'
        + (minutes && !timerText ? '<div class="food-live-timer-actions">' + button('cook-start-timer', 'Start ' + minutes + ' min timer', ' data-minutes="' + minutes + '"', true) + '</div>' : timerText ? '<div class="food-live-timer-actions">' + button('cook-stop-timer', 'Stop timer') + '</div>' : '')
        + '<div class="food-live-overall"><div><strong>Overall Progress</strong><span>Step ' + (index + 1) + ' of ' + steps.length + ' · ' + Math.round(((index + 1) / steps.length) * 100) + '%</span></div><progress max="' + steps.length + '" value="' + (index + 1) + '"></progress></div>'
        + '<button type="button" class="food-live-main-button" data-food-action="cook-speak">👩‍🍳 Cook This Recipe (Live) &nbsp; 🔊</button></aside>';
    }
    function renderCookbookPreview(current, recipe) {
      if (!recipe) return '<aside class="food-live-panel"><div class="food-empty"><h3>Choose a recipe</h3><p>Tap a cookbook page to preview it here.</p></div></aside>';
      return '<aside class="food-live-panel food-recipe-preview"><div class="food-live-topbar"><strong>Recipe Preview</strong><span>🔖 &nbsp; ⋯</span></div>'
        + cookbookVisual(recipe, 'is-preview') + '<h2>' + esc(recipe.name) + '</h2><p class="food-live-meta">Serves: ' + esc(fmt(recipe.servings)) + (recipe.time_text ? ' &nbsp; | &nbsp; Time: ' + esc(recipe.time_text) : '') + '</p>'
        + '<p class="food-help">' + esc((recipe.instructions || '').split(/\s+/).slice(0, 42).join(' ')) + ((recipe.instructions || '').split(/\s+/).length > 42 ? '…' : '') + '</p>'
        + recipeCostMarkup(recipe, current, true)
        + '<div class="food-preview-actions">' + button('cook-recipe', '▶ Cook Live', ' data-id="' + esc(recipe.id) + '"', true) + button('cookbook-recipe', 'Open full recipe', ' data-id="' + esc(recipe.id) + '"') + '</div></aside>';
    }
    function cookbookThumbStyle(number) {
      const index = Math.max(0, Math.min(44, Number(number) - 1));
      const col = index % 5, row = Math.floor(index / 5);
      return '--cookbook-x:' + (col * 25) + '%;--cookbook-y:' + (row * 12.5) + '%;';
    }
    function renderCookbook(current) {
      const cookbook = (current.recipes || [])
        .filter(recipe => !recipe.archived && cookbookNumber(recipe))
        .sort((a,b) => cookbookNumber(a) - cookbookNumber(b));
      if (!cookbook.length) {
        return '<section class="panel"><div class="food-empty"><h2>Cookbook is still loading</h2><p>The digital cookbook uses the saved Food In Bloom recipes. Refresh after the cookbook recipes finish importing.</p></div></section>';
      }
      const selected = cookbook.find(recipe => recipe.id === cookbookSelectedRecipeId) || cookbook[0];
      cookbookSelectedRecipeId = selected.id;
      const number = cookbookNumber(selected);
      const page = COOKBOOK_PAGES[number] || '';
      const categories = [...new Set(cookbook.map(recipe => recipe.category_label || 'Other'))];
      let html = '<section class="food-digital-cookbook" id="food-cookbook-top">'
        + '<header class="food-digital-cookbook-header"><div><p class="page-kicker">Food In Bloom · Digital Cookbook</p><h1>Cookbook</h1><p>All 45 cookbook recipes, rebuilt as a readable part of the app. Choose a recipe to see the full ingredients, directions, nutrition, source notes, planning tools, and live cooking.</p></div>'
        + '<div class="food-digital-cookbook-stats"><strong>45</strong><span>recipes</span><strong>56</strong><span>original pages</span></div></header>'
        + '<div class="food-digital-cookbook-tools"><label class="food-field"><span>Find a cookbook recipe</span><input type="search" data-food-search value="' + esc(search) + '" placeholder="Search title, category, or recipe"></label>'
        + '<div class="food-cookbook-category-pills">' + categories.map(category => '<button type="button" data-food-action="cookbook-category" data-category="' + esc(category) + '">' + esc(category) + '</button>').join('') + '</div></div>'
        + '<div class="food-digital-cookbook-layout"><div class="food-digital-cookbook-list"><div class="food-cookbook-native-grid">';
      const matches = cookbook.filter(recipe => {
        const q = String(search || '').trim().toLowerCase();
        if (!q) return true;
        return [recipe.name, recipe.category_label, recipe.source_name, recipe.notes].some(value => String(value || '').toLowerCase().includes(q));
      });
      html += matches.map(recipe => {
        const n = cookbookNumber(recipe), p = COOKBOOK_PAGES[n] || '';
        return '<article class="food-cookbook-native-card' + (recipe.id === selected.id ? ' is-selected' : '') + '">'
          + '<button type="button" class="food-cookbook-native-select" data-food-action="cookbook-select" data-id="' + esc(recipe.id) + '">'
          + '<div class="food-cookbook-native-thumb" style="' + cookbookThumbStyle(n) + '"><span>Recipe ' + String(n).padStart(2,'0') + '</span></div>'
          + '<div class="food-cookbook-native-copy"><small>' + esc(recipe.category_label || 'Cookbook') + ' · Original p. ' + esc(p) + '</small><h3>' + esc(recipe.name) + '</h3><p>' + esc(fmt(recipe.servings)) + ' servings' + (recipe.time_text ? ' · ' + esc(recipe.time_text) : '') + '</p></div></button>'
          + '<div class="food-cookbook-native-actions">' + button('cookbook-recipe','Recipe',' data-id="' + esc(recipe.id) + '"') + button('cook-recipe','▶ Cook',' data-id="' + esc(recipe.id) + '"',true) + '</div></article>';
      }).join('');
      if (!matches.length) html += '<div class="food-empty"><h3>No cookbook recipes match that search</h3><p>Try another recipe name or clear the search box.</p></div>';
      html += '</div></div><aside class="food-cookbook-native-detail">'
        + '<div class="food-cookbook-detail-hero"><div class="food-cookbook-native-thumb is-large" style="' + cookbookThumbStyle(number) + '"></div>'
        + '<div><span class="food-date-badge">Recipe ' + String(number).padStart(2,'0') + ' · Original page ' + esc(page) + '</span><h2>' + esc(selected.name) + '</h2><p>' + esc(selected.category_label || '') + (selected.time_text ? ' · ' + esc(selected.time_text) : '') + '</p></div></div>'
        + recipeCostMarkup(selected,current,true)
        + '<div class="food-cookbook-detail-actions">' + button('cookbook-recipe','Open full recipe',' data-id="' + esc(selected.id) + '"') + button('cook-recipe','▶ Cook Live',' data-id="' + esc(selected.id) + '"',true) + button('plan-recipe','Plan this meal',' data-id="' + esc(selected.id) + '"') + '</div>'
        + '<details open><summary>Ingredients</summary><p class="food-prose">' + esc(selected.ingredient_text || 'Ingredient list is not recorded.') + '</p></details>'
        + '<details open><summary>Cooking instructions</summary><p class="food-prose">' + esc(selected.instructions || 'Instructions are not recorded.') + '</p></details>'
        + nutritionTable(M.recipeNutrition(selected,current.products || [],1),'Nutrition per serving')
        + (selected.source_name ? '<p class="food-help"><strong>Source:</strong> ' + esc(selected.source_name) + '</p>' : '')
        + (selected.notes ? '<p class="food-help food-prose">' + esc(selected.notes) + '</p>' : '')
        + '</aside></div></section>';
      return html;
    }

    function renderRecipes(current) {
      const recipes = (current.recipes || []).filter(recipe => !recipe.archived && String(recipe.name).toLowerCase().includes(search.toLowerCase()));
      let html = '<section class="panel" id="food-recipes-top"><div class="food-heading"><div><p class="page-kicker">Your recipe collection</p><h2>Recipes you come back to</h2></div>' + button('new-recipe', '+ Save a recipe', '', true) + '</div><label class="food-field food-search" for="food-recipe-search"><span>Find a saved recipe</span><input id="food-recipe-search" type="search" data-food-search value="' + esc(search) + '" placeholder="Search your recipes"></label>';
      if (dirty('recipe') && !editor) html += '<p class="food-help">You have a recipe draft.</p>' + button('resume-recipe', 'Resume recipe draft');
      if (dirty('plan') || planAttempt) html += '<p class="food-help">You have a meal plan to finish.</p>' + button('resume-plan', 'Resume meal plan');
      if (!recipes.length) html += '<div class="food-empty"><span aria-hidden="true">📖</span><h3>' + (search ? 'No matching recipes' : 'Start with a recipe you know') + '</h3><p>Save its ingredients and the number of servings. Then you can log a different portion for each person and find it when an ingredient needs using.</p></div>';
      else html += '<div class="food-recipe-grid">' + recipes.map(recipe => '<article class="food-recipe-card" id="food-recipe-card-' + esc(recipe.id) + '">' + (recipe.category_label || recipe.time_text ? '<p class="food-recipe-meta">' + [recipe.category_label, recipe.time_text].filter(Boolean).map(esc).join(' · ') + '</p>' : '') + '<h3>' + esc(recipe.name) + '</h3><p>' + esc(fmt(recipe.servings)) + ' servings' + ((recipe.planning_ingredients || []).length ? ' · ' + recipe.planning_ingredients.length + ' ingredients' : '') + '</p><div class="food-nutrition-brief">' + briefNutrition(M.recipeNutrition(recipe, current.products || [], 1)) + '</div>' + recipeCostMarkup(recipe, current, true) + allergyNotice(recipe, current) + '<div class="food-actions">' + button('plan-recipe', 'Plan this meal', ' data-id="' + esc(recipe.id) + '"', true, Boolean(planAttempt)) + button('view-recipe', 'Open recipe', ' data-id="' + esc(recipe.id) + '"') + button('log-recipe', 'Log a portion', ' data-id="' + esc(recipe.id) + '" data-person="1"') + '</div></article>').join('') + '</div>';
      html += '</section>';
      if (editor) html += renderRecipeForm(current);
      else {
        const opened = (current.recipes || []).find(recipe => recipe.id === openedRecipeId && !recipe.archived);
        if (opened) html += renderRecipeDetail(current, opened);
      }
      return html;
    }
    function renderSoon(current) {
      const today = dayKey(getNow()), inventory = current.inventory || [];
      const due = M.dueItems(inventory, today);
      const suggestions = M.recipeSuggestions(current.recipes || [], current.products || [], inventory, today);
      const unknown = inventory.filter(item => Number(item.quantity) > 0 && !M.effectiveDate(item));
      let html = '<section class="panel"><div class="food-heading"><div><p class="page-kicker">A little less waste</p><h2>Food dates to check</h2></div>' + button('grocery', 'Edit food & dates', ' data-tab="inventory"') + '</div><p class="food-help">Reminders use the package or freezer dates you recorded. Freezing does not automatically create a new date. Review the package and storage instructions before using a food.</p>';
      if (!due.length) html += '<div class="food-empty"><h3>No recorded dates are due soon</h3><p>Each food’s reminder window is set in Food at home. Foods without dates are listed below.</p></div>';
      else html += '<ul class="food-due-list">' + due.map(item => '<li class="food-due-item' + (item.status === 'overdue' ? ' is-overdue' : '') + '"><div><span class="food-date-badge">' + (item.status === 'overdue' ? 'Past recorded date · review' : item.status === 'today' ? 'Date is today' : 'In ' + item.days_until + ' days') + '</span><h3>' + esc(item.name) + '</h3><p>' + esc(fmt(item.quantity)) + ' ' + esc(item.unit) + ' · ' + esc(item.location || 'Storage not recorded') + '</p><p><strong>' + esc(item.date_label) + ':</strong> ' + dateLabel(item.due_on) + '</p>' + (item.frozen_on ? '<p>Frozen ' + dateLabel(item.frozen_on) + '</p>' : '') + (item.opened_on ? '<p>Opened ' + dateLabel(item.opened_on) + '</p>' : '') + '</div><div class="food-actions">' + button('calendar', 'Add calendar reminder', ' data-id="' + esc(item.id) + '"') + '</div></li>').join('') + '</ul>';
      if (unknown.length) html += '<details class="food-date-unknown"><summary>' + unknown.length + ' food' + (unknown.length === 1 ? '' : 's') + ' without a recorded date</summary><ul>' + unknown.map(item => '<li>' + esc(item.name) + ' · ' + esc(fmt(item.quantity)) + ' ' + esc(item.unit) + '</li>').join('') + '</ul>' + button('grocery', 'Add missing dates', ' data-tab="inventory"') + '</details>';
      html += '<p class="food-help">Calendar reminder downloads are imported into your own calendar. Notification delivery depends on that calendar’s settings.</p></section><section class="panel"><p class="page-kicker">From your saved recipes</p><h2>Ideas for the food coming up</h2><p class="food-help">These matches use linked catalog ingredients and current quantities. They do not reserve stock, confirm food safety, or replace checking allergies and restrictions.</p>';
      if (!suggestions.length) html += '<div class="food-empty"><h3>No saved recipe matches yet</h3><p>Link foods to catalog products and add those products to a saved recipe. Foods already past their recorded date are excluded from these suggestions.</p>' + button('tab', 'Open saved recipes', ' data-tab="recipes"') + '</div>';
      else html += '<div class="food-recipe-grid">' + suggestions.map(suggestion => {
        let review = suggestion.written_ingredients_unverified ? '<p class="food-help">Check the written ingredient list for any foods not linked yet.</p>' : '';
        if (suggestion.complete_stock) review += '<p>Recorded quantities cover this recipe. Check the actual food before cooking.</p>';
        else if (suggestion.missing_ingredients.length) review += '<p><strong>Recommended to buy or review:</strong></p><ul>' + suggestion.missing_ingredients.map(item => '<li>' + esc(item.name) + ' — ' + (item.quantity == null ? 'amount needs review' : esc(fmt(item.quantity)) + ' ' + esc(item.unit)) + (item.packs != null && item.packs > 0 ? ' · ' + esc(item.packs) + ' package' + (item.packs === 1 ? '' : 's') : '') + (item.estimate_cents != null ? ' · ' + money(item.estimate_cents) : '') + (item.reason ? ' · ' + esc(item.reason) : '') + '</li>').join('') + '</ul>';
        return '<article class="food-recipe-card">' + (suggestion.recipe.time_text ? '<p class="food-recipe-meta">' + esc(suggestion.recipe.time_text) + '</p>' : '') + '<h3>' + esc(suggestion.name) + '</h3><p><strong>Uses soon:</strong> ' + [...new Set(suggestion.matching_items.map(item => item.name))].map(esc).join(', ') + '</p>' + recipeCostMarkup(suggestion.recipe, current, true) + allergyNotice(suggestion.recipe, current) + review + '<p class="food-help">Plan this meal to send its reviewed shortages to Grocery.</p><div class="food-actions">' + button('plan-recipe', 'Plan this meal', ' data-id="' + esc(suggestion.recipe_id) + '"', true, Boolean(planAttempt)) + button('view-recipe', 'Open recipe', ' data-id="' + esc(suggestion.recipe_id) + '"') + '</div></article>';
      }).join('') + '</div>';
      return html + '</section>';
    }
    function logNutrition(current) {
      const value = drafts.log, servings = Number(value.servings);
      const sameSource = value.source_kind === 'recipe' ? value.recipe_id && value.recipe_id === value.original_recipe_id : value.product_id && value.product_id === value.original_product_id;
      if (sameSource && value.nutrition_original && Number(value.original_servings) > 0) return scaledSnapshot(value.nutrition_original, servings / Number(value.original_servings));
      return value.source_kind === 'recipe' ? M.recipeNutrition((current.recipes || []).find(row => row.id === value.recipe_id), current.products || [], servings) : M.productNutrition((current.products || []).find(row => row.id === value.product_id), servings);
    }
    function renderLogForm(current) {
      const value = drafts.log;
      const recipes = (current.recipes || []).filter(row => !row.archived || row.id === value.recipe_id);
      const products = (current.products || []).filter(row => row.category !== 'household' && (!row.archived || row.id === value.product_id));
      const source = value.source_kind === 'recipe' ? recipes.find(row => row.id === value.recipe_id) : products.find(row => row.id === value.product_id);
      let html = '<section class="panel food-log-panel"><p class="page-kicker">One person, one portion</p><h2>' + (value.id ? 'Edit food entry' : 'Add a food entry') + '</h2><p class="food-help">Choose Planned for a meal you intend to have, or Eaten for the portion actually eaten. Saving this entry updates nutrition; it does not record a purchase or change stock.</p><form id="food-log-form" class="food-form" data-food-form="log"><div class="food-person-choice" role="group" aria-label="Choose person">' + [1, 2].map(person => '<button type="button" class="food-person-' + (person === 1 ? 'pink' : 'purple') + '" data-food-action="choose-person" data-person="' + person + '" aria-pressed="' + (String(person) === String(value.person_slot)) + '"' + (busy ? ' disabled' : '') + '>Person ' + person + '</button>').join('') + '</div><div class="food-form-grid">' + field('log', 'occurred_on', 'Date', 'date', ' required min="1900-01-01" max="2200-12-31"') + '<label class="food-field" for="food-log-kind"><span>What are you recording?</span><select id="food-log-kind" name="kind" data-food-field="log.kind"' + (busy ? ' disabled' : '') + '><option value="eaten"' + (value.kind === 'eaten' ? ' selected' : '') + '>Actually eaten</option><option value="planned"' + (value.kind === 'planned' ? ' selected' : '') + '>Planned meal</option></select></label><label class="food-field" for="food-log-source_kind"><span>Choose from</span><select id="food-log-source_kind" name="source_kind" data-food-field="log.source_kind"' + (busy ? ' disabled' : '') + '><option value="recipe"' + (value.source_kind === 'recipe' ? ' selected' : '') + '>Saved recipes</option><option value="product"' + (value.source_kind === 'product' ? ' selected' : '') + '>Food & beverage catalog</option></select></label>';
      const sourceKey = value.source_kind === 'recipe' ? 'recipe_id' : 'product_id';
      html += '<label class="food-field" for="food-log-' + sourceKey + '"><span>' + (sourceKey === 'recipe_id' ? 'Recipe' : 'Product') + '</span><select id="food-log-' + sourceKey + '" name="' + sourceKey + '" data-food-field="log.' + sourceKey + '" required' + (busy ? ' disabled' : '') + '><option value="">Choose one</option>' + (sourceKey === 'recipe_id' ? recipes : products).map(row => '<option value="' + esc(row.id) + '"' + (row.id === value[sourceKey] ? ' selected' : '') + '>' + esc(row.name) + '</option>').join('') + '</select></label>' + field('log', 'servings', 'Number of servings for this person', 'number', ' min="0.000001" max="10000" step="any" required') + '</div>';
      if (source) {
        html += '<p class="food-help">' + (sourceKey === 'recipe_id' ? 'One serving is 1 of the ' + esc(fmt(source.servings)) + ' servings made by the recipe.' : source.serving_quantity != null ? 'One label serving is ' + esc(fmt(source.serving_quantity)) + ' ' + esc(source.serving_unit) + (source.item_label ? ' · ' + esc(source.item_label) : '') + '.' : 'This product has no serving basis yet. Add it in the catalog before relying on nutrition totals.') + '</p>';
        html += allergyNotice(sourceKey === 'recipe_id' ? source : { ingredients: [{ product_id: source.id }] }, current, Number(value.person_slot));
        html += '<details class="food-nutrition-preview"><summary>Nutrition for this portion</summary><div id="food-log-nutrition-values">' + nutritionTable(logNutrition(current), 'This person’s portion') + '</div></details>';
      }
      html += personalNotes(current, Number(value.person_slot)) + textarea('log', 'notes', 'Notes (optional)', 4000) + '<div class="food-actions"><button type="submit" class="button primary"' + (busy || current.offline ? ' disabled' : '') + '>' + (value.id ? 'Save changes' : value.kind === 'planned' ? 'Save planned portion' : 'Log eaten portion') + '</button>' + button('discard-log', 'Discard food draft') + '</div>' + draftStatus('log') + '</form></section>';
      return html;
    }
    function renderEntries(current) {
      const entries = (current.mealEntries || []).filter(row => row.occurred_on === selectedDate).sort((a, b) => Number(a.person_slot) - Number(b.person_slot) || String(a.created_at).localeCompare(String(b.created_at)));
      if (!entries.length) return '<section class="panel food-empty"><h3>No food entries for this date</h3><p>Add a planned or eaten portion. An empty day is not treated as zero intake.</p></section>';
      return '<section class="panel"><h2>Food entries · ' + dateLabel(selectedDate) + '</h2><ul class="food-entry-list">' + entries.map(entry => '<li class="food-person-' + (Number(entry.person_slot) === 2 ? 'purple' : 'pink') + '"><div><span class="food-date-badge">Person ' + Number(entry.person_slot) + ' · ' + (entry.kind === 'planned' ? 'Planned' : 'Eaten') + '</span><h3>' + esc(entry.label) + '</h3><p>' + esc(fmt(entry.servings)) + ' serving' + (Number(entry.servings) === 1 ? '' : 's') + '</p><div class="food-nutrition-brief">' + briefNutrition(entry.nutrition_snapshot || M.nutritionTotals([])) + '</div>' + (entry.notes ? '<p class="food-prose">' + esc(entry.notes) + '</p>' : '') + '</div><div class="food-actions">' + (entry.kind === 'planned' ? button('eaten-from-plan', 'Log an eaten portion', ' data-id="' + esc(entry.id) + '"') : '') + button('edit-log', 'Edit', ' data-id="' + esc(entry.id) + '"') + button('delete-log', 'Delete entry', ' data-id="' + esc(entry.id) + '"', false, current.offline) + '</div></li>').join('') + '</ul></section>';
    }
    function datePicker() { return '<label class="food-field food-day-picker" for="food-selected-date"><span>Nutrition date</span><input id="food-selected-date" type="date" data-food-date value="' + esc(selectedDate) + '" min="1900-01-01" max="2200-12-31"></label>'; }
    function expiryGroups(current){const today=dayKey(getNow()),base=M.dateNumber(today),groups={today:0,three:0,seven:0,later:0};for(const item of current.inventory||[]){if(Number(item.quantity)<=0)continue;const due=M.effectiveDate(item);if(!due)continue;const days=M.dateNumber(due.date)-base;if(days<=0)groups.today++;else if(days<=3)groups.three++;else if(days<=7)groups.seven++;else groups.later++;}return groups;}
    function renderFoodHome(current){
      const groups=expiryGroups(current),inventory=(current.inventory||[]).filter(row=>Number(row.quantity)>0),list=(current.shoppingItems||[]).filter(row=>!row.checked),plans=(current.cookingPlans||[]).filter(row=>row.status==='planned'&&row.cook_on>=dayKey(getNow())),recipes=(current.recipes||[]).filter(row=>!row.archived);
      return '<section class="food-hub"><div class="food-hub-intro"><p class="page-kicker">Your kitchen, connected</p><h2>Food in Bloom</h2><p>Start with what you need to buy, then plan meals around what is already at home.</p></div><div class="food-hub-grid">'+
      '<button type="button" class="food-hub-card is-primary" data-food-action="grocery" data-tab="list"><span aria-hidden="true">🛒</span><strong>Shopping List</strong><small>'+list.length+' item'+(list.length===1?'':'s')+' to buy · your main Food action</small></button>'+
      '<button type="button" class="food-hub-card" data-food-action="grocery" data-tab="inventory"><span aria-hidden="true">🧺</span><strong>Food at Home</strong><small>'+inventory.length+' inventory entries · pantry, refrigerator & freezer</small></button>'+
      '<button type="button" class="food-hub-card" data-food-action="tab" data-tab="plans"><span aria-hidden="true">🗓️</span><strong>Menu</strong><small>'+plans.length+' upcoming planned meal'+(plans.length===1?'':'s')+' · meal and shopping costs</small></button>'+
      '<button type="button" class="food-hub-card" data-food-action="tab" data-tab="cookbook"><span aria-hidden="true">📕</span><strong>Cookbook</strong><small>Browse all 45 cookbook recipes in book order</small></button>'+
      '<button type="button" class="food-hub-card" data-food-action="tab" data-tab="recipes"><span aria-hidden="true">📖</span><strong>Recipes</strong><small>'+recipes.length+' saved recipe'+(recipes.length===1?'':'s')+'</small></button>'+
      '<button type="button" class="food-hub-card" data-food-action="tab" data-tab="cooking"><span aria-hidden="true">🍳</span><strong>Cooking</strong><small>What can I cook? · what should I buy?</small></button></div>'+
      '<button type="button" class="food-expiring-summary" data-food-action="tab" data-tab="soon"><span><strong>Expiring Soon</strong><small>Today '+groups.today+' · next 3 days '+groups.three+' · next 7 days '+groups.seven+'</small></span><span aria-hidden="true">›</span></button></section>';
    }
    function renderCooking(current) {
      const rows = M.recipeReadiness ? M.recipeReadiness(current.recipes || [], current.products || [], current.inventory || [], dayKey(getNow())) : [];
      const groups = { ready: rows.filter(row => row.status === 'ready'), almost: rows.filter(row => row.status === 'almost'), need: rows.filter(row => row.status === 'need') };
      const cards = (items, emptyText) => items.length ? '<div class="food-recipe-grid">' + items.map(item => {
        const missing = item.missing || [];
        let recommendation = item.status === 'ready'
          ? '<p><strong>Ready from recorded stock.</strong> Check the actual food and dates before cooking.</p>'
          : '<p><strong>' + missing.length + ' ingredient' + (missing.length === 1 ? '' : 's') + ' to buy or review.</strong></p>';
        if (missing.length) recommendation += '<ul class="food-mini-buy-list">' + missing.slice(0, 6).map(row => '<li><span>' + esc(row.name) + '</span><span>' + (row.packs != null && row.packs > 0 ? esc(row.packs) + ' pkg' : row.quantity == null ? 'Review' : esc(fmt(row.quantity)) + ' ' + esc(row.unit || '')) + (row.estimate_cents != null ? ' · ' + money(row.estimate_cents) : '') + '</span></li>').join('') + '</ul>';
        return '<article class="food-recipe-card">' + (item.recipe.category_label || item.recipe.time_text ? '<p class="food-recipe-meta">' + [item.recipe.category_label, item.recipe.time_text].filter(Boolean).map(esc).join(' · ') + '</p>' : '') + '<h3>' + esc(item.name) + '</h3>' + recommendation + recipeCostMarkup(item.recipe, current, true) + '<div class="food-actions">' + button('view-recipe', 'Open recipe', ' data-id="' + esc(item.recipe_id) + '"') + button('plan-recipe', 'Plan this meal', ' data-id="' + esc(item.recipe_id) + '"', true, Boolean(planAttempt)) + '</div></article>';
      }).join('') + '</div>' : '<p class="food-help">' + emptyText + '</p>';
      const equipment = current.kitchenEquipment || [];
      return '<section class="panel"><p class="page-kicker">Cooking</p><h2>What Can I Cook?</h2><p class="food-help">Recipes are ranked from your recorded inventory. A recipe is only marked ready when its required linked amounts are covered.</p>' + cards(groups.ready, 'No recipe is fully covered by linked inventory yet.') + '</section>'
        + '<section class="panel"><h2>Almost Can Cook</h2><p class="food-help">These are the shortest paths to a meal. Use the buy suggestions below each recipe, then Plan this meal to add reviewed shortages to Grocery.</p>' + cards(groups.almost, 'No almost-ready recipes right now.') + '</section>'
        + '<section class="panel"><details><summary>More recipes needing ingredients · ' + groups.need.length + '</summary>' + cards(groups.need, 'No other recipes need ingredients.') + '</details></section>'
        + '<section class="panel"><div class="food-heading"><div><p class="page-kicker">Use it before it expires</p><h2>Cook with food coming up soon</h2></div>' + button('tab', 'See expiring food', ' data-tab="soon"') + '</div><p class="food-help">Expiring Soon ranks recipes that use the dated products first, then shows what else you would need to buy.</p></section>'
        + '<section class="panel"><p class="page-kicker">Kitchen Equipment</p><h2>Appliances & tools</h2><p class="food-help">Equipment is stored separately from food. Add brand/model only when you know it.</p><form class="food-form" data-food-form="equipment"><div class="food-form-grid"><label class="food-field"><span>Equipment name</span><input name="name" required maxlength="160"></label><label class="food-field"><span>Brand (optional)</span><input name="brand" maxlength="120"></label><label class="food-field"><span>Model (optional)</span><input name="model" maxlength="160"></label><label class="food-field"><span>Capabilities, comma-separated</span><input name="capabilities" maxlength="500" placeholder="pressure cook, sauté"></label></div><label class="food-field"><span>Notes</span><textarea name="notes" maxlength="4000"></textarea></label><button class="button primary" type="submit">+ Add equipment</button></form>'
        + (equipment.length ? '<ul class="food-equipment-list">' + equipment.filter(row => !row.archived).map(row => '<li><div><strong>' + esc(row.name) + '</strong><small>' + esc([row.brand,row.model].filter(Boolean).join(' · ') || 'Brand/model not recorded') + '</small><small>' + esc(Array.isArray(row.capabilities) ? row.capabilities.join(', ') : '') + '</small></div>' + button('delete-equipment','Remove',' data-id="' + esc(row.id) + '"') + '</li>').join('') + '</ul>' : '<p class="food-help">No kitchen equipment saved yet.</p>') + '</section>';
    }

    function renderWellness(current) {
      let html = '<section class="panel"><div class="food-heading"><div><p class="page-kicker">Household nutrition</p><h2>Each person’s day</h2></div>' + datePicker() + '</div><p class="food-help">Person 1 is pink. Person 2 is purple. Planned portions and actually eaten portions have separate totals. Your chosen goals remain editable in Grocery Profiles.</p><div class="food-actions">' + button('grocery', 'Nutrition profiles', ' data-tab="profiles"') + button('food-home', 'Saved recipes & food dates') + '</div></section><div class="food-person-grid">';
      for (const person of [1, 2]) {
        const profile = personProfile(current, person);
        const observed = actualNutrition(current, selectedDate, person), actual = observed.actual;
        const planned = (current.mealEntries || []).filter(entry => entry.person_slot === person && entry.occurred_on === selectedDate && entry.kind === 'planned');
        html += '<section class="panel food-person-' + (person === 1 ? 'pink' : 'purple') + '"><p class="page-kicker">Person ' + person + '</p><h2>' + esc(profile && profile.display_name || 'Your nutrition') + '</h2><dl class="food-goals">' + M.NUTRIENTS.slice(0, 5).map(nutrient => '<div><dt>' + nutrient.label + ' goal</dt><dd>' + (profile && profile[nutrient.key] != null ? esc(fmt(profile[nutrient.key])) + ' ' + nutrient.unit : 'Not set') + '</dd></div>').join('') + '</dl><h3>Actually eaten &amp; drunk</h3>' + (actual.length || observed.water.length ? '<div class="food-nutrition-brief">' + briefNutrition(observed.nutrition) + '</div><details><summary>All recorded nutrients</summary>' + nutritionTable(observed.nutrition, 'Eaten portions and logged water') + '</details>' : '<p class="food-help">No eaten portions logged for this date.</p>') + (observed.water.length ? '<p class="food-help">Includes ' + fmt(observed.waterMl) + ' mL from this person’s saved water entries.</p>' : '') + '<h3>Planned</h3>' + (planned.length ? '<div class="food-nutrition-brief">' + briefNutrition(M.nutritionTotals(planned)) + '</div><details><summary>All planned nutrients</summary>' + nutritionTable(M.nutritionTotals(planned), 'Planned portions') + '</details>' : '<p class="food-help">No planned portions for this date.</p>') + personalNotes(current, person) + '<div class="food-actions">' + button('new-log', 'Log for Person ' + person, ' data-person="' + person + '" data-kind="eaten"', true) + button('new-log', 'Plan a portion', ' data-person="' + person + '" data-kind="planned"') + '</div></section>';
      }
      html += '</div>';
      if (dirty('log') && !logging) html += '<section class="panel"><p>You have a food entry draft.</p>' + button('resume-log', 'Resume food draft') + '</section>';
      if (logging) html += renderLogForm(current);
      return html + renderEntries(current) + '<p class="food-help food-footnote">Nutrition comes from saved labels or clearly marked recipe estimates. Missing values and logged portions affect completeness. These are records and estimates, not prescribed intake.</p>';
    }
    function render(page) {
      currentPage = page === 'wellness' ? 'wellness' : 'food';
      const current = snapshot();
      let html = '<section class="food-page" aria-label="' + (currentPage === 'wellness' ? 'Household nutrition' : 'Food in Bloom') + '"' + (busy ? ' aria-busy="true"' : '') + '>';
      if (busy) html += '<p class="food-working" role="status">' + esc(busy.label) + '</p>';
      if (!current.user || !current.household || current.status !== 'ready') return html + '<section class="panel food-empty"><h2>Food belongs to your household</h2><p>' + (current.status === 'loading' ? 'Opening your saved household records…' : 'Open Grocery to sign in or reconnect. Your recipes, food dates and nutrition records will appear here.') + '</p>' + button('grocery', 'Open Grocery', ' data-tab="list"', true) + '</section></section>';
      if (current.offline) html += '<p class="food-offline" role="status">Offline · showing the saved device copy. You can prepare a draft; reconnect to save changes online.</p>';
      if (currentPage === 'wellness') return html + renderWellness(current) + '</section>';
      const dueCount = M.dueItems(current.inventory || [], dayKey(getNow())).length;
      html += '<nav class="food-tabs" aria-label="Food sections">' + [['home','🌸','Food home'],['cookbook','📕','Cookbook'],['recipes','📖','Recipes'],['plans','🗓️','Menu'],['cooking','🍳','Cooking'],['soon','🌱','Use soon'+(dueCount?' · '+dueCount:'')],['log','🍽️','Food log']].map(([value, icon, label]) => '<button type="button" data-food-action="tab" data-tab="' + value + '"' + (tab === value ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + icon + '</span> ' + esc(label) + '</button>').join('') + '</nav>';
      if (tab === 'home') html += renderFoodHome(current);
      else if (tab === 'cookbook') html += renderCookbook(current);
      else if (tab === 'recipes') html += renderRecipes(current);
      else if (tab === 'plans') html += renderPlans(current);
      else if (tab === 'cooking') html += renderCooking(current);
      else if (tab === 'soon') html += renderSoon(current);
      else {
        html += '<section class="panel"><div class="food-heading"><h2>Your food log</h2>' + datePicker() + '</div><div class="food-actions">' + button('new-log', '+ Add a food entry', ' data-person="1" data-kind="eaten"', true) + button('wellness', 'See nutrition by person') + (dirty('log') ? button('resume-log', 'Resume food draft') : '') + '</div></section>';
        if (logging) html += renderLogForm(current);
        html += renderEntries(current);
      }
      return html + '</section>';
    }
    function readForm(form, group) {
      const get = name => form.elements && typeof form.elements.namedItem === 'function' ? form.elements.namedItem(name) : null;
      if (group === 'plan' && planAttempt) return;
      if (group === 'plan') {
        const recipeElement = get('recipe_id');
        if (recipeElement && recipeElement.value !== drafts.plan.recipe_id && !drafts.plan.id) setPlanRecipe(snapshot(), recipeElement.value);
      }
      for (const key of group === 'recipe' ? RECIPE_FIELDS : group === 'plan' ? PLAN_FIELDS : LOG_FIELDS) { const element = get(key); if (element && typeof element.value === 'string' && !(group === 'plan' && key === 'recipe_id')) drafts[group][key] = element.value; }
      if (group === 'recipe') {
        for (let index = 0; index < drafts.recipe.ingredients.length; index++) for (const part of ['product_id', 'quantity', 'unit']) { const element = get('ingredient_' + index + '_' + part); if (element && typeof element.value === 'string') drafts.recipe.ingredients[index][part] = element.value; }
        drafts.recipe.nutrition_reference = referenceDraft(drafts.recipe.nutrition_reference);
        for (const { key } of M.NUTRIENTS) {
          const element = get('nutrition_reference_' + key);
          if (element && typeof element.value === 'string') drafts.recipe.nutrition_reference[key] = element.value;
        }
      }
      if (group === 'recipe' || group === 'plan') {
        const rows = group === 'recipe' ? drafts.recipe.planning_ingredients : drafts.plan.ingredients;
        for (let index = 0; index < rows.length; index++) for (const part of ['name', 'quantity', 'unit', 'product_id', 'notes', group === 'recipe' ? 'optional' : 'included']) {
          const element = get('planning_' + index + '_' + part);
          if (!element) continue;
          if (part === 'optional' || part === 'included') { if (typeof element.checked === 'boolean') rows[index][part] = element.checked; }
          else if (typeof element.value === 'string') rows[index][part] = element.value;
        }
      }
    }
    function validatedShoppingIngredients(current, rows, forPlan) {
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('Use up to 100 shopping ingredients.');
      return rows.flatMap((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Review shopping ingredient ' + (index + 1) + '.');
        const untouched = ['name', 'quantity', 'unit', 'product_id', 'notes'].every(key => !String(item[key] == null ? '' : item[key]).trim());
        if (untouched && !item.optional && item.included !== false) return [];
        const name = text(item.name, 'Shopping ingredient ' + (index + 1), 160, true);
        const amount = item.quantity == null || String(item.quantity).trim() === '' ? null : quantity(item.quantity, name + ' amount', 1000000000);
        const unit = text(item.unit, name + ' unit', 30, amount != null);
        const productId = String(item.product_id || '').trim() || null;
        if (productId && !(current.products || []).some(product => product.id === productId && product.category !== 'household')) throw new Error('Choose an available Food product for ' + name + ', or leave its catalog link blank.');
        const row = { name, quantity: amount, unit, product_id: productId, optional: item.optional === true, notes: text(item.notes, name + ' notes', 1000, false) };
        if (forPlan) row.included = item.included !== false;
        return [row];
      });
    }
    function recipePayload(current) {
      const value = drafts.recipe;
      const name = text(value.name, 'Recipe name', 160, true), servings = quantity(value.servings, 'Recipe servings', 10000);
      const ingredientText = text(value.ingredient_text, 'Ingredients as written', 12000, false);
      if (!Array.isArray(value.ingredients) || value.ingredients.length > 100) throw new Error('Link up to 100 catalog ingredients.');
      const ingredients = value.ingredients.flatMap((item, index) => {
        if (!item || typeof item !== 'object') throw new Error('Review catalog ingredient ' + (index + 1) + '.');
        if (!String(item.product_id || '').trim() && !String(item.quantity == null ? '' : item.quantity).trim() && item.unit === 'each') return [];
        const product = (current.products || []).find(row => row.id === item.product_id && row.category !== 'household');
        if (!product) throw new Error('Choose a catalog food for ingredient ' + (index + 1) + '.');
        if (!M.UNITS.some(unit => unit.value === item.unit)) throw new Error('Choose a supported unit for ingredient ' + (index + 1) + '.');
        return [{ product_id: product.id, quantity: quantity(item.quantity, 'Ingredient amount', 1000000000), unit: item.unit }];
      });
      const planningIngredients = validatedShoppingIngredients(current, value.planning_ingredients, false);
      if (!ingredientText && !ingredients.length && !planningIngredients.length) throw new Error('Write the ingredient list or link at least one catalog food, or add shopping ingredients.');
      const nutritionMode = value.nutrition_mode == null ? 'ingredients' : value.nutrition_mode;
      if (!['ingredients', 'reference'].includes(nutritionMode)) throw new Error('Choose how this recipe’s nutrition is calculated.');
      const nutritionSource = text(value.nutrition_source, 'Estimate source and assumptions', 2000, nutritionMode === 'reference');
      const nutritionReference = Object.fromEntries(M.NUTRIENTS.map(({ key, label }) => [key, referenceNumber(value.nutrition_reference && value.nutrition_reference[key], label + ' for the whole recipe')]));
      const link = text(value.source_url, 'Recipe link', 2048, false);
      if (link && !safeUrl(link)) throw new Error('Use a full http or https recipe link.');
      return { id: value.id, request_id: value.request_id, revision: value.revision, name, servings, ingredient_text: ingredientText, ingredients, planning_ingredients: planningIngredients, instructions: text(value.instructions, 'Instructions', 20000, false), source_url: link, notes: text(value.notes, 'Notes', 4000, false), nutrition_mode: nutritionMode, nutrition_reference: nutritionReference, nutrition_source: nutritionSource, archived: false };
    }
    function logPayload(current) {
      const value = drafts.log;
      if (M.dateNumber(value.occurred_on) == null) throw new Error('Choose a valid food-entry date.');
      const person = Number(value.person_slot);
      if (![1, 2].includes(person)) throw new Error('Choose Person 1 or Person 2.');
      if (!['planned', 'eaten'].includes(value.kind)) throw new Error('Choose Planned or Eaten.');
      if (!['recipe', 'product'].includes(value.source_kind)) throw new Error('Choose a saved recipe or catalog food.');
      const servings = quantity(value.servings, 'This person’s servings', 10000);
      const isRecipe = value.source_kind === 'recipe';
      const source = (isRecipe ? current.recipes || [] : current.products || []).find(row => row.id === (isRecipe ? value.recipe_id : value.product_id));
      if (!source || (!isRecipe && source.category === 'household')) throw new Error('Choose a saved recipe or catalog food.');
      const sameSource = isRecipe ? value.recipe_id === value.original_recipe_id : value.product_id === value.original_product_id;
      const nutrition = logNutrition(current);
      if (!nutrition) throw new Error('This portion could not be calculated. Check its serving amount.');
      return { id: value.id, request_id: value.request_id, revision: value.revision, occurred_on: value.occurred_on, person_slot: person, kind: value.kind, recipe_id: isRecipe ? source.id : null, product_id: isRecipe ? null : source.id, servings, label: sameSource && value.original_label ? value.original_label : source.name, nutrition_snapshot: nutrition, notes: text(value.notes, 'Notes', 4000, false) };
    }
    function setPlanRecipe(current, recipeId) {
      const recipe = (current.recipes || []).find(row => row.id === recipeId && !row.archived);
      drafts.plan.recipe_id = recipe ? recipe.id : '';
      drafts.plan.recipe_revision = recipe ? recipe.revision : null;
      drafts.plan.recipe_name = recipe ? recipe.name : '';
      drafts.plan.base_servings = recipe ? recipe.servings : null;
      drafts.plan.ingredients = planningRows(recipe, current.products || []);
      planIngredientsOpen = !drafts.plan.ingredients.length;
      if (!String(drafts.plan.servings || '').trim()) drafts.plan.servings = recipe ? String(recipe.servings) : '';
      return recipe;
    }
    function savedPlanDraft(row) {
      const value = planDraft(dayKey(getNow()));
      for (const key of Object.keys(value)) if (Object.hasOwn(row, key)) value[key] = copy(row[key]);
      value.request_id = uuid();
      value.person1_servings = row.person1_servings == null ? '' : row.person1_servings;
      value.person2_servings = row.person2_servings == null ? '' : row.person2_servings;
      value.ingredients = (row.ingredients || []).map(item => ({ ...shoppingIngredientDraft(), ...copy(item), quantity: item.quantity == null ? '' : item.quantity, product_id: item.product_id || '', included: Object.hasOwn(item, 'included') ? item.included !== false : item.optional !== true }));
      return value;
    }
    function openPlan(current, recipe, row) {
      if (planAttempt) { tab = 'plans'; planning = planAttempt.action === 'save'; notify('Finish confirming the pending meal request first. Its exact details are kept.', true); persist(); refresh(); return false; }
      if (row && (row.status !== 'planned' || row.cook_on < dayKey(getNow()))) throw new Error('This saved meal is in history. Plan the recipe again for a new date.');
      if (row && drafts.plan.id === row.id && dirty('plan')) { planning = true; tab = 'plans'; persist(); refresh('#food-plan-form'); return true; }
      if (dirty('plan') && !confirm('Open this meal and discard your current meal-plan draft?')) return false;
      resetGroup('plan', row ? savedPlanDraft(row) : planDraft(dayKey(getNow())));
      if (!row && recipe) { setPlanRecipe(current, recipe.id); baselines.plan = copy(drafts.plan); }
      planning = true; tab = 'plans'; planProblem = ''; persist(); refresh('#food-plan-form'); return true;
    }
    function planPayload(current) {
      const value = drafts.plan;
      const recipe = (current.recipes || []).find(row => row.id === value.recipe_id && !row.archived);
      if (!recipe) throw new Error('Choose an available saved recipe.');
      if (!Number.isInteger(Number(value.recipe_revision)) || Number(value.recipe_revision) < 1) throw new Error('Reload the saved recipe before planning it.');
      if (M.dateNumber(value.cook_on) == null || value.cook_on < dayKey(getNow())) throw new Error('Choose today or a future cooking date.');
      const servings = quantity(value.servings, 'Servings to make', 10000);
      const person1 = portionDivision(value.person1_servings, 'Person 1 servings'), person2 = portionDivision(value.person2_servings, 'Person 2 servings');
      if ((person1 || 0) + (person2 || 0) > servings + 1e-9) throw new Error('The servings divided between people cannot exceed the total servings to make.');
      const ingredients = validatedShoppingIngredients(current, value.ingredients, true);
      if (!ingredients.some(item => item.included)) throw new Error('Include at least one named shopping ingredient. You can leave an uncertain amount blank for review.');
      const payload = { id: value.id || value.request_id, request_id: value.request_id, recipe_id: value.recipe_id, recipe_revision: Number(value.recipe_revision), cook_on: value.cook_on, meal_type: ['breakfast','lunch','dinner','snack'].includes(value.meal_type) ? value.meal_type : 'dinner', servings, person1_servings: person1, person2_servings: person2, notes: text(value.notes, 'Meal notes', 4000, false), ingredients };
      if (value.id) payload.revision = value.revision;
      return payload;
    }
    function submitPlanAttempt() {
      const current = snapshot(); ready(current);
      if (!planAttempt) throw new Error('Open a meal plan before saving.');
      const attempt = copy(planAttempt);
      if (attempt.action === 'save' && typeof store.saveCookingPlan !== 'function' || attempt.action === 'cancel' && typeof store.cancelCookingPlan !== 'function') throw new Error('Refresh the app to load the meal-planning tools.');
      run(attempt.action === 'save' ? 'Saving your meal and updating groceries…' : 'Cancelling the meal and updating groceries…', () => attempt.action === 'save' ? store.saveCookingPlan(copy(attempt.payload)) : store.cancelCookingPlan({ id: attempt.payload.id, revision: attempt.payload.revision }, attempt.payload.request_id), () => {
        planAttempt = null; planProblem = ''; tab = 'plans';
        if (attempt.action === 'save' || drafts.plan.id === attempt.payload.id) { resetGroup('plan', planDraft(dayKey(getNow()))); planning = false; }
        notify(attempt.action === 'save' ? 'Your meal was planned and its grocery needs were updated. Review any ingredients marked as needing details.' : 'The meal was cancelled and its unpurchased grocery needs were updated. Your purchases remain saved.');
      }, '#food-plans', error => {
        if (PLAN_REJECTIONS.has(String(error && error.code || ''))) {
          planAttempt = null;
          planProblem = attempt.action === 'save' && ['40001', '23505', '23514'].includes(String(error.code)) ? String(error.code) : '';
        }
      });
    }
    function reloadPlan(current) {
      ready(current);
      if (typeof store.refresh !== 'function') throw new Error('Refresh the browser to reload saved meal plans.');
      const attempt = planAttempt && copy(planAttempt);
      const targetId = attempt ? attempt.payload.id : drafts.plan.id || drafts.plan.request_id;
      if (!attempt && dirty('plan') && !confirm('Reload this saved meal? Your current meal draft will be replaced by its saved version.')) return false;
      run('Checking the saved meal…', () => store.refresh(), () => {
        const fresh = snapshot(); ready(fresh);
        const row = (fresh.cookingPlans || []).find(plan => plan.id === targetId);
        tab = 'plans';
        if (attempt && row && row.last_request_id === attempt.payload.request_id) {
          planAttempt = null; planProblem = '';
          if (attempt.action === 'save' || drafts.plan.id === attempt.payload.id) { resetGroup('plan', planDraft(dayKey(getNow()))); planning = false; }
          notify(row.status === 'cancelled' ? 'The cancellation was saved. Your grocery list is updated.' : 'Your meal was already saved. Its grocery list was updated once.');
        } else if (attempt && (!row || row.status === 'planned')) {
          notify('The pending result is not confirmed yet. Retry the same request; its details are still kept.', true);
        } else if (row && row.status === 'cancelled') {
          planAttempt = null; planProblem = '';
          if (!attempt || attempt.action === 'save' || drafts.plan.id === attempt.payload.id) { resetGroup('plan', planDraft(dayKey(getNow()))); planning = false; }
          notify('This meal was cancelled. Choose Plan this meal again to create a new plan.');
        } else if (row) {
          planProblem = ''; resetGroup('plan', savedPlanDraft(row)); planning = true;
          notify('The latest saved meal is open. Review its date, servings, and ingredients.');
        } else {
          planProblem = ''; drafts.plan.request_id = uuid(); drafts.plan.id = ''; drafts.plan.revision = null;
          notify('No saved meal was found. Your draft is kept for review before a new save.');
        }
      }, '#food-plans');
      return true;
    }
    function handleSubmit(event) {
      const form = event.target, kind = form && form.dataset && form.dataset.foodForm;
      if (!['recipe', 'log', 'plan', 'equipment'].includes(kind)) return false;
      event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        if (kind === 'equipment') { ready(current); const get=name=>form.elements&&form.elements.namedItem(name); const name=text(get('name')&&get('name').value,'Equipment name',160,true),brand=text(get('brand')&&get('brand').value,'Brand',120,false),modelName=text(get('model')&&get('model').value,'Model',160,false),notes=text(get('notes')&&get('notes').value,'Notes',4000,false),capabilities=String(get('capabilities')&&get('capabilities').value||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,30); run('Saving kitchen equipment…',()=>store.saveKitchenEquipment({request_id:uuid(),name,brand,model:modelName,capabilities,notes,archived:false}),()=>{form.reset();notify('Kitchen equipment saved.');}); return true; }
        readForm(form, kind); persist(); ready(current);
        if (kind === 'recipe') {
          const payload = recipePayload(current);
          run('Saving your recipe…', () => store.saveRecipe(payload), row => { resetGroup('recipe', recipeDraft()); editor = false; tab = 'recipes'; openedRecipeId = row && row.id || payload.id || payload.request_id; notify('Your recipe was saved for your household.'); });
        } else if (kind === 'plan') {
          if (!planAttempt) { planAttempt = { action: 'save', payload: planPayload(current) }; planProblem = ''; persist(); }
          submitPlanAttempt();
        } else {
          const payload = logPayload(current);
          run('Saving this portion…', () => store.saveMealEntry(payload), () => { selectedDate = payload.occurred_on; if (options.onDateChange) options.onDateChange(selectedDate); resetGroup('log', logDraft(selectedDate)); logging = false; if (currentPage === 'food') tab = 'log'; notify(payload.kind === 'planned' ? 'The planned portion was saved separately from eaten food.' : 'This person’s eaten portion was logged.'); });
        }
      } catch (error) { persist(); notify(error.message, true); refresh(); }
      return true;
    }
    function handleInput(event) {
      const element = event.target, data = element && element.dataset;
      if (!data) return false;
      const current = snapshot();
      if (Object.hasOwn(data, 'foodPdfPage')) {
        const page = Math.max(1, Math.min(56, Math.round(Number(element.value) || 1)));
        cookbookPdfPage = page; element.value = String(page); refresh('#food-cookbook-top'); return true;
      }
            if (Object.hasOwn(data, 'foodSearch')) { search = String(element.value || ''); refresh('#food-recipe-search'); return true; }
      if (Object.hasOwn(data, 'foodReference')) {
        if (!M.NUTRIENTS.some(({ key }) => key === data.foodReference)) return false;
        if (!busy) { drafts.recipe.nutrition_reference[data.foodReference] = element.value; persist(); }
        return true;
      }
      if (Object.hasOwn(data, 'foodPlanningGroup')) {
        const group = data.foodPlanningGroup, index = Number(data.foodPlanningIndex), part = data.foodPlanningPart;
        if (!['recipe', 'plan'].includes(group) || !Number.isInteger(index) || index < 0) return false;
        const rows = group === 'recipe' ? drafts.recipe.planning_ingredients : drafts.plan.ingredients;
        const allowed = ['name', 'quantity', 'unit', 'product_id', 'notes', group === 'recipe' ? 'optional' : 'included'];
        if (!rows[index] || !allowed.includes(part)) return false;
        if (!busy && !(group === 'plan' && planAttempt)) {
          rows[index][part] = part === 'optional' || part === 'included' ? element.checked === true : String(element.value || '');
          if (part === 'product_id' && !String(rows[index].name || '').trim()) {
            const product = (current.products || []).find(row => row.id === element.value && row.category !== 'household');
            if (product) {
              rows[index].name = product.name;
              const nameInput = root.document && typeof root.document.querySelector === 'function' && root.document.querySelector('#food-' + group + '-shopping-' + index + '-name');
              if (nameInput) nameInput.value = product.name;
            }
          }
          if (group === 'plan') {
            if (part === 'included' && typeof element.closest === 'function') {
              const rowElement = element.closest('.food-planning-row');
              if (rowElement && rowElement.classList) rowElement.classList.toggle('is-excluded', !element.checked);
            }
            updatePlanPreview(current);
          }
          persist();
        }
        return true;
      }
      if (Object.hasOwn(data, 'foodIngredient')) {
        const index = Number(data.foodIngredient), part = data.foodPart;
        if (!Number.isInteger(index) || index < 0 || !drafts.recipe.ingredients[index] || !['product_id', 'quantity', 'unit'].includes(part)) return false;
        if (!busy) {
          const previous = drafts.recipe.ingredients[index][part]; drafts.recipe.ingredients[index][part] = element.value;
          if (part === 'product_id' && previous !== element.value) {
            const product = (current.products || []).find(row => row.id === element.value);
            if (product) drafts.recipe.ingredients[index].unit = M.UNITS.some(unit => unit.value === product.serving_unit) ? product.serving_unit : product.package_unit;
            drafts.recipe.ingredients[index].quantity = ''; persist(); refresh('#food-ingredient-' + index + '-quantity');
          } else persist();
        }
        return true;
      }
      if (!data.foodField) return false;
      const [group, name, extra] = data.foodField.split('.');
      if (extra || !['recipe', 'log', 'plan'].includes(group) || !(group === 'recipe' ? RECIPE_FIELDS : group === 'plan' ? PLAN_FIELDS : LOG_FIELDS).includes(name)) return false;
      if (!busy && !(group === 'plan' && planAttempt)) {
        if (group === 'plan' && name === 'recipe_id') {
          if (!drafts.plan.id && drafts.plan.recipe_id !== element.value) { setPlanRecipe(current, element.value); persist(); refresh('#food-plan-recipe_id'); }
          return true;
        }
        const previous = drafts[group][name]; drafts[group][name] = element.value; persist();
        if (group === 'log' && name === 'servings' && root.document && typeof root.document.querySelector === 'function') {
          const preview = root.document.querySelector('#food-log-nutrition-values');
          if (preview) preview.innerHTML = nutritionTable(logNutrition(current), 'This person’s portion');
        }
        if (group === 'log' && previous !== element.value && ['source_kind', 'recipe_id', 'product_id', 'kind'].includes(name)) refresh('#food-log-' + name);
        if (group === 'recipe' && name === 'nutrition_mode' && previous !== element.value) refresh('#food-recipe-nutrition_mode');
        if (group === 'plan' && name === 'servings') updatePlanPreview(current);
      }
      return true;
    }
    function handleChange(event) {
      const element = event.target, data = element && element.dataset;
      if (!data) return false;
      snapshot();
      if (Object.hasOwn(data, 'foodDate')) {
        if (M.dateNumber(element.value) == null) { element.value = selectedDate; notify('Choose a valid date.', true); return true; }
        selectedDate = element.value;
        if (options.onDateChange) options.onDateChange(selectedDate);
        if (!dirty('log')) resetGroup('log', logDraft(selectedDate));
        persist(); refresh(); return true;
      }
      if (Object.hasOwn(data, 'foodFileInput')) {
        if (busy) return true;
        const file = element.files && element.files[0];
        if (file && (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size <= 0)) { selectedFile = null; element.value = ''; notify('Choose a JPG, PNG, WebP, or PDF file no larger than 10 MB.', true); return true; }
        selectedFile = file || null; openedRecipeId = data.foodFileInput; refresh(); return true;
      }
      return handleInput(event);
    }
    function openLog(current, row, overrides) {
      if (dirty('log') && !confirm('Start this food entry and discard your current food draft?')) return false;
      const value = logDraft(selectedDate);
      if (row) {
        for (const key of ['id', 'revision', 'occurred_on', 'person_slot', 'kind', 'recipe_id', 'product_id', 'servings', 'notes']) if (row[key] != null) value[key] = row[key];
        value.source_kind = row.recipe_id ? 'recipe' : 'product'; value.nutrition_original = copy(row.nutrition_snapshot || M.nutritionTotals([])); value.original_servings = row.servings; value.original_recipe_id = row.recipe_id || null; value.original_product_id = row.product_id || null; value.original_label = row.label || '';
        value.request_id = '';
      }
      Object.assign(value, overrides || {}); resetGroup('log', value); logging = true; if (currentPage === 'food') tab = 'log'; persist(); refresh('#food-log-form'); return true;
    }
    function setSelectedDate(date) {
      snapshot(); if (busy || M.dateNumber(date) == null) return false;
      if (selectedDate !== date) { selectedDate = date; persist(); } return true;
    }
    function startProductLog(productId, person, occurredOn) {
      const current = snapshot();
      if (current.status !== 'ready' || !current.user || !current.household || busy) return false;
      const product = (current.products || []).find(row => row.id === productId && !row.archived && row.category === 'food');
      if (!product) { notify('Choose a saved food or drink for this entry.'); }
      return openLog(current, null, { source_kind: 'product', product_id: product ? product.id : '', person_slot: Number(person) === 2 ? '2' : '1', kind: 'eaten', occurred_on: M.dateNumber(occurredOn) == null ? dayKey(getNow()) : occurredOn });
    }
    function download(name, content, mime) {
      if (options.download) return options.download(name, content, mime);
      if (!root.document || !root.URL || !root.Blob) throw new Error('This browser could not prepare the download.');
      const address = root.URL.createObjectURL(new Blob([content], { type: mime }));
      const anchor = root.document.createElement('a'); anchor.href = address; anchor.download = name; root.document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => root.URL.revokeObjectURL(address), 1000);
    }
    function handleClick(event) {
      const element = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-food-action]') : null;
      const data = element && element.dataset, action = data && data.foodAction;
      const actions = ['grocery', 'food-home', 'wellness', 'tab', 'cookbook-category', 'cookbook-pdf-prev', 'cookbook-pdf-next', 'cookbook-pdf-cover', 'cookbook-pdf-contents', 'cookbook-recipe', 'cookbook-select', 'cookbook-jump-browse', 'cook-recipe', 'cook-open-recipe', 'cook-exit', 'cook-next', 'cook-prev', 'cook-speak', 'cook-replay', 'cook-start-timer', 'cook-stop-timer', 'recipe-back', 'scroll-top', 'new-recipe', 'resume-recipe', 'view-recipe', 'edit-recipe', 'discard-recipe', 'archive-recipe', 'add-ingredient', 'remove-ingredient', 'add-shopping-ingredient', 'remove-shopping-ingredient', 'toggle-plan-ingredients', 'new-plan', 'plan-recipe', 'resume-plan', 'edit-plan', 'cancel-plan', 'close-plan', 'discard-plan', 'retry-plan', 'reload-plan', 'reload-plan-recipe', 'refresh-meal-shopping', 'new-log', 'resume-log', 'log-recipe', 'edit-log', 'eaten-from-plan', 'discard-log', 'choose-person', 'delete-log', 'calendar', 'upload-file', 'view-file', 'remove-file'];
      if (!actions.includes(action)) return false;
      if (event.preventDefault) event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        if (action === 'grocery') { openGrocery(data.tab || 'list', data.month || undefined); return true; }
        if (action === 'cookbook-category') { search = String(data.category || ''); refresh('#food-cookbook-top'); return true; }
        if (action === 'food-home' || action === 'wellness') { navigate(action === 'food-home' ? 'food' : 'wellness'); return true; }
        if (action === 'tab') { if (['home','cookbook','recipes','plans','cooking','soon','log'].includes(data.tab)) tab = data.tab; }
        else if (action === 'cookbook-pdf-prev') { cookbookPdfPage = Math.max(1, cookbookPdfPage - 1); refresh('#food-cookbook-top'); return true; }
        else if (action === 'cookbook-pdf-next') { cookbookPdfPage = Math.min(56, cookbookPdfPage + 1); refresh('#food-cookbook-top'); return true; }
        else if (action === 'cookbook-pdf-cover') { cookbookPdfPage = 1; refresh('#food-cookbook-top'); return true; }
        else if (action === 'cookbook-pdf-contents') { cookbookPdfPage = 2; refresh('#food-cookbook-top'); return true; }
        else if (action === 'cookbook-select') {
          if ((current.recipes || []).some(row => row.id === data.id && !row.archived)) cookbookSelectedRecipeId = data.id;
          liveCookRecipeId = ''; stopLiveTimer(); persist(); refresh('#food-cookbook-top'); return true;
        }
        else if (action === 'cookbook-jump-browse') { afterRenderScroll('#food-cookbook-browse','start'); return true; }
        else if (action === 'cook-recipe') {
          const recipe = (current.recipes || []).find(row => row.id === data.id && !row.archived);
          if (!recipe) throw new Error('Refresh to find this saved recipe.');
          cookbookSelectedRecipeId = recipe.id; liveCookRecipeId = recipe.id; liveCookStep = 0; stopLiveTimer(); tab = 'cookbook';
          persist(); refresh(); afterRenderScroll('#food-live-cook','start'); return true;
        }
        else if (action === 'cook-open-recipe') { return openRecipeAndScroll(data.id || liveCookRecipeId, 'cookbook'); }
        else if (action === 'cook-exit') { liveCookRecipeId = ''; liveCookStep = 0; stopLiveTimer(); refresh('#food-cookbook-top'); return true; }
        else if (action === 'cook-next' || action === 'cook-prev') {
          const recipe = (current.recipes || []).find(row => row.id === liveCookRecipeId && !row.archived);
          if (!recipe) throw new Error('Open a recipe before using live cooking.');
          const steps = recipeSteps(recipe);
          liveCookStep = Math.max(0, Math.min(steps.length - 1, liveCookStep + (action === 'cook-next' ? 1 : -1)));
          stopLiveTimer(); refresh('#food-live-cook'); return true;
        }
        else if (action === 'cook-speak' || action === 'cook-replay') {
          const recipe = (current.recipes || []).find(row => row.id === liveCookRecipeId && !row.archived);
          if (!recipe) throw new Error('Open a recipe before using audio guidance.');
          speakLiveStep(recipe); return true;
        }
        else if (action === 'cook-start-timer') { startLiveTimer(Number(data.minutes)); refresh('#food-live-timer'); return true; }
        else if (action === 'cook-stop-timer') { stopLiveTimer(); refresh('#food-live-timer'); return true; }
        else if (action === 'cookbook-recipe') { return openRecipeAndScroll(data.id, 'cookbook'); }
        else if (action === 'recipe-back') {
          const destination = recipeReturn && recipeReturn.tab || 'recipes';
          const y = recipeReturn && Number.isFinite(recipeReturn.y) ? recipeReturn.y : 0;
          recipeReturn = null; openedRecipeId = ''; editor = false; tab = destination;
          persist(); refresh();
          requestAnimationFrame(() => requestAnimationFrame(() => root.scrollTo({ top: y, behavior: 'smooth' })));
          return true;
        }
        else if (action === 'scroll-top') { root.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
        else if (action === 'new-recipe') { if (dirty('recipe') && !confirm('Start a new recipe and discard your current recipe draft?')) return true; resetGroup('recipe', recipeDraft()); editor = true; openedRecipeId = ''; tab = 'recipes'; persist(); refresh(); afterRenderScroll('#food-recipe-form','start'); return true; }
        else if (action === 'resume-recipe') { editor = true; tab = 'recipes'; persist(); refresh(); afterRenderScroll('#food-recipe-form','start'); return true; }
        else if (action === 'view-recipe') { return openRecipeAndScroll(data.id, tab); }
        else if (action === 'edit-recipe') {
          const recipe = (current.recipes || []).find(row => row.id === data.id); if (!recipe) throw new Error('Refresh to open this recipe.');
          if (drafts.recipe.id !== recipe.id && dirty('recipe') && !confirm('Edit this recipe and discard your current recipe draft?')) return true;
          if (drafts.recipe.id !== recipe.id || !dirty('recipe')) { const value = recipeDraft(); for (const key of Object.keys(value)) if (Object.hasOwn(recipe, key)) value[key] = copy(recipe[key]); value.nutrition_reference = referenceDraft(value.nutrition_reference); value.request_id = ''; resetGroup('recipe', value); }
          editor = true; tab = 'recipes'; openedRecipeId = recipe.id; recipeReturn = { tab: 'recipes', y: Number(root.scrollY || root.pageYOffset || 0) }; persist(); refresh(); afterRenderScroll('#food-recipe-form','start'); return true;
        } else if (action === 'discard-recipe') { if (dirty('recipe') && !confirm('Discard this recipe draft? The last saved recipe will remain.')) return true; resetGroup('recipe', recipeDraft()); editor = false; }
        else if (action === 'archive-recipe') {
          ready(current); const recipe = (current.recipes || []).find(row => row.id === data.id); if (!recipe || !confirm('Archive ' + recipe.name + '? Earlier food entries keep their saved nutrition.')) return true;
          run('Archiving the recipe…', () => store.saveRecipe({ ...recipe, archived: true }), () => { if (drafts.recipe.id === recipe.id) resetGroup('recipe', recipeDraft()); openedRecipeId = ''; editor = false; notify('The recipe was archived. Earlier food entries were kept.'); }); return true;
        } else if (action === 'add-ingredient') { if (drafts.recipe.ingredients.length < 100) drafts.recipe.ingredients.push({ product_id: '', quantity: '', unit: 'each' }); }
        else if (action === 'remove-ingredient') { const index = Number(data.index); if (Number.isInteger(index) && index >= 0 && index < drafts.recipe.ingredients.length) drafts.recipe.ingredients.splice(index, 1); }
        else if (action === 'add-shopping-ingredient' || action === 'remove-shopping-ingredient') {
          if (!['recipe', 'plan'].includes(data.group)) throw new Error('Open the recipe or meal ingredient editor first.');
          if (data.group === 'plan' && planAttempt) throw new Error('Confirm the pending meal request before changing its ingredients.');
          const rows = data.group === 'recipe' ? drafts.recipe.planning_ingredients : drafts.plan.ingredients;
          if (action === 'add-shopping-ingredient') { if (rows.length < 100) rows.push(shoppingIngredientDraft()); }
          else { const index = Number(data.index); if (Number.isInteger(index) && index >= 0 && index < rows.length) rows.splice(index, 1); }
          if (data.group === 'plan') planIngredientsOpen = true;
        }
        else if (action === 'toggle-plan-ingredients') { planIngredientsOpen = !planIngredientsOpen; persist(); refresh('#food-plan-ingredients-toggle'); return true; }
        else if (action === 'new-plan') { openPlan(current, null, null); return true; }
        else if (action === 'plan-recipe') {
          const recipe = (current.recipes || []).find(row => row.id === data.id && !row.archived);
          if (!recipe) throw new Error('Refresh to find this saved recipe.');
          openPlan(current, recipe, null); return true;
        }
        else if (action === 'resume-plan') { tab = 'plans'; planning = !planAttempt || planAttempt.action === 'save'; }
        else if (action === 'edit-plan') {
          const plan = (current.cookingPlans || []).find(row => row.id === data.id);
          if (!plan) throw new Error('Refresh to find this saved meal.');
          openPlan(current, null, plan); return true;
        }
        else if (action === 'close-plan') { planning = false; tab = 'plans'; }
        else if (action === 'discard-plan') {
          if (planAttempt) throw new Error('Confirm the pending meal request before discarding it. Its exact details are kept for a safe retry.');
          if (dirty('plan') && !confirm('Discard this meal draft? Saved meals and groceries will remain.')) return true;
          resetGroup('plan', planDraft(dayKey(getNow()))); planProblem = ''; planning = false;
        }
        else if (action === 'retry-plan') { submitPlanAttempt(); return true; }
        else if (action === 'reload-plan') { reloadPlan(current); return true; }
        else if (action === 'reload-plan-recipe') {
          ready(current);
          if (planAttempt) throw new Error('Confirm the pending meal save before replacing its recipe ingredients.');
          if (!drafts.plan.recipe_id || typeof store.refresh !== 'function') throw new Error('Choose a saved recipe and refresh before loading its ingredients.');
          if (!confirm('Replace this meal’s ingredient choices with the latest saved recipe ingredients? Its cooking date and serving count will stay.')) return true;
          const recipeId = drafts.plan.recipe_id;
          run('Loading the latest recipe ingredients…', () => store.refresh(), () => {
            const fresh = snapshot(); ready(fresh);
            if (!(fresh.recipes || []).some(row => row.id === recipeId && !row.archived)) throw new Error('This recipe is no longer available. Your meal draft and saved history have been kept.');
            setPlanRecipe(fresh, recipeId);
            drafts.plan.request_id = uuid(); planProblem = ''; planning = true; tab = 'plans';
            notify('The latest recipe ingredients are loaded. Review the amounts before saving this meal.');
          }, '#food-plan-form'); return true;
        }
        else if (action === 'cancel-plan') {
          ready(current);
          if (planAttempt) throw new Error('Confirm the pending meal request first.');
          const plan = (current.cookingPlans || []).find(row => row.id === data.id && row.status === 'planned');
          if (!plan || plan.cook_on < dayKey(getNow())) throw new Error('Choose a current or future planned meal. Past dates remain in history.');
          if (drafts.plan.id === plan.id && dirty('plan')) throw new Error('Save or discard this meal’s draft before cancelling the saved meal.');
          if (!confirm('Cancel ' + plan.recipe_name + ' on ' + dateLabel(plan.cook_on) + '? Its unpurchased grocery needs will update. Actual purchases remain saved.')) return true;
          planAttempt = { action: 'cancel', payload: { id: plan.id, revision: plan.revision, request_id: uuid() } }; planProblem = ''; tab = 'plans'; persist(); submitPlanAttempt(); return true;
        }
        else if (action === 'refresh-meal-shopping') {
          ready(current);
          if (planAttempt) throw new Error('Confirm the pending meal request first.');
          if (typeof store.reconcileMealShopping !== 'function') throw new Error('Refresh the app to load the meal-planning tools.');
          run('Checking meal ingredients and food at home…', () => store.reconcileMealShopping(), () => { notify('Your planned meals were checked against food at home and the grocery list was updated.'); }, '#food-plans'); return true;
        }
        else if (action === 'delete-equipment') { const row=(current.kitchenEquipment||[]).find(item=>item.id===data.id); if(row&&confirm('Remove '+row.name+' from Kitchen Equipment?')) run('Removing equipment…',()=>store.deleteKitchenEquipment(row),()=>notify('Kitchen equipment removed.')); return true; }
        else if (action === 'new-log') { openLog(current, null, { person_slot: String(data.person || 1), kind: data.kind === 'planned' ? 'planned' : 'eaten' }); return true; }
        else if (action === 'resume-log') { logging = true; if (currentPage === 'food') tab = 'log'; }
        else if (action === 'log-recipe') { const recipe = (current.recipes || []).find(row => row.id === data.id); if (!recipe) throw new Error('Refresh to find this recipe.'); openLog(current, null, { recipe_id: recipe.id, person_slot: String(data.person || 1), source_kind: 'recipe' }); return true; }
        else if (action === 'edit-log' || action === 'eaten-from-plan') {
          const row = (current.mealEntries || []).find(entry => entry.id === data.id); if (!row) throw new Error('Refresh to find this food entry.');
          openLog(current, row, action === 'eaten-from-plan' ? { id: '', request_id: uuid(), revision: null, kind: 'eaten' } : {}); return true;
        } else if (action === 'discard-log') { if (dirty('log') && !confirm('Discard this food-entry draft? Saved entries will remain.')) return true; resetGroup('log', logDraft(selectedDate)); logging = false; }
        else if (action === 'choose-person') { if (['1', '2'].includes(String(data.person))) drafts.log.person_slot = String(data.person); }
        else if (action === 'delete-log') {
          ready(current); const row = (current.mealEntries || []).find(entry => entry.id === data.id); if (!row || !confirm('Delete this ' + row.kind + ' food entry for Person ' + row.person_slot + '?')) return true;
          run('Deleting the food entry…', () => store.deleteMealEntry(row), () => { if (drafts.log.id === row.id) { resetGroup('log', logDraft(selectedDate)); logging = false; } notify('The food entry was deleted.'); }); return true;
        } else if (action === 'calendar') {
          const item = (current.inventory || []).find(row => row.id === data.id); if (!item) throw new Error('Refresh to find this food.');
          download('life-in-bloom-food-reminder.ics', buildExpiryCalendar(item, getNow()), 'text/calendar;charset=utf-8'); notify('Your calendar reminder was downloaded. Import it into your calendar and check its alert settings.');
        } else if (action === 'upload-file') {
          ready(current); if (!selectedFile || !(current.recipes || []).some(row => row.id === data.id)) throw new Error('Choose a file for a saved recipe first.');
          const file = selectedFile; run('Saving the recipe file…', () => store.uploadFoodFile({ recipe_id: data.id, file }), () => { selectedFile = null; notify('The file was saved privately for your household.'); }); return true;
        } else if (action === 'view-file') {
          ready(current); const file = (current.foodFiles || []).find(row => row.id === data.id); if (!file) throw new Error('Refresh to find this file.');
          run('Opening the recipe file…', () => store.getFoodFileUrl(file), result => { const address = typeof result === 'string' ? result : result && (result.signedUrl || result.signedURL); if (!safeUrl(address)) throw new Error('The file link could not be prepared.'); fileUrls.set(file.id, address); notify('Your file is ready. Choose Open file.'); }); return true;
        } else if (action === 'remove-file') {
          ready(current); const file = (current.foodFiles || []).find(row => row.id === data.id); if (!file || !confirm('Remove ' + file.name + ' from this recipe?')) return true;
          run('Removing the file…', () => store.deleteFoodFile(file), () => { fileUrls.delete(file.id); notify('The file was removed.'); }); return true;
        }
        persist(); refresh();
      } catch (error) { notify(error.message, true); }
      return true;
    }
    function selectTab(value) { snapshot(); if (busy || !['home','cookbook','recipes','plans','cooking','soon','log'].includes(value)) return false; tab = value; persist(); refresh(); return true; }
    function hasUnpersistedChanges() { snapshot(); return Boolean(selectedFile || ((dirty('recipe') || dirty('log') || dirty('plan') || planAttempt) && !draftSaved)); }
    return { render, handleClick, handleSubmit, handleInput, handleChange, hasUnsavedDraft, hasUnpersistedChanges, discardDraft, selectTab, startProductLog, setSelectedDate, getSelectedDate: () => { snapshot(); return selectedDate; }, isBusy: () => Boolean(busy), whenIdle: () => pending, getHomeSummary: () => { const current = snapshot(); return { due: M.dueItems(current.inventory || [], dayKey(getNow())).length, recipes: (current.recipes || []).filter(row => !row.archived).length }; } };
  }
  const api = { createController, buildExpiryCalendar, allergyMatches, scaledSnapshot, actualNutrition };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomFood = api;
})(typeof window !== 'undefined' ? window : globalThis);
