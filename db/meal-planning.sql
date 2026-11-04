-- Life in Bloom: a dated cooking plan and its unpurchased grocery requirements.
-- Apply after checkout-monthly-bills.sql. No household data is seeded here.
-- Planning allocates stock on paper; it never consumes food or records spending.

create function bloom_private.meal_unit(p_unit text)
returns text language sql immutable security invoker set search_path='' as $$
  select case lower(btrim(coalesce(p_unit,'')))
    when 'grams' then 'g' when 'gram' then 'g' when 'kilograms' then 'kg' when 'kilogram' then 'kg'
    when 'ounces' then 'oz' when 'ounce' then 'oz' when 'pounds' then 'lb' when 'pound' then 'lb' when 'lbs' then 'lb'
    when 'milliliters' then 'ml' when 'milliliter' then 'ml' when 'liters' then 'l' when 'liter' then 'l'
    when 'fl oz' then 'fl_oz' when 'fl. oz.' then 'fl_oz' when 'cups' then 'cup'
    when 'tablespoons' then 'tbsp' when 'tablespoon' then 'tbsp' when 'teaspoons' then 'tsp' when 'teaspoon' then 'tsp'
    when 'count' then 'each' when 'pieces' then 'each' when 'piece' then 'each'
    when 'cloves' then 'clove' when 'stalks' then 'stalk' when 'sprigs' then 'sprig'
    when 'slices' then 'slice' when 'pinches' then 'pinch' when 'cans' then 'can' when 'cartons' then 'carton'
    else lower(btrim(coalesce(p_unit,''))) end;
$$;
create function bloom_private.meal_unit_family(p_unit text)
returns text language sql immutable security invoker set search_path='' as $$
  select case bloom_private.meal_unit(p_unit)
    when 'g' then 'mass' when 'kg' then 'mass' when 'oz' then 'mass' when 'lb' then 'mass'
    when 'ml' then 'volume' when 'l' then 'volume' when 'fl_oz' then 'volume'
    when 'cup' then 'volume' when 'tbsp' then 'volume' when 'tsp' then 'volume'
    when 'each' then 'count' else 'unit:'||bloom_private.meal_unit(p_unit) end;
$$;
create function bloom_private.meal_convert(p_quantity numeric,p_from text,p_to text)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare a text:=bloom_private.meal_unit(p_from); b text:=bloom_private.meal_unit(p_to); x numeric; y numeric;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>1000000000000 or a='' or b='' then return null; end if;
  if a=b then return p_quantity; end if;
  if bloom_private.meal_unit_family(a)<>bloom_private.meal_unit_family(b) then return null; end if;
  x:=case a when 'g' then 1 when 'kg' then 1000 when 'oz' then 28.349523125 when 'lb' then 453.59237
    when 'ml' then 1 when 'l' then 1000 when 'fl_oz' then 29.5735295625 when 'cup' then 236.5882365
    when 'tbsp' then 14.78676478125 when 'tsp' then 4.92892159375 else null end;
  y:=case b when 'g' then 1 when 'kg' then 1000 when 'oz' then 28.349523125 when 'lb' then 453.59237
    when 'ml' then 1 when 'l' then 1000 when 'fl_oz' then 29.5735295625 when 'cup' then 236.5882365
    when 'tbsp' then 14.78676478125 when 'tsp' then 4.92892159375 else null end;
  if x is null or y is null then return null; end if;
  return p_quantity*x/y;
end;
$$;
create function bloom_private.meal_name(p_name text)
returns text language sql immutable security invoker set search_path='' as $$
  select lower(regexp_replace(btrim(coalesce(p_name,'')),'[[:space:]]+',' ','g'));
