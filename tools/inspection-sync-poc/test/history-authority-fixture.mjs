// Synthetic HTTPS authority for tests only. It issues nothing real and proves no vehicle ownership.
// Loopback-only, never imported by a runtime entrypoint; its credentials are marked testOnly.
import https from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localPki } from './https-helpers.mjs';
import { CREATE_SCOPE } from '../src/verified-creation-authorizer.mjs';
import { HISTORY_READ_SCOPE } from '../src/history-authorizer.mjs';

const secret = () => randomBytes(32).toString('base64url');
export const FAULT_MODES = ['outage', 'redirect', 'html', 'large', 'duplicate', 'malformed', 'array', 'delay', 'reset'];

export async function historyAuthorityFixture({
  host = '127.0.0.1',
  now = Date.now,
  issuer = 'https://history-authority.fixture.invalid/',
  audience = 'carscope-history-fixture',
} = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('LOOPBACK_ONLY');
  const pki = localPki();
  const managementFor = { history: secret(), creation: secret() };
  const tokens = new Map(),
    registrations = new Map(),
    revokedCredentials = new Set(),
    revokedRegistrations = new Set();
  const state = {
    hits: 0,
    requests: [],
    mode: 'ok',
    modeFor: {}, // per-endpoint fault, e.g. { active: 'outage' }
    delayMs: 200,
    overrideFor: {}, // per-endpoint exact response body, used for malformed-contract tests
  };

  function register({ userId, vehicleId, deviceId = 'device-' + randomUUID(), ownershipVerified = true, expiresInMs = 3_600_000 }) {
    const registrationId = 'registration-' + randomUUID();
    const binding = {
      issuer,
      subject: 'subject-' + userId,
      registrationId,
      userId,
      vehicleId,
      deviceId,
      active: true,
      ownershipVerified,
      expiresAt: now() + expiresInMs,
    };
    registrations.set(registrationId, binding);
    return binding;
  }
  function issue(binding, { scope = [HISTORY_READ_SCOPE], ttlMs = 60_000, patch = {} } = {}) {
    const at = now(),
      token = secret();
    const claim = {
      active: true,
      issuer,
      audience,
      subject: binding.subject,
      scope,
      issuedAt: at,
      notBefore: at,
      expiresAt: at + ttlMs,
      credentialId: randomUUID(),
      registrationId: binding.registrationId,
      ...patch,
    };
    tokens.set(token, claim);
    return token;
  }
  const issueCreate = (binding, options = {}) => issue(binding, { scope: [CREATE_SCOPE], ...options });

  function respond(endpoint, body) {
    if (endpoint === 'verify') return tokens.get(body.token) ?? null;
    if (endpoint === 'registration') {
      const binding = registrations.get(body.registrationId);
      return binding && binding.issuer === body.issuer && binding.subject === body.subject ? binding : null;
    }
    return {
      active:
        tokensByCredential(body.credentialId) &&
        !revokedCredentials.has(body.credentialId) &&
        !revokedRegistrations.has(body.registrationId),
    };
  }
  const tokensByCredential = (credentialId) => [...tokens.values()].some((c) => c.credentialId === credentialId);

  const server = https.createServer(
    { cert: readFileSync(pki.tlsCert), key: readFileSync(pki.tlsKey), minVersion: 'TLSv1.2' },
    async (req, res) => {
      state.hits++;
      try {
        let bytes = '';
        for await (const chunk of req) {
          bytes += chunk;
          if (bytes.length > 4096) throw new Error();
        }
        const match = /^\/(history|creation)\/(verify|registration|active)$/.exec(req.url);
        state.requests.push({ url: req.url, authorization: req.headers.authorization, body: bytes });
        // Each route family is reachable only with its own service credential.
        if (!match || req.method !== 'POST' || req.headers.authorization !== `Bearer ${managementFor[match[1]]}`) {
          res.writeHead(403);
          res.end();
          return;
        }
        const [, , endpoint] = match,
          mode = state.modeFor[endpoint] ?? state.mode;
        if (mode === 'outage') {
          res.writeHead(503);
          res.end();
          return;
        }
        if (mode === 'reset') {
          req.socket.destroy();
          return;
        }
        if (mode === 'redirect') {
          res.writeHead(307, { Location: 'https://127.0.0.1:1/leak' });
          res.end();
          return;
        }
        if (mode === 'delay') await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        const payload = Object.hasOwn(state.overrideFor, endpoint)
          ? state.overrideFor[endpoint]
          : respond(endpoint, JSON.parse(bytes));
        res.writeHead(200, { 'Content-Type': mode === 'html' ? 'text/html' : 'application/json', 'Cache-Control': 'no-store' });
        res.end(
          mode === 'duplicate'
            ? '{"active":false,"active":true}'
            : mode === 'large'
              ? ' '.repeat(17000)
              : mode === 'malformed'
                ? '{"active":'
                : mode === 'array'
                  ? '[]'
                  : JSON.stringify(payload),
        );
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      }
    },
  );
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, resolve);
    });
  } catch (error) {
    pki.cleanup();
    throw error;
  }
  const origin = `https://${host === '::1' ? '[::1]' : host}:${server.address().port}`;
  const adapter = (family) => ({
    origin,
    issuer,
    audience,
    ca: pki.ca,
    now,
    credentials: { testOnly: true, credential: () => managementFor[family] },
  });
  let stopped;
  return {
    pki,
    state,
    issuer,
    audience,
    origin,
    tokens,
    register,
    issue,
    issueCreate,
    history: adapter('history'),
    creation: adapter('creation'),
    claim: (token) => tokens.get(token),
    revokeCredential: (token) => revokedCredentials.add(tokens.get(token).credentialId),
    revokeRegistration: (binding) => revokedRegistrations.add(binding.registrationId),
    reset() {
      Object.assign(state, { mode: 'ok', modeFor: {}, overrideFor: {} });
    },
    stop() {
      return (stopped ??= new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }).finally(() => pki.cleanup()));
    },
  };
}
