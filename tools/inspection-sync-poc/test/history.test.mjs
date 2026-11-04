import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { acceptedRecord, historyAuthority, UNVERIFIED_AUTHORITY, historyQuery, HistoryService } from '../src/history.mjs';
import { SUPPORTED_TASKS, resultDigest } from '../src/protocol.mjs';
import { DenyHistoryAuthorizer, VerifiedHistoryReadAuthorizer } from '../src/history-authorizer.mjs';
import { historyAuthFixture,historyResult } from './history-fixtures.mjs';
import { DEFAULT_LIMITS } from '../src/sessions.mjs';
import { startSyncServer } from '../src/server.mjs';

test('all 17 ACCEPTED results retain exact original digest/part/schema without credentials or SDK values',async()=>{
  const f=historyAuthFixture({now:()=>1800000000000}),binding=await f.creation.resolveHistoryAuthority({token:f.tokens.Acreate,secure:true});
  for(const task of SUPPORTED_TASKS){const result=historyResult(task),digest=await resultDigest(result);
    const session={id:randomUUID(),taskId:task,state:'ACCEPTED',inspectionId:result.inspectionId,result,resultDigest:digest,receivedAt:1800000000000,acceptedAt:1800000000001,historyAuthority:binding,receiverHash:'do-not-archive',inviteHash:'do-not-archive'};
    const row=await acceptedRecord(session);assert.deepEqual(row.originalResult,result);assert.equal(row.resultDigest,digest);assert.equal(row.schemaVersion,task==='washer-fluid'?1:2);
    assert.equal(JSON.stringify(row).includes('do-not-archive'),false);assert.equal(row.userId,'user-A');assert.equal(row.authorityNamespace,'VERIFIED_VEHICLE');
    for(const state of ['RESULT_SUBMITTED','CANCELLED','EXPIRED'])await assert.rejects(()=>acceptedRecord({...session,state}),{code:'INVALID_RESULT'});
    await assert.rejects(()=>acceptedRecord({...session,resultDigest:'sha256:'+'0'.repeat(64)}),{code:'CONFLICT'});
    await assert.rejects(()=>acceptedRecord({...session,result:{...result,vin:'forbidden'}}),{code:'INVALID_RESULT'});
  }
});
test('unverified and AVD authority never impersonate a verified user/vehicle',()=>{
  assert.deepEqual(historyAuthority(),UNVERIFIED_AUTHORITY);
  assert.throws(()=>historyAuthority({...UNVERIFIED_AUTHORITY,userId:'spoof'}));
  const sim={...UNVERIFIED_AUTHORITY,authorityNamespace:'AVD_SIMULATOR',authorityIssuer:'carscope:avd-simulator',registrationId:'sim-id',bindingVerifiedAt:1};
  assert.equal(historyAuthority(sim).vehicleId,null);assert.throws(()=>historyAuthority({...sim,vehicleId:'real-car'}));
  assert.throws(()=>historyQuery(new URLSearchParams(),sim),{code:'FORBIDDEN'});
});
test('history read requires its own exact scope, TLS, current ownership, registration and revocation',async()=>{
  const f=historyAuthFixture({now:()=>1000});assert.equal(await new DenyHistoryAuthorizer().resolve(),null);
  assert.equal((await f.read.resolve({token:f.tokens.Aread,secure:true})).userId,'user-A');
  for(const token of [f.tokens.Acreate,'r'.repeat(43),null])assert.equal(await f.read.resolve({token,secure:true}),null);
  assert.equal(await f.read.resolve({token:f.tokens.Aread,secure:false}),null);
  for(const key of ['active','ownershipVerified']){f.owners.A[key]=false;assert.equal(await f.read.resolve({token:f.tokens.Aread,secure:true}),null);f.owners.A[key]=true;}
  const grant=f.grants.get(f.tokens.Aread);grant.active=false;assert.equal(await f.read.resolve({token:f.tokens.Aread,secure:true}),null);grant.active=true;
  for(const patch of [{audience:'wrong'},{issuer:'https://evil.invalid/'},{scope:['inspection:history:read','admin']},{expiresAt:1000},{subject:'unknown'},{extra:true}]){
    const old={...grant};Object.assign(grant,patch);assert.equal(await f.read.resolve({token:f.tokens.Aread,secure:true}),null);Object.keys(grant).forEach(k=>delete grant[k]);Object.assign(grant,old);
  }
  for(const missing of ['credentialVerifier','registrationProvider','revocations'])assert.equal(await new VerifiedHistoryReadAuthorizer({...f.options,[missing]:undefined}).resolve({token:f.tokens.Aread,secure:true}),null);
});
test('history auth timeout/outage/expiry fails closed without positive caching',async()=>{
  let now=1000;const f=historyAuthFixture({now:()=>now});let signal;
  const slow=new VerifiedHistoryReadAuthorizer({...f.options,timeoutMs:10,credentialVerifier:{testOnly:true,verify({signal:s}){signal=s;return new Promise(()=>{});}}});
  assert.equal(await slow.resolve({token:f.tokens.Aread,secure:true}),null);assert.equal(signal.aborted,true);
  for(const [name,method]of [['credentialVerifier','verify'],['registrationProvider','resolve'],['revocations','isActive']]){
    const broken=new VerifiedHistoryReadAuthorizer({...f.options,[name]:{testOnly:true,async [method](){throw Error('private');}}});assert.equal(await broken.resolve({token:f.tokens.Aread,secure:true}),null);
  }
  f.options.revocations.isActive=async()=>{now=61000;return true;};assert.equal(await f.read.resolve({token:f.tokens.Aread,secure:true}),null);
});
test('history query is bounded, exact, cursor scoped and date range is half-open',async()=>{
  const f=historyAuthFixture({now:()=>1000}),a=await f.read.resolve({token:f.tokens.Aread,secure:true});
  for(const raw of ['limit=0','limit=101','limit=1&limit=2','limit=1e1','taskId=alias','status=SAFE','userId=user-B','from=2026-02-30T00:00:00.000Z','cursor=bad','from=2026-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'])assert.throws(()=>historyQuery(new URLSearchParams(raw),a),{code:'BAD_REQUEST'});
  const query=historyQuery(new URLSearchParams('limit=1&taskId=washer-fluid'),a),row={recordId:randomUUID(),completedAt:1};
  const service=new HistoryService({store:{async historyList(){return [row,{...row,recordId:randomUUID()}];}}});
  const page=await service.list(a,new URLSearchParams('limit=1&taskId=washer-fluid'));assert.equal(page.page.hasMore,true);
  assert.equal(historyQuery(new URLSearchParams({limit:'1',taskId:'washer-fluid',cursor:page.page.nextCursor}),a).fingerprint,query.fingerprint);
  assert.throws(()=>historyQuery(new URLSearchParams({cursor:page.page.nextCursor}),a));
  const b=await f.read.resolve({token:f.tokens.Bread,secure:true});assert.throws(()=>historyQuery(new URLSearchParams({taskId:'washer-fluid',cursor:page.page.nextCursor}),b));
});
test('history routes default deny and spoofed forward/owner headers do not establish TLS or authority',async()=>{
  const f=historyAuthFixture();const server=await startSyncServer({port:0,historyAuthorizer:f.read,log:()=>{}});
  try{for(const path of ['/v1/inspection-records','/v1/inspection-records?limit=1','/v1/inspection-records/'+randomUUID()]){
    const response=await fetch(server.url+path,{headers:{Authorization:'Bearer '+f.tokens.Aread,'X-Forwarded-Proto':'https','X-User-Id':'user-A','X-Vehicle-Id':'vehicle-A'}});assert.equal(response.status,403);
  }}finally{await server.stop();}
  assert.deepEqual([DEFAULT_LIMITS.inviteTtlMs,DEFAULT_LIMITS.sessionTtlMs,DEFAULT_LIMITS.acceptedRetentionMs],[600000,1800000,600000]);
});
