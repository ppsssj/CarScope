// One HTTPS listener, one SessionService, one durable store. No proxy or test-auth CLI switch.
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { SQLiteSessionStore, SQLiteRateLimiter } from './sqlite-store.mjs';
import { SessionService } from './sessions.mjs';
import { createSyncHandler } from './server.mjs';
import { ProductionSessionCreationAuthorizer } from './creation-authorizer.mjs';
import { MOBILE_HEADERS, serveMobilePage } from './mobile-page.mjs';
import { httpsOrigin } from '../bin/host-readiness.mjs';

export async function startHttpsMobileService({ host = '127.0.0.1', port = 0, publicOrigin, tlsCert, tlsKey, databasePath,
  authorizer = new ProductionSessionCreationAuthorizer(), now = Date.now, limits, log = () => {}, sweepMs = 30_000 } = {}) {
  if (!tlsCert || !tlsKey || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('VALID_TLS_CONFIGURATION_REQUIRED');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || !Number.isSafeInteger(sweepMs) || sweepMs < 1) throw new Error('INVALID_SERVICE_CONFIGURATION');
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (!loopback && (authorizer.testOnly || !publicOrigin)) throw new Error('EXTERNAL_BIND_REQUIRES_ORIGIN_AND_NON_TEST_AUTHORIZER');
  const configuredOrigin = publicOrigin ? httpsOrigin(publicOrigin) : null;
  const [cert, key] = await Promise.all([readFile(tlsCert), readFile(tlsKey)]);
  const leaf = new X509Certificate(cert);
  const name = (configuredOrigin ? new URL(configuredOrigin).hostname : host).replace(/^\[|\]$/g, '');
  if (!leaf.subjectAltName || !(isIP(name) ? leaf.checkIP(name) : leaf.checkHost(name, { subject: 'never' })) ||
    Date.now() < Date.parse(leaf.validFrom) || Date.now() >= Date.parse(leaf.validTo)) throw new Error('TLS_LEAF_SAN_OR_VALIDITY_INVALID');
  const store = new SQLiteSessionStore({ filename: databasePath });
  let server, timer, stopping, sweep = Promise.resolve();
  try {
    const service = new SessionService({ store, now, limits }); await service.sweep();
    const limiter = new SQLiteRateLimiter({ store, now });
    const api = createSyncHandler({ service, limiter, authorizer, log, tls: true });
    let origin = configuredOrigin;
    server = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, async (req, res) => {
      const headers = { ...MOBILE_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' };
      try {
        // Direct TLS only. Ignore all Forwarded/X-Forwarded-* trust/identity headers.
        if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403, headers); res.end(); return; }
        if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) { res.writeHead(400, headers); res.end(); return; }
        const url = new URL(req.url, origin);
        if (url.pathname.startsWith('/v1/')) { await api(req, res); return; }
        for (const cls of ['client', 'static']) {
          const rate = await limiter.check(req.socket.remoteAddress ?? 'unknown', cls);
          if (!rate.ok) { res.writeHead(429, { ...headers, 'Retry-After': String(rate.retryAfterS) }); res.end(); return; }
        }
        await serveMobilePage(req, res, { tls: true });
      } catch { if (!res.headersSent) res.writeHead(500, headers); res.end(); }
    });
    server.headersTimeout = 10_000; server.requestTimeout = 15_000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    origin ??= `https://${host === '::1' ? '[::1]' : host}:${server.address().port}`;
    timer = setInterval(() => { sweep = sweep.then(() => service.sweep()).catch(() => log('housekeeping failed')); }, sweepMs); timer.unref();
    return { server, store, service, url: origin,
      stop() {
        return stopping ??= (async () => { clearInterval(timer); await new Promise((resolve) => server.close(resolve)); await sweep; store.close(); })();
      } };
  } catch { clearInterval(timer); if (server?.listening) await new Promise((resolve) => server.close(resolve)); store.close(); throw new Error('HTTPS_SERVICE_START_FAILED'); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let service;
  try {
    if (process.env.SYNC_LOCAL_TEST_AUTH || process.env.SYNC_FIXTURE_TOKEN || process.env.SYNC_DEBUG_PAGE || process.env.SYNC_ALLOWED_ORIGIN) throw new Error();
    service = await startHttpsMobileService({ host: process.env.SYNC_HOST || '127.0.0.1', port: Number(process.env.SYNC_PORT || 4183),
      publicOrigin: process.env.SYNC_PUBLIC_ORIGIN, tlsCert: process.env.SYNC_TLS_CERT, tlsKey: process.env.SYNC_TLS_KEY, databasePath: process.env.SYNC_DB_PATH });
    console.log('HTTPS mobile/API service ready; store=sqlite-single-host; creation=DENIED');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.stop().then(() => process.exit(0), () => process.exit(1)); });
  } catch { console.error('HTTPS_SERVICE_CONFIGURATION_FAILED'); process.exitCode = 1; }
}
