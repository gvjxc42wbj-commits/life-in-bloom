-- Life in Bloom: connected product, receipt, inventory, recipe and money records.
-- Reviewed hosted migration. No household data, account details or example prices.

create function bloom_private.food_object_keys_ok(value jsonb, allowed text[])
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare k text;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(value) loop
    if not (k = any(allowed)) then return false; end if;
  end loop;
  return true;
end;
$$;

create function bloom_private.food_valid_nutrients(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item record;
begin
  if not bloom_private.food_object_keys_ok(value, array['calories_kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','calcium_mg','iron_mg','potassium_mg','vitamin_d_mcg','fluid_ml']) then return false; end if;
  for item in select key, val from jsonb_each(value) as x(key,val) loop
    if item.val <> 'null'::jsonb and (jsonb_typeof(item.val) <> 'number' or (item.val::text)::numeric < 0 or (item.val::text)::numeric > 1000000000) then return false; end if;
  end loop;
  return true;
end;
$$;

create function bloom_private.food_valid_snapshot(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or not bloom_private.food_valid_nutrients(value->'values')
    or jsonb_typeof(value->'complete') is distinct from 'boolean' then return false; end if;
  if not bloom_private.food_object_keys_ok(value->'missing', array['calories_kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','calcium_mg','iron_mg','potassium_mg','vitamin_d_mcg','fluid_ml']) then return false; end if;
  for item in select val from jsonb_each(value->'missing') as x(key,val) loop
    if jsonb_typeof(item.val) <> 'number' or (item.val::text)::numeric < 0 or (item.val::text)::numeric > 1000000
      or trunc((item.val::text)::numeric) <> (item.val::text)::numeric then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.bloom_products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  brand text not null default '' check (char_length(brand) <= 120),
  category text not null default 'food' check (category in ('food','household')),
  aisle text not null default 'other' check (aisle in ('produce','meat','seafood','deli','dairy-eggs','beverages','bakery','frozen','grains','baking','condiments','canned','breakfast','snacks','household','other')),
  package_quantity numeric not null check (package_quantity > 0 and package_quantity <= 1000000000),
  package_unit text not null check (package_unit in ('each','g','kg','oz','lb','ml','l','fl_oz','cup','tbsp','tsp')),
  item_label text not null default 'each' check (char_length(item_label) between 1 and 80),
  price_cents bigint check (price_cents between 0 and 1000000000),
  price_date date check (isfinite(price_date)),
  store text not null default '' check (char_length(store) <= 160),
  source_url text not null default '' check (char_length(source_url) <= 2048 and (source_url = '' or source_url ~* '^https?://')),
  serving_quantity numeric check (serving_quantity > 0 and serving_quantity <= 1000000000),
  serving_unit text not null default 'each' check (serving_unit in ('each','g','kg','oz','lb','ml','l','fl_oz','cup','tbsp','tsp')),
  nutrients jsonb not null default '{}' check (bloom_private.food_valid_nutrients(nutrients)),
  allergens text not null default '' check (char_length(allergens) <= 4000),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id)
);

create table public.bloom_recurring_products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  product_id uuid not null,
  person_slot integer check (person_slot in (1,2)),
  quantity numeric not null check (quantity > 0 and quantity <= 1000000000),
  basis text not null check (basis in ('units','packs')),
  every_days numeric not null check (every_days > 0 and every_days <= 3660),
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id,product_id) references public.bloom_products(household_id,id)
);
create index bloom_recurring_product_idx on public.bloom_recurring_products(household_id,product_id);

create table public.bloom_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  month date not null check (isfinite(month) and extract(day from month) = 1),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  amount_cents bigint check (amount_cents between 0 and 1000000000),
  variable boolean not null default false,
  due_on date check (isfinite(due_on)),
  notes text not null default '' check (char_length(notes) <= 4000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id)
);
create index bloom_bills_month_idx on public.bloom_bills(household_id,month);

create table public.bloom_receipts (
  id uuid primary key,
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  purchased_on date not null check (isfinite(purchased_on)),
  store text not null default '' check (char_length(store) <= 160),
  payer_slot integer check (payer_slot in (1,2)),
  notes text not null default '' check (char_length(notes) <= 4000),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 500),
  total_cents bigint not null check (total_cents between 0 and 1000000000),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  inventory_effects jsonb not null default '[]' check (jsonb_typeof(inventory_effects) = 'array'),
  shopping_effects jsonb not null default '[]' check (jsonb_typeof(shopping_effects) = 'array'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  unique (household_id,id)
);
create index bloom_receipts_date_idx on public.bloom_receipts(household_id,purchased_on);

create table public.bloom_money_entries (
  id uuid primary key,
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  occurred_on date not null check (isfinite(occurred_on)),
  direction text not null check (direction in ('income','expense')),
  category text not null check (category in ('food','household','bill','other')),
  amount_cents bigint not null check (amount_cents between 0 and 1000000000),
  description text not null default '' check (char_length(description) <= 4000),
  payer_slot integer check (payer_slot in (1,2)),
  receipt_id uuid,
  bill_id uuid,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  foreign key (household_id,receipt_id) references public.bloom_receipts(household_id,id),
  foreign key (household_id,bill_id) references public.bloom_bills(household_id,id),
  check (receipt_id is null or (direction = 'expense' and category in ('food','household') and bill_id is null)),
  check (bill_id is null or (direction = 'expense' and category = 'bill' and receipt_id is null)),
  unique (household_id,receipt_id,category)
);
create index bloom_money_date_idx on public.bloom_money_entries(household_id,occurred_on);
create index bloom_money_bill_idx on public.bloom_money_entries(household_id,bill_id);
create unique index bloom_money_active_bill_idx on public.bloom_money_entries(bill_id) where bill_id is not null and voided_at is null;

create table public.bloom_recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  servings numeric not null check (servings > 0 and servings <= 10000),
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) <= 500),
  instructions text not null default '' check (char_length(instructions) <= 20000),
  source_url text not null default '' check (char_length(source_url) <= 2048 and (source_url = '' or source_url ~* '^https?://')),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id)
);

