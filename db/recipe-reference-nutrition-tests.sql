-- Hosted verification after recipe-reference-nutrition.sql.
-- Synthetic users and records only; every fixture is rolled back.
begin;
select set_config('bloom_recipe_test.owner',gen_random_uuid()::text,true);
select set_config('bloom_recipe_test.outsider',gen_random_uuid()::text,true);
select set_config('bloom_recipe_test.legacy_recipe',gen_random_uuid()::text,true);
select set_config('bloom_recipe_test.reference_recipe',gen_random_uuid()::text,true);
select set_config('bloom_recipe_test.meal',gen_random_uuid()::text,true);
select set_config('bloom_recipe_test.restored_legacy',gen_random_uuid()::text,true);
select set_config('bloom_recipe_test.restored_reference',gen_random_uuid()::text,true);

insert into auth.users(id,aud,role,email,created_at,updated_at)
select current_setting('bloom_recipe_test.'||name)::uuid,'authenticated','authenticated',
  'recipe-test-'||current_setting('bloom_recipe_test.'||name)||'@example.invalid',now(),now()
from (values ('owner'),('outsider')) as fixture(name);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('bloom_recipe_test.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_recipe_test.owner'),'role','authenticated')::text,true);
select set_config('bloom_recipe_test.household',public.bloom_create_household('Recipe rollback household')::text,true);

-- Old clients and backups can omit all new fields. Written ingredients are
-- separate from optional catalog links, so no made-up product is necessary.
insert into public.bloom_recipes(id,household_id,name,servings,ingredients)
values(current_setting('bloom_recipe_test.legacy_recipe')::uuid,current_setting('bloom_recipe_test.household')::uuid,
  'Legacy recipe fixture',2,'[]');
insert into public.bloom_recipes(id,household_id,name,servings,ingredients,ingredient_text,nutrition_mode,nutrition_reference,nutrition_source)
values(current_setting('bloom_recipe_test.reference_recipe')::uuid,current_setting('bloom_recipe_test.household')::uuid,
  'Reference recipe fixture',4,'[]',E'2–3 cloves garlic\nSalt to taste','reference',
  '{"protein_g":48,"calories_kcal":null,"sodium_mg":0}','Original whole-recipe estimate');

do $$ declare recipe public.bloom_recipes%rowtype; bad jsonb; begin
  select * into strict recipe from public.bloom_recipes where id=current_setting('bloom_recipe_test.legacy_recipe')::uuid;
  if recipe.nutrition_mode<>'ingredients' or recipe.nutrition_reference<>'{}'::jsonb
    or recipe.nutrition_source<>'' or recipe.ingredient_text<>'' then
    raise exception 'FAIL: old recipe defaults changed';
  end if;
  select * into strict recipe from public.bloom_recipes where id=current_setting('bloom_recipe_test.reference_recipe')::uuid;
  if jsonb_array_length(recipe.ingredients)<>0 or recipe.ingredient_text<>E'2–3 cloves garlic\nSalt to taste'
    or recipe.nutrition_reference->'calories_kcal' is distinct from 'null'::jsonb
    or recipe.nutrition_reference->'sodium_mg' is distinct from '0'::jsonb then
    raise exception 'FAIL: text ingredients or unknown/zero reference values changed';
  end if;
  for bad in select value from jsonb_array_elements('[{"protein_g":-1},{"protein_g":"12"},{"unsupported_nutrient":3},[],null,{"protein_g":1000000001}]'::jsonb) loop
    begin
      update public.bloom_recipes set nutrition_reference=bad where id=recipe.id;
      raise exception 'FAIL: invalid recipe reference accepted: %',bad;
    exception when check_violation then null; end;
  end loop;
  begin
    update public.bloom_recipes set nutrition_mode='unsupported' where id=recipe.id;
    raise exception 'FAIL: invalid nutrition mode accepted';
  exception when check_violation then null; end;
  begin
    update public.bloom_recipes set nutrition_source=E' \t\n' where id=recipe.id;
    raise exception 'FAIL: blank reference source accepted';
  exception when check_violation then null; end;
  begin
    update public.bloom_recipes set nutrition_source=repeat('x',2001) where id=recipe.id;
    raise exception 'FAIL: oversized reference source accepted';
  exception when check_violation then null; end;
  begin
    update public.bloom_recipes set ingredient_text=repeat('x',12001) where id=recipe.id;
    raise exception 'FAIL: oversized ingredient text accepted';
  exception when check_violation then null; end;
  begin
    update public.bloom_recipes set nutrition_reference=null where id=recipe.id;
    raise exception 'FAIL: SQL null reference accepted';
  exception when not_null_violation then null; end;
end $$;

