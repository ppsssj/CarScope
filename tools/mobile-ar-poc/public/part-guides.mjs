// P12-A: what the phone shows to help someone find a part. Pure data and rules: no DOM, network or storage.
// partId is the ID in tools/three-poc/inspection-parts.mjs, and part-guide.test.mjs holds the two together. Add a part here and
// the same screen shows it. A part with no entry keeps its text-only location help.
//
// An image is shown only if its own record passes imageProblems: a photo with no known vehicle or no right to use it is treated as
// absent. Each image carries its own imageSource and licenseStatus because the two pictures of a guide can differ.
export const IMAGE_KIND = Object.freeze({ PHOTO: 'PHOTO', SCHEMATIC: 'SCHEMATIC' });
export const LICENSE = Object.freeze({
  CARSCOPE_ORIGINAL: 'CARSCOPE_ORIGINAL', // Drawn for this project.
  LICENSED: 'LICENSED',                   // A licence that allows this use, recorded in imageSource.
  PERMISSION_GRANTED: 'PERMISSION_GRANTED', // Written permission from the owner, recorded in imageSource.
  UNVERIFIED: 'UNVERIFIED',               // Never shown.
});
const USABLE = new Set([LICENSE.CARSCOPE_ORIGINAL, LICENSE.LICENSED, LICENSE.PERMISSION_GRANTED]);
// A local file name only. The page's CSP allows no other image source, and a remote photo could not be accounted for.
const LOCAL_FILE = /^[a-z0-9][a-z0-9-]*\.(svg|webp|jpe?g|png)$/;

export function imageProblems(image) {
  const problems = [];
  if (!image || typeof image !== 'object') return ['MISSING'];
  if (!LOCAL_FILE.test(image.file ?? '')) problems.push('FILE_NOT_LOCAL');
  if (!Object.values(IMAGE_KIND).includes(image.kind)) problems.push('KIND');
  if (!image.alt) problems.push('ALT');
  if (!image.caption) problems.push('CAPTION');
  if (!image.imageSource) problems.push('SOURCE');
  if (!USABLE.has(image.licenseStatus)) problems.push('LICENSE');
  if (image.kind === IMAGE_KIND.PHOTO) {
    const v = image.vehicle;
    if (!v?.make || !v?.model || !v?.year) problems.push('VEHICLE');
    if (image.licenseStatus === LICENSE.CARSCOPE_ORIGINAL) problems.push('PHOTO_LICENSE'); // A photo says whose it is.
  } else if (image.vehicle) problems.push('SCHEMATIC_HAS_VEHICLE'); // A drawing must not look like a given car.
  return problems;
}
export const usableImage = image => (imageProblems(image).length ? null : image);

export function guideProblems(guide) {
  const problems = [];
  for (const key of ['partId', 'taskId', 'title', 'role', 'area', 'photoStatus']) if (!guide?.[key]) problems.push(key.toUpperCase());
  if (!Array.isArray(guide?.identifyingFeatures) || !guide.identifyingFeatures.length) problems.push('FEATURES');
  if (!Array.isArray(guide?.safetyNotes) || !guide.safetyNotes.length) problems.push('SAFETY');
  if (!guide?.vehicleApplicability?.scope || !guide.vehicleApplicability.text) problems.push('APPLICABILITY');
  for (const key of ['overviewImage', 'detailImage']) if (guide?.[key] != null && imageProblems(guide[key]).length) problems.push(`${key}:${imageProblems(guide[key]).join('+')}`);
  const m = guide?.manualReference;
  if (m != null && (!m.label || !m.applicability || !/^https:\/\//.test(m.url ?? ''))) problems.push('MANUAL');
  return problems;
}

const DRAWN = 'CarScope에서 직접 그린 설명용 그림';
export const PART_GUIDES = Object.freeze({
  'washer-fluid-cap': Object.freeze({
    partId: 'washer-fluid-cap',
    taskId: 'washer-fluid',
    title: '워셔액 주입구',
    role: '앞유리를 닦는 워셔액을 넣는 입구예요.',
    area: '보닛 안쪽',
    overviewImage: Object.freeze({
      file: 'guide-washer-area.svg', kind: IMAGE_KIND.SCHEMATIC,
      alt: '위에서 본 차 그림. 차 앞쪽의 보닛 영역 전체가 강조되어 있고, 정확한 지점은 표시하지 않았습니다.',
      caption: '찾아볼 영역: 보닛 안쪽. 정확한 자리는 차마다 달라요.',
      imageSource: DRAWN, licenseStatus: LICENSE.CARSCOPE_ORIGINAL,
    }),
    detailImage: Object.freeze({
      file: 'guide-washer-mark.svg', kind: IMAGE_KIND.SCHEMATIC,
      alt: '둥근 캡 그림. 캡 위에 앞유리 모양과 그 위로 뿜어지는 물줄기 모양의 표시가 있습니다.',
      caption: '찾아볼 표시: 앞유리와 물줄기 모양. 실제 모양은 차마다 달라요.',
      imageSource: DRAWN, licenseStatus: LICENSE.CARSCOPE_ORIGINAL,
    }),
    identifyingFeatures: Object.freeze([
      '캡에서 앞유리·분사 모양 표시를 직접 찾아 주세요.',
      '색만 보고 고르지 마세요. 파란 캡이라고 모두 워셔액은 아니에요.',
      '냉각수·브레이크액 주입구와 헷갈릴 수 있어요. 표시가 보이지 않으면 워셔액으로 단정하지 마세요.',
    ]),
    safetyNotes: Object.freeze([
      '안전한 곳에 세우고 전원을 끈 뒤, 설명서에 따라 보닛을 열어 주세요.',
      '움직이는 부품, 뜨거운 부품, 주황색 고전압 케이블에 손대지 마세요.',
      '위치가 확실하지 않으면 캡을 열거나 액체를 넣지 마세요.',
    ]),
    vehicleApplicability: Object.freeze({
      scope: 'ANY_VEHICLE',
      text: '특정 차종의 위치를 보여 주지 않아요. 내 차의 정확한 위치는 내 차 설명서로 확인해 주세요.',
    }),
    manualReference: Object.freeze({
      label: 'Hyundai IONIQ 5 (2022, 영국판) 정비 설명서 PDF',
      url: 'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf',
      applicability: '참고 자료예요. 내 차가 이 차종·연식·판매 지역이 아니면 내 차의 설명서를 봐 주세요.',
    }),
    photoStatus: 'PHOTO_NEEDED', // Both real photos are still to be obtained. See docs/p12-a-part-photo-guide.md.
  }),
});

export const guideForTask = taskId => Object.values(PART_GUIDES).find(guide => guide.taskId === taskId) ?? null;
