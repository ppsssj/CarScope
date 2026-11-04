// P8-B1: read-only History presentation. Rows come only from the History store snapshot. The current
// session is passed in separately and drawn in its own zone; SDK status is never read here.
import {MOBILE_TARGETS,targetForTask} from './mobile-result-contract.mjs';
import {HISTORY_STATUSES,historyDisplayState} from './inspection-history-contract.mjs';
import {INSPECTION_STATES} from './inspection-state-map.mjs';
import {stateBadgeHtml} from './inspection-state-view.mjs';
import {RESPONSE_LABELS,RESPONSE_ANSWERS} from './inspection-results-view.mjs';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
// Raw values stay visible because OK and NO_FINDINGS_REPORTED share one badge. Neither means "normal".
export const HISTORY_STATUS_LABELS=Object.freeze({
  OK:'워셔액 충분 확인 보고',NEEDS_REFILL:'워셔액 보충 필요 보고',UNSURE:'워셔액 확인 불가 보고',
  REVIEW_NEEDED:'이상 징후 보고',UNABLE:'확인 불가',NO_FINDINGS_REPORTED:'발견 사항 없음',
});
const MESSAGES=Object.freeze({
  UNAVAILABLE:{title:'점검 기록 조회 경로가 연결되지 않았습니다',body:'이 화면에는 검증된 기록 조회 경로가 아직 없습니다. 저장된 기록이 없다는 뜻이 아닙니다.'},
  AUTH_REQUIRED:{title:'인증·권한을 확인할 수 없습니다',body:'차량 소유 인증을 확인하지 못했습니다. 기록이 없다는 뜻이 아니며, 이전에 표시한 기록은 화면에서 지웠습니다.',retry:'다시 확인'},
  NOT_FOUND:{title:'기록을 찾을 수 없습니다',body:'기록이 없거나 이 계정에서 접근할 수 없습니다.'},
  INVALID_QUERY:{title:'조회 조건을 확인하세요',body:'부품·결과·날짜 필터가 올바르지 않습니다. 시작일은 종료일보다 늦을 수 없고 1970년 이후 날짜만 사용할 수 있습니다.',retry:'처음부터 다시 조회'},
  RATE_LIMITED:{title:'요청이 많아 잠시 제한되었습니다',body:'잠시 뒤 다시 시도하세요.',retry:'다시 시도'},
  SERVER_ERROR:{title:'서버 오류로 기록을 불러오지 못했습니다',body:'저장된 기록이 없다는 뜻이 아닙니다. 잠시 뒤 다시 시도하세요.',retry:'다시 시도'},
  NETWORK_ERROR:{title:'통신에 실패했습니다',body:'연결 상태를 확인한 뒤 다시 시도하세요.',retry:'다시 시도'},
  INVALID_RESPONSE:{title:'응답을 확인하지 못해 표시하지 않았습니다',body:'기록 형식·순서·무결성이 계약과 일치하지 않습니다.',retry:'처음부터 다시 조회'},
});
const DEMO_BANNER='<p class="history-demo" role="note"><strong>데모 데이터</strong> · 합성 미리보기이며 실제 차량 기록이나 조회 성공이 아닙니다.</p>';
const demo=snapshot=>snapshot.origin==='DEMO';

export function formatHistoryTime(ms,{timeZone}={}){
  const iso=new Date(ms).toISOString();
  const text=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short',...(timeZone?{timeZone}:{})}).format(ms);
  return `<time datetime="${iso}">${esc(text)}</time>`;
}
const recordBadge=record=>{const status=historyDisplayState(record);return stateBadgeHtml({status,...INSPECTION_STATES[status]});};
const zone=(kind,tag,body)=>`<section class="source-zone" data-source-zone="${kind}"><span class="zone-tag">${tag}</span>${body}</section>`;

