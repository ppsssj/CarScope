// No database: the rules that decide whether a connection may even be attempted, and the operator SQL as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPrivateSchemaName, databasePoolOptions, decodeCaCertificate } from '../src/database-config.mjs';
import { parseArguments } from '../bin/db-recovery.mjs';
import { parseArguments as parsePreflight } from '../bin/deployment-preflight.mjs';
import { runCompare, runRelocate, scopeManifest } from '../preflight/recovery.mjs';
import { environmentNamesGate } from '../preflight/render-gates.mjs';
import { environmentGate } from '../preflight/static-gates.mjs';

const CA = Buffer.from('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n').toString('base64');
const SECRET = 'supabase-sentinel-' + process.pid;
const ENTRY = fileURLToPath(new URL('../src/render-stateful.mjs', import.meta.url));
const pooler = (user = 'carscope_app.abcdefgh') => `postgresql://${user}:${SECRET}@aws-0-region.pooler.supabase.com:5432/postgres`;

test('plaintext is allowed only for loopback and single-label private hosts', () => {
  assert.equal(databasePoolOptions({ url: `postgresql://u:${SECRET}@dpg-abc123-a/carscope` }).ssl, undefined, 'Render Internal URL form');
  assert.equal(databasePoolOptions({ url: `postgresql://u:${SECRET}@127.0.0.1:5432/x` }).ssl, undefined);
  assert.equal(databasePoolOptions({ url: `postgresql://u:${SECRET}@localhost/x` }).ssl, undefined);
  for (const host of ['dpg-abc.oregon-postgres.render.com', 'db.example.com', '10.0.0.5'])
    assert.throws(() => databasePoolOptions({ url: `postgresql://u:${SECRET}@${host}/x` }), /^Error: DATABASE_TLS_CA_REQUIRED$/, host);
});

test('a pinned CA turns on full verification and is the only way to change TLS', () => {
  const options = databasePoolOptions({ url: `postgresql://u:${SECRET}@db.example.com/x`, caPemBase64: CA });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.match(options.ssl.ca, /BEGIN CERTIFICATE/);
  for (const suffix of ['?sslmode=disable', '?sslmode=no-verify', '?sslmode=require', '?host=db.invalid', '#x'])
    assert.throws(() => databasePoolOptions({ url: `postgresql://u:${SECRET}@db.example.com/x${suffix}`, caPemBase64: CA }), /^Error: INVALID_DATABASE_URL$/, suffix);
});

test('a CA value is refused when it is not a certificate, including a pasted private key', () => {
  for (const value of ['', 'not base64 !!', Buffer.from('hello').toString('base64'), Buffer.from('-----BEGIN PRIVATE KEY-----\n-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----').toString('base64'), 7])
    assert.throws(() => decodeCaCertificate(value), /^Error: DATABASE_CA_INVALID$/);
});

