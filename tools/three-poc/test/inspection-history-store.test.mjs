import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInspectionHistoryStore} from '../inspection-history-store.mjs';
import {demoRows} from './history-demo-provider.mjs';
import {demoHistoryProvider,demoControl} from './history-demo-provider.mjs';

const rows=await demoRows(45);
const dto=(r,detail)=>{const {originalResult,...f}=r;return {...f,source:'USER_REPORTED',method:'SELF',channel:'MOBILE',ownershipEvidence:'SESSION_CREATION_BINDING',sdkDataIncluded:false,...(detail?{responses:originalResult.responses??{},originalResult}:{})};};
const page=(from,to,limit=20,next=null)=>({status:200,body:{schemaVersion:1,items:rows.slice(from,to).map(r=>dto(r)),page:{limit,hasMore:next!==null,nextCursor:next}}});
const detailOf=r=>({status:200,body:{schemaVersion:1,record:dto(r,true)}});
const error=(status,code)=>({status,body:{error:{code}}});
const tick=()=>new Promise(r=>setImmediate(r));
/** Provider whose replies are released by hand, so stale and reversed arrival orders are explicit. */
function manual(){
  const calls=[];
  const take=(op,args)=>new Promise((resolve,reject)=>calls.push({op,...args,resolve,reject}));
  return {calls,provider:{origin:'DEMO',list:a=>take('list',a),detail:a=>take('detail',a)}};
}
const scripted=(replies,details={})=>{const calls=[];return {calls,provider:{origin:'DEMO',list:async a=>{calls.push(a);const r=replies.shift();if(r instanceof Error)throw r;return r;},detail:async a=>{calls.push(a);const r=details[a.recordId];if(r instanceof Error)throw r;return r;}}};};

test('without a provider the store is UNAVAILABLE, performs no request and is not EMPTY', async()=>{
  const store=createInspectionHistoryStore({provider:null});
  await store.openList();
  assert.equal(store.snapshot.provider,'UNAVAILABLE');assert.equal(store.snapshot.list.status,'UNAVAILABLE');assert.equal(store.snapshot.origin,null);
  assert.equal(await store.loadMore(),false);
  await store.openDetail(rows[0].recordId);assert.equal(store.snapshot.detail.status,'UNAVAILABLE');
  for(const bad of [{},{origin:'VERIFIED_NATIVE'},{origin:'ANYTHING',list(){},detail(){}},{list(){},detail(){}}]){
    const s=createInspectionHistoryStore({provider:bad});await s.openList();assert.equal(s.snapshot.provider,'UNAVAILABLE');
  }
});

test('each failure status stays distinct, and 403 is never EMPTY', async()=>{
  for(const [reply,want] of [[page(0,0),'EMPTY'],[error(403,'FORBIDDEN'),'AUTH_REQUIRED'],[error(404,'NOT_FOUND'),'NOT_FOUND'],[error(400,'BAD_REQUEST'),'INVALID_QUERY'],[error(429,'RATE_LIMITED'),'RATE_LIMITED'],[error(500,'INTERNAL'),'SERVER_ERROR'],[Error('offline'),'NETWORK_ERROR'],[{status:200,body:{}},'INVALID_RESPONSE'],[{status:200},'INVALID_RESPONSE'],[{unavailable:'AUTH_REQUIRED'},'AUTH_REQUIRED'],[{unavailable:'UNAVAILABLE'},'UNAVAILABLE'],[{status:201,body:{}},'INVALID_RESPONSE']]){
    const {provider}=scripted([reply]),store=createInspectionHistoryStore({provider});
    const during=store.openList();assert.equal(store.snapshot.list.status,'LOADING');await during;
    assert.equal(store.snapshot.list.status,want);assert.equal(store.snapshot.list.items.length,0);
  }
});

