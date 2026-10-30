# Windows 개발 환경 및 두 PC 작업 절차

연구실/집 PC는 Git의 소스·설정·문서를 공유합니다. JDK, Android Studio/SDK, Gradle 캐시, AVD, 인증 정보, APK와 원본 실행 증거는 각 PC에 따로 준비합니다. 현재 **P1-B BLOCKED**이며 clone/build 성공은 SDK 실연동 완료를 뜻하지 않습니다.

## 1. Windows 10/11에서 clone

Windows x64, Git for Windows, PowerShell, JDK 17 및 Android SDK가 필요합니다. Android Studio/Emulator 설치 전 해당 버전의 [공식 시스템 요구사항](https://developer.android.com/studio/install#system-requirements-windows)을 확인합니다. 저장소는 Private이므로 `ppsssj/CarScope` 접근 가능한 계정으로 인증합니다. PAT를 URL/스크립트/환경 파일에 적지 않습니다. Git Credential Manager 또는 GitHub CLI의 OS credential store를 사용합니다.

```powershell
# GitHub CLI를 사용하는 경우, 각 PC에서 직접 로그인합니다.
gh auth login --hostname github.com --git-protocol https --web
git clone https://github.com/ppsssj/CarScope.git
Set-Location CarScope
git remote -v
git status --short --branch
```

원격은 반드시 `https://github.com/ppsssj/CarScope.git`인지 확인합니다. Git author 이름/이메일은 개발자가 설정하고, 이메일 공개를 피하려면 GitHub Settings → Emails에 표시된 noreply 주소를 사용합니다. 인증 토큰과 commit author 이메일은 서로 다른 설정입니다. [GitHub 이메일 안내](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference)를 참고하세요.

## 2. JDK 17

기존 JDK 17이 있으면 재사용합니다. `JAVA_HOME`은 JRE 또는 bin 폴더가 아닌 JDK 루트입니다. 아래 경로는 각자 설치 위치로 치환하며 저장소 파일에 고정하지 않습니다.

```powershell
$env:JAVA_HOME = '<JDK 17 설치 디렉터리>'
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path
java -version
.\gradlew.bat --version
```

예상: Java 17 / Gradle 8.14. Studio의 IDE runtime과 Gradle JDK를 구분합니다. Settings → Build, Execution, Deployment → Build Tools → Gradle에서 **JDK 17**을 선택합니다. 이 프로젝트의 Gradle 8.14를 IDE 번들 runtime 25로 실행하지 않습니다.

## 3. Android SDK API 34

[공식 Android Studio](https://developer.android.com/studio)에서 SDK Manager를 열고 다음 구성요소를 설치합니다. G0에서는 환경 재설치를 수행하지 않았습니다.

| SDK 구성 | 프로젝트 기준 |
| --- | --- |
| Android SDK Platform | Android 14 / API 34 |
| Build Tools | 35.0.0 (AGP 8.10.0 기본값, compileSdk 34와 별개) |
| Platform Tools | adb 포함 |
| Command-line Tools | sdkmanager/avdmanager 포함 |
| Android Emulator | AVD 실행할 PC에서 설치 |

`minSdk=28`, `compileSdk=34`, `targetSdk=34`, AGP 8.10.0, Kotlin 2.2.0을 유지합니다. Studio의 upgrade 제안을 자동 적용하지 않습니다. 설치/라이선스 동의는 각 개발자가 공식 안내에 따라 수행합니다.

SDK 경로는 Studio가 만든 Git 제외 `local.properties`의 `sdk.dir`, 또는 각 PC의 `ANDROID_HOME`으로 설정합니다. 두 경로가 있다면 같은 SDK를 가리키게 합니다. 기본 설치 위치를 쓰는 PC에서는 다음처럼 현재 세션만 설정할 수 있습니다.

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$env:Path = (Join-Path $env:ANDROID_HOME 'platform-tools') + ';' + $env:Path
adb version
git check-ignore local.properties
```

다른 위치에 설치했다면 각자 그 위치를 사용합니다. `local.properties`, `.gradle/config.properties`, `.idea`, OS PATH, `JAVA_HOME`, `ANDROID_HOME`을 복사하거나 commit하지 않습니다.

## 4. Gradle Wrapper

시스템 Gradle 설치 대신 저장소의 `gradlew.bat`을 사용합니다. `gradlew`, `gradlew.bat`, wrapper JAR/properties 네 파일이 필요합니다. 배포본은 Gradle 8.14이며 properties에 공식 배포본 SHA-256이 있습니다. 첫 실행은 인터넷과 Maven 접근이 필요하고, 캐시가 완성된 뒤에만 `--offline`을 사용합니다. PC별 Gradle 절대경로로 distributionUrl을 바꾸지 않습니다.

## 5. JVM 테스트

```powershell
# Android SDK 없이 순수 core 17개 실행 (첫 실행 Maven 접근은 필요할 수 있음)
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
# Android SDK 준비 후 app 어댑터 합성 19개를 포함한 36개 실행
.\gradlew.bat :vehicle-core:test :app:testDebugUnitTest --rerun-tasks --console=plain
```

JUnit XML/HTML은 각 모듈의 `build/test-results/`, `build/reports/tests/`에 생성됩니다. app unit 테스트는 fake transport로 mapping·출처·lifecycle을 검사하며 실제 SDK/Service 통신 성공을 뜻하지 않습니다. `scripts/validate-core.ps1`은 캐시된 Gradle 8.14 안의 Kotlin 2.0.21/JUnit을 사용하는 별도 오프라인 대체 경로이며 KGP 2.2.0 검증과 구분합니다.

## 6. APK 빌드

```powershell
.\gradlew.bat :app:assembleDebug --console=plain
# 메모리가 부족하면 실행 옵션으로만 제한합니다.
.\gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
```

APK는 `app/build/outputs/apk/debug/app-debug.apk`입니다. 개발 debug 서명은 PC별로 다를 수 있습니다. 다른 PC의 debug key로 서명한 APK를 덮어 설치할 때 INSTALL_FAILED_UPDATE_INCOMPATIBLE이면 기존 앱 데이터 보존 필요를 먼저 판단합니다. uninstall은 앱 데이터를 지우므로 자동 실행하지 않습니다. keystore/debug key를 Git으로 공유하지 않습니다.

공식 Pleos Maven은 이미 settings에 등록되어 있고 `Vehicle:2.3.2`는 app 모듈에만 있습니다. [공식 SDK 설정](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/project-setup)을 기준으로 각 PC에서 다운로드합니다. Maven 접근 실패 시 DNS/TLS/proxy/HTTP 응답·버전 문제를 구분하고 무작정 버전/인증정보를 추가하지 않습니다. 사내 proxy가 필요하면 PC의 Git 제외 설정 또는 OS credential store로 처리합니다.

## 7. Pleos AVD

[공식 설치 가이드](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)에서 Windows/Linux update site를 확인합니다.

```text
https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml
```

SDK Manager → SDK Update Sites에 등록하고 API 34 Pleos system image를 설치합니다. Device Manager → Automotive → Pleos Connect v2.1.0 이미지로 AVD를 만들고 공식 가이드의 Cold Boot 요구를 적용합니다. AVD 이름은 PC별로 달라도 되며, 명령에 실제 이름을 사용합니다. 이미지·AVD·다운로드 ZIP·SDK 라이선스를 이 저장소에 복제하지 않습니다.

GPU/가상화/메모리 조건을 먼저 확인하고 `emulator -accel-check`로 가속기를 점검합니다. BIOS/Windows 기능 활성화·재부팅은 개발자가 따로 결정합니다. 임의 해상도 변경으로 앱 성공을 만들지 않습니다. 연구실 PC의 raw image metadata 보정 절차는 과거 환경 기록이며 새 PC에 자동 복사하지 않습니다. 설치 metadata 문제가 재현되면 공식 repository와 sdkmanager 출력부터 확인합니다.

## 8. SDK와 Service 버전 확인

SDK **2.3.2**, 연구실 AVD Service **2.3.22/code 74**, Pleos image **2.1.0**은 서로 다른 버전입니다. SDK AAR의 최소 Service는 2.3.13/code 65입니다. 집 PC에서도 직접 확인합니다.

```powershell
adb devices -l
# 두 대 이상이면 실제 serial을 지정합니다.
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 shell dumpsys package ai.pleos.playground.service.vehicle |
    Select-String 'versionName=|versionCode='
adb -s emulator-5554 shell dumpsys package io.carscope.app |
    Select-String 'CAR_DOORS:|VEHICLE_BINDING:'
```

버전 조건, permission 선언, 실제 grant, capability 성공은 각각 별도입니다. 일반 Android emulator에는 Pleos Vehicle Service가 없을 수 있습니다.

## 9. Mock 실행 및 P1-B 재검증

```powershell
adb -s emulator-5554 install -r .\app\build\outputs\apk\debug\app-debug.apk
adb -s emulator-5554 shell am start -W -n io.carscope.app/.MainActivity
```

MOCK 모드와 출처 표시를 확인하고 ALL_CLOSED / FRONT_LEFT_OPEN / UNAVAILABLE, 5초 초과 STALE, 실제 SVG 픽셀, Activity 재생성을 검증합니다. 기본은 Mock이며 모의 버튼은 명시적으로 Mock으로 전환합니다. PLEOS 버튼은 읽기 전용 ROW_1_LEFT이고 실패 시 Mock을 자동 대체하지 않습니다.

실연동은 [T1~T10](pleos-sdk-integration.md#런타임-검증-기록)을 순서대로 재검증합니다. SDK 초기화 → capability → current → listener 성공을 먼저 확인한 뒤 `adb forward tcp:8088 tcp:8088`, `http://127.0.0.1:8088/` → Convenience → Door Position에서 Front left Open/Close를 검증합니다. 앱에는 차량 SET API가 없습니다. 현재 Door Event는 NOT_RUN이고 SDK 초기화/capability/state/실데이터 SVG는 BLOCKED입니다.

## 10. 문제 해결 및 두 PC 작업 규칙

| 증상 | 확인할 사항 |
| --- | --- |
| SDK location not found | 해당 PC의 sdk.dir/ANDROID_HOME, Platform 34와 Build Tools 설치 |
| Java/Gradle 오류 | java -version와 gradlew --version의 JDK 17 여부, Studio Gradle JDK |
| Wrapper/Maven download 실패 | 공식 URL, DNS/TLS/proxy. 캐시가 없으면 offline 성공 불가. 자격증명/절대경로 commit 금지 |
| Package/WindowManager timeout·OEM ANR | 앱 PID와 framework/OEM 로그를 분리. boot_completed나 am start 반환만으로 성공 처리하지 않음 |
| UI와 SVG 갱신 시차 | native 텍스트, SDK callback, WebView 실제 픽셀을 따로 확인. 현재 개선 주장은 없음 |
| SDK unavailable/null/unknown | 실제 permission·Service·capability·raw 오류 확인. UNKNOWN을 CLOSED로 바꾸지 않음 |
| 원본 증거 파일 없음 | 연구실 로컬 증거는 업로드 제외. 해당 PC에서 테스트/로그/화면을 새로 수집 |

작업 시작/종료 때 다음 흐름을 사용합니다. 작업 중인 변경이 있으면 먼저 상태를 확인하고 무조건 reset/clean/stash하지 않습니다.

```powershell
git switch main
git pull --ff-only origin main
git switch -c fix/p1-b2-pleos-runtime
# 구현 → 로컬 검증 → 명시적으로 파일 stage → staged diff 보안 검토
git diff --cached --check
git commit -m 'fix: validate Pleos runtime on supported environment'
git push -u origin fix/p1-b2-pleos-runtime
# GitHub에서 PR 생성 → CI가 구성돼 있다면 결과 확인 → 변경 검토 → 승인 후 merge
# 다른 PC에서 작업 시작 전:
git switch main
git pull --ff-only origin main
```

이후 예시: `feat/p2-anatomy-vehicle-model`, `feat/p3-inspection-scenarios`. 같은 브랜치에서 양쪽 PC가 동시에 다른 commit을 만들지 않습니다. `--ff-only` 실패 시 fetch 후 로그 관계와 변경을 검토하고 force/reset으로 해결하지 않습니다. G0에서는 PR·merge·CI workflow를 생성하지 않았으며 CI PASS를 주장하지 않습니다. P1-B가 검증되기 전 P2 제품 기능을 시작하지 않습니다.
