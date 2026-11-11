// Product navigation and presentation only. The existing USER_REPORTED reducer owns all records.
import {resultSummaryHtml,receiverActive} from './inspection-results-view.mjs';

// The phone's bonnet check: look from outside, touch nothing. Shared by every part under the hood.
export const HOOD_SAFETY_STEPS = Object.freeze(['평탄하고 안전한 곳에 세우고 P·주차 브레이크를 확인합니다.','전원을 끄고, 충전 중이 아닌지 확인합니다.','보닛을 단단히 고정하고 모터룸이 완전히 식은 뒤에 살펴봅니다.']);
export const LOOK_ONLY_TEXT = '부품을 만지거나 캡·덮개를 열지 마세요.';
const li = items => items.map(x => `<li>${x}</li>`).join('');

/** Same rule as the phone's bonnet check: look from outside, touch nothing. `manualHref` must already be escaped. */
export const washerGuideHtml = manualHref => `<h3>점검 방법</h3><ol>${li([...HOOD_SAFETY_STEPS,'사용설명서로 위치를 확인하고 워셔 기호가 표시된 캡을 찾습니다.','겉으로 보이는 모습만 눈으로 확인합니다. 보이지 않으면 확인하기 어렵다고 기록합니다.'])}</ol>
        <h3>주의</h3><ul>${li([`${LOOK_ONLY_TEXT} 직접 보충하지 마세요.`,'부족해 보이면 사용설명서나 제조사 서비스 안내를 따르세요. 냉각수나 부동액을 워셔액 대신 쓰지 않습니다.','캡 표기를 확인해 다른 리저버와 혼동하지 마세요.','이 화면의 위치와 형상은 추정입니다. 실제 차량의 표기와 사용설명서를 우선하세요.'])}</ul>
        <h3>출처</h3><p><a class="link" href="${manualHref}" target="_blank" rel="noopener noreferrer">Hyundai IONIQ 5 (2022, UK) 정비 설명서 9-14 워셔액</a></p><p class="note">설명서의 보충 절차는 이 점검에 포함되지 않습니다.</p>`;

/** Other parts under the hood: the same safe steps, without a procedure this screen does not have. */
export const hoodGuideHtml = () => `<h3>점검 전 안전 확인</h3><ol>${li(HOOD_SAFETY_STEPS)}</ol>
        <p>${LOOK_ONLY_TEXT} 겉으로 보이는 모습만 확인합니다. 정비 절차는 이 화면에서 안내하지 않습니다.</p>`;

/** Light names stay short, so the screens say what the check covers. Same scope as the phone's lamp check. */
export const LIGHT_SCOPE_TEXT = '꺼져 있는 전조등의 겉모습만 눈으로 확인합니다. 켜서 시험하거나 만지거나 분해하지 마세요.';

/** Every Back control has one label and one event, the same as the top bar, Escape and Android Back. */
export const BACK_LABEL = '뒤로';
export const backButtonHtml = () => `<button type="button" class="secondary" data-action="back">${BACK_LABEL}</button>`;

/** A screen's main navigation row: optional extra controls, then Back. */
export const actionsHtml = (extra = '') => `<div class="actions">${extra}${backButtonHtml()}</div>`;

/** P10 PR #2 summary: one progress view and one list of the 17 result parts. Tire input, washer guide and SDK
 * observations live on their own part screens, which every row opens. */
export function productSummaryHtml(session,mobile) {
  return `<div class="eyebrow">이번 점검</div><h2>전체 점검 요약</h2>
    <p class="safety-note">결과는 사용자가 보고한 점검 내용이며 차량의 정상·안전·주행 가능 판정이 아닙니다.</p>
    <div id="allResults">${resultSummaryHtml(session,mobile)}</div>
    ${actionsHtml()}`;
}

/** What ending the session really clears, counted from the session itself. Stored history is never part of it. */
export function sessionDataScope(local,mobile) {
  const answered=Object.values(local?.tires??{}).filter(t=>Object.keys(t.responses??{}).length>0).length;
  const results=mobile?.records?.length??0,active=receiverActive(mobile?.receiver);
  return Object.freeze({answered,results,active,any:answered>0||results>0||active});
}
export const EXIT_SCOPE_TEXT = '종료하면 이번 점검의 응답과 이 화면에 표시된 결과가 지워집니다. 저장된 과거 점검 기록은 그대로 남습니다.';
export function exitConfirmHtml(scope) {
  return `<h2 id="exitConfirmTitle">점검을 종료할까요?</h2><p>종료하면 이 화면에서 다음 내용이 지워집니다.</p><ul>
    ${scope.answered?`<li>직접 입력한 타이어 응답 (타이어 ${scope.answered}개)</li>`:''}${scope.results?`<li>이 화면에 표시된 스마트폰 결과 ${scope.results}건</li>`:''}${scope.active?'<li>진행 중인 스마트폰 점검 연결</li>':''}</ul>
    <p class="note">저장된 과거 점검 기록은 지워지지 않습니다.</p>
    <div class="dialog-actions"><button type="button" class="secondary" data-action="exit-cancel">계속 점검</button><button type="button" class="primary" data-action="exit-confirm">점검 종료</button></div>`;
}

export function sessionActions(state) {
  if (state.name === 'IDLE') return '';
  const history = ['HISTORY_LIST', 'HISTORY_DETAIL'].includes(state.name);
  return `<nav class="session-actions" aria-label="점검 세션">${['INSPECTION_SUMMARY', 'HOOD_CLOSING'].includes(state.name) ? '' :
    `<button type="button" class="secondary" data-action="product-summary">${history ? '이번 점검 ' : ''}전체 점검 요약</button>`}
    ${['INSPECTION_OVERVIEW', 'INSPECTION_SUMMARY', 'PART_RESULT'].includes(state.name) ? '<button type="button" class="secondary" data-action="open-history">저장된 과거 점검 기록</button>' : ''}
    <button type="button" class="secondary" data-action="exit">점검 종료</button><p class="note">${EXIT_SCOPE_TEXT}</p></nav>`;
}

// Same one-step Back semantics as the browser. Closing at home is an explicit native-only boundary.
export function inspectionBack(api, close) {
  if (!api || api.state.name === 'IDLE') close('android-back-home');
  else api.dispatch({ type: 'BACK' });
  return true; // ignored Back while closing must never fall through to native finish.
}
