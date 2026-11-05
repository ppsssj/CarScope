// P9-S2: result card and mobile-request toast on the real inspect.html with the reference GLB. Needs a running serve.mjs:
//   CARSCOPE_3D_TEST_URL=http://127.0.0.1:8098/inspect.html?capture=1 CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/... npm run test:consistency-browser
// Without the URL it runs only the DOM section, which is what CI can run (no GLB there).
// The adapter is a scripted test double in this test context only. No Native, device, server or session is involved. AVD_NOT_RUN.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { wireResult } from './result-fixtures.mjs';

const require = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url)), { chromium } = require('playwright');
const out = process.env.CARSCOPE_EVIDENCE_DIR, url = process.env.CARSCOPE_3D_TEST_URL;
if (!out || !path.isAbsolute(out) || !path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external CARSCOPE_EVIDENCE_DIR');
await mkdir(out, { recursive: true });

const summary = { scope: url ? 'DOM_AND_REAL_REFERENCE_GLB_PAGE_SCRIPTED_ADAPTER' : 'DOM_ONLY_SCRIPTED_ADAPTER_NO_3D', avd: 'AVD_NOT_RUN', native: 'NOT_RUN', checks: [], failures: [], errors: [] };
const TEXT = { SENDING: 'Native 점검 요청 전달 중입니다', ACCEPTED: 'Native 수신 화면 요청이 접수됐습니다 · 세션 생성 전입니다', REJECTED: '점검 요청을 시작할 수 없습니다', FAILED: 'Native 연결을 확인하지 못했습니다', IN_FLIGHT: '이전 요청의 Native 응답을 기다리는 중입니다 · 새 요청을 보내지 않았습니다' };
const FRONT_LEFT = 'tire.front-left', FRONT_RIGHT = 'tire.front-right';
const REAL = 'createNativeInspectionResults({adapter:createAndroidNativeInspectionAdapter()})';

// Every scenario reports on its own, so a run against unfixed code shows each defect rather than stopping at the first.
async function scenario(name, run) {
  try { await run(); summary.checks.push(`PASS ${name}`); console.log(`PASS ${name}`); }
  catch (error) { summary.failures.push(`FAIL ${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
let browser;

// ---- DOM section: the real view module and controller in real Chrome, no 3D ------------------------------------------
const fixtureHtml = `<!doctype html><html lang="ko"><meta charset="utf-8"><div id="panel" style="height:300px;overflow:auto"><div style="height:400px"></div>
  <button type="button" class="item" data-action="tire" data-id="${FRONT_LEFT}">앞 왼쪽<span class="inspection-state" data-inspection-state="NOT_INSPECTED">old</span></button>
  <div id="mobilePartResults"></div><div id="allResults"></div><div style="height:800px"></div></div><div id="toast"></div>
  <script type="module">
  import {createTireInspection,updateTireInspection} from '/tire-inspection.mjs';import {createNativeInspectionResults} from '/native-inspection-results.mjs';import {refreshResultRegions,partResultHtml,resultSummaryHtml} from '/inspection-results-view.mjs';import {fixtureAdapter,publish} from '/test/native-results-browser-fixture.mjs';
  const store=createNativeInspectionResults({adapter:fixtureAdapter});let local=createTireInspection('fixture-local');store.startSession(local.sessionId);
  const panel=document.getElementById('panel'),refresh=()=>refreshResultRegions(panel,{local,mobile:store.snapshot,partId:'${FRONT_LEFT}'});
  document.getElementById('mobilePartResults').innerHTML=partResultHtml(local,store.snapshot,'${FRONT_LEFT}');document.getElementById('allResults').innerHTML=resultSummaryHtml(local,store.snapshot);
  window.fixtureTest={refresh,publish,store,confirm(){for(const checkId of ['damage','debris','wear'])local=updateTireInspection(local,{type:'ANSWER',tireId:'${FRONT_LEFT}',sessionId:local.sessionId,checkId,answer:'FOUND'});local=updateTireInspection(local,{type:'CONFIRM',tireId:'${FRONT_LEFT}',sessionId:local.sessionId,at:1000});refresh();}};</script></html>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixtureHtml); return; }
    const rel = decodeURIComponent(req.url.slice(1)), base = new URL('../', import.meta.url), file = new URL(rel, base);
    if (!file.href.startsWith(base.href) || !file.pathname.endsWith('.mjs')) throw Error('Denied');
    res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

async function domSection() {
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } }), page = await context.newPage();
  page.on('pageerror', e => summary.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const ready = await page.waitForFunction(() => !!window.fixtureTest, null, { timeout: 5000 }).then(() => true, () => false);
  await scenario('DOM: a local record reaches the card, the summary and the list badge in one call', async () => {
    assert.ok(ready, 'fixture page loads the view module');
    const seen = await page.evaluate(() => {
      const panel = document.getElementById('panel'); panel.scrollTop = 500;
      const request = document.querySelector('[data-action=request-mobile]'); request.focus({ preventScroll: true });
      const details = document.querySelector('#allResults'), before = details;
      fixtureTest.confirm();
      return { card: document.querySelector('#mobilePartResults [data-inspection-state]').dataset.inspectionState, list: document.querySelector('button.item [data-inspection-state]').dataset.inspectionState,
        summary: document.querySelector('#allResults [role=status]').textContent, scroll: panel.scrollTop, focused: document.activeElement.dataset.action, same: before === document.querySelector('#allResults') };
    });
    assert.equal(seen.card, 'FINDINGS_REPORTED'); assert.equal(seen.list, 'FINDINGS_REPORTED');
    assert.match(seen.summary, /선택된 확정 기록 1\/17 · 미점검 16 · 이상 징후 1/);
    assert.equal(seen.scroll, 500, 'scroll kept'); assert.equal(seen.focused, 'request-mobile', 'focus returns to the same control'); assert.equal(seen.same, true, 'region element kept');
  });
  await scenario('DOM: unchanged content is not rewritten, and an open disclosure survives a real change', async () => {
    assert.ok(ready);
    const seen = await page.evaluate(async ({ result, part }) => {
      const button = document.querySelector('[data-action=request-mobile]');
      fixtureTest.refresh();
      const untouched = button === document.querySelector('[data-action=request-mobile]') && button.isConnected;
      await fixtureTest.publish(result, part);
      fixtureTest.store.select(part, result.inspectionId);
      fixtureTest.refresh();
      const details = document.querySelector('#mobilePartResults details'); details.open = true;
      const region = document.querySelector('#mobilePartResults'), before = region.innerHTML;
      await fixtureTest.store.request('not-a-task'); // Raises a notice, which really changes the card.
      fixtureTest.refresh();
      return { untouched, changed: region.innerHTML !== before, open: document.querySelector('#mobilePartResults details').open };
    }, { result: wireResult(FRONT_LEFT, 'UNABLE', '31111111-1111-4111-8111-111111111111'), part: FRONT_LEFT });
    assert.equal(seen.untouched, true, 'same html keeps the same nodes');
    assert.equal(seen.changed, true, 'the card was rewritten');
    assert.equal(seen.open, true);
  });
  await scenario('DOM: a card growing above the reading position does not move the panel', async () => {
    assert.ok(ready);
    const seen = await page.evaluate(async () => {
      const panel = document.getElementById('panel'), card = document.querySelector('#mobilePartResults');
      await fixtureTest.store.request('tire.front-left'); // Clears the notice left by the previous scenario.
      fixtureTest.refresh();
      const shortCard = card.offsetHeight;
      panel.scrollTop = panel.scrollHeight - panel.clientHeight - 100;
      const before = panel.scrollTop;
      await fixtureTest.store.request('not-a-task-either');
      fixtureTest.refresh();
      return { before, after: panel.scrollTop, grew: card.offsetHeight > shortCard };
    });
    assert.equal(seen.grew, true, 'the card really grew above the reading position');
    assert.equal(seen.after, seen.before);
  });
  await context.close();
}

