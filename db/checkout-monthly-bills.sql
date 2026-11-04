-- Confirmed grocery checkout and recurring monthly bill snapshots.
-- Apply after recipe-reference-nutrition.sql. No household data is seeded.
-- Existing public RPC wrappers and private implementation ACLs are preserved.
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
    if saved.voided_at is not null then
      raise exception 'This purchase was reversed. Review the shopping list before recording a new purchase.' using errcode = '23514';
    end if;
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
      expected_revision := bloom_private.food_cents(item->'shopping_revision','Shopping revision');
      if expected_revision < 1 then raise exception 'Review the current shopping item before recording its purchase.' using errcode = '22023'; end if;
      if expected_revision <> shopping_row.revision then
        raise exception 'The shopping item changed while this receipt was open. Refresh and review the receipt before saving.' using errcode = '40001';
      end if;
      if item_category='food' and coalesce(stock_qty,0)<=0 then
        raise exception 'Enter the food quantity and storage location so this checked item can be added to food at home.' using errcode = '22023';
      end if;
      -- A legacy checklist tick is recoverable; only an active fully fulfilled
      -- receipt blocks another new purchase of this same shopping request.
      if exists(select 1 from public.bloom_receipts r where r.household_id=household and r.voided_at is null
        and r.shopping_effects @> jsonb_build_array(jsonb_build_object('id',item_shopping,'after',jsonb_build_object('checked',true)))) then
        raise exception 'This shopping item already has a recorded purchase. Open its shopping trip to review or reverse it.' using errcode = '23505';
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

create index bloom_receipts_active_shopping_idx on public.bloom_receipts using gin(shopping_effects) where voided_at is null;

comment on table public.bloom_shopping_items is 'Monthly purchase requests. Confirmed checkout links a current revision to one atomic receipt, inventory and spending. Legacy checklist-only ticks still require purchase details.';

-- Effective-month rules are separate from the immutable meaning of an actual
-- month. Variable rules always carry an unknown amount into a new month.
create table public.bloom_bill_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  series_id uuid not null,
  effective_month date not null check (isfinite(effective_month) and extract(day from effective_month)=1),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  amount_cents bigint check (amount_cents between 0 and 1000000000),
  variable boolean not null default false,
  active boolean not null default true,
  due_day integer check (due_day between 1 and 31),
  notes text not null default '' check (char_length(notes)<=4000),
  revision bigint not null default 1 check (revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not variable or amount_cents is null),
  unique(household_id,series_id,effective_month),
  unique(household_id,series_id,id)
);
create trigger bloom_bill_rule_revision before insert or update on public.bloom_bill_rules
for each row execute function bloom_private.guard_revision('id','household_id','series_id','effective_month','created_at');
alter table public.bloom_bill_rules enable row level security;
revoke all on public.bloom_bill_rules from public,anon,authenticated;
grant select on public.bloom_bill_rules to authenticated;
create policy bloom_bill_rules_read on public.bloom_bill_rules for select to authenticated
using (bloom_private.is_member(household_id));

alter table public.bloom_bills
  add column series_id uuid,
  add column rule_id uuid,
  add column is_override boolean not null default false,
  add column cancelled boolean not null default false,
  add column last_save_payload jsonb check (last_save_payload is null or (jsonb_typeof(last_save_payload)='object' and octet_length(last_save_payload::text)<=16000)),
  add constraint bloom_bill_rule_link_check check ((series_id is null)=(rule_id is null)),
  add foreign key (household_id,series_id,rule_id) references public.bloom_bill_rules(household_id,series_id,id),
  add unique(household_id,series_id,month);
create index bloom_bills_rule_idx on public.bloom_bills(household_id,series_id,rule_id);

-- Old clients may still edit ordinary month rows directly. Treat those writes
-- as explicit month overrides and do not let them forge recurrence provenance.
create function bloom_private.bill_direct_edit_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') then
    if TG_OP='INSERT' then
      if NEW.series_id is not null or NEW.rule_id is not null or NEW.cancelled or NEW.last_save_payload is not null then
        raise exception 'Save recurring bill settings through the monthly bill form.' using errcode='23514';
      end if;
    elsif NEW.series_id is distinct from OLD.series_id or NEW.rule_id is distinct from OLD.rule_id
      or NEW.cancelled is distinct from OLD.cancelled or NEW.last_save_payload is distinct from OLD.last_save_payload then
      raise exception 'Recurring bill history is managed by the monthly bill form.' using errcode='23514';
    end if;
    NEW.is_override:=true;
    NEW.last_save_payload:=null;
  end if;
  return NEW;
end;
$$;
create trigger bloom_bill_direct_edit before insert or update on public.bloom_bills
for each row execute function bloom_private.bill_direct_edit_guard();
revoke all on function bloom_private.bill_direct_edit_guard() from public,anon,authenticated;

