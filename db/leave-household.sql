-- Life in Bloom: allow a signed-in user to leave their current household
-- without signing out of their account.
--
-- If an owner leaves a two-person household, ownership transfers to the
-- remaining member. If the owner is the only member, leaving removes the
-- household and its shared database records through existing cascades.

create or replace function bloom_private.leave_household()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  household uuid;
  actor_role text;
  other_user uuid;
  member_count integer;
begin
  if actor is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select m.household_id, m.role
    into household, actor_role
  from public.bloom_household_members m
  where m.user_id = actor
  for update;

  if household is null then
    raise exception 'You are not currently in a household.' using errcode = '22023';
  end if;

  select count(*) into member_count
  from public.bloom_household_members
  where household_id = household;

  if actor_role = 'owner' then
    select m.user_id into other_user
    from public.bloom_household_members m
    where m.household_id = household and m.user_id <> actor
    limit 1
    for update;

    if other_user is not null then
      update public.bloom_households
      set owner_user_id = other_user
      where id = household and owner_user_id = actor;

      update public.bloom_household_members
      set role = 'owner'
      where household_id = household and user_id = other_user;
    elsif member_count = 1 then
      delete from public.bloom_households
      where id = household and owner_user_id = actor;

      return jsonb_build_object(
        'left', true,
        'household_deleted', true,
        'ownership_transferred', false
      );
    end if;
  end if;

  delete from public.bloom_household_members
  where household_id = household and user_id = actor;

  if not found then
    raise exception 'Your household membership changed. Refresh and try again.' using errcode = '40001';
  end if;

  delete from bloom_private.household_invites where household_id = household;

  return jsonb_build_object(
    'left', true,
    'household_deleted', false,
    'ownership_transferred', other_user is not null
  );
end;
$$;

create or replace function public.bloom_leave_household()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select bloom_private.leave_household(); $$;

revoke all on function bloom_private.leave_household()
  from public, anon, authenticated;
grant execute on function bloom_private.leave_household()
  to authenticated;

revoke all on function public.bloom_leave_household()
  from public, anon, authenticated;
grant execute on function public.bloom_leave_household()
  to authenticated;
