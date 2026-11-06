#!/usr/bin/env node
// Deployment preflight. Read-only by construction: no deploy command, no Render API, no DDL, no environment change.
//   static                                     code and contract gates; no network, no database
//   compat  [--apk <path>]                     decoder/server matrix and APK generation
//   database --url-env <NAME> [--allow-remote-read-only] [--expect-schema <schema>] [--ca-env <NAME>]   READ ONLY schema inspection
//   probe   --origin <https> [--approve-rate-window-writes] /healthz, optionally refused /v1 probes
//   render  [--deployed-commit <sha>] [--target-commit <sha>] [--auto-deploy off|on] [--env-names-file <path>] [--recovery-report <path>]
//   regression                                 existing Sync/History suites; PG suites only on an isolated database
//   all     [--apk <path>]                     static + compat + render + regression (never a remote call)
// Options common to all: --json, --report <new file outside the repository>
// Exit: 0 no FAIL (open items may remain), 1 at least one FAIL, 2 usage error.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, renderText, summarize, assertOutsideRepository } from '../preflight/report.mjs';
import { runStaticGates, TOOL_ROOT, REPO_ROOT } from '../preflight/static-gates.mjs';
import { runCompatGates } from '../preflight/compat.mjs';
import { inspectDatabaseUrl, assertIsolatedTestDatabase } from '../preflight/database.mjs';
import { probeDeployment } from '../preflight/probe.mjs';
import { runRenderGates } from '../preflight/render-gates.mjs';

const FLAGS = {
  static: { value: [], bool: [] },
  compat: { value: ['apk'], bool: [] },
  database: { value: ['url-env', 'expect-schema', 'ca-env'], bool: ['allow-remote-read-only'] },
  probe: { value: ['origin'], bool: ['approve-rate-window-writes'] },
  render: { value: ['deployed-commit', 'target-commit', 'auto-deploy', 'env-names-file', 'recovery-report'], bool: [] },
  regression: { value: [], bool: [] },
  all: { value: ['apk'], bool: [] },
};
const COMMON = { value: ['report'], bool: ['json'] };

/** Pure parser. No flag can carry a database URL or a secret, and an unknown flag is an error. */
export function parseArguments(argv) {
  const [command, ...args] = argv;
  const spec = FLAGS[command];
  if (!spec) throw new Error('UNKNOWN_COMMAND');
  const opts = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const flag = /^--([a-z-]+)$/.exec(args[i])?.[1];
    if (!flag || Object.hasOwn(opts, flag)) throw new Error('INVALID_ARGUMENTS');
    if ([...spec.bool, ...COMMON.bool].includes(flag)) opts[flag] = true;
    else if ([...spec.value, ...COMMON.value].includes(flag)) {
      const value = args[++i];
      if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
      opts[flag] = value;
    } else throw new Error('INVALID_ARGUMENTS');
  }
  if (command === 'database' && !/^[A-Z_][A-Z0-9_]*$/.test(opts['url-env'] ?? '')) throw new Error('URL_ENV_NAME_REQUIRED');
  if (opts['ca-env'] && !/^[A-Z_][A-Z0-9_]*$/.test(opts['ca-env'])) throw new Error('URL_ENV_NAME_REQUIRED');
  if (command === 'probe' && !opts.origin) throw new Error('ORIGIN_REQUIRED');
  return { command, opts };
}

// Node's test runner summary lines. A skip is an unrun check, never a pass.
export function parseTestSummary(output) {
  const value = (name) => Number(new RegExp(`^(?:# |ℹ )${name} (\\d+)`, 'm').exec(output)?.[1] ?? NaN);
  return { pass: value('pass'), fail: value('fail'), skipped: value('skipped'), cancelled: value('cancelled') };
}

const PLAIN_SUITES = ['test/service.test.mjs', 'test/server.test.mjs', 'test/security.test.mjs', 'test/auth-contract.test.mjs', 'test/history.test.mjs', 'test/history-auth.test.mjs', 'test/render-preflight.test.mjs'];
const PG_SUITES = ['test/postgres-store.test.mjs', 'test/avd-simulator.test.mjs', 'test/avd-simulator-admin.test.mjs', 'test/history-postgres.test.mjs', 'test/history-auth-postgres.test.mjs', 'test/deployment-postgres.test.mjs', 'test/db-recovery-postgres.test.mjs'];

