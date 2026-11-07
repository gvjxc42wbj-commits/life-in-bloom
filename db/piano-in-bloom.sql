-- Piano in Bloom: app progress, practice sessions, abilities, repertoire, private audio/video.
-- All rows are private to the signed-in user within the current household.

create table if not exists public.bloom_piano_app_progress (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  app_name text not null,
  course_name text not null,
  lesson_name text not null default '',
  progress_percent numeric(5,2),
  accuracy_percent numeric(5,2),
  status text not null default 'started',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_piano_practice_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_on date not null,
  duration_minutes integer not null,
  source text not null default 'independent',
  course_name text not null default '',
  lesson_name text not null default '',
  piece_name text not null default '',
  accuracy_percent numeric(5,2),
  midi_note_count integer,
  midi_unique_notes integer,
  midi_low_note integer,
  midi_high_note integer,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.bloom_piano_abilities (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ability_key text not null,
  state text not null default 'not_assessed',
  evidence text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_piano_repertoire (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'piece',
  status text not null default 'learning',
  source text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.bloom_piano_media (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.bloom_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_on date not null,
  media_type text not null,
  title text not null,
  piece_name text not null default '',
  notes text not null default '',
  path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

-- Live project also enables RLS on all five tables and limits CRUD to
-- auth.uid() = user_id + current household membership.
-- Private Storage bucket: bloom-piano-media, max 100 MB, audio/video only.
