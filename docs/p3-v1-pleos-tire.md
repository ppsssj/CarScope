# P3-V1 · Pleos Tire API 조사와 독립 데이터 계층

2026-11-01 KST / Windows / Node v22.16.0 / JDK 17.0.20.1 / SDK 2.3.2.
기준: `git fetch origin main` 후 `1ea76982fd59cdfd46d928bccf47dbfd86a5457d`, PR #27 MERGED 확인.
새 worktree `C:\dev\CarScope-pleos-tire`, 브랜치 `feat/p3-v1-pleos-tire`. 시작 작업 트리는 깨끗했다. PR #26, 별도 Codex 작업 브랜치/파일, 모바일 AR와 Geometry는 변경하거나 가져오지 않았다.

**정적 AAR·독립 계층·단위/빌드 검증 PASS. 실제 Tire AVD 런타임은 BLOCKED.** 타이어별 수치 getter가 SDK에 존재하는 것은 확인했지만, 대상 AVD에서 실제 공기압 조회가 지원된다고 확정하지 않는다.

## 1. 조사 근거와 API

기존 [Door 연동](pleos-sdk-integration.md), [STALE 검토](stale-policy-review.md), architecture/roadmap/development-setup/validation-report와 기존 Door controller/transport/core를 확인했다. 외부 전수조사 `api-audit/stats.json`은 전체 765 class / PUBLIC 183 class / 5,621행을 기록한다. 그 조사에 사용한 Vehicle `classes.jar`가 이번 Maven AAR 내부와 **바이트 동일**함을 새로 확인했다. 기존 전수조사 결과를 런타임 증거로 사용하지 않았다.

- Maven: `ai.pleos.playground:Vehicle:2.3.2`, AAR SHA-256 `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937`.
- classes.jar SHA-256 `0d666ac6be3d645a641b63823b1391bca2fa5a651e2496011370acb3bfab293a`.
- 공개 `Vehicle.getTire()` → `ai.pleos.playground.vehicle.api.Tire` 선언, annotation, listener, WheelArea/WheelValue를 `javap`로 대조하고 컴파일·단위 테스트했다. 내부 구현은 조사 참고만 했고 런타임 호출·reflection에 사용하지 않았다.
- [공식 Vehicle SDK 소개](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro)와 Tire 참조 URL을 확인했다. 이번 조회에서 상세 참조 페이지는 읽을 수 없거나 Page Not Found 응답이었다. 따라서 웹 검색의 다른 Vehicle Data REST API나 AAOS 일반 단위를 이 SDK의 단위로 대체하지 않았다.

아래 `onComplete`/`onFailed`는 비동기 콜백이다. pressure와 low-pressure의 권한이 **다르다**.

| 공개 Tire 메서드 | 선언/결과 | AAR RequiresPermission | 이번 구현 / 실제 AVD 결과 |
|---|---|---|---|
| `checkWheelAreaCapabilities` | `List<WheelArea>` | `CAR_SAFETY` | deprecated, `checkLowTirePressureCapabilities` 사용을 권고하는 annotation 확인. 호출하지 않음 |
| `checkLowTirePressureCapabilities` | `CapabilityConfig`, `List<WheelArea>` | `CAR_SAFETY` | 기능별 capability 경로 구현. AVD BLOCKED, 실제 access/영역 미수신 |
| `getLowTirePressure` | `WheelArea`, nullable `Float` | `CAR_SAFETY` | 지원이 확인된 단일 영역만 호출. AVD BLOCKED, 값 미수신 |
| `checkTirePressureCapabilities` | `CapabilityConfig`, `List<WheelArea>` | `PRIVATE_CAR_SAFETY` | 기능별 capability 경로 구현. AVD BLOCKED, 실제 access/영역 미수신 |
| `getTirePressure` | `WheelArea`, nullable `Float` | `PRIVATE_CAR_SAFETY` | 타이어별 수치 getter 존재 확인. AVD BLOCKED, 값 미수신 |
| `registerTirePressure` | `WheelArea`, `TirePressureListener`; listener는 `onTirePressureUpdated(Float?)`와 상위 `onFailed(Exception)` | `PRIVATE_CAR_SAFETY` | pressure만 구독. AVD 등록/이벤트 미실행 |
| `unregisterTirePressure` | 같은 `WheelArea`, 같은 listener | `PRIVATE_CAR_SAFETY` | stop에서 동일 객체로 해제. AVD 미실행, 단위 테스트로 순서 검증 |

