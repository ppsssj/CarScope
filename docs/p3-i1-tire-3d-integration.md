# P3-I1 — Pleos Tire 상태와 3D 점검 UI 연결

작성: 2026-11-01. Debug Inspection 화면이 공유 Tire cache의 **상태 전용 projection**을 소비한다. 실제 압력 수치·단위·정상/저압/안전 판정은 제공하지 않는다. 실제 Pleos AVD 런타임은 **BLOCKED**이며 아래 합성 검증과 구분한다.

## 기준과 범위

- 시작 fetch 후 main: `97ef8088d7fb5e35f9734cf193c545ec7180a6e6`.
- PR #28 `544d377`, #30 `9af52fb`, #31 `97ef808`, #32 `374f04f` 모두 MERGED 확인.
- 기존 P3-I1 브랜치/Worktree가 없어 `feat/p3-i1-tire-3d-integration`, `C:\dev\CarScope-tire-integration` 생성. 시작 상태 clean.
- 기존 작업 사본, MainActivity, Door controller, EvBattery, vehicle-core, Geometry, AR-02A/AR-02B 및 모바일 AR 코드는 수정하지 않았다. 기존 Tire SDK transport/controller의 취소·timeout·STALE·release 정책도 변경하지 않았다.
- [상태 UI 계약](contracts/vehicle-tire-ui-v1.md), [기존 raw 데이터 계약](contracts/vehicle-tire-v1.md), [증거 인덱스](evidence/p3-i1/README.md).

## Native → WebView 구현

```text
TireProcessOwner (applicationContext, process singleton)
  → TireProbeOwner (one controller/worker, latest lease)
  → PleosTireDataSource.readSnapshot() (immediate cache, existing age policy)
  → TireUiChannel / TireUiProjection (8 allowlisted status rows)
  → GET https://carscope-inspection.invalid/tire-status.json
  → strict JS validation / single-flight client / status store
  → selected tire's status region (model and camera unchanged)
```

기존 private HTTPS origin과 CSP를 유지하고 JSON 경로 하나만 추가했다. 요청은 SDK 작업이 아니라 cache 조회다. Native는 feature/part ID, capability, availability, source, observedAt과 제한된 UI 세대/세션 진단만 직렬화한다. **value/unit/reason/raw Float/SDK 객체/예외 메시지는 전송하지 않는다.** 수동 JSON 작성에는 enum·제한된 UUID·정수/null만 사용하며 자유 입력 문자열은 포함하지 않는다. 실제 Kotlin 직렬화 결과를 별도의 JavaScript validator로 재검증했다.

`DebugWebOrigin`은 정확한 HTTPS host, 기본 443, GET, userinfo 없음, traversal 없음으로 요청 범위를 제한한다. 상태 경로에는 query/fragment/encoded alias도 허용하지 않는다. 다른 Debug host에는 JSON provider가 없으므로 이 endpoint가 없다. 기존 file/content access=false, 외부 navigation 차단, CSP `connect-src 'self'`와 no-store를 유지했다. JS Interface나 native 제어 함수는 추가하지 않았다.

pause/resume에는 고정된 두 lifecycle 이벤트만 evaluateJavascript로 보낸다. 문자열에 payload/URI/예외를 삽입하지 않는다. JSON 자체는 eval하지 않고 fetch→JSON.parse→계약 검증을 거친다. 1개 in-flight 요청, 완료 후 1초 재조회이며 transport timeout 3초는 fetch abort다. SDK의 실제 pending 취소로 처리하지 않는다.

## 8개 행과 화면

| 3D 부품 ID | 원본 wheel node | 독립적으로 소비하는 feature |
|---|---|---|
| tire.front-left | Wheel_0_1 | tire.pressure / tire.low-pressure |
| tire.front-right | Wheel_0_0 | tire.pressure / tire.low-pressure |
| tire.rear-left | Wheel_1_1 | tire.pressure / tire.low-pressure |
| tire.rear-right | Wheel_1_0 | tire.pressure / tire.low-pressure |

부품 ID로만 데이터를 결합하며 SDK WheelArea나 mesh 이름을 wire key로 사용하지 않는다. JS validator는 8개 조합의 고유성·누락·상태·출처 일관성·관측 시각과 추가 필드까지 검사한다. capability의 STALE과 availability의 UNRESOLVED는 거부한다. UNRESOLVED는 sessionPhase 전용이다.

각 선택 패널에는 위치/ID, PLEOS·MOCK·미연동 출처, 두 feature별 Capability/Availability/관측 시각, 연결·세션 진단을 표시한다. 상태 배지는 중립색이고 SUPPORTED/STALE을 건강 또는 안전 색상으로 해석하지 않는다. ATTACHED는 앱 소유권일 뿐 실제 SDK 연결 완료가 아니라고 명시한다. MOCK은 모의 데이터로 표시한다.

