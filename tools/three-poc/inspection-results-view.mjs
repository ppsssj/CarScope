import {projectInspectionResults} from './inspection-results.mjs';
import {stateBadgeHtml,recordTimeHtml,progressHtml} from './inspection-state-view.mjs';
import {sourceText,summaryHtml as tireSummaryHtml} from './tire-inspection-view.mjs';
import {INSPECTION_AREAS} from './inspection-flow.mjs';
import {partById} from './inspection-parts.mjs';
// P11 (PR #121): the same capability table the phone reads. The vehicle never knows the phone's server, so it states support only.
import {partCapabilities,partMethodSummary} from '../mobile-ar-poc/public/part-capabilities.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const RESPONSE_LABELS={damage:'외관 손상',debris:'이물질',wear:'불균일 마모',flapDamage:'충전구 덮개 손상',visibleDamage:'충전구 외관 손상',levelMarking:'외부 액면·표시',leakTrace:'누출 의심 흔적',exteriorDamage:'저장통·캡 외관',caseDamage:'케이스 손상',visibleCorrosion:'보이는 부식',coverDamage:'덮개 손상',visibleContamination:'외부 젖음·오염',heatDamage:'변형·변색',bladeDamage:'고무 손상',visibleDebris:'이물질',armDamage:'암 외관',lensDamage:'렌즈 손상',obstruction:'가림',visibleMoisture:'보이는 물기'};
export const RESPONSE_ANSWERS={FOUND:'이상 징후 발견',NOT_FOUND:'발견하지 못함',UNABLE:'확인 불가'};
// Developer wording of the delivery path. Shown only inside the collapsed developer details.
const connection={INCOMPLETE_NATIVE:'Native 전달 경로 미완료 · 실제 통합 미완료',ADAPTER_CONNECTED:'전달 어댑터 연결 · 실제 Native E2E 검증과 별개',UNAVAILABLE:'Native 전달 불가 · 새 결과 적용 중단',DISPOSED:'전달 종료'};
// What a driver reads. The code itself stays in the developer details.
const errors={SERVER_CLOCK_UNAVAILABLE:'시각을 확인할 수 없어 스마트폰 점검 연결을 막았습니다.',BINDING_DELIVERY_TIMEOUT:'연결 정보가 늦게 도착해 스마트폰 점검 연결을 끝냈습니다.',INVALID_BINDING:'스마트폰 점검 연결 정보를 확인하지 못했습니다.',BINDING_CONFLICT:'다른 스마트폰 점검과 겹쳐 새 연결을 받지 않았습니다.',INVALID_RESULT:'받은 결과의 부품·응답·시각을 확인하지 못했습니다.',INACTIVE_BINDING:'연결이 끝났거나 만료되어 새 결과를 적용할 수 없습니다.',DIGEST_MISMATCH:'받은 결과가 원본과 일치하지 않아 적용하지 않았습니다.',VERIFICATION_FAILED:'받은 결과를 검증하지 못했습니다.',INVALID_ACCEPTED_PROOF:'받은 결과의 확인 정보를 검증하지 못했습니다.',RESULT_CONFLICT:'같은 점검의 내용이 서로 달라 새 결과를 받지 않았습니다.',INVALID_TERMINAL:'스마트폰 점검의 종료 정보를 확인하지 못했습니다.',CAPACITY:'이 화면에서 받을 수 있는 결과 수를 넘었습니다. 점검을 종료한 뒤 다시 시작하세요.',NATIVE_NOT_CONNECTED:'이 기기에서는 스마트폰 점검을 시작할 수 없습니다.',REQUEST_REJECTED:'점검 요청을 시작할 수 없습니다.',REQUEST_FAILED:'차량 앱과의 연결을 확인하지 못했습니다.'};
const errorText=code=>errors[code]??'결과 전달 상태를 확인하지 못했습니다.';
// About asking for a request, not about a result: the sentences on result handling would not apply.
const REQUEST_NOTICES=new Set(['NATIVE_NOT_CONNECTED','REQUEST_REJECTED','REQUEST_FAILED']);
const devInfo=(body,cls='')=>`<details class="dev-info${cls?' '+cls:''}"><summary>개발자 정보</summary>${body}</details>`;
const SUMMARY_AREAS=INSPECTION_AREAS.map(a=>({id:a.id,label:a.label.split(' · ')[0]}));
/** Results of one area for its card on the overview, from the same projection. Empty when the area has no result part. */
export function areaResultText(rows,areaId){const own=rows.filter(r=>r.area===areaId);return own.length?`결과 ${own.filter(r=>r.status!=='NOT_INSPECTED').length}/${own.length}`:'';}

