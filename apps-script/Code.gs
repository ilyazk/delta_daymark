/**
 * DAYMARK — Google Apps Script server, deploy as a Web App:
 *   Execute as: Me        Access: Anyone
 *
 * Web frontend: GitHub Pages. This app receives form POSTs in hidden iframes,
 * then returns an HtmlService response which posts the result to ONE allowed
 * GitHub Pages origin. No browser-side Sheets permissions / API key / secret.
 *
 * REQUIRED SCRIPT PROPERTIES (not in source code):
 *   SPREADSHEET_ID, GOOGLE_CLIENT_ID, FRONTEND_ORIGIN, ADMIN_GOOGLE_EMAIL
 * OPTIONAL: ADMIN_GOOGLE_SUB (restrict administrator to an immutable Google account ID)
 *
 * Google ID tokens are verified against Google's HTTPS tokeninfo endpoint,
 * and client ID, issuer, expiry, email_verified are checked here. Suitable
 * for a small/low-traffic project; Google's docs caution that tokeninfo is
 * not a high-volume production verifier. See README for that limitation.
 */
const DAYMARK = Object.freeze({
  VERSION: '3.0.0',
  YEAR_MIN: 1400,
  YEAR_MAX: 1405,
  TIMER_MS: 180000,
  EXPIRED_VISIBLE_MS: 20 * 60000,
  MAX_ACTIVE_TIMERS: 30,
  MAX_COUNT: 999999999,
  USERS: 'Users',
  RECORDS: 'Daily Records',
  TIMERS: 'Active Timers',
  LOG: 'Review Log',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  NOWRUZ: Object.freeze({
    1400: '2021-03-21', 1401: '2022-03-21', 1402: '2023-03-21',
    1403: '2024-03-20', 1404: '2025-03-21', 1405: '2026-03-21',
    1406: '2027-03-21'
  }),
  MONTH_EN: Object.freeze(['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand']),
  MONTH_FA: Object.freeze(['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']),
});

const TABLE_COLUMNS = Object.freeze({
  'Users': ['Google Subject', 'Email', 'Display Name', 'Joined UTC', 'Approved Data', 'Approved Days', 'Pending Days'],
  'Daily Records': ['Google Subject', 'Jalali Date', 'Data Count', 'Created UTC ms', 'Updated UTC ms',
    'Review Status', 'Reviewed By Subject', 'Reviewed UTC ms', 'Admin Note'],
  'Active Timers': ['Google Subject', 'Jalali Date', 'Started UTC ms', 'Expires UTC ms', 'Mode'],
  'Review Log': ['Review UTC ms', 'Admin Subject', 'Admin Email', 'Action', 'User Subject', 'Jalali Date',
    'Data Count', 'Previous Status', 'Admin Note', 'Record Updated UTC ms']
});
const OLD_TABLE_COLUMNS = Object.freeze({
  'Users': ['Google Subject', 'Email', 'Display Name', 'Joined UTC', 'Total Data', 'Completed Days'],
  'Daily Records': ['Google Subject', 'Jalali Date', 'Data Count', 'Created UTC ms', 'Updated UTC ms'],
  'Active Timers': ['Google Subject', 'Jalali Date', 'Started UTC ms', 'Expires UTC ms', 'Mode']
});

function appError_(status, message) {
  const error = new Error(message);
  error.publicStatus = status;
  return error;
}

function appProps_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.SPREADSHEET_ID || !props.GOOGLE_CLIENT_ID || !props.FRONTEND_ORIGIN || !props.ADMIN_GOOGLE_EMAIL) {
    throw new Error('Configure SPREADSHEET_ID, GOOGLE_CLIENT_ID, FRONTEND_ORIGIN and ADMIN_GOOGLE_EMAIL in Script Properties.');
  }
  const httpsOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(props.FRONTEND_ORIGIN);
  const localhostOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1):[0-9]{2,5}$/.test(props.FRONTEND_ORIGIN);
  if (!httpsOrigin && !localhostOrigin) {
    throw new Error('FRONTEND_ORIGIN must be an HTTPS origin (or http://localhost:PORT for local development), with no path or trailing slash.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(props.ADMIN_GOOGLE_EMAIL.trim())) {
    throw new Error('ADMIN_GOOGLE_EMAIL must be a valid email address.');
  }
  return props;
}

