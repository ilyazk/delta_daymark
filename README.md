# Daymark v3 — GitHub Pages + Google Sign-In + Google Sheets + Administrator Review

Daymark is a mobile-friendly Jalali-calendar website for collecting **daily extraction counts** from **1400/01/01 through 1405/12/29**. Participants use Google Sign-In, independently timed three-minute sessions, a personal dashboard, and a CSV-exportable history. Every submission is subject to administrator review. The administrator can approve or reject claims in the website **or directly from the private Google Sheet**.

There is **no Python backend or always-running server**. The static site is hosted on GitHub Pages; a Google Apps Script Web App validates sign-ins, runs permission checks, enforces server-side timers, and reads/writes a private Google Sheet.

## 1. How reviewing works

| Phase | User calendar | Personal history | Approved statistics | Availability to others |
| --- | --- | --- | --- | --- |
| Not claimed | Empty checkbox | No record | Unchanged | Available |
| Counting (up to 3 min) | Checked + timer | No record yet | Unchanged | Temporarily reserved |
| Submitted — **PENDING** | Checked / amber | Visible as pending | Not yet counted | Reserved |
| Admin **APPROVES** | Checked / green | Visible as approved | Count and approved-day total increase | Taken |
| Admin **REJECTS** (pending or approved) | Empty again | **Removed from the user's current history** | Any prior approved amount is subtracted | **Released to everyone** |

**Only one participant may claim a given day at a time.** Reservation is globally enforced by Apps Script, not merely the browser checkbox. An expired or canceled timer releases an unsubmitted day. Pending records may be edited with a new three-minute timer, but approved records cannot be changed by participants. The admin can later reject even an approved claim.

Rejection **deletes** the claim from `Daily Records`, but an audit entry (old count, account ID, date, reason, admin, time) is preserved in the **administrator-only** `Review Log` tab. Rejected records do not appear in participants' personal history or CSV exports.

**Counting vs. reviewing:** A three-minute deadline applies only to data entry. Admin review is not timed.

## 2. Source-code layout

- `index.html` — Google Sign-In, Jalali calendar, personal history, and administrator review screen
- `config.js` — *public* Google OAuth Web Client ID and Apps Script deployment URL
- `assets/dashboard.js` — global date availability, pending/approved checkboxes, multiple live countdowns
- `assets/history.js` — the participant's pending/approved history and CSV export
- `assets/admin.js` — admin review queue, filters, searching, approval/rejection controls
- `assets/auth.js` — Google Sign-In and navigation (admin UI shown only if bootstrap authorizes the user)
- `assets/rpc.js` — form/iframe transport between GitHub Pages and Apps Script
- `assets/jalali.js` — 72-month Jalali calendar calculations
- `apps-script/Code.gs` — verified identity, server-side access controls, global reservations, timer checks, admin decisions, migration, sheet menu, review audit
- `apps-script/appsscript.json` — Apps Script runtime and scopes
- `tests/` — local mock integration tests; run `npm test`

## 3. Deploy / upgrade

For an existing installation, also see **`UPGRADE_FROM_V2.md`** for a short step-by-step migration checklist.

### Step A — GitHub Pages (public website, private data)

1. Unzip the project. Push its website files to a GitHub repository. Do not push Google passwords, Sheets edit credentials, API secrets, or your spreadsheet URL.
2. In **Repository Settings → Pages**, choose **Deploy from a branch**, select your branch and the root (`/`).
3. The site will be available at `https://YOUR_USERNAME.github.io/REPOSITORY/` (or your custom domain). A private GitHub repository does **not** by itself make the published Pages website private; users must sign in to see their private data.

### Step B — Private Google Sheet

1. Create a **private** Google spreadsheet owned by your administrator account. Do not share it with the participants.
2. Copy its ID from the spreadsheet URL (`.../spreadsheets/d/SPREADSHEET_ID/edit`).
3. In the spreadsheet itself, open **Extensions → Apps Script** (this creates a *spreadsheet-bound* project, needed for the native `Daymark review` menu).
4. Replace `Code.gs` with the **entire** `apps-script/Code.gs` from this package. Set the Apps Script manifest to the supplied `apps-script/appsscript.json` or use equivalent scopes.

**Upgrading from v2:** Use the **same private spreadsheet** if you want to preserve existing users/records. First make a **backup copy** of the spreadsheet. The new `setupSheets()` migrates the old three-tab layout in place and creates a `Review Log` tab. No historic claim is silently approved: **all old records become `PENDING`**. Previously accumulated totals temporarily become zero approved counts until reviewed. Earlier versions allowed different people to submit the *same* day; such legacy collisions must be resolved manually by rejecting unwanted claims before approving the survivor. Migration neither automatically deletes a participant's prior claim nor arbitrarily picks a winner.

### Step C — Google OAuth Client

