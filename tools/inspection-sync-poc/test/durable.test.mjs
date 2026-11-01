import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SQLiteSessionStore, SQLiteRateLimiter } from '../src/sqlite-store.mjs';
import { SessionService } from '../src/sessions.mjs';
import { startSyncServer } from '../src/server.mjs';
import { LocalTestSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
import { PROTOCOL, PROTOCOL_VERSION } from '../src/protocol.mjs';
import { startInspection, completeInspection } from '../../mobile-ar-poc/public/inspection-result.mjs';

const fixture = (t) => {
  const filename = path.join(mkdtempSync(path.join(tmpdir(), 'carscope-durable-')), 'sync.sqlite');
  const stores = [];
  const open = () => { const s = new SQLiteSessionStore({ filename }); stores.push(s); return s; };
  t.after(() => { for (const s of stores) { try { s.close(); } catch {} } });
  return { filename, open };
};
const envelope = (status = 'OK') => ({ protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, result: completeInspection(startInspection(), status) });
async function submitted(svc) {
  const p = await svc.create({ taskId: 'washer-fluid' });
  const c = await svc.claim(p.inviteToken), body = envelope();
  const r = await svc.submit(c.submitToken, body);
  return { ...p, submitToken: c.submitToken, body, digest: r.receipt.resultDigest };
}
// Real child processes, each with an independent connection, released after all report ready.
async function parallel(filename, jobs) {
  const children = jobs.map(() => fork(fileURLToPath(new URL('./process-worker.mjs', import.meta.url)), [filename], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  try {
    await Promise.all(children.map((c) => new Promise((resolve, reject) => { c.once('message', resolve); c.once('error', reject); c.once('exit', (code) => { if (code) reject(new Error(`worker initialization ${code}`)); }); })));
    return await Promise.all(children.map((c, i) => new Promise((resolve, reject) => {
      let output;
      c.once('message', (m) => { output = m; });
      c.once('error', reject);
      c.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`worker exit ${code}`)));
      c.send(jobs[i]);
    })));
  } finally { for (const c of children) if (c.exitCode === null) c.kill(); }
}

test('SQLite: external path required; atomic rollback, copied reads, conditional delete, global token uniqueness', async (t) => {
  assert.throws(() => new SQLiteSessionStore({ filename: path.resolve('forbidden.sqlite') }), /outside/);
  const f = fixture(t), store = f.open(), svc = new SessionService({ store });
  const p = await svc.create({ taskId: 'washer-fluid' }), raw = await store.get(p.sessionId);
  await assert.rejects(store.insert({ ...raw, id: 'other' }));
  assert.equal(await store.count(), 1);
  const second = await svc.create({ taskId: 'washer-fluid' });
  await assert.rejects(store.update(raw.id, (x) => ({ ...x, receiverHash: raw.inviteHash })));
  assert.deepEqual(await store.get(raw.id), raw, 'unique-index failure rolls the row and token indexes back together');
  await store.delete(second.sessionId);
  await assert.rejects(store.update(raw.id, (x) => { x.inviteHash = 'changed'; throw new Error('abort'); }), /abort/);
  assert.deepEqual(await store.get(raw.id), raw);
  raw.state = 'CORRUPTED';
  assert.equal((await store.get(raw.id)).state, 'CREATED');
  assert.equal(await store.delete(raw.id, () => false), false);
  assert.equal(await store.delete(raw.id, () => true), true);
  assert.equal(await store.idByTokenHash('receiver', raw.receiverHash), null);
});

