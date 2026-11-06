#!/usr/bin/env node
// Do the new tests catch the defects they exist for? Each defect goes into a throwaway copy, one at a time, and the named
// tests must fail. Heavy, so it runs on a CI runner: node test/run-pg-matrix.mjs --only 17 -- test/run-mutations.mjs
// A control comes first: no result counts unless the same selection passes on unmodified code and actually runs tests.
// Exit 1 on an unexpected survivor, a mutation that no longer applies, or an invalid control.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), 'carscope-mutants-'));
mkdirSync(join(WORK, 'tools'), { recursive: true });
const copy = (from, to) => cpSync(join(REPO, from), join(WORK, to), { recursive: true, filter: (p) => !p.split(/[\\/]/).includes('node_modules') });
copy('tools/mobile-ar-poc', 'tools/mobile-ar-poc');
copy('tools/inspection-sync-poc', 'tools/inspection-sync-poc');
const TOOL = join(WORK, 'tools/inspection-sync-poc');
symlinkSync(join(REPO, 'tools/inspection-sync-poc/node_modules'), join(TOOL, 'node_modules'), 'junction');

const UNIT = 'test/supabase-preflight.test.mjs', PG = 'test/supabase-preflight-postgres.test.mjs';
const CFG = 'src/database-config.mjs', STORE = 'src/postgres-store.mjs', AVD = 'src/avd-simulator-credentials.mjs', RS = 'src/render-stateful.mjs', DB = 'preflight/database.mjs', REC = 'preflight/recovery.mjs';
const BOOT = 'preflight/supabase-bootstrap.sql', POST = 'preflight/supabase-post-restore.sql', GATES = 'preflight/render-gates.mjs';
const EQUIVALENT = true;
const M = [
  ['plaintext allowed to any host', CFG, "if (!caPemBase64 && !privateNetwork) throw new Error('DATABASE_TLS_CA_REQUIRED');", '', UNIT, 'plaintext is allowed'],
  ['TLS verification off', CFG, 'rejectUnauthorized: true', 'rejectUnauthorized: false', PG, 'TLS: a pinned'],
  ['CA dropped from pool options', CFG, '...(caPemBase64 ? { ssl: { ca: decodeCaCertificate(caPemBase64), rejectUnauthorized: true } } : {}),', '', PG, 'TLS: a pinned'],
  ['URL query allowed', CFG, ' || u.search)', ')', UNIT, 'pinned CA'],
  ['private key accepted as CA', CFG, " || pem.includes('PRIVATE KEY')", '', UNIT, 'CA value'],
  ['Supabase host without schema', CFG, "if (isSupabaseHost(u.hostname) && !expectedSchema) throw new Error('DATABASE_SCHEMA_REQUIRED');", '', UNIT, 'Supabase host'],
  ['public accepted as private schema', CFG, "'public', 'auth',", "'auth',", UNIT, 'Supabase host'],
  ['schema guard removed from startup', STORE, "if (at.rows[0]?.name !== this.#expectedSchema) throw new Error('DATABASE_SCHEMA_MISMATCH');", '', PG, 'fail closed on the wrong'],
  ['CLI does not pass the schema', RS, "host: '0.0.0.0', port, expectedSchema,", "host: '0.0.0.0', port,", PG, 'fail closed on the wrong'],
  ['health ignores schema drift', RS, "if (expectedSchema !== null && reached.rows[0]?.name !== expectedSchema) throw new Error('DATABASE_SCHEMA_MISMATCH');", '', PG, 'schema that drifts'],
  ['store: lost connection uncaught', STORE, "c.on('error', onLost);", '', PG, 'backend killed'],
  ['registry: lost connection uncaught', AVD, "c.on('error', onLost);", '', PG, 'backend killed'],
  ['API role gate never fails', DB, 'if (r.schema_access || r.table_access) allowed.push(role);', '', PG, 'gates fail when'],
  ['API role gate ignores table grants', DB, 'if (r.schema_access || r.table_access) allowed.push(role);', 'if (r.schema_access) allowed.push(role);', PG, 'gates fail when'],
  ['role attribute gate never fails', DB, "check('DB_ROLE_ATTRIBUTES', excess.length ? 'FAIL' : 'PASS',", "check('DB_ROLE_ATTRIBUTES', 'PASS',", PG, 'gates fail when'],
  ['TLS gate never fails', DB, "tls ? 'PASS' : requireTls ? 'FAIL' : 'MANUAL'", "tls ? 'PASS' : 'MANUAL'", PG, 'gates fail when'],
  ['public-table gate never fails', DB, "check('DB_PUBLIC_HOLDS_NO_CARSCOPE', leaked.length ? 'FAIL' : 'PASS',", "check('DB_PUBLIC_HOLDS_NO_CARSCOPE', 'PASS',", PG, 'fail closed on the wrong'],
  ['missing schema crashes the gate', DB, 'for (const role of exists ? roles : []) {', 'for (const role of roles) {', PG, 'fail closed on the wrong'],
  ['compare ignores digests', REC, "checks.push(check('VERIFY_ROW_DIGESTS', contentDiff.length ? 'FAIL' : 'PASS',", "checks.push(check('VERIFY_ROW_DIGESTS', 'PASS',", PG, 'gates fail when'],
  ['capture not scoped to the schema', REC, "const scope = schema ? `n.nspname='${assertPrivateSchemaName(schema)}'` : USER_SCHEMA;", 'const scope = USER_SCHEMA;', PG, 'private schema: migration'],
  ['search_path not fixed for capture', REC, "await client.query('SET LOCAL search_path=pg_catalog');", '', PG, 'relocated copy'],
  ['relocate accepts foreign tables', REC, 'if (foreign.length || !tables.includes', 'if (!tables.includes', PG, 'relocate refuses'],
  // ALTER TABLE SET SCHEMA moves rows and cannot change them, so nothing can reach this comparison in a test.
  ['relocate skips the row comparison', REC, 'if (!sameStructure || !sameRows ||', 'if (!sameStructure ||', PG, 'relocate refuses', EQUIVALENT],
  ['relocated verify migrates into public', REC, "...(schema ? { options: '-c search_path=' + schema } : {})", '', PG, 'relocated copy'],
  ['restore accepts a remote target', REC, "if (!connection.loopback) throw new Error('RESTORE_TARGET_MUST_BE_LOOPBACK');", '', UNIT, 'relocate is rehearsal-only'],
  ['compare without dated approval', REC, "if (g3ApprovedOn !== new Date(now()).toISOString().slice(0, 10)) throw new Error('G3_APPROVAL_DATE_NOT_TODAY_UTC');", '', UNIT, 'relocate is rehearsal-only'],
  ['role left with search_path unset', BOOT, 'ALTER ROLE carscope_app SET search_path = carscope;', '', PG, 'private schema: migration'],
  ['temporary CREATE grant never revoked', POST, "DO $revoke$ BEGIN EXECUTE format('REVOKE CREATE ON DATABASE %I FROM carscope_app', current_database()); END $revoke$;", '', PG, 'private schema: migration'],
  ['role made superuser', BOOT, 'LOGIN NOSUPERUSER', 'LOGIN SUPERUSER', UNIT, 'operator SQL'],
  ['half of the Supabase variables accepted', GATES, "if (names.includes('CARSCOPE_DB_SCHEMA') !== names.includes('CARSCOPE_DB_CA_PEM_BASE64')) return", 'if (false) return', UNIT, 'environment gates'],
  ['bootstrap accepts a grant that did nothing', BOOT, "    RAISE EXCEPTION 'carscope_app did not receive CREATE on this database: the admin role lacks the grant option';\n", '    NULL;\n', PG, 'S2 premise'],
  ['premise check misses the grant option', 'preflight/supabase-s2-premise-check.sql', "'CREATE WITH GRANT OPTION'", "'CREATE'", PG, 'S2 premise'],
];

