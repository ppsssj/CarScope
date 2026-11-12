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
import { MOBILE_REQUEST_TEXT as TEXT } from '../inspection-toast.mjs';

const require = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url)), { chromium } = require('playwright');
const out = process.env.CARSCOPE_EVIDENCE_DIR, url = process.env.CARSCOPE_3D_TEST_URL;
if (!out || !path.isAbsolute(out) || !path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external CARSCOPE_EVIDENCE_DIR');
await mkdir(out, { recursive: true });

const summary = { scope: url ? 'DOM_AND_REAL_REFERENCE_GLB_PAGE_SCRIPTED_ADAPTER' : 'DOM_ONLY_SCRIPTED_ADAPTER_NO_3D', avd: 'AVD_NOT_RUN', native: 'NOT_RUN', checks: [], failures: [], errors: [] };
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
  <div id="mobilePartResults"></div><div id="mobilePartAction"></div><div id="allResults"></div><div style="height:800px"></div></div><div id="toast"></div>
  <script type="module">
  import {createTireInspection,updateTireInspection} from '/tire-inspection.mjs';import {createNativeInspectionResults} from '/native-inspection-results.mjs';import {refreshResultRegions,partResultHtml,partActionHtml,resultSummaryHtml} from '/inspection-results-view.mjs';import {fixtureAdapter,publish} from '/test/native-results-browser-fixture.mjs';
  const store=createNativeInspectionResults({adapter:fixtureAdapter});let local=createTireInspection('fixture-local');store.startSession(local.sessionId);
  const panel=document.getElementById('panel'),refresh=()=>refreshResultRegions(panel,{local,mobile:store.snapshot,partId:'${FRONT_LEFT}'});
  document.getElementById('mobilePartResults').innerHTML=partResultHtml(local,store.snapshot,'${FRONT_LEFT}');document.getElementById('mobilePartAction').innerHTML=partActionHtml(local,store.snapshot,'${FRONT_LEFT}');document.getElementById('allResults').innerHTML=resultSummaryHtml(local,store.snapshot);
  window.fixtureTest={refresh,publish,store,confirm(){for(const checkId of ['damage','debris','wear'])local=updateTireInspection(local,{type:'ANSWER',tireId:'${FRONT_LEFT}',sessionId:local.sessionId,checkId,answer:'FOUND'});local=updateTireInspection(local,{type:'CONFIRM',tireId:'${FRONT_LEFT}',sessionId:local.sessionId,at:1000});refresh();}};</script></html>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixtureHtml); return; }
    // P11: the one shared file the results view imports, mapped as serve.mjs maps it.
    if (req.url === '/mobile-ar-poc/public/part-capabilities.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL('../../mobile-ar-poc/public/part-capabilities.mjs', import.meta.url))); return; }
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
    assert.match(seen.summary, /점검 완료 1\/17 · 미점검 16 · 이상 징후 보고 1/);
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
      local: __inspect.inspectionMap().find(r => r.partId === id)?.status, list: panel.querySelector(`button.item[data-id="${id}"] [data-inspection-state]`)?.dataset.inspectionState,
      source: panel.querySelector('#mobilePartResults .result-meta')?.textContent };
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
      assert.match(seen.after.source, /이 화면에서 직접 입력/);
    });
    await scenario('A2 confirm keeps camera, selection, panel element, scroll and focus', async () => {
      await page.locator(`[data-action=tire][data-id="${FRONT_RIGHT}"]`).first().click(); await settled(page, 'TIRE_PREVIEW');
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
      assert.match(text, /점검 완료 1\/17 · 미점검 16 · 이상 징후 보고 1/);
      assert.equal(await page.evaluate(id => document.querySelector(`#allResults [data-id="${id}"] [data-inspection-state]`).dataset.inspectionState, FRONT_LEFT), 'FINDINGS_REPORTED');
    });
    await context.close();
  }
  { const { context, page } = await openPage();
    await scenario('A5 the newest verified mobile result is shown, a local confirm stays separate, and an earlier record stays reachable', async () => {
      await toTire(page);
      const result = wireResult(FRONT_LEFT, 'UNABLE', '21111111-1111-4111-8111-111111111111');
      assert.equal((await fixture(page, '(f,[r,p])=>f.publish(r,p)', [result, FRONT_LEFT])).delivered, 'STAGED');
      assert.equal(await page.evaluate(() => __inspect.nativeResults().selected[`tire.front-left`]), result.inspectionId);
      await answer(page);
      const seen = await confirmAndRead(page);
      assert.equal(seen.after.card, 'UNABLE', 'the mobile result is still the one shown');
      const read = id => ({ card: document.querySelector('#mobilePartResults [data-inspection-state]').dataset.inspectionState, list: document.querySelector(`button.item[data-id="${id}"] [data-inspection-state]`).dataset.inspectionState, local: __inspect.inspectionMap().find(r => r.partId === id).status, model: __inspect.resultMap().find(r => r.partId === id).status });
      assert.deepEqual(await page.evaluate(read, FRONT_LEFT), { card: 'UNABLE', list: 'UNABLE', local: 'FINDINGS_REPORTED', model: 'UNABLE' });
      await page.locator('.record-history summary').click();
      await page.locator('[data-action=select-result][data-record="LOCAL"]').click();
      assert.deepEqual(await page.evaluate(read, FRONT_LEFT), { card: 'FINDINGS_REPORTED', list: 'FINDINGS_REPORTED', local: 'FINDINGS_REPORTED', model: 'FINDINGS_REPORTED' });
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.record), 'LOCAL', 'focus stays in the earlier-records area');
    });
    await context.close();
  }
  { const { context, page } = await openPage();
    await toResult(page, FRONT_LEFT);
    await scenario('Q1 the part panel leaves room for the QR, reports where it is, and gives the room back', async () => {
      await fixture(page, '(f,[t,at])=>f.receiver({taskId:t,phase:"QR_READY",canCancel:true,inviteExpiresAt:at})', [FRONT_LEFT, Date.now() + 600000]);
      await page.waitForFunction(() => document.querySelector('#mobileQrSlot'));
      const place = await page.evaluate(async () => { const f = await import('./test/native-results-browser-fixture.mjs'); const r = document.querySelector('#mobileQrSlot').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(); return { last: f.panelSlots.at(-1), r: [r.left, r.top, r.width, r.height], inside: r.top >= p.top && r.bottom <= p.bottom && r.left >= p.left && r.right <= p.right, text: document.getElementById('mobilePartResults').innerHTML }; });
      assert.equal(place.inside, true, 'revealed inside the panel');
      assert.deepEqual([place.last.slot, place.last.x, place.last.y, place.last.size], ['SHOWN', Math.round(place.r[0]), Math.round(place.r[1]), Math.round(place.r[2])]);
      // PR #120: the report carries its own viewport so Native converts once, by its WebView width, not by display density.
      assert.deepEqual([place.last.vw, place.last.vh], await page.evaluate(() => [innerWidth, innerHeight]));
      assert.equal(Math.round(place.r[2]), Math.round(place.r[3]), 'square');
      assert.ok(place.r[2] >= 120, 'large enough to scan');
      assert.doesNotMatch(place.text, /invite=|#v=2|data:image/);
      assert.doesNotMatch(JSON.stringify(await fixture(page, 'f=>f.panelSlots.slice()')), /invite|token|data:/, 'reports hold geometry only');
      await page.screenshot({ path: path.join(out, 'inline-qr-slot.png') });
      // Scrolling the panel reports the new place without waiting for the 1 s timer; scrolling it away hides the QR.
      const before = (await fixture(page, 'f=>f.panelSlots.length'));
      const scrolled = await page.evaluate(async () => { const p = document.getElementById('panel'), s = document.querySelector('#mobileQrSlot'); const top = s.getBoundingClientRect().top, step = Math.min(40, p.scrollHeight - p.clientHeight - p.scrollTop);
        if (step > 0) { p.scrollTop += step; } else { p.scrollTop -= 40; } await new Promise(r => { let n = 4; const k = () => (--n ? requestAnimationFrame(k) : r()); requestAnimationFrame(k); });
        const f = await import('./test/native-results-browser-fixture.mjs'), r = s.getBoundingClientRect(); return { moved: r.top !== top, last: f.panelSlots.at(-1), top: r.top }; });
      if (scrolled.moved) { assert.ok((await fixture(page, 'f=>f.panelSlots.length')) > before, 'a scroll is reported before the next timer tick'); assert.ok(scrolled.last.slot === 'HIDDEN' || scrolled.last.y === Math.round(scrolled.top), 'the report follows the slot'); }
      const away = await page.evaluate(async () => { const p = document.getElementById('panel'), s = document.querySelector('#mobileQrSlot'); p.style.height = '120px'; p.style.bottom = 'auto'; await new Promise(r => { let n = 4; const k = () => (--n ? requestAnimationFrame(k) : r()); requestAnimationFrame(k); });
        const f = await import('./test/native-results-browser-fixture.mjs'), last = f.panelSlots.at(-1); p.style.height = ''; p.style.bottom = ''; await new Promise(r => { let n = 4; const k = () => (--n ? requestAnimationFrame(k) : r()); requestAnimationFrame(k); }); return { last, after: f.panelSlots.at(-1), clipped: s.getBoundingClientRect().height > 120 }; });
      assert.equal(away.clipped, true); assert.equal(away.last.slot, 'HIDDEN', 'a slot the panel cannot show whole is hidden'); assert.equal(away.after.slot, 'SHOWN', 'and shown again once it fits');
      await page.locator('[data-action=mobile-cancel]').click();
      assert.deepEqual(await fixture(page, 'f=>f.controls.slice()'), ['cancel']);
      await fixture(page, '(f,[t])=>f.receiver({taskId:t,phase:"CONNECTED"})', [FRONT_LEFT]);
      await page.waitForFunction(() => !document.querySelector('#mobileQrSlot'));
      assert.equal((await fixture(page, 'f=>f.panelSlots.at(-1)')).slot, 'NONE');
      await fixture(page, '(f,[t])=>f.receiver({taskId:t,phase:"CANCELLED"})', [FRONT_LEFT]);
    });
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
    await scenario('S1 the washer guide on the real page asks to look without touching', async () => {
      const { context, page } = await openPage();
      try {
        await page.locator('[data-action=area][data-id=hood]').click(); await settled(page, 'COMPONENT_SELECTION');
        await page.locator('[data-action=component][data-id="washer-fluid-cap"]').first().click(); await settled(page, 'WASHER_SELECTED');
        const text = await page.locator('#panel').innerText();
        assert.match(text, /부품을 만지거나 캡·덮개를 열지 마세요/);
        assert.match(text, /직접 보충하지 마세요/);
        assert.doesNotMatch(text, /캡을 열어|보충하고 캡을 닫/);
      } finally { await context.close(); }
    });
    await scenario('S2 the light detail and result screens say only the exterior is checked', async () => {
      const { context, page } = await openPage();
      try {
        await page.locator('[data-action=area][data-id=lights]').click(); await settled(page, 'VISIBILITY_PREVIEW');
        assert.match(await page.locator('#panel').innerText(), /겉모습만 눈으로 확인/);
        await page.evaluate(() => __inspect.dispatch({ type: 'OPEN_RESULT', id: 'light-low-beam-left-0' })); await settled(page, 'PART_RESULT');
        const text = await page.locator('#panel').innerText();
        assert.match(text, /겉모습만 눈으로 확인/);
        assert.equal(await page.locator('#panel h2').innerText(), '왼쪽 하향등');
      } finally { await context.close(); }
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
      // Ending asks only when this session holds answers, results or a live phone check (P10 PR #2).
      await page.locator('[data-action=exit]').click(); if (await page.locator('#exitConfirm:not([hidden])').count()) await page.locator('#exitConfirm [data-action=exit-confirm]').click(); await settled(page, 'IDLE');
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
