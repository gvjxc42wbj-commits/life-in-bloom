-- Synthetic hosted verification. All identities and records roll back.
begin;
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); begin
  perform set_config('bloom_checkout_test.owner',a::text,true);
  perform set_config('bloom_checkout_test.outsider',b::text,true);
  perform set_config('bloom_checkout_test.month',date_trunc('month',now() at time zone 'America/New_York')::date::text,true);
  insert into auth.users(id,aud,role,email,created_at,updated_at) values
    (a,'authenticated','authenticated','checkout-owner-'||a||'@example.invalid',now(),now()),
    (b,'authenticated','authenticated','checkout-outsider-'||b||'@example.invalid',now(),now());
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('bloom_checkout_test.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_checkout_test.owner'),'role','authenticated')::text,true);
select set_config('bloom_checkout_test.household',public.bloom_create_household('Checkout rollback household')::text,true);
select set_config('request.jwt.claim.sub',current_setting('bloom_checkout_test.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_checkout_test.outsider'),'role','authenticated')::text,true);
select set_config('bloom_checkout_test.other',public.bloom_create_household('Checkout other rollback household')::text,true);
do $$ declare p uuid:=gen_random_uuid(); begin
  perform set_config('bloom_checkout_test.other_product',p::text,true);
  insert into public.bloom_products(id,household_id,name,package_quantity,package_unit)
  values(p,current_setting('bloom_checkout_test.other')::uuid,'Other household sample food',1,'each');
end $$;
select set_config('request.jwt.claim.sub',current_setting('bloom_checkout_test.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_checkout_test.owner'),'role','authenticated')::text,true);
do $$ declare h uuid:=current_setting('bloom_checkout_test.household')::uuid; p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid();
  legacy uuid:=gen_random_uuid(); partial uuid:=gen_random_uuid(); m date:=current_setting('bloom_checkout_test.month')::date;
  payload jsonb;
begin
  perform set_config('bloom_checkout_test.product',p::text,true);
  perform set_config('bloom_checkout_test.household_product',q::text,true);
  perform set_config('bloom_checkout_test.legacy_item',legacy::text,true);
  perform set_config('bloom_checkout_test.partial_item',partial::text,true);
  insert into public.bloom_products(id,household_id,name,category,package_quantity,package_unit,price_cents,price_date)
    values(p,h,'Sample eggs','food',6,'each',200,m),(q,h,'Sample paper','household',1,'each',300,m);
  insert into public.bloom_shopping_items(id,household_id,name,quantity,checked,month,product_id,packs,estimate_cents)
    values(legacy,h,'Sample eggs','1 pack',true,m,p,1,200),(partial,h,'Sample eggs','3 packs',false,m,p,3,600);
  insert into public.bloom_budgets(household_id,month,amount_cents,household_amount_cents) values(h,m,50000,10000);
  payload:=jsonb_build_object('id',gen_random_uuid(),'purchased_on',m+3,'store','Example shop','payer_slot',1,'notes','Synthetic mixed purchase',
    'items',jsonb_build_array(
      jsonb_build_object('product_id',p,'name','Sample eggs','category','food','packs',1,'line_total_cents',249,
        'stock_quantity',6,'stock_unit','each','location','refrigerator','shopping_item_id',legacy,'shopping_revision',1),
      jsonb_build_object('product_id',q,'name','Sample paper','category','household','packs',1,'line_total_cents',400,'stock_quantity',null)));
  perform set_config('bloom_checkout_test.whole',payload::text,true);
  perform public.bloom_record_receipt(payload);
  perform public.bloom_record_receipt(payload);
  if (select count(*) from public.bloom_receipts)<>1 or (select count(*) from public.bloom_money_entries)<>2
    or (select sum(amount_cents) from public.bloom_money_entries)<>649 then raise exception 'FAIL: mixed checkout retry/spending'; end if;
  if (select count(*) from public.bloom_inventory)<>1 or (select quantity from public.bloom_inventory)<>6 then raise exception 'FAIL: linked food stock'; end if;
  if (select price_cents from public.bloom_products where id=p)<>200 then raise exception 'FAIL: actual purchase changed reference price'; end if;
  if (select amount_cents from public.bloom_budgets)<>50000 then raise exception 'FAIL: checkout rewrote budget allocation'; end if;
end $$;

