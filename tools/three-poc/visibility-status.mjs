// Independent fixed Visibility UI v1; never appends rows to Component/Tire/Charge contracts.
import { ComponentStatusStore, ComponentStatusClient } from './component-status.mjs';
export const VISIBILITY_FEATURES = Object.freeze({ 'wiper.front.state': 'wiper.front', 'light.low-beam': 'light.low-beam', 'light.high-beam': 'light.high-beam' });
const caps=['UNVERIFIED','SUPPORTED','UNSUPPORTED','PERMISSION_DENIED','ERROR'];
const modes={ 'wiper.front.state':['OTHER','OFF','ON','SERVICE'], 'light.low-beam':['OFF','ON','DAYTIME_RUNNING'], 'light.high-beam':['OFF','ON','DAYTIME_RUNNING'] };
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export const visibilityBlank=()=>Object.entries(VISIBILITY_FEATURES).map(([featureId,vehiclePartId])=>({featureId,vehiclePartId,capabilityStatus:'UNVERIFIED',availabilityStatus:'UNVERIFIED',source:null,observedAt:null,value:null,unit:null}));
export function validateVisibilityStatus(p){
  if(!exact(p,['schemaVersion','sessionId','sequence','connectionStatus','sessionPhase','readings'])||p.schemaVersion!==1||typeof p.sessionId!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.sessionId)||!Number.isSafeInteger(p.sequence)||p.sequence<1||!['ATTACHED','STOPPED','SUPERSEDED'].includes(p.connectionStatus)||!['IDLE','ACTIVE','STOPPING','UNRESOLVED','CLOSED'].includes(p.sessionPhase)||!Array.isArray(p.readings)||p.readings.length!==3)throw Error('INVALID_VISIBILITY_ENVELOPE');
  const seen=new Set(),sources=new Set();
  const readings=p.readings.map(r=>{
    if(!exact(r,['featureId','vehiclePartId','capabilityStatus','availabilityStatus','source','observedAt','value','unit'])||!Object.hasOwn(VISIBILITY_FEATURES,r.featureId)||VISIBILITY_FEATURES[r.featureId]!==r.vehiclePartId||seen.has(r.featureId)||!caps.includes(r.capabilityStatus)||![...caps,'UNAVAILABLE','STALE'].includes(r.availabilityStatus)||![null,'PLEOS','MOCK'].includes(r.source)||r.unit!==null||!(r.observedAt===null||Number.isSafeInteger(r.observedAt)&&r.observedAt>=0&&r.observedAt<=8_640_000_000_000_000)||(r.value===null)!==(r.observedAt===null))throw Error('INVALID_VISIBILITY_ROW');
    if(r.value!==null? !modes[r.featureId].includes(r.value)||r.capabilityStatus!=='SUPPORTED'||!(r.featureId==='wiper.front.state'&&r.value==='OTHER'?['UNVERIFIED','STALE']:['SUPPORTED','STALE']).includes(r.availabilityStatus):['SUPPORTED','STALE'].includes(r.availabilityStatus))throw Error('INVALID_VISIBILITY_VALUE');
    if(p.connectionStatus==='ATTACHED'?r.source===null:r.source!==null||r.value!==null||r.capabilityStatus!=='UNVERIFIED'||r.availabilityStatus!=='UNVERIFIED')throw Error('INVALID_VISIBILITY_OWNER');
    seen.add(r.featureId);sources.add(r.source);return Object.freeze({...r});
  });
  if(sources.size!==1)throw Error('MIXED_VISIBILITY_SOURCE');return Object.freeze({...p,readings:Object.freeze(readings)});
}
export const visibilityStatus=new ComponentStatusStore(validateVisibilityStatus,visibilityBlank);
export const visibilityClient=new ComponentStatusClient(visibilityStatus,{endpoint:'./visibility-status.json'});
let unbind;
export function enableVisibilityStatus(){
  if(unbind)return;let active=true;
  const update=()=>active&&document.visibilityState!=='hidden'?visibilityClient.start():visibilityClient.stop();
  const start=()=>{visibilityClient.stop();active=true;update();},stop=()=>{active=false;update();};
  addEventListener('carscope-component-active',start);addEventListener('carscope-component-inactive',stop);document.addEventListener('visibilitychange',update);
  unbind=()=>{removeEventListener('carscope-component-active',start);removeEventListener('carscope-component-inactive',stop);document.removeEventListener('visibilitychange',update);};update();
}
export function disposeVisibilityStatus(){unbind?.();unbind=null;visibilityClient.stop();}
const labels={'wiper.front.state':'전면 유리 공통 작동 보고 · 좌우 독립 센서 아님','light.low-beam':'하향등 전역 보고 · 좌우 독립 센서 아님','light.high-beam':'상향등 전역 보고 · 좌우 독립 센서 아님'};
const hints={UNVERIFIED:'아직 확인되지 않은 보고입니다.',UNSUPPORTED:'이 기능의 읽기 지원이 없습니다.',PERMISSION_DENIED:'조회 권한이 허용되지 않았습니다.',ERROR:'조회 또는 연결 오류로 값을 표시할 수 없습니다.',UNAVAILABLE:'SDK 값을 받지 못했습니다.',STALE:'마지막 보고가 오래되었습니다. 현재 상태로 판단하지 마세요.',SUPPORTED:'SDK 보고값을 받았습니다. 실제 작동·안전 판정은 아닙니다.'};
export function visibilityStatusHtml(features){
  if(!features.every(f=>Object.hasOwn(VISIBILITY_FEATURES,f)))throw Error('UNKNOWN_VISIBILITY_FEATURE');
  return `<p class="note">SDK 작동 보고는 USER_REPORTED·형상 정확도와 별개입니다. 작동 성공·정상·안전·정비 판정이 아닙니다.</p>${visibilityStatus.state.readings.filter(r=>features.includes(r.featureId)).map(r=>`<section data-visibility-feature="${r.featureId}"><h3>${labels[r.featureId]}</h3><p role="status">${hints[r.availabilityStatus]}</p><dl class="tire-status"><dt>데이터 출처</dt><dd>${r.source??'없음 · 미연동'}</dd><dt>Capability</dt><dd>${r.capabilityStatus}</dd><dt>Availability</dt><dd>${r.availabilityStatus}</dd><dt>SDK 보고값</dt><dd>${r.value??'없음 · 미수신'}</dd><dt>앱 callback 수신 시각</dt><dd>${r.observedAt===null?'없음':new Date(r.observedAt).toISOString()}</dd></dl></section>`).join('')}<p class="note">앱 채널 ${visibilityStatus.state.connectionStatus} · 로컬 세션 ${visibilityStatus.state.sessionPhase} · 실제 기기 지원/종료는 별도 검증</p>`;
}