같은 metadata에서 sequence만 증가하면 DOM을 갱신하지 않는다. 실제 상태가 바뀌어도 `tireStatusContent`만 교체한다. 모델 reload, flow transition, camera tween, 선택 목록 재생성을 하지 않는다. 기존 camera/scroll/focus 복원과 raycast·고무 강조·보닛/부품/QR 흐름을 유지했다. G1 테스트의 단일 미연동 상태 기대값은 **두 feature가 모두 UNVERIFIED인지** 검사하도록 확장했으며 기존 선택·복원 오차를 완화하지 않았다.

## 세션 소유권과 종료

이전 Probe Activity의 private processOwner를 `TireProcessOwner`로 이동해 Inspection과 Probe가 공유한다. source/worker를 화면마다 생성하지 않는다. 최신 lease가 소유권을 가지며 이전 lease는 새 소유자를 stop/detach할 수 없다. Probe도 onStart마다 lease를 다시 얻어 다른 화면에서 복귀할 수 있다.

Inspection resume는 channel lease를 얻고 기존 source.start를 worker에 요청한다. pause/destroy는 lease를 해제하고 source epoch를 즉시 무효화한다. callback은 기존 controller에서 직렬 처리하며 실제 pending이 남으면 release/new initialize를 기다린다. 영구 무응답이나 정리 실패는 UNRESOLVED로 유지되고 새 channel/Activity를 만들어도 이를 우회하지 못한다. 정상 화면 전환도 기존 source의 정리 후 재시작 정책을 따르며, 물리 SDK 세션이 계속 연결됐다고 주장하지 않는다.

channel UUID는 UI lease 세대이며 SDK 차량 session ID가 아니다. JS는 lifecycle/visibility 중지 시 request generation과 이전 관측을 비우고 늦은 HTTP 응답을 버린다. 같은 세대의 오래된 sequence 또는 다른 세대의 packet을 적용하지 않는다. 전송/검증 실패는 Availability ERROR 및 UNAVAILABLE 연결 진단이며 MOCK 자동 전환이 아니다. data source 선택 출처를 보존하되 관측 시각을 비운다.

## 검증 결과

| 검사 | 결과 |
|---|---|
| `npm test --prefix tools/three-poc` | PASS — 27개, 기존 18개 + 상태 계약/수신 lifecycle 9개 |
| `npm run test:android-assets --prefix tools/three-poc` | PASS — 신규 상태 모듈 원본 바이트, 모든 상대 import, CSP 및 GLB 미포함 |
| `:vehicle-core:test` / 별도 `-PcoreOnly=true :vehicle-core:test --rerun-tasks` | PASS — 37 pass / 기존 optional IONIQ5_PARTS 미설정 1 skip |
| `:app:testDebugUnitTest --rerun-tasks` | PASS — 66개, 기존 Door 19 및 Tire mapping 2 / controller 30, projection 3, origin policy 1 포함 |
| Kotlin serializer → JS validator CLI | PASS — 실제 Kotlin projector의 합성 출력 8행·STALE·MOCK·UNRESOLVED, 금지 필드 없음 |
| 합성 상태 Chrome 1600×1000 / 420×860 | PASS — 각각 14개 assertion. 4 ID/8행, 독립 상태·시각·출처, 선택/pose/load 유지, inactive/resume, malformed payload 거부, console clean |
| 기존 G1 Chrome 1600×1000 / 420×860 | PASS — 각각 39 / 36개 assertion, 실제 raycast·선택·고무 강조·회전·시점/scroll/focus 복원. 가로 검사에 선택 중 실제 viewport resize 포함 |
| 기존 4부품 Chrome | PASS — 34개 assertion, 선택/강조/복원·LCW 준비 중 유지 |
| 기존 보닛/워셔액/QR Chrome | PASS — 17개 assertion, 개폐 취소·QR·연속 입력 회귀 |
| `assembleDebug`, `assembleRelease`, `bundleRelease`, `lintDebug` | PASS — 전체 106 tasks 실행. lint 오류 0, warning 14. 최종 JS/CSS로 Debug APK 추가 재생성 |
| `identity-probe` / `tire-probe` build-contract | PASS — 신규 process owner/channel/projection/origin 클래스도 Release DEX에 없음. Debug-only 화면/권한, 기존 Release 권한 유지 |
| 최종 Debug APK asset 바이트 대조 | PASS — inspect/shell/status/flow/tire mapping 모듈 6개가 소스와 동일. Release APK/AAB에 inspection 자산·외부 GLB 없음 |
| `git diff --check`, 금지 범위 diff | PASS — Geometry/원본 모델·AR/SDK transport·Door·MainActivity·vehicle-core 변경 없음 |
| 실제 Android WebView / Pleos / 실차 | 아래 구분대로 BLOCKED / NOT_RUN |