function doGet() {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Daymark API</title>' +
    '<body style="font-family:sans-serif;padding:35px"><h1>Daymark API</h1>' +
    '<p>The Google Sheets bridge is online. Open your GitHub Pages site to sign in and use it.</p></body></html>'
  );
}

function doPost(event) {
  let origin = '';
  let requestId = '';
  let response;
  try {
    const props = appProps_();
    origin = props.FRONTEND_ORIGIN;
    const fields = event && event.parameter ? event.parameter : {};
    requestId = String(fields.request_id || '');
    if (!/^[a-zA-Z0-9_-]{20,90}$/.test(requestId)) throw appError_(400, 'Invalid request identifier.');
    if (fields.origin !== origin) throw appError_(403, 'Unexpected website origin.');
    const rawPayload = String(fields.payload || '');
    if (rawPayload.length > 15000) throw appError_(413, 'Request is too large.');
    const input = JSON.parse(rawPayload);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw appError_(400, 'Invalid request.');
    const user = verifyGoogleIdToken_(input.idToken, props.GOOGLE_CLIENT_ID);
    const data = dispatch_(user, input.action, input.args || {}, props);
    response = {channel: 'daymark:response:v2', requestId: requestId, ok: true, status: 200, data: data};
  } catch (error) {
    const status = error && error.publicStatus ? error.publicStatus : 500;
    if (status >= 500) console.error(error && error.stack || error);
    response = {channel: 'daymark:response:v2', requestId: requestId, ok: false, status: status,
      error: status < 500 ? String(error.message) : 'Server error. Please retry or contact the administrator.'};
  }
  if (!origin) {
    // The script cannot be used until the administrator provides its allowed origin.
    return HtmlService.createHtmlOutput('Daymark is not configured.').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return replyToFrame_(origin, response);
}

function replyToFrame_(origin, body) {
  // Prevent profile names and future response values from closing a script tag.
  const json = JSON.stringify(body).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const safeOrigin = JSON.stringify(origin);
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>window.top.postMessage(' + json + ',' + safeOrigin + ');<\/script>' +
    '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function verifyGoogleIdToken_(token, clientId) {
  if (typeof token !== 'string' || token.length < 80 || token.length > 8192 || !/^[A-Za-z0-9_.-]+$/.test(token) || token.split('.').length !== 3) {
    throw appError_(401, 'Please sign in again using Google.');
  }
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  const key = 'id:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed.exp > Math.floor(Date.now() / 1000) + 5 && parsed.aud === clientId) {
      return {sub: parsed.sub, email: parsed.email, name: parsed.name};
    }
  }

  // Uses Google's tokeninfo validator rather than trusting decoded browser data.
  // Google advises a local Google public-key JWT verifier for high-traffic services.
  let response;
  try {
    response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: {id_token: token}, muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (error) {
    throw appError_(503, 'Google verification is unavailable. Please retry.');
  }
  if (response.getResponseCode() !== 200) throw appError_(401, 'Google sign-in expired or was rejected. Please sign in again.');
  const info = JSON.parse(response.getContentText());
  const epoch = Math.floor(Date.now() / 1000);
  const exp = Number(info.exp);
  if (info.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss) ||
      !Number.isFinite(exp) || exp <= epoch + 5 || !/^[0-9]{8,64}$/.test(String(info.sub || '')) ||
      (info.email_verified !== true && info.email_verified !== 'true') ||
      typeof info.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) {
    throw appError_(401, 'Invalid Google account identity.');
  }
  const safe = {sub: String(info.sub), aud: info.aud, exp,
    email: info.email.slice(0, 250), name: (info.name || info.email.split('@')[0]).slice(0, 160)};
  const seconds = Math.min(240, Math.floor(exp - epoch - 5));
  if (seconds > 0) cache.put(key, JSON.stringify(safe), seconds);
  return {sub: safe.sub, email: safe.email, name: safe.name};
}

