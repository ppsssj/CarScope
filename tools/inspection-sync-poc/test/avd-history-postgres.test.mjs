// Real PostgreSQL and HTTP on a throwaway schema, with records made by the real provision -> QR -> Accept flow.
// Loopback databases only. The records are synthetic, and a simulator registration is not a vehicle owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { AvdSimulatorCredentialStore, AVD_AUDIENCE } from '../src/avd-simulator-credentials.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { resultDigest } from '../src/protocol.mjs';
import { AVD_SIMULATOR_ISSUER, partIdForTask } from '../src/history.mjs';
import { historyResult, envelope } from './history-fixtures.mjs';

const uri = process.env.PG_TEST_URL;
const ORIGIN = 'https://carscope-avd-history.onrender.com';
function request(port, path, { method = 'GET', bearer, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, method, path, headers: {
      Host: new URL(ORIGIN).host, 'X-Forwarded-Proto': 'https',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...headers,
    } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => { let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} resolve({ status: r.statusCode, data, headers: r.headers }); });
    });
    q.on('error', reject);
    q.end(body ? JSON.stringify(body) : undefined);
  });
}

test('Debug AVD reads see exactly the records of the presenting registration', { skip: !uri && 'PG_TEST_URL absent: AVD history over PostgreSQL NOT_RUN', timeout: 120_000 }, async (t) => {
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(uri).hostname)) throw new Error('PG_TEST_URL_MUST_BE_LOCAL');
  const { Pool } = await import('pg');
  const schema = 'avd_history_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: uri, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const open = () => new Pool({ connectionString: uri, max: 3, options: `-c search_path=${schema}` });
  const db = open();
  t.after(() => db.end());

  const off = await startRenderStateful({ pool: open(), publicOrigin: ORIGIN, enableAvdSimulation: true });
  t.after(() => off.stop());
  const on = await startRenderStateful({ pool: open(), publicOrigin: ORIGIN, enableAvdSimulation: true, enableAvdHistoryRead: true });
  t.after(() => on.stop());
  const portOff = off.server.address().port, port = on.server.address().port;
  const registry = new AvdSimulatorCredentialStore({ pool: db });
  const A = await registry.register({ label: 'history-a', ttlMs: 3_600_000 }), B = await registry.register({ label: 'history-b', ttlMs: 3_600_000 });

  const grants = new Map();
  async function grant(who) {
    if (!grants.has(who)) grants.set(who, (await request(port, '/simulator/provision', { method: 'POST', bearer: who.enrollmentProof, body: { apiOrigin: ORIGIN, audience: AVD_AUDIENCE } })).data.credential);
    return grants.get(who);
  }
  const tokens = {};
  async function inspect(who, task, options) {
    const created = await request(port, '/v1/sessions', { method: 'POST', bearer: await grant(who), body: { taskId: task } });
    assert.equal(created.status, 201);
    const claim = await request(port, '/v1/claim', { method: 'POST', bearer: created.data.inviteToken });
    const result = historyResult(task, options);
    const submitted = await request(port, '/v1/submissions', { method: 'POST', bearer: claim.data.submitToken, body: envelope(result) });
    assert.equal(submitted.status, 201);
    const accepted = await request(port, `/v1/sessions/${created.data.sessionId}/accept`, { method: 'POST', bearer: created.data.receiverToken, body: { resultDigest: submitted.data.receipt.resultDigest } });
    assert.equal(accepted.status, 200);
    tokens.receiver = created.data.receiverToken; tokens.submit = claim.data.submitToken;
    return result;
  }
  const base = Date.now() - 3_600_000;
  // The two shapes the operator reports in production: v1 washer OK and v2 coolant REVIEW_NEEDED, plus a later coolant.
  const washer = await inspect(A, 'washer-fluid', { answer: 'NOT_FOUND', completedAt: base });
  const coolantOld = await inspect(A, 'coolant-reservoir', { answer: 'FOUND', completedAt: base + 1000 });
  const coolantNew = await inspect(A, 'coolant-reservoir', { answer: 'UNABLE', completedAt: base + 2000 });
  const other = await inspect(B, 'coolant-reservoir', { answer: 'FOUND', completedAt: base + 3000 });
  assert.equal(washer.status, 'OK');
  assert.equal(coolantOld.status, 'REVIEW_NEEDED');

  async function insertOwned(authority, task) {
    const result = historyResult(task, { completedAt: base + 4000 }), recordId = randomUUID();
    await db.query(`INSERT INTO cs_inspection_records(record_id,inspection_id,sync_session_id,task_id,part_id,schema_version,inspection_status,original_result,result_digest,completed_at,received_at,accepted_at,authority_namespace,authority_issuer,user_id,vehicle_id,device_id,registration_id,binding_verified_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,2,$11,$12,$13,$14,$15,$16,$17,3)`,
    [recordId, result.inspectionId, randomUUID(), task, partIdForTask(task), result.schemaVersion, result.status, JSON.stringify(result), await resultDigest(result), Date.parse(result.completedAt), ...authority]);
    return recordId;
  }
  // Same issuer and registration on an owner row: only the namespace keeps it out of the simulator scope.
  const verifiedRecord = await insertOwned(['VERIFIED_VEHICLE', AVD_SIMULATOR_ISSUER, 'user-x', 'vehicle-x', 'device-x', A.registrationId, 1], 'coolant-reservoir');
  const unverifiedRecord = await insertOwned(['UNVERIFIED', 'unverified', null, null, null, null, null], 'coolant-reservoir');
  const table = async () => (await db.query(`SELECT count(*)::int n, md5(string_agg(t::text, '|' ORDER BY record_id)) h FROM cs_inspection_records t`)).rows[0];
  const before = await table();
  const list = (bearer, q = '') => request(port, '/simulator/inspection-records' + q, { bearer });
  const detail = (bearer, id) => request(port, '/simulator/inspection-records/' + id, { bearer });

  await t.test('off by default: the same simulator server has no such route', async () => {
    assert.equal((await request(portOff, '/simulator/inspection-records', { bearer: A.enrollmentProof })).status, 404);
    assert.equal((await request(portOff, '/simulator/inspection-records?limit=1', { bearer: A.enrollmentProof })).status, 400);
    const health = await request(portOff, '/healthz');
    assert.deepEqual(health.data, { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' });
    assert.equal((await request(port, '/healthz')).data.historyRead, 'AVD_REGISTRATION_ONLY');
  });

  await t.test('the owner route stays closed to every AVD credential, on or off', async () => {
    for (const p of [port, portOff]) for (const bearer of [A.enrollmentProof, grants.get(A), tokens.receiver, tokens.submit, undefined]) {
      assert.equal((await request(p, '/v1/inspection-records', { bearer })).status, 403);
      assert.equal((await request(p, '/v1/inspection-records/' + verifiedRecord, { bearer })).status, 403);
    }
  });

  await t.test('list: only this registration, newest first, labelled, no-store', async () => {
    const r = await list(A.enrollmentProof);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(r.data.items.map((x) => x.inspectionId), [coolantNew.inspectionId, coolantOld.inspectionId, washer.inspectionId]);
    assert.ok(r.data.items.every((x) => x.authorityNamespace === 'AVD_SIMULATOR' && x.ownershipEvidence === 'AVD_REGISTRATION_BINDING' && x.source === 'USER_REPORTED'));
    assert.ok(!JSON.stringify(r.data).includes(A.registrationId));
    assert.deepEqual((await list(B.enrollmentProof)).data.items.map((x) => x.inspectionId), [other.inspectionId]);
  });

  await t.test('by part: latest is limit=1, the page walks every record once', async () => {
    const latest = await list(A.enrollmentProof, '?partId=coolant-reservoir&limit=1');
    assert.deepEqual(latest.data.items.map((x) => x.inspectionId), [coolantNew.inspectionId]);
    assert.equal(latest.data.page.hasMore, true);
    const next = await list(A.enrollmentProof, '?partId=coolant-reservoir&limit=1&cursor=' + latest.data.page.nextCursor);
    assert.deepEqual(next.data.items.map((x) => x.inspectionId), [coolantOld.inspectionId]);
    assert.equal(next.data.page.hasMore, false);
    assert.deepEqual((await list(A.enrollmentProof, '?partId=washer-fluid-cap')).data.items.map((x) => x.inspectionStatus), ['OK']);
    assert.equal((await list(A.enrollmentProof, '?partId=battery-12v')).data.items.length, 0);
    assert.equal((await list(B.enrollmentProof, '?partId=coolant-reservoir&limit=1&cursor=' + latest.data.page.nextCursor)).status, 400, 'a cursor belongs to one registration');
  });

  await t.test('bound parameters: hostile values are refused or match nothing', async () => {
    for (const q of ['?limit=101', '?limit=0', '?limit=1&limit=2', '?nope=1', `?partId=${encodeURIComponent("x' OR '1'='1")}`, `?status=${encodeURIComponent("OK'--")}`, '?cursor=%27'])
      assert.equal((await list(A.enrollmentProof, q)).status, 400, q);
    assert.equal((await table()).n, before.n);
  });

  await t.test('detail: own record with its original; another owner looks like nothing', async () => {
    const id = (await list(A.enrollmentProof, '?partId=coolant-reservoir&limit=1')).data.items[0].recordId;
    const mine = await detail(A.enrollmentProof, id);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.data.record.originalResult, coolantNew);
    assert.equal(mine.data.record.resultDigest, await resultDigest(coolantNew));
    assert.equal((await detail(B.enrollmentProof, id)).status, 404);
    for (const hidden of [verifiedRecord, unverifiedRecord, randomUUID()]) assert.equal((await detail(A.enrollmentProof, hidden)).status, 404, hidden);
  });

  await t.test('only the enrollment proof reads: grants, QR tokens and made-up values do not', async () => {
    for (const bearer of [grants.get(A), tokens.receiver, tokens.submit, 'a'.repeat(43), undefined]) {
      assert.equal((await list(bearer)).status, 403);
      const id = (await list(A.enrollmentProof)).data.items[0].recordId;
      assert.equal((await detail(bearer, id)).status, 403);
    }
    assert.equal((await request(port, '/simulator/inspection-records', { bearer: A.enrollmentProof, headers: { 'X-Forwarded-Proto': 'http' } })).status, 403, 'plain HTTP at the edge');
    assert.equal((await request(port, '/simulator/inspection-records', { bearer: A.enrollmentProof, headers: { Host: 'evil.invalid' } })).status, 403, 'another host');
    assert.equal((await request(port, '/simulator/inspection-records', { method: 'POST', bearer: A.enrollmentProof })).status, 405);
  });

  await t.test('reading changes nothing in the records', async () => {
    assert.deepEqual(await table(), before);
  });

  await t.test('expiry and revocation close the read; the records stay stored', async () => {
    const short = await registry.register({ label: 'history-short', ttlMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await list(short.enrollmentProof)).status, 403, 'expired');
    const id = (await list(A.enrollmentProof)).data.items[0].recordId;
    assert.equal(await registry.revoke({ registrationId: A.registrationId }), true);
    assert.equal((await list(A.enrollmentProof)).status, 403);
    assert.equal((await detail(A.enrollmentProof, id)).status, 403);
    assert.equal((await list(B.enrollmentProof)).status, 200, 'another registration is unaffected');
    assert.deepEqual(await table(), before);
  });
});
