// Render-only, fail-closed connectivity preflight.
// This is NOT the production sync service: it cannot issue sessions or preserve records.
// Render terminates client HTTPS at its edge and forwards HTTP privately to this listener.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { SessionService } from './sessions.mjs';
import { MemorySessionStore } from './session-store.mjs';
import { RateLimiter } from './rate-limit.mjs';
import { createSyncHandler } from './server.mjs';
import { ProductionSessionCreationAuthorizer } from './creation-authorizer.mjs';
import { MOBILE_HEADERS, serveMobilePage } from './mobile-page.mjs';
import { httpsOrigin } from '../bin/host-readiness.mjs';

export async function startRenderPreflight({ publicOrigin, host = '127.0.0.1', port = 0 } = {}) {
  const origin = httpsOrigin(publicOrigin);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT');
  // Never accept an injectable authorizer or a fixture switch in this entrypoint.
  const service = new SessionService({ store: new MemorySessionStore() });
  const api = createSyncHandler({
    service, limiter: new RateLimiter(),
    authorizer: new ProductionSessionCreationAuthorizer(), tls: true,
  });
  const server = http.createServer(async (req, res) => {
    const headers = { ...MOBILE_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' };
    try {
      // Render performs the internal health probe directly over HTTP.
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end('{"status":"UP","mode":"READ_ONLY_PREFLIGHT","sessionCreation":"DENIED"}');
        return;
      }
      // Check the exact public origin. The forwarded scheme comes from Render's ingress.
      // It is diagnostic only; no request can grant session-creation authorization.
      if (req.headers.host !== new URL(origin).host ||
          req.headers.origin && req.headers.origin !== origin ||
          req.headers['x-forwarded-proto'] !== 'https') {
        res.writeHead(403, headers); res.end(); return;
      }
      if (!req.url?.startsWith('/') || req.url.startsWith('//') ||
          req.url.includes('\\') || req.url.includes('#') || req.url.includes('?')) {
        res.writeHead(400, headers); res.end(); return;
      }
      if (req.url.startsWith('/v1/')) { await api(req, res); return; }
      await serveMobilePage(req, res, { tls: true });
    } catch {
      if (!res.headersSent) res.writeHead(500, headers);
      res.end();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  let stopping;
  return {
    server,
    stop() {
      return stopping ??= new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.RENDER !== 'true' || !process.env.RENDER_EXTERNAL_URL ||
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
        ['SYNC_LOCAL_TEST_AUTH','SYNC_FIXTURE_TOKEN','SYNC_DEBUG_PAGE','SYNC_ALLOWED_ORIGIN']
          .some(key => process.env[key])) throw new Error('INVALID_RENDER_PREFLIGHT_CONFIGURATION');
    const port = Number(process.env.PORT || 10000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
    const app = await startRenderPreflight({
      publicOrigin: process.env.RENDER_EXTERNAL_URL,
      host: '0.0.0.0', port,
    });
    console.log('CarScope Render preflight listening: session creation DENIED, no durable storage');
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => app.stop().then(() => process.exit(0), () => process.exit(1)));
    }
  } catch {
    console.error('RENDER_PREFLIGHT_CONFIGURATION_FAILED');
    process.exitCode = 1;
  }
}
