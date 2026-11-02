# P4-B1 — Pleos 부품 상태 연동

기준 main `846df27`, 별도 `C:/dev/CarScope-pleos-status`, branch `feat/p4-b1-pleos-component-data`. PR #41 및 다른 작업 사본을 보존한다. 연구·아키텍처·구현·검증 기준으로 정적 API 근거와 실행 결과를 분리한다.

## 조사 및 결정

FACT: Maven Vehicle 2.3.2 AAR SHA256 `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937`. 공개 Safety의 washer Boolean/Brake OilLevelState와 EvBattery의 SoC Integer/charge-switch Boolean 및 권한 annotation을 대조했다. 코드의 오타 `LowWasherFluidWaringListener`/`registerLowWasherFluidWaringState`는 AAR 선언 그대로 사용한다. reflection/internal ID/set API는 사용하지 않는다.

FACT: [공식 소개](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro)는 2.3.2, 비동기 capability/get/listener와 callback 종료 전 release 금지를 명시한다. [권한 가이드](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-permission)의 도메인 권한과 개별 AAR annotation을 함께 확인한다. [brake getter 문서](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/safety/get-brake-fluid-level-state)는 이름만 읽을 수 있었으며 washer/SoC 상세 페이지는 본문을 읽을 수 없었다. 이 누락을 다른 REST API·가상 콘솔 범위·일반 EV 지식으로 채우지 않는다.

DECISION: 기존 tire controller 패턴을 따르는 독립 Debug ComponentDataSource/cache/lease를 둔다. 4개 고정 feature는 Safety 2 + EV SoC/charge switch 2다. 기존 `washer-fluid-cap`, `brake-fluid-reservoir` ID는 유지한다. `ev-battery.pack`/`ev-battery.soc`는 내부 데이터 계약만 만들고 형상이나 선택 대상을 생성하지 않는다. 충전 스위치 API는 실제 충전 진행/전력/완료를 의미하지 않는다. SoC 단위·범위는 미검증으로 두고 원시 Integer를 퍼센트로 바꾸지 않는다.

공통 파일 최소 변경 사유: InspectionActivity의 상태 채널 lifecycle, DebugWebScreen/Origin의 고정 cache GET, inspect.js의 기존 두 상세 패널 및 Android asset 복사 목록에 연결 지점이 필요하다. 별도 `component-status.json` 및 고정 active/inactive 이벤트만 추가한다. 기존 Tire/Sync/Back 흐름·CSP·원점·모델·부품 ID·Geometry·카메라·정비 절차는 변경하지 않는다. 기존 상태 패널의 dl/details 시각 패턴을 재사용한다. Debug manifest에 AAR가 요구하는 CAR_ENERGY 조회 권한만 추가하고 Release 권한은 그대로 둔다.

## 실행 범위

AVD/adb/실차 호출은 자동 실행하지 않는다. capability/권한/수신/물리 단위/형상 정확도는 정적 AAR 대조나 합성 테스트로 PASS 처리하지 않는다. SDK 값은 PLEOS, 사용자 기록은 USER_REPORTED로 독립 보존한다. 초기/누락/null/UNKNOWN/실패를 정상 상태로 변환하지 않는다. observedAt은 callback 진입의 앱 수신 시각이며 차량 하드웨어 관측 시각이 아니다. 화면 tick과 HTTP cache GET은 새 SDK 호출이나 관측 시각을 만들지 않는다. 기존 `>5000ms` STALE 정책을 유지한다.

정확한 wire/state/lifecycle 규칙은 [component UI v1 계약](contracts/vehicle-component-ui-v1.md)에 둔다. `source=PLEOS`는 SDK 경로이며 현재 차량과 IONIQ GLB의 identity·배치 일치를 증명하지 않는다. 이번에 vehicle-core, Geometry, GLB, Anatomy, Tire/Sync 데이터 의미, USER_REPORTED 기록은 수정하지 않았다.

## Codex A 전달 사항과 후속 API

