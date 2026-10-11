const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const FRONT_SRC = fs.readFileSync(path.join(__dirname, '../assets/jalali.js'), 'utf8');

class FakeRange {
  constructor(sheet, row, col, nrows, ncols) {
    this.sheet = sheet; this.row = row; this.col = col; this.nrows = nrows; this.ncols = ncols;
  }
  getRow() {return this.row;}
  getValues() {
    return Array.from({length: this.nrows}, (_, i) => Array.from({length: this.ncols}, (_, j) =>
      this.sheet.rows[this.row - 1 + i]?.[this.col - 1 + j] ?? ''));
  }
  setValues(values) {
    assert.equal(values.length, this.nrows);
    for (let i = 0; i < this.nrows; i++) {
      assert.equal(values[i].length, this.ncols);
      const line = this.sheet.rows[this.row - 1 + i] || [];
      for (let j = 0; j < this.ncols; j++) line[this.col - 1 + j] = values[i][j];
      this.sheet.rows[this.row - 1 + i] = line;
    }
    return this;
  }
  setValue(value) {return this.setValues([[value]]);}
  setFontWeight() {return this;}
  setBackground() {return this;}
  setNumberFormat() {return this;}
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() {return this.rows.length;}
  getName() {return this.name;}
  getLastColumn() {return Math.max(1, ...this.rows.map(row => row.length));}
  getRange(row, col, nrows = 1, ncols = 1) {
    if (typeof row === 'string') return new FakeRange(this, 1, 1, 1, 1);
    return new FakeRange(this, row, col, nrows, ncols);
  }
  appendRow(data) { this.rows.push([...data]); return this; }
  deleteRow(row) {this.rows.splice(row - 1, 1);}
  setFrozenRows() {}
}
class FakeWorkbook {
  constructor() {this.sheets = new Map();}
  getId() {return 'SHEET_FAKE';}
  getSheetByName(name) {return this.sheets.get(name) || null;}
  insertSheet(name) {const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet;}
}

