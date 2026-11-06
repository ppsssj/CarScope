// The driver-facing behavior of the mobile inspection, in synthetic mobile Chrome. No real phone, camera or vehicle.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';
import { taskLinks } from '../public/inspection-tasks.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.isAbsolute(base) || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'ux'); await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_MOBILE_ONLY', realPhone: 'NOT_RUN', realFoldable: 'NOT_RUN', checks: [], errors: [] };
const pass = text => result.checks.push(`PASS: ${text}`);
// Words a driver should not meet on an ordinary screen. Closed help and the Debug area are not rendered text.
const JARGON = /session|sync|digest|proof|binding|native|authority|endpoint|payload|schema|USER_REPORTED|\bSELF\b|QR v2|토큰|세션|바인딩/i;
let browser, sync, now = Date.now();
const contexts = [];
const SMALL = { width: 320, height: 568 }, PHONE = { width: 390, height: 844 };
async function open({ task, viewport = PHONE, prepare } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const logs = []; page.on('console', m => logs.push(m.text()));
  if (prepare) await prepare(page);
  now += 61_000; // Each scenario gets its own rate window; the limits themselves stay as they are.
  const receiver = new ReceiverClient({ baseUrl: sync.url }), session = await receiver.create(task);
  await page.goto(sync.url + '/' + session.fragment);
  await page.waitForFunction(() => window.__checklistInspection || window.__selfInspection);
  return { page, receiver, session, errors, logs };
}
const S = page => page.evaluate(() => { const s = (window.__checklistInspection ?? window.__selfInspection).state; return { step: s.step, index: s.index, responses: s.record?.responses ?? null, stopped: s.observationStopped ?? null, status: s.record?.status ?? null }; });
const startManual = async page => { await page.locator('#safety').check(); if (await page.locator('#not-charging').count()) await page.locator('#not-charging').check(); await page.locator('#manual-start').click(); };
const waitQuestion = (page, index) => page.waitForFunction(i => window.__checklistInspection.state.step === 'check' && window.__checklistInspection.state.index === i, index);
const waitReview = page => page.waitForFunction(() => window.__checklistInspection.state.step === 'review');
async function plainWords(page, where) {
  const text = await page.locator('body').innerText();
  assert.doesNotMatch(text, JARGON, `${where}: ${text.slice(0, 200)}`);
}
async function fits(page, where) {
  const report = await page.evaluate(() => {
    const small = [...document.querySelectorAll('button, summary, a, label')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).map(el => `${el.tagName}#${el.id}:${el.textContent.trim().slice(0, 20)}`);
    const action = [...document.querySelectorAll('.actions button')].find(b => b.getBoundingClientRect().height > 0 && getComputedStyle(b).display !== 'none' && b.classList.contains('primary'));
    const box = action?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth, small, actionInView: !!box && box.bottom <= innerHeight + 1 && box.top >= 0 };
  });
  assert.equal(report.overflow, false, `${where}: horizontal overflow`);
  assert.deepEqual(report.small, [], `${where}: touch targets under 44px`);
  assert.equal(report.actionInView, true, `${where}: the main action is on screen`);
}

