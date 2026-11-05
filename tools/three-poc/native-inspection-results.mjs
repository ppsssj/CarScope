import {targetForTask,exact,epoch,identifier,digestShape,validateMobileResult,digestResult} from './mobile-result-contract.mjs';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const copy=value=>freeze(JSON.parse(JSON.stringify(value)));
const bindingKeys=['bindingId','localSessionId','generation','syncSessionId','taskId','partId','serverNow','expiresAt'];
const deliveryKeys=['bindingId','localSessionId','generation','syncSessionId','taskId','inspectionId','resultDigest','result'];
const proofKeys=['version','proofId','sessionState','bindingId','localSessionId','generation','syncSessionId','taskId','inspectionId','resultDigest','receivedAt','acceptedAt'];

/** Trusted composition only: adapter.open/verifyAccepted are never selected by URL, JSON or globals.
 * Production inspect.js composes the fixed Android asset adapter; other origins remain disconnected.
 * Test adapters live under test/, are not packaged, and cannot reach a production page's closure.
 */
// Longer than the adapter's own bound (2 s per RPC, behind at most one RPC already queued), so it only catches an adapter that never answers.
const REQUEST_TIMEOUT_MS=8000;
const REQUEST_NOTICES=new Set(['NATIVE_NOT_CONNECTED','REQUEST_REJECTED','REQUEST_FAILED']);
export function createNativeInspectionResults({adapter=null,now=()=>performance.now(),hash=digestResult,requestTimeoutMs=REQUEST_TIMEOUT_MS,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
  let localSessionId=null,generation=0,closed=false,detach=null,connection='INCOMPLETE_NATIVE',notice=null,pendingRequest=null;
  let bindings=new Map(),records=new Map(),selected=new Map();const listeners=new Set();
  const emit=()=>{for(const fn of listeners)fn();};
  const fail=code=>{notice=code;emit();return code;};
  const current=(session,epoch)=>!closed&&connection==='ADAPTER_CONNECTED'&&localSessionId===session&&generation===epoch;
  const live=b=>b&&b.state==='ACTIVE'&&now()<=b.deadline;
  const matches=(value,b)=>['bindingId','localSessionId','generation','syncSessionId','taskId'].every(k=>value[k]===b[k]);
  function tick(){let changed=false;for(const b of bindings.values())if(b.state==='ACTIVE'&&now()>b.deadline){b.state='EXPIRED';changed=true;}if(changed)emit();}
  function onBinding(raw,session,epochId){
    if(!current(session,epochId))return 'OLD_SESSION';
    if(!exact(raw,bindingKeys))return fail('INVALID_BINDING');
    const t=targetForTask(raw.taskId);
    if(!t||raw.partId!==t.partId||raw.localSessionId!==session||raw.generation!==epochId||!['bindingId','syncSessionId','localSessionId'].every(k=>identifier(raw[k]))||!epochNumber(raw.generation)||!epoch(raw.serverNow)||!epoch(raw.expiresAt)||raw.serverNow>raw.expiresAt)return fail('INVALID_BINDING');
    const prior=bindings.get(raw.bindingId);
    if(prior)return matches(raw,prior)&&raw.expiresAt===prior.expiresAt?'DUPLICATE':fail('BINDING_CONFLICT');
    if([...bindings.values()].some(b=>b.syncSessionId===raw.syncSessionId))return fail('BINDING_CONFLICT');
    if(bindings.size>=100)return fail('CAPACITY');
    bindings.set(raw.bindingId,{...copy(raw),deadline:now()+raw.expiresAt-raw.serverNow,state:'ACTIVE'});notice=null;emit();return 'BOUND';
  }
  // The local generation is independent of epoch() server timestamp validation.
  const epochNumber=n=>Number.isSafeInteger(n)&&n>0;
  async function onAccepted(raw,session,epochId){
    if(!current(session,epochId))return 'OLD_SESSION';
    let d;try{d=copy(raw);}catch{return fail('INVALID_RESULT');}
    if(!exact(d,deliveryKeys)||!validateMobileResult(d.result)||!digestShape(d.resultDigest)||d.inspectionId!==d.result.inspectionId||d.taskId!==d.result.taskId)return fail('INVALID_RESULT');
    const b=bindings.get(d.bindingId);if(!matches(d,b??{})||!live(b))return fail('INACTIVE_BINDING');
    let digest,proof;try{digest=await hash(d.result);if(!current(session,epochId)||!live(b))return 'OLD_SESSION';
      if(digest!==d.resultDigest)return fail('DIGEST_MISMATCH');
      proof=copy(await adapter.verifyAccepted(d,copyBinding(b)));
    }catch{return current(session,epochId)?fail('VERIFICATION_FAILED'):'OLD_SESSION';}
    if(!current(session,epochId)||bindings.get(b.bindingId)!==b||!live(b))return 'OLD_SESSION';
    if(!exact(proof,proofKeys)||proof.version!==1||proof.sessionState!=='ACCEPTED'||!identifier(proof.proofId)||!matches(proof,b)||proof.inspectionId!==d.inspectionId||proof.resultDigest!==digest||!epoch(proof.receivedAt)||!epoch(proof.acceptedAt)||proof.receivedAt<b.serverNow||proof.acceptedAt<proof.receivedAt||proof.acceptedAt>b.expiresAt)return fail('INVALID_ACCEPTED_PROOF');
    const old=records.get(d.inspectionId);
    if(old)return old.taskId===d.taskId&&old.resultDigest===digest?'DUPLICATE':fail('RESULT_CONFLICT');
    if(records.size>=100)return fail('CAPACITY');
    records.set(d.inspectionId,copy({inspectionId:d.inspectionId,taskId:d.taskId,partId:b.partId,resultDigest:digest,result:d.result,proof,localSessionId:session,generation:epochId,bindingId:b.bindingId,syncSessionId:b.syncSessionId}));notice=null;emit();return 'STAGED';
  }
  function copyBinding(b){return copy(Object.fromEntries(bindingKeys.map(k=>[k,b[k]])));}
  function terminal(raw,session,epochId){
    if(!current(session,epochId))return 'OLD_SESSION';
    if(!exact(raw,['bindingId','syncSessionId','state'])||!['CANCELLED','EXPIRED','CLOSED'].includes(raw.state))return fail('INVALID_TERMINAL');
    const b=bindings.get(raw.bindingId);if(!b||b.syncSessionId!==raw.syncSessionId)return fail('INVALID_TERMINAL');
    b.state=raw.state;emit();return raw.state;
  }
  function endSession(){pendingRequest?.settle('STALE');generation++;localSessionId=null;bindings=new Map();records=new Map();selected=new Map();const stop=detach;detach=null;try{stop?.();}catch{}connection=closed?'DISPOSED':'INCOMPLETE_NATIVE';notice=null;emit();}
  return Object.freeze({
    startSession(session){endSession();if(closed||!identifier(session))return false;localSessionId=session;const epochId=generation;
      if(!adapter||typeof adapter.open!=='function'||typeof adapter.verifyAccepted!=='function'){connection='INCOMPLETE_NATIVE';emit();return false;}
      connection='ADAPTER_CONNECTED';
      try{const stop=adapter.open(Object.freeze({localSessionId:session,generation:epochId,onBinding:r=>onBinding(r,session,epochId),onAccepted:r=>onAccepted(r,session,epochId),onTerminal:r=>terminal(r,session,epochId),onUnavailable:reason=>{if(current(session,epochId)){notice=['SERVER_CLOCK_UNAVAILABLE','BINDING_DELIVERY_TIMEOUT'].includes(reason)?reason:null;for(const b of bindings.values())b.state='CLOSED';connection='UNAVAILABLE';emit();}}}));
        if(typeof stop!=='function')throw Error('Unsubscribe required');detach=stop;
      }catch{for(const b of bindings.values())b.state='CLOSED';connection='UNAVAILABLE';}emit();return connection==='ADAPTER_CONNECTED';
    },
    endSession,tick,
    /** Resolves, never rejects, with what was actually confirmed. ACCEPTED means Native took the request: no QR or server session is implied.
     * NOT_CONNECTED: nothing was sent. IN_FLIGHT: an earlier request is unanswered, so nothing was sent and it is left alone.
     * REJECTED: Native refused without a reason this page can name. FAILED: no usable answer. STALE: the session it belonged to has ended. */
    request(taskId){const t=targetForTask(taskId);if(!t||!localSessionId||connection!=='ADAPTER_CONNECTED'||typeof adapter?.requestTask!=='function'){fail('NATIVE_NOT_CONNECTED');return Promise.resolve('NOT_CONNECTED');}
      if(pendingRequest)return Promise.resolve('IN_FLIGHT');
      if(REQUEST_NOTICES.has(notice)){notice=null;emit();}
      const session=localSessionId,epochId=generation;
      return new Promise(resolve=>{
        const mine={settle(outcome){if(pendingRequest!==mine)return;pendingRequest=null;clearTimer(mine.timer);resolve(outcome);}};pendingRequest=mine;
        const answered=(outcome,code)=>{if(pendingRequest!==mine)return;if(!current(session,epochId)){mine.settle('STALE');return;}mine.settle(outcome);if(code)fail(code);};
        mine.timer=setTimer(()=>answered('FAILED','REQUEST_FAILED'),requestTimeoutMs);
        const refused=error=>answered(error?.nativeRejected===true?'REJECTED':'FAILED',error?.nativeRejected===true?'REQUEST_REJECTED':'REQUEST_FAILED');
        try{Promise.resolve(adapter.requestTask(copy({localSessionId:session,generation:epochId,taskId,partId:t.partId}))).then(reply=>{
          if(reply?.ok!==true){answered('FAILED','REQUEST_FAILED');return;}
          // The bridge also answers ok when it only reopens its panel for a request that may already have a session.
          answered([...bindings.values()].some(b=>b.taskId===taskId&&live(b))?'ACCEPTED_ACTIVE_BINDING':'ACCEPTED');
        },refused);}catch(error){refused(error);}
      });
    },
    select(taskId,inspectionId){tick();const t=targetForTask(taskId);if(!t||!localSessionId||closed)return false;
      if(inspectionId==='LOCAL'){selected.delete(taskId);emit();return true;}
      const r=records.get(inspectionId);if(!r||r.taskId!==taskId||r.localSessionId!==localSessionId||r.generation!==generation)return false;
      if(selected.get(taskId)===inspectionId)return true;
      if(!live(bindings.get(r.bindingId))){fail('INACTIVE_BINDING');return false;}
      selected.set(taskId,inspectionId);emit();return true;
    },
    get snapshot(){return copy({localSessionId,generation,connection,notice,records:[...records.values()],selected:Object.fromEntries(selected),bindings:[...bindings.values()].map(b=>({...copyBinding(b),state:live(b)?'ACTIVE':b.state==='ACTIVE'?'EXPIRED':b.state}))});},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    dispose(){closed=true;endSession();listeners.clear();}
  });
}