// ---- Real page section ------------------------------------------------------------------------------------------------
const settled = (page, name) => page.waitForFunction(n => __inspect.state.name === n && !__inspect.busy, name, { timeout: 25000 });
const toast = page => page.evaluate(() => { const e = document.getElementById('toast'); return { on: e.classList.contains('on'), text: e.textContent }; });
const fixture = (page, body, arg) => page.evaluate(`import('./test/native-results-browser-fixture.mjs').then(f=>(${body})(f,${JSON.stringify(arg ?? null)}))`);
async function openPage(viewport = { width: 1440, height: 960 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }), page = await context.newPage();
  page.setDefaultTimeout(25000); page.on('pageerror', e => summary.errors.push(e.message));
  await page.route('**/inspect.js', async route => {
    const response = await route.fetch(), source = await response.text(); assert.ok(source.includes(REAL));
    await route.fulfill({ response, body: `import {fixtureAdapter} from './test/native-results-browser-fixture.mjs';\n` + source.replace(REAL, 'createNativeInspectionResults({adapter:fixtureAdapter})') });
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__inspectReady, null, { timeout: 60000 });
  await page.locator('#start').click(); await settled(page, 'INSPECTION_OVERVIEW');
  return { context, page };
}
const toTire = async (page, id = FRONT_LEFT) => {
  await page.locator('[data-action=area][data-id=tires]').click(); await settled(page, 'TIRE_SELECTION');
  await page.locator(`[data-action=tire][data-id="${id}"]`).first().click(); await settled(page, 'TIRE_PREVIEW');
};
const toResult = async (page, id) => {
  await page.locator('[data-action=product-summary]').click(); await settled(page, 'INSPECTION_SUMMARY');
  await page.locator(`[data-action=result-detail][data-id="${id}"]`).click(); await settled(page, 'PART_RESULT');
};
const answer = async (page, value = 'FOUND') => { for (const key of ['damage', 'debris', 'wear']) await page.locator(`input[data-check=${key}][value=${value}]`).check(); };
const clickRequest = page => page.locator('[data-action=request-mobile]').click();
const requestCount = page => fixture(page, 'f=>f.requests.length');