test('changing filters drops rows and cursor and restarts on the first page', async()=>{
  const {provider,calls}=scripted([page(0,20,20,'cursorA'),page(0,1)]),store=createInspectionHistoryStore({provider});
  await store.openList();assert.equal(store.snapshot.list.items.length,20);assert.equal(store.snapshot.list.hasMore,true);
  const pending=store.setFilters({taskId:rows[0].taskId});
  assert.equal(store.snapshot.list.items.length,0);assert.equal(store.snapshot.list.status,'LOADING');await pending;
  assert.equal(calls[1].query.cursor,undefined);assert.equal(calls[1].query.taskId,rows[0].taskId);
  assert.equal(store.snapshot.list.items.length,1);assert.equal('cursor' in store.snapshot.list,false,'the opaque cursor is not exposed');
});

test('late, reversed and superseded responses cannot pollute the list', async()=>{
  const {provider,calls}=manual(),store=createInspectionHistoryStore({provider});
  const a=store.openList();await tick();const b=store.setFilters({taskId:rows[1].taskId});await tick();
  assert.equal(calls[0].signal.aborted,true,'superseded request is cancelled');
  calls[1].resolve(page(1,2));await b;
  calls[0].resolve(page(0,20,20,'oldCursor'));await a;await tick();
  assert.equal(store.snapshot.list.items.length,1);assert.equal(store.snapshot.list.items[0].taskId,rows[1].taskId);assert.equal(store.snapshot.list.hasMore,false);
});

test('duplicate "more" clicks send one request, and a filter change defeats an in-flight page', async()=>{
  const {provider,calls}=manual(),store=createInspectionHistoryStore({provider});
  const first=store.openList();await tick();calls[0].resolve(page(0,20,20,'cursorA'));await first;
  const more=store.loadMore();await tick();
  assert.equal(await store.loadMore(),false);await tick();assert.equal(calls.length,2);assert.equal(calls[1].query.cursor,'cursorA');
  assert.equal(store.snapshot.list.moreStatus,'LOADING');
  const change=store.setFilters({status:'UNABLE'});await tick();assert.equal(calls[1].signal.aborted,true);
  calls[1].resolve(page(20,40,20,'cursorB'));await more;await tick();
  assert.equal(store.snapshot.list.status,'LOADING');assert.equal(store.snapshot.list.items.length,0);
  calls[2].resolve(page(0,0));await change;assert.equal(store.snapshot.list.status,'EMPTY');
});

test('a failed page keeps loaded rows, retries the same cursor, and a rejected cursor restarts', async()=>{
  const {provider,calls}=scripted([page(0,20,20,'cursorA'),error(429,'RATE_LIMITED'),page(20,40,20,'cursorB'),error(400,'BAD_REQUEST'),page(0,20,20,'cursorA')]),store=createInspectionHistoryStore({provider});
  await store.openList();await store.loadMore();
  assert.equal(store.snapshot.list.moreStatus,'RATE_LIMITED');assert.equal(store.snapshot.list.items.length,20);
  await store.retry();assert.equal(calls[2].query.cursor,'cursorA');assert.equal(store.snapshot.list.items.length,40);assert.equal(store.snapshot.list.moreStatus,null);
  await store.loadMore();assert.equal(store.snapshot.list.moreStatus,'INVALID_QUERY');assert.equal(store.snapshot.list.items.length,40);
  await store.retry();assert.equal(calls[4].query.cursor,undefined);assert.equal(store.snapshot.list.items.length,20);
});

test('a duplicated or out-of-order next page is rejected and existing rows stay intact', async()=>{
  const {provider}=scripted([page(0,20,20,'cursorA'),page(19,39,20,'cursorB'),page(0,20,20,'cursorA')]),store=createInspectionHistoryStore({provider});
  await store.openList();await store.loadMore();
  assert.equal(store.snapshot.list.moreStatus,'INVALID_RESPONSE');assert.equal(store.snapshot.list.items.length,20);
  assert.equal(new Set(store.snapshot.list.items.map(r=>r.recordId)).size,20);
});

