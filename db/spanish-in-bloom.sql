-- Spanish in Bloom: tutor, Duolingo profile, CEFR skills, lessons, vocabulary, homework,
-- lesson-prep items, and private whiteboard/audio/PDF media.
-- Live project uses RLS on all tables and private Storage for Spanish media.

create table if not exists public.bloom_spanish_profile (...);
create table if not exists public.bloom_spanish_cefr_skills (...);
create table if not exists public.bloom_spanish_lessons (...);
create table if not exists public.bloom_spanish_vocab (...);
create table if not exists public.bloom_spanish_homework (...);
create table if not exists public.bloom_spanish_prepare (...);
create table if not exists public.bloom_spanish_media (...);

-- Private Storage bucket: bloom-spanish-media
-- Tutor profile seeded to: https://preply.com/en/tutor/6569875
-- Duolingo starting record: score 22, Section 3, Unit 7
-- CEFR skills begin Not Assessed; target C1.
