import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createToast, mobileRequestToast, TOAST_MS } from '../inspection-toast.mjs';

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

for (const started of [true, false]) {
  test(`mobile request toast disappears after the fixed time (started=${started})`, () => withToast((el, show, tick) => {
    show(mobileRequestToast(started));
    assert.equal(el.on(), true);
    assert.equal(el.textContent, mobileRequestToast(started));
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

test('starting a request does not claim a created session or a verified connection', () => {
  const started = mobileRequestToast(true);
  assert.match(started, /세션 생성 전/);
  assert.doesNotMatch(started, /생성을 요청|연결 응답|성공|완료/);
  assert.match(mobileRequestToast(false), /시작할 수 없습니다/);
});

test('inspect.js has a single toast owner', () => {
  const source = readFileSync(new URL('../inspect.js', import.meta.url), 'utf8');
  assert.equal(source.match(/\$\(\s*['"]toast['"]\s*\)/g).length, 1);
  assert.match(source, /createToast\(\$\('toast'\)\)/);
  assert.match(source, /showToast\(mobileRequestToast\(mobileResults\.request\(b\.dataset\.task\),mobileResults\.snapshot\.connection\)\)/);
  assert.match(source, /showToast\(hints\[state\.name\]\)/);
});
