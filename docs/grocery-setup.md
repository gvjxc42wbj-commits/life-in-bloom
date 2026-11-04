# Shared Grocery: development setup

## What this version includes

The development app supports Supabase email/password accounts, one two-person household per account, monthly shopping lists and Food/Household budgets, a growing product catalog, private food files, recurring quantity review, atomic receipts, dated inventory, saved recipes, separate planned/eaten nutrition, and a Money ledger with monthly bills. See [Food and Grocery guide](food-and-grocery-guide.md) for the user workflow and current limits. Stock deductions from cooking, background push, OCR, live retailer prices, and validated meal-plan generation are not included.

Project: **Life in Bloom Development** · Region: **US East** · Project reference: `vlviotldtsyurnacgmxg`.

The project was created in the user-selected **WildfowerDust** organization. Supabase quoted **$0/month additional cost** for creation, separate from the organization's existing Pro subscription and any future usage charges. No paid upgrade, email service, domain, or AI API was purchased.

## 1. Preview the development branch

In GitHub Desktop, use `life-in-bloom-development`, **Fetch origin**, then **Pull origin** if offered. Keep the local Python preview running and refresh `http://127.0.0.1:8000` with Ctrl+Shift+R. Open **Grocery**.

The project uses a pinned Supabase browser SDK from jsDelivr. No package installation is needed on the user's computer. After a successful online load, the app caches its static files and a labeled saved household copy for offline viewing. First-time sign-in and shared writes require internet.

## 2. Configure account email links

