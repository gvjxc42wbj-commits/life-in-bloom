# Daily life in LIFE IN BLOOM

Home now brings together water for both people, actual Boost portions, the existing Sleep & Mood summary, personal practice reminders, smoking records, Dog care, Grocery, and the monthly money ledger. The main navigation remains Home, Wellness, Grocery, Dog, and Money. The hamburger menu opens all sections.

## Water for Person 1 and Person 2

Person 1 is pink; Person 2 is purple. Home and Wellness read the same dated water records. Choose the container size you actually use in water settings, then tap its quick-add button whenever you record that amount. The initial quick-add size is 250 mL and is editable. A daily goal is optional and starts blank; the app does not prescribe intake.

Use Other amount for a different volume or a past date. Water history identifies the person and amount, and Undo removes an entry from current totals while retaining its archived record. Future days can be viewed, but drinking cannot be recorded in advance. Calendar days for water, Skills, Smoking, and Dog use America/New_York.

Wellness uses the selected day for both water and nutrition. Water contributes to that person's actual fluid total once. Planned drinks and meals stay in the separate planned total. Water alone does not invent calories, vitamins, or minerals. The Boost shortcut opens a product-based food entry for review; it does not automatically assume a drink was consumed. Home's Boost card reflects Person 1's actual recorded servings.

## Skills in Bloom

The category cards are Piano, Sewing, Math, Language, Reading, Science, Cooking, Engineering, Writing, Painting, Animation, and Me. Cooking uses the Black woman cook emoji already established in the app.

Add a specific topic within a category, such as C major scale, reading sheet music, Spanish past tense, or sewing a straight seam. The optional observed proficiency rating is your own 1–10 judgment. Save a practice entry with its date, minutes, optional notes, and result:

- Practice only: record time without claiming successful recall or performance.
- Try again: another review is suggested the next day.
- Hard: shorten the review interval.
- Good: advance the review schedule.
- Easy: advance farther when the check felt easy.

A separate Review readiness estimate ranges from 1 to 10. It is a transparent scheduling heuristic, not a validated measurement of ability, memory health, or the probability that you will play correctly. The current formula is `R = r0 × 0.8^(days since review / interval)` and `score = clamp(1 + round(9R), 1, 10)`. The starting value r0 is 1 after Good/Easy, 0.75 after Hard, and 0.25 after Try again. The interval choices are 1, 3, 7, 14, 30, 60, 90, and 180 days. Only the last checked result on a calendar day advances that day's schedule; practice-only entries do not reset the review clock. Later successful checks can therefore support longer intervals. Changing or archiving history recalculates the estimate from the remaining observations.

No score is invented before a recall/performance check. Time away affects the review estimate while leaving observed proficiency unchanged. Sleep, mood, emotional engagement, and another skill are not automatic numerical modifiers. This version does not train a memory model or apply unsupported universal loss percentages.

