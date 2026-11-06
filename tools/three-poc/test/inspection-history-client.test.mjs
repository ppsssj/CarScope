// Scripted provider and scripted fetch, with DTOs made by the real server code. No Native, AVD or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createInspectionHistoryClient} from '../inspection-history-client.mjs';
import {createNativeHistoryProvider} from '../native-history-provider.mjs';
import {createInspectionHistoryStore} from '../inspection-history-store.mjs';
import {parseHistoryList} from '../inspection-history-contract.mjs';
import {digestResult} from '../mobile-result-contract.mjs';
import {AvdSimulatorHistoryService,AVD_SIMULATOR_ISSUER,HistoryService,partIdForTask} from '../../inspection-sync-poc/src/history.mjs';
import {historyResult} from '../../inspection-sync-poc/test/history-fixtures.mjs';

const REGISTRATION='11111111-1111-4111-8111-111111111111';
const avd={authorityNamespace:'AVD_SIMULATOR',authorityIssuer:AVD_SIMULATOR_ISSUER,userId:null,vehicleId:null,deviceId:null,registrationId:REGISTRATION,bindingVerifiedAt:1};
const owner={authorityNamespace:'VERIFIED_VEHICLE',authorityIssuer:'https://issuer.fixture.invalid/',userId:'u',vehicleId:'v',deviceId:'d',registrationId:'r',bindingVerifiedAt:1};
async function row(task,completedAt,answer,who=avd){
  const originalResult=historyResult(task,{completedAt,answer});
  return {recordId:randomUUID(),inspectionId:originalResult.inspectionId,syncSessionId:randomUUID(),taskId:task,partId:partIdForTask(task),schemaVersion:originalResult.schemaVersion,inspectionStatus:originalResult.status,originalResult,resultDigest:await digestResult(originalResult),completedAt,receivedAt:completedAt+1000,acceptedAt:completedAt+2000,createdAt:completedAt+2001,...who};
}
const T=Date.UTC(2026,10,5,8);
// A real server service behind the provider, so the DTOs here are the ones the API sends.
function serverProvider(rows,{origin='AVD_SIMULATOR_NATIVE',principal=avd,Service=AvdSimulatorHistoryService}={}){
  const pick=q=>rows.filter(r=>(!q.partId||r.partId===q.partId)&&(!q.status||r.inspectionStatus===q.status)&&(!q.after||r.completedAt<q.after.completedAt)).sort((a,b)=>b.completedAt-a.completedAt).slice(0,q.limit+1);
  const get=(_,id)=>rows.find(r=>r.recordId===id)??null;
  const service=new Service({store:{avdHistoryList:async q=>pick(q),avdHistoryGet:async(o,id)=>get(o,id),historyList:async q=>pick(q),historyGet:async(o,id)=>get(o,id)}});
  const calls=[];
  return {calls,origin,
    async list({query}){calls.push(['list',query]);return {status:200,body:await service.list(principal,new URLSearchParams(query))};},
    async detail({recordId}){calls.push(['detail',recordId]);try{return {status:200,body:await service.detail(principal,recordId)};}catch(e){return {status:e.status,body:null};}},
  };
}

test('the production shapes: latest, per-part history and detail for washer OK and coolant REVIEW_NEEDED',async()=>{
  const washer=await row('washer-fluid',T,'NOT_FOUND'),coolantOld=await row('coolant-reservoir',T+1000,'UNABLE'),coolant=await row('coolant-reservoir',T+2000,'FOUND');
  const client=createInspectionHistoryClient({provider:serverProvider([washer,coolantOld,coolant])});
  assert.equal(client.available,true);
  const latest=await client.getLatestInspection('coolant-reservoir');
  assert.equal(latest.status,'SUCCESS');
  assert.deepEqual({...latest.inspection},{recordId:coolant.recordId,inspectionId:coolant.inspectionId,taskId:'coolant-reservoir',partId:'coolant-reservoir',schemaVersion:2,status:'REVIEW_NEEDED',reportState:'FINDINGS_REPORTED',completedAt:T+2000,acceptedAt:T+4000,source:'USER_REPORTED',authorityNamespace:'AVD_SIMULATOR'});
  const washerLatest=await client.getLatestInspection('washer-fluid-cap');
  assert.equal(washerLatest.inspection.status,'OK');
  assert.equal(washerLatest.inspection.reportState,'NO_FINDINGS_REPORTED','a reported OK never becomes a normal verdict');
  const history=await client.getInspectionHistory('coolant-reservoir');
  assert.deepEqual(history.items.map(x=>x.inspectionId),[coolant.inspectionId,coolantOld.inspectionId]);
  const detail=await client.getInspectionDetail(coolant.recordId);
  assert.equal(detail.status,'SUCCESS');
  assert.deepEqual(detail.inspection.originalResult,coolant.originalResult);
  assert.deepEqual(detail.inspection.responses,coolant.originalResult.responses);
  const washerDetail=await client.getInspectionDetail(washer.recordId);
  assert.deepEqual(washerDetail.inspection.responses,{},'schema v1 has no per-question answers');
  assert.equal(Object.isFrozen(latest.inspection),true);
});

