// P16: which inspection records may ever become part of a user's vehicle history. This PR implements the decision
// and the screen state only. There is no write path: the browser has no INSERT privilege on
// carscope_account.vehicle_inspection_links, and that table accepts VERIFIED_VEHICLE records with
// OWNER_VERIFIED_RECORD evidence only (P15 migration, unchanged).
//
// Five separate facts, never merged into one another:
//   GOOGLE_IDENTITY        who signed in. Not a car.
//   SELF_REPORTED_VEHICLE  what that person typed in. Not proof the car exists or is theirs.
//   QR_INSPECTION_SESSION  what one phone sent in one inspection session. Not tied to a user or a vehicle.
//   AVD_ENROLLMENT         records bound to one simulator registration. Not a person, not a real car.
//   OEM_OWNERSHIP          ownership confirmed by the manufacturer. Not available (Hyundai OAuth stays BLOCKED).

export const TRUST_DOMAINS = Object.freeze([
  Object.freeze({ id: 'GOOGLE_IDENTITY', proves: 'Google 계정으로 로그인한 사람', notProof: '자동차 소유' }),
  Object.freeze({ id: 'SELF_REPORTED_VEHICLE', proves: '사용자가 직접 입력한 차량 정보', notProof: '차량의 존재와 소유' }),
  Object.freeze({ id: 'QR_INSPECTION_SESSION', proves: '한 번의 점검 세션에서 휴대폰이 보낸 결과', notProof: '어느 사용자·차량의 기록인지' }),
  Object.freeze({ id: 'AVD_ENROLLMENT', proves: '시뮬레이터 등록 하나에 묶인 기록', notProof: '사람과 실제 차량' }),
  Object.freeze({ id: 'OEM_OWNERSHIP', proves: '제조사가 확인한 차량 소유 (아직 사용할 수 없음)', notProof: '-' }),
]);

export const LINK_REASONS = Object.freeze({
  INVALID_RECORD: 'INVALID_RECORD',
  SESSION_RESULT_ONLY: 'SESSION_RESULT_ONLY',
  AVD_SIMULATOR_RECORD: 'AVD_SIMULATOR_RECORD',
  NOT_VERIFIED_VEHICLE_RECORD: 'NOT_VERIFIED_VEHICLE_RECORD',
  OWNERSHIP_EVIDENCE_MISSING: 'OWNERSHIP_EVIDENCE_MISSING',
  VEHICLE_NOT_VERIFIED: 'VEHICLE_NOT_VERIFIED',
  LINK_WRITE_NOT_AVAILABLE: 'LINK_WRITE_NOT_AVAILABLE',
});

/**
 * Could `record` ever be linked to `vehicle`? Always returns linkable:false in this PR; the reason says which rule
 * stops it first. Order: what the record is, then whose it is, then the vehicle, then the missing write path.
 * @param {{vehicle: {verification: string}, record: {kind: string, authorityNamespace?: string, ownershipEvidence?: string, recordId?: string}}} input
 */
export function recordLinkEligibility({ vehicle, record } = {}) {
  const no = (reason) => Object.freeze({ linkable: false, reason });
  if (!record || typeof record !== 'object') return no(LINK_REASONS.INVALID_RECORD);
  // A result of the current 3D/QR session is not a stored record at all.
  if (record.kind === 'SESSION_RESULT') return no(LINK_REASONS.SESSION_RESULT_ONLY);
  if (record.kind !== 'HISTORY_RECORD' || typeof record.recordId !== 'string' || record.recordId.length === 0 || record.recordId.length > 128) return no(LINK_REASONS.INVALID_RECORD);
  if (record.authorityNamespace === 'AVD_SIMULATOR' || record.ownershipEvidence === 'AVD_REGISTRATION_BINDING') return no(LINK_REASONS.AVD_SIMULATOR_RECORD);
  if (record.authorityNamespace !== 'VERIFIED_VEHICLE') return no(LINK_REASONS.NOT_VERIFIED_VEHICLE_RECORD);
  if (record.ownershipEvidence !== 'OWNER_VERIFIED_RECORD') return no(LINK_REASONS.OWNERSHIP_EVIDENCE_MISSING);
  if (vehicle?.verification !== 'OEM_VERIFIED') return no(LINK_REASONS.VEHICLE_NOT_VERIFIED);
  return no(LINK_REASONS.LINK_WRITE_NOT_AVAILABLE);
}

export const LINK_STATE = Object.freeze({ NOT_LINKABLE: 'NOT_LINKABLE', NO_RECORDS: 'NO_RECORDS', LINKED: 'LINKED', UNKNOWN: 'UNKNOWN' });

/**
 * What a vehicle card says about inspection history. `count` is the number of rows the caller can read in
 * vehicle_inspection_links for this vehicle (RLS: own rows only), or null when it could not be read.
 * A self-reported vehicle is NOT_LINKABLE whatever the count says: rows for it cannot exist (no API write path)
 * and would not be shown as verified history if they did.
 */
export function vehicleInspectionStatus(vehicle, count) {
  if (vehicle?.verification !== 'OEM_VERIFIED') return Object.freeze({ state: LINK_STATE.NOT_LINKABLE, count: 0 });
  if (!Number.isInteger(count) || count < 0) return Object.freeze({ state: LINK_STATE.UNKNOWN, count: null });
  return Object.freeze({ state: count === 0 ? LINK_STATE.NO_RECORDS : LINK_STATE.LINKED, count });
}