test('403 anywhere clears rows and sensitive detail, and in-flight replies cannot restore them', async()=>{
  const r=rows[1],{provider,calls}=manual(),store=createInspectionHistoryStore({provider});
  const first=store.openList();await tick();calls[0].resolve(page(0,20,20,'cursorA'));await first;
  const d=store.openDetail(r.recordId);await tick();calls[1].resolve(detailOf(r));await d;
  assert.equal(store.snapshot.detail.status,'SUCCESS');assert.ok(store.snapshot.detail.record.originalResult);
  const more=store.loadMore();await tick();calls[2].resolve(error(403,'FORBIDDEN'));await more;
  const s=store.snapshot;
  assert.equal(s.list.status,'AUTH_REQUIRED');assert.equal(s.list.items.length,0);assert.equal(s.list.hasMore,false);
  assert.equal(s.detail.status,'AUTH_REQUIRED');assert.equal(s.detail.record,null);
  assert.ok(!JSON.stringify(s).includes(r.resultDigest),'no record content remains');
  // A revocation signal from the provider behaves the same, cancelling reads already in flight.
  const late=store.retry();await tick();assert.ok(calls.at(-1).signal.aborted===false);
  store.revokeAccess();assert.equal(store.snapshot.list.status,'AUTH_REQUIRED');assert.ok(calls.at(-1).signal.aborted);
  calls.at(-1).resolve(detailOf(r));for(const c of calls.slice(3,-1))c.resolve(page(0,20,20,'x'));await late;await tick();
  assert.equal(store.snapshot.detail.record,null);assert.equal(store.snapshot.list.items.length,0);
});

test('provider access-revoked signal clears data and dispose unsubscribes', async()=>{
  let revoked=null,unsubscribed=0;
  const provider={origin:'DEMO',list:async()=>page(0,20),detail:async()=>detailOf(rows[0]),onAccessRevoked(fn){revoked=fn;return()=>{unsubscribed++;};}},store=createInspectionHistoryStore({provider});
  await store.openList();await store.openDetail(rows[0].recordId);assert.ok(store.snapshot.detail.record);
  revoked();assert.equal(store.snapshot.list.status,'AUTH_REQUIRED');assert.equal(store.snapshot.detail.record,null);
  store.dispose();assert.equal(unsubscribed,1);assert.equal(store.snapshot.provider,'DISPOSED');
});

test('detail: stale response, 404 keeps the list, invalid id sends nothing, and closing cancels', async()=>{
  const [a,b]=[rows[0],rows[2]],{provider,calls}=manual(),store=createInspectionHistoryStore({provider});
  const first=store.openList();await tick();calls[0].resolve(page(0,20));await first;
  const da=store.openDetail(a.recordId);await tick();const db=store.openDetail(b.recordId);await tick();
  assert.equal(calls[1].signal.aborted,true);
  calls[2].resolve(detailOf(b));await db;assert.equal(store.snapshot.detail.record.recordId,b.recordId);
  calls[1].resolve(detailOf(a));await da;await tick();assert.equal(store.snapshot.detail.record.recordId,b.recordId,'older reply is discarded');
  const dc=store.openDetail(a.recordId);await tick();calls[3].resolve(error(404,'NOT_FOUND'));await dc;
  assert.equal(store.snapshot.detail.status,'NOT_FOUND');assert.equal(store.snapshot.list.items.length,20);
  const count=calls.length;await store.openDetail('../../etc');assert.equal(store.snapshot.detail.status,'INVALID_QUERY');assert.equal(calls.length,count);
  const dd=store.openDetail(a.recordId);await tick();const held=calls.at(-1);store.closeDetail();assert.equal(held.signal.aborted,true);
  held.resolve(detailOf(a));await dd;await tick();assert.equal(store.snapshot.detail.status,'IDLE');assert.equal(store.snapshot.detail.record,null);
});

test('a reply replaced during its digest verification cannot publish', async()=>{
  const r=rows[1];let release;const hash=()=>new Promise(res=>{release=res;});
  const {provider,calls}=manual(),store=createInspectionHistoryStore({provider,hash});
  const first=store.openList();await tick();calls[0].resolve(page(0,20));await first;
  const d=store.openDetail(r.recordId);await tick();calls[1].resolve(detailOf(r));await tick();await tick();
  store.closeDetail();release(r.resultDigest);await d;assert.equal(store.snapshot.detail.record,null);
});

