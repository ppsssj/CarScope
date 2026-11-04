// Preflight gates without PostgreSQL. Each gate is also fed the defect it exists to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  bootstrapGate, ddlGate, ddlInventory, environmentGate, environmentReads, importGraph, runStaticGates, schemaInventory,
  serverClockGate, ttlGate, REPO_ROOT, TOOL_ROOT,
} from '../preflight/static-gates.mjs';
import {
  apkGate, classifyApk, compatibilityMatrix, currentDecoderSource, decoderAccepts, decoderPolicy, legacyDecoderSource, matrixGate, serverGenerations,
} from '../preflight/compat.mjs';
import { assertIsolatedTestDatabase, inspectDatabaseUrl, isLoopbackUrl } from '../preflight/database.mjs';
import { probeDeployment } from '../preflight/probe.mjs';
import { autoDeployGate, commitGates, environmentNamesGate } from '../preflight/render-gates.mjs';
import { parseArguments, parseTestSummary } from '../bin/deployment-preflight.mjs';
import { DEFAULT_LIMITS } from '../src/sessions.mjs';

const CLI = fileURLToPath(new URL('../bin/deployment-preflight.mjs', import.meta.url));
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'carscope-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const byId = (checks, id) => checks.find((c) => c.id === id);
const runCli = (args, env = {}) => {
  const keep = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  return spawnSync(process.execPath, [CLI, ...args], { cwd: TOOL_ROOT, encoding: 'utf8', env: { ...keep, ...env }, timeout: 60_000 });
};
/** A copy of the Render runtime sources that a test can break without touching the repository. */
function runtimeCopy(t) {
  const root = temp(t), tool = join(root, 'tools/inspection-sync-poc');
  mkdirSync(tool, { recursive: true });
  for (const dir of ['src', 'bin']) cpSync(join(TOOL_ROOT, dir), join(tool, dir), { recursive: true });
  cpSync(resolve(TOOL_ROOT, '../mobile-ar-poc'), join(root, 'tools/mobile-ar-poc'), { recursive: true, filter: (from) => !/[\/]node_modules([\/]|$)/.test(from) });
  return tool;
}

test('DDL inventory accepts only additive repeatable statements, also with CRLF and comments', () => {
  const good = "-- note; with semicolon\r\nCREATE TABLE IF NOT EXISTS a (id INT);\r\nCREATE INDEX IF NOT EXISTS i ON a(id);\r\nINSERT INTO a(id) VALUES(1) ON CONFLICT(id) DO NOTHING;\r\n";
  assert.deepEqual(ddlInventory(good), { tables: ['a'], indexes: [{ name: 'i', table: 'a' }], seeds: ['a'], nonAdditive: [] });
  for (const bad of [
    'DROP TABLE a', 'ALTER TABLE a ADD COLUMN b INT', 'TRUNCATE a', 'DELETE FROM a', 'UPDATE a SET id=2', 'CREATE TABLE a (id INT)',
    'CREATE INDEX i ON a(id)', 'INSERT INTO a(id) VALUES(1)', 'INSERT INTO a(id) VALUES(1) ON CONFLICT(id) DO UPDATE SET id=1',
    'CREATE TABLE IF NOT EXISTS a (id INT); DROP TABLE b',
  ]) assert.ok(ddlInventory(bad).nonAdditive.length > 0, bad);
});

test('the real schema is additive and its inventory is what the deployment document lists', () => {
  assert.equal(ddlGate().status, 'PASS');
  const inventory = schemaInventory();
  assert.deepEqual(inventory.base.tables, ['cs_schema_meta', 'cs_sessions', 'cs_session_tokens', 'cs_rate_windows']);
  assert.deepEqual(inventory.history.tables, ['cs_history_schema_meta', 'cs_inspection_records']);
  assert.deepEqual(inventory.avd.tables, ['cs_avd_auth_meta', 'cs_avd_registrations', 'cs_avd_creation_grants']);
  const doc = readFileSync(resolve(REPO_ROOT, 'docs/p8-c1-deployment-readiness.md'), 'utf8');
  for (const part of Object.values(inventory)) {
    for (const name of [...part.tables, ...part.indexes.map((x) => x.name)]) assert.ok(doc.includes('`' + name + '`'), name + ' missing from the DDL table');
    assert.ok(doc.includes(part.sha256), part.file + ' sha256 in the DDL table is stale');
  }
});

