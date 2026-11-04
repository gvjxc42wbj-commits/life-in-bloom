-- Correct receipt effect accumulator variable names; preserves function ACLs.
create or replace function bloom_private.record_receipt(p_receipt jsonb)
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
