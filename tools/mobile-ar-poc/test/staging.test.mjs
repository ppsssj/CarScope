import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildStaging, PUBLIC_FILES } from '../staging/build.mjs';

const evidence = 'C:/CarScope-External/qr-ar-01/https-staging/build-tests';

test('static staging preserves exact public code and only emits expected files with the deployed QR origin', async () => {
  await mkdir(evidence, { recursive: true });
  const outputDirectory = await mkdtemp(path.join(evidence, 'run-'));
  const result = await buildStaging({ origin: 'https://carscope-test.vercel.app/', outputDirectory, revision: 'synthetic-revision' });
  assert.equal(result.url, 'https://carscope-test.vercel.app/#v=1&task=washer-fluid');
  assert.deepEqual((await readdir(outputDirectory)).sort(), [...PUBLIC_FILES, 'handoff.json', 'qr.svg', 'build-info.json'].sort());
  assert.ok(!(await readdir(outputDirectory)).some((name) => /sync|dev/.test(name)), 'development sync modules never enter static output');
  assert.ok(!(await readFile(path.join(outputDirectory, 'app-entry.mjs'), 'utf8')).includes('SyncClient'));
  assert.match(await readFile(path.join(outputDirectory, 'index.html'), 'utf8'), /src="\/app-entry.mjs"/);
  for (const name of PUBLIC_FILES) {
    assert.deepEqual(await readFile(path.join(outputDirectory, name)), await readFile(new URL(`../public/${name}`, import.meta.url)));
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDirectory, 'handoff.json'), 'utf8')), { configured: true, url: result.url });
  assert.match(await readFile(path.join(outputDirectory, 'qr.svg'), 'utf8'), /<svg/);
  assert.equal(JSON.parse(await readFile(path.join(outputDirectory, 'build-info.json'), 'utf8')).revision, 'synthetic-revision');
});

test('staging refuses unsafe origins before writing any artifacts', async () => {
  for (const origin of ['http://example.com/', 'https://user:secret@example.com/', 'https://example.com/?token=secret', 'https://example.com/path', 'https://localhost/', 'https://127.0.0.1/', 'https://test.localhost/']) {
    await assert.rejects(buildStaging({ origin, outputDirectory: path.join(evidence, 'must-not-create') }));
  }
});

test('static staging retains camera/privacy headers, and configuration only serves the build output', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'build/staging');
  const headers = Object.fromEntries(config.headers[0].headers.map(header => [header.key, header.value]));
  assert.equal(headers['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(headers['X-Robots-Tag'], /noindex/);
});