test('environment reads are found; a CLI block of an imported module is out of scope, the entry block is not', () => {
  const marker = 'if (process.argv[1] === fileURLToPath(import.meta.url)) { process.env.CLI_ONLY; }';
  assert.deepEqual(environmentReads(`const a = process.env.ONE, b = env.TWO;\n${marker}`).names, ['ONE', 'TWO']);
  assert.deepEqual(environmentReads(`${marker}`, { isEntry: true }).names, ['CLI_ONLY']);
  assert.equal(environmentReads('const x = process.env[name];').dynamic, true);
  assert.equal(environmentReads('const { A } = process.env;').dynamic, true);
  assert.equal(environmentReads('const o = { ...process.env };').dynamic, true);
});

test('gates catch an environment switch, a CLI authority and a test import added to the runtime path', (t) => {
  const pristine = runtimeCopy(t);
  assert.equal(environmentGate(pristine).status, 'PASS');
  assert.equal(bootstrapGate(pristine).status, 'PASS');
  assert.ok(importGraph('src/render-stateful.mjs', pristine).includes('src/history-authorizer.mjs'));

  const envSwitch = runtimeCopy(t);
  appendFileSync(join(envSwitch, 'src/history-authorizer.mjs'), '\nexport const open = process.env.CARSCOPE_HISTORY_READ === "ALLOW";\n');
  const gate = environmentGate(envSwitch);
  assert.equal(gate.status, 'FAIL');
  assert.match(gate.detail, /CARSCOPE_HISTORY_READ/);

  const dropped = runtimeCopy(t), entry = join(dropped, 'src/render-stateful.mjs');
  writeFileSync(entry, readFileSync(entry, 'utf8').replace("'SYNC_FIXTURE_TOKEN',", ''));
  assert.equal(environmentGate(dropped).status, 'FAIL', 'a removed refusal is a change of policy');

  const cli = runtimeCopy(t), cliEntry = join(cli, 'src/render-stateful.mjs');
  writeFileSync(cliEntry, readFileSync(cliEntry, 'utf8').replace("host: '0.0.0.0', port,", "host: '0.0.0.0', port, historyAuthority: {},"));
  assert.equal(bootstrapGate(cli).status, 'FAIL');

  const imported = runtimeCopy(t);
  mkdirSync(join(imported, 'test'));
  writeFileSync(join(imported, 'test/fixture.mjs'), 'export const token = 1;\n');
  appendFileSync(join(imported, 'src/server.mjs'), "\nimport '../test/fixture.mjs';\n");
  assert.equal(bootstrapGate(imported).status, 'FAIL');
});

test('TTL gate fails on any changed Sync limit', () => {
  assert.equal(ttlGate().status, 'PASS');
  for (const key of ['inviteTtlMs', 'sessionTtlMs', 'acceptedRetentionMs', 'tombstoneMs'])
    assert.equal(ttlGate({ ...DEFAULT_LIMITS, [key]: DEFAULT_LIMITS[key] + 1 }).status, 'FAIL', key);
});

