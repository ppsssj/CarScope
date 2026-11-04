// Durable USER_REPORTED history contract. No QR credential or SDK observation belongs here.
import { createHash, randomUUID } from 'node:crypto';
import { SUPPORTED_TASKS, checkEnvelope, resultDigest, canonicalJson } from './protocol.mjs';

export class HistoryError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code = 'BAD_REQUEST', status = 400) => {
  throw new HistoryError(code, status);
};
const exact = (x, keys) =>
  x &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.keys(x).length === keys.length &&
  keys.every((k) => Object.hasOwn(x, k));
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(x);
const ms = (x) => Number.isSafeInteger(x) && x >= 0;
const timestamp = (x) => Number.isSafeInteger(x) && Math.abs(x) <= 8_640_000_000_000_000;
const uuid = (x) =>
  typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
export const HISTORY_NAMESPACES = Object.freeze(['UNVERIFIED', 'AVD_SIMULATOR', 'VERIFIED_VEHICLE']);
export const UNVERIFIED_AUTHORITY = Object.freeze({
  authorityNamespace: 'UNVERIFIED',
  authorityIssuer: 'unverified',
  userId: null,
  vehicleId: null,
  deviceId: null,
  registrationId: null,
  bindingVerifiedAt: null,
});
const authorityKeys = Object.keys(UNVERIFIED_AUTHORITY);
export function historyAuthority(value = UNVERIFIED_AUTHORITY) {
  if (
    !exact(value, authorityKeys) ||
    !HISTORY_NAMESPACES.includes(value.authorityNamespace) ||
    typeof value.authorityIssuer !== 'string' ||
    value.authorityIssuer.length < 1 ||
    value.authorityIssuer.length > 512 ||
    ![value.userId, value.vehicleId, value.deviceId, value.registrationId].every(
      (x) => x === null || id(x),
    ) ||
    !(value.bindingVerifiedAt === null || ms(value.bindingVerifiedAt))
  )
    fail('FORBIDDEN', 403);
  if (
    value.authorityNamespace === 'VERIFIED_VEHICLE' &&
    (![value.userId, value.vehicleId, value.deviceId, value.registrationId].every(id) ||
      !ms(value.bindingVerifiedAt))
  )
    fail('FORBIDDEN', 403);
  if (
    value.authorityNamespace === 'AVD_SIMULATOR' &&
    (!id(value.registrationId) ||
      value.userId !== null ||
      value.vehicleId !== null ||
      value.deviceId !== null ||
      !ms(value.bindingVerifiedAt))
  )
    fail('FORBIDDEN', 403);
  if (
    value.authorityNamespace === 'UNVERIFIED' &&
    canonicalJson(value) !== canonicalJson(UNVERIFIED_AUTHORITY)
  )
    fail('FORBIDDEN', 403);
  return Object.freeze({ ...value });
}
export const partIdForTask = (task) => {
  if (!SUPPORTED_TASKS.includes(task)) fail('INVALID_RESULT', 422);
  return task === 'washer-fluid'
    ? 'washer-fluid-cap'
    : task === 'brake-fluid'
      ? 'brake-fluid-reservoir'
      : task;
};
export async function acceptedRecord(session) {
  if (
    !session ||
    session.state !== 'ACCEPTED' ||
    !session.result ||
    !ms(session.receivedAt) ||
    !ms(session.acceptedAt) ||
    session.acceptedAt < session.receivedAt ||
    checkEnvelope({ protocol: 'inspection-sync', protocolVersion: 1, result: session.result }, session.taskId)
      .length ||
    session.inspectionId !== session.result.inspectionId
  )
    fail('INVALID_RESULT', 422);
  if ((await resultDigest(session.result)) !== session.resultDigest) fail('CONFLICT', 409);
  const authority = historyAuthority(session.historyAuthority);
  return {
    recordId: randomUUID(),
    inspectionId: session.inspectionId,
    syncSessionId: session.id,
    taskId: session.taskId,
    partId: partIdForTask(session.taskId),
    schemaVersion: session.result.schemaVersion,
    inspectionStatus: session.result.status,
    originalResult: structuredClone(session.result),
    resultDigest: session.resultDigest,
    completedAt: Date.parse(session.result.completedAt),
    receivedAt: session.receivedAt,
    acceptedAt: session.acceptedAt,
    ...authority,
  };
}
export function sameRecordIdentity(existing, candidate) {
  // An equal UUID/digest in a different authority/owner must never return or relabel another owner's record.
  return [
    'inspectionId',
    'resultDigest',
    'taskId',
    'authorityNamespace',
    'authorityIssuer',
    'userId',
    'vehicleId',
    'registrationId',
  ].every((k) => existing[k] === candidate[k]);
}
const statuses = new Set(['OK', 'NEEDS_REFILL', 'UNSURE', 'REVIEW_NEEDED', 'UNABLE', 'NO_FINDINGS_REPORTED']);
const hash = (x) => createHash('sha256').update(canonicalJson(x)).digest('hex');
const scope = (principal) => {
  const a = historyAuthority(principal);
  if (a.authorityNamespace !== 'VERIFIED_VEHICLE') fail('FORBIDDEN', 403);
  return a;
};
export function historyQuery(params = new URLSearchParams(), principal) {
  const owner = scope(principal),
    allowed = ['limit', 'cursor', 'taskId', 'partId', 'status', 'from', 'to'];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail();
  const limit = params.has('limit') ? Number(params.get('limit')) : 20;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (params.has('limit') && !/^[1-9][0-9]*$/.test(params.get('limit')))
  )
    fail();
  const taskId = params.get('taskId'),
    partId = params.get('partId'),
    status = params.get('status');
  if (
    (taskId !== null && !SUPPORTED_TASKS.includes(taskId)) ||
    (partId !== null && !SUPPORTED_TASKS.some((t) => partIdForTask(t) === partId)) ||
    (status !== null && !statuses.has(status))
  )
    fail();
  const date = (key) => {
    if (!params.has(key)) return null;
    const text = params.get(key),
      value = Date.parse(text);
    if (!timestamp(value) || new Date(value).toISOString() !== text) fail();
    return value;
  };
  const from = date('from'),
    to = date('to');
  if (from !== null && to !== null && from >= to) fail();
  const filter = { taskId, partId, status, from, to };
  const fingerprint = hash({
    namespace: owner.authorityNamespace,
    issuer: owner.authorityIssuer,
    userId: owner.userId,
    vehicleId: owner.vehicleId,
    ...filter,
  });
  let after = null;
  if (params.has('cursor')) {
    const text = params.get('cursor');
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(text)) fail();
    try {
      after = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    } catch {
      fail();
    }
    if (
      !exact(after, ['v', 'completedAt', 'recordId', 'fingerprint']) ||
      after.v !== 1 ||
      !timestamp(after.completedAt) ||
      !uuid(after.recordId) ||
      after.fingerprint !== fingerprint
    )
      fail();
  }
  return { owner, limit, ...filter, after, fingerprint };
}
export function historyDto(row, detail = false) {
  const out = {
    recordId: row.recordId,
    inspectionId: row.inspectionId,
    taskId: row.taskId,
    partId: row.partId,
    schemaVersion: row.schemaVersion,
    inspectionStatus: row.inspectionStatus,
    resultDigest: row.resultDigest,
    completedAt: row.completedAt,
    receivedAt: row.receivedAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    source: 'USER_REPORTED',
    method: 'SELF',
    channel: 'MOBILE',
    authorityNamespace: row.authorityNamespace,
    ownershipEvidence: 'SESSION_CREATION_BINDING',
    sdkDataIncluded: false,
  };
  if (detail) {
    out.responses = structuredClone(row.originalResult.responses ?? {});
    out.originalResult = structuredClone(row.originalResult);
  }
  return out;
}
export class HistoryService {
  constructor({ store } = {}) {
    this.store = store;
  }
  async verify(row, owner) {
    if (
      !row.originalResult ||
      !SUPPORTED_TASKS.includes(row.taskId) ||
      !['authorityNamespace', 'authorityIssuer', 'userId', 'vehicleId'].every((k) => row[k] === owner[k]) ||
      checkEnvelope(
        { protocol: 'inspection-sync', protocolVersion: 1, result: row.originalResult },
        row.taskId,
      ).length ||
      (await resultDigest(row.originalResult)) !== row.resultDigest ||
      row.inspectionId !== row.originalResult.inspectionId ||
      row.schemaVersion !== row.originalResult.schemaVersion ||
      row.inspectionStatus !== row.originalResult.status ||
      partIdForTask(row.taskId) !== row.partId
    )
      fail('INTERNAL', 500);
  }
  async list(principal, params) {
    const query = historyQuery(params, principal);
    if (typeof this.store?.historyList !== 'function') fail('FORBIDDEN', 403);
    const rows = await this.store.historyList(query),
      hasMore = rows.length > query.limit,
      visible = rows.slice(0, query.limit),
      last = visible.at(-1);
    await Promise.all(visible.map((row) => this.verify(row, query.owner)));
    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            v: 1,
            completedAt: last.completedAt,
            recordId: last.recordId,
            fingerprint: query.fingerprint,
          }),
        ).toString('base64url')
      : null;
    return {
      schemaVersion: 1,
      items: visible.map((r) => historyDto(r)),
      page: { limit: query.limit, hasMore, nextCursor },
    };
  }
  async detail(principal, recordId) {
    const owner = scope(principal);
    if (!uuid(recordId)) fail();
    if (typeof this.store?.historyGet !== 'function') fail('FORBIDDEN', 403);
    const row = await this.store.historyGet(owner, recordId);
    if (!row) fail('NOT_FOUND', 404);
    await this.verify(row, owner);
    return { schemaVersion: 1, record: historyDto(row, true) };
  }
}
