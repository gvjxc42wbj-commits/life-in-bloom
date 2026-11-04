-- Synthetic authenticated planner verification; every identity and record rolls back.
begin;
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); begin
  perform set_config('bloom_meal_test.owner',a::text,true);
  perform set_config('bloom_meal_test.outsider',b::text,true);
  perform set_config('bloom_meal_test.today',(now() at time zone 'America/New_York')::date::text,true);
  insert into auth.users(id,aud,role,email,created_at,updated_at) values
    (a,'authenticated','authenticated','meal-owner-'||a||'@example.invalid',now(),now()),
    (b,'authenticated','authenticated','meal-outsider-'||b||'@example.invalid',now(),now());
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('bloom_meal_test.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_meal_test.outsider'),'role','authenticated')::text,true);
select set_config('bloom_meal_test.other',public.bloom_create_household('Other meal rollback household')::text,true);
do $$ declare r uuid:=gen_random_uuid(); begin
  insert into public.bloom_recipes(id,household_id,name,servings) values(r,current_setting('bloom_meal_test.other')::uuid,'Other household recipe',2);
  perform set_config('bloom_meal_test.other_recipe',r::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('bloom_meal_test.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_meal_test.owner'),'role','authenticated')::text,true);
select set_config('bloom_meal_test.household',public.bloom_create_household('Meal rollback household')::text,true);

-- Two recipes share one stock pool; their exact shortage rounds to one package.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); today_value date:=current_setting('bloom_meal_test.today')::date;
  lines jsonb; payload jsonb; row_id uuid;
begin
  perform set_config('bloom_meal_test.rice',p::text,true);
  perform set_config('bloom_meal_test.rice_recipe',r::text,true);
  perform set_config('bloom_meal_test.plan_a',a::text,true);
  perform set_config('bloom_meal_test.plan_b',b::text,true);
  insert into public.bloom_products(id,household_id,name,category,package_quantity,package_unit,price_cents)
    values(p,h,'Example rice','food',500,'g',100);
  insert into public.bloom_inventory(household_id,name,quantity,unit,location,product_id)
    values(h,'Example rice',250,'g','pantry',p);
  lines:=jsonb_build_array(jsonb_build_object('name','Example rice','quantity',300,'unit','grams','product_id',p,'optional',false,'notes',''));
  insert into public.bloom_recipes(id,household_id,name,servings,planning_ingredients) values(r,h,'Example rice meal',2,lines);
  if (select planning_ingredients->0->>'unit' from public.bloom_recipes where id=r)<>'grams' then raise exception 'FAIL: template was rewritten, breaking exact insert retry'; end if;
  lines:=jsonb_set(lines,'{0,included}','true');
  payload:=jsonb_build_object('id',a,'request_id',gen_random_uuid(),'recipe_id',r,'recipe_revision',1,'cook_on',today_value+2,'servings',2,
    'person1_servings',1,'person2_servings',1,'notes','','ingredients',lines);
  perform set_config('bloom_meal_test.a_payload',payload::text,true);
  perform public.bloom_save_cooking_plan(payload);
  perform public.bloom_save_cooking_plan(payload);
  if (select count(*) from public.bloom_cooking_plans)<>1 or (select count(*) from public.bloom_shopping_items)<>1 then raise exception 'FAIL: repeated plan save duplicated records'; end if;
  if (select packs from public.bloom_shopping_items)<>1 or (select estimate_cents from public.bloom_shopping_items)<>100 then raise exception 'FAIL: stock shortage package estimate'; end if;
  if (select requirements->0->>'quantity' from public.bloom_cooking_plans where id=a)::numeric<>300 then raise exception 'FAIL: full-recipe serving scale'; end if;
  payload:=payload||jsonb_build_object('id',b,'request_id',gen_random_uuid(),'cook_on',today_value+3);
  perform set_config('bloom_meal_test.b_payload',payload::text,true);
  perform public.bloom_save_cooking_plan(payload);
  if (select count(*) from public.bloom_shopping_items)<>1 or (select packs from public.bloom_shopping_items)<>1 then raise exception 'FAIL: each recipe rounded a package independently'; end if;
  if (select jsonb_array_length(plan_refs) from public.bloom_meal_shopping_links)<>2 then raise exception 'FAIL: combined groceries lost meal references'; end if;
  if (select month from public.bloom_shopping_items)<>date_trunc('month',today_value)::date then raise exception 'FAIL: groceries were hidden until cooking month'; end if;
  if (select sum(quantity) from public.bloom_inventory)<>250 or exists(select 1 from public.bloom_money_entries) or exists(select 1 from public.bloom_meal_entries) then
    raise exception 'FAIL: planning consumed stock or created spending/nutrition'; end if;
