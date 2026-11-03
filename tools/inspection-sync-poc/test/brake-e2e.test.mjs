import test from 'node:test';
import assert from 'node:assert/strict';
import {startSyncServer} from '../src/server.mjs';
import {LocalTestSessionCreationAuthorizer} from '../src/creation-authorizer.mjs';
import {ReceiverClient,describeReceived} from '../bin/receiver.mjs';
import {SyncClient} from '../public/sync-client.mjs';
import {MobileSync} from '../public/mobile-sync.mjs';
import {BRAKE_CHECKS,startBrakeResult,answerBrake,completeBrakeResult} from '../../mobile-ar-poc/public/brake-result.mjs';
import {parseInviteFragment,checkEnvelope,canonicalJson,resultDigest,receiptMatches} from '../src/protocol.mjs';
const task='brake-fluid';
function record(){let r=startBrakeResult(task);for(const c of BRAKE_CHECKS)r=answerBrake(r,c.id,'UNABLE');return completeBrakeResult(r);}
const envelope=result=>({protocol:'inspection-sync',protocolVersion:1,result});
async function setup(options={}) {
  const server=await startSyncServer({port:0,authorizer:new LocalTestSessionCreationAuthorizer(),log:()=>{},...options});
  const receiver=new ReceiverClient({baseUrl:server.url}),session=await receiver.create(task),invite=parseInviteFragment(session.fragment);
  const client=new SyncClient({baseUrl:server.url,taskId:task});return {server,receiver,session,invite,client};
}
test('brake QR/Claim/Submit/View/Accept: immutable result, matching digest, explicit Node acceptance',async()=>{
  const {server,receiver,invite,client}=await setup();
  try{
    assert.equal(invite.valid,true);assert.equal(invite.task,task);
    const mobile=new MobileSync({invite:invite.invite,taskId:task,client,schedule:()=>null,unschedule:()=>{}});
    await mobile.claim();const r=record();mobile.setResult(r);assert.equal(mobile.snapshot.display,'NOT_SENT');assert.equal((await receiver.view()).result,null);
    await Promise.all([mobile.send(),mobile.send()]);assert.equal(mobile.snapshot.display,'SENT');
    const view=await receiver.view();assert.equal(view.sessionState,'RESULT_SUBMITTED');assert.deepEqual(view.result,r);
    assert.equal(await receiptMatches(client.receipt,r),true);assert.equal(view.resultDigest,await resultDigest(r));assert.equal(r.sync,'NOT_SENT');
    const ordered={...r,responses:{exteriorDamage:'UNABLE',levelMarking:'UNABLE',leakTrace:'UNABLE'}};
    assert.equal(canonicalJson(ordered),canonicalJson(r));assert.equal(await resultDigest(ordered),view.resultDigest);
    assert.match(describeReceived(view),/브레이크액/);for(const c of BRAKE_CHECKS)assert.ok(describeReceived(view).includes(c.label));
    await assert.rejects(()=>receiver.accept('sha256:'+'0'.repeat(64)));assert.equal((await receiver.view()).sessionState,'RESULT_SUBMITTED');
    await receiver.accept(view.resultDigest);await mobile.refresh();assert.equal(mobile.snapshot.display,'ACCEPTED');mobile.close();
  }finally{await server.stop();}
});
test('brake rejects mismatched task/schema, partial answers, extra data and wrong digest receipts',async()=>{
  const r=record();assert.deepEqual(checkEnvelope(envelope(r),task),[]);
  for(const patch of [{schemaVersion:1},{taskId:'brake-fluid.other'},{responses:{levelMarking:'UNABLE'}},{responses:{...r.responses,leakTrace:'CLEAN'}},{status:'OK'},{gps:'forbidden'}])assert.ok(checkEnvelope(envelope({...r,...patch}),task).length);
  assert.ok(checkEnvelope(envelope(r),'tire.front-left').length);
  const {server,receiver,invite,client}=await setup();
  try{assert.equal((await client.claim(invite.invite)).ok,true);
    assert.equal((await client.send({...r,taskId:'tire.front-left'})).transport,'REJECTED_INVALID');assert.equal((await receiver.view()).result,null);
    const sent=await client.send(r);assert.equal(sent.transport,'SENT');assert.equal(await receiptMatches({...sent.receipt,resultDigest:'sha256:'+'0'.repeat(64)},r),false);
  }finally{await server.stop();}
});
test('same brake result retries are idempotent; a different valid result conflicts',async()=>{
  const {server,receiver,invite,client}=await setup();
  try{await client.claim(invite.invite);const r=record(),sent=await client.send(r);assert.equal(sent.transport,'SENT');
    const clone=new SyncClient({baseUrl:server.url,taskId:task});assert.equal((await clone.claim(invite.invite)).ok,false);
    // Use real authorized HTTP retries to exercise the server, rather than only the client's cached SENT path.
    const secondReceiver=new ReceiverClient({baseUrl:server.url}),s=await secondReceiver.create(task);
    const claim=await fetch(server.url+'/v1/claim',{method:'POST',headers:{Authorization:'Bearer '+parseInviteFragment(s.fragment).invite}}).then(r=>r.json());
    const submit=value=>fetch(server.url+'/v1/submissions',{method:'POST',headers:{Authorization:'Bearer '+claim.submitToken,'Content-Type':'application/json'},body:JSON.stringify(envelope(value))});
    for(const invalid of [{...r,responses:{levelMarking:'UNABLE'}},{...r,inspectionId:[r.inspectionId]},
      {...r,responses:{...r.responses,leakTrace:['UNABLE']}},{...r,responses:{...r.responses,leakTrace:{toString:null}}},
      {...r,taskId:'tire.front-left',responses:{damage:'UNABLE',leakTrace:'UNABLE',wear:'UNABLE'}}])assert.equal((await submit(invalid)).status,422);
    const first=await submit(r),again=await submit(r);assert.equal(first.status,201);assert.equal(again.status,200);
    const firstBody=await first.json(),againBody=await again.json();assert.equal(firstBody.duplicate,false);assert.equal(againBody.duplicate,true);assert.deepEqual(firstBody.receipt,againBody.receipt);
    const changed={...r,responses:{...r.responses,leakTrace:'FOUND'},status:'REVIEW_NEEDED'};
    const conflict=await submit(changed);assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'CONFLICT');assert.deepEqual((await secondReceiver.view()).result,r);
  }finally{await server.stop();}
});
for(const terminal of ['CANCELLED','EXPIRED'])test('brake '+terminal+' remains terminal and never accepts a late result',async()=>{
  let clock=Date.now();const {server,receiver,session,invite,client}=await setup({now:()=>clock});
  try{await client.claim(invite.invite);if(terminal==='CANCELLED')await receiver.cancel();else clock=session.expiresAt+1;
    assert.equal((await client.status()).sessionState,terminal);assert.notEqual((await client.send(record())).transport,'SENT');
    const view=await receiver.view();assert.equal(view.sessionState,terminal);assert.equal(view.result,null);
  }finally{await server.stop();}
});
test('brake dependencies remain debug-only; creation still denies by default',async()=>{
  for(const debugPage of [false,true]){const server=await startSyncServer({port:0,debugPage,log:()=>{}});
    try{for(const name of ['brake-result.mjs','checklist-result.mjs'])assert.equal((await fetch(server.url+'/mobile-ar-poc/public/'+name)).status,debugPage?200:404);
      assert.equal((await fetch(server.url+'/v1/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:task})})).status,403);
    }finally{await server.stop();}}
});
