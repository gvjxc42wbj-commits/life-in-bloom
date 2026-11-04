-- Life in Bloom: Grocery account and household foundation.
-- Apply as a reviewed hosted-database migration. No personal or example data.
-- The legacy browser backup is deliberately outside this schema.

create schema if not exists bloom_private;
revoke all on schema bloom_private from public, anon, authenticated;
grant usage on schema bloom_private to authenticated;
alter default privileges in schema bloom_private revoke execute on functions from public;

create table public.bloom_households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index bloom_households_owner_idx on public.bloom_households(owner_user_id);

create table public.bloom_household_members (
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.bloom_private_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  age_years integer check (age_years between 0 and 130),
  height_cm numeric check (height_cm > 0 and height_cm <= 300),
  weight_kg numeric check (weight_kg > 0 and weight_kg <= 700),
  activity_level text not null default '' check (char_length(activity_level) <= 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bloom_diet_profiles (
  household_id uuid not null,
  user_id uuid not null,
  display_name text not null default '' check (char_length(display_name) <= 80),
  color text not null default 'pink' check (color in ('pink', 'purple')),
  calories_kcal numeric check (calories_kcal between 0 and 20000),
  protein_g numeric check (protein_g between 0 and 2000),
  carbs_g numeric check (carbs_g between 0 and 2000),
  fat_g numeric check (fat_g between 0 and 2000),
  fiber_g numeric check (fiber_g between 0 and 2000),
  allergies text not null default '' check (char_length(allergies) <= 4000),
  restrictions text not null default '' check (char_length(restrictions) <= 4000),
  preferences text not null default '' check (char_length(preferences) <= 4000),
  notes text not null default '' check (char_length(notes) <= 4000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id),
  foreign key (household_id, user_id) references public.bloom_household_members(household_id, user_id) on delete cascade
);
create index bloom_diet_profiles_user_idx on public.bloom_diet_profiles(user_id);

create table public.bloom_budgets (
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  month date not null check (extract(day from month) = 1 and isfinite(month)),
  amount_cents bigint not null check (amount_cents between 0 and 1000000000),
  currency text not null default 'USD' check (currency = 'USD'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, month)
);

create table public.bloom_inventory (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  brand text not null default '' check (char_length(brand) <= 120),
  quantity numeric not null check (quantity between 0 and 1000000000),
  unit text not null check (char_length(btrim(unit)) between 1 and 30),
  location text not null check (location in ('pantry', 'refrigerator', 'freezer')),
  expires_on date check (isfinite(expires_on)),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid not null default auth.uid(),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bloom_inventory_household_idx on public.bloom_inventory(household_id);

create table public.bloom_shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  quantity text not null default '' check (char_length(quantity) <= 120),
  checked boolean not null default false,
  source_key text check (char_length(source_key) between 1 and 240),
  created_by uuid not null default auth.uid(),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, source_key)
);

-- Codes are never stored in plaintext, and this schema is not exposed to PostgREST.
create table bloom_private.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  code_hash text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid
);
create index bloom_invites_household_idx on bloom_private.household_invites(household_id);
alter table bloom_private.household_invites enable row level security;
revoke all on bloom_private.household_invites from public, anon, authenticated;

-- Lookup bypasses recursive membership policies, but exposes only a boolean.
create function bloom_private.is_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.bloom_household_members m
    where m.household_id = p_household_id and m.user_id = auth.uid()
  );
$$;

-- Identity fields are immutable; clients filter updates by the old revision.
create function bloom_private.guard_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare field_name text;
begin
  if TG_OP = 'UPDATE' then
    foreach field_name in array TG_ARGV loop
      if (to_jsonb(NEW) -> field_name) is distinct from (to_jsonb(OLD) -> field_name) then
        raise exception 'Record identity cannot be changed.' using errcode = '23514';
      end if;
    end loop;
    if NEW.revision is distinct from OLD.revision then
      raise exception 'Revision is managed by the server.' using errcode = '23514';
    end if;
    NEW.revision := OLD.revision + 1;
  else
    if NEW.revision <> 1 then
      raise exception 'A new record must start at revision 1.' using errcode = '23514';
    end if;
    NEW.created_at := clock_timestamp();
  end if;
  NEW.updated_at := clock_timestamp();
  return NEW;
end;
$$;

