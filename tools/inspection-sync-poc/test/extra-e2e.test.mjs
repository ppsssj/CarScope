import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EXTRA_TASKS} from '../../mobile-ar-poc/public/extra-tasks.mjs';
import {getExtraResult} from '../../mobile-ar-poc/public/extra-result.mjs';
import {startSyncServer} from '../src/server.mjs';
import {LocalTestSessionCreationAuthorizer} from '../src/creation-authorizer.mjs';
import {ReceiverClient,describeReceived} from '../bin/receiver.mjs';
import {SyncClient} from '../public/sync-client.mjs';
import {MobileSync} from '../public/mobile-sync.mjs';
import {parseInviteFragment,checkEnvelope,receiptMatches,resultDigest} from '../src/protocol.mjs';
const envelope=result=>({protocol:'inspection-sync',protocolVersion:1,result});
function record(task,answer='UNABLE'){
  const result=getExtraResult(task.id);let r=result.start(task.id);
  for(const check of task.checks)r=result.answer(r,check.id,answer);return result.complete(r);
}
for(const task of EXTRA_TASKS){
  test(`${task.id}: QR v2 exact task -> explicit send/receipt -> Node accept, strict rejection and idempotency`,async()=>{
    const server=await startSyncServer({port:0,authorizer:new LocalTestSessionCreationAuthorizer(),log:()=>{}});
    const receiver=new ReceiverClient({baseUrl:server.url});
    try{
      const session=await receiver.create(task.id),invite=parseInviteFragment(session.fragment);
      assert.equal(invite.task,task.id);
      const client=new SyncClient({baseUrl:server.url,taskId:task.id});
      const mobile=new MobileSync({invite:invite.invite,taskId:task.id,client,schedule:()=>null,unschedule:()=>{}});
      await mobile.claim();const r=record(task);mobile.setResult(r);assert.equal(mobile.snapshot.display,'NOT_SENT');
      assert.equal((await receiver.view()).result,null);
      for(const patch of [{schemaVersion:1},{responses:{}},{status:'OK'},{gps:'forbidden'},{responses:{...r.responses,extra:'UNABLE'}}]){
        assert.ok(checkEnvelope(envelope({...r,...patch}),task.id).length);
      }
      assert.ok(checkEnvelope(envelope(r),'washer-fluid').length);
      await Promise.all([mobile.send(),mobile.send()]);assert.equal(mobile.snapshot.display,'SENT');
      const view=await receiver.view();assert.deepEqual(view.result,r);assert.equal(view.sessionState,'RESULT_SUBMITTED');
      assert.equal(await receiptMatches(client.receipt,r),true);assert.equal(view.resultDigest,await resultDigest(r));
      assert.equal(await receiptMatches({...client.receipt,resultDigest:'sha256:'+'0'.repeat(64)},r),false);
      const description=describeReceived(view);assert.ok(description.includes(task.label));for(const c of task.checks)assert.ok(description.includes(c.label));
      await assert.rejects(()=>receiver.accept('sha256:'+'0'.repeat(64)));await receiver.accept(view.resultDigest);
      await mobile.refresh();assert.equal(mobile.snapshot.display,'ACCEPTED');assert.equal(r.sync,'NOT_SENT');mobile.close();

      const second=new ReceiverClient({baseUrl:server.url}),s=await second.create(task.id);
      const claim=await fetch(server.url+'/v1/claim',{method:'POST',headers:{Authorization:'Bearer '+parseInviteFragment(s.fragment).invite}}).then(r=>r.json());
      const submit=value=>fetch(server.url+'/v1/submissions',{method:'POST',headers:{Authorization:'Bearer '+claim.submitToken,'Content-Type':'application/json'},body:JSON.stringify(envelope(value))});
      const other=record(EXTRA_TASKS.find(candidate=>candidate.id!==task.id));
      assert.deepEqual(checkEnvelope(envelope(other),other.taskId),[],'cross-task fixture is valid on its own');
      assert.equal((await submit(other)).status,422,'a valid result still cannot cross the session task binding');
      for(const invalid of [{...r,responses:{}},{...r,taskId:'washer-fluid'},{...r,aids:{cameraUsed:true,locationMarked:false,coordinates:[0,0]}}])assert.equal((await submit(invalid)).status,422);
      const first=await submit(r),again=await submit(r);assert.equal(first.status,201);assert.equal(again.status,200);
      const one=await first.json(),two=await again.json();assert.equal(two.duplicate,true);assert.deepEqual(one.receipt,two.receipt);
      assert.equal((await submit(record(task,'FOUND'))).status,409);assert.deepEqual((await second.view()).result,r);
    }finally{await server.stop();}
  });
  test(`${task.id}: cancellation, expiry, default-deny creation and debug module allowlist preserved`,async()=>{
    let now=Date.now();const server=await startSyncServer({port:0,now:()=>now,authorizer:new LocalTestSessionCreationAuthorizer(),log:()=>{}});
    try{
      for(const terminal of ['CANCELLED','EXPIRED']){
        const receiver=new ReceiverClient({baseUrl:server.url}),s=await receiver.create(task.id);
        const client=new SyncClient({baseUrl:server.url,taskId:task.id});await client.claim(parseInviteFragment(s.fragment).invite);
        if(terminal==='CANCELLED')await receiver.cancel();else now=s.expiresAt+1;
        assert.notEqual((await client.send(record(task))).transport,'SENT');assert.equal((await receiver.view()).sessionState,terminal);
      }
    }finally{await server.stop();}
    const denied=await startSyncServer({port:0,log:()=>{}});
    try{
      assert.equal((await fetch(denied.url+'/v1/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:task.id})})).status,403);
      assert.equal((await fetch(denied.url+'/mobile-ar-poc/public/extra-result.mjs')).status,404);
    }finally{await denied.stop();}
  });
}
