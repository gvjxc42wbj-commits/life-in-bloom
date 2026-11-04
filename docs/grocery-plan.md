# Smart Monthly Grocery Plan — Life in Bloom

Status: specification for the complete future Grocery system, with a working development implementation of accounts, two-person households, profiles, monthly Food/Household budgets, catalog prices, recurring shopping quantities, atomic receipts and ledger entries, dated inventory, recipes, and planned/eaten portion nutrition. Hosted migrations and rollback access/transaction tests passed on November 4, 2026. The full optimization, stock reservations, cooking/leftovers, live retailer prices, and automated meal-plan generation described below remain future work. See the [Food and Grocery guide](food-and-grocery-guide.md) for exactly what the current screens do, and [Grocery setup](grocery-setup.md) for account configuration.

## Purpose

Help a two-person household plan meals and groceries using each person's nutrition targets, a shared monthly food budget, existing food, allergies, restrictions, preferences, and dated price estimates. Every suggestion remains reviewable and editable.

The household food budget is its own input. It is unrelated to the budget for developing or hosting Life in Bloom. No personal measurements, allergy records, login details, receipts, or actual household budget amounts belong in this public repository.

## Navigation and screens

The expanded Grocery section will have a monthly overview and a prominent Smart Grocery List shortcut. Preserve access to the existing quick checklist and migrate its saved items deliberately; do not silently discard or convert unstructured quantities into invented measurements.

| Screen | Working behavior |
|---|---|
| Monthly overview | Selected month, editable food budget, actual spending, outstanding planned purchase cost, available after plan, and links to both profiles and every Grocery screen. Start with the device's current calendar month; allow earlier and later months. |
| Household Profiles | Two individual logins attached to one household, independent nutrition inputs and targets, allergies, restrictions, preferences, and optional brand/store choices. |
| Monthly Grocery Budget | Save a distinct budget for each month. Food is separate from household supplies and dog items, including on mixed receipts. Record actual purchases, not a guessed spending amount. |
| Meal Planner | Dated meals using saved recipes, with portions allocated separately to each household member. Allow meals for one person, shared meals, different portions, and planned leftovers. A monthly overview can open a manageable weekly editing view. |
| Smart Grocery List | Sum ingredient needs across the selected period, allocate existing usable inventory once, calculate shortages, choose compatible packages, and show estimated purchase cost and per-person planned nutrition. Keep manual extras identifiable. |
| Grocery Purchases | Record date, items, quantities, actual prices, store, and payer. Confirmed purchases update spending and inventory together. Support partial fulfillment and deliberate corrections. |
| Pantry Inventory | One stock system with Pantry, Refrigerator, and Freezer locations. Track remaining quantity, units, product/ingredient identity, purchase batches, and user-entered date information. Moving food changes its location without creating a purchase. |
| History & Analytics | Keep budgets, actual purchases, saved meal-plan versions, price estimates, target versions, and nutrition summaries by month. Inventory carries forward across months. |

## Monthly money meanings

- **Budget:** the household's chosen food spending limit for that month.
- **Spent:** actual food purchase amounts assigned to that calendar month, including explicit corrections/refunds when supported.
- **Planned:** the estimated cost of outstanding food purchases assigned to that month. Fulfilled quantities no longer count as outstanding.
- **Available after plan:** budget minus spent minus planned. Show a negative result as an over-budget amount; do not hide it by clamping to zero.
- **Remaining before plan:** budget minus spent, available in the spending details.

An unset budget stays unset. An unknown price is **Price needed**, not zero. If prices are missing, display the known subtotal with an **Estimate incomplete** label. Display the estimate's source, package size, store if known, and date. Historical receipt prices are not live store prices.

Example only: with a $600 budget, $100 spent, and $150 of outstanding planned purchases, available after plan is $350. This is not a suggested or prefilled household budget.

## Four separate events

| Event | Budget effect | Inventory effect | Nutrition effect |
|---|---|---|---|
| Plan a meal | May create an outstanding purchase estimate | Reserve required amounts; do not consume them | Add estimated nutrition to that person's planned portions |
| Confirm a purchase | Record actual spending and fulfill linked planned amounts | Add the actual purchased quantities to appropriate stock batches | Do not record food as eaten |
| Confirm cooking | Do not spend money again for existing ingredients | Deduct quantities actually used; record leftover prepared portions when appropriate | Do not assume the entire recipe was eaten |
| Log a portion eaten | No new purchase | Reduce the appropriate prepared portion or stock item when linked, without deducting ingredients a second time | Record that person's actual intake |

Every operation that affects more than one record must be atomic and idempotent: a retry, double click, or reconnection cannot duplicate a purchase or deduct food twice. Corrections must have an undo/reversal path and preserve an audit trail.

## Smart-list calculation

1. Select a planning period inside the monthly overview. Include the relevant daily goals and portions for both people.
2. Load the proposed meals and their recipe/ingredient versions.
3. Reject known allergy and restriction conflicts before ranking by cost or preference. Unknown ingredient/allergen information requires review.
4. Total ingredient requirements across the planning period and any other active reservations that use the same stock.
5. Allocate usable available stock once, considering location, batch, quantities, date information, and existing reservations. Do not silently assume a food is safe to use from a date alone.
6. Calculate shortages in compatible units. Convert mass to mass and volume to volume; use food-specific measured conversions for mass versus volume. Preserve raw/cooked/drained distinctions.
7. Round shortages to selected purchasable packages. Show the quantity needed, stock used, packs to buy, and projected remainder.
8. Apply known, dated package prices and calculate outstanding planned cost. Missing prices keep totals incomplete.
9. Compare planned portions against each person's saved daily nutrition targets. Missing nutrient values remain unknown and identify incomplete totals.
10. Explain editable suggestions, such as filling a planned fiber gap, using existing food, or reviewing a lower-cost compatible product. Never silently reduce a person's portions or relax an allergy constraint to meet a budget.
11. Save the accepted plan and its assumptions so the household can compare later revisions and actual purchases.

