// P12-A2: every part guide drawing comes from these templates. Run `npm run build:guide-art` after changing them; a test fails if
// the committed files differ. Original CarScope schematics of no particular vehicle: no photo, manual figure or model data is traced.
//
// Where a part is drawn is the rough side and zone only, and only as far as a source goes:
//   bonnet parts: the layout observed in docs/p3-a2-3-service-components.md and the registry's `location` (a reference, ESTIMATED).
//   Screen left is the vehicle's left: seen from above with the nose up, as a person seated in it would say.
//   lcw-coolant-reservoir has no geometry in the registry, so it is dashed and says that not every car has it.
//   Low and high beam share a corner and a charge port and its flap share a spot: their position is the same on purpose.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PART_GUIDES } from './public/part-guides.mjs';

const C = { bg: '#1e2228', body: '#2a2f37', line: '#5f6772', dim: '#3a404a', ink: '#e8eaed', muted: '#a6adb7', hit: '#3ec6e0', soft: '#14303a', warn: '#e0b25a', hv: '#ef9867' };
const FONT = 'font-family="system-ui,sans-serif"';
const text = (x, y, s, { size = 14, fill = C.ink, anchor = 'middle', weight = 400 } = {}) => `<text x="${x}" y="${y}" fill="${fill}" ${FONT} font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${s}</text>`;
const lines = (x, y, rows, options = {}) => rows.map((row, i) => text(x, y + i * ((options.size ?? 14) + 4), row, options)).join('');
const tag = s => text(14, 290, s, { size: 12, fill: C.muted, anchor: 'start' });
const wrap = (alt, inner, note = '설명용 그림') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="${alt}">\n<rect width="400" height="300" fill="${C.bg}"/>\n${inner}\n${tag(note)}\n</svg>\n`;
const callout = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${C.hit}" stroke-width="2"/>`;
const frontMark = (x, y) => `${text(x, y, '앞', { size: 13, fill: C.muted })}<path d="M${x} ${y + 4} l-7 11 h14 z" fill="${C.muted}"/>`;

// ---- Whole car seen from above, nose up. `hit` draws what is emphasised on top.
const CAR = `<rect x="132" y="56" width="136" height="222" rx="38" fill="${C.body}" stroke="${C.line}" stroke-width="3"/>
<path d="M146 134 Q200 118 254 134 L244 168 Q200 156 156 168 Z" fill="#171a1f" stroke="${C.line}" stroke-width="2"/>
<rect x="156" y="174" width="88" height="66" rx="10" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>
<rect x="122" y="128" width="10" height="14" rx="3" fill="${C.line}"/><rect x="268" y="128" width="10" height="14" rx="3" fill="${C.line}"/>`;
const WHEEL = { 'front-left': [118, 86], 'front-right': [268, 86], 'rear-left': [118, 216], 'rear-right': [268, 216] };
const wheels = (active, size = [14, 42]) => Object.entries(WHEEL).map(([key, [x, y]]) => `<rect x="${x}" y="${y}" width="${size[0]}" height="${size[1]}" rx="5" fill="${key === active ? C.hit : '#14171b'}" stroke="${key === active ? C.ink : C.line}" stroke-width="2"/>`).join('');
const sideLabels = `${text(44, 172, '왼쪽', { fill: C.muted })}${text(356, 172, '오른쪽', { fill: C.muted })}`;
const wholeCar = (hit, label, labelSide, y = 40) => `${frontMark(200, 22)}${CAR}${wheels()}${hit}${sideLabels}${labelSide === 'left' ? lines(8, y, label, { anchor: 'start', weight: 700 }) : lines(392, y, label, { anchor: 'end', weight: 700 })}`;

