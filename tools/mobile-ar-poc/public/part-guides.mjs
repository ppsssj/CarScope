// P12-A: what the phone shows to help someone find a part. Data and rules: no DOM, network or storage.
import { taskCopy } from './inspection-copy.mjs';
// partId is the ID in tools/three-poc/inspection-parts.mjs, and part-guide.test.mjs holds the two together. Add a part here and
// the same screen shows it. A part with no inspection (taskId null) is read on part-info.html, and gets no task and no result.
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
  for (const key of ['partId', 'title', 'role', 'area', 'photoStatus']) if (!guide?.[key]) problems.push(key.toUpperCase());
  if (guide?.taskId !== null && !guide?.taskId) problems.push('TASKID');
  if (!Array.isArray(guide?.identifyingFeatures) || !guide.identifyingFeatures.length) problems.push('FEATURES');
  if (!Array.isArray(guide?.safetyNotes) || !guide.safetyNotes.length) problems.push('SAFETY');
  if (!guide?.vehicleApplicability?.scope || !guide.vehicleApplicability.text) problems.push('APPLICABILITY');
  for (const key of ['overviewImage', 'detailImage']) if (guide?.[key] != null && imageProblems(guide[key]).length) problems.push(`${key}:${imageProblems(guide[key]).join('+')}`);
  const m = guide?.manualReference;
  if (m != null && (!m.label || !m.applicability || !/^https:\/\//.test(m.url ?? ''))) problems.push('MANUAL');
  return problems;
}

const DRAWN = '직접 그린 설명용 그림';
export const guideSlug = partId => partId.replaceAll('.', '-');
const drawing = (partId, part, alt, caption) => Object.freeze({
  file: `guide-${guideSlug(partId)}-${part}.svg`, kind: IMAGE_KIND.SCHEMATIC, alt, caption, imageSource: DRAWN, licenseStatus: LICENSE.CARSCOPE_ORIGINAL,
});
const SIDE_NOTE = '왼쪽·오른쪽은 차에 앉아 앞을 보는 기준이에요.';
const APPLIES = Object.freeze({
  // Rough zones from one reference manual's layout, as an example only. The vehicle is named solely in the labelled manual link.
  REFERENCE_LAYOUT: Object.freeze({ scope: 'REFERENCE_LAYOUT_EXAMPLE', text: '한 참고 차량의 배치를 단순하게 옮긴 예시예요. 실제 위치는 차종·연식·운전석 방향에 따라 달라요. 내 차 설명서를 먼저 확인해 주세요.' }),
  ANY_VEHICLE: Object.freeze({ scope: 'ANY_VEHICLE', text: '특정 차종의 모습이 아니에요. 내 차의 정확한 위치와 모양은 내 차 설명서로 확인해 주세요.' }),
});
const MANUAL = Object.freeze({
  label: 'Hyundai IONIQ 5 (2022, 영국판) 정비 설명서 PDF',
  url: 'https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf',
  applicability: '참고 자료예요. 내 차가 이 차종·연식·판매 지역이 아니면 내 차의 설명서를 봐 주세요.',
});
// The always-visible safety words of the inspection itself, so the guide cannot drift from them.
const inspectionSafety = (id, kind) => { const copy = taskCopy({ id, kind }); return Object.freeze([...copy.points, ...(copy.stop ? [copy.stop] : [])]); };

function guide({ partId, taskId, title, role, area, features, safety, applies, overview, detail, manual = MANUAL, related = null }) {
  return Object.freeze({
    partId, taskId, title, role, area,
    overviewImage: drawing(partId, 'area', overview[0], overview[1]),
    detailImage: drawing(partId, 'detail', detail[0], detail[1]),
    identifyingFeatures: Object.freeze(features), safetyNotes: safety, vehicleApplicability: applies,
    manualReference: manual, relatedInfo: related, photoStatus: 'SCHEMATIC_ONLY', // The decided final form: see docs/p12-a3-schematic-only.md.
  });
}
const bonnet = ({ partId, taskId = partId, title, role, zone, features, safety, shape, related, dashed = false }) => guide({
  partId, taskId, title, role, area: `보닛 안쪽 · ${zone}`, features, related, applies: APPLIES.REFERENCE_LAYOUT,
  safety: safety ?? inspectionSafety(taskId, 'bonnet'),
  overview: [`왼쪽은 위에서 본 차와 보닛, 오른쪽은 보닛 안을 구역으로 나눈 그림입니다. ${zone} 구역이 ${dashed ? '점선으로 ' : ''}강조되어 있고 다른 부품의 구역은 흐리게 표시했습니다. 실제 부품 위치가 아닌 예시입니다.`, `찾아볼 구역 예시: ${zone}. 실제 자리는 차마다 달라요. ${SIDE_NOTE}`],
  detail: shape,
});

const tire = (side, rear) => {
  const key = `${rear ? 'rear' : 'front'}-${side}`, name = `${rear ? '뒤' : '앞'} ${side === 'left' ? '왼쪽' : '오른쪽'}`;
  return guide({ partId: `tire.${key}`, taskId: `tire.${key}`, title: `${name} 타이어`, role: '도로와 맞닿아 차를 받치는 고무 바퀴예요.', area: `차 바깥 · ${name} 바퀴`, applies: APPLIES.ANY_VEHICLE,
    features: [`차에 앉아 앞을 볼 때 ${name}에 있는 바퀴예요. 차를 마주 보고 서면 좌우가 반대로 보여요.`, '옆면과 보이는 바닥 면을 눈으로만 살펴봐요.', '이 점검은 이 바퀴 하나만 기록해요. 다른 바퀴를 대신하지 않아요.'],
    safety: inspectionSafety(`tire.${key}`),
    overview: [`위에서 본 차 그림. 네 바퀴 중 ${name} 바퀴만 강조되어 있습니다.`, `찾아볼 곳: ${name} 바퀴. ${SIDE_NOTE}`],
    detail: [`옆에서 본 타이어 그림. 옆면과 바닥 면이 강조되어 있고, 작은 차 그림에 ${name} 위치가 표시되어 있습니다.`, '찾아볼 곳: 옆면과 보이는 바닥 면. 실제 모양은 차마다 달라요.'] });
};
const wiper = side => {
  const name = side === 'left' ? '왼쪽' : '오른쪽';
  return guide({ partId: `wiper.front.${side}`, taskId: `wiper.front.${side}`, title: `전면 ${name} 와이퍼`, role: '앞유리의 빗물과 오염을 닦는 부품이에요.', area: `앞유리 아래 · ${name}`, applies: APPLIES.ANY_VEHICLE,
    features: [`차에 앉아 앞을 볼 때 ${name}에 있는 와이퍼예요.`, '유리에 닿는 고무 날과 그것을 잡아 주는 암으로 되어 있어요.', '와이퍼 개수와 모양은 차마다 달라요. 어느 쪽인지 모르겠으면 확인하기 어렵다고 답해 주세요.'],
    safety: inspectionSafety(`wiper.front.${side}`, 'wiper'),
    overview: [`위에서 본 차 그림. 앞유리 아래 와이퍼 두 개 중 ${name} 와이퍼가 강조되어 있습니다.`, `찾아볼 곳: 앞유리 아래 ${name}. ${SIDE_NOTE}`],
    detail: [`앞유리에 놓인 와이퍼 그림. ${name}에서 시작하는 암과 그 끝의 고무 날이 표시되어 있습니다.`, '찾아볼 모양: 고무 날과 암. 멈춘 상태에서 눈으로만 봐요.'] });
};
const lamp = (side, beam) => {
  const name = side === 'left' ? '왼쪽' : '오른쪽', low = beam === 'low', kind = low ? '하향등' : '상향등', id = `light-${beam}-beam-${side}-0`;
  return guide({ partId: id, taskId: id, title: `${name} ${kind}`, role: low ? '앞쪽 가까운 길을 낮게 비추는 등이에요.' : '멀리까지 높게 비추는 등이에요.', area: `차 앞쪽 · ${name} 전조등`, applies: APPLIES.ANY_VEHICLE,
    features: [`차에 앉아 앞을 볼 때 ${name} 앞쪽 모서리의 전조등이에요.`, '하향등과 상향등이 한 램프에 함께 있거나 하나의 광원을 나눠 쓰는 차도 있어요.', '겉에서 구별되지 않으면 확인하기 어렵다고 답해 주세요. 설명서의 등화 배치도를 함께 봐 주세요.'],
    safety: inspectionSafety(id, 'lamp'),
    overview: [`위에서 본 차 그림. 앞쪽 두 모서리의 전조등 중 ${name}이 ${kind} 위치로 강조되어 있습니다. 하향등과 상향등의 내부 배치는 표시하지 않습니다.`, `찾아볼 곳: ${name} 전조등. 램프 안의 배치는 차마다 달라요. ${SIDE_NOTE}`],
    detail: [`${name} 전조등 모양과 ${low ? '아래로 기울어진' : '곧게 뻗은'} 빛줄기 표시 그림. ${kind}을 뜻하는 일반적인 표시이며 실제 램프의 구조가 아닙니다.`, `${kind} 표시 예시예요. 실제 램프 구조가 아니에요.`] });
};
const CHARGE_NOTE = '충전구 위치는 차종마다 크게 달라요.';

export const PART_GUIDES = Object.freeze(Object.fromEntries([
  guide({
    partId: 'washer-fluid-cap', taskId: 'washer-fluid', title: '워셔액 주입구', role: '앞유리를 닦는 워셔액을 넣는 입구예요.', area: '보닛 안쪽 · 오른쪽 바깥 뒤', applies: APPLIES.REFERENCE_LAYOUT,
    features: ['캡에서 앞유리·분사 모양 표시를 직접 찾아 주세요.', '색만 보고 고르지 마세요. 파란 캡이라고 모두 워셔액은 아니에요.', '냉각수·브레이크액 주입구와 헷갈릴 수 있어요. 표시가 보이지 않으면 워셔액으로 단정하지 마세요.'],
    safety: Object.freeze(['안전한 곳에 세우고 전원을 끈 뒤, 설명서에 따라 보닛을 열어 주세요.', '움직이는 부품, 뜨거운 부품, 주황색 고전압 케이블에 손대지 마세요.', '위치가 확실하지 않으면 캡을 열거나 액체를 넣지 마세요.']),
    overview: [`왼쪽은 위에서 본 차와 보닛, 오른쪽은 보닛 안을 구역으로 나눈 그림입니다. 오른쪽 바깥 뒤 구역이 강조되어 있고 다른 부품의 구역은 흐리게 표시했습니다. 실제 부품 위치가 아닌 예시입니다.`, `찾아볼 구역 예시: 오른쪽 바깥 뒤. 실제 자리는 차마다 달라요. ${SIDE_NOTE}`],
    detail: ['둥근 캡 그림. 캡 위에 앞유리 모양과 그 위로 뿜어지는 물줄기 모양의 표시가 있습니다.', '찾아볼 표시: 앞유리와 물줄기 모양. 실제 모양은 차마다 달라요.'],
  }),
  bonnet({ partId: 'coolant-reservoir', title: '냉각수 리저버', role: '차의 열을 식히는 냉각수를 담는 통이에요.', zone: '오른쪽 안쪽 가운데',
    features: ['바깥에서 액면과 F·L 또는 MAX·MIN 표시를 함께 볼 수 있는 통이에요.', '캡에 뜨거움을 경고하는 표시가 있는 차가 많아요. 뜨거울 때 열면 위험해요.', '일반 냉각수와 저전도 냉각수 통을 색만으로 구별하지 마세요.'],
    shape: ['캡이 닫힌 반투명 통 그림. 옆에 F와 L 눈금이 있고 캡에 경고 삼각형이 있습니다. 특정 차량의 형상이 아닙니다.', '찾아볼 모양: 눈금이 있는 통. 실제 모양은 차마다 달라요.'] }),
  bonnet({ partId: 'lcw-coolant-reservoir', title: '저전도 냉각수 리저버', role: '일부 전기차에서 쓰는 저전도 냉각수를 담는 통이에요. 없는 차도 있어요.', zone: '오른쪽 안쪽 앞 (있는 차만)', dashed: true,
    features: ['저전도 냉각수(LCW) 표기가 있는지 먼저 찾아 주세요.', '이 통이 없는 차도 있어요. 찾지 못하면 확인하기 어렵다고 답해 주세요.', '일반 냉각수 통과 색으로 구별하지 마세요. 직접 보충하지 마세요.'],
    shape: ['LCW 글자가 적힌, 캡이 닫힌 통 그림. 옆에 F와 L 눈금이 있습니다. 특정 차량의 형상이 아닙니다.', '찾아볼 표시: LCW. 없는 차도 있어요.'] }),
  bonnet({ partId: 'brake-fluid-reservoir', taskId: 'brake-fluid', title: '브레이크액', role: '제동 힘을 전달하는 브레이크액을 담는 통이에요.', zone: '왼쪽 안쪽 뒤',
    safety: inspectionSafety('brake-fluid'),
    features: ['바깥에서 액면과 MIN·MAX 표시를 함께 볼 수 있는 통이에요.', '워셔액·냉각수 통과 헷갈리지 않도록 설명서의 표기를 대조해 주세요.', '캡을 열어 확인하지 마세요. 바깥에서 보이지 않으면 확인하기 어렵다고 답해 주세요.'],
    shape: ['캡이 닫힌 통 그림. 옆에 MAX와 MIN 눈금이 있습니다. 특정 차량의 형상이 아닙니다.', '찾아볼 표시: MIN·MAX 눈금. 실제 모양은 차마다 달라요.'] }),
  bonnet({ partId: 'battery-12v', title: '12V 보조 배터리', role: '차의 전장품에 쓰는 12V 전기를 담는 보조 배터리예요. 구동용 고전압 배터리와 달라요.', zone: '왼쪽 안쪽 앞', related: Object.freeze(['ev-battery.pack']),
    features: ['12V 표기와 덮인 단자가 있는 상자 모양이에요.', '덮개에 가려져 보이지 않을 수 있어요. 열지 말고 확인하기 어렵다고 답해 주세요.', '하부의 고전압 배터리는 이 점검 대상이 아니에요.'],
    shape: ['상자 모양 배터리 그림. 12V 글자와 플러스, 마이너스 단자 덮개가 있습니다. 특정 차량의 형상이 아닙니다.', '찾아볼 표시: 12V. 단자 덮개는 열지 않아요.'] }),
  bonnet({ partId: 'fuse-box', title: '모터룸 퓨즈박스', role: '전기 회로를 보호하는 퓨즈가 든 상자예요.', zone: '왼쪽 바깥 가운데',
    features: ['닫힌 덮개만 바깥에서 봐요. 안쪽의 퓨즈는 보지 않아요.', '덮개에 퓨즈 표시나 글자가 있는 차가 많아요. 설명서로 대조해 주세요.', '실내 퓨즈박스와 달라요. 실내 것을 대신 기록하지 마세요.'],
    shape: ['걸쇠가 있는 닫힌 상자 그림. 덮개에 퓨즈 기호가 있습니다. 특정 차량의 형상이 아닙니다.', '찾아볼 모양: 퓨즈 기호가 있는 닫힌 덮개.'] }),
  tire('left', false), tire('right', false), tire('left', true), tire('right', true),
  guide({ partId: 'ev-charge.port', taskId: 'ev-charge.port', title: 'EV 충전구', role: '충전 케이블을 차에 연결하는 곳이에요.', area: '차 바깥 · 뒤쪽 오른쪽 옆', applies: APPLIES.REFERENCE_LAYOUT, manual: null, related: Object.freeze(['ev-charge.flap', 'ev-battery.pack']),
    features: [`차체 옆이나 앞뒤의 덮개 안에 있어요. ${CHARGE_NOTE}`, '덮개가 닫혀 있으면 억지로 열지 말고, 보이지 않는 항목은 확인하기 어렵다고 답해 주세요.', '충전 중이면 점검을 시작하지 마세요.'],
    safety: inspectionSafety('ev-charge.port'),
    overview: ['위에서 본 차 그림. 뒤쪽 오른쪽 옆의 작은 구역이 강조되어 있습니다. 참고 차량의 예시이며 차종마다 다릅니다.', `찾아볼 곳 예시: 뒤쪽 오른쪽 옆. ${CHARGE_NOTE} ${SIDE_NOTE}`],
    detail: ['둥근 충전구 그림. 단자 구멍 세 개가 일반적인 모양으로 표시되어 있습니다. 실제 단자 배치가 아닙니다.', '찾아볼 모양: 둥근 충전구. 단자 모양은 충전 규격마다 달라요.'] }),
  guide({ partId: 'ev-charge.flap', taskId: null, title: 'EV 충전구 덮개', role: '충전구를 덮어 보호하는 덮개예요. 따로 점검하는 항목은 아니고, 충전구 점검에서 함께 봐요.', area: '차 바깥 · 충전구 위', applies: APPLIES.REFERENCE_LAYOUT, manual: null,
    features: ['차체와 이어져 있고 가장자리에 틈이 보이는 작은 덮개예요.', `충전구와 같은 곳에 있어요. ${CHARGE_NOTE}`, '여는 방법은 차마다 달라요. 내 차 설명서를 봐 주세요.'],
    safety: inspectionSafety('ev-charge.port'),
    overview: ['위에서 본 차 그림. 뒤쪽 오른쪽 옆의 작은 구역이 강조되어 있습니다. 충전구와 같은 자리입니다. 참고 차량의 예시이며 차종마다 다릅니다.', `찾아볼 곳 예시: 충전구와 같은 자리. ${CHARGE_NOTE}`],
    detail: ['차체 면에 있는 사각형 덮개 그림. 경첩 쪽과 플러그 기호가 표시되어 있습니다. 특정 차량의 형상이 아닙니다.', '찾아볼 모양: 차체와 이어진 닫힌 덮개.'] }),
  guide({ partId: 'ev-battery.pack', taskId: null, title: '고전압 배터리 팩', role: '차를 움직이는 전기를 저장하는 큰 배터리예요. 직접 점검하는 부품이 아니어서 점검 항목이 없어요.', area: '차 바닥 아래', applies: APPLIES.ANY_VEHICLE, manual: null,
    features: ['전기차의 바닥 아래에 넓게 놓인 경우가 많아요. 위치와 모양은 차마다 달라요.', '주황색 케이블은 고전압 표시예요. 12V 보조 배터리와 다른 부품이에요.', '사용자가 눈으로 확인할 항목이 없어요. 이상이 걱정되면 제조사 서비스에 문의해 주세요.'],
    safety: Object.freeze(['차 아래로 들어가거나 차를 들어 올려 보려고 하지 마세요.', '배터리 팩과 주황색 고전압 케이블을 만지거나 열거나 분해하지 마세요.', '손상·연기·이상한 냄새가 있으면 가까이 가지 말고 물러나 제조사 서비스나 긴급 신고로 연락해 주세요.']),
    overview: ['옆에서 본 차 그림. 앞뒤 바퀴 사이의 바닥 아래 영역이 주황색 점선으로 강조되어 있습니다. 실제 크기나 위치가 아닙니다.', '찾아볼 곳이 아니라 알아 둘 곳이에요. 다가가지 마세요.'],
    detail: ['직사각형 배터리 팩과 주황색 케이블, 고전압 경고 삼각형 그림. 실제 구조가 아닙니다.', '고전압 부품이에요. 실제 구조를 보여 주는 그림이 아니에요.'] }),
  lamp('left', 'low'), lamp('right', 'low'), lamp('left', 'high'), lamp('right', 'high'),
  wiper('left'), wiper('right'),
].map(entry => [entry.partId, entry])));

export const guideForTask = taskId => (taskId ? Object.values(PART_GUIDES).find(entry => entry.taskId === taskId) ?? null : null);
/** Parts with no inspection: read on the information page, with no task and no result. */
export const infoGuides = () => Object.values(PART_GUIDES).filter(entry => entry.taskId === null);
