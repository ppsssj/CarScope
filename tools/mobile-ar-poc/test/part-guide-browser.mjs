// P12-A: the part guide on real inspection screens. Mobile Chrome, real QR v2 sync HTTP on a local session, fake XR runtime.
// Not a real phone or foldable. Layout sizes are viewports, and no real photo exists yet.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';
import { taskLinks } from '../public/inspection-tasks.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p12-a');
await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_MOBILE_ONLY', realPhone: 'NOT_RUN', realFoldable: 'NOT_RUN', realPhotos: 'NONE_AVAILABLE', checks: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };
const fakeSource = (await readFile(new URL('./fake-webxr.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');

let now = Date.now(), browser;
const authorizer = new LocalTestSessionCreationAuthorizer();
const plain = await startMobileDevServer({ now: () => now, authorizer });
const flagged = await startMobileDevServer({ now: () => now, authorizer, webxrGuide: true });
const contexts = [];
const closeAll = () => Promise.all(contexts.splice(0).map(context => context.close().catch(() => {})));

async function open({ host = plain, task = 'washer-fluid', viewport = { width: 390, height: 844 }, prepare, fake, qr = true, local = '#v=1&task=washer-fluid' } = {}) {
  now += 61_000; // Each scenario gets its own rate window; the limits stay as they are.
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(context);
  await context.addInitScript(`window.__media=0;if(navigator.mediaDevices){const g=navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.__media++;return g(c);};}`);
  if (fake) await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fake)}));`);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [], secrets: [] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/net::ERR_NO_BUFFER_SPACE/.test(message.text())) log.problems.push(message.text()); }); // The page retries that code itself: page-start-guard.js.
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }));
  if (prepare) await prepare(page);
  const receiver = new ReceiverClient({ baseUrl: host.url });
  let fragment = local;
  if (qr) { const session = await receiver.create(task); fragment = session.fragment; log.secrets.push(session.fragment.split('invite=')[1]); }
  page.on('response', async response => { if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); } });
  await page.goto(`${host.url}/${fragment}`);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  return { context, page, log, receiver };
}
const posted = (log, suffix) => log.requests.filter(r => r.method === 'POST' && r.url.endsWith(suffix)).length;
const pictures = log => log.requests.filter(r => /\/guide-[a-z0-9-]+\.svg$/.test(r.url));
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
const introGuide = page => page.locator('#step-intro details.part-guide');
const locationGuide = page => page.locator('details.part-location');
const state = page => page.evaluate(() => { const s = window.__selfInspection.state; return { step: s.step, mode: s.mode, checks: s.checks, id: s.record?.inspectionId ?? null, aids: s.record?.aids ?? null }; });
const loaded = (page, scope) => page.waitForFunction(selector => { const f = [...document.querySelectorAll(`${selector} figure`)]; return f.length === 2 && f.every(x => x.dataset.image === 'loaded'); }, scope);
// One guide on screen: each drawing has only its own description, and the note comes once, last.
async function drawingsOnly(guide, label) {
  assert.equal(await guide.locator('.part-guide-badge, .part-guide-credit').count(), 0, `${label}: no badge or source line`);
  const text = await guide.innerText();
  assert.ok(!text.includes('출처'), `${label}: no source line`);
  assert.equal(text.split('설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다').length, 2, `${label}: the note appears exactly once`);
  assert.equal(await guide.locator('.part-guide-body > :last-child').evaluate(node => node.classList.contains('part-guide-schematic-note')), true, `${label}: the note closes the guide`);
  const captions = await guide.locator('figcaption').allTextContents();
  assert.equal(captions.length, 2, label);
  assert.ok(captions[0] !== captions[1] && captions.every(caption => caption.length > 8 && !caption.includes('설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다')), `${label}: each drawing keeps its own description: ${captions}`);
}
const connected = page => page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
const zoomOpen = page => page.evaluate(() => Boolean(document.getElementById('part-guide-zoom')?.open));
async function noLeak({ page, log }) {
  const html = await page.content(), historyState = await page.evaluate(() => JSON.stringify(history.state));
  assert.equal(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie])), '[{},{},""]');
  assert.equal(new URL(page.url()).hash, '');
  for (const secret of log.secrets) {
    assert.ok(!html.includes(secret) && !historyState.includes(secret) && !page.url().includes(secret), 'token in the page, its history or its address');
    assert.ok(log.requests.every(r => !r.url.includes(secret) && !r.body.includes(secret)), 'token in a request');
  }
}

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  result.browser = browser.version();

  { // First step: closed, costs nothing, and shows the whole guide once opened.
    const { page, log } = await open();
    await connected(page);
    assert.equal(await introGuide(page).isVisible(), true);
    assert.equal(await page.locator('#step-intro details.part-guide summary').textContent(), '워셔액 주입구 찾는 법 보기');
    assert.equal(pictures(log).length, 0, 'a closed row asks for no picture');
    assert.equal(await page.locator('#primary').isVisible(), true, 'it is not a step in the way');
    await shot(page, 'intro-closed');
    await page.locator('#step-intro details.part-guide summary').click();
    await loaded(page, '#step-intro .part-guide');
    assert.equal(pictures(log).length, 2);
    const text = await introGuide(page).innerText();
    for (const words of ['앞유리를 닦는 워셔액', '보닛 안쪽', '설명용 그림', '설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다', '앞유리·분사 모양', '색만 보고 고르지', '고전압 케이블', '내 차 설명서를 먼저 확인']) assert.ok(text.includes(words), words);
    assert.deepEqual(await page.locator('#step-intro .part-guide img').evaluateAll(images => images.map(i => [i.alt.length > 10, i.naturalWidth > 0])), [[true, true], [true, true]]);
    assert.equal(await page.evaluate(() => window.__media), 0, 'no camera');
    await drawingsOnly(introGuide(page), 'washer');
    assert.deepEqual((await state(page)).step, 'intro', 'reading it starts nothing');
    await shot(page, 'intro-open', true);
    const link = page.locator('#step-intro .part-guide-manual a');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('first step: one closed row and no request until opened; then role, area, drawings with their own descriptions, alt text, what tells it apart, safety and applicability, with no camera');
  }

  { // Sizes the phone and its folded and open forms take. A viewport is not the device.
    for (const [name, viewport] of [['320', { width: 320, height: 568 }], ['flip-cover-344', { width: 344, height: 882 }], ['360', { width: 360, height: 740 }], ['390', { width: 390, height: 844 }], ['flip-open-412', { width: 412, height: 1007 }], ['landscape-844', { width: 844, height: 390 }], ['wide-884', { width: 884, height: 1104 }]]) {
      const { page } = await open({ viewport });
      await page.locator('#step-intro details.part-guide summary').click();
      await loaded(page, '#step-intro .part-guide');
      assert.equal(await fits(page), true, `${name} no sideways scroll`);
      const boxes = await page.locator('#step-intro .part-guide-frame').evaluateAll(frames => frames.map(f => { const r = f.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right }; }));
      assert.ok(boxes.every(box => box.right <= viewport.width && box.h >= 44 && box.h <= viewport.height), `${name} ${JSON.stringify(boxes)}`);
      await shot(page, `size-${name}`, true);
      await page.locator('#step-intro .part-guide-frame').first().click();
      assert.equal(await zoomOpen(page), true);
      const zoom = await page.evaluate(() => { const fit = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + .5 && r.bottom <= innerHeight + .5 && r.height >= 44; }; const d = document.getElementById('part-guide-zoom').getBoundingClientRect(); return { close: fit('part-guide-zoom-close'), toggle: fit('part-guide-zoom-toggle'), full: Math.round(d.width) === innerWidth }; });
      assert.deepEqual(zoom, { close: true, toggle: true, full: true }, name);
      await page.locator('#part-guide-zoom-close').click();
      await closeAll();
    }
    pass('at 320x568, 344x882, 360x740, 390x844, 412x1007, 844x390 and 884x1104 nothing scrolls sideways, and the enlarged view and its controls fit');
  }

  { // Enlarging, in every way of leaving it.
    const session = await open(), { page, log } = session;
    await connected(page);
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.locator('#step-intro details.part-guide summary').click();
    await loaded(page, '#step-intro .part-guide');
    const frame = page.locator('#step-intro .part-guide-frame').first();
    const length = await page.evaluate(() => history.length);
    await frame.click();
    assert.equal(await zoomOpen(page), true);
    assert.equal(await page.locator('.part-guide-zoom-caption').textContent(), await page.locator('#step-intro figcaption').first().textContent(), 'the enlarged view repeats only the drawing\'s own description');
    assert.ok((await page.locator('.part-guide-zoom-view img').getAttribute('alt')).length > 10);
    await shot(page, 'zoom');
    await page.locator('#part-guide-zoom-toggle').click();
    assert.equal(await page.locator('#part-guide-zoom-toggle').textContent(), '원래 크기');
    assert.ok(await page.evaluate(() => { const v = document.querySelector('.part-guide-zoom-view'); return v.scrollWidth > v.clientWidth; }), 'the bigger picture can be moved around');
    await shot(page, 'zoom-enlarged');
    await page.locator('#part-guide-zoom-close').click();
    assert.equal(await zoomOpen(page), false);
    await page.waitForFunction(() => !history.state?.carscopePartGuideZoom);
    assert.equal(await frame.evaluate(element => document.activeElement === element), true, 'focus returns to the picture');
    await frame.click();
    assert.equal(await page.locator('#part-guide-zoom-toggle').textContent(), '더 크게', 'it opens at the fitted size again');
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('part-guide-zoom').open);
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'Back closed the picture and stayed on the page');
    assert.equal(new URL(page.url()).hash, '', 'Back does not bring the invite back');
    await frame.click();
    await page.keyboard.press('Escape');
    assert.equal(await zoomOpen(page), false);
    await page.waitForFunction(() => !history.state?.carscopePartGuideZoom);
    assert.ok(await page.evaluate(n => history.length <= n + 1, length), 'entries do not pile up');
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    assert.equal(posted(log, '/v1/claim'), 1);
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('enlarging opens and closes by button, Esc and Back; Back never leaves the page, and history does not pile up');
  }

  { // A picture that cannot load: a sentence with what it shows, and the inspection goes on.
    const { page, log } = await open({ prepare: p => p.route('**/guide-*.svg', route => route.abort()) });
    await page.locator('#step-intro details.part-guide summary').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#step-intro .part-guide figure')].every(f => f.dataset.image === 'failed'));
    assert.equal(await page.locator('#step-intro .part-guide img').count(), 0, 'no broken image');
    assert.equal(await page.locator('#step-intro .part-guide-frame').count(), 0, 'no empty frame');
    const missing = await page.locator('#step-intro .part-guide-missing').allTextContents();
    assert.equal(missing.length, 2);
    assert.ok(missing.every(text => /불러오지 못했어요/.test(text) && text.length > 40), 'the description stays');
    assert.match(await introGuide(page).innerText(), /앞유리·분사 모양/);
    assert.equal(await fits(page), true);
    await shot(page, 'image-failed', true);
    assert.deepEqual(log.problems.filter(p => !/Failed to load resource/.test(p)), []);
    await page.locator('#manual-start').click();
    assert.equal((await state(page)).step, 'check');
    await closeAll();

    // Slow: the row says so, the frame holds its place, and the inspection does not wait for it.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const slow = await open({ prepare: p => p.route('**/guide-*.svg', async route => { await held; await route.continue(); }) });
    await slow.page.locator('#step-intro details.part-guide summary').click();
    await slow.page.locator('.part-guide-state').first().waitFor();
    assert.match(await slow.page.locator('.part-guide-state').first().textContent(), /불러오는 중/);
    assert.ok((await slow.page.locator('#step-intro .part-guide-frame').first().boundingBox()).height > 100, 'space is kept, so the page does not jump');
    assert.equal(await slow.page.locator('#step-intro .part-guide-frame').first().isDisabled(), true, 'nothing to enlarge yet');
    await shot(slow.page, 'image-slow', true);
    await slow.page.locator('#manual-start').click();
    assert.equal((await state(slow.page)).step, 'check', 'the inspection does not wait for a picture');
    release();
    await loaded(slow.page, '#step-intro .part-guide');
    await closeAll();
    pass('a failed picture leaves its description with no broken image or empty frame; a slow one holds its place and blocks nothing');
  }

  { // The location help during the inspection, with answers made and a live connection.
    const session = await open(), { page, log, receiver } = session;
    await connected(page);
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    const before = await state(page);
    assert.equal(await locationGuide(page).isVisible(), true);
    await page.locator('details.part-location > summary').click();
    await loaded(page, 'details.part-location');
    await drawingsOnly(locationGuide(page), 'washer location help');
    await shot(page, 'check-open', true);
    await page.locator('details.part-location .part-guide-frame').nth(1).click();
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('part-guide-zoom').open);
    assert.deepEqual(await state(page), before, 'reading and enlarging change no answer');
    assert.equal(await page.locator('#checklist input[value="parked"]').isChecked(), true);
    assert.equal(await page.evaluate(() => window.__media), 0);
    await page.locator('#checklist input:not(:checked)').evaluateAll(boxes => boxes.forEach(box => box.click()));
    await page.click('#primary'); await page.click('[data-status="OK"]'); await page.click('#primary'); await page.click('#primary');
    await page.waitForSelector('body[data-step="done"]');
    assert.equal(await locationGuide(page).isVisible(), false, 'gone once the result is made');
    await page.locator('#sync-send').click();
    await page.waitForFunction(() => document.getElementById('done-sync').dataset.syncState === 'SENT');
    const view = await receiver.view();
    assert.equal(view.result.inspectionId, before.id, 'the attempt from before the guide is what was sent');
    assert.deepEqual(view.result.aids, { cameraUsed: false, locationMarked: false }, 'the result contract and its values are unchanged');
    assert.equal(posted(log, '/v1/claim'), 1);
    assert.equal(posted(log, '/v1/submissions'), 1);
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('during the checklist it changes no answer, and the same connection sends the same attempt');
  }

  { // Camera step: the camera aid stays as it was.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] }); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.goto(`${plain.url}/#v=1&task=washer-fluid`);
    await page.waitForFunction(() => window.__selfInspection);
    await page.locator('#primary').click();
    assert.equal((await state(page)).step, 'locate');
    assert.equal(await locationGuide(page).isVisible(), true, 'one tap away while looking for the part');
    await page.locator('details.part-location > summary').click();
    await loaded(page, 'details.part-location');
    assert.equal(await fits(page), true);
    await closeAll();
    pass('on the locate step the same guide is one tap away');
  }

  { // WebXR: both ways round, with the connection held throughout.
    const session = await open({ host: flagged, fake: {} }), { page, log } = session;
    await connected(page);
    await page.waitForFunction(() => window.__webXrGuide?.capability);
    assert.equal(await page.locator('#xr-methods-title').isVisible(), true);
    const rows = await page.evaluate(() => ['xr-entry-open', 'xr-method-camera', 'manual-start'].map(id => document.getElementById(id).getBoundingClientRect().bottom));
    assert.ok(rows.every(bottom => bottom <= 844), `the three methods still fit the first screen: ${rows}`);
    assert.equal(await introGuide(page).isVisible(), true);
    await shot(page, 'webxr-methods');
    await page.locator('#step-intro details.part-guide summary').click();
    await loaded(page, '#step-intro .part-guide');
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    await page.locator('details.part-location > summary').click();
    await loaded(page, 'details.part-location');
    const before = await state(page);
    const runAr = async () => {
      await page.locator('#xr-entry-open').click();
      await page.waitForFunction(() => window.__webXrGuide.state?.phase === 'READY');
      await page.locator('#xr-start').click();
      await page.waitForFunction(() => window.__webXrGuide.state?.phase === 'AIMING');
    };
    await runAr();
    assert.equal(await page.locator('details.part-location').isVisible(), false, 'hidden under AR');
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.deepEqual(await state(page), before, 'AR leaves the attempt as it was');
    assert.equal(await page.locator('details.part-location').evaluate(d => d.open), true, 'the guide stays open as it was left');
    // Picture enlarged after AR, then Back: only the picture closes, and AR still opens and closes by Back.
    await page.locator('details.part-location .part-guide-frame').first().click();
    assert.equal(await zoomOpen(page), true);
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('part-guide-zoom').open);
    assert.equal(await page.evaluate(() => window.__webXrGuide.open), false);
    await runAr();
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await zoomOpen(page), false, 'Back from AR does not touch the picture');
    assert.equal(await page.evaluate(() => window.__env.sessions.every(s => s.ended)), true);
    assert.deepEqual(await state(page), before);
    assert.equal(posted(log, '/v1/claim'), 1, 'one claim across all of it');
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('WebXR entry, exit and Back keep the answers, the attempt, the connection and the open guide, and each Back closes only what is on top');
  }

  { // Every part with an inspection, on its real page: each gets its own two drawings and its own words, and nothing loads before opening.
    const areas = new Set(), details = new Set(), read = [];
    for (const { id, href } of taskLinks()) {
      const { page, log } = await open({ qr: false, local: href });
      await page.locator('#step-intro details.part-guide').waitFor();
      assert.equal(pictures(log).length, 0, `${id}: closed row asks for nothing`);
      await page.locator('#step-intro details.part-guide summary').click();
      await loaded(page, '#step-intro .part-guide');
      const seen = await page.locator('#step-intro .part-guide img').evaluateAll(images => images.map(i => ({ src: new URL(i.src).pathname.split('/').pop(), alt: i.alt, width: i.naturalWidth })));
      assert.equal(seen.length, 2, id);
      assert.ok(seen.every(image => image.width > 0 && image.alt.length > 15), id);
      areas.add(seen[0].src); details.add(seen[1].src);
      const chipClear = await page.locator('#step-intro .part-guide-frame').evaluateAll(frames => frames.every(frame => frame.querySelector('img').getBoundingClientRect().bottom <= frame.getBoundingClientRect().bottom - 28));
      assert.equal(chipClear, true, `${id}: the enlarge label does not cover the drawing`);
      const text = await introGuide(page).innerText();
      for (const words of ['설명용 그림', '설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다', '이렇게 구별해요', '꼭 지켜 주세요']) assert.ok(text.includes(words), `${id}: ${words}`);
      assert.ok(!text.includes('사진'), `${id}: no word about photos on screen`);
      assert.equal(await page.locator('.part-guide-no-picture').count(), 0, id);
      await drawingsOnly(introGuide(page), id);
      assert.equal(await fits(page), true, id);
      assert.equal(await page.evaluate(() => window.__media), 0, id);
      read.push(id);
      await closeAll();
    }
    assert.equal(read.length, 17);
    assert.equal(areas.size, 17, 'each part has its own location drawing');
    assert.equal(details.size, 17, 'each part has its own close-up');
    pass('all 17 inspection parts open their own two drawings and words on their own page, load nothing until opened, and need no camera');
  }

  { // Left and right, on screen: the bright wheel is really on the named side.
    for (const [href, side] of [['#task=tire.front-left', 'left'], ['#task=tire.rear-right', 'right']]) {
      const { page } = await open({ qr: false, local: href });
      await page.locator('#step-intro details.part-guide summary').click();
      await loaded(page, '#step-intro .part-guide');
      assert.equal(await page.locator('#step-intro .part-guide img').first().evaluate(i => i.getAttribute('src').includes('tire-')), true);
      assert.match(await page.locator('#step-intro .part-guide-figure').first().innerText(), side === 'left' ? /왼쪽/ : /오른쪽/);
      await closeAll();
    }
    pass('tires name the side they draw');
  }

  { // QR on a checklist part: answers, connection and result survive the guide.
    const session = await open({ task: 'tire.front-left' }), { page, log, receiver } = session;
    await connected(page);
    await page.locator('#step-intro details.part-guide summary').click();
    await loaded(page, '#step-intro .part-guide');
    await page.locator('#safety').check();
    await page.locator('#manual-start').click();
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'check');
    await page.locator('input[value=NOT_FOUND]').check();
    await page.waitForFunction(() => window.__checklistInspection.state.index === 1);
    const before = await page.evaluate(() => JSON.stringify(window.__checklistInspection.state.record));
    await page.locator('details.part-location > summary').click();
    await loaded(page, 'details.part-location');
    await shot(page, 'tire-check-open', true);
    await page.locator('details.part-location .part-guide-frame').first().click();
    assert.equal(await zoomOpen(page), true);
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('part-guide-zoom').open);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__checklistInspection.state.record)), before, 'the guide changes no answer');
    for (const index of [1, 2]) { await page.waitForFunction(i => window.__checklistInspection.state.index === i, index); await page.locator('input[value=NOT_FOUND]').check(); }
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'review');
    await page.locator('#primary').click();
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'done');
    await page.locator('#sync-send').click();
    await page.waitForFunction(() => document.getElementById('done-sync').dataset.syncState === 'SENT');
    const view = await receiver.view();
    assert.equal(view.result.taskId, 'tire.front-left');
    assert.equal(posted(log, '/v1/claim'), 1);
    assert.equal(posted(log, '/v1/submissions'), 1);
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('on a QR checklist part the guide changes no answer, Back closes only the picture, and the same connection sends');
  }

  { // The two parts with no inspection: a page of their own, reached without leaving an inspection, and no task or result anywhere.
    const session = await open({ task: 'ev-charge.port' }), { page, log, context } = session;
    await connected(page);
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.locator('#step-intro details.part-guide summary').click();
    await loaded(page, '#step-intro .part-guide');
    const links = page.locator('#step-intro .part-guide-related a');
    assert.deepEqual(await links.allTextContents(), ['EV 충전구 덮개', '고전압 배터리 팩']);
    assert.equal(await links.first().getAttribute('target'), '_blank');
    assert.equal(await links.first().getAttribute('rel'), 'noopener noreferrer');
    const [info] = await Promise.all([context.waitForEvent('page'), links.nth(1).click()]);
    await info.waitForFunction(() => document.body.dataset.partInfo === 'ev-battery.pack');
    await info.waitForFunction(() => { const f = [...document.querySelectorAll('figure')]; return f.length === 2 && f.every(x => x.dataset.image === 'loaded'); });
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'the inspection tab stayed where it was');
    assert.equal(posted(log, '/v1/claim'), 1);
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    await info.close();
    await closeAll();

    for (const [id, words] of [['ev-battery.pack', ['점검 항목이 아니에요', '차 아래로 들어가거나', '주황색', '설명용 그림']], ['ev-charge.flap', ['점검 항목이 아니에요', '억지로 열거나', '충전구와 같은']]]) {
      const context2 = await browser.newContext({ viewport: { width: 344, height: 882 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); contexts.push(context2);
      const infoPage = await context2.newPage(); infoPage.setDefaultTimeout(15000);
      const requests = [], problems = [];
      infoPage.on('request', request => requests.push(request.url()));
      infoPage.on('pageerror', error => problems.push(error.message));
      infoPage.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
      await infoPage.goto(`${plain.url}/mobile-ar-poc/public/part-info.html#${id}`);
      await infoPage.waitForFunction(value => document.body.dataset.partInfo === value, id);
      await infoPage.waitForFunction(() => { const f = [...document.querySelectorAll('figure')]; return f.length === 2 && f.every(x => x.dataset.image === 'loaded'); });
      const text = await infoPage.locator('main').innerText();
      for (const part of words) assert.ok(text.includes(part), `${id}: ${part}`);
      assert.ok(!text.includes('찾아볼 곳:'), `${id}: nothing sends a person to look for it`);
      assert.ok(!text.includes('사진'), `${id}: no word about photos on screen`);
      await drawingsOnly(infoPage.locator('main'), id);
      assert.ok(text.includes('있는 곳:'), id);
      assert.equal(requests.some(url => url.includes('/v1/')), false, 'no session or result request');
      assert.equal(await infoPage.evaluate(() => Boolean(window.__selfInspection || window.__checklistInspection)), false, 'no inspection runs here');
      assert.equal(await infoPage.locator('#checklist, #primary, #sync-send, input').count(), 0, 'nothing to answer or send');
      assert.equal(await infoPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await infoPage.screenshot({ path: path.join(output, `info-${id}.png`), fullPage: true });
      await infoPage.locator('.part-guide-frame').first().click();
      assert.equal(await infoPage.evaluate(() => document.getElementById('part-guide-zoom').open), true);
      await infoPage.goBack();
      await infoPage.waitForFunction(() => !document.getElementById('part-guide-zoom').open);
      // A part with an inspection, or nonsense, is not shown here.
      for (const other of ['washer-fluid-cap', 'tire.front-left', 'nothing', '']) {
        await infoPage.evaluate(value => { location.hash = value; }, other);
        await infoPage.waitForFunction(() => document.body.dataset.partInfo === 'none' || location.hash === '');
        if (other) assert.equal(await infoPage.evaluate(() => document.body.dataset.partInfo), 'none', other);
        assert.equal(await infoPage.locator('figure').count(), 0, other);
      }
      assert.deepEqual(problems, [], id);
      await closeAll();
    }
    pass('the two parts with no inspection open in their own read-only page with no task, answer, request or result, and that page refuses any other part');
  }

  { // What may not be shown.
    const { page } = await open({ qr: false });
    const rendered = await page.evaluate(async () => {
      const { renderPartGuide } = await import('/mobile-ar-poc/public/part-guide.mjs');
      const { PART_GUIDES, IMAGE_KIND, LICENSE } = await import('/mobile-ar-poc/public/part-guides.mjs');
      const base = { ...PART_GUIDES['washer-fluid-cap'], partId: 'brake-fluid-reservoir', taskId: 'brake-fluid', title: '브레이크액' };
      const photo = { file: 'guide-brake-fluid-reservoir-area.svg', kind: IMAGE_KIND.PHOTO, alt: '설명', caption: '캡션', imageSource: '소유자 서면 허가', licenseStatus: LICENSE.PERMISSION_GRANTED, vehicle: { make: 'Make', model: 'Model', year: 2024 } };
      const show = async guide => {
        const { body, load } = renderPartGuide(guide); document.querySelector('main').append(body); load();
        const figures = () => [...body.querySelectorAll('figure')];
        for (let i = 0; i < 50 && figures().some(f => f.dataset.image === 'waiting'); i++) await new Promise(r => setTimeout(r, 40));
        const out = { images: body.querySelectorAll('img').length, figures: figures().length, loaded: figures().filter(f => f.dataset.image === 'loaded').length, text: body.innerText };
        body.remove(); return out;
      };
      return {
        valid: await show({ ...base, overviewImage: photo, detailImage: null }),
        unverified: await show({ ...base, overviewImage: { ...photo, licenseStatus: LICENSE.UNVERIFIED }, detailImage: { ...photo, vehicle: null } }),
        none: await show({ ...base, overviewImage: null, detailImage: null, manualReference: null }),
      };
    });
    assert.deepEqual([rendered.valid.images, rendered.valid.loaded], [1, 1], 'a photo with its record is shown');
    assert.match(rendered.valid.text, /2024 Make Model 사진이에요\. 내 차와 다를 수 있어요\./);
    assert.match(rendered.valid.text, /실제 사진/);
    assert.match(rendered.valid.text, /소유자 서면 허가/);
    assert.ok(!rendered.valid.text.includes('설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다'), 'the note about drawings is not said of a photo');
    assert.deepEqual([rendered.unverified.images, rendered.unverified.figures], [0, 0], 'a photo with no right to use it or no known vehicle is not shown');
    assert.match(rendered.unverified.text, /아직 준비된 그림이 없어요/);
    assert.deepEqual([rendered.none.images, rendered.none.figures], [0, 0]);
    assert.match(rendered.none.text, /아직 준비된 그림이 없어요/);
    assert.ok(!rendered.none.text.includes('설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다'), 'no drawing, no note about drawings');
    assert.match(rendered.none.text, /앞유리·분사 모양/, 'the words remain');
    await closeAll();
    pass('the same screen labels a real photo with its vehicle and source, refuses one without them, and with no picture at all still gives its words');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await plain.stop();
  await flagged.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, errors: result.errors }, null, 2));
}