명령의 SDK 및 gradle 환경은 재실행 절을 참고한다. core의 skip은 이번 변경에서 제외한 테스트가 아니다. lint warning은 기존 target API/dependency/JS/data extraction/icon/TextI18n 범주이며 성공과 구분했다. Geometry를 수정하지 않아 별도 새 형상/충돌 보고서를 생성하지 않았으며 기존 CI Geometry gate와 브라우저 회귀로 검증한다.

합성 브라우저의 첫 packet은 실제 Kotlin projector test가 생성한 **MOCK JSON**이다. 이후 로컬 fixture에서 8개 상태 조합을 변경하고 기존 선택 객체·camera pose(0.0001)·geometry 수·모델 load 횟수가 유지되는지 확인했다. malformed synthetic packet에 추가한 reason은 거부되고 DOM에 노출되지 않았다. 이는 Native SDK의 raw 값 전송 성공이 아니라 금지 필드 거부 검사다.

초기 브라우저 실행에서 Node에서는 허용되던 timer method receiver가 Chrome의 `Illegal invocation`을 유발했다. global timer를 wrapper로 호출하도록 고쳤고 default timer receiver 회귀 테스트를 추가했다. replay unit test의 초기 fixture도 ERROR와 관측 시각을 동시에 갖는 잘못된 metadata라 거부됐으며, 유효한 STALE packet의 replay로 수정했다. assertion이나 validation을 약화하지 않았다. 초기 실패와 최종 PASS를 외부 인덱스에서 구분한다.

## AVD / 실차 범위와 잔여 위험

Health Gate는 시작 **09:05:08 UTC**, 최종 **09:46:58 UTC** 모두 `emulator-5554 get-state`가 63ms / exit 1 / device not found로 **BLOCKED**다. CPU/load/메모리/서비스/부팅 상태는 접속 불가로 NOT_RUN이다. 재시작·설치·앱 실행·환경 변경을 하지 않았다.

| 검증 층 | 판정 |
|---|---|
| 합성 상태 UI, 실제 데스크톱 Chrome | PASS |
| Android/JS 상태 계약·origin policy (JVM + JS), SDK AAR에 대한 컴파일 | PASS |
| 실제 Android WebView에서 private endpoint와 Activity 복원 | BLOCKED |
| 실제 Pleos Tire capability·값·listener·SDK 정리 | BLOCKED |
| 실제 차량·단위·센서 의미·안전 판단 | NOT_RUN / 미검증 |

원격 SDK 연결/release 완료는 로컬 phase만으로 입증할 수 없다. 영구 callback 무응답 시 process source/worker/SDK 참조가 계속 남을 수 있으며 개수가 화면 재생성으로 늘지 않게 제한한다. SDK 메서드 자체가 worker를 막으면 진단은 마지막 처리 상태일 수 있다. 강제 release/thread 종료/공개 취소 API 추정/자동 복구는 추가하지 않았다. 여러 화면이 동시에 보이는 경우 최신 lease만 읽을 수 있고 superseded 화면은 다음 poll에서 비워진다. 이미 준비된 HTTP 응답은 Native가 회수할 수 없으므로 웹 lifecycle generation 차단과 제한된 poll latency를 사용한다. 실제 플랫폼 scheduling은 AVD 재검증이 필요하다.

## 재실행

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain
node tools/three-poc/check-tire-native-contract.mjs app/build/test-results/tire-ui-v1.json
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:CARSCOPE_QR_AR_BASE_URL='https://inspection.example.test/'
$env:CARSCOPE_TIRE_UI_FIXTURE='C:/CarScope-External/p3-i1/fixture.json'
$env:PORT='8115'
node tools/three-poc/serve.mjs
# 별도 터미널. 마지막 두 인자는 420 860으로도 실행한다.
node tools/three-poc/check-tire-status.mjs C:/CarScope-External/p3-i1/recheck C:/CarScope-External/p3-i1/fixture.json 'http://127.0.0.1:8115/inspect.html?capture=1&tireStatus=fixture' 1600 1000
```

Gradle은 JDK17 / Gradle8.14 / SDK34 / Vehicle2.3.2, `--max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" "-Pkotlin.compiler.execution.strategy=in-process"`로 실행했다. 캡처는 pinned Anatomy driver를 수정 없이 사용했다. 서버의 synthetic fixture 옵션과 테스트 파일은 Android 자산에 복사하지 않는다. CI는 실제 Debug 자산을 생성해 빌드하고 Kotlin→JS 계약 및 DEX/manifest 경계를 확인하며 실제 AVD를 실행하지 않는다.