Open [Authentication → URL Configuration](https://supabase.com/dashboard/project/vlviotldtsyurnacgmxg/auth/url-configuration).

For this local development preview, set the Site URL to `http://127.0.0.1:8000/` and add that exact address to the allowed Redirect URLs. If also using `http://localhost:8000/`, add that address separately. Save the changes. Before moving to an online app, update these settings to the chosen HTTPS host and test confirmation and password-reset links again.

The app passes its actual origin and pathname as its email return address. Supabase must allow that address; the default Site URL is not this Python preview address.

## 3. Create the two app accounts

These are **Life in Bloom app accounts**, separate from the developer's Supabase dashboard account. Each person chooses their own email and password directly in the app or Supabase's account-creation screen. Never put passwords, email confirmation links, service-role keys, or secret keys in chat, repository files, or screenshots.

For normal self-service account creation and password recovery, configure [Custom SMTP](https://supabase.com/dashboard/project/vlviotldtsyurnacgmxg/auth/smtp). Supabase's default email sender only delivers to addresses belonging to the Supabase organization team; it is not a general two-user email service. Do not give the second app user project administration access just to receive emails. Do not disable email confirmation to hide a delivery error.

For initial developer testing, the owner can create their own app account through [Authentication → Users](https://supabase.com/dashboard/project/vlviotldtsyurnacgmxg/auth/users): choose **Add user → Create new user**, enter their email and password privately there, leave **Auto confirm user?** checked, and choose **Create user**. This supported dashboard action does not send a confirmation email. The resulting confirmed account can sign in with its email/password. This does not establish working email recovery; that must still be configured and tested before relying on the app long term. No real app users were created by the setup scripts.

## 4. Connect the household

The first person signs in and chooses **Create household**. From the **Household** tab, they generate a sharing code and give it directly to the second person. The second person signs in to their own app account and uses **Join household**. Generating a code does not send an email or any other message.

Codes expire after 48 hours and are single-use. A household has at most two members. Each person belongs to at most one household in this foundation. Creating or joining a household does not upload an earlier local journal or checklist.

## 5. Open earlier personal entries and copy the checklist if wanted

When sign-in finds an earlier device journal, choose **These are my earlier entries** only for the person who owns it. The app copies it to that account's local storage while retaining the earlier original. **Start a separate journal** creates an empty personal journal for that account instead.

Inside Grocery, **Review device list** shows exactly which checklist items would be shared and which household would receive them. **Copy this list to our household** copies only the reviewed checklist fields. Retries use stable identifiers to avoid duplicates. Sleep, moods, activities, appointments, and Ideas never enter this cloud payload.

Personal journal separation is local browser behavior, not encryption. Signing out hides that account's journal from normal app screens. Export personal backups regularly. A personal backup import never replaces shared Grocery data.

## 6. Enter the actual planning inputs

- Set Food and Household allocations for the chosen month. The software project budget is unrelated.
- Each person saves their own shared planning profile. Leave unknown targets blank. Optional measurements/private notes use a different form and database table.
- Add the food actually present, its amount/unit, and its location: Pantry, Refrigerator, or Freezer. Enter its printed date/type, opened/frozen dates and reminder settings. These dates are household information, not an automatic safety assessment.
- Add items to the shared list. Checking an item means it was picked up; it does not invent a receipt, price, or inventory amount.
- Record an actual receipt to update spending and stock together. Review catalog labels and recipe quantities before relying on their nutrient estimates. Leave missing values unknown.

## Technical verification and deployment boundaries

Database definitions are in `db/grocery-foundation.sql`; tests in `db/grocery-foundation-tests.sql` run inside a transaction and roll back synthetic users and records. The database migration is applied to the development Supabase project, not to a local CLI database. Its generated remote migration version can be inspected with Supabase's migration-list tool; no migration timestamp is invented locally.

Every exposed table has row-level policies and explicit grants. Private profiles are account-owned. Shared tables require current household membership. Membership and invitation operations use narrowly granted private implementations behind public invoker wrappers. Updating a row requires the expected revision; a stale or denied update must not report success.

Auth tokens stay with the official Supabase SDK in persistent browser storage; frontend configuration includes only a publishable key. The app keeps a separate household cache without auth tokens or private measurements. An offline cached identity must match the stored SDK session. Sign-out, account changes, and cross-tab storage invalidation clear the visible household copy and invalidate late requests. Form drafts are account/household-scoped and exclude credentials. Device copies are not encrypted.

The service worker caches named static assets and the exact pinned SDK URL. It never caches account callbacks, API responses, or uploaded private files. Offline drafts require an explicit online Save/Record action; transactions are not queued automatically.

The published `main` website has not been updated by this development milestone. Before live deployment, finish email delivery and recovery, confirm HTTPS hosting and return URLs, and test both real accounts on separate devices.

### Foundation verification completed on November 4, 2026

Hosted migration `20261104103520_life_in_bloom_grocery_foundation` was applied successfully. The rollback tests passed in the actual development database, covering household sharing, private profiles, unrelated and anonymous access, invitation reuse and expiry, membership removal, checklist import retries, immutable record identities, and stale updates. A follow-up query confirmed zero synthetic users and zero test households remained.

Supabase's advisors reported informational notices only. The private invitation table intentionally has no direct-access RLS policy and no client table grants; only the checked invitation functions use it ([policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Newly created supporting indexes have no production usage yet ([index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)). The project also retains Supabase's initial fixed Auth connection allocation; revisit allocation when sizing a production instance ([production guidance](https://supabase.com/docs/guides/deployment/going-into-prod)).

The foundation's 110 JavaScript tests passed. They used a mocked Supabase client for identity, revision, pagination, and retry checks. The owner subsequently signed in and saved real household records. No account emails were sent by the automated tests.

### Food and Money expansion verification

Hosted migrations `20261104113847_life_in_bloom_connected_food_money` and `20261104114237_fix_food_receipt_effect_accumulators` were applied. The primary `db/food-expansion.sql` source includes the corrected function; `db/food-expansion-fix.sql` records the separate corrective deployment.

The expansion's actual database rollback checks passed for mixed-category receipts, duplicate retries, stale/partial shopping fulfillment, inventory effects and reversals, independent nutrition history, bill-payment duplication, owner/member/outsider/anonymous boundaries, private file paths, and additive backup restore. A follow-up check found no test users or test households. Actual household list and inventory counts were preserved, and catalog setup created no receipts or ledger spending.

All **175 JavaScript tests** passed, including the new Food/Commerce flows, account-scoped drafts, persistent-session migration, offline identity and cross-tab sign-out checks, receipt shopping revisions, and connected route tests. JavaScript syntax and referenced local assets were also checked. These include DOM/event stubs and mocked SDK calls, not a real iPhone visual test. Real device layout, file upload/download, sign-in persistence, and calendar import need a user preview before production deployment.

The current security advisory reports **leaked-password protection disabled**. Enable it in Supabase Auth password-security settings before opening general account registration ([official guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). No callable Auth-configuration tool was available to change that setting. The private invite table's intentional lack of direct-access policies and unused-index notices remain informational. Neither database permissions nor confirmation requirements were weakened.

## Official references

- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase email delivery restrictions and SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase administrator user creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase dashboard create-user form](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/Users/CreateUserModal.tsx)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Pinned SDK release v2.118.0](https://github.com/supabase/supabase-js/releases/tag/v2.118.0)
