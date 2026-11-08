// Credential-free checks of a deployed service. GET /healthz touches no table except `SELECT 1`.
// Every /v1 request, even a refused one, passes the PostgreSQL rate limiter and writes cs_rate_windows, so those
// probes run only with an explicit approval flag. There is no deploy, restart or configuration call in this file.
import https from 'node:https';
import { httpsOrigin } from '../bin/host-readiness.mjs';
import { check, safeCode } from './report.mjs';

const MAX_BODY = 16 * 1024;
const KNOWN_MODES = new Map([
  ['STATEFUL_DENY_DEFAULT', 'DENIED'],
  ['STATEFUL_AVD_SIMULATION', 'OPERATOR_APPROVED_AVD_ONLY'],
]);

/** No redirect is ever followed and no credential is ever sent except the deliberately fake bearer below. */
export function httpsRequest(origin, path, { method = 'GET', headers = {} } = {}) {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { Accept: 'application/json', ...headers }, timeout: 45_000 }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy(Object.assign(new Error('RESPONSE_TOO_LARGE'), { code: 'RESPONSE_TOO_LARGE' }));
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    req.end();
  });
}

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

export async function probeDeployment({ origin, approveRateWindowWrites = false, request = httpsRequest }) {
  const base = httpsOrigin(origin);
  const out = [];
  let health;
  try {
    health = await request(base, '/healthz');
  } catch (error) {
    return [check('RENDER_HEALTH', 'BLOCKED', 'unreachable: ' + safeCode(error)), check('RENDER_API_BOUNDARY', 'NOT_RUN', 'health did not answer')];
  }
  const body = json(health.body);
  const expected = body && KNOWN_MODES.get(body.mode);
  if (health.status !== 200 || !body || body.status !== 'UP' || !expected || body.sessionCreation !== expected) {
    out.push(check('RENDER_HEALTH', 'FAIL', `http ${health.status}, mode=${body?.mode ?? 'none'}: not a known stateful mode`));
    out.push(check('RENDER_API_BOUNDARY', 'NOT_RUN', 'health is not acceptable'));
    return out;
  }
  out.push(check('RENDER_HEALTH', 'PASS', `UP mode=${body.mode} sessionCreation=${body.sessionCreation}`, { mode: body.mode }));
  // The demonstration entrypoint is visible, never silent: it needs a person to confirm it was meant to be running.
  out.push(!Object.hasOwn(body, 'historyRead')
    ? check('RENDER_HISTORY_AUTHORITY', 'PASS', 'no history authority configured')
    : body.historyRead === 'AVD_REGISTRATION_ONLY' && body.mode === 'STATEFUL_AVD_SIMULATION'
      ? check('RENDER_HISTORY_AUTHORITY', 'MANUAL', 'AVD history demonstration is running: enrollment-scoped reads, no vehicle ownership. Confirm the approved window, or restore the Start Command')
      : check('RENDER_HISTORY_AUTHORITY', 'FAIL', 'health reports a configured history authority while production auth is blocked'));
  // Same for the WebXR experiment. Reported only when present: the default command says nothing about it.
  if (Object.hasOwn(body, 'mobileGuide')) {
    out.push(body.mobileGuide === 'WEBXR_EXPERIMENT'
      ? check('RENDER_WEBXR_GUIDE', 'MANUAL', 'WebXR guide experiment is running: every supported phone on this service sees it. Confirm the approval, or restore the Start Command')
      : check('RENDER_WEBXR_GUIDE', 'FAIL', 'health reports an unknown mobile guide'));
  }
  if (Object.hasOwn(body, 'vision')) {
    out.push(body.vision === 'EXPERIMENT' && body.detection === 'OFF'
      ? check('RENDER_VISION_EXPERIMENT', 'MANUAL', 'manual-region Vision experiment is running: confirm operator approval, private schema and durable call budgets; no Roboflow activation')
      : check('RENDER_VISION_EXPERIMENT', 'FAIL', 'unknown or unapproved Vision/detection mode'));
  }
  if (!approveRateWindowWrites) {
    out.push(check('RENDER_API_BOUNDARY', 'NOT_RUN', 'records 403 / session 401 probes write cs_rate_windows: pass --approve-rate-window-writes'));
    return out;
  }
  const fake = { Authorization: 'Bearer ' + 'preflightdenyprobe'.padEnd(43, '0') };
  const probes = [
    ['records without credential', '/v1/inspection-records', {}, 403, 'FORBIDDEN'],
    ['records with well-formed fake credential', '/v1/inspection-records', { headers: fake }, 403, 'FORBIDDEN'],
    ['session view without credential', '/v1/sessions/00000000-0000-4000-8000-000000000000', {}, 401, 'UNAUTHORIZED'],
    ['session creation with fake credential', '/v1/sessions', { method: 'POST', headers: fake }, 403, 'FORBIDDEN'],
  ];
  const wrong = [];
  for (const [label, path, options, status, code] of probes) {
    try {
      const r = await request(base, path, options);
      if (r.status !== status || json(r.body)?.error?.code !== code) wrong.push(`${label}: ${r.status}`);
    } catch (error) {
      wrong.push(`${label}: ${safeCode(error)}`);
    }
  }
  out.push(wrong.length ? check('RENDER_API_BOUNDARY', 'FAIL', wrong.join('; ')) : check('RENDER_API_BOUNDARY', 'PASS', 'records stay 403, session 401, creation 403 for a fake credential'));
  return out;
}
