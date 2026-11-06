// P9-H1: read provider for the Debug Android inspection page. A dedicated asset RPC, separate from
// /native-inspection-v1. Native holds the credential and makes the HTTPS request: nothing secret crosses this file.
// Returns null everywhere but the asset page, and the channel answers 404 in a build that does not compose it.
const ORIGIN='https://carscope-inspection.invalid';
const MAX_REPLY=262144;
const QUERY_KEYS=Object.freeze(['limit','cursor','taskId','partId','status','from','to']);

export function createNativeHistoryProvider(){
  if(globalThis.location?.origin!==ORIGIN||globalThis.location?.pathname!=='/index.html'||globalThis.self!==globalThis.top)return null;
  async function rpc(command,signal){
    const response=await fetch(`/native-history-v1?command=${encodeURIComponent(JSON.stringify(command))}`,{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'same-origin',signal});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))return {unavailable:'UNAVAILABLE'};
    const text=await response.text();
    if(text.length>MAX_REPLY)return {unavailable:'UNAVAILABLE'};
    return JSON.parse(text);
  }
  return Object.freeze({
    origin:'AVD_SIMULATOR_NATIVE',
    list({query,signal}){
      return rpc({op:'list',...Object.fromEntries(QUERY_KEYS.filter(k=>Object.hasOwn(query,k)).map(k=>[k,query[k]]))},signal);
    },
    detail({recordId,signal}){return rpc({op:'detail',recordId},signal);},
  });
}