test('SQLite: HTTP server restart restores result, duplicate/conflict, acceptance, retention and tombstone cleanup', async (t) => {
  const f = fixture(t); let now = 100000;
  const opts = { port: 0, now: () => now, limits: { acceptedRetentionMs: 10, tombstoneMs: 20 }, log: () => {}, authorizer: new LocalTestSessionCreationAuthorizer() };
  let store = f.open(), server = await startSyncServer({ ...opts, store, limiter: new SQLiteRateLimiter({ store }) });
  t.after(async () => { if (server) await server.stop(); });
  const c = await fetch(server.url + '/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'washer-fluid' }) });
  const p = await c.json(), claim = await server.service.claim(p.inviteToken), body = envelope();
  const first = await server.service.submit(claim.submitToken, body);
  await server.stop(); server = null; store.close();
  store = f.open(); server = await startSyncServer({ ...opts, store });
  await assert.rejects(server.service.claim(p.inviteToken), { code: 'ALREADY_CLAIMED' });
  assert.deepEqual((await server.service.view(p.sessionId, p.receiverToken)).result, body.result);
  assert.equal((await server.service.submit(claim.submitToken, body)).duplicate, true);
  await assert.rejects(server.service.submit(claim.submitToken, envelope('UNSURE')), { code: 'CONFLICT' });
  await server.service.accept(p.sessionId, p.receiverToken, first.receipt.resultDigest);
  await server.stop(); server = null; store.close(); now += 11;
  store = f.open(); server = await startSyncServer({ ...opts, store });
  const restored = await server.service.view(p.sessionId, p.receiverToken);
  assert.equal(restored.sessionState, 'ACCEPTED'); assert.equal(restored.result, null);
  now += 10; await server.service.sweep(); assert.equal(await store.count(), 0);
});

test('SQLite: restart expires overdue results and preserves cancelled terminal state without result', async (t) => {
  const f = fixture(t); let now = 1000, store = f.open();
  const svc = new SessionService({ store, now: () => now, limits: { sessionTtlMs: 50 } });
  const expired = await submitted(svc), cancelled = await submitted(svc);
  await svc.cancel(cancelled.sessionId, cancelled.receiverToken); store.close(); now += 51;
  store = f.open(); const s = await startSyncServer({ port: 0, store, now: () => now, log: () => {} });
  t.after(() => s.stop());
  assert.equal((await store.get(expired.sessionId)).state, 'EXPIRED');
  assert.equal((await store.get(expired.sessionId)).result, null);
  assert.equal((await store.get(cancelled.sessionId)).state, 'CANCELLED');
  assert.equal((await store.get(cancelled.sessionId)).result, null);
});

test('SQLite: four processes serialize 200 updates without lost writes; capacity stays at 3', async (t) => {
  const f = fixture(t), store = f.open(), svc = new SessionService({ store });
  const p = await svc.create({ taskId: 'washer-fluid' });
  const out = await parallel(f.filename, Array.from({ length: 4 }, () => ({ op: 'increment', id: p.sessionId, n: 50 })));
  assert.ok(out.every((m) => m.out === true)); assert.equal((await store.get(p.sessionId)).counter, 200);
  await store.delete(p.sessionId);
  const created = await parallel(f.filename, Array.from({ length: 4 }, () => ({ op: 'create', n: 10, limits: { maxSessions: 3 } })));
  assert.equal(created.flatMap((m) => m.out).filter((s) => s === 'OK').length, 3);
  assert.equal(await store.count(), 3);
});

test('SQLite: process race claim, conflicting submit, accept vs overdue sweep never replaces terminal state', async (t) => {
  const f = fixture(t), store = f.open(), now = 10000, svc = new SessionService({ store, now: () => now });
  const p = await svc.create({ taskId: 'washer-fluid' });
  const claimed = await parallel(f.filename, [0, 1].map(() => ({ op: 'claim', token: p.inviteToken, now })));
  assert.equal(claimed.filter((m) => m.out).length, 1); assert.equal(claimed.find((m) => m.error).error, 'ALREADY_CLAIMED');
  const token = claimed.find((m) => m.out).out.submitToken;
  const writes = await parallel(f.filename, ['OK', 'UNSURE'].map((s) => ({ op: 'submit', token, envelope: envelope(s), now })));
  assert.equal(writes.filter((m) => m.out).length, 1); assert.equal(writes.find((m) => m.error).error, 'CONFLICT');
  const digest = (await store.get(p.sessionId)).resultDigest;
  const race = await parallel(f.filename, [{ op: 'accept', id: p.sessionId, token: p.receiverToken, digest, now: p.expiresAt - 1 }, { op: 'sweep', now: p.expiresAt + 1 }]);
  const final = await store.get(p.sessionId);
  assert.equal(final.state, race[0].out ? 'ACCEPTED' : 'EXPIRED');
  if (final.state === 'EXPIRED') assert.equal(final.result, null);
});

test('SQLite: shared rate budget across four processes, restart, expiry and bounded key capacity', async (t) => {
  const f = fixture(t), store = f.open();
  const out = await parallel(f.filename, Array.from({ length: 4 }, () => ({ op: 'rate', n: 10, now: 1000 })));
  assert.equal(out.flatMap((m) => m.out).filter(Boolean).length, 7);
  const other = f.open(), opts = { now: () => 1000, rates: { create: { limit: 7, windowMs: 1000 } }, maxKeys: 1 };
  assert.equal(other.rateCheck('shared-client', 'create', opts).ok, false);
  assert.equal(other.rateCheck('new-client', 'create', opts).ok, false);
  assert.equal(other.rateCheck('new-client', 'create', { ...opts, now: () => 2000 }).ok, true);
});

test('SQLite: process death before commit rolls back data and releases the write lock', async (t) => {
  const f = fixture(t), store = f.open(), svc = new SessionService({ store });
  const p = await svc.create({ taskId: 'washer-fluid' });
  await assert.rejects(parallel(f.filename, [{ op: 'crash', id: p.sessionId }]), /worker exit 17/);
  assert.equal((await store.get(p.sessionId)).counter, undefined);
  await store.update(p.sessionId, (x) => ({ ...x, counter: 1 }));
  assert.equal((await f.open().get(p.sessionId)).counter, 1);
});

test('SQLite: a separately spawned API process survives a full process stop/start with the same receiver token', async (t) => {
  const f = fixture(t), store = f.open(), svc = new SessionService({ store });
  const p = await submitted(svc);
  const start = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], {
      env: { ...process.env, SYNC_DB_PATH: f.filename, SYNC_PORT: '0', SYNC_HOST: '127.0.0.1', SYNC_LOCAL_TEST_AUTH: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /PoC on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) resolve({ child, url: match[1] });
    });
    child.once('error', reject);
    child.once('exit', (code) => { if (!output.includes('PoC on')) reject(new Error(`API initialization ${code}`)); });
  });
  const stop = (child) => new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  for (let i = 0; i < 2; i++) {
    const api = await start();
    try {
      const view = await fetch(`${api.url}/v1/sessions/${p.sessionId}`, { headers: { Authorization: `Bearer ${p.receiverToken}` } });
      assert.equal(view.status, 200); assert.deepEqual((await view.json()).result, p.body.result);
      const create = await fetch(`${api.url}/v1/sessions`, { method: 'POST' }); assert.equal(create.status, 403);
    } finally { await stop(api.child); }
  }
});
