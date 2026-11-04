// SYNTHETIC TEST ONLY. Not a Native receiver. Not imported/copied by the production page/builder.
import {digestResult} from '../mobile-result-contract.mjs';
const contexts=[];
export const fixtureAdapter={open(context){contexts.push(context);return()=>{};},requestTask(){},async verifyAccepted(d){return {version:1,proofId:'synthetic-browser-proof',sessionState:'ACCEPTED',bindingId:d.bindingId,localSessionId:d.localSessionId,generation:d.generation,syncSessionId:d.syncSessionId,taskId:d.taskId,inspectionId:d.inspectionId,resultDigest:d.resultDigest,receivedAt:1001,acceptedAt:1002};}};
export async function publish(result,partId,index=contexts.length-1){
  const c=contexts[index],bindingId='test-'+result.taskId,syncSessionId='sync-'+result.taskId;
  const bound=c.onBinding({bindingId,localSessionId:c.localSessionId,generation:c.generation,syncSessionId,taskId:result.taskId,partId,serverNow:1000,expiresAt:1000000});
  const delivered=await c.onAccepted({bindingId,localSessionId:c.localSessionId,generation:c.generation,syncSessionId,taskId:result.taskId,inspectionId:result.inspectionId,resultDigest:await digestResult(result),result});return {bound,delivered};
}