-- Meal values and estimate provenance are snapshots, unaffected by later edits.
insert into public.bloom_meal_entries(id,household_id,occurred_on,person_slot,kind,recipe_id,servings,label,nutrition_snapshot)
values(current_setting('bloom_recipe_test.meal')::uuid,current_setting('bloom_recipe_test.household')::uuid,
  '2026-11-04',1,'eaten',current_setting('bloom_recipe_test.reference_recipe')::uuid,1,'Reference recipe fixture',
  '{"values":{"protein_g":12,"calories_kcal":null,"sodium_mg":0},"missing":{"protein_g":0,"calories_kcal":1,"sodium_mg":0},"complete":false,"estimated":true,"basis":"recipe_reference","source":"Original whole-recipe estimate"}');
update public.bloom_recipes set nutrition_reference='{"protein_g":80}',nutrition_source='Edited whole-recipe estimate'
where id=current_setting('bloom_recipe_test.reference_recipe')::uuid;
do $$ declare saved jsonb; begin
  select nutrition_snapshot into strict saved from public.bloom_meal_entries where id=current_setting('bloom_recipe_test.meal')::uuid;
  if saved->'values'->'protein_g' is distinct from '12'::jsonb
    or saved->'values'->'calories_kcal' is distinct from 'null'::jsonb
    or saved->>'source'<>'Original whole-recipe estimate'
    or saved->>'basis'<>'recipe_reference' or saved->'estimated' is distinct from 'true'::jsonb then
    raise exception 'FAIL: recipe edit rewrote meal history or estimate provenance';
  end if;
  if (select revision from public.bloom_recipes where id=current_setting('bloom_recipe_test.reference_recipe')::uuid)<>2 then
    raise exception 'FAIL: recipe revision guard changed';
  end if;
  if exists(select 1 from public.bloom_money_entries) or exists(select 1 from public.bloom_inventory) then
    raise exception 'FAIL: saving recipes or logging portions created spending or stock';
  end if;
end $$;

-- The existing additive backup path accepts both older and new recipe shapes.
select public.bloom_restore_household_backup(jsonb_build_object(
  'app','Life in Bloom Household','version',1,'household_id',current_setting('bloom_recipe_test.household'),'exported_at',now(),
  'data',jsonb_build_object('recipes',jsonb_build_array(
    jsonb_build_object('id',current_setting('bloom_recipe_test.restored_legacy'),'household_id',current_setting('bloom_recipe_test.household'),
      'name','Restored legacy recipe fixture','servings',2,'ingredients','[]'::jsonb),
    jsonb_build_object('id',current_setting('bloom_recipe_test.restored_reference'),'household_id',current_setting('bloom_recipe_test.household'),
      'name','Restored reference recipe fixture','servings',4,'ingredients','[]'::jsonb,'ingredient_text','Garlic to taste',
      'nutrition_mode','reference','nutrition_reference','{"protein_g":48,"calories_kcal":null}'::jsonb,'nutrition_source','Restored recipe estimate')
  ))));
do $$ begin
  if not exists(select 1 from public.bloom_recipes where id=current_setting('bloom_recipe_test.restored_legacy')::uuid
    and nutrition_mode='ingredients' and nutrition_reference='{}'::jsonb and ingredient_text='') then
    raise exception 'FAIL: older recipe backup did not receive defaults';
  end if;
  if not exists(select 1 from public.bloom_recipes where id=current_setting('bloom_recipe_test.restored_reference')::uuid
    and nutrition_mode='reference' and nutrition_reference='{"protein_g":48,"calories_kcal":null}'::jsonb
    and nutrition_source='Restored recipe estimate' and ingredient_text='Garlic to taste') then
    raise exception 'FAIL: new recipe backup lost reference details';
  end if;
end $$;

-- Adding columns must not expose recipes to another household or anonymous use.
select set_config('request.jwt.claim.sub',current_setting('bloom_recipe_test.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom_recipe_test.outsider'),'role','authenticated')::text,true);
select public.bloom_create_household('Other recipe rollback household');
do $$ declare affected bigint; begin
  if exists(select 1 from public.bloom_recipes where household_id=current_setting('bloom_recipe_test.household')::uuid) then
    raise exception 'FAIL: another household can read recipe references';
  end if;
  update public.bloom_recipes set nutrition_source='Foreign edit' where id=current_setting('bloom_recipe_test.reference_recipe')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'FAIL: another household can edit recipe references'; end if;
  begin
    insert into public.bloom_recipes(household_id,name,servings,nutrition_mode,nutrition_reference,nutrition_source)
    values(current_setting('bloom_recipe_test.household')::uuid,'Forbidden reference recipe',1,'reference','{"protein_g":1}','Foreign source');
    raise exception 'FAIL: another household can insert a recipe';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin
    perform 1 from public.bloom_recipes limit 1;
    raise exception 'FAIL: anonymous recipe read was allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: recipe reference bounds, text ingredients, unknown values, snapshot provenance, legacy/new backup restore, revisions and household isolation; synthetic changes rolled back.' as result;