$$;
create function bloom_private.meal_requirement_key(p_plan uuid,p_date date,p_line jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select md5(jsonb_build_object('plan_id',p_plan,'cook_on',p_date,'product_id',nullif(p_line->>'product_id','')::uuid,
    'name',bloom_private.meal_name(p_line->>'name'),'quantity',trim_scale((p_line->>'quantity')::numeric),
    'unit',bloom_private.meal_unit(p_line->>'unit'))::text);
$$;

-- Recipe quantities are for the whole recipe. A nullable amount is deliberately
-- different from zero; ranges, alternatives and "to taste" remain reviewable.
create function bloom_private.meal_lines(p_lines jsonb,p_household uuid,p_plan boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare line jsonb; result jsonb:='[]'; product uuid; amount numeric; item_name text; unit_name text;
  optional_value boolean; included_value boolean; allowed text[];
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>100 then
    raise exception 'Keep up to 100 shopping ingredients for one recipe.' using errcode='22023';
  end if;
  allowed:=array['name','quantity','unit','product_id','optional','notes'];
  if p_plan then allowed:=allowed||array['included']; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if not bloom_private.food_object_keys_ok(line,allowed) then raise exception 'A shopping ingredient has unsupported fields.' using errcode='22023'; end if;
    item_name:=btrim(coalesce(line->>'name','')); unit_name:=bloom_private.meal_unit(line->>'unit');
    if char_length(item_name) not between 1 and 160 or char_length(unit_name)>30 or char_length(coalesce(line->>'notes',''))>1000 then
      raise exception 'Check the ingredient name, unit and notes.' using errcode='22023';
    end if;
    amount:=null;
    if line->'quantity' is not null and line->'quantity'<>'null'::jsonb then
      if jsonb_typeof(line->'quantity') is distinct from 'number' then raise exception 'Use a numeric ingredient amount or leave it blank for review.' using errcode='22023'; end if;
      amount:=(line->>'quantity')::numeric;
      if amount<=0 or amount>1000000000 or unit_name='' then raise exception 'A measured ingredient needs a positive amount and its unit.' using errcode='22023'; end if;
    end if;
    if (line ? 'optional' and jsonb_typeof(line->'optional') is distinct from 'boolean')
      or (line ? 'included' and jsonb_typeof(line->'included') is distinct from 'boolean') then
      raise exception 'Choose whether this ingredient is optional and included.' using errcode='22023';
    end if;
    optional_value:=coalesce((line->>'optional')::boolean,false);
    included_value:=coalesce((line->>'included')::boolean,not optional_value);
    product:=nullif(line->>'product_id','')::uuid;
    if product is not null and not exists(select 1 from public.bloom_products p where p.id=product and p.household_id=p_household and p.category='food') then
      raise exception 'Choose a food product from this household for the ingredient.' using errcode='23514';
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('name',item_name,'quantity',amount,'unit',unit_name,'product_id',product,
      'optional',optional_value,'notes',coalesce(line->>'notes',''))||case when p_plan then jsonb_build_object('included',included_value) else '{}'::jsonb end);
  end loop;
  return result;
end;
$$;

alter table public.bloom_recipes add column planning_ingredients jsonb not null default '[]'
  check(jsonb_typeof(planning_ingredients)='array' and jsonb_array_length(planning_ingredients)<=100);
create function bloom_private.meal_validate_recipe()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  -- Preserve the reviewed template verbatim so an accepted insert can be
  -- verified against its original payload after a lost response. Cooking-plan
  -- snapshots normalize units later, while retaining their request payload.
  perform bloom_private.meal_lines(NEW.planning_ingredients,NEW.household_id,false);
  return NEW;
end;
$$;
create trigger bloom_recipe_planning_ingredients before insert or update on public.bloom_recipes
for each row execute function bloom_private.meal_validate_recipe();

create table public.bloom_cooking_plans (
  id uuid primary key,
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  recipe_id uuid not null,
  recipe_revision bigint not null check(recipe_revision>0),
  recipe_name text not null check(char_length(btrim(recipe_name)) between 1 and 160),
  base_servings numeric not null check(base_servings>0 and base_servings<=10000),
  cook_on date not null check(isfinite(cook_on) and cook_on between '1900-01-01' and '2200-12-31'),
  shopping_month date not null check(isfinite(shopping_month) and extract(day from shopping_month)=1),
  servings numeric not null check(servings>0 and servings<=10000),
  person1_servings numeric check(person1_servings>=0 and person1_servings<=10000),
  person2_servings numeric check(person2_servings>=0 and person2_servings<=10000),
  status text not null default 'planned' check(status in ('planned','cancelled')),
  ingredients jsonb not null check(jsonb_typeof(ingredients)='array' and jsonb_array_length(ingredients) between 1 and 100),
  requirements jsonb not null check(jsonb_typeof(requirements)='array' and jsonb_array_length(requirements) between 1 and 100),
  issues jsonb not null default '[]' check(jsonb_typeof(issues)='array' and jsonb_array_length(issues)<=500),
  notes text not null default '' check(char_length(notes)<=4000),
  last_request_id uuid,
  last_request_payload jsonb check(last_request_payload is null or (jsonb_typeof(last_request_payload)='object' and octet_length(last_request_payload::text)<=262144)),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(household_id,recipe_id) references public.bloom_recipes(household_id,id),
  check(coalesce(person1_servings,0)+coalesce(person2_servings,0)<=servings),
  unique(household_id,id),
  unique(household_id,last_request_id)
);
create index bloom_cooking_plans_date_idx on public.bloom_cooking_plans(household_id,status,cook_on);
create index bloom_cooking_plans_recipe_idx on public.bloom_cooking_plans(household_id,recipe_id);
create trigger bloom_cooking_plan_revision before insert or update on public.bloom_cooking_plans
for each row execute function bloom_private.guard_revision('id','household_id','shopping_month','created_at');
alter table public.bloom_cooking_plans enable row level security;
revoke all on public.bloom_cooking_plans from public,anon,authenticated;
grant select on public.bloom_cooking_plans to authenticated;
create policy bloom_cooking_plans_read on public.bloom_cooking_plans for select to authenticated
using(bloom_private.is_member(household_id));

-- Separate provenance avoids changing the row shape captured in old receipts.
alter table public.bloom_shopping_items add constraint bloom_shopping_household_id_unique unique(household_id,id);
create table public.bloom_meal_shopping_links (
  id uuid primary key,
  shopping_id uuid not null check(shopping_id=id),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  group_key text not null check(char_length(group_key) between 1 and 400),
  managed boolean not null default true,
  plan_refs jsonb not null default '[]' check(jsonb_typeof(plan_refs)='array' and jsonb_array_length(plan_refs)<=10000),
  needed_by date check(isfinite(needed_by)),
  generated_snapshot jsonb not null check(jsonb_typeof(generated_snapshot)='object'),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(household_id,shopping_id) references public.bloom_shopping_items(household_id,id) on delete cascade
);
create index bloom_meal_shopping_group_idx on public.bloom_meal_shopping_links(household_id,group_key) where managed;
create index bloom_meal_shopping_item_idx on public.bloom_meal_shopping_links(household_id,shopping_id);
create trigger bloom_meal_shopping_revision before insert or update on public.bloom_meal_shopping_links
for each row execute function bloom_private.guard_revision('id','shopping_id','household_id','created_at');
alter table public.bloom_meal_shopping_links enable row level security;
revoke all on public.bloom_meal_shopping_links from public,anon,authenticated;
grant select on public.bloom_meal_shopping_links to authenticated;
create policy bloom_meal_shopping_links_read on public.bloom_meal_shopping_links for select to authenticated
using(bloom_private.is_member(household_id));

create function bloom_private.meal_validate_plan_snapshot()
returns trigger language plpgsql security invoker set search_path='' as $$
declare reviewed jsonb; expected jsonb:='[]'; line jsonb; amount numeric; warning jsonb;
begin
  reviewed:=bloom_private.meal_lines(NEW.ingredients,NEW.household_id,true);
  for line in select value from jsonb_array_elements(reviewed) loop
    if not(line->>'included')::boolean then continue; end if;
    amount:=(line->>'quantity')::numeric*NEW.servings/NEW.base_servings;
    if amount>1000000000 then raise exception 'A stored cooking requirement is too large.' using errcode='23514'; end if;
    expected:=expected||jsonb_build_array((line-'included')||jsonb_build_object('quantity',amount));
  end loop;
  if jsonb_array_length(expected)=0 or NEW.requirements is distinct from expected then
    raise exception 'The cooking requirements must match the saved recipe yield and reviewed ingredients.' using errcode='23514';
  end if;
  for warning in select value from jsonb_array_elements(NEW.issues) loop
    if jsonb_typeof(warning)<>'string' or char_length(warning#>>'{}')>2000 then raise exception 'A cooking-plan review message is invalid.' using errcode='23514'; end if;
  end loop;
  NEW.ingredients:=reviewed;
  return NEW;
end;
$$;
create trigger bloom_cooking_plan_snapshot before insert or update on public.bloom_cooking_plans
for each row execute function bloom_private.meal_validate_plan_snapshot();

create function bloom_private.meal_validate_link()
returns trigger language plpgsql security invoker set search_path='' as $$
declare row_shopping public.bloom_shopping_items%rowtype; ref jsonb; p_id uuid;
begin
  select * into row_shopping from public.bloom_shopping_items s where s.id=NEW.shopping_id and s.household_id=NEW.household_id;
  if not found or row_shopping.source_key is distinct from 'meal:'||NEW.shopping_id::text
    or NEW.generated_snapshot->>'id' is distinct from NEW.shopping_id::text
    or NEW.generated_snapshot->>'household_id' is distinct from NEW.household_id::text
    or NEW.generated_snapshot->>'source_key' is distinct from row_shopping.source_key then
    raise exception 'Recipe grocery provenance must match its household shopping item.' using errcode='23514';
  end if;
  for ref in select value from jsonb_array_elements(NEW.plan_refs) loop
    if not bloom_private.food_object_keys_ok(ref,array['plan_id','recipe_name','cook_on','quantity','unit','requirement_key']) then
      raise exception 'A recipe shopping reference has invalid fields.' using errcode='23514';
    end if;
    p_id:=nullif(ref->>'plan_id','')::uuid;
    if p_id is null or not exists(select 1 from public.bloom_cooking_plans p where p.id=p_id and p.household_id=NEW.household_id)
      or char_length(coalesce(ref->>'recipe_name','')) not between 1 and 160
      or bloom_private.food_date(ref->>'cook_on','Cooking reference date',true) is null
      or char_length(coalesce(ref->>'unit',''))>30
      or coalesce(ref->>'requirement_key','') !~ '^[a-f0-9]{32}$'
      or (ref->'quantity' is not null and ref->'quantity'<>'null'::jsonb and
        (jsonb_typeof(ref->'quantity')<>'number' or (ref->>'quantity')::numeric<=0 or (ref->>'quantity')::numeric>1000000000)) then
      raise exception 'A recipe shopping reference is outside this household or has invalid amounts.' using errcode='23514';
    end if;
  end loop;
  return NEW;
end;
$$;
create trigger bloom_meal_shopping_link before insert or update on public.bloom_meal_shopping_links
for each row execute function bloom_private.meal_validate_link();

create function bloom_private.meal_reserved_source()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and coalesce(NEW.source_key,'') like 'meal:%' then
    raise exception 'Recipe shopping items are created by a saved meal plan.' using errcode='23514';
  end if;
  return NEW;
end;
$$;
create trigger bloom_meal_shopping_source before insert on public.bloom_shopping_items
for each row execute function bloom_private.meal_reserved_source();

-- Receipt stock effects are written in the same order as positive-stock lines.
-- Attribute a batch to that one line, never to unrelated food on a mixed trip.
create function bloom_private.meal_batch_origin(p_household uuid,p_batch uuid,p_receipt uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('plan_refs',l.plan_refs,'shopping_id',l.shopping_id,
    'name_key',bloom_private.meal_name(l.generated_snapshot->>'name'),
    'fulfilled',r.shopping_effects @> jsonb_build_array(jsonb_build_object('id',l.shopping_id,'after',jsonb_build_object('checked',true))))
  from public.bloom_receipts r
  cross join lateral (
    select entry.value,row_number() over(order by entry.ordinality)-1 as effect_index
    from jsonb_array_elements(r.items) with ordinality entry(value,ordinality)
    where coalesce((entry.value->>'stock_quantity')::numeric,0)>0
  ) item
  join public.bloom_meal_shopping_links l on l.household_id=r.household_id and l.shopping_id=nullif(item.value->>'shopping_item_id','')::uuid
  where r.household_id=p_household and r.id=p_receipt and r.voided_at is null
    and r.inventory_effects->(item.effect_index::integer)->>'id'=p_batch::text
  limit 1;
$$;

create function bloom_private.meal_reconcile(p_household uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  today_value date:=(now() at time zone 'America/New_York')::date;
  plan public.bloom_cooking_plans%rowtype; product public.bloom_products%rowtype;
  link_row record; item_row record; group_row record; line jsonb; pool jsonb; amount numeric;
  stock jsonb:='[]'; pending jsonb:='[]'; groups jsonb:='{}'; leftovers jsonb:='[]'; group_value jsonb;
  plan_issues jsonb; refs jsonb; new_ref jsonb; wanted numeric; available numeric; take_quantity numeric;
  unit_name text; canonical_unit text; item_name text; name_key text; key_value text; product_id_value uuid;
  i integer; j integer; scaled numeric; converted numeric; display_quantity numeric; package_quantity numeric;
  packs_value numeric; estimate_value bigint; quantity_label text; actual jsonb; snapshot_value jsonb;
  shopping_id_value uuid; touched uuid[]:=array[]::uuid[]; mutable uuid[]:=array[]::uuid[]; retained uuid[]:=array[]::uuid[];
  created_count integer:=0; updated_count integer:=0; removed_count integer:=0; detached_count integer:=0; frozen_count integer:=0;
  unknown_value boolean; old_group jsonb; needed date; row_count_value integer; requirement_key text;
  acknowledged boolean; customized_id uuid; origin jsonb; reserved_value boolean; stock_date date;
begin
  -- Caller has the household lock. Row locks also serialize ordinary direct
  -- inventory/list edits while their values are used in this calculation.
  perform 1 from public.bloom_products p where p.household_id=p_household for share;
  perform 1 from public.bloom_inventory s where s.household_id=p_household for share;
  perform 1 from public.bloom_shopping_items s where s.household_id=p_household for update;
  select coalesce(array_agg(distinct (effect->>'id')::uuid),array[]::uuid[]) into touched
    from public.bloom_receipts r cross join lateral jsonb_array_elements(r.shopping_effects) effect
    where r.household_id=p_household and r.voided_at is null;

  for link_row in select l.*,to_jsonb(s) as shopping_row from public.bloom_meal_shopping_links l
    join public.bloom_shopping_items s on s.id=l.shopping_id and s.household_id=l.household_id
    where l.household_id=p_household and l.managed for update of l loop
    if link_row.id=any(touched) then frozen_count:=frozen_count+1; continue; end if;
    actual:=link_row.shopping_row-array['revision','created_at','updated_at'];
    if actual is distinct from link_row.generated_snapshot then
      update public.bloom_meal_shopping_links set managed=false where id=link_row.id and household_id=p_household;
      detached_count:=detached_count+1;
    else mutable:=array_append(mutable,link_row.id); end if;
  end loop;

  for item_row in select s.* from public.bloom_inventory s where s.household_id=p_household and s.quantity>0
    order by coalesce(case when s.location='freezer' then s.freezer_use_by end,s.expires_on) nulls last,s.created_at,s.id loop
    origin:=bloom_private.meal_batch_origin(p_household,item_row.id,item_row.receipt_id);
    stock_date:=coalesce(case when item_row.location='freezer' then item_row.freezer_use_by end,item_row.expires_on);
    reserved_value:=false;
    if coalesce((origin->>'fulfilled')::boolean,false) then
      select exists(select 1 from jsonb_array_elements(origin->'plan_refs') ref
        join public.bloom_cooking_plans p on p.household_id=p_household and p.id=(ref->>'plan_id')::uuid
        cross join lateral jsonb_array_elements(p.requirements) requirement
        where p.status='planned' and p.cook_on>=today_value and (stock_date is null or stock_date>=p.cook_on)
          and ref->>'requirement_key'=bloom_private.meal_requirement_key(p.id,p.cook_on,requirement)
          and ((requirement->>'quantity')::numeric is null or bloom_private.meal_convert(1,item_row.unit,requirement->>'unit') is null)
      ) into reserved_value;
    end if;
    stock:=stock||jsonb_build_array(jsonb_build_object('id',item_row.id,'product_id',item_row.product_id,'name_key',bloom_private.meal_name(item_row.name),
      'quantity',case when reserved_value then 0 else item_row.quantity end,'original_quantity',item_row.quantity,'unit',bloom_private.meal_unit(item_row.unit),
      'dated',stock_date,'origin_refs',coalesce(origin->'plan_refs','[]'::jsonb),'origin_name_key',origin->>'name_key',
      'origin_fulfilled',coalesce((origin->>'fulfilled')::boolean,false),'reserved',reserved_value));
  end loop;
  for item_row in select s.*,p.package_quantity,p.package_unit from public.bloom_shopping_items s
    join public.bloom_products p on p.household_id=s.household_id and p.id=s.product_id
    where s.household_id=p_household and s.category='food' and not s.checked and s.packs>0 and not(s.id=any(mutable))
      and not exists(select 1 from public.bloom_receipts r where r.household_id=p_household and r.voided_at is null
        and r.shopping_effects @> jsonb_build_array(jsonb_build_object('id',s.id,'after',jsonb_build_object('checked',true))))
    order by s.month,s.created_at,s.id loop
    pending:=pending||jsonb_build_array(jsonb_build_object('id',item_row.id,'product_id',item_row.product_id,
      'quantity',item_row.packs*item_row.package_quantity,'unit',item_row.package_unit,'month',item_row.month,
      'receipt_touched',item_row.id=any(touched)));
  end loop;

  -- Visit meals by cooking date; each stock or pending-list quantity is used at
  -- most once across all meals, including meals in different shopping months.
  for plan in select p.* from public.bloom_cooking_plans p where p.household_id=p_household and p.status='planned'
    order by p.cook_on,p.created_at,p.id for update loop
    plan_issues:='[]';
    if plan.cook_on<today_value then
      plan_issues:=jsonb_build_array('This cooking date is in the past. Its plan is kept in history; it does not add groceries or claim that the meal was cooked.');
      if plan.issues is distinct from plan_issues then update public.bloom_cooking_plans set issues=plan_issues where id=plan.id and household_id=p_household; end if;
      continue;
    end if;
    for line in select value from jsonb_array_elements(plan.requirements) loop
      product_id_value:=nullif(line->>'product_id','')::uuid;
      item_name:=line->>'name'; name_key:=bloom_private.meal_name(item_name); unit_name:=bloom_private.meal_unit(line->>'unit');
      wanted:=(line->>'quantity')::numeric;
      canonical_unit:=case bloom_private.meal_unit_family(unit_name) when 'mass' then 'g' when 'volume' then 'ml' when 'count' then 'each' else unit_name end;
      requirement_key:=bloom_private.meal_requirement_key(plan.id,plan.cook_on,line);
      -- A user-customized generated item is a deliberate override for the exact
      -- requirements it came from. Keep it, and reserve its pending quantity so
      -- another meal cannot count that same custom purchase a second time.
      customized_id:=null;
      select l.shopping_id into customized_id from public.bloom_meal_shopping_links l
        join public.bloom_shopping_items s on s.id=l.shopping_id and s.household_id=l.household_id
        where l.household_id=p_household and not l.managed and not s.checked
          and l.plan_refs @> jsonb_build_array(jsonb_build_object('plan_id',plan.id,'requirement_key',requirement_key))
          and not exists(select 1 from public.bloom_receipts r where r.household_id=p_household and r.voided_at is null
            and r.shopping_effects @> jsonb_build_array(jsonb_build_object('id',s.id,'after',jsonb_build_object('checked',true))))
        order by l.created_at,l.id limit 1;
      if customized_id is not null then
        for i in 0..jsonb_array_length(pending)-1 loop
          if pending->i->>'id'=customized_id::text then pending:=jsonb_set(pending,array[i::text,'quantity'],'0'::jsonb); end if;
        end loop;
        plan_issues:=plan_issues||jsonb_build_array(item_name||': your customized shopping item is kept for this meal. Review its amount; it was not overwritten or added again.');
        continue;
      end if;
      -- An amount such as "salt to taste" cannot be subtracted numerically from
      -- a purchased container. Keep the explicitly reviewed purchase linked to
      -- that exact meal requirement, rather than immediately asking to buy it
      -- again. A changed quantity/date/product has a different fingerprint.
      acknowledged:=false;
      select exists(
        select 1 from jsonb_array_elements(stock) batch
        where (batch->>'origin_fulfilled')::boolean and (batch->>'original_quantity')::numeric>0
          and ((batch->>'dated')::date is null or (batch->>'dated')::date>=plan.cook_on)
          and batch->'origin_refs' @> jsonb_build_array(jsonb_build_object('plan_id',plan.id,'requirement_key',requirement_key))
          and (wanted is null or (batch->>'reserved')::boolean or bloom_private.meal_convert(1,batch->>'unit',unit_name) is null)
      ) into acknowledged;
      if acknowledged then
        plan_issues:=plan_issues||jsonb_build_array(item_name||': its reviewed purchase is saved for this meal. The recipe amount or units still need a manual check; another shopping item was not added.');
        continue;
      end if;
      if product_id_value is null then plan_issues:=plan_issues||jsonb_build_array(item_name||': choose a catalog product when you want its package size and estimated price.'); end if;
      if wanted is null then
        plan_issues:=plan_issues||jsonb_build_array(item_name||': review its amount; the written recipe does not provide one exact quantity.');
      else
        for i in 0..jsonb_array_length(stock)-1 loop
          exit when wanted<=0;
          pool:=stock->i;
          if ((product_id_value is not null and pool->>'product_id'=product_id_value::text)
            or (product_id_value is null and pool->>'product_id' is null and pool->>'name_key'=name_key)
            or (product_id_value is null and pool->>'origin_name_key'=name_key)
            or (pool->'origin_refs' @> jsonb_build_array(jsonb_build_object('plan_id',plan.id,'requirement_key',requirement_key))))
            and ((pool->>'dated')::date is null or (pool->>'dated')::date>=plan.cook_on) then
            available:=bloom_private.meal_convert((pool->>'quantity')::numeric,pool->>'unit',unit_name);
            if coalesce(available,0)>0 then
              take_quantity:=least(wanted,available); wanted:=greatest(wanted-take_quantity,0);
              amount:=greatest((pool->>'quantity')::numeric-bloom_private.meal_convert(take_quantity,unit_name,pool->>'unit'),0);
              stock:=jsonb_set(stock,array[i::text,'quantity'],to_jsonb(amount));
            end if;
          end if;
        end loop;
        if product_id_value is not null then
          for i in 0..jsonb_array_length(pending)-1 loop
            exit when wanted<=0;
            pool:=pending->i;
            if pool->>'product_id'=product_id_value::text and (pool->>'month')::date<=plan.shopping_month then
              available:=bloom_private.meal_convert((pool->>'quantity')::numeric,pool->>'unit',unit_name);
              if coalesce(available,0)>0 then
                take_quantity:=least(wanted,available); wanted:=greatest(wanted-take_quantity,0);
                amount:=greatest((pool->>'quantity')::numeric-bloom_private.meal_convert(take_quantity,unit_name,pool->>'unit'),0);
                pending:=jsonb_set(pending,array[i::text,'quantity'],to_jsonb(amount));
                if (pool->>'receipt_touched')::boolean then
                  plan_issues:=plan_issues||jsonb_build_array(item_name||': an unfinished remainder from a saved shopping trip is kept for review.');
                end if;
              end if;
            end if;
          end loop;
        end if;
      end if;
      if wanted is not null and wanted<=0 then continue; end if;
      key_value:=plan.shopping_month::text||'|'||case when product_id_value is null then 'name:'||name_key else 'product:'||product_id_value::text end||'|'||canonical_unit;
      group_value:=groups->key_value;
      if group_value is null then group_value:=jsonb_build_object('product_id',product_id_value,'name',item_name,'unit',unit_name,'canonical_unit',canonical_unit,
        'quantity',0,'unknown',false,'month',plan.shopping_month,'needed_by',plan.cook_on,'plan_refs','[]'::jsonb); end if;
      new_ref:=jsonb_build_object('plan_id',plan.id,'recipe_name',plan.recipe_name,'cook_on',plan.cook_on,'quantity',(line->>'quantity')::numeric,'unit',unit_name,'requirement_key',requirement_key);
      converted:=case when wanted is null then 0 else bloom_private.meal_convert(wanted,unit_name,canonical_unit) end;
      if converted is null then raise exception 'An ingredient could not retain its own measurement. Review its unit.' using errcode='22023'; end if;
      scaled:=(group_value->>'quantity')::numeric+converted;
      if scaled>1000000000 then raise exception 'The planned food quantity is too large. Review the serving counts.' using errcode='22023'; end if;
      group_value:=group_value||jsonb_build_object('quantity',scaled,'unknown',(group_value->>'unknown')::boolean or wanted is null,
        'needed_by',least((group_value->>'needed_by')::date,plan.cook_on),'plan_refs',(group_value->'plan_refs')||jsonb_build_array(new_ref));
      groups:=jsonb_set(groups,array[key_value],group_value,true);
      if product_id_value is not null then
        select * into product from public.bloom_products p where p.id=product_id_value and p.household_id=p_household;
        if bloom_private.meal_convert(1,unit_name,product.package_unit) is null then
          plan_issues:=plan_issues||jsonb_build_array(item_name||': the recipe unit and catalog package unit need review before a package quantity or price can be calculated.');
        end if;
      end if;
    end loop;
    select coalesce(jsonb_agg(to_jsonb(message) order by first_seen),'[]'::jsonb) into plan_issues
      from(select value#>>'{}' as message,min(ordinality) as first_seen from jsonb_array_elements(plan_issues) with ordinality group by value) unique_issues;
    if plan.issues is distinct from plan_issues then update public.bloom_cooking_plans set issues=plan_issues where id=plan.id and household_id=p_household; end if;
  end loop;

  -- Combine exact shortages first. Whole packages can cover a later meal too;
  -- carry that unpurchased excess forward instead of rounding each recipe up.
  for group_row in select key,value from jsonb_each(groups) order by (value->>'needed_by')::date,(value->>'month')::date,key loop
    key_value:=group_row.key; group_value:=groups->key_value; wanted:=(group_value->>'quantity')::numeric;
    product_id_value:=nullif(group_value->>'product_id','')::uuid; unknown_value:=(group_value->>'unknown')::boolean;
    canonical_unit:=group_value->>'canonical_unit';
    if product_id_value is not null and not unknown_value then
      for i in 0..jsonb_array_length(leftovers)-1 loop
        exit when wanted<=0;
        pool:=leftovers->i;
        if pool->>'product_id'=product_id_value::text and (pool->>'month')::date<=(group_value->>'month')::date then
          available:=bloom_private.meal_convert((pool->>'quantity')::numeric,pool->>'unit',canonical_unit);
          if coalesce(available,0)>0 then
            take_quantity:=least(wanted,available); wanted:=greatest(wanted-take_quantity,0);
            amount:=greatest((pool->>'quantity')::numeric-bloom_private.meal_convert(take_quantity,canonical_unit,pool->>'unit'),0);
            leftovers:=jsonb_set(leftovers,array[i::text,'quantity'],to_jsonb(amount));
            old_group:=groups->(pool->>'group_key');
            groups:=jsonb_set(groups,array[pool->>'group_key'],old_group||jsonb_build_object('plan_refs',(old_group->'plan_refs')||(group_value->'plan_refs')));
          end if;
        end if;
      end loop;
    end if;
    packs_value:=null; estimate_value:=null; product:=null;
    if product_id_value is not null then
      select * into product from public.bloom_products p where p.id=product_id_value and p.household_id=p_household;
      converted:=bloom_private.meal_convert(wanted,canonical_unit,product.package_unit);
      if not unknown_value and converted is not null and converted>0 then
        packs_value:=ceil(converted/product.package_quantity);
        if packs_value>1000000000 then raise exception 'The required package quantity is too large.' using errcode='22023'; end if;
        if product.price_cents is not null then
          amount:=packs_value*product.price_cents;
          if amount>1000000000 then raise exception 'The planned estimated total is outside the supported range.' using errcode='22023'; end if;
          estimate_value:=amount::bigint;
        end if;
        amount:=greatest(packs_value*product.package_quantity-converted,0);
        if amount>0 then leftovers:=leftovers||jsonb_build_array(jsonb_build_object('product_id',product_id_value,'unit',product.package_unit,'quantity',amount,
          'month',group_value->>'month','group_key',key_value)); end if;
      end if;
    end if;
    groups:=jsonb_set(groups,array[key_value],group_value||jsonb_build_object('quantity',wanted,'packs',packs_value,'estimate_cents',estimate_value),true);
  end loop;

  for group_row in select key,value from jsonb_each(groups) order by (value->>'needed_by')::date,key loop
    group_value:=group_row.value; wanted:=(group_value->>'quantity')::numeric; unknown_value:=(group_value->>'unknown')::boolean;
    if not unknown_value and wanted<=0 then continue; end if;
    packs_value:=(group_value->>'packs')::numeric; estimate_value:=(group_value->>'estimate_cents')::bigint;
    unit_name:=group_value->>'unit'; display_quantity:=bloom_private.meal_convert(wanted,group_value->>'canonical_unit',unit_name);
    if unknown_value then
      quantity_label:='Review amount'||case when coalesce(display_quantity,0)>0 then ' · at least '||trim_scale(display_quantity)::text||' '||unit_name||' known' else '' end;
    elsif packs_value is not null then quantity_label:=packs_value::text||' pack(s) · '||trim_scale(display_quantity)::text||' '||unit_name||' needed';
    else quantity_label:=trim_scale(display_quantity)::text||' '||unit_name; end if;
    quantity_label:=left(quantity_label,120);
    shopping_id_value:=null;
    select l.shopping_id into shopping_id_value from public.bloom_meal_shopping_links l
      where l.household_id=p_household and l.group_key=group_row.key and l.managed and l.shopping_id=any(mutable)
      order by l.created_at,l.id limit 1;
    if shopping_id_value is null then
      shopping_id_value:=gen_random_uuid();
      insert into public.bloom_shopping_items(id,household_id,name,quantity,checked,source_key,month,product_id,packs,estimate_cents,category)
      values(shopping_id_value,p_household,group_value->>'name',quantity_label,false,'meal:'||shopping_id_value,
        (group_value->>'month')::date,nullif(group_value->>'product_id','')::uuid,packs_value,estimate_value,'food');
      created_count:=created_count+1;
    else
      update public.bloom_shopping_items set name=group_value->>'name',quantity=quantity_label,checked=false,
        month=(group_value->>'month')::date,product_id=nullif(group_value->>'product_id','')::uuid,packs=packs_value,estimate_cents=estimate_value,category='food'
      where id=shopping_id_value and household_id=p_household and
        (name is distinct from group_value->>'name' or quantity is distinct from quantity_label or checked or month is distinct from (group_value->>'month')::date
          or product_id is distinct from nullif(group_value->>'product_id','')::uuid or packs is distinct from packs_value
          or estimate_cents is distinct from estimate_value or category<>'food');
      get diagnostics row_count_value=row_count; updated_count:=updated_count+row_count_value;
    end if;
    retained:=array_append(retained,shopping_id_value);
    select to_jsonb(s)-array['revision','created_at','updated_at'] into snapshot_value from public.bloom_shopping_items s where s.id=shopping_id_value and s.household_id=p_household;
    select coalesce(jsonb_agg(value order by first_seen),'[]'::jsonb) into refs
      from(select value,min(ordinality) as first_seen from jsonb_array_elements(group_value->'plan_refs') with ordinality group by value) unique_refs;
    insert into public.bloom_meal_shopping_links(id,shopping_id,household_id,group_key,managed,plan_refs,needed_by,generated_snapshot)
    values(shopping_id_value,shopping_id_value,p_household,group_row.key,true,refs,(group_value->>'needed_by')::date,snapshot_value)
    on conflict(id) do update set plan_refs=excluded.plan_refs,needed_by=excluded.needed_by,generated_snapshot=excluded.generated_snapshot
    where bloom_meal_shopping_links.plan_refs is distinct from excluded.plan_refs
      or bloom_meal_shopping_links.needed_by is distinct from excluded.needed_by
      or bloom_meal_shopping_links.generated_snapshot is distinct from excluded.generated_snapshot;
  end loop;
  delete from public.bloom_shopping_items s where s.household_id=p_household and s.id=any(mutable) and not(s.id=any(retained));
  get diagnostics removed_count=row_count;
  return jsonb_build_object('created',created_count,'updated',updated_count,'removed',removed_count,'detached',detached_count,
    'preservedPurchased',frozen_count,'activeRows',cardinality(retained),'asOf',today_value);
end;
$$;

create function bloom_private.save_cooking_plan(p_plan jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; plan_id uuid; request_id_value uuid; expected bigint; recipe_expected bigint; recipe_id_value uuid;
  recipe public.bloom_recipes%rowtype; old_plan public.bloom_cooking_plans%rowtype; has_old boolean;
  cook_date date; quantity numeric; person1 numeric; person2 numeric; reviewed jsonb; required jsonb:='[]'; line jsonb; scaled numeric;
begin
  household:=bloom_private.food_lock_household();
  if not bloom_private.food_object_keys_ok(p_plan,array['id','request_id','revision','recipe_id','recipe_revision','cook_on','servings','person1_servings','person2_servings','notes','ingredients'])
    or octet_length(p_plan::text)>262144 then raise exception 'The cooking plan contains unsupported fields or is too large.' using errcode='22023'; end if;
  plan_id:=nullif(p_plan->>'id','')::uuid; request_id_value:=nullif(p_plan->>'request_id','')::uuid;
  if plan_id is null or request_id_value is null then raise exception 'The cooking plan needs its stable save identifiers.' using errcode='22023'; end if;
  select * into old_plan from public.bloom_cooking_plans p where p.id=plan_id and p.household_id=household for update;
  has_old:=found;
  if has_old and old_plan.status='cancelled' then raise exception 'This meal plan was cancelled. Start a new plan to schedule it again.' using errcode='23514'; end if;
  if has_old and old_plan.last_request_id=request_id_value then
    if old_plan.last_request_payload is distinct from p_plan then raise exception 'This save identifier already has different meal details. Refresh the saved plan.' using errcode='23505'; end if;
    return plan_id;
  end if;
  if exists(select 1 from public.bloom_cooking_plans p where p.household_id=household and p.last_request_id=request_id_value and p.id<>plan_id) then
    raise exception 'This save identifier already belongs to another meal plan.' using errcode='23505';
  end if;
  expected:=bloom_private.food_cents(p_plan->'revision','Meal plan revision',true);
  if has_old then
    if expected is null or expected<>old_plan.revision then raise exception 'This meal plan changed. Refresh it before saving your edits.' using errcode='40001'; end if;
  elsif expected is not null or exists(select 1 from public.bloom_cooking_plans p where p.id=plan_id) then
    raise exception 'This cooking plan is no longer available for this save.' using errcode='23505';
  end if;
  recipe_id_value:=nullif(p_plan->>'recipe_id','')::uuid;
  select * into recipe from public.bloom_recipes r where r.id=recipe_id_value and r.household_id=household and not r.archived for share;
  if not found then raise exception 'Choose an available saved recipe from this household.' using errcode='23514'; end if;
  recipe_expected:=bloom_private.food_cents(p_plan->'recipe_revision','Recipe revision');
  if recipe_expected<>recipe.revision then raise exception 'This recipe changed. Reload its latest ingredients and serving yield before saving the meal plan.' using errcode='40001'; end if;
  cook_date:=bloom_private.food_date(p_plan->>'cook_on','Cooking date',true);
  if cook_date not between '1900-01-01'::date and '2200-12-31'::date then raise exception 'Choose a supported cooking date.' using errcode='22023'; end if;
  if cook_date<(now() at time zone 'America/New_York')::date then raise exception 'Choose today or a future cooking date for this meal plan.' using errcode='22023'; end if;
  if jsonb_typeof(p_plan->'servings') is distinct from 'number' then raise exception 'Enter the number of servings to cook.' using errcode='22023'; end if;
  quantity:=(p_plan->>'servings')::numeric;
  if quantity<=0 or quantity>10000 then raise exception 'Choose a positive serving count up to 10,000.' using errcode='22023'; end if;
  person1:=null; person2:=null;
  if p_plan->'person1_servings' is not null and p_plan->'person1_servings'<>'null'::jsonb then
    if jsonb_typeof(p_plan->'person1_servings') is distinct from 'number' then raise exception 'Person 1 servings must be numeric or blank.' using errcode='22023'; end if;
    person1:=(p_plan->>'person1_servings')::numeric;
  end if;
  if p_plan->'person2_servings' is not null and p_plan->'person2_servings'<>'null'::jsonb then
    if jsonb_typeof(p_plan->'person2_servings') is distinct from 'number' then raise exception 'Person 2 servings must be numeric or blank.' using errcode='22023'; end if;
    person2:=(p_plan->>'person2_servings')::numeric;
  end if;
  if person1<0 or person2<0 or coalesce(person1,0)+coalesce(person2,0)>quantity then raise exception 'Assigned portions cannot exceed the servings you are cooking.' using errcode='22023'; end if;
  if char_length(coalesce(p_plan->>'notes',''))>4000 then raise exception 'Meal plan notes are too long.' using errcode='22023'; end if;
  reviewed:=bloom_private.meal_lines(p_plan->'ingredients',household,true);
  for line in select value from jsonb_array_elements(reviewed) loop
    if not (line->>'included')::boolean then continue; end if;
    scaled:=(line->>'quantity')::numeric*quantity/recipe.servings;
    if scaled>1000000000 then raise exception 'A scaled ingredient quantity is too large. Review the servings.' using errcode='22023'; end if;
    required:=required||jsonb_build_array((line-'included')||jsonb_build_object('quantity',scaled));
  end loop;
  if jsonb_array_length(required)=0 then raise exception 'Include at least one ingredient in this meal plan.' using errcode='22023'; end if;
  if has_old then
    update public.bloom_cooking_plans set recipe_id=recipe.id,recipe_revision=recipe.revision,recipe_name=recipe.name,base_servings=recipe.servings,
      cook_on=cook_date,servings=quantity,person1_servings=person1,person2_servings=person2,ingredients=reviewed,requirements=required,
      notes=coalesce(p_plan->>'notes',''),last_request_id=request_id_value,last_request_payload=p_plan
    where id=plan_id and household_id=household;
  else
    insert into public.bloom_cooking_plans(id,household_id,recipe_id,recipe_revision,recipe_name,base_servings,cook_on,shopping_month,servings,
      person1_servings,person2_servings,ingredients,requirements,notes,last_request_id,last_request_payload)
    values(plan_id,household,recipe.id,recipe.revision,recipe.name,recipe.servings,cook_date,date_trunc('month',now() at time zone 'America/New_York')::date,
      quantity,person1,person2,reviewed,required,coalesce(p_plan->>'notes',''),request_id_value,p_plan);
  end if;
  perform bloom_private.meal_reconcile(household);
  return plan_id;
end;
$$;

create function bloom_private.cancel_cooking_plan(p_id uuid,p_revision bigint,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; row_plan public.bloom_cooking_plans%rowtype; payload jsonb;
begin
  household:=bloom_private.food_lock_household();
  if p_id is null or p_request_id is null or p_revision is null or p_revision<1 then raise exception 'Review the saved meal before cancelling it.' using errcode='22023'; end if;
  payload:=jsonb_build_object('action','cancel','id',p_id,'revision',p_revision,'request_id',p_request_id);
  select * into row_plan from public.bloom_cooking_plans p where p.id=p_id and p.household_id=household for update;
  if not found then raise exception 'This meal plan is not in your household.' using errcode='42501'; end if;
  if row_plan.last_request_id=p_request_id then
    if row_plan.last_request_payload is distinct from payload then raise exception 'This request identifier already has different meal details.' using errcode='23505'; end if;
    return p_id;
  end if;
  if p_revision<>row_plan.revision then raise exception 'This meal plan changed. Refresh before cancelling it.' using errcode='40001'; end if;
  if row_plan.status='cancelled' then return p_id; end if;
  update public.bloom_cooking_plans set status='cancelled',last_request_id=p_request_id,last_request_payload=payload where id=p_id and household_id=household;
  perform bloom_private.meal_reconcile(household);
  return p_id;
end;
$$;
create function bloom_private.reconcile_meal_shopping()
returns jsonb language plpgsql security definer set search_path='' as $$
declare household uuid;
begin
  household:=bloom_private.food_lock_household();
  return bloom_private.meal_reconcile(household);
end;
$$;

create function public.bloom_save_cooking_plan(p_plan jsonb)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.save_cooking_plan(p_plan); $$;
create function public.bloom_cancel_cooking_plan(p_id uuid,p_revision bigint,p_request_id uuid)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.cancel_cooking_plan(p_id,p_revision,p_request_id); $$;
create function public.bloom_reconcile_meal_shopping()
returns jsonb language sql volatile security invoker set search_path='' as $$ select bloom_private.reconcile_meal_shopping(); $$;

revoke all on function bloom_private.meal_unit(text),bloom_private.meal_unit_family(text),bloom_private.meal_convert(numeric,text,text),
  bloom_private.meal_name(text),bloom_private.meal_requirement_key(uuid,date,jsonb),bloom_private.meal_batch_origin(uuid,uuid,uuid),
  bloom_private.meal_lines(jsonb,uuid,boolean),bloom_private.meal_validate_recipe(),
  bloom_private.meal_validate_plan_snapshot(),bloom_private.meal_validate_link(),
  bloom_private.meal_reserved_source(),bloom_private.meal_reconcile(uuid),bloom_private.save_cooking_plan(jsonb),
  bloom_private.cancel_cooking_plan(uuid,bigint,uuid),bloom_private.reconcile_meal_shopping() from public,anon,authenticated;
grant execute on function bloom_private.meal_unit(text),bloom_private.meal_lines(jsonb,uuid,boolean),
  bloom_private.save_cooking_plan(jsonb),bloom_private.cancel_cooking_plan(uuid,bigint,uuid),bloom_private.reconcile_meal_shopping() to authenticated;
revoke all on function public.bloom_save_cooking_plan(jsonb),public.bloom_cancel_cooking_plan(uuid,bigint,uuid),public.bloom_reconcile_meal_shopping() from public,anon,authenticated;
grant execute on function public.bloom_save_cooking_plan(jsonb),public.bloom_cancel_cooking_plan(uuid,bigint,uuid),public.bloom_reconcile_meal_shopping() to authenticated;

comment on column public.bloom_recipes.planning_ingredients is 'Reviewed whole-recipe shopping ingredients. Null quantities keep ambiguity visible; optional lines are excluded until chosen. Separate from nutrition ingredients.';
comment on table public.bloom_cooking_plans is 'Dated cooking intentions with captured recipe yield and reviewed ingredient quantities. Planning does not consume stock or record nutrition or spending.';
comment on table public.bloom_meal_shopping_links is 'Provenance for generated recipe shopping rows. Untouched unpurchased rows can be reconciled; manual changes and receipt-touched rows are preserved.';

-- Optional cookingPlans and mealShoppingLinks extend the same owner-only,
-- additive backup. Restoring history never replays a purchase or a meal.
create or replace function bloom_private.food_restore_row(p_table text, p_row jsonb, p_household uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare actual jsonb; candidate jsonb; k text; metadata_keys text[]; columns_sql text; values_sql text; ref uuid;
begin
  if p_table not in ('bloom_cooking_plans','bloom_meal_shopping_links','bloom_bill_rules','bloom_products','bloom_recurring_products','bloom_budgets','bloom_inventory','bloom_shopping_items','bloom_bills','bloom_recipes','bloom_meal_entries','bloom_receipts','bloom_money_entries','bloom_food_files') then
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

create or replace function bloom_private.restore_household_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; data jsonb; rows jsonb; row_value jsonb; k text;
  keys text[] := array['billRules','products','bills','recipes','cookingPlans','recurringProducts','budgets','receipts','moneyEntries','inventory','shoppingItems','mealShoppingLinks','mealEntries','foodFiles'];
  tables text[] := array['bloom_bill_rules','bloom_products','bloom_bills','bloom_recipes','bloom_cooking_plans','bloom_recurring_products','bloom_budgets','bloom_receipts','bloom_money_entries','bloom_inventory','bloom_shopping_items','bloom_meal_shopping_links','bloom_meal_entries','bloom_food_files'];
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

