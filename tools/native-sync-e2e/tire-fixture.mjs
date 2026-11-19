// JVM test subprocess only. Private stdio IPC; never expose this fixture to phones/AVDs/LAN.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { localPki, tlsFetch } from '../inspection-sync-poc/test/https-helpers.mjs';
import { startHttpsMobileService } from '../inspection-sync-poc/src/https-mobile-service.mjs';
import { FakeSessionCreationAuthorizer } from '../inspection-sync-poc/src/creation-authorizer.mjs';
import { SyncClient, takeInviteFromLocation } from '../inspection-sync-poc/public/sync-client.mjs';
import { MobileSync } from '../inspection-sync-poc/public/mobile-sync.mjs';
import { canonicalJson, resultDigest } from '../inspection-sync-poc/src/protocol.mjs';
import { startTireResult, answerTire, completeTireResult } from '../mobile-ar-poc/public/tire-result.mjs';

const token = process.env.SYNC_NATIVE_E2E_CREDENTIAL;
delete process.env.SYNC_NATIVE_E2E_CREDENTIAL;
if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) throw new Error('MISSING_PRIVATE_FIXTURE_CREDENTIAL');
const pki = localPki(), fetch = tlsFetch(pki.ca), taskId = 'tire.front-left';
let service, mobile, client, result, firstReceipt, duplicateReceipt, submissions = 0;
let lostAck = false;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  service = await startHttpsMobileService({ ...pki, databasePath: path.join(pki.dir, 'sync.sqlite'),
    authorizer: new FakeSessionCreationAuthorizer({ token, expiresAt: Date.now() + 120_000 }), log: () => {} });
  output({ origin: service.url, caFile: path.join(pki.dir, 'ca.pem') });
  // EOF or explicit stop closes only resources owned by this invocation.
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const command = JSON.parse(line);
    if (command.op === 'stop') break;
    if (command.op === 'complete') {
      assert.equal(mobile, undefined);
      const qr = new URL(command.qr);
      assert.equal(qr.origin, service.url); assert.equal(qr.search, '');
      let historyCleared = false;
      const invite = takeInviteFromLocation(qr, { replaceState: (_, __, value) => { assert.equal(value, '/'); historyCleared = true; } });
      assert.equal(invite.valid, true); assert.equal(invite.task, taskId);
      for (const route of ['/', '/public/mobile-sync.mjs', '/mobile-ar-poc/public/tire-result.mjs']) {
        const response = await fetch(service.url + route);
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      client = new SyncClient({ baseUrl: service.url, taskId, backoffMs: 0, fetchImpl: async (url, init) => {
        const response = await fetch(url, init);
        if (url.endsWith('/v1/submissions')) {
          submissions++;
          const body = await response.clone().json();
          if (!lostAck) {
            assert.equal(response.status, 201); firstReceipt = body.receipt; lostAck = true;
            await response.text(); throw new TypeError('Synthetic ACK loss after commit');
          }
          assert.equal(response.status, 200); assert.equal(body.duplicate, true);
          duplicateReceipt = body.receipt; assert.deepEqual(duplicateReceipt, firstReceipt);
        }
        return response;
      } });
      mobile = new MobileSync({ invite: invite.invite, taskId, client, schedule: () => null, unschedule: () => {} });
      await mobile.claim(); assert.equal(mobile.snapshot.connection, 'CLAIMED');
      let record = startTireResult(taskId);
      for (const [key, answer] of Object.entries({ damage: 'NOT_FOUND', debris: 'FOUND', wear: 'UNABLE' })) record = answerTire(record, key, answer);
      result = completeTireResult(record); mobile.setResult(result);
      assert.equal(submissions, 0); assert.equal(mobile.snapshot.display, 'NOT_SENT');
      output({ display: mobile.snapshot.display, historyCleared, submissions });
    } else if (command.op === 'send') {
      await Promise.all([mobile.send(), mobile.send()]);
      assert.equal(mobile.snapshot.display, 'SENT'); assert.equal(submissions, 2); assert.equal(result.sync, 'NOT_SENT');
      output({ display: mobile.snapshot.display, submissions, duplicateReceiptMatches: Boolean(duplicateReceipt),
        canonical: canonicalJson(result), digest: await resultDigest(result), inspectionId: result.inspectionId });
    } else if (command.op === 'refresh') {
      await mobile.refresh(); output({ display: mobile.snapshot.display });
    } else throw new Error('INVALID_FIXTURE_OPERATION');
  }
} catch {
  // Never print command/QR/headers/credentials, including assertion error values.
  process.stderr.write('NATIVE_TIRE_TLS_FIXTURE_FAILED\n'); process.exitCode = 1;
} finally {
  mobile?.close();
  try { await service?.stop(); } finally { pki.cleanup(); }
}
