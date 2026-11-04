/* Shared Grocery records. Personal device logs never enter this module. */
(function (root) {
  'use strict';

  const TABLES = {
    households: 'bloom_households', members: 'bloom_household_members',
    privateProfile: 'bloom_private_profiles', dietProfiles: 'bloom_diet_profiles',
    budgets: 'bloom_budgets', inventory: 'bloom_inventory', shoppingItems: 'bloom_shopping_items',
    products: 'bloom_products', recurringProducts: 'bloom_recurring_products', receipts: 'bloom_receipts',
    moneyEntries: 'bloom_money_entries', bills: 'bloom_bills', recipes: 'bloom_recipes',
    mealEntries: 'bloom_meal_entries', foodFiles: 'bloom_food_files'
  };
  const PRIVATE_FIELDS = ['display_name', 'age_years', 'height_cm', 'weight_kg', 'activity_level', 'notes'];
  const DIET_FIELDS = ['display_name', 'color', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'allergies', 'restrictions', 'preferences', 'notes'];
  const INVENTORY_FIELDS = ['name', 'brand', 'quantity', 'unit', 'location', 'expires_on', 'notes', 'product_id', 'frozen_on', 'opened_on', 'date_type', 'freezer_use_by', 'reminder_days'];
  const SHOPPING_FIELDS = ['name', 'quantity', 'checked', 'month', 'product_id', 'packs', 'estimate_cents', 'category'];
  const EXTRA_FIELDS = {
    products: ['name','brand','category','aisle','package_quantity','package_unit','item_label','price_cents','price_date','store','source_url','serving_quantity','serving_unit','nutrients','allergens','notes','archived'],
    recurringProducts: ['product_id','person_slot','quantity','basis','every_days','active'],
    bills: ['month','name','amount_cents','variable','due_on','notes'],
    recipes: ['name','servings','ingredients','instructions','source_url','notes','archived'],
    mealEntries: ['occurred_on','person_slot','kind','recipe_id','product_id','servings','label','nutrition_snapshot','notes'],
    foodFiles: ['product_id','recipe_id','name','path','mime_type','size_bytes']
  };
  const EXTRA_LISTS = ['products','recurringProducts','receipts','moneyEntries','bills','recipes','mealEntries','foodFiles'];
  const SHARED_LISTS = ['members','dietProfiles','budgets','inventory','shoppingItems', ...EXTRA_LISTS];
  const PAGE_SIZE = 100;

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function canonical(value) {
    if(Array.isArray(value)) return value.map(canonical);
    if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return value;
  }
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
      dietProfiles: [], budgets: [], inventory: [], shoppingItems: [], ...Object.fromEntries(EXTRA_LISTS.map(key=>[key,[]])),
      error: '', recovery: false, offline: false, cachedAt: null, cacheWarning: '' };
  }
  function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  }
  function defaultStorage() {
    try {
      if (root.localStorage) {
        const key = 'life-in-bloom.grocery.auth.v1';
        const prior = root.sessionStorage && root.sessionStorage.getItem(key);
        if (!root.localStorage.getItem(key) && prior) {
          root.localStorage.setItem(key, prior);
          root.sessionStorage.removeItem(key);
        }
        return root.localStorage;
      }
    } catch (_) { /* A blocked persistent store may still allow this tab. */ }
    try { if (root.sessionStorage) return root.sessionStorage; } catch (_) {}
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
    let cacheStorage = options.cacheStorage;
    if (!cacheStorage) { try { cacheStorage = root.localStorage; } catch (_) {} }
    const cachePrefix = 'life-in-bloom.household-cache.v1.';
    const online = typeof options.isOnline === 'function' ? options.isOnline : () => !root.navigator || root.navigator.onLine !== false;
    const uploads = new Map();
    const signedFiles = new Map();
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
    function saveCache() {
      if (!cacheStorage || state.status !== 'ready' || state.offline || !state.user || !state.household) return;
      const savedAt = new Date().toISOString();
      const value = { version:1, user:state.user, household:state.household, savedAt,
        ...Object.fromEntries(SHARED_LISTS.map(key=>[key,state[key] || []])) };
      try {
        const encoded = JSON.stringify(value);
        if (encoded.length > 4500000) throw new Error('Cache too large');
        cacheStorage.setItem(cachePrefix + state.user.id, encoded);
        cacheStorage.setItem(cachePrefix + 'last-account', state.user.id);
        state.cachedAt = savedAt;
        state.cacheWarning = '';
      } catch (_) { state.cacheWarning = 'Saved online. This device could not update its offline copy; export a backup when connected.'; }
    }
    function clearCache(userId) {
      if (!cacheStorage || !userId) return;
      try {
        cacheStorage.removeItem(cachePrefix + userId);
        if (cacheStorage.getItem(cachePrefix + 'last-account') === userId) cacheStorage.removeItem(cachePrefix + 'last-account');
      } catch (_) {}
    }
    function lastCachedAccount() {
      try { return cacheStorage && cacheStorage.getItem(cachePrefix + 'last-account'); } catch (_) { return null; }
    }
    function restoreCache(user, message) {
      if (!cacheStorage || !user || !user.id) return false;
      try {
        const cached = JSON.parse(cacheStorage.getItem(cachePrefix + user.id) || 'null');
        if (!cached || cached.version !== 1 || cached.user.id !== user.id || !cached.household || !cached.members.some(row=>row.user_id===user.id && row.household_id===cached.household.id)) return false;
        if (!SHARED_LISTS.every(key=>Array.isArray(cached[key]))) return false;
        state = { ...emptyState('ready'), user:userSummary(user), household:cached.household,
          ...Object.fromEntries(SHARED_LISTS.map(key=>[key,cached[key]])), offline:true, cachedAt:cached.savedAt,
          error:message || 'Offline — showing the last saved device copy. Changes remain drafts until you save online.' };
        emit();
        return true;
      } catch (_) { return false; }
    }
    function cachedUserWhenOffline() {
      if (online() || !cacheStorage) return null;
      try {
        const id = cacheStorage.getItem(cachePrefix + 'last-account');
        const cached = id && JSON.parse(cacheStorage.getItem(cachePrefix + id) || 'null');
        const persisted = persistedSessionUser();
        return persisted && persisted.id === id && cached && cached.user && cached.user.id === id ? cached.user : null;
      } catch (_) { return null; }
    }
    function persistedSessionUser() {
      try {
        const saved = JSON.parse(authStorage.getItem(storageKey) || 'null');
        return saved && typeof saved.refresh_token === 'string' && saved.refresh_token && saved.user && typeof saved.user.id === 'string'
          ? userSummary(saved.user) : null;
      } catch (_) { return null; }
    }
    function storageChanged(event) {
      if (destroyed || !state.user) return;
      if (event.key === null || event.key === storageKey) {
        const saved = persistedSessionUser();
        if (!saved || saved.id !== state.user.id) clearSession();
      } else if (event.key === cachePrefix + state.user.id && event.newValue === null) clearSession();
    }
    // Offline startup can precede loading the SDK. Storage events still revoke
    // the visible cached identity when another tab signs out or switches users.
    if (root.addEventListener) root.addEventListener('storage', storageChanged);
    function isNetworkFailure(error) {
      return !online() || Boolean(error && (error.status === 0 || error.code === 'FETCH_ERROR' || /failed to fetch|fetch failed|network|offline|load failed/i.test(error.message || '')));
    }
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
        if (state.user) clearCache(state.user.id);
        signedFiles.clear();
        uploads.clear();
        generation++;
        requestNumber++;
        state = { ...emptyState(status || (next ? 'loading' : 'signed-out')), user: next };
      } else {
        state.user = next;
        if (status) state.status = status;
      }
    }
    function clearSession() {
      clearCache((state.user && state.user.id) || lastCachedAccount());
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
    function requireOnline() {
      if (!online() || state.offline) throw new Error('Your draft is kept on this device. Reconnect and refresh, then save it online. No spending or stock change has been posted.');
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
      if (!online() && restoreCache(state.user)) return snapshot();
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
          clearCache(current.userId);
          state = { ...emptyState('no-household'), user: state.user, privateProfile: privateRows[0] || null, recovery: state.recovery };
          emit();
          return snapshot();
        }
        const householdId = memberships[0].household_id;
        if (state.household && state.household.id !== householdId) {
          state = { ...emptyState('loading'), user: state.user, recovery: state.recovery };
          emit();
        }
        const [households, members, dietProfiles, budgets, inventory, shoppingItems, extra] = await Promise.all([
          readAll(TABLES.households, { id: householdId }, ['id']),
          readAll(TABLES.members, { household_id: householdId }, ['user_id']),
          readAll(TABLES.dietProfiles, { household_id: householdId }, ['user_id']),
          readAll(TABLES.budgets, { household_id: householdId }, ['month']),
          readAll(TABLES.inventory, { household_id: householdId }, ['id']),
          readAll(TABLES.shoppingItems, { household_id: householdId }, ['id']),
          Promise.all(EXTRA_LISTS.map(async key=>[key,await readAll(TABLES[key],{ household_id:householdId },['id'])])).then(Object.fromEntries)
        ]);
        if (!stillCurrent()) return snapshot();
        if (households.length !== 1 || !members.some(member => member.user_id === current.userId)) {
          clearCache(current.userId);
          state = { ...emptyState('no-household'), user: state.user, privateProfile: privateRows[0] || null, recovery: state.recovery };
          emit();
          return snapshot();
        }
        state = { status: 'ready', user: state.user, household: households[0], members,
          privateProfile: privateRows[0] || null, dietProfiles, budgets, inventory, shoppingItems, ...extra,
          error: '', recovery: state.recovery, offline:false, cachedAt:null, cacheWarning:'' };
        saveCache();
        emit();
        return snapshot();
      } catch (error) {
        if (!stillCurrent()) return snapshot();
        if (isNetworkFailure(error) && restoreCache(state.user)) return snapshot();
        throw fail(error, { clear: true });
      }
    }
    async function init() {
      if (initialPromise) return initialPromise;
      if (subscription && state.user && !suppressAuth) return refresh();
      initialPromise = (async () => {
        try {
          const offlineUser = cachedUserWhenOffline();
          if (offlineUser && restoreCache(offlineUser)) return snapshot();
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
      clearCache((state.user && state.user.id) || lastCachedAccount());
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
      signedFiles.clear();
      uploads.clear();
      if (!client) {
        try { authStorage.removeItem(storageKey); if (root.sessionStorage) root.sessionStorage.removeItem(storageKey); } catch (_) {}
        return true;
      }
      try { assertResult(await client.auth.signOut({ scope: 'local' })); return true; }
      catch (error) { throw fail(error); }
      finally {
        try { authStorage.removeItem(storageKey); authStorage.removeItem(storageKey + '-code-verifier'); if (root.sessionStorage) root.sessionStorage.removeItem(storageKey); } catch (_) { /* Memory views are already cleared. */ }
      }
    }
    async function rpc(name, args, householdRequired, reload) {
      requireOnline();
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
        if (typeof value === 'object') return JSON.stringify(canonical(saved[key])) === JSON.stringify(canonical(value));
        return saved[key] === value;
      });
    }
    async function insertExactlyOnce(table, payload, keys, current) {
      // A form keeps its request_id until success or deliberate discard. Natural
      // profile/budget keys already identify one record. A retry never updates
      // an existing record, because someone else may have edited it meanwhile.
      const conflict = Object.hasOwn(keys, 'id') ? 'id' : Object.keys(keys).join(',');
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
      requireOnline();
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
      if (row.household_amount_cents != null && (!Number.isSafeInteger(Number(row.household_amount_cents)) || Number(row.household_amount_cents) < 0)) throw new Error('Enter a valid Household allocation.');
      return saveRow(TABLES.budgets, { ...row, amount_cents: Number(row.amount_cents), currency: 'USD' }, ['amount_cents', 'currency', 'household_amount_cents'], current => ({ household_id: current.householdId, month }), true);
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
      requireOnline();
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
      requireOnline();
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
    function saveExtra(key, row) { return saveRow(TABLES[key], row, EXTRA_FIELDS[key], recordIdentity(row), true); }
    function saveProduct(row) { return saveExtra('products', row); }
    function saveRecurringProduct(row) { return saveExtra('recurringProducts', row); }
    function saveBill(row) { return saveExtra('bills', { ...row, month: validMonth(row.month) }); }
    function saveRecipe(row) { return saveExtra('recipes', row); }
    function saveMealEntry(row) { return saveExtra('mealEntries', row); }
    function deleteMealEntry(row) { return deleteRow(TABLES.mealEntries, row); }
    function recordReceipt(payload) {
      const receipt = pick(payload, ['id','purchased_on','store','payer_slot','notes']);
      receipt.items = Array.isArray(payload && payload.items) ? payload.items.map(item => pick(item,
        ['product_id','name','category','packs','line_total_cents','stock_quantity','stock_unit','location',
          'expires_on','date_type','frozen_on','freezer_use_by','shopping_item_id','shopping_revision'])) : [];
      return rpc('bloom_record_receipt', { p_receipt: clone(receipt) }, true);
    }
    function voidReceipt(id) { return rpc('bloom_void_receipt', { p_receipt_id: id }, true); }
    function recordMoneyEntry(payload) { return rpc('bloom_record_money_entry', { p_entry: clone(pick(payload,
      ['id','occurred_on','direction','category','amount_cents','description','payer_slot','bill_id'])) }, true); }
    function voidMoneyEntry(id) { return rpc('bloom_void_money_entry', { p_entry_id: id }, true); }
    async function saveShoppingItems(items) {
      requireOnline();
      const current = context(true);
      if (!Array.isArray(items) || items.length > 1000) throw new Error('Review up to 1,000 planned items at a time.');
      const seen = new Set();
      const rows = items.map(row => {
        if (typeof row.source_key !== 'string' || !/^(recurring|recipe|manual-plan):[A-Za-z0-9:_-]{1,220}$/.test(row.source_key) || seen.has(row.source_key)) throw new Error('A planned item has an invalid or duplicate source. Review the plan again.');
        seen.add(row.source_key);
        const item = { ...pick(row, SHOPPING_FIELDS), household_id:current.householdId, source_key:row.source_key };
        item.month = validMonth(item.month);
        item.checked = false;
        return item;
      });
      if (!rows.length) return { added:0, alreadyPresent:0 };
      try {
        const saved = assertResult(await client.from(TABLES.shoppingItems).upsert(rows, { onConflict:'household_id,source_key', ignoreDuplicates:true }).select('id')) || [];
        checkContext(current); await refresh(); checkContext(current);
        return { added:saved.length, imported:saved.length, alreadyPresent:rows.length-saved.length };
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    function newUuid() {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
      const bytes = new Uint8Array(16);
      if (!root.crypto || !root.crypto.getRandomValues) throw new Error('Open this app at a secure address to upload files.');
      root.crypto.getRandomValues(bytes); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
      const value=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      return value.slice(0,8)+'-'+value.slice(8,12)+'-'+value.slice(12,16)+'-'+value.slice(16,20)+'-'+value.slice(20);
    }
    async function uploadFoodFile(value) {
      requireOnline();
      const current=context(true), file=value && value.file;
      if (!file || !file.size || file.size > 10*1024*1024 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) throw new Error('Choose a JPG, PNG, WebP, or PDF file up to 10 MB.');
      if (Boolean(value.product_id) === Boolean(value.recipe_id)) throw new Error('Save and select one product or recipe before attaching a file.');
      const list=value.product_id ? state.products : state.recipes;
      const target=value.product_id || value.recipe_id;
      if (!list.some(row=>row.id===target)) throw new Error('This product or recipe is no longer available in the household.');
      const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer()); checkContext(current);
      const magic=file.type==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 :
        file.type==='image/png' ? bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 :
        file.type==='application/pdf' ? String.fromCharCode(...bytes.slice(0,5))==='%PDF-' :
        String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if (!magic) throw new Error('The selected file does not match its image or PDF type. Choose the original file.');
      const key=[current.userId,current.householdId,target,file.name,file.size,file.lastModified].join(':');
      let pending=uploads.get(key);
      if (!pending) {
        const id=newUuid(), ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf' }[file.type];
        pending={ id,path:current.householdId+'/'+id+'.'+ext }; uploads.set(key,pending);
      }
      try {
        const uploaded=await client.storage.from('bloom-food-files').upload(pending.path,file,{ contentType:file.type,upsert:false,cacheControl:'3600' });
        checkContext(current);
        if (uploaded.error && !['409','Duplicate'].includes(String(uploaded.error.statusCode || uploaded.error.code)) && !/already exists|duplicate/i.test(uploaded.error.message || '')) throw errorOf(uploaded.error);
        const saved=await saveExtra('foodFiles',{ id:pending.id,revision:null,product_id:value.product_id || null,recipe_id:value.recipe_id || null,
          name:String(file.name).slice(0,200),path:pending.path,mime_type:file.type,size_bytes:file.size });
        checkContext(current); uploads.delete(key); return saved;
      } catch(error) { if(current.generation===generation) throw fail(error); throw error; }
    }
    async function getFoodFileUrl(row) {
      requireOnline();
      const current=context(true);
      const saved=state.foodFiles.find(item=>item.id===row.id);
      if (!saved || !saved.path.startsWith(current.householdId+'/')) throw new Error('This attachment is no longer available.');
      const prior=signedFiles.get(saved.path);
      if(prior && prior.expires>Date.now()) return prior.url;
      const result=assertResult(await client.storage.from('bloom-food-files').createSignedUrl(saved.path,120));
      checkContext(current);
      if (!result || typeof result.signedUrl!=='string' || !/^https:\/\//.test(result.signedUrl)) throw new Error('The attachment link could not be opened.');
      signedFiles.set(saved.path,{url:result.signedUrl,expires:Date.now()+90000}); return result.signedUrl;
    }
    async function deleteFoodFile(row) {
      requireOnline();
      const current=context(true), saved=state.foodFiles.find(item=>item.id===row.id);
      if(!saved || !saved.path.startsWith(current.householdId+'/')) throw new Error('Refresh the attachment list before removing a file.');
      // Remove the private object before its reference, so a network interruption
      // leaves an identifiable row that can be retried rather than an orphan.
      assertResult(await client.storage.from('bloom-food-files').remove([saved.path]));
      checkContext(current); signedFiles.delete(saved.path);
      return deleteRow(TABLES.foodFiles,row);
    }
    function exportHousehold() {
      if(!state.user || !state.household || state.status!=='ready') throw new Error('Open your household before exporting a backup.');
      return { app:'Life in Bloom Household',version:1,household_id:state.household.id,exported_at:new Date().toISOString(),
        cached_at:state.cachedAt,offline:state.offline,
        data:Object.fromEntries(['products','recurringProducts','budgets','inventory','shoppingItems','bills','recipes','mealEntries','receipts','moneyEntries','foodFiles'].map(key=>[key,clone(state[key] || [])])) };
    }
    function importHouseholdBackup(value) {
      const current=context(true);
      if(!value || value.app!=='Life in Bloom Household' || value.version!==1 || value.household_id!==current.householdId || !value.data) throw new Error('Choose a Life in Bloom Household backup for this same household.');
      const allowed=['products','recurringProducts','budgets','inventory','shoppingItems','bills','recipes','mealEntries','receipts','moneyEntries','foodFiles'];
      if(!allowed.every(key=>Array.isArray(value.data[key]) && value.data[key].length<=10000)) throw new Error('This backup is incomplete or too large. No saved records were changed.');
      return rpc('bloom_restore_household_backup',{p_backup:{app:value.app,version:1,household_id:value.household_id,data:Object.fromEntries(allowed.map(key=>[key,clone(value.data[key])]))}},true);
    }
    function destroy() {
      destroyed = true;
      suppressAuth = true;
      generation++;
      requestNumber++;
      if (lastScheduled !== null) clearTimeout(lastScheduled);
      if (subscription && subscription.unsubscribe) subscription.unsubscribe();
      if (root.removeEventListener) root.removeEventListener('storage', storageChanged);
      state = emptyState('signed-out');
    }
    return { init, snapshot, refresh, signIn, signUp, resetPassword, updatePassword, signOut,
      createHousehold, createInvite, joinHousehold, removeMember, savePrivateProfile, saveDietProfile,
      saveBudget, saveInventory, deleteInventory, saveShoppingItem, toggleShoppingItem,
      deleteShoppingItem, importLocalShopping, saveProduct, saveRecurringProduct, saveBill, saveRecipe,
      saveMealEntry, deleteMealEntry, recordReceipt, voidReceipt, recordMoneyEntry, voidMoneyEntry,
      uploadFoodFile, deleteFoodFile, getFoodFileUrl, saveShoppingItems, exportHousehold, importHouseholdBackup, destroy };
  }
  const api = { createStore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomGroceryStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
