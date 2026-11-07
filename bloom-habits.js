/* Private Skills in Bloom and Smoking Log screens. */
(function (root) {
  'use strict';
  const M = root.BloomHabitsModel || (typeof require === 'function' ? require('./bloom-habits-model.js') : null);
  const FIELDS = {
    skill: ['name', 'category', 'memory_type', 'observed_level', 'notes'],
    session: ['skill_id', 'occurred_on', 'minutes', 'result', 'notes'],
    settings: ['baseline_joints', 'baseline_cigars', 'baseline_grams_per_joint', 'price_per_gram', 'cigar_price', 'notes'],
    smoke: ['occurred_on', 'joints', 'cigars', 'grams_per_joint', 'notes'],
    purchase: ['occurred_on', 'amount', 'description', 'payer_slot']
  };
  const REJECTIONS = new Set(['22023', '23502', '23503', '23514', '23505', '40001', '42501']);
  const METHODS = { skill: 'saveSkill', session: 'saveSkillSession', settings: 'saveSmokingSettings', smoke: 'saveSmokingDay', purchase: 'recordMoneyEntry' };
  const PRIVATE_KINDS = ['skill', 'skill_session', 'smoking_settings', 'smoking_day'];
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const money = value => value == null || !Number.isFinite(Number(value)) ? 'Not set' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) / 100);
  const moneyInput = value => value == null ? '' : (Number(value) / 100).toFixed(2);
  const count = value => value == null || !Number.isFinite(Number(value)) ? 'Not recorded' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  function dateLabel(value) { return M.dateNumber(value) == null ? 'Date not recorded' : new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); }
  function text(value, label, maximum, required) {
    const result = String(value == null ? '' : value).trim();
    if (required && !result) throw new Error('Enter ' + label.toLowerCase() + '.');
    if (result.length > maximum) throw new Error(label + ' is too long.');
    return result;
  }
  function number(value, label, minimum, maximum, optional, integer) {
    if (value == null || String(value).trim() === '') { if (optional) return null; throw new Error('Enter ' + label.toLowerCase() + '.'); }
    const result = Number(value);
    if (typeof value === 'boolean' || !Number.isFinite(result) || result < minimum || result > maximum || integer && !Number.isInteger(result)) throw new Error(label + ' must be ' + (integer ? 'a whole number ' : '') + 'from ' + minimum + ' to ' + maximum + '.');
    return result;
  }
  function parseMoney(value, optional) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw && optional) return null;
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter dollars and cents, for example 12.50.');
    const [whole, fraction = ''] = raw.split('.');
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (result > 1000000000) throw new Error('The amount is outside the supported range.');
    return result;
  }
  function baseDraft() { return { id: '', request_id: uuid(), revision: null }; }
  function skillDraft(category = 'piano') { return { ...baseDraft(), name: '', category, memory_type: M.category(category).memory_type, observed_level: '', notes: '' }; }
  function sessionDraft(date) { return { ...baseDraft(), skill_id: '', occurred_on: date, minutes: '', result: 'practice', notes: '' }; }
  function settingsDraft() { return { ...baseDraft(), baseline_joints: '', baseline_cigars: '', baseline_grams_per_joint: '0.5', price_per_gram: '', cigar_price: '', notes: '' }; }
  function smokeDraft(date) { return { ...baseDraft(), occurred_on: date, joints: '0', cigars: '0', grams_per_joint: '0.5', trigger_tags: [], notes: '', reference_snapshot: null }; }
  function purchaseDraft(date) { return { id: uuid(), occurred_on: date, amount: '', description: 'Smoking supplies', payer_slot: '' }; }
  function rowDraft(group, row, date) {
    const result = group === 'skill' ? skillDraft() : group === 'session' ? sessionDraft(date) : group === 'settings' ? settingsDraft() : smokeDraft(date);
    if (!row) return result;
    for (const key of ['id', 'revision', ...FIELDS[group]]) if (Object.hasOwn(row, key)) result[key] = row[key] == null ? '' : copy(row[key]);
    if (group === 'settings') { result.price_per_gram = moneyInput(row.price_per_gram_cents); result.cigar_price = moneyInput(row.cigar_price_cents); }
    if (group === 'smoke') { result.trigger_tags = copy(row.trigger_tags || []); result.reference_snapshot = copy(row.reference_snapshot || {}); }
    return result;
  }
  function createController(options) {
    options = options || {};
    if (!M) throw new Error('Your practice tools could not load. Refresh the app.');
    const store = options.store;
    if (!store || typeof store.snapshot !== 'function') throw new Error('The account store is unavailable.');
    const refresh = options.refresh || (() => {}), notify = options.notify || (() => {}), navigate = options.navigate || (() => {});
    const confirm = options.confirm || (message => typeof root.confirm === 'function' && root.confirm(message));
    const getNow = options.getNow || (() => new Date()), draftStore = options.draftStore || null;
    let identity = '', generation = 0, busy = null, pending = Promise.resolve(), attempt = null, problem = '', backupReview = null;
    let page = 'skills', selectedCategory = 'all', selectedSkillId = '', selectedDate = M.dayKey(getNow()), lastToday = selectedDate;
    let skillOpen = false, sessionOpen = false, settingsOpen = false, purchaseOpen = false, draftSaved = false, draftWarning = false;
    let engineeringHomeworkOpen = false;
    let engineeringHomeworkDraft = { title:'', due_on:'', notes:'' };
    let drafts = makeDrafts(), baselines = copy(drafts), sourceKeys = {};
    function makeDrafts() { return { skill: skillDraft(), session: sessionDraft(selectedDate), settings: settingsDraft(), smoke: smokeDraft(selectedDate), purchase: purchaseDraft(selectedDate) }; }
    const dirty = group => JSON.stringify(drafts[group]) !== JSON.stringify(baselines[group]);
    const anyDirty = () => Object.keys(drafts).some(dirty);
    function privateRows(current, key, includeArchived) {
      const user = current.user && current.user.id;
      const household = current.household && current.household.id;
      return user && household ? (current[key] || []).filter(row => row && row.user_id === user && row.household_id === household && (includeArchived || !row.archived)) : [];
    }
    function settingsRow(current) { return privateRows(current, 'smokingSettings').slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] || null; }
    function dayRow(current, date) { return privateRows(current, 'smokingDays').find(row => row.occurred_on === date) || null; }
    function reset(group, value) { drafts[group] = copy(value); baselines[group] = copy(value); }
    function loadDay(current) {
      const row = dayRow(current, selectedDate);
      const value = rowDraft('smoke', row, selectedDate);
      const settings = settingsRow(current);
      if (!row && settings && settings.baseline_grams_per_joint != null) value.grams_per_joint = settings.baseline_grams_per_joint;
      reset('smoke', value); sourceKeys.smoke = row ? row.id + ':' + row.revision : selectedDate + ':new';
    }
    function restore(saved) {
      if (!saved || saved.version !== 1 || !saved.drafts || !saved.baselines) return false;
      for (const group of Object.keys(drafts)) {
        for (const target of ['drafts', 'baselines']) {
          const value = saved[target][group];
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const result = copy(target === 'drafts' ? drafts[group] : baselines[group]);
          for (const key of Object.keys(result)) if (Object.hasOwn(value, key)) result[key] = copy(value[key]);
          if (group === 'smoke') {
            result.trigger_tags = Array.isArray(result.trigger_tags) ? result.trigger_tags.filter(tag => M.TRIGGERS.some(item => item.key === tag)) : [];
            if (!result.reference_snapshot || typeof result.reference_snapshot !== 'object' || Array.isArray(result.reference_snapshot)) result.reference_snapshot = null;
          }
          if (target === 'drafts') drafts[group] = result; else baselines[group] = result;
        }
      }
      if (M.dateNumber(saved.selectedDate) != null) selectedDate = saved.selectedDate;
      if (saved.selectedCategory === 'all' || M.CATEGORIES.some(item => item.key === saved.selectedCategory)) selectedCategory = saved.selectedCategory;
      selectedSkillId = typeof saved.selectedSkillId === 'string' ? saved.selectedSkillId : '';
      skillOpen = Boolean(saved.skillOpen); sessionOpen = Boolean(saved.sessionOpen); settingsOpen = Boolean(saved.settingsOpen); purchaseOpen = Boolean(saved.purchaseOpen);
      if (saved.attempt && saved.attempt.payload && (['save', 'archive'].includes(saved.attempt.action) && Object.keys(drafts).includes(saved.attempt.group) || saved.attempt.action === 'import' && saved.attempt.group === 'backup')) attempt = copy(saved.attempt);
      problem = typeof saved.problem === 'string' ? saved.problem : '';
      return true;
    }
    function snapshot() {
      const current = store.snapshot() || {};
      const key = (current.user && current.user.id || '') + ':' + (current.household && current.household.id || '');
      const today = M.dayKey(getNow());
      if (key !== identity) {
        identity = key; generation++; busy = null; attempt = null; problem = ''; backupReview = null; selectedDate = today; lastToday = today; selectedCategory = 'all'; selectedSkillId = '';
        skillOpen = false; sessionOpen = false; settingsOpen = false; purchaseOpen = false; draftSaved = false; draftWarning = false; engineeringHomeworkOpen = false; engineeringHomeworkDraft = { title:'', due_on:'', notes:'' };
        drafts = makeDrafts(); baselines = copy(drafts); sourceKeys = {};
        const settings = settingsRow(current); reset('settings', rowDraft('settings', settings, today)); sourceKeys.settings = settings ? settings.id + ':' + settings.revision : 'new';
        loadDay(current);
        if (draftStore && current.user && current.household) {
          try { const saved = draftStore.read(current.user.id, current.household.id, 'habits'); draftSaved = Boolean(saved && restore(saved.data)); }
          catch (_) { notify('Your saved practice draft could not be opened. Its stored copy has not been changed.', true); }
        }
      } else {
        if (today !== lastToday) {
          if (selectedDate === lastToday && !busy && !attempt && !anyDirty()) { selectedDate = today; loadDay(current); reset('session', sessionDraft(today)); reset('purchase', purchaseDraft(today)); }
          lastToday = today;
        }
        const settings = settingsRow(current), settingsKey = settings ? settings.id + ':' + settings.revision : 'new';
        if (!dirty('settings') && !(attempt && attempt.group === 'settings') && sourceKeys.settings !== settingsKey) { reset('settings', rowDraft('settings', settings, today)); sourceKeys.settings = settingsKey; }
        const row = dayRow(current, selectedDate), dayKey = row ? row.id + ':' + row.revision : selectedDate + ':new';
        if (!dirty('smoke') && !(attempt && attempt.group === 'smoke') && sourceKeys.smoke !== dayKey) loadDay(current);
      }
      return current;
    }
    function indicators() {
      if (!root.document || typeof root.document.querySelector !== 'function') return;
      const target = root.document.querySelector('[data-habits-draft-status]');
      if (target) { target.hidden = !anyDirty() && !attempt; target.textContent = draftSaved ? 'Draft saved on this device. Choose Save to add it to your records.' : 'Draft in progress. Keep this page open until it is saved.'; }
    }
    function persist() {
      const current = store.snapshot() || {};
      if (!draftStore || !current.user || !current.household) { indicators(); return; }
      try {
        const changed = anyDirty() || Boolean(attempt);
        const ok = changed ? draftStore.write(current.user.id, current.household.id, 'habits', { version: 1, drafts, baselines, attempt, problem, selectedDate, selectedCategory, selectedSkillId, skillOpen, sessionOpen, settingsOpen, purchaseOpen }) : draftStore.clear(current.user.id, current.household.id, 'habits');
        draftSaved = changed && ok !== false;
        if (ok === false && !draftWarning) { draftWarning = true; notify('This browser could not save your draft. Keep this page open until you save online.', true); }
      } catch (_) { draftSaved = false; if (!draftWarning) { draftWarning = true; notify('Your draft could not be stored on this device. Keep the page open until you save online.', true); } }
      indicators();
    }
    function requireReady(current) {
      if (!current.user || !current.household || current.status !== 'ready') throw new Error('Open Grocery and sign in to your household first.');
      if (current.offline) throw new Error('You are offline. Your draft stays on this device. Reconnect to save it online.');
    }
    function run(label, work, success, onError, focus) {
      if (busy) return false;
      const token = generation; busy = { label, token }; refresh();
      pending = Promise.resolve().then(() => { snapshot(); if (token !== generation) return; return work(); }).then(value => { snapshot(); if (token !== generation) return; if (success) success(value); persist(); }).catch(error => { snapshot(); if (token !== generation) return; if (onError) onError(error); persist(); notify(error && error.message || 'This entry could not be saved. Your draft is still here.', true); }).finally(() => { snapshot(); if (token !== generation) return; busy = null; refresh(focus); });
      return true;
    }
    function locked(group) { return Boolean(busy || attempt && (attempt.group === group || attempt.action === 'archive' || attempt.action === 'import')); }
    function button(action, label, attrs, primary, disabled) { return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-habit-action="' + action + '"' + (attrs || '') + (busy || disabled ? ' disabled' : '') + '>' + label + '</button>'; }
    function field(group, name, label, type, attrs) { return '<label class="habit-field" for="habit-' + group + '-' + name + '"><span>' + label + '</span><input id="habit-' + group + '-' + name + '" name="' + name + '" type="' + (type || 'text') + '" data-habit-field="' + group + '.' + name + '" value="' + esc(drafts[group][name]) + '"' + (attrs || '') + (locked(group) ? ' disabled' : '') + '></label>'; }
    function select(group, name, label, choices) { return '<label class="habit-field" for="habit-' + group + '-' + name + '"><span>' + label + '</span><select id="habit-' + group + '-' + name + '" name="' + name + '" data-habit-field="' + group + '.' + name + '"' + (locked(group) ? ' disabled' : '') + '>' + choices.map(([value, title]) => '<option value="' + esc(value) + '"' + (String(value) === String(drafts[group][name]) ? ' selected' : '') + '>' + esc(title) + '</option>').join('') + '</select></label>'; }
    function textarea(group, name, label, maximum) { return '<label class="habit-field" for="habit-' + group + '-' + name + '"><span>' + label + '</span><textarea id="habit-' + group + '-' + name + '" name="' + name + '" data-habit-field="' + group + '.' + name + '" maxlength="' + maximum + '" rows="3"' + (locked(group) ? ' disabled' : '') + '>' + esc(drafts[group][name]) + '</textarea></label>'; }
    function saveButtons(group, label, current) { return '<div class="habit-actions"><button type="submit" class="button primary"' + (busy || current.offline || attempt && attempt.group !== group ? ' disabled' : '') + '>' + (attempt && attempt.group === group && attempt.action === 'save' ? 'Retry the same save' : label) + '</button>' + button('discard', 'Discard draft', ' data-group="' + group + '"', false, Boolean(attempt)) + '</div>'; }
    function status() { return '<p class="habit-draft-status" data-habits-draft-status role="status"' + (!anyDirty() && !attempt ? ' hidden' : '') + '>' + (draftSaved ? 'Draft saved on this device. Choose Save to add it to your records.' : 'Draft in progress. Keep this page open until it is saved.') + '</p>'; }
    function renderSkillForm(current) {
      return '<section class="panel" id="habit-skill-editor"><p class="page-kicker">One thing to grow</p><h2>' + (drafts.skill.id ? 'Edit your skill' : 'Add a skill or topic') + '</h2><p class="habit-help">Keep it specific: a piano scale, a sewing technique, a math topic, or a chapter you want to remember.</p><form class="habit-form" data-habit-form="skill">' + field('skill', 'name', 'Skill or topic name', 'text', ' maxlength="160" required placeholder="For example, C major scale"') + '<div class="habit-form-grid">' + select('skill', 'category', 'Area', M.CATEGORIES.map(item => [item.key, item.icon + ' ' + item.label])) + select('skill', 'memory_type', 'What are you practising?', [['procedural', 'A practical or movement skill'], ['knowledge', 'Facts, ideas or knowledge'], ['mixed', 'A mix of both']]) + '</div>' + field('skill', 'observed_level', 'Your observed level · 1–10 (optional)', 'number', ' min="1" max="10" step="1" inputmode="numeric" placeholder="Your own assessment"') + '<p class="habit-help">Your assessment stays as you entered it. The separate review estimate helps choose when to revisit this topic.</p>' + textarea('skill', 'notes', 'What would progress look like? (optional)', 2000) + saveButtons('skill', 'Save skill', current) + '</form></section>';
    }
    function renderSessionForm(current) {
      const skills = privateRows(current, 'skills', true).filter(row => !row.archived || row.id === drafts.session.skill_id);
      return '<section class="panel" id="habit-session-editor"><p class="page-kicker">A little practice counts</p><h2>' + (drafts.session.id ? 'Edit practice entry' : 'Log practice') + '</h2><form class="habit-form" data-habit-form="session">' + select('session', 'skill_id', 'Skill or topic', [['', 'Choose a saved skill'], ...skills.map(row => [row.id, row.name])]) + '<div class="habit-form-grid">' + field('session', 'occurred_on', 'Practice date', 'date', ' required min="1900-01-01" max="' + M.dayKey(getNow()) + '"') + field('session', 'minutes', 'Minutes practised', 'number', ' required min="0" max="1440" step="any" inputmode="decimal"') + '</div>' + select('session', 'result', 'How did your recall or performance check go?', M.REVIEW_RESULTS.map(item => [item.key, item.label])) + '<p class="habit-help">Try a short challenge without looking at the answer, or perform the technique. Choose Practice only if you did not check it. A practice-only entry records your time without claiming a successful recall.</p>' + textarea('session', 'notes', 'What did you practise or notice? (optional)', 2000) + saveButtons('session', 'Save practice', current) + '</form></section>';
    }
    function renderSkillCard(skill, current) {
      const value = M.skillProgress(skill, privateRows(current, 'skillSessions'), M.dayKey(getNow()));
      const category = M.category(skill.category);
      return '<article class="habit-skill-card"><div class="habit-heading"><span class="habit-category-icon" aria-hidden="true">' + category.icon + '</span><div><small>' + esc(category.label) + '</small><h3>' + esc(skill.name) + '</h3></div><span class="habit-badge' + (value.due ? ' is-due' : '') + '">' + (value.due ? 'Ready for a revisit' : value.next_review_on ? 'Next · ' + esc(dateLabel(value.next_review_on)) : 'Start with a check') + '</span></div><div class="habit-score-pair"><div><span>Your observed level</span><strong>' + (value.observed_level == null ? 'Not set' : value.observed_level + '<small> / 10</small>') + '</strong></div><div><span>Review readiness estimate</span><strong>' + (value.score == null ? 'Not estimated' : '≈ ' + value.score + '<small> / 10</small>') + '</strong></div></div><p class="habit-help">' + esc(count(value.minutes)) + ' minutes · ' + value.sessions + ' saved session' + (value.sessions === 1 ? '' : 's') + (value.last_practice_on ? ' · Last practised ' + esc(dateLabel(value.last_practice_on)) : '') + '</p>' + (skill.notes ? '<p class="habit-prose">' + esc(skill.notes) + '</p>' : '') + '<div class="habit-actions">' + button('log-skill', 'Log practice', ' data-id="' + esc(skill.id) + '"', true, Boolean(attempt)) + button('skill-history', 'History', ' data-id="' + esc(skill.id) + '"') + button('edit-skill', 'Edit', ' data-id="' + esc(skill.id) + '"', false, Boolean(attempt)) + button('archive', 'Archive', ' data-kind="skill" data-id="' + esc(skill.id) + '"', false, Boolean(attempt) || current.offline) + '</div></article>';
    }
    function renderSkillHistory(current) {
      const skill = privateRows(current, 'skills', true).find(row => row.id === selectedSkillId);
      if (!skill) return '';
      const sessions = privateRows(current, 'skillSessions', true).filter(row => row.skill_id === skill.id).slice().sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return '<section class="panel" id="habit-skill-history"><div class="habit-heading"><div><p class="page-kicker">Your saved practice</p><h2>' + esc(skill.name) + '</h2></div>' + button('close-history', 'Close history') + '</div>' + (sessions.length ? '<ul class="habit-history-list">' + sessions.map(row => '<li' + (row.archived ? ' class="is-archived"' : '') + '><div><strong>' + esc(dateLabel(row.occurred_on)) + ' · ' + esc(count(row.minutes)) + ' min</strong><p>' + esc((M.REVIEW_RESULTS.find(item => item.key === row.result) || {}).label || row.result) + (row.archived ? ' · Archived' : '') + '</p>' + (row.notes ? '<p class="habit-prose">' + esc(row.notes) + '</p>' : '') + '</div>' + (!row.archived ? '<div class="habit-actions">' + button('edit-session', 'Edit entry', ' data-id="' + esc(row.id) + '"', false, Boolean(attempt)) + button('archive', 'Remove mistaken entry', ' data-kind="skill_session" data-id="' + esc(row.id) + '"', false, Boolean(attempt) || current.offline) + '</div>' : '') + '</li>').join('') + '</ul>' : '<p class="habit-empty">No practice entries yet.</p>') + '</section>';
    }
    function engineeringHomeworkRows(current) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current.engineeringHomework||[]).filter(row=>row&&row.user_id===user&&row.household_id===household)
        .sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||String(a.due_on||'9999-12-31').localeCompare(String(b.due_on||'9999-12-31'))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
    }
    function engineeringFileRows(current) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current.engineeringFiles||[]).filter(row=>row&&row.user_id===user&&row.household_id===household)
        .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    }
    function hydrateEngineeringFiles(files) {
      if (!root.document || !store.getEngineeringFileUrl || !Array.isArray(files)) return;
      for (const file of files) {
        if (!/^image\//.test(file.mime_type||'')) continue;
        const img=root.document.querySelector('[data-engineering-file-preview="'+file.id+'"]');
        if (!img || img.dataset.loaded==='true') continue;
        Promise.resolve(store.getEngineeringFileUrl(file)).then(url=>{
          const live=root.document&&root.document.querySelector('[data-engineering-file-preview="'+file.id+'"]');
          if(live){ live.src=url; live.dataset.loaded='true'; }
        }).catch(()=>{});
      }
    }
    function renderEngineeringDashboard(current, skills, sessions, today) {
      const engineeringSkills=skills.filter(skill=>skill.category==='engineering');
      const ids=new Set(engineeringSkills.map(skill=>skill.id));
      const engineeringSessions=sessions.filter(row=>ids.has(row.skill_id));
      const month=today.slice(0,7), weekAgo=M.addDays(today,-6);
      const monthMinutes=engineeringSessions.filter(row=>String(row.occurred_on||'').slice(0,7)===month).reduce((sum,row)=>sum+Number(row.minutes||0),0);
      const weekMinutes=engineeringSessions.filter(row=>row.occurred_on>=weekAgo&&row.occurred_on<=today).reduce((sum,row)=>sum+Number(row.minutes||0),0);
      const due=engineeringSkills.filter(skill=>M.skillProgress(skill,engineeringSessions,today).due).length;
      const observed=engineeringSkills.map(skill=>M.skillProgress(skill,engineeringSessions,today).observed_level).filter(Number.isFinite);
      const overall=observed.length?Math.round(observed.reduce((a,b)=>a+b,0)/observed.length*10):0;
      const tutorUrl='https://preply.com/en/tutor/6360685?utm_source=friend_plg&utm_medium=app_native&utm_campaign=stu_plg_st_all_0_mul_xx_multiplesub_share-tutor-profile-1&utm_content=NDYyMTQ4Ng%3D%3D&adj_t=20yroq7d&adj_campaign=stu_plg_st_all_0_mul_xx_multiplesub_share-tutor-profile-1';
      const homework=engineeringHomeworkRows(current), files=engineeringFileRows(current);
      const openHomework=homework.filter(row=>row.status!=='done').length;
      const vocab=[
        ['📡','Ultrasonic Sensor','Measures distance by sending sound pulses and timing their echo.'],
        ['🧊','Tinkercad','A web app for 3D design and simple electronics simulation.'],
        ['⚙️','Actuator','A device that turns a control signal into physical action or movement.'],
        ['👁️','Sensor','Detects a change in the environment and provides data to a system.'],
        ['🧠','Microcontroller','A small programmable computer that reads inputs and controls outputs.'],
        ['🧪','Wokwi','A browser simulator for microcontrollers, circuits, and embedded code.'],
        ['💻','VS Code','A code editor for writing, organizing, and debugging project code.']
      ];
      const lab=[
        ['🧰','ELEGOO Mega 2560 R3 Starter Kit','Arduino-compatible board, sensors, displays, motors, and guided projects.'],
        ['🔌','ELEGOO Breadboard Electronics Kit','Breadboards, LEDs, resistors, capacitors, switches, and jumper wires.'],
        ['🔋','4-AA Battery Holder + Switch','Portable 6V holder for small electronics prototypes.'],
        ['🔋','AA Batteries','Portable power for experiments and small builds.'],
        ['🛠️','Soldering & Test Tools','Multimeter, soldering iron, fume absorber, crimpers, cutters, and hand tools.']
      ];
      const projects=[
        ['🔒','ATM Savings Lockbox','In Progress','Mechanical enclosure + electronics + programmable locking logic.'],
        ['💡','LED Blink / Arduino Basics','Practice','First code-driven circuits and microcontroller workflow.'],
        ['📡','Ultrasonic Distance Sensor','Next Build','Sensor input, distance measurement, and output/debugging.'],
        ['🌫️','Programmable Scent Synthesizer','Proposal','Three-channel mechatronics project with ESP32, servos, blower, and 3D enclosure.'],
        ['🐾','Robot Dog','Long-Term','Robotics, actuators, sensors, mechanics, embedded control, and autonomy.']
      ];
      const proposal='<section class="panel engineering-proposal"><div class="habit-heading"><div><p class="page-kicker">Project proposal</p><h2>Programmable Scent Synthesizer — Prototype 1</h2><p class="habit-help">A learning-focused three-channel mechatronics build using an ESP32, servo-driven sprayers, airflow control, and a custom 3D-printed enclosure.</p></div><span class="habit-badge">Proposed</span></div><div class="engineering-proposal-grid"><div class="engineering-proposal-icon" aria-hidden="true">🌫️</div><ul><li>3 independent 30 mL scent channels</li><li>ESP32 + PCA9685 + servo control</li><li>Blower delivery and purge cycle</li><li>Physical buttons and programmed recipes</li><li>Custom serviceable 3D-printed enclosure</li><li>12-week learning plan · about 24 active hours</li></ul></div><details><summary>What I want to learn from this project</summary><p>Electronics fundamentals, safe power distribution, ESP32 programming, C/C++, I2C, PWM, servo and MOSFET control, multimeter use, breadboard prototyping, soldering, debugging, CAD, and converting a prototype into permanent hardware.</p></details></section>';

      let homeworkHtml='<section class="panel engineering-homework" id="engineering-homework"><div class="habit-heading"><div><p class="page-kicker">Homework & whiteboard uploads</p><h2>Homework & Saved Files</h2><p class="habit-help">Keep tutor assignments, whiteboard snapshots, circuit photos, sketches, and PDFs with your Engineering dashboard.</p></div><span class="habit-badge">'+openHomework+' open</span></div><div class="engineering-homework-actions">'+button('engineering-homework-add','+ Add homework','',true,current.offline)+'<label class="button engineering-upload-button">⇧ Upload pictures / PDF<input type="file" data-engineering-upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden'+(busy||current.offline?' disabled':'')+'></label></div>';
      if(engineeringHomeworkOpen) homeworkHtml+='<form class="engineering-homework-form" data-engineering-homework-form><div class="habit-form-grid"><label class="habit-field"><span>Homework</span><input type="text" maxlength="200" required data-engineering-homework-field="title" value="'+esc(engineeringHomeworkDraft.title)+'" placeholder="For example, Build the ultrasonic sensor circuit"></label><label class="habit-field"><span>Due date (optional)</span><input type="date" data-engineering-homework-field="due_on" value="'+esc(engineeringHomeworkDraft.due_on)+'"></label></div><label class="habit-field"><span>Notes (optional)</span><textarea maxlength="5000" rows="3" data-engineering-homework-field="notes">'+esc(engineeringHomeworkDraft.notes)+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save homework</button>'+button('engineering-homework-cancel','Cancel')+'</div></form>';
      homeworkHtml+='<div class="engineering-homework-list">'+(homework.length?homework.map(row=>'<article class="'+(row.status==='done'?'is-done':'')+'"><label><input type="checkbox" data-habit-action="engineering-homework-toggle" data-id="'+esc(row.id)+'"'+(row.status==='done'?' checked':'')+'><span><strong>'+esc(row.title)+'</strong><small>'+(row.due_on?'Due '+esc(dateLabel(row.due_on)):'No due date')+(row.notes?' · '+esc(row.notes):'')+'</small></span></label>'+button('engineering-homework-delete','Remove',' data-id="'+esc(row.id)+'"')+'</article>').join(''):'<p class="habit-help">No Engineering homework saved yet.</p>')+'</div>';
      homeworkHtml+='<div class="engineering-file-grid">'+(files.length?files.map(file=>'<article class="engineering-file-card">'+(/^image\//.test(file.mime_type||'')?'<div class="engineering-file-preview"><img alt="" data-engineering-file-preview="'+esc(file.id)+'"></div>':'<div class="engineering-file-preview is-pdf">PDF</div>')+'<strong>'+esc(file.name)+'</strong><small>'+esc((Number(file.size_bytes||0)/1024/1024).toFixed(1))+' MB</small><div class="habit-actions">'+button('engineering-file-open','Open',' data-id="'+esc(file.id)+'"',true,current.offline)+button('engineering-file-delete','Delete',' data-id="'+esc(file.id)+'"',false,current.offline)+'</div></article>').join(''):'<p class="habit-help">Upload a whiteboard photo, wiring sketch, homework image, or PDF to start your file shelf.</p>')+'</div></section>';

      const html='<section class="engineering-dashboard">'
        + '<section class="engineering-banner"><div><p class="page-kicker">Skills in Bloom</p><h2>Engineering</h2><p>Build · Design · Prototype · Learn</p></div><span aria-hidden="true">⚙️</span></section>'
        + '<div class="engineering-top-grid"><section class="panel engineering-goal"><p class="page-kicker">My engineering goal</p><h2>Build toward independent engineering work</h2><p class="habit-help">Strengthen electronics, programming, mechanical design, fabrication, and systems thinking through real projects and college preparation.</p></section><section class="panel engineering-progress"><p class="page-kicker">Overall progress</p><h2>'+(observed.length?overall+'%':'Start tracking')+'</h2><div class="engineering-progress-bar"><span style="width:'+overall+'%"></span></div><p class="habit-help">Foundation → Applied → Projects → Independent</p></section><section class="panel engineering-quick"><p class="page-kicker">Quick actions</p>'+button('new-skill','+ Add Practice Topic','',true,Boolean(attempt))+button('engineering-homework-add','+ Add Homework','')+'</section></div>'
        + '<div class="engineering-three-col"><section class="panel engineering-tutor-card"><p class="page-kicker">My tutor</p><div class="engineering-tutor-profile"><span class="engineering-tutor-avatar" aria-hidden="true">🧑‍🏫</span><div><h2>Engineering Tutor</h2><p>Standing tutoring support</p></div></div><a class="button primary" href="'+esc(tutorUrl)+'" target="_blank" rel="noopener noreferrer">Open Tutor Profile (Preply) ↗</a></section><section class="panel engineering-appointment"><p class="page-kicker">Tutor appointment</p><h2>Standing Appointment</h2><p class="habit-help">Recurring engineering support for concepts, troubleshooting, and project planning.</p><a class="engineering-text-link" href="'+esc(tutorUrl)+'" target="_blank" rel="noopener noreferrer">Tutor profile ↗</a></section>'+proposal+'</div>'
        + '<div class="engineering-two-col"><section class="panel engineering-roadmap"><p class="page-kicker">My learning path</p><h2>10-Year Engineering Roadmap</h2><div class="engineering-timeline"><article><b>1</b><div><h3>Foundations · Now–3 months</h3><p>Electronics basics, math/science refresh, terminology, simple circuits.</p></div></article><article><b>2</b><div><h3>Core Skills · 3–12 months</h3><p>Circuit design, microcontrollers, Tinkercad/CAD, coding, breadboarding.</p></div></article><article><b>3</b><div><h3>Systems & Design · Years 2–4</h3><p>Sensors, actuators, controls, CAD, prototyping, integration.</p></div></article><article><b>4</b><div><h3>Advanced Projects · Years 5–7</h3><p>Complex builds, mechanical systems, robotics, real-world projects.</p></div></article><article><b>5</b><div><h3>Professional Readiness · Years 8–10</h3><p>Portfolio, advanced engineering focus, college/career preparation.</p></div></article></div></section><section class="panel engineering-vocab"><p class="page-kicker">Key terms & vocabulary</p><h2>Concepts to Master</h2><div class="engineering-vocab-list">'+vocab.map(row=>'<details><summary><span>'+row[0]+'</span><strong>'+esc(row[1])+'</strong></summary><p>'+esc(row[2])+'</p></details>').join('')+'</div></section></div>'
        + homeworkHtml
        + '<section class="panel engineering-lab"><div class="habit-heading"><div><p class="page-kicker">My engineering kit & tools</p><h2>My Engineering Lab</h2><p class="habit-help">Equipment already available for hands-on learning and prototypes.</p></div></div><div class="engineering-lab-grid">'+lab.map(row=>'<article><span>'+row[0]+'</span><h3>'+esc(row[1])+'</h3><p>'+esc(row[2])+'</p><small>✓ Owned</small></article>').join('')+'</div></section>'
        + '<div class="engineering-bottom-grid"><section class="panel engineering-focus"><p class="page-kicker">Current focus · 12 weeks</p><h2>What I’m Working On Now</h2><label><input type="checkbox"> Learn the key terminology</label><label><input type="checkbox"> Complete guided ELEGOO circuits</label><label><input type="checkbox"> Practice in Tinkercad</label><label><input type="checkbox"> Try a project in Wokwi</label><label><input type="checkbox"> Set up VS Code for embedded work</label><label><input type="checkbox"> Weekly tutor practice & review</label></section><section class="panel engineering-projects"><p class="page-kicker">Practice & projects</p><h2>Build Portfolio</h2><div class="engineering-project-grid">'+projects.map(row=>'<article><span>'+row[0]+'</span><h3>'+esc(row[1])+'</h3><b>'+esc(row[2])+'</b><p>'+esc(row[3])+'</p></article>').join('')+'</div></section><section class="panel engineering-college"><p class="page-kicker">College readiness</p><h2>Ready for the Next Level</h2><label><input type="checkbox"> Math review · Algebra → Calculus</label><label><input type="checkbox"> Physics basics · mechanics & circuits</label><label><input type="checkbox"> Chemistry review as needed</label><label><input type="checkbox"> Reading & technical writing</label><label><input type="checkbox"> Build a project portfolio</label><label><input type="checkbox"> Research engineering programs</label></section></div>'
        + '<section class="panel engineering-stats"><div class="engineering-metrics"><div><span>⚙️</span><strong>'+engineeringSkills.length+'</strong><small>saved engineering topics</small></div><div><span>⏱️</span><strong>'+esc(count(weekMinutes))+' min</strong><small>practice this week</small></div><div><span>📚</span><strong>'+esc(count(monthMinutes))+' min</strong><small>practice this month</small></div><div><span>↻</span><strong>'+due+'</strong><small>ready to revisit</small></div></div></section>'
        + '</section>';
      if(root.requestAnimationFrame) root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>hydrateEngineeringFiles(files)));
      else hydrateEngineeringFiles(files);
      return html;
    }
    function renderSkills(current) {
      const skills = privateRows(current, 'skills'), sessions = privateRows(current, 'skillSessions'), today = M.dayKey(getNow());
      const due = skills.filter(skill => M.skillProgress(skill, sessions, today).due);
      const visible = skills.filter(skill => selectedCategory === 'all' || skill.category === selectedCategory).sort((a, b) => Number(M.skillProgress(b, sessions, today).due) - Number(M.skillProgress(a, sessions, today).due) || a.name.localeCompare(b.name));
      let html = '<section class="panel habit-intro"><div class="habit-heading"><div><p class="page-kicker">Your curiosity, in bloom</p><h2>Skills in Bloom</h2><p class="habit-help">Keep the things you learn. Make room for the next small practice.</p></div>' + button('new-skill', '+ Add a skill', '', true, Boolean(attempt)) + '</div><div class="habit-summary-strip"><span><strong>' + skills.length + '</strong> saved skills</span><span><strong>' + due.length + '</strong> ready to revisit</span><span><strong>' + esc(count(sessions.filter(row => row.occurred_on === today).reduce((sum, row) => sum + Number(row.minutes || 0), 0))) + '</strong> minutes today</span></div></section>';
      if (selectedCategory === 'all') {
        html += '<nav class="habit-category-grid" aria-label="Skill areas">' + M.CATEGORIES.map(category => '<button type="button" data-habit-action="category" data-category="' + category.key + '" aria-pressed="false"><span aria-hidden="true">' + category.icon + '</span><strong>' + category.label + '</strong><small>' + skills.filter(row => row.category === category.key).length + ' saved</small></button>').join('') + '</nav>';
      } else {
        const area=M.category(selectedCategory);
        html += '<section class="panel habit-area-header"><div class="habit-heading"><div><p class="page-kicker">Skills in Bloom · '+esc(area.label)+'</p><h2><span aria-hidden="true">'+area.icon+'</span> '+esc(area.label)+'</h2><p class="habit-help">Your saved '+esc(area.label.toLowerCase())+' topics, practice records, and review reminders.</p></div>'+button('category','← All Skills',' data-category="all"')+'</div></section>';
      }
      if (selectedCategory === 'engineering') html += renderEngineeringDashboard(current, skills, sessions, today);
      if (skillOpen) html += renderSkillForm(current);
      if (sessionOpen) html += renderSessionForm(current);
      html += '<section class="panel"><div class="habit-heading"><h2>' + (selectedCategory === 'all' ? 'Your practice garden' : selectedCategory === 'engineering' ? 'Engineering Topics & Practice' : esc(M.category(selectedCategory).label)) + '</h2>' + (dirty('skill') && !skillOpen ? button('resume', 'Resume skill draft', ' data-group="skill"') : '') + (dirty('session') && !sessionOpen ? button('resume', 'Resume practice draft', ' data-group="session"') : '') + '</div>' + (visible.length ? '<div class="habit-skill-grid">' + visible.map(skill => renderSkillCard(skill, current)).join('') + '</div>' : '<div class="habit-empty"><span aria-hidden="true">🌱</span><h3>Choose something you want to grow</h3><p>Add a specific skill, then record a short practice or recall check. Categories begin empty until you add your own topics.</p>' + button('new-skill', '+ Add a skill', '', true, Boolean(attempt)) + '</div>') + '</section>';
      html += renderSkillHistory(current);
      html += '<section class="panel habit-explainer"><details><summary>How the review estimate works</summary><p class="habit-help">Successful checks on separate days expand the suggested interval through 1, 3, 7, 14 and 30 days, then longer intervals. Hard or unsuccessful checks bring the next revisit closer. Several checks on the same day count as one review day for scheduling.</p><p class="habit-help">The 1–10 number is a <strong>review readiness estimate</strong> from a simple decay model. It is a planning aid, not a measured recall probability, a validated ability score, or a claim that you lost a percentage of your skill. Your observed level stays separate. Practical skills and factual knowledge may need different kinds of checks.</p><p class="habit-help">Due dates appear here while the app is open. This screen does not send phone notifications in the background.</p></details></section>';
      const archived = privateRows(current, 'skills', true).filter(row => row.archived);
      if (archived.length) html += '<section class="panel"><details><summary>Archived skills · ' + archived.length + '</summary><ul class="habit-history-list">' + archived.map(row => '<li><strong>' + esc(row.name) + '</strong>' + button('skill-history', 'View retained history', ' data-id="' + esc(row.id) + '"') + '</li>').join('') + '</ul></details></section>';
      return html;
    }
    function referenceForDay(current) { return drafts.smoke.id && drafts.smoke.reference_snapshot ? drafts.smoke.reference_snapshot : settingsRow(current) || {}; }
    function renderSmokingPreview(current) {
      const comparison = M.smokingComparison(drafts.smoke, referenceForDay(current));
      const daily = comparison.daily, savings = comparison.savings_cents;
      return '<div class="habit-money-grid"><div><span>Estimated daily cost</span><strong>' + (daily.cost_cents == null ? 'Add prices' : money(daily.cost_cents)) + '</strong><small>' + (daily.cost_cents == null ? 'Known subtotal: ' + money(daily.known_cents) : '30-day projection: ' + money(daily.thirty_day_cents)) + '</small></div><div><span>' + (savings != null && savings < 0 ? 'Estimated increase vs. original plan' : 'Estimated savings vs. original plan') + '</span><strong class="' + (savings != null && savings >= 0 ? 'habit-savings' : '') + '">' + (savings == null ? 'Set a baseline' : money(Math.abs(savings))) + '</strong><small>Reference-price comparison</small></div></div>' + (daily.missing.length ? '<p class="habit-help">Still needed: ' + daily.missing.map(esc).join(', ') + '.</p>' : '') + '<p class="habit-help">These are estimates for the quantities shown. The 30-day figure repeats one day’s estimate; your actual month contains only saved days.</p>';
    }
    function renderRange(name, label, maximum, current) {
      const value = drafts.smoke[name], high = Math.max(maximum, Number(value) || 0, Number(referenceForDay(current)['baseline_' + name]) || 0);
      return '<div class="habit-slider-block"><div class="habit-slider-heading"><label for="habit-range-' + name + '">' + label + '</label><input aria-label="' + label + ' exact count" type="number" name="' + name + '" min="0" max="1000" step="1" inputmode="numeric" data-habit-field="smoke.' + name + '" value="' + esc(value) + '"' + (locked('smoke') ? ' disabled' : '') + '></div><input id="habit-range-' + name + '" type="range" min="0" max="' + high + '" step="1" data-habit-range="' + name + '" value="' + esc(value) + '"' + (locked('smoke') ? ' disabled' : '') + '><div class="habit-range-labels" aria-hidden="true"><span>0</span><span>' + high + '</span></div></div>';
    }
    function renderSmokingSettings(current) {
      return '<section class="panel" id="habit-smoking-settings"><div class="habit-heading"><div><p class="page-kicker">Your own reference values</p><h2>Prices & original plan</h2></div>' + button('close-settings', 'Close for now') + '</div><p class="habit-help">Enter the prices and original daily quantities you want to compare with. A blank value stays unknown. These settings do not create a smoking entry or a purchase.</p><form class="habit-form" data-habit-form="settings"><div class="habit-form-grid">' + field('settings', 'price_per_gram', 'Cannabis price per gram ($)', 'text', ' inputmode="decimal" placeholder="Unknown"') + field('settings', 'cigar_price', 'Price per Jazz / Black & Mild ($)', 'text', ' inputmode="decimal" placeholder="Unknown"') + field('settings', 'baseline_joints', 'Original joints per day', 'number', ' min="0" max="1000" step="1" inputmode="numeric" placeholder="Not set"') + field('settings', 'baseline_cigars', 'Original Jazz / Black & Milds per day', 'number', ' min="0" max="1000" step="1" inputmode="numeric" placeholder="Not set"') + field('settings', 'baseline_grams_per_joint', 'Original grams per joint', 'number', ' required min="0.01" max="10" step="any" inputmode="decimal"') + '</div>' + textarea('settings', 'notes', 'Reference source or notes (optional)', 1000) + '<p class="habit-help">Previously saved days keep the reference prices used when they were first recorded. A new price applies to new daily entries.</p>' + saveButtons('settings', 'Save reference values', current) + '</form></section>';
    }
    function renderPurchaseForm(current) {
      return '<section class="panel" id="habit-purchase-editor"><p class="page-kicker">An actual purchase</p><h2>Record smoking supplies</h2><p class="habit-help">Use the amount you actually paid. Saving adds one expense to your shared Money in Bloom ledger. The smoking estimates above do not post spending.</p><form class="habit-form" data-habit-form="purchase"><div class="habit-form-grid">' + field('purchase', 'occurred_on', 'Purchase date', 'date', ' required min="1900-01-01" max="' + M.dayKey(getNow()) + '"') + field('purchase', 'amount', 'Actual amount paid ($)', 'text', ' required inputmode="decimal" placeholder="0.00"') + '</div>' + field('purchase', 'description', 'What did you buy?', 'text', ' required maxlength="300"') + select('purchase', 'payer_slot', 'Who paid?', [['', 'Shared / not assigned'], ['1', 'Person 1 · pink'], ['2', 'Person 2 · purple']]) + saveButtons('purchase', 'Save purchase to Money', current) + '</form></section>';
    }
    function renderSmokingHistory(current) {
      const month = selectedDate.slice(0, 7), days = privateRows(current, 'smokingDays').filter(row => row.occurred_on.slice(0, 7) === month).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
      const totals = M.smokingMonth(days, month);
      const moneyLabel = totals.estimated_cost_cents == null ? 'Not recorded' : money(totals.estimated_cost_cents) + (totals.costs_complete ? '' : ' known · incomplete');
      let html = '<section class="panel"><p class="page-kicker">Saved days stay saved</p><h2>Your smoking history</h2><p class="habit-help">' + esc(new Date(month + '-01T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })) + ' · ' + days.length + ' day' + (days.length === 1 ? '' : 's') + ' recorded. Unlogged days are unknown.</p><div class="habit-summary-strip"><span><strong>' + totals.joints + '</strong> joints logged</span><span><strong>' + totals.cigars + '</strong> cigars logged</span><span><strong>' + esc(moneyLabel) + '</strong> estimated consumption cost</span></div>';
      html += days.length ? '<ul class="habit-history-list">' + days.map(row => {
        const value = M.smokingComparison(row, row.reference_snapshot || {});
        return '<li><div><strong>' + esc(dateLabel(row.occurred_on)) + '</strong><p>' + esc(count(row.joints)) + ' joints · ' + esc(count(row.cigars)) + ' Jazz / Black & Milds · ' + esc(count(row.grams_per_joint)) + ' g per joint</p><p>' + (value.daily.cost_cents == null ? 'Estimate incomplete · reference prices were missing when this day was saved' : money(value.daily.cost_cents) + ' estimated consumption cost') + '</p>' + ((row.trigger_tags || []).length ? '<p>Triggers: ' + row.trigger_tags.map(key => esc((M.TRIGGERS.find(item => item.key === key) || {}).label || key)).join(', ') + '</p>' : '') + (row.notes ? '<p class="habit-prose">' + esc(row.notes) + '</p>' : '') + '</div><div class="habit-actions">' + button('edit-day', 'View / edit day', ' data-date="' + esc(row.occurred_on) + '"', false, Boolean(attempt)) + button('archive', 'Remove mistaken entry', ' data-kind="smoking_day" data-id="' + esc(row.id) + '"', false, Boolean(attempt) || current.offline) + '</div></li>';
      }).join('') + '</ul>' : '<p class="habit-empty">No days recorded in this month yet. Saving zero is welcome; leaving a day unlogged keeps it unknown.</p>';
      html += '</section>';
      const archived = privateRows(current, 'smokingDays', true).filter(row => row.archived && row.occurred_on.slice(0, 7) === month);
      if (archived.length) html += '<section class="panel"><details><summary>Archived daily entries · ' + archived.length + '</summary><ul class="habit-history-list">' + archived.map(row => '<li class="is-archived"><div><strong>' + esc(dateLabel(row.occurred_on)) + '</strong><p>' + esc(count(row.joints)) + ' joints · ' + esc(count(row.cigars)) + ' cigars · Archived</p>' + (row.notes ? '<p class="habit-prose">' + esc(row.notes) + '</p>' : '') + '</div></li>').join('') + '</ul></details></section>';
      return html;
    }
    function renderSmoking(current) {
      const saved = dayRow(current, selectedDate);
      let html = '<section class="panel habit-intro"><div class="habit-heading"><div><p class="page-kicker">Small changes, at your pace</p><h2>Smoking Log</h2><p class="habit-help">Keep your counts, notice triggers, and compare estimated costs.</p></div><label class="habit-field habit-date-picker" for="habit-smoking-date"><span>Day to view</span><input id="habit-smoking-date" type="date" data-habit-date value="' + selectedDate + '" min="1900-01-01" max="' + M.dayKey(getNow()) + '"' + (busy || attempt ? ' disabled' : '') + '></label></div><p class="habit-privacy">Private to your sign-in. An actual purchase entered below is shared through Money.</p></section>';
      html += '<section class="panel habit-smoking-card"><div class="habit-heading"><h2>Daily smoking budget</h2><span class="habit-badge">0 is allowed</span></div><p class="habit-help">' + esc(dateLabel(selectedDate)) + ' · ' + (saved ? 'Saved day' : 'Nothing recorded for this day yet') + '. Move the sliders to preview, then save the quantities you actually logged.</p><form class="habit-form" data-habit-form="smoke">' + renderRange('joints', 'Joints today', 20, current) + renderRange('cigars', 'Jazz / Black & Milds today', 9, current) + '<fieldset class="habit-grams"><legend>Grams per joint · your estimate</legend><div>' + [0.4, 0.5, 0.75].map(value => button('grams', value + ' g', ' data-value="' + value + '" aria-pressed="' + (Number(drafts.smoke.grams_per_joint) === value) + '"', false, locked('smoke'))).join('') + '</div><details><summary>Enter another amount</summary>' + field('smoke', 'grams_per_joint', 'Grams per joint', 'number', ' min="0.01" max="10" step="any" inputmode="decimal"') + '</details></fieldset><div id="habit-smoking-preview" class="habit-cost-preview" aria-live="polite">' + renderSmokingPreview(current) + '</div><div class="habit-actions">' + button('reset-baseline', 'Reset draft to original plan', '', false, locked('smoke')) + button('open-settings', 'Prices & original plan', '', false, Boolean(attempt)) + '</div><section class="habit-triggers"><h3>Cravings & triggers</h3><p class="habit-help">What did you notice today? Choose any that apply.</p><div class="habit-trigger-options">' + M.TRIGGERS.map(item => '<button type="button" data-habit-action="trigger" data-trigger="' + item.key + '" aria-pressed="' + drafts.smoke.trigger_tags.includes(item.key) + '" class="habit-trigger ' + item.key + '"' + (locked('smoke') ? ' disabled' : '') + '><span aria-hidden="true">' + item.icon + '</span> ' + item.label + '</button>').join('') + '</div>' + textarea('smoke', 'notes', 'A note to yourself (optional)', 2000) + '</section>' + saveButtons('smoke', saved ? 'Save changes to this day' : 'Save this day', current) + '</form></section>';
      if (settingsOpen) html += renderSmokingSettings(current);
      html += '<section class="panel habit-money-link"><div><span aria-hidden="true">🌷</span><h3>Keep estimates and purchases clear</h3><p class="habit-help">Your daily estimate helps compare choices. Money in Bloom shows the purchases you actually enter.</p></div><div class="habit-actions">' + button('new-purchase', '+ Record an actual purchase', '', false, Boolean(attempt)) + button('money', 'Open Money in Bloom') + '</div></section>';
      if (purchaseOpen) html += renderPurchaseForm(current);
      html += renderSmokingHistory(current);
      return html;
    }
    function render(requestedPage) {
      if (requestedPage === 'skills' || requestedPage === 'smoking') page = requestedPage;
      const current = snapshot();
      if (!current.user || !current.household || current.status !== 'ready') return '<div class="habits-page"><section class="panel"><h2>' + (page === 'skills' ? 'Skills in Bloom' : 'Smoking Log') + '</h2><p class="habit-help">Sign in to keep your personal records with your account.</p>' + button('grocery', 'Open Grocery & sign in', '', true) + '</section></div>';
      let html = '<div class="habits-page ' + (page === 'skills' ? 'habits-skills' : 'habits-smoking') + '">';
      if (busy) html += '<p class="habit-working" role="status">' + esc(busy.label) + '</p>';
      if (current.offline) html += '<p class="habit-offline">Offline · your last saved device copy. New entries stay as drafts until you reconnect.</p>';
      if (attempt) html += '<section class="panel habit-pending"><h3>Confirming your saved change</h3><p class="habit-help">This device has not confirmed the last save. The exact request is kept so a retry cannot create another entry or purchase.</p>' + button('retry', 'Retry the same request', '', true, current.offline) + '</section>';
      if (problem) html += '<section class="panel habit-pending"><p class="habit-help">' + esc(problem) + '</p>' + button('reload-record', 'Reload saved entry', '', false, current.offline || Boolean(attempt)) + '</section>';
      html += status() + (page === 'skills' ? renderSkills(current) : renderSmoking(current));
      html += renderBackup(current) + '</div>';
      return html;
    }
    function renderBackup(current) {
      let html = '<section class="panel habit-backup"><details' + (backupReview ? ' open' : '') + '><summary>My records & backup</summary><p class="habit-help">Skills, practice entries, smoking references and daily smoking logs belong to your sign-in. Save a copy for yourself.</p>' + button('export', 'Export my Skills & Smoking backup');
      html += '<label class="habit-field habit-backup-picker"><span>Choose a personal backup to review</span><input type="file" accept="application/json,.json" data-habit-import' + (busy || attempt || current.offline ? ' disabled' : '') + '></label><p class="habit-help">Restore missing personal records from this same account and household. Existing records are kept. Conflicting changes stop the restore for review. Actual purchases stay in the separate household backup.</p>';
      if (backupReview) {
        const counts = Object.fromEntries(PRIVATE_KINDS.map(kind => [kind, backupReview.payload.records.filter(row => row.kind === kind).length]));
        html += '<div class="habit-backup-review"><h3>Review ' + esc(backupReview.name) + '</h3><p class="habit-help">Your account · ' + counts.skill + ' skills · ' + counts.skill_session + ' practice entries · ' + counts.smoking_settings + ' smoking reference records · ' + counts.smoking_day + ' smoking days. Archived entries are included.</p><div class="habit-actions">' + button('restore-backup', 'Restore missing personal records', '', true, Boolean(attempt) || current.offline) + button('cancel-backup', 'Cancel restore', '', false, Boolean(attempt)) + '</div></div>';
      }
      return html + '</details></section>';
    }
    function validateBackup(value, current) {
      if (!value || value.app !== 'Life in Bloom Personal Practice' || value.version !== 1 || !current.user || !current.household || value.user_id !== current.user.id || value.household_id !== current.household.id || !Array.isArray(value.records) || value.records.length > 10000) throw new Error('Choose a Skills & Smoking backup for your own signed-in account and this household.');
      const ids = new Set();
      for (const row of value.records) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || row.user_id !== current.user.id || row.household_id !== current.household.id || !PRIVATE_KINDS.includes(row.kind) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw new Error('This personal backup contains an invalid, duplicate, or unrelated record. No records were changed.');
        ids.add(row.id);
      }
      return { app: value.app, version: 1, user_id: value.user_id, household_id: value.household_id, records: copy(value.records) };
    }
    function collect(group, form) {
      if (!form || !form.elements || typeof form.elements.namedItem !== 'function' || locked(group)) return;
      for (const key of FIELDS[group]) { const element = form.elements.namedItem(key); if (element && element.value != null) drafts[group][key] = element.value; }
    }
    function validPastDate(value, label) {
      if (M.dateNumber(value) == null || value > M.dayKey(getNow())) throw new Error('Choose today or an earlier date for ' + label + '.');
      return value;
    }
    function identityPayload(value) {
      const result = { id: value.id || value.request_id, request_id: value.request_id };
      if (value.id) result.revision = number(value.revision, 'Saved revision', 1, 1000000000, false, true);
      return result;
    }
    function payloadFor(group, current) {
      const value = drafts[group];
      if (group === 'skill') {
        if (!M.CATEGORIES.some(item => item.key === value.category) || !['procedural', 'knowledge', 'mixed'].includes(value.memory_type)) throw new Error('Choose a skill area and practice type.');
        return { ...identityPayload(value), name: text(value.name, 'Skill name', 160, true), category: value.category, memory_type: value.memory_type, observed_level: number(value.observed_level, 'Your observed level', 1, 10, true, true), notes: text(value.notes, 'Skill notes', 2000), archived: false };
      }
      if (group === 'session') {
        if (!privateRows(current, 'skills', true).some(row => row.id === value.skill_id && (!row.archived || value.id))) throw new Error('Choose an active saved skill first.');
        if (!M.REVIEW_RESULTS.some(item => item.key === value.result)) throw new Error('Choose how the practice or recall check went.');
        return { ...identityPayload(value), skill_id: value.skill_id, occurred_on: validPastDate(value.occurred_on, 'your practice entry'), minutes: number(value.minutes, 'Practice minutes', 0, 1440, false), result: value.result, notes: text(value.notes, 'Practice notes', 2000) };
      }
      if (group === 'settings') return { ...identityPayload(value), baseline_joints: number(value.baseline_joints, 'Original joints per day', 0, 1000, true, true), baseline_cigars: number(value.baseline_cigars, 'Original cigars per day', 0, 1000, true, true), baseline_grams_per_joint: number(value.baseline_grams_per_joint, 'Original grams per joint', 0.01, 10, false), price_per_gram_cents: parseMoney(value.price_per_gram, true), cigar_price_cents: parseMoney(value.cigar_price, true), notes: text(value.notes, 'Reference notes', 1000) };
      if (group === 'smoke') {
        if (value.occurred_on !== selectedDate) throw new Error('Reload this daily entry before saving it on another date.');
        return { ...identityPayload(value), occurred_on: validPastDate(value.occurred_on, 'the smoking log'), joints: number(value.joints, 'Joint count', 0, 1000, false, true), cigars: number(value.cigars, 'Cigar count', 0, 1000, false, true), grams_per_joint: number(value.grams_per_joint, 'Grams per joint', 0.01, 10, false), trigger_tags: [...new Set(value.trigger_tags.filter(tag => M.TRIGGERS.some(item => item.key === tag)))], notes: text(value.notes, 'Daily notes', 2000) };
      }
      if (group === 'purchase') {
        if (!['', '1', '2'].includes(String(value.payer_slot))) throw new Error('Choose who paid for the purchase.');
        const description = text(value.description, 'Purchase description', 300, true);
        return { id: value.id, occurred_on: validPastDate(value.occurred_on, 'the purchase'), direction: 'expense', category: 'other', amount_cents: parseMoney(value.amount, false), description: /^Smoking\s*[·—:-]/i.test(description) ? description : 'Smoking · ' + description, payer_slot: value.payer_slot === '' ? null : Number(value.payer_slot), bill_id: null };
      }
      throw new Error('Open a supported form first.');
    }
    function submitAttempt() {
      if (!attempt) return false;
      const job = copy(attempt), current = snapshot(); requireReady(current);
      const method = job.action === 'archive' ? 'archiveLifeRecord' : job.action === 'import' ? 'importPersonalLifeRecords' : METHODS[job.group];
      if (typeof store[method] !== 'function') throw new Error('Refresh the app to load the saving tools.');
      if (job.action === 'import') validateBackup(job.payload, current);
      return run(job.action === 'archive' ? 'Updating your saved history…' : job.action === 'import' ? 'Restoring missing personal records…' : job.group === 'purchase' ? 'Saving the actual purchase…' : 'Saving your personal record…', () => job.action === 'archive' ? store[method](job.payload, job.request_id) : store[method](job.payload), () => {
        const latest = snapshot(); attempt = null; problem = '';
        if (job.action === 'import') { backupReview = null; notify('Your missing personal records were restored. Existing records and any typed drafts were kept.'); }
        else if (job.action === 'archive') {
          if (job.group === 'skill' && drafts.skill.id === job.payload.id) { reset('skill', skillDraft(selectedCategory === 'all' ? 'piano' : selectedCategory)); skillOpen = false; }
          if (job.group === 'session' && drafts.session.id === job.payload.id) { reset('session', sessionDraft(selectedDate)); sessionOpen = false; }
          if (job.group === 'smoke' && drafts.smoke.id === job.payload.id) loadDay(latest);
          notify('The entry was archived. Its saved history is retained.');
        } else if (job.group === 'skill') { selectedSkillId = job.payload.id; skillOpen = false; reset('skill', skillDraft(selectedCategory === 'all' ? 'piano' : selectedCategory)); notify('Your skill was saved.'); }
        else if (job.group === 'session') { selectedSkillId = job.payload.skill_id; sessionOpen = false; reset('session', sessionDraft(selectedDate)); notify('Your practice was saved and the review suggestion was updated.'); }
        else if (job.group === 'settings') { const row = settingsRow(latest); reset('settings', rowDraft('settings', row || { ...job.payload, revision: 1 }, selectedDate)); sourceKeys.settings = row ? row.id + ':' + row.revision : 'new'; settingsOpen = false; notify('Your reference values were saved. Earlier daily records keep their original references.'); }
        else if (job.group === 'smoke') { loadDay(latest); notify('This day was saved to your smoking history.'); }
        else if (job.group === 'purchase') { reset('purchase', purchaseDraft(selectedDate)); purchaseOpen = false; notify('Your actual purchase was saved once to Money in Bloom.'); }
      }, error => {
        if (REJECTIONS.has(String(error.code || ''))) {
          attempt = null;
          if (job.action === 'import') backupReview = { name: job.name || 'Personal backup', payload: copy(job.payload) };
          else if (['40001', '23505', '23503', '23514'].includes(String(error.code))) problem = 'This entry needs a fresh review before saving. Reload the saved version if it changed on another device.';
        }
      });
    }
    function handleSubmit(event) {
      const form=event.target;
      if(form&&form.dataset&&Object.hasOwn(form.dataset,'engineeringHomeworkForm')){
        if(event.preventDefault)event.preventDefault();
        const current=snapshot(); if(busy)return true;
        try{
          requireReady(current);
          run('Saving Engineering homework…',()=>store.saveEngineeringHomework({...engineeringHomeworkDraft,status:'open'}),()=>{
            engineeringHomeworkDraft={title:'',due_on:'',notes:''}; engineeringHomeworkOpen=false; notify('Engineering homework saved.');
          },null,'#engineering-homework');
        }catch(error){notify(error.message,true);}
        return true;
      }
      const group = form && form.dataset && form.dataset.habitForm;
      if (!Object.hasOwn(FIELDS, group)) return false;
      if (event.preventDefault) event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        requireReady(current); collect(group, form);
        if (attempt && (attempt.group !== group || attempt.action !== 'save')) throw new Error('Confirm the pending save before starting another one.');
        if (!attempt) { attempt = { action: 'save', group, payload: payloadFor(group, current) }; problem = ''; persist(); }
        submitAttempt();
      } catch (error) { persist(); notify(error.message, true); }
      return true;
    }
    function updateSmokingPreview(current) {
      if (!root.document || typeof root.document.querySelector !== 'function') return;
      const preview = root.document.querySelector('#habit-smoking-preview');
      if (preview) preview.innerHTML = renderSmokingPreview(current);
    }
    function handleInput(event) {
      const element = event.target, data = element && element.dataset;
      if (!data) return false;
      const current = snapshot();
      if(Object.hasOwn(data,'engineeringHomeworkField')){
        const key=String(data.engineeringHomeworkField||'');
        if(['title','due_on','notes'].includes(key)) engineeringHomeworkDraft[key]=String(element.value||'');
        return true;
      }
      if (Object.hasOwn(data, 'habitRange')) {
        const key = data.habitRange; if (!['joints', 'cigars'].includes(key)) return false;
        if (!locked('smoke')) {
          drafts.smoke[key] = element.value;
          if (root.document && typeof root.document.querySelector === 'function') { const exact = root.document.querySelector('[data-habit-field="smoke.' + key + '"]'); if (exact) exact.value = element.value; }
          persist(); updateSmokingPreview(current);
        }
        return true;
      }
      const [group, fieldName, extra] = String(data.habitField || '').split('.');
      if (extra || !Object.hasOwn(FIELDS, group) || !FIELDS[group].includes(fieldName)) return false;
      if (!locked(group)) {
        drafts[group][fieldName] = element.value;
        if (group === 'smoke' && ['joints', 'cigars'].includes(fieldName) && root.document && typeof root.document.querySelector === 'function') {
          const range = root.document.querySelector('[data-habit-range="' + fieldName + '"]');
          if (range) { range.max = Math.max(fieldName === 'joints' ? 20 : 9, Number(element.value) || 0); range.value = element.value; }
        }
        persist(); if (group === 'smoke') updateSmokingPreview(current);
      }
      return true;
    }
    function chooseDate(date, current) {
      validPastDate(date, 'the day you want to view');
      if (date === selectedDate) return true;
      if (attempt) throw new Error('Confirm the pending request before changing dates.');
      if (dirty('smoke') && !confirm('Change dates and discard this unsaved daily draft?')) return false;
      selectedDate = date; loadDay(current); if (!dirty('purchase')) reset('purchase', purchaseDraft(date)); persist(); refresh(); return true;
    }
    function handleChange(event) {
      const element = event.target, data = element && element.dataset;
      if(data&&Object.hasOwn(data,'engineeringUpload')){
        const current=snapshot(), files=Array.from(element.files||[]); element.value='';
        if(!files.length)return true;
        try{
          requireReady(current);
          if(typeof store.uploadEngineeringFile!=='function')throw new Error('Refresh the app to load Engineering file tools.');
          run('Uploading Engineering files…',async()=>{const out=[];for(const file of files.slice(0,12))out.push(await store.uploadEngineeringFile({file}));return out;},rows=>notify((rows||[]).length+' Engineering file'+((rows||[]).length===1?'':'s')+' saved.'),null,'#engineering-homework');
        }catch(error){notify(error.message,true);}
        return true;
      }
      if (data && Object.hasOwn(data, 'habitImport')) {
        const current = snapshot();
        if (busy || attempt) return true;
        const file = element.files && element.files[0]; if (!file) return true;
        try {
          requireReady(current);
          if (typeof file.text !== 'function' || Number(file.size) > 20 * 1024 * 1024) throw new Error('Choose a JSON personal backup smaller than 20 MB.');
          backupReview = null;
          run('Reading your personal backup…', async () => {
            const raw = await file.text();
            if (raw.length > 20 * 1024 * 1024) throw new Error('This backup is too large to review on this device.');
            try { return JSON.parse(raw); } catch (_) { throw new Error('This file is not a valid JSON backup. No records were changed.'); }
          }, value => { const latest = snapshot(); backupReview = { name: String(file.name || 'Personal backup'), payload: validateBackup(value, latest) }; notify('Your backup is ready to review. Choose Restore missing personal records to continue.'); });
        } catch (error) { notify(error.message, true); }
        element.value = ''; return true;
      }
      if (data && Object.hasOwn(data, 'habitDate')) {
        const current = snapshot();
        if (busy) { element.value = selectedDate; return true; }
        try { if (!chooseDate(element.value, current)) element.value = selectedDate; }
        catch (error) { element.value = selectedDate; notify(error.message, true); }
        return true;
      }
      return handleInput(event);
    }
    function openGroup(group, current, row, override) {
      if (attempt) throw new Error('Confirm the pending save before opening another entry.');
      if (dirty(group) && !confirm('Open this entry and discard the unsaved draft?')) return false;
      const next = group === 'purchase' ? purchaseDraft(selectedDate) : rowDraft(group, row, selectedDate);
      Object.assign(next, override || {}); reset(group, next); problem = '';
      if (group === 'skill') skillOpen = true;
      if (group === 'session') sessionOpen = true;
      if (group === 'settings') settingsOpen = true;
      if (group === 'purchase') purchaseOpen = true;
      persist(); refresh('#habit-' + group + '-editor'); return true;
    }
    function download(name, content, type) {
      if (options.download) return options.download(name, content, type);
      if (!root.document || !root.URL || !root.Blob) throw new Error('This browser could not prepare the backup download.');
      const url = root.URL.createObjectURL(new Blob([content], { type })); const anchor = root.document.createElement('a');
      anchor.href = url; anchor.download = name; root.document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function reloadCurrentRecord() {
      if (attempt) throw new Error('Retry the pending save before replacing its exact details.');
      if (typeof store.refresh !== 'function') throw new Error('Refresh the browser to reload your saved records.');
      const group = page === 'smoking' ? settingsOpen ? 'settings' : purchaseOpen ? 'purchase' : 'smoke' : sessionOpen ? 'session' : 'skill';
      if (group === 'purchase') throw new Error('Review the saved purchase in Money before starting a new purchase draft.');
      if (dirty(group) && !confirm('Reload the saved entry and replace this draft?')) return false;
      const id = drafts[group].id || drafts[group].request_id;
      return run('Loading your saved entry…', () => store.refresh(), () => {
        const current = snapshot();
        if (group === 'smoke') loadDay(current);
        else if (group === 'settings') reset('settings', rowDraft(group, settingsRow(current), selectedDate));
        else {
          const rows = privateRows(current, group === 'skill' ? 'skills' : 'skillSessions', true), row = rows.find(item => item.id === id);
          if (row && row.archived) throw new Error('This entry was archived. Its history remains saved.');
          if (row) reset(group, rowDraft(group, row, selectedDate));
          else { drafts[group].id = ''; drafts[group].revision = null; }
        }
        problem = ''; notify('The saved record was refreshed. Review the details before saving.');
      });
    }
    function handleClick(event) {
      const element = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-habit-action]') : null;
      const data = element && element.dataset, action = data && data.habitAction;
      if (!['grocery', 'money', 'category', 'new-skill', 'edit-skill', 'log-skill', 'skill-history', 'close-history', 'edit-session', 'resume', 'discard', 'archive', 'retry', 'reload-record', 'grams', 'trigger', 'reset-baseline', 'open-settings', 'close-settings', 'edit-day', 'new-purchase', 'export', 'restore-backup', 'cancel-backup', 'engineering-homework-add', 'engineering-homework-cancel', 'engineering-homework-toggle', 'engineering-homework-delete', 'engineering-file-open', 'engineering-file-delete'].includes(action)) return false;
      if (event.preventDefault) event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        if (action === 'grocery' || action === 'money') { navigate(action); return true; }
        if (action === 'category') { if (data.category === 'all' || M.CATEGORIES.some(item => item.key === data.category)) selectedCategory = data.category; }
        else if(action==='engineering-homework-add'){engineeringHomeworkOpen=true;engineeringHomeworkDraft={title:'',due_on:'',notes:''};refresh('#engineering-homework');return true;}
        else if(action==='engineering-homework-cancel'){engineeringHomeworkOpen=false;engineeringHomeworkDraft={title:'',due_on:'',notes:''};refresh('#engineering-homework');return true;}
        else if(action==='engineering-homework-toggle'){
          const row=engineeringHomeworkRows(current).find(item=>item.id===data.id); if(!row)throw new Error('Refresh to find that homework.');
          run(row.status==='done'?'Reopening homework…':'Completing homework…',()=>store.saveEngineeringHomework({...row,status:row.status==='done'?'open':'done'}),()=>notify(row.status==='done'?'Homework reopened.':'Homework marked done.'),null,'#engineering-homework');return true;
        }
        else if(action==='engineering-homework-delete'){
          const row=engineeringHomeworkRows(current).find(item=>item.id===data.id); if(!row)throw new Error('Refresh to find that homework.');
          if(!confirm('Remove this Engineering homework? Saved uploaded files are kept unless you delete them separately.'))return true;
          run('Removing homework…',()=>store.deleteEngineeringHomework(row),()=>notify('Homework removed.'),null,'#engineering-homework');return true;
        }
        else if(action==='engineering-file-open'){
          const row=engineeringFileRows(current).find(item=>item.id===data.id); if(!row)throw new Error('Refresh to find that Engineering file.');
          run('Opening Engineering file…',()=>store.getEngineeringFileUrl(row),url=>{if(root.open)root.open(url,'_blank','noopener');},null,'#engineering-homework');return true;
        }
        else if(action==='engineering-file-delete'){
          const row=engineeringFileRows(current).find(item=>item.id===data.id); if(!row)throw new Error('Refresh to find that Engineering file.');
          if(!confirm('Delete this saved Engineering file?'))return true;
          run('Deleting Engineering file…',()=>store.deleteEngineeringFile(row),()=>notify('Engineering file deleted.'),null,'#engineering-homework');return true;
        }
        else if (action === 'new-skill') { const category = selectedCategory === 'all' ? 'piano' : selectedCategory; openGroup('skill', current, null, { category, memory_type: M.category(category).memory_type }); return true; }
        else if (action === 'edit-skill' || action === 'log-skill') {
          const row = privateRows(current, 'skills').find(skill => skill.id === data.id); if (!row) throw new Error('Refresh to find this saved skill.');
          if (action === 'edit-skill') openGroup('skill', current, row); else openGroup('session', current, null, { skill_id: row.id, occurred_on: M.dayKey(getNow()) }); return true;
        } else if (action === 'skill-history') { if (!privateRows(current, 'skills', true).some(row => row.id === data.id)) throw new Error('Refresh to find this skill.'); selectedSkillId = data.id; }
        else if (action === 'close-history') selectedSkillId = '';
        else if (action === 'edit-session') { const row = privateRows(current, 'skillSessions').find(item => item.id === data.id); if (!row) throw new Error('Refresh to find this practice entry.'); openGroup('session', current, row); return true; }
        else if (action === 'resume') { if (data.group === 'skill') skillOpen = true; if (data.group === 'session') sessionOpen = true; }
        else if (action === 'discard') {
          const group = data.group; if (!Object.hasOwn(FIELDS, group)) return true;
          if (attempt) throw new Error('Confirm the pending request before discarding its details.');
          if (dirty(group) && !confirm('Discard this unsaved draft? Saved records stay in your history.')) return true;
          if (group === 'smoke') loadDay(current);
          else if (group === 'settings') { reset('settings', rowDraft(group, settingsRow(current), selectedDate)); settingsOpen = false; }
          else if (group === 'skill') { reset(group, skillDraft(selectedCategory === 'all' ? 'piano' : selectedCategory)); skillOpen = false; }
          else if (group === 'session') { reset(group, sessionDraft(selectedDate)); sessionOpen = false; }
          else { reset(group, purchaseDraft(selectedDate)); purchaseOpen = false; }
          problem = '';
        } else if (action === 'archive') {
          requireReady(current); if (attempt) throw new Error('Confirm the pending request first.');
          const mapping = { skill: ['skills', 'skill'], skill_session: ['skillSessions', 'session'], smoking_day: ['smokingDays', 'smoke'] }, pair = mapping[data.kind];
          if (!pair) throw new Error('Choose a saved entry to archive.');
          const row = privateRows(current, pair[0]).find(item => item.id === data.id); if (!row) throw new Error('Refresh to find this entry.');
          if (drafts[pair[1]].id === row.id && dirty(pair[1])) throw new Error('Save or discard this entry’s draft before archiving it.');
          if (!confirm(data.kind === 'skill' ? 'Archive this skill? Its practice history will remain available.' : 'Remove this mistaken entry from your active log? An archived copy remains in history.')) return true;
          attempt = { action: 'archive', group: pair[1], payload: { ...copy(row), kind: data.kind }, request_id: uuid() }; persist(); submitAttempt(); return true;
        } else if (action === 'retry') { submitAttempt(); return true; }
        else if (action === 'reload-record') { reloadCurrentRecord(); return true; }
        else if (action === 'grams') { if (!locked('smoke') && [0.4, 0.5, 0.75].includes(Number(data.value))) drafts.smoke.grams_per_joint = data.value; }
        else if (action === 'trigger') { if (!locked('smoke') && M.TRIGGERS.some(item => item.key === data.trigger)) drafts.smoke.trigger_tags = drafts.smoke.trigger_tags.includes(data.trigger) ? drafts.smoke.trigger_tags.filter(key => key !== data.trigger) : [...drafts.smoke.trigger_tags, data.trigger]; }
        else if (action === 'reset-baseline') {
          if (locked('smoke')) return true;
          const reference = referenceForDay(current);
          if (reference.baseline_joints == null || reference.baseline_cigars == null) throw new Error('Set your original daily counts in Prices & original plan first.');
          drafts.smoke.joints = String(reference.baseline_joints); drafts.smoke.cigars = String(reference.baseline_cigars); drafts.smoke.grams_per_joint = String(reference.baseline_grams_per_joint || 0.5);
          notify('The draft now uses your original plan counts. Save only if these are the quantities you want to record for this day.');
        } else if (action === 'open-settings') { if (attempt) throw new Error('Confirm the pending save before changing reference values.'); settingsOpen = true; }
        else if (action === 'close-settings') settingsOpen = false;
        else if (action === 'edit-day') { if (!chooseDate(data.date, current)) return true; page = 'smoking'; return true; }
        else if (action === 'new-purchase') { openGroup('purchase', current, null); return true; }
        else if (action === 'cancel-backup') { if (attempt) throw new Error('Confirm the pending restore before replacing its exact details.'); backupReview = null; }
        else if (action === 'restore-backup') {
          requireReady(current); if (attempt) throw new Error('Confirm the pending request before restoring a backup.');
          if (!backupReview) throw new Error('Choose a personal backup and review its records first.');
          const payload = validateBackup(backupReview.payload, current);
          attempt = { action: 'import', group: 'backup', payload, name: backupReview.name }; problem = ''; persist(); submitAttempt(); return true;
        }
        else if (action === 'export') {
          if (!current.user || !current.household || typeof store.exportPersonalLifeRecords !== 'function') throw new Error('Sign in and refresh to export your personal records.');
          run('Preparing your personal backup…', () => store.exportPersonalLifeRecords(), value => { download('life-in-bloom-my-practice-' + M.dayKey(getNow()) + '.json', JSON.stringify(value, null, 2), 'application/json'); notify('Your personal practice and smoking backup was downloaded.'); }); return true;
        }
        persist(); refresh();
      } catch (error) { notify(error.message, true); }
      return true;
    }
    function hasUnsavedDraft() { snapshot(); return Boolean(busy || attempt || anyDirty()); }
    function hasUnpersistedChanges() { snapshot(); return Boolean((attempt || anyDirty()) && !draftSaved); }
    function discardDraft() {
      snapshot(); if (busy) return false;
      if (attempt) { notify('Confirm the pending save before discarding its exact request.', true); return false; }
      const current = snapshot(); drafts = makeDrafts(); baselines = copy(drafts); skillOpen = false; sessionOpen = false; settingsOpen = false; purchaseOpen = false; problem = '';
      reset('settings', rowDraft('settings', settingsRow(current), selectedDate)); loadDay(current); persist(); return true;
    }
    function getHomeSummary(date) {
      const current = snapshot(), today = date && M.dateNumber(date) != null ? date : M.dayKey(getNow());
      const skills = privateRows(current, 'skills'), sessions = privateRows(current, 'skillSessions'), day = dayRow(current, today);
      const comparison = day ? M.smokingComparison(day, day.reference_snapshot || {}) : null;
      return { dueSkills: skills.filter(skill => M.skillProgress(skill, sessions, today).due).length, skillCount: skills.length, practiceMinutes: sessions.filter(row => row.occurred_on === today).reduce((sum, row) => sum + Number(row.minutes || 0), 0), smokingDay: day ? copy(day) : null, smokingEstimate: comparison ? { dailyCents: comparison.daily.cost_cents, baselineCents: comparison.baseline.cost_cents, savingsCents: comparison.savings_cents } : null };
    }
    function openSkillArea(category) {
      snapshot();
      if (category !== 'all' && !M.CATEGORIES.some(item => item.key === category)) return false;
      selectedCategory = category;
      selectedSkillId = '';
      skillOpen = false;
      sessionOpen = false;
      persist();
      return true;
    }
    return { render, handleClick, handleSubmit, handleInput, handleChange, hasUnsavedDraft, hasUnpersistedChanges, discardDraft, getHomeSummary, openSkillArea, isBusy: () => Boolean(busy), whenIdle: () => pending };
  }
  const api = { createController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomHabits = api;
})(typeof window !== 'undefined' ? window : globalThis);
