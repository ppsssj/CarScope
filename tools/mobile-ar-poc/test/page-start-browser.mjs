// A module that fails to load must not leave a dead page with no word. Mobile Chrome, real QR v2 sync HTTP on a local session.
// The failure is made here with route.abort: this is the page's answer to it, not a reproduction of the OS error behind it.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHandler } from '../server.mjs';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';

const base = process.env.POC_EVIDENCE_DIR;
if (!base || !path.resolve(base).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set external POC_EVIDENCE_DIR');
const output = path.join(base, 'page-start');
await mkdir(output, { recursive: true });
const result = { kind: 'SYNTHETIC_CHROME_ROUTE_ABORT', realPhone: 'NOT_RUN', checks: [], errors: [] };
const pass = text => { result.checks.push(`PASS ${text}`); console.log(`PASS ${text}`); };

let now = Date.now(), browser;
const qr = await startMobileDevServer({ now: () => now, authorizer: new LocalTestSessionCreationAuthorizer() });
const plain = http.createServer(createHandler());
await new Promise(resolve => plain.listen(0, '127.0.0.1', resolve));
const plainUrl = `http://127.0.0.1:${plain.address().port}`;

async function open({ url, fail, viewport = { width: 390, height: 844 } }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const seen = { navigations: 0, aborted: 0, requests: [] };
  page.on('request', request => { seen.requests.push({ url: new URL(request.url()).pathname, method: request.method() }); if (request.isNavigationRequest()) seen.navigations++; });
  await page.route(fail.pattern, route => { if (seen.aborted < fail.times) { seen.aborted++; return route.abort('failed'); } return route.continue(); });
  await page.goto(url);
  return { context, page, seen };
}
const started = page => page.waitForFunction(() => window.__selfInspection || window.__checklistInspection);
const session = async task => { now += 61_000; const receiver = new ReceiverClient({ baseUrl: qr.url }); const created = await receiver.create(task); return { receiver, fragment: created.fragment }; };

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true });
  result.browser = browser.version();

  { // QR: one failed module, one automatic retry, and the invite is still good.
    for (const file of ['app.mjs', 'mobile-dev-entry.mjs', 'mobile-sync.mjs', 'part-guide.mjs', 'inspection-camera.mjs']) {
      const { receiver, fragment } = await session(file === 'part-guide.mjs' ? 'tire.front-left' : 'washer-fluid');
      const { context, page, seen } = await open({ url: `${qr.url}/${fragment}`, fail: { pattern: `**/${file}`, times: 1 } });
      await started(page);
      assert.equal(seen.aborted, 1, file);
      assert.equal(seen.navigations, 2, `${file}: exactly one reload`);
      await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
      assert.equal(seen.requests.filter(r => r.method === 'POST' && r.url === '/v1/claim').length, 1, `${file}: one claim, on the try that ran`);
      assert.equal(new URL(page.url()).hash, '', `${file}: the invite left the address as usual`);
      assert.equal(await page.locator('#page-start-failed').count(), 0, file);
      assert.equal(await page.evaluate(() => history.state), null, `${file}: no trace of the try`);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, file);
      assert.equal((await receiver.view()).sessionState, 'CLAIMED', file);
      await context.close();
    }
    pass('QR: after one failed module the page reloads once by itself and connects with the same unused invite, once, leaving no trace');
  }

  { // Twice: stops, says so, and a person can try again. No loop.
    const { fragment } = await session('washer-fluid');
    const { context, page, seen } = await open({ url: `${qr.url}/${fragment}`, fail: { pattern: '**/app.mjs', times: 2 } });
    await page.locator('#page-start-failed').waitFor();
    await page.waitForTimeout(600);
    assert.equal(seen.navigations, 2, 'it did not keep reloading');
    assert.equal(await page.locator('#page-start-failed').getAttribute('role'), 'alert');
    assert.match(await page.locator('#page-start-failed').innerText(), /불러오지 못했어요/);
    assert.equal(await page.locator('#step-intro').isVisible(), false, 'the dead inspection is out of the way');
    assert.equal(await page.locator('footer.actions').isVisible(), false, 'no button that does nothing');
    assert.equal(await page.locator('#guidance').isVisible(), true, 'the manual guide stays readable');
    for (const dead of ['#manual', '#guidance-close']) assert.equal(await page.locator(dead).isVisible(), false, `${dead} would do nothing`);
    const box = await page.locator('#page-start-reload').boundingBox();
    assert.ok(box.height >= 44, 'easy to press');
    assert.ok(new URL(page.url()).hash.includes('invite='), 'nothing used it yet: the fragment is what a retry needs');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'start-failed.png') });
    assert.ok(!seen.requests.some(r => r.url.startsWith('/v1/')), 'no API call has happened');
    await page.locator('#page-start-reload').click();
    await started(page);
    await page.waitForFunction(() => document.body.textContent.includes('연결됐어요'));
    assert.equal(seen.requests.filter(r => r.url === '/v1/claim').length, 1);
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.locator('#page-start-failed').count(), 0);
    assert.equal(await page.evaluate(() => history.state), null, 'the try is forgotten once a start works');
    await context.close();

    const stuck = await open({ url: `${plainUrl}/#v=1&task=washer-fluid`, fail: { pattern: '**/app.mjs', times: 99 } });
    await stuck.page.locator('#page-start-failed').waitFor();
    await stuck.page.locator('#page-start-reload').click();
    await stuck.page.waitForTimeout(500);
    await stuck.page.locator('#page-start-failed').waitFor();
    assert.equal(stuck.seen.navigations, 3, 'a press is one more try and no more: first load, the retry, the press');
    await stuck.context.close();
    pass('a second failure stops with a message and a working button; the dead controls are hidden and nothing loops');
  }

  { // Local pages and parts share it.
    for (const url of [`${plainUrl}/`, `${plainUrl}/#v=1&task=washer-fluid`, `${plainUrl}/#task=brake-fluid`]) {
      const { context, page, seen } = await open({ url, fail: { pattern: '**/app.mjs', times: 1 } });
      await started(page);
      assert.equal(seen.navigations, 2, url);
      await context.close();
    }
    pass('the local pages recover the same way, on the static host too');
  }

  { // It does nothing otherwise.
    const { context, page, seen } = await open({ url: `${plainUrl}/`, fail: { pattern: '**/nothing-matches', times: 1 } });
    await started(page);
    assert.equal(seen.navigations, 1, 'a healthy start does not reload');
    assert.equal(await page.evaluate(() => history.state), null);
    // A broken picture or a failing optional file is not a failed start: only the module script counts.
    await page.evaluate(() => { const i = new Image(); i.src = '/nope.svg'; document.body.append(i); const s = document.createElement('script'); s.src = '/nope.js'; document.head.append(s); });
    await page.waitForTimeout(300);
    assert.equal(seen.navigations, 1, 'other load errors are left alone');
    await context.close();

    // A dynamically imported optional part is the page's own business: the start already worked.
    const flagged = await open({ url: `${plainUrl}/`, fail: { pattern: '**/style.css', times: 1 } });
    await started(flagged.page);
    assert.equal(flagged.seen.navigations, 1, 'a stylesheet failure is not a failed start');
    await flagged.context.close();
    pass('a healthy start does not reload, and a missing picture, classic script or stylesheet does not trigger it');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await qr.stop();
  await new Promise(resolve => plain.close(resolve));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, errors: result.errors }, null, 2));
}