/** P10 PR #2 summary: progress of the 17 result parts, then every part grouped by area. One projection, no other count. */
export function resultSummaryHtml(local,mobile){
  const rows=projectInspectionResults(local,mobile),pending=rows.reduce((n,r)=>n+r.candidates.filter(c=>c.inspectionId!==r.inspectionId).length,0);
  const row=r=>`<li><button type="button" class="item result-row" data-action="result-detail" data-id="${r.partId}"><span class="row-name">${esc(r.partLabel)}</span>${stateBadgeHtml(r)}${r.origin||r.draft||r.candidates.length>1?`<small>${[sourceText(r),r.draft?'직접 입력 응답 중 · 확정 전':'',r.candidates.length>1?`스마트폰 결과 ${r.candidates.length}건`:''].filter(Boolean).join(' · ')}</small>`:''}<span class="row-go" aria-hidden="true">›</span></button></li>`;
  const groups=SUMMARY_AREAS.map(a=>({...a,rows:rows.filter(r=>r.area===a.id)})).filter(g=>g.rows.length);
  return `<section class="all-results" aria-label="부품별 점검 결과">${progressHtml(rows)}
    ${mobile?.notice?`<p class="result-error" role="status">${errorText(mobile.notice)}${REQUEST_NOTICES.has(mobile.notice)?'':' 기존 표시 기록은 유지합니다.'}</p>`:''}
    <p class="note">응답을 확정했거나 스마트폰에서 받은 결과만 점검 완료로 셉니다. 안내를 보거나 QR을 띄운 것은 완료가 아닙니다.</p>
    ${groups.map(g=>`<h3 class="result-group">${esc(g.label)} <small>${g.rows.filter(r=>r.status!=='NOT_INSPECTED').length}/${g.rows.length}</small></h3><ul class="items result-list">${g.rows.map(row).join('')}</ul>`).join('')}
    ${devInfo(`<p class="note">${esc(connection[mobile?.connection]??connection.INCOMPLETE_NATIVE)}</p><p class="note">선택되지 않은 모바일 기록 ${pending}건. 출처 코드: 직접 입력 USER_REPORTED, 스마트폰 MOBILE / USER_REPORTED.${mobile?.notice?` 알림 코드 ${esc(mobile.notice)}.`:''}</p>`)}</section>`;
}
// Keeps a control's identity across a rewrite of the region that holds it.
const focusSelector=el=>{const d=el?.dataset;if(!d?.action)return null;const attr=(name,value)=>value===undefined?'':`[data-${name}="${CSS.escape(value)}"]`;return `[data-action="${CSS.escape(d.action)}"]${attr('task',d.task)}${attr('record',d.record)}${attr('id',d.id)}`;};
const written=new WeakMap();
function writeRegion(region,html){
  if(!region||written.get(region)===html)return;
  const open=[...region.querySelectorAll('details')].map(d=>d.open);
  region.innerHTML=html;written.set(region,html);
  const now=region.querySelectorAll('details');if(now.length===open.length)now.forEach((d,i)=>{d.open=open[i];});
}
/** The only place the session's result surfaces are redrawn, for both local and mobile changes, from one projection.
 * Touches these regions only: never the camera, the selection or the rest of the panel. */
