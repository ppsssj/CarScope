// Explicit local synthetic integration only. Both listeners bind 127.0.0.1; no host override or public TLS mode.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startSyncServer } from './server.mjs';
import { ProductionSessionCreationAuthorizer, LocalTestSessionCreationAuthorizer } from './creation-authorizer.mjs';

const mobileFiles = ['app.mjs', 'handoff.mjs', 'camera.mjs', 'detector.mjs', 'self-inspection.mjs', 'inspection-result.mjs', 'marker.mjs'];
const syncFiles = ['mobile-dev-entry.mjs', 'mobile-handoff.mjs', 'mobile-sync.mjs', 'sync-client.mjs'];
const files = new Map([
  ...mobileFiles.map((s) => [`/mobile-ar-poc/public/${s}`, new URL(`../../mobile-ar-poc/public/${s}`, import.meta.url)]),
  ...syncFiles.map((s) => [`/public/${s}`, new URL(`../public/${s}`, import.meta.url)]),
  ['/src/protocol.mjs', new URL('./protocol.mjs', import.meta.url)],
  ['/style.css', new URL('../../mobile-ar-poc/public/style.css', import.meta.url)],
  ['/favicon.svg', new URL('../../mobile-ar-poc/public/favicon.svg', import.meta.url)],
]);
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
export async function startMobileDevServer({ port = 0, store, now, limits, rates, authorizer = new ProductionSessionCreationAuthorizer(), log = () => {} } = {}) {
  let limiter;
  if (store?.rateCheck) { const { SQLiteRateLimiter } = await import('./sqlite-store.mjs'); limiter = new SQLiteRateLimiter({ store, now, rates }); }
  const api = await startSyncServer({ host: '127.0.0.1', port: 0, store, now, limits, rates, limiter, authorizer, log });
  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
        res.writeHead(403, headers); res.end(); return;
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/v1/')) {
        // Fixed internal target only. No target URL from a query/header/config delivered to the browser.
        const upstream = http.request(api.url + req.url, { method: req.method, headers: { ...req.headers, host: new URL(api.url).host } }, (response) => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, headers); res.end(); });
        req.on('aborted', () => upstream.destroy()); req.pipe(upstream); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
      if (url.search) { res.writeHead(400, headers); res.end(); return; }
      let body, type = 'text/javascript; charset=utf-8';
      if (url.pathname === '/') {
        body = (await readFile(new URL('../../mobile-ar-poc/public/index.html', import.meta.url), 'utf8')).replace('src="/app-entry.mjs"', 'src="/public/mobile-dev-entry.mjs"');
        type = 'text/html; charset=utf-8';
      } else if (url.pathname === '/handoff.json') { body = '{"configured":false,"url":null}'; type = 'application/json'; }
      else if (files.has(url.pathname)) {
        body = await readFile(files.get(url.pathname));
        if (url.pathname.endsWith('.css')) type = 'text/css; charset=utf-8';
        if (url.pathname.endsWith('.svg')) type = 'image/svg+xml';
      } else { res.writeHead(404, headers); res.end(); return; }
      res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { if (!res.headersSent) res.writeHead(500, headers); res.end(); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (e) { await api.stop(); throw e; }
  return { ...api, api, server, url: `http://127.0.0.1:${server.address().port}`,
    stop: async () => { await new Promise((r) => server.close(r)); await api.stop(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let store;
  if (process.env.SYNC_DB_PATH) {
    const { SQLiteSessionStore } = await import('./sqlite-store.mjs');
    store = new SQLiteSessionStore({ filename: process.env.SYNC_DB_PATH });
  }
  const s = await startMobileDevServer({ port: Number(process.env.SYNC_MOBILE_PORT || 4182), store,
    authorizer: process.env.SYNC_LOCAL_TEST_AUTH === '1' ? new LocalTestSessionCreationAuthorizer() : undefined });
  console.log(`Local synthetic mobile sync on ${s.url}; session creation ${process.env.SYNC_LOCAL_TEST_AUTH === '1' ? 'LOCAL TEST ONLY' : 'DENIED'}`);
}