try {
  sync = await startMobileDevServer({ port: 0, now: () => now, authorizer: new LocalTestSessionCreationAuthorizer() });
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true }); result.browser = browser.version();

  { // The whole flow on the smallest supported phone, with plain words on every screen.
    for (const [task, viewport] of [['tire.front-left', SMALL], ['ev-charge.port', { width: 360, height: 740 }], ['battery-12v', SMALL], ['wiper.front.left', { width: 344, height: 882 }], ['light-low-beam-left-0', { width: 884, height: 1104 }], ['coolant-reservoir', { width: 667, height: 375 }]]) {
      const { page, receiver, errors, logs } = await open({ task, viewport });
      const where = `${task} ${viewport.width}x${viewport.height}`;
      await page.waitForFunction(() => document.querySelector('#sync-connection').dataset.tone === 'ok');
      assert.match(await page.locator('#sync-connection').innerText(), /차량과 연결됐어요/);
      await plainWords(page, `${where} intro`); await fits(page, `${where} intro`);
      assert.equal(await page.locator('#manual-start').isDisabled(), true, 'nothing starts before the safety check');
      assert.match(await page.locator('#safety-limit').innerText(), /위 안전 조건을 지킬 수 없다면 점검을 시작하지 마세요\./);
      assert.equal(await page.locator('#primary').isDisabled(), true);
      await startManual(page);
      for (const index of [0, 1, 2]) {
        await waitQuestion(page, index);
        await plainWords(page, `${where} question`); await fits(page, `${where} question`);
        assert.equal(await page.locator('.inspection-answers label').count(), 3);
        await page.locator('input[value=NOT_FOUND]').check();
      }
      await waitReview(page); await plainWords(page, `${where} review`); await fits(page, `${where} review`);
      await page.locator('#primary').click();
      await page.waitForFunction(() => window.__checklistInspection.state.step === 'done');
      await plainWords(page, `${where} done`); await fits(page, `${where} done`);
      assert.match(await page.locator('#done-title').innerText(), /차량으로 보내/);
      assert.equal(await page.locator('#primary').isVisible(), false, 'a new inspection cannot replace sending the result');
      assert.equal(await page.locator('#sync-send').isEnabled(), true);
      assert.equal(await receiver.view().then(v => v.resultDigest ?? null), null, 'finishing sends nothing by itself');
      await page.locator('#sync-send').click();
      await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'SENT');
      assert.match(await page.locator('#done-title').innerText(), /보냈어요/);
      assert.doesNotMatch(await page.locator('body').innerText(), /차량 앱에 전달됐어요|저장했어요/, 'sending is not the vehicle app taking it');
      assert.equal(await page.locator('#sync-timeline li.current').innerText(), '차량 앱 수신');
      const view = await receiver.view(); await receiver.accept(view.resultDigest);
      await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'ACCEPTED', null, { timeout: 8000 });
      assert.match(await page.locator('#done-title').innerText(), /차량 앱에 전달됐어요/);
      assert.equal(await page.locator('#sync-timeline li.done').count(), 3);
      { const confirmed = await page.locator('body').innerText();
        assert.match(await page.locator('#done-sync').innerText(), /차량 소유자의 승인이나 차량 안전 판정을 뜻하지 않아요/, 'the automatic receipt never reads as a person approving');
        assert.match(confirmed, /정상·안전을 판정하지 않아요/);
        for (const claim of [/승인했어요/, /소유자가 확인/, /차량에서 확인했어요/, /안전합니다/, /안전해요/, /정상입니다/, /주행해도/, /주행 가능합니다/]) assert.doesNotMatch(confirmed, claim, where); }
      await plainWords(page, `${where} confirmed`);
      assert.deepEqual(errors, [], where);
      assert.ok(!logs.some(line => /invite|token|bearer|submit/i.test(line)), `${where}: nothing about credentials in the console`);
    }
    pass('tire, charge, bonnet, wiper and lamp finish with plain words, no overflow, 44px targets and the main action on screen at 320, 344, 360, 667 landscape and 884 wide');
  }

  { // Answering: a tap moves on, a key does not, and a finding that asks to stop stays on screen.
    const { page } = await open({ task: 'tire.front-left' });
    await startManual(page); await waitQuestion(page, 0);
    await page.locator('input[value=UNABLE]').check(); await waitQuestion(page, 1);
    pass('a tapped answer moves on by itself');
    { await page.locator('#back').click(); await waitQuestion(page, 0); await page.waitForTimeout(400);
      const tapAndTime = (selector) => page.evaluate(async (sel) => { const input = document.querySelector(sel), label = input.closest('label'), state = () => window.__checklistInspection.state.index; const start = state(); label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); input.click(); const t0 = performance.now(); const samples = []; while (state() === start && performance.now() - t0 < 3000) { samples.push(performance.now() - t0); await new Promise(r => setTimeout(r, 10)); } return { elapsed: performance.now() - t0, stayedAt100: samples.some(t => t >= 100) }; }, selector);
      const timed = await tapAndTime('input[value=NOT_FOUND]');
      assert.ok(timed.elapsed >= 300 && timed.elapsed < 1500, `moves on about 320ms after the tap, measured ${timed.elapsed}`);
      assert.equal(timed.stayedAt100, true, 'the choice stays visible first');
      await waitQuestion(page, 1); await page.locator('#back').click(); await waitQuestion(page, 0); await page.waitForTimeout(400);
      const reTap = await page.evaluate(async () => { const pick = v => { const input = document.querySelector(`input[value=${v}]`); input.closest('label').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); input.click(); }; const s = () => window.__checklistInspection.state; pick('FOUND'); await new Promise(r => setTimeout(r, 200)); pick('UNABLE'); const t0 = performance.now(); while (s().index === 0 && performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10)); return { elapsed: performance.now() - t0, answer: s().record.responses.damage, index: s().index }; });
      assert.ok(reTap.elapsed >= 300, `a second tap restarts the wait, measured ${reTap.elapsed}`);
      assert.deepEqual([reTap.answer, reTap.index], ['UNABLE', 1], 'the last tap is the answer and only one question passes');
      await page.locator('#back').click(); await waitQuestion(page, 0); await page.waitForTimeout(400);
      await page.evaluate(() => { const input = document.querySelector('input[value=NOT_FOUND]'); input.closest('label').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); input.click(); document.querySelector('#primary').click(); });
      await page.waitForTimeout(600);
      assert.equal((await S(page)).index, 1, 'the button during the wait moves one question, not two');
      await page.locator('#back').click(); await waitQuestion(page, 0); await page.waitForTimeout(400);
      await page.locator('input[value=UNABLE]').check(); await waitQuestion(page, 1); await page.waitForTimeout(400);
      pass('320ms: the choice shows first, a second tap restarts the wait, and the button cannot skip a question'); }
    await page.locator('#back').click(); await waitQuestion(page, 0);
    assert.equal(await page.locator('input[value=UNABLE]').isChecked(), true, 'going back keeps the answer');
    assert.equal(await page.locator('.inspection-answers label.selected').getAttribute('data-tone'), 'unable');
    await page.locator('input[value=UNABLE]').focus(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(600);
    const keyed = await S(page);
    assert.equal(keyed.index, 0, 'arrow keys choose without leaving the question');
    assert.equal(keyed.responses.damage, 'NOT_FOUND');
    await page.locator('#primary').focus(); await page.keyboard.press('Enter'); await waitQuestion(page, 1);
    pass('keyboard: arrows choose and the button moves on');

    const brake = await open({ task: 'brake-fluid' });
    await startManual(brake.page); await waitQuestion(brake.page, 0);
    const layout = p => p.evaluate(() => { const box = s => document.querySelector(s).getBoundingClientRect(), footer = box('.actions').top, cards = [...document.querySelectorAll('.inspection-answers label')].map(l => l.getBoundingClientRect()); return { stopTop: box('#inspection-safety').top, questionTop: box('#question-title').top, lastAnswerBottom: cards.at(-1).bottom, firstAnswerTop: cards[0].top, footer }; });
    { const before = await layout(brake.page);
      assert.ok(before.lastAnswerBottom <= before.footer, 'every answer is on screen on a usual phone');
      assert.ok(before.stopTop > before.lastAnswerBottom, 'the stop rule follows the answers'); }
    const small = await open({ task: 'battery-12v', viewport: SMALL });
    await startManual(small.page); await waitQuestion(small.page, 0);
    { const place = await layout(small.page);
      assert.ok(place.questionTop >= 0 && place.firstAnswerTop < place.footer, `the question and first answer show on 320x568: ${JSON.stringify(place)}`); }
    await brake.page.locator('input[value=FOUND]').check(); await brake.page.waitForTimeout(600);
    const found = await S(brake.page);
    assert.equal(found.index, 0, 'a finding stays on the question'); assert.equal(found.stopped, true);
    assert.equal(await brake.page.locator('#observation-stopped').isVisible(), true);
    assert.equal(await brake.page.locator('.inspection-answers label.selected').getAttribute('data-tone'), 'found');
    assert.match(await brake.page.locator('#stop-rule').innerText(), /바로 물러나/, 'the stop rule is on screen, not behind a tap');
    { const after = await layout(brake.page); assert.ok(after.stopTop < after.questionTop, 'once stopped, the message comes before the question'); }
    assert.equal(await brake.page.locator('#safety-stop').isVisible(), false);
    await brake.page.locator('#primary').click(); await waitQuestion(brake.page, 1);
    assert.equal(await brake.page.locator('#observation-stopped').isVisible(), true, 'the stop stays for the following questions');
    await brake.page.locator('input[value=UNABLE]').check(); await waitQuestion(brake.page, 2);
    pass('a finding on a part with a stop rule shows the stop message and waits');
  }

  { // Review: change one answer and come back. The result keeps the stored values.
    const { page, receiver } = await open({ task: 'tire.front-left' });
    await startManual(page);
    for (const index of [0, 1, 2]) { await waitQuestion(page, index); await page.locator('input[value=NOT_FOUND]').check(); }
    await waitReview(page);
    await page.getByRole('button', { name: '눈에 띄는 이물질 수정' }).click();
    await waitQuestion(page, 1);
    await page.locator('input[value=FOUND]').check(); await waitReview(page);
    assert.match(await page.locator('#confirm-summary').innerText(), /이상이 보여요/);
    await page.getByRole('button', { name: '갈라짐이나 손상 수정' }).click(); await waitQuestion(page, 0);
    await page.waitForTimeout(400); // Past the double-tap guard: a real second action, not a bounce.
    await page.locator('#back').click(); await waitReview(page);
    await page.waitForTimeout(400);
    await page.locator('#primary').click();
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'done');
    assert.deepEqual((await S(page)).responses, { damage: 'NOT_FOUND', debris: 'FOUND', wear: 'NOT_FOUND' });
    assert.equal((await S(page)).status, 'REVIEW_NEEDED');
    await page.waitForFunction(() => !document.querySelector('#sync-send').disabled);
    await page.locator('#sync-send').evaluate(b => { b.click(); b.click(); });
    await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'SENT');
    const view = await receiver.view();
    assert.equal(view.result.responses.debris, 'FOUND'); assert.equal(view.result.status, 'REVIEW_NEEDED');
    assert.equal(await page.locator('#sync-send').isVisible(), false, 'sent once, and there is nothing to send again');
    pass('changing an answer returns to the review, keeps stored values, and a double tap sends once');
  }

  { // Failure is plain, retry sends the same result, and a dead connection asks for a new QR.
    let failing = true;
    const { page, receiver } = await open({ task: 'tire.front-left', prepare: p => p.route('**/v1/submissions', route => failing ? route.abort('failed') : route.continue()) });
    await startManual(page);
    for (const index of [0, 1, 2]) { await waitQuestion(page, index); await page.locator('input[value=UNABLE]').check(); }
    await waitReview(page); await page.locator('#primary').click();
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'done');
    await page.waitForFunction(() => !document.querySelector('#sync-send').disabled);
    await page.locator('#sync-send').click();
    await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'FAILED_NETWORK');
    assert.match(await page.locator('#done-title').innerText(), /보내지 못했어요/);
    assert.equal(await page.locator('#sync-send').innerText(), '같은 결과 다시 보내기');
    assert.equal(await page.locator('#sync-timeline li.failed').innerText(), '결과 전송');
    await plainWords(page, 'failed send');
    failing = false;
    await page.locator('#sync-send').click();
    await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'SENT');
    assert.equal((await receiver.view()).sessionState, 'RESULT_SUBMITTED');
    pass('a failed send says so and the same result can be sent again');

    const lost = await open({ task: 'tire.front-left', prepare: p => p.route('**/v1/claim', route => route.abort('failed')) });
    await lost.page.waitForFunction(() => document.querySelector('#sync-connection').dataset.tone === 'error');
    assert.match(await lost.page.locator('#sync-connection').innerText(), /QR을 다시/);
    await plainWords(lost.page, 'failed connection');
    pass('a failed connection asks for a new QR in plain words');

    const cancelled = await open({ task: 'tire.front-left' });
    await cancelled.page.waitForFunction(() => document.querySelector('#sync-connection').dataset.tone === 'ok');
    await cancelled.receiver.cancel();
    await cancelled.page.waitForFunction(() => document.querySelector('#sync-connection').dataset.tone === 'error', null, { timeout: 8000 });
    assert.match(await cancelled.page.locator('#sync-connection').innerText(), /차량에서 점검을 취소/);
    pass('a vehicle cancel reaches the phone as a clear message');
  }

  { // Details stay reachable, and every part keeps its own full text one tap away.
    for (const { id } of taskLinks().filter(t => t.id !== 'washer-fluid')) {
      const { page } = await open({ task: id });
      await page.locator('#step-intro details.help summary').click();
      const help = await page.locator('#step-intro details.help').innerText();
      assert.ok(help.length > 120, id);
      assert.match(help, /확인|하지 마세요|않습니다/, id);
      await page.context().close();
    }
    pass('every part keeps its full position, limitation and safety text under 자세한 안내');
    const { page } = await open({ task: 'tire.front-left' });
    assert.equal(await page.locator('#result-json').isVisible(), false, 'developer data is closed');
    await startManual(page);
    for (const index of [0, 1, 2]) { await waitQuestion(page, index); await page.locator('input[value=NOT_FOUND]').check(); }
    await waitReview(page); await page.locator('#primary').click();
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'done');
    await page.locator('#debug-area summary').click();
    assert.match(await page.locator('#result-json').innerText(), /"confirmation": "USER_REPORTED"/);
    assert.match(await page.locator('#debug-sync').innerText(), /display=NOT_SENT/);
    assert.doesNotMatch(await page.locator('#debug-area').innerText(), /invite|submitToken|receiverToken|bearer/i);
    pass('the Debug area keeps the raw record and state, and no credential');
  }

  { // Washer keeps its own steps: checklist, then a result choice.
    const { page } = await open();
    await page.waitForFunction(() => window.__selfInspection);
    await plainWords(page, 'washer intro'); await fits(page, 'washer intro');
    assert.equal(await page.locator('#guidance').isVisible(), false);
    await page.locator('#manual').click();
    assert.equal(await page.locator('#guidance').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'guidance');
    await page.locator('#guidance-close').click();
    assert.equal(await page.locator('#guidance').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'manual');
    await page.locator('#manual-start').click();
    await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(b => b.click()));
    await page.locator('#primary').click();
    await page.locator('[data-status="NEEDS_REFILL"]').click();
    assert.equal(await page.locator('[data-status="NEEDS_REFILL"]').getAttribute('aria-checked'), 'true');
    await plainWords(page, 'washer choice');
    await page.locator('#primary').click();
    assert.match(await page.locator('#confirm-summary').innerText(), /보충이 필요해요/);
    await page.getByRole('button', { name: '워셔액 상태 수정' }).click();
    await page.waitForFunction(() => window.__selfInspection.state.step === 'result');
    await page.locator('#primary').click(); await page.locator('#primary').click();
    await page.waitForFunction(() => window.__selfInspection.state.step === 'done');
    assert.equal((await page.evaluate(() => window.__selfInspection.state.record.status)), 'NEEDS_REFILL');
    assert.match(await page.locator('#done-outcome').innerText(), /보충이 필요해요/);
    pass('washer: help opens and returns focus, the stored status is unchanged, and the choice can be changed');
  }

  { // Finding the part: the instruction comes first and the camera stays on screen.
    const init = p => p.addInitScript(() => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; const c = canvas.getContext('2d'); setInterval(() => { c.fillStyle = '#66727c'; c.fillRect(0, 0, 640, 480); }, 60); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => canvas.captureStream(10) } }); });
    const { page } = await open({ task: 'brake-fluid', viewport: { width: 360, height: 640 }, prepare: init });
    await page.locator('#safety').check(); await page.locator('#primary').click();
    await page.waitForFunction(() => document.querySelector('#placeholder').hidden);
    const place = await page.evaluate(() => { const y = s => document.querySelector(s).getBoundingClientRect(), title = y('#step-locate h2'), stage = y('#stage'), guide = y('.part-location'), footer = y('.actions'); return { titleFirst: title.bottom <= stage.top, guideBelow: guide.top >= stage.bottom, stageInView: stage.top >= 0 && stage.top < innerHeight * .5 && footer.top <= innerHeight + 1 }; });
    assert.deepEqual(place, { titleFirst: true, guideBelow: true, stageInView: true });
    await plainWords(page, 'locate'); await fits(page, 'locate');
    pass('the find step reads instruction, camera, then help, with the camera in the upper half of a 640px screen');
  }

  { // Direct visit: nothing connects and nothing claims to.
    const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true }); contexts.push(context);
    const page = await context.newPage(); await page.goto(sync.url + '/'); await page.waitForFunction(() => window.__selfInspection);
    assert.match(await page.locator('#handoff-status').innerText(), /이 휴대폰에만 기록돼요/);
    assert.equal(await page.locator('#sync-connection').count(), 0);
    assert.equal(await page.locator('.task-links a').first().isVisible(), false, 'other parts are one tap away');
    pass('a direct visit stays local and says so');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.errors.push(String(error?.stack ?? error));
} finally {
  await browser?.close();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'PASS' ? 0 : 1);
}
