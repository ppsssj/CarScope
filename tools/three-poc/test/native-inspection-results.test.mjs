import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MOBILE_TARGETS,validateMobileResult,digestResult,targetForPart,mobileReportState} from '../mobile-result-contract.mjs';
import {createNativeInspectionResults} from '../native-inspection-results.mjs';
import {projectInspectionResults,resultCounts} from '../inspection-results.mjs';
import {partResultHtml,resultSummaryHtml} from '../inspection-results-view.mjs';
import {createTireInspection,updateTireInspection} from '../tire-inspection.mjs';
import {resultDigest,SUPPORTED_TASKS} from '../../inspection-sync-poc/src/protocol.mjs';
import {taskContract} from '../../native-task-sync/contract.mjs';
import {wireResult,testAuthority} from './result-fixtures.mjs';
import {initialState,transition,hoodTarget,cameraGoal,INSPECTION_AREAS} from '../inspection-flow.mjs';
const binding=(callbacks,target,id='bind')=>({bindingId:id,localSessionId:callbacks.localSessionId,generation:callbacks.generation,syncSessionId:'sync-'+id,taskId:target.taskId,partId:target.partId,serverNow:1000,expiresAt:2000});
async function deliver(callbacks,b,result){return callbacks.onAccepted({bindingId:b.bindingId,localSessionId:b.localSessionId,generation:b.generation,syncSessionId:b.syncSessionId,taskId:b.taskId,inspectionId:result.inspectionId,resultDigest:await digestResult(result),result});}
function setup(){const authority=testAuthority();let time=0;const controller=createNativeInspectionResults({adapter:authority.adapter,now:()=>time});controller.startSession('local');return {authority,controller,clock:t=>time=t};}
test('mapping covers the exact 17 mobile/server tasks and existing + extension part contracts',()=>{
  assert.equal(MOBILE_TARGETS.length,17);assert.deepEqual(MOBILE_TARGETS.map(t=>t.taskId).sort(),[...SUPPORTED_TASKS].sort());
  assert.deepEqual(MOBILE_TARGETS.map(t=>({taskId:t.taskId,partId:t.partId,schemaVersion:t.schemaVersion,responseKeys:[...t.responseKeys].sort()})),taskContract,'frontend matches the merged Native 17-task metadata contract');
  for(const [file,marker,key]of [['mobile-result-to-3d-session-v1.md','mobile-3d-contract:v1','taskBindings'],['p7-b-mobile-tasks-v2.md','p7-b-task-contract','tasks']]){
    const text=readFileSync(new URL('../../../docs/contracts/'+file,import.meta.url),'utf8');const spec=JSON.parse(text.split('<!-- '+marker+' -->')[1].match(/```json\s*([\s\S]*?)```/)[1]);
    for(const t of spec[key]){const row=MOBILE_TARGETS.find(r=>r.taskId===t.taskId);assert.equal(row.partId,t.partId);assert.equal(row.schemaVersion,t.schemaVersion);assert.deepEqual(row.responseKeys,t.responseKeys);}
  }
  assert.equal(targetForPart('ev-charge.flap'),undefined);
  const parts=INSPECTION_AREAS.flatMap(a=>a.components.map(c=>c.id));for(const t of MOBILE_TARGETS)assert.ok(parts.includes(t.partId));
});
test('all 17 result details use the existing component camera and explicit list-only LCW fallback; closing cannot be interrupted',()=>{
  const idle=initialState(),overview=transition(idle,{type:'START'});assert.equal(transition(idle,{type:'OPEN_RESULT',id:'washer-fluid-cap'}),idle);
  for(const t of MOBILE_TARGETS){const detail=transition(overview,{type:'OPEN_RESULT',id:t.partId});assert.equal(detail.name,'PART_RESULT');assert.equal(detail.component,t.partId);assert.equal(detail.area,t.area);
    assert.equal(cameraGoal(detail),t.partId==='lcw-coolant-reservoir'?'bay':t.partId);assert.equal(hoodTarget(detail),t.area==='hood'?60:0);
    const back=transition(detail,{type:'BACK'});if(t.area==='hood'){assert.equal(back.name,'HOOD_CLOSING');assert.equal(transition(back,{type:'OPEN_RESULT',id:t.partId}),back);assert.equal(transition(back,{type:'HOOD_CLOSED'}).name,'INSPECTION_SUMMARY');}else assert.equal(back.name,'INSPECTION_SUMMARY');
    const exit=transition(detail,{type:'EXIT'});assert.equal(t.area==='hood'?transition(exit,{type:'HOOD_CLOSED'}).name:exit.name,'IDLE');
  }
  assert.equal(transition(overview,{type:'OPEN_RESULT',id:'ev-charge.flap'}),overview);
});
for(const t of MOBILE_TARGETS)test(`${t.taskId}: strict boundary, unchanged digest, staged then explicit selection, provenance and independent counts`,async()=>{
  if(t.schemaVersion===2)for(const a of ['FOUND','UNABLE','NOT_FOUND'])for(const b of ['FOUND','UNABLE','NOT_FOUND'])for(const c of ['FOUND','UNABLE','NOT_FOUND']){const actual=wireResult(t.taskId,[a,b,c]);assert.equal(validateMobileResult(actual),true);assert.equal(await digestResult(actual),await resultDigest(actual));}
  const {authority:a,controller:c}=setup(),local=createTireInspection('local'),b=binding(a.callbacks,t);assert.equal(a.callbacks.onBinding(b),'BOUND');
  for(const value of ['FOUND','UNABLE','NOT_FOUND']){
    const id=['FOUND','UNABLE','NOT_FOUND'].indexOf(value)+1,r=wireResult(t.taskId,value,`${id}1111111-1111-4111-8111-111111111111`);
    assert.equal(validateMobileResult(r),true);assert.equal(await digestResult(r),await resultDigest(r));
    assert.equal(await deliver(a.callbacks,b,r),'STAGED');
    if(value==='FOUND')assert.equal(resultCounts(projectInspectionResults(local,c.snapshot)).NOT_INSPECTED,17,'receipt never auto-applies');
    assert.equal(c.select(t.taskId,r.inspectionId),true);const rows=projectInspectionResults(local,c.snapshot),mapped=rows.find(row=>row.taskId===t.taskId);
    assert.equal(mapped.status,mobileReportState(r));assert.equal(mapped.source,'MOBILE');assert.equal(mapped.confirmation,'USER_REPORTED');assert.equal(mapped.completedAt,r.completedAt);
    assert.deepEqual(mapped.original,r);assert.equal(mapped.proof.sessionState,'ACCEPTED');assert.equal(mapped.syncSessionId,b.syncSessionId);assert.equal(mapped.bindingId,b.bindingId);
    assert.equal(rows.filter(row=>row.status!=='NOT_INSPECTED').length,1);assert.equal(Object.values(resultCounts(rows)).reduce((n,v)=>n+v),17);
    for(const patch of [{schemaVersion:3},{taskId:'unknown'},{completedAt:'2026-02-30T00:00:00.000Z'},{startedAt:['2026-11-04T01:02:03.000Z']},{inspectionId:[r.inspectionId]},{photo:'forbidden'},{aids:{cameraUsed:1,locationMarked:false}},{status:'HEALTHY'}])assert.equal(validateMobileResult({...r,...patch}),false);
    if(t.schemaVersion===2){assert.equal(validateMobileResult({...r,responses:{}}),false);assert.equal(validateMobileResult({...r,responses:{...r.responses,extra:'FOUND'}}),false);}
  }
  assert.ok(Object.isFrozen(c.snapshot.records[0].result));assert.equal(c.select(t.taskId,'LOCAL'),true);assert.equal(resultCounts(projectInspectionResults(local,c.snapshot)).NOT_INSPECTED,17);c.dispose();
});
test('no adapter, ordinary JSON, unsupported schemas and invalid proof never create records',async()=>{
  const c=createNativeInspectionResults();assert.equal(c.startSession('local'),false);assert.equal(c.snapshot.connection,'INCOMPLETE_NATIVE');assert.equal(c.receive,undefined);assert.equal(c.onAccepted,undefined);assert.equal(c.request('washer-fluid'),false);assert.equal(c.snapshot.records.length,0);c.dispose();
  for(const patch of [{sessionState:'RESULT_SUBMITTED'},{inspectionId:'wrong'},{taskId:'brake-fluid'},{resultDigest:'sha256:'+'0'.repeat(64)},{syncSessionId:'other'},{generation:999},{acceptedAt:2001},{acceptedAt:1000},{trusted:true}]){
    const {authority:a,controller:c}=setup(),b=binding(a.callbacks,MOBILE_TARGETS[0]);a.callbacks.onBinding(b);a.patch(patch);await deliver(a.callbacks,b,wireResult());assert.equal(c.snapshot.records.length,0,JSON.stringify(patch));c.dispose();
  }
});
test('duplicate retains first proof, cross-task/session and conflicting content are refused',async()=>{
  const {authority:a,controller:c}=setup(),b=binding(a.callbacks,MOBILE_TARGETS[0]),r=wireResult();a.callbacks.onBinding(b);assert.equal(await deliver(a.callbacks,b,r),'STAGED');
  const first=c.snapshot.records[0];a.patch({proofId:'replacement-proof'});assert.equal(await deliver(a.callbacks,b,r),'DUPLICATE');assert.deepEqual(c.snapshot.records[0],first);
  assert.equal(await deliver(a.callbacks,b,wireResult('washer-fluid','FOUND')),'RESULT_CONFLICT');
  assert.equal(await deliver(a.callbacks,b,wireResult('brake-fluid')),'INVALID_RESULT');
  const other=binding(a.callbacks,MOBILE_TARGETS[6],'other-task');a.callbacks.onBinding(other);assert.equal(await deliver(a.callbacks,other,wireResult('brake-fluid')),'RESULT_CONFLICT');assert.deepEqual(c.snapshot.records[0],first);
  const second=binding(a.callbacks,MOBILE_TARGETS[0],'second');assert.equal(a.callbacks.onBinding(second),'BOUND');assert.equal(await deliver(a.callbacks,second,r),'DUPLICATE');assert.deepEqual(c.snapshot.records[0],first);
  assert.equal(a.callbacks.onBinding({...b,bindingId:'different',taskId:'brake-fluid',partId:'brake-fluid-reservoir'}),'BINDING_CONFLICT');
  assert.equal(c.select('brake-fluid',r.inspectionId),false);c.dispose();
});
test('monotonic expiry, terminal states, end/recreation, delayed callbacks and hash/proof races stay isolated',async()=>{
  for(const terminal of ['EXPIRED','CANCELLED','CLOSED']){
    const {authority:a,controller:c,clock}=setup(),b=binding(a.callbacks,MOBILE_TARGETS[0]),r=wireResult();a.callbacks.onBinding(b);await deliver(a.callbacks,b,r);
    if(terminal==='EXPIRED'){clock(1001);c.tick();}else a.callbacks.onTerminal({bindingId:b.bindingId,syncSessionId:b.syncSessionId,state:terminal});
    assert.equal(c.select(r.taskId,r.inspectionId),false);assert.equal(c.snapshot.selected[r.taskId],undefined);c.dispose();
  }
  const {authority:a,controller:c,clock}=setup(),b=binding(a.callbacks,MOBILE_TARGETS[0]),r=wireResult();a.callbacks.onBinding(b);await deliver(a.callbacks,b,r);c.select(r.taskId,r.inspectionId);clock(1001);c.tick();assert.equal(projectInspectionResults(createTireInspection('local'),c.snapshot)[0].status,'UNABLE','applied accepted report remains after transport expiry');
  const old=a.callbacks;c.endSession();c.startSession('local');assert.equal(old.onBinding(b),'OLD_SESSION');assert.equal(await deliver(old,b,r),'OLD_SESSION');assert.equal(c.snapshot.records.length,0);
  let release;a.delay(()=>new Promise(resolve=>release=resolve));const next=binding(a.callbacks,MOBILE_TARGETS[0],'next');a.callbacks.onBinding(next);const pending=deliver(a.callbacks,next,r);while(!release)await new Promise(resolve=>setTimeout(resolve,0));c.endSession();release();assert.equal(await pending,'OLD_SESSION');assert.equal(c.snapshot.records.length,0);c.dispose();
});
test('local drafts/completions and mobile reports never overwrite or merge, including later local edits',async()=>{
  const t=MOBILE_TARGETS[1],{authority:a,controller:c}=setup(),b=binding(a.callbacks,t);let local=createTireInspection('local');
  for(const key of t.responseKeys)local=updateTireInspection(local,{type:'ANSWER',sessionId:'local',tireId:t.partId,checkId:key,answer:'FOUND'});
  local=updateTireInspection(local,{type:'CONFIRM',sessionId:'local',tireId:t.partId,at:12345});const before=JSON.stringify(local);a.callbacks.onBinding(b);const r=wireResult(t.taskId,'NOT_FOUND');await deliver(a.callbacks,b,r);assert.equal(JSON.stringify(local),before);
  c.select(t.taskId,r.inspectionId);assert.equal(projectInspectionResults(local,c.snapshot)[1].status,'NO_FINDINGS_REPORTED');
  local=updateTireInspection(local,{type:'ANSWER',sessionId:'local',tireId:t.partId,checkId:'wear',answer:'UNABLE'});assert.equal(projectInspectionResults(local,c.snapshot)[1].status,'NO_FINDINGS_REPORTED');
  c.select(t.taskId,'LOCAL');assert.equal(projectInspectionResults(local,c.snapshot)[1].status,'NOT_INSPECTED');assert.equal(local.tires[t.partId].responses.damage,'FOUND');
  assert.match(partResultHtml(local,c.snapshot,t.partId),/로컬 응답과 모바일 응답은 별도로/);assert.match(resultSummaryHtml(local,c.snapshot),/17개 부품/);assert.match(partResultHtml(local,c.snapshot,t.partId),/2026-11-04T01:02:03.000Z/);c.dispose();
});
test('session change during asynchronous SHA-256 and terminal change during verification cannot stage a result',async()=>{
  const a=testAuthority();let releaseHash;const c=createNativeInspectionResults({adapter:a.adapter,now:()=>0,hash:()=>new Promise(resolve=>releaseHash=resolve)});c.startSession('local');
  const b=binding(a.callbacks,MOBILE_TARGETS[0]),r=wireResult();a.callbacks.onBinding(b);const waiting=deliver(a.callbacks,b,r);
  while(!releaseHash)await new Promise(resolve=>setTimeout(resolve,0));c.endSession();releaseHash(await digestResult(r));assert.equal(await waiting,'OLD_SESSION');assert.equal(c.snapshot.records.length,0);c.dispose();
  const s=setup(),next=binding(s.authority.callbacks,MOBILE_TARGETS[0]);s.authority.callbacks.onBinding(next);let releaseProof;s.authority.delay(()=>new Promise(resolve=>releaseProof=resolve));const pending=deliver(s.authority.callbacks,next,r);
  while(!releaseProof)await new Promise(resolve=>setTimeout(resolve,0));s.authority.callbacks.onTerminal({bindingId:next.bindingId,syncSessionId:next.syncSessionId,state:'CANCELLED'});releaseProof();assert.equal(await pending,'OLD_SESSION');assert.equal(s.controller.snapshot.records.length,0);s.controller.dispose();
});
test('unavailable adapter revokes its callback capability, including fresh bindings and late verification',async()=>{
  const {authority:a,controller:c}=setup(),old=a.callbacks,b=binding(old,MOBILE_TARGETS[0]),r=wireResult();old.onBinding(b);
  let release;a.delay(()=>new Promise(resolve=>release=resolve));const pending=deliver(old,b,r);while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  old.onUnavailable();release();assert.equal(await pending,'OLD_SESSION');assert.equal(c.snapshot.connection,'UNAVAILABLE');assert.equal(old.onBinding(binding(old,MOBILE_TARGETS[0],'late')),'OLD_SESSION');assert.equal(await deliver(old,b,r),'OLD_SESSION');assert.equal(c.snapshot.records.length,0);assert.equal(c.request(r.taskId),false);c.dispose();
});
