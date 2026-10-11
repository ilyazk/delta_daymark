const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function browser() {
  const source = fs.readFileSync(path.join(__dirname, '../assets/rpc.js'), 'utf8');
  const listeners = {};
  const created = [];
  const window = {
    DAYMARK_CONFIG: {APPS_SCRIPT_URL:'https://script.google.com/macros/s/'+'a'.repeat(40)+'/exec'},
    addEventListener: (name, fn) => {listeners[name] = fn;}
  };
  const document = {
    body: {appendChild: el => {created.push(el);}},
    createElement: tag => ({tagName: tag, children: [], style: {}, setAttribute() {},
      appendChild(el) {this.children.push(el);}, remove() {this.removed = true;}, submit() {this.submitted = true;}})
  };
  const context = vm.createContext({window, URL, document, location: {origin: 'https://sample.github.io'},
    crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout, console});
  vm.runInContext(source, context);
  return {api: window.DaymarkBridge, listeners, created};
}

test('transport accepts ONLY actual Google Script response origins', () => {
  const {api} = browser();
  for (const origin of ['https://script.google.com', 'https://script.googleusercontent.com', 'https://n-abcdef-script.googleusercontent.com']) {
    assert.equal(api.isGoogleScriptOrigin(origin), true, origin);
  }
  for (const origin of ['https://evil.com', 'http://script.google.com', 'https://fake-script.googleusercontent.com.evil.com', 'https://google.com', 'not-a-url']) {
    assert.equal(api.isGoogleScriptOrigin(origin), false, origin);
  }
});

test('request transports a Google credential using a form POST and validates correlation', async () => {
  const {api, listeners, created} = browser();
  api.setTokenProvider(() => 'test.jwt.token');
  const waiting = api.request('state', {year: 1405, month: 7});
  const form = created.find(el => el.tagName === 'form');
  assert.equal(form.method, 'POST');
  assert.equal(form.submitted, true);
  const fields = Object.fromEntries(form.children.map(input => [input.name, input.value]));
  assert.equal(JSON.parse(fields.payload).action, 'state');
  assert.equal(JSON.parse(fields.payload).idToken, 'test.jwt.token');
  const frame = created.find(el => el.tagName === 'iframe');
  listeners.message({origin: 'https://evil.com', data: {channel: 'daymark:response:v2',requestId: fields.request_id,ok:true,status:200,data: {secret:'fake'}}});
  assert.ok(!frame.removed, 'untrusted response ignored');
  listeners.message({origin: 'https://n-xyz-script.googleusercontent.com', data: {channel:'daymark:response:v2', requestId: fields.request_id,ok:true,status:200,data:{stats:{total_data:123}}}});
  assert.equal((await waiting).stats.total_data, 123);
  assert.equal(frame.removed, true);
});

test('transport refuses unsupported operations and requests without a Google token', async () => {
  const {api} = browser();
  await assert.rejects(api.request('deleteAll'), /Unknown operation/);
  await assert.rejects(api.request('state'), /Sign in using Google/);
});