function setup() {
  const book = new FakeWorkbook();
  const clock = {ms: Date.UTC(2026, 9, 10, 12, 0, 0)};
  const props = {
    SPREADSHEET_ID: 'SHEET_FAKE',
    GOOGLE_CLIENT_ID: 'test-client-123.apps.googleusercontent.com',
    FRONTEND_ORIGIN: 'https://sample.github.io',
    ADMIN_GOOGLE_EMAIL: 'a@mail.com'
  };
  const tokens = new Map();
  const cache = new Map();
  const calls = {verify: 0, writes: 0, flush: 0, locks: 0};
  const sheetState = {currentEmail: 'a@mail.com', activeSheet: 'Daily Records', row: 2, note: 'Count failed verification', alerts: [], menus: []};
  const ui = {
    ButtonSet: {OK_CANCEL: 'OK_CANCEL'}, Button: {OK: 'OK', CANCEL: 'CANCEL'},
    prompt: () => ({getSelectedButton: () => 'OK', getResponseText: () => sheetState.note}),
    alert: (message) => {sheetState.alerts.push(message);},
    createMenu: (name) => {sheetState.menus.push(name);return {addItem: function() {return this;}, addToUi: function() {return this;}};}
  };
  class FakeDate extends Date {
    static now() {return clock.ms;}
  }
  const context = vm.createContext({
    Date: FakeDate, JSON, Math, Number, String, Boolean, RegExp, Error, Object, Array, console,
    SpreadsheetApp: {openById: (id) => {assert.equal(id, props.SPREADSHEET_ID); return book;}, flush: () => {calls.flush++;},
      getActiveSpreadsheet: () => book, getActiveSheet: () => book.getSheetByName(sheetState.activeSheet),
      getActiveRange: () => new FakeRange(book.getSheetByName(sheetState.activeSheet), sheetState.row, 1, 1, 1), getUi: () => ui},
    Session: {getActiveUser: () => ({getEmail: () => sheetState.currentEmail})},
    PropertiesService: {getScriptProperties: () => ({getProperties: () => props})},
    LockService: {getScriptLock: () => ({tryLock: (ms) => {calls.locks++; assert.equal(ms, 18000); return true;}, releaseLock: () => {}})},
    Utilities: {
      DigestAlgorithm: {SHA_256: 'SHA_256'}, Charset: {UTF_8: 'UTF_8'},
      computeDigest: (algo, token) => [...crypto.createHash('sha256').update(token).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url')
    },
    CacheService: {getScriptCache: () => ({get: key => { const item = cache.get(key); return item && item.expires > clock.ms ? item.value : null; }, put: (key, value, seconds) => cache.set(key, {value, expires: clock.ms + seconds * 1000})})},
    UrlFetchApp: {fetch: (url, options) => {
      calls.verify++;
      assert.equal(url, 'https://oauth2.googleapis.com/tokeninfo');
      assert.equal(options.method, 'post');
      const token = options.payload.id_token;
      return {getResponseCode: () => tokens.has(token) ? 200 : 401,
        getContentText: () => JSON.stringify(tokens.get(token) || {})};
    }},
    HtmlService: {XFrameOptionsMode: {ALLOWALL: 'ALLOWALL'}, createHtmlOutput: html => ({html, setXFrameOptionsMode: function () {return this;}})}
  });
  vm.runInContext(SOURCE, context);
  vm.runInContext(`globalThis.checkDay = (v) => checkDay_(v);
    globalThis.monthInfo = (y,m) => jalaliMonth_(y,m);
    globalThis.api = (user, action, args) => dispatch_(user, action, args, appProps_());
    globalThis.verifyId = (token) => verifyGoogleIdToken_(token, appProps_().GOOGLE_CLIENT_ID);
    globalThis.sheetSetup = () => setupSheets();
    globalThis.sheetReply = (origin, data) => replyToFrame_(origin,data);
    globalThis.safeText = s => safeCellText_(s);
    globalThis.dispatchPost = event => doPost(event);
    globalThis.sheetMenuOpen = () => onOpen();
    globalThis.sheetApprove = () => approveSelectedClaim();
    globalThis.sheetReject = () => rejectSelectedClaim();`, context);
  const token = (letter) => `${letter.repeat(45)}.${letter.repeat(45)}.${letter.repeat(60)}`;
  const addToken = (letter, sub) => {
    const t = token(letter);
    tokens.set(t, {aud: props.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com',
      exp: Math.floor(clock.ms / 1000) + 3600, sub, email: `${letter.toLowerCase()}@mail.com`, email_verified: 'true'});
    return t;
  };
  return {context, clock, props, tokens, book, calls, sheetState, addToken,
    A: {sub: '11111111111', email: 'a@mail.com', name: 'Alice'},
    B: {sub: '22222222222', email: 'b@mail.com', name: 'Bob'}};
}
function rows(env, name) {return env.book.getSheetByName(name).rows.slice(1);}
function api(env, user, action, args = {}) {return env.context.api(user, action, args);}
function fails(run, snippet) {assert.throws(run, err => err.message.includes(snippet));}

test('setup creates four tabs with review columns, idempotently', () => {
  const env = setup();
  assert.equal(env.context.sheetSetup(), 'Daymark sheets ready. Admin review enabled.');
  assert.equal(env.context.sheetSetup(), 'Daymark sheets ready. Admin review enabled.');
  assert.equal(env.book.sheets.size, 4);
  assert.equal(rows(env, 'Users').length, 0);
  assert.equal(env.book.getSheetByName('Users').rows[0].length, 7);
  assert.equal(env.book.getSheetByName('Daily Records').rows[0].length, 9);
  assert.equal(env.book.getSheetByName('Review Log').rows[0].length, 10);
});

test('Jalali range starts 1400/01/01 and ends 1405/12/29', () => {
  const env = setup(); env.context.sheetSetup();
  for (const day of ['1400/01/01', '1403/12/30', '1405/12/29']) assert.doesNotThrow(() => env.context.checkDay(day));
  for (const day of ['1399/12/30', '1406/01/01', '1402/12/30', '1405/12/30', '1405/13/01', '1401/01/00', '=HACK']) {
    assert.throws(() => env.context.checkDay(day));
  }
  assert.equal(env.context.monthInfo(1403, 12).days, 30);
  assert.equal(env.context.monthInfo(1405, 12).days, 29);
});

test('client Jalali and Apps Script Jalali dates agree across all 72 months', () => {
  const env = setup(); env.context.sheetSetup();
  const front = vm.createContext({window: {}, Date, Intl});
  vm.runInContext(FRONT_SRC, front);
  for (let year = 1400; year <= 1405; year++) for (let month = 1; month <= 12; month++) {
    const js = front.window.DaymarkJalali.monthInfo(year, month);
    const gas = env.context.monthInfo(year, month);
    assert.equal(js.days, gas.days, `${year}/${month}`);
    assert.equal(js.start_weekday, gas.start_weekday, `${year}/${month}`);
  }
});

test('Google ID token is verified with correct account, issuer, client ID, expiry', () => {
  const env = setup(); env.context.sheetSetup();
  const t = env.addToken('A', env.A.sub);
  assert.equal(env.context.verifyId(t).sub, env.A.sub);
  assert.equal(env.context.verifyId(t).email, env.A.email);
  assert.equal(env.calls.verify, 1, 'second call uses a bounded cache');
  env.clock.ms += 300000;
  env.tokens.get(t).aud = 'evil-client.apps.googleusercontent.com';
  fails(() => env.context.verifyId(t), 'Invalid Google');
});

test('rejects unverified email, wrong issuer, expired identity, anonymous data', () => {
  const env = setup(); env.context.sheetSetup();
  const t = env.addToken('B', env.B.sub);
  env.tokens.get(t).email_verified = false;
  fails(() => env.context.verifyId(t), 'Invalid Google');
  env.tokens.get(t).email_verified = 'true';
  env.tokens.get(t).iss = 'https://evil.example';
  fails(() => env.context.verifyId(t), 'Invalid Google');
  env.tokens.get(t).iss = 'https://accounts.google.com';
  env.tokens.get(t).exp = Math.floor(env.clock.ms / 1000) - 1;
  fails(() => env.context.verifyId(t), 'Invalid Google');
  fails(() => env.context.verifyId('spoofed'), 'Please sign in');
});

test('new Google users are saved once without passwords', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  const users = rows(env, 'Users');
  assert.equal(users.length, 2);
  assert.deepEqual(users.map(row => [row[0], row[1]]), [['11111111111', 'a@mail.com'], ['22222222222', 'b@mail.com']]);
  assert.ok(users.every(row => row.length === 7));
  assert.equal(api(env, env.A, 'bootstrap').user.is_admin, true);
  assert.equal(api(env, env.B, 'bootstrap').user.is_admin, false);
});

