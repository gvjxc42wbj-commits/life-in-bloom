-- Life in Bloom: private Engineering homework and file shelf.
-- Engineering homework/files are private to the signed-in user within the current household.

create table if not exists public.bloom_engineering_homework (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_on date,
  status text not null default 'open' check (status in ('open','done')),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bloom_engineering_homework enable row level security;
revoke all on public.bloom_engineering_homework from public, anon;
grant select, insert, update, delete on public.bloom_engineering_homework to authenticated;

create policy bloom_engineering_homework_select on public.bloom_engineering_homework
for select to authenticated
using ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

create policy bloom_engineering_homework_insert on public.bloom_engineering_homework
for insert to authenticated
with check ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

create policy bloom_engineering_homework_update on public.bloom_engineering_homework
for update to authenticated
using ((select auth.uid()) = user_id and bloom_private.is_member(household_id))
with check ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

create policy bloom_engineering_homework_delete on public.bloom_engineering_homework
for delete to authenticated
using ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

create table if not exists public.bloom_engineering_files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  homework_id uuid references public.bloom_engineering_homework(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 240),
  path text not null unique check (char_length(path) between 1 and 500),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now()
);

alter table public.bloom_engineering_files enable row level security;
revoke all on public.bloom_engineering_files from public, anon;
grant select, insert, delete on public.bloom_engineering_files to authenticated;

create policy bloom_engineering_files_select on public.bloom_engineering_files
for select to authenticated
using ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

create policy bloom_engineering_files_insert on public.bloom_engineering_files
for insert to authenticated
with check ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

create policy bloom_engineering_files_delete on public.bloom_engineering_files
for delete to authenticated
using ((select auth.uid()) = user_id and bloom_private.is_member(household_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bloom-engineering-files',
  'bloom-engineering-files',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy bloom_engineering_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'bloom-engineering-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy bloom_engineering_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'bloom-engineering-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy bloom_engineering_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'bloom-engineering-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
