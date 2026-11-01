// Synthetic local E2E (one machine, loopback): receiver simulator -> session -> QR v2 -> phone client submits a
// completed AR-01 record -> server ACK -> receiver views -> explicit accept -> phone sees ACCEPTED.
// This is NOT a two-device verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncServer } from '../src/server.mjs';
import { ReceiverClient, describeReceived } from '../bin/receiver.mjs';
import { SyncClient, TRANSPORT, takeInviteFromLocation } from '../public/sync-client.mjs';
import { resultDigest } from '../src/protocol.mjs';
import { startInspection, completeInspection, noteAids, validateResult, STATES } from '../../mobile-ar-poc/public/inspection-result.mjs';

test('E2E: pair, submit, ACK, view, accept, done', async () => {
  const s = await startSyncServer({ port: 0, log: () => {} });
  try {
    const receiver = new ReceiverClient({ baseUrl: s.url });
    const session = await receiver.create('washer-fluid');
    assert.match(session.fragment, /^#v=2&task=washer-fluid&invite=[A-Za-z0-9_-]{43}$/);
    const qrUrl = new URL(session.fragment, 'https://phone.example/');

    // phone: scan, strip the invite from the address bar, pair
    const replaced = [];
    const invite = takeInviteFromLocation(qrUrl, { replaceState: (...a) => replaced.push(a) });
    assert.equal(invite.valid, true);
    assert.equal(replaced.length, 1);
    const phone = new SyncClient({ baseUrl: s.url });
    assert.equal((await phone.claim(invite.invite)).ok, true);
    assert.equal((await receiver.view()).sessionState, 'CLAIMED');

    // phone: AR-01 inspection completed, explicit send
    const record = completeInspection(noteAids(startInspection(), { cameraUsed: true, markerDetected: false }), 'NEEDS_REFILL');
    assert.equal(record.state, STATES.COMPLETED);
    const frozen = JSON.stringify(record);
    const sent = await phone.send(record);
    assert.equal(sent.transport, TRANSPORT.SENT);
    assert.equal(sent.receipt.resultDigest, await resultDigest(record));
    assert.equal(JSON.stringify(record), frozen, 'the completed record is not modified by sending');

    // receiver: sees the user-reported result, accepts explicitly
    const v = await receiver.waitForResult({ intervalMs: 10, timeoutMs: 2000 });
    assert.equal(v.sessionState, 'RESULT_SUBMITTED');
    assert.deepEqual(v.result, record);
    assert.deepEqual(validateResult(v.result), []);
    const shown = describeReceived(v);
    for (const must of ['워셔액 셀프 점검', '사용자 보고 결과', '완료 시각', '전송 상태', '실제 차량 센서 진단이 아닙니다']) assert.ok(shown.includes(must), must);
    const accepted = await receiver.accept(v.resultDigest);
    assert.equal(accepted.sessionState, 'ACCEPTED');
    assert.match(describeReceived(accepted), /전송 상태: 수락됨/);

    // phone: sees the acceptance; resending is not possible
    assert.equal((await phone.status()).sessionState, 'ACCEPTED');
    const again = new SyncClient({ baseUrl: s.url });
    assert.equal((await again.claim(invite.invite)).outcome, TRANSPORT.REJECTED_CLOSED, 'the invite cannot be reused by a second phone');
  } finally { await s.stop(); }
});

test('E2E: receiver declines -> cancel, result deleted, phone sees CANCELLED', async () => {
  const s = await startSyncServer({ port: 0, log: () => {} });
  try {
    const receiver = new ReceiverClient({ baseUrl: s.url });
    const session = await receiver.create();
    const phone = new SyncClient({ baseUrl: s.url });
    await phone.claim(session.fragment.split('invite=')[1]);
    assert.equal((await phone.send(completeInspection(startInspection(), 'UNSURE'))).transport, TRANSPORT.SENT);
    await receiver.cancel();
    assert.equal((await receiver.view()).result, null);
    assert.equal((await phone.status()).sessionState, 'CANCELLED');
  } finally { await s.stop(); }
});

test('E2E: claim response lost -> invite stays used, no token re-issued; recovery is a new QR from the vehicle', async () => {
  const s = await startSyncServer({ port: 0, log: () => {} });
  try {
    const receiver = new ReceiverClient({ baseUrl: s.url });
    const first = await receiver.create();
    const invite = first.fragment.split('invite=')[1];
    // The request reaches the server (CREATED -> CLAIMED), the response is lost on the way back.
    let lostBody = null;
    const lossy = async (url, init) => { const res = await fetch(url, init); lostBody = await res.text(); throw new TypeError('network connection lost'); };
    const phone = new SyncClient({ baseUrl: s.url, fetchImpl: lossy });
    const c1 = await phone.claim(invite);
    assert.deepEqual([c1.ok, c1.outcome], [false, TRANSPORT.FAILED_NETWORK]);
    assert.equal(phone.paired, false, 'the phone holds no submit token');
    assert.match(lostBody, /submitToken/, 'the server did issue one; it was lost in transit');
    assert.equal((await receiver.view()).sessionState, 'CLAIMED');

    // Retrying the same invite does not re-issue or re-expose anything.
    const retry = new SyncClient({ baseUrl: s.url });
    const c2 = await retry.claim(invite);
    assert.deepEqual([c2.ok, c2.outcome, c2.code], [false, TRANSPORT.REJECTED_CLOSED, 'ALREADY_CLAIMED']);
    assert.equal(retry.paired, false);
    assert.equal((await retry.send(completeInspection(startInspection(), 'OK'))).transport, TRANSPORT.REJECTED_UNAUTHORIZED, 'nothing can be sent');

    // Explicit recovery: the vehicle cancels the stuck session and shows a new QR.
    await receiver.cancel();
    const lostSubmitToken = JSON.parse(lostBody).submitToken;
    const stale = await fetch(`${s.url}/v1/submissions`, { method: 'POST', headers: { Authorization: `Bearer ${lostSubmitToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol: 'inspection-sync', protocolVersion: 1, result: completeInspection(startInspection(), 'OK') }) });
    assert.equal(stale.status, 409, 'a lost submit token (if it ever leaked) is dead once the session is cancelled');
    assert.equal((await new SyncClient({ baseUrl: s.url }).claim(invite)).outcome, TRANSPORT.REJECTED_UNAUTHORIZED, 'the old invite no longer resolves');

    const second = new ReceiverClient({ baseUrl: s.url });
    const fresh = await second.create();
    const phone2 = new SyncClient({ baseUrl: s.url });
    assert.equal((await phone2.claim(fresh.fragment.split('invite=')[1])).ok, true);
    assert.equal((await phone2.send(completeInspection(startInspection(), 'OK'))).transport, TRANSPORT.SENT);
  } finally { await s.stop(); }
});