test('independent timers can run concurrently and refreshing cannot reset time', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap');
  const a = api(env, env.A, 'start', {day: '1403/05/01', edit: false});
  env.clock.ms += 20000;
  const b = api(env, env.A, 'start', {day: '1403/05/02', edit: false});
  assert.equal(b.timer.started_at_ms - a.timer.started_at_ms, 20000);
  env.clock.ms += 60000;
  const resumed = api(env, env.A, 'start', {day: '1403/05/01', edit: false});
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.timer.expires_at_ms, a.timer.expires_at_ms);
  const state = api(env, env.A, 'state', {year: 1403, month: 5});
  assert.equal(state.active_timers.length, 2);
  assert.equal(state.stats.active_timers, 2);
});

test('submit saves counts and cumulative total, and consumes timer', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap');
  api(env, env.A, 'start', {day: '1400/01/01', edit: false});
  const result = api(env, env.A, 'submit', {day: '1400/01/01', count: 120});
  assert.equal(result.entry.count, 120);
  assert.equal(rows(env, 'Daily Records').length, 1);
  assert.equal(rows(env, 'Active Timers').length, 0);
  const totals = rows(env, 'Users')[0];
  assert.deepEqual(totals.slice(4), [0, 0, 1], 'pending claims must not be counted as approved');
  assert.equal(rows(env, 'Daily Records')[0][5], 'PENDING');
  fails(() => api(env, env.A, 'submit', {day: '1400/01/01', count: 300}), 'three-minute');
});