end $$;

-- Editing is revision-checked and idempotent; manual pending packages count once.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; b uuid:=current_setting('bloom_meal_test.plan_b')::uuid;
  payload jsonb:=current_setting('bloom_meal_test.b_payload')::jsonb; row_plan public.bloom_cooking_plans%rowtype;
  manual uuid:=gen_random_uuid(); before_manual jsonb; bad jsonb;
begin
  select * into row_plan from public.bloom_cooking_plans where id=b;
  payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',row_plan.revision,'servings',6);
  perform public.bloom_save_cooking_plan(payload);
  perform public.bloom_save_cooking_plan(payload);
  if (select packs from public.bloom_shopping_items)<>2 then raise exception 'FAIL: changed servings did not update shortage'; end if;
  bad:=payload||jsonb_build_object('request_id',gen_random_uuid(),'servings',5);
  begin perform public.bloom_save_cooking_plan(bad); raise exception 'FAIL: stale plan revision accepted'; exception when serialization_failure then null; end;
  begin perform public.bloom_save_cooking_plan(payload||jsonb_build_object('servings',5)); raise exception 'FAIL: request identifier reused with changed details'; exception when unique_violation then null; end;
  select * into row_plan from public.bloom_cooking_plans where id=b;
  payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',row_plan.revision,'servings',2);
  perform public.bloom_save_cooking_plan(payload);
  insert into public.bloom_shopping_items(id,household_id,name,quantity,month,product_id,packs,estimate_cents)
    values(manual,h,'Keep this manual rice item','One chosen bag',row_plan.shopping_month,current_setting('bloom_meal_test.rice')::uuid,1,90);
  select to_jsonb(s) into before_manual from public.bloom_shopping_items s where id=manual;
  perform public.bloom_reconcile_meal_shopping();
  if (select count(*) from public.bloom_shopping_items)<>1 or (select to_jsonb(s) from public.bloom_shopping_items s where id=manual) is distinct from before_manual then
    raise exception 'FAIL: manual pending stock ignored or overwritten'; end if;
  delete from public.bloom_shopping_items where id=manual;
  perform public.bloom_reconcile_meal_shopping();
  if (select count(*) from public.bloom_shopping_items)<>1 or (select packs from public.bloom_shopping_items)<>1 then raise exception 'FAIL: removed manual coverage did not restore correct shortage'; end if;
end $$;