create table public.bloom_meal_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  occurred_on date not null check (isfinite(occurred_on)),
  person_slot integer not null check (person_slot in (1,2)),
  kind text not null check (kind in ('planned','eaten')),
  recipe_id uuid,
  product_id uuid,
  servings numeric not null check (servings > 0 and servings <= 10000),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  nutrition_snapshot jsonb not null check (bloom_private.food_valid_snapshot(nutrition_snapshot)),
  notes text not null default '' check (char_length(notes) <= 4000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((recipe_id is not null)::integer + (product_id is not null)::integer = 1),
  foreign key (household_id,recipe_id) references public.bloom_recipes(household_id,id),
  foreign key (household_id,product_id) references public.bloom_products(household_id,id)
);
create index bloom_meals_recipe_idx on public.bloom_meal_entries(household_id,recipe_id);
create index bloom_meals_product_idx on public.bloom_meal_entries(household_id,product_id);
create index bloom_meals_date_person_idx on public.bloom_meal_entries(household_id,occurred_on,person_slot,kind);

create table public.bloom_food_files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  product_id uuid,
  recipe_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 255),
  path text not null unique check (char_length(path) <= 120),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((product_id is not null)::integer + (recipe_id is not null)::integer = 1),
  check (split_part(path,'/',1) = household_id::text),
  check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$'),
  foreign key (household_id,product_id) references public.bloom_products(household_id,id),
  foreign key (household_id,recipe_id) references public.bloom_recipes(household_id,id)
);
create index bloom_food_files_product_idx on public.bloom_food_files(household_id,product_id);
create index bloom_food_files_recipe_idx on public.bloom_food_files(household_id,recipe_id);

alter table public.bloom_inventory
  add column product_id uuid,
  add column frozen_on date check (isfinite(frozen_on)),
  add column opened_on date check (isfinite(opened_on)),
  add column date_type text not null default 'unknown' check (date_type in ('best_before','use_by','sell_by','expiry','unknown')),
  add column freezer_use_by date check (isfinite(freezer_use_by)),
  add column reminder_days integer not null default 3 check (reminder_days between 0 and 30),
  add column receipt_id uuid,
  add foreign key (household_id,product_id) references public.bloom_products(household_id,id),
  add foreign key (household_id,receipt_id) references public.bloom_receipts(household_id,id),
  add check (freezer_use_by is null or frozen_on is null or freezer_use_by >= frozen_on);
create index bloom_inventory_product_idx on public.bloom_inventory(household_id,product_id);
create index bloom_inventory_receipt_idx on public.bloom_inventory(household_id,receipt_id);

alter table public.bloom_shopping_items
  add column month date,
  add column product_id uuid,
  add column packs numeric check (packs > 0 and packs <= 1000000000),
  add column estimate_cents bigint check (estimate_cents between 0 and 1000000000),
  add column category text not null default 'food' check (category in ('food','household')),
  add foreign key (household_id,product_id) references public.bloom_products(household_id,id);
update public.bloom_shopping_items
set month = date_trunc('month',created_at at time zone 'America/New_York')::date
where month is null;
alter table public.bloom_shopping_items
  alter column month set not null,
  alter column month set default (date_trunc('month',now() at time zone 'America/New_York')::date),
  add check (isfinite(month) and extract(day from month) = 1);
create index bloom_shopping_product_idx on public.bloom_shopping_items(household_id,product_id);
create index bloom_shopping_month_idx on public.bloom_shopping_items(household_id,month);

alter table public.bloom_budgets add column household_amount_cents bigint check (household_amount_cents between 0 and 1000000000);

-- Receipt provenance cannot be attached or reassigned by a direct browser write.
drop trigger bloom_inventory_revision on public.bloom_inventory;
create trigger bloom_inventory_revision before insert or update on public.bloom_inventory
for each row execute function bloom_private.guard_revision('id','household_id','created_by','created_at','receipt_id');
drop policy inventory_insert on public.bloom_inventory;
create policy inventory_insert on public.bloom_inventory for insert to authenticated
with check (bloom_private.is_member(household_id) and created_by = (select auth.uid()) and receipt_id is null);

create function bloom_private.food_validate_relations()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare ingredient jsonb; product uuid; q numeric;
begin
  if TG_TABLE_NAME = 'bloom_recipes' then
    for ingredient in select value from jsonb_array_elements(NEW.ingredients) loop
      if not bloom_private.food_object_keys_ok(ingredient,array['product_id','quantity','unit'])
        or jsonb_typeof(ingredient->'quantity') <> 'number' then
        raise exception 'Each recipe ingredient needs a product, a quantity and a unit.' using errcode = '22023';
      end if;
      product := (ingredient->>'product_id')::uuid;
      q := (ingredient->>'quantity')::numeric;
      if product is null or q is null or q <= 0 or q > 1000000000
        or coalesce(ingredient->>'unit','') not in ('each','g','kg','oz','lb','ml','l','fl_oz','cup','tbsp','tsp') then
        raise exception 'An ingredient has an invalid quantity or unit.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.bloom_products p where p.id=product and p.household_id=NEW.household_id and p.category='food') then
        raise exception 'Recipe ingredients must use food products from this household.' using errcode = '23514';
      end if;
    end loop;
  elsif TG_TABLE_NAME = 'bloom_meal_entries' and NEW.product_id is not null then
    if not exists (select 1 from public.bloom_products p where p.id=NEW.product_id and p.household_id=NEW.household_id and p.category='food') then
      raise exception 'Food logs must use a food product from this household.' using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger bloom_recipe_ingredients before insert or update on public.bloom_recipes
for each row execute function bloom_private.food_validate_relations();
create trigger bloom_meal_food before insert or update on public.bloom_meal_entries
for each row execute function bloom_private.food_validate_relations();

create trigger bloom_product_revision before insert or update on public.bloom_products
for each row execute function bloom_private.guard_revision('id','household_id','created_at');
create trigger bloom_recurring_revision before insert or update on public.bloom_recurring_products
for each row execute function bloom_private.guard_revision('id','household_id','created_at');
create trigger bloom_bill_revision before insert or update on public.bloom_bills
for each row execute function bloom_private.guard_revision('id','household_id','month','created_at');
create trigger bloom_recipe_revision before insert or update on public.bloom_recipes
for each row execute function bloom_private.guard_revision('id','household_id','created_at');
create trigger bloom_meal_revision before insert or update on public.bloom_meal_entries
for each row execute function bloom_private.guard_revision('id','household_id','created_at');
create trigger bloom_food_file_revision before insert or update on public.bloom_food_files
for each row execute function bloom_private.guard_revision('id','household_id','path','created_at');

