// Explicit Vision experiment Start Command. The existing Render entries and their environment stay untouched.
// Same PostgreSQL/session/credential primitives, same managed-edge guard, no new creation or history authority.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PostgreSQLSessionStore, PostgreSQLRateLimiter } from './postgres-store.mjs';
import { SessionService } from './sessions.mjs';
import { createSyncHandler } from './server.mjs';
import { ProductionSessionCreationAuthorizer } from './creation-authorizer.mjs';
import { AvdSimulatorCredentialStore } from './avd-simulator-credentials.mjs';
import { serveAvdSimulatorProvision } from './avd-simulator-http.mjs';
import { DEFAULT_RATES } from './rate-limit.mjs';
import { MOBILE_HEADERS, serveMobilePage } from './mobile-page.mjs';
import { httpsOrigin } from '../bin/host-readiness.mjs';
import { openRenderPool, renderEnvironment, stopOnSignal } from './render-stateful.mjs';
import { PostgreSQLVisionBudget } from './vision-budget.mjs';
import { experimentVisionProvider, experimentDetectionProvider, detectionEnvironment } from './vision-providers.mjs';
import { DETECTION_MODEL_ID } from '../../mobile-ar-poc/public/part-detection.mjs';
import { assertVisionProvider } from './part-analysis-route.mjs';
import { assertPrivateSchemaName } from './database-config.mjs';

export function visionEnvironment(env = process.env) {
  detectionEnvironment(env); // Refuse incomplete or misspelled detector approval before opening a database.
  assertPrivateSchemaName(env.CARSCOPE_DB_SCHEMA);
  const integer = value => typeof value === 'string' && /^[1-9][0-9]{0,6}$/.test(value) ? Number(value) : NaN;
  const daily = integer(env.CARSCOPE_VISION_DAILY_CALL_LIMIT), monthly = integer(env.CARSCOPE_VISION_MONTHLY_CALL_LIMIT);
  if (env.CARSCOPE_VISION_APPROVAL !== 'OPERATOR_APPROVED' || !env.OPENAI_API_KEY || !env.OPENAI_VISION_MODEL ||
      !Number.isSafeInteger(daily) || !Number.isSafeInteger(monthly) || daily > monthly || monthly > 1_000_000) throw new Error('VISION_OPERATOR_CONFIGURATION_REQUIRED');
  return { daily, monthly };
}

/** P13-G: DRAFT profiles need their own operator approval, on top of the vision approval. Absent or any other value: off. */
export const draftProfilesApproved = env => env.CARSCOPE_VISION_DRAFT_PROFILES === 'OPERATOR_APPROVED';

