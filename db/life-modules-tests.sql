-- Synthetic authenticated integration/security verification. Everything rolls back.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); begin
  perform set_config('bloom_life_test.owner',a::text,true);
  perform set_config('bloom_life_test.member',b::text,true);
  perform set_config('bloom_life_test.outsider',c::text,true);
  perform set_config('bloom_life_test.today',(now() at time zone 'America/New_York')::date::text,true);
  insert into auth.users(id,aud,role,email,created_at,updated_at) values
    (a,'authenticated','authenticated','life-owner-'||a||'@example.invalid',now(),now()),
    (b,'authenticated','authenticated','life-member-'||b||'@example.invalid',now(),now()),
    (c,'authenticated','authenticated','life-outsider-'||c||'@example.invalid',now(),now());
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('bloom_life_test.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_life_test.owner'),'role','authenticated')::text,true);
select set_config('bloom_life_test.household',public.bloom_create_household('Life modules rollback household')::text,true);
reset role;
insert into public.bloom_household_members(household_id,user_id,role)
values(current_setting('bloom_life_test.household')::uuid,current_setting('bloom_life_test.member')::uuid,'member');
set local role authenticated;

-- Water counts are separate by person; retries and stale edits cannot double-log.
do $$ declare payload jsonb; first_id uuid:=gen_random_uuid(); water_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); row_value public.bloom_life_records%rowtype;
begin
  payload:=jsonb_build_object('id',first_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','hydration_settings','data',jsonb_build_object('person_slot',1,'container_ml',500,'goal_ml',null));
  perform public.bloom_save_life_record(payload);
  perform public.bloom_save_life_record(payload);
  begin perform public.bloom_save_life_record(payload||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid())); raise exception 'FAIL: duplicate active person settings'; exception when unique_violation then null; end;
  payload:=jsonb_build_object('id',second_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','hydration_settings','data',jsonb_build_object('person_slot',2,'container_ml',250,'goal_ml',1500));
  perform public.bloom_save_life_record(payload);
  payload:=jsonb_build_object('id',water_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','hydration_entry','data',jsonb_build_object('person_slot',1,'occurred_on',current_setting('bloom_life_test.today'),'amount_ml',500,'container_ml',500,'notes',''));
  perform set_config('bloom_life_test.water_payload',payload::text,true);
  perform set_config('bloom_life_test.water',water_id::text,true);
  perform public.bloom_save_life_record(payload);
  perform public.bloom_save_life_record(payload);
  if (select count(*) from public.bloom_life_records where kind='hydration_entry')<>1 then raise exception 'FAIL: water retry duplicated entry'; end if;
  begin perform public.bloom_save_life_record(jsonb_set(payload,'{data,amount_ml}','600')); raise exception 'FAIL: reused save changed amount'; exception when unique_violation then null; end;
  payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',1);
  payload:=jsonb_set(payload,'{data,amount_ml}','250');
  perform public.bloom_save_life_record(payload);
  perform public.bloom_save_life_record(payload);
  begin perform public.bloom_save_life_record(payload||jsonb_build_object('request_id',gen_random_uuid())); raise exception 'FAIL: stale water edit'; exception when serialization_failure then null; end;
  payload:=current_setting('bloom_life_test.water_payload')::jsonb||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid());
  begin perform public.bloom_save_life_record(jsonb_set(payload,'{data,occurred_on}',to_jsonb((current_setting('bloom_life_test.today')::date+1)::text))); raise exception 'FAIL: future water logged'; exception when invalid_parameter_value then null; end;
  begin perform public.bloom_save_life_record(payload||jsonb_build_object('user_id',current_setting('bloom_life_test.member'))); raise exception 'FAIL: supplied ownership accepted'; exception when invalid_parameter_value then null; end;
  begin update public.bloom_life_records set data='{}' where id=water_id; raise exception 'FAIL: direct record write'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.bloom_money_entries) then raise exception 'FAIL: water created spending'; end if;
end $$;

