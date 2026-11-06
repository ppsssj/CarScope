#!/usr/bin/env node
// Backup and restore rehearsal. Separate from deployment-preflight, whose promise is that it writes nothing.
//   environment [--url-env <NAME>]                                   client and server versions
//   create-isolated --admin-url-env <NAME> --name <suffix>           loopback only: <prefix><suffix>_source (synthetic rows) and an empty _target
//   backup  --source-url-env <NAME> --out <new file outside the repository> [--allow-remote-read-only --g3-approved-on <UTC YYYY-MM-DD>]
//   inspect --archive <file>                                         SHA-256 and pg_restore --list; no database
//   restore --archive <file> --target-url-env <NAME>                 loopback carscope_rehearsal_* only, empty target only, one transaction
//   verify  --archive <file> --target-url-env <NAME> [--startup-ddl] compares with the manifest; --startup-ddl runs the migration on the copy
// Client selection: --pg-bin <directory> or --docker-image <image>; otherwise pg_dump and pg_restore from PATH.
// Common: --json, --report <new file outside the repository>
// There is no argument that widens the restore target. A database URL is read only from a named environment variable.
// Exit: 0 no FAIL (open items may remain), 1 at least one FAIL, 2 usage error.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, renderText, safeCode, summarize, assertOutsideRepository } from '../preflight/report.mjs';
import { REPO_ROOT } from '../preflight/static-gates.mjs';
import {
  clientVersions, dockerClient, inspectArchive, nativeClient, openClient, parseConnection, recoveryVerdict,
  runBackup, runRestore, runVerify, versionCompatibility,
} from '../preflight/recovery.mjs';

const CLIENT_FLAGS = ['pg-bin', 'docker-image'];
const FLAGS = {
  environment: { value: ['url-env', ...CLIENT_FLAGS], bool: [] },
  'create-isolated': { value: ['admin-url-env', 'name'], bool: [] },
  backup: { value: ['source-url-env', 'out', 'g3-approved-on', ...CLIENT_FLAGS], bool: ['allow-remote-read-only'] },
  inspect: { value: ['archive', ...CLIENT_FLAGS], bool: [] },
  restore: { value: ['archive', 'target-url-env', ...CLIENT_FLAGS], bool: [] },
  verify: { value: ['archive', 'target-url-env'], bool: ['startup-ddl'] },
};
const COMMON = { value: ['report'], bool: ['json'] };
const REQUIRED = { 'create-isolated': ['admin-url-env', 'name'], backup: ['source-url-env', 'out'], inspect: ['archive'], restore: ['archive', 'target-url-env'], verify: ['archive', 'target-url-env'], environment: [] };
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** Pure parser. No flag can carry a database URL, and an unknown flag is an error. */
export function parseArguments(argv) {
  const [command, ...args] = argv;
  const spec = FLAGS[command];
  if (!spec) throw new Error('UNKNOWN_COMMAND');
  const opts = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const flag = /^--([a-z0-9-]+)$/.exec(args[i])?.[1];
    if (!flag || Object.hasOwn(opts, flag)) throw new Error('INVALID_ARGUMENTS');
    if ([...spec.bool, ...COMMON.bool].includes(flag)) opts[flag] = true;
    else if ([...spec.value, ...COMMON.value].includes(flag)) {
      const value = args[++i];
      if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
      opts[flag] = value;
    } else throw new Error('INVALID_ARGUMENTS');
  }
  for (const flag of REQUIRED[command]) if (!opts[flag]) throw new Error('REQUIRED_ARGUMENT_MISSING');
  for (const flag of Object.keys(opts)) if (flag.endsWith('url-env') && !ENV_NAME.test(opts[flag])) throw new Error('URL_ENV_NAME_REQUIRED');
  for (const flag of ['archive', 'out']) if (/^postgres(ql)?:/i.test(opts[flag] ?? '')) throw new Error('INVALID_ARGUMENTS');
  if (opts['pg-bin'] && opts['docker-image']) throw new Error('ONE_CLIENT_ONLY');
  if (opts['g3-approved-on'] && !opts['allow-remote-read-only']) throw new Error('INVALID_ARGUMENTS');
  return { command, opts };
}

const chooseClient = (opts) => (opts['docker-image'] ? dockerClient({ image: opts['docker-image'] }) : nativeClient({ binDir: opts['pg-bin'] }));
const needUrl = (env, name) => {
  if (!env[name]) throw new Error('NAMED_VARIABLE_EMPTY');
  return env[name];
};

