// One host, real TLS, random in-memory credentials; never a phone/Android runtime claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startSyncServer } from '../src/server.mjs';
import { FakeSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { SyncClient } from '../public/sync-client.mjs';
import { MobileSync } from '../public/mobile-sync.mjs';
import { buildInviteFragment, parseInviteFragment, receiptMatches, resultDigest } from '../src/protocol.mjs';
import { completeInspection, startInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';
import { localPki, tlsFetch } from './https-helpers.mjs';

test('authenticated TLS: QR v2, lost submit ACK, duplicate, view, explicit accept, phone ACCEPTED, expiry and cancellation', async (t) => {
  const pki = localPki(), fetch = tlsFetch(pki.ca), logs = [], secrets = [];
  t.after(() => pki.cleanup());
  let now = Date.now();
  const credential = randomBytes(32).toString('base64url'); secrets.push(credential);
  const authorizer = new FakeSessionCreationAuthorizer({ token: credential, expiresAt: now + 60_000, now: () => now });
  const s = await startSyncServer({ port: 0, ...pki, authorizer, now: () => now, log: (line) => logs.push(line) });
  t.after(() => s.stop());
  const call = async (method, path, token, body) => {
    const r = await fetch(s.url + path, { method, redirect: 'error', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const create = async () => {
    const r = await call('POST', '/v1/sessions', credential, { taskId: 'washer-fluid' });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body).sort(), ['sessionId', 'taskId', 'receiverToken', 'inviteToken', 'inviteExpiresAt', 'expiresAt', 'serverNow'].sort());
    assert.equal(r.body.serverNow, now);
    assert.notEqual(r.body.receiverToken, r.body.inviteToken);
    secrets.push(r.body.receiverToken, r.body.inviteToken); return r.body;
  };
  assert.equal((await call('POST', '/v1/sessions', null, { taskId: 'washer-fluid' })).status, 403);
  assert.equal((await call('POST', '/v1/sessions', randomBytes(32).toString('base64url'), { taskId: 'washer-fluid' })).status, 403);
  const session = await create(), path = `/v1/sessions/${session.sessionId}`;
  const qr = new URL(buildInviteFragment('washer-fluid', session.inviteToken), 'https://mobile.example/');
  assert.equal(qr.search, ''); assert.ok(!qr.href.includes(session.receiverToken));
  const invite = parseInviteFragment(qr.hash); assert.equal(invite.valid, true);
  const submitBodies = []; let lost = false, duplicateReceipt;
  const phone = new SyncClient({ baseUrl: s.url, backoffMs: 0, fetchImpl: async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith('/v1/claim')) secrets.push((await response.clone().json()).submitToken);
    if (url.endsWith('/v1/submissions')) {
      submitBodies.push(init.body);
      if (!lost) { lost = true; await response.text(); throw new TypeError('ACK lost after server commit'); }
      const data = await response.clone().json(); assert.equal(data.duplicate, true); duplicateReceipt = data.receipt;
    }
    return response;
  } });
  const ui = new MobileSync({ invite: invite.invite, client: phone, schedule: () => 1, unschedule: () => {} });
  t.after(() => ui.close());
  assert.equal((await call('GET', path, session.receiverToken)).body.sessionState, 'CREATED');
  await ui.claim(); assert.equal(ui.snapshot.connection, 'CLAIMED');
  const result = completeInspection(startInspection(), 'NEEDS_REFILL'); ui.setResult(result);
  assert.equal(submitBodies.length, 0, 'completion never automatically submits');
  await Promise.all([ui.send(), ui.send()]);
  assert.equal(ui.snapshot.display, 'SENT'); assert.equal(submitBodies.length, 2);
  assert.equal(submitBodies[0], submitBodies[1]); assert.equal(await receiptMatches(duplicateReceipt, result), true);
  assert.equal(result.sync, 'NOT_SENT');
  const view = (await call('GET', path, session.receiverToken)).body;
  assert.deepEqual(view.result, result); assert.equal(view.resultDigest, await resultDigest(result));
  assert.equal((await call('POST', path + '/accept', session.receiverToken, { resultDigest: 'sha256:' + '0'.repeat(64) })).status, 409);
  await ui.refresh(); assert.equal(ui.snapshot.display, 'SENT', 'view/poll is never acceptance');
  const accepted = await call('POST', path + '/accept', session.receiverToken, { resultDigest: view.resultDigest });
  assert.equal(accepted.body.sessionState, 'ACCEPTED');
  const repeated = await call('POST', path + '/accept', session.receiverToken, { resultDigest: view.resultDigest });
  assert.equal(repeated.body.acceptedAt, accepted.body.acceptedAt);
  await ui.refresh(); assert.equal(ui.snapshot.display, 'ACCEPTED');
  for (const terminal of ['CANCELLED', 'EXPIRED']) {
    const next = await create(), client = new SyncClient({ baseUrl: s.url, fetchImpl: fetch });
    await client.claim(next.inviteToken);
    if (terminal === 'CANCELLED') await call('POST', `/v1/sessions/${next.sessionId}/cancel`, next.receiverToken);
    else now = next.expiresAt + 1;
    assert.equal((await client.status()).sessionState, terminal); client.dispose();
  }
  assert.equal((await call('POST', '/v1/sessions', credential, { taskId: 'washer-fluid' })).status, 403, 'expired creation credential fails closed');
  for (const secret of secrets) assert.ok(!logs.join('\n').includes(secret), 'no credential in server logs');
});
