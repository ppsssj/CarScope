// Stateful Render HTTP-behind-managed-HTTPS entrypoint. Authorization is intentionally DENIED.
// PostgreSQL is required: no memory fallback, no public fixture/test credential switch.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PostgreSQLSessionStore, PostgreSQLRateLimiter } from './postgres-store.mjs';
import { SessionService } from './sessions.mjs';
import { createSyncHandler } from './server.mjs';
import { ProductionSessionCreationAuthorizer } from './creation-authorizer.mjs';
import { assertHistoryAuthorizerDeployable } from './history-authorizer.mjs';
import { httpsHistoryAuthorizer } from './https-history-authority.mjs';
import { AvdSimulatorCredentialStore } from './avd-simulator-credentials.mjs';
import { serveAvdSimulatorHistory, serveAvdSimulatorProvision, isAvdHistoryPath, isAvdHistoryQueryPath } from './avd-simulator-http.mjs';
import { AvdSimulatorHistoryService } from './history.mjs';
import { DEFAULT_RATES } from './rate-limit.mjs';
import { MOBILE_HEADERS, serveMobilePage } from './mobile-page.mjs';
import { httpsOrigin } from '../bin/host-readiness.mjs';
import { databasePoolOptions } from './database-config.mjs';

export async function startRenderStateful({ pool, publicOrigin, host = '127.0.0.1', port = 0, sweepMs = 30_000, enableAvdSimulation = false, enableAvdHistoryRead = false, historyAuthority, historyAuthorizer, expectedSchema = null, webxrGuide = false, partDetection = null } = {}) {
  const origin = httpsOrigin(publicOrigin);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 ||
      !Number.isSafeInteger(sweepMs) || sweepMs < 1000) throw new Error('INVALID_RENDER_STATEFUL_CONFIG');
  // History stays DENY_DEFAULT unless a reviewed bootstrap passes a fixed authority configuration in code.
  // No arbitrary authorizer object, and a simulated registry never shares a process with vehicle-owner reads.
  if (historyAuthorizer !== undefined) throw new Error('AUTHORIZER_OVERRIDE_FORBIDDEN');
  if (historyAuthority && enableAvdSimulation) throw new Error('HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN');
  // Debug reads are a part of simulation, never of an owner authority: the guard above still applies to them.
  // Code-only like historyAuthority. The default CLI below never sets it and no environment variable can:
  // only the separate render-avd-history-demo.mjs entrypoint does.
  if (enableAvdHistoryRead && !enableAvdSimulation) throw new Error('AVD_HISTORY_READ_REQUIRES_SIMULATION');
  // Code-only as well: page assets and one permission of the page, nothing about sessions or results. Only
  // render-webxr-experiment.mjs sets it, so the default CLI and every environment variable leave the guide off.
  if (typeof webxrGuide !== 'boolean') throw new Error('INVALID_RENDER_STATEFUL_CONFIG');
  const historyRead = historyAuthority ? httpsHistoryAuthorizer(historyAuthority) : null;
  if (historyRead) assertHistoryAuthorizerDeployable(historyRead, { host });
  // Startup must prove PostgreSQL availability and complete schema initialization before listening.
  const store = await PostgreSQLSessionStore.open({ pool, expectedSchema });
  let server, timer, stopping, sweep = Promise.resolve();
  const simStore = enableAvdSimulation ? new AvdSimulatorCredentialStore({ pool }) : null;
  try {
    if (simStore) await simStore.initialize();
    const service = new SessionService({ store });
    await service.sweep();
    const limiter = new PostgreSQLRateLimiter({ store, rates: {
      ...DEFAULT_RATES, 'avd-provision': { limit: 4, windowMs: 60_000 },
    }});
    const avdHistory = enableAvdHistoryRead ? new AvdSimulatorHistoryService({ store }) : null;
    const edgeSecure = req => req.headers.host === new URL(origin).host &&
      req.headers['x-forwarded-proto'] === 'https' &&
      (!req.headers.origin || req.headers.origin === origin);
    const api = createSyncHandler({
      service, limiter, tls: true, log: () => {},
      authorizer: simStore || new ProductionSessionCreationAuthorizer(),
      ...(historyRead ? { historyAuthorizer: historyRead } : {}),
      // Render-managed TLS is terminated at the ingress; this callback is opt-in only for the
      // explicitly enabled AVD simulation mode or a reviewed history authority. The outer request
      // handler rejects unverified Host / Origin / X-Forwarded-Proto first.
      trustedEdgeSecure: simStore || historyRead ? edgeSecure : null,
      partDetection,
    });
    server = http.createServer(async (req, res) => {
      const headers = { ...MOBILE_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' };
      try {
        if (req.method === 'GET' && req.url === '/healthz') {
          try {
            const reached = await pool.query('SELECT current_schema() AS name');
            if (expectedSchema !== null && reached.rows[0]?.name !== expectedSchema) throw new Error('DATABASE_SCHEMA_MISMATCH');
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({status:'UP',
              mode: simStore ? 'STATEFUL_AVD_SIMULATION' : 'STATEFUL_DENY_DEFAULT',
              sessionCreation: simStore ? 'OPERATOR_APPROVED_AVD_ONLY' : 'DENIED',
              ...(historyRead ? { historyRead: 'AUTHORITY_ADAPTER_CONFIGURED' } : {}),
              ...(avdHistory ? { historyRead: 'AVD_REGISTRATION_ONLY' } : {}),
              ...(webxrGuide ? { mobileGuide: 'WEBXR_EXPERIMENT' } : {})}));
          } catch {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end('{"status":"UNAVAILABLE"}');
          }
          return;
        }
        // Exact public origin; forwarded scheme is checked only within Render's own ingress boundary.
        // Headers NEVER enable session creation or select the credential authority.
        if (req.headers.host !== new URL(origin).host ||
            req.headers.origin && req.headers.origin !== origin ||
            req.headers['x-forwarded-proto'] !== 'https') {
          res.writeHead(403, headers); res.end(); return;
        }
        if (!req.url?.startsWith('/') || req.url.startsWith('//') ||
            req.url.includes('\\') || req.url.includes('#') || (req.url.includes('?') && new URL(req.url,origin).pathname!=='/v1/inspection-records' && !(avdHistory && isAvdHistoryQueryPath(new URL(req.url,origin).pathname)))) {
          res.writeHead(400, headers); res.end(); return;
        }
        if (req.url === '/simulator/provision') {
          if (!simStore) { res.writeHead(404,headers); res.end(); return; }
          await serveAvdSimulatorProvision(req,res,{credentialStore:simStore,limiter,publicOrigin:origin}); return;
        }
        if (avdHistory && isAvdHistoryPath(new URL(req.url,origin).pathname)) {
          await serveAvdSimulatorHistory(req,res,{credentialStore:simStore,history:avdHistory,limiter,secure:edgeSecure(req),publicOrigin:origin}); return;
        }
        if (req.url.startsWith('/v1/')) { await api(req, res); return; }
        await serveMobilePage(req, res, { tls: true, webxrGuide, partDetection: Boolean(partDetection) });
      } catch {
        if (!res.headersSent) res.writeHead(500, headers);
        res.end();
      }
    });
    server.headersTimeout = 10_000; server.requestTimeout = 15_000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    timer = setInterval(() => {
      sweep = sweep.then(async () => { await service.sweep(); if (simStore) await simStore.prune(); }).catch(() => { /* Fail closed, no body/token logging. */ });
    }, sweepMs); timer.unref();
    return {
      server, store,
      stop() {
        return stopping ??= (async () => {
          clearInterval(timer);
          await new Promise(resolve => server.close(resolve));
          await sweep;
          await store.close();
        })();
      },
    };
  } catch (e) {
    if (timer) clearInterval(timer);
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await store.close().catch(() => {});
    throw e;
  }
}

