// SYNTHETIC TEST/PREVIEW ONLY: every record below is invented, and the UI labels it 데모 데이터. Lives under
// test/, is never imported by production code and is never packaged. It is not a History API client and holds no credential.
import {MOBILE_TARGETS,digestResult} from '../mobile-result-contract.mjs';

const pad=(n,len)=>String(n).padStart(len,'0');
const uuid=(group,i)=>`${pad(i.toString(16),8)}-${group}-4000-8000-000000000000`;
const BASE=Date.UTC(2026,9,20,1,2,3);
const V2_ANSWERS=[['FOUND','NOT_FOUND','NOT_FOUND'],['NOT_FOUND','UNABLE','NOT_FOUND'],['NOT_FOUND','NOT_FOUND','NOT_FOUND']];
const V1_STATUSES=['OK','NEEDS_REFILL','UNSURE'];

export function demoOriginal(target,i,completedAt){
  const common={inspectionId:uuid('2222',i),taskId:target.taskId,method:'SELF',source:'MOBILE',state:'COMPLETED',startedAt:new Date(completedAt-60000).toISOString(),aids:{cameraUsed:false,locationMarked:false},confirmation:'USER_REPORTED',completedAt:new Date(completedAt).toISOString(),sync:'NOT_SENT'};
  if(target.schemaVersion===1)return {schemaVersion:1,...common,status:V1_STATUSES[i%3]};
  const answers=V2_ANSWERS[i%3],responses=Object.fromEntries(target.responseKeys.map((k,n)=>[k,answers[n]]));
  const status=answers.includes('FOUND')?'REVIEW_NEEDED':answers.includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED';
  return {schemaVersion:2,...common,responses,status};
}
/** Rows in the shape HistoryService reads from its store; DTO fields are generated from them. */
export async function demoRows(count=45){
  const rows=[];
  for(let i=1;i<=count;i++){
    const target=MOBILE_TARGETS[(i-1)%17],completedAt=BASE-i*3600000,originalResult=demoOriginal(target,i,completedAt);
    rows.push({recordId:uuid('1111',i),inspectionId:originalResult.inspectionId,taskId:target.taskId,partId:target.partId,schemaVersion:target.schemaVersion,inspectionStatus:originalResult.status,resultDigest:await digestResult(originalResult),completedAt,receivedAt:completedAt+1000,acceptedAt:completedAt+2000,createdAt:completedAt+2001,authorityNamespace:'VERIFIED_VEHICLE',originalResult});
  }
  return rows;
}
const dto=(r,detail=false)=>{const {originalResult,...fields}=r;return {...fields,source:'USER_REPORTED',method:'SELF',channel:'MOBILE',ownershipEvidence:'SESSION_CREATION_BINDING',sdkDataIncluded:false,...(detail?{responses:originalResult.responses??{},originalResult}:{})};};
const filterKey=q=>[q.taskId,q.partId,q.status,q.from,q.to].join('|');
const encode=text=>btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=text=>atob(text.replace(/-/g,'+').replace(/_/g,'/'));

export const demoControl={next:[],delayMs:0,calls:[],rows:null};
/** Queue a raw reply (or a thrown error) for the next provider call. */
export const demoQueue=(...replies)=>{demoControl.next.push(...replies);};
const serve=async fn=>{
  if(demoControl.delayMs)await new Promise(r=>setTimeout(r,demoControl.delayMs));
  const forced=demoControl.next.shift();
  if(forced instanceof Error)throw forced;
  return forced??fn();
};
export const demoHistoryProvider=Object.freeze({
  origin:'DEMO',
  async list({query}){
    demoControl.calls.push({op:'list',query});demoControl.rows??=await demoRows();
    return serve(()=>{
      const limit=Number(query.limit);let rows=demoControl.rows.filter(r=>(!query.taskId||r.taskId===query.taskId)&&(!query.partId||r.partId===query.partId)&&(!query.status||r.inspectionStatus===query.status)&&(!query.from||r.completedAt>=Date.parse(query.from))&&(!query.to||r.completedAt<Date.parse(query.to)));
      let start=0;
      if(query.cursor){const [key,at]=decode(query.cursor).split('#');if(key!==encode(filterKey(query)))return {status:400,body:{error:{code:'BAD_REQUEST'}}};start=Number(at);}
      rows=rows.slice(start);const hasMore=rows.length>limit,visible=rows.slice(0,limit);
      return {status:200,body:{schemaVersion:1,items:visible.map(r=>dto(r)),page:{limit,hasMore,nextCursor:hasMore?encode(`${encode(filterKey(query))}#${start+limit}`):null}}};
    });
  },
  async detail({recordId}){
    demoControl.calls.push({op:'detail',recordId});demoControl.rows??=await demoRows();
    return serve(()=>{const r=demoControl.rows.find(x=>x.recordId===recordId);return r?{status:200,body:{schemaVersion:1,record:dto(r,true)}}:{status:404,body:{error:{code:'NOT_FOUND'}}};});
  },
});
