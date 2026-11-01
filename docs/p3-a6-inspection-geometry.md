# P3-A6 · 차량 점검 부품 3D 형상

2026-11-01, `C:\dev\CarScope-geometry`, `feat/p3-a6-inspection-geometry`.
시작 HEAD / origin/main / 원격 main: `d114223c87288891875751cddd4cbe2aebf10c2e`. 시작 작업 트리는 깨끗했다.
다른 worktree·브랜치는 조회하거나 수정하지 않았다. Android·Pleos·모바일 AR·기존 점검 UI 코드는 변경하지 않는다.

판정: **ESTIMATED_INSPECTION_GEOMETRY**. 부품의 존재와 설명서 그림의 상대 배치는 확인했으나, 실차 위치·형상·치수를 검증한 OEM 모델은 아니다.

## 기존 구조 분석

- 원본 OpenX GLB는 외피 모델이다. `hood.mjs`는 `Door_Front_0`을 복사해 축 A/C로 회전하며 원본을 수정하지 않는다. 실차 힌지는 UNVERIFIED, 0–60°는 SIMULATION_ONLY다.
- `front-compartment.mjs`는 실행 시 원본 보닛 하면을 측정해 Shell과 중앙/좌우 예약 공간을 만든다. 새 패널 자체는 ESTIMATED다.
- `frunk.mjs`는 중앙 테이퍼 수납함·독립 덮개·레버를 생성한다. 57 L는 목표 수학적 용적이며 OEM/VDA 실측이 아니다. 덮개는 별도 강체 축으로 움직인다.
- `service-components.mjs`는 워셔액 주입구의 안팎 벽과 별도 캡을 만든다. 다른 다섯 항목은 예약 상자다. 기존 생성기·기본 표시·점검 흐름과 테스트 계약을 유지한다.
- 공통 삼각형 데이터를 SVG, `frunkGlb` sidecar, Three.js로 사용한다. SVG path에서 3D를 추정하지 않는다. cm, +X 전방 / +Y 차량 좌측 / +Z 위; glTF는 m, `(x,z,-y)/100`이다.

## 차량 자료와 근거 수준

공식 [Hyundai UK 2022 Maintenance 설명서](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf)를 새로 내려받아 관련 그림을 직접 렌더링해 확인했다. 설명서는 실제 구획이 그림과 다를 수 있다고 명시한다. 해당 그림에는 치수선이나 축척이 없다. 픽셀 비례로 실차 cm를 산출하지 않았다.

| 부품 | 확인한 그림과 상대 위치(차량 앞에서 바라본 그림) | 형상에 참고한 내용 | 확인하지 못한 내용 |
|---|---|---|---|
| 냉각수 리저버 | 9-3 ONE1091001 #1, 그림 왼쪽 중간/안쪽; 9-12 ONE1091002 | 어깨가 있는 탱크와 원형 캡. LCW(#2)는 별개 | 실측 외형·두께·용량·호스·체결·대상 사양의 좌우 일치 |
| 브레이크액 리저버 | 9-3 #3, 그림 오른쪽 뒤쪽; 9-13 ONE1091004 | 작은 탱크와 넓은 원형 캡 | 실제 마스터 실린더·체결·수위·치수·좌우 사양 |
| 12V 보조 배터리 | 9-3 #8, 그림 오른쪽 앞쪽; 9-20 ONE1091009 | 직육면체 케이스·상단 덮개·단자 형태 | 장착 배터리의 외형 규격·단자 극성/배선·브래킷·전기 상태. 설명서의 예시 라벨은 외형 치수 근거가 아님 |
| 퓨즈박스 | 9-3 #5, 그림 오른쪽 중간/바깥쪽; 9-32 ONE1091034/35/36 | 모서리가 다듬어진 케이스·별도 덮개 | 실제 덮개 클립·내부 회로/퓨즈·장착부·치수·좌우 사양 |

존재는 `CONFIRMED`, 좌표·치수·형상은 `ESTIMATED`/`ESTIMATED_GEOMETRY`, 시장·좌우·고정부는 `UNVERIFIED`다. 아래 위치는 기존 예약 구획 안에서 그림의 앞뒤 순서를 참고해 배치한 설계값이다. 실차와의 정합성을 확정하지 않는다. 특히 퓨즈박스의 정확한 바깥쪽 오프셋은 미확인이다.

## 순차 모델링 결과

`tools/ioniq5-asset/inspection-components.mjs`는 냉각수 → 브레이크액 → 배터리 → 퓨즈박스 순서로 10개 메시를 만든다. 모두 직접 작성한 작은 치수 파라미터로 생성한다. 캡·덮개·단자는 독립 ID이며 상태나 조작 기능이 없다.