create trigger bloom_private_profile_revision before insert or update on public.bloom_private_profiles
for each row execute function bloom_private.guard_revision('user_id','created_at');
create trigger bloom_diet_profile_revision before insert or update on public.bloom_diet_profiles
for each row execute function bloom_private.guard_revision('household_id','user_id','created_at');
create trigger bloom_budget_revision before insert or update on public.bloom_budgets
for each row execute function bloom_private.guard_revision('household_id','month','currency','created_at');
create trigger bloom_inventory_revision before insert or update on public.bloom_inventory
for each row execute function bloom_private.guard_revision('id','household_id','created_by','created_at');
create trigger bloom_shopping_revision before insert or update on public.bloom_shopping_items
for each row execute function bloom_private.guard_revision('id','household_id','source_key','created_by','created_at');

alter table public.bloom_households enable row level security;
alter table public.bloom_household_members enable row level security;
alter table public.bloom_private_profiles enable row level security;
alter table public.bloom_diet_profiles enable row level security;
alter table public.bloom_budgets enable row level security;
alter table public.bloom_inventory enable row level security;
alter table public.bloom_shopping_items enable row level security;

revoke all on public.bloom_households, public.bloom_household_members,
  public.bloom_private_profiles, public.bloom_diet_profiles, public.bloom_budgets,
  public.bloom_inventory, public.bloom_shopping_items from public, anon, authenticated;
grant select on public.bloom_households, public.bloom_household_members to authenticated;
grant select, insert, update on public.bloom_private_profiles, public.bloom_diet_profiles,
  public.bloom_budgets to authenticated;
grant select, insert, update, delete on public.bloom_inventory, public.bloom_shopping_items to authenticated;

create policy household_read on public.bloom_households for select to authenticated
using (bloom_private.is_member(id));
create policy membership_read on public.bloom_household_members for select to authenticated
using (bloom_private.is_member(household_id));

create policy private_profile_read on public.bloom_private_profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy private_profile_insert on public.bloom_private_profiles for insert to authenticated
with check (user_id = (select auth.uid()));
create policy private_profile_update on public.bloom_private_profiles for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy diet_read on public.bloom_diet_profiles for select to authenticated
using (bloom_private.is_member(household_id));
create policy diet_insert on public.bloom_diet_profiles for insert to authenticated
with check (user_id = (select auth.uid()) and bloom_private.is_member(household_id));
create policy diet_update on public.bloom_diet_profiles for update to authenticated
using (user_id = (select auth.uid()) and bloom_private.is_member(household_id))
with check (user_id = (select auth.uid()) and bloom_private.is_member(household_id));

create policy budget_read on public.bloom_budgets for select to authenticated
using (bloom_private.is_member(household_id));
create policy budget_insert on public.bloom_budgets for insert to authenticated
with check (bloom_private.is_member(household_id));
create policy budget_update on public.bloom_budgets for update to authenticated
using (bloom_private.is_member(household_id)) with check (bloom_private.is_member(household_id));

create policy inventory_read on public.bloom_inventory for select to authenticated
using (bloom_private.is_member(household_id));
create policy inventory_insert on public.bloom_inventory for insert to authenticated
with check (bloom_private.is_member(household_id) and created_by = (select auth.uid()));
create policy inventory_update on public.bloom_inventory for update to authenticated
using (bloom_private.is_member(household_id)) with check (bloom_private.is_member(household_id));
create policy inventory_delete on public.bloom_inventory for delete to authenticated
using (bloom_private.is_member(household_id));

create policy shopping_read on public.bloom_shopping_items for select to authenticated
using (bloom_private.is_member(household_id));
create policy shopping_insert on public.bloom_shopping_items for insert to authenticated
with check (bloom_private.is_member(household_id) and created_by = (select auth.uid()));
create policy shopping_update on public.bloom_shopping_items for update to authenticated
using (bloom_private.is_member(household_id)) with check (bloom_private.is_member(household_id));
create policy shopping_delete on public.bloom_shopping_items for delete to authenticated
using (bloom_private.is_member(household_id));

create function bloom_private.create_household(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Choose a household name of 1 to 80 characters.' using errcode = '22023';
  end if;
  -- Every create/join locks this user first, then the household if applicable.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 732941));
  if exists (select 1 from public.bloom_household_members where user_id = actor) then
    raise exception 'You already belong to a household.' using errcode = '23505';
  end if;
  insert into public.bloom_households(name, owner_user_id) values (btrim(p_name), actor) returning id into household;
  insert into public.bloom_household_members(household_id, user_id, role) values (household, actor, 'owner');
  return household;
end;
$$;

