import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARGE_TASK,TIRE_TASKS,parseInspectionHandoff} from '../public/inspection-tasks.mjs';
import {parseHandoff} from '../public/handoff.mjs';
import {CHARGE_CHECKS,CHARGE_ANSWERS,startChargeResult,answerCharge,completeChargeResult,validateChargeResult} from '../public/charge-result.mjs';
import {chargeProfile,getChecklistProfile} from '../public/checklist-profiles.mjs';
import {validateTireResult} from '../public/tire-result.mjs';
import {prepareTirePage,startTireInspectionPage} from '../public/tire-page.mjs';
const ctx={now:()=>Date.parse('2026-11-03T00:00:00.000Z'),newId:()=> '22222222-2222-4222-8222-222222222222'};
const initial=()=>chargeProfile.flow.initial(CHARGE_TASK.id),run=(s,e)=>chargeProfile.flow.reduce(s,e,ctx);
function ready(camera=false){return run(run(run(initial(),{type:'SAFETY',value:true}),{type:'NOT_CHARGING',value:true}),{type:'START',camera});}
function complete(answers=['NOT_FOUND','NOT_FOUND','UNABLE']) {let r=startChargeResult(CHARGE_TASK.id,ctx);for(const [i,c]of CHARGE_CHECKS.entries())r=answerCharge(r,c.id,answers[i]);return completeChargeResult(r,ctx);}

test('charge task is exact; v1 stays washer-only and local hints are not pairing',()=>{
  assert.equal(CHARGE_TASK.id,'ev-charge.port');assert.equal(parseInspectionHandoff('#task=ev-charge.port').task,CHARGE_TASK.id);
  for(const h of ['#task=ev-charge.flap','#task=ev-charge.port&vin=x','#task=ev-charge.port&task=ev-charge.port','#v=1&task=ev-charge.port'])assert.equal(parseInspectionHandoff(h).valid,false);
  assert.equal(parseHandoff('#v=1&task=washer-fluid').valid,true);
  for(const t of TIRE_TASKS)assert.equal(getChecklistProfile(t.id).id,t.id);
  assert.throws(()=>getChecklistProfile('ev-charge.flap'));
  assert.throws(()=>prepareTirePage(CHARGE_TASK.id),/Unknown tire task/);
  assert.throws(()=>startTireInspectionPage({handoff:{task:CHARGE_TASK.id}}),/Unknown tire task/);
});
test('both parking and not-charging confirmations gate camera and manual START',()=>{
  for(const camera of [false,true])for(const parked of [false,true])for(const notCharging of [false,true]){
    let s=run(run(initial(),{type:'SAFETY',value:parked}),{type:'NOT_CHARGING',value:notCharging});const next=run(s,{type:'START',camera});
    assert.equal(next!==s,parked&&notCharging);if(next!==s)assert.deepEqual(next.record.responses,{});
  }
});
test('27 response combinations retain tri-state meanings and exact computed status',()=>{
  for(const a of Object.keys(CHARGE_ANSWERS))for(const b of Object.keys(CHARGE_ANSWERS))for(const c of Object.keys(CHARGE_ANSWERS)){
    const r=complete([a,b,c]);assert.deepEqual(validateChargeResult(r),[]);assert.deepEqual(Object.values(r.responses),[a,b,c]);
    assert.equal(r.status,[a,b,c].includes('FOUND')?'REVIEW_NEEDED':[a,b,c].includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED');
    assert.ok(validateTireResult(r).length);assert.equal(r.confirmation,'USER_REPORTED');assert.equal(r.sync,'NOT_SENT');
  }
});
test('strict result rejects partials, invalid times, UUIDs, extra data and cross-part schemas',()=>{
  const r=complete();assert.throws(()=>completeChargeResult(startChargeResult(CHARGE_TASK.id,ctx),ctx),/Incomplete/);
  for(const patch of [{schemaVersion:1},{inspectionId:'bad'},{taskId:'tire.front-left'},{status:'OK'},{sync:'SENT'},{confirmation:'PLEOS'},
    {responses:{flapDamage:'FOUND'}},{responses:{...r.responses,debris:'CLEAN'}},{responses:{...r.responses,wear:'UNABLE'}},
    {aids:{...r.aids,x:.5}},{completedAt:'2026-02-30T00:00:00.000Z'},{completedAt:'2026-11-02T00:00:00.000Z'}])assert.ok(validateChargeResult({...r,...patch}).length);
  for(const key of ['photo','video','gps','vin','sdk','token','tap'])assert.ok(validateChargeResult({...r,[key]:'forbidden'}).length);
});
test('partial answers cannot advance; Back edits, old attempts and duplicate confirmation are guarded',()=>{
  let s=ready();assert.equal(run(s,{type:'NEXT',index:0}),s);assert.equal(run(s,{type:'CONFIRM'}),s);
  for(const [i,c]of CHARGE_CHECKS.entries()){s=run(s,{type:'ANSWER',checkId:c.id,answer:'UNABLE'});const e={type:'NEXT',index:i};s=run(s,e);assert.equal(run(s,e),s);}
  s=run(s,{type:'BACK'});s=run(s,{type:'ANSWER',checkId:'visibleDamage',answer:'NOT_FOUND'});s=run(s,{type:'NEXT',index:2});s=run(s,{type:'CONFIRM'});
  assert.equal(s.record.responses.visibleDamage,'NOT_FOUND');assert.equal(run(s,{type:'CONFIRM'}),s);assert.equal(run(s,{type:'CANCEL'}),s);
  const fresh=run(s,{type:'RESTART'});assert.equal(fresh.safe,false);assert.equal(fresh.notCharging,false);assert.equal(fresh.record,null);
  assert.equal(run(fresh,{type:'NOTE_AIDS',cameraUsed:true,attemptId:s.record.inspectionId}),fresh);
});
test('finding stops further camera observation without filling unanswered items; edits cannot resume it',()=>{
  let s=run(ready(true),{type:'TO_CHECK'});s=run(s,{type:'ANSWER',checkId:'flapDamage',answer:'FOUND'});
  assert.equal(s.mode,'manual');assert.equal(s.observationStopped,true);assert.deepEqual(s.record.responses,{flapDamage:'FOUND'});
  s=run(s,{type:'ANSWER',checkId:'flapDamage',answer:'NOT_FOUND'});assert.equal(s.mode,'manual');assert.equal(s.observationStopped,true);
  s=run(s,{type:'NEXT',index:0});assert.equal(run(s,{type:'NEXT',index:1}),s);
  assert.equal(run(s,{type:'NOT_CHARGING',value:false}),s);assert.equal(run(s,{type:'CANCEL'}).record,null);
});
test('user can stop uncertain/changed observation from locate without synthesizing an answer',()=>{
  const s=run(ready(true),{type:'STOP_OBSERVATION'});assert.equal(s.step,'check');assert.equal(s.mode,'manual');assert.deepEqual(s.record.responses,{});
  assert.equal(s.observationStopped,true);assert.equal(run(s,{type:'ANSWER',checkId:'debris',answer:'UNABLE'}),s);
});
