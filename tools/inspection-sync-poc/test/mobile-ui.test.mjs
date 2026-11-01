import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { takeMobileHandoff } from '../public/mobile-handoff.mjs';
import { MobileSync } from '../public/mobile-sync.mjs';
import { SyncClient } from '../public/sync-client.mjs';
import { startMobileDevServer } from '../src/mobile-dev-server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { newToken } from '../src/sessions.mjs';
import { buildInviteFragment, PROTOCOL, PROTOCOL_VERSION, receiptMatches, resultDigest } from '../src/protocol.mjs';
import { completeInspection, startInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';
import { buildStaging } from '../../mobile-ar-poc/staging/build.mjs';

const done = () => completeInspection(startInspection(), 'NEEDS_REFILL');
const env = (result) => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });
const json = (status, body) => new Response(JSON.stringify(body), { status });
const sched = () => { const pending = new Set(); return { schedule: (fn) => { pending.add(fn); return fn; }, unschedule: (fn) => pending.delete(fn), pending }; };
const receipt = async (result) => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, inspectionId: result.inspectionId, resultDigest: await resultDigest(result), receivedAt: 1, sessionState: 'RESULT_SUBMITTED' });

test('mobile entry: v1/direct unchanged; v2 strict and fragment stripped synchronously, invalid never exposes invite', () => {
  const token = newToken(), calls = [];
  const take = (hash) => takeMobileHandoff({ hash, pathname: '/', search: '' }, { replaceState: (...args) => calls.push(args) });
  assert.equal(take('').handoff.source, 'direct');
  assert.equal(take('#v=1&task=washer-fluid').handoff.source, 'qr-task'); assert.equal(calls.length, 0);
  const v2 = take(buildInviteFragment('washer-fluid', token));
  assert.equal(v2.version, 2); assert.equal(v2.invite, token); assert.ok(!JSON.stringify(v2.handoff).includes(token));
  assert.deepEqual(calls.pop(), [null, '', '/']);
  for (const bad of [`#v=2&task=washer-fluid&invite=${token}&invite=${token}`, `#v=2&task=washer-fluid&invite=${token}&vin=x`, '#v=2&task=washer-fluid&invite=bad']) {
    const r = take(bad); assert.equal(r.handoff.valid, false); assert.equal(r.invite, null);
  }
});

test('SyncClient: concurrent claim once, lost response cannot re-claim, disposal rejects late credentials', async () => {
  let calls = 0, release;
  const c = new SyncClient({ baseUrl: 'https://local.test', fetchImpl: async () => { calls++; return new Promise((r) => { release = r; }); } });
  const a = c.claim(newToken()), b = c.claim(newToken()); assert.equal(a, b); assert.equal(calls, 1);
  c.dispose(); release(json(200, { submitToken: newToken(), taskId: 'washer-fluid' }));
  assert.equal((await a).ok, false); assert.equal(c.paired, false);
  assert.equal((await c.claim(newToken())).ok, false); assert.equal(calls, 1);
  const lost = new SyncClient({ baseUrl: 'https://local.test', fetchImpl: async () => { calls++; throw new TypeError('lost'); } });
  assert.equal((await lost.claim(newToken())).ok, false); const before = calls;
  assert.equal((await lost.claim(newToken())).ok, false); assert.equal(calls, before);
});

test('SyncClient: after SENT a different record reaches server CONFLICT, never inherits another receipt', async (t) => {
  const s = await startMobileDevServer({ authorizer: new LocalTestSessionCreationAuthorizer() }); t.after(() => s.stop());
  const p = await s.service.create({ taskId: 'washer-fluid' });
  const c = new SyncClient({ baseUrl: s.url }); await c.claim(p.inviteToken);
  assert.equal((await c.send(done())).transport, 'SENT');
  assert.equal((await c.send(done())).transport, 'REJECTED_CONFLICT');
});

test('mobile controller: completed only, duplicate buttons, SENT distinct from verified ACCEPTED', async (t) => {
  const s = await startMobileDevServer({ authorizer: new LocalTestSessionCreationAuthorizer() }); t.after(() => s.stop());
  const p = await s.service.create({ taskId: 'washer-fluid' }), timers = sched(), client = new SyncClient({ baseUrl: s.url });
  const ui = new MobileSync({ invite: p.inviteToken, client, ...timers }); t.after(() => ui.close());
  assert.equal(ui.snapshot.canSend, false);
  await Promise.all([ui.claim(), ui.claim()]);
  const result = done(); ui.setResult(result);
  await Promise.all([ui.send(), ui.send()]); assert.equal(ui.snapshot.display, 'SENT'); assert.equal(result.sync, 'NOT_SENT');
  await ui.refresh(); assert.equal(ui.snapshot.display, 'SENT');
  const view = await s.service.view(p.sessionId, p.receiverToken); await s.service.accept(p.sessionId, p.receiverToken, view.resultDigest);
  await ui.refresh(); assert.equal(ui.snapshot.display, 'ACCEPTED'); assert.equal(timers.pending.size, 0);
  assert.ok(!JSON.stringify(ui.snapshot).includes(p.inviteToken));
  const invalid = new MobileSync({ invite: newToken(), client: new SyncClient({ baseUrl: s.url }), ...sched() });
  invalid.setResult(startInspection()); assert.equal(invalid.snapshot.canSend, false); assert.equal(invalid.snapshot.display, 'REJECTED_INVALID'); invalid.close();
});

