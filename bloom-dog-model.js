/* Calendar-based care routines. A due task is a plan, never a completed action. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const ZONE = 'America/New_York';
  const clone = value => JSON.parse(JSON.stringify(value));

  function dayKey(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
  }
  function dateNumber(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2200) return null;
    const result = Date.UTC(year, month - 1, day);
    const check = new Date(result);
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? result / DAY : null;
  }
  function dateFromNumber(value) {
    if (!Number.isInteger(value)) return null;
    const result = new Date(value * DAY).toISOString().slice(0, 10);
    return dateNumber(result) == null ? null : result;
  }
  function addDays(value, days) {
    const start = dateNumber(value);
    return start == null || !Number.isInteger(days) ? null : dateFromNumber(start + days);
  }
  function addMonths(value, months) {
    if (dateNumber(value) == null || !Number.isInteger(months)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + months, 1));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    const result = date.toISOString().slice(0, 10);
    return dateNumber(result) == null ? null : result;
  }
  function dateLabel(value, short) {
    const numeric = dateNumber(value);
    if (numeric == null) return 'Date not set';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: short ? 'short' : 'long', day: 'numeric', year: 'numeric' }).format(new Date(numeric * DAY + 12 * 3600000));
  }
  function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function timeLabel(value) {
    if (!validTime(value)) return 'Any time';
    const [hour, minute] = value.split(':').map(Number);
    return (hour % 12 || 12) + ':' + String(minute).padStart(2, '0') + (hour < 12 ? ' AM' : ' PM');
  }
  function ageLabel(bornOn, asOf) {
    const birth = dateNumber(bornOn), today = dateNumber(asOf);
    if (birth == null || today == null) return 'Add date of birth';
    if (birth > today) return 'Check date of birth';
    const [by, bm, bd] = bornOn.split('-').map(Number), [ty, tm, td] = asOf.split('-').map(Number);
    const months = (ty - by) * 12 + tm - bm - (td < bd ? 1 : 0);
    if (months < 1) return (today - birth) + ' day' + (today - birth === 1 ? '' : 's') + ' old';
    const years = Math.floor(months / 12), rest = months % 12;
    return [years ? years + ' year' + (years === 1 ? '' : 's') : '', rest ? rest + ' month' + (rest === 1 ? '' : 's') : ''].filter(Boolean).join(', ') + ' old';
  }
  function money(cents) { return cents == null || !Number.isFinite(Number(cents)) ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100); }
  function format(value) { return value == null || !Number.isFinite(Number(value)) ? 'Not recorded' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value)); }

  const CATEGORIES = [
    ['feeding', 'Feeding', '🥣'], ['movement', 'Walk & movement', '🐾'], ['dental', 'Teeth', '🪥'],
    ['grooming', 'Grooming', '🧴'], ['medication', 'Medication', '💊'], ['vet', 'Veterinary care', '🩺'],
    ['training', 'Training', '⭐'], ['other', 'Other care', '🌿']
  ];
  const TEMPLATES = [
    { key: 'morning-meal', name: 'Morning meal', category: 'feeding', frequency: 'daily', times: ['07:30'], notes: 'Record the food and measured portion you use for your dog.' },
    { key: 'evening-meal', name: 'Evening meal', category: 'feeding', frequency: 'daily', times: ['18:00'], notes: 'Record the food and measured portion you use for your dog.' },
    { key: 'movement', name: 'Walk & movement', category: 'movement', frequency: 'daily', times: ['14:00'], notes: 'Use the activity and duration that suit your dog’s care plan.' },
    { key: 'teeth', name: 'Teeth brushing', category: 'dental', frequency: 'daily', times: ['20:30'], notes: '' },
    { key: 'coat', name: 'Coat brush-through', category: 'grooming', frequency: 'interval', interval_days: 2, rolling: true, times: [], notes: 'Check the coat and note any areas needing attention.' },
    { key: 'nails', name: 'Nail trim', category: 'grooming', frequency: 'interval', interval_days: 14, rolling: true, times: [], notes: '' },
    { key: 'paws', name: 'Paw hair trim', category: 'grooming', frequency: 'interval', interval_days: 14, rolling: true, times: [], notes: '' },
    { key: 'sanitary', name: 'Sanitary trim', category: 'grooming', frequency: 'monthly', interval_months: 1, times: [], notes: '' },
    { key: 'ears', name: 'Ear care & inspection', category: 'grooming', frequency: 'monthly', interval_months: 1, times: [], notes: 'Follow your dog’s care instructions and record what you notice.' },
    { key: 'vet', name: 'Veterinary appointment', category: 'vet', frequency: 'once', times: [], notes: 'Add the appointment date, time and any questions to discuss.' },
    { key: 'medicine', name: '', category: 'medication', frequency: 'daily', times: [], dose_text: '', notes: 'Enter the medication and directions from the label or your veterinarian.' }
  ];
  function usable(rows) { return (Array.isArray(rows) ? rows : []).filter(row => row && row.archived !== true); }
  function slots(task) {
    const values = Array.isArray(task && task.times) ? [...new Set(task.times.filter(validTime))].sort() : [];
    return values.length ? values : [''];
  }
  function categoryInfo(value) { const entry = CATEGORIES.find(row => row[0] === value) || CATEGORIES.at(-1); return { value: entry[0], label: entry[1], icon: entry[2] }; }
  function taskLogs(task, logs, through) {
    return usable(logs).filter(log => log.task_id === task.id && dateNumber(log.occurred_on) != null && (!through || log.occurred_on <= through));
  }
  function snapshotBody(log) {
    const value = log && log.task_snapshot;
    return value && (value.payload || value.data || value) || {};
  }
  function completionDays(task, logs, through) {
    const byDay = new Map();
    for (const log of taskLogs(task, logs, through)) {
      if (!byDay.has(log.occurred_on)) byDay.set(log.occurred_on, new Map());
      const map = byDay.get(log.occurred_on), slot = String(log.slot || '');
      const previous = map.get(slot);
      if (!previous || String(log.updated_at || log.created_at || log.id).localeCompare(String(previous.updated_at || previous.created_at || previous.id)) >= 0) map.set(slot, log);
    }
    return [...byDay.entries()].filter(([, rows]) => {
      const latest = [...rows.values()].sort((a, b) => String(b.updated_at || b.created_at || b.id).localeCompare(String(a.updated_at || a.created_at || a.id)))[0];
      const historical = snapshotBody(latest);
      const expected = slots(Array.isArray(historical.times) ? historical : task);
      return expected.every(slot => rows.has(slot) && rows.get(slot).done === true);
    }).map(([date]) => date).sort();
  }
  function nextAfter(task, completedOn) {
    if (!task || dateNumber(task.anchor_on) == null) return null;
    const anchor = task.anchor_on;
    if (!completedOn || dateNumber(completedOn) == null || completedOn < anchor) return anchor;
    if (task.frequency === 'once') return null;
    if (task.frequency === 'daily') return addDays(completedOn, 1);
    if (task.frequency === 'interval') {
      const interval = Number(task.interval_days);
      if (!Number.isInteger(interval) || interval < 1 || interval > 3650) return null;
      if (task.rolling === true) return addDays(completedOn, interval);
      const elapsed = dateNumber(completedOn) - dateNumber(anchor);
      return addDays(anchor, (Math.floor(elapsed / interval) + 1) * interval);
    }
    if (task.frequency === 'monthly') {
      const interval = Number(task.interval_months);
      if (!Number.isInteger(interval) || interval < 1 || interval > 120) return null;
      const [ay, am] = anchor.split('-').map(Number), [cy, cm] = completedOn.split('-').map(Number);
      let cycle = Math.max(0, Math.floor(((cy - ay) * 12 + cm - am) / interval));
      let value = addMonths(anchor, cycle * interval);
      if (value && value <= completedOn) value = addMonths(anchor, (++cycle) * interval);
      return value;
    }
    return null;
  }
  function taskOccurrences(task, logs, on) {
    if (!task || task.archived === true || task.active === false || dateNumber(on) == null || dateNumber(task.anchor_on) == null || on < task.anchor_on || task.end_on && (dateNumber(task.end_on) == null || on > task.end_on)) return [];
    const prior = completionDays(task, logs, addDays(on, -1));
    const due = task.frequency === 'daily' ? on : nextAfter(task, prior.at(-1));
    if (!due || due > on || task.end_on && due > task.end_on) return [];
    const currentLogs = taskLogs(task, logs, on).filter(log => log.occurred_on === on);
    return slots(task).map(slot => {
      const log = currentLogs.filter(value => String(value.slot || '') === slot).sort((a, b) => String(b.updated_at || b.created_at || b.id).localeCompare(String(a.updated_at || a.created_at || a.id)))[0] || null;
      return { key: task.id + ':' + on + ':' + slot, task, task_id: task.id, on, due_on: due, slot, log, done: Boolean(log && log.done === true), overdue: due < on };
    });
  }
  function dueTasks(tasks, logs, on, domain) {
    return usable(tasks).filter(task => !domain || task.domain === domain).flatMap(task => taskOccurrences(task, logs, on)).sort((a, b) => Number(a.done) - Number(b.done) || a.due_on.localeCompare(b.due_on) || (a.slot || '99:99').localeCompare(b.slot || '99:99') || String(a.task.name).localeCompare(String(b.task.name)));
  }
  function nextDue(task, logs, asOf) {
    if (!task || task.archived === true || task.active === false || dateNumber(asOf) == null || dateNumber(task.anchor_on) == null) return null;
    if (task.end_on && (dateNumber(task.end_on) == null || asOf > task.end_on)) return null;
    if (task.anchor_on > asOf) return task.end_on && task.anchor_on > task.end_on ? null : task.anchor_on;
    const today = taskOccurrences(task, logs, asOf);
    if (today.some(row => !row.done)) return today.find(row => !row.done).due_on;
    const completed = completionDays(task, logs, asOf);
    let result = nextAfter(task, completed.at(-1));
    if (task.frequency === 'daily') result = today.length && today.every(row => row.done) ? addDays(asOf, 1) : asOf;
    return result && (!task.end_on || result <= task.end_on) ? result : null;
  }
  function frequencyLabel(task) {
    if (task.frequency === 'daily') return 'Every day';
    if (task.frequency === 'once') return 'One time';
    if (task.frequency === 'monthly') return Number(task.interval_months) === 1 ? 'Monthly · calendar date' : 'Every ' + format(task.interval_months) + ' months';
    if (task.frequency === 'interval') return 'Every ' + format(task.interval_days) + ' days' + (task.rolling ? ' after completion' : ' · fixed schedule');
    return 'Schedule needs review';
  }
  function needsRefill(supply) {
    return Boolean(supply && supply.archived !== true && (supply.needs_refill === true || Number(supply.stock_quantity) <= Number(supply.refill_threshold || 0)));
  }
  function purchaseHistory(current, supplyId) {
    const receipts = new Map((current.receipts || []).map(row => [row.id, row]));
    return (current.dogStockEffects || []).filter(effect => !supplyId || effect.supply_id === supplyId).map(effect => {
      const receipt = receipts.get(effect.receipt_id);
      return { ...effect, receipt: receipt || null, purchased_on: effect.purchased_on || receipt && receipt.purchased_on || null, reversed: Boolean(effect.voided_at || receipt && receipt.voided_at) };
    }).sort((a, b) => String(b.purchased_on || '').localeCompare(String(a.purchased_on || '')) || String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)));
  }
  function expenses(current, month, supplyId) {
    const rows = purchaseHistory(current, supplyId).filter(row => !row.reversed && (!month || String(row.purchased_on || '').slice(0, 7) === String(month).slice(0, 7)));
    const known = rows.filter(row => Number.isSafeInteger(Number(row.amount_cents)) && row.amount_cents != null);
    return { cents: known.reduce((sum, row) => sum + Number(row.amount_cents), 0), count: rows.length, incomplete: known.length !== rows.length };
  }
  function latestWeight(current, asOf) {
    return usable(current.dogWeights).filter(row => dateNumber(row.occurred_on) != null && row.occurred_on <= asOf && Number(row.weight_kg) > 0).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)))[0] || null;
  }
  function summary(current, on) {
    const profile = usable(current.dogProfiles)[0] || {};
    const due = dueTasks(current.routineTasks, current.routineLogs, on, 'dog');
    return { dueCount: due.filter(row => !row.done).length, completedCount: due.filter(row => row.done).length, dogName: profile.name || 'Your dog', needsRefillCount: usable(current.dogSupplies).filter(needsRefill).length };
  }
  function calendarEscape(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function foldCalendar(line) {
    const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
    let output = '', length = 0;
    for (const character of line) {
      const size = encoder ? encoder.encode(character).length : unescape(encodeURIComponent(character)).length;
      if (length + size > 73) { output += '\r\n '; length = 1; }
      output += character; length += size;
    }
    return output;
  }
  function careInstant(on, time) {
    if (dateNumber(on) == null || !validTime(time)) return null;
    const [hour, minute] = time.split(':').map(Number);
    const base = dateNumber(on) * DAY + hour * 3600000 + minute * 60000;
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    // Test the two New York offsets instead of treating a calendar day as 24 hours.
    // On fall-back dates, choose the first occurrence of a repeated clock time.
    for (const offset of [4, 5]) {
      const result = new Date(base + offset * 3600000), parts = formatter.formatToParts(result);
      const part = type => parts.find(value => value.type === type).value;
      if ([part('year'), part('month'), part('day')].join('-') === on && part('hour') + ':' + part('minute') === time) return result;
    }
    return null;
  }
  function calendarForOccurrence(occurrence, now) {
    if (!occurrence || dateNumber(occurrence.on) == null) throw new Error('Choose a scheduled care date first.');
    const next = addDays(occurrence.on, 1);
    if (!next) throw new Error('Choose an earlier care date for this calendar reminder.');
    const title = String(occurrence.title || 'Dog care');
    const description = (validTime(occurrence.time) ? 'Planned time: ' + timeLabel(occurrence.time) + ' (New York).\n' : '') + String(occurrence.notes || '') + '\nMark this task complete in Life in Bloom after it is done. This calendar reminder does not record a care action.';
    const stamp = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    let dates = ['DTSTART;VALUE=DATE:' + occurrence.on.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + next.replace(/-/g, '')];
    if (validTime(occurrence.time)) {
      const instant = careInstant(occurrence.on, occurrence.time);
      if (!instant) throw new Error('That clock time does not occur on this New York daylight-saving date. Choose another time for the reminder.');
      dates = ['DTSTART:' + stamp(instant), 'DTEND:' + stamp(new Date(instant.getTime() + 15 * 60000))];
    }
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life in Bloom//Care reminder//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:' + calendarEscape(String(occurrence.id || 'care') + '-' + occurrence.on + '-' + String(occurrence.time || 'any').replace(':', '') + '@life-in-bloom.local'),
      'DTSTAMP:' + stamp(now || new Date()), ...dates,
      'SUMMARY:' + calendarEscape(title + (validTime(occurrence.time) ? ' · ' + timeLabel(occurrence.time) : '')), 'DESCRIPTION:' + calendarEscape(description),
      'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + calendarEscape(title), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].map(foldCalendar).join('\r\n') + '\r\n';
  }

  const api = { DAY, ZONE, CATEGORIES, TEMPLATES, clone, dayKey, dateNumber, dateFromNumber, addDays, addMonths, dateLabel, validTime, timeLabel, ageLabel, money, format, usable, slots, categoryInfo, snapshotBody, completionDays, nextAfter, taskOccurrences, dueTasks, nextDue, frequencyLabel, needsRefill, purchaseHistory, expenses, latestWeight, summary, careInstant, calendarForOccurrence };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomDogModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
