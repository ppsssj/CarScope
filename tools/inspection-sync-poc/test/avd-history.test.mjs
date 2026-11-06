// No database. The refusal rules around the Debug AVD read path; the real SQL boundary is in avd-history-postgres.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AvdSimulatorHistoryService, AVD_SIMULATOR_ISSUER, HistoryError, HistoryService, partIdForTask } from '../src/history.mjs';
import { serveAvdSimulatorHistory } from '../src/avd-simulator-http.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { resultDigest } from '../src/protocol.mjs';
import { historyResult } from './history-fixtures.mjs';

const REGISTRATION = '11111111-1111-4111-8111-111111111111';
const avd = (registrationId = REGISTRATION) => ({ authorityNamespace: 'AVD_SIMULATOR', authorityIssuer: AVD_SIMULATOR_ISSUER, userId: null, vehicleId: null, deviceId: null, registrationId, bindingVerifiedAt: 1 });
const verified = { authorityNamespace: 'VERIFIED_VEHICLE', authorityIssuer: 'https://issuer.fixture.invalid/', userId: 'u', vehicleId: 'v', deviceId: 'd', registrationId: 'r', bindingVerifiedAt: 1 };
const unverified = { authorityNamespace: 'UNVERIFIED', authorityIssuer: 'unverified', userId: null, vehicleId: null, deviceId: null, registrationId: null, bindingVerifiedAt: null };

async function row(task = 'coolant-reservoir', owner = avd()) {
  const originalResult = historyResult(task);
  return { recordId: randomUUID(), inspectionId: originalResult.inspectionId, syncSessionId: randomUUID(), taskId: task, partId: partIdForTask(task), schemaVersion: originalResult.schemaVersion, inspectionStatus: originalResult.status, originalResult, resultDigest: await resultDigest(originalResult), completedAt: Date.parse(originalResult.completedAt), receivedAt: 1000, acceptedAt: 2000, createdAt: 2001, ...owner };
}
const fails = async (run, code, status) => assert.rejects(run, (e) => e instanceof HistoryError && e.code === code && e.status === status);

test('each service refuses the other kind of owner', async () => {
  const store = { avdHistoryList: async () => assert.fail('no query for a refused principal'), avdHistoryGet: async () => assert.fail('no query for a refused principal'), historyList: async () => assert.fail('no query for a refused principal'), historyGet: async () => assert.fail('no query for a refused principal') };
  const reader = new AvdSimulatorHistoryService({ store }), owners = new HistoryService({ store });
  for (const principal of [verified, unverified, { ...avd(), authorityIssuer: 'another-issuer' }]) {
    await fails(() => reader.list(principal), 'FORBIDDEN', 403);
    await fails(() => reader.detail(principal, randomUUID()), 'FORBIDDEN', 403);
  }
  await fails(() => owners.list(avd(), new URLSearchParams()), 'FORBIDDEN', 403);
  await fails(() => owners.detail(avd(), randomUUID()), 'FORBIDDEN', 403);
});

test('a row the store returns for another registration or with a broken digest is an error, never a record', async () => {
  const mine = await row(), other = await row('brake-fluid', avd('22222222-2222-4222-8222-222222222222'));
  const answer = (rows) => new AvdSimulatorHistoryService({ store: { avdHistoryList: async () => rows, avdHistoryGet: async () => rows[0] } });
  assert.equal((await answer([mine]).list(avd())).items.length, 1);
  await fails(() => answer([other]).list(avd()), 'INTERNAL', 500);
  await fails(() => answer([other]).detail(avd(), other.recordId), 'INTERNAL', 500);
  await fails(() => answer([{ ...mine, resultDigest: 'sha256:' + '0'.repeat(64) }]).list(avd()), 'INTERNAL', 500);
  await fails(() => answer([{ ...mine, inspectionStatus: 'REVIEW_NEEDED' }]).detail(avd(), mine.recordId), 'INTERNAL', 500);
});

test('the reply labels the scope and carries no registration, user or vehicle identifier', async () => {
  const mine = await row();
  const reader = new AvdSimulatorHistoryService({ store: { avdHistoryList: async () => [mine], avdHistoryGet: async () => mine } });
  const { items: [item] } = await reader.list(avd()), { record } = await reader.detail(avd(), mine.recordId);
  for (const dto of [item, record]) {
    assert.equal(dto.authorityNamespace, 'AVD_SIMULATOR');
    assert.equal(dto.ownershipEvidence, 'AVD_REGISTRATION_BINDING');
    assert.equal(dto.source, 'USER_REPORTED');
    assert.equal(dto.sdkDataIncluded, false);
    for (const key of ['registrationId', 'userId', 'vehicleId', 'deviceId', 'authorityIssuer', 'syncSessionId', 'bindingVerifiedAt']) assert.equal(Object.hasOwn(dto, key), false, key);
  }
  assert.ok(!JSON.stringify(record).includes(REGISTRATION));
});

