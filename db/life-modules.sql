-- Life in Bloom: shared daily care and private practice/smoking records.
-- Apply after meal-planning.sql. No personal records or sample spending are seeded.
-- All writes use checked RPCs; a reference estimate is never a money event.

create function bloom_private.life_private_kind(p_kind text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_kind in ('skill','skill_session','smoking_settings','smoking_day');
$$;

create function bloom_private.life_number(p_data jsonb,p_key text,p_min numeric,p_max numeric,p_nullable boolean default false,p_integer boolean default false)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare value jsonb:=p_data->p_key; result numeric;
begin
  if value is null or value='null'::jsonb then
    if p_nullable then return null; end if;
    raise exception '% is required.',replace(p_key,'_',' ') using errcode='22023';
  end if;
  if jsonb_typeof(value)<>'number' then raise exception '% must be a number.',replace(p_key,'_',' ') using errcode='22023'; end if;
  result:=(value#>>'{}')::numeric;
  if result<p_min or result>p_max or (p_integer and result<>trunc(result)) then
    raise exception 'Check the allowed amount for %.',replace(p_key,'_',' ') using errcode='22023';
  end if;
  return result;
end;
$$;

create function bloom_private.life_text(p_data jsonb,p_key text,p_max integer,p_required boolean default false)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare value jsonb:=p_data->p_key; result text;
begin
  if value is null or value='null'::jsonb then
    if p_required then raise exception '% is required.',replace(p_key,'_',' ') using errcode='22023'; end if;
    return '';
  end if;
  if jsonb_typeof(value)<>'string' then raise exception '% must be text.',replace(p_key,'_',' ') using errcode='22023'; end if;
  result:=value#>>'{}';
  if char_length(result)>p_max or (p_required and btrim(result)='') then raise exception 'Check the text for %.',replace(p_key,'_',' ') using errcode='22023'; end if;
  return result;
end;
$$;

create function bloom_private.life_boolean(p_data jsonb,p_key text,p_default boolean default false)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if not (p_data ? p_key) then return p_default; end if;
  if jsonb_typeof(p_data->p_key) is distinct from 'boolean' then raise exception '% must be selected or cleared.',replace(p_key,'_',' ') using errcode='22023'; end if;
  return (p_data->>p_key)::boolean;
end;
$$;

create function bloom_private.life_date(p_value text,p_label text,p_required boolean default false,p_actual boolean default false)
returns date language plpgsql stable security invoker set search_path='' as $$
declare result date:=bloom_private.food_date(p_value,p_label,p_required);
begin
  if result is not null and (result<'1900-01-01'::date or result>'2200-12-31'::date) then
    raise exception '% must be a supported calendar date.',p_label using errcode='22023';
  end if;
  if p_actual and result>(now() at time zone 'America/New_York')::date then
    raise exception '% cannot be in the future. Save a schedule for a planned action.',p_label using errcode='22023';
  end if;
  return result;
end;
$$;

create function bloom_private.life_record_key(p_kind text,p_id uuid,p_data jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select case p_kind
    when 'hydration_settings' then p_data->>'person_slot'
    when 'dog_profile' then 'primary'
    when 'smoking_settings' then 'current'
    when 'smoking_day' then p_data->>'occurred_on'
    when 'routine_log' then (p_data->>'task_id')||'|'||(p_data->>'occurred_on')||'|'||coalesce(p_data->>'slot','')
    when 'dog_supply' then p_data->>'product_id'
    else p_id::text end;
$$;

create table public.bloom_life_records (
  id uuid primary key,
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check(kind in ('hydration_settings','hydration_entry','dog_profile','dog_weight','routine_task','routine_log','dog_note','dog_supply','dog_shopping_request','skill','skill_session','smoking_settings','smoking_day')),
  record_key text not null check(char_length(record_key) between 1 and 240),
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=65536),
  archived boolean not null default false,
  revision bigint not null default 1 check(revision>0),
  last_request_id uuid,
  last_request_payload jsonb check(last_request_payload is null or (jsonb_typeof(last_request_payload)='object' and octet_length(last_request_payload::text)<=131072)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((user_id is not null)=bloom_private.life_private_kind(kind)),
  unique(household_id,id),
  unique(household_id,last_request_id)
);
create unique index bloom_life_shared_key_idx on public.bloom_life_records(household_id,kind,record_key) where user_id is null and not archived;
create unique index bloom_life_private_key_idx on public.bloom_life_records(household_id,user_id,kind,record_key) where user_id is not null and not archived;
create index bloom_life_owner_idx on public.bloom_life_records(user_id,household_id,kind);
create index bloom_life_household_kind_idx on public.bloom_life_records(household_id,kind);
create index bloom_life_dog_product_idx on public.bloom_life_records(household_id,(data->>'product_id')) where kind='dog_supply';
create index bloom_life_parent_idx on public.bloom_life_records(household_id,(data->>'task_id')) where kind='routine_log';
create index bloom_life_skill_parent_idx on public.bloom_life_records(household_id,user_id,(data->>'skill_id')) where kind='skill_session';
create trigger bloom_life_revision before insert or update on public.bloom_life_records
for each row execute function bloom_private.guard_revision('id','household_id','user_id','kind','record_key','created_at');
alter table public.bloom_life_records enable row level security;
revoke all on public.bloom_life_records from public,anon,authenticated;
grant select on public.bloom_life_records to authenticated;
create policy bloom_life_read on public.bloom_life_records for select to authenticated
using(bloom_private.is_member(household_id) and (user_id is null or user_id=(select auth.uid())));

-- Strict per-kind validation applies to normal saves and restored snapshots.
create function bloom_private.life_validate_data(p_kind text,p_data jsonb,p_household uuid,p_user uuid)
returns void language plpgsql stable security invoker set search_path='' as $$
declare keys text[]; value text; entry jsonb; d date; last_day date; related uuid; other public.bloom_life_records%rowtype;
  n numeric; seen text[]:=array[]::text[]; snapshot jsonb;
begin
  keys:=case p_kind
    when 'hydration_settings' then array['person_slot','container_ml','goal_ml']
    when 'hydration_entry' then array['occurred_on','person_slot','amount_ml','container_ml','notes']
    when 'dog_profile' then array['name','breed','birth_on','notes']
    when 'dog_weight' then array['occurred_on','weight_kg','notes']
    when 'routine_task' then array['domain','name','category','frequency','interval_days','interval_months','anchor_on','end_on','times','rolling','active','dose_text','notes']
    when 'routine_log' then array['task_id','occurred_on','slot','person_slot','done','notes','task_snapshot']
    when 'dog_note' then array['occurred_on','kind','minutes','notes']
    when 'dog_supply' then array['product_id','name','unit_label','stock_quantity','refill_threshold','needs_refill','reference_price_cents','notes']
    when 'dog_shopping_request' then array['supply_id','shopping_id','product_id','month','packs']
    when 'skill' then array['name','category','memory_type','observed_level','notes']
    when 'skill_session' then array['skill_id','occurred_on','minutes','result','notes']
    when 'smoking_settings' then array['baseline_joints','baseline_cigars','baseline_grams_per_joint','price_per_gram_cents','cigar_price_cents','notes']
    when 'smoking_day' then array['occurred_on','joints','cigars','grams_per_joint','trigger_tags','notes','reference_snapshot']
    else null end;
  if keys is null or not bloom_private.food_object_keys_ok(p_data,keys) or octet_length(p_data::text)>65536 then
    raise exception 'This record has an unsupported type or fields.' using errcode='22023';
  end if;
  perform bloom_private.life_text(p_data,'notes',4000);
  if p_kind in ('hydration_entry','dog_weight','routine_log','dog_note','skill_session','smoking_day') then
    perform bloom_private.life_date(p_data->>'occurred_on','Recorded date',true,true);
  end if;
  if p_kind in ('hydration_settings','hydration_entry','routine_log') then
    perform bloom_private.life_number(p_data,'person_slot',1,2,false,true);
  end if;
  case p_kind
    when 'hydration_settings' then
      perform bloom_private.life_number(p_data,'container_ml',1,10000);
      perform bloom_private.life_number(p_data,'goal_ml',1,30000,true);
    when 'hydration_entry' then
      perform bloom_private.life_number(p_data,'amount_ml',1,30000);
      perform bloom_private.life_number(p_data,'container_ml',1,10000);
    when 'dog_profile' then
      perform bloom_private.life_text(p_data,'name',160,true);
      perform bloom_private.life_text(p_data,'breed',160);
      perform bloom_private.life_date(p_data->>'birth_on','Date of birth',false,true);
    when 'dog_weight' then
      perform bloom_private.life_number(p_data,'weight_kg',0.001,300);
    when 'routine_task' then
      if p_data->>'domain' is null or p_data->>'domain' not in ('dog','housework') then raise exception 'Choose Dog or Housework for this routine.' using errcode='22023'; end if;
      perform bloom_private.life_text(p_data,'name',160,true);
      if p_data->>'category' is null or p_data->>'category' not in ('feeding','movement','dental','grooming','medication','vet','training','other') then raise exception 'Choose a supported routine category.' using errcode='22023'; end if;
      if p_data->>'frequency' is null or p_data->>'frequency' not in ('daily','interval','monthly','once') then raise exception 'Choose a supported repeat schedule.' using errcode='22023'; end if;
      perform bloom_private.life_number(p_data,'interval_days',1,3660,false,true);
      perform bloom_private.life_number(p_data,'interval_months',1,120,false,true);
      d:=bloom_private.life_date(p_data->>'anchor_on','Routine start',true);
      last_day:=bloom_private.life_date(p_data->>'end_on','Routine end');
      if last_day<d then raise exception 'The routine end cannot be before its start.' using errcode='22023'; end if;
      if jsonb_typeof(p_data->'times') is distinct from 'array' or jsonb_array_length(p_data->'times')>8 then raise exception 'Choose up to eight daily routine times.' using errcode='22023'; end if;
      for entry in select x from jsonb_array_elements(p_data->'times') x loop
        value:=entry#>>'{}';
        if jsonb_typeof(entry)<>'string' or value!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or value=any(seen) then raise exception 'Routine times must be different valid times.' using errcode='22023'; end if;
        seen:=array_append(seen,value);
      end loop;
      perform bloom_private.life_boolean(p_data,'rolling');
      perform bloom_private.life_boolean(p_data,'active',true);
      perform bloom_private.life_text(p_data,'dose_text',500);
    when 'routine_log' then
      related:=nullif(p_data->>'task_id','')::uuid;
      select * into other from public.bloom_life_records where id=related and household_id=p_household and kind='routine_task' and user_id is null;
      if not found then raise exception 'Choose a routine from this household.' using errcode='23514'; end if;
      value:=bloom_private.life_text(p_data,'slot',5);
      if value<>'' and value!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Choose a valid routine time.' using errcode='22023'; end if;
      perform bloom_private.life_boolean(p_data,'done');
      snapshot:=p_data->'task_snapshot';
      if jsonb_typeof(snapshot) is distinct from 'object' then raise exception 'A care log needs its saved routine details.' using errcode='23514'; end if;
      perform bloom_private.life_number(snapshot,'task_revision',1,1000000000,false,true);
      perform bloom_private.life_validate_data('routine_task',snapshot-'task_revision',p_household,null);
    when 'dog_note' then
      if p_data->>'kind' is null or p_data->>'kind' not in ('behavior','training') then raise exception 'Choose Behavior or Training.' using errcode='22023'; end if;
      perform bloom_private.life_number(p_data,'minutes',0,1440,true);
      perform bloom_private.life_text(p_data,'notes',4000,true);
    when 'dog_supply' then
      related:=nullif(p_data->>'product_id','')::uuid;
      if related is null or not exists(select 1 from public.bloom_products where id=related and household_id=p_household and category='household') then
        raise exception 'A dog supply must link to a Household catalog product from this household.' using errcode='23514';
      end if;
      perform bloom_private.life_text(p_data,'name',160,true);
      perform bloom_private.life_text(p_data,'unit_label',80,true);
      perform bloom_private.life_number(p_data,'stock_quantity',0,1000000000);
      perform bloom_private.life_number(p_data,'refill_threshold',0,1000000000);
      perform bloom_private.life_boolean(p_data,'needs_refill');
      perform bloom_private.life_number(p_data,'reference_price_cents',0,1000000000,true,true);
    when 'dog_shopping_request' then
      related:=nullif(p_data->>'supply_id','')::uuid;
      select * into other from public.bloom_life_records where id=related and household_id=p_household and kind='dog_supply';
      if not found or other.data->>'product_id' is distinct from p_data->>'product_id' then raise exception 'This shopping request does not match its dog supply.' using errcode='23514'; end if;
      related:=nullif(p_data->>'shopping_id','')::uuid;
      if related is null or exists(select 1 from public.bloom_shopping_items where id=related and household_id<>p_household) then raise exception 'The dog shopping reference is outside this household.' using errcode='23514'; end if;
      d:=bloom_private.life_date(p_data->>'month','Shopping month',true);
      if extract(day from d)<>1 then raise exception 'Choose a calendar shopping month.' using errcode='22023'; end if;
      perform bloom_private.life_number(p_data,'packs',0.000001,1000000);
    when 'skill' then
      perform bloom_private.life_text(p_data,'name',160,true);
      perform bloom_private.life_text(p_data,'category',80,true);
      if p_data->>'memory_type' is null or p_data->>'memory_type' not in ('procedural','knowledge','mixed') then raise exception 'Choose a supported practice type.' using errcode='22023'; end if;
      perform bloom_private.life_number(p_data,'observed_level',1,10,true,true);
    when 'skill_session' then
      related:=nullif(p_data->>'skill_id','')::uuid;
      if related is null or not exists(select 1 from public.bloom_life_records where id=related and household_id=p_household and kind='skill' and user_id=p_user) then raise exception 'Choose one of your own skills.' using errcode='23514'; end if;
      perform bloom_private.life_number(p_data,'minutes',0,1440);
      if p_data->>'result' is null or p_data->>'result' not in ('practice','again','hard','good','easy') then raise exception 'Choose a practice or recall result.' using errcode='22023'; end if;
    when 'smoking_settings' then
      perform bloom_private.life_number(p_data,'baseline_joints',0,1000,true,true);
      perform bloom_private.life_number(p_data,'baseline_cigars',0,1000,true,true);
      perform bloom_private.life_number(p_data,'baseline_grams_per_joint',0.001,100);
      perform bloom_private.life_number(p_data,'price_per_gram_cents',0,1000000000,true,true);
      perform bloom_private.life_number(p_data,'cigar_price_cents',0,1000000000,true,true);
    when 'smoking_day' then
      perform bloom_private.life_number(p_data,'joints',0,1000,false,true);
      perform bloom_private.life_number(p_data,'cigars',0,1000,false,true);
      perform bloom_private.life_number(p_data,'grams_per_joint',0.001,100);
      if jsonb_typeof(p_data->'trigger_tags') is distinct from 'array' or jsonb_array_length(p_data->'trigger_tags')>20 then raise exception 'Choose up to twenty craving or trigger tags.' using errcode='22023'; end if;
      for entry in select x from jsonb_array_elements(p_data->'trigger_tags') x loop
        if jsonb_typeof(entry)<>'string' or char_length(btrim(entry#>>'{}')) not between 1 and 80 then raise exception 'A trigger tag is invalid.' using errcode='22023'; end if;
      end loop;
      snapshot:=p_data->'reference_snapshot';
      if not bloom_private.food_object_keys_ok(snapshot,array['baseline_joints','baseline_cigars','baseline_grams_per_joint','price_per_gram_cents','cigar_price_cents','settings_id','settings_revision']) then raise exception 'The smoking reference snapshot is invalid.' using errcode='23514'; end if;
      perform bloom_private.life_number(snapshot,'baseline_joints',0,1000,true,true);
      perform bloom_private.life_number(snapshot,'baseline_cigars',0,1000,true,true);
      perform bloom_private.life_number(snapshot,'baseline_grams_per_joint',0.001,100,true);
      perform bloom_private.life_number(snapshot,'price_per_gram_cents',0,1000000000,true,true);
      perform bloom_private.life_number(snapshot,'cigar_price_cents',0,1000000000,true,true);
      perform bloom_private.life_number(snapshot,'settings_revision',1,1000000000,true,true);
      related:=nullif(snapshot->>'settings_id','')::uuid;
    else raise exception 'Unsupported record type.' using errcode='22023';
  end case;
end;
$$;

create function bloom_private.life_validate_row()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if NEW.record_key is distinct from bloom_private.life_record_key(NEW.kind,NEW.id,NEW.data) then
    raise exception 'The record key does not match its saved details.' using errcode='23514';
  end if;
  if NEW.kind='dog_supply' then
    -- Serialize a new link against concurrent catalog category edits/deletion.
    perform 1 from public.bloom_products p where p.id=nullif(NEW.data->>'product_id','')::uuid and p.household_id=NEW.household_id for share;
  end if;
  perform bloom_private.life_validate_data(NEW.kind,NEW.data,NEW.household_id,NEW.user_id);
  return NEW;
end;
$$;
create trigger bloom_life_validation before insert or update on public.bloom_life_records
for each row execute function bloom_private.life_validate_row();

create function bloom_private.save_life_record(p_record jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); household uuid; target uuid; request uuid; owner_value uuid; kind_value text; content jsonb;
  expected bigint; old public.bloom_life_records%rowtype; related public.bloom_life_records%rowtype; has_old boolean;
  key_value text; archived_value boolean; product uuid; price numeric; reference jsonb;
begin
  household:=bloom_private.food_lock_household();
  if not bloom_private.food_object_keys_ok(p_record,array['id','request_id','revision','kind','data','archived','expected_household_id','expected_user_id']) or octet_length(p_record::text)>131072 then
    raise exception 'The saved record contains unsupported fields.' using errcode='22023';
  end if;
  if nullif(p_record->>'expected_household_id','')::uuid is distinct from household
    or nullif(p_record->>'expected_user_id','')::uuid is distinct from actor then
    raise exception 'Your account or household changed. Reload before saving this record.' using errcode='42501';
  end if;
  target:=nullif(p_record->>'id','')::uuid; request:=nullif(p_record->>'request_id','')::uuid;
  kind_value:=p_record->>'kind'; content:=p_record->'data';
  if target is null or request is null then raise exception 'This record needs its stable save identifiers.' using errcode='22023'; end if;
  if kind_value='dog_shopping_request' then raise exception 'Dog shopping references are saved through the shopping action.' using errcode='42501'; end if;
  owner_value:=case when bloom_private.life_private_kind(kind_value) then actor else null end;
  select * into old from public.bloom_life_records where id=target and household_id=household and user_id is not distinct from owner_value for update;
  has_old:=found;
  if has_old and old.archived then raise exception 'This record was archived. Create a new entry to log it again.' using errcode='23514'; end if;
  if has_old and old.last_request_id=request then
    if old.last_request_payload is distinct from p_record then raise exception 'This save identifier has different details. Reload the saved entry.' using errcode='23505'; end if;
    return target;
  end if;
  if exists(select 1 from public.bloom_life_records where household_id=household and last_request_id=request) then raise exception 'This save identifier was already used. Reload the saved entry.' using errcode='23505'; end if;
  expected:=bloom_private.food_cents(p_record->'revision','Record revision',true);
  if has_old then
    if old.kind is distinct from kind_value then raise exception 'A saved record cannot change its type.' using errcode='23514'; end if;
    if expected is null or expected<>old.revision then raise exception 'This record changed. Reload it before saving your changes.' using errcode='40001'; end if;
  elsif expected is not null or exists(select 1 from public.bloom_life_records where id=target) then
    raise exception 'This record is not available for this save.' using errcode='42501';
  end if;
  archived_value:=bloom_private.life_boolean(p_record,'archived',false);
  if archived_value then raise exception 'Use the archive action to keep this record in history.' using errcode='22023'; end if;

  if kind_value='dog_supply' then
    product:=nullif(content->>'product_id','')::uuid;
    if has_old and product is distinct from (old.data->>'product_id')::uuid then raise exception 'A dog supply keeps its catalog product. Create another supply for a different product.' using errcode='23514'; end if;
    if product is null then
      perform bloom_private.life_text(content,'name',160,true);
      perform bloom_private.life_text(content,'unit_label',80,true);
      price:=bloom_private.life_number(content,'reference_price_cents',0,1000000000,true,true);
      product:=gen_random_uuid();
      insert into public.bloom_products(id,household_id,name,category,aisle,package_quantity,package_unit,item_label,price_cents,price_date,notes)
      values(product,household,btrim(content->>'name'),'household','household',1,'each',content->>'unit_label',price,
        case when price is null then null else (now() at time zone 'America/New_York')::date end,
        'Dog supply. Stock is tracked as packages in Dog, separately from human food inventory.');
      content:=content||jsonb_build_object('product_id',product);
    end if;
  elsif kind_value='routine_log' then
    if has_old then content:=content||jsonb_build_object('task_snapshot',old.data->'task_snapshot');
    else
      select * into related from public.bloom_life_records where id=nullif(content->>'task_id','')::uuid and household_id=household and kind='routine_task';
      if not found then raise exception 'Choose a routine from this household.' using errcode='23514'; end if;
      content:=content||jsonb_build_object('task_snapshot',related.data||jsonb_build_object('task_revision',related.revision));
    end if;
  elsif kind_value='smoking_day' then
    if has_old then content:=content||jsonb_build_object('reference_snapshot',old.data->'reference_snapshot');
    else
      select * into related from public.bloom_life_records where household_id=household and user_id=actor and kind='smoking_settings' and not archived;
      reference:=jsonb_build_object('baseline_joints',related.data->'baseline_joints','baseline_cigars',related.data->'baseline_cigars',
        'baseline_grams_per_joint',related.data->'baseline_grams_per_joint','price_per_gram_cents',related.data->'price_per_gram_cents',
        'cigar_price_cents',related.data->'cigar_price_cents','settings_id',related.id,'settings_revision',related.revision);
      content:=content||jsonb_build_object('reference_snapshot',reference);
    end if;
  end if;
  perform bloom_private.life_validate_data(kind_value,content,household,owner_value);
  key_value:=bloom_private.life_record_key(kind_value,target,content);
  if has_old then
    if key_value is distinct from old.record_key then raise exception 'A saved daily entry keeps its date, person or routine. Archive it and create a corrected entry instead.' using errcode='23514'; end if;
    update public.bloom_life_records set data=content,last_request_id=request,last_request_payload=p_record where id=target and household_id=household;
  else
    insert into public.bloom_life_records(id,household_id,user_id,kind,record_key,data,last_request_id,last_request_payload)
    values(target,household,owner_value,kind_value,key_value,content,request,p_record);
  end if;
  return target;
end;
$$;

create function bloom_private.archive_life_record(p_id uuid,p_revision bigint,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; old public.bloom_life_records%rowtype; payload jsonb;
begin
  household:=bloom_private.food_lock_household();
  if p_request_id is null then raise exception 'The archive action needs its stable identifier.' using errcode='22023'; end if;
  select * into old from public.bloom_life_records where id=p_id and household_id=household and (user_id is null or user_id=auth.uid()) for update;
  if not found then raise exception 'This record is not available to your account.' using errcode='42501'; end if;
  if old.kind='dog_shopping_request' then raise exception 'Shopping references remain with their history.' using errcode='42501'; end if;
  payload:=jsonb_build_object('action','archive','id',p_id,'revision',p_revision,'request_id',p_request_id);
  if old.last_request_id=p_request_id then
    if old.last_request_payload is distinct from payload then raise exception 'This action identifier was used for different details.' using errcode='23505'; end if;
    return p_id;
  end if;
  if old.archived then raise exception 'This entry is already archived.' using errcode='23514'; end if;
  if p_revision is null or p_revision<>old.revision then raise exception 'This record changed. Reload it before archiving.' using errcode='40001'; end if;
  if exists(select 1 from public.bloom_life_records where household_id=household and last_request_id=p_request_id) then raise exception 'This action identifier was already used.' using errcode='23505'; end if;
  update public.bloom_life_records set archived=true,last_request_id=p_request_id,last_request_payload=payload where id=p_id and household_id=household;
  return p_id;
end;
$$;

create function public.bloom_save_life_record(p_record jsonb)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.save_life_record(p_record); $$;
create function public.bloom_archive_life_record(p_id uuid,p_revision bigint,p_request_id uuid)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.archive_life_record(p_id,p_revision,p_request_id); $$;

-- Pet supplies use Household-category catalog packages. They never enter human
-- pantry quantities or nutrition, and their receipts use the existing ledger.
create function bloom_private.life_dog_product_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (TG_OP='DELETE' or NEW.category<>'household') and exists(
    select 1 from public.bloom_life_records s where s.household_id=OLD.household_id and s.kind='dog_supply' and s.data->>'product_id'=OLD.id::text
  ) then
    raise exception 'This catalog product belongs to Dog supplies. Keep it in Household, or create a different product for human food.' using errcode='23514';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$$;
create trigger bloom_dog_product_guard before update of category or delete on public.bloom_products
for each row execute function bloom_private.life_dog_product_guard();

create table public.bloom_dog_stock_effects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  receipt_id uuid not null,
  supply_id uuid not null,
  product_id uuid not null,
  purchased_on date not null check(isfinite(purchased_on)),
  supply_name text not null check(char_length(btrim(supply_name)) between 1 and 160),
  unit_label text not null check(char_length(btrim(unit_label)) between 1 and 80),
  quantity numeric not null check(quantity>0 and quantity<=1000000000),
  amount_cents bigint not null check(amount_cents between 0 and 1000000000),
  quantity_before numeric not null check(quantity_before between 0 and 1000000000),
  quantity_after numeric not null check(quantity_after between 0 and 1000000000 and quantity_after=quantity_before+quantity),
  needs_refill_before boolean not null,
  needs_refill_after boolean not null default false check(not needs_refill_after),
  created_at timestamptz not null default now() check(isfinite(created_at)),
  voided_at timestamptz check(voided_at is null or isfinite(voided_at)),
  foreign key(household_id,receipt_id) references public.bloom_receipts(household_id,id),
  foreign key(household_id,supply_id) references public.bloom_life_records(household_id,id),
  foreign key(household_id,product_id) references public.bloom_products(household_id,id),
  unique(household_id,receipt_id,supply_id)
);
create index bloom_dog_stock_supply_idx on public.bloom_dog_stock_effects(household_id,supply_id);
create index bloom_dog_stock_product_idx on public.bloom_dog_stock_effects(household_id,product_id);
alter table public.bloom_dog_stock_effects enable row level security;
revoke all on public.bloom_dog_stock_effects from public,anon,authenticated;
grant select on public.bloom_dog_stock_effects to authenticated;
create policy bloom_dog_stock_read on public.bloom_dog_stock_effects for select to authenticated
using(bloom_private.is_member(household_id));

create function bloom_private.life_validate_dog_effect()
returns trigger language plpgsql security invoker set search_path='' as $$
declare receipt public.bloom_receipts%rowtype; amount numeric; quantity_value numeric;
begin
  if TG_OP='UPDATE' then
    if (to_jsonb(NEW)-'voided_at') is distinct from (to_jsonb(OLD)-'voided_at')
      or (OLD.voided_at is not null and NEW.voided_at is distinct from OLD.voided_at) then
      raise exception 'Dog purchase history can only be reversed with its original receipt.' using errcode='23514';
    end if;
  end if;
  if not exists(select 1 from public.bloom_life_records s where s.id=NEW.supply_id and s.household_id=NEW.household_id
    and s.kind='dog_supply' and s.user_id is null and s.data->>'product_id'=NEW.product_id::text) then
    raise exception 'The dog purchase does not match its household supply.' using errcode='23514';
  end if;
  select * into receipt from public.bloom_receipts r where r.id=NEW.receipt_id and r.household_id=NEW.household_id;
  if not found or receipt.purchased_on<>NEW.purchased_on or receipt.voided_at is distinct from NEW.voided_at then
    raise exception 'The dog purchase does not match its original receipt date or reversal.' using errcode='23514';
  end if;
  select sum((item->>'packs')::numeric),sum((item->>'line_total_cents')::numeric) into quantity_value,amount
    from jsonb_array_elements(receipt.items) item where item->>'product_id'=NEW.product_id::text and item->>'category'='household';
  if quantity_value is null or quantity_value<>NEW.quantity or amount<>NEW.amount_cents then
    raise exception 'Dog stock and cost must match the actual receipt lines.' using errcode='23514';
  end if;
  return NEW;
end;
$$;
create trigger bloom_dog_stock_effect_check before insert or update on public.bloom_dog_stock_effects
for each row execute function bloom_private.life_validate_dog_effect();

create function bloom_private.life_apply_dog_receipt(p_household uuid,p_receipt uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare receipt public.bloom_receipts%rowtype; supply public.bloom_life_records%rowtype;
  quantity_value numeric; amount bigint; before_quantity numeric; after_quantity numeric;
begin
  select * into receipt from public.bloom_receipts r where r.id=p_receipt and r.household_id=p_household and r.voided_at is null;
  if not found then raise exception 'The confirmed receipt is unavailable for dog stock.' using errcode='23514'; end if;
  for supply in select s.* from public.bloom_life_records s where s.household_id=p_household and s.kind='dog_supply' and not s.archived
    and exists(select 1 from jsonb_array_elements(receipt.items) item where item->>'product_id'=s.data->>'product_id' and item->>'category'='household')
    order by s.id for update loop
    if exists(select 1 from public.bloom_dog_stock_effects e where e.household_id=p_household and e.receipt_id=p_receipt and e.supply_id=supply.id) then continue; end if;
    select sum((item->>'packs')::numeric),sum((item->>'line_total_cents')::numeric)::bigint into quantity_value,amount
      from jsonb_array_elements(receipt.items) item where item->>'product_id'=supply.data->>'product_id' and item->>'category'='household';
    before_quantity:=(supply.data->>'stock_quantity')::numeric; after_quantity:=before_quantity+quantity_value;
    if after_quantity>1000000000 then raise exception 'The dog stock total is outside the supported range.' using errcode='22023'; end if;
    update public.bloom_life_records set data=jsonb_set(jsonb_set(data,'{stock_quantity}',to_jsonb(after_quantity)),'{needs_refill}','false'::jsonb)
      where id=supply.id and household_id=p_household;
    insert into public.bloom_dog_stock_effects(household_id,receipt_id,supply_id,product_id,purchased_on,supply_name,unit_label,quantity,amount_cents,
      quantity_before,quantity_after,needs_refill_before,needs_refill_after)
    values(p_household,p_receipt,supply.id,(supply.data->>'product_id')::uuid,receipt.purchased_on,supply.data->>'name',supply.data->>'unit_label',quantity_value,amount,
      before_quantity,after_quantity,coalesce((supply.data->>'needs_refill')::boolean,false),false);
  end loop;
end;
$$;

-- Keep the proven checkout/reversal implementations intact. These wrappers add
-- dog effects only for a newly accepted purchase. Backup inserts never run them.
alter function bloom_private.record_receipt(jsonb) rename to record_receipt_before_life;
alter function bloom_private.void_receipt(uuid) rename to void_receipt_before_life;
revoke all on function bloom_private.record_receipt_before_life(jsonb),bloom_private.void_receipt_before_life(uuid) from public,anon,authenticated;

create function bloom_private.record_receipt(p_receipt jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; receipt uuid; existed boolean;
begin
  household:=bloom_private.food_lock_household();
  receipt:=nullif(p_receipt->>'id','')::uuid;
  select exists(select 1 from public.bloom_receipts where household_id=household and id=receipt) into existed;
  receipt:=bloom_private.record_receipt_before_life(p_receipt);
  if not existed then perform bloom_private.life_apply_dog_receipt(household,receipt); end if;
  return receipt;
end;
$$;

create function bloom_private.void_receipt(p_receipt_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare household uuid; effect public.bloom_dog_stock_effects%rowtype; supply public.bloom_life_records%rowtype;
  receipt public.bloom_receipts%rowtype; reversed_at timestamptz; refill_value boolean;
begin
  household:=bloom_private.food_lock_household();
  select * into receipt from public.bloom_receipts r where r.id=p_receipt_id and r.household_id=household for update;
  if not found then raise exception 'This receipt is not available in your household.' using errcode='42501'; end if;
  if receipt.voided_at is not null then return; end if;
  for effect in select e.* from public.bloom_dog_stock_effects e where e.household_id=household and e.receipt_id=p_receipt_id and e.voided_at is null order by e.supply_id for update loop
    select * into supply from public.bloom_life_records s where s.id=effect.supply_id and s.household_id=household for update;
    if not found or (supply.data->>'stock_quantity')::numeric is distinct from effect.quantity_after then
      raise exception 'Dog stock from this receipt has changed or been used. Review the stock correction before reversing this receipt.' using errcode='23514';
    end if;
  end loop;
  perform bloom_private.void_receipt_before_life(p_receipt_id);
  select r.voided_at into reversed_at from public.bloom_receipts r where r.id=p_receipt_id and r.household_id=household;
  for effect in select e.* from public.bloom_dog_stock_effects e where e.household_id=household and e.receipt_id=p_receipt_id and e.voided_at is null order by e.supply_id loop
    select * into supply from public.bloom_life_records s where s.id=effect.supply_id and s.household_id=household;
    refill_value:=case when coalesce((supply.data->>'needs_refill')::boolean,false)=effect.needs_refill_after then effect.needs_refill_before else (supply.data->>'needs_refill')::boolean end;
    update public.bloom_life_records set data=jsonb_set(jsonb_set(data,'{stock_quantity}',to_jsonb(effect.quantity_before)),'{needs_refill}',to_jsonb(coalesce(refill_value,false)))
      where id=effect.supply_id and household_id=household;
    update public.bloom_dog_stock_effects set voided_at=reversed_at where id=effect.id and household_id=household;
  end loop;
end;
$$;

create or replace function public.bloom_record_receipt(p_receipt jsonb)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.record_receipt(p_receipt); $$;
create or replace function public.bloom_void_receipt(p_receipt_id uuid)
returns void language sql volatile security invoker set search_path='' as $$ select bloom_private.void_receipt(p_receipt_id); $$;

create function bloom_private.add_dog_supply_to_shopping(p_id uuid,p_request_id uuid,p_month date,p_packs numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; supply public.bloom_life_records%rowtype; saved public.bloom_life_records%rowtype; product public.bloom_products%rowtype;
  target uuid; payload jsonb; content jsonb; price numeric; amount numeric;
begin
  household:=bloom_private.food_lock_household();
  if p_id is null or p_request_id is null or p_month is null or not isfinite(p_month) or extract(day from p_month)<>1
    or p_month<'1900-01-01'::date or p_month>'2200-12-01'::date or p_packs is null or p_packs<=0 or p_packs>1000000 then
    raise exception 'Choose a dog supply, shopping month and positive package quantity.' using errcode='22023';
  end if;
  payload:=jsonb_build_object('supply_id',p_id,'request_id',p_request_id,'month',p_month,'packs',p_packs);
  select * into saved from public.bloom_life_records where id=p_request_id and household_id=household and kind='dog_shopping_request';
  if found then
    if saved.last_request_payload is distinct from payload then raise exception 'This shopping request identifier has different details.' using errcode='23505'; end if;
    target:=(saved.data->>'shopping_id')::uuid;
    if not exists(select 1 from public.bloom_shopping_items s where s.id=target and s.household_id=household and s.product_id=(saved.data->>'product_id')::uuid and s.month=p_month and s.category='household') then
      raise exception 'The earlier shopping item was removed or changed. Review your list before adding another request.' using errcode='23514';
    end if;
    return target;
  end if;
  if exists(select 1 from public.bloom_life_records where id=p_request_id or (household_id=household and last_request_id=p_request_id)) then
    raise exception 'This shopping request identifier was already used.' using errcode='23505';
  end if;
  select * into supply from public.bloom_life_records where id=p_id and household_id=household and kind='dog_supply' and not archived for update;
  if not found then raise exception 'Choose an active dog supply from this household.' using errcode='42501'; end if;
  select * into product from public.bloom_products p where p.id=(supply.data->>'product_id')::uuid and p.household_id=household and p.category='household' and not p.archived for share;
  if not found then raise exception 'The dog supply needs an active Household catalog product.' using errcode='23514'; end if;
  select s.id into target from public.bloom_shopping_items s where s.household_id=household and s.month=p_month and s.product_id=product.id
    and s.category='household' and not s.checked and not exists(select 1 from public.bloom_receipts r where r.household_id=household and r.voided_at is null
      and r.shopping_effects @> jsonb_build_array(jsonb_build_object('id',s.id,'after',jsonb_build_object('checked',true))))
    order by s.created_at,s.id limit 1 for update;
  if target is null then
    target:=p_request_id;
    price:=coalesce((supply.data->>'reference_price_cents')::numeric,product.price_cents);
    amount:=case when price is null then null else round(p_packs*price) end;
    if amount>1000000000 then raise exception 'The shopping estimate is outside the supported range.' using errcode='22023'; end if;
    insert into public.bloom_shopping_items(id,household_id,name,quantity,checked,source_key,month,product_id,packs,estimate_cents,category)
    values(target,household,supply.data->>'name',trim_scale(p_packs)::text||' '||(supply.data->>'unit_label'),false,'dog:'||p_id||':'||p_request_id,p_month,product.id,p_packs,amount,'household');
  end if;
  content:=jsonb_build_object('supply_id',p_id,'shopping_id',target,'product_id',product.id,'month',p_month,'packs',p_packs);
  insert into public.bloom_life_records(id,household_id,user_id,kind,record_key,data,last_request_id,last_request_payload)
  values(p_request_id,household,null,'dog_shopping_request',p_request_id::text,content,p_request_id,payload);
  return target;
end;
$$;

create function public.bloom_add_dog_supply_to_shopping(p_id uuid,p_request_id uuid,p_month date,p_packs numeric)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.add_dog_supply_to_shopping(p_id,p_request_id,p_month,p_packs); $$;

-- Restores are additive. Shared backups cannot contain personal practice or
-- smoking; a personal restore must name the signed-in user and their household.
create function bloom_private.life_restore_record(p_row jsonb,p_household uuid,p_user uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare value public.bloom_life_records%rowtype; actual public.bloom_life_records%rowtype; payload jsonb;
begin
  if not bloom_private.food_object_keys_ok(p_row,array['id','household_id','user_id','kind','record_key','data','archived','revision','last_request_id','last_request_payload','created_at','updated_at'])
    or nullif(p_row->>'household_id','')::uuid is distinct from p_household
    or nullif(p_row->>'user_id','')::uuid is distinct from p_user
    or (p_user is not null) is distinct from bloom_private.life_private_kind(p_row->>'kind') then
    raise exception 'A life backup record has unsupported fields or belongs to another account.' using errcode='42501';
  end if;
  select * into value from jsonb_populate_record(null::public.bloom_life_records,p_row);
  if value.id is null or value.archived is null or value.data is null or value.record_key is distinct from bloom_private.life_record_key(value.kind,value.id,value.data) then
    raise exception 'The life backup record is missing its identity or saved details.' using errcode='22023';
  end if;
  perform bloom_private.life_validate_data(value.kind,value.data,p_household,p_user);
  if (value.last_request_id is null) is distinct from (value.last_request_payload is null) then
    raise exception 'The saved request metadata is incomplete.' using errcode='22023';
  end if;
  payload:=value.last_request_payload;
  if payload is not null then
    if value.kind='dog_shopping_request' then
      if not bloom_private.food_object_keys_ok(payload,array['supply_id','request_id','month','packs'])
        or (payload->>'request_id')::uuid is distinct from value.last_request_id
        or value.id is distinct from value.last_request_id
        or payload->'supply_id' is distinct from value.data->'supply_id'
        or payload->'month' is distinct from value.data->'month'
        or payload->'packs' is distinct from value.data->'packs' or value.archived then
        raise exception 'A saved dog shopping request is inconsistent.' using errcode='23514';
      end if;
    elsif payload->>'action'='archive' then
      if not bloom_private.food_object_keys_ok(payload,array['action','id','revision','request_id']) or not value.archived
        or (payload->>'id')::uuid is distinct from value.id or (payload->>'request_id')::uuid is distinct from value.last_request_id then
        raise exception 'A saved archive request is inconsistent.' using errcode='23514';
      end if;
    elsif not bloom_private.food_object_keys_ok(payload,array['id','request_id','revision','kind','data','archived','expected_household_id','expected_user_id'])
      or (payload->>'id')::uuid is distinct from value.id or (payload->>'request_id')::uuid is distinct from value.last_request_id
      or payload->>'kind' is distinct from value.kind or jsonb_typeof(payload->'data') is distinct from 'object'
      or value.archived then
      raise exception 'A saved life request is inconsistent.' using errcode='23514';
    end if;
    -- Older backups may predate the explicit request-context fields. When
    -- present, they must agree with the record's household and private owner.
    if (payload ? 'expected_household_id') is distinct from (payload ? 'expected_user_id')
      or ((payload ? 'expected_household_id') and (
        nullif(payload->>'expected_household_id','')::uuid is distinct from p_household
        or nullif(payload->>'expected_user_id','')::uuid is null
        or (p_user is not null and nullif(payload->>'expected_user_id','')::uuid is distinct from p_user))) then
      raise exception 'A saved life request belongs to a different account context.' using errcode='42501';
    end if;
  end if;
  select * into actual from public.bloom_life_records where id=value.id;
  if found then
    if actual.household_id is distinct from p_household or actual.user_id is distinct from p_user then
      raise exception 'This record identifier belongs to a different account.' using errcode='42501';
    end if;
    if (to_jsonb(actual)-array['revision','created_at','updated_at']) is distinct from
      (to_jsonb(value)-array['revision','created_at','updated_at']) then
      raise exception 'An existing life record differs from this backup. Nothing was overwritten.' using errcode='23505';
    end if;
    return false;
  end if;
  insert into public.bloom_life_records(id,household_id,user_id,kind,record_key,data,archived,last_request_id,last_request_payload)
  values(value.id,p_household,p_user,value.kind,value.record_key,value.data,value.archived,value.last_request_id,value.last_request_payload);
  return true;
end;
$$;

create function bloom_private.life_restore_dog_effect(p_row jsonb,p_household uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare value public.bloom_dog_stock_effects%rowtype; actual public.bloom_dog_stock_effects%rowtype;
begin
  if not bloom_private.food_object_keys_ok(p_row,array['id','household_id','receipt_id','supply_id','product_id','purchased_on','supply_name','unit_label','quantity','amount_cents','quantity_before','quantity_after','needs_refill_before','needs_refill_after','created_at','voided_at'])
    or nullif(p_row->>'household_id','')::uuid is distinct from p_household then
    raise exception 'The dog purchase backup belongs to another household or has unsupported fields.' using errcode='42501';
  end if;
  select * into value from jsonb_populate_record(null::public.bloom_dog_stock_effects,p_row);
  if value.id is null or value.created_at is null or not isfinite(value.created_at) then
    raise exception 'The dog purchase backup needs its original identity and creation time.' using errcode='22023';
  end if;
  select * into actual from public.bloom_dog_stock_effects where id=value.id;
  if found then
    if actual.household_id is distinct from p_household then raise exception 'This dog purchase belongs to another household.' using errcode='42501'; end if;
    if to_jsonb(actual) is distinct from to_jsonb(value) then raise exception 'An existing dog purchase differs from this backup. Nothing was overwritten.' using errcode='23505'; end if;
    return false;
  end if;
  insert into public.bloom_dog_stock_effects select value.*;
  return true;
end;
$$;

alter function bloom_private.restore_household_backup(jsonb) rename to restore_household_backup_before_life;
revoke all on function bloom_private.restore_household_backup_before_life(jsonb) from public,anon,authenticated;

create function bloom_private.restore_household_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare household uuid; data jsonb; records jsonb; effects jsonb; row_value jsonb; result jsonb;
  inserted_records integer:=0; existing_records integer:=0; inserted_effects integer:=0; existing_effects integer:=0;
begin
  household:=bloom_private.food_lock_household();
  if not exists(select 1 from public.bloom_households h join public.bloom_household_members m on m.household_id=h.id
    where h.id=household and h.owner_user_id=auth.uid() and m.user_id=auth.uid() and m.role='owner') then
    raise exception 'Only the household owner can restore a household backup.' using errcode='42501';
  end if;
  if not bloom_private.food_object_keys_ok(p_backup,array['app','version','household_id','exported_at','data'])
    or p_backup->>'app' is distinct from 'Life in Bloom Household' or p_backup->'version' is distinct from '1'::jsonb
    or nullif(p_backup->>'household_id','')::uuid is distinct from household or octet_length(p_backup::text)>52428800 then
    raise exception 'Choose a supported backup exported from this same household.' using errcode='22023';
  end if;
  data:=p_backup->'data'; records:=coalesce(data->'lifeRecords','[]'::jsonb); effects:=coalesce(data->'dogStockEffects','[]'::jsonb);
  if jsonb_typeof(records) is distinct from 'array' or jsonb_typeof(effects) is distinct from 'array'
    or jsonb_array_length(records)>100000 or jsonb_array_length(effects)>100000 then
    raise exception 'Life records and dog purchase history must be supported backup lists.' using errcode='22023';
  end if;
  -- Validate scope before restoring any of the household's other collections.
  for row_value in select value from jsonb_array_elements(records) loop
    if row_value->>'user_id' is not null or bloom_private.life_private_kind(row_value->>'kind') then
      raise exception 'Shared household backups cannot contain private skills or smoking records. Use a personal backup.' using errcode='42501';
    end if;
  end loop;
  result:=bloom_private.restore_household_backup_before_life(jsonb_set(p_backup,'{data}',data-array['lifeRecords','dogStockEffects']));
  for row_value in select value from jsonb_array_elements(records)
    order by case value->>'kind' when 'routine_task' then 0 when 'dog_supply' then 0 when 'routine_log' then 1 when 'dog_shopping_request' then 1 else 0 end,value->>'id' loop
    if bloom_private.life_restore_record(row_value,household,null) then inserted_records:=inserted_records+1; else existing_records:=existing_records+1; end if;
  end loop;
  for row_value in select value from jsonb_array_elements(effects) loop
    if bloom_private.life_restore_dog_effect(row_value,household) then inserted_effects:=inserted_effects+1; else existing_effects:=existing_effects+1; end if;
  end loop;
  return result||jsonb_build_object('inserted',(result->'inserted')||jsonb_build_object('lifeRecords',inserted_records,'dogStockEffects',inserted_effects),
    'existing',(result->'existing')||jsonb_build_object('lifeRecords',existing_records,'dogStockEffects',existing_effects));
end;
$$;

create function bloom_private.restore_personal_life_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare household uuid; actor uuid:=auth.uid(); records jsonb; row_value jsonb; inserted integer:=0; existing integer:=0;
begin
  household:=bloom_private.food_lock_household();
  if not bloom_private.food_object_keys_ok(p_backup,array['app','version','user_id','household_id','exported_at','records'])
    or p_backup->>'app' is distinct from 'Life in Bloom Personal Practice' or p_backup->'version' is distinct from '1'::jsonb
    or nullif(p_backup->>'household_id','')::uuid is distinct from household
    or nullif(p_backup->>'user_id','')::uuid is distinct from actor or octet_length(p_backup::text)>52428800 then
    raise exception 'Choose a personal practice backup from your own account and household.' using errcode='42501';
  end if;
  records:=p_backup->'records';
  if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>100000 then raise exception 'The personal backup must contain a supported list of records.' using errcode='22023'; end if;
  for row_value in select value from jsonb_array_elements(records)
    order by case value->>'kind' when 'skill' then 0 when 'smoking_settings' then 0 else 1 end,value->>'id' loop
    if bloom_private.life_restore_record(row_value,household,actor) then inserted:=inserted+1; else existing:=existing+1; end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'existing',existing,'editableRevisionReset',true);
end;
$$;

create or replace function public.bloom_restore_household_backup(p_backup jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$ select bloom_private.restore_household_backup(p_backup); $$;
create function public.bloom_restore_personal_life_backup(p_backup jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$ select bloom_private.restore_personal_life_backup(p_backup); $$;

-- Public wrappers carry no elevated privileges. Only checked entry points are
-- executable by an authenticated app session; helpers remain internal.
revoke all on function bloom_private.life_private_kind(text),bloom_private.life_number(jsonb,text,numeric,numeric,boolean,boolean),
  bloom_private.life_text(jsonb,text,integer,boolean),bloom_private.life_boolean(jsonb,text,boolean),
  bloom_private.life_date(text,text,boolean,boolean),bloom_private.life_record_key(text,uuid,jsonb),
  bloom_private.life_validate_data(text,jsonb,uuid,uuid),bloom_private.life_validate_row(),
  bloom_private.life_dog_product_guard(),bloom_private.life_validate_dog_effect(),bloom_private.life_apply_dog_receipt(uuid,uuid),
  bloom_private.life_restore_record(jsonb,uuid,uuid),bloom_private.life_restore_dog_effect(jsonb,uuid),
  bloom_private.save_life_record(jsonb),bloom_private.archive_life_record(uuid,bigint,uuid),
  bloom_private.add_dog_supply_to_shopping(uuid,uuid,date,numeric),bloom_private.record_receipt(jsonb),bloom_private.void_receipt(uuid),
  bloom_private.restore_household_backup(jsonb),bloom_private.restore_personal_life_backup(jsonb)
  from public,anon,authenticated;
grant execute on function bloom_private.save_life_record(jsonb),bloom_private.archive_life_record(uuid,bigint,uuid),
  bloom_private.add_dog_supply_to_shopping(uuid,uuid,date,numeric),bloom_private.record_receipt(jsonb),bloom_private.void_receipt(uuid),
  bloom_private.restore_household_backup(jsonb),bloom_private.restore_personal_life_backup(jsonb) to authenticated;
revoke all on function public.bloom_save_life_record(jsonb),public.bloom_archive_life_record(uuid,bigint,uuid),
  public.bloom_add_dog_supply_to_shopping(uuid,uuid,date,numeric),public.bloom_record_receipt(jsonb),public.bloom_void_receipt(uuid),
  public.bloom_restore_household_backup(jsonb),public.bloom_restore_personal_life_backup(jsonb) from public,anon,authenticated;
grant execute on function public.bloom_save_life_record(jsonb),public.bloom_archive_life_record(uuid,bigint,uuid),
  public.bloom_add_dog_supply_to_shopping(uuid,uuid,date,numeric),public.bloom_record_receipt(jsonb),public.bloom_void_receipt(uuid),
  public.bloom_restore_household_backup(jsonb),public.bloom_restore_personal_life_backup(jsonb) to authenticated;

comment on table public.bloom_life_records is 'Checked life records: shared household care/hydration, private user skills/smoking, archived history and idempotent revisioned writes.';
comment on table public.bloom_dog_stock_effects is 'Immutable package stock effects tied to existing receipt and Household ledger spending; restores do not replay purchases.';


