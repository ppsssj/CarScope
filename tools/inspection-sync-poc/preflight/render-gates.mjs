// What this tool cannot see on Render is reported NOT_VERIFIED; an operator supplies observed facts as arguments.
// Nothing here calls Render. Environment input is a list of variable NAMES, and a value in it is refused.
import { execFileSync } from 'node:child_process';
import { check } from './report.mjs';
import { REPO_ROOT, FORBIDDEN_RENDER_ENV, SQL_FILES } from './static-gates.mjs';

const REQUIRED_ENV = Object.freeze(['DATABASE_URL', 'NODE_VERSION']);
const REFUSED_ENV = Object.freeze([...FORBIDDEN_RENDER_ENV, 'NODE_TLS_REJECT_UNAUTHORIZED', 'PG_TEST_URL', 'PG_ADMIN_DATABASE_URL']);

const git = (args, root) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (args, root) => { try { return git(args, root); } catch { return null; } };

export function commitGates({ deployedCommit, root = REPO_ROOT } = {}) {
  const main = tryGit(['rev-parse', 'origin/main'], root);
  if (!main) return [check('RENDER_COMMIT_MATCHES_MAIN', 'NOT_RUN', 'origin/main is unavailable')];
  if (!deployedCommit) return [check('RENDER_COMMIT_MATCHES_MAIN', 'NOT_VERIFIED', `origin/main=${main}; pass --deployed-commit from the Render dashboard`)];
  if (!/^[0-9a-f]{7,40}$/.test(deployedCommit)) return [check('RENDER_COMMIT_MATCHES_MAIN', 'FAIL', 'deployed commit is not a hex SHA')];
  const full = tryGit(['rev-parse', '--verify', deployedCommit + '^{commit}'], root);
  if (!full) return [check('RENDER_COMMIT_MATCHES_MAIN', 'FAIL', 'deployed commit is unknown to this clone: fetch, or treat as an unreviewed deployment')];
  const onMain = tryGit(['merge-base', '--is-ancestor', full, main], root) !== null;
  const behind = onMain ? tryGit(['rev-list', '--count', `${full}..${main}`], root) : null;
  const out = [full === main
    ? check('RENDER_COMMIT_MATCHES_MAIN', 'PASS', `deployed ${full} equals origin/main`)
    : check('RENDER_COMMIT_MATCHES_MAIN', onMain ? 'MANUAL' : 'FAIL', onMain ? `deployed ${full} is ${behind} commits behind origin/main` : `deployed ${full} is not on origin/main`)];
  const read = (path) => tryGit(['show', `${full}:${path}`], root);
  out.push(check('RENDER_DEPLOYED_SERVER_CLOCK', 'MANUAL', read('tools/inspection-sync-poc/src/sessions.mjs')?.includes('serverNow')
    ? 'deployed commit returns serverNow: old-decoder APKs fail against it'
    : 'deployed commit has no serverNow: 3D binding stays SERVER_CLOCK_UNAVAILABLE'));
  out.push(check('RENDER_DEPLOYED_HISTORY_DDL', 'MANUAL', read('tools/inspection-sync-poc/src/postgres-history-schema.sql') === null
    ? 'deployed commit predates History: the next deploy applies the History DDL'
    : 'deployed commit already carries the History DDL: confirm with the database check'));
  return out;
}

export function autoDeployGate(value) {
  if (value === undefined) return check('RENDER_AUTO_DEPLOY', 'NOT_VERIFIED', 'check Settings > Build & Deploy > Auto-Deploy on the dashboard, then pass --auto-deploy off|on');
  if (value === 'off') return check('RENDER_AUTO_DEPLOY', 'MANUAL', 'operator reported Off; not read from Render by this tool');
  if (value === 'on') return check('RENDER_AUTO_DEPLOY', 'FAIL', 'merging to main would deploy and migrate without a separate approval');
  return check('RENDER_AUTO_DEPLOY', 'FAIL', 'expected off or on');
}

/** Names only. A line containing `=` could hold a secret, so the whole input is refused without echoing it. */
export function environmentNamesGate(text) {
  if (text === undefined) return check('RENDER_ENV_NAMES', 'NOT_VERIFIED', `required ${REQUIRED_ENV.join(', ')}; refused ${REFUSED_ENV.join(', ')}; pass --env-names-file`);
  const names = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (names.some((x) => !/^[A-Z_][A-Z0-9_]*$/.test(x))) return check('RENDER_ENV_NAMES', 'FAIL', 'input must hold variable names only, one per line; a value may have been pasted');
  const missing = REQUIRED_ENV.filter((x) => !names.includes(x)), refused = names.filter((x) => REFUSED_ENV.includes(x));
  if (missing.length || refused.length) return check('RENDER_ENV_NAMES', 'FAIL', `missing [${missing}] refused [${refused}]`);
  if (names.includes('CARSCOPE_DB_SCHEMA') !== names.includes('CARSCOPE_DB_CA_PEM_BASE64')) return check('RENDER_ENV_NAMES', 'FAIL', 'CARSCOPE_DB_SCHEMA and CARSCOPE_DB_CA_PEM_BASE64 are set together or not at all');
  const simulator = names.includes('CARSCOPE_AVD_SIMULATOR_MODE');
  return check('RENDER_ENV_NAMES', simulator ? 'MANUAL' : 'PASS', simulator ? 'simulator mode variable set: creation opens for operator-approved AVDs only, never OEM ownership' : 'required present, refused absent; values not inspected');
}