test('serverNow gate separates an absent field from a broken one', async () => {
  const base = { sessionId: 'x', taskId: 'washer-fluid', receiverToken: 'r', inviteToken: 'i', inviteExpiresAt: 2000, expiresAt: 3000 };
  const gate = (response) => serverClockGate({ create: async () => response });
  assert.equal((await gate(base)).status, 'BLOCKED');
  assert.equal((await gate({ ...base, serverNow: 1999 })).status, 'PASS');
  for (const serverNow of [2000, -1, 1.5, '1999', null]) assert.equal((await gate({ ...base, serverNow })).status, 'FAIL', String(serverNow));
  assert.equal((await gate({ ...base, serverNow: 1, inviteExpiresAt: 3001 })).status, 'FAIL', 'invite after session end');
  assert.equal((await gate({ ...base, extra: 1 })).status, 'FAIL');
  const { expiresAt, ...missing } = base;
  assert.equal((await gate(missing)).status, 'FAIL');
});

test('static gates pass on this tree; serverNow tracks whether PR #78 is present', async () => {
  const checks = await runStaticGates();
  assert.deepEqual(checks.filter((c) => c.status === 'FAIL'), []);
  for (const id of ['DDL_ADDITIVE', 'SYNC_TTL_CONTRACT', 'HISTORY_TASK_ALLOWLIST', 'HISTORY_DENY_DEFAULT', 'RENDER_BOOTSTRAP_DENY_DEFAULT', 'ENV_CANNOT_ENABLE_AUTH', 'UNVERIFIED_AUTHORITY_BLOCKED', 'RENDER_CLI_REFUSES_UNSAFE_CONFIG', 'TEST_PROD_CREDENTIAL_SEPARATION'])
    assert.equal(byId(checks, id).status, 'PASS', id);
  assert.equal(byId(checks, 'PRODUCTION_AUTH_BLOCKED').status, 'BLOCKED', 'never a PASS until an issuer exists');
  assert.equal(byId(checks, 'STARTUP_APPLIES_DDL').status, 'MANUAL');
  assert.ok(['BLOCKED', 'PASS'].includes(byId(checks, 'SERVER_NOW_CONTRACT').status));
});

test('decoder policies come from the Kotlin source: legacy is exact six keys, current adds optional serverNow', () => {
  const legacy = decoderPolicy(legacyDecoderSource()), current = decoderPolicy(currentDecoderSource());
  const six = ['sessionId', 'taskId', 'receiverToken', 'inviteToken', 'inviteExpiresAt', 'expiresAt'];
  assert.deepEqual(legacy, { required: six, optional: [], serverNowBelowInvite: false });
  assert.deepEqual(current, { required: six, optional: ['serverNow'], serverNowBelowInvite: true });
  assert.throws(() => decoderPolicy('class Other'), /DECODER_FUNCTION_NOT_FOUND/);
  const response = Object.fromEntries(six.map((k) => [k, 'v']));
  response.inviteExpiresAt = 10;
  assert.equal(decoderAccepts(legacy, response), true);
  assert.equal(decoderAccepts(legacy, { ...response, serverNow: 1 }), false);
  assert.equal(decoderAccepts(current, { ...response, serverNow: 1 }), true);
  for (const serverNow of [10, 11, null, '1', 1.5, -1]) assert.equal(decoderAccepts(current, { ...response, serverNow }), false, String(serverNow));
  assert.equal(decoderAccepts(current, { ...response, surprise: 1 }), false);
});

test('compatibility matrix states the four combinations, and a decoder regression fails the order gate', async () => {
  const rows = await compatibilityMatrix();
  const table = Object.fromEntries(rows.map((r) => [`${r.decoder}/${r.server}`, [r.nativeSession, r.native3d]]));
  assert.deepEqual(table, {
    'oldDecoder/oldServer': ['PASS', 'UNSUPPORTED'],
    'oldDecoder/newServer': ['FAIL', 'UNSUPPORTED'],
    'newDecoder/oldServer': ['PASS', 'UNSUPPORTED'],
    'newDecoder/newServer': ['PASS', 'PASS'],
  });
  assert.equal(matrixGate(rows).status, 'PASS');
  assert.equal(matrixGate(await compatibilityMatrix({ current: legacyDecoderSource() })).status, 'FAIL', 'current decoder must stay tolerant of serverNow');
});

