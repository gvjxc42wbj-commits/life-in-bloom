/* Saved recipes, food-date reminders and separate planned/eaten nutrition logs. */
(function (root) {
  'use strict';
  const M = root.BloomFoodModel || (typeof require === 'function' ? require('./bloom-food-model.js') : null);
  const RECIPE_FIELDS = ['name', 'servings', 'instructions', 'source_url', 'notes'];
  const LOG_FIELDS = ['occurred_on', 'person_slot', 'kind', 'source_kind', 'recipe_id', 'product_id', 'servings', 'notes'];
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
  function safeUrl(value) {
    const address = String(value || '').trim();
    if (!address) return '';
    try { const parsed = new URL(address); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; }
    catch (_) { return ''; }
  }
  function recipeDraft() { return { id: '', request_id: uuid(), revision: null, name: '', servings: '', ingredients: [{ product_id: '', quantity: '', unit: 'each' }], instructions: '', source_url: '', notes: '', archived: false }; }
  function logDraft(date) { return { id: '', request_id: uuid(), revision: null, occurred_on: date, person_slot: '1', kind: 'eaten', source_kind: 'recipe', recipe_id: '', product_id: '', servings: '1', notes: '', nutrition_original: null, original_servings: null, original_recipe_id: null, original_product_id: null, original_label: '' }; }
  function scaledSnapshot(snapshot, multiplier) {
    if (!snapshot || typeof snapshot.values !== 'object' || !Number.isFinite(multiplier) || multiplier <= 0) return null;
    return { values: Object.fromEntries(M.NUTRIENTS.map(({ key }) => [key, snapshot.values[key] == null ? null : Number((Number(snapshot.values[key]) * multiplier).toPrecision(13))])), missing: Object.fromEntries(M.NUTRIENTS.map(({ key }) => [key, Number(snapshot.missing && snapshot.missing[key]) || (snapshot.values[key] == null ? 1 : 0)])), complete: snapshot.complete === true };
  }
  function personProfile(current, slot) {
    const member = (current.members || []).find(value => slot === 1 ? value.role === 'owner' : value.role === 'member');
    return member ? (current.dietProfiles || []).find(value => value.user_id === member.user_id) || null : null;
  }
  function allergyMatches(recipe, products, current, slot) {
    const productMap = new Map((products || []).map(value => [value.id, value]));
    const ingredientText = (recipe.ingredients || []).map(value => productMap.get(value.product_id)).filter(Boolean).map(value => (value.allergens || '') + ' ' + value.name).join(' ').toLowerCase();
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
    let tab = 'recipes', selectedDate = dayKey(getNow()), search = '', editor = false, openedRecipeId = '', logging = false;
    let selectedFile = null, fileUrls = new Map(), draftSaved = false, draftWarningShown = false;
    let drafts = { recipe: recipeDraft(), log: logDraft(selectedDate) }, baselines = copy(drafts);

    const dirty = group => JSON.stringify(drafts[group]) !== JSON.stringify(baselines[group]);
    function resetGroup(group, value) { drafts[group] = copy(value); baselines[group] = copy(value); }
    function restoreDrafts(saved) {
      if (!saved || saved.version !== 1 || !saved.drafts || !saved.baselines || !Array.isArray(saved.drafts.recipe && saved.drafts.recipe.ingredients) || saved.drafts.recipe.ingredients.length > 100) return false;
      for (const group of ['recipe', 'log']) {
        const empty = group === 'recipe' ? recipeDraft() : logDraft(selectedDate);
        const restore = source => {
          const result = copy(empty);
          for (const key of Object.keys(empty)) if (source && Object.hasOwn(source, key)) result[key] = copy(source[key]);
          return result;
        };
        drafts[group] = restore(saved.drafts[group]); baselines[group] = restore(saved.baselines[group]);
      }
      tab = ['recipes', 'soon', 'log'].includes(saved.tab) ? saved.tab : 'recipes';
      selectedDate = M.dateNumber(saved.selectedDate) == null ? dayKey(getNow()) : saved.selectedDate;
      editor = Boolean(saved.editor); logging = Boolean(saved.logging); openedRecipeId = String(saved.openedRecipeId || '');
      return true;
    }
    function snapshot() {
      const current = store.snapshot() || {};
      const key = (current.user && current.user.id || '') + ':' + (current.household && current.household.id || '');
      if (key !== identity) {
        identity = key; generation++; busy = null; selectedDate = dayKey(getNow()); tab = 'recipes'; search = ''; editor = false; logging = false; openedRecipeId = ''; selectedFile = null; fileUrls = new Map();
        drafts = { recipe: recipeDraft(), log: logDraft(selectedDate) }; baselines = copy(drafts); draftSaved = false; draftWarningShown = false;
        if (draftStore && current.user && current.household) {
          try { const saved = draftStore.read(current.user.id, current.household.id, 'food'); draftSaved = Boolean(saved && restoreDrafts(saved.data)); }
          catch (_) { notify('A saved Food draft could not be opened. Your stored copy has not been changed.', true); }
        }
      }
      return current;
    }
    function updateDraftIndicators() {
      if (!root.document || typeof root.document.querySelector !== 'function') return;
      for (const group of ['recipe', 'log']) {
        const element = root.document.querySelector('[data-food-draft-status="' + group + '"]');
        if (element) { element.hidden = !dirty(group); element.textContent = draftSaved ? 'Draft saved on this device. Choose Save to share the finished entry with your household.' : 'Draft in progress. Save before closing this page.'; }
      }
    }
    function persist() {
      const current = snapshot();
      if (!draftStore || !current.user || !current.household) { updateDraftIndicators(); return; }
      try {
        const changed = dirty('recipe') || dirty('log');
        const ok = changed ? draftStore.write(current.user.id, current.household.id, 'food', { version: 1, drafts, baselines, tab, selectedDate, editor, logging, openedRecipeId }) : draftStore.clear(current.user.id, current.household.id, 'food');
        draftSaved = changed && ok !== false;
        if (ok === false && !draftWarningShown) { draftWarningShown = true; notify('This browser could not save your Food draft. Keep this page open until you save it online.', true); }
      } catch (_) { draftSaved = false; if (!draftWarningShown) { draftWarningShown = true; notify('Your Food draft could not be saved on this device. Keep the page open until you save it online.', true); } }
      updateDraftIndicators();
    }
    function hasUnsavedDraft() { snapshot(); return Boolean(busy || selectedFile || dirty('recipe') || dirty('log')); }
    function discardDraft() {
      if (busy) return false;
      resetGroup('recipe', recipeDraft()); resetGroup('log', logDraft(selectedDate)); selectedFile = null; editor = false; logging = false; persist(); return true;
    }
    function ready(current) {
      if (!current.user || !current.household || current.status !== 'ready') throw new Error('Open Grocery and connect your household before saving Food records.');
      if (current.offline) throw new Error('You are offline. Your draft stays on this device. Reconnect to save it to your household.');
    }
    function run(label, work, success, focus) {
      if (busy) return false;
      const token = generation; busy = { label }; refresh();
      pending = Promise.resolve().then(work).then(result => { snapshot(); if (token !== generation) return; if (success) success(result); persist(); }).catch(error => { snapshot(); if (token !== generation) return; persist(); notify(error && error.message || 'This change could not be saved. Your draft is still here.', true); }).finally(() => { snapshot(); if (token !== generation) return; busy = null; refresh(focus); });
      return true;
    }
    function button(action, label, data, primary, disabled) {
      return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-food-action="' + action + '"' + (data || '') + (busy || disabled ? ' disabled' : '') + '>' + label + '</button>';
    }
    function field(group, name, label, type, attrs) {
      const value = drafts[group][name];
      return '<label class="food-field" for="food-' + group + '-' + name + '"><span>' + label + '</span><input id="food-' + group + '-' + name + '" name="' + name + '" type="' + (type || 'text') + '" data-food-field="' + group + '.' + name + '" value="' + esc(value) + '"' + (attrs || '') + (busy ? ' disabled' : '') + '></label>';
    }
    function textarea(group, name, label, limit) {
      return '<label class="food-field" for="food-' + group + '-' + name + '"><span>' + label + '</span><textarea id="food-' + group + '-' + name + '" name="' + name + '" data-food-field="' + group + '.' + name + '" maxlength="' + limit + '"' + (busy ? ' disabled' : '') + '>' + esc(drafts[group][name]) + '</textarea></label>';
    }
    function nutritionTable(value, headline) {
      const data = value || M.nutritionTotals([]);
      return '<div class="food-nutrition"><h4>' + esc(headline || 'Nutrition') + '</h4><dl>' + M.NUTRIENTS.map(nutrient => '<div><dt>' + nutrient.label + '</dt><dd>' + (data.values[nutrient.key] == null ? '<span class="food-unknown">Not recorded</span>' : esc(fmt(data.values[nutrient.key])) + ' ' + nutrient.unit + (data.missing[nutrient.key] ? ' <small>known · incomplete</small>' : '')) + '</dd></div>').join('') + '</dl>' + (!data.complete ? '<p class="food-help">Missing label values remain unknown. A shown subtotal may not include every ingredient.</p>' : '') + '</div>';
    }
    function briefNutrition(value) {
      return [['calories_kcal', 'kcal'], ['protein_g', 'g protein']].map(([key, unit]) => value.values[key] == null ? '<span>' + (key === 'calories_kcal' ? 'Calories' : 'Protein') + ': not recorded</span>' : '<span>' + esc(fmt(value.values[key])) + ' ' + unit + (value.missing[key] ? ' known · incomplete' : '') + '</span>').join('');
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
    function renderRecipeDetail(current, recipe) {
      const products = new Map((current.products || []).map(product => [product.id, product]));
      let html = '<section class="panel food-recipe-detail"><p class="page-kicker">Saved recipe</p><h2>' + esc(recipe.name) + '</h2><p class="food-help">Makes ' + esc(fmt(recipe.servings)) + ' servings. Ingredient quantities below are for the whole recipe.</p>' + allergyNotice(recipe, current);
      html += '<ul class="food-ingredients">' + (recipe.ingredients || []).map(item => '<li><strong>' + esc(products.get(item.product_id) && products.get(item.product_id).name || 'Ingredient no longer available') + '</strong><span>' + esc(fmt(item.quantity)) + ' ' + esc(item.unit) + '</span></li>').join('') + '</ul>';
      if (recipe.instructions) html += '<h3>Instructions</h3><p class="food-prose">' + esc(recipe.instructions) + '</p>';
      if (recipe.notes) html += '<p class="food-prose food-help">' + esc(recipe.notes) + '</p>';
      if (safeUrl(recipe.source_url)) html += '<p><a href="' + esc(safeUrl(recipe.source_url)) + '" target="_blank" rel="noopener noreferrer">Original recipe ↗</a></p>';
      html += nutritionTable(M.recipeNutrition(recipe, current.products || [], 1), 'Nutrition per recipe serving');
      html += '<div class="food-actions">' + button('log-recipe', 'Log for Person 1', ' data-id="' + esc(recipe.id) + '" data-person="1"', true) + button('log-recipe', 'Log for Person 2', ' data-id="' + esc(recipe.id) + '" data-person="2"') + button('edit-recipe', 'Edit recipe', ' data-id="' + esc(recipe.id) + '"') + button('archive-recipe', 'Archive recipe', ' data-id="' + esc(recipe.id) + '"', false, current.offline) + '</div>';
      return html + renderFiles(current, recipe) + '</section>';
    }
    function renderRecipeForm(current) {
      const value = drafts.recipe;
      const products = (current.products || []).filter(product => product.category !== 'household' && (!product.archived || value.ingredients.some(item => item.product_id === product.id)));
      let html = '<section class="panel"><p class="page-kicker">' + (value.id ? 'Edit your recipe' : 'A recipe to keep') + '</p><h2>' + (value.id ? 'Edit recipe' : 'Save a recipe') + '</h2><p class="food-help">Use products from your catalog so their saved label information can calculate recipe nutrition.</p><form id="food-recipe-form" class="food-form" data-food-form="recipe"><div class="food-form-grid">' + field('recipe', 'name', 'Recipe name', 'text', ' maxlength="160" required') + field('recipe', 'servings', 'Servings made by the whole recipe', 'number', ' min="0.01" max="10000" step="any" required') + '</div><fieldset class="food-ingredient-editor"><legend>Ingredients for the whole recipe</legend>';
      html += value.ingredients.map((ingredient, index) => '<div class="food-ingredient-row"><label class="food-field" for="food-ingredient-' + index + '-product"><span>Ingredient ' + (index + 1) + '</span><select id="food-ingredient-' + index + '-product" name="ingredient_' + index + '_product_id" data-food-ingredient="' + index + '" data-food-part="product_id" required' + (busy ? ' disabled' : '') + '><option value="">Choose a catalog product</option>' + products.map(product => '<option value="' + esc(product.id) + '"' + (product.id === ingredient.product_id ? ' selected' : '') + '>' + esc(product.name + (product.brand ? ' · ' + product.brand : '')) + '</option>').join('') + '</select></label><label class="food-field" for="food-ingredient-' + index + '-quantity"><span>Amount</span><input id="food-ingredient-' + index + '-quantity" name="ingredient_' + index + '_quantity" data-food-ingredient="' + index + '" data-food-part="quantity" type="number" min="0.000001" max="1000000000" step="any" value="' + esc(ingredient.quantity) + '" required' + (busy ? ' disabled' : '') + '></label><label class="food-field" for="food-ingredient-' + index + '-unit"><span>Unit</span><select id="food-ingredient-' + index + '-unit" name="ingredient_' + index + '_unit" data-food-ingredient="' + index + '" data-food-part="unit"' + (busy ? ' disabled' : '') + '>' + M.UNITS.map(unit => '<option value="' + unit.value + '"' + (ingredient.unit === unit.value ? ' selected' : '') + '>' + unit.label + '</option>').join('') + '</select></label>' + button('remove-ingredient', 'Remove', ' data-index="' + index + '"', false, value.ingredients.length < 2) + '</div>').join('');
      html += '<div class="food-actions">' + button('add-ingredient', '+ Add ingredient', '', false, value.ingredients.length >= 100) + button('grocery', 'Add a product to the catalog ↗', ' data-tab="catalog"') + '</div><p class="food-help">Weight and volume are different. For example, a cup cannot be converted into grams without a food-specific measurement.</p></fieldset>';
      html += textarea('recipe', 'instructions', 'Instructions', 20000) + field('recipe', 'source_url', 'Recipe link (optional)', 'url', ' maxlength="2048"') + textarea('recipe', 'notes', 'Notes (optional)', 4000);
      html += '<div class="food-actions"><button type="submit" class="button primary"' + (busy || current.offline ? ' disabled' : '') + '>Save recipe</button>' + button('discard-recipe', 'Discard recipe draft') + '</div>' + draftStatus('recipe') + '</form></section>';
      return html;
    }
    function draftStatus(group) {
      return '<p class="food-draft-state" data-food-draft-status="' + group + '" role="status"' + (!dirty(group) ? ' hidden' : '') + '>' + (draftSaved ? 'Draft saved on this device. Choose Save to share the finished entry with your household.' : 'Draft in progress. Save before closing this page.') + '</p>';
    }
    function renderRecipes(current) {
      const recipes = (current.recipes || []).filter(recipe => !recipe.archived && String(recipe.name).toLowerCase().includes(search.toLowerCase()));
      let html = '<section class="panel"><div class="food-heading"><div><p class="page-kicker">Your recipe collection</p><h2>Recipes you come back to</h2></div>' + button('new-recipe', '+ Save a recipe', '', true) + '</div><label class="food-field food-search" for="food-recipe-search"><span>Find a saved recipe</span><input id="food-recipe-search" type="search" data-food-search value="' + esc(search) + '" placeholder="Search your recipes"></label>';
      if (dirty('recipe') && !editor) html += '<p class="food-help">You have a recipe draft.</p>' + button('resume-recipe', 'Resume recipe draft');
      if (!recipes.length) html += '<div class="food-empty"><span aria-hidden="true">📖</span><h3>' + (search ? 'No matching recipes' : 'Start with a recipe you know') + '</h3><p>Save its ingredients and the number of servings. Then you can log a different portion for each person and find it when an ingredient needs using.</p></div>';
      else html += '<div class="food-recipe-grid">' + recipes.map(recipe => '<article class="food-recipe-card"><h3>' + esc(recipe.name) + '</h3><p>' + esc(fmt(recipe.servings)) + ' servings · ' + (recipe.ingredients || []).length + ' ingredients</p><div class="food-nutrition-brief">' + briefNutrition(M.recipeNutrition(recipe, current.products || [], 1)) + '</div>' + allergyNotice(recipe, current) + '<div class="food-actions">' + button('view-recipe', 'Open recipe', ' data-id="' + esc(recipe.id) + '"') + button('log-recipe', 'Log a portion', ' data-id="' + esc(recipe.id) + '" data-person="1"') + '</div></article>').join('') + '</div>';
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
      else html += '<div class="food-recipe-grid">' + suggestions.map(suggestion => '<article class="food-recipe-card"><h3>' + esc(suggestion.name) + '</h3><p><strong>Uses soon:</strong> ' + [...new Set(suggestion.matching_items.map(item => item.name))].map(esc).join(', ') + '</p>' + allergyNotice(suggestion.recipe, current) + (suggestion.complete_stock ? '<p>Recorded quantities cover this recipe. Check the actual food before cooking.</p>' : '<p><strong>Also needed or needing review:</strong></p><ul>' + suggestion.missing_ingredients.map(item => '<li>' + esc(item.name) + ' — ' + esc(fmt(item.quantity)) + ' ' + esc(item.unit) + (item.reason ? ' · ' + esc(item.reason) : '') + '</li>').join('') + '</ul>') + '<div class="food-actions">' + button('view-recipe', 'Open recipe', ' data-id="' + esc(suggestion.recipe_id) + '"') + '</div></article>').join('') + '</div>';
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
    function renderWellness(current) {
      let html = '<section class="panel"><div class="food-heading"><div><p class="page-kicker">Household nutrition</p><h2>Each person’s day</h2></div>' + datePicker() + '</div><p class="food-help">Person 1 is pink. Person 2 is purple. Planned portions and actually eaten portions have separate totals. Your chosen goals remain editable in Grocery Profiles.</p><div class="food-actions">' + button('grocery', 'Nutrition profiles', ' data-tab="profiles"') + button('food-home', 'Saved recipes & food dates') + '</div></section><div class="food-person-grid">';
      for (const person of [1, 2]) {
        const profile = personProfile(current, person);
        const actual = (current.mealEntries || []).filter(entry => entry.person_slot === person && entry.occurred_on === selectedDate && entry.kind === 'eaten');
        const planned = (current.mealEntries || []).filter(entry => entry.person_slot === person && entry.occurred_on === selectedDate && entry.kind === 'planned');
        html += '<section class="panel food-person-' + (person === 1 ? 'pink' : 'purple') + '"><p class="page-kicker">Person ' + person + '</p><h2>' + esc(profile && profile.display_name || 'Your nutrition') + '</h2><dl class="food-goals">' + M.NUTRIENTS.slice(0, 5).map(nutrient => '<div><dt>' + nutrient.label + ' goal</dt><dd>' + (profile && profile[nutrient.key] != null ? esc(fmt(profile[nutrient.key])) + ' ' + nutrient.unit : 'Not set') + '</dd></div>').join('') + '</dl><h3>Actually eaten</h3>' + (actual.length ? '<div class="food-nutrition-brief">' + briefNutrition(M.nutritionTotals(actual)) + '</div><details><summary>All recorded nutrients</summary>' + nutritionTable(M.nutritionTotals(actual), 'Eaten portions') + '</details>' : '<p class="food-help">No eaten portions logged for this date.</p>') + '<h3>Planned</h3>' + (planned.length ? '<div class="food-nutrition-brief">' + briefNutrition(M.nutritionTotals(planned)) + '</div><details><summary>All planned nutrients</summary>' + nutritionTable(M.nutritionTotals(planned), 'Planned portions') + '</details>' : '<p class="food-help">No planned portions for this date.</p>') + personalNotes(current, person) + '<div class="food-actions">' + button('new-log', 'Log for Person ' + person, ' data-person="' + person + '" data-kind="eaten"', true) + button('new-log', 'Plan a portion', ' data-person="' + person + '" data-kind="planned"') + '</div></section>';
      }
      html += '</div>';
      if (dirty('log') && !logging) html += '<section class="panel"><p>You have a food entry draft.</p>' + button('resume-log', 'Resume food draft') + '</section>';
      if (logging) html += renderLogForm(current);
      return html + renderEntries(current) + '<p class="food-help food-footnote">Nutrition comes from saved label values and recipe calculations. Missing values and logged portions affect completeness. These are records and estimates, not prescribed intake.</p>';
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
      html += '<div class="food-shortcuts"><button type="button" data-food-action="grocery" data-tab="list"><span class="food-shortcut-icon" aria-hidden="true">🛒</span><span><strong>Grocery list</strong><small>Open what you need to buy</small></span><span aria-hidden="true">›</span></button><button type="button" data-food-action="grocery" data-tab="inventory"><span class="food-shortcut-icon" aria-hidden="true">🧺</span><span><strong>Food at home</strong><small>Pantry · refrigerator · freezer</small></span><span aria-hidden="true">›</span></button></div><nav class="food-tabs" aria-label="Food sections">' + [['recipes', '📖', 'Saved recipes'], ['soon', '🌱', 'Use soon' + (dueCount ? ' · ' + dueCount : '')], ['log', '🍽️', 'Food log']].map(([value, icon, label]) => '<button type="button" data-food-action="tab" data-tab="' + value + '"' + (tab === value ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + icon + '</span> ' + esc(label) + '</button>').join('') + '</nav>';
      if (tab === 'recipes') html += renderRecipes(current);
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
      for (const key of group === 'recipe' ? RECIPE_FIELDS : LOG_FIELDS) { const element = get(key); if (element && typeof element.value === 'string') drafts[group][key] = element.value; }
      if (group === 'recipe') for (let index = 0; index < drafts.recipe.ingredients.length; index++) for (const part of ['product_id', 'quantity', 'unit']) { const element = get('ingredient_' + index + '_' + part); if (element && typeof element.value === 'string') drafts.recipe.ingredients[index][part] = element.value; }
    }
    function recipePayload(current) {
      const value = drafts.recipe;
      const name = text(value.name, 'Recipe name', 160, true), servings = quantity(value.servings, 'Recipe servings', 10000);
      if (!Array.isArray(value.ingredients) || !value.ingredients.length || value.ingredients.length > 100) throw new Error('Add between 1 and 100 recipe ingredients.');
      const ingredients = value.ingredients.map((item, index) => {
        const product = (current.products || []).find(row => row.id === item.product_id && row.category !== 'household');
        if (!product) throw new Error('Choose a catalog food for ingredient ' + (index + 1) + '.');
        if (!M.UNITS.some(unit => unit.value === item.unit)) throw new Error('Choose a supported unit for ingredient ' + (index + 1) + '.');
        return { product_id: product.id, quantity: quantity(item.quantity, 'Ingredient amount', 1000000000), unit: item.unit };
      });
      const link = text(value.source_url, 'Recipe link', 2048, false);
      if (link && !safeUrl(link)) throw new Error('Use a full http or https recipe link.');
      return { id: value.id, request_id: value.request_id, revision: value.revision, name, servings, ingredients, instructions: text(value.instructions, 'Instructions', 20000, false), source_url: link, notes: text(value.notes, 'Notes', 4000, false), archived: false };
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
    function handleSubmit(event) {
      const form = event.target, kind = form && form.dataset && form.dataset.foodForm;
      if (!['recipe', 'log'].includes(kind)) return false;
      event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        readForm(form, kind); persist(); ready(current);
        if (kind === 'recipe') {
          const payload = recipePayload(current);
          run('Saving your recipe…', () => store.saveRecipe(payload), row => { resetGroup('recipe', recipeDraft()); editor = false; tab = 'recipes'; openedRecipeId = row && row.id || payload.id || payload.request_id; notify('Your recipe was saved for your household.'); });
        } else {
          const payload = logPayload(current);
          run('Saving this portion…', () => store.saveMealEntry(payload), () => { selectedDate = payload.occurred_on; resetGroup('log', logDraft(selectedDate)); logging = false; if (currentPage === 'food') tab = 'log'; notify(payload.kind === 'planned' ? 'The planned portion was saved separately from eaten food.' : 'This person’s eaten portion was logged.'); });
        }
      } catch (error) { persist(); notify(error.message, true); refresh(); }
      return true;
    }
    function handleInput(event) {
      const element = event.target, data = element && element.dataset;
      if (!data) return false;
      const current = snapshot();
      if (Object.hasOwn(data, 'foodSearch')) { search = String(element.value || ''); refresh('#food-recipe-search'); return true; }
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
      if (extra || !['recipe', 'log'].includes(group) || !(group === 'recipe' ? RECIPE_FIELDS : LOG_FIELDS).includes(name)) return false;
      if (!busy) {
        const previous = drafts[group][name]; drafts[group][name] = element.value; persist();
        if (group === 'log' && name === 'servings' && root.document && typeof root.document.querySelector === 'function') {
          const preview = root.document.querySelector('#food-log-nutrition-values');
          if (preview) preview.innerHTML = nutritionTable(logNutrition(current), 'This person’s portion');
        }
        if (group === 'log' && previous !== element.value && ['source_kind', 'recipe_id', 'product_id', 'kind'].includes(name)) refresh('#food-log-' + name);
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
    function download(name, content, mime) {
      if (options.download) return options.download(name, content, mime);
      if (!root.document || !root.URL || !root.Blob) throw new Error('This browser could not prepare the download.');
      const address = root.URL.createObjectURL(new Blob([content], { type: mime }));
      const anchor = root.document.createElement('a'); anchor.href = address; anchor.download = name; root.document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => root.URL.revokeObjectURL(address), 1000);
    }
    function handleClick(event) {
      const element = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-food-action]') : null;
      const data = element && element.dataset, action = data && data.foodAction;
      const actions = ['grocery', 'food-home', 'wellness', 'tab', 'new-recipe', 'resume-recipe', 'view-recipe', 'edit-recipe', 'discard-recipe', 'archive-recipe', 'add-ingredient', 'remove-ingredient', 'new-log', 'resume-log', 'log-recipe', 'edit-log', 'eaten-from-plan', 'discard-log', 'choose-person', 'delete-log', 'calendar', 'upload-file', 'view-file', 'remove-file'];
      if (!actions.includes(action)) return false;
      if (event.preventDefault) event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        if (action === 'grocery') { openGrocery(data.tab || 'list'); return true; }
        if (action === 'food-home' || action === 'wellness') { navigate(action === 'food-home' ? 'food' : 'wellness'); return true; }
        if (action === 'tab') { if (['recipes', 'soon', 'log'].includes(data.tab)) tab = data.tab; }
        else if (action === 'new-recipe') { if (dirty('recipe') && !confirm('Start a new recipe and discard your current recipe draft?')) return true; resetGroup('recipe', recipeDraft()); editor = true; openedRecipeId = ''; tab = 'recipes'; }
        else if (action === 'resume-recipe') { editor = true; tab = 'recipes'; }
        else if (action === 'view-recipe') { openedRecipeId = data.id; editor = false; selectedFile = null; tab = 'recipes'; }
        else if (action === 'edit-recipe') {
          const recipe = (current.recipes || []).find(row => row.id === data.id); if (!recipe) throw new Error('Refresh to open this recipe.');
          if (drafts.recipe.id !== recipe.id && dirty('recipe') && !confirm('Edit this recipe and discard your current recipe draft?')) return true;
          if (drafts.recipe.id !== recipe.id || !dirty('recipe')) { const value = recipeDraft(); for (const key of Object.keys(value)) if (Object.hasOwn(recipe, key)) value[key] = copy(recipe[key]); value.request_id = ''; resetGroup('recipe', value); }
          editor = true; tab = 'recipes'; openedRecipeId = recipe.id;
        } else if (action === 'discard-recipe') { if (dirty('recipe') && !confirm('Discard this recipe draft? The last saved recipe will remain.')) return true; resetGroup('recipe', recipeDraft()); editor = false; }
        else if (action === 'archive-recipe') {
          ready(current); const recipe = (current.recipes || []).find(row => row.id === data.id); if (!recipe || !confirm('Archive ' + recipe.name + '? Earlier food entries keep their saved nutrition.')) return true;
          run('Archiving the recipe…', () => store.saveRecipe({ ...recipe, archived: true }), () => { if (drafts.recipe.id === recipe.id) resetGroup('recipe', recipeDraft()); openedRecipeId = ''; editor = false; notify('The recipe was archived. Earlier food entries were kept.'); }); return true;
        } else if (action === 'add-ingredient') { if (drafts.recipe.ingredients.length < 100) drafts.recipe.ingredients.push({ product_id: '', quantity: '', unit: 'each' }); }
        else if (action === 'remove-ingredient') { const index = Number(data.index); if (drafts.recipe.ingredients.length > 1 && Number.isInteger(index) && index >= 0 && index < drafts.recipe.ingredients.length) drafts.recipe.ingredients.splice(index, 1); }
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
    function selectTab(value) { snapshot(); if (busy || !['recipes', 'soon', 'log'].includes(value)) return false; tab = value; persist(); refresh(); return true; }
    function hasUnpersistedChanges() { snapshot(); return Boolean(selectedFile || ((dirty('recipe') || dirty('log')) && !draftSaved)); }
    return { render, handleClick, handleSubmit, handleInput, handleChange, hasUnsavedDraft, hasUnpersistedChanges, discardDraft, selectTab, isBusy: () => Boolean(busy), whenIdle: () => pending, getHomeSummary: () => { const current = snapshot(); return { due: M.dueItems(current.inventory || [], dayKey(getNow())).length, recipes: (current.recipes || []).filter(row => !row.archived).length }; } };
  }
  const api = { createController, buildExpiryCalendar, allergyMatches, scaledSnapshot };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomFood = api;
})(typeof window !== 'undefined' ? window : globalThis);