1. In **Google Cloud Console**, create or select a Cloud project.
2. Configure the Google Auth Platform consent screen as appropriate for your audience. For a Testing-mode external application, add participant Google accounts as test users as required by Google's current policies.
3. Create an **OAuth Client ID → Web application**.
4. Under **Authorized JavaScript origins**, add `https://YOUR_USERNAME.github.io` (or exactly your custom HTTPS origin). **Do not add the `/REPOSITORY/` path.** Local tests can additionally use `http://localhost:8000`.
5. Copy the Web Client ID ending in `.apps.googleusercontent.com`. You do not need the OAuth client secret in this project.

### Step D — Apps Script configuration (IMPORTANT)

In **Apps Script → Project Settings → Script properties**, set:

| Property | Example | Required? |
| --- | --- | --- |
| `SPREADSHEET_ID` | `1abc...` | **Yes** |
| `GOOGLE_CLIENT_ID` | `123-xyz.apps.googleusercontent.com` | **Yes** |
| `FRONTEND_ORIGIN` | `https://YOUR_USERNAME.github.io` | **Yes** |
| `ADMIN_GOOGLE_EMAIL` | `owner@gmail.com` | **Yes** |
| `ADMIN_GOOGLE_SUB` | `1098000...` | Optional extra protection |

**ADMIN_GOOGLE_EMAIL** must be the administrator's Google account. Every admin endpoint checks it **on the server** against the verified Google identity. You cannot obtain administrator access by setting `is_admin` in browser JavaScript or by claiming an admin email in an API request.

For stronger role binding, set **ADMIN_GOOGLE_SUB** to the immutable numeric Google Subject ID shown for the administrator in the private `Users` tab after they sign in to Daymark once. When it is configured, *both* the verified email and Subject ID must match.

`FRONTEND_ORIGIN` is the **origin only** (e.g. `https://someone.github.io`), without path or trailing slash. For local testing you can temporarily use `http://localhost:8000` and then restore the real origin for production.

1. **Run `setupSheets()` in the Apps Script editor** and authorize the script. It creates/migrates all required tabs without deleting old records.
2. **Reload the Google Sheet** to see the new **Daymark review** menu.
3. Choose **Deploy → Manage deployments → Edit** if upgrading; choose a **new script version** and Deploy. If starting fresh, choose **Deploy → New deployment → Web app**.
4. Choose **Execute as: Me** and **Who has access: Anyone**. Users don't need spreadsheet edit permissions. The public Web App endpoint checks Google-issued ID tokens on every operation; only its owner can edit the spreadsheet.
5. Copy the Web App URL ending in `/exec`.

> **Security note:** An Apps Script URL with access set to `Anyone` is publicly reachable, but does **not** make the data public. Data APIs verify each token server-side and bind records to the verified Google Subject, while administrator endpoints additionally check `ADMIN_GOOGLE_EMAIL` and optionally `ADMIN_GOOGLE_SUB`. The hostname/origin check alone is never treated as authentication.

### Step E — Public `config.js`

Edit `config.js` in the GitHub repository:

```javascript
window.DAYMARK_CONFIG = Object.freeze({
  GOOGLE_CLIENT_ID: "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
});
```

These are public IDs/URLs, not secrets. Push your update. Visit GitHub Pages and sign in with Google. Only the configured administrator sees the **Admin review** link in the navigation bar.

## 4. Administrator operations

**From the website** (as admin):

1. Choose **Admin review** in the navigation bar.
2. The review queue defaults to **Pending**. Choose **Approved** to audit and potentially revoke previously accepted claims. You can search by date, Google email, display name or user Subject.
3. Click **Approve** to accept a pending count. The participant's approved statistics update on their next refresh.
4. To reject, enter a reason of at least 3 characters, click **Reject**, and confirm. The claim is removed, its day is immediately available to all participants, and the decision is written to `Review Log`.
5. The queue's count of rejected decisions is an **audit event count**, not a count of permanently unavailable dates; a freed day may be resubmitted later and reviewed again.

**Directly in Google Sheets** (admin owner):

1. Open the private spreadsheet on a desktop browser. Select any cell in a **data row** of the **Daily Records** tab.
2. Choose **Daymark review → Approve selected claim**, or **Daymark review → Reject selected claim…** and enter the reason.
3. Both operations use the **same Apps Script review function** as the website, recompute user totals and update the audit log. No manual unchecking, cell deletion or status editing is needed.
4. The Google Sheet menu is only available in a **spreadsheet-bound** Apps Script project. It refuses to run if Apps Script cannot identify the configured administrator from the active Google account. If an admin Subject has not been stored yet, sign in to the website once first (or set `ADMIN_GOOGLE_SUB`).

Because row deletions change row numbers, select the intended row again before each spreadsheet-menu action. Avoid directly changing the data/status columns: manual edits bypass review/audit logic. If you must repair the Sheet, run `repairAllUserTotals()` afterward and inspect the `Review Log`.

