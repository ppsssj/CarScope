// Fixed, reviewed composition. Only the Debug WebView's asset origin implements this RPC;
// requests carry identifiers, never QR/auth tokens or caller-supplied ACCEPTED results.
const ORIGIN='https://carscope-inspection.invalid';
export function createAndroidNativeInspectionAdapter(){
  if(globalThis.location?.origin!==ORIGIN||globalThis.location?.pathname!=='/index.html'||globalThis.self!==globalThis.top)return null;
  let context=null,owner=0,queue=Promise.resolve(),timer=null;
  const startedAt=new WeakMap();
  const send=(op,fields={},captured=context)=>{
    if(!captured)return Promise.reject(Error('No Native session'));
    const command={op,localSessionId:captured.localSessionId,generation:captured.generation,...fields};
    const run=async()=>{
      const started=performance.now();
      const response=await fetch(`/native-inspection-v1?command=${encodeURIComponent(JSON.stringify(command))}`,{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'same-origin',signal:AbortSignal.timeout(2000)});
      if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('Native unavailable');
      const text=await response.text();if(text.length>262144)throw Error('Native reply too large');
      const value=JSON.parse(text);
      // Only an explicit REJECTED is a refusal. UNAVAILABLE, a delay or a broken reply says nothing about the request.
      if(value.error==='REJECTED')throw Object.assign(Error('Native rejected request'),{nativeRejected:true});
      if(value.error||performance.now()-started>2000)throw Error('Native unavailable or delayed');startedAt.set(value,started);return value;
    };
    const promise=queue.then(run);queue=promise.catch(()=>{});return promise;
  };
  return Object.freeze({
    open(next){
      const epoch=++owner;context=next;let stopped=false;const seen=new Set();
      const current=()=>!stopped&&owner===epoch&&context===next;
      const poll=async()=>{
        try{
          const value=await send('poll',{},next);if(!current())return;
          if(value.unavailable){next.onUnavailable(value.unavailable);return;}
          for(const binding of value.bindings){
            if(performance.now()-startedAt.get(value)>2000)throw Error('Delayed binding');
            next.onBinding(binding);
            if(performance.now()-startedAt.get(value)>2000)throw Error('Delayed binding');
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
        }catch{if(current())next.onUnavailable();}
      };
      send('open',{},next).then(()=>{if(current())poll();}).catch(()=>{if(current())next.onUnavailable();});
      return()=>{stopped=true;clearTimeout(timer);if(context===next){context=null;owner++;}send('close',{},next).catch(()=>{});};
    },
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
