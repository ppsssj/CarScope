// P13-A: what an AI may say about the look of one bonnet part, in which shape, and what is refused. Pure data and rules, shared by the
// page, the server and every provider. The model's free text is never the result: only a result that passes validateAnalysisResult is.
// Nothing here is a vehicle safety verdict. NO_VISIBLE_ISSUE_DETECTED means "nothing seen in this photo", not "the part is fine".
import { CROP_DEFAULTS } from './context-crop.mjs';

export const ANALYSIS_CONSENT = 'external-vision-v1';
export const PROMPT_VERSION = 'p13-a-1';
export const ASSESSMENT = Object.freeze({
  NO_VISIBLE_ISSUE_DETECTED: 'NO_VISIBLE_ISSUE_DETECTED', SUSPECTED_ISSUE: 'SUSPECTED_ISSUE', INDETERMINATE: 'INDETERMINATE',
  WRONG_PART: 'WRONG_PART', UNSUPPORTED: 'UNSUPPORTED',
});
export const PART_MATCH = Object.freeze({ LIKELY_MATCH: 'LIKELY_MATCH', UNCERTAIN: 'UNCERTAIN', NOT_MATCH: 'NOT_MATCH' });
/** EXPERIMENTAL: offered behind the flag. DRAFT: written and checked for shape, never offered, no evidence. UNSUPPORTED: none. */
export const PROFILE_STATUS = Object.freeze({ EXPERIMENTAL: 'EXPERIMENTAL', DRAFT: 'DRAFT', UNSUPPORTED: 'UNSUPPORTED' });
export const REGION_SOURCE = Object.freeze({ AI_CANDIDATE: 'AI_CANDIDATE', MANUAL: 'MANUAL' });
/** Which outside service a page names in its consent text, by provider id. Fixed strings: nothing from a request or a variable reaches the page. */
export const ANALYSIS_SERVICES = Object.freeze({ openai: 'OpenAI', mock: '로컬 시험용 MOCK' });
export const RESULT_LIMITS = Object.freeze({ textChars: 200, items: 5 });
// UNSUPPORTED is the server's answer for a part with no profile. A model may not choose it.
const MODEL_ASSESSMENTS = Object.freeze([ASSESSMENT.NO_VISIBLE_ISSUE_DETECTED, ASSESSMENT.SUSPECTED_ISSUE, ASSESSMENT.INDETERMINATE, ASSESSMENT.WRONG_PART]);

