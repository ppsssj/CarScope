// P15 browser check of the account pages in real Chrome (Playwright, system Chrome), against the local account server
// and a LOCAL Supabase stack. Google is not involved: the local stack has the Google provider off, and signed-in
// states use email/password users created on the local stack, whose stored session is placed in localStorage the
// way supabase-js would store it after a Google login. Evidence goes outside the repository.
//
//   CARSCOPE_EVIDENCE_DIR=C:\CarScope-External\p15-auth
//   CARSCOPE_LOCAL_SUPABASE_URL=http://127.0.0.1:54321  CARSCOPE_LOCAL_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { createAccountServer } from '../serve.mjs';
import { AUTH_STORAGE_KEY, clientOptions } from '../web/lib/account-runtime.mjs';

const out = process.env.CARSCOPE_EVIDENCE_DIR;
if (!out || !isAbsolute(out) || !resolve(out).toLowerCase().startsWith('c:\\carscope-external\\')) throw new Error('Set CARSCOPE_EVIDENCE_DIR under C:\\CarScope-External\\');
const SB = process.env.CARSCOPE_LOCAL_SUPABASE_URL, KEY = process.env.CARSCOPE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
if (!SB || !['127.0.0.1', 'localhost'].includes(new URL(SB).hostname)) throw new Error('Local Supabase stack required (loopback URL)');
await mkdir(out, { recursive: true });
const TRIAL = 'http://127.0.0.1:8095/inspect.html';
const WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';
const summary = { scope: 'LOCAL_STACK_REAL_CHROME_NO_GOOGLE', googleOAuth: 'NOT_RUN', hostedSupabase: 'NOT_RUN', checks: [], pageErrors: [], consoleErrors: [], failedResponses: [] };
const check = async (name, fn) => { try { await fn(); summary.checks.push({ name, status: 'PASS' }); } catch (e) { summary.checks.push({ name, status: 'FAIL', detail: String(e.message).slice(0, 400) }); } };

