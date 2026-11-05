// Debug inspection asset only. Observes the Native RPC channel and never changes its outcome.
// Writes one line per anomaly, never one per healthy poll, so a 4 Hz poll cannot push the failure out of logcat.
// A record holds operation names, sanitized codes, counters and durations. It has no slot for identifiers,
// digests, proofs, results, URLs or raw error text, and every code passes an allow-list before it is kept.
export const DIAG_PREFIX='CARSCOPE_NATIVE_BRIDGE';
export const SLOW_RPC_MS=1000;
const OPS=new Set(['open','poll','request','verify','close']);
const CODE=/^(?:OK|TIMEOUT|ABORTED|FETCH_FAILED|HTTP_\d{3}|BAD_CONTENT_TYPE|TOO_LARGE|BAD_JSON|NATIVE_UNAVAILABLE|NATIVE_REJECTED|NATIVE_ERROR|NATIVE_NOTICE|LATE_RESPONSE|DELAYED_BINDING|CALLBACK_ERROR)$/;
const NOTICES=new Set(['SERVER_CLOCK_UNAVAILABLE','BINDING_DELIVERY_TIMEOUT','ACCEPTED_NOT_BOUND','INVALID_ACCEPTED_PROOF','RESULT_CONFLICT']);
const op=value=>OPS.has(value)?value:'other';
const code=value=>typeof value==='string'&&CODE.test(value)?value:'OTHER';
const ms=value=>Number.isFinite(value)?Math.max(0,Math.round(value)):null;

/** console.warn: logged through onConsoleMessage in the WebView, and stderr in Node where stdout may be a protocol. */
const defaultSink=record=>console.warn(`${DIAG_PREFIX} ${JSON.stringify(record)}`);

/** Main-thread stalls while an RPC was in flight. Null where the platform has no longtask entries. */
function defaultLongTasks(){
  try{
    const Observer=globalThis.PerformanceObserver;
    if(!Observer?.supportedEntryTypes?.includes('longtask'))return null;
    const entries=[];
    const keep=list=>{for(const e of list){entries.push({start:e.startTime,duration:e.duration});if(entries.length>32)entries.shift();}};
    const observer=new Observer(list=>keep(list.getEntries()));
    observer.observe({type:'longtask',buffered:true});
    return {within(from,to){keep(observer.takeRecords());return entries.filter(e=>e.start<to&&e.start+e.duration>from);}};
  }catch{return null;}
}

export function createBridgeDiagnostics({sink=defaultSink,now=()=>performance.now(),visibility=()=>globalThis.document?.visibilityState??'unknown',longTasks=defaultLongTasks(),capacity=16}={}){
  let session=0,rpcCount=0,lastOkAt=null,maxRunMs=0,maxQueueWaitMs=0,lastClose='NONE',openedAt=null;
  let recent=[];
  const emit=record=>{try{sink({session,...record});}catch{}};
  const stalls=(from,to)=>{
    try{
      const found=longTasks?.within(from,to);if(!found)return null;
      return {count:found.length,maxMs:ms(Math.max(0,...found.map(e=>e.duration))),totalMs:ms(found.reduce((sum,e)=>sum+e.duration,0))};
    }catch{return null;}
  };
  return Object.freeze({
    sessionOpened(){session++;rpcCount=0;lastOkAt=null;maxRunMs=0;maxQueueWaitMs=0;recent=[];openedAt=now();emit({event:'SESSION_OPEN',previousClose:lastClose,visibility:visibility()});},
    sessionClosing(){lastClose='PENDING';},
    sessionClosed(outcome){lastClose=outcome==='OK'?'OK':'FAILED';if(outcome!=='OK')emit({event:'SESSION_CLOSE_FAILED',code:code(outcome)});},
    rpc(name,{queuedAt,started,ended,code:result}){
      const entry={op:op(name),code:code(result),queueWaitMs:ms(started-queuedAt),runMs:ms(ended-started)};
      rpcCount++;maxRunMs=Math.max(maxRunMs,entry.runMs??0);maxQueueWaitMs=Math.max(maxQueueWaitMs,entry.queueWaitMs??0);
      if(entry.code==='OK')lastOkAt=ended;
      recent.push(entry);if(recent.length>capacity)recent.shift();
      if(entry.code!=='OK'||entry.runMs>=SLOW_RPC_MS)emit({event:'RPC_ANOMALY',...entry,visibility:visibility(),longTask:stalls(started,ended)});
    },
    /** The channel closed for this session. This is the record to read after `Native 전달 불가`. */
    failed(name,result,{notice}={}){
      const at=now();
      emit({event:'CHANNEL_FAILED',op:op(name),code:code(result),...(notice===undefined?{}:{notice:NOTICES.has(notice)?notice:'OTHER'}),
        previousClose:lastClose,visibility:visibility(),sinceOpenMs:ms(at-openedAt),sinceLastOkMs:lastOkAt===null?null:ms(at-lastOkAt),rpcCount,maxRunMs:ms(maxRunMs),maxQueueWaitMs:ms(maxQueueWaitMs),
        longTask:stalls(at-5000,at),recent:[...recent]});
    }
  });
}
