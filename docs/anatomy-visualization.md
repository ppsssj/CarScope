# P2-A — Anatomy 기반 차량 시각화

작성: 2026-10-30. 기존 P0 평면 도식(사각형 4개)을 Anatomy kit로 만든 아이소메트릭 4도어 세단으로 바꾸고, 기존 데이터 파이프라인과 `VehicleSvgRenderer`에 통합했습니다.

```text
VehicleDataSource → VehicleSnapshot → VehicleDiagramMapper → VehicleSvgRenderer → Android WebView
                                                                   ↑
                                     anatomy-car.parts (Anatomy kit로 생성한 정적 SVG 조각)
```

데이터 모델, `VehicleDiagramMapper`, 5초 STALE 정책, SDK 어댑터는 바꾸지 않았습니다.

## 1. Anatomy 사용 내역

| 항목 | 내용 |
| --- | --- |
| 저장소 | https://github.com/wheresryan22/anatomy (MIT, Copyright (c) 2026 Ryan) |
| 설치 | `git clone` → `~/.claude/skills/anatomy`, 커밋 `1482e84`. README 설치 표의 공식 방법 중 하나 |
| `npx skills add`를 쓰지 않은 이유 | skills CLI 1.7.4가 Node ≥ 22.20을 요구하나 이 PC는 Node 22.16. Node 업그레이드 대신 git clone을 사용자가 선택 |
| 스킬 호출 | Claude Code에서 `anatomy` 스킬을 실제로 불러와 지침(SKILL.md)을 따름 |
| 사용한 kit | `kit/iso-kit.mjs`(카메라, solid, 선, 경로), `kit/lathe.mjs`(바퀴: 회전체·디스크·스포크·볼트), `kit/audit.mjs`(형상 기록, 겹침 순서 결정, 감사) |
| 사용한 검증 도구 | `node build.mjs --audit`, `scripts/lines.mjs`(선 끝), `scripts/capture.mjs`(headless Chrome 렌더링, 4× 확대) |

kit와 도구는 저장소에 복제하지 않았습니다. `tools/anatomy-car/build.mjs`가 `ANATOMY_HOME`(기본 `~/.claude/skills/anatomy`)에서 kit를 import합니다. arcade-cabinet 예제의 `prismPaths` 함수(오목 다각형을 임의 축으로 세우는 prism)만 출처와 MIT 표기를 달아 옮겨 썼습니다.

### 규모와 스킬 지침에서 조정한 부분

스킬은 "여러 움직이는 시스템이 있는 차량 전체"를 Epic(6시간 이상)으로 분류합니다. 이번 대상은 움직임이 없는 정적 차체와 도어 2개의 닫힘/열림 두 자세뿐이라 Hero 규모로 정했습니다. CarScope WebView는 JavaScript를 금지하므로 스킬의 live motion, readout, 키보드 조작(9단계)과 카드 프레임은 쓰지 않았습니다. 제목과 데이터 출처는 앱의 텍스트 UI와 SVG `title`/inset이 맡습니다.

## 2. 디자인

- **시점**: azimuth 56°, elevation 28°. 차량 좌측면과 전면이 보입니다. Pleos SDK가 실제로 읽는 유일한 도어인 FRONT_LEFT가 정면으로 보이도록 정했습니다.
- **좌표**: x 전방, y 좌측, z 위, 단위 약 1cm. 전장 462, 전폭 180, 전고 약 145, 휠베이스 272, 타이어 반경 32.5.
- **구성**: 차체(측면 윤곽 prism), 캐빈(텀블홈 78), 앞유리와 와이퍼, 고정 쿼터 글라스, B/C필러, 루프 안테나, 전면(헤드램프·그릴 슬랫·번호판·인테이크·안개등), 사이드 마커, 연료 주입구, 캐릭터 라인, 로커 크리스, 보닛 shut line, 휠 하우스, 바퀴(타이어·림·스포크·허브·볼트), 도어(패널·창틀·유리·벨트라인 캡·손잡이·사이드미러).
- **도어 열림**: 앞도어 64°, 뒷도어 58°. 각 도어의 앞쪽 수직 힌지 축을 중심으로 회전한 local frame에서 형상을 다시 만듭니다. 열린 상태에서는 차체에 남는 개구부(어두운 실내, 시트 등받이, 실 플레이트)도 그립니다. 뒷도어 아래쪽 뒤 모서리는 휠 아치를 따라 깎입니다.
- **색**: kit의 밝은 테마 톤 체계(면 방향별 4단 음영 + 윗면)를 차체(은회색), 유리, 타이어, 림, 트림, 램프에 각각 적용했습니다. 상태 색은 기존 렌더러 색을 유지합니다.
- **브랜드**: 특정 차종을 참고하지 않은 일반 3박스 세단 비율입니다.

### 우측 도어

