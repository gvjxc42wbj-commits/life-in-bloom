'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Habits = require('../bloom-habits.js');
const copy = value => JSON.parse(JSON.stringify(value));
const META = { user_id: 'owner', household_id: 'house-one', revision: 1, archived: false, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z' };
const skill = (id = 'piano-scale', extra = {}) => ({ ...META, id, name: 'C major scale', category: 'piano', memory_type: 'procedural', observed_level: 7, notes: '', ...extra });
const session = (id = 'practice-one', extra = {}) => ({ ...META, id, skill_id: 'piano-scale', occurred_on: '2026-11-03', minutes: 15, result: 'good', notes: '', ...extra });
const reference = (extra = {}) => ({ ...META, id: 'reference-one', baseline_joints: 2, baseline_cigars: 1, baseline_grams_per_joint: 0.5, price_per_gram_cents: 1000, cigar_price_cents: 150, notes: '', ...extra });
const day = (extra = {}) => ({ ...META, id: 'day-one', occurred_on: '2026-11-04', joints: 1, cigars: 1, grams_per_joint: 0.5, trigger_tags: ['stress'], notes: '', reference_snapshot: reference(), ...extra });
const state = (extra = {}) => ({ status: 'ready', user: { id: 'owner' }, household: { id: 'house-one' }, offline: false, skills: [], skillSessions: [], smokingSettings: [], smokingDays: [], moneyEntries: [], ...extra });
function savedDraftStore() {
  const values = new Map(), writes = [];
  return {
    values, writes,
    read(user, household, area) { return values.get(user + ':' + household + ':' + area) || null; },
    write(user, household, area, data) { const saved = copy(data); writes.push({ user, household, area, data: saved }); values.set(user + ':' + household + ':' + area, { data: saved }); return true; },
    clear(user, household, area) { values.delete(user + ':' + household + ':' + area); return true; }
  };
}
function harness(initial = state(), persistence = savedDraftStore()) {
  let current = copy(initial), consent = true, now = new Date('2026-11-04T17:00:00Z');
  const calls = [], notices = [], refreshes = [], links = [], downloads = [], methods = {};
  const store = { snapshot: () => current };
  const lists = { saveSkill: 'skills', saveSkillSession: 'skillSessions', saveSmokingSettings: 'smokingSettings', saveSmokingDay: 'smokingDays' };
  const normalSave = (method, value) => {
    const key = lists[method], old = current[key].find(row => row.id === value.id);
    const row = { ...META, ...copy(value), user_id: current.user.id, household_id: current.household.id, revision: old ? old.revision + 1 : 1, updated_at: now.toISOString() };
    if (method === 'saveSmokingDay') row.reference_snapshot = old ? copy(old.reference_snapshot) : copy(current.smokingSettings.find(item => item.user_id === current.user.id && !item.archived) || {});
    current = { ...current, [key]: [...current[key].filter(item => item.id !== row.id), row] };
    return row;
  };
  for (const method of [...Object.keys(lists), 'archiveLifeRecord', 'recordMoneyEntry', 'refresh', 'exportPersonalLifeRecords', 'importPersonalLifeRecords']) store[method] = async (...args) => {
    calls.push({ method, args: copy(args) });
    if (methods[method]) return methods[method](...args);
    if (lists[method]) return normalSave(method, args[0]);
    if (method === 'archiveLifeRecord') {
      const mapping = { skill: 'skills', skill_session: 'skillSessions', smoking_day: 'smokingDays' }, key = mapping[args[0].kind];
      current = { ...current, [key]: current[key].map(row => row.id === args[0].id ? { ...row, archived: true, revision: row.revision + 1 } : row) };
      return {};
    }
    if (method === 'recordMoneyEntry') { current.moneyEntries.push(copy(args[0])); return args[0]; }
    if (method === 'exportPersonalLifeRecords') return { app: 'Life in Bloom Personal Practice', version: 1, user_id: current.user.id, household_id: current.household.id, exported_at: now.toISOString(), records: [...current.skills, ...current.skillSessions, ...current.smokingSettings, ...current.smokingDays].filter(row => row.user_id === current.user.id) };
    if (method === 'importPersonalLifeRecords') {
      const mapping = { skill: 'skills', skill_session: 'skillSessions', smoking_settings: 'smokingSettings', smoking_day: 'smokingDays' };
      for (const row of args[0].records) if (!current[mapping[row.kind]].some(item => item.id === row.id)) current[mapping[row.kind]].push({ ...copy(row.data), ...copy(row) });
      return {};
    }
    return current;
  };
  const controller = Habits.createController({ store, draftStore: persistence, notify: (message, error) => notices.push({ message, error }), refresh: selector => refreshes.push(selector), navigate: page => links.push(page), confirm: () => consent, getNow: () => now, download: (name, content, type) => downloads.push({ name, content, type }) });
  controller.render('skills');
  const click = (action, extra = {}) => { let prevented = false; assert.equal(controller.handleClick({ target: { closest: () => ({ dataset: { habitAction: action, ...extra } }) }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  const input = (field, value) => assert.equal(controller.handleInput({ target: { dataset: { habitField: field }, value: String(value) } }), true);
  const range = (key, value) => assert.equal(controller.handleInput({ target: { dataset: { habitRange: key }, value: String(value) } }), true);
  const changeDate = date => { const element = { dataset: { habitDate: '' }, value: date }; assert.equal(controller.handleChange({ target: element }), true); return element.value; };
  const importFile = (value, name = 'Personal backup.json') => { const content = typeof value === 'string' ? value : JSON.stringify(value); assert.equal(controller.handleChange({ target: { dataset: { habitImport: '' }, files: [{ name, size: content.length, text: async () => content }] } }), true); };
  const submit = (group, fields = {}) => { let prevented = false; assert.equal(controller.handleSubmit({ target: { dataset: { habitForm: group }, elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: String(fields[name]) } : null } }, preventDefault() { prevented = true; } }), true); assert.equal(prevented, true); };
  return { controller, store, calls, notices, refreshes, links, downloads, methods, persistence, normalSave, click, input, range, changeDate, importFile, submit, idle: () => controller.whenIdle(), get state() { return current; }, set state(value) { current = value; }, set now(value) { now = new Date(value); }, set consent(value) { consent = value; } };
}

function backup(extra = {}) {
  const row = skill();
  const data = Object.fromEntries(['name', 'category', 'memory_type', 'observed_level', 'notes'].map(key => [key, row[key]]));
  return { app: 'Life in Bloom Personal Practice', version: 1, user_id: 'owner', household_id: 'house-one', records: [{ ...META, id: row.id, kind: 'skill', data }], ...extra };
}

test('skills show all requested areas without creating example records and keep estimates distinct from observed level', () => {
  const h = harness(), html = h.controller.render('skills');
  for (const label of ['Piano', 'Sewing', 'Math', 'Language', 'Reading', 'Science', 'Cooking', 'Engineering', 'Writing', 'Painting', 'Animation', 'Me']) assert.match(html, new RegExp('>' + label + '<'));
  assert.match(html, /Categories begin empty/);
  assert.match(html, /not a measured recall probability/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.deepEqual(h.controller.getHomeSummary(), { dueSkills: 0, skillCount: 0, practiceMinutes: 0, smokingDay: null, smokingEstimate: null });
});

test('skills, history and home summaries exclude another person and another household and escape personal content', () => {
  const h = harness(state({ skills: [skill('piano-scale', { name: '<script>Scale</script>' }), skill('private-other', { user_id: 'member', name: 'Other user secret' }), skill('other-house', { household_id: 'house-two', name: 'Other household secret' })], skillSessions: [session(), session('today', { occurred_on: '2026-11-04', minutes: 20, result: 'practice', notes: 'Quiet <practice>' }), session('other-session', { user_id: 'member', occurred_on: '2026-11-04', minutes: 300 })] }));
  h.click('skill-history', { id: 'piano-scale' });
  const html = h.controller.render('skills');
  assert.match(html, /&lt;script&gt;Scale&lt;\/script&gt;/);
  assert.match(html, /Quiet &lt;practice&gt;/);
  assert.doesNotMatch(html, /<script>|Other user secret|Other household secret/);
  assert.match(html, /Your observed level/); assert.match(html, /Review readiness estimate/);
  assert.equal(h.controller.getHomeSummary().skillCount, 1);
  assert.equal(h.controller.getHomeSummary().dueSkills, 1);
  assert.equal(h.controller.getHomeSummary().practiceMinutes, 20);
});

test('skill typing autosaves without replacing the input and exact category/proficiency are saved', async () => {
  const h = harness(); h.click('category', { category: 'cooking' }); h.click('new-skill');
  const countBefore = h.refreshes.length;
  for (const name of ['L', 'Le', 'Lem', 'Lemon sauce']) h.input('skill.name', name);
  h.input('skill.notes', 'Remember the texture'); h.input('skill.observed_level', '4');
  assert.equal(h.refreshes.length, countBefore, 'typing must not replace the entire page or caret');
  assert.equal(h.persistence.writes.at(-1).data.drafts.skill.name, 'Lemon sauce');
  assert.equal(h.controller.hasUnpersistedChanges(), false);
  h.submit('skill'); await h.idle();
  const payload = h.calls.at(-1).args[0];
  assert.equal(payload.name, 'Lemon sauce'); assert.equal(payload.category, 'cooking'); assert.equal(payload.memory_type, 'mixed'); assert.equal(payload.observed_level, 4);
  assert.match(payload.request_id, /^[0-9a-f-]{36}$/); assert.equal(payload.id, payload.request_id);
  assert.equal(h.controller.hasUnsavedDraft(), false); assert.equal(h.state.skills.length, 1);
});

test('an uncertain save freezes its exact payload across reload and retries with the same identity', async () => {
  const persistence = savedDraftStore(), h = harness(state(), persistence);
  h.click('new-skill'); h.input('skill.name', 'F major scale');
  h.methods.saveSkill = () => { throw new Error('Connection lost after request'); };
  h.submit('skill'); await h.idle();
  const first = h.calls[0].args[0];
  h.input('skill.name', 'Changed under pending request');
  assert.equal(h.controller.discardDraft(), false);
  const next = harness(state(), persistence);
  assert.match(next.controller.render('skills'), /Retry the same request/);
  assert.match(next.controller.render('skills'), /value="F major scale"/);
  next.click('retry'); await next.idle();
  assert.deepEqual(next.calls[0].args[0], first);
  assert.equal(next.state.skills.length, 1); assert.equal(next.controller.hasUnsavedDraft(), false);
});

test('practice can record time without claiming recall and rejects invalid or foreign topic records', async () => {
  const h = harness(state({ skills: [skill()] }));
  h.click('log-skill', { id: 'piano-scale' });
  h.submit('session', { minutes: '12.5', result: 'practice', notes: 'Slow work' }); await h.idle();
  assert.equal(h.state.skillSessions[0].result, 'practice'); assert.equal(h.state.skillSessions[0].minutes, 12.5);
  assert.equal(h.controller.getHomeSummary().dueSkills, 0);
  assert.match(h.controller.render('skills'), /Not estimated/);
  h.click('log-skill', { id: 'piano-scale' });
  h.submit('session', { minutes: '0', result: 'good' }); await h.idle();
  assert.equal(h.state.skillSessions[1].minutes, 0);
  assert.match(h.controller.render('skills'), /Nov 5, 2026/);
  h.click('log-skill', { id: 'piano-scale' });
  const before = h.calls.length;
  for (const values of [{ skill_id: 'someone-else', minutes: 10 }, { skill_id: 'piano-scale', minutes: -1 }, { minutes: 10, occurred_on: '2026-11-05' }, { occurred_on: '2026-11-04', result: 'magically-mastered' }]) { h.submit('session', values); await h.idle(); }
  assert.equal(h.calls.length, before);
});

test('editing uses the captured revision and a definitive conflict permits reloading saved values', async () => {
  const h = harness(state({ skills: [skill()] }));
  h.click('edit-skill', { id: 'piano-scale' }); h.input('skill.observed_level', 8);
  h.methods.saveSkill = () => { h.state.skills[0] = skill('piano-scale', { revision: 2, name: 'Updated elsewhere', observed_level: 5 }); throw Object.assign(new Error('The entry changed'), { code: '40001' }); };
  h.submit('skill'); await h.idle();
  assert.equal(h.calls[0].args[0].revision, 1);
  assert.match(h.controller.render('skills'), /Reload saved entry/);
  assert.doesNotMatch(h.controller.render('skills'), /Confirming your saved change/);
  h.click('reload-record'); await h.idle();
  const html = h.controller.render('skills');
  assert.match(html, /value="Updated elsewhere"/);
  assert.match(html, /name="observed_level"[^>]*value="5"/);
  h.methods.saveSkill = value => h.normalSave('saveSkill', value);
  h.input('skill.observed_level', 6); h.submit('skill'); await h.idle();
  assert.equal(h.calls.at(-1).args[0].revision, 2);
});

test('archiving mistaken sessions removes their totals while preserving visible history and archived skills', async () => {
  const h = harness(state({ skills: [skill()], skillSessions: [session('today', { occurred_on: '2026-11-04' })] }));
  h.click('skill-history', { id: 'piano-scale' });
  h.click('archive', { kind: 'skill_session', id: 'today' }); await h.idle();
  assert.equal(h.state.skillSessions[0].archived, true); assert.equal(h.controller.getHomeSummary().practiceMinutes, 0);
  assert.match(h.controller.render('skills'), /Archived/);
  h.click('archive', { kind: 'skill', id: 'piano-scale' }); await h.idle();
  assert.equal(h.controller.getHomeSummary().skillCount, 0);
  assert.match(h.controller.render('skills'), /Archived skills · 1/);
  assert.match(h.calls[0].args[1], /^[0-9a-f-]{36}$/);
});

test('smoking starts unlogged, supports explicit zero, and never creates money entries from sliders', async () => {
  const h = harness();
  const html = h.controller.render('smoking');
  assert.match(html, /Nothing recorded for this day yet/); assert.match(html, /0 is allowed/);
  assert.match(html, /Set a baseline/);
  h.range('joints', 3); h.range('cigars', 0); h.click('grams', { value: '0.75' });
  assert.equal(h.calls.length, 0); assert.equal(h.controller.getHomeSummary().smokingDay, null);
  assert.match(h.controller.render('smoking'), /Add prices/);
  h.input('smoke.joints', 0); h.click('trigger', { trigger: 'boredom' }); h.input('smoke.notes', 'A zero day <saved>');
  h.submit('smoke'); await h.idle();
  assert.equal(h.state.smokingDays.length, 1); assert.equal(h.state.smokingDays[0].joints, 0); assert.equal(h.state.smokingDays[0].cigars, 0);
  assert.deepEqual(h.state.smokingDays[0].trigger_tags, ['boredom']);
  assert.equal(h.controller.getHomeSummary().smokingEstimate.dailyCents, 0); assert.equal(h.state.moneyEntries.length, 0);
  assert.match(h.controller.render('smoking'), /A zero day &lt;saved&gt;/);
});

test('saved reference values preserve unknown prices, accept zero, and do not create actual days or spending', async () => {
  const h = harness(); h.controller.render('smoking'); h.click('open-settings');
  h.submit('settings', { baseline_joints: '', baseline_cigars: '0', baseline_grams_per_joint: '0.5', price_per_gram: '', cigar_price: '0.00' }); await h.idle();
  const payload = h.calls[0].args[0];
  assert.equal(payload.baseline_joints, null); assert.equal(payload.baseline_cigars, 0); assert.equal(payload.price_per_gram_cents, null); assert.equal(payload.cigar_price_cents, 0);
  assert.equal(h.state.smokingDays.length, 0); assert.equal(h.state.moneyEntries.length, 0);
  h.click('open-settings'); const before = h.calls.length;
  for (const price of ['-1', '3.1415', 'Infinity', '10,000.00', '10000000.01']) { h.submit('settings', { price_per_gram: price }); await h.idle(); }
  assert.equal(h.calls.length, before);
});

test('saved smoking days keep original reference snapshots after prices change and editing never reprices history', async () => {
  const h = harness(state({ smokingSettings: [reference()], smokingDays: [day()] }));
  h.controller.render('smoking');
  assert.equal(h.controller.getHomeSummary().smokingEstimate.dailyCents, 650);
  h.click('open-settings'); h.submit('settings', { price_per_gram: '20.00', cigar_price: '3.00' }); await h.idle();
  assert.equal(h.state.smokingSettings[0].price_per_gram_cents, 2000);
  assert.equal(h.controller.getHomeSummary().smokingEstimate.dailyCents, 650);
  h.input('smoke.notes', 'An edited note'); h.submit('smoke'); await h.idle();
  assert.equal(h.calls.at(-1).args[0].revision, 1);
  assert.equal(Object.hasOwn(h.calls.at(-1).args[0], 'reference_snapshot'), false, 'the server captures the price snapshot');
  assert.equal(h.state.smokingDays[0].reference_snapshot.price_per_gram_cents, 1000);
  assert.equal(h.controller.getHomeSummary().smokingEstimate.dailyCents, 650);
  h.changeDate('2026-11-03'); h.submit('smoke', { joints: 1, cigars: 1 }); await h.idle();
  assert.equal(h.state.smokingDays.find(row => row.occurred_on === '2026-11-03').reference_snapshot.price_per_gram_cents, 2000);
});

test('reset to original plan only changes a draft and dates require an explicit discard of unsaved counts', async () => {
  const h = harness(state({ smokingSettings: [reference()] })); h.controller.render('smoking');
  h.click('reset-baseline');
  assert.equal(h.calls.length, 0); assert.equal(h.controller.getHomeSummary().smokingDay, null);
  assert.match(h.controller.render('smoking'), /name="joints"[^>]*value="2"/);
  h.consent = false;
  assert.equal(h.changeDate('2026-11-03'), '2026-11-04');
  h.consent = true;
  assert.equal(h.changeDate('2026-11-03'), '2026-11-03');
  assert.match(h.controller.render('smoking'), /name="joints"[^>]*value="0"/);
  h.submit('smoke', { joints: 1, cigars: 0 }); await h.idle();
  assert.equal(h.state.smokingDays[0].occurred_on, '2026-11-03');
  assert.equal(h.controller.getHomeSummary('2026-11-04').smokingDay, null, 'Home does not accidentally show a past selected day');
});

test('actual smoking purchases enter Money once with payer and amount while daily estimates stay independent', async () => {
  const h = harness(state({ smokingSettings: [reference()] })); h.controller.render('smoking');
  h.range('joints', 2); h.click('new-purchase');
  let first = true;
  h.methods.recordMoneyEntry = value => { if (first) { first = false; throw new Error('Reply lost'); } if (!h.state.moneyEntries.some(row => row.id === value.id)) h.state.moneyEntries.push(copy(value)); return value; };
  h.submit('purchase', { occurred_on: '2026-11-04', amount: '23.45', description: 'Supplies', payer_slot: '2' }); await h.idle();
  const payload = h.calls[0].args[0];
  assert.equal(payload.amount_cents, 2345); assert.equal(payload.category, 'other'); assert.equal(payload.payer_slot, 2); assert.equal(payload.description, 'Smoking · Supplies');
  h.input('purchase.amount', '99.00'); h.click('retry'); await h.idle();
  assert.deepEqual(h.calls[1].args[0], payload);
  assert.equal(h.state.moneyEntries.length, 1); assert.equal(h.state.smokingDays.length, 0);
  assert.equal(h.controller.hasUnsavedDraft(), true, 'the independent unsaved daily draft is retained');
  assert.match(h.controller.render('smoking'), /name="joints"[^>]*value="2"/);
});

test('offline typed drafts remain on device, restore after reload and save only after reconnection', async () => {
  const persistence = savedDraftStore(), h = harness(state({ offline: true }), persistence);
  h.controller.render('smoking'); h.input('smoke.joints', 1); h.input('smoke.notes', 'Offline note');
  h.submit('smoke'); await h.idle();
  assert.equal(h.calls.length, 0); assert.equal(h.controller.hasUnpersistedChanges(), false);
  const restored = harness(state(), persistence); restored.controller.render('smoking');
  assert.match(restored.controller.render('smoking'), /Offline note/);
  restored.submit('smoke'); await restored.idle();
  assert.equal(restored.state.smokingDays[0].joints, 1); assert.equal(restored.state.smokingDays[0].notes, 'Offline note');
});

test('a draft storage failure is visible and navigation protection remains active', () => {
  const persistence = savedDraftStore(); persistence.write = () => false;
  const h = harness(state(), persistence); h.click('new-skill'); h.input('skill.name', 'A saved-soon topic');
  assert.equal(h.controller.hasUnpersistedChanges(), true);
  assert.match(h.notices.at(-1).message, /could not save your draft/);
});

test('a late reply cannot clear the new account’s draft or show the previous person’s data', async () => {
  const persistence = savedDraftStore(), h = harness(state(), persistence);
  let complete;
  h.methods.saveSkill = () => new Promise(resolve => { complete = resolve; });
  h.click('new-skill'); h.input('skill.name', 'Owner private topic'); h.submit('skill');
  await Promise.resolve();
  assert.equal(typeof complete, 'function');
  h.state = state({ user: { id: 'member' }, skills: [skill('member-topic', { user_id: 'member', name: 'Member topic' })] });
  assert.doesNotMatch(h.controller.render('skills'), /Owner private topic/);
  h.click('new-skill'); h.input('skill.name', 'Member draft');
  complete({}); await h.idle();
  assert.match(h.controller.render('skills'), /value="Member draft"/);
  assert.equal(persistence.values.get('member:house-one:habits').data.drafts.skill.name, 'Member draft');
  assert.equal(persistence.values.get('owner:house-one:habits').data.attempt.payload.name, 'Owner private topic');
  assert.equal(h.notices.some(item => item.message === 'Your skill was saved.'), false);
});

test('switching accounts before the mutation begins cancels queued old-account work', async () => {
  const h = harness(); h.click('new-skill'); h.input('skill.name', 'Old account topic'); h.submit('skill');
  h.state = state({ user: { id: 'member' } }); h.controller.render('skills');
  await h.idle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('daily view rolls at New York midnight only while clean and keeps an in-progress earlier day intact', () => {
  const h = harness(); h.controller.render('smoking');
  h.now = '2026-11-05T04:59:59Z'; assert.match(h.controller.render('smoking'), /data-habit-date value="2026-11-04"/);
  h.now = '2026-11-05T05:00:00Z'; assert.match(h.controller.render('smoking'), /data-habit-date value="2026-11-05"/);
  const dirty = harness(); dirty.controller.render('smoking'); dirty.input('smoke.notes', 'Finishing yesterday');
  dirty.now = '2026-11-05T05:00:00Z'; assert.match(dirty.controller.render('smoking'), /data-habit-date value="2026-11-04"/);
  assert.match(dirty.controller.render('smoking'), /Finishing yesterday/);
});

test('personal backup export contains the current account’s records and does not create or alter logs', async () => {
  const h = harness(state({ skills: [skill(), skill('other', { user_id: 'member' })], smokingDays: [day()] }));
  h.click('export'); await h.idle();
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].type, 'application/json');
  const backup = JSON.parse(h.downloads[0].content);
  assert.equal(backup.app, 'Life in Bloom Personal Practice'); assert.equal(backup.user_id, 'owner');
  assert.equal(backup.records.length, 2);
  assert.deepEqual(h.calls.map(item => item.method), ['exportPersonalLifeRecords']);
});

test('a private backup is reviewed before explicit restore and unrelated typed drafts are preserved', async () => {
  const h = harness(); h.click('new-skill'); h.input('skill.name', 'Keep this draft');
  h.importFile(backup(), '<private>.json'); await h.idle();
  let html = h.controller.render('skills');
  assert.match(html, /Review &lt;private&gt;.json/); assert.match(html, /1 skills · 0 practice entries/);
  assert.equal(h.calls.length, 0, 'choosing the file must not restore it yet');
  h.click('restore-backup'); await h.idle();
  assert.deepEqual(h.calls.map(item => item.method), ['importPersonalLifeRecords']);
  assert.equal(h.state.skills.length, 1); assert.equal(h.state.skills[0].name, 'C major scale');
  html = h.controller.render('skills');
  assert.match(html, /value="Keep this draft"/); assert.doesNotMatch(html, /Review &lt;private&gt;.json/);
});

test('malformed, other-account, unrelated and duplicate private backups cannot reach the restore API', async () => {
  const h = harness();
  const valid = backup();
  for (const value of ['{broken', backup({ user_id: 'member' }), backup({ household_id: 'other-house' }), backup({ records: [{ ...valid.records[0], user_id: 'member' }] }), backup({ records: [{ ...valid.records[0], kind: 'routine_log' }] }), backup({ records: [valid.records[0], valid.records[0]] })]) {
    h.importFile(value); await h.idle(); h.click('restore-backup'); await h.idle();
  }
  assert.equal(h.calls.length, 0); assert.equal(h.state.skills.length, 0);
});

test('an uncertain restore retries the same private backup after reload without duplicating records', async () => {
  const persistence = savedDraftStore(), h = harness(state(), persistence);
  h.importFile(backup()); await h.idle();
  h.methods.importPersonalLifeRecords = () => { throw new Error('Reply lost'); };
  h.click('restore-backup'); await h.idle();
  const exact = h.calls[0].args[0];
  assert.equal(h.controller.discardDraft(), false);
  const restored = harness(state(), persistence); restored.click('retry'); await restored.idle();
  assert.deepEqual(restored.calls[0].args[0], exact); assert.equal(restored.state.skills.length, 1);
  restored.importFile(backup()); await restored.idle(); restored.click('restore-backup'); await restored.idle();
  assert.equal(restored.state.skills.length, 1);
});

test('backup review and file reads are bound to the account that selected them', async () => {
  const h = harness(); h.importFile(backup()); await h.idle();
  h.state = state({ user: { id: 'member' } });
  assert.doesNotMatch(h.controller.render('skills'), /Review Personal backup.json/);
  h.click('restore-backup'); await h.idle(); assert.equal(h.calls.length, 0);
  const pending = harness(); let complete;
  pending.controller.handleChange({ target: { dataset: { habitImport: '' }, files: [{ name: 'Owner backup.json', size: 50, text: () => new Promise(resolve => { complete = resolve; }) }] } });
  await Promise.resolve();
  pending.state = state({ user: { id: 'member' } }); pending.controller.render('skills');
  complete(JSON.stringify(backup())); await pending.idle();
  assert.doesNotMatch(pending.controller.render('skills'), /Owner backup.json/); assert.equal(pending.calls.length, 0);
});

test('a conflicting restore leaves a reviewable file without changing active records', async () => {
  const h = harness(state({ skills: [skill('piano-scale', { name: 'Newer saved scale' })] }));
  h.methods.importPersonalLifeRecords = () => { throw Object.assign(new Error('Saved record conflicts with backup'), { code: '23505' }); };
  h.importFile(backup()); await h.idle(); h.click('restore-backup'); await h.idle();
  const html = h.controller.render('skills');
  assert.match(html, /Newer saved scale/); assert.match(html, /Review Personal backup.json/);
  assert.doesNotMatch(html, /Confirming your saved change|Reload saved entry/);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('signed-out screens route to sign-in and unknown events are left for other controllers', () => {
  const h = harness(state({ user: null, household: null }));
  assert.match(h.controller.render('smoking'), /Sign in to keep your personal records/);
  h.click('grocery'); assert.deepEqual(h.links, ['grocery']);
  assert.equal(h.controller.handleInput({ target: { dataset: { foodField: 'notes' }, value: 'Elsewhere' } }), false);
  assert.equal(h.controller.handleSubmit({ target: { dataset: { foodForm: 'recipe' } } }), false);
  assert.equal(h.controller.handleClick({ target: { closest: () => null } }), false);
});