권한 전체 prefix는 `pleos.car.permission.`이다. `CapabilityConfig.accessType`의 READ/READ_WRITE만 읽기를 허용한다. NONE/WRITE만 있거나 단일 바퀴 영역이 없으면 해당 행은 UNSUPPORTED다. 결합된 영역을 단일 바퀴 지원으로 풀어 추정하지 않고 UNVERIFIED로 둔다. Low 계열 register/listener는 공개 Tire 선언에 없어 만들지 않았다. getter Float에 차량 timestamp나 단위 필드는 없다.

**단위·의미는 UNVERIFIED**다. 원시 Float만 보존하며 PSI/kPa/bar 환산, 정상/저압 판정, `getLowTirePressure`의 boolean 해석을 하지 않는다. SDK callback을 성공적으로 수신해도 단위·의미 확인 전 availability는 UNVERIFIED다. 0은 관측된 원시 0일 수 있을 뿐 정상 상태가 아니다. 음수/NaN/Infinity는 보수적으로 ERROR, null은 UNVERIFIED이며 값·관측 시각을 생성하지 않는다.

## 2. 구조와 공통 계약

```text
vehicle-core/vehicle/tire: TireId / TireFeature / TireReading / TireSnapshot / TireDataSource
                                       ↑ SDK·Android 의존 없음
app/src/debug/.../tire: PleosTireDataSource → TireSession → SdkTireSession → Vehicle(applicationContext)
                        비동기 cache        앱 테스트 경계   실제 typed SDK 호출
                        ↑
                    TireProbeActivity (독립 Debug, 메인 화면 변경 없음)
```

[공통 계약 `vehicle-tire-v1`](contracts/vehicle-tire-v1.md)에 featureId/vehiclePartId/apiDomain/capabilityStatus/availabilityStatus/value/unit/observedAt/source/reason을 정의했다. 네 ID는 `tire.front-left`, `tire.front-right`, `tire.rear-left`, `tire.rear-right`다. SDK area 이름과 3D 메시 이름을 분리하며 다른 브랜치의 매핑 구현을 가져오지 않았다.

SDK 초기화는 기존 Door와 같은 `Vehicle(applicationContext).initialize()`/domain getter/release 패턴을 사용한다. initialize의 void 반환은 연결 성공 증거가 아니다. 두 Tire 기능을 독립 조회해 한 권한 거부가 다른 기능의 조사를 막지 않게 했다. 사전 permission 거부/`SecurityException`, 명시적인 capability 미지원, 일반 조회 예외/timeout, null/미검증을 분리한다. 예외 메시지를 파싱해 미지원이나 정상으로 바꾸지 않는다.

관측 시각은 실제 콜백 진입 시의 앱 Unix ms이며 worker 대기 전에 기록한다. cache 조회와 화면의 1초 갱신은 이를 변경하지 않는다. 기존 정책과 같은 **5,000 ms 초과 STALE**을 적용하며 Door 정책은 수정하지 않았다. 이는 Tire 이벤트 주기나 연결 생존 보장이 아니다. 같은 값의 실제 새 이벤트는 새 관측이고, one-shot 중복 콜백과 새 이벤트 뒤의 늦은 getter는 무시한다.

콜백 대기 timeout은 **10,000 ms**다. timeout은 ERROR이며 실제 SDK 요청을 취소했다는 뜻이 아니다. stop은 소유권을 무효화하고 같은 listener/영역을 해제한 뒤 실제 진행 중 콜백 회수 후 release한다. SDK가 영구 무응답이거나 SDK 메서드 자체가 worker를 막으면 정리/timeout이 지연되거나 pending으로 남을 수 있다. release의 Service 완료 acknowledgement도 미검증이다. 이를 종료 성공으로 표시하지 않는다.

