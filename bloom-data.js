/* Shared, versioned data rules for the Sleep & Mood section. No network access. */
(function (root) {
  'use strict';

  const LEGACY_KEY = 'sleep-in-bloom.records.v1';
  const STORAGE_KEY = 'life-in-bloom.sleep-mood.v2';
  const BACKUP_VERSION = 2;
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
    const activities = normalizeActivities(candidate.activities);
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
    return { version: BACKUP_VERSION, records, activities };
  }

  function loadData(storage) {
    const empty = () => ({ version: BACKUP_VERSION, records: {}, activities: copyActivities() });
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (parsed.version !== BACKUP_VERSION) throw new Error('This saved data needs a different app version.');
        return { data: normalizeData(parsed), warning: '', readOnly: false, migrated: false };
      }
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        const data = normalizeData({ records: JSON.parse(legacy) });
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(data));
          return { data, warning: '', readOnly: false, migrated: true };
        } catch (_) {
          return { data, warning: 'Your earlier entries are open, but this device could not save the updated format. Export a backup before closing.', readOnly: false, migrated: true };
        }
      }
      return { data: empty(), warning: '', readOnly: false, migrated: false };
    } catch (_) {
      return {
        data: empty(), readOnly: true, migrated: false,
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
    return { app: 'Sleep in Bloom', version: BACKUP_VERSION, exportedAt: date.toISOString(), records: normalized.records, activities: normalized.activities };
  }

  function parseBackup(content) {
    const parsed = JSON.parse(content);
    if (!object(parsed) || !['Sleep in Bloom', 'Life in Bloom'].includes(parsed.app) || ![1, BACKUP_VERSION].includes(parsed.version)) {
      throw new Error('Choose a Sleep in Bloom or Life in Bloom backup file.');
    }
    return normalizeData({ records: parsed.records, activities: parsed.version === 1 ? undefined : parsed.activities });
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

  const api = { LEGACY_KEY, STORAGE_KEY, BACKUP_VERSION, DEFAULT_ACTIVITIES, ACTIVITY_COLORS, MOOD_OPTIONS, blankRecord, dateKey, parseDate, shiftDate, weekStart, clockLabel, hourDateTime, normalizeData, loadData, saveData, makeBackup, parseBackup, setSlot, setRange, hasAwake, hasSleepTotal, awakeActivities, setMood };
  root.BloomData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
