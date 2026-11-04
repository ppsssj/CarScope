import {MOBILE_TARGETS,mobileReportState} from './mobile-result-contract.mjs';
import {inspectionStateMap,INSPECTION_STATES} from './inspection-state-map.mjs';
// Only the private controller snapshot supplies mobile records in the actual page.
// This pure projection is presentation, not an alternate receiver or validation entry point.
export function projectInspectionResults(local,mobile){
  const locals=inspectionStateMap(local),sameSession=mobile?.localSessionId===local?.sessionId;
  return Object.freeze(MOBILE_TARGETS.map(t=>{
    const own=locals.find(r=>r.partId===t.partId);
    const candidates=sameSession?mobile.records.filter(r=>r.taskId===t.taskId):[];
    const accepted=candidates.find(r=>r.inspectionId===mobile.selected[t.taskId]);
    const status=accepted?mobileReportState(accepted.result):own?.status??'NOT_INSPECTED';
    return Object.freeze({...t,status,...INSPECTION_STATES[status],partLabel:t.label,
      draft:!accepted&&!!own?.draft,source:accepted?'MOBILE':own?.source??null,
      confirmation:accepted?'USER_REPORTED':own?.source??null,
      origin:accepted?'MOBILE_RECEIVER':own?.origin??null,
      completedAt:accepted?accepted.result.completedAt:own?.completedAt??null,
      responses:accepted?accepted.result.responses??Object.freeze({}):own?.responses??Object.freeze({}),
      original:accepted?.result??null,proof:accepted?.proof??null,
      inspectionId:accepted?.inspectionId??null,resultDigest:accepted?.resultDigest??null,
      bindingId:accepted?.bindingId??null,syncSessionId:accepted?.syncSessionId??null,
      candidates:Object.freeze(candidates),local:own??null,
    });
  }));
}
export function resultCounts(rows){const out=Object.fromEntries(Object.keys(INSPECTION_STATES).map(s=>[s,0]));for(const r of rows)out[r.status]++;return Object.freeze(out);}
