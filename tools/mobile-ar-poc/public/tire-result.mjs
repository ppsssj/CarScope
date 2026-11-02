import {isTireTask} from './inspection-tasks.mjs';
export const TIRE_CHECKS=Object.freeze([
  {id:'damage',label:'갈라짐이나 손상',help:'타이어 옆면과 보이는 바닥 면에서 갈라짐, 찢어짐, 불룩한 부분처럼 눈에 띄는 모습을 살펴보세요. 손으로 만지거나 분해하지 마세요.'},
  {id:'debris',label:'눈에 띄는 이물질',help:'못이나 돌처럼 박혀 보이는 물체가 있는지 보이는 부분만 살펴보세요. 박힌 물체를 빼지 마세요.'},
  {id:'wear',label:'고르지 않게 닳은 모습',help:'보이는 타이어 바닥 면이 한쪽만 더 닳아 보이는지 살펴보세요. 이 화면은 홈 깊이를 재거나 교체 시기를 판정하지 않습니다.'},
].map(Object.freeze));
export const TIRE_ANSWERS=Object.freeze({FOUND:'이상 징후 발견',NOT_FOUND:'발견하지 못함',UNABLE:'확인할 수 없음'});
export const tireStatus=r=>Object.values(r).includes('FOUND')?'REVIEW_NEEDED':Object.values(r).includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const time=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const exact=(o,fields)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===fields.length&&fields.every(k=>Object.hasOwn(o,k));
const freeze=r=>Object.freeze({...r,aids:Object.freeze({...r.aids}),responses:Object.freeze({...r.responses})});
export function startTireResult(taskId,{now=Date.now,newId=()=>crypto.randomUUID()}={}){if(!isTireTask(taskId))throw Error('Unknown tire task');return freeze({schemaVersion:2,inspectionId:newId(),taskId,method:'SELF',source:'MOBILE',state:'IN_PROGRESS',startedAt:new Date(now()).toISOString(),aids:{cameraUsed:false,locationMarked:false},responses:{}});}
export function answerTire(record,id,answer){if(record.state!=='IN_PROGRESS'||!TIRE_CHECKS.some(c=>c.id===id)||!Object.hasOwn(TIRE_ANSWERS,answer))throw Error('Invalid tire answer');return freeze({...record,responses:{...record.responses,[id]:answer}});}
export function noteTireAids(record,aids){if(record.state!=='IN_PROGRESS')return record;return freeze({...record,aids:{cameraUsed:record.aids.cameraUsed||aids.cameraUsed===true,locationMarked:record.aids.locationMarked||aids.locationMarked===true}});}
export function completeTireResult(record,{now=Date.now}={}){if(record.state!=='IN_PROGRESS'||validateTireResult(record).length||!TIRE_CHECKS.every(c=>Object.hasOwn(TIRE_ANSWERS,record.responses[c.id])))throw Error('Incomplete tire result');const completedAt=new Date(now()).toISOString();if(Date.parse(completedAt)<Date.parse(record.startedAt))throw Error('Time moved backwards');return freeze({...record,state:'COMPLETED',status:tireStatus(record.responses),confirmation:'USER_REPORTED',completedAt,sync:'NOT_SENT'});}
export function validateTireResult(r){const errors=[];if(!r||typeof r!=='object')return ['not an object'];const done=r.state==='COMPLETED';if(!['IN_PROGRESS','COMPLETED'].includes(r.state))return ['state'];
  if(!exact(r,['schemaVersion','inspectionId','taskId','method','source','state','startedAt','aids','responses',...(done?['status','confirmation','completedAt','sync']:[])]))errors.push('fields');
  if(r.schemaVersion!==2||!isTireTask(r.taskId))errors.push('schema/task');if(!uuid.test(r.inspectionId))errors.push('inspectionId');if(r.method!=='SELF'||r.source!=='MOBILE')errors.push('origin');if(!time(r.startedAt))errors.push('startedAt');
  if(!exact(r.aids,['cameraUsed','locationMarked'])||Object.values(r.aids??{}).some(v=>typeof v!=='boolean'))errors.push('aids');
  if(!r.responses||typeof r.responses!=='object'||Array.isArray(r.responses)||Object.entries(r.responses).some(([k,v])=>!TIRE_CHECKS.some(c=>c.id===k)||!Object.hasOwn(TIRE_ANSWERS,v)))errors.push('responses');
  if(done){if(!exact(r.responses,TIRE_CHECKS.map(c=>c.id))||!TIRE_CHECKS.every(c=>Object.hasOwn(TIRE_ANSWERS,r.responses?.[c.id])))errors.push('incomplete');if(r.status!==tireStatus(r.responses??{}))errors.push('status');if(r.confirmation!=='USER_REPORTED'||r.sync!=='NOT_SENT')errors.push('confirmation/sync');if(!time(r.completedAt)||Date.parse(r.completedAt)<Date.parse(r.startedAt))errors.push('completedAt');}
  return errors;
}
