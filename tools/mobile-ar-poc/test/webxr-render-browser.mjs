// P11-XR: the Render mobile entry with WebXR. The real Start Commands as child processes on real PostgreSQL, real QR v2 HTTP
// under the AVD simulator grant, and real Chrome behind a small stand-in for Render's edge, with the fake XR runtime.
// Not Render, not a phone, not Native, not real tracking. It answers: does the code path a Start Command selects carry the
// whole QR -> AR -> send flow, and does anything other than that command turn the guide on?
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertIsolatedTestDatabase } from '../../inspection-sync-poc/preflight/database.mjs';
import { AvdSimulatorCredentialStore, AVD_AUDIENCE } from '../../inspection-sync-poc/src/avd-simulator-credentials.mjs';
import { buildInviteFragment } from '../../inspection-sync-poc/src/protocol.mjs';
import { MOBILE_HEADERS } from '../../inspection-sync-poc/src/mobile-page.mjs';
import { WEBXR_GUIDE_FILES } from '../webxr-modules.mjs';

const uri = process.env.PG_TEST_URL;
if (!uri) throw Error('Set PG_TEST_URL to an isolated loopback PostgreSQL. Without it this suite is NOT_RUN, not PASS.');
assertIsolatedTestDatabase(uri);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.resolve(process.env.POC_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'carscope-p11-xr'), 'render');
if (output.toLowerCase().startsWith(path.resolve(repo).toLowerCase())) throw Error('Evidence stays out of the repository');
await mkdir(output, { recursive: true });

const ORIGIN = 'https://webxr-render-test.onrender.com';
const DEFAULT_ENTRY = fileURLToPath(new URL('../../inspection-sync-poc/src/render-stateful.mjs', import.meta.url));
const EXPERIMENT_ENTRY = fileURLToPath(new URL('../../inspection-sync-poc/src/render-webxr-experiment.mjs', import.meta.url));
const SIMULATOR = { CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED' };
// Everything a person might try. None of these is read by the server.
const HOPEFUL = { CARSCOPE_WEBXR_GUIDE: 'EXPERIMENT', WEBXR_GUIDE: '1', ENABLE_WEBXR: 'true' };
const GUIDE = '/mobile-ar-poc/public/webxr/';

const result = { kind: 'REAL_ENTRYPOINT_REAL_POSTGRES_SYNTHETIC_EDGE_AND_XR', render: 'NOT_RUN', realDevice: 'NOT_RUN', realTracking: 'NOT_RUN', nativeQr: 'NOT_RUN', checks: [], errors: [] };
const pass = message => { result.checks.push(`PASS ${message}`); console.log(`PASS ${message}`); };
const fakeSource = (await readFile(new URL('./fake-webxr.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');

// Same request a Render ingress forwards: its own Host and forwarded scheme, and the page's Origin as the public one.
const direct = (port, target, { method = 'GET', bearer, body } = {}) => new Promise((resolve, reject) => {
  const q = http.request({ host: '127.0.0.1', port, method, path: target, headers: {
    Host: new URL(ORIGIN).host, 'X-Forwarded-Proto': 'https',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
  } }, r => {
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => {
      const raw = Buffer.concat(chunks);
      let data = null; try { data = JSON.parse(raw.toString('utf8')); } catch { /* not JSON */ }
      resolve({ status: r.statusCode, headers: r.headers, data, text: raw.toString('utf8'), size: raw.length });
    });
  });
  q.on('error', reject);
  q.end(body ? JSON.stringify(body) : undefined);
});
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let target = 0;
const edge = http.createServer((req, res) => {
  const headers = { ...req.headers, host: new URL(ORIGIN).host, 'x-forwarded-proto': 'https', ...(req.headers.origin ? { origin: ORIGIN } : {}) };
  const up = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});
await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve));
const edgeUrl = `http://127.0.0.1:${edge.address().port}`; // Loopback is a secure context, as HTTPS is on a phone.

const { Pool } = createRequire(new URL('../../inspection-sync-poc/package.json', import.meta.url))('pg');
const schema = 'cs_p11_xr_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString: uri, max: 2 });
await admin.query(`CREATE SCHEMA ${schema}`);
const db = new Pool({ connectionString: uri, max: 3, options: '-c search_path=' + schema });

