// AR-02A local sync server (PoC). Node built-ins only. Binds to loopback by default; a non-loopback bind requires TLS.
// It is NOT a deployable service: the session store is in memory, session creation is limited to loopback callers
// (stand-in for real vehicle authentication, AR-02B), and there is no public endpoint.
//
//   POST /v1/sessions                    create (loopback only)        body { taskId }
//   GET  /v1/sessions/:id                receiver view                 Authorization: Bearer <receiverToken>
//   POST /v1/sessions/:id/accept         receiver accepts              Authorization: Bearer <receiverToken>  body { resultDigest }
//   POST /v1/sessions/:id/cancel         receiver cancels              Authorization: Bearer <receiverToken>
//   POST /v1/claim                       phone exchanges the invite    Authorization: Bearer <inviteToken>
//   POST /v1/submissions                 phone submits the result      Authorization: Bearer <submitToken>    body envelope
//   GET  /v1/submissions/status          phone polls its session state Authorization: Bearer <submitToken>
// Tokens travel only in the Authorization header (never in URLs) and are never logged or echoed.
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ERRORS } from './protocol.mjs';
import { SessionService, SyncError } from './sessions.mjs';
import { MemorySessionStore } from './session-store.mjs';
import { RateLimiter } from './rate-limit.mjs';

export const MAX_BODY_BYTES = 16 * 1024;
const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Debug page files (served only when debugPage is on). Paths mirror the module layout so relative imports resolve.
const root = new URL('../', import.meta.url);
const STATIC = new Map([
  ['/debug', ['public/debug.html', 'text/html; charset=utf-8']],
  ['/public/debug.mjs', ['public/debug.mjs', 'text/javascript; charset=utf-8']],
  ['/public/debug.css', ['public/debug.css', 'text/css; charset=utf-8']],
  ['/public/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/public/sync-client.mjs', ['public/sync-client.mjs', 'text/javascript; charset=utf-8']],
  ['/src/protocol.mjs', ['src/protocol.mjs', 'text/javascript; charset=utf-8']],
  ['/mobile-ar-poc/public/inspection-result.mjs', ['../mobile-ar-poc/public/inspection-result.mjs', 'text/javascript; charset=utf-8']],
]);

const ROUTES = [
  ['POST', /^\/v1\/sessions$/, 'create', 'POST /v1/sessions'],
  ['GET', /^\/v1\/sessions\/([0-9a-f-]{36})$/, 'read', 'GET /v1/sessions/:id'],
  ['POST', /^\/v1\/sessions\/([0-9a-f-]{36})\/accept$/, 'read', 'POST /v1/sessions/:id/accept'],
  ['POST', /^\/v1\/sessions\/([0-9a-f-]{36})\/cancel$/, 'read', 'POST /v1/sessions/:id/cancel'],
  ['POST', /^\/v1\/claim$/, 'claim', 'POST /v1/claim'],
  ['POST', /^\/v1\/submissions$/, 'submit', 'POST /v1/submissions'],
  ['GET', /^\/v1\/submissions\/status$/, 'read', 'GET /v1/submissions/status'],
];

function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

