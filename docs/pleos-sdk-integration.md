# P1-B — Pleos Door 읽기 전용 연동

G0 공유본: 로컬 원본 로그·화면·XML·SDK 바이너리는 Git 제외이며 evidence README만 공유합니다.

**최신 (P1-B2, 집 PC):** 지원 가능한 가속(WHPX + host GPU)을 쓰는 집 PC의 Pleos AVD에서 T1~T10을 실제로 검증했습니다. SDK 초기화·capability·현재 값·Console 이벤트→SVG OPEN/CLOSED, SDK 모드 Activity 재생성, Mock 전체 회귀가 PASS입니다. release의 Service 측 완료 확인은 관측하지 못했습니다. 결과는 [집 PC 재검증](#집-pc-재검증-p1-b2-2026-10-30) 절에 있습니다. 아래 [연구실 PC 런타임 기록](#런타임-검증-기록)의 BLOCKED 판정은 당시 환경의 결과로 그대로 보존합니다.

검증일: 2026-10-30. 범위는 `ROW_1_LEFT → FRONT_LEFT` 한 도어입니다. SDK 조회·변경 알림을 기존 JVM 모델과 SVG에 연결합니다. 실제 차량 제어, 다른 도어, Anatomy 및 성능 최적화는 포함하지 않습니다.

## 기존 작업 보존

Git은 첫 커밋 전 `main`이며 기존 프로젝트 전체가 미추적 상태였습니다. 원격은 `https://github.com/ppsssj/CarScope.git`입니다. 기존 프로젝트 파일 44개의 경로·길이·SHA-256과 수정 전 사본을 `.tools/p1-b/20261030T084712Z/initial-inventory.json`, `before/`에 보존했습니다. reset/clean/delete/push/PR/merge를 실행하지 않았습니다. P0/P1-A 보고서와 증거는 유지합니다. 중단된 P1-A2 성능 감사는 완료한 것으로 취급하지 않습니다.

## SDK, Service, AVD는 서로 다른 버전

| 구성요소 | 확인 결과 |
| --- | --- |
| 공식 Maven | `https://nexus-playground.pleos.ai/repository/maven-releases/` 접근 및 Gradle dependency 해석 성공 |
| 앱 의존성 | `ai.pleos.playground:Vehicle:2.3.2` |
| SDK AAR | 983,759 bytes; SHA-256 `E11FDFE498CAD3ECC0D5A2A6992B0C4A4D135195F1455018127BC069FD5EF937` |
| SDK AAR metadata | SDK versionCode 73; 최소 Service name `2.3.13` / code 65; minSdk 23; minCompileSdk 1 |
| 실제 AVD Vehicle Service | `ai.pleos.playground.service.vehicle`, **2.3.22 / code 74**, `dumpsys package`로 확인 |
| 시스템 이미지 | Pleos Connect **2.1.0**, Android 14 / API 34 / x86_64; 공식 repository revision 2 |
| AVD | `CarScope_Pleos_API34`, 기본 2560×1440 / density 160, RAM 4096MB / 2 cores / GPU auto → SwiftShader |
| Emulator | 37.2.13.0 build 16740729, WHPX |
| 빌드 설정 | JDK 17 / Gradle 8.14 / AGP 8.10.0 / Kotlin 2.2.0, 앱 min 28 / compile·target 34 유지 |

Service 74는 AAR의 최소 code 65 이상이며 공식 샘플의 Service 2.3.22와 일치합니다. 버전 조건 충족과 실제 API 동작 성공은 별도 판정합니다. 샘플의 compile/target 35, Gradle 8.10.2, AGP 8.8.2를 현재 프로젝트에 덮어쓰지 않았습니다.

공식 근거:

- [Vehicle SDK 소개](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro): SDK 2.3.2 / Service 2.3.21 기준 및 IPC 구조.
- [SDK 가져오기](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/project-setup): Maven repository와 SDK 2.3.2.
- [Sample App 가이드](https://document.pleos.ai/docs/pleos-only/tutorial/vehicle-sdk-sample-app): SDK 2.3.2 / Service 2.3.22, capability/read/listener 및 초기화 반환의 한계.
- [공식 샘플 typed Door 예제](https://github.com/Pleos-Playground/pleos-sample-vehicle-app): 실제 호출 형태 대조. 조사 시 README blob SHA `59d2b23eea415567dbfaa2cdbfb546c31e04e581`.
- [기존 시작 가이드](https://document.pleos.ai/docs/pleos-only/getting-started): SDK 2.3.1 예시. 이번에는 다운로드 가능한 2.3.2를 명시적으로 선택했습니다.

## 구현과 API 경계

```text
vehicle-core (Android/SDK import 없음)
  VehicleDataSource ── MockVehicleDataSource
       ↑
app    PleosVehicleDataSource ── DoorSession ── SdkDoorSession
                                      Vehicle(applicationContext)
                                      initialize() → getDoor()
                                      checkDoorPositionCapabilities(config, bounds)
                                      registerDoorPosition(area, listener)
                                      getCurrentDoorPosition(area, complete, failed)
                                      unregisterDoorPosition(same area, same listener)
                                      release()
       ↓
  VehicleSnapshot(PLEOS) → 기존 VehicleDiagramMapper → 기존 SVG → 기존 WebView
```

실제 AAR의 `javap`와 공식 typed 샘플로 함수·파라미터를 확인했습니다. `DoorArea(DoorValue.ROW_1_LEFT)`, `DoorPositionListener.onPositionUpdated(pos: Int?)`, `onFailed(e: Exception)`를 사용합니다. capability의 access가 READ 또는 READ_WRITE이고 해당 영역의 bounds가 있는 경우에만 읽고 구독합니다. READ_WRITE가 반환돼도 앱은 쓰기 API를 호출하지 않습니다. `initialize()` 반환은 연결 성공 증거로 표시하지 않습니다.

`DoorSession`은 CarScope 내부의 테스트 경계이며 SDK API를 흉내 낸 가짜 public API가 아닙니다. 실제 SDK 구현은 `SdkDoorSession` 한 파일에 있습니다. 인터페이스에는 SET/control 메서드가 없습니다. SDK 자체에 제어 메서드가 포함되어 있다는 사실과 앱에서 호출한다는 사실을 구별합니다.

## 권한

앱에서 명시적으로 추가한 권한은 `pleos.car.permission.CAR_DOORS` 하나입니다. SDK AAR manifest가 `ai.pleos.playground.service.vehicle.VEHICLE_BINDING` 및 service intent query를 병합합니다. 병합 Manifest에는 이 두 permission만 있으며 CONTROL/PRIVATE/INTERNET permission은 없습니다. 실제 AVD Service는 두 권한을 `normal`로 정의합니다. 앱의 사전 `checkSelfPermission` 결과와 실제 capability/read 응답을 구별합니다. 실차 승인·서명·배포 정책은 미검증입니다.

## 값과 데이터 출처

`mapDoorPosition`은 공식 Door 예제의 **capability 0..1** encoding에 한해 0=CLOSED / 1=OPEN을 해석합니다. 다른 bounds를 비율이나 boolean으로 추측하지 않습니다. null, 음수, 2 이상, 미확인 encoding은 `Unavailable(UNKNOWN)`입니다. 미연동 세 도어는 `UNSUPPORTED`이며 CLOSED로 채우지 않습니다.

모든 SDK snapshot은 실패·연결 전에도 `DataOrigin.PLEOS`입니다. 기본 MOCK, 명시적 PLEOS 버튼, 모의 시나리오 버튼으로 출처를 선택합니다. 모의 버튼은 명시적으로 MOCK으로 전환합니다. 실패 시 자동 대체는 없습니다. native 문구·summary·HTML title·SVG 출처가 선택한 source를 따릅니다.

권한 거부(SecurityException/사전 permission 검사)는 PERMISSION_DENIED, 초기 연결 예외는 DISCONNECTED, 영역/읽기 접근 미지원은 UNSUPPORTED, 기타 SDK 예외·null은 UNKNOWN입니다. 불명확한 SDK 예외를 문자열 추측이나 obfuscated 내부 API로 분류하지 않고 메시지를 UI/`CarScopeDoor` Logcat에 남깁니다. 서비스가 listener 오류를 보내지 않고 조용히 끊기면 관측은 5초 후 STALE이 됩니다. 앱 수신 시각을 관측 시각으로 사용하며 차량 하드웨어 timestamp로 주장하지 않습니다.

## 수명주기와 비동기 요청

SDK 호출과 콜백 처리를 단일 worker로 직렬화합니다. UI는 즉시 반환하는 cache만 읽고 1초마다 기존 stale 판정을 갱신합니다. polling으로 관측 시각을 새로 만들지 않습니다. onStart에서 PLEOS 선택 시 시작, onStop에서 해제, onDestroy에서 종료합니다. applicationContext로 Activity 참조를 피합니다.

중복 start는 새 session/listener를 만들지 않습니다. 구독을 먼저 등록하고 초기 read 이후 도착 순서를 검사하여 늦은 초기 read가 더 최근 이벤트를 덮지 않게 합니다. 동일 값의 실제 새 이벤트는 새 관측이며 새 구독은 아닙니다. 중복 complete 콜백은 한 번만 소비합니다.

종료 시 새 이벤트를 무시하고 동일 영역·listener로 unregister한 다음, 진행 중 capability/read 콜백이 모두 완료된 뒤 release합니다. 정리 중 재시작은 이전 session release 뒤 수행합니다. 종료 이후 큐에 들어오는 콜백은 cache/UI를 갱신하지 않습니다. SDK에 요청 취소 API를 추측해 넣지 않았으므로 **SDK가 완료/실패 콜백을 영원히 보내지 않으면 종료가 pending 상태로 남을 수 있습니다**. 이 경우 release 성공으로 보고하지 않습니다. unregister/release의 void 반환은 Service의 완료 acknowledgement가 아닙니다.

## 빌드와 단위 테스트

기존 core 17개는 유지했고 app 모듈에 fake transport 기반 19개를 별도로 추가했습니다. 매핑/null/unknown/실패/출처 분리/미지원 영역/중복 등록/중복 응답/늦은 read/관측 시각/종료 대기/재생성된 소유자의 이전 콜백 무시를 검증합니다. fake transport 테스트는 실제 SDK·Binder·Android Activity 실행 테스트를 대신하지 않습니다.

실행 명령(저장소 루트, JDK 17 선택 후):

```powershell
.\gradlew.bat :app:dependencies --configuration debugRuntimeClasspath --console=plain --max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8"
.\gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug --console=plain --max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" -Pkotlin.compiler.execution.strategy=in-process
# 캐시가 모두 준비된 뒤에는 --offline 사용 가능
.\gradlew.bat --stop
```

1차 실행은 신규 테스트의 Mock 생성자 인자 오류로 FAIL(수정 완료), 2차 offline 실행은 아직 없는 transitive runtime JAR 때문에 FAIL, 3차 online 실행은 app 테스트 19개 및 APK 생성 PASS입니다. core 테스트 17개는 1차 실행에서 실제 실행해 PASS했습니다. SDK XML version 4/3 경고는 발생했으나 빌드를 차단하지 않았습니다. Wrapper/AGP/Kotlin을 변경하지 않았습니다.

AVD 종료 후 세 task의 최종 offline build는 PASS/43 UP-TO-DATE였으므로 새 테스트 실행으로 세지 않았습니다. 이어 `:vehicle-core:test :app:testDebugUnitTest --rerun-tasks --offline`을 실행해 38초/26 task 실제 실행으로 **17+19=36개 재실행 PASS**, failures/errors/skipped=0을 확인했습니다. 최종 XML은 evidence의 `core-tests-final.xml`, `adapter-tests-final.xml`입니다.

APK: `app/build/outputs/apk/debug/app-debug.apk`, 11,749,170 bytes, SHA-256 `1A7CD16452C1308026B01762D4E546610C2578EC309073141446E268A9E134B1`, debug v2 서명 검증 PASS, `adb install -r` Success. 버전명은 기존 `0.1.0-p0`를 유지했으므로 버전명만으로 이 빌드를 구별하지 말고 hash를 확인합니다.

## 집 PC 재검증 (P1-B2, 2026-10-30)

환경: Windows 10, i5-4690(공식 최소 CPU 미만), RAM 16GB, GTX 1060. Emulator 37.2.13 WHPX `CPU Acceleration: working`, `-gpu host`(NVIDIA). 같은 Pleos 2.1.0 이미지, RAM 4096MB / 2 cores / cold boot. Vehicle Service **2.3.22/code 74**, 앱 SDK **2.3.2**. 런타임 APK는 소스 `c555c58`, SHA-256 `C192F7B75BE832715574AB5E9FF9F74AC8928F6A3F4811E70FB2BC087AB825B6`. 앱 코드는 변경하지 않았습니다. 비식별 로그 발췌와 세션별 안정성 기록은 [P1-B2 evidence](evidence/p1-b2/2026-10-30-home/README.md)에 있습니다.

| 시나리오 | 판정 | 근거 |
| --- | --- | --- |
| T1 SDK 초기화 | PASS | Service connect → `initialize returned`, 이어서 T2/T3 실제 응답으로 연결 확인 |
| T2 Door capability | PASS | `capability access=READ_WRITE range=0..1` |
| T3 현재 도어 값 | PASS | `current raw=0` → CLOSED |
| T4 Console OPEN | PASS | Console `PUT door_fl=true` HTTP 200, Console 상태 `front_left:true` |
| T5 PLEOS OPEN SVG | PASS | `event raw=1`, SVG FRONT_LEFT 빨간색 OPEN |
| T6 Console CLOSED | PASS | `PUT door_fl=false` HTTP 200 |
| T7 PLEOS CLOSED SVG | PASS | `event raw=0`, SVG 초록색 CLOSED |
| T8 SDK 모드 Activity 재생성 | PASS | `cmd uimode night`로 설정 변경 재생성 3회, 같은 PID. 이전 세션 해제 후 새 세션이 capability 재조회·구독·값 수신. PLEOS 선택 복원. 재생성 후 Console OPEN/CLOSE 이벤트가 새 세션에서만 1회씩 수신 |
| T9 구독 해제/release | PASS (앱 측) | 앱 `unregistered → pending=0 → released`. Service debug 로그로 구독 해제 처리 관측. **release의 Service 측 완료는 미관측** |
| T10 Mock 전체 회귀 | PASS | ALL_CLOSED / FRONT_LEFT_OPEN / UNAVAILABLE, 5초 STALE, MOCK↔PLEOS 양방향, PLEOS 중 모의 버튼 → MOCK 전환. 출처 표시·SVG 일치 |

Virtual Console은 웹 UI와 같은 HTTP 요청으로 조작했습니다. Console은 브라우저 세션 heartbeat(`POST /browser/session`, 1초 간격)가 있어야 쓰기 요청을 받으며, heartbeat가 없으면 `503 emulator_inactive`를 반환합니다.

관측된 환경 문제:

- H1 첫 부팅에서 부팅 직후 SystemUI ANR 1건. 이후 추가 없음. 에뮬레이터 실행 중 호스트 여유 RAM이 0.8~2.8GB로 낮습니다.
- P1-B2 첫 부팅(boot2)에서 OEM 홈의 오른쪽 앱 패널이 CarScope와 내비게이션 앱을 모두 표시하지 않았습니다. 앱 창은 그려졌지만(`HAS_DRAWN`) SurfaceFlinger layer가 숨김 처리되어 합성에서 빠졌고, 입력도 전달되지 않았습니다. 앱 결함으로 판단할 근거는 없으며, 같은 설정의 복구 cold boot 1회에서는 재현되지 않았습니다. 원인은 미확인입니다.
- 정상 연결 상태에서도 이벤트가 없으면 5초 후 FRONT_LEFT가 STALE로 표시됩니다. 설계 문제로 [STALE 정책 검토](stale-policy-review.md)에 정리했습니다.

## 런타임 검증 기록

아래는 **연구실 PC**에서의 기록이며, 당시 판정을 그대로 보존합니다.

**최종 판정: P1-B BLOCKED, 미완료.** 구현·컴파일·단위 테스트·APK 설치까지 확인했습니다. 실제 SDK 초기화/capability/read/event→SVG 루프는 확인하지 못했습니다. 초기화 성공 문구조차 실제 로그로 확인되지 않았으므로 SDK 연동 PASS로 확대하지 않습니다.

| 시나리오 | 판정 | 실제 확인 범위 |
| --- | --- | --- |
| T1 SDK 초기화 | BLOCKED | PLEOS 버튼 좌표 확인 후 `input tap` exit 0, 3,597ms. 출처 전환/`CarScopeDoor` 로그는 확인 못함 |
| T2 Door capability | BLOCKED | 실제 SDK 응답 없음; READ/READ_WRITE 및 0..1은 공식 예제/합성 테스트와 구분 |
| T3 현재 도어 값 | BLOCKED | 실제 값 미수신. 0/CLOSED로 임의 채우지 않음 |
| T4 Console OPEN | NOT_RUN | Console 접속·Convenience·Door Position·Front left·초기 Off 확인까지. 실제 변경은 선행 단계 차단으로 보류 |
| T5 PLEOS OPEN SVG | BLOCKED | SDK 이벤트 미수신 |
| T6 Console CLOSED | NOT_RUN | OPEN을 실행하지 않아 복원 요청도 없음 |
| T7 PLEOS CLOSED SVG | BLOCKED | 실제 SDK 경로 미검증 |
| T8 SDK 모드 Activity 재생성 | NOT_RUN | fake transport의 이전 소유자 정리 테스트만 PASS; P1-A Mock 재생성 기록은 보존 |
| T9 실제 구독 해제/release | NOT_RUN | 실제 등록 자체를 확인 못함. 단위 테스트의 순서/대기 검증과 구분 |
| T10 Mock 회귀 전체 | BLOCKED | core Mock 테스트와 새 APK의 MOCK/STALE native·SVG 화면은 PASS. 버튼 3종·Mock↔Pleos 전환 전체 재실행은 못함 |

### AVD 및 Android 오류

빌드·Gradle daemon 종료 후 첫 cold boot에서 `sys.boot_completed=1`을 확인했습니다. `am start -W`는 Status ok/WaitTime 3,185ms를 반환했으나 native 화면에는 OEM navigation이 남아 있었습니다. 앞으로 가져오기 명령은 HOT/TotalTime 22,172ms/WaitTime 22,398ms였습니다. 이 값을 앱의 정상 cold-start 성능으로 사용하지 않습니다. Dock 선택 후 요청한 screenshot은 수분 늦게 반환됐으며 새 APK의 MOCK 출처와 STALE 4개 도어의 실제 픽셀을 확인했습니다.

첫 세션에 `ai.umos.drivingview`의 input gesture monitor ANR, `ai.pleos.service.car` ANR, `ai.pleos.service.ui`의 ForegroundServiceDidNotStartInTimeException, WindowManager BLASTSyncEngine transaction/commit timeout이 발생했습니다. 입력·화면 캡처·앱 force-stop 요청이 수분 반환되지 않았고 WebView inspector HTTP 요청도 10초 timeout이었습니다. guest load average는 2 vCPU 환경에서 `40.23, 35.37, 18.25`, MemAvailable 약 1.8GiB였습니다. 이 관측만으로 단일 원인이나 앱 결함을 확정하지 않습니다.

같은 AVD/메모리/CPU/GPU/화면 설정으로 **복구 cold boot 1회만** 추가했습니다. 물리 해상도·Windows 기능·AVD ini·GPU 설정은 변경하지 않았습니다. 복구 부팅에서도 완료 신호는 있었으나 DAL 초기화 실패/native SIGABRT가 보였고, 앱 시작은 Status timeout/WaitTime **80,421ms**, ActivityTaskManager Displayed는 **+1m33s51ms**였습니다. `/sdcard` screenshot 파일 작성은 Operation not permitted였으나 `/data/local/tmp`로 native 캡처를 확보해 MOCK/STALE 화면을 확인했습니다.

Package Manager와 WindowManager의 dumpsys는 각각 `DUMP TIMEOUT (10000ms)`를 반환했습니다. UIAutomator는 24,371ms 뒤 exit 137이었고, 입력기·Bluetooth·Phone·SystemUI ANR이 이어졌습니다. SDK 버튼은 확보한 fullscreen native 화면의 좌표 (1900,130)로 한 번만 선택했습니다. SDK 초기화/capability/read/event 로그나 출처 전환을 확인하지 못했습니다. 이후 Logcat 09:21:50 부근 VHAL died, 09:21:58 부근 여러 프로세스의 DeadSystemException, 새 SystemServerTiming이 기록됐습니다. 마지막 캡처는 검은 화면입니다. 이를 CarScope SVG 렌더러만의 검은 화면 결함으로 분류하지 않습니다.

두 raw runtime 로그에서 `CarScopeDoor` 메시지는 0개, `ANR in io.carscope.app`/`Process: io.carscope.app,` 일치는 0개였습니다. OEM/framework ANR 기록은 20회(중복 가능)입니다. **앱의 장시간 안정성 PASS나 앱과 무관함을 증명한 결과는 아닙니다.** SDK 연결이 확인되기 전 시스템 문제가 발생했고, 도어 조작과 시스템 오류의 인과관계는 확인되지 않았습니다. Virtual Console 브라우저도 이후 crash 화면으로 바뀌었습니다. Console의 3D highway WebGL 2 실패는 CarScope의 SVG 오류와 별개입니다.

Logcat 시각과 Windows KST/UTC, 부팅 전후 기기 시각은 서로 달라 그대로 보존합니다. 서로 다른 clock의 값을 빼서 SDK/렌더링 latency를 만들지 않았습니다. SVG 생성·IPC·WebView 지연의 구간 계측과 개선 전후 비교는 **UNMEASURED/NOT_RUN**입니다. 성능 개선을 위해 앱/AVD 설정을 임의 변경하지 않았습니다. 종료 시 작업 AVD와 수집용 logcat을 종료했습니다. ADB forward 제거는 기기 offline 오류가 있었으나 이후 `adb forward --list`가 비어 있고 작업 emulator 프로세스도 없는 것을 확인했습니다.

### 재현 명령과 증거

`<SDK>`, `<APK>`, `<PID>`는 로컬 설치 경로/실제 PID로 치환합니다. 동일 조건 재현 시 SDK 초기화 로그를 먼저 확인하고 Console 도어를 변경합니다. init/capability/read/listener 성공 전에 Console 접속만으로 연동 성공을 주장하지 않습니다.

```powershell
& '<SDK>/emulator/emulator.exe' -avd CarScope_Pleos_API34 -port 5554 -no-window -no-snapshot -no-boot-anim -no-audio -memory 4096 -cores 2 -gpu auto
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 shell dumpsys package ai.pleos.playground.service.vehicle
adb -s emulator-5554 install -r '<APK>'
adb -s emulator-5554 shell am start -W --display 0 --windowingMode 1 -n io.carscope.app/.MainActivity
adb -s emulator-5554 shell dumpsys package io.carscope.app
adb -s emulator-5554 logcat -v threadtime -s CarScopeDoor:I AndroidRuntime:E ActivityTaskManager:I
adb -s emulator-5554 forward tcp:8088 tcp:8088
# http://127.0.0.1:8088/ → Emulation Controls → Convenience → Door Position
# Front left. 앱에서 명시적으로 PLEOS 읽기 모드 선택 후 Console Open/Close 검증.
adb -s emulator-5554 shell screencap -p /data/local/tmp/carscope-p1b.png
adb -s emulator-5554 pull /data/local/tmp/carscope-p1b.png .
adb forward --remove tcp:8088
adb -s emulator-5554 emu kill
```

로컬 원본: `.tools/p1-b/20261030T084712Z/` (Git 제외). `build-test-1/2/3.log`, `final-offline-build-test.log`, `core-tests.xml`, `adapter-tests.xml`, `merged-manifest.xml`, `vehicle-service-package.txt`, `app-launch.log`, `app-bring-forward.log`, `recovery-app-start.log`, `runtime.log`, `recovery-runtime.log`, `runtime-counts.json`, `adb-steps.jsonl`, screenshots를 보존했습니다. 필요한 로그·XML·화면은 [evidence](evidence/p1-b/2026-10-30/)에도 선별해 둡니다.

### 수정/신규 파일

기존 수정: `settings.gradle.kts`, `app/build.gradle.kts`, Manifest, MainActivity, strings, README, architecture, feasibility, roadmap, validation-report. 신규: `app/.../pleos/PleosVehicleDataSource.kt`, `SdkDoorSession.kt`, `app/src/test/.../PleosVehicleDataSourceTest.kt`, 이 문서와 evidence. core 소스·테스트와 기존 P1-A 증거 파일은 삭제하거나 변경하지 않았습니다.

## 남은 검증

실차, 서비스 프로세스 강제 종료/권한 거부를 통한 오류 주입, SDK 무응답 시 resource 대기, release의 Service 측 완료 확인, 장시간 구독/메모리, 다른 encoding/영역, 수신·SVG 지연 계측은 별도 검증이 필요합니다. 실제 도어 이벤트→SVG는 집 PC에서 확인했습니다(위 P1-B2). 연구실 PC 환경은 여전히 BLOCKED이며, 지원 사양을 만족하는 호스트에서의 재현은 미검증입니다. P2 진입 전에 [STALE 정책](stale-policy-review.md) 결정을 권장합니다.