/** The one validation both entrypoints share. Throws before any database contact. */
export function renderEnvironment() {
    if (process.env.RENDER !== 'true' || !process.env.RENDER_EXTERNAL_URL ||
        !process.env.DATABASE_URL || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
        ['SYNC_LOCAL_TEST_AUTH','SYNC_FIXTURE_TOKEN','SYNC_DEBUG_PAGE','SYNC_ALLOWED_ORIGIN']
          .some(k => process.env[k]) || (process.env.CARSCOPE_AVD_SIMULATOR_MODE &&
          process.env.CARSCOPE_AVD_SIMULATOR_MODE !== 'OPERATOR_APPROVED')) throw new Error('INVALID_RENDER_STATEFUL_CONFIG');
    const { expectedSchema, ...connection } = databasePoolOptions({
      url: process.env.DATABASE_URL, caPemBase64: process.env.CARSCOPE_DB_CA_PEM_BASE64, schema: process.env.CARSCOPE_DB_SCHEMA,
    });
    const port = Number(process.env.PORT || 10000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
    return { connection, expectedSchema, port, publicOrigin: process.env.RENDER_EXTERNAL_URL,
      enableAvdSimulation: process.env.CARSCOPE_AVD_SIMULATOR_MODE === 'OPERATOR_APPROVED' };
}

export async function openRenderPool(connection) {
    const { Pool } = await import('pg');
    const pool = new Pool({ ...connection, max: 3,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000, allowExitOnIdle: false });
    // Prevent unhandled idle-connection failures from killing the process without a readiness report.
    pool.on('error', () => { /* Health checks fail closed if PostgreSQL is unavailable. */ });
    return pool;
}

export function stopOnSignal(app) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => app.stop().then(() => process.exit(0), () => process.exit(1)));
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let pool;
  try {
    const { connection, publicOrigin, port, expectedSchema, enableAvdSimulation } = renderEnvironment();
    pool = await openRenderPool(connection);
    const app = await startRenderStateful({
      pool, publicOrigin, host: '0.0.0.0', port, expectedSchema,
      enableAvdSimulation,
    });
    console.log(enableAvdSimulation
      ? 'CarScope AVD simulation registry ready; OEM vehicle ownership NOT verified'
      : 'CarScope stateful PostgreSQL service ready; creation=DENIED');
    stopOnSignal(app);
  } catch {
    if (pool) await pool.end().catch(() => {});
    console.error('RENDER_STATEFUL_CONFIGURATION_FAILED'); process.exitCode = 1;
  }
}
