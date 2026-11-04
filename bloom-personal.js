/* Local journals stay on the device and are separated by the signed-in account.
 * This is local account separation, not encryption or cloud backup. */
(function (root) {
  'use strict';
  const D = root.BloomData || (typeof require === 'function' ? require('./bloom-data.js') : null);
  const MARKER = 'life-in-bloom.personal-accounts.v1';
  const PREFIX = 'life-in-bloom.personal.';
  const validId = value => typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value);

  function createManager(storage) {
    function marker() {
      const raw = storage.getItem(MARKER);
      if (raw === null) return { version: 1, enabled: false, legacyOwner: null };
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || typeof value.enabled !== 'boolean' || (value.legacyOwner !== null && !validId(value.legacyOwner))) {
        throw new Error('The personal account settings could not be read. Your saved journals have not been changed.');
      }
      return value;
    }
    function mark(value) { storage.setItem(MARKER, JSON.stringify(value)); }
    function scoped(userId) {
      if (!validId(userId)) throw new Error('Sign in before opening a personal journal.');
      return {
        getItem(key) { return storage.getItem(PREFIX + userId + '.' + key); },
        setItem(key, value) { storage.setItem(PREFIX + userId + '.' + key, value); },
        removeItem(key) { storage.removeItem(PREFIX + userId + '.' + key); }
      };
    }
    function hasData(target) { return D.STORAGE_KEYS.some(key => target.getItem(key) !== null); }
    function open(user) {
      try {
        const m = marker();
        if (!user || !validId(user.id)) {
          if (m.enabled) return { mode: 'locked', message: 'Sign in to open your personal journal on this device.' };
          return { mode: 'legacy', key: 'legacy', storage, loaded: D.loadData(storage) };
        }
        // Remember that this device now uses accounts, but never guess who owns its old journal.
        if (!m.enabled) { m.enabled = true; mark(m); }
        const target = scoped(user.id);
        if (hasData(target)) return { mode: 'account', key: user.id, storage: target, loaded: D.loadData(target) };
        if (hasData(storage) && (!m.legacyOwner || m.legacyOwner === user.id)) {
          return { mode: 'choose', key: user.id, canCopyLegacy: true, message: 'There are earlier personal entries on this device. Choose whether they belong to you.' };
        }
        return { mode: 'account', key: user.id, storage: target, loaded: D.loadData(target) };
      } catch (error) {
        return { mode: 'locked', message: error.message || 'This device could not open its personal journal settings.' };
      }
    }
    function claimLegacy(userId, pendingData) {
      if (!validId(userId)) throw new Error('Sign in first.');
      const m = marker();
      if (m.legacyOwner && m.legacyOwner !== userId) throw new Error('The earlier journal belongs to another account on this device.');
      const target = scoped(userId);
      if (hasData(target)) throw new Error('This account already has a journal on this device. Export it before considering a replacement.');
      // Read/migrate in memory; leave every earlier original storage value untouched.
      const original = D.loadData({ getItem: key => storage.getItem(key), setItem() {} });
      if (original.readOnly) throw new Error(original.warning);
      const serialized = JSON.stringify(D.normalizeData(pendingData || original.data));
      // Record the explicit ownership choice first. If the subsequent copy fails,
      // another account cannot claim the original; its owner can retry safely.
      mark({ version: 1, enabled: true, legacyOwner: userId });
      target.setItem(D.STORAGE_KEY, serialized);
      if (target.getItem(D.STORAGE_KEY) !== serialized) throw new Error('The copied journal could not be verified. Your earlier copy remains on this device.');
      return open({ id: userId });
    }
    function startFresh(userId) {
      if (!validId(userId)) throw new Error('Sign in first.');
      const m = marker();
      const target = scoped(userId);
      if (hasData(target)) throw new Error('This account already has a journal on this device.');
      mark({ ...m, enabled: true });
      D.saveData(target, D.normalizeData({ records: {} }));
      return open({ id: userId });
    }
    return { open, claimLegacy, startFresh, scoped, marker };
  }
  const api = { createManager, MARKER, PREFIX };
  root.BloomPersonal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
