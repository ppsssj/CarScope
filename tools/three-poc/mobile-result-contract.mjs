// Frontend boundary contract. No network, Native bridge, credentials or mobile-code dependency.
const target=(taskId,partId,label,area,keys)=>Object.freeze({taskId,partId,label,area,schemaVersion:taskId==='washer-fluid'?1:2,responseKeys:Object.freeze(keys)});
export const MOBILE_TARGETS=Object.freeze([
  target('washer-fluid','washer-fluid-cap','워셔액','hood',[]),
  ...['front-left','front-right','rear-left','rear-right'].map((side,i)=>target('tire.'+side,'tire.'+side,['앞 왼쪽 타이어','앞 오른쪽 타이어','뒤 왼쪽 타이어','뒤 오른쪽 타이어'][i],'tires',['damage','debris','wear'])),
  target('ev-charge.port','ev-charge.port','EV 충전구','ev-charge',['flapDamage','debris','visibleDamage']),
  target('brake-fluid','brake-fluid-reservoir','브레이크액','hood',['levelMarking','leakTrace','exteriorDamage']),
  target('coolant-reservoir','coolant-reservoir','냉각수 리저버','hood',['levelMarking','leakTrace','exteriorDamage']),
  target('lcw-coolant-reservoir','lcw-coolant-reservoir','저전도 냉각수 리저버','hood',['levelMarking','leakTrace','exteriorDamage']),
  target('battery-12v','battery-12v','12V 보조 배터리','hood',['caseDamage','leakTrace','visibleCorrosion']),
  target('fuse-box','fuse-box','모터룸 퓨즈박스','hood',['coverDamage','visibleContamination','heatDamage']),
  ...['left','right'].map(side=>target('wiper.front.'+side,'wiper.front.'+side,`전면 ${side==='left'?'왼쪽':'오른쪽'} 와이퍼`,'wipers',['bladeDamage','visibleDebris','armDamage'])),
  ...['low','high'].flatMap(beam=>['left','right'].map(side=>{const id=`light-${beam}-beam-${side}-0`;return target(id,id,`${side==='left'?'왼쪽':'오른쪽'} ${beam==='low'?'하향등':'상향등'}`,'lights',['lensDamage','obstruction','visibleMoisture']);})),
]);
export const targetForTask=id=>MOBILE_TARGETS.find(t=>t.taskId===id);
export const targetForPart=id=>MOBILE_TARGETS.find(t=>t.partId===id);
export const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export const epoch=t=>Number.isSafeInteger(t)&&t>=0&&t<=8640000000000000;
export const identifier=s=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(s);
export const digestShape=s=>typeof s==='string'&&/^sha256:[0-9a-f]{64}$/.test(s);
function timestamp(s,version,allowPreEpoch=false){
  if(typeof s!=='string'||!(version===1?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(s))return false;
  const at=Date.parse(s);return (allowPreEpoch?Number.isSafeInteger(at):epoch(at))&&new Date(at).toISOString()===(s.length===20?s.replace('Z','.000Z'):s);
}
// allowPreEpoch is only for stored history, whose contract preserves a valid pre-epoch user time.
export function validateMobileResult(r,{allowPreEpoch=false}={}){
  const t=targetForTask(r?.taskId);if(!t)return false;
  if(!exact(r,['schemaVersion','inspectionId','taskId','method','source','state','startedAt','aids',...(t.schemaVersion===2?['responses']:[]),'status','confirmation','completedAt','sync']))return false;
  if(r.schemaVersion!==t.schemaVersion||typeof r.inspectionId!=='string'||!/[a-f0-9]/.test(r.inspectionId)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).test(r.inspectionId))return false;
  if(r.method!=='SELF'||r.source!=='MOBILE'||r.state!=='COMPLETED'||r.confirmation!=='USER_REPORTED'||r.sync!=='NOT_SENT')return false;
  if(!timestamp(r.startedAt,t.schemaVersion,allowPreEpoch)||!timestamp(r.completedAt,t.schemaVersion,allowPreEpoch)||Date.parse(r.startedAt)>Date.parse(r.completedAt))return false;
  if(!exact(r.aids,['cameraUsed','locationMarked'])||Object.values(r.aids).some(v=>typeof v!=='boolean'))return false;
  if(t.schemaVersion===1)return ['OK','NEEDS_REFILL','UNSURE'].includes(r.status);
  if(!exact(r.responses,t.responseKeys)||Object.values(r.responses).some(v=>typeof v!=='string'||!['FOUND','NOT_FOUND','UNABLE'].includes(v)))return false;
  const values=Object.values(r.responses),status=values.includes('FOUND')?'REVIEW_NEEDED':values.includes('UNABLE')?'UNABLE':'NO_FINDINGS_REPORTED';
  return r.status===status;
}
export const canonicalResult=value=>Array.isArray(value)?`[${value.map(canonicalResult).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalResult(value[k])).join(',')}}`:JSON.stringify(value);
export async function digestResult(result){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalResult(result)));
  return 'sha256:'+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
export const mobileReportState=r=>r.schemaVersion===1?({OK:'NO_FINDINGS_REPORTED',NEEDS_REFILL:'FINDINGS_REPORTED',UNSURE:'UNABLE'})[r.status]:r.status==='REVIEW_NEEDED'?'FINDINGS_REPORTED':r.status;
