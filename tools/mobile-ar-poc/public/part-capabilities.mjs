// P11 (PR #121): the one statement of which inspection methods each part has, read by the phone page and the vehicle's 3D page.
// Pure data with no imports, so every host serves it: it says what a part supports, never that a service is on.
// part-detection.mjs (PART_DETECTION) and part-analysis.mjs (ANALYSIS_PROFILES) take their status from PART_AI_SUPPORT below;
// they keep the model class, the prompt and the evidence. Whether this host's server offers the AI at all is a separate input (`host`),
// which only the phone page has: its own server marks the page (data-part-detection / data-part-analysis). The vehicle never guesses it.

export const SUPPORT = Object.freeze({ EXPERIMENTAL: 'EXPERIMENTAL', UNSUPPORTED: 'UNSUPPORTED' });
const ai = (detection, analysis) => Object.freeze({ detection, analysis });
const { EXPERIMENTAL: X, UNSUPPORTED: U } = SUPPORT;
/** Per part: may the hosted detector propose its place, may the vision service describe its look. Parts not listed have neither. */
export const PART_AI_SUPPORT = Object.freeze({
  'washer-fluid-cap': ai(X, X),
  'coolant-reservoir': ai(X, X),
  'brake-fluid-reservoir': ai(X, X),
  'fuse-box': ai(X, X),
  // No detector class for these two (P12-F): the person marks the part on the photo, then only that region is analysed.
  'battery-12v': ai(U, X),
  'lcw-coolant-reservoir': ai(U, X),
});
export const aiSupport = partId => (Object.hasOwn(PART_AI_SUPPORT, partId) ? PART_AI_SUPPORT[partId] : ai(U, U));

/** The phone task ids name a part by its task. Only two differ; the same pair is in the vehicle's result contract and Native bridge. */
const TASK_PART = Object.freeze({ 'washer-fluid': 'washer-fluid-cap', 'brake-fluid': 'brake-fluid-reservoir' });
export const partIdForTask = taskId => (Object.hasOwn(TASK_PART, taskId) ? TASK_PART[taskId] : taskId);

/** What a part offers by itself, before any server is asked. */
export const PLAN = Object.freeze({
  DETECT_AND_ANALYZE: 'DETECT_AND_ANALYZE', // AI finds candidate places, the person picks one, AI describes its look
  MARK_AND_ANALYZE: 'MARK_AND_ANALYZE',     // the person marks the part on a photo, AI describes that region
  DETECT_ONLY: 'DETECT_ONLY',               // AI finds candidate places only
  MANUAL_ONLY: 'MANUAL_ONLY',               // the phone checklist only
  INFO_ONLY: 'INFO_ONLY',                   // no inspection task: picture guide and 3D view only
});
/** Whether the AI part of a plan can be started here and now. */
export const AI_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',             // this server offers it and this page is connected to the vehicle
  SERVER_DISABLED: 'SERVER_DISABLED', // the part supports it, this server does not offer it
  NOT_CONNECTED: 'NOT_CONNECTED',     // the part supports it, but this page was not opened from the vehicle's QR
  UNSUPPORTED: 'UNSUPPORTED',         // the part has no AI method
  UNKNOWN: 'UNKNOWN',                 // the part supports it; this screen cannot know the phone's server (the vehicle)
});

function planOf(detects, analyses) {
  if (detects && analyses) return PLAN.DETECT_AND_ANALYZE;
  if (analyses) return PLAN.MARK_AND_ANALYZE;
  if (detects) return PLAN.DETECT_ONLY;
  return PLAN.MANUAL_ONLY;
}

/**
 * The methods of one part.
 * @param partId the 3D / contract part id
 * @param taskId its phone task, or null for a part with no inspection (EV battery pack, charge flap)
 * @param host null on the vehicle. On the phone: { connected, detection, analysis } as this page's own server marked it.
 *   connected: the page has the vehicle's detector channel (a QR inspection). The same rule as offerPartDetection().
 */
