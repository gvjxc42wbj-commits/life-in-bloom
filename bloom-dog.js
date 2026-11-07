/* Shared dog care and housework, with one history for who completed each task. */
(function (root) {
  'use strict';
  const M = root.BloomDogModel || (typeof require === 'function' ? require('./bloom-dog-model.js') : null);
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const REJECTIONS = new Set(['22023', '23502', '23503', '23505', '23514', '40001', '42501']);
  const GROUPS = ['profile', 'weight', 'task', 'note', 'supply', 'purchase'];
  const LISTS = { profile: 'dogProfiles', weight: 'dogWeights', task: 'routineTasks', note: 'dogNotes', supply: 'dogSupplies' };
  const METHODS = { profile: 'saveDogProfile', weight: 'saveDogWeight', task: 'saveRoutineTask', note: 'saveDogNote', supply: 'saveDogSupply' };
  const uuid = () => {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
  };
  function text(value, label, limit, required) {
    const result = String(value == null ? '' : value).trim();
    if (required && !result) throw new Error('Enter ' + label.toLowerCase() + '.');
    if (result.length > limit) throw new Error(label + ' is too long.');
    return result;
  }
  function numeric(value, label, minimum, maximum, optional) {
    if (value == null || String(value).trim() === '') {
      if (optional) return null;
      throw new Error('Enter ' + label.toLowerCase() + '.');
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(label + ' must be from ' + minimum + ' to ' + maximum + '.');
    return number;
  }
  function integer(value, label, minimum, maximum) {
    const number = numeric(value, label, minimum, maximum, false);
    if (!Number.isInteger(number)) throw new Error(label + ' must be a whole number.');
    return number;
  }
  function cents(value, label, optional) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw && optional) return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(label + ' needs a dollar amount with up to two decimal places.');
    const [whole, fraction = ''] = raw.split('.');
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(result) || result > 1000000000) throw new Error(label + ' is outside the supported range.');
    return result;
  }
  function date(value, label, optional, today) {
    if (!value && optional) return null;
    if (M.dateNumber(value) == null) throw new Error('Choose a valid ' + label.toLowerCase() + '.');
    if (today && value > today) throw new Error(label + ' cannot be in the future.');
    return value;
  }
  function times(value) {
    const rows = Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/).filter(Boolean);
    if (rows.length > 8 || rows.some(row => !M.validTime(row)) || new Set(rows).size !== rows.length) throw new Error('Use up to eight different times in 24-hour HH:MM format, separated by commas.');
    return rows.sort();
  }
  function blank(group, on, domain) {
    const common = { id: '', request_id: uuid(), revision: null };
    if (group === 'profile') return { ...common, name: '', breed: '', birth_on: '', notes: '' };
    if (group === 'weight') return { ...common, occurred_on: on, weight: '', weight_unit: 'lb', notes: '' };
    if (group === 'task') return { ...common, domain: domain || 'dog', name: '', category: domain === 'housework' ? 'cleaning_shared_spaces' : 'other', frequency: 'daily', interval_days: '1', interval_months: '1', anchor_on: on, end_on: '', times_text: '', rolling: true, active: true, dose_text: '', notes: '' };
    if (group === 'note') return { ...common, occurred_on: on, kind: 'behavior', minutes: '', notes: '' };
    if (group === 'supply') return { ...common, product_id: '', name: '', unit_label: 'package', stock_quantity: '0', refill_threshold: '1', needs_refill: false, reference_price: '', notes: '' };
    return { ...common, supply_id: '', product_id: '', name: '', unit_label: 'package', purchased_on: on, store: '', payer_slot: '', packs: '1', amount: '', notes: '', shopping_item_id: null, shopping_revision: null };
  }
  function editable(group, row, on) {
    const result = blank(group, on, row && row.domain);
    if (!row) return result;
    for (const key of Object.keys(result)) if (Object.hasOwn(row, key) && row[key] != null) result[key] = copy(row[key]);
    result.id = row.id; result.revision = row.revision; result.request_id = uuid();
    if (group === 'weight') { result.weight = Number(row.weight_kg); result.weight_unit = 'kg'; }
    if (group === 'task') result.times_text = (row.times || []).join(', ');
    if (group === 'supply') result.reference_price = row.reference_price_cents == null ? '' : (Number(row.reference_price_cents) / 100).toFixed(2);
    return result;
  }
  function pendingItem(current, supply, month) {
    const completed = new Set((current.receipts || []).filter(row => !row.voided_at).flatMap(row => row.shopping_effects || []).filter(effect => effect.after && effect.after.checked === true).map(effect => effect.id));
    return (current.shoppingItems || []).filter(row => row.product_id === supply.product_id && row.category === 'household' && !row.checked && !completed.has(row.id) && String(row.month || '').slice(0, 7) === month.slice(0, 7)).sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)))[0] || null;
  }

  function createController(options) {
    if (!M) throw new Error('Dog care tools could not load. Please refresh.');
    const store = options.store;
    if (!store || typeof store.snapshot !== 'function') throw new Error('The household store is not available.');
    const refresh = options.refresh || (() => {}), notify = options.notify || (() => {}), navigate = options.navigate || (() => {});
    const confirm = options.confirm || (message => typeof root.confirm === 'function' && root.confirm(message));
    const getNow = options.getNow || (() => new Date()), draftStore = options.draftStore || null;
    const openGrocery = options.openGrocery || ((tab) => navigate('grocery', tab));
    let identity = null, generation = 0, page = 'dog', tab = 'today', houseworkTab = 'today';
    let selectedDate = M.dayKey(getNow()), lastToday = selectedDate, person = '1', showDog = true, refillOnly = false;
    let opened = '', busy = null, pending = Promise.resolve(), attempt = null, problem = '', draftSaved = false, draftWarning = false;
    let drafts = Object.fromEntries(GROUPS.map(group => [group, blank(group, selectedDate)])), baselines = copy(drafts);
    const dirty = group => JSON.stringify(drafts[group]) !== JSON.stringify(baselines[group]);
    const anyDirty = () => GROUPS.some(dirty);
    function reset(group, value) { drafts[group] = copy(value); baselines[group] = copy(value); }
    function restore(saved) {
      if (!saved || saved.version !== 1 || !saved.drafts || !saved.baselines) return false;
      for (const group of GROUPS) {
        const empty = blank(group, selectedDate);
        const take = source => {
          const value = copy(empty);
          for (const key of Object.keys(empty)) if (source && Object.hasOwn(source, key) && (['string', 'number', 'boolean'].includes(typeof source[key]) || source[key] === null)) value[key] = copy(source[key]);
          return value;
        };
        drafts[group] = take(saved.drafts[group]); baselines[group] = take(saved.baselines[group]);
      }
      if (M.dateNumber(saved.selectedDate) != null) selectedDate = saved.selectedDate;
      if (['today', 'plan', 'supplies', 'notes', 'history'].includes(saved.tab)) tab = saved.tab;
      if (['today', 'plan', 'history'].includes(saved.houseworkTab)) houseworkTab = saved.houseworkTab;
      if (GROUPS.includes(saved.opened)) opened = saved.opened;
      person = saved.person === '2' ? '2' : '1'; showDog = saved.showDog !== false; refillOnly = saved.refillOnly === true;
      if (saved.attempt && typeof saved.attempt === 'object' && typeof saved.attempt.method === 'string' && Array.isArray(saved.attempt.args) && saved.attempt.args.length <= 2 && ['saveDogProfile', 'saveDogWeight', 'saveRoutineTask', 'saveRoutineLog', 'saveDogNote', 'saveDogSupply', 'recordReceipt', 'archiveLifeRecord', 'addDogSupplyToShopping'].includes(saved.attempt.method)) attempt = copy(saved.attempt);
      problem = String(saved.problem || '');
      return true;
    }
    function snapshot() {
      const current = store.snapshot() || {};
      const key = (current.user && current.user.id || '') + ':' + (current.household && current.household.id || '');
      const today = M.dayKey(getNow());
      if (key !== identity) {
        identity = key; generation++; busy = null; page = 'dog'; tab = 'today'; houseworkTab = 'today'; selectedDate = today; lastToday = today;
        person = (current.members || []).some(member => member.user_id === (current.user || {}).id && member.role === 'member') ? '2' : '1';
        showDog = true; refillOnly = false; opened = ''; attempt = null; problem = ''; draftSaved = false; draftWarning = false;
        drafts = Object.fromEntries(GROUPS.map(group => [group, blank(group, selectedDate)])); baselines = copy(drafts);
        if (draftStore && current.user && current.household) {
          try { const saved = draftStore.read(current.user.id, current.household.id, 'dog'); draftSaved = Boolean(saved && restore(saved.data)); }
          catch (_) { notify('Your saved Dog draft could not be opened. The stored copy has not been changed.', true); }
        }
      } else if (today !== lastToday) {
        if (selectedDate === lastToday && !anyDirty() && !attempt && !busy) selectedDate = today;
        lastToday = today;
      }
      return current;
    }
    function persist() {
      const current = snapshot();
      if (!draftStore || !current.user || !current.household) return;
      try {
        const changed = anyDirty() || Boolean(attempt);
        const ok = changed ? draftStore.write(current.user.id, current.household.id, 'dog', { version: 1, drafts, baselines, opened, selectedDate, person, tab, houseworkTab, showDog, refillOnly, attempt, problem }) : draftStore.clear(current.user.id, current.household.id, 'dog');
        draftSaved = changed && ok !== false;
        if (ok === false && !draftWarning) { draftWarning = true; notify('This device could not save your care draft. Keep this page open until you save it online.', true); }
      } catch (_) { draftSaved = false; if (!draftWarning) { draftWarning = true; notify('Your care draft could not be saved on this device. Keep the page open until you save it online.', true); } }
      if (root.document && root.document.querySelectorAll) for (const element of root.document.querySelectorAll('[data-dog-draft-status]')) {
        const group = element.dataset.dogDraftStatus;
        element.hidden = !GROUPS.includes(group) || !dirty(group);
        element.textContent = draftSaved ? 'Draft saved on this device. Save the entry to share it with your household.' : 'Draft in progress. Save before closing this page.';
      }
    }
    function ready(current) {
      if (!current.user || !current.household || current.status !== 'ready') throw new Error('Open Grocery and connect your household before saving care records.');
      if (current.offline) throw new Error('You are offline. Your draft stays on this device. Reconnect to save it to your household.');
    }
    function run(label, work, success, failure, focus) {
      if (busy) return false;
      const token = generation; busy = label; refresh();
      pending = Promise.resolve().then(() => {
        snapshot(); if (token !== generation) return;
        return work();
      }).then(result => {
        snapshot(); if (token !== generation) return;
        if (success) success(result); persist();
      }).catch(error => {
        snapshot(); if (token !== generation) return;
        if (failure) failure(error); persist(); notify(error && error.message || 'The change could not be saved. Your draft is still here.', true);
      }).finally(() => { snapshot(); if (token !== generation) return; busy = null; refresh(focus); });
      return true;
    }
    function button(action, label, data, primary, disabled) {
      return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-dog-action="' + action + '"' + (data || '') + (busy || disabled ? ' disabled' : '') + '>' + label + '</button>';
    }
    function field(group, name, label, type, attrs) {
      return '<label class="dog-field" for="dog-' + group + '-' + name + '"><span>' + label + '</span><input id="dog-' + group + '-' + name + '" name="' + name + '" type="' + (type || 'text') + '" data-dog-field="' + group + '.' + name + '" value="' + esc(drafts[group][name]) + '"' + (attrs || '') + (busy || attempt ? ' disabled' : '') + '></label>';
    }
    function textarea(group, name, label, max) {
      return '<label class="dog-field" for="dog-' + group + '-' + name + '"><span>' + label + '</span><textarea id="dog-' + group + '-' + name + '" name="' + name + '" data-dog-field="' + group + '.' + name + '" maxlength="' + max + '"' + (busy || attempt ? ' disabled' : '') + '>' + esc(drafts[group][name]) + '</textarea></label>';
    }
    function select(group, name, label, rows) {
      return '<label class="dog-field" for="dog-' + group + '-' + name + '"><span>' + label + '</span><select id="dog-' + group + '-' + name + '" name="' + name + '" data-dog-field="' + group + '.' + name + '"' + (busy || attempt ? ' disabled' : '') + '>' + rows.map(([value, title]) => '<option value="' + esc(value) + '"' + (String(drafts[group][name]) === String(value) ? ' selected' : '') + '>' + esc(title) + '</option>').join('') + '</select></label>';
    }
    function checkbox(group, name, label) {
      return '<label class="dog-check"><input type="checkbox" name="' + name + '" data-dog-field="' + group + '.' + name + '"' + (drafts[group][name] ? ' checked' : '') + (busy || attempt ? ' disabled' : '') + '><span>' + label + '</span></label>';
    }
    function formEnd(group, label, offline) {
      return '<div class="dog-actions"><button type="submit" class="button primary"' + (busy || offline || attempt ? ' disabled' : '') + '>' + label + '</button>' + button('close-form', 'Close for now') + button('discard-form', 'Discard draft', ' data-group="' + group + '"', false, Boolean(attempt)) + '</div><p class="dog-draft" data-dog-draft-status="' + group + '" role="status"' + (!dirty(group) ? ' hidden' : '') + '>' + (draftSaved ? 'Draft saved on this device. Save the entry to share it with your household.' : 'Draft in progress. Save before closing this page.') + '</p></form></section>';
    }
    function datePicker() {
      return '<label class="dog-date"><span>Viewing day</span><input type="date" data-dog-control="date" value="' + selectedDate + '" min="1900-01-01" max="2200-12-31"' + (busy ? ' disabled' : '') + '></label>';
    }
    function people() {
      return '<div class="dog-person-picker"><span>Who is completing this?</span><div role="group" aria-label="Person completing care">' + ['1', '2'].map(slot => '<button type="button" class="dog-person-' + slot + '" data-dog-action="person" data-person="' + slot + '" aria-pressed="' + (person === slot) + '"' + (busy || attempt ? ' disabled' : '') + '>Person ' + slot + '</button>').join('') + '</div></div>';
    }
    function renderProfile(current) {
      const profile = M.usable(current.dogProfiles)[0] || {}, weight = M.latestWeight(current, selectedDate);
      return '<section class="panel dog-id-card"><img class="dog-companion" src="./icons/dog-companion.jpeg" alt="Brown dachshund illustration"><div class="dog-id-content"><p class="page-kicker">A little care, every day</p><h2>' + esc(profile.name || 'Your dog') + '</h2><p class="dog-breed">' + esc(profile.breed || 'Add their breed to the profile') + '</p><div class="dog-id-tags"><span>🎂 ' + esc(profile.birth_on ? M.ageLabel(profile.birth_on, selectedDate) : 'Date of birth not set') + '</span><span>⚖️ ' + (weight ? esc(M.format(Number(weight.weight_kg) / 0.45359237)) + ' lb · ' + esc(M.format(weight.weight_kg)) + ' kg' : 'Weight not recorded') + '</span></div>' + (profile.birth_on ? '<p class="dog-help">Born ' + esc(M.dateLabel(profile.birth_on, true)) + (weight ? ' · Weight logged ' + esc(M.dateLabel(weight.occurred_on, true)) : '') + '</p>' : weight ? '<p class="dog-help">Weight logged ' + esc(M.dateLabel(weight.occurred_on, true)) + '</p>' : '') + '<div class="dog-actions">' + button('edit-profile', profile.id ? 'Edit profile' : 'Set up profile', '', false, Boolean(attempt)) + button('new-weight', '+ Log weight', '', false, Boolean(attempt)) + '</div></div></section>';
    }
    function renderTaskRows(current, rows) {
      if (!rows.length) return '<div class="dog-empty"><strong>No care tasks due on this day.</strong><p>Add a routine or check the care plan for the next dates.</p></div>';
      const future = selectedDate > M.dayKey(getNow());
      return '<ul class="dog-task-list">' + rows.map(row => {
        const category = M.categoryInfo(row.task.category), personLabel = row.log && row.log.person_slot ? 'Person ' + row.log.person_slot : 'Household';
        return '<li class="dog-task-row' + (row.done ? ' is-done' : '') + '"><label class="dog-completion"><input type="checkbox" data-dog-complete="' + esc(row.task.id) + '" data-dog-slot="' + esc(row.slot) + '"' + (row.done ? ' checked' : '') + (busy || attempt || current.offline || future ? ' disabled' : '') + ' aria-label="' + esc((row.done ? 'Undo ' : 'Complete ') + row.task.name + ' at ' + M.timeLabel(row.slot)) + '"><span aria-hidden="true">' + category.icon + '</span></label><div class="dog-task-copy"><strong>' + esc(row.task.name) + '</strong><div class="dog-task-meta"><span>' + esc(M.timeLabel(row.slot)) + '</span>' + (page === 'housework' && row.task.domain === 'dog' ? '<span class="dog-badge">Dog care</span>' : '') + (row.overdue && !row.done ? '<span class="dog-badge is-due">Due ' + esc(M.dateLabel(row.due_on, true)) + '</span>' : '') + '</div>' + (row.task.dose_text ? '<p class="dog-dose">Saved directions: ' + esc(row.task.dose_text) + '</p>' : '') + (row.task.notes ? '<p class="dog-help">' + esc(row.task.notes) + '</p>' : '') + (row.done ? '<span class="dog-person-credit dog-person-' + esc(row.log.person_slot || 1) + '">✓ ' + esc(personLabel) + ' completed this</span>' : row.overdue && row.task.category === 'medication' ? '<p class="dog-help">Check the saved care instructions before recording a missed dose.</p>' : '') + '</div>' + button('care-calendar', 'Calendar', ' data-id="' + esc(row.task.id) + '" data-dog-slot="' + esc(row.slot) + '" data-date="' + esc(row.due_on) + '"') + '</li>';
      }).join('') + '</ul>';
    }
    function renderToday(current) {
      const domain = page === 'dog' ? 'dog' : null;
      const tasks = M.usable(current.routineTasks).filter(task => page !== 'housework' || showDog || task.domain === 'housework');
      const rows = M.dueTasks(tasks, current.routineLogs, selectedDate, domain), complete = rows.filter(row => row.done).length;
      const upcoming = tasks.filter(task => !domain || task.domain === domain).map(task => ({ task, date: M.nextDue(task, current.routineLogs, selectedDate) })).filter(item => item.date && item.date > selectedDate).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
      let html = '<section class="panel"><div class="dog-heading"><div><p class="page-kicker">' + (page === 'dog' ? 'Daily care checklist' : 'Shared household checklist') + '</p><h2>' + (page === 'dog' ? 'A good day for your dog' : 'What needs doing') + '</h2></div><span class="dog-badge">' + complete + ' / ' + rows.length + ' complete</span></div><p class="dog-help">' + esc(M.dateLabel(selectedDate)) + '. Completed tasks stay in history when a new day starts.</p>' + people();
      if (page === 'housework') html += '<label class="dog-check"><input type="checkbox" data-dog-control="show-dog"' + (showDog ? ' checked' : '') + '> Include Dog care in Housework</label><p class="dog-help">These are the same Dog records. Checking a task here also updates the Dog page.</p>';
      if (selectedDate > M.dayKey(getNow())) html += '<p class="dog-notice">This is a future day. You can review the plan; completion is recorded after the task is done.</p>';
      html += renderTaskRows(current, rows) + '<div class="dog-actions">' + button('new-task', '+ Add ' + (page === 'dog' ? 'care task' : 'household task'), '', true, Boolean(attempt)) + button('tab', page === 'dog' ? 'Care plan' : 'Manage routines', ' data-tab="plan"') + '</div></section>';
      if (upcoming.length) html += '<section class="panel"><h3>Coming up</h3><ul class="dog-upcoming">' + upcoming.map(item => '<li><div><strong>' + esc(item.task.name) + '</strong><span>' + esc(M.dateLabel(item.date, true)) + ' · ' + esc(M.frequencyLabel(item.task)) + '</span></div>' + button('care-calendar', 'Calendar', ' data-id="' + esc(item.task.id) + '" data-date="' + item.date + '" data-dog-slot="' + esc(M.slots(item.task)[0]) + '"') + '</li>').join('') + '</ul><p class="dog-help">Reminders appear here in the app. Calendar downloads let you add a reminder to your calendar; the app does not send phone notifications while closed.</p></section>';
      return html;
    }
    function renderPlan(current) {
      const tasks = M.usable(current.routineTasks).filter(task => page === 'dog' ? task.domain === 'dog' : true);
      let html = '<section class="panel"><div class="dog-heading"><div><p class="page-kicker">Routines that fit your days</p><h2>' + (page === 'dog' ? 'Your dog’s care plan' : 'Household routines') + '</h2></div>' + button('new-task', '+ Add a task', '', true, Boolean(attempt)) + '</div><p class="dog-help">Set times, repeating care and one-time appointments. A plan stays separate from the record of what was completed.</p>';
      if (page === 'dog') html += '<details class="dog-starters"' + (!tasks.length ? ' open' : '') + '><summary>Start from your care checklist</summary><p class="dog-help">Choose a starter, review its date and timing, then save. Feeding amounts and medication directions come from your own care plan.</p><div class="dog-template-grid">' + M.TEMPLATES.map(template => button('task-template', M.categoryInfo(template.category).icon + ' ' + esc(template.name || 'Medication / preventive care'), ' data-template="' + template.key + '"', false, Boolean(attempt))).join('') + '</div></details>';
      html += '</section><section class="panel">' + (tasks.length ? '<ul class="dog-plan-list">' + tasks.map(task => {
        const next = M.nextDue(task, current.routineLogs, selectedDate);
        return '<li><div><div class="dog-task-meta"><span>' + M.categoryInfo(task.category).icon + ' ' + esc(M.categoryInfo(task.category).label) + '</span><span class="dog-badge">' + (task.active === false ? 'Paused' : task.domain === 'dog' ? 'Dog care' : 'Housework') + '</span></div><h3>' + esc(task.name) + '</h3><p>' + esc(M.frequencyLabel(task)) + ' · ' + M.slots(task).map(slot => esc(M.timeLabel(slot))).join(', ') + '</p><p class="dog-help">' + (next ? 'Next due: ' + esc(M.dateLabel(next, true)) : task.active === false ? 'Paused until you reactivate this routine.' : 'No upcoming date in this saved schedule.') + '</p>' + (task.dose_text ? '<p class="dog-dose">Saved directions: ' + esc(task.dose_text) + '</p>' : '') + '</div><div class="dog-actions">' + button('edit-task', 'Edit', ' data-id="' + esc(task.id) + '"', false, Boolean(attempt)) + button('archive-record', 'Archive', ' data-group="task" data-id="' + esc(task.id) + '"', false, Boolean(attempt) || current.offline) + '</div></li>';
      }).join('') + '</ul>' : '<div class="dog-empty"><strong>Your routines will live here.</strong><p>Add a care task or household chore to begin.</p></div>') + '</section>';
      return html;
    }
    function renderSupplies(current) {
      const all = M.usable(current.dogSupplies), rows = all.filter(row => !refillOnly || M.needsRefill(row));
      const expense = M.expenses(current, selectedDate.slice(0, 7));
      return '<section class="panel"><div class="dog-heading"><div><p class="page-kicker">Food, treats & care supplies</p><h2>What your dog has at home</h2></div>' + button('new-supply', '+ Add a supply', '', true, Boolean(attempt)) + '</div><p class="dog-help">Stock is counted in the package or unit you choose. Confirmed purchases update this stock and the same Money ledger used by Grocery.</p><div class="dog-supply-totals"><div><span>Recorded purchases this month</span><strong>' + M.money(expense.cents) + (expense.incomplete ? ' known' : '') + '</strong></div><div><span>Need a refill</span><strong>' + all.filter(M.needsRefill).length + '</strong></div></div><label class="dog-check"><input type="checkbox" data-dog-control="refill-only"' + (refillOnly ? ' checked' : '') + '> Show only supplies needing a refill</label></section><section class="panel">' + (rows.length ? '<div class="dog-supply-grid">' + rows.map(supply => {
        const pending = supply.product_id ? pendingItem(current, supply, selectedDate.slice(0, 7)) : null;
        return '<article class="dog-supply-card"><span class="dog-badge' + (M.needsRefill(supply) ? ' is-due' : ' is-stock') + '">' + (M.needsRefill(supply) ? 'Needs refill' : 'In stock') + '</span><h3>' + esc(supply.name) + '</h3><p class="dog-stock-count">' + esc(M.format(supply.stock_quantity)) + ' <small>' + esc(supply.unit_label || 'package') + '</small></p><p class="dog-help">Reference price: ' + (supply.reference_price_cents == null ? 'not set' : M.money(supply.reference_price_cents) + ' per ' + esc(supply.unit_label || 'package')) + (pending ? '<br>Already on this month’s grocery list.' : '') + '</p>' + (supply.notes ? '<p class="dog-help">' + esc(supply.notes) + '</p>' : '') + '<div class="dog-actions">' + button('add-supply-shopping', pending ? 'Open grocery list' : '+ Add 1 to grocery list', ' data-id="' + esc(supply.id) + '"', false, Boolean(attempt) || current.offline) + button('purchase-supply', 'Record purchase', ' data-id="' + esc(supply.id) + '"', true, Boolean(attempt)) + button('edit-supply', 'Update stock / details', ' data-id="' + esc(supply.id) + '"', false, Boolean(attempt)) + '</div></article>';
      }).join('') + '</div>' : '<div class="dog-empty"><strong>' + (all.length ? 'No supplies match this filter.' : 'Add your dog’s regular supplies.') + '</strong><p>Keep food, grooming items and other pet supplies together.</p></div>') + '</section><section class="panel"><h3>Recent dog purchases</h3>' + renderPurchases(current, 12) + '</section>';
    }
    function renderPurchases(current, limit) {
      const rows = M.purchaseHistory(current).slice(0, limit || 30), supplies = new Map((current.dogSupplies || []).map(row => [row.id, row]));
      if (!rows.length) return '<p class="dog-help">No dog purchases have been recorded yet. Reference prices and grocery-list items do not count as spending.</p>';
      return '<ul class="dog-history-list">' + rows.map(row => '<li><div><strong>' + esc(row.supply_name || (supplies.get(row.supply_id) || {}).name || 'Dog supply purchase') + '</strong><span>' + esc(M.dateLabel(row.purchased_on, true)) + (row.receipt && row.receipt.store ? ' · ' + esc(row.receipt.store) : '') + '</span><span>' + esc(M.format(row.quantity)) + ' ' + esc(row.unit_label || 'packages') + ' · ' + M.money(row.amount_cents) + (row.reversed ? ' · Reversed' : '') + '</span></div>' + button('open-receipt', 'Shopping trip', ' data-id="' + esc(row.receipt_id) + '" data-month="' + esc(String(row.purchased_on || '').slice(0, 7)) + '"') + '</li>').join('') + '</ul>';
    }
    function renderNotes(current) {
      const notes = M.usable(current.dogNotes).sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)));
      return '<section class="panel"><div class="dog-heading"><div><p class="page-kicker">Notice the little things</p><h2>Behavior & training notes</h2></div>' + button('new-note', '+ Add a note', '', true, Boolean(attempt)) + '</div><p class="dog-help">Keep a dated record of behavior, practice and progress that both household members can see.</p></section><section class="panel">' + (notes.length ? '<ul class="dog-notes-list">' + notes.map(note => '<li><div class="dog-task-meta"><span class="dog-badge">' + (note.kind === 'training' ? 'Training' : 'Behavior') + '</span><span>' + esc(M.dateLabel(note.occurred_on, true)) + (note.minutes != null ? ' · ' + esc(M.format(note.minutes)) + ' min' : '') + '</span></div><p class="dog-prose">' + esc(note.notes) + '</p><div class="dog-actions">' + button('edit-note', 'Edit', ' data-id="' + esc(note.id) + '"', false, Boolean(attempt)) + button('archive-record', 'Archive', ' data-group="note" data-id="' + esc(note.id) + '"', false, Boolean(attempt) || current.offline) + '</div></li>').join('') + '</ul>' : '<div class="dog-empty"><strong>A place to keep what you notice.</strong><p>Notes are saved with their date; training time is optional.</p></div>') + '</section>';
    }
    function renderHistory(current) {
      const tasks = new Map((current.routineTasks || []).map(row => [row.id, row]));
      const logs = M.usable(current.routineLogs).filter(log => page === 'housework' || (M.snapshotBody(log).domain || (tasks.get(log.task_id) || {}).domain) === 'dog').sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.updated_at || b.created_at || b.id).localeCompare(String(a.updated_at || a.created_at || a.id)));
      let html = '<section class="panel"><p class="page-kicker">Saved care history</p><h2>Who did what</h2><p class="dog-help">Each completion keeps its date, person and saved task details. Undoing a check stays visible in this history.</p>' + (logs.length ? '<ul class="dog-history-list">' + logs.map(log => {
        const saved = M.snapshotBody(log), task = tasks.get(log.task_id) || {};
        return '<li><div><strong>' + esc(saved.name || task.name || 'Saved care task') + '</strong><span>' + esc(M.dateLabel(log.occurred_on, true)) + ' · ' + esc(M.timeLabel(log.slot)) + '</span><span class="dog-person-credit dog-person-' + esc(log.person_slot || 1) + '">Person ' + esc(log.person_slot || 1) + ' · ' + (log.done ? 'Completed' : 'Completion undone') + '</span>' + (saved.dose_text ? '<p class="dog-help">Saved directions: ' + esc(saved.dose_text) + '</p>' : '') + (log.notes ? '<p class="dog-prose">' + esc(log.notes) + '</p>' : '') + '</div>' + (log.done ? button('undo-log', 'Undo check', ' data-id="' + esc(log.id) + '"', false, Boolean(attempt) || current.offline) : '') + '</li>';
      }).join('') + '</ul>' : '<div class="dog-empty"><strong>No completed tasks yet.</strong><p>Check off a task after it is done to build this history.</p></div>') + '</section>';
      if (page === 'dog') {
        const weights = M.usable(current.dogWeights).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)));
        html += '<section class="panel"><div class="dog-heading"><h3>Weight history</h3>' + button('new-weight', '+ Log weight', '', false, Boolean(attempt)) + '</div>' + (weights.length ? '<ul class="dog-history-list">' + weights.map(row => '<li><div><strong>' + esc(M.format(Number(row.weight_kg) / 0.45359237)) + ' lb · ' + esc(M.format(row.weight_kg)) + ' kg</strong><span>' + esc(M.dateLabel(row.occurred_on, true)) + '</span>' + (row.notes ? '<p class="dog-prose">' + esc(row.notes) + '</p>' : '') + '</div><div class="dog-actions">' + button('edit-weight', 'Edit', ' data-id="' + esc(row.id) + '"', false, Boolean(attempt)) + button('archive-record', 'Archive', ' data-group="weight" data-id="' + esc(row.id) + '"', false, Boolean(attempt) || current.offline) + '</div></li>').join('') + '</ul>' : '<p class="dog-help">A weight entry will show here after you save one.</p>') + '</section><section class="panel"><h3>Dog purchase history</h3>' + renderPurchases(current, 60) + '</section>';
      }
      return html;
    }
    function renderForm(current) {
      if (!GROUPS.includes(opened)) return '';
      const group = opened, value = drafts[group], today = M.dayKey(getNow());
      const titles = { profile: 'Your dog’s profile', weight: value.id ? 'Correct a weight entry' : 'Log a weight', task: value.id ? 'Edit this routine' : 'Add a routine', note: value.id ? 'Edit this note' : 'Save a behavior or training note', supply: value.id ? 'Update this supply' : 'Add a dog supply', purchase: 'Record this dog purchase' };
      let html = '<section class="panel dog-editor" id="dog-editor"><h2>' + titles[group] + '</h2><form data-dog-form="' + group + '" class="dog-form">';
      if (group === 'profile') html += '<div class="dog-form-grid">' + field(group, 'name', 'Dog’s name', 'text', ' required maxlength="160"') + field(group, 'breed', 'Breed (optional)', 'text', ' maxlength="160"') + field(group, 'birth_on', 'Date of birth (optional)', 'date', ' min="1900-01-01" max="' + today + '"') + '</div>' + textarea(group, 'notes', 'Profile notes (optional)', 4000);
      if (group === 'weight') html += '<div class="dog-form-grid">' + field(group, 'occurred_on', 'Date measured', 'date', ' required min="1900-01-01" max="' + today + '"') + field(group, 'weight', 'Measured weight', 'number', ' required min="0.001" max="661.3867865" step="any" inputmode="decimal"') + select(group, 'weight_unit', 'Unit', [['lb', 'Pounds (lb)'], ['kg', 'Kilograms (kg)']]) + '</div>' + textarea(group, 'notes', 'Notes (optional)', 4000);
      if (group === 'task') {
        html += '<div class="dog-form-grid">' + field(group, 'name', 'Task name', 'text', ' required maxlength="160"') + select(group, 'domain', 'Where it belongs', [['dog', 'Dog care · also shown in Housework'], ['housework', 'Housework']]) + select(group, 'category', 'Category', (value.domain === 'housework' ? M.HOUSEWORK_CATEGORIES : M.CATEGORIES).map(row => [row[0], row[1]])) + select(group, 'frequency', 'Repeat', [['daily', 'Every day'], ['interval', 'Every set number of days'], ['monthly', 'Every calendar month'], ['once', 'One time']]) + '</div>';
        if (value.frequency === 'interval') html += '<div class="dog-form-grid">' + field(group, 'interval_days', 'Days between care', 'number', ' required min="1" max="3650" step="1"') + '</div>' + checkbox(group, 'rolling', 'Start the next interval after this task is completed') + '<p class="dog-help">For tasks with several times, every time must be checked off on a completion day before the next interval begins.</p>';
        if (value.frequency === 'monthly') html += field(group, 'interval_months', 'Months between care', 'number', ' required min="1" max="120" step="1"') + '<p class="dog-help">Monthly care follows the starting day of the month. A shorter month uses its last day.</p>';
        html += '<div class="dog-form-grid">' + field(group, 'anchor_on', value.frequency === 'once' ? 'Scheduled date' : 'First care date', 'date', ' required min="1900-01-01" max="2200-12-31"') + field(group, 'end_on', 'End date (optional)', 'date', ' min="1900-01-01" max="2200-12-31"') + '</div>' + field(group, 'times_text', 'Times (optional, 24-hour format)', 'text', ' maxlength="64" placeholder="07:30, 18:00"') + '<p class="dog-help">Leave blank for any time. You can enter up to eight times separated by commas.</p>';
        if (value.category === 'medication') html += textarea(group, 'dose_text', 'Medication and dose / directions as prescribed', 500) + '<p class="dog-help">Copy the directions from the medication label or your veterinarian. The app records your schedule and does not calculate a dose.</p>';
        html += textarea(group, 'notes', 'Task notes (optional)', 4000) + checkbox(group, 'active', 'Include this task in the checklist');
      }
      if (group === 'note') html += '<div class="dog-form-grid">' + field(group, 'occurred_on', 'Date', 'date', ' required min="1900-01-01" max="' + today + '"') + select(group, 'kind', 'What are you recording?', [['behavior', 'Behavior / observation'], ['training', 'Training']]) + field(group, 'minutes', 'Minutes (optional)', 'number', ' min="0" max="1440" step="any" inputmode="decimal"') + '</div>' + textarea(group, 'notes', 'What happened?', 4000);
      if (group === 'supply') {
        const products = (current.products || []).filter(row => row.category === 'household' && (!row.archived || row.id === value.product_id));
        html += '<p class="dog-help">Pet supplies stay separate from people’s food inventory. A new supply also gets a matching Household product in your catalog.</p>' + select(group, 'product_id', 'Catalog product', [['', 'Create a matching pet product'], ...products.map(row => [row.id, row.name])]) + '<div class="dog-form-grid">' + field(group, 'name', 'Supply name', 'text', ' required maxlength="160"') + field(group, 'unit_label', 'Stock unit / package', 'text', ' required maxlength="60" placeholder="bag, roll, box…"') + field(group, 'stock_quantity', 'Quantity at home', 'number', ' required min="0" max="1000000000" step="any" inputmode="decimal"') + field(group, 'refill_threshold', 'Flag a refill at or below', 'number', ' required min="0" max="1000000000" step="any" inputmode="decimal"') + field(group, 'reference_price', 'Reference price per unit (optional)', 'text', ' inputmode="decimal" placeholder="Unknown"') + '</div>' + checkbox(group, 'needs_refill', 'I want to mark this as needing a refill') + textarea(group, 'notes', 'Supply notes (optional)', 4000) + '<p class="dog-help">Updating stock is a quantity correction, not a purchase. Use Record purchase for actual spending.</p>';
      }
      if (group === 'purchase') {
        const supply = (current.dogSupplies || []).find(row => row.id === value.supply_id);
        html += '<p class="dog-help"><strong>' + esc(value.name) + '</strong>. Saving records one shopping trip and updates Dog stock, Grocery’s Household spending, budget history and the Money ledger together.</p>' + (supply && supply.reference_price_cents != null ? '<p class="dog-help">Reference: ' + M.money(supply.reference_price_cents) + ' per ' + esc(value.unit_label) + '. Enter what you actually paid below.</p>' : '') + '<div class="dog-form-grid">' + field(group, 'purchased_on', 'Purchase date', 'date', ' required min="1900-01-01" max="' + today + '"') + field(group, 'store', 'Store (optional)', 'text', ' maxlength="160"') + field(group, 'packs', 'Number of ' + esc(value.unit_label || 'packages') + ' purchased', 'number', ' required min="0.000001" max="1000000000" step="any" inputmode="decimal"') + field(group, 'amount', 'Actual total paid for this item', 'text', ' required inputmode="decimal" placeholder="0.00"') + select(group, 'payer_slot', 'Who paid? (optional)', [['', 'Not recorded'], ['1', 'Person 1'], ['2', 'Person 2']]) + '</div>' + textarea(group, 'notes', 'Purchase notes (optional)', 4000) + '<p class="dog-help">Include any tax or discount in the actual line total. A reference price is not automatically charged.</p>';
      }
      if (problem) html += '<p class="dog-notice">' + esc(problem) + '</p><div class="dog-actions">' + button('reload-form', group === 'purchase' ? 'Reload purchase details' : 'Load saved version', ' data-group="' + group + '"', false, Boolean(attempt)) + '</div>';
      return html + formEnd(group, group === 'purchase' ? 'Save purchase & update records' : group === 'task' ? 'Save routine' : 'Save ' + (group === 'profile' ? 'profile' : group === 'note' ? 'note' : group === 'supply' ? 'supply' : 'weight'), current.offline);
    }
    function renderPending() {
      if (!attempt) return '';
      return '<section class="panel dog-notice" role="status"><h3>Confirming your saved change</h3><p>The last request has not been confirmed on this device. Its exact details are kept so a retry cannot create a second purchase or completion.</p><div class="dog-actions">' + button('retry', 'Retry the same request', '', true, (store.snapshot() || {}).offline) + button('check-result', 'Check saved result', '', false, (store.snapshot() || {}).offline) + '</div></section>';
    }
    function render(value) {
      const current = snapshot();
      if (value === 'dog' || value === 'housework') page = value;
      if (!current.user || !current.household || current.status !== 'ready') return '<section class="panel dog-page"><h2>' + (page === 'dog' ? 'Dog care' : 'Housework') + '</h2><p>Connect your household to keep care plans, purchases and who did what together.</p>' + button('grocery', 'Open household setup', ' data-tab="household"', true) + '</section>';
      const activeTab = page === 'dog' ? tab : houseworkTab;
      const tabs = page === 'dog' ? [['today', '🐾', 'Today'], ['plan', '🌿', 'Care plan'], ['supplies', '🧺', 'Supplies'], ['notes', '📝', 'Notes'], ['history', '🗓️', 'History']] : [['today', '🏡', 'Today'], ['plan', '🌿', 'Routines'], ['history', '🗓️', 'History']];
      let html = '<div class="dog-page' + (page === 'housework' ? ' dog-housework' : '') + '">' + (page === 'dog' ? renderProfile(current) : '<section class="panel dog-housework-intro"><p class="page-kicker">A home you care for together</p><h2>Housework</h2><p class="dog-help">Household chores and Dog care share one completion history for Person 1 and Person 2.</p><div class="housework-category-strip">'+M.HOUSEWORK_CATEGORIES.map(row=>'<span><b aria-hidden="true">'+row[2]+'</b>'+esc(row[1])+'</span>').join('')+'</div></section>');
      html += '<div class="dog-toolbar">' + datePicker() + '<div class="dog-actions">' + button('today', 'Today') + (page === 'dog' ? button('housework', 'Housework ↗') : button('dog-page', 'Dog care ↗')) + '</div></div><nav class="dog-tabs" aria-label="' + (page === 'dog' ? 'Dog' : 'Housework') + ' sections">' + tabs.map(([id, icon, label]) => '<button type="button" data-dog-action="tab" data-tab="' + id + '"' + (activeTab === id ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + icon + '</span> ' + label + '</button>').join('') + '</nav>';
      if (current.offline) html += '<p class="dog-notice">Showing the last saved household copy. Drafts stay on this device until you reconnect.</p>';
      if (busy) html += '<p class="dog-status" role="status">' + esc(busy) + '</p>';
      html += renderPending() + renderForm(current);
      if (GROUPS.some(group => dirty(group) && group !== opened)) html += '<section class="panel dog-resume"><p>You have a saved care draft.</p><div class="dog-actions">' + GROUPS.filter(group => dirty(group) && group !== opened).map(group => button('resume-form', 'Resume ' + (group === 'task' ? 'routine' : group) + ' draft', ' data-group="' + group + '"')).join('') + '</div></section>';
      html += activeTab === 'plan' ? renderPlan(current) : activeTab === 'supplies' ? renderSupplies(current) : activeTab === 'notes' ? renderNotes(current) : activeTab === 'history' ? renderHistory(current) : renderToday(current);
      return html + '</div>';
    }

    function openForm(group, row, template) {
      if (!GROUPS.includes(group)) throw new Error('Choose a care form first.');
      if (attempt) throw new Error('Confirm the pending change before starting another save.');
      if (dirty(group) && row && drafts[group].id === row.id) { opened = group; persist(); refresh('#dog-editor'); return true; }
      if (dirty(group) && !confirm('Replace your current ' + group + ' draft? Saved records will stay unchanged.')) return false;
      let value = editable(group, row, selectedDate);
      if (group === 'task' && !row) value.domain = page === 'housework' ? 'housework' : 'dog';
      if (template) value = { ...value, ...copy(template), times_text: (template.times || []).join(', ') };
      delete value.key; delete value.times;
      reset(group, value); opened = group; problem = ''; persist(); refresh('#dog-editor'); return true;
    }
    function openPurchase(current, supply) {
      if (!supply || supply.archived === true || !supply.product_id) throw new Error('Save the dog supply and its catalog product before recording a purchase.');
      if (attempt) throw new Error('Confirm the pending change before starting another purchase.');
      if (dirty('purchase') && drafts.purchase.supply_id === supply.id) { opened = 'purchase'; persist(); refresh('#dog-editor'); return true; }
      if (dirty('purchase') && !confirm('Replace your current dog purchase draft? Saved purchases will stay recorded.')) return false;
      const item = pendingItem(current, supply, selectedDate.slice(0, 7));
      const value = { ...blank('purchase', selectedDate), supply_id: supply.id, product_id: supply.product_id, name: supply.name, unit_label: supply.unit_label || 'package',
        packs: item && Number(item.packs) > 0 ? String(item.packs) : '1', shopping_item_id: item && item.id || null, shopping_revision: item && item.revision || null };
      reset('purchase', value); opened = 'purchase'; problem = ''; persist(); refresh('#dog-editor'); return true;
    }
    function metadata(value) {
      const result = { id: value.id || value.request_id, request_id: value.request_id };
      if (value.id) {
        if (!Number.isSafeInteger(Number(value.revision)) || Number(value.revision) < 1) throw new Error('Load the saved version before editing this record.');
        result.revision = Number(value.revision);
      }
      return result;
    }
    function payload(group, current) {
      const value = drafts[group], today = M.dayKey(getNow()), meta = metadata(value);
      if (group === 'profile') return { ...meta, name: text(value.name, 'Dog’s name', 160, true), breed: text(value.breed, 'Breed', 160, false), birth_on: date(value.birth_on, 'Date of birth', true, today), notes: text(value.notes, 'Profile notes', 4000, false) };
      if (group === 'weight') {
        if (!['lb', 'kg'].includes(value.weight_unit)) throw new Error('Choose pounds or kilograms.');
        let amount = numeric(value.weight, 'Weight', 0.000001, value.weight_unit === 'lb' ? 661.3867865 : 300, false);
        if (value.weight_unit === 'lb') amount *= 0.45359237;
        if (amount < 0.001 || amount > 300) throw new Error('Weight must be from 0.001 to 300 kg (or the equivalent in pounds).');
        return { ...meta, occurred_on: date(value.occurred_on, 'Measurement date', false, today), weight_kg: Number(amount.toPrecision(13)), notes: text(value.notes, 'Weight notes', 4000, false) };
      }
      if (group === 'task') {
        const categories=value.domain==='housework'?M.HOUSEWORK_CATEGORIES:M.CATEGORIES;
        if (!['dog', 'housework'].includes(value.domain) || !categories.some(row => row[0] === value.category) || !['daily', 'interval', 'monthly', 'once'].includes(value.frequency)) throw new Error('Choose a valid task area, category and repeat schedule.');
        const anchor = date(value.anchor_on, 'First care date'), end = date(value.end_on, 'End date', true);
        if (end && end < anchor) throw new Error('The end date must be on or after the first care date.');
        return { ...meta, domain: value.domain, name: text(value.name, 'Task name', 160, true), category: value.category, frequency: value.frequency,
          interval_days: integer(value.interval_days, 'Days between care', 1, 3650), interval_months: integer(value.interval_months, 'Months between care', 1, 120),
          anchor_on: anchor, end_on: end, times: times(value.times_text), rolling: value.rolling === true, active: value.active === true,
          dose_text: text(value.dose_text, 'Medication and prescribed directions', 500, value.category === 'medication'), notes: text(value.notes, 'Task notes', 4000, false) };
      }
      if (group === 'note') {
        if (!['behavior', 'training'].includes(value.kind)) throw new Error('Choose behavior or training for this note.');
        return { ...meta, occurred_on: date(value.occurred_on, 'Note date', false, today), kind: value.kind, minutes: numeric(value.minutes, 'Minutes', 0, 1440, true), notes: text(value.notes, 'What happened', 4000, true) };
      }
      if (group === 'supply') {
        if (value.product_id && !(current.products || []).some(row => row.id === value.product_id && row.category === 'household')) throw new Error('Choose a Household catalog product for this dog supply, or create its matching pet product.');
        return { ...meta, product_id: value.product_id || null, name: text(value.name, 'Supply name', 160, true), unit_label: text(value.unit_label, 'Stock unit', 60, true),
          stock_quantity: numeric(value.stock_quantity, 'Quantity at home', 0, 1000000000, false), refill_threshold: numeric(value.refill_threshold, 'Refill threshold', 0, 1000000000, false),
          needs_refill: value.needs_refill === true, reference_price_cents: cents(value.reference_price, 'Reference price', true), notes: text(value.notes, 'Supply notes', 4000, false) };
      }
      const supply = (current.dogSupplies || []).find(row => row.id === value.supply_id && row.archived !== true);
      if (!supply || !value.product_id || supply.product_id !== value.product_id) throw new Error('The supply’s catalog link changed. Reload the purchase details before saving.');
      const payer = value.payer_slot === '' || value.payer_slot == null ? null : Number(value.payer_slot);
      if (payer != null && ![1, 2].includes(payer)) throw new Error('Choose Person 1 or Person 2, or leave the payer blank.');
      if (value.shopping_item_id && (!Number.isSafeInteger(Number(value.shopping_revision)) || Number(value.shopping_revision) < 1)) throw new Error('Reload the linked grocery item before recording its purchase.');
      return { id: value.request_id, purchased_on: date(value.purchased_on, 'Purchase date', false, today), store: text(value.store, 'Store', 160, false), payer_slot: payer, notes: text(value.notes, 'Purchase notes', 4000, false),
        items: [{ product_id: value.product_id, name: text(value.name, 'Item name', 160, true), category: 'household', packs: numeric(value.packs, 'Packages purchased', 0.000001, 1000000000, false), line_total_cents: cents(value.amount, 'Actual total paid', false), ...(value.shopping_item_id ? { shopping_item_id: value.shopping_item_id, shopping_revision: Number(value.shopping_revision) } : {}) }] };
    }
    function finishAttempt(savedAttempt) {
      attempt = null; problem = '';
      if (savedAttempt.group && GROUPS.includes(savedAttempt.group)) {
        reset(savedAttempt.group, blank(savedAttempt.group, selectedDate, page === 'housework' ? 'housework' : 'dog'));
        if (opened === savedAttempt.group) opened = '';
      }
      if (savedAttempt.targetTab && page === 'dog') tab = savedAttempt.targetTab;
      notify(savedAttempt.notice || 'Your care record was saved for the household.');
    }
    function submitAttempt() {
      if (!attempt) throw new Error('Choose a change to save first.');
      const value = copy(attempt), current = snapshot(); ready(current);
      if (typeof store[value.method] !== 'function') throw new Error('Refresh the app to load the connected care tools.');
      return run(value.label || 'Saving your care record…', () => store[value.method](...copy(value.args)), result => {
        if (value.method === 'recordReceipt') {
          const receipt = (snapshot().receipts || []).find(row => row.id === value.args[0].id);
          if (receipt && receipt.voided_at || result && result.voided_at) {
            attempt = null; problem = 'This purchase was reversed. Reload purchase details before recording a corrected purchase.';
            notify(problem, true); return;
          }
        }
        finishAttempt(value);
      }, error => {
        if (REJECTIONS.has(String(error && error.code))) {
          attempt = null;
          problem = ['40001', '23505', '23514', '23503'].includes(String(error.code)) ? 'A saved detail changed or needs review. Reload the saved version before trying this change again.' : '';
        }
      }, '#dog-editor');
    }
    function beginAttempt(value) {
      if (attempt) throw new Error('Confirm the pending change before saving another one.');
      attempt = copy(value); problem = ''; persist(); return submitAttempt();
    }
    function checkResult() {
      if (!attempt || typeof store.refresh !== 'function') throw new Error('Retry the saved request to confirm its result.');
      const value = copy(attempt); ready(snapshot());
      return run('Checking the saved result…', () => store.refresh(), () => {
        const current = snapshot();
        if (current.offline) throw new Error('The saved result could not be checked while offline. Your exact request is still kept.');
        if (value.method === 'recordReceipt') {
          const receipt = (current.receipts || []).find(row => row.id === value.args[0].id);
          if (receipt && !receipt.voided_at) { finishAttempt(value); return; }
          if (receipt && receipt.voided_at) {
            attempt = null; problem = 'This purchase was reversed. Reload purchase details before recording a corrected purchase.';
            notify(problem, true); return;
          }
        } else if (value.list) {
          const row = (current[value.list] || []).find(item => item.id === value.rowId);
          if (row && row.last_request_id === value.requestId && (value.method !== 'archiveLifeRecord' || row.archived === true)) { finishAttempt(value); return; }
        }
        notify('This request is not confirmed on this device yet. Use Retry the same request; its exact details are still kept.', true);
      }, null, '#dog-editor');
    }
    function saveCompletion(current, task, slot, done, oldLog) {
      ready(current);
      if (attempt) throw new Error('Confirm the pending change before checking another task.');
      if (!task || (task.archived === true || task.active === false) && !(oldLog && done === false)) throw new Error('This routine is no longer active. Refresh the care list.');
      const on = oldLog && done === false ? oldLog.occurred_on : selectedDate;
      date(on, 'Completion date', false, M.dayKey(getNow()));
      if (!M.slots(task).includes(slot) && !oldLog) throw new Error('This time is no longer in the saved routine. Refresh the care list.');
      const requestId = uuid();
      const value = { id: oldLog && oldLog.id || requestId, request_id: requestId, ...(oldLog ? { revision: oldLog.revision } : {}), task_id: task.id, occurred_on: on, slot,
        person_slot: done === false && oldLog ? oldLog.person_slot : Number(person), done: Boolean(done), notes: oldLog && oldLog.notes || '' };
      return beginAttempt({ method: 'saveRoutineLog', args: [value], group: null, list: 'routineLogs', rowId: value.id, requestId,
        label: done ? 'Saving this completed task…' : 'Saving the undone check…', notice: done ? 'Saved. Person ' + value.person_slot + ' completed ' + task.name + '. Dog care and Housework use this same record.' : 'The completion was undone. The correction stays in history.' });
    }
    function handleSubmit(event) {
      const form = event && event.target, group = form && form.dataset && form.dataset.dogForm;
      if (!GROUPS.includes(group)) return false;
      if (event.preventDefault) event.preventDefault();
      const current = snapshot();
      if (busy) return true;
      try {
        ready(current);
        if (attempt) { if (attempt.group === group) submitAttempt(); else throw new Error('Confirm the pending change first.'); return true; }
        if (form.elements && typeof form.elements.namedItem === 'function') for (const key of Object.keys(drafts[group])) {
          if (['id', 'request_id', 'revision', 'shopping_item_id', 'shopping_revision', 'supply_id', 'product_id'].includes(key) && !(group === 'supply' && key === 'product_id')) continue;
          const field = form.elements.namedItem(key);
          if (field) drafts[group][key] = ['rolling', 'active', 'needs_refill'].includes(key) ? field.checked === true : String(field.value == null ? '' : field.value);
        }
        persist();
        const value = payload(group, current), method = group === 'purchase' ? 'recordReceipt' : METHODS[group];
        beginAttempt({ method, args: [value], group, list: LISTS[group] || null, rowId: value.id, requestId: value.request_id || value.id,
          targetTab: group === 'supply' || group === 'purchase' ? 'supplies' : group === 'task' ? 'plan' : group === 'note' ? 'notes' : undefined,
          label: group === 'purchase' ? 'Saving the purchase and connected records…' : 'Saving your ' + (group === 'task' ? 'routine' : group) + '…',
          notice: group === 'purchase' ? 'Purchase saved. Dog stock, the shopping trip, Household grocery spending, Money and budget history are updated.' : group === 'task' ? 'Your routine was saved. Dog care and Housework share the same checklist and completion history.' : group === 'supply' ? 'The supply was saved. Its quantity is stock on hand; no purchase or expense was created.' : 'Your ' + group + ' was saved for the household.' });
      } catch (error) { persist(); notify(error.message || 'Review this form before saving.', true); refresh('#dog-editor'); }
      return true;
    }
    function handleInput(event) {
      const element = event && event.target, data = element && element.dataset || {};
      if (data.dogComplete) {
        if (event.type === 'input') return true;
        const current = snapshot();
        if (busy || attempt) return true;
        try {
          const task = (current.routineTasks || []).find(row => row.id === data.dogComplete), slot = String(data.dogSlot || '');
          const row = M.taskOccurrences(task, current.routineLogs, selectedDate).find(item => item.slot === slot);
          if (!row) throw new Error('This task is no longer due on the selected day. Refresh the care list.');
          saveCompletion(current, task, slot, element.checked === true, row.log);
        } catch (error) { notify(error.message, true); refresh(); }
        return true;
      }
      if (data.dogControl) {
        snapshot(); if (busy) return true;
        if (data.dogControl === 'date' && M.dateNumber(element.value) != null) selectedDate = element.value;
        else if (data.dogControl === 'show-dog') showDog = element.checked === true;
        else if (data.dogControl === 'refill-only') refillOnly = element.checked === true;
        else return ['date', 'show-dog', 'refill-only'].includes(data.dogControl);
        persist(); refresh(); return true;
      }
      if (!data.dogField) return false;
      const [group, name, extra] = data.dogField.split('.');
      if (extra || !GROUPS.includes(group) || !Object.hasOwn(drafts[group], name) || ['id', 'request_id', 'revision', 'shopping_item_id', 'shopping_revision', 'supply_id'].includes(name) || group === 'purchase' && name === 'product_id') return false;
      const current = snapshot();
      if (busy || attempt) return true;
      drafts[group][name] = ['rolling', 'active', 'needs_refill'].includes(name) ? element.checked === true : String(element.value == null ? '' : element.value);
      if (group === 'supply' && name === 'product_id' && drafts.supply.product_id) {
        const product = (current.products || []).find(row => row.id === drafts.supply.product_id && row.category === 'household');
        if (product) { if (!drafts.supply.name.trim()) drafts.supply.name = product.name; if (!String(drafts.supply.reference_price).trim() && product.price_cents != null) drafts.supply.reference_price = (product.price_cents / 100).toFixed(2); }
      }
      persist();
      if (group === 'task' && ['frequency', 'category'].includes(name) || group === 'supply' && name === 'product_id') refresh('#dog-' + group + '-' + name);
      return true;
    }
    function handleChange(event) { return handleInput({ ...event, type: 'change', target: event.target }); }
    function downloadCalendar(occurrence) {
      const content = M.calendarForOccurrence(occurrence, getNow()), name = 'life-in-bloom-care-' + occurrence.on + '.ics';
      if (typeof options.download === 'function') { options.download(name, content, 'text/calendar;charset=utf-8'); return; }
      if (!root.document || !root.URL || typeof root.URL.createObjectURL !== 'function') throw new Error('Calendar downloads are not available in this browser.');
      const url = root.URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
      const link = root.document.createElement('a'); link.href = url; link.download = name; root.document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function handleClick(event) {
      const element = event && event.target && event.target.closest && event.target.closest('[data-dog-action]');
      if (!element || !element.dataset) return false;
      const data = element.dataset, action = data.dogAction;
      const allowed = ['tab', 'today', 'person', 'grocery', 'dog-page', 'housework', 'edit-profile', 'new-weight', 'edit-weight', 'new-task', 'task-template', 'edit-task', 'new-note', 'edit-note', 'new-supply', 'edit-supply', 'purchase-supply', 'add-supply-shopping', 'archive-record', 'undo-log', 'care-calendar', 'open-receipt', 'close-form', 'resume-form', 'discard-form', 'reload-form', 'retry', 'check-result'];
      if (!allowed.includes(action)) return false;
      if (event.preventDefault) event.preventDefault();
      const current = snapshot();
      if (busy) return true;
      try {
        if (action === 'grocery') { openGrocery(data.tab || 'list', data.month || undefined); return true; }
        if (action === 'dog-page' || action === 'housework') { navigate(action === 'dog-page' ? 'dog' : 'housework'); return true; }
        if (action === 'tab') {
          const allowedTabs = page === 'dog' ? ['today', 'plan', 'supplies', 'notes', 'history'] : ['today', 'plan', 'history'];
          if (allowedTabs.includes(data.tab)) { if (page === 'dog') tab = data.tab; else houseworkTab = data.tab; }
        } else if (action === 'today') selectedDate = M.dayKey(getNow());
        else if (action === 'person') { if (!attempt && ['1', '2'].includes(data.person)) person = data.person; }
        else if (action === 'edit-profile') { openForm('profile', M.usable(current.dogProfiles)[0]); return true; }
        else if (action === 'new-weight') { openForm('weight'); return true; }
        else if (action === 'new-task') { openForm('task'); return true; }
        else if (action === 'new-note') { openForm('note'); return true; }
        else if (action === 'new-supply') { openForm('supply'); return true; }
        else if (action === 'task-template') {
          const template = M.TEMPLATES.find(row => row.key === data.template);
          if (!template) throw new Error('Choose a care starter from the list.');
          openForm('task', null, { ...template, domain: 'dog' }); return true;
        } else if (['edit-weight', 'edit-task', 'edit-note', 'edit-supply'].includes(action)) {
          const group = action.slice(5), row = (current[LISTS[group]] || []).find(item => item.id === data.id && item.archived !== true);
          if (!row) throw new Error('Refresh to find that saved record.');
          openForm(group, row); return true;
        } else if (action === 'close-form') opened = '';
        else if (action === 'resume-form') { if (GROUPS.includes(data.group)) opened = data.group; }
        else if (action === 'discard-form') {
          if (!GROUPS.includes(data.group)) throw new Error('Choose a draft to discard.');
          if (attempt) throw new Error('Confirm the pending change before discarding its draft.');
          if (dirty(data.group) && !confirm('Discard this draft? Saved records will stay unchanged.')) return true;
          reset(data.group, blank(data.group, selectedDate, page === 'housework' ? 'housework' : 'dog')); if (opened === data.group) opened = ''; problem = '';
        } else if (action === 'reload-form') {
          if (attempt) throw new Error('Confirm the pending request before loading another version.');
          if (!GROUPS.includes(data.group)) throw new Error('Choose a saved record to reload.');
          if (dirty(data.group) && !confirm('Reload the saved details? This form’s current edits will be replaced.')) return true;
          const group = data.group, id = drafts[group].id, supplyId = drafts.purchase.supply_id;
          ready(current);
          if (typeof store.refresh !== 'function') throw new Error('Refresh your browser to reload saved details.');
          run('Loading saved details…', () => store.refresh(), () => {
            const fresh = snapshot();
            if (fresh.offline) throw new Error('Reconnect before loading a fresh saved version.');
            if (group === 'purchase') {
              const supply = M.usable(fresh.dogSupplies).find(row => row.id === supplyId);
              if (!supply) throw new Error('This supply is no longer available. Your draft is still kept.');
              const item = pendingItem(fresh, supply, selectedDate.slice(0, 7));
              reset('purchase', { ...blank('purchase', selectedDate), supply_id: supply.id, product_id: supply.product_id, name: supply.name, unit_label: supply.unit_label || 'package', packs: item && Number(item.packs) > 0 ? String(item.packs) : '1', shopping_item_id: item && item.id || null, shopping_revision: item && item.revision || null });
            } else {
              const row = (fresh[LISTS[group]] || []).find(item => item.id === id && item.archived !== true);
              if (!row) throw new Error('The saved record is no longer available. Your draft is still kept.');
              reset(group, editable(group, row, selectedDate));
            }
            problem = ''; opened = group;
          }, null, '#dog-editor'); return true;
        } else if (action === 'retry') { submitAttempt(); return true; }
        else if (action === 'check-result') { checkResult(); return true; }
        else if (action === 'purchase-supply') { openPurchase(current, (current.dogSupplies || []).find(row => row.id === data.id)); return true; }
        else if (action === 'add-supply-shopping') {
          ready(current);
          const supply = M.usable(current.dogSupplies).find(row => row.id === data.id);
          if (!supply || !supply.product_id) throw new Error('Save this supply’s catalog product before adding it to the grocery list.');
          const month = selectedDate.slice(0, 7) + '-01';
          if (pendingItem(current, supply, month)) { openGrocery('list', month.slice(0, 7)); return true; }
          const requestId = uuid();
          beginAttempt({ method: 'addDogSupplyToShopping', args: [supply, { request_id: requestId, month, packs: 1 }], group: null, requestId, targetTab: 'supplies', label: 'Adding the dog supply to Grocery…', notice: 'One ' + supply.unit_label + ' of ' + supply.name + ' was added to the grocery list. You can change its quantity there; no spending was recorded.' }); return true;
        } else if (action === 'archive-record') {
          ready(current);
          if (attempt) throw new Error('Confirm the pending change first.');
          const group = data.group;
          if (!['task', 'weight', 'note', 'supply'].includes(group)) throw new Error('Choose a saved record to archive.');
          const row = (current[LISTS[group]] || []).find(item => item.id === data.id && item.archived !== true);
          if (!row) throw new Error('Refresh to find this saved record.');
          if (dirty(group) && drafts[group].id === row.id) throw new Error('Save or discard this record’s draft before archiving it.');
          if (!confirm('Archive this ' + (group === 'task' ? 'routine' : group) + '? Existing completion and purchase history will stay saved.')) return true;
          const requestId = uuid();
          beginAttempt({ method: 'archiveLifeRecord', args: [row, requestId], group: null, list: LISTS[group], rowId: row.id, requestId, label: 'Archiving the record…', notice: 'The record was archived. Its saved history remains.' }); return true;
        } else if (action === 'undo-log') {
          const log = M.usable(current.routineLogs).find(row => row.id === data.id && row.done === true);
          if (!log) throw new Error('Refresh to find this completion.');
          if (!confirm('Undo this completed check? The correction will remain in history.')) return true;
          const task = (current.routineTasks || []).find(row => row.id === log.task_id) || { ...M.snapshotBody(log), id: log.task_id };
          saveCompletion(current, task, String(log.slot || ''), false, log); return true;
        } else if (action === 'care-calendar') {
          const task = (current.routineTasks || []).find(row => row.id === data.id);
          if (!task) throw new Error('Refresh to find this saved routine.');
          downloadCalendar({ id: task.id, title: task.name, on: data.date || selectedDate, time: String(data.dogSlot || ''), notes: [task.dose_text, task.notes].filter(Boolean).join('\n') });
          notify('Calendar reminder downloaded. Open the file to add it to your calendar.');
        } else if (action === 'open-receipt') {
          if (typeof options.openReceipt === 'function') options.openReceipt(data.id);
          else openGrocery('receipts', data.month || undefined);
          return true;
        }
        persist(); refresh();
      } catch (error) { notify(error.message || 'This action could not be completed.', true); }
      return true;
    }
    function discardDraft() {
      snapshot();
      if (busy || attempt) return false;
      for (const group of GROUPS) reset(group, blank(group, selectedDate, page === 'housework' ? 'housework' : 'dog'));
      opened = ''; problem = ''; persist(); return true;
    }
    function selectTab(value) {
      snapshot();
      if (busy || !['today', 'plan', 'supplies', 'notes', 'history'].includes(value)) return false;
      tab = value; if (['today', 'plan', 'history'].includes(value)) houseworkTab = value; persist(); refresh(); return true;
    }
    return { render, handleClick, handleSubmit, handleInput, handleChange, selectTab, discardDraft,
      hasUnsavedDraft() { snapshot(); return Boolean(busy || attempt || anyDirty()); },
      hasUnpersistedChanges() { snapshot(); return Boolean((attempt || anyDirty()) && !draftSaved); },
      isBusy: () => Boolean(busy), whenIdle: () => pending,
      getHomeSummary(on) { const current = snapshot(); return M.summary(current, M.dateNumber(on) == null ? M.dayKey(getNow()) : on); } };
  }
  const api = { createController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomDog = api;
})(typeof window !== 'undefined' ? window : globalThis);
