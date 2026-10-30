# 실현 가능성 및 공식 문서 근거

## P1-B 최신 확인 — 2026-10-30

공식 `Vehicle:2.3.2` AAR 다운로드·Gradle 해석, typed Door 어댑터 컴파일, app 합성 테스트 19개, 기존 core 17개, debug APK 생성·설치가 PASS입니다. 실제 AVD Service는 **2.3.22/code 74**, AAR 요구 최소 Service는 **2.3.13/code 65**입니다. SDK minSdk 23, minCompileSdk 1을 확인했고 기존 앱 min 28/compile·target 34에서 APK를 생성했습니다. 문서의 2.3.1 예시를 따라 버전을 혼용하거나 샘플의 API 35 설정으로 업그레이드하지 않았습니다.

앱에 CAR_DOORS만 명시하고 SDK의 VEHICLE_BINDING permission을 병합합니다. 병합 Manifest에는 제어·PRIVATE·INTERNET 권한이 없습니다. 실제 Service가 두 권한을 normal로 정의하는 것을 확인했습니다. 실제 앱 grant, capability/read/listener 및 Console→SVG 결과는 [P1-B 실행 기록](pleos-sdk-integration.md#런타임-검증-기록)에서 별도 판정합니다. 버전/permission 선언만으로 실제 차량 접근을 PASS 처리하지 않습니다.

아래는 보존한 **P0 시점의 실현 가능성 검토**입니다. SDK/AVD 부재 및 미구현이라는 표현은 그 시점의 기록이며 최신 구현·환경 상태는 위와 연동 문서를 기준으로 합니다. Anatomy, 실차 정책, WebView 오류 주입·장시간 안정성은 계속 미검증입니다.

확인일: 2026-10-30 (Asia/Seoul). 아래는 문서 검토와 로컬 실행을 구분한 기록입니다. P0는 실제 SDK 아티팩트 또는 차량 서비스를 호출하지 않았습니다.

## Android Automotive 호환성

Pleos 공식 [Vehicle SDK 소개](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro)는 Vehicle Service가 Android Automotive OS에서 동작하는 구조를 설명합니다. 일반 Android 기기에서 Mock UI를 구현할 수 있다는 사실과 Pleos 차량 서비스가 있다는 사실은 별개입니다.

[앱 개발 시작하기](https://document.pleos.ai/docs/pleos-only/getting-started)의 기준은 Android SDK API 34, minSdk 28 이상, Pleos 전용 emulator image입니다. 현재 minSdk 28 / compileSdk·targetSdk 34는 이 시작 가이드와 맞습니다. Manifest는 Automotive 필수, touchscreen 선택, MAIN/LAUNCHER Activity와 exported=true를 선언합니다. 일반 Android Auto projection 앱 구현은 포함하지 않습니다.

공식 [Sample App 가이드](https://document.pleos.ai/docs/pleos-only/tutorial/vehicle-sdk-sample-app)는 SDK 2.3.2 / Service 2.3.22 / 전용 Android 14 AVD와 compileSdk·targetSdk 35를 사용합니다. 시작 가이드의 SDK/API 기준과 샘플의 기준이 다르므로 샘플 설정을 현재 앱의 필수 조건으로 단정하지 않았습니다. 선택할 AAR의 manifest minSdk, transitive dependencies, AAR metadata의 minCompileSdk는 미검증입니다.

## Pleos SDK 2.3.1 / 2.3.2 불일치

| 공식 출처 | 확인한 내용 | P0 판단 |
| --- | --- | --- |
| [시작 가이드](https://document.pleos.ai/docs/pleos-only/getting-started) | `ai.pleos.playground:Vehicle:2.3.1` 예시 | 오래된 예시 가능성을 포함해 버전 미확정 |
| [SDK 가져오기](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/project-setup) | 같은 아티팩트의 `2.3.2`, Pleos Maven repository | 실제 다운로드·해결 미수행 |
| [SDK 소개](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro) | SDK 2.3.2 / Service 2.3.21 기준 | 서비스 버전도 기록 필요 |
| [Sample App](https://document.pleos.ai/docs/pleos-only/tutorial/vehicle-sdk-sample-app) | SDK 2.3.2 / Service 2.3.22 기준 | 문서 간 Service patch도 다름 |

따라서 P0에서 Pleos dependency/version을 추가하지 않았습니다. P1에서는 접근 가능한 공식 repository의 아티팩트, 적용되는 release note, 실제 대상 Service/AVD 버전과 API reference를 대조한 뒤 하나의 버전을 고정해야 합니다. 두 SDK 버전의 API 동일성이나 상호 호환성을 추측하지 않습니다. `PleosVehicleDataSource`는 후속 설계 이름이며 가짜 SDK 호출을 넣은 구현 파일이 아닙니다.

## 필요한 권한과 검증 여부

공식 [권한 선언 가이드](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-permission)는 Door 조회의 대표 권한으로 `pleos.car.permission.CAR_DOORS`를 제시합니다. 다만 최종 요구 권한은 실제 사용할 함수의 `@RequiresPermission`을 확인해야 합니다. 제어 권한은 조회 권한과 구분됩니다.

| 항목 | 상태 | 근거/다음 검증 |
| --- | --- | --- |
| Mock 화면의 차량 권한 불필요 | PASS | 현재 Manifest에 차량/네트워크 권한 없음, SDK 호출 없음 |
| Door 조회용 대표 권한의 문서 확인 | PASS | 공식 permission guide |
| 선택 SDK 함수별 권한 확인 | NOT_RUN | SDK 버전/API 선택 및 AAR 확인 전 |
| 권한 부여 방식·앱 승인·서명 조건 | NOT_RUN | 대상 Pleos 환경과 공식 승인 정책 확인 필요 |
| 거부/미지원/단절 → Unavailable 모델 처리 | PASS | 합성 JVM 입력 테스트 |
| 실제 OS/Vehicle Service에서 권한 처리 | BLOCKED | SDK, 전용 AVD 또는 차량 없음 |

Mock 단계에 사용하지 않는 차량 권한을 미리 추가하지 않았습니다. 실데이터 연결은 읽기 전용부터 검증하며 제어 API는 현재 인터페이스에 없습니다.

## Gradle / Kotlin / Android 빌드 도구

[Kotlin 공식 호환성 표](https://kotlinlang.org/docs/gradle-configure-project.html)에 따르면 KGP 2.2.0의 완전 지원 범위는 Gradle 7.6.3~8.14 및 AGP 7.3.1~8.10.0입니다. Gradle 8.14/JDK 17은 실제 실행했습니다.

초기 AGP 8.7.3을 8.10.0으로 정렬했습니다. Kotlin plugin의 로딩 호환성 외에 [Kotlin 바이트코드의 D8/R8 요구사항](https://developer.android.com/build/kotlin-support)(Kotlin 2.2의 R8 8.10.21)도 기준선에 포함하려는 선택입니다. [AGP 8.10 공식 요구사항](https://developer.android.com/build/releases/agp-8-10-0-release-notes)은 Gradle 8.11.1 이상, JDK 17, 기본 Build Tools 35.0.0입니다. 이는 앱 compileSdk/targetSdk 34와 구분됩니다.

이 조합의 Gradle 프로젝트 구성은 검증했지만 Android 컴파일·D8/R8 실행·release shrinking은 SDK 부재로 검증하지 못했습니다. 버전 표 일치가 APK 성공을 뜻하지 않습니다. Kotlin plugin 공통 classloader 선언은 루트의 `apply false`로 모아 중복 로딩 경고를 해결했습니다.

## Anatomy SVG 통합 가능성

**설계상 가능성만 확인**했습니다. 현재 4개 door group ID와 `data-state`를 자산 연결 계약으로 사용할 수 있습니다. Anatomy 전체 도입, 라이브러리 선택, 라이선스·출처·상표 검토 및 실제 자산 변환은 이번 범위 밖입니다. Anatomy 자산 파일/URL이 제공되지 않았으므로 특정 자산의 구조나 호환성을 확인했다고 주장하지 않습니다.

후속 단계에는 부품 ID 대응, viewBox/방향, nested transform, clipPath/mask, stroke, CSS 상속, 외부 resource와 script 제거, 파일 크기와 메모리, 저사양 WebView 성능을 검증해야 합니다. 현재 renderer의 XML text escaping은 외부 SVG sanitize를 대신하지 않습니다.

## WebView 제한과 차량 UX

공식 [Pleos 앱 보안 가이드](https://document.pleos.ai/docs/pleos-only/app-registration-guide/app-security-guide)는 필요한 로컬 접근만 허용하고, 콘텐츠·탐색 범위를 제한하며, 필요한 경우에만 JavaScript/앱 연결 기능을 사용하도록 안내합니다. 현재 SVG는 정적이므로 JavaScript가 필요 없습니다. 메모리 HTML/SVG, file/content/network 차단, CSP, navigation 차단과 텍스트 fallback을 정적으로 검토했습니다. 실제 network 차단·CSP 적용·오류 callback 동작은 실행 검증 전입니다.

WebView 제공자 유무/버전, SVG 문자와 글꼴, viewBox 확대, clipping, 접근성 tree, callback 오류 이후 상태, renderer process 종료, Activity 재생성·백그라운드 복귀, 연속 시나리오 입력을 기기에서 검증해야 합니다. HTML 로드 완료와 SVG 픽셀 표시 성공을 구별합니다.

[Android 주차 앱 가이드](https://developer.android.com/training/cars/parked)는 주차 환경 앱 범주와 대화면·rotary 입력을 설명하지만 CarScope의 차량 상태 도식 앱이 자동으로 배포 승인된다는 근거는 아닙니다. Pleos 전용 앱 정책과 Google Play/Android for Cars 범주 심사는 별도로 판단해야 합니다. [Pleos CCP 가이드](https://document.pleos.ai/docs/pleos-only/vehicle-app-developer-guide/ccp-rotary-controller-development)의 설치 유형별 입력 요구사항도 검토 대상입니다.

현재 Manifest에는 distractionOptimized 선언이 없습니다. 주차 검증용 문구는 실제 주행 차단 구현이 아닙니다. 화면의 영어 enum 상태, 한글 줄바꿈, 가독성, 터치 target, 긴 스크롤, 일광·야간 대비, rotary/키보드 focus, 운행 제한에 따른 진입/종료를 확인해야 합니다. 실차 주행 사용은 P0 완료 범위가 아닙니다.

## 실제 차량 및 에뮬레이터 검증 항목

1. 별도 준비한 API 34 platform 및 AGP 기본 Build Tools로 debug APK 생성·설치.
2. 일반 AAOS에서는 Mock 표시만, Pleos 전용 AVD에서는 Vehicle Service 존재/버전부터 확인.
3. Mock 3종, 5초 경계 STALE 전환, 버튼 갱신, 백그라운드 복귀/재생성, 시간 변경 확인.
4. WebView 정상/미제공/초기화 실패/로딩 실패와 텍스트 fallback, 스크린샷 보존.
5. 선택 SDK·서비스 버전, API 지원 capability, door 영역 매핑, nullable/unknown 값, 권한 거부와 단절/재연결 확인.
6. 실차의 수신 지연·타임스탬프 의미·데이터 출처, 주행 UX 제한 및 배포 정책 확인.

현재 1~6의 기기 실행은 모두 미수행입니다. SDK 설치와 실연동은 후속 단계로 남깁니다.