const profile = (partId, status, fields = {}) => Object.freeze({ partId, status, label: fields.label ?? partId, crop: Object.freeze({ ...CROP_DEFAULTS, ...fields.crop }), identify: fields.identify ?? '', check: Object.freeze(fields.check ?? []), never: Object.freeze(fields.never ?? []), issues: Object.freeze(fields.issues ?? []), reason: fields.reason ?? '' });
export const ANALYSIS_PROFILES = Object.freeze({
  'washer-fluid-cap': profile('washer-fluid-cap', PROFILE_STATUS.EXPERIMENTAL, {
    label: '워셔액 주입구',
    // A cap is small: P12-F boxes were about 1.6 times the cap. More surroundings than the default, so the neck and the area around it show.
    crop: { margin: 0.8, minShortSideFraction: 0.35 },
    identify: 'the windshield washer fluid filler cap and its filler neck. It usually carries a windshield or spray symbol, and is often blue or black. Do not confuse it with the coolant cap, the radiator cap, the brake fluid cap or the engine oil cap.',
    check: ['whether the cap looks seated and closed', 'whether the cap appears to be missing or the filler opening is exposed', 'visible cracks or breaks on the cap or the filler neck'],
    never: ['the washer fluid level or quantity (the tank is usually not visible from the cap)', 'whether the washer pump or nozzles work'],
    issues: ['CAP_MISSING_SUSPECTED', 'CAP_OPEN_SUSPECTED', 'CAP_OR_NECK_DAMAGE_SUSPECTED'],
    reason: 'First analysis profile. Shape and refusal rules tested with a MOCK provider only. No real image analysis was run, so accuracy is unknown.',
  }),
  'coolant-reservoir': profile('coolant-reservoir', PROFILE_STATUS.DRAFT, {
    label: '냉각수 리저버',
    crop: { margin: 0.4 },
    identify: 'the engine coolant expansion reservoir. Electrified cars may also have a separate low-conductivity coolant reservoir that looks similar. If you cannot tell which one this is from a printed label, the part match is UNCERTAIN.',
    check: ['whether the liquid surface is clearly visible', 'whether MIN and MAX marks are visible and readable', 'if both are clearly visible, whether the surface looks below MIN', 'visible traces that look like leaks or stains around the reservoir and hoses'],
    never: ['coolant quality, concentration or temperature', 'the cooling system as a whole'],
    issues: ['LEVEL_BELOW_MIN_SUSPECTED', 'LEAK_TRACE_SUSPECTED', 'RESERVOIR_DAMAGE_SUSPECTED'],
    reason: 'Draft only: not offered, not evaluated. Normal and low-conductivity coolant can be confused (P12-F).',
  }),
  'brake-fluid-reservoir': profile('brake-fluid-reservoir', PROFILE_STATUS.DRAFT, {
    label: '브레이크액 리저버',
    crop: { margin: 0.5 },
    identify: 'the brake fluid reservoir, usually translucent with MIN and MAX marks and a cap with a brake symbol. Do not confuse it with clutch or power steering reservoirs.',
    check: ['whether the liquid surface and the MIN and MAX marks are clearly visible', 'if both are clearly visible, whether the surface looks below MIN', 'visible traces that look like leaks around the reservoir'],
    never: ['braking performance or whether the brakes are safe', 'brake fluid quality or water content'],
    issues: ['LEVEL_BELOW_MIN_SUSPECTED', 'LEAK_TRACE_SUSPECTED', 'RESERVOIR_DAMAGE_SUSPECTED'],
    reason: 'Draft only: not offered, not evaluated. Brake related, so it must stay conservative.',
  }),
  'fuse-box': profile('fuse-box', PROFILE_STATUS.DRAFT, {
    label: '퓨즈박스',
    crop: { margin: 0.3 },
    identify: 'the fuse box housing in the bonnet area, usually a black box with a lid. Other electrical boxes look similar.',
    check: ['whether the lid looks present and closed', 'visible cracks or damage on the housing or lid'],
    never: ['the state of any fuse or relay inside', 'anything about the electrical system'],
    issues: ['COVER_MISSING_SUSPECTED', 'COVER_DAMAGE_SUSPECTED'],
    reason: 'Draft only: not offered, not evaluated. Only 3 labelled photos in P12-F.',
  }),
  'battery-12v': profile('battery-12v', PROFILE_STATUS.UNSUPPORTED, { label: '12V 보조 배터리', reason: 'Detection is UNSUPPORTED (P12-F). A mix-up with high voltage parts matters most here.' }),
  'lcw-coolant-reservoir': profile('lcw-coolant-reservoir', PROFILE_STATUS.UNSUPPORTED, { label: '저전도 냉각수 리저버', reason: 'Detection is UNSUPPORTED: the model has no class for it (P12-F).' }),
});
/** Korean names of the issue codes, for the page. Every code a profile allows has one (tested). */
export const ISSUE_LABELS = Object.freeze({
  CAP_MISSING_SUSPECTED: '캡이 없어 보임', CAP_OPEN_SUSPECTED: '캡이 열려 보임', CAP_OR_NECK_DAMAGE_SUSPECTED: '캡·주입구 손상 의심',
  LEVEL_BELOW_MIN_SUSPECTED: '액면이 MIN 아래로 보임', LEAK_TRACE_SUSPECTED: '누출 흔적 의심', RESERVOIR_DAMAGE_SUSPECTED: '리저버 손상 의심',
  COVER_MISSING_SUSPECTED: '덮개가 없어 보임', COVER_DAMAGE_SUSPECTED: '덮개 손상 의심',
});
export const analysisProfile = partId => (Object.hasOwn(ANALYSIS_PROFILES, partId) ? ANALYSIS_PROFILES[partId] : null);
export const offersAnalysis = partId => analysisProfile(partId)?.status === PROFILE_STATUS.EXPERIMENTAL;

