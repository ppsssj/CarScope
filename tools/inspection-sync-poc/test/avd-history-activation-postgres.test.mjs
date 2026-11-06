// The real Render start commands as child processes, on a throwaway schema of a loopback database. A deploy keeps the
// Start Command, so the first suite is the deploy case; the demonstration needs the other command. Records are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AvdSimulatorCredentialStore, AVD_AUDIENCE } from '../src/avd-simulator-credentials.mjs';
import { assertIsolatedTestDatabase } from '../preflight/database.mjs';
import { historyResult, envelope } from './history-fixtures.mjs';

const uri = process.env.PG_TEST_URL;
const DEFAULT_ENTRY = fileURLToPath(new URL('../src/render-stateful.mjs', import.meta.url));
const DEMO_ENTRY = fileURLToPath(new URL('../src/render-avd-history-demo.mjs', import.meta.url));
const ORIGIN = 'https://avd-history-activation.onrender.com';
const LIST = '/simulator/inspection-records';

function request(port, path, { method = 'GET', bearer, body } = {}) {
  return new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, method, path, headers: {
      Host: new URL(ORIGIN).host, 'X-Forwarded-Proto': 'https',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
    } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => { let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} resolve({ status: r.statusCode, data }); });
    });
    q.on('error', reject);
    q.end(body ? JSON.stringify(body) : undefined);
  });
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

