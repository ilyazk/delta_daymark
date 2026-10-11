# Upgrade checklist: Daymark Google Sheets v2 -> v3 with administrator review

## Before changing anything

1. Open your existing private spreadsheet and choose **File -> Make a copy**. Store the backup privately.
2. Verify you own the spreadsheet and the Apps Script project used by the existing site.
3. Decide which Google account is the administrator; its verified email is required in the next step.

## Update Apps Script

1. In the **existing spreadsheet**, open **Extensions -> Apps Script**.
2. Replace the old `Code.gs` contents with **all of** `apps-script/Code.gs` from v3.
3. Update `appsscript.json` to include the new `script.container.ui` and `userinfo.email` scopes (the supplied v3 manifest has them).
4. In **Project Settings -> Script properties**, keep the existing values and **add** `ADMIN_GOOGLE_EMAIL` with the real admin account email. Optionally set `ADMIN_GOOGLE_SUB` to the numeric Subject ID of that same admin account.
5. Run **`setupSheets()`** once in the editor. Grant any newly requested permissions.
6. Verify the Sheet now has **four tabs**: `Users`, `Daily Records`, `Active Timers`, `Review Log`. The old records should still exist, with `Review Status = PENDING`.
7. In **Deploy -> Manage deployments -> Edit**, select **New version** and deploy. If you edit the *existing* Web App deployment, its `/exec` URL usually remains unchanged.
8. Reload the spreadsheet. The **Daymark review** menu should appear. The admin can select a `Daily Records` row and approve or reject it with a reason.

## Update GitHub Pages

1. Upload/replace `index.html`, `assets/`, `config.js`, and other static files from v3 in your GitHub Pages repository. Keep your own public identifiers in `config.js` (the new ZIP contains placeholders).
2. Wait for the GitHub Pages deployment to show your changes. Visit the same site URL and sign in.
3. The configured Google account now sees **Admin review**, whereas ordinary users do not.
4. Run the real-Google smoke test in `README.md` with **two** participant accounts.

## Important changes to old data

- **Old claims become pending, not automatically approved.** Their numbers still exist, but only approved claims now contribute to a user's verified totals.
- **The entire date is now exclusive across users.** If users A and B both claimed `1403/01/01` under v2, those old rows remain intact. Reject the incorrect row(s) first; v3 refuses to approve a conflicting claim until it is the only one remaining for that date.
- **A rejection removes the record from the user's current history.** The admin's decision remains in the private `Review Log`, along with the rejected count and reason.
- **Future claims cannot share a date.** Selecting a day locks it for up to three minutes, and submitting locks it pending review. Rejection or cancel/expiry releases it.
- **Do not manually delete/relabel rows in Sheets** to reject a claim; use the website's admin actions or the `Daymark review` menu, so totals and audit log are updated together.
- A legacy app version left open in a user's browser may display stale date availability until refreshed, and its old UI is not compatible with the new status workflow. Ask participants to reload after the upgrade.

## Rollback

The migration adds columns and the `Review Log` tab. **Do not simply re-deploy v2 code against the v3 Sheet**; v2 expects its original column layout and has no review semantics. Restore the backed-up v2 spreadsheet *and* v2 code/deployment together if a full rollback is needed, understanding that new v3 decisions may be lost during rollback.