test('expiration is checked against server time at submission', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap');
  api(env, env.A, 'start', {day: '1404/08/19', edit: false});
  env.clock.ms += 180000;
  fails(() => api(env, env.A, 'submit', {day: '1404/08/19', count: 3}), 'expired');
  assert.equal(rows(env, 'Daily Records').length, 0);
  const restart = api(env, env.A, 'start', {day: '1404/08/19', edit: false});
  assert.equal(restart.resumed, false);
  api(env, env.A, 'submit', {day: '1404/08/19', count: 3});
  assert.equal(rows(env, 'Daily Records').length, 1);
});

test('editing a saved record requires new timer and does not create duplicate rows', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap');
  api(env, env.A, 'start', {day: '1405/11/19', edit: false});
  api(env, env.A, 'submit', {day: '1405/11/19', count: 10});
  fails(() => api(env, env.A, 'start', {day: '1405/11/19', edit: false}), 'already submitted');
  env.clock.ms += 3000;
  api(env, env.A, 'start', {day: '1405/11/19', edit: true});
  api(env, env.A, 'submit', {day: '1405/11/19', count: 20});
  assert.equal(rows(env, 'Daily Records').length, 1);
  assert.equal(rows(env, 'Users')[0][4], 0);
  assert.equal(rows(env, 'Users')[0][5], 0);
  assert.equal(rows(env, 'Users')[0][6], 1);
  fails(() => api(env, env.A, 'start', {day: '1405/11/20', edit: true}), 'not been submitted');
});

test('global date claims prevent other accounts from reserving the same day', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  api(env, env.A, 'start', {day: '1401/09/11', edit: false});
  fails(() => api(env, env.B, 'start', {day: '1401/09/11', edit: false}), 'Someone else');
  fails(() => api(env, env.B, 'submit', {day: '1401/09/11', count: 555}), 'three-minute');
  api(env, env.A, 'submit', {day: '1401/09/11', count: 90});
  fails(() => api(env, env.B, 'start', {day: '1401/09/11', edit: false}), 'claimed');
  const beforeReview = api(env, env.B, 'state', {year: 1401, month: 9});
  assert.equal(beforeReview.entries['1401/09/11'], undefined);
  assert.equal(beforeReview.occupied['1401/09/11'].status, 'PENDING');
  api(env, env.B, 'start', {day: '1401/09/12', edit: false});
  api(env, env.B, 'submit', {day: '1401/09/12', count: 30});
  assert.equal(api(env, env.A, 'state', {year: 1401, month: 9}).entries['1401/09/12'], undefined);
  assert.equal(api(env, env.B, 'state', {year: 1401, month: 9}).entries['1401/09/12'].count, 30);
  assert.equal(api(env, env.A, 'state', {year: 1401, month: 9}).stats.pending_days, 1);
  assert.equal(api(env, env.B, 'state', {year: 1401, month: 9}).stats.pending_days, 1);
  assert.equal(api(env, env.A, 'state', {year: 1401, month: 9}).stats.total_data, 0);
});

test('cancelling a timer releases a date for other users', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  api(env, env.A, 'start', {day: '1402/01/07', edit: false});
  fails(() => api(env, env.B, 'start', {day: '1402/01/07', edit: false}), 'Someone else');
  api(env, env.A, 'cancel', {day: '1402/01/07'});
  assert.equal(rows(env, 'Active Timers').length, 0);
  api(env, env.B, 'start', {day: '1402/01/07', edit: false});
  fails(() => api(env, env.A, 'start', {day: '1402/01/07', edit: false}), 'Someone else');
  assert.equal(rows(env, 'Active Timers')[0][0], env.B.sub);
});

