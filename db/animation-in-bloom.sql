-- Animation in Bloom: tutor, learning resources, practical skills, projects, practice journal, tutor homework, private media.
-- Live project uses RLS on all tables and private Storage for project/homework previews.

create table if not exists public.bloom_animation_tutor (...);
create table if not exists public.bloom_animation_resources (...);
create table if not exists public.bloom_animation_skills (...);
create table if not exists public.bloom_animation_projects (...);
create table if not exists public.bloom_animation_media (...);
create table if not exists public.bloom_animation_practice (...);
create table if not exists public.bloom_animation_homework (...);

-- Private Storage bucket: bloom-animation-media
-- Allowed: JPG, PNG, WebP, GIF, MP4/WebM/QuickTime video, PDF; max 100 MB.
-- RLS rule pattern: auth.uid() = user_id AND current household membership.