function tireArea(id) {
  const key = id.replace('tire.', ''), [x, y] = WHEEL[key], left = key.endsWith('left'), rear = key.startsWith('rear');
  const label = `${rear ? '뒤' : '앞'} ${left ? '왼쪽' : '오른쪽'}`;
  return `${frontMark(200, 22)}${CAR}${wheels(key, [14, 42])}${sideLabels}${callout(left ? x : x + 14, y + 21, left ? 74 : 326, rear ? 244 : 80)}${text(left ? 40 : 360, rear ? 262 : 70, label, { weight: 700 })}`;
}
function wiperArea(side) {
  const left = side === 'left';
  const arm = (x1, x2, active) => `<path d="M${x1} 162 L${x2} 134" stroke="${active ? C.hit : C.dim}" stroke-width="${active ? 6 : 4}" stroke-linecap="round"/>`;
  return wholeCar(`${arm(164, 214, left)}${arm(204, 254, !left)}${callout(left ? 162 : 256, left ? 160 : 134, left ? 74 : 326, 100)}`, [`전면 ${left ? '왼쪽' : '오른쪽'}`, '와이퍼'], left ? 'left' : 'right', 78);
}
function lampArea(side, beam) {
  const left = side === 'left', hitX = left ? 152 : 248, other = left ? 248 : 152;
  const lamp = (x, active) => `<ellipse cx="${x}" cy="72" rx="16" ry="9" fill="${active ? C.hit : C.dim}" stroke="${active ? C.ink : C.line}" stroke-width="2"/>`;
  return wholeCar(`${lamp(other, false)}${lamp(hitX, true)}${callout(left ? 136 : 264, 72, left ? 76 : 324, 72)}`, [`${left ? '왼쪽' : '오른쪽'} ${beam === 'low' ? '하향등' : '상향등'}`, '앞쪽 모서리 램프'], left ? 'left' : 'right', 96);
}
const chargeArea = (flap) => wholeCar(`<rect x="256" y="214" width="16" height="${flap ? 26 : 20}" rx="4" fill="${C.hit}" stroke="${C.ink}" stroke-width="2"/>${callout(272, 228, 316, 240)}`, flap ? ['EV 충전구', '덮개'] : ['EV 충전구'], 'right', 256);
const packArea = `${text(362, 56, '앞', { size: 13, fill: C.muted })}<path d="M348 62 h22 l-6 -5 m6 5 l-6 5" fill="none" stroke="${C.muted}" stroke-width="2"/>
<path d="M36 180 Q40 130 92 124 L150 86 Q200 74 262 86 L320 124 Q366 132 370 180 L370 204 L36 204 Z" fill="${C.body}" stroke="${C.line}" stroke-width="3"/>
<path d="M162 96 H256 L296 126 H130 Z" fill="#171a1f" stroke="${C.line}" stroke-width="2"/>
<circle cx="104" cy="204" r="28" fill="#14171b" stroke="${C.line}" stroke-width="3"/><circle cx="304" cy="204" r="28" fill="#14171b" stroke="${C.line}" stroke-width="3"/>
<rect x="136" y="198" width="136" height="20" rx="4" fill="${C.soft}" stroke="${C.hv}" stroke-width="3" stroke-dasharray="8 5"/>
${callout(204, 218, 204, 240)}${text(204, 258, '차 바닥 아래', { weight: 700 })}${text(204, 276, '볼 수 있어도 다가가지 마세요', { size: 13, fill: C.hv })}`;

// ---- Bonnet parts: small car for where the bonnet is, and the bay in rough zones. Zones are not positions of a real part.
const ZONES = Object.freeze({ // column of four from the vehicle's left to its right, row front to rear, from the sources named at the top.
  'battery-12v': [1, 0], 'fuse-box': [0, 1], 'brake-fluid-reservoir': [1, 2],
  'lcw-coolant-reservoir': [2, 0], 'coolant-reservoir': [2, 1], 'washer-fluid-cap': [3, 2],
});
export const guideZones = () => ZONES;
const zoneBox = ([col, row]) => [176 + col * 50, 74 + row * 62];
function bonnetArea(id, name) {
  const dashed = id === 'lcw-coolant-reservoir';
  const ghosts = Object.entries(ZONES).filter(([key]) => key !== id).map(([, zone]) => { const [x, y] = zoneBox(zone); return `<rect x="${x}" y="${y}" width="42" height="52" rx="6" fill="none" stroke="${C.dim}" stroke-width="2"/>`; }).join('');
  const [x, y] = zoneBox(ZONES[id]);
  const mini = `<g transform="translate(-40 40) scale(.62)"><rect x="132" y="56" width="136" height="222" rx="38" fill="${C.body}" stroke="${C.line}" stroke-width="4"/><path d="M140 128 V90 Q140 64 170 62 H230 Q260 64 260 90 V128 Q200 112 140 128 Z" fill="${C.soft}" stroke="${C.hit}" stroke-width="5"/></g>`;
  return `${mini}${text(84, 54, '보닛', { size: 13, fill: C.muted })}
<path d="M138 96 L168 74 M138 96 L168 262" stroke="${C.dim}" stroke-width="1.500" stroke-dasharray="4 4"/>
<rect x="168" y="64" width="218" height="198" rx="14" fill="#171a1f" stroke="${C.line}" stroke-width="2"/>
${text(277, 28, name, { weight: 700 })}${text(277, 56, '앞쪽', { size: 12, fill: C.muted })}${text(192, 280, '왼쪽', { size: 12, fill: C.muted })}${text(362, 280, '오른쪽', { size: 12, fill: C.muted })}${ghosts}
<rect x="${x}" y="${y}" width="42" height="52" rx="6" fill="${C.soft}" stroke="${C.hit}" stroke-width="3.500"${dashed ? ' stroke-dasharray="7 5"' : ''}/>`;
}

