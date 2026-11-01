import { validateTireStatus } from '../../three-poc/tire-status.mjs';

export const ORIGIN = 'https://carscope-inspection.invalid';
export const ENDPOINT = ORIGIN + '/tire-status.json';
export function assessExchange({ url, method, status, headers, body, ui, expectedCsp }) {
  if (url !== ENDPOINT || method !== 'GET' || status !== 200) throw Error('Private GET endpoint did not succeed');
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  if (expectedCsp && h['content-security-policy']?.trim() !== expectedCsp.trim()) throw Error('CSP differs from the verified APK');
  if (h['cache-control']?.trim().toLowerCase() !== 'no-store') throw Error('Missing no-store');
  const directives = new Map();
  for (const rule of (h['content-security-policy'] ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const [name, ...values] = rule.split(/\s+/);
    if (directives.has(name)) throw Error('Ambiguous CSP');
    directives.set(name, values);
  }
  if (JSON.stringify(directives.get('default-src')) !== '["\'none\'"]'
    || JSON.stringify(directives.get('connect-src')) !== '["\'self\'"]') throw Error('CSP origin boundary changed');
  const scripts = directives.get('script-src') ?? [];
  if (scripts.length !== 2 || !scripts.includes("'self'") || !scripts.some(s => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(s))) throw Error('CSP script allowlist changed');
  if (!h['content-type']?.startsWith('application/json')) throw Error('Not a JSON response');
  const packet = validateTireStatus(body);
  if (!packet.readings.every(r => r.source === 'PLEOS')) throw Error('Runtime packet is not PLEOS; no MOCK result may pass');
  const view = { connectionStatus: packet.connectionStatus, sessionPhase: packet.sessionPhase, readings: packet.readings };
  if (JSON.stringify(view) !== JSON.stringify(ui)) throw Error('Native projection and rendered store differ');
  return { status: 'PASS', sessionId: packet.sessionId, sequence: packet.sequence, view,
    transport: { url, method, status, headers: Object.fromEntries(['cache-control', 'content-security-policy', 'content-type'].map(k => [k, h[k]])) },
    reason: 'Observed private response and matching JS store; SDK support is assessed separately' };
}

export function sdkCapabilityObservation(rows) {
  const explicit = rows.filter(r => ['SUPPORTED', 'UNSUPPORTED'].includes(r.capabilityStatus)).length;
  return { status: rows.length === 8 && explicit === 8 ? 'PASS' : 'BLOCKED', explicitRows: explicit,
    reason: 'Requires all eight explicit capability results; permission, timeout or unverified data is not support' };
}