-- Buying generated groceries leaves the receipt intact; new demand gets a new row.
do $$ declare row_shop public.bloom_shopping_items%rowtype; before_shop jsonb; receipt uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); payload jsonb; row_plan public.bloom_cooking_plans%rowtype; cancel_id uuid:=gen_random_uuid();
begin
  select * into row_shop from public.bloom_shopping_items limit 1;
  perform set_config('bloom_meal_test.completed_shopping',row_shop.id::text,true);
  perform public.bloom_record_receipt(jsonb_build_object('id',receipt,'purchased_on',current_setting('bloom_meal_test.today'),'items',jsonb_build_array(
    jsonb_build_object('product_id',row_shop.product_id,'name',row_shop.name,'category','food','packs',1,'line_total_cents',100,
      'stock_quantity',500,'stock_unit','g','location','pantry','shopping_item_id',row_shop.id,'shopping_revision',row_shop.revision))));
  select to_jsonb(s) into before_shop from public.bloom_shopping_items s where id=row_shop.id;
  perform public.bloom_reconcile_meal_shopping();
  if (select count(*) from public.bloom_shopping_items)<>1 or (select to_jsonb(s) from public.bloom_shopping_items s where id=row_shop.id) is distinct from before_shop then
    raise exception 'FAIL: completed groceries were changed or re-added'; end if;
  payload:=current_setting('bloom_meal_test.a_payload')::jsonb||jsonb_build_object('id',c,'request_id',gen_random_uuid(),'cook_on',current_setting('bloom_meal_test.today')::date+4);
  perform public.bloom_save_cooking_plan(payload);
  if (select count(*) from public.bloom_shopping_items where not checked)<>1 then raise exception 'FAIL: additional uncovered meal missing'; end if;
  if exists(select 1 from public.bloom_shopping_items where id=row_shop.id and not checked) then raise exception 'FAIL: reused completed shopping identifier'; end if;
  select * into row_plan from public.bloom_cooking_plans where id=c;
  perform public.bloom_cancel_cooking_plan(c,row_plan.revision,cancel_id);
  perform public.bloom_cancel_cooking_plan(c,row_plan.revision,cancel_id);
  if (select count(*) from public.bloom_shopping_items)<>1 then raise exception 'FAIL: cancellation retained generated unbought item'; end if;
  begin perform public.bloom_save_cooking_plan(payload); raise exception 'FAIL: old save resurrected cancelled plan'; exception when check_violation then null; end;
  perform public.bloom_void_receipt(receipt);
  perform public.bloom_reconcile_meal_shopping();
  if (select sum(quantity) from public.bloom_inventory)<>250 or exists(select 1 from public.bloom_money_entries where voided_at is null) then
    raise exception 'FAIL: planning broke ordinary receipt reversal'; end if;
end $$;

-- A partial trip's remaining list row is preserved so its reversal still works.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
  plan_id uuid:=gen_random_uuid(); trip uuid:=gen_random_uuid(); payload jsonb; row_shop public.bloom_shopping_items%rowtype;
  row_plan public.bloom_cooking_plans%rowtype; after_purchase jsonb;
begin
  insert into public.bloom_products(id,household_id,name,package_quantity,package_unit,price_cents) values(p,h,'Example partial food',1,'each',20);
  insert into public.bloom_recipes(id,household_id,name,servings) values(r,h,'Example partial meal',1);
  payload:=jsonb_build_object('id',plan_id,'request_id',gen_random_uuid(),'recipe_id',r,'recipe_revision',1,'cook_on',current_setting('bloom_meal_test.today')::date+2,'servings',1,
    'ingredients',jsonb_build_array(jsonb_build_object('name','Example partial food','quantity',3,'unit','each','product_id',p,'included',true)));
  perform public.bloom_save_cooking_plan(payload);
  select * into row_shop from public.bloom_shopping_items where product_id=p;
  perform public.bloom_record_receipt(jsonb_build_object('id',trip,'purchased_on',current_setting('bloom_meal_test.today'),'items',jsonb_build_array(
    jsonb_build_object('product_id',p,'name',row_shop.name,'category','food','packs',1,'line_total_cents',20,'stock_quantity',1,'stock_unit','each','location','pantry',
      'shopping_item_id',row_shop.id,'shopping_revision',row_shop.revision))));
  select to_jsonb(s) into after_purchase from public.bloom_shopping_items s where id=row_shop.id;
  perform public.bloom_reconcile_meal_shopping();
  select * into row_plan from public.bloom_cooking_plans where id=plan_id;
  perform public.bloom_cancel_cooking_plan(plan_id,row_plan.revision,gen_random_uuid());
  if (select to_jsonb(s) from public.bloom_shopping_items s where id=row_shop.id) is distinct from after_purchase
    or (select count(*) from public.bloom_shopping_items where product_id=p)<>1 then raise exception 'FAIL: partial receipt remainder rewritten or duplicated'; end if;
  perform public.bloom_void_receipt(trip);
  perform public.bloom_reconcile_meal_shopping();
  if exists(select 1 from public.bloom_shopping_items where product_id=p) then raise exception 'FAIL: cancelled reversed remainder left active'; end if;