async function start(env) {
  const { server } = createAccountServer({ env });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** A real local-stack session, serialised exactly as supabase-js stores it under the page's storage key. */
async function storedSession(label) {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const o = clientOptions(storage); o.auth.autoRefreshToken = false;
  const client = createClient(SB, KEY, o);
  const { data, error } = await client.auth.signUp({ email: `p15-ui-${label}-${randomBytes(4).toString('hex')}@example.com`, password: randomBytes(18).toString('base64url') });
  if (error) throw error;
  return { id: data.user.id, email: data.user.email, value: mem.get(AUTH_STORAGE_KEY) };
}

const unconfigured = await start({ CARSCOPE_TRIAL_URL: TRIAL });
const configured = await start({ SUPABASE_URL: SB, SUPABASE_PUBLISHABLE_KEY: KEY, CARSCOPE_TRIAL_URL: TRIAL });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
summary.browser = browser.version();
const tokensSeen = [];

async function page({ viewport = { width: 1280, height: 900 }, userAgent, session } = {}) {
  const context = await browser.newContext({ viewport, userAgent, reducedMotion: 'reduce' });
  if (session) await context.addInitScript(([k, v]) => { if (!sessionStorage.getItem('p15-seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('p15-seeded', '1'); } }, [AUTH_STORAGE_KEY, session.value]);
  const p = await context.newPage();
  p.on('pageerror', (e) => summary.pageErrors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/.test(m.text())) summary.consoleErrors.push(m.text().slice(0, 200)); if (/eyJ[A-Za-z0-9_-]{10,}/.test(m.text())) tokensSeen.push('console'); });
  p.on('response', (r) => { if (r.status() >= 400) summary.failedResponses.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  p.on('requestfailed', (r) => summary.failedResponses.push(`${r.failure()?.errorText} ${new URL(r.url()).pathname}`));
  p.on('framenavigated', (f) => { if (/access_token|refresh_token|eyJ/.test(f.url())) tokensSeen.push(f.url().slice(0, 60)); });
  return { context, p };
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`), fullPage: true });

try {
  await check('unconfigured: login page explains, Google button stays off, trial link works', async () => {
    const { context, p } = await page();
    await p.goto(`${unconfigured.base}/account/`);
    await p.locator('#status', { hasText: '로그인이 설정되어 있지 않습니다' }).waitFor();
    assert.equal(await p.locator('#google').isDisabled(), true);
    assert.equal(await p.locator('#trial').getAttribute('href'), TRIAL);
    assert.equal(await p.locator('#trial').isVisible(), true);
    assert.equal(await p.locator('#privacyList li').count(), 5);
    await shot(p, '01-login-unconfigured');
    await p.goto(`${unconfigured.base}/account/vehicles.html`);
    await p.locator('#signedOut').waitFor();
    assert.equal(await p.locator('#vehicles li').count(), 0);
    await context.close();
  });

  await check('configured, Google provider off on the stack: clear message, no navigation, trial still offered', async () => {
    const { context, p } = await page();
    await p.goto(`${configured.base}/account/`);
    await p.locator('#google:not([disabled])').waitFor();
    await shot(p, '02-login');
    await p.click('#google');
    await p.locator('#status', { hasText: 'Google 로그인이 아직 켜져 있지 않습니다' }).waitFor();
    assert.equal(new URL(p.url()).pathname, '/account/');
    assert.equal(await p.locator('#trial').isVisible(), true);
    await shot(p, '03-login-provider-off');
    await context.close();
  });

  await check('callback: cancel, replay without a pending login, and implicit tokens all return to login with a message and a clean URL', async () => {
    const { context, p } = await page();
    const cases = [
      ['?error=access_denied&error_code=access_denied&error_description=denied&cs_flow=x', '로그인을 취소했습니다'],
      ['?code=0f0f0f0f-0000-4000-8000-000000000000&cs_flow=' + 'A'.repeat(43), '이 브라우저 탭에서 시작한 로그인이 아니거나'],
      ['#access_token=eyJfake.eyJfake.sig&refresh_token=r', '안전하지 않은 로그인 응답'],
    ];
    for (const [suffix, text] of cases) {
      await p.goto(`${configured.base}/account/callback.html${suffix}`);
      await p.waitForURL(`${configured.base}/account/`);
      await p.locator('#status', { hasText: text }).waitFor();
      assert.equal(new URL(p.url()).search + new URL(p.url()).hash, '', 'code / error / tokens removed from the address bar');
    }
    await shot(p, '04-login-cancelled-message');
    tokensSeen.length = 0; // the implicit-token case above deliberately navigated with a fake token
    await context.close();
  });

  await check('signed out: My Vehicles shows the login guard and no data', async () => {
    const { context, p } = await page();
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#signedOut').waitFor();
    assert.equal(await p.locator('#signOut').isVisible(), false);
    await shot(p, '05-vehicles-signed-out');
    await context.close();
  });

  const alice = await storedSession('alice');
  const bob = await storedSession('bob');

  await check('signed in: add, validate, edit and delete a vehicle; it reads as self-reported and unverified', async () => {
    const { context, p } = await page({ session: alice });
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#signedIn').waitFor();
    await p.locator('#email', { hasText: alice.email }).waitFor();
    await p.locator('#empty').waitFor();
    await p.click('#add');
    await p.fill('[name=model]', 'IONIQ 5');
    await p.fill('[name=model_year]', '1800');
    await p.click('#save');
    await p.locator('[data-error=manufacturer]', { hasText: '제조사' }).waitFor();
    await p.locator('[data-error=model_year]', { hasText: '1950년부터' }).waitFor();
    await shot(p, '06-vehicle-form-errors');
    await p.fill('[name=manufacturer]', '현대');
    await p.fill('[name=model_year]', '2024');
    await p.fill('[name=nickname]', '출퇴근 차');
    await p.click('#save');
    const card = p.locator('#vehicles li');
    await card.first().waitFor();
    assert.equal(await card.count(), 1);
    assert.match(await card.first().innerText(), /출퇴근 차[\s\S]*현대 · IONIQ 5 · 2024년식[\s\S]*직접 등록 · 소유 확인 안 됨[\s\S]*차량 데이터 연결: 연결 안 됨[\s\S]*점검 기록 연결: 없음/);
    await shot(p, '07-vehicles-one');
    await p.reload();
    await card.first().waitFor();
    assert.equal(await card.count(), 1, 'persists across reload');
    await card.first().getByRole('button', { name: '수정' }).click();
    await p.fill('[name=nickname]', '주말 차');
    await p.click('#save');
    await p.locator('#vehicles li .title', { hasText: '주말 차' }).waitFor();
    await card.first().getByRole('button', { name: '삭제' }).click();
    await shot(p, '08-vehicle-delete-confirm');
    await card.first().locator('.confirm').getByRole('button', { name: '삭제' }).click();
    await p.locator('#empty').waitFor();
    assert.equal(await card.count(), 0);
    await p.click('#add');
    await p.fill('[name=manufacturer]', '기아'); await p.fill('[name=model]', 'EV6');
    await p.click('#save');
    await card.first().waitFor();
    await context.close();
  });

  await check('isolation in the UI: Bob sees none of Alice\'s vehicles', async () => {
    const { context, p } = await page({ session: bob });
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#email', { hasText: bob.email }).waitFor();
    await p.locator('#empty').waitFor();
    assert.equal(await p.locator('#vehicles li').count(), 0);
    await context.close();
  });

  await check('sign-out wipes the list immediately and stays signed out after reload', async () => {
    const { context, p } = await page({ session: alice });
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#vehicles li').first().waitFor();
    await p.click('#signOut');
    await p.locator('#signedOut').waitFor();
    assert.equal(await p.locator('#vehicles li').count(), 0);
    assert.equal(await p.locator('#email').innerText(), '');
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), AUTH_STORAGE_KEY), null);
    await shot(p, '09-signed-out-after-logout');
    await p.reload();
    await p.locator('#signedOut').waitFor();
    await context.close();
  });

  await check('account switch in another tab: this tab drops the old account at once', async () => {
    const carol = await storedSession('carol');
    const dave = await storedSession('dave');
    const { context, p } = await page({ session: carol });
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#email', { hasText: carol.email }).waitFor();
    await p.click('#add'); await p.fill('[name=manufacturer]', '현대'); await p.fill('[name=model]', 'Carol 차'); await p.click('#save');
    await p.locator('#vehicles li').first().waitFor();
    const other = await context.newPage();
    await other.goto(`${configured.base}/account/`);
    await other.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTH_STORAGE_KEY, dave.value]);
    await p.reload(); // supabase-js reads the new account; the page must not show Carol's car under Dave
    await p.locator('#email', { hasText: dave.email }).waitFor();
    await p.locator('#empty').waitFor();
    assert.doesNotMatch(await p.locator('main').innerText(), /Carol 차/);
    await context.close();
  });

  await check('Auth server unreachable: no vehicles shown, retry offered; recovers when it is back', async () => {
    const { context, p } = await page({ session: bob });
    await p.route(`${SB}/auth/v1/user`, (route) => route.abort('connectionrefused'));
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#unavailable').waitFor();
    assert.equal(await p.locator('#vehicles li').count(), 0);
    await shot(p, '10-auth-unavailable');
    await p.unroute(`${SB}/auth/v1/user`);
    await p.click('#retry');
    await p.locator('#signedIn').waitFor();
    await context.close();
  });

  await check('Android WebView user agent: Google sign-in is refused with a "use the browser" message', async () => {
    const { context, p } = await page({ userAgent: WEBVIEW_UA, viewport: { width: 390, height: 844 } });
    await p.goto(`${configured.base}/account/`);
    await p.locator('#status', { hasText: '앱 안의 화면에서는 Google 로그인을 열 수 없습니다' }).waitFor();
    assert.equal(await p.locator('#google').isDisabled(), true);
    await shot(p, '11-webview-refused');
    await context.close();
  });

  await check('a session revoked by logout, replayed from saved storage, is refused (signed-out guard, no data)', async () => {
    const { context, p } = await page({ session: alice });
    await p.goto(`${configured.base}/account/vehicles.html`);
    await p.locator('#signedOut').waitFor();
    assert.equal(await p.locator('#vehicles li').count(), 0);
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), AUTH_STORAGE_KEY), null, 'the dead session is removed');
    await context.close();
  });

  await check('mobile width 390: no horizontal overflow on the login and My Vehicles pages', async () => {
    const erin = await storedSession('erin');
    const { context, p } = await page({ viewport: { width: 390, height: 844 }, session: erin });
    await p.goto(configured.base + '/account/'); await p.waitForLoadState('networkidle'); assert.ok(await noOverflow(p), 'login');
    await p.goto(configured.base + '/account/vehicles.html'); await p.locator('#signedIn').waitFor();
    await p.click('#add'); await p.fill('[name=manufacturer]', '제네시스'); await p.fill('[name=model]', 'GV60 퍼포먼스 아주 긴 모델 이름 줄바꿈 확인'); await p.fill('[name=nickname]', '가족과 함께 타는 차'); await p.click('#save');
    await p.locator('#vehicles li').first().waitFor(); assert.ok(await noOverflow(p), 'vehicles');
    await shot(p, '12-mobile-vehicles');
    await context.close();
  });

  await check('no token in any URL or console line, no CSP violation, no page error', async () => {
    assert.deepEqual(tokensSeen, []);
    assert.deepEqual(summary.pageErrors, []);
    assert.deepEqual(summary.consoleErrors.filter((t) => /Content Security Policy|Refused/.test(t)), []);
  });
} finally {
  await browser.close();
  await unconfigured.close(); await configured.close();
  summary.result = summary.checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(`${summary.checks.map((c) => `${c.status} ${c.name}${c.detail ? ' :: ' + c.detail : ''}`).join('\n')}\nRESULT ${summary.result}\n`);
  if (summary.result !== 'PASS') process.exitCode = 1;
}
