# LIFE IN BLOOM

A small, dependency-free personal web app with a light pink theme. It opens on a separate **Life in Bloom Home** dashboard. **Sleep & Mood** is a section in the hamburger menu; its tabs appear in the order **Moon Wheel → Weekly Mood → Daily Log**.

## Finding your way around

The bottom bar has five destinations: **Home · Wellness · Grocery · Dog · Money**. Grocery opens the saved shopping list directly. Wellness is the entry point for nutrition. Dog and Money open the same pages as their hamburger-menu shortcuts.

The hamburger menu contains **Sleep & Mood, Money in Bloom, Food in Bloom, Skills in Bloom, Idea’s in Bloom, Housework, Dog, and Smoking Log**. The title in the app header also returns Home.

This development version has working Sleep & Mood tools, appointments, a simple Grocery checklist, and saved Ideas notes. The other sections are introductory pages for their future tools. They do not contain a completed ledger, nutrition tracker, dog-care tracker, or smoking log yet.

### Grocery and Ideas

- **Grocery:** add an item with an optional quantity, edit it, check it off, or remove it. Items left to buy appear before items picked up. Checking an item does not yet create an inventory or money entry.
- **Idea’s in Bloom:** type a title and/or a note, then choose **Save note**. Open saved notes to edit them. Unsaved form text is kept while editing; navigation asks before discarding it. Save notes before closing the app.

Saved grocery items and Ideas notes are included in backups and stay on this device between visits. They do not sync automatically to a different device.

## The three views

- **Moon Wheel:** one segment per day of the selected month. Colors reflect recorded sleep hours. Tap a segment to open the day. **Month at a glance** includes dated history and descriptive comparisons of sleep with the feelings recorded that month.
- **Weekly Mood:** seven tracking days, Monday through Sunday, with an hourly grid. Each cell shows recorded feelings and activities, plus separately labeled **Planned** appointments. Scroll sideways on a phone, or open a larger daily log using the day buttons.
- **Daily Log:** keep the existing **Asleep** mode, use **Unsure** for uncertain periods, or choose **Awake** to open an activity picker. Select Cooking, Piano, Sewing, Math, Language, or an activity of your own, then tap the relevant half-hour blocks. The time-range shortcut can fill several blocks at once.

Cooking uses the **👩🏾‍🍳 woman cook emoji with medium-dark skin tone**. Activities have a readable name and an icon as well as a color. Custom activities are included in exports.

## Recording a feeling

After marking some time Awake, open that hour's mood entry. Choose a suggested feeling or write your own, and optionally add a note. Return to the same hour to edit it. Both half-hour activities appear beside that hourly feeling, including when an activity changed midway through the hour.

Sleep, activity, and mood are separate observations. Selecting a mood does not add awake time. An activity never adds sleep hours. If a time block is corrected later, its hourly mood is kept for review. Use the explicit Erase control to clear time blocks.

Feelings are descriptive words chosen by the person logging them. They are not diagnostic scores or automatic interpretations of an activity.

## Monthly sleep and mood comparisons

The monthly history shows the tracking date, recorded sleep hours, and the feelings entered during that day. Month navigation preserves access to earlier records.

The comparison groups days by their recorded feeling words and shows average sleep hours, recorded range, and the number of contributing days. A day is counted once for each feeling even if that feeling was entered several times. A day may appear under several feelings. Custom feelings are supported; no numerical mood score is inferred.

These comparisons use sleep and mood in the **same 8 AM–8 AM tracking day**. They describe entries that occurred together; they do not establish that sleep caused the feeling or happened before it. Missing sleep totals are excluded. Partial or Unsure time is identified as a limitation of the recorded hours.

## Appointments and repeats

In **Weekly Mood** or **Daily Log**, choose **Add appointment** and enter a normal calendar date, start and end times, a title, an optional note, and a color. Use **Ends next day** for an overnight appointment. The same saved appointment appears in the weekly agenda, as a colored **Planned** block inside each overlapping hourly grid cell, and in the daily agenda and corresponding timeline groups.

Choose **Show in grid** to jump to an appointment's time in the weekly grid, or **Open day** to see its daily log. Saving an appointment for a different week or day opens the appropriate time window. Editing either view changes the same appointment; there is no duplicate entry to maintain.

An early-morning appointment before 8 AM appears in the previous tracking-day column and daily log, with its actual calendar date shown in the appointment details. An appointment that crosses 8 AM can appear in both overlapping tracking days.

Appointments can occur once or repeat daily, weekly on selected weekdays, or monthly. Repeats support an interval and an optional inclusive end date. Monthly appointments keep their numbered day; a monthly appointment on the 31st skips months without a 31st.

