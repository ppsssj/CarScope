import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { httpsOrigin, probeHost } from '../bin/host-readiness.mjs';
import { localPki } from './https-helpers.mjs';

test('host readiness rejects credentials, cleartext, query, fragment, paths and unsafe ports before network', () => {
  for (const value of ['http://localhost', 'https://u:p@localhost', 'https://localhost?token=x', 'https://localhost/#invite=x', 'https://localhost/a/..', 'https://localhost:0', 'https://localhost:65536', 'https://localhost\\evil', 'https://localhost\n', undefined]) assert.throws(() => httpsOrigin(value));
  assert.equal(httpsOrigin('https://localhost:443/'), 'https://localhost');
});

test('host readiness verifies actual TLS plus both API paths and v2 surface; never promotes device/auth gates', async (t) => {
  const pki = localPki(); let mode = 'valid'; const requests = [];
  t.after(() => pki.cleanup());
  const server = https.createServer({ cert: readFileSync(pki.tlsCert), key: readFileSync(pki.tlsKey) }, (req, res) => {
    requests.push({ method: req.method, auth: req.headers.authorization });
    if (mode === 'redirect') { res.writeHead(302, { Location: '/target' }); res.end(); return; }
    if (req.url.startsWith('/v1/')) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"code":"UNAUTHORIZED"}}'); }
    else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; connect-src 'self'" });
      res.end(mode === 'static-v1' ? '<script src="/app-entry.mjs"></script>' : '<script src="/public/mobile-dev-entry.mjs"></script>');
    } else { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('import { takeMobileHandoff } from "./mobile-handoff.mjs";'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `https://127.0.0.1:${server.address().port}`;
  const check = (ca = pki.ca) => probeHost({ apiOrigin: origin, mobileRoot: origin, ca });
  const report = await check();
  assert.equal(report.hostStatus, 'PASS'); assert.equal(report.creationAuthorization, 'BLOCKED');
  assert.equal(report.androidTls, 'NOT_RUN'); assert.equal(report.opticalQr, 'NOT_RUN');
  assert.equal((await check(null)).hostStatus, 'FAIL', 'untrusted CA never accepted');
  mode = 'static-v1'; assert.equal((await check()).mobileV2Surface, 'FAIL');
  mode = 'redirect'; assert.equal((await check()).hostStatus, 'FAIL');
  assert.ok(requests.every((r) => r.method === 'GET' && r.auth === undefined));
  assert.ok(!JSON.stringify(report).includes(origin), 'report omits endpoint strings and response bodies');
});
