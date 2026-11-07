// P12-B: real MediaPipe, real WASM, real TFLite in desktop Chrome, under the server's real CSP. Local only: the model is downloaded and not in Git.
// The model is EfficientDet-Lite0 trained on COCO. It knows nothing about washer caps, so these numbers measure the runtime only.
// They are not the target model's accuracy, latency or memory, and not a phone's.
//   CARSCOPE_VISION_MODEL=C:/.../efficientdet_lite0.tflite CARSCOPE_EVIDENCE_DIR=C:/CarScope-External/p12-b/... [CARSCOPE_VISION_SAMPLES="a.webp,b.png"] npm run measure:runtime
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATUS, TARGET_CLASS, interpretDetections } from '../src/detection-contract.mjs';
import { startServer } from '../server.mjs';

const { chromium } = createRequire(new URL('../../mobile-ar-poc/package.json', import.meta.url))('playwright');
const modelPath = process.env.CARSCOPE_VISION_MODEL, evidence = process.env.CARSCOPE_EVIDENCE_DIR;
if (!modelPath || !evidence || !path.resolve(evidence).toLowerCase().startsWith('c:\\carscope-external\\')) throw Error('Set CARSCOPE_VISION_MODEL and an external CARSCOPE_EVIDENCE_DIR');
await mkdir(evidence, { recursive: true });

const manifestPath = path.join(evidence, 'runtime-smoke-model.json'), sha256 = createHash('sha256').update(await readFile(modelPath)).digest('hex');
await writeFile(manifestPath, JSON.stringify({ modelId: 'efficientdet_lite0_int8_v1_coco', role: 'RUNTIME_SMOKE_ONLY', labels: ['COCO 80'], sha256 }));
const server = await startServer({ modelPath, manifestPath });
const browser = await chromium.launch({ channel: process.env.CARSCOPE_BROWSER_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } }), page = await context.newPage();
const errors = [], requests = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('request', r => requests.push(`${r.method()} ${r.url()}`));

await page.goto(`${server.url}/`);
await page.waitForFunction(() => document.body.dataset.ready === 'true');
assert.equal(await page.locator('#ai-status').getAttribute('data-status'), STATUS.MODEL_NOT_TARGET, 'the page itself refuses this model');

const browserVersion = browser.version();
const heap = async () => { const c = await context.newCDPSession(page); await c.send('Performance.enable'); await c.send('HeapProfiler.collectGarbage'); const { metrics } = await c.send('Performance.getMetrics'); await c.detach(); return Math.round(metrics.find(m => m.name === 'JSHeapUsedSize').value); };
const uaMemory = () => page.evaluate(async () => { if (!crossOriginIsolated || !performance.measureUserAgentSpecificMemory) return null; const m = await Promise.race([performance.measureUserAgentSpecificMemory(), new Promise(r => setTimeout(() => r(null), 60000))]); return m?.bytes ?? null; });
// The page APIs do not clearly include the WASM heap, so the renderers' combined working set is the figure to read. Windows only: elsewhere null.
const rendererWorkingSet = async () => {
  if (process.platform !== 'win32') return null;
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send('SystemInfo.getProcessInfo'); await session.detach();
  let total = 0;
  for (const { id } of processInfo.filter(p => p.type === 'renderer')) {
    const line = execFileSync('tasklist', ['/FI', `PID eq ${id}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    total += Number(line.trim().split('","').at(-1).replace(/\D/g, '')) * 1024 || 0;
  }
  return total || null;
};

const memoryBefore = await uaMemory(), heapBefore = await heap(), workingSetBefore = await rendererWorkingSet();
const timing = await page.evaluate(async () => {
  const stats = values => { const s = [...values].sort((a, b) => a - b); return { runs: s.length, medianMs: +s[Math.floor(s.length / 2)].toFixed(1), p95Ms: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(1), maxMs: +s.at(-1).toFixed(1) }; };
  const t0 = performance.now();
  const { createDetector } = await import('/detector-runtime.mjs');
  const detector = await createDetector({ scoreThreshold: 0.3, maxResults: 5 });
  window.__detector = detector;
  const load = performance.now() - t0;
  const sizes = {};
  for (const [width, height] of [[640, 480], [1280, 960], [1600, 1200]]) {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, width, height); g.addColorStop(0, '#223'); g.addColorStop(1, '#ccd'); x.fillStyle = g; x.fillRect(0, 0, width, height);
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 37} 60% ${30 + i}%)`; x.fillRect((i * 97) % width, (i * 61) % height, width / 10, height / 10); }
    const first = performance.now(); detector.detect(c); const cold = performance.now() - first;
    const warm = []; for (let i = 0; i < 30; i++) { const s = performance.now(); detector.detect(c); warm.push(performance.now() - s); }
    sizes[`${width}x${height}`] = { firstMs: +cold.toFixed(1), ...stats(warm) };
  }
  return { modelLoadMs: +load.toFixed(1), sizes, hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated };
});
const memoryAfter = await uaMemory(), heapAfter = await heap(), workingSetAfter = await rendererWorkingSet();

// Real pictures through the real model: shows what a generic model reports, and that the contract discards it.
const samples = [];
for (const file of (process.env.CARSCOPE_VISION_SAMPLES ?? '').split(',').filter(Boolean)) {
  const bytes = [...await readFile(file)];
  const raw = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0);
    const detections = window.__detector.detect(c);
    return { width: c.width, height: c.height, detections };
  }, bytes);
  const verdict = interpretDetections({ detections: raw.detections, imageWidth: raw.width, imageHeight: raw.height, scoreThreshold: 0.3 });
  assert.equal(verdict.status, STATUS.NO_DETECTION, file);
  assert.ok(!raw.detections.some(d => d.categories.some(c => c.categoryName === TARGET_CLASS)));
  samples.push({ file: path.basename(file), size: `${raw.width}x${raw.height}`, rawLabels: raw.detections.flatMap(d => d.categories.map(c => `${c.categoryName} ${c.score.toFixed(2)}`)), contract: verdict.status });
}
await browser.close();
await server.close();

assert.deepEqual(errors, [], 'page errors');
assert.deepEqual(requests.filter(r => !r.startsWith(`GET ${server.url}`) && !/ (blob|data):/.test(r)), [], 'only GET to this server');
const result = {
  scope: 'DESKTOP_CHROME_CPU_DELEGATE_NON_TARGET_MODEL', targetModel: 'NOT_RUN', phone: 'NOT_RUN', browser: browserVersion,
  model: { id: 'efficientdet_lite0_int8_v1_coco', bytes: (await stat(modelPath)).size, sha256 },
  ...timing, jsHeapBytes: { before: heapBefore, after: heapAfter },
  userAgentMemoryBytes: { before: memoryBefore, after: memoryAfter }, rendererWorkingSetBytes: { before: workingSetBefore, after: workingSetAfter }, samples,
};
await writeFile(path.join(evidence, 'runtime-smoke.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