create function bloom_private.create_invite()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; code text; deadline timestamptz;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select h.id into household from public.bloom_households h
    join public.bloom_household_members m on m.household_id = h.id and m.user_id = actor
    where h.owner_user_id = actor and m.role = 'owner' for update of h;
  if household is null then raise exception 'Only the household owner can create an invitation.' using errcode = '42501'; end if;
  if (select count(*) from public.bloom_household_members where household_id = household) >= 2 then
    raise exception 'This household already has two members.' using errcode = '23514';
  end if;
  code := encode(extensions.gen_random_bytes(32), 'hex');
  deadline := clock_timestamp() + interval '48 hours';
  delete from bloom_private.household_invites where household_id = household;
  insert into bloom_private.household_invites(household_id, code_hash, created_by, expires_at)
    values (household, encode(extensions.digest(code, 'sha256'), 'hex'), actor, deadline);
  return jsonb_build_object('invite_code', code, 'expires_at', deadline);
end;
$$;

create function bloom_private.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid; invitation uuid; hashed text;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_code is null or lower(btrim(p_code)) !~ '^[0-9a-f]{64}$' then
    raise exception 'This invitation is invalid or has expired.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 732941));
  if exists (select 1 from public.bloom_household_members where user_id = actor) then
    raise exception 'You already belong to a household.' using errcode = '23505';
  end if;
  hashed := encode(extensions.digest(lower(btrim(p_code)), 'sha256'), 'hex');
  select i.household_id into household from bloom_private.household_invites i where i.code_hash = hashed;
  if household is null then raise exception 'This invitation is invalid or has expired.' using errcode = '22023'; end if;
  -- Serialize joins, invitations, and removals through the household row.
  perform 1 from public.bloom_households h where h.id = household for update;
  select i.id into invitation from bloom_private.household_invites i
    where i.code_hash = hashed and i.household_id = household and i.used_at is null and i.expires_at > clock_timestamp()
    for update;
  if invitation is null then raise exception 'This invitation is invalid or has expired.' using errcode = '22023'; end if;
  if (select count(*) from public.bloom_household_members where household_id = household) >= 2 then
    raise exception 'This household already has two members.' using errcode = '23514';
  end if;
  insert into public.bloom_household_members(household_id, user_id, role) values (household, actor, 'member');
  update bloom_private.household_invites set used_at = clock_timestamp(), used_by = actor where id = invitation;
  return household;
end;
$$;

create function bloom_private.remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); household uuid;
begin
  if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select h.id into household from public.bloom_households h
    join public.bloom_household_members m on m.household_id = h.id and m.user_id = actor
    where h.owner_user_id = actor and m.role = 'owner' for update of h;
  if household is null or p_user_id is null or p_user_id = actor then
    raise exception 'Only the household owner can remove the other member.' using errcode = '42501';
  end if;
  delete from public.bloom_household_members where household_id = household and user_id = p_user_id and role = 'member';
  if not found then raise exception 'That member is not in your household.' using errcode = '22023'; end if;
  delete from bloom_private.household_invites where household_id = household;
end;
$$;

-- API wrappers are invokers; only the checked implementations below have elevated access.
create function public.bloom_create_household(p_name text)
returns uuid language sql volatile security invoker set search_path = '' as $$ select bloom_private.create_household(p_name); $$;
create function public.bloom_create_invite()
returns jsonb language sql volatile security invoker set search_path = '' as $$ select bloom_private.create_invite(); $$;
create function public.bloom_join_household(p_code text)
returns uuid language sql volatile security invoker set search_path = '' as $$ select bloom_private.join_household(p_code); $$;
create function public.bloom_remove_member(p_user_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select bloom_private.remove_member(p_user_id); $$;

revoke all on function bloom_private.is_member(uuid), bloom_private.guard_revision(),
  bloom_private.create_household(text), bloom_private.create_invite(), bloom_private.join_household(text),
  bloom_private.remove_member(uuid) from public, anon, authenticated;
grant execute on function bloom_private.is_member(uuid), bloom_private.create_household(text),
  bloom_private.create_invite(), bloom_private.join_household(text), bloom_private.remove_member(uuid) to authenticated;
revoke all on function public.bloom_create_household(text), public.bloom_create_invite(),
  public.bloom_join_household(text), public.bloom_remove_member(uuid) from public, anon, authenticated;
grant execute on function public.bloom_create_household(text), public.bloom_create_invite(),
  public.bloom_join_household(text), public.bloom_remove_member(uuid) to authenticated;

comment on table public.bloom_private_profiles is 'Owner-only optional inputs. Never copied from a personal browser backup.';
comment on table public.bloom_diet_profiles is 'Only the fields the person chooses to share for household food planning.';
comment on table public.bloom_shopping_items is 'Checklist only: checking an item does not record a purchase or change stock or spending.';