create function bloom_private.bill_month(value date)
returns date language plpgsql immutable security invoker set search_path='' as $$
begin
  if value is null or not isfinite(value) or extract(day from value)<>1 or value<'1900-01-01'::date or value>'2200-12-01'::date then
    raise exception 'Choose a valid bill month.' using errcode='22023';
  end if;
  return value;
end;
$$;
create function bloom_private.bill_due_date(p_month date,p_day integer)
returns date language sql immutable security invoker set search_path='' as $$
  select case when p_day is null then null else p_month+(least(p_day,extract(day from (p_month+interval '1 month - 1 day'))::integer)-1) end;
$$;

-- Refresh only auto-generated future previews. Current and past month rows,
-- explicit edits, and any bill with a real payment are always preserved.
create function bloom_private.refresh_bill_series(p_household uuid,p_series uuid,p_from_month date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare row_bill public.bloom_bills%rowtype; rule public.bloom_bill_rules%rowtype;
  now_month date:=date_trunc('month',now() at time zone 'America/New_York')::date;
  changed integer:=0; stopped integer:=0; due date;
begin
  for row_bill in select b.* from public.bloom_bills b
    where b.household_id=p_household and b.series_id=p_series and b.month>=p_from_month and b.month>now_month
      and not b.is_override
      and not exists(select 1 from public.bloom_money_entries e where e.household_id=p_household and e.bill_id=b.id and e.voided_at is null)
    order by b.month for update loop
    select * into rule from public.bloom_bill_rules r where r.household_id=p_household and r.series_id=p_series
      and r.effective_month<=row_bill.month order by r.effective_month desc limit 1;
    if not found then continue; end if;
    if not rule.active then
      if not row_bill.cancelled or row_bill.rule_id is distinct from rule.id then
        update public.bloom_bills set cancelled=true,rule_id=rule.id where id=row_bill.id and household_id=p_household;
        stopped:=stopped+1;
      end if;
    else
      due:=bloom_private.bill_due_date(row_bill.month,rule.due_day);
      if row_bill.cancelled or row_bill.rule_id is distinct from rule.id or row_bill.name is distinct from rule.name
        or row_bill.amount_cents is distinct from rule.amount_cents or row_bill.variable is distinct from rule.variable
        or row_bill.due_on is distinct from due or row_bill.notes is distinct from rule.notes then
        update public.bloom_bills set name=rule.name,amount_cents=rule.amount_cents,variable=rule.variable,
          due_on=due,notes=rule.notes,rule_id=rule.id,cancelled=false
        where id=row_bill.id and household_id=p_household;
        changed:=changed+1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('updated',changed,'cancelled',stopped);
end;
$$;

create function bloom_private.ensure_bill_month(p_month date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare household uuid; rule public.bloom_bill_rules%rowtype; count_added integer:=0; n integer;
begin
  household:=bloom_private.food_lock_household();
  perform bloom_private.bill_month(p_month);
  for rule in select distinct on (r.series_id) r.* from public.bloom_bill_rules r
    where r.household_id=household and r.effective_month<=p_month
    order by r.series_id,r.effective_month desc loop
    if not rule.active then continue; end if;
    insert into public.bloom_bills(household_id,month,name,amount_cents,variable,due_on,notes,series_id,rule_id,is_override)
    values(household,p_month,rule.name,rule.amount_cents,rule.variable,bloom_private.bill_due_date(p_month,rule.due_day),rule.notes,rule.series_id,rule.id,false)
    on conflict(household_id,series_id,month) do nothing;
    get diagnostics n=row_count;
    count_added:=count_added+n;
  end loop;
  return jsonb_build_object('month',p_month,'inserted',count_added);
end;
$$;

create function bloom_private.save_bill(p_bill jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare household uuid; bill_id uuid; selected_month date; expected bigint; amount bigint; due date;
  bill_name text; bill_notes text; varying boolean; repeating boolean; future_change boolean;
  old_bill public.bloom_bills%rowtype; saved_rule public.bloom_bill_rules%rowtype;
  series uuid; rule_id_value uuid; has_old boolean; rule_changed boolean:=false;
begin
  household:=bloom_private.food_lock_household();
  if not bloom_private.food_object_keys_ok(p_bill,array['id','revision','month','name','amount_cents','variable','due_on','notes','repeat_monthly','apply_future']) then
    raise exception 'The bill contains unsupported fields.' using errcode='22023';
  end if;
  bill_id:=nullif(p_bill->>'id','')::uuid;
  if bill_id is null then raise exception 'The bill needs its stable save identifier.' using errcode='22023'; end if;
  select * into old_bill from public.bloom_bills b where b.id=bill_id and b.household_id=household for update;
  has_old:=found;
  if has_old and old_bill.last_save_payload is not distinct from p_bill then return bill_id; end if;
  expected:=bloom_private.food_cents(p_bill->'revision','Bill revision',true);
  if has_old then
    if expected is null or expected<1 or expected<>old_bill.revision then
      raise exception 'This bill changed. Refresh its saved month before editing it.' using errcode='40001';
    end if;
  elsif expected is not null or exists(select 1 from public.bloom_bills b where b.id=bill_id) then
    raise exception 'This bill is no longer available for this save.' using errcode='23505';
  end if;
  selected_month:=bloom_private.bill_month(bloom_private.food_date(p_bill->>'month','Bill month',true));
  if has_old and old_bill.month<>selected_month then raise exception 'A saved bill cannot be moved to another month.' using errcode='23514'; end if;
  bill_name:=btrim(coalesce(p_bill->>'name','')); bill_notes:=coalesce(p_bill->>'notes','');
  if char_length(bill_name) not between 1 and 160 or char_length(bill_notes)>4000 then
    raise exception 'Enter a bill name and notes within the supported lengths.' using errcode='22023';
  end if;
  if jsonb_typeof(p_bill->'variable') is distinct from 'boolean'
    or (p_bill ? 'repeat_monthly' and jsonb_typeof(p_bill->'repeat_monthly') is distinct from 'boolean')
    or (p_bill ? 'apply_future' and jsonb_typeof(p_bill->'apply_future') is distinct from 'boolean') then
    raise exception 'Choose the bill type and repetition settings.' using errcode='22023';
  end if;
  varying:=(p_bill->>'variable')::boolean;
  repeating:=coalesce((p_bill->>'repeat_monthly')::boolean,false);
  future_change:=coalesce((p_bill->>'apply_future')::boolean,false);
  amount:=bloom_private.food_cents(p_bill->'amount_cents','Bill amount',true);
  due:=bloom_private.food_date(p_bill->>'due_on','Bill due date');
  if due is not null and date_trunc('month',due)::date<>selected_month then raise exception 'Choose a due date in this bill month.' using errcode='22023'; end if;
  series:=old_bill.series_id; rule_id_value:=old_bill.rule_id;
  if repeating and series is null then series:=bill_id; future_change:=true; end if;
  if future_change and series is not null then
    insert into public.bloom_bill_rules(household_id,series_id,effective_month,name,amount_cents,variable,active,due_day,notes)
    values(household,series,selected_month,bill_name,case when varying then null else amount end,varying,repeating,extract(day from due)::integer,bill_notes)
    on conflict(household_id,series_id,effective_month) do update set name=excluded.name,amount_cents=excluded.amount_cents,
      variable=excluded.variable,active=excluded.active,due_day=excluded.due_day,notes=excluded.notes
    returning * into saved_rule;
    rule_id_value:=saved_rule.id;
    rule_changed:=true;
  end if;
  if has_old then
    update public.bloom_bills set name=bill_name,amount_cents=amount,variable=varying,due_on=due,notes=bill_notes,
      series_id=series,rule_id=rule_id_value,is_override=not rule_changed or (varying and amount is not null),cancelled=false,last_save_payload=p_bill
    where id=bill_id and household_id=household;
  else
    insert into public.bloom_bills(id,household_id,month,name,amount_cents,variable,due_on,notes,series_id,rule_id,is_override,last_save_payload)
    values(bill_id,household,selected_month,bill_name,amount,varying,due,bill_notes,series,rule_id_value,not rule_changed or (varying and amount is not null),p_bill);
  end if;
  if rule_changed then perform bloom_private.refresh_bill_series(household,series,selected_month); end if;
  return bill_id;
end;
$$;

create function bloom_private.stop_bill_series(p_series_id uuid,p_from_month date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare household uuid; rule public.bloom_bill_rules%rowtype; result jsonb;
begin
  household:=bloom_private.food_lock_household();
  perform bloom_private.bill_month(p_from_month);
  select * into rule from public.bloom_bill_rules r where r.household_id=household and r.series_id=p_series_id
    and r.effective_month<=p_from_month order by r.effective_month desc limit 1;
  if not found then raise exception 'This repeating bill is not available for that month.' using errcode='42501'; end if;
  insert into public.bloom_bill_rules(household_id,series_id,effective_month,name,amount_cents,variable,active,due_day,notes)
  values(household,p_series_id,p_from_month,rule.name,rule.amount_cents,rule.variable,false,rule.due_day,rule.notes)
  on conflict(household_id,series_id,effective_month) do update set active=false;
  -- Stop also cancels previously scheduled later rule changes. A later explicit
  -- future-scope save can restart the series from its chosen month.
  update public.bloom_bill_rules set active=false
    where household_id=household and series_id=p_series_id and effective_month>p_from_month and active;
  result:=bloom_private.refresh_bill_series(household,p_series_id,p_from_month);
  return result||jsonb_build_object('series_id',p_series_id,'from_month',p_from_month);
end;
$$;

create function public.bloom_save_bill(p_bill jsonb)
returns uuid language sql volatile security invoker set search_path='' as $$ select bloom_private.save_bill(p_bill); $$;
create function public.bloom_ensure_bill_month(p_month date)
returns jsonb language sql volatile security invoker set search_path='' as $$ select bloom_private.ensure_bill_month(p_month); $$;
create function public.bloom_stop_bill_series(p_series_id uuid,p_from_month date)
returns jsonb language sql volatile security invoker set search_path='' as $$ select bloom_private.stop_bill_series(p_series_id,p_from_month); $$;
revoke all on function bloom_private.bill_month(date),bloom_private.bill_due_date(date,integer),bloom_private.refresh_bill_series(uuid,uuid,date),
  bloom_private.save_bill(jsonb),bloom_private.ensure_bill_month(date),bloom_private.stop_bill_series(uuid,date) from public,anon,authenticated;
grant execute on function bloom_private.save_bill(jsonb),bloom_private.ensure_bill_month(date),bloom_private.stop_bill_series(uuid,date) to authenticated;
revoke all on function public.bloom_save_bill(jsonb),public.bloom_ensure_bill_month(date),public.bloom_stop_bill_series(uuid,date) from public,anon,authenticated;
grant execute on function public.bloom_save_bill(jsonb),public.bloom_ensure_bill_month(date),public.bloom_stop_bill_series(uuid,date) to authenticated;

comment on table public.bloom_bill_rules is 'Effective-month recurring bill rules. Fixed amounts repeat; variable amounts stay unknown. Monthly bills are saved snapshots, never payments.';
comment on column public.bloom_bills.is_override is 'A user-edited monthly amount must not be overwritten by a recurring default change.';
comment on column public.bloom_bills.cancelled is 'An unpaid generated future bill cancelled by stopping recurrence; history remains readable.';

-- Keep payment retries and cancelled monthly plans coherent.
create or replace function bloom_private.record_money_entry(p_entry jsonb)
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
    if saved.voided_at is not null then raise exception 'This payment was reversed. Review the bill before recording a new payment.' using errcode='23514'; end if;
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
    if exists(select 1 from public.bloom_bills b where b.id=bill and b.household_id=household and b.cancelled) then
      raise exception 'This future bill was cancelled. Restore its monthly plan before recording payment.' using errcode='23514';
    end if;
    if exists(select 1 from public.bloom_money_entries e where e.household_id=household and e.bill_id=bill and e.voided_at is null) then
      raise exception 'This bill already has a recorded payment. Review or reverse that payment before replacing it.' using errcode = '23505';
    end if;
    -- The explicitly entered full payment also supplies a previously unknown
    -- actual bill amount for this month. Recurring variable rules stay null.
    update public.bloom_bills set amount_cents=amount,is_override=true,last_save_payload=null
      where id=bill and household_id=household and amount_cents is null;
  end if;
  insert into public.bloom_money_entries(id,household_id,occurred_on,direction,category,amount_cents,description,payer_slot,bill_id,request_payload,created_by)
  values(entry,household,entry_date,direction_value,category_value,amount,coalesce(p_entry->>'description',''),payer,bill,p_entry,actor);
  return entry;
end;
$$;


-- Add billRules to the existing allowlisted, additive backup workflow.
create or replace function bloom_private.food_restore_row(p_table text, p_row jsonb, p_household uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare actual jsonb; candidate jsonb; k text; metadata_keys text[]; columns_sql text; values_sql text; ref uuid;
begin
  if p_table not in ('bloom_bill_rules','bloom_products','bloom_recurring_products','bloom_budgets','bloom_inventory','bloom_shopping_items','bloom_bills','bloom_recipes','bloom_meal_entries','bloom_receipts','bloom_money_entries','bloom_food_files') then
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

create or replace function bloom_private.food_check_receipt_history(p_household uuid, p_receipt uuid)
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

create or replace function bloom_private.restore_household_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; data jsonb; rows jsonb; row_value jsonb; k text;
  keys text[] := array['billRules','products','bills','recipes','recurringProducts','budgets','receipts','moneyEntries','inventory','shoppingItems','mealEntries','foodFiles'];
  tables text[] := array['bloom_bill_rules','bloom_products','bloom_bills','bloom_recipes','bloom_recurring_products','bloom_budgets','bloom_receipts','bloom_money_entries','bloom_inventory','bloom_shopping_items','bloom_meal_entries','bloom_food_files'];
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

