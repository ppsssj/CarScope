// Private JVM test subprocess; synthetic enrollment and management credentials never enter APKs.
import { createInterface } from 'node:readline';
import path from 'node:path';
import { authorityFixture } from '../inspection-sync-poc/test/authority-fixture.mjs';
import { startAuthorizedHttpsMobileService } from '../inspection-sync-poc/src/https-creation-authority.mjs';
const proof = process.env.SYNC_ENROLLMENT_FIXTURE;
delete process.env.SYNC_ENROLLMENT_FIXTURE;
if (!/^[A-Za-z0-9_-]{43}$/.test(proof ?? '')) throw new Error('MISSING_PRIVATE_FIXTURE_PROOF');
const f = await authorityFixture({ enrollmentProof: proof }); let service;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  service = await startAuthorizedHttpsMobileService({ authority: { origin: f.origin, issuer: f.issuer, audience: f.audience, credentials: f.credentials, ca: f.pki.ca },
    ...f.pki, databasePath: path.join(f.pki.dir, 'sync.sqlite') });
  f.state.apiOrigin = service.url;
  output({ apiOrigin: service.url, authorityOrigin: f.origin, issuer: f.issuer, audience: f.audience, caFile: path.join(f.pki.dir, 'ca.pem') });
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const { op } = JSON.parse(line);
    if (op === 'stop') break;
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
finally { try { await service?.stop(); } finally { await f.stop(); } }