Research context: DAS3H models skill-associated practice histories in educational data, not a validated piano-ability score ([original paper](https://arxiv.org/abs/1905.06873)). Effects of a practice schedule depend on the task and design; a primary study of mathematical procedures reported no robust distributed-practice benefit in its tested conditions ([study](https://pubmed.ncbi.nlm.nih.gov/32411063/)). These sources motivate careful tracking and testing; they do not validate this app's chosen constants or the percentages in the supplied reference text.

## Smoking Log

The daily page records joints, Jazz / Black & Mild cigars, grams per joint, cravings/triggers, and notes. Zero is a valid saved quantity. A day with no record remains Not logged. Sliders are accompanied by exact quantity fields.

Open the original-plan settings to enter baseline quantities and reference costs per gram and per cigar. Unknown prices remain blank. The app calculates the logged day's estimated cost, a 30-day projection at that rate, and the difference from the saved baseline. It does not copy the example $62.93 from the reference image because the underlying unit prices were not supplied.

Each saved day captures the reference settings used for its comparison. Changing today's prices or baseline does not reprice older days. Correcting quantities retains that day's original reference snapshot. Archived mistaken entries remain in history, and a replacement day can be recorded.

The actual purchase form records money paid for smoking supplies in Money in Bloom. It uses a separate actual expense, date, amount, and payer. Daily estimated consumption cost and estimated savings never create money entries. A projected saving is not cash automatically added to the ledger.

Skills and Smoking belong to the signed-in person's account, even in a two-person household. They do not appear in the other person's view or in a shared household backup.

## Dog and Housework

The Dog profile uses the supplied cartoon dachshund illustration. Enter the dog's name, breed, and optional date of birth. Age is calculated from the saved date. Weight entries have dates so earlier weights remain available.

Care templates include morning and evening meals, movement, teeth brushing, coat brushing, nails, paw hair, sanitary trim, ear care, medication, and a veterinary appointment. Review the schedule and save the routines you use. Templates are not completed tasks. Food portions, medication names, and dose instructions must come from your own care plan or label; the app does not generate them.

A routine can run every day, every chosen number of days, every chosen number of calendar months, or once. It can have up to eight times and an optional end date. Daily lists move to the new day without deleting earlier completions. Rolling intervals restart from the actual completion date after all the day's scheduled slots are completed. Fixed intervals stay anchored to their schedule. Monthly care clamps to the last available day in a shorter month, then continues from the original monthly anchor.

Choose Person 1 or Person 2 before recording who did the care. A Dog checkmark and its Housework appearance are the same saved completion, not two copies. Housework also supports ordinary household chores. History preserves the original task details and who completed each slot. A late completion records the actual chosen completion date. Scheduled future tasks cannot be marked as already done. Behavior and training notes have their own dated history.

### Supplies and spending

Save a supply with its package unit, current stock, refill threshold, and optional reference price. Dog supplies link to Household-category catalog products. This keeps dog food out of human pantry quantities and nutrition while including actual dog spending in the household budget and Money ledger.

Add a supply to Grocery for the shopping month you choose. If that product is already pending in the same list, the app opens the existing need without doubling its quantity. An estimate remains a plan until you record a purchase.

A confirmed purchase updates the following in one transaction:

| Record | Effect |
| --- | --- |
| Shopping trip | Keeps the actual purchased quantity, amount, date, and payer. |
| Dog supply | Adds the purchased number of packages once. |
| Grocery list | Applies the normal full or partial purchase behavior. |
| Money in Bloom | Records the actual Household expense once. |
| Grocery budget and history | Reflect the same dated actual expense. |
| Dog purchase history | Keeps the original supply label and receipt amount. |

A mixed receipt can contain human groceries and dog supplies. Human food stock and Dog package stock update separately from that one receipt. An exact retry cannot add the stock or spending twice. Reversal removes the purchase effects together when the current stock still matches the saved post-purchase stock. If stock has already changed or been used, review the correction before reversing; the app does not silently overwrite later stock changes.

### Reminders

Due and upcoming care appear inside the app. The Calendar button downloads one occurrence as an `.ics` file with a reminder at its saved time. Open that file and confirm it in your calendar application. Timed events use New York time with daylight-saving validation; an untimed event is a date-only reminder. Calendar files are snapshots, so later edits in Life in Bloom do not update an already imported event. Rolling schedules appear as their next current occurrence, not an unchangeable recurring calendar series.

This version does not send background push notifications by itself. A calendar reminder is not proof that a task was completed, and importing it does not create a care log.

## Saved drafts, privacy, and backups

Sign-in is remembered on this browser or installed app until sign-out, storage removal, or session expiry. Draft forms save on the device as you type. Choose Save or Record to commit a finished entry online. Quick-add water and care checkmarks save directly when online. Offline changes remain drafts and show their status; there is no hidden queue creating transactions later.

An uncertain save retains its exact request for retry, including after reload. Switching accounts keeps drafts under their original account and household, and late responses cannot overwrite the newly opened account. Shared records require household membership. Private Skills and Smoking require their original user. Browser caches and drafts are not encrypted; signing out clears the visible household cache.

| Backup | Includes | Restore |
| --- | --- | --- |
| Sleep & Ideas | This device's sleep, mood, activities, appointments, earlier device checklist, and Ideas. | Existing local-journal import workflow. |
| Household | Grocery, Food, Money, shared water, Dog, Housework, and dog purchase effects. | Household owner; missing records restored, conflicting records stop the transaction. |
| Private Skills & Smoking | Current user's skills, practice, smoking settings, daily records, and archived history. | Same user and household; review the file and restore missing records. |

Backups do not replay purchases or care actions. Attachments are represented by metadata; keep the original photos/PDFs separately. No actual practice, water, smoking, care, pet identity, or purchase records are generated from the mockups.
