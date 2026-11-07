/* Home, legacy device shopping, and personal notes. Cloud Grocery is a separate controller. */
(function (root) {
  'use strict';

  const D = root.BloomData || (typeof require === 'function' ? require('./bloom-data.js') : null);
  const SECTIONS = {
    wellness: {
      title: 'Wellness',
      subtitle: 'Nutrition',
      text: 'This is the place for water, Boost, meals, and nutrition. The nutrition tools will be added in a later step.',
      links: [{ page: 'grocery', label: 'Open your grocery list' }]
    },
    money: {
      title: 'Money in Bloom',
      subtitle: 'Your money ledger',
      text: 'Payments, purchases, and who paid will belong here. This page is ready for the ledger to be built; no money entries are being recorded here yet.',
      links: []
    },
    food: {
      title: 'Food in Bloom',
      subtitle: 'Food, recipes, and what you have',
      text: 'Recipes and meal planning will belong here. Open Grocery for your shared list, monthly food budget, and Pantry, Refrigerator, and Freezer inventory.',
      links: [{ page: 'grocery', label: 'Open Grocery' }]
    },
    skills: {
      title: 'Skills in Bloom',
      subtitle: 'A little practice, at your pace',
      text: 'Piano, sewing, math, language, and your other interests will have their own tools here. For now, you can record time spent on an activity in the Awake choices in your Daily Log.',
      links: [{ page: 'sleep-mood', label: 'Open Sleep & Mood' }]
    },
    housework: {
      title: 'Housework',
      subtitle: 'A place for your household routines',
      text: 'Housework lists and routines will be added here. You can already record time spent on chores in the Awake choices in your Daily Log.',
      links: [{ page: 'sleep-mood', label: 'Open Sleep & Mood' }]
    },
    dog: {
      title: 'Dog',
      subtitle: 'Care for your companion',
      text: 'Your dog’s care records and routines will belong here. The care tools will be added in a later step.',
      links: []
    },
    smoking: {
      title: 'Smoking Log',
      subtitle: 'Your observations, one day at a time',
      text: 'Daily amounts, cravings, notes, and cost estimates will belong here. The smoking log will be added in a later step.',
      links: []
    }
  };

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }
  function newId(prefix) {
    const suffix = root.crypto && typeof root.crypto.randomUUID === 'function'
      ? root.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    return prefix + '-' + suffix;
  }
  function dateLabel(key) {
    return D.parseDate(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function timeLabel(date) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function calendarKey(date) {
    return D.dateKey(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function trackingKey(date) {
    const key = calendarKey(date);
    return date.getHours() < 8 ? D.shiftDate(key, -1) : key;
  }
  function noteLabel(note) {
    return note.title || note.body.trim().split(/\r?\n/)[0].slice(0, 70) || 'Untitled note';
  }
  function editedLabel(value) {
    if (!value) return 'Saved note';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Saved note';
    return 'Saved ' + date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function linkButton(page, label, primary) {
    return '<button type="button" class="button' + (primary ? ' primary' : '') + '" data-page-action="navigate" data-page-target="' + escapeText(page) + '">' + escapeText(label) + '</button>';
  }
  function blankShopping() { return { id: '', name: '', quantity: '' }; }
  function blankNote() { return { id: '', title: '', body: '' }; }

  function createController(options) {
    if (!D) throw new Error('The saved-data tools are not available.');
    const { getData, commitData, canEdit, refresh, navigate, openDate } = options;
    const notify = options.notify || (() => {});
    const isReadOnly = options.isReadOnly || (() => false);
    const getNow = options.getNow || (() => new Date());
    const getToday = options.getToday || (() => trackingKey(getNow()));
    let shoppingDraft = blankShopping();
    let shoppingBaseline = blankShopping();
    let noteDraft = blankNote();
    let noteBaseline = blankNote();
    let pendingNoteDelete = '';
    let skillsView = 'me';
    const SKILLS_KEY = 'life-in-bloom-skills-v1';
    const DEFAULT_SKILLS = [
      ['painting', '🎨', 'Painting', 120],
      ['spanish', '🇪🇸', 'Spanish', 90],
      ['piano', '🎹', 'Piano', 60],
      ['science', '🧪', 'Science', 60],
      ['programming', '💻', 'Programming', 60],
      ['unity', '🎮', 'Unity / Game Dev', 60],
      ['blender', '🧊', 'Blender / 3D', 45],
      ['sewing', '🪡', 'Sewing', 45],
      ['cursive', '✍️', 'Cursive', 30],
      ['electronics', '🔌', 'Electronics', 30]
    ];

    function currentWeekKey() {
      const date = getNow();
      const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const day = (copy.getDay() + 6) % 7;
      copy.setDate(copy.getDate() - day);
      return calendarKey(copy);
    }
    function loadSkillsState() {
      const fallback = {
        weeklyGoalMinutes: 600,
        weekKey: currentWeekKey(),
        completed: {},
        studied: {},
        scienceNotes: '',
        scienceTopic: 'Scientific Notation',
        scienceQuiz: {}
      };
      try {
        const raw = root.localStorage && root.localStorage.getItem(SKILLS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return {
          ...fallback,
          ...parsed,
          completed: parsed.completed || {},
          studied: parsed.studied || {},
          scienceQuiz: parsed.scienceQuiz || {}
        };
      } catch (_) { return fallback; }
    }
    function saveSkillsState(state) {
      if (!root.localStorage) return;
      root.localStorage.setItem(SKILLS_KEY, JSON.stringify(state));
    }
    function ensureCurrentSkillsWeek(state) {
      const weekKey = currentWeekKey();
      if (state.weekKey === weekKey) return state;
      return { ...state, weekKey, completed: {}, studied: {} };
    }
    function skillsState() {
      const state = ensureCurrentSkillsWeek(loadSkillsState());
      saveSkillsState(state);
      return state;
    }
    function skillMinutes(state) {
      return DEFAULT_SKILLS.reduce((sum, skill) => sum + Number(state.studied[skill[0]] || 0), 0);
    }
    function progressBar(percent, label) {
      const safe = Math.max(0, Math.min(100, percent));
      return '<div class="skills-progress-wrap" aria-label="' + escapeText(label) + '"><div class="skills-progress-track"><div class="skills-progress-fill" style="width:' + safe + '%"></div></div><strong>' + Math.round(safe) + '%</strong></div>';
    }

    const disabled = () => isReadOnly() ? ' disabled' : '';
    function shoppingDirty() {
      return shoppingDraft.name !== shoppingBaseline.name || shoppingDraft.quantity !== shoppingBaseline.quantity;
    }
    function noteDirty() {
      return noteDraft.title !== noteBaseline.title || noteDraft.body !== noteBaseline.body;
    }
    function resetShopping() {
      shoppingDraft = blankShopping();
      shoppingBaseline = blankShopping();
    }
    function resetNote() {
      noteDraft = blankNote();
      noteBaseline = blankNote();
      pendingNoteDelete = '';
    }
    function discardDraft(page) {
      if (!page || page === 'grocery') resetShopping();
      if (!page || page === 'ideas') resetNote();
    }
    function hasUnsavedDraft(page) {
      if (page === 'grocery') return shoppingDirty();
      if (page === 'ideas') return noteDirty();
      return shoppingDirty() || noteDirty();
    }
    function reportError(error) {
      notify(error && error.message ? error.message : 'This change could not be saved. Your saved entries have not been replaced.', true);
    }
    function formValue(form, name, fallback) {
      const field = form.elements && typeof form.elements.namedItem === 'function'
        ? form.elements.namedItem(name)
        : form.querySelector && form.querySelector('[name="' + name + '"]');
      return field && typeof field.value === 'string' ? field.value : fallback;
    }

    function renderHome() {
      const data = getData();
      const personalAvailable = options.getPersonalAvailable ? options.getPersonalAvailable() : true;
      const grocerySummary = options.getGrocerySummary ? options.getGrocerySummary() : null;
      const today = getToday();
      const record = data.records[today] || D.blankRecord();
      const sleep = Object.values(record.slots).filter(value => value === 'sleep').length / 2;
      const sleepText = D.hasSleepTotal(record) ? sleep + ' hrs logged asleep' : 'Sleep not logged yet';
      const moodCount = Object.keys(record.moods).length;
      const remaining = (data.shoppingList || []).filter(item => !item.checked).length;
      const noteCount = (data.ideaNotes || []).length;
      const now = getNow();
      const until = new Date(now);
      until.setDate(until.getDate() + 7);
      const upcoming = D.appointmentsInWindow(data.appointments || [], now, until).slice(0, 3);
      let html = '<section class="bloom-page"><div class="page-heading"><p class="page-kicker">Your main page</p><h2>Your day, at a glance</h2><p>' + escapeText(dateLabel(calendarKey(now))) + '</p></div>';
      html += '<div class="home-grid">';
      if (personalAvailable) html += '<button type="button" class="home-card" data-page-action="open-day" data-date="' + today + '"><span class="page-kicker">Sleep &amp; Mood</span><strong class="home-card-value">' + escapeText(sleepText) + '</strong><span>' + moodCount + ' hourly feeling' + (moodCount === 1 ? '' : 's') + ' recorded</span><small>Tracking day ' + escapeText(D.parseDate(today).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + ', 8 AM to the next 8 AM · Open Daily Log ›</small></button>';
      const groceryTitle = grocerySummary ? grocerySummary.title : remaining + ' item' + (remaining === 1 ? '' : 's') + ' to buy';
      const groceryDescription = grocerySummary ? grocerySummary.description : 'Your saved shopping list';
      html += '<button type="button" class="home-card" data-page-action="navigate" data-page-target="grocery"><span class="page-kicker">Grocery</span><strong class="home-card-value">' + escapeText(groceryTitle) + '</strong><span>' + escapeText(groceryDescription) + '</span><small>Open Grocery ›</small></button>';
      if (personalAvailable) html += '<button type="button" class="home-card" data-page-action="navigate" data-page-target="ideas"><span class="page-kicker">Idea’s in Bloom</span><strong class="home-card-value">' + noteCount + ' saved note' + (noteCount === 1 ? '' : 's') + '</strong><span>A place to keep your ideas</span><small>Open your notes ›</small></button>';
      html += '</div>';
      if (options.renderDashboard) {
        const dashboard = options.renderDashboard({ personalAvailable, grocerySummary, today, sleepText, moodCount, noteCount, now });
        if (dashboard) html = '<section class="bloom-page">' + dashboard;
      }
      if (personalAvailable) {
      html += '<section class="panel"><div class="panel-title-row"><h2>Coming up</h2>' + linkButton('sleep-mood', 'Sleep & Mood') + '</div><p class="caption">Up to three appointments in the next seven days. Tap one to open its Daily Log.</p>';
      if (!upcoming.length) {
        html += '<p class="empty-state">No appointments planned in the next seven days. Add plans in Sleep &amp; Mood whenever you are ready.</p>';
      } else {
        html += '<ul class="appointment-agenda">';
        for (const appointment of upcoming) {
          const displayedDate = appointment.start < now ? trackingKey(now) : trackingKey(appointment.start);
          const startDate = calendarKey(appointment.start);
          const endDate = calendarKey(appointment.end);
          const date = appointment.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const ending = (endDate !== startDate ? appointment.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' : '') + timeLabel(appointment.end);
          const color = /^#[0-9a-f]{6}$/i.test(appointment.color) ? appointment.color : '#f4cbd8';
          html += '<li><button type="button" class="appointment-agenda-item" data-page-action="open-day" data-date="' + displayedDate + '" style="--appointment-color:' + color + '"><span class="appointment-planned-label">Planned</span><span class="appointment-agenda-date">' + escapeText(date) + '</span><span class="appointment-agenda-title">' + escapeText(appointment.title) + '</span><span class="appointment-agenda-time">' + escapeText(timeLabel(appointment.start) + '–' + ending) + '</span>' + (appointment.timeAdjusted ? '<span class="appointment-time-note">Clock change: check this time.</span>' : '') + '</button></li>';
        }
        html += '</ul>';
      }
      html += '</section>';
      }
      html += '<section class="panel"><h2>Your other spaces</h2><p class="caption">Use the menu for every section, or choose a shortcut below.</p><div class="section-links">' + linkButton('wellness', 'Wellness · Nutrition') + linkButton('food', 'Food in Bloom') + linkButton('skills', 'Skills in Bloom') + linkButton('housework', 'Housework') + linkButton('dog', 'Dog') + linkButton('money', 'Money in Bloom') + linkButton('smoking', 'Smoking Log') + '</div></section></section>';
      return html;
    }

    function renderGrocery() {
      const items = (getData().shoppingList || []).map((item, index) => ({ ...item, originalIndex: index }))
        .sort((a, b) => Number(a.checked) - Number(b.checked) || a.originalIndex - b.originalIndex);
      const remaining = items.filter(item => !item.checked).length;
      const editing = Boolean(shoppingDraft.id);
      let html = '<section class="bloom-page"><div class="page-heading"><p class="page-kicker">Grocery</p><h2>Your grocery list</h2><p>Keep the things you need to buy here. Tick an item when you pick it up.</p></div>';
      html += '<section class="panel"><h3>' + (editing ? 'Edit an item' : 'Add something to buy') + '</h3><form class="page-form" data-bloom-form="shopping"><div class="form-row"><label class="form-field" for="shopping-name"><span>Item</span><input id="shopping-name" name="shopping-name" data-page-field="shopping-name" type="text" maxlength="160" required autocomplete="off" value="' + escapeText(shoppingDraft.name) + '"' + disabled() + ' /></label><label class="form-field" for="shopping-quantity"><span>Quantity or size <small>(optional)</small></span><input id="shopping-quantity" name="shopping-quantity" data-page-field="shopping-quantity" type="text" maxlength="120" placeholder="For example, 2 cartons" value="' + escapeText(shoppingDraft.quantity) + '"' + disabled() + ' /></label></div><div class="page-actions"><button type="submit" class="button primary"' + disabled() + '>' + (editing ? 'Save changes' : '+ Add to list') + '</button><button type="button" class="button" data-page-action="cancel-shopping"' + disabled() + '>' + (editing ? 'Discard changes' : 'Clear form') + '</button></div></form></section>';
      html += '<section class="panel"><div class="panel-title-row"><h3>Things to buy</h3><span class="pill">' + remaining + ' to buy · ' + (items.length - remaining) + ' picked up</span></div>';
      if (!items.length) {
        html += '<p class="empty-state">Your list is empty. Add an item above and it will stay here for your next visit.</p>';
      } else {
        html += '<ul class="shopping-list">';
        for (const item of items) {
          html += '<li class="shopping-item' + (item.checked ? ' is-checked' : '') + '"><label class="shopping-item-main" for="shopping-check-' + escapeText(item.id) + '"><input type="checkbox" id="shopping-check-' + escapeText(item.id) + '" data-shopping-toggle="' + escapeText(item.id) + '"' + (item.checked ? ' checked' : '') + disabled() + ' /><span class="shopping-item-copy"><strong>' + escapeText(item.name) + '</strong>' + (item.quantity ? '<small>' + escapeText(item.quantity) + '</small>' : '') + '<small>' + (item.checked ? 'Picked up' : 'To buy') + '</small></span></label><div class="item-actions"><button type="button" class="button" data-page-action="edit-shopping" data-item-id="' + escapeText(item.id) + '" aria-label="Edit ' + escapeText(item.name) + '"' + disabled() + '>Edit</button><button type="button" class="button" data-page-action="remove-shopping" data-item-id="' + escapeText(item.id) + '" aria-label="Remove ' + escapeText(item.name) + ' from the list"' + disabled() + '>Remove</button></div></li>';
        }
        html += '</ul>';
      }
      return html + '<p class="form-hint">Picked-up items stay on this list until you remove them. Checking an item does not yet update food inventory or money records.</p><p class="caption save-state">Saved on this device</p></section></section>';
    }

    function renderIdeas() {
      const notes = (getData().ideaNotes || []).map((note, index) => ({ ...note, originalIndex: index }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.originalIndex - b.originalIndex);
      const editing = Boolean(noteDraft.id);
      let html = '<section class="bloom-page"><div class="page-heading"><p class="page-kicker">Idea’s in Bloom</p><h2>A place for your ideas</h2><p>Type a thought, a plan, or something you want to remember. Choose Save note to keep it.</p></div>';
      html += '<section class="panel"><h3>' + (editing ? 'Edit your note' : 'Write a note') + '</h3><form class="page-form" data-bloom-form="idea"><label class="form-field" for="idea-title"><span>Title <small>(optional)</small></span><input id="idea-title" name="idea-title" data-page-field="idea-title" type="text" maxlength="160" value="' + escapeText(noteDraft.title) + '"' + disabled() + ' /></label><label class="form-field" for="idea-body"><span>Your note</span><textarea id="idea-body" name="idea-body" data-page-field="idea-body" rows="7" maxlength="20000" aria-describedby="idea-save-hint"' + disabled() + '>' + escapeText(noteDraft.body) + '</textarea></label><p id="idea-save-hint" class="form-hint">Add a title, a note, or both. Your typing is kept when you press Save note.</p><div class="page-actions"><button type="submit" class="button primary"' + disabled() + '>Save note</button><button type="button" class="button" data-page-action="cancel-note"' + disabled() + '>' + (editing ? 'Discard changes / new note' : 'Clear form') + '</button></div></form></section>';
      html += '<section class="panel"><div class="panel-title-row"><h3>Your saved notes</h3><span class="pill">' + notes.length + ' note' + (notes.length === 1 ? '' : 's') + '</span></div>';
      if (!notes.length) {
        html += '<p class="empty-state">No notes saved yet. Your first saved idea will appear here.</p>';
      } else {
        html += '<div class="notes-list">';
        for (const note of notes) {
          const label = noteLabel(note);
          html += '<article class="idea-card"><h3>' + escapeText(label) + '</h3><p class="caption">' + escapeText(editedLabel(note.updatedAt)) + '</p>';
          if (note.body) html += '<details class="idea-details"><summary>Read note</summary><div class="idea-body">' + escapeText(note.body) + '</div></details>';
          if (pendingNoteDelete === note.id) {
            html += '<div class="note-delete-confirm"><p>Delete this saved note?</p><div class="item-actions"><button type="button" class="button" data-page-action="confirm-remove-note" data-note-id="' + escapeText(note.id) + '"' + disabled() + '>Delete note</button><button type="button" class="button" data-page-action="keep-note">Keep note</button></div></div>';
          } else {
            html += '<div class="item-actions"><button type="button" class="button" data-page-action="edit-note" data-note-id="' + escapeText(note.id) + '" aria-label="Edit note: ' + escapeText(label) + '"' + disabled() + '>Edit</button><button type="button" class="button" data-page-action="remove-note" data-note-id="' + escapeText(note.id) + '" aria-label="Delete note: ' + escapeText(label) + '"' + disabled() + '>Delete</button></div>';
          }
          html += '</article>';
        }
        html += '</div>';
      }
      return html + '<p class="caption save-state">Saved on this device</p></section></section>';
    }


    function renderSkills() {
      const state = skillsState();
      if (skillsView === 'science') return renderScience(state);
      const total = skillMinutes(state);
      const goal = Math.max(60, Number(state.weeklyGoalMinutes || 600));
      const percent = Math.min(100, (total / goal) * 100);
      const touched = DEFAULT_SKILLS.filter(skill => Number(state.studied[skill[0]] || 0) > 0).length;
      const balance = DEFAULT_SKILLS.length ? (touched / DEFAULT_SKILLS.length) * 100 : 0;
      let html = '<section class="bloom-page skills-bloom"><div class="page-heading"><p class="page-kicker">Skills in Bloom · Me</p><h2>My Learning Week</h2><p>Keep your 10-hour week balanced across everything you are learning.</p></div>';
      html += '<div class="skills-tab-row"><button type="button" class="button primary" data-page-action="skills-view" data-skills-view="me">Me · Master Dashboard</button><button type="button" class="button" data-page-action="skills-view" data-skills-view="science">Science</button></div>';
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">Weekly study goal</p><h3>' + (total / 60).toFixed(1) + ' / ' + (goal / 60).toFixed(1) + ' hours</h3></div><span class="pill">' + Math.round(percent) + '% complete</span></div>';
      html += progressBar(percent, 'Weekly study progress');
      html += '<label class="form-field"><span>Weekly goal: <strong>' + (goal / 60).toFixed(1) + ' hours</strong></span><input type="range" min="1" max="20" step="0.5" value="' + (goal / 60) + '" data-skills-field="weekly-goal" /></label></section>';
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">Well-roundedness</p><h3>Weekly Balance</h3></div><span class="pill">' + touched + ' / ' + DEFAULT_SKILLS.length + ' subjects touched</span></div>' + progressBar(balance, 'Weekly subject balance') + '<p class="caption">This measures whether you intentionally studied your planned subjects; it does not require every subject to get equal time.</p></section>';
      html += '<section class="panel"><div class="panel-title-row"><h3>This week</h3><span class="pill">Move each slider as you study</span></div><div class="skills-dashboard-list">';
      for (const skill of DEFAULT_SKILLS) {
        const minutes = Number(state.studied[skill[0]] || 0);
        const checked = Boolean(state.completed[skill[0]]) || minutes > 0;
        html += '<article class="skills-dashboard-card"><label class="skills-check"><input type="checkbox" data-skills-check="' + skill[0] + '"' + (checked ? ' checked' : '') + ' /><span>' + skill[1] + ' <strong>' + escapeText(skill[2]) + '</strong></span></label><div class="skills-minutes"><span>' + minutes + ' min</span><input type="range" min="0" max="180" step="5" value="' + minutes + '" data-skills-minutes="' + skill[0] + '" aria-label="' + escapeText(skill[2]) + ' minutes studied this week" /></div></article>';
      }
      html += '</div></section>';
      html += '<section class="panel"><div class="panel-title-row"><h3>What should I study next?</h3><button type="button" class="button primary" data-page-action="skills-next">Choose for me</button></div><p id="skills-next-answer" class="empty-state">Use this when you want Life in Bloom to point you toward a subject you have not touched much this week.</p></section></section>';
      return html;
    }

    function renderScience(state) {
      const quiz = state.scienceQuiz || {};
      let html = '<section class="bloom-page skills-bloom"><div class="page-heading"><p class="page-kicker">Skills in Bloom · Science</p><h2>Science</h2><p>Learn the foundations, practice them, test yourself, and keep your own notes.</p></div>';
      html += '<div class="skills-tab-row"><button type="button" class="button" data-page-action="skills-view" data-skills-view="me">Me · Master Dashboard</button><button type="button" class="button primary" data-page-action="skills-view" data-skills-view="science">Science</button></div>';
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">1 · Scientific Notation</p><h3>Write very large or very small numbers clearly</h3></div><span class="pill">Foundation</span></div><p>Scientific notation writes a number as a coefficient between 1 and 10 multiplied by a power of ten. A positive exponent moves the decimal to the right when you expand the number; a negative exponent moves it to the left.</p><div class="science-example"><strong>Examples</strong><p>32,500 = 3.25 × 10⁴</p><p>0.00325 = 3.25 × 10⁻³</p></div><details><summary>Practice</summary><div class="science-practice"><p>1. Write 450,000 in scientific notation.</p><p>2. Write 6.2 × 10⁻⁴ as a decimal.</p><p>3. Which exponent would you use for 0.000081?</p></div></details></section>';
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">2 · Scientific Method</p><h3>Turn a question into a testable investigation</h3></div></div><div class="science-method-flow"><span>Question</span><b>→</b><span>Research</span><b>→</b><span>Hypothesis</span><b>→</b><span>Experiment</span><b>→</b><span>Data</span><b>→</b><span>Analysis</span><b>→</b><span>Conclusion</span></div><p>Practice identifying the independent variable, dependent variable, constants, control group, observations, and the data you would collect.</p><details><summary>Practice scenario</summary><p><strong>Question:</strong> Does changing the amount of sunlight affect how quickly a bean plant grows?</p><p>Identify the independent variable, dependent variable, constants, and the measurements you would record.</p></details></section>';
      const chemistryTopics = ['Matter: solids, liquids, gases','Elements, compounds & mixtures','Atoms','Protons, neutrons & electrons','Atomic number & atomic mass','Periodic table basics','Groups & periods','Metals, nonmetals & metalloids','Ions','Molecules','Chemical formulas','Chemical bonds','Chemical reactions','Balancing simple equations','Acids & bases','pH','Moles & molar mass','Solutions & concentration','Laboratory measurement','Lab safety'];
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">3 · Chemistry Basics</p><h3>Foundation course</h3></div><span class="pill">' + chemistryTopics.length + ' topics</span></div><div class="science-topic-grid">' + chemistryTopics.map((topic, i) => '<label class="science-topic"><input type="checkbox" data-science-topic="' + i + '"' + (quiz['topic-' + i] ? ' checked' : '') + ' /><span>' + escapeText(topic) + '</span></label>').join('') + '</div></section>';
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">Practice Test</p><h3>Quick science check</h3></div></div><div class="science-quiz"><p><strong>1.</strong> In 4.2 × 10³, what does the exponent tell you?</p><label><input type="radio" name="science-q1" value="a" data-science-quiz="q1"' + (quiz.q1 === 'a' ? ' checked' : '') + '> The number of decimal places the decimal moves</label><label><input type="radio" name="science-q1" value="b" data-science-quiz="q1"' + (quiz.q1 === 'b' ? ' checked' : '') + '> The number of atoms</label><p><strong>2.</strong> In an experiment, what is the variable you deliberately change?</p><label><input type="radio" name="science-q2" value="a" data-science-quiz="q2"' + (quiz.q2 === 'a' ? ' checked' : '') + '> Dependent variable</label><label><input type="radio" name="science-q2" value="b" data-science-quiz="q2"' + (quiz.q2 === 'b' ? ' checked' : '') + '> Independent variable</label><p><strong>3.</strong> Which particle has a negative charge?</p><label><input type="radio" name="science-q3" value="a" data-science-quiz="q3"' + (quiz.q3 === 'a' ? ' checked' : '') + '> Electron</label><label><input type="radio" name="science-q3" value="b" data-science-quiz="q3"' + (quiz.q3 === 'b' ? ' checked' : '') + '> Proton</label><div class="page-actions"><button type="button" class="button primary" data-page-action="science-grade">Grade practice test</button></div><p id="science-grade-result" class="caption"></p></div></section>';
      html += '<section class="panel"><div class="panel-title-row"><div><p class="page-kicker">Science Notebook</p><h3>Your notes</h3></div><span class="pill">Saved on this device</span></div><label class="form-field"><span>Lesson notes, formulas, questions, tutor notes, or things to review</span><textarea rows="10" maxlength="30000" data-skills-field="science-notes" placeholder="Write your science notes here…">' + escapeText(state.scienceNotes || '') + '</textarea></label></section></section>';
      return html;
    }

    function renderSection(page) {
      const section = SECTIONS[page];
      if (!section) return '<section class="panel"><h2>Choose a page</h2>' + linkButton('home', 'Go Home', true) + '</section>';
      return '<section class="bloom-page"><div class="page-heading"><p class="page-kicker">' + escapeText(section.title) + '</p><h2>' + escapeText(section.subtitle) + '</h2></div><section class="panel section-preview"><p>' + escapeText(section.text) + '</p><div class="section-links">' + section.links.map(link => linkButton(link.page, link.label, true)).join('') + linkButton('home', 'Back to Home') + '</div></section></section>';
    }
    function render(page) {
      if (page === 'home') return renderHome();
      if (page === 'grocery') return renderGrocery();
      if (page === 'ideas') return renderIdeas();
      if (page === 'skills') return renderSkills();
      return renderSection(page);
    }

    function handleInput(event) {
      const field = event.target;
      const name = field && field.dataset && field.dataset.pageField;
      if (field && field.dataset && field.dataset.skillsField) {
        const state = skillsState();
        if (field.dataset.skillsField === 'weekly-goal') state.weeklyGoalMinutes = Math.round(Number(field.value || 10) * 60);
        if (field.dataset.skillsField === 'science-notes') state.scienceNotes = field.value;
        saveSkillsState(state);
        if (field.dataset.skillsField === 'weekly-goal') refresh();
        return true;
      }
      if (field && field.dataset && field.dataset.skillsMinutes) {
        const state = skillsState();
        const id = field.dataset.skillsMinutes;
        state.studied[id] = Math.max(0, Number(field.value || 0));
        state.completed[id] = state.studied[id] > 0;
        saveSkillsState(state);
        refresh();
        return true;
      }
      if (!name) return false;
      if (name === 'shopping-name') shoppingDraft.name = field.value;
      else if (name === 'shopping-quantity') shoppingDraft.quantity = field.value;
      else if (name === 'idea-title') noteDraft.title = field.value;
      else if (name === 'idea-body') noteDraft.body = field.value;
      else return false;
      return true;
    }
    function handleSubmit(event) {
      const form = event.target && event.target.closest && event.target.closest('form[data-bloom-form]');
      const kind = form && form.dataset.bloomForm;
      if (kind !== 'shopping' && kind !== 'idea') return false;
      event.preventDefault();
      if (!canEdit()) return true;
      try {
        if (kind === 'shopping') {
          shoppingDraft.name = formValue(form, 'shopping-name', shoppingDraft.name);
          shoppingDraft.quantity = formValue(form, 'shopping-quantity', shoppingDraft.quantity);
          const editing = Boolean(shoppingDraft.id);
          const old = (getData().shoppingList || []).find(item => item.id === shoppingDraft.id);
          const candidate = D.upsertShoppingItem(getData(), { ...shoppingDraft, id: shoppingDraft.id || newId('grocery'), checked: old ? old.checked : false });
          if (!commitData(candidate)) return true;
          resetShopping();
          refresh('#shopping-name');
          notify(editing ? 'Your grocery item was updated.' : 'Your item was added to the grocery list.');
        } else {
          noteDraft.title = formValue(form, 'idea-title', noteDraft.title);
          noteDraft.body = formValue(form, 'idea-body', noteDraft.body);
          const candidate = D.upsertIdeaNote(getData(), { ...noteDraft, id: noteDraft.id || newId('idea') });
          if (!commitData(candidate)) return true;
          resetNote();
          refresh('#idea-title');
          notify('Your note was saved on this device.');
        }
      } catch (error) { reportError(error); }
      return true;
    }
    function handleChange(event) {
      const field = event.target;
      if (field && field.dataset && field.dataset.skillsCheck) {
        const state = skillsState();
        state.completed[field.dataset.skillsCheck] = Boolean(field.checked);
        saveSkillsState(state);
        refresh();
        return true;
      }
      if (field && field.dataset && field.dataset.scienceTopic != null) {
        const state = skillsState();
        state.scienceQuiz['topic-' + field.dataset.scienceTopic] = Boolean(field.checked);
        saveSkillsState(state);
        return true;
      }
      if (field && field.dataset && field.dataset.scienceQuiz) {
        const state = skillsState();
        state.scienceQuiz[field.dataset.scienceQuiz] = field.value;
        saveSkillsState(state);
        return true;
      }
      const id = field && field.dataset && field.dataset.shoppingToggle;
      if (!id) return false;
      const item = (getData().shoppingList || []).find(entry => entry.id === id);
      if (!item) return true;
      if (!canEdit()) { field.checked = item.checked; return true; }
      try {
        const candidate = D.upsertShoppingItem(getData(), { id, checked: Boolean(field.checked) });
        if (!commitData(candidate)) { field.checked = item.checked; return true; }
        refresh('#shopping-check-' + id);
        notify(field.checked ? item.name + ' marked picked up.' : item.name + ' moved back to things to buy.');
      } catch (error) { field.checked = item.checked; reportError(error); }
      return true;
    }
    function handleClick(event) {
      const button = event.target && event.target.closest && event.target.closest('[data-page-action]');
      if (!button) return false;
      const action = button.dataset.pageAction;
      if (action === 'skills-view') {
        skillsView = button.dataset.skillsView === 'science' ? 'science' : 'me';
        refresh();
        return true;
      }
      if (action === 'skills-next') {
        const state = skillsState();
        const ranked = DEFAULT_SKILLS.map(skill => ({ skill, minutes: Number(state.studied[skill[0]] || 0) }))
          .sort((a, b) => a.minutes - b.minutes);
        const pick = ranked[0];
        const answer = root.document && root.document.getElementById('skills-next-answer');
        if (answer && pick) answer.textContent = pick.skill[2] + ' would be a good next choice. You have logged ' + pick.minutes + ' minutes there this week.';
        return true;
      }
      if (action === 'science-grade') {
        const state = skillsState();
        const correct = { q1: 'a', q2: 'b', q3: 'a' };
        const score = Object.keys(correct).reduce((sum, key) => sum + (state.scienceQuiz[key] === correct[key] ? 1 : 0), 0);
        const result = root.document && root.document.getElementById('science-grade-result');
        if (result) result.textContent = 'Score: ' + score + ' / 3. ' + (score === 3 ? 'Excellent — all three are correct.' : 'Review the lesson sections above, then try again.');
        return true;
      }
      if (action === 'navigate') { navigate(button.dataset.pageTarget); return true; }
      if (action === 'open-day') { openDate(button.dataset.date); return true; }
      if (action === 'keep-note') {
        pendingNoteDelete = '';
        refresh();
        return true;
      }
      if (!['cancel-shopping', 'edit-shopping', 'remove-shopping', 'cancel-note', 'edit-note', 'remove-note', 'confirm-remove-note'].includes(action)) return false;
      if (!canEdit()) return true;
      try {
        if (action === 'cancel-shopping') {
          resetShopping();
          refresh('#shopping-name');
        } else if (action === 'edit-shopping') {
          const item = (getData().shoppingList || []).find(entry => entry.id === button.dataset.itemId);
          if (!item) return true;
          if (shoppingDirty()) {
            notify('Save or clear the item you are editing before opening another item.', true);
            return true;
          }
          shoppingDraft = { id: item.id, name: item.name, quantity: item.quantity };
          shoppingBaseline = { ...shoppingDraft };
          refresh('#shopping-name');
        } else if (action === 'remove-shopping') {
          const id = button.dataset.itemId;
          if (shoppingDraft.id === id && shoppingDirty()) {
            notify('Save or discard your item changes before removing it.', true);
            return true;
          }
          const item = (getData().shoppingList || []).find(entry => entry.id === id);
          if (!item) return true;
          if (!commitData(D.removeShoppingItem(getData(), id))) return true;
          if (shoppingDraft.id === id) resetShopping();
          refresh('#shopping-name');
          notify(item.name + ' was removed from your grocery list.');
        } else if (action === 'cancel-note') {
          resetNote();
          refresh('#idea-title');
        } else if (action === 'edit-note') {
          const note = (getData().ideaNotes || []).find(entry => entry.id === button.dataset.noteId);
          if (!note) return true;
          if (noteDirty()) {
            notify('Save or discard the note you are editing before opening another note.', true);
            return true;
          }
          noteDraft = { id: note.id, title: note.title, body: note.body };
          noteBaseline = { ...noteDraft };
          pendingNoteDelete = '';
          refresh('#idea-title');
        } else if (action === 'remove-note') {
          if (noteDraft.id === button.dataset.noteId && noteDirty()) {
            notify('Save or discard your note changes before deleting it.', true);
            return true;
          }
          pendingNoteDelete = button.dataset.noteId;
          refresh('[data-page-action="confirm-remove-note"][data-note-id="' + pendingNoteDelete + '"]');
        } else if (action === 'confirm-remove-note') {
          const id = button.dataset.noteId;
          if (pendingNoteDelete !== id) return true;
          if (!commitData(D.removeIdeaNote(getData(), id))) return true;
          if (noteDraft.id === id) resetNote();
          pendingNoteDelete = '';
          refresh('#idea-title');
          notify('The note was deleted.');
        }
      } catch (error) { reportError(error); }
      return true;
    }

    return { render, handleClick, handleSubmit, handleChange, handleInput, hasUnsavedDraft, discardDraft };
  }

  const api = { createController };
  root.BloomPages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
