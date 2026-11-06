// Words and pictures for the driver. Presentation only: stored ids, answers and statuses stay in the result modules,
// and the full safety and limitation text stays in the profiles, one tap away under "자세한 안내".
const BONNET_POINTS = Object.freeze([
  '평탄하고 안전한 곳에 세우고 P·주차 브레이크를 확인해 주세요.',
  '전원을 끄고, 충전 중이 아닌지 확인해 주세요.',
  '보닛을 단단히 고정하고 모터룸이 완전히 식은 뒤에 살펴봐 주세요.',
  '부품을 만지거나 캡·덮개를 열지 마세요. 고전압 케이블과 팬에 가까이 가지 마세요.',
]);
const KIND = Object.freeze({
  bonnet: { icon: 'engine', lead: '보닛 안에서 겉으로 보이는 모습만 살펴봐요.', points: BONNET_POINTS,
    follow: '이상이 보이거나 확인하지 못한 부분은 제조사 서비스에 문의해 주세요. 직접 보충하거나 분해하지 마세요.' },
  wiper: { icon: 'wiper', lead: '멈춰 있는 와이퍼를 눈으로만 살펴봐요.',
    points: Object.freeze(['안전한 곳에 세우고 P·주차 브레이크를 확인해 주세요.', '전원과 자동 와이퍼를 꺼 주세요.', '와이퍼를 만지거나 들어 올리거나 작동시키지 마세요.']),
    follow: '이상이 보이거나 확인하지 못한 부분은 제조사 서비스에 문의해 주세요. 직접 분해하거나 수리하지 마세요.' },
  lamp: { icon: 'lamp', lead: '꺼져 있는 전조등의 겉모습만 살펴봐요.',
    points: Object.freeze(['안전한 곳에 세우고 P·주차 브레이크를 확인해 주세요.', '전원과 조명을 끄고 램프가 식은 뒤에 살펴봐 주세요.', '켜서 시험하거나 만지거나 분해하지 마세요.']),
    follow: '이상이 보이거나 확인하지 못한 부분은 제조사 서비스에 문의해 주세요. 직접 분해하거나 수리하지 마세요.' },
});
const TIRE = Object.freeze({ icon: 'tire', lead: '이 바퀴에서 보이는 부분만 눈으로 살펴봐요.',
  points: Object.freeze(['안전한 곳에 주차하고 차를 움직이지 마세요.', '도로 위에서 점검하거나 타이어를 분해하지 마세요.']),
  follow: '이상이 보이거나 확인하지 못한 부분은 제조사 서비스나 정비 전문가에게 확인해 주세요.' });
const CHARGE = Object.freeze({ icon: 'plug', lead: '충전구와 덮개의 겉모습만 살펴봐요.',
  points: Object.freeze(['안전한 곳에 주차하고 차를 움직이지 마세요.', '덮개나 케이블을 억지로 열거나 빼지 마세요.', '단자 안을 만지거나 손가락·금속·액체를 넣지 마세요.']),
  extraAck: '지금 충전 중이 아니에요',
  follow: '파손·변색·이상 발열이 의심되거나 확인하지 못한 부분은 더 가까이 가지 말고 제조사 서비스에 문의해 주세요.' });
const BRAKE = Object.freeze({ icon: 'drop', lead: '브레이크액 통을 바깥에서만 살펴봐요.',
  points: Object.freeze(['평탄하고 안전한 곳에 주차하고 전원을 꺼 주세요.', '보닛을 단단히 고정해 주세요.', '뜨겁거나 움직이는 부품, 고전압 케이블에 가까이 가지 마세요.', '캡을 열거나 직접 보충하거나 분해하지 마세요.']),
  follow: '이상이 보이거나 확인하지 못한 부분은 제조사 서비스에 확인해 주세요. 캡을 열거나 직접 보충하지 마세요.' });
export function taskCopy(task) {
  if (task.id.startsWith('tire.')) return TIRE;
  if (task.id === 'ev-charge.port') return CHARGE;
  if (task.id === 'brake-fluid') return BRAKE;
  return KIND[task.kind];
}
export const SAFETY_ACK = '위 내용을 모두 확인했어요';

