import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HEADERS, ROUTES, startServer } from '../server.mjs';

const run = async (options, body) => { const s = await startServer(options); try { await body(s.url, s); } finally { await s.close(); } };

test('binds to loopback only', () => run({}, async (url, { server }) => { assert.equal(server.address().address, '127.0.0.1'); assert.match(url, /^http:\/\/127\.0\.0\.1:/); }));

test('no route accepts a write, so a photo has nowhere to go', () => run({}, async url => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${url}/`, { method, body: 'x' });
    assert.equal(response.status, 405, method);
  }
}));

test('only listed files are served: repository files and traversal are not', () => run({}, async url => {
  assert.equal((await fetch(`${url}/`)).status, 200);
  for (const route of ['/server.mjs', '/package.json', '/dataset/manifest.json', '/%2e%2e/%2e%2e/.gitignore', '/public/../server.mjs', '/constructor', '/vendor/LICENSE']) assert.equal((await fetch(url + route)).status, 404, route);
  assert.ok(Object.keys(ROUTES).every(route => !/model|dataset/.test(route)));
}));

test('security headers are on every response, and the camera stays off', () => run({}, async url => {
  for (const route of ['/', '/nothing', '/model.json']) {
    const { headers } = await fetch(url + route);
    for (const [name, value] of Object.entries(HEADERS)) assert.equal(headers.get(name), value, `${route} ${name}`);
  }
  assert.match(HEADERS['Permissions-Policy'], /camera=\(\)/);
  assert.doesNotMatch(HEADERS['Content-Security-Policy'], /https?:|'unsafe-inline'|'unsafe-eval'/);
}));

test('the runtime is served locally with the right wasm type: no CDN', () => run({}, async url => {
  const wasm = await fetch(`${url}/vendor/wasm/vision_wasm_internal.wasm`);
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  for (const file of ['public/poc.mjs', 'public/detector-runtime.mjs', 'public/index.html']) assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /https?:\/\//, file);
}));

test('without a model the model routes say so', () => run({ modelPath: '', manifestPath: '' }, async url => {
  assert.equal((await fetch(`${url}/model.json`)).status, 404);
  assert.equal((await fetch(`${url}/model.tflite`)).status, 404);
}));

test('a model must match the hash in its manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-model-'));
  try {
    const modelPath = path.join(dir, 'm.tflite'), manifestPath = path.join(dir, 'm.json');
    await writeFile(modelPath, 'model-bytes');
    await writeFile(manifestPath, JSON.stringify({ role: 'RUNTIME_SMOKE_ONLY', labels: ['car'], sha256: '0'.repeat(64) }));
    await assert.rejects(startServer({ modelPath, manifestPath }), /MODEL_SHA256_MISMATCH/);
    await writeFile(manifestPath, JSON.stringify({ role: 'RUNTIME_SMOKE_ONLY', labels: ['car'], sha256: createHash('sha256').update('model-bytes').digest('hex') }));
    await run({ modelPath, manifestPath }, async url => {
      assert.equal((await (await fetch(`${url}/model.json`)).json()).role, 'RUNTIME_SMOKE_ONLY');
      assert.equal(await (await fetch(`${url}/model.tflite`)).text(), 'model-bytes');
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('this PoC stays out of the mobile page and every deployment entry', async () => {
  const files = ['../../mobile-ar-poc/server.mjs', '../../mobile-ar-poc/public/app.mjs', '../../mobile-ar-poc/public/index.html', '../../mobile-ar-poc/public-modules.mjs', '../../mobile-ar-poc/webxr-modules.mjs', '../../inspection-sync-poc/src/mobile-page.mjs'];
  for (const file of files) assert.doesNotMatch(await readFile(new URL(file, import.meta.url), 'utf8'), /vision-poc|tasks-vision|mediapipe/i, file);
});

test('page text gives no inspection verdict and no instruction to open or refill', async () => {
  const text = (await Promise.all(['public/index.html', 'public/poc.mjs'].map(f => readFile(new URL(`../${f}`, import.meta.url), 'utf8')))).join('\n');
  for (const banned of ['점검 성공', '점검 완료', '정상입니다', '캡을 열어', '보충하세요', '보충하고', '넣으세요', '주입하세요', '인식했']) assert.ok(!text.includes(banned), banned);
  assert.match(text, /점검 결과가 아닙니다/);
  assert.match(text, /캡·덮개를 열지 마세요/);
  assert.match(text, /직접 보충하지 마세요/);
});
