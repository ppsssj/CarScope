# P3-G1 — 네 타이어 3D 식별과 점검 인터랙션

작성: 2026-11-01. 기존 타이어 형상을 재사용해 4개 부품 ID를 독립 선택 대상으로 연결했다. **Pleos 실제 데이터는 연결하지 않았다.** [Tire v1 계약](contracts/vehicle-tire-v1.md)의 내부 ID만 통합 키로 사용한다.

## 기준과 작업 환경

- fetch 후 origin/main / 시작 HEAD: `9af52fbf060a02ec830cdb10b57f54c133cb9960`.
- PR #27 `1ea7698`, #28 `544d377`, #30 `9af52fb` 모두 MERGED 확인.
- 시작 시 기존 P3-G1 브랜치·원격 브랜치·Worktree·권장 폴더가 없었다. 새 `feat/p3-g1-tire-geometry`, `C:\dev\CarScope-tire-geometry`를 생성했고 시작 working tree는 clean이었다.
- 기존 Geometry/Codex/Claude/AR 작업 사본을 수정하지 않았다. SDK controller, MainActivity, vehicle-core, 모바일 AR, 기존 Geometry 모듈과 좌표·치수도 변경하지 않았다.
- 원본·생성 자산·캡처·로그·APK는 Git에 넣지 않는다. [외부 증거 인덱스](evidence/p3-g1/README.md).

## 원본 GLB와 방향 검증