/** Current-session zone: drawn from the same projection the session UI uses, for comparison only. */
export function historySessionZoneHtml(row,{compact=false}={}){
  if(!row)return '';
  return zone('SESSION','현재 세션 · 이 화면 메모리',`<div class="zone-row"><span>${esc(row.partLabel)}</span>${stateBadgeHtml(row)}</div>
    ${compact?'':'<p class="note">과거 기록을 열어도 현재 세션 상태는 바뀌지 않습니다.</p>'}
    <button type="button" class="secondary" data-action="history-session-part" data-id="${esc(row.partId)}">현재 세션의 이 부품 결과 열기</button>`);
}
/** Past-record entry shown beside a part's current result. It performs no request until opened. */
export function historyEntryZoneHtml(partLabel){
  return zone('HISTORY','저장된 과거 기록 · 서버',`<p class="note">${esc(partLabel)}의 저장된 사용자 보고를 별도로 조회합니다. 현재 세션과 합치지 않습니다.</p>
    <button type="button" class="secondary" data-action="open-history">이 부품의 과거 기록 보기</button>`);
}
/** One line naming the applied filters, so the form can stay collapsed and rows stay on screen. */
export function historyFilterSummaryText(filters){
  const parts=[targetForTask(filters.taskId)?.label,HISTORY_STATUS_LABELS[filters.status],filters.fromDate||filters.toDate?`${filters.fromDate||'처음'} ~ ${filters.toDate||'현재'}`:null].filter(Boolean);
  return parts.length?`필터 · ${parts.join(' · ')}`:'필터 · 부품·결과·날짜';
}
export function historyFilterHtml(snapshot){
  const f=snapshot.filters;
  const option=(value,label,selected)=>`<option value="${esc(value)}"${selected?' selected':''}>${esc(label)}</option>`;
  return `<details class="history-filters"><summary id="historyFilterSummary">${esc(historyFilterSummaryText(f))}</summary>
    <form id="historyFilterForm" aria-label="점검 기록 필터">
      <label>부품<select name="taskId">${option('','전체 부품',!f.taskId)}${MOBILE_TARGETS.map(t=>option(t.taskId,t.label,f.taskId===t.taskId)).join('')}</select></label>
      <label>점검 결과<select name="status">${option('','전체 결과',!f.status)}${HISTORY_STATUSES.map(s=>option(s,`${HISTORY_STATUS_LABELS[s]} (${s})`,f.status===s)).join('')}</select></label>
      <div class="history-dates"><label>시작일<input type="date" name="fromDate" min="1970-01-01" max="9999-12-31" value="${esc(f.fromDate)}"></label>
      <label>종료일<input type="date" name="toDate" min="1970-01-01" max="9999-12-31" value="${esc(f.toDate)}"></label></div>
      <p class="note">날짜는 사용자가 보고한 점검 완료 시각 기준이며 이 기기의 시간대로 계산합니다.</p>
      <button type="button" class="secondary" data-action="history-reset-filters">필터 초기화</button>
    </form></details>`;
}
function messageHtml(code,{filterAction=false}={}){
  const m=MESSAGES[code]??MESSAGES.INVALID_RESPONSE;
  // A rejected filter cannot succeed by repeating it; a rejected cursor restarts from the first page via retry.
  const action=filterAction&&code==='INVALID_QUERY'?'<button type="button" class="secondary" data-action="history-reset-filters">필터 초기화</button>'
    :m.retry?`<button type="button" class="secondary" data-action="history-retry">${esc(m.retry)}</button>`:'';
  return `<div class="history-message" role="alert" data-history-status="${esc(code)}"><strong>${esc(m.title)}</strong><p>${esc(m.body)}</p>${action}</div>`;
}
function cardHtml(record,snapshot){
  const t=targetForTask(record.taskId);
  return `<li><button type="button" class="item history-card" data-action="history-detail" data-record="${esc(record.recordId)}">
    <span class="history-part">${esc(t.label)}</span>${recordBadge(record)}
    <small>완료 ${formatHistoryTime(record.completedAt)}</small>
    <small>${esc(record.source)} · 스마트폰 자가 점검</small>
    <small>taskId ${esc(record.taskId)}</small>${demo(snapshot)?'<small class="history-demo-chip">데모 데이터</small>':''}
  </button></li>`;
}
/** Live region of the list screen. The filter form stays outside it, so re-rendering keeps input focus. */
export function historyListResultsHtml(snapshot,sessionRow){
  const {list}=snapshot,session=snapshot.filters.taskId?historySessionZoneHtml(sessionRow,{compact:true}):'';
  const banner=demo(snapshot)?DEMO_BANNER:'';
  if(['IDLE','LOADING'].includes(list.status))return `${banner}${session}<p class="history-loading" role="status" aria-busy="true" data-history-status="LOADING">점검 기록을 불러오는 중…</p>`;
  if(list.status==='EMPTY')return `${banner}${session}<div class="history-message" role="status" data-history-status="EMPTY"><strong>저장된 기록이 없습니다</strong><p>이 조건으로 조회한 결과가 0건입니다.</p></div>`;
  if(list.status!=='SUCCESS')return `${banner}${session}${messageHtml(list.status,{filterAction:true})}`;
  const more=list.moreStatus,moreBlock=more&&more!=='LOADING'?messageHtml(more):'';
  return `${banner}${session}<section class="source-zone" data-source-zone="HISTORY"><span class="zone-tag">저장된 과거 기록 · 서버</span>
    <p class="note" role="status">불러온 기록 ${list.items.length}건 · 전체 개수는 제공되지 않습니다.</p>
    <ul class="items result-list" aria-label="과거 점검 기록 목록">${list.items.map(r=>cardHtml(r,snapshot)).join('')}</ul>${moreBlock}
    ${list.hasMore&&!moreBlock?`<button type="button" class="secondary history-more" data-action="history-more"${more==='LOADING'?' aria-disabled="true" aria-busy="true"':''}>${more==='LOADING'?'더 불러오는 중…':'더 보기'}</button>`:''}
    ${!list.hasMore?'<p class="note">마지막 기록까지 불러왔습니다. 조회 이후 새로 저장된 기록은 다시 조회하면 표시됩니다.</p>':''}</section>`;
}
function detailDescription(record,t){
  const items=t.responseKeys.map(k=>RESPONSE_LABELS[k]);
  return t.schemaVersion===1?`사용자가 스마트폰 안내를 따라 ${t.label} 상태를 직접 확인하고 선택한 결과입니다.`:`사용자가 스마트폰에서 ${t.label}의 ${items.join('·')}을(를) 육안으로 확인해 응답한 결과입니다.`;
}
export function historyDetailResultsHtml(snapshot,sessionRow){
  const {detail}=snapshot,banner=demo(snapshot)?DEMO_BANNER:'';
  if(['IDLE','LOADING'].includes(detail.status))return `${banner}<p class="history-loading" role="status" aria-busy="true" data-history-status="LOADING">기록 상세를 불러오는 중…</p>`;
  if(detail.status!=='SUCCESS'||!detail.record)return banner+messageHtml(detail.status);
  const r=detail.record,o=r.originalResult,t=targetForTask(r.taskId);
  const answers=t.schemaVersion===1
    ?`<p>사용자 선택: ${esc(HISTORY_STATUS_LABELS[o.status])} (${esc(o.status)})</p><p class="note">schema v1 워셔액 기록에는 질문별 응답이 없습니다. 오류가 아닙니다.</p>`
    :`<dl class="tire-status">${t.responseKeys.map(k=>`<dt>${esc(RESPONSE_LABELS[k])}</dt><dd>${esc(RESPONSE_ANSWERS[r.responses[k]])}</dd>`).join('')}</dl>`;
  return `${banner}${zone('HISTORY','저장된 과거 기록 · 서버 · 읽기 전용',`<div class="zone-row"><strong class="history-part">${esc(t.label)}</strong>${recordBadge(r)}</div>
    <p class="note">원본 상태값 ${esc(r.inspectionStatus)} · 차량의 정상·안전·주행 가능 판정이 아닙니다.</p>
    <dl class="tire-status"><dt>점검 항목</dt><dd>${esc(r.taskId)} / ${esc(r.partId)}</dd>
      <dt>점검 완료</dt><dd>${formatHistoryTime(r.completedAt)}<br><span class="note">사용자 기기 보고 시각 · 서버 시계가 아님</span></dd>
      <dt>서버 수락</dt><dd>${formatHistoryTime(r.acceptedAt)}</dd>
      <dt>데이터 출처</dt><dd>${esc(r.source)} · 스마트폰 자가 점검</dd>
      <dt>SDK 관측</dt><dd>포함하지 않음 · Pleos 실시간 상태와 별개</dd></dl>
    <h3>점검 상세 설명</h3><p>${esc(detailDescription(r,t))}</p>
    <h3>질문별 사용자 응답</h3>${answers}
    <details class="history-original"><summary>원본 기록·무결성 정보</summary>
      <dl class="tire-status"><dt>recordId</dt><dd>${esc(r.recordId)}</dd><dt>inspectionId</dt><dd>${esc(r.inspectionId)}</dd><dt>schema</dt><dd>v${esc(r.schemaVersion)}</dd>
        <dt>digest</dt><dd>${esc(r.resultDigest)}</dd><dt>서버 수신</dt><dd>${formatHistoryTime(r.receivedAt)}</dd><dt>기록 저장</dt><dd>${formatHistoryTime(r.createdAt)}</dd>
        <dt>원본 시작 (ISO)</dt><dd>${esc(o.startedAt)}</dd><dt>원본 완료 (ISO)</dt><dd>${esc(o.completedAt)}</dd><dt>소유 근거</dt><dd>${esc(r.ownershipEvidence)} · 세션 생성 시점 바인딩</dd></dl>
      <pre>${esc(JSON.stringify(o,null,2))}</pre></details>`)}${historySessionZoneHtml(sessionRow)}`;
}
export function historyPanelHtml(state,snapshot,sessionRow){
  if(state.name==='HISTORY_DETAIL')return `<div class="eyebrow">차량 점검 · 저장된 과거 기록</div><h2>점검 기록 상세</h2>
    <div id="historyResults" tabindex="-1">${historyDetailResultsHtml(snapshot,sessionRow)}</div>
    <div class="actions"><button type="button" class="secondary" data-action="back">기록 목록으로</button></div>`;
  return `<div class="eyebrow">차량 점검 · 저장된 과거 기록</div><h2>과거 점검 기록</h2>
    <p class="note">완료 시각 최신순 · 저장된 사용자 보고만 표시합니다. 현재 세션이나 SDK 관측과 합치지 않습니다.</p>
    ${historyFilterHtml(snapshot)}<div id="historyResults" tabindex="-1">${historyListResultsHtml(snapshot,sessionRow)}</div>
    <div class="actions"><button type="button" class="secondary" data-action="back">이전 화면으로</button></div>`;
}
