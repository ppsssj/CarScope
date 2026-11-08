// Gates that need no network and no database. They run the actual modules where possible and read source only
// where the question is about what the code path is able to do (imports, environment reads, DDL statements).
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, guarded } from './report.mjs';
import { DEFAULT_LIMITS, SessionService } from '../src/sessions.mjs';
import { MemorySessionStore } from '../src/session-store.mjs';
import { SUPPORTED_TASKS } from '../src/protocol.mjs';
import { startSyncServer } from '../src/server.mjs';
import { startRenderStateful } from '../src/render-stateful.mjs';
import { assertHistoryAuthorizerDeployable, DenyHistoryAuthorizer, HISTORY_READ_SCOPE } from '../src/history-authorizer.mjs';
import { CREATE_SCOPE } from '../src/verified-creation-authorizer.mjs';
import { AVD_AUDIENCE, AVD_CREATE_SCOPE } from '../src/avd-simulator-credentials.mjs';

export const TOOL_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = resolve(TOOL_ROOT, '../..');
export const SQL_FILES = Object.freeze({
  base: 'src/postgres-schema.sql',
  history: 'src/postgres-history-schema.sql',
  avd: 'src/avd-simulator-schema.sql',
});
const ENTRY = 'src/render-stateful.mjs';
export const AVD_HISTORY_DEMO_ENTRY = 'src/render-avd-history-demo.mjs';
export const WEBXR_EXPERIMENT_ENTRY = 'src/render-webxr-experiment.mjs';
export const VISION_EXPERIMENT_ENTRY = 'src/render-vision-experiment.mjs';
const WEBXR_DEVELOPMENT_HOSTS = ['src/mobile-dev-server.mjs', 'src/https-mobile-service.mjs'];
/** The only variables the Render path may read. Anything else, e.g. a history switch, fails this gate. */
export const ALLOWED_ENV = Object.freeze([
  'RENDER', 'RENDER_EXTERNAL_URL', 'DATABASE_URL', 'NODE_TLS_REJECT_UNAUTHORIZED', 'PORT',
  'CARSCOPE_AVD_SIMULATOR_MODE', 'NODE_ENV', 'CARSCOPE_DB_CA_PEM_BASE64', 'CARSCOPE_DB_SCHEMA',
]);
export const FORBIDDEN_RENDER_ENV = Object.freeze([
  'SYNC_LOCAL_TEST_AUTH', 'SYNC_FIXTURE_TOKEN', 'SYNC_DEBUG_PAGE', 'SYNC_ALLOWED_ORIGIN',
]);
const MAIN_MARKER = 'if (process.argv[1] === fileURLToPath(import.meta.url))';

/** Parses schema text; every statement must be additive and repeatable or it lands in `nonAdditive`. */
export function ddlInventory(sql) {
  const text = sql.split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');
  const out = { tables: [], indexes: [], seeds: [], nonAdditive: [] };
  for (const raw of text.split(';')) {
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s) continue;
    let m;
    if ((m = /^CREATE TABLE IF NOT EXISTS (\w+) \(/i.exec(s))) out.tables.push(m[1]);
    else if ((m = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)/i.exec(s))) out.indexes.push({ name: m[1], table: m[2] });
    else if ((m = /^INSERT INTO (\w+) ?\(.*\) VALUES ?\(.*\) ON CONFLICT ?\(id\) DO NOTHING$/i.exec(s))) out.seeds.push(m[1]);
    else out.nonAdditive.push(s.slice(0, 40));
  }
  return out;
}

export const schemaInventory = (root = TOOL_ROOT) =>
  Object.fromEntries(Object.entries(SQL_FILES).map(([key, file]) => {
    const sql = readFileSync(resolve(root, file), 'utf8');
    return [key, { file, sha256: createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'), ...ddlInventory(sql) }];
  }));

/** Relative import closure of a runtime entrypoint. */
export function importGraph(entry = ENTRY, root = TOOL_ROOT) {
  const seen = new Set(), queue = [resolve(root, entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)'(\.\.?\/[^']+)'/gm)) {
      const next = resolve(dirname(file), m[1]);
      if (next.endsWith('.mjs')) queue.push(next);
    }
  }
  return [...seen].map((file) => relative(root, file).split(sep).join('/')).sort();
}

