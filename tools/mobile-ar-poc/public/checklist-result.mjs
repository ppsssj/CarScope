// Shared strict schema-v2 mechanics. Task identities and checklist keys remain profile-specific.
export const ANSWERS = Object.freeze({FOUND:'이상 징후 발견', NOT_FOUND:'발견하지 못함', UNABLE:'확인할 수 없음'});
export const isAnswer = value => typeof value === 'string' && Object.hasOwn(ANSWERS,value);
export const aggregateStatus = responses => Object.values(responses).includes('FOUND') ? 'REVIEW_NEEDED'
  : Object.values(responses).includes('UNABLE') ? 'UNABLE' : 'NO_FINDINGS_REPORTED';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const time = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const exact = (o, fields) => !!o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === fields.length && fields.every(k => Object.hasOwn(o,k));
const freeze = r => Object.freeze({...r, aids:Object.freeze({...r.aids}), responses:Object.freeze({...r.responses})});

export function createChecklistResult({matchesTask, checks}) {
  const keys = checks.map(c => c.id);
  function validate(r) {
    const errors = [];
    if (!r || typeof r !== 'object') return ['not an object'];
    const done = r.state === 'COMPLETED';
    if (!['IN_PROGRESS','COMPLETED'].includes(r.state)) return ['state'];
    if (!exact(r,['schemaVersion','inspectionId','taskId','method','source','state','startedAt','aids','responses',
      ...(done ? ['status','confirmation','completedAt','sync'] : [])])) errors.push('fields');
    if (r.schemaVersion !== 2 || !matchesTask(r.taskId)) errors.push('schema/task');
    if (typeof r.inspectionId !== 'string' || !uuid.test(r.inspectionId)) errors.push('inspectionId');
    if (r.method !== 'SELF' || r.source !== 'MOBILE') errors.push('origin');
    if (!time(r.startedAt)) errors.push('startedAt');
    if (!exact(r.aids,['cameraUsed','locationMarked']) || Object.values(r.aids ?? {}).some(v => typeof v !== 'boolean')) errors.push('aids');
    if (!r.responses || typeof r.responses !== 'object' || Array.isArray(r.responses)
      || Object.entries(r.responses).some(([k,v]) => !keys.includes(k) || !isAnswer(v))) errors.push('responses');
    if (done) {
      if (!exact(r.responses,keys) || !keys.every(k => isAnswer(r.responses?.[k]))) errors.push('incomplete');
      if (r.status !== aggregateStatus(r.responses ?? {})) errors.push('status');
      if (r.confirmation !== 'USER_REPORTED' || r.sync !== 'NOT_SENT') errors.push('confirmation/sync');
      if (!time(r.completedAt) || Date.parse(r.completedAt) < Date.parse(r.startedAt)) errors.push('completedAt');
    }
    return errors;
  }
  function start(taskId,{now=Date.now,newId=()=>crypto.randomUUID()}={}) {
    if (!matchesTask(taskId)) throw Error('Unknown checklist task');
    return freeze({schemaVersion:2,inspectionId:newId(),taskId,method:'SELF',source:'MOBILE',state:'IN_PROGRESS',
      startedAt:new Date(now()).toISOString(),aids:{cameraUsed:false,locationMarked:false},responses:{}});
  }
  function answer(record,id,value) {
    if (record.state !== 'IN_PROGRESS' || !keys.includes(id) || !isAnswer(value)) throw Error('Invalid checklist answer');
    return freeze({...record,responses:{...record.responses,[id]:value}});
  }
  function noteAids(record,aids) {
    if (record.state !== 'IN_PROGRESS') return record;
    return freeze({...record,aids:{cameraUsed:record.aids.cameraUsed || aids.cameraUsed === true,
      locationMarked:record.aids.locationMarked || aids.locationMarked === true}});
  }
  function complete(record,{now=Date.now}={}) {
    if (record.state !== 'IN_PROGRESS' || validate(record).length
      || !keys.every(k => isAnswer(record.responses[k]))) throw Error('Incomplete checklist result');
    const completedAt = new Date(now()).toISOString();
    if (Date.parse(completedAt) < Date.parse(record.startedAt)) throw Error('Time moved backwards');
    return freeze({...record,state:'COMPLETED',status:aggregateStatus(record.responses),confirmation:'USER_REPORTED',completedAt,sync:'NOT_SENT'});
  }
  return Object.freeze({start,answer,noteAids,complete,validate});
}
