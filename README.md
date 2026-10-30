# CarScope

차량 상태를 `VehicleDataSource → VehicleSnapshot → VehicleDiagram → SVG → Android WebView`로 표시합니다. Mock과 앱 모듈의 Pleos SDK 2.3.2 읽기 전용 어댑터를 분리했습니다. PLEOS는 ROW_1_LEFT 한 도어만 대상으로 하며 실패 시 Mock으로 자동 대체하지 않습니다. 실제 서비스·이벤트·SVG 판정은 [P1-B 연동 기록](docs/pleos-sdk-integration.md)을 확인하세요.

P1-B는 **BLOCKED / 미완료**입니다. 최종 core 17개 + app 합성 19개 재실행, SDK 포함 APK 빌드·설치는 PASS입니다. 실제 AVD Service 2.3.22는 확인했지만 OEM/framework ANR·VHAL/system 사망으로 SDK 초기화와 도어 이벤트→SVG를 검증하지 못했습니다. P2 진입은 보류합니다.

연구실/집 PC 설정과 clone·테스트·빌드·브랜치 운영은 [개발 환경 가이드](docs/development-setup.md)를 따릅니다. 원본 로그·스크린샷·SDK·AVD·APK·개인 설정은 Git에 포함하지 않습니다. [G0 업로드 점검](docs/github-bootstrap.md)과 [현재 검증 상태](docs/validation-report.md)를 확인하세요.

| 검증 범위 | 현재 상태 |
| --- | --- |
| P0 JVM / P1-A APK·Mock UI | PASS (당시 실행 범위) |
| P1-B JVM / APK build·install | 36 PASS / PASS |
| SDK initialization / Door capability / Door state | BLOCKED / BLOCKED / BLOCKED |
| Door event / 실제 SDK SVG | NOT_RUN / BLOCKED |
| OEM/framework ANR | 발생, CarScope FATAL/ANR은 수집 범위에서 미발견 |

## JVM CI

