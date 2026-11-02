// Credential-free host probe. Never grants creation, changes trust stores, or contacts an Android device.
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function httpsOrigin(value) {
  if (typeof value !== 'string' || !/^https:\/\/(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::[0-9]+)?\/?$/.test(value)) throw new Error('INVALID_HTTPS_ORIGIN');
  const url = new URL(value);
  if (url.port === '0') throw new Error('INVALID_HTTPS_ORIGIN');
  return url.origin;
}

function get(origin, path, ca) {
  return new Promise((resolve) => {
    const req = https.get(origin + path, { ...(ca ? { ca } : {}), headers: { Accept: 'application/json, text/html, text/javascript' } }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > 256 * 1024) req.destroy(); else chunks.push(chunk); });
      res.on('error', () => resolve({ failure: true }));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    const deadline = setTimeout(() => req.destroy(), 5000);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', () => resolve({ failure: true }));
  });
}

export async function probeHost({ apiOrigin, mobileRoot, ca }) {
  const api = httpsOrigin(apiOrigin), mobile = httpsOrigin(mobileRoot);
  const dummy = '/v1/sessions/00000000-0000-4000-8000-000000000000';
  const checkApi = async (origin) => {
    const r = await get(origin, dummy, ca);
    let valid = false;
    try { valid = r.status === 401 && r.headers['content-type']?.split(';')[0].trim() === 'application/json' && JSON.stringify(JSON.parse(r.text)) === '{"error":{"code":"UNAUTHORIZED"}}'; } catch {}
    return valid ? 'PASS' : 'FAIL';
  };
  const apiStatus = await checkApi(api), mobileApi = await checkApi(mobile);
  const page = await get(mobile, '/', ca);
  const entry = await get(mobile, '/public/mobile-dev-entry.mjs', ca);
  const surface = page.status === 200 && page.headers['content-type']?.startsWith('text/html') &&
    /connect-src 'self'(?:;|$)/.test(page.headers['content-security-policy'] ?? '') &&
    page.text?.includes('src="/public/mobile-dev-entry.mjs"') && entry.status === 200 &&
    entry.headers['content-type']?.includes('javascript') && entry.text?.includes('takeMobileHandoff');
  const hostPass = apiStatus === 'PASS' && mobileApi === 'PASS' && surface;
  return { at: new Date().toISOString(), scope: 'HOST_TLS_API_AND_MOBILE_SURFACE_ONLY',
    hostStatus: hostPass ? 'PASS' : 'FAIL', trust: ca ? 'EXPLICIT_HOST_CA_ONLY' : 'NODE_DEFAULT_TRUST',
    apiTlsAndContract: apiStatus, mobileSameOriginApiTlsAndContract: mobileApi, mobileV2Surface: surface ? 'PASS' : 'FAIL',
    creationAuthorization: 'BLOCKED', androidTls: 'NOT_RUN', phoneTls: 'NOT_RUN', opticalQr: 'NOT_RUN', twoDeviceE2E: 'BLOCKED' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--api-origin', '--mobile-root', '--ca-file'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error();
      options[args[i]] = args[i + 1];
    }
    const report = await probeHost({ apiOrigin: options['--api-origin'], mobileRoot: options['--mobile-root'], ca: options['--ca-file'] ? await readFile(options['--ca-file']) : undefined });
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.hostStatus === 'PASS' ? 0 : 1;
  } catch {
    console.error('HOST_PREFLIGHT_FAILED: require HTTPS root origins and an optional readable CA file; no credentials allowed'); process.exitCode = 1;
  }
}
