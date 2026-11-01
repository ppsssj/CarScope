# P3-A7 · 점검 부품 Geometry와 3D UI 연결

2026-11-01 KST, Windows / Node v22.16.0 / JDK 17.0.20.1. 새 worktree `C:\dev\CarScope-p3-a7`, 브랜치 `feat/p3-a7-inspection-components-ui`.
작업 전 `git fetch origin main`으로 확인한 기준은 `8c00b3fdfc72a9aecc7b599fafe9cf0998312264`(PR #25 병합)이다. 기존 Codex 작업 사본은 깨끗했고 새 worktree도 깨끗한 상태에서 시작했다. PR #26과 다른 작업 사본·브랜치는 작업에 포함하지 않았다.

**브라우저 탐색·Android 패키징 PASS, Pleos AVD 실행 BLOCKED.** 네 부품은 모델 탐색만 제공하며 실제 점검 완료·QR·정비 절차를 제공하지 않는다.

## 구조와 동작

기존 `inspect.js`는 Shell → 닫힌 프렁크 → 워셔액만 생성했고, `inspection-flow.mjs`는 워셔액 상세/QR만 처리했다. Android `InspectionActivity`와 `DebugWebScreen`은 같은 페이지를 debug 자산으로 제공하고 모델만 앱 전용 저장 공간에서 읽는다. 이 Android Kotlin 경계는 수정하지 않았다.

`buildInspectionComponents(shell)`의 반환 메시 10개를 한 번 생성하고 `meta.inspectionTarget`으로 네 그룹을 구성한다. 캡·덮개·단자도 같은 대상에 속한다. 예약 상자는 추가하지 않는다. P3-A6 좌표·형상·치수와 외부 원본은 그대로다.

| 대상 | 상태 / UI 동작 |
|---|---|
| 냉각수 리저버, 브레이크액 리저버, 12V 보조 배터리, 퓨즈박스 | `COMPONENT_PREVIEW`: 3D/목록 선택 → 그룹 강조 → Bounds 기반 카메라 이동 → 부품명·모델 위치·정확성 안내 → 뒤로 |
| 워셔액 | 기존 `WASHER_SELECTED` → `MOBILE_HANDOFF_READY` 유지. QR 주소 설정 조건도 유지 |
| 저전도 냉각수(LCW) | 준비 중, 비활성. 미구현 Geometry를 표시하지 않음 |

새 상태는 `REQUEST_HANDOFF`와 완료 이벤트를 무시한다. 네 항목의 배지는 **형상 보기**이며 워셔액의 **점검 가능**과 구분한다. 안내 상단에 모델 위치/형상·치수는 추정, 차량별 배치는 미검증, 점검·정비 절차는 미제공이라고 표시한다. 신규 부품 패널에는 캡 개방·유체 주입·배터리 극성·전기 작업 안내가 없다.

보닛이 열릴 때 같은 bay 그룹에 부품을 표시한다. raycast는 원본 차체·보닛·Shell을 포함한 **가장 가까운 가시 메시**를 선택하므로 닫힌 보닛이나 차체 뒤의 부품을 통과해 선택하지 않는다. 추정 리저버는 밝은 베이지색, 케이스는 무광 계열이며 선택 그룹 전체에 기존 청록색 강조를 적용한다. 다른 대상을 선택하면 이전 그룹 강조를 해제한다.

`inspection-camera.mjs`는 그룹의 실제 world bounds를 감싸는 구의 크기, full-screen FOV, 목록 패널을 제외한 가용 픽셀 영역으로 거리를 계산한다. 원본 Geometry나 세계 좌표를 변경하지 않는다. 새 카메라 목표는 진행 중인 tween의 현재 위치에서 시작하며, OrbitControls 관성을 정리한다. 실제 viewport 크기가 유지된 transient resize는 저장 시점을 덮어쓰지 않는다.

목록에서 상세로 들어갈 때 카메라 위치/target·목록 스크롤·항목을 저장한다. 뒤로 가면 같은 크기의 화면에서는 해당 시점을 복원하고 항목에 포커스를 돌려준다. 그 사이 화면 크기가 달라졌으면 현재 비율의 bay 구도로 다시 맞춘다. 보닛 닫기/종료 시 선택·강조·저장 시점을 정리한다. 버튼은 최소 44 CSS px, 상세 제목에 포커스를 두며 세로 화면은 기존 bottom sheet를 유지한다.

## Android 패키징과 보안

기존 Geometry 의존성 추적이 `inspection-components.mjs` → `service-components.mjs`/Shell/layout/frunk를 따라가는 것을 통합 테스트로 확인했다. 새 카메라 보조 모듈은 페이지 모듈 복사 목록에 추가했다. 실제 debug APK의 점검 자산 **20개**를 생성 디렉터리와 바이트 비교했다. 카메라 보조 모듈과 P3-A6 생성기가 포함되며 GLB는 포함되지 않는다.

원본 GLB 경로는 기존 `files/debug-3d-assets/ioniq5.glb`, private origin은 `https://carscope-inspection.invalid/` 그대로다. CSP·외부 요청/탐색 차단·JS bridge 미사용·앱 전용 파일 경계도 변경하지 않았다. release APK/AAB에서 점검 자산 0개, lab 클래스·비공개 host·모델 경로 marker 0개, GLB 0개를 확인했다. MainActivity·Pleos·도어 이벤트·vehicle-core·모바일 AR·운영/스테이징 설정은 수정하지 않았다.

Android shell 로그에 대상별 버튼/3D 좌표와 `component`를 추가했다. 같은 `COMPONENT_PREVIEW` 안에서 대상만 바뀌어도 새 settled 로그를 낸다. AVD 검증 스크립트도 네 부품의 실제 터치/목록 선택을 검사하도록 확장했으나 **이번 환경에서 실행하지 않았다**.

## 새 실행 검증

작업 전 기준: three-poc **9/9**, 실제 외부 GLB/Blender를 지정한 ioniq5-asset **58/58**, 실패·건너뜀 0. 기준 로그와 이후 결과는 모두 `C:\CarScope-External\p3-a7\`에 분리했다.

| Gate | 상태 | 명령 / 새 실행 근거 |
|---|---|---|
| 상태 머신·카메라 단위 테스트 | PASS | `npm test` in tools/three-poc: **12/12**, 실패·건너뜀 0. 네 preview·중복·전환·뒤로·종료·late callback·QR 거부와 가용 frustum 검사 |
| Android 자산 통합 테스트 | PASS | `npm run test:android-assets`: **1/1**, 실패·건너뜀 0. 실제 생성·상대 import 누락·P3-A6 파일 바이트 동일성·CSP·GLB 미포함 |
| 신규 부품 브라우저 | PASS | `check-inspection-components.mjs`: **1600×1000 / 420×860 / 1024×600 각각 34/34**, console clean |
| 실제 화면 확인 | PASS | 세 크기의 목록·네 부품 상세·종료 캡처. 넓은 화면·차량 화면·세로 화면에서 그룹 강조와 안내를 직접 검토. 네 부품의 실제 CDP 포인터 클릭, 목록과 대상 일치, QR 거부, 정확한 시점/스크롤/포커스 복원, 빠른 전환·뒤로·종료 확인 |
| 워셔액/보닛/QR 회귀 | PASS | 기존 `check-inspection.mjs`: 1600×1000·420×860 각각 **17/17**, console clean. 보닛 중복·중간 취소·개폐, 워셔액 선택·상세·QR 링크/이미지·뒤로·종료 |
| P3-A6 공통 형상·충돌 | PASS | 기존 `inspection-components-report.mjs`: **361행 결함 0**, 닫힌 SVG 바이트 동일, GLB 0/60° 오류·경고 0/0, 좌표 왕복 최대 0.000010491 cm |
| 기존 자산 Geometry 테스트 | PASS | 작업 전 최신 main에서 `node --test tools/ioniq5-asset/test/*.test.mjs`, 실제 GLB/Blender 지정 **58/58**. 이후 해당 소스 변경 0 |
| Android 빌드·JVM·lint | PASS | `gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --console=plain` 성공. app JVM **30/30**, 실패·건너뜀 0. 최종 UI 자산으로 debug APK 재생성 |
| Debug 실제 포함·Release 격리 | PASS | debug 자산 20개 바이트 대조. `python tools/identity-probe/check.py build-contract` 3/3 및 release APK/AAB ZIP·DEX 검사 통과 |
| 원본·금지 범위 보존 | PASS | 외부 GLB/Blender SHA 실행 전후 동일. `git diff --exit-code -- tools/ioniq5-asset tools/mobile-ar-poc app/src vehicle-core` 변경 없음 |
| Pleos AVD 신규 UI 실행 | **BLOCKED** | emulator-5554 연결됨. guest CPU `0-1`, loadavg 6.9~19.2 지속, 최종 health 관측 8.04/10.38/8.99. 과부하 상태에서 재부팅·설치·실행을 강행하지 않음. `avd-health.json` |
| 실차/실기기·실제 폰 QR 스캔·AI 진단·성능 비교 | NOT_RUN | 이번 결과는 데스크톱 브라우저와 빌드/패키징 증거임 |

Geometry 검사는 기존 1° 샘플링이며 연속 회전 전체의 완전한 무충돌 증명은 아니다. 실제 차량별 배치·OEM 치수와 정비 절차는 여전히 미검증이다. QR 검증에는 외부 페이지를 호출하지 않는 예시 origin `https://assist.example.test/`를 사용했다. 운영·스테이징 주소나 설정을 변경하지 않았다.

검증 중 실패와 정정도 구분한다. 초기 세로 화면 검사는 목록 항목이 sticky 버튼 뒤에 있는 상태의 클릭과 캡처 중 transient resize로 인한 시점 복원 차이를 드러냈다. 목록 클릭 전 스크롤/실제 클릭 시점의 독립 기대값을 기록하고, UI는 영속 viewport 변경에만 재구도하도록 수정했다. 복원 허용 오차는 기존 0.0001을 유지했다. 세로 카메라 fit은 전체 FOV와 실제 가용 픽셀 영역으로 정정하고 단위 검사를 추가했다. 실패 로그는 초기 portrait 폴더에, 최종 PASS는 `final-*`에 구분한다.

패키징 통합 테스트는 Three.js/qrcode 설치가 필요하므로 `test-integration`과 별도 명령으로 분리했다. 기존 CI의 의존성 없는 단위 테스트 명령을 유지하면서 패키징 검사 자체는 모든 assertion을 그대로 실행한다. 준비 중 기대값은 5개에서 **LCW 1개**로 의도적으로 갱신하고 네 preview를 별도로 검증했다.

## 재실행

새 worktree에서 실행하며 다른 작업 사본의 자산·출력 디렉터리를 사용하지 않는다.

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/anatomy-car
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:IONIQ5_BLEND='C:/CarScope-External/openx-assets/src/vehicles/hyundai_ioniq_5_2022/hyundai_ioniq_5_2022.blend'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/inspection-components-report.mjs --glb=$env:IONIQ5_GLB --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a7/geometry
$env:PORT='8107'
$env:CARSCOPE_IONIQ5_GLB=$env:IONIQ5_GLB
$env:CARSCOPE_QR_AR_BASE_URL='https://assist.example.test/'
node tools/three-poc/serve.mjs
# 별도 터미널: 마지막 두 인자를 420 860 / 1024 600으로도 실행
node tools/three-poc/check-inspection-components.mjs C:/CarScope-External/p3-a7/final-wide http://127.0.0.1:8107/inspect.html?capture=1 1600 1000
node tools/three-poc/check-inspection.mjs C:/CarScope-External/p3-a7/washer-wide http://127.0.0.1:8107/inspect.html?capture=1 1600 1000
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --console=plain
python tools/identity-probe/check.py build-contract
```

AVD가 정상 부하일 때 별도로 debug APK 설치·앱 전용 모델 주입 후 기존 `avd-android-inspection.mjs --out=C:/CarScope-External/p3-a7/avd`로 확장된 터치 검증을 재실행할 수 있다. 이번 AVD PASS를 의미하지 않는다.

변경 파일: `inspect.js/html`, `inspection-flow.mjs`, 새 `inspection-camera.mjs`, `serve.mjs`, `build-android-inspection.mjs`, `android-inspect-shell.js`, 브라우저/AVD 검사 스크립트와 관련 테스트·package script, 이 보고서와 [증거 인덱스](evidence/p3-a7/README.md). 원본·생성 자산·APK·캡처·로그는 커밋하지 않는다. 별도 PR로 검토하며 자동 병합하지 않는다.