test('server generations label which response is actual and which is derived', async () => {
  const base = { sessionId: 's', taskId: 'washer-fluid', receiverToken: 'r', inviteToken: 'i', inviteExpiresAt: 2000, expiresAt: 3000 };
  const absent = await serverGenerations({ create: async () => base });
  assert.equal(absent.oldServer.provenance, 'ACTUAL_THIS_TREE');
  assert.equal(absent.newServer.provenance, 'DERIVED_FIELD_ADDED_PR78_CONTRACT');
  assert.equal(absent.newServer.response.serverNow, 1999);
  const present = await serverGenerations({ create: async () => ({ ...base, serverNow: 1000 }) });
  assert.equal(present.newServer.provenance, 'ACTUAL_THIS_TREE');
  assert.equal(present.oldServer.provenance, 'DERIVED_FIELD_REMOVED');
  assert.equal(Object.hasOwn(present.oldServer.response, 'serverNow'), false);
});

function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data, deflate] of entries) {
    const body = deflate ? deflateRawSync(data) : data, nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(body.length, 18); local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(deflate ? 8 : 0, 10); record.writeUInt32LE(body.length, 20); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const DECODER = Buffer.from('Lio/carscope/app/sync/SyncHttpDecoder;'), CLOCK = Buffer.from('serverNow');

test('APK generation reads every dex, stored or deflated, and refuses non-archives', (t) => {
  const generation = (entries) => classifyApk(zip(entries)).generation;
  assert.equal(generation([['classes.dex', DECODER], ['classes2.dex', CLOCK, true]]), 'NEW_DECODER');
  assert.equal(generation([['classes.dex', DECODER, true], ['assets/serverNow.txt', CLOCK]]), 'LEGACY_DECODER', 'only dex counts');
  assert.equal(generation([['classes.dex', Buffer.from('release')]]), 'NO_SYNC_DECODER');
  assert.equal(generation([['AndroidManifest.xml', CLOCK]]), 'NOT_AN_APP');
  assert.throws(() => classifyApk(Buffer.from('not a zip')), /NOT_A_ZIP/);
  const dir = temp(t), write = (name, bytes) => { const p = join(dir, name); writeFileSync(p, bytes); return p; };
  const good = apkGate(write('new.apk', zip([['classes.dex', Buffer.concat([DECODER, CLOCK])]])));
  assert.equal(good.status, 'PASS');
  assert.match(good.detail, /sha256=[0-9a-f]{64}/);
  assert.equal(apkGate(write('old.apk', zip([['classes.dex', DECODER]]))).status, 'FAIL');
  assert.equal(apkGate(write('bad.apk', 'x')).status, 'FAIL');
  assert.equal(apkGate(join(dir, 'missing.apk')).status, 'FAIL');
  assert.equal(apkGate(undefined).status, 'NOT_VERIFIED');
});

const health = (over = {}) => ({ status: 200, headers: {}, body: JSON.stringify({ status: 'UP', mode: 'STATEFUL_DENY_DEFAULT', sessionCreation: 'DENIED', ...over }) });
const denied = { status: 403, headers: {}, body: '{"error":{"code":"FORBIDDEN"}}' };
const unauthorized = { status: 401, headers: {}, body: '{"error":{"code":"UNAUTHORIZED"}}' };
function fakeRender(overrides = {}) {
  const seen = [];
  const request = async (origin, path, options = {}) => {
    seen.push(`${options.method ?? 'GET'} ${path}`);
    if (path in overrides) return overrides[path];
    if (path === '/healthz') return health();
    return path.startsWith('/v1/sessions/') ? unauthorized : denied;
  };
  return { request, seen };
}
const origin = 'https://render.example';

test('probe sends only /healthz by default because /v1 requests write rate windows', async () => {
  const { request, seen } = fakeRender();
  const checks = await probeDeployment({ origin, request });
  assert.deepEqual(seen, ['GET /healthz']);
  assert.equal(byId(checks, 'RENDER_HEALTH').status, 'PASS');
  assert.equal(byId(checks, 'RENDER_API_BOUNDARY').status, 'NOT_RUN');
});

test('approved probe verifies the refused paths and fails on any opened history route', async () => {
  const good = fakeRender();
  assert.equal(byId(await probeDeployment({ origin, request: good.request, approveRateWindowWrites: true }), 'RENDER_API_BOUNDARY').status, 'PASS');
  assert.equal(good.seen.length, 5);
  const open = fakeRender({ '/v1/inspection-records': { status: 200, headers: {}, body: '{"items":[]}' } });
  const opened = byId(await probeDeployment({ origin, request: open.request, approveRateWindowWrites: true }), 'RENDER_API_BOUNDARY');
  assert.equal(opened.status, 'FAIL');
  assert.match(opened.detail, /records without credential: 200/);
});

test('probe fails unknown modes and a configured authority; network errors stay sanitized', async () => {
  const run = async (healthz) => probeDeployment({ origin, request: fakeRender({ '/healthz': healthz }).request });
  assert.equal(byId(await run(health({ mode: 'READ_ONLY_PREFLIGHT' })), 'RENDER_HEALTH').status, 'FAIL');
  assert.equal(byId(await run(health({ sessionCreation: 'ALLOWED' })), 'RENDER_HEALTH').status, 'FAIL');
  assert.equal(byId(await run({ status: 503, headers: {}, body: '{"status":"UNAVAILABLE"}' }), 'RENDER_HEALTH').status, 'FAIL');
  assert.equal(byId(await run(health({ historyRead: 'AUTHORITY_ADAPTER_CONFIGURED' })), 'RENDER_HISTORY_AUTHORITY').status, 'FAIL');
  assert.equal(byId(await run(health({ mode: 'STATEFUL_AVD_SIMULATION', sessionCreation: 'OPERATOR_APPROVED_AVD_ONLY' })), 'RENDER_HEALTH').status, 'PASS');
  const failed = await probeDeployment({ origin, request: async () => { throw Object.assign(new Error('postgres://u:leaked@host failed'), { code: 'ECONNRESET' }); } });
  assert.equal(byId(failed, 'RENDER_HEALTH').status, 'BLOCKED');
  assert.equal(JSON.stringify(failed).includes('leaked'), false);
  await assert.rejects(() => probeDeployment({ origin: 'http://render.example', request: fakeRender().request }));
});

test('commit gates compare an operator-supplied SHA with origin/main and report what the next deploy changes', (t) => {
  const root = temp(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=preflight', '-c', 'user.email=preflight@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  mkdirSync(join(root, 'tools/inspection-sync-poc/src'), { recursive: true });
  const sessions = join(root, 'tools/inspection-sync-poc/src/sessions.mjs');
  writeFileSync(sessions, 'export const a = 1;\n');
  git('add', '.'); git('commit', '-qm', 'old');
  const old = git('rev-parse', 'HEAD');
  writeFileSync(sessions, 'export const serverNow = 1;\n');
  writeFileSync(join(root, 'tools/inspection-sync-poc/src/postgres-history-schema.sql'), '-- history\n');
  git('add', '.'); git('commit', '-qm', 'new');
  const main = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', main);
  git('checkout', '-qb', 'side', old); writeFileSync(sessions, 'export const side = 1;\n'); git('add', '.'); git('commit', '-qm', 'side');
  const side = git('rev-parse', 'HEAD');

  assert.equal(commitGates({ root })[0].status, 'NOT_VERIFIED');
  assert.equal(commitGates({ root, deployedCommit: 'not-a-sha' })[0].status, 'FAIL');
  assert.equal(commitGates({ root, deployedCommit: 'a'.repeat(40) })[0].status, 'FAIL');
  const current = commitGates({ root, deployedCommit: main });
  assert.equal(current[0].status, 'PASS');
  assert.match(current[1].detail, /returns serverNow/);
  const behind = commitGates({ root, deployedCommit: old });
  assert.equal(behind[0].status, 'MANUAL');
  assert.match(behind[0].detail, /1 commits behind/);
  assert.match(behind[1].detail, /no serverNow/);
  assert.match(behind[2].detail, /predates History/);
  assert.equal(commitGates({ root, deployedCommit: side })[0].status, 'FAIL', 'a commit off main is an unreviewed deployment');
});

test('auto-deploy and environment gates never read Render and never echo operator input', () => {
  assert.equal(autoDeployGate(undefined).status, 'NOT_VERIFIED');
  assert.equal(autoDeployGate('off').status, 'MANUAL', 'an attestation is not a PASS');
  assert.equal(autoDeployGate('on').status, 'FAIL');
  assert.equal(environmentNamesGate(undefined).status, 'NOT_VERIFIED');
  assert.equal(environmentNamesGate('DATABASE_URL\nNODE_VERSION\n').status, 'PASS');
  assert.equal(environmentNamesGate('DATABASE_URL\r\nNODE_VERSION\r\nCARSCOPE_AVD_SIMULATOR_MODE\r\n').status, 'MANUAL');
  assert.equal(environmentNamesGate('NODE_VERSION\n').status, 'FAIL');
  for (const name of ['SYNC_FIXTURE_TOKEN', 'PG_TEST_URL', 'PG_ADMIN_DATABASE_URL', 'NODE_TLS_REJECT_UNAUTHORIZED'])
    assert.equal(environmentNamesGate(`DATABASE_URL\nNODE_VERSION\n${name}\n`).status, 'FAIL', name);
  // Required names are all present, so only the pasted value can make this fail.
  const pasted = environmentNamesGate('DATABASE_URL\nNODE_VERSION\nSOME_KEY=hunter2\n');
  assert.equal(pasted.status, 'FAIL');
  assert.equal(pasted.detail.includes('hunter2'), false);
});

test('isolated database guard refuses remote hosts and a URL equal to a service variable', () => {
  const local = 'postgresql://u:p@127.0.0.1:5432/x';
  assert.equal(isLoopbackUrl(local), true);
  for (const url of ['postgresql://u:p@db.internal/x', 'postgresql://u:p@dpg-abc.singapore-postgres.render.com/x', 'garbage'])
    assert.equal(isLoopbackUrl(url), false, url);
  assert.throws(() => assertIsolatedTestDatabase('postgresql://u:p@db.internal/x', {}), /TEST_DATABASE_MUST_BE_LOOPBACK/);
  assert.throws(() => assertIsolatedTestDatabase(local, { DATABASE_URL: local }), /TEST_DATABASE_EQUALS_SERVICE_DATABASE/);
  assert.throws(() => assertIsolatedTestDatabase(local, { PG_ADMIN_DATABASE_URL: local }), /TEST_DATABASE_EQUALS_SERVICE_DATABASE/);
  assert.doesNotThrow(() => assertIsolatedTestDatabase(local, { DATABASE_URL: 'postgresql://u:p@db.internal/x' }));
});

test('database gate refuses remote URLs before connecting and disabled TLS verification', async () => {
  const remote = 'postgresql://operator:topsecret@db.invalid/prod';
  const blocked = await inspectDatabaseUrl({ url: remote, env: {} });
  assert.equal(blocked[0].status, 'BLOCKED');
  assert.match(blocked[0].detail, /--allow-remote-read-only/, 'refused for lack of approval, not because the host failed to resolve');
  assert.equal(JSON.stringify(blocked).includes('topsecret'), false);
  assert.equal((await inspectDatabaseUrl({ url: undefined, env: {} }))[0].status, 'NOT_RUN');
  assert.equal((await inspectDatabaseUrl({ url: remote, allowRemoteReadOnly: true, env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } }))[0].status, 'FAIL');
});

test('CLI takes no URL or secret argument and rejects unknown commands with exit 2', () => {
  assert.deepEqual(parseArguments(['database', '--url-env', 'PG_TEST_URL']).opts['url-env'], 'PG_TEST_URL');
  for (const argv of [
    [], ['deploy'], ['migrate'], ['database'], ['database', '--url', 'postgres://u:p@h/x'], ['database', '--url-env', 'postgres://u:p@h/x'],
    ['probe'], ['probe', '--origin'], ['static', '--apk', 'x'], ['static', '--json', '--json'], ['render', '--deployed-commit', '--json'],
  ]) assert.throws(() => parseArguments(argv), undefined, JSON.stringify(argv));
  const usage = runCli(['database', '--url', 'postgresql://operator:topsecret@db.invalid/prod']);
  assert.equal(usage.status, 2);
  assert.equal((usage.stdout + usage.stderr).includes('topsecret'), false);
  assert.equal(runCli(['deploy']).status, 2);
});

test('CLI output and exit code: a database URL never leaves the process', () => {
  const secret = 'topsecret' + process.pid, url = `postgresql://operator:${secret}@db.invalid/prod`;
  const blocked = runCli(['database', '--url-env', 'TARGET', '--json'], { TARGET: url });
  assert.equal(blocked.status, 0, 'BLOCKED is an open item, not a failure');
  assert.equal(JSON.parse(blocked.stdout).checks[0].status, 'BLOCKED');
  const approved = runCli(['database', '--url-env', 'TARGET', '--allow-remote-read-only'], { TARGET: url });
  for (const output of [blocked.stdout + blocked.stderr, approved.stdout + approved.stderr]) {
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes('db.invalid'), false);
  }
  const bad = runCli(['probe', '--origin', 'http://u:topsecret@host.invalid']);
  assert.equal(bad.status, 1);
  assert.equal((bad.stdout + bad.stderr).includes('topsecret'), false);
});

