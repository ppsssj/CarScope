// P13-G: the eleven exterior analysis profiles (tyres, wipers, headlamps, charge port). DRAFT: contract and MOCK checks only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ANALYSIS_PROFILES, ANALYSIS_SUPPORT, EXTERIOR_PROMPT_VERSION, PROMPT_VERSION, PROFILE_STATUS, analysisJsonSchema, buildAnalysisPrompt,
  offersAnalysis, regionAllowed, validateAnalysisResult } from '../public/part-analysis.mjs';
import { PART_DETECTION, offersDetection } from '../public/part-detection.mjs';
import { aiSupport, partIdForTask, SUPPORT } from '../public/part-capabilities.mjs';
import { mockAnswer } from '../../vision-poc/src/mock-vision-provider.mjs';

const TIRES = ['tire.front-left', 'tire.front-right', 'tire.rear-left', 'tire.rear-right'];
const WIPERS = ['wiper.front.left', 'wiper.front.right'];
const LAMPS = ['light-low-beam-left-0', 'light-low-beam-right-0', 'light-high-beam-left-0', 'light-high-beam-right-0'];
const CHARGE = ['ev-charge.port'];
const EXTERIOR = [...TIRES, ...WIPERS, ...LAMPS, ...CHARGE];

// sha256 of JSON.stringify(buildAnalysisPrompt(id, { targetInCrop: [0.25, 0.25, 0.5, 0.5], regionSource })) taken on main 7da3568, before P13-G.
const BONNET_PROMPTS = {
  'washer-fluid-cap:MANUAL': '4a5da68aa84fe5c6efe16e20eeb4b3d534a0ef16cbf52ef8b75c7d45f3fd75f8',
  'washer-fluid-cap:AI_CANDIDATE': '59434ac146a04dcdaf479077c67a5e331a3dc58433b3d5450a854b38d7ebf031',
  'coolant-reservoir:MANUAL': 'ed8ed16d36b543e8c75039205a2f50734a44440fbe4b98b896446b983891a3b7',
  'coolant-reservoir:AI_CANDIDATE': 'ad801186dd92d90163ca8f7d4b9caf8871b4a281d10fd29652c996ba054a3a5e',
  'brake-fluid-reservoir:MANUAL': '65ea80f3fb38c17a10a0211387af333e2e93d63fefde0080985fd381be61c4fb',
  'brake-fluid-reservoir:AI_CANDIDATE': 'e7fbe37a9dfa2dbf8216eb4d5cbb360df78693dec1ae5bc3db33390a0ee27bfa',
  'fuse-box:MANUAL': '32812cefdf5bc7bc9e04a3cd3542958a508d16079911c59507ad60dd957383d7',
  'fuse-box:AI_CANDIDATE': 'eeb04f7a7e35b6b288236ec0c2630b89dbda9a3bdf8ec35a47006ef24d16ce18',
  'battery-12v:MANUAL': '34d3e0ae5a93274f1823670c3071a45ff7ac3830222768e28e7ff218ecd61bd6',
  'lcw-coolant-reservoir:MANUAL': '364cd00bb105f7f042dd0ec2e0616f20bbc87ff06200e235d335772999e26bdd',
};

test('the six bonnet prompts are byte for byte the ones the P13 smoke and tests used', () => {
  for (const [key, hash] of Object.entries(BONNET_PROMPTS)) {
    const [id, regionSource] = key.split(':');
    const prompt = buildAnalysisPrompt(id, { targetInCrop: [0.25, 0.25, 0.5, 0.5], regionSource });
    assert.equal(createHash('sha256').update(JSON.stringify(prompt)).digest('hex'), hash, key);
    assert.equal(prompt.promptVersion, PROMPT_VERSION, key);
  }
});