test('history paginates and exports only the verified user records', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  for (let i = 1; i <= 5; i++) {
    const day = `1403/07/${String(i).padStart(2, '0')}`;
    api(env, env.A, 'start', {day, edit: false});
    api(env, env.A, 'submit', {day, count: i});
  }
  api(env, env.B, 'start', {day: '1403/07/10', edit: false});
  api(env, env.B, 'submit', {day: '1403/07/10', count: 999});
  const claim = rows(env, 'Daily Records')[0];
  api(env, env.A, 'adminReview', {subject: env.A.sub, day: claim[1], decision: 'APPROVE', expected_updated_at_ms: claim[4]});
  const history = api(env, env.A, 'history', {year: 1403, page: 2, pageSize: 2});
  assert.equal(history.entry_count, 5);
  assert.equal(history.total_count, 1);
  assert.equal(history.pending_count, 4);
  assert.equal(history.total_pages, 3);
  assert.deepEqual(Array.from(history.entries, row => row.day), ['1403/07/03','1403/07/02']);
  assert.equal(api(env, env.A, 'history', {year: 1402}).entry_count, 0);
  assert.equal(api(env, env.B, 'history', {year: 1403}).entry_count, 1);
  assert.equal(api(env, env.B, 'history', {year: 1403}).total_count, 0);
});

test('server rejects impossible counts and unauthorized operations', () => {
  const env = setup(); env.context.sheetSetup(); api(env, env.A, 'bootstrap');
  api(env, env.A, 'start', {day: '1400/06/20', edit: false});
  for (const count of [-1, 1.5, '99', 1000000000, null, NaN]) {
    fails(() => api(env, env.A, 'submit', {day: '1400/06/20', count}), 'Count must');
  }
  fails(() => api(env, env.A, 'erase-all', {}), 'Unknown API');
  fails(() => api(env, env.A, 'history', {pageSize: 201}), 'Invalid page');
});

test('response HTML escapes script injection and targets only the configured origin', () => {
  const env = setup();
  const content = env.context.sheetReply(env.props.FRONTEND_ORIGIN,
    {requestId: 'r'.repeat(40), name: '</script><script>alert(1)</script>'}).html;
  assert.ok(content.includes('window.top.postMessage('));
  assert.ok(content.includes('https://sample.github.io'));
  assert.ok(!content.includes('</script><script>alert'));
  assert.ok(content.includes('\\u003c'));
  assert.ok(env.context.safeText('=IMPORTXML("abc")').startsWith("'"));
});

test('Web App doPost verifies the token and binds writes to the Google identity', () => {
  const env = setup(); env.context.sheetSetup();
  const token = env.addToken('Q', env.A.sub);
  const event = {
    parameter: {request_id: 'r'.repeat(40), origin: env.props.FRONTEND_ORIGIN,
      payload: JSON.stringify({idToken: token, action: 'bootstrap', args: {sub: env.B.sub}})}
  };
  const response = env.context.dispatchPost(event);
  assert.ok(response.html.includes('"ok":true'));
  assert.equal(rows(env, 'Users')[0][0], env.A.sub);
  event.parameter.origin = 'https://attacker.invalid';
  assert.ok(env.context.dispatchPost(event).html.includes('"status":403'));
});

function submit(env, user, day, count) {
  api(env, user, 'start', {day, edit: false});
  return api(env, user, 'submit', {day, count});
}
function review(env, day, decision, note = '', user = null) {
  const found = rows(env, 'Daily Records').find(row => row[1] === day && (!user || row[0] === user.sub));
  assert.ok(found, 'claim exists before admin decision');
  return api(env, env.A, 'adminReview', {subject: found[0], day, decision,
    expected_updated_at_ms: found[4], note});
}

