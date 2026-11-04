import {projectInspectionResults,resultCounts} from './inspection-results.mjs';
import {stateBadgeHtml,recordTimeHtml} from './inspection-state-view.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const RESPONSE_LABELS={damage:'외관 손상',debris:'이물질',wear:'불균일 마모',flapDamage:'충전구 덮개 손상',visibleDamage:'충전구 외관 손상',levelMarking:'외부 액면·표시',leakTrace:'누출 의심 흔적',exteriorDamage:'저장통·캡 외관',caseDamage:'케이스 손상',visibleCorrosion:'보이는 부식',coverDamage:'덮개 손상',visibleContamination:'외부 젖음·오염',heatDamage:'변형·변색',bladeDamage:'고무 손상',visibleDebris:'이물질',armDamage:'암 외관',lensDamage:'렌즈 손상',obstruction:'가림',visibleMoisture:'보이는 물기'};
export const RESPONSE_ANSWERS={FOUND:'이상 징후 발견',NOT_FOUND:'발견하지 못함',UNABLE:'확인 불가'};
const connection={INCOMPLETE_NATIVE:'Native 전달 경로 미완료 · 실제 통합 미완료',ADAPTER_CONNECTED:'전달 어댑터 연결 · 실제 Native E2E 검증과 별개',UNAVAILABLE:'Native 전달 불가 · 새 결과 적용 중단',DISPOSED:'전달 종료'};
const errors={SERVER_CLOCK_UNAVAILABLE:'서버 시각 계약이 없어 3D 연결을 차단했습니다. Native 수락만으로 적용되지 않습니다.',BINDING_DELIVERY_TIMEOUT:'연결 정보 전달이 지연되어 3D 연결을 종료했습니다.',INVALID_BINDING:'점검 연결 정보를 검증하지 못했습니다.',BINDING_CONFLICT:'다른 점검 연결과 충돌해 새 연결을 거부했습니다.',INVALID_RESULT:'결과의 부품·응답·시각을 확인하지 못했습니다.',INACTIVE_BINDING:'연결이 만료되거나 종료되어 새 결과를 적용할 수 없습니다.',DIGEST_MISMATCH:'원본 결과와 수락 근거가 일치하지 않습니다.',VERIFICATION_FAILED:'Native 수락 검증에 실패했습니다.',INVALID_ACCEPTED_PROOF:'검증된 수락 근거를 확인하지 못했습니다.',RESULT_CONFLICT:'같은 점검 ID의 내용이 달라 새 결과를 거부했습니다.',INVALID_TERMINAL:'점검 연결의 종료 정보를 확인하지 못했습니다.',CAPACITY:'이 화면의 기록 한도에 도달했습니다. 새 점검 세션이 필요합니다.',NATIVE_NOT_CONNECTED:'Native 전달 경로가 없어 모바일 요청을 시작할 수 없습니다.',REQUEST_FAILED:'Native 점검 생성 요청에 실패했습니다.'};
const errorText=code=>errors[code]??'결과 전달 상태를 확인하지 못했습니다.';
export function resultSummaryHtml(local,mobile){
  const rows=projectInspectionResults(local,mobile),counts=resultCounts(rows),pending=rows.reduce((n,r)=>n+r.candidates.filter(c=>c.inspectionId!==r.inspectionId).length,0);
  return `<section class="all-results" aria-label="17개 부품 점검 결과"><h3>17개 부품 점검 결과</h3>
    <p role="status">선택된 확정 기록 ${17-counts.NOT_INSPECTED}/17 · 미점검 ${counts.NOT_INSPECTED} · 이상 징후 ${counts.FINDINGS_REPORTED} · 확인 불가 ${counts.UNABLE} · 발견 사항 없음 ${counts.NO_FINDINGS_REPORTED}</p>
    <p class="note">${esc(connection[mobile?.connection]??connection.INCOMPLETE_NATIVE)}</p><p class="note">모바일 후보 ${pending}건 · 수신만으로 자동 적용하지 않습니다. SDK 관측·QR 표시·미확정 응답은 점검 완료가 아닙니다.</p>
    ${mobile?.notice?`<p class="result-error" role="status">${errorText(mobile.notice)} 기존 표시 기록은 유지합니다.</p>`:''}
    <ul class="items result-list">${rows.map(r=>`<li><button type="button" class="item" data-action="result-detail" data-id="${r.partId}"><span>${esc(r.partLabel)}</span>${stateBadgeHtml(r)}<small>${r.origin==='MOBILE_RECEIVER'?'MOBILE / USER_REPORTED · Native 수락 기록':r.origin?'USER_REPORTED · 이 3D 화면 직접 입력':'확정 기록 없음'}${r.candidates.length?` · 모바일 ${r.candidates.length}건`:''}</small></button></li>`).join('')}</ul></section>`;
}
export function partResultHtml(local,mobile,partId){
  const row=projectInspectionResults(local,mobile).find(r=>r.partId===partId);if(!row)return '';
  const current=row.inspectionId??'LOCAL';
  return `<section class="part-results" data-result-part="${partId}"><h3>이 부품의 사용자 점검 결과</h3>${stateBadgeHtml(row)}
    ${mobile?.notice?`<p class="result-error" role="status">${errorText(mobile.notice)} 새 결과를 완료로 적용하지 않았습니다.</p>`:''}
    <dl class="tire-status"><dt>출처</dt><dd>${row.source??'확정 기록 없음'}${row.confirmation?' / '+row.confirmation:''}</dd><dt>기록 경로</dt><dd>${row.origin==='MOBILE_RECEIVER'?'검증된 Native 수락 → 사용자 선택':row.origin?'이 3D 화면 직접 입력':'선택된 결과 없음'}</dd><dt>사용자 확정 시각</dt><dd>${recordTimeHtml(row.completedAt)}</dd></dl>
    ${row.inspectionId?`<details><summary>원본 응답·수락 근거</summary><dl class="tire-status"><dt>inspectionId</dt><dd>${esc(row.inspectionId)}</dd><dt>taskId / partId</dt><dd>${esc(row.taskId)} / ${esc(row.partId)}</dd>${['proofId','bindingId','syncSessionId','localSessionId','generation','receivedAt','acceptedAt'].map(k=>`<dt>${k}</dt><dd>${esc(row.proof[k])}</dd>`).join('')}<dt>digest</dt><dd>${esc(row.resultDigest)}</dd></dl>
      ${row.schemaVersion===1?`<p>원본 사용자 선택: ${esc(row.original.status)} · 질문별 응답이 없는 schema v1입니다.</p>`:`<dl class="tire-status">${row.responseKeys.map(k=>`<dt>${esc(RESPONSE_LABELS[k])}</dt><dd>${RESPONSE_ANSWERS[row.responses[k]]}</dd>`).join('')}</dl>`}<pre>${esc(JSON.stringify(row.original,null,2))}</pre></details>`:''}
    <fieldset class="record-picker"><legend>표시할 기록을 직접 선택하세요</legend>
      <button type="button" class="secondary" data-action="select-result" data-task="${row.taskId}" data-record="LOCAL" aria-pressed="${current==='LOCAL'}" data-session="${esc(local.sessionId)}">${row.local?'로컬 타이어 기록':'모바일 기록 표시 해제 · 미점검'}${current==='LOCAL'?' · 선택됨':''}</button>
      ${row.candidates.map(c=>{const binding=mobile.bindings.find(b=>b.bindingId===c.bindingId),active=binding?.state==='ACTIVE',chosen=current===c.inspectionId;
        return `<button type="button" class="secondary" data-action="select-result" data-task="${row.taskId}" data-record="${c.inspectionId}" data-session="${esc(local.sessionId)}" aria-pressed="${chosen}" ${!active&&!chosen?'disabled':''}>MOBILE / USER_REPORTED · ${esc(c.result.completedAt)} · ${esc(c.inspectionId)}${chosen?' · 선택됨':active?' · 수락된 후보':' · 연결 종료/만료, 새 적용 불가'}${chosen&&!active?' · 전달 연결 종료/만료, 이미 선택한 수락 기록 보존':''}</button>`;}).join('')}</fieldset>
    <p class="note">${row.local?'로컬 응답과 모바일 응답은 별도로 보존하며 수정·병합하지 않습니다.':'모바일 원문과 원본 시각을 보존합니다.'} 결과는 정상·안전·주행 가능 판정이 아닙니다.</p>
    <p class="note">${esc(connection[mobile?.connection]??connection.INCOMPLETE_NATIVE)}</p>
    <button type="button" class="secondary" data-action="request-mobile" data-task="${row.taskId}">이 부품 모바일 점검 요청</button><p class="note">${mobile?.connection==='ADAPTER_CONNECTED'?'생성·인증·QR v2 연결과 명시적 수락은 Native 소유자의 정책으로 처리합니다.':'검증된 Native 전달 경로가 없는 현재 배포에서는 QR v2 요청·결과 수신을 시작할 수 없습니다.'}</p></section>`;
}