-- Private practice and smoking use own-user scope; zero is recorded explicitly.
do $$ declare skill_id uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid(); settings_id uuid:=gen_random_uuid(); day_id uuid:=gen_random_uuid(); payload jsonb; day_payload jsonb; snapshot jsonb;
begin
  perform set_config('bloom_life_test.skill',skill_id::text,true);
  perform set_config('bloom_life_test.session',session_id::text,true);
  perform public.bloom_save_life_record(jsonb_build_object('id',skill_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','skill','data',jsonb_build_object('name','Sample scale','category','Piano','memory_type','procedural','observed_level',3,'notes','')));
  payload:=jsonb_build_object('id',session_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','skill_session','data',jsonb_build_object('skill_id',skill_id,'occurred_on',current_setting('bloom_life_test.today'),'minutes',15,'result','good','notes',''));
  perform public.bloom_save_life_record(payload); perform public.bloom_save_life_record(payload);
  payload:=jsonb_build_object('id',settings_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','smoking_settings','data',jsonb_build_object('baseline_joints',2,'baseline_cigars',1,'baseline_grams_per_joint',0.5,'price_per_gram_cents',1000,'cigar_price_cents',200,'notes',''));
  perform public.bloom_save_life_record(payload);
  day_payload:=jsonb_build_object('id',day_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','smoking_day','data',jsonb_build_object('occurred_on',current_setting('bloom_life_test.today'),'joints',0,'cigars',0,'grams_per_joint',0.5,'trigger_tags',jsonb_build_array('Stress'),'notes','Zero intentionally recorded'));
  perform public.bloom_save_life_record(day_payload); perform public.bloom_save_life_record(day_payload);
  select data->'reference_snapshot' into snapshot from public.bloom_life_records where id=day_id;
  if snapshot->>'price_per_gram_cents'<>'1000' or (select data->>'joints' from public.bloom_life_records where id=day_id)<>'0' then raise exception 'FAIL: missing zero or smoking snapshot'; end if;
  payload:=jsonb_set(payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',1),'{data,price_per_gram_cents}','2000');
  perform public.bloom_save_life_record(payload);
  day_payload:=jsonb_set(day_payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',1),'{data,joints}','1');
  perform public.bloom_save_life_record(day_payload);
  if (select data->'reference_snapshot' from public.bloom_life_records where id=day_id) is distinct from snapshot then raise exception 'FAIL: later prices rewrote smoking history'; end if;
  if exists(select 1 from public.bloom_money_entries) then raise exception 'FAIL: smoking estimate became actual spending'; end if;
end $$;

-- Care completion is shared with Housework and keeps its original task details.
do $$ declare task_id uuid:=gen_random_uuid(); log_id uuid:=gen_random_uuid(); payload jsonb; log_payload jsonb; snapshot jsonb; revision_value bigint;
begin
  perform set_config('bloom_life_test.task',task_id::text,true);
  perform set_config('bloom_life_test.log',log_id::text,true);
  payload:=jsonb_build_object('id',task_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','routine_task','data',jsonb_build_object('domain','dog','name','Sample care','category','medication','frequency','daily','interval_days',1,'interval_months',1,
    'anchor_on',current_setting('bloom_life_test.today'),'end_on',null,'times',jsonb_build_array('08:00'),'rolling',false,'active',true,'dose_text','Owner-entered label','notes',''));
  perform public.bloom_save_life_record(payload);
  log_payload:=jsonb_build_object('id',log_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','routine_log','data',jsonb_build_object('task_id',task_id,'occurred_on',current_setting('bloom_life_test.today'),'slot','08:00','person_slot',1,'done',true,'notes',''));
  perform public.bloom_save_life_record(log_payload);
  select data->'task_snapshot' into snapshot from public.bloom_life_records where id=log_id;
  begin perform public.bloom_save_life_record(log_payload||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid())); raise exception 'FAIL: duplicate care slot'; exception when unique_violation then null; end;
  payload:=jsonb_set(payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',1),'{data,dose_text}','"Changed label"');
  perform public.bloom_save_life_record(payload);
  perform public.bloom_archive_life_record(task_id,2,gen_random_uuid());
  log_payload:=jsonb_set(log_payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',1),'{data,done}','false');
  perform public.bloom_save_life_record(log_payload);
  if (select data->'task_snapshot' from public.bloom_life_records where id=log_id) is distinct from snapshot then raise exception 'FAIL: care edit rewrote historical task'; end if;
  if (select data->>'done' from public.bloom_life_records where id=log_id)<>'false' then raise exception 'FAIL: archived-task completion cannot be undone'; end if;
  begin perform public.bloom_save_life_record(payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',3)); raise exception 'FAIL: archived ID resurrected'; exception when check_violation then null; end;
  payload:=jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','dog_profile','data',jsonb_build_object('name','Sample dog','breed','Dachshund','birth_on',(current_setting('bloom_life_test.today')::date-365)::text,'notes',''));
  perform public.bloom_save_life_record(payload);
  perform public.bloom_save_life_record(jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','dog_weight','data',jsonb_build_object('occurred_on',current_setting('bloom_life_test.today'),'weight_kg',5.5,'notes','')));
  perform public.bloom_save_life_record(jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','dog_note','data',jsonb_build_object('occurred_on',current_setting('bloom_life_test.today'),'kind','training','minutes',5,'notes','Sample cue practice')));
end $$;

-- A supply reference creates a catalog product and one pending shopping item.
do $$ declare supply_id uuid:=gen_random_uuid(); payload jsonb; product_id uuid; first_request uuid:=gen_random_uuid(); second_request uuid:=gen_random_uuid(); shopping_id uuid; month_value date:=date_trunc('month',current_setting('bloom_life_test.today')::date)::date;
begin
  payload:=jsonb_build_object('id',supply_id,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','dog_supply','data',jsonb_build_object('product_id',null,'name','Sample dog food','unit_label','packs','stock_quantity',1,'refill_threshold',1,'needs_refill',true,'reference_price_cents',500,'notes',''));
  perform public.bloom_save_life_record(payload); perform public.bloom_save_life_record(payload);
  select (data->>'product_id')::uuid into product_id from public.bloom_life_records where id=supply_id;
  perform set_config('bloom_life_test.supply',supply_id::text,true);
  perform set_config('bloom_life_test.dog_product',product_id::text,true);
  if (select count(*) from public.bloom_products)<>1 or (select category from public.bloom_products where id=product_id)<>'household' then raise exception 'FAIL: dog catalog duplicate or food category'; end if;
  begin update public.bloom_products set category='food' where id=product_id; raise exception 'FAIL: dog product moved into human food'; exception when check_violation then null; end;
  shopping_id:=public.bloom_add_dog_supply_to_shopping(supply_id,first_request,month_value,2);
  if public.bloom_add_dog_supply_to_shopping(supply_id,first_request,month_value,2)<>shopping_id then raise exception 'FAIL: dog shopping retry changed identity'; end if;
  if public.bloom_add_dog_supply_to_shopping(supply_id,second_request,month_value,9)<>shopping_id then raise exception 'FAIL: existing pending dog supply duplicated'; end if;
  if (select count(*) from public.bloom_shopping_items)<>1 or (select packs from public.bloom_shopping_items where id=shopping_id)<>2 then raise exception 'FAIL: existing pending quantity overwritten'; end if;
  begin perform public.bloom_add_dog_supply_to_shopping(supply_id,first_request,month_value,3); raise exception 'FAIL: changed dog request reused'; exception when unique_violation then null; end;
  perform set_config('bloom_life_test.dog_shopping',shopping_id::text,true);
  perform set_config('bloom_life_test.dog_shopping_request',first_request::text,true);
  if exists(select 1 from public.bloom_money_entries) or exists(select 1 from public.bloom_inventory) then raise exception 'FAIL: dog planning created spending or pantry'; end if;
end $$;

-- Mixed food/dog purchases are atomic: one receipt, existing category ledger,
-- food batches for people, package stock for Dog. Partial purchase retries work.
do $$ declare h uuid:=current_setting('bloom_life_test.household')::uuid; food_id uuid:=gen_random_uuid(); shop public.bloom_shopping_items%rowtype; payload jsonb; second_payload jsonb; supply_id uuid:=current_setting('bloom_life_test.supply')::uuid;
begin
  insert into public.bloom_products(id,household_id,name,category,package_quantity,package_unit) values(food_id,h,'Sample human eggs','food',6,'each');
  select * into shop from public.bloom_shopping_items where id=current_setting('bloom_life_test.dog_shopping')::uuid;
  payload:=jsonb_build_object('id',gen_random_uuid(),'purchased_on',current_setting('bloom_life_test.today'),'store','Example store','payer_slot',1,'notes','Synthetic mixed receipt','items',jsonb_build_array(
    jsonb_build_object('product_id',shop.product_id,'name',shop.name,'category','household','packs',1,'line_total_cents',649,'shopping_item_id',shop.id,'shopping_revision',shop.revision),
    jsonb_build_object('product_id',food_id,'name','Sample human eggs','category','food','packs',1,'line_total_cents',500,'stock_quantity',6,'stock_unit','each','location','refrigerator')));
  perform set_config('bloom_life_test.receipt_one',payload::text,true);
  perform public.bloom_record_receipt(payload); perform public.bloom_record_receipt(payload);
  if (select data->>'stock_quantity' from public.bloom_life_records where id=supply_id)<>'2' then raise exception 'FAIL: dog stock missing or duplicate'; end if;
  if (select count(*) from public.bloom_inventory)<>1 or (select sum(quantity) from public.bloom_inventory)<>6 then raise exception 'FAIL: dog supply entered human pantry'; end if;
  if (select sum(amount_cents) from public.bloom_money_entries where voided_at is null)<>1149 or (select count(*) from public.bloom_money_entries)<>2 then raise exception 'FAIL: receipt ledger duplicated or missing'; end if;
  if (select amount_cents from public.bloom_dog_stock_effects)<>649 or (select quantity from public.bloom_dog_stock_effects)<>1 then raise exception 'FAIL: dog receipt effect amount/packages'; end if;
  if (select price_cents from public.bloom_products where id=shop.product_id)<>500 then raise exception 'FAIL: reference price overwritten by purchase'; end if;
  if public.bloom_add_dog_supply_to_shopping(supply_id,gen_random_uuid(),shop.month,5)<>shop.id then raise exception 'FAIL: partial pending item duplicated'; end if;
  select * into shop from public.bloom_shopping_items where id=shop.id;
  second_payload:=jsonb_build_object('id',gen_random_uuid(),'purchased_on',current_setting('bloom_life_test.today'),'store','','payer_slot',null,'items',jsonb_build_array(
    jsonb_build_object('product_id',shop.product_id,'name',shop.name,'category','household','packs',1,'line_total_cents',700,'shopping_item_id',shop.id,'shopping_revision',shop.revision)));
  perform set_config('bloom_life_test.receipt_two',second_payload::text,true);
  perform public.bloom_record_receipt(second_payload); perform public.bloom_record_receipt(second_payload);
  if (select data->>'stock_quantity' from public.bloom_life_records where id=supply_id)<>'3' or (select count(*) from public.bloom_dog_stock_effects)<>2 then raise exception 'FAIL: completed dog purchase'; end if;
  begin perform public.bloom_void_receipt((payload->>'id')::uuid); raise exception 'FAIL: old stock effect reversed after another purchase'; exception when check_violation then null; end;
  perform public.bloom_void_receipt((second_payload->>'id')::uuid); perform public.bloom_void_receipt((second_payload->>'id')::uuid);
  if (select data->>'stock_quantity' from public.bloom_life_records where id=supply_id)<>'2' or (select sum(amount_cents) from public.bloom_money_entries where voided_at is null)<>1149 then raise exception 'FAIL: dog receipt reversal'; end if;
  if (select count(*) from public.bloom_dog_stock_effects where voided_at is not null)<>1 then raise exception 'FAIL: dog reversal history missing'; end if;
  begin perform public.bloom_record_receipt(second_payload); raise exception 'FAIL: voided receipt resubmitted'; exception when check_violation then null; end;
end $$;

-- Household backup excludes private practice. Existing imports are no-ops and
-- missing records restore without replaying actual purchase effects.
do $$ declare backup jsonb; personal jsonb; result jsonb; bad jsonb; records jsonb; before_stock jsonb; before_money bigint;
begin
  select jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',current_setting('bloom_life_test.household'),'data',
    jsonb_build_object('lifeRecords',coalesce((select jsonb_agg(to_jsonb(r)) from public.bloom_life_records r where user_id is null),'[]'::jsonb),
      'dogStockEffects',coalesce((select jsonb_agg(to_jsonb(e)) from public.bloom_dog_stock_effects e),'[]'::jsonb))) into backup;
  select jsonb_build_object('app','Life in Bloom Personal Practice','version',1,'household_id',current_setting('bloom_life_test.household'),'user_id',current_setting('bloom_life_test.owner'),
    'records',coalesce((select jsonb_agg(to_jsonb(r)) from public.bloom_life_records r where user_id=auth.uid()),'[]'::jsonb)) into personal;
  perform set_config('bloom_life_test.shared_backup',backup::text,true);
  perform set_config('bloom_life_test.private_backup',personal::text,true);
  select data into before_stock from public.bloom_life_records where id=current_setting('bloom_life_test.supply')::uuid;
  select sum(amount_cents) into before_money from public.bloom_money_entries;
  result:=public.bloom_restore_household_backup(backup);
  if (result#>>'{inserted,lifeRecords}')::integer<>0 or (result#>>'{inserted,dogStockEffects}')::integer<>0 then raise exception 'FAIL: shared backup duplicated existing records'; end if;
  result:=public.bloom_restore_personal_life_backup(personal);
  if (result->>'inserted')::integer<>0 then raise exception 'FAIL: private backup duplicated existing records'; end if;
  if (select data from public.bloom_life_records where id=current_setting('bloom_life_test.supply')::uuid) is distinct from before_stock or (select sum(amount_cents) from public.bloom_money_entries)<>before_money then raise exception 'FAIL: backup replayed purchase'; end if;
  bad:=jsonb_set(backup,'{data,lifeRecords}',personal->'records');
  begin perform public.bloom_restore_household_backup(bad); raise exception 'FAIL: private data accepted in shared backup'; exception when insufficient_privilege then null; end;
  bad:=jsonb_set(personal,'{user_id}',to_jsonb(current_setting('bloom_life_test.member')));
  begin perform public.bloom_restore_personal_life_backup(bad); raise exception 'FAIL: other-user private backup'; exception when insufficient_privilege then null; end;
  bad:=jsonb_set(backup,'{data,dogStockEffects,0,amount_cents}','1');
  begin perform public.bloom_restore_household_backup(bad); raise exception 'FAIL: changed dog purchase history imported'; exception when unique_violation then null; end;
  bad:=jsonb_set(personal,'{records,0,data,notes}','"Conflicting imported note"');
  begin perform public.bloom_restore_personal_life_backup(bad); raise exception 'FAIL: changed existing private data overwritten'; exception when unique_violation then null; end;
  perform public.bloom_restore_household_backup(jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',current_setting('bloom_life_test.household'),'data','{}'::jsonb));
end $$;

-- Deleting synthetic rows as administrator simulates missing records on restore.
reset role;
delete from public.bloom_life_records where id in (current_setting('bloom_life_test.water')::uuid,current_setting('bloom_life_test.session')::uuid);
set local role authenticated;
do $$ declare result jsonb; begin
  result:=public.bloom_restore_household_backup(current_setting('bloom_life_test.shared_backup')::jsonb);
  if (result#>>'{inserted,lifeRecords}')::integer<>1 or (select revision from public.bloom_life_records where id=current_setting('bloom_life_test.water')::uuid)<>1 then raise exception 'FAIL: missing water restore'; end if;
  result:=public.bloom_restore_personal_life_backup(current_setting('bloom_life_test.private_backup')::jsonb);
  if (result->>'inserted')::integer<>1 then raise exception 'FAIL: missing private session restore'; end if;
end $$;

-- A second household member sees care and hydration, never another user's
-- skills/smoking, even with a known record ID or a forged related skill ID.
select set_config('request.jwt.claim.sub',current_setting('bloom_life_test.member'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_life_test.member'),'role','authenticated')::text,true);
do $$ declare payload jsonb; own_skill uuid:=gen_random_uuid(); archive_id uuid:=gen_random_uuid(); row_value public.bloom_life_records%rowtype;
begin
  if exists(select 1 from public.bloom_life_records where user_id is not null) then raise exception 'FAIL: other member private data leaked'; end if;
  if not exists(select 1 from public.bloom_life_records where kind='hydration_entry') or not exists(select 1 from public.bloom_dog_stock_effects) then raise exception 'FAIL: shared care inaccessible'; end if;
  payload:=jsonb_build_object('id',current_setting('bloom_life_test.skill'),'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','skill','data',jsonb_build_object('name','Forbidden edit','category','Piano','memory_type','procedural','observed_level',null,'notes',''));
  begin perform public.bloom_save_life_record(payload); raise exception 'FAIL: other member private skill changed'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_archive_life_record(current_setting('bloom_life_test.skill')::uuid,1,gen_random_uuid()); raise exception 'FAIL: other member private skill archived'; exception when insufficient_privilege then null; end;
  payload:=jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','skill_session','data',jsonb_build_object('skill_id',current_setting('bloom_life_test.skill'),'occurred_on',current_setting('bloom_life_test.today'),'minutes',10,'result','good','notes',''));
  begin perform public.bloom_save_life_record(payload); raise exception 'FAIL: cross-user skill reference'; exception when check_violation then null; end;
  begin perform public.bloom_restore_household_backup(current_setting('bloom_life_test.shared_backup')::jsonb); raise exception 'FAIL: member restored shared backup'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_restore_personal_life_backup(current_setting('bloom_life_test.private_backup')::jsonb); raise exception 'FAIL: member imported owner private records'; exception when insufficient_privilege then null; end;
  payload:=jsonb_build_object('id',own_skill,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','skill','data',jsonb_build_object('name','Own sample','category','Math','memory_type','knowledge','observed_level',null,'notes',''));
  perform public.bloom_save_life_record(payload);
  select * into row_value from public.bloom_life_records where id=own_skill;
  perform public.bloom_restore_personal_life_backup(jsonb_build_object('app','Life in Bloom Personal Practice','version',1,'household_id',current_setting('bloom_life_test.household'),'user_id',auth.uid(),'records',jsonb_build_array(to_jsonb(row_value))));
  perform public.bloom_archive_life_record(own_skill,1,archive_id); perform public.bloom_archive_life_record(own_skill,1,archive_id);
  if not (select archived from public.bloom_life_records where id=own_skill) then raise exception 'FAIL: private archive'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('bloom_life_test.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_life_test.outsider'),'role','authenticated')::text,true);
select set_config('bloom_life_test.other_household',public.bloom_create_household('Other life rollback household')::text,true);
do $$ declare payload jsonb; target uuid:=gen_random_uuid(); wrong_user jsonb; valid_payload jsonb;
begin
  if exists(select 1 from public.bloom_life_records) or exists(select 1 from public.bloom_dog_stock_effects) then raise exception 'FAIL: cross-household read'; end if;
  begin perform public.bloom_add_dog_supply_to_shopping(current_setting('bloom_life_test.supply')::uuid,gen_random_uuid(),date_trunc('month',current_setting('bloom_life_test.today')::date)::date,1); raise exception 'FAIL: outsider dog supply shopping'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_void_receipt((current_setting('bloom_life_test.receipt_one')::jsonb->>'id')::uuid); raise exception 'FAIL: outsider receipt reversal'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_restore_household_backup(current_setting('bloom_life_test.shared_backup')::jsonb); raise exception 'FAIL: outsider backup restore'; exception when invalid_parameter_value then null; end;
  begin perform bloom_private.record_receipt_before_life('{}'); raise exception 'FAIL: unchecked receipt alias callable'; exception when insufficient_privilege then null; end;
  begin perform bloom_private.restore_household_backup_before_life('{}'); raise exception 'FAIL: unchecked restore alias callable'; exception when insufficient_privilege then null; end;
  -- A stale tab must not create a new supply (or catalog product) in the
  -- currently authenticated household when it captured a different context.
  payload:=jsonb_build_object('id',target,'request_id',gen_random_uuid(),'expected_household_id',current_setting('bloom_life_test.household'),'expected_user_id',auth.uid(),'kind','dog_supply',
    'data',jsonb_build_object('product_id',null,'name','Forbidden stale supply','unit_label','packs','stock_quantity',0,'refill_threshold',1,'needs_refill',false,'reference_price_cents',null,'notes',''));
  begin perform public.bloom_save_life_record(payload); raise exception 'FAIL: stale household request wrote a new record'; exception when insufficient_privilege then null; end;
  wrong_user:=payload||jsonb_build_object('expected_household_id',current_setting('bloom_life_test.other_household'),'expected_user_id',current_setting('bloom_life_test.owner'));
  begin perform public.bloom_save_life_record(wrong_user); raise exception 'FAIL: stale user request wrote a new record'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_save_life_record(payload-array['expected_household_id','expected_user_id']); raise exception 'FAIL: missing context accepted'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.bloom_life_records) or exists(select 1 from public.bloom_products) or exists(select 1 from public.bloom_shopping_items)
    or exists(select 1 from public.bloom_money_entries) then raise exception 'FAIL: rejected context created partial effects'; end if;
  valid_payload:=payload||jsonb_build_object('expected_household_id',current_setting('bloom_life_test.other_household'),'expected_user_id',auth.uid());
  perform public.bloom_save_life_record(valid_payload); perform public.bloom_save_life_record(valid_payload);
  if (select count(*) from public.bloom_life_records)<>1 or (select count(*) from public.bloom_products)<>1 then raise exception 'FAIL: valid context save or retry'; end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin perform 1 from public.bloom_life_records; raise exception 'FAIL: anon life read'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.bloom_dog_stock_effects; raise exception 'FAIL: anon dog cost read'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_save_life_record('{}'); raise exception 'FAIL: anon life save'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_restore_personal_life_backup('{}'); raise exception 'FAIL: anon personal restore'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: private/shared/outsider/anonymous access, zero-write context guards, stable saves and archives, validation, snapshots, dog shopping deduplication, transactional mixed receipts and reversals, isolated additive backups; all synthetic changes rolled back.' as result;
