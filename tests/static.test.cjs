const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const known = new Set(ids);

test('every HTML id is unique', () => {
  assert.equal(ids.length, known.size);
});

test('all client-rendered panels are present', () => {
  for (const id of ['login-screen','dashboard','history-screen','google-signin-button',
    'calendar-grid','timer-list','stat-total','stat-days','stat-active','toast',
    'history-table-body','history-error','export-csv','login-help',
    'admin-screen','admin-table-body','admin-pending','admin-approved','admin-rejected',
    'admin-error','admin-status','admin-search-form','admin-search','admin-refresh','refresh-calendar']) assert.ok(known.has(id),id);
});

test('JavaScript hardcoded getElementById and querySelector ids exist', () => {
  for (const asset of ['auth.js','history.js','dashboard.js','admin.js']) {
    const js = fs.readFileSync(path.join(root,'assets',asset),'utf8');
    for (const match of js.matchAll(/\$\(["']#?([a-z][a-z0-9-]+)["']\)/gi)) {
      assert.ok(known.has(match[1]), `${asset} references missing HTML id ${match[1]}`);
    }
  }
});


test('Apps Script manifest explicitly grants spreadsheet review UI and active user email scopes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps-script', 'appsscript.json'),'utf8'));
  for (const scope of ['https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/spreadsheets']) {
    assert.ok(manifest.oauthScopes.includes(scope), scope);
  }
});
