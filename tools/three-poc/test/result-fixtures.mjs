// Synthetic test-only authority; never imported by or copied into production assets.
import {getChecklistProfile} from '../../mobile-ar-poc/public/checklist-profiles.mjs';
import {startInspection,completeInspection} from '../../mobile-ar-poc/public/inspection-result.mjs';
export function wireResult(taskId='washer-fluid',value='UNABLE',id='11111111-1111-4111-8111-111111111111'){
  const ctx={now:()=>Date.parse('2026-11-04T01:02:03.000Z'),newId:()=>id};
  if(taskId==='washer-fluid')return completeInspection(startInspection(ctx),value==='FOUND'?'NEEDS_REFILL':value==='NOT_FOUND'?'OK':'UNSURE',ctx);
  const p=getChecklistProfile(taskId);let r=p.result.start(taskId,ctx);for(const [i,c]of p.checks.entries())r=p.result.answer(r,c.id,Array.isArray(value)?value[i]:value);return p.result.complete(r,ctx);
}
export function testAuthority(){let callbacks=null,proofPatch={},detached=0,delay=null,requestReply=()=>({ok:true});const requests=[];
  return {requests,reply(fn){requestReply=fn;},get callbacks(){return callbacks;},get detached(){return detached;},patch(p){proofPatch=p;},delay(fn){delay=fn;},
    adapter:{open(c){callbacks=c;return()=>{detached++;};},requestTask(request){requests.push(request);return requestReply(request);},async verifyAccepted(d){
      if(delay)await delay();return {version:1,proofId:'synthetic-proof',sessionState:'ACCEPTED',confirmation:'NATIVE_EXPLICIT',bindingId:d.bindingId,localSessionId:d.localSessionId,generation:d.generation,syncSessionId:d.syncSessionId,taskId:d.taskId,inspectionId:d.inspectionId,resultDigest:d.resultDigest,receivedAt:1001,acceptedAt:1002,...proofPatch};
    }}
  };
}