// ---- Close-ups. What a person can look for from outside, no opening, no inner parts of a given car.
const washerMark = `<circle cx="200" cy="146" r="112" fill="${C.body}" stroke="${C.line}" stroke-width="4"/><circle cx="200" cy="146" r="92" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="6 8"/>
<path d="M136 206 Q200 166 264 206 L250 232 Q200 204 150 232 Z" fill="none" stroke="${C.ink}" stroke-width="7" stroke-linejoin="round"/><path d="M200 196 V224" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>
<g fill="none" stroke="${C.hit}" stroke-width="7" stroke-linecap="round"><path d="M200 162 V136" stroke-dasharray="9 10"/><path d="M200 160 Q200 110 150 84" stroke-dasharray="9 10"/><path d="M200 160 Q200 110 250 84" stroke-dasharray="9 10"/></g>`;
function tank({ upper, lower, mark, cap = 'plain' }) {
  const capDraw = cap === 'hot'
    ? `<rect x="168" y="30" width="64" height="26" rx="6" fill="${C.line}"/><path d="M200 36 l10 14 h-20 z" fill="${C.warn}"/>`
    : `<rect x="168" y="30" width="64" height="26" rx="6" fill="${C.line}"/><circle cx="200" cy="43" r="7" fill="none" stroke="${C.ink}" stroke-width="2.500"/>`;
  return `${capDraw}<path d="M120 76 Q120 58 140 58 H260 Q280 58 280 76 V240 Q280 262 256 262 H144 Q120 262 120 240 Z" fill="${C.body}" stroke="${C.line}" stroke-width="4"/>
<path d="M124 150 H276 V240 Q276 258 256 258 H144 Q124 258 124 240 Z" fill="${C.soft}"/>
<g stroke="${C.hit}" stroke-width="3"><path d="M280 110 H306"/><path d="M280 196 H306"/></g>${text(312, 116, upper, { anchor: 'start', weight: 700 })}${text(312, 202, lower, { anchor: 'start', weight: 700 })}
${mark ? text(200, 118, mark, { size: 26, weight: 700 }) : ''}${text(70, 96, '닫힌 캡', { size: 13, fill: C.muted })}<path d="M104 90 Q130 60 164 46" fill="none" stroke="${C.line}" stroke-width="2"/>`;
}
const battery = `<rect x="84" y="86" width="232" height="158" rx="10" fill="${C.body}" stroke="${C.line}" stroke-width="4"/><rect x="84" y="86" width="232" height="30" rx="8" fill="${C.dim}"/>
<rect x="112" y="60" width="50" height="30" rx="6" fill="${C.line}"/><rect x="238" y="60" width="50" height="30" rx="6" fill="${C.line}"/>
${text(137, 82, '+', { size: 22, weight: 700 })}${text(263, 82, '−', { size: 22, weight: 700 })}${text(200, 188, '12V', { size: 44, weight: 700 })}${text(200, 44, '단자 덮개는 열지 않아요', { size: 13, fill: C.hv })}`;
const fuse = `<rect x="76" y="56" width="248" height="190" rx="14" fill="${C.body}" stroke="${C.line}" stroke-width="4"/><rect x="60" y="120" width="20" height="50" rx="5" fill="${C.line}"/><rect x="320" y="120" width="20" height="50" rx="5" fill="${C.line}"/>
<g fill="none" stroke="${C.hit}" stroke-width="5" stroke-linecap="round"><rect x="150" y="116" width="100" height="42" rx="8"/><path d="M128 137 H158 Q176 112 200 137 Q224 162 242 137 H272"/></g>${text(200, 206, '닫힌 덮개', { size: 18, weight: 700 })}${text(200, 32, '덮개를 열거나 누르지 않아요', { size: 13, fill: C.hv })}`;
function tireDetail(id) {
  const key = id.replace('tire.', ''), rear = key.startsWith('rear'), left = key.endsWith('left');
  const dot = (x, y, active) => `<rect x="${x}" y="${y}" width="10" height="20" rx="3" fill="${active ? C.hit : C.dim}"/>`;
  return `<circle cx="150" cy="150" r="112" fill="#14171b" stroke="${C.line}" stroke-width="4"/><circle cx="150" cy="150" r="62" fill="${C.body}" stroke="${C.line}" stroke-width="3"/>
<circle cx="150" cy="150" r="16" fill="${C.line}"/><g stroke="${C.line}" stroke-width="7"><path d="M150 96 V134"/><path d="M150 166 V204"/><path d="M96 150 H134"/><path d="M166 150 H204"/></g>
<path d="M150 38 A112 112 0 0 1 262 150" fill="none" stroke="${C.hit}" stroke-width="8"/><path d="M150 62 A88 88 0 0 1 238 150" fill="none" stroke="${C.hit}" stroke-width="3" stroke-dasharray="6 6"/>
${text(330, 62, '옆면과', { size: 14, weight: 700 })}${text(330, 82, '보이는 바닥 면', { size: 14, weight: 700 })}
<rect x="292" y="124" width="76" height="118" rx="20" fill="${C.body}" stroke="${C.line}" stroke-width="2"/>${dot(284, 140, !rear && left)}${dot(366, 140, !rear && !left)}${dot(284, 204, rear && left)}${dot(366, 204, rear && !left)}
${text(330, 112, '앞', { size: 12, fill: C.muted })}${text(330, 268, `${rear ? '뒤' : '앞'} ${left ? '왼쪽' : '오른쪽'}`, { weight: 700 })}`;
}
function wiperDetail(side) {
  const left = side === 'left', x1 = left ? 110 : 290, x2 = left ? 262 : 138;
  return `<path d="M20 236 Q200 170 380 236 L380 86 Q200 34 20 86 Z" fill="#171a1f" stroke="${C.line}" stroke-width="3"/>${text(200, 96, '앞유리', { size: 13, fill: C.muted })}
<path d="M${x1} 226 L${x2} 118" stroke="${C.line}" stroke-width="8" stroke-linecap="round"/><path d="M${x2 - (left ? 32 : -32)} 142 L${x2 + (left ? 32 : -32)} 92" stroke="${C.hit}" stroke-width="10" stroke-linecap="round"/>
<circle cx="${x1}" cy="226" r="10" fill="${C.line}"/>${text(left ? 330 : 70, 88, '고무 날', { weight: 700 })}${text(left ? 96 : 304, 178, '암', { weight: 700 })}${text(200, 272, `차에 앉아 앞을 볼 때 ${left ? '왼쪽' : '오른쪽'}`, { weight: 700 })}`;
}
function lampDetail(side, beam) {
  const left = side === 'left', low = beam === 'low';
  const flip = left ? '' : ' transform="translate(400 0) scale(-1 1)"';
  const rays = low
    ? [0, 1, 2, 3].map(i => `<path d="M216 ${118 + i * 24} L276 ${136 + i * 24}" stroke="${C.hit}" stroke-width="7" stroke-linecap="round"/>`).join('')
    : [0, 1, 2, 3].map(i => `<path d="M216 ${118 + i * 24} H276" stroke="${C.hit}" stroke-width="7" stroke-linecap="round"/>`).join('');
  return `<g${flip}><path d="M60 110 Q40 170 76 222 H170 Q196 166 170 92 H92 Q70 92 60 110 Z" fill="${C.body}" stroke="${C.line}" stroke-width="4"/><path d="M84 124 Q74 160 92 196 H146 Q156 160 146 112 H98 Q88 112 84 124 Z" fill="#171a1f" stroke="${C.line}" stroke-width="2"/>${rays}</g>
${text(200, 40, `${left ? '왼쪽' : '오른쪽'} ${low ? '하향등' : '상향등'} · ${low ? '아래로 비춤' : '멀리 비춤'}`, { weight: 700 })}${text(200, 272, '상향·하향이 한 램프에 함께 있을 수 있어요', { size: 13, fill: C.muted })}`;
}
const chargePort = `<rect x="60" y="48" width="280" height="214" rx="18" fill="${C.body}" stroke="${C.line}" stroke-width="3"/><circle cx="200" cy="140" r="78" fill="#14171b" stroke="${C.line}" stroke-width="4"/>
<g fill="${C.dim}" stroke="${C.hit}" stroke-width="3"><circle cx="164" cy="118" r="15"/><circle cx="236" cy="118" r="15"/><circle cx="200" cy="168" r="15"/></g>${text(200, 36, '단자 안에 손이나 물건을 넣지 않아요', { size: 13, fill: C.hv })}${text(200, 246, '바깥쪽 겉모습만 봐요', { size: 14, weight: 700 })}`;
const chargeFlap = `<rect x="46" y="44" width="308" height="220" rx="12" fill="${C.body}" stroke="${C.line}" stroke-width="3"/><rect x="118" y="76" width="164" height="136" rx="16" fill="${C.soft}" stroke="${C.hit}" stroke-width="4"/>
<path d="M118 92 H106 M118 196 H106" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/><g fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"><path d="M182 114 V136 M218 114 V136 M170 136 H230 V150 Q230 172 200 172 Q170 172 170 150 Z M200 172 V192"/></g>${text(200, 240, '차체와 이어진 닫힌 덮개', { weight: 700 })}${text(200, 32, '억지로 열거나 닫지 않아요', { size: 13, fill: C.hv })}`;
const pack = `<rect x="46" y="120" width="308" height="104" rx="10" fill="${C.body}" stroke="${C.hv}" stroke-width="4"/>${[0, 1, 2, 3, 4].map(i => `<rect x="${64 + i * 56}" y="136" width="48" height="72" rx="4" fill="${C.dim}"/>`).join('')}
<path d="M354 150 Q392 150 392 104 V60" fill="none" stroke="${C.hv}" stroke-width="8" stroke-linecap="round"/><path d="M200 34 l34 58 h-68 z" fill="none" stroke="${C.hv}" stroke-width="5" stroke-linejoin="round"/><path d="M204 52 l-12 20 h10 l-6 14 16 -22 h-10 l6 -12 z" fill="${C.hv}"/>${text(372, 44, '주황색 케이블', { size: 12, fill: C.hv, anchor: 'end' })}${text(200, 256, '고전압 · 만지거나 열지 않아요', { size: 16, weight: 700, fill: C.hv })}`;