export async function startRenderVisionExperiment({ pool, publicOrigin, provider, budget, host = '127.0.0.1', port = 0,
  sweepMs = 30_000, expectedSchema = null, enableAvdSimulation = false, partDetection = null, allowDraftProfiles = false } = {}) {
  if (typeof allowDraftProfiles !== 'boolean') throw new Error('INVALID_VISION_EXPERIMENT_CONFIGURATION');
  const origin = httpsOrigin(publicOrigin);
  assertVisionProvider(provider);
  if (typeof budget?.initialize !== 'function' || typeof budget?.acquire !== 'function' || !Number.isSafeInteger(port) || port < 0 || port > 65535 || !Number.isSafeInteger(sweepMs) || sweepMs < 1000) throw new Error('INVALID_VISION_EXPERIMENT_CONFIG');
  const store = await PostgreSQLSessionStore.open({ pool, expectedSchema });
  let server, timer, stopping, sweep = Promise.resolve();
  try {
    await budget.initialize();
    const simStore = enableAvdSimulation ? new AvdSimulatorCredentialStore({ pool }) : null;
    if (simStore) await simStore.initialize();
    const service = new SessionService({ store });
    await service.sweep();
    const limiter = new PostgreSQLRateLimiter({ store, rates: { ...DEFAULT_RATES, 'avd-provision': { limit: 4, windowMs: 60_000 } } });
    const edgeSecure = req => req.headers.host === new URL(origin).host && req.headers['x-forwarded-proto'] === 'https' && (!req.headers.origin || req.headers.origin === origin);
    const api = createSyncHandler({ service, limiter, tls: true, log: () => {},
      authorizer: simStore || new ProductionSessionCreationAuthorizer(), trustedEdgeSecure: simStore ? edgeSecure : null,
      partDetection, partAnalysis: { provider, admission: budget, allowDraft: allowDraftProfiles } });
    server = http.createServer(async (req, res) => {
      const headers = { ...MOBILE_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' };
      try {
        if (req.method === 'GET' && req.url === '/healthz') {
          const reached = await pool.query('SELECT current_schema() AS name');
          if (expectedSchema !== null && reached.rows[0]?.name !== expectedSchema) throw new Error('DATABASE_SCHEMA_MISMATCH');
          res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'UP', mode: simStore ? 'STATEFUL_AVD_SIMULATION' : 'STATEFUL_DENY_DEFAULT',
            sessionCreation: simStore ? 'OPERATOR_APPROVED_AVD_ONLY' : 'DENIED', vision: 'EXPERIMENT', detection: partDetection ? 'EXPERIMENT' : 'OFF', draftProfiles: allowDraftProfiles ? 'OPERATOR_APPROVED' : 'OFF',
            ...(partDetection ? { detectionModel: DETECTION_MODEL_ID } : {}) })); return;
        }
        if (!edgeSecure(req)) { res.writeHead(403, headers); res.end(); return; }
        if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\') || req.url.includes('#') ||
            (req.url.includes('?') && new URL(req.url, origin).pathname !== '/v1/inspection-records')) { res.writeHead(400, headers); res.end(); return; }
        if (req.url === '/simulator/provision') {
          if (!simStore) { res.writeHead(404, headers); res.end(); return; }
          await serveAvdSimulatorProvision(req, res, { credentialStore: simStore, limiter, publicOrigin: origin }); return;
        }
        if (req.url.startsWith('/v1/')) { await api(req, res); return; }
        await serveMobilePage(req, res, { tls: true, partDetection: Boolean(partDetection), partAnalysis: provider.id, partAnalysisDraft: allowDraftProfiles });
      } catch {
        if (!res.headersSent) res.writeHead(req.url === '/healthz' ? 503 : 500, headers);
        res.end();
      }
    });
    server.headersTimeout = 10_000; server.requestTimeout = 15_000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    timer = setInterval(() => { sweep = sweep.then(async () => { await service.sweep(); if (simStore) await simStore.prune(); }).catch(() => {}); }, sweepMs); timer.unref();
    return { server, store, stop() { return stopping ??= (async () => { clearInterval(timer); await new Promise(resolve => server.close(resolve)); await sweep; await store.close(); })(); } };
  } catch (error) {
    clearInterval(timer);
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await store.close().catch(() => {}); throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let pool;
  try {
    const base = renderEnvironment(), limits = visionEnvironment();
    pool = await openRenderPool(base.connection);
    const budget = new PostgreSQLVisionBudget({ pool, ...limits, expectedSchema: base.expectedSchema });
    const provider = experimentVisionProvider({ env: process.env, budget });
    const detector = experimentDetectionProvider({ env: process.env, budget });
    const app = await startRenderVisionExperiment({ pool, provider, budget, publicOrigin: base.publicOrigin,
      partDetection: detector ? { provider: detector, admission: budget } : null,
      host: '0.0.0.0', port: base.port, expectedSchema: base.expectedSchema, enableAvdSimulation: base.enableAvdSimulation,
      allowDraftProfiles: draftProfilesApproved(process.env) });
    console.log('CarScope Vision experiment ready; detection=' + (detector ? 'EXPERIMENT' : 'OFF') + '; draftProfiles=' + (draftProfilesApproved(process.env) ? 'OPERATOR_APPROVED' : 'OFF') + '; existing session authority unchanged');
    stopOnSignal(app);
  } catch {
    if (pool) await pool.end().catch(() => {});
    console.error('VISION_EXPERIMENT_CONFIGURATION_FAILED'); process.exitCode = 1;
  }
}