function dispatch_(user, action, args, props) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw appError_(400, 'Invalid arguments.');
  switch (action) {
    case 'bootstrap': return bootstrap_(user, props);
    case 'state': return state_(user, args, props);
    case 'start': return start_(user, args, props);
    case 'cancel': return cancel_(user, args, props);
    case 'submit': return submit_(user, args, props);
    case 'history': return history_(user, args, props);
    case 'adminQueue': return adminQueue_(user, args, props);
    case 'adminReview': return adminReview_(user, args, props);
    default: throw appError_(404, 'Unknown API operation.');
  }
}

function workbook_(props) {
  return SpreadsheetApp.openById(props.SPREADSHEET_ID);
}
function table_(book, name) {
  const sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Missing Sheet tab: ' + name + '. Run setupSheets() in Apps Script editor.');
  return sheet;
}
function rows_(sheet) {
  const last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
}
function lockWrite_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(18000)) throw appError_(503, 'The sheet is busy. Please try again.');
  try {
    const value = callback();
    SpreadsheetApp.flush();
    return value;
  } finally { lock.releaseLock(); }
}
function safeCellText_(value) {
  // Prevent formula injection when a Google profile name becomes a cell.
  const cleaned = String(value === undefined ? '' : value).replace(/[\r\n\t]/g, ' ').slice(0, 250);
  return /^[=+@-]/.test(cleaned) ? "'" + cleaned : cleaned;
}
function recordStatus_(row) {
  // Legacy rows, prior to setupSheets() migration, must never be auto-approved.
  const status = String(row[5] || DAYMARK.PENDING).trim().toUpperCase();
  return status === DAYMARK.APPROVED ? DAYMARK.APPROVED : DAYMARK.PENDING;
}
function recordFor_(row) {
  return {day: String(row[1]), count: Number(row[2]), updated_at_ms: Number(row[4]),
    status: recordStatus_(row), reviewed_at_ms: Number(row[7]) || null};
}
function allRecords_(book, sub) {
  return rows_(table_(book, DAYMARK.RECORDS)).filter(row => String(row[0]) === sub);
}
function allTimers_(book, sub) {
  return rows_(table_(book, DAYMARK.TIMERS)).filter(row => String(row[0]) === sub);
}
function isAdmin_(user, props) {
  const emailMatch = String(user.email || '').toLowerCase() === String(props.ADMIN_GOOGLE_EMAIL || '').trim().toLowerCase();
  const optionalSub = String(props.ADMIN_GOOGLE_SUB || '').trim();
  return emailMatch && (!optionalSub || String(user.sub) === optionalSub);
}
function requireAdmin_(user, props) {
  if (!isAdmin_(user, props)) throw appError_(403, 'Administrator access is required.');
}
function deleteMatchingTimers_(sheet, sub, day) {
  const items = rows_(sheet);
  for (let i = items.length - 1; i >= 0; --i) {
    if (String(items[i][0]) === sub && String(items[i][1]) === day) sheet.deleteRow(i + 2);
  }
}
function epochDay_(str) { return Date.parse(str + 'T00:00:00Z') / 86400000; }
function daysInJalaliMonth_(year, month) {
  if (!Number.isInteger(year) || year < DAYMARK.YEAR_MIN || year > DAYMARK.YEAR_MAX ||
      !Number.isInteger(month) || month < 1 || month > 12) throw appError_(422, 'Jalali year or month is out of range.');
  return month <= 6 ? 31 : month <= 11 ? 30 : epochDay_(DAYMARK.NOWRUZ[year + 1]) - epochDay_(DAYMARK.NOWRUZ[year]) - 336;
}
function checkDay_(day) {
  if (typeof day !== 'string' || !/^14\d\d\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/.test(day)) {
    throw appError_(422, 'Enter a date in the YYYY/MM/DD Jalali format.');
  }
  const [year, month, date] = day.split('/').map(Number);
  if (date > daysInJalaliMonth_(year, month)) throw appError_(422, 'Invalid Jalali date.');
  return {year, month, date};
}
function jalaliMonth_(year, month) {
  const days = daysInJalaliMonth_(year, month);
  const offset = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30;
  const day1 = new Date((epochDay_(DAYMARK.NOWRUZ[year]) + offset) * 86400000);
  return {year, month, month_name_en: DAYMARK.MONTH_EN[month - 1], month_name_fa: DAYMARK.MONTH_FA[month - 1],
    days, start_weekday: (day1.getUTCDay() + 1) % 7};
}
function serverReply_(body) { body.server_now_ms = Date.now(); return body; }