const children = [];
async function start(entry, env = {}) {
  const port = await freePort();
  const platform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const child = spawn(process.execPath, [entry], { env: { ...platform, RENDER: 'true', RENDER_EXTERNAL_URL: ORIGIN, PORT: String(port), DATABASE_URL: uri, PGOPTIONS: '-c search_path=' + schema, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stdout.on('data', x => (log += x));
  child.stderr.on('data', x => (log += x));
  const closed = new Promise(resolve => child.once('close', resolve));
  const stop = async () => { child.kill(); await closed; };
  children.push(stop);
  for (let i = 0; ; i++) {
    try { const h = await direct(port, '/healthz'); if (h.status === 200) { target = port; return { port, stop, health: h.data, log: () => log }; } } catch { /* not up yet */ }
    if (i > 150) throw Error('did not start: ' + log);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function openSession(port, registration, taskId = 'washer-fluid') {
  const grant = (await direct(port, '/simulator/provision', { method: 'POST', bearer: registration.enrollmentProof, body: { apiOrigin: ORIGIN, audience: AVD_AUDIENCE } })).data.credential;
  const created = await direct(port, '/v1/sessions', { method: 'POST', bearer: grant, body: { taskId } });
  assert.equal(created.status, 201);
  return { ...created.data, fragment: buildInviteFragment(created.data.taskId, created.data.inviteToken) };
}

let browser;
async function openPhone(session, fake = {}, lab=false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr(${JSON.stringify(fake)}));`);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const log = { requests: [], problems: [], secrets: [session.inviteToken, session.receiverToken] };
  page.on('pageerror', error => log.problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/net::ERR_NO_BUFFER_SPACE/.test(message.text())) log.problems.push(message.text()); }); // The page retries that code itself: page-start-guard.js.
  page.on('request', request => log.requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' }));
  page.on('response', async response => {
    if (response.url().endsWith('/v1/claim') && response.ok()) { const body = await response.json().catch(() => null); if (body?.submitToken) log.secrets.push(body.submitToken); }
  });
  await page.goto(`${edgeUrl}/${lab?'webxr-guide.html':''}${session.fragment}`);
  if(lab){
    await page.waitForFunction(() => window.__selfInspection);
    await page.waitForFunction(() => document.querySelector('#sync-claim').disabled && document.body.textContent.includes('연결됐어요'));
  }else{
    await page.waitForFunction(()=>document.body.dataset.ready==='true');
    await page.getByText('차량과 연결됐어요',{exact:true}).waitFor();
  }
  return { context, page, log };
}
const posted = (log, suffix) => log.requests.filter(r => r.method === 'POST' && r.url.endsWith(suffix)).length;
const waitPhase = (page, name) => page.waitForFunction(value => window.__webXrGuide?.state?.phase === value, name);
const settle = (page, n = 3) => page.evaluate(async steps => { for (let i = 0; i < steps; i++) { window.__env.step(); await new Promise(resolve => setTimeout(resolve)); } }, n);
const waitSync = (page, state) => page.waitForFunction(s => (document.getElementById('done-sync')??document.querySelector('[data-sync-state]'))?.dataset.syncState === s, state);
const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });
async function noLeak({ page, log }) {
  const html = await page.content(), address = page.url();
  assert.equal(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie])), '[{},{},""]');
  assert.equal(new URL(address).hash, '');
  const state = await page.evaluate(() => JSON.stringify(history.state));
  for (const secret of log.secrets) {
    for (const [where, text] of [['DOM', html], ['address', address], ['history state', state]]) assert.ok(!text.includes(secret), `token in ${where}`);
    assert.ok(log.requests.every(r => !r.url.includes(secret) && !r.body.includes(secret)), 'token in a request URL or body');
  }
}
const finish = async ({ context, log }, label) => { assert.deepEqual(log.problems, [], `${label}: page errors and CSP violations`); await context.close(); };
const answerAll = async page => {
  await page.locator('#checklist input').evaluateAll(boxes => boxes.forEach(box => box.click()));
  await page.click('#primary'); await page.click('[data-status="NEEDS_REFILL"]'); await page.click('#primary'); await page.click('#primary');
  await page.waitForSelector('body[data-step="done"]');
};

try {
  browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  result.browser = browser.version();

  { // A deploy changes nothing: the existing command, with every variable someone might try.
    const service = await start(DEFAULT_ENTRY, { ...SIMULATOR, ...HOPEFUL });
    assert.deepEqual(service.health, { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' }, 'no guide in the health report');
    const home = await direct(service.port, '/');
    assert.equal(home.headers['permissions-policy'], MOBILE_HEADERS['Permissions-Policy'], 'no XR permission');
    assert.ok(!home.text.includes('data-webxr-guide'));
    for (const [name] of WEBXR_GUIDE_FILES) assert.equal((await direct(service.port, GUIDE + name)).status, 404, name);

    const registry = new AvdSimulatorCredentialStore({ pool: db });
    const registration = await registry.register({ label: 'p11-xr', ttlMs: 3_600_000 });
    const session = await openSession(service.port, registration);
    const phone = await openPhone(session);
    await phone.page.waitForTimeout(150);
    assert.equal(await phone.page.locator('#xr-entry').count(), 0, 'nothing is offered on an AR-capable phone');
    assert.equal(phone.log.requests.some(r => /webxr|three/.test(r.url)), false);
    await phone.page.locator('.safety-card input').check();
    await phone.page.getByRole('button',{name:'직접 점검 시작',exact:true}).click();
    for(const c of await phone.page.locator('.observation-card input').all())await c.check();
    for(const name of ['관찰 결과 선택하기','보충이 필요해요','선택한 결과 확인하기','직접 확인한 결과로 확정'])await phone.page.getByRole('button',{name,exact:true}).click();
    await phone.page.getByRole('button',{name:'차량으로 결과 보내기',exact:true}).click();
    await waitSync(phone.page, 'SENT');
    await finish(phone, 'default command');
    await service.stop();
    pass('the existing Start Command with hopeful variables offers no guide, adds no permission, serves no guide file, and the QR flow completes');
  }

  const registry = new AvdSimulatorCredentialStore({ pool: db });
  const registration = await registry.register({ label: 'p11-xr-on', ttlMs: 3_600_000 });

  { // The experiment command: the whole flow of this task.
    const service = await start(EXPERIMENT_ENTRY, SIMULATOR);
    assert.deepEqual(service.health, { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY', mobileGuide: 'WEBXR_EXPERIMENT' });
    assert.match(service.log(), /WebXR guide EXPERIMENT on/);
    const home = await direct(service.port, '/');
    assert.equal(home.headers['permissions-policy'], MOBILE_HEADERS['Permissions-Policy'] + ', xr-spatial-tracking=(self)');
    assert.equal(home.headers['content-security-policy'], MOBILE_HEADERS['Content-Security-Policy'], 'the CSP is not relaxed');
    assert.match(home.headers['strict-transport-security'], /max-age=31536000/);
    assert.match(home.text, /data-webxr-guide="enabled"/);
    for (const [name] of WEBXR_GUIDE_FILES) assert.equal((await direct(service.port, GUIDE + name)).status, 200, name);
    assert.ok((await direct(service.port, GUIDE + 'three.module.min.js')).size > 100_000, 'three.js is really served');
    assert.equal((await direct(service.port, '/mobile-ar-poc/node_modules/three/package.json')).status, 404, 'only the listed file of the package');
    assert.match((await direct(service.port, '/mobile-ar-poc/public/guide-washer-fluid-cap-area.svg')).headers['content-type'], /^image\/svg\+xml/, 'the part guide picture is served on the Render path');

    const session = await openSession(service.port, registration);
    const phone = await openPhone(session,{},true);
    const { page, log } = phone;
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.waitForFunction(() => window.__webXrGuide?.capability);
    assert.equal(posted(log, '/v1/claim'), 1, 'the phone connected by itself, once');
    assert.equal(await page.locator('#xr-methods-title').isVisible(), true);
    await shot(page, 'methods');
    await page.locator('#xr-entry-open').click();
    await waitPhase(page, 'READY');
    await shot(page, 'guide');
    await page.locator('#xr-start').click();
    await waitPhase(page, 'AIMING');
    await settle(page);
    await page.waitForFunction(() => document.getElementById('xr-status').textContent === '표면 찾음');
    assert.equal(await page.evaluate(() => window.__env.tap(195, 200)), true, 'a tap on the scene places the arrow');
    await settle(page);
    await waitPhase(page, 'PLACED');
    assert.equal(await page.evaluate(() => window.__webXrGuide.state.markerMode), 'ANCHOR');
    assert.equal(await page.locator('#xr-status').textContent(), '공간에 고정됨 · 내가 지정한 위치');
    assert.ok((await page.evaluate(() => window.__env.readMarks())).blue.count > 100, 'the 3D arrow is drawn with three.js served by this entry');
    await shot(page, 'placed');
    await noLeak(phone);
    await page.locator('#xr-return').click();
    await page.waitForFunction(() => !window.__webXrGuide.open);
    assert.equal(await page.evaluate(() => window.__sameDocument), true);
    assert.equal(await page.evaluate(() => window.__selfInspection.state.step), 'check');
    assert.match(await page.locator('body > main').textContent(), /연결됐어요/);
    assert.equal(await page.evaluate(() => window.__env.currentSession.ended && window.__env.anchors.every(a => a.deleted)), true);
    assert.equal(posted(log, '/v1/submissions'), 0, 'AR sent nothing');
    await shot(page, 'checklist');

    await answerAll(page);
    await shot(page, 'confirm-done');
    assert.equal(posted(log, '/v1/submissions'), 0, 'finishing does not send: the person does');
    await page.locator('#sync-send').click();
    await waitSync(page, 'SENT');
    const view = await direct(service.port, `/v1/sessions/${session.sessionId}`, { bearer: session.receiverToken });
    assert.equal(view.data.sessionState, 'RESULT_SUBMITTED');
    assert.equal(view.data.result.status, 'NEEDS_REFILL');
    assert.deepEqual(Object.keys(view.data.result.aids).sort(), ['cameraUsed', 'locationMarked'], 'result contract unchanged');
    const accepted = await direct(service.port, `/v1/sessions/${session.sessionId}/accept`, { method: 'POST', bearer: session.receiverToken, body: { resultDigest: view.data.resultDigest } });
    assert.equal(accepted.status, 200);
    await page.locator('#sync-refresh').click();
    await waitSync(page, 'ACCEPTED');
    await shot(page, 'accepted');
    assert.equal(posted(log, '/v1/claim'), 1);
    assert.equal(posted(log, '/v1/submissions'), 1);
    assert.ok(log.requests.every(r => r.url.startsWith(edgeUrl)), 'same origin only');
    await noLeak(phone);
    await finish(phone, 'experiment');
    assert.equal(service.log().includes(session.inviteToken), false, 'no token reaches the log');

    await service.stop();
    pass('the experiment Start Command carries QR -> auto connect -> method choice -> AR -> tap -> anchored arrow -> checklist -> send -> vehicle accept');
  }

  { // Other parts, and a production-mode service, on the experiment command: nothing is widened.
    const service = await start(EXPERIMENT_ENTRY, SIMULATOR);
    const session = await openSession(service.port, registration, 'brake-fluid');
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(`${fakeSource}\nwindow.__env = installFakeXr(createFakeXr({}));`);
    const page = await context.newPage();
    const urls = [];
    page.on('request', request => urls.push(request.url()));
    await page.goto(`${edgeUrl}/${session.fragment}`);
    await page.waitForFunction(() => document.body.dataset.ready==='true');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#xr-entry-open').count(), 0);
    assert.equal(urls.some(url => /webxr|three/.test(url)), false, 'other parts load nothing of it');
    await context.close();
    await service.stop();

    const denied = await start(EXPERIMENT_ENTRY);
    assert.deepEqual(denied.health, { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED', mobileGuide: 'WEBXR_EXPERIMENT' });
    assert.equal((await direct(denied.port, '/simulator/provision', { method: 'POST', bearer: registration.enrollmentProof, body: { apiOrigin: ORIGIN, audience: AVD_AUDIENCE } })).status, 404, 'no simulator path appears');
    assert.equal((await direct(denied.port, '/v1/sessions', { method: 'POST', bearer: 'a'.repeat(43), body: { taskId: 'washer-fluid' } })).status, 403, 'session creation stays denied');
    assert.equal((await direct(denied.port, '/v1/inspection-records')).status, 403, 'history stays denied');
    await denied.stop();
    pass('on the experiment command other parts get no guide, and without simulator mode creation and history stay denied');
  }

  { // Restoring the command turns it off again.
    const restored = await start(DEFAULT_ENTRY, SIMULATOR);
    assert.deepEqual(restored.health, { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' });
    assert.ok(!(await direct(restored.port, '/')).text.includes('data-webxr-guide'));
    assert.equal((await direct(restored.port, GUIDE + 'webxr-guide.mjs')).status, 404);
    await restored.stop();
    pass('restoring the Start Command removes the guide with nothing else to undo');
  }
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.errors.push(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const stop of children) await stop().catch(() => {});
  await new Promise(resolve => edge.close(resolve));
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
  await admin.end();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, browser: result.browser, errors: result.errors }, null, 2));
}