export function refreshResultRegions(root,{local,mobile,partId}){
  const doc=root.ownerDocument,focused=doc.activeElement,scroll=root.scrollTop,part=root.querySelector('#mobilePartResults'),action=root.querySelector('#mobilePartAction'),summary=root.querySelector('#allResults'),progress=root.querySelector('#sessionProgress'),tires=root.querySelector('#tireSummary');
  const key=[part,action,summary,progress,tires].some(region=>region?.contains(focused))?focusSelector(focused):null;
  writeRegion(part,part?partResultHtml(local,mobile,partId):'');
  writeRegion(action,action?partActionHtml(local,mobile,partId):'');
  writeRegion(summary,summary?resultSummaryHtml(local,mobile):'');
  writeRegion(tires,tires?tireSummaryHtml(local,mobile):'');
  const rows=projectInspectionResults(local,mobile);
  writeRegion(progress,progress?progressHtml(rows,{compact:true}):'');
  for(const tag of root.querySelectorAll('[data-area-results]')){const text=areaResultText(rows,tag.dataset.areaResults);if(tag.textContent!==text)tag.textContent=text;}
  for(const button of root.querySelectorAll('button.item[data-id]')){
    if(summary?.contains(button))continue;
    const row=rows.find(r=>r.partId===button.dataset.id),badge=button.querySelector('.inspection-state');
    if(row&&badge&&badge.dataset.inspectionState!==row.status)badge.outerHTML=stateBadgeHtml(row);
  }
  if(key&&!doc.contains(focused))root.querySelector(key)?.focus({preventScroll:true});
  root.scrollTop=scroll;
}
/** What a part supports on the phone, for this screen: from part-capabilities.mjs with no host, so never "available". */
export function vehiclePartCapabilities(partId){const p=partById(partId);return partCapabilities(partId,{taskId:p?.taskId??null});}
export function partMethodsHtml(partId){const cap=vehiclePartCapabilities(partId);return `<p class="note part-methods" data-ai-plan="${cap.partPlan}">${esc(partMethodSummary(cap))}</p>`;}
/** A short tag for a part list row: only parts with an AI method get one, so the absence reads plainly. */
// P13-G: a DRAFT part gets no tag. It is offered only by an approved experiment service, so a tag here would advertise it.
export function aiTagHtml(partId){const cap=vehiclePartCapabilities(partId);return cap.stage==='EXPERIMENTAL'?`<span class="tag ai-tag" data-ai-plan="${cap.partPlan}">AI 실험</span>`:'';}
const SCHEMA_V1_STATUS={OK:'정상으로 보고',NEEDS_REFILL:'보충 필요로 보고',UNSURE:'확인 불가'};
const ACTIVE_RECEIVER=new Set(['AUTH_WAITING','AUTH_FAILED','CREATING','QR_READY','QR_EXPIRED','CONNECTED','RESULT_RECEIVED','AWAITING_CONFIRMATION']);
export const receiverActive=receiver=>!!receiver&&ACTIVE_RECEIVER.has(receiver.phase);
const RECEIVER_TEXT={NOT_CONFIGURED:'이 기기에 스마트폰 점검 등록이 없습니다. 운영자 설정이 필요합니다.',AUTH_WAITING:'스마트폰 점검 권한을 확인하는 중입니다.',AUTH_FAILED:'스마트폰 점검 권한을 확인하지 못했습니다. 자동으로 다시 시도합니다.',CREATING:'QR을 만드는 중입니다.',QR_READY:'스마트폰 카메라로 QR을 스캔하세요.',QR_EXPIRED:'QR이 만료되었습니다. 취소한 뒤 다시 시작하세요.',CONNECTED:'스마트폰 점검 진행 중',RESULT_RECEIVED:'결과 수신 중',AWAITING_CONFIRMATION:'결과를 받았습니다. 차량의 수신 관리 패널에서 수락해야 반영됩니다.',COMPLETED:'결과 수신 중',CANCELLED:'스마트폰 점검을 취소했습니다.',EXPIRED:'스마트폰 점검 시간이 만료되었습니다. 다시 시작하세요.',FAILED:'스마트폰 점검을 이어갈 수 없습니다. 다시 시작하세요.',CLOSED:'스마트폰 점검 연결이 종료되었습니다.'};
const FAILURE_TEXT={NETWORK:'네트워크 연결을 확인하세요.',TIMEOUT:'서버 응답이 지연되고 있습니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도하세요.',SERVER:'서버를 사용할 수 없습니다.',UNAUTHORIZED:'권한이 거부되었습니다.',INVALID:'응답 또는 결과를 검증하지 못했습니다.',CONFLICT:'이미 다른 결과가 제출되었습니다.',EXPIRED:'요청이 만료되었습니다.',CLOSED:'요청이 종료되었습니다.'};
const APPLIED_TEXT='점검 결과가 반영되었습니다',NOT_APPLIED_TEXT='결과를 반영하지 못했습니다 · 다시 확인';
/** What the driver reads for the phone check of this part. A server ACCEPTED is not shown as applied until this page has
 * staged the verified result of that session; a closed binding, a lost channel or a refused result reads as not applied. */
export function receiverText(r,mobile){
  if(r.phase==='RESULT_RECEIVED'&&r.retryAvailable)return NOT_APPLIED_TEXT;
  if(r.phase!=='COMPLETED')return RECEIVER_TEXT[r.phase];
  const binding=(mobile?.bindings??[]).filter(b=>b.taskId===r.taskId).at(-1);
  if(binding&&(mobile.records??[]).some(rec=>rec.bindingId===binding.bindingId))return APPLIED_TEXT;
  const refused=mobile?.notice&&!REQUEST_NOTICES.has(mobile.notice);
  return !binding||binding.state!=='ACTIVE'||mobile.connection!=='ADAPTER_CONNECTED'||refused?NOT_APPLIED_TEXT:RECEIVER_TEXT.COMPLETED;
}
const clockText=at=>{const d=new Date(at);return Number.isNaN(d.getTime())?'-':d.toLocaleTimeString('ko-KR');};
const rowFor=(local,mobile,partId)=>projectInspectionResults(local,mobile).find(r=>r.partId===partId);