/**
 * Create or migrate the private workbook in place. Back up the spreadsheet
 * before upgrading from v2. Never silently approve previously unreviewed data.
 * Only call from the Apps Script editor, never from the public API.
 */
function setupSheets() {
  const props = appProps_();
  return lockWrite_(() => {
    const book = workbook_(props);
    let migrated = false;
    for (const name of Object.keys(TABLE_COLUMNS)) {
      let tab = book.getSheetByName(name);
      if (!tab) tab = book.insertSheet(name);
      const headings = TABLE_COLUMNS[name];
      const old = OLD_TABLE_COLUMNS[name];
      const original = tab.getLastRow() ? tab.getRange(1, 1, 1, Math.max(tab.getLastColumn(), headings.length)).getValues()[0] : [];
      const isEmpty = !original.some(v => String(v).trim());
      const oldMatches = old && old.every((v, index) => String(original[index]) === v) &&
        original.slice(old.length).every(v => !String(v).trim());
      const newMatches = headings.every((v, index) => String(original[index]) === v);
      if (!isEmpty && !oldMatches && !newMatches) {
        throw new Error('Unknown column layout for ' + name + '. Back up and inspect the Sheet before changing it.');
      }
      if (oldMatches && !newMatches) {
        migrated = true;
        if (name === DAYMARK.RECORDS && tab.getLastRow() > 1) {
          const count = tab.getLastRow() - 1;
          tab.getRange(2, 6, count, 4).setValues(Array.from({length: count}, () =>
            [DAYMARK.PENDING, '', '', '']));
        }
      }
      tab.getRange(1, 1, 1, headings.length).setValues([headings])
        .setFontWeight('bold').setBackground('#daf0e6');
      tab.setFrozenRows(1);
      if (name === DAYMARK.USERS) tab.getRange('A:D').setNumberFormat('@');
      if (name === DAYMARK.RECORDS || name === DAYMARK.TIMERS) tab.getRange('A:B').setNumberFormat('@');
      if (name === DAYMARK.LOG) {
        tab.getRange('B:C').setNumberFormat('@');
        tab.getRange('E:F').setNumberFormat('@');
      }
    }
    if (migrated) {
      for (const row of rows_(table_(book, DAYMARK.USERS))) refreshUserTotals_(book, String(row[0]));
    }
    return 'Daymark sheets ready. Admin review enabled.';
  });
}

