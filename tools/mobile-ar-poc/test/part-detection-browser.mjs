// P12-E: part detection on the real inspection pages. Mobile Chrome, real QR v2 sync HTTP on a local session, a generated picture and a FAKE provider.
// No photo reaches Roboflow and no model runs, so nothing here says how good the model is. Not a real phone, not Render.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'p12-e');
await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_FAKE_PROVIDER', realModel: 'NOT_RUN', realPhone: 'NOT_RUN', render: 'NOT_RUN', checks: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };
const fakeSource = (await readFile(new URL('./fake-webxr.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');

// A plain generated picture: nobody's car and nothing to send anywhere.
const png = new PNG({ width: 1600, height: 1200 });
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 60; png.data[i + 1] = 70; png.data[i + 2] = 80; png.data[i + 3] = 255; }
const PICTURE = { name: 'synthetic.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };

const SECRET_KEY = 'rf_fake_key_must_never_appear';
const provider = { calls: [], mode: 'found', release: null,
  async detect({ image }) {
    provider.calls.push({ bytes: image.length, head: image.subarray(0, 2).toString('hex') });
    if (provider.mode === 'fail') throw new Error(`refused ${SECRET_KEY}`);
    if (provider.mode === 'hold') await new Promise(resolve => { provider.release = resolve; });
    if (provider.mode === 'none') return { imageWidth: 640, imageHeight: 480, predictions: [{ className: 'Engine Cover', score: 0.9, x: 300, y: 200, width: 100, height: 100 }] };
    const P = (className, score, x, y) => ({ className, score, x, y, width: 90, height: 70 });
    return { imageWidth: 640, imageHeight: 480, predictions: [P('Windshield Wiper Fluid', 0.8, 120, 120), P('Windshield Wiper Fluid', 0.55, 420, 300), P('3', 0.99, 300, 80), P('Engine Coolant Reservoir', 0.95, 300, 240), P('Fuse Box', 0.9, 500, 100), P('Brake Fluid', 0.9, 60, 400)] };
  } };
let now = Date.now(), browser;
const authorizer = new LocalTestSessionCreationAuthorizer();
const partDetection = { provider };
const on = await startMobileDevServer({ now: () => now, authorizer, partDetection });
const off = await startMobileDevServer({ now: () => now, authorizer });
const both = await startMobileDevServer({ now: () => now, authorizer, partDetection, webxrGuide: true });
const contexts = [];
const closeAll = () => Promise.all(contexts.splice(0).map(context => context.close().catch(() => {})));

async function open({ host = on, task = 'washer-fluid', viewport = { width: 390, height: 844 }, fake, local } = {}) {
  now += 61_000; // Each scenario gets its own rate window; the limits stay as they are.
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); contexts.push(context);
  await context.addInitScript('window.__media=0;if(navigator.mediaDevices){const g=navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.__media++;return g(c);};}');
  if (fake) await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fake)}));`);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [], secrets: [] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) log.problems.push(message.text()); });
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), auth: request.headers().authorization ?? '', body: request.method() === 'POST' && request.url().includes('part-detections') ? '' : request.postData() ?? '' }));
  page.on('response', async response => { if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); } });
  const receiver = new ReceiverClient({ baseUrl: host.url });
  let fragment = local;
  if (!local) { const session = await receiver.create(task); fragment = session.fragment; log.secrets.push(fragment.split('invite=')[1]); }
  await page.goto(`${host.url}/${fragment}`);
  await page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
  if (!local) await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
  return { page, log, receiver, context };
}
const detections = log => log.requests.filter(r => r.method === 'POST' && r.url.includes('/v1/part-detections/'));
const posted = (log, suffix) => log.requests.filter(r => r.method === 'POST' && r.url.endsWith(suffix)).length;
const phase = page => page.evaluate(() => window.__partDetection.state.phase);
const waitPhase = (page, name) => page.waitForFunction(value => window.__partDetection?.state.phase === value, name);
const entryReady = page => page.waitForFunction(() => window.__partDetection);
const openPanel = async page => { await entryReady(page); await page.locator('#part-detect-open').click(); await waitPhase(page, 'CONSENT'); };
const choosePhoto = async page => { await page.locator('#part-detect-agree').check(); await page.locator('#part-detect-library-input').setInputFiles(PICTURE); };
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function noLeak({ page, log }) {
  const html = await page.content(), historyState = await page.evaluate(() => JSON.stringify(history.state));
  assert.equal(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie])), '[{},{},""]');
  assert.equal(new URL(page.url()).hash, '');
  assert.ok(!html.includes(SECRET_KEY), 'API key in the page');
  for (const secret of log.secrets) {
    assert.ok(!html.includes(secret) && !historyState.includes(secret) && !page.url().includes(secret), 'token in the page, history or address');
    assert.ok(log.requests.every(r => !r.url.includes(secret) && !r.body.includes(secret)), 'token in a URL or body');
  }
  assert.ok(log.requests.every(r => new URL(r.url).hostname === '127.0.0.1'), 'the page calls only its own origin');
}

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  result.browser = browser.version();

  { // Which parts show the button.
    for (const [task, shown] of [['washer-fluid', true], ['coolant-reservoir', true], ['brake-fluid', true], ['fuse-box', true], ['lcw-coolant-reservoir', false], ['battery-12v', false], ['tire.front-left', false], ['wiper.front.left', false], ['light-low-beam-left-0', false], ['ev-charge.port', false]]) {
      const { page, log } = await open({ task });
      await page.waitForFunction(() => document.querySelector('details.part-guide'));
      await page.waitForTimeout(shown ? 0 : 200);
      if (shown) await entryReady(page);
      assert.equal(await page.locator('#part-detect-open').count(), shown ? 1 : 0, task);
      assert.equal(await page.locator('details.part-guide').count(), 1, `${task}: the picture guide stands either way`);
      assert.equal(detections(log).length, 0);
      await closeAll();
    }
    // A local page has no credential, so it offers nothing, even where the host allows it.
    const local = await open({ local: '#v=1&task=washer-fluid' });
    await local.page.waitForTimeout(200);
    assert.equal(await local.page.locator('#part-detect-open').count(), 0, 'no credential, no button');
    assert.equal(local.log.requests.some(r => r.url.includes('part-detection')), false);
    await closeAll();
    pass('the button appears for the 4 experimental parts in a QR inspection only; unsupported bonnet parts, other areas and local pages show none, and the picture guide stays');
  }

  { // Experiment off: nothing of it exists.
    const { page, log } = await open({ host: off, task: 'fuse-box' });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#part-detect-open').count(), 0);
    assert.equal(await page.evaluate(() => document.body.dataset.partDetection), undefined);
    assert.equal(log.requests.some(r => r.url.includes('part-detection')), false);
    await closeAll();
    pass('with the experiment off there is no button, mark or request');
  }

  { // The flow, on a connected inspection.
    provider.mode = 'found'; provider.calls.length = 0;
    const session = await open(), { page, log, receiver } = session;
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    const held = () => page.evaluate(() => { const { step, mode, checks, record } = window.__selfInspection.state; return { step, mode, checks, id: record.inspectionId, aids: record.aids, state: record.state }; });
    const before = await held();
    await entryReady(page);
    assert.equal(await page.locator('#part-detect-open-location').isVisible(), true);
    assert.equal(await page.locator('#part-detect-open').isVisible(), false, 'the first step\'s row left with that step');
    await shot(page, 'entry-check');
    await page.locator('#part-detect-open-location').click();
    await waitPhase(page, 'CONSENT');
    assert.match(await page.locator('#part-detect-consent').innerText(), /외부 AI 서비스\(Roboflow\)/);
    assert.match(await page.locator('#part-detect-consent').innerText(), /저장하지 않아요/);
    assert.match(await page.locator('#part-detect-consent').innerText(), /번호판이나 사람/);
    assert.equal(await page.locator('#part-detect-take').isDisabled(), true);
    assert.equal(await page.locator('#part-detect-gallery').isDisabled(), true);
    await shot(page, 'consent');

    // No consent: a file event sends nothing.
    await page.locator('#part-detect-library-input').setInputFiles(PICTURE);
    await page.waitForTimeout(150);
    assert.equal(await phase(page), 'CONSENT');
    assert.equal(detections(log).length, 0, 'nothing is sent without consent');
    assert.equal(provider.calls.length, 0);

    await page.locator('#part-detect-agree').check();
    assert.equal(await page.locator('#part-detect-gallery').isEnabled(), true);
    assert.equal(await page.locator('#part-detect-camera-input').getAttribute('capture'), 'environment');
    await page.locator('#part-detect-library-input').setInputFiles(PICTURE);
    await waitPhase(page, 'CANDIDATES');

    // One request, one reduced JPEG, with the token in its header.
    assert.equal(detections(log).length, 1);
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].head, 'ffd8', 'the picture was re-encoded as JPEG');
    assert.ok(provider.calls[0].bytes < PICTURE.buffer.length, 'and is smaller');
    assert.ok(detections(log)[0].url.endsWith('/v1/part-detections/washer-fluid-cap'));
    assert.match(detections(log)[0].auth, /^Bearer /);

    // Only this part's two boxes, in order, as candidates.
    const state = await page.evaluate(() => window.__partDetection.state);
    assert.equal(state.candidates.length, 2, 'number, coolant, fuse and brake classes are left out');
    assert.deepEqual(state.candidates[0].box.map(v => +v.toFixed(3)), [+(75 / 640).toFixed(3), +(85 / 480).toFixed(3), +(90 / 640).toFixed(3), +(70 / 480).toFixed(3)]);
    const message = await page.locator('#part-detect-message').innerText();
    assert.match(message, /후보 2개/);
    assert.match(message, /확정된 위치가 아니에요/);
    assert.match(await page.locator('#part-detect-caution').innerText(), /직접 확인/);
    assert.doesNotMatch(await page.locator('#part-detect').innerText(), /%|신뢰도|정확/, 'no score that invites trust');
    const painted = await page.evaluate(([x, y]) => { const c = document.getElementById('part-detect-picture'); const d = c.getContext('2d').getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data; return [d[0], d[1], d[2]]; }, [state.candidates[0].box[0], state.candidates[0].box[1] + state.candidates[0].box[3] / 2]);
    assert.ok(painted[0] > 200 && painted[1] > 180, `the box is drawn where the numbers say: ${painted}`);
    const rect = await page.evaluate(() => { const r = document.getElementById('part-detect-picture').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    assert.ok(rect.w > 200 && Math.abs(rect.w / rect.h - 4 / 3) < 0.05, `the picture keeps its shape: ${JSON.stringify(rect)}`);
    assert.equal(await fits(page), true);
    await shot(page, 'candidates');

    // No repeated capture.
    await page.waitForTimeout(600);
    assert.equal(provider.calls.length, 1, 'nothing more is sent by itself');
    assert.equal(await page.evaluate(() => window.__media), 0, 'no camera stream');

    // Another photo needs its own consent and clears what was shown.
    await page.locator('#part-detect-again').click();
    assert.equal(await phase(page), 'CONSENT');
    assert.equal(await page.locator('#part-detect-agree').isChecked(), false);
    assert.equal(await page.evaluate(() => window.__partDetection.state.candidates.length), 0);

    // Back closes the panel only.
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('part-detect').open);
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'Back stayed on the page');
    assert.equal(new URL(page.url()).hash, '');
    assert.deepEqual(await held(), before, 'answers, attempt and record are as they were');
    assert.equal(await page.locator('#checklist input[value="parked"]').isChecked(), true);

    // And the inspection carries on with the same connection.
    assert.equal(posted(log, '/v1/claim'), 1);
    assert.equal(posted(log, '/v1/submissions'), 0, 'AI sent no result');
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    await page.locator('#checklist input:not(:checked)').evaluateAll(boxes => boxes.forEach(box => box.click()));
    await page.click('#primary'); await page.click('[data-status="OK"]'); await page.click('#primary'); await page.click('#primary');
    await page.waitForSelector('body[data-step="done"]');
    await page.locator('#sync-send').click();
    await page.waitForFunction(() => document.getElementById('done-sync').dataset.syncState === 'SENT');
    const view = await receiver.view();
    assert.equal(view.result.inspectionId, before.id);
    assert.deepEqual(view.result.aids, { cameraUsed: false, locationMarked: false }, 'the result contract and its values are untouched');
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('consent, then one reduced JPEG and one request; only this part\'s boxes drawn as candidates; Back closes the panel; answers, QR and the sent result are unchanged');
  }

  { // Nothing found, a failure, a hold and a limit: words and the guide, never a dead end.
    provider.mode = 'none';
    const none = await open({ task: 'fuse-box' });
    await openPanel(none.page);
    await choosePhoto(none.page);
    await waitPhase(none.page, 'NONE_FOUND');
    assert.match(await none.page.locator('#part-detect-message').innerText(), /부품이 없다는 뜻은 아니에요/);
    assert.match(await none.page.locator('#part-detect-message').innerText(), /그림 안내/);
    assert.equal(await none.page.locator('#part-detect-picture').isVisible(), false);
    await shot(none.page, 'none-found');
    await none.page.locator('#part-detect-close').click();
    assert.equal(await none.page.locator('details.part-guide').isVisible(), true, 'the picture guide is right there');
    await closeAll();

    provider.mode = 'fail';
    const failed = await open({ task: 'brake-fluid' });
    await openPanel(failed.page);
    await choosePhoto(failed.page);
    await waitPhase(failed.page, 'FAILED');
    const text = await failed.page.locator('#part-detect').innerText();
    assert.match(text, /연결하지 못했어요/);
    assert.ok(!text.includes(SECRET_KEY), 'the upstream failure does not reach the phone');
    await noLeak(failed);
    await shot(failed.page, 'failed');
    assert.equal(await failed.page.evaluate(() => window.__checklistInspection.state.step), 'intro', 'the inspection is where it was');
    assert.equal(await failed.page.locator('#part-detect-again').isVisible(), true);
    await closeAll();

    // Closing during the wait: the late answer lands nowhere.
    provider.mode = 'hold'; provider.release = null;
    const hold = await open({ task: 'coolant-reservoir' });
    await openPanel(hold.page);
    await choosePhoto(hold.page);
    await waitPhase(hold.page, 'ANALYZING');
    assert.equal(await hold.page.locator('#part-detect-busy').isVisible(), true);
    while (!provider.release) await new Promise(resolve => setTimeout(resolve, 10));
    await hold.page.locator('#part-detect-close').click();
    provider.release();
    await hold.page.waitForTimeout(200);
    assert.equal(await phase(hold.page), 'CLOSED');
    assert.equal(await hold.page.evaluate(() => window.__partDetection.state.candidates.length), 0, 'an answer after closing shows nothing');
    await closeAll();

    // A picture that is not one.
    provider.mode = 'found'; provider.calls.length = 0;
    const junk = await open({ task: 'fuse-box' });
    await openPanel(junk.page);
    await junk.page.locator('#part-detect-agree').check();
    await junk.page.locator('#part-detect-library-input').setInputFiles({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a picture') });
    await waitPhase(junk.page, 'FAILED');
    assert.match(await junk.page.locator('#part-detect-message').innerText(), /읽지 못했어요/);
    assert.equal(provider.calls.length, 0, 'nothing is sent');
    await closeAll();

    // The rate limit reads as words.
    const limited = await open({ task: 'fuse-box' });
    await openPanel(limited.page);
    await limited.page.route('**/v1/part-detections/**', route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"code":"RATE_LIMITED"}}' }));
    await choosePhoto(limited.page);
    await waitPhase(limited.page, 'FAILED');
    assert.match(await limited.page.locator('#part-detect-message').innerText(), /잠시 후/);
    await closeAll();
    pass('no candidate, provider failure, unreadable picture and rate limit each end in plain words with the guide; a late answer after closing shows nothing');
  }

  { // Experimental parts name their own limits.
    provider.mode = 'found';
    const coolant = await open({ task: 'coolant-reservoir' });
    await openPanel(coolant.page);
    await choosePhoto(coolant.page);
    await waitPhase(coolant.page, 'CANDIDATES');
    assert.match(await coolant.page.locator('#part-detect-caution').innerText(), /저전도 냉각수/);
    assert.equal(await coolant.page.evaluate(() => window.__partDetection.state.candidates.length), 1, 'only the coolant class');
    await closeAll();
    pass('a coolant candidate says the model cannot tell the two coolants apart, and shows only its own class');
  }

  { // Sizes. A viewport is not the device.
    provider.mode = 'found';
    for (const [name, viewport] of [['320', { width: 320, height: 568 }], ['flip-cover-344', { width: 344, height: 882 }], ['flip-open-412', { width: 412, height: 1007 }], ['landscape-844', { width: 844, height: 390 }], ['wide-884', { width: 884, height: 1104 }]]) {
      const { page } = await open({ viewport });
      await openPanel(page);
      await choosePhoto(page);
      await waitPhase(page, 'CANDIDATES');
      const box = await page.evaluate(() => { const fit = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 44; }; const r = document.getElementById('part-detect-picture').getBoundingClientRect(); return { close: fit('part-detect-close'), again: fit('part-detect-again'), right: r.right <= innerWidth + 0.5, wide: document.getElementById('part-detect').scrollWidth <= innerWidth }; });
      assert.deepEqual(box, { close: true, again: true, right: true, wide: true }, name);
      await shot(page, `size-${name}`);
      await closeAll();
    }
    pass('the panel fits at 320x568, 344x882, 412x1007, 844x390 and 884x1104');
  }

  { // Beside WebXR: each Back closes what is on top, and the connection stays.
    provider.mode = 'found';
    const session = await open({ host: both, fake: {} }), { page, log } = session;
    await page.waitForFunction(() => window.__webXrGuide?.capability);
    await entryReady(page);
    assert.equal(await page.locator('#xr-entry-open').isVisible(), true);
    assert.equal(await page.locator('#part-detect-open').isVisible(), true);
    await shot(page, 'with-webxr', true);
    await page.locator('#manual-start').click();
    await page.locator('#checklist input[value="parked"]').click();
    const before = await page.evaluate(() => JSON.stringify(window.__selfInspection.state));
    await page.locator('#part-detect-open-location').click();
    await choosePhoto(page);
    await waitPhase(page, 'CANDIDATES');
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('part-detect').open);
    assert.equal(await page.evaluate(() => window.__webXrGuide.open), false);
    await page.locator('#xr-entry-open').click();
    await page.waitForFunction(() => window.__webXrGuide.state?.phase === 'READY');
    await page.locator('#xr-start').click();
    await page.waitForFunction(() => window.__webXrGuide.state?.phase === 'AIMING');
    await page.goBack();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__env.sessions.every(s => s.ended)), true);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__selfInspection.state)), before);
    assert.equal(posted(log, '/v1/claim'), 1);
    await noLeak(session);
    assert.deepEqual(log.problems, []);
    await closeAll();
    pass('next to WebXR both open and close by Back, and the answers and the single claim stay');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await on.stop(); await off.stop(); await both.stop();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, errors: result.errors }, null, 2));
}