end $$;

-- Exact generic names/units match stock; known early food dates cannot cover a later meal.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; r uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  plan_id uuid:=gen_random_uuid(); today_value date:=current_setting('bloom_meal_test.today')::date;
begin
  insert into public.bloom_products(id,household_id,name,package_quantity,package_unit,price_cents) values(p,h,'Example dated milk',1,'l',200);
  insert into public.bloom_inventory(household_id,name,quantity,unit,location,expires_on,product_id)
    values(h,'Example dated milk',3,'l','refrigerator',today_value+1,p),(h,'  SAMPLE  CARROT ',4,'pieces','refrigerator',null,null);
  insert into public.bloom_recipes(id,household_id,name,servings) values(r,h,'Example dated meal',4);
  perform public.bloom_save_cooking_plan(jsonb_build_object('id',plan_id,'request_id',gen_random_uuid(),'recipe_id',r,'recipe_revision',1,'cook_on',today_value+3,'servings',2,
    'ingredients',jsonb_build_array(jsonb_build_object('name','Example dated milk','quantity',2,'unit','l','product_id',p),
      jsonb_build_object('name','sample carrot','quantity',4,'unit','each','product_id',null))));
  if (select requirements->0->>'quantity' from public.bloom_cooking_plans where id=plan_id)::numeric<>1 then raise exception 'FAIL: half-yield scale'; end if;
  if (select packs from public.bloom_shopping_items where product_id=p)<>1 then raise exception 'FAIL: early-date stock incorrectly covers planned meal'; end if;
  if exists(select 1 from public.bloom_shopping_items where name='sample carrot') then raise exception 'FAIL: exact generic stock ignored'; end if;
end $$;

-- Unknown or unconvertible amounts need review, and a reviewed completed purchase
-- acknowledges that exact requirement without adding it again on each refresh.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
  plan_id uuid:=gen_random_uuid(); lines jsonb; payload jsonb; trip uuid:=gen_random_uuid(); bought jsonb:='[]'; row_shop public.bloom_shopping_items%rowtype;
  row_plan public.bloom_cooking_plans%rowtype; id_before uuid; before_custom jsonb;
