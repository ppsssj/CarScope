// Fixed, reviewed composition. Only the Debug WebView's asset origin implements this RPC;
// requests carry identifiers, never QR/auth tokens or caller-supplied ACCEPTED results.
import {createBridgeDiagnostics} from './native-bridge-diagnostics.mjs';
const ORIGIN='https://carscope-inspection.invalid';
// Only an explicit REJECTED is a refusal. UNAVAILABLE, a delay or a broken reply says nothing about the request.
const failure=diagCode=>Object.assign(Error(diagCode),{diagCode,nativeRejected:diagCode==='NATIVE_REJECTED'});
// Maps any thrown value to a code; the raw message may hold the request URL and is never kept.
const classify=error=>error?.diagCode??(error?.name==='TimeoutError'?'TIMEOUT':error?.name==='AbortError'?'ABORTED':error instanceof SyntaxError?'BAD_JSON':'FETCH_FAILED');
export function createAndroidNativeInspectionAdapter({diagnostics}={}){
  if(globalThis.location?.origin!==ORIGIN||globalThis.location?.pathname!=='/index.html'||globalThis.self!==globalThis.top)return null;
  const diag=diagnostics??createBridgeDiagnostics();
  let context=null,owner=0,queue=Promise.resolve(),timer=null;
  const startedAt=new WeakMap();
  const send=(op,fields={},captured=context)=>{
    if(!captured)return Promise.reject(Error('No Native session'));
    const command={op,localSessionId:captured.localSessionId,generation:captured.generation,...fields};
    const queuedAt=performance.now();
    const run=async()=>{
      const started=performance.now();let code='OK';
      try{
        const response=await fetch(`/native-inspection-v1?command=${encodeURIComponent(JSON.stringify(command))}`,{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'same-origin',signal:AbortSignal.timeout(2000)});
        if(!response.ok)throw failure(`HTTP_${response.status}`);
        if(!response.headers.get('content-type')?.startsWith('application/json'))throw failure('BAD_CONTENT_TYPE');
        const text=await response.text();if(text.length>262144)throw failure('TOO_LARGE');
        const value=JSON.parse(text);
        if(value.error)throw failure(value.error==='UNAVAILABLE'?'NATIVE_UNAVAILABLE':value.error==='REJECTED'?'NATIVE_REJECTED':'NATIVE_ERROR');
        if(performance.now()-started>2000)throw failure('LATE_RESPONSE');
        startedAt.set(value,started);return value;
      }catch(error){code=classify(error);throw failure(code);}
      finally{diag.rpc(op,{queuedAt,started,ended:performance.now(),code});}
    };
    const promise=queue.then(run);queue=promise.catch(()=>{});return promise;
  };
  return Object.freeze({
    open(next){
      const epoch=++owner;context=next;let stopped=false;const seen=new Set();
      const current=()=>!stopped&&owner===epoch&&context===next;
      diag.sessionOpened();
      const poll=async()=>{
        try{
          const value=await send('poll',{},next);if(!current())return;
          next.onReceiver?.(value.receiver??null);
          if(value.unavailable){diag.failed('poll','NATIVE_NOTICE',{notice:value.unavailable});next.onUnavailable(value.unavailable);return;}
          for(const binding of value.bindings){
            if(performance.now()-startedAt.get(value)>2000)throw failure('DELAYED_BINDING');
            next.onBinding(binding);
            if(performance.now()-startedAt.get(value)>2000)throw failure('DELAYED_BINDING');
          }
          for(const terminal of value.terminal)next.onTerminal(terminal);
          for(const delivery of value.accepted){
            if(!current())return;
            const key=`${delivery.bindingId}:${delivery.inspectionId}:${delivery.resultDigest}`;
            if(!seen.has(key)){
              const status=await next.onAccepted(delivery);
              if(status==='STAGED'||status==='DUPLICATE')seen.add(key);
            }
          }
          if(current())timer=setTimeout(poll,250);
        }catch(error){if(current()){diag.failed('poll',error?.diagCode??'CALLBACK_ERROR');next.onUnavailable();}}
      };
      send('open',{},next).then(()=>{if(current())poll();}).catch(error=>{if(current()){diag.failed('open',classify(error));next.onUnavailable();}});
      return()=>{stopped=true;clearTimeout(timer);if(context===next){context=null;owner++;}diag.sessionClosing();send('close',{},next).then(()=>diag.sessionClosed('OK')).catch(error=>diag.sessionClosed(classify(error)));};
    },
    /** Layout and fixed actions only. The QR stays in Native and never passes through this page. */
    panelSlot(slot){return send('panel',slot);},
    control(action){return send('control',{action});},
    requestTask(request){
      if(!context||request.localSessionId!==context.localSessionId||request.generation!==context.generation)throw Error('Old session');
      return send('request',{taskId:request.taskId,partId:request.partId});
    },
    async verifyAccepted(delivery,binding){
      const fields=Object.fromEntries(['bindingId','syncSessionId','taskId','inspectionId','resultDigest'].map(k=>[k,delivery[k]]));
      for(const key of ['partId','serverNow','expiresAt'])fields[key]=binding[key];
      return (await send('verify',fields)).proof;
    }
  });
}
