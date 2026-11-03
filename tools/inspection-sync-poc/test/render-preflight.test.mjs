import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startRenderPreflight } from '../src/render-preflight.mjs';

const origin = 'https://carscope-preflight.onrender.com';
const hostname = new URL(origin).host;
function request(port, path, method = 'GET', extra = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: { Host: hostname, 'X-Forwarded-Proto': 'https', ...extra },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('Render preflight has HTTPS-origin guards, mobile surface, and a hard default-deny API', async t => {
  const app = await startRenderPreflight({ publicOrigin: origin });
  t.after(() => app.stop());
  const port = app.server.address().port;
  let response = await request(port, '/healthz', 'GET', {
    Host: '127.0.0.1', 'X-Forwarded-Proto': 'http',
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).sessionCreation, 'DENIED');
  response = await request(port, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /mobile-dev-entry\.mjs/);
  assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal(response.headers['strict-transport-security'], 'max-age=31536000');
  response = await request(port, '/v1/sessions/00000000-0000-4000-8000-000000000000');
  assert.equal(response.status, 401);
  response = await request(port, '/v1/sessions', 'POST', {
    Authorization: 'Bearer ' + 'a'.repeat(43),
    'Content-Type': 'application/json',
  });
  assert.equal(response.status, 403);
  response = await request(port, '/');
  assert.equal(response.status, 200, 'failed session creation did not disrupt mobile page');
  assert.equal((await request(port, '/', 'GET', { Host: 'evil.example' })).status, 403);
  assert.equal((await request(port, '/', 'GET', { 'X-Forwarded-Proto': 'http' })).status, 403);
  assert.equal((await request(port, '/', 'GET', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(port, '/?debug=1')).status, 400);
  assert.equal((await request(port, '/src/https-creation-authority.mjs')).status, 404);
  assert.equal((await request(port, '/test/authority-fixture.mjs')).status, 404);
});

test('Render preflight refuses missing or invalid public origin', async () => {
  await assert.rejects(startRenderPreflight({ publicOrigin: 'http://carscope.example' }));
  await assert.rejects(startRenderPreflight({ publicOrigin: 'https://user:pass@carscope.example/' }));
});