do $$ declare payload jsonb:=current_setting('bloom_checkout_test.whole')::jsonb; bad jsonb; r bigint;
begin
  select revision into r from public.bloom_shopping_items where id=current_setting('bloom_checkout_test.legacy_item')::uuid;
  bad:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{items,0,shopping_revision}',to_jsonb(r));
  begin perform public.bloom_record_receipt(bad); raise exception 'FAIL: fully fulfilled item purchased twice'; exception when unique_violation then null; end;
  bad:=jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid()));
  begin perform public.bloom_record_receipt(bad); raise exception 'FAIL: stale shopping revision accepted'; exception when serialization_failure then null; end;
  bad:=bad#-'{items,0,shopping_revision}';
  begin perform public.bloom_record_receipt(bad); raise exception 'FAIL: missing shopping revision accepted'; exception when invalid_parameter_value then null; end;
  bad:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{items,0,shopping_revision}',to_jsonb(r));
  bad:=jsonb_set(bad,'{items,0,stock_quantity}','null');
  begin perform public.bloom_record_receipt(bad); raise exception 'FAIL: linked food omitted stock'; exception when invalid_parameter_value then null; end;
  bad:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{items,0,product_id}',to_jsonb(current_setting('bloom_checkout_test.other_product')));
  begin perform public.bloom_record_receipt(bad); raise exception 'FAIL: cross-household product'; exception when check_violation then null; end;
  bad:=jsonb_set(payload,'{notes}','"Changed retry"');
  begin perform public.bloom_record_receipt(bad); raise exception 'FAIL: changed accepted payload reused'; exception when unique_violation then null; end;
  if (select count(*) from public.bloom_receipts)<>1 or (select count(*) from public.bloom_money_entries)<>2 or (select count(*) from public.bloom_inventory)<>1 then
    raise exception 'FAIL: rejected checkout left partial effects'; end if;
end $$;

-- Partial fulfillment is a different purchase only after reviewing its remainder.
do $$ declare p uuid:=current_setting('bloom_checkout_test.product')::uuid; item_id uuid:=current_setting('bloom_checkout_test.partial_item')::uuid;
  m date:=current_setting('bloom_checkout_test.month')::date; first_payload jsonb; second_payload jsonb;
begin
  first_payload:=jsonb_build_object('id',gen_random_uuid(),'purchased_on',m+4,'store','Example shop','items',jsonb_build_array(
    jsonb_build_object('product_id',p,'name','Sample eggs','category','food','packs',1,'line_total_cents',271,
      'stock_quantity',6,'stock_unit','each','location','refrigerator','shopping_item_id',item_id,'shopping_revision',1)));
  perform public.bloom_record_receipt(first_payload);
  if (select packs from public.bloom_shopping_items where id=item_id)<>2 or (select checked from public.bloom_shopping_items where id=item_id) then raise exception 'FAIL: partial remainder'; end if;
  second_payload:=jsonb_set(first_payload,'{id}',to_jsonb(gen_random_uuid()));
  begin perform public.bloom_record_receipt(second_payload); raise exception 'FAIL: concurrent stale partial purchase'; exception when serialization_failure then null; end;
  second_payload:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(second_payload,'{items,0,shopping_revision}','2'),'{items,0,packs}','2'),'{items,0,stock_quantity}','12'),'{items,0,line_total_cents}','478'),'{purchased_on}',to_jsonb((m+interval '1 month')::date));
  perform public.bloom_record_receipt(second_payload);
  perform public.bloom_record_receipt(second_payload);
  if not (select checked from public.bloom_shopping_items where id=item_id) then raise exception 'FAIL: final remainder not checked'; end if;
  if (select sum(amount_cents) from public.bloom_money_entries where occurred_on>=m and occurred_on<m+interval '1 month')<>920 then raise exception 'FAIL: current-month spending'; end if;
  if (select sum(amount_cents) from public.bloom_money_entries where occurred_on>=m+interval '1 month' and occurred_on<m+interval '2 months')<>478 then raise exception 'FAIL: purchase-date month history'; end if;
  if (select sum(quantity) from public.bloom_inventory)<>24 then raise exception 'FAIL: repeated stock quantities'; end if;
end $$;

