// Explicit AVD-simulation provisioning route; never a vehicle owner authentication API.
import { AVD_AUDIENCE } from './avd-simulator-credentials.mjs';
import { createHash } from 'node:crypto';
import { HistoryError } from './history.mjs';

const RESPONSE_HEADERS = Object.freeze({
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Strict-Transport-Security':'max-age=31536000',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
});
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const sha = x => createHash('sha256').update(x).digest('hex');
const json = (res,code,data) => { res.writeHead(code,RESPONSE_HEADERS); res.end(JSON.stringify(data)); };
const error = (res,code,label) => json(res,code,{error:{code:label}});
const exactKeys = (v, keys) => v && typeof v==='object' && !Array.isArray(v) &&
  Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));

const HISTORY_LIST = '/simulator/inspection-records';
const HISTORY_DETAIL = /^\/simulator\/inspection-records\/([0-9a-f-]{36})$/;
export const isAvdHistoryPath = pathname => pathname === HISTORY_LIST || HISTORY_DETAIL.test(pathname);
export const isAvdHistoryQueryPath = pathname => pathname === HISTORY_LIST;

/**
 * Debug AVD reads, scoped to the registration of the presented enrollment proof. Not /v1/inspection-records,
 * which stays closed to every AVD credential, and not a vehicle owner API. Separate from the provision budget,
 * so reading can never use up the requests that create a QR.
 */
export async function serveAvdSimulatorHistory(req,res,{credentialStore,history,limiter,secure,publicOrigin}) {
  try {
    if (req.method!=='GET') { error(res,405,'BAD_REQUEST'); return; }
    const addr = req.socket.remoteAddress || 'unknown';
    if (!(await limiter.check(addr,'client')).ok || !(await limiter.check(addr,'read')).ok) { error(res,429,'RATE_LIMITED'); return; }
    const match = BEARER.exec(req.headers.authorization||'');
    if (!match) { error(res,403,'FORBIDDEN'); return; }
    const proof = match[1];
    if (!(await limiter.check('avd-history:'+sha(proof),'token')).ok) { error(res,429,'RATE_LIMITED'); return; }
    const url = new URL(req.url,publicOrigin), id = HISTORY_DETAIL.exec(url.pathname)?.[1];
    if (id && url.search) { error(res,400,'BAD_REQUEST'); return; }
    const principal = await credentialStore.resolveHistoryReader({token:proof,secure});
    if (!principal) { error(res,403,'FORBIDDEN'); return; }
    const payload = id ? await history.detail(principal,id) : await history.list(principal,url.searchParams);
    // Same rule as the owner route: a revocation that lands during the read also stops this response.
    const current = await credentialStore.resolveHistoryReader({token:proof,secure});
    if (!current || current.registrationId!==principal.registrationId) { error(res,403,'FORBIDDEN'); return; }
    json(res,200,payload);
  } catch (e) {
    if (e instanceof HistoryError) error(res,e.status,e.code);
    else error(res,500,'INTERNAL');
  }
}

export async function serveAvdSimulatorProvision(req,res,{credentialStore,limiter,publicOrigin}) {
  if (req.method!=='POST') { error(res,405,'BAD_REQUEST'); return; }
  const addr = req.socket.remoteAddress || 'unknown';
  if (!(await limiter.check(addr,'client')).ok) { error(res,429,'RATE_LIMITED'); return; }
  const match = BEARER.exec(req.headers.authorization||'');
  if (!match) { error(res,401,'UNAUTHORIZED'); return; }
  const proof = match[1];
  // Hashing before rate accounting avoids raw enrollment proof/identity persistence.
  if (!(await limiter.check('avd-proof:'+sha(proof),'avd-provision')).ok) {
    error(res,429,'RATE_LIMITED'); return;
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')) {
    error(res,415,'UNSUPPORTED_MEDIA_TYPE'); return;
  }
  const declared = req.headers['content-length'];
  if (declared != null && (!/^[0-9]+$/.test(declared) || Number(declared)>1024)) {
    error(res,413,'PAYLOAD_TOO_LARGE'); return;
  }
  let length = 0, chunks = [];
  try {
    for await (const chunk of req) {
      length+=chunk.length;
      if (length>1024) { error(res,413,'PAYLOAD_TOO_LARGE'); return; }
      chunks.push(chunk);
    }
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if (!exactKeys(payload,['apiOrigin','audience']) ||
        payload.apiOrigin!==publicOrigin || payload.audience!==AVD_AUDIENCE) {
      error(res,400,'BAD_REQUEST'); return;
    }
    const granted=await credentialStore.provision({enrollmentProof:proof,apiOrigin:publicOrigin});
    if (!granted) { error(res,401,'UNAUTHORIZED'); return; }
    json(res,200,granted);
  } catch {
    if (!res.headersSent) error(res,503,'UNAVAILABLE');
    else res.end();
  }
}
