import { INSPECTION_STATES } from './inspection-state-map.mjs';
import { projectInspectionResults, resultCounts } from './inspection-results.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
/** One instant, shown in the reader's time zone. The original value stays in `datetime`; nothing is re-timed. */
export function recordTimeHtml(at) {
  if(at===null||at===undefined)return '—';
  const iso=typeof at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at)?at:new Date(at).toISOString();
  const text=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
  return `<time datetime="${iso}">${esc(text)}</time>`;
}
export function stateBadgeHtml(row) {
  return `<span class="inspection-state" data-inspection-state="${row.status}">${row.symbol} ${row.label}</span>`;
}
// P10 PR #2: the one progress view. Always the 17 result parts of this session (the same projection as the summary list),
// never a tire-only count. Completed means "has a confirmed or received result", so it is the total minus not inspected.
export function progressCounts(rows) {
  const counts=resultCounts(rows),total=rows.length;
  return Object.freeze({total,done:total-counts.NOT_INSPECTED,counts});
}
export function progressText({total,done,counts}) {
  return `점검 완료 ${done}/${total} · ${Object.entries(INSPECTION_STATES).map(([s,x])=>`${x.label} ${counts[s]}`).join(' · ')}`;
}
export function progressHtml(rows,{compact=false}={}) {
  const p=progressCounts(rows),pct=p.total?Math.round(100*p.done/p.total):0;
  return `<section class="progress-summary" aria-label="이번 점검 진행 현황">
    <p class="progress-head" role="status"><span class="sr-only">${progressText(p)}</span><strong aria-hidden="true">점검 완료 ${p.done}<small>/${p.total}</small></strong></p>
    <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <ul class="result-counts${compact?' compact':''}" aria-hidden="true">${Object.entries(INSPECTION_STATES).map(([status,style])=>`<li>${stateBadgeHtml({status,...style})}<b>${p.counts[status]}</b></li>`).join('')}</ul></section>`;
}
/** The state key of this session: the 17 result parts, local and received, from the same projection as every list. */
export function stateLegendHtml(local,mobile,{compact=false}={}) {
  return progressHtml(projectInspectionResults(local,mobile),{compact});
}
