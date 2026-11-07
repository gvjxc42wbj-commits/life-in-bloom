-- Life in Bloom: Dog note categories, Housework categories, and default dog schedule.
-- Applied to the development Supabase project on 2026-11-07.

do $do$
declare
  definition text;
begin
  select pg_get_functiondef('bloom_private.life_validate_data(text,jsonb,uuid,uuid)'::regprocedure)
    into definition;

  definition := replace(
    definition,
    'p_data->>''category'' not in (''feeding'',''movement'',''dental'',''grooming'',''medication'',''vet'',''training'',''other'')',
    'p_data->>''category'' not in (''feeding'',''movement'',''dental'',''grooming'',''medication'',''vet'',''training'',''other'',''cleaning_shared_spaces'',''kitchen_duties'',''trash'',''repairs'',''laundry'',''outdoor_seasonal'',''household_management'',''other_housework'')'
  );

  definition := replace(
    definition,
    'p_data->>''kind'' not in (''behavior'',''training'')',
    'p_data->>''kind'' not in (''behavior'',''training'',''general'',''vet'')'
  );

  definition := replace(
    definition,
    'raise exception ''Choose Behavior or Training.''',
    'raise exception ''Choose General note or Vet note.'''
  );

  execute definition;
end;
$do$;

create or replace function bloom_private.ensure_default_dog_routines()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  household uuid;
  added integer := 0;
  today date := (now() at time zone 'America/New_York')::date;
  record_id uuid;
begin
  household := bloom_private.food_lock_household();

  if not exists (
    select 1 from public.bloom_life_records
    where household_id = household and kind = 'routine_task' and not archived
      and data->>'domain' = 'dog' and lower(data->>'name') = 'potty break'
  ) then
    record_id := gen_random_uuid();
    insert into public.bloom_life_records(id, household_id, user_id, kind, record_key, data)
    values (record_id, household, null, 'routine_task', record_id::text,
      jsonb_build_object('domain','dog','name','Potty break','category','movement','frequency','daily',
        'interval_days',1,'interval_months',1,'anchor_on',today,'end_on',null,
        'times',jsonb_build_array('09:00','13:00','18:00','22:00'),
        'rolling',true,'active',true,'dose_text','','notes','Daily potty breaks.'));
    added := added + 1;
  end if;

  if not exists (
    select 1 from public.bloom_life_records
    where household_id = household and kind = 'routine_task' and not archived
      and data->>'domain' = 'dog' and lower(data->>'name') = 'breakfast'
  ) then
    record_id := gen_random_uuid();
    insert into public.bloom_life_records(id, household_id, user_id, kind, record_key, data)
    values (record_id, household, null, 'routine_task', record_id::text,
      jsonb_build_object('domain','dog','name','Breakfast','category','feeding','frequency','daily',
        'interval_days',1,'interval_months',1,'anchor_on',today,'end_on',null,
        'times',jsonb_build_array('13:00'),'rolling',true,'active',true,'dose_text','','notes','Daily breakfast.'));
    added := added + 1;
  end if;

  if not exists (
    select 1 from public.bloom_life_records
    where household_id = household and kind = 'routine_task' and not archived
      and data->>'domain' = 'dog' and lower(data->>'name') = 'dinner'
  ) then
    record_id := gen_random_uuid();
    insert into public.bloom_life_records(id, household_id, user_id, kind, record_key, data)
    values (record_id, household, null, 'routine_task', record_id::text,
      jsonb_build_object('domain','dog','name','Dinner','category','feeding','frequency','daily',
        'interval_days',1,'interval_months',1,'anchor_on',today,'end_on',null,
        'times',jsonb_build_array('20:00'),'rolling',true,'active',true,'dose_text','','notes','Daily dinner.'));
    added := added + 1;
  end if;

  return added;
end;
$fn$;

create or replace function public.bloom_ensure_default_dog_routines()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $sql$ select bloom_private.ensure_default_dog_routines(); $sql$;

revoke all on function bloom_private.ensure_default_dog_routines() from public, anon, authenticated;
grant execute on function bloom_private.ensure_default_dog_routines() to authenticated;
revoke all on function public.bloom_ensure_default_dog_routines() from public, anon, authenticated;
grant execute on function public.bloom_ensure_default_dog_routines() to authenticated;