/** Current result of one part: status, how and when it was reported, the answers, and the other records to choose from. */
export function partResultHtml(local,mobile,partId){
  const row=rowFor(local,mobile,partId);if(!row)return '';
  const current=row.inspectionId??'LOCAL',automatic=row.proof?.confirmation==='AVD_SIMULATION_AUTO';
  const answers=!row.origin?'':row.inspectionId&&row.schemaVersion===1?`<dl class="tire-status"><dt>사용자 보고</dt><dd>${esc(SCHEMA_V1_STATUS[row.original.status]??row.original.status)}</dd></dl>`
    :`<dl class="tire-status">${row.responseKeys.filter(k=>row.responses[k]).map(k=>`<dt>${esc(RESPONSE_LABELS[k])}</dt><dd>${RESPONSE_ANSWERS[row.responses[k]]}</dd>`).join('')}</dl>`;
  return `<section class="part-results" data-result-part="${partId}"><h3>현재 점검 결과</h3>
    <div class="result-head">${stateBadgeHtml(row)}${row.origin?`<span class="result-meta">${sourceText(row)} · ${recordTimeHtml(row.completedAt)}</span>`:'<span class="result-meta">아직 결과가 없습니다</span>'}</div>
    ${automatic?'<p class="note">AVD 시뮬레이션 자동 수신 · 차량 소유자 승인 아님</p>':''}${row.draft?'<p class="note">직접 입력 응답 중입니다. 확정하기 전에는 결과로 표시하지 않습니다.</p>':''}
    ${mobile?.notice?`<p class="result-error" role="status">${errorText(mobile.notice)}${REQUEST_NOTICES.has(mobile.notice)?'':' 새 결과를 완료로 적용하지 않았습니다.'}</p>`:''}
    ${answers}${row.origin?'<p class="note">사용자가 보고한 내용이며 차량의 정상·안전·주행 가능 판정이 아닙니다.</p>':''}
    ${row.local||row.candidates.length?`<details class="record-history"><summary>다른 기록 보기</summary><fieldset class="record-picker"><legend>직접 입력과 스마트폰 결과는 따로 보관되며 합쳐지지 않습니다. 가장 최근의 유효한 스마트폰 결과를 먼저 보여 줍니다.</legend>
      <button type="button" class="secondary" data-action="select-result" data-task="${row.taskId}" data-record="LOCAL" aria-pressed="${current==='LOCAL'}" data-session="${esc(local.sessionId)}">${row.local?'직접 입력 기록':'스마트폰 결과 표시 안 함 · 미점검'}${current==='LOCAL'?' · 표시 중':''}</button>
      ${row.candidates.map(c=>{const binding=mobile.bindings.find(b=>b.bindingId===c.bindingId),live=binding?.state==='ACTIVE',chosen=current===c.inspectionId;
        return `<button type="button" class="secondary" data-action="select-result" data-task="${row.taskId}" data-record="${c.inspectionId}" data-session="${esc(local.sessionId)}" aria-pressed="${chosen}" ${!live&&!chosen?'disabled':''}>스마트폰 결과 · ${recordTimeHtml(c.result.completedAt)}${chosen?' · 표시 중':live?'':' · 연결이 끝나 새로 고를 수 없음'}</button>`;}).join('')}</fieldset></details>`:''}</section>`;
}
/** Where Native draws the QR over #mobileQrSlot. One coordinate system: CSS px of this page's layout viewport, from
 * getBoundingClientRect, plus that viewport's own size (vw, vh). Native converts once, by its WebView's measured width / vw,
 * so neither side assumes a device pixel ratio. SHOWN only while the whole square slot is inside the settled panel and the
 * viewport; a panel still sliding, a pinch zoom or a clipped slot is HIDDEN, and no slot at all is NONE. */