test('a cursor cannot move to another registration, and bad queries stop before the store', async () => {
  const rows = [await row(), await row()];
  rows[0].completedAt = 2; rows[1].completedAt = 1;
  const reader = new AvdSimulatorHistoryService({ store: { avdHistoryList: async () => rows } });
  const reply = await new AvdSimulatorHistoryService({ store: { avdHistoryList: async () => rows.map((r) => ({ ...r, completedAt: Date.parse(r.originalResult.completedAt) })) } }).list(avd(), new URLSearchParams('limit=1'));
  assert.equal(reply.page.hasMore, true);
  await fails(() => reader.list(avd('22222222-2222-4222-8222-222222222222'), new URLSearchParams({ limit: '1', cursor: reply.page.nextCursor })), 'BAD_REQUEST', 400);
  const never = new AvdSimulatorHistoryService({ store: { avdHistoryList: async () => assert.fail('bad query reached the store') } });
  for (const q of ['limit=0', 'limit=101', 'limit=1&limit=2', 'unknown=1', "partId=x'%20OR%201=1--", 'partId=washer-fluid', 'status=NORMAL', 'cursor=!!!', 'from=yesterday'])
    await fails(() => never.list(avd(), new URLSearchParams(q)), 'BAD_REQUEST', 400);
  await fails(() => never.detail(avd(), 'not-a-uuid'), 'BAD_REQUEST', 400);
});

function exchange(url, { method = 'GET', authorization = 'Bearer ' + 'a'.repeat(43) } = {}) {
  const res = { status: null, body: null, headers: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
  return { req: { method, url, headers: authorization ? { authorization } : {}, socket: { remoteAddress: 'test' } }, res };
}
const allow = { check: async () => ({ ok: true }) };
const http = async (url, { credentialStore, history, limiter = allow, ...request }) => {
  const { req, res } = exchange(url, request);
  await serveAvdSimulatorHistory(req, res, { credentialStore, history, limiter, secure: true, publicOrigin: 'https://carscope.test' });
  return res;
};

test('a revocation that lands during the read stops the response', async () => {
  let answers = 0;
  const history = { list: async () => ({ schemaVersion: 1, items: ['secret'], page: {} }) };
  const credentialStore = { resolveHistoryReader: async () => (++answers === 1 ? avd() : null) };
  const res = await http('/simulator/inspection-records', { credentialStore, history });
  assert.equal(answers, 2);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: { code: 'FORBIDDEN' } });
});

test('wrong method, missing bearer, spent budgets and internal errors answer without reaching a record', async () => {
  const history = { list: async () => assert.fail('must not read'), detail: async () => assert.fail('must not read') };
  const credentialStore = { resolveHistoryReader: async () => avd() };
  assert.equal((await http('/simulator/inspection-records', { credentialStore, history, method: 'POST' })).status, 405);
  assert.equal((await http('/simulator/inspection-records', { credentialStore, history, authorization: null })).status, 403);
  assert.equal((await http('/simulator/inspection-records', { credentialStore, history, authorization: 'Bearer short' })).status, 403);
  assert.equal((await http(`/simulator/inspection-records/${randomUUID()}?x=1`, { credentialStore, history })).status, 400);
  assert.equal((await http('/simulator/inspection-records', { credentialStore, history, limiter: { check: async () => ({ ok: false }) } })).status, 429);
  const spent = { check: async (key) => ({ ok: !key.startsWith('avd-history:') }) };
  assert.equal((await http('/simulator/inspection-records', { credentialStore, history, limiter: spent })).status, 429);
  const broken = await http('/simulator/inspection-records', { credentialStore, history: { list: async () => { throw new Error('postgres://user:secret@host'); } } });
  assert.equal(broken.status, 500);
  assert.deepEqual(broken.body, { error: { code: 'INTERNAL' } }, 'the raw error never reaches the reply');
});

test('reads do not spend the budget that creates a QR', async () => {
  const seen = [];
  await http('/simulator/inspection-records', { credentialStore: { resolveHistoryReader: async () => avd() }, history: { list: async () => ({}) }, limiter: { check: async (key, route) => { seen.push(route); return { ok: true }; } } });
  assert.deepEqual(seen, ['client', 'read', 'token']);
  assert.ok(!seen.includes('avd-provision'));
});

test('activation stays explicit and cannot combine with an owner authority', async () => {
  const publicOrigin = 'https://carscope.test';
  await assert.rejects(startRenderStateful({ publicOrigin, enableAvdHistoryRead: true }), /AVD_HISTORY_READ_REQUIRES_SIMULATION/);
  await assert.rejects(startRenderStateful({ publicOrigin, enableAvdSimulation: true, enableAvdHistoryRead: true, historyAuthority: { issuer: 'https://issuer.example/' } }), /HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN/);
});

test('the deployed CLI cannot open this path: it passes no such option and reads no such variable', () => {
  const source = readFileSync(new URL('../src/render-stateful.mjs', import.meta.url), 'utf8');
  const cli = source.slice(source.indexOf('process.argv[1]'));
  assert.doesNotMatch(cli, /enableAvdHistoryRead/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*HISTORY/);
});