function ensureUser_(book, user, now) {
  const sheet = table_(book, DAYMARK.USERS);
  const users = rows_(sheet);
  const existingIdx = users.findIndex(row => String(row[0]) === user.sub);
  if (existingIdx >= 0) {
    const row = users[existingIdx];
    if (String(row[1]) !== user.email || String(row[2]) !== user.name) {
      sheet.getRange(existingIdx + 2, 2, 1, 2)
        .setValues([[safeCellText_(user.email), safeCellText_(user.name)]]);
    }
    return {id: user.sub, email: user.email, name: user.name, joined_at: String(row[3])};
  }
  const joined = new Date(now).toISOString();
  sheet.appendRow([user.sub, safeCellText_(user.email), safeCellText_(user.name), joined, 0, 0, 0]);
  return {id: user.sub, email: user.email, name: user.name, joined_at: joined};
}
function refreshUserTotals_(book, sub) {
  const records = allRecords_(book, sub);
  const approved = records.filter(row => recordStatus_(row) === DAYMARK.APPROVED);
  const total = approved.reduce((acc, row) => acc + Number(row[2] || 0), 0);
  const pendingDays = records.length - approved.length;
  const sheet = table_(book, DAYMARK.USERS);
  const users = rows_(sheet);
  const index = users.findIndex(row => String(row[0]) === sub);
  if (index >= 0) sheet.getRange(index + 2, 5, 1, 3).setValues([[total, approved.length, pendingDays]]);
  return {total_data: total, completed_days: approved.length, pending_days: pendingDays};
}
function bootstrap_(user, props) {
  const profile = lockWrite_(() => ensureUser_(workbook_(props), user, Date.now()));
  profile.is_admin = isAdmin_(user, props);
  return serverReply_({user: profile, timer_seconds: 180, year_min: 1400, year_max: 1405});
}
function state_(user, args, props) {
  const year = Number(args.year), month = Number(args.month);
  const monthInfo = jalaliMonth_(year, month);
  const book = workbook_(props);
  const all = rows_(table_(book, DAYMARK.RECORDS));
  const timersAll = rows_(table_(book, DAYMARK.TIMERS));
  const records = all.filter(row => String(row[0]) === user.sub);
  const timers = timersAll.filter(row => String(row[0]) === user.sub);
  const now = Date.now();
  const prefix = String(year) + '/' + String(month).padStart(2, '0') + '/';
  const entries = {};
  const occupied = {};
  const recordMap = {};
  const stats = {total_data: 0, completed_days: 0, pending_days: 0,
    active_timers: timers.filter(row => Number(row[3]) > now).length};
  for (const row of records) {
    const rec = recordFor_(row);
    if (!Number.isSafeInteger(rec.count) || rec.count < 0) continue;
    if (rec.status === DAYMARK.APPROVED) {stats.total_data += rec.count;stats.completed_days++;}
    else stats.pending_days++;
    recordMap[rec.day] = rec;
    if (rec.day.startsWith(prefix)) entries[rec.day] = rec;
  }
  // Only the occupied date/status is exposed. No other user's identity/count leaks.
  for (const row of all) {
    const day = String(row[1]);
    if (String(row[0]) === user.sub || !day.startsWith(prefix)) continue;
    if (!occupied[day] || recordStatus_(row) === DAYMARK.APPROVED) {
      occupied[day] = {status: recordStatus_(row)};
    }
  }
  for (const row of timersAll) {
    const day = String(row[1]);
    if (String(row[0]) !== user.sub && !occupied[day] && day.startsWith(prefix) && Number(row[3]) > now) {
      occupied[day] = {status: 'IN_PROGRESS'};
    }
  }
  const visibleTimers = timers.filter(row => Number(row[3]) > now - DAYMARK.EXPIRED_VISIBLE_MS)
    .map(row => ({day: String(row[1]), started_at_ms: Number(row[2]), expires_at_ms: Number(row[3]),
      previous_count: recordMap[String(row[1])] ? recordMap[String(row[1])].count : null}))
    .sort((a, b) => a.expires_at_ms - b.expires_at_ms);
  const recent = Object.values(recordMap).sort((a, b) => b.updated_at_ms - a.updated_at_ms).slice(0, 6);
  return serverReply_({month: monthInfo, entries, occupied, active_timers: visibleTimers, stats, recent});
}
function pruneOldTimers_(sheet, now) {
  const entries = rows_(sheet);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (Number(entries[i][3]) < now - DAYMARK.EXPIRED_VISIBLE_MS) sheet.deleteRow(i + 2);
  }
}
function start_(user, args, props) {
  checkDay_(args.day);
  if (typeof args.edit !== 'boolean') throw appError_(422, 'Invalid editing mode.');
  return lockWrite_(() => {
    const now = Date.now();
    const book = workbook_(props);
    const all = rows_(table_(book, DAYMARK.RECORDS));
    const saved = all.find(row => String(row[0]) === user.sub && String(row[1]) === args.day);
    if (saved && !args.edit) throw appError_(409, 'This date is already submitted. Use Edit if it is pending review.');
    if (!saved && args.edit) throw appError_(409, 'This date has not been submitted yet. Select the checkbox instead.');
    if (saved && recordStatus_(saved) === DAYMARK.APPROVED) {
      throw appError_(409, 'Approved records are locked. Ask the administrator to reject the claim before recounting.');
    }
    if (!saved && all.some(row => String(row[1]) === args.day)) {
      throw appError_(409, 'This date has already been claimed by another user.');
    }
    const sheet = table_(book, DAYMARK.TIMERS);
    pruneOldTimers_(sheet, now);
    const timers = rows_(sheet);
    if (timers.some(row => String(row[1]) === args.day && String(row[0]) !== user.sub && Number(row[3]) > now)) {
      throw appError_(409, 'Someone else is currently working on this date. Select an available date.');
    }
    const rowIndex = timers.findIndex(row => String(row[0]) === user.sub && String(row[1]) === args.day);
    if (rowIndex >= 0 && Number(timers[rowIndex][3]) > now) {
      if ((String(timers[rowIndex][4]) === 'edit') !== args.edit) throw appError_(409, 'A different counting session already exists.');
      return serverReply_({resumed: true, timer: {day: args.day, started_at_ms: Number(timers[rowIndex][2]), expires_at_ms: Number(timers[rowIndex][3])}});
    }
    const activeCount = timers.filter(row => String(row[0]) === user.sub && Number(row[3]) > now).length;
    if (activeCount >= DAYMARK.MAX_ACTIVE_TIMERS) throw appError_(409, 'At most 30 timers may run at once per user.');
    const values = [user.sub, args.day, now, now + DAYMARK.TIMER_MS, args.edit ? 'edit' : 'new'];
    if (rowIndex >= 0) sheet.getRange(rowIndex + 2, 1, 1, 5).setValues([values]);
    else sheet.appendRow(values);
    return serverReply_({resumed: false, timer: {day: args.day, started_at_ms: now, expires_at_ms: now + DAYMARK.TIMER_MS}});
  });
}
function cancel_(user, args, props) {
  checkDay_(args.day);
  return lockWrite_(() => {
    deleteMatchingTimers_(table_(workbook_(props), DAYMARK.TIMERS), user.sub, args.day);
    return serverReply_({ok: true});
  });
}
function submit_(user, args, props) {
  checkDay_(args.day);
  if (typeof args.count !== 'number' || !Number.isSafeInteger(args.count) ||
      args.count < 0 || args.count > DAYMARK.MAX_COUNT) throw appError_(422, 'Count must be an integer between 0 and 999,999,999.');
  return lockWrite_(() => {
    const now = Date.now(); // deadline checked AFTER acquiring global script lock
    const book = workbook_(props);
    const timerSheet = table_(book, DAYMARK.TIMERS);
    const timers = rows_(timerSheet);
    const timerIndex = timers.findIndex(row => String(row[0]) === user.sub && String(row[1]) === args.day);
    if (timerIndex < 0 || Number(timers[timerIndex][3]) <= now) {
      throw appError_(409, 'The three-minute window expired or was cancelled. Restart the timer and try again.');
    }
    const recordsSheet = table_(book, DAYMARK.RECORDS);
    const all = rows_(recordsSheet);
    const entryIndex = all.findIndex(row => String(row[0]) === user.sub && String(row[1]) === args.day);
    const previous = entryIndex >= 0 ? all[entryIndex] : null;
    const mode = String(timers[timerIndex][4]);
    if ((mode === 'edit') !== Boolean(previous)) throw appError_(409, 'This record changed since the timer began. Refresh the calendar.');
    if (previous && recordStatus_(previous) === DAYMARK.APPROVED) throw appError_(409, 'The administrator has already approved this record. It cannot be edited.');
    if (!previous && all.some(row => String(row[1]) === args.day)) throw appError_(409, 'Another user has claimed this date.');
    const updated = previous ? Math.max(now, Number(previous[4]) + 1) : now;
    const values = [user.sub, args.day, args.count, previous ? Number(previous[3]) : now, updated,
      DAYMARK.PENDING, '', '', ''];
    if (entryIndex < 0) recordsSheet.appendRow(values);
    else recordsSheet.getRange(entryIndex + 2, 1, 1, values.length).setValues([values]);
    timerSheet.deleteRow(timerIndex + 2);
    const totals = refreshUserTotals_(book, user.sub);
    return serverReply_({ok: true, entry: {day: args.day, count: args.count, updated_at_ms: updated, status: DAYMARK.PENDING}, stats: totals});
  });
}
function history_(user, args, props) {
  const year = args.year === null || args.year === undefined || args.year === '' ? null : Number(args.year);
  if (year !== null && (!Number.isInteger(year) || year < DAYMARK.YEAR_MIN || year > DAYMARK.YEAR_MAX)) throw appError_(422, 'Invalid year.');
  const page = args.page === undefined ? 1 : Number(args.page);
  const pageSize = args.pageSize === undefined ? 35 : Number(args.pageSize);
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw appError_(422, 'Invalid page number or page size.');
  }
  const records = allRecords_(workbook_(props), user.sub).map(recordFor_)
    .filter(record => year === null || record.day.startsWith(String(year) + '/'))
    .sort((a, b) => b.day.localeCompare(a.day));
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const pageEntries = records.slice((page - 1) * pageSize, page * pageSize);
  const approved = records.filter(record => record.status === DAYMARK.APPROVED);
  return serverReply_({year, page, page_size: pageSize, total_pages: totalPages,
    entry_count: records.length, total_count: approved.reduce((sum, record) => sum + record.count, 0),
    pending_count: records.length - approved.length, approved_count: approved.length, entries: pageEntries});
}
function adminQueue_(user, args, props) {
  requireAdmin_(user, props);
  const status = String(args.status || DAYMARK.PENDING).toUpperCase();
  if (!['PENDING', 'APPROVED', 'ALL'].includes(status)) throw appError_(422, 'Invalid review status.');
  const query = String(args.query || '').trim().toLowerCase();
  if (query.length > 100) throw appError_(422, 'Search text is too long.');
  const page = args.page === undefined ? 1 : Number(args.page);
  const pageSize = args.pageSize === undefined ? 20 : Number(args.pageSize);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw appError_(422, 'Invalid page or page size.');
  }
  const book = workbook_(props);
  const all = rows_(table_(book, DAYMARK.RECORDS));
  const users = rows_(table_(book, DAYMARK.USERS));
  const userMap = {};
  users.forEach(row => {userMap[String(row[0])] = {email: String(row[1]), name: String(row[2])};});
  const totals = {pending: 0, approved: 0, submitted: all.length};
  const values = [];
  for (const row of all) {
    const recordStatus = recordStatus_(row);
    if (recordStatus === DAYMARK.PENDING) totals.pending++; else totals.approved++;
    const owner = userMap[String(row[0])] || {email: '', name: ''};
    if (status !== 'ALL' && status !== recordStatus) continue;
    if (query && !(String(row[1]) + ' ' + row[0] + ' ' + owner.email + ' ' + owner.name).toLowerCase().includes(query)) continue;
    values.push({subject: String(row[0]), email: owner.email, name: owner.name,
      day: String(row[1]), count: Number(row[2]), created_at_ms: Number(row[3]),
      updated_at_ms: Number(row[4]), status: recordStatus, reviewed_at_ms: Number(row[7]) || null,
      note: String(row[8] || '')});
  }
  values.sort((a, b) => b.updated_at_ms - a.updated_at_ms || b.day.localeCompare(a.day));
  const totalPages = Math.max(1, Math.ceil(values.length / pageSize));
  const log = rows_(table_(book, DAYMARK.LOG));
  totals.rejected = log.filter(row => String(row[3]) === 'REJECTED').length;
  return serverReply_({status, query, page, page_size: pageSize,
    total_pages: totalPages, entry_count: values.length, stats: totals,
    entries: values.slice((page - 1) * pageSize, page * pageSize)});
}
function adminReview_(user, args, props) {
  requireAdmin_(user, props);
  const decision = String(args.decision || '').toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw appError_(422, 'Decision must be APPROVE or REJECT.');
  const sub = String(args.subject || '');
  if (!/^[0-9]{8,64}$/.test(sub)) throw appError_(422, 'Invalid Google Subject.');
  checkDay_(args.day);
  const expected = args.expected_updated_at_ms;
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected <= 0) {
    throw appError_(422, 'Missing or invalid record revision. Refresh the review queue.');
  }
  const note = String(args.note || '').trim();
  if (note.length > 500 || /[\r\n\t]/.test(note)) throw appError_(422, 'Admin note must be a single line of 500 characters or less.');
  if (decision === 'REJECT' && note.length < 3) throw appError_(422, 'Provide a rejection reason (at least 3 characters).');
  return lockWrite_(() => {
    const book = workbook_(props);
    const sheet = table_(book, DAYMARK.RECORDS);
    const all = rows_(sheet);
    const index = all.findIndex(row => String(row[0]) === sub && String(row[1]) === args.day);
    if (index < 0) throw appError_(409, 'Record already removed. Reload the admin queue.');
    const target = all[index];
    if (Number(target[4]) !== expected) throw appError_(409, 'The user edited this claim. Refresh the review queue before deciding.');
    const oldStatus = recordStatus_(target);
    if (decision === 'APPROVE') {
      if (oldStatus === DAYMARK.APPROVED) throw appError_(409, 'Record is already approved.');
      if (all.some((row, j) => j !== index && String(row[1]) === args.day)) {
        throw appError_(409, 'Older records contain conflicting claims on this date. Reject the conflicting claims first.');
      }
    }
    const now = Date.now();
    // Log every admin decision, including rejected records that disappear from user history.
    table_(book, DAYMARK.LOG).appendRow([now, user.sub, safeCellText_(user.email),
      decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', sub, args.day,
      Number(target[2]), oldStatus, safeCellText_(note), Number(target[4])]);
    if (decision === 'APPROVE') {
      sheet.getRange(index + 2, 6, 1, 4).setValues([[DAYMARK.APPROVED, user.sub, now, safeCellText_(note)]]);
    } else {
      sheet.deleteRow(index + 2);
    }
    // A pending edit timer must not survive a decision on its target record.
    deleteMatchingTimers_(table_(book, DAYMARK.TIMERS), sub, args.day);
    const totals = refreshUserTotals_(book, sub);
    return serverReply_({ok: true, decision, day: args.day, subject: sub, stats: totals});
  });
}
/** Optional administrator repair after editing the private Sheet by hand. */
function repairAllUserTotals() {
  const props = appProps_();
  return lockWrite_(() => {
    const book = workbook_(props);
    const users = rows_(table_(book, DAYMARK.USERS));
    users.forEach(row => refreshUserTotals_(book, String(row[0])));
    return 'User totals recomputed from APPROVED and PENDING records.';
  });
}

