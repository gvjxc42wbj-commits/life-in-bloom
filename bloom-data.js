/* Shared, versioned data rules for Life in Bloom. No network access. */
(function (root) {
  'use strict';

  const LEGACY_KEY = 'sleep-in-bloom.records.v1';
  const PREVIOUS_KEY = 'life-in-bloom.sleep-mood.v2';
  const V3_KEY = 'life-in-bloom.sleep-mood.v3';
  const STORAGE_KEY = 'life-in-bloom.data.v4';
  const STORAGE_KEYS = [STORAGE_KEY, V3_KEY, PREVIOUS_KEY, LEGACY_KEY];
  const BACKUP_VERSION = 4;
  const STORAGE_VERSIONS = { [STORAGE_KEY]: BACKUP_VERSION, [V3_KEY]: 3, [PREVIOUS_KEY]: 2 };
  const DEFAULT_ACTIVITIES = [
    { id: 'cooking', name: 'Cooking', icon: '👩🏾‍🍳', color: '#f1cfac' },
    { id: 'piano', name: 'Piano', icon: '🎹', color: '#d9c8ed' },
    { id: 'sewing', name: 'Sewing', icon: '🧵', color: '#edc1d7' },
    { id: 'math', name: 'Math', icon: '🔢', color: '#bcd8ec' },
    { id: 'language', name: 'Language', icon: '💬', color: '#c7dec8' },
    { id: 'reading', name: 'Reading', icon: '📖', color: '#d4d3ed' },
    { id: 'walking', name: 'Walking', icon: '🚶🏾‍♀️', color: '#d0dfb6' },
    { id: 'chores', name: 'Chores', icon: '🧺', color: '#ead8b7' },
    { id: 'personal-care', name: 'Personal care', icon: '🌸', color: '#f0cbd0' }
  ];
  const ACTIVITY_COLORS = [
    { label: 'Peach', color: '#f1cfac' },
    { label: 'Lavender', color: '#d9c8ed' },
    { label: 'Pink', color: '#edc1d7' },
    { label: 'Blue', color: '#bcd8ec' },
    { label: 'Sage', color: '#c7dec8' },
    { label: 'Cream', color: '#ead8b7' }
  ];
  const MOOD_OPTIONS = [
    { label: 'Calm', color: '#d9c8ed' },
    { label: 'Content', color: '#c7dec8' },
    { label: 'Happy', color: '#f1dfac' },
    { label: 'Low', color: '#bcd8ec' },
    { label: 'Anxious', color: '#f1cfac' },
    { label: 'Frustrated', color: '#edc1d7' },
    { label: 'Tired', color: '#ddd8e5' },
    { label: 'Energized', color: '#d0dfb6' }
  ];
  const STATUS = new Set(['sleep', 'rest', 'awake']);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copyActivities = () => DEFAULT_ACTIVITIES.map(activity => ({ ...activity }));
  const text = (value, length) => typeof value === 'string' ? value.slice(0, length) : '';
  const validActivityId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);

  function blankRecord() {
    return { slots: {}, activities: {}, moods: {}, quality: '', notes: '' };
  }

  function dateKey(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(NaN);
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    return dateKey(date.getFullYear(), date.getMonth(), date.getDate()) === key ? date : new Date(NaN);
  }

  function shiftDate(key, days) {
    const date = parseDate(key);
    if (Number.isNaN(date.getTime())) throw new Error('Choose a valid date.');
    date.setDate(date.getDate() + days);
    return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function weekStart(key) {
    const day = parseDate(key).getDay();
    if (Number.isNaN(day)) throw new Error('Choose a valid date.');
    return shiftDate(key, -((day + 6) % 7));
  }

  function clockLabel(slot) {
    const minutes = (8 * 60 + slot * 30) % (24 * 60);
    const hours = Math.floor(minutes / 60);
    return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
  }

  function hourDateTime(key, hour) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Choose an hour from this day.');
    const date = parseDate(key);
    if (Number.isNaN(date.getTime())) throw new Error('Choose a valid date.');
    date.setHours(8 + hour, 0, 0, 0);
    return date;
  }

  function timeMinutes(value) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new Error('Choose a valid appointment time.');
    }
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function normalizeAppointment(raw) {
    if (!object(raw) || !validActivityId(raw.id)) throw new Error('The appointment needs a valid identifier.');
    if (typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('Give the appointment a title.');
    if (Number.isNaN(parseDate(raw.startDate).getTime())) throw new Error('Choose a valid appointment date.');
    if (raw.endNextDay !== undefined && typeof raw.endNextDay !== 'boolean') throw new Error('Choose whether the appointment ends the next day.');
    const endNextDay = raw.endNextDay === true;
    const duration = timeMinutes(raw.endTime) + (endNextDay ? 1440 : 0) - timeMinutes(raw.startTime);
    if (duration <= 0 || duration > 1440) {
      throw new Error('The end must be after the start, and appointments can last up to 24 hours. Use “ends next day” for overnight times.');
    }
    if (raw.recurrence !== undefined && !object(raw.recurrence)) throw new Error('The repeat settings are not valid.');
    const repeat = raw.recurrence || {};
    const frequency = repeat.frequency === undefined ? 'none' : repeat.frequency;
    if (!['none', 'daily', 'weekly', 'monthly'].includes(frequency)) throw new Error('Choose a valid repeat frequency.');
    const interval = frequency === 'none' ? 1 : repeat.interval === undefined ? 1 : repeat.interval;
    if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw new Error('Repeat every 1 to 52 days, weeks, or months.');
    let weekdays = [];
    if (frequency === 'weekly') {
      const requested = repeat.weekdays === undefined ? [parseDate(raw.startDate).getDay()] : repeat.weekdays;
      if (!Array.isArray(requested) || !requested.length || requested.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
        throw new Error('Choose at least one valid weekday for this appointment.');
      }
      weekdays = [...new Set(requested)].sort((a, b) => a - b);
    }
    const until = frequency === 'none' ? '' : repeat.until === undefined ? '' : repeat.until;
    if (until !== '' && (typeof until !== 'string' || Number.isNaN(parseDate(until).getTime()) || until < raw.startDate)) {
      throw new Error('The repeat end date must be on or after the first date.');
    }
    if (raw.excludedDates !== undefined && !Array.isArray(raw.excludedDates)) throw new Error('Skipped appointment dates are not valid.');
    const excludedDates = raw.excludedDates || [];
    if (excludedDates.length > 10000 || excludedDates.some(key => Number.isNaN(parseDate(key).getTime()))) {
      throw new Error('The skipped appointment dates are not valid.');
    }
    return {
      id: raw.id,
      title: raw.title.trim().slice(0, 120),
      startDate: raw.startDate,
      startTime: raw.startTime,
      endTime: raw.endTime,
      endNextDay,
      color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#f0cbd0',
      notes: text(raw.notes, 2000),
      recurrence: { frequency, interval, weekdays, until },
      excludedDates: [...new Set(excludedDates)].sort()
    };
  }

  function normalizeAppointments(candidate) {
    if (candidate !== undefined && !Array.isArray(candidate)) throw new Error('The appointment list is not valid.');
    if ((candidate || []).length > 2000) throw new Error('This version can keep up to 2,000 appointment definitions.');
    const ids = new Set();
    return (candidate || []).map(raw => {
      const appointment = normalizeAppointment(raw);
      if (ids.has(appointment.id)) throw new Error('Two appointments have the same identifier.');
      ids.add(appointment.id);
      return appointment;
    });
  }

  function entryText(value, label, maximum, required = false, preserveSpacing = false) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string') throw new Error(`${label} must be text.`);
    const result = preserveSpacing ? value : value.trim();
    if (required && !result.trim()) throw new Error(`Enter ${label.toLowerCase()}.`);
    if (result.length > maximum) throw new Error(`${label} can be up to ${maximum.toLocaleString('en-US')} characters.`);
    return result;
  }

  function entryTimestamp(value) {
    // Missing timestamps in imported records remain unknown, rather than being
    // assigned today's date each time a backup is opened.
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
      throw new Error('The saved entry date is not a valid UTC timestamp.');
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new Error('The saved entry date is not a valid UTC timestamp.');
    }
    return date.toISOString();
  }

  function normalizeShoppingItem(raw) {
    if (!object(raw) || !validActivityId(raw.id)) throw new Error('The grocery item needs a valid identifier.');
    if (raw.checked !== undefined && typeof raw.checked !== 'boolean') throw new Error('The grocery checkmark must be true or false.');
    return {
      id: raw.id,
      name: entryText(raw.name, 'An item name', 160, true),
      quantity: entryText(raw.quantity, 'The grocery quantity', 120),
      checked: raw.checked === true,
      createdAt: entryTimestamp(raw.createdAt),
      updatedAt: entryTimestamp(raw.updatedAt)
    };
  }

  function normalizeIdeaNote(raw) {
    if (!object(raw) || !validActivityId(raw.id)) throw new Error('The note needs a valid identifier.');
    const title = entryText(raw.title, 'The note title', 160);
    const body = entryText(raw.body, 'The note', 20000, false, true);
    if (!title && !body.trim()) throw new Error('Write a note or give it a title before saving.');
    return {
      id: raw.id, title, body,
      createdAt: entryTimestamp(raw.createdAt),
      updatedAt: entryTimestamp(raw.updatedAt)
    };
  }

  function normalizeEntryList(candidate, label, maximum, normalizeEntry) {
    if (candidate !== undefined && !Array.isArray(candidate)) throw new Error(`The ${label} list is not valid.`);
    if ((candidate || []).length > maximum) throw new Error(`This version can keep up to ${maximum.toLocaleString('en-US')} ${label} entries.`);
    const ids = new Set();
    return (candidate || []).map(raw => {
      const entry = normalizeEntry(raw);
      if (ids.has(entry.id)) throw new Error(`Two ${label} entries have the same identifier.`);
      ids.add(entry.id);
      return entry;
    });
  }

  function upsertEntry(data, raw, field, normalizeEntry, maximum, label) {
    if (!object(raw) || !validActivityId(raw.id)) throw new Error(`The ${label} needs a valid identifier.`);
    const next = normalizeData(data);
    const index = next[field].findIndex(item => item.id === raw.id);
    const existing = index < 0 ? null : next[field][index];
    const entry = normalizeEntry({ ...existing, ...raw });
    const now = new Date().toISOString();
    entry.createdAt = existing ? existing.createdAt : entry.createdAt || now;
    entry.updatedAt = now;
    if (index < 0) {
      if (next[field].length >= maximum) throw new Error(`This version can keep up to ${maximum.toLocaleString('en-US')} ${label} entries.`);
      next[field].push(entry);
    } else next[field][index] = entry;
    return next;
  }

  function removeEntry(data, id, field, label) {
    const next = normalizeData(data);
    if (!next[field].some(item => item.id === id)) throw new Error(`This ${label} could not be found.`);
    next[field] = next[field].filter(item => item.id !== id);
    return next;
  }

  function upsertShoppingItem(data, item) {
    return upsertEntry(data, item, 'shoppingList', normalizeShoppingItem, 2000, 'grocery');
  }

  function removeShoppingItem(data, id) {
    return removeEntry(data, id, 'shoppingList', 'grocery item');
  }

  function upsertIdeaNote(data, note) {
    return upsertEntry(data, note, 'ideaNotes', normalizeIdeaNote, 500, 'note');
  }

  function removeIdeaNote(data, id) {
    return removeEntry(data, id, 'ideaNotes', 'note');
  }

  function calendarOrdinal(key) {
    const local = parseDate(key);
    const utc = new Date(0);
    utc.setUTCHours(0, 0, 0, 0);
    utc.setUTCFullYear(local.getFullYear(), local.getMonth(), local.getDate());
    return utc.getTime() / 86400000;
  }

  function repeatsOn(appointment, key) {
    if (key < appointment.startDate || (appointment.recurrence.until && key > appointment.recurrence.until) || appointment.excludedDates.includes(key)) return false;
    const { frequency, interval, weekdays } = appointment.recurrence;
    if (frequency === 'none') return key === appointment.startDate;
    if (frequency === 'daily') return (calendarOrdinal(key) - calendarOrdinal(appointment.startDate)) % interval === 0;
    if (frequency === 'weekly') {
      const weeks = (calendarOrdinal(weekStart(key)) - calendarOrdinal(weekStart(appointment.startDate))) / 7;
      return weeks % interval === 0 && weekdays.includes(parseDate(key).getDay());
    }
    const first = parseDate(appointment.startDate);
    const date = parseDate(key);
    const months = (date.getFullYear() - first.getFullYear()) * 12 + date.getMonth() - first.getMonth();
    return months % interval === 0 && date.getDate() === first.getDate();
  }

  function localDateTime(key, clock) {
    const date = parseDate(key);
    const minutes = timeMinutes(clock);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
  }

  function appointmentsInWindow(appointments, fromDate, toDate) {
    if (typeof fromDate?.getTime !== 'function' || typeof toDate?.getTime !== 'function' || !Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || toDate.getTime() <= fromDate.getTime()) {
      throw new Error('Choose a valid appointment date range.');
    }
    const fromKey = dateKey(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    const toKey = dateKey(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
    if (Number.isNaN(parseDate(fromKey).getTime()) || Number.isNaN(parseDate(toKey).getTime()) || calendarOrdinal(toKey) - calendarOrdinal(fromKey) > 370) {
      throw new Error('View appointments in a date range of 370 days or fewer.');
    }
    const firstKey = fromKey === '0000-01-01' ? fromKey : shiftDate(fromKey, -1);
    const definitions = normalizeAppointments(appointments);
    const occurrences = [];
    for (let key = firstKey; key <= toKey; key = shiftDate(key, 1)) {
      for (const appointment of definitions) {
        if (!repeatsOn(appointment, key)) continue;
        const endKey = appointment.endNextDay ? shiftDate(key, 1) : key;
        const start = localDateTime(key, appointment.startTime);
        let end = localDateTime(endKey, appointment.endTime);
        const desiredStart = timeMinutes(appointment.startTime);
        const desiredEnd = timeMinutes(appointment.endTime);
        let timeAdjusted = start.getHours() * 60 + start.getMinutes() !== desiredStart || end.getHours() * 60 + end.getMinutes() !== desiredEnd;
        // A spring-forward gap can move a nonexistent start beyond its requested end.
        // Preserve a visible occurrence and flag it for review instead of silently dropping it.
        if (end <= start) {
          const duration = desiredEnd + (appointment.endNextDay ? 1440 : 0) - desiredStart;
          end = new Date(start.getTime() + duration * 60000);
          timeAdjusted = true;
        }
        if (end > fromDate && start < toDate) {
          occurrences.push({ ...appointment, appointmentId: appointment.id, occurrenceDate: key, start, end, timeAdjusted });
        }
      }
      if (key === toKey) break;
    }
    return occurrences.sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }

  function upsertAppointment(data, raw) {
    const next = normalizeData(data);
    const appointment = normalizeAppointment(raw);
    const index = next.appointments.findIndex(item => item.id === appointment.id);
    if (index < 0) next.appointments.push(appointment);
    else next.appointments[index] = appointment;
    if (next.appointments.length > 2000) throw new Error('This version can keep up to 2,000 appointment definitions.');
    return next;
  }

  function removeAppointment(data, id, occurrenceDate = '', scope = 'series') {
    const next = normalizeData(data);
    const appointment = next.appointments.find(item => item.id === id);
    if (!appointment) throw new Error('This appointment could not be found.');
    if (!['series', 'occurrence'].includes(scope)) throw new Error('Choose which appointment dates to remove.');
    if (scope === 'series') {
      next.appointments = next.appointments.filter(item => item.id !== id);
      return next;
    }
    if (Number.isNaN(parseDate(occurrenceDate).getTime()) || !repeatsOn(appointment, occurrenceDate)) {
      throw new Error('This date is not an occurrence of the appointment.');
    }
    if (appointment.recurrence.frequency === 'none') next.appointments = next.appointments.filter(item => item.id !== id);
    else {
      appointment.excludedDates = [...new Set([...appointment.excludedDates, occurrenceDate])].sort();
      if (appointment.excludedDates.length > 10000) throw new Error('This appointment has too many individually skipped dates.');
    }
    return next;
  }

  function updateAppointmentOccurrence(data, id, occurrenceDate, replacementRaw) {
    const replacement = normalizeAppointment(replacementRaw);
    if (replacement.recurrence.frequency !== 'none') throw new Error('A single-occurrence change must be a one-time appointment.');
    if (replacement.id === id || data.appointments?.some(item => item.id === replacement.id)) {
      throw new Error('The changed occurrence needs its own unique identifier.');
    }
    const next = removeAppointment(data, id, occurrenceDate, 'occurrence');
    return upsertAppointment(next, replacement);
  }

  function normalizeActivities(candidate) {
    if (candidate !== undefined && !Array.isArray(candidate)) throw new Error('The activity list is not valid.');
    if ((candidate || []).length > 200) throw new Error('The backup contains too many activity definitions.');
    const activities = new Map(copyActivities().map(activity => [activity.id, activity]));
    for (const raw of candidate || []) {
      if (!object(raw) || !validActivityId(raw.id) || typeof raw.name !== 'string' || !raw.name.trim()) {
        throw new Error('An activity is missing a valid name or identifier.');
      }
      activities.set(raw.id, {
        id: raw.id,
        name: raw.name.trim().slice(0, 60),
        icon: text(raw.icon, 24) || '✨',
        color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#d9c8ed'
      });
    }
    if (activities.size > 200) throw new Error('The backup contains too many activity definitions.');
    return [...activities.values()];
  }

  function normalizeData(candidate) {
    if (!object(candidate) || !object(candidate.records)) throw new Error('The saved records are not valid.');
    if (candidate.version !== undefined && ![1, 2, 3, BACKUP_VERSION].includes(candidate.version)) {
      throw new Error('This saved data needs a different app version.');
    }
    const activities = normalizeActivities(candidate.activities);
    const appointments = normalizeAppointments(candidate.appointments);
    const shoppingList = normalizeEntryList(candidate.shoppingList, 'grocery', 2000, normalizeShoppingItem);
    const ideaNotes = normalizeEntryList(candidate.ideaNotes, 'note', 500, normalizeIdeaNote);
    const activityIds = new Set(activities.map(activity => activity.id));
    const records = {};
    const entries = Object.entries(candidate.records);
    if (entries.length > 10000) throw new Error('This file has more daily records than this version can import.');
    for (const [key, raw] of entries) {
      if (Number.isNaN(parseDate(key).getTime()) || !object(raw)) throw new Error('A daily record has an invalid date.');
      for (const field of ['slots', 'activities', 'moods']) {
        if (raw[field] !== undefined && !object(raw[field])) throw new Error(`A daily ${field} record is not valid.`);
      }
      const record = blankRecord();
      for (const [index, value] of Object.entries(raw.slots || {})) {
        const slot = Number(index);
        if (!/^\d+$/.test(index) || !Number.isInteger(slot) || slot < 0 || slot > 47 || !STATUS.has(value)) {
          throw new Error('A sleep time block is not valid.');
        }
        record.slots[slot] = value;
      }
      for (const [index, id] of Object.entries(raw.activities || {})) {
        const slot = Number(index);
        if (!/^\d+$/.test(index) || !Number.isInteger(slot) || slot < 0 || slot > 47 || !activityIds.has(id)) {
          throw new Error('An activity time block is not valid.');
        }
        if (record.slots[slot] === 'awake') record.activities[slot] = id;
      }
      for (const [index, mood] of Object.entries(raw.moods || {})) {
        const hour = Number(index);
        if (!/^\d+$/.test(index) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !object(mood) || typeof mood.feeling !== 'string' || !mood.feeling.trim()) {
          throw new Error('An hourly mood entry is not valid.');
        }
        record.moods[hour] = {
          feeling: mood.feeling.trim().slice(0, 80),
          note: text(mood.note, 1000),
          updatedAt: typeof mood.updatedAt === 'string' && !Number.isNaN(Date.parse(mood.updatedAt)) ? mood.updatedAt : ''
        };
      }
      record.quality = ['Poor', 'Okay', 'Restful'].includes(raw.quality) ? raw.quality : '';
      record.notes = text(raw.notes, 3000);
      records[key] = record;
    }
    return { version: BACKUP_VERSION, records, activities, appointments, shoppingList, ideaNotes };
  }

  function loadData(storage) {
    const empty = () => ({ version: BACKUP_VERSION, records: {}, activities: copyActivities(), appointments: [], shoppingList: [], ideaNotes: [] });
    let sourceKey = STORAGE_KEY;
    try {
      for (const key of STORAGE_KEYS) {
        sourceKey = key;
        const saved = storage.getItem(key);
        if (saved === null) continue;
        const parsed = JSON.parse(saved);
        if (key !== LEGACY_KEY && (!object(parsed) || parsed.version !== STORAGE_VERSIONS[key])) {
          throw new Error('This saved data needs a different app version.');
        }
        const data = normalizeData(key === LEGACY_KEY ? { records: parsed } : parsed);
        if (key === STORAGE_KEY) return { data, warning: '', readOnly: false, migrated: false, sourceKey: key };
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(data));
          return { data, warning: '', readOnly: false, migrated: true, sourceKey: key };
        } catch (_) {
          return { data, warning: 'Your earlier entries are open, but this device could not save the updated format. Export a backup before closing.', readOnly: false, migrated: true, sourceKey: key };
        }
      }
      return { data: empty(), warning: '', readOnly: false, migrated: false, sourceKey: '' };
    } catch (_) {
      return {
        data: empty(), readOnly: true, migrated: false, sourceKey,
        warning: 'Saved entries could not be opened. Your stored copy has not been changed. Please ask for help before adding new entries.'
      };
    }
  }

  function saveData(storage, data) {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
    return true;
  }

  function makeBackup(data, date = new Date()) {
    const normalized = normalizeData(data);
    return { app: 'Life in Bloom', version: BACKUP_VERSION, exportedAt: date.toISOString(), records: normalized.records, activities: normalized.activities, appointments: normalized.appointments, shoppingList: normalized.shoppingList, ideaNotes: normalized.ideaNotes };
  }

  function parseBackup(content) {
    const parsed = JSON.parse(content);
    if (!object(parsed) || !['Sleep in Bloom', 'Life in Bloom'].includes(parsed.app) || ![1, 2, 3, BACKUP_VERSION].includes(parsed.version)) {
      throw new Error('Choose a Sleep in Bloom or Life in Bloom backup file.');
    }
    return normalizeData({ records: parsed.records, activities: parsed.version === 1 ? undefined : parsed.activities, appointments: parsed.appointments, shoppingList: parsed.shoppingList, ideaNotes: parsed.ideaNotes });
  }

  function setSlot(record, index, kind, activityId = '') {
    if (!Number.isInteger(index) || index < 0 || index > 47 || (!STATUS.has(kind) && kind !== 'erase')) {
      throw new Error('Choose a valid time block and status.');
    }
    const next = { ...blankRecord(), ...record, slots: { ...(record.slots || {}) }, activities: { ...(record.activities || {}) }, moods: { ...(record.moods || {}) } };
    if (kind === 'erase') delete next.slots[index];
    else next.slots[index] = kind;
    if (kind === 'awake' && validActivityId(activityId)) next.activities[index] = activityId;
    else delete next.activities[index];
    return next;
  }

  function setRange(record, start, end, kind, activityId = '') {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 48 || start >= end) {
      throw new Error('Choose an end time later than the start time in this day.');
    }
    let next = record;
    for (let index = start; index < end; index++) next = setSlot(next, index, kind, activityId);
    return next;
  }

  function hasAwake(record, hour) {
    return record.slots?.[hour * 2] === 'awake' || record.slots?.[hour * 2 + 1] === 'awake';
  }

  function hasSleepTotal(record) {
    const slots = record.slots || {};
    if (Object.values(slots).includes('sleep')) return true;
    // Partial awake/unsure observations do not establish zero hours of sleep.
    return Array.from({ length: 48 }, (_, index) => slots[index]).every(value => value === 'awake');
  }

  function awakeActivities(record, hour, activities) {
    const ids = new Set([hour * 2, hour * 2 + 1].filter(slot => record.slots?.[slot] === 'awake').map(slot => record.activities?.[slot]).filter(Boolean));
    return activities.filter(activity => ids.has(activity.id));
  }

  function setMood(record, hour, entry) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Choose a valid hour.');
    if (entry !== null && !hasAwake(record, hour) && !record.moods?.[hour]) {
      throw new Error('Mark some time in this hour Awake before adding a mood.');
    }
    const next = { ...blankRecord(), ...record, moods: { ...(record.moods || {}) } };
    if (entry === null) delete next.moods[hour];
    else {
      const feeling = text(entry.feeling, 80).trim();
      if (!feeling) throw new Error('Choose a feeling or write your own.');
      next.moods[hour] = { feeling, note: text(entry.note, 1000), updatedAt: entry.updatedAt || new Date().toISOString() };
    }
    return next;
  }

  const api = { LEGACY_KEY, PREVIOUS_KEY, V3_KEY, STORAGE_KEY, STORAGE_KEYS, BACKUP_VERSION, DEFAULT_ACTIVITIES, ACTIVITY_COLORS, MOOD_OPTIONS, blankRecord, dateKey, parseDate, shiftDate, weekStart, clockLabel, hourDateTime, normalizeData, loadData, saveData, makeBackup, parseBackup, setSlot, setRange, hasAwake, hasSleepTotal, awakeActivities, setMood, normalizeAppointment, appointmentsInWindow, upsertAppointment, removeAppointment, updateAppointmentOccurrence, normalizeShoppingItem, normalizeIdeaNote, upsertShoppingItem, removeShoppingItem, upsertIdeaNote, removeIdeaNote };
  root.BloomData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