begin
  insert into public.bloom_products(id,household_id,name,package_quantity,package_unit,price_cents) values(p,h,'Example ground spice',26,'oz',300);
  insert into public.bloom_recipes(id,household_id,name,servings) values(r,h,'Example review meal',2);
  lines:=jsonb_build_array(
    jsonb_build_object('name','Example salt','quantity',null,'unit','tsp','product_id',null,'notes','To taste'),
    jsonb_build_object('name','Example garlic','quantity',3,'unit','cloves','product_id',null),
    jsonb_build_object('name','Example ground spice','quantity',2,'unit','tsp','product_id',p),
    jsonb_build_object('name','Example broth','quantity',1,'unit','cup','product_id',null),
    jsonb_build_object('name','Example broth','quantity',3,'unit','tsp','product_id',null),
    jsonb_build_object('name','Excluded garnish','quantity',1,'unit','sprig','optional',true,'product_id',null));
  payload:=jsonb_build_object('id',plan_id,'request_id',gen_random_uuid(),'recipe_id',r,'recipe_revision',1,'cook_on',current_setting('bloom_meal_test.today')::date+5,'servings',2,'ingredients',lines);
  perform set_config('bloom_meal_test.review_payload',payload::text,true);
  perform set_config('bloom_meal_test.review_plan',plan_id::text,true);
  perform set_config('bloom_meal_test.review_recipe',r::text,true);
  perform public.bloom_save_cooking_plan(payload);
  if (select count(*) from public.bloom_shopping_items where name='Example broth')<>1 then raise exception 'FAIL: compatible generic units not combined'; end if;
  if exists(select 1 from public.bloom_shopping_items where name='Excluded garnish') then raise exception 'FAIL: optional ingredient included automatically'; end if;
  if (select packs from public.bloom_shopping_items where name='Example salt') is not null
    or (select estimate_cents from public.bloom_shopping_items where name='Example ground spice') is not null then raise exception 'FAIL: unknown quantity or mass-volume conversion invented'; end if;
  for row_shop in select s.* from public.bloom_shopping_items s where s.name in ('Example salt','Example garlic','Example ground spice') loop
    bought:=bought||jsonb_build_array(jsonb_build_object('product_id',row_shop.product_id,'name',row_shop.name,'category','food','packs',1,'line_total_cents',10,
      'stock_quantity',case when row_shop.product_id is null then 1 else 26 end,'stock_unit',case when row_shop.product_id is null then 'each' else 'oz' end,
      'location','pantry','shopping_item_id',row_shop.id,'shopping_revision',row_shop.revision));
  end loop;
  perform public.bloom_record_receipt(jsonb_build_object('id',trip,'purchased_on',current_setting('bloom_meal_test.today'),'items',bought));
  perform public.bloom_reconcile_meal_shopping();
  perform public.bloom_reconcile_meal_shopping();
  if exists(select 1 from public.bloom_shopping_items where name in ('Example salt','Example garlic','Example ground spice') and not checked) then
    raise exception 'FAIL: reviewed unknown/custom/incompatible requirement immediately re-added'; end if;
  select * into row_plan from public.bloom_cooking_plans where id=plan_id;
  payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',row_plan.revision,'ingredients',jsonb_set(lines,'{1,quantity}','4'));
  perform public.bloom_save_cooking_plan(payload);
  if (select count(*) from public.bloom_shopping_items where name='Example garlic' and not checked)<>1 then raise exception 'FAIL: changed requirement falsely covered by old purchase'; end if;
  payload:=(current_setting('bloom_meal_test.review_payload')::jsonb)||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid());
  perform public.bloom_save_cooking_plan(payload);
  if (select count(*) from public.bloom_shopping_items where name='Example salt' and not checked)<>1 then raise exception 'FAIL: new plan falsely inherited old unknown-amount purchase'; end if;
  select id into id_before from public.bloom_shopping_items where name='Example broth';
  update public.bloom_shopping_items set quantity='My chosen amount',name='Example broth, preferred brand' where id=id_before;
  select to_jsonb(s) into before_custom from public.bloom_shopping_items s where id=id_before;
  perform public.bloom_reconcile_meal_shopping();
  if (select to_jsonb(s) from public.bloom_shopping_items s where id=id_before) is distinct from before_custom
    or (select managed from public.bloom_meal_shopping_links where id=id_before)
    or (select count(*) from public.bloom_shopping_items where name like 'Example broth%')<>1 then
    raise exception 'FAIL: customized generic grocery replaced or recreated'; end if;
end $$;

-- A generic ingredient bought as a selected catalog product retains its exact
-- stock identity, including after rescheduling. That batch is allocated once.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); trip uuid:=gen_random_uuid(); today_value date:=current_setting('bloom_meal_test.today')::date;
  payload jsonb; row_shop public.bloom_shopping_items%rowtype; row_plan public.bloom_cooking_plans%rowtype; after_purchase jsonb;
