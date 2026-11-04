// What this tool cannot see on Render is reported NOT_VERIFIED; an operator supplies observed facts as arguments.
// Nothing here calls Render. Environment input is a list of variable NAMES, and a value in it is refused.
import { execFileSync } from 'node:child_process';
import { check } from './report.mjs';
import { REPO_ROOT, FORBIDDEN_RENDER_ENV } from './static-gates.mjs';

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
  const simulator = names.includes('CARSCOPE_AVD_SIMULATOR_MODE');
  return check('RENDER_ENV_NAMES', simulator ? 'MANUAL' : 'PASS', simulator ? 'simulator mode variable set: creation opens for operator-approved AVDs only, never OEM ownership' : 'required present, refused absent; values not inspected');
}

export function manualRenderGates() {
  return [
    check('RENDER_BACKUP_READY', 'NOT_VERIFIED', 'plan, backup availability and a fresh pg_dump are unknown; see the backup section of docs/p8-c1-deployment-readiness.md'),
    check('RENDER_RESTORE_REHEARSED', 'NOT_RUN', 'restore into a separate database has not been rehearsed'),
    check('RENDER_DEPLOYMENT', 'NOT_RUN', 'this tool has no deploy command'),
  ];
}

export function runRenderGates({ deployedCommit, autoDeploy, envNames } = {}) {
  return [...commitGates({ deployedCommit }), autoDeployGate(autoDeploy), environmentNamesGate(envNames), ...manualRenderGates()];
}