| 영역 | 유지/제안할 ID | 데이터 경계와 모델 통합 조건 |
| --- | --- | --- |
| 워셔액 | 기존 `washer-fluid-cap` 유지 | 전체 차량의 low-washer warning을 관련 부품의 SDK 보고 패널로 연결. 특정 실차 리저버 형상/액량 측정 증거 아님 |
| 브레이크액 | 기존 `brake-fluid-reservoir` 유지 | OilLevelState 보고를 패널에만 표시. NORMAL enum도 안전/정비 완료 판정 아님 |
| EV 배터리 | `ev-battery.pack` 부품, `ev-battery.soc` feature 확정 | 12V `battery-12v`와 교환 금지. 아직 메시·월드 좌표·크기·선택 대상 없음. A의 모델 PR 병합 후 별도 선택/UI 연결 PR. SoC를 별도 물리 부품으로 만들 필요 없음 |
| 전조등 | 제안 `light.exterior.low-beam`, `light.exterior.high-beam` (미확정) | 공개 Light.checkLow/HighBeamLightStateCapabilities/getCurrentLow/HighBeamLightState 및 CAR_LIGHTS 대조. 현재 전역 조회이고 좌/우별 센서라고 해석하지 않음. 기존 component registry에 ID가 없어서 연결하지 않음 |
| 와이퍼 | 제안 `wiper.front`, `wiper.rear` (미확정) | 공개 Wiper.checkWiperStateCapabilities/getCurrentWiperState, WindowArea(FRONT_WINDSHIELD/REAR_WINDSHIELD), CAR_WINDOWS 대조. capability의 정확한 area/state가 확인돼야 함. 형상·좌표는 A가 결정하고 모델 계약 PR 선행 |

Light/Wiper는 공개 조회 후보의 정적 검토만 했다. 제안 ID를 이번 geometry/3D 목록에 생성하지 않는다. 실제 지원·권한·수신은 모두 NOT_RUN이다. 새 영역을 현재 임의 메시 이름이나 추정 좌표에 붙이지 않는다. 등록되지 않은 영역을 추가하려면 상태/ID 계약부터 별도 PR로 확정한다.

## 검증 및 재실행

```powershell
python tools/component-probe/check.py sdk-audit --out C:/CarScope-External/p4-b1/sdk-audit/repro
npm ci --ignore-scripts --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
# 기존 CI: :app:testDebugUnitTest / assembleDebug / assembleRelease / bundleRelease / lintDebug
python tools/component-probe/check.py boundary
node tools/component-probe/check-native.mjs app/build/test-results/component-ui-v1.json
# 위 마지막 명령은 source=MOCK인 실제 Kotlin 합성 JSON만 COMPONENT_UI_SYNTHETIC_JSON 줄로 출력한다.
# CI log의 그 JSON을 외부 native-contract.json으로 추출한 다음 (원본 log는 Git 밖 보관):
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
node tools/three-poc/check-component-status.mjs C:/CarScope-External/p4-b1/browser C:/CarScope-External/p4-b1/native-contract.json
```

Chrome 도구는 OS가 배정한 loopback port에서 자체 서버를 띄우고 그 자식만 종료한다. 기존 서버/AVD/다른 worktree는 조작하지 않는다. Native 합성 packet과 기존 실제 GLB의 화면을 검증하지만 Android Runtime 또는 실제 PLEOS 관측 성공은 아니다. 기존 Tire/제품 흐름 회귀도 별도로 실행한다. 새 CI step은 public AAR annotation, 20개 이상 Component JVM/Robolectric 검사, 권한·APK/AAB 경계 및 실제 Kotlin serializer→JS consumer를 검증한다. raw javap/SDK는 외부 경로에만 저장한다.

결과 및 실패 이력은 [증거 인덱스](evidence/p4-b1/README.md)를 참조한다. AVD/adb 및 실제 Safety/EV 권한·capability·값·listener·원격 cleanup은 NOT_RUN으로 유지한다.
