#!/usr/bin/env node
// Runs the PostgreSQL suites on disposable Docker servers, one per major version, plus a 16 -> 17 restore.
// Each server takes TLS with a throwaway CA, and one role that is refused without TLS, like a server enforcing SSL.
// `run-pg-matrix.mjs --only <major> -- <node arguments>` runs one command against one such server instead of the suites.
// Nothing leaves this machine: no Supabase, no Render. Set PG_MATRIX_BIND=0.0.0.0 on Linux CI, where the client container
// reaches published ports through the bridge gateway.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../', import.meta.url));
const separator = process.argv.indexOf('--');
const only = process.argv[2] === '--only' ? Number(process.argv[3]) : null;
const custom = separator > 0 ? process.argv.slice(separator + 1) : null;
const MAJORS = only ? [only] : [16, 17];
const BIND = process.env.PG_MATRIX_BIND ?? '127.0.0.1';
const run = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26, ...options });

const CERTS = `set -e; cd /tmp
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -subj /CN=carscope-matrix-ca -days 2 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout wrong.key -out wrong.crt -subj /CN=carscope-matrix-wrong-ca -days 2 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj /CN=localhost 2>/dev/null
printf 'subjectAltName=DNS:localhost\\n' > san.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 2 -extfile san.cnf 2>/dev/null
tar c ca.crt wrong.crt server.crt server.key | base64 -w0`;
const SERVER = `set -e; mkdir -p /tls; echo "$TLS_BUNDLE" | base64 -d | tar x -C /tls
printf 'local all all trust\\nhostssl all carscope_tls all scram-sha-256\\nhostnossl all carscope_tls all reject\\nhost all all all scram-sha-256\\n' > /tls/pg_hba.conf
chown -R postgres /tls; chmod 600 /tls/server.key
exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c hba_file=/tls/pg_hba.conf`;

function certificates() {
  const r = run(['run', '--rm', 'postgres:16', 'sh', '-c', CERTS]);
  if (r.status !== 0 || !r.stdout) throw new Error('MATRIX_CERTIFICATES_FAILED');
  const bundle = r.stdout.trim();
  const read = (file) => {
    const c = run(['run', '--rm', '-e', 'TLS_BUNDLE', 'postgres:16', 'sh', '-c', `echo "$TLS_BUNDLE" | base64 -d | tar xO ${file}`], { env: { ...process.env, TLS_BUNDLE: bundle } });
    if (c.status !== 0) throw new Error('MATRIX_CERTIFICATES_FAILED');
    return Buffer.from(c.stdout).toString('base64');
  };
  return { bundle, ca: read('ca.crt'), wrongCa: read('wrong.crt') };
}