async function environmentChecks(opts, env) {
  const versions = await clientVersions(chooseClient(opts));
  const out = [
    check('CLIENT_PG_DUMP', versions.pg_dump ? 'PASS' : 'BLOCKED', versions.pg_dump ? `pg_dump ${versions.pg_dumpVersion}` : 'not available: ' + versions.error),
    check('CLIENT_PG_RESTORE', versions.pg_restore ? 'PASS' : 'BLOCKED', versions.pg_restore ? `pg_restore ${versions.pg_restoreVersion}` : 'not available: ' + versions.error),
  ];
  if (!opts['url-env']) return [...out, check('SERVER_VERSION', 'NOT_RUN', 'no --url-env given')];
  const connection = parseConnection(needUrl(env, opts['url-env']));
  if (!connection.loopback) return [...out, check('SERVER_VERSION', 'BLOCKED', 'non-loopback server: this command never connects to one')];
  let db;
  try {
    db = await openClient(connection);
    const major = Math.floor(Number((await db.query("SELECT current_setting('server_version_num') AS v")).rows[0].v) / 10000);
    out.push(check('SERVER_VERSION', 'PASS', `PostgreSQL ${major}`), versionCompatibility('CLIENT_SERVER_COMPATIBILITY', versions.pg_dump, major));
  } catch (error) {
    out.push(check('SERVER_VERSION', 'BLOCKED', 'cannot connect: ' + safeCode(error)));
  } finally {
    await db?.end().catch(() => {});
  }
  return out;
}

export async function runCommand({ command, opts }, env = process.env) {
  switch (command) {
    case 'environment': return { checks: await environmentChecks(opts, env) };
    case 'create-isolated': {
      const { createIsolated } = await import('../preflight/recovery-seed.mjs');
      const r = await createIsolated({ adminUrl: needUrl(env, opts['admin-url-env']), name: opts.name, env });
      return { checks: [check('ISOLATED_DATABASES', 'PASS', `${r.source} (${r.sessions} sessions, ${r.records} records, synthetic), ${r.target} (empty)`)] };
    }
    case 'backup':
      return runBackup({ url: needUrl(env, opts['source-url-env']), out: opts.out, client: chooseClient(opts), allowRemoteReadOnly: opts['allow-remote-read-only'] === true, g3ApprovedOn: opts['g3-approved-on'], env });
    case 'inspect': return inspectArchive({ archive: opts.archive, client: chooseClient(opts) });
    case 'restore': return runRestore({ archive: opts.archive, url: needUrl(env, opts['target-url-env']), client: chooseClient(opts), env });
    case 'verify': return runVerify({ archive: opts.archive, url: needUrl(env, opts['target-url-env']), startupDdl: opts['startup-ddl'] === true, env });
    default: throw new Error('UNKNOWN_COMMAND');
  }
}

/** Only `verify` can name a recovery verdict. Production stays NOT_RUN unless the evidence itself says otherwise. */
export function reportPayload(command, result, now = Date.now) {
  const checks = result.checks, scope = result.manifest?.scope ?? null;
  const verdict = command === 'verify' && result.manifest ? recoveryVerdict(checks, scope) : null;
  return {
    kind: 'carscope-recovery-report', command, generatedAt: new Date(now()).toISOString(), scope, verdict,
    backupCreatedAt: result.manifest?.createdAt ?? null, archiveSha256: result.manifest?.archive?.sha256 ?? null,
    summary: summarize(checks), checks,
    notRun: ['RENDER_DEPLOY_NOT_RUN', ...(scope === 'REMOTE_READ_ONLY' ? [] : ['PRODUCTION_DB_NOT_RUN'])],
  };
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    console.error('USAGE_ERROR ' + (/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'INVALID_ARGUMENTS') + ': see the header of bin/db-recovery.mjs');
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = await runCommand(parsed);
  } catch (error) {
    result = { checks: [check('RECOVERY', 'FAIL', 'command failed: ' + safeCode(error))] };
  }
  const payload = reportPayload(parsed.command, result);
  if (parsed.opts.report) {
    try {
      assertOutsideRepository(parsed.opts.report, REPO_ROOT, 'REPORT_IN_REPOSITORY_FORBIDDEN');
      writeFileSync(parsed.opts.report, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      console.error('REPORT_NOT_WRITTEN ' + safeCode(error));
      process.exitCode = 1;
    }
  }
  if (parsed.opts.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(renderText(`db-recovery ${parsed.command}`, payload.checks) + '\n' + [payload.verdict, ...payload.notRun].filter(Boolean).join(' '));
  if (payload.summary.failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
