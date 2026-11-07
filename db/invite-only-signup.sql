-- Life in Bloom invite-only account creation.
-- Applied to the Life in Bloom Development Supabase project.
-- IMPORTANT: after applying this schema, enable the Auth Hook in:
-- Authentication -> Hooks -> Before User Created -> public.bloom_before_user_created
--
-- Access codes are never stored in plaintext. The browser exchanges a valid code
-- for a short-lived one-time signup token through the bloom-claim-access-code
-- Edge Function. Supabase Auth then calls bloom_before_user_created before the
-- user is inserted.

create schema if not exists private;

create table if not exists private.bloom_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text,
  active boolean not null default true,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  notes text
);

create table if not exists private.bloom_access_claims (
  id uuid primary key default gen_random_uuid(),
  access_code_id uuid not null references private.bloom_access_codes(id) on delete cascade,
  token_hash text not null unique,
  email_normalized text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  user_id uuid
);

create index if not exists bloom_access_claims_code_pending_idx
  on private.bloom_access_claims(access_code_id, expires_at)
  where consumed_at is null;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.bloom_claim_access_code_server(p_code text, p_email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_code private.bloom_access_codes%rowtype;
  v_token uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email,'')));
  v_pending integer;
begin
  if length(trim(coalesce(p_code,''))) < 6 or length(trim(coalesce(p_code,''))) > 128 then
    raise exception 'That access code is not valid.';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  select *
    into v_code
    from private.bloom_access_codes
   where code_hash = encode(extensions.digest(lower(trim(p_code)), 'sha256'), 'hex')
   for update;

  if not found
     or not v_code.active
     or (v_code.expires_at is not null and v_code.expires_at <= now()) then
    raise exception 'That access code is not valid or has expired.';
  end if;

  delete from private.bloom_access_claims
   where consumed_at is null
     and (expires_at <= now()
          or (access_code_id = v_code.id and email_normalized = v_email));

  select count(*)
    into v_pending
    from private.bloom_access_claims
   where access_code_id = v_code.id
     and consumed_at is null
     and expires_at > now();

  if v_code.use_count + v_pending >= v_code.max_uses then
    raise exception 'That access code has already been used.';
  end if;

  insert into private.bloom_access_claims(access_code_id, token_hash, email_normalized, expires_at)
  values (
    v_code.id,
    encode(extensions.digest(v_token::text, 'sha256'), 'hex'),
    v_email,
    now() + interval '10 minutes'
  );

  return v_token;
end;
$$;

revoke all on function public.bloom_claim_access_code_server(text,text)
  from public, anon, authenticated;
grant execute on function public.bloom_claim_access_code_server(text,text)
  to service_role;

grant usage on schema private to service_role;
grant select, insert, update, delete on private.bloom_access_codes to service_role;
grant select, insert, update, delete on private.bloom_access_claims to service_role;

create or replace function public.bloom_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(event->'user'->>'email','')));
  v_user_id uuid := nullif(event->'user'->>'id','')::uuid;
  v_token text := coalesce(
    event->'user'->'user_metadata'->>'signup_token',
    event->'user'->'raw_user_meta_data'->>'signup_token',
    ''
  );
  v_claim private.bloom_access_claims%rowtype;
  v_code private.bloom_access_codes%rowtype;
begin
  if v_token = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Life in Bloom is invitation-only. Enter a valid access code before creating an account.'
      )
    );
  end if;

  select c.*
    into v_claim
    from private.bloom_access_claims c
   where c.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
     and c.email_normalized = v_email
     and c.consumed_at is null
     and c.expires_at > now()
   for update;

  if not found then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'That signup invitation is invalid or expired. Enter your access code again.'
      )
    );
  end if;

  select *
    into v_code
    from private.bloom_access_codes
   where id = v_claim.access_code_id
   for update;

  if not found
     or not v_code.active
     or (v_code.expires_at is not null and v_code.expires_at <= now())
     or v_code.use_count >= v_code.max_uses then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'That access code is no longer available.'
      )
    );
  end if;

  update private.bloom_access_claims
     set consumed_at = now(), user_id = v_user_id
   where id = v_claim.id;

  update private.bloom_access_codes
     set use_count = use_count + 1,
         last_used_at = now(),
         active = case when use_count + 1 >= max_uses then false else active end
   where id = v_code.id;

  return '{}'::jsonb;
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant select, update on private.bloom_access_codes to supabase_auth_admin;
grant select, update on private.bloom_access_claims to supabase_auth_admin;
grant execute on function public.bloom_before_user_created(jsonb)
  to supabase_auth_admin;
revoke execute on function public.bloom_before_user_created(jsonb)
  from public, anon, authenticated;

comment on table private.bloom_access_codes is
  'Invitation-only signup access codes. Only SHA-256 hashes are stored.';
comment on table private.bloom_access_claims is
  'Short-lived one-time signup claims exchanged from valid access codes.';