Probe는 `onStart/start`, `onStop/stop`, `onDestroy/close`로 연결하고 재생성 시 이전 관측을 복원하지 않는다. 앱 전용 `files/tire-probe-v1.json`과 `CarScopeTire` 로그를 남긴다. onStop 시 파일에도 SESSION_STOPPED/UNVERIFIED를 기록해 마지막 값을 활성 데이터로 남기지 않는다. 이 파일은 진단 snapshot이며 차량 데이터 스트림이나 구독 건강 상태 API가 아니다. 실제 3D UI는 아직 연결하지 않았다.

새 transport/controller/probe와 CAR_SAFETY/PRIVATE_CAR_SAFETY permission은 **debug 전용**이다. release에는 SDK 독립 core 계약만 추가되며 새 app/tire 클래스·권한은 없다. 기존 SDK AAR 전체에 Tire public 타입이 포함되는 사실과 새 어댑터가 release에 포함되는지는 구별한다. MainActivity·기존 Door transport/controller·기본 SVG·Pleos 버전·모바일 AR·Geometry 코드는 변경하지 않았다.

## 3. 새 실행 검증

| Gate | 상태 | 명령 / 근거 |
|---|---|---|
| 실제 AAR 대조 | PASS | `python tools/tire-probe/check.py sdk-audit --aar=<local AAR> --out=<external>`: 공개 메서드 7개, 권한 annotation, Float listener, 바퀴 enum 4개 확인. 이전 조사 jar와 SHA/바이트 일치 |
| core Kotlin | PASS | 지정 coreOnly 명령 재실행. 총 38개: **37 통과·1 건너뜀**, 실패 0. 신규 Tire 5/5, 기존 pipeline 17/17·SVG 7/7 유지. 선택 입력 IONIQ5_PARTS 미지정 테스트 1개만 건너뜀 |
| app Kotlin | PASS | `:app:testDebugUnitTest`: **51/51**, 실패·건너뜀 0. Tire controller 19 + 실제 AAR 매핑 2 + 기존 Door 19 + identity 7 + profile 4 |
| capability/null/오류/STALE/중복 | PASS | READ/영역 게이트, null capability·값, 권한 거부, 읽기 실패, 유효하지 않은 Float, 수신 시각/worker 지연, 이벤트 우선순위, 중복 complete/failed, stop/restart, pending timeout/해제, partial 등록 실패를 합성 SDK seam에서 검증 |
| Debug/Release 빌드·lint | PASS | `:app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug`, 최종 명령 exit 0. 앞선 전체 `--rerun-tasks` 106 task도 실제 성공 |
| 신규 debug/release 격리 | PASS | `python tools/tire-probe/check.py build-contract`: merged manifest와 실제 APK/AAB DEX에서 probe/controller/transport debug 포함·release 미포함. release 권한은 기존 CAR_DOORS + VEHICLE_BINDING 그대로 |
| 기존 경계 회귀 | PASS | `python tools/identity-probe/check.py build-contract` 3/3. 기존 identity/profile/WebGL/inspection release 경계 유지 |
| 기존 코드·다른 작업 보존 | PASS | `git diff --exit-code -- app/src/main tools/mobile-ar-poc tools/ioniq5-asset tools/three-poc` 변경 없음. 다른 worktree/브랜치 수정·가져오기 없음 |
| Pleos AVD SDK 초기화/capability/getter/event/복원·해제 | **BLOCKED** | 실제 CarScope_Pleos_API34/emulator-5554 확인. guest CPU 2개, loadavg 최종 **11.86/7.60/7.49**, MemAvailable 약 2.0 GB. 작업 중 5.01~11.86 부하 관측. 과부하 상태에서 재시작·설치·실행을 강행하지 않음 |
| 실제 지원 영역/access·권한 grant·단위·수신 값 | UNVERIFIED | AVD API 미실행. UNSUPPORTED나 0으로 채우지 않음. 정적 선언을 런타임 지원 성공으로 세지 않음 |
| 실제 Door AVD 재실행·실차·3D UI 연결 | NOT_RUN | 기존 Door 단위 회귀와 이전 런타임 근거는 구별. 이번 구현은 독립 Debug API 경로 |