| 기본 ID | 몸체 중심 x/y (cm) | 몸체 X×Y×Z (cm), 하단 z | 전체 형상 범위(cm) | 메시/삼각형 수 |
|---|---|---|---|---|
| `coolant-reservoir` | 149 / −43.5 | 18×18×14, 69 | x140–158, y−52.5–−34.5, z69–85.4 | 몸체+캡, 184 |
| `brake-fluid-reservoir` | 131 / 43 | 12×14×10, 73 | x125–137, y36–50, z73–85.4 | 몸체+캡, 184 |
| `battery-12v` | 167 / 44 | 24×18×19, 62 | x155–179, y35–53, z62–84.2 | 케이스+lid+terminal-1/2, 176 |
| `fuse-box` | 146 / 44 | 12×18×14, 69 | x140–152, y35–53, z69–84.8 | 케이스+lid, 88 |

**모든 수치는 ESTIMATED**다. 높이별 모서리 챔퍼 단면을 연결한 닫힌 외형과 원형 캡을 사용한다. 캡/덮개/단자 사이 0.3 cm 분리는 시각적 이음새 표현이며 실제 조립 공차가 아니다. 호스·배선·숨겨진 내부·물리적 고정부·실제 수위·극성은 모델링하지 않았다. 외형의 수학적 부피를 실제 탱크 용량으로 해석하지 않는다.

독립 모듈의 사용 방법:

```js
const legacy = buildServiceComponents(shell);
const inspection = buildInspectionComponents(shell);
const fixedParts = [...legacy.parts, ...inspection.parts];
const remainingReservations = legacy.reservations.filter(
  p => !inspection.replacesReservations.includes(p.id)
); // lcw-coolant-reservoir만 예약으로 남음
```

이 PR은 위 모듈을 기존 제품/점검 화면에 연결하지 않는다. `inspection-preview-server.mjs`와 `inspection-preview.html`은 읽기 전용 원본 + 별도 sidecar를 보여 주는 독립 데스크톱 Geometry 검토 도구다. 위쪽 보기는 보닛을 숨긴다고 명시한다. 원본 메시·카메라·검사 임계값·기존 검사 대상·Anatomy pin을 변경하지 않는다.

## 새 실행 검증

Windows / Node v22.16.0 / JDK 17.0.20.1, 2026-11-01 KST. 기존 실행 산출물을 새 PASS로 재사용하지 않았다. P3-A1 축 보고서만 입력 SHA를 대조해 사용하고 A축은 원본 계층에서 다시 계산했다.

| Gate | 상태 | 새 실행 결과 |
|---|---|---|
| 신규 형상 테스트 | PASS | 6/6, SKIP 0. 결정성·기존 생성기 보존·신뢰도·낮은 예약 구획 거부·닫힌 manifold·양의 부피·비인접 삼각형 자체 교차·독립 부품 AABB 분리(완전 포함 방지)·GLB 0/30/60° 왕복·실제 원본 정적 충돌 |
| 새 부품 정확 삼각형 검사 | PASS | 361행, 교차 결함 0. 원본 차체·Shell·프렁크·워셔액·LCW와 각 부품 쌍, A/C 보닛 0–60°/1°, 프렁크 덮개/레버 0–60°/1°. 접합 제외 없음 |
| SVG | PASS | 닫힌 원본/기존 부품/신규 부품 포함 출력 바이트 동일. 열린 두 프레임에서 네 기본 ID와 하위 메시 모두 표시. 재생성 결정성 |
| 새 GLB | PASS | 덮개 0/60° 각각 Khronos 오류/경고 0/0. 모든 Shell·프렁크·서비스 정점 최대 왕복 오차 0.000010491 cm |
| 브라우저 | PASS | Chrome headless WebGL2. 로드한 12개 서비스 메시 bounds 대조 오차 ≤0.0001 cm, 네 부품 선택 출처·ESTIMATED/UNVERIFIED 검사, 전체/보닛 숨김 top/side/덮개 열림/닫힘 캡처 9장 직접 확인, console clean |
| 기존 자산 전체 테스트 | PASS | 58/58, 실패/건너뜀 0, `IONIQ5_GLB`와 `IONIQ5_BLEND` 지정 |
| 고정 Anatomy audit | PASS | `npm run build`, pin 1482e8469b0a9e0d8cc18ea2740a01423d29ae80, audit passed, 기본 parts SHA a6f19a53… |
| 기존 Geometry export/verify | PASS | 91부품 / 7,573삼각형, 좌표·면·독립 도어 검사 PASS, Khronos 0/0 |
| 기존 Geometry 테스트 | PASS | `npm test`, 58/58, 실패/건너뜀 0 |
| core 정적 SVG 계약 | PASS | 지정한 Gradle 명령 정상 종료. 33개 중 32 통과·1 건너뜀·실패 0. `IONIQ5_PARTS` 미지정으로 선택적 외부 SVG 입력 테스트만 건너뜀 |
| 기존 프렁크 회귀 | PASS | 전체 4,148 샘플 행, 결함 0, 닫힌 SVG 동일·결정성, 57 L 수학적 cavity 유지 |
| 기존 Shell 회귀 | PASS | quick 아닌 전체 실행. 원본/Shell 간 결함·닫힌 보닛 교차 0, A/C 새 교차 0, 바닥/실내 노출 0, SVG 결정성·닫힘 동일성 유지 |
| 기존 워셔액 회귀 | PASS | 기존 서비스 보고서 286 정확 검사 행, 결함 0, 기존 GLB 0/0·닫힌 SVG 동일성 유지 |
| 원본·기본 생성 자산 보존 | PASS | 원본 GLB SHA `cfe0d754…` 및 기본 parts SHA `a6f19a53…` 실행 전후 동일. Blender는 읽기만 하며 SHA `e8e8788d…` |
| Android·Pleos·모바일 AR·실차·OEM 치수·구조 하중·성능 비교 | NOT_RUN | P3-A6 형상 작업 범위 밖 |