-- An explicit reversal restores the old checkbox state, not an invented purchase.
do $$ declare payload jsonb:=current_setting('bloom_checkout_test.whole')::jsonb; r bigint;
begin
  perform public.bloom_void_receipt((payload->>'id')::uuid);
  perform public.bloom_void_receipt((payload->>'id')::uuid);
  begin perform public.bloom_record_receipt(payload); raise exception 'FAIL: reversed receipt retry claimed success'; exception when check_violation then null; end;
  select revision into r from public.bloom_shopping_items where id=current_setting('bloom_checkout_test.legacy_item')::uuid;
  payload:=jsonb_set(jsonb_set(payload,'{id}',to_jsonb(gen_random_uuid())),'{items,0,shopping_revision}',to_jsonb(r));
  perform public.bloom_record_receipt(payload);
  if (select count(*) from public.bloom_receipts where voided_at is null)<>3 then raise exception 'FAIL: reviewed repurchase after reversal'; end if;
  if (select sum(amount_cents) from public.bloom_money_entries where voided_at is null)<>1398 then raise exception 'FAIL: reversal double counted'; end if;
end $$;

-- Recurring rules, separate month snapshots, fixed values and unknown variables.
do $$ declare m date:=current_setting('bloom_checkout_test.month')::date; fixed uuid:=gen_random_uuid(); variable_id uuid:=gen_random_uuid();
  payload jsonb; row_bill public.bloom_bills%rowtype; result jsonb;
begin
  perform set_config('bloom_checkout_test.fixed_series',fixed::text,true);
  perform set_config('bloom_checkout_test.variable_series',variable_id::text,true);
  payload:=jsonb_build_object('id',fixed,'month',(m-interval '1 month')::date,'name','Example fixed bill','amount_cents',1000,'variable',false,
    'due_on',((m-interval '1 month')::date+14),'notes','Example fixed note','repeat_monthly',true,'apply_future',false);
  perform public.bloom_save_bill(payload);
  perform public.bloom_save_bill(payload);
  perform public.bloom_ensure_bill_month(m);
  select * into row_bill from public.bloom_bills b where b.series_id=fixed and b.month=m;
  perform set_config('bloom_checkout_test.current_fixed',row_bill.id::text,true);
  payload:=jsonb_build_object('id',row_bill.id,'revision',row_bill.revision,'month',m,'name','Example fixed bill','amount_cents',1234,
    'variable',false,'due_on',m+14,'notes','Example fixed note','repeat_monthly',true,'apply_future',true);
  perform public.bloom_save_bill(payload);
  perform public.bloom_save_bill(payload);
  begin perform public.bloom_save_bill(jsonb_set(payload,'{amount_cents}','1235')); raise exception 'FAIL: stale bill edit'; exception when serialization_failure then null; end;
  if (select count(*) from public.bloom_bills where series_id=fixed)<>2 then raise exception 'FAIL: duplicate recurring bill save'; end if;
  payload:=jsonb_build_object('id',variable_id,'month',m,'name','Example variable bill','amount_cents',null,'variable',true,'due_on',null,
    'notes','Past range is a reference, not a charge.','repeat_monthly',true,'apply_future',false);
  perform public.bloom_save_bill(payload);
  result:=public.bloom_ensure_bill_month((m+interval '1 month')::date);
  if (result->>'inserted')::integer<>2 then raise exception 'FAIL: missing new-month bills'; end if;
  result:=public.bloom_ensure_bill_month((m+interval '1 month')::date);
  if (result->>'inserted')::integer<>0 then raise exception 'FAIL: month ensure duplicated bills'; end if;
  perform public.bloom_ensure_bill_month((m+interval '2 months')::date);
  perform public.bloom_ensure_bill_month((m+interval '3 months')::date);
  perform public.bloom_ensure_bill_month((m+interval '4 months')::date);
  if exists(select 1 from public.bloom_bills where series_id=variable_id and amount_cents is not null) then raise exception 'FAIL: variable default invented an amount'; end if;
  if exists(select 1 from public.bloom_money_entries where bill_id is not null) then raise exception 'FAIL: bill plan created spending'; end if;
end $$;

-- An explicit payment fills only the unknown monthly amount, not its rule.
do $$ declare m date:=current_setting('bloom_checkout_test.month')::date; b uuid:=current_setting('bloom_checkout_test.variable_series')::uuid; payload jsonb;
begin
  payload:=jsonb_build_object('id',gen_random_uuid(),'occurred_on',m+5,'direction','expense','category','bill','amount_cents',4321,
    'description','Example variable bill payment','payer_slot',2,'bill_id',b);
  perform set_config('bloom_checkout_test.variable_payment',payload::text,true);
  perform public.bloom_record_money_entry(payload);
  perform public.bloom_record_money_entry(payload);
  if (select amount_cents from public.bloom_bills where id=b)<>4321 or not (select is_override from public.bloom_bills where id=b) then raise exception 'FAIL: actual bill amount not saved'; end if;
  if exists(select 1 from public.bloom_bill_rules where series_id=b and amount_cents is not null)
    or exists(select 1 from public.bloom_bills where series_id=b and month>m and amount_cents is not null) then raise exception 'FAIL: variable actual copied to future'; end if;
  if (select count(*) from public.bloom_money_entries where bill_id=b)<>1 then raise exception 'FAIL: variable payment duplicate'; end if;
  perform public.bloom_void_money_entry((payload->>'id')::uuid);
  if (select amount_cents from public.bloom_bills where id=b)<>4321 then raise exception 'FAIL: reversing payment erased actual bill amount'; end if;
  begin perform public.bloom_record_money_entry(payload); raise exception 'FAIL: reversed payment retry claimed success'; exception when check_violation then null; end;
