import test from 'node:test';
import assert from 'node:assert/strict';
import {BRAKE_TASK,TIRE_TASKS,parseInspectionHandoff} from '../public/inspection-tasks.mjs';
import {parseHandoff} from '../public/handoff.mjs';
import {BRAKE_CHECKS,BRAKE_ANSWERS,startBrakeResult,answerBrake,completeBrakeResult,validateBrakeResult} from '../public/brake-result.mjs';
import {brakeProfile,getChecklistProfile} from '../public/checklist-profiles.mjs';
import {validateTireResult} from '../public/tire-result.mjs';
import {prepareTirePage,startTireInspectionPage} from '../public/tire-page.mjs';
const ctx={now:()=>Date.parse('2026-11-03T00:00:00.000Z'),newId:()=> '22222222-2222-4222-8222-222222222222'};
const initial=()=>brakeProfile.flow.initial(BRAKE_TASK.id),run=(s,e)=>brakeProfile.flow.reduce(s,e,ctx);
function ready(camera=false){return run(run(initial(),{type:'SAFETY',value:true}),{type:'START',camera});}
function complete(answers=['NOT_FOUND','NOT_FOUND','UNABLE']) {let r=startBrakeResult(BRAKE_TASK.id,ctx);for(const [i,c]of BRAKE_CHECKS.entries())r=answerBrake(r,c.id,answers[i]);return completeBrakeResult(r,ctx);}

test('brake task is exact; v1 stays washer-only and local hints are not pairing',()=>{
  assert.equal(BRAKE_TASK.id,'brake-fluid');assert.equal(parseInspectionHandoff('#task=brake-fluid').task,BRAKE_TASK.id);
  for(const h of ['#task=brake-fluid.other','#task=brake-fluid&vin=x','#task=brake-fluid&task=brake-fluid','#v=1&task=brake-fluid'])assert.equal(parseInspectionHandoff(h).valid,false);
  assert.equal(parseHandoff('#v=1&task=washer-fluid').valid,true);
  for(const t of TIRE_TASKS)assert.equal(getChecklistProfile(t.id).id,t.id);
  assert.throws(()=>getChecklistProfile('brake-fluid.other'));
  assert.throws(()=>prepareTirePage(BRAKE_TASK.id),/Unknown tire task/);
  assert.throws(()=>startTireInspectionPage({handoff:{task:BRAKE_TASK.id}}),/Unknown tire task/);
});
test('bonnet safety confirmation gates both camera and manual START',()=>{
  for(const camera of [false,true])for(const safe of [false,true]){
    const s=run(initial(),{type:'SAFETY',value:safe}),next=run(s,{type:'START',camera});
    assert.equal(next!==s,safe);if(next!==s)assert.deepEqual(next.record.responses,{});
  }
  const s=initial();assert.equal(run(s,{type:'NOT_CHARGING',value:true}),s);
});

