// Actual PostgreSQL + actual TLS + synthetic authority. Owners and vehicles are fixtures:
// this proves scoping and fail-closed behaviour, not a real issuer or real vehicle ownership.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PostgreSQLSessionStore } from '../src/postgres-store.mjs';
import { DEFAULT_RATES } from '../src/rate-limit.mjs';
import { startSyncServer } from '../src/server.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { httpsCreationAuthorizer } from '../src/https-creation-authority.mjs';
import { httpsHistoryAuthorizer } from '../src/https-history-authority.mjs';
import { tlsFetch } from './https-helpers.mjs';
import { historyAuthorityFixture } from './history-authority-fixture.mjs';
import { historyResult, envelope } from './history-fixtures.mjs';

const uri = process.env.PG_TEST_URL;
const wide = { limit: 100_000, windowMs: 60_000 };
const rates = { ...DEFAULT_RATES, client: wide, token: wide, create: wide, claim: wide, submit: wide, read: wide };

test(
  'history auth: authority adapter over actual PostgreSQL and TLS keeps every failure DENY_DEFAULT',
  { skip: !uri && 'PG_TEST_URL absent: actual PostgreSQL history auth NOT_RUN', timeout: 180_000 },
  async (t) => {
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(uri).hostname))
      throw Error('HISTORY_TEST_DATABASE_MUST_BE_LOOPBACK');
    const { Pool } = await import('pg');
    const schema = 'cs_history_auth_test_' + randomUUID().replaceAll('-', '');
    if (!/^cs_history_auth_test_[a-f0-9]{32}$/.test(schema)) throw Error('INVALID_OWNED_SCHEMA');
    const admin = new Pool({ connectionString: uri, max: 2, connectionTimeoutMillis: 5000 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pools = [],
      apps = [];
    const pool = () => {
      const p = new Pool({
        connectionString: uri,
        max: 6,
        options: '-c search_path=' + schema,
        connectionTimeoutMillis: 5000,
      });
      p.on('error', () => {});
      pools.push(p);
      return p;
    };
    const f = await historyAuthorityFixture(),
      f2 = await historyAuthorityFixture({ issuer: 'https://second-authority.fixture.invalid/' });
    const fetchTls = tlsFetch(f.pki.ca);
    const db = pool();
    const store = await PostgreSQLSessionStore.open({ pool: db });
    const logs = [];
    const serve = async (authority = f, s = store) => {
      const app = await startSyncServer({
        port: 0,
        store: s,
        rates,
        authorizer: httpsCreationAuthorizer(authority.creation),
        // Generous deadlines: concurrency asserts isolation, so a slow runner must not become a false denial.
        historyAuthorizer: httpsHistoryAuthorizer({ ...authority.history, timeoutMs: 5000, authorityTimeoutMs: 5000 }),
        tlsCert: f.pki.tlsCert,
        tlsKey: f.pki.tlsKey,
        log: (line) => logs.push(line),
      });
      apps.push(app);
      return app;
    };
    t.after(async () => {
      await Promise.allSettled(apps.map((a) => a.stop()));
      await Promise.allSettled([f.stop(), f2.stop()]);
      await Promise.allSettled(pools.map((p) => p.end()));
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    const app = await serve(),
      app2 = await serve(f2);
    const call = async (server, method, path, token, { body, headers = {} } = {}) => {
      const r = await fetchTls(server.url + path, {
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    const list = (token, server = app, query = '?limit=100') =>
      call(server, 'GET', '/v1/inspection-records' + query, token);
    const detail = (token, recordId, server = app) =>
      call(server, 'GET', '/v1/inspection-records/' + recordId, token);
    const ids = (r) => r.body.items.map((x) => x.recordId).sort();
    /** The real path: creation credential -> QR claim -> submission -> explicit Accept -> archive. */
    async function archive(binding, task, authority = f, server = app) {
      const result = historyResult(task, { completedAt: Date.now() - 1000 });
      const created = await call(server, 'POST', '/v1/sessions', authority.issueCreate(binding), {
        body: { taskId: task, userId: 'user-spoof', vehicleId: 'vehicle-spoof' },
      });
      assert.equal(created.status, 201);
      const claimed = await call(server, 'POST', '/v1/claim', created.body.inviteToken);
      assert.equal(claimed.status, 200);
      const submitted = await call(server, 'POST', '/v1/submissions', claimed.body.submitToken, {
        body: envelope(result),
      });
      assert.equal(submitted.status, 201);
      const accepted = await call(server, 'POST', `/v1/sessions/${created.body.sessionId}/accept`, created.body.receiverToken, {
        body: { resultDigest: submitted.body.receipt.resultDigest },
      });
      assert.equal(accepted.status, 200);
      const row = (
        await db.query('SELECT * FROM cs_inspection_records WHERE inspection_id=$1', [result.inspectionId])
      ).rows[0];
      assert.equal(row.user_id, binding.userId, 'spoofed create body never becomes the owner');
      return { recordId: row.record_id, receiverToken: created.body.receiverToken, result };
    }
    const owners = {
      a: f.register({ userId: 'user-A', vehicleId: 'vehicle-1' }),
      aOther: f.register({ userId: 'user-A', vehicleId: 'vehicle-2' }),
      b: f.register({ userId: 'user-B', vehicleId: 'vehicle-3' }),
    };
    const aRecord = await archive(owners.a, 'brake-fluid'),
      aOtherRecord = await archive(owners.aOther, 'washer-fluid'),
      bRecord = await archive(owners.b, 'coolant-reservoir');

    await t.test('another user, another vehicle and another issuer each see nothing', async () => {
      const [a, aOther, b] = [f.issue(owners.a), f.issue(owners.aOther), f.issue(owners.b)];
      assert.deepEqual(ids(await list(a)), [aRecord.recordId]);
      assert.deepEqual(ids(await list(aOther)), [aOtherRecord.recordId], 'same user, other vehicle');
      assert.deepEqual(ids(await list(b)), [bRecord.recordId]);
      assert.equal((await detail(a, aRecord.recordId)).status, 200);
      for (const [token, recordId] of [
        [b, aRecord.recordId],
        [aOther, aRecord.recordId],
        [a, aOtherRecord.recordId],
        [a, bRecord.recordId],
      ])
        assert.equal((await detail(token, recordId)).status, 404);
      // Same opaque user/vehicle under a different issuer is a different principal.
      const foreign = f2.register({ userId: 'user-A', vehicleId: 'vehicle-1' }),
        foreignToken = f2.issue(foreign);
      assert.equal((await list(foreignToken, app2)).body.items.length, 0);
      assert.equal((await detail(foreignToken, aRecord.recordId, app2)).status, 404);
      const foreignRecord = await archive(foreign, 'fuse-box', f2, app2);
      assert.deepEqual(ids(await list(foreignToken, app2)), [foreignRecord.recordId]);
      assert.deepEqual(ids(await list(a)), [aRecord.recordId]);
      assert.equal((await list(foreignToken)).status, 403, 'a credential is valid only at its own authority');
    });

    await t.test('headers, queries and non-history credentials cannot select or establish scope', async () => {
      const a = f.issue(owners.a);
      const spoofed = await call(app, 'GET', '/v1/inspection-records?limit=100', a, {
        headers: {
          'X-User-Id': 'user-B',
          'X-Vehicle-Id': 'vehicle-3',
          'X-Forwarded-User': 'user-B',
          'X-Authority-Issuer': 'https://second-authority.fixture.invalid/',
        },
      });
      assert.deepEqual(ids(spoofed), [aRecord.recordId]);
      for (const q of ['userId=user-B', 'vehicleId=vehicle-3', 'registrationId=x', 'issuer=x'])
        assert.equal((await list(a, app, '?' + q)).status, 400);
      for (const token of [
        null,
        aRecord.receiverToken,
        f.issueCreate(owners.a),
        'x'.repeat(43),
        owners.a.vehicleId,
        owners.a.userId,
      ]) {
        const r = await list(token);
        assert.equal(r.status, 403);
        assert.deepEqual(r.body, { error: { code: 'FORBIDDEN' } });
      }
    });

    await t.test('expiry, revocation and registration loss deny; stored records stay untouched', async () => {
      const before = (await db.query('SELECT count(*) AS n FROM cs_inspection_records')).rows[0].n;
      const expired = f.issue(owners.a, { patch: { expiresAt: Date.now() - 1 } });
      assert.equal((await list(expired)).status, 403);
      const reused = f.issue(owners.a);
      assert.equal((await list(reused)).status, 200);
      f.claim(reused).expiresAt = Date.now();
      assert.equal((await list(reused)).status, 403, 'reuse after expiry');
      const revoked = f.issue(owners.a);
      assert.equal((await list(revoked)).status, 200);
      f.revokeCredential(revoked);
      assert.equal((await list(revoked)).status, 403);
      assert.equal((await detail(revoked, aRecord.recordId)).status, 403);
      const lost = f.register({ userId: 'user-A', vehicleId: 'vehicle-1' }),
        lostToken = f.issue(lost);
      assert.deepEqual(ids(await list(lostToken)), [aRecord.recordId], 'new device registration keeps same-owner records');
      f.revokeRegistration(lost);
      assert.equal((await list(lostToken)).status, 403);
      const unverified = f.register({ userId: 'user-A', vehicleId: 'vehicle-1', ownershipVerified: false });
      assert.equal((await list(f.issue(unverified))).status, 403);
      assert.equal((await db.query('SELECT count(*) AS n FROM cs_inspection_records')).rows[0].n, before);
    });

    await t.test('vehicle transfer: former owner loses access, new owner never inherits records', async () => {
      const sold = f.register({ userId: 'user-Seller', vehicleId: 'vehicle-transfer' });
      const soldRecord = await archive(sold, 'fuse-box');
      const sellerToken = f.issue(sold);
      assert.deepEqual(ids(await list(sellerToken)), [soldRecord.recordId]);
      // The authority reports the transfer; nothing in CarScope rewrites stored ownership.
      f.revokeRegistration(sold);
      const bought = f.register({ userId: 'user-Buyer', vehicleId: 'vehicle-transfer' }),
        buyerToken = f.issue(bought);
      assert.equal((await list(sellerToken)).status, 403);
      assert.equal((await list(buyerToken)).body.items.length, 0);
      assert.equal((await detail(buyerToken, soldRecord.recordId)).status, 404);
      const buyerRecord = await archive(bought, 'battery-12v');
      assert.deepEqual(ids(await list(buyerToken)), [buyerRecord.recordId]);
      const row = (await db.query('SELECT user_id FROM cs_inspection_records WHERE record_id=$1', [soldRecord.recordId])).rows[0];
      assert.equal(row.user_id, 'user-Seller');
      // The seller keeps a different vehicle but cannot reach the sold one through it.
      const nextCar = f.register({ userId: 'user-Seller', vehicleId: 'vehicle-next' });
      assert.equal((await list(f.issue(nextCar))).body.items.length, 0);
      assert.equal((await detail(f.issue(nextCar), soldRecord.recordId)).status, 404);
    });

    await t.test('concurrent reads stay isolated; mid-read revocation or owner change returns no record', async () => {
      const [a, b] = [f.issue(owners.a), f.issue(owners.b)];
      const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => list(i % 2 ? b : a)));
      burst.forEach((r, i) => {
        assert.equal(r.status, 200);
        assert.deepEqual(ids(r), [(i % 2 ? bRecord : aRecord).recordId]);
      });
      const originalList = store.historyList.bind(store),
        n = 12;
      let entered = 0,
        release;
      const gate = new Promise((resolve) => (release = resolve));
      try {
        // Every request has passed the first check and read its rows when the state changes.
        store.historyList = async (query) => {
          const rows = await originalList(query);
          if (++entered === n) release();
          await gate;
          return rows;
        };
        const revoked = f.issue(owners.a);
        const pending = Array.from({ length: n }, () => list(revoked));
        await gate;
        f.revokeCredential(revoked);
        for (const r of await Promise.all(pending)) {
          assert.equal(r.status, 403);
          assert.equal(JSON.stringify(r.body).includes(aRecord.recordId), false);
        }
        store.historyList = originalList;
        entered = 0;
        const changed = f.register({ userId: 'user-A', vehicleId: 'vehicle-1' }),
          token = f.issue(changed);
        let gateTwo;
        const reached = new Promise((resolve) => (gateTwo = resolve));
        store.historyList = async (query) => {
          const rows = await originalList(query);
          if (++entered === n) gateTwo();
          await reached;
          return rows;
        };
        const moving = Array.from({ length: n }, () => list(token));
        await reached;
        changed.vehicleId = 'vehicle-3';
        for (const r of await Promise.all(moving)) assert.equal(r.status, 403);
      } finally {
        store.historyList = originalList;
      }
    });

    await t.test('authority and database outages never return records or fall back to an empty list', async () => {
      const a = f.issue(owners.a);
      for (const endpoint of ['verify', 'registration', 'active']) {
        f.state.modeFor = { [endpoint]: 'outage' };
        const r = await list(a);
        assert.equal(r.status, 403, endpoint);
        assert.equal(r.body.items, undefined);
      }
      f.reset();
      assert.equal((await list(a)).status, 200);
      const originalGet = store.historyGet.bind(store);
      try {
        store.historyGet = async (...args) => {
          const row = await originalGet(...args);
          f.state.mode = 'outage';
          return row;
        };
        assert.equal((await detail(a, aRecord.recordId)).status, 403, 'outage at the post-read check');
      } finally {
        store.historyGet = originalGet;
        f.reset();
      }
      const brokenPool = pool(),
        brokenStore = await PostgreSQLSessionStore.open({ pool: brokenPool }),
        offline = await serve(f, brokenStore);
      assert.equal((await list(a, offline)).status, 200);
      await brokenPool.end();
      const unavailable = await list(a, offline);
      assert.equal(unavailable.status, 500);
      assert.deepEqual(unavailable.body, { error: { code: 'INTERNAL' } });
      assert.equal((await list(a)).status, 200, 'another pool on the same database still reads');
    });

    await t.test('restart re-derives authority: live credential reads, revoked credential stays denied', async () => {
      const live = f.issue(owners.a),
        revoked = f.issue(owners.a);
      f.revokeCredential(revoked);
      const restarted = await serve(f, await PostgreSQLSessionStore.open({ pool: pool() }));
      assert.deepEqual(ids(await list(live, restarted)), [aRecord.recordId]);
      assert.equal((await list(revoked, restarted)).status, 403);
    });

    await t.test('Render edge path: adapter reads require exact edge headers, creation stays denied', async () => {
      const publicOrigin = 'https://history-auth-test.onrender.com',
        host = new URL(publicOrigin).host;
      // startRenderStateful owns and closes these pools on stop.
      const owned = () => {
        const p = new Pool({ connectionString: uri, max: 3, options: '-c search_path=' + schema });
        p.on('error', () => {});
        return p;
      };
      const render = await startRenderStateful({ pool: owned(), publicOrigin, historyAuthority: f.history }),
        deny = await startRenderStateful({ pool: owned(), publicOrigin });
      try {
      const request = (target, path, token, headers = {}, method = 'GET') =>
        new Promise((resolve, reject) => {
          const q = http.request(
            {
              host: '127.0.0.1',
              port: target.server.address().port,
              path,
              method,
              headers: { Host: host, 'X-Forwarded-Proto': 'https', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
            },
            (r) => {
              const chunks = [];
              r.on('data', (c) => chunks.push(c));
              r.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({ status: r.statusCode, body: text ? JSON.parse(text) : null });
              });
            },
          );
          q.on('error', reject);
          q.end();
        });
      const a = f.issue(owners.a),
        records = '/v1/inspection-records?limit=100';
      const ok = await request(render, records, a);
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body.items.map((x) => x.recordId), [aRecord.recordId]);
      assert.equal((await request(render, records, a, { 'X-Forwarded-Proto': 'http' })).status, 403);
      assert.equal((await request(render, records, a, { Host: 'evil.example' })).status, 403);
      assert.equal((await request(render, records, a, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await request(render, records, null)).status, 403);
      assert.equal((await request(render, records, aRecord.receiverToken)).status, 403);
      const create = await request(render, '/v1/sessions', f.issueCreate(owners.a), { 'Content-Type': 'application/json' }, 'POST');
      assert.equal(create.status, 403, 'history adapter does not enable session creation');
      const healthy = await request(render, '/healthz');
      assert.equal(healthy.body.sessionCreation, 'DENIED');
      assert.equal(healthy.body.historyRead, 'AUTHORITY_ADAPTER_CONFIGURED');
      // Without a reviewed bootstrap the same valid credential stays DENY_DEFAULT and health is unchanged.
      assert.equal((await request(deny, records, a)).status, 403);
      assert.deepEqual(Object.keys((await request(deny, '/healthz')).body), ['status', 'mode', 'sessionCreation']);
      f.state.mode = 'outage';
      assert.equal((await request(render, records, a)).status, 403);
      f.reset();
      } finally {
        await render.stop();
        await deny.stop();
      }
    });

    await t.test('logs and API errors never carry credentials or internal owner identifiers', async () => {
      const a = f.issue(owners.a);
      await list(a);
      await list('x'.repeat(43));
      const text = logs.join('\n');
      for (const secret of [a, 'user-A', 'vehicle-1', owners.a.registrationId, owners.a.deviceId])
        assert.equal(text.includes(secret), false);
      const dto = (await detail(a, aRecord.recordId)).body.record;
      for (const field of ['userId', 'vehicleId', 'deviceId', 'registrationId', 'authorityIssuer'])
        assert.equal(Object.hasOwn(dto, field), false, field);
      assert.equal(JSON.stringify(dto).includes(a), false);
    });
  },
);
