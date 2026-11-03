// Synthetic authority only; no public issuer, registration, enrollment or revocation service.
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localPki } from './https-helpers.mjs';
const random = () => randomBytes(32).toString('base64url');
export async function authorityFixture({ host = '127.0.0.1', enrollmentProof = random() } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('LOOPBACK_ONLY');
  const pki = localPki(), management = random(), issuer = 'https://issuer.fixture.invalid/', audience = 'carscope-sync';
  const state = { apiOrigin: null, revoked: false, registered: true, mode: 'ok', hits: 0, token: null, claim: null, binding: null };
  function rotate() {
    const at = Date.now(); state.token = random(); state.revoked = false;
    state.claim = { active: true, issuer, audience, subject: 'fixture-subject', scope: ['inspection:session:create'], issuedAt: at, notBefore: at,
      expiresAt: at + 60_000, credentialId: random(), registrationId: 'fixture-registration' };
    state.binding = { issuer, subject: 'fixture-subject', registrationId: 'fixture-registration', userId: 'fixture-user', vehicleId: 'fixture-vehicle',
      deviceId: 'fixture-device', active: true, ownershipVerified: true, expiresAt: at + 300_000 };
  }
  rotate();
  const server = https.createServer({ cert: readFileSync(pki.tlsCert), key: readFileSync(pki.tlsKey), minVersion: 'TLSv1.2' }, async (req, res) => {
    state.hits++;
    try {
      let bytes = ''; for await (const b of req) { bytes += b; if (bytes.length > 4096) throw new Error(); }
      const body = JSON.parse(bytes), provision = req.url === '/creation/provision';
      const expected = provision ? enrollmentProof : management;
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${expected}`) { res.writeHead(403); res.end(); return; }
      if (state.mode === 'outage') { res.writeHead(503); res.end(); return; }
      if (state.mode === 'delay') await new Promise(r => setTimeout(r, 200));
      if (state.mode === 'redirect') { res.writeHead(307, { Location: 'https://127.0.0.1:1/leak' }); res.end(); return; }
      let response;
      if (req.url === '/creation/verify') response = body.token === state.token ? state.claim : null;
      else if (req.url === '/creation/registration') response = { ...state.binding, active: state.registered };
      else if (req.url === '/creation/active') response = { active: !state.revoked };
      else if (provision) {
        if (body.apiOrigin !== state.apiOrigin || body.audience !== audience || state.revoked || !state.registered || Date.now() >= state.claim.expiresAt) {
          res.writeHead(403); res.end(); return;
        }
        const { issuer: _, ...identity } = state.binding;
        response = { apiOrigin: state.apiOrigin, credential: state.token, ...state.claim, scope: 'inspection:session:create', identity };
        delete response.subject; delete response.registrationId;
      } else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': state.mode === 'html' ? 'text/html' : 'application/json', 'Cache-Control': 'no-store' });
      res.end(state.mode === 'duplicate' ? '{"active":false,"active":true}' : state.mode === 'large' ? ' '.repeat(17000) : JSON.stringify(response));
    } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); }); }
  catch (e) { pki.cleanup(); throw e; }
  const origin = `https://${host === '::1' ? '[::1]' : host}:${server.address().port}`;
  let stopped;
  return { pki, state, issuer, audience, origin, enrollmentProof, rotate,
    credentials: { testOnly: true, credential: () => management },
    stop() { return stopped ??= new Promise(resolve => server.close(resolve)).finally(() => pki.cleanup()); } };
}
