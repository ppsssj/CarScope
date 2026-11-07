// P12-E: the option on the Render path with PostgreSQL's rate windows. A fake provider and simulator credentials. No Render, no Roboflow. Real entrypoints do not pass the option.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { AvdSimulatorCredentialStore, AVD_AUDIENCE } from '../src/avd-simulator-credentials.mjs';
import { assertIsolatedTestDatabase } from '../preflight/database.mjs';
import { DETECTION_CONSENT } from '../../mobile-ar-poc/public/part-detection.mjs';

const uri = process.env.PG_TEST_URL, ORIGIN = 'https://part-detection-test.onrender.com';
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 1, 0xe0, 2, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]);
const call = (port, path, { method = 'GET', bearer, json, raw, headers = {} } = {}) => new Promise((resolve, reject) => {
  const body = raw ?? (json ? JSON.stringify(json) : undefined);
  const q = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: new URL(ORIGIN).host, 'X-Forwarded-Proto': 'https', ...(json ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers } }, r => {
    const chunks = []; r.on('data', c => chunks.push(c));
    r.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let data = null; try { data = JSON.parse(text); } catch { /* a page */ } resolve({ status: r.statusCode, data, text, headers: r.headers }); });
  });
  q.on('error', reject); q.end(body);
});

test('on the Render path: off without a provider; with one, the same credentials, rate windows and no schema change', { skip: !uri && 'PG_TEST_URL absent: NOT_RUN', timeout: 120_000 }, async (t) => {
  assertIsolatedTestDatabase(uri);
  const { default: { Pool } } = await import('pg');
  const schema = 'cs_p12e_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: uri, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: uri, max: 3, options: '-c search_path=' + schema });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const start = options => startRenderStateful({ pool, publicOrigin: ORIGIN, enableAvdSimulation: true, ...options });

  const off = await start();
  const tables = async () => (await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY 1', [schema])).rows.map(r => r.table_name);
  const before = await tables();
  const offPort = off.server.address().port;
  assert.equal((await call(offPort, '/v1/part-detections/fuse-box', { method: 'POST', raw: jpeg() })).status, 404);
  assert.ok(!(await call(offPort, '/')).text.includes('data-part-detection'));
  assert.equal((await call(offPort, '/mobile-ar-poc/public/part-detection-ui.mjs')).status, 404);
  await new Promise((resolve, reject) => off.server.close(e => (e ? reject(e) : resolve())));

  const calls = [];
  const provider = { detect: async ({ image }) => { calls.push(image.length); return { imageWidth: 640, imageHeight: 480, predictions: [{ className: 'Fuse Box', score: 0.8, x: 100, y: 100, width: 40, height: 40 }, { className: '4', score: 0.9, x: 200, y: 100, width: 40, height: 40 }] }; } };
  const on = await start({ partDetection: { provider } });
  t.after(() => new Promise(resolve => on.server.close(resolve)));
  const port = on.server.address().port;
  assert.match((await call(port, '/')).text, /data-part-detection="enabled"/);

  const registry = new AvdSimulatorCredentialStore({ pool });
  const who = await registry.register({ label: 'p12-e', ttlMs: 3_600_000 });
  const grant = (await call(port, '/simulator/provision', { method: 'POST', bearer: who.enrollmentProof, json: { apiOrigin: ORIGIN, audience: AVD_AUDIENCE } })).data.credential;
  const created = await call(port, '/v1/sessions', { method: 'POST', bearer: grant, json: { taskId: 'fuse-box' } });
  assert.equal(created.status, 201);
  const claim = await call(port, '/v1/claim', { method: 'POST', bearer: created.data.inviteToken });
  const detect = (bearer, extra = {}) => call(port, '/v1/part-detections/fuse-box', { method: 'POST', bearer, raw: jpeg(), headers: { 'Content-Type': 'image/jpeg', 'X-CarScope-External-Processing': DETECTION_CONSENT, ...extra } });

  assert.equal((await detect(undefined)).status, 401);
  for (const other of [created.data.receiverToken, grant]) {
    const refused = (await call(port, '/v1/submissions/status', { bearer: other })).status;
    assert.ok(refused >= 400);
    assert.equal((await detect(other)).status, refused, 'other credentials fail as on the phone\'s other requests');
  }
  assert.equal(calls.length, 0);
  const ok = await detect(claim.data.submitToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.candidates.length, 1, 'only this part\'s class');
  assert.equal(calls.length, 1);
  assert.deepEqual(await tables(), before, 'no table was added');
  // The limit holds through PostgreSQL's windows: 10 a minute per client, and the eleventh never reaches the provider.
  for (let i = 1; i < 10; i++) assert.equal((await detect(claim.data.submitToken)).status, 200, String(i));
  assert.equal(calls.length, 10);
  assert.equal((await detect(claim.data.submitToken)).status, 429);
  assert.equal(calls.length, 10);
  assert.ok(Number((await pool.query('SELECT count(*) n FROM cs_rate_windows')).rows[0].n) > 0);
});
