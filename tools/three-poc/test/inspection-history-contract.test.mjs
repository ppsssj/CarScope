// Client parser against the REAL backend DTO code (HistoryService/historyQuery), with synthetic rows and owner.
// This proves wire-format compatibility only. It is not an authenticated or production History read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HistoryService,HistoryError} from '../../inspection-sync-poc/src/history.mjs';
import {MOBILE_TARGETS,validateMobileResult,digestResult} from '../mobile-result-contract.mjs';
import {parseHistoryList,parseHistoryDetail,historyQueryFromFilters,historyStatusCode,historyDisplayState,isRecordId,HISTORY_STATUSES} from '../inspection-history-contract.mjs';
import {createInspectionHistoryStore} from '../inspection-history-store.mjs';
import {demoRows,demoHistoryProvider,demoControl} from './history-demo-provider.mjs';

const owner=Object.freeze({authorityNamespace:'VERIFIED_VEHICLE',authorityIssuer:'https://issuer.example.invalid',userId:'synthetic-user',vehicleId:'synthetic-vehicle',deviceId:'synthetic-device',registrationId:'synthetic-registration',bindingVerifiedAt:1});
const bound=rows=>rows.map(r=>({...r,authorityIssuer:owner.authorityIssuer,userId:owner.userId,vehicleId:owner.vehicleId}));
function service(rows){
  const sorted=bound(rows).sort((a,b)=>b.completedAt-a.completedAt||(a.recordId<b.recordId?1:-1));
  return new HistoryService({store:{
    historyList:async q=>sorted.filter(r=>(!q.taskId||r.taskId===q.taskId)&&(!q.partId||r.partId===q.partId)&&(!q.status||r.inspectionStatus===q.status)&&(q.from===null||r.completedAt>=q.from)&&(q.to===null||r.completedAt<q.to)&&(!q.after||r.completedAt<q.after.completedAt||r.completedAt===q.after.completedAt&&r.recordId<q.after.recordId)).slice(0,q.limit+1),
    historyGet:async(_o,id)=>sorted.find(r=>r.recordId===id)??null,
  }});
}
function serviceProvider(rows){
  const s=service(rows),wrap=async fn=>{try{return {status:200,body:await fn()};}catch(e){if(e instanceof HistoryError)return {status:e.status,body:{error:{code:e.code}}};throw e;}};
  return {origin:'DEMO',list:({query})=>wrap(()=>s.list(owner,new URLSearchParams(query))),detail:({recordId})=>wrap(()=>s.detail(owner,recordId))};
}
const firstQuery=(f={})=>historyQueryFromFilters(f).query;
const realPage=async(rows,f={})=>{const query=firstQuery(f);return {query,body:await service(rows).list(owner,new URLSearchParams(query))};};

test('17 taskIds map to the exact contract partIds and schemas, and real DTOs for all of them parse', async()=>{
  const expected={'washer-fluid':['washer-fluid-cap',1],'brake-fluid':['brake-fluid-reservoir',2]};
  assert.equal(MOBILE_TARGETS.length,17);
  for(const t of MOBILE_TARGETS){const [part,schema]=expected[t.taskId]??[t.taskId,2];assert.equal(t.partId,part);assert.equal(t.schemaVersion,schema);assert.ok(t.label);}
  const rows=await demoRows(17),{query,body}=await realPage(rows);
  const parsed=parseHistoryList(body,{query});
  assert.equal(parsed.ok,true,parsed.reason);assert.equal(parsed.items.length,17);
  assert.deepEqual(new Set(parsed.items.map(r=>r.taskId)).size,17);
  assert.ok(Object.isFrozen(parsed.items)&&Object.isFrozen(parsed.items[0]));
});

