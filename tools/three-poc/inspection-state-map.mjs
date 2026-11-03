// Projection of this page's existing session records. No mobile/Native/SDK ingress or persistence.
import { TIRES } from './inspection-tires.mjs';
import { CHECKS, ANSWERS } from './tire-inspection.mjs';

export const INSPECTION_STATES = Object.freeze({
  NOT_INSPECTED: Object.freeze({ label:'미점검', symbol:'○', color:0x647180 }),
  FINDINGS_REPORTED: Object.freeze({ label:'이상 징후 보고', symbol:'!', color:0xef9867 }),
  UNABLE: Object.freeze({ label:'확인 불가', symbol:'?', color:0xd9bd72 }),
  NO_FINDINGS_REPORTED: Object.freeze({ label:'발견 사항 없음', symbol:'−', color:0x82b7dd }),
});
// Add an explicit collection/identity/check contract here only after its record producer is integrated.
export const INSPECTION_TARGETS = Object.freeze(TIRES.map(t=>Object.freeze({
  partId:t.id, label:t.label, collection:'tires', identityKey:'tireId', checks:CHECKS,
})));
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const validTime=t=>Number.isSafeInteger(t)&&t>=0&&t<=8640000000000000;
export function inspectionStateMap(session) {
  return Object.freeze(INSPECTION_TARGETS.map(target=>{
    const row=session?.[target.collection]?.[target.partId];
    const keys=target.checks.map(c=>c.id);
    const valid=typeof session?.sessionId==='string'&&!!session.sessionId.trim()
      &&exact(row,[target.identityKey,'sessionId','source','responses','status','completedAt'])
      &&row[target.identityKey]===target.partId&&row.sessionId===session.sessionId&&row.source==='USER_REPORTED'
      &&row.responses&&typeof row.responses==='object'&&!Array.isArray(row.responses)
      &&Object.entries(row.responses).every(([k,v])=>keys.includes(k)&&typeof v==='string'&&Object.hasOwn(ANSWERS,v));
    const completed=valid&&row.status==='COMPLETED'&&exact(row.responses,keys)&&validTime(row.completedAt);
    const draft=valid&&row.status==='IN_PROGRESS'&&row.completedAt===null;
    const values=completed?Object.values(row.responses):[];
    const status=!completed?'NOT_INSPECTED':values.includes('FOUND')?'FINDINGS_REPORTED'
      :values.includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED';
    return Object.freeze({partId:target.partId,partLabel:target.label,status,...INSPECTION_STATES[status],
      draft,source:completed?'USER_REPORTED':null,origin:completed?'THIS_3D_PAGE':null,
      completedAt:completed?row.completedAt:null,
      responses:Object.freeze(completed?{...row.responses}:{}),
    });
  }));
}
export function inspectionCounts(session) {
  const counts=Object.fromEntries(Object.keys(INSPECTION_STATES).map(k=>[k,0]));
  for(const row of inspectionStateMap(session))counts[row.status]++;
  return Object.freeze(counts);
}