end $$;

-- Future previews follow new defaults only until a user edits or pays them.
do $$ declare m date:=current_setting('bloom_checkout_test.month')::date; s uuid:=current_setting('bloom_checkout_test.fixed_series')::uuid;
  row_bill public.bloom_bills%rowtype; payload jsonb;
begin
  select * into row_bill from public.bloom_bills where series_id=s and month=(m+interval '2 months')::date;
  payload:=jsonb_build_object('id',row_bill.id,'revision',row_bill.revision,'month',row_bill.month,'name',row_bill.name,'amount_cents',7777,
    'variable',false,'due_on',row_bill.due_on,'notes','One-month override','repeat_monthly',true,'apply_future',false);
  perform public.bloom_save_bill(payload);
  update public.bloom_bills set amount_cents=8888 where series_id=s and month=(m+interval '4 months')::date;
  if not (select is_override from public.bloom_bills where series_id=s and month=(m+interval '4 months')::date) then raise exception 'FAIL: old-client edit not protected'; end if;
  select * into row_bill from public.bloom_bills where series_id=s and month=(m+interval '3 months')::date;
  perform public.bloom_record_money_entry(jsonb_build_object('id',gen_random_uuid(),'occurred_on',m+6,'direction','expense','category','bill',
    'amount_cents',1234,'description','Paid future example bill','bill_id',row_bill.id));
  select * into row_bill from public.bloom_bills where id=current_setting('bloom_checkout_test.current_fixed')::uuid;
  payload:=jsonb_build_object('id',row_bill.id,'revision',row_bill.revision,'month',m,'name','Example fixed bill','amount_cents',1500,
    'variable',false,'due_on',m+14,'notes','Example fixed note','repeat_monthly',true,'apply_future',true);
  perform public.bloom_save_bill(payload);
  perform public.bloom_save_bill(payload);
  if (select amount_cents from public.bloom_bills where series_id=s and month=m-interval '1 month')<>1000 then raise exception 'FAIL: past bill changed'; end if;
  if (select amount_cents from public.bloom_bills where series_id=s and month=m+interval '1 month')<>1500 then raise exception 'FAIL: future untouched preview not refreshed'; end if;
  if (select amount_cents from public.bloom_bills where series_id=s and month=m+interval '2 months')<>7777 then raise exception 'FAIL: monthly override overwritten'; end if;
  if (select amount_cents from public.bloom_bills where series_id=s and month=m+interval '3 months')<>1234 then raise exception 'FAIL: paid future bill overwritten'; end if;
  if (select amount_cents from public.bloom_bills where series_id=s and month=m+interval '4 months')<>8888 then raise exception 'FAIL: old-client edit overwritten'; end if;
  perform public.bloom_stop_bill_series(s,(m+interval '1 month')::date);
  perform public.bloom_stop_bill_series(s,(m+interval '1 month')::date);
  if not (select cancelled from public.bloom_bills where series_id=s and month=m+interval '1 month') then raise exception 'FAIL: future generated bill not cancelled'; end if;
  if exists(select 1 from public.bloom_bills where series_id=s and month<>m+interval '1 month' and cancelled) then raise exception 'FAIL: stop altered a historical/edited/paid bill'; end if;
  perform public.bloom_ensure_bill_month((m+interval '5 months')::date);
  if exists(select 1 from public.bloom_bills where series_id=s and month=m+interval '5 months') then raise exception 'FAIL: stopped series regenerated'; end if;
  select * into row_bill from public.bloom_bills where series_id=s and month=m+interval '1 month';
  begin
    perform public.bloom_record_money_entry(jsonb_build_object('id',gen_random_uuid(),'occurred_on',m+6,'direction','expense','category','bill',
      'amount_cents',1500,'description','Cancelled future bill','bill_id',row_bill.id));
    raise exception 'FAIL: cancelled bill paid without restoring plan';
  exception when check_violation then null; end;