function run(suite, pattern) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=' + pattern, suite], {
    cwd: TOOL, env: { ...process.env, PG_MATRIX_CONTAINER: '' }, encoding: 'utf8', timeout: 280_000, windowsHide: true, maxBuffer: 1 << 26,
  });
  const count = (name) => Number(new RegExp('^(?:# |\\u2139 )' + name + ' (\\d+)', 'm').exec(r.stdout)?.[1] ?? -1);
  return { status: r.status, pass: count('pass'), fail: count('fail'), broken: /ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError/.test(r.stdout + r.stderr) };
}

const tally = { KILLED: 0, SURVIVED: 0, EQUIVALENT: 0, INVALID: 0, NOT_APPLIED: 0 };
const controls = new Map();
try {
  for (const key of new Set(M.map((m) => m[4] + '|' + m[5]))) {
    const [suite, pattern] = key.split('|');
    const c = run(suite, pattern);
    controls.set(key, c);
    console.log(`CONTROL ${c.status === 0 && c.pass > 0 ? 'OK     ' : 'INVALID'} [${pattern}] pass=${c.pass} fail=${c.fail}`);
  }
  for (const [name, file, from, to, suite, pattern, equivalent] of M) {
    const path = join(TOOL, file), original = readFileSync(path, 'utf8'), source = original.replaceAll('\r\n', '\n');
    if (!source.includes(from)) { tally.NOT_APPLIED++; console.log(`NOT_APPLIED ${name}`); continue; }
    const control = controls.get(suite + '|' + pattern);
    writeFileSync(path, source.replace(from, () => to));
    const r = run(suite, pattern);
    writeFileSync(path, original);
    const valid = control.status === 0 && control.pass > 0 && !r.broken;
    const verdict = !valid ? 'INVALID' : r.status !== 0 ? 'KILLED' : equivalent ? 'EQUIVALENT' : 'SURVIVED';
    tally[verdict]++;
    console.log(`${verdict.padEnd(10)} ${name} [${pattern}] pass=${r.pass} fail=${r.fail} control_pass=${control.pass}`);
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
console.log(`TOTAL ${M.length} ${JSON.stringify(tally)}`);
if (tally.SURVIVED || tally.INVALID || tally.NOT_APPLIED) process.exitCode = 1;
