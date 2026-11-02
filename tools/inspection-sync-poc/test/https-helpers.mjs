// Local test PKI only. Never imported by a server CLI or an APK; keys stay in OS temp.
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import https from 'node:https';

export function localPki() {
  const dir = mkdtempSync(path.join(tmpdir(), 'carscope-ar02b2d-'));
  const openssl = process.env.SYNC_OPENSSL || (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const run = (...args) => execFileSync(openssl, args, { cwd: dir, stdio: 'pipe' });
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=CarScope isolated E2E CA');
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=localhost');
  writeFileSync(path.join(dir, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '1', '-extfile', 'ext.cnf');
  return { ca: readFileSync(path.join(dir, 'ca.pem')), tlsCert: path.join(dir, 'leaf.pem'), tlsKey: path.join(dir, 'leaf.key') };
}

// Fetch-shaped adapter for the actual browser client in Node tests. Keep default chain + hostname checks.
// No redirect handling, hostname override, global trust mutation or insecure mode.
export function tlsFetch(ca) {
  return (url, init = {}) => new Promise((resolve, reject) => {
    const req = https.request(url, { ca, method: init.method, headers: init.headers, signal: init.signal }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400) { reject(new TypeError('Redirect rejected')); return; }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }));
      });
    });
    req.on('error', reject); req.end(init.body);
  });
}
