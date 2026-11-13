// P16: the 3D page shows one community-asset reference model. A user's registered vehicle is compared with it by name
// only, to say how far apart they are. The result never claims that the 3D model is the user's car: even a same-name
// match is "the same model name as the reference", not "your vehicle".

export const REFERENCE_MODEL = Object.freeze({
  manufacturer: '현대',
  model: 'IONIQ 5',
  modelYear: 2022,
  // Must stay identical to the header text of tools/three-poc/inspect.html (checked by test/integration.test.mjs).
  label: '2022 IONIQ 5 참조 모델',
});

export const MODEL_MATCH = Object.freeze({ SAME_MODEL_NAME: 'SAME_MODEL_NAME', DIFFERENT_MODEL: 'DIFFERENT_MODEL' });

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-_·.]/g, '');
const MAKERS = new Set(['현대', '현대자동차', 'hyundai', 'hyundaimotor', 'hyundaimotorcompany']);
const MODELS = new Set(['ioniq5', '아이오닉5']);

/**
 * Conservative: anything not recognisably "Hyundai IONIQ 5" is DIFFERENT_MODEL (an IONIQ 5 N, a typo, another maker).
 * @param {{manufacturer: string, model: string, modelYear: number|null}} vehicle
 */
export function compareWithReference(vehicle) {
  const same = MAKERS.has(norm(vehicle?.manufacturer)) && MODELS.has(norm(vehicle?.model));
  if (!same) return Object.freeze({ match: MODEL_MATCH.DIFFERENT_MODEL, yearDiffers: false });
  const year = vehicle.modelYear;
  return Object.freeze({ match: MODEL_MATCH.SAME_MODEL_NAME, yearDiffers: Number.isInteger(year) && year !== REFERENCE_MODEL.modelYear });
}

/** Sentences for the card and the 3D banner. `short` is the one-word chip, always shown with the vehicle. */
export function referenceNotice(vehicle) {
  const c = compareWithReference(vehicle);
  const name = [vehicle.manufacturer, vehicle.model].join(' ');
  if (c.match === MODEL_MATCH.DIFFERENT_MODEL) {
    return Object.freeze({
      match: c.match,
      short: '참조 모델과 다른 차종',
      text: `등록한 차량(${name})과 3D 참조 모델(${REFERENCE_MODEL.label.replace(' 참조 모델', '')})은 다른 차종입니다. 부품 위치와 모양이 실제 차량과 다를 수 있으니 차량 설명서를 함께 확인해 주세요.`,
    });
  }
  return Object.freeze({
    match: c.match,
    short: c.yearDiffers ? '참조 모델과 연식 다름' : '참조 모델과 모델명 같음',
    text: `3D는 ${REFERENCE_MODEL.label}입니다. 모델명이 같아도 내 차량의 실제 형상·옵션·상태를 반영하지 않습니다.`
      + (c.yearDiffers ? ` 등록한 연식(${vehicle.modelYear}년식)과 참조 모델 연식(${REFERENCE_MODEL.modelYear}년식)이 다릅니다.` : ''),
  });
}
