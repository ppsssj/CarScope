// P13-A: what an AI may say about the look of one bonnet part, in which shape, and what is refused. Pure data and rules, shared by the
// page, the server and every provider. The model's free text is never the result: only a result that passes validateAnalysisResult is.
// Nothing here is a vehicle safety verdict. NO_VISIBLE_ISSUE_DETECTED means "nothing seen in this photo", not "the part is fine".
import { CROP_DEFAULTS } from './context-crop.mjs';
import { offersDetection, PART_DETECTION } from './part-detection.mjs';
import { aiSupport } from './part-capabilities.mjs';

export const ANALYSIS_CONSENT = 'external-vision-v1';
export const PROMPT_VERSION = 'p13-a-1';
// P13-G: the exterior profiles are new prompt texts, so their answers carry their own version. The six bonnet prompts are unchanged (tested).
export const EXTERIOR_PROMPT_VERSION = 'p13-g-1';
const BONNET_SCENE = "in a car's bonnet area";
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

// The status comes from part-capabilities.mjs; a profile keeps the prompt, the limits and the evidence.
const profile = (partId, fields = {}) => Object.freeze({ partId, status: aiSupport(partId).analysis, scene: fields.scene ?? BONNET_SCENE, promptVersion: fields.promptVersion ?? PROMPT_VERSION, positionNote: fields.positionNote ?? null, label: fields.label ?? partId, crop: Object.freeze({ ...CROP_DEFAULTS, ...fields.crop }), identify: fields.identify ?? '', check: Object.freeze(fields.check ?? []), never: Object.freeze(fields.never ?? []), issues: Object.freeze(fields.issues ?? []), claims: fields.claims ?? null, reason: fields.reason ?? '' });
export const ANALYSIS_PROFILES = Object.freeze({
  'washer-fluid-cap': profile('washer-fluid-cap', {
    label: '워셔액 주입구',
    // A cap is small: P12-F boxes were about 1.6 times the cap. More surroundings than the default, so the neck and the area around it show.
    crop: { margin: 0.8, minShortSideFraction: 0.35 },
    identify: 'the windshield washer fluid filler cap and its filler neck. It usually carries a windshield or spray symbol, and is often blue or black. Do not confuse it with the coolant cap, the radiator cap, the brake fluid cap or the engine oil cap.',
    check: ['whether the cap looks seated and closed', 'whether the cap appears to be missing or the filler opening is exposed', 'visible cracks or breaks on the cap or the filler neck'],
    never: ['the washer fluid level or quantity (the tank is usually not visible from the cap)', 'whether the washer pump or nozzles work'],
    issues: ['CAP_MISSING_SUSPECTED', 'CAP_OPEN_SUSPECTED', 'CAP_OR_NECK_DAMAGE_SUSPECTED'],
    reason: 'First analysis profile. P13-B real smoke: 4 calls on 2 photos, schema 4/4; accuracy not established (INSUFFICIENT_SAMPLE).',
  }),
  // P13-D: the other five bonnet parts. EXPERIMENTAL for analysis means "offered, labelled as an experiment, never evaluated on real photos".
  // It says nothing about detection: battery-12v and lcw-coolant-reservoir stay UNSUPPORTED in PART_DETECTION and are analysed from a region
  // the person marks (ANALYSIS_SUPPORT below).
  'coolant-reservoir': profile('coolant-reservoir', {
    label: '냉각수 리저버',
    crop: { margin: 0.4 },
    identify: 'the engine (normal) coolant expansion reservoir. Electrified cars may also have a separate low-conductivity coolant reservoir that looks similar. If no printed label or marking shows which reservoir this is, and a low-conductivity reservoir could exist on this car, set partMatch to UNCERTAIN.',
    check: ['whether this is the coolant reservoir', 'whether the MIN and MAX marks are visible and readable', 'whether the liquid surface is clearly visible', 'only if both the surface and MIN are clearly visible, whether the surface looks below MIN', 'clearly visible cracks, breaks, or traces that look like leaks or stains around the reservoir and hoses'],
    never: ['a level that is not visible (never call a hidden level normal)', 'whether this is the same as a low-conductivity coolant reservoir without a label that says so', 'whether the cooling system works, or coolant quality, concentration or temperature'],
    issues: ['LEVEL_BELOW_MIN_SUSPECTED', 'LEAK_TRACE_SUSPECTED', 'RESERVOIR_DAMAGE_SUSPECTED'],
    claims: /(냉각\s*(계통|시스템|성능))[이은가는]?\s*(정상|양호|문제\s*없)|농도[가는이은]?\s*(\d|적정|정상|충분)/,
    reason: 'P13-D: offered as an experiment. MOCK tests only, no real photo evaluated. Normal and low-conductivity coolant can be confused (P12-F).',
  }),
  'brake-fluid-reservoir': profile('brake-fluid-reservoir', {
    label: '브레이크액 리저버',
    crop: { margin: 0.5 },
    identify: 'the brake fluid reservoir, usually translucent with MIN and MAX marks and a cap with a brake symbol. Do not confuse it with clutch or power steering reservoirs.',
    check: ['whether this is the brake fluid reservoir', 'whether the liquid surface and the MIN and MAX marks are clearly visible', 'only if both are clearly visible, whether the surface looks below MIN', 'clearly visible cracks, breaks or traces that look like leaks around the reservoir'],
    never: ['braking performance, or whether the brakes or the car are safe to drive', 'brake fluid quality, colour meaning or water content'],
    issues: ['LEVEL_BELOW_MIN_SUSPECTED', 'LEAK_TRACE_SUSPECTED', 'RESERVOIR_DAMAGE_SUSPECTED'],
    claims: /제동\s*(성능|력|장치)[이은가는]?\s*(정상|양호|충분|문제\s*없)|수분\s*함량[이은]?\s*\d|(브레이크액|오일)\s*(품질|상태)[이은가는]?\s*(정상|양호|좋)/,
    reason: 'P13-D: offered as an experiment. MOCK tests only, no real photo evaluated. Brake related: judged conservatively.',
  }),
  'fuse-box': profile('fuse-box', {
    label: '퓨즈박스',
    crop: { margin: 0.3 },
    identify: 'the fuse box housing in the bonnet area, usually a black box with a lid, sometimes with a fuse layout printed on the lid. Other electrical boxes look similar: without such a marking, set partMatch to UNCERTAIN.',
    check: ['whether this is the fuse box housing and its cover', 'whether the cover looks present', 'whether the cover looks closed and latched, not lifted or open', 'clearly visible cracks or breaks on the housing or cover'],
    never: ['the state of any fuse or relay inside, which cannot be seen with the cover on', 'whether the electrical system works'],
    issues: ['COVER_MISSING_SUSPECTED', 'COVER_OPEN_SUSPECTED', 'COVER_OR_HOUSING_DAMAGE_SUSPECTED'],
    claims: /퓨즈[가는이은]?\s*(정상|모두\s*정상|끊어지지\s*않)|전기\s*(계통|장치)[이은가는]?\s*(정상|양호|문제\s*없)/,
    reason: 'P13-D: offered as an experiment. MOCK tests only, no real photo evaluated. Only 3 labelled photos in P12-F.',
  }),
  'battery-12v': profile('battery-12v', {
    label: '12V 보조 배터리',
    crop: { margin: 0.25, minShortSideFraction: 0.35 },
    identify: 'the 12V auxiliary (low-voltage) battery. Electrified cars also have high-voltage parts, with orange cables and high-voltage warning labels: these are never the 12V battery. If a label or the terminals do not show it is the 12V battery, set partMatch to UNCERTAIN. A person marked this region; no detector proposed it.',
    check: ['whether it can be confirmed as the 12V auxiliary battery', 'clearly visible cracks, bulges or breaks of the battery case', 'clearly visible liquid traces that look like leaks', 'only where the terminals are clearly visible, white or green deposits that look like corrosion'],
    never: ['state of charge, voltage, capacity, health or remaining life', 'anything about the high-voltage battery or high-voltage system', 'any handling: removing the battery, touching or loosening terminals, jump starting or charging'],
    issues: ['CASE_DAMAGE_SUSPECTED', 'LEAK_TRACE_SUSPECTED', 'TERMINAL_CORROSION_SUSPECTED'],
    claims: /전압[은이가는]?\s*(약\s*)?\d|\d+(\.\d+)?\s*V(?![A-Za-z])\s*(로|으로|입니다|이에요|정도)|충전\s*(상태|량|율)[은이가는]?\s*(\d|충분|양호|정상|낮|높)|수명[이은가는]?\s*(\d|충분|남아|다\s*되)|탈거|단자를\s*(풀|조이|조여|만지|닦)|점프\s*(시동|스타트)/,
    reason: 'P13-D: limited analysis from a marked region. Detection stays UNSUPPORTED (P12-F). MOCK tests only. A mix-up with high-voltage parts matters most here.',
  }),
  'lcw-coolant-reservoir': profile('lcw-coolant-reservoir', {
    label: '저전도 냉각수 리저버',
    crop: { margin: 0.4 },
    identify: 'the low-conductivity coolant reservoir of an electrified car. Identify it only from a printed label or marking that says so; never from colour, shape or position. Without such a label, set partMatch to UNCERTAIN. A person marked this region; no detector proposed it.',
    check: ['whether a label or marking identifies it as the low-conductivity coolant reservoir', 'whether the MIN and MAX marks and the liquid surface are clearly visible', 'only if both are clearly visible, whether the surface looks below MIN', 'clearly visible cracks, breaks or traces that look like leaks'],
    never: ['telling it apart from the normal coolant reservoir without a label', 'the liquid composition, concentration or electrical conductivity', 'any refill, top-up or maintenance step'],
    issues: ['LEVEL_BELOW_MIN_SUSPECTED', 'LEAK_TRACE_SUSPECTED', 'RESERVOIR_DAMAGE_SUSPECTED'],
    claims: /전도도[가는이은]?\s*(\d|낮|높|적정|정상)|농도[가는이은]?\s*(\d|적정|정상|충분)|성분[이은가는]?\s*(정상|적정)|교체하세요|교환하세요/,
    reason: 'P13-D: limited analysis from a marked region. Detection stays UNSUPPORTED: the model has no class for it (P12-F). MOCK tests only.',
  }),
  // ---- P13-G: the eleven exterior parts, DRAFT. Written and checked against the contract and MOCK answers only; never evaluated on a real
  // photo, so no host offers them unless its operator approved drafts. None has a detector: the person marks the region (ANALYSIS_SUPPORT).
  // The photo cannot show which wheel, side or lamp function it is: the person chose that. A profile never confirms it from the picture.
  ...Object.fromEntries(['front-left', 'front-right', 'rear-left', 'rear-right'].map(wheel => [`tire.${wheel}`, profile(`tire.${wheel}`, {
    label: `${{ 'front-left': '앞 왼쪽', 'front-right': '앞 오른쪽', 'rear-left': '뒤 왼쪽', 'rear-right': '뒤 오른쪽' }[wheel]} 타이어`,
    scene: 'on the outside of a car (a tyre on a wheel)', promptVersion: EXTERIOR_PROMPT_VERSION,
    positionNote: '사진으로는 어느 바퀴인지 확인하지 않아요. 고른 바퀴가 맞는지 직접 확인해 주세요.',
    crop: { margin: 0.3 },
    identify: 'a car tyre: its visible sidewall and, where visible, its tread surface. The photo cannot show which wheel of the car this is; the person chose the wheel. Never confirm or deny the wheel position from the photo. If the region does not clearly show a tyre, set partMatch to UNCERTAIN. A person marked this region; no detector proposed it.',
    check: ['clearly visible cracks in the sidewall rubber', 'clearly visible cuts, tears, bulges or other damage on the visible rubber', 'clearly visible foreign objects stuck in or on the visible surface, such as nails, screws or stones'],
    never: ['tyre pressure or inflation, from the shape or anything else', 'tread depth in any number or unit, or whether the tread is within a legal or recommended wear limit', 'remaining life, age, replacement timing or whether a replacement is needed', 'whether the car is safe to drive', 'removing an object, touching the tyre, or driving to test it'],
    issues: ['SIDEWALL_CRACK_SUSPECTED', 'TIRE_DAMAGE_SUSPECTED', 'FOREIGN_OBJECT_SUSPECTED'],
    claims: /공기압|타이어\s*압력|\d+(\.\d+)?\s*(psi|kpa|bar|mm)(?![a-z])|트레드\s*(깊이)?[가는이은]?\s*(약\s*)?\d|마모\s*(한계|기준)[를을에]?\s*(넘|초과|미달|이내|안)|법적\s*(기준|한계)|수명[이은가는]?\s*(\d|충분|남|다\s*되)|교체(가)?\s*(필요\s*없|안\s*해도|시기)|주행\s*(가능|해도|하셔도)|빼\s*(주세요|내세요)|뽑아/i,
    reason: 'P13-G: DRAFT. Exterior profile, marked region only (no detector class). MOCK and contract tests only; no real photo evaluated.',
  })])),
  ...Object.fromEntries(['left', 'right'].map(side => [`wiper.front.${side}`, profile(`wiper.front.${side}`, {
    label: `전면 ${side === 'left' ? '왼쪽' : '오른쪽'} 와이퍼`,
    scene: 'on the outside of a car (a windscreen wiper at rest)', promptVersion: EXTERIOR_PROMPT_VERSION,
    positionNote: '사진으로는 왼쪽·오른쪽 와이퍼를 구별하지 않아요. 고른 쪽이 맞는지 직접 확인해 주세요.',
    crop: { margin: 0.3 },
    identify: 'a front windscreen wiper at rest: its rubber blade and the visible part of its arm. The photo cannot show which side of the car this is; the person chose the side. Never confirm or deny the side from the photo. If the region does not clearly show a wiper, set partMatch to UNCERTAIN. A person marked this region; no detector proposed it.',
    check: ['clearly visible cracks, splits or tears of the rubber blade', 'clearly visible deformation of the blade', 'clearly visible debris on or around the blade', 'clearly visible bends or breaks of the wiper arm'],
    never: ['how well it wipes, from streaks or anything else', 'whether the wiper or its motor works', 'remaining life, replacement timing or interval', 'asking the person to run the wipers, lift the arm or touch the blade'],
    issues: ['BLADE_RUBBER_DAMAGE_SUSPECTED', 'BLADE_DEFORMATION_SUSPECTED', 'DEBRIS_SUSPECTED', 'ARM_DAMAGE_SUSPECTED'],
    claims: /닦임\s*(성능|상태)?[이은가는]?\s*(정상|양호|좋|충분|문제\s*없|나쁘|불량)|(작동|동작)[이은가는]?\s*(정상|양호|불량|잘\s*(돼|됩)|안\s*(돼|됩))|모터|(교체|교환)\s*(시기|주기|필요\s*없|안\s*해도|하세요|해\s*주세요)|수명[이은가는]?\s*(\d|충분|남|다\s*되)|작동시켜|켜\s*(보세요|주세요)|들어\s*올려/,
    reason: 'P13-G: DRAFT. Exterior profile, marked region only (no detector class). MOCK and contract tests only; no real photo evaluated.',
  })])),
  ...Object.fromEntries(['low', 'high'].flatMap(beam => ['left', 'right'].map(side => {
    const id = `light-${beam}-beam-${side}-0`;
    return [id, profile(id, {
      label: `${side === 'left' ? '왼쪽' : '오른쪽'} ${beam === 'low' ? '하향등' : '상향등'}`,
      scene: 'on the outside of a car (a headlamp, switched off)', promptVersion: EXTERIOR_PROMPT_VERSION,
      positionNote: '사진으로는 왼쪽·오른쪽이나 상향등·하향등을 구별하지 않아요. 한 램프 안에 두 기능이 함께 있을 수 있어요. 고른 등이 맞는지 직접 확인해 주세요.',
      crop: { margin: 0.3 },
      identify: `a front headlamp lens and housing, seen from outside. The person chose the ${side} ${beam} beam. Many cars put the low and the high beam in one housing, so the photo usually cannot show which function a lamp area serves, nor which side of the car it is: never confirm or deny the beam function or the side. If the region does not clearly show a headlamp lens, set partMatch to UNCERTAIN and say in limitations that the person should check which lamp they photographed. A person marked this region; no detector proposed it.`,
      check: ['clearly visible cracks or breaks of the outer lens', 'clearly visible dirt, stickers or other things covering the lens', 'clearly visible damage to the lamp housing', 'only if clearly visible through the lens, water drops or pooled moisture inside'],
      never: ['whether the lamp lights up, or whether it is switched on in the photo', 'brightness, light output or beam aim', 'whether this area is the low or the high beam, or the left or the right lamp', 'whether the electrical system works', 'asking the person to switch the lamps on or to open, clean or dry the lamp'],
      issues: ['LENS_CRACK_SUSPECTED', 'LENS_OBSTRUCTION_SUSPECTED', 'LAMP_HOUSING_DAMAGE_SUSPECTED', 'MOISTURE_SUSPECTED'],
      claims: /(점등|불이\s*(들어|켜)|켜져\s*있|켜진\s*상태)|밝기[가는이은]?\s*(\d|충분|정상|적정|양호|약)|광량|광축|조사\s*각|(상향등|하향등)(입니다|이에요|이네요|으로\s*(보입|확인)|이\s*맞)|전기\s*(계통|장치)[이은가는]?\s*(정상|양호|문제\s*없)|켜\s*(보세요|주세요)|닦아|청소(하|해)/,
      reason: 'P13-G: DRAFT. Exterior profile, marked region only (no detector class). MOCK and contract tests only; no real photo evaluated. Low and high beam often share a housing.',
    })];
  }))),
  'ev-charge.port': profile('ev-charge.port', {
    label: 'EV 충전구',
    scene: 'on the outside of an electric car (the charging port area)', promptVersion: EXTERIOR_PROMPT_VERSION,
    crop: { margin: 0.5 },
    identify: 'the charging port of an electric car and its flap, seen from outside, with no cable plugged in. If the region does not clearly show a charging port or its flap, set partMatch to UNCERTAIN. A person marked this region; no detector proposed it.',
    check: ['clearly visible damage around the port opening or its surround', 'clearly visible debris in or around the port, seen from outside', 'clearly visible damage to the flap', 'clearly visible dirt or contamination around the port'],
    never: ['whether the car can charge', 'high-voltage safety, insulation or any electrical state', 'the condition of the pins or contacts inside', 'heat or burning from colour alone', 'asking the person to touch, clean, blow into or put anything into the port'],
    issues: ['PORT_AREA_DAMAGE_SUSPECTED', 'DEBRIS_SUSPECTED', 'FLAP_DAMAGE_SUSPECTED', 'CONTAMINATION_SUSPECTED'],
    claims: /충전(이|은|을)?\s*(가능|할\s*수\s*있|돼요|됩니다|문제\s*없)|절연|고전압[^.。!?]{0,12}(정상|안전|양호|문제\s*없)|(접점|단자|핀)[^.。!?]{0,8}(정상|양호|깨끗|문제\s*없)|(단자|접점|핀|충전구|내부)[를을]?\s*(닦|청소|만지|불어)|닦아\s*(주세요|보세요)|청소(하세요|해\s*주세요)/,
    reason: 'P13-G: DRAFT. Exterior profile, marked region only (no detector class). MOCK and contract tests only; no real photo evaluated.',
  }),
});
/** Korean names of the issue codes, for the page. Every code a profile allows has one (tested). */
export const ISSUE_LABELS = Object.freeze({
  CAP_MISSING_SUSPECTED: '캡이 없어 보임', CAP_OPEN_SUSPECTED: '캡이 열려 보임', CAP_OR_NECK_DAMAGE_SUSPECTED: '캡·주입구 손상 의심',
  LEVEL_BELOW_MIN_SUSPECTED: '액면이 MIN 아래로 보임', LEAK_TRACE_SUSPECTED: '누출 흔적 의심', RESERVOIR_DAMAGE_SUSPECTED: '리저버 손상 의심',
  COVER_MISSING_SUSPECTED: '덮개가 없어 보임', COVER_OPEN_SUSPECTED: '덮개가 열려 보임', COVER_OR_HOUSING_DAMAGE_SUSPECTED: '덮개·하우징 손상 의심',
  CASE_DAMAGE_SUSPECTED: '배터리 케이스 손상 의심', TERMINAL_CORROSION_SUSPECTED: '단자 부식 의심',
  // P13-G
  SIDEWALL_CRACK_SUSPECTED: '타이어 옆면 균열 의심', TIRE_DAMAGE_SUSPECTED: '타이어 외관 손상 의심', FOREIGN_OBJECT_SUSPECTED: '박힌 이물질 의심',
  BLADE_RUBBER_DAMAGE_SUSPECTED: '와이퍼 고무 손상 의심', BLADE_DEFORMATION_SUSPECTED: '와이퍼 블레이드 변형 의심', DEBRIS_SUSPECTED: '이물질 의심', ARM_DAMAGE_SUSPECTED: '와이퍼 암 손상 의심',
  LENS_CRACK_SUSPECTED: '렌즈 균열 의심', LENS_OBSTRUCTION_SUSPECTED: '렌즈 가림 의심', LAMP_HOUSING_DAMAGE_SUSPECTED: '램프 하우징 손상 의심', MOISTURE_SUSPECTED: '렌즈 안쪽 물기 의심',
  PORT_AREA_DAMAGE_SUSPECTED: '충전구 주변 손상 의심', FLAP_DAMAGE_SUSPECTED: '충전구 덮개 손상 의심', CONTAMINATION_SUSPECTED: '충전구 주변 오염 의심',
});
export const analysisProfile = partId => (Object.hasOwn(ANALYSIS_PROFILES, partId) ? ANALYSIS_PROFILES[partId] : null);
/** EXPERIMENTAL profiles are offered wherever analysis is on. A DRAFT profile only where the host's operator approved drafts (allowDraft). */
export const offersAnalysis = (partId, { allowDraft = false } = {}) => {
  const status = analysisProfile(partId)?.status;
  return status === PROFILE_STATUS.EXPERIMENTAL || allowDraft === true && status === PROFILE_STATUS.DRAFT;
};
/**
 * P13-D: how each part may reach an analysis. Kept apart from detection: offersDetection() says whether the hosted detector may propose a region,
 * offersAnalysis() whether the vision service may look at one. A part without detection is analysed only from a region the person marks.
 *   regionModes: which region sources the page may offer and the server accepts. limited: no detector, so identification rests on the photo.
 *   evidence: what has been run, as a fixed sentence for the page and the docs. No part has an accuracy figure.
 */
