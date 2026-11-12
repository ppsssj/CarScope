// P7-B additive mobile contracts. Stable IDs match existing model selection IDs.
// These are USER_REPORTED exterior observations, never SDK feature IDs.
const check=(id,label,help)=>Object.freeze({id,label,help});
const tankChecks=Object.freeze([
  check('levelMarking','외부 액면과 표시 범위','완전히 식은 상태에서 저장통의 MIN·MAX 또는 L·F 표시와 액면을 외부에서 함께 읽을 수 있을 때만 비교하세요. 범위를 벗어나 보이면 이상 징후 발견, 불투명·가림·표시 불명확이면 확인할 수 없음을 선택하세요. 캡을 열지 마세요.'),
  check('leakTrace','주변의 젖음·흐른 흔적','멀리서 보이는 젖음이나 흐른 흔적만 기록하세요. 액체 종류·누출 원인을 단정하거나 만지거나 닦지 마세요. 보이지 않으면 확인할 수 없음을 선택하세요.'),
  check('exteriorDamage','저장통과 캡의 외관','외부에서 보이는 균열·변형·손상만 기록하세요. 캡을 돌리거나 호스·배선을 만지지 마세요. 숨은 면은 확인한 것으로 간주하지 마세요.'),
]);
const batteryChecks=Object.freeze([
  check('caseDamage','12V 케이스 외관','접근·접촉 없이 보이는 케이스의 균열·부풀음·변형만 관찰하세요. 덮개에 가려졌다면 열지 말고 확인할 수 없음을 선택하세요. 용량·전압·수명은 판정하지 않습니다.'),
  check('leakTrace','케이스 주변 누액 의심 흔적','보이는 젖음·흐른 흔적만 기록하세요. 액체를 만지거나 냄새를 맡거나 닦지 마세요. 누액 의심 시 즉시 접근을 중단하세요.'),
  check('visibleCorrosion','노출된 부분의 부식 의심 흔적','이미 보이는 부분의 침전·부식 의심 흔적만 기록하세요. 단자 덮개를 열거나 단자·배선·금속 도구를 접촉하지 마세요. 가려졌으면 확인할 수 없음을 선택하세요.'),
]);
const fuseChecks=Object.freeze([
  check('coverDamage','닫힌 퓨즈박스 덮개 외관','설명서로 찾은 모터룸 퓨즈박스의 닫힌 덮개에서 보이는 균열·파손만 기록하세요. 덮개를 열거나 눌러 체결 상태를 시험하지 마세요.'),
  check('visibleContamination','덮개 주변의 젖음·오염','외부에서 이미 보이는 물기·이물질만 관찰하세요. 닦거나 청소하거나 물을 붓지 마세요. 내부 유입 여부는 판단하지 않습니다.'),
  check('heatDamage','덮개의 변형·변색 흔적','눈에 보이는 녹음·변형·그을림 의심 흔적만 기록하세요. 손으로 온도를 확인하지 마세요. 퓨즈 단선·정격·회로 정상 여부를 판정하지 않습니다.'),
]);
const wiperChecks=Object.freeze([
  check('bladeDamage','보이는 블레이드 고무 손상','선택한 쪽의 정지한 블레이드에서 보이는 찢어짐·갈라짐만 기록하세요. 와이퍼 암을 들어 올리거나 고무를 만지거나 분리하지 마세요. 유리에 가려진 면은 확인할 수 없음입니다.'),
  check('visibleDebris','블레이드 주변 이물질','눈에 보이는 이물질·들뜬 오염만 기록하세요. 손으로 제거하거나 작동시켜 시험하지 마세요. 닦임 성능은 판정하지 않습니다.'),
  check('armDamage','와이퍼 암의 보이는 외관','정지한 암의 눈에 보이는 휨·파손만 관찰하세요. 고정 상태를 흔들어 시험하거나 서비스 위치로 움직이지 마세요.'),
]);
const lampChecks=Object.freeze([
  check('lensDamage','선택한 등화 영역 렌즈 손상','설명서로 해당 상향등·하향등 영역을 먼저 구별하세요. 소등 후 식은 외부 렌즈의 균열·깨짐만 기록하세요. 영역을 구별할 수 없으면 확인할 수 없음을 선택하세요.'),
  check('obstruction','선택한 렌즈 영역의 가림','외부에서 보이는 오염·부착물 등 가림만 기록하세요. 청소·탈거하지 마세요. 밝기·광축·점등 기능은 평가하지 않습니다.'),
  check('visibleMoisture','렌즈 안쪽의 물기 관찰','외부에서 보이는 물방울·물 고임 의심 흔적만 기록하세요. 일시적 결로와 고장을 구분하지 않으며 캡·렌즈를 열거나 건조 작업을 하지 마세요.'),
]);
const bonnet='차량 사용설명서의 보닛 내부 배치도와 실제 표기를 먼저 대조하세요. 차종·연식·시장·운전석 방향에 따라 위치가 다르며 모델상의 위치는 실차 위치 보장이 아닙니다.';
export const EXTRA_TASKS=Object.freeze([
  {id:'coolant-reservoir',label:'냉각수 리저버',kind:'bonnet',checks:tankChecks,position:`${bonnet} 일반 냉각수와 저전도 냉각수 저장통을 색상만으로 구별하지 마세요.`},
  {id:'lcw-coolant-reservoir',label:'저전도 냉각수 리저버',kind:'bonnet',checks:tankChecks,position:`${bonnet} 저전도 냉각수(LCW) 표기를 확인하세요. 해당 저장통이 없는 사양이거나 구별할 수 없으면 확인할 수 없음으로 기록하세요.`},
  {id:'battery-12v',label:'12V 보조 배터리',kind:'bonnet',checks:batteryChecks,position:`${bonnet} 12V 보조 배터리 외관만 대상이며 하부 고전압 배터리는 대상이 아닙니다.`},
  {id:'fuse-box',label:'모터룸 퓨즈박스',kind:'bonnet',checks:fuseChecks,position:`${bonnet} 모터룸 퓨즈박스의 닫힌 덮개만 관찰합니다. 실내 퓨즈박스 응답을 대신 기록하지 마세요.`},
  ...['left','right'].map(side=>({id:`wiper.front.${side}`,label:`전면 ${side==='left'?'왼쪽':'오른쪽'} 와이퍼`,kind:'wiper',checks:wiperChecks,position:`차량에 앉아 앞을 보는 기준 ${side==='left'?'왼쪽':'오른쪽'} 전면 유리 하단의 와이퍼입니다. 차량 전원·와이퍼·자동 와이퍼를 끄고 완전히 정지한 상태에서 보이는 부분만 확인하세요.`})),
  ...['low','high'].flatMap(beam=>['left','right'].map(side=>({id:`light-${beam}-beam-${side}-0`,label:`${side==='left'?'왼쪽':'오른쪽'} ${beam==='low'?'하향등':'상향등'}`,kind:'lamp',checks:lampChecks,position:`차량에 앉아 앞을 보는 기준 앞쪽 ${side==='left'?'왼쪽':'오른쪽'} 전조등의 ${beam==='low'?'하향등':'상향등'} 영역입니다. 설명서의 등화 배치도를 대조하세요. 차종에 따라 같은 램프 모듈을 공유하므로 구별되지 않으면 확인할 수 없음으로 기록하세요.`}))),
].map(task=>Object.freeze(task)));
export const extraTask=id=>EXTRA_TASKS.find(task=>task.id===id);
export const isExtraTask=id=>!!extraTask(id);