/** The suite gets only the isolated test URL: service variables are removed from its environment. */
function runSuite(id, files, url) {
  const env = { ...process.env };
  for (const name of ['DATABASE_URL', 'PG_ADMIN_DATABASE_URL', 'RENDER', 'RENDER_EXTERNAL_URL', 'CARSCOPE_AVD_SIMULATOR_MODE']) delete env[name];
  if (url) env.PG_TEST_URL = url; else delete env.PG_TEST_URL;
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], { cwd: TOOL_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (x) => (output += x));
    child.stderr.on('data', () => {});
    child.on('close', (code) => {
      const s = parseTestSummary(output);
      if (code !== 0 || s.fail || s.cancelled) done(check(id, 'FAIL', `pass=${s.pass} fail=${s.fail} cancelled=${s.cancelled} skipped=${s.skipped}`));
      else if (Number.isNaN(s.pass)) done(check(id, 'FAIL', 'no test summary'));
      else if (s.skipped) done(check(id, 'NOT_RUN', `pass=${s.pass} skipped=${s.skipped}: a skip is not a pass`));
      else done(check(id, 'PASS', `pass=${s.pass} fail=0 skipped=0`));
    });
  });
}

export async function runRegression(env = process.env) {
  const out = [await runSuite('REGRESSION_SYNC_HISTORY', PLAIN_SUITES)];
  const url = env.PG_TEST_URL;
  if (!url) return [...out, check('REGRESSION_POSTGRES', 'NOT_RUN', 'PG_TEST_URL is empty')];
  try {
    assertIsolatedTestDatabase(url, env);
  } catch (error) {
    return [...out, check('REGRESSION_POSTGRES', 'FAIL', error.message)];
  }
  return [...out, await runSuite('REGRESSION_POSTGRES', PG_SUITES, url)];
}

/** Evidence stays out of Git and an existing file is never overwritten. */
function writeReport(path, payload) {
  assertOutsideRepository(path, REPO_ROOT, 'REPORT_IN_REPOSITORY_FORBIDDEN');
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

const FIXED_VERDICTS = ['RENDER_DEPLOYMENT_NOT_RUN', 'PRODUCTION_AUTH_BLOCKED', 'DEVICE_E2E_NOT_RUN'];

export async function runCommand({ command, opts }, env = process.env) {
  switch (command) {
    case 'static': return runStaticGates();
    case 'compat': return runCompatGates({ apk: opts.apk });
    case 'database': return inspectDatabaseUrl({ url: env[opts['url-env']], allowRemoteReadOnly: opts['allow-remote-read-only'] === true, env, expectedSchema: opts['expect-schema'] ?? null, caPemBase64: opts['ca-env'] ? env[opts['ca-env']] : null });
    case 'probe': return probeDeployment({ origin: opts.origin, approveRateWindowWrites: opts['approve-rate-window-writes'] === true });
    case 'render': return runRenderGates({
      deployedCommit: opts['deployed-commit'], targetCommit: opts['target-commit'], autoDeploy: opts['auto-deploy'],
      envNames: opts['env-names-file'] ? readFileSync(opts['env-names-file'], 'utf8') : undefined,
      recoveryReport: opts['recovery-report'] ? readFileSync(opts['recovery-report'], 'utf8') : undefined,
    });
    case 'regression': return runRegression(env);
    case 'all': return [...await runStaticGates(), ...await runCompatGates({ apk: opts.apk }), ...runRenderGates(), ...await runRegression(env)];
    default: throw new Error('UNKNOWN_COMMAND');
  }
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    console.error('USAGE_ERROR ' + (/^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_ARGUMENTS') + ': see the header of bin/deployment-preflight.mjs');
    process.exitCode = 2;
    return;
  }
  let checks;
  try {
    checks = await runCommand(parsed);
  } catch (error) {
    // A malformed origin or an unreadable names file must not echo operator input, which may hold a secret.
    checks = [check('PREFLIGHT', 'FAIL', 'command failed: ' + (/^[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : error?.code ?? 'UNEXPECTED'))];
  }
  const summary = summarize(checks);
  const payload = { command: parsed.command, summary, checks, verdicts: FIXED_VERDICTS };
  if (parsed.opts.report) {
    try {
      writeReport(parsed.opts.report, payload);
    } catch (error) {
      console.error('REPORT_NOT_WRITTEN ' + (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : error?.code ?? 'UNEXPECTED'));
      process.exitCode = 1;
    }
  }
  if (parsed.opts.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(renderText(`deployment-preflight ${parsed.command}`, checks) + '\n' + FIXED_VERDICTS.join(' '));
  if (summary.failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
