# Food, Grocery, and Money in Bloom

## Open the update

In GitHub Desktop, choose **life-in-bloom-development**, then **Fetch origin → Pull origin**. Keep the local preview running and refresh `http://127.0.0.1:8000` with **Ctrl+Shift+R**. The first visit after this update may need a normal sign-in. Later visits in the same browser/app retain the Supabase session while it remains valid.

The Windows preview address works on that computer. A permanent HTTPS host and domain are separate from this local preview. An existing GoDaddy domain can point to the chosen host without moving the domain registration. The precise DNS records and Supabase email return URLs must match that host before public use.

## Where things live

| Destination | What to do there |
|---|---|
| Grocery → Shopping list | Keep this month's quantities and estimated package costs; start a shopping-trip receipt. |
| Grocery → Catalog | Add or edit products, package sizes, reference prices, label nutrients, and photos/PDFs. |
| Grocery → Recurring | Review monthly quantities, available compatible stock, whole packages, and estimated cost before adding the plan. |
| Grocery → Receipts | Review every purchased line, actual paid amounts, and food to add to inventory. |
| Grocery → Food at home | Enter Pantry/Refrigerator/Freezer stock, printed dates, opened/frozen dates, and reminder settings. |
| Food in Bloom → Saved recipes | Save ingredients, measured amounts, instructions, yield, and attachments. |
| Food in Bloom → Use soon | Review food dates and saved recipes that use matching ingredients. |
| Wellness / Food → Nutrition | Log planned or eaten portions separately for Person 1 and Person 2. |
| Money | View actual ledger entries, Food/Household allocations, monthly bills, and bill payments. |
| Grocery → Household | Manage household access; export a household backup or review a restore. |

The Food screen has a prominent Grocery shortcut. Grocery's food-date shortcut opens the recipe/use-soon area. The bottom Money shortcut and hamburger-menu Money destination open the same ledger.

## Product records

There is no 38-product limit. The catalog supports search, category filters, and pages of products. Categories include Produce, Meat, Seafood, Deli, Dairy & Eggs, Beverages, Bread & Bakery, Frozen, Rice/Pasta/Beans, Baking, Condiments, Canned Goods, Breakfast, Snacks, and Household supplies.

One catalog product represents one purchasable package. Specify the amount inside that package and the unit. For a multipack, use its number of individual items when that is how the product is measured. Reference prices are editable and can carry their date and source. A historical reference is never automatically entered as a purchase or inventory.

Nutrition values are per the specified label serving. Leave unknown values blank. Enter zero only if the label actually says zero. Recipe calculations can convert between compatible weight units, or compatible volume units; they do not invent a conversion from cups to grams, or from a slice to ounces. Add the relevant label/quantity information when a calculation is incomplete.

After saving a product or recipe, attach JPG, PNG, WebP, or PDF references up to 10 MB per file. Files are private to the household. Uploading a label or receipt does not automatically extract its contents. Save the verified values into the form.

## A shopping plan and an actual receipt

1. Choose the calendar month and set Food and Household allocations.
2. Add products to the list or review recurring quantities. Existing compatible stock is considered once; quantities are combined before package rounding. Unknown prices stay incomplete. Items already added by that monthly recurring source are not added again, including items already checked off.
3. Choose **Record a shopping trip** when a purchase actually happens.
4. Review each line's purchased packages, actual total paid, Food/Household category, and whether/how much food to add to stock. Include discounts, taxes, and deposits in the reviewed amounts; the app does not calculate them automatically.
5. Confirm the receipt. One database transaction records the receipt, category expenses, inventory batches, and linked shopping progress. A partial purchase leaves the remaining packages on the list. Retrying the same saved request does not duplicate it.

The ledger uses the receipt-generated expenses once. Merely adding a shopping item, setting a recurring quantity, saving a bill, or entering a meal plan does not spend money.

Receipts are preserved as historical records. The explicit reversal action reverses the expenses and stock/list effects together only if those affected records have not since been changed or used. It stops with an explanation if a correction needs review. Manual money entries have their own reversal; receipt-generated entries must be reversed through their receipt.

## Printed dates, freezing, and use-soon recipes

Inventory is stored in batches so two purchases of the same food can retain different dates. Save the printed date and its type: Best before, Use by, Sell by, Expiration, or unspecified. Save the date opened, date frozen, and your optional freezer reminder date separately. Choose how many days in advance to show a reminder.

Moving food to the freezer does not reset or invent a safety date. The reminder is based on entered information. Past-date items are flagged for review; they are not silently recommended as safe food. Date labels and visual reminders cannot determine whether food has been handled safely.

Use-soon suggestions search the household's saved recipes for matching linked catalog ingredients. They show relevant stock and shortages. An ingredient typed into a note alone cannot be matched reliably. Suggestions are not a validated allergy screen: review labels and substitutions for the person eating the meal.

**Download calendar reminder** produces an `.ics` file for the selected food. Import it into the desired calendar and check its alert settings. The current app's in-app reminders are not automatic phone push notifications while closed.

## Nutrition for each person

Person 1 is pink; Person 2 is purple. A recipe records its full yield. The log multiplies per-serving nutrients by the number of portions recorded for that person. One person can have a different portion from the other.

**Planned** and **Eaten** are separate records and totals. Choosing a recipe, buying its ingredients, or marking a plan does not claim that either person ate it. Logging an eaten portion from a plan retains the plan and creates the eaten entry. Historical nutrition snapshots preserve the source values used at the time; later edits to a product or recipe do not rewrite that history.

Missing nutrients are identified, with known subtotals shown. A partial total is not a complete nutritional assessment. Goals are manually supplied in Profiles. No intake is prescribed, and no validated monthly diet is generated.

This milestone does not automatically subtract recipe ingredients when cooking, create leftover batches, or deduct food inventory from an eaten entry. Correct quantities in Food at home as needed. Those separate cooking/consumption actions need a later implementation to avoid charging or consuming ingredients twice.

## Staying signed in and keeping drafts

Supabase manages the login session and refresh process. Closing and reopening the same browser/app should retain it, while explicit sign-out, cleared browser data, revoked/expired sessions, or a different browser/device can require signing in again. Password recovery and confirmation still depend on configured account email delivery.

Grocery, Food, and Money form text automatically saves as a local draft, scoped to the current account and household. Navigation retains it. The form's Save or Record button commits the reviewed change to the household. A selected file must still be uploaded; the browser cannot restore a pending file selection after closing.

After a successful online load, the last household copy can be viewed offline. The screen marks it as offline and dated. Offline edits remain drafts; reconnect, refresh, and save explicitly. Receipts do not silently post later in the background. Private measurements are excluded from the household offline copy. Local storage is not encrypted.

## Monthly history and backups

Shopping lists, allocations, bills, purchases, and money entries are filtered by calendar month. New months do not delete the prior ones. Recurring product settings can be used to review another month's plan; adding that plan remains an explicit action.

Export household backups from Grocery's Household tab. They contain shared food/money records and attachment metadata, not passwords, tokens, private profile measurements, personal journals, or image/PDF bytes. Keep original files separately.

The household owner can preview **Restore missing records** from a backup of the same household. It adds missing records in one transaction and preserves existing matching records. A conflict aborts the entire restore. It does not replay receipt stock or spending effects. Editable records begin a fresh technical revision while keeping business dates; historical receipt/ledger timestamps remain. Missing storage objects are reported as skipped attachments and need re-uploading.

Personal Sleep & Mood, appointments, and Ideas still use their separate personal export/import in Help. A household backup does not replace that personal backup.