test('administrator approves a pending claim and approved totals update for its owner only', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1404/01/21', 55);
  assert.equal(api(env, env.B, 'history').entries[0].status, 'PENDING');
  review(env, '1404/01/21', 'APPROVE');
  const stats = api(env, env.B, 'state', {year: 1404, month: 1}).stats;
  assert.equal(stats.total_data, 55);
  assert.equal(stats.completed_days, 1);
  assert.equal(stats.pending_days, 0);
  assert.equal(api(env, env.B, 'history').entries[0].status, 'APPROVED');
  assert.equal(rows(env, 'Users')[1][4], 55);
  assert.equal(rows(env, 'Users')[0][4], 0);
  assert.equal(rows(env, 'Review Log').length, 1);
  assert.equal(rows(env, 'Review Log')[0][3], 'APPROVED');
  fails(() => api(env, env.B, 'start', {day:'1404/01/21', edit:true}), 'locked');
  fails(() => api(env, env.A, 'start', {day:'1404/01/21', edit:false}), 'claimed');
});

test('admin rejection deletes user history, removes approved totals, releases day and records reason', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1403/12/30', 145);
  review(env, '1403/12/30', 'APPROVE');
  const result = review(env, '1403/12/30', 'REJECT', 'Reported count differs from verified extraction');
  assert.equal(result.decision, 'REJECT');
  assert.equal(rows(env, 'Daily Records').length, 0);
  assert.equal(api(env, env.B, 'history').entry_count, 0);
  assert.equal(api(env, env.B, 'state', {year: 1403, month: 12}).stats.total_data, 0);
  assert.equal(rows(env, 'Users')[1][5], 0);
  assert.equal(rows(env, 'Review Log').length, 2);
  assert.equal(rows(env, 'Review Log')[1][3], 'REJECTED');
  assert.equal(rows(env, 'Review Log')[1][8], 'Reported count differs from verified extraction');
  assert.equal(api(env, env.A, 'state', {year: 1403, month: 12}).occupied['1403/12/30'], undefined);
  submit(env, env.A, '1403/12/30', 120);
  assert.equal(rows(env, 'Daily Records').length, 1);
  assert.equal(rows(env, 'Daily Records')[0][0], env.A.sub);
});

test('admin can reject pending claim without approval, freeing the date immediately', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1401/05/17', 6);
  review(env, '1401/05/17', 'REJECT', 'Count is not supported');
  assert.equal(api(env, env.B, 'history').entry_count, 0);
  assert.equal(api(env, env.B, 'state', {year:1401, month:5}).entries['1401/05/17'], undefined);
  assert.equal(api(env, env.A, 'state', {year:1401, month:5}).occupied['1401/05/17'], undefined);
  submit(env, env.A, '1401/05/17', 9);
});

test('admin queue lists verified users and filters pending / approved / name / date', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.A, '1405/02/05', 11);
  submit(env, env.B, '1405/02/06', 12);
  const all = api(env, env.A, 'adminQueue', {status: 'ALL'});
  assert.equal(all.stats.pending, 2);
  assert.equal(all.entry_count, 2);
  const found = api(env, env.A, 'adminQueue', {status: 'PENDING', query: 'b@mail.com'});
  assert.equal(found.entry_count, 1);
  assert.equal(found.entries[0].day, '1405/02/06');
  assert.equal(api(env, env.A, 'adminQueue', {query: '1405/02/05'}).entry_count, 1);
  review(env, '1405/02/05', 'APPROVE');
  const approved = api(env, env.A, 'adminQueue', {status: 'APPROVED'});
  assert.equal(approved.entry_count, 1);
  assert.equal(approved.stats.pending, 1);
  assert.equal(approved.stats.approved, 1);
  fails(() => api(env, env.B, 'adminQueue', {}), 'Administrator access');
  fails(() => api(env, env.B, 'adminReview', {decision:'REJECT'}), 'Administrator access');
});

