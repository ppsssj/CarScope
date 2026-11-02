import test from 'node:test';import assert from 'node:assert/strict';
import {TIRE_TASKS,parseInspectionHandoff} from '../public/inspection-tasks.mjs';
import {parseHandoff} from '../public/handoff.mjs';
import {TIRE_CHECKS,TIRE_ANSWERS,startTireResult,completeTireResult,validateTireResult,answerTire} from '../public/tire-result.mjs';
import {initialTireState,reduceTire} from '../public/tire-flow.mjs';import {actionGate} from '../public/inspection-ui.mjs';
const ctx={now:()=>Date.parse('2026-11-03T00:00:00.000Z'),newId:()=> '11111111-1111-4111-8111-111111111111'};
const run=(s,e)=>reduceTire(s,e,ctx);
for(const task of TIRE_TASKS)test(task.id+': safety -> three individual answers -> review -> one immutable confirmation',()=>{
  let s=initialTireState(task.id);assert.equal(run(s,{type:'START',camera:false}),s);s=run(s,{type:'SAFETY',value:true});s=run(s,{type:'START',camera:false});assert.equal(s.step,'check');
  for(const [i,c]of TIRE_CHECKS.entries()){assert.equal(run(s,{type:'NEXT',index:i}),s);s=run(s,{type:'ANSWER',checkId:c.id,answer:['FOUND','NOT_FOUND','UNABLE'][i]});assert.equal(s.index,i);const e={type:'NEXT',index:i};s=run(s,e);assert.equal(run(s,e),s);}
  assert.equal(s.step,'review');const before=s;s=run(s,{type:'CONFIRM'});assert.equal(s.step,'done');assert.equal(s.record.taskId,task.id);assert.equal(s.record.status,'REVIEW_NEEDED');assert.deepEqual(validateTireResult(s.record),[]);
  assert.equal(run(s,{type:'CONFIRM'}),s);assert.equal(run(s,{type:'ANSWER',checkId:'damage',answer:'NOT_FOUND'}),s);assert.equal(before.record.state,'IN_PROGRESS');assert.equal(run(s,{type:'RESTART'}).record,null);
});
test('all answer combinations preserve FOUND/NOT_FOUND/UNABLE; never complete a partial checklist',()=>{
  for(const a of Object.keys(TIRE_ANSWERS))for(const b of Object.keys(TIRE_ANSWERS))for(const c of Object.keys(TIRE_ANSWERS)){
    let r=startTireResult(TIRE_TASKS[0].id,ctx);for(const [i,v]of[a,b,c].entries())r=answerTire(r,TIRE_CHECKS[i].id,v);const done=completeTireResult(r,ctx);assert.deepEqual(validateTireResult(done),[]);assert.deepEqual(Object.values(done.responses),[a,b,c]);
    assert.equal(done.status,[a,b,c].includes('FOUND')?'REVIEW_NEEDED':[a,b,c].includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED');}
  assert.throws(()=>completeTireResult(startTireResult(TIRE_TASKS[0].id,ctx),ctx),/Incomplete/);
});
test('back, cancel, restart, stale attempts and impossible transitions preserve task isolation',()=>{
  let s=run(run(initialTireState(TIRE_TASKS[0].id),{type:'SAFETY',value:true}),{type:'START',camera:true});assert.equal(run(s,{type:'CONFIRM'}),s);assert.equal(run(s,{type:'ANSWER',checkId:'damage',answer:'FOUND'}),s);
  s=run(s,{type:'TO_CHECK'});s=run(s,{type:'ANSWER',checkId:'damage',answer:'UNABLE'});s=run(s,{type:'NEXT',index:0});assert.equal(run(s,{type:'ANSWER',checkId:'damage',answer:'FOUND'}),s);
  s=run(s,{type:'BACK'});assert.equal(s.record.responses.damage,'UNABLE');assert.equal(s.index,0);s=run(s,{type:'BACK'});assert.equal(s.step,'locate');assert.equal(run(s,{type:'CANCEL'}).record,null);
  assert.equal(run(s,{type:'NOTE_AIDS',cameraUsed:true,attemptId:'old'}),s);assert.throws(()=>initialTireState('wiper.front'));
});
test('schema is strict, contains no media/location/SDK fields, checks dates and computed status',()=>{
  let r=startTireResult(TIRE_TASKS[1].id,ctx);for(const c of TIRE_CHECKS)r=answerTire(r,c.id,'NOT_FOUND');r=completeTireResult(r,ctx);
  for(const patch of [{schemaVersion:1},{taskId:'washer-fluid'},{status:'OK'},{confirmation:'PLEOS'},{sync:'SENT'},{completedAt:'2026-02-30T00:00:00.000Z'},{responses:{damage:'NOT_FOUND'}},{responses:{...r.responses,wear:'OK'}},{aids:{...r.aids,x:.5}}])assert.ok(validateTireResult({...r,...patch}).length);
  for(const key of ['video','photo','location','vin','sdk','pressure','depth','token'])assert.ok(validateTireResult({...r,[key]:'unexpected'}).length);
});
test('legacy QR v1 stays washer-only, separate local hints are exact and carry no invite',()=>{
  assert.deepEqual(parseInspectionHandoff('#v=1&task=washer-fluid'),parseHandoff('#v=1&task=washer-fluid'));
  for(const t of TIRE_TASKS){assert.equal(parseHandoff('#v=1&task='+t.id).valid,false);assert.equal(parseInspectionHandoff('#task='+t.id).task,t.id);}
  for(const s of ['#task=tire.front-left&invite=secret','#task=tire.front-left&task=tire.rear-left','#task=unknown','#v=1&task=tire.front-left'])assert.equal(parseInspectionHandoff(s).valid,false);
});
test('shared action gate blocks rapid navigation/double confirmation without timers in the reducer',()=>{let now=0,count=0;const run=actionGate(()=>now),act=()=>{count++;return true;};assert.equal(run(act),true);assert.equal(run(act),false);now=351;assert.equal(run(act),true);assert.equal(count,2);});
