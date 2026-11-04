/* Shared Grocery records. Personal device logs never enter this module. */
(function (root) {
  'use strict';

  const TABLES = {
    households: 'bloom_households', members: 'bloom_household_members',
    privateProfile: 'bloom_private_profiles', dietProfiles: 'bloom_diet_profiles',
    budgets: 'bloom_budgets', inventory: 'bloom_inventory', shoppingItems: 'bloom_shopping_items'
  };
  const PRIVATE_FIELDS = ['display_name', 'age_years', 'height_cm', 'weight_kg', 'activity_level', 'notes'];
  const DIET_FIELDS = ['display_name', 'color', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'allergies', 'restrictions', 'preferences', 'notes'];
  const INVENTORY_FIELDS = ['name', 'brand', 'quantity', 'unit', 'location', 'expires_on', 'notes'];
  const SHOPPING_FIELDS = ['name', 'quantity', 'checked'];
  const PAGE_SIZE = 100;

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function pick(value, fields) {
    const result = {};
    for (const field of fields) if (Object.prototype.hasOwnProperty.call(value || {}, field)) result[field] = value[field];
    return result;
  }
  function errorOf(error, fallback) {
    const result = new Error(error && error.message ? error.message : fallback || 'The Grocery request could not be completed.');
    if (error && error.code) result.code = error.code;
    return result;
  }
  function assertResult(result) {
    if (!result || result.error) throw errorOf(result && result.error);
    return result.data;
  }
  function userSummary(user) { return user && user.id ? { id: user.id, email: user.email || '' } : null; }
  function emptyState(status) {
    return { status: status || 'loading', user: null, household: null, members: [], privateProfile: null,
      dietProfiles: [], budgets: [], inventory: [], shoppingItems: [], error: '', recovery: false };
  }
  function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  }
  function defaultStorage() {
    try { if (root.sessionStorage) return root.sessionStorage; } catch (_) { /* This tab can use an in-memory session. */ }
    return memoryStorage();
  }
  function currentRedirect() {
    if (!root.location || !/^https?:$/.test(root.location.protocol)) return undefined;
    return root.location.origin + root.location.pathname;
  }
  function revisionOf(row) {
    const revision = Number(row && row.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Refresh Grocery before editing this saved entry.');
    return revision;
  }
  function validMonth(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) throw new Error('Choose a valid month.');
    return value;
  }
  function importRows(items, householdId) {
    if (!Array.isArray(items)) throw new Error('Choose the device grocery list, not a complete backup.');
    if (items.length > 2000) throw new Error('Import up to 2,000 grocery items at a time.');
    const seen = new Set();
    return items.map(item => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)) throw new Error('A grocery item has an invalid identifier.');
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const quantity = typeof item.quantity === 'string' ? item.quantity.trim() : '';
      if (!name || name.length > 160 || quantity.length > 120) throw new Error('A grocery item needs a name of up to 160 characters and a quantity of up to 120 characters.');
      const sourceKey = 'local-v4:' + item.id;
      if (seen.has(sourceKey)) throw new Error('The device grocery list contains a duplicate item identifier.');
      seen.add(sourceKey);
      return { household_id: householdId, name, quantity, checked: item.checked === true, source_key: sourceKey };
    });
  }

  function createStore(options) {
    options = options || {};
    const config = options.config || {};
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    const authStorage = options.storage || defaultStorage();
    const storageKey = 'life-in-bloom.grocery.auth.v1';
    let client = options.client || null;
    let state = emptyState('loading');
    let generation = 0;
    let requestNumber = 0;
    let authNumber = 0;
    let authBusy = false;
    let suppressAuth = false;
    let subscription = null;
    let initialPromise = null;
    let destroyed = false;
    let lastScheduled = null;

    function snapshot() { return clone(state); }
    function emit() { if (!destroyed) onChange(snapshot()); }
    function ensureClient() {
      if (client) return client;
      if (!root.supabase || typeof root.supabase.createClient !== 'function') throw new Error('The secure sign-in tools could not load. Connect to the internet and refresh this page.');
      if (!/^https:\/\//.test(config.url || '') || !/^sb_publishable_/.test(config.publishableKey || '')) throw new Error('Grocery cloud setup is not configured yet.');
      client = root.supabase.createClient(config.url, config.publishableKey, {
        auth: { storage: authStorage, storageKey, persistSession: true, autoRefreshToken: true,
          detectSessionInUrl: true, flowType: 'implicit' }
      });
      return client;
    }
    function replaceUser(user, status) {
      const next = userSummary(user);
      if ((state.user && state.user.id) !== (next && next.id)) {
        generation++;
        requestNumber++;
        state = { ...emptyState(status || (next ? 'loading' : 'signed-out')), user: next };
      } else {
        state.user = next;
        if (status) state.status = status;
      }
    }
    function clearSession() {
      generation++;
      requestNumber++;
      state = emptyState('signed-out');
      emit();
    }
    function fail(error, options) {
      const problem = errorOf(error);
      state.error = problem.message;
      if (options && options.clear) {
        const user = state.user;
        const recovery = state.recovery;
        const household = state.household;
        // Keep the current identity while a read is unavailable, so the form
        // retains its draft/request ID. Record caches are cleared. An actual
        // membership loss or account change clears the identity separately.
        state = { ...emptyState('error'), user, household, recovery, error: problem.message };
      }
      emit();
      return problem;
    }
    function checkContext(context) {
      if (destroyed || context.generation !== generation || context.userId !== (state.user && state.user.id) ||
          (context.householdId && context.householdId !== (state.household && state.household.id))) {
        const error = new Error('The signed-in account or household changed. Please try again in the current account.');
        error.code = 'BLOOM_CONTEXT_CHANGED';
        throw error;
      }
    }
    function context(requireHousehold) {
      ensureClient();
      if (!state.user || suppressAuth) throw new Error('Sign in to Grocery first.');
      if (requireHousehold && (!state.household || state.status !== 'ready')) throw new Error('Open your household and refresh Grocery first.');
      return { generation, userId: state.user.id, householdId: requireHousehold ? state.household.id : null };
    }
    function scheduleRefresh() {
      if (lastScheduled !== null) return;
      lastScheduled = setTimeout(() => {
        lastScheduled = null;
        if (!destroyed && !suppressAuth && !authBusy && state.user) refresh().catch(() => {});
      }, 0);
    }
    function authChanged(event, session) {
      if (destroyed) return;
      if (event === 'SIGNED_OUT') { clearSession(); return; }
      if (suppressAuth) return;
      if (session && session.user) {
        const changed = !state.user || state.user.id !== session.user.id;
        replaceUser(session.user);
        if (event === 'PASSWORD_RECOVERY') state.recovery = true;
        if (changed || event === 'PASSWORD_RECOVERY') emit();
        if (!authBusy && (changed || event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY')) scheduleRefresh();
      }
    }
    async function readAll(table, filters, order) {
      const rows = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        let query = client.from(table).select('*', { count: 'exact' });
        for (const [key, value] of Object.entries(filters || {})) query = query.eq(key, value);
        for (const key of order || []) query = query.order(key, { ascending: true });
        const result = await query.range(start, start + PAGE_SIZE - 1);
        const page = assertResult(result) || [];
        if (!Array.isArray(page)) throw new Error('Grocery received an unexpected response. Please refresh.');
        rows.push(...page);
        if (typeof result.count === 'number') {
          if (rows.length >= result.count) break;
          if (page.length < PAGE_SIZE) throw new Error('Grocery could not load the complete list. Please refresh before editing.');
        } else if (page.length < PAGE_SIZE) break;
        if (rows.length > 100000) throw new Error('This household has too many records for this view. Export and ask for help before continuing.');
      }
      return rows;
    }
    async function refresh() {
      ensureClient();
      if (!state.user || suppressAuth) return snapshot();
      const current = context(false);
      const request = ++requestNumber;
      const stillCurrent = () => !destroyed && current.generation === generation && request === requestNumber &&
        current.userId === (state.user && state.user.id) && !suppressAuth;
      try {
        if (state.status !== 'ready') { state.status = 'loading'; state.error = ''; emit(); }
        const memberships = await readAll(TABLES.members, { user_id: current.userId }, ['household_id', 'user_id']);
        if (!stillCurrent()) return snapshot();
        if (memberships.length > 1) throw new Error('More than one household was found. Please ask for help before editing.');
        const privateRows = await readAll(TABLES.privateProfile, { user_id: current.userId }, ['user_id']);
        if (!stillCurrent()) return snapshot();
        if (!memberships.length) {
          state = { ...emptyState('no-household'), user: state.user, privateProfile: privateRows[0] || null, recovery: state.recovery };
          emit();
          return snapshot();
        }
        const householdId = memberships[0].household_id;
        if (state.household && state.household.id !== householdId) {
          state = { ...emptyState('loading'), user: state.user, recovery: state.recovery };
          emit();
        }
        const [households, members, dietProfiles, budgets, inventory, shoppingItems] = await Promise.all([
          readAll(TABLES.households, { id: householdId }, ['id']),
          readAll(TABLES.members, { household_id: householdId }, ['user_id']),
          readAll(TABLES.dietProfiles, { household_id: householdId }, ['user_id']),
          readAll(TABLES.budgets, { household_id: householdId }, ['month']),
          readAll(TABLES.inventory, { household_id: householdId }, ['id']),
          readAll(TABLES.shoppingItems, { household_id: householdId }, ['id'])
        ]);
        if (!stillCurrent()) return snapshot();
        if (households.length !== 1 || !members.some(member => member.user_id === current.userId)) {
          state = { ...emptyState('no-household'), user: state.user, privateProfile: privateRows[0] || null, recovery: state.recovery };
          emit();
          return snapshot();
        }
        state = { status: 'ready', user: state.user, household: households[0], members,
          privateProfile: privateRows[0] || null, dietProfiles, budgets, inventory, shoppingItems,
          error: '', recovery: state.recovery };
        emit();
        return snapshot();
      } catch (error) {
        if (!stillCurrent()) return snapshot();
        throw fail(error, { clear: true });
      }
    }
    async function init() {
      if (initialPromise) return initialPromise;
      if (subscription && state.user && !suppressAuth) return refresh();
      initialPromise = (async () => {
        try {
          ensureClient();
          authBusy = true;
          if (!subscription) {
            const registered = client.auth.onAuthStateChange(authChanged);
            subscription = registered && registered.data && registered.data.subscription;
          }
          const sessionData = assertResult(await client.auth.getSession());
          if (suppressAuth || destroyed) return snapshot();
          const session = sessionData && sessionData.session;
          if (!session) { clearSession(); return snapshot(); }
          const verified = assertResult(await client.auth.getUser());
          if (suppressAuth || destroyed) return snapshot();
          replaceUser(verified && verified.user);
          authBusy = false;
          if (state.user) return refresh();
          clearSession();
          return snapshot();
        } catch (error) {
          state = { ...emptyState(client ? 'error' : 'unavailable'), error: errorOf(error).message };
          emit();
          return snapshot();
        } finally { authBusy = false; }
      })();
      const pending = initialPromise;
      try { return await pending; }
      finally { if (initialPromise === pending) initialPromise = null; }
    }
    async function signIn(email, password) {
      ensureClient();
      const request = ++authNumber;
      suppressAuth = false;
      authBusy = true;
      generation++;
      state = emptyState('loading');
      emit();
      try {
        const data = assertResult(await client.auth.signInWithPassword({ email: String(email || '').trim(), password }));
        if (request !== authNumber || suppressAuth || destroyed) throw new Error('This sign-in attempt was cancelled.');
        replaceUser(data && (data.user || (data.session && data.session.user)));
        if (!state.user) throw new Error('Sign-in did not return an account. Please try again.');
        authBusy = false;
        await refresh();
        return snapshot();
      } catch (error) {
        if (request === authNumber && !suppressAuth) { state.status = state.user ? 'error' : 'signed-out'; throw fail(error); }
        throw error;
      } finally { if (request === authNumber) authBusy = false; }
    }
    async function signUp(email, password) {
      ensureClient();
      if (typeof password !== 'string' || password.length < 12) throw new Error('Choose a password with at least 12 characters.');
      const request = ++authNumber;
      suppressAuth = false;
      authBusy = true;
      try {
        const redirectTo = options.redirectTo || currentRedirect();
        const data = assertResult(await client.auth.signUp({ email: String(email || '').trim(), password,
          options: redirectTo ? { emailRedirectTo: redirectTo } : {} }));
        if (request !== authNumber || suppressAuth || destroyed) throw new Error('This account request was cancelled.');
        if (data && data.session && data.session.user) {
          replaceUser(data.session.user);
          authBusy = false;
          await refresh();
        }
        return { confirmationRequired: !(data && data.session), user: userSummary(data && data.user) };
      } catch (error) { if (request === authNumber && !suppressAuth) throw fail(error); throw error; }
      finally { if (request === authNumber) authBusy = false; }
    }
    async function resetPassword(email) {
      ensureClient();
      const redirectTo = options.redirectTo || currentRedirect();
      try { assertResult(await client.auth.resetPasswordForEmail(String(email || '').trim(), redirectTo ? { redirectTo } : {})); return true; }
      catch (error) { throw fail(error); }
    }
    async function updatePassword(password) {
      const current = context(false);
      if (typeof password !== 'string' || password.length < 12) throw new Error('Choose a password with at least 12 characters.');
      try {
        assertResult(await client.auth.updateUser({ password }));
        checkContext(current);
        state.recovery = false;
        state.error = '';
        emit();
        return true;
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    async function signOut() {
      suppressAuth = true;
      authNumber++;
      authBusy = false;
      clearSession();
      if (!client) return true;
      try { assertResult(await client.auth.signOut({ scope: 'local' })); return true; }
      catch (error) { throw fail(error); }
      finally {
        try { authStorage.removeItem(storageKey); authStorage.removeItem(storageKey + '-code-verifier'); } catch (_) { /* Memory views are already cleared. */ }
      }
    }
    async function rpc(name, args, householdRequired, reload) {
      const current = context(householdRequired);
      try {
        const data = assertResult(await client.rpc(name, args || {}));
        checkContext(current);
        if (reload !== false) await refresh();
        checkContext(current);
        return data;
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    function createHousehold(name) { return rpc('bloom_create_household', { p_name: String(name || '').trim() }, false); }
    function createInvite() { return rpc('bloom_create_invite', {}, true, false); }
    function joinHousehold(code) { return rpc('bloom_join_household', { p_code: String(code || '').trim() }, false); }
    function removeMember(userId) { return rpc('bloom_remove_member', { p_user_id: userId }, true); }

    function samePayload(saved, payload) {
      return Object.entries(payload).every(([key, value]) => {
        if (value == null) return saved[key] == null;
        if (typeof value === 'number') return saved[key] != null && Number(saved[key]) === value;
        return saved[key] === value;
      });
    }
    async function insertExactlyOnce(table, payload, keys, current) {
      // A form keeps its request_id until success or deliberate discard. Natural
      // profile/budget keys already identify one record. A retry never updates
      // an existing record, because someone else may have edited it meanwhile.
      const conflict = table === TABLES.inventory || table === TABLES.shoppingItems ? 'id' : Object.keys(keys).join(',');
      let rows = assertResult(await client.from(table).upsert({ ...payload, ...keys }, {
        onConflict: conflict, ignoreDuplicates: true
      }).select('*')) || [];
      checkContext(current);
      if (!rows.length) rows = await readAll(table, keys, Object.keys(keys));
      checkContext(current);
      if (rows.length !== 1) throw new Error('The earlier save could not be verified. Refresh Grocery before trying again.');
      if (!samePayload(rows[0], payload)) {
        await refresh();
        checkContext(current);
        const error = new Error('An earlier version of this entry is already saved. Review the saved item and edit it instead of adding it again. Your current form is still here.');
        error.code = 'BLOOM_ALREADY_SAVED';
        throw error;
      }
      return rows;
    }

    async function saveRow(table, row, fields, identity, requiredHousehold) {
      const current = context(requiredHousehold);
      const payload = pick(row, fields);
      const keys = identity(current);
      const existing = row && row.revision != null;
      try {
        let rows;
        if (existing) {
          let query = client.from(table).update(payload);
          for (const [key, value] of Object.entries(keys)) query = query.eq(key, value);
          query = query.eq('revision', revisionOf(row));
          rows = assertResult(await query.select('*'));
        } else rows = await insertExactlyOnce(table, payload, keys, current);
        checkContext(current);
        if (!Array.isArray(rows) || rows.length !== 1) throw new Error('This entry changed or is no longer available. Refresh Grocery, then review your changes and save again.');
        await refresh();
        checkContext(current);
        return clone(rows[0]);
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    function savePrivateProfile(row) {
      return saveRow(TABLES.privateProfile, row, PRIVATE_FIELDS, current => ({ user_id: current.userId }), false);
    }
    function saveDietProfile(row) {
      return saveRow(TABLES.dietProfiles, row, DIET_FIELDS, current => ({ household_id: current.householdId, user_id: current.userId }), true);
    }
    async function saveBudget(row) {
      const month = validMonth(row && row.month);
      if (row.amount_cents == null || row.amount_cents === '' || !Number.isSafeInteger(Number(row.amount_cents)) || Number(row.amount_cents) < 0) throw new Error('Enter a valid budget amount.');
      return saveRow(TABLES.budgets, { ...row, amount_cents: Number(row.amount_cents), currency: 'USD' }, ['amount_cents', 'currency'], current => ({ household_id: current.householdId, month }), true);
    }
    function recordIdentity(row) {
      return current => {
        const keys = { household_id: current.householdId };
        if (row && row.id) keys.id = row.id;
        else if (row && row.revision != null) throw new Error('This saved item is missing its identifier. Refresh Grocery first.');
        else {
          const requestId = row && row.request_id;
          if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
            throw new Error('This new entry needs a fresh form. Clear the form, then enter it again before saving.');
          }
          keys.id = requestId;
        }
        return keys;
      };
    }
    function saveInventory(row) { return saveRow(TABLES.inventory, row, INVENTORY_FIELDS, recordIdentity(row), true); }
    function saveShoppingItem(row) { return saveRow(TABLES.shoppingItems, row, SHOPPING_FIELDS, recordIdentity(row), true); }
    function toggleShoppingItem(row, checked) {
      return saveRow(TABLES.shoppingItems, { id: row.id, revision: row.revision, checked: Boolean(checked) }, ['checked'], recordIdentity(row), true);
    }
    async function deleteRow(table, row) {
      const current = context(true);
      if (!row || !row.id) throw new Error('Choose a saved item to remove.');
      try {
        const rows = assertResult(await client.from(table).delete().eq('household_id', current.householdId)
          .eq('id', row.id).eq('revision', revisionOf(row)).select('id'));
        checkContext(current);
        if (!Array.isArray(rows) || rows.length !== 1) throw new Error('This item changed or was already removed. Refresh Grocery before trying again.');
        await refresh();
        checkContext(current);
        return true;
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    function deleteInventory(row) { return deleteRow(TABLES.inventory, row); }
    function deleteShoppingItem(row) { return deleteRow(TABLES.shoppingItems, row); }
    async function importLocalShopping(items) {
      const current = context(true);
      const rows = importRows(items, current.householdId);
      if (!rows.length) return { imported: 0, alreadyPresent: 0 };
      try {
        const inserted = assertResult(await client.from(TABLES.shoppingItems)
          .upsert(rows, { onConflict: 'household_id,source_key', ignoreDuplicates: true }).select('id')) || [];
        checkContext(current);
        await refresh();
        checkContext(current);
        return { imported: inserted.length, alreadyPresent: rows.length - inserted.length };
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    function destroy() {
      destroyed = true;
      suppressAuth = true;
      generation++;
      requestNumber++;
      if (lastScheduled !== null) clearTimeout(lastScheduled);
      if (subscription && subscription.unsubscribe) subscription.unsubscribe();
      state = emptyState('signed-out');
    }
    return { init, snapshot, refresh, signIn, signUp, resetPassword, updatePassword, signOut,
      createHousehold, createInvite, joinHousehold, removeMember, savePrivateProfile, saveDietProfile,
      saveBudget, saveInventory, deleteInventory, saveShoppingItem, toggleShoppingItem,
      deleteShoppingItem, importLocalShopping, destroy };
  }
  const api = { createStore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomGroceryStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
