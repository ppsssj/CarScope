# AR-02B-2A 네트워크·배포 경계

상태: **로컬 UI 통합 및 Debug Fake 검증**, 실제 차량 인증/Android·스마트폰 HTTPS E2E는 BLOCKED다.
AR-02B-1의 ProductionSessionCreationAuthorizer 기본 거부, non-loopback TLS 요구와 testOnly authorizer 외부 bind 거부를 변경하지 않았다.
VIN/번호판/계정/GPS/미디어·차량 제어를 추가하지 않았다.

## 세 가지 실행 경계

| 환경 | 허용 범위 |
| --- | --- |
| 기존 정적 배포 | v1/직접 방문 AR-01만. v2 invalid fragment를 지우고 거부. API/개발 모듈 없음 |
| `serve:mobile-dev` | 두 listener 모두 127.0.0.1 고정. same-origin 페이지/API proxy, 명시적 로컬 테스트 인증만 |
| Android Debug 패키지 | HTTPS target 검증·typed transport·Fake 테스트. 실제 transport/Activity/INTERNET 없음 |

개발 진입점은 정적 staging 빌드가 복사하지 않는다. URL query, localStorage, sessionStorage로 활성화할 수 없다.
모바일 페이지는 location.origin만 API로 사용한다. 외부 API URL을 받아들이는 config나 wildcard CORS가 없다.
개발 서버도 Host/Origin을 검사하고 static query를 거부한다. proxy target은 내부에서 만든 loopback API로 고정한다.
`connect-src 'self'`, no-store, no-referrer, camera self만 허용하는 기존 정책을 유지한다.
미확인 인증서를 신뢰하거나 TLS 검사/Android cleartext 차단을 해제하지 않는다.

로컬 합성 HTTP 성공을 실기기의 HTTPS 성공으로 계산하지 않는다. Node TLS 회귀는 별도 테스트 CA를 명시적으로 신뢰하는
Node 클라이언트에서만 수행하며 Android/폰 신뢰 저장소는 변경하지 않는다.
실제 접속 가능 HTTPS endpoint, 서버 인증서 체인/SAN, 앱·기기 등록과 verifier가 없으므로 공개 세션 생성은 계속 거부다.

## Android 공통 파일을 수정하지 않은 이유

Codex A가 P3-I1에서 Activity/WebView/manifest/Gradle과 Three.js를 작업했다.
이 PR은 새 sync 패키지와 testDebug 테스트만 추가했다. 기존 InspectionActivity.kt, DebugWebScreen.kt,
app/src/debug/AndroidManifest.xml, app/build.gradle.kts, tools/three-poc 및 Tire 파일은 최신 main 대비 변경하지 않는다.
작업 중 PR #34가 main에 병합되어 main을 반영했고, CI workflow의 충돌만 양쪽 검사 단계를 유지해 해결했다.
Codex A의 브랜치를 merge/rebase하지 않았다.

향후 등록 Activity, INTERNET permission, HTTPS client, main-thread dispatch, foreground/lifecycle 연결이 필요하다.
기존 정적 SVG WebView나 3D private origin에 API 권한을 열지 말고 별도 native 경계에서 처리해야 한다.
Release 격리 검사는 Debug DEX에는 sync controller가 있고 Release APK/AAB에는 패키지가 없으며
INTERNET permission·cleartext 허용도 없음을 검사한다. 기존 Identity/Tire 격리 검사도 유지한다.

## AVD·실기기 preflight와 차단

이 실행의 `adb devices -l`에는 기기가 없었다. 기존 CarScope_Pleos_API34는 부팅하지 않았고 재설정·재설치·강제 재시작하지 않았다.
호스트 여유 메모리는 사전 확인 때 약 3.6GiB였다. 가동 기기가 없어 boot_completed/SystemUI/네트워크/TLS trust는 NOT_RUN이다.
추가로 수신 Activity 등록·실제 HTTP transport·생성 auth 제공자·검증된 endpoint가 없다.
따라서 Android AVD 수신기 Runtime과 실제 폰↔Android↔HTTPS API E2E는 BLOCKED다.

## AR-02B-2B 진입 조건

1. 차량 앱/디바이스 등록·증명/단기 credential의 실제 제공자와 서버 verifier를 결정하고 폐기·회전·scope를 검증한다.
2. Android HTTPS transport와 strict wire decoder를 구현한다. timeout/cancel, callback thread, typed error 매핑,
   schema allow-list, Digest golden 테스트와 실제 API 실패 응답 검증이 필요하다.
3. Codex A와 공통 파일 편집을 조율한 뒤 Debug Activity 등록과 INTERNET permission을 별도 변경으로 검토한다.
   QR는 로컬 렌더러로 표시하고 receiver token은 메모리만 사용한다. 복원이 필요하면 별도 승인된 Keystore 정책을 설계한다.
4. AVD 기기 상태·부팅/SystemUI·호스트 메모리·실제 네트워크 경로와 인증서 신뢰를 확인한다.
5. 스마트폰에서 도달 가능한 HTTPS origin, 인증서 SAN/체인과 모바일 same-origin API를 준비한다.
   Vercel 정적 Preview가 API를 제공한다고 가정하거나 Preview 보호를 우회하지 않는다.
6. 그 조건이 충족된 뒤에만 QR 광학 스캔→실제 Activity polling/수락→폰 상태를 검증한다.
   사용자 승인 없는 인프라·배포·유료 리소스 생성은 계속 금지다.
