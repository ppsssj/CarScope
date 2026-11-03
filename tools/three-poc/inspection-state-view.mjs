import { INSPECTION_STATES, inspectionStateMap, inspectionCounts } from './inspection-state-map.mjs';
export function recordTimeHtml(at) {
  if(at===null)return '확정 시각 없음';
  const iso=new Date(at).toISOString();
  return `<time datetime="${iso}">${iso}</time>`;
}
export function stateBadgeHtml(row) {
  return `<span class="inspection-state" data-inspection-state="${row.status}">${row.symbol} ${row.label}</span>`;
}
export function stateLegendHtml(session,{compact=false}={}) {
  const counts=inspectionCounts(session);
  return `<section class="inspection-legend" aria-label="3D 타이어 점검 상태 범례"><h3>3D 점검 상태 · 타이어 4개</h3>
    <ul>${Object.entries(INSPECTION_STATES).map(([status,style])=>`<li>${stateBadgeHtml({status,...style})} <span>${counts[status]}개</span></li>`).join('')}</ul>
    <p class="note">이 화면의 확정 기록 · 정상·안전 판정이 아닙니다.</p>
    ${compact?'':recordScopeHtml()}</section>`;
}
export function recordScopeHtml() { return `    <details class="record-scope"><summary>기록 범위·모바일 연결 상태</summary>
    <p class="note">USER_REPORTED · 이 3D 화면에서 직접 확정한 기록만 표시합니다. 미확정 응답은 미점검으로 집계합니다. 청록색은 선택 강조이며 기록 상태색과 별개입니다.</p>
    <p class="note">모바일·Native 결과는 이 화면에 수신되지 않습니다. 나머지 부품은 결과 미수집이며 안내·QR·SDK 관측을 점검 완료로 집계하지 않습니다. 가려진 타이어는 목록에서 확인하세요.</p></details>`; }
export function stateRecordHtml(session,id) {
  const row=inspectionStateMap(session).find(r=>r.partId===id);
  if(!row)return '';
  return `<section class="inspection-record" data-inspection-part="${id}"><h3>이 세션의 점검 기록</h3>${stateBadgeHtml(row)}
    <dl class="tire-status"><dt>출처</dt><dd>${row.source??'확정 기록 없음'}</dd><dt>기록 경로</dt><dd>${row.origin?'이 3D 화면 직접 입력':'모바일·Native 수신 기록 없음'}</dd>
    <dt>확정 시각</dt><dd>${recordTimeHtml(row.completedAt)}</dd></dl>
    ${row.draft?'<p class="note">응답 진행 중 · 미확정. 상태 지도에 확정 결과로 표시하지 않습니다.</p>':''}</section>`;
}
