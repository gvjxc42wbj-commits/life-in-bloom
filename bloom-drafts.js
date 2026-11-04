/* Account-scoped local drafts. A saved draft is not a posted cloud transaction. */
(function (root) {
  'use strict';
  const PREFIX = 'life-in-bloom.drafts.v1.';
  function create(options) {
    options = options || {};
    let storage = options.storage;
    const failures = new Set();
    if (!storage) { try { storage = root.localStorage; } catch (_) {} }
    function key(userId, householdId, area) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(userId || '') || !/^[A-Za-z0-9_-]{1,100}$/.test(householdId || '') || !['grocery','commerce','food'].includes(area)) return null;
      return PREFIX + userId + '.' + householdId + '.' + area;
    }
    function safe(value, depth) {
      if (depth > 20) return false;
      if (value === null || ['string','number','boolean'].includes(typeof value)) return typeof value !== 'number' || Number.isFinite(value);
      if (Array.isArray(value)) return value.length <= 5000 && value.every(item => safe(item, depth + 1));
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).every(([field, item]) => !/password|access.?token|refresh.?token|service.?role|secret|invite.?code/i.test(field) && safe(item, depth + 1));
    }
    function read(userId, householdId, area) {
      const name = key(userId, householdId, area);
      if (!storage || !name) return null;
      try {
        const value = JSON.parse(storage.getItem(name) || 'null');
        if (!value || value.version !== 1 || value.userId !== userId || value.householdId !== householdId || value.area !== area || !safe(value.data, 0)) return null;
        return { savedAt: value.savedAt, data: value.data };
      } catch (_) { return null; }
    }
    function write(userId, householdId, area, data) {
      const name = key(userId, householdId, area);
      if (!storage || !name || !safe(data, 0)) { failures.add(name || area); return false; }
      try {
        const value = JSON.stringify({ version: 1, userId, householdId, area, savedAt: new Date().toISOString(), data });
        if (value.length > 3000000) { failures.add(name); return false; }
        storage.setItem(name, value);
        const saved=storage.getItem(name) === value;
        if(saved) failures.delete(name); else failures.add(name);
        return saved;
      } catch (_) { failures.add(name); return false; }
    }
    function clear(userId, householdId, area) {
      const name = key(userId, householdId, area);
      if (!storage || !name) return false;
      try { storage.removeItem(name); failures.delete(name); return true; } catch (_) { failures.add(name); return false; }
    }
    return { read, write, clear, hasFailedWrites: () => failures.size > 0 };
  }
  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomDrafts = api;
})(typeof window !== 'undefined' ? window : globalThis);
