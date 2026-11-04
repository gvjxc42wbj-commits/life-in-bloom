-- Run as the database owner, after grocery-foundation.sql.
-- Synthetic identities only. Every inserted row and test change rolls back.
begin;

insert into auth.users(id, aud, role, email, created_at, updated_at) values
('11111111-1111-4111-8111-111111111111','authenticated','authenticated','bloom-owner@example.invalid',now(),now()),
('22222222-2222-4222-8222-222222222222','authenticated','authenticated','bloom-member@example.invalid',now(),now()),
('33333333-3333-4333-8333-333333333333','authenticated','authenticated','bloom-outsider@example.invalid',now(),now()),
('44444444-4444-4444-8444-444444444444','authenticated','authenticated','bloom-expiry@example.invalid',now(),now());

-- Test references live only in transaction-local settings; no schema DDL.

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select set_config('bloom_test.household',public.bloom_create_household('Synthetic test household')::text,true);
select set_config('bloom_test.invite',public.bloom_create_invite()->>'invite_code',true);
insert into public.bloom_private_profiles(user_id,display_name,notes)
values(auth.uid(),'Synthetic owner','Private owner test note');
insert into public.bloom_diet_profiles(household_id,user_id,display_name)
values(current_setting('bloom_test.household')::uuid,auth.uid(),'Shared owner label');
insert into public.bloom_budgets(household_id,month,amount_cents)
values(current_setting('bloom_test.household')::uuid,'2026-11-01',60000);
insert into public.bloom_inventory(id,household_id,name,quantity,unit,location)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('bloom_test.household')::uuid,'Synthetic rice',1,'kg','pantry');
insert into public.bloom_shopping_items(household_id,name,quantity,source_key)
values(current_setting('bloom_test.household')::uuid,'Synthetic eggs','1 carton','rollback-test:legacy-item')
on conflict(household_id,source_key) do nothing;
insert into public.bloom_shopping_items(household_id,name,quantity,source_key)
values(current_setting('bloom_test.household')::uuid,'Synthetic eggs','1 carton','rollback-test:legacy-item')
on conflict(household_id,source_key) do nothing;

do $$ begin
  if (select count(*) from public.bloom_shopping_items) <> 1 then raise exception 'FAIL: import is not idempotent'; end if;
  if (select revision from public.bloom_inventory limit 1) <> 1 then raise exception 'FAIL: new revision'; end if;
  begin
    perform public.bloom_create_household('Forbidden second household');
    raise exception 'FAIL: one household per account';
  exception when unique_violation then null; end;
  begin
    perform 1 from bloom_private.household_invites;
    raise exception 'FAIL: invite hashes accessible to member';
  exception when insufficient_privilege then null; end;
end $$;