분석 대상: `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb` (1,902,820 bytes). SHA256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`.

기존 [profile.mjs](../tools/ioniq5-asset/profile.mjs)의 커뮤니티 자산 출처·축 계약을 유지했다. Three.js `GLTFLoader`로 실제 scene hierarchy와 **전체 vertex의 world-space Bounds**를 조사하고, 별도의 원본 GLB accessor/TRS 분석 결과와 대조했다. 원본을 저장하거나 geometry·부모 관계를 재배치하지 않는다.

- CarScope: cm, +X 전방 / +Y 차량 좌측 / +Z 위.
- glTF: m, Y 위. `(gx, gy, gz) → (gx, -gz, gy) × 100`.
- 모델의 보닛 `Door_Front_0`은 X `[99.510, 223.512]`cm, 중앙 브레이크등 `Light_Brake_Center_0`은 X `[-179.099, -178.397]`cm다. 소스의 축 선언과 실제 전후 형상 위치가 일치한다. 브라우저에서 범퍼·보닛이 있는 쪽과 뒤쪽을 함께 확인했다.
- 좌측은 glTF −Z / CarScope +Y다. 원본 suffix `_0`은 우측, `_1`은 좌측이므로 이름의 숫자 순서나 화면 좌우로 추측하지 않았다.

### 실제 메시 매핑과 Bounds

아래 Bounds는 **고무 Tire primitive**의 world-space CarScope cm이며 소수점 셋째 자리로 반올림했다. 이 자산에서는 고무가 assembly의 외곽 Bounds도 결정한다.

| 내부 vehiclePartId | GLB wheel node | Tire primitive index (0부터) | Three.js 고무 mesh | Bounds min (X,Y,Z) cm | Bounds max (X,Y,Z) cm |
|---|---|---:|---|---|---|
| tire.front-left | Wheel_0_1 | 0 | Wheel_0_1_1 | (108.290, 64.684, 0.000) | (183.429, 89.735, 75.125) |
| tire.front-right | Wheel_0_0 | 0 | Wheel_0_0_1 | (108.290, -89.772, 0.000) | (183.429, -64.721, 75.125) |
| tire.rear-left | Wheel_1_1 | 2 | Wheel_1_1_3 | (-193.950, 64.684, 0.000) | (-118.811, 89.735, 75.125) |
| tire.rear-right | Wheel_1_0 | 0 | Wheel_1_0_1 | (-193.950, -89.772, 0.000) | (-118.811, -64.721, 75.125) |

각 바퀴의 hierarchy는 `Grp_Root → Grp_Exterior → Grp_Exterior_Dynamic → Grp_Wheel_i_j → Grp_Wheel_Steering_Rotating_i_j → Wheel_i_j`다. Wheel node는 다음 여섯 material primitive로 구성된다: `Tire`, `Rim_Black`, `Rim_Machined`, `Rim_Aero`, `Brake_Disc`, `Chrome`. 뒤 왼쪽의 순서만 Tire가 세 번째이며 **배열 인덱스로 타이어를 결정하지 않는다**. 별도 `Brake_Caliper_i_j`는 같은 wheel group의 다른 steering branch에 있고 선택/강조 대상에 포함하지 않는다.

타이어 고무는 각 574 triangles / 519 vertices다. 원본 형상이 충분해 새 타이어·픽킹 proxy·중복 메시를 생성하지 않았다. 외경 약 X 75.138cm / Z 75.125cm, 폭 약 25.050cm다. 이는 **모델 측정값**이며 실차/OEM 타이어 규격이 아니다. 재질 clone과 userData만 runtime에서 부여하며 원본 geometry/indices/TRS는 바꾸지 않는다.

`resolveTireTargets`는 node·부모 이름, material, 유일성, 전후·좌우 부호, 높이와 원형 외곽 크기를 함께 확인한다. 조건에 맞지 않으면 오류로 차단하고 UI에 매핑 확인 실패를 표시한다. 검증 범위는 이 IONIQ 5 참조 모델이며 임의 차량 자동 식별기는 아니다. `node`/mesh 명칭은 내부 매핑 근거이고 외부 데이터 계약이 아니다.

## UI와 상태

기존 Three.js, OrbitControls, state machine, camera tween과 강조 로직을 재사용했다. 새 엔진·UI 라이브러리는 없다.

- 점검 부위 목록에 타이어 영역을 추가했다. `TIRE_SELECTION → TIRE_PREVIEW`로 네 바퀴를 각각 목록/3D에서 선택하고 연속 전환한다. Overview의 실제 타이어 클릭도 허용한다.
- 휠 내부 rim/disc/chrome의 **가장 가까운 실제 표면**을 눌러도 같은 wheel의 타이어 ID로 연결한다. 강조는 선택 타이어의 Tire 고무 한 메시만 적용하며 rim·caliper·다른 타이어는 강조하지 않는다.
- 기존 nearest visible mesh raycast를 유지한다. 차체·가까운 바퀴가 먼 바퀴를 가리면 먼 바퀴를 관통해 선택하지 않는다. 반대편은 드래그 회전 또는 목록으로 접근한다.
- 선택 카메라는 고무 Bounds 중심과 크기, 화면 비율 및 패널의 가용 영역으로 계산한다. 차량 바깥 측면에서 약간 위쪽 방향으로 접근한다. 목록 카메라는 4개 타이어 전체 AABB의 8개 꼭짓점을 투영해 구도를 맞춘다.
- 뒤로 가기는 선택 해제, 이전 camera position/target/zoom limit, 목록 scroll/focus를 복원한다. viewport가 바뀌었으면 새 화면에 맞춰 목록 시점을 계산한다. 빠른 선택·뒤로·종료는 기존 target-driven tween을 교체하며 이전 강조를 지운다.
- 타이어 탐색 중 보닛은 닫힌 상태다. QR/점검 완료 상태로 전이하지 않는다. 기존 보닛·shell·frunk·워셔액·4개 preview 부품과 LCW 준비 중 상태는 유지했다.
- 모든 조작 버튼은 최소 44 CSS px이며 portrait는 기존 하단 sheet, landscape는 기존 우측 panel을 사용한다. 데이터 항목은 좁은 화면에서도 읽을 수 있도록 definition list로 표시한다.

상태 패널은 위치, 내부 ID, 데이터 출처 **없음·미연동**, capability/availability **UNVERIFIED**, 최종 관측 시각 **없음**을 표시한다. `detachedTireInfo`의 null source는 UI의 미연동 metadata이며 tire-v1의 PLEOS/MOCK observation을 생성한 것이 아니다. 실제 값·단위·수신 시각을 만들지 않고 공기압 변환, 정상/비정상 또는 녹색/적색 건강 배지를 제공하지 않는다. 테스트에도 압력 mock을 넣지 않았다.

## 검증 결과

| 검사 / 명령 | 판정과 근거 |
|---|---|
| 시작 baseline `node --test tools/three-poc/test/*.test.mjs` | PASS — 기존 12개 |
| 최종 `npm test --prefix tools/three-poc` | PASS — 18개. 4 ID/형상·부모 검증, 좌우/앞뒤 반전 거부, 실제 Three raycaster/차체 가림, 상태 전환, 미연동 metadata, 8-corner fit 포함 |
| `npm run test:android-assets --prefix tools/three-poc` | PASS — 상대 import, 두 신규 모듈 바이트, 기존 builder·CSP·GLB 미포함 |
| 실제 Chrome 1600×1000 | PASS — 39개 assertion, 4개 실제 마우스 선택, camera 복원 0.0001 오차, 선택 중 실제 viewport 변경 2개 포함, console clean |
| 실제 Chrome 420×860 / 1024×600 | PASS — 각각 36개 assertion, 반대쪽으로 실제 pointer drag 후 4개 실제 마우스 선택, 44px·화면 fit·가림 검사, console clean |
| 기존 4부품 브라우저 회귀 1600×1000 / 420×860 | PASS — 각각 34개 assertion, 10개 메시·강조·카메라·뒤로·종료·LCW 준비 중 유지 |
| 워셔액/보닛/QR 브라우저 회귀 1600×1000 | PASS — 17개 assertion, 애니메이션 취소/재개·QR handoff·연속 입력 포함 |
| `node --test tools/ioniq5-asset/test/*.test.mjs` (IONIQ5_GLB/BLEND 실제 경로 지정) | PASS — 58개, skip 0 |
| `npm run build --prefix tools/anatomy-car` | PASS — pinned Anatomy audit, 공통 parts 자산 Git 변경 없음 |
| Anatomy export / test / verify | PASS — 58개 테스트, 91 parts / 7,573 triangles, Khronos GLB 오류 0·경고 0, 기존 좌표·강체성·sampled collision |
| `inspection-components-report.mjs` 실제 GLB/P3-A1 axes 사용 | PASS — exact triangle 검사 361개, 실패 0, closed SVG 동일, 생성 GLB 오류 0·경고 0 |
| `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks` | PASS — 37 pass / 기존 optional IONIQ5_PARTS 미설정 1 skip |
| `:vehicle-core:test :app:testDebugUnitTest --rerun-tasks` | PASS — app 59개 (기존 Tire 29, Door 19 포함), core 위와 동일 |
| `:app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks` | PASS — 106 tasks 실행. lint 오류 0, 경고 14. 최종 UI 자산으로 Debug APK 추가 재생성 |
| 최종 Debug APK 바이트 대조 / `identity-probe` 및 `tire-probe` build-contract | PASS — 5개 최종 UI 모듈이 APK에 원본 바이트로 포함. Release APK/AAB에 inspection 자산·외부 GLB·Debug 화면 미포함 |
| 원본/변경 금지 범위 / `git diff --check` | PASS — GLB/Blender hash 동일, 원본 Geometry/SDK/AR/vehicle-core 변경 없음 |
| Pleos AVD GUI | **BLOCKED** — fresh health gate에서 실행 기기 없음 |

Android 환경은 JDK 17 / Gradle 8.14 / Android SDK34 / 기존 Pleos Vehicle 2.3.2다. lint의 14개 warning은 target API/dependency/기존 JS 화면/data extraction/icon/TextI18n이며 성공과 구분해 기록한다. 바퀴 화면과 상태 snapshot의 실제 Pleos 통합 성공을 뜻하지 않는다.

첫 portrait 검사는 고정 거리의 목록 시점에서 앞 타이어 중심이 약 5px 화면 밖으로 나가는 문제를 드러냈다. 목록 카메라를 전체 타이어 Bounds 기반으로 바꾸고 8개 꼭짓점의 투영 및 실제 클릭 검사를 추가했다. 기존 오차/충돌 임계값을 올리지 않았다. 확대된 zoom limit도 복원해 모바일에서 시점 복원 후 clamp가 발생하지 않도록 했다.

강조 검사 확대 과정에서 테스트 hook이 기본 emissiveIntensity=1, emissive=black인 rim도 강조로 오인했다. 실제 화면에서 rim은 원래 재질을 유지했으며 hook을 intensity와 emissive color를 함께 검사하도록 정정했다. 초기 실패는 `final-portrait`/`final-*-v4`, 최종 결과는 `final-*-v5`로 분리 보관한다.

Anatomy/충돌 회귀는 기존 sampled rotation 검증이며 연속 회전 전체의 완전한 무충돌 증명이 아니다. 기존 형상 모듈을 수정하지 않았으므로 타이어의 기존 wheel–body 관계도 원본 그대로다. 실차 형상 정확도, OEM 치수, 실제 휴대폰 터치·GPU 성능 및 실제 데이터 연결은 검증하지 않았다.

## Android 및 AVD

`build-android-inspection.mjs`가 `inspection-tires.mjs`와 `tire-targets.mjs`를 Debug inspection 자산으로 복사한다. Geometry module의 기존 전이 의존성 추적은 유지했다. 패키징 테스트가 두 모듈의 원본 바이트, 모든 상대 import, CSP 및 GLB 미포함을 확인한다. Android Activity, WebView 보안 경계와 모델을 app-private storage에서 읽는 방식은 변경하지 않았다.

AVD Health Gate: **2026-11-01 08:18:13 UTC**, `emulator-5554 get-state`가 47ms / exit 1 / `device not found`. 실제 Android GUI는 **BLOCKED**다. 기기 CPU·load·서비스를 측정할 수 없어 PASS로 간주하지 않았다. 재시작·설치·실행·리소스 변경을 하지 않았다. APK 빌드 성공과 실제 AVD 화면 검증은 구분한다.

## P3-I1 연결 조건

형상 측 네 ID 매핑과 선택/패널 표시 경계는 준비됐다. P3-I1은 SDK 이름·mesh 이름 대신 `(featureId, vehiclePartId)`로 두 Tire feature × 네 ID의 immutable snapshot을 전달해야 한다. 현재 `detachedTireInfo`와 panel 렌더링 위치를 데이터 소비 지점으로 교체하되 이번 단계에는 native bridge나 SDK 호출을 추가하지 않았다.

capability/availability/source/observedAt/reason 변경과 STALE 전환에 따라 표시를 갱신하고, 화면 tick으로 새 관측 시각을 만들거나 자동 정상 상태로 바꾸지 않아야 한다. SDK는 #30의 process owner/UNRESOLVED 차단을 유지하고 화면 재생성이 새 SDK session을 우회하지 않도록 해야 한다. raw Float와 단위가 미검증이므로 **P3-I1의 초기 연결은 상태 배지에 한정**하는 것을 권고한다. 실제 압력 숫자·단위·정상 판정은 실제 런타임과 공식 단위·의미를 별도 검증한 후 진행한다.

## 재실행

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/anatomy-car
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
node tools/three-poc/analyze-tires.mjs C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb C:/CarScope-External/p3-g1-tire/mapping
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:CARSCOPE_QR_AR_BASE_URL='https://inspection.example.test/'
$env:PORT='8113'
node tools/three-poc/serve.mjs
# 별도 터미널. 마지막 인자를 420 860 / 1024 600으로도 실행한다.
node tools/three-poc/check-tires.mjs C:/CarScope-External/p3-g1-tire/recheck http://127.0.0.1:8113/inspect.html?capture=1 1600 1000
node tools/three-poc/check-inspection-components.mjs C:/CarScope-External/p3-g1-tire/components-recheck http://127.0.0.1:8113/inspect.html?capture=1 1600 1000
node tools/three-poc/check-inspection.mjs C:/CarScope-External/p3-g1-tire/washer-recheck http://127.0.0.1:8113/inspect.html?capture=1 1600 1000
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
```

로컬 Gradle은 `--max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" "-Pkotlin.compiler.execution.strategy=in-process"`로 실행했다. 브라우저 검사는 기존 pinned Anatomy `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`의 driver를 수정 없이 사용한다. 1600px 검사는 same-origin iframe의 실제 viewport를 420×860 / 1024×600으로 변경해 선택 중 resize를 확인한다. 예시 QR origin은 테스트 구성일 뿐 운영·스테이징 배포나 외부 페이지 호출이 아니다.
