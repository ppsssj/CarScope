# P1-A Android 환경 준비 및 실행 검증 계획

진단일: 2026-10-30 (Asia/Seoul). 설치 승인을 받기 전 진단 결과입니다. app/vehicle-core 구조와 의존성 버전을 유지합니다. Pleos SDK 연동·신규 차량 기능·Anatomy는 범위 밖입니다.

이후 사용자가 **전체 설치를 승인**하여 설치·빌드·Pleos AVD Mock 검증을 수행했습니다. 아래 초기 진단/설치 계획을 보존하고, [설치 후 상태](#설치-후-상태와-재실행)와 [최신 검증 보고서](validation-report.md#p1-a--android-환경-및-mock-앱-실행-2026-10-30)에 실제 결과를 구분했습니다.

## 확인한 환경

| 항목 | 결과 | 상태 |
| --- | --- | --- |
| Windows | Windows 11 Pro x64, build 26100 | PASS |
| JDK | Temurin 17.0.17, 기존 설치 재사용 | PASS |
| Gradle | 기존 Wrapper/배포본 8.14 실행 | PASS |
| AGP / KGP | 기존 설정 8.10.0 / 2.2.0 유지 | PASS |
| Android Studio | PATH·표준 설치 경로·등록 정보·설정/실행 흔적에서 미발견 | BLOCKED |
| Android SDK / Platform 34 / Build Tools | SDK 경로·환경변수·local.properties 미발견 | BLOCKED |
| Platform Tools / adb / Emulator | 실행 파일 및 AVD 미발견 | BLOCKED |
| CPU | Intel Core i5-9400F, 6 cores/6 threads | PASS (장치 식별만) |
| RAM | 약 7.95GiB, 조사 시 여유 약 0.91GiB | FAIL (Studio+Emulator 공식 최소 사양 비교) |
| GPU | NVIDIA GeForce GT 710, WMI 보고 VRAM 1GiB | FAIL (공식 Emulator/Pleos GPU 최소 사양 비교) |
| 디스크 | C: 약 198.7GiB 여유 | PASS (조사 시점) |
| Windows 가상화 | HypervisorPresent=true, Hyper-V/VirtualMachinePlatform 활성, HypervisorPlatform 비활성 | BLOCKED (WHPX 실행 검증 전) |

기본 설치 경로가 아닌 모든 디스크의 임의 경로까지 검색한 것은 아닙니다. 현재 빌드 도구가 사용할 수 있는 Android 환경은 발견되지 않았습니다. IntelliJ IDEA/Visual Studio/OBS Studio는 Android Studio 설치로 간주하지 않습니다.

CIM의 CPU virtualization 관련 값은 false였지만 hypervisor가 실행 중입니다. 이 값만으로 BIOS VT-x가 꺼졌다고 판단하지 않습니다. `Win32_OptionalFeature.InstallState`에서 HypervisorPlatform=2, VirtualMachinePlatform/Hyper-V=1을 확인했습니다. 관리자 권한이 필요한 `Get-WindowsOptionalFeature` 조회는 실패했고 설정을 바꾸지 않았습니다. Emulator가 없어 `emulator -accel-check`는 미실행입니다.

현재 [Android Studio Windows 요구사항](https://developer.android.com/studio/install#system-requirements-windows)은 Studio+Emulator에 RAM 16GB와 VRAM 4GB 수준의 GPU를 명시합니다. 이 PC는 해당 기준에 못 미칩니다. [Pleos Emulator 설정 문서](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator)는 최소 GPU로 RTX 3060 Laptop 6GB 또는 RX 6600M 8GB/RX 6700S 8GB 이상을 제시합니다. GT 710으로 Pleos 실행 가능성을 보장할 수 없습니다. APK 빌드와 emulator 실행의 가능성을 구분합니다.

## 승인 요청할 설치 범위

### A. SDK 도구만 준비하여 APK 빌드 우선 (권장)

- 공식 Android SDK Command-line Tools (JDK 17과 호환되는 배포본 확인).
- `platforms;android-34`.
- `build-tools;35.0.0` — [AGP 8.10 기본 Build Tools](https://developer.android.com/build/releases/agp-8-10-0-release-notes#compatibility)이며 compileSdk 34와 별개입니다.
- `platform-tools` — adb 포함.
- 사용자 로컬 SDK 디렉터리 사용. 현재 프로세스 환경변수 또는 Git 제외 local.properties로만 연결하고 저장소 공식 설정에 절대경로를 저장하지 않습니다.

이 범위는 APK 빌드를 먼저 검증합니다. Android Studio, Emulator, 시스템 이미지, AVD 및 Windows 기능 변경은 포함하지 않습니다. UI 실행 검증은 에뮬레이터 또는 허용된 기기 환경이 확보될 때 계속합니다.

공식 다운로드: [Android Studio / Command-line Tools](https://developer.android.com/studio). 패키지 관리 안내: [sdkmanager](https://developer.android.com/tools/sdkmanager). 아직 설치 파일을 다운로드하거나 설치하지 않았습니다.

### B. Android Studio + 전체 emulator 환경

A의 SDK 구성요소에 Android Studio, Android Emulator, 시스템 이미지 및 AVD 생성을 추가합니다. 사양 부족 상태의 현재 PC에서는 설치 후에도 부팅·SVG 화면 검증이 실패하거나 매우 느릴 수 있습니다. 일반 AAOS emulator와 Pleos emulator의 결과를 따로 기록합니다. Windows Hypervisor Platform 활성화 또는 재부팅은 추가 승인을 받기 전 수행하지 않습니다.

일반 emulator를 먼저 사용할 경우 Automotive system image/AVD를 선택합니다. 앱이 Automotive 기능을 필수 선언하므로 일반 전화기 AVD 설치/실행 결과를 AAOS 호환 검증으로 보고하지 않습니다.

### Pleos 전용 환경의 확인된 설정

사용자가 지정한 [공식 설치 가이드](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)를 기준으로 준비합니다.

1. Android Studio SDK Manager → SDK Update Sites에 `Pleos Connect System Image`를 추가합니다.
2. Windows/Linux repository URL은 아래와 같습니다.

```text
https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml
```

3. SDK Platforms → API 34 → Show Package Details에서 Pleos 이미지를 선택합니다.
4. Device Manager → Automotive → Pleos Connect v2.1.0, x86_64/API 34로 AVD를 만듭니다.
5. 공식 가이드대로 Cold boot와 RAM 4GB를 적용합니다. 이 PC의 여유 RAM 부족은 별도 차단 요소입니다. GPU 조건은 위 문서를 따릅니다.

repository metadata만 GET으로 확인했습니다(HTTP 200). 확인한 package는 `system-images;android-34;pleos_car_emulator;x86_64`, 표시 이름은 Pleos Connect v2.1.0 APIs Intel x86_64 Atom System Image, package revision은 2입니다. emulator 런타임 바이너리 버전과 image revision은 별개입니다.

공식 metadata의 압축 파일 크기는 **4,087,751,964 bytes (약 4.09GB / 3.81GiB)**입니다. 압축 해제 공간, AVD userdata 및 snapshot은 추가 공간이 필요합니다. ZIP은 다운로드하지 않았고 이미지 checksum·부팅·Virtual Console은 검증하지 않았습니다.

## 승인 후 실행 순서

1. 승인된 구성요소만 설치하고 실제 package revision, SDK 위치와 라이선스 처리 결과를 기록합니다. 기존 JDK/Gradle/AGP/KGP를 유지합니다.
2. `adb version`, `emulator -version`, `emulator -accel-check`, AVD 목록을 조사합니다. WHPX 활성화가 필요하면 변경/재부팅 승인을 따로 요청합니다.
3. 아래 빌드를 실행하고 실패 지점을 SDK/의존성/네트워크/Kotlin/Manifest/resource로 분류합니다.

```powershell
.\gradlew.bat :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :app:assembleDebug --console=plain
```

4. APK가 생성되면 경로·SHA-256·package 정보를 보존합니다. 예상 경로는 `app/build/outputs/apk/debug/app-debug.apk`이며 현재 파일은 없습니다.
5. 실행 가능한 AVD에 설치하여 아래 체크리스트를 수행하고 screenshot/logcat을 수집합니다.

## Mock UI 검증 체크리스트

각 항목은 실제 조작 후에만 PASS로 판정합니다. 아래는 계획 체크리스트이며, 실행 결과와 제한은 validation-report의 P1-A 표에 기록합니다.

| 검증 | 방법/기대값 |
| --- | --- |
| 시작 화면 | `io.carscope.app/.MainActivity` 실행, 크래시 없이 첫 화면 표시 |
| 출처 | 큰 MOCK 안내·실제 차량 미연결 안내·출처 텍스트 확인 |
| ALL_CLOSED | 버튼 후 4개 door CLOSED 및 해당 SVG 확인 |
| FRONT_LEFT_OPEN | 앞 왼쪽만 OPEN, 나머지 CLOSED |
| UNAVAILABLE | 이전 CLOSED/OPEN을 가져오지 않고 모두 UNAVAILABLE |
| STALE | 유효한 시나리오 선택 후 5초 초과 대기, 다음 화면 재평가에서 STALE, 버튼으로 갱신 |
| SVG | 외형/4개 door·상태별 색과 텍스트, 정상 viewBox 및 clipping 없음 |
| 화면 크기 | AVD 화면/회전 조건별 clipping·가독성·scroll 확인, 실제 크기 기록 |
| lifecycle | Home/복귀, Activity 재생성/시나리오 복원, Handler와 WebView cleanup 확인 |
| WebView | provider/version, 로드 오류·fallback 및 JS 비활성·외부 리소스 미사용 확인 |
| 오류 증거 | 앱 PID의 Logcat 및 AndroidRuntime/WebView 오류 요약, screenshot 수집 |

앱은 Mock source만 사용하므로 Pleos AVD에서 실행해도 실제 SDK 연동 PASS가 아닙니다. 일반 AAOS 결과와 Pleos 전용 결과를 별도로 남깁니다. P1-B 진입은 APK 및 Mock UI 실행 검증이 완료된 뒤 판단합니다.

## 설치 후 상태와 재실행

전체 설치 승인을 받은 뒤 다음을 설치했습니다. JDK/Gradle/AGP/KGP 버전은 변경하지 않았습니다.

| 도구 | 설치 확인 |
| --- | --- |
| Android Studio | Rabbit 2, 2026.2.2.8 ZIP; 공식 SHA-256 일치; launcher 및 bundled runtime 확인 |
| Command-line Tools | 22.0, JDK 17에서 실행 확인 |
| Platform 34 | revision 3 |
| Build Tools | 35.0.0 |
| Platform Tools | 37.0.1 (adb 1.0.41) |
| Android Emulator | stable 37.2.13.0, build 16740729 |
| Pleos image | v2.1.0 / API 34 / x86_64; repository revision 2 |
| AVD | CarScope_Pleos_API34, Cold boot, RAM 4096MB, 2 cores, GPU auto → SwiftShader |
| WebView | ai.pleos.android.webview 131.0.6752.0 |

Windows optional feature 정보와 달리 실제 `emulator -accel-check`는 **WHPX installed and usable / exit 0**으로 성공했습니다. Windows 기능 활성화, BIOS 변경, 재부팅은 하지 않았습니다. 검사 후 현재 AVD는 종료했습니다.

Android Studio는 사용자 로컬의 `%LOCALAPPDATA%/Programs/CarScope-Android-Studio-2026.2.2.8/android-studio/`에 ZIP 방식으로 설치했고 시작 메뉴에 `Android Studio (CarScope)` 바로가기를 만들었습니다. SDK는 `%LOCALAPPDATA%/Android/Sdk`, AVD는 `%USERPROFILE%/.android/avd/` 아래에 있습니다. 전역 PATH/JAVA_HOME을 바꾸지 않았습니다.

Studio에는 IDE용 runtime 25가 포함되어 있으나, 프로젝트 빌드는 기존 JDK 17로 수행했습니다. IDE GUI/프로젝트 import는 아직 실행 검증하지 않았습니다. IDE에서 프로젝트를 열 때 Settings → Build, Execution, Deployment → Build Tools → Gradle에서 기존 JDK 17 또는 `GRADLE_LOCAL_JAVA_HOME`을 확인하세요. 로컬 `.gradle/config.properties`의 `java.home`은 17을 가리킵니다. [공식 Gradle JDK 설정 문서](https://developer.android.com/build/jdks)를 참조하세요.

Pleos 공식 ZIP을 checksum 검증 후 SDK 경로에 설치했습니다. ZIP의 source.properties는 revision 1 / generic android-automotive / vendor 42dot으로 남아 있어 자동 생성된 package.xml의 경로가 공식 repository 경로와 달랐습니다. source.properties와 이미지 바이너리는 유지하고, SDK 도구가 지원하는 local package.xml 형식에 공식 repository의 path/revision/display/tag/vendor/license 값을 반영했습니다. 원본·중간·최종 metadata를 `.tools/p1-a/20261030T074954Z/`에 보존했습니다. SDK Manager의 최종 installed 목록에서 공식 경로/revision 2를 인식했고 해당 패키지로 AVD를 생성했습니다. 사용자 `.android/repositories.cfg`에 공식 update site를 기록했으며 SDK Manager GUI 표시는 미검증입니다.

재실행은 아래와 같이 합니다. 이 명령은 이미 설치한 도구를 사용합니다.

```powershell
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$adb = Join-Path $sdkRoot 'platform-tools/adb.exe'
& (Join-Path $sdkRoot 'emulator/emulator.exe') -avd CarScope_Pleos_API34 -no-snapshot -gpu auto -memory 4096 -cores 2
# 별도 터미널에서, 부팅 완료 후:
& $adb -s emulator-5554 shell getprop sys.boot_completed
& $adb -s emulator-5554 install -r .\app\build\outputs\apk\debug\app-debug.apk
& $adb -s emulator-5554 shell am start -W --display 0 --windowingMode 1 -n io.carscope.app/.MainActivity
```

위 `--windowingMode 1` 실행 요청을 사용해도 Pleos task organizer는 앱을 자체 multi-window 영역에 배치했습니다. launcher에서 보이는 화면과 Activity resumed 상태가 잠시 다를 수 있으므로 실제 화면 확인이 필요합니다. 현재 PC의 cold launch timeout·프레임 지연·일부 기본 시스템 앱 오류는 남은 제한입니다. IDE와 에뮬레이터를 동시에 열어 검증하지 않았습니다.
