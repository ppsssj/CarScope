// Screens of the mobile inspection, on the phone sizes it must fit, with a synthetic local session. No device is involved.
// Usage: POC_EVIDENCE_DIR=C:/CarScope-External/<run> node test/ux-capture.mjs [label]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startMobileDevServer } from '../../inspection-sync-poc/src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../../inspection-sync-poc/src/creation-authorizer.mjs';
import { ReceiverClient } from '../../inspection-sync-poc/bin/receiver.mjs';

const out = process.env.POC_EVIDENCE_DIR, label = process.argv[2] ?? 'run';
if (!out || !path.resolve(out).toLowerCase().startsWith('c:\\carscope-external\\') && !process.env.CI) throw Error('Set external POC_EVIDENCE_DIR');
const dir = path.join(out, label); await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true });
let now = Date.now();
const sync = await startMobileDevServer({ port: 0, now: () => now, authorizer: new LocalTestSessionCreationAuthorizer() });
const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
const settled = page => page.waitForTimeout(450);

async function checklist(task, viewport, prefix) {
  now += 61_000;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const receiver = new ReceiverClient({ baseUrl: sync.url }), session = await receiver.create(task);
  await page.goto(sync.url + '/' + session.fragment);
  await page.waitForFunction(() => window.__checklistInspection);
  await settled(page); await shot(page, `${prefix}-1-intro`);
  await page.locator('#safety').check();
  if (await page.locator('#not-charging').count()) await page.locator('#not-charging').check();
  await page.locator('#manual-start').click(); await settled(page); await shot(page, `${prefix}-2-question`);
  for (const answer of ['NOT_FOUND', 'NOT_FOUND', 'UNABLE']) {
    await page.waitForFunction(() => window.__checklistInspection.state.step === 'check');
    const before = await page.evaluate(() => window.__checklistInspection.state.index);
    await page.locator(`input[value=${answer}]`).check();
    await settled(page);
    if (before === 0) await shot(page, `${prefix}-3-answered`);
    const moved = await page.evaluate(i => window.__checklistInspection.state.index !== i || window.__checklistInspection.state.step !== 'check', before);
    if (!moved) await page.locator('#primary').click();
    await settled(page);
  }
  await shot(page, `${prefix}-4-review`);
  await page.locator('#primary').click(); await settled(page); await shot(page, `${prefix}-5-ready-to-send`);
  await page.locator('#sync-send').click(); await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'SENT'); await settled(page); await shot(page, `${prefix}-6-sent`);
  const view = await receiver.view(); await receiver.accept(view.resultDigest);
  await page.waitForFunction(() => document.querySelector('#done-sync').dataset.syncState === 'ACCEPTED', null, { timeout: 8000 }); await settled(page); await shot(page, `${prefix}-7-confirmed`);
  await context.close();
}
async function washer(viewport, prefix) {
  now += 61_000;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const receiver = new ReceiverClient({ baseUrl: sync.url }), session = await receiver.create();
  await page.goto(sync.url + '/' + session.fragment);
  await page.waitForFunction(() => window.__selfInspection);
  await settled(page); await shot(page, `${prefix}-1-intro`);
  await page.locator('#manual-start').click(); await settled(page); await shot(page, `${prefix}-2-check`);
  await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(b => b.click())); await page.locator('#primary').click(); await settled(page);
  await page.locator('[data-status="NEEDS_REFILL"]').click(); await settled(page); await shot(page, `${prefix}-3-choice`);
  if (await page.evaluate(() => window.__selfInspection.state.step) === 'result') await page.locator('#primary').click();
  await settled(page); await shot(page, `${prefix}-4-confirm`);
  await page.locator('#primary').click(); await settled(page); await shot(page, `${prefix}-5-ready-to-send`);
  await context.close();
}
async function failure(viewport, prefix) {
  now += 61_000;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const receiver = new ReceiverClient({ baseUrl: sync.url }), session = await receiver.create('tire.front-left');
  await page.route('**/v1/claim', route => route.abort('failed'));
  await page.goto(sync.url + '/' + session.fragment);
  await page.waitForFunction(() => window.__checklistInspection); await page.waitForTimeout(900); await shot(page, `${prefix}-connection-failed`);
  await context.close();
}
async function direct(viewport, prefix) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.goto(sync.url + '/'); await page.waitForFunction(() => window.__selfInspection); await settled(page); await shot(page, `${prefix}-direct-intro`);
  await context.close();
}
const failures = [];
const step = async (name, run) => { try { await run(); console.log('OK', name); } catch (e) { failures.push(name); console.log('FAIL', name, e.message.split('\n')[0]); } };
await step('tire 390', () => checklist('tire.front-left', { width: 390, height: 844 }, 'tire-390'));
await step('brake 390', () => checklist('brake-fluid', { width: 390, height: 844 }, 'brake-390'));
await step('charge 360', () => checklist('ev-charge.port', { width: 360, height: 740 }, 'charge-360'));
await step('bonnet 320', () => checklist('battery-12v', { width: 320, height: 568 }, 'battery-320'));
await step('fold closed', () => checklist('wiper.front.left', { width: 344, height: 882 }, 'wiper-344'));
await step('fold open', () => checklist('tire.rear-right', { width: 884, height: 1104 }, 'tire-884'));
await step('washer 390', () => washer({ width: 390, height: 844 }, 'washer-390'));
await step('failure 390', () => failure({ width: 390, height: 844 }, 'state-390'));
await step('direct 390', () => direct({ width: 390, height: 844 }, 'state-390'));
await browser.close(); console.log(JSON.stringify({ dir, failures })); process.exit(failures.length ? 1 : 0);
