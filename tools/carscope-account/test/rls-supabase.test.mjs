// P15 RLS and privilege checks through the real Supabase Data API of a LOCAL stack (`supabase start` in this package):
// GoTrue issues the JWTs, PostgREST applies them, PostgreSQL enforces RLS from the migration. Two users are signed up
// with email/password on the local stack (Google is not involved). Loopback only; a hosted URL is refused.
// Without CARSCOPE_LOCAL_SUPABASE_URL every test is skipped and reported NOT_RUN, never PASS.
//
//   CARSCOPE_LOCAL_SUPABASE_URL=http://127.0.0.1:54321
//   CARSCOPE_LOCAL_SUPABASE_PUBLISHABLE_KEY=<publishable key printed by `supabase status`>
//   CARSCOPE_LOCAL_SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres   (catalog checks, read only)
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseIdentityVerifier } from '../src/supabase-identity.mjs';
import { createVehicleRepository, ERRORS, SCHEMA, VEHICLE_COLUMNS } from '../web/lib/vehicle-repository.mjs';

const URL_ = process.env.CARSCOPE_LOCAL_SUPABASE_URL;
const KEY = process.env.CARSCOPE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const DB = process.env.CARSCOPE_LOCAL_SUPABASE_DB_URL;
const loopback = (u) => { try { return ['127.0.0.1', 'localhost'].includes(new URL(u).hostname); } catch { return false; } };
const skip = !URL_ || !KEY ? 'CARSCOPE_LOCAL_SUPABASE_URL / _PUBLISHABLE_KEY absent: NOT_RUN' : false;
if (skip && process.env.CARSCOPE_RLS_REQUIRED === '1') throw new Error('CARSCOPE_RLS_REQUIRED=1 but no local Supabase stack was configured');
if (URL_ && !loopback(URL_)) throw new Error('Refusing a non-loopback Supabase URL: this test only runs against a local stack');
if (DB && !loopback(DB)) throw new Error('Refusing a non-loopback database URL');

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = () => createClient(URL_, KEY, opts);

