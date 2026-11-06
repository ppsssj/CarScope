// Product navigation and presentation only. The existing USER_REPORTED reducer owns all records.
import { summaryHtml } from './tire-inspection-view.mjs';
import {resultSummaryHtml} from './inspection-results-view.mjs';

/** Same rule as the phone's bonnet check: look from outside, touch nothing. `manualHref` must already be escaped. */
export const washerGuideHtml = manualHref => `<h3>점검 방법</h3><ol><li>평탄하고 안전한 곳에 세우고 P·주차 브레이크를 확인합니다.</li><li>전원을 끄고, 충전 중이 아닌지 확인합니다.</li><li>보닛을 단단히 고정하고 모터룸이 완전히 식은 뒤에 살펴봅니다.</li><li>사용설명서로 위치를 확인하고 워셔 기호가 표시된 캡을 찾습니다.</li><li>겉으로 보이는 모습만 눈으로 확인합니다. 보이지 않으면 확인하기 어렵다고 기록합니다.</li></ol>
        <h3>주의</h3><ul><li>부품을 만지거나 캡·덮개를 열지 마세요. 직접 보충하지 마세요.</li><li>부족해 보이면 사용설명서나 제조사 서비스 안내를 따르세요. 냉각수나 부동액을 워셔액 대신 쓰지 않습니다.</li><li>캡 표기를 확인해 다른 리저버와 혼동하지 마세요.</li><li>이 화면의 위치와 형상은 추정입니다. 실제 차량의 표기와 사용설명서를 우선하세요.</li></ul>
        <h3>출처</h3><p><a class="link" href="${manualHref}" target="_blank" rel="noopener noreferrer">Hyundai IONIQ 5 (2022, UK) 정비 설명서 9-14 워셔액</a></p><p class="note">설명서의 보충 절차는 이 점검에 포함되지 않습니다.</p>`;

/** Light names stay short, so the screens say what the check covers. Same scope as the phone's lamp check. */
export const LIGHT_SCOPE_TEXT = '꺼져 있는 전조등의 겉모습만 눈으로 확인합니다. 켜서 시험하거나 만지거나 분해하지 마세요.';

export function productSummaryHtml(session,mobile) {
  return `<div class="eyebrow">차량 점검 · 이 화면의 기록</div><h2>전체 점검 요약</h2>
    <p class="note">기록 확정은 사용자가 응답을 확인한 뜻입니다. 차량의 정상·안전·주행 가능 판정이 아닙니다.</p>
    <div id="allResults">${resultSummaryHtml(session,mobile)}</div>
    <section data-result-source="USER_REPORTED"><h3>네 타이어 · 로컬 직접 입력 기록</h3>${summaryHtml(session)}</section>
    <section data-result-source="${mobile?.records?.some(r=>r.taskId==='washer-fluid')?'MOBILE_CANDIDATES':'NOT_RECORDED'}"><h3>워셔액 · 안내와 스마트폰 점검</h3>
      <p>${mobile?.records?.some(r=>r.taskId==='washer-fluid')?'워셔액 모바일 기록은 위 17개 결과 목록에서 선택하고 확인하세요.':'선택된 워셔액 결과가 없으면 미점검입니다.'} 안내 열람이나 QR 표시는 점검 완료가 아닙니다.</p>
      <p class="note">모바일 결과와 Android 수신 화면의 결과는 별도로 관리합니다.</p>
      <button type="button" class="secondary" data-action="area" data-id="hood">워셔액 안내 · 부품 목록으로</button></section>
    <section><h3>실제 SDK 관측과 별개</h3><p class="note">타이어의 Pleos API 상태는 타이어 상세에서 확인하세요. 사용자 응답으로 API 지원 여부·관측 시각을 바꾸지 않습니다.</p></section>
    <p class="note">기록은 이 화면의 메모리에만 있습니다. 홈으로 돌아가거나 점검 종료·화면 닫기·새로고침 시 지워집니다.</p>
    <button type="button" class="secondary" data-action="back">계속 점검하기</button>`;
}

export function sessionActions(state) {
  if (state.name === 'IDLE') return '';
  const history = ['HISTORY_LIST', 'HISTORY_DETAIL'].includes(state.name);
  return `<nav class="session-actions" aria-label="점검 세션">${['INSPECTION_SUMMARY', 'HOOD_CLOSING'].includes(state.name) ? '' :
    `<button type="button" class="secondary" data-action="product-summary">${history ? '현재 점검 · ' : ''}전체 점검 요약</button>`}
    ${['INSPECTION_OVERVIEW', 'INSPECTION_SUMMARY', 'PART_RESULT'].includes(state.name) ? '<button type="button" class="secondary" data-action="open-history">점검 기록 · 저장된 과거 기록</button>' : ''}
    <button type="button" class="secondary" data-action="exit">점검 종료 · ${history ? '현재 세션 ' : ''}기록 지우기</button>${history ? '<p class="note">저장된 과거 기록은 삭제되지 않습니다.</p>' : ''}</nav>`;
}

// Same one-step Back semantics as the browser. Closing at home is an explicit native-only boundary.
export function inspectionBack(api, close) {
  if (!api || api.state.name === 'IDLE') close('android-back-home');
  else api.dispatch({ type: 'BACK' });
  return true; // ignored Back while closing must never fall through to native finish.
}
