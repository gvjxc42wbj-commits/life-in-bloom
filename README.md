# Life in Bloom — Sleep & Mood

A small, dependency-free web app for daily sleep and activities, hourly feelings, and a monthly moon wheel.

## The three views

- **Weekly Mood:** seven tracking days, Monday through Sunday, with an hourly grid. Each cell shows the feeling and activities recorded for that hour. Scroll the grid sideways on a phone, or open a larger daily log using the day buttons.
- **Moon Wheel:** one segment per day of the selected month. Its colors and totals continue to reflect recorded sleep hours. Tap a segment to open the day.
- **Daily Log:** keep the existing **Asleep** mode, use **Unsure** for uncertain periods, or choose **Awake** to open an activity picker. Select Cooking, Piano, Sewing, Math, Language, or an activity of your own, then tap the relevant half-hour blocks. The time-range shortcut can fill several blocks at once.

Cooking uses the **👩🏾‍🍳 woman cook emoji with medium-dark skin tone**. Activities have a readable name and an icon as well as a color. Custom activities are included in exports.

## Recording a feeling

After marking some time Awake, open that hour's mood entry. Choose a suggested feeling or write your own, and optionally add a note. Return to the same hour to edit it. Both half-hour activities appear beside that hourly feeling, including when an activity changed midway through the hour.

Sleep, activity, and mood are separate observations. Selecting a mood does not add awake time. An activity never adds sleep hours. If a time block is corrected later, its hourly mood is kept for review. Use the explicit Erase control to clear time blocks.

Feelings are descriptive words chosen by the person logging them. They are not diagnostic scores or automatic interpretations of an activity.

## Dates and times

Each tracking day runs from **8 AM to 8 AM the next morning**. For example, a Tuesday tracking day includes Wednesday at 2 AM. After-midnight entries show the actual calendar date. Before 8 AM, the app initially opens the previous tracking day.

Sleep and activities use 48 approximate half-hour blocks. Mood uses 24 hourly entries within the same window. This is a clock-time journal; it does not calculate exact elapsed durations during daylight-saving clock changes.

Empty time is unknown. It is not automatically treated as awake or as zero sleep. The monthly wheel remains based on recorded sleep blocks.

A day with only some awake activities recorded has no sleep total yet and is excluded from the sleep average. A day with all 48 blocks explicitly marked Awake is a recorded zero. Unsure blocks do not establish zero sleep.

## Saving and backups

Entries save in this browser or installed app, on this device. There are no accounts, cloud uploads, analytics, or automatic synchronization. Keep regular exported backups, particularly before changing devices or clearing browser data.

The new format uses the storage key `life-in-bloom.sleep-mood.v2`. When that key is absent, existing records from `sleep-in-bloom.records.v1` are copied into the new format. The original key is retained. The legacy status value `rest` is preserved internally and displayed as **Unsure**.

Version 2 exports include sleep, quality, notes, hourly moods, activity assignments, and custom activity definitions. Import accepts both earlier version 1 Sleep in Bloom backups and version 2 backups. Import replaces the current entries after confirmation; it does not merge two devices. Invalid backups are rejected before replacement.

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

The service worker caches HTML, CSS, scripts, manifest, and icons after a successful online load. It requests fresh files when connected and uses cached files offline. Deploy `bloom-data.js` alongside `app.js`, and update the cache version when changing the app.

On iPhone, open the published address in Safari and use **Add to Home Screen**. Browser and installed-app storage can be separate; use backups when moving entries.

## Files and checks

- `index.html`: page shell, navigation, and help.
- `app.js`: views, dialogs, interactions, and the monthly wheel.
- `bloom-data.js`: dates, validation, migration, backups, and editing rules.
- `styles.css`: responsive layout, focus states, and dialogs.
- `service-worker.js`: offline assets.
- `tests/data.test.cjs`: regression checks for saved-data rules.

The app needs no build step or package installation. Developers with Node.js can run:

```sh
node --test tests/data.test.cjs
```
