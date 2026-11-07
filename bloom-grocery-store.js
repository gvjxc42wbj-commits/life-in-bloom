/* Household records and account-private practice/smoking records. Device journals stay separate. */
(function (root) {
  'use strict';

  const TABLES = {
    households: 'bloom_households', members: 'bloom_household_members',
    privateProfile: 'bloom_private_profiles', dietProfiles: 'bloom_diet_profiles',
    budgets: 'bloom_budgets', inventory: 'bloom_inventory', shoppingItems: 'bloom_shopping_items',
    products: 'bloom_products', recurringProducts: 'bloom_recurring_products', receipts: 'bloom_receipts',
    moneyEntries: 'bloom_money_entries', bills: 'bloom_bills', billRules: 'bloom_bill_rules', recipes: 'bloom_recipes',
    mealEntries: 'bloom_meal_entries', foodFiles: 'bloom_food_files',
    cookingPlans: 'bloom_cooking_plans', mealShoppingLinks: 'bloom_meal_shopping_links',
    lifeRecords: 'bloom_life_records', dogStockEffects: 'bloom_dog_stock_effects', kitchenEquipment: 'bloom_kitchen_equipment',
    engineeringHomework: 'bloom_engineering_homework', engineeringFiles: 'bloom_engineering_files',
    readingBooks: 'bloom_reading_books', readingSessions: 'bloom_reading_sessions', readingNotes: 'bloom_reading_notes',
    readingVocabulary: 'bloom_reading_vocabulary', readingQuizAttempts: 'bloom_reading_quiz_attempts', readingFiles: 'bloom_reading_files',
    readingPageText: 'bloom_reading_page_text'
  };
  const PRIVATE_FIELDS = ['display_name', 'age_years', 'height_cm', 'weight_kg', 'activity_level', 'notes'];
  const DIET_FIELDS = ['display_name', 'color', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'allergies', 'restrictions', 'preferences', 'notes'];
  const INVENTORY_FIELDS = ['name', 'brand', 'quantity', 'unit', 'location', 'expires_on', 'notes', 'product_id', 'frozen_on', 'opened_on', 'date_type', 'freezer_use_by', 'reminder_days', 'purchase_on', 'servings_remaining', 'stock_level'];
  const SHOPPING_FIELDS = ['name', 'quantity', 'checked', 'month', 'product_id', 'packs', 'estimate_cents', 'category'];
  const EXTRA_FIELDS = {
    products: ['name','brand','category','aisle','package_quantity','package_unit','item_label','price_cents','price_date','store','source_url','serving_quantity','serving_unit','nutrients','allergens','notes','archived','import_id','package_size_text','default_storage_location','icon_id','regular_price_cents','price_status','price_notes','servings_per_package','nutrition_status','source_label','date_added','batch'],
    recurringProducts: ['product_id','person_slot','quantity','basis','every_days','active'],
    bills: ['month','name','amount_cents','variable','due_on','notes'],
    recipes: ['name','servings','ingredients','ingredient_text','instructions','source_url','notes','archived','nutrition_mode','nutrition_reference','nutrition_source','planning_ingredients','tags','equipment','source_key','category_label','time_text','source_name'],
    kitchenEquipment: ['name','brand','model','capabilities','notes','archived'],
    mealEntries: ['occurred_on','person_slot','kind','recipe_id','product_id','servings','label','nutrition_snapshot','notes'],
    foodFiles: ['product_id','recipe_id','name','path','mime_type','size_bytes']
  };
  const EXTRA_LISTS = ['products','recurringProducts','receipts','moneyEntries','bills','billRules','recipes','mealEntries','foodFiles','cookingPlans','mealShoppingLinks','lifeRecords','dogStockEffects','kitchenEquipment','engineeringHomework','engineeringFiles','readingBooks','readingSessions','readingNotes','readingVocabulary','readingQuizAttempts','readingFiles','readingPageText'];
  const LIFE_COLLECTIONS = {
    hydrationSettings:'hydration_settings', hydrationEntries:'hydration_entry',
    skills:'skill', skillSessions:'skill_session', smokingSettings:'smoking_settings', smokingDays:'smoking_day',
    dogProfiles:'dog_profile', dogWeights:'dog_weight', routineTasks:'routine_task', routineLogs:'routine_log',
    dogNotes:'dog_note', dogSupplies:'dog_supply'
  };
  const PRIVATE_LIFE_KINDS = ['skill','skill_session','smoking_settings','smoking_day'];
  const LIFE_FIELDS = {
    hydration_settings:['person_slot','container_ml','goal_ml'],
    hydration_entry:['occurred_on','person_slot','amount_ml','container_ml','notes'],
    skill:['name','category','memory_type','observed_level','notes'],
    skill_session:['skill_id','occurred_on','minutes','result','notes'],
    smoking_settings:['baseline_joints','baseline_cigars','baseline_grams_per_joint','price_per_gram_cents','cigar_price_cents','notes'],
    smoking_day:['occurred_on','joints','cigars','grams_per_joint','trigger_tags','notes'],
    dog_profile:['name','breed','birth_on','notes'], dog_weight:['occurred_on','weight_kg','notes'],
    routine_task:['domain','name','category','frequency','interval_days','interval_months','anchor_on','end_on','times','rolling','active','dose_text','notes'],
    routine_log:['task_id','occurred_on','slot','person_slot','done','notes'],
    dog_note:['occurred_on','kind','minutes','notes'],
    dog_supply:['product_id','name','unit_label','stock_quantity','refill_threshold','needs_refill','reference_price_cents','notes']
  };
  const PLANNING_FIELDS = ['name','quantity','unit','product_id','optional','notes'];
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
    const getNow = typeof options.getNow === 'function' ? options.getNow : () => new Date();
    function currentBillMonth() {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(getNow());
      return parts.find(part => part.type === 'year').value + '-' + parts.find(part => part.type === 'month').value + '-01';
    }
    const uploads = new Map();
    const signedFiles = new Map();
    const signedEngineeringFiles = new Map();
    const signedReadingFiles = new Map();
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

    function snapshot() {
      const result=clone(state);
      result.lifeRecords=(result.lifeRecords || []).filter(row=>row && row.data && typeof row.data==='object' && !Array.isArray(row.data) && result.user && result.household && row.household_id===result.household.id &&
        (PRIVATE_LIFE_KINDS.includes(row.kind) ? row.user_id===result.user.id : row.user_id==null));
      result.dogStockEffects=(result.dogStockEffects || []).filter(row=>row && result.household && row.household_id===result.household.id);
      for(const [collection,kind] of Object.entries(LIFE_COLLECTIONS)) result[collection]=result.lifeRecords.filter(row=>row.kind===kind).map(row=>({
        ...row.data,id:row.id,kind:row.data.kind || row.kind,record_kind:row.kind,revision:row.revision,archived:row.archived===true,user_id:row.user_id,
        household_id:row.household_id,created_at:row.created_at,updated_at:row.updated_at,last_request_id:row.last_request_id
      }));
      return result;
    }
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
    function retainCacheForHousehold(userId, householdId) {
      if (!cacheStorage) return;
      try {
        const cached = JSON.parse(cacheStorage.getItem(cachePrefix + userId) || 'null');
        if (!householdId || (cached && cached.household && cached.household.id !== householdId)) clearCache(userId);
      } catch (_) { clearCache(userId); }
    }
    function restoreCache(user, message, verifiedHouseholdId) {
      if (!cacheStorage || !user || !user.id) return false;
      try {
        const cached = JSON.parse(cacheStorage.getItem(cachePrefix + user.id) || 'null');
        if (!cached || cached.version !== 1 || cached.user.id !== user.id || !cached.household || !cached.members.some(row=>row.user_id===user.id && row.household_id===cached.household.id)) return false;
        if (verifiedHouseholdId !== undefined && cached.household.id !== verifiedHouseholdId) { clearCache(user.id); return false; }
        for (const key of ['billRules','cookingPlans','mealShoppingLinks','lifeRecords','dogStockEffects','engineeringHomework','engineeringFiles','readingBooks','readingSessions','readingNotes','readingVocabulary','readingQuizAttempts','readingFiles','readingPageText']) if (!Object.hasOwn(cached, key)) cached[key] = [];
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
        signedEngineeringFiles.clear();
        signedReadingFiles.clear();
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
      let verifiedHouseholdId;
      const stillCurrent = () => !destroyed && current.generation === generation && request === requestNumber &&
        current.userId === (state.user && state.user.id) && !suppressAuth;
      try {
        if (state.status !== 'ready') { state.status = 'loading'; state.error = ''; emit(); }
        const memberships = await readAll(TABLES.members, { user_id: current.userId }, ['household_id', 'user_id']);
        if (!stillCurrent()) return snapshot();
        verifiedHouseholdId = memberships.length === 1 ? memberships[0].household_id : null;
        // Once membership is verified, a later network failure must never
        // resurrect an offline copy from a household the account has left.
        retainCacheForHousehold(current.userId, verifiedHouseholdId);
        if (state.household && state.household.id !== verifiedHouseholdId) {
          state = { ...emptyState('loading'), user: state.user, recovery: state.recovery };
          emit();
        }
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
        let [households, members, dietProfiles, budgets, inventory, shoppingItems, extra] = await Promise.all([
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
        if (extra.billRules.length) {
          assertResult(await client.rpc('bloom_ensure_bill_month', { p_month: currentBillMonth() }));
          if (!stillCurrent()) return snapshot();
          extra.bills = await readAll(TABLES.bills, { household_id: householdId }, ['id']);
          if (!stillCurrent()) return snapshot();
        }
        if (extra.cookingPlans.length || extra.mealShoppingLinks.length) {
          assertResult(await client.rpc('bloom_reconcile_meal_shopping', {}));
          if (!stillCurrent()) return snapshot();
          const updated = await Promise.all([
            readAll(TABLES.shoppingItems, { household_id: householdId }, ['id']),
            readAll(TABLES.cookingPlans, { household_id: householdId }, ['id']),
            readAll(TABLES.mealShoppingLinks, { household_id: householdId }, ['id'])
          ]);
          if (!stillCurrent()) return snapshot();
          [shoppingItems, extra.cookingPlans, extra.mealShoppingLinks] = updated;
        }
        state = { status: 'ready', user: state.user, household: households[0], members,
          privateProfile: privateRows[0] || null, dietProfiles, budgets, inventory, shoppingItems, ...extra,
          error: '', recovery: state.recovery, offline:false, cachedAt:null, cacheWarning:'' };
        saveCache();
        emit();
        return snapshot();
      } catch (error) {
        if (!stillCurrent()) return snapshot();
        if (isNetworkFailure(error) && restoreCache(state.user, undefined, verifiedHouseholdId)) return snapshot();
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
        if (reload !== false && state.offline) throw new Error('Your save reached the server, but this device could not load the updated records. Reconnect and retry to confirm the save; the same request will not be recorded twice.');
        return data;
      } catch (error) { if (current.generation === generation) throw fail(error); throw error; }
    }
    function createHousehold(name) { return rpc('bloom_create_household', { p_name: String(name || '').trim() }, false); }
    function createInvite() { return rpc('bloom_create_invite', {}, true, false); }
    function joinHousehold(code) { return rpc('bloom_join_household', { p_code: String(code || '').trim() }, false); }
    function removeMember(userId) { return rpc('bloom_remove_member', { p_user_id: userId }, true); }
    function ensureDogDefaultRoutines() { return rpc('bloom_ensure_default_dog_routines', {}, true); }
    async function leaveHousehold() {
      requireOnline();
      const current=context(true);
      try {
        const data=assertResult(await client.rpc('bloom_leave_household', {}));
        checkContext(current);
        clearCache(current.userId);
        await refresh();
        return data;
      } catch(error) {
        if(current.generation===generation) throw fail(error);
        throw error;
      }
    }

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
    function saveBill(row) {
      const bill = { ...pick(row, EXTRA_FIELDS.bills), month: validMonth(row.month) };
      bill.id = row.id || row.request_id || newUuid();
      if (row.id && row.revision != null) bill.revision = revisionOf(row);
      bill.repeat_monthly = row.repeat_monthly === true;
      bill.apply_future = row.apply_future === true;
      return rpc('bloom_save_bill', { p_bill: clone(bill) }, true);
    }
    function ensureBillMonth(value) {
      const month = String(value || '');
      return rpc('bloom_ensure_bill_month', { p_month: validMonth(month.length === 7 ? month + '-01' : month) }, true);
    }
    function stopBillSeries(row, fromMonth) {
      if (!row || !row.series_id) throw new Error('Choose a recurring bill before stopping future repeats.');
      const month = String(fromMonth || '');
      return rpc('bloom_stop_bill_series', { p_series_id: row.series_id, p_from_month: validMonth(month.length === 7 ? month + '-01' : month) }, true);
    }
    function saveRecipe(row) {
      const recipe = { ...row };
      if (Array.isArray(row.planning_ingredients)) recipe.planning_ingredients = row.planning_ingredients.map(line => pick(line, PLANNING_FIELDS));
      return saveExtra('recipes', recipe);
    }
    function saveLifeRecord(kind,row) {
      if(!Object.hasOwn(LIFE_FIELDS,kind)) throw new Error('Choose a supported Life in Bloom record.');
      row=row || {};
      const current=context(true);
      const record={id:row.id || row.request_id || newUuid(),request_id:row.request_id || newUuid(),kind,data:pick(row,LIFE_FIELDS[kind]),
        expected_household_id:current.householdId,expected_user_id:current.userId};
      if(row.id && row.revision!=null) record.revision=revisionOf(row);
      if(Object.hasOwn(row,'archived')) record.archived=row.archived===true;
      return rpc('bloom_save_life_record',{p_record:clone(record)},true);
    }
    function archiveLifeRecord(row,requestId) {
      if(!row || !row.id || !requestId) throw new Error('Open the saved entry before removing it.');
      return rpc('bloom_archive_life_record',{p_id:row.id,p_revision:revisionOf(row),p_request_id:requestId},true);
    }
    function addDogSupplyToShopping(row,options) {
      options=options || {};
      if(!row || !row.id || !options.request_id) throw new Error('Save the dog supply before adding it to Grocery.');
      return rpc('bloom_add_dog_supply_to_shopping',{p_id:row.id,p_request_id:options.request_id,
        p_month:validMonth(options.month),p_packs:Number(options.packs)},true);
    }
    const lifeSavers=Object.fromEntries(Object.entries({
      saveHydrationSettings:'hydration_settings',saveHydrationEntry:'hydration_entry',saveSkill:'skill',saveSkillSession:'skill_session',
      saveSmokingSettings:'smoking_settings',saveSmokingDay:'smoking_day',saveDogProfile:'dog_profile',saveDogWeight:'dog_weight',
      saveRoutineTask:'routine_task',saveRoutineLog:'routine_log',saveDogNote:'dog_note',saveDogSupply:'dog_supply'
    }).map(([name,kind])=>[name,row=>saveLifeRecord(kind,row)]));
    function saveCookingPlan(row) {
      const plan = pick(row, ['recipe_id','recipe_revision','cook_on','meal_type','servings','person1_servings','person2_servings','notes']);
      plan.id = row.id || row.request_id || newUuid();
      plan.request_id = row.request_id || newUuid();
      if (row.id && row.revision != null) plan.revision = revisionOf(row);
      plan.ingredients = Array.isArray(row.ingredients) ? row.ingredients.map(line => pick(line, [...PLANNING_FIELDS, 'included'])) : [];
      return rpc('bloom_save_cooking_plan', { p_plan: clone(plan) }, true);
    }
    function cancelCookingPlan(row, requestId) {
      if (!row || !row.id || !requestId) throw new Error('Open the saved meal plan before cancelling it.');
      return rpc('bloom_cancel_cooking_plan', { p_id: row.id, p_revision: revisionOf(row), p_request_id: requestId }, true);
    }
    function reconcileMealShopping() { return rpc('bloom_reconcile_meal_shopping', {}, true); }
    function importFoodMaster(rows) { if (!Array.isArray(rows) || !rows.length) throw new Error('Choose a reviewed master CSV first.'); return rpc('bloom_import_food_master', { p_rows: clone(rows) }, true); }
    function saveKitchenEquipment(row) { return saveExtra('kitchenEquipment', row); }
    function deleteKitchenEquipment(row) { return deleteRow(TABLES.kitchenEquipment, row); }
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
    async function saveEngineeringHomework(row) {
      requireOnline();
      const current=context(true);
      row=row || {};
      const title=String(row.title || '').trim();
      if (!title || title.length>200) throw new Error('Enter a homework title up to 200 characters.');
      const notes=String(row.notes || '').trim();
      if (notes.length>5000) throw new Error('Homework notes are too long.');
      const due=row.due_on ? String(row.due_on) : null;
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Choose a valid homework due date.');
      const id=row.id || newUuid();
      const payload={id,household_id:current.householdId,user_id:current.userId,title,due_on:due,status:row.status==='done'?'done':'open',notes,updated_at:new Date().toISOString()};
      try {
        const result=assertResult(await client.from(TABLES.engineeringHomework).upsert(payload,{onConflict:'id'}).select('*'));
        checkContext(current);
        if(!Array.isArray(result)||result.length!==1) throw new Error('The homework could not be saved.');
        await refresh(); checkContext(current); return result[0];
      } catch(error){ if(current.generation===generation) throw fail(error); throw error; }
    }
    async function deleteEngineeringHomework(row) {
      requireOnline();
      const current=context(true);
      if(!row||!row.id) throw new Error('Choose saved homework to remove.');
      try {
        const result=assertResult(await client.from(TABLES.engineeringHomework).delete().eq('id',row.id).eq('user_id',current.userId).eq('household_id',current.householdId).select('id'));
        checkContext(current);
        if(!Array.isArray(result)||result.length!==1) throw new Error('That homework changed or was already removed.');
        await refresh(); checkContext(current); return true;
      } catch(error){ if(current.generation===generation) throw fail(error); throw error; }
    }
    async function uploadEngineeringFile(value) {
      requireOnline();
      const current=context(true), file=value&&value.file;
      if(!file||!file.size||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) throw new Error('Choose a JPG, PNG, WebP, or PDF file up to 10 MB.');
      const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer()); checkContext(current);
      const magic=file.type==='image/jpeg' ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 :
        file.type==='image/png' ? bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71 :
        file.type==='application/pdf' ? String.fromCharCode(...bytes.slice(0,5))==='%PDF-' :
        String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(!magic) throw new Error('The selected file does not match its image or PDF type.');
      const id=newUuid(), ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];
      const path=current.userId+'/'+id+'.'+ext;
      try {
        const uploaded=await client.storage.from('bloom-engineering-files').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
        checkContext(current);
        if(uploaded.error) throw errorOf(uploaded.error);
        const meta={id,household_id:current.householdId,user_id:current.userId,homework_id:value&&value.homework_id||null,
          name:String(file.name||'Engineering file').slice(0,240),path,mime_type:file.type,size_bytes:file.size};
        const saved=assertResult(await client.from(TABLES.engineeringFiles).insert(meta).select('*'));
        checkContext(current);
        if(!Array.isArray(saved)||saved.length!==1) throw new Error('The file metadata could not be saved.');
        await refresh(); checkContext(current); return saved[0];
      } catch(error) {
        try { await client.storage.from('bloom-engineering-files').remove([path]); } catch(_) {}
        if(current.generation===generation) throw fail(error);
        throw error;
      }
    }
    async function getEngineeringFileUrl(row) {
      requireOnline();
      const current=context(true);
      const saved=state.engineeringFiles.find(item=>item.id===row.id&&item.user_id===current.userId&&item.household_id===current.householdId);
      if(!saved||!saved.path.startsWith(current.userId+'/')) throw new Error('This Engineering file is no longer available.');
      const prior=signedEngineeringFiles.get(saved.path);
      if(prior&&prior.expires>Date.now()) return prior.url;
      const result=assertResult(await client.storage.from('bloom-engineering-files').createSignedUrl(saved.path,120));
      checkContext(current);
      if(!result||typeof result.signedUrl!=='string'||!/^https:\/\//.test(result.signedUrl)) throw new Error('The Engineering file link could not be opened.');
      signedEngineeringFiles.set(saved.path,{url:result.signedUrl,expires:Date.now()+90000});
      return result.signedUrl;
    }
    async function deleteEngineeringFile(row) {
      requireOnline();
      const current=context(true);
      const saved=state.engineeringFiles.find(item=>item.id===row.id&&item.user_id===current.userId&&item.household_id===current.householdId);
      if(!saved||!saved.path.startsWith(current.userId+'/')) throw new Error('Refresh the Engineering files before removing one.');
      assertResult(await client.storage.from('bloom-engineering-files').remove([saved.path]));
      checkContext(current); signedEngineeringFiles.delete(saved.path);
      const deleted=assertResult(await client.from(TABLES.engineeringFiles).delete().eq('id',saved.id).eq('user_id',current.userId).select('id'));
      if(!Array.isArray(deleted)||deleted.length!==1) throw new Error('The Engineering file record could not be removed.');
      await refresh(); checkContext(current); return true;
    }
    async function ensureReadingStarterBooks() {
      requireOnline();
      const current=context(true);
      const starters=[
        {title:'Cold Sassy Tree',author:'Olive Ann Burns'},
        {title:'The Book Thief',author:'Markus Zusak'},
        {title:'Fever 1793',author:'Laurie Halse Anderson'}
      ];
      const rows=starters.map(item=>({id:newUuid(),household_id:current.householdId,user_id:current.userId,title:item.title,author:item.author,status:'not_started',isbn:'',edition:'',current_section:'',cover_url:'',notes:''}));
      try{
        assertResult(await client.from(TABLES.readingBooks).upsert(rows,{onConflict:'user_id,household_id,title,author',ignoreDuplicates:true}));
        checkContext(current); await refresh(); checkContext(current); return true;
      }catch(error){if(current.generation===generation)throw fail(error);throw error;}
    }
    async function saveReadingBook(row){
      requireOnline(); const current=context(true); row=row||{};
      const title=String(row.title||'').trim(),author=String(row.author||'').trim();
      if(!title||title.length>240)throw new Error('Enter a book title up to 240 characters.');
      if(author.length>240)throw new Error('Author is too long.');
      const total=row.total_pages==null||row.total_pages===''?null:Number(row.total_pages);
      const page=row.current_page==null||row.current_page===''?null:Number(row.current_page);
      if(total!=null&&(!Number.isInteger(total)||total<1||total>10000))throw new Error('Total pages must be a whole number from 1 to 10,000.');
      if(page!=null&&(!Number.isInteger(page)||page<0||page>10000))throw new Error('Current page must be a whole number from 0 to 10,000.');
      if(total!=null&&page!=null&&page>total)throw new Error('Current page cannot be greater than total pages.');
      const payload={id:row.id||newUuid(),household_id:current.householdId,user_id:current.userId,title,author,isbn:String(row.isbn||'').trim().slice(0,40),
        edition:String(row.edition||'').trim().slice(0,240),total_pages:total,current_page:page,current_section:String(row.current_section||'').trim().slice(0,240),
        status:['not_started','reading','completed','archived'].includes(row.status)?row.status:'not_started',started_on:row.started_on||null,completed_on:row.completed_on||null,
        cover_url:String(row.cover_url||'').trim().slice(0,1000),notes:String(row.notes||'').trim().slice(0,5000),updated_at:new Date().toISOString()};
      try{
        const data=assertResult(await client.from(TABLES.readingBooks).upsert(payload,{onConflict:'id'}).select('*'));
        checkContext(current); if(!Array.isArray(data)||data.length!==1)throw new Error('The book could not be saved.');
        await refresh();checkContext(current);return data[0];
      }catch(error){if(current.generation===generation)throw fail(error);throw error;}
    }
    async function saveReadingSession(row){
      requireOnline(); const current=context(true);
      if(!row||!row.book_id||!state.readingBooks.some(b=>b.id===row.book_id&&b.user_id===current.userId))throw new Error('Choose one of your saved books.');
      const minutes=Number(row.minutes||0),start=row.start_page===''||row.start_page==null?null:Number(row.start_page),end=row.end_page===''||row.end_page==null?null:Number(row.end_page);
      if(!Number.isInteger(minutes)||minutes<0||minutes>1440)throw new Error('Reading minutes must be a whole number from 0 to 1,440.');
      for(const [value,label] of [[start,'Start page'],[end,'End page']])if(value!=null&&(!Number.isInteger(value)||value<0||value>10000))throw new Error(label+' must be a whole number.');
      if(start!=null&&end!=null&&end<start)throw new Error('End page cannot be before start page.');
      const payload={id:row.id||newUuid(),household_id:current.householdId,user_id:current.userId,book_id:row.book_id,occurred_on:row.occurred_on,
        minutes,start_page:start,end_page:end,section:String(row.section||'').slice(0,240),notes:String(row.notes||'').slice(0,5000)};
      try{
        const data=assertResult(await client.from(TABLES.readingSessions).upsert(payload,{onConflict:'id'}).select('*'));
        checkContext(current); if(end!=null){const book=state.readingBooks.find(b=>b.id===row.book_id);if(book)await saveReadingBook({...book,current_page:end,status:'reading',started_on:book.started_on||row.occurred_on});}
        else await refresh();
        return data&&data[0];
      }catch(error){if(current.generation===generation)throw fail(error);throw error;}
    }
    async function saveReadingNote(row){
      requireOnline(); const current=context(true);
      if(!row||!row.book_id)throw new Error('Choose a book.');
      const body=String(row.body||'').trim();if(!body||body.length>8000)throw new Error('Enter a note up to 8,000 characters.');
      const payload={id:row.id||newUuid(),household_id:current.householdId,user_id:current.userId,book_id:row.book_id,
        page_number:row.page_number===''||row.page_number==null?null:Number(row.page_number),section:String(row.section||'').slice(0,240),
        note_type:['note','quote','question','character','theme'].includes(row.note_type)?row.note_type:'note',body,updated_at:new Date().toISOString()};
      const data=assertResult(await client.from(TABLES.readingNotes).upsert(payload,{onConflict:'id'}).select('*'));checkContext(current);await refresh();return data&&data[0];
    }
    async function saveReadingVocabulary(row){
      requireOnline(); const current=context(true);
      if(!row||!row.book_id)throw new Error('Choose a book.');
      const word=String(row.word||'').trim();if(!word||word.length>120)throw new Error('Enter a vocabulary word.');
      const payload={id:row.id||newUuid(),household_id:current.householdId,user_id:current.userId,book_id:row.book_id,word,
        part_of_speech:String(row.part_of_speech||'').slice(0,60),definition:String(row.definition||'').slice(0,1000),example_sentence:String(row.example_sentence||'').slice(0,1200),
        source_label:['coach_suggested','confirmed_from_book','manual'].includes(row.source_label)?row.source_label:'manual',
        page_number:row.page_number===''||row.page_number==null?null:Number(row.page_number),section:String(row.section||'').slice(0,240),
        spelling_enabled:row.spelling_enabled===true,correct_count:Number(row.correct_count||0),incorrect_count:Number(row.incorrect_count||0),last_practised_on:row.last_practised_on||null};
      const data=assertResult(await client.from(TABLES.readingVocabulary).upsert(payload,{onConflict:'id'}).select('*'));checkContext(current);await refresh();return data&&data[0];
    }
    async function saveReadingQuizAttempt(row){
      requireOnline(); const current=context(true);
      const payload={id:row.id||newUuid(),household_id:current.householdId,user_id:current.userId,book_id:row.book_id,scope_label:String(row.scope_label||'').slice(0,240),
        score:row.score==null?null:Number(row.score),total_questions:Number(row.total_questions||0),correct_questions:Number(row.correct_questions||0),answers:Array.isArray(row.answers)?row.answers:[]};
      const data=assertResult(await client.from(TABLES.readingQuizAttempts).insert(payload).select('*'));checkContext(current);await refresh();return data&&data[0];
    }
    async function uploadReadingFile(value){
      requireOnline();const current=context(true),file=value&&value.file;
      if(!file||!file.size||file.size>75*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw new Error('Choose a JPG, PNG, WebP, or PDF up to 75 MB.');
      if(value.book_id&&!state.readingBooks.some(b=>b.id===value.book_id&&b.user_id===current.userId))throw new Error('Choose a saved book first.');
      const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());checkContext(current);
      const magic=file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:file.type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:
        file.type==='application/pdf'?String.fromCharCode(...bytes.slice(0,5))==='%PDF-':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(!magic)throw new Error('The selected file does not match its file type.');
      const id=newUuid(),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type],path=current.userId+'/'+id+'.'+ext;
      const uploaded=await client.storage.from('bloom-reading-files').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});if(uploaded.error)throw errorOf(uploaded.error);
      checkContext(current);
      try{
        const meta={id,household_id:current.householdId,user_id:current.userId,book_id:value.book_id||null,name:String(file.name||'Reading scan').slice(0,240),path,mime_type:file.type,size_bytes:file.size,
          page_from:value.page_from===''||value.page_from==null?null:Number(value.page_from),page_to:value.page_to===''||value.page_to==null?null:Number(value.page_to),section:String(value.section||'').slice(0,240),
          file_role:value.file_role==='book_pdf'?'book_pdf':'scan',page_count:value.page_count==null?null:Number(value.page_count)};
        const saved=assertResult(await client.from(TABLES.readingFiles).insert(meta).select('*'));checkContext(current);await refresh();return saved&&saved[0];
      }catch(error){try{await client.storage.from('bloom-reading-files').remove([path]);}catch(_){ }throw error;}
    }
    async function getReadingFileUrl(row){
      requireOnline();const current=context(true),saved=state.readingFiles.find(item=>item.id===row.id&&item.user_id===current.userId&&item.household_id===current.householdId);
      if(!saved||!saved.path.startsWith(current.userId+'/'))throw new Error('This reading file is not available.');
      const prior=signedReadingFiles.get(saved.path);if(prior&&prior.expires>Date.now())return prior.url;
      const result=assertResult(await client.storage.from('bloom-reading-files').createSignedUrl(saved.path,120));checkContext(current);
      signedReadingFiles.set(saved.path,{url:result.signedUrl,expires:Date.now()+90000});return result.signedUrl;
    }
    async function deleteReadingRow(key,row){
      requireOnline();const current=context(true);if(!row||!row.id)throw new Error('Choose a saved reading record.');
      const result=assertResult(await client.from(TABLES[key]).delete().eq('id',row.id).eq('user_id',current.userId).eq('household_id',current.householdId).select('id'));
      if(!Array.isArray(result)||result.length!==1)throw new Error('That reading record changed or was already removed.');await refresh();return true;
    }
    async function saveReadingPageText(row){
      requireOnline(); const current=context(true);
      if(!row||!row.book_id||!row.file_id)throw new Error('Choose a saved book PDF.');
      const page=Number(row.page_number);if(!Number.isInteger(page)||page<1||page>20000)throw new Error('Choose a valid PDF page.');
      const method=row.extraction_method==='ocr'?'ocr':'text_layer',raw=String(row.raw_text||''),verifiedText=String(row.verified_text||'');
      if(raw.length>100000||verifiedText.length>100000)throw new Error('This page text is too large to save.');
      const existing=(state.readingPageText||[]).find(item=>item.file_id===row.file_id&&Number(item.page_number)===page&&item.user_id===current.userId);
      const payload={id:existing&&existing.id||row.id||newUuid(),household_id:current.householdId,user_id:current.userId,book_id:row.book_id,file_id:row.file_id,
        page_number:page,extraction_method:method,raw_text:raw,verified_text:verifiedText,verified:row.verified===true,char_count:raw.length,updated_at:new Date().toISOString()};
      const data=assertResult(await client.from(TABLES.readingPageText).upsert(payload,{onConflict:'user_id,household_id,file_id,page_number'}).select('*'));
      checkContext(current);await refresh();checkContext(current);return data&&data[0];
    }
    async function deleteReadingPageText(row){ return deleteReadingRow('readingPageText',row); }
    function exportReadingRecords() {
      if(!state.user||!state.household||state.status!=='ready') throw new Error('Sign in before exporting Reading in Bloom.');
      const keys=['readingBooks','readingSessions','readingNotes','readingVocabulary','readingQuizAttempts'];
      return {app:'Life in Bloom Reading',version:1,user_id:state.user.id,household_id:state.household.id,exported_at:new Date().toISOString(),
        data:Object.fromEntries(keys.map(key=>[key,clone((state[key]||[]).filter(row=>row.user_id===state.user.id&&row.household_id===state.household.id))]))};
    }
    async function importReadingRecords(value) {
      requireOnline(); const current=context(true);
      if(!value||value.app!=='Life in Bloom Reading'||value.version!==1||value.user_id!==current.userId||value.household_id!==current.householdId||!value.data) throw new Error('Choose a Reading in Bloom backup from this same account and household.');
      const mapping={readingBooks:TABLES.readingBooks,readingSessions:TABLES.readingSessions,readingNotes:TABLES.readingNotes,readingVocabulary:TABLES.readingVocabulary,readingQuizAttempts:TABLES.readingQuizAttempts};
      for(const key of Object.keys(mapping)){
        const rows=value.data[key]; if(!Array.isArray(rows)||rows.length>10000) throw new Error('This Reading backup is incomplete or too large.');
        if(rows.some(row=>!row||row.user_id!==current.userId||row.household_id!==current.householdId)) throw new Error('The Reading backup contains records from another account or household.');
      }
      try{
        for(const [key,table] of Object.entries(mapping)){
          const rows=value.data[key]; if(rows.length) assertResult(await client.from(table).upsert(rows,{onConflict:'id'}));
          checkContext(current);
        }
        await refresh();checkContext(current);return true;
      }catch(error){if(current.generation===generation)throw fail(error);throw error;}
    }
    function exportHousehold() {
      if(!state.user || !state.household || state.status!=='ready') throw new Error('Open your household before exporting a backup.');
      return { app:'Life in Bloom Household',version:1,household_id:state.household.id,exported_at:new Date().toISOString(),
        cached_at:state.cachedAt,offline:state.offline,
        data:{...Object.fromEntries(['products','recurringProducts','budgets','inventory','shoppingItems','bills','billRules','recipes','mealEntries','receipts','moneyEntries','foodFiles','cookingPlans','mealShoppingLinks','dogStockEffects'].map(key=>[key,clone(state[key] || [])])),
          lifeRecords:clone((state.lifeRecords || []).filter(row=>row.household_id===state.household.id && row.user_id==null && !PRIVATE_LIFE_KINDS.includes(row.kind)))} };
    }
    function importHouseholdBackup(value) {
      const current=context(true);
      if(!value || value.app!=='Life in Bloom Household' || value.version!==1 || value.household_id!==current.householdId || !value.data) throw new Error('Choose a Life in Bloom Household backup for this same household.');
      const allowed=['products','recurringProducts','budgets','inventory','shoppingItems','bills','recipes','mealEntries','receipts','moneyEntries','foodFiles'];
      if(!allowed.every(key=>Array.isArray(value.data[key]) && value.data[key].length<=10000)) throw new Error('This backup is incomplete or too large. No saved records were changed.');
      const optional = ['billRules','cookingPlans','mealShoppingLinks','lifeRecords','dogStockEffects'];
      if(optional.some(key => value.data[key] != null && (!Array.isArray(value.data[key]) || value.data[key].length>10000))) throw new Error('This backup has invalid optional records. No saved records were changed.');
      return rpc('bloom_restore_household_backup',{p_backup:{app:value.app,version:1,household_id:value.household_id,data:{...Object.fromEntries([...allowed,...optional].map(key=>[key,clone(value.data[key] || [])]))}}},true);
    }
    function exportPersonalLifeRecords() {
      if(!state.user || !state.household || state.status!=='ready') throw new Error('Sign in before exporting your practice and smoking records.');
      return {app:'Life in Bloom Personal Practice',version:1,user_id:state.user.id,household_id:state.household.id,
        exported_at:new Date().toISOString(),records:clone((state.lifeRecords || []).filter(row=>
          row.household_id===state.household.id && row.user_id===state.user.id && PRIVATE_LIFE_KINDS.includes(row.kind)))};
    }
    function importPersonalLifeRecords(value) {
      const current=context(true);
      if(!value || value.app!=='Life in Bloom Personal Practice' || value.version!==1 || value.user_id!==current.userId ||
        value.household_id!==current.householdId || !Array.isArray(value.records) || value.records.length>10000 ||
        value.records.some(row=>!row || row.user_id!==current.userId || row.household_id!==current.householdId || !PRIVATE_LIFE_KINDS.includes(row.kind))) {
        throw new Error('Choose a practice and smoking backup for your own signed-in account and household.');
      }
      return rpc('bloom_restore_personal_life_backup',{p_backup:{app:value.app,version:1,user_id:value.user_id,household_id:value.household_id,records:clone(value.records)}},true);
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
      createHousehold, createInvite, joinHousehold, removeMember, leaveHousehold, ensureDogDefaultRoutines, savePrivateProfile, saveDietProfile,
      saveBudget, saveInventory, deleteInventory, saveShoppingItem, toggleShoppingItem,
      deleteShoppingItem, importLocalShopping, saveProduct, saveRecurringProduct, saveBill, ensureBillMonth, stopBillSeries, saveRecipe,
      saveMealEntry, deleteMealEntry, saveCookingPlan, cancelCookingPlan, reconcileMealShopping, importFoodMaster, saveKitchenEquipment, deleteKitchenEquipment, recordReceipt, voidReceipt, recordMoneyEntry, voidMoneyEntry,
      ...lifeSavers,saveLifeRecord,archiveLifeRecord,addDogSupplyToShopping,exportPersonalLifeRecords,importPersonalLifeRecords,
      uploadFoodFile, deleteFoodFile, getFoodFileUrl, saveEngineeringHomework, deleteEngineeringHomework, uploadEngineeringFile, getEngineeringFileUrl, deleteEngineeringFile,
      ensureReadingStarterBooks, saveReadingBook, saveReadingSession, saveReadingNote, saveReadingVocabulary, saveReadingQuizAttempt, uploadReadingFile, getReadingFileUrl, deleteReadingRow, saveReadingPageText, deleteReadingPageText, exportReadingRecords, importReadingRecords,
      saveShoppingItems, exportHousehold, importHouseholdBackup, destroy };
  }
  const api = { createStore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BloomGroceryStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