begin
  insert into public.bloom_products(id,household_id,name,package_quantity,package_unit,price_cents)
    values(p,h,'Example selected lemon bag',4,'each',200);
  insert into public.bloom_recipes(id,household_id,name,servings) values(r,h,'Example mapped lemon meal',1);
  payload:=jsonb_build_object('id',a,'request_id',gen_random_uuid(),'recipe_id',r,'recipe_revision',1,'cook_on',today_value+7,'servings',1,
    'ingredients',jsonb_build_array(jsonb_build_object('name','Example mapped lemons','quantity',2,'unit','each','product_id',null)));
  perform public.bloom_save_cooking_plan(payload);
  select * into strict row_shop from public.bloom_shopping_items where name='Example mapped lemons' and not checked;
  perform public.bloom_record_receipt(jsonb_build_object('id',trip,'purchased_on',today_value,'items',jsonb_build_array(
    jsonb_build_object('name','Example unrelated food on lemon trip','category','food','packs',1,'line_total_cents',10,
      'stock_quantity',7,'stock_unit','each','location','pantry'),
    jsonb_build_object('product_id',p,'name','Example selected lemon bag','category','food','packs',1,'line_total_cents',200,
      'stock_quantity',4,'stock_unit','each','location','pantry','shopping_item_id',row_shop.id,'shopping_revision',row_shop.revision))));
  select to_jsonb(s) into after_purchase from public.bloom_shopping_items s where id=row_shop.id;
  perform public.bloom_reconcile_meal_shopping();
  if exists(select 1 from public.bloom_shopping_items where name='Example mapped lemons' and not checked) then
    raise exception 'FAIL: generic ingredient regenerated after catalog-product checkout'; end if;
  select * into row_plan from public.bloom_cooking_plans where id=a;
  payload:=payload||jsonb_build_object('request_id',gen_random_uuid(),'revision',row_plan.revision,'cook_on',today_value+8,'servings',1.5);
  perform public.bloom_save_cooking_plan(payload);
  if exists(select 1 from public.bloom_shopping_items where name='Example mapped lemons' and not checked) then
    raise exception 'FAIL: rescheduling or increasing a generic meal lost its purchased stock'; end if;
  perform public.bloom_save_cooking_plan((payload-'revision')||jsonb_build_object('id',b,'request_id',gen_random_uuid(),'cook_on',today_value+9,'servings',1));
  if (select count(*) from public.bloom_shopping_items where name='Example mapped lemons' and not checked)<>1
    or (select quantity from public.bloom_shopping_items where name='Example mapped lemons' and not checked) is distinct from '1 each' then
    raise exception 'FAIL: mapped stock was counted twice instead of leaving one lemon short'; end if;
  if (select to_jsonb(s) from public.bloom_shopping_items s where id=row_shop.id) is distinct from after_purchase
    or (select sum(quantity) from public.bloom_inventory where receipt_id=trip and product_id=p)<>4 then
    raise exception 'FAIL: planning changed the purchased row or physical mapped stock'; end if;
end $$;

-- A reviewed purchase covering an unknown plus a known amount acknowledges
-- both original references, while reserving that exact batch from other meals.
-- Missing quantity or an earlier food date removes that acknowledgment.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; p uuid:=gen_random_uuid(); other_product uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); trip uuid:=gen_random_uuid(); batch_id uuid;
  today_value date:=current_setting('bloom_meal_test.today')::date; payload jsonb; row_shop public.bloom_shopping_items%rowtype; after_purchase jsonb;
