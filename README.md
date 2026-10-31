# Sleep in Bloom — personal sleep-tracking app

This is a ready-to-run **progressive web app (PWA)** designed for a personal iPhone, Mac, or PC. It is a functioning starter app, not merely a picture.

## What it does

- **Month view:** every date is tappable; 12 circles indicate logged sleep time in half-hour increments.
- **Daily view:** a complete 8 AM to next-day 8 AM timeline (48 half-hour blocks) for sleep, rest/unsure, and awake. Tap each time block or enter a range.
- **Moon Wheel:** original circular monthly sleep tracker, with day segments opening the detailed daily log.
- **Quality and notes:** record how rested you felt and what you remember.
- **Storage and backup:** saves records automatically **on this device**. Export/import your data as JSON. No cloud connection or accounts.
- **Offline support:** after installation and a successful first load, a service worker caches the app files for offline usage.

### Important notes

- The app logs **self-reported or estimated** sleep in 30-minute blocks. It does not measure sleep automatically.
- Empty periods are *unknown*, not assumed to be awake.
- The 8 AM–8 AM daily window is a tracking convention, not a required sleep schedule.
- It is a journal, not medical advice or a substitute for care from a clinician.
- **Data stays separate on each device/browser installation.** For example, an iPhone Home Screen installation may not share data with Safari. Install first, then log in that app, and use backups. If you delete the installed app or clear its data, logs may be lost.
- Do not commit personal sleep backup files into a GitHub repository. GitHub Pages websites are publicly accessible. The published app files contain **no sleep entries**; your entries are saved in device/browser storage.

## Try on your MacBook

1. Download and unzip the project.
2. Open Terminal, navigate to the unzipped `life-in-bloom-sleep` folder.
3. Run `python3 -m http.server 8000`.
4. Open `http://localhost:8000` in a browser.
5. Choose **Month**, click a day number, mark sleep blocks, and return to the Month or Moon Wheel tab. Refresh the browser to check that entries remain.

To stop the local server, press Ctrl+C in Terminal. You can use a different port if 8000 is occupied.

## Put it on your iPhone with GitHub Pages (free)

1. Create a free GitHub account at github.com, if you don't have one.
2. Create a **public** repository named `sleep-in-bloom` and leave it empty.
3. On the repository's **Code** page, select **Add file → Upload files**. Upload the **contents** of this project folder (not the ZIP itself). Make sure `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `service-worker.js`, and the `icons` folder are all at the repository root. Commit changes.
4. Go to **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, choose `main` and `/ (root)`, then click **Save**.
5. GitHub will show a URL like `https://YOUR-USERNAME.github.io/sleep-in-bloom/`. Visit the published site. It can take several minutes to become available.
6. On your iPhone, open that link in **Safari**. Open the page menu / Share menu, choose **Add to Home Screen**, enable **Open as Web App** if shown, and tap **Add**.
7. Open the new icon on your iPhone. Start recording sleep there, and use the **Export backup** button periodically.

**Privacy:** A public GitHub Pages site is viewable by anyone who knows/discovers its URL, even though entries in this version are only saved on your phone. If you need the *whole app* to be private behind a login, use a private hosting/authentication approach instead of public GitHub Pages.

## On your PC

Open the same GitHub Pages URL in Edge or Chrome. Install the site as an app from the browser menu if desired. Your PC's entries are separate from iPhone entries. You can export a backup from one device and import it on another, which **replaces** the other device's current entries (it does not merge them).

## Customize the app

- Colors and typography: edit `styles.css`.
- Daily 8 AM–8 AM convention and date UI: edit `app.js`, especially `clockLabel`.
- Tracker circle: edit `renderCircle()` in `app.js`.
- Monthly circle grid: edit `renderMonth()` in `app.js`.
- The day selection/time blocks: edit `renderDay()` and `commitSlot()` in `app.js`.
- If you change the app, update the service worker's `CACHE` string in `service-worker.js` so offline copies refresh.

## What comes next

1. Automatic sleep calculation from entered exact start/end times (beyond 30-minute increments).
2. Multiple explicit sleep intervals and a daily nap breakdown.
3. Automatic charts comparing the beginning and end of the month.
4. Cloud sync **only if** you want your iPhone, Mac, and PC to share the same records.
5. Expand into the wider Life in Bloom app with hydration, meals, hygiene, smoking recovery, and money tracking.

The files have no external JavaScript dependencies, trackers, accounts, or subscription fees.
