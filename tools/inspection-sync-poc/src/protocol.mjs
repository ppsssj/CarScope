// AR-02A inspection-sync v1 contract: shared by the sync server, the mobile sync client and the vehicle receiver.
// Pure and dependency-free (Node 22 and browsers): QR v2 handoff, token shape, result digest, envelope/receipt checks.
// The AR-01 result record and its strict validator are reused unchanged from tools/mobile-ar-poc.
import { validateResult, TASK_ID, STATES } from '../../mobile-ar-poc/public/inspection-result.mjs';

export const PROTOCOL = 'inspection-sync';
export const PROTOCOL_VERSION = 1;
export const QR_VERSION = 2;
export const SUPPORTED_TASKS = Object.freeze([TASK_ID]);

// 32 random bytes, base64url without padding: exactly 43 characters. Tokens are bearer secrets, not identities.
export const TOKEN_BYTES = 32;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const isToken = (t) => typeof t === 'string' && TOKEN_PATTERN.test(t);

export const ERRORS = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST', UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE', PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNAUTHORIZED: 'UNAUTHORIZED', FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_CLOSED: 'SESSION_CLOSED', ALREADY_CLAIMED: 'ALREADY_CLAIMED', INVALID_STATE: 'INVALID_STATE',
  INVALID_RESULT: 'INVALID_RESULT', TASK_MISMATCH: 'TASK_MISMATCH', CONFLICT: 'CONFLICT', RATE_LIMITED: 'RATE_LIMITED',
  CAPACITY: 'CAPACITY', INTERNAL: 'INTERNAL',
});

// ---------- QR v2 (pairing). v1 (`#v=1&task=washer-fluid`) stays the task-hint-only contract of AR-01. ----------

/** `#v=2&task=<task>&invite=<token>`: exactly these three keys, once each, in any order. */
export function buildInviteFragment(task, invite) {
  if (!SUPPORTED_TASKS.includes(task) || !isToken(invite)) throw new Error('invalid invite fragment input');
  return `#v=${QR_VERSION}&task=${task}&invite=${invite}`;
}

/** Strict v2 parse. Returns { valid:true, task, invite } or { valid:false } (never echoes the token on failure). */
export function parseInviteFragment(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return { valid: false };
  const params = new URLSearchParams(hash.slice(1));
  const keys = [...params.keys()];
  if (keys.length !== 3 || new Set(keys).size !== 3) return { valid: false };
  if (params.get('v') !== String(QR_VERSION)) return { valid: false };
  const task = params.get('task'), invite = params.get('invite');
  if (!SUPPORTED_TASKS.includes(task) || !isToken(invite)) return { valid: false };
  return { valid: true, task, invite };
}

// ---------- result digest ----------

/** Canonical JSON: object keys sorted recursively, no whitespace. Used only for hashing. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** SHA-256 of the canonical result, `sha256:<hex>`. WebCrypto, available in Node 22 and secure browser contexts. */
export async function resultDigest(result) {
  const bytes = new TextEncoder().encode(canonicalJson(result));
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---------- submission envelope (mobile -> server) ----------

/**
 * The completed AR-01 record travels unchanged inside an envelope; transport state never goes into the record.
 * Returns a list of problems (empty when acceptable).
 */
export function checkEnvelope(envelope, sessionTask) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return ['envelope: not an object'];
  const problems = [];
  const keys = Object.keys(envelope);
  for (const k of keys) if (!['protocol', 'protocolVersion', 'result'].includes(k)) problems.push(`envelope: unexpected field ${k}`);
  if (envelope.protocol !== PROTOCOL) problems.push('envelope: protocol');
  if (envelope.protocolVersion !== PROTOCOL_VERSION) problems.push('envelope: protocolVersion');
  const r = envelope.result;
  if (!r || typeof r !== 'object') return [...problems, 'result: missing'];
  if (r.state !== STATES.COMPLETED) problems.push('result: not COMPLETED');
  for (const p of validateResult(r)) problems.push(`result: ${p}`);
  if (sessionTask && r.taskId !== sessionTask) problems.push('result: task mismatch');
  return problems;
}

// ---------- receipt (server -> mobile) ----------

export const RECEIPT_FIELDS = Object.freeze(['protocol', 'protocolVersion', 'inspectionId', 'resultDigest', 'receivedAt', 'sessionState']);

/** A receipt is valid for `result` only if it names the same inspection and the same digest. */
export async function receiptMatches(receipt, result) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (Object.keys(receipt).some((k) => !RECEIPT_FIELDS.includes(k))) return false;
  if (receipt.protocol !== PROTOCOL || receipt.protocolVersion !== PROTOCOL_VERSION) return false;
  if (receipt.inspectionId !== result.inspectionId) return false;
  if (!['RESULT_SUBMITTED', 'ACCEPTED'].includes(receipt.sessionState)) return false;
  return receipt.resultDigest === await resultDigest(result);
}
