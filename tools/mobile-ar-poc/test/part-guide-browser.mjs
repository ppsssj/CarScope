// P12-A: the part guide on real inspection screens. Mobile Chrome, real QR v2 sync HTTP on a local session, fake XR runtime.
// Not a real phone or foldable. Layout sizes are viewports, and no real photo exists yet.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';

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

async function open({ host = plain, task = 'washer-fluid', viewport = { width: 390, height: 844 }, prepare, fake, qr = true } = {}) {
  now += 61_000; // Each scenario gets its own rate window; the limits stay as they are.
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(context);
  await context.addInitScript(`window.__media=0;if(navigator.mediaDevices){const g=navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.__media++;return g(c);};}`);
  if (fake) await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fake)}));`);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [], secrets: [] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') log.problems.push(message.text()); });
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }));
  if (prepare) await prepare(page);
  const receiver = new ReceiverClient({ baseUrl: host.url });
  let fragment = '#v=1&task=washer-fluid';
  if (qr) { const session = await receiver.create(task); fragment = session.fragment; log.secrets.push(session.fragment.split('invite=')[1]); }
  page.on('response', async response => { if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); } });
  await page.goto(`${host.url}/${fragment}`);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  return { context, page, log, receiver };
}
const posted = (log, suffix) => log.requests.filter(r => r.method === 'POST' && r.url.endsWith(suffix)).length;
const pictures = log => log.requests.filter(r => /guide-washer-.*\.svg$/.test(r.url));
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
const introGuide = page => page.locator('#step-intro details.part-guide');
const locationGuide = page => page.locator('details.part-location');
const state = page => page.evaluate(() => { const s = window.__selfInspection.state; return { step: s.step, mode: s.mode, checks: s.checks, id: s.record?.inspectionId ?? null, aids: s.record?.aids ?? null }; });
const loaded = (page, scope) => page.waitForFunction(selector => { const f = [...document.querySelectorAll(`${selector} figure`)]; return f.length === 2 && f.every(x => x.dataset.image === 'loaded'); }, scope);
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
    for (const words of ['앞유리를 닦는 워셔액', '보닛 안쪽', '설명용 그림', '실제 사진이 아니에요', '아직 실제 사진이 없어', '앞유리·분사 모양', '색만 보고 고르지', '고전압 케이블', '내 차 설명서로 확인']) assert.ok(text.includes(words), words);
    assert.deepEqual(await page.locator('#step-intro .part-guide img').evaluateAll(images => images.map(i => [i.alt.length > 10, i.naturalWidth > 0])), [[true, true], [true, true]]);
    assert.equal(await page.evaluate(() => window.__media), 0, 'no camera');
    assert.deepEqual((await state(page)).step, 'intro', 'reading it starts nothing');
    await shot(page, 'intro-open', true);
    const link = page.locator('#step-intro .part-guide-manual a');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('first step: one closed row and no request until opened; then role, area, drawings marked as not photos, alt text, what tells it apart, safety and applicability, with no camera');
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
    assert.match(await page.locator('.part-guide-zoom-caption').textContent(), /실제 사진이 아니에요/);
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
    const { page, log } = await open({ prepare: p => p.route('**/guide-washer-*.svg', route => route.abort()) });
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
    const slow = await open({ prepare: p => p.route('**/guide-washer-*.svg', async route => { await held; await route.continue(); }) });
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

  { // The same screen for other parts, and what may not be shown.
    const tire = await open({ task: 'tire.front-left' });
    assert.equal(await tire.page.locator('.part-guide').count(), 0, 'a part with no guide gets no empty card');
    assert.equal(await tire.page.locator('.part-guide-body').count(), 0);
    assert.deepEqual(pictures(tire.log), []);
    await closeAll();

    const { page } = await open({ qr: false });
    const rendered = await page.evaluate(async () => {
      const { renderPartGuide } = await import('/mobile-ar-poc/public/part-guide.mjs');
      const { PART_GUIDES, IMAGE_KIND, LICENSE } = await import('/mobile-ar-poc/public/part-guides.mjs');
      const base = { ...PART_GUIDES['washer-fluid-cap'], partId: 'brake-fluid-reservoir', taskId: 'brake-fluid', title: '브레이크액' };
      const photo = { file: 'guide-washer-area.svg', kind: IMAGE_KIND.PHOTO, alt: '설명', caption: '캡션', imageSource: '소유자 서면 허가', licenseStatus: LICENSE.PERMISSION_GRANTED, vehicle: { make: 'Make', model: 'Model', year: 2024 } };
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
    assert.doesNotMatch(rendered.valid.text, /아직 실제 사진이 없어/);
    assert.deepEqual([rendered.unverified.images, rendered.unverified.figures], [0, 0], 'a photo with no right to use it or no known vehicle is not shown');
    assert.match(rendered.unverified.text, /아직 준비된 사진이나 그림이 없어요/);
    assert.deepEqual([rendered.none.images, rendered.none.figures], [0, 0]);
    assert.match(rendered.none.text, /아직 준비된 사진이나 그림이 없어요/);
    assert.match(rendered.none.text, /앞유리·분사 모양/, 'the words remain');
    await closeAll();
    pass('a part with no guide shows no empty card; the same screen takes another part, labels a real photo with its vehicle and source, and refuses one without them');
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
