-- Food in Bloom household cookbook PDF.
-- Stores one household-shared cookbook record in the existing private bloom-food-files bucket.

create table if not exists public.bloom_cookbook_files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  name text not null check (char_length(btrim(name)) between 1 and 255),
  path text not null unique check (char_length(path) <= 180),
  mime_type text not null default 'application/pdf' check (mime_type='application/pdf'),
  size_bytes bigint not null check (size_bytes between 1 and 78643200),
  created_at timestamptz not null default now()
);

alter table public.bloom_cookbook_files enable row level security;

drop policy if exists bloom_cookbook_files_read on public.bloom_cookbook_files;
create policy bloom_cookbook_files_read
on public.bloom_cookbook_files for select
to authenticated
using (bloom_private.is_member(household_id));

drop policy if exists bloom_cookbook_files_insert on public.bloom_cookbook_files;
create policy bloom_cookbook_files_insert
on public.bloom_cookbook_files for insert
to authenticated
with check (bloom_private.is_member(household_id) and uploaded_by=(select auth.uid()));

drop policy if exists bloom_cookbook_files_delete on public.bloom_cookbook_files;
create policy bloom_cookbook_files_delete
on public.bloom_cookbook_files for delete
to authenticated
using (bloom_private.is_member(household_id));

grant select, insert, delete on public.bloom_cookbook_files to authenticated;

update storage.buckets
set file_size_limit=78643200
where id='bloom-food-files';