test('paging keeps the server cursor and order',async()=>{
  const rows=await Promise.all([0,1,2].map(i=>row('battery-12v',T+i*1000)));
  const client=createInspectionHistoryClient({provider:serverProvider(rows)});
  const first=await client.getInspectionHistory('battery-12v',{limit:2});
  assert.deepEqual(first.items.map(x=>x.completedAt),[T+2000,T+1000]);
  assert.equal(first.hasMore,true);
  const second=await client.getInspectionHistory('battery-12v',{limit:2,cursor:first.nextCursor});
  assert.deepEqual(second.items.map(x=>x.completedAt),[T]);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextCursor,null);
});

test('EMPTY is reached only from a successful answer; every failure stays a failure and nothing rejects',async()=>{
  const none=createInspectionHistoryClient({provider:serverProvider([])});
  assert.equal((await none.getLatestInspection('fuse-box')).status,'EMPTY');
  assert.equal((await none.getInspectionHistory('fuse-box')).status,'EMPTY');
  const cases=[[{status:403,body:null},'AUTH_REQUIRED'],[{status:401,body:null},'AUTH_REQUIRED'],[{status:404,body:null},'NOT_FOUND'],[{status:429,body:null},'RATE_LIMITED'],[{status:500,body:null},'SERVER_ERROR'],[{status:400,body:null},'INVALID_QUERY'],[{unavailable:'AUTH_REQUIRED'},'AUTH_REQUIRED'],[{unavailable:'UNAVAILABLE'},'UNAVAILABLE'],[{status:200,body:{items:[]}},'INVALID_RESPONSE'],[{surprise:true},'INVALID_RESPONSE'],[null,'INVALID_RESPONSE']];
  for(const [reply,code] of cases){
    const client=createInspectionHistoryClient({provider:{origin:'AVD_SIMULATOR_NATIVE',list:async()=>reply,detail:async()=>reply}});
    assert.deepEqual({...(await client.getLatestInspection('fuse-box'))},{status:code,inspection:null},JSON.stringify(reply));
    const list=await client.getInspectionHistory('fuse-box');
    assert.equal(list.status,code);assert.equal(list.items.length,0);
    assert.equal((await client.getInspectionDetail(randomUUID())).status,code==='INVALID_RESPONSE'&&reply?.status===200?'INVALID_RESPONSE':code);
  }
  for(const list of [async()=>{throw Error('boom');},()=>{throw Error('sync boom');}]){
    const client=createInspectionHistoryClient({provider:{origin:'AVD_SIMULATOR_NATIVE',list,detail:list}});
    assert.equal((await client.getInspectionHistory('fuse-box')).status,'NETWORK_ERROR');
    assert.equal((await client.getInspectionDetail(randomUUID())).status,'NETWORK_ERROR');
  }
});