/**
 * Spreadsheet-native admin controls (available when this is a SHEET-BOUND
 * Apps Script project). These use the exact same validated review operation
 * as the GitHub Pages admin interface. Do not manually delete/relabel rows.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Daymark review')
    .addItem('Approve selected claim', 'approveSelectedClaim')
    .addItem('Reject selected claim...', 'rejectSelectedClaim')
    .addToUi();
}
function selectedSheetReview_(decision, note) {
  const props = appProps_();
  const effectiveEmail = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (!effectiveEmail || effectiveEmail !== String(props.ADMIN_GOOGLE_EMAIL).toLowerCase().trim()) {
    throw appError_(403, 'Only the configured administrator can review from this Sheet.');
  }
  const activeBook = SpreadsheetApp.getActiveSpreadsheet();
  if (!activeBook || activeBook.getId() !== props.SPREADSHEET_ID ||
      SpreadsheetApp.getActiveSheet().getName() !== DAYMARK.RECORDS) {
    throw appError_(422, 'Select a data row in the Daily Records tab first.');
  }
  const selection = SpreadsheetApp.getActiveRange();
  if (!selection || selection.getRow() < 2) throw appError_(422, 'Select a record row, not the header.');
  const row = SpreadsheetApp.getActiveSheet().getRange(selection.getRow(), 1, 1, 9).getValues()[0];
  const userRows = rows_(table_(activeBook, DAYMARK.USERS));
  const adminRow = userRows.find(item => String(item[1]).toLowerCase() === effectiveEmail);
  const adminSub = String(props.ADMIN_GOOGLE_SUB || (adminRow ? adminRow[0] : ''));
  if (!adminSub || !/^[0-9]{8,64}$/.test(adminSub)) {
    throw appError_(403, 'Sign into the Daymark website as administrator once before reviewing from Sheets.');
  }
  const adminUser = {sub: adminSub, email: effectiveEmail, name: 'Spreadsheet administrator'};
  return adminReview_(adminUser, {decision: decision, subject: String(row[0]),
    day: String(row[1]), expected_updated_at_ms: Number(row[4]), note: note || ''}, props);
}
function approveSelectedClaim() {
  const result = selectedSheetReview_('APPROVE', '');
  SpreadsheetApp.getUi().alert('Approved ' + result.day + '. The user totals have been updated.');
  return result;
}
function rejectSelectedClaim() {
  const ui = SpreadsheetApp.getUi();
  const prompt = ui.prompt('Reject selected claim',
    'Enter a reason. Rejection removes the claim from the user history and releases the day.', ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return null;
  const result = selectedSheetReview_('REJECT', prompt.getResponseText());
  ui.alert('Rejected ' + result.day + '. The date is available for other users.');
  return result;
}