/** Environment names a module can read when imported; another module's CLI block never runs on import. */
export function environmentReads(source, { isEntry = false } = {}) {
  const at = source.indexOf(MAIN_MARKER);
  const scanned = isEntry || at < 0 ? source : source.slice(0, at);
  const names = new Set([...scanned.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  const dynamic = /process\.env\[/.test(scanned) || /\.\.\.\s*process\.env\b/.test(scanned) || /\{[^}]*\}\s*=\s*process\.env\b/.test(scanned);
  return { names: [...names].sort(), dynamic };
}

export function environmentGate(root = TOOL_ROOT) {
  const unexpected = [];
  for (const file of importGraph(ENTRY, root)) {
    const isEntry = file === ENTRY;
    const { names, dynamic } = environmentReads(readFileSync(resolve(root, file), 'utf8'), { isEntry });
    unexpected.push(...names.filter((n) => !ALLOWED_ENV.includes(n)).map((n) => `${file}:${n}`));
    if (dynamic && !isEntry) unexpected.push(`${file}:DYNAMIC`);
  }
  // The entry reads dynamically only to refuse the listed test switches, so its list is pinned as well.
  const entry = readFileSync(resolve(root, ENTRY), 'utf8');
  const list = /\[((?:'[A-Z_]+',?\s*)+)\]\s*\.some\(k => process\.env\[k\]\)/.exec(entry)?.[1].match(/[A-Z_]+/g) ?? [];
  if (FORBIDDEN_RENDER_ENV.some((k) => !list.includes(k)) || list.length !== FORBIDDEN_RENDER_ENV.length) unexpected.push(`${ENTRY}:FORBIDDEN_LIST_CHANGED`);
  return unexpected.length
    ? check('ENV_CANNOT_ENABLE_AUTH', 'FAIL', 'unexpected: ' + unexpected.join(', '))
    : check('ENV_CANNOT_ENABLE_AUTH', 'PASS', 'Render import closure reads only the allowlisted variables');
}

/** The reviewed CLI must not pass an authority: History stays DENY_DEFAULT however the environment is set. */
export function bootstrapGate(root = TOOL_ROOT) {
  const entry = readFileSync(resolve(root, ENTRY), 'utf8');
  const main = entry.slice(entry.indexOf(MAIN_MARKER));
  const closure = importGraph(ENTRY, root);
  const leaked = closure.filter((f) => f.startsWith('test/') || f.startsWith('preflight/'));
  if (entry.indexOf(MAIN_MARKER) < 0 || /historyAuthorit|historyAuthorizer/.test(main)) return check('RENDER_BOOTSTRAP_DENY_DEFAULT', 'FAIL', 'CLI block passes a history authority');
  if (leaked.length) return check('RENDER_BOOTSTRAP_DENY_DEFAULT', 'FAIL', 'runtime imports: ' + leaked.join(', '));
  return check('RENDER_BOOTSTRAP_DENY_DEFAULT', 'PASS', `CLI passes no authority; ${closure.length} runtime modules, none from test/ or preflight/`);
}

/**
 * Deploying code must never open the Debug AVD read path. Only the demonstration entrypoint may pass the option, it may
 * read no variable of its own, and it adds nothing to the Render import closure. Starting it is an operator's Start Command.
 */
export function avdHistoryDemoGate(root = TOOL_ROOT) {
  const problems = [];
  const entry = readFileSync(resolve(root, ENTRY), 'utf8');
  if (/enableAvdHistoryRead/.test(entry.slice(entry.indexOf(MAIN_MARKER)))) problems.push('default CLI passes the read option');
  const library = entry.slice(0, entry.indexOf(MAIN_MARKER));
  if (!/enableAvdHistoryRead = false/.test(library)) problems.push('read option is not off by default');
  if (!/if \(historyAuthority && enableAvdSimulation\) throw new Error\('HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN'\)/.test(library)) problems.push('owner authority guard changed');
  const passes = (source) => /enableAvdHistoryRead\s*:/.test(source);
  for (const dir of ['src', 'bin']) {
    for (const name of readdirSync(resolve(root, dir)).filter((x) => x.endsWith('.mjs'))) {
      const file = dir + '/' + name;
      if (file !== AVD_HISTORY_DEMO_ENTRY && passes(readFileSync(resolve(root, file), 'utf8'))) problems.push(file + ' passes the read option');
    }
  }
  let demo;
  try { demo = readFileSync(resolve(root, AVD_HISTORY_DEMO_ENTRY), 'utf8'); } catch { problems.push('demonstration entrypoint is missing'); }
  if (demo) {
    if (/\bprocess\.env\b|\benv\./.test(demo)) problems.push('demonstration entrypoint reads the environment');
    if (!/if \(!enableAvdSimulation\) throw/.test(demo)) problems.push('demonstration entrypoint does not require simulator mode');
    if (/historyAuthorit|historyAuthorizer/.test(demo)) problems.push('demonstration entrypoint passes a history authority');
    const closure = importGraph(AVD_HISTORY_DEMO_ENTRY, root).filter((f) => f !== AVD_HISTORY_DEMO_ENTRY);
    const base = new Set(importGraph(ENTRY, root));
    problems.push(...closure.filter((f) => !base.has(f)).map((f) => 'demonstration entrypoint adds ' + f));
  }
  if (importGraph(ENTRY, root).includes(AVD_HISTORY_DEMO_ENTRY)) problems.push('default CLI imports the demonstration entrypoint');
  return problems.length
    ? check('AVD_HISTORY_DEMO_ENTRY_ONLY', 'FAIL', problems.join('; '))
    : check('AVD_HISTORY_DEMO_ENTRY_ONLY', 'PASS', 'only the demonstration entrypoint opens the read path; no variable can, and the default CLI does not');
}

/**
 * Deploying code must never turn the WebXR guide on. Only the experiment entrypoint may pass the option on the Render path,
 * it may read no variable and open nothing else, and the switch of the development hosts stays outside the Render closure.
 */
export function webxrExperimentGate(root = TOOL_ROOT) {
  const problems = [];
  const entry = readFileSync(resolve(root, ENTRY), 'utf8');
  if (/webxrGuide/.test(entry.slice(entry.indexOf(MAIN_MARKER)))) problems.push('default CLI passes the guide option');
  if (!/webxrGuide = false/.test(entry.slice(0, entry.indexOf(MAIN_MARKER)))) problems.push('guide option is not off by default');
  if (/webxr/i.test(readFileSync(resolve(root, 'src/render-preflight.mjs'), 'utf8'))) problems.push('render-preflight.mjs knows the guide');
  const base = importGraph(ENTRY, root);
  if (base.some((file) => file.endsWith('webxr-flag.mjs'))) problems.push('the variable switch is inside the Render closure');
  for (const host of WEBXR_DEVELOPMENT_HOSTS) if (base.includes(host)) problems.push('Render imports the development host ' + host);
  for (const dir of ['src', 'bin']) {
    for (const name of readdirSync(resolve(root, dir)).filter((x) => x.endsWith('.mjs'))) {
      const file = dir + '/' + name;
      if (file !== WEBXR_EXPERIMENT_ENTRY && !WEBXR_DEVELOPMENT_HOSTS.includes(file) && /webxrGuide\s*:/.test(readFileSync(resolve(root, file), 'utf8'))) problems.push(file + ' passes the guide option');
    }
  }
  let experiment;
  try { experiment = readFileSync(resolve(root, WEBXR_EXPERIMENT_ENTRY), 'utf8'); } catch { problems.push('experiment entrypoint is missing'); }
  if (experiment) {
    if (/\bprocess\.env\b|\benv\./.test(experiment)) problems.push('experiment entrypoint reads the environment');
    if (/historyAuthorit|historyAuthorizer|enableAvdHistoryRead/.test(experiment)) problems.push('experiment entrypoint opens a history path');
    if (!/assertWebXrGuideFiles\(\)/.test(experiment)) problems.push('experiment entrypoint does not check its files');
    const known = new Set(base);
    problems.push(...importGraph(WEBXR_EXPERIMENT_ENTRY, root).filter((f) => f !== WEBXR_EXPERIMENT_ENTRY && !known.has(f)).map((f) => 'experiment entrypoint adds ' + f));
  }
  if (base.includes(WEBXR_EXPERIMENT_ENTRY)) problems.push('default CLI imports the experiment entrypoint');
  return problems.length
    ? check('WEBXR_EXPERIMENT_ENTRY_ONLY', 'FAIL', problems.join('; '))
    : check('WEBXR_EXPERIMENT_ENTRY_ONLY', 'PASS', 'only the experiment entrypoint turns on the guide; no variable can, and the default CLI does not');
}

/**
 * P12-E: part detection stays off. No deployed command passes a provider, no variable reaches one, and the Render path holds no model.
 * The option exists in these hosts as a parameter only; a real entrypoint is a later, separately approved change.
 */
export function partDetectionGate(root = TOOL_ROOT) {
  const problems = [];
  const entry = readFileSync(resolve(root, ENTRY), 'utf8');
  if (/partDetection/.test(entry.slice(entry.indexOf(MAIN_MARKER)))) problems.push('default CLI passes a provider');
  if (!/partDetection = null/.test(entry.slice(0, entry.indexOf(MAIN_MARKER)))) problems.push('option is not off by default');
  const HOSTS = ['src/render-stateful.mjs', 'src/mobile-dev-server.mjs', 'src/server.mjs', 'src/mobile-page.mjs', VISION_EXPERIMENT_ENTRY];
  for (const dir of ['src', 'bin']) {
    for (const name of readdirSync(resolve(root, dir)).filter((x) => x.endsWith('.mjs'))) {
      const file = dir + '/' + name, source = readFileSync(resolve(root, file), 'utf8');
      const cli = source.includes(MAIN_MARKER) ? source.slice(source.indexOf(MAIN_MARKER)) : '';
      if (!HOSTS.includes(file) && /partDetection\s*:/.test(source)) problems.push(file + ' passes a provider');
      if (/partDetection/.test(cli) && (file !== VISION_EXPERIMENT_ENTRY || visionExperimentGate(root).status !== 'PASS')) problems.push(file + ' CLI passes a provider');
    }
  }
  const closure = importGraph(ENTRY, root);
  if (closure.some((f) => /roboflow|vision-poc/.test(f))) problems.push('a hosted client is inside the Render closure');
  for (const file of closure) if (/onnxruntime|@tensorflow|tfjs|from '@roboflow|ROBOFLOW|mediapipe/i.test(readFileSync(resolve(root, file), 'utf8'))) problems.push(file + ' names a model runtime or a key');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (Object.keys(pkg.dependencies ?? {}).join() !== 'pg') problems.push('the service gained a runtime dependency');
  return problems.length
    ? check('PART_DETECTION_OFF', 'FAIL', problems.join('; '))
    : check('PART_DETECTION_OFF', 'PASS', 'default Render has no detector/key/runtime; only the separately checked experiment may enable a provider');
}

/**
 * P13-A: part state analysis stays off. Render's entry never names it, only the local hosts take it as a parameter, and no vision client,
 * provider name or key variable is inside the Render closure. A real entrypoint is a later, separately approved change.
 */
export function partAnalysisGate(root = TOOL_ROOT) {
  const problems = [];
  const entry = readFileSync(resolve(root, ENTRY), 'utf8');
  if (/partAnalysis/.test(entry)) problems.push('the Render entry names partAnalysis');
  if (!/partAnalysis = null/.test(readFileSync(resolve(root, 'src/server.mjs'), 'utf8'))) problems.push('option is not off by default');
  const HOSTS = ['src/mobile-dev-server.mjs', 'src/server.mjs', 'src/mobile-page.mjs', VISION_EXPERIMENT_ENTRY];
  for (const dir of ['src', 'bin']) {
    for (const name of readdirSync(resolve(root, dir)).filter((x) => x.endsWith('.mjs'))) {
      const file = dir + '/' + name, source = readFileSync(resolve(root, file), 'utf8');
      const cli = source.includes(MAIN_MARKER) ? source.slice(source.indexOf(MAIN_MARKER)) : '';
      if (!HOSTS.includes(file) && /partAnalysis\s*:/.test(source)) problems.push(file + ' passes a vision provider');
      if (/partAnalysis/.test(cli)) problems.push(file + ' CLI passes a vision provider');
    }
  }
  const closure = importGraph(ENTRY, root);
  if (closure.some((f) => /openai|vision-poc|mock-vision/i.test(f))) problems.push('a vision client is inside the Render closure');
  for (const file of closure) if (/api\.openai\.com|OPENAI_|from 'openai'|anthropic/i.test(readFileSync(resolve(root, file), 'utf8'))) problems.push(file + ' names a vision service or a key');
  return problems.length
    ? check('PART_ANALYSIS_OFF', 'FAIL', problems.join('; '))
    : check('PART_ANALYSIS_OFF', 'PASS', 'default Render stays off with no vision client/key in its closure; only the separately checked experiment may pass a provider');
}

/** The default OFF gates stay scoped to their original entry. The only exception is reviewed here. */
export function visionExperimentGate(root = TOOL_ROOT) {
  const problems = [], base = importGraph(ENTRY, root), graph = importGraph(VISION_EXPERIMENT_ENTRY, root);
  const entry = readFileSync(resolve(root, VISION_EXPERIMENT_ENTRY), 'utf8');
  const cli = entry.slice(entry.indexOf(MAIN_MARKER));
  if (base.includes(VISION_EXPERIMENT_ENTRY) || base.some(f => /vision-budget|vision-providers/.test(f))) problems.push('default imports experiment');
  if (graph.some(f => /^(test|preflight)\/|washer-eval|\/review\/|\/scripts\//.test(f))) problems.push('experiment imports test/evaluation code');
  const allowed = ['CARSCOPE_DB_SCHEMA', 'CARSCOPE_VISION_APPROVAL', 'OPENAI_API_KEY', 'OPENAI_VISION_MODEL', 'CARSCOPE_VISION_DAILY_CALL_LIMIT', 'CARSCOPE_VISION_MONTHLY_CALL_LIMIT', 'CARSCOPE_ROBOFLOW_APPROVAL', 'ROBOFLOW_API_KEY'];
  for (const f of graph.filter(f => !base.includes(f))) {
    const reads = environmentReads(readFileSync(resolve(root, f), 'utf8'), { isEntry: f === VISION_EXPERIMENT_ENTRY });
    if (reads.dynamic || reads.names.some(n => !allowed.includes(n))) problems.push(f + ' unexpected environment');
  }
  if (!/visionEnvironment\(\)/.test(cli) || !/PostgreSQLVisionBudget/.test(cli) || !/experimentVisionProvider/.test(cli) || !/experimentDetectionProvider/.test(cli) || !/partDetection: detector \? \{ provider: detector, admission: budget \} : null/.test(cli) || /approvedDetectionProvider|LocalTest|createMock/.test(cli)) problems.push('unsafe experiment bootstrap');
  const providers = readFileSync(resolve(root, 'src/vision-providers.mjs'), 'utf8');
  if (!/detectionEnvironment\(env\)\.enabled/.test(providers) || !/CARSCOPE_ROBOFLOW_APPROVAL !== 'OPERATOR_APPROVED'/.test(providers)) problems.push('detector approval missing');
  if (!/partDetection = null/.test(entry) || !/new ProductionSessionCreationAuthorizer/.test(entry)) problems.push('default authority/detection changed');
  return problems.length ? check('VISION_EXPERIMENT_ENTRY_ONLY', 'FAIL', problems.join('; '))
    : check('VISION_EXPERIMENT_ENTRY_ONLY', 'PASS', 'separate experiment, explicit Vision and detector approval, durable budgets; default Render OFF');
}

export function ddlGate(root = TOOL_ROOT) {
  const inventory = schemaInventory(root);
  const bad = Object.values(inventory).flatMap((x) => x.nonAdditive.map((s) => `${x.file}: ${s}`));
  if (bad.length) return check('DDL_ADDITIVE', 'FAIL', bad.join(' | '), { inventory });
  const objects = Object.values(inventory).flatMap((x) => x.tables);
  return check('DDL_ADDITIVE', 'PASS', `${objects.length} tables; every statement is IF NOT EXISTS or ON CONFLICT DO NOTHING`, { inventory });
}

/** Deployment and migration are one action today; the operator has to know that before pressing Deploy. */
export function startupMigrationGate(root = TOOL_ROOT) {
  const entry = readFileSync(resolve(root, ENTRY), 'utf8'), store = readFileSync(resolve(root, 'src/postgres-store.mjs'), 'utf8');
  const applies = /PostgreSQLSessionStore\.open\(/.test(entry) && /postgres-history-schema\.sql/.test(store);
  return applies
    ? check('STARTUP_APPLIES_DDL', 'MANUAL', 'starting the server applies base+history DDL to DATABASE_URL: take the backup before Deploy')
    : check('STARTUP_APPLIES_DDL', 'NOT_VERIFIED', 'startup migration path changed; review docs/p8-c1-deployment-readiness.md');
}

export function ttlGate(limits = DEFAULT_LIMITS) {
  const expected = { inviteTtlMs: 600_000, sessionTtlMs: 1_800_000, acceptedRetentionMs: 600_000, tombstoneMs: 3_600_000 };
  const wrong = Object.keys(expected).filter((k) => limits[k] !== expected[k]);
  return wrong.length ? check('SYNC_TTL_CONTRACT', 'FAIL', 'changed: ' + wrong.join(', ')) : check('SYNC_TTL_CONTRACT', 'PASS', 'invite 10m, session 30m, accepted retention 10m, tombstone 60m');
}

export function taskAllowlistGate(root = TOOL_ROOT) {
  const sql = readFileSync(resolve(root, SQL_FILES.history), 'utf8');
  const listed = /task_id IN \(([^)]+)\)/.exec(sql)?.[1].match(/'[^']+'/g)?.map((x) => x.slice(1, -1)) ?? [];
  const same = listed.length === 17 && SUPPORTED_TASKS.length === 17 && listed.every((x) => SUPPORTED_TASKS.includes(x));
  return same ? check('HISTORY_TASK_ALLOWLIST', 'PASS', '17 tasks match the protocol') : check('HISTORY_TASK_ALLOWLIST', 'FAIL', 'SQL and protocol task lists differ');
}

const SERVER_NOW_KEYS = ['sessionId', 'taskId', 'receiverToken', 'inviteToken', 'inviteExpiresAt', 'expiresAt'];
/** Reads the actual creation response of this tree. Absence is reported as a block, not as a defect (PR #78). */
export async function serverClockGate(service = new SessionService({ store: new MemorySessionStore() })) {
  const created = await service.create({ taskId: 'washer-fluid' });
  const keys = Object.keys(created);
  const extra = keys.filter((k) => !SERVER_NOW_KEYS.includes(k) && k !== 'serverNow');
  if (extra.length || SERVER_NOW_KEYS.some((k) => !keys.includes(k))) return check('SERVER_NOW_CONTRACT', 'FAIL', 'creation response keys changed');
  if (!keys.includes('serverNow')) return check('SERVER_NOW_CONTRACT', 'BLOCKED', 'this tree has no serverNow (PR #78 absent): 3D binding stays SERVER_CLOCK_UNAVAILABLE', { generation: 'NO_SERVER_NOW' });
  const { serverNow: t, inviteExpiresAt: invite, expiresAt: end } = created;
  return Number.isSafeInteger(t) && t >= 0 && t < invite && invite <= end
    ? check('SERVER_NOW_CONTRACT', 'PASS', 'integer, 0 <= serverNow < inviteExpiresAt <= expiresAt', { generation: 'SERVER_NOW' })
    : check('SERVER_NOW_CONTRACT', 'FAIL', 'serverNow violates its bounds', { generation: 'SERVER_NOW' });
}

/** Exercises the default composition over real HTTP: a well-formed credential must still be refused. */
export async function denyDefaultGate() {
  if ((await new DenyHistoryAuthorizer().resolve()) !== null) return check('HISTORY_DENY_DEFAULT', 'FAIL', 'default authorizer resolved a principal');
  const app = await startSyncServer({ port: 0, log: () => {} });
  try {
    const bearer = { Authorization: 'Bearer ' + 'a'.repeat(43) };
    const list = await fetch(app.url + '/v1/inspection-records', { headers: bearer });
    const body = await list.json();
    const create = await fetch(app.url + '/v1/sessions', { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{"taskId":"washer-fluid"}' });
    await create.body?.cancel();
    return list.status === 403 && body.error?.code === 'FORBIDDEN' && create.status === 403
      ? check('HISTORY_DENY_DEFAULT', 'PASS', 'default composition: records 403, session creation 403')
      : check('HISTORY_DENY_DEFAULT', 'FAIL', `records ${list.status}, creation ${create.status}`);
  } finally {
    await app.stop();
  }
}

const rejects = async (fn, code) => {
  try { await fn(); return false; } catch (error) { return error?.message === code; }
};
/** Unverified or simulated authorities must be refused at startup, before any database use. */
export async function unverifiedAuthorityGate() {
  const publicOrigin = 'https://preflight.example';
  const results = {
    overrideRefused: await rejects(() => startRenderStateful({ publicOrigin, historyAuthorizer: {} }), 'AUTHORIZER_OVERRIDE_FORBIDDEN'),
    avdWithAuthorityRefused: await rejects(() => startRenderStateful({ publicOrigin, enableAvdSimulation: true, historyAuthority: {} }), 'HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN'),
    testOnlyRefused: await rejects(() => assertHistoryAuthorizerDeployable({ testOnly: true }, { host: '127.0.0.1', env: { RENDER: 'true' } }), 'TEST_HISTORY_AUTHORIZER_FORBIDDEN'),
    reservedIssuerRefused: await rejects(() => assertHistoryAuthorizerDeployable({ issuer: 'https://a.fixture.invalid/' }, { host: '0.0.0.0', env: {} }), 'TEST_HISTORY_AUTHORIZER_FORBIDDEN'),
  };
  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k);
  return failed.length ? check('UNVERIFIED_AUTHORITY_BLOCKED', 'FAIL', failed.join(', ')) : check('UNVERIFIED_AUTHORITY_BLOCKED', 'PASS', 'override, AVD+authority, testOnly and reserved issuers are refused at startup');
}

export function credentialSeparationGate(root = REPO_ROOT) {
  const problems = [];
  if (new Set([HISTORY_READ_SCOPE, CREATE_SCOPE]).size !== 2) problems.push('read and creation scope are equal');
  if (AVD_CREATE_SCOPE !== CREATE_SCOPE || AVD_CREATE_SCOPE === HISTORY_READ_SCOPE) problems.push('AVD grant scope is not creation-only');
  if (!AVD_AUDIENCE.includes('avd-simulator')) problems.push('AVD audience is not labelled as simulator');
  let tracked = null;
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).split('\0');
  } catch { /* Reported below: an unreadable index must not read as clean. */ }
  if (tracked === null) return check('TEST_PROD_CREDENTIAL_SEPARATION', problems.length ? 'FAIL' : 'NOT_RUN', problems.join('; ') || 'git index unavailable');
  const secretFile = /(^|\/)\.env(\.|$)|\.(key|p12|pfx|jks|keystore)$|(^|\/)avd-enrollment[^/]*\.json$|(^|\/)pg-url/i;
  problems.push(...tracked.filter((f) => secretFile.test(f)).map((f) => 'tracked secret-like file: ' + f));
  return problems.length ? check('TEST_PROD_CREDENTIAL_SEPARATION', 'FAIL', problems.join('; ')) : check('TEST_PROD_CREDENTIAL_SEPARATION', 'PASS', 'scopes distinct, AVD grants are creation-only, no secret-like file tracked');
}

function runEntry(env, entry = ENTRY) {
  const ownPlatform = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(TOOL_ROOT, entry)], { env: { ...ownPlatform, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (x) => (output += x));
    child.stderr.on('data', (x) => (output += x));
    const timer = setTimeout(() => { child.kill(); done({ code: 'TIMEOUT', output }); }, 30_000);
    child.on('close', (code) => { clearTimeout(timer); done({ code, output: output.trim() }); });
  });
}

/** A stand-in for PostgreSQL that drops every connection and counts them. */
function countingDatabase() {
  let connections = 0;
  const server = net.createServer((socket) => { connections++; socket.on('error', () => {}); socket.destroy(); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      connections: () => connections,
      stop: () => new Promise((done) => server.close(done)),
    }));
  });
}

