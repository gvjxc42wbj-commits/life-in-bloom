-- Bloom Reader: full-book PDFs + private per-page text cache.
-- Full PDF stays in private bloom-reading-files storage.
-- Selected pages are extracted via PDF.js text layer first; OCR is fallback only.
-- Only verified_text from rows with verified=true should feed lesson generation.

alter table public.bloom_reading_files
  add column if not exists file_role text not null default 'scan'
  check (file_role in ('scan','book_pdf')),
  add column if not exists page_count integer
  check (page_count is null or page_count between 1 and 20000);

create table if not exists public.bloom_reading_page_text (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.bloom_reading_books(id) on delete cascade,
  file_id uuid not null references public.bloom_reading_files(id) on delete cascade,
  page_number integer not null,
  extraction_method text not null check (extraction_method in ('text_layer','ocr')),
  raw_text text not null default '',
  verified_text text not null default '',
  verified boolean not null default false,
  char_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, household_id, file_id, page_number)
);

alter table public.bloom_reading_page_text enable row level security;
revoke all on public.bloom_reading_page_text from public, anon;
grant select, insert, update, delete on public.bloom_reading_page_text to authenticated;

create policy bloom_reading_page_text_select on public.bloom_reading_page_text
for select to authenticated
using ((select auth.uid())=user_id and bloom_private.is_member(household_id));

create policy bloom_reading_page_text_insert on public.bloom_reading_page_text
for insert to authenticated
with check ((select auth.uid())=user_id and bloom_private.is_member(household_id));

create policy bloom_reading_page_text_update on public.bloom_reading_page_text
for update to authenticated
using ((select auth.uid())=user_id and bloom_private.is_member(household_id))
with check ((select auth.uid())=user_id and bloom_private.is_member(household_id));

create policy bloom_reading_page_text_delete on public.bloom_reading_page_text
for delete to authenticated
using ((select auth.uid())=user_id and bloom_private.is_member(household_id));

create index if not exists bloom_reading_page_text_lookup
on public.bloom_reading_page_text(user_id, household_id, file_id, page_number);
