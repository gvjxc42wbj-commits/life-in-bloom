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
    let readingView='home', selectedReadingBookId='', readingCoachTab='vocabulary', readingSeedChecked='';
    let readingBookOpen=false, readingSessionOpen=false, readingNoteOpen=false;
    let readerPage=1, readerZoom=1.15, readerMode='pdf', readerRangeStart=1, readerRangeEnd=1;
    let readerPdfDoc=null, readerPdfFileId='', readerPdfLoad=null, readerStatus='', readerTextDraft='', readerTextDraftPage=0, readerLesson=null;
    let readerTextSize=18, readerLineHeight=1.75, readerSpeechRate=1;
    let readingAssignmentOpen=false, readingAssignmentDraft={id:'',title:'',prompt:'',body:'',tutor_questions:'',due_on:'',status:'draft'};
    let readAloudRecorder=null, readAloudStream=null, readAloudChunks=[], readAloudStartedAt=0, readAloudBlob=null, readAloudDuration=0, readAloudPreviewUrl='', readAloudClarity='', readAloudConfidence='', readAloudNotes='';
    let pianoSeedChecked='', pianoPracticeOpen=false, pianoRepertoireOpen=false, pianoAppEditId='', pianoAppDraft=null;
    let pianoPracticeDraft={duration_minutes:'20',source:'independent',course_name:'',lesson_name:'',piece_name:'',accuracy_percent:'',notes:''};
    let pianoRepertoireDraft={title:'',kind:'piece',status:'learning',source:'',notes:''};
    let pianoMediaMeta={title:'Practice sample',piece_name:'',notes:''};
    let pianoMidiAccess=null, pianoMidiConnected=false, pianoMidiRecording=false, pianoMidiStartedAt=0, pianoMidiNoteCount=0, pianoMidiNotes=new Set(), pianoMidiLow=null, pianoMidiHigh=null;
    let readingBookDraft={id:'',title:'',author:'',isbn:'',edition:'',total_pages:'',current_page:'',current_section:'',status:'not_started',cover_url:'',notes:''};
    let readingSessionDraft={minutes:'20',start_page:'',end_page:'',section:'',notes:''};
    let readingNoteDraft={page_number:'',section:'',note_type:'note',body:''};
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
        skillOpen = false; sessionOpen = false; settingsOpen = false; purchaseOpen = false; draftSaved = false; draftWarning = false; engineeringHomeworkOpen = false; engineeringHomeworkDraft = { title:'', due_on:'', notes:'' }; readingView='home'; selectedReadingBookId=''; readingCoachTab='vocabulary'; readingSeedChecked=''; readingBookOpen=false; readingSessionOpen=false; readingNoteOpen=false; readerPage=1; readerZoom=1.15; readerMode='pdf'; readerRangeStart=1; readerRangeEnd=1; readerPdfDoc=null; readerPdfFileId=''; readerPdfLoad=null; readerStatus=''; readerTextDraft=''; readerTextDraftPage=0; readerLesson=null; readerTextSize=18; readerLineHeight=1.75; readerSpeechRate=1; readingAssignmentOpen=false; readingAssignmentDraft={id:'',title:'',prompt:'',body:'',tutor_questions:'',due_on:'',status:'draft'}; readAloudRecorder=null; readAloudStream=null; readAloudChunks=[]; readAloudStartedAt=0; readAloudBlob=null; readAloudDuration=0; readAloudPreviewUrl=''; readAloudClarity=''; readAloudConfidence=''; readAloudNotes='';
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
    function readingBooks(current) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current.readingBooks||[]).filter(row=>row&&row.user_id===user&&row.household_id===household&&row.status!=='archived')
        .sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
    }
    function readingBook(current,id) { return readingBooks(current).find(row=>row.id===id)||null; }
    function readingSessions(current,bookId) { return (current.readingSessions||[]).filter(row=>row.book_id===bookId).sort((a,b)=>String(b.occurred_on).localeCompare(String(a.occurred_on))); }
    function readingNotes(current,bookId) { return (current.readingNotes||[]).filter(row=>row.book_id===bookId).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))); }
    function readingVocabulary(current,bookId) { return (current.readingVocabulary||[]).filter(row=>row.book_id===bookId).sort((a,b)=>String(a.word||'').localeCompare(String(b.word||''))); }
    function readingFiles(current,bookId) { return (current.readingFiles||[]).filter(row=>!bookId||row.book_id===bookId).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))); }
    function readingBookPdf(current,bookId) {
      return readingFiles(current,bookId).find(file=>file.file_role==='book_pdf'&&file.mime_type==='application/pdf')||null;
    }
    function readingPageTexts(current,fileId) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current.readingPageText||[]).filter(row=>row&&row.user_id===user&&row.household_id===household&&row.file_id===fileId)
        .sort((a,b)=>Number(a.page_number)-Number(b.page_number));
    }
    function setReaderStatus(message) {
      readerStatus=String(message||'');
      if(root.document){
        const target=root.document.querySelector('[data-reader-status]');
        if(target) target.textContent=readerStatus;
      }
    }
    async function ensureReaderDocument(file) {
      if(!file) throw new Error('Upload a full-book PDF first.');
      if(!root.BloomReader) throw new Error('Bloom Reader has not loaded yet. Refresh the app and try again.');
      if(readerPdfDoc&&readerPdfFileId===file.id) return readerPdfDoc;
      if(readerPdfLoad&&readerPdfFileId===file.id) return readerPdfLoad;
      readerPdfFileId=file.id; readerPdfDoc=null;
      readerPdfLoad=Promise.resolve(store.getReadingFileUrl(file)).then(url=>root.BloomReader.loadDocument(url)).then(doc=>{
        readerPdfDoc=doc;readerPdfLoad=null;
        return doc;
      }).catch(error=>{readerPdfLoad=null;readerPdfFileId='';throw error;});
      return readerPdfLoad;
    }
    async function hydrateBloomReader(current,book,file) {
      if(!file||readingView!=='reader') return;
      try{
        setReaderStatus('Loading private PDF…');
        const doc=await ensureReaderDocument(file);
        const total=doc.numPages;
        readerPage=Math.max(1,Math.min(total,readerPage));
        readerRangeStart=Math.max(1,Math.min(total,readerRangeStart));
        readerRangeEnd=Math.max(readerRangeStart,Math.min(total,readerRangeEnd));
        const totalNode=root.document&&root.document.querySelector('[data-reader-total-pages]');
        if(totalNode) totalNode.textContent=String(total);
        if(!file.page_count&&store.setReadingFilePageCount) Promise.resolve(store.setReadingFilePageCount(file,total)).catch(()=>{});
        const record=readingPageTexts(store.snapshot(),file.id).find(row=>Number(row.page_number)===readerPage);
        if(readerTextDraftPage!==readerPage){
          readerTextDraft=record?String(record.verified_text||record.raw_text||''):'';
          readerTextDraftPage=readerPage;
        }
        if(readerMode==='pdf'){
          const canvas=root.document&&root.document.querySelector('[data-bloom-reader-canvas]');
          if(canvas) await root.BloomReader.renderPage(doc,readerPage,canvas,readerZoom);
        }
        const text=root.document&&root.document.querySelector('[data-reader-page-text]');
        if(text&&text.value!==readerTextDraft) text.value=readerTextDraft;
        setReaderStatus(record?(record.verified?'Verified page text · '+record.extraction_method.replace('_',' '):'Extracted · review before lesson use'):'Page not extracted yet');
      }catch(error){setReaderStatus(error&&error.message||'The PDF page could not be opened.');}
    }
    function readingAssignments(current,bookId) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current.readingAssignments||[]).filter(row=>row&&row.user_id===user&&row.household_id===household&&(!bookId||row.book_id===bookId))
        .sort((a,b)=>String(a.due_on||'9999-12-31').localeCompare(String(b.due_on||'9999-12-31'))||String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
    }
    function readingAudio(current,bookId) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current.readingAudioRecordings||[]).filter(row=>row&&row.user_id===user&&row.household_id===household&&(!bookId||row.book_id===bookId))
        .sort((a,b)=>String(b.recorded_on||'').localeCompare(String(a.recorded_on||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
    }
    function wordCount(value) { return (String(value||'').match(/\b[\p{L}\p{N}’'-]+\b/gu)||[]).length; }
    function verifiedRangeText(current,fileId,start,end) {
      return readingPageTexts(current,fileId).filter(row=>row.verified&&Number(row.page_number)>=start&&Number(row.page_number)<=end)
        .map(row=>String(row.verified_text||'')).filter(Boolean).join('\n\n');
    }
    function hydrateReadingAudio(rows) {
      if(!root.document||!store.getReadingAudioUrl)return;
      for(const row of rows){
        const audio=root.document.querySelector('[data-reading-audio-id="'+row.id+'"]');
        if(!audio||audio.dataset.loaded==='true')continue;
        Promise.resolve(store.getReadingAudioUrl(row)).then(url=>{const live=root.document&&root.document.querySelector('[data-reading-audio-id="'+row.id+'"]');if(live){live.src=url;live.dataset.loaded='true';}}).catch(()=>{});
      }
    }
    function stopReadingSpeech() {
      try{if(root.speechSynthesis)root.speechSynthesis.cancel();}catch(_){}
    }
    function startReadingSpeech(text) {
      if(!root.speechSynthesis||!root.SpeechSynthesisUtterance)throw new Error('Text-to-speech is not available in this browser.');
      const value=String(text||'').trim();if(!value)throw new Error('Extract or verify page text before listening.');
      root.speechSynthesis.cancel();
      const utterance=new root.SpeechSynthesisUtterance(value);utterance.rate=readerSpeechRate;utterance.lang='en-US';root.speechSynthesis.speak(utterance);
    }
    function preferredRecordingMime() {
      if(!root.MediaRecorder)return '';
      const choices=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'];
      return choices.find(type=>!root.MediaRecorder.isTypeSupported||root.MediaRecorder.isTypeSupported(type))||'';
    }
    async function startReadAloudRecording() {
      if(!root.navigator||!root.navigator.mediaDevices||!root.navigator.mediaDevices.getUserMedia||!root.MediaRecorder)throw new Error('Microphone recording is not supported in this browser.');
      if(readAloudRecorder&&readAloudRecorder.state==='recording')return;
      if(readAloudPreviewUrl&&root.URL)root.URL.revokeObjectURL(readAloudPreviewUrl);
      readAloudBlob=null;readAloudPreviewUrl='';readAloudDuration=0;readAloudChunks=[];
      readAloudStream=await root.navigator.mediaDevices.getUserMedia({audio:true});
      const mime=preferredRecordingMime(),options=mime?{mimeType:mime}:undefined;
      readAloudRecorder=new root.MediaRecorder(readAloudStream,options);
      readAloudRecorder.ondataavailable=event=>{if(event.data&&event.data.size)readAloudChunks.push(event.data);};
      readAloudRecorder.onstop=()=>{
        const base=String(readAloudRecorder.mimeType||mime||'audio/webm').split(';')[0];
        readAloudBlob=new Blob(readAloudChunks,{type:base});
        readAloudDuration=Math.max(.1,(Date.now()-readAloudStartedAt)/1000);
        if(root.URL)readAloudPreviewUrl=root.URL.createObjectURL(readAloudBlob);
        if(readAloudStream){for(const track of readAloudStream.getTracks())track.stop();}
        readAloudStream=null;refresh('.reader-read-aloud');
      };
      readAloudStartedAt=Date.now();readAloudRecorder.start(1000);refresh('.reader-read-aloud');
    }
    function stopReadAloudRecording() {
      if(readAloudRecorder&&readAloudRecorder.state==='recording')readAloudRecorder.stop();
    }
    function pianoRows(current,key) {
      const user=current.user&&current.user.id, household=current.household&&current.household.id;
      return (current[key]||[]).filter(row=>row&&row.user_id===user&&row.household_id===household);
    }
    function pianoAbilityInfo(key){
      return {
        sheet_music:['🎼','Reading sheet music','Recognizing notes in treble and bass clefs'],
        rhythm:['🥁','Rhythm & timing','Maintaining a steady beat and understanding note durations'],
        technique:['✋','Keyboard technique','Finger control, coordination, relaxed posture and hand position'],
        chords:['🎹','Chords & harmony','Recognizing, forming, and changing chords'],
        repertoire:['🎵','Repertoire','Playing complete pieces accurately and independently'],
        expression:['✨','Musical expression','Dynamics, articulation, phrasing, and expressive playing']
      }[key]||['🎹',key,''];
    }
    function pianoStateLabel(value){
      return {
        not_assessed:'Not Assessed',not_started:'Not Started',developing:'Developing',
        practicing:'Practicing',consistent:'Consistent',demonstrated:'Demonstrated'
      }[value]||'Not Assessed';
    }
    function pianoMediaRows(current){
      return pianoRows(current,'pianoMedia').slice().sort((a,b)=>String(b.recorded_on||'').localeCompare(String(a.recorded_on||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
    }
    function hydratePianoMedia(rows){
      if(!root.document||!store.getPianoMediaUrl)return;
      for(const row of rows){
        const media=root.document.querySelector('[data-piano-media-id="'+row.id+'"]');
        if(!media||media.dataset.loaded==='true')continue;
        Promise.resolve(store.getPianoMediaUrl(row)).then(url=>{
          const live=root.document&&root.document.querySelector('[data-piano-media-id="'+row.id+'"]');
          if(live){live.src=url;live.dataset.loaded='true';}
        }).catch(()=>{});
      }
    }
    function midiName(number){
      if(number==null)return '—';
      const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
      return names[number%12]+(Math.floor(number/12)-1);
    }
    function onPianoMidiMessage(event){
      const data=event&&event.data;if(!pianoMidiRecording||!data||data.length<3)return;
      const status=data[0]&0xf0,note=Number(data[1]),velocity=Number(data[2]);
      if(status===0x90&&velocity>0){
        pianoMidiNoteCount++;
        pianoMidiNotes.add(note);
        pianoMidiLow=pianoMidiLow==null?note:Math.min(pianoMidiLow,note);
        pianoMidiHigh=pianoMidiHigh==null?note:Math.max(pianoMidiHigh,note);
        const count=root.document&&root.document.querySelector('[data-piano-midi-count]');
        if(count)count.textContent=String(pianoMidiNoteCount);
      }
    }
    async function connectPianoMidi(){
      if(!root.isSecureContext)throw new Error('MIDI keyboard access requires the app to be opened over HTTPS or localhost.');
      if(!root.navigator||typeof root.navigator.requestMIDIAccess!=='function')throw new Error('This browser does not support Web MIDI. Try a browser with Web MIDI support, or continue using manual practice logging.');
      pianoMidiAccess=await root.navigator.requestMIDIAccess({sysex:false});
      const inputs=Array.from(pianoMidiAccess.inputs.values());
      if(!inputs.length)throw new Error('No MIDI input was detected. Connect and power on your keyboard, then try again.');
      for(const input of inputs)input.onmidimessage=onPianoMidiMessage;
      pianoMidiConnected=true;
      return inputs.map(input=>input.name||'MIDI keyboard').join(', ');
    }
    function resetPianoMidiCapture(){
      pianoMidiNoteCount=0;pianoMidiNotes=new Set();pianoMidiLow=null;pianoMidiHigh=null;pianoMidiStartedAt=0;
    }
    function bookProgress(book) {
      const total=Number(book&&book.total_pages), page=Number(book&&book.current_page);
      return Number.isFinite(total)&&total>0&&Number.isFinite(page)&&page>=0?Math.max(0,Math.min(100,Math.round(page/total*100))):null;
    }
    function bookCover(book) {
      const title=esc(book.title||'Book'), author=esc(book.author||'');
      return '<div class="reading-cover" aria-hidden="true"><span>'+title+'</span><small>'+author+'</small></div>';
    }
    function readingStarterMaterial(title) {
      if(title==='Cold Sassy Tree') return {
        subtitle:'Historical fiction · Coming of age',
        focus:'Family expectations, gossip, social convention, grief, independence, and early-20th-century Georgia.',
        vocab:[
          ['elopement','noun','a marriage undertaken secretly or without a conventional ceremony'],
          ['milliner','noun','someone who makes or sells hats'],
          ['widower','noun','a man whose spouse has died'],
          ['audacity','noun','boldness that may surprise or offend others'],
          ['propriety','noun','behavior considered acceptable by social standards'],
          ['confidant','noun','someone entrusted with private thoughts']
        ],
        quiz:[
          {q:'Who narrates Cold Sassy Tree?',options:['Will Tweedy','Rucker Blakeslee','Miss Love Simpson','A town historian'],answer:0},
          {q:'What event causes major controversy in the town?',options:['A business closes','Rucker marries Miss Love soon after being widowed','Will leaves Georgia','A train arrives'],answer:1}
        ],
        prompts:['How does Will’s perspective affect how you understand the adults around him?','When can community expectations become unfair to individuals?']
      };
      if(title==='The Book Thief') return {
        subtitle:'Historical fiction · Literary fiction',
        focus:'Narrative voice, grief, friendship, morality, wartime Germany, language, and symbolism.',
        vocab:[
          ['narrator','noun','the voice that tells a story'],
          ['omniscient','adjective','having knowledge beyond that of individual characters'],
          ['foreshadowing','noun','hints about events that will happen later'],
          ['bereavement','noun','the experience of losing someone through death'],
          ['compassion','noun','concern for another person’s suffering'],
          ['persecution','noun','sustained cruel or unjust treatment']
        ],
        quiz:[
          {q:'Who narrates The Book Thief?',options:['Liesel','Hans','Death','Rudy'],answer:2},
          {q:'Who helps Liesel begin learning to read?',options:['Hans Hubermann','Rudy Steiner','Rosa Hubermann','The mayor'],answer:0}
        ],
        prompts:['How does the unusual narrator change the way you experience the story?','How can language be used both to help and to harm people?']
      };
      return {
        subtitle:'Historical fiction',
        focus:'Early American history, public health, scientific knowledge, responsibility, and resilience.',
        vocab:[
          ['epidemic','noun','an unusually widespread occurrence of disease within a population'],
          ['contagion','noun','the spread of infectious illness'],
          ['quarantine','noun','restriction of movement to reduce possible disease transmission'],
          ['mortality','noun','deaths within a population or the likelihood of death'],
          ['apothecary','noun','a historical person who prepared or sold medicines'],
          ['resilience','noun','the capacity to adapt and recover during hardship']
        ],
        quiz:[
          {q:'Where does Mattie Cook live?',options:['Above her family’s coffeehouse in Philadelphia','On a farm outside Boston','In New York City','In a boarding school'],answer:0},
          {q:'What does Mattie hope to do with the family business?',options:['Close it','Expand and improve it','Sell it immediately','Move it to New York'],answer:1}
        ],
        prompts:['How does fear influence the characters’ choices?','What does Mattie learn about independence and responsibility?']
      };
    }
    function hydrateReadingFiles(files) {
      if(!root.document||!store.getReadingFileUrl)return;
      for(const file of files){
        if(!/^image\//.test(file.mime_type||''))continue;
        const img=root.document.querySelector('[data-reading-file-preview="'+file.id+'"]');
        if(!img||img.dataset.loaded==='true')continue;
        Promise.resolve(store.getReadingFileUrl(file)).then(url=>{const live=root.document&&root.document.querySelector('[data-reading-file-preview="'+file.id+'"]');if(live){live.src=url;live.dataset.loaded='true';}}).catch(()=>{});
      }
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
    function renderReadingHome(current) {
      const books=readingBooks(current), reading=books.filter(b=>b.status==='reading'), completed=books.filter(b=>b.status==='completed'&&String(b.completed_on||'').slice(0,7)===M.dayKey(getNow()).slice(0,7));
      const featured=reading[0]||books[0]||null;
      let html='<section class="reading-dashboard"><section class="reading-banner"><div><p class="page-kicker">Skills in Bloom · Reading</p><h2>Reading in Bloom</h2><p>A place for the stories you are growing through.</p></div><span>📚</span></section>';
      html+='<section class="panel reading-stats"><div><span>📖</span><strong>'+books.length+'</strong><small>books in library</small></div><div><span>📘</span><strong>'+reading.length+'</strong><small>currently reading</small></div><div><span>✓</span><strong>'+completed.length+'</strong><small>completed this month</small></div></section>';
      if(featured){
        const p=bookProgress(featured);
        html+='<section class="panel reading-featured"><div>'+bookCover(featured)+'</div><div><p class="page-kicker">'+(featured.status==='reading'?'Currently reading':'Your library')+'</p><h2>'+esc(featured.title)+'</h2><p>'+esc(featured.author)+'</p>'+(p==null?'<p class="habit-help">Add your edition page count and current page to start percentage tracking.</p>':'<div class="reading-progress"><span style="width:'+p+'%"></span></div><p class="habit-help">'+p+'% complete</p>')+'<div class="habit-actions">'+button('reading-open','Open book',' data-id="'+esc(featured.id)+'"',true)+button('reading-coach','Reading Coach',' data-id="'+esc(featured.id)+'"')+'</div></div></section>';
      }
      html+='<section class="panel reading-library"><div class="habit-heading"><div><p class="page-kicker">My library</p><h2>Your Physical Books</h2></div>'+button('reading-add-book','+ Add a book','',true)+'</div>';
      if(readingBookOpen) html+=renderReadingBookForm();
      html+='<div class="reading-library-list">'+books.map(book=>{const p=bookProgress(book);return '<article><div>'+bookCover(book)+'</div><div><h3>'+esc(book.title)+'</h3><p>'+esc(book.author)+'</p><small>'+esc(book.status.replace('_',' '))+(book.current_page!=null?' · p. '+esc(book.current_page):'')+(book.total_pages?' of '+esc(book.total_pages):'')+'</small>'+(p==null?'':'<div class="reading-progress small"><span style="width:'+p+'%"></span></div>')+'</div>'+button('reading-open',book.status==='not_started'?'Details':'Open',' data-id="'+esc(book.id)+'"')+'</article>';}).join('')+'</div></section>';
      html+='<div class="reading-two-col"><section class="panel"><p class="page-kicker">Today’s reading plan</p><h2>Read for 20 minutes</h2><p class="habit-help">A small, steady step toward your reading goals. Log the real session when you finish.</p>'+(featured?button('reading-start-session','Start / log reading',' data-id="'+esc(featured.id)+'"',true):'')+'</section><section class="panel"><p class="page-kicker">Recent vocabulary practice</p><h2>Words to Review</h2><div class="reading-word-chips">'+(current.readingVocabulary||[]).slice(-6).map(v=>'<span>'+esc(v.word)+'</span>').join('')+'</div>'+button('reading-coach','Practice more words',featured?' data-id="'+esc(featured.id)+'"':'',false,!featured)+'</section></div>';
      html+='<section class="panel habit-explainer"><details><summary>How the reading features work</summary><p class="habit-help">Reading progress, vocabulary, spelling, comprehension, and notes are tracked separately. Your physical books remain the source of truth for page and chapter content.</p><p class="habit-help">Starter lessons are thematic study material. Exact chapter vocabulary and questions require text you supply from your own copy.</p></details></section>'
        + '<section class="panel reading-backup"><details><summary>My reading records & backup</summary><p class="habit-help">Export or restore your books, sessions, notes, vocabulary, and quiz attempts. Private uploaded page images remain stored in your account and are not embedded in the JSON backup.</p><div class="habit-actions">'+button('reading-export','↓ Export Reading backup')+'<label class="button">↑ Import Reading backup<input type="file" accept="application/json" data-reading-import hidden></label></div></details></section></section>';
      return html;
    }
    function renderReadingBookForm(){
      const d=readingBookDraft;
      return '<form class="habit-form reading-book-form" data-reading-book-form><div class="habit-form-grid"><label class="habit-field"><span>Title</span><input required maxlength="240" data-reading-book-field="title" value="'+esc(d.title)+'"></label><label class="habit-field"><span>Author</span><input maxlength="240" data-reading-book-field="author" value="'+esc(d.author)+'"></label><label class="habit-field"><span>ISBN (optional)</span><input maxlength="40" data-reading-book-field="isbn" value="'+esc(d.isbn)+'"></label><label class="habit-field"><span>Edition (optional)</span><input maxlength="240" data-reading-book-field="edition" value="'+esc(d.edition)+'"></label><label class="habit-field"><span>Total printed pages</span><input type="number" min="1" max="10000" data-reading-book-field="total_pages" value="'+esc(d.total_pages)+'"></label><label class="habit-field"><span>Current page</span><input type="number" min="0" max="10000" data-reading-book-field="current_page" value="'+esc(d.current_page)+'"></label><label class="habit-field"><span>Current chapter / part</span><input maxlength="240" data-reading-book-field="current_section" value="'+esc(d.current_section)+'"></label><label class="habit-field"><span>Status</span><select data-reading-book-field="status"><option value="not_started"'+(d.status==='not_started'?' selected':'')+'>Not started</option><option value="reading"'+(d.status==='reading'?' selected':'')+'>Currently reading</option><option value="completed"'+(d.status==='completed'?' selected':'')+'>Completed</option></select></label></div><label class="habit-field"><span>Notes (optional)</span><textarea rows="3" maxlength="5000" data-reading-book-field="notes">'+esc(d.notes)+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save book</button>'+button('reading-cancel-book','Cancel')+'</div></form>';
    }
    function renderReadingDetail(current,book){
      const p=bookProgress(book),sessions=readingSessions(current,book.id),notes=readingNotes(current,book.id),vocab=readingVocabulary(current,book.id),files=readingFiles(current,book.id).filter(file=>file.file_role==='scan');
      const pagesRemaining=book.total_pages!=null&&book.current_page!=null?Math.max(0,Number(book.total_pages)-Number(book.current_page)):null;
      const minutes=sessions.reduce((sum,row)=>sum+Number(row.minutes||0),0), pages=sessions.reduce((sum,row)=>sum+Math.max(0,Number(row.end_page||0)-Number(row.start_page||0)),0);
      const pace=minutes>0&&pages>0?pages/minutes:null, est=pace&&pagesRemaining!=null?Math.round(pagesRemaining/pace):null;
      let html='<section class="reading-dashboard"><section class="reading-banner"><div><p class="page-kicker">Reading in Bloom</p><h2>Book Detail</h2></div>'+button('reading-home','← Library')+'</section><section class="panel reading-book-hero"><div>'+bookCover(book)+'</div><div><h1>'+esc(book.title)+'</h1><p>by '+esc(book.author)+'</p>'+(p==null?'<p class="habit-help">Progress percentage will appear after you add total pages and your current page.</p>':'<div class="reading-progress"><span style="width:'+p+'%"></span></div><p>'+p+'% complete</p>')+'<div class="habit-actions">'+button('reading-start-session','Resume / log reading',' data-id="'+esc(book.id)+'"',true)+button('reading-edit-book','Edit book',' data-id="'+esc(book.id)+'"')+button('reading-coach','Reading Coach',' data-id="'+esc(book.id)+'"')+'</div></div></section>';
      if(readingBookOpen)html+=renderReadingBookForm();
      if(readingSessionOpen)html+='<form class="panel habit-form" data-reading-session-form><p class="page-kicker">Reading session</p><h2>Log what you actually read</h2><div class="habit-form-grid"><label class="habit-field"><span>Minutes</span><input type="number" min="0" max="1440" required data-reading-session-field="minutes" value="'+esc(readingSessionDraft.minutes)+'"></label><label class="habit-field"><span>Start page</span><input type="number" min="0" max="10000" data-reading-session-field="start_page" value="'+esc(readingSessionDraft.start_page)+'"></label><label class="habit-field"><span>End page</span><input type="number" min="0" max="10000" data-reading-session-field="end_page" value="'+esc(readingSessionDraft.end_page)+'"></label><label class="habit-field"><span>Chapter / part</span><input maxlength="240" data-reading-session-field="section" value="'+esc(readingSessionDraft.section)+'"></label></div><label class="habit-field"><span>Session notes</span><textarea rows="3" data-reading-session-field="notes">'+esc(readingSessionDraft.notes)+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save session</button>'+button('reading-cancel-session','Cancel')+'</div></form>';
      html+='<section class="panel reading-progress-stats"><div><span>📄</span><strong>'+(book.current_page==null?'—':esc(book.current_page))+'</strong><small>current page</small></div><div><span>📚</span><strong>'+(pagesRemaining==null?'—':pagesRemaining)+'</strong><small>pages remaining</small></div><div><span>⏱️</span><strong>'+minutes+' min</strong><small>reading logged</small></div><div><span>⌛</span><strong>'+(est==null?'—':Math.floor(est/60)+'h '+(est%60)+'m')+'</strong><small>estimated time left</small></div></section>';
      html+='<div class="reading-two-col"><section class="panel"><div class="habit-heading"><div><p class="page-kicker">My notes & quotes</p><h2>Reading Journal</h2></div>'+button('reading-add-note','+ Add note','',true)+'</div>';
      if(readingNoteOpen)html+='<form class="habit-form" data-reading-note-form><div class="habit-form-grid"><label class="habit-field"><span>Type</span><select data-reading-note-field="note_type"><option value="note">Note</option><option value="quote">Quote</option><option value="question">Question</option><option value="character">Character</option><option value="theme">Theme</option></select></label><label class="habit-field"><span>Page</span><input type="number" min="0" max="10000" data-reading-note-field="page_number" value="'+esc(readingNoteDraft.page_number)+'"></label><label class="habit-field"><span>Chapter / part</span><input data-reading-note-field="section" value="'+esc(readingNoteDraft.section)+'"></label></div><label class="habit-field"><span>Your note</span><textarea required rows="4" data-reading-note-field="body">'+esc(readingNoteDraft.body)+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save note</button>'+button('reading-cancel-note','Cancel')+'</div></form>';
      html+=(notes.length?'<div class="reading-note-list">'+notes.slice(0,8).map(n=>'<article><small>'+esc(n.note_type)+' '+(n.page_number!=null?'· p. '+n.page_number:'')+'</small><p>'+esc(n.body)+'</p></article>').join('')+'</div>':'<p class="habit-help">No notes saved yet.</p>')+'</section><section class="panel"><p class="page-kicker">Words from your reading</p><h2>Vocabulary</h2><div class="reading-word-chips">'+vocab.slice(0,12).map(v=>'<span>'+esc(v.word)+'</span>').join('')+'</div>'+button('reading-coach','Open Reading Coach',' data-id="'+esc(book.id)+'"',true)+'</section></div>';
      const bookPdf=readingBookPdf(current,book.id);
      html+='<section class="panel reading-reader-launch"><div class="habit-heading"><div><p class="page-kicker">Kindle-style private reader</p><h2>Bloom Reader</h2><p class="habit-help">'+(bookPdf?'Full-book PDF saved privately'+(bookPdf.page_count?' · '+bookPdf.page_count+' PDF pages':'')+'. Open the reader to extract only the pages you choose.':'Upload your full-book PDF once. Bloom Reader will render pages privately and cache text only for selected ranges.')+'</p></div>'+(bookPdf?button('reading-reader','Open Bloom Reader',' data-id="'+esc(book.id)+'"',true):'<label class="button primary">Upload full-book PDF<input type="file" accept="application/pdf" data-reading-book-pdf hidden></label>')+'</div></section>';
      html+='<section class="panel reading-scans"><div class="habit-heading"><div><p class="page-kicker">Physical-book lesson source</p><h2>Scan Reading Pages</h2><p class="habit-help">Use this shelf for short page photos or small page PDFs. Full-book PDFs belong in Bloom Reader above.</p></div><label class="button primary">Upload page photos / short PDF<input type="file" data-reading-upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden></label></div><div class="reading-file-grid">'+(files.length?files.map(file=>'<article>'+(/^image\//.test(file.mime_type)?'<img data-reading-file-preview="'+esc(file.id)+'" alt="">':'<div class="reading-pdf">PDF</div>')+'<strong>'+esc(file.name)+'</strong><div class="habit-actions">'+button('reading-file-open','Open',' data-id="'+esc(file.id)+'"')+button('reading-file-delete','Remove scan',' data-id="'+esc(file.id)+'"')+'</div></article>').join(''):'<p class="habit-help">No short page scans saved for this book yet.</p>')+'</div><p class="habit-help">For an entire book, use <strong>Bloom Reader</strong>. This keeps full PDFs separate from short lesson-source scans.</p></section></section>';
      if(root.requestAnimationFrame)root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>hydrateReadingFiles(files)));
      return html;
    }
    function renderReadingFluencyProgress(current,book) {
      const rows=readingAudio(current,book.id)
        .slice()
        .sort((a,b)=>String(a.recorded_on||'').localeCompare(String(b.recorded_on||''))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
      if(!rows.length){
        return '<section class="panel reading-fluency-progress"><div class="habit-heading"><div><p class="page-kicker">Reading fluency progress</p><h2>Your Read-Aloud Growth</h2><p class="habit-help">Save at least one read-aloud recording to start your fluency timeline.</p></div></div></section>';
      }
      const wpmRows=rows.filter(row=>Number.isFinite(Number(row.words_per_minute)));
      const clarityRows=rows.filter(row=>Number.isFinite(Number(row.clarity_rating)));
      const confidenceRows=rows.filter(row=>Number.isFinite(Number(row.confidence_rating)));
      const first=wpmRows[0]||null, latest=wpmRows[wpmRows.length-1]||null;
      const delta=first&&latest?Math.round(Number(latest.words_per_minute)-Number(first.words_per_minute)):null;
      const latestClarity=clarityRows.length?Number(clarityRows[clarityRows.length-1].clarity_rating):null;
      const latestConfidence=confidenceRows.length?Number(confidenceRows[confidenceRows.length-1].confidence_rating):null;
      const maxWpm=wpmRows.length?Math.max(1,...wpmRows.map(row=>Number(row.words_per_minute)||0)):1;
      const points=rows.slice(-12).map((row,index)=>{
        const wpm=Number(row.words_per_minute);
        return '<div class="fluency-point"><div class="fluency-bar-wrap"><div class="fluency-bar '+(Number.isFinite(wpm)?'':'is-empty')+'" style="height:'+(Number.isFinite(wpm)?Math.max(8,Math.round(wpm/maxWpm*100)):8)+'%"></div></div><strong>'+(Number.isFinite(wpm)?Math.round(wpm):'—')+'</strong><small>'+esc(String(row.recorded_on||'').slice(5).replace('-','/'))+'</small></div>';
      }).join('');
      const firstDate=rows[0]&&rows[0].recorded_on?dateLabel(rows[0].recorded_on):'—';
      const latestDate=rows[rows.length-1]&&rows[rows.length-1].recorded_on?dateLabel(rows[rows.length-1].recorded_on):'—';
      return '<section class="panel reading-fluency-progress"><div class="habit-heading"><div><p class="page-kicker">Reading fluency progress</p><h2>Your Read-Aloud Growth</h2><p class="habit-help">This uses only your saved recordings for '+esc(book.title)+'. WPM is approximate and is shown only when the recording is tied to verified source text.</p></div><span class="habit-badge">'+rows.length+' recording'+(rows.length===1?'':'s')+'</span></div>'
        + '<div class="fluency-metrics">'
        + '<div><span>⚡</span><strong>'+(latest?Math.round(Number(latest.words_per_minute)):'—')+'</strong><small>latest WPM</small></div>'
        + '<div><span>↗</span><strong>'+(delta==null?'—':(delta>0?'+':'')+delta)+'</strong><small>WPM change</small></div>'
        + '<div><span>🔊</span><strong>'+(latestClarity==null?'—':latestClarity+'/5')+'</strong><small>latest clarity</small></div>'
        + '<div><span>🌱</span><strong>'+(latestConfidence==null?'—':latestConfidence+'/5')+'</strong><small>latest confidence</small></div>'
        + '</div>'
        + '<div class="fluency-chart"><div class="fluency-chart-head"><span>'+esc(firstDate)+'</span><strong>WPM trend</strong><span>'+esc(latestDate)+'</span></div><div class="fluency-bars">'+points+'</div></div>'
        + (first&&latest?'<p class="habit-help fluency-summary">'+(delta>0?'You are reading about '+Math.abs(delta)+' WPM faster than your first measured recording.':delta<0?'Your latest measured recording is '+Math.abs(delta)+' WPM slower than your first one; compare clarity and difficulty before treating that as a setback.':'Your first and latest measured WPM are about the same. Look at clarity, confidence, and the difficulty of the passage too.')+'</p>':'<p class="habit-help fluency-summary">More recordings with verified source text will make the WPM trend more meaningful.</p>')
        + '</section>';
    }
    function renderReadAloudStudio(current,book,file) {
      const rows=readingAudio(current,book.id),verified=verifiedRangeText(current,file.id,readerRangeStart,readerRangeEnd),sourceWords=wordCount(verified);
      const recording=readAloudRecorder&&readAloudRecorder.state==='recording';
      let draft='<div class="read-aloud-controls">'+(recording?button('read-aloud-stop','■ Stop recording','',true):button('read-aloud-start','● Start recording','',true,current.offline))+'<label class="button">Upload audio<input type="file" accept="audio/*" data-reading-audio-upload hidden></label></div>';
      if(readAloudBlob)draft+='<div class="read-aloud-preview"><audio controls src="'+esc(readAloudPreviewUrl)+'"></audio><div class="read-aloud-draft-grid"><label>Clarity<select data-read-aloud-field="clarity"><option value="">Not rated</option>'+[1,2,3,4,5].map(v=>'<option value="'+v+'"'+(String(readAloudClarity)===String(v)?' selected':'')+'>'+v+' / 5</option>').join('')+'</select></label><label>Confidence<select data-read-aloud-field="confidence"><option value="">Not rated</option>'+[1,2,3,4,5].map(v=>'<option value="'+v+'"'+(String(readAloudConfidence)===String(v)?' selected':'')+'>'+v+' / 5</option>').join('')+'</select></label><label class="wide">Notes<textarea rows="2" data-read-aloud-field="notes">'+esc(readAloudNotes)+'</textarea></label></div><p class="habit-help">'+Math.round(readAloudDuration)+' sec'+(sourceWords?' · '+sourceWords+' verified source words · ~'+Math.round(sourceWords/(readAloudDuration/60))+' WPM':' · Verify the selected page range to calculate WPM')+'</p>'+button('read-aloud-save','Save this recording','',true,current.offline)+'</div>';
      const cards=rows.length?rows.map(row=>'<article class="read-aloud-entry"><div><strong>'+esc(dateLabel(row.recorded_on))+(row.section?' · '+esc(row.section):'')+'</strong><small>'+(row.page_from?'Pages '+row.page_from+(row.page_to&&row.page_to!==row.page_from?'–'+row.page_to:'')+' · ':'')+Math.round(Number(row.duration_seconds||0))+' sec'+(row.words_per_minute!=null?' · '+Math.round(Number(row.words_per_minute))+' WPM':'')+'</small></div><audio controls preload="none" data-reading-audio-id="'+esc(row.id)+'"></audio><div class="read-aloud-ratings">'+(row.clarity_rating?'<span>Clarity '+row.clarity_rating+'/5</span>':'')+(row.confidence_rating?'<span>Confidence '+row.confidence_rating+'/5</span>':'')+'</div>'+(row.notes?'<p>'+esc(row.notes)+'</p>':'')+button('read-aloud-delete','Remove',' data-id="'+esc(row.id)+'"')+'</article>').join(''):'<p class="habit-help">No read-aloud recordings saved yet. Record the same type of passage over time to hear your fluency change.</p>';
      if(root.requestAnimationFrame)root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>hydrateReadingAudio(rows)));
      return '<section class="panel reader-read-aloud"><div class="habit-heading"><div><p class="page-kicker">Read aloud journal</p><h2>Record Your Reading</h2><p class="habit-help">Save dated recordings by book and page range so you can compare fluency over weeks or months. WPM is approximate and only calculated from verified source text.</p></div><span class="habit-badge">'+rows.length+' saved</span></div><div class="read-aloud-source"><strong>Current source:</strong> pages '+readerRangeStart+'–'+readerRangeEnd+' · '+sourceWords+' verified words</div>'+draft+'<div class="read-aloud-history">'+cards+'</div></section>';
    }
    function renderReadingTutorWorkspace(current,book) {
      const rows=readingAssignments(current,book.id),attachments=readingFiles(current,book.id).filter(file=>file.file_role==='assignment_attachment');
      let form='';
      if(readingAssignmentOpen){
        const d=readingAssignmentDraft;
        form='<form class="habit-form tutor-assignment-form" data-reading-assignment-form><div class="habit-form-grid"><label class="habit-field"><span>Assignment title</span><input required maxlength="240" data-reading-assignment-field="title" value="'+esc(d.title)+'"></label><label class="habit-field"><span>Due date</span><input type="date" data-reading-assignment-field="due_on" value="'+esc(d.due_on)+'"></label><label class="habit-field"><span>Status</span><select data-reading-assignment-field="status"><option value="draft"'+(d.status==='draft'?' selected':'')+'>Draft</option><option value="ready"'+(d.status==='ready'?' selected':'')+'>Ready for tutor</option><option value="reviewed"'+(d.status==='reviewed'?' selected':'')+'>Reviewed</option></select></label></div><label class="habit-field"><span>Tutor prompt / instructions</span><textarea rows="3" data-reading-assignment-field="prompt">'+esc(d.prompt)+'</textarea></label><label class="habit-field"><span>My written work</span><textarea rows="10" maxlength="20000" data-reading-assignment-field="body" placeholder="Write or paste your response here...">'+esc(d.body)+'</textarea></label><label class="habit-field"><span>Questions for my tutor</span><textarea rows="4" data-reading-assignment-field="tutor_questions" placeholder="What do you want help reviewing?">'+esc(d.tutor_questions)+'</textarea></label><div class="habit-actions"><button type="submit" class="button primary">Save assignment</button>'+button('reading-assignment-cancel','Cancel')+'</div></form>';
      }
      const list=rows.length?rows.map(row=>{const files=attachments.filter(file=>file.assignment_id===row.id);return '<article class="tutor-assignment-card"><div class="habit-heading"><div><strong>'+esc(row.title)+'</strong><small>'+(row.due_on?'Due '+esc(dateLabel(row.due_on))+' · ':'')+esc(row.status.replace('_',' '))+'</small></div><div class="habit-actions">'+button('reading-assignment-edit','Edit',' data-id="'+esc(row.id)+'"')+button('reading-assignment-delete','Remove',' data-id="'+esc(row.id)+'"')+'</div></div>'+(row.prompt?'<p><b>Prompt:</b> '+esc(row.prompt)+'</p>':'')+(row.body?'<details><summary>My written work</summary><p class="tutor-written-work">'+esc(row.body).replace(/\n/g,'<br>')+'</p></details>':'')+(row.tutor_questions?'<p><b>Questions for tutor:</b> '+esc(row.tutor_questions)+'</p>':'')+'<div class="tutor-attachment-row"><label class="button">Attach image / PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-reading-assignment-upload data-id="'+esc(row.id)+'" multiple hidden></label>'+files.map(file=>'<span>'+esc(file.name)+' '+button('reading-file-open','Open',' data-id="'+esc(file.id)+'"')+button('reading-file-delete','×',' data-id="'+esc(file.id)+'"')+'</span>').join('')+'</div></article>';}).join(''):'<p class="habit-help">No tutor assignments saved yet. Use this for essays, chapter responses, worksheets, or questions you want to review together.</p>';
      return '<section class="panel reading-tutor-workspace"><div class="habit-heading"><div><p class="page-kicker">Tutor workspace</p><h2>Written Assignments & Review</h2><p class="habit-help">Keep your own writing, tutor prompts, questions, and supporting images/PDFs in one place beside the book.</p></div>'+button('reading-assignment-add','+ New assignment','',true)+'</div>'+form+'<div class="tutor-assignment-list">'+list+'</div></section>';
    }
    function renderBloomReader(current,book,file){
      if(!file) return '<section class="reading-dashboard"><section class="reading-banner"><div><p class="page-kicker">Bloom Reader</p><h2>'+esc(book.title)+'</h2><p>Upload the full PDF to begin.</p></div>'+button('reading-detail','← Book Detail',' data-id="'+esc(book.id)+'"')+'</section><section class="panel"><h2>Private book PDF</h2><p class="habit-help">The PDF stays in your private Reading storage. Bloom Reader extracts only the pages you choose.</p><label class="button primary">Upload full-book PDF<input type="file" accept="application/pdf" data-reading-book-pdf hidden></label></section></section>';
      const pageTexts=readingPageTexts(current,file.id),currentRecord=pageTexts.find(row=>Number(row.page_number)===readerPage);
      const total=file.page_count||'…',verifiedInRange=pageTexts.filter(row=>row.verified&&Number(row.page_number)>=readerRangeStart&&Number(row.page_number)<=readerRangeEnd);
      const usable=currentRecord?String(currentRecord.verified_text||currentRecord.raw_text||''):'';
      if(readerTextDraftPage!==readerPage){readerTextDraft=usable;readerTextDraftPage=readerPage;}
      let lesson='';
      if(readerLesson){
        lesson='<section class="panel reader-lesson-draft"><div class="habit-heading"><div><p class="page-kicker">Verified-source lesson draft</p><h2>Pages '+readerLesson.start+'–'+readerLesson.end+'</h2></div><span class="habit-badge">'+readerLesson.pages+' verified pages</span></div><div class="reading-two-col"><div><h3>Vocabulary candidates</h3><div class="reading-word-chips">'+readerLesson.words.map(word=>'<span>'+esc(word)+'</span>').join('')+'</div><p class="habit-help">These words were selected directly from your verified page text. Definitions/answer keys will be added when the AI lesson-generation service is connected.</p></div><div><h3>Comprehension prompts</h3><ol class="reader-prompts"><li>Summarize the most important events or ideas in these pages.</li><li>What changed for a character, conflict, setting, or idea in this range?</li><li>Choose one claim about these pages and support it with evidence from the verified text.</li></ol></div></div><div><h3>Spelling set</h3><p class="habit-help">'+readerLesson.words.slice(0,8).map(esc).join(' · ')+'</p></div></section>';
      }
      const html='<section class="reading-dashboard bloom-reader"><section class="reading-banner"><div><p class="page-kicker">Bloom Reader</p><h2>'+esc(book.title)+'</h2><p>Private PDF reader · text layer first · OCR fallback</p></div>'+button('reading-detail','← Book Detail',' data-id="'+esc(book.id)+'"')+'</section>'
        + '<section class="panel reader-toolbar"><div class="reader-page-controls">'+button('reader-prev','←')+'<label>Page <input type="number" min="1" data-reader-page value="'+readerPage+'"></label><span>of <b data-reader-total-pages>'+esc(total)+'</b></span>'+button('reader-next','→')+'</div><div class="reader-view-controls">'+button('reader-mode','PDF',' data-mode="pdf"',readerMode==='pdf')+button('reader-mode','Reading View',' data-mode="text"',readerMode==='text')+button('reader-zoom-out','A−')+button('reader-zoom-in','A+')+'</div></section>'
        + '<section class="reader-workspace"><div class="panel reader-page-panel">'+(readerMode==='pdf'?'<div class="reader-canvas-wrap"><canvas data-bloom-reader-canvas></canvas></div>':'<article class="reader-text-view" style="font-size:'+readerTextSize+'px;line-height:'+readerLineHeight+'">'+(usable?'<p>'+esc(usable).replace(/\n/g,'</p><p>')+'</p>':'<p class="habit-help">Extract this page first to create Reading View text.</p>')+'</article>')+'</div>'
        + '<aside class="panel reader-coach-panel"><p class="page-kicker">Lesson source range</p><h2>Extract selected pages</h2><div class="reader-range"><label>From <input type="number" min="1" data-reader-range="start" value="'+readerRangeStart+'"></label><label>To <input type="number" min="1" data-reader-range="end" value="'+readerRangeEnd+'"></label></div><p class="habit-help">Bloom Reader uses the PDF text layer first. If a page has too little usable text, it automatically renders that page and runs OCR in a Web Worker.</p>'+button('reader-extract','Extract / OCR range','',true,current.offline)+'<p class="reader-status" data-reader-status>'+esc(readerStatus||'Ready')+'</p><hr><p class="page-kicker">Generate My Lesson</p><p class="habit-help">'+verifiedInRange.length+' verified page'+(verifiedInRange.length===1?'':'s')+' in this range.</p>'+button('reader-generate-lesson','Generate lesson draft','',true,verifiedInRange.length===0)+'</aside></section>'
        + '<section class="panel reader-review"><div class="habit-heading"><div><p class="page-kicker">Review OCR / extracted text</p><h2>PDF page '+readerPage+'</h2><p class="habit-help">'+(currentRecord?'Method: '+esc(currentRecord.extraction_method.replace('_',' '))+(currentRecord.verified?' · Verified':' · Not verified'):'Extract this page or a range first.')+'</p></div>'+(currentRecord&&currentRecord.verified?'<span class="habit-badge">✓ Verified</span>':'')+'</div><textarea data-reader-page-text rows="16" placeholder="Extract the page to review its text.">'+esc(readerTextDraft)+'</textarea><div class="habit-actions">'+button('reader-save-text','Save correction','',false,!currentRecord)+button('reader-verify-text','Save & mark verified','',true,!currentRecord)+'</div><p class="habit-help">Only text you mark verified is allowed into Generate My Lesson.</p></section>'
        + lesson
        + '<section class="panel reader-listen-panel"><div class="habit-heading"><div><p class="page-kicker">Text reader</p><h2>Listen & Follow Along</h2><p class="habit-help">Hear the extracted text while following the page. This uses your browser voice and never uploads the spoken audio.</p></div></div><div class="reader-listen-controls">'+button('reader-listen','▶ Listen')+button('reader-speech-pause','Pause')+button('reader-speech-resume','Resume')+button('reader-speech-stop','Stop')+'<label>Speed <select data-reader-speech-rate><option value=".8"'+(readerSpeechRate===.8?' selected':'')+'>0.8×</option><option value="1"'+(readerSpeechRate===1?' selected':'')+'>1×</option><option value="1.2"'+(readerSpeechRate===1.2?' selected':'')+'>1.2×</option><option value="1.4"'+(readerSpeechRate===1.4?' selected':'')+'>1.4×</option></select></label>'+button('reader-text-smaller','A−')+button('reader-text-larger','A+')+button('reader-line-toggle','Line spacing')+'</div></section>'
        + renderReadAloudStudio(current,book,file)
        + renderReadingFluencyProgress(current,book)
        + renderReadingTutorWorkspace(current,book)
        + '<section class="panel reader-cache-summary"><details><summary>Cached pages · '+pageTexts.length+'</summary><div class="reader-page-cache">'+pageTexts.map(row=>'<button type="button" data-habit-action="reader-jump" data-page="'+row.page_number+'" class="'+(row.verified?'is-verified':'')+'"><strong>'+row.page_number+'</strong><small>'+esc(row.extraction_method==='ocr'?'OCR':'Text')+(row.verified?' · ✓':'')+'</small></button>').join('')+'</div></details></section></section>';
      if(root.requestAnimationFrame)root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>hydrateBloomReader(current,book,file)));
      return html;
    }
    function renderReadingCoach(current,book){
      const starter=readingStarterMaterial(book.title),saved=readingVocabulary(current,book.id);
      const words=saved.length?saved:starter.vocab.map(row=>({word:row[0],part_of_speech:row[1],definition:row[2],source_label:'coach_suggested'}));
      let body='';
      if(readingCoachTab==='vocabulary') body='<section class="panel reading-coach-panel"><p class="page-kicker">Starter thematic material</p><h2>Vocabulary</h2><p class="habit-help">These terms are introductory study material, not claims that they appear in your current chapter. Save exact book words after confirming them from your copy.</p><div class="reading-vocab-list">'+words.map(w=>'<article><button type="button" class="reading-speak" data-habit-action="reading-speak" data-word="'+esc(w.word)+'">🔊</button><div><h3>'+esc(w.word)+'</h3><small>'+esc(w.part_of_speech||'')+'</small><p>'+esc(w.definition||'')+'</p></div>'+(!saved.length?button('reading-save-word','Save',' data-word="'+esc(w.word)+'"'):'')+'</article>').join('')+'</div></section>';
      else if(readingCoachTab==='spelling') body='<section class="panel reading-coach-panel"><p class="page-kicker">Spelling practice</p><h2>Hear & Spell</h2><p class="habit-help">Use the speaker to hear a word, then spell it without looking. Saved book-confirmed vocabulary can be added to spelling practice.</p><div class="reading-spelling-list">'+words.slice(0,8).map(w=>'<article><strong>'+esc(w.word)+'</strong>'+button('reading-speak','Hear',' data-word="'+esc(w.word)+'"')+'<input type="text" aria-label="Spell '+esc(w.word)+'" placeholder="Type from memory"></article>').join('')+'</div></section>';
      else body='<section class="panel reading-coach-panel"><p class="page-kicker">Introductory comprehension</p><h2>Practice Questions</h2><p class="habit-help">These are broad introductory questions from verified public book information, not a chapter-specific quiz. Chapter quizzes should wait for your supplied pages.</p><form data-reading-quiz-form>'+starter.quiz.map((q,i)=>'<fieldset><legend>Q'+(i+1)+'. '+esc(q.q)+'</legend>'+q.options.map((opt,j)=>'<label><input type="radio" name="q'+i+'" value="'+j+'"> '+esc(opt)+'</label>').join('')+'</fieldset>').join('')+'<button class="button primary" type="submit">Submit practice quiz</button></form><div class="reading-written-prompts"><h3>Written response prompts</h3>'+starter.prompts.map(p=>'<label>'+esc(p)+'<textarea rows="3" placeholder="Write your response here..."></textarea></label>').join('')+'</div></section>';
      return '<section class="reading-dashboard"><section class="reading-banner"><div><p class="page-kicker">Reading Coach</p><h2>'+esc(book.title)+'</h2><p>'+esc(starter.focus)+'</p></div>'+button('reading-detail','← Book Detail',' data-id="'+esc(book.id)+'"')+'</section><nav class="reading-book-switcher">'+readingBooks(current).map(b=>'<button data-habit-action="reading-coach" data-id="'+esc(b.id)+'" aria-pressed="'+(b.id===book.id)+'">'+bookCover(b)+'<strong>'+esc(b.title)+'</strong></button>').join('')+'</nav><nav class="reading-coach-tabs"><button data-habit-action="reading-coach-tab" data-tab="spelling" aria-pressed="'+(readingCoachTab==='spelling')+'">✎ Spelling Words</button><button data-habit-action="reading-coach-tab" data-tab="vocabulary" aria-pressed="'+(readingCoachTab==='vocabulary')+'">📖 Vocabulary</button><button data-habit-action="reading-coach-tab" data-tab="comprehension" aria-pressed="'+(readingCoachTab==='comprehension')+'">💬 Comprehension</button></nav>'+body+'<section class="panel habit-explainer"><details><summary>How the Reading Coach works</summary><p class="habit-help">Starter terms and introductory questions are separated from material confirmed in your physical book. Exact passage lessons should cite the supplied page scans or text.</p></details></section></section>';
    }
    function renderReading(current){
      const books=readingBooks(current);
      if(current.user&&current.household&&!current.offline&&current.status==='ready'&&books.length<3&&readingSeedChecked!==current.user.id+':'+current.household.id&&store.ensureReadingStarterBooks){
        readingSeedChecked=current.user.id+':'+current.household.id;
        Promise.resolve(store.ensureReadingStarterBooks()).catch(()=>{readingSeedChecked='';});
      }
      const selected=readingBook(current,selectedReadingBookId)||books[0]||null;
      if(selected&&!selectedReadingBookId)selectedReadingBookId=selected.id;
      if(readingView==='detail'&&selected)return renderReadingDetail(current,selected);
      if(readingView==='reader'&&selected)return renderBloomReader(current,selected,readingBookPdf(current,selected.id));
      if(readingView==='coach'&&selected)return renderReadingCoach(current,selected);
      return renderReadingHome(current);
    }
    function renderPianoDashboard(current,today) {
      const apps=pianoRows(current,'pianoAppProgress').slice().sort((a,b)=>String(a.app_name).localeCompare(String(b.app_name))||String(a.course_name).localeCompare(String(b.course_name)));
      const sessions=pianoRows(current,'pianoPracticeSessions').slice().sort((a,b)=>String(b.occurred_on).localeCompare(String(a.occurred_on))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
      const abilities=pianoRows(current,'pianoAbilities');
      const repertoire=pianoRows(current,'pianoRepertoire').slice().sort((a,b)=>String(a.status).localeCompare(String(b.status))||String(a.title).localeCompare(String(b.title)));
      const media=pianoMediaRows(current);
      if(current.user&&current.household&&!current.offline&&current.status==='ready'&&pianoSeedChecked!==current.user.id+':'+current.household.id&&store.ensurePianoDefaults){
        pianoSeedChecked=current.user.id+':'+current.household.id;
        Promise.resolve(store.ensurePianoDefaults()).catch(()=>{pianoSeedChecked='';});
      }
      const weekStart=M.addDays(today,-6),weekMinutes=sessions.filter(row=>row.occurred_on>=weekStart&&row.occurred_on<=today).reduce((sum,row)=>sum+Number(row.duration_minutes||0),0);
      const monthMinutes=sessions.filter(row=>String(row.occurred_on||'').slice(0,7)===today.slice(0,7)).reduce((sum,row)=>sum+Number(row.duration_minutes||0),0);
      const mastered=repertoire.filter(row=>row.status==='mastered').length;
      const pianoSessionsUrl='https://www.pianosessions.com/';
      const playgroundUrl='https://www.playgroundsessions.com/learning';
      const appCards=apps.length?apps.map(row=>'<article class="piano-app-card"><div class="piano-app-icon">'+(row.app_name==='PianoSessions'?'🎹':'🎧')+'</div><div><p class="page-kicker">'+esc(row.app_name)+'</p><h3>'+esc(row.course_name)+'</h3><p>'+esc(row.lesson_name||'Lesson not entered')+'</p><small>'+esc(row.status.replace('_',' '))+(row.progress_percent!=null?' · '+Math.round(Number(row.progress_percent))+'% progress':' · progress not entered')+(row.accuracy_percent!=null?' · '+Math.round(Number(row.accuracy_percent))+'% accuracy':'')+'</small></div>'+button('piano-edit-app','Log progress',' data-id="'+esc(row.id)+'"')+'</article>').join(''):'<p class="habit-help">Setting up your learning-app records…</p>';
      let appForm='';
      if(pianoAppEditId){
        const row=pianoAppDraft||apps.find(item=>item.id===pianoAppEditId);
        if(row)appForm='<form class="habit-form piano-inline-form" data-piano-app-form><input type="hidden" data-piano-app-field="id" value="'+esc(row.id)+'"><div class="habit-form-grid"><label class="habit-field"><span>App</span><input disabled value="'+esc(row.app_name)+'"></label><label class="habit-field"><span>Course</span><input disabled value="'+esc(row.course_name)+'"></label><label class="habit-field"><span>Current lesson / exercise</span><input maxlength="240" data-piano-app-field="lesson_name" value="'+esc(row.lesson_name||'')+'"></label><label class="habit-field"><span>Progress %</span><input type="number" min="0" max="100" step="any" data-piano-app-field="progress_percent" value="'+esc(row.progress_percent==null?'':row.progress_percent)+'"></label><label class="habit-field"><span>Accuracy % (if app reports it)</span><input type="number" min="0" max="100" step="any" data-piano-app-field="accuracy_percent" value="'+esc(row.accuracy_percent==null?'':row.accuracy_percent)+'"></label><label class="habit-field"><span>Status</span><select data-piano-app-field="status">'+['not_started','started','active','completed'].map(v=>'<option value="'+v+'"'+(row.status===v?' selected':'')+'>'+esc(v.replace('_',' '))+'</option>').join('')+'</select></label></div><label class="habit-field"><span>Notes</span><textarea rows="3" data-piano-app-field="notes">'+esc(row.notes||'')+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save progress</button>'+button('piano-cancel-app','Cancel')+'</div></form>';
      }
      let practiceForm='';
      if(pianoPracticeOpen){
        const d=pianoPracticeDraft;
        practiceForm='<form class="habit-form piano-inline-form" data-piano-practice-form><div class="habit-form-grid"><label class="habit-field"><span>Minutes</span><input type="number" min="1" max="1440" required data-piano-practice-field="duration_minutes" value="'+esc(d.duration_minutes)+'"></label><label class="habit-field"><span>Source</span><select data-piano-practice-field="source">'+['PianoSessions','Playground Sessions','independent'].map(v=>'<option value="'+v+'"'+(d.source===v?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label><label class="habit-field"><span>Course</span><input data-piano-practice-field="course_name" value="'+esc(d.course_name)+'"></label><label class="habit-field"><span>Lesson</span><input data-piano-practice-field="lesson_name" value="'+esc(d.lesson_name)+'"></label><label class="habit-field"><span>Piece / chord / exercise</span><input data-piano-practice-field="piece_name" value="'+esc(d.piece_name)+'"></label><label class="habit-field"><span>Accuracy % (optional)</span><input type="number" min="0" max="100" step="any" data-piano-practice-field="accuracy_percent" value="'+esc(d.accuracy_percent)+'"></label></div><label class="habit-field"><span>Practice notes</span><textarea rows="3" data-piano-practice-field="notes">'+esc(d.notes)+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save session</button>'+button('piano-cancel-practice','Cancel')+'</div></form>';
      }
      let repertoireForm='';
      if(pianoRepertoireOpen){
        const d=pianoRepertoireDraft;
        repertoireForm='<form class="habit-form piano-inline-form" data-piano-repertoire-form><div class="habit-form-grid"><label class="habit-field"><span>Piece / chord / skill</span><input required maxlength="240" data-piano-repertoire-field="title" value="'+esc(d.title)+'"></label><label class="habit-field"><span>Type</span><select data-piano-repertoire-field="kind">'+['piece','chord','pattern','exercise'].map(v=>'<option value="'+v+'"'+(d.kind===v?' selected':'')+'>'+v+'</option>').join('')+'</select></label><label class="habit-field"><span>Status</span><select data-piano-repertoire-field="status">'+['learning','practicing','independent','mastered'].map(v=>'<option value="'+v+'"'+(d.status===v?' selected':'')+'>'+v+'</option>').join('')+'</select></label><label class="habit-field"><span>Learned from</span><input data-piano-repertoire-field="source" value="'+esc(d.source)+'"></label></div><label class="habit-field"><span>Notes</span><textarea rows="3" data-piano-repertoire-field="notes">'+esc(d.notes)+'</textarea></label><div class="habit-actions"><button class="button primary" type="submit">Save repertoire item</button>'+button('piano-cancel-repertoire','Cancel')+'</div></form>';
      }
      const abilityCards=['sheet_music','rhythm','technique','chords','repertoire','expression'].map(key=>{
        const info=pianoAbilityInfo(key),row=abilities.find(item=>item.ability_key===key)||{ability_key:key,state:'not_assessed',evidence:''};
        return '<article class="piano-ability-card"><span>'+info[0]+'</span><div><strong>'+esc(info[1])+'</strong><small>'+esc(info[2])+'</small></div><select data-piano-ability data-key="'+key+'">'+['not_assessed','not_started','developing','practicing','consistent','demonstrated'].map(v=>'<option value="'+v+'"'+(row.state===v?' selected':'')+'>'+pianoStateLabel(v)+'</option>').join('')+'</select></article>';
      }).join('');
      const repCards=repertoire.length?repertoire.map(row=>'<article><span>'+(row.kind==='chord'?'🎹':row.kind==='pattern'?'🔁':row.kind==='exercise'?'🎼':'🎵')+'</span><div><strong>'+esc(row.title)+'</strong><small>'+esc(row.status)+' · '+esc(row.source||'source not entered')+'</small>'+(row.notes?'<p>'+esc(row.notes)+'</p>':'')+'</div></article>').join(''):'<p class="habit-help">Nothing in your repertoire yet. Add pieces, chords, accompaniment patterns, or exercises only when you actually begin working on them.</p>';
      const history=sessions.length?sessions.slice(0,12).map(row=>'<article><strong>'+esc(dateLabel(row.occurred_on))+' · '+row.duration_minutes+' min</strong><small>'+esc(row.source)+(row.course_name?' · '+esc(row.course_name):'')+(row.piece_name?' · '+esc(row.piece_name):'')+(row.accuracy_percent!=null?' · '+Math.round(Number(row.accuracy_percent))+'% accuracy':'')+'</small>'+(row.source==='midi'?'<p>'+Number(row.midi_note_count||0)+' note-ons · '+Number(row.midi_unique_notes||0)+' unique notes · range '+esc(midiName(row.midi_low_note))+'–'+esc(midiName(row.midi_high_note))+'</p>':'')+(row.notes?'<p>'+esc(row.notes)+'</p>':'')+'</article>').join(''):'<p class="habit-help">No piano practice sessions logged yet.</p>';
      const mediaCards=media.length?media.slice(0,12).map(row=>'<article class="piano-media-card"><div class="piano-media-preview">'+(row.media_type==='video'?'<video controls preload="metadata" data-piano-media-id="'+esc(row.id)+'"></video>':'<audio controls preload="none" data-piano-media-id="'+esc(row.id)+'"></audio>')+'</div><div><strong>'+esc(row.title)+'</strong><small>'+esc(dateLabel(row.recorded_on))+(row.piece_name?' · '+esc(row.piece_name):'')+'</small>'+(row.notes?'<p>'+esc(row.notes)+'</p>':'')+'</div>'+button('piano-media-delete','Remove',' data-id="'+esc(row.id)+'"')+'</article>').join(''):'<p class="habit-help">No private practice recordings saved yet. Upload an early sample now so future-you has something real to compare against.</p>';
      if(root.requestAnimationFrame)root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>hydratePianoMedia(media)));
      return '<section class="piano-dashboard">'
        + '<section class="piano-banner"><div><p class="page-kicker">Skills in Bloom · Music</p><h2>Piano in Bloom</h2><p>A place for every note you learn to play.</p></div><span>🎹</span></section>'
        + '<section class="piano-summary panel"><div><strong>Beginner</strong><small>Self-directed learning</small></div><div><strong>'+apps.filter(row=>row.status!=='not_started').length+'</strong><small>courses started</small></div><div><strong>'+monthMinutes+'</strong><small>minutes logged this month</small></div><div><strong>'+mastered+'</strong><small>pieces / skills mastered</small></div></section>'
        + '<section class="panel piano-today"><div class="habit-heading"><div><p class="page-kicker">Today’s piano practice</p><h2>20 Minutes</h2><p class="habit-help">5 min warm-up & note recognition · 10 min current app lesson · 5 min independent playing and review.</p></div><div class="habit-actions">'+button('piano-log-practice','Log practice','',true)+button('piano-midi-connect',pianoMidiConnected?'MIDI Connected ✓':'Connect MIDI Keyboard')+'</div></div>'+practiceForm+'</section>'
        + '<section class="piano-apps panel"><div class="habit-heading"><div><p class="page-kicker">My learning apps</p><h2>Current Records</h2></div></div><div class="piano-app-grid">'+appCards+'</div>'+appForm+'<div class="piano-app-links"><a href="'+pianoSessionsUrl+'" target="_blank" rel="noopener noreferrer">Open PianoSessions ↗</a><a href="'+playgroundUrl+'" target="_blank" rel="noopener noreferrer">Open Playground Sessions ↗</a></div></section>'
        + '<section class="panel piano-midi"><div class="habit-heading"><div><p class="page-kicker">USB / MIDI keyboard</p><h2>Live MIDI Practice</h2><p class="habit-help">MIDI can confirm keyboard activity and note range. It does not by itself prove musical accuracy, rhythm quality, posture, or expression.</p></div><span class="habit-badge">'+(pianoMidiConnected?'Connected':'Not connected')+'</span></div><div class="piano-midi-metrics"><span><strong data-piano-midi-count>'+pianoMidiNoteCount+'</strong><small>note-ons</small></span><span><strong>'+pianoMidiNotes.size+'</strong><small>unique notes</small></span><span><strong>'+esc(midiName(pianoMidiLow))+'</strong><small>lowest</small></span><span><strong>'+esc(midiName(pianoMidiHigh))+'</strong><small>highest</small></span></div><div class="habit-actions">'+button('piano-midi-connect','Connect keyboard','',false,pianoMidiConnected)+button(pianoMidiRecording?'piano-midi-stop':'piano-midi-start',pianoMidiRecording?'Stop & save MIDI session':'Start MIDI session','',true,!pianoMidiConnected)+'</div></section>'
        + '<section class="panel piano-abilities"><div class="habit-heading"><div><p class="page-kicker">Six musical abilities</p><h2>Skill Progress</h2><p class="habit-help">Starting a course does not automatically establish ability. Update a state only when your own playing provides evidence.</p></div></div><div class="piano-ability-grid">'+abilityCards+'</div></section>'
        + '<div class="piano-two-col"><section class="panel piano-repertoire"><div class="habit-heading"><div><p class="page-kicker">My repertoire</p><h2>What I Can Play</h2></div>'+button('piano-add-repertoire','+ Add item','',true)+'</div>'+repertoireForm+'<div class="piano-repertoire-list">'+repCards+'</div></section>'
        + '<section class="panel piano-weekly"><p class="page-kicker">Manageable weekly plan</p><h2>65 Minutes / Week</h2><article><strong>Session A · Classical 1</strong><span>20 min</span><p>5 min warm-up · 10 min lesson · 5 min independent playing</p></article><article><strong>Session B · Pop Chords 1</strong><span>20 min</span><p>5 min chord review · 10 min lesson · 5 min chord changes</p></article><article><strong>Session C · Playground Sessions</strong><span>25 min</span><p>5 min warm-up · 15 min Rookie Bootcamp · 5 min review</p></article><p class="habit-help">This week: '+weekMinutes+' minutes logged.</p></section></div>'
        + '<section class="panel piano-media"><div class="habit-heading"><div><p class="page-kicker">Practice journal · private files</p><h2>Audio & Video Progress</h2><p class="habit-help">Save recordings over time so you can hear rhythm, confidence, smoothness, dynamics, and independence improve. Video can also help you review hands, tension, and posture.</p></div><label class="button primary">Upload audio / video<input type="file" accept="audio/*,video/*" data-piano-media-upload hidden></label></div><div class="piano-media-meta"><label>Title<input data-piano-media-field="title" value="'+esc(pianoMediaMeta.title)+'"></label><label>Piece / exercise<input data-piano-media-field="piece_name" value="'+esc(pianoMediaMeta.piece_name)+'"></label><label>Notes<input data-piano-media-field="notes" value="'+esc(pianoMediaMeta.notes)+'"></label></div><div class="piano-media-list">'+mediaCards+'</div></section>'
        + '<section class="panel piano-milestones"><p class="page-kicker">First three months</p><h2>Learning Milestones</h2><div class="piano-milestone-grid"><article><b>Month 1</b><h3>Establish foundations</h3><p>Identify keys, begin basic notation/rhythm, learn simple chord shapes, and save your first independent playing sample.</p></article><article><b>Month 2</b><h3>Develop coordination</h3><p>Play a simple melody at a steady tempo, change between familiar chords, and begin two-hand coordination.</p></article><article><b>Month 3</b><h3>Demonstrate progress</h3><p>Record one simple classical piece and one basic pop accompaniment pattern independently with reasonably steady rhythm.</p></article></div></section>'
        + '<section class="panel piano-history"><div class="habit-heading"><div><p class="page-kicker">Practice journal</p><h2>Recent Sessions</h2></div></div><div class="piano-session-list">'+history+'</div></section>'
        + '</section>';
    }

    function renderMathDashboard(current, skills, sessions, today) {
      const mathSkills=skills.filter(skill=>skill.category==='math');
      const ids=new Set(mathSkills.map(skill=>skill.id));
      const mathSessions=sessions.filter(row=>ids.has(row.skill_id));
      const weekAgo=M.addDays(today,-6);
      const weekMinutes=mathSessions.filter(row=>row.occurred_on>=weekAgo&&row.occurred_on<=today).reduce((sum,row)=>sum+Number(row.minutes||0),0);
      const month=today.slice(0,7);
      const monthMinutes=mathSessions.filter(row=>String(row.occurred_on||'').slice(0,7)===month).reduce((sum,row)=>sum+Number(row.minutes||0),0);
      const due=mathSkills.filter(skill=>M.skillProgress(skill,mathSessions,today).due).length;
      const baseline=[
        ['Foundations',53,'Strongest documented algebra-foundation unit'],
        ['Algebraic Expressions',18,'Expressions, like terms, distribution'],
        ['Linear Equations & Inequalities',21,'Multi-step equations, proportions, inequalities'],
        ['Integrated Math 1',4,'Recorded higher-level exposure'],
        ['AP / College Statistics',2,'Recorded higher-level exposure'],
        ['College Algebra',1,'Recorded higher-level exposure']
      ];
      const queue=[
        ['1','Fractions & signed division','Close prerequisite gaps'],
        ['2','Percentages & decimals','Strengthen arithmetic fluency'],
        ['3','Ratios & proportions','Build pre-algebra fluency'],
        ['4','Writing algebraic expressions','Move beyond evaluation'],
        ['5','Combining like terms','Build expression fluency'],
        ['6','Distributive property','Prepare for equation solving'],
        ['7','Multi-step equations','Extend one/two-step mastery'],
        ['8','Proportional reasoning','Connect equations and real problems'],
        ['9','Graphing lines & slope','Prepare for Algebra 1 functions']
      ];
      const roadmap=[
        ['1','Current · Strengthening pre-algebra','Integers, roots, order of operations, basic equations; close fraction/percent/ratio gaps.'],
        ['2','Next · Algebra readiness','Fractions, percentages, ratios, expressions, equations, coordinate graphs, and basic geometry.'],
        ['3','College Ready · College Algebra level','Demonstrate algebra, functions, geometry, and quantitative reasoning for credit-bearing college math.'],
        ['4','STEM Ready · Calculus I preparation','Strong Algebra 2, trigonometry, functions, and precalculus before calculus-based engineering/science.'],
        ['5','College Proficient · University mathematics','Actual college-level work: calculus, statistics, linear algebra, differential equations, or equivalent rigor.']
      ];
      const sequence=[
        ['Foundations','Fractions, signed division, percentages, decimals','Close prerequisite gaps'],
        ['Grade 5–7 selective review','Ratios, proportions, arithmetic applications','Demonstrate pre-algebra fluency'],
        ['Algebraic Expressions','Writing expressions, like terms, distribution','80%+ unit mastery target'],
        ['Linear Equations & Inequalities','Word problems, multi-step equations, proportions','80%+ unit mastery target'],
        ['Graphing Lines & Slope','Coordinates, linear relationships, slope','Pass a fresh unit assessment'],
        ['Algebra 1','Functions, equations, systems, quadratics','80%+ course mastery target'],
        ['Geometry & Algebra 2','Proofs, factoring, polynomials, advanced functions','Build college-algebra readiness'],
        ['Trigonometry & Precalculus','Trig functions, identities, advanced functions','Build Calculus I readiness'],
        ['College Mathematics','College Algebra, Statistics, Calculus I and beyond','Demonstrate actual college-level proficiency']
      ];
      const twoYear=[
        ['Months 1–3','Diagnose and reinforce arithmetic, fractions, percentages, and pre-algebra'],
        ['Months 4–6','Strengthen algebraic expressions, equations, graphs, and ratios'],
        ['Months 7–12','Work systematically through Algebra 1 and essential geometry'],
        ['Months 13–18','Advance into Algebra 2, functions, and more geometry'],
        ['Months 19–24','Continue Algebra 2, then trigonometry and precalculus as readiness permits']
      ];
      const readiness=[
        ['SAT Math','530','Published college/career readiness benchmark'],
        ['ACT Math','22','Readiness benchmark associated with College Algebra'],
        ['ACCUPLACER','Institution-specific','Placement depends on the college'],
        ['Khan Academy','No official cutoff','Use mastery plus independent testing']
      ];
      const umaine=[
        ['30+','MAT 111 · Algebra for College Mathematics'],
        ['61+','MAT 122 · Pre-Calculus and other eligible courses'],
        ['76+','MAT 126 · Calculus I']
      ];
      return '<section class="math-dashboard">'
        + '<section class="math-banner"><div><p class="page-kicker">Skills in Bloom · Math</p><h2>Math in Bloom</h2><p>From foundations to college mathematics.</p></div><span aria-hidden="true">🧮</span></section>'
        + '<section class="math-top-grid">'
          + '<article class="panel math-status"><p class="page-kicker">Current focus</p><h2>Algebra Basics</h2><p class="habit-help">Your strongest documented starting point is Foundations at 53% mastery. The next priority is closing prerequisite gaps rather than restarting from the beginning.</p><div class="habit-actions">'+button('new-skill','+ Add Math Topic','',true,Boolean(attempt))+'</div></article>'
          + '<article class="panel math-readiness"><p class="page-kicker">College readiness</p><h2>Not yet assessed</h2><p class="habit-help">Khan percentages are skill-mastery records, not placement-test scores. College readiness should be confirmed with independent testing and your future college placement requirements.</p></article>'
          + '<article class="panel math-practice"><p class="page-kicker">Your Math practice</p><div class="math-metrics"><span><strong>'+weekMinutes+' min</strong><small>this week</small></span><span><strong>'+monthMinutes+' min</strong><small>this month</small></span><span><strong>'+due+'</strong><small>ready to revisit</small></span></div></article>'
        + '</section>'
        + '<section class="panel math-baseline"><div class="habit-heading"><div><p class="page-kicker">November 7, 2026 · initial record</p><h2>Your Khan Academy Baseline</h2><p class="habit-help">These percentages represent the proportion of course skills at Proficient or Mastered. They should not be averaged into one overall math score.</p></div></div><div class="math-baseline-grid">'
          + baseline.map(row=>'<article><div class="math-baseline-head"><strong>'+esc(row[0])+'</strong><b>'+row[1]+'%</b></div><div class="math-progress"><span style="width:'+row[1]+'%"></span></div><small>'+esc(row[2])+'</small></article>').join('')
        + '</div><p class="habit-help math-not-assessed"><strong>Not yet assessed:</strong> Geometry, Algebra 2, Calculus, and any other listed course without a visible mastery percentage.</p></section>'
        + '<div class="math-two-col">'
          + '<section class="panel math-queue"><div class="habit-heading"><div><p class="page-kicker">Immediate study queue</p><h2>What to Work on Next</h2><p class="habit-help">This queue comes from the Algebra Basics records you supplied.</p></div></div><div class="math-queue-list">'+queue.map(row=>'<article><b>'+row[0]+'</b><div><strong>'+esc(row[1])+'</strong><small>'+esc(row[2])+'</small></div></article>').join('')+'</div></section>'
          + '<section class="panel math-tools"><p class="page-kicker">Your learning tools</p><h2>Math Toolkit</h2><div class="math-tool-grid"><button type="button"><span>🧪</span><strong>Skill Diagnostic</strong><small>Test what you already know</small></button><a href="https://www.khanacademy.org/math" target="_blank" rel="noopener noreferrer"><span>🎓</span><strong>Khan Academy</strong><small>Open assigned lessons</small></a><button type="button"><span>📓</span><strong>Math Notebook</strong><small>Save working & corrections</small></button><button type="button"><span>📈</span><strong>Progress Reports</strong><small>Compare monthly mastery</small></button><button type="button"><span>🗓️</span><strong>Study Planner</strong><small>Schedule Khan & tutor work</small></button><button type="button"><span>🏁</span><strong>College Milestones</strong><small>Track algebra to calculus</small></button></div></section>'
        + '</div>'
        + '<section class="panel math-roadmap"><p class="page-kicker">Your mathematics roadmap</p><h2>From Pre-Algebra to University Mathematics</h2><div class="math-roadmap-list">'+roadmap.map(row=>'<article><span>'+row[0]+'</span><div><h3>'+esc(row[1])+'</h3><p>'+esc(row[2])+'</p></div></article>').join('')+'</div></section>'
        + '<section class="panel math-sequence"><div class="habit-heading"><div><p class="page-kicker">Recommended Khan Academy sequence</p><h2>Mastery Path</h2><p class="habit-help">The 80% targets below are Life in Bloom planning targets for priority units/courses, not official college-placement requirements.</p></div></div><div class="math-sequence-table"><div class="math-sequence-row header"><span>Area</span><span>Focus</span><span>Target</span></div>'+sequence.map(row=>'<div class="math-sequence-row"><strong>'+esc(row[0])+'</strong><span>'+esc(row[1])+'</span><span>'+esc(row[2])+'</span></div>').join('')+'</div></section>'
        + '<div class="math-two-col">'
          + '<section class="panel math-benchmarks"><p class="page-kicker">Published readiness benchmarks</p><h2>Future Checkpoints</h2><div class="math-benchmark-list">'+readiness.map(row=>'<article><strong>'+esc(row[0])+'</strong><b>'+esc(row[1])+'</b><small>'+esc(row[2])+'</small></article>').join('')+'</div><p class="habit-help">These are separate assessments. Your Khan Academy percentages cannot be converted directly into SAT, ACT, ACCUPLACER, or ALEKS scores.</p></section>'
          + '<section class="panel math-umaine"><p class="page-kicker">Example · University of Maine</p><h2>ALEKS Placement Targets</h2>'+umaine.map(row=>'<article><strong>'+esc(row[0])+'</strong><span>'+esc(row[1])+'</span></article>').join('')+'<p class="habit-help">Useful as future placement targets if UMaine becomes your school choice.</p></section>'
        + '</div>'
        + '<section class="panel math-two-year"><p class="page-kicker">Two-year preparation roadmap</p><h2>College Prep Timeline</h2><div class="math-timeline">'+twoYear.map(row=>'<article><strong>'+esc(row[0])+'</strong><p>'+esc(row[1])+'</p></article>').join('')+'</div><p class="habit-help">The sequence should advance based on demonstrated understanding, not simply because time has passed.</p></section>'
        + '<section class="panel math-finish-lines"><div><p class="page-kicker">Finish line 1</p><h2>College Ready</h2><p>Independently solve representative algebra and quantitative-reasoning problems, show strong prerequisite mastery, and meet the placement requirement for the college/course you intend to enter.</p></div><div><p class="page-kicker">Finish line 2</p><h2>College Proficient</h2><p>Successfully complete actual credit-bearing college mathematics or comparable rigorous assessment. For engineering, continue toward Calculus I, Calculus II, multivariable calculus, differential equations, and/or linear algebra.</p></div></section>'
        + '<section class="panel math-practice-topics"><div class="habit-heading"><h2>Your Math Topics & Practice</h2></div>'+(mathSkills.length?'<div class="habit-skill-grid">'+mathSkills.map(skill=>renderSkillCard(skill,current)).join('')+'</div>':'<div class="habit-empty"><span aria-hidden="true">🧮</span><h3>Start your Math learning record</h3><p>Add specific skills such as fraction operations, percentages, distributive property, or multi-step equations, then log independent practice and review.</p>'+button('new-skill','+ Add a Math Topic','',true,Boolean(attempt))+'</div>')+'</section>'
        + '</section>';
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
      if (selectedCategory === 'reading') return renderReading(current);
      if (selectedCategory === 'piano') return renderPianoDashboard(current, today);
      if (selectedCategory === 'math') return renderMathDashboard(current, skills, sessions, today);
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
      if(form&&form.dataset&&Object.hasOwn(form.dataset,'readingAssignmentForm')){
        if(event.preventDefault)event.preventDefault();const current=snapshot(),book=readingBook(current,selectedReadingBookId);if(!book)return true;
        try{requireReady(current);run('Saving tutor assignment…',()=>store.saveReadingAssignment({...readingAssignmentDraft,book_id:book.id}),()=>{readingAssignmentOpen=false;readingAssignmentDraft={id:'',title:'',prompt:'',body:'',tutor_questions:'',due_on:'',status:'draft'};notify('Tutor assignment saved.');},null,'.reading-tutor-workspace');}catch(error){notify(error.message,true);}return true;
      }
      if(form&&form.dataset&&Object.hasOwn(form.dataset,'readingBookForm')){
        if(event.preventDefault)event.preventDefault();const current=snapshot();if(busy)return true;
        try{requireReady(current);run('Saving book…',()=>store.saveReadingBook(readingBookDraft),book=>{selectedReadingBookId=book.id;readingBookOpen=false;readingView='detail';notify('Book saved.');});}catch(error){notify(error.message,true);}return true;
      }
      if(form&&form.dataset&&Object.hasOwn(form.dataset,'readingSessionForm')){
        if(event.preventDefault)event.preventDefault();const current=snapshot(),book=readingBook(current,selectedReadingBookId);if(!book)return true;
        try{requireReady(current);run('Saving reading session…',()=>store.saveReadingSession({...readingSessionDraft,book_id:book.id,occurred_on:M.dayKey(getNow())}),()=>{readingSessionOpen=false;notify('Reading session saved.');});}catch(error){notify(error.message,true);}return true;
      }
      if(form&&form.dataset&&Object.hasOwn(form.dataset,'readingNoteForm')){
        if(event.preventDefault)event.preventDefault();const current=snapshot(),book=readingBook(current,selectedReadingBookId);if(!book)return true;
        try{requireReady(current);run('Saving reading note…',()=>store.saveReadingNote({...readingNoteDraft,book_id:book.id}),()=>{readingNoteOpen=false;notify('Reading note saved.');});}catch(error){notify(error.message,true);}return true;
      }
      if(form&&form.dataset&&Object.hasOwn(form.dataset,'readingQuizForm')){
        if(event.preventDefault)event.preventDefault();const current=snapshot(),book=readingBook(current,selectedReadingBookId);if(!book)return true;
        const quiz=readingStarterMaterial(book.title).quiz,answers=quiz.map((q,i)=>{const checked=form.querySelector('input[name="q'+i+'"]:checked');return checked?Number(checked.value):null;});
        const correct=answers.reduce((sum,a,i)=>sum+(a===quiz[i].answer?1:0),0);
        try{requireReady(current);run('Saving practice quiz…',()=>store.saveReadingQuizAttempt({book_id:book.id,scope_label:'Introductory study quiz',score:Math.round(correct/quiz.length*100),total_questions:quiz.length,correct_questions:correct,answers}),()=>notify('Practice quiz saved: '+correct+' of '+quiz.length+' correct.'));}catch(error){notify(error.message,true);}return true;
      }
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
      if(Object.hasOwn(data,'readerSpeechRate')){readerSpeechRate=Math.max(.5,Math.min(2,Number(element.value)||1));return true;}
      if(Object.hasOwn(data,'readAloudField')){if(data.readAloudField==='clarity')readAloudClarity=element.value;else if(data.readAloudField==='confidence')readAloudConfidence=element.value;else if(data.readAloudField==='notes')readAloudNotes=String(element.value||'');return true;}
      if(Object.hasOwn(data,'readingAssignmentField')){const key=data.readingAssignmentField;if(Object.hasOwn(readingAssignmentDraft,key))readingAssignmentDraft[key]=String(element.value||'');return true;}
      if(Object.hasOwn(data,'readerPage')){const file=readingBookPdf(current,selectedReadingBookId);const max=Number(file&&file.page_count)||20000;readerPage=Math.max(1,Math.min(max,Math.floor(Number(element.value)||1)));readerTextDraftPage=0;refresh();return true;}
      if(Object.hasOwn(data,'readerRange')){const value=Math.max(1,Math.floor(Number(element.value)||1));if(data.readerRange==='start')readerRangeStart=value;else readerRangeEnd=value;if(readerRangeEnd<readerRangeStart)readerRangeEnd=readerRangeStart;return true;}
      if(Object.hasOwn(data,'readerPageText')){readerTextDraft=String(element.value||'');readerTextDraftPage=readerPage;return true;}
      if(Object.hasOwn(data,'readingBookField')){const key=data.readingBookField;if(Object.hasOwn(readingBookDraft,key))readingBookDraft[key]=String(element.value||'');return true;}
      if(Object.hasOwn(data,'readingSessionField')){const key=data.readingSessionField;if(Object.hasOwn(readingSessionDraft,key))readingSessionDraft[key]=String(element.value||'');return true;}
      if(Object.hasOwn(data,'readingNoteField')){const key=data.readingNoteField;if(Object.hasOwn(readingNoteDraft,key))readingNoteDraft[key]=String(element.value||'');return true;}
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
      if(data&&Object.hasOwn(data,'readingImport')){
        const current=snapshot(),file=element.files&&element.files[0];element.value='';if(!file)return true;
        try{requireReady(current);if(file.size>20*1024*1024)throw new Error('Choose a Reading backup smaller than 20 MB.');
          run('Restoring Reading backup…',async()=>{let value;try{value=JSON.parse(await file.text());}catch(_){throw new Error('This is not a valid Reading JSON backup.');}await store.importReadingRecords(value);return true;},()=>notify('Reading backup restored and merged with your saved records.'));
        }catch(error){notify(error.message,true);}return true;
      }
      if(data&&Object.hasOwn(data,'readingAudioUpload')){
        const current=snapshot(),book=readingBook(current,selectedReadingBookId),file=element.files&&element.files[0];element.value='';if(!file||!book)return true;
        try{requireReady(current);const duration=prompt('Approximate duration in seconds for this audio file:','60');if(duration===null)return true;const seconds=Number(duration);if(!Number.isFinite(seconds)||seconds<=0)throw new Error('Enter a valid duration in seconds.');const sourceFile=readingBookPdf(current,book.id),source=sourceFile?verifiedRangeText(current,sourceFile.id,readerRangeStart,readerRangeEnd):'';run('Uploading read-aloud audio…',()=>store.uploadReadingAudio({file,book_id:book.id,recorded_on:M.dayKey(getNow()),section:book.current_section||'',page_from:readerRangeStart,page_to:readerRangeEnd,duration_seconds:seconds,source_word_count:source?wordCount(source):null}),()=>notify('Read-aloud audio saved.'),null,'.reader-read-aloud');}catch(error){notify(error.message,true);}return true;
      }
      if(data&&Object.hasOwn(data,'readingAssignmentUpload')){
        const current=snapshot(),book=readingBook(current,selectedReadingBookId),assignment=readingAssignments(current,selectedReadingBookId).find(item=>item.id===data.id),files=Array.from(element.files||[]);element.value='';if(!book||!assignment||!files.length)return true;
        try{requireReady(current);run('Uploading tutor attachment…',async()=>{const out=[];for(const file of files.slice(0,8))out.push(await store.uploadReadingFile({file,book_id:book.id,file_role:'assignment_attachment',assignment_id:assignment.id}));return out;},rows=>notify((rows||[]).length+' tutor attachment'+((rows||[]).length===1?'':'s')+' saved.'),null,'.reading-tutor-workspace');}catch(error){notify(error.message,true);}return true;
      }
      if(data&&Object.hasOwn(data,'readingBookPdf')){
        const current=snapshot(),book=readingBook(current,selectedReadingBookId),file=element.files&&element.files[0];element.value='';if(!file||!book)return true;
        try{requireReady(current);if(file.type!=='application/pdf')throw new Error('Choose a PDF book file.');
          if(readingBookPdf(current,book.id)&&!confirm('A full-book PDF is already saved for this book. Upload another copy as an additional file?'))return true;
          run('Uploading private book PDF…',()=>store.uploadReadingFile({file,book_id:book.id,file_role:'book_pdf'}),saved=>{readerPdfDoc=null;readerPdfFileId='';readerPdfLoad=null;readerPage=1;readerRangeStart=1;readerRangeEnd=1;readingView='reader';notify('Book PDF saved privately. Bloom Reader is ready.');});
        }catch(error){notify(error.message,true);}return true;
      }
      if(data&&Object.hasOwn(data,'readingUpload')){
        const current=snapshot(),book=readingBook(current,selectedReadingBookId),files=Array.from(element.files||[]);element.value='';if(!files.length||!book)return true;
        try{
          requireReady(current);
          const fullBook=readingBookPdf(current,book.id);
          run('Checking and saving page scans…',async()=>{
            const out=[];
            for(const file of files.slice(0,12)){
              if(file.type==='application/pdf'){
                if(fullBook&&file.name===fullBook.name&&Number(file.size)===Number(fullBook.size_bytes)){
                  throw new Error('That PDF is already saved as your full Bloom Reader book. Use Open Bloom Reader instead.');
                }
                if(root.BloomReader&&root.URL&&root.URL.createObjectURL){
                  const tempUrl=root.URL.createObjectURL(file);
                  try{
                    const doc=await root.BloomReader.loadDocument(tempUrl);
                    if(doc.numPages>50) throw new Error('This PDF has '+doc.numPages+' pages, so it looks like a full book. Upload it in the Bloom Reader card instead.');
                  } finally {
                    root.URL.revokeObjectURL(tempUrl);
                  }
                }
              }
              out.push(await store.uploadReadingFile({file,book_id:book.id,section:book.current_section||'',file_role:'scan'}));
            }
            return out;
          },rows=>notify((rows||[]).length+' page scan'+((rows||[]).length===1?'':'s')+' saved.'));
        }catch(error){notify(error.message,true);}
        return true;
      }
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
      if (!['grocery','money','category','new-skill','edit-skill','log-skill','skill-history','close-history','edit-session','resume','discard','archive','retry','reload-record','grams','trigger','reset-baseline','open-settings','close-settings','edit-day','new-purchase','export','restore-backup','cancel-backup','engineering-homework-add','engineering-homework-cancel','engineering-homework-toggle','engineering-homework-delete','engineering-file-open','engineering-file-delete','reading-home','reading-open','reading-detail','reading-coach','reading-coach-tab','reading-add-book','reading-edit-book','reading-cancel-book','reading-start-session','reading-cancel-session','reading-add-note','reading-cancel-note','reading-speak','reading-save-word','reading-file-open','reading-file-delete','reading-export','reading-reader','reader-prev','reader-next','reader-mode','reader-zoom-out','reader-zoom-in','reader-extract','reader-save-text','reader-verify-text','reader-generate-lesson','reader-jump','reader-listen','reader-speech-pause','reader-speech-resume','reader-speech-stop','reader-text-smaller','reader-text-larger','reader-line-toggle','read-aloud-start','read-aloud-stop','read-aloud-save','read-aloud-delete','reading-assignment-add','reading-assignment-edit','reading-assignment-cancel','reading-assignment-delete','piano-log-practice','piano-cancel-practice','piano-edit-app','piano-cancel-app','piano-add-repertoire','piano-cancel-repertoire','piano-midi-connect','piano-midi-start','piano-midi-stop','piano-media-delete'].includes(action)) return false;
      if (event.preventDefault) event.preventDefault(); const current = snapshot(); if (busy) return true;
      try {
        if (action === 'grocery' || action === 'money') { navigate(action); return true; }
        if (action === 'category') { if (data.category === 'all' || M.CATEGORIES.some(item => item.key === data.category)) selectedCategory = data.category; }
        else if(action==='piano-log-practice'){pianoPracticeDraft={duration_minutes:'20',source:'independent',course_name:'',lesson_name:'',piece_name:'',accuracy_percent:'',notes:''};pianoPracticeOpen=true;refresh('.piano-today');return true;}
        else if(action==='piano-cancel-practice'){pianoPracticeOpen=false;refresh('.piano-today');return true;}
        else if(action==='piano-edit-app'){
          const row=pianoRows(current,'pianoAppProgress').find(item=>item.id===data.id);
          if(!row)throw new Error('Refresh to find that Piano course.');
          pianoAppEditId=row.id;
          pianoAppDraft={...row,progress_percent:row.progress_percent==null?'':row.progress_percent,accuracy_percent:row.accuracy_percent==null?'':row.accuracy_percent};
          refresh('.piano-apps');return true;
        }
        else if(action==='piano-cancel-app'){pianoAppEditId='';pianoAppDraft=null;refresh('.piano-apps');return true;}
        else if(action==='piano-add-repertoire'){pianoRepertoireDraft={title:'',kind:'piece',status:'learning',source:'',notes:''};pianoRepertoireOpen=true;refresh('.piano-repertoire');return true;}
        else if(action==='piano-cancel-repertoire'){pianoRepertoireOpen=false;refresh('.piano-repertoire');return true;}
        else if(action==='piano-midi-connect'){
          Promise.resolve(connectPianoMidi()).then(name=>{notify('MIDI keyboard connected: '+name);refresh('.piano-midi');}).catch(error=>notify(error.message,true));
          return true;
        }
        else if(action==='piano-midi-start'){
          if(!pianoMidiConnected)throw new Error('Connect your MIDI keyboard first.');
          resetPianoMidiCapture();pianoMidiRecording=true;pianoMidiStartedAt=Date.now();refresh('.piano-midi');return true;
        }
        else if(action==='piano-midi-stop'){
          if(!pianoMidiRecording)return true;
          pianoMidiRecording=false;
          const seconds=Math.max(1,(Date.now()-pianoMidiStartedAt)/1000),minutes=Math.max(1,Math.round(seconds/60));
          const payload={occurred_on:M.dayKey(getNow()),duration_minutes:minutes,source:'midi',course_name:'',lesson_name:'',piece_name:'',accuracy_percent:null,midi_note_count:pianoMidiNoteCount,midi_unique_notes:pianoMidiNotes.size,midi_low_note:pianoMidiLow,midi_high_note:pianoMidiHigh,notes:'USB/MIDI practice summary. Note counts show keyboard activity, not musical accuracy.'};
          run('Saving MIDI practice…',()=>store.savePianoPracticeSession(payload),()=>{notify('MIDI practice session saved.');resetPianoMidiCapture();},null,'.piano-midi');
          return true;
        }
        else if(action==='piano-media-delete'){
          const row=pianoMediaRows(current).find(item=>item.id===data.id);
          if(!row)throw new Error('Refresh to find that Piano recording.');
          if(!confirm('Remove this private Piano practice file?'))return true;
          run('Removing Piano media…',()=>store.deletePianoMedia(row),()=>notify('Piano practice file removed.'),null,'.piano-media');return true;
        }
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
          const popup=root.open?root.open('about:blank','_blank'):null;
          run('Opening Engineering file…',()=>store.getEngineeringFileUrl(row),url=>{if(popup)popup.location.href=url;else if(root.location)root.location.href=url;},()=>{try{if(popup)popup.close();}catch(_){ }},'#engineering-homework');return true;
        }
        else if(action==='engineering-file-delete'){
          const row=engineeringFileRows(current).find(item=>item.id===data.id); if(!row)throw new Error('Refresh to find that Engineering file.');
          if(!confirm('Delete this saved Engineering file?'))return true;
          run('Deleting Engineering file…',()=>store.deleteEngineeringFile(row),()=>notify('Engineering file deleted.'),null,'#engineering-homework');return true;
        }
        else if(action==='reader-listen'){
          const file=readingBookPdf(current,selectedReadingBookId),text=file&&verifiedRangeText(current,file.id,readerRangeStart,readerRangeEnd);
          startReadingSpeech(text||readerTextDraft);return true;
        }
        else if(action==='reader-speech-pause'){if(root.speechSynthesis)root.speechSynthesis.pause();return true;}
        else if(action==='reader-speech-resume'){if(root.speechSynthesis)root.speechSynthesis.resume();return true;}
        else if(action==='reader-speech-stop'){stopReadingSpeech();return true;}
        else if(action==='reader-text-smaller'){readerTextSize=Math.max(14,readerTextSize-2);refresh();return true;}
        else if(action==='reader-text-larger'){readerTextSize=Math.min(32,readerTextSize+2);refresh();return true;}
        else if(action==='reader-line-toggle'){readerLineHeight=readerLineHeight<1.9?2.05:1.55;refresh();return true;}
        else if(action==='read-aloud-start'){Promise.resolve(startReadAloudRecording()).catch(error=>notify(error.message,true));return true;}
        else if(action==='read-aloud-stop'){stopReadAloudRecording();return true;}
        else if(action==='read-aloud-save'){
          const book=readingBook(current,selectedReadingBookId),file=readingBookPdf(current,selectedReadingBookId);
          if(!book||!readAloudBlob||!readAloudDuration)throw new Error('Record or upload audio before saving.');
          const source=file?verifiedRangeText(current,file.id,readerRangeStart,readerRangeEnd):'',words=source?wordCount(source):null;
          const ext=readAloudBlob.type==='audio/mp4'?'m4a':readAloudBlob.type==='audio/ogg'?'ogg':readAloudBlob.type==='audio/mpeg'?'mp3':readAloudBlob.type==='audio/wav'?'wav':'webm';
          const audioFile=new File([readAloudBlob],book.title+' read aloud '+M.dayKey(getNow())+'.'+ext,{type:readAloudBlob.type||'audio/webm'});
          run('Saving read-aloud recording…',()=>store.uploadReadingAudio({file:audioFile,book_id:book.id,recorded_on:M.dayKey(getNow()),section:book.current_section||'',page_from:readerRangeStart,page_to:readerRangeEnd,duration_seconds:readAloudDuration,source_word_count:words,clarity_rating:readAloudClarity,confidence_rating:readAloudConfidence,notes:readAloudNotes}),()=>{if(readAloudPreviewUrl&&root.URL)root.URL.revokeObjectURL(readAloudPreviewUrl);readAloudBlob=null;readAloudPreviewUrl='';readAloudDuration=0;readAloudClarity='';readAloudConfidence='';readAloudNotes='';notify('Read-aloud recording saved.');},null,'.reader-read-aloud');return true;
        }
        else if(action==='read-aloud-delete'){
          const row=readingAudio(current,selectedReadingBookId).find(item=>item.id===data.id);if(!row)throw new Error('Refresh to find that recording.');
          if(!confirm('Remove this read-aloud recording?'))return true;
          run('Removing recording…',()=>store.deleteReadingAudio(row),()=>notify('Read-aloud recording removed.'),null,'.reader-read-aloud');return true;
        }
        else if(action==='reading-assignment-add'){readingAssignmentDraft={id:'',title:'',prompt:'',body:'',tutor_questions:'',due_on:'',status:'draft'};readingAssignmentOpen=true;refresh('.reading-tutor-workspace');return true;}
        else if(action==='reading-assignment-edit'){const row=readingAssignments(current,selectedReadingBookId).find(item=>item.id===data.id);if(!row)throw new Error('Refresh to find that assignment.');readingAssignmentDraft={...row,due_on:row.due_on||''};readingAssignmentOpen=true;refresh('.reading-tutor-workspace');return true;}
        else if(action==='reading-assignment-cancel'){readingAssignmentOpen=false;readingAssignmentDraft={id:'',title:'',prompt:'',body:'',tutor_questions:'',due_on:'',status:'draft'};refresh('.reading-tutor-workspace');return true;}
        else if(action==='reading-assignment-delete'){const row=readingAssignments(current,selectedReadingBookId).find(item=>item.id===data.id);if(!row)throw new Error('Refresh to find that assignment.');if(!confirm('Remove this tutor assignment? Attached files will remain until you remove them separately.'))return true;run('Removing assignment…',()=>store.deleteReadingAssignment(row),()=>notify('Tutor assignment removed.'),null,'.reading-tutor-workspace');return true;}
        else if(action==='reading-reader'){if(data.id)selectedReadingBookId=data.id;readingView='reader';readerPage=1;readerRangeStart=1;readerRangeEnd=1;readerTextDraftPage=0;readerLesson=null;refresh();return true;}
        else if(action==='reader-prev'){readerPage=Math.max(1,readerPage-1);readerTextDraftPage=0;refresh();return true;}
        else if(action==='reader-next'){const file=readingBookPdf(current,selectedReadingBookId),max=Number(file&&file.page_count)||readerPage+1;readerPage=Math.min(max,readerPage+1);readerTextDraftPage=0;refresh();return true;}
        else if(action==='reader-mode'){if(['pdf','text'].includes(data.mode))readerMode=data.mode;refresh();return true;}
        else if(action==='reader-zoom-out'){readerZoom=Math.max(.6,Math.round((readerZoom-.15)*100)/100);refresh();return true;}
        else if(action==='reader-zoom-in'){readerZoom=Math.min(2.5,Math.round((readerZoom+.15)*100)/100);refresh();return true;}
        else if(action==='reader-jump'){readerPage=Math.max(1,Number(data.page)||1);readerTextDraftPage=0;refresh();return true;}
        else if(action==='reader-extract'){
          const book=readingBook(current,selectedReadingBookId),file=readingBookPdf(current,selectedReadingBookId);if(!book||!file)throw new Error('Upload the full-book PDF first.');
          let start=Math.max(1,readerRangeStart),end=Math.max(start,readerRangeEnd);if(end-start+1>25)throw new Error('Process up to 25 pages at a time so the browser stays responsive.');
          run('Extracting selected pages…',async()=>{
            const doc=await ensureReaderDocument(file);end=Math.min(end,doc.numPages);const existing=readingPageTexts(current,file.id);
            const results=[];
            for(let pageNo=start;pageNo<=end;pageNo++){
              const prior=existing.find(row=>Number(row.page_number)===pageNo);
              if(prior&&prior.verified){results.push(prior);setReaderStatus('Page '+pageNo+' already verified · skipped');continue;}
              setReaderStatus('Page '+pageNo+' of '+end+' · checking PDF text layer…');
              const value=await root.BloomReader.processPage(doc,pageNo,{minimumTextChars:80,onStage(info){setReaderStatus('Page '+info.page+' · '+(info.stage==='ocr'?'running OCR fallback…':'reading PDF text layer…'));},onOcrProgress(info){if(info&&typeof info.progress==='number')setReaderStatus('Page '+pageNo+' · OCR '+Math.round(info.progress*100)+'%');}});
              results.push({...value,book_id:book.id,file_id:file.id,verified:false,verified_text:''});
            }
            await root.BloomReader.terminateWorker();
            const unsaved=results.filter(row=>!row.id||!existing.some(old=>old.id===row.id&&old.verified));
            if(unsaved.length)await store.saveReadingPageTexts(unsaved);
            return results;
          },()=>{readerPage=start;readerTextDraftPage=0;setReaderStatus('Extraction finished. Review and verify each page before generating a lesson.');notify('Selected pages extracted. Review the text and mark pages verified.');},null,'.reader-review');return true;
        }
        else if(action==='reader-save-text'||action==='reader-verify-text'){
          const book=readingBook(current,selectedReadingBookId),file=readingBookPdf(current,selectedReadingBookId),row=file&&readingPageTexts(current,file.id).find(item=>Number(item.page_number)===readerPage);
          if(!book||!file||!row)throw new Error('Extract this page before saving corrections.');
          run(action==='reader-verify-text'?'Verifying page text…':'Saving corrected page text…',()=>store.saveReadingPageText({...row,book_id:book.id,file_id:file.id,verified_text:readerTextDraft,verified:action==='reader-verify-text'}),()=>notify(action==='reader-verify-text'?'Page verified for lesson use.':'Corrected page text saved.'));return true;
        }
        else if(action==='reader-generate-lesson'){
          const file=readingBookPdf(current,selectedReadingBookId);if(!file)throw new Error('Upload the full-book PDF first.');
          const pages=readingPageTexts(current,file.id).filter(row=>row.verified&&Number(row.page_number)>=readerRangeStart&&Number(row.page_number)<=readerRangeEnd);
          if(!pages.length)throw new Error('Verify at least one page in this range first.');
          const combined=pages.map(row=>row.verified_text||row.raw_text||'').join('\n\n');
          readerLesson={start:readerRangeStart,end:readerRangeEnd,pages:pages.length,words:root.BloomReader?root.BloomReader.candidateWords(combined,12):[]};refresh('.reader-lesson-draft');return true;
        }
        else if(action==='reading-export'){
          const value=store.exportReadingRecords();
          download('life-in-bloom-reading-'+M.dayKey(getNow())+'.json',JSON.stringify(value,null,2),'application/json');
          notify('Your Reading in Bloom backup was downloaded. Uploaded page images stay in private cloud storage.');
          return true;
        }
        else if(action==='reading-home'){readingView='home';readingBookOpen=false;readingSessionOpen=false;readingNoteOpen=false;refresh();return true;}
        else if(action==='reading-open'||action==='reading-detail'){if(data.id)selectedReadingBookId=data.id;readingView='detail';readingBookOpen=false;readingSessionOpen=false;readingNoteOpen=false;refresh();return true;}
        else if(action==='reading-coach'){if(data.id)selectedReadingBookId=data.id;readingView='coach';refresh();return true;}
        else if(action==='reading-coach-tab'){if(['spelling','vocabulary','comprehension'].includes(data.tab))readingCoachTab=data.tab;refresh();return true;}
        else if(action==='reading-add-book'){readingBookDraft={id:'',title:'',author:'',isbn:'',edition:'',total_pages:'',current_page:'',current_section:'',status:'not_started',cover_url:'',notes:''};readingBookOpen=true;refresh();return true;}
        else if(action==='reading-edit-book'){const book=readingBook(current,data.id);if(!book)throw new Error('Refresh to find that book.');readingBookDraft={...book,total_pages:book.total_pages==null?'':book.total_pages,current_page:book.current_page==null?'':book.current_page};readingBookOpen=true;refresh();return true;}
        else if(action==='reading-cancel-book'){readingBookOpen=false;refresh();return true;}
        else if(action==='reading-start-session'){if(data.id)selectedReadingBookId=data.id;const book=readingBook(current,selectedReadingBookId);readingSessionDraft={minutes:'20',start_page:book&&book.current_page!=null?String(book.current_page):'',end_page:'',section:book&&book.current_section||'',notes:''};readingSessionOpen=true;readingView='detail';refresh();return true;}
        else if(action==='reading-cancel-session'){readingSessionOpen=false;refresh();return true;}
        else if(action==='reading-add-note'){readingNoteDraft={page_number:'',section:'',note_type:'note',body:''};readingNoteOpen=true;refresh();return true;}
        else if(action==='reading-cancel-note'){readingNoteOpen=false;refresh();return true;}
        else if(action==='reading-speak'){if(root.speechSynthesis&&data.word){root.speechSynthesis.cancel();root.speechSynthesis.speak(new SpeechSynthesisUtterance(data.word));}return true;}
        else if(action==='reading-save-word'){const book=readingBook(current,selectedReadingBookId),starter=book&&readingStarterMaterial(book.title),row=starter&&starter.vocab.find(v=>v[0]===data.word);if(!book||!row)throw new Error('That starter word is unavailable.');run('Saving vocabulary…',()=>store.saveReadingVocabulary({book_id:book.id,word:row[0],part_of_speech:row[1],definition:row[2],source_label:'coach_suggested'}),()=>notify('Vocabulary word saved.'));return true;}
        else if(action==='reading-file-open'){const file=readingFiles(current).find(x=>x.id===data.id);if(!file)throw new Error('Refresh to find that scan.');const popup=root.open?root.open('about:blank','_blank'):null;run('Opening reading scan…',()=>store.getReadingFileUrl(file),url=>{if(popup)popup.location.href=url;},()=>{try{if(popup)popup.close();}catch(_){}});return true;}
        else if(action==='reading-file-delete'){
          const file=readingFiles(current,selectedReadingBookId).find(item=>item.id===data.id&&item.file_role!=='book_pdf');
          if(!file)throw new Error('Refresh to find that page scan.');
          if(!confirm('Remove this page scan? Your full Bloom Reader book PDF will not be affected.'))return true;
          run('Removing page scan…',()=>store.deleteReadingFile(file),()=>notify('Page scan removed. Your Bloom Reader book PDF is unchanged.'));
          return true;
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