async function user(label) {
  const client = anon();
  const email = `p15-${label}-${randomBytes(4).toString('hex')}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: randomBytes(18).toString('base64url') });
  assert.equal(error, null, `signUp ${label}: ${error?.message}`);
  assert.ok(data.session, 'local stack auto-confirms email');
  const session = { epoch: 0 };
  return { client, id: data.user.id, token: data.session.access_token, repo: createVehicleRepository({ client, session }), db: () => client.schema(SCHEMA) };
}

const car = (over = {}) => ({ manufacturer: '현대', model: 'IONIQ 5', model_year: 2024, nickname: null, ...over });

test('anonymous (publishable key only) cannot read or write any account table', { skip }, async () => {
  const db = anon().schema(SCHEMA);
  for (const table of ['vehicles', 'profiles', 'vehicle_inspection_links']) {
    const r = await db.from(table).select('*');
    assert.equal(r.error?.code, '42501', `${table} select: ${JSON.stringify(r.error)}`);
  }
  const ins = await db.from('vehicles').insert(car());
  assert.equal(ins.error?.code, '42501');
});

test('A creates and lists own vehicle; it is SELF_REPORTED_UNVERIFIED and owned by A', { skip }, async () => {
  const a = await user('a');
  const created = await a.repo.create(car({ nickname: '출퇴근' }));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.vehicle.verification, 'SELF_REPORTED_UNVERIFIED');
  const raw = await a.db().from('vehicles').select('owner_id,verification_status,verified_at').eq('id', created.vehicle.id).single();
  assert.equal(raw.data.owner_id, a.id);
  assert.equal(raw.data.verification_status, 'SELF_REPORTED_UNVERIFIED');
  assert.equal(raw.data.verified_at, null);
  const listed = await a.repo.list();
  assert.deepEqual(listed.vehicles.map((v) => v.id), [created.vehicle.id]);
});

test('B cannot see, update or delete A vehicles; A data is unchanged afterwards', { skip }, async () => {
  const a = await user('a'); const b = await user('b');
  const { vehicle } = await a.repo.create(car());
  assert.deepEqual((await b.repo.list()).vehicles, []);
  const byId = await b.db().from('vehicles').select(VEHICLE_COLUMNS).eq('id', vehicle.id);
  assert.deepEqual(byId.data, []);
  assert.equal((await b.repo.update(vehicle.id, car({ model: 'hijacked' }))).error, ERRORS.NOT_FOUND);
  assert.equal((await b.repo.remove(vehicle.id)).error, ERRORS.NOT_FOUND);
  // Raw API calls, bypassing the repository's own validation.
  const rawUpdate = await b.db().from('vehicles').update({ model: 'hijacked' }).eq('id', vehicle.id).select('id');
  assert.deepEqual(rawUpdate.data, []);
  const rawDelete = await b.db().from('vehicles').delete().eq('id', vehicle.id).select('id');
  assert.deepEqual(rawDelete.data, []);
  const still = await a.repo.list();
  assert.equal(still.vehicles[0].model, 'IONIQ 5');
});

test('owner_id cannot be supplied on insert or changed on update, by anyone through the API', { skip }, async () => {
  const a = await user('a'); const b = await user('b');
  const forged = await b.db().from('vehicles').insert({ ...car(), owner_id: a.id });
  assert.equal(forged.error?.code, '42501', 'no INSERT privilege on owner_id');
  const own = await b.db().from('vehicles').insert({ ...car(), owner_id: b.id });
  assert.equal(own.error?.code, '42501', 'even the caller\'s own id is not writable');
  const { vehicle } = await a.repo.create(car());
  const move = await a.db().from('vehicles').update({ owner_id: b.id }).eq('id', vehicle.id);
  assert.equal(move.error?.code, '42501', 'no UPDATE privilege on owner_id');
  const ids = (await a.repo.list()).vehicles.map((v) => v.id);
  assert.ok(ids.includes(vehicle.id));
});

test('verification fields cannot be set or promoted by the owner', { skip }, async () => {
  const a = await user('a');
  const insert = await a.db().from('vehicles').insert({ ...car(), verification_status: 'OEM_VERIFIED', verified_at: new Date().toISOString(), verification_provider: 'HYUNDAI_DEVELOPERS' });
  assert.equal(insert.error?.code, '42501');
  const { vehicle } = await a.repo.create(car());
  for (const patch of [{ verification_status: 'OEM_VERIFIED' }, { verified_at: new Date().toISOString() }, { verification_provider: 'HYUNDAI_DEVELOPERS' }]) {
    const r = await a.db().from('vehicles').update(patch).eq('id', vehicle.id);
    assert.equal(r.error?.code, '42501', JSON.stringify(patch));
  }
  const after = await a.db().from('vehicles').select('verification_status').eq('id', vehicle.id).single();
  assert.equal(after.data.verification_status, 'SELF_REPORTED_UNVERIFIED');
  // The repository refuses the field before any request.
  assert.equal((await a.repo.update(vehicle.id, { ...car(), verification_status: 'OEM_VERIFIED' })).error, ERRORS.INVALID_INPUT);
});

test('a deleted vehicle cannot be read back, updated or deleted again', { skip }, async () => {
  const a = await user('a');
  const { vehicle } = await a.repo.create(car());
  assert.equal((await a.repo.remove(vehicle.id)).ok, true);
  assert.deepEqual((await a.repo.list()).vehicles, []);
  assert.equal((await a.repo.update(vehicle.id, car())).error, ERRORS.NOT_FOUND);
  assert.equal((await a.repo.remove(vehicle.id)).error, ERRORS.NOT_FOUND);
});

test('database checks reject out-of-contract values even when sent raw', { skip }, async () => {
  const a = await user('a');
  for (const bad of [{ ...car(), model_year: 1800 }, { ...car(), manufacturer: '' }, { ...car(), manufacturer: ' 현대' }, { ...car(), model: 'x'.repeat(61) }]) {
    const r = await a.db().from('vehicles').insert(bad);
    assert.equal(r.error?.code, '23514', JSON.stringify(bad));
  }
});

test('per-user limit: the 21st vehicle is refused for that user only', { skip }, async () => {
  const a = await user('a'); const b = await user('b');
  const rows = Array.from({ length: 20 }, (_, i) => car({ nickname: `차 ${i + 1}` }));
  const bulk = await a.db().from('vehicles').insert(rows);
  assert.equal(bulk.error, null, JSON.stringify(bulk.error));
  assert.equal((await a.repo.create(car())).error, ERRORS.LIMIT_REACHED);
  assert.equal((await b.repo.create(car())).ok, true);
});

test('profiles: own row only; id is fixed to the caller; another user\'s profile is invisible', { skip }, async () => {
  const a = await user('a'); const b = await user('b');
  assert.equal((await a.db().from('profiles').insert({ id: a.id, display_name: 'A' })).error, null);
  const forged = await b.db().from('profiles').insert({ id: a.id, display_name: 'not A' });
  assert.equal(forged.error?.code, '42501', 'RLS WITH CHECK refuses another id');
  assert.deepEqual((await b.db().from('profiles').select('*').eq('id', a.id)).data, []);
  const rename = await b.db().from('profiles').update({ display_name: 'x' }).eq('id', a.id).select('id');
  assert.deepEqual(rename.data, []);
  const moveId = await a.db().from('profiles').update({ id: b.id }).eq('id', a.id);
  assert.equal(moveId.error?.code, '42501', 'no UPDATE privilege on id');
  assert.equal((await a.db().from('profiles').delete().eq('id', a.id)).error?.code, '42501', 'no DELETE privilege');
});

test('inspection links: readable only, never writable through the API (no AVD / UNVERIFIED promotion path)', { skip }, async () => {
  const a = await user('a');
  const { vehicle } = await a.repo.create(car());
  for (const ns of ['VERIFIED_VEHICLE', 'AVD_SIMULATOR', 'UNVERIFIED']) {
    const r = await a.db().from('vehicle_inspection_links').insert({ vehicle_id: vehicle.id, owner_id: a.id, record_namespace: ns, record_id: randomUUID(), evidence: 'OWNER_VERIFIED_RECORD' });
    assert.equal(r.error?.code, '42501', ns);
  }
  assert.deepEqual((await a.db().from('vehicle_inspection_links').select('*')).data, []);
});

test('user_metadata cannot claim another identity: RLS follows the signed sub only', { skip }, async () => {
  const a = await user('a'); const b = await user('b');
  await b.repo.create(car({ nickname: 'B 차' }));
  const upd = await a.client.auth.updateUser({ data: { sub: b.id, owner_id: b.id, role: 'service_role' } });
  assert.equal(upd.error, null);
  await a.client.auth.refreshSession();
  assert.deepEqual((await a.repo.list()).vehicles, []);
  const created = await a.repo.create(car());
  const raw = await a.db().from('vehicles').select('owner_id').eq('id', created.vehicle.id).single();
  assert.equal(raw.data.owner_id, a.id);
});

test('a tampered or foreign JWT is refused by the Data API; the server verifier accepts the real one', { skip }, async () => {
  const a = await user('a');
  const [h, p, s] = a.token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  const tampered = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: randomUUID() })).toString('base64url')}.${s}`;
  const res = await fetch(`${URL_}/rest/v1/vehicles?select=id`, { headers: { apikey: KEY, authorization: `Bearer ${tampered}`, 'accept-profile': SCHEMA } });
  assert.equal(res.status, 401);
  const verifier = createSupabaseIdentityVerifier({ supabaseUrl: URL_ });
  const ok = await verifier.verify(a.token);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.identity.userId, a.id);
  assert.equal((await verifier.verify(tampered)).reason, 'BAD_SIGNATURE');
});