[JVM CI 실행 상태](https://github.com/ppsssj/CarScope/actions/workflows/jvm-ci.yml)는 `main` 대상 PR, `main` push, 수동 실행에서 Ubuntu/JDK 17과 Gradle Wrapper 8.14로 아래 core 테스트 17개를 실행합니다. 이 workflow를 추가하는 PR의 실제 실행 결과를 확인해야 하며, 배지가 없거나 대기 중인 상태를 PASS로 해석하지 않습니다. 수동 실행은 workflow가 기본 브랜치에 반영된 뒤 사용할 수 있습니다.

```sh
./gradlew -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

단일 job/Gradle worker 최대 1개, 15분 제한, 이전 동일 ref 실행 취소를 적용합니다. 공식 action은 commit SHA로 고정하며 권한은 `contents: read`, 추가 사용자 Secrets는 없습니다. Android SDK 경로 환경변수를 비우고 SDK/Pleos SDK/AVD 설치나 emulator 실행을 하지 않습니다. 의존성은 처음에 공식 Gradle 배포 서버·Google Maven·Maven Central 등의 네트워크 접근이 필요합니다. 다운로드/DNS/TLS/HTTP 실패는 테스트 assertion 실패와 구분해 Actions 로그에서 확인합니다.

**CI PASS의 범위는 순수 JVM 테스트와 Kotlin 로직뿐입니다.** app 합성 테스트 19개·Android APK·Pleos SDK 초기화·Vehicle Service 연결·실제 Door Event·SVG 실시간 갱신은 이 CI의 검증 대상이 아닙니다. **P1-B는 BLOCKED로 유지**합니다. GitHub hosted 이미지에 Android 도구가 미리 존재할 수 있어도 이 job은 이를 요구하거나 사용하지 않습니다.

2026-10-30 P1-A 검증: core JUnit **17개 PASS**, Android debug APK 생성·서명 검증 PASS, Pleos API 34 AVD 설치·부팅 및 Mock UI/SVG 표시 확인. 실제 화면에서 발견한 SVG 잘림을 수정했습니다. 현재 PC의 메모리/GPU 제약으로 cold launch timeout과 SVG 갱신 지연이 있어 성능 검증은 통과하지 못했습니다. 자세한 명령·증거·미검증 범위는 [검증 보고서](docs/validation-report.md#p1-a--android-환경-및-mock-앱-실행-2026-10-30)를 참조하세요.

## 프로젝트 구조

```text
CarScope/
├── app/                           # AAOS Activity, Mock/Pleos 선택, SDK 어댑터, WebView
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/io/carscope/app/MainActivity.kt
│       ├── java/io/carscope/app/pleos/{PleosVehicleDataSource,SdkDoorSession}.kt
│       └── res/values/strings.xml
├── vehicle-core/                  # Android/SDK 의존성 없는 Kotlin JVM
│   ├── build.gradle.kts
│   └── src/
│       ├── main/kotlin/io/carscope/
│       │   ├── vehicle/{VehicleDataSource,MockVehicleDataSource}.kt
│       │   └── visualization/{VehicleDiagram,VehicleSvgRenderer}.kt
│       └── test/kotlin/io/carscope/vehicle/
│           ├── VehiclePipelineTest.kt
│           └── VehicleSvgSamples.kt
├── scripts/validate-core.ps1       # 로컬 Gradle 배포본을 이용한 오프라인 대체 검증
├── docs/{architecture,feasibility,roadmap,validation-report}.md
├── docs/p1-a-environment.md         # 설치 범위·환경 진단·재실행 방법
├── docs/development-setup.md        # Windows/두 PC 설정 및 브랜치 운영
├── docs/evidence/                   # 공유 인덱스만 Git 포함, 원본 자료는 로컬 전용
├── gradle/wrapper/                 # Gradle 8.14, 공식 배포본 checksum 고정
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── gradlew / gradlew.bat
├── .gitattributes / .gitignore
└── .tools/                        # Git 제외: 기존 bootstrap, 복구 사본, 원본 실행 로그
```

## core 검증

필수: JDK 17. Gradle Wrapper는 Gradle 8.14를 사용합니다. 첫 실행은 배포본과 Maven 의존성 네트워크 접근이 필요할 수 있습니다. `coreOnly=true`를 주면 Android 모듈을 포함하지 않으므로 Android SDK 없이 검증할 수 있습니다. 루트의 공통 plugin classpath에는 AGP도 있으므로 처음에는 AGP/KGP 아티팩트 다운로드가 필요할 수 있습니다. 이는 Android SDK 설치와 별개입니다.

```powershell
.\gradlew.bat -PcoreOnly=true :vehicle-core:check :vehicle-core:exportSvgSamples --console=plain
```

캐시 준비 후에는 같은 명령에 `--offline`을 추가할 수 있습니다. 테스트 보고서는 `vehicle-core/build/reports/tests/test/index.html`, SVG 예제 4개는 `vehicle-core/build/validation/svg/`에 생성됩니다. SVG export 성공은 화면 렌더링 성공을 뜻하지 않습니다.

Wrapper 다운로드가 불가능하면 이미 설치된 로컬 Gradle을 현재 셸 변수로만 선택할 수 있습니다.

```powershell
$gradleUserDir = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $env:USERPROFILE '.gradle' }
$localGradle = Get-ChildItem (Join-Path $gradleUserDir 'wrapper/dists/gradle-8.14-bin') -Recurse -Filter gradle.bat |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $localGradle) { throw '로컬 Gradle 8.14를 찾지 못했습니다.' }
& $localGradle -PcoreOnly=true :vehicle-core:check :vehicle-core:exportSvgSamples --offline --console=plain
```

Kotlin Gradle Plugin 의존성까지 사용할 수 없으면 아래 대체 경로가 있습니다. 다운로드·SDK 설치 없이 로컬 Gradle 8.14에 포함된 **Kotlin 2.0.21**, JUnit 4.13.2, Hamcrest 1.3으로 main/test를 별도 컴파일하고 같은 테스트를 실행합니다. 프로젝트의 KGP 2.2.0 검증과 구분해야 합니다.

```powershell
.\scripts\validate-core.ps1
# 다른 로컬 위치를 현재 실행에만 지정할 때:
# .\scripts\validate-core.ps1 -GradleHome '<로컬 Gradle 8.14 디렉터리>'
```

각 실행의 로그/JAR/SVG는 `vehicle-core/build/standalone/<run-id>/`에 보존됩니다. 스크립트는 기존 실행 결과를 삭제하지 않습니다.

## Android 상태

설정 기준선은 Gradle 8.14 / AGP 8.10.0 / Kotlin 2.2.0 / JDK 17, minSdk 28 / compileSdk·targetSdk 34입니다. 앱은 Automotive 기능을 필수로 선언하며 `:vehicle-core`와 공식 `ai.pleos.playground:Vehicle:2.3.2`에 의존합니다. core에는 Android/SDK 의존성이 없습니다.

P1-A에서 사용자의 전체 설치 승인 후 Android Studio, SDK Platform 34, Build Tools 35.0.0, Platform Tools, Emulator 및 Pleos API 34 이미지를 설치했습니다. 기존 JDK 17을 재사용하며 SDK 경로는 Git 제외 `local.properties`, 로컬 JDK는 Git 제외 `.gradle/config.properties`에만 기록했습니다. P1-B에서 앱에만 Vehicle SDK를 추가했습니다.

```powershell
.\gradlew.bat :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :app:testDebugUnitTest --console=plain
.\gradlew.bat :app:assembleDebug --console=plain
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. P1-A의 APK 크기/hash는 과거 검증 보고서, P1-B 빌드 hash는 연동 기록에 있습니다. 테스트 AVD는 `CarScope_Pleos_API34`입니다. Android Studio는 시작 메뉴 `Android Studio (CarScope)`로 열 수 있습니다. IDE 자체 실행/프로젝트 import는 미검증이고, Gradle JDK는 기존 17 또는 `GRADLE_LOCAL_JAVA_HOME`으로 선택해야 합니다. 설치 경로·재실행 명령은 [P1-A 환경 문서](docs/p1-a-environment.md#설치-후-상태와-재실행)에 있습니다.

MOCK 시나리오 버튼은 새 관측값을 만듭니다. 저장된 관측값의 나이를 재평가하여 5초 초과 시 STALE로 바꾸며 Pleos AVD에서 이 동작을 확인했습니다. 현재 호스트에서는 텍스트와 WebView 그림 갱신 사이에 지연이 관찰됩니다. 주차 상태 개발 검증용이며 주행 허용·배포 승인·차량 상태의 정확성을 보장하지 않습니다.

## 후속 문서

- [아키텍처 및 데이터 계약](docs/architecture.md)
- [P1-B SDK 구현·실행 결과](docs/pleos-sdk-integration.md)
- [공식 문서 근거와 실현 가능성](docs/feasibility.md)
- [P1 진입 조건 및 로드맵](docs/roadmap.md)
- [P0 검증 결과, 복구 내역, 실행 명령](docs/validation-report.md)
