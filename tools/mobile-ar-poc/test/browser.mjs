// Writes all captures, fixtures and raw results outside Git. Synthetic media only.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { createHandler } from '../server.mjs';
import { HANDOFF } from '../public/handoff.mjs';

const output = process.env.POC_EVIDENCE_DIR;
if (!output || !path.resolve(output).toLowerCase().startsWith('c:\\carscope-external\\qr-ar-01\\')) {
  throw new Error('Set POC_EVIDENCE_DIR to a run directory under C:\\CarScope-External\\qr-ar-01\\');
}
await mkdir(output, { recursive: true });
const results = { kind: 'SYNTHETIC_BROWSER_ONLY', realDetectionAccuracy: 'NOT_RUN', checks: [], errors: [] };
const server = http.createServer(createHandler('https://poc.example/'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    const fixture = document.createElement('canvas'); fixture.width = 640; fixture.height = 480;
    const ctx = fixture.getContext('2d');
    let blueFrame = true;
    window.paintFixture = (blue = blueFrame) => {
      blueFrame = blue;
      ctx.fillStyle = '#303030'; ctx.fillRect(0, 0, 640, 480);
      if (blue) { ctx.fillStyle = '#1446c8'; ctx.fillRect(240, 180, 100, 80); }
    };
    window.paintFixture();
    setInterval(() => window.paintFixture(), 100);
    window.fixtureCanvas = fixture;
    window.fixtureStreams = [];
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => {
      if (location.search === '?fixture=denied') throw new DOMException('denied', 'NotAllowedError');
      window.paintFixture(true);
      const stream = fixture.captureStream(10); window.fixtureStreams.push(stream); return stream;
    } }, configurable: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => results.errors.push(error.message));
  await page.goto(root + '/' + HANDOFF);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'start');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보 1개'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await page.evaluate(() => {
    const c = document.getElementById('overlay');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
  }));
  await page.screenshot({ path: path.join(output, 'mobile-synthetic-candidate.png'), fullPage: true });
  await writeFile(path.join(output, 'synthetic-blue-component.png'), Buffer.from(await page.evaluate(() => fixtureCanvas.toDataURL().split(',')[1]), 'base64'));
  results.checks.push('PASS: 390px synthetic camera frame, candidate text, overlay pixels, no horizontal overflow');
  results.checks.push('PASS: keyboard Tab focus and Enter camera start');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => {
    const c = document.getElementById('overlay');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'landscape-synthetic-candidate.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  results.checks.push('PASS: landscape resize without horizontal overflow (synthetic desktop viewport)');
  // Decode the actual rendered server SVG, not merely the encoder input.
  const qr = PNG.sync.read(await page.locator('#qr img').screenshot());
  assert.equal(jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height).data, `https://poc.example/${HANDOFF}`);
  results.checks.push('PASS: actual server QR SVG rendered and independently decoded');
  await page.evaluate(() => paintFixture(false));
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('후보를 찾지 못했습니다'));
  assert.equal(await page.evaluate(() => {
    const c = document.getElementById('overlay');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
  }), false);
  await page.screenshot({ path: path.join(output, 'mobile-no-candidate.png'), fullPage: true });
  results.checks.push('PASS: no-candidate timeout and stale overlay cleared');
  await page.getByRole('button', { name: '수동 안내 보기' }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'guidance');
  assert.equal(await page.evaluate(() => fixtureStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
  results.checks.push('PASS: manual fallback focus and camera tracks stopped');
  // A progressing video time is necessary; stale frames must not retain proposals.
  await page.getByRole('button', { name: '카메라 시작' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.evaluate(() => Object.defineProperty(document.getElementById('video'), 'currentTime', { value: 1, configurable: true }));
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('영상 갱신이 멈췄습니다'));
  assert.equal(await page.evaluate(() => document.getElementById('video').srcObject), null);
  await page.evaluate(() => { delete document.getElementById('video').currentTime; });
  results.checks.push('PASS: frozen frame time stops camera and removes stale proposals');
  await page.getByRole('button', { name: '카메라 시작' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('파란색 후보'));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => document.getElementById('video').srcObject), null);
  results.checks.push('PASS: simulated visibilitychange stops stream (real device backgrounding NOT_RUN)');
  await page.goto(root + '/#v=2&task=washer-fluid');
  assert.equal(await page.locator('#start').isDisabled(), true);
  results.checks.push('PASS: invalid handoff blocks camera');
  await page.goto(root + '/?fixture=denied');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('권한이 거부'));
  await page.screenshot({ path: path.join(output, 'mobile-denied.png'), fullPage: true });
  results.checks.push('PASS: synthetic permission denial offers manual fallback');
  await page.evaluate(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }));
  await page.locator('#start').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('카메라 미지원'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(output, 'desktop-unsupported.png'), fullPage: true });
  results.checks.push('PASS: unsupported camera fallback; desktop render');
  assert.deepEqual(results.errors, []);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.errors.push(error.stack); process.exitCode = 1;
} finally {
  await browser?.close(); server.close();
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
