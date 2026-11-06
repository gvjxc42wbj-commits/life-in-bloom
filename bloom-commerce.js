/* Household products, shopping trips, and the money ledger. */
(function (root) {
  'use strict';

  const UNIT_CHOICES = [['each', 'Each / individual item'], ['g', 'Grams'], ['kg', 'Kilograms'], ['oz', 'Ounces (weight)'], ['lb', 'Pounds'], ['ml', 'Milliliters'], ['l', 'Liters'], ['fl_oz', 'Fluid ounces'], ['cup', 'Cups'], ['tbsp', 'Tablespoons'], ['tsp', 'Teaspoons']];
  const AISLE_CHOICES = [['produce', 'Produce'], ['meat', 'Meat'], ['seafood', 'Seafood'], ['deli', 'Deli & prepared food'], ['dairy-eggs', 'Dairy & eggs'], ['beverages', 'Beverages'], ['bakery', 'Bread & bakery'], ['frozen', 'Frozen'], ['grains', 'Rice, pasta & beans'], ['baking', 'Baking & cooking'], ['condiments', 'Condiments & sauces'], ['canned', 'Soups & canned goods'], ['breakfast', 'Breakfast'], ['snacks', 'Snacks'], ['household', 'Household supplies'], ['other', 'Other']];
  const NUTRIENT_FIELDS = [['calories_kcal', 'Calories', 'kcal'], ['protein_g', 'Protein', 'g'], ['carbs_g', 'Carbohydrates', 'g'], ['fat_g', 'Fat', 'g'], ['fiber_g', 'Fiber', 'g'], ['added_sugar_g','Added sugar','g'], ['saturated_fat_g','Saturated fat','g'], ['trans_fat_g','Trans fat','g'], ['sodium_mg', 'Sodium', 'mg'], ['calcium_mg', 'Calcium', 'mg'], ['iron_mg', 'Iron', 'mg'], ['potassium_mg', 'Potassium', 'mg'], ['vitamin_d_mcg', 'Vitamin D', 'mcg'], ['fluid_ml', 'Fluid volume', 'mL']];
  const PEOPLE = [['', 'Shared / not assigned'], ['1', 'Person 1 · pink'], ['2', 'Person 2 · purple']];
  const LOCATIONS = [['pantry', 'Pantry'], ['refrigerator', 'Refrigerator'], ['freezer', 'Freezer']];
  const DATE_TYPES = [['unknown', 'Type not specified'], ['best_before', 'Best before'], ['use_by', 'Use by'], ['sell_by', 'Sell by'], ['expiry', 'Expiration']];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const monthOf = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  const dayOf = date => monthOf(date) + '-' + String(date.getDate()).padStart(2, '0');
  const money = value => Number.isSafeInteger(Number(value)) && value != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) / 100) : 'Not set';
  const moneyInput = value => value == null ? '' : (Number(value) / 100).toFixed(2);
  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200; }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [year, month, day] = value.split('-').map(Number), date = new Date(year, month - 1, day, 12);
    return year >= 1900 && year <= 2200 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }
  function dateLabel(value) { return validDate(value) ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not recorded'; }
  function monthLabel(value) { return validMonth(value) ? new Date(value + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Choose month'; }
  function text(value, label, maximum, required) {
    const result = String(value == null ? '' : value).trim();
    if (required && !result) throw new Error('Enter ' + label.toLowerCase() + '.');
    if (result.length > maximum) throw new Error(label + ' is too long.');
    return result;
  }
  function number(value, label, optional, positive, maximum = 1000000000) {
    if (String(value == null ? '' : value).trim() === '') {
      if (optional) return null;
      throw new Error('Enter ' + label.toLowerCase() + '.');
    }
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0 || (positive && result === 0) || result > maximum) throw new Error(label + ' must be ' + (positive ? 'greater than zero' : 'zero or more') + ' and no more than ' + maximum + '.');
    return result;
  }
  function parseCents(value, optional) {
    const valueText = String(value == null ? '' : value).trim();
    if (!valueText && optional) return null;
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(valueText)) throw new Error('Enter an amount in dollars and cents, for example 12.50.');
    const [whole, fraction = ''] = valueText.split('.'), cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents > 1000000000) throw new Error('The amount must be no more than $10,000,000.00.');
    return cents;
  }
  function safeUrl(value) {
    if (!value) return '';
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (_) { return ''; }
  }
  function blankProduct() {
    const result = { id: '', request_id: uuid(), revision: null, name: '', brand: '', category: 'food', aisle: 'other', package_quantity: '1', package_unit: 'each', item_label: 'item', price: '', price_date: '', store: '', source_url: '', serving_quantity: '', serving_unit: 'each', allergens: '', notes: '', archived: false };
    NUTRIENT_FIELDS.forEach(([key]) => { result[key] = ''; });
    return result;
  }
  function blankRecurring() { return { id: '', request_id: uuid(), revision: null, product_id: '', person_slot: '', quantity: '', basis: 'units', every_days: '1', active: true }; }
  function blankBill(month) { return { id: '', request_id: uuid(), revision: null, month: month + '-01', name: '', amount: '', variable: false, due_on: '', notes: '', series_id: null, rule_id: null, is_override: false, cancelled: false, repeat_monthly: true, apply_future: false }; }
  function blankMoney(day) { return { id: uuid(), occurred_on: day, direction: 'expense', category: 'other', amount: '', description: '', payer_slot: '', bill_id: null }; }
  function blankLine() { return { key: uuid(), included: true, product_id: '', name: '', category: 'food', packs: '1', line_total: '', stock_quantity: '', stock_unit: 'each', location: 'pantry', expires_on: '', date_type: 'unknown', frozen_on: '', freezer_use_by: '', shopping_item_id: null, shopping_revision: null, stock_edited: false, cost_edited: false }; }
  function blankReceipt(day) { return { id: uuid(), purchased_on: day, store: '', payer_slot: '', notes: '', items: [blankLine()] }; }
  function blankPurchase(day) { return { ...blankReceipt(day), list_quantity: '', reference_total_cents: null, reference_unit_cents: null }; }

  function createController(options) {
    options = options || {};
    const store = options.store, refresh = options.refresh || (() => {}), notify = options.notify || (() => {});
    const confirm = options.confirm || (message => typeof root.confirm === 'function' && root.confirm(message));
    const getNow = options.getNow || (() => new Date()), navigate = options.navigate || (() => {});
    const model = options.model || root.BloomFoodModel;
    const draftStore = options.draftStore;
    if (!store || typeof store.snapshot !== 'function') throw new Error('The household store is not available.');
    let context = null, generation = 0, busy = null, pending = Promise.resolve(), sectionHandler = null, monthGuard = null;
    let month = monthOf(getNow()), section = 'catalog', query = '', aisle = 'all', catalogPage = 0;
    let productOpen = false, recurringOpen = false, receiptOpen = false, purchaseOpen = false, billOpen = false, moneyOpen = false;
    let purchaseAttempt = null, purchaseRejection = null, purchaseSuccess = null, selectedReceiptId = null;
    let billLoads = new Map(), billLoadJob = Promise.resolve();
    let drafts, baselines, review = null, recurringReview = null, fileTarget = null, fileSelection = null, fileLinks = new Map();
    let draftStatus = '', budgetVersion = null, quickAdds = {}, draftWriteFailed = false;

    function resetAll() {
      drafts = { product: blankProduct(), recurring: blankRecurring(), receipt: blankReceipt(dayOf(getNow())), purchase: blankPurchase(dayOf(getNow())), bill: blankBill(month), money: blankMoney(dayOf(getNow())), budget: { amount: '', household_amount: '', revision: null } };
      baselines = clone(drafts); review = null; recurringReview = null; fileTarget = null; fileSelection = null; fileLinks = new Map();
      productOpen = false; recurringOpen = false; receiptOpen = false; purchaseOpen = false; billOpen = false; moneyOpen = false; budgetVersion = null; draftStatus = '';
      purchaseAttempt = null; purchaseRejection = null; purchaseSuccess = null; selectedReceiptId = null;
      billLoads = new Map();
      quickAdds = {}; draftWriteFailed = false;
    }
    resetAll();
    function snapshot() {
      const value = store.snapshot() || {};
      const next = (value.user && value.user.id || '') + ':' + (value.household && value.household.id || '');
      if (next !== context) {
        context = next; generation++; busy = null; month = monthOf(getNow()); query = ''; aisle = 'all'; catalogPage = 0; resetAll();
        if (draftStore && value.user && value.household) {
          try {
            const saved = draftStore.read(value.user.id, value.household.id, 'commerce');
            const data = saved && saved.data;
            if (data && data.version === 1 && data.drafts && data.baselines) {
              for (const group of Object.keys(drafts)) if (data.drafts[group] && data.baselines[group]) {
                const restore = value => group === 'bill' ? { ...blankBill(month), ...clone(value), repeat_monthly: Object.hasOwn(value, 'repeat_monthly') ? value.repeat_monthly === true : Boolean(value.series_id) } : clone(value);
                drafts[group] = restore(data.drafts[group]); baselines[group] = restore(data.baselines[group]);
              }
              if (validMonth(data.month)) month = data.month;
              if (data.quickAdds && typeof data.quickAdds === 'object' && !Array.isArray(data.quickAdds)) quickAdds = clone(data.quickAdds);
              // Restore the product draft, but let the user choose when to open it.
              productOpen = false; recurringOpen = Boolean(data.recurringOpen); receiptOpen = Boolean(data.receiptOpen); purchaseOpen = Boolean(data.purchaseOpen); billOpen = Boolean(data.billOpen); moneyOpen = Boolean(data.moneyOpen);
              if (data.purchaseAttempt && data.purchaseAttempt.id === drafts.purchase.id && Array.isArray(data.purchaseAttempt.items) && data.purchaseAttempt.items.length === 1) purchaseAttempt = clone(data.purchaseAttempt);
              if (typeof data.purchaseRejection === 'string') purchaseRejection = data.purchaseRejection;
              draftStatus = 'Your device draft was restored.';
            }
          } catch (_) { draftStatus = 'Your saved device draft could not be opened.'; }
        }
      }
      return value;
    }
    function persist() {
      if (!draftStore) return;
      const value = store.snapshot() || {};
      if (!value.user || !value.household) return;
      const previouslyFailed = draftWriteFailed;
      try {
        const ok = draftStore.write(value.user.id, value.household.id, 'commerce', { version: 1, month, drafts, baselines, quickAdds, productOpen, recurringOpen, receiptOpen, purchaseOpen, purchaseAttempt, purchaseRejection, billOpen, moneyOpen });
        draftWriteFailed = !ok;
        draftStatus = ok ? 'Draft saved on this device.' : 'This device could not save the draft. Keep this page open until you save online.';
      } catch (_) { draftWriteFailed = true; draftStatus = 'This device could not save the draft. Keep this page open until you save online.'; }
      if (draftWriteFailed && !previouslyFailed) notify(draftStatus, true);
    }
    function dirty(group) { return JSON.stringify(drafts[group]) !== JSON.stringify(baselines[group]); }
    function hasUnsavedDraft() { snapshot(); return Boolean(busy) || purchaseOpen || Boolean(purchaseAttempt) || Object.keys(drafts).some(dirty) || Boolean(fileSelection) || Object.keys(quickAdds).length > 0; }
    function resetGroup(group, value) { drafts[group] = clone(value); baselines[group] = clone(value); persist(); }
    function discardDraft() { if (busy) return false; snapshot(); resetAll(); persist(); return true; }
    function requireReady(current) {
      if (current.status === 'ready' && current.user && current.household) return true;
      notify('Open Grocery and sign in to your household first.', true); return false;
    }
    function run(label, action, success) {
      if (busy) return;
      const token = { generation, context }; busy = { label, token }; refresh();
      pending = Promise.resolve().then(action).then(result => {
        snapshot(); if (token.generation !== generation || token.context !== context) return;
        if (success) success(result); persist();
      }).catch(error => {
        snapshot(); if (token.generation === generation && token.context === context) { persist(); notify(error && error.message || 'This change could not be saved. Your draft is still here.', true); }
      }).finally(() => { if (busy && busy.token === token) { busy = null; refresh(); } });
    }
    function disabled(group) { return busy || (group === 'purchase' && purchaseAttempt) ? ' disabled' : ''; }
    function button(action, label, data, primary) { return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-commerce-action="' + action + '"' + (data || '') + disabled() + '>' + label + '</button>'; }
    function input(group, key, label, attrs) {
      const id = 'commerce-' + group + '-' + key.replace(/_/g, '-');
      return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" name="' + key + '" data-commerce-field="' + group + '.' + key + '" value="' + esc(drafts[group][key]) + '" ' + (attrs || 'type="text"') + disabled(group) + '></label>';
    }
    function select(group, key, label, choices) { const id = 'commerce-' + group + '-' + key; return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><select id="' + id + '" name="' + key + '" data-commerce-field="' + group + '.' + key + '"' + disabled(group) + '>' + choices.map(([value, name]) => '<option value="' + esc(value) + '"' + (String(drafts[group][key]) === String(value) ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select></label>'; }
    function textarea(group, key, label, maximum) { const id = 'commerce-' + group + '-' + key; return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><textarea id="' + id + '" name="' + key + '" rows="3" maxlength="' + maximum + '" data-commerce-field="' + group + '.' + key + '"' + disabled(group) + '>' + esc(drafts[group][key]) + '</textarea></label>'; }
    function checkbox(group, key, label) { return '<label class="commerce-check"><input type="checkbox" name="' + key + '" data-commerce-field="' + group + '.' + key + '"' + (drafts[group][key] ? ' checked' : '') + disabled() + '><span>' + label + '</span></label>'; }
    function form(group, contents, label) { return '<form class="grocery-form" data-commerce-form="' + group + '">' + contents + '<div class="grocery-actions"><button type="submit" class="button primary"' + disabled() + '>' + label + '</button>' + button('discard', 'Discard changes', ' data-group="' + group + '"') + '</div></form>'; }
    function monthPicker() { return '<label class="grocery-field grocery-month-picker" for="commerce-month"><span>Month</span><input id="commerce-month" type="month" min="1900-01" max="2200-12" value="' + month + '" data-commerce-month' + disabled() + '></label>'; }
    function productChoices(current, includeBlank = true) { return (includeBlank ? [['', 'Choose a saved product']] : []).concat((current.products || []).filter(product => !product.archived).map(product => [product.id, product.name + (product.brand ? ' · ' + product.brand : '')])); }
    function caption(current) { return '<p class="grocery-help commerce-draft-status" role="status">' + esc(current.offline ? 'Offline — saved device copy. Changes are drafts until saved online.' : draftStatus || 'Your saved household records are online.') + '</p>'; }
    function empty(message) { return '<div class="grocery-empty"><p>' + esc(message) + '</p></div>'; }
    function navigateSection(value) { if (sectionHandler && sectionHandler(value, month) === false) return false; section = value; if (!sectionHandler) refresh(); return true; }
    function setMonth(value) {
      const next = String(value || '').slice(0, 7);
      if (!validMonth(next)) return false;
      // Grocery owns a separate budget draft. Its guard must run even when
      // Commerce already displays this month, before either controller resets.
      if (monthGuard && monthGuard(next) === false) return false;
      if (next === month) return true;
      if ((dirty('budget') || dirty('bill')) && !confirm('Change month and discard the unsaved budget or bill form?')) return false;
      month = next; resetGroup('budget', { amount: '', household_amount: '', revision: null }); resetGroup('bill', blankBill(month)); budgetVersion = null; recurringReview = null; persist(); return true;
    }
    function billLoadKey(current, targetMonth = month) {
      const rules = current.billRules || [];
      if (!rules.length || typeof store.ensureBillMonth !== 'function') return null;
      const versions = rules.map(rule => [rule.id, rule.series_id, rule.effective_month, rule.name, rule.amount_cents, rule.variable, rule.active, rule.due_day, rule.notes, rule.revision, rule.updated_at]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return context + ':' + targetMonth + ':' + JSON.stringify(versions);
    }
    function queueBillMonth(current, retry = false) {
      const key = billLoadKey(current);
      if (!key || current.offline || current.status !== 'ready' || !current.user || !current.household || busy) return;
      if (billLoads.has(key) && !(retry && billLoads.get(key) === 'failed')) return;
      const targetMonth = month, token = { context, generation };
      billLoads.set(key, 'queued');
      // Start after this render completes. The keyed queued/loading state
      // prevents store refreshes from scheduling another request recursively.
      billLoadJob = Promise.resolve().then(() => {
        snapshot();
        if (token.context !== context || token.generation !== generation) return;
        if (targetMonth !== month || busy) { billLoads.delete(key); return; }
        billLoads.set(key, 'loading');
        run('Opening this month’s bills…', async () => {
          try { return await store.ensureBillMonth(targetMonth); }
          catch (error) { if (token.context === context && token.generation === generation) billLoads.set(key, 'failed'); throw error; }
        }, () => { billLoads.set(key, 'ready'); });
        return pending;
      });
    }
    function openMoneyMonth(targetMonth) {
      const current = snapshot();
      if (busy || !requireReady(current) || !setMonth(targetMonth || month)) return false;
      section = 'money'; queueBillMonth(current); navigate('money'); refresh(); return true;
    }
    async function whenIdle() {
      let work, billWork;
      do { work = pending; billWork = billLoadJob; await Promise.all([work, billWork]); } while (work !== pending || billWork !== billLoadJob);
    }

    function renderProductForm(current) {
      const value = drafts.product;
      let html = '<section class="panel commerce-editor"><h3 class="commerce-disclosure-heading"><button id="commerce-product-toggle" type="button" class="commerce-disclosure-toggle" data-commerce-action="toggle-product" aria-expanded="' + productOpen + '" aria-controls="commerce-product-editor"' + disabled() + '><span>' + (value.id ? 'Edit product' : 'Add a product') + '</span><span class="commerce-disclosure-state">' + (productOpen ? 'Open' : 'Closed') + '<span class="commerce-disclosure-chevron" aria-hidden="true">⌄</span></span></button></h3><div id="commerce-product-editor"' + (productOpen ? '' : ' hidden') + '>';
      if (!productOpen) return html + '</div>' + (dirty('product') ? '<p class="grocery-help commerce-collapsed-draft">Your unfinished product is kept. Open this section to continue.</p>' : '') + '</section>';
      html += '<div class="panel-title-row"><span class="pill">Catalog reference</span>' + (value.id ? button('new-product', '+ Add a different product') : '') + '</div><p class="grocery-help">Save the package and its label once. Prices here are dated estimates; saving a product does not record a purchase.</p>';
      const contents = '<div class="grocery-form-grid">' + input('product', 'name', 'Product name', 'type="text" required maxlength="160" autocomplete="off"') + input('product', 'brand', 'Brand', 'type="text" maxlength="120" autocomplete="off"') + select('product', 'category', 'Budget category', [['food', 'Food'], ['household', 'Household']]) + select('product', 'aisle', 'Shopping category', AISLE_CHOICES) + input('product', 'package_quantity', 'Amount in one purchased package', 'type="number" min="0" step="any" max="1000000000" required inputmode="decimal"') + select('product', 'package_unit', 'Package unit', UNIT_CHOICES) + input('product', 'item_label', 'Name for one individual item', 'type="text" maxlength="40" placeholder="For example, carton or bottle"') + input('product', 'price', 'Reference price per package (USD)', 'type="text" inputmode="decimal" maxlength="12" placeholder="Leave blank if unknown"') + input('product', 'price_date', 'Date of this reference price', 'type="date" min="1900-01-01" max="2200-12-31"') + input('product', 'store', 'Store', 'type="text" maxlength="160" autocomplete="off"') + '</div>' + input('product', 'source_url', 'Product or price reference link', 'type="url" maxlength="2000" placeholder="https://…"') + '<details class="commerce-details"' + (NUTRIENT_FIELDS.some(([key]) => value[key] !== '') ? ' open' : '') + '><summary>Nutrition label and serving size</summary><p class="grocery-help">Enter values from this product’s label. Blank means unknown; enter 0 only when the label says zero.</p><div class="grocery-form-grid">' + input('product', 'serving_quantity', 'Amount in one nutrition-label serving', 'type="number" min="0" step="any" max="1000000000" inputmode="decimal"') + select('product', 'serving_unit', 'Nutrition serving unit', UNIT_CHOICES) + '</div><div class="commerce-nutrients">' + NUTRIENT_FIELDS.map(([key, label, unit]) => input('product', key, label + ' (' + unit + ')', 'type="number" min="0" step="any" max="1000000000" inputmode="decimal"')).join('') + '</div></details>' + textarea('product', 'allergens', 'Allergens and label cautions', 4000) + textarea('product', 'notes', 'Product notes', 4000);
      html += form('product', contents, value.id ? 'Save product changes' : 'Save product');
      if (value.id) html += renderFiles(current, value.id);
      else html += '<p class="grocery-help">After saving, open this product to attach its photo, nutrition label, or PDF.</p>';
      return html + '</div></section>';
    }
    function renderFiles(current, productId) {
      const files = (current.foodFiles || []).filter(file => file.product_id === productId);
      let html = '<div class="commerce-files"><h4>Product photos and files</h4><p class="grocery-help">Saved privately for your household. Photos and PDFs are references; their contents are not automatically entered.</p><label class="grocery-field"><span>Choose a JPG, PNG, WebP, or PDF · up to 10 MB</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-commerce-upload="' + esc(productId) + '"' + disabled() + '></label>';
      if (fileSelection && fileTarget === productId) html += '<p class="grocery-help">Ready to upload: ' + esc(fileSelection.name) + '</p>' + button('upload-file', 'Save this file', ' data-id="' + esc(productId) + '"', true);
      if (files.length) html += '<ul class="commerce-file-list">' + files.map(file => '<li><span>' + esc(file.name) + '</span><div class="grocery-actions">' + (fileLinks.has(file.id) && fileLinks.get(file.id).expiresAt > Date.now() ? '<a class="button" href="' + esc(fileLinks.get(file.id).url) + '" target="_blank" rel="noopener noreferrer">Open file ↗</a>' : button('open-file', 'Get file link', ' data-id="' + esc(file.id) + '"')) + button('remove-file', 'Remove', ' data-id="' + esc(file.id) + '"') + '</div></li>').join('') + '</ul>';
      return html + '</div>';
    }
    function catalogResults(current) {
      const all = (current.products || []).filter(product => !product.archived);
      const search = query.trim().toLocaleLowerCase();
      const rows = all.filter(product => (aisle === 'all' || product.aisle === aisle) && (!search || [product.name, product.brand, product.store].some(value => String(value || '').toLocaleLowerCase().includes(search))));
      const pageCount = Math.max(1, Math.ceil(rows.length / 24)); catalogPage = Math.min(catalogPage, pageCount - 1);
      const visible = rows.slice(catalogPage * 24, catalogPage * 24 + 24);
      const summary = rows.length + ' matching product' + (rows.length === 1 ? '' : 's') + ' · ' + all.length + ' saved';
      if (!rows.length) return { summary, html: '<section class="panel">' + empty(all.length ? 'No products match this search. Try a different name or category.' : 'Add your first product, then use it in shopping lists, inventory, and recipes.') + '</section>' };
      let html = '<div class="commerce-product-grid">' + visible.map(product => '<article class="panel commerce-product"><div class="commerce-product-top"><span class="pill">' + esc(product.category === 'household' ? 'Household' : AISLE_CHOICES.find(([value]) => value === product.aisle)?.[1] || 'Food') + '</span>' + (product.brand ? '<small>' + esc(product.brand) + '</small>' : '') + '</div><h3>' + esc(product.name) + '</h3><p>' + esc(product.package_size_text || (product.package_quantity + ' ' + product.package_unit)) + '</p>' + (product.import_id ? '<p class="grocery-help">Master ID ' + esc(product.import_id) + (product.icon_id ? ' · icon ' + esc(product.icon_id) : '') + '</p>' : '') + '<strong class="commerce-product-price">' + (product.price_cents == null ? 'Price needed' : money(product.price_cents)) + '</strong><p class="grocery-help">' + esc(product.store || 'Store not recorded') + ' · ' + esc(dateLabel(product.price_date)) + (product.price_status ? ' · ' + esc(product.price_status) : '') + '</p>' + (product.regular_price_cents != null ? '<p class="grocery-help">Regular reference ' + money(product.regular_price_cents) + '</p>' : '') + '<div class="grocery-actions">' + button('product-to-list', '+ Add 1 package', ' data-id="' + esc(product.id) + '"', true) + button('edit-product', 'Details & edit', ' data-id="' + esc(product.id) + '"') + '</div></article>').join('') + '</div>';
      if (pageCount > 1) html += '<div class="commerce-pagination">' + button('catalog-prev', '‹ Previous', catalogPage === 0 ? ' disabled' : '') + '<span>Page ' + (catalogPage + 1) + ' of ' + pageCount + '</span>' + button('catalog-next', 'Next ›', catalogPage >= pageCount - 1 ? ' disabled' : '') + '</div>';
      return { summary, html };
    }
    function refreshCatalogResults(current) {
      // The app replaces only the results and count, preserving the live input,
      // native caret, composition, and focus through input and blur/change events.
      if (options.updateCatalogResults) options.updateCatalogResults(catalogResults(current));
      else refresh('#commerce-search');
    }
    function renderCatalog(current) {
      const results = catalogResults(current);
      return '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">Your product catalog</p><h2>Foods and household favorites</h2></div></div><p class="grocery-help">Keep every product you use, with its package, dated price, and nutrition label. Your catalog can grow beyond 38 products.</p><div class="grocery-form-grid"><label class="grocery-field" for="commerce-search"><span>Find a product</span><input id="commerce-search" type="search" data-commerce-search value="' + esc(query) + '" placeholder="Name, brand, or store" autocomplete="off"></label><label class="grocery-field" for="commerce-aisle"><span>Category</span><select id="commerce-aisle" data-commerce-aisle><option value="all">All categories</option>' + AISLE_CHOICES.map(([value, label]) => '<option value="' + value + '"' + (aisle === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></div><p id="commerce-catalog-count" class="grocery-help" role="status" aria-atomic="true">' + results.summary + '</p></section>' + renderProductForm(current) + '<div id="commerce-catalog-results">' + results.html + '</div>';
    }
    function recurrenceSignature(current) { return JSON.stringify([month, current.products, current.recurringProducts, current.inventory, current.shoppingItems]); }
    function renderRecurring(current) {
      const rows = current.recurringProducts || [];
      let html = '<section class="panel"><div class="grocery-month-heading"><div><p class="page-kicker">Recurring products</p><h2>Plan the things you use regularly</h2></div>' + monthPicker() + '</div><p class="grocery-help">Set each product’s frequency. Review a whole calendar month before adding packages to the shopping list. This is planned supply, not a record of food eaten.</p><div class="grocery-actions">' + button('new-recurring', '+ Add a regular product') + button('review-recurring', 'Review monthly quantities', '', true) + '</div></section>';
      if (recurringOpen) html += '<section class="panel"><h3>' + (drafts.recurring.id ? 'Edit regular product' : 'Add a regular product') + '</h3>' + form('recurring', '<div class="grocery-form-grid">' + select('recurring', 'product_id', 'Saved product', productChoices(current)) + select('recurring', 'person_slot', 'For whom?', PEOPLE) + input('recurring', 'quantity', 'Quantity used each time', 'type="number" min="0" step="any" required inputmode="decimal"') + select('recurring', 'basis', 'Quantity means', [['units', 'Individual product units'], ['packs', 'Purchased packages']]) + input('recurring', 'every_days', 'Every how many days?', 'type="number" min="1" max="3660" step="1" required inputmode="numeric"') + '</div>' + checkbox('recurring', 'active', 'Include this product in monthly planning') + '<p class="grocery-help">For a 12-carton package, individual product units means cartons. Choose packages for a canister used over several days.</p>', 'Save frequency') + '</section>';
      if (recurringReview) {
        const plan = recurringReview.plan, existing = new Set((current.shoppingItems || []).map(row => row.source_key).filter(Boolean));
        html += '<section class="panel commerce-review"><p class="page-kicker">Review your plan</p><h3>' + monthLabel(month) + ' · ' + plan.days + ' days</h3>' + ((plan.issues || []).length ? '<ul class="commerce-plan-issues">' + plan.issues.map(issue => '<li>' + esc(typeof issue === 'string' ? issue : issue.message || 'Review this product’s planned quantity.') + '</li>').join('') + '</ul>' : '') + '<p class="grocery-help">Amounts already at home are considered where units match. Packages round up. Check these estimates against what you still need.</p><ul class="commerce-review-list">' + plan.items.map(item => '<li><div><strong>' + esc(item.name) + '</strong><small>' + esc(item.required_quantity) + ' ' + esc(item.package_unit) + ' planned · ' + esc(item.stock_quantity) + ' at home</small>' + (item.notes || []).map(note => '<small class="commerce-plan-note">' + esc(note) + '</small>').join('') + '</div><div><strong>' + esc(item.packs) + ' package' + (item.packs === 1 ? '' : 's') + '</strong><small>' + (item.estimate_cents == null ? 'Price needed' : money(item.estimate_cents)) + '</small>' + (existing.has('recurring:' + month + ':' + item.product_id) ? '<small>Already added this month</small>' : '') + '</div></li>').join('') + '</ul><div class="commerce-estimate-stack"><span>Known subtotal <strong>' + money(plan.known_total_cents) + '</strong></span><span>3% estimated tax <strong>' + money(plan.estimated_tax_cents == null ? Math.round(plan.known_total_cents * 0.03) : plan.estimated_tax_cents) + '</strong></span><span>Estimated total <strong>' + money(plan.estimated_total_cents == null ? plan.known_total_cents + Math.round(plan.known_total_cents * 0.03) : plan.estimated_total_cents) + '</strong></span></div><p class="grocery-help">' + (plan.missing_prices ? plan.missing_prices + ' product price(s) needed; total is incomplete.' : 'Estimate only. Actual spending comes from your recorded receipt.') + '</p><div class="grocery-actions">' + button('confirm-recurring', 'Add reviewed packages to ' + monthLabel(month), '', true) + button('cancel-recurring', 'Keep reviewing later') + '</div></section>';
      }
      html += '<section class="panel"><h3>Your saved frequencies</h3>';
      if (!rows.length) html += empty('Add products you buy regularly. Other catalog products stay unscheduled.');
      else html += '<ul class="commerce-record-list">' + rows.map(row => {
        const product = (current.products || []).find(item => item.id === row.product_id);
        return '<li><div><span class="commerce-person person-' + (row.person_slot || 'shared') + '">' + (row.person_slot ? 'Person ' + row.person_slot : 'Shared / unassigned') + '</span><h4>' + esc(product && product.name || 'Unavailable product') + '</h4><p>' + esc(row.quantity) + ' ' + (row.basis === 'packs' ? 'package(s)' : esc(product && product.package_unit || 'units')) + ' every ' + esc(row.every_days) + ' day(s)' + (row.active ? '' : ' · Paused') + '</p></div>' + button('edit-recurring', 'Edit frequency', ' data-id="' + esc(row.id) + '"') + '</li>';
      }).join('') + '</ul>';
      return html + '</section>';
    }

    function lineInput(item, key, label, attrs, group = 'receipt') { const id = group === 'purchase' ? 'commerce-purchase-' + key.replace(/_/g, '-') : 'commerce-line-' + item.key + '-' + key; return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" name="line.' + item.key + '.' + key + '" data-commerce-line="' + esc(item.key) + '" data-commerce-line-group="' + group + '" data-line-field="' + key + '" value="' + esc(item[key]) + '" ' + (attrs || 'type="text"') + disabled(group) + '></label>'; }
    function lineSelect(item, key, label, choices, group = 'receipt') { const id = group === 'purchase' ? 'commerce-purchase-' + key.replace(/_/g, '-') : 'commerce-line-' + item.key + '-' + key; return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><select id="' + id + '" name="line.' + item.key + '.' + key + '" data-commerce-line="' + esc(item.key) + '" data-commerce-line-group="' + group + '" data-line-field="' + key + '"' + disabled(group) + '>' + choices.map(([value, name]) => '<option value="' + esc(value) + '"' + (String(item[key]) === String(value) ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select></label>'; }
    function purchaseLinks(targetMonth, receiptId) {
      return '<div class="grocery-actions commerce-purchase-links">' + [['inventory', 'Food at home'], ['receipts', 'Shopping trips'], ['budget', 'Monthly budget'], ['money', 'Money in Bloom']].map(([destination, label]) => button('purchase-destination', label + ' ›', ' data-destination="' + destination + '" data-month="' + esc(targetMonth) + '"' + (destination === 'receipts' && receiptId ? ' data-receipt-id="' + esc(receiptId) + '"' : ''))).join('') + '</div>';
    }
    function renderPurchase() {
      const current = snapshot();
      if (current.status !== 'ready' || !current.user || !current.household) return '';
      const value = drafts.purchase, item = value.items && value.items[0];
      if (!purchaseOpen) {
        if (purchaseAttempt) return '<section class="panel commerce-page commerce-inline-purchase"><h3>Finish checking this purchase</h3><p class="grocery-help">The saved draft for ' + esc(item && item.name || 'this item') + ' is kept with its original details. Reopen it to check that the save completed.</p>' + button('resume-purchase', 'Resume purchase', '', true) + purchaseLinks(value.purchased_on.slice(0, 7)) + '</section>';
        if (!purchaseSuccess) return '';
        return '<section class="panel commerce-page commerce-purchase-success" role="status"><h3>' + (purchaseSuccess.already_saved ? 'Purchase already saved' : 'Purchase saved') + '</h3><p><strong>' + esc(purchaseSuccess.name) + '</strong> · ' + money(purchaseSuccess.amount_cents) + '</p><p class="grocery-help">' + (purchaseSuccess.category === 'food' ? 'The food was added to inventory. ' : '') + 'Your shopping trip, money ledger, monthly spending, and budget history now include this purchase.</p>' + purchaseLinks(purchaseSuccess.month, purchaseSuccess.id) + '</section>';
      }
      if (!item) return '';
      const food = item.category === 'food';
      let html = '<section class="panel commerce-page commerce-inline-purchase" aria-labelledby="commerce-purchase-heading"' + (busy ? ' aria-busy="true"' : '') + '><p class="page-kicker">From your shopping list</p><h3 id="commerce-purchase-heading">Save this purchase: ' + esc(item.name) + '</h3>';
      if (value.list_quantity) html += '<p class="grocery-help">On your list: ' + esc(value.list_quantity) + '</p>';
      html += '<p class="grocery-help">Confirm what you bought and the total you paid. Saving once updates your shopping trip, ' + (food ? 'food inventory, ' : '') + 'money ledger, monthly budget, and history.</p>';
      if (value.reference_total_cents != null) html += '<p class="commerce-price-hint">List estimate: ' + money(value.reference_total_cents) + '. Confirm or change the actual total below, including any discount, tax, or deposit for this item.</p>';
      if (purchaseAttempt) html += '<p class="commerce-purchase-alert" role="alert">The last save has not been confirmed. Retry the same purchase to finish checking it; its details are kept unchanged.</p>';
      if (purchaseRejection) html += '<p class="commerce-purchase-alert" role="alert">This purchase was not accepted. Correct the details below. If the shopping list changed, reload the item and review its latest quantities.</p>';
      html += '<form class="grocery-form" data-commerce-form="purchase"><div class="grocery-form-grid">' + lineInput(item, 'line_total', 'Actual total paid for this item (USD)', 'type="text" inputmode="decimal" maxlength="12" required placeholder="For example, 12.50"', 'purchase') + lineInput(item, 'packs', 'Packages or items bought', 'type="number" min="0.000001" max="1000000000" step="any" required inputmode="decimal"', 'purchase') + input('purchase', 'purchased_on', 'Purchase date', 'type="date" min="1900-01-01" max="2200-12-31" required') + lineSelect(item, 'category', 'Budget category', [['food', 'Food'], ['household', 'Household']], 'purchase') + '</div>';
      if (food) html += '<fieldset class="commerce-purchase-stock"><legend>Add to Food already at home</legend><div class="grocery-form-grid">' + lineInput(item, 'stock_quantity', 'Total food amount you brought home', 'type="number" min="0.000001" max="1000000000" step="any" required inputmode="decimal"', 'purchase') + lineSelect(item, 'stock_unit', 'Food amount unit', UNIT_CHOICES, 'purchase') + lineSelect(item, 'location', 'Store it in', LOCATIONS, 'purchase') + '</div><p class="grocery-help">A package can contain several individual items. Check the total food amount and where you will keep it.</p></fieldset>';
      html += '<details class="commerce-details"><summary>Store, person, and optional food dates</summary><div class="grocery-form-grid">' + input('purchase', 'store', 'Store (optional)', 'type="text" maxlength="160" autocomplete="off"') + select('purchase', 'payer_slot', 'Who paid?', PEOPLE) + (food ? lineInput(item, 'expires_on', 'Printed package / expiration date', 'type="date" min="1900-01-01" max="2200-12-31"', 'purchase') + lineSelect(item, 'date_type', 'Type of printed date', DATE_TYPES, 'purchase') + lineInput(item, 'frozen_on', 'Date you froze this food (optional)', 'type="date" min="1900-01-01" max="2200-12-31"', 'purchase') + lineInput(item, 'freezer_use_by', 'Your freezer reminder date (optional)', 'type="date" min="1900-01-01" max="2200-12-31"', 'purchase') : '') + '</div>' + textarea('purchase', 'notes', 'Purchase notes', 4000) + '</details><div class="grocery-actions"><button type="submit" class="button primary"' + (busy || current.offline ? ' disabled' : '') + '>' + (purchaseAttempt ? 'Retry save' : 'Save purchase') + '</button>' + button('cancel-purchase', purchaseAttempt ? 'Close for now' : 'Cancel') + (purchaseRejection ? button('reload-purchase', 'Reload list item') : '') + '</div>';
      if (current.offline) html += '<p class="grocery-help">Your details can stay as a device draft. Connect to save this purchase and update the household.</p>';
      return html + '<p class="grocery-help commerce-draft-status" role="status">' + esc(draftStatus) + '</p></form></section>';
    }
    function renderReceiptForm(current) {
      if (!receiptOpen) return '';
      let fields = '<div class="grocery-form-grid">' + input('receipt', 'purchased_on', 'Purchase date', 'type="date" min="1900-01-01" max="2200-12-31" required') + input('receipt', 'store', 'Store', 'type="text" maxlength="160" autocomplete="off"') + select('receipt', 'payer_slot', 'Who paid?', PEOPLE) + '</div><p class="grocery-help">Select the items you actually bought. Check quantities and the amount paid against your receipt. Enter line totals after discounts and include any tax or deposit in the appropriate totals.</p><div class="commerce-receipt-lines">';
      fields += drafts.receipt.items.map((item, index) => '<fieldset class="commerce-receipt-line' + (item.included ? '' : ' is-excluded') + '"><legend>Item ' + (index + 1) + '</legend><div class="commerce-line-top"><label class="commerce-check"><input type="checkbox" data-commerce-line="' + esc(item.key) + '" data-line-field="included"' + (item.included ? ' checked' : '') + disabled() + '><span>I bought this item</span></label>' + button('remove-receipt-line', 'Remove line', ' data-key="' + esc(item.key) + '"') + '</div><div class="grocery-form-grid">' + lineSelect(item, 'product_id', 'Catalog product (optional)', [['', 'Enter manually'], ...productChoices(current, false)]) + lineInput(item, 'name', 'Item name', 'type="text" maxlength="160"') + lineSelect(item, 'category', 'Budget category', [['food', 'Food'], ['household', 'Household']]) + lineInput(item, 'packs', 'Packages purchased', 'type="number" min="0" step="any" inputmode="decimal"') + lineInput(item, 'line_total', 'Actual total paid for this line (USD)', 'type="text" inputmode="decimal" maxlength="12" placeholder="Check your receipt"') + '</div>' + (item.category === 'food' ? '<details class="commerce-details"' + (item.stock_quantity !== '' ? ' open' : '') + '><summary>Add this food to inventory</summary><p class="grocery-help">Check the actual amount and storage location. ' + (item.shopping_item_id ? 'Enter a food amount greater than zero so this checked shopping item is added to Food already at home.' : 'Leave the amount blank if you do not want to add this line to inventory.') + '</p><div class="grocery-form-grid">' + lineInput(item, 'stock_quantity', 'Total food amount purchased', 'type="number" min="' + (item.shopping_item_id ? '0.000001' : '0') + '" step="any" max="1000000000" inputmode="decimal"' + (item.shopping_item_id ? ' required' : '')) + lineSelect(item, 'stock_unit', 'Food amount unit', UNIT_CHOICES) + lineSelect(item, 'location', 'Store it in', LOCATIONS) + lineInput(item, 'expires_on', 'Printed package / expiration date', 'type="date" min="1900-01-01" max="2200-12-31"') + lineSelect(item, 'date_type', 'Type of printed date', DATE_TYPES) + lineInput(item, 'frozen_on', 'Date frozen (if applicable)', 'type="date" min="1900-01-01" max="2200-12-31"') + lineInput(item, 'freezer_use_by', 'Your freezer reminder date (optional)', 'type="date" min="1900-01-01" max="2200-12-31"') + '</div></details>' : '') + '</fieldset>').join('');
      fields += '</div><div class="grocery-actions">' + button('add-receipt-line', '+ Add another item') + '</div>' + textarea('receipt', 'notes', 'Receipt notes', 4000);
      let html = '<section class="panel commerce-editor"><h3>Record a shopping trip</h3>' + form('receipt', fields, 'Review this shopping trip') + '</section>';
      if (review) html += '<section class="panel commerce-review"><p class="page-kicker">Confirm actual spending</p><h3>' + dateLabel(review.purchased_on) + ' · ' + esc(review.store || 'Shopping trip') + '</h3><ul class="commerce-review-list">' + review.items.map(item => '<li><div><strong>' + esc(item.name) + '</strong><small>' + esc(item.packs) + ' package(s) · ' + (item.category === 'food' ? 'Food' : 'Household') + (item.stock_quantity > 0 ? ' · Add ' + esc(item.stock_quantity) + ' ' + esc(item.stock_unit) + ' to ' + esc(item.location) : '') + '</small></div><strong>' + money(item.line_total_cents) + '</strong></li>').join('') + '</ul><div class="commerce-review-total"><span>Actual receipt total</span><strong>' + money(review.items.reduce((sum, item) => sum + item.line_total_cents, 0)) + '</strong></div><p class="grocery-help">Saving this receipt adds its expenses to Money in Bloom once and adds the listed food amounts to inventory. Your shopping-list estimate alone never creates spending.</p><div class="grocery-actions">' + button('confirm-receipt', 'Record receipt, inventory & spending', '', true) + button('cancel-receipt-review', 'Back to editing') + '</div></section>';
      return html;
    }
    function renderReceipts(current) {
      const rows = (current.receipts || []).filter(receipt => receipt.purchased_on && receipt.purchased_on.startsWith(month)).slice().sort((a, b) => b.purchased_on.localeCompare(a.purchased_on));
      let html = '<section class="panel"><div class="grocery-month-heading"><div><p class="page-kicker">Grocery purchases</p><h2>Your shopping trips</h2></div>' + monthPicker() + '</div><p class="grocery-help">Each saved receipt keeps every item and records Food and Household spending in the same money ledger.</p><div class="grocery-actions">' + button('new-receipt', '+ Record a shopping trip', '', true) + '</div></section>' + renderReceiptForm(current) + '<section class="panel"><h3>' + monthLabel(month) + ' receipts</h3>';
      if (!rows.length) html += empty('No receipts recorded for this month. Your catalog prices and shopping estimates do not count as spending.');
      else html += '<div class="commerce-receipt-history">' + rows.map(receipt => '<details id="commerce-receipt-' + esc(receipt.id) + '" tabindex="-1" class="commerce-receipt-record' + (receipt.voided_at ? ' is-voided' : '') + '"' + (receipt.id === selectedReceiptId ? ' open' : '') + '><summary><span>' + esc(receipt.store || 'Shopping trip') + '<small>' + dateLabel(receipt.purchased_on) + (receipt.voided_at ? ' · Reversed' : '') + '</small></span><strong>' + money(Number(receipt.total_cents)) + '</strong></summary><ul class="commerce-review-list">' + (receipt.items || []).map(item => '<li><div><strong>' + esc(item.name) + '</strong><small>' + esc(item.packs) + ' package(s) · ' + (item.category === 'household' ? 'Household' : 'Food') + '</small></div><strong>' + money(Number(item.line_total_cents)) + '</strong></li>').join('') + '</ul>' + (receipt.notes ? '<p class="commerce-note">' + esc(receipt.notes) + '</p>' : '') + (!receipt.voided_at ? button('void-receipt', 'Reverse this receipt', ' data-id="' + esc(receipt.id) + '"') : '') + '</details>').join('') + '</div>';
      return html + '</section>';
    }
    function moneySummary(current) { return model && model.monthlyMoney ? model.monthlyMoney(current, month) : null; }
    function categoryCard(category, value) {
      value = value || {};
      return '<button type="button" class="commerce-budget-link" data-commerce-action="open-grocery-budget"' + disabled() + '><span>' + category + ' allocation</span><strong>' + money(value.budget_cents) + '</strong><small>Spent ' + money(value.spent_cents == null ? 0 : value.spent_cents) + ' · Planned incl. 3% tax ' + money(value.planned_with_tax_cents == null ? value.planned_cents == null ? 0 : value.planned_cents : value.planned_with_tax_cents) + (value.missing_prices ? ' + prices needed' : '') + '</small><small>Available after plan: ' + (value.available_after_tax_cents == null ? 'Incomplete' : money(value.available_after_tax_cents)) + ' ›</small></button>';
    }
    function billAmountSummary(amount, missing) {
      return money(amount == null ? 0 : amount) + (missing ? ' + ' + missing + ' amount' + (missing === 1 ? '' : 's') + ' not recorded' : '');
    }
    function nextBillMonth(value) {
      if (!validMonth(value)) return null;
      const year = Number(value.slice(0, 4)), index = Number(value.slice(5, 7));
      const next = index === 12 ? String(year + 1) + '-01' : String(year) + '-' + String(index + 1).padStart(2, '0');
      return validMonth(next) ? next : null;
    }
    function billRuleFor(current, seriesId, targetMonth) {
      return (current.billRules || []).filter(rule => rule.series_id === seriesId && rule.effective_month <= targetMonth + '-01').slice().sort((a, b) => b.effective_month.localeCompare(a.effective_month))[0] || null;
    }
    function renderBillHistory(current) {
      const rows = model && model.monthlyBillHistory ? model.monthlyBillHistory(current) : [];
      if (!rows.length) return '';
      return '<section class="panel"><h3>Monthly bill history</h3><p class="grocery-help">Open a month to see its saved bills and ledger. Payments are shown in the month they were paid, including late payments for earlier bills.</p><div class="commerce-history-scroll" role="region" aria-label="Monthly bill comparison" tabindex="0"><table class="commerce-bill-history"><thead><tr><th scope="col">Month</th><th scope="col">Fixed bills</th><th scope="col">Variable bills</th><th scope="col">Payments recorded</th></tr></thead><tbody>' + rows.map(row => '<tr><th scope="row">' + button('open-bill-month', esc(monthLabel(row.month)), ' data-month="' + esc(row.month) + '"') + '</th><td>' + esc(billAmountSummary(row.bills_fixed_planned_cents, row.bills_fixed_missing_amounts)) + '</td><td>' + esc(billAmountSummary(row.bills_variable_planned_cents, row.bills_variable_missing_amounts)) + '</td><td>' + money(row.bill_expense_cents == null ? 0 : row.bill_expense_cents) + '</td></tr>').join('') + '</tbody></table></div><p class="grocery-help">Bill amounts are monthly plans or recorded bill amounts. A payment counts as spending only after it is recorded.</p></section>';
    }
    function renderGroceryBudgetHistory(current) {
      const months=new Set((current.budgets||[]).map(row=>String(row.month||'').slice(0,7)));for(const row of current.receipts||[])if(row.purchased_on)months.add(String(row.purchased_on).slice(0,7));for(const row of current.shoppingItems||[])if(row.month)months.add(String(row.month).slice(0,7));
      const rows=[...months].filter(validMonth).sort().reverse();if(!rows.length)return '';
      return '<section class="panel"><h3>Grocery budget history</h3><p class="grocery-help">Food and Household allocations stay saved by month. Planned totals include the generic 3% estimate; actual spending comes from recorded receipts.</p><div class="commerce-history-scroll" role="region" aria-label="Grocery budget history" tabindex="0"><table class="commerce-bill-history"><thead><tr><th>Month</th><th>Food spent</th><th>Food planned</th><th>Household spent</th></tr></thead><tbody>'+rows.map(value=>{const summary=model&&model.monthlyMoney?model.monthlyMoney(current,value):{};return '<tr><th>'+button('open-bill-month',esc(monthLabel(value)),' data-month="'+esc(value)+'"')+'</th><td>'+money(summary.food&&summary.food.spent_cents||0)+'</td><td>'+money(summary.food&&summary.food.planned_with_tax_cents||0)+'</td><td>'+money(summary.household&&summary.household.spent_cents||0)+'</td></tr>';}).join('')+'</tbody></table></div></section>';
    }

    function renderMoney(current) {
      const summary = moneySummary(current) || {}, budget = (current.budgets || []).find(row => row.month === month + '-01');
      const version = month + ':' + (budget && budget.revision || 'new');
      if (!dirty('budget') && budgetVersion !== version) { resetGroup('budget', { amount: moneyInput(budget && budget.amount_cents), household_amount: moneyInput(budget && budget.household_amount_cents), revision: budget ? budget.revision : null }); budgetVersion = version; }
      const bills = (current.bills || []).filter(bill => bill.month === month + '-01' && !bill.cancelled);
      const cancelledBills = (current.bills || []).filter(bill => bill.month === month + '-01' && bill.cancelled);
      const loadKey = billLoadKey(current), loadState = loadKey && billLoads.get(loadKey);
      const showBills = !loadKey || loadState === 'ready' || (current.offline && bills.length > 0);
      const entries = (current.moneyEntries || []).filter(entry => entry.occurred_on && entry.occurred_on.startsWith(month)).slice().sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
      let html = '<section class="panel"><div class="grocery-month-heading"><div><p class="page-kicker">Money in Bloom</p><h2>Your monthly money ledger</h2></div>' + monthPicker() + '</div><p class="grocery-help">Recorded income and expenses for ' + monthLabel(month) + '. Bills and budget allocations are plans until you record a payment.</p><div class="commerce-money-totals"><div><span>Recorded income</span><strong>' + money(summary.total_income_cents == null ? 0 : summary.total_income_cents) + '</strong></div><div><span>Recorded expenses</span><strong>' + money(summary.total_expense_cents == null ? 0 : summary.total_expense_cents) + '</strong></div><div><span>Income less expenses</span><strong>' + money(summary.net_cents == null ? 0 : summary.net_cents) + '</strong><small>This is not a bank balance.</small></div></div><div class="commerce-budget-links">' + categoryCard('Food', summary.food) + categoryCard('Household', summary.household) + '</div><details class="commerce-details"><summary>Set this month’s Food and Household allocations</summary>' + form('budget', '<div class="grocery-form-grid">' + input('budget', 'amount', 'Food allocation (USD)', 'type="text" inputmode="decimal" required maxlength="12"') + input('budget', 'household_amount', 'Household allocation (USD, optional)', 'type="text" inputmode="decimal" maxlength="12"') + '</div>', 'Save allocations') + '</details></section>';
      if (!showBills) html += '<section class="panel"><h3>Bills for ' + monthLabel(month) + '</h3>' + (current.offline ? '<p class="grocery-help">This month’s recurring bills are not in the saved device copy. Connect to load them.</p>' : loadState === 'failed' ? '<p class="grocery-help" role="alert">This month’s recurring bills could not be loaded. Your saved drafts are kept.</p>' + button('retry-bills', 'Retry loading bills', '', true) : '<p class="grocery-help" role="status">Opening this month’s recurring bills…</p>') + '</section>';
      else {
      html += '<section class="panel"><div class="panel-title-row"><div><h3>Bills for ' + monthLabel(month) + '</h3><p class="grocery-help">Planned known total: ' + money(summary.bills_planned_cents == null ? 0 : summary.bills_planned_cents) + (summary.bills_missing_amounts ? ' · ' + summary.bills_missing_amounts + ' amount(s) still needed' : '') + '</p></div>' + button('new-bill', '+ Add bill') + '</div><div class="commerce-bill-subtotals"><div><span>Fixed monthly bills</span><strong>' + money(summary.bills_fixed_planned_cents == null ? 0 : summary.bills_fixed_planned_cents) + '</strong><small>' + (summary.bills_fixed_missing_amounts ? summary.bills_fixed_missing_amounts + ' amount(s) not recorded' : 'Saved amounts for this month') + '</small></div><div><span>Variable monthly bills</span><strong>' + money(summary.bills_variable_planned_cents == null ? 0 : summary.bills_variable_planned_cents) + '</strong><small>' + (summary.bills_variable_missing_amounts ? summary.bills_variable_missing_amounts + ' amount(s) not recorded · total incomplete' : 'Saved amounts for this month') + '</small></div></div>';
      if (billOpen) html += form('bill', '<div class="grocery-form-grid">' + input('bill', 'name', 'Bill name', 'type="text" required maxlength="160"') + input('bill', 'amount', 'Amount for this month (USD, optional)', 'type="text" inputmode="decimal" maxlength="12"') + input('bill', 'due_on', 'Due date (optional)', 'type="date" min="1900-01-01" max="2200-12-31"') + '</div>' + checkbox('bill', 'variable', 'This bill varies from month to month') + (drafts.bill.series_id ? '<p class="grocery-help">This is a monthly bill. Editing it saves this month’s amount.</p>' + checkbox('bill', 'apply_future', 'Also use these settings for future monthly bills') + '<p class="grocery-help">Future automatic bills that you have not edited or paid will use the new settings. Other saved months keep their amounts. Variable bills start each new month with the amount blank.</p>' : checkbox('bill', 'repeat_monthly', 'Repeat this bill each month') + '<p class="grocery-help">Fixed bills repeat their amount. Variable bills repeat with a blank amount for you to enter each month. Repeating a bill never marks it paid.</p>') + textarea('bill', 'notes', 'Bill notes', 4000), 'Save bill for this month');
      if (!bills.length) html += empty('Add your bills for this month. An unknown variable bill can stay blank until you know its amount.');
      else html += '<ul class="commerce-record-list">' + bills.map(bill => {
        const paid = (current.moneyEntries || []).find(entry => entry.bill_id === bill.id && !entry.voided_at);
        const nextMonth = nextBillMonth(month), rule = bill.series_id && billRuleFor(current, bill.series_id, month), nextRule = bill.series_id && nextMonth && billRuleFor(current, bill.series_id, nextMonth);
        return '<li><div><h4>' + esc(bill.name) + '</h4><p>' + money(bill.amount_cents) + ' · ' + (bill.variable ? 'Variable' : 'Fixed') + (rule && rule.active ? ' · Repeats monthly' : '') + (bill.due_on ? ' · Due ' + dateLabel(bill.due_on) : '') + '</p>' + (bill.notes ? '<p class="commerce-note">' + esc(bill.notes) + '</p>' : '') + (paid ? '<span class="pill">Paid ' + money(paid.amount_cents) + ' · ' + dateLabel(paid.occurred_on) + '</span>' : '') + '</div><div class="grocery-actions">' + button('edit-bill', 'Edit bill', ' data-id="' + esc(bill.id) + '"') + (!paid ? button('pay-bill', 'Record payment', ' data-id="' + esc(bill.id) + '"', true) : '') + (nextRule && nextRule.active ? button('stop-bill', 'Stop future repeats', ' data-id="' + esc(bill.id) + '" data-month="' + nextMonth + '"') : '') + '</div></li>';
      }).join('') + '</ul>';
      if (cancelledBills.length) html += '<details class="commerce-details"><summary>' + cancelledBills.length + ' stopped automatic bill' + (cancelledBills.length === 1 ? '' : 's') + '</summary><p class="grocery-help">These automatic copies were stopped and are excluded from the planned totals. Their history is kept.</p><ul>' + cancelledBills.map(bill => '<li>' + esc(bill.name) + '</li>').join('') + '</ul></details>';
      html += '</section>';
      }
      html += '<section class="panel"><div class="panel-title-row"><h3>Money entries</h3><div class="grocery-actions">' + button('new-money', '+ Add income or expense') + button('open-receipts', 'Grocery receipts ›') + '</div></div>';
      if (moneyOpen) html += form('money', '<div class="grocery-form-grid">' + input('money', 'occurred_on', 'Date paid or received', 'type="date" min="1900-01-01" max="2200-12-31" required') + (drafts.money.bill_id ? '' : select('money', 'direction', 'Entry type', [['expense', 'Expense'], ['income', 'Income']])) + input('money', 'description', 'Description', 'type="text" required maxlength="300"') + input('money', 'amount', 'Actual amount (USD)', 'type="text" inputmode="decimal" required maxlength="12"') + (drafts.money.bill_id ? '' : select('money', 'category', 'Category', [['other', 'Other'], ['bill', 'Bill']])) + select('money', 'payer_slot', 'Person', PEOPLE) + '</div><p class="grocery-help">' + (drafts.money.bill_id ? 'Record one full bill payment. If this month’s bill amount is blank, the payment also saves that monthly amount. It does not set an amount for future variable bills.' : 'Food and Household purchases belong in Grocery receipts so their spending is recorded once.') + '</p>', drafts.money.bill_id ? 'Record bill payment' : 'Record money entry');
      if (!entries.length) html += empty('No actual income or expenses recorded in this month. Saving a budget or bill does not create a payment.');
      else html += '<ul class="commerce-ledger">' + entries.map(entry => '<li class="' + (entry.voided_at ? 'is-voided' : '') + '"><div><strong>' + esc(entry.description || (entry.receipt_id ? 'Grocery receipt' : 'Money entry')) + '</strong><small>' + dateLabel(entry.occurred_on) + ' · ' + esc(entry.category) + (entry.voided_at ? ' · Reversed' : '') + '</small></div><strong class="' + (entry.direction === 'income' ? 'commerce-income' : '') + '">' + (entry.direction === 'income' ? '+' : '−') + money(Number(entry.amount_cents)) + '</strong>' + (!entry.voided_at && !entry.receipt_id ? button('void-money', 'Reverse', ' data-id="' + esc(entry.id) + '"') : entry.receipt_id ? '<small>From receipt</small>' : '') + '</li>').join('') + '</ul>';
      return html + '</section>' + renderGroceryBudgetHistory(current) + renderBillHistory(current);
    }
    function render(value) {
      const current = snapshot(); section = ['catalog', 'recurring', 'receipts', 'money'].includes(value) ? value : section;
      if (section === 'money') queueBillMonth(current);
      let html = '<section class="commerce-page" aria-label="Household shopping and money"' + (busy ? ' aria-busy="true"' : '') + '>';
      if (busy) html += '<div class="grocery-working" role="status">' + esc(busy.label) + '</div>';
      if (current.status !== 'ready' || !current.household) return html + '<section class="panel"><h2>Open your household first</h2><p class="grocery-help">Sign in through Grocery to open your saved products, shopping trips, and money ledger.</p>' + button('open-grocery', 'Open Grocery', '', true) + '</section></section>';
      html += caption(current);
      if (section === 'recurring') html += renderRecurring(current);
      else if (section === 'receipts') html += renderReceipts(current);
      else if (section === 'money') html += renderMoney(current);
      else html += renderCatalog(current);
      return html + '</section>';
    }
    function readForm(element, group) {
      for (const key of Object.keys(drafts[group])) {
        if (['id', 'request_id', 'revision', 'bill_id', 'series_id', 'rule_id', 'is_override', 'cancelled', 'items', 'month', 'archived', 'list_quantity', 'reference_total_cents', 'reference_unit_cents'].includes(key)) continue;
        const field = element.elements && element.elements.namedItem && element.elements.namedItem(key);
        if (field) drafts[group][key] = typeof drafts[group][key] === 'boolean' ? Boolean(field.checked) : String(field.value == null ? '' : field.value);
      }
      if (group === 'receipt' || group === 'purchase') for (const item of drafts[group].items) for (const key of Object.keys(item)) {
        if (['key', 'shopping_item_id', 'shopping_revision', 'stock_edited', 'cost_edited', 'included'].includes(key)) continue;
        const field = element.elements && element.elements.namedItem && element.elements.namedItem('line.' + item.key + '.' + key);
        if (field && typeof field.value === 'string') item[key] = field.value;
      }
      persist();
    }
    function validateProduct() {
      const value = drafts.product;
      if (!['food', 'household'].includes(value.category) || !AISLE_CHOICES.some(([key]) => key === value.aisle)) throw new Error('Choose a product category.');
      if (!UNIT_CHOICES.some(([key]) => key === value.package_unit) || !UNIT_CHOICES.some(([key]) => key === value.serving_unit)) throw new Error('Choose a recognized package and serving unit.');
      const price = parseCents(value.price, true), serving = number(value.serving_quantity, 'Serving amount', true, true);
      if (price !== null && !validDate(value.price_date)) throw new Error('Choose the date of this reference price.');
      if (value.price_date && !validDate(value.price_date)) throw new Error('Choose a valid price date.');
      const nutrients = {}; NUTRIENT_FIELDS.forEach(([key, label]) => { nutrients[key] = number(value[key], label, true, false); });
      if (serving === null && Object.values(nutrients).some(amount => amount !== null)) throw new Error('Enter the nutrition-label serving size for these nutrient values.');
      if (value.source_url && !safeUrl(value.source_url)) throw new Error('Use a complete http or https reference link.');
      return { id: value.id, request_id: value.request_id, revision: value.revision, name: text(value.name, 'Product name', 160, true), brand: text(value.brand, 'Brand', 120, false), category: value.category, aisle: value.aisle, package_quantity: number(value.package_quantity, 'Package amount', false, true), package_unit: value.package_unit, item_label: text(value.item_label, 'Individual item label', 80, true), price_cents: price, price_date: value.price_date || null, store: text(value.store, 'Store', 160, false), source_url: text(value.source_url, 'Reference link', 2000, false), serving_quantity: serving, serving_unit: value.serving_unit, nutrients, allergens: text(value.allergens, 'Allergen notes', 4000, false), notes: text(value.notes, 'Product notes', 4000, false), archived: value.archived === true };
    }
    function validatedReceipt(current, value = drafts.receipt, requireFoodStock = false) {
      if (!validDate(value.purchased_on)) throw new Error('Choose a valid purchase date.');
      if (!['', '1', '2'].includes(String(value.payer_slot))) throw new Error('Choose a person or Shared for who paid.');
      const items = value.items.filter(item => item.included).map(item => {
        const product = item.product_id && (current.products || []).find(row => row.id === item.product_id && !row.archived);
        if (item.product_id && !product) throw new Error('A selected product is no longer available. Choose it again or enter the line manually.');
        if (!['food', 'household'].includes(item.category)) throw new Error('Choose Food or Household for every receipt line.');
        const needsStock = requireFoodStock || Boolean(item.shopping_item_id);
        const stock = item.category === 'food' ? number(item.stock_quantity, 'Food amount for ' + item.name, !needsStock, needsStock) : null;
        if (stock != null && !UNIT_CHOICES.some(([key]) => key === item.stock_unit)) throw new Error('Choose a recognized inventory unit.');
        if (!LOCATIONS.some(([key]) => key === item.location) || !DATE_TYPES.some(([key]) => key === item.date_type)) throw new Error('Choose the food location and package date type.');
        for (const key of ['expires_on', 'frozen_on', 'freezer_use_by']) if (item[key] && !validDate(item[key])) throw new Error('Choose a valid ' + key.replace(/_/g, ' ') + ' date.');
        if (item.frozen_on && item.freezer_use_by && item.freezer_use_by < item.frozen_on) throw new Error('A freezer reminder date must be on or after the date frozen.');
        return { product_id: item.product_id || null, name: text(item.name, 'Receipt item name', 160, true), category: item.category, packs: number(item.packs, 'Packages purchased', false, true), line_total_cents: parseCents(item.line_total, false), stock_quantity: stock, stock_unit: item.stock_unit, location: item.location, expires_on: item.expires_on || null, date_type: item.date_type, frozen_on: item.frozen_on || null, freezer_use_by: item.freezer_use_by || null, shopping_item_id: item.shopping_item_id || null, ...(item.shopping_item_id && item.shopping_revision != null ? { shopping_revision: item.shopping_revision } : {}) };
      });
      if (!items.length) throw new Error('Select at least one item that you actually bought.');
      if (items.length > 500) throw new Error('Record up to 500 lines on one receipt.');
      if (items.reduce((sum, item) => sum + item.line_total_cents, 0) > 1000000000) throw new Error('The receipt total must be no more than $10,000,000.00.');
      return { id: value.id, purchased_on: value.purchased_on, store: text(value.store, 'Store', 160, false), payer_slot: value.payer_slot === '' ? null : Number(value.payer_slot), notes: text(value.notes, 'Receipt notes', 4000, false), items };
    }
    function handleSubmit(event) {
      const element = event.target, group = element && element.dataset && element.dataset.commerceForm;
      if (!['product', 'recurring', 'receipt', 'purchase', 'bill', 'money', 'budget'].includes(group)) return false;
      event.preventDefault(); const current = snapshot(); if (busy || !requireReady(current)) return true;
      try {
        if (!(group === 'purchase' && purchaseAttempt)) readForm(element, group);
        if (group === 'product') {
          const payload = validateProduct();
          run('Saving your product…', () => store.saveProduct(payload), result => {
            const id = result && result.id || payload.id || payload.request_id;
            resetGroup('product', blankProduct()); productOpen = false; notify('Product saved. Open Details & edit to attach a photo or file.');
            if (result && result.id && (current.foodFiles || []).some(file => file.product_id === id)) fileTarget = id;
          });
        } else if (group === 'recurring') {
          const value = drafts.recurring;
          if (!(current.products || []).some(product => product.id === value.product_id && !product.archived)) throw new Error('Choose a saved product.');
          const every = number(value.every_days, 'Frequency in days', false, true, 3660);
          if (!Number.isInteger(every)) throw new Error('Enter a whole number of days.');
          if (!['units', 'packs'].includes(value.basis) || !['', '1', '2'].includes(String(value.person_slot))) throw new Error('Choose a quantity type and person.');
          const payload = { id: value.id, request_id: value.request_id, revision: value.revision, product_id: value.product_id, person_slot: value.person_slot === '' ? null : Number(value.person_slot), quantity: number(value.quantity, 'Recurring quantity', false, true), basis: value.basis, every_days: every, active: value.active === true };
          run('Saving the frequency…', () => store.saveRecurringProduct(payload), () => { resetGroup('recurring', blankRecurring()); recurringOpen = false; recurringReview = null; notify('Frequency saved. Review monthly quantities when you want to add the packages to your list.'); });
        } else if (group === 'receipt') {
          review = validatedReceipt(current); persist(); refresh();
        } else if (group === 'purchase') {
          if (current.offline) throw new Error('Connect to save this purchase and update the household. Your draft is kept.');
          const payload = purchaseAttempt ? clone(purchaseAttempt) : validatedReceipt(current, drafts.purchase, true);
          if (payload.items.length !== 1 || !payload.items[0].shopping_item_id) throw new Error('Choose one saved shopping item before recording this purchase.');
          const purchaseGeneration = generation, purchaseContext = context;
          purchaseAttempt = clone(payload); purchaseRejection = null; persist();
          run('Saving purchase, inventory, and spending…', async () => {
            try { return await store.recordReceipt(payload); }
            catch (error) {
              if (generation === purchaseGeneration && context === purchaseContext && drafts.purchase.id === payload.id && ['22023', '23514', '23503', '23505', '40001', '42501'].includes(String(error && error.code))) { purchaseAttempt = null; purchaseRejection = String(error.code); }
              throw error;
            }
          }, () => {
            const item = payload.items[0];
            purchaseSuccess = { id: payload.id, name: item.name, amount_cents: item.line_total_cents, category: item.category, month: payload.purchased_on.slice(0, 7) };
            purchaseAttempt = null; purchaseRejection = null; purchaseOpen = false;
            resetGroup('purchase', blankPurchase(dayOf(getNow())));
            notify('Purchase saved. Your shopping trip, ' + (item.category === 'food' ? 'food inventory, ' : '') + 'money ledger, monthly spending, and history are updated.');
          });
        } else if (group === 'bill') {
          const value = drafts.bill;
          if (value.due_on && (!validDate(value.due_on) || !value.due_on.startsWith(month))) throw new Error('Choose a due date within the selected bill month, or leave it blank.');
          const payload = { id: value.id, request_id: value.request_id, revision: value.revision, month: month + '-01', name: text(value.name, 'Bill name', 160, true), amount_cents: parseCents(value.amount, true), variable: value.variable === true, due_on: value.due_on || null, notes: text(value.notes, 'Bill notes', 4000, false), repeat_monthly: Boolean(value.series_id) || value.repeat_monthly === true, apply_future: value.apply_future === true };
          const changesFuture = payload.repeat_monthly && (!value.series_id || payload.apply_future);
          run('Saving the bill…', () => store.saveBill(payload), () => { resetGroup('bill', blankBill(month)); billOpen = false; notify('Bill saved for ' + monthLabel(month) + '. ' + (changesFuture ? 'Future automatic bills will use these settings; edited and paid months keep their saved records.' : 'Other months keep their saved settings.')); });
        } else if (group === 'money') {
          const value = drafts.money;
          if (!validDate(value.occurred_on)) throw new Error('Choose a valid payment date.');
          if (!['', '1', '2'].includes(String(value.payer_slot))) throw new Error('Choose a person or Shared for this entry.');
          if (!['income', 'expense'].includes(value.direction) || !['bill', 'other'].includes(value.category)) throw new Error('Choose an entry type and category.');
          if (value.bill_id && (value.direction !== 'expense' || value.category !== 'bill')) throw new Error('A bill payment must be a Bill expense.');
          const payload = { id: value.id, occurred_on: value.occurred_on, direction: value.direction, category: value.category, amount_cents: parseCents(value.amount, false), description: text(value.description, 'Description', 300, true), payer_slot: value.payer_slot === '' ? null : Number(value.payer_slot), bill_id: value.bill_id || null };
          if (!confirm('Record this actual ' + value.direction + ' of ' + money(payload.amount_cents) + '?')) return true;
          run('Recording the money entry…', () => store.recordMoneyEntry(payload), () => { resetGroup('money', blankMoney(dayOf(getNow()))); moneyOpen = false; notify('Your actual money entry was recorded.'); });
        } else if (group === 'budget') {
          const payload = { month: month + '-01', amount_cents: parseCents(drafts.budget.amount, false), household_amount_cents: parseCents(drafts.budget.household_amount, true), revision: drafts.budget.revision, currency: 'USD' };
          run('Saving your monthly allocations…', () => store.saveBudget(payload), () => { resetGroup('budget', { amount: '', household_amount: '', revision: null }); budgetVersion = null; notify('Food and Household allocations saved for ' + monthLabel(month) + '.'); });
        }
      } catch (error) { notify(error.message || 'Review the form before saving.', true); refresh(); }
      return true;
    }
    function fillLineProduct(item, product, preserveTotal) {
      item.product_id = product.id; item.name = product.name; item.category = product.category; item.stock_unit = product.package_unit;
      if (!preserveTotal) { item.line_total = product.price_cents == null ? '' : moneyInput(Math.round(Number(item.packs || 1) * Number(product.price_cents))); item.cost_edited = false; }
      if (product.category === 'food' && !item.stock_edited) item.stock_quantity = String(Number(item.packs || 1) * Number(product.package_quantity));
      if (product.category === 'household') item.stock_quantity = '';
    }
    function startReceipt(items, targetMonth) {
      const current = snapshot(); if (!requireReady(current) || busy) return false;
      if (dirty('receipt') && !confirm('Start another shopping trip and discard the current unsaved receipt draft?')) return false;
      if (targetMonth && !setMonth(targetMonth)) return false;
      const value = blankReceipt(month === monthOf(getNow()) ? dayOf(getNow()) : month + '-01');
      if (Array.isArray(items) && items.length) value.items = items.map(row => {
        const item = blankLine(), product = (current.products || []).find(entry => entry.id === row.product_id);
        item.shopping_item_id = row.id; item.shopping_revision = row.revision == null ? null : row.revision; item.included = Boolean(row.checked); item.name = row.name; item.category = row.category || 'food'; item.packs = String(row.packs || 1);
        if (product) fillLineProduct(item, product, false);
        else if (row.estimate_cents != null) item.line_total = moneyInput(row.estimate_cents);
        return item;
      });
      resetGroup('receipt', value); review = null; receiptOpen = true; persist(); navigateSection('receipts'); return true;
    }
    function savedPurchaseFor(current, rowId) {
      return (current.receipts || []).find(receipt => !receipt.voided_at && (receipt.shopping_effects || []).some(effect => effect.id === rowId && effect.after && effect.after.checked === true));
    }
    function getPendingPurchaseId() {
      snapshot();
      return (purchaseOpen || purchaseAttempt) && drafts.purchase.items && drafts.purchase.items[0] ? drafts.purchase.items[0].shopping_item_id : null;
    }
    function purchaseDraft(row, current, targetMonth) {
      const period = validMonth(String(targetMonth || '').slice(0, 7)) ? String(targetMonth).slice(0, 7) : monthOf(getNow());
      const value = blankPurchase(period === monthOf(getNow()) ? dayOf(getNow()) : period + '-01'), item = value.items[0];
      const product = (current.products || []).find(entry => entry.id === row.product_id && !entry.archived);
      const packs = row.packs != null && Number.isFinite(Number(row.packs)) && Number(row.packs) > 0 ? Number(row.packs) : null;
      item.shopping_item_id = row.id; item.shopping_revision = row.revision; item.included = true;
      item.name = row.name; item.product_id = product ? product.id : ''; item.category = row.category === 'household' ? 'household' : 'food'; item.packs = packs == null ? '' : String(packs);
      value.list_quantity = row.quantity || '';
      if (product) {
        value.store = product.store || '';
        item.stock_unit = UNIT_CHOICES.some(([unit]) => unit === product.package_unit) ? product.package_unit : 'each';
        if (item.category === 'food' && packs != null && Number(product.package_quantity) > 0) item.stock_quantity = String(packs * Number(product.package_quantity));
        const previousStock = (current.inventory || []).find(stock => stock.product_id === product.id && LOCATIONS.some(([location]) => location === stock.location));
        item.location = previousStock ? previousStock.location : product.aisle === 'frozen' ? 'freezer' : ['dairy-eggs', 'meat', 'seafood', 'deli'].includes(product.aisle) ? 'refrigerator' : 'pantry';
      }
      const estimate = row.estimate_cents != null && Number.isSafeInteger(Number(row.estimate_cents)) && Number(row.estimate_cents) >= 0 ? Number(row.estimate_cents) : product && product.price_cents != null && packs != null ? Math.round(Number(product.price_cents) * packs) : null;
      if (estimate != null && Number.isSafeInteger(estimate) && estimate >= 0) { item.line_total = moneyInput(estimate); value.reference_total_cents = estimate; }
      value.reference_unit_cents = packs != null && estimate != null ? estimate / packs : product && product.price_cents != null ? Number(product.price_cents) : null;
      return value;
    }
    function startPurchase(row, targetMonth) {
      const current = snapshot();
      if (!requireReady(current) || busy) return false;
      if (!row || !row.id || !(current.shoppingItems || []).some(item => item.id === row.id) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) { notify('Refresh your shopping list before recording this purchase.', true); return false; }
      const pendingId = getPendingPurchaseId();
      if (pendingId === row.id) { purchaseOpen = true; persist(); refresh('#commerce-purchase-line-total'); return true; }
      if (pendingId) { notify('Finish checking the pending purchase before starting another item.', true); refresh('#commerce-purchase-heading'); return false; }
      const saved = savedPurchaseFor(current, row.id);
      if (saved) return openReceipt(saved.id);
      purchaseAttempt = null; purchaseRejection = null; purchaseSuccess = null;
      resetGroup('purchase', purchaseDraft(row, current, targetMonth)); purchaseOpen = true; persist(); refresh('#commerce-purchase-line-total'); return true;
    }
    function openReceipt(receiptId) {
      const current = snapshot();
      if (!requireReady(current) || busy) return false;
      const receipt = (current.receipts || []).find(row => row.id === receiptId);
      if (!receipt || !validDate(receipt.purchased_on)) { notify('Refresh your household to open this saved shopping trip.', true); return false; }
      if (!setMonth(receipt.purchased_on.slice(0, 7))) return false;
      selectedReceiptId = receipt.id; if (!navigateSection('receipts')) return false; navigate('grocery'); refresh('#commerce-receipt-' + receipt.id); return true;
    }
    function handleInput(event) {
      const field = event.target; if (!field || !field.dataset) return false;
      const current = snapshot();
      if (Object.hasOwn(field.dataset, 'commerceSearch')) {
        const next = String(field.value || '');
        // Blur emits change after input. Leave the results intact when the text
        // is unchanged so a click on a result can finish on the same button.
        if (next === query) return true;
        query = next; catalogPage = 0; refreshCatalogResults(current); return true;
      }
      if (field.dataset.commerceLine) {
        const group = field.dataset.commerceLineGroup || 'receipt';
        if (!['receipt', 'purchase'].includes(group)) return false;
        const item = drafts[group].items.find(row => row.key === field.dataset.commerceLine), key = field.dataset.lineField;
        if (!item || !Object.hasOwn(item, key) || ['key', 'shopping_item_id', 'shopping_revision', 'stock_edited', 'cost_edited'].includes(key)) return false;
        if (!busy && !(group === 'purchase' && purchaseAttempt)) {
          item[key] = key === 'included' ? Boolean(field.checked) : String(field.value == null ? '' : field.value); review = null;
          if (key === 'stock_quantity' || key === 'stock_unit') item.stock_edited = true;
          if (key === 'line_total') item.cost_edited = true;
          if (key === 'product_id') { const product = (current.products || []).find(row => row.id === item.product_id); if (product) { item.stock_edited = false; fillLineProduct(item, product, false); } refresh(); }
          if (key === 'packs') {
            const product = (current.products || []).find(row => row.id === item.product_id);
            const updateField = name => { const input = field.form && field.form.elements && field.form.elements.namedItem('line.' + item.key + '.' + name); if (input) input.value = item[name]; };
            if (product && !item.stock_edited) { item.stock_quantity = item.category === 'food' ? String(Number(item.packs || 0) * Number(product.package_quantity)) : ''; updateField('stock_quantity'); }
            const referencePrice = group === 'purchase' ? drafts.purchase.reference_unit_cents : product && product.price_cents;
            if (!item.cost_edited && referencePrice != null) { item.line_total = moneyInput(Math.round(Number(item.packs || 0) * Number(referencePrice))); updateField('line_total'); }
          }
          if (key === 'category') refresh();
          persist();
        }
        return true;
      }
      const key = field.dataset.commerceField;
      if (!key) return false;
      const [group, name, extra] = key.split('.');
      if (extra || !drafts[group] || !Object.hasOwn(drafts[group], name) || ['id', 'request_id', 'revision', 'bill_id', 'series_id', 'rule_id', 'is_override', 'cancelled', 'items', 'month', 'archived', 'list_quantity', 'reference_total_cents', 'reference_unit_cents'].includes(name)) return false;
      if (!busy && !(group === 'purchase' && purchaseAttempt)) { drafts[group][name] = typeof drafts[group][name] === 'boolean' ? Boolean(field.checked) : String(field.value == null ? '' : field.value); if (group === 'receipt') review = null; persist(); }
      return true;
    }
    function handleChange(event) {
      const field = event.target; if (!field || !field.dataset) return false;
      if (Object.hasOwn(field.dataset, 'commerceMonth')) { snapshot(); if (section === 'money') { if (!openMoneyMonth(field.value)) field.value = month; } else if (busy || !setMonth(field.value)) field.value = month; else { if (sectionHandler) sectionHandler(section, month); refresh(); } return true; }
      if (Object.hasOwn(field.dataset, 'commerceAisle')) { const current = snapshot(); if (field.value === 'all' || AISLE_CHOICES.some(([key]) => key === field.value)) { aisle = field.value; catalogPage = 0; refreshCatalogResults(current); } return true; }
      if (field.dataset.commerceUpload) {
        snapshot(); if (busy) return true;
        fileTarget = field.dataset.commerceUpload; fileSelection = field.files && field.files[0] || null;
        if (fileSelection && (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(fileSelection.type) || fileSelection.size > 10 * 1024 * 1024 || fileSelection.size <= 0)) { fileSelection = null; notify('Choose a JPG, PNG, WebP, or PDF file up to 10 MB.', true); }
        refresh(); return true;
      }
      return handleInput(event);
    }
    function editGroup(group, value) {
      if (dirty(group) && !confirm('Discard the unsaved changes in this form and open the saved record?')) return false;
      resetGroup(group, value); return true;
    }
    function handleClick(event) {
      const element = event.target && event.target.closest && event.target.closest('[data-commerce-action]');
      if (!element || !element.dataset || !element.dataset.commerceAction) return false;
      const action = element.dataset.commerceAction;
      const actions = ['open-grocery', 'open-grocery-budget', 'open-receipts', 'open-bill-month', 'retry-bills', 'resume-purchase', 'cancel-purchase', 'reload-purchase', 'purchase-destination', 'toggle-product', 'new-product', 'edit-product', 'product-to-list', 'catalog-prev', 'catalog-next', 'new-recurring', 'edit-recurring', 'review-recurring', 'confirm-recurring', 'cancel-recurring', 'new-receipt', 'add-receipt-line', 'remove-receipt-line', 'confirm-receipt', 'cancel-receipt-review', 'void-receipt', 'new-bill', 'edit-bill', 'stop-bill', 'pay-bill', 'new-money', 'void-money', 'discard', 'upload-file', 'open-file', 'remove-file'];
      if (!actions.includes(action)) return false;
      const current = snapshot(); if (busy) return true;
      try {
        if (action === 'open-grocery') { navigate('grocery'); return true; }
        if (!requireReady(current)) return true;
        if (action === 'open-grocery-budget') { if (sectionHandler) sectionHandler('budget', month); navigate('grocery'); }
        else if (action === 'open-receipts') { navigateSection('receipts'); navigate('grocery'); }
        else if (action === 'open-bill-month') { openMoneyMonth(element.dataset.month); return true; }
        else if (action === 'retry-bills') { queueBillMonth(current, true); refresh(); return true; }
        else if (action === 'resume-purchase') { if (drafts.purchase.items[0] && drafts.purchase.items[0].shopping_item_id) { purchaseOpen = true; persist(); refresh('#commerce-purchase-line-total'); } return true; }
        else if (action === 'cancel-purchase') {
          purchaseOpen = false;
          if (!purchaseAttempt) { purchaseRejection = null; resetGroup('purchase', blankPurchase(dayOf(getNow()))); }
        } else if (action === 'reload-purchase') {
          if (!purchaseRejection || purchaseAttempt) return true;
          if (current.offline || typeof store.refresh !== 'function') throw new Error('Connect and refresh the household before reloading this item.');
          const rowId = drafts.purchase.items[0] && drafts.purchase.items[0].shopping_item_id, requestId = drafts.purchase.id, targetMonth = drafts.purchase.purchased_on.slice(0, 7);
          run('Reloading the shopping item…', () => store.refresh(), () => {
            const latest = snapshot();
            if (latest.offline || latest.status !== 'ready') throw new Error('The latest list could not be loaded. Your original details are kept.');
            const earlierRequest = (latest.receipts || []).find(receipt => receipt.id === requestId);
            const saved = earlierRequest && !earlierRequest.voided_at ? earlierRequest : savedPurchaseFor(latest, rowId);
            if (saved) {
              const savedLine = (saved.items || []).find(item => item.shopping_item_id === rowId);
              purchaseSuccess = { id: saved.id, name: savedLine && savedLine.name || 'Shopping purchase', amount_cents: savedLine ? Number(savedLine.line_total_cents) : Number(saved.total_cents), category: savedLine && savedLine.category, month: saved.purchased_on.slice(0, 7), already_saved: true };
              purchaseOpen = false; purchaseRejection = null; resetGroup('purchase', blankPurchase(dayOf(getNow())));
              notify('This item is already in a saved shopping trip. Open it below to review the record.');
              return;
            }
            const row = (latest.shoppingItems || []).find(item => item.id === rowId);
            if (!row) throw new Error('This shopping item was removed. Cancel the purchase draft and review your list.');
            const value = purchaseDraft(row, latest, targetMonth);
            // Only a confirmed reversal can retire an uncertain request ID.
            // This explicit reload is a fresh purchase review, not a retry.
            if (!earlierRequest || !earlierRequest.voided_at) value.id = requestId;
            purchaseRejection = null; resetGroup('purchase', value); purchaseOpen = true;
            notify(earlierRequest && earlierRequest.voided_at ? 'The earlier purchase was reversed. Review the reloaded item to start a new purchase.' : 'The latest list details are loaded. Review the actual quantity and price before saving.');
          });
        } else if (action === 'purchase-destination') {
          const destination = element.dataset.destination;
          if (!['inventory', 'receipts', 'budget', 'money'].includes(destination)) return true;
          if (destination === 'receipts' && element.dataset.receiptId) { openReceipt(element.dataset.receiptId); return true; }
          if (destination === 'money') { openMoneyMonth(element.dataset.month); return true; }
          if (!setMonth(element.dataset.month)) return true;
          if (navigateSection(destination)) navigate('grocery');
        }
        else if (action === 'toggle-product') { productOpen = !productOpen; persist(); refresh('#commerce-product-toggle'); return true; }
        else if (action === 'new-product') { if (editGroup('product', blankProduct())) productOpen = true; }
        else if (action === 'edit-product') {
          const row = (current.products || []).find(product => product.id === element.dataset.id); if (!row) return true;
          const value = { ...blankProduct(), ...clone(row), price: moneyInput(row.price_cents), price_date: row.price_date || '', serving_quantity: row.serving_quantity == null ? '' : row.serving_quantity };
          NUTRIENT_FIELDS.forEach(([key]) => { value[key] = row.nutrients && row.nutrients[key] != null ? row.nutrients[key] : ''; });
          if (editGroup('product', value)) productOpen = true;
        } else if (action === 'product-to-list') {
          const product = (current.products || []).find(row => row.id === element.dataset.id && !row.archived); if (!product) return true;
          const key = month + ':' + product.id;
          const payload = quickAdds[key] || { id: '', request_id: uuid(), revision: null, name: product.name, quantity: '1 package · ' + product.package_quantity + ' ' + product.package_unit, checked: false, product_id: product.id, packs: 1, estimate_cents: product.price_cents, category: product.category, month: month + '-01' };
          quickAdds[key] = payload; persist();
          run('Adding the package to your list…', () => store.saveShoppingItem(payload), () => { delete quickAdds[key]; notify(product.name + ' was added to ' + monthLabel(payload.month.slice(0, 7)) + '. No spending was recorded.'); });
        } else if (action === 'catalog-prev') catalogPage = Math.max(0, catalogPage - 1);
        else if (action === 'catalog-next') catalogPage++;
        else if (action === 'new-recurring') { if (editGroup('recurring', blankRecurring())) recurringOpen = true; }
        else if (action === 'edit-recurring') {
          const row = (current.recurringProducts || []).find(entry => entry.id === element.dataset.id); if (row && editGroup('recurring', { ...blankRecurring(), ...row, person_slot: row.person_slot == null ? '' : String(row.person_slot) })) recurringOpen = true;
        } else if (action === 'review-recurring') {
          if (!model || !model.recurringPlan) throw new Error('The monthly quantity tools did not load. Refresh the app.');
          const plan = model.recurringPlan(current.recurringProducts || [], current.products || [], current.inventory || [], month);
          recurringReview = { signature: recurrenceSignature(current), plan, ids: Object.fromEntries(plan.items.map(item => [item.product_id, uuid()])) };
        } else if (action === 'cancel-recurring') recurringReview = null;
        else if (action === 'confirm-recurring') {
          if (!recurringReview || recurringReview.signature !== recurrenceSignature(current)) throw new Error('The saved food or list changed. Review the monthly quantities again before adding them.');
          const existing = new Set((current.shoppingItems || []).map(row => row.source_key).filter(Boolean));
          const rows = recurringReview.plan.items.filter(item => item.packs > 0 && !existing.has('recurring:' + month + ':' + item.product_id)).map(item => {
            const product = (current.products || []).find(row => row.id === item.product_id);
            return { id: '', request_id: recurringReview.ids[item.product_id], revision: null, name: item.name, quantity: item.packs + ' package(s) · ' + Number(item.packs * product.package_quantity) + ' ' + product.package_unit, checked: false, product_id: item.product_id, packs: item.packs, estimate_cents: item.estimate_cents, category: product.category, month: month + '-01', source_key: 'recurring:' + month + ':' + item.product_id };
          });
          if (!rows.length) { notify('These packages are already on this month’s list, or your recorded stock covers the plan.'); recurringReview = null; }
          else run('Adding reviewed monthly packages…', () => store.saveShoppingItems(rows), () => { recurringReview = null; notify('Your reviewed packages were added to the monthly list. Existing recurring items were not duplicated.'); });
        } else if (action === 'new-receipt') { startReceipt([], month); return true; }
        else if (action === 'add-receipt-line') { drafts.receipt.items.push(blankLine()); review = null; }
        else if (action === 'remove-receipt-line') { drafts.receipt.items = drafts.receipt.items.filter(item => item.key !== element.dataset.key); review = null; }
        else if (action === 'cancel-receipt-review') review = null;
        else if (action === 'confirm-receipt') {
          if (!review || JSON.stringify(review) !== JSON.stringify(validatedReceipt(current))) throw new Error('Review the receipt again before recording it.');
          const payload = clone(review);
          run('Recording receipt, inventory, and spending…', () => store.recordReceipt(payload), () => { resetGroup('receipt', blankReceipt(dayOf(getNow()))); review = null; receiptOpen = false; setMonth(payload.purchased_on.slice(0, 7)); notify('Receipt saved. Its Food and Household expenses are in Money in Bloom, and its food was added to inventory.'); });
        } else if (action === 'void-receipt') {
          const receipt = (current.receipts || []).find(row => row.id === element.dataset.id); if (!receipt || receipt.voided_at) return true;
          if (confirm('Reverse this receipt and its money entries? Food added by the receipt will be removed only if those stock entries are unchanged.')) run('Reversing the receipt…', () => store.voidReceipt(receipt.id), () => notify('The receipt and its spending were reversed. Its history is retained.'));
        } else if (action === 'new-bill') { if (editGroup('bill', blankBill(month))) billOpen = true; }
        else if (action === 'edit-bill') {
          const row = (current.bills || []).find(entry => entry.id === element.dataset.id && !entry.cancelled); if (row && editGroup('bill', { ...blankBill(month), ...row, amount: moneyInput(row.amount_cents), due_on: row.due_on || '', repeat_monthly: Boolean(row.series_id), apply_future: false })) billOpen = true;
        } else if (action === 'stop-bill') {
          const row = (current.bills || []).find(entry => entry.id === element.dataset.id && !entry.cancelled), fromMonth = nextBillMonth(month);
          if (!row || !row.series_id || !fromMonth || typeof store.stopBillSeries !== 'function') throw new Error('Open a saved recurring bill before stopping future repeats.');
          if (drafts.bill.id === row.id && dirty('bill')) throw new Error('Save or discard this bill draft before stopping its future repeats.');
          if (!confirm('Stop repeating ' + row.name + ' from ' + monthLabel(fromMonth) + '? Future automatic copies that are unedited and unpaid will stop. Other saved months and payments stay in history.')) return true;
          run('Stopping future bill repeats…', () => store.stopBillSeries(row, fromMonth), () => { if (drafts.bill.id === row.id) { resetGroup('bill', blankBill(month)); billOpen = false; } notify('Future automatic repeats stop from ' + monthLabel(fromMonth) + '. Your saved history is kept.'); });
        } else if (action === 'new-money') { if (editGroup('money', blankMoney(month === monthOf(getNow()) ? dayOf(getNow()) : month + '-01'))) moneyOpen = true; }
        else if (action === 'pay-bill') {
          const bill = (current.bills || []).find(row => row.id === element.dataset.id && !row.cancelled); if (!bill) return true;
          if (editGroup('money', { ...blankMoney(dayOf(getNow())), category: 'bill', description: bill.name, amount: moneyInput(bill.amount_cents), bill_id: bill.id })) moneyOpen = true;
        } else if (action === 'void-money') {
          const entry = (current.moneyEntries || []).find(row => row.id === element.dataset.id); if (!entry || entry.receipt_id || entry.voided_at) return true;
          if (confirm('Reverse this actual money entry? Its history will stay visible.')) run('Reversing the money entry…', () => store.voidMoneyEntry(entry.id), () => notify('The money entry was reversed.'));
        } else if (action === 'discard') {
          const group = element.dataset.group; if (!Object.hasOwn(drafts, group)) return true;
          if (dirty(group) && !confirm('Discard the unsaved changes in this form?')) return true;
          const blanks = { product: blankProduct, recurring: blankRecurring, receipt: () => blankReceipt(dayOf(getNow())), bill: () => blankBill(month), money: () => blankMoney(dayOf(getNow())), budget: () => ({ amount: '', household_amount: '', revision: null }) };
          resetGroup(group, blanks[group]());
          if (group === 'product') productOpen = false; if (group === 'recurring') recurringOpen = false; if (group === 'receipt') { receiptOpen = false; review = null; } if (group === 'bill') billOpen = false; if (group === 'money') moneyOpen = false; if (group === 'budget') budgetVersion = null;
        } else if (action === 'upload-file') {
          if (!fileSelection || fileTarget !== element.dataset.id || !(current.products || []).some(product => product.id === fileTarget)) throw new Error('Choose a file for this saved product first.');
          const file = fileSelection, product_id = fileTarget;
          run('Saving your product file…', () => store.uploadFoodFile({ product_id, file }), () => { fileSelection = null; notify('Your product file was saved privately for the household.'); });
        } else if (action === 'open-file') {
          const file = (current.foodFiles || []).find(row => row.id === element.dataset.id); if (!file) return true;
          run('Preparing a private file link…', () => store.getFoodFileUrl(file), result => {
            const url = typeof result === 'string' ? result : result && (result.signedUrl || result.signedURL || result.url);
            if (!safeUrl(url)) throw new Error('The private file link could not be prepared.');
            fileLinks.set(file.id, { url, expiresAt: Date.now() + 90000 }); notify('Your private file link is ready. Choose Open file.');
          });
        } else if (action === 'remove-file') {
          const file = (current.foodFiles || []).find(row => row.id === element.dataset.id); if (!file) return true;
          if (confirm('Remove this saved reference file from the household?')) run('Removing the file…', () => store.deleteFoodFile(file), () => { fileLinks.delete(file.id); notify('The reference file was removed.'); });
        }
        persist(); refresh();
      } catch (error) { notify(error.message || 'This action could not be completed.', true); refresh(); }
      return true;
    }

    return { render, renderPurchase, handleClick, handleSubmit, handleInput, handleChange, hasUnsavedDraft, hasUnpersistedChanges: () => Boolean(fileSelection) || draftWriteFailed || (!draftStore && hasUnsavedDraft()), discardDraft, startReceipt, startPurchase, getPendingPurchaseId, openReceipt, openMoneyMonth, setMonth, getMonth: () => month, setSectionHandler: handler => { sectionHandler = handler; }, setMonthGuard: handler => { monthGuard = handler; }, isBusy: () => Boolean(busy), whenIdle };
  }
  const api = { createController, parseCents, validDate };
  root.BloomCommerce = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
