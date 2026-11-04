// Exhaustive response and aid combinations from shipped mobile constructors, checked by the Node validator.
import assert from 'node:assert/strict';
import { taskContract } from './contract.mjs';
import { startInspection, completeInspection, noteAids } from '../mobile-ar-poc/public/inspection-result.mjs';
import { tireResult } from '../mobile-ar-poc/public/tire-result.mjs';
import { chargeResult } from '../mobile-ar-poc/public/charge-result.mjs';
import { brakeResult } from '../mobile-ar-poc/public/brake-result.mjs';
import { getExtraResult } from '../mobile-ar-poc/public/extra-result.mjs';
import { canonicalJson, resultDigest, checkEnvelope } from '../inspection-sync-poc/src/protocol.mjs';
const now=()=>Date.parse('2026-11-04T08:00:00.000Z'),done=()=>Date.parse('2026-11-04T08:02:00.000Z');
const options={now,newId:()=> '12345678-1234-4123-8123-123456789abc'};
for(const task of taskContract) for(const cameraUsed of [false,true]) for(const locationMarked of [false,true]) {
  const profile=task.taskId.startsWith('tire.')?tireResult:task.taskId==='ev-charge.port'?chargeResult:task.taskId==='brake-fluid'?brakeResult:task.taskId==='washer-fluid'?null:getExtraResult(task.taskId);
  const combinations=profile?Array.from({length:27},(_,i)=>task.responseKeys.map((key,k)=>[key,['FOUND','NOT_FOUND','UNABLE'][Math.floor(i/(3**k))%3]])):['OK','NEEDS_REFILL','UNSURE'];
  for(const answers of combinations){
    let result;
    if(profile){result=profile.start(task.taskId,options);for(const [key,value]of answers)result=profile.answer(result,key,value);result=profile.noteAids(result,{cameraUsed,locationMarked});result=profile.complete(result,{now:done});}
    else result=completeInspection(noteAids(startInspection(options),{cameraUsed,locationMarked}),answers,{now:done});
    assert.deepEqual(checkEnvelope({protocol:'inspection-sync',protocolVersion:1,result},task.taskId),[]);
    console.log([JSON.stringify(result),canonicalJson(result),await resultDigest(result)].join('\t'));
  }
}