// Runs the click and reads every surface in the same task, so "immediately" cannot be satisfied by a later render.
const confirmAndRead = (page, id = FRONT_LEFT) => page.evaluate(id => {
  const panel = document.getElementById('panel'), read = () => {
    const row = __inspect.resultMap().find(r => r.partId === id), paint = __inspect.resultPaint().find(p => p.partId === id);
    return { model: row.status, color: row.color, paint: paint.colors, card: panel.querySelector('#mobilePartResults [data-inspection-state]')?.dataset.inspectionState, cardTime: panel.querySelector('#mobilePartResults time')?.dateTime ?? null,
      local: panel.querySelector('.inspection-record [data-inspection-state]')?.dataset.inspectionState, list: panel.querySelector(`button.item[data-id="${id}"] [data-inspection-state]`)?.dataset.inspectionState,
      source: panel.querySelector('#mobilePartResults dd')?.textContent };
  };
  const scrollBefore = panel.scrollTop, cameraBefore = JSON.stringify(__inspect.cameraPose()), stateBefore = __inspect.state, marker = panel.querySelector('h2');
  const before = read();
  panel.querySelector('[data-action=confirm-tire]').click();
  const after = read();
  return { before, after, scrollBefore, scrollAfter: panel.scrollTop, cameraSame: JSON.stringify(__inspect.cameraPose()) === cameraBefore, stateSame: __inspect.state === stateBefore, panelKept: marker.isConnected, focused: document.activeElement.getAttribute('role'), completedAt: __inspect.userInspection().tires[id].completedAt };
}, id);