test('no provider or an unknown origin is UNAVAILABLE without a request, and bad input never reaches the provider',async()=>{
  for(const provider of [null,{origin:'DEMO',list(){assert.fail();},detail(){assert.fail();}},{origin:'toString',list(){assert.fail();},detail(){assert.fail();}},{origin:'AVD_SIMULATOR_NATIVE'}]){
    const client=createInspectionHistoryClient({provider});
    assert.equal(client.available,false);
    assert.equal((await client.getLatestInspection('fuse-box')).status,'UNAVAILABLE');
    assert.equal((await client.getInspectionDetail(randomUUID())).status,'UNAVAILABLE');
  }
  const provider={origin:'AVD_SIMULATOR_NATIVE',list:()=>assert.fail('sent'),detail:()=>assert.fail('sent')};
  const client=createInspectionHistoryClient({provider});
  for(const part of ['washer-fluid','../x',"x' OR 1=1",null,undefined,''])assert.equal((await client.getInspectionHistory(part)).status,'INVALID_QUERY',String(part));
  for(const options of [{limit:0},{limit:101},{limit:'5'},{status:'NORMAL'},{cursor:'!!!'}])assert.equal((await client.getInspectionHistory('fuse-box',options)).status,'INVALID_QUERY',JSON.stringify(options));
  for(const id of ['nope',null,'../../v1/sessions'])assert.equal((await client.getInspectionDetail(id)).status,'INVALID_QUERY');
});

test('labels cannot cross: an owner reply fails on the simulator provider and a simulator reply on the owner provider',async()=>{
  const ownerRow=await row('fuse-box',T,'UNABLE',owner),simRow=await row('fuse-box',T);
  const crossed=serverProvider([ownerRow],{principal:owner,Service:HistoryService});
  const asSim=createInspectionHistoryClient({provider:crossed});
  assert.equal((await asSim.getInspectionHistory('fuse-box')).status,'INVALID_RESPONSE');
  assert.equal((await asSim.getInspectionDetail(ownerRow.recordId)).status,'INVALID_RESPONSE');
  const verifiedOrigin=serverProvider([simRow],{origin:'VERIFIED_NATIVE'});
  assert.equal((await createInspectionHistoryClient({provider:verifiedOrigin}).getInspectionHistory('fuse-box')).status,'INVALID_RESPONSE');
  const right=serverProvider([ownerRow],{origin:'VERIFIED_NATIVE',principal:owner,Service:HistoryService});
  assert.equal((await createInspectionHistoryClient({provider:right}).getInspectionHistory('fuse-box')).status,'SUCCESS');
  // The P8 screen and parser keep their old rule: without an explicit authority a simulator row is refused.
  const body=(await serverProvider([simRow]).list({query:{limit:'20'}})).body;
  assert.equal(parseHistoryList(body,{query:{limit:'20'}}).ok,false);
  const store=createInspectionHistoryStore({provider:serverProvider([simRow])});
  assert.equal(store.snapshot.provider,'UNAVAILABLE','the P8 screen does not accept a simulator provider');
  store.dispose();
});

test('a reply for another part, a tampered original or a broken order is refused',async()=>{
  const rows=[await row('fuse-box',T+1000),await row('fuse-box',T)];
  const provider=serverProvider(rows),list=provider.list;
  provider.list=async args=>{const r=await list(args);r.body.items[0].partId='battery-12v';r.body.items[0].taskId='battery-12v';return r;};
  assert.equal((await createInspectionHistoryClient({provider}).getInspectionHistory('fuse-box')).status,'INVALID_RESPONSE');
  const reordered=serverProvider(rows),listB=reordered.list;
  reordered.list=async args=>{const r=await listB(args);r.body.items.reverse();return r;};
  assert.equal((await createInspectionHistoryClient({provider:reordered}).getInspectionHistory('fuse-box')).status,'INVALID_RESPONSE');
  const tampered=serverProvider(rows),detail=tampered.detail;
  tampered.detail=async args=>{const r=await detail(args);r.body.record.originalResult.aids.cameraUsed=!r.body.record.originalResult.aids.cameraUsed;return r;};
  assert.equal((await createInspectionHistoryClient({provider:tampered}).getInspectionDetail(rows[0].recordId)).status,'INVALID_RESPONSE');
});

