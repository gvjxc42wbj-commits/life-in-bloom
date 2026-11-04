-- Hosted verification after food-expansion.sql. Synthetic identities only.
-- Every change rolls back. No Storage objects or physical files are created.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('51111111-1111-4111-8111-111111111111','authenticated','authenticated','bloom-food-owner@example.invalid',now(),now()),
('52222222-2222-4222-8222-222222222222','authenticated','authenticated','bloom-food-member@example.invalid',now(),now()),
('53333333-3333-4333-8333-333333333333','authenticated','authenticated','bloom-food-outsider@example.invalid',now(),now());

set local role authenticated;
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select set_config('bloom_food_test.household',public.bloom_create_household('Food rollback household')::text,true);
select set_config('bloom_food_test.invite',public.bloom_create_invite()->>'invite_code',true);

select set_config('request.jwt.claim.sub','53333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claims','{"sub":"53333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
select set_config('bloom_food_test.other_household',public.bloom_create_household('Other rollback household')::text,true);
insert into public.bloom_products(id,household_id,name,package_quantity,package_unit)
values('a3000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.other_household')::uuid,'Other household food',1,'each');

select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
insert into public.bloom_products(id,household_id,name,package_quantity,package_unit,item_label,price_cents,price_date,serving_quantity,serving_unit,nutrients)
values('a1000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'Synthetic eggs',6,'each','egg',200,'2026-11-01',1,'each','{"calories_kcal":70,"protein_g":6,"fiber_g":null}');
insert into public.bloom_products(id,household_id,name,category,aisle,package_quantity,package_unit)
values('a2000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'Synthetic paper','household','household',1,'each');
insert into public.bloom_budgets(household_id,month,amount_cents,household_amount_cents)
values(current_setting('bloom_food_test.household')::uuid,'2026-11-01',50000,10000);
insert into public.bloom_shopping_items(id,household_id,name,quantity,month,product_id,packs,estimate_cents)
values('d1000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'Synthetic eggs','3 packs','2026-11-01','a1000000-0000-4000-8000-000000000001',3,600);
insert into public.bloom_inventory(id,household_id,name,quantity,unit,location,expires_on,product_id,frozen_on,freezer_use_by,date_type)
values('c1000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'Earlier stock',2,'each','freezer','2026-11-10','a1000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01','best_before');
insert into public.bloom_recurring_products(id,household_id,product_id,person_slot,quantity,basis,every_days)
values('e2000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'a1000000-0000-4000-8000-000000000001',1,1,'units',1);

select set_config('bloom_food_test.receipt_payload',jsonb_build_object(
  'id','f1000000-0000-4000-8000-000000000001','purchased_on','2026-11-04','store','Synthetic store','payer_slot',1,'notes','Rollback fixture',
  'items',jsonb_build_array(
    jsonb_build_object('product_id','a1000000-0000-4000-8000-000000000001','name','Synthetic eggs','category','food','packs',1,'line_total_cents',249,
      'stock_quantity',6,'stock_unit','each','location','refrigerator','expires_on','2026-11-20','date_type','best_before',
      'frozen_on',null,'freezer_use_by',null,'shopping_item_id','d1000000-0000-4000-8000-000000000001','shopping_revision',1),
    jsonb_build_object('product_id','a2000000-0000-4000-8000-000000000001','name','Synthetic paper','category','household','packs',1,'line_total_cents',400,'stock_quantity',null)
  ))::text,true);
select public.bloom_record_receipt(current_setting('bloom_food_test.receipt_payload')::jsonb);
select public.bloom_record_receipt(current_setting('bloom_food_test.receipt_payload')::jsonb);

do $$ declare bad jsonb; begin
  if (select count(*) from public.bloom_receipts)<>1 then raise exception 'FAIL: receipt retry duplicated history'; end if;
  if (select count(*) from public.bloom_money_entries)<>2 or (select sum(amount_cents) from public.bloom_money_entries)<>649 then raise exception 'FAIL: split receipt spending'; end if;
  if (select amount_cents from public.bloom_money_entries where category='food')<>249 then raise exception 'FAIL: food expense'; end if;
  if (select amount_cents from public.bloom_money_entries where category='household')<>400 then raise exception 'FAIL: household expense'; end if;
  if (select count(*) from public.bloom_inventory where receipt_id is not null)<>1 or
    (select quantity from public.bloom_inventory where receipt_id is not null)<>6 then raise exception 'FAIL: receipt stock'; end if;
  if (select quantity from public.bloom_inventory where id='c1000000-0000-4000-8000-000000000001')<>2 then raise exception 'FAIL: earlier stock changed'; end if;
  if (select packs from public.bloom_shopping_items where id='d1000000-0000-4000-8000-000000000001')<>2
    or (select estimate_cents from public.bloom_shopping_items where id='d1000000-0000-4000-8000-000000000001')<>400
    or (select checked from public.bloom_shopping_items where id='d1000000-0000-4000-8000-000000000001') then raise exception 'FAIL: partial shopping fulfillment'; end if;
  if (select amount_cents from public.bloom_budgets)<>50000 or (select household_amount_cents from public.bloom_budgets)<>10000 then raise exception 'FAIL: spending rewrote chosen budgets'; end if;
  if (select price_cents from public.bloom_products where id='a1000000-0000-4000-8000-000000000001')<>200 then raise exception 'FAIL: actual price rewrote catalog reference'; end if;
  begin
    perform public.bloom_record_receipt(jsonb_set(current_setting('bloom_food_test.receipt_payload')::jsonb,'{notes}','"Different retry"'));
    raise exception 'FAIL: changed receipt retry accepted';
  exception when unique_violation then null; end;
  bad:=jsonb_set(current_setting('bloom_food_test.receipt_payload')::jsonb,'{id}','"f2000000-0000-4000-8000-000000000001"');
  bad:=jsonb_set(bad,'{items,0,shopping_revision}','2');
  bad:=jsonb_set(bad,'{items,1,product_id}','"a3000000-0000-4000-8000-000000000001"');
  begin
    perform public.bloom_record_receipt(bad);
    raise exception 'FAIL: other household product accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.bloom_receipts)<>1 or (select count(*) from public.bloom_money_entries)<>2
    or (select quantity from public.bloom_inventory where receipt_id is not null)<>6 then raise exception 'FAIL: failed receipt was not atomic'; end if;
  bad:=jsonb_set(current_setting('bloom_food_test.receipt_payload')::jsonb,'{id}','"f2000000-0000-4000-8000-000000000002"');
  begin
    perform public.bloom_record_receipt(bad);
    raise exception 'FAIL: stale shopping review accepted';
  exception when serialization_failure then null; end;
  bad:=jsonb_set(bad,'{items,0,line_total_cents}','1.5');
  begin
    perform public.bloom_record_receipt(bad);
    raise exception 'FAIL: fractional cents accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.bloom_receipts(id) values('f3000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: direct receipt write allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.bloom_money_entries(id) values('f3000000-0000-4000-8000-000000000002');
    raise exception 'FAIL: direct ledger write allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.bloom_inventory set receipt_id=null where receipt_id='f1000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: receipt stock provenance changed';
  exception when check_violation then null; end;
end $$;

-- Recipe nutrition is a preserved observation, separate from plans and purchases.
insert into public.bloom_recipes(id,household_id,name,servings,ingredients)
values('b1000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'Synthetic egg recipe',2,
  '[{"product_id":"a1000000-0000-4000-8000-000000000001","quantity":2,"unit":"each"}]');
insert into public.bloom_meal_entries(id,household_id,occurred_on,person_slot,kind,recipe_id,servings,label,nutrition_snapshot)
values('b2000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'2026-11-04',1,'planned','b1000000-0000-4000-8000-000000000001',1,'Synthetic egg recipe',
  '{"values":{"calories_kcal":70,"protein_g":6,"fiber_g":null},"missing":{"fiber_g":1},"complete":false}');
insert into public.bloom_meal_entries(id,household_id,occurred_on,person_slot,kind,product_id,servings,label,nutrition_snapshot)
values('b2000000-0000-4000-8000-000000000002',current_setting('bloom_food_test.household')::uuid,'2026-11-04',2,'eaten','a1000000-0000-4000-8000-000000000001',1,'Synthetic eggs',
  '{"values":{"calories_kcal":70,"protein_g":6,"fiber_g":null},"missing":{"fiber_g":1},"complete":false}');
update public.bloom_products set nutrients='{"calories_kcal":75,"protein_g":7}' where id='a1000000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from public.bloom_meal_entries where (nutrition_snapshot->'values'->>'protein_g')::numeric<>6) then raise exception 'FAIL: product edit rewrote meal history'; end if;
  if (select count(*) from public.bloom_meal_entries where kind='planned')<>1 or (select count(*) from public.bloom_meal_entries where kind='eaten')<>1 then raise exception 'FAIL: planned/eaten boundary'; end if;
  if (select sum(amount_cents) from public.bloom_money_entries)<>649 or (select quantity from public.bloom_inventory where receipt_id is not null)<>6 then raise exception 'FAIL: logging food created spending or stock usage'; end if;
  begin
    insert into public.bloom_recipes(household_id,name,servings,ingredients)
    values(current_setting('bloom_food_test.household')::uuid,'Forbidden ingredient',1,'[{"product_id":"a3000000-0000-4000-8000-000000000001","quantity":1,"unit":"each"}]');
    raise exception 'FAIL: recipe cross-household reference';
  exception when check_violation then null; end;
  begin
    insert into public.bloom_recipes(household_id,name,servings,ingredients)
    values(current_setting('bloom_food_test.household')::uuid,'Forbidden household ingredient',1,'[{"product_id":"a2000000-0000-4000-8000-000000000001","quantity":1,"unit":"each"}]');
    raise exception 'FAIL: household goods in recipe';
  exception when check_violation then null; end;
  if not bloom_private.food_storage_member(current_setting('bloom_food_test.household')||'/e1000000-0000-4000-8000-000000000001.png')
    or bloom_private.food_storage_member(current_setting('bloom_food_test.other_household')||'/e1000000-0000-4000-8000-000000000001.png')
    or bloom_private.food_storage_member('../not-a-household/file.svg') then raise exception 'FAIL: private file path boundary'; end if;
end $$;

-- Bills stay planned until payment is explicitly recorded; retries pay once.
insert into public.bloom_bills(id,household_id,month,name,amount_cents,variable)
values('e3000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'2026-11-01','Synthetic variable bill',null,true);
select set_config('bloom_food_test.payment',jsonb_build_object('id','f4000000-0000-4000-8000-000000000001','occurred_on','2026-11-04',
  'direction','expense','category','bill','amount_cents',345,'description','Synthetic actual bill payment','payer_slot',1,'bill_id','e3000000-0000-4000-8000-000000000001')::text,true);
select public.bloom_record_money_entry(current_setting('bloom_food_test.payment')::jsonb);
select public.bloom_record_money_entry(current_setting('bloom_food_test.payment')::jsonb);
do $$ begin
  if (select count(*) from public.bloom_money_entries where bill_id is not null)<>1 then raise exception 'FAIL: repeated bill payment'; end if;
  if (select amount_cents from public.bloom_bills)<>345 then raise exception 'FAIL: entered variable bill payment amount not saved'; end if;
  begin
    perform public.bloom_record_money_entry(jsonb_set(current_setting('bloom_food_test.payment')::jsonb,'{id}','"f4000000-0000-4000-8000-000000000002"'));
    raise exception 'FAIL: bill paid twice with new identifier';
  exception when unique_violation then null; end;
  begin
    perform public.bloom_void_money_entry((select id from public.bloom_money_entries where receipt_id is not null limit 1));
    raise exception 'FAIL: receipt ledger independently reversed';
  exception when check_violation then null; end;
end $$;
select public.bloom_void_money_entry('f4000000-0000-4000-8000-000000000001');
select public.bloom_void_money_entry('f4000000-0000-4000-8000-000000000001');

-- A linked member can read shared records, but only the owner can restore.
select set_config('request.jwt.claim.sub','52222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"52222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select public.bloom_join_household(current_setting('bloom_food_test.invite'));
do $$ begin
  if (select count(*) from public.bloom_receipts)<>1 or (select count(*) from public.bloom_products)<>2 then raise exception 'FAIL: linked member cannot read food records'; end if;
  begin
    perform public.bloom_restore_household_backup('{}');
    raise exception 'FAIL: nonowner restore';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','53333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claims','{"sub":"53333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
do $$ declare t text; found_count bigint; begin
  foreach t in array array['bloom_products','bloom_recurring_products','bloom_bills','bloom_receipts','bloom_money_entries','bloom_recipes','bloom_meal_entries','bloom_food_files'] loop
    execute format('select count(*) from public.%I where household_id=$1',t) into found_count using current_setting('bloom_food_test.household')::uuid;
    if found_count<>0 then raise exception 'FAIL: outsider read of %',t; end if;
  end loop;
  begin
    perform public.bloom_void_receipt('f1000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: outsider receipt reversal';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"51111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
-- Export snapshot has no Auth credentials or private profiles. File metadata has
-- no blob; restore must report it as skipped instead of claiming a file exists.
insert into public.bloom_food_files(id,household_id,product_id,name,path,mime_type,size_bytes)
values('e1000000-0000-4000-8000-000000000001',current_setting('bloom_food_test.household')::uuid,'a1000000-0000-4000-8000-000000000001','Synthetic missing image',
  current_setting('bloom_food_test.household')||'/e1000000-0000-4000-8000-000000000001.png','image/png',100);
select set_config('bloom_food_test.backup',jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',current_setting('bloom_food_test.household'),'exported_at',now(),
  'data',jsonb_build_object(
    'products',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_products t),
    'recurringProducts',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_recurring_products t),
    'budgets',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_budgets t),
    'inventory',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_inventory t),
    'shoppingItems',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_shopping_items t),
    'bills',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_bills t),
    'recipes',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_recipes t),
    'mealEntries',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_meal_entries t),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_receipts t),
    'moneyEntries',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_money_entries t),
    'foodFiles',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.bloom_food_files t)
  ))::text,true);