// ---- What is sent to a provider. The same text and schema for every provider, so they can be compared.
const RULES = [
  'You look at one photo of one part in a car\'s bonnet area. A person chose the part and the region. You describe only what is visible.',
  'Never state that the car, the part or any system is normal, safe, fine or OK to drive. NO_VISIBLE_ISSUE_DETECTED only means you saw no sign of the listed issues in this photo.',
  'Judge nothing that is not visible in this photo. Do not guess about hidden areas.',
  'If you are not sure the photo shows the requested part, set partMatch to UNCERTAIN and assessment to INDETERMINATE. If it clearly shows a different part, set partMatch to NOT_MATCH and assessment to WRONG_PART.',
  'Report a suspected issue only with a concrete visible evidence in this photo. Never invent an issue.',
  'If the photo does not let you judge (blur, glare, darkness, the part cut off, marks unreadable), use INDETERMINATE and explain each reason in limitations.',
  'Never tell the person to open a cap, touch, remove, refill or take apart anything. Retake instructions only describe how to take a better photo.',
  'Write observations, descriptions, evidence, limitations and retake instructions in Korean, each at most 200 characters, at most 5 items per list.',
  'requiresUserConfirmation is always true.',
];
export function buildAnalysisPrompt(partId, { targetInCrop, regionSource }) {
  const p = analysisProfile(partId);
  if (!p || p.status === PROFILE_STATUS.UNSUPPORTED) throw new Error('PART_ANALYSIS_UNSUPPORTED');
  const instructions = [
    ...RULES,
    `Requested part (partId "${partId}"): ${p.identify}`,
    `Look for: ${p.check.join('; ')}.`,
    `Never judge: ${p.never.join('; ')}.`,
    `Allowed suspected issue codes: ${p.issues.join(', ')}.`,
  ].join('\n');
  const where = targetInCrop.map(n => n.toFixed(3)).join(', ');
  const userText = `${regionSource === REGION_SOURCE.MANUAL ? 'A person marked' : 'An object detector proposed, and a person chose,'} the region of the part. It is around the box [left, top, width, height] = [${where}] as fractions of this image, origin top left. The rest of the image is surrounding context. Analyse the requested part.`;
  return { instructions, userText, schema: analysisJsonSchema(partId), promptVersion: PROMPT_VERSION };
}

const text = { type: 'string' };
const list = (items, max = RESULT_LIMITS.items) => ({ type: 'array', items, maxItems: max });
/** Strict JSON schema: every key required, no other keys. Lengths are not in it (not confirmed for strict mode) and are checked here instead. */
export function analysisJsonSchema(partId) {
  const p = analysisProfile(partId);
  if (!p) throw new Error('PART_ANALYSIS_UNSUPPORTED');
  const issue = { type: 'object', additionalProperties: false, required: ['code', 'description', 'evidence'], properties: { code: { type: 'string', enum: [...p.issues] }, description: text, evidence: text } };
  return {
    type: 'object', additionalProperties: false,
    required: ['partId', 'partMatch', 'assessment', 'observations', 'suspectedIssues', 'limitations', 'retakeRequired', 'retakeInstructions', 'requiresUserConfirmation'],
    properties: {
      partId: { type: 'string', enum: [partId] },
      partMatch: { type: 'string', enum: Object.values(PART_MATCH) },
      assessment: { type: 'string', enum: MODEL_ASSESSMENTS },
      observations: list(text), suspectedIssues: list(issue), limitations: list(text),
      retakeRequired: { type: 'boolean' }, retakeInstructions: list(text),
      requiresUserConfirmation: { type: 'boolean' },
    },
  };
}

