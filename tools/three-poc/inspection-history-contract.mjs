// P8-B1: client side of docs/contracts/p8-inspection-history-v1.md. Pure validation only:
// no network, DOM, credential, Native bridge or storage. Parsed records are deep-frozen copies.
// USER_REPORTED history is never merged with the session results or SDK observations.
import {targetForTask,targetForPart,exact,epoch,digestShape,validateMobileResult,digestResult,mobileReportState} from './mobile-result-contract.mjs';

export const HISTORY_PAGE_LIMIT=20;
/** Which label a record must carry. VERIFIED is the default, so the P8 store and screen keep refusing simulator rows. */
export const HISTORY_AUTHORITY=Object.freeze({
  VERIFIED:Object.freeze({namespace:'VERIFIED_VEHICLE',evidence:'SESSION_CREATION_BINDING'}),
  AVD_SIMULATOR:Object.freeze({namespace:'AVD_SIMULATOR',evidence:'AVD_REGISTRATION_BINDING'}),
});
export const HISTORY_STATUSES=Object.freeze(['OK','NEEDS_REFILL','UNSURE','REVIEW_NEEDED','UNABLE','NO_FINDINGS_REPORTED']);
const V1_STATUSES=Object.freeze(['OK','NEEDS_REFILL','UNSURE']);
const V2_STATUSES=Object.freeze(['REVIEW_NEEDED','UNABLE','NO_FINDINGS_REPORTED']);
const LIST_KEYS=Object.freeze(['recordId','inspectionId','taskId','partId','schemaVersion','inspectionStatus','resultDigest','completedAt','receivedAt','acceptedAt','createdAt','source','method','channel','authorityNamespace','ownershipEvidence','sdkDataIncluded']);
const DETAIL_KEYS=Object.freeze([...LIST_KEYS,'responses','originalResult']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURSOR=/^[A-Za-z0-9_-]{1,512}$/;
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_FILTER_YEAR=1970;

export const isRecordId=x=>typeof x==='string'&&UUID.test(x);
// The contract keeps completedAt as the user's reported time, so a valid pre-epoch value is allowed there only.
const signedTime=x=>Number.isSafeInteger(x)&&Math.abs(x)<=8640000000000000;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const copy=v=>freeze(JSON.parse(JSON.stringify(v)));
const invalid=reason=>({ok:false,code:'INVALID_RESPONSE',reason});

/** Display state shared with the session UI. Washer OK stays "no findings", never "normal". */
export const historyDisplayState=record=>mobileReportState({schemaVersion:record.schemaVersion,status:record.inspectionStatus});

function localDayStart(text){
  const m=DATE.exec(text??'');if(!m)return null;
  const [y,mo,d]=[Number(m[1]),Number(m[2]),Number(m[3])];
  if(y<MIN_FILTER_YEAR)return null;
  const at=new Date(y,mo-1,d);
  return at.getFullYear()===y&&at.getMonth()===mo-1&&at.getDate()===d&&epoch(at.getTime())?at:null;
}
export const EMPTY_HISTORY_FILTERS=Object.freeze({taskId:null,partId:null,status:null,fromDate:'',toDate:''});
export function normalizeHistoryFilters(filters={}){
  return Object.freeze({taskId:filters.taskId||null,partId:filters.partId||null,status:filters.status||null,fromDate:filters.fromDate||'',toDate:filters.toDate||''});
}
/**
 * UI filters to exact API query fields. toDate is inclusive for the user and becomes the next local
 * midnight because the server range is [from,to). A rejected filter is never sent to the server.
 */
export function historyQueryFromFilters(filters,{cursor=null,limit=HISTORY_PAGE_LIMIT}={}){
  const f=normalizeHistoryFilters(filters),query={limit:String(limit)};
  if(!Number.isInteger(limit)||limit<1||limit>100)return {ok:false,code:'INVALID_QUERY',reason:'limit'};
  if(f.taskId!==null&&!targetForTask(f.taskId))return {ok:false,code:'INVALID_QUERY',reason:'taskId'};
  if(f.partId!==null&&!targetForPart(f.partId))return {ok:false,code:'INVALID_QUERY',reason:'partId'};
  if(f.taskId!==null&&f.partId!==null&&targetForTask(f.taskId).partId!==f.partId)return {ok:false,code:'INVALID_QUERY',reason:'taskPart'};
  if(f.status!==null&&!HISTORY_STATUSES.includes(f.status))return {ok:false,code:'INVALID_QUERY',reason:'status'};
  const from=f.fromDate?localDayStart(f.fromDate):null,toDay=f.toDate?localDayStart(f.toDate):null;
  if(f.fromDate&&!from)return {ok:false,code:'INVALID_QUERY',reason:'from'};
  if(f.toDate&&!toDay)return {ok:false,code:'INVALID_QUERY',reason:'to'};
  const to=toDay?new Date(toDay.getFullYear(),toDay.getMonth(),toDay.getDate()+1):null;
  if(to&&!epoch(to.getTime()))return {ok:false,code:'INVALID_QUERY',reason:'to'};
  if(from&&to&&from.getTime()>=to.getTime())return {ok:false,code:'INVALID_QUERY',reason:'range'};
  if(cursor!==null&&!(typeof cursor==='string'&&CURSOR.test(cursor)))return {ok:false,code:'INVALID_QUERY',reason:'cursor'};
  if(f.taskId)query.taskId=f.taskId;
  if(f.partId)query.partId=f.partId;
  if(f.status)query.status=f.status;
  if(from)query.from=from.toISOString();
  if(to)query.to=to.toISOString();
  if(cursor!==null)query.cursor=cursor;
  return {ok:true,query:Object.freeze(query)};
}

function validRecord(r,keys,authority){
  if(!exact(r,keys))return false;
  const t=targetForTask(r.taskId);
  if(!t||r.partId!==t.partId||r.schemaVersion!==t.schemaVersion)return false;
  if(!(t.schemaVersion===1?V1_STATUSES:V2_STATUSES).includes(r.inspectionStatus))return false;
  if(!isRecordId(r.recordId)||!isRecordId(r.inspectionId)||!digestShape(r.resultDigest))return false;
  if(!signedTime(r.completedAt)||!epoch(r.receivedAt)||!epoch(r.acceptedAt)||!epoch(r.createdAt)||r.acceptedAt<r.receivedAt)return false;
  return r.source==='USER_REPORTED'&&r.method==='SELF'&&r.channel==='MOBILE'&&r.authorityNamespace===authority.namespace&&r.ownershipEvidence===authority.evidence&&r.sdkDataIncluded===false;
}
const newerThan=(a,b)=>a.completedAt>b.completedAt||a.completedAt===b.completedAt&&a.recordId>b.recordId;
function matchesQuery(r,q){
  if(q.taskId&&r.taskId!==q.taskId||q.partId&&r.partId!==q.partId||q.status&&r.inspectionStatus!==q.status)return false;
  if(q.from&&r.completedAt<Date.parse(q.from))return false;
  return !(q.to&&r.completedAt>=Date.parse(q.to));
}

/** Validates one list page against the exact request that produced it and the rows already shown. */
export function parseHistoryList(body,{query,prior=[],authority=HISTORY_AUTHORITY.VERIFIED}){
  if(!exact(body,['schemaVersion','items','page'])||body.schemaVersion!==1||!Array.isArray(body.items))return invalid('shape');
  const page=body.page,limit=Number(query.limit);
  if(!exact(page,['limit','hasMore','nextCursor'])||page.limit!==limit||typeof page.hasMore!=='boolean')return invalid('page');
  if(page.hasMore?!(typeof page.nextCursor==='string'&&CURSOR.test(page.nextCursor)&&page.nextCursor!==query.cursor):page.nextCursor!==null)return invalid('cursor');
  if(body.items.length>limit||page.hasMore&&body.items.length!==limit)return invalid('pageSize');
  const records=new Set(prior.map(r=>r.recordId)),inspections=new Set(prior.map(r=>r.inspectionId));
  let previous=prior.at(-1)??null;
  for(const item of body.items){
    if(!validRecord(item,LIST_KEYS,authority))return invalid('record');
    if(!matchesQuery(item,query))return invalid('filter');
    if(records.has(item.recordId)||inspections.has(item.inspectionId))return invalid('duplicate');
    if(previous&&!newerThan(previous,item))return invalid('order');
    records.add(item.recordId);inspections.add(item.inspectionId);previous=item;
  }
  return {ok:true,items:copy(body.items),hasMore:page.hasMore,nextCursor:page.nextCursor};
}

/** Validates a detail reply, including an independent canonical digest of the stored original. */
export async function parseHistoryDetail(body,{recordId,listItem=null,hash=digestResult,authority=HISTORY_AUTHORITY.VERIFIED}){
  if(!exact(body,['schemaVersion','record'])||body.schemaVersion!==1)return invalid('shape');
  const r=body.record;
  if(!validRecord(r,DETAIL_KEYS,authority)||r.recordId!==recordId)return invalid('record');
  const o=r.originalResult,t=targetForTask(r.taskId);
  if(!validateMobileResult(o,{allowPreEpoch:true})||o.taskId!==r.taskId||o.inspectionId!==r.inspectionId||o.schemaVersion!==r.schemaVersion||o.status!==r.inspectionStatus||Date.parse(o.completedAt)!==r.completedAt)return invalid('original');
  // Schema v1 washer records have no per-question answers: an empty object is valid, not missing data.
  const expected=t.schemaVersion===1?{}:o.responses;
  if(!exact(r.responses,Object.keys(expected))||Object.keys(expected).some(k=>r.responses[k]!==expected[k]))return invalid('responses');
  if(listItem&&LIST_KEYS.some(k=>listItem[k]!==r[k]))return invalid('listMismatch');
  let digest;try{digest=await hash(o);}catch{return invalid('digest');}
  if(digest!==r.resultDigest)return invalid('digest');
  return {ok:true,record:copy(r)};
}

/** Maps an HTTP status only. Server bodies are never displayed, and 403 never becomes an empty list. */
export function historyStatusCode(status){
  if(status===400)return 'INVALID_QUERY';
  if(status===401||status===403)return 'AUTH_REQUIRED';
  if(status===404)return 'NOT_FOUND';
  if(status===429)return 'RATE_LIMITED';
  if(Number.isInteger(status)&&status>=500&&status<600)return 'SERVER_ERROR';
  return 'INVALID_RESPONSE';
}
