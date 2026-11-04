-- Life in Bloom: optional reference nutrition for the whole saved recipe.
-- Apply as a reviewed hosted migration after food-expansion.sql and its fix.
-- Existing recipes retain ingredient-label calculation. No household data.

alter table public.bloom_recipes
  add column ingredient_text text not null default '',
  add column nutrition_mode text not null default 'ingredients',
  add column nutrition_reference jsonb not null default '{}'::jsonb,
  add column nutrition_source text not null default '',
  add constraint bloom_recipes_ingredient_text_length_check
    check (char_length(ingredient_text) <= 12000),
  add constraint bloom_recipes_nutrition_mode_check
    check (nutrition_mode in ('ingredients','reference')),
  add constraint bloom_recipes_nutrition_reference_check
    check (bloom_private.food_valid_nutrients(nutrition_reference)),
  add constraint bloom_recipes_nutrition_source_length_check
    check (char_length(nutrition_source) <= 2000),
  add constraint bloom_recipes_reference_source_check
    check (nutrition_mode <> 'reference' or nutrition_source ~ '[^[:space:]]');

comment on column public.bloom_recipes.ingredient_text is
  'Human-readable ingredient list, including ranges and optional ingredients. Does not create catalog products or inventory links.';
comment on column public.bloom_recipes.nutrition_mode is
  'Use either ingredient-label calculation or the supplied recipe reference. Never add both together.';
comment on column public.bloom_recipes.nutrition_reference is
  'Approximate nutrient values for the WHOLE recipe, using the product nutrient keys and units. Missing or null values remain unknown. Divide by recipe servings when logging a portion.';
comment on column public.bloom_recipes.nutrition_source is
  'Source and assumptions for reference nutrition; required in reference mode. Preserve this provenance in meal snapshots.';

-- Existing table grants, household RLS, ingredient validation, revision guards,
-- and snapshot history remain in force. The additive restore helper discovers
-- table columns; older backups omit these fields and receive these defaults.
