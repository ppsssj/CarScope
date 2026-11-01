// Real AR-01 DOM + real sync HTTP + SQLite; one-machine synthetic E2E, never phone/Android HTTPS evidence.
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startMobileDevServer } from '../src/mobile-dev-server.mjs';
import { SQLiteSessionStore } from '../src/sqlite-store.mjs';
import { LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { ReceiverClient } from '../bin/receiver.mjs';
const require = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url));
const { chromium } = require('playwright');
const output = process.env.SYNC_EVIDENCE_DIR;
if (!output || !path.isAbsolute(output) || !path.resolve(output).toLowerCase().startsWith('c:\\carscope-external\\')) throw new Error('Set external SYNC_EVIDENCE_DIR under C:/CarScope-External');
await mkdir(output, { recursive: true });
const db = path.join(await mkdtemp(path.join(output, 'sqlite-')), 'sync.sqlite');
let now = Date.now(), store, server;
const start = async (port = 0) => {
  store = new SQLiteSessionStore({ filename: db });
  server = await startMobileDevServer({ port, store, now: () => now, authorizer: new LocalTestSessionCreationAuthorizer() });
};
await start();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [];
const pass = (name) => { checks.push(name); console.log(`PASS: ${name}`); };
let context, page, secrets, urls, claimCount, submitCount;
async function open(fragment = '') {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  secrets = []; urls = []; claimCount = 0; submitCount = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { urls.push(r.url()); if (r.url().endsWith('/v1/claim')) claimCount++; if (r.url().endsWith('/v1/submissions')) submitCount++; });
  await page.goto(server.url + '/' + fragment);
  await page.waitForFunction(() => window.__selfInspection);
}
async function pair({ claim = true, prepare } = {}) {
  // Each independent scenario uses a fresh rate window; do not raise production/test limit thresholds.
  now += 61_000;
  const receiver = new ReceiverClient({ baseUrl: server.url }), session = await receiver.create();
  const invite = session.fragment.split('invite=')[1];
  await open(session.fragment); secrets.push(invite);
  assert.equal(new URL(page.url()).hash, '');
  if (prepare) await prepare();
  if (claim) {
    await page.locator('#sync-claim').evaluate((b) => { b.click(); b.click(); });
    await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됨'));
    assert.equal(claimCount, 1);
  }
  return { receiver, session, invite };
}
async function complete() {
  await page.click('#manual-start');
  await page.locator('#checklist input').evaluateAll((boxes) => boxes.forEach((b) => b.click()));
  await page.click('#primary'); await page.click('[data-status="NEEDS_REFILL"]'); await page.click('#primary'); await page.click('#primary');
  await page.waitForSelector('body[data-step="done"]');
}
const waitState = (state) => page.waitForFunction((s) => document.getElementById('done-sync').dataset.syncState === s, state);
const send = async () => { await page.locator('#sync-send').evaluate((b) => { b.click(); b.click(); }); };
async function noLeak() {
  const html = await page.content();
  for (const secret of secrets) { assert.ok(!html.includes(secret)); assert.ok(urls.every((u) => !u.includes(secret))); }
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

try {
  for (const fragment of ['', '#v=1&task=washer-fluid']) {
    await open(fragment); assert.equal(await page.locator('#sync-send').count(), 0); assert.equal(await page.locator('#manual-start').isEnabled(), true);
  }
  pass('direct/v1 preserve local-only AR-01; no sync controls');
  await open('#v=2&task=washer-fluid&invite=bad');
  assert.equal(new URL(page.url()).hash, ''); assert.equal(await page.locator('#manual-start').isEnabled(), false);
  pass('invalid v2 blocks inspection and clears malformed fragment');

  let paired = await pair();
  assert.equal(await page.locator('#sync-send').isVisible(), false); await complete();
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, '01-completed-not-sent.png'), fullPage: true });
  assert.equal(await page.locator('#sync-send').isEnabled(), true); await send(); await waitState('SENT');
  assert.equal(submitCount, 1); assert.equal((await paired.receiver.view()).sessionState, 'RESULT_SUBMITTED');
  assert.equal(await page.evaluate(() => window.__selfInspection.state.record.sync), 'NOT_SENT');
  await noLeak(); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, '02-server-received.png'), fullPage: true });
  pass('actual AR-01 checklist→completion→double SEND→verified receipt; SENT remains distinct from ACCEPTED');
  const view = await paired.receiver.view(); await paired.receiver.accept(view.resultDigest);
  await page.click('#sync-refresh'); await waitState('ACCEPTED'); await noLeak();
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, '03-accepted.png'), fullPage: true });
  pass('receiver exact-digest acceptance appears in mobile through server polling');
  await page.reload(); assert.equal(await page.locator('#sync-send').count(), 0);
  assert.equal(await page.evaluate(() => window.__selfInspection.state.record), null);
  pass('reload cannot restore tokens, claim or a transmitted success');
  await open(paired.session.fragment); await page.click('#sync-claim');
  await page.waitForFunction(() => document.body.textContent.includes('새 QR을 요청'));
  assert.equal(claimCount, 1); assert.equal(await page.locator('#sync-claim').isEnabled(), false);
  pass('used QR rejected with new-QR guidance');

  paired = await pair(); await complete(); await send(); await waitState('SENT'); await paired.receiver.cancel();
  await page.click('#sync-refresh'); await waitState('CANCELLED');
  assert.equal(await page.locator('#sync-send').isEnabled(), false); pass('receiver CANCELLED disables resend');

  paired = await pair(); now = paired.session.expiresAt + 1;
  await waitState('REJECTED_EXPIRED');
  pass('session expiry is displayed separately from cancellation');

  paired = await pair({ claim: false, prepare: async () => {
    await page.route('**/v1/claim', async (route) => { await route.fetch(); await route.abort('failed'); });
  } });
  await page.click('#sync-claim'); await page.waitForFunction(() => document.body.textContent.includes('새 QR'));
  assert.equal(claimCount, 1); assert.equal(await page.locator('#sync-claim').isEnabled(), false); await noLeak();
  pass('lost committed Claim response never re-claims; asks vehicle for new QR');

  paired = await pair(); await complete(); await context.setOffline(true); await send(); await waitState('FAILED_NETWORK');
  await context.setOffline(false); await page.click('#sync-send'); await waitState('SENT');
  assert.equal((await paired.receiver.view()).sessionState, 'RESULT_SUBMITTED');
  pass('offline failure then bounded identical-record retry reaches server receipt');

  paired = await pair(); await complete();
  const retryBodies = []; let lostSubmit = false;
  await page.route('**/v1/submissions', async (route) => {
    retryBodies.push(route.request().postData());
    if (!lostSubmit) { lostSubmit = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await send(); await waitState('SENT'); assert.equal(submitCount, 2); assert.equal(retryBodies[0], retryBodies[1]);
  pass('lost committed submit response retries the identical record and verifies idempotent receipt');

  paired = await pair(); await complete();
  await page.route('**/v1/submissions', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL"}}' }));
  await send(); await waitState('FAILED_NETWORK'); assert.equal(submitCount, 3);
  await page.unroute('**/v1/submissions'); await page.click('#sync-send'); await waitState('SENT');
  pass('HTTP 500 never reports success; retries are bounded and recover with same record');

  paired = await pair(); await complete();
  await page.route('**/v1/submissions', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"code":"RATE_LIMITED"}}' }));
  await send(); await waitState('RATE_LIMITED'); assert.equal(submitCount, 1);
  pass('429 has distinct state and no automatic submission retry');

  paired = await pair(); await complete();
  await page.route('**/v1/submissions', async (route) => {
    const response = await route.fetch(), body = await response.json(); body.receipt.resultDigest = 'sha256:' + '0'.repeat(64);
    await route.fulfill({ response, json: body });
  });
  await send(); await waitState('FAILED_NETWORK');
  assert.ok(!(await page.locator('#done-sync').textContent()).includes('서버 수신 확인')); pass('2xx with wrong Digest is never SENT');

  paired = await pair(); await complete(); await send(); await waitState('SENT');
  const port = Number(new URL(server.url).port); await server.stop(); store.close(); await start(port);
  let restored;
  try { restored = await paired.receiver.view(); }
  catch (error) { if (error.cause?.code !== 'ECONNRESET' && error.cause?.code !== 'UND_ERR_SOCKET') throw error; restored = await paired.receiver.view(); }
  assert.equal(restored.sessionState, 'RESULT_SUBMITTED');
  await paired.receiver.accept(restored.resultDigest); await page.click('#sync-refresh'); await waitState('ACCEPTED');
  pass('SQLite/API restart preserves result and receiver authority; mobile sees subsequent ACCEPTED');

  paired = await pair(); await complete();
  await page.route('**/v1/submissions', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"UNAUTHORIZED"}}' }));
  await send(); await waitState('REJECTED_UNAUTHORIZED'); assert.equal(await page.locator('#sync-send').isEnabled(), false);
  pass('invalid token/401 remains authentication failure without fallback');
  assert.deepEqual(errors, []);
  pass('all module imports obey same-origin CSP; no page errors and mobile layout stays within viewport');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('Page errors:', errors);
  throw error;
} finally {
  await writeFile(path.join(output, 'mobile-summary.json'), JSON.stringify({ kind: 'NODE_PLAYWRIGHT_SQLITE_SYNTHETIC', checks, errors, browser: browser.version(), realAndroid: 'BLOCKED', realPhoneHttps: 'BLOCKED' }, null, 2));
  await browser.close(); await server.stop(); store.close();
}