test('each exterior part: DRAFT everywhere, its own task, no detector, a marked region only, and only with the host\'s approval', () => {
  assert.equal(EXTERIOR.length, 11);
  for (const id of EXTERIOR) {
    const p = ANALYSIS_PROFILES[id], row = PART_DETECTION[id];
    assert.equal(p.status, PROFILE_STATUS.DRAFT, id); assert.equal(aiSupport(id).analysis, SUPPORT.DRAFT, id);
    assert.equal(ANALYSIS_SUPPORT[id].draft, true, id); assert.equal(ANALYSIS_SUPPORT[id].offered, false, id); assert.equal(ANALYSIS_SUPPORT[id].evidence, 'DRAFT_MOCK_ONLY', id);
    assert.equal(row.modelClass, null, `${id}: no class is substituted`); assert.equal(offersDetection(row), false, id);
    assert.equal(partIdForTask(row.taskId), id, id); assert.equal(row.taskId, id, `${id}: its task id is its part id`);
    assert.equal(offersAnalysis(id), false, `${id}: not offered without approval`); assert.equal(offersAnalysis(id, { allowDraft: true }), true, id);
    assert.equal(regionAllowed(id, 'MANUAL', { allowDraft: true }), true, id); assert.equal(regionAllowed(id, 'AI_CANDIDATE', { allowDraft: true }), false, `${id}: a detector region is refused`);
    assert.equal(p.promptVersion, EXTERIOR_PROMPT_VERSION, id); assert.match(p.reason, /DRAFT/, id); assert.doesNotMatch(p.reason, /VERIFIED/);
  }
});

test('each exterior prompt names the outside of the car, its own part, what it may look for, and what it may never judge', () => {
  const never = {
    tire: [/tyre pressure/, /tread depth/, /legal or recommended wear limit/, /remaining life/, /safe to drive/],
    wiper: [/how well it wipes/, /motor works/, /replacement timing/, /run the wipers/],
    lamp: [/lights up/, /brightness, light output or beam aim/, /low or the high beam/, /electrical system/],
    charge: [/can charge/, /high-voltage safety, insulation/, /pins or contacts inside/, /touch, clean/],
  };
  const kind = id => (TIRES.includes(id) ? 'tire' : WIPERS.includes(id) ? 'wiper' : LAMPS.includes(id) ? 'lamp' : 'charge');
  for (const id of EXTERIOR) {
    const { instructions, userText, schema, promptVersion } = buildAnalysisPrompt(id, { targetInCrop: [0.2, 0.2, 0.5, 0.5], regionSource: 'MANUAL' });
    assert.match(instructions.split('\n')[0], /on the outside of (a|an electric) car/, id); assert.doesNotMatch(instructions, /bonnet area/, id);
    assert.match(instructions, new RegExp(`partId "${id.replace(/[.]/g, '\\.')}"`), id);
    assert.match(instructions, /A person marked this region; no detector proposed it/, id);
    assert.match(instructions, /set partMatch to UNCERTAIN/, id);
    for (const rule of never[kind(id)]) assert.match(instructions, rule, `${id} never ${rule}`);
    assert.match(userText, /A person marked/, id); assert.equal(promptVersion, EXTERIOR_PROMPT_VERSION);
    assert.deepEqual(schema.properties.partId.enum, [id]);
    assert.deepEqual(schema.properties.suspectedIssues.items.properties.code.enum, [...ANALYSIS_PROFILES[id].issues]);
  }
  for (const id of LAMPS) assert.match(ANALYSIS_PROFILES[id].identify, /never confirm or deny the beam function or the side/, `${id}: one housing may hold both beams`);
  for (const id of TIRES) assert.match(ANALYSIS_PROFILES[id].identify, /Never confirm or deny the wheel position/, id);
});

