# P3-V1.1 — Tire runtime 검증과 세션 수명주기

작성: 2026-11-01. **AVD 런타임은 BLOCKED**이다. 정적 AAR 조사와 fake 기반 단위 테스트를 실제 Tire 지원 확인으로 간주하지 않는다.

## 기준과 작업 경계

- PR [#28](https://github.com/ppsssj/CarScope/pull/28): MERGED, 2026-11-01 07:42:12 UTC.
- fetch 후 origin/main / 시작 HEAD: `544d377be5ac8da30f1073a292b936f5cda76df5`. 시작 working tree clean.
- 독립 worktree: `C:\dev\CarScope-tire-runtime`, 브랜치 `feat/p3-v1-1-tire-runtime`.
- 외부 증거: `C:\CarScope-External\p3-v1-1`. [증거 인덱스](evidence/p3-v1-1/README.md).
- PR #28 작업 사본, P3-G1, AR, Geometry, MainActivity, Door SDK 코드, 공개 [tire-v1 계약](contracts/vehicle-tire-v1.md)은 수정하지 않았다.
- 기존 architecture / roadmap / development-setup / validation-report / pleos-sdk-integration / stale-policy-review와 기존 Tire 구현을 검토했다. STALE `>5000ms`와 콜백 수신 시각을 유지한다.

## AVD Health Gate

새 측정: **2026-11-01 07:48:23 UTC**. `adb devices -l`의 장치 목록이 비어 있다. `adb -s emulator-5554 get-state`는 **63ms**, exit 1, `device 'emulator-5554' not found`. `emu avd name` 직접 확인도 TCP 5554 연결 거부였다. 호스트의 `CarScope_Pleos_API34.avd/.ini` 설정은 존재하지만 emulator/qemu 프로세스는 없었다.

| 항목 | 현재 결과 |
|---|---|
| 실행 상태 / ADB | BLOCKED — 실행 기기 없음 |
| 게스트 CPU / loadavg | NOT_RUN — 접속 불가, 과거 CPU 2 / load 11.86 등을 현재 측정으로 재사용하지 않음 |
| 게스트 메모리 | NOT_RUN |
| boot_completed | NOT_RUN |
| Activity / package 서비스 응답성 | NOT_RUN |
| 설치 / Activity 실행 / SDK 호출 | NOT_RUN — gate에서 중단 |

재현 명령: `python tools/tire-probe/check.py health --out=C:/CarScope-External/p3-v1-1/health`.

향후 실행 시 gate 기준은 올바른 AVD, online, boot=1, MemAvailable ≥512MiB, 3개 표본 모두 1분 load/CPU ≤1 및 5분 load/CPU ≤1.5, ADB echo ≤1000ms, activity/package 조회 각각 ≤2000ms, 차량 서비스 package 존재이다. 표본 간 1초, 명령별 timeout 5초이다. CPU 개수 대비 대기 작업 증가와 실제 서비스 응답성을 함께 확인하고, 앱/SDK 실행을 위한 메모리 여유를 요구하는 **보수적인 probe 예산**이며 OEM 성능 보증값은 아니다. 하나라도 미충족하면 BLOCKED다. 부하를 측정할 수 없는 현재 환경도 PASS가 아니다. gate 함수는 경계값과 각 실패 조건을 별도 테스트한다.

AVD 시작·재시작, 설치·실행, SDK 반복 호출, 리소스/Windows 설정 변경을 하지 않았다. 실행 중인 화면이 없어 이번 단계의 실제 화면 캡처는 없다.

## 실제 AAR 재검토

SDK `ai.pleos.playground:Vehicle:2.3.2`. AAR SHA256 `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937`, 내부 classes.jar SHA256 `0d666ac6be3d645a641b63823b1391bca2fa5a651e2496011370acb3bfab293a`. 이번 실행의 `sdk-audit` 결과와 `javap -public -c Vehicle`을 외부에 저장했다.

| 공개 API | 선언상 권한/값 | 이번 실제 AVD 호출 |
|---|---|---|
| `Vehicle.initialize()` / `getTire()` | initialize는 void, 연결 완료 콜백 없음 | NOT_RUN |
| `Vehicle.release()` | void, 원격 정리 완료 반환/콜백 없음 | NOT_RUN |
| `checkTirePressureCapabilities` | PRIVATE_CAR_SAFETY / CapabilityConfig, List<WheelArea> | NOT_RUN |
| `checkLowTirePressureCapabilities` | CAR_SAFETY / 같은 capability 구조 | NOT_RUN |
| `getTirePressure` | PRIVATE_CAR_SAFETY / nullable Float | NOT_RUN |
| `getLowTirePressure` | CAR_SAFETY / nullable Float | NOT_RUN |
| `registerTirePressure` / `unregisterTirePressure` | PRIVATE_CAR_SAFETY / 동일 area와 listener | NOT_RUN |
| deprecated `checkWheelAreaCapabilities` | CAR_SAFETY / wheel areas | NOT_RUN, 기존 구현도 사용하지 않음 |

권한 접두사는 `pleos.car.permission.`이다. pressure listener는 `onTirePressureUpdated(Float?)` 및 상속된 `onFailed(Exception)`이다. low-pressure listener와 요청 취소 API는 확인되지 않았다. `initialize` / `release` bytecode는 서비스 manager에 위임하고 반환한다. 이를 outstanding 요청과 release 동시 실행의 안전성이나 remote acknowledgement 증거로 해석할 수 없다. 비공개 manager 호출이나 reflection은 구현하지 않았다.

정확한 singleton WheelArea와 READ/READ_WRITE만 getter/listener를 허용한다. combined area는 UNVERIFIED다. app 권한 사전 확인, null, SecurityException, 기타 예외, unsupported 영역 분기는 기존 계약을 유지한다. 실제 권한 부여 및 capability 지원 결과는 **UNVERIFIED**다.

## 런타임 T1–T10

| 검증 | 판정 | 근거 |
|---|---|---|
| T1 SDK 초기화/도메인 접근 | BLOCKED | gate 실패 |
| T2 두 safety 권한 | BLOCKED | 기기 없음 |
| T3 pressure capability | BLOCKED | API 미실행 |
| T4 low-pressure capability | BLOCKED | API 미실행 |
| T5 바퀴별 지원 영역 | BLOCKED | API 미실행 |
| T6 실제 getter | BLOCKED | API 미실행 |
| T7 listener 등록/이벤트 | BLOCKED | API 미실행 |
| T8 실제 null/예외/권한 거부 | BLOCKED | fake 테스트와 구분 |
| T9 실제 STALE 전환 | BLOCKED | fake clock 테스트와 구분 |
| T10 Activity 중지/복원/종료 | BLOCKED | owner 시뮬레이션 단위 테스트와 구분 |

| 내부 바퀴 ID | pressure raw | low-pressure raw | unit | 실제 capability |
|---|---|---|---|---|
| tire.front-left | 미수신 | 미수신 | null (미확인) | UNVERIFIED |
| tire.front-right | 미수신 | 미수신 | null (미확인) | UNVERIFIED |
| tire.rear-left | 미수신 | 미수신 | null (미확인) | UNVERIFIED |
| tire.rear-right | 미수신 | 미수신 | null (미확인) | UNVERIFIED |

미수신을 0 또는 UNSUPPORTED로 바꾸지 않았다. Float 단위/low-pressure 의미가 확인되지 않았으므로 PSI/kPa/bar 변환, 정상/저압 판단은 제공하지 않는다. 단위 테스트의 합성 Float는 위 실측 표에 포함하지 않는다.

## 세션 무응답 원인과 최소 조치

기존 baseline 테스트에서 논리 timeout 후에도 pending이 남고 release를 기다리는 동작을 확인했다. 공개 취소 API가 없는 상태에서 이 대기는 안전상 유지해야 한다. 문제는 이전 Activity `onCreate`마다 별도의 source/worker를 만들고, `onDestroy`가 비동기 close를 요청하므로 **새 Activity는 이전 source의 pending 보호를 우회**할 수 있다는 점이다. 또 release 예외에도 session을 null로 바꾸어 재시작을 허용했고 unregister 예외도 로그만 남겼다.

조치:

1. Debug probe가 프로세스 소유 `TireProbeOwner` 하나와 controller/worker 하나를 재사용한다. lease로 Activity 소유권을 구분한다. 교체된 Activity의 start/stop/detach는 현재 소유자를 변경하지 못한다.
2. stop/close 호출 시 atomic epoch를 즉시 무효화한다. worker가 cleanup을 처리하기 전에도 기존 snapshot을 숨기고, 이미 queue에 들어온 이전 callback을 데이터로 수용하지 않는다. 실제 SDK 정리는 기존 단일 worker에서 직렬 처리한다.
3. 실제 pending과 timeout된 pending을 별도로 추적한다. 10초 timeout은 ERROR 표시일 뿐 취소가 아니다. 실제 callback이 오면 한 번만 pending을 감소시키고 timeout 이후 결과는 폐기한다. stop 후 늦은 capability는 getter/listener를 생성하지 않는다.
4. pending이 남은 종료는 내부 `UNRESOLVED`다. callback이 영구 무응답이면 새 세션을 열지 않는다. pending이 실제로 모두 소진되고 cleanup 오류가 없을 때만 기존 release 경로를 실행한다.
5. unregister 예외는 cleanup failure로 격리한다. 안전성이 확인되지 않아 그 상태에서 release/재등록을 강행하지 않는다. release 예외도 세션을 보유하고 중복 release나 새 initialize를 막는다. 기존 partial-registration 테스트의 release 기대값은 이 정책에 맞춰 1→0으로 바꾸고 UNRESOLVED 및 재시작 차단을 추가 검증했다. 테스트 제외나 임계값 완화는 없다.
6. Debug JSON에 `internalSessionDiagnostics`를 추가한다. 공개 reading 계약은 그대로다. phase, actual pending, timed-out pending, cleanupFailures, releaseAttempted, restartRequested, stopRequested, remoteCleanup=UNVERIFIED를 표시한다. IDLE/CLOSED는 로컬 추적 상태이며 원격 정리 증명이 아니다.

### 보유 범위와 한계

프로세스 singleton은 source, dispatcher, applicationContext만 보유한다. Activity/View/Handler는 저장하지 않는다. Activity는 onStop에서 render tick을 제거하고 onDestroy에서 lease를 해제한다. 정상 정리 후에도 **worker 하나는 프로세스 수명 동안 재사용**한다. 영구 callback 무응답이면 SDK/session/콜백 closure, 미완료 요청 두 개 이상과 worker가 계속 남을 수 있다. 반복 Activity 재생성으로 이 수가 새 세션 단위로 늘어나지 않도록 제한한 것이며 메모리 누수가 완전히 해결되었다고 주장하지 않는다.

SDK 메서드 자체가 동기적으로 영구 block되면 같은 worker의 timer/cleanup도 실행되지 않는다. stopRequested와 epoch 무효화는 호출 스레드에서 즉시 적용되지만 worker 진단은 마지막 처리 시점 상태일 수 있다. 강제 thread termination, 강제 release, 가상의 cancel은 없다. UNRESOLVED 상태의 자동 복구/재시도는 제공하지 않는다. 원격 서비스 정리 여부는 반환만으로 확인할 수 없다. 실제 Activity 및 SDK 정리는 AVD 재검증이 필요하다.

## 검증

시작 baseline: `:vehicle-core:test :app:testDebugUnitTest --rerun-tasks` **PASS**. 이후 변경 테스트와 빌드의 fresh 결과는 아래에 기록한다. 모든 Gradle 실행은 JDK 17, SDK API34, SDK2.3.2, Gradle 8.14, 단일 worker / JVM 최대 768MiB / Kotlin in-process를 사용했다.

| 명령/검사 | 결과 |
|---|---|
| `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS — 38개 중 37 pass, 1 skip |
| `gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain` | PASS — 106 tasks 실행, build 성공 |
| app Debug 단위 테스트 | PASS — 59개, Tire controller 27 / SDK mapping 2 / 기존 Door 19 / identity 7 / profile 4 |
| Tire data core 테스트 | PASS — 5개 (위 core 38개에 포함) |
| lintDebug | PASS — errors 0, warnings 14 (target API/dependency/JS/data extraction/icon/TextI18n) |
| `python -B -m unittest discover -s tools/tire-probe -p test_health.py -v` | PASS — 2개, gate 경계값/실패 조건 |
| `python tools/tire-probe/check.py sdk-audit --aar=<Vehicle-2.3.2.aar> --out=<외부 sdk-audit>` | PASS — AAR 선언만 |
| `python tools/tire-probe/check.py build-contract` | PASS — 새 owner/diagnostics까지 Debug DEX 포함, Release APK/AAB 제외, safety 권한 Debug 전용 |
| `python tools/identity-probe/check.py build-contract` | PASS — identity/profile/WebGL/inspection Release 격리, 기존 release 권한 유지 |
| `git diff --check` | PASS |
| 최종 owner 확인 추가 후 `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug` | PASS — app 59개 재실행, Debug APK/lint 갱신 후 격리 검사 재실행 |
| 실제 AVD T1–T10 | BLOCKED |

Gradle 공통 실행 옵션은 `--max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" "-Pkotlin.compiler.execution.strategy=in-process"`이다. core의 skip 1개는 외부 `IONIQ5_PARTS`가 필요한 기존 optional test이며 이번에 제외한 테스트가 아니다. Door 회귀는 fake transport JVM 검증이며 실차/AVD Door 재실행을 뜻하지 않는다.

집중 사례는 callback 영구 무응답 후 50회 owner 교체, stop 직후/timeout 직후 callback, 이미 queue에 들어온 event의 즉시 무효화, 중복 release, rapid start-stop-start, 권한 거부 후 재시작, partial registration/unregister 실패, release 실패 격리, 이전 owner의 늦은 capability, raw/observedAt 보존, 5000ms STALE 경계이다. fake 테스트는 실제 Activity 재생성이나 AVD 성공의 증거가 아니다.

## P3-I1 통합 판정

내부 4개 ID와 immutable snapshot 전달, getter/event 기반 cache + 화면의 1초 재평가 방식은 준비되어 있다. UI 갱신은 reading의 capability/availability/value/observedAt/reason/source 변경과 STALE 전환에 따른다. 화면 tick은 SDK getter를 반복하지 않고 observedAt도 갱신하지 않는다. 내부 cleanup 진단은 데이터 상태와 별도로 표시해야 한다.

**실제 capability·권한·수신·listener 동작은 아직 미검증이므로 P3-I1은 상태 배지만 연결하는 범위로 권장한다.** 데이터 없음/오류/권한 없음/UNVERIFIED/STALE를 구분하고 raw Float를 압력 숫자나 안전 판단으로 표시하지 않는다. 실제 수치 UI는 건강한 AVD에서 T1–T10을 실행하고 공식 단위·의미를 확인한 뒤 별도 진행한다. 이번 변경은 3D 통합을 수행하지 않았다.
