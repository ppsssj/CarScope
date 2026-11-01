# AR-02B-2B Android Debug receiver

2026-11-01. 기준 PR #35 `24b39023d706268ab8473e06de61e8c1df0a221c`; PR #36 main `7c90ecf`도 반영했다. 이 문서의 완료 범위는 Debug 코드와 JVM/합성 검증이다. 실제 Android HTTPS, 스마트폰 동기화, 차량 인증 성공을 의미하지 않는다.

## 구성과 사용자 흐름

`app/src/debug/java/io/carscope/app/sync/SyncReceiverActivity.kt`는 기존 Controller/Client에 연결한 Native Activity다. 기존 방식인 ScrollView, TextView, Button, ImageView를 사용한다. Debug manifest에만 Activity와 INTERNET 권한을 추가했다. 기존 InspectionActivity와 DebugWebScreen에는 진입 버튼이나 코드를 추가하지 않았다. 개발 도구에서 `.sync.SyncReceiverActivity`를 명시적으로 실행할 수 있다. exported Activity지만 Intent extras로 endpoint, credential 또는 테스트 모드를 주입하지 않는다.

초기 화면은 워셔액 셀프 점검, 사용자 보고/차량 센서 진단 구분, 연결 설정과 차량 인증 미구현 안내를 표시한다. HTTPS 연결 확인과 세션 생성은 별개다. 정상 인증 공급자가 없는 기본 실행에서는 생성 버튼이 비활성이다. 따라서 현재 APK만 설치해서 실제 세션을 생성할 수 있다고 주장하지 않는다.

인증된 transport를 제공하는 향후 통합 또는 테스트에서 Controller가 다음 흐름을 담당한다.

1. 생성 요청 → QR v2, 초대/세션 만료 시간, 사용자 점검 대기.
2. polling으로 COMPLETED 결과 수신 → 사용자 보고 상태, 완료 시각, SELF/USER_REPORTED, 센서 진단 아님 표시.
3. 사용자의 명시적 Accept 또는 Cancel → 서버의 검증된 응답으로만 ACCEPTED/CANCELLED 표시.
4. EXPIRED, FAILED, CLOSED를 구분한다. busy 상태 및 결과 수신 전에는 수락을 차단하고 중복 작업을 막는다. 실패한 Cancel을 취소 완료로 표시하지 않는다.

## QR와 토큰

기존 `SyncQrPayload`가 HTTPS 모바일 루트 + `#v=2&task=washer-fluid&invite=<token>`을 만든다. receiver token은 QR에 들어가지 않는다. `SyncQrRenderer`는 ZXing QRCodeWriter로 메모리 Bitmap을 만든다. margin 4, 오류 정정 M, 기본 512px이며 영구 이미지 파일을 만들지 않는다. Activity는 FLAG_SECURE와 QR view 저장 비활성화를 적용한다. QR 문자열을 TextView/로그에 노출하지 않는다.

초대 만료 시 1초 tick이 QR을 제거한다. 이미 Claim한 세션의 polling은 계속할 수 있으므로 초대 만료를 세션 EXPIRED로 바꾸지 않는다. onStop에서 bitmap을 제거/recycle한다. JVM UI 테스트에서 bitmap을 ZXing으로 역해독해 정확한 URL을 검증했다. 실제 화면 광학 스캔은 BLOCKED다.

receiver/invite credential은 현재 실행 객체에만 둔다. savedInstanceState, SharedPreferences, 파일에 저장하지 않는다. onStop은 generation을 변경하고 Handler 작업, polling, 요청을 취소하고 Controller/Transport를 닫는다. 새 Activity는 새 owner로 시작하며 이전 callback을 무효화한다. Activity 참조를 singleton에 저장하지 않는다. 메모리 참조 폐기는 JVM 문자열의 물리적 zeroization을 보장하지 않는다.

화면 종료는 서버 Cancel 성공을 뜻하지 않는다. 응답 유실이나 화면 종료로 orphan session이 남을 수 있다. 기존 서버 만료·보존 정리가 적용되며, 프로세스 종료 후 원격 즉시 취소/복구는 후속 과제다. Invite 재발급 또는 receiver token 복원은 구현하지 않았다.

## 연결 및 인증 경계