// Each question reads so that "보여요" is the stored FOUND and "없어요" is the stored NOT_FOUND. The tip keeps what the driver must not do.
const QUESTIONS = Object.freeze({
  damage: ['갈라지거나 손상된 곳이 보이나요?', '옆면과 보이는 바닥 면을 눈으로만 살펴봐 주세요.'],
  'tire.debris': ['못이나 돌처럼 박힌 것이 보이나요?', '박힌 물체를 빼지 마세요.'],
  wear: ['한쪽만 더 닳아 보이나요?', '홈 깊이나 교체 시기를 재는 점검은 아니에요.'],
  flapDamage: ['덮개나 주변에 손상이 보이나요?', '덮개를 억지로 열거나 닫지 마세요.'],
  'charge.debris': ['바깥에서 이물질이나 오염이 보이나요?', '단자 안에 손가락이나 금속을 넣지 마세요.'],
  visibleDamage: ['변형되거나 변색된 곳이 보이나요?', '가까이 가거나 만지지 말고, 손으로 온도를 확인하지 마세요.'],
  levelMarking: ['액면이 표시 범위를 벗어나 보이나요?', '표시와 액면을 바깥에서 함께 읽을 수 있을 때만 비교해 주세요. 캡을 열지 마세요.'],
  leakTrace: ['주변에 젖거나 흐른 흔적이 보이나요?', '만지거나 닦지 말고 보이는 흔적만 알려 주세요.'],
  exteriorDamage: ['통이나 캡에 금이 가거나 손상된 곳이 보이나요?', '캡을 돌리거나 부품을 만지지 마세요.'],
  caseDamage: ['배터리 케이스가 갈라지거나 부풀어 보이나요?', '가까이 가거나 만지지 말고, 덮개를 열지 마세요.'],
  visibleCorrosion: ['보이는 부분에 부식 흔적이 있나요?', '단자 덮개를 열거나 단자·배선을 만지지 마세요.'],
  coverDamage: ['닫힌 덮개에 금이 가거나 파손된 곳이 보이나요?', '덮개를 열거나 눌러 보지 마세요.'],
  visibleContamination: ['덮개 주변에 물기나 이물질이 보이나요?', '닦거나 청소하지 마세요.'],
  heatDamage: ['덮개가 녹거나 변색된 흔적이 보이나요?', '손으로 온도를 확인하지 마세요.'],
  bladeDamage: ['고무 날이 찢어지거나 갈라져 보이나요?', '와이퍼를 들어 올리거나 고무를 만지지 마세요.'],
  visibleDebris: ['날 주변에 이물질이 보이나요?', '손으로 치우거나 작동시키지 마세요.'],
  armDamage: ['와이퍼 암이 휘거나 파손돼 보이나요?', '흔들거나 움직여 보지 마세요.'],
  lensDamage: ['렌즈에 금이 가거나 깨진 곳이 보이나요?', '꺼진 뒤 식은 렌즈를 겉에서만 봐 주세요.'],
  obstruction: ['렌즈를 가리는 오염이나 부착물이 보이나요?', '청소하거나 떼어 내지 마세요.'],
  visibleMoisture: ['렌즈 안쪽에 물기가 보이나요?', '렌즈를 열거나 말리려 하지 마세요.'],
});
export function questionCopy(task, check) {
  const scoped = check.id === 'debris' ? (task.id.startsWith('tire.') ? 'tire.debris' : 'charge.debris') : check.id;
  const [title, tip] = QUESTIONS[scoped] ?? [check.label, ''];
  return { title, tip };
}
export const ANSWER_COPY = Object.freeze({
  FOUND: Object.freeze({ label: '이상이 보여요', tone: 'found' }),
  NOT_FOUND: Object.freeze({ label: '보이는 곳엔 없어요', tone: 'clear' }),
  UNABLE: Object.freeze({ label: '확인하기 어려워요', tone: 'unable' }),
});
export const CHECKLIST_OUTCOME = Object.freeze({
  REVIEW_NEEDED: Object.freeze({ title: '살펴볼 부분이 있어요', tone: 'found' }),
  UNABLE: Object.freeze({ title: '확인하지 못한 부분이 있어요', tone: 'unable' }),
  NO_FINDINGS_REPORTED: Object.freeze({ title: '보이는 곳에서 이상을 찾지 못했어요', tone: 'clear' }),
});
export const WASHER_OUTCOME = Object.freeze({
  OK: Object.freeze({ title: '충분해요', tone: 'clear' }),
  NEEDS_REFILL: Object.freeze({ title: '보충이 필요해요', tone: 'found' }),
  UNSURE: Object.freeze({ title: '확인하기 어려워요', tone: 'unable' }),
});
export const REPORT_NOTE = '내가 직접 본 내용을 기록한 거예요. 차량의 정상·안전을 판정하지 않아요.';

// Static markup of our own, built with DOM calls so the page's CSP needs no inline style.
const PATHS = Object.freeze({
  drop: 'M12 3.5s6 6.6 6 10.8a6 6 0 0 1-12 0C6 10.100 12 3.5 12 3.5Z',
  tire: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 3v2',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8Zm5 8v5',
  engine: 'M5 9h3l2-3h5v3h2l2 2h1v5h-1l-2 2H9l-2-2H5V9Zm-3 2v3',
  wiper: 'M3 18c2.500-7 6-11 9-11s6.500 4 9 11M12 7v11M12 18l6-9',
  lamp: 'M12 6h3a6 6 0 0 1 0 12h-3V6ZM8 8H3M8 12H3M8 16H3',
});
export function iconElement(name) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  path.setAttribute('d', PATHS[name] ?? PATHS.drop); svg.append(path);
  return svg;
}
