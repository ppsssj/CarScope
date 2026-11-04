// P8-B1: History read state, independent of the DOM and of every credential.
//
// Read provider capability (trusted composition only, never selected by URL, window, postMessage or JSON):
//   origin: 'VERIFIED_NATIVE' | 'DEMO'
//   list({query,signal})             -> Promise<{status,body} | {unavailable:'AUTH_REQUIRED'|'UNAVAILABLE'}>
//   detail({recordId,signal})        -> same reply shape
//   onAccessRevoked(callback)        -> unsubscribe function (optional)
// A provider owns authentication and the HTTP request. Tokens, bearer values and endpoints never cross
// this interface. The Native -> 3D ACCEPTED bridge is not a provider and grants no History access.
import {EMPTY_HISTORY_FILTERS,normalizeHistoryFilters,historyQueryFromFilters,parseHistoryList,parseHistoryDetail,historyStatusCode,isRecordId} from './inspection-history-contract.mjs';
import {exact} from './mobile-result-contract.mjs';

const PROVIDER_ORIGINS=Object.freeze(['VERIFIED_NATIVE','DEMO']);
const usable=p=>!!p&&typeof p.list==='function'&&typeof p.detail==='function'&&PROVIDER_ORIGINS.includes(p.origin);
const emptyList=status=>({status,items:Object.freeze([]),hasMore:false,cursor:null,moreStatus:null});
const emptyDetail=()=>({status:'IDLE',recordId:null,record:null});

