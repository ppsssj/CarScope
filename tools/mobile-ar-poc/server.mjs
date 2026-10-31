import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { handoffURL } from './public/handoff.mjs';

const publicRoot = new URL('./public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['app.mjs', 'handoff.mjs', 'camera.mjs', 'detector.mjs'].map(name => [`/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);

export function createHandler(baseURL) {
  const target = baseURL ? handoffURL(baseURL) : null;
  return async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); res.end(); return; }
      const path = new URL(req.url, 'http://localhost').pathname;
      let body, type;
      if (path === '/handoff.json') {
        body = JSON.stringify({ url: target, configured: Boolean(target) }); type = 'application/json';
      } else if (path === '/qr.svg' && target) {
        body = await QRCode.toString(target, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 320 }); type = 'image/svg+xml';
      } else if (files.has(path)) {
        const [name, mime] = files.get(path);
        body = await readFile(new URL(name, publicRoot)); type = mime;
      } else { res.writeHead(404, headers); res.end('Not found'); return; }
      res.writeHead(200, { ...headers, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500, headers); res.end('Request failed'); }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { POC_BASE_URL, POC_TLS_CERT, POC_TLS_KEY } = process.env;
  if (Boolean(POC_TLS_CERT) !== Boolean(POC_TLS_KEY)) throw new Error('Set both POC_TLS_CERT and POC_TLS_KEY');
  const handler = createHandler(POC_BASE_URL);
  const server = POC_TLS_CERT ? https.createServer({ cert: await readFile(POC_TLS_CERT), key: await readFile(POC_TLS_KEY) }, handler) : http.createServer(handler);
  const host = process.env.POC_HOST || '127.0.0.1';
  const port = Number(process.env.POC_PORT || 4174);
  server.listen(port, host, () => console.log(`CarScope QR-AR-01: ${POC_TLS_CERT ? 'https' : 'http'}://${host}:${port}; QR ${POC_BASE_URL ? 'configured' : 'unconfigured'}`));
}
