// AR-02A browser check of the debug page (synthetic, headless Edge, one machine). Not a real-device verification.
// Requires tools/mobile-ar-poc dependencies (npm ci there). Evidence (screenshots, summary) goes to
// SYNC_EVIDENCE_DIR, which must be outside the repository, e.g. C:\CarScope-External\ar-02a\<run>.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startSyncServer } from '../src/server.mjs';
import { ReceiverClient, describeReceived } from '../bin/receiver.mjs';

const require = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url));
const { chromium } = require('playwright');

const output = process.env.SYNC_EVIDENCE_DIR;
if (!output || !path.resolve(output).toLowerCase().startsWith('c:\\carscope-external\\')) throw new Error('Set SYNC_EVIDENCE_DIR to a run directory under C:\\CarScope-External\\ar-02a\\');
await mkdir(output, { recursive: true });

const server = await startSyncServer({ port: 0, debugPage: true, log: () => {} });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
const pass = (name) => { checks.push(name); console.log(`ok - ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));

  const receiver = new ReceiverClient({ baseUrl: server.url });
  const s = await receiver.create();
  const invite = s.fragment.split('invite=')[1];
  await page.goto(`${server.url}/debug${s.fragment}`);
  await page.waitForFunction(() => window.__syncDebug);
  assert.equal(new URL(page.url()).hash, '');
  assert.ok(!page.url().includes(invite));
  pass('QR v2 invite read, then stripped from the address bar');
  assert.equal(await page.isDisabled('#send'), true);
  pass('send disabled before pairing');
  await page.screenshot({ path: path.join(output, '01-invite.png') });

  await page.click('#claim');
  await page.waitForFunction(() => document.getElementById('claim-status').textContent.includes('페어링됨'));
  assert.equal(await page.isDisabled('#send'), true);
  pass('paired; send still disabled without a completed record');
  await page.check('input[value="NEEDS_REFILL"]');
  await page.click('#complete');
  assert.equal(await page.isDisabled('#send'), false);
  assert.equal(await page.evaluate(() => window.__syncDebug.transport), 'NOT_SENT');
  pass('completed record -> send enabled, still NOT_SENT (nothing sent automatically)');

  // double press: two clicks in one task -> one submission request
  await page.evaluate(() => { const b = document.getElementById('send'); b.click(); b.click(); });
  await page.waitForFunction(() => window.__syncDebug.transport === 'SENT');
  const submissions = requests.filter((r) => r.url.endsWith('/v1/submissions') && r.method === 'POST');
  assert.equal(submissions.length, 1);
  pass('double press sends exactly one request');
  const dbg = await page.evaluate(() => ({ receipt: window.__syncDebug.receipt, record: window.__syncDebug.record }));
  assert.equal(dbg.receipt.inspectionId, dbg.record.inspectionId);
  assert.match(dbg.receipt.resultDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(dbg.record.sync, 'NOT_SENT');
  pass('SENT shown only with a matching server receipt; the AR-01 record itself is unchanged');
  assert.ok(requests.every((r) => !r.url.includes(invite) && !r.url.includes('?')));
  pass('no token or query string in any request URL');
  await page.screenshot({ path: path.join(output, '02-sent.png'), fullPage: true });

  const v = await receiver.view();
  assert.equal(v.result.status, 'NEEDS_REFILL');
  await receiver.accept(v.resultDigest);
  await page.click('#status');
  await page.waitForFunction(() => document.getElementById('session-state').textContent.includes('ACCEPTED'));
  pass('phone sees ACCEPTED after the explicit receiver accept');
  await page.screenshot({ path: path.join(output, '03-accepted.png'), fullPage: true });
  const shown = describeReceived(await receiver.view());

  await page.reload();
  await page.waitForFunction(() => window.__syncDebug);
  assert.equal(await page.isDisabled('#claim'), true);
  pass('reload cannot re-pair (invite no longer in the URL)');

  assert.deepEqual(errors, []);
  pass('no page or console errors');
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({
    kind: 'SYNTHETIC_LOCAL_BROWSER (headless Edge, loopback server, one machine; not a two-device test)',
    checks, receiverDisplay: shown.split('\n'), submissionRequests: submissions.length,
  }, null, 2));
  console.log(`browser checks passed (${checks.length}); evidence in ${output}`);
} finally {
  await browser.close();
  server.server.closeAllConnections();
  await server.stop();
}
