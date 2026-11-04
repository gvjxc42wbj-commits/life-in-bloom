'use strict';

// Event/render checks using the real page controller and saved-data rules.
// These tests do not substitute for a visual check in a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../bloom-data.js');
const Pages = require('../bloom-pages.js');

function harness(seed = {}) {
  let data = D.normalizeData({ records: {}, ...seed });
  let fail = false;
  let readOnly = false;
  const notices = [];
  const focus = [];
  const routes = [];
  const dates = [];
  let commitCount = 0;
  const controller = Pages.createController({
    getData: () => data,
    commitData: candidate => {
      commitCount++;
      if (fail) return false;
      data = D.normalizeData(candidate);
      return true;
    },
    canEdit: () => !readOnly,
    isReadOnly: () => readOnly,
    notify: (message, error) => notices.push({ message, error }),
    refresh: selector => focus.push(selector),
    navigate: page => routes.push(page),
    openDate: date => dates.push(date),
    getToday: () => '2026-11-03',
    getNow: () => new Date(2026, 10, 4, 5, 30)
  });
  function input(name, value) {
    return controller.handleInput({ target: { dataset: { pageField: name }, value } });
  }
  function click(action, dataset = {}) {
    const button = { dataset: { pageAction: action, ...dataset } };
    return controller.handleClick({ target: { closest: () => button } });
  }
  function submit(kind, fields) {
    const form = {
      dataset: { bloomForm: kind },
      elements: { namedItem: name => Object.hasOwn(fields, name) ? { value: fields[name] } : null },
      closest: () => form
    };
    let prevented = false;
    const handled = controller.handleSubmit({ target: form, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(handled, true);
  }
  function toggle(id, checked) {
    const field = { dataset: { shoppingToggle: id }, checked };
    assert.equal(controller.handleChange({ target: field }), true);
    return field;
  }
  return {
    controller, input, click, submit, toggle, notices, focus, routes, dates,
    get data() { return data; },
    get commitCount() { return commitCount; },
    set fail(value) { fail = value; },
    set readOnly(value) { readOnly = value; }
  };
}

function note(id, title, body) {
  return { id, title, body, createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z' };
}
function appointment(overrides = {}) {
  return {
    id: 'early-piano', title: 'Piano lesson', startDate: '2026-11-04',
    startTime: '06:00', endTime: '07:00', endNextDay: false,
    color: '#f4cbd8', notes: '', recurrence: { frequency: 'none' }, excludedDates: [],
    ...overrides
  };
}

test('Home shows actual saved counts and treats an unlogged night as unknown', () => {
  const h = harness({
    shoppingList: [
      { id: 'milk', name: 'Milk', quantity: '2 cartons', checked: false },
      { id: 'bread', name: 'Bread', quantity: '', checked: true }
    ],
    ideaNotes: [note('garden', 'Garden', 'Try basil')]
  });
  const html = h.controller.render('home');
  assert.match(html, /Sleep not logged yet/);
  assert.doesNotMatch(html, /0 hrs logged asleep/);
  assert.match(html, /1 item to buy/);
  assert.match(html, /1 saved note/);
  assert.match(html, /data-page-target="grocery"/);
  assert.match(html, /data-page-target="ideas"/);
  assert.match(html, /No appointments planned in the next seven days/);
  assert.equal(h.commitCount, 0);

  h.click('navigate', { pageTarget: 'grocery' });
  h.click('open-day', { date: '2026-11-03' });
  assert.deepEqual(h.routes, ['grocery']);
  assert.deepEqual(h.dates, ['2026-11-03']);
});

test('Home appointment links respect the 8 AM tracking boundary without creating logged activity', () => {
  const record = D.setMood(D.setRange(D.blankRecord(), 0, 2, 'awake', 'cooking'), 0, { feeling: 'Calm' });
  const h = harness({
    records: { '2026-11-03': record },
    appointments: [appointment({ title: '<img src=x onerror=alert(1)>' })]
  });
  const before = JSON.stringify(h.data);
  const html = h.controller.render('home');
  assert.match(html, /1 hourly feeling recorded/);
  assert.match(html, /class="appointment-agenda-item" data-page-action="open-day" data-date="2026-11-03"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(JSON.stringify(h.data), before);
  assert.equal(h.commitCount, 0);
});

test('Grocery add, check, edit, and remove keep the saved list and unrelated records consistent', () => {
  const h = harness({
    records: { '2026-11-03': D.setSlot(D.blankRecord(), 0, 'sleep') },
    ideaNotes: [note('idea-one', 'Soup', 'Try lemon chicken soup')]
  });
  const recordBefore = JSON.stringify(h.data.records);
  const notesBefore = JSON.stringify(h.data.ideaNotes);
  h.input('shopping-name', 'Milk');
  h.input('shopping-quantity', '2 cartons');
  assert.equal(h.controller.hasUnsavedDraft(), true);
  h.submit('shopping', { 'shopping-name': 'Milk', 'shopping-quantity': '2 cartons' });
  assert.equal(h.data.shoppingList.length, 1);
  assert.equal(h.controller.hasUnsavedDraft(), false);
  const id = h.data.shoppingList[0].id;
  assert.equal(h.data.shoppingList[0].checked, false);
  assert.match(h.controller.render('grocery'), /2 cartons/);

  h.toggle(id, true);
  assert.equal(h.data.shoppingList[0].checked, true);
  assert.match(h.controller.render('grocery'), /0 to buy · 1 picked up/);
  h.click('edit-shopping', { itemId: id });
  h.submit('shopping', { 'shopping-name': 'Oat milk', 'shopping-quantity': '1 carton' });
  assert.equal(h.data.shoppingList.length, 1);
  assert.equal(h.data.shoppingList[0].name, 'Oat milk');
  assert.equal(h.data.shoppingList[0].checked, true);
  h.toggle(id, false);
  assert.equal(h.data.shoppingList[0].checked, false);
  h.click('remove-shopping', { itemId: id });
  assert.equal(h.data.shoppingList.length, 0);
  assert.equal(JSON.stringify(h.data.records), recordBefore);
  assert.equal(JSON.stringify(h.data.ideaNotes), notesBefore);
});

test('failed Grocery saves preserve typed text and roll back an unsuccessful checkbox change', () => {
  const h = harness({ shoppingList: [{ id: 'tea', name: 'Tea', quantity: '', checked: false }] });
  const before = JSON.stringify(h.data);
  h.fail = true;
  h.submit('shopping', { 'shopping-name': 'Bread <whole wheat>', 'shopping-quantity': '1 loaf' });
  assert.equal(JSON.stringify(h.data), before);
  assert.equal(h.controller.hasUnsavedDraft('grocery'), true);
  assert.match(h.controller.render('grocery'), /value="Bread &lt;whole wheat&gt;"/);
  const field = h.toggle('tea', true);
  assert.equal(field.checked, false);
  assert.equal(JSON.stringify(h.data), before);
  h.fail = false;
  h.submit('shopping', { 'shopping-name': 'Bread <whole wheat>', 'shopping-quantity': '1 loaf' });
  assert.equal(h.data.shoppingList.length, 2);
  assert.equal(h.controller.hasUnsavedDraft(), false);
});

test('Ideas preserves multiline text, edits one saved note, and requires a delete confirmation', () => {
  const h = harness();
  const body = 'Piano practice\nTry <five minutes> & keep it gentle.\n👩🏾‍🍳 Recipe idea';
  h.submit('idea', { 'idea-title': 'A little plan', 'idea-body': body });
  assert.equal(h.data.ideaNotes.length, 1);
  assert.equal(h.data.ideaNotes[0].body, body);
  const id = h.data.ideaNotes[0].id;
  const createdAt = h.data.ideaNotes[0].createdAt;
  assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.match(h.controller.render('ideas'), /Try &lt;five minutes&gt; &amp; keep it gentle/);
  h.click('edit-note', { noteId: id });
  assert.match(h.controller.render('ideas'), /value="A little plan"/);
  h.submit('idea', { 'idea-title': 'My updated plan', 'idea-body': body + '\nSewing too.' });
  assert.equal(h.data.ideaNotes.length, 1);
  assert.equal(h.data.ideaNotes[0].id, id);
  assert.equal(h.data.ideaNotes[0].createdAt, createdAt);
  h.click('remove-note', { noteId: id });
  assert.equal(h.data.ideaNotes.length, 1);
  assert.match(h.controller.render('ideas'), /Delete this saved note/);
  h.click('keep-note');
  assert.doesNotMatch(h.controller.render('ideas'), /Delete this saved note/);
  h.click('confirm-remove-note', { noteId: id });
  assert.equal(h.data.ideaNotes.length, 1);
  h.click('remove-note', { noteId: id });
  h.click('confirm-remove-note', { noteId: id });
  assert.equal(h.data.ideaNotes.length, 0);
});

test('unsaved Ideas edits survive a failed save, a re-render, and an attempted switch to another note', () => {
  const h = harness({
    ideaNotes: [note('first', 'First', 'Saved text'), note('second', 'Second', 'Other saved text')]
  });
  h.click('edit-note', { noteId: 'first' });
  h.input('idea-body', 'Still typing\nDo not lose me.');
  assert.equal(h.controller.hasUnsavedDraft('ideas'), true);
  h.click('edit-note', { noteId: 'second' });
  assert.match(h.controller.render('ideas'), /Still typing\nDo not lose me/);
  assert.match(h.notices.at(-1).message, /Save or discard/);
  h.fail = true;
  h.submit('idea', { 'idea-title': 'First', 'idea-body': 'Still typing\nDo not lose me.' });
  assert.equal(h.data.ideaNotes.find(entry => entry.id === 'first').body, 'Saved text');
  assert.equal(h.controller.hasUnsavedDraft(), true);
  assert.match(h.controller.render('ideas'), /Still typing\nDo not lose me/);
  h.controller.discardDraft();
  assert.equal(h.controller.hasUnsavedDraft(), false);
  assert.match(h.controller.render('ideas'), /<textarea[^>]*><\/textarea>/);
});

test('Ideas allows a body without a title and does not erase a note on a failed delete', () => {
  const h = harness();
  h.submit('idea', { 'idea-title': '', 'idea-body': 'Remember the new recipe' });
  assert.equal(h.data.ideaNotes.length, 1);
  const id = h.data.ideaNotes[0].id;
  h.click('remove-note', { noteId: id });
  h.fail = true;
  h.click('confirm-remove-note', { noteId: id });
  assert.equal(h.data.ideaNotes.length, 1);
  assert.match(h.controller.render('ideas'), /Delete this saved note/);
  h.fail = false;
  h.click('confirm-remove-note', { noteId: id });
  assert.equal(h.data.ideaNotes.length, 0);
});

test('read-only mode disables mutation controls while Home and section navigation remain usable', () => {
  const h = harness({
    shoppingList: [{ id: 'milk', name: 'Milk', quantity: '', checked: false }],
    ideaNotes: [note('idea-one', 'Garden', 'Basil')]
  });
  h.readOnly = true;
  const grocery = h.controller.render('grocery');
  const ideas = h.controller.render('ideas');
  assert.match(grocery, /data-shopping-toggle="milk" disabled/);
  assert.match(ideas, /data-page-field="idea-body"[^>]* disabled/);
  assert.equal(h.commitCount, 0);
  h.toggle('milk', true);
  h.click('remove-shopping', { itemId: 'milk' });
  h.submit('idea', { 'idea-title': 'New', 'idea-body': 'Text' });
  assert.equal(h.commitCount, 0);
  assert.equal(h.data.shoppingList[0].checked, false);
  assert.equal(h.data.ideaNotes.length, 1);
  h.click('navigate', { pageTarget: 'home' });
  assert.deepEqual(h.routes, ['home']);
});

test('section landing pages describe tools still to be built and link to available tools', () => {
  const h = harness();
  assert.match(h.controller.render('money'), /no money entries are being recorded here yet/);
  assert.match(h.controller.render('dog'), /care tools will be added in a later step/);
  assert.match(h.controller.render('wellness'), /Nutrition/);
  assert.match(h.controller.render('food'), /data-page-target="grocery"/);
  assert.match(h.controller.render('skills'), /data-page-target="sleep-mood"/);
  assert.match(h.controller.render('housework'), /data-page-target="sleep-mood"/);
  assert.equal(h.commitCount, 0);
});