/** A fixed port: a port Docker picks changes on `docker start`, and the outage test would then read as no recovery. */
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer(major, certs) {
  const port = await freePort();
  const name = `carscope-matrix-pg${major}-${randomBytes(3).toString('hex')}`, password = randomBytes(24).toString('hex');
  const started = run(['run', '-d', '--name', name, '--memory', '768m', '-p', `${BIND}:${port}:5432`, '-e', 'POSTGRES_PASSWORD', '-e', 'TLS_BUNDLE', '-e', 'POSTGRES_USER=carscope_rehearsal', '-e', 'POSTGRES_DB=carscope_rehearsal_admin', '--entrypoint', 'sh', `postgres:${major}`, '-c', SERVER],
    { env: { ...process.env, POSTGRES_PASSWORD: password, TLS_BUNDLE: certs.bundle } });
  if (started.status !== 0) throw new Error('MATRIX_SERVER_FAILED');
  for (let i = 0; i < 60; i++) {
    if (run(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'carscope_rehearsal', '-d', 'carscope_rehearsal_admin']).status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (i === 59) throw new Error('MATRIX_SERVER_NOT_READY');
  }
  const tlsPassword = randomBytes(24).toString('hex');
  const psql = run(['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'carscope_rehearsal', '-d', 'carscope_rehearsal_admin'], { input: `CREATE ROLE carscope_tls LOGIN SUPERUSER PASSWORD '${tlsPassword}';` });
  if (psql.status !== 0) throw new Error('MATRIX_ROLE_FAILED');
  return {
    name, major, url: `postgresql://carscope_rehearsal:${password}@127.0.0.1:${port}/carscope_rehearsal_admin`,
    tlsUrl: `postgresql://carscope_tls:${tlsPassword}@localhost:${port}/carscope_rehearsal_admin`,
    tlsUrlByIp: `postgresql://carscope_tls:${tlsPassword}@127.0.0.1:${port}/carscope_rehearsal_admin`,
    plainUrlTlsRole: `postgresql://carscope_tls:${tlsPassword}@localhost:${port}/carscope_rehearsal_admin`,
  };
}

function runNode(args, env, redactions) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: TOOL, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const print = (chunk) => {
      let text = String(chunk);
      for (const secret of redactions) text = text.replaceAll(secret, '<REDACTED>');
      process.stdout.write(text);
    };
    child.stdout.on('data', print);
    child.stderr.on('data', print);
    child.on('close', done);
  });
}

const results = [];
const servers = [];
async function step(label, args, env, redactions) {
  console.log(`\n=== ${label} ===`);
  const code = await runNode(args, env, redactions);
  results.push([label, code]);
}

try {
  const certs = certificates();
  for (const major of MAJORS) servers.push(await startServer(major, certs));
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|DATABASE_URL|RENDER|CARSCOPE_)/.test(k)));
  const secretsOf = (s) => [new URL(s.url).password, new URL(s.tlsUrl).password];
  const redactions = servers.flatMap(secretsOf);
  const envFor = (server) => ({
      ...base, PG_TEST_URL: server.url, PG_CLIENT_DOCKER_IMAGE: `postgres:${server.major}`, PG_RECOVERY_REQUIRED: '1', PG_MATRIX_CONTAINER: server.name, PG_MATRIX_MAJOR: String(server.major),
      PG_TLS_TEST_URL: server.tlsUrl, PG_TLS_TEST_URL_BY_IP: server.tlsUrlByIp, PG_TLS_TEST_CA: certs.ca, PG_TLS_TEST_WRONG_CA: certs.wrongCa,
  });
  if (custom) await step(`PG ${only}: custom command`, custom, envFor(servers[0]), redactions);
  else for (const server of servers) {
    const env = envFor(server);
    await step(`PG ${server.major}: regression`, ['bin/deployment-preflight.mjs', 'regression'], env, redactions);
    await step(`PG ${server.major}: private schema, TLS, QR v2, restart, outage`, ['--test', '--test-concurrency=1', '--test-reporter=spec', 'test/supabase-preflight-postgres.test.mjs'], env, redactions);
  }
  const [source, target] = servers;
  if (!custom) await step('PG 16 -> 17 restore', ['--test', '--test-concurrency=1', '--test-reporter=spec', '--test-name-pattern=cross-version', 'test/supabase-preflight-postgres.test.mjs'], {
    ...base, PG_TEST_URL: target.url, PG_CLIENT_DOCKER_IMAGE: 'postgres:17', PG_RECOVERY_REQUIRED: '1', PG_CROSS_SOURCE_URL: source.url, PG_CROSS_SOURCE_IMAGE: 'postgres:16',
  }, redactions);
} catch (error) {
  console.error('MATRIX_FAILED ' + (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'UNEXPECTED'));
  results.push(['matrix setup', 1]);
} finally {
  for (const { name } of servers) run(['rm', '-f', name]);
}
console.log('\n=== matrix summary ===');
for (const [label, code] of results) console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${label}`);
if (!results.length || results.some(([, code]) => code !== 0)) process.exitCode = 1;
