// Explicit local synthetic integration only. Both listeners bind 127.0.0.1; no host override or public TLS mode.
import http from 'node:http';
import { MOBILE_HEADERS as headers, serveMobilePage } from './mobile-page.mjs';
import { fileURLToPath } from 'node:url';
import { startSyncServer } from './server.mjs';
import { ProductionSessionCreationAuthorizer, LocalTestSessionCreationAuthorizer } from './creation-authorizer.mjs';
import { webxrGuideEnabled } from '../../mobile-ar-poc/webxr-flag.mjs';

export async function startMobileDevServer({ port = 0, store, now, limits, rates, authorizer = new ProductionSessionCreationAuthorizer(), log = () => {}, webxrGuide = false, partDetection = null, partAnalysis = null } = {}) {
  let limiter;
  if (store?.rateCheck) { const { SQLiteRateLimiter } = await import('./sqlite-store.mjs'); limiter = new SQLiteRateLimiter({ store, now, rates }); }
  const api = await startSyncServer({ host: '127.0.0.1', port: 0, store, now, limits, rates, limiter, authorizer, log, partDetection, partAnalysis });
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
        // A phone that cancels or leaves closes its side; the upstream request goes too, so the route sees it (P13-A).
        req.on('aborted', () => upstream.destroy()); res.on('close', () => { if (!res.writableFinished) upstream.destroy(); }); req.pipe(upstream); return;
      }
      await serveMobilePage(req, res, { webxrGuide, partDetection: Boolean(partDetection), partAnalysis: partAnalysis ? partAnalysis.provider.id : null });
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
  const s = await startMobileDevServer({ port: Number(process.env.SYNC_MOBILE_PORT || 4182), store, webxrGuide: webxrGuideEnabled(process.env, process.argv),
    authorizer: process.env.SYNC_LOCAL_TEST_AUTH === '1' ? new LocalTestSessionCreationAuthorizer() : undefined });
  console.log(`Local synthetic mobile sync on ${s.url}; session creation ${process.env.SYNC_LOCAL_TEST_AUTH === '1' ? 'LOCAL TEST ONLY' : 'DENIED'}`);
}
