// P12-B: local PoC server. Loopback only, read-only, no upload route, nothing stored. Not a deployment entry.
//   node server.mjs [port]
//   CARSCOPE_VISION_MODEL=C:/.../model.tflite CARSCOPE_VISION_MODEL_MANIFEST=C:/.../model.json node server.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(here, 'node_modules/@mediapipe/tasks-vision');
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm' };

// A fixed list: nothing else in the repository or on the disk can be read through this server.
export const ROUTES = Object.freeze({
  '/': path.join(here, 'public/index.html'),
  '/poc.mjs': path.join(here, 'public/poc.mjs'),
  '/poc.css': path.join(here, 'public/poc.css'),
  '/detector-runtime.mjs': path.join(here, 'public/detector-runtime.mjs'),
  '/contract/detection-contract.mjs': path.join(here, 'src/detection-contract.mjs'),
  '/baseline/detector.mjs': path.join(here, '../mobile-ar-poc/public/detector.mjs'),
  '/vendor/vision_bundle.mjs': path.join(vendor, 'vision_bundle.mjs'),
  '/vendor/wasm/vision_wasm_internal.js': path.join(vendor, 'wasm/vision_wasm_internal.js'),
  '/vendor/wasm/vision_wasm_internal.wasm': path.join(vendor, 'wasm/vision_wasm_internal.wasm'),
});

export const HEADERS = Object.freeze({
  // connect-src self: the page can only reach this server, and this server accepts no writes.
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src blob: data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin', // With COEP this allows performance.measureUserAgentSpecificMemory().
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', // First goal is a chosen photo, not a camera stream.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
});

async function modelFiles(modelPath, manifestPath) {
  if (!modelPath || !manifestPath) return null;
  const [model, text] = await Promise.all([readFile(modelPath), readFile(manifestPath, 'utf8')]);
  const manifest = JSON.parse(text);
  if (createHash('sha256').update(model).digest('hex') !== manifest.sha256) throw new Error('MODEL_SHA256_MISMATCH');
  return { model, manifest: JSON.stringify(manifest) };
}

export async function startServer({ port = 0, modelPath = process.env.CARSCOPE_VISION_MODEL, manifestPath = process.env.CARSCOPE_VISION_MODEL_MANIFEST } = {}) {
  const loaded = await modelFiles(modelPath, manifestPath);
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => { response.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra }); response.end(request.method === 'HEAD' ? undefined : body); };
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Read-only', undefined, { Allow: 'GET, HEAD' });
    const pathname = new URL(request.url, 'http://local').pathname;
    if (pathname === '/model.json') return loaded ? send(200, loaded.manifest, 'application/json') : send(404, 'No model configured');
    if (pathname === '/model.tflite') return loaded ? send(200, loaded.model, 'application/octet-stream') : send(404, 'No model configured');
    const file = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : null;
    if (!file) return send(404, 'Not found');
    try { send(200, await readFile(file), TYPES[path.extname(file)]); } catch { send(500, 'Unavailable'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ port: Number(process.argv[2] ?? 8199) });
  console.log(`Vision PoC on ${url}`);
}