// ---- Checking what comes back. Anything unexpected is refused as a whole, never repaired.
// Claims about the whole car or its safety, and invitations to handle the part. The UI copy rules of P12-E apply to model text too.
export const FORBIDDEN_TEXT = /정상입니다|정상이에요|안전합니다|안전해요|문제(가)? ?없습니다|문제없어요|(운행|주행|운전)(해도|하셔도|하셔도 돼)|safe to drive|is safe|열어 ?(주세요|보세요|확인)|열고 확인|보충(해|하)|만져|분리해|분해해/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const KEYS = ['partId', 'partMatch', 'assessment', 'observations', 'suspectedIssues', 'limitations', 'retakeRequired', 'retakeInstructions', 'requiresUserConfirmation'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const goodText = v => typeof v === 'string' && v.trim().length > 0 && v.length <= RESULT_LIMITS.textChars && !CONTROL.test(v);

/** { ok: true, result } with a frozen copy, or { ok: false, reason }. A reason is a code for logs and tests, never shown as text. */
export function validateAnalysisResult(partId, value) {
  const p = analysisProfile(partId);
  const no = reason => ({ ok: false, reason });
  if (!p || p.status === PROFILE_STATUS.UNSUPPORTED) return no('PART_UNSUPPORTED');
  if (!plain(value)) return no('NOT_OBJECT');
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || !KEYS.every(k => Object.hasOwn(value, k))) return no('KEYS');
  const { partMatch, assessment, observations, suspectedIssues, limitations, retakeRequired, retakeInstructions, requiresUserConfirmation } = value;
  if (value.partId !== partId) return no('PART_ID');
  if (!Object.values(PART_MATCH).includes(partMatch)) return no('PART_MATCH');
  if (!MODEL_ASSESSMENTS.includes(assessment)) return no('ASSESSMENT');
  for (const items of [observations, suspectedIssues, limitations, retakeInstructions]) if (!Array.isArray(items) || items.length > RESULT_LIMITS.items) return no('LIST');
  if (![...observations, ...limitations, ...retakeInstructions].every(goodText)) return no('TEXT');
  for (const issue of suspectedIssues) {
    if (!plain(issue) || Object.keys(issue).sort().join() !== 'code,description,evidence') return no('ISSUE_KEYS');
    if (!p.issues.includes(issue.code)) return no('ISSUE_CODE');
    if (!goodText(issue.description) || !goodText(issue.evidence)) return no('TEXT');
  }
  if (typeof retakeRequired !== 'boolean') return no('RETAKE');
  if (requiresUserConfirmation !== true) return no('CONFIRMATION');
  // The rules the instructions state, enforced rather than trusted.
  if (!observations.length) return no('NO_OBSERVATION');
  if ((partMatch === PART_MATCH.NOT_MATCH) !== (assessment === ASSESSMENT.WRONG_PART)) return no('MATCH_ASSESSMENT');
  if (partMatch === PART_MATCH.UNCERTAIN && assessment !== ASSESSMENT.INDETERMINATE) return no('UNCERTAIN_JUDGED');
  if ((assessment === ASSESSMENT.SUSPECTED_ISSUE) !== (suspectedIssues.length > 0)) return no('ISSUES_ASSESSMENT');
  if (assessment === ASSESSMENT.INDETERMINATE && !limitations.length) return no('INDETERMINATE_WITHOUT_REASON');
  if (retakeRequired !== (retakeInstructions.length > 0)) return no('RETAKE_INSTRUCTIONS');
  const all = [...observations, ...limitations, ...retakeInstructions, ...suspectedIssues.flatMap(i => [i.description, i.evidence])];
  if (all.some(t => FORBIDDEN_TEXT.test(t))) return no('FORBIDDEN_TEXT');
  const freeze = items => Object.freeze(items.map(i => (typeof i === 'string' ? i : Object.freeze({ code: i.code, description: i.description, evidence: i.evidence }))));
  return { ok: true, result: Object.freeze({ partId, partMatch, assessment, observations: freeze(observations), suspectedIssues: freeze(suspectedIssues), limitations: freeze(limitations), retakeRequired, retakeInstructions: freeze(retakeInstructions), requiresUserConfirmation: true }) };
}