test('after sign-out the old access token reads nothing it should not (session revoked server side)', { skip }, async () => {
  const a = await user('a');
  await a.repo.create(car());
  const token = a.token;
  await a.client.auth.signOut({ scope: 'local' });
  const after = await anon().schema(SCHEMA).from('vehicles').select('id');
  assert.equal(after.error?.code, '42501', 'signed-out client is anon');
  // The JWT itself stays valid until exp (documented JWT behaviour); /user confirms the session is gone.
  const me = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, authorization: `Bearer ${token}` } });
  assert.ok(me.status === 401 || me.status === 403, `user endpoint after logout: ${me.status}`);
});

test('catalog: RLS on every table, no grants to anon / service_role / PUBLIC, no SECURITY DEFINER, schemas untouched', { skip: skip || (!DB && 'CARSCOPE_LOCAL_SUPABASE_DB_URL absent: NOT_RUN') }, async () => {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    await c.query('begin read only');
    const rls = await c.query(`select relname, relrowsecurity from pg_class where relnamespace = 'carscope_account'::regnamespace and relkind in ('r','p','v','m')`);
    assert.deepEqual(rls.rows.map((r) => r.relname).sort(), ['profiles', 'vehicle_inspection_links', 'vehicles']);
    assert.ok(rls.rows.every((r) => r.relrowsecurity));
    const grants = await c.query(`select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'carscope_account' and grantee in ('anon','service_role','PUBLIC')`);
    assert.deepEqual(grants.rows, []);
    const cols = await c.query(`select distinct grantee from information_schema.column_privileges where table_schema = 'carscope_account' and grantee in ('anon','service_role','PUBLIC')`);
    assert.deepEqual(cols.rows, []);
    const authTable = await c.query(`select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_schema = 'carscope_account' and grantee = 'authenticated' group by 1 order by 1`);
    assert.deepEqual(authTable.rows, [{ table_name: 'profiles', p: 'SELECT' }, { table_name: 'vehicle_inspection_links', p: 'SELECT' }, { table_name: 'vehicles', p: 'DELETE,SELECT' }]);
    const definer = await c.query(`select proname from pg_proc where pronamespace = 'carscope_account'::regnamespace and prosecdef`);
    assert.deepEqual(definer.rows, []);
    const exec = await c.query(`select p.proname, r.rolname from pg_proc p cross join pg_roles r where p.pronamespace = 'carscope_account'::regnamespace and r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid, p.oid, 'execute')`);
    assert.deepEqual(exec.rows, [], 'API roles cannot call the trigger functions');
    const usage = await c.query(`select r.rolname from pg_roles r where r.rolname in ('anon','authenticated','service_role') and has_schema_privilege(r.oid, 'carscope_account', 'usage') order by 1`);
    assert.deepEqual(usage.rows.map((r) => r.rolname), ['authenticated']);
    // Pin every policy exactly: the SELECT policy also filters UPDATE/DELETE, so a loosened UPDATE or DELETE policy
    // would not show up in the behaviour tests above (mutation check found this). Exactly these, and no others.
    const policies = await c.query(`select tablename, policyname, cmd, permissive, roles::text, qual, with_check from pg_policies where schemaname = 'carscope_account' order by 1, 2`);
    const own = (col) => `(( SELECT auth.uid() AS uid) = ${col})`;
    const P = (tablename, policyname, cmd, qual, check) => ({ tablename, policyname, cmd, permissive: 'PERMISSIVE', roles: '{authenticated}', qual, with_check: check });
    assert.deepEqual(policies.rows, [
      P('profiles', 'profiles_insert_own', 'INSERT', null, own('id')),
      P('profiles', 'profiles_select_own', 'SELECT', own('id'), null),
      P('profiles', 'profiles_update_own', 'UPDATE', own('id'), own('id')),
      P('vehicle_inspection_links', 'vehicle_inspection_links_select_own', 'SELECT', own('owner_id'), null),
      P('vehicles', 'vehicles_delete_own', 'DELETE', own('owner_id'), null),
      P('vehicles', 'vehicles_insert_own', 'INSERT', null, own('owner_id')),
      P('vehicles', 'vehicles_select_own', 'SELECT', own('owner_id'), null),
      P('vehicles', 'vehicles_update_own', 'UPDATE', own('owner_id'), own('owner_id')),
    ]);
    const others = await c.query(`select nspname from pg_namespace where nspname in ('carscope','carscope_private')`);
    assert.deepEqual(others.rows, [], 'the migration created neither carscope nor carscope_private');
    await c.query('rollback');
  } finally { await c.end(); }
});
