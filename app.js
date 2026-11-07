/* Life in Bloom — personal device journals and a shared household Grocery space. */
'use strict';
(() => {
  const D = window.BloomData;
  const I = window.BloomInsights;
  const A = window.BloomAppointments;
  const P = window.BloomPages;
  const G = window.BloomGrocery;
  const GS = window.BloomGroceryStore;
  const C = window.BloomCommerce;
  const F = window.BloomFood;
  const H = window.BloomHabits;
  const Dog = window.BloomDog;
  const W = window.BloomWellness;
  const Personal = window.BloomPersonal;
  const $ = selector => document.querySelector(selector);
  const content = $('#content');
  const noticeEl = $('#notice');
  if (!D || !I || !A || !P || !G || !GS || !Personal) {
    noticeEl.hidden = false;
    noticeEl.textContent = 'The app could not finish loading. Please refresh this page.';
    return;
  }

  const COLORS = [
    { label: '<4 hrs', color: '#d8e8f5' },
    { label: '4–5 hrs', color: '#c0d4ed' },
    { label: '5–6 hrs', color: '#cbb9e8' },
    { label: '6–7 hrs', color: '#e4bfe9' },
    { label: '7–8 hrs', color: '#dda1d3' },
    { label: '8–9 hrs', color: '#a98ad1' },
    { label: '9+ hrs', color: '#745796' }
  ];
  const STATUS_LABELS = { sleep: 'Asleep', rest: 'Unsure', awake: 'Awake', empty: 'Not recorded', erase: 'Erase' };
  const dateKey = D.dateKey;
  const parseDate = D.parseDate;
  const shiftDate = D.shiftDate;
  const clockLabel = D.clockLabel;
  let storage;
  let deviceStorage;
  let personalManager;
  let personalState;
  let loaded;
  try {
    deviceStorage = window.localStorage;
    personalManager = Personal.createManager(deviceStorage);
    personalState = personalManager.open(null);
    storage = personalState.storage || deviceStorage;
    loaded = personalState.loaded || { data: D.normalizeData({ records: {} }), readOnly: true, warning: '' };
  } catch (_) {
    personalState = { mode: 'locked', message: 'This browser could not open its personal journal settings.' };
    loaded = {
      data: D.normalizeData({ records: {} }),
      readOnly: true,
      warning: 'This browser could not open your saved entries. Your stored copy has not been changed. Please ask for help before adding new entries.'
    };
  }
  const initialDate = trackingToday();
  const initialParsed = parseDate(initialDate);
  const state = {
    data: loaded.data,
    readOnly: loaded.readOnly,
    unsaved: Boolean(loaded.warning) && !loaded.readOnly,
    year: initialParsed.getFullYear(),
    month: initialParsed.getMonth(),
    date: initialDate,
    week: D.weekStart(initialDate),
    page: 'home',
    view: 'circle',
    mode: 'sleep',
    activityId: '',
    rangeStart: 0,
    rangeEnd: 1,
    moodTarget: null
  };
  let cloud = null;
  let grocery = null;
  let commerce = null;
  let food = null;
  let habits = null;
  let dog = null;
  let wellness = null;
  const connectedControllers = () => [grocery, commerce, food, habits, dog, wellness].filter(Boolean);
  const anySaving = () => connectedControllers().some(controller => controller.isBusy());
  const draftStore = window.BloomDrafts ? window.BloomDrafts.create() : null;
  let activeAccountIdentity;
  const unsavedJournals = new Map();
  const PAGE_DETAILS = {
    home: ['Welcome to Life in Bloom.', 'A little space for your days, your plans, and how you feel.'],
    'sleep-mood': ['Sleep & Mood', 'Your rest, your feelings, and your plans, together.'],
    wellness: ['Wellness', 'Your space for nutrition and everyday care.'],
    grocery: ['Food · Grocery', 'Your shopping list and reusable product library.'],
    money: ['Money in Bloom', 'A home for where your money goes.'],
    food: ['Food in Bloom', 'Your space for food, recipes, and what you have at home.'],
    skills: ['Skills in Bloom', 'A place for the things you are learning.'],
    ideas: ['Idea’s in Bloom', 'Save a thought now and come back to it later.'],
    housework: ['Housework', 'Your space for caring for your home.'],
    dog: ['Dog', 'A home for your dog’s care and routines.'],
    smoking: ['Smoking Log', 'Your space for recording your own patterns.']
  };

  function escapeText(value) {
    return String(value).replace(/[&<>\"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[character]);
  }
  function trackingToday() {
    const now = new Date();
    if (now.getHours() < 8) now.setDate(now.getDate() - 1);
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }
  function dayCount(year, month) { return new Date(year, month + 1, 0).getDate(); }
  function dateLong(key) { return parseDate(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  function dateMedium(key) { return parseDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function monthLabel() { return new Date(state.year, state.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
  function recordFor(key) { return state.data.records[key] || D.blankRecord(); }
  function activityFor(id) { return state.data.activities.find(activity => activity.id === id); }
  function slotValues(key) { return Object.values(recordFor(key).slots); }
  function hasSleepTotal(key) { return D.hasSleepTotal(recordFor(key)); }
  function sleepHours(key) { return slotValues(key).filter(status => status === 'sleep').length / 2; }
  function restHours(key) { return slotValues(key).filter(status => status === 'rest').length / 2; }
  function awakeHours(key) { return slotValues(key).filter(status => status === 'awake').length / 2; }
  function sleepEpisodes(key) {
    let episodes = 0;
    let longest = 0;
    let run = 0;
    const slots = recordFor(key).slots;
    for (let index = 0; index < 48; index++) {
      if (slots[index] === 'sleep') {
        if (!run) episodes++;
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    return { episodes, longest: longest / 2 };
  }
  function colorFor(hours) {
    if (hours < 4) return COLORS[0].color;
    if (hours < 5) return COLORS[1].color;
    if (hours < 6) return COLORS[2].color;
    if (hours < 7) return COLORS[3].color;
    if (hours < 8) return COLORS[4].color;
    if (hours < 9) return COLORS[5].color;
    return COLORS[6].color;
  }
  function moodColor(feeling) {
    return D.MOOD_OPTIONS.find(option => option.label.toLocaleLowerCase() === feeling.toLocaleLowerCase())?.color || '#fae1e8';
  }
  function monthKeys() { return Array.from({ length: dayCount(state.year, state.month) }, (_, index) => dateKey(state.year, state.month, index + 1)); }
  function formatHour(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
  function statsForMonth() {
    const keys = monthKeys().filter(hasSleepTotal);
    const total = keys.reduce((sum, key) => sum + sleepHours(key), 0);
    return { keys, total, average: keys.length ? total / keys.length : null };
  }
  function showNotice(message, error = false) {
    noticeEl.textContent = message;
    noticeEl.hidden = false;
    noticeEl.classList.toggle('error', error);
  }
  function updateSaveState() {
    for (const element of document.querySelectorAll('.save-state')) {
      element.textContent = state.readOnly ? 'Saved records are protected from changes' : state.unsaved ? 'Not saved — export a backup before closing' : 'Saved on this device';
    }
  }
  function canEdit() {
    if (!state.readOnly) return true;
    showNotice(loaded.warning || 'Your stored copy has not been changed. Please ask for help before adding entries.', true);
    return false;
  }
  function saveRecords() {
    if (!canEdit()) return false;
    try {
      D.saveData(storage, state.data);
      state.unsaved = false;
      if (personalState.key) unsavedJournals.delete(personalState.key);
      noticeEl.hidden = true;
      updateSaveState();
      return true;
    } catch (_) {
      state.unsaved = true;
      updateSaveState();
      showNotice('This device could not save your latest changes. Export a backup before closing this page.', true);
      return false;
    }
  }
  function changeView(view) {
    if (state.page !== 'sleep-mood' && !leaveDraft()) return false;
    state.page = 'sleep-mood';
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }
  function openDate(key) {
    if (Number.isNaN(parseDate(key).getTime()) || !leaveDraft()) return false;
    state.page = 'sleep-mood';
    state.date = key;
    const date = parseDate(key);
    state.year = date.getFullYear();
    state.month = date.getMonth();
    state.week = D.weekStart(key);
    changeView('day');
    return true;
  }
  function leaveDraft() {
    if (anySaving()) {
      showNotice('Please wait for this change to finish saving.', true);
      return false;
    }
    // Household forms remain in their own account-scoped saved drafts when the
    // person opens another section. A receipt still requires explicit posting.
    if (!pages.hasUnsavedDraft()) return true;
    if (!window.confirm('Leave this page and discard your unsaved text? Choose Cancel to stay and save it first.')) return false;
    pages.discardDraft();
    return true;
  }
  function navigate(page) {
    if (!Object.hasOwn(PAGE_DETAILS, page)) return false;
    if (state.page === page) return true;
    if (!leaveDraft()) return false;
    state.page = page;
    if (page === 'sleep-mood') state.view = 'circle';
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => $(state.page === 'home' && wellness ? '#home-dashboard-heading' : '#page-heading')?.focus({ preventScroll: true }));
    return true;
  }
  function renderKeepScroll(focusSelector) {
    const top = window.scrollY;
    const weekLeft = $('.week-scroll')?.scrollLeft || 0;
    const active = document.activeElement;
    const focusedField = active && content.contains(active) ? active : null;
    const preserveSelection = focusedField && (!focusSelector || content.querySelector(focusSelector) === focusedField) &&
      typeof focusedField.selectionStart === 'number' && typeof focusedField.selectionEnd === 'number';
    const selection = preserveSelection ? {
      id: focusedField.id, start: focusedField.selectionStart, end: focusedField.selectionEnd,
      direction: focusedField.selectionDirection || 'none'
    } : null;
    render();
    if ($('.week-scroll')) $('.week-scroll').scrollLeft = weekLeft;
    const focusTarget = focusSelector ? content.querySelector(focusSelector) : selection && selection.id ? document.getElementById(selection.id) : null;
    // Restore text focus immediately: a later animation frame can miss a fast
    // keystroke or move the caret after the user has focused another control.
    if (focusTarget && content.contains(focusTarget)) {
      focusTarget.focus({ preventScroll: true });
      if (selection && typeof focusTarget.setSelectionRange === 'function') {
        const length = focusTarget.value.length;
        try { focusTarget.setSelectionRange(Math.min(selection.start, length), Math.min(selection.end, length), selection.direction); }
        catch (_) { /* Some non-text input types do not support a selection. */ }
      }
    }
    requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: 'auto' });
    });
  }
  function headerForMonth() {
    return `<div class='month-nav'><div class='nav-group'><button type='button' class='nav-btn' data-action='prev-month' aria-label='Previous month'>‹</button><button type='button' class='nav-btn' data-action='next-month' aria-label='Next month'>›</button></div><h2>${monthLabel()}</h2><button type='button' class='today-btn' data-action='this-month'>This month</button></div>`;
  }
  function switchMonth(delta) {
    const date = new Date(state.year, state.month + delta, 1);
    state.year = date.getFullYear();
    state.month = date.getMonth();
    render();
  }
  function activityChip(activity) {
    return `<span class='activity-chip' style='--activity-color:${activity.color}'><span class='activity-icon' aria-hidden='true'>${escapeText(activity.icon)}</span>${escapeText(activity.name)}</span>`;
  }
  function hourLabel(hour) {
    return `${clockLabel(hour * 2).replace(':00', '')}–${clockLabel(hour * 2 + 2).replace(':00', '')}${hour >= 16 ? ' (next day)' : hour === 15 ? ' (ends next day)' : ''}`;
  }
  function fullHourLabel(key, hour) {
    const actualKey = hour >= 16 ? shiftDate(key, 1) : key;
    const endKey = hour >= 15 ? shiftDate(key, 1) : key;
    return `${dateLong(actualKey)} · ${clockLabel(hour * 2)}–${actualKey !== endKey ? dateMedium(endKey) + ' ' : ''}${clockLabel(hour * 2 + 2)}`;
  }
  function hourStatus(record, hour) {
    const a = record.slots[hour * 2] || 'empty';
    const b = record.slots[hour * 2 + 1] || 'empty';
    if (a === b) return STATUS_LABELS[a];
    return `30m ${STATUS_LABELS[a].toLowerCase()} · 30m ${STATUS_LABELS[b].toLowerCase()}`;
  }
  function hourActivities(record, hour) { return D.awakeActivities(record, hour, state.data.activities); }

  function commitData(candidate, failureMessage) {
    if (!canEdit()) return false;
    try {
      const normalized = D.normalizeData(candidate);
      D.saveData(storage, normalized);
      state.data = normalized;
      state.unsaved = false;
      if (personalState.key) unsavedJournals.delete(personalState.key);
      noticeEl.hidden = true;
      updateSaveState();
      return true;
    } catch (_) {
      showNotice(failureMessage || 'This change could not be saved. Your current entries have not been replaced. Keep this page open and try again.', true);
      return false;
    }
  }
  const pages = P.createController({
    getData: () => state.data,
    getToday: trackingToday,
    getPersonalAvailable: () => personalAvailable(),
    getGrocerySummary: () => grocery ? grocery.getHomeSummary() : null,
    renderDashboard: context => wellness ? wellness.renderHome(context) : null,
    canEdit,
    isReadOnly: () => state.readOnly,
    notify: showNotice,
    refresh: focusSelector => {
      renderKeepScroll(focusSelector);
      if (focusSelector) requestAnimationFrame(() => content.querySelector(focusSelector)?.scrollIntoView({ block: 'nearest', behavior: 'auto' }));
    },
    navigate,
    openDate,
    commitData
  });
  cloud = GS.createStore({ config: window.BloomCloudConfig, onChange: handleCloudChange });
  const sharedOptions = { store:cloud, notify:showNotice, refresh:selector=>renderKeepScroll(selector), navigate,
    confirm:message=>window.confirm(message), draftStore };
  if (C) commerce = C.createController({ ...sharedOptions, updateCatalogResults: result => {
    const count = content.querySelector('#commerce-catalog-count');
    const results = content.querySelector('#commerce-catalog-results');
    if (!count || !results) return;
    // Keep the search and editor nodes intact while filtering. Recreating an
    // active search input can reset its caret and reverse subsequent typing.
    count.textContent = result.summary;
    results.innerHTML = result.html;
  }});
  const openGrocery = (tab, month) => {
    if (month && grocery && grocery.openShoppingMonth && !grocery.openShoppingMonth(month)) return false;
    if (navigate('grocery')) { if (grocery && grocery.selectTab) grocery.selectTab(tab); renderKeepScroll(); return true; }
    return false;
  };
  if (F) food = F.createController({ ...sharedOptions, openGrocery, onDateChange: date => { if (wellness && wellness.setSelectedDate) wellness.setSelectedDate(date); } });
  if (H) habits = H.createController(sharedOptions);
  if (Dog) dog = Dog.createController({ ...sharedOptions, openGrocery,
    openReceipt: receiptId => commerce ? commerce.openReceipt(receiptId) : false });
  if (W) wellness = W.createController({ ...sharedOptions,
    onDateChange: date => { if (food && food.setSelectedDate) food.setSelectedDate(date); },
    getHabitsSummary: date => habits ? habits.getHomeSummary(date) : {},
    getDogSummary: date => dog ? dog.getHomeSummary(date) : {},
    openFoodLog: (productId, person) => {
      if (!navigate('food') || !food) return false;
      food.selectTab('log');
      if (food.startProductLog) food.startProductLog(productId, person, W ? W.dayKey() : undefined);
      renderKeepScroll('#food-log-form');
      return true;
    },
    openFoodPlans: () => {
      if (!navigate('food') || !food) return false;
      food.selectTab('plans');
      renderKeepScroll('#food-plans');
      return true;
    },
    openHousehold: () => {
      if (!navigate('grocery') || !grocery) return false;
      grocery.selectTab('household');
      renderKeepScroll();
      return true;
    }
  });
  grocery = G.createController({
    store: cloud,
    getLocalShopping: () => personalAvailable() ? (state.data.shoppingList || []) : [],
    notify: showNotice,
    refresh: selector => renderKeepScroll(selector),
    navigate,
    confirm: message => window.confirm(message),
    commerce, draftStore,
    hasOtherUnpersistedChanges: () => [food, habits, dog, wellness].some(controller => controller && controller.hasUnpersistedChanges && controller.hasUnpersistedChanges()),
    openFood: tab => {
      if(navigate('food')) { if(food && food.selectTab) food.selectTab(tab); renderKeepScroll(); }
    }
  });

  function personalAvailable() {
    return personalState && ['legacy', 'account'].includes(personalState.mode);
  }
  function switchPersonal(next) {
    if (personalState && personalState.key && state.unsaved) {
      unsavedJournals.set(personalState.key, { data: state.data, readOnly: state.readOnly, warning: 'These latest personal entries have not been saved on this device. Export a personal backup before closing.' });
    }
    personalState = next;
    const remembered = next.key && unsavedJournals.get(next.key);
    const opened = remembered || next.loaded || { data: D.normalizeData({ records: {} }), readOnly: true, warning: '' };
    loaded = opened;
    storage = next.storage || deviceStorage;
    state.data = opened.data;
    state.readOnly = opened.readOnly;
    state.unsaved = Boolean(remembered) || (Boolean(opened.warning) && !opened.readOnly);
    state.moodTarget = null;
    state.activityId = '';
    pages.discardDraft();
    if (opened.warning) showNotice(opened.warning, true);
    else noticeEl.hidden = true;
  }
  function handleCloudChange() {
    if (!cloud || !grocery) return;
    const snapshot = cloud.snapshot();
    const identity = snapshot.user ? snapshot.user.id : null;
    const changed = identity !== activeAccountIdentity;
    if (changed) {
      activeAccountIdentity = identity;
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      for (const id of ['activity-dialog', 'mood-dialog', 'appointment-dialog']) {
        const dialog = document.getElementById(id);
        if (dialog) { if (dialog.open) dialog.close(); dialog.innerHTML = ''; }
      }
      if (personalManager) switchPersonal(personalManager.open(snapshot.user));
      grocery.hasUnsavedDraft(); // Also discard previous-account UI state when viewing another section.
      if(commerce) commerce.hasUnsavedDraft();
      if(food) food.hasUnsavedDraft();
      for (const controller of [habits, dog, wellness]) if (controller) controller.hasUnsavedDraft();
    }
    if (snapshot.recovery) state.page = 'grocery';
    const editing = connectedControllers().some(controller => controller.hasUnsavedDraft() || controller.isBusy());
    if (changed || snapshot.recovery || !['home','grocery','food','wellness','money','dog','housework','skills','smoking'].includes(state.page) || !editing) renderKeepScroll();
  }
  function renderPersonalGate() {
    const signedIn = cloud && cloud.snapshot().user;
    if (personalState.mode === 'choose' && signedIn) {
      return '<section class="panel personal-gate"><p class="page-kicker">Your personal journal on this device</p><h2>Are these earlier entries yours?</h2><p>Your earlier Sleep &amp; Mood, appointments, and Ideas entries are still on this device. Choose how to open your personal journal for this account.</p><div class="page-actions"><button type="button" class="button primary" data-personal-action="claim">These are my earlier entries</button><button type="button" class="button" data-personal-action="fresh">Start a separate journal</button></div><p class="caption">This copies entries locally for your account. It does not upload them to your household. Keep an exported backup.</p></section>';
    }
    return '<section class="panel personal-gate"><h2>Your personal journal</h2><p>' + escapeText(personalState.message || 'Sign in to open your personal journal on this device.') + '</p><button type="button" class="button primary" data-personal-action="signin">Open sign-in</button></section>';
  }
  const appointments = A.createController({
    getData: () => state.data,
    getWeekStart: () => state.week,
    canEdit,
    notify: showNotice,
    refresh: () => renderKeepScroll(),
    onSaved(occurrence) {
      let key = dateKey(occurrence.start.getFullYear(), occurrence.start.getMonth(), occurrence.start.getDate());
      if (occurrence.start.getHours() < 8) key = shiftDate(key, -1);
      const week = D.weekStart(key);
      const changedWindow = state.view === 'day' ? key !== state.date : week !== state.week;
      state.date = key;
      state.week = week;
      const date = parseDate(key);
      state.year = date.getFullYear();
      state.month = date.getMonth();
      if (changedWindow) window.scrollTo({ top: 0, behavior: 'auto' });
    },
    commitData: candidate => commitData(candidate, 'This appointment could not be saved. Your current entries have not been replaced. Please keep the appointment form open and try again.')
  });

  function renderWeek() {
    const keys = Array.from({ length: 7 }, (_, index) => shiftDate(state.week, index));
    const weekFrom = parseDate(state.week);
    weekFrom.setHours(8, 0, 0, 0);
    const weekUntil = parseDate(shiftDate(state.week, 7));
    weekUntil.setHours(8, 0, 0, 0);
    const planned = D.appointmentsInWindow(state.data.appointments || [], weekFrom, weekUntil);
    const end = keys[6];
    const firstYear = parseDate(state.week).getFullYear();
    const lastYear = parseDate(end).getFullYear();
    const label = `${dateMedium(state.week)}${firstYear !== lastYear ? ', ' + firstYear : ''} – ${dateMedium(end)}, ${lastYear}`;
    let html = `<div class='month-nav week-nav'><div class='nav-group'><button type='button' class='nav-btn' data-action='prev-week' aria-label='Previous week'>‹</button><button type='button' class='nav-btn' data-action='next-week' aria-label='Next week'>›</button></div><div class='week-heading'><h2>Your week in Bloom</h2><p class='week-dates'>${label}</p></div><button type='button' class='today-btn' data-action='this-week'>This week</button></div>`;
    html += `<section class='panel'><div class='panel-title-row'><h2>Open a daily log</h2><span class='pill'>8 AM → 8 AM</span></div><div class='week-jump'><label for='week-jump-date'>Go to week of</label><input type='date' id='week-jump-date' min='0001-01-01' max='9999-12-31' value='${state.week}'></div><div class='week-day-links'>`;
    for (const key of keys) {
      const date = parseDate(key);
      html += `<button type='button' class='week-day-link ${key === trackingToday() ? 'today' : ''}' data-open-date='${key}' aria-label='Open daily log for ${dateLong(key)}'><span>${date.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>${date.getDate()}</strong></button>`;
    }
    html += `</div><p class='caption'>Record your sleep and activities in the daily log. Add a mood to each hour you mark awake.</p></section>`;
    html += appointments.renderAgenda(state.week);
    html += `<section class='panel' id='weekly-mood-grid'><div class='panel-title-row'><h2>Your weekly mood grid</h2><span class='pill'>${planned.length} planned · One hour per row</span></div><p class='week-grid-caption' id='week-grid-help'>Colored Planned blocks show your appointments at their scheduled times. Tap a block to edit it. Tap an awake hour to add or edit how you felt. Scroll sideways to see all seven days. After midnight, times belong to the following calendar day.</p><div class='week-scroll' tabindex='0' role='region' aria-label='Scrollable weekly mood grid' aria-describedby='week-grid-help'><table class='week-grid'><caption class='sr-only'>Mood, activities, and planned appointments for ${label}. Each column is an 8 AM to 8 AM tracking day.</caption><thead><tr><th scope='col' class='week-time-col'>Time</th>`;
    for (const key of keys) {
      const date = parseDate(key);
      html += `<th scope='col'><span>${date.toLocaleDateString('en-US', { weekday: 'short' })}</span><small>${dateMedium(key)}</small></th>`;
    }
    html += '</tr></thead><tbody>';
    for (let hour = 0; hour < 24; hour++) {
      html += `<tr><th scope='row' class='week-time-col'><span>${clockLabel(hour * 2).replace(':00', '')}</span>${hour >= 16 ? '<small>next day</small>' : ''}</th>`;
      for (const key of keys) {
        const record = recordFor(key);
        const mood = record.moods[hour];
        const awake = D.hasAwake(record, hour);
        const activities = hourActivities(record, hour);
        const status = hourStatus(record, hour);
        const context = activities.map(activity => activity.name).join(', ');
        const labelText = `${fullHourLabel(key, hour)}. ${status}.${context ? ' Activities: ' + context + '.' : ''}${mood ? ' Mood: ' + mood.feeling + '. Edit entry.' : awake ? ' Add mood.' : ' Open hour details.'}`;
        html += `<td id='week-cell-${key}-${hour}'>${appointments.renderHour(planned, key, hour)}<button type='button' class='week-cell ${mood ? 'has-mood' : ''} ${awake ? 'is-awake' : ''} ${mood && !awake ? 'has-conflict' : ''}' data-mood-hour='${hour}' data-mood-date='${key}' style='--mood-color:${mood ? moodColor(mood.feeling) : '#fff8fb'}' aria-label='${escapeText(labelText)}'><span class='week-feeling'>${mood ? escapeText(mood.feeling) : awake ? '+ Add mood' : escapeText(status)}</span>`;
        if (mood && !awake) html += `<span class='week-status'>Awake time changed</span>`;
        else if (awake && !activities.length) html += `<span class='week-status'>Awake · no activity</span>`;
        for (const activity of activities) html += `<span class='week-activity' style='--activity-color:${activity.color}'><span aria-hidden='true'>${escapeText(activity.icon)}</span> ${escapeText(activity.name)}</span>`;
        html += '</button></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div><p class=\'caption\'>Mood is recorded only when you enter it. A blank mood is never treated as a feeling.</p></section>';
    return html;
  }

  function rangeOptions(start, end, selected) {
    let html = '';
    for (let index = start; index <= end; index++) {
      html += `<option value='${index}' ${index === selected ? 'selected' : ''}>${clockLabel(index)}${index >= 32 ? ' (next day)' : ''}</option>`;
    }
    return html;
  }
  function renderHourlyMoods(record) {
    const hours = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => D.hasAwake(record, hour) || record.moods[hour]);
    let html = `<section class='panel' id='hourly-moods'><div class='panel-title-row'><h2>How am I feeling?</h2><span class='pill'>Each awake hour</span></div><p class='caption'>Add your feeling alongside what you were doing. You can update any entry later.</p>`;
    if (!hours.length) return html + `<div class='hourly-empty'>Choose <strong>Awake</strong>, pick an activity, and mark your time above. Your awake hours will appear here.</div></section>`;
    html += `<div class='hourly-list'>`;
    for (const hour of hours) {
      const mood = record.moods[hour];
      const awake = D.hasAwake(record, hour);
      const activities = hourActivities(record, hour);
      html += `<button type='button' class='hourly-card ${mood ? 'has-mood' : ''}' data-mood-hour='${hour}' data-mood-date='${state.date}' style='--mood-color:${mood ? moodColor(mood.feeling) : '#f9f6fc'}' aria-label='${escapeText(fullHourLabel(state.date, hour) + (mood ? '. Mood: ' + mood.feeling + '. Edit mood.' : '. Add mood.'))}'><span class='hourly-time'>${hourLabel(hour)}</span><span class='hourly-body'><span class='hourly-feeling'>${mood ? escapeText(mood.feeling) : 'How did you feel?'}</span><span class='hourly-activities'>${activities.length ? activities.map(activityChip).join('') : awake ? 'Awake · activity not added' : 'Saved mood · awake time changed'}</span></span><span class='hourly-action'>${mood ? 'Edit' : '+ Add'}</span></button>`;
    }
    return html + '</div></section>';
  }
  function renderDay() {
    const record = recordFor(state.date);
    const selectedActivity = activityFor(state.activityId);
    const from = parseDate(state.date);
    from.setHours(8, 0, 0, 0);
    const to = parseDate(shiftDate(state.date, 1));
    to.setHours(8, 0, 0, 0);
    const planned = D.appointmentsInWindow(state.data.appointments || [], from, to);
    let html = `<section class='panel'><div class='detail-head'><div><span class='pill'>MY DAILY LOG</span><h2>${dateLong(state.date)}</h2><p class='sub'>8 AM ${dateMedium(state.date)} → 8 AM ${dateMedium(shiftDate(state.date, 1))}</p></div><div class='detail-actions'><button type='button' class='mini-btn' data-action='back-week'>‹ Week</button></div></div><div class='detail-stats'><div class='detail-stat'><small>Asleep</small><strong>${formatHour(sleepHours(state.date))} hrs</strong></div><div class='detail-stat'><small>Unsure</small><strong>${formatHour(restHours(state.date))} hrs</strong></div><div class='detail-stat'><small>Awake</small><strong>${formatHour(awakeHours(state.date))} hrs</strong></div></div></section>${appointments.renderDayAgenda(state.date, planned)}<section class='panel'><div class='panel-title-row tracking-mode-heading'><h3>Choose your tracking mode</h3><span class='muted tiny'>Then tap the time squares</span></div><div class='status-picker' role='group' aria-label='Sleep timeline mark type'><button type='button' data-mode='sleep' class='status-btn sleep ${state.mode === 'sleep' ? 'selected' : ''}' aria-pressed='${state.mode === 'sleep'}'>☾ Asleep</button><button type='button' data-mode='rest' class='status-btn rest ${state.mode === 'rest' ? 'selected' : ''}' aria-pressed='${state.mode === 'rest'}'>◇ Unsure</button><button type='button' data-mode='awake' class='status-btn awake ${state.mode === 'awake' ? 'selected' : ''}' aria-pressed='${state.mode === 'awake'}' aria-haspopup='dialog'>☀ Awake ▾</button><button type='button' data-mode='erase' class='status-btn erase ${state.mode === 'erase' ? 'selected' : ''}' aria-pressed='${state.mode === 'erase'}'>⌫ Erase</button></div>`;
    if (state.mode === 'awake') html += `<div class='activity-selection'><span>${selectedActivity ? activityChip(selectedActivity) : 'Awake without an activity'}</span><button type='button' class='mini-btn' data-action='choose-activity'>Change activity</button></div>`;
    html += `<p class='timeline-guide'>Each square is <strong>30 minutes</strong>. Tap a square to apply your choice. Use Erase to clear a square. Unmarked time is unknown.</p>`;
    for (let group = 0; group < 8; group++) {
      const first = group * 6;
      const last = first + 6;
      html += `<section class='time-group daily-time-group'><div class='time-group-label'>${clockLabel(first)} — ${clockLabel(last)}${first >= 32 ? ' (next day)' : last >= 32 ? ' (into next day)' : ''}</div><div class='timeline-hours'>`;
      for (let hour = 0; hour < 3; hour++) html += `<span>${clockLabel(first + hour * 2).replace(':00', '')}${first + hour * 2 >= 32 ? ' +1' : ''}</span>`;
      html += `</div><div class='time-slots'>`;
      for (let index = first; index < last; index++) {
        const kind = record.slots[index] || 'empty';
        const activity = kind === 'awake' ? activityFor(record.activities[index]) : null;
        const label = `${clockLabel(index)}–${clockLabel(index + 1)}${index >= 32 ? ' next day' : ''}: ${STATUS_LABELS[kind]}${activity ? ', ' + activity.name : ''}`;
        html += `<button type='button' data-slot='${index}' class='time-block ${kind} ${activity ? 'has-activity' : ''}' ${activity ? `style='--activity-color:${activity.color}'` : ''} aria-label='${escapeText(label)}' aria-pressed='${kind !== 'empty'}' title='${escapeText(label)}'>${activity ? `<span class='slot-activity-icon' aria-hidden='true'>${escapeText(activity.icon)}</span>` : `<span class='halfmark' aria-hidden='true'></span>`}</button>`;
      }
      html += `</div>${appointments.renderDayRange(planned, state.date, first, last)}</section>`;
    }
    html += `<div class='status-key'><span><i class='key-dot' style='background:#9b83cd'></i> Asleep</span><span><i class='key-dot' style='background:#e4b2d3'></i> Unsure</span><span><i class='key-dot' style='background:#b9d5e8'></i> Awake</span><span><i class='key-dot' style='background:#f9f7fa;border:1px solid #dfd5eb'></i> Unknown</span></div></section><section class='panel'><div class='panel-title-row'><h2>Fill a time range</h2><span class='pill'>Faster logging</span></div><div class='form-row'><div class='form-field'><label for='range-start'>From</label><select id='range-start'>${rangeOptions(0, 47, state.rangeStart)}</select></div><div class='form-field'><label for='range-end'>Until</label><select id='range-end'>${rangeOptions(1, 48, state.rangeEnd)}</select></div></div><div class='form-actions'><button type='button' class='button primary' data-action='fill-range'>Apply ${STATUS_LABELS[state.mode]}${state.mode === 'awake' && selectedActivity ? ' · ' + escapeText(selectedActivity.name) : ''}</button></div><p class='caption'>Choose times within this 8 AM–8 AM day. Your selected mode applies to the whole range.</p></section>`;
    html += renderHourlyMoods(record);
    html += `<section class='panel'><h2>How was your sleep?</h2><p class='caption'>Your own rating of your sleep, separate from your hourly mood.</p><div class='quality-row'>${['Poor', 'Okay', 'Restful'].map(quality => `<button type='button' class='quality ${record.quality === quality ? 'active' : ''}' data-quality='${quality}' aria-pressed='${record.quality === quality}'>${quality}</button>`).join('')}</div><div class='form-field day-notes-field'><label for='notes'>Daily notes</label><textarea id='notes' maxlength='3000' placeholder='What would I like to remember about today?'>${escapeText(record.notes)}</textarea></div><div class='form-actions day-save-actions'><button type='button' class='button' data-action='clear-day'>Clear this day's log</button><span class='tiny muted save-state'></span></div></section><div class='panel day-footer-actions'><button type='button' class='button' data-action='prev-day'>← Previous</button><button type='button' class='button primary' data-action='today'>Today</button><button type='button' class='button' data-action='next-day'>Next →</button></div>`;
    return html;
  }

function renderMonth(){
  const metrics=statsForMonth();
  let html=`${headerForMonth()}<div class="stats">
    <div class="stat"><div class="stat-label">Days with sleep totals</div><div class="stat-value">${metrics.keys.length}<span style="font-size:14px;color:#a09ab2">/${dayCount(state.year,state.month)}</span></div><div class="stat-foot">No entries are assumed</div></div>
    <div class="stat"><div class="stat-label">Average logged sleep</div><div class="stat-value">${metrics.average===null?'—':formatHour(Math.round(metrics.average*10)/10)}<span style="font-size:13px"> ${metrics.average===null?'':'hrs'}</span></div><div class="stat-foot">Days with recorded sleep totals</div></div>
    <div class="stat"><div class="stat-label">Reference goal</div><div class="stat-value">8<span style="font-size:13px"> hrs</span></div><div class="stat-foot">Not a pass/fail score</div></div>
  </div><div class="panel"><div class="panel-title-row"><h2>Your monthly sleep log</h2><span class="pill">Tap a day ↗</span></div>
  <div class="month-table-scroll"><div class="month-table"><div class="month-heading"><span class="day-label">Day</span>${Array.from({length:12},(_,i)=>`<span>${i+1}</span>`).join('')}<span>Hrs</span></div>`;
  for(let day=1;day<=dayCount(state.year,state.month);day++){
    const key=dateKey(state.year,state.month,day), sleep=sleepHours(key), logged=hasSleepTotal(key), col=colorFor(sleep);
    html+=`<button type="button" class="month-row" data-open-date="${key}" aria-label="Open ${dateLong(key)}; ${logged?formatHour(sleep)+' hours of sleep recorded':'not logged'}">
      <span class="day-number ${key===trackingToday()?'today':''}">${day}</span>`;
    for(let d=1;d<=12;d++){
      const fill=logged&&(sleep>=d?'full':sleep>=d-.5?'half':'');
      html+=`<span class="dot ${fill}" style="--cat:${col}" aria-hidden="true"></span>`;
    }
    html+=`<span class="row-total">${logged?formatHour(sleep):'—'}</span></button>`;
  }
  html+=`</div></div><div class="dot-key"><span><i class="dot-example"></i> 1 hour</span><span><i class="dot-example half"></i> 30 minutes</span><span><i class="dot-example blank"></i> Not recorded</span></div><div class="hint"><strong>How to read it:</strong> Circles fill as you record actual or estimated sleep on each day. If you sleep more than 12 hours, the row shows the real total even though there are only 12 circles. Tap any row for a detailed 24-hour log.</div></div>`;
  return html;
}
  function renderMonthInsights() {
    const summary = I.summarizeMonth(state.data, state.year, state.month);
    const hours = value => formatHour(Math.round(value * 10) / 10);
    let html = `<section class='panel month-insights'><div class='panel-title-row'><div><h2>Month at a glance</h2><p class='week-dates'>${monthLabel()}</p></div><span class='pill'>Your recorded history</span></div><div class='insight-metrics'><div class='insight-metric'><small>Average sleep recorded</small><strong>${summary.averageSleep === null ? '—' : hours(summary.averageSleep) + ' hrs'}</strong><span>${summary.daysWithSleep} ${summary.daysWithSleep === 1 ? 'day' : 'days'} with sleep totals</span></div><div class='insight-metric'><small>Sleep + mood together</small><strong>${summary.pairedDays} ${summary.pairedDays === 1 ? 'day' : 'days'}</strong><span>Both entered in the same tracking day</span></div><div class='insight-metric'><small>Hourly mood entries</small><strong>${summary.moodEntryCount}</strong><span>Across ${summary.daysWithMood} ${summary.daysWithMood === 1 ? 'day' : 'days'}</span></div></div><div class='summary-row'><span>Sleep hours recorded this month</span><strong>${hours(summary.sleepHoursTotal)} hrs</strong></div>`;
    html += `<div class='insight-summary'><h3>Sleep alongside mood</h3><p>${summary.pairedDays === 0 ? 'Add sleep and hourly feelings to see your own records compared here.' : summary.pairedDays === 1 ? 'One tracking day has both sleep and mood entries so far. Add more days to build your comparison.' : `Comparing ${summary.pairedDays} tracking days with both sleep and mood entries.`}</p></div>`;
    if (summary.comparisons.length) {
      html += `<div class='insight-pairs'>`;
      for (const comparison of summary.comparisons) {
        const width = Math.min(100, Math.max(0, comparison.averageSleep / 24 * 100));
        html += `<div class='insight-pair'><div class='insight-comparison-text'><strong>${escapeText(comparison.feeling)}</strong><span>${hours(comparison.averageSleep)} hrs on average · ${comparison.days} ${comparison.days === 1 ? 'day' : 'days'}</span></div><div class='insight-bar' aria-hidden='true'><span class='insight-bar-fill' style='width:${width.toFixed(2)}%;--mood-color:${moodColor(comparison.feeling)}'></span></div><p class='caption'>${comparison.days === 1 ? 'One observation; more days will add context.' : `Recorded sleep ranged from ${hours(comparison.minSleep)} to ${hours(comparison.maxSleep)} hours on days you logged this feeling.`}</p></div>`;
      }
      html += '</div>';
    }
    html += `<details class='insight-disclosure'><summary>How these comparisons work</summary><p>We compare feelings with sleep recorded in the <strong>same 8 AM–8 AM tracking day</strong>. This is a look at entries that occurred together; it does not show that sleep caused a feeling or that sleep happened before it.</p><p>Each day is counted once for each feeling, even if you logged that feeling several times. A day can include several feelings. Missing sleep totals are left out; a fully recorded all-awake day counts as zero.</p><p>These are recorded hours. Unmarked or Unsure time can make sleep totals incomplete.${summary.incompleteSleepDays ? ` ${summary.incompleteSleepDays} ${summary.incompleteSleepDays === 1 ? 'day with a sleep total has' : 'days with sleep totals have'} some unmarked or Unsure time.` : ''} No mood score is assumed.</p></details></section>`;
    html += `<section class='panel month-insights'><div class='panel-title-row'><h2>Your dated sleep &amp; mood history</h2><span class='pill'>${monthLabel()}</span></div><p class='caption'>Dates identify the 8 AM start of each tracking day. Tap a date to review or update its entries.</p>`;
    if (!summary.recordedDays.length) return html + `<div class='insight-empty'>Your dated history will appear here as you record sleep, activities, or feelings. Use the month arrows to return to earlier entries.</div></section>`;
    html += `<div class='history-scroll' tabindex='0' role='region' aria-label='Dated sleep and mood history for ${monthLabel()}'><table class='history-table'><caption class='sr-only'>Recorded sleep and feelings in ${monthLabel()}</caption><thead><tr><th scope='col'>Tracking date</th><th scope='col'>Sleep recorded</th><th scope='col'>Feelings logged</th></tr></thead><tbody>`;
    for (const day of summary.recordedDays) {
      html += `<tr><th scope='row'><button type='button' class='history-date' data-open-date='${day.key}' aria-label='Open ${dateLong(day.key)}'>${dateMedium(day.key)}<small>${parseDate(day.key).toLocaleDateString('en-US', { weekday: 'short' })}</small></button></th><td>${day.knownSleep ? `<strong>${hours(day.sleepHours)} hrs</strong>${day.incomplete ? '<small>Partial log</small>' : ''}` : '<span class="muted">Not recorded</span>'}</td><td><div class='history-moods'>${day.moods.length ? day.moods.map(mood => `<span class='history-mood' style='--mood-color:${moodColor(mood.feeling)}'>${escapeText(mood.feeling)}${mood.entries > 1 ? ' · ' + mood.entries : ''}</span>`).join('') : '<span class="muted">No mood entered</span>'}</div></td></tr>`;
    }
    return html + `</tbody></table></div><p class='caption'>A number beside a feeling is the number of hourly entries with that feeling. Plans and appointments are not counted as completed activities or mood entries.</p></section>`;
  }

function polar(cx,cy,r,angle){return {x:cx+r*Math.cos(angle),y:cy+r*Math.sin(angle)};}
function sector(cx,cy,inner,outer,start,end){const a=polar(cx,cy,outer,start),b=polar(cx,cy,outer,end),c=polar(cx,cy,inner,end),d=polar(cx,cy,inner,start);return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${outer} ${outer} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} A ${inner} ${inner} 0 0 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Z`;}
function renderCircle(){
  const all=monthKeys(), n=all.length,metrics=statsForMonth();
  let svg=`<svg viewBox="0 0 420 420" role="img" aria-label="Circular monthly tracker. Tap a numbered segment to open that day."><defs><radialGradient id="moonHalo"><stop offset="0" stop-color="#fff5f8"/><stop offset="1" stop-color="#fff9fb"/></radialGradient></defs><circle cx="210" cy="210" r="184" fill="#fff3f7"/>`;
  for(let i=0;i<n;i++){
    const k=all[i],hrs=sleepHours(k),filled=hasSleepTotal(k),t0=-Math.PI/2+i*2*Math.PI/n,t1=-Math.PI/2+(i+1)*2*Math.PI/n;
    const pt=polar(210,210,167,(t0+t1)/2);const fill=filled?colorFor(hrs):'#fff';
    svg+=`<g class="ring-day" data-open-date="${k}" role="button" tabindex="0" aria-label="${dateLong(k)}: ${filled?formatHour(hrs)+' hours sleep logged':'no sleep logged'}"><title>${dateLong(k)}: ${filled?formatHour(hrs)+' hours logged':'not logged'}</title><path d="${sector(210,210,143,183,t0,t1)}" fill="${fill}" stroke="#998ab3" stroke-width="1.2"/><text x="${pt.x.toFixed(1)}" y="${pt.y.toFixed(1)}">${i+1}</text></g>`;
  }
  svg+=`<circle cx="210" cy="210" r="135" fill="url(#moonHalo)" stroke="#efd3dd" stroke-width="1.5"/><circle cx="194" cy="207" r="70" fill="#f3c4d5"/><circle cx="229" cy="174" r="70" fill="#fff5f8"/><g fill="#d5b1a0"><text x="132" y="157" font-size="21">✦</text><text x="297" y="225" font-size="25">✧</text><text x="158" y="286" font-size="17">✧</text><text x="280" y="144" font-size="15">✦</text></g><text x="210" y="311" text-anchor="middle" font-family="Georgia,serif" font-size="15" fill="#9c6076">rest • restore • bloom</text></svg>`;
  return `${headerForMonth()}<section class="panel"><div class="panel-title-row"><h2>Your monthly moon wheel</h2><span class="pill">Tap a segment</span></div><div class="wheel-wrap">${svg}</div><div class="wheel-legend">${COLORS.map(c=>`<div class="legend-item"><span class="legend-color" style="background:${c.color}"></span>${c.label}</div>`).join('')}</div><p class="caption">One segment per day. An empty segment means sleep is not recorded yet. Only a fully recorded all-awake day counts as zero sleep. Every color is information, not a grade.</p></section>
  ${renderMonthInsights()}`;
}

  function formatTrashCountdown(milliseconds) {
    const total=Math.max(0,Math.floor(milliseconds/1000));
    const hours=Math.floor(total/3600);
    const minutes=Math.floor((total%3600)/60);
    const seconds=total%60;
    if(hours>0) return hours+'h '+String(minutes).padStart(2,'0')+'m '+String(seconds).padStart(2,'0')+'s';
    return minutes+'m '+String(seconds).padStart(2,'0')+'s';
  }
  function updateTrashDashboard() {
    if(state.page!=='home'||!wellness||typeof wellness.trashReminderState!=='function')return;
    const reminder=wellness.trashReminderState(new Date());
    const node=content.querySelector('[data-trash-reminder]');
    if(!reminder) {
      if(node) renderKeepScroll();
      return;
    }
    if(!node) {
      renderKeepScroll();
      return;
    }
    node.dataset.trashDeadline=reminder.deadline;
    node.classList.toggle('is-urgent',Boolean(reminder.urgent));
    const title=node.querySelector('[data-trash-title]');
    const countdown=node.querySelector('[data-trash-countdown]');
    if(title) title.textContent=reminder.title;
    if(countdown) countdown.textContent=formatTrashCountdown(reminder.remaining);
  }
  function render() {
    const isSleepMood = state.page === 'sleep-mood';
    const [heading, subtitle] = PAGE_DETAILS[state.page];
    $('#page-heading').textContent = heading;
    $('#page-subtitle').textContent = subtitle;
    $('#page-banner').hidden = state.page === 'home' && Boolean(wellness);
    $('#sleep-mood-tabs').hidden = !isSleepMood || !personalAvailable();
    content.setAttribute('aria-label', isSleepMood ? 'Sleep and mood view' : state.page === 'home' ? 'Life in Bloom home' : heading);
    document.title = state.page === 'home' ? 'Life in Bloom' : `${heading} · Life in Bloom`;
    for (const button of document.querySelectorAll('[data-page]')) {
      const active = button.dataset.page === state.page || (button.classList.contains('bottom-nav-button') && button.dataset.page === 'food' && state.page === 'grocery');
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const button of document.querySelectorAll('.view-tab')) {
      const active = isSleepMood && (button.dataset.view === state.view || (state.view === 'month' && button.dataset.view === 'circle'));
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (state.page === 'grocery') content.innerHTML = (personalState.mode === 'choose' ? renderPersonalGate() : '') + grocery.render();
    else if (state.page === 'money' && commerce) content.innerHTML = commerce.render('money');
    else if (['food','wellness'].includes(state.page) && food) {
      if (state.page === 'wellness' && wellness && food.setSelectedDate) food.setSelectedDate(wellness.getSelectedDate());
      content.innerHTML = (state.page === 'wellness' && wellness ? wellness.renderWater() : '') + food.render(state.page);
    }
    else if (['dog','housework'].includes(state.page) && dog) content.innerHTML = dog.render(state.page);
    else if (['skills','smoking'].includes(state.page) && habits) content.innerHTML = habits.render(state.page);
    else if (!personalAvailable() && ['sleep-mood', 'ideas'].includes(state.page)) content.innerHTML = renderPersonalGate();
    else if (!isSleepMood) content.innerHTML = (state.page === 'home' && !personalAvailable() ? renderPersonalGate() : '') + pages.render(state.page);
    else if (state.view === 'day') content.innerHTML = renderDay();
    else if (state.view === 'circle') content.innerHTML = renderCircle() + `<div class='panel'><button type='button' class='button' data-action='back-month'>View monthly sleep totals</button></div>`;
    else if (state.view === 'month') content.innerHTML = renderMonth() + `<div class='panel'><button type='button' class='button' data-action='back-wheel'>Back to moon wheel</button></div>`;
    else content.innerHTML = renderWeek();
    const shared=cloud && cloud.snapshot();
    if(shared && ['home','grocery','food','wellness','money','dog','housework','skills','smoking'].includes(state.page) && shared.status==='error') {
      content.insertAdjacentHTML('afterbegin','<aside class="panel cloud-status error" role="alert"><strong>Life in Bloom could not finish loading shared data.</strong><br>'+escapeText(shared.error || 'Please refresh. Your saved records have not been deleted.')+'</aside>');
    }
    if(shared && ['home','grocery','food','wellness','money','dog','housework','skills','smoking'].includes(state.page) && (shared.offline || shared.cacheWarning)) {
      content.insertAdjacentHTML('afterbegin','<aside class="panel cloud-status" role="status">'+escapeText(shared.offline ? 'Offline — showing your saved device copy. Keep working on drafts; reconnect and save to update the household. Last copy: '+new Date(shared.cachedAt).toLocaleString() : shared.cacheWarning)+'</aside>');
    }
    if (state.readOnly && state.page === 'sleep-mood') {
      for (const element of content.querySelectorAll('[data-mode], [data-slot], [data-quality], [data-action=\'fill-range\'], [data-action=\'clear-day\'], [data-action=\'choose-activity\'], #notes')) element.disabled = true;
    }
    $('#import-file').disabled = state.readOnly;
    $('#export-btn').disabled = !personalAvailable();
    $('#menu-export-btn').disabled = !personalAvailable();
    updateSaveState();
    if (state.page === 'home' && wellness) requestAnimationFrame(updateTrashDashboard);
  }
  function commitSlot(index) {
    if (!canEdit()) return;
    state.data.records[state.date] = D.setSlot(recordFor(state.date), index, state.mode, state.activityId);
    saveRecords();
    renderKeepScroll(`[data-slot='${index}']`);
  }
  function setQuality(quality) {
    if (!canEdit()) return;
    const record = recordFor(state.date);
    state.data.records[state.date] = { ...record, quality: record.quality === quality ? '' : quality };
    saveRecords();
    renderKeepScroll(`[data-quality='${quality}']`);
  }
  function fillRange() {
    if (!canEdit()) return;
    const start = Number($('#range-start').value);
    const end = Number($('#range-end').value);
    try {
      state.data.records[state.date] = D.setRange(recordFor(state.date), start, end, state.mode, state.activityId);
      state.rangeStart = start;
      state.rangeEnd = end;
      const saved = saveRecords();
      renderKeepScroll('[data-action=\'fill-range\']');
      if (saved) showNotice(state.mode === 'erase' ? 'The selected time range was cleared. Any saved moods are still available below.' : `${clockLabel(start)} to ${clockLabel(end)} recorded as ${STATUS_LABELS[state.mode]}${state.mode === 'awake' && activityFor(state.activityId) ? ' · ' + activityFor(state.activityId).name : ''}.`);
    } catch (error) {
      showNotice(error.message, true);
    }
  }

  function makeDialog(id, labelId) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'bloom-dialog';
    dialog.setAttribute('aria-labelledby', labelId);
    document.body.appendChild(dialog);
    return dialog;
  }
  const activityDialog = makeDialog('activity-dialog', 'activity-dialog-title');
  const moodDialog = makeDialog('mood-dialog', 'mood-dialog-title');

  function openActivityDialog() {
    if (!canEdit()) return;
    activityDialog.innerHTML = `<div class='dialog-inner'><div class='dialog-top'><h2 id='activity-dialog-title'>What am I doing?</h2><button type='button' class='icon-button' data-dialog-close aria-label='Close activity choices'>×</button></div><p class='dialog-subtitle'>Choose an awake activity. Then tap your time squares or fill a time range.</p><div class='activity-grid'>${state.data.activities.map(activity => `<button type='button' class='activity-option' data-activity-id='${escapeText(activity.id)}' style='--activity-color:${activity.color}'><span class='activity-icon' aria-hidden='true'>${escapeText(activity.icon)}</span><span>${escapeText(activity.name)}</span></button>`).join('')}</div><button type='button' class='button ghost' data-activity-id=''>Awake without an activity</button><form id='custom-activity-form' class='custom-activity-form'><h3>Add your own activity</h3><div class='form-field'><label for='custom-activity-name'>Activity name</label><input id='custom-activity-name' name='activity-name' maxlength='60' autocomplete='off' placeholder='For example, Gardening' required></div><fieldset class='activity-color-fieldset'><legend>Choose a color</legend><div class='activity-color-options'>${D.ACTIVITY_COLORS.map((option, index) => `<label class='color-option'><input type='radio' name='activity-color' value='${option.color}' ${index === 0 ? 'checked' : ''}><span class='color-dot' style='--activity-color:${option.color}' aria-hidden='true'></span><span>${escapeText(option.label)}</span></label>`).join('')}</div></fieldset><p class='dialog-error' id='activity-error' role='alert' hidden></p><div class='dialog-actions'><button type='button' class='button' data-dialog-close>Cancel</button><button type='submit' class='button primary'>Add and choose</button></div></form></div>`;
    activityDialog.showModal();
  }
  function chooseActivity(id) {
    if (!canEdit() || (id && !activityFor(id))) return;
    state.mode = 'awake';
    state.activityId = id;
    activityDialog.close();
    renderKeepScroll('[data-mode=\'awake\']');
  }
  activityDialog.addEventListener('click', event => {
    if (event.target.closest('[data-dialog-close]')) { activityDialog.close(); return; }
    const choice = event.target.closest('[data-activity-id]');
    if (choice) chooseActivity(choice.dataset.activityId);
  });
  activityDialog.addEventListener('submit', event => {
    if (event.target.id !== 'custom-activity-form') return;
    event.preventDefault();
    if (!canEdit()) return;
    const name = $('#custom-activity-name').value.trim();
    const error = $('#activity-error');
    if (!name) {
      error.textContent = 'Give your activity a name.';
      error.hidden = false;
      $('#custom-activity-name').focus();
      return;
    }
    const existing = state.data.activities.find(activity => activity.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) { chooseActivity(existing.id); return; }
    if (state.data.activities.length >= 200) {
      error.textContent = 'This version can keep up to 200 activities. Please choose an existing activity.';
      error.hidden = false;
      return;
    }
    const selectedColor = activityDialog.querySelector('input[name=\'activity-color\']:checked')?.value;
    const activity = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      icon: '✨',
      color: D.ACTIVITY_COLORS.find(option => option.color === selectedColor)?.color || D.ACTIVITY_COLORS[0].color
    };
    state.data.activities.push(activity);
    saveRecords();
    chooseActivity(activity.id);
  });

  function openMoodDialog(key, hour) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || Number.isNaN(parseDate(key).getTime())) return;
    const record = recordFor(key);
    const mood = record.moods[hour];
    const awake = D.hasAwake(record, hour);
    const activities = hourActivities(record, hour);
    state.moodTarget = { key, hour };
    let html = `<div class='dialog-inner'><div class='dialog-top'><h2 id='mood-dialog-title'>How was I feeling?</h2><button type='button' class='icon-button' data-dialog-close aria-label='Close hourly mood'>×</button></div><p class='dialog-subtitle'>${fullHourLabel(key, hour)}</p><div class='mood-context'><strong>During this hour</strong><p>${escapeText(hourStatus(record, hour))}</p>${activities.map(activityChip).join('')}</div>`;
    if (!awake && !mood) {
      html += `<p>This hour is not marked awake. Open the daily log to record what you were doing, then add a feeling.</p><div class='dialog-actions'><button type='button' class='button' data-dialog-close>Close</button><button type='button' class='button primary' data-open-mood-day>Open daily log</button></div></div>`;
    } else {
      if (!awake) html += `<p class='saved-mood-warning'>This mood was saved earlier, and the awake time has since changed. Your entry is still here so you can review it.</p>`;
      html += `<form id='mood-form'><fieldset class='mood-fields' ${state.readOnly ? 'disabled' : ''}><legend class='sr-only'>Hourly mood entry</legend><div class='form-field'><label for='mood-feeling'>My feeling</label><input id='mood-feeling' name='feeling' maxlength='80' autocomplete='off' placeholder='Choose a word below, or write your own' value='${escapeText(mood?.feeling || '')}' required></div><div class='mood-suggestions' role='group' aria-label='Suggested feeling words'>${D.MOOD_OPTIONS.map(option => `<button type='button' class='mood-option ${mood?.feeling === option.label ? 'selected' : ''}' data-mood-suggestion='${escapeText(option.label)}' style='--mood-color:${option.color}' aria-pressed='${mood?.feeling === option.label}'>${escapeText(option.label)}</button>`).join('')}</div><div class='form-field'><label for='mood-note'>Anything I want to remember? (optional)</label><textarea id='mood-note' name='note' maxlength='1000' placeholder='What was happening, or how did it feel?'>${escapeText(mood?.note || '')}</textarea></div></fieldset><p class='dialog-error' id='mood-error' role='alert' hidden></p><div class='dialog-actions'>${mood ? `<button type='button' class='button' data-remove-mood ${state.readOnly ? 'disabled' : ''}>Remove entry</button>` : ''}<button type='button' class='button' data-dialog-close>Cancel</button><button type='submit' class='button primary' ${state.readOnly ? 'disabled' : ''}>Save feeling</button></div></form></div>`;
    }
    moodDialog.innerHTML = html;
    moodDialog.showModal();
    if (awake || mood) requestAnimationFrame(() => $('#mood-feeling')?.focus({ preventScroll: true }));
  }
  function closeMoodAndRender(target) {
    moodDialog.close();
    state.moodTarget = null;
    renderKeepScroll(`[data-mood-date='${target.key}'][data-mood-hour='${target.hour}']`);
  }
  moodDialog.addEventListener('click', event => {
    if (event.target.closest('[data-dialog-close]')) { moodDialog.close(); return; }
    if (event.target.closest('[data-open-mood-day]')) {
      const key = state.moodTarget?.key;
      moodDialog.close();
      if (key) openDate(key);
      return;
    }
    const suggestion = event.target.closest('[data-mood-suggestion]');
    if (suggestion && canEdit()) {
      $('#mood-feeling').value = suggestion.dataset.moodSuggestion;
      updateMoodSuggestions();
      return;
    }
    if (event.target.closest('[data-remove-mood]') && canEdit() && state.moodTarget) {
      const target = { ...state.moodTarget };
      if (!window.confirm('Remove this hour\'s mood entry? Its sleep and activity times will stay as recorded.')) return;
      state.data.records[target.key] = D.setMood(recordFor(target.key), target.hour, null);
      const saved = saveRecords();
      closeMoodAndRender(target);
      if (saved) showNotice('The hourly mood entry was removed.');
    }
  });
  function updateMoodSuggestions() {
    const feeling = $('#mood-feeling').value.trim().toLocaleLowerCase();
    for (const button of moodDialog.querySelectorAll('[data-mood-suggestion]')) {
      const active = button.dataset.moodSuggestion.toLocaleLowerCase() === feeling;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  moodDialog.addEventListener('input', event => {
    if (event.target.id === 'mood-feeling') updateMoodSuggestions();
  });
  moodDialog.addEventListener('submit', event => {
    if (event.target.id !== 'mood-form') return;
    event.preventDefault();
    if (!canEdit() || !state.moodTarget) return;
    const target = { ...state.moodTarget };
    try {
      state.data.records[target.key] = D.setMood(recordFor(target.key), target.hour, {
        feeling: $('#mood-feeling').value,
        note: $('#mood-note').value,
        updatedAt: new Date().toISOString()
      });
      const saved = saveRecords();
      closeMoodAndRender(target);
      if (saved) showNotice('Your hourly feeling was saved with its activity times.');
    } catch (error) {
      $('#mood-error').textContent = error.message;
      $('#mood-error').hidden = false;
    }
  });
  moodDialog.addEventListener('close', () => {
    if (!moodDialog.open) state.moodTarget = null;
  });

  content.addEventListener('click', event => {
    const personalButton = event.target.closest('[data-personal-action]');
    if (personalButton) {
      if (personalButton.dataset.personalAction === 'signin') { navigate('grocery'); return; }
      const user = cloud.snapshot().user;
      if (!user || !personalManager) return;
      try {
        const next = personalButton.dataset.personalAction === 'claim'
          ? personalManager.claimLegacy(user.id, unsavedJournals.get('legacy')?.data)
          : personalManager.startFresh(user.id);
        switchPersonal(next);
        if (personalButton.dataset.personalAction === 'claim') unsavedJournals.delete('legacy');
        renderKeepScroll();
        showNotice('Your personal journal is open on this device. Export a personal backup to keep another copy.');
      } catch (error) { showNotice(error.message, true); }
      return;
    }
    if (wellness && wellness.handleClick(event)) return;
    if (habits && habits.handleClick(event)) return;
    if (dog && dog.handleClick(event)) return;
    if (food && food.handleClick(event)) return;
    if (commerce && commerce.handleClick(event)) return;
    if (grocery.handleClick(event)) return;
    const destination = event.target.closest('[data-page]');
    if (destination) { navigate(destination.dataset.page); return; }
    if (pages.handleClick(event)) return;
    if (appointments.handleClick(event)) return;
    const planned = event.target.closest('[data-show-planned-date]');
    if (planned) {
      const key = planned.dataset.showPlannedDate;
      const hour = Number(planned.dataset.showPlannedHour);
      if (Number.isNaN(parseDate(key).getTime()) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !leaveDraft()) return;
      state.week = D.weekStart(key);
      changeView('week');
      requestAnimationFrame(() => {
        const cell = document.getElementById(`week-cell-${key}-${hour}`);
        cell?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        cell?.querySelector('.appointment-grid-item')?.focus({ preventScroll: true });
      });
      return;
    }
    const open = event.target.closest('[data-open-date]');
    if (open) { openDate(open.dataset.openDate); return; }
    const hour = event.target.closest('[data-mood-hour]');
    if (hour) { openMoodDialog(hour.dataset.moodDate, Number(hour.dataset.moodHour)); return; }
    const slot = event.target.closest('[data-slot]');
    if (slot) { commitSlot(Number(slot.dataset.slot)); return; }
    const mode = event.target.closest('[data-mode]');
    if (mode) {
      if (!canEdit()) return;
      if (mode.dataset.mode === 'awake') { openActivityDialog(); return; }
      state.mode = mode.dataset.mode;
      renderKeepScroll(`[data-mode='${state.mode}']`);
      return;
    }
    const quality = event.target.closest('[data-quality]');
    if (quality) { setQuality(quality.dataset.quality); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'prev-month') switchMonth(-1);
    if (action === 'next-month') switchMonth(1);
    if (action === 'this-month') {
      const current = parseDate(trackingToday());
      state.year = current.getFullYear();
      state.month = current.getMonth();
      render();
    }
    if (action === 'prev-week' || action === 'next-week') {
      state.week = shiftDate(state.week, action === 'prev-week' ? -7 : 7);
      render();
    }
    if (action === 'this-week') { state.week = D.weekStart(trackingToday()); render(); }
    if (action === 'back-week') { state.week = D.weekStart(state.date); changeView('week'); }
    if (action === 'back-month') changeView('month');
    if (action === 'back-wheel') changeView('circle');
    if (action === 'today') openDate(trackingToday());
    if (action === 'prev-day') openDate(shiftDate(state.date, -1));
    if (action === 'next-day') openDate(shiftDate(state.date, 1));
    if (action === 'fill-range') fillRange();
    if (action === 'choose-activity') openActivityDialog();
    if (action === 'clear-day' && canEdit()) {
      if (window.confirm(`Clear the sleep, activities, hourly moods, notes and sleep quality for ${dateLong(state.date)}?`)) {
        delete state.data.records[state.date];
        saveRecords();
        renderKeepScroll('[data-action=\'clear-day\']');
      }
    }
  });
  content.addEventListener('keydown', event => {
    const open = event.target.closest('.ring-day[data-open-date]');
    if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openDate(open.dataset.openDate);
    }
  });
  content.addEventListener('input', event => {
    if (wellness && wellness.handleInput(event)) return;
    if (habits && habits.handleInput(event)) return;
    if (dog && dog.handleInput(event)) return;
    if (food && food.handleInput(event)) return;
    if (commerce && commerce.handleInput(event)) return;
    if (grocery.handleInput(event)) return;
    if (pages.handleInput(event)) return;
    if (event.target.id === 'notes' && canEdit()) {
      state.data.records[state.date] = { ...recordFor(state.date), notes: event.target.value };
      saveRecords();
    }
  });
  content.addEventListener('change', event => {
    if (wellness && wellness.handleChange(event)) return;
    if (habits && habits.handleChange(event)) return;
    if (dog && dog.handleChange(event)) return;
    if (food && food.handleChange(event)) return;
    if (commerce && commerce.handleChange(event)) return;
    if (grocery.handleChange(event)) return;
    if (pages.handleChange(event)) return;
    if (event.target.id === 'week-jump-date' && !Number.isNaN(parseDate(event.target.value).getTime())) {
      state.week = D.weekStart(event.target.value);
      renderKeepScroll('#week-jump-date');
      return;
    }
    if (event.target.id === 'range-start') state.rangeStart = Number(event.target.value);
    if (event.target.id === 'range-end') state.rangeEnd = Number(event.target.value);
  });
  content.addEventListener('submit', event => {
    if (wellness && wellness.handleSubmit(event)) return;
    if (habits && habits.handleSubmit(event)) return;
    if (dog && dog.handleSubmit(event)) return;
    if(food && food.handleSubmit(event)) return;
    if(commerce && commerce.handleSubmit(event)) return;
    if (!grocery.handleSubmit(event)) pages.handleSubmit(event);
  });
  for (const button of document.querySelectorAll('.view-tab')) button.addEventListener('click', () => changeView(button.dataset.view));
  const appMenu = $('#app-menu');
  const menuButton = $('#menu-btn');
  menuButton.addEventListener('click', () => {
    menuButton.setAttribute('aria-expanded', 'true');
    appMenu.showModal();
  });
  $('#close-menu-btn').addEventListener('click', () => appMenu.close());
  const skillsToggle = $('#menu-skills-toggle');
  const skillsList = $('#menu-skills-list');
  if (skillsToggle && skillsList) {
    skillsToggle.addEventListener('click', () => {
      const open = skillsToggle.getAttribute('aria-expanded') !== 'true';
      skillsToggle.setAttribute('aria-expanded', String(open));
      skillsList.hidden = !open;
    });
    for (const button of skillsList.querySelectorAll('[data-skill-category]')) button.addEventListener('click', () => {
      if (habits && habits.openSkillArea) habits.openSkillArea(button.dataset.skillCategory);
      if (navigate('skills')) {
        renderKeepScroll();
        if (appMenu.open) appMenu.close();
      }
    });
  }
  appMenu.addEventListener('close', () => menuButton.setAttribute('aria-expanded', 'false'));
  for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => {
    const destination = button.dataset.page;
    if (destination === 'food' && button.classList.contains('bottom-nav-button') && food && food.selectTab) {
      food.selectTab('home');
    }
    if (navigate(destination) && appMenu.open) appMenu.close();
  });
  $('#menu-help-btn').addEventListener('click', () => {
    appMenu.close();
    $('#help-dialog').showModal();
  });
  $('#menu-export-btn').addEventListener('click', () => {
    appMenu.close();
    $('#export-btn').click();
  });
  $('#help-btn').addEventListener('click', () => $('#help-dialog').showModal());
  $('#close-help').addEventListener('click', () => $('#help-dialog').close());
  $('#got-it-btn').addEventListener('click', () => $('#help-dialog').close());

  function downloadText(contents, filename) {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  $('#export-btn').addEventListener('click', () => {
    if (!personalAvailable()) { showNotice('Sign in and open your personal journal before exporting it.', true); return; }
    const filenameDate = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (state.readOnly) {
      try {
        const raw = D.STORAGE_KEYS.map(key => storage.getItem(key)).find(value => value !== null);
        if (raw === undefined) throw new Error('No readable stored copy.');
        downloadText(raw, `life-in-bloom-recovery-${filenameDate}.json`);
        showNotice('Your unchanged saved data was downloaded for recovery. Keep this file when asking for help.', true);
      } catch (_) {
        showNotice('This browser could not read a saved copy to export. Please ask for help before changing the browser settings.', true);
      }
      return;
    }
    try {
      downloadText(JSON.stringify(D.makeBackup(state.data), null, 2), `life-in-bloom-backup-${filenameDate}.json`);
      showNotice(state.unsaved ? 'Your latest log changes were included in the downloaded backup. This browser still could not save them.' : 'Your personal backup includes sleep, moods, activities, appointments, the earlier device grocery list, and Ideas. Shared household Grocery records are saved separately online.', state.unsaved);
    } catch (_) {
      showNotice('A backup could not be prepared. Please keep this page open and ask for help.', true);
    }
  });
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!canEdit()) { event.target.value = ''; return; }
    const personalKey = personalState.key;
    if (file.size > 25_000_000) {
      showNotice('This backup is larger than the 25 MB limit for this version. Your entries have not been changed.', true);
      event.target.value = '';
      return;
    }
    try {
      const data = D.parseBackup(await file.text());
      if (!personalAvailable() || personalState.key !== personalKey) throw new Error('The signed-in account changed. Choose this backup again for the correct account.');
      if (pages.hasUnsavedDraft() || grocery.hasUnsavedDraft() || grocery.isBusy()) {
        showNotice('Save your current Grocery or Ideas draft before importing a backup, or use Discard changes on that page.', true);
        return;
      }
      if (!window.confirm('Replace this account’s personal entries on this device with this backup? This replaces sleep, moods, activities, appointments, the earlier device grocery list, and Ideas. Shared household Grocery is unaffected. Export first if you need to keep the current personal entries.')) return;
      D.saveData(storage, data);
      state.data = data;
      state.unsaved = false;
      pages.discardDraft();
      if (!activityFor(state.activityId)) state.activityId = '';
      render();
      showNotice('Your backup was imported. Its sleep, moods, activities, appointments, grocery list, and Ideas notes are available on this device.');
    } catch (error) {
      showNotice(`The backup could not be imported. Your entries have not been replaced. ${error.message || 'Please choose a valid backup file.'}`, true);
    } finally {
      event.target.value = '';
    }
  });

  window.addEventListener('beforeunload', event => {
    if (!state.unsaved && !unsavedJournals.size && !pages.hasUnsavedDraft() && !(draftStore && draftStore.hasFailedWrites()) &&
        !connectedControllers().some(controller => controller.hasUnpersistedChanges && controller.hasUnpersistedChanges()) && !anySaving()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  render();
  if (loaded.warning) showNotice(loaded.warning, true);
  cloud.init().catch(error => showNotice(error.message || 'Grocery could not connect. Please try again.', true));
  window.addEventListener('focus', () => {
    if (cloud.snapshot().user && !anySaving()) cloud.init().catch(() => {});
  });
  // Refresh a daily view after midnight without replacing a form being edited.
  let calendarDay = W ? W.dayKey() : '';
  const checkCalendarDay = () => {
    if (!W) return;
    const next = W.dayKey();
    const editingField = document.activeElement && content.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (next !== calendarDay && !anySaving() && !editingField) { calendarDay = next; renderKeepScroll(); }
  };
  window.addEventListener('focus', checkCalendarDay);
  if (W && typeof window.setInterval === 'function') window.setInterval(checkCalendarDay, 60000);
  if (typeof window.setInterval === 'function') window.setInterval(updateTrashDashboard, 1000);
  window.addEventListener('online', () => cloud.init().catch(() => {}));
  window.addEventListener('offline', () => cloud.refresh().catch(() => {}));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