test('a provider that never answers times out to NETWORK_ERROR, even if it ignores abort', async()=>{
  let fire;const store=createInspectionHistoryStore({provider:{origin:'DEMO',list:()=>new Promise(()=>{}),detail:()=>new Promise(()=>{})},setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{}});
  const p=store.openList();await tick();assert.equal(store.snapshot.list.status,'LOADING');fire();await p;
  assert.equal(store.snapshot.list.status,'NETWORK_ERROR');
});

test('leaving, suspending and disposing discard data and block late replies; resume reads fresh', async()=>{
  const {provider,calls}=manual(),store=createInspectionHistoryStore({provider});
  const a=store.openList();await tick();store.closeList();calls[0].resolve(page(0,20));await a;await tick();
  assert.equal(store.snapshot.list.status,'IDLE');assert.equal(store.snapshot.list.items.length,0);
  const b=store.openList({taskId:rows[0].taskId});await tick();assert.equal(calls[1].query.taskId,rows[0].taskId);
  calls[1].resolve(page(0,1));await b;assert.equal(store.snapshot.list.items.length,1);
  const d=store.openDetail(rows[0].recordId);await tick();calls[2].resolve(detailOf(rows[0]));await d;
  store.suspend();
  assert.equal(store.snapshot.list.items.length,0);assert.equal(store.snapshot.detail.record,null);assert.equal(store.snapshot.filters.taskId,rows[0].taskId);
  const r=store.resume();await tick();assert.equal(calls[3].op,'list');assert.equal(calls[3].query.taskId,rows[0].taskId);assert.equal(calls[4].recordId,rows[0].recordId);
  store.suspend();assert.equal(calls[3].signal.aborted,true);assert.equal(calls[4].signal.aborted,true);
  calls[3].resolve(page(0,1));calls[4].resolve(detailOf(rows[0]));await r;await tick();assert.equal(store.snapshot.list.items.length,0);
  store.closeList();assert.equal(store.snapshot.filters.taskId,null);store.resume();await tick();assert.equal(calls.length,5,'resume after leaving reads nothing');
  const c=store.openList();await tick();store.dispose();calls[5].resolve(page(0,20));await c;await tick();
  assert.equal(store.snapshot.provider,'DISPOSED');assert.equal(store.snapshot.list.items.length,0);
  await store.openList();assert.equal(calls.length,6,'a disposed store never reads again');
});

test('parsed rows are immutable and the snapshot exposes no way to change them', async()=>{
  const {provider}=scripted([page(0,5)]),store=createInspectionHistoryStore({provider});await store.openList();
  const s=store.snapshot;assert.throws(()=>{'use strict';s.list.items[0].completedAt=1;},TypeError);assert.throws(()=>{'use strict';s.list.items.push({});},TypeError);
});

test('demo provider paginates with a filter-bound opaque cursor through the store', async()=>{
  demoControl.rows=null;demoControl.calls.length=0;
  const store=createInspectionHistoryStore({provider:demoHistoryProvider});
  await store.openList();assert.equal(store.snapshot.origin,'DEMO');assert.equal(store.snapshot.list.items.length,20);
  await store.loadMore();await store.loadMore();assert.equal(store.snapshot.list.items.length,45);assert.equal(store.snapshot.list.hasMore,false);
});

test('History modules have no credential, network, storage or Native bridge dependency', ()=>{
  for(const file of ['inspection-history-contract.mjs','inspection-history-store.mjs','inspection-history-view.mjs']){
    const code=readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,'');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|Authorization|[Bb]earer|X-Forwarded|\/v1\/inspection-records|native-inspection|android-native|postMessage/.test(code),file);
    assert.ok(!/from\s+['"]\.\/(tire-status|component-status|ev-charge-status|visibility-status|native-inspection-results|android-native-inspection-adapter|inspection-results)\.mjs/.test(code),`${file}: no session store or SDK source`);
    assert.ok(!/from\s+['"][^'"]*test\//.test(code),file);
  }
});