test('administrator decision validates reason, identity, record revision, and refuses replay', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1400/01/02', 6);
  const row = rows(env, 'Daily Records')[0];
  const args = {subject: env.B.sub, day: '1400/01/02', expected_updated_at_ms: row[4]};
  fails(() => api(env, env.A, 'adminReview', {...args, decision: 'REJECT', note: ''}), 'rejection reason');
  fails(() => api(env, env.A, 'adminReview', {...args, decision: 'REJECT', note: '=SUM(A1)' .repeat(200)}), 'Admin note');
  fails(() => api(env, env.A, 'adminReview', {...args, expected_updated_at_ms: row[4] - 1, decision: 'APPROVE'}), 'edited');
  fails(() => api(env, env.A, 'adminReview', {...args, subject: '123', decision: 'APPROVE'}), 'Invalid Google Subject');
  assert.equal(rows(env, 'Review Log').length, 0);
  api(env, env.A, 'adminReview', {...args, decision: 'APPROVE'});
  fails(() => api(env, env.A, 'adminReview', {...args, decision: 'APPROVE'}), 'already approved');
  assert.equal(rows(env, 'Review Log').length, 1);
});

test('admin approval invalidates an in-progress edit timer without changing accepted count', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1404/06/09', 13);
  api(env, env.B, 'start', {day:'1404/06/09', edit:true});
  assert.equal(rows(env, 'Active Timers').length, 1);
  review(env, '1404/06/09', 'APPROVE');
  assert.equal(rows(env, 'Active Timers').length, 0);
  fails(() => api(env, env.B, 'submit', {day:'1404/06/09', count: 999}), 'three-minute');
  assert.equal(api(env, env.B, 'state', {year:1404, month:6}).entries['1404/06/09'].count, 13);
});

test('expired timers no longer block other users, independently of visible stale timers', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  api(env, env.A, 'start', {day:'1405/10/02', edit:false});
  env.clock.ms += 180001;
  assert.equal(api(env, env.B, 'state', {year:1405, month:10}).occupied['1405/10/02'], undefined);
  submit(env, env.B, '1405/10/02', 66);
  fails(() => api(env, env.A, 'start', {day:'1405/10/02', edit:false}), 'claimed');
});

test('migration from old three-tab sheet preserves claims but marks all legacy rows pending review', () => {
  const env = setup();
  env.book.insertSheet('Users').appendRow(['Google Subject','Email','Display Name','Joined UTC','Total Data','Completed Days']);
  env.book.getSheetByName('Users').appendRow([env.B.sub, env.B.email, env.B.name, '2026-10-01T00:00:00Z', 40, 1]);
  env.book.insertSheet('Daily Records').appendRow(['Google Subject','Jalali Date','Data Count','Created UTC ms','Updated UTC ms']);
  env.book.getSheetByName('Daily Records').appendRow([env.B.sub,'1402/02/17',40,env.clock.ms,env.clock.ms]);
  env.book.insertSheet('Active Timers').appendRow(['Google Subject','Jalali Date','Started UTC ms','Expires UTC ms','Mode']);
  const first = env.context.sheetSetup();
  const second = env.context.sheetSetup();
  assert.equal(first, 'Daymark sheets ready. Admin review enabled.');
  assert.equal(second, first);
  assert.equal(env.book.sheets.size, 4);
  assert.equal(rows(env,'Daily Records').length, 1);
  assert.equal(rows(env,'Daily Records')[0][5], 'PENDING');
  assert.deepEqual(rows(env,'Users')[0].slice(4), [0, 0, 1]);
  assert.equal(rows(env,'Review Log').length, 0);
  api(env, env.A, 'bootstrap');
  review(env, '1402/02/17', 'APPROVE');
  assert.deepEqual(rows(env, 'Users')[0].slice(4), [40, 1, 0]);
});

test('conflicting claims migrated from the old sheet must be resolved before approval', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  const table = env.book.getSheetByName('Daily Records');
  table.appendRow([env.A.sub,'1403/02/01',1,env.clock.ms,env.clock.ms,'PENDING','','','']);
  table.appendRow([env.B.sub,'1403/02/01',2,env.clock.ms,env.clock.ms,'PENDING','','','']);
  fails(() => review(env, '1403/02/01', 'APPROVE', '', env.A), 'conflicting claims');
  review(env, '1403/02/01', 'REJECT', 'Duplicate legacy claim', env.B);
  review(env, '1403/02/01', 'APPROVE', '', env.A);
  assert.equal(rows(env,'Daily Records').length, 1);
  assert.equal(rows(env,'Review Log').length, 2);
});