이 시점에서 FRONT_RIGHT/REAR_RIGHT는 차체에 가려 보이지 않습니다. 보이게 하려고 형상을 왜곡하지 않았고, 열린 상태도 차체 위에 그리지 않습니다. 네 도어의 상태는 오른쪽 평면도 inset에 실제 위치대로 표시하며 "RIGHT DOORS: INSET ONLY"라고 명시합니다.

## 3. 생성 과정

```powershell
node tools/anatomy-car/build.mjs --audit
```

1. 차체를 바퀴를 감싸지 않는 조각으로 나눕니다. core(바퀴 뒤, y ≤ 64), 아치를 피한 중간 띠(아치 구간은 아치 위쪽만), 바퀴 앞 얇은 외피(skin)입니다. 처음에는 차체를 prism 하나로 만들었는데, 바퀴와 겹침 순서에 순환이 생겨 audit이 실패했습니다(스킬 craft 규칙 "감싸는 부품은 나눈다").
2. 모든 부품의 실제 형상을 `A.recorder`에 기록하고, `A.settle`로 화면에서 겹치는 77쌍을 ray-cast해 painter's order를 정합니다. 같은 도어의 닫힘/열림 형상은 동시에 그려지지 않으므로 서로 비교하지 않습니다(`skip`). 그 덕분에 하나의 순서로 모든 도어 조합을 그릴 수 있습니다.
3. 결과를 두 가지로 내보냅니다.
   - `vehicle-core/src/main/resources/io/carscope/visualization/anatomy-car.parts`: 앱용 자산
   - `tools/anatomy-car/build/*.html`: Anatomy 검증용 kit 스타일 미리보기, Git 제외

### 앱용 자산 형식

```text
#carscope-anatomy-car 1
#viewbox 640 330
#source anatomy-kit 1482e84
@static                              ← 그리는 순서대로 이어 붙일 markup
@door door-front-left closed         ← 해당 도어가 이 자세일 때만 사용
@accent door-front-left closed       ← 상태 색을 입힐 도어 패널 윤곽 (path d)
...
```

- `<path>`와 `<circle>`만 있고 색은 속성으로 박혀 있습니다. CSS, class, `<g>`, script, 외부 참조가 없습니다.
- 좌표는 절대 `M/L/Z`만 씁니다.
- 생성 결과는 결정적입니다. 같은 입력이면 같은 파일이 나오며, 현재 SHA-256은 `a785c4c1f8cee425212f08900c76375eda4e697a5d25749288ed675c13ea98f4`입니다.

## 4. 렌더러 통합 (`VehicleSvgRenderer`)

- 자산을 classpath 리소스로 처음 한 번 읽어 파싱합니다(`AnatomyCarAsset`). APK 안에서는 `io/carscope/visualization/anatomy-car.parts`(약 111KB)입니다.
- 섹션을 그리는 순서대로 출력합니다. 도어 섹션은 상태가 OPEN이면 open 자세를, CLOSED·UNAVAILABLE·STALE이면 closed 자세를 씁니다.
- viewBox는 `0 0 930 330`이며, 차량 640과 평면도 inset 290으로 구성됩니다.

기존 계약을 유지합니다(기존 core 테스트 17개는 수정하지 않고 통과).

| DoorId | group id | 차량 위 형상 | inset |
| --- | --- | --- | --- |
| FRONT_LEFT | door-front-left | 닫힘/열림 + 상태 accent | 칩 + 상태 이름 |
| REAR_LEFT | door-rear-left | 닫힘/열림 + 상태 accent | 칩 + 상태 이름 |
| FRONT_RIGHT | door-front-right | 없음 (가려짐) | 칩 + 상태 이름 |
| REAR_RIGHT | door-rear-right | 없음 (가려짐) | 칩 + 상태 이름 |

- 문서 전체에서 `<g>`는 도어별로 정확히 하나입니다. 각 그룹은 `data-state`를 갖고, 첫 `<rect>`는 상태 색 칩, 첫 `<text>`는 상태 이름입니다.

상태 표시는 색과 함께 모양 단서를 씁니다.

| 상태 | 형상 | accent (도어 패널) |
| --- | --- | --- |
| OPEN | 열림 | `#b93817`, 채움 0.30, 선 1.8 |
| CLOSED | 닫힘 | `#14765b`, 채움 0.16, 선 1.4 |
| UNAVAILABLE | 닫힘 | `#636d78`, 채움 0.32, 파선 `4 3` |
| STALE | 닫힘 | `#856000`, 채움 0.26, 점선 `1.5 2` |

DataOrigin은 SVG `title`("CarScope PLEOS door diagram")과 inset의 "SOURCE PLEOS/MOCK"으로 보입니다. 앱의 기존 텍스트 출처 표시도 그대로입니다. WebView 보안 설정(JS 비활성, 파일·콘텐츠·네트워크 차단, CSP `default-src 'none'`)은 바꾸지 않았고, WebGL·애니메이션·필터는 쓰지 않습니다.

