-- Life in Bloom: guard request context before any life-record mutation.
-- Apply after life-modules.sql. Existing table data is unchanged.
-- The client supplies expected IDs from its captured signed-in context.

create or replace function bloom_private.save_life_record(p_record jsonb)
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

create or replace function bloom_private.life_restore_record(p_row jsonb,p_household uuid,p_user uuid)
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
