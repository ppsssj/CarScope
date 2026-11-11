import { projectInspectionResults } from './inspection-results.mjs';
import { stateBadgeHtml, recordTimeHtml } from './inspection-state-view.mjs';
import { TIRES } from './inspection-tires.mjs';
import { CHECKS, ANSWERS, inspectionProgress, needsReview } from './tire-inspection.mjs';
const status = { NOT_STARTED: '응답 전', IN_PROGRESS: '응답 중 · 아직 확정하지 않음', COMPLETED: '확정함' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Plain-language provenance of a projected row. The contract value stays in the row and in the developer details. */
export const sourceText = row => row.origin === 'MOBILE_RECEIVER' ? '스마트폰 점검' : row.origin ? '이 화면에서 직접 입력' : '';
/** Direct input on this screen. Records stay USER_REPORTED in the reducer; the page says it in words. */
export function guideHtml(session, id) {
  const row = session.tires[id], count = Object.keys(row.responses).length;
  return `<section class="guide" data-source="USER_REPORTED"><h3>직접 점검하기</h3>
    <p class="note">차량을 안전한 곳에 세운 상태에서 보이는 부분만 눈으로 확인하세요.</p>
    <p role="status">${status[row.status]} · 응답 ${count}/3</p>
    ${CHECKS.map(c => `<fieldset class="tire-check"><legend>${c.label}</legend>${Object.entries(ANSWERS).map(([value, label]) =>
      `<label><input type="radio" name="${id}-${c.id}" value="${value}" data-check="${c.id}" data-tire="${id}" data-session="${esc(session.sessionId)}" ${row.responses[c.id] === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>`).join('')}
    <button type="button" class="primary guide-confirm" data-action="confirm-tire" data-id="${id}" data-session="${esc(session.sessionId)}" ${count < 3 || row.status === 'COMPLETED' ? 'disabled' : ''}>${row.status === 'COMPLETED' ? '결과 확정됨' : '결과 확정'}</button>
    <p class="note">응답을 바꾸면 다시 확정해야 합니다.</p></section>`;
}
/** The tire area's own summary. Status and source come from the 17-part projection, so it never disagrees with the summary. */
export function summaryHtml(session, mobile = null) {
  const rows = projectInspectionResults(session, mobile);
  return `<p role="status">네 타이어 중 결과 있음 ${rows.filter(r => r.area === 'tires' && r.status !== 'NOT_INSPECTED').length}/4 · 직접 입력 확정 ${inspectionProgress(session)}/4</p>
    <div class="tire-map"><div class="vehicle-front">↑ 차량 전방 · 좌우는 차량 진행 방향 기준</div>${TIRES.map(t => {
      const local = session.tires[t.id], row = rows.find(r => r.partId === t.id), review = needsReview(local);
      const findings = review.length ? '확인이 필요한 항목: ' + review.join(' · ') : '';
      const detail = row.origin === 'MOBILE_RECEIVER' ? '스마트폰에서 받은 결과' : local.status === 'COMPLETED' ? findings || '발견하거나 확인하지 못한 항목 없음'
        : local.status === 'IN_PROGRESS' ? ['응답 중 · 아직 확정하지 않음', findings].filter(Boolean).join(' · ') : '';
      return `<button type="button" class="item tire-summary" data-action="tire" data-id="${t.id}"><strong>${t.label}</strong>${stateBadgeHtml(row)}${row.origin ? `<small>${sourceText(row)} · ${recordTimeHtml(row.completedAt)}</small>` : ''}${detail ? `<small>${detail}</small>` : ''}</button>`;
    }).join('')}</div>`;
}