test('reports are refused inside the repository and never overwrite an existing file', (t) => {
  const inside = runCli(['render', '--report', join(TOOL_ROOT, 'preflight/report-must-not-exist.json')]);
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /REPORT_IN_REPOSITORY_FORBIDDEN/);
  const target = join(temp(t), 'report.json');
  const first = runCli(['render', '--report', target]);
  assert.equal(first.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')).verdicts, ['RENDER_DEPLOYMENT_NOT_RUN', 'PRODUCTION_AUTH_BLOCKED', 'DEVICE_E2E_NOT_RUN']);
  assert.match(runCli(['render', '--report', target]).stderr, /REPORT_NOT_WRITTEN EEXIST/);
});

test('test summary parser understands both reporters and treats a missing summary as unknown', () => {
  assert.deepEqual(parseTestSummary('# pass 3\n# fail 0\n# skipped 1\n# cancelled 0\n'), { pass: 3, fail: 0, skipped: 1, cancelled: 0 });
  assert.equal(parseTestSummary('ℹ pass 7\nℹ fail 2\n').fail, 2);
  assert.ok(Number.isNaN(parseTestSummary('nothing').pass));
});

test('database inspection issues read statements only; the tool has no deploy path', () => {
  const database = readFileSync(new URL('../preflight/database.mjs', import.meta.url), 'utf8');
  const statements = [...database.matchAll(/client\.query\((['"`])([^'"`]*)/g)].map((m) => m[2]);
  assert.ok(statements.length >= 10);
  for (const sql of statements) assert.match(sql, /^(BEGIN TRANSACTION READ ONLY|SET LOCAL |SHOW |SELECT |ROLLBACK$)/, sql);
  for (const file of ['bin/deployment-preflight.mjs', 'preflight/render-gates.mjs', 'preflight/probe.mjs', 'preflight/database.mjs', 'preflight/compat.mjs'])
    assert.doesNotMatch(readFileSync(resolve(TOOL_ROOT, file), 'utf8'), /api\.render\.com|PostgreSQLSessionStore|\.initialize\(|bin\/avd-simulator-admin/, file);
});
