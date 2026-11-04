/* Descriptive sleep/mood comparisons from recorded observations, without inferred scores. */
(function (root) {
  'use strict';
  const D = root.BloomData || (typeof require === 'function' ? require('./bloom-data.js') : null);

  function summarizeMonth(data, year, month) {
    if (!D || !Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
      throw new Error('Choose a valid month.');
    }
    const first = D.parseDate(D.dateKey(year, month, 1));
    if (Number.isNaN(first.getTime())) throw new Error('Choose a valid month.');
    const last = new Date(first);
    last.setMonth(last.getMonth() + 1);
    last.setDate(0);
    const totalDays = last.getDate();
    const days = [];
    const groups = new Map();
    let sleepHoursTotal = 0;
    let daysWithSleep = 0;
    let moodEntryCount = 0;
    let daysWithMood = 0;
    let pairedDays = 0;
    let incompleteSleepDays = 0;

    for (let day = 1; day <= totalDays; day++) {
      const key = D.dateKey(year, month, day);
      const record = data.records?.[key] || D.blankRecord();
      const slots = Object.values(record.slots || {});
      const sleepHours = slots.filter(value => value === 'sleep').length / 2;
      const knownSleep = D.hasSleepTotal(record);
      const unsureHours = slots.filter(value => value === 'rest').length / 2;
      const unknownHours = 24 - slots.length / 2;
      const incomplete = unknownHours > 0 || unsureHours > 0;
      const feelings = new Map();
      const entries = Object.entries(record.moods || {}).filter(([hour, entry]) => Number.isInteger(Number(hour)) && Number(hour) >= 0 && Number(hour) < 24 && typeof entry.feeling === 'string' && entry.feeling.trim());
      for (const [hour, entry] of entries) {
        const value = entry.feeling.trim();
        const id = value.toLowerCase();
        const preset = D.MOOD_OPTIONS.find(option => option.label.toLowerCase() === id);
        if (!feelings.has(id)) feelings.set(id, { id, feeling: preset?.label || value, entries: 0, hours: [] });
        const feeling = feelings.get(id);
        feeling.entries++;
        feeling.hours.push(Number(hour));
      }
      if (knownSleep) {
        daysWithSleep++;
        sleepHoursTotal += sleepHours;
        if (incomplete) incompleteSleepDays++;
      }
      if (entries.length) daysWithMood++;
      moodEntryCount += entries.length;
      if (knownSleep && entries.length) {
        pairedDays++;
        for (const [id, feeling] of feelings) {
          if (!groups.has(id)) groups.set(id, { feeling: feeling.feeling, hours: [], moodEntries: 0 });
          const group = groups.get(id);
          group.hours.push(sleepHours); // Count each tracking day once for each feeling.
          group.moodEntries += feeling.entries;
        }
      }
      days.push({
        key,
        hasEntries: slots.length > 0 || entries.length > 0 || Boolean(record.quality || record.notes),
        knownSleep,
        sleepHours: knownSleep ? sleepHours : null,
        unknownHours, unsureHours, incomplete,
        moods: [...feelings.values()].sort((a, b) => b.entries - a.entries || a.feeling.localeCompare(b.feeling)),
        moodEntries: entries.length
      });
    }
    const comparisons = [...groups.values()].map(group => ({
      feeling: group.feeling,
      days: group.hours.length,
      moodEntries: group.moodEntries,
      averageSleep: group.hours.reduce((total, value) => total + value, 0) / group.hours.length,
      minSleep: Math.min(...group.hours),
      maxSleep: Math.max(...group.hours)
    })).sort((a, b) => b.days - a.days || a.feeling.localeCompare(b.feeling));
    return {
      year, month, totalDays, days, recordedDays: days.filter(day => day.hasEntries),
      daysWithSleep, sleepHoursTotal, averageSleep: daysWithSleep ? sleepHoursTotal / daysWithSleep : null,
      moodEntryCount, daysWithMood, pairedDays, incompleteSleepDays, comparisons
    };
  }

  const api = { summarizeMonth };
  root.BloomInsights = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