export function partCapabilities(partId, { taskId = null, host = null } = {}) {
  const s = aiSupport(partId), detects = s.detection === X, analyses = s.analysis === X;
  const partPlan = taskId ? planOf(detects, analyses) : PLAN.INFO_ONLY;
  const supportsAi = partPlan !== PLAN.MANUAL_ONLY && partPlan !== PLAN.INFO_ONLY;
  let offered = PLAN.MANUAL_ONLY, aiState = supportsAi ? AI_STATE.UNKNOWN : AI_STATE.UNSUPPORTED;
  if (!taskId) offered = PLAN.INFO_ONLY;
  else if (supportsAi && host) {
    // Mirrors offerPartDetection/mountPartDetection: detection where the server offers it and the part has a class,
    // otherwise a marked region where the server offers analysis and the part has a profile.
    const detect = detects && host.detection === true, analyze = analyses && host.analysis === true;
    offered = !host.connected ? PLAN.MANUAL_ONLY : detect ? (analyze ? PLAN.DETECT_AND_ANALYZE : PLAN.DETECT_ONLY) : analyze ? PLAN.MARK_AND_ANALYZE : PLAN.MANUAL_ONLY;
    aiState = !host.connected ? AI_STATE.NOT_CONNECTED : offered === PLAN.MANUAL_ONLY ? AI_STATE.SERVER_DISABLED : AI_STATE.AVAILABLE;
  }
  return Object.freeze({
    partId, taskId,
    manualChecklist: Boolean(taskId), // the phone's own checklist: never depends on AI or on a server switch
    detection: s.detection, regionMarking: analyses ? X : U, analysis: s.analysis,
    partPlan, offered, ai: aiState, experimental: supportsAi,
  });
}

// ---- Words. Plain sentences only: no enum, environment variable or provider internals reach a driver.
export const METHOD_LABELS = Object.freeze({
  manual: '직접 점검하기',
  analyze: 'AI로 외관 살펴보기 · 실험',
  mark: '사진에서 부품 직접 지정하기',
  detectOnly: 'AI로 부품 위치 찾기 · 실험',
});
const AI_NOTE = Object.freeze({
  [AI_STATE.SERVER_DISABLED]: '이 부품은 AI 외관 분석(실험)을 지원하지만, 지금 연결된 서비스에서는 사용할 수 없어요.',
  [AI_STATE.NOT_CONNECTED]: 'AI 외관 분석(실험)은 차량 화면의 QR로 연결한 점검에서만 쓸 수 있어요.',
  [AI_STATE.UNSUPPORTED]: '현재 AI 외관 분석은 지원하지 않습니다.',
  [AI_STATE.UNKNOWN]: '사용할 수 있는지는 스마트폰 화면에 표시돼요.',
});
/** One sentence about the AI of a part, for the state it is in. */
export function aiNote(cap) {
  if (cap.ai !== AI_STATE.AVAILABLE) return AI_NOTE[cap.ai];
  if (cap.offered === PLAN.MARK_AND_ANALYZE) return '자동으로 위치를 찾지 않아요. 사진에서 부품을 직접 지정하면 그 부분의 겉모습만 AI가 살펴봐요.';
  if (cap.offered === PLAN.DETECT_ONLY) return 'AI가 사진에서 부품 위치 후보만 표시해요. 상태 분석은 하지 않아요.';
  return 'AI가 사진에서 부품 후보를 찾고, 고른 부분의 겉모습만 살펴봐요.';
}
/** The vehicle's short line for a part: what the phone can do with it. Never "available": the vehicle cannot know. */
export function partMethodSummary(cap) {
  if (cap.partPlan === PLAN.INFO_ONLY) return '따로 점검 기록이 없는 부품입니다. 그림 안내와 3D 형상만 제공합니다.';
  if (cap.partPlan === PLAN.MANUAL_ONLY) return '스마트폰에서 직접 점검할 수 있어요. 현재 AI 외관 분석은 지원하지 않습니다.';
  const how = cap.partPlan === PLAN.MARK_AND_ANALYZE ? '사진에서 부품을 직접 지정한 뒤 AI 외관 분석(실험)' : cap.partPlan === PLAN.DETECT_ONLY ? 'AI 위치 찾기(실험)' : 'AI 위치 찾기와 외관 분석(실험)';
  return `스마트폰에서 직접 점검할 수 있어요. ${how}도 지원하지만, 사용할 수 있는지는 연결된 서비스에 따라 스마트폰 화면에 표시돼요.`;
}