-- Products/recipes are archived rather than deleted, preserving past references.
do $$ declare t text; begin
  foreach t in array array['bloom_products','bloom_recurring_products','bloom_bills','bloom_recipes','bloom_meal_entries','bloom_food_files'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select, insert, update on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (bloom_private.is_member(household_id))',t||'_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (bloom_private.is_member(household_id))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (bloom_private.is_member(household_id)) with check (bloom_private.is_member(household_id))',t||'_update',t);
  end loop;
  foreach t in array array['bloom_meal_entries','bloom_food_files'] loop
    execute format('grant delete on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for delete to authenticated using (bloom_private.is_member(household_id))',t||'_delete',t);
  end loop;
  foreach t in array array['bloom_receipts','bloom_money_entries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (bloom_private.is_member(household_id))',t||'_read',t);
  end loop;
end $$;

create function bloom_private.food_storage_member(object_name text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or object_name is null or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$' then return false; end if;
  return bloom_private.is_member(split_part(object_name,'/',1)::uuid);
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bloom-food-files','bloom-food-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy bloom_food_storage_read on storage.objects for select to authenticated
using (bucket_id='bloom-food-files' and bloom_private.food_storage_member(name));
create policy bloom_food_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='bloom-food-files' and bloom_private.food_storage_member(name));
create policy bloom_food_storage_delete on storage.objects for delete to authenticated
using (bucket_id='bloom-food-files' and bloom_private.food_storage_member(name));

revoke all on function bloom_private.food_object_keys_ok(jsonb,text[]),bloom_private.food_valid_nutrients(jsonb),
  bloom_private.food_valid_snapshot(jsonb),bloom_private.food_validate_relations(),bloom_private.food_storage_member(text)
from public,anon,authenticated;
grant execute on function bloom_private.food_object_keys_ok(jsonb,text[]),bloom_private.food_valid_nutrients(jsonb),
  bloom_private.food_valid_snapshot(jsonb),bloom_private.food_storage_member(text) to authenticated;

-- These helpers are callable only by their owner inside the checked RPCs.
create function bloom_private.food_date(value text, field_name text, required boolean default false)
returns date language plpgsql immutable security invoker set search_path = '' as $$
declare result date;
begin
  if value is null or value = '' then
    if required then raise exception '% is required.',field_name using errcode = '22023'; end if;
    return null;
  end if;
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '% must be a calendar date.',field_name using errcode = '22023'; end if;
  result := value::date;
  if not isfinite(result) then raise exception '% must be a calendar date.',field_name using errcode = '22023'; end if;
  return result;
end;
$$;

create function bloom_private.food_cents(value jsonb, field_name text, nullable boolean default false)
returns bigint language plpgsql immutable security invoker set search_path = '' as $$
declare n numeric;
begin
  if value is null or value = 'null'::jsonb then
    if nullable then return null; end if;
    raise exception '% is required.',field_name using errcode = '22023';
  end if;
  if jsonb_typeof(value) <> 'number' then raise exception '% must be an amount in whole cents.',field_name using errcode = '22023'; end if;
  n := value::text::numeric;
  if n < 0 or n > 1000000000 or n <> trunc(n) then raise exception '% must be between 0 and 1,000,000,000 whole cents.',field_name using errcode = '22023'; end if;
  return n::bigint;
end;
$$;

create function bloom_private.food_lock_household()
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select m.household_id into household from public.bloom_household_members m where m.user_id=actor;
  if household is null then raise exception 'Join a household first.' using errcode = '42501'; end if;
  perform 1 from public.bloom_households h where h.id=household for update;
  -- Membership can be removed while a request waits for the household lock.
  if not exists(select 1 from public.bloom_household_members m where m.household_id=household and m.user_id=actor) then
    raise exception 'Your household access changed. Sign in again before continuing.' using errcode = '42501';
  end if;
  return household;
end;
$$;

create function bloom_private.record_receipt(p_receipt jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); household uuid; receipt uuid; purchase_date date; payer integer;
  total bigint := 0; food_total bigint := 0; household_total bigint := 0;
  has_food boolean := false; has_household boolean := false;
  item jsonb; items jsonb := '[]'; item_product uuid; item_shopping uuid; stock_id uuid;
  item_name text; item_category text; item_packs numeric; item_cost bigint; stock_qty numeric;
  stock_unit text; stock_location text; expiry date; frozen date; freezer_date date; date_kind text;
  product_row public.bloom_products%rowtype; shopping_row public.bloom_shopping_items%rowtype;
  stock_row public.bloom_inventory%rowtype; saved public.bloom_receipts%rowtype;
  before_row jsonb; after_row jsonb; new_inventory_effects jsonb := '[]'; new_shopping_effects jsonb := '[]';
  linked_ids uuid[] := array[]::uuid[]; expected_revision bigint; remaining numeric;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  household := bloom_private.food_lock_household();
  if not bloom_private.food_object_keys_ok(p_receipt,array['id','purchased_on','store','payer_slot','notes','items']) then
    raise exception 'The receipt contains invalid fields.' using errcode = '22023';
  end if;
  receipt := nullif(p_receipt->>'id','')::uuid;
  if receipt is null then raise exception 'The receipt needs its stable save identifier.' using errcode = '22023'; end if;
  select * into saved from public.bloom_receipts r where r.id=receipt and r.household_id=household;
  if found then
    if saved.request_payload is distinct from p_receipt then raise exception 'This receipt identifier was already saved with different details. Review the saved receipt.' using errcode = '23505'; end if;
    return receipt;
  end if;
  purchase_date := bloom_private.food_date(p_receipt->>'purchased_on','Purchase date',true);
  payer := bloom_private.food_cents(p_receipt->'payer_slot','Person',true)::integer;
  if payer is not null and payer not in (1,2) then raise exception 'Choose Person 1, Person 2, or leave the payer unassigned.' using errcode = '22023'; end if;
  if char_length(coalesce(p_receipt->>'store','')) > 160 or char_length(coalesce(p_receipt->>'notes','')) > 4000 then
    raise exception 'The store or receipt notes are too long.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_receipt->'items') is distinct from 'array' or jsonb_array_length(p_receipt->'items') not between 1 and 500 then
    raise exception 'A receipt needs between 1 and 500 reviewed lines.' using errcode = '22023';
  end if;

  -- Validate every line before creating any receipt, stock or money records.
  for item in select value from jsonb_array_elements(p_receipt->'items') loop
    if not bloom_private.food_object_keys_ok(item,array['product_id','name','category','packs','line_total_cents','stock_quantity','stock_unit','location','expires_on','date_type','frozen_on','freezer_use_by','shopping_item_id','shopping_revision']) then
      raise exception 'A receipt line contains invalid fields.' using errcode = '22023';
    end if;
    item_name := btrim(coalesce(item->>'name',''));
    item_category := item->>'category';
    if char_length(item_name) not between 1 and 160 or item_category is null or item_category not in ('food','household') then
      raise exception 'Every receipt line needs a name and Food or Household category.' using errcode = '22023';
    end if;
    if jsonb_typeof(item->'packs') is distinct from 'number' then raise exception 'Every receipt line needs a positive quantity.' using errcode = '22023'; end if;
    item_packs := (item->>'packs')::numeric;
    if item_packs <= 0 or item_packs > 1000000000 then raise exception 'A receipt quantity is outside the supported range.' using errcode = '22023'; end if;
    item_cost := bloom_private.food_cents(item->'line_total_cents','Line total');
    total := total + item_cost;
    if total > 1000000000 then raise exception 'The receipt total is outside the supported range.' using errcode = '22023'; end if;
    if item_category='food' then food_total := food_total+item_cost; has_food := true;
      else household_total := household_total+item_cost; has_household := true; end if;
    item_product := nullif(item->>'product_id','')::uuid;
    product_row := null;
    if item_product is not null then
      select * into product_row from public.bloom_products p where p.id=item_product and p.household_id=household;
      if not found then raise exception 'A receipt product is not in your household catalog.' using errcode = '23514'; end if;
      if product_row.category <> item_category then raise exception 'The receipt category must match the selected product. Edit its catalog category first if needed.' using errcode = '23514'; end if;
    end if;
    stock_qty := null;
    if item->'stock_quantity' is not null and item->'stock_quantity' <> 'null'::jsonb then
      if jsonb_typeof(item->'stock_quantity') <> 'number' then raise exception 'Food stock needs a numeric quantity.' using errcode = '22023'; end if;
      stock_qty := (item->>'stock_quantity')::numeric;
      if stock_qty < 0 or stock_qty > 1000000000 then raise exception 'Stock quantity is outside the supported range.' using errcode = '22023'; end if;
    end if;
    stock_unit := btrim(coalesce(item->>'stock_unit',''));
    stock_location := item->>'location';
    if coalesce(stock_qty,0)>0 and (item_category<>'food' or char_length(stock_unit) not between 1 and 30 or coalesce(stock_location,'') not in ('pantry','refrigerator','freezer')) then
      raise exception 'Food added to inventory needs its quantity, unit and storage location. Household supplies do not enter food stock.' using errcode = '22023';
    end if;
    expiry := bloom_private.food_date(item->>'expires_on','Printed food date');
    frozen := bloom_private.food_date(item->>'frozen_on','Frozen date');
    freezer_date := bloom_private.food_date(item->>'freezer_use_by','Freezer reminder date');
    date_kind := coalesce(nullif(item->>'date_type',''),'unknown');
    if date_kind not in ('best_before','use_by','sell_by','expiry','unknown') or (freezer_date is not null and frozen is not null and freezer_date<frozen) then
      raise exception 'Check the food date type and freezer reminder date.' using errcode = '22023';
    end if;
    item_shopping := nullif(item->>'shopping_item_id','')::uuid;
    if item_shopping is not null then
      if item_shopping = any(linked_ids) then raise exception 'Combine a shopping item into one receipt line before saving.' using errcode = '22023'; end if;
      linked_ids := array_append(linked_ids,item_shopping);
      select * into shopping_row from public.bloom_shopping_items s where s.id=item_shopping and s.household_id=household for update;
      if not found then raise exception 'A linked shopping item is no longer available.' using errcode = '23514'; end if;
      if shopping_row.product_id is not null and shopping_row.product_id is distinct from item_product then
        raise exception 'The receipt product does not match its shopping item.' using errcode = '23514';
      end if;
      if shopping_row.category <> item_category then raise exception 'The receipt and linked shopping item need the same category.' using errcode = '23514'; end if;
      expected_revision := bloom_private.food_cents(item->'shopping_revision','Shopping revision',true);
      if expected_revision is not null and expected_revision <> shopping_row.revision then
        raise exception 'The shopping item changed while this receipt was open. Refresh and review the receipt before saving.' using errcode = '40001';
      end if;
    end if;
    items := items || jsonb_build_array(item || jsonb_build_object('name',item_name,'brand',coalesce(product_row.brand,''),'date_type',date_kind));
  end loop;

  insert into public.bloom_receipts(id,household_id,purchased_on,store,payer_slot,notes,items,total_cents,request_payload,created_by)
  values(receipt,household,purchase_date,coalesce(p_receipt->>'store',''),payer,coalesce(p_receipt->>'notes',''),items,total,p_receipt,actor);
  if has_food then
    insert into public.bloom_money_entries(id,household_id,occurred_on,direction,category,amount_cents,description,payer_slot,receipt_id,request_payload,created_by)
    values(gen_random_uuid(),household,purchase_date,'expense','food',food_total,'Food · '||coalesce(nullif(p_receipt->>'store',''),'Shopping receipt'),payer,receipt,jsonb_build_object('receipt_id',receipt,'category','food'),actor);
  end if;
  if has_household then
    insert into public.bloom_money_entries(id,household_id,occurred_on,direction,category,amount_cents,description,payer_slot,receipt_id,request_payload,created_by)
    values(gen_random_uuid(),household,purchase_date,'expense','household',household_total,'Household · '||coalesce(nullif(p_receipt->>'store',''),'Shopping receipt'),payer,receipt,jsonb_build_object('receipt_id',receipt,'category','household'),actor);
  end if;
  for item in select value from jsonb_array_elements(items) loop
    stock_qty := (item->>'stock_quantity')::numeric;
    if coalesce(stock_qty,0)>0 then
      stock_id := gen_random_uuid();
      insert into public.bloom_inventory(id,household_id,name,brand,quantity,unit,location,expires_on,created_by,product_id,frozen_on,date_type,freezer_use_by,receipt_id)
      values(stock_id,household,item->>'name',coalesce(item->>'brand',''),stock_qty,item->>'stock_unit',item->>'location',
        bloom_private.food_date(item->>'expires_on','Printed food date'),actor,nullif(item->>'product_id','')::uuid,
        bloom_private.food_date(item->>'frozen_on','Frozen date'),item->>'date_type',bloom_private.food_date(item->>'freezer_use_by','Freezer reminder date'),receipt)
      returning * into stock_row;
      new_inventory_effects := new_inventory_effects || jsonb_build_array(jsonb_build_object('id',stock_id,'after',to_jsonb(stock_row)));
    end if;
    item_shopping := nullif(item->>'shopping_item_id','')::uuid;
    if item_shopping is not null then
      select * into shopping_row from public.bloom_shopping_items s where s.id=item_shopping and s.household_id=household for update;
      before_row := to_jsonb(shopping_row);
      item_packs := (item->>'packs')::numeric;
      if shopping_row.packs is not null and item_packs < shopping_row.packs then
        remaining := shopping_row.packs-item_packs;
        update public.bloom_shopping_items set packs=remaining,quantity=remaining::text||' pack(s)',checked=false,
          estimate_cents=case when shopping_row.estimate_cents is null then null else round(shopping_row.estimate_cents*remaining/shopping_row.packs)::bigint end
        where id=item_shopping and household_id=household returning to_jsonb(bloom_shopping_items.*) into after_row;
      else
        update public.bloom_shopping_items set checked=true where id=item_shopping and household_id=household
        returning to_jsonb(bloom_shopping_items.*) into after_row;
      end if;
      new_shopping_effects := new_shopping_effects || jsonb_build_array(jsonb_build_object('id',item_shopping,'before',before_row,'after',after_row));
    end if;
  end loop;
  update public.bloom_receipts set inventory_effects=new_inventory_effects,shopping_effects=new_shopping_effects
  where id=receipt and household_id=household;
  return receipt;
end;
$$;

create function bloom_private.void_receipt(p_receipt_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; saved public.bloom_receipts%rowtype;
  effect jsonb; actual jsonb; before_row jsonb; void_time timestamptz := clock_timestamp();
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  household := bloom_private.food_lock_household();
  select * into saved from public.bloom_receipts r where r.id=p_receipt_id and r.household_id=household for update;
  if not found then raise exception 'This receipt is not available in your household.' using errcode = '42501'; end if;
  if saved.voided_at is not null then return; end if;
  for effect in select value from jsonb_array_elements(saved.inventory_effects) loop
    select to_jsonb(i.*) into actual from public.bloom_inventory i where i.id=(effect->>'id')::uuid and i.household_id=household for update;
    if actual is null or (actual-array['revision','created_at','updated_at']) is distinct from ((effect->'after')-array['revision','created_at','updated_at']) then
      raise exception 'Food from this receipt has been edited, used or removed. Review an inventory correction before reversing this receipt.' using errcode = '23514';
    end if;
  end loop;
  for effect in select value from jsonb_array_elements(saved.shopping_effects) loop
    select to_jsonb(s.*) into actual from public.bloom_shopping_items s where s.id=(effect->>'id')::uuid and s.household_id=household for update;
    if actual is null or (actual-array['revision','created_at','updated_at']) is distinct from ((effect->'after')-array['revision','created_at','updated_at']) then
      raise exception 'A shopping item from this receipt changed. Review the shopping-list correction before reversing this receipt.' using errcode = '23514';
    end if;
  end loop;
  for effect in select value from jsonb_array_elements(saved.inventory_effects) loop
    delete from public.bloom_inventory where id=(effect->>'id')::uuid and household_id=household;
  end loop;
  for effect in select value from jsonb_array_elements(saved.shopping_effects) loop
    before_row := effect->'before';
    update public.bloom_shopping_items set name=before_row->>'name',quantity=before_row->>'quantity',
      checked=(before_row->>'checked')::boolean,month=(before_row->>'month')::date,
      product_id=(before_row->>'product_id')::uuid,packs=(before_row->>'packs')::numeric,
      estimate_cents=(before_row->>'estimate_cents')::bigint,category=before_row->>'category'
    where id=(effect->>'id')::uuid and household_id=household;
  end loop;
  update public.bloom_receipts set voided_at=void_time where id=p_receipt_id and household_id=household;
  update public.bloom_money_entries set voided_at=void_time where receipt_id=p_receipt_id and household_id=household and voided_at is null;
end;
$$;

create function bloom_private.record_money_entry(p_entry jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; entry uuid; bill uuid; entry_date date;
  direction_value text; category_value text; amount bigint; payer integer; saved public.bloom_money_entries%rowtype;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  household := bloom_private.food_lock_household();
  if not bloom_private.food_object_keys_ok(p_entry,array['id','occurred_on','direction','category','amount_cents','description','payer_slot','bill_id']) then
    raise exception 'The money entry contains invalid fields. Grocery receipts must be recorded through Receipts.' using errcode = '22023';
  end if;
  entry := nullif(p_entry->>'id','')::uuid;
  if entry is null then raise exception 'The entry needs its stable save identifier.' using errcode = '22023'; end if;
  select * into saved from public.bloom_money_entries e where e.id=entry and e.household_id=household;
  if found then
    if saved.receipt_id is not null or saved.request_payload is distinct from p_entry then
      raise exception 'This entry identifier was already saved with different details. Review the saved entry.' using errcode = '23505';
    end if;
    return entry;
  end if;
  entry_date := bloom_private.food_date(p_entry->>'occurred_on','Entry date',true);
  direction_value := p_entry->>'direction'; category_value := p_entry->>'category';
  amount := bloom_private.food_cents(p_entry->'amount_cents','Amount');
  payer := bloom_private.food_cents(p_entry->'payer_slot','Person',true)::integer;
  if direction_value is null or direction_value not in ('income','expense') or category_value is null or category_value not in ('food','household','bill','other')
    or (payer is not null and payer not in (1,2)) or char_length(coalesce(p_entry->>'description',''))>4000 then
    raise exception 'Check the entry direction, category, person and description.' using errcode = '22023';
  end if;
  bill := nullif(p_entry->>'bill_id','')::uuid;
  if bill is not null then
    if direction_value<>'expense' or category_value<>'bill' then raise exception 'A bill payment must be a Bill expense.' using errcode = '22023'; end if;
    perform 1 from public.bloom_bills b where b.id=bill and b.household_id=household for update;
    if not found then raise exception 'The bill is not in this household.' using errcode = '23514'; end if;
    if exists(select 1 from public.bloom_money_entries e where e.household_id=household and e.bill_id=bill and e.voided_at is null) then
      raise exception 'This bill already has a recorded payment. Review or reverse that payment before replacing it.' using errcode = '23505';
    end if;
  end if;
  insert into public.bloom_money_entries(id,household_id,occurred_on,direction,category,amount_cents,description,payer_slot,bill_id,request_payload,created_by)
  values(entry,household,entry_date,direction_value,category_value,amount,coalesce(p_entry->>'description',''),payer,bill,p_entry,actor);
  return entry;
end;
$$;

create function bloom_private.void_money_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; saved public.bloom_money_entries%rowtype;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  household := bloom_private.food_lock_household();
  select * into saved from public.bloom_money_entries e where e.id=p_entry_id and e.household_id=household for update;
  if not found then raise exception 'This entry is not available in your household.' using errcode = '42501'; end if;
  if saved.receipt_id is not null then raise exception 'Reverse the original receipt to keep spending and food stock together.' using errcode = '23514'; end if;
  if saved.voided_at is null then update public.bloom_money_entries set voided_at=clock_timestamp() where id=p_entry_id and household_id=household; end if;
end;
$$;

create function public.bloom_record_receipt(p_receipt jsonb)
returns uuid language sql volatile security invoker set search_path = '' as $$ select bloom_private.record_receipt(p_receipt); $$;
create function public.bloom_void_receipt(p_receipt_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select bloom_private.void_receipt(p_receipt_id); $$;
create function public.bloom_record_money_entry(p_entry jsonb)
returns uuid language sql volatile security invoker set search_path = '' as $$ select bloom_private.record_money_entry(p_entry); $$;
create function public.bloom_void_money_entry(p_entry_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select bloom_private.void_money_entry(p_entry_id); $$;

revoke all on function bloom_private.food_date(text,text,boolean),bloom_private.food_cents(jsonb,text,boolean),bloom_private.food_lock_household(),
  bloom_private.record_receipt(jsonb),bloom_private.void_receipt(uuid),bloom_private.record_money_entry(jsonb),bloom_private.void_money_entry(uuid)
from public,anon,authenticated;
grant execute on function bloom_private.record_receipt(jsonb),bloom_private.void_receipt(uuid),bloom_private.record_money_entry(jsonb),bloom_private.void_money_entry(uuid) to authenticated;
revoke all on function public.bloom_record_receipt(jsonb),public.bloom_void_receipt(uuid),public.bloom_record_money_entry(jsonb),public.bloom_void_money_entry(uuid) from public,anon,authenticated;
grant execute on function public.bloom_record_receipt(jsonb),public.bloom_void_receipt(uuid),public.bloom_record_money_entry(jsonb),public.bloom_void_money_entry(uuid) to authenticated;

comment on table public.bloom_receipts is 'Confirmed actual shopping trips. Immutable except for explicit checked reversal; the same transaction records stock and category spending.';
comment on table public.bloom_money_entries is 'Actual money events. Receipt category entries are generated once from the receipt; planned shopping and bills never create an expense.';
comment on table public.bloom_products is 'Editable reference catalog. A reference price is not a purchase or a live store price; unknown nutrition stays unknown.';
comment on table public.bloom_meal_entries is 'Person 1/2 nutrition history with separate planned and eaten records and preserved calculation snapshots.';
comment on column public.bloom_inventory.freezer_use_by is 'Household-entered reminder date, not an automatically calculated food safety guarantee.';

-- Additive household restore. The table allowlist is fixed; JSON values are bound
-- as parameters. Editable rows retain business dates but start a new revision.
create function bloom_private.food_restore_row(p_table text, p_row jsonb, p_household uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare actual jsonb; candidate jsonb; k text; metadata_keys text[]; columns_sql text; values_sql text; ref uuid;
begin
  if p_table not in ('bloom_products','bloom_recurring_products','bloom_budgets','bloom_inventory','bloom_shopping_items','bloom_bills','bloom_recipes','bloom_meal_entries','bloom_receipts','bloom_money_entries','bloom_food_files') then
    raise exception 'Unsupported backup collection.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_row) is distinct from 'object' or nullif(p_row->>'household_id','')::uuid is distinct from p_household then
    raise exception 'Every backup row must belong to this household.' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_row) loop
    if not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=to_regclass('public.'||p_table)
      and a.attname=k and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity='') then
      raise exception 'Unsupported backup field % in %.',k,p_table using errcode = '22023';
    end if;
  end loop;
  if p_table='bloom_budgets' then
    if bloom_private.food_date(p_row->>'month','Budget month',true) is null then raise exception 'A budget month is required.' using errcode = '22023'; end if;
    execute format('select to_jsonb(t) from public.%I t where household_id=$1 and month=$2::date',p_table)
      into actual using p_household,p_row->>'month';
  else
    ref := nullif(p_row->>'id','')::uuid;
    if ref is null then raise exception 'A backup row is missing its identifier.' using errcode = '22023'; end if;
    execute format('select to_jsonb(t) from public.%I t where household_id=$1 and id=$2',p_table)
      into actual using p_household,ref;
  end if;
  if p_table in ('bloom_receipts','bloom_money_entries') then
    metadata_keys := array[]::text[];
    if nullif(p_row->>'created_by','')::uuid is null or p_row->>'created_at' is null
      or not isfinite((p_row->>'created_at')::timestamptz)
      or (p_row->>'voided_at' is not null and not isfinite((p_row->>'voided_at')::timestamptz)) then
      raise exception 'A historical money record has invalid creation or reversal details.' using errcode = '22023';
    end if;
  else metadata_keys := array['revision','created_at','updated_at']; end if;
  candidate := p_row - metadata_keys;
  if actual is not null then
    for k in select jsonb_object_keys(candidate) loop
      if (actual->k) is distinct from (candidate->k) then
        raise exception 'An existing % record differs from this backup. Nothing was overwritten.',p_table using errcode = '23505';
      end if;
    end loop;
    return false;
  end if;
  if p_table='bloom_inventory' and p_row->>'receipt_id' is not null then
    if not exists(select 1 from public.bloom_receipts r where r.id=(p_row->>'receipt_id')::uuid and r.household_id=p_household and r.voided_at is null
      and exists(select 1 from jsonb_array_elements(r.inventory_effects) e where e->>'id'=p_row->>'id')) then
      raise exception 'A restored stock batch does not match an active receipt in this household.' using errcode = '23514';
    end if;
  end if;
  if p_table='bloom_food_files' then
    if split_part(coalesce(p_row->>'path',''),'/',1) <> p_household::text then raise exception 'A file path belongs to a different household.' using errcode = '42501'; end if;
    if (p_row->>'product_id' is not null and not exists(select 1 from public.bloom_products p where p.household_id=p_household and p.id=(p_row->>'product_id')::uuid))
      or (p_row->>'recipe_id' is not null and not exists(select 1 from public.bloom_recipes r where r.household_id=p_household and r.id=(p_row->>'recipe_id')::uuid)) then
      raise exception 'A file references a product or recipe outside this household.' using errcode = '23514';
    end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='bloom-food-files' and o.name=p_row->>'path') then return null; end if;
  end if;
  select string_agg(format('%I',a.attname),',' order by a.attnum),string_agg(format('r.%I',a.attname),',' order by a.attnum)
    into columns_sql,values_sql from pg_catalog.pg_attribute a
    where a.attrelid=to_regclass('public.'||p_table) and a.attnum>0 and not a.attisdropped and candidate ? a.attname::text;
  execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r',p_table,columns_sql,values_sql,p_table) using candidate;
  return true;
end;
$$;

create function bloom_private.food_check_receipt_history(p_household uuid, p_receipt uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare saved public.bloom_receipts%rowtype; item jsonb; source_item jsonb; effect jsonb; row_after jsonb;
  i integer := 0; inventory_i integer := 0; shopping_i integer := 0; total bigint := 0; food_total bigint := 0; household_total bigint := 0;
  food_count integer := 0; household_count integer := 0; item_cost bigint; qty numeric; product uuid; expected integer;
begin
  select * into saved from public.bloom_receipts r where r.household_id=p_household and r.id=p_receipt;
  if not found then raise exception 'A receipt history reference is missing.' using errcode = '23514'; end if;
  if not bloom_private.food_object_keys_ok(saved.request_payload,array['id','purchased_on','store','payer_slot','notes','items'])
    or (saved.request_payload->>'id')::uuid is distinct from saved.id
    or bloom_private.food_date(saved.request_payload->>'purchased_on','Purchase date',true) is distinct from saved.purchased_on
    or coalesce(saved.request_payload->>'store','') is distinct from saved.store
    or (saved.request_payload->>'payer_slot')::integer is distinct from saved.payer_slot
    or coalesce(saved.request_payload->>'notes','') is distinct from saved.notes
    or jsonb_typeof(saved.request_payload->'items') is distinct from 'array'
    or jsonb_array_length(saved.request_payload->'items') is distinct from jsonb_array_length(saved.items) then
    raise exception 'The receipt history does not match its original request.' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(saved.items) loop
    source_item := saved.request_payload->'items'->i;
    if not bloom_private.food_object_keys_ok(source_item,array['product_id','name','category','packs','line_total_cents','stock_quantity','stock_unit','location','expires_on','date_type','frozen_on','freezer_use_by','shopping_item_id','shopping_revision'])
      or (item-'brand') is distinct from (source_item || jsonb_build_object('name',btrim(coalesce(source_item->>'name','')),'date_type',coalesce(nullif(source_item->>'date_type',''),'unknown'))) then
      raise exception 'A receipt line does not match its recorded snapshot.' using errcode = '23514';
    end if;
    if jsonb_typeof(item->'packs') is distinct from 'number' or (item->>'packs')::numeric<=0 or (item->>'packs')::numeric>1000000000
      or char_length(btrim(coalesce(item->>'name',''))) not between 1 and 160 then
      raise exception 'An imported receipt line has an invalid name or quantity.' using errcode = '22023';
    end if;
    item_cost := bloom_private.food_cents(item->'line_total_cents','Receipt line total');
    total := total+item_cost;
    if item->>'category'='food' then food_total:=food_total+item_cost;food_count:=food_count+1;
      elsif item->>'category'='household' then household_total:=household_total+item_cost;household_count:=household_count+1;
      else raise exception 'Imported receipt lines need Food or Household categories.' using errcode = '22023'; end if;
    product := nullif(item->>'product_id','')::uuid;
    if product is not null and not exists(select 1 from public.bloom_products p where p.id=product and p.household_id=p_household) then
      raise exception 'A receipt product is outside this household.' using errcode = '23514';
    end if;
    qty := (item->>'stock_quantity')::numeric;
    if qty is not null and (qty<0 or qty>1000000000) then raise exception 'An imported stock quantity is invalid.' using errcode = '22023'; end if;
    if coalesce(qty,0)>0 then
      effect := saved.inventory_effects->inventory_i; row_after:=effect->'after';
      if effect is null or item->>'category'<>'food' or (effect->>'id')::uuid is null
        or (row_after->>'id')::uuid is distinct from (effect->>'id')::uuid
        or (row_after->>'household_id')::uuid is distinct from p_household
        or (row_after->>'receipt_id')::uuid is distinct from saved.id
        or (row_after->>'product_id')::uuid is distinct from product
        or (row_after->>'quantity')::numeric is distinct from qty
        or row_after->>'unit' is distinct from item->>'stock_unit'
        or row_after->>'location' is distinct from item->>'location'
        or row_after->>'name' is distinct from item->>'name' then
        raise exception 'The receipt inventory history does not match its purchased food.' using errcode = '23514';
      end if;
      inventory_i:=inventory_i+1;
    end if;
    if nullif(item->>'shopping_item_id','') is not null then
      effect:=saved.shopping_effects->shopping_i;
      if effect is null or (effect->>'id')::uuid is distinct from (item->>'shopping_item_id')::uuid
        or (effect->'before'->>'id')::uuid is distinct from (effect->>'id')::uuid
        or (effect->'after'->>'id')::uuid is distinct from (effect->>'id')::uuid
        or (effect->'before'->>'household_id')::uuid is distinct from p_household
        or (effect->'after'->>'household_id')::uuid is distinct from p_household then
        raise exception 'The receipt shopping history references another household or item.' using errcode = '23514';
      end if;
      shopping_i:=shopping_i+1;
    end if;
    i:=i+1;
  end loop;
  if total<>saved.total_cents or inventory_i<>jsonb_array_length(saved.inventory_effects) or shopping_i<>jsonb_array_length(saved.shopping_effects) then
    raise exception 'Receipt totals or saved effects are inconsistent.' using errcode = '23514';
  end if;
  expected := (food_count>0)::integer+(household_count>0)::integer;
  if (select count(*) from public.bloom_money_entries e where e.household_id=p_household and e.receipt_id=saved.id)<>expected then
    raise exception 'Receipt spending history is incomplete or duplicated.' using errcode = '23514';
  end if;
  if (food_count>0 and not exists(select 1 from public.bloom_money_entries e where e.household_id=p_household and e.receipt_id=saved.id and e.category='food' and e.amount_cents=food_total))
    or (household_count>0 and not exists(select 1 from public.bloom_money_entries e where e.household_id=p_household and e.receipt_id=saved.id and e.category='household' and e.amount_cents=household_total))
    or exists(select 1 from public.bloom_money_entries e where e.household_id=p_household and e.receipt_id=saved.id
      and (e.occurred_on<>saved.purchased_on or e.direction<>'expense' or e.bill_id is not null or e.voided_at is distinct from saved.voided_at
        or e.request_payload is distinct from jsonb_build_object('receipt_id',saved.id,'category',e.category))) then
    raise exception 'Receipt category spending does not match the preserved receipt.' using errcode = '23514';
  end if;
end;
$$;

create function bloom_private.restore_household_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; data jsonb; rows jsonb; row_value jsonb; k text;
  keys text[] := array['products','bills','recipes','recurringProducts','budgets','receipts','moneyEntries','inventory','shoppingItems','mealEntries','foodFiles'];
  tables text[] := array['bloom_products','bloom_bills','bloom_recipes','bloom_recurring_products','bloom_budgets','bloom_receipts','bloom_money_entries','bloom_inventory','bloom_shopping_items','bloom_meal_entries','bloom_food_files'];
  i integer; changed boolean; inserted jsonb := '{}'; existing jsonb := '{}'; skipped integer := 0; row_count integer := 0;
  receipts_to_check uuid[] := array[]::uuid[]; receipt uuid; entry_id uuid; entry public.bloom_money_entries%rowtype;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  household := bloom_private.food_lock_household();
  if not exists(select 1 from public.bloom_households h join public.bloom_household_members m on m.household_id=h.id
    where h.id=household and h.owner_user_id=actor and m.user_id=actor and m.role='owner') then
    raise exception 'Only the household owner can restore a household backup.' using errcode = '42501';
  end if;
  if not bloom_private.food_object_keys_ok(p_backup,array['app','version','household_id','exported_at','data'])
    or p_backup->>'app' is distinct from 'Life in Bloom Household' or p_backup->'version' is distinct from '1'::jsonb
    or nullif(p_backup->>'household_id','')::uuid is distinct from household
    or octet_length(p_backup::text)>52428800 then
    raise exception 'Choose a supported backup exported from this same household.' using errcode = '22023';
  end if;
  data := p_backup->'data';
  if not bloom_private.food_object_keys_ok(data,keys) then raise exception 'This backup contains unsupported collections.' using errcode = '22023'; end if;
  for i in 1..array_length(keys,1) loop
    k:=keys[i];rows:=coalesce(data->k,'[]'::jsonb);
    if jsonb_typeof(rows) is distinct from 'array' then raise exception 'Backup collection % must be a list.',k using errcode = '22023'; end if;
    row_count:=row_count+jsonb_array_length(rows);
    if row_count>100000 then raise exception 'This backup is too large for one restore. Ask for help splitting it safely.' using errcode = '22023'; end if;
    inserted:=inserted||jsonb_build_object(k,0);existing:=existing||jsonb_build_object(k,0);
    for row_value in select value from jsonb_array_elements(rows) loop
      changed:=bloom_private.food_restore_row(tables[i],row_value,household);
      if changed is null then skipped:=skipped+1;
      elsif changed then inserted:=jsonb_set(inserted,array[k],to_jsonb((inserted->>k)::integer+1));
      else existing:=jsonb_set(existing,array[k],to_jsonb((existing->>k)::integer+1)); end if;
      if k='receipts' then receipts_to_check:=array_append(receipts_to_check,(row_value->>'id')::uuid); end if;
      if k='moneyEntries' then
        entry_id:=(row_value->>'id')::uuid;
        select * into entry from public.bloom_money_entries e where e.id=entry_id and e.household_id=household;
        if entry.receipt_id is not null then receipts_to_check:=array_append(receipts_to_check,entry.receipt_id);
        elsif not bloom_private.food_object_keys_ok(entry.request_payload,array['id','occurred_on','direction','category','amount_cents','description','payer_slot','bill_id'])
          or (entry.request_payload->>'id')::uuid is distinct from entry.id
          or bloom_private.food_date(entry.request_payload->>'occurred_on','Entry date',true) is distinct from entry.occurred_on
          or entry.request_payload->>'direction' is distinct from entry.direction
          or entry.request_payload->>'category' is distinct from entry.category
          or bloom_private.food_cents(entry.request_payload->'amount_cents','Entry amount') is distinct from entry.amount_cents
          or coalesce(entry.request_payload->>'description','') is distinct from entry.description
          or (entry.request_payload->>'payer_slot')::integer is distinct from entry.payer_slot
          or nullif(entry.request_payload->>'bill_id','')::uuid is distinct from entry.bill_id then
          raise exception 'A restored money entry does not match its original request.' using errcode = '23514';
        end if;
      end if;
    end loop;
  end loop;
  for receipt in select distinct x from unnest(receipts_to_check) x loop
    perform bloom_private.food_check_receipt_history(household,receipt);
  end loop;
  return jsonb_build_object('inserted',inserted,'existing',existing,'skippedFiles',skipped,'editableRevisionReset',true);
end;
$$;

create function public.bloom_restore_household_backup(p_backup jsonb)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select bloom_private.restore_household_backup(p_backup); $$;
revoke all on function bloom_private.food_restore_row(text,jsonb,uuid),bloom_private.food_check_receipt_history(uuid,uuid),bloom_private.restore_household_backup(jsonb) from public,anon,authenticated;
grant execute on function bloom_private.restore_household_backup(jsonb) to authenticated;
revoke all on function public.bloom_restore_household_backup(jsonb) from public,anon,authenticated;
grant execute on function public.bloom_restore_household_backup(jsonb) to authenticated;