test('a Supabase host needs a private schema; platform schemas never qualify', () => {
  assert.throws(() => databasePoolOptions({ url: pooler(), caPemBase64: CA }), /^Error: DATABASE_SCHEMA_REQUIRED$/);
  assert.throws(() => databasePoolOptions({ url: `postgresql://postgres:${SECRET}@db.abc.supabase.co:5432/postgres`, caPemBase64: CA }), /DATABASE_SCHEMA_REQUIRED/);
  assert.throws(() => databasePoolOptions({ url: pooler(), schema: 'carscope' }), /^Error: DATABASE_TLS_CA_REQUIRED$/);
  const options = databasePoolOptions({ url: pooler(), caPemBase64: CA, schema: 'carscope' });
  assert.equal(options.expectedSchema, 'carscope');
  assert.equal(new URL(options.connectionString).username, 'carscope_app.abcdefgh', 'the pooler username format is kept');
  for (const schema of ['public', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pg_catalog', 'information_schema', 'supabase_functions', 'Carscope', 'a b', 'a;drop', '', 'x'.repeat(64)])
    assert.throws(() => assertPrivateSchemaName(schema), /^Error: DATABASE_SCHEMA_NOT_PRIVATE$/, schema);
});

test('the real CLI refuses unsafe database settings before connecting, with one sanitized line', () => {
  const platform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const valid = { ...platform, RENDER: 'true', RENDER_EXTERNAL_URL: 'https://preflight.example', PORT: '1' };
  for (const env of [
    { DATABASE_URL: pooler() }, { DATABASE_URL: pooler(), CARSCOPE_DB_SCHEMA: 'carscope' }, { DATABASE_URL: pooler(), CARSCOPE_DB_CA_PEM_BASE64: CA },
    { DATABASE_URL: pooler(), CARSCOPE_DB_CA_PEM_BASE64: CA, CARSCOPE_DB_SCHEMA: 'public' }, { DATABASE_URL: pooler() + '?sslmode=require', CARSCOPE_DB_SCHEMA: 'carscope', CARSCOPE_DB_CA_PEM_BASE64: CA },
    { DATABASE_URL: pooler(), CARSCOPE_DB_SCHEMA: 'carscope', CARSCOPE_DB_CA_PEM_BASE64: Buffer.from('nope').toString('base64') },
  ]) {
    const r = spawnSync(process.execPath, [ENTRY], { env: { ...valid, ...env }, encoding: 'utf8', timeout: 20_000, windowsHide: true });
    assert.equal(r.status, 1);
    assert.equal(r.stdout + r.stderr.trim(), 'RENDER_STATEFUL_CONFIGURATION_FAILED');
    assert.equal((r.stdout + r.stderr).includes(SECRET), false);
  }
});

test('environment gates: new variables are read by name, and cannot open authorization', () => {
  assert.equal(environmentGate().status, 'PASS');
  const source = readFileSync(new URL('../src/database-config.mjs', import.meta.url), 'utf8');
  const code = source.replaceAll('rejectUnauthorized', '');
  assert.equal(/process\.env|history|authori[sz]/i.test(code), false, 'this module reads no environment and decides no authorization');
  const names = (...x) => ['DATABASE_URL', 'NODE_VERSION', ...x].join('\n');
  assert.equal(environmentNamesGate(names()).status, 'PASS');
  assert.equal(environmentNamesGate(names('CARSCOPE_DB_SCHEMA', 'CARSCOPE_DB_CA_PEM_BASE64')).status, 'PASS');
  assert.equal(environmentNamesGate(names('CARSCOPE_DB_SCHEMA')).status, 'FAIL');
  assert.equal(environmentNamesGate(names('CARSCOPE_DB_CA_PEM_BASE64')).status, 'FAIL');
});

test('relocate is rehearsal-only with no widening flag; compare needs a dated approval for a remote server', async () => {
  const remote = `postgresql://u:${SECRET}@aws-0-region.pooler.supabase.com:5432/postgres`, now = () => Date.UTC(2026, 10, 6, 12);
  assert.equal((await runRelocate({ url: remote, schema: 'carscope', env: {} })).checks[0].detail, 'RESTORE_TARGET_MUST_BE_LOOPBACK');
  assert.equal((await runRelocate({ url: `postgresql://u:${SECRET}@127.0.0.1/postgres`, schema: 'carscope', env: {} })).checks[0].detail, 'RESTORE_TARGET_NAME_NOT_REHEARSAL');
  assert.equal((await runRelocate({ url: `postgresql://u:${SECRET}@127.0.0.1/carscope_rehearsal_a`, schema: 'public', env: {} })).checks[0].detail, 'DATABASE_SCHEMA_NOT_PRIVATE');
  const compare = (extra) => runCompare({ archive: 'never.dump', url: remote, schema: 'carscope', now, env: {}, ...extra });
  assert.equal((await compare({})).checks[0].detail, 'REMOTE_SOURCE_NEEDS_G3_APPROVAL');
  assert.equal((await compare({ allowRemoteReadOnly: true, approvedOn: '2000-01-01' })).checks[0].detail, 'G3_APPROVAL_DATE_NOT_TODAY_UTC');
  for (const argv of [
    ['relocate', '--target-url-env', 'T'], ['relocate', '--schema', 'carscope'], ['relocate', '--target-url-env', 'T', '--schema', 'carscope', '--allow-remote-read-only'],
    ['compare', '--archive', 'a', '--url-env', 'U'], ['compare', '--archive', 'a', '--url-env', 'postgresql://u:p@h/x', '--schema', 's'], ['compare', '--archive', 'a', '--url-env', 'U', '--schema', 's', '--approved-on', '2026-11-06'],
    ['compare', '--archive', 'a', '--url-env', 'U', '--schema', 's', '--ca-env', '-----BEGIN'], ['restore', '--archive', 'a', '--target-url-env', 'T', '--ca-env', 'C'], ['restore', '--archive', 'a', '--target-url-env', 'T', '--approved-on', '2026-11-06'],
  ]) assert.throws(() => parseArguments(argv), undefined, JSON.stringify(argv));
  assert.equal(parsePreflight(['database', '--url-env', 'U', '--expect-schema', 'carscope', '--ca-env', 'C']).opts['expect-schema'], 'carscope');
  assert.throws(() => parsePreflight(['database', '--url-env', 'U', '--ca-env', '-----BEGIN']));
});

test('a manifest scoped to one schema drops every other schema and the global extension list', () => {
  const manifest = {
    tables: [{ schema: 'carscope', name: 'a' }, { schema: 'public', name: 'b' }],
    structure: {
      schemas: [{ name: 'carscope' }, { name: 'public' }], columns: [{ relation: 'carscope.a' }, { relation: 'public.b' }], constraints: [{ relation: 'public.b' }], indexes: [{ name: 'carscope.i' }, { name: 'carscopex.i' }],
      sequences: [], triggers: [], functions: [{ name: 'public.f' }], extensions: [{ name: 'plpgsql' }],
    },
  };
  const scoped = scopeManifest(manifest, 'carscope');
  assert.deepEqual(scoped.tables, [{ schema: 'carscope', name: 'a' }]);
  assert.deepEqual(scoped.structure, { schemas: [{ name: 'carscope' }], columns: [{ relation: 'carscope.a' }], constraints: [], indexes: [{ name: 'carscope.i' }], sequences: [], triggers: [], functions: [], extensions: [] });
});

test('operator SQL grants the API roles nothing, holds no password, and creates a role with no platform powers', () => {
  const read = (file) => readFileSync(new URL('../preflight/' + file, import.meta.url), 'utf8');
  const bootstrap = read('supabase-bootstrap.sql'), post = read('supabase-post-restore.sql'), premise = read('supabase-s2-premise-check.sql');
  const statements = (text) => text.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const text of [bootstrap, post, premise]) {
    assert.equal(text.includes('carscope_private'), false, 'the existing empty schema is neither reused nor removed');
    assert.equal(/\bDROP\b/i.test(text), false);
  }
  assert.match(statements(premise).trim(), /^SELECT\b/);
  assert.equal(/\b(INSERT|UPDATE|DELETE|CREATE ROLE|CREATE SCHEMA|ALTER|GRANT|REVOKE|BEGIN|COMMIT)\b/.test(statements(premise).replace(/'[^']*'/g, "''")), false, 'the premise check only reads');
  for (const sql of [statements(bootstrap), statements(post)]) {
    assert.equal(/\b(anon|authenticated|service_role)\b/i.test(sql), false);
    assert.equal(/\bPASSWORD\b/i.test(sql), false);
    assert.equal(/\b(auth|storage)\./i.test(sql), false, 'no managed schema is touched');
  }
  for (const attribute of ['NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS']) assert.match(bootstrap, new RegExp(attribute));
  assert.match(post, /REVOKE CREATE ON DATABASE/);
});
