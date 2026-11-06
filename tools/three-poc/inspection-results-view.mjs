import {projectInspectionResults,resultCounts} from './inspection-results.mjs';
import {stateBadgeHtml,recordTimeHtml} from './inspection-state-view.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const RESPONSE_LABELS={damage:'외관 손상',debris:'이물질',wear:'불균일 마모',flapDamage:'충전구 덮개 손상',visibleDamage:'충전구 외관 손상',levelMarking:'외부 액면·표시',leakTrace:'누출 의심 흔적',exteriorDamage:'저장통·캡 외관',caseDamage:'케이스 손상',visibleCorrosion:'보이는 부식',coverDamage:'덮개 손상',visibleContamination:'외부 젖음·오염',heatDamage:'변형·변색',bladeDamage:'고무 손상',visibleDebris:'이물질',armDamage:'암 외관',lensDamage:'렌즈 손상',obstruction:'가림',visibleMoisture:'보이는 물기'};
export const RESPONSE_ANSWERS={FOUND:'이상 징후 발견',NOT_FOUND:'발견하지 못함',UNABLE:'확인 불가'};
const connection={INCOMPLETE_NATIVE:'Native 전달 경로 미완료 · 실제 통합 미완료',ADAPTER_CONNECTED:'전달 어댑터 연결 · 실제 Native E2E 검증과 별개',UNAVAILABLE:'Native 전달 불가 · 새 결과 적용 중단',DISPOSED:'전달 종료'};
const errors={SERVER_CLOCK_UNAVAILABLE:'서버 시각 계약이 없어 3D 연결을 차단했습니다. Native 수락만으로 적용되지 않습니다.',BINDING_DELIVERY_TIMEOUT:'연결 정보 전달이 지연되어 3D 연결을 종료했습니다.',INVALID_BINDING:'점검 연결 정보를 검증하지 못했습니다.',BINDING_CONFLICT:'다른 점검 연결과 충돌해 새 연결을 거부했습니다.',INVALID_RESULT:'결과의 부품·응답·시각을 확인하지 못했습니다.',INACTIVE_BINDING:'연결이 만료되거나 종료되어 새 결과를 적용할 수 없습니다.',DIGEST_MISMATCH:'원본 결과와 수락 근거가 일치하지 않습니다.',VERIFICATION_FAILED:'Native 수락 검증에 실패했습니다.',INVALID_ACCEPTED_PROOF:'검증된 수락 근거를 확인하지 못했습니다.',RESULT_CONFLICT:'같은 점검 ID의 내용이 달라 새 결과를 거부했습니다.',INVALID_TERMINAL:'점검 연결의 종료 정보를 확인하지 못했습니다.',CAPACITY:'이 화면의 기록 한도에 도달했습니다. 새 점검 세션이 필요합니다.',NATIVE_NOT_CONNECTED:'Native 전달 경로가 없어 모바일 요청을 시작할 수 없습니다.',REQUEST_REJECTED:'점검 요청을 시작할 수 없습니다.',REQUEST_FAILED:'Native 연결을 확인하지 못했습니다.'};
const errorText=code=>errors[code]??'결과 전달 상태를 확인하지 못했습니다.';
// About asking for a request, not about a result: the sentences on result handling would not apply.
const REQUEST_NOTICES=new Set(['NATIVE_NOT_CONNECTED','REQUEST_REJECTED','REQUEST_FAILED']);
export function resultSummaryHtml(local,mobile){
  const rows=projectInspectionResults(local,mobile),counts=resultCounts(rows),pending=rows.reduce((n,r)=>n+r.candidates.filter(c=>c.inspectionId!==r.inspectionId).length,0);
  return `<section class="all-results" aria-label="17개 부품 점검 결과"><h3>17개 부품 점검 결과</h3>
    <p role="status">선택된 확정 기록 ${17-counts.NOT_INSPECTED}/17 · 미점검 ${counts.NOT_INSPECTED} · 이상 징후 ${counts.FINDINGS_REPORTED} · 확인 불가 ${counts.UNABLE} · 발견 사항 없음 ${counts.NO_FINDINGS_REPORTED}</p>
    ${mobile?.connection==='ADAPTER_CONNECTED'?'':`<p class="note">${esc(connection[mobile?.connection]??connection.INCOMPLETE_NATIVE)}</p>`}<p class="note">이전 모바일 기록 ${pending}건 · 가장 최근의 유효한 결과를 표시합니다. SDK 관측·QR 표시·미확정 응답은 점검 완료가 아닙니다.</p>
    ${mobile?.notice?`<p class="result-error" role="status">${errorText(mobile.notice)}${REQUEST_NOTICES.has(mobile.notice)?'':' 기존 표시 기록은 유지합니다.'}</p>`:''}
    <ul class="items result-list">${rows.map(r=>`<li><button type="button" class="item" data-action="result-detail" data-id="${r.partId}"><span>${esc(r.partLabel)}</span>${stateBadgeHtml(r)}<small>${r.origin==='MOBILE_RECEIVER'?'MOBILE / USER_REPORTED · 모바일 수신 기록':r.origin?'USER_REPORTED · 이 3D 화면 직접 입력':'확정 기록 없음'}${r.candidates.length?` · 모바일 ${r.candidates.length}건`:''}</small></button></li>`).join('')}</ul></section>`;
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
  const doc=root.ownerDocument,focused=doc.activeElement,scroll=root.scrollTop,part=root.querySelector('#mobilePartResults'),summary=root.querySelector('#allResults');
  const key=[part,summary].some(region=>region?.contains(focused))?focusSelector(focused):null;
  writeRegion(part,part?partResultHtml(local,mobile,partId):'');
  writeRegion(summary,summary?resultSummaryHtml(local,mobile):'');
  const rows=projectInspectionResults(local,mobile);
  for(const button of root.querySelectorAll('button.item[data-id]')){
    if(summary?.contains(button))continue;
    const row=rows.find(r=>r.partId===button.dataset.id),badge=button.querySelector('.inspection-state');
    if(row&&badge&&badge.dataset.inspectionState!==row.status)badge.outerHTML=stateBadgeHtml(row);
  }
  if(key&&!doc.contains(focused))root.querySelector(key)?.focus({preventScroll:true});
  root.scrollTop=scroll;
}
const SCHEMA_V1_STATUS={OK:'정상으로 보고',NEEDS_REFILL:'보충 필요로 보고',UNSURE:'확인 불가'};
const ACTIVE_RECEIVER=new Set(['AUTH_WAITING','AUTH_FAILED','CREATING','QR_READY','QR_EXPIRED','CONNECTED','RESULT_RECEIVED']);
const RECEIVER_TEXT={NOT_CONFIGURED:'이 기기에 모바일 점검 등록이 없습니다. 운영자 설정이 필요합니다.',AUTH_WAITING:'모바일 점검 권한을 확인하는 중입니다.',AUTH_FAILED:'모바일 점검 권한을 확인하지 못했습니다. 자동으로 다시 시도합니다.',CREATING:'QR을 만드는 중입니다.',QR_READY:'스마트폰 카메라로 QR을 스캔하세요.',QR_EXPIRED:'QR이 만료되었습니다. 취소한 뒤 다시 시작하세요.',CONNECTED:'스마트폰이 연결되었습니다. 점검 결과를 기다립니다.',RESULT_RECEIVED:'결과를 받았습니다. 무결성을 확인하는 중입니다.',COMPLETED:'모바일 결과를 받아 이 화면에 표시했습니다.',CANCELLED:'모바일 점검을 취소했습니다.',EXPIRED:'모바일 점검 시간이 만료되었습니다. 다시 시작하세요.',FAILED:'모바일 점검을 이어갈 수 없습니다. 다시 시작하세요.',CLOSED:'모바일 점검 연결이 종료되었습니다.'};
const FAILURE_TEXT={NETWORK:'네트워크 연결을 확인하세요.',TIMEOUT:'서버 응답이 지연되고 있습니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도하세요.',SERVER:'서버를 사용할 수 없습니다.',UNAUTHORIZED:'권한이 거부되었습니다.',INVALID:'응답 또는 결과를 검증하지 못했습니다.',CONFLICT:'이미 다른 결과가 제출되었습니다.',EXPIRED:'요청이 만료되었습니다.',CLOSED:'요청이 종료되었습니다.'};
const clockText=at=>{const d=new Date(at);return Number.isNaN(d.getTime())?'-':d.toLocaleTimeString('ko-KR');};
/** Status comes from Native. The slot is empty on purpose: Native draws the QR over it, so this page never has the code. */
function mobileFlowHtml(row,mobile){
  const r=mobile?.receiver??null,mine=r?.taskId===row.taskId,active=mine&&ACTIVE_RECEIVER.has(r.phase),other=!!r&&!mine&&ACTIVE_RECEIVER.has(r.phase);
  const failure=mine&&r.failure?` ${FAILURE_TEXT[r.failure]??''}`:'';
  return `<section class="mobile-flow"${mine?` data-mobile-phase="${r.phase}"`:''}>
    ${mine?`<p role="status">${RECEIVER_TEXT[r.phase]}${failure}</p>`:other?'<p role="status">다른 부품의 모바일 점검이 진행 중입니다. 그 점검을 취소하면 시작할 수 있습니다.</p>':''}
    ${mine&&r.phase==='QR_READY'?`<div id="mobileQrSlot" class="mobile-qr-slot" role="img" aria-label="모바일 점검 초대 QR 표시 영역"></div><p class="note">${r.inviteExpiresAt?`${clockText(r.inviteExpiresAt)}까지 스캔할 수 있습니다. `:''}QR을 다른 사람과 공유하지 마세요.</p>`:''}
    <div class="mobile-actions">${active||other?'':`<button type="button" class="secondary" data-action="request-mobile" data-task="${row.taskId}">모바일로 점검하기</button>`}
    ${(mine||other)&&r.retryAvailable?'<button type="button" class="secondary" data-action="mobile-refresh">다시 확인</button>':''}
    ${(mine||other)&&r.canCancel?'<button type="button" class="secondary" data-action="mobile-cancel">점검 요청 취소</button>':''}</div>
    ${mobile?.connection==='ADAPTER_CONNECTED'?'':'<p class="note">검증된 Native 전달 경로가 없는 현재 배포에서는 QR v2 요청·결과 수신을 시작할 수 없습니다.</p>'}</section>`;
}
export function partResultHtml(local,mobile,partId){
  const row=projectInspectionResults(local,mobile).find(r=>r.partId===partId);if(!row)return '';
  const current=row.inspectionId??'LOCAL',automatic=row.proof?.confirmation==='AVD_SIMULATION_AUTO';
  return `<section class="part-results" data-result-part="${partId}"><h3>이 부품의 사용자 점검 결과</h3>${stateBadgeHtml(row)}
    ${mobile?.notice?`<p class="result-error" role="status">${errorText(mobile.notice)}${REQUEST_NOTICES.has(mobile.notice)?'':' 새 결과를 완료로 적용하지 않았습니다.'}</p>`:''}
    <dl class="tire-status"><dt>출처</dt><dd>${row.source??'확정 기록 없음'}${row.confirmation?' / '+row.confirmation:''}</dd><dt>기록 경로</dt><dd>${row.origin==='MOBILE_RECEIVER'?(automatic?'AVD 시뮬레이션 자동 수신 · 차량 소유자 승인 아님':'검증된 Native 수락'):row.origin?'이 3D 화면 직접 입력':'선택된 결과 없음'}</dd><dt>점검 완료 시각</dt><dd>${recordTimeHtml(row.completedAt)}</dd>
    ${row.inspectionId?(row.schemaVersion===1?`<dt>사용자 보고</dt><dd>${esc(SCHEMA_V1_STATUS[row.original.status]??row.original.status)}</dd>`:row.responseKeys.map(k=>`<dt>${esc(RESPONSE_LABELS[k])}</dt><dd>${RESPONSE_ANSWERS[row.responses[k]]}</dd>`).join('')):''}</dl>
    ${mobileFlowHtml(row,mobile)}
    <p class="note">${row.local?'로컬 응답과 모바일 응답은 별도로 보존하며 수정·병합하지 않습니다.':'모바일 원문과 원본 시각을 보존합니다.'} 결과는 정상·안전·주행 가능 판정이 아닙니다.</p>
    ${row.local||row.candidates.length?`<details class="record-history"><summary>이전 기록</summary><fieldset class="record-picker"><legend>가장 최근의 유효한 모바일 결과를 표시합니다. 다른 기록을 볼 수 있습니다.</legend>
      <button type="button" class="secondary" data-action="select-result" data-task="${row.taskId}" data-record="LOCAL" aria-pressed="${current==='LOCAL'}" data-session="${esc(local.sessionId)}">${row.local?'로컬 타이어 기록':'모바일 기록 표시 해제 · 미점검'}${current==='LOCAL'?' · 표시 중':''}</button>
      ${row.candidates.map(c=>{const binding=mobile.bindings.find(b=>b.bindingId===c.bindingId),live=binding?.state==='ACTIVE',chosen=current===c.inspectionId;
        return `<button type="button" class="secondary" data-action="select-result" data-task="${row.taskId}" data-record="${c.inspectionId}" data-session="${esc(local.sessionId)}" aria-pressed="${chosen}" ${!live&&!chosen?'disabled':''}>MOBILE / USER_REPORTED · ${esc(c.result.completedAt)} · ${esc(c.inspectionId)}${chosen?' · 표시 중':live?'':' · 연결 종료/만료, 새 적용 불가'}${chosen&&!live?' · 전달 연결 종료/만료, 표시 중인 기록 보존':''}</button>`;}).join('')}</fieldset></details>`:''}
    <details class="debug-admin"><summary>Debug 관리</summary><p class="note">${esc(connection[mobile?.connection]??connection.INCOMPLETE_NATIVE)}</p>
      ${mobile?.connection==='ADAPTER_CONNECTED'?'<button type="button" class="secondary" data-action="mobile-admin">수신 관리 패널 열기</button><p class="note">서비스 연결 확인, 수동 세션 생성, 수동 수락은 이 패널에 있습니다.</p>':''}
      ${row.inspectionId?`<dl class="tire-status"><dt>inspectionId</dt><dd>${esc(row.inspectionId)}</dd><dt>taskId / partId</dt><dd>${esc(row.taskId)} / ${esc(row.partId)}</dd>${['confirmation','proofId','bindingId','syncSessionId','localSessionId','generation','receivedAt','acceptedAt'].map(k=>`<dt>${k}</dt><dd>${esc(row.proof[k])}</dd>`).join('')}<dt>digest</dt><dd>${esc(row.resultDigest)}</dd></dl><pre>${esc(JSON.stringify(row.original,null,2))}</pre>`:''}</details></section>`;
}
