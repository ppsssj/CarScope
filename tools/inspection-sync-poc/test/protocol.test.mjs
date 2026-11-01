import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInviteFragment, parseInviteFragment, canonicalJson, resultDigest, checkEnvelope, receiptMatches, isToken, PROTOCOL, PROTOCOL_VERSION } from '../src/protocol.mjs';
import { newToken, hashToken } from '../src/sessions.mjs';
import { HANDOFF, parseHandoff } from '../../mobile-ar-poc/public/handoff.mjs';
import { startInspection, completeInspection, noteAids } from '../../mobile-ar-poc/public/inspection-result.mjs';

const done = (status = 'OK') => completeInspection(noteAids(startInspection(), { cameraUsed: true }), status);
const env = (result) => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });

test('[2] tokens: 32 random bytes as 43-char base64url, unique, stored only as SHA-256 hex', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const t = newToken(); assert.ok(isToken(t), t); seen.add(t); }
  assert.equal(seen.size, 2000);
  const t = newToken();
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), t);
  assert.equal(Buffer.from(t, 'base64url').length, 32);
});

test('[3] QR v1 is unchanged; v1 and v2 parsers never accept each other', () => {
  assert.equal(HANDOFF, '#v=1&task=washer-fluid');
  assert.deepEqual(parseHandoff(HANDOFF), { valid: true, source: 'qr-task' });
  const v2 = buildInviteFragment('washer-fluid', newToken());
  assert.equal(parseHandoff(v2).valid, false, 'the AR-01 page treats a v2 invite as unsupported, it never starts pairing');
  assert.equal(parseInviteFragment(HANDOFF).valid, false);
});

test('[4] QR v2 parses only the exact shape', () => {
  const tok = newToken();
  const frag = buildInviteFragment('washer-fluid', tok);
  assert.equal(frag, `#v=2&task=washer-fluid&invite=${tok}`);
  assert.deepEqual(parseInviteFragment(frag), { valid: true, task: 'washer-fluid', invite: tok });
  assert.deepEqual(parseInviteFragment(`#invite=${tok}&task=washer-fluid&v=2`), { valid: true, task: 'washer-fluid', invite: tok }, 'order free');
  for (const bad of [`#v=3&task=washer-fluid&invite=${tok}`, `#v=2&task=coolant&invite=${tok}`, `#v=2&task=washer-fluid&invite=${tok.slice(1)}`,
    `#v=2&task=washer-fluid&invite=${tok}&vin=KMH`, `#v=2&v=2&task=washer-fluid&invite=${tok}`, `#v=2&task=washer-fluid`, `v=2&task=washer-fluid&invite=${tok}`, '', null]) {
    const r = parseInviteFragment(bad);
    assert.equal(r.valid, false, String(bad));
    assert.ok(!JSON.stringify(r).includes(tok), 'a failed parse never echoes the token');
  }
  assert.throws(() => buildInviteFragment('washer-fluid', 'short'));
});

test('digest is stable over key order and changes with content', async () => {
  const r = done('OK');
  const shuffled = Object.fromEntries(Object.entries(r).reverse());
  assert.equal(canonicalJson(r), canonicalJson(shuffled));
  assert.equal(await resultDigest(r), await resultDigest(shuffled));
  assert.match(await resultDigest(r), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(await resultDigest(r), await resultDigest({ ...r, status: 'UNSURE' }));
});

test('[7][16] envelope: only a COMPLETED record that passes the AR-01 allow-list; no extra or sensitive fields', () => {
  assert.deepEqual(checkEnvelope(env(done()), 'washer-fluid'), []);
  assert.ok(checkEnvelope(env(startInspection()), 'washer-fluid').includes('result: not COMPLETED'), 'IN_PROGRESS refused');
  const r = done();
  for (const field of ['vin', 'plate', 'account', 'deviceId', 'gps', 'location', 'photo', 'video', 'frame', 'tapX']) {
    assert.ok(checkEnvelope(env({ ...r, [field]: 'x' }), 'washer-fluid').some((p) => p.includes(`unexpected field: ${field}`)), field);
  }
  assert.ok(checkEnvelope(env({ ...r, aids: { ...r.aids, point: { x: 0.4, y: 0.5 } } }), 'washer-fluid').includes('result: aids'), 'tap coordinates refused');
  assert.ok(checkEnvelope({ ...env(r), vin: 'KMH' }, 'washer-fluid').includes('envelope: unexpected field vin'));
  assert.ok(checkEnvelope({ ...env(r), protocolVersion: 2 }, 'washer-fluid').includes('envelope: protocolVersion'));
  assert.ok(checkEnvelope(env({ ...r, sync: 'SENT' }), 'washer-fluid').includes('result: sync'), 'the record never claims SENT');
  assert.ok(checkEnvelope(env(r), 'coolant').includes('result: task mismatch'));
  assert.deepEqual(checkEnvelope(null), ['envelope: not an object']);
});

test('receipt must name the same inspection and digest', async () => {
  const r = done();
  const receipt = { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, inspectionId: r.inspectionId, resultDigest: await resultDigest(r), receivedAt: 1, sessionState: 'RESULT_SUBMITTED' };
  assert.equal(await receiptMatches(receipt, r), true);
  assert.equal(await receiptMatches({ ...receipt, resultDigest: 'sha256:00' }, r), false);
  assert.equal(await receiptMatches({ ...receipt, inspectionId: done().inspectionId }, r), false);
  assert.equal(await receiptMatches({ ...receipt, sessionState: 'EXPIRED' }, r), false);
  assert.equal(await receiptMatches({ ...receipt, token: 'x' }, r), false);
  assert.equal(await receiptMatches(null, r), false);
});