test('mobile controller: CANCELLED and EXPIRED differ, stop polling, close discards credentials', async (t) => {
  let now = Date.now(); const s = await startMobileDevServer({ now: () => now, authorizer: new LocalTestSessionCreationAuthorizer(), limits: { sessionTtlMs: 10 } }); t.after(() => s.stop());
  for (const terminal of ['CANCELLED', 'EXPIRED']) {
    const p = await s.service.create({ taskId: 'washer-fluid' }), client = new SyncClient({ baseUrl: s.url }), timer = sched();
    const ui = new MobileSync({ invite: p.inviteToken, client, ...timer }); await ui.claim();
    if (terminal === 'CANCELLED') await s.service.cancel(p.sessionId, p.receiverToken); else now = p.expiresAt + 1;
    await ui.refresh(); assert.equal(ui.snapshot.display, terminal === 'EXPIRED' ? 'REJECTED_EXPIRED' : terminal);
    assert.equal(timer.pending.size, 0); ui.close(); assert.equal(client.paired, false);
  }
});

test('mobile controller: offline, timeout, rate limit and 500 stay failures; manual retry keeps same result', async () => {
  const result = done();
  for (const failure of ['offline', 'timeout', 429, 500]) {
    let attempts = 0; const bodies = [];
    const client = new SyncClient({ baseUrl: 'https://test.invalid', timeoutMs: 10, retries: 0, fetchImpl: async (url, opts) => {
      if (url.endsWith('/claim')) return json(200, { taskId: 'washer-fluid', submitToken: newToken() });
      bodies.push(opts.body); attempts++;
      if (attempts > 1) return json(201, { receipt: await receipt(result) });
      if (failure === 'offline') throw new TypeError('offline');
      if (failure === 'timeout') return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' }))));
      return json(failure, { error: { code: failure === 429 ? 'RATE_LIMITED' : 'INTERNAL' } });
    } });
    const ui = new MobileSync({ invite: newToken(), client, ...sched() }); await ui.claim(); ui.setResult(result); await ui.send();
    assert.equal(ui.snapshot.received, false); assert.equal(ui.snapshot.canSend, true);
    assert.equal(ui.snapshot.display, failure === 'timeout' ? 'FAILED_TIMEOUT' : failure === 429 ? 'RATE_LIMITED' : 'FAILED_NETWORK');
    await ui.send(); assert.equal(ui.snapshot.display, 'SENT'); assert.equal(bodies[0], bodies[1]); ui.close();
  }
});

test('mobile controller: bad receipt including missing receivedAt cannot report SENT/ACCEPTED; stale callbacks ignored', async () => {
  const result = done(), valid = await receipt(result);
  assert.equal(await receiptMatches({ ...valid, receivedAt: undefined }, result), false);
  for (const wrong of [{ ...valid, resultDigest: 'sha256:' + '0'.repeat(64) }, { ...valid, inspectionId: 'wrong' }]) {
    const client = new SyncClient({ baseUrl: 'https://test.invalid', retries: 0, fetchImpl: async (url) => json(200, url.endsWith('/claim') ? { taskId: 'washer-fluid', submitToken: newToken() } : { receipt: wrong }) });
    const ui = new MobileSync({ invite: newToken(), client, ...sched() }); await ui.claim(); ui.setResult(result); await ui.send();
    assert.equal(ui.snapshot.display, 'FAILED_NETWORK'); assert.equal(ui.snapshot.received, false); ui.close();
  }
  let finish;
  const fake = { paired: true, transport: 'NOT_SENT', status: () => new Promise((r) => { finish = r; }), dispose() { this.paired = false; } };
  const ui = new MobileSync({ invite: null, client: fake, ...sched() });
  const p = ui.refresh(); ui.close(); finish({ ok: true, sessionState: 'ACCEPTED', receipt: valid }); await p;
  assert.equal(ui.snapshot.display, 'REJECTED_CLOSED');
});

test('mobile dev boundary: default creation denied, strict same-origin CSP, static deployment excludes development modules', async (t) => {
  const s = await startMobileDevServer(); t.after(() => s.stop());
  assert.equal((await fetch(s.url + '/v1/sessions', { method: 'POST' })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    const r = http.get(s.url + '/', { headers: { Host: 'untrusted.example' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
  });
  assert.equal(invalidHost, 403);
  assert.equal((await fetch(s.url + '/v1/sessions', { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const page = await fetch(s.url); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /mobile-dev-entry/);
  assert.equal((await fetch(s.url + '/?sync=1')).status, 400);
  const outputDirectory = path.join(await mkdtemp(path.join(tmpdir(), 'carscope-static-boundary-')), 'staging');
  await buildStaging({ origin: 'https://mobile.example/', outputDirectory });
  const files = await readdir(outputDirectory);
  assert.ok(!files.some((f) => /sync|dev/.test(f)));
  assert.ok(!(await readFile(path.join(outputDirectory, 'app-entry.mjs'), 'utf8')).includes('SyncClient'));
  assert.match(await readFile(path.join(outputDirectory, 'index.html'), 'utf8'), /src="\/app-entry.mjs"/);
});

test('mobile timers are called unbound and polling pauses, resumes, then stops on page close', async () => {
  let scheduled = 0, released = 0;
  const schedule = function () { assert.equal(this, undefined); scheduled++; return scheduled; };
  const unschedule = function () { assert.equal(this, undefined); released++; };
  const client = { paired: false, async claim() { this.paired = true; return { ok: true }; }, dispose() { this.paired = false; } };
  const ui = new MobileSync({ invite: newToken(), client, schedule, unschedule }); await ui.claim();
  assert.equal(scheduled, 1); ui.pause(); assert.equal(released, 1); ui.resume(); assert.equal(scheduled, 2);
  ui.close(); assert.equal(released, 2); assert.equal(client.paired, false);
});
