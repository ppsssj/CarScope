import test from 'node:test';import assert from 'node:assert/strict';
import {startSyncServer} from '../src/server.mjs';import {LocalTestSessionCreationAuthorizer} from '../src/creation-authorizer.mjs';
import {ReceiverClient} from '../bin/receiver.mjs';import {SyncClient} from '../public/sync-client.mjs';import {MobileSync} from '../public/mobile-sync.mjs';
import {buildInviteFragment,parseInviteFragment,checkEnvelope,PROTOCOL,PROTOCOL_VERSION} from '../src/protocol.mjs';
import {takeMobileHandoff} from '../public/mobile-handoff.mjs';
import {TIRE_TASKS} from '../../mobile-ar-poc/public/inspection-tasks.mjs';
import {TIRE_CHECKS,startTireResult,answerTire,completeTireResult} from '../../mobile-ar-poc/public/tire-result.mjs';
const result=id=>{let r=startTireResult(id);for(const c of TIRE_CHECKS)r=answerTire(r,c.id,c.id==='wear'?'UNABLE':'NOT_FOUND');return completeTireResult(r);};
test('legacy debug protocol dependencies remain explicitly served only when debug is enabled',async()=>{
  for(const debugPage of [false,true]){
    const server=await startSyncServer({port:0,debugPage,log:()=>{}});
    try{for(const name of ['tire-result.mjs','inspection-tasks.mjs','handoff.mjs']){
      const response=await fetch(`${server.url}/mobile-ar-poc/public/${name}`);
      assert.equal(response.status,debugPage?200:404);
      if(debugPage)assert.match(response.headers.get('content-type'),/text\/javascript/);
    }}finally{await server.stop();}
  }
});
for(const task of TIRE_TASKS)test('synthetic HTTP '+task.id+' invite -> claim -> result -> matching receipt -> explicit Node receiver accept',async()=>{
  const server=await startSyncServer({port:0,authorizer:new LocalTestSessionCreationAuthorizer(),log:()=>{}});
  try{const receiver=new ReceiverClient({baseUrl:server.url}),s=await receiver.create(task.id),invite=parseInviteFragment(s.fragment);assert.equal(invite.valid,true);assert.equal(invite.task,task.id);
    const client=new SyncClient({baseUrl:server.url,taskId:task.id}),mobile=new MobileSync({invite:invite.invite,client,taskId:task.id,schedule:()=>null,unschedule:()=>{}});await mobile.claim();assert.equal(client.paired,true);
    const r=result(task.id);mobile.setResult(r);assert.equal(mobile.snapshot.canSend,true);await Promise.all([mobile.send(),mobile.send()]);assert.equal(mobile.snapshot.display,'SENT');assert.equal(r.sync,'NOT_SENT');
    const view=await receiver.view();assert.equal(view.result.taskId,task.id);assert.equal(view.result.responses.wear,'UNABLE');await receiver.accept(view.resultDigest);await mobile.refresh();assert.equal(mobile.snapshot.display,'ACCEPTED');mobile.close();
  }finally{await server.stop();}
});
test('task/schema mismatch, partial results and wrong task claims fail without weakening v2 token grammar',async()=>{
  const task=TIRE_TASKS[0].id,r=result(task),env={protocol:PROTOCOL,protocolVersion:PROTOCOL_VERSION,result:r};assert.deepEqual(checkEnvelope(env,task),[]);assert.ok(checkEnvelope(env,TIRE_TASKS[1].id).length);assert.ok(checkEnvelope({...env,result:{...r,responses:{damage:'FOUND'}}},task).length);
  const token='a'.repeat(43),fragment=buildInviteFragment(task,token),calls=[];const entry=takeMobileHandoff({hash:fragment,pathname:'/',search:''},{replaceState:(...a)=>calls.push(a)});assert.equal(entry.handoff.task,task);assert.ok(!JSON.stringify(entry.handoff).includes(token));assert.equal(calls.length,1);
  assert.equal(parseInviteFragment(fragment+'&extra=x').valid,false);
  const wrong=new SyncClient({baseUrl:'https://fixture.invalid',taskId:TIRE_TASKS[1].id,fetchImpl:async()=>({ok:true,status:200,json:async()=>({submitToken:token,taskId:task})})});assert.equal((await wrong.claim(token)).ok,false);assert.equal(wrong.paired,false);
});