/** Keeps "what runs now" and "what G4 would deploy" apart: only the second one decides the DDL and response changes. */
export function targetCommitGates({ targetCommit, deployedCommit, root = REPO_ROOT } = {}) {
  if (!targetCommit) return [check('RENDER_TARGET_COMMIT', 'NOT_VERIFIED', 'pass --target-commit with the commit G4 would deploy')];
  if (!/^[0-9a-f]{7,40}$/.test(targetCommit)) return [check('RENDER_TARGET_COMMIT', 'FAIL', 'target commit is not a hex SHA')];
  const target = tryGit(['rev-parse', '--verify', targetCommit + '^{commit}'], root);
  if (!target) return [check('RENDER_TARGET_COMMIT', 'FAIL', 'target commit is unknown to this clone')];
  const main = tryGit(['rev-parse', 'origin/main'], root);
  if (!main) return [check('RENDER_TARGET_COMMIT', 'NOT_RUN', 'origin/main is unavailable')];
  const onMain = tryGit(['merge-base', '--is-ancestor', target, main], root) !== null;
  const out = [!onMain
    ? check('RENDER_TARGET_COMMIT', 'FAIL', `target ${target} is not on origin/main: review and merge it first`)
    : target === main
      ? check('RENDER_TARGET_COMMIT', 'PASS', `target ${target} equals origin/main`)
      : check('RENDER_TARGET_COMMIT', 'MANUAL', `target ${target} is ${tryGit(['rev-list', '--count', `${target}..${main}`], root)} commits behind origin/main`)];
  const read = (commit, path) => tryGit(['show', `${commit}:tools/inspection-sync-poc/${path}`], root);
  out.push(check('RENDER_TARGET_SERVER_CLOCK', 'MANUAL', read(target, 'src/sessions.mjs')?.includes('serverNow')
    ? 'target returns serverNow: every old-decoder APK must be replaced before G4'
    : 'target has no serverNow: 3D binding stays SERVER_CLOCK_UNAVAILABLE'));
  const deployed = deployedCommit && /^[0-9a-f]{7,40}$/.test(deployedCommit) ? tryGit(['rev-parse', '--verify', deployedCommit + '^{commit}'], root) : null;
  if (!deployed) return [...out, check('RENDER_TARGET_DDL_DELTA', 'NOT_VERIFIED', 'deployed commit unknown: assume startup may apply base and History DDL')];
  const changed = Object.values(SQL_FILES).filter((file) => read(deployed, file) !== read(target, file));
  return [...out, check('RENDER_TARGET_DDL_DELTA', changed.length ? 'MANUAL' : 'PASS', changed.length ? `schema files differ from the deployed commit, and startup applies them: [${changed}]` : 'schema files match the deployed commit')];
}

/** Backups older than this are stale for G4. A proposed value: no incident has measured it. */
export const RECOVERY_REPORT_MAX_AGE_MS = 24 * 60 * 60_000;

const backupNotReady = (detail) => [
  check('RENDER_BACKUP_READY', 'NOT_VERIFIED', detail),
  check('RENDER_RESTORE_REHEARSED', 'NOT_RUN', 'restore of the service backup into a separate database has not been rehearsed'),
];

/**
 * A synthetic rehearsal proves the procedure, never that the service database has a backup, so it cannot satisfy
 * these gates. Even a good report stays MANUAL: the operator supplies the file and this tool cannot authenticate it.
 */
export function recoveryReportGates(text, { now = Date.now } = {}) {
  if (text === undefined) return backupNotReady('plan, backup availability and a fresh pg_dump are unknown; pass --recovery-report from db-recovery verify (G3)');
  let report;
  try { report = JSON.parse(text); } catch { return [check('RENDER_BACKUP_READY', 'FAIL', 'recovery report is not JSON'), check('RENDER_RESTORE_REHEARSED', 'NOT_RUN', 'no usable report')]; }
  if (report?.kind !== 'carscope-recovery-report' || report.command !== 'verify') return [check('RENDER_BACKUP_READY', 'FAIL', 'not a db-recovery verify report'), check('RENDER_RESTORE_REHEARSED', 'NOT_RUN', 'no usable report')];
  if (report.scope !== 'REMOTE_READ_ONLY') return backupNotReady(`report scope ${report.scope} is a local rehearsal: it proves the procedure, not a service backup`);
  if (report.verdict !== 'G3_REHEARSAL_VERIFIED') return [check('RENDER_BACKUP_READY', 'FAIL', 'report did not verify: see its checks'), check('RENDER_RESTORE_REHEARSED', 'FAIL', 'rehearsal did not pass')];
  const created = Date.parse(report.backupCreatedAt);
  if (!Number.isFinite(created) || now() - created > RECOVERY_REPORT_MAX_AGE_MS || created > now()) return [check('RENDER_BACKUP_READY', 'FAIL', 'backup time is unknown or older than 24 hours: take a new one'), check('RENDER_RESTORE_REHEARSED', 'MANUAL', 'rehearsal passed for an old backup')];
  return [
    check('RENDER_BACKUP_READY', 'MANUAL', `operator report: archive ${report.archiveSha256}, taken ${report.backupCreatedAt}. Not authenticated by this tool`),
    check('RENDER_RESTORE_REHEARSED', 'MANUAL', 'operator report: restore, comparison and server migration passed on a separate database'),
  ];
}

export function manualRenderGates() {
  return [
    check('RENDER_DEPLOYMENT', 'NOT_RUN', 'this tool has no deploy command'),
    check('RENDER_START_COMMAND', 'NOT_VERIFIED', 'check Settings > Start Command: it must name src/render-stateful.mjs unless an AVD history demonstration was approved'),
  ];
}

export function runRenderGates({ deployedCommit, targetCommit, autoDeploy, envNames, recoveryReport } = {}) {
  return [...commitGates({ deployedCommit }), ...targetCommitGates({ targetCommit, deployedCommit }), autoDeployGate(autoDeploy), environmentNamesGate(envNames), ...recoveryReportGates(recoveryReport), ...manualRenderGates()];
}
