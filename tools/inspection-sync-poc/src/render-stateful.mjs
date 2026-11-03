// Stateful Render HTTP-behind-managed-HTTPS entrypoint. Authorization is intentionally DENIED.
// PostgreSQL is required: no memory fallback, no public fixture/test credential switch.
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

export async function startRenderStateful({ pool, publicOrigin, host = '127.0.0.1', port = 0, sweepMs = 30_000, enableAvdSimulation = false } = {}) {
  const origin = httpsOrigin(publicOrigin);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 ||
      !Number.isSafeInteger(sweepMs) || sweepMs < 1000) throw new Error('INVALID_RENDER_STATEFUL_CONFIG');
  // Startup must prove PostgreSQL availability and complete schema initialization before listening.
  const store = await PostgreSQLSessionStore.open({ pool });
  let server, timer, stopping, sweep = Promise.resolve();
  const simStore = enableAvdSimulation ? new AvdSimulatorCredentialStore({ pool }) : null;
  try {
    if (simStore) await simStore.initialize();
    const service = new SessionService({ store });
    await service.sweep();
    const limiter = new PostgreSQLRateLimiter({ store, rates: {
      ...DEFAULT_RATES, 'avd-provision': { limit: 4, windowMs: 60_000 },
    }});
    const api = createSyncHandler({
      service, limiter, tls: true, log: () => {},
      authorizer: simStore || new ProductionSessionCreationAuthorizer(),
    });
    server = http.createServer(async (req, res) => {
      const headers = { ...MOBILE_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' };
      try {
        if (req.method === 'GET' && req.url === '/healthz') {
          try {
            await pool.query('SELECT 1');
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({status:'UP',
              mode: simStore ? 'STATEFUL_AVD_SIMULATION' : 'STATEFUL_DENY_DEFAULT',
              sessionCreation: simStore ? 'OPERATOR_APPROVED_AVD_ONLY' : 'DENIED'}));
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
            req.url.includes('\\') || req.url.includes('#') || req.url.includes('?')) {
          res.writeHead(400, headers); res.end(); return;
        }
        if (req.url === '/simulator/provision') {
          if (!simStore) { res.writeHead(404,headers); res.end(); return; }
          await serveAvdSimulatorProvision(req,res,{credentialStore:simStore,limiter,publicOrigin:origin}); return;
        }
        if (req.url.startsWith('/v1/')) { await api(req, res); return; }
        await serveMobilePage(req, res, { tls: true });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let pool;
  try {
    if (process.env.RENDER !== 'true' || !process.env.RENDER_EXTERNAL_URL ||
        !process.env.DATABASE_URL || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
        ['SYNC_LOCAL_TEST_AUTH','SYNC_FIXTURE_TOKEN','SYNC_DEBUG_PAGE','SYNC_ALLOWED_ORIGIN']
          .some(k => process.env[k]) || (process.env.CARSCOPE_AVD_SIMULATOR_MODE &&
          process.env.CARSCOPE_AVD_SIMULATOR_MODE !== 'OPERATOR_APPROVED')) throw new Error('INVALID_RENDER_STATEFUL_CONFIG');
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgresql:','postgres:'].includes(url.protocol) || !url.hostname ||
        !url.username || !url.password || !url.pathname || url.pathname === '/' ||
        url.hash || url.search) throw new Error('INVALID_DATABASE_URL');
    const port = Number(process.env.PORT || 10000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000, allowExitOnIdle: false });
    // Prevent unhandled idle-connection failures from killing the process without a readiness report.
    pool.on('error', () => { /* Health checks fail closed if PostgreSQL is unavailable. */ });
    const app = await startRenderStateful({
      pool, publicOrigin: process.env.RENDER_EXTERNAL_URL, host: '0.0.0.0', port,
      enableAvdSimulation: process.env.CARSCOPE_AVD_SIMULATOR_MODE === 'OPERATOR_APPROVED',
    });
    console.log(process.env.CARSCOPE_AVD_SIMULATOR_MODE === 'OPERATOR_APPROVED'
      ? 'CarScope AVD simulation registry ready; OEM vehicle ownership NOT verified'
      : 'CarScope stateful PostgreSQL service ready; creation=DENIED');
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => app.stop().then(() => process.exit(0), () => process.exit(1)));
    }
  } catch {
    if (pool) await pool.end().catch(() => {});
    console.error('RENDER_STATEFUL_CONFIGURATION_FAILED'); process.exitCode = 1;
  }
}