async function readJson(req) {
  if (!/^application\/json(;|$)/i.test(req.headers['content-type'] ?? '')) throw new SyncError(ERRORS.UNSUPPORTED_MEDIA_TYPE, 415);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new SyncError(ERRORS.PAYLOAD_TOO_LARGE, 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new SyncError(ERRORS.PAYLOAD_TOO_LARGE, 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SyncError(ERRORS.BAD_REQUEST, 400); }
}

/**
 * @param {object} o
 * @param {SessionService} o.service
 * @param {RateLimiter} [o.limiter]
 * @param {(line:string)=>void} [o.log]   request log: method, route template, status, duration. No tokens, no bodies.
 * @param {string|null} [o.allowedOrigin] exact origin allowed for cross-origin calls (CORS); null = same-origin only
 * @param {boolean} [o.debugPage]         serve the debug page and its modules
 * @param {boolean} [o.tls]               add HSTS when served over TLS
 */
export function createSyncHandler({ service, limiter = new RateLimiter(), log = () => {}, allowedOrigin = null, debugPage = false, tls = false }) {
  return async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    let routeName = `${req.method} (unmatched)`, status = 500;
    const headers = { ...API_HEADERS, ...(tls ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };
    const origin = req.headers.origin;
    if (allowedOrigin && origin === allowedOrigin) Object.assign(headers, { 'Access-Control-Allow-Origin': allowedOrigin, Vary: 'Origin' });
    const send = (code, body) => { status = code; res.writeHead(code, headers); res.end(body === undefined ? undefined : JSON.stringify(body)); };
    try {
      const client = req.socket.remoteAddress ?? 'unknown';
      if (req.method === 'OPTIONS') {
        if (!(allowedOrigin && origin === allowedOrigin)) { routeName = 'OPTIONS (preflight)'; send(403, { error: { code: ERRORS.FORBIDDEN } }); return; }
        Object.assign(headers, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
        routeName = 'OPTIONS (preflight)'; send(204); return;
      }
      if (debugPage && req.method === 'GET' && STATIC.has(url.pathname)) {
        routeName = `GET ${url.pathname}`;
        const rl = limiter.check(client, 'static');
        if (!rl.ok) { headers['Retry-After'] = String(rl.retryAfterS); send(429, { error: { code: ERRORS.RATE_LIMITED } }); return; }
        const [file, type] = STATIC.get(url.pathname);
        const body = await readFile(new URL(file, root));
        status = 200;
        res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Security-Policy': PAGE_CSP });
        res.end(body);
        return;
      }
      const route = ROUTES.find(([m, re]) => re.test(url.pathname) && (m === req.method));
      if (!route) {
        routeName = `${req.method} (unmatched)`;
        send(ROUTES.some(([, re]) => re.test(url.pathname)) ? 405 : 404, { error: { code: ROUTES.some(([, re]) => re.test(url.pathname)) ? ERRORS.BAD_REQUEST : ERRORS.NOT_FOUND } });
        return;
      }
      const [, re, cls, name] = route;
      routeName = name;
      if (url.search) throw new SyncError(ERRORS.BAD_REQUEST, 400); // nothing travels in query strings
      const rl = limiter.check(client, cls);
      if (!rl.ok) { headers['Retry-After'] = String(rl.retryAfterS); send(429, { error: { code: ERRORS.RATE_LIMITED } }); return; }
      const id = re.exec(url.pathname)[1];
      switch (name) {
        case 'POST /v1/sessions': {
          if (!LOOPBACK.has(client)) throw new SyncError(ERRORS.FORBIDDEN, 403); // vehicle auth is AR-02B
          const body = await readJson(req);
          send(201, await service.create({ taskId: body.taskId }));
          return;
        }
        case 'GET /v1/sessions/:id': send(200, await service.view(id, bearer(req))); return;
        case 'POST /v1/sessions/:id/accept': { const body = await readJson(req); send(200, await service.accept(id, bearer(req), body.resultDigest)); return; }
        case 'POST /v1/sessions/:id/cancel': send(200, await service.cancel(id, bearer(req))); return;
        case 'POST /v1/claim': send(200, await service.claim(bearer(req))); return;
        case 'POST /v1/submissions': {
          const token = bearer(req);
          const body = await readJson(req);
          const { receipt, duplicate } = await service.submit(token, body);
          send(duplicate ? 200 : 201, { receipt, duplicate });
          return;
        }
        case 'GET /v1/submissions/status': send(200, await service.status(bearer(req))); return;
      }
    } catch (error) {
      if (error instanceof SyncError) send(error.status, { error: { code: error.code } });
      else { send(500, { error: { code: ERRORS.INTERNAL } }); log(`internal error ${error?.name ?? 'Error'}`); }
    } finally {
      log(`${routeName} ${status} ${Date.now() - started}ms`);
    }
  };
}

/** Start a server; returns { server, service, stop }. */
export async function startSyncServer({ host = '127.0.0.1', port = 4180, store = new MemorySessionStore(), now, limits, rates, tlsCert, tlsKey, allowedOrigin = null, debugPage = false, log = console.log, sweepMs = 30_000 } = {}) {
  const loopbackHost = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (!loopbackHost && !(tlsCert && tlsKey)) throw new Error('Refusing a non-loopback bind without TLS (set SYNC_TLS_CERT and SYNC_TLS_KEY)');
  const service = new SessionService({ store, now, limits });
  const handler = createSyncHandler({ service, limiter: new RateLimiter({ rates, now }), log, allowedOrigin, debugPage, tls: Boolean(tlsCert) });
  const server = tlsCert ? https.createServer({ cert: await readFile(tlsCert), key: await readFile(tlsKey) }, handler) : http.createServer(handler);
  server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  await new Promise((resolve) => server.listen(port, host, resolve));
  const timer = setInterval(() => service.sweep().catch(() => {}), sweepMs); timer.unref();
  return { server, service, store, url: `${tlsCert ? 'https' : 'http'}://${host === '::1' ? '[::1]' : host}:${server.address().port}`, stop: () => { clearInterval(timer); return new Promise((r) => server.close(r)); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { SYNC_HOST, SYNC_PORT, SYNC_TLS_CERT, SYNC_TLS_KEY, SYNC_ALLOWED_ORIGIN, SYNC_DEBUG_PAGE } = process.env;
  const s = await startSyncServer({ host: SYNC_HOST || '127.0.0.1', port: Number(SYNC_PORT || 4180), tlsCert: SYNC_TLS_CERT, tlsKey: SYNC_TLS_KEY,
    allowedOrigin: SYNC_ALLOWED_ORIGIN || null, debugPage: SYNC_DEBUG_PAGE === '1' });
  console.log(`inspection-sync PoC on ${s.url} · store=${s.store.kind} (sessions are lost on restart) · debug page ${SYNC_DEBUG_PAGE === '1' ? 'on at /debug' : 'off'}`);
}
