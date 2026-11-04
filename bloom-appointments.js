/* Appointment planning for Life in Bloom. Plans never create activity or mood logs. */
(function (root) {
  'use strict';

  const DAYS = [
    { value: 1, short: 'Mon', name: 'Monday' },
    { value: 2, short: 'Tue', name: 'Tuesday' },
    { value: 3, short: 'Wed', name: 'Wednesday' },
    { value: 4, short: 'Thu', name: 'Thursday' },
    { value: 5, short: 'Fri', name: 'Friday' },
    { value: 6, short: 'Sat', name: 'Saturday' },
    { value: 0, short: 'Sun', name: 'Sunday' }
  ];
  const COLORS = [
    { label: 'Pink', color: '#f4cbd8' },
    { label: 'Peach', color: '#f1cfac' },
    { label: 'Sage', color: '#c7dec8' },
    { label: 'Blue', color: '#bcd8ec' },
    { label: 'Lavender', color: '#d9c8ed' },
    { label: 'Cream', color: '#ead8b7' }
  ];
  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function safeColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : COLORS[0].color;
  }
  function newId() {
    return `appointment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function createController(options) {
    const D = root.BloomData;
    const doc = root.document || document;
    const { getData, commitData, canEdit, refresh, getWeekStart } = options;
    const notify = options.notify || (() => {});
    const dialog = doc.createElement('dialog');
    dialog.id = 'appointment-dialog';
    dialog.className = 'bloom-dialog appointment-dialog';
    dialog.setAttribute('aria-labelledby', 'appointment-dialog-title');
    doc.body.appendChild(dialog);
    const field = id => dialog.querySelector('#' + id);
    let editor = null;

    function calendarToday() {
      const now = new Date();
      return D.dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    }
    function dateLabel(key, short = false) {
      return D.parseDate(key).toLocaleDateString('en-US', {
        weekday: short ? 'short' : 'long', month: short ? 'short' : 'long', day: 'numeric', year: 'numeric'
      });
    }
    function actualDateKey(date) { return D.dateKey(date.getFullYear(), date.getMonth(), date.getDate()); }
    function actualTimeLabel(date) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    function occurrenceTime(occurrence, includeDate = false) {
      const firstDate = actualDateKey(occurrence.start);
      const lastDate = actualDateKey(occurrence.end);
      const prefix = includeDate ? dateLabel(firstDate, true) + ', ' : '';
      const endingDate = lastDate !== firstDate ? dateLabel(lastDate, true) + ', ' : '';
      return `${prefix}${actualTimeLabel(occurrence.start)}–${endingDate}${actualTimeLabel(occurrence.end)}`;
    }
    function repeatLabel(appointment) {
      const rule = appointment.recurrence;
      if (!rule || rule.frequency === 'none') return 'One-time appointment';
      const interval = rule.interval;
      let label;
      if (rule.frequency === 'daily') label = interval === 1 ? 'Every day' : `Every ${interval} days`;
      else if (rule.frequency === 'weekly') {
        label = interval === 1 ? 'Every week' : `Every ${interval} weeks`;
        label += ' · ' + DAYS.filter(day => rule.weekdays.includes(day.value)).map(day => day.short).join(', ');
      } else label = `${interval === 1 ? 'Every month' : `Every ${interval} months`} · day ${D.parseDate(appointment.startDate).getDate()}`;
      if (rule.until) label += ' · through ' + dateLabel(rule.until, true);
      return label;
    }
    function weekBounds(weekKey) {
      const from = D.parseDate(weekKey);
      from.setHours(8, 0, 0, 0);
      const to = D.parseDate(D.shiftDate(weekKey, 7));
      to.setHours(8, 0, 0, 0);
      return { from, to };
    }
    function dayBounds(dayKey) {
      const from = D.parseDate(dayKey);
      from.setHours(8, 0, 0, 0);
      const to = D.parseDate(D.shiftDate(dayKey, 1));
      to.setHours(8, 0, 0, 0);
      return { from, to };
    }
    function trackingPosition(occurrence, from) {
      const visibleStart = occurrence.start < from ? from : occurrence.start;
      let key = actualDateKey(visibleStart);
      if (visibleStart.getHours() < 8) key = D.shiftDate(key, -1);
      return { key, hour: (visibleStart.getHours() + 16) % 24 };
    }
    function defaultDate(weekKey) {
      const current = calendarToday();
      const end = D.shiftDate(weekKey, 6);
      if (current >= weekKey && current <= end) return current;
      if (current === D.shiftDate(weekKey, 7) && new Date().getHours() < 8) return current;
      return weekKey;
    }
    function defaultAppointment(date) {
      return {
        id: newId(), title: '', startDate: date, startTime: '09:00', endTime: '10:00', endNextDay: false,
        color: COLORS[0].color, notes: '',
        recurrence: { frequency: 'none', interval: 1, weekdays: [], until: '' }, excludedDates: []
      };
    }
    function occurrenceDraft(original, date) {
      return { ...clone(original), startDate: date, recurrence: { frequency: 'none', interval: 1, weekdays: [], until: '' }, excludedDates: [] };
    }
    function findOccurrence(appointment, date) {
      const from = D.parseDate(date);
      if (Number.isNaN(from.getTime())) return null;
      const to = D.parseDate(D.shiftDate(date, 1));
      if (Number.isNaN(to.getTime())) return null;
      return D.appointmentsInWindow([appointment], from, to).find(item => item.occurrenceDate === date) || null;
    }

    function agendaEntries(occurrences, from, scope) {
      let html = '';
      html += `<ul class='appointment-agenda'>`;
      for (const occurrence of occurrences) {
        const position = trackingPosition(occurrence, from);
        const label = `Edit planned appointment: ${occurrence.title}. ${occurrenceTime(occurrence, true)}. ${repeatLabel(occurrence)}.`;
        html += `<li><button type='button' class='appointment-agenda-item' data-appointment-action='edit' data-appointment-id='${escapeText(occurrence.appointmentId)}' data-appointment-date='${occurrence.occurrenceDate}' style='--appointment-color:${safeColor(occurrence.color)}' aria-label='${escapeText(label)}'><span class='appointment-planned-label'>Planned</span><span class='appointment-agenda-date'>${dateLabel(occurrence.occurrenceDate, true)}</span><span class='appointment-agenda-title'>${escapeText(occurrence.title)}</span><span class='appointment-agenda-time'>${escapeText(occurrenceTime(occurrence))}</span><span class='appointment-repeat-label'>${escapeText(repeatLabel(occurrence))}</span>${occurrence.start < from ? `<span class='appointment-time-note'>Continues into this ${scope}</span>` : ''}${occurrence.timeAdjusted ? `<span class='appointment-time-note'>Clock change: check this time.</span>` : ''}</button><div class='appointment-agenda-actions'>${scope === 'week' ? `<button type='button' class='mini-btn' data-show-planned-date='${position.key}' data-show-planned-hour='${position.hour}'>Show in grid</button><button type='button' class='mini-btn' data-open-date='${position.key}'>Open day</button>` : `<button type='button' class='mini-btn' data-show-planned-date='${position.key}' data-show-planned-hour='${position.hour}'>Show in weekly grid</button>`}</div></li>`;
      }
      return html + '</ul>';
    }

    function renderAgenda(weekKey) {
      const { from, to } = weekBounds(weekKey);
      const occurrences = D.appointmentsInWindow(getData().appointments || [], from, to);
      let html = `<section class='panel appointment-panel'><div class='panel-title-row'><h2>Appointments this week</h2><button type='button' class='button primary' data-appointment-action='new' data-appointment-date='${defaultDate(weekKey)}'>+ Add appointment</button></div><p class='caption'>Your appointments also appear as colored Planned blocks inside the weekly grid and on the daily log. Tap an appointment to edit it.</p>`;
      if (!occurrences.length) return html + `<p class='appointment-empty'>No appointments planned for this week. Add a one-time or repeating appointment, or use the week arrows to plan ahead.</p></section>`;
      return html + agendaEntries(occurrences, from, 'week') + '</section>';
    }

    function renderDayAgenda(dayKey, occurrences) {
      const { from, to } = dayBounds(dayKey);
      const planned = occurrences || D.appointmentsInWindow(getData().appointments || [], from, to);
      let html = `<section class='panel appointment-panel day-appointments'><div class='panel-title-row'><h2>Appointments for this daily log</h2><button type='button' class='button primary' data-appointment-action='new' data-appointment-date='${dayKey}'>+ Add appointment</button></div><p class='caption'>${dateLabel(dayKey, true)}, 8 AM → ${dateLabel(D.shiftDate(dayKey, 1), true)}, 8 AM. These are the same appointments shown in your weekly grid. Plans do not fill in your sleep, activities, or feelings.</p>`;
      if (!planned.length) return html + `<p class='appointment-empty'>No appointments planned for this 8 AM–8 AM day.</p></section>`;
      return html + agendaEntries(planned, from, 'day') + '</section>';
    }

    function renderPlanButtons(matches, className) {
      return matches.map(item => `<button type='button' class='${className}' data-appointment-action='edit' data-appointment-id='${escapeText(item.appointmentId)}' data-appointment-date='${item.occurrenceDate}' style='--appointment-color:${safeColor(item.color)}' aria-label='${escapeText('Edit planned appointment: ' + item.title + '. ' + occurrenceTime(item, true))}'><span class='appointment-planned-label'>Planned</span><span class='appointment-grid-title'>${escapeText(item.title)}</span><span class='appointment-grid-time'>${escapeText(occurrenceTime(item))}</span>${item.timeAdjusted ? `<span class='appointment-time-note'>Check clock-change time</span>` : ''}</button>`).join('');
    }

    function renderHour(occurrences, dayKey, hour) {
      const from = D.hourDateTime(dayKey, hour);
      const to = D.parseDate(dayKey);
      to.setHours(8 + hour + 1, 0, 0, 0);
      if (to <= from) return '';
      const matches = occurrences.filter(item => item.start < to && item.end > from);
      if (!matches.length) return '';
      return `<div class='week-appointments'>${renderPlanButtons(matches, 'appointment-grid-item')}</div>`;
    }

    function renderDayRange(occurrences, dayKey, firstSlot, lastSlot) {
      const from = D.parseDate(dayKey);
      from.setHours(8, firstSlot * 30, 0, 0);
      const to = D.parseDate(dayKey);
      to.setHours(8, lastSlot * 30, 0, 0);
      if (to <= from) return '';
      const matches = occurrences.filter(item => item.start < to && item.end > from);
      if (!matches.length) return '';
      return `<div class='time-group-plans' aria-label='Planned appointments during these hours'>${renderPlanButtons(matches, 'appointment-day-item')}</div>`;
    }

    function isRepeatingEdit() {
      return Boolean(editor?.original && editor.original.recurrence.frequency !== 'none');
    }
    function singleOccurrenceEdit() { return isRepeatingEdit() && editor.scope === 'occurrence'; }
    function colorChoices(color) {
      const choices = COLORS.map(choice => ({ ...choice }));
      if (!choices.some(choice => choice.color.toLowerCase() === color.toLowerCase())) choices.push({ label: 'Saved color', color: safeColor(color) });
      return choices;
    }
    function readDraft() {
      const previous = editor.drafts[editor.scope];
      const frequency = singleOccurrenceEdit() ? 'none' : field('appointment-frequency').value;
      return {
        id: previous.id,
        title: field('appointment-title').value.trim(),
        startDate: field('appointment-date').value,
        startTime: field('appointment-start').value,
        endTime: field('appointment-end').value,
        endNextDay: field('appointment-next-day').checked,
        color: dialog.querySelector('input[name="appointment-color"]:checked')?.value || previous.color,
        notes: field('appointment-notes').value,
        recurrence: {
          frequency,
          interval: frequency === 'none' ? 1 : Number(field('appointment-interval').value),
          weekdays: frequency === 'weekly' ? [...dialog.querySelectorAll('input[name="appointment-weekday"]:checked')].map(input => Number(input.value)) : [],
          until: frequency === 'none' ? '' : field('appointment-until').value
        },
        excludedDates: frequency === 'none' ? [] : [...(previous.excludedDates || [])]
      };
    }
    function updateRepeatFields() {
      if (!editor) return;
      const single = singleOccurrenceEdit();
      const frequency = field('appointment-frequency').value;
      const repeating = frequency !== 'none' && !single;
      field('appointment-repeat-fields').hidden = single;
      field('appointment-repeat-fields').disabled = single || editor.readOnly;
      field('appointment-repeat-details').hidden = !repeating;
      field('appointment-interval').disabled = !repeating;
      field('appointment-until').disabled = !repeating;
      field('appointment-weekdays').hidden = frequency !== 'weekly';
      field('appointment-weekdays').disabled = frequency !== 'weekly';
      const unit = frequency === 'weekly' ? 'week' : frequency === 'monthly' ? 'month' : 'day';
      field('appointment-interval-unit').textContent = Number(field('appointment-interval').value) === 1 ? unit : unit + 's';
      field('appointment-until').min = field('appointment-date').value;
      const date = D.parseDate(field('appointment-date').value);
      const hint = field('appointment-repeat-hint');
      if (frequency === 'monthly') hint.textContent = Number.isNaN(date.getTime()) ? 'Monthly repeats use the numbered date you choose. Months without that date are skipped.' : `Repeats on day ${date.getDate()} of the month. Months without that date are skipped.`;
      else if (frequency === 'weekly') hint.textContent = 'Choose the days you want. Repeats start on or after the appointment date.';
      else hint.textContent = 'Leave the end date empty to keep this appointment repeating.';
      field('appointment-end-date-hint').textContent = field('appointment-next-day').checked && !Number.isNaN(date.getTime()) ? 'Ends on ' + dateLabel(D.shiftDate(field('appointment-date').value, 1), true) + '.' : 'Start and end times use the appointment date.';
    }

    function renderEditor(focusSelector) {
      const draft = editor.drafts[editor.scope];
      const repeating = isRepeatingEdit();
      const single = singleOccurrenceEdit();
      const disabled = editor.readOnly ? 'disabled' : '';
      const selectedDays = draft.recurrence.frequency === 'weekly' ? draft.recurrence.weekdays : [D.parseDate(draft.startDate).getDay()];
      const heading = !editor.original ? 'Add an appointment' : single ? 'Edit this appointment' : repeating ? 'Edit repeating appointment' : 'Edit appointment';
      let html = `<div class='dialog-inner'><div class='dialog-top'><h2 id='appointment-dialog-title'>${heading}</h2><button type='button' class='icon-button' data-appointment-close aria-label='Close appointment'>×</button></div><p class='dialog-subtitle'>Plan a date and time. Logging what you actually did is a separate step.</p>${editor.timeAdjusted ? `<p class='appointment-time-note'>Clock change: check this time. The scheduled time falls in a clock change; the agenda shows the adjusted local time.</p>` : ''}<form id='appointment-form'>`;
      if (repeating) {
        html += `<fieldset class='appointment-scope' ${disabled}><legend>What would you like to change?</legend><div class='appointment-scope-options'><label><input type='radio' id='appointment-scope-occurrence' name='appointment-scope' value='occurrence' ${single ? 'checked' : ''}> Only this occurrence</label><label><input type='radio' id='appointment-scope-series' name='appointment-scope' value='series' ${single ? '' : 'checked'}> Entire series</label></div><p class='appointment-scope-hint'>${single ? 'Change the appointment originally planned for ' + dateLabel(editor.occurrenceDate, true) + '. This will be saved as a one-time appointment.' : 'Changes apply to every occurrence in this repeating appointment, including earlier planned dates.'}</p></fieldset>`;
      }
      html += `<fieldset class='appointment-edit-fields' id='appointment-edit-fields' ${disabled}><legend class='sr-only'>Appointment details</legend><div class='appointment-form-grid'><div class='form-field appointment-title-field'><label for='appointment-title'>Appointment</label><input type='text' id='appointment-title' maxlength='120' autocomplete='off' placeholder='For example, Piano lesson' value='${escapeText(draft.title)}' required></div><div class='form-field'><label for='appointment-date'>${repeating && !single ? 'First date in the series' : 'Date'}</label><input type='date' id='appointment-date' value='${draft.startDate}' required></div><div class='form-field'><label for='appointment-start'>Starts</label><input type='time' id='appointment-start' step='60' value='${draft.startTime}' required></div><div class='form-field'><label for='appointment-end'>Ends</label><input type='time' id='appointment-end' step='60' value='${draft.endTime}' required></div></div><label class='appointment-next-day'><input type='checkbox' id='appointment-next-day' ${draft.endNextDay ? 'checked' : ''}> Ends the next day</label><p class='appointment-form-hint' id='appointment-end-date-hint'></p>`;
      html += `<fieldset class='appointment-repeat-fields' id='appointment-repeat-fields'><legend>Repeat</legend><div class='form-field'><label for='appointment-frequency'>How often?</label><select id='appointment-frequency'>${[['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([value, label]) => `<option value='${value}' ${draft.recurrence.frequency === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div id='appointment-repeat-details'><div class='form-field appointment-interval-field'><label for='appointment-interval'>Repeat every</label><div class='appointment-interval-control'><input type='number' id='appointment-interval' min='1' max='52' step='1' value='${draft.recurrence.interval}' required><span id='appointment-interval-unit'>day</span></div></div><fieldset class='appointment-weekdays' id='appointment-weekdays'><legend>Days of the week</legend>${DAYS.map(day => `<label><input type='checkbox' name='appointment-weekday' value='${day.value}' ${selectedDays.includes(day.value) ? 'checked' : ''}><span>${day.short}</span></label>`).join('')}</fieldset><div class='form-field appointment-repeat-until'><label for='appointment-until'>Last date (optional)</label><input type='date' id='appointment-until' value='${draft.recurrence.until}'></div><p class='appointment-repeat-hint' id='appointment-repeat-hint'></p></div></fieldset>`;
      html += `<fieldset class='appointment-color-fieldset'><legend>Appointment color</legend><div class='appointment-color-options'>${colorChoices(draft.color).map(option => `<label class='color-option'><input type='radio' name='appointment-color' value='${option.color}' ${option.color.toLowerCase() === draft.color.toLowerCase() ? 'checked' : ''}><span class='color-dot' style='--activity-color:${option.color}' aria-hidden='true'></span><span>${option.label}</span></label>`).join('')}</div></fieldset><div class='form-field appointment-notes'><label for='appointment-notes'>Notes (optional)</label><textarea id='appointment-notes' maxlength='2000' placeholder='Anything you want to remember'>${escapeText(draft.notes)}</textarea></div></fieldset><p class='dialog-error' id='appointment-error' role='alert' hidden></p><div class='dialog-actions'>${editor.original ? `<button type='button' class='button' data-appointment-delete ${disabled}>${single ? 'Delete this occurrence' : repeating ? 'Delete series' : 'Delete appointment'}</button>` : ''}<button type='button' class='button' data-appointment-close>Cancel</button><button type='submit' class='button primary' ${disabled}>${single ? 'Save this occurrence' : repeating ? 'Save series' : 'Save appointment'}</button></div></form></div>`;
      dialog.innerHTML = html;
      updateRepeatFields();
      if (!dialog.open) dialog.showModal();
      if (focusSelector) requestAnimationFrame(() => dialog.querySelector(focusSelector)?.focus({ preventScroll: true }));
    }

    function openNew(date) {
      if (!canEdit()) return;
      const selectedDate = typeof date === 'string' && !Number.isNaN(D.parseDate(date).getTime()) ? date : defaultDate(getWeekStart());
      editor = { original: null, occurrenceDate: '', scope: 'series', readOnly: false, timeAdjusted: false, drafts: { series: defaultAppointment(selectedDate) } };
      renderEditor('#appointment-title');
    }
    function openEdit(id, date) {
      const raw = (getData().appointments || []).find(appointment => appointment.id === id);
      if (!raw) { notify('That appointment is no longer in your plan.'); refresh(); return; }
      const original = D.normalizeAppointment(raw);
      const repeating = original.recurrence.frequency !== 'none';
      const occurrenceDate = repeating ? date : original.startDate;
      const occurrence = findOccurrence(original, occurrenceDate);
      if (!occurrence) { notify('That occurrence has changed. Please choose an appointment from the updated week.'); refresh(); return; }
      const scope = repeating ? 'occurrence' : 'series';
      editor = {
        original, occurrenceDate, scope, readOnly: !canEdit(), timeAdjusted: Boolean(occurrence.timeAdjusted),
        drafts: { series: clone(original), occurrence: occurrenceDraft(original, occurrenceDate) }
      };
      renderEditor('#appointment-title');
    }
    function showError(message) {
      field('appointment-error').textContent = message;
      field('appointment-error').hidden = false;
      field('appointment-error').scrollIntoView?.({ block: 'nearest' });
    }
    function complete(message, focusId, focusDate, savedOccurrence) {
      dialog.close();
      editor = null;
      if (savedOccurrence) options.onSaved?.(savedOccurrence);
      refresh();
      notify(message);
      requestAnimationFrame(() => {
        const selector = focusId && focusDate ? `[data-appointment-action='edit'][data-appointment-id='${focusId}'][data-appointment-date='${focusDate}']` : '';
        const target = (selector ? doc.querySelector(selector) : null) || doc.querySelector('[data-appointment-action="new"]');
        target?.focus({ preventScroll: true });
      });
    }

    dialog.addEventListener('change', event => {
      if (!editor) return;
      if (event.target.name === 'appointment-scope' && ['occurrence', 'series'].includes(event.target.value)) {
        editor.drafts[editor.scope] = readDraft();
        editor.scope = event.target.value;
        renderEditor('#appointment-scope-' + editor.scope);
        return;
      }
      if (event.target.id === 'appointment-frequency' && event.target.value === 'weekly') {
        const checked = [...dialog.querySelectorAll('input[name="appointment-weekday"]:checked')];
        const date = D.parseDate(field('appointment-date').value);
        if ((!checked.length || !editor.original || editor.original.recurrence.frequency === 'none') && !Number.isNaN(date.getTime())) {
          for (const checkbox of dialog.querySelectorAll('input[name="appointment-weekday"]')) checkbox.checked = Number(checkbox.value) === date.getDay();
        }
      }
      if (['appointment-frequency', 'appointment-interval', 'appointment-date', 'appointment-next-day'].includes(event.target.id)) updateRepeatFields();
    });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-appointment-close]')) { dialog.close(); return; }
      if (!event.target.closest('[data-appointment-delete]') || !editor?.original || !canEdit()) return;
      const single = singleOccurrenceEdit();
      const question = single ? `Delete the occurrence of “${editor.original.title}” on ${dateLabel(editor.occurrenceDate, true)}?` : isRepeatingEdit() ? `Delete the entire repeating appointment “${editor.original.title}”?` : `Delete “${editor.original.title}” on ${dateLabel(editor.original.startDate, true)}?`;
      if (!root.confirm(question)) return;
      try {
        const candidate = D.removeAppointment(getData(), editor.original.id, editor.occurrenceDate, single ? 'occurrence' : 'series');
        if (!commitData(candidate)) { showError('The deletion could not be saved. The appointment is still in your plan.'); return; }
        complete(single ? 'This occurrence was removed from your plan.' : 'The appointment was removed from your plan.');
      } catch (error) { showError(error.message || 'The appointment could not be removed.'); }
    });
    dialog.addEventListener('submit', event => {
      if (event.target.id !== 'appointment-form') return;
      event.preventDefault();
      if (!editor || !canEdit()) return;
      try {
        const single = singleOccurrenceEdit();
        const raw = readDraft();
        if (single) raw.id = newId();
        const appointment = D.normalizeAppointment(raw);
        if (appointment.recurrence.frequency === 'weekly' && appointment.recurrence.until) {
          const offsets = appointment.recurrence.weekdays.map(day => (day + 6) % 7).sort((a, b) => a - b);
          const firstWeek = D.weekStart(appointment.startDate);
          const firstDate = offsets.map(offset => D.shiftDate(firstWeek, offset)).find(date => date >= appointment.startDate)
            || D.shiftDate(firstWeek, appointment.recurrence.interval * 7 + offsets[0]);
          if (firstDate > appointment.recurrence.until) throw new Error('The last date is before the first selected weekday can occur. Choose a later last date or another repeat day.');
        }
        const preferredDate = !single && editor.original && appointment.recurrence.frequency !== 'none' ? editor.occurrenceDate : appointment.startDate;
        let savedOccurrence = findOccurrence(appointment, preferredDate);
        if (!savedOccurrence) {
          const from = D.parseDate(appointment.startDate);
          const to = D.parseDate(D.shiftDate(appointment.startDate, 370));
          // A selected weekly weekday can occur after the series' first date.
          if (!Number.isNaN(to.getTime())) savedOccurrence = D.appointmentsInWindow([appointment], from, to)[0];
        }
        const candidate = single ? D.updateAppointmentOccurrence(getData(), editor.original.id, editor.occurrenceDate, appointment) : D.upsertAppointment(getData(), appointment);
        if (!commitData(candidate)) { showError('This device could not save the appointment. Your draft is still open.'); return; }
        const message = !savedOccurrence ? 'Your appointment settings were saved.' : single ? 'This occurrence was saved as a one-time appointment.' : appointment.recurrence.frequency === 'none' ? 'Your appointment was saved in the weekly grid and daily log.' : 'Your repeating appointment was saved in the weekly grid and daily log.';
        complete(message, appointment.id, savedOccurrence?.occurrenceDate || appointment.startDate, savedOccurrence);
      } catch (error) { showError(error.message || 'Please check the appointment details.'); }
    });
    dialog.addEventListener('close', () => {
      if (!dialog.open) editor = null;
    });

    function handleClick(event) {
      const button = event.target.closest('[data-appointment-action]');
      if (!button) return false;
      const action = button.dataset.appointmentAction;
      if (action === 'new') { openNew(button.dataset.appointmentDate); return true; }
      if (action === 'edit') { openEdit(button.dataset.appointmentId, button.dataset.appointmentDate); return true; }
      return false;
    }
    return { renderAgenda, renderDayAgenda, renderDayRange, renderHour, handleClick };
  }

  root.BloomAppointments = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
