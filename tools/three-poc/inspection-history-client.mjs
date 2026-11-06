// P9-H1: stateless history reads for a part panel. No DOM, storage, credential, endpoint or 3D dependency.
// Every call resolves and never rejects, so a failed read has nothing to break: the caller shows a message and keeps
// its screen, its 3D state and its current inspection data. Replies are validated by the P8 contract before use.
// USER_REPORTED records only. They are never merged with session results or SDK observations.
import {HISTORY_AUTHORITY,HISTORY_PAGE_LIMIT,historyDisplayState,historyQueryFromFilters,historyStatusCode,isRecordId,parseHistoryDetail,parseHistoryList} from './inspection-history-contract.mjs';
import {targetForPart,exact} from './mobile-result-contract.mjs';

// The provider's origin decides which label a record must carry. A simulator record never passes as an owner's.
const AUTHORITY_BY_ORIGIN=Object.freeze({VERIFIED_NATIVE:HISTORY_AUTHORITY.VERIFIED,AVD_SIMULATOR_NATIVE:HISTORY_AUTHORITY.AVD_SIMULATOR});
const NO_ITEMS=Object.freeze([]);

const inspection=r=>Object.freeze({
  recordId:r.recordId,inspectionId:r.inspectionId,taskId:r.taskId,partId:r.partId,schemaVersion:r.schemaVersion,
  status:r.inspectionStatus,reportState:historyDisplayState(r),completedAt:r.completedAt,acceptedAt:r.acceptedAt,
  source:r.source,authorityNamespace:r.authorityNamespace,
});
const detailed=r=>Object.freeze({...inspection(r),receivedAt:r.receivedAt,resultDigest:r.resultDigest,responses:r.responses,originalResult:r.originalResult});
const failedList=status=>Object.freeze({status,items:NO_ITEMS,hasMore:false,nextCursor:null});
const failedOne=status=>Object.freeze({status,inspection:null});

/**
 * @param provider trusted composition only, the P8-B1 shape: {origin,list({query,signal}),detail({recordId,signal})}.
 * Result status: SUCCESS, EMPTY, or UNAVAILABLE, AUTH_REQUIRED, NOT_FOUND, INVALID_QUERY, RATE_LIMITED, SERVER_ERROR,
 * NETWORK_ERROR, INVALID_RESPONSE, ABORTED. Only EMPTY means "no record". Anything else says nothing about the records.
 */
export function createInspectionHistoryClient({provider=null,timeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout,hash}={}){
  const authority=provider&&typeof provider.list==='function'&&typeof provider.detail==='function'&&Object.hasOwn(AUTHORITY_BY_ORIGIN,provider.origin)?AUTHORITY_BY_ORIGIN[provider.origin]:null;
  const shared=new Map();

  async function send(method,args,callerSignal){
    if(callerSignal?.aborted)return {code:'ABORTED'};
    const controller=new AbortController();let timer,onAbort;
    const stopped=new Promise((_,reject)=>{
      onAbort=()=>{controller.abort();reject(Error('aborted'));};
      callerSignal?.addEventListener('abort',onAbort,{once:true});
      controller.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true});
      timer=setTimer(()=>controller.abort(),timeoutMs);
    });
    try{
      const reply=await Promise.race([Promise.resolve().then(()=>provider[method]({...args,signal:controller.signal})),stopped]);
      if(exact(reply,['unavailable'])&&['AUTH_REQUIRED','UNAVAILABLE'].includes(reply.unavailable))return {code:reply.unavailable};
      if(exact(reply,['status','body'])&&Number.isInteger(reply.status))return reply.status===200?{body:reply.body}:{code:historyStatusCode(reply.status)};
      return {code:'INVALID_RESPONSE'};
    }catch{return {code:callerSignal?.aborted?'ABORTED':'NETWORK_ERROR'};}
    finally{clearTimer(timer);callerSignal?.removeEventListener('abort',onAbort);}
  }
  // A repeated identical read while one is running (a double click, two panels) shares that one request.
  // A caller with its own signal may cancel, so it always gets its own request.
  function once(key,signal,run){
    if(signal)return run();
    if(!shared.has(key))shared.set(key,run().finally(()=>shared.delete(key)));
    return shared.get(key);
  }
  function readPage(partId,{limit,cursor,status},signal){
    if(!authority)return Promise.resolve(failedList('UNAVAILABLE'));
    if(!targetForPart(partId))return Promise.resolve(failedList('INVALID_QUERY'));
    const built=historyQueryFromFilters({partId,status},{cursor,limit});
    if(!built.ok)return Promise.resolve(failedList('INVALID_QUERY'));
    return once(JSON.stringify(['list',built.query]),signal,async()=>{
      const reply=await send('list',{query:built.query},signal);
      if(reply.code)return failedList(reply.code);
      const parsed=parseHistoryList(reply.body,{query:built.query,authority});
      if(!parsed.ok)return failedList(parsed.code);
      return Object.freeze({status:parsed.items.length?'SUCCESS':'EMPTY',items:Object.freeze(parsed.items.map(inspection)),hasMore:parsed.hasMore,nextCursor:parsed.nextCursor});
    });
  }
  return Object.freeze({
    available:authority!==null,
    async getLatestInspection(partId,{signal}={}){
      const page=await readPage(partId,{limit:1,cursor:null,status:null},signal);
      return page.status==='SUCCESS'?Object.freeze({status:'SUCCESS',inspection:page.items[0]}):failedOne(page.status);
    },
    /** Pass the previous nextCursor unchanged, with the same status, for the next page. */
    getInspectionHistory(partId,{limit=HISTORY_PAGE_LIMIT,cursor=null,status=null,signal}={}){
      return readPage(partId,{limit,cursor,status},signal);
    },
    /** By recordId, the key the API and the list items use. */
    async getInspectionDetail(recordId,{signal}={}){
      if(!authority)return failedOne('UNAVAILABLE');
      if(!isRecordId(recordId))return failedOne('INVALID_QUERY');
      return once(JSON.stringify(['detail',recordId]),signal,async()=>{
        const reply=await send('detail',{recordId},signal);
        if(reply.code)return failedOne(reply.code);
        const parsed=await parseHistoryDetail(reply.body,{recordId,authority,...(hash?{hash}:{})});
        return parsed.ok?Object.freeze({status:'SUCCESS',inspection:detailed(parsed.record)}):failedOne(parsed.code);
      });
    },
  });
}