end $$;

-- Rule access and recurring history stay inside the household.
do $$ declare h uuid:=current_setting('bloom_checkout_test.household')::uuid; m date:=current_setting('bloom_checkout_test.month')::date; begin
  begin insert into public.bloom_bill_rules(household_id,series_id,effective_month,name) values(h,gen_random_uuid(),m,'Forbidden direct rule'); raise exception 'FAIL: direct recurring rule write'; exception when insufficient_privilege then null; end;
  begin update public.bloom_bills set rule_id=gen_random_uuid() where id=current_setting('bloom_checkout_test.current_fixed')::uuid; raise exception 'FAIL: forged rule link'; exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('bloom_checkout_test.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_checkout_test.outsider'),'role','authenticated')::text,true);
do $$ declare m date:=current_setting('bloom_checkout_test.month')::date; begin
  if exists(select 1 from public.bloom_bill_rules where household_id=current_setting('bloom_checkout_test.household')::uuid) then raise exception 'FAIL: outsider read rules'; end if;
  begin perform public.bloom_stop_bill_series(current_setting('bloom_checkout_test.fixed_series')::uuid,m); raise exception 'FAIL: outsider stopped rules'; exception when insufficient_privilege then null; end;
  begin perform public.bloom_save_bill(jsonb_build_object('id',current_setting('bloom_checkout_test.current_fixed'),'revision',1,'month',m,'name','Cross-household','amount_cents',1,'variable',false,'repeat_monthly',false,'apply_future',false)); raise exception 'FAIL: outsider saved bill'; exception when unique_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('bloom_checkout_test.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_checkout_test.owner'),'role','authenticated')::text,true);

-- Legacy version-1 backups remain supported; new rules restore before bills.
do $$ declare h uuid:=current_setting('bloom_checkout_test.household')::uuid; m date:=current_setting('bloom_checkout_test.month')::date;
  b jsonb; result jsonb; series uuid:=gen_random_uuid(); rule_id_value uuid:=gen_random_uuid(); bill_id_value uuid:=gen_random_uuid();
begin
  b:=jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',h,'exported_at',now(),
    'data',jsonb_build_object('billRules',(select jsonb_agg(to_jsonb(r)) from public.bloom_bill_rules r),
      'bills',(select jsonb_agg(to_jsonb(r)) from public.bloom_bills r)));
  result:=public.bloom_restore_household_backup(b);
  if (result->'inserted'->>'billRules')::integer<>0 or (result->'inserted'->>'bills')::integer<>0 then raise exception 'FAIL: backup replay duplicated bill history'; end if;
  b:=jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',h,'exported_at',now(),'data',jsonb_build_object('bills',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'household_id',h,'month',m,'name','Legacy one-off bill','amount_cents',222,'variable',false,'notes','Legacy backup'))));
  result:=public.bloom_restore_household_backup(b);
  if (result->'inserted'->>'bills')::integer<>1 then raise exception 'FAIL: legacy backup not restored'; end if;
  b:=jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',h,'exported_at',now(),'data',jsonb_build_object(
    'billRules',jsonb_build_array(jsonb_build_object('id',rule_id_value,'household_id',h,'series_id',series,'effective_month',m,'name','Restored recurring bill','amount_cents',333,'variable',false,'active',true,'notes','')),
    'bills',jsonb_build_array(jsonb_build_object('id',bill_id_value,'household_id',h,'month',m,'name','Restored recurring bill','amount_cents',333,'variable',false,'notes','','series_id',series,'rule_id',rule_id_value,'is_override',false,'cancelled',false))));
  result:=public.bloom_restore_household_backup(b);
  if (result->'inserted'->>'billRules')::integer<>1 or (result->'inserted'->>'bills')::integer<>1 then raise exception 'FAIL: rule/bill restore dependency'; end if;
  perform public.bloom_ensure_bill_month((m+interval '1 month')::date);
  if (select amount_cents from public.bloom_bills where series_id=series and month=(m+interval '1 month')::date)<>333 then raise exception 'FAIL: restored recurrence not usable'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin perform public.bloom_ensure_bill_month(current_setting('bloom_checkout_test.month')::date); raise exception 'FAIL: anonymous bill generation'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.bloom_bill_rules; raise exception 'FAIL: anonymous rule read'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: atomic checkout, legacy tick recovery, partial/repeated purchases, reversals, monthly recurrence, future overrides, variable bill actuals, backup restore, and household isolation; synthetic changes rolled back' as result;
rollback;