/** The server's own answer for a part without a profile. Not from a model. */
export const unsupportedResult = partId => Object.freeze({ partId, partMatch: PART_MATCH.UNCERTAIN, assessment: ASSESSMENT.UNSUPPORTED, observations: Object.freeze([]), suspectedIssues: Object.freeze([]), limitations: Object.freeze(['이 부품은 AI 상태 분석을 지원하지 않아요.']), retakeRequired: false, retakeInstructions: Object.freeze([]), requiresUserConfirmation: true });

// ---- The page's states after a part was located (or not). Choosing a region and analysing it are separate steps.
// A late answer, from before a cancel, a new region or a new photo, is dropped by its attempt number.
export const APHASE = Object.freeze({ IDLE: 'IDLE', REGION: 'REGION', PREVIEW: 'PREVIEW', ANALYZING: 'ANALYZING', RESULT: 'RESULT', FAILED: 'FAILED' });
const idle = attempt => Object.freeze({ phase: APHASE.IDLE, attempt, manual: false, region: null, cropReady: false, consented: false, result: null, meta: null, code: null, acknowledged: false });
export const initialAnalysis = () => idle(0);
export function reduceAnalysis(state, event) {
  const to = patch => Object.freeze({ ...state, ...patch });
  const choose = region => to({ phase: APHASE.PREVIEW, attempt: state.attempt + 1, manual: false, region: Object.freeze(region), cropReady: false, consented: false, result: null, meta: null, code: null, acknowledged: false });
  const choosing = [APHASE.REGION, APHASE.PREVIEW, APHASE.RESULT, APHASE.FAILED].includes(state.phase);
  switch (event.type) {
    case 'START': return state.phase === APHASE.IDLE ? to({ phase: APHASE.REGION, attempt: state.attempt + 1, manual: Boolean(event.manual) }) : state;
    case 'MANUAL': return choosing ? to({ phase: APHASE.REGION, attempt: state.attempt + 1, manual: true, region: null, cropReady: false, consented: false, result: null, code: null }) : state;
    case 'SELECT_CANDIDATE': return choosing && Number.isInteger(event.index) ? choose({ source: REGION_SOURCE.AI_CANDIDATE, index: event.index, box: event.box }) : state;
    case 'MANUAL_PICK': return choosing && state.manual ? choose({ source: REGION_SOURCE.MANUAL, index: null, box: event.box }) : state;
    case 'CROPPED': return state.phase === APHASE.PREVIEW && event.attempt === state.attempt ? to({ cropReady: event.ok === true, code: event.ok ? null : 'CROP_FAILED' }) : state;
    case 'CONSENT': return state.phase === APHASE.PREVIEW ? to({ consented: event.value === true }) : state;
    case 'ANALYZE': return state.phase === APHASE.PREVIEW && state.consented && state.cropReady ? to({ phase: APHASE.ANALYZING, attempt: state.attempt + 1, code: null }) : state;
    case 'ANSWER': return state.phase === APHASE.ANALYZING && event.attempt === state.attempt ? to({ phase: APHASE.RESULT, result: event.result, meta: event.meta ?? null }) : state;
    case 'FAIL': return state.phase === APHASE.ANALYZING && event.attempt === state.attempt ? to({ phase: APHASE.FAILED, code: event.code }) : state;
    // A cancel needs a new consent: that one covered the send that was cancelled.
    case 'CANCEL': return state.phase === APHASE.ANALYZING ? to({ phase: APHASE.PREVIEW, attempt: state.attempt + 1, consented: false, cropReady: true }) : state;
    case 'RETRY': return state.phase === APHASE.FAILED && state.region ? to({ phase: APHASE.PREVIEW, consented: false, code: null }) : state;
    case 'ACKNOWLEDGE': return state.phase === APHASE.RESULT ? to({ acknowledged: event.value === true }) : state;
    case 'RESET': return idle(state.attempt + 1);
    default: return state;
  }
}
