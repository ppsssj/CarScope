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
