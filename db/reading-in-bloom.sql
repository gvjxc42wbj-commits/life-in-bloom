-- Life in Bloom: private Reading in Bloom subsystem.
-- Books, sessions, notes, vocabulary, quiz attempts, and page-scan metadata are private to the signed-in user.
-- Page images/PDFs are stored in a private Supabase Storage bucket.

create table if not exists public.bloom_reading_books (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text not null default '',
  isbn text not null default '',
  edition text not null default '',
  total_pages integer,
  current_page integer,
  current_section text not null default '',
  status text not null default 'not_started',
  started_on date,
  completed_on date,
  cover_url text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, household_id, title, author)
);

create table if not exists public.bloom_reading_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.bloom_reading_books(id) on delete cascade,
  occurred_on date not null,
  minutes integer not null default 0,
  start_page integer,
  end_page integer,
  section text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_reading_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.bloom_reading_books(id) on delete cascade,
  page_number integer,
  section text not null default '',
  note_type text not null default 'note',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_reading_vocabulary (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.bloom_reading_books(id) on delete cascade,
  word text not null,
  part_of_speech text not null default '',
  definition text not null default '',
  example_sentence text not null default '',
  source_label text not null default 'coach_suggested',
  page_number integer,
  section text not null default '',
  spelling_enabled boolean not null default false,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  last_practised_on date,
  created_at timestamptz not null default now(),
  unique(user_id, household_id, book_id, word)
);

create table if not exists public.bloom_reading_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.bloom_reading_books(id) on delete cascade,
  scope_label text not null default '',
  score integer,
  total_questions integer not null default 0,
  correct_questions integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_reading_files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.bloom_reading_books(id) on delete cascade,
  name text not null,
  path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  page_from integer,
  page_to integer,
  section text not null default '',
  created_at timestamptz not null default now()
);

-- In the live project, all six tables have RLS enabled with SELECT/INSERT/UPDATE/DELETE
-- restricted to auth.uid() = user_id and current household membership.
-- Storage bucket: bloom-reading-files (private), max 10 MB, JPG/PNG/WebP/PDF.
-- Storage policies restrict object paths to the authenticated user's UUID folder.