Click an appointment to edit or delete it. For a repeating appointment, choose **Only this occurrence** or **Entire series**. A single-occurrence edit keeps the original series, excludes that occurrence, and adds the changed appointment separately. Canceling leaves the saved plan unchanged.

Appointments are plans inside Life in Bloom. They do not mark Awake, add an activity to the actual log, create mood entries, contribute to sleep analytics, synchronize with the phone calendar, or send reminders. Recurring events use the device's local calendar/time zone. Unavailable clock times at a daylight-saving jump are adjusted and flagged for review.

## Dates and times

Each tracking day runs from **8 AM to 8 AM the next morning**. For example, a Tuesday tracking day includes Wednesday at 2 AM. After-midnight entries show the actual calendar date. Before 8 AM, the default daily log uses the previous tracking day; the app still opens on Home.

Sleep and activities use 48 approximate half-hour blocks. Mood uses 24 hourly entries within the same window. This is a clock-time journal; it does not calculate exact elapsed durations during daylight-saving clock changes.

Empty time is unknown. It is not automatically treated as awake or as zero sleep. The monthly wheel remains based on recorded sleep blocks.

A day with only some awake activities recorded has no sleep total yet and is excluded from the sleep average. A day with all 48 blocks explicitly marked Awake is a recorded zero. Unsure blocks do not establish zero sleep.

## Saving and backups

Entries save in this browser or installed app, on this device. There are no accounts, cloud uploads, analytics, or automatic synchronization. Keep regular exported backups, particularly before changing devices or clearing browser data.

The current format uses the storage key `life-in-bloom.data.v4`. When that key is absent, entries are copied from the newest available earlier key: `life-in-bloom.sleep-mood.v3`, `life-in-bloom.sleep-mood.v2`, or the original `sleep-in-bloom.records.v1`. Earlier keys are retained. An intentionally empty latest save does not restore older entries, and an unreadable save is protected from replacement. The legacy status value `rest` is preserved internally and displayed as **Unsure**.

Version 4 exports include sleep, quality, daily notes, hourly moods, activity assignments, custom activities, appointment definitions with repeat rules and skipped dates, grocery items, and saved Ideas notes. Import accepts versions 1–4 of the recognized Sleep in Bloom / Life in Bloom backup formats. Import replaces current entries after confirmation; it does not merge devices. Invalid backups are rejected before replacement. Unsaved Grocery or Ideas form text must be saved or explicitly discarded before importing.

If browser storage is full or unavailable, the app reports the save failure. Export before closing. If stored data cannot be read, edits are blocked to protect the stored copy.

Personal exports should not be committed to this repository. Publishing app code does not upload browser-stored entries. Protected accounts and synchronization are separate future features.

## Preview on Windows

1. Select the development branch in GitHub Desktop and pull its latest changes.
2. Open the project in Visual Studio Code.
3. Open **Terminal → New Terminal** and run:

   ```powershell
   py -m http.server 8000 --bind 127.0.0.1
   ```

4. Open `http://127.0.0.1:8000` in Edge or Chrome.
5. Home opens first. Use the hamburger menu to open **Sleep & Mood → Daily Log**, select **Awake → Cooking**, mark a time, then add that hour's feeling. Check it in **Weekly Mood**.

Keep the terminal running while previewing. On macOS or Linux use `python3 -m http.server 8000 --bind 127.0.0.1`.

## Online and offline use

The existing published version comes from `main`. Preview development changes before merging them into `main`.

The service worker caches HTML, CSS, scripts, manifest, and icons after a successful online load. It requests fresh files when connected and uses cached files offline. Deploy all four `bloom-*.js` files alongside `app.js`, and update the cache version when changing the app.

On iPhone, open the published address in Safari and use **Add to Home Screen**. Browser and installed-app storage can be separate; use backups when moving entries.

## Files and checks

- `index.html`: page shell, navigation, and help.
- `app.js`: views, dialogs, interactions, and the monthly wheel.
- `bloom-data.js`: dates, validation, migration, backups, and editing rules.
- `bloom-insights.js`: dated monthly history and descriptive sleep/mood comparisons.
- `bloom-appointments.js`: appointment dialogs, agenda, and planned grid entries.
- `bloom-pages.js`: Home, Grocery, Ideas, and introductory section pages.
- `styles.css`: responsive layout, focus states, and dialogs.
- `service-worker.js`: offline assets.
- `tests/*.test.cjs`: regression checks for saved data, recurrence, monthly comparisons, grocery items, and Ideas notes.

The app needs no build step or package installation. Developers with Node.js can run:

```sh
node --test tests/*.test.cjs
```
