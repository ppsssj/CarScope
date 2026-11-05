import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createToast, MOBILE_REQUEST_TEXT, TOAST_MS } from '../inspection-toast.mjs';

function fakeElement() {
  const classes = new Set();
  return { textContent: '', on: () => classes.has('on'), classList: {
    toggle: (name, value) => { if (value) classes.add(name); else classes.delete(name); },
    remove: (name) => classes.delete(name),
  } };
}
function withToast(run) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try { const el = fakeElement(); run(el, createToast(el, { setTimer: setTimeout, clearTimer: clearTimeout }), (ms) => mock.timers.tick(ms)); }
  finally { mock.timers.reset(); }
}

for (const outcome of Object.keys(MOBILE_REQUEST_TEXT)) {
  test(`mobile request toast disappears after the fixed time (${outcome})`, () => withToast((el, show, tick) => {
    show(MOBILE_REQUEST_TEXT[outcome]);
    assert.equal(el.on(), true);
    assert.equal(el.textContent, MOBILE_REQUEST_TEXT[outcome]);
    tick(TOAST_MS - 1);
    assert.equal(el.on(), true);
    tick(1);
    assert.equal(el.on(), false);
  }));
}

test('a repeated message restarts the time; the first timer cannot hide it early', () => withToast((el, show, tick) => {
  show('first');
  tick(TOAST_MS - 1);
  show('second');
  tick(1);
  assert.equal(el.on(), true, 'first timer was cancelled');
  assert.equal(el.textContent, 'second');
  tick(TOAST_MS - 2);
  assert.equal(el.on(), true);
  tick(1);
  assert.equal(el.on(), false);
}));

test('a transition without a message clears the toast and leaves no timer behind', () => withToast((el, show, tick) => {
  show('request');
  tick(1000);
  show(undefined);
  assert.equal(el.on(), false);
  assert.equal(el.textContent, '');
  show('hint');
  tick(TOAST_MS - 1);
  assert.equal(el.on(), true, 'request timer does not touch the later hint');
  assert.equal(el.textContent, 'hint');
}));

test('request messages claim only the confirmed step', () => {
  const { SENDING, ACCEPTED, ACCEPTED_ACTIVE_BINDING, REJECTED, FAILED, IN_FLIGHT, NOT_CONNECTED } = MOBILE_REQUEST_TEXT;
  assert.match(ACCEPTED, /세션 생성 전/);
  for (const text of Object.values(MOBILE_REQUEST_TEXT)) assert.doesNotMatch(text, /QR.*(생성|완료)|성공|연결됐|세션이 생성/, text);
  for (const text of [SENDING, REJECTED, FAILED, IN_FLIGHT, NOT_CONNECTED]) assert.doesNotMatch(text, /접수/, text);
  for (const text of [REJECTED, FAILED, NOT_CONNECTED, IN_FLIGHT]) assert.doesNotMatch(text, /다른 부품/, 'never names a cause the page cannot confirm');
  assert.notEqual(REJECTED, FAILED);
  assert.ok(ACCEPTED_ACTIVE_BINDING);
});

test('inspect.js has a single toast owner', () => {
  const source = readFileSync(new URL('../inspect.js', import.meta.url), 'utf8');
  assert.equal(source.match(/\$\(\s*['"]toast['"]\s*\)/g).length, 1);
  assert.match(source, /createToast\(\$\('toast'\)\)/);
  assert.match(source, /createMobileRequestNotifier\(\{ request: \(taskId\) => mobileResults\.request\(taskId\), show: showToast, screen: \(\) => state \}\)/);
  assert.match(source, /a==='request-mobile'\)void requestMobile\(b\.dataset\.task\)/);
  assert.match(source, /showToast\(hints\[state\.name\]\)/);
});
