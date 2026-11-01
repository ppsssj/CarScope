// AR-01: self-inspection result record, shared by the mobile page and (from AR-02) the vehicle app sync.
// A record is a user's own report. It never certifies the vehicle state, never carries a vehicle identity (no VIN,
// no CRN, no plate), account, location, image or video, and it is not sent anywhere in AR-01 (no backend).
// Only the fields below exist; validateResult() rejects anything else.

export const SCHEMA_VERSION = 1;
export const TASK_ID = 'washer-fluid';
export const METHOD = 'SELF';
export const SOURCE = 'MOBILE';
export const CONFIRMATION = 'USER_REPORTED';
export const STATUSES = Object.freeze(['OK', 'NEEDS_REFILL', 'UNSURE']);
export const STATES = Object.freeze({ IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED' });
// AR-01 has no transport: a completed record stays on this screen. AR-02 will set SENT/FAILED.
export const SYNC = Object.freeze({ NOT_SENT: 'NOT_SENT' });

const FIELDS = {
  [STATES.IN_PROGRESS]: ['schemaVersion', 'inspectionId', 'taskId', 'method', 'source', 'state', 'startedAt', 'aids'],
  [STATES.COMPLETED]: ['schemaVersion', 'inspectionId', 'taskId', 'method', 'source', 'state', 'startedAt', 'aids', 'status', 'confirmation', 'completedAt', 'sync'],
};
const AIDS = ['cameraUsed', 'locationMarked'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const iso = (now) => new Date(now()).toISOString();
const defaultId = () => globalThis.crypto.randomUUID();

/** A new record for one inspection attempt. The id is random per attempt (not derived from any device or vehicle). */
export function startInspection({ now = Date.now, newId = defaultId } = {}) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION, inspectionId: newId(), taskId: TASK_ID, method: METHOD, source: SOURCE,
    state: STATES.IN_PROGRESS, startedAt: iso(now), aids: Object.freeze({ cameraUsed: false, locationMarked: false }),
  });
}

/** Record which on-screen aids were used (booleans only: no coordinates, frames or images). */
export function noteAids(record, aids) {
  if (record.state !== STATES.IN_PROGRESS) return record;
  const next = { ...record.aids };
  for (const key of AIDS) if (aids[key] === true) next[key] = true;
  return Object.freeze({ ...record, aids: Object.freeze(next) });
}

/**
 * Confirm the user's result. Throws on an unknown status or on a record that is already completed, so one attempt
 * can produce at most one completed result (a double tap cannot create a second, different record).
 */
export function completeInspection(record, status, { now = Date.now } = {}) {
  if (record?.state !== STATES.IN_PROGRESS) throw new Error('inspection is not in progress');
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
  const completedAt = iso(now);
  if (Date.parse(completedAt) < Date.parse(record.startedAt)) throw new Error('completedAt before startedAt');
  return Object.freeze({ ...record, state: STATES.COMPLETED, status, confirmation: CONFIRMATION, completedAt, sync: SYNC.NOT_SENT });
}

/** Strict shape check for a record: exact field set per state, fixed constants, valid timestamps. */
export function validateResult(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['not an object'];
  const fields = FIELDS[record.state];
  if (!fields) return [`unknown state: ${record.state}`];
  const keys = Object.keys(record);
  for (const key of keys) if (!fields.includes(key)) problems.push(`unexpected field: ${key}`);
  for (const key of fields) if (!(key in record)) problems.push(`missing field: ${key}`);
  if (record.schemaVersion !== SCHEMA_VERSION) problems.push('schemaVersion');
  if (!UUID.test(String(record.inspectionId))) problems.push('inspectionId');
  if (record.taskId !== TASK_ID) problems.push('taskId');
  if (record.method !== METHOD) problems.push('method');
  if (record.source !== SOURCE) problems.push('source');
  if (!ISO.test(String(record.startedAt))) problems.push('startedAt');
  const aids = record.aids ?? {};
  if (Object.keys(aids).some((k) => !AIDS.includes(k)) || AIDS.some((k) => typeof aids[k] !== 'boolean')) problems.push('aids');
  if (record.state === STATES.COMPLETED) {
    if (!STATUSES.includes(record.status)) problems.push('status');
    if (record.confirmation !== CONFIRMATION) problems.push('confirmation');
    if (!ISO.test(String(record.completedAt)) || Date.parse(record.completedAt) < Date.parse(record.startedAt)) problems.push('completedAt');
    if (record.sync !== SYNC.NOT_SENT) problems.push('sync');
  }
  return problems;
}

/** Korean labels and follow-up guidance for the completion screen. */
export const STATUS_TEXT = Object.freeze({
  OK: { label: '정상 확인', followUp: '사용자가 워셔액 상태를 직접 확인했습니다. 이 결과는 사용자 보고이며 차량 안전 상태를 인증하지 않습니다. 계절과 사용량에 따라 주기적으로 다시 확인하세요.' },
  NEEDS_REFILL: { label: '보충 필요', followUp: '차량과 기후에 맞는 워셔액을 준비하고, 설명서에서 워셔액 주입구(앞유리·분사 모양 표시)를 다시 확인한 뒤 보충하세요. 냉각수·브레이크액 등 다른 주입구에 넣지 마세요.' },
  UNSURE: { label: '확인 불가', followUp: '주입구 위치나 상태를 확신할 수 없다면 캡을 열거나 액체를 넣지 마세요. 차량 설명서를 확인하거나 제조사 서비스에 점검을 요청하세요.' },
});