-- A second real Auth identity joins once and can read/write household records.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select public.bloom_join_household(current_setting('bloom_test.invite'));
insert into public.bloom_private_profiles(user_id,display_name) values(auth.uid(),'Synthetic member');
insert into public.bloom_diet_profiles(household_id,user_id,display_name,color)
values(current_setting('bloom_test.household')::uuid,auth.uid(),'Shared member label','purple');
do $$ declare changed integer; begin
  if (select count(*) from public.bloom_household_members) <> 2 then raise exception 'FAIL: shared membership'; end if;
  if (select count(*) from public.bloom_diet_profiles) <> 2 then raise exception 'FAIL: shared dietary targets'; end if;
  if (select count(*) from public.bloom_private_profiles) <> 1 then raise exception 'FAIL: private profile read boundary'; end if;
  if exists(select 1 from public.bloom_private_profiles where user_id <> auth.uid()) then raise exception 'FAIL: other private profile visible'; end if;
  update public.bloom_diet_profiles set notes='Forbidden edit' where user_id='11111111-1111-4111-8111-111111111111';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: other member shared profile writable'; end if;
  update public.bloom_private_profiles set notes='Forbidden edit' where user_id='11111111-1111-4111-8111-111111111111';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: other private profile writable'; end if;
  update public.bloom_budgets set amount_cents=61000 where month='2026-11-01' and revision=1;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: shared budget update'; end if;
  if (select revision from public.bloom_budgets limit 1) <> 2 then raise exception 'FAIL: automatic revision increment'; end if;
  begin
    perform public.bloom_create_invite();
    raise exception 'FAIL: nonowner created invite';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bloom_remove_member('11111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: nonowner revoked owner';
  exception when insufficient_privilege then null; end;
end $$;

-- Unrelated authenticated user cannot inspect or modify the first household.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
do $$ declare changed integer; begin
  if exists(select 1 from public.bloom_households) or exists(select 1 from public.bloom_household_members)
    or exists(select 1 from public.bloom_budgets) or exists(select 1 from public.bloom_inventory)
    or exists(select 1 from public.bloom_shopping_items) or exists(select 1 from public.bloom_diet_profiles)
    or exists(select 1 from public.bloom_private_profiles) then raise exception 'FAIL: outsider read'; end if;
  update public.bloom_inventory set quantity=999 where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: outsider update'; end if;
  delete from public.bloom_shopping_items;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: outsider delete'; end if;
  begin
    insert into public.bloom_shopping_items(household_id,name) values(current_setting('bloom_test.household')::uuid,'Forbidden');
    raise exception 'FAIL: outsider insert';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.bloom_household_members(household_id,user_id,role)
    values(current_setting('bloom_test.household')::uuid,auth.uid(),'owner');
    raise exception 'FAIL: membership self insert';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bloom_join_household(current_setting('bloom_test.invite'));
    raise exception 'FAIL: invitation reused or third member accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('bloom_test.other_household',public.bloom_create_household('Synthetic other household')::text,true);

-- Original owner: stale writes fail, identities cannot be reassigned, max two.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$ declare changed integer; begin
  update public.bloom_budgets set amount_cents=99999 where month='2026-11-01' and revision=1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: stale budget write'; end if;
  if (select amount_cents from public.bloom_budgets limit 1) <> 61000 then raise exception 'FAIL: stale write changed data'; end if;
  begin
    update public.bloom_inventory set household_id=current_setting('bloom_test.other_household')::uuid
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'FAIL: household identity reassignment';
  exception when check_violation or insufficient_privilege then null; end;
  begin
    update public.bloom_private_profiles set user_id='33333333-3333-4333-8333-333333333333' where user_id=auth.uid();
    raise exception 'FAIL: private owner reassignment';
  exception when check_violation or insufficient_privilege then null; end;
  begin
    update public.bloom_inventory set revision=45 where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'FAIL: revision tampering';
  exception when check_violation then null; end;
  begin
    perform public.bloom_create_invite();
    raise exception 'FAIL: invite permitted when household is full';
  exception when check_violation then null; end;
end $$;

select public.bloom_remove_member('22222222-2222-4222-8222-222222222222');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.bloom_budgets) or exists(select 1 from public.bloom_inventory)
    or exists(select 1 from public.bloom_shopping_items) or exists(select 1 from public.bloom_diet_profiles)
    or exists(select 1 from public.bloom_household_members) then raise exception 'FAIL: revoked member retained household access'; end if;
  if (select count(*) from public.bloom_private_profiles) <> 1 then raise exception 'FAIL: removal deleted own private profile'; end if;
  begin
    perform public.bloom_join_household(current_setting('bloom_test.invite'));
    raise exception 'FAIL: old invitation valid after revocation';
  exception when invalid_parameter_value then null; end;
end $$;

-- Expiration cannot be bypassed. Only test admin changes the private expiry.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select set_config('bloom_test.expired_invite',public.bloom_create_invite()->>'invite_code',true);
reset role;
update bloom_private.household_invites set expires_at=clock_timestamp()-interval '1 minute'
where household_id=current_setting('bloom_test.household')::uuid;
do $$ begin
  if exists(select 1 from bloom_private.household_invites where code_hash=current_setting('bloom_test.expired_invite')) then
    raise exception 'FAIL: invite stored in plaintext';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.bloom_join_household(current_setting('bloom_test.expired_invite'));
    raise exception 'FAIL: expired invitation accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- Anonymous requests have no table or RPC execution grants.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ declare t text; begin
  foreach t in array array['bloom_households','bloom_household_members','bloom_private_profiles','bloom_diet_profiles','bloom_budgets','bloom_inventory','bloom_shopping_items'] loop
    begin
      execute format('select 1 from public.%I limit 1',t);
      raise exception 'FAIL: anon can select %',t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.bloom_create_household('Forbidden anon household');
    raise exception 'FAIL: anon RPC grant';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
rollback;
select 'PASS: household, private/member/outsider/anon access, invite reuse/expiry, revocation, import idempotency, identity and revision checks; all synthetic changes rolled back.' as result;