export function createInspectionHistoryStore({provider=null,timeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout,hash}={}){
  const connected=usable(provider),listeners=new Set();
  let closed=false,open=false,suspended=false,filters=EMPTY_HISTORY_FILTERS;
  let list=emptyList('IDLE'),detail=emptyDetail();
  let listCall=null,detailCall=null;
  const emit=()=>{for(const fn of listeners)fn();};

  function abort(call){call?.controller.abort();}
  // Every call is a new capability: only the call currently held may publish its reply.
  function begin(kind){
    if(kind==='list'){abort(listCall);listCall={controller:new AbortController()};return listCall;}
    abort(detailCall);detailCall={controller:new AbortController()};return detailCall;
  }
  const isCurrent=(kind,call)=>!closed&&(kind==='list'?listCall:detailCall)===call;

  async function send(method,args,call){
    let timer;
    const stopped=new Promise((_,reject)=>{
      call.controller.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
      timer=setTimer(()=>call.controller.abort(),timeoutMs);
    });
    try{
      const reply=await Promise.race([Promise.resolve().then(()=>provider[method]({...args,signal:call.controller.signal})),stopped]);
      if(exact(reply,['unavailable'])&&['AUTH_REQUIRED','UNAVAILABLE'].includes(reply.unavailable))return {code:reply.unavailable};
      if(exact(reply,['status','body'])&&Number.isInteger(reply.status))return reply.status===200?{body:reply.body}:{code:historyStatusCode(reply.status)};
      return {code:'INVALID_RESPONSE'};
    }catch{return {code:'NETWORK_ERROR'};}
    finally{clearTimer(timer);}
  }
  // Expired or revoked access: no previously shown record survives, and in-flight replies are discarded.
  function revoke(){
    if(closed||!open)return;
    abort(listCall);abort(detailCall);listCall=null;detailCall=null;
    list=emptyList('AUTH_REQUIRED');
    detail=detail.recordId?{status:'AUTH_REQUIRED',recordId:detail.recordId,record:null}:emptyDetail();
    emit();
  }

  async function loadFirst(){
    abort(listCall);listCall=null;
    if(closed||!open)return;
    if(!connected){list=emptyList('UNAVAILABLE');emit();return;}
    const built=historyQueryFromFilters(filters);
    if(!built.ok){list=emptyList(built.code);emit();return;}
    const call=begin('list');list=emptyList('LOADING');emit();
    const reply=await send('list',{query:built.query},call);
    if(!isCurrent('list',call))return;
    if(reply.code==='AUTH_REQUIRED'){revoke();return;}
    if(reply.code){list=emptyList(reply.code);listCall=null;emit();return;}
    const parsed=parseHistoryList(reply.body,{query:built.query});
    listCall=null;
    list=!parsed.ok?emptyList(parsed.code):{status:parsed.items.length?'SUCCESS':'EMPTY',items:parsed.items,hasMore:parsed.hasMore,cursor:parsed.nextCursor,moreStatus:null};
    emit();
  }
  async function loadMore(){
    if(closed||!open||!connected||list.status!=='SUCCESS'||!list.hasMore||!list.cursor||list.moreStatus==='LOADING')return false;
    const built=historyQueryFromFilters(filters,{cursor:list.cursor});
    if(!built.ok){list={...list,moreStatus:built.code};emit();return false;}
    const call=begin('list'),base=list;list={...base,moreStatus:'LOADING'};emit();
    const reply=await send('list',{query:built.query},call);
    if(!isCurrent('list',call))return false;
    if(reply.code==='AUTH_REQUIRED'){revoke();return false;}
    listCall=null;
    if(reply.code){list={...base,moreStatus:reply.code};emit();return false;}
    const parsed=parseHistoryList(reply.body,{query:built.query,prior:base.items});
    if(!parsed.ok){list={...base,moreStatus:parsed.code};emit();return false;}
    list={status:'SUCCESS',items:Object.freeze([...base.items,...parsed.items]),hasMore:parsed.hasMore,cursor:parsed.nextCursor,moreStatus:null};
    emit();return true;
  }
  async function loadDetail(recordId){
    abort(detailCall);detailCall=null;
    if(closed||!open)return;
    if(!connected){detail={status:'UNAVAILABLE',recordId,record:null};emit();return;}
    if(!isRecordId(recordId)){detail={status:'INVALID_QUERY',recordId:null,record:null};emit();return;}
    const call=begin('detail'),listItem=list.items.find(r=>r.recordId===recordId)??null;
    detail={status:'LOADING',recordId,record:null};emit();
    const reply=await send('detail',{recordId},call);
    if(!isCurrent('detail',call))return;
    if(reply.code==='AUTH_REQUIRED'){revoke();return;}
    if(reply.code){detailCall=null;detail={status:reply.code,recordId,record:null};emit();return;}
    const parsed=await parseHistoryDetail(reply.body,{recordId,listItem,...(hash?{hash}:{})});
    if(!isCurrent('detail',call))return;
    detailCall=null;
    detail=parsed.ok?{status:'SUCCESS',recordId,record:parsed.record}:{status:parsed.code,recordId,record:null};
    emit();
  }
  function clearAll(){
    abort(listCall);abort(detailCall);listCall=null;detailCall=null;
    list=emptyList('IDLE');detail=emptyDetail();
  }
  const unsubscribeRevocation=connected&&typeof provider.onAccessRevoked==='function'?provider.onAccessRevoked(revoke):null;

  return Object.freeze({
    /** Entering the History screens starts from the first page; nothing is restored from an earlier visit. */
    openList(next={}){if(closed)return;open=true;suspended=false;detail=emptyDetail();filters=normalizeHistoryFilters(next);return loadFirst();},
    /** Any filter change discards the old rows and cursor; an older in-flight page cannot publish. */
    setFilters(next){if(closed||!open)return;filters=normalizeHistoryFilters(next);return loadFirst();},
    loadMore,
    openDetail(recordId){if(closed||!open)return;return loadDetail(recordId);},
    closeDetail(){abort(detailCall);detailCall=null;detail=emptyDetail();emit();},
    /** Retries only the failed operation. A rejected cursor or page restarts from the first page. */
    retry(){
      if(closed||!open)return;
      if(detail.recordId&&!['SUCCESS','LOADING'].includes(detail.status)){
        const reload=list.status==='AUTH_REQUIRED'?loadFirst():null;
        return Promise.all([reload,loadDetail(detail.recordId)]);
      }
      if(['RATE_LIMITED','SERVER_ERROR','NETWORK_ERROR'].includes(list.moreStatus))return loadMore();
      return loadFirst();
    },
    revokeAccess:revoke,
    /** Screen left: no record stays in memory and no late reply can publish. */
    closeList(){open=false;suspended=false;filters=EMPTY_HISTORY_FILTERS;clearAll();emit();},
    /** Host paused or hidden: access may change while away, so drop rows until an explicit fresh read. */
    suspend(){if(closed||!open||suspended)return;suspended=true;const recordId=detail.recordId;clearAll();detail={...emptyDetail(),recordId};list=emptyList('IDLE');emit();},
    resume(){
      if(closed||!open||!suspended)return;
      suspended=false;const recordId=detail.recordId;detail=emptyDetail();
      const first=loadFirst();if(recordId)loadDetail(recordId);return first;
    },
    get snapshot(){return Object.freeze({
      provider:closed?'DISPOSED':connected?'CONNECTED':'UNAVAILABLE',
      origin:connected&&!closed?provider.origin:null,filters,
      // The opaque cursor stays private: the UI only needs to know whether more rows exist.
      list:Object.freeze({status:list.status,items:list.items,hasMore:list.hasMore,moreStatus:list.moreStatus}),
      detail:Object.freeze({...detail}),
    });},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    dispose(){if(closed)return;clearAll();closed=true;open=false;try{unsubscribeRevocation?.();}catch{}emit();listeners.clear();},
  });
}