앱 변경은 WebView 높이 240dp → 320dp 한 줄뿐입니다. 2.8:1 도식에서 차량이 약 230px 높이로 보이게 하려는 것입니다.

## 5. 검증

| 항목 | 결과 |
| --- | --- |
| Anatomy audit (`--audit`) | `audit passed`: 형상 50, item 26, 겹침 77쌍, 순서 규칙 77. 순환·잠김·떠 있는 부품·스탠드인 형상 0 |
| 선 끝 검사 (`lines.mjs`) | 4개 도어 조합 × 밝은/어두운 테마 모두 `line ends: 0` |
| 미리보기 렌더링 (`capture.mjs`) | 1× 전체, 4× 뒷도어 열림 close-up, 밝은/어두운 테마 확인 |
| Kotlin 렌더러 출력 | `exportSvgSamples` 4종(closed/front-left-open/stale/unavailable)을 앱과 같은 HTML·CSP로 headless Chrome에서 1634×320 렌더링 확인 |
| JVM 테스트 | core 17(기존, 무수정) + 신규 시각화 7 = 24, app 19. 모두 PASS |
| Pleos AVD 실제 앱 | MOCK 3종·STALE, PLEOS 현재 값 CLOSED, Console OPEN/CLOSE → SDK `event raw=1/0` → Anatomy 차량 도어 열림/닫힘. [evidence](evidence/p2-a/2026-10-30-home/README.md) |

신규 테스트(`VehicleSvgRendererTest`):
- 16개 상태 조합이 모두 유효한 XML이고 도어 ID가 각각 하나인지
- OPEN은 열림 형상, 다른 상태는 닫힘 형상인지
- 우측 도어는 inset에만 표시되는지
- 상태별 색과 점선 패턴이 서로 다른지
- 출처 표시
- script·외부 참조·애니메이션·필터가 없는지
- 모든 path 좌표가 viewBox 안에 있는지(잘림 없음)

## 6. 성능과 제약

- SVG 문자열은 상태당 약 101KB입니다.
- `MainActivity`는 1초마다 SVG를 다시 만들어 이전 문자열과 비교하고, 바뀐 경우에만 WebView를 다시 load합니다(기존 동작). 매초 문자열 생성 비용은 측정하지 않았습니다.
- AVD(2 vCPU/4GB)에서 cold launch TotalTime은 3.7초였고, 첫 그림은 실행 후 약 2~4초 사이에 나타났습니다. 앱 TOTAL PSS는 117MB(WebView 포함)였습니다. UI 프레임 50% 지점은 150ms, janky 100%였는데, 이전 평면 도식에서도 같은 AVD에서 janky 100%였으므로 이 수치만으로 이번 변경의 영향은 판단하지 않습니다.
- 그림자에 blur 필터를 쓰지 않고 반투명 평면으로 대신했습니다.

## 7. 알려진 문제와 한계

- **5초 STALE 정책**: PLEOS 모드에서 도어 상태가 바뀌지 않으면 5초 후 차량 도어가 황색 STALE로 바뀝니다. 이번 작업에서는 정책을 바꾸지 않았습니다. [STALE 정책 검토](stale-policy-review.md)
- **우측 도어**: 차량 위에 표시하지 않습니다(inset만).
- **디테일**: 4× 확대에서 차체 옆면은 비교적 단순합니다. 스킬의 Hero 기준("모든 영역에 발견할 것이 있음")에는 못 미치며, 개선 여지가 있습니다.
- **배경**: 앱 WebView는 밝은 배경 기준입니다. kit 미리보기의 어두운 테마에서도 차체 대비는 확인했지만, 앱용 자산 색은 밝은 테마 기준으로 고정돼 있습니다.

## 8. 재생성

```powershell
# Anatomy가 설치된 PC에서 (기본 ~/.claude/skills/anatomy, 다르면 ANATOMY_HOME 지정)
node tools/anatomy-car/build.mjs --audit
node $HOME/.claude/skills/anatomy/scripts/lines.mjs tools/anatomy-car/build/car-closed-light.html
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun
```

## 9. 라이선스

Anatomy는 MIT 라이선스입니다. 저장소에 포함된 Anatomy 유래 코드는 `tools/anatomy-car/build.mjs`의 `prismPaths`(arcade-cabinet 예제에서 옮김)뿐이며, 해당 위치에 출처를 적고 MIT 라이선스 전문을 `tools/anatomy-car/ANATOMY-LICENSE`에 포함했습니다. 생성된 SVG 형상(`anatomy-car.parts`)은 이 저장소의 build 스크립트가 kit 함수로 계산한 결과입니다. kit, 예제, 검증 스크립트는 저장소에 포함하지 않습니다.