export const QR_SLOT_NONE=Object.freeze({slot:'NONE',x:0,y:0,size:0,vw:0,vh:0});
const QR_SLOT_HIDDEN=Object.freeze({...QR_SLOT_NONE,slot:'HIDDEN'});
export function qrSlotReport(slot,panel,{width,height,scale=1,moving=false}={}){
  if(!slot)return QR_SLOT_NONE;
  const within=(r,b)=>r.left>=b.left-0.5&&r.top>=b.top-0.5&&r.right<=b.right+0.5&&r.bottom<=b.bottom+0.5;
  if(moving||!panel||Math.abs(scale-1)>0.01||!(width>0&&height>0)||!(slot.width>0)||Math.abs(slot.width-slot.height)>1)return QR_SLOT_HIDDEN;
  if(!within(slot,panel)||!within(slot,{left:0,top:0,right:width,bottom:height}))return QR_SLOT_HIDDEN;
  return Object.freeze({slot:'SHOWN',x:Math.round(slot.left),y:Math.round(slot.top),size:Math.round(slot.width),vw:Math.round(width),vh:Math.round(height)});
}
/** The main action of a part: the phone inspection. Status comes from Native. The QR slot is empty on purpose: Native
 * draws the QR over it, so this page never has the code. Developer details stay collapsed below it. */
export function partActionHtml(local,mobile,partId){
  const row=rowFor(local,mobile,partId);if(!row)return '';
  const r=mobile?.receiver??null,mine=r?.taskId===row.taskId,active=mine&&ACTIVE_RECEIVER.has(r.phase),other=!!r&&!mine&&ACTIVE_RECEIVER.has(r.phase);
  const connected=mobile?.connection==='ADAPTER_CONNECTED',failure=mine&&r.failure?` ${FAILURE_TEXT[r.failure]??''}`:'';
  const raw=row.inspectionId?`<dl class="tire-status"><dt>inspectionId</dt><dd>${esc(row.inspectionId)}</dd><dt>taskId / partId</dt><dd>${esc(row.taskId)} / ${esc(row.partId)}</dd>${['confirmation','proofId','bindingId','syncSessionId','localSessionId','generation','receivedAt','acceptedAt'].map(k=>`<dt>${k}</dt><dd>${esc(row.proof[k])}</dd>`).join('')}<dt>digest</dt><dd>${esc(row.resultDigest)}</dd></dl><pre>${esc(JSON.stringify(row.original,null,2))}</pre>`:'';
  return `<section class="mobile-flow"${mine?` data-mobile-phase="${r.phase}"`:''}><h3>스마트폰으로 점검</h3>
    ${mine?`<p role="status">${receiverText(r,mobile)}${failure}</p>`:other?'<p role="status">다른 부품의 스마트폰 점검이 진행 중입니다. 그 점검을 취소하면 시작할 수 있습니다.</p>':`<p class="note">스마트폰에서 안내를 보며 점검하고, 결과를 이 화면으로 보냅니다.</p>${partMethodsHtml(partId)}`}
    ${mine&&r.phase==='QR_READY'?`<div id="mobileQrSlot" class="mobile-qr-slot" role="img" aria-label="스마트폰 점검 초대 QR 표시 영역"></div><p class="note">${r.inviteExpiresAt?`${clockText(r.inviteExpiresAt)}까지 스캔할 수 있습니다. `:''}QR을 다른 사람과 공유하지 마세요.</p>`:''}
    <div class="mobile-actions">${active||other?'':`<button type="button" class="primary" data-action="request-mobile" data-task="${row.taskId}"${connected?'':' disabled'}>스마트폰으로 점검하기</button>`}
    ${(mine||other)&&r.retryAvailable?'<button type="button" class="secondary" data-action="mobile-refresh">다시 확인</button>':''}
    ${(mine||other)&&r.canCancel?'<button type="button" class="secondary" data-action="mobile-cancel">점검 요청 취소</button>':''}</div>
    ${connected||active||other?'':'<p class="note">이 기기에서는 스마트폰 점검을 연결할 수 없습니다. 차량 앱에서 열면 사용할 수 있습니다.</p>'}</section>
    ${devInfo(`<p class="note">${esc(connection[mobile?.connection]??connection.INCOMPLETE_NATIVE)}${mobile?.notice?` · 알림 코드 ${esc(mobile.notice)}`:''}</p>
      <dl class="tire-status"><dt>출처 코드</dt><dd>${row.source?esc(row.source)+(row.confirmation?' / '+esc(row.confirmation):''):'확정 기록 없음'}</dd><dt>원본 완료 시각</dt><dd>${row.completedAt===null?'없음':esc(typeof row.completedAt==='string'?row.completedAt:new Date(row.completedAt).toISOString())}</dd></dl>
      ${connected?'<button type="button" class="secondary" data-action="mobile-admin">수신 관리 패널 열기</button><p class="note">서비스 연결 확인, 수동 세션 생성, 수동 수락은 이 패널에 있습니다.</p>':''}${raw}`,'debug-admin')}`;
}
