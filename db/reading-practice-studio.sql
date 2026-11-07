-- Reading Practice Studio: tutor assignments + read-aloud journal.
-- Private to the signed-in user within the current household.

create table if not exists public.bloom_reading_assignments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.bloom_reading_books(id) on delete cascade,
  title text not null,
  prompt text not null default '',
  body text not null default '',
  tutor_questions text not null default '',
  due_on date,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bloom_reading_files
  add column if not exists assignment_id uuid references public.bloom_reading_assignments(id) on delete set null;

create table if not exists public.bloom_reading_audio_recordings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.bloom_reading_books(id) on delete cascade,
  recorded_on date not null,
  section text not null default '',
  page_from integer,
  page_to integer,
  duration_seconds numeric(10,2) not null,
  source_word_count integer,
  words_per_minute numeric(10,2),
  clarity_rating integer,
  confidence_rating integer,
  notes text not null default '',
  name text not null,
  path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

-- Live project also has RLS policies on both tables:
-- auth.uid() = user_id AND current household membership.
-- bloom-reading-audio is a private Storage bucket with 100 MB max audio objects.
