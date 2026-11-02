// Shared allow-list for the loopback dev server and the HTTPS same-origin service.
import { readFile } from 'node:fs/promises';
const mobileFiles = ['app.mjs', 'handoff.mjs', 'camera.mjs', 'detector.mjs', 'self-inspection.mjs', 'inspection-result.mjs', 'marker.mjs'];
const syncFiles = ['mobile-dev-entry.mjs', 'mobile-handoff.mjs', 'mobile-sync.mjs', 'sync-client.mjs'];
const files = new Map([
  ...mobileFiles.map((s) => [`/mobile-ar-poc/public/${s}`, new URL(`../../mobile-ar-poc/public/${s}`, import.meta.url)]),
  ...syncFiles.map((s) => [`/public/${s}`, new URL(`../public/${s}`, import.meta.url)]),
  ['/src/protocol.mjs', new URL('./protocol.mjs', import.meta.url)],
  ['/style.css', new URL('../../mobile-ar-poc/public/style.css', import.meta.url)],
  ['/favicon.svg', new URL('../../mobile-ar-poc/public/favicon.svg', import.meta.url)],
]);
export const MOBILE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
});
export async function serveMobilePage(req, res, { tls = false } = {}) {
  const headers = { ...MOBILE_HEADERS, ...(tls ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };
  const url = new URL(req.url, 'http://localhost');
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
}
