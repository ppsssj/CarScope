# 로드맵 및 진입 조건

## P0 — 복구 및 검증 기반

- 기존 파일 19개 조사 및 로컬 복구 사본 보존. Git 초기화·삭제·push·PR 없음.
- Wrapper 공식 JAR checksum 대조, 배포본 checksum 고정, 로컬 Gradle 실행 경로 확인.
- SDK 없는 `coreOnly` 구성 유지, 루트 Kotlin plugin 중복 로딩 정리.
- 상태 시각 검증 보완, XML escaping, 17개 JVM 테스트와 SVG sample export.
- Android Manifest/Activity/WebView 정적 검토 및 SDK 부재에 의한 실제 빌드 차단 확인.
- 공식 Pleos 문서와 버전 차이·권한·미검증 항목 문서화.

검증된 기술 기반으로 **P1 환경 준비에 진입 가능**합니다. P0가 APK 실행이나 실제 차량 연결까지 완료됐다는 뜻은 아닙니다. 최신 근거는 [validation-report](validation-report.md)에 기록합니다.

## P1-A — Android 실행 검증

진입 조건: JDK/Wrapper/core 테스트 및 프로젝트 구성이 PASS인 상태.

1. 사용자가 준비하거나 별도로 승인한 Android SDK 환경을 사용합니다. API 34 platform, AGP 8.10 기본 Build Tools 35.0.0, platform-tools 및 emulator 요구사항을 확인합니다. `local.properties` 또는 환경변수만 이용하고 기계 경로를 저장소 공식 설정에 넣지 않습니다.
2. `:app:assembleDebug`, `:app:lintDebug`를 실행합니다. Android Kotlin·resources·manifest merger·D8 결과와 실제 APK 경로/hash를 기록합니다.
3. AAOS emulator에 설치해 Mock 3종, STALE, Activity 수명주기와 WebView fallback을 실행합니다. 화면/로그와 테스트 기기·OS·WebView 버전을 남깁니다.
4. 주행 차단/사용 제한 정책, 화면 크기, rotary/터치, 텍스트 접근성과 야간 대비를 확인합니다.

완료 조건: APK 생성·설치·실행과 Mock 표시가 증거와 함께 PASS. WebView 부재 시에도 텍스트가 사용 가능. Android 실행 검증 전에는 이 단계를 완료로 표시하지 않습니다.

## P1-B — Pleos 읽기 전용 어댑터

2026-10-30 현재 **BLOCKED / 미완료**. SDK 2.3.2 typed 어댑터, 한 도어의 매핑·cache·수명주기, 명시적 Mock/Pleos 선택을 구현했습니다. core 17개와 app 합성 19개, APK 빌드·설치는 PASS입니다. AVD Service 2.3.22/code 74 및 최소 요구 2.3.13/code 65를 확인했습니다. OEM/framework ANR·시스템 사망으로 실제 초기화/capability/read/event→SVG를 확인하지 못했습니다. 자세한 명령과 T1~T10은 [P1-B 기록](pleos-sdk-integration.md)에 있습니다.

진입 조건: P1-A 완료, SDK 사용/저장소 접근 조건 확인, 전용 Pleos AVD 또는 허용된 테스트 차량 확보.

1. 공식 시작 가이드 2.3.1과 SDK 가져오기/샘플 2.3.2 차이를 확인합니다. SDK/Vehicle Service/AVD 버전을 함께 고정하고 AAR metadata·API reference를 확인합니다.
2. Door 조회에 실제 필요한 API·capability·권한 annotation·값/영역을 대조합니다. 승인 및 권한 부여 방식을 확인합니다.
3. Android 경계에 `PleosVehicleDataSource`를 구현합니다. 비동기 관측의 일관된 사본, 원래 관측 시각, null/unknown/거부/단절의 Unavailable, 구독과 해제 수명주기를 구현합니다. 가짜 API를 먼저 만들지 않습니다.
4. UI의 고정 MOCK 문구·HTML title을 실제 선택 출처에 맞게 바꾸고 연결 상태와 데이터 출처를 구분합니다. 실연동 실패를 자동 Mock 전환으로 감추지 않습니다.
5. SDK 합성 경계 테스트 후 전용 AVD, 허용된 실제 차량 순으로 읽기만 검증합니다. 지원 영역과 미지원 영역을 모두 확인합니다.

완료 조건: 실제 서비스 관측, 출처·권한·capability·stale·오류/재연결 처리에 증거가 있음. SDK initialization 반환만으로 연결 성공을 보고하지 않습니다.

## P2 — 자산 및 제품 수준 UI

현재 **진입 보류**. 지원 사양 호스트 또는 허용된 Pleos 테스트 기기에서 P1-B T1~T10을 먼저 완료해야 합니다. 현재 환경의 시스템 오류를 우회하기 위해 도어 값을 조작하거나 Mock으로 성공을 대체하지 않습니다. 나머지 도어·Anatomy·시각화 복잡도 확장은 그 뒤에 판단합니다.

Anatomy 자산의 라이선스·부품 매핑·sanitize·실제 SVG 호환성/성능을 평가합니다. 전체 Anatomy 통합, 차량 제어, 배포·서명·심사는 별도 범위입니다. 각 단계에서 검증하지 못한 항목은 BLOCKED 또는 NOT_RUN으로 유지합니다.
