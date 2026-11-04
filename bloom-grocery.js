/* Shared Grocery screens. Personal journals and whole-device backups never enter this controller. */
(function (root) {
  'use strict';

  const TABS = [
    ['list', 'Shopping list'], ['catalog', 'Products'], ['recurring', 'Regular products'], ['receipts', 'Receipts'], ['budget', 'Monthly budget'], ['inventory', 'Food at home'],
    ['profiles', 'Profiles'], ['history', 'Budget history'], ['household', 'Household']
  ];
  const LOCATIONS = [['pantry', 'Pantry'], ['refrigerator', 'Refrigerator'], ['freezer', 'Freezer']];
  const DATE_TYPES = [['unknown', 'Type not specified'], ['best_before', 'Best before'], ['use_by', 'Use by'], ['sell_by', 'Sell by'], ['expiry', 'Expiration']];
  const TARGETS = [
    ['calories_kcal', 'Calories', 'kcal', 20000], ['protein_g', 'Protein', 'g', 2000],
    ['carbs_g', 'Carbohydrates', 'g', 2000], ['fat_g', 'Fat', 'g', 2000], ['fiber_g', 'Fiber', 'g', 2000]
  ];
  const MEASUREMENTS = {
    height: { maximum: 300, unit: 'cm', factors: { in: 2.54, cm: 1 } },
    weight: { maximum: 700, unit: 'kg', factors: { lb: 0.45359237, kg: 1 } }
  };

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }
  function monthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }
  function validMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && +value.slice(0, 4) >= 1900 && +value.slice(0, 4) <= 2200;
  }
  function monthLabel(value) {
    if (!validMonth(value)) return 'Choose a month';
    return new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1, 12)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  function dateLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function money(cents) {
    return Number.isSafeInteger(cents) && cents >= 0
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
      : 'Choose your amount';
  }
  function moneyInput(cents) {
    return Number.isSafeInteger(cents) && cents >= 0 ? (cents / 100).toFixed(2) : '';
  }
  function centsFromInput(value) {
    const text = String(value || '').trim();
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(text)) {
      throw new Error('Enter the budget in dollars and cents, for example 320 or 320.50.');
    }
    const parts = text.split('.');
    const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    if (cents > 1000000000) throw new Error('The monthly budget must be no more than $10,000,000.00.');
    return cents;
  }
  function optionalNumber(value, label, maximum, integer) {
    if (String(value == null ? '' : value).trim() === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > maximum || (integer && !Number.isInteger(number))) {
      throw new Error(label + ' must be ' + (integer ? 'a whole number' : 'a number') + ' between 0 and ' + maximum + '.');
    }
    return number;
  }
  function textField(value, label, maximum, required) {
    const text = String(value == null ? '' : value).trim();
    if ((required && !text) || text.length > maximum) {
      throw new Error(required && !text ? 'Please enter ' + label.toLowerCase() + '.' : label + ' is too long.');
    }
    return text;
  }
  function draftRequestId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') root.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    // A request identifier prevents duplicate rows; it is not an access or sharing credential.
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function blankShopping() { return { id: '', request_id: draftRequestId(), name: '', quantity: '', checked: false, revision: null, product_id: '', packs: '', estimate: '', category: 'food', month: '' }; }
  function blankInventory(location) {
    return { id: '', request_id: draftRequestId(), name: '', brand: '', quantity: '', unit: 'each', location: location || 'pantry', expires_on: '', notes: '', revision: null, product_id: '', frozen_on: '', opened_on: '', date_type: 'unknown', freezer_use_by: '', reminder_days: '3' };
  }
  function blankPrivate() {
    return { display_name: '', age_years: '', height_value: '', height_unit: 'in', weight_value: '', weight_unit: 'lb', activity_level: '', notes: '', revision: null };
  }
  function blankDiet() {
    return { display_name: '', color: 'pink', calories_kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '', allergies: '', restrictions: '', preferences: '', notes: '', revision: null };
  }
  function measurementMaximum(kind, unit) { return MEASUREMENTS[kind].maximum / MEASUREMENTS[kind].factors[unit]; }
  function measurementDisplay(value, kind, unit) {
    if (value == null) return '';
    const settings = MEASUREMENTS[kind];
    const exact = Number(value) / settings.factors[unit];
    let rounded = Math.round(exact * 100) / 100;
    if (rounded === 0 && exact > 0) return String(exact);
    if (rounded * settings.factors[unit] > settings.maximum) rounded = Math.floor(exact * 100) / 100;
    return String(rounded);
  }
  function convertedMeasurement(value, kind, unit) {
    if (String(value == null ? '' : value).trim() === '') return null;
    const settings = MEASUREMENTS[kind];
    const inputValue = Number(value);
    const converted = Number((inputValue * settings.factors[unit]).toPrecision(12));
    if (!Number.isFinite(converted) || converted <= 0 || converted > settings.maximum) {
      throw new Error(kind[0].toUpperCase() + kind.slice(1) + ' must be greater than 0 and no more than ' + settings.maximum + ' ' + settings.unit + '. Check the selected unit, or leave it blank.');
    }
    return converted;
  }
  function errorMessage(error) {
    const message = error && error.message ? String(error.message) : String(error || 'The change could not be saved.');
    if (/email address not authorized|email.*not.*authorized|smtp.*not.*configured/i.test(message)) {
      return 'Email delivery for new accounts still needs to be configured. Ask for help setting up sign-in email, then try again.';
    }
    if (/email.*rate.*limit|too many.*email/i.test(message)) return 'The email service is temporarily limiting messages. Wait before requesting another email.';
    if (/invalid login credentials/i.test(message)) return 'That email and password could not be verified. Check both, or choose Reset password.';
    if (/email not confirmed/i.test(message)) return 'Please confirm your email using the message you received, then sign in.';
    if (/failed to fetch|networkerror|network request failed/i.test(message)) return 'Grocery could not reach the server. Check your connection and try again. Your form is still here.';
    return message;
  }
  function localShoppingPreview(value) {
    if (!Array.isArray(value)) throw new Error('The saved device list could not be read. Export a device backup before changing it.');
    return value.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error('An item in the device list needs review before it can be copied.');
      }
      return {
        id: item.id,
        name: textField(item.name, 'Item name', 160, true),
        quantity: textField(item.quantity || '', 'Quantity', 120, false),
        checked: item.checked === true
      };
    });
  }

  function createController(options) {
    const store = options.store;
    if (!store || typeof store.snapshot !== 'function') throw new Error('The Grocery store is not available.');
    const refresh = options.refresh || (() => {});
    const notify = options.notify || (() => {});
    const getNow = options.getNow || (() => new Date());
    const getLocalShopping = options.getLocalShopping || (() => []);
    const confirm = options.confirm || (message => typeof root.confirm === 'function' && root.confirm(message));
    const commerce = options.commerce || null;
    const model = options.model || root.BloomFoodModel;
    const draftStore = options.draftStore;
    const navigate = options.navigate || (() => {});
    let tab = 'list';
    let authMode = 'signin';
    let selectedMonth = monthKey(getNow());
    let approvedCommerceMonth = null;
    let inventoryFilter = 'all';
    let context = null;
    let generation = 0;
    let busy = null;
    let pendingTask = Promise.resolve();
    let pendingDelete = null;
    let invite = null;
    let migrationReview = null;
    let profileVersions = { private: null, diet: null, budget: null };
    let drafts;
    let baselines;
    let draftStatus = '', draftWriteFailed = false;
    let backupReview = null;

    function resetDrafts() {
      approvedCommerceMonth = null;
      drafts = {
        auth: { email: '', password: '', confirmation: '' },
        household: { name: '', code: '' },
        shopping: blankShopping(), inventory: blankInventory(), private: blankPrivate(), diet: blankDiet(),
        budget: { amount: '', household_amount: '', revision: null }
      };
      baselines = JSON.parse(JSON.stringify(drafts));
      profileVersions = { private: null, diet: null, budget: null };
      pendingDelete = null;
      migrationReview = null;
      invite = null;
      backupReview = null;
      draftWriteFailed = false;
    }
    resetDrafts();

    function snapshot() {
      const current = store.snapshot() || { status: 'unavailable' };
      const key = (current.user && current.user.id || '') + ':' + (current.household && current.household.id || '');
      if (context !== key) {
        context = key;
        generation++;
        busy = null;
        resetDrafts();
        tab = 'list';
        authMode = 'signin';
        selectedMonth = monthKey(getNow());
        inventoryFilter = 'all';
        draftStatus = '';
        if (draftStore && current.user && current.household) {
          try {
            const saved = draftStore.read(current.user.id, current.household.id, 'grocery');
            const value = saved && saved.data;
            if (value && value.version === 1 && value.drafts && value.baselines) {
              for (const group of ['shopping', 'inventory', 'private', 'diet', 'budget']) if (value.drafts[group] && value.baselines[group]) {
                drafts[group] = { ...drafts[group], ...value.drafts[group] };
                baselines[group] = { ...baselines[group], ...value.baselines[group] };
              }
              if (validMonth(value.month)) selectedMonth = value.month;
              if (TABS.some(([key]) => key === value.tab)) tab = value.tab;
              draftStatus = 'Your device draft was restored.';
            }
          } catch (_) { draftStatus = 'Your saved device draft could not be opened.'; }
        }
      }
      return current;
    }
    function persistDrafts() {
      if (!draftStore) return;
      const current = store.snapshot();
      if (!current.user || !current.household) return;
      const previouslyFailed = draftWriteFailed;
      const savedDrafts = {}, savedBaselines = {};
      for (const group of ['shopping', 'inventory', 'private', 'diet', 'budget']) { savedDrafts[group] = drafts[group]; savedBaselines[group] = baselines[group]; }
      try {
        const ok = draftStore.write(current.user.id, current.household.id, 'grocery', { version: 1, month: selectedMonth, tab, drafts: savedDrafts, baselines: savedBaselines });
        draftWriteFailed = !ok;
        draftStatus = ok ? 'Draft saved on this device.' : 'This device could not save your draft. Keep this page open until you save online.';
      } catch (_) { draftWriteFailed = true; draftStatus = 'This device could not save your draft. Keep this page open until you save online.'; }
      if (draftWriteFailed && !previouslyFailed) announce(draftStatus, true);
    }
    function dirty(group) {
      return JSON.stringify(drafts[group]) !== JSON.stringify(baselines[group]);
    }
    function hasUnsavedDraft() {
      snapshot();
      return Boolean(busy) || Object.keys(drafts).some(dirty) || Boolean(commerce && commerce.hasUnsavedDraft());
    }
    function discardDraft() {
      // Any request already sent may still complete on the server. Never pretend it was canceled.
      if (busy || (commerce && commerce.isBusy())) return false;
      resetDrafts();
      if (commerce) commerce.discardDraft();
      persistDrafts();
      return true;
    }
    function resetGroup(group, value) {
      drafts[group] = value;
      baselines[group] = { ...value };
      persistDrafts();
    }
    function updateDerivedDrafts(current) {
      const own = current.user && current.user.id;
      const privateRow = current.privateProfile && current.privateProfile.user_id === own ? current.privateProfile : null;
      const privateVersion = privateRow ? String(privateRow.revision) : 'new';
      if (!current.offline && !dirty('private') && profileVersions.private !== privateVersion) {
        const value = blankPrivate();
        if (privateRow) {
          for (const field of ['display_name', 'age_years', 'activity_level', 'notes', 'revision']) value[field] = privateRow[field] == null ? '' : privateRow[field];
          value.height_value = measurementDisplay(privateRow.height_cm, 'height', 'in');
          value.weight_value = measurementDisplay(privateRow.weight_kg, 'weight', 'lb');
        }
        resetGroup('private', value);
        profileVersions.private = privateVersion;
      }
      const dietRow = (current.dietProfiles || []).find(row => row.user_id === own);
      const dietVersion = dietRow ? String(dietRow.revision) : 'new';
      if (!dirty('diet') && profileVersions.diet !== dietVersion) {
        const value = blankDiet();
        if (!dietRow && (current.members || []).findIndex(member => member.user_id === own) === 1) value.color = 'purple';
        if (dietRow) Object.keys(value).forEach(field => { value[field] = dietRow[field] == null ? (field === 'color' ? 'pink' : '') : dietRow[field]; });
        resetGroup('diet', value);
        profileVersions.diet = dietVersion;
      }
      const budget = (current.budgets || []).find(row => row.month === selectedMonth + '-01');
      const budgetVersion = selectedMonth + ':' + (budget ? budget.revision : 'new');
      if (!dirty('budget') && profileVersions.budget !== budgetVersion) {
        resetGroup('budget', { amount: budget ? moneyInput(budget.amount_cents) : '', household_amount: budget ? moneyInput(budget.household_amount_cents) : '', revision: budget ? budget.revision : null });
        profileVersions.budget = budgetVersion;
      }
    }
    function announce(message, error) { notify(message, Boolean(error)); }
    function run(label, action, onSuccess, focus) {
      if (busy || (commerce && commerce.isBusy())) return;
      const token = { generation, context };
      busy = { token, label };
      refresh();
      pendingTask = Promise.resolve().then(action).then(result => {
        snapshot();
        if (generation !== token.generation || context !== token.context) return;
        if (onSuccess) onSuccess(result);
      }).catch(error => {
        snapshot();
        if (generation === token.generation && context === token.context) announce(errorMessage(error), true);
      }).finally(() => {
        if (busy && busy.token === token) {
          busy = null;
          refresh(focus);
        }
      });
    }
    function requireReady(current) {
      if (current.status === 'ready' && current.user && current.household) return true;
      announce('Sign in and open your household before changing its Grocery records.', true);
      return false;
    }
    function chooseMonth(value) {
      if (!validMonth(value)) { announce('Choose a month between January 1900 and December 2200.', true); return false; }
      if (value === selectedMonth) return true;
      if (!(commerce && commerce.setMonthGuard) && dirty('budget') && confirm('Change month and discard the budget amount you have not saved?') !== true) return false;
      if (commerce && !commerce.setMonth(value)) { approvedCommerceMonth = null; return false; }
      selectedMonth = value;
      approvedCommerceMonth = null;
      resetGroup('budget', { amount: '', household_amount: '', revision: null });
      profileVersions.budget = null;
      persistDrafts();
      refresh('#grocery-month');
      return true;
    }
    function disabled() { return busy || (commerce && commerce.isBusy()) ? ' disabled' : ''; }
    function button(action, label, attrs, primary) {
      return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-grocery-action="' + action + '"' + (attrs || '') + disabled() + '>' + label + '</button>';
    }
    function input(group, name, label, attributes) {
      const id = 'grocery-' + group + '-' + name.replace(/_/g, '-');
      return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><input id="' + id + '" name="' + name + '" data-grocery-field="' + group + '.' + name + '" value="' + escapeText(drafts[group][name]) + '" ' + (attributes || 'type="text"') + disabled() + '></label>';
    }
    function textarea(group, name, label, maximum, hint) {
      const id = 'grocery-' + group + '-' + name.replace(/_/g, '-');
      return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><textarea id="' + id + '" name="' + name + '" data-grocery-field="' + group + '.' + name + '" rows="3" maxlength="' + maximum + '"' + disabled() + '>' + escapeText(drafts[group][name]) + '</textarea>' + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
    }
    function select(group, name, label, choices) {
      const id = 'grocery-' + group + '-' + name.replace(/_/g, '-');
      return '<label class="grocery-field" for="' + id + '"><span>' + label + '</span><select id="' + id + '" name="' + name + '" data-grocery-field="' + group + '.' + name + '"' + disabled() + '>' + choices.map(([value, text]) => '<option value="' + escapeText(value) + '"' + (String(drafts[group][name]) === value ? ' selected' : '') + '>' + escapeText(text) + '</option>').join('') + '</select></label>';
    }
    function submit(label) { return '<button type="submit" class="button primary"' + disabled() + '>' + label + '</button>'; }
    function form(kind, html) { return '<form class="grocery-form" data-grocery-form="' + kind + '">' + html + '</form>'; }
    function localPreviewPanel() {
      let items;
      try { items = localShoppingPreview(getLocalShopping()); } catch (_) { return ''; }
      if (!items.length) return '';
      return '<section class="panel grocery-local-list"><h3>Your list on this device</h3><p class="grocery-help">' + items.length + ' saved item' + (items.length === 1 ? '' : 's') + '. After signing in, you can review and copy this list into your household.</p><details><summary>See saved items</summary><ul class="grocery-preview-list">' + items.map(item => '<li><strong>' + escapeText(item.name) + '</strong>' + (item.quantity ? '<span>' + escapeText(item.quantity) + '</span>' : '') + (item.checked ? '<small>Picked up</small>' : '') + '</li>').join('') + '</ul></details></section>';
    }
    function renderAuth(current) {
      if (current.recovery) {
        return '<section class="panel grocery-auth"><p class="page-kicker">Your account</p><h2>Choose a new password</h2><p>Set a password for your Grocery account.</p>' + form('password', input('auth', 'password', 'New password', 'type="password" required minlength="12" maxlength="256" autocomplete="new-password"') + input('auth', 'confirmation', 'Repeat new password', 'type="password" required minlength="12" maxlength="256" autocomplete="new-password"') + '<p class="grocery-help">Use at least 12 characters.</p><div class="grocery-actions">' + submit('Save new password') + '</div>') + '</section>';
      }
      const mode = authMode;
      const title = mode === 'signup' ? 'Create your Grocery account' : mode === 'reset' ? 'Reset your password' : 'Sign in to your household';
      let fields = input('auth', 'email', 'Your email', 'type="email" required maxlength="254" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false"');
      if (mode !== 'reset') fields += input('auth', 'password', 'Password', 'type="password" required ' + (mode === 'signup' ? 'minlength="12" ' : '') + 'maxlength="256" autocomplete="' + (mode === 'signup' ? 'new-password' : 'current-password') + '"');
      if (mode === 'signin') fields += '<p class="grocery-help">Stay signed in on this device. Use Sign out when you want to switch accounts.</p>';
      if (mode === 'signup') fields += input('auth', 'confirmation', 'Repeat password', 'type="password" required minlength="12" maxlength="256" autocomplete="new-password"') + '<p class="grocery-help">Use at least 12 characters. Each household member creates their own account.</p>';
      fields += '<div class="grocery-actions">' + submit(mode === 'signup' ? 'Create my account' : mode === 'reset' ? 'Send reset email' : 'Sign in') + '</div>';
      let html = '<section class="panel grocery-auth"><p class="page-kicker">Grocery together</p><h2>' + title + '</h2><p>Share your shopping list, monthly food budget, and food inventory. Each person keeps an individual nutrition profile.</p>' + form('auth', fields) + '<div class="grocery-auth-links">';
      if (mode !== 'signin') html += button('auth-mode', 'Back to sign in', ' data-grocery-mode="signin"');
      if (mode !== 'signup') html += button('auth-mode', 'Create an account', ' data-grocery-mode="signup"');
      if (mode !== 'reset') html += button('auth-mode', 'Reset password', ' data-grocery-mode="reset"');
      return html + '</div><p class="grocery-help">Shared Grocery records save online. Your personal journal stays separate from the household’s shared Grocery records.</p></section>' + localPreviewPanel();
    }
    function renderHouseholdSetup(current) {
      return '<section class="panel"><p class="page-kicker">Your shared space</p><h2>Set up your household</h2><p>You are signed in as <strong>' + escapeText(current.user && current.user.email || 'your account') + '</strong>.</p><div class="grocery-setup-grid"><section><h3>Create a household</h3><p class="grocery-help">One shared list, budget, and food inventory for two people.</p>' + form('household-create', input('household', 'name', 'Household name', 'type="text" required maxlength="80" autocomplete="off"') + '<div class="grocery-actions">' + submit('Create household') + '</div>') + '</section><section><h3>Join your household</h3><p class="grocery-help">If the other person already created it, ask them for the sharing code.</p>' + form('household-join', input('household', 'code', 'Sharing code', 'type="text" required maxlength="128" autocomplete="off" autocapitalize="none" spellcheck="false"') + '<div class="grocery-actions">' + submit('Join household') + '</div>') + '</section></div><p class="grocery-help">Household members can see its grocery list, food inventory, budgets, and shared dietary targets and restrictions.</p><div class="grocery-actions">' + button('signout', 'Sign out') + '</div></section>' + localPreviewPanel();
    }
    function renderHeader(current) {
      return '<div class="grocery-heading"><div><p class="page-kicker">Your household groceries</p><h2>' + escapeText(current.household.name || 'Our household') + '</h2><p class="grocery-help">' + (current.offline ? 'Saved device copy · ' : 'Shared online · ') + (current.members || []).length + ' of 2 household members</p></div><div class="grocery-actions">' + button('refresh', 'Refresh list', ' aria-label="Refresh shared Grocery records"') + '</div></div><nav class="grocery-tabs" aria-label="Grocery sections">' + TABS.map(([value, label]) => '<button type="button" data-grocery-action="tab" data-tab="' + value + '"' + (tab === value ? ' aria-current="page"' : '') + disabled() + '>' + label + '</button>').join('') + '</nav>';
    }
    function deleteControls(type, row) {
      if (pendingDelete && pendingDelete.type === type && pendingDelete.row.id === row.id) {
        return '<div class="grocery-delete-confirm"><span>Remove ' + escapeText(row.name) + '?</span><div class="grocery-actions">' + button('confirm-delete', 'Remove', ' data-kind="' + type + '" data-id="' + escapeText(row.id) + '"') + button('keep-item', 'Keep') + '</div></div>';
      }
      return '<div class="grocery-item-actions">' + button('edit-' + type, 'Edit', ' data-id="' + escapeText(row.id) + '" aria-label="Edit ' + escapeText(row.name) + '"') + button('delete-' + type, 'Remove', ' data-id="' + escapeText(row.id) + '" aria-label="Remove ' + escapeText(row.name) + '"') + '</div>';
    }
    function renderImport(current) {
      let items;
      try { items = localShoppingPreview(getLocalShopping()); } catch (error) {
        return '<section class="panel"><h3>Your device list</h3><p class="grocery-help">' + escapeText(errorMessage(error)) + '</p></section>';
      }
      if (!items.length) return '';
      if (!migrationReview) return '<section class="panel grocery-migration"><div><h3>Bring in your saved device list</h3><p class="grocery-help">Review ' + items.length + ' saved item' + (items.length === 1 ? '' : 's') + ' before copying them to this household.</p></div>' + button('review-import', 'Review device list') + '</section>';
      return '<section class="panel grocery-migration-review"><p class="page-kicker">Review before sharing</p><h3>Copy ' + migrationReview.items.length + ' item' + (migrationReview.items.length === 1 ? '' : 's') + ' to ' + escapeText(current.household.name) + '?</h3><p class="grocery-help">Both household members will be able to see these items. Your original device list is kept.</p><ul class="grocery-preview-list">' + migrationReview.items.map(item => '<li><strong>' + escapeText(item.name) + '</strong><span>' + escapeText(item.quantity) + '</span><small>' + (item.checked ? 'Picked up' : 'To buy') + '</small></li>').join('') + '</ul><div class="grocery-actions">' + button('confirm-import', 'Copy this list to our household', '', true) + button('cancel-import', 'Keep it on this device') + '</div></section>';
    }
    function monthItems(current) {
      return (current.shoppingItems || []).filter(row => !row.month || row.month.slice(0, 7) === selectedMonth);
    }
    function monthControl() {
      return '<label class="grocery-field grocery-month-picker" for="grocery-month"><span>Choose month</span><input id="grocery-month" type="month" min="1900-01" max="2200-12" value="' + selectedMonth + '" data-grocery-month' + disabled() + '></label>';
    }
    function productChoices(current) {
      return [['', 'Enter an item manually'], ...(current.products || []).filter(row => !row.archived).map(row => [row.id, row.name + (row.brand ? ' · ' + row.brand : '')])];
    }
    function purchaseReceipt(current, item) {
      if (!item) return null;
      return (current.receipts || []).filter(receipt => !receipt.voided_at).slice().reverse().find(receipt =>
        (receipt.shopping_effects || []).some(effect => effect.id === item.id && effect.after && effect.after.checked === true)) || null;
    }
    function renderList(current) {
      const items = monthItems(current).slice().sort((a, b) => Number(a.checked) - Number(b.checked));
      const remaining = items.filter(item => !item.checked && !purchaseReceipt(current, item)).length;
      const editing = Boolean(drafts.shopping.id);
      const known = items.filter(item => !item.checked && !purchaseReceipt(current, item) && item.estimate_cents != null).reduce((sum, item) => sum + Number(item.estimate_cents), 0);
      const missing = items.filter(item => !item.checked && !purchaseReceipt(current, item) && item.estimate_cents == null).length;
      let html = '<section class="panel"><div class="grocery-month-heading"><div><p class="page-kicker">' + monthLabel(selectedMonth) + '</p><h2>Your grocery list</h2><span class="pill">' + remaining + ' to buy</span></div>' + monthControl() + '</div><p class="grocery-help">Add what your household needs. Both people see the same saved monthly list. Earlier lists remain in their own months.</p><div class="grocery-list-summary"><span>Known shopping estimate <strong>' + money(known) + '</strong>' + (missing ? '<small>' + missing + ' price(s) needed — estimate incomplete</small>' : '') + '</span><div class="grocery-actions">' + button('record-trip', 'Record a shopping trip', '', true) + button('tab', 'Browse products', ' data-tab="catalog"') + '</div></div>';
      const needsPurchase = items.filter(item => item.checked && !purchaseReceipt(current, item));
      if (needsPurchase.length) html += '<div class="grocery-purchase-notice"><strong>' + needsPurchase.length + ' previously checked item' + (needsPurchase.length === 1 ? '' : 's') + ' need purchase details.</strong><p>Confirm the amount paid and food quantities to save them in inventory, shopping trips, and your budget.</p>' + button('record-checked-trip', 'Finish saving checked items', '', true) + '</div>';
      html += '</section>' + (commerce && commerce.renderPurchase ? commerce.renderPurchase() : '') + '<section class="panel">';
      html += form('shopping', '<div class="grocery-form-grid">' + select('shopping', 'product_id', 'Saved product <small>(optional)</small>', productChoices(current)) + input('shopping', 'name', editing ? 'Edit item' : 'Item to buy', 'type="text" required maxlength="160" autocomplete="off"') + input('shopping', 'quantity', 'Quantity or size <small>(optional)</small>', 'type="text" maxlength="120" autocomplete="off" placeholder="For example, 2 cartons"') + input('shopping', 'packs', 'Packages planned <small>(optional)</small>', 'type="number" min="0" step="any" max="1000000000" inputmode="decimal"') + select('shopping', 'category', 'Budget category', [['food', 'Food'], ['household', 'Household']]) + input('shopping', 'estimate', 'Estimated total for this item (USD)', 'type="text" inputmode="decimal" maxlength="12" placeholder="Leave blank if unknown"') + '</div><div class="grocery-actions">' + submit(editing ? 'Save item changes' : '+ Add to shared list') + button('clear-shopping', editing ? 'Discard changes' : 'Clear form') + '</div>');
      if (!items.length) html += '<div class="grocery-empty"><span aria-hidden="true">✦</span><h3>A little room for your next shop</h3><p>This month’s household list is empty. Add an item above, browse products, or review your recurring monthly quantities.</p></div>';
      else html += '<ul class="grocery-items">' + items.map(item => {
        const receipt = purchaseReceipt(current, item);
        const line = receipt && (receipt.items || []).find(value => value.shopping_item_id === item.id);
        const pending = commerce && commerce.getPendingPurchaseId && commerce.getPendingPurchaseId() === item.id;
        const status = receipt ? 'Purchase saved' : pending ? 'Finish purchase above' : item.checked ? 'Purchase details needed' : 'To buy';
        const cost = receipt && line ? money(Number(line.line_total_cents)) + ' paid' : item.estimate_cents == null ? 'Price needed' : money(Number(item.estimate_cents)) + ' estimated';
        return '<li class="grocery-item' + (receipt ? ' is-checked' : '') + '"><label class="grocery-item-check" for="grocery-check-' + escapeText(item.id) + '"><input id="grocery-check-' + escapeText(item.id) + '" type="checkbox" data-grocery-shopping-toggle="' + escapeText(item.id) + '" aria-label="' + escapeText((receipt ? 'View saved purchase for ' : 'Record purchase for ') + item.name) + '"' + (receipt ? ' checked' : '') + (busy || (commerce && commerce.isBusy()) ? ' disabled' : '') + '><span><strong>' + escapeText(item.name) + '</strong>' + (item.quantity ? '<small>' + escapeText(item.quantity) + '</small>' : '') + '<small>' + status + ' · ' + (item.category === 'household' ? 'Household' : 'Food') + ' · ' + cost + '</small></span></label>' + (receipt ? button('view-shopping-receipt', 'View purchase', ' data-id="' + escapeText(receipt.id) + '"') : deleteControls('shopping', item)) + '</li>';
      }).join('') + '</ul>';
      return html + '<p class="grocery-help grocery-footnote">Check an item when you buy it, then confirm its actual cost and food quantity once. Saving updates food inventory, shopping trips, Money in Bloom, and this month’s budget together. Household supplies stay in their own spending category.</p></section>' + renderImport(current);
    }

    function renderBudget(current) {
      const row = (current.budgets || []).find(entry => entry.month === selectedMonth + '-01');
      const summary = model && model.monthlyMoney ? model.monthlyMoney(current, selectedMonth) : null;
      const format = value => value == null ? 'Not calculated yet' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
      let html = '<section class="panel"><div class="grocery-month-heading"><div><p class="page-kicker">Monthly grocery budget</p><h2>' + monthLabel(selectedMonth) + '</h2></div>' + monthControl() + '</div>';
      const unfinished = monthItems(current).filter(item => item.checked && !purchaseReceipt(current, item));
      if (unfinished.length) html += '<div class="grocery-purchase-notice"><strong>' + unfinished.length + ' checked item' + (unfinished.length === 1 ? ' still needs' : 's still need') + ' purchase details.</strong><p>Spent includes saved purchases. Finish recording these items to add their actual costs and food quantities.</p>' + button('record-checked-trip', 'Finish saving checked items') + '</div>';
      for (const [key, label, budgetAmount] of [['food', 'Food', row && row.amount_cents], ['household', 'Household', row && row.household_amount_cents]]) {
        const totals = summary && summary[key];
        html += '<h3 class="grocery-budget-category">' + label + '</h3><div class="grocery-budget-grid"><div class="grocery-budget-card is-main"><span>Your chosen amount</span><strong>' + money(budgetAmount) + '</strong><small>' + label + ' allocation</small></div><div class="grocery-budget-card"><span>Spent</span><strong>' + format(totals && totals.spent_cents) + '</strong><small>Recorded actual expenses</small></div><div class="grocery-budget-card"><span>Planned</span><strong>' + format(totals && totals.planned_cents) + '</strong><small>' + (totals && totals.missing_prices ? totals.missing_prices + ' price(s) needed; incomplete' : 'Outstanding shopping estimates') + '</small></div><div class="grocery-budget-card"><span>Available after plan</span><strong class="' + (totals && totals.available_cents < 0 ? 'is-over-budget' : '') + '">' + format(totals && totals.available_cents) + '</strong><small>' + (totals && totals.missing_prices ? 'Needs the missing prices' : 'Budget − spent − planned') + '</small></div></div>';
      }
      html += form('budget', '<div class="grocery-form-grid">' + input('budget', 'amount', 'Food budget for ' + monthLabel(selectedMonth) + ' (USD)', 'type="text" inputmode="decimal" required maxlength="12" autocomplete="off" placeholder="Enter your amount"') + input('budget', 'household_amount', 'Household supplies budget (USD, optional)', 'type="text" inputmode="decimal" maxlength="12" autocomplete="off" placeholder="Leave blank if not set"') + '</div><div class="grocery-actions">' + submit(row ? 'Save budget changes' : 'Save monthly budget') + button('open-money', 'Open Money in Bloom ›') + '</div>');
      return html + '<p class="grocery-help">These allocations are saved for this calendar month. A shopping estimate is a plan; a confirmed receipt records actual spending in the money ledger. Unpriced items keep the plan incomplete.</p></section>';
    }

    function renderHistory(current) {
      const months = new Set((current.budgets || []).map(row => row.month.slice(0, 7)));
      for (const row of current.receipts || []) if (row.purchased_on) months.add(row.purchased_on.slice(0, 7));
      for (const row of current.shoppingItems || []) if (row.month) months.add(row.month.slice(0, 7));
      const rows = Array.from(months).filter(validMonth).sort((a, b) => b.localeCompare(a));
      return '<section class="panel"><p class="page-kicker">Monthly history</p><h2>Your saved months</h2><p class="grocery-help">Each month keeps its Food and Household allocations, shopping list, receipts, and actual spending. Food inventory carries forward.</p>' + (rows.length ? '<ul class="grocery-history">' + rows.map(value => {
        const budget = (current.budgets || []).find(row => row.month === value + '-01');
        const summary = model && model.monthlyMoney ? model.monthlyMoney(current, value) : null;
        return '<li><button type="button" data-grocery-action="open-budget" data-month="' + value + '"' + disabled() + '><span>' + monthLabel(value) + '<small>' + (summary ? 'Food spent ' + money(summary.food.spent_cents) + ' · Household spent ' + money(summary.household.spent_cents) : 'Open this month') + '</small></span><strong>' + money(budget && budget.amount_cents) + '</strong><span class="grocery-history-arrow" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul>' : '<div class="grocery-empty"><h3>Your first month starts here</h3><p>Choose a food budget and save it. That month will appear in this history.</p>' + button('tab', 'Set a monthly budget', ' data-tab="budget"', true) + '</div>') + '</section>';
    }

    function renderInventory(current) {
      const all = current.inventory || [];
      const rows = all.filter(row => inventoryFilter === 'all' || row.location === inventoryFilter);
      const editing = Boolean(drafts.inventory.id);
      const today = monthKey(getNow()) + '-' + String(getNow().getDate()).padStart(2, '0');
      const due = model && model.dueItems ? model.dueItems(all, today) : [];
      let html = '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">Food inventory</p><h2>Food already at home</h2></div>' + button('use-soon', 'Use-soon food & recipes ›') + '</div><p class="grocery-help">Track each package or batch, its remaining amount, and the dates printed on it. Food carries forward when a new month starts.</p><div class="grocery-location-tabs" aria-label="Food storage locations">' + [['all', 'All food'], ...LOCATIONS].map(([value, label]) => '<button type="button" data-grocery-action="filter-location" data-location="' + value + '" aria-pressed="' + (inventoryFilter === value) + '"' + disabled() + '><span>' + label + '</span><strong>' + (value === 'all' ? all.length : all.filter(row => row.location === value).length) + '</strong></button>').join('') + '</div>';
      html += '<h3>' + (editing ? 'Update this food' : 'Add food you already have') + '</h3>' + form('inventory', select('inventory', 'product_id', 'Link to a saved product <small>(optional)</small>', productChoices(current)) + '<div class="grocery-form-grid">' + input('inventory', 'name', 'Food or product name', 'type="text" required maxlength="160" autocomplete="off"') + input('inventory', 'brand', 'Brand <small>(optional)</small>', 'type="text" maxlength="120" autocomplete="off"') + input('inventory', 'quantity', 'Amount remaining', 'type="number" min="0" max="1000000000" step="any" inputmode="decimal" required') + input('inventory', 'unit', 'Unit', 'type="text" list="grocery-unit-options" maxlength="30" required autocomplete="off"') + select('inventory', 'location', 'Stored in', LOCATIONS) + '</div><datalist id="grocery-unit-options"><option value="each"><option value="g"><option value="kg"><option value="oz"><option value="lb"><option value="ml"><option value="l"><option value="fl_oz"><option value="cup"><option value="packages"></datalist><fieldset class="grocery-date-fields"><legend>Expiration, freezing & reminders</legend><div class="grocery-form-grid">' + input('inventory', 'expires_on', 'Expiration / printed package date', 'type="date" min="1900-01-01" max="2200-12-31"') + select('inventory', 'date_type', 'What does that date say?', DATE_TYPES) + input('inventory', 'opened_on', 'Date opened <small>(optional)</small>', 'type="date" min="1900-01-01" max="2200-12-31"') + input('inventory', 'frozen_on', 'Date frozen <small>(optional)</small>', 'type="date" min="1900-01-01" max="2200-12-31"') + input('inventory', 'freezer_use_by', 'Your freezer reminder date <small>(optional)</small>', 'type="date" min="1900-01-01" max="2200-12-31"') + input('inventory', 'reminder_days', 'Show a reminder this many days before', 'type="number" min="0" max="30" step="1" inputmode="numeric" required') + '</div><p class="grocery-help">A frozen date records what you did. It does not automatically extend the printed date or determine food safety. Leave dates blank when you do not know them.</p></fieldset>' + textarea('inventory', 'notes', 'Notes <small>(optional)</small>', 2000) + '<div class="grocery-actions">' + submit(editing ? 'Save food changes' : '+ Add to inventory') + button('clear-inventory', editing ? 'Discard changes' : 'Clear form') + '</div>') + '</section>';
      html += '<section class="panel"><div class="panel-title-row"><h3>' + (inventoryFilter === 'all' ? 'Your food inventory' : LOCATIONS.find(entry => entry[0] === inventoryFilter)[1]) + '</h3><span class="pill">' + rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + '</span></div>';
      if (!rows.length) html += '<div class="grocery-empty"><p>No food recorded here yet. Add what you have above, using the amount and unit on your package.</p></div>';
      else html += '<ul class="grocery-stock-list">' + rows.map(row => {
        const reminder = Array.isArray(due) ? due.find(entry => entry.id === row.id || entry.item && entry.item.id === row.id) : null;
        const printedLabel = DATE_TYPES.find(([key]) => key === row.date_type)?.[1] || 'Package date';
        return '<li class="grocery-stock-item"><div class="grocery-stock-heading"><div><h3>' + escapeText(row.name) + '</h3>' + (row.brand ? '<p class="grocery-help">' + escapeText(row.brand) + '</p>' : '') + '</div><strong class="grocery-stock-amount">' + escapeText(row.quantity) + ' <span>' + escapeText(row.unit) + '</span></strong></div><div class="grocery-stock-meta"><span class="pill">' + escapeText(LOCATIONS.find(([key]) => key === row.location)?.[1] || row.location) + '</span>' + (reminder ? '<span class="grocery-date-alert">Review recorded date</span>' : '') + '</div><dl class="grocery-stock-dates"><div><dt>' + escapeText(printedLabel === 'Type not specified' ? 'Expiration / package date' : printedLabel) + '</dt><dd>' + (row.expires_on ? dateLabel(row.expires_on) : 'Not recorded') + '</dd></div>' + (row.opened_on ? '<div><dt>Opened</dt><dd>' + dateLabel(row.opened_on) + '</dd></div>' : '') + (row.frozen_on ? '<div><dt>Frozen</dt><dd>' + dateLabel(row.frozen_on) + '</dd></div>' : '') + (row.freezer_use_by ? '<div><dt>Freezer reminder</dt><dd>' + dateLabel(row.freezer_use_by) + '</dd></div>' : '') + '</dl>' + (row.notes ? '<p class="grocery-stock-notes">' + escapeText(row.notes) + '</p>' : '') + deleteControls('inventory', row) + (row.location !== 'freezer' ? '<div class="grocery-actions grocery-freeze-action">' + button('freeze-inventory', 'Move to freezer…', ' data-id="' + escapeText(row.id) + '"') + '</div>' : '') + '</li>';
      }).join('') + '</ul>';
      return html + '</section>';
    }

    function profileCards(current) {
      return '<div class="grocery-profile-cards">' + [1, 2].map(slot => {
        const member = (current.members || []).find(row => row.role === (slot === 1 ? 'owner' : 'member'));
        const profile = member && (current.dietProfiles || []).find(row => row.user_id === member.user_id);
        let html = '<article class="grocery-profile-card' + (slot === 2 ? ' grocery-profile-purple' : '') + '"><p class="page-kicker">Person ' + slot + ' · ' + (slot === 1 ? 'Pink' : 'Purple') + '</p><h3>' + escapeText(profile && profile.display_name || (member ? 'Planning profile' : 'Second household member')) + '</h3>';
        if (!member) return html + '<p class="grocery-help">This place is ready for the second person. They can join with their own login.</p></article>';
        html += '<dl class="grocery-target-summary">' + TARGETS.map(([key, label, unit]) => '<div><dt>' + label + '</dt><dd>' + (profile && profile[key] != null ? escapeText(profile[key]) + ' ' + unit : 'Not set') + '</dd></div>').join('') + '</dl>';
        if (profile) html += '<details class="grocery-diet-details"><summary>Preferences and label checks</summary>' + ['allergies', 'restrictions', 'preferences', 'notes'].map(key => '<p><strong>' + key[0].toUpperCase() + key.slice(1) + '</strong><span>' + escapeText(profile[key] || 'Not recorded') + '</span></p>').join('') + '</details>';
        return html + '</article>';
      }).join('') + '</div>';
    }
    function renderProfiles(current) {
      let html = '<section class="panel"><p class="page-kicker">Household nutrition</p><h2>Two people, individual needs</h2><p class="grocery-help">Each person edits their own profile. Shared targets and dietary preferences help your household plan together.</p>' + profileCards(current) + '</section>';
      html += '<section class="panel"><span class="grocery-scope-label">Shared with your household</span><h3>Your planning profile</h3><p class="grocery-help">Enter daily targets you already use. Saved recipe and product nutrition appears in Wellness when you plan or log portions.</p>';
      html += form('diet', input('diet', 'display_name', 'Name your household will see', 'type="text" required maxlength="80" autocomplete="nickname"') + '<div class="grocery-target-fields">' + TARGETS.map(([key, label, unit, maximum]) => input('diet', key, label + ' (' + unit + '/day)', 'type="number" min="0" max="' + maximum + '" step="any" inputmode="decimal"')).join('') + '</div><p class="grocery-help">Leave a target blank when it is unknown. A blank value does not mean zero. Person 1 stays pink and Person 2 stays purple throughout the food screens.</p>' + textarea('diet', 'allergies', 'Allergies and label checks', 4000, 'Record the ingredients and package warnings your household needs to check.') + textarea('diet', 'restrictions', 'Other dietary restrictions', 4000) + textarea('diet', 'preferences', 'Foods, brands, and stores you prefer', 4000) + textarea('diet', 'notes', 'Other nutrition targets or notes', 4000, 'You can record vitamin and mineral targets here for now.') + '<div class="grocery-actions">' + submit('Save shared planning profile') + button('clear-diet', 'Discard changes') + '</div>') + '</section>';
      if (current.offline) return html + '<section class="panel"><h3>Your private profile inputs</h3><p class="grocery-help">Connect to the internet to open your private profile. It is not included in the household offline copy.</p></section>';
      html += '<section class="panel"><span class="grocery-scope-label is-private">Visible only to your account</span><h3>Your personal profile inputs</h3><p class="grocery-help">These optional measurements and notes are separate from the information shared with your household.</p>';
      html += form('private', '<div class="grocery-form-grid">' + input('private', 'display_name', 'Your personal profile name', 'type="text" maxlength="80" autocomplete="nickname"') + input('private', 'age_years', 'Age in years <small>(optional)</small>', 'type="number" min="0" max="130" step="1" inputmode="numeric"') + input('private', 'height_value', 'Height <small>(optional)</small>', 'type="number" min="0" max="' + measurementMaximum('height', drafts.private.height_unit) + '" step="any" inputmode="decimal"') + select('private', 'height_unit', 'Height unit', [['in', 'Inches'], ['cm', 'Centimeters']]) + input('private', 'weight_value', 'Weight <small>(optional)</small>', 'type="number" min="0" max="' + measurementMaximum('weight', drafts.private.weight_unit) + '" step="any" inputmode="decimal"') + select('private', 'weight_unit', 'Weight unit', [['lb', 'Pounds'], ['kg', 'Kilograms']]) + '</div>' + input('private', 'activity_level', 'Usual activity level <small>(optional)</small>', 'type="text" maxlength="200" autocomplete="off"') + textarea('private', 'notes', 'Private profile notes', 4000) + '<div class="grocery-actions">' + submit('Save private profile') + button('clear-private', 'Discard changes') + '</div>') + '</section>';
      return html;
    }
    function renderHousehold(current) {
      const members = current.members || [];
      const mine = members.find(member => current.user && member.user_id === current.user.id);
      const owner = mine && mine.role === 'owner';
      let html = '<section class="panel"><p class="page-kicker">Your household</p><h2>' + escapeText(current.household.name) + '</h2><p class="grocery-help">Signed in as ' + escapeText(current.user && current.user.email || 'your account') + '.</p><ul class="grocery-member-list">' + members.map((member, index) => {
        const profile = (current.dietProfiles || []).find(entry => entry.user_id === member.user_id);
        const own = current.user && member.user_id === current.user.id;
        return '<li><span>' + escapeText(profile && profile.display_name || (own ? 'You' : 'Household member ' + (index + 1))) + (own && profile && profile.display_name ? ' <small>(you)</small>' : '') + '</span><span class="pill">' + (member.role === 'owner' ? 'Owner' : 'Member') + '</span></li>';
      }).join('') + '</ul><p class="grocery-help">Grocery lists, food inventory, monthly budgets, and shared dietary profiles are visible to both household members.</p>';
      if (members.length < 2 && owner) {
        html += '<div class="grocery-sharing"><h3>Add the second person</h3><p class="grocery-help">Create a one-use sharing code, then give it to the person you want to join. They enter it after signing into their own account.</p>';
        if (invite && invite.invite_code) {
          const expiry = new Date(invite.expires_at);
          html += '<label class="grocery-field" for="grocery-sharing-code"><span>Your household sharing code</span><input id="grocery-sharing-code" type="text" readonly value="' + escapeText(invite.invite_code) + '" spellcheck="false"></label><p class="grocery-help">' + (!Number.isNaN(expiry.getTime()) ? 'Expires ' + escapeText(expiry.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })) + '. ' : '') + 'This code can be used once.</p>';
        }
        html += '<div class="grocery-actions">' + button('create-invite', invite ? 'Create a new sharing code' : 'Create sharing code', '', true) + '</div></div>';
      } else if (members.length >= 2) html += '<p class="grocery-help">Both household places are filled.</p>';
      html += '<div class="grocery-backup"><h3>Your household backup</h3><p class="grocery-help">Export shared products, inventory, recipes, shopping lists, monthly budgets, receipts, and money history. File references are included; attached photos and PDFs remain in private online storage.</p><div class="grocery-actions">' + button('export-household', 'Export household backup') + '</div>';
      if (owner) html += '<label class="grocery-field grocery-backup-picker"><span>Restore missing records from a household backup</span><input type="file" accept="application/json,.json" data-grocery-household-import' + disabled() + '></label><p class="grocery-help">Restore is for this same household. Existing records are kept; conflicting changes stop the restore for review. Receipt history is restored without recording the purchases again.</p>';
      if (owner && backupReview) html += '<div class="grocery-backup-review"><h4>Review ' + escapeText(backupReview.name) + '</h4><p class="grocery-help">This household · ' + backupReview.payload.data.products.length + ' products · ' + backupReview.payload.data.receipts.length + ' receipts · ' + backupReview.payload.data.moneyEntries.length + ' money entries</p><div class="grocery-actions">' + button('restore-household', 'Restore missing records', '', true) + button('cancel-household-import', 'Cancel restore') + '</div></div>';
      return html + '</div><div class="grocery-actions grocery-signout">' + button('signout', 'Sign out of Grocery') + '</div></section>';
    }
    function render() {
      const current = snapshot();
      updateDerivedDrafts(current);
      let html = '<section class="grocery-page" aria-label="Shared Grocery"' + (busy ? ' aria-busy="true"' : '') + '>';
      if (busy) html += '<div class="grocery-working" role="status">' + escapeText(busy.label) + '</div>';
      if (current.recovery) return html + renderAuth(current) + '</section>';
      if (current.status === 'loading') return html + '<section class="panel grocery-empty"><h2>Opening your Grocery records…</h2><p>Your saved household information will appear here.</p></section></section>';
      if (current.status === 'unavailable') return html + '<section class="panel"><h2>Grocery sign-in could not load</h2><p>' + escapeText(current.error ? errorMessage(current.error) : 'Check your internet connection, then try again.') + '</p>' + button('retry', 'Try again', '', true) + '</section>' + localPreviewPanel() + '</section>';
      if (current.status === 'error') return html + '<section class="panel"><h2>Grocery needs a moment</h2><p role="alert">' + escapeText(errorMessage(current.error)) + '</p><div class="grocery-actions">' + button('refresh', 'Try again', '', true) + (current.user ? button('signout', 'Sign out') : '') + '</div><p class="grocery-help">Refresh to check the saved records before making more changes.</p></section></section>';
      if (!current.user || current.status === 'signed-out') return html + renderAuth(current) + '</section>';
      if (!current.household || current.status === 'no-household') return html + renderHouseholdSetup(current) + '</section>';
      html += renderHeader(current);
      if (current.offline) html += '<p class="grocery-working" role="status">Offline — saved device copy. Changes are drafts until saved online.</p>';
      else if (draftStatus) html += '<p class="grocery-help grocery-draft-status" role="status">' + escapeText(draftStatus) + '</p>';
      if (tab === 'budget') html += renderBudget(current);
      else if (tab === 'inventory') html += renderInventory(current);
      else if (tab === 'profiles') html += renderProfiles(current);
      else if (tab === 'history') html += renderHistory(current);
      else if (tab === 'household') html += renderHousehold(current);
      else if (commerce && ['catalog', 'recurring', 'receipts'].includes(tab)) html += commerce.render(tab);
      else html += renderList(current);
      return html + '<p class="grocery-cloud-caption">' + (current.offline ? 'You are viewing the saved device copy. Reconnect and save your drafts to update the household.' : 'Saved records are online for your household. Your typed drafts are kept on this device; choose Save to share them.') + '</p></section>';
    }
    function readForm(formElement, group) {
      for (const key of Object.keys(drafts[group])) {
        if (['id', 'request_id', 'revision', 'checked', 'month'].includes(key)) continue;
        const field = formElement.elements && typeof formElement.elements.namedItem === 'function'
          ? formElement.elements.namedItem(key) : null;
        if (field && typeof field.value === 'string') drafts[group][key] = field.value;
      }
      if (!['auth', 'household'].includes(group)) persistDrafts();
    }
    function handleInput(event) {
      if (commerce && commerce.handleInput(event)) return true;
      snapshot();
      const field = event.target;
      const key = field && field.dataset && field.dataset.groceryField;
      if (!key) return false;
      const [group, name, extra] = key.split('.');
      if (extra || !Object.hasOwn(drafts, group) || !Object.hasOwn(drafts[group], name) || ['id', 'request_id', 'revision', 'checked', 'month'].includes(name)) return false;
      if (!busy && !(commerce && commerce.isBusy())) {
        drafts[group][name] = field.value;
        if (group === 'private' && ['height_unit', 'weight_unit'].includes(name)) {
          const kind = name.slice(0, -5);
          const measurementField = field.form && field.form.elements && field.form.elements.namedItem(kind + '_value');
          if (measurementField && Object.hasOwn(MEASUREMENTS[kind].factors, field.value)) measurementField.max = String(measurementMaximum(kind, field.value));
        }
        if (['shopping', 'inventory'].includes(group) && name === 'product_id') {
          const product = (store.snapshot().products || []).find(row => row.id === field.value && !row.archived);
          if (product) {
            drafts[group].name = product.name;
            if (group === 'inventory') { drafts.inventory.brand = product.brand || ''; drafts.inventory.unit = product.package_unit; if (drafts.inventory.quantity === '') drafts.inventory.quantity = String(product.package_quantity); }
            else { drafts.shopping.category = product.category; drafts.shopping.packs = '1'; drafts.shopping.quantity = '1 package · ' + product.package_quantity + ' ' + product.package_unit; drafts.shopping.estimate = moneyInput(product.price_cents); }
            refresh();
          }
        }
        if (group === 'shopping' && name === 'packs' && drafts.shopping.product_id) {
          const product = (store.snapshot().products || []).find(row => row.id === drafts.shopping.product_id);
          if (product && Number(field.value) > 0) {
            drafts.shopping.estimate = product.price_cents == null ? '' : moneyInput(Math.round(Number(field.value) * Number(product.price_cents)));
            drafts.shopping.quantity = field.value + ' package(s) · ' + Number(field.value) * Number(product.package_quantity) + ' ' + product.package_unit;
            for (const key of ['estimate', 'quantity']) { const changed = field.form && field.form.elements && field.form.elements.namedItem(key); if (changed) changed.value = drafts.shopping[key]; }
          }
        }
        if (!['auth', 'household'].includes(group)) persistDrafts();
      }
      return true;
    }
    function handleSubmit(event) {
      if (commerce && commerce.handleSubmit(event)) return true;
      const element = event.target;
      const kind = element && element.dataset && element.dataset.groceryForm;
      if (!['auth', 'password', 'household-create', 'household-join', 'shopping', 'inventory', 'budget', 'private', 'diet'].includes(kind)) return false;
      event.preventDefault();
      const current = snapshot();
      if (busy || (commerce && commerce.isBusy())) return true;
      try {
        if (kind === 'auth' || kind === 'password') {
          readForm(element, 'auth');
          const email = drafts.auth.email.trim();
          const password = drafts.auth.password;
          if (kind === 'auth' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new Error('Enter a valid email address.');
          if (kind === 'password' || authMode === 'signup') {
            if (password.length < 12 || password.length > 256) throw new Error('Use a password with at least 12 characters.');
            if (drafts.auth.confirmation !== password) throw new Error('The passwords do not match. Please enter them again.');
          } else if (authMode === 'signin' && !password) throw new Error('Please enter your password.');
          if (kind === 'password') run('Saving your new password…', () => store.updatePassword(password), () => {
            resetGroup('auth', { email: '', password: '', confirmation: '' });
            announce('Your new password was saved.');
          });
          else if (authMode === 'signup') run('Creating your account…', () => store.signUp(email, password), () => {
            resetGroup('auth', { email, password: '', confirmation: '' });
            authMode = 'signin';
            announce('Check your email to confirm your account, then return here and sign in.');
          }, '#grocery-auth-email');
          else if (authMode === 'reset') run('Requesting a reset email…', () => store.resetPassword(email), () => {
            resetGroup('auth', { email, password: '', confirmation: '' });
            announce('If an account can receive reset email at that address, a reset message will arrive. Check your inbox.');
          });
          else run('Signing in…', () => store.signIn(email, password), () => {
            resetGroup('auth', { email: '', password: '', confirmation: '' });
            announce('You are signed in to Grocery.');
          });
          return true;
        }
        if (kind.startsWith('household-')) {
          if (!current.user) throw new Error('Sign in before setting up your household.');
          readForm(element, 'household');
          if (kind === 'household-create') {
            const name = textField(drafts.household.name, 'Household name', 80, true);
            run('Creating your household…', () => store.createHousehold(name), () => { resetGroup('household', { name: '', code: '' }); announce('Your household is ready.'); });
          } else {
            const code = textField(drafts.household.code, 'Sharing code', 128, true);
            run('Joining your household…', () => store.joinHousehold(code), () => { resetGroup('household', { name: '', code: '' }); announce('You have joined your household.'); });
          }
          return true;
        }
        if (!requireReady(current)) return true;
        readForm(element, kind);
        if (kind === 'shopping') {
          const value = drafts.shopping;
          if (value.product_id && !(current.products || []).some(product => product.id === value.product_id && !product.archived)) throw new Error('Choose a saved product, or choose Enter an item manually.');
          const packs = optionalNumber(value.packs, 'Packages planned', 1000000000, false);
          if (packs === 0) throw new Error('Packages planned must be greater than zero, or leave the field blank.');
          if (!['food', 'household'].includes(value.category)) throw new Error('Choose Food or Household for this item.');
          const payload = { id: value.id, request_id: value.request_id, revision: value.revision, checked: value.checked, name: textField(value.name, 'Item name', 160, true), quantity: textField(value.quantity, 'Quantity', 120, false), month: value.month || selectedMonth + '-01', product_id: value.product_id || null, packs, estimate_cents: value.estimate.trim() === '' ? null : centsFromInput(value.estimate), category: value.category };
          run('Saving your shopping item…', () => store.saveShoppingItem(payload), () => {
            resetGroup('shopping', blankShopping());
            announce('Your shopping item was saved for the household.');
          }, '#grocery-shopping-name');
        } else if (kind === 'inventory') {
          const value = drafts.inventory;
          const quantity = optionalNumber(value.quantity, 'Amount remaining', 1000000000, false);
          if (quantity === null) throw new Error('Enter how much of this food you have.');
          if (!LOCATIONS.some(([location]) => location === value.location)) throw new Error('Choose Pantry, Refrigerator, or Freezer.');
          if (value.expires_on && !dateLabel(value.expires_on)) throw new Error('Choose a valid package date.');
          for (const field of ['frozen_on', 'opened_on', 'freezer_use_by']) if (value[field] && !dateLabel(value[field])) throw new Error('Choose a valid ' + field.replace(/_/g, ' ') + ' date.');
          if (value.frozen_on && value.freezer_use_by && value.freezer_use_by < value.frozen_on) throw new Error('The freezer reminder must be on or after the date frozen.');
          if (!DATE_TYPES.some(([type]) => type === value.date_type)) throw new Error('Choose the package date type.');
          if (value.product_id && !(current.products || []).some(product => product.id === value.product_id)) throw new Error('Choose a saved product or enter this food manually.');
          const reminderDays = optionalNumber(value.reminder_days, 'Reminder days', 30, true);
          if (reminderDays === null) throw new Error('Enter how many days before the recorded date to show a reminder.');
          const payload = {
            id: value.id, request_id: value.request_id, revision: value.revision, name: textField(value.name, 'Food name', 160, true), brand: textField(value.brand, 'Brand', 120, false),
            quantity, unit: textField(value.unit, 'Unit', 30, true), location: value.location,
            expires_on: value.expires_on || null, notes: textField(value.notes, 'Notes', 2000, false), product_id: value.product_id || null,
            frozen_on: value.frozen_on || null, opened_on: value.opened_on || null, date_type: value.date_type,
            freezer_use_by: value.freezer_use_by || null, reminder_days: reminderDays
          };
          run('Saving your food inventory…', () => store.saveInventory(payload), () => {
            resetGroup('inventory', blankInventory(inventoryFilter === 'all' ? 'pantry' : inventoryFilter));
            announce('Your food inventory was updated for the household.');
          }, '#grocery-inventory-name');
        } else if (kind === 'budget') {
          const payload = { month: selectedMonth + '-01', amount_cents: centsFromInput(drafts.budget.amount), household_amount_cents: drafts.budget.household_amount.trim() === '' ? null : centsFromInput(drafts.budget.household_amount), currency: 'USD', revision: drafts.budget.revision };
          run('Saving the monthly budget…', () => store.saveBudget(payload), () => {
            resetGroup('budget', { amount: '', household_amount: '', revision: null });
            profileVersions.budget = null;
            announce('The Food and Household budgets for ' + monthLabel(selectedMonth) + ' were saved.');
          });
        } else if (kind === 'private') {
          const value = drafts.private;
          if (!['in', 'cm'].includes(value.height_unit) || !['lb', 'kg'].includes(value.weight_unit)) throw new Error('Choose valid height and weight units.');
          const savedPrivate = current.privateProfile && current.privateProfile.user_id === current.user.id ? current.privateProfile : null;
          const keepHeight = savedPrivate && value.height_value === baselines.private.height_value && value.height_unit === baselines.private.height_unit;
          const keepWeight = savedPrivate && value.weight_value === baselines.private.weight_value && value.weight_unit === baselines.private.weight_unit;
          const payload = {
            revision: value.revision,
            display_name: textField(value.display_name, 'Personal profile name', 80, false),
            age_years: optionalNumber(value.age_years, 'Age', 130, true),
            height_cm: keepHeight ? savedPrivate.height_cm : convertedMeasurement(value.height_value, 'height', value.height_unit),
            weight_kg: keepWeight ? savedPrivate.weight_kg : convertedMeasurement(value.weight_value, 'weight', value.weight_unit),
            activity_level: textField(value.activity_level, 'Activity level', 200, false), notes: textField(value.notes, 'Private notes', 4000, false)
          };
          run('Saving your private profile…', () => store.savePrivateProfile(payload), () => {
            resetGroup('private', blankPrivate()); profileVersions.private = null;
            announce('Your private profile was saved to your account.');
          });
        } else if (kind === 'diet') {
          const value = drafts.diet;
          const member = (current.members || []).find(row => row.user_id === current.user.id);
          const payload = { revision: value.revision, display_name: textField(value.display_name, 'Shared profile name', 80, true), color: member && member.role === 'member' ? 'purple' : 'pink' };
          TARGETS.forEach(([key, label, unit, maximum]) => { payload[key] = optionalNumber(value[key], label, maximum, false); });
          for (const key of ['allergies', 'restrictions', 'preferences', 'notes']) payload[key] = textField(value[key], key[0].toUpperCase() + key.slice(1), 4000, false);
          run('Saving your shared planning profile…', () => store.saveDietProfile(payload), () => {
            resetGroup('diet', blankDiet()); profileVersions.diet = null;
            announce('Your shared planning profile was saved for the household.');
          });
        }
      } catch (error) { announce(errorMessage(error), true); refresh(); }
      return true;
    }
    function handleChange(event) {
      if (commerce && commerce.handleChange(event)) return true;
      const field = event.target;
      if (!field || !field.dataset) return false;
      const current = snapshot();
      if (Object.hasOwn(field.dataset, 'groceryHouseholdImport')) {
        const file = field.files && field.files[0];
        if (!file || busy || (commerce && commerce.isBusy())) return true;
        if (!requireReady(current)) return true;
        const mine = (current.members || []).find(member => member.user_id === current.user.id);
        if (!mine || mine.role !== 'owner') { announce('Only the household owner can restore a household backup.', true); return true; }
        if (file.size > 20 * 1024 * 1024) { announce('Choose a household JSON backup up to 20 MB.', true); return true; }
        backupReview = null;
        run('Reading the household backup for review…', async () => JSON.parse(await file.text()), payload => {
          const keys = ['products', 'recurringProducts', 'budgets', 'inventory', 'shoppingItems', 'bills', 'recipes', 'mealEntries', 'receipts', 'moneyEntries', 'foodFiles'];
          if (!payload || payload.app !== 'Life in Bloom Household' || payload.version !== 1 || payload.household_id !== current.household.id || !payload.data || !keys.every(key => Array.isArray(payload.data[key]))) throw new Error('Choose a Life in Bloom Household backup for this same household. No records were changed.');
          if (payload.data.billRules != null && !Array.isArray(payload.data.billRules)) throw new Error('The recurring bills in this backup are invalid. No records were changed.');
          backupReview = { name: file.name, payload, userId: current.user.id, householdId: current.household.id };
          announce('Review the backup details before restoring missing records.');
        });
        return true;
      }
      if (Object.hasOwn(field.dataset, 'groceryMonth')) {
        if (busy || (commerce && commerce.isBusy()) || !chooseMonth(field.value)) field.value = selectedMonth;
        return true;
      }
      if (field.dataset.groceryShoppingToggle) {
        const row = (current.shoppingItems || []).find(item => item.id === field.dataset.groceryShoppingToggle);
        if (!row) return true;
        const receipt = purchaseReceipt(current, row);
        field.checked = Boolean(receipt);
        if (busy || (commerce && commerce.isBusy()) || !requireReady(current)) return true;
        try {
          if (!commerce || !commerce.startPurchase) throw new Error('The purchase tools did not finish loading. Refresh the app before checking off an item.');
          if (receipt) {
            if (!commerce.openReceipt) throw new Error('Open Grocery receipts to review this saved purchase.');
            commerce.openReceipt(receipt.id);
          } else if (commerce.startPurchase(row, selectedMonth)) refresh('#commerce-purchase-line-total');
        } catch (error) { announce(errorMessage(error), true); refresh(); }
        return true;
      }
      return handleInput(event);
    }
    function handleClick(event) {
      if (commerce && commerce.handleClick(event)) return true;
      const element = event.target && event.target.closest && event.target.closest('[data-grocery-action]');
      if (!element || !element.dataset || !element.dataset.groceryAction) return false;
      const action = element.dataset.groceryAction;
      const actions = ['tab', 'auth-mode', 'retry', 'refresh', 'signout', 'filter-location', 'open-budget', 'edit-shopping', 'edit-inventory', 'clear-shopping', 'clear-inventory', 'clear-private', 'clear-diet', 'delete-shopping', 'delete-inventory', 'confirm-delete', 'keep-item', 'review-import', 'confirm-import', 'cancel-import', 'create-invite', 'record-trip', 'record-checked-trip', 'view-shopping-receipt', 'open-money', 'use-soon', 'freeze-inventory', 'export-household', 'restore-household', 'cancel-household-import'];
      if (!actions.includes(action)) return false;
      const current = snapshot();
      if (busy || (commerce && commerce.isBusy())) return true;
      try {
        if (action === 'auth-mode') {
          if (!['signin', 'signup', 'reset'].includes(element.dataset.groceryMode)) return true;
          authMode = element.dataset.groceryMode;
          const email = drafts.auth.email;
          resetGroup('auth', { email, password: '', confirmation: '' });
          refresh('#grocery-auth-email');
          return true;
        }
        if (action === 'retry' || action === 'refresh') {
          run('Refreshing your Grocery records…', () => action === 'retry' ? store.init() : store.refresh(), () => announce('Grocery records refreshed.'));
          return true;
        }
        if (action === 'signout') {
          const unpersisted = draftWriteFailed || (!draftStore && hasUnsavedDraft()) || Boolean(commerce && commerce.hasUnpersistedChanges && commerce.hasUnpersistedChanges()) || Boolean(options.hasOtherUnpersistedChanges && options.hasOtherUnpersistedChanges());
          if (unpersisted && confirm('Sign out and leave changes that this device has not saved? Cancel to save your changes or upload the selected file first.') !== true) return true;
          run('Signing out…', () => store.signOut(), () => { resetDrafts(); announce('You are signed out of Grocery.'); });
          return true;
        }
        if (!requireReady(current)) return true;
        if (action === 'tab') {
          selectTab(element.dataset.tab);
        } else if (action === 'record-trip' || action === 'record-checked-trip') {
          if (!commerce) throw new Error('The receipt tools did not finish loading. Refresh the app.');
          const items = monthItems(current).filter(row => !purchaseReceipt(current, row) && (action !== 'record-checked-trip' || row.checked));
          commerce.startReceipt(items, selectedMonth);
        } else if (action === 'view-shopping-receipt') {
          if (!commerce || !commerce.openReceipt) throw new Error('Open Grocery receipts to review this saved purchase.');
          commerce.openReceipt(element.dataset.id);
        } else if (action === 'open-money') {
          if (commerce && commerce.openMoneyMonth) commerce.openMoneyMonth(selectedMonth);
          else if (!commerce || commerce.setMonth(selectedMonth)) navigate('money');
        }
        else if (action === 'use-soon') { if (options.openFood) options.openFood('soon'); else navigate('food'); }
        else if (action === 'export-household') {
          run('Preparing the household backup…', () => store.exportHousehold(), payload => {
            const filename = 'life-in-bloom-household-' + monthKey(getNow()) + '-' + String(getNow().getDate()).padStart(2, '0') + '.json';
            if (options.download) options.download(payload, filename);
            else {
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob), link = document.createElement('a');
              link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            announce('Your household records were exported. Attached file contents stay in private online storage.');
          });
        } else if (action === 'cancel-household-import') { backupReview = null; refresh(); }
        else if (action === 'restore-household') {
          const mine = (current.members || []).find(member => member.user_id === current.user.id);
          if (!mine || mine.role !== 'owner' || !backupReview || backupReview.userId !== current.user.id || backupReview.householdId !== current.household.id) throw new Error('The household owner must review a backup for this household before restoring it.');
          const payload = backupReview.payload;
          run('Restoring missing household records…', () => store.importHouseholdBackup(payload), result => {
            backupReview = null;
            const skipped = result && (result.skippedFiles || result.skipped_files) || 0;
            announce('The backup was checked and missing household records restored. Existing records were kept.' + (skipped ? ' ' + skipped + ' unavailable attachment reference(s) were skipped.' : ''));
          });
        } else if (action === 'freeze-inventory') {
          const row = (current.inventory || []).find(item => item.id === element.dataset.id);
          if (!row) return true;
          if (dirty('inventory')) { announce('Save or discard the food entry you are editing first.', true); return true; }
          const value = { ...blankInventory(), ...row, location: 'freezer', frozen_on: monthKey(getNow()) + '-' + String(getNow().getDate()).padStart(2, '0') };
          for (const key of ['expires_on', 'opened_on', 'freezer_use_by']) value[key] = value[key] || '';
          resetGroup('inventory', value);
          announce('Review the frozen date, then save this food. Its printed package date is kept.');
          refresh('#grocery-inventory-frozen-on');
        } else if (action === 'open-budget') {
          if (chooseMonth(element.dataset.month)) { tab = 'budget'; refresh('#grocery-month'); }
        } else if (action === 'filter-location') {
          if (['all', ...LOCATIONS.map(entry => entry[0])].includes(element.dataset.location)) {
            inventoryFilter = element.dataset.location;
            if (!dirty('inventory') && !drafts.inventory.id) resetGroup('inventory', blankInventory(inventoryFilter === 'all' ? 'pantry' : inventoryFilter));
            refresh();
          }
        } else if (action === 'keep-item') { pendingDelete = null; refresh(); }
        else if (action.startsWith('clear-')) {
          const group = action.slice(6);
          if (group === 'shopping') resetGroup(group, blankShopping());
          else if (group === 'inventory') resetGroup(group, blankInventory(inventoryFilter === 'all' ? 'pantry' : inventoryFilter));
          else if (group === 'private') { resetGroup(group, blankPrivate()); profileVersions.private = null; }
          else if (group === 'diet') { resetGroup(group, blankDiet()); profileVersions.diet = null; }
          pendingDelete = null;
          refresh();
        } else if (action.startsWith('edit-') || action.startsWith('delete-')) {
          const group = action.split('-')[1];
          const row = (group === 'shopping' ? current.shoppingItems || [] : current.inventory || []).find(item => item.id === element.dataset.id);
          if (!row) return true;
          if (dirty(group)) { announce('Save or discard the ' + (group === 'shopping' ? 'shopping item' : 'food entry') + ' you are editing first.', true); return true; }
          if (action.startsWith('delete-')) pendingDelete = { type: group, row: { ...row } };
          else {
            const value = group === 'shopping' ? blankShopping() : blankInventory();
            for (const key of Object.keys(value)) if (row[key] != null) value[key] = row[key];
            if (group === 'shopping') value.estimate = moneyInput(row.estimate_cents);
            resetGroup(group, value);
            pendingDelete = null;
          }
          refresh(action.startsWith('edit-') ? '#grocery-' + group + '-name' : undefined);
        } else if (action === 'confirm-delete') {
          if (!pendingDelete || pendingDelete.type !== element.dataset.kind || pendingDelete.row.id !== element.dataset.id) return true;
          const { type, row } = pendingDelete;
          run('Removing the saved item…', () => type === 'shopping' ? store.deleteShoppingItem(row) : store.deleteInventory(row), () => {
            pendingDelete = null;
            if (drafts[type].id === row.id) resetGroup(type, type === 'shopping' ? blankShopping() : blankInventory());
            announce(row.name + ' was removed.');
          });
        } else if (action === 'review-import') {
          migrationReview = { userId: current.user.id, householdId: current.household.id, items: localShoppingPreview(getLocalShopping()) };
          refresh();
        } else if (action === 'cancel-import') { migrationReview = null; refresh(); }
        else if (action === 'confirm-import') {
          if (!migrationReview || migrationReview.userId !== current.user.id || migrationReview.householdId !== current.household.id) throw new Error('Review the device list for this household before copying it.');
          const items = migrationReview.items.map(item => ({ ...item }));
          run('Copying your reviewed grocery list…', () => store.importLocalShopping(items), () => {
            migrationReview = null;
            announce('Your reviewed device items are saved in this household. Items copied earlier were not duplicated.');
          });
        } else if (action === 'create-invite') {
          const mine = (current.members || []).find(member => member.user_id === current.user.id);
          if (!mine || mine.role !== 'owner' || (current.members || []).length >= 2) throw new Error('Only the household owner can create a code for an available household place.');
          run('Creating a household sharing code…', () => store.createInvite(), result => {
            invite = Array.isArray(result) ? result[0] : result;
            if (!invite || !invite.invite_code) throw new Error('The sharing code could not be shown. Please try again.');
            announce('Your sharing code is ready. Give it to the person you want to join your household.');
          }, '#grocery-sharing-code');
        }
      } catch (error) { announce(errorMessage(error), true); refresh(); }
      return true;
    }
    function selectTab(value) {
      snapshot();
      if (!TABS.some(([key]) => key === value) || busy || (commerce && commerce.isBusy())) return false;
      if (commerce && ['catalog', 'recurring', 'receipts'].includes(value) && !commerce.setMonth(selectedMonth)) return false;
      tab = value;
      persistDrafts(); refresh(); return true;
    }
    function getHomeSummary() {
      const current = snapshot();
      if (current.status === 'ready' && current.household) {
        const thisMonth = monthKey(getNow());
        const count = (current.shoppingItems || []).filter(item => !item.checked && !purchaseReceipt(current, item) && (!item.month || item.month.slice(0, 7) === thisMonth)).length;
        return { count, title: count + ' item' + (count === 1 ? '' : 's') + ' to buy', description: 'Shared with ' + (current.household.name || 'your household'), status: current.status };
      }
      return { count: null, title: current.status === 'loading' ? 'Opening Grocery…' : current.user ? 'Open your household' : 'Sign in to Grocery', description: 'Your shared shopping list', status: current.status };
    }
    if (commerce && commerce.setMonthGuard) commerce.setMonthGuard(next => {
      const allowed = next === selectedMonth || !dirty('budget') || confirm('Change month and discard the budget amount you have not saved?') === true;
      approvedCommerceMonth = allowed ? next : null;
      return allowed;
    });
    if (commerce && commerce.setSectionHandler) commerce.setSectionHandler((value, month) => {
      snapshot();
      if (validMonth(month) && month !== selectedMonth) {
        if (approvedCommerceMonth === month) {
          selectedMonth = month;
          approvedCommerceMonth = null;
          resetGroup('budget', { amount: '', household_amount: '', revision: null });
          profileVersions.budget = null;
        } else if (!chooseMonth(month)) return false;
      }
      if (TABS.some(([key]) => key === value)) tab = value;
      persistDrafts(); refresh(); return true;
    });
    return { render, handleClick, handleSubmit, handleInput, handleChange, hasUnsavedDraft, hasUnpersistedChanges: () => draftWriteFailed || (!draftStore && hasUnsavedDraft()) || Boolean(commerce && commerce.hasUnpersistedChanges && commerce.hasUnpersistedChanges()), discardDraft, getHomeSummary, selectTab, isBusy: () => Boolean(busy) || Boolean(commerce && commerce.isBusy()), whenIdle: () => commerce ? Promise.all([pendingTask, commerce.whenIdle()]) : pendingTask };
  }

  const api = { createController, centsFromInput, localShoppingPreview };
  root.BloomGrocery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
