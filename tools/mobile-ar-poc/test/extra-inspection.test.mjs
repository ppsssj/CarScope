import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EXTRA_TASKS} from '../public/extra-tasks.mjs';
import {getExtraResult,validateExtraResult} from '../public/extra-result.mjs';
import {getChecklistProfile} from '../public/checklist-profiles.mjs';
import {parseInspectionHandoff,taskLinks} from '../public/inspection-tasks.mjs';
import {parseHandoff} from '../public/handoff.mjs';
import {readFile} from 'node:fs/promises';
const ctx={now:()=>Date.UTC(2026,10,4),newId:()=> '12345678-1234-4234-8234-123456789abc'};
for(const task of EXTRA_TASKS){
  test(`${task.id}: all 27 response combinations, exact schema, task isolation`,()=>{
    const result=getExtraResult(task.id);assert.equal(parseInspectionHandoff('#task='+task.id).task,task.id);
    assert.equal(parseHandoff('#v=1&task='+task.id).valid,false);
    for(const a of ['FOUND','NOT_FOUND','UNABLE'])for(const b of ['FOUND','NOT_FOUND','UNABLE'])for(const c of ['FOUND','NOT_FOUND','UNABLE']){
      let r=result.start(task.id,ctx);const values=[a,b,c];
      assert.throws(()=>result.complete(r,ctx),/Incomplete/);
      for(const [i,check]of task.checks.entries())r=result.answer(r,check.id,values[i]);
      r=result.complete(r,ctx);assert.deepEqual(validateExtraResult(r),[]);
      assert.equal(r.status,values.includes('FOUND')?'REVIEW_NEEDED':values.includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED');
      for(const patch of [{schemaVersion:1},{taskId:'unknown'},{responses:{}},{status:'OK'},{photo:'forbidden'},
        {responses:{...r.responses,extra:'UNABLE'}},{aids:{...r.aids,confidence:1}},{inspectionId:[r.inspectionId]},
        {responses:{...r.responses,[task.checks[0].id]:['FOUND']}},{completedAt:'2026-02-30T00:00:00.000Z'}]){
        assert.ok(result.validate({...r,...patch}).length,JSON.stringify(patch));
      }
      assert.throws(()=>result.complete(r,ctx));
    }
  });
  test(`${task.id}: explicit safety, partial gate, findings stop without filling, edit/cancel/restart/stale aid guards`,()=>{
    const {flow}=getChecklistProfile(task.id);let s=flow.initial(task.id);
    assert.equal(flow.reduce(s,{type:'START',camera:true},ctx),s);
    s=flow.reduce(s,{type:'SAFETY',value:true},ctx);s=flow.reduce(s,{type:'START',camera:true},ctx);
    s=flow.reduce(s,{type:'TO_CHECK'},ctx);assert.equal(flow.reduce(s,{type:'NEXT',index:0}),s);
    const id=s.record.inspectionId;
    assert.equal(flow.reduce(s,{type:'NOTE_AIDS',cameraUsed:true,attemptId:'old'}),s);
    s=flow.reduce(s,{type:'ANSWER',checkId:task.checks[0].id,answer:'FOUND',attemptId:id});
    assert.equal(s.mode,'manual');assert.equal(s.observationStopped,true);assert.equal(Object.keys(s.record.responses).length,1);
    for(let i=0;i<3;i++){
      if(i)s=flow.reduce(s,{type:'ANSWER',checkId:task.checks[i].id,answer:'UNABLE'});
      s=flow.reduce(s,{type:'NEXT',index:i});
    }
    assert.equal(s.step,'review');s=flow.reduce(s,{type:'BACK'});assert.equal(s.index,2);
    s=flow.reduce(s,{type:'NEXT',index:2});s=flow.reduce(s,{type:'CONFIRM'},ctx);assert.equal(s.record.status,'REVIEW_NEEDED');
    assert.equal(flow.reduce(s,{type:'CONFIRM'},ctx),s);s=flow.reduce(s,{type:'RESTART'});assert.equal(s.safe,false);assert.equal(s.record,null);
    s=flow.reduce(s,{type:'SAFETY',value:true});s=flow.reduce(s,{type:'START',camera:false},ctx);s=flow.reduce(s,{type:'CANCEL'});assert.equal(s.record,null);
  });
}
test('P7-B extension contract exactly matches ten additive tasks and their keys; existing seven stay present',async()=>{
  const text=await readFile(new URL('../../../docs/contracts/p7-b-mobile-tasks-v2.md',import.meta.url),'utf8');
  const contract=JSON.parse(text.split('<!-- p7-b-task-contract -->')[1].match(/```json\s*([\s\S]*?)```/)[1]);
  assert.deepEqual(contract.tasks,EXTRA_TASKS.map(task=>({taskId:task.id,schemaVersion:2,partId:task.id,responseKeys:task.checks.map(c=>c.id)})));
  assert.equal(taskLinks().length,17);assert.equal(new Set(taskLinks().map(t=>t.id)).size,17);
});