delete from public.bloom_meal_entries where id='b2000000-0000-4000-8000-000000000001';
delete from public.bloom_food_files where id='e1000000-0000-4000-8000-000000000001';
select set_config('bloom_food_test.restore_result',public.bloom_restore_household_backup(current_setting('bloom_food_test.backup')::jsonb)::text,true);
do $$ declare result jsonb:=current_setting('bloom_food_test.restore_result')::jsonb; begin
  if (result->'inserted'->>'mealEntries')::integer<>1 or (result->>'skippedFiles')::integer<>1 then raise exception 'FAIL: additive restore/file skip counts'; end if;
  if (select count(*) from public.bloom_meal_entries)<>2 or (select count(*) from public.bloom_receipts)<>1 or (select count(*) from public.bloom_money_entries)<>3 then raise exception 'FAIL: restore duplicated immutable history'; end if;
  if (select quantity from public.bloom_inventory where receipt_id is not null)<>6 then raise exception 'FAIL: restore replayed receipt stock'; end if;
  perform public.bloom_restore_household_backup(current_setting('bloom_food_test.backup')::jsonb);
  if (select count(*) from public.bloom_meal_entries)<>2 then raise exception 'FAIL: restore retry duplicated data'; end if;
  update public.bloom_budgets set amount_cents=51000;
  begin
    perform public.bloom_restore_household_backup(current_setting('bloom_food_test.backup')::jsonb);
    raise exception 'FAIL: conflicting restore overwrote newer data';
  exception when unique_violation then null; end;
  if (select amount_cents from public.bloom_budgets)<>51000 then raise exception 'FAIL: restore replaced budget'; end if;