test('doPost admin operations authorize against verified Google token, never claimed client identity', () => {
  const env = setup(); env.context.sheetSetup();
  const tokenB = env.addToken('B', env.B.sub);
  const tokenA = env.addToken('A', env.A.sub);
  const request = (token, action, args) => env.context.dispatchPost({parameter:{
    request_id:'s'.repeat(40), origin:env.props.FRONTEND_ORIGIN,
    payload:JSON.stringify({idToken:token, action, args})
  }}).html;
  assert.ok(request(tokenB,'adminQueue',{}).includes('"status":403'));
  assert.ok(request(tokenB,'bootstrap',{}).includes('"is_admin":false'));
  assert.ok(request(tokenA,'bootstrap',{}).includes('"is_admin":true'));
  submit(env, env.B, '1400/01/02', 15);
  assert.ok(request(tokenB,'adminReview',{subject:env.B.sub, day:'1400/01/02', decision:'APPROVE', expected_updated_at_ms:env.clock.ms}).includes('"status":403'));
  assert.equal(rows(env,'Daily Records')[0][5],'PENDING');
});

test('administrator can approve from the native Google Sheet menu', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1405/12/29', 110);
  env.context.sheetMenuOpen();
  assert.ok(env.sheetState.menus.includes('Daymark review'));
  const done = env.context.sheetApprove();
  assert.equal(done.decision, 'APPROVE');
  assert.equal(rows(env,'Daily Records')[0][5], 'APPROVED');
  assert.equal(rows(env,'Users')[1][4], 110);
  assert.ok(env.sheetState.alerts[0].includes('Approved'));
  assert.equal(rows(env, 'Review Log').length, 1);
});

test('Sheet native rejection removes a formerly approved claim and cannot be used by an unverified editor', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1403/01/11', 33);
  env.context.sheetApprove();
  env.sheetState.currentEmail = 'b@mail.com';
  fails(() => env.context.sheetReject(), 'Only the configured administrator');
  env.sheetState.currentEmail = 'a@mail.com';
  env.sheetState.note = 'Incorrect record count';
  const outcome = env.context.sheetReject();
  assert.equal(outcome.decision, 'REJECT');
  assert.equal(rows(env,'Daily Records').length, 0);
  assert.equal(rows(env,'Users')[1][4], 0);
  assert.equal(rows(env,'Review Log')[1][8], 'Incorrect record count');
});

test('optional admin sub pin is checked even when the verified email matches', () => {
  const env = setup(); env.context.sheetSetup();
  env.props.ADMIN_GOOGLE_SUB = env.B.sub;
  api(env, env.A, 'bootstrap');
  assert.equal(api(env, env.A, 'bootstrap').user.is_admin, false);
  fails(() => api(env, env.A, 'adminQueue'), 'Administrator access');
  env.props.ADMIN_GOOGLE_SUB = env.A.sub;
  assert.equal(api(env, env.A, 'bootstrap').user.is_admin, true);
});

test('editing pending counts in the same millisecond advances their revision', () => {
  const env = setup(); env.context.sheetSetup();
  api(env, env.A, 'bootstrap'); api(env, env.B, 'bootstrap');
  submit(env, env.B, '1400/03/11', 10);
  const before = rows(env,'Daily Records')[0][4];
  api(env, env.B, 'start', {day:'1400/03/11', edit:true});
  api(env, env.B, 'submit', {day:'1400/03/11', count:17});
  const after = rows(env,'Daily Records')[0][4];
  assert.equal(after, before + 1);
  fails(() => api(env, env.A, 'adminReview', {
    subject: env.B.sub, day:'1400/03/11', decision:'APPROVE', expected_updated_at_ms:before
  }), 'edited');
});
