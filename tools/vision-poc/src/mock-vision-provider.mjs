// P13-A: a MOCK vision provider and a fixture detector, for local runs and tests. Neither looks at the picture: what they return says
// nothing about how well any real model sees. They exist to drive the pipeline, the contract and the screens end to end.
import { jpegSize } from '../../inspection-sync-poc/src/part-detection-route.mjs';

const washer = (fields) => ({
  partId: 'washer-fluid-cap', partMatch: 'LIKELY_MATCH', assessment: 'NO_VISIBLE_ISSUE_DETECTED',
  observations: ['파란 캡에 앞유리 분사 모양 표시가 보입니다.'], suspectedIssues: [], limitations: [],
  retakeRequired: false, retakeInstructions: [], requiresUserConfirmation: true, ...fields,
});
/** Fixed answers by name. Each valid one passes the contract; the invalid ones are there to be refused. */
export const MOCK_SCENARIOS = Object.freeze({
  'no-visible-issue': washer({}),
  suspected: washer({ assessment: 'SUSPECTED_ISSUE', observations: ['주입구 둘레가 보입니다.'], suspectedIssues: [{ code: 'CAP_MISSING_SUSPECTED', description: '주입구 위에 캡이 보이지 않습니다.', evidence: '주입구 입구가 그대로 드러나 보입니다.' }], limitations: ['캡이 다른 곳에 걸려 있는지는 사진 범위 밖이라 알 수 없습니다.'] }),
  indeterminate: washer({ partMatch: 'UNCERTAIN', assessment: 'INDETERMINATE', observations: ['둥근 캡 모양이 보이지만 표시는 보이지 않습니다.'], limitations: ['빛 반사 때문에 캡의 표시를 읽을 수 없습니다.'], retakeRequired: true, retakeInstructions: ['캡 윗면의 표시가 보이도록 조금 더 가까이에서 찍어 주세요.'] }),
  'wrong-part': washer({ partMatch: 'NOT_MATCH', assessment: 'WRONG_PART', observations: ['냉각수 표시가 있는 캡으로 보입니다.'] }),
  'claims-safe': washer({ observations: ['캡이 닫혀 있고 차량은 안전합니다.'] }),
  'extra-key': { ...washer({}), confidence: 0.97 },
  'not-json': 'this is not an object',
});

/**
 * @param o.scenario  a key of MOCK_SCENARIOS, or a function (input) => answer
 * @param o.mode      'answer' | 'error' | 'hold' (waits until release() or the abort signal)
 */
export function createMockVisionProvider({ scenario = 'no-visible-issue' } = {}) {
  const calls = [];
  let mode = 'answer', current = scenario, held = [];
  return {
    id: 'mock', model: 'mock-fixture-1', calls,
    set scenario(value) { current = value; }, set mode(value) { mode = value; },
    release() { for (const resolve of held.splice(0)) resolve(); },
    async analyzePart(input, { signal } = {}) {
      calls.push({ partId: input.partId, bytes: input.image.length, imageSize: input.imageSize, targetInCrop: input.targetInCrop, regionSource: input.regionSource, promptVersion: input.promptVersion, aborted: false });
      const call = calls.at(-1);
      signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
      if (mode === 'error') throw new Error('mock upstream failure sk-should-never-leave');
      if (mode === 'hold') await new Promise(resolve => { held.push(resolve); signal?.addEventListener('abort', resolve, { once: true }); });
      const answer = typeof current === 'function' ? current(input) : MOCK_SCENARIOS[current];
      return structuredClone(answer);
    },
  };
}

/**
 * A detector that replays fixed boxes, given as fractions, at whatever size the uploaded picture has. No outside call: the Roboflow
 * ledger stays where P12-F left it. The class names are the real model's, so the existing candidate rules apply unchanged.
 */
export function fixtureDetectionProvider(predictions) {
  return {
    async detect({ image }) {
      const size = jpegSize(image);
      if (!size) throw new Error('fixture: not a JPEG');
      return { imageWidth: size.width, imageHeight: size.height, predictions: predictions.map(({ className, score, box: [l, t, w, h] }) => ({ className, score, x: (l + w / 2) * size.width, y: (t + h / 2) * size.height, width: w * size.width, height: h * size.height })) };
    },
  };
}