1° 샘플링은 연속 회전 전체의 완전한 무충돌 증명이 아니다. `minCm=null`은 5 cm 이상이라는 하한만 나타낸다. 기존 축 B의 간섭 문제와 실차 힌지 미검증은 그대로 남는다. 신규 닫힌 개별 메시 검사는 비인접 삼각형을 대상으로 하며, 정적 교차 검사는 실차 조립/고정 가능성 검증이 아니다.

초기 환경 이력: PDF 렌더러가 없어 첫 그림 렌더링은 FAIL이었다. 무시되는 로컬 `.tools/p3-a6-python`에 PyMuPDF를 격리 설치한 뒤 관련 다섯 페이지의 렌더링·시각 확인을 완료했다. 첫 원격 main 조회는 sandbox 네트워크에서 FAIL, 승인된 재실행에서 SHA를 확인했다. 최초 core 실행은 XML 결과 생성 뒤 검증 runner가 출력 파이프 반환을 기다려 완료 상태를 수집하지 못했다. 해당 runner만 종료하고 로그 파일에 직접 기록하는 방식으로 core를 재실행해 정상 종료·PASS를 확인했다. 모델 검사 임계값이나 검사 대상 변경으로 통과시킨 사항은 없다.

## 재실행

의존성은 이 worktree의 `tools/anatomy-car`, `tools/three-poc`에서 각각 `npm install`. 원본 자산은 외부에서 읽기만 한다. 모든 `--out`은 이번 작업 전용 외부 폴더로 지정한다.

```powershell
$env:IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:IONIQ5_BLEND='C:/CarScope-External/openx-assets/src/vehicles/hyundai_ioniq_5_2022/hyundai_ioniq_5_2022.blend'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/inspection-components-report.mjs --glb=$env:IONIQ5_GLB --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a6-geometry/report
node tools/ioniq5-asset/inspection-preview-server.mjs --glb=$env:IONIQ5_GLB --report=C:/CarScope-External/p3-a6-geometry/report --port=8098
# 별도 터미널:
node tools/ioniq5-asset/check-inspection-preview.mjs C:/CarScope-External/p3-a6-geometry/browser http://127.0.0.1:8098/
```

기존 회귀(루트, 출력은 전용 폴더):

```powershell
node tools/ioniq5-asset/frunk-report.mjs --glb=$env:IONIQ5_GLB --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a6-geometry/regression/frunk
node tools/ioniq5-asset/front-compartment-report.mjs --glb=$env:IONIQ5_GLB --out=C:/CarScope-External/p3-a6-geometry/regression/front-compartment
node tools/ioniq5-asset/service-components-report.mjs --glb=$env:IONIQ5_GLB --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a6-geometry/regression/service-components
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
# tools/anatomy-car에서 각각:
npm run build
npm run export
npm run verify
npm test
```

기본 Geometry build/core build 출력은 **현재 worktree 내부**의 무시되는 build 경로다. 다른 worktree의 출력 폴더를 사용하지 않는다. 원본 GLB/Blender·파생 GLB/SVG·캡처·실행 로그는 Git에 넣지 않는다. 전용 [외부 증거 인덱스](evidence/p3-a6/README.md)를 공유한다. 별도 PR로 검토하며 자동 병합하지 않는다.