export const ANALYSIS_SUPPORT = Object.freeze(Object.fromEntries(Object.values(ANALYSIS_PROFILES).map(p => {
  const detects = offersDetection(PART_DETECTION[p.partId]);
  return [p.partId, Object.freeze({
    partId: p.partId, status: p.status, offered: p.status === PROFILE_STATUS.EXPERIMENTAL, draft: p.status === PROFILE_STATUS.DRAFT,
    regionModes: Object.freeze(detects ? ['AI_CANDIDATE', 'MANUAL'] : ['MANUAL']), limited: !detects,
    evidence: p.partId === 'washer-fluid-cap' ? 'REAL_SMOKE_4_CALLS_NO_ACCURACY' : p.status === PROFILE_STATUS.DRAFT ? 'DRAFT_MOCK_ONLY' : 'MOCK_ONLY',
  })];
})));
export const regionAllowed = (partId, regionSource, { allowDraft = false } = {}) => Boolean(offersAnalysis(partId, { allowDraft }) && ANALYSIS_SUPPORT[partId].regionModes.includes(regionSource));

// ---- What is sent to a provider. The same text and schema for every provider, so they can be compared.
// The first rule names where the part is. For the six bonnet profiles it is word for word the P13-A text.
const rulesFor = p => [`You look at one photo of one part ${p.scene}. A person chose the part and the region. You describe only what is visible.`, ...RULES];
const RULES = [
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
    ...rulesFor(p),
    `Requested part (partId "${partId}"): ${p.identify}`,
    `Look for: ${p.check.join('; ')}.`,
    `Never judge: ${p.never.join('; ')}.`,
    `Allowed suspected issue codes: ${p.issues.join(', ')}.`,
  ].join('\n');
  const where = targetInCrop.map(n => n.toFixed(3)).join(', ');
  const userText = `${regionSource === REGION_SOURCE.MANUAL ? 'A person marked' : 'An object detector proposed, and a person chose,'} the region of the part. It is around the box [left, top, width, height] = [${where}] as fractions of this image, origin top left. The rest of the image is surrounding context. Analyse the requested part.`;
  return { instructions, userText, schema: analysisJsonSchema(partId), promptVersion: p.promptVersion };
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
  // Claims this part may never make (voltage, charge, conductivity, braking performance, inner fuses...). Refused, never repaired.
  if (p.claims && all.some(t => p.claims.test(t))) return no('FORBIDDEN_CLAIM');
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
