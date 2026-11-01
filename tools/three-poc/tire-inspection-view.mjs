import { TIRES } from './inspection-tires.mjs';
import { CHECKS, ANSWERS, inspectionProgress, needsReview } from './tire-inspection.mjs';
const status = { NOT_STARTED: '점검 전', IN_PROGRESS: '진행 중', COMPLETED: '점검 완료' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function guideHtml(session, id) {
  const row = session.tires[id], count = Object.keys(row.responses).length;
  return `<div class="eyebrow">육안 셀프 점검 · USER_REPORTED</div>
    <p class="note">차량을 정차한 상태에서 보이는 부분만 확인하세요. 이 기록은 정상·안전·주행 가능 판정이 아닙니다.</p>
    <p role="status">${status[row.status]} · 응답 ${count}/3 · 전체 ${inspectionProgress(session)}/4</p>
    ${CHECKS.map(c => `<fieldset class="tire-check"><legend>${c.label}</legend>${Object.entries(ANSWERS).map(([value, label]) =>
      `<label><input type="radio" name="${id}-${c.id}" value="${value}" data-check="${c.id}" data-tire="${id}" data-session="${esc(session.sessionId)}" ${row.responses[c.id] === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>`).join('')}
    ${row.completedAt === null ? '' : `<p class="note">확정 시각: ${new Date(row.completedAt).toISOString()}</p>`}
    <p class="note">응답을 수정하면 다시 확정해야 합니다. 기록은 이 화면의 세션에만 남고 점검 종료 시 지워집니다.</p>
    <button type="button" class="primary guide-confirm" data-action="confirm-tire" data-id="${id}" data-session="${esc(session.sessionId)}" ${count < 3 || row.status === 'COMPLETED' ? 'disabled' : ''}>${row.status === 'COMPLETED' ? '결과 확정됨' : '결과 확정'}</button>`;
}
export function summaryHtml(session) {
  return `<p role="status">점검 완료 ${inspectionProgress(session)}/4 · USER_REPORTED</p>
    <p class="note">미점검 타이어도 표시합니다. 완료는 응답 기록의 확정이며 정상·안전 판정이 아닙니다.</p>
    <div class="tire-map"><div class="vehicle-front">↑ 차량 전방 · 차량 기준 좌우</div>${TIRES.map(t => {
      const row = session.tires[t.id], review = needsReview(row);
      return `<button type="button" class="secondary tire-summary" data-action="tire" data-id="${t.id}"><strong>${t.label}</strong><span>${status[row.status]}</span><small>확인이 필요한 항목: ${review.length ? review.join(' · ') : row.status === 'COMPLETED' ? '기록된 발견·확인 불가 응답 없음' : '미응답 항목 확인 필요'}</small></button>`;
    }).join('')}</div>`;
}
