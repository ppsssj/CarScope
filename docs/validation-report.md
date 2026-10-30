# CarScope 검증 보고서

G0 공유본 안내: 개인 작업 경로는 `<repository-root>` 등으로 치환했습니다. 아래 판정과 실행 이력은 유지합니다. 원본 로그·스크린샷·시스템 정보·테스트 XML은 발생 PC에 보존하고 Git에서는 제외합니다. evidence 디렉터리의 공유 README만 업로드합니다. 현재 Door Event는 **NOT_RUN**이며 실제 SDK 수신 성공을 주장하지 않습니다.

**최신 결과:** [P1-B 읽기 전용 SDK 연동](#p1-b--pleos-읽기-전용-sdk-연동-2026-10-30)은 **BLOCKED / 미완료**입니다. 구현·단위 테스트・APK 설치까지 확인했으나 OEM/framework ANR 및 시스템 사망으로 SDK 이벤트→SVG는 확인하지 못했습니다. 아래 P0와 P1-A 결과·증거는 당시 기록으로 보존합니다.

## P1-B — Pleos 읽기 전용 SDK 연동 (2026-10-30)

| 항목 | 상태 | 근거 / 제한 |
| --- | --- | --- |
| 기존 작업 감사·보존 | PASS | 기존 44개 파일 inventory/backup. 삭제 없음, core 소스·17개 테스트·기존 증거 유지 |
| 공식 SDK 접근·타입 확인 | PASS | 공식 Maven Vehicle 2.3.2, AAR/POM download, javap 및 공식 typed 샘플 대조 |
| SDK/Service 버전 조건 | PASS | SDK 2.3.2/code 73, 최소 Service 2.3.13/code 65, AVD 실제 Service 2.3.22/code 74. 기능 호환성 성공과 구별 |
| 정적 코드 검토 | PASS | ROW_1_LEFT만, 조회·구독만, 출처 보존, no automatic Mock, 비동기/lifecycle 경계 |
| Kotlin 컴파일 | PASS | core와 Android app 및 app unit test 컴파일 |
| core Kotlin 테스트 | PASS | 기존 JUnit 17개, failures/errors/skipped=0 |
| app 어댑터 합성 테스트 | PASS | 추가 JUnit 19개, failures/errors/skipped=0. SDK/Binder 실험 아님 |
| Gradle/Android debug build | PASS | 원래 JDK/Gradle/AGP/Kotlin/API 설정 유지, SDK AAR 포함 |
| APK 생성·서명·설치 | PASS | 11,749,170 bytes, v2 debug signature, adb install -r Success |
| Manifest 권한 선언/정의 | PASS | CAR_DOORS + AAR의 VEHICLE_BINDING만. AVD Service에서 normal 정의 확인 |
| 실제 앱 grant/API 권한 허용 | BLOCKED | 최신 dumpsys package timeout, 실제 capability/read 응답 미확인 |
| 새 APK의 Mock STALE UI/SVG | PASS | native pixel screenshot 두 세션에서 확보. 전체 Mock 회귀를 뜻하지 않음 |
| 새 APK의 Mock 버튼 3종 전체 회귀 | BLOCKED | 조작 불안정으로 재실행 못함. P1-A 3종 PASS 증거와 core Mock 테스트 보존 |
| AVD cold boot 완료 신호 | PASS | 최초 및 같은 설정의 복구 1회에서 sys.boot_completed=1 |
| 에뮬레이터 안정적 실행 | FAIL | OEM/framework ANR, VHAL died, DeadSystemException, 마지막 black screen |
| SDK 초기화/연결 | BLOCKED | PLEOS 선택 입력 exit 0이었으나 실제 source 전환/초기화 로그 미확인 |
| 실제 Door capability/current | BLOCKED | SDK 응답을 수신했다는 증거 없음 |
| Virtual Console 도어 변경 | NOT_RUN | 접속·Convenience→Door Position Front left 확인까지만. OPEN/CLOSE 변경 안 함 |
| 실제 SDK event→SVG | BLOCKED | 성공 조건 미충족, Mock SVG PASS를 전용하지 않음 |
| SDK 모드 Activity 재생성/실제 cleanup | NOT_RUN | 소유자 교체·late callback·release 대기 단위 테스트만 PASS |
| 성능 계측/최적화 | NOT_RUN | 구간 지연 UNMEASURED, 개선 전후 비교 없음, 임의 최적화 없음 |
| 실차 | NOT_RUN | 연결 없음 |

SDK를 포함한 APK SHA-256: `1A7CD16452C1308026B01762D4E546610C2578EC309073141446E268A9E134B1`. 경로: `app/build/outputs/apk/debug/app-debug.apk`. SDK dependency는 app에만 있으며 vehicle-core에는 SDK/Android 의존성이 없습니다. App source permission은 CAR_DOORS 하나, 병합 binding permission 이외 control/private/network permission은 없습니다.

| 실제 명령 / 실행 | 결과 |
| --- | --- |
| `:app:dependencies --configuration debugRuntimeClasspath` | PASS, 공식 repository dependency 해석 |
| `:vehicle-core:test :app:testDebugUnitTest :app:assembleDebug --rerun-tasks` | core 17 PASS 후 신규 app test의 Mock 생성자 인자 오류로 FAIL; 수정 |
| app test/build `--offline` | FAIL, 새 runtime JAR 캐시 누락; 버전 변경 없이 online 다운로드 |
| `:app:testDebugUnitTest :app:assembleDebug` online | app 19 PASS, APK PASS, 41s |
| 세 task 최종 `--offline` 실행 | PASS, 25s, 43 UP-TO-DATE; 새 테스트 실행으로 세지 않음 |
| 최종 두 test task `--rerun-tasks --offline` | PASS, 38s/26 task 실제 실행, 17+19=36개, failures/errors/skipped=0. XML/로그를 evidence에 보존 |
| `apksigner verify --verbose`; `aapt2 dump badging`; `adb install -r` | PASS |
| 첫 `am start -W` | Status ok, UNKNOWN(0), WaitTime 3185ms. 실제 앱 표시 보장 아님 |
| 첫 `am start -W --display 0 --windowingMode 1` | HOT, TotalTime 22172ms, WaitTime 22398ms |
| 복구 후 같은 start 명령 | Status timeout, WaitTime 80421ms; Displayed +1m33s51ms 별도 기록 |
| `dumpsys package/window` | 10000ms DUMP TIMEOUT |
| `uiautomator dump --compressed` | 24371ms, exit 137 |
| native 화면 확인 후 `input tap 1900 130` | exit 0, 3597ms; SDK 로그/출처 전환은 확인 못함 |
| `screencap -p` 및 pull | MOCK/STALE 화면 확보, 최종 system failure 시 black screen |
| `adb emu kill`; 수집 logcat 종료; `adb forward --list` | 작업 AVD 종료, 최종 forward 목록 비어 있음 |

명령에는 실행별 `--max-workers=1`, `-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8`, `-Pkotlin.compiler.execution.strategy=in-process`를 사용했습니다. 상세 경로·완전한 명령과 로그, T1~T10 판정, API/권한/수명주기 설계는 [연동 문서](pleos-sdk-integration.md), 선별한 원본은 [P1-B evidence](evidence/p1-b/2026-10-30/)에 있습니다. 로컬 전체 로그/수정 전 파일은 Git 제외 `.tools/p1-b/20261030T084712Z/`입니다.

이번 실행에서 CarScope 전용 SDK 진단 메시지·CarScope FATAL/ANR 일치는 발견하지 못했습니다. SDK 초기화가 실제 수행됐다는 증거도 없으므로 앱 안정성 PASS로 해석하지 않습니다. OEM input monitor/car/ui 오류, Android Bluetooth/Phone/SystemUI ANR 및 VHAL/system 사망을 구분해 남겼고 도어 조작과의 인과관계는 확인하지 못했습니다. SDK 값 변경을 실행하지 않았습니다. 물리 해상도, AVD 설정 및 Windows 기능을 바꾸지 않았습니다.

변경: Gradle repository/app dependency, Manifest, MainActivity, strings, 문서 6종. 신규: app의 SDK bridge/controller, app 합성 테스트, 연동 문서 및 evidence. 기존 코드 삭제·초기화·Git push·PR·merge 없음. **P2는 보류**하며 지원 사양 Pleos 환경에서 T1~T10을 먼저 검증해야 합니다.

## 이전 P0 검증 기록

검증일: **2026-10-30, Asia/Seoul**. 초기 작업 보존 상태에서 복구·검증·보완했습니다. core는 실행 검증했으며 Android 및 실차 연결을 완료로 보고하지 않습니다.

## 상태 정의 및 P0 판정

- **PASS**: 지정한 범위를 실제 확인하거나 실행하여 성공.
- **FAIL**: 실행 결과 오류 또는 기대값 불일치. 수정 전 실패도 이 상태로 기록.
- **BLOCKED**: 필요한 환경/외부 조건이 없어 목표 검증을 진행할 수 없음.
- **NOT_RUN**: 해당 실행을 수행하지 않음. 문서 확인으로 대체하지 않음.

| 검증 항목 | 상태 | 확인 범위 / 제한 |
| --- | --- | --- |
| 정적 코드 검토 — core | PASS | 타입, Mock, origin, unavailable/stale, SVG/XML, null/예외 경계 |
| 정적 코드 검토 — Android | PASS | 구성/Manifest/XML/resource 참조/WebView/수명주기 검토. Android 컴파일 의미 아님 |
| Kotlin 컴파일 — Gradle KGP 2.2.0 | PASS | vehicle-core main/test, JVM target 17 |
| Kotlin 컴파일 — 독립 경로 2.0.21 | PASS | 로컬 Gradle 8.14의 compiler JAR로 main/test 별도 컴파일 |
| Kotlin 테스트 — Gradle | PASS | JUnit 17개, failures=0, errors=0, skipped=0 |
| Kotlin 테스트 — 독립 JUnitCore | PASS | 동일 17개, JUnit 4.13.2, `OK (17 tests)` |
| Gradle 프로젝트 구성 — coreOnly | PASS | Android 모듈을 제외한 core check/export |
| Gradle 프로젝트 구성 — 전체 | PASS | `projects`에 app/vehicle-core 표시, SDK 없이 구성 단계 성공 |
| Gradle Wrapper JAR/실행 | PASS | 공식 SHA-256 일치, 캐시 사용 `--version`=8.14 |
| 빈 캐시에서 Wrapper ZIP 재다운로드 | NOT_RUN | 기존 정상 배포본 캐시 이용. 전체 ZIP 재다운로드 안 함 |
| Android 빌드 | BLOCKED | `:app:assembleDebug` exit 1, `SDK location not found` |
| Android Kotlin / resource compile / lint | NOT_RUN | SDK 탐색 단계에서 중단, lint는 별도 실행 안 함 |
| APK 생성 | BLOCKED | Android 빌드 차단. 저장소에서 APK 검색 결과 0개 |
| SVG 생성 / XML 구조 검증 | PASS | 상태별 문자열·fill·텍스트·ID·namespace·escaping 검증, SVG 4개 export |
| Gradle / 독립 compiler SVG 일치 | PASS | 두 경로의 SVG 4개 SHA-256이 각각 일치 |
| SVG 실제 픽셀 렌더링 | NOT_RUN | desktop browser 및 Android WebView 화면을 실행하지 않음 |
| WebView/Activity 수명주기 실행 | NOT_RUN | 정적 검토만 수행 |
| 에뮬레이터 실행 | BLOCKED | Android SDK / adb / emulator 미발견, 설치 안 함 |
| Pleos SDK 연동 | NOT_RUN | dependency/adapter/서비스 호출 없음; 향후 실행 환경도 미확보 |
| 실차 검증 | NOT_RUN | 차량 연결 없음 |

core 실행 결과를 APK·WebView·Pleos 검증의 PASS로 확장하지 않습니다.

## 1. 기존 작업 복구와 현재 구조

당시 작업 디렉터리: `<repository-root>`. Git은 `main` 첫 커밋 전 상태이고 tracked 파일은 0개였습니다. `origin`은 `https://github.com/ppsssj/CarScope.git`로 등록되어 있습니다. `git status`에 upstream `[gone]`가 표시됐지만 P0에서는 fetch/push로 원격 상태를 변경하거나 확인하지 않았습니다.

수정 전 미추적 프로젝트 파일 **19개**를 모두 조사했습니다.

```text
.gitattributes
.gitignore
app/build.gradle.kts
app/src/main/AndroidManifest.xml
app/src/main/java/io/carscope/app/MainActivity.kt
app/src/main/res/values/strings.xml
build.gradle.kts
gradle.properties
gradle/wrapper/gradle-wrapper.jar
gradle/wrapper/gradle-wrapper.properties
gradlew
gradlew.bat
settings.gradle.kts
vehicle-core/build.gradle.kts
vehicle-core/src/main/kotlin/io/carscope/vehicle/MockVehicleDataSource.kt
vehicle-core/src/main/kotlin/io/carscope/vehicle/VehicleDataSource.kt
vehicle-core/src/main/kotlin/io/carscope/visualization/VehicleDiagram.kt
vehicle-core/src/main/kotlin/io/carscope/visualization/VehicleSvgRenderer.kt
vehicle-core/src/test/kotlin/io/carscope/vehicle/VehiclePipelineTest.kt
```

무시된 기존 `.tools/wrapper-bootstrap/`에는 bootstrap용 Gradle 설정, wrapper scripts/JAR/properties와 `.gradle` 실행 캐시가 있었습니다. 이 디렉터리도 유지했습니다. `.git` 메타데이터, 기존 소스, wrapper를 삭제하거나 초기화하지 않았습니다. 적용할 AGENTS.md는 현재/상위 프로젝트 경로에서 발견되지 않았습니다.

수정 전 19개 파일의 원본 사본과 path/length/SHA-256을 `.tools/p0-recovery/` 및 `inventory.json`에 보관했습니다. 이후 원본 파일 **19개 모두 존재**하는 것을 재확인했습니다. Git stage/commit/push, PR 생성/병합은 수행하지 않았습니다. 현재 상세 트리는 [README](../README.md)에 있습니다.

`.gitignore`는 `.gradle`, `.kotlin`, `.tools`, 모든 build 디렉터리, local.properties, IDE 파일, SDK 로컬 폴더, keystore 등을 제외합니다. 기존 규칙을 유지했습니다. 실행 과정의 의존성 캐시는 사용자 Gradle cache에, 빌드 결과는 ignored build 디렉터리에 생성됩니다.

## 2. 수정 및 신규 파일

기존 파일 11개 수정, 8개 그대로 보존. 신규 소스/스크립트/문서 7개를 추가했습니다. 모든 파일은 처음부터 미추적 상태였으므로 아래 구분은 Git diff 대신 복구 inventory와의 비교입니다.

| 수정 파일 | 이유 |
| --- | --- |
| `build.gradle.kts` | AGP/Kotlin plugin을 공통 parent classpath에 apply false로 선언 |
| `settings.gradle.kts` | AGP 8.7.3 → 8.10.0, KGP 2.2.0/Gradle 8.14 유지 |
| `gradle/wrapper/gradle-wrapper.properties` | 공식 distribution checksum 추가, URL 검증 활성화 |
| `vehicle-core/build.gradle.kts` | 결정적 SVG sample export task 추가 |
| `VehicleDataSource.kt` | 관측 시각 및 null/오류/출처 경계 계약 명시 |
| `MockVehicleDataSource.kt` | read당 scenario를 한 번 채집하여 일관된 snapshot 생성 |
| `VehicleDiagram.kt` | 음수 시각 검사와 차감 overflow 방지 |
| `VehicleSvgRenderer.kt` | title/desc XML escaping |
| `VehiclePipelineTest.kt` | 기존 8개를 보존하고 회귀·상태·출처·XML 검증 9개 추가 |
| `MainActivity.kt` | 관측값 재사용 freshness 재평가, 변경된 SVG만 로드, 오류 상태 보존 및 cleanup |
| `strings.xml` | MOCK 갱신/STALE 안내, 출처, 화면 갱신 시각(UTC) 문구 |

신규: `README.md`, `docs/architecture.md`, `docs/feasibility.md`, `docs/roadmap.md`, 이 보고서, `scripts/validate-core.ps1`, `VehicleSvgSamples.kt`.

Wrapper scripts/JAR, app build 설정, Manifest, `.gitignore`, `.gitattributes`, `gradle.properties`는 원본과 동일합니다. SDK 위치나 JDK/Gradle의 기계별 절대경로는 공식 빌드 설정에 넣지 않았습니다.

## 3. Wrapper 조사 및 복구 판단

원본 distributionUrl은 `https://services.gradle.org/distributions/gradle-8.14-bin.zip`, networkTimeout은 10,000ms였습니다. 로컬 실행 파일은 다음 기존 캐시에서 발견했습니다.

```text
%USERPROFILE%/.gradle/wrapper/dists/gradle-8.14-bin/38aieal9i53h9rfe7vjup95b9/gradle-8.14/bin/gradle.bat
```

이 경로는 환경 조사 결과이며 프로젝트의 공식 경로 설정이 아닙니다. 실행 시 PowerShell `$localGradle` 변수로만 사용했습니다. 로컬 9.2.1 캐시도 있었으나 사용하지 않았습니다. Gradle 출력에 보이는 Kotlin 2.0.21은 배포본 내장 Kotlin이고 프로젝트 KGP 2.2.0과 다릅니다.

JAR 크기 43,764 bytes, ZIP 엔트리 및 공식 hash를 확인했습니다.

```text
gradle-wrapper.jar SHA-256
7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172

Gradle 8.14 -bin ZIP 공식 SHA-256
61ad310d3c7d3e5da131b76bbf22b5a4c0786e9d892dae8c1658d4b484de3caa
```

공식 [Gradle checksum 목록](https://gradle.org/release-checksums/) 및 checksum endpoint와 대조했습니다. 새 다운로드에 적용할 `distributionSha256Sum`을 넣고 `validateDistributionUrl=true`로 바꿨습니다. 이미 압축 해제된 캐시에는 ZIP이 없으므로 기존 배포본 전체를 checksum으로 재검증한 것은 아닙니다. 실제 실행으로 버전/JDK는 확인했습니다.

이전 작업의 Wrapper 실패는 사용자 인계상 **네트워크 다운로드 오류**입니다. 당시 예외/HTTP 로그가 프로젝트에 남아 있지 않아 DNS, proxy, TLS, timeout 또는 redirect 중 어느 것이 원인이었는지 특정할 수 없습니다. 이번에는 공식 checksum 두 요청이 HTTP 200이었고 Wrapper가 기존 캐시로 정상 실행됐습니다. 이는 과거 오류의 정확한 원인 규명이나 빈 캐시 다운로드 성공의 증거가 아닙니다. 무한 반복이나 배포본 삭제 후 재다운로드를 하지 않았습니다.

## 4. core 실행 검증과 수정한 결함

최초 offline Gradle 테스트는 KGP 2.2.0 캐시 부재로 exit 1이었습니다. 네트워크 접근이 가능해 연결/읽기 timeout을 각각 10초로 제한한 온라인 실행 한 차례가 성공했고, 기존 **8개 테스트가 PASS**했습니다. 로컬 compiler를 직접 실행한 독립 경로에서도 8개가 통과했습니다.

추가한 시각 경계 회귀 테스트는 수정 전 **9개 중 1개 FAIL**을 재현했습니다. 음수 관측은 과거 timestamp처럼 처리되고, 극단 값은 뺄셈 overflow로 현재 값처럼 취급될 가능성이 있었습니다. 음수·미래 시각 검사 후 유효한 비음수 범위에서만 차감하도록 보완했습니다. 관련 실패 로그/XML을 `.tools/core-regression-before-fix.*`에 보존했습니다.

최종 17개 검증 범위:

1. Mock 출처, 4개 door, 한 번의 clock 채집.
2. 앞 왼쪽 OPEN 및 CLOSED 복귀.
3. 성공값 이후 UNAVAILABLE 전환 시 이전 값 제거.
4. 누락 key와 unavailable 입력이 CLOSED가 되지 않음.
5. 5,000ms inclusive / 5,001ms STALE.
6. 미래 관측 UNAVAILABLE.
7. 음수/Long.MIN_VALUE/Long.MAX_VALUE/epoch 경계와 overflow 방지.
8. SVG XML namespace, 안정적 ID, 상태/출처, script/foreignObject 부재.
9. UNAVAILABLE SVG에 CLOSED가 나타나지 않음.
10. MOCK/합성 PLEOS 출처의 mapper/title 전달.
11. 모든 unavailable reason과 각 door 누락의 독립 처리.
12. 마지막 OPEN/CLOSED 모두 STALE 우선 표시.
13. Mock 변경이 이전 snapshot을 바꾸지 않음.
14. 4개 visual state의 서로 다른 SVG fill과 명시적 텍스트.
15. renderer의 누락 diagram key fallback.
16. XML 특수문자·한글·이미 escape처럼 보이는 텍스트의 round trip, element/attribute 주입 방지.
17. Mock clock 예외를 유효한 데이터로 위장하지 않음.

Null·unknown SDK 값과 실제 권한 예외 변환은 모델 계약만 정했고 SDK 어댑터 실행으로 검증하지 않았습니다. arbitrary external SVG의 sanitization도 이 테스트 범위가 아닙니다.

## 5. Android 정적 검증

최종 기준선: AGP **8.10.0**, KGP **2.2.0**, Gradle **8.14**, JDK **17.0.17**. minSdk **28**, compileSdk·targetSdk **34**. 공식 버전 근거와 Build Tools 35.0.0 조건은 [feasibility](feasibility.md)에 있습니다.

- Manifest: Automotive required=true, touchscreen required=false, `.MainActivity` MAIN/LAUNCHER 및 exported=true. network/vehicle 권한과 distractionOptimized 선언 없음.
- 의존성: app → vehicle-core. core는 Kotlin/JVM + JUnit이고 Android/SDK import 없음. Pleos dependency/repository 없음.
- Manifest/strings XML 파싱 성공, Activity의 고유 `R.string` 참조 **10개** 모두 선언 존재. AAPT/manifest merger/lint를 실행한 것은 아님.
- 정적 SVG의 JavaScript 활성화 불필요. JS/DOM storage/file/content/network를 차단하고 CSP와 navigation 차단 적용. 메모리 HTML로 SVG를 로드하며 외부 서버/파일에 의존하지 않음.
- WebView 제공자/초기화/주 프레임 오류 시 텍스트 fallback. 오류 뒤 page-finished가 성공 문구로 덮어쓰지 않도록 처리. 실제 callback 순서/픽셀/접근성 미검증.
- snapshot 재평가는 관측을 새로 만들지 않음. Handler는 화면 시작 시 등록, 중지/종료 시 제거. Activity 실행과 시스템 시각 변경에 대한 UX는 기기에서 확인 필요.

환경변수 ANDROID_HOME/ANDROID_SDK_ROOT 및 local.properties가 없고, PATH에서 adb/emulator가 발견되지 않았습니다. `%LOCALAPPDATA%/Android/Sdk`, `%USERPROFILE%/Android/Sdk`, 다른 일반 SDK 설치 후보 경로, 프로젝트 `.android-sdk`도 없었습니다. 모든 디스크에 설치 흔적이 없다고 단정하지는 않지만 Gradle이 사용할 SDK는 발견되지 않았고 실제 빌드도 같은 이유로 차단됐습니다.

전체 프로젝트 구성 과정에서 Kotlin plugin 중복 로딩 경고를 확인하고 공통 root classpath로 수정했습니다. 중간 변경에서는 공통 parent의 Kotlin이 child AGP 클래스를 보지 못해 `BaseVariant` class 로딩 FAIL이 발생했고, AGP도 같은 parent에 apply false로 선언하여 해결했습니다. `coreOnly`는 SDK 없이 동작하지만 첫 Gradle 사용에는 공통 AGP/KGP 아티팩트 캐시도 필요합니다.

남은 Gradle 9 관련 `isCrunchPngs`, `isUseProguard`, `isWearAppUnbundled` deprecation은 AGP 내부 타입에서 발생합니다. Gradle 8.14 구성/테스트를 차단하지 않으며 P0에서 9.x 업그레이드는 하지 않았습니다.

## 6. 실제 명령 및 결과

아래는 현재 작업 디렉터리에서 실제 수행한 명령입니다. `$localGradle`은 README와 동일하게 로컬 8.14의 `gradle.bat`를 탐색해 할당했습니다. 원본 stdout/stderr는 ignored `.tools/`에 보존합니다. 표의 실패는 그 시점의 실행 결과이며 최종 판정과 구분합니다.

| 명령 | 결과 | 원본 기록 |
| --- | --- | --- |
| `Get-Location`; `git status --short`; `git status --branch --porcelain=v1`; `git status --short --untracked-files=all`; `git ls-files`; `git remote -v` | 첫 커밋 전 main, 초기 untracked 19개, tracked 0개, origin 확인 | 세션 출력, recovery inventory |
| `rg --files --hidden -g '!.git' -g '!**/.gradle/**' -g '!**/build/**'`; `Get-ChildItem .tools -Recurse -Force`; 각 파일 `Get-Content` | 프로젝트 및 ignored bootstrap 조사 | 세션 출력 |
| `Get-Command java,javac,jar,gradle,kotlinc,adb,emulator -ErrorAction SilentlyContinue`; `java -version` | JDK 17.0.17 발견, 별도 kotlinc/adb/emulator 없음 | 세션 출력 |
| `Get-FileHash gradle/wrapper/gradle-wrapper.jar`; `jar tf gradle/wrapper/gradle-wrapper.jar` | SHA-256/ZIP 엔트리 정상 | 세션 출력 |
| `Invoke-WebRequest -Uri <공식 gradle-8.14-wrapper.jar.sha256 및 -bin.zip.sha256 endpoint> -TimeoutSec 15` | 두 요청 HTTP 200, 공식 hash 확인 | 세션 출력 |
| `& $localGradle --version`; `.\gradlew.bat --version` | exit 0, Gradle 8.14/JDK 17 | `.tools/wrapper-version.log`, `wrapper-final.log` |
| `& $localGradle -PcoreOnly=true :vehicle-core:test --offline --console=plain --stacktrace` | exit 1, KGP 캐시 부재, BLOCKED | `.tools/core-baseline.log` |
| `& $localGradle -PcoreOnly=true :vehicle-core:test --console=plain '-Dorg.gradle.internal.http.connectionTimeout=10000' '-Dorg.gradle.internal.http.socketTimeout=10000'` | exit 0, 기존 8 tests PASS | `.tools/core-online.log` |
| `.\scripts\validate-core.ps1` (초기) | exit 0, Kotlin 2.0.21 + 기존 8 tests PASS | `.tools/standalone-baseline.log` |
| `& $localGradle projects :app:assembleDebug --offline --console=plain` (초기) | exit 1, AGP 캐시 부재, BLOCKED | `.tools/android-baseline.log` |
| `& $localGradle projects :app:assembleDebug --console=plain '-Dorg.gradle.internal.http.connectionTimeout=10000' '-Dorg.gradle.internal.http.socketTimeout=10000'` (초기 AGP) | exit 1, SDK location not found, BLOCKED | `.tools/android-online.log` |
| `& $localGradle -PcoreOnly=true :vehicle-core:test --offline --console=plain` (수정 전 regression) | exit 1, 9 tests / 1 FAIL | `.tools/core-regression-before-fix.log`, `.xml` |
| `& $localGradle -PcoreOnly=true projects :vehicle-core:test --offline --console=plain` (mapper 수정 후) | exit 0, 17 tests PASS | `.tools/core-final.log` |
| `& $localGradle projects --console=plain --warning-mode all '-Dorg.gradle.internal.http.connectionTimeout=10000' '-Dorg.gradle.internal.http.socketTimeout=10000'` (AGP 정렬/parent 수정 중) | 중간 BaseVariant class 로딩 FAIL, 이후 root AGP 선언으로 수정 | 세션 출력 |
| `& $localGradle projects --offline --console=plain --warning-mode all` (최종) | exit 0, app/vehicle-core 구성 PASS, KGP 중복 경고 제거 | `.tools/projects-final.log` |
| `& $localGradle -PcoreOnly=true :vehicle-core:check :vehicle-core:exportSvgSamples --offline --rerun-tasks --console=plain` (최종) | exit 0, main/test 재컴파일 및 17 tests 실제 재실행 PASS, SVG 4개 생성 | `.tools/core-export-final.log` |
| `.\scripts\validate-core.ps1` (최종) | exit 0, 독립 main/test 컴파일 + 17 tests + SVG export PASS | `.tools/standalone-final.log`, build/standalone 실행별 validation.log |
| `& $localGradle :app:assembleDebug --offline --console=plain` (최종) | exit 1, SDK location not found, BLOCKED | `.tools/android-final.log` |
| `[xml](Get-Content ... -Raw)`로 Manifest/strings 파싱 및 `R.string` 정규식 참조 대조 | XML PASS, 10 references, missing=0 | 세션 출력 |
| `Get-ChildItem . -Recurse -Filter '*.apk' -File` | 결과 0개 | 세션 출력 |
| `Get-FileHash`로 Gradle/독립 경로 SVG 대조, 문서 로컬 링크/텍스트 공백 및 inventory 존재 검사 | SVG 4개 hash 일치, 링크/공백 검사 PASS, 기존 19개 파일 존재 | 세션 출력 |

중간 plugin classpath 변경 시 offline missing Gson/error_prone cache 오류도 발생했습니다. 네트워크가 동작하는 상황에서 변경된 classpath 의존성을 해결했으며, 최종 offline 실행을 다시 검증했습니다. 네트워크가 끊긴 상태에서 같은 다운로드를 반복한 것은 아닙니다.

## 7. 산출물과 재현

- Gradle 테스트 XML: `vehicle-core/build/test-results/test/TEST-io.carscope.vehicle.VehiclePipelineTest.xml` (17/0/0/0).
- Gradle HTML 보고서: `vehicle-core/build/reports/tests/test/index.html`.
- SVG 예제: `vehicle-core/build/validation/svg/{closed,front-left-open,unavailable,stale}.svg`.
- 독립 검증 산출물: `vehicle-core/build/standalone/<run-id>/validation.log`, main/test JAR, `svg/`.
- 복구 원본/초기 hash: `.tools/p0-recovery/`.

이 파일들은 재생성 가능한 로컬 증거이며 `.gitignore`의 build/.tools 규칙으로 제외됩니다. 재현 명령은 README를 따릅니다. 테스트 소스와 문서는 저장소 파일로 남깁니다.

## 8. P1 준비 상태와 차단 요소

**P1 환경 준비에 진입 가능**합니다. SDK 없는 core 검증 기반을 확보했고, 다음 검증의 입력/완료 조건을 [roadmap](roadmap.md)에 정의했습니다.

남은 차단 요소는 Android SDK/API platform/Build Tools, adb/emulator 및 전용 Pleos image, 확정된 SDK/Service 버전과 접근·권한 조건, 실제 WebView/기기와 테스트 차량입니다. P1-A에서 APK 및 Mock UI를 검증한 뒤 P1-B에서 읽기 전용 SDK 어댑터를 구현하는 순서를 권장합니다. SDK 설치와 실차 연동, Anatomy 전체 통합은 이번 P0 완료 범위가 아닙니다.

## P1-A — Android 환경 및 Mock 앱 실행 (2026-10-30)

### 결과 요약

사용자가 이 대화에서 Android Studio·SDK 도구·Android Emulator·Pleos 시스템 이미지 및 AVD의 **전체 설치를 승인**한 뒤 진행했습니다. Windows 기능 변경/재부팅은 승인 범위에서 제외했고 실제로 수행하지 않았습니다. 프로젝트의 JDK 17 / Gradle 8.14 / AGP 8.10.0 / KGP 2.2.0 및 app/vehicle-core 구조를 유지했습니다. Pleos Vehicle SDK를 추가하거나 차량 기능을 개발하지 않았습니다.

| 항목 | 상태 | 실행 결과 / 제한 |
| --- | --- | --- |
| 기존 파일/Git 보존 | PASS | 시작 시 프로젝트 파일 26개 inventory/hash 기록. 삭제·초기화·stage·commit·push·PR 없음 |
| Android Studio 설치 | PASS | 공식 ZIP SHA-256 일치, Rabbit 2 2026.2.2.8, launcher/runtime 및 시작 메뉴 바로가기 확인 |
| Studio GUI 실행/프로젝트 import | NOT_RUN | 낮은 여유 RAM으로 IDE를 동시에 실행하지 않음. Gradle JDK 17 확인 필요 |
| Android SDK 설치 | PASS | CLI 22.0, Platform 34 rev3, Build Tools 35.0.0, Platform Tools 37.0.1, Emulator 37.2.13 |
| CPU VM acceleration | PASS | 실제 `-accel-check`: WHPX 10.0.26100 installed and usable, exit 0 |
| GPU 하드웨어 성능 기준 | FAIL | GT 710 / 보고 VRAM 1GiB, 공식 최소 사양 미달. 실행은 auto → SwiftShader 소프트웨어 렌더링 |
| RAM의 Studio+Emulator 최소 기준 | FAIL | 총 7.95GiB, 초기 여유 0.91GiB. 공식 기준과 실행 성능을 구분 |
| 디스크 | PASS | 초기 C: 약 198.7GiB, 설치/검증 후 약 152.1GiB 여유 |
| core Kotlin/JUnit | PASS | SDK 연결 전후 각각 17개 실제 재실행, 실패/오류/skip 0 |
| Android 컴파일/Manifest/resources/D8 | PASS | `:app:assembleDebug` 성공. 코드/리소스/Manifest 오류 없음 |
| APK 생성·서명·설치 | PASS | debug APK 생성, v2 서명 검증 및 Pleos AVD `adb install -r` Success |
| Pleos AVD 부팅 | PASS | API 34 / Android 14 / x86_64, sys.boot_completed=1, Automotive feature 확인 |
| 일반 Android/AAOS AVD | NOT_RUN | Pleos AVD에서 직접 검증. 일반 emulator 결과로 혼합하지 않음 |
| 앱 화면/MOCK 출처 | PASS | 실제 화면 및 UI hierarchy에서 MOCK/미연결 안내 확인 |
| ALL_CLOSED | PASS | 버튼 조작 후 텍스트 CLOSED 4개, SVG 녹색 4개 확인 |
| FRONT_LEFT_OPEN | PASS | 네이티브 요약 OPEN/CLOSED 및 WebView DOM·실제 WebView 캡처에서 앞 왼쪽만 OPEN 확인. 동일 프레임의 전체 화면 일치/즉시 반응은 보장하지 않음 |
| UNAVAILABLE | PASS | 텍스트/회색 SVG 4개 확인. 이전 OPEN/CLOSED를 표시하지 않음 |
| STALE | PASS | 버튼 후 8초 대기 캡처에서 텍스트/황색 SVG 모두 STALE 확인 |
| SVG 표시/잘림 수정 | PASS | 수정 전 잘림 재현, 수정 후 차량 외형과 네 도어 전체 표시 |
| 실제 앱 창 크기 대응 | PASS | native WebView 폭 1634 → 994px에서 도식 전체 표시, 원래 창으로 복원 |
| 물리 해상도 강제 변경 | FAIL | 1600×900 변경 시 Pleos 런처의 고정 앱 영역이 화면 밖으로 나가 잘림. `wm size reset`으로 복원. 임의 해상도 지원 완료로 보고하지 않음 |
| Home/복귀 | PASS | Home 후 재실행 Status ok, 동일 앱 PID, 화면 복귀 확인 |
| Activity 구성 변경/시나리오 복원 | PASS | resize 전후 DecorView/WebView 인스턴스 변경과 UNAVAILABLE 유지 확인 |
| process death 복원/메모리 누수 정밀 검사 | NOT_RUN | 일반 복귀/구성 재생성과 구분 |
| cold launch 및 화면 갱신 응답성 | FAIL | 시작 명령 timeout, 초기 화면 지연 및 텍스트/SVG 갱신 시차 관찰. 기능 확인과 성능 완료를 구분 |
| CarScope crash/ANR 관찰 | PASS | 수집한 앱 PID 로그/exit-info에서 앱 FATAL/ANR 없음. package update에 따른 종료만 확인 |
| Pleos 기본 시스템 앱 안정성 | FAIL | 별도 profile native process SIGABRT 및 ai.umos.inputmethod 예외가 crash buffer에 존재. CarScope 오류로 합치지 않음; 원인 미확정 |
| JavaScript/외부 자원 설정 검토 | PASS | JS=false, network/file/content 차단, script·외부 자원 없는 실제 DOM과 SVG 표시 확인 |
| 네트워크 차단/없는 WebView provider 오류 주입 | NOT_RUN | 설정 검토와 구분. provider를 제거/비활성화하지 않음 |
| Pleos Vehicle SDK 연결·실차 | NOT_RUN | 의존성/어댑터/차량 API 호출 없음 |

17개는 JVM JUnit 테스트입니다. UI 검증은 adb 조작·실제 화면·UI hierarchy·WebView DOM을 이용한 smoke 검증이며, Android instrumentation test suite를 실행했다고 주장하지 않습니다.

### 설치 및 환경 증거

세부 초기 진단, 승인 범위, 설치 위치와 재실행 방법은 [P1-A 환경 문서](p1-a-environment.md)에 기록했습니다. Windows 11 Pro build 26100, i5-9400F 6코어, 약 8GB RAM, GT 710 1GB 환경입니다. [Android 공식 요구사항](https://developer.android.com/studio/install#system-requirements-windows)과 [Pleos GPU 기준](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator)에 비해 부족한 사양임을 확인하고 사용자에게 알린 뒤 전체 설치 승인을 받았습니다.

공식 Android Studio ZIP의 SHA-256은 `a05e6742d5fd92a090ee6697c3f75706db735decf5a8543f3bbaf2514c0fd123`, CLI ZIP은 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`와 일치했습니다. Pleos ZIP은 공식 repository의 크기 4,087,751,964 bytes / SHA-1 `b4f858d5bcc6c71506d7edfc872bcb9e5a11acaa`와 대조했고, 별도로 SHA-256 `75a00230648d37c65a0233f5e17024bd61f45aa5a79f9a7dfbe3de9b8f69edbb`을 기록했습니다. system.img 등 이미지 바이너리는 변경하지 않았습니다.

공식 repository는 image package revision 2, 압축 내부 source.properties는 revision 1 / generic android-automotive로 달랐습니다. 자동 생성 package.xml의 경로 불일치와 한 차례 schema 적용 실패를 확인한 뒤, SDK 도구가 생성한 현재 local schema를 유지하면서 공식 path/revision/display/tag/vendor/license를 반영했습니다. 최종 `sdkmanager --list_installed`는 `system-images;android-34;pleos_car_emulator;x86_64` revision 2를 경고 없이 인식했고, 해당 패키지와 공식 `Pleos_Connect_v2_0` device profile로 AVD를 생성했습니다. image 표시 이름은 Pleos Connect v2.1.0입니다. 이 metadata 차이는 **Vehicle SDK 2.3.1/2.3.2 문제와 별개**입니다.

`CarScope_Pleos_API34`를 RAM 4096MB, 2 cores, Cold boot/no snapshot, GPU auto로 실행했습니다. 실제 그래픽 출력은 Google SwiftShader / OpenGL ES 3.0, CPU 가속은 WHPX였습니다. 앱은 user 10에서 실행됐고, 제공 WebView는 `ai.pleos.android.webview 131.0.6752.0`입니다. 검증은 `-no-window` headless AVD의 실제 Android framebuffer/실제 WebView 캡처로 수행했습니다. 정적 웹 브라우저 목업이 아닙니다. 수집 후 AVD를 종료하고 임시 adb DevTools forwarding을 제거했습니다.

SDK 경로는 Git 제외 local.properties에만, 기존 JDK 17 경로는 Git 제외 .gradle/config.properties에만 기록했습니다. Studio의 bundled runtime 25를 프로젝트 Gradle runtime으로 채택하거나 wrapper를 업그레이드하지 않았습니다. IDE 첫 프로젝트 import의 Gradle JVM 선택은 미검증입니다.

### APK 및 실제 명령

최종 APK: `app/build/outputs/apk/debug/app-debug.apk`, **2,493,201 bytes**.

```text
SHA-256 E9DF5DC1CBF93BD1751283BCDB9E6E8A28B34320B19FDCB23A7EED9F51BFB541
applicationId io.carscope.app
versionCode 1 / versionName 0.1.0-p0
minSdk 28 / targetSdk 34 / compileSdk 34
```

| 실제 실행 | 결과 |
| --- | --- |
| `.\gradlew.bat --version` | exit 0, Gradle 8.14 / JDK 17.0.17 |
| `.\gradlew.bat :vehicle-core:test --offline --rerun-tasks --console=plain` | 설치 전후 exit 0, 각각 17 tests / 0 failures / 0 errors / 0 skipped |
| `.\gradlew.bat :app:assembleDebug --offline --console=plain` (설치 전) | exit 1, SDK location not found — SDK 설정 차단 |
| `sdkmanager.bat --sdk_root=<승인한 SDK 경로> --channel=0 platforms;android-34 build-tools;35.0.0 platform-tools emulator` | exit 0, 요청한 구성요소 설치. 기존 JDK 17 사용 |
| `emulator.exe -version`; `emulator.exe -accel-check` | 37.2.13.0, WHPX usable exit 0 |
| `sdkmanager.bat --sdk_root=<SDK> --list_installed` | Platform/Build Tools/adb/Emulator/Pleos 패키지 인식 |
| `avdmanager.bat create avd --name CarScope_Pleos_API34 --package system-images;android-34;pleos_car_emulator;x86_64 --device Pleos_Connect_v2_0` | 최종 exit 0. 경로 불일치 시도 실패는 로컬 원본 로그에 보존 |
| `.\gradlew.bat :app:assembleDebug --console=plain -Dorg.gradle.internal.http.connectionTimeout=10000 -Dorg.gradle.internal.http.socketTimeout=10000` | 최초 APK 성공, 1m25s. SDK XML schema 경고는 있었으나 빌드 차단 아님 |
| `.\gradlew.bat :app:assembleDebug --offline --console=plain --max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" -Pkotlin.compiler.execution.strategy=in-process` | SVG 수정 후 exit 0, 약 1분. 메모리 옵션은 이 명령에만 적용 |
| `apksigner.bat verify --verbose <APK>`; `aapt2.exe dump badging <APK>` | v2 signature 검증, Automotive feature/Activity/SDK/package 확인 |
| `emulator.exe -avd CarScope_Pleos_API34 -port 5554 -no-window -no-snapshot -no-boot-anim -no-audio -memory 4096 -cores 2 -gpu auto` | 부팅 후 sys.boot_completed=1 |
| `adb -s emulator-5554 install -r <APK>` | 최초/수정 APK 모두 Success |
| `adb -s emulator-5554 shell am start -W -n io.carscope.app/.MainActivity` | cold 시 timeout, warm 재요청 Status ok |
| `adb -s emulator-5554 shell am start -W --display 0 --windowingMode 1 -n io.carscope.app/.MainActivity` | Status ok, 실제 화면으로 가져오기 확인. 최종 배치는 Pleos multi-window |
| `adb shell input tap 1700 <640/688/736>` 및 `screencap -p`, `adb pull` | 세 시나리오 조작·캡처. 실제 UI bounds를 확인한 좌표 사용 |
| `adb shell input tap 1700 640; sleep 8; screencap -p <경로>` | STALE 텍스트/SVG 확인 |
| `adb shell input keyevent KEYCODE_HOME` 후 start | 동일 PID로 복귀, Status ok |
| `adb shell wm size 1600x900` → `wm size reset` | OEM fixed bounds 잘림 재현 및 물리 크기 복원 |
| `adb shell am task resize 1000009 853 90 1895 1200` → 원래 853 90 2535 1300 복원 | 실제 native window width 1042, WebView 994에서 표시 확인 |
| `adb shell dumpsys activity io.carscope.app`; `uiautomator dump` | DecorView/WebView 교체와 UNAVAILABLE 복원 증거 |
| `adb logcat -d --pid=<앱 PID>`; `logcat -b crash -d`; `dumpsys activity exit-info io.carscope.app` | 앱 로그와 시스템 프로세스 오류 분리 |
| `adb forward tcp:9223 localabstract:webview_devtools_remote_<PID>` | debug APK의 기존 WebView inspector로 DOM/실제 WebView 캡처. DOMSnapshot/Page만 사용, JS 평가/활성화 없음 |
| `node .tools/p1-a/20261030T074954Z/capture-open.mjs` | OPEN/CLOSED/CLOSED/CLOSED DOM 확인 및 실제 WebView PNG 생성, exit 0 |
| `adb forward --remove tcp:9223`; `adb -s emulator-5554 emu kill` | forwarding 제거, 작업 AVD 종료 |

패키지 인자는 실제 PowerShell 실행에서 각각 따옴표로 전달했습니다. 위 표의 `<SDK>`, `<APK>`, `<경로>`, `<PID>`는 읽기 쉬운 표기를 위한 자리표시자이며 실제 값은 로컬 로그에 있습니다. raw evidence는 `.tools/p1-a/20261030T074954Z/`, 선별한 재검토 증거는 [evidence 디렉터리](evidence/p1-a/2026-10-30/)입니다.

### 수정한 SVG 표시 결함

P0 HTML은 SVG의 폭을 따르는 intrinsic height가 고정 240dp WebView보다 커져 차량 상단만 보였습니다. WebView 제공자가 HTML 로드 완료를 보고해도 전체 그림 표시가 성공한 것은 아니었습니다.

MainActivity의 메모리 HTML에 `html,body`의 viewport 크기와 SVG의 `display:block; inline-size:100%; block-size:100%`를 지정했습니다. 기존 viewBox의 기본 aspect-ratio 보존에 따라 도식 전체가 WebView 안에 들어갑니다. core renderer, 차량 모델, 시나리오, 권한, JavaScript 비활성화, CSP 및 외부 접근 차단은 유지했습니다. 이 수정은 실제 재현한 레이아웃 오류만 해결합니다.

폭 1634px 및 994px의 native WebView에서 전체 도식을 확인했습니다. 반면 물리 디스플레이를 임의로 축소하면 Pleos 런처가 기존 앱 bounds를 유지하여 화면 밖으로 나가는 별도 문제가 있습니다. 이것을 CSS 수정으로 해결했다고 보고하지 않습니다.

### 화면 및 테스트 증거

| 증거 | 확인 내용 |
| --- | --- |
| 수정 전 (`evidence/p1-a/2026-10-30/before-svg-fit.png`, 로컬 전용) | 차량 상단만 보이는 실제 잘림 |
| CLOSED (`evidence/p1-a/2026-10-30/closed.png`, 로컬 전용) | 네이티브 요약 CLOSED 및 녹색 SVG 4개 |
| 앞 왼쪽 OPEN — 실제 WebView viewport (`evidence/p1-a/2026-10-30/front-left-open-webview.png`, 로컬 전용) | 앞 왼쪽만 적색 OPEN, 나머지 녹색 CLOSED. 같은 AVD WebView의 Page 캡처 |
| UNAVAILABLE (`evidence/p1-a/2026-10-30/unavailable.png`, 로컬 전용) | 네이티브 요약 및 회색 SVG |
| STALE (`evidence/p1-a/2026-10-30/stale.png`, 로컬 전용) | 8초 대기 후 황색 STALE |
| 좁은 앱 창 (`evidence/p1-a/2026-10-30/resized-window.png`, 로컬 전용) | WebView 폭 994px, 외형/상태 전체 표시 및 시나리오 복원 |
| Home 복귀 (`evidence/p1-a/2026-10-30/home-resume.png`, 로컬 전용) | 원래 앱 화면으로 복귀 |
| 물리 해상도 변경 제한 (`evidence/p1-a/2026-10-30/physical-resize-oem-limit.png`, 로컬 전용) | OEM bounds가 남아 발생한 잘림, 이후 reset |
| JUnit XML (`evidence/p1-a/2026-10-30/vehicle-core-tests-with-sdk.xml`, 로컬 전용) | tests=17, failures=0, errors=0, skipped=0 |
| 최종 빌드 로그 (`evidence/p1-a/2026-10-30/assemble-debug-svg-fix.log`, 로컬 전용) | 수정한 APK의 실제 BUILD SUCCESSFUL |
| 환경/APK 정보 (`evidence/p1-a/2026-10-30/environment-and-apk.json`, 로컬 전용) | 버전·크기·최종 hash |

전체 화면의 좌측 3D 차량은 Pleos 기본 런처 콘텐츠입니다. CarScope는 우측의 2D Mock 도식이며 Anatomy나 신규 3D 차량 기능을 구현하지 않았습니다.

### 남은 오류, 제한 및 P1-B 판단

이 PC는 정상 성능 기준을 충족하지 못합니다. cold `am start -W`는 WaitTime 11,160ms / 23,088ms의 timeout을 반환했고 이후 화면이 표시됐습니다. warm 재요청과 명시적 windowing-mode 요청으로 화면을 확인했습니다. SDK/Pleos 기본 앱들이 시작된 환경에서 발생한 지연이며 정확한 원인을 앱·GPU·메모리 중 하나로 단정하지 않습니다.

텍스트 상태는 먼저 바뀌고 WebView 그림이 뒤늦게 갱신되는 시차도 관찰했습니다. OPEN 확인 중 실제 DOM은 탭 명령 시작 후 약 4,600ms에 OPEN/CLOSED/CLOSED/CLOSED가 됐습니다. 해당 WebView의 실제 픽셀을 별도로 캡처했습니다. 일부 전체 화면 캡처는 이미 5초 stale 기준을 지나 STALE로 돌아갔으므로 OPEN 성공 증거로 사용하지 않았습니다. 5초 정책을 테스트를 위해 늘리거나 JavaScript로 우회하지 않았습니다.

앱 로그에는 EGL ES 3.1/3.2 context 오류, 프레임 skip, destroyed WebView 관련 Chromium 경고가 있습니다. 현재 캡처 범위에서 CarScope의 FATAL/ANR은 발견하지 않았고, exit-info의 앱 종료 원인은 재설치(PACKAGE UPDATED)였습니다. 이미지의 별도 profile 프로세스 SIGABRT와 입력기 예외는 존재하므로 시스템 전체가 오류 없이 안정적이라고 보고하지 않습니다. provider 부재/네트워크 차단 오류 주입, process-death 복원, 장시간 반복·메모리 profiling, 실차/다른 기기 검증은 NOT_RUN입니다.

**P1-B의 문서/API 대조 및 읽기 전용 어댑터 설계에 조건부 진입 가능**합니다. 빌드·설치·Mock의 기본 실행 기반을 실제로 확보했습니다. 다만 현재 PC의 cold launch/표시 시차와 Pleos 시스템 프로세스 안정성은 남은 제한이며, 신뢰할 수 있는 SDK 연결·수신 지연 검증은 지원 사양 환경에서 재검증해야 합니다. Vehicle SDK 2.3.1/2.3.2와 대상 Vehicle Service 버전 확정, 아티팩트·권한·capability 검증도 여전히 필요합니다. 이번 단계에서 SDK 실제 연동은 수행하지 않았습니다.
