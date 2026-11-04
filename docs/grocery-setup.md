# Shared Grocery: development setup

## What this version includes

The first foundation supports real Supabase email/password accounts, one two-person household per account, a shared shopping checklist, monthly food budgets, three inventory locations, private profile inputs, and explicitly shared nutrition targets/preferences. Meal planning, purchases, stock deductions from cooking, automatic nutrition estimates, and price recommendations come next. Spent, Planned, and Available remain visibly uncalculated until those source records exist.

Project: **Life in Bloom Development** · Region: **US East** · Project reference: `vlviotldtsyurnacgmxg`.

The project was created in the user-selected **WildfowerDust** organization. Supabase quoted **$0/month additional cost** for creation, separate from the organization's existing Pro subscription and any future usage charges. No paid upgrade, email service, domain, or AI API was purchased.

## 1. Preview the development branch

In GitHub Desktop, use `life-in-bloom-development`, **Fetch origin**, then **Pull origin** if offered. Keep the local Python preview running and refresh `http://127.0.0.1:8000` with Ctrl+Shift+R. Open **Grocery**.

The project uses a pinned Supabase browser SDK from jsDelivr. If that script or the internet connection is unavailable, Grocery reports a connection/setup error. No package installation is needed on the user's computer.

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

- Set the food budget for the chosen month. The software project budget is unrelated.
- Each person saves their own shared planning profile. Leave unknown targets blank. Optional measurements/private notes use a different form and database table.
- Add the food actually present, its amount/unit, and its location: Pantry, Refrigerator, or Freezer. A date on an inventory item is information entered by the household, not an automatic safety assessment.
- Add items to the shared list. Checking an item means it was picked up; it does not invent a receipt, price, or inventory amount.

## Technical verification and deployment boundaries

Database definitions are in `db/grocery-foundation.sql`; tests in `db/grocery-foundation-tests.sql` run inside a transaction and roll back synthetic users and records. The database migration is applied to the development Supabase project, not to a local CLI database. Its generated remote migration version can be inspected with Supabase's migration-list tool; no migration timestamp is invented locally.

Every exposed table has row-level policies and explicit grants. Private profiles are account-owned. Shared tables require current household membership. Membership and invitation operations use narrowly granted private implementations behind public invoker wrappers. Updating a row requires the expected revision; a stale or denied update must not report success.

Auth tokens stay with the official Supabase SDK; frontend configuration includes only a publishable key. Shared records are not stored in an offline browser cache. The service worker caches only named static assets and never account callbacks or API responses. Signing out or changing identity clears household state and invalidates late requests.

The published `main` website has not been updated by this development milestone. Before live deployment, finish email delivery and recovery, confirm HTTPS hosting and return URLs, and test both real accounts on separate devices.

### Verification completed on November 4, 2026

Hosted migration `20261104103520_life_in_bloom_grocery_foundation` was applied successfully. The rollback tests passed in the actual development database, covering household sharing, private profiles, unrelated and anonymous access, invitation reuse and expiry, membership removal, checklist import retries, immutable record identities, and stale updates. A follow-up query confirmed zero synthetic users and zero test households remained.

Supabase's advisors reported informational notices only. The private invitation table intentionally has no direct-access RLS policy and no client table grants; only the checked invitation functions use it ([policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Newly created supporting indexes have no production usage yet ([index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)). The project also retains Supabase's initial fixed Auth connection allocation; revisit allocation when sizing a production instance ([production guidance](https://supabase.com/docs/guides/deployment/going-into-prod)).

All 110 JavaScript tests passed, including the existing Sleep & Mood, appointments, Ideas, and backup checks. The Grocery tests use a mocked Supabase client to check account changes, late responses, saved revisions, pagination, payload boundaries, form validation, and retry-safe new items. Syntax and static asset checks also passed. These checks do not replace a real first login. The new Grocery interface has not yet been visually checked in the user's browser or on an iPhone. No real accounts were created and no account emails were sent during these tests.

## Official references

- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase email delivery restrictions and SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase administrator user creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase dashboard create-user form](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/Users/CreateUserModal.tsx)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Pinned SDK release v2.118.0](https://github.com/supabase/supabase-js/releases/tag/v2.118.0)
