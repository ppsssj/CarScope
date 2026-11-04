// Private JVM test subprocess; synthetic enrollment and management credentials never enter APKs.
import { createInterface } from 'node:readline';
import path from 'node:path';
import { authorityFixture } from '../inspection-sync-poc/test/authority-fixture.mjs';
import { startAuthorizedHttpsMobileService } from '../inspection-sync-poc/src/https-creation-authority.mjs';
import { tlsFetch } from '../inspection-sync-poc/test/https-helpers.mjs';
import { SyncClient, TRANSPORT } from '../inspection-sync-poc/public/sync-client.mjs';
import { startInspection, completeInspection } from '../mobile-ar-poc/public/inspection-result.mjs';
import { tireResult, TIRE_CHECKS } from '../mobile-ar-poc/public/tire-result.mjs';
import { chargeResult, CHARGE_CHECKS } from '../mobile-ar-poc/public/charge-result.mjs';
import { brakeResult, BRAKE_CHECKS } from '../mobile-ar-poc/public/brake-result.mjs';
import { extraTask } from '../mobile-ar-poc/public/extra-tasks.mjs';
import { getExtraResult } from '../mobile-ar-poc/public/extra-result.mjs';
const proof = process.env.SYNC_ENROLLMENT_FIXTURE;
delete process.env.SYNC_ENROLLMENT_FIXTURE;
if (!/^[A-Za-z0-9_-]{43}$/.test(proof ?? '')) throw new Error('MISSING_PRIVATE_FIXTURE_PROOF');
const f = await authorityFixture({ enrollmentProof: proof }); let service;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const phones = new Map();
try {
  service = await startAuthorizedHttpsMobileService({ authority: { origin: f.origin, issuer: f.issuer, audience: f.audience, credentials: f.credentials, ca: f.pki.ca },
    ...f.pki, databasePath: path.join(f.pki.dir, 'sync.sqlite') });
  f.state.apiOrigin = service.url;
  output({ apiOrigin: service.url, authorityOrigin: f.origin, issuer: f.issuer, audience: f.audience, caFile: path.join(f.pki.dir, 'ca.pem') });
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const request = JSON.parse(line), { op } = request;
    if (op === 'stop') break;
    if (op === 'mobile-submit') {
      const url = new URL(request.qr);
      if (url.origin !== new URL(service.url).origin) throw Error('wrong QR origin');
      const fragment = new URLSearchParams(url.hash.slice(1)), taskId = fragment.get('task');
      const phone = new SyncClient({baseUrl:service.url,taskId,fetchImpl:tlsFetch(f.pki.ca)});
      if (!(await phone.claim(fragment.get('invite'))).ok) throw Error('claim failed');
      let result;
      if (taskId === 'washer-fluid') result = completeInspection(startInspection(), 'UNSURE');
      else {
        const extra = extraTask(taskId);
        const [profile,checks] = extra ? [getExtraResult(taskId),extra.checks] : taskId === 'brake-fluid' ? [brakeResult,BRAKE_CHECKS] : taskId === 'ev-charge.port' ? [chargeResult,CHARGE_CHECKS] : [tireResult,TIRE_CHECKS];
        result = profile.start(taskId);
        for (const check of checks) result = profile.answer(result,check.id,'UNABLE');
        result = profile.complete(result);
      }
      const sent = await phone.send(result);
      if (sent.transport !== TRANSPORT.SENT) throw Error('submit failed');
      phones.set(taskId,phone); output({ok:true,taskId,receipt:sent.receipt}); continue;
    }
    if (op === 'mobile-status') { output(await phones.get(request.taskId).status()); continue; }
    if (op === 'revoke') f.state.revoked = true;
    else if (op === 'expire') f.state.claim.expiresAt = Date.now();
    else if (op === 'rotate') f.rotate();
    else if (op === 'outage') f.state.mode = 'outage';
    else if (op === 'recover') f.state.mode = 'ok';
    else if (op === 'redirect') f.state.mode = 'redirect';
    else if (op === 'delay') f.state.mode = 'delay';
    else throw new Error();
    output({ ok: true });
  }
} catch { process.stderr.write('AUTH_PROVISIONING_FIXTURE_FAILED\n'); process.exitCode = 1; }
finally { for (const phone of phones.values()) phone.dispose(); try { await service?.stop(); } finally { await f.stop(); } }