test('Start Command, not a deploy or a variable, opens the AVD read path', { skip: !uri && 'PG_TEST_URL absent: AVD history activation NOT_RUN', timeout: 180_000 }, async (t) => {
  assertIsolatedTestDatabase(uri);
  const { default: { Pool } } = await import('pg');
  const schema = 'cs_avd_h2_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: uri, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Pool({ connectionString: uri, max: 3, options: '-c search_path=' + schema });
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  async function start(entry, env = {}) {
    const port = await freePort();
    const platform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    const child = spawn(process.execPath, [entry], { env: { ...platform, RENDER: 'true', RENDER_EXTERNAL_URL: ORIGIN, PORT: String(port), DATABASE_URL: uri, PGOPTIONS: '-c search_path=' + schema, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (x) => (output += x));
    child.stderr.on('data', (x) => (output += x));
    const closed = new Promise((resolve) => child.once('close', resolve));
    const stop = async () => { child.kill(); await closed; };
    t.after(stop);
    for (let i = 0; ; i++) {
      try { const h = await request(port, '/healthz'); if (h.status === 200) return { port, stop, health: h.data, output: () => output }; } catch {}
      if (i > 150) throw new Error('did not start: ' + output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const SIMULATOR = { CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED' };
  // Everything a person might try. None of these is read by the server.
  const HOPEFUL = { CARSCOPE_AVD_HISTORY_READ: 'OPERATOR_APPROVED', ENABLE_AVD_HISTORY_READ: 'true', enableAvdHistoryRead: 'true', CARSCOPE_HISTORY_READ: 'ALLOW' };

  const first = await start(DEFAULT_ENTRY, SIMULATOR);
  const registry = new AvdSimulatorCredentialStore({ pool: db });
  const A = await registry.register({ label: 'h2-a', ttlMs: 3_600_000 }), B = await registry.register({ label: 'h2-b', ttlMs: 3_600_000 });
  async function inspect(port, who, task, options) {
    const grant = (await request(port, '/simulator/provision', { method: 'POST', bearer: who.enrollmentProof, body: { apiOrigin: ORIGIN, audience: AVD_AUDIENCE } })).data.credential;
    const created = await request(port, '/v1/sessions', { method: 'POST', bearer: grant, body: { taskId: task } });
    assert.equal(created.status, 201);
    const claim = await request(port, '/v1/claim', { method: 'POST', bearer: created.data.inviteToken });
    const result = historyResult(task, options);
    const submitted = await request(port, '/v1/submissions', { method: 'POST', bearer: claim.data.submitToken, body: envelope(result) });
    assert.equal((await request(port, `/v1/sessions/${created.data.sessionId}/accept`, { method: 'POST', bearer: created.data.receiverToken, body: { resultDigest: submitted.data.receipt.resultDigest } })).status, 200);
    return { result, grant, receiver: created.data.receiverToken, submit: claim.data.submitToken };
  }
  const at = Date.now() - 60_000;
  const mine = await inspect(first.port, A, 'coolant-reservoir', { answer: 'FOUND', completedAt: at });
  const theirs = await inspect(first.port, B, 'coolant-reservoir', { answer: 'UNABLE', completedAt: at + 1000 });
  const closed = async (port, bearer) => {
    assert.equal((await request(port, LIST, { bearer })).status, 404);
    assert.equal((await request(port, LIST + '?partId=coolant-reservoir&limit=1', { bearer })).status, 400);
    assert.equal((await request(port, LIST + '/' + randomUUID(), { bearer })).status, 404);
  };
  const ownerRouteClosed = async (port, tokens) => {
    for (const bearer of tokens) {
      assert.equal((await request(port, '/v1/inspection-records', { bearer })).status, 403);
      assert.equal((await request(port, '/v1/inspection-records/' + randomUUID(), { bearer })).status, 403);
    }
  };
  const allTokens = (x, who) => [who.enrollmentProof, x.grant, x.receiver, x.submit, undefined];

  await t.test('a deploy changes nothing: the existing command on simulator mode keeps the path closed', async () => {
    assert.deepEqual(first.health, { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' });
    await closed(first.port, A.enrollmentProof);
    await ownerRouteClosed(first.port, allTokens(mine, A));
  });

  await t.test('no variable opens it, on either mode of the existing command', async () => {
    await first.stop();
    const simulator = await start(DEFAULT_ENTRY, { ...SIMULATOR, ...HOPEFUL });
    assert.equal(Object.hasOwn(simulator.health, 'historyRead'), false);
    await closed(simulator.port, A.enrollmentProof);
    await simulator.stop();
    const denied = await start(DEFAULT_ENTRY, HOPEFUL);
    assert.deepEqual(denied.health, { status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED' });
    await closed(denied.port, A.enrollmentProof);
    await ownerRouteClosed(denied.port, allTokens(mine, A));
    await denied.stop();
  });

  const demo = await start(DEMO_ENTRY, SIMULATOR);

  await t.test('the demonstration command opens only the labelled path', async () => {
    assert.deepEqual(demo.health, { status: 'UP', mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY', historyRead: 'AVD_REGISTRATION_ONLY' });
    assert.match(demo.output(), /OEM vehicle ownership NOT verified/);
    await ownerRouteClosed(demo.port, allTokens(mine, A));
  });

  let myRecord, theirRecord;
  await t.test('own registration reads latest, history and detail; the other registration sees none of it', async () => {
    const latest = await request(demo.port, LIST + '?partId=coolant-reservoir&limit=1', { bearer: A.enrollmentProof });
    assert.equal(latest.status, 200);
    assert.deepEqual(latest.data.items.map((x) => x.inspectionId), [mine.result.inspectionId]);
    assert.equal(latest.data.items[0].ownershipEvidence, 'AVD_REGISTRATION_BINDING');
    myRecord = latest.data.items[0].recordId;
    const other = await request(demo.port, LIST, { bearer: B.enrollmentProof });
    assert.deepEqual(other.data.items.map((x) => x.inspectionId), [theirs.result.inspectionId]);
    theirRecord = other.data.items[0].recordId;
    assert.deepEqual((await request(demo.port, LIST + '/' + myRecord, { bearer: A.enrollmentProof })).data.record.originalResult, mine.result);
    assert.equal((await request(demo.port, LIST + '/' + theirRecord, { bearer: A.enrollmentProof })).status, 404);
    assert.equal((await request(demo.port, LIST + '/' + myRecord, { bearer: B.enrollmentProof })).status, 404);
  });

  await t.test('no credential, a grant, QR tokens and a made-up proof read nothing', async () => {
    for (const bearer of [undefined, mine.grant, mine.receiver, mine.submit, 'a'.repeat(43)]) {
      assert.equal((await request(demo.port, LIST, { bearer })).status, 403);
      assert.equal((await request(demo.port, LIST + '/' + myRecord, { bearer })).status, 403);
    }
  });

  await t.test('an expired registration reads nothing, however its record is addressed', async () => {
    const short = await registry.register({ label: 'h2-short', ttlMs: 60_000 });
    const made = await inspect(demo.port, short, 'battery-12v', { completedAt: at });
    const reading = await request(demo.port, LIST, { bearer: short.enrollmentProof });
    assert.equal(reading.status, 200);
    await db.query('UPDATE cs_avd_registrations SET created_at=1, expires_at=2 WHERE id=$1', [short.registrationId]);
    assert.equal((await request(demo.port, LIST, { bearer: short.enrollmentProof })).status, 403);
    assert.equal((await request(demo.port, LIST + '/' + reading.data.items[0].recordId, { bearer: short.enrollmentProof })).status, 403);
    assert.equal(Number((await db.query('SELECT count(*) n FROM cs_inspection_records WHERE inspection_id=$1', [made.result.inspectionId])).rows[0].n), 1, 'the record stays stored');
  });

  await t.test('a revoked registration reads nothing and the other one keeps working', async () => {
    assert.equal(await registry.revoke({ registrationId: A.registrationId }), true);
    assert.equal((await request(demo.port, LIST, { bearer: A.enrollmentProof })).status, 403);
    assert.equal((await request(demo.port, LIST + '/' + myRecord, { bearer: A.enrollmentProof })).status, 403);
    assert.equal((await request(demo.port, LIST, { bearer: B.enrollmentProof })).status, 200);
  });

  await t.test('no credential reaches the log', async () => {
    for (const secret of [A.enrollmentProof, B.enrollmentProof, mine.grant, mine.receiver]) assert.equal(demo.output().includes(secret), false);
  });

  await t.test('restoring the command closes the path again and every record stays', async () => {
    await demo.stop();
    const restored = await start(DEFAULT_ENTRY, SIMULATOR);
    await closed(restored.port, B.enrollmentProof);
    assert.equal(Object.hasOwn(restored.health, 'historyRead'), false);
    assert.equal(Number((await db.query('SELECT count(*) n FROM cs_inspection_records')).rows[0].n), 3);
    await restored.stop();
  });
});