async function realPageSection() {
  { const { context, page } = await openPage();
    await scenario('A1 local confirm updates the card, list badge, record and 3D paint in the same task', async () => {
      await toTire(page); await answer(page);
      await page.locator('#panel').evaluate(panel => { panel.scrollTop = Math.min(180, panel.scrollHeight - panel.clientHeight); });
      const seen = await confirmAndRead(page);
      assert.equal(seen.before.card, 'NOT_INSPECTED', 'precondition: not yet recorded');
      assert.equal(seen.after.model, 'FINDINGS_REPORTED');
      assert.equal(seen.after.card, 'FINDINGS_REPORTED', `card ${seen.after.card} while model ${seen.after.model}`);
      assert.equal(seen.after.local, 'FINDINGS_REPORTED'); assert.equal(seen.after.list, 'FINDINGS_REPORTED');
      assert.ok(seen.after.paint.every(color => color === seen.after.color), '3D paint uses the same row');
      assert.equal(seen.after.cardTime, new Date(seen.completedAt).toISOString(), 'card shows the record time');
      assert.match(seen.after.source, /USER_REPORTED/);
    });
    await scenario('A2 confirm keeps camera, selection, panel element, scroll and focus', async () => {
      await page.locator('[data-action=next-tire]').click(); await settled(page, 'TIRE_PREVIEW');
      await answer(page, 'NOT_FOUND');
      await page.locator('#panel').evaluate(panel => { panel.scrollTop = Math.min(180, panel.scrollHeight - panel.clientHeight); });
      await page.waitForFunction(() => !__inspect.busy);
      const seen = await confirmAndRead(page, FRONT_RIGHT);
      assert.equal(seen.after.card, 'NO_FINDINGS_REPORTED');
      assert.equal(seen.cameraSame, true, 'camera kept'); assert.equal(seen.stateSame, true, 'selection kept'); assert.equal(seen.panelKept, true, 'no full panel render');
      assert.equal(seen.scrollAfter, seen.scrollBefore, 'scroll kept'); assert.equal(seen.focused, 'status', 'focus on the confirmation message');
    });
    await scenario('A3 duplicate confirm changes nothing; editing an answer returns every surface to not inspected at once', async () => {
      const seen = await page.evaluate(id => {
        const panel = document.getElementById('panel'), at = __inspect.userInspection().tires[id].completedAt, record = __inspect.userInspection();
        const button = panel.querySelector('[data-action=confirm-tire]'); button.disabled = false; button.click(); button.click();
        return { same: __inspect.userInspection() === record, at, atAfter: __inspect.userInspection().tires[id].completedAt };
      }, FRONT_RIGHT);
      assert.equal(seen.same, true); assert.equal(seen.atAfter, seen.at);
      const edited = await page.evaluate(id => {
        const panel = document.getElementById('panel'), input = panel.querySelector('input[data-check=damage][value=FOUND]'); input.click();
        return { model: __inspect.resultMap().find(r => r.partId === id).status, card: panel.querySelector('#mobilePartResults [data-inspection-state]').dataset.inspectionState, list: panel.querySelector(`button.item[data-id="${id}"] [data-inspection-state]`).dataset.inspectionState };
      }, FRONT_RIGHT);
      assert.deepEqual(edited, { model: 'NOT_INSPECTED', card: 'NOT_INSPECTED', list: 'NOT_INSPECTED' });
    });
    await scenario('A4 summary agrees with the card after leaving the screen', async () => {
      await page.locator('[data-action=product-summary]').click(); await settled(page, 'INSPECTION_SUMMARY');
      const text = await page.locator('#allResults [role=status]').textContent();
      assert.match(text, /선택된 확정 기록 1\/17 · 미점검 16 · 이상 징후 1/);
      assert.equal(await page.evaluate(id => document.querySelector(`#allResults [data-id="${id}"] [data-inspection-state]`).dataset.inspectionState, FRONT_LEFT), 'FINDINGS_REPORTED');
    });
    await context.close();
  }
  { const { context, page } = await openPage();
    await scenario('A5 a delivered mobile candidate is not selected by a local confirm; selection stays explicit and the card follows it', async () => {
      await toTire(page);
      const result = wireResult(FRONT_LEFT, 'UNABLE', '21111111-1111-4111-8111-111111111111');
      assert.equal((await fixture(page, '(f,[r,p])=>f.publish(r,p)', [result, FRONT_LEFT])).delivered, 'STAGED');
      await answer(page);
      const seen = await confirmAndRead(page);
      assert.equal(seen.after.card, 'FINDINGS_REPORTED', 'local record shown, candidate not applied');
      assert.equal(await page.evaluate(() => __inspect.nativeResults().selected[`tire.front-left`] ?? null), null);
      await page.locator(`[data-record="${result.inspectionId}"]`).click();
      const chosen = await page.evaluate(id => ({ card: document.querySelector('#mobilePartResults [data-inspection-state]').dataset.inspectionState, list: document.querySelector(`button.item[data-id="${id}"] [data-inspection-state]`).dataset.inspectionState, local: document.querySelector('.inspection-record [data-inspection-state]').dataset.inspectionState, model: __inspect.resultMap().find(r => r.partId === id).status, focused: document.activeElement?.dataset.record }), FRONT_LEFT);
      assert.deepEqual(chosen, { card: 'UNABLE', list: 'UNABLE', local: 'FINDINGS_REPORTED', model: 'UNABLE', focused: result.inspectionId });
    });
    await context.close();
  }
  { const { context, page } = await openPage();
    await toResult(page, FRONT_LEFT);
    await scenario('B1 Native takes the request: sending, then received, and no claim of a created session', async () => {
      const held = 'window.__held=f.deferredReply();f.setRequestReply(window.__held.reply)';
      await fixture(page, `f=>{${held}}`);
      await clickRequest(page);
      assert.equal((await toast(page)).text, TEXT.SENDING);
      await page.evaluate(() => window.__held.resolve({ ok: true }));
      await page.waitForFunction(text => document.getElementById('toast').textContent === text, TEXT.ACCEPTED, { timeout: 3000 });
      await page.screenshot({ path: path.join(out, 'toast-accepted.png') });
    });
    await scenario('B2 Native refuses another part: no start message, a reason-neutral refusal, and the panel says so', async () => {
      await page.keyboard.press('Escape'); await settled(page, 'INSPECTION_SUMMARY');
      await page.locator(`[data-action=result-detail][data-id="${FRONT_RIGHT}"]`).click(); await settled(page, 'PART_RESULT');
      await fixture(page, 'f=>f.setRequestReply(f.rejectedByNative)');
      await clickRequest(page);
      await page.waitForTimeout(50);
      const now = await toast(page);
      assert.equal(now.text, TEXT.REJECTED, `toast: ${now.text}`);
      assert.doesNotMatch(now.text, /다른 부품|접수|요청했습니다/);
      assert.match(await page.locator('#mobilePartResults .result-error').textContent(), /점검 요청을 시작할 수 없습니다/);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'request-mobile', 'focus stays on the button');
      await page.screenshot({ path: path.join(out, 'toast-rejected.png') });
    });
    await scenario('B3 connection failure has its own message; the next request clears the old failure', async () => {
      await fixture(page, 'f=>f.setRequestReply(f.unreachable)');
      await clickRequest(page); await page.waitForTimeout(50);
      assert.equal((await toast(page)).text, TEXT.FAILED);
      await fixture(page, 'f=>f.setRequestReply(()=>({ok:true}))');
      await clickRequest(page); await page.waitForTimeout(50);
      assert.equal((await toast(page)).text, TEXT.ACCEPTED);
      assert.equal(await page.locator('#mobilePartResults .result-error').count(), 0, 'old failure cleared');
    });
    await scenario('B4 repeated clicks and a click on another part while waiting send one request and do not replace it', async () => {
      const first = await requestCount(page);
      await fixture(page, 'f=>{window.__held=f.deferredReply();f.setRequestReply(window.__held.reply);}');
      await page.evaluate(() => { const b = document.querySelector('[data-action=request-mobile]'); b.click(); document.querySelector('[data-action=request-mobile]').click(); document.querySelector('[data-action=request-mobile]').click(); });
      assert.equal(await requestCount(page), first + 1, 'one Native request');
      assert.equal((await toast(page)).text, TEXT.IN_FLIGHT);
      await page.evaluate(() => window.__held.resolve({ ok: true }));
      await page.waitForFunction(text => document.getElementById('toast').textContent === text, TEXT.ACCEPTED, { timeout: 3000 });
    });
    await scenario('B5 Back while waiting: a late success shows nothing on the next screen', async () => {
      await fixture(page, 'f=>{window.__held=f.deferredReply();f.setRequestReply(window.__held.reply);}');
      await clickRequest(page);
      await page.keyboard.press('Escape'); await settled(page, 'INSPECTION_SUMMARY');
      const before = await toast(page);
      await page.evaluate(() => window.__held.resolve({ ok: true }));
      await page.waitForTimeout(100);
      const after = await toast(page);
      assert.equal(after.text, before.text); assert.notEqual(after.text, TEXT.ACCEPTED);
    });
    await scenario('B6 ending the session while waiting: the late success reaches neither the idle page nor the next session', async () => {
      await page.locator(`[data-action=result-detail][data-id="${FRONT_LEFT}"]`).click(); await settled(page, 'PART_RESULT');
      await fixture(page, 'f=>{window.__held=f.deferredReply();f.setRequestReply(window.__held.reply);}');
      await clickRequest(page);
      await page.locator('[data-action=exit]').click(); await settled(page, 'IDLE');
      await page.locator('#start').click(); await settled(page, 'INSPECTION_OVERVIEW');
      await page.evaluate(() => window.__held.resolve({ ok: true }));
      await page.waitForTimeout(100);
      assert.notEqual((await toast(page)).text, TEXT.ACCEPTED);
      assert.equal(await page.evaluate(() => __inspect.nativeResults().notice), null);
    });
    await context.close();
  }
  { const { context, page } = await openPage({ width: 430, height: 900 });
    await scenario('B7 at 430 wide: the message fits and hides after 4 seconds; a newer message restarts the time', async () => {
      await toResult(page, FRONT_LEFT);
      await fixture(page, 'f=>f.setRequestReply(f.rejectedByNative)');
      const at = Date.now(); await clickRequest(page); await page.waitForTimeout(50);
      const fits = await page.evaluate(() => { const r = document.getElementById('toast').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
      assert.equal(fits, true);
      await page.waitForTimeout(Math.max(0, at + 3000 - Date.now())); assert.equal((await toast(page)).on, true, 'visible at 3 s');
      const second = Date.now(); await clickRequest(page); await page.waitForTimeout(50);
      await page.waitForTimeout(Math.max(0, at + 4600 - Date.now())); assert.equal((await toast(page)).on, true, 'first timer cancelled');
      await page.waitForTimeout(Math.max(0, second + 4600 - Date.now())); assert.equal((await toast(page)).on, false, 'hidden by itself');
    });
    await context.close();
  }
}

try {
  browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true }); summary.browser = browser.version();
  await domSection();
  if (url) await realPageSection();
  assert.deepEqual(summary.errors, []);
  summary.status = summary.failures.length ? 'FAIL' : 'PASS';
  if (summary.failures.length) process.exitCode = 1;
} catch (error) { summary.status = 'FAIL'; summary.errors.push(error.stack ?? String(error)); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await writeFile(path.join(out, 'results.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ status: summary.status, checks: summary.checks.length, failures: summary.failures.length, errors: summary.errors }, null, 2)); }