begin
  insert into public.bloom_products(id,household_id,name,package_quantity,package_unit,price_cents) values
    (p,h,'Example ambiguous herb jar',10,'g',250),(other_product,h,'Example unrelated beans',5,'g',80);
  insert into public.bloom_recipes(id,household_id,name,servings) values(r,h,'Example ambiguous herb meal',1);
  payload:=jsonb_build_object('id',a,'request_id',gen_random_uuid(),'recipe_id',r,'recipe_revision',1,'cook_on',today_value+10,'servings',1,
    'ingredients',jsonb_build_array(
      jsonb_build_object('name','Example blended herb','quantity',null,'unit','g','product_id',null),
      jsonb_build_object('name','Example blended herb','quantity',2,'unit','g','product_id',null)));
  perform public.bloom_save_cooking_plan(payload);
  select * into strict row_shop from public.bloom_shopping_items where name='Example blended herb' and not checked;
  if (select jsonb_array_length(plan_refs) from public.bloom_meal_shopping_links where shopping_id=row_shop.id)<>2 then
    raise exception 'FAIL: unknown plus known requirement did not share one reviewed row'; end if;
  perform public.bloom_record_receipt(jsonb_build_object('id',trip,'purchased_on',today_value,'items',jsonb_build_array(
    jsonb_build_object('product_id',other_product,'name','Example unrelated beans','category','food','packs',1,'line_total_cents',80,
      'stock_quantity',5,'stock_unit','g','location','pantry'),
    jsonb_build_object('product_id',p,'name','Example ambiguous herb jar','category','food','packs',1,'line_total_cents',250,
      'stock_quantity',10,'stock_unit','g','location','pantry','shopping_item_id',row_shop.id,'shopping_revision',row_shop.revision))));
  select id into strict batch_id from public.bloom_inventory where receipt_id=trip and product_id=p;
  select to_jsonb(s) into after_purchase from public.bloom_shopping_items s where id=row_shop.id;
  perform public.bloom_reconcile_meal_shopping();
  if exists(select 1 from public.bloom_shopping_items where name='Example blended herb' and not checked) then
    raise exception 'FAIL: original mixed known and unknown references were not acknowledged'; end if;
  perform public.bloom_save_cooking_plan(payload||jsonb_build_object('id',b,'request_id',gen_random_uuid(),'cook_on',today_value+11,
    'ingredients',jsonb_build_array(jsonb_build_object('name','Example ambiguous herb jar','quantity',3,'unit','g','product_id',p))));
  if (select count(*) from public.bloom_shopping_items where product_id=p and not checked)<>1
    or (select packs from public.bloom_shopping_items where product_id=p and not checked) is distinct from 1::numeric then
    raise exception 'FAIL: unrelated numeric meal reused the reserved ambiguous purchase'; end if;
  perform public.bloom_save_cooking_plan(payload||jsonb_build_object('id',c,'request_id',gen_random_uuid(),'cook_on',today_value+11,
    'ingredients',jsonb_build_array(jsonb_build_object('name','Example unrelated beans','quantity',5,'unit','g','product_id',other_product))));
  if exists(select 1 from public.bloom_shopping_items where product_id=other_product and not checked) then
    raise exception 'FAIL: reservation incorrectly affected unrelated stock on the same receipt'; end if;
  update public.bloom_inventory set expires_on=today_value+1 where id=batch_id;
  perform public.bloom_reconcile_meal_shopping();
  if (select count(*) from public.bloom_shopping_items where name='Example blended herb' and not checked)<>1 then
    raise exception 'FAIL: too-early food date incorrectly acknowledged the recipe purchase'; end if;
  update public.bloom_inventory set expires_on=null where id=batch_id;
  perform public.bloom_reconcile_meal_shopping();
  if exists(select 1 from public.bloom_shopping_items where name='Example blended herb' and not checked) then
    raise exception 'FAIL: eligible restored batch did not cover the reviewed original requirements'; end if;
  update public.bloom_inventory set quantity=0 where id=batch_id;
  perform public.bloom_reconcile_meal_shopping();
  if (select count(*) from public.bloom_shopping_items where name='Example blended herb' and not checked)<>1 then
    raise exception 'FAIL: depleted inventory still acknowledged an old recipe purchase'; end if;
  if (select to_jsonb(s) from public.bloom_shopping_items s where id=row_shop.id) is distinct from after_purchase then
    raise exception 'FAIL: acknowledgment checks rewrote receipt-linked shopping history'; end if;
end $$;

-- Invalid or stale writes roll back completely; recipes from another household fail.
do $$ declare payload jsonb:=current_setting('bloom_meal_test.review_payload')::jsonb; bad jsonb; before_count integer;
begin
  select count(*) into before_count from public.bloom_cooking_plans;
  bad:=payload||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'cook_on',current_setting('bloom_meal_test.today')::date-1);
  begin perform public.bloom_save_cooking_plan(bad); raise exception 'FAIL: new past-date meal accepted'; exception when invalid_parameter_value then null; end;
  bad:=payload||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'person1_servings',3);
  begin perform public.bloom_save_cooking_plan(bad); raise exception 'FAIL: excessive person portions'; exception when invalid_parameter_value then null; end;
  bad:=payload||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'recipe_id',current_setting('bloom_meal_test.other_recipe'));
  begin perform public.bloom_save_cooking_plan(bad); raise exception 'FAIL: foreign recipe accepted'; exception when check_violation then null; end;
  update public.bloom_recipes set notes='Updated source' where id=current_setting('bloom_meal_test.review_recipe')::uuid;
  bad:=payload||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid());
  begin perform public.bloom_save_cooking_plan(bad); raise exception 'FAIL: stale recipe yield accepted'; exception when serialization_failure then null; end;
  if (select count(*) from public.bloom_cooking_plans)<>before_count then raise exception 'FAIL: rejected write left a plan'; end if;
  begin insert into public.bloom_shopping_items(household_id,name,source_key) values(current_setting('bloom_meal_test.household')::uuid,'Forged plan source','meal:'||gen_random_uuid());
    raise exception 'FAIL: direct client forged planner provenance'; exception when check_violation then null; end;
  begin update public.bloom_cooking_plans set status='cancelled'; raise exception 'FAIL: direct plan write'; exception when insufficient_privilege then null; end;