test('27 response combinations retain tri-state meanings and exact computed status',()=>{
  for(const a of Object.keys(BRAKE_ANSWERS))for(const b of Object.keys(BRAKE_ANSWERS))for(const c of Object.keys(BRAKE_ANSWERS)){
    const r=complete([a,b,c]);assert.deepEqual(validateBrakeResult(r),[]);assert.deepEqual(Object.values(r.responses),[a,b,c]);
    assert.equal(r.status,[a,b,c].includes('FOUND')?'REVIEW_NEEDED':[a,b,c].includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED');
    assert.ok(validateTireResult(r).length);assert.equal(r.confirmation,'USER_REPORTED');assert.equal(r.sync,'NOT_SENT');
  }
});
test('strict result rejects partials, invalid times, UUIDs, extra data and cross-part schemas',()=>{
  const r=complete();assert.throws(()=>completeBrakeResult(startBrakeResult(BRAKE_TASK.id,ctx),ctx),/Incomplete/);
  for(const patch of [{schemaVersion:1},{inspectionId:'bad'},{taskId:'tire.front-left'},{status:'OK'},{sync:'SENT'},{confirmation:'PLEOS'},
    {responses:{levelMarking:'FOUND'}},{responses:{...r.responses,leakTrace:'CLEAN'}},{responses:{...r.responses,wear:'UNABLE'}},
    {aids:{...r.aids,x:.5}},{completedAt:'2026-02-30T00:00:00.000Z'},{completedAt:'2026-11-02T00:00:00.000Z'}])assert.ok(validateBrakeResult({...r,...patch}).length);
  for(const key of ['photo','video','gps','vin','sdk','token','tap'])assert.ok(validateBrakeResult({...r,[key]:'forbidden'}).length);
});
test('v2 validators reject enum/UUID coercion without throwing, including legacy tires',()=>{
  for(const id of [BRAKE_TASK.id,...TIRE_TASKS.map(t=>t.id)]){
    const profile=getChecklistProfile(id),key=profile.checks[0].id;let r=profile.result.start(id,ctx);
    for(const c of profile.checks)r=profile.result.answer(r,c.id,'UNABLE');r=profile.result.complete(r,ctx);
    assert.ok(profile.result.validate({...r,inspectionId:[r.inspectionId]}).length);
    for(const value of [['UNABLE'],{toString:null},null,true,1]){
      assert.ok(profile.result.validate({...r,responses:{...r.responses,[key]:value}}).length);
      let s=profile.flow.reduce(profile.flow.initial(id),{type:'SAFETY',value:true},ctx);
      if(profile.requiresNotCharging)s=profile.flow.reduce(s,{type:'NOT_CHARGING',value:true},ctx);
      s=profile.flow.reduce(s,{type:'START',camera:false},ctx);assert.equal(s.step,'check');
      assert.equal(profile.flow.reduce(s,{type:'ANSWER',checkId:key,answer:value}),s);
      assert.throws(()=>profile.result.answer(profile.result.start(id,ctx),key,value),/Invalid checklist answer/);
    }
  }
});
test('partial answers cannot advance; Back edits, old attempts and duplicate confirmation are guarded',()=>{
  let s=ready();assert.equal(run(s,{type:'NEXT',index:0}),s);assert.equal(run(s,{type:'CONFIRM'}),s);
  for(const [i,c]of BRAKE_CHECKS.entries()){s=run(s,{type:'ANSWER',checkId:c.id,answer:'UNABLE'});const e={type:'NEXT',index:i};s=run(s,e);assert.equal(run(s,e),s);}
  s=run(s,{type:'BACK'});s=run(s,{type:'ANSWER',checkId:'exteriorDamage',answer:'NOT_FOUND'});s=run(s,{type:'NEXT',index:2});s=run(s,{type:'CONFIRM'});
  assert.equal(s.record.responses.exteriorDamage,'NOT_FOUND');assert.equal(run(s,{type:'CONFIRM'}),s);assert.equal(run(s,{type:'CANCEL'}),s);
  const fresh=run(s,{type:'RESTART'});assert.equal(fresh.safe,false);assert.equal(fresh.observationStopped,false);assert.equal(fresh.record,null);
  assert.equal(run(fresh,{type:'NOTE_AIDS',cameraUsed:true,attemptId:s.record.inspectionId}),fresh);
});
test('finding stops further camera observation without filling unanswered items; edits cannot resume it',()=>{
  let s=run(ready(true),{type:'TO_CHECK'});s=run(s,{type:'ANSWER',checkId:'levelMarking',answer:'FOUND'});
  assert.equal(s.mode,'manual');assert.equal(s.observationStopped,true);assert.deepEqual(s.record.responses,{levelMarking:'FOUND'});
  s=run(s,{type:'ANSWER',checkId:'levelMarking',answer:'NOT_FOUND'});assert.equal(s.mode,'manual');assert.equal(s.observationStopped,true);
  s=run(s,{type:'NEXT',index:0});assert.equal(run(s,{type:'NEXT',index:1}),s);
  assert.equal(run(s,{type:'NOT_CHARGING',value:false}),s);assert.equal(run(s,{type:'CANCEL'}).record,null);
});
test('user can stop uncertain/changed observation from locate without synthesizing an answer',()=>{
  const s=run(ready(true),{type:'STOP_OBSERVATION'});assert.equal(s.step,'check');assert.equal(s.mode,'manual');assert.deepEqual(s.record.responses,{});
  assert.equal(s.observationStopped,true);assert.equal(run(s,{type:'ANSWER',checkId:'leakTrace',answer:'UNABLE'}),s);
});

test('brake profile preserves external-only limits and does not invent measured or vehicle state',()=>{
  const p=brakeProfile;
  assert.match(p.position,/보닛 내부/);assert.match(p.position,/사용설명서/);
  assert.match(p.safetyHelp,/캡 개방·직접 보충·분해/);
  assert.match(p.locateHelp,/워셔액·냉각수/);
  assert.match(p.checks[0].help,/식별/);assert.match(p.checks[0].help,/확인할 수 없음/);
  const r=complete(['UNABLE','UNABLE','UNABLE']);assert.equal(r.status,'UNABLE');
  assert.deepEqual(r.aids,{cameraUsed:false,locationMarked:false});
  assert.equal(p.requiresNotCharging,undefined);
});