## 5. Google Sheet tabs

**`Users`** — `Google Subject`, `Email`, `Display Name`, `Joined UTC`, `Approved Data`, `Approved Days`, `Pending Days`. Only **approved** counts/days contribute to verified totals.

**`Daily Records`** — `Google Subject`, `Jalali Date`, `Data Count`, `Created UTC ms`, `Updated UTC ms`, `Review Status` (`PENDING` or `APPROVED`), `Reviewed By Subject`, `Reviewed UTC ms`, `Admin Note`. Contains **only current, unrejected claims**.

**`Active Timers`** — `Google Subject`, `Jalali Date`, `Started UTC ms`, `Expires UTC ms`, `Mode`. Each date can have at most one active owner. Multiple distinct dates can have independent three-minute timers.

**`Review Log`** — `Review UTC ms`, `Admin Subject`, `Admin Email`, `Action`, `User Subject`, `Jalali Date`, `Data Count`, `Previous Status`, `Admin Note`, `Record Updated UTC ms`. Records every approval and rejection, including rejected claims no longer present in user history. **Keep this tab private.**

### No participant passwords are stored

Google handles the participant's password. The website sends a Google ID token to Apps Script, which verifies the token (including signature via Google's trusted token-info endpoint, `aud`, `iss`, expiry, verified email). The permanent identity is the immutable Google Subject. The administrator's email is verified by the server, never by an untrusted request field. The browser stores the short-lived token in `sessionStorage` for that tab; no spreadsheet write access credentials are sent to the browser.

## 6. Smoke test on your real Google account

1. Sign in as participant A and participant B, and separately as your configured admin.
2. A selects a date and starts a timer. B sees it as *In progress* and cannot start that same date. A submits a count; B sees the date *Under review*.
3. A sees a *Pending review* badge; its count does **not** yet appear in the approved-total statistics.
4. Admin approves the count. A sees an approved badge and updated verified total after refresh. B sees the date as *Claimed*.
5. Admin switches the review filter to **Approved** and rejects the claim with a reason. After refresh, the date is unchecked for A, gone from A's personal history/CSV, and available to B. The log still retains the original claim and decisions.
6. B starts that released date and submits a new count. Independently try starting two timers on **different** dates, and verify they do not reset after reload.
7. Repeat approval/rejection from the Google Sheet `Daymark review` menu to confirm both administrative paths work.
8. If you had existing v2 data, confirm every old claim is pending until reviewed. If two users previously claimed the same date, reject one before approving the other.

The previous source version (v2) allowed multiple users to claim the same date; v3 **intentionally changes this behavior** to support releasing dates for reassignment after rejection.

## 7. Developer checks

Run from the unzipped project directory with **Node.js 18+**:

```bash
npm test
npm run check
```

Tests use an in-memory Google Sheets/Apps Script simulation. They check the Jalali date range, OAuth verification and admin identity checks, separate accounts, global date reservations, independent/expired timers, admin approval and rejection (including previously approved claims), pending-only edits, optimistic revision checking, migration of the legacy sheet, spreadsheet-native menu decisions, and response encoding.

**Live Google Sign-In, the Google Sheets menu and iframe transport cannot be fully tested locally without your own Google configuration.** Always perform the smoke test after publishing. Some restrictive browsers may block embedded Apps Script responses; if that occurs, the iframe-based bridge needs an alternative deployment/transport architecture.

To preview the frontend without changing your Google configuration, from the project root run:

```bash
python -m http.server 8000
```

Open `http://localhost:8000` (do not use `file://`). For *live* sign-in testing on localhost, include localhost in OAuth Authorized JavaScript origins and temporarily change Apps Script's `FRONTEND_ORIGIN` accordingly.

## 8. Scale, concurrency and backups

- `LockService.getScriptLock()` serializes writes to timers, claims, and review decisions; a deadline is checked after lock acquisition. The backend uses revision checks so admins cannot approve a stale count after it has been edited.
- This is a **small-team MVP**. Apps Script/Sheets have quota and speed limitations; a larger/high-traffic system should use a database and a dedicated authentication service. Google's `tokeninfo` endpoint is not recommended for high-volume production verification; a supported server-side JWT verifier is preferable there.
- Protect your private Sheet, keep backups (especially before running a migration), and consider making a scheduled Google Drive copy of the spreadsheet. `Review Log` is an operational audit trail, **not** an immutable compliance archive against the spreadsheet owner.
- Apps Script/Sheets writes are not full ACID database transactions. Rare partial failures may require an owner to inspect/reconcile data and re-run `repairAllUserTotals()`.
- User interface refreshes cannot make the server accept an expired timer. A timer can restart after expiration; submitting after expiration is refused.
- To apply future Apps Script code edits, create and deploy a **new script version** in the existing deployment so you can keep its `/exec` URL and Sheet data.