end $$;

-- Reversal refuses changed stock; a safe reversal restores the original plan.
update public.bloom_inventory set quantity=5 where receipt_id='f1000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.bloom_void_receipt('f1000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: edited stock was silently removed';
  exception when check_violation then null; end;
  if (select voided_at from public.bloom_receipts) is not null or exists(select 1 from public.bloom_money_entries where receipt_id is not null and voided_at is not null) then raise exception 'FAIL: failed reversal was not atomic'; end if;
end $$;
update public.bloom_inventory set quantity=6 where receipt_id='f1000000-0000-4000-8000-000000000001';
select public.bloom_void_receipt('f1000000-0000-4000-8000-000000000001');
select public.bloom_void_receipt('f1000000-0000-4000-8000-000000000001');
do $$ begin
  if (select voided_at from public.bloom_receipts) is null then raise exception 'FAIL: receipt reversal missing'; end if;
  if exists(select 1 from public.bloom_money_entries where receipt_id is not null and voided_at is null) then raise exception 'FAIL: reversal missed category spending'; end if;
  if exists(select 1 from public.bloom_inventory where receipt_id is not null) or (select quantity from public.bloom_inventory where id='c1000000-0000-4000-8000-000000000001')<>2 then raise exception 'FAIL: reversal stock boundary'; end if;
  if (select packs from public.bloom_shopping_items)<>3 or (select estimate_cents from public.bloom_shopping_items)<>600 or (select quantity from public.bloom_shopping_items)<>'3 packs' then raise exception 'FAIL: reversal did not restore the shopping plan'; end if;
end $$;

-- Anonymous access remains blocked; uploads require valid household paths.
reset role;
do $$ begin
  if not exists(select 1 from storage.buckets where id='bloom-food-files' and not public and file_size_limit=10485760) then raise exception 'FAIL: private bucket settings'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ declare t text; begin
  foreach t in array array['bloom_products','bloom_recurring_products','bloom_bills','bloom_receipts','bloom_money_entries','bloom_recipes','bloom_meal_entries','bloom_food_files'] loop
    begin
      execute format('select 1 from public.%I limit 1',t);
      raise exception 'FAIL: anonymous read of %',t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.bloom_record_receipt('{}');
    raise exception 'FAIL: anonymous receipt RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: atomic split receipts, retry safety, partial shopping, stock/reversal boundaries, separate nutrition history, bill payments, household/anonymous/file access, and additive backup restore; all synthetic changes rolled back.' as result;