/**
 * Starts the real Render CLI with each unsafe configuration. All startup failures print the same sanitized line, so
 * the line alone cannot tell a refusal from a failed connection: a refused configuration must also never reach the
 * database. The control case proves the counter works whenever the driver is installed.
 */
export async function cliRefusalGate() {
  const secret = randomBytes(18).toString('hex');
  const db = await countingDatabase();
  try {
    const url = `postgresql://preflight:${secret}@127.0.0.1:${db.port}/preflight`;
    const valid = { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://preflight.example', PORT: '1', DATABASE_URL: url };
    const without = (key) => Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
    const cases = {
      ...Object.fromEntries(FORBIDDEN_RENDER_ENV.map((k) => [k, { ...valid, [k]: '1' }])),
      TLS_VERIFY_DISABLED: { ...valid, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      AVD_MODE_NOT_EXACT: { ...valid, CARSCOPE_AVD_SIMULATOR_MODE: 'ENABLED' },
      NOT_ON_RENDER: without('RENDER'),
      NO_PUBLIC_ORIGIN: without('RENDER_EXTERNAL_URL'),
      NO_DATABASE: without('DATABASE_URL'),
      URL_WITH_QUERY: { ...valid, DATABASE_URL: url + '?sslmode=disable' },
    };
    const sanitized = (r) => r.code === 1 && r.output === 'RENDER_STATEFUL_CONFIGURATION_FAILED' && !r.output.includes(secret);
    const wrong = [];
    for (const [name, env] of Object.entries(cases)) {
      const before = db.connections();
      const r = await runEntry(env);
      if (!sanitized(r) || db.connections() !== before) wrong.push(name);
    }
    const before = db.connections();
    const control = await runEntry(valid);
    if (!sanitized(control)) wrong.push('DATABASE_UNREACHABLE');
    const driver = await import('pg').then(() => true, () => false);
    if (driver && db.connections() === before) wrong.push('CONTROL_NEVER_CONNECTED');
    const counted = driver ? 'and never reach the database' : '(pg driver absent: database contact not observed)';
    return wrong.length
      ? check('RENDER_CLI_REFUSES_UNSAFE_CONFIG', 'FAIL', wrong.join(', '))
      : check('RENDER_CLI_REFUSES_UNSAFE_CONFIG', 'PASS', `${Object.keys(cases).length} unsafe configurations exit 1 with one sanitized line ${counted}`);
  } finally {
    await db.stop();
  }
}

/** The demonstration entrypoint inherits every refusal, and without simulator mode it also stops before the database. */
export async function avdHistoryDemoRefusalGate() {
  const secret = randomBytes(18).toString('hex');
  const db = await countingDatabase();
  try {
    const url = `postgresql://preflight:${secret}@127.0.0.1:${db.port}/preflight`;
    const valid = { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://preflight.example', PORT: '1', DATABASE_URL: url };
    const cases = {
      NO_SIMULATOR_MODE: valid,
      AVD_MODE_NOT_EXACT: { ...valid, CARSCOPE_AVD_SIMULATOR_MODE: 'ENABLED' },
      TLS_VERIFY_DISABLED: { ...valid, CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      ...Object.fromEntries(FORBIDDEN_RENDER_ENV.map((k) => [k, { ...valid, CARSCOPE_AVD_SIMULATOR_MODE: 'OPERATOR_APPROVED', [k]: '1' }])),
    };
    const wrong = [];
    for (const [name, env] of Object.entries(cases)) {
      const before = db.connections();
      const r = await runEntry(env, AVD_HISTORY_DEMO_ENTRY);
      if (r.code !== 1 || r.output !== 'RENDER_STATEFUL_CONFIGURATION_FAILED' || db.connections() !== before) wrong.push(name);
    }
    return wrong.length
      ? check('AVD_HISTORY_DEMO_REFUSES_UNSAFE_CONFIG', 'FAIL', wrong.join(', '))
      : check('AVD_HISTORY_DEMO_REFUSES_UNSAFE_CONFIG', 'PASS', `${Object.keys(cases).length} configurations exit 1 with one sanitized line and never reach the database`);
  } finally {
    await db.stop();
  }
}

export function productionAuthGate() {
  return check('PRODUCTION_AUTH_BLOCKED', 'BLOCKED', 'no trusted issuer, ownership registry, revocation service or service credential; see docs/p8-a2-history-auth.md');
}

export async function runStaticGates() {
  const gates = [
    ['DDL_ADDITIVE', () => ddlGate()],
    ['STARTUP_APPLIES_DDL', () => startupMigrationGate()],
    ['SYNC_TTL_CONTRACT', () => ttlGate()],
    ['HISTORY_TASK_ALLOWLIST', () => taskAllowlistGate()],
    ['SERVER_NOW_CONTRACT', () => serverClockGate()],
    ['HISTORY_DENY_DEFAULT', () => denyDefaultGate()],
    ['RENDER_BOOTSTRAP_DENY_DEFAULT', () => bootstrapGate()],
    ['ENV_CANNOT_ENABLE_AUTH', () => environmentGate()],
    ['AVD_HISTORY_DEMO_ENTRY_ONLY', () => avdHistoryDemoGate()],
    ['AVD_HISTORY_DEMO_REFUSES_UNSAFE_CONFIG', () => avdHistoryDemoRefusalGate()],
    ['WEBXR_EXPERIMENT_ENTRY_ONLY', () => webxrExperimentGate()],
    ['PART_DETECTION_OFF', () => partDetectionGate()],
    ['PART_ANALYSIS_OFF', () => partAnalysisGate()],
    ['VISION_EXPERIMENT_ENTRY_ONLY', () => visionExperimentGate()],
    ['UNVERIFIED_AUTHORITY_BLOCKED', () => unverifiedAuthorityGate()],
    ['RENDER_CLI_REFUSES_UNSAFE_CONFIG', () => cliRefusalGate()],
    ['TEST_PROD_CREDENTIAL_SEPARATION', () => credentialSeparationGate()],
    ['PRODUCTION_AUTH_BLOCKED', () => productionAuthGate()],
  ];
  const out = [];
  for (const [id, gate] of gates) out.push(await guarded(id, gate));
  return out;
}