const parts = { low: 'low', high: 'high' };
export function drawingsFor(partId) {
  const name = PART_GUIDES[partId].title;
  if (partId in ZONES) {
    const detail = { 'washer-fluid-cap': washerMark, 'coolant-reservoir': tank({ upper: 'F', lower: 'L', cap: 'hot' }), 'lcw-coolant-reservoir': tank({ upper: 'F', lower: 'L', mark: 'LCW', cap: 'hot' }), 'brake-fluid-reservoir': tank({ upper: 'MAX', lower: 'MIN' }), 'battery-12v': battery, 'fuse-box': fuse }[partId];
    return { area: [bonnetArea(partId, name), '설명용 그림 · 참고 배치 예시'], detail: [detail, '설명용 그림'] };
  }
  if (partId.startsWith('tire.')) return { area: [tireArea(partId), '설명용 그림'], detail: [tireDetail(partId), '설명용 그림'] };
  if (partId.startsWith('wiper.')) { const side = partId.split('.')[2]; return { area: [wiperArea(side), '설명용 그림'], detail: [wiperDetail(side), '설명용 그림'] }; }
  if (partId.startsWith('light-')) { const [, beam, , side] = partId.split('-'); return { area: [lampArea(side, parts[beam]), '설명용 그림'], detail: [lampDetail(side, parts[beam]), '설명용 그림'] }; }
  if (partId === 'ev-charge.port') return { area: [chargeArea(false), '설명용 그림 · 참고 배치 예시'], detail: [chargePort, '설명용 그림'] };
  if (partId === 'ev-charge.flap') return { area: [chargeArea(true), '설명용 그림 · 참고 배치 예시'], detail: [chargeFlap, '설명용 그림'] };
  if (partId === 'ev-battery.pack') return { area: [packArea, '설명용 그림'], detail: [pack, '설명용 그림'] };
  throw Error(`No drawing for ${partId}`);
}
export function renderGuideArt() {
  const out = new Map();
  for (const guide of Object.values(PART_GUIDES)) {
    const drawn = drawingsFor(guide.partId);
    out.set(guide.overviewImage.file, wrap(guide.overviewImage.alt.replaceAll('"', ''), ...drawn.area));
    out.set(guide.detailImage.file, wrap(guide.detailImage.alt.replaceAll('"', ''), ...drawn.detail));
  }
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const art = renderGuideArt();
  for (const [name, svg] of art) await writeFile(new URL(`./public/${name}`, import.meta.url), svg);
  console.log(`${art.size} drawings written`);
}