const answer = (id, fields) => ({ ...mockAnswer(id, 'no-visible-issue'), ...fields });
test('forbidden claims are refused per part, and plain visible observations are not', () => {
  const refused = {
    tire: ['공기압이 낮아 보입니다.', '트레드 깊이는 약 3mm로 보입니다.', '마모 한계를 넘지 않았습니다.', '교체가 필요 없어 보입니다.', '주행 가능해 보입니다.', '수명이 충분히 남아 보입니다.', '박힌 못을 빼 주세요.', '2.5 bar 정도로 보입니다.'],
    wiper: ['닦임 성능은 양호합니다.', '와이퍼 작동은 정상으로 보입니다.', '모터 소리가 날 수 있습니다.', '교체 시기가 된 것으로 보입니다.', '와이퍼를 작동시켜 확인해 보세요.', '와이퍼 암을 들어 올려 확인해 보세요.'],
    lamp: ['전조등이 점등되어 있습니다.', '불이 켜져 있는 상태입니다.', '밝기가 충분해 보입니다.', '광축이 맞아 보입니다.', '이 부분은 하향등입니다.', '전조등을 켜 보세요.', '렌즈를 닦아 주세요.'],
    charge: ['충전이 가능해 보입니다.', '절연 상태는 확인할 수 없습니다.', '고전압 상태는 안전해 보입니다.', '단자는 깨끗해 보입니다.', '충전구 내부를 청소해 주세요.', '핀이 정상으로 보입니다.'],
  };
  const allowed = {
    tire: ['옆면 고무에 가는 균열이 보입니다.', '접지면에 금속 물체가 박혀 보입니다.', '옆면 일부가 부풀어 보입니다.'],
    wiper: ['고무 날 끝이 갈라져 보입니다.', '블레이드 위에 낙엽이 붙어 있습니다.', '와이퍼 암이 휘어 보입니다.'],
    lamp: ['렌즈 오른쪽 위에 금이 보입니다.', '렌즈 일부를 스티커가 가리고 있습니다.', '렌즈 안쪽 아래에 물방울이 맺혀 보입니다.'],
    charge: ['덮개 가장자리에 긁힌 자국이 보입니다.', '충전구 입구 주변에 흙이 묻어 보입니다.', '바깥에서 보이는 입구에 작은 돌이 보입니다.'],
  };
  const ids = { tire: TIRES, wiper: WIPERS, lamp: LAMPS, charge: CHARGE };
  for (const [kind, list] of Object.entries(ids)) for (const id of list) {
    for (const text of refused[kind]) {
      const r = validateAnalysisResult(id, answer(id, { observations: [text] }));
      assert.equal(r.ok, false, `${id} must refuse: ${text}`); assert.match(r.reason, /FORBIDDEN_(CLAIM|TEXT)/, `${id}: ${text}`);
      const asLimit = validateAnalysisResult(id, answer(id, { partMatch: 'UNCERTAIN', assessment: 'INDETERMINATE', limitations: [text] }));
      assert.equal(asLimit.ok, false, `${id} refuses it in limitations too: ${text}`);
    }
    for (const text of allowed[kind]) assert.equal(validateAnalysisResult(id, answer(id, { observations: [text] })).ok, true, `${id} must allow: ${text}`);
  }
});

test('the contract rules hold for every exterior part: uncertain means indeterminate, issues need codes of this part, retakes need words', () => {
  for (const id of EXTERIOR) {
    for (const scenario of ['no-visible-issue', 'suspected', 'indeterminate', 'wrong-part']) assert.equal(validateAnalysisResult(id, mockAnswer(id, scenario)).ok, true, `${id} ${scenario}`);
    for (const [scenario, reason] of [['claims-safe', 'FORBIDDEN_TEXT'], ['extra-key', 'KEYS'], ['not-json', 'NOT_OBJECT']]) assert.equal(validateAnalysisResult(id, mockAnswer(id, scenario)).reason, reason, `${id} ${scenario}`);
    assert.equal(validateAnalysisResult(id, answer(id, { partMatch: 'UNCERTAIN' })).reason, 'UNCERTAIN_JUDGED', `${id}: an unsure part is never judged`);
    assert.equal(validateAnalysisResult(id, answer(id, { partId: 'washer-fluid-cap' })).reason, 'PART_ID', id);
    const other = id === 'ev-charge.port' ? 'SIDEWALL_CRACK_SUSPECTED' : 'PORT_AREA_DAMAGE_SUSPECTED';
    assert.equal(validateAnalysisResult(id, answer(id, { assessment: 'SUSPECTED_ISSUE', suspectedIssues: [{ code: other, description: '의심되는 부분이 있습니다.', evidence: '표시한 영역에 자국이 보입니다.' }] })).reason, 'ISSUE_CODE', `${id}: another part's code is refused`);
    assert.equal(validateAnalysisResult(id, answer(id, { retakeRequired: true })).reason, 'RETAKE_INSTRUCTIONS', id);
    assert.equal(validateAnalysisResult(id, answer(id, { partMatch: 'UNCERTAIN', assessment: 'INDETERMINATE', limitations: [] })).reason, 'INDETERMINATE_WITHOUT_REASON', id);
    assert.equal(analysisJsonSchema(id).properties.requiresUserConfirmation.type, 'boolean');
  }
  const r = validateAnalysisResult('light-high-beam-left-0', mockAnswer('light-high-beam-left-0', 'indeterminate'));
  assert.equal(r.ok, true); assert.equal(r.result.retakeRequired, true); assert.ok(r.result.retakeInstructions.length);
});