Quantity example: two meals need six eggs total; four unreserved eggs are available. The shortage is two eggs. If the selected product is a six-pack, buy one pack and show a projected remainder of four eggs after the meals. The existing four eggs must not be allocated independently to both meals.

## Individual nutrition profiles

Keep a separate profile and effective-dated target set for each member. A shared recipe can provide different portions or additions to the two people; household totals must not simply be divided in half.

Profiles support:

- Display name and optional visual color.
- Manual daily goals, including clinician-provided targets, with source notes.
- An optional reference-estimate mode using the inputs required by the chosen documented method, such as age, height, weight, equation-relevant sex, activity level, and relevant life-stage information.
- Calories, protein, carbohydrates, fats, fiber, and supported vitamin/mineral goals, with explicit units and target type (goal, range, or upper limit).
- Custom allergies, other restrictions, dislikes, preferred foods, brands, and stores as distinct fields.

Reference estimates must name their source and method version and remain editable. They are estimates, not medical prescriptions. Do not add an automatic weight-loss deficit or override a manually chosen target. Missing required inputs leave estimates uncalculated.

Planned nutrition is assessed by person and day, with monthly summaries. A monthly total must not conceal uneven daily coverage or unequal portions. Actual consumed nutrition requires a separate food or portion log.

## Product and recipe information

A product record needs product/brand identity, package quantity and unit, the ingredient it supplies, dated price estimates, and nutrient data with its measurement basis. Nutrient data can come from confirmed labels or an appropriately matched USDA FoodData Central record. Preserve source ID, date/version, serving basis, and conversion information.

A recipe records required ingredient quantities and units, the number of servings, preparation state, and relevant substitutions. Saved plan versions retain the recipe and nutrient values they used. Editing today's recipe or product price must not silently rewrite earlier months.

Known allergen conflicts are excluded. Unknown data is labeled for review. The app must not claim a product is allergy-safe solely because a name or ingredient search did not find an allergen. Custom allergens are supported alongside common regulated allergens. Substitutions require a fresh ingredient/label review.

## Accounts and shared data

Use real authentication, one account per person, and one household membership connecting them. A person selector alone does not fulfill the login requirement.

Proposed access boundaries:

| Information | Default access |
|---|---|
| Account credentials and session | Managed through the authentication service; never stored as plaintext app records |
| Personal measurements and calculation inputs | Profile owner only |
| Planning targets and dietary constraints chosen for household use | Household planner can use the necessary shared fields |
| Food budgets, products, stock, meals, lists, and purchases | Both authorized household members |
| Existing Sleep & Mood and Ideas records | Remain personal; connecting Grocery does not automatically share or upload them |

Database access rules must enforce these boundaries. Household membership cannot be gained merely by changing a client-supplied household ID. Test allowed and denied reads and writes with two household users, an unrelated user, and an unauthenticated request.

The current app stores data locally. Migration must be explicit about which Grocery records are uploaded and include a backup path. Do not upload private logs simply because the whole old backup file contains them. Until shared storage is configured and validated, clearly distinguish local entries from synced household entries.

Supabase is connected. With the user’s choice of the existing WildfowerDust organization, Life in Bloom Development was created in US East on November 4, 2026. Supabase quoted $0/month additional cost for project creation in that organization; this is separate from any existing Pro subscription and future usage charges. App users, email delivery, and redirect configuration still require setup. Personal user measurements, health information, and grocery records are never seeded into public repository files.

USDA API requests require a private API key. Keep it in a backend secret or use a vetted downloaded dataset for an initial catalog. Do not put a private key in browser JavaScript or this repository.

## Build sequence and acceptance gates

### 1. Shared household foundation

- Configure an authorized Supabase project and suitable application hosting for sign-in.
- Add account creation/sign-in, recovery, sign-out, and two-person household membership.
- Add individual profile forms with explicit sharing boundaries.
- Add monthly budgets, a confirmed product catalog, stock quantities, and the three inventory locations.
- Preserve and deliberately migrate existing Grocery checklist entries.
- Verify both users can access the shared household and cannot access another household or the other person's private profile inputs.

### 2. Complete one practical grocery workflow

- Save a recipe and plan dated portions for both people.
- Allocate stock and calculate package shortages.
- Show dated price estimates and remaining budget.
- Record a confirmed purchase once, updating stock and spending together.
- Handle a partial purchase, a changed quantity, and a retry without duplicates.

### 3. Nutrition planning and history

- Connect confirmed food matches and versioned nutrition targets.
- Add per-person planned nutrition, explicit missing-data indicators, and explainable alternatives.
- Keep actual eaten portions separate.
- Preserve earlier plan versions, prices, targets, and actual purchases when starting a new month.

### Later additions

Receipt-photo extraction, automatic retailer price feeds, richer substitutions, and AI-assisted meal suggestions can use the established records. They are not required to make the initial stock/quantity/budget calculations useful.

## Reference sources

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase row-level security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase pricing and free-plan limits: https://supabase.com/pricing
- USDA DRI calculator: https://www.nal.usda.gov/human-nutrition-and-food-safety/dri-calculator
- USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide/
- USDA branded-food documentation: https://fdc.nal.usda.gov/GBFPD_Documentation/
- FDA food allergy guidance: https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies

These are implementation references. Verify current documentation, terms, and applicable limits when configuring each service.
