// Product navigation and presentation only. The existing USER_REPORTED reducer owns all records.
import { summaryHtml } from './tire-inspection-view.mjs';

export function productSummaryHtml(session) {
  return `<div class="eyebrow">차량 점검 · 이 화면의 기록</div><h2>전체 점검 요약</h2>
    <p class="note">기록 확정은 사용자가 응답을 확인한 뜻입니다. 차량의 정상·안전·주행 가능 판정이 아닙니다.</p>
    <section data-result-source="USER_REPORTED"><h3>네 타이어 · 사용자 육안 기록</h3>${summaryHtml(session)}</section>
    <section data-result-source="NOT_RECORDED"><h3>워셔액 · 안내와 스마트폰 점검</h3>
      <p>이 화면에는 워셔액 점검 결과가 수집되지 않습니다. 안내 열람이나 QR 표시는 점검 완료가 아닙니다.</p>
      <p class="note">모바일 결과와 Android 수신 화면의 결과는 별도로 관리합니다.</p>
      <button type="button" class="secondary" data-action="area" data-id="hood">워셔액 안내 · 부품 목록으로</button></section>
    <section><h3>실제 SDK 관측과 별개</h3><p class="note">타이어의 Pleos API 상태는 타이어 상세에서 확인하세요. 사용자 응답으로 API 지원 여부·관측 시각을 바꾸지 않습니다.</p></section>
    <p class="note">기록은 이 화면의 메모리에만 있습니다. 홈으로 돌아가거나 점검 종료·화면 닫기·새로고침 시 지워집니다.</p>
    <button type="button" class="secondary" data-action="back">계속 점검하기</button>`;
}

export function sessionActions(state) {
  if (state.name === 'IDLE') return '';
  return `<nav class="session-actions" aria-label="점검 세션">${['INSPECTION_SUMMARY', 'HOOD_CLOSING'].includes(state.name) ? '' :
    '<button type="button" class="secondary" data-action="product-summary">전체 점검 요약</button>'}
    <button type="button" class="secondary" data-action="exit">점검 종료 · 기록 지우기</button></nav>`;
}

// Same one-step Back semantics as the browser. Closing at home is an explicit native-only boundary.
export function inspectionBack(api, close) {
  if (!api || api.state.name === 'IDLE') close('android-back-home');
  else api.dispatch({ type: 'BACK' });
  return true; // ignored Back while closing must never fall through to native finish.
}
