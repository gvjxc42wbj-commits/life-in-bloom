# LIFE IN BLOOM

A small, dependency-free personal web app. **Sleep & Mood** is available in the hamburger menu, with a light pink app theme. Its tabs open in the order **Moon Wheel → Weekly Mood → Daily Log**.

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

In **Weekly Mood**, choose **Add appointment** and enter a normal calendar date, start and end times, a title, an optional note, and a color. Use **Ends next day** for an overnight appointment. Plans appear in the weekly agenda and alongside the relevant hourly grid cells. An early-morning appointment before 8 AM appears in the previous tracking-day column, with its actual calendar date shown in the appointment details.

Appointments can occur once or repeat daily, weekly on selected weekdays, or monthly. Repeats support an interval and an optional inclusive end date. Monthly appointments keep their numbered day; a monthly appointment on the 31st skips months without a 31st.

Click an appointment to edit or delete it. For a repeating appointment, choose **Only this occurrence** or **Entire series**. A single-occurrence edit keeps the original series, excludes that occurrence, and adds the changed appointment separately. Canceling leaves the saved plan unchanged.

Appointments are plans inside Life in Bloom. They do not mark Awake, add an activity to the actual log, create mood entries, contribute to sleep analytics, synchronize with the phone calendar, or send reminders. Recurring events use the device's local calendar/time zone. Unavailable clock times at a daylight-saving jump are adjusted and flagged for review.

## Dates and times

Each tracking day runs from **8 AM to 8 AM the next morning**. For example, a Tuesday tracking day includes Wednesday at 2 AM. After-midnight entries show the actual calendar date. Before 8 AM, the app initially opens the previous tracking day.

Sleep and activities use 48 approximate half-hour blocks. Mood uses 24 hourly entries within the same window. This is a clock-time journal; it does not calculate exact elapsed durations during daylight-saving clock changes.

Empty time is unknown. It is not automatically treated as awake or as zero sleep. The monthly wheel remains based on recorded sleep blocks.

A day with only some awake activities recorded has no sleep total yet and is excluded from the sleep average. A day with all 48 blocks explicitly marked Awake is a recorded zero. Unsure blocks do not establish zero sleep.

## Saving and backups

Entries save in this browser or installed app, on this device. There are no accounts, cloud uploads, analytics, or automatic synchronization. Keep regular exported backups, particularly before changing devices or clearing browser data.

The current format uses the storage key `life-in-bloom.sleep-mood.v3`. When that key is absent, entries are copied from `life-in-bloom.sleep-mood.v2`, or from the original `sleep-in-bloom.records.v1` if v2 is absent. Earlier keys are retained. An intentionally empty latest save does not restore older entries, and an unreadable save is protected from replacement. The legacy status value `rest` is preserved internally and displayed as **Unsure**.

Version 3 exports include sleep, quality, notes, hourly moods, activity assignments, custom activities, and appointment definitions with repeat rules and skipped dates. Import accepts version 1 and version 2 Sleep in Bloom backups as well as version 3 Life in Bloom backups. Import replaces current records and plans after confirmation; it does not merge devices. Invalid backups are rejected before replacement.

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
5. Choose **Daily Log**, select **Awake → Cooking**, mark a time, then add that hour's feeling. Check it in **Weekly Mood**.

Keep the terminal running while previewing. On macOS or Linux use `python3 -m http.server 8000 --bind 127.0.0.1`.

## Online and offline use

The existing published version comes from `main`. Preview development changes before merging them into `main`.

The service worker caches HTML, CSS, scripts, manifest, and icons after a successful online load. It requests fresh files when connected and uses cached files offline. Deploy all three `bloom-*.js` files alongside `app.js`, and update the cache version when changing the app.

On iPhone, open the published address in Safari and use **Add to Home Screen**. Browser and installed-app storage can be separate; use backups when moving entries.

## Files and checks

- `index.html`: page shell, navigation, and help.
- `app.js`: views, dialogs, interactions, and the monthly wheel.
- `bloom-data.js`: dates, validation, migration, backups, and editing rules.
- `bloom-insights.js`: dated monthly history and descriptive sleep/mood comparisons.
- `bloom-appointments.js`: appointment dialogs, agenda, and planned grid entries.
- `styles.css`: responsive layout, focus states, and dialogs.
- `service-worker.js`: offline assets.
- `tests/*.test.cjs`: regression checks for saved data, recurrence, and monthly comparisons.

The app needs no build step or package installation. Developers with Node.js can run:

```sh
node --test tests/*.test.cjs
```