실행 실패도 구분한다. 첫 app 명령은 PowerShell에서 따옴표 없는 `-Pkotlin.compiler.execution.strategy=in-process`가 task 문자열로 분리되어 FAIL이었다. 전체 property를 인용하고 재실행해 통과했다. 이후 Gradle 성공 로그 뒤 Windows wrapper의 출력 파이프 반환이 지연되어 해당 실행 shell만 종료하고, 파일 descriptor로 로그를 기록하는 직접 cmd 실행에서 최종 exit 0을 확인했다. 검사 임계값이나 기대 결과를 약화하지 않았다.

새 단위 테스트의 PLEOS fake session은 선택 출처 보존을 검증하기 위한 합성 경계이며 실제 SDK 연결 증거가 아니다. AAR 매핑 테스트도 enum/area 비교까지만 검증한다. AVD에는 SDK 초기화 반환, capability access/영역, raw 값, 이벤트, release 관측 결과가 **없다**.

## 4. 재실행과 남은 런타임 검증

```powershell
# 현재 worktree 루트. SDK/JDK는 로컬 개발 환경을 사용한다.
python tools/tire-probe/check.py sdk-audit --aar=<local-vehicle-2.3.2.aar> --out=C:/CarScope-External/p3-v1/sdk-audit
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --console=plain --max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" "-Pkotlin.compiler.execution.strategy=in-process"
python tools/tire-probe/check.py build-contract
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py health --out=C:/CarScope-External/p3-v1/runtime
```

AVD 부하가 정상화된 별도 실행에서만 설치·native probe를 실행한다. 이 명령들은 이번에 실행하지 않았다. 보고서 파일과 logcat을 **새로** 수집하고, capability/permission 실패를 값으로 대체하지 않는다.

```powershell
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell am start -n io.carscope.app/.tire.TireProbeActivity
adb -s emulator-5554 logcat -v time -s CarScopeTire:I
# 실제 current user를 확인한 뒤 <user-id>에 사용
adb -s emulator-5554 shell am get-current-user
adb -s emulator-5554 exec-out run-as io.carscope.app --user <user-id> cat files/tire-probe-v1.json
```

남은 항목: 실제 permission grant와 Service access/단일 영역 목록, getter raw/단위·의미, 이벤트 주기, Activity 복원·동일 listener 해제, Service 측 release 완료, 영구 무응답/긴 blocking 호출의 자원 정리. 기존 STALE 검토도 여전히 유효하다. 임계값이나 SDK API를 추정해 이 미검증을 감추지 않는다.

## 5. 후속 도메인 조사 우선순위

1. **EvBattery**: AAR의 `checkEvBatteryStateOfChargeCapabilities`/`getEvBatteryStateOfCharge` 등 잔량·충전 읽기 경로부터. 단위·범위·권한·가용성과 이벤트 수명을 먼저 확인한다.
2. **Light**: `checkLowBeamLightStateCapabilities`/`getCurrentLowBeamLightState` 등 상태 읽기와 영역을 확인한다. Switch 제어 API와 분리한다.
3. **Wiper**: `checkWiperStateCapabilities`/`getCurrentWiperState`의 WindowArea와 상태 enum을 확인한다. 워셔액 수위 데이터라고 해석하거나 와이퍼를 작동시키지 않는다.
4. **Safety**: airbag/seat warning 및 fluid state capability부터 별도 검토한다. 권한·상태 의미·안전 표시 계약을 먼저 확정하며 진단 결론을 만들지 않는다.

위 네 도메인은 이번 AAR에서 공개 interface 선언만 확인했으며 구현·실행·제어를 추가하지 않았다. 증거·산출물 경로는 [외부 인덱스](evidence/p3-v1/README.md)에 있다. SDK/AAR/JAR·APK·원본 로그·개인 설정은 커밋하지 않는다. 별도 PR을 생성하며 자동 병합하지 않는다.
