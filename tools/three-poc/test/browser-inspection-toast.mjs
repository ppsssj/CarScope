// P9-A2 toast regression on the real inspect.html with the reference GLB. Needs a running serve.mjs:
//   CARSCOPE_3D_TEST_URL=http://127.0.0.1:8098/inspect.html?capture=1 CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/... npm run test:toast-browser
// The "started" path replaces the absent adapter with a synthetic one in this test context only. No Native, device,
// server or session is involved, and this is not an AVD result.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url)), { chromium } = require('playwright');
const out = process.env.CARSCOPE_EVIDENCE_DIR, url = process.env.CARSCOPE_3D_TEST_URL;
if (!url) throw Error('Set CARSCOPE_3D_TEST_URL');
if (!out || !path.isAbsolute(out) || !path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external CARSCOPE_EVIDENCE_DIR');
await mkdir(out, { recursive: true });

const summary = { scope: 'REAL_REFERENCE_GLB_PAGE_SYNTHETIC_ADAPTER_FOR_STARTED_PATH', avd: 'NOT_RUN', native: 'NOT_RUN', checks: [], errors: [] };
const FAILED = 'Native 전달 경로 미완료', STARTED = 'Native 수신 화면을 요청했습니다 · 세션 생성 전입니다', HINT = '모델의 부위나 목록을 선택하세요';
const toast = (page) => page.evaluate(() => { const e = document.getElementById('toast'), r = e.getBoundingClientRect(); return { on: e.classList.contains('on'), text: e.textContent, fits: r.left >= 0 && r.right <= innerWidth }; });
const settled = (page, name) => page.waitForFunction((n) => __inspect.state.name === n && !__inspect.busy, name, { timeout: 25000 });
const until = (page, at) => page.waitForTimeout(Math.max(0, at - Date.now()));
async function partResult(page) {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__inspectReady, null, { timeout: 60000 });
  await page.locator('#start').click(); await settled(page, 'INSPECTION_OVERVIEW');
  await page.locator('[data-action=product-summary]').click(); await settled(page, 'INSPECTION_SUMMARY');
  await page.locator('[data-action=result-detail][data-id="tire.front-left"]').click(); await settled(page, 'PART_RESULT');
}
const request = async (page) => { await page.locator('[data-action=request-mobile]').click(); return Date.now(); };

let browser;
try {
  browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true }); summary.browser = browser.version();

  const plain = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' }), page = await plain.newPage();
  page.on('pageerror', (e) => summary.errors.push(e.message));
  const requests = []; page.on('request', (r) => requests.push(r.url()));
  await partResult(page);
  assert.equal(await page.evaluate(() => __inspect.nativeResults().connection), 'INCOMPLETE_NATIVE');

  // Failure message: shown, then gone. Before the fix it stayed until the next render().
  let at = await request(page), now = await toast(page);
  assert.equal(now.on, true); assert.match(now.text, new RegExp(FAILED));
  await until(page, at + 3000); assert.equal((await toast(page)).on, true, 'still visible at 3 s');
  await until(page, at + 4600); assert.equal((await toast(page)).on, false, 'gone after 4 s');
  summary.checks.push('PASS failure message hides by itself');

  // Repeated click: the first timer must not hide the second message.
  at = await request(page);
  await until(page, at + 3000); const second = await request(page);
  await until(page, at + 4600); assert.equal((await toast(page)).on, true, 'first timer was cancelled');
  await until(page, second + 4600); assert.equal((await toast(page)).on, false, 'second timer still hides it');
  summary.checks.push('PASS repeated click restarts the time');

  // Screen change: the request timer must not hide the hint of the screen that follows.
  at = await request(page);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); await settled(page, 'INSPECTION_SUMMARY');
  assert.equal((await toast(page)).on, false, 'a screen without a hint clears the message');
  await page.keyboard.press('Escape'); await settled(page, 'INSPECTION_OVERVIEW');
  const hintAt = Date.now();
  assert.equal((await toast(page)).text, HINT);
  await until(page, at + 4300);
  if (Date.now() < hintAt + 3500) { const held = await toast(page); assert.equal(held.on, true, 'old timer left the hint alone'); assert.equal(held.text, HINT); summary.checks.push('PASS screen change keeps the later hint'); }
  else summary.checks.push('NOT_RUN later-hint timing: the transition took too long to separate the two timers');
  await until(page, hintAt + 4600); assert.equal((await toast(page)).on, false);

  // Existing flow around the toast is unchanged and asks no server for anything.
  await page.locator('#panel [data-action=open-history]').click(); await settled(page, 'HISTORY_LIST');
  await page.locator('#historyResults [data-history-status="UNAVAILABLE"]').waitFor();
  assert.ok(!requests.some((u) => /\/v1\/|inspection-records|onrender\.com/.test(u)), 'no server request');
  summary.checks.push('PASS History stays UNAVAILABLE; no server request');
  await plain.close();

  // Started message, with a synthetic adapter in this context only.
  for (const viewport of [{ width: 1440, height: 960 }, { width: 430, height: 900 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }), p = await context.newPage();
    p.setDefaultTimeout(25000); p.on('pageerror', (e) => summary.errors.push(e.message));
    await p.route('**/inspect.js', async (route) => {
      const response = await route.fetch(), source = await response.text(), real = 'createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()})';
      assert.ok(source.includes(real));
      await route.fulfill({ response, body: `import {fixtureAdapter} from './test/native-results-browser-fixture.mjs';\n` + source.replace(real, 'createNativeInspectionResults({adapter:fixtureAdapter})') });
    });
    await partResult(p);
    assert.equal(await p.evaluate(() => __inspect.nativeResults().connection), 'ADAPTER_CONNECTED');
    at = await request(p); now = await toast(p);
    assert.equal(now.on, true); assert.equal(now.text, STARTED); assert.equal(now.fits, true, `fits ${viewport.width}`);
    await p.screenshot({ path: path.join(out, `toast-started-${viewport.width}.png`) });
    await until(p, at + 4600); assert.equal((await toast(p)).on, false);
    summary.checks.push(`PASS ${viewport.width} started message: wording, fits, hides by itself`);
    await context.close();
  }
  assert.deepEqual(summary.errors, []); summary.status = 'PASS';
} catch (error) { summary.status = 'FAIL'; summary.errors.push(error.stack ?? String(error)); process.exitCode = 1; }
finally { await browser?.close(); await writeFile(path.join(out, 'results.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2)); }
