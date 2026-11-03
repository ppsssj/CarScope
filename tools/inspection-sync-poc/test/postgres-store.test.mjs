import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { SessionService, STATES, hashToken, newToken } from '../src/sessions.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';
import { PROTOCOL, PROTOCOL_VERSION } from '../src/protocol.mjs';

const uri = process.env.PG_TEST_URL;
const dummy = () => ({
  id: randomUUID(), state: 'CREATED', inviteHash: hashToken(newToken()), receiverHash: hashToken(newToken()),
  submitHash: null, result: null, resultDigest: null,
});
test('PostgreSQL SessionStore: real database, cross-connection contention, recovery and token isolation',
  { skip: !uri && 'PG_TEST_URL not supplied: real PostgreSQL integration NOT_RUN', timeout: 90_000 },
  async t => {
    // This test truncates tables; never allow it to run against Render or any public database host.
    const host = new URL(uri).hostname;
    if (!['localhost','127.0.0.1','::1','[::1]'].includes(host)) throw new Error('TEST_DATABASE_MUST_BE_LOOPBACK');
    const { Pool } = await import('pg');
    const poolA = new Pool({ connectionString: uri, max: 4, connectionTimeoutMillis: 5000 });
    const poolB = new Pool({ connectionString: uri, max: 4, connectionTimeoutMillis: 5000 });
    const storeA = await PostgreSQLSessionStore.open({ pool: poolA });
    const storeB = await PostgreSQLSessionStore.open({ pool: poolB });
    t.after(async () => { await Promise.allSettled([storeA.close(), storeB.close()]); });
    const reset = async () => {
      await poolA.query('TRUNCATE cs_session_tokens, cs_sessions, cs_rate_windows CASCADE');
    };
    await t.test('atomic capacity across independent connections', async () => {
      await reset();
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? storeA : storeB).insert(dummy(), { maxSessions: 3 })));
      assert.equal(results.filter(Boolean).length, 3);
      assert.equal(await storeA.count(), 3);
      assert.equal(await storeB.count(), 3);
    });
    await t.test('claim → submit → accept across two active connections', async () => {
      await reset();
      const svc = new SessionService({ store: storeA });
      const created = await svc.create({ taskId: 'washer-fluid' });
      const state = await storeB.get(created.sessionId);
      assert.equal(state.state, 'CREATED');
      assert.ok(!JSON.stringify(state).includes(created.inviteToken));
      assert.ok(!JSON.stringify(state).includes(created.receiverToken));
      assert.equal(await storeB.idByTokenHash('invite', hashToken(created.inviteToken)), created.sessionId);
      const claim = await svc.claim(created.inviteToken);
      const result = completeInspection(startInspection(), 'OK');
      const submitted = await svc.submit(claim.submitToken, { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result });
      const v = await new SessionService({ store: storeB }).view(created.sessionId, created.receiverToken);
      assert.equal(v.sessionState, STATES.RESULT_SUBMITTED);
      assert.equal(v.result.inspectionId, submitted.receipt.inspectionId);
      await new SessionService({ store: storeB }).accept(created.sessionId, created.receiverToken, submitted.receipt.resultDigest);
      assert.equal((await svc.view(created.sessionId, created.receiverToken)).sessionState, STATES.ACCEPTED);
    });
    await t.test('data survives closing one PostgreSQL pool and opening a fresh pool', async () => {
      await reset();
      const s = dummy();
      await storeA.insert(s);
      const freshPool = new Pool({ connectionString: uri, max: 1, connectionTimeoutMillis: 5000 });
      try {
        const recovered = await PostgreSQLSessionStore.open({ pool: freshPool });
        assert.deepEqual(await recovered.get(s.id), s);
        assert.equal(await recovered.idByTokenHash('invite', s.inviteHash), s.id);
      } finally { await freshPool.end(); }
    });
    await t.test('one-time claim is linearizable across two pools', async () => {
      await reset();
      const s = dummy();
      assert.equal(await storeA.insert(s), true);
      const h1 = hashToken(newToken()), h2 = hashToken(newToken());
      const claim = (store, hash) => store.update(s.id, current => {
        if (current.state !== 'CREATED') throw new Error('ALREADY_CLAIMED');
        return { ...current, state: 'CLAIMED', submitHash: hash };
      });
      const out = await Promise.allSettled([claim(storeA, h1), claim(storeB, h2)]);
      assert.equal(out.filter(x => x.status === 'fulfilled').length, 1);
      const actual = (await storeA.get(s.id)).submitHash;
      assert.ok(actual === h1 || actual === h2);
      assert.equal(await storeB.idByTokenHash('submit', actual), s.id);
      assert.equal(await storeA.idByTokenHash('invite', s.inviteHash), s.id);
    });
    await t.test('rollback, predicate, token index and deletion are atomic', async () => {
      await reset();
      const s = dummy();
      await storeA.insert(s);
      await assert.rejects(storeB.update(s.id, () => ({ ...s, state: 'ACCEPTED' })));
      assert.equal((await storeA.get(s.id)).state, 'CREATED');
      assert.equal(await storeA.delete(s.id, () => false), false);
      assert.equal(await storeB.idByTokenHash('invite', s.inviteHash), s.id);
      assert.equal(await storeB.delete(s.id, () => true), true);
      assert.equal(await storeA.idByTokenHash('invite', s.inviteHash), null);
      assert.equal(await storeA.get(s.id), null);
    });
    await t.test('Render stateful HTTP ingress has PostgreSQL health and hard-denied creation', async () => {
      await reset();
      const poolC = new Pool({ connectionString: uri, max: 3, connectionTimeoutMillis: 5000 });
      const origin = 'https://carscope-test.onrender.com';
      const app = await startRenderStateful({ pool: poolC, publicOrigin: origin });
      try {
        const port = app.server.address().port;
        const get = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
          const req = http.request({ hostname: '127.0.0.1', port, method, path, headers: {
            Host: new URL(origin).host, 'X-Forwarded-Proto': 'https', ...headers,
          } }, res => {
            const chunks = [];
            res.on('data', v => chunks.push(v));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
          });
          req.on('error', reject); req.end();
        });
        const h = await get('/healthz');
        assert.equal(h.status, 200);
        assert.equal(JSON.parse(h.body).sessionCreation, 'DENIED');
        assert.equal((await get('/')).status, 200);
        assert.equal((await get('/v1/sessions/00000000-0000-4000-8000-000000000000')).status, 401);
        assert.equal((await get('/', 'GET', { Host: 'evil.test' })).status, 403);
        assert.equal((await get('/', 'GET', { 'X-Forwarded-Proto': 'http' })).status, 403);
      } finally { await app.stop(); }
    });
    await t.test('rate windows enforce a shared concurrent limit', async () => {
      await reset();
      const opts = { rates: { client: { limit: 3, windowMs: 60000 } }, now: () => 1800000000000 };
      const out = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? storeA : storeB).rateCheck('same-client', 'client', opts)));
      assert.equal(out.filter(x => x.ok).length, 3);
      assert.equal(out.filter(x => !x.ok).length, 9);
    });
  });