Activity는 앱 private files의 `sync-endpoint.json`만 읽는다. 정확한 두 문자열 필드 `apiOrigin`, `mobileRoot`, 최대 2048 bytes이며 모두 검증된 HTTPS root origin이어야 한다. userinfo/query/fragment/경로가 있는 주소는 거부한다. 이 파일은 신뢰할 주소를 개발자가 별도 검증한 후 설정하는 준비 지점이며 TLS 신뢰 또는 생성 인증을 제공하지 않는다. 기본값은 미설정이다.

`SessionCreationCredentialProvider`를 분리했고 일반 경로는 `DenyByDefaultCredentialProvider`다. 기본 생성 요청은 네트워크 전 UNAUTHORIZED로 실패한다. private endpoint 파일, 버튼, Intent로 이를 해제할 수 없다. `ExplicitDebugTestCredentialProvider`는 **testDebug 소스에만** 존재하며 정확한 fixture origin과 loopback을 제한한다. APK/AAB에 포함되지 않는다. 실제 인증 공급자/차량 소유권 검증은 BLOCKED다. 서버 ProductionSessionCreationAuthorizer 및 non-loopback Fake 거부 정책은 변경하지 않았다.

`HttpsSyncReceiverTransport`와 `SyncHttpDecoder` 상세 계약은 [Android HTTP 계약](contracts/inspection-sync-android-http-v1.md), 검증 범위는 [네트워크 검증](ar-02b2b-network-validation.md)에 기록했다.

## 의존성 및 Release 격리

| 의존성 | 고정 버전/범위 | 판단 |
| --- | --- | --- |
| ZXing core | 3.5.4 / debugImplementation | Apache-2.0, QR 인코딩/역해독만 사용. 프로젝트의 maintenance 상태를 고려해 작은 core만 도입 |
| Gson | 2.15.0 / debugImplementation | Apache-2.0, Strictness.STRICT streaming reader로 직접 allow-list 검증. reflection 모델 변환/타입 강제 변환을 사용하지 않음 |
| Robolectric | 4.16 / testDebugImplementation | MIT, JDK17/현재 AGP에서 실행 검증. 테스트 전용이며 Runtime APK에 포함되지 않음 |

공식 근거: [ZXing releases](https://github.com/zxing/zxing/releases), [ZXing license](https://github.com/zxing/zxing/blob/master/LICENSE), [Gson](https://github.com/google/gson), [Gson strict parsing](https://github.com/google/gson/blob/main/Troubleshooting.md), [Gson license](https://github.com/google/gson/blob/main/LICENSE), [Robolectric compatibility](https://robolectric.org/compatibility_table/), [Robolectric license](https://github.com/robolectric/robolectric/blob/master/LICENSE). 버전 고정과 테스트는 향후 취약점 모니터링을 대체하지 않는다. HTTP 라이브러리는 추가하지 않았다.

`check-boundary.py`는 merged manifest, Debug/Release APK와 Release AAB DEX를 검사한다. receiver/decoder/transport/QRWriter는 Debug에만, INTERNET도 Debug에만 존재한다. 양 variant cleartext=false를 유지한다. 테스트 fixture/provider는 모든 APK/AAB에서 제외된다. 기존 SDK의 Release transitive Gson 존재 여부를 이 검사로 부정하지 않는다.

## 변경 격리와 다음 단계

공통 변경은 `app/build.gradle.kts`의 Debug/테스트 의존성·resource unit test 옵션과 Debug manifest 2개 항목뿐이다. 기존 receiver 모델은 만료 메타데이터와 QR 제거 함수만 확장했다. InspectionActivity, DebugWebScreen, TireProcessOwner, PleosTireDataSource, vehicle-core, tools/three-poc, 모델 자산, Vercel 설정은 main 대비 변경하지 않았다. PR #36은 main에서 정상 merge했으며 Codex A의 브랜치/Worktree에는 접근하지 않았다.

후속 진입 조건은 실제 앱/디바이스 인증 공급자와 서버 검증, 제한된 HTTPS 서비스/모바일 주소, 각 기기에서 검증된 인증서 신뢰·hostname·도달성, 건강한 AVD, 광학 스캔 및 실제 수락 E2E다. 공개 인프라·Production 배포는 이번 범위에 없다.