test('demo provider emits the same DTOs as the real backend code', async()=>{
  const rows=await demoRows(5);demoControl.rows=rows;
  const query=firstQuery(),{body}=await demoHistoryProvider.list({query}),real=await service(rows).list(owner,new URLSearchParams(query));
  assert.deepEqual(body.items.map(x=>({...x,authorityNamespace:x.authorityNamespace})),real.items);
  const id=rows[0].recordId,detail=(await demoHistoryProvider.detail({recordId:id})).body,realDetail=await service(rows).detail(owner,id);
  assert.deepEqual(detail,realDetail);demoControl.rows=null;
});

test('real backend detail parses for schema v1 (empty responses is valid) and v2 with digest verified', async()=>{
  const rows=await demoRows(2),[washer,tire]=[rows.find(r=>r.schemaVersion===1),rows.find(r=>r.schemaVersion===2)],s=service(rows);
  const v1=await parseHistoryDetail(await s.detail(owner,washer.recordId),{recordId:washer.recordId});
  assert.equal(v1.ok,true,v1.reason);assert.deepEqual({...v1.record.responses},{});assert.equal(v1.record.schemaVersion,1);
  const v2=await parseHistoryDetail(await s.detail(owner,tire.recordId),{recordId:tire.recordId});
  assert.equal(v2.ok,true,v2.reason);assert.deepEqual({...v2.record.responses},{...tire.originalResult.responses});
  assert.equal(typeof v2.record.completedAt,'number');assert.equal(typeof v2.record.originalResult.completedAt,'string');
  assert.equal(Date.parse(v2.record.originalResult.completedAt),v2.record.completedAt,'epoch DTO and ISO original describe one time and stay separate');
  assert.ok(Object.isFrozen(v2.record.originalResult.responses));
});

test('real cursors walk every page in server order without duplicates; a foreign filter cursor is a real 400', async()=>{
  const rows=await demoRows(45),store=createInspectionHistoryStore({provider:serviceProvider(rows)});
  await store.openList();
  let guard=0;while(store.snapshot.list.hasMore&&guard++<10)assert.equal(await store.loadMore(),true);
  const items=store.snapshot.list.items;assert.equal(items.length,45);assert.equal(guard,2);
  assert.equal(new Set(items.map(r=>r.recordId)).size,45);
  assert.deepEqual(items.map(r=>r.recordId),[...rows].sort((a,b)=>b.completedAt-a.completedAt).map(r=>r.recordId));
  const {body}=await realPage(rows);
  await assert.rejects(service(rows).list(owner,new URLSearchParams({limit:'20',cursor:body.page.nextCursor,taskId:'brake-fluid'})),e=>e.status===400);
});

test('queries the client builds are accepted by the real server parser, with an exclusive next-midnight end', async()=>{
  const q=historyQueryFromFilters({taskId:'brake-fluid',status:'UNABLE',fromDate:'2026-10-01',toDate:'2026-10-31'}).query,rows=await demoRows(3);
  assert.equal((await service(rows).list(owner,new URLSearchParams(q))).schemaVersion,1);
  const local=new Date(2026,9,31);assert.equal(Date.parse(q.to)-local.getTime(),86400000);
  assert.equal(q.from,new Date(2026,9,1).toISOString());
  assert.equal(new Date(q.to).toISOString(),q.to,'canonical UTC millisecond form');
  for(const s of HISTORY_STATUSES)assert.equal(historyQueryFromFilters({status:s}).ok,true);
  assert.deepEqual(Object.keys(firstQuery()),['limit']);
});

test('invalid local filters are refused before any request', ()=>{
  for(const f of [{taskId:'unknown'},{partId:'unknown'},{status:'NORMAL'},{taskId:'brake-fluid',partId:'fuse-box'},{fromDate:'2026-02-30'},{toDate:'not-a-date'},{fromDate:'1969-12-31'},{fromDate:'2026-11-02',toDate:'2026-11-01'}])
    assert.equal(historyQueryFromFilters(f).code,'INVALID_QUERY',JSON.stringify(f));
  assert.equal(historyQueryFromFilters({},{cursor:'bad cursor!'}).ok,false);
  assert.equal(historyQueryFromFilters({},{limit:101}).ok,false);
  assert.equal(historyQueryFromFilters({fromDate:'2026-11-01',toDate:'2026-11-01'}).ok,true,'one inclusive day is a valid range');
  assert.equal(isRecordId('../secret'),false);
});