test('an identical read in flight is shared; a cancellable read keeps its own request and can be cancelled',async()=>{
  const rows=[await row('fuse-box',T)],provider=serverProvider(rows);
  const client=createInspectionHistoryClient({provider});
  const [a,b]=await Promise.all([client.getInspectionHistory('fuse-box'),client.getInspectionHistory('fuse-box')]);
  assert.equal(a,b);
  assert.equal(provider.calls.length,1);
  await client.getInspectionHistory('fuse-box');
  assert.equal(provider.calls.length,2,'nothing is cached once the read has ended');
  let seen;
  const hanging=createInspectionHistoryClient({provider:{origin:'AVD_SIMULATOR_NATIVE',list:({signal})=>{seen=signal;return new Promise(()=>{});},detail:()=>new Promise(()=>{})}});
  const stop=new AbortController();
  const pending=hanging.getLatestInspection('fuse-box',{signal:stop.signal});
  await new Promise(resolve=>setImmediate(resolve));
  stop.abort();
  assert.equal((await pending).status,'ABORTED');
  assert.equal(seen.aborted,true,'the provider request is cancelled too');
  const already=new AbortController();already.abort();
  assert.equal((await hanging.getInspectionHistory('fuse-box',{signal:already.signal})).status,'ABORTED');
});

test('a provider that never answers times out as a failure',async()=>{
  let fire;
  const client=createInspectionHistoryClient({timeoutMs:15000,setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{},provider:{origin:'AVD_SIMULATOR_NATIVE',list:()=>new Promise(()=>{}),detail:()=>new Promise(()=>{})}});
  const pending=client.getInspectionHistory('fuse-box');
  await new Promise(resolve=>setImmediate(resolve));
  fire();
  assert.equal((await pending).status,'NETWORK_ERROR');
});

async function withPage(reply,run){
  const original=Object.fromEntries(['location','self','top','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const urls=[];
  try{
    globalThis.location={origin:'https://carscope-inspection.invalid',pathname:'/index.html'};globalThis.self=globalThis.top=globalThis;
    globalThis.fetch=async(url,options)=>{urls.push([url,options]);return reply(url);};
    await run(urls);
  }finally{for(const [k,d] of Object.entries(original))if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}
}
const json=(value,init)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'},...init});

test('the Native provider exists only on the asset page and sends identifiers only',async()=>{
  assert.equal(createNativeHistoryProvider(),null,'no provider outside the asset page');
  const rows=[await row('fuse-box',T)];
  const server=serverProvider(rows);
  await withPage(async url=>{
    const command=JSON.parse(new URL(url,location.origin).searchParams.get('command'));
    if(command.op==='list'){const {op,...query}=command;return json(await server.list({query}));}
    return json(await server.detail({recordId:command.recordId}));
  },async urls=>{
    const client=createInspectionHistoryClient({provider:createNativeHistoryProvider()});
    assert.equal((await client.getLatestInspection('fuse-box')).inspection.recordId,rows[0].recordId);
    assert.equal((await client.getInspectionDetail(rows[0].recordId)).status,'SUCCESS');
    for(const [url,options] of urls){
      assert.match(url,/^\/native-history-v1\?command=/);
      assert.equal(options.credentials,'omit');
      assert.equal(options.redirect,'error');
      assert.equal(options.cache,'no-store');
      assert.equal(options.headers,undefined,'no credential header crosses the page');
    }
    assert.deepEqual(JSON.parse(new URL(urls[0][0],location.origin).searchParams.get('command')),{op:'list',limit:'1',partId:'fuse-box'});
  });
});

test('a build without the channel, a broken reply and an oversized reply fail without touching anything',async()=>{
  for(const [reply,code] of [[()=>new Response('',{status:404}),'UNAVAILABLE'],[()=>new Response('<html>',{headers:{'Content-Type':'text/html'}}),'UNAVAILABLE'],[()=>new Response('{broken',{headers:{'Content-Type':'application/json'}}),'NETWORK_ERROR'],[()=>new Response('x'.repeat(262145),{headers:{'Content-Type':'application/json'}}),'UNAVAILABLE'],[()=>json({unavailable:'AUTH_REQUIRED'}),'AUTH_REQUIRED'],[()=>json({status:403,body:null}),'AUTH_REQUIRED']]){
    await withPage(reply,async()=>{
      const client=createInspectionHistoryClient({provider:createNativeHistoryProvider()});
      assert.equal((await client.getInspectionHistory('fuse-box')).status,code);
    });
  }
});