end $$;

-- New backup collections preserve current matches; old backups remain accepted.
do $$ declare h uuid:=current_setting('bloom_meal_test.household')::uuid; backup jsonb; result jsonb; historical jsonb;
  before_inventory jsonb; before_money jsonb; before_count integer;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) into before_inventory from public.bloom_inventory t;
  select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) into before_money from public.bloom_money_entries t;
  backup:=jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',h,'data',jsonb_build_object(
    'cookingPlans',(select jsonb_agg(to_jsonb(t)) from public.bloom_cooking_plans t),
    'mealShoppingLinks',(select jsonb_agg(to_jsonb(t)) from public.bloom_meal_shopping_links t)));
  result:=public.bloom_restore_household_backup(backup);
  if (result->'inserted'->>'cookingPlans')::integer<>0 or (result->'inserted'->>'mealShoppingLinks')::integer<>0 then raise exception 'FAIL: backup replay duplicated plans or links'; end if;
  result:=public.bloom_restore_household_backup(jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',h,'data','{}'::jsonb));
  select to_jsonb(p) into historical from public.bloom_cooking_plans p where p.id=current_setting('bloom_meal_test.plan_a')::uuid;
  historical:=historical||jsonb_build_object('id',gen_random_uuid(),'cook_on',current_setting('bloom_meal_test.today')::date-20,'last_request_id',null,'last_request_payload',null);
  result:=public.bloom_restore_household_backup(jsonb_build_object('app','Life in Bloom Household','version',1,'household_id',h,'data',jsonb_build_object('cookingPlans',jsonb_build_array(historical))));
  if (result->'inserted'->>'cookingPlans')::integer<>1 then raise exception 'FAIL: historical cooking snapshot restore'; end if;
  select count(*) into before_count from public.bloom_shopping_items;
  perform public.bloom_reconcile_meal_shopping();
  if (select count(*) from public.bloom_shopping_items)<>before_count then raise exception 'FAIL: past restored plan added groceries'; end if;
  if (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.bloom_inventory t) is distinct from before_inventory
    or (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.bloom_money_entries t) is distinct from before_money then
    raise exception 'FAIL: restore replayed stock or spending'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('bloom_meal_test.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_meal_test.outsider'),'role','authenticated')::text,true);
do $$ begin
  if exists(select 1 from public.bloom_cooking_plans where household_id=current_setting('bloom_meal_test.household')::uuid)
    or exists(select 1 from public.bloom_meal_shopping_links where household_id=current_setting('bloom_meal_test.household')::uuid) then raise exception 'FAIL: outsider read meal history'; end if;
  begin perform public.bloom_cancel_cooking_plan(current_setting('bloom_meal_test.plan_a')::uuid,1,gen_random_uuid()); raise exception 'FAIL: outsider cancelled meal'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin perform public.bloom_reconcile_meal_shopping(); raise exception 'FAIL: anonymous reconciliation'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.bloom_cooking_plans; raise exception 'FAIL: anonymous meal read'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: serving-scaled cooking plans, stock and pending allocation, package aggregation, editable/cancelled groceries, purchase/reversal preservation, ambiguous-amount acknowledgments, backups, and household isolation; all synthetic changes rolled back' as result;
rollback;