test('list parser rejects unknown task/status, extra fields, wrong provenance, order, filter and page violations', async()=>{
  const rows=await demoRows(3),{query,body}=await realPage(rows,{}),good=()=>structuredClone(body);
  const mutate=(fn)=>{const b=good();fn(b);return parseHistoryList(b,{query});};
  const reject=(fn,reason)=>{const r=mutate(fn);assert.equal(r.ok,false,reason);assert.equal(r.code,'INVALID_RESPONSE');assert.equal(r.reason,reason);};
  assert.equal(parseHistoryList(good(),{query}).ok,true);
  reject(b=>{b.items[0].taskId='unknown';},'record');
  reject(b=>{b.items[0].inspectionStatus='NORMAL';},'record');
  reject(b=>{b.items[0].inspectionStatus=b.items[0].schemaVersion===1?'UNABLE':'OK';},'record');
  reject(b=>{b.items[0].partId='fuse-box';},'record');
  reject(b=>{b.items[0].vin='VIN';},'record');
  reject(b=>{delete b.items[0].source;},'record');
  reject(b=>{b.items[0].source='PLEOS';},'record');
  reject(b=>{b.items[0].sdkDataIncluded=true;},'record');
  reject(b=>{b.items[0].authorityNamespace='AVD_SIMULATOR';},'record');
  reject(b=>{b.items[0].acceptedAt=b.items[0].receivedAt-1;},'record');
  reject(b=>{b.items[0].receivedAt=-1;},'record');
  reject(b=>{b.items[0].completedAt=8640000000000001;},'record');
  reject(b=>{b.items[0].completedAt=String(b.items[0].completedAt);},'record');
  reject(b=>{b.items[1]=structuredClone(b.items[0]);},'duplicate');
  reject(b=>{b.items.reverse();},'order');
  reject(b=>{b.page.hasMore=true;},'cursor');
  reject(b=>{b.page.nextCursor='abc';},'cursor');
  reject(b=>{b.page.limit=99;},'page');
  reject(b=>{b.page.total=3;},'page');
  reject(b=>{b.total=3;},'shape');
  reject(b=>{b.schemaVersion=2;},'shape');
  const filtered=firstQuery({taskId:'brake-fluid'});
  assert.equal(parseHistoryList(good(),{query:filtered}).reason,'filter');
  assert.equal(parseHistoryList(good(),{query,prior:[body.items[0]]}).reason,'duplicate');
  const c=structuredClone(body);c.page={limit:20,hasMore:false,nextCursor:null};
  assert.equal(parseHistoryList(c,{query,prior:[{recordId:'x',inspectionId:'y',completedAt:-1e15}]}).reason,'order');
});

test('completedAt ties sort by recordId, and a contract-valid pre-epoch user time is preserved', async()=>{
  const rows=await demoRows(2),items=(await realPage(rows)).body;
  const tie=structuredClone(items);tie.items[1].completedAt=tie.items[0].completedAt;
  tie.items.sort((a,b)=>a.recordId<b.recordId?1:-1);
  assert.equal(parseHistoryList(tie,{query:firstQuery()}).ok,true,'equal completion times are ordered by recordId descending');
  tie.items.reverse();
  assert.equal(parseHistoryList(tie,{query:firstQuery()}).reason,'order');
  const old=structuredClone(items);old.items=[{...old.items[0],completedAt:-5000}];old.page={limit:20,hasMore:false,nextCursor:null};
  assert.equal(parseHistoryList(old,{query:firstQuery()}).ok,true);
  const iso={...rows[0].originalResult,startedAt:'1969-12-31T23:59:50.000Z',completedAt:'1969-12-31T23:59:55.000Z'};
  assert.equal(validateMobileResult(iso),false,'the live session boundary keeps rejecting it');
  assert.equal(validateMobileResult(iso,{allowPreEpoch:true}),true);
});

