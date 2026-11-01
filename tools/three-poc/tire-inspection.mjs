// Session-local USER_REPORTED observations. Independent of SDK capability/availability.
import { TIRES } from './inspection-tires.mjs';
export const CHECKS = Object.freeze([
  { id: 'damage', label: '외관 손상 또는 균열' },
  { id: 'debris', label: '눈에 띄는 이물질' },
  { id: 'wear', label: '불균일한 마모의 육안상 징후' },
].map(Object.freeze));
export const ANSWERS = Object.freeze({ FOUND: '이상 징후 발견', NOT_FOUND: '발견하지 못함', UNABLE: '확인 불가' });
const tireIds = TIRES.map(t => t.id);
const freeze = row => Object.freeze({ ...row, responses: Object.freeze({ ...row.responses }) });
export function createTireInspection(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw Error('Session ID required');
  return Object.freeze({ sessionId, tires: Object.freeze(Object.fromEntries(tireIds.map(tireId => [tireId,
    freeze({ tireId, sessionId, source: 'USER_REPORTED', responses: {}, status: 'NOT_STARTED', completedAt: null })]))) });
}
export function updateTireInspection(session, event) {
  const row = session.tires[event.tireId];
  if (!tireIds.includes(event.tireId) || !row || event.sessionId !== session.sessionId) return session;
  let next;
  if (event.type === 'ANSWER') {
    if (!CHECKS.some(c => c.id === event.checkId) || !Object.hasOwn(ANSWERS, event.answer) || row.responses[event.checkId] === event.answer) return session;
    next = { ...row, responses: { ...row.responses, [event.checkId]: event.answer }, status: 'IN_PROGRESS', completedAt: null };
  } else if (event.type === 'CONFIRM') {
    if (row.status === 'COMPLETED' || !CHECKS.every(c => Object.hasOwn(ANSWERS, row.responses[c.id]))
      || !Number.isSafeInteger(event.at) || event.at < 0 || event.at > 8640000000000000) return session;
    next = { ...row, status: 'COMPLETED', completedAt: event.at };
  } else return session;
  return Object.freeze({ ...session, tires: Object.freeze({ ...session.tires, [event.tireId]: freeze(next) }) });
}
export const inspectionProgress = session => tireIds.filter(id => session.tires[id].status === 'COMPLETED').length;
export const needsReview = row => CHECKS.filter(c => ['FOUND', 'UNABLE'].includes(row.responses[c.id])).map(c => c.label);
