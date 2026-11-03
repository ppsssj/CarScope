// Design consistency only. No receiver, import-to-session function or browser result injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startInspection,completeInspection,validateResult,STATUSES} from '../../mobile-ar-poc/public/inspection-result.mjs';
import {tireResult,TIRE_CHECKS} from '../../mobile-ar-poc/public/tire-result.mjs';
import {chargeResult,CHARGE_CHECKS} from '../../mobile-ar-poc/public/charge-result.mjs';
import {brakeResult,BRAKE_CHECKS} from '../../mobile-ar-poc/public/brake-result.mjs';
import {SUPPORTED_TASKS,checkEnvelope,resultDigest} from '../../inspection-sync-poc/src/protocol.mjs';
import {inspectionStateMap,INSPECTION_STATES} from '../inspection-state-map.mjs';
import {INSPECTION_AREAS} from '../inspection-flow.mjs';
const doc=readFileSync(new URL('../../../docs/contracts/mobile-result-to-3d-session-v1.md',import.meta.url),'utf8');
const spec=JSON.parse(doc.match(/<!-- mobile-3d-contract:v1 -->\s*```json\s*([\s\S]*?)```/)[1]);
const context={now:()=>Date.parse('2026-11-03T00:00:00.000Z'),newId:()=> '33333333-3333-4333-8333-333333333333'};
const profile=task=>task.startsWith('tire.')?{result:tireResult,checks:TIRE_CHECKS}:task==='ev-charge.port'?{result:chargeResult,checks:CHARGE_CHECKS}:{result:brakeResult,checks:BRAKE_CHECKS};
function record(task,value){if(task==='washer-fluid')return completeInspection(startInspection(context),value,context);
  const {result,checks}=profile(task);let r=result.start(task,context);for(const c of checks)r=result.answer(r,c.id,value);return result.complete(r,context);}

test('proposal task/schema/part/response keys match existing producers without activating an ingress',()=>{
  assert.equal(spec.proposalVersion,1);assert.equal(spec.integrationState,'DESIGN_ONLY_NO_INGRESS');
  assert.deepEqual(spec.taskBindings.map(x=>x.taskId).sort(),[...SUPPORTED_TASKS].sort());
  assert.equal(new Set(spec.taskBindings.map(x=>x.taskId)).size,7);
  const parts=INSPECTION_AREAS.flatMap(a=>a.components.map(c=>c.id));
  for(const binding of spec.taskBindings){assert.ok(parts.includes(binding.partId));
    assert.equal(binding.schemaVersion,binding.taskId==='washer-fluid'?1:2);
    assert.deepEqual(binding.responseKeys,binding.schemaVersion===1?[]:profile(binding.taskId).checks.map(c=>c.id));}
  assert.equal(spec.taskBindings.filter(x=>x.taskId==='ev-charge.port').length,1);
  assert.ok(spec.taskBindings.every(x=>!x.taskId.startsWith('wiper')&&!x.taskId.startsWith('light')));
});

test('documented v1/v2 status mapping covers real completed wire results without a healthy inference',async()=>{
  assert.deepEqual(Object.keys(spec.statusMap['1']),[...STATUSES]);
  for(const binding of spec.taskBindings)for(const value of binding.schemaVersion===1?STATUSES:['FOUND','UNABLE','NOT_FOUND']){
    const r=record(binding.taskId,value);assert.deepEqual(binding.schemaVersion===1?validateResult(r):profile(binding.taskId).result.validate(r),[]);
    assert.deepEqual(checkEnvelope({protocol:'inspection-sync',protocolVersion:1,result:r},binding.taskId),[]);
    assert.ok(Object.hasOwn(INSPECTION_STATES,spec.statusMap[binding.schemaVersion][r.status]));
    assert.equal(r.source,'MOBILE');assert.equal(r.confirmation,'USER_REPORTED');assert.equal(r.sync,'NOT_SENT');
    assert.ok(!Object.hasOwn(r,'sessionId'));assert.ok(!Object.hasOwn(r,'syncSessionId'));
    const before=await resultDigest(r);assert.deepEqual(await resultDigest(structuredClone(r)),before);
    assert.ok(inspectionStateMap(r).every(x=>x.status==='NOT_INSPECTED'&&x.source===null));
  }
  assert.equal(spec.statusMap['1'].OK,'NO_FINDINGS_REPORTED');
  assert.equal(spec.statusMap['2'].REVIEW_NEEDED,'FINDINGS_REPORTED');
});

test('proposal makes proof binding and user choice explicit instead of equating wire completion with 3D application',()=>{
  assert.deepEqual(spec.applicationPrerequisites,['TRUSTED_RECEIVER','LIVE_BINDING','EXACT_TASK','STRICT_RESULT','MATCHING_DIGEST','EXPLICIT_ACCEPTED_PROOF','USER_SELECTS_RECORD']);
  // Policy execution is a future host responsibility. These assertions only check the written design remains explicit.
  for(const term of ['bindingId','generation','syncSessionId','receivedAt','acceptedAt','CONFLICT','monotonic','activeRecordRef','NOT_SENT'])assert.ok(doc.includes(term));
});