test('detail parser rejects tampered digest/original, mismatched ids and a list/detail disagreement', async()=>{
  const rows=await demoRows(2),tire=rows.find(r=>r.schemaVersion===2),good=await service(rows).detail(owner,tire.recordId),id=tire.recordId;
  const parse=(fn,opts={})=>{const b=structuredClone(good);fn(b);return parseHistoryDetail(b,{recordId:id,...opts});};
  assert.equal((await parse(()=>{})).ok,true);
  const reasons={};
  for(const [name,fn] of Object.entries({
    digest:b=>{b.record.resultDigest='sha256:'+'0'.repeat(64);},
    original:b=>{b.record.originalResult.sync='SENT';},
    originalStatus:b=>{b.record.inspectionStatus=b.record.inspectionStatus==='UNABLE'?'REVIEW_NEEDED':'UNABLE';},
    responses:b=>{const k=Object.keys(b.record.responses)[0];b.record.responses[k]=b.record.responses[k]==='FOUND'?'NOT_FOUND':'FOUND';},
    time:b=>{b.record.completedAt+=1;},
    record:b=>{b.record.recordId=rows.find(r=>r!==tire).recordId;},
    token:b=>{b.record.token='x';},
  })){const r=await parse(fn);assert.equal(r.ok,false,name);assert.equal(r.code,'INVALID_RESPONSE');reasons[name]=r.reason;}
  assert.equal(reasons.digest,'digest');assert.equal(reasons.time,'original');
  // A digest recomputed over a tampered original must still fail the strict original schema.
  for(const tamper of [o=>{o.sync='SENT';},o=>{o.vin='VIN';},o=>{o.confirmation='SDK';}]){
    const b=structuredClone(good);tamper(b.record.originalResult);b.record.resultDigest=await digestResult(b.record.originalResult);
    assert.equal((await parseHistoryDetail(b,{recordId:id})).reason,'original');
  }
  const list=(await realPage(rows)).body.items.find(r=>r.recordId===id);
  assert.equal((await parse(()=>{},{listItem:list})).ok,true);
  assert.equal((await parse(()=>{},{listItem:{...list,resultDigest:'sha256:'+'1'.repeat(64)}})).reason,'listMismatch');
  const failing=await parseHistoryDetail(structuredClone(good),{recordId:id,hash:async()=>{throw Error('no crypto');}});
  assert.equal(failing.reason,'digest');
  const originalCopy=JSON.stringify(good);await parse(()=>{});assert.equal(JSON.stringify(good),originalCopy,'parsing never changes the original reply');
});

test('HTTP statuses map to distinct UI states, and 403 is never empty', ()=>{
  assert.deepEqual([400,401,403,404,429,500,503,409,201,302].map(historyStatusCode),['INVALID_QUERY','AUTH_REQUIRED','AUTH_REQUIRED','NOT_FOUND','RATE_LIMITED','SERVER_ERROR','SERVER_ERROR','INVALID_RESPONSE','INVALID_RESPONSE','INVALID_RESPONSE']);
});

test('history display maps use the session states, with no "normal" conversion', ()=>{
  const state=(schemaVersion,inspectionStatus)=>historyDisplayState({schemaVersion,inspectionStatus});
  assert.deepEqual([state(1,'OK'),state(1,'NEEDS_REFILL'),state(1,'UNSURE'),state(2,'REVIEW_NEEDED'),state(2,'UNABLE'),state(2,'NO_FINDINGS_REPORTED')],['NO_FINDINGS_REPORTED','FINDINGS_REPORTED','UNABLE','FINDINGS_REPORTED','UNABLE','NO_FINDINGS_REPORTED']);
});
