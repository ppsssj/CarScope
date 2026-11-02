# AR-02B-2E 인증 및 HTTPS 서비스 통합

기준: PR #40 병합 main `ef2f83f4d607951e1af6d9091bb1f0bd7bbdf01e`, 별도 `C:/dev/CarScope-ar02b2e`, `feat/ar-02b2e-auth-service-integration`. 기존 B/A worktree와 PR #41은 수정하지 않는다.

## 결정과 작업 범위

기존 생성 credential은 Android `[A-Za-z0-9_-]{32,128}`, 서버 bearer는 같은 문자 집합 최대 128자다. QR/receiver/invite/submit은 별도 43자 토큰이다. JWT를 그대로 넣으면 기존 wire 계약과 맞지 않는다. 이번에는 형식을 임의 확대하지 않고 opaque credential을 유지한다.

선택지: (1) 테스트 인증을 LAN에 확장하는 방식은 금지, (2) 발급자/키/등록 근거 없이 JWT 발급기를 만드는 방식은 거부, (3) 검토된 외부 verifier·등록 관계 provider·폐기 provider를 주입하는 기본 거부 경계를 선택한다. 실제 발급/등록 시스템 없이 어떤 클라이언트 입력도 신뢰한 identity로 승격하지 않는다.

서비스는 별도 proxy 대신 하나의 HTTPS listener에서 모바일 v2 allow-list 페이지와 기존 createSyncHandler를 처리한다. 단일 SessionService·SQLiteSessionStore·SQLiteRateLimiter를 공유하므로 페이지/API의 저장소 분리 문제를 없앤다. 기존 HTTP loopback 개발 서버와 API CLI의 기본 거부 및 외부 testOnly 차단을 유지한다. 새로운 서비스 CLI도 인증 adapter를 자동 로드하거나 테스트 토큰을 받지 않는다.

Android는 기존 Activity의 DenyByDefault를 그대로 둔다. 향후 신뢰 provisioning의 메모리 snapshot을 받는 별도 provider와 policy 검사를 추가한다. UI/Intent/endpoint 파일에서 등록 identity나 credential을 받지 않는다. testDebug fixture provider는 그대로 테스트에만 둔다. 공통 manifest/Gradle, Codex A UI, Release 정책 변경은 없다.

단기 credential 시간 정책은 adapter 계약에서 최대 5분, clock leeway 0으로 정한다. 기존 Sync invite/session/retention/STALE 정책은 변경하지 않는다. verifier는 단순 decode가 아니라 신뢰한 서명 검증 또는 인증된 introspection을 수행해야 한다. [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)의 active/scope/audience/expiry 검토와 [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750)의 bearer 비노출/TLS 요구를 참고하지만, 이 구현 자체를 OAuth 발급 서버라고 주장하지 않는다.

검증 계획: 각 인증 dependency의 누락/예외/timeout/잘못된 타입/만료/폐기/등록 불일치 거부, 실제 TLS same-origin+SQLite 재시작 E2E, 모바일 브라우저, Kotlin provider 및 기존 Decoder/HTTPS/lifecycle/Release CI. 기기 네트워크/TLS/광학 QR/실제 차량 인증은 NOT_RUN이다.

## 인증 adapter 계약

`VerifiedSessionCreationAuthorizer`는 기본값을 바꾸지 않는 별도 구현이다. `ProductionSessionCreationAuthorizer`와 일반 Android Activity의 `DenyByDefaultCredentialProvider`는 그대로다. 새 authorizer도 dependency 하나라도 없거나 unknown/예외/timeout이면 false다. API는 403을 반환하며 identity·credential을 응답하지 않는다. 클라이언트가 제출한 차량/사용자 ID, 헤더 또는 디코드한 토큰 payload를 검증 근거로 삼지 않는다.

| 신뢰 경계 | 메서드와 필수 동작 |
| --- | --- |
| CredentialVerifier | `verify({token,signal})` → 검증 완료 assertion 또는 null. 검토한 고정 issuer의 서명/알고리즘/key allow-list 또는 인증된 HTTPS introspection 수행. 토큰의 URL/kid/issuer로 임의 원격 주소를 fetch하지 않음. 단순 JSON/JWT decode는 구현이 아님 |
| RegistrationProvider | `resolve({issuer,subject,registrationId,signal})` → 현재 등록 관계 또는 null. issuer/subject/registrationId 일치, 실제 등록된 user/vehicle/device와 소유·이용 권한 근거 확인. 임의 기기 ID·패키지명·QR 열람으로 등록을 생성하지 않음 |
| RevocationProvider | `isActive({issuer,credentialId,registrationId,signal})` → 오직 boolean true만 허용. 등록/사용자/차량/앱 키/개별 grant 폐기를 신뢰 저장소에서 확인. 장애/unknown은 false. 승인 캐시로 장애를 감추지 않음 |

Assertion은 정확히 `{active, issuer, audience, subject, scope, issuedAt, notBefore, expiresAt, credentialId, registrationId}`다. active=true, issuer/audience는 operator policy와 문자열 정확 일치, scope는 정확히 `["inspection:session:create"]`다. ID는 내부 opaque 참조 `[A-Za-z0-9:_-]{1,128}`이며 VIN/번호판을 요구하지 않는다. 등록 관계는 정확히 `{issuer, subject, registrationId, userId, vehicleId, deviceId, active, ownershipVerified, expiresAt}`다. active는 관련 사용자/차량/앱 및 관계 전체가 현재 활성이라는 provider 보증이고 ownershipVerified는 별도 등록 근거가 확인됐다는 뜻이다. 이 boolean을 client 입력에서 복사하는 adapter는 금지한다. 이 내부 identity는 Sync payload/QR/로그/SQLite session 행에 추가하지 않는다.

모든 시간은 0 이상 JS safe integer인 epoch **milliseconds**다. `issuedAt <= notBefore <= now < expiresAt`, `expiresAt-issuedAt <= 300000`과 등록 관계 만료를 검사한다. OAuth 응답의 seconds는 검토한 adapter가 overflow/타입을 검사한 뒤 명시적으로 변환해야 한다. 숫자 문자열/추가 필드/잘못된 scope/만료/미래 시각은 거부한다. 외부 assertion을 snapshot으로 복사하고 async 조회 이후 만료를 재확인한다.

전체 adapter deadline 기본 1500ms, 최대 5000ms이며 timeout 시 AbortSignal을 취소한다. adapter는 자체 I/O timeout과 abort, TLS 기본 hostname/CA, redirect 거부, 응답 크기/타입 상한을 구현해야 한다. deadline은 무시하는 외부 adapter를 강제로 종료하거나 암호 검증을 대신하지 않는다. 생성 요청은 본문 읽기 전과 직후 권한을 두 번 확인하므로 verifier는 credential을 소모하지 않는 조회여야 한다. 느린 본문 중 revoke/expire되는 경로를 회귀 검사한다. 발급자 선택, 실제 원격 verifier/registry/revocation adapter와 등록 증명은 **미구현**이다.

`test/auth-fixture.mjs`의 ID와 무작위 opaque credential은 전부 합성이다. dependency의 `testOnly=true`는 authorizer로 전파되고 서비스의 외부 bind를 거부한다. fixture는 정적 페이지 allow-list에 없고 CLI에서 선택할 수 없다. 이 테스트 성공을 실제 등록 차량 인증으로 해석하지 않는다.

## Android provisioning 및 lifecycle

`ProvisionedSessionCreationCredentialProvider`는 검토된 `ProvisionedCredentialSource`의 **비동기 작업이 끝난 로컬 메모리 snapshot**만 읽는다. 이 getter는 UI thread에서 호출될 수 있으므로 네트워크/Keystore/등록 I/O를 실행하지 않는다. 정책 issuer/audience, 정확한 API origin, create scope, 단기 시간, 등록 관계 및 active를 확인한다. source가 없으면 `UnavailableProvisionedCredentialSource`가 null을 반환한다. 별도 provider를 구현해도 현재 Activity가 자동 선택하지 않는다.

향후 실제 source는 등록/로그인/refresh 완료 후 snapshot을 교체하고, 만료·로그아웃·등록 폐기·키 변경 때 즉시 무효화해야 한다. transport.close → provider.close → source.close로 source 소유 메모리 참조를 정리하며 기존 Activity onStop 경로를 따른다. callback은 기존 generation/cancellation을 유지한다. savedInstanceState/Intent/파일/QR/SharedPreferences에 생성 credential을 저장하지 않는다. refresh token/Keystore/프로세스 재시작 복원은 이 단계에서 추가하지 않았다. JVM String의 물리적 zeroization을 보장하지 않는다.

서버가 현재 상태를 최종 검증하므로 Android의 local active 표시만으로 서버 권한을 얻지 못한다. 반대로 생성 credential 폐기는 **향후 생성 차단**이며 이미 발급된 receiver/invite/submit bearer를 자동 취소하지 않는다. 기존 session TTL/명시 Cancel 정책을 유지한다. principal→session 강제 폐기 연동은 별도 후속 설계이며 이번 API/DB에 identity를 몰래 보존하지 않는다.

## HTTPS same-origin 서비스와 운영 환경

`src/https-mobile-service.mjs` → 하나의 HTTPS listener → 기존 createSyncHandler와 shared 모바일 allow-list → 하나의 SessionService/SQLiteSessionStore/SQLiteRateLimiter다. proxy와 `X-Forwarded-*` 신뢰를 추가하지 않았다. API/mobileRoot를 같은 public origin으로 지정한다. static 서비스는 `mobile-page.mjs`를 HTTP loopback 개발 서버와 공유한다. `mobile-dev-entry`라는 파일명은 과거 이름이며 새 HTTPS 서비스에서도 같은 모듈을 사용한다. 기존 v1 정적 배포에 Sync를 활성화하지 않는다.

| 설정 | 사용/필수 조건 |
| --- | --- |
| `SYNC_HOST` | 기본 127.0.0.1. non-loopback은 명시 public origin과 non-test authorizer 필요. 테스트 서버를 터널/proxy로 외부 노출 금지 |
| `SYNC_PORT` | CLI 기본 4183, 1~65535 권장. programmatic 테스트는 0 사용 가능 |
| `SYNC_PUBLIC_ORIGIN` | HTTPS root만, userinfo/path/query/fragment 없음. non-loopback 필수, 정확한 Host/Origin 검증에 사용 |
| `SYNC_TLS_CERT` | PEM leaf+intermediate chain, 해당 public hostname/IP SAN 및 유효기간. listener 시작 전에 leaf SAN/기간 검사 |
| `SYNC_TLS_KEY` | cert에 맞는 PEM private key, Git 밖·서비스 계정만 읽는 ACL. certificate/key 모두 필요 |
| `SYNC_DB_PATH` | Git 밖 절대 파일 경로, 존재하는 private parent. local disk 단일 호스트 SQLite/WAL, network FS/serverless/HA 보장 없음 |
| issuer/audience | 새 authorizer constructor의 operator policy. CLI의 임의 env로 adapter를 자동 로드하지 않음. issuer/등록/폐기 adapter의 신뢰 구성은 검토된 bootstrap 코드에서 주입 |

CLI는 위 TLS/DB 설정만 받으며 **creation=DENIED**다. `SYNC_LOCAL_TEST_AUTH`, `SYNC_FIXTURE_TOKEN`, `SYNC_DEBUG_PAGE`, `SYNC_ALLOWED_ORIGIN`을 활성화한 환경은 거부한다. `NODE_TLS_REJECT_UNAUTHORIZED=0`도 거부한다. 인증 token을 환경변수에 넣어 일반 서비스를 활성화하는 경로는 없다. 프로그램 주입은 검토된 operator 코드의 권한이며 공개 요청으로 adapter나 identity를 선택할 수 없다.

향후 승인된 서버에서 실행할 형태(이번에 배포하지 않음):

```powershell
Set-Location <checkout>/tools/inspection-sync-poc
$env:SYNC_HOST='127.0.0.1'
$env:SYNC_PORT='4183'
$env:SYNC_PUBLIC_ORIGIN='https://approved-host:4183/'
$env:SYNC_TLS_CERT='<external>/fullchain.pem'
$env:SYNC_TLS_KEY='<external>/private-key.pem'
$env:SYNC_DB_PATH='<external-private-existing-directory>/sync.sqlite'
npm run serve:https
# 기본 생성 403은 정상. 테스트 credential로 해제하지 않는다.
```

서비스 adapter를 정식 연결할 때는 별도의 검토한 bootstrap에서 `new VerifiedSessionCreationAuthorizer({issuer,audience,credentialVerifier,registrationProvider,revocations})`를 만들고 `startHttpsMobileService({...,authorizer})`에 주입한다. 제공자 코드·관리 credential·등록 증거 저장소는 이 저장소에 포함하지 않는다.

DNS는 승인된 public origin을 실제 TLS listener에 연결하고 인증서 SAN과 일치해야 한다. 이 서비스는 직접 TLS를 종료하므로 L7 TLS 종료 proxy 구성은 별도 검토 대상이다. 기본 TLS 최소 1.2, full chain/SAN/expiry와 client의 기본 hostname/CA 검증을 모두 유지한다. leaf의 SAN 사전 검사만으로 CA 신뢰 체인이 검증됐다고 주장하지 않는다. OS trust store 설치·경고 무시·인증서 우회는 수행하지 않았다.

모든 API 로그는 route template/status/duration, 내부 오류는 고정 문구만 남긴다. 새 CLI는 origin·credential·identity·DB 원문을 출력하지 않는다. HTTP access proxy/운영 APM에서도 Authorization, request/response body, query/fragment, QR, 인증 assertion을 수집하지 않도록 별도 설정해야 한다. no-store/no-referrer/CSP self/HSTS를 유지한다. foreign Host/Origin, query, debug/test 소스 접근은 거부하고 redirect endpoint를 제공하지 않는다. SIGINT/SIGTERM은 listener·sweep·DB를 순서대로 종료한다.

## 테스트 PKI 및 정리

Node 테스트는 OS temp의 `carscope-ar02b2e-owned-*` 전용 디렉터리에 매번 CA/leaf/key를 새로 만든다. 2일 CA/1일 leaf, localhost와 127.0.0.1 SAN, serverAuth 용도다. 실제 서비스 cert를 재사용하지 않으며 CA/key를 Git·APK·로그·증거 산출물에 복사하지 않는다. expired negative fixture는 정상적인 2020년 시작/종료 구간을 사용한다. JVM은 기존 전용 temp 경로에 생성한다.

Node는 생성 실패 catch와 test teardown에서 cleanup, JVM은 생성 실패 catch와 AfterClass에서 cleanup한다. 삭제는 이번 invocation이 생성한 temp 직계 경로와 prefix·symlink/정규 경로를 확인한 후 해당 트리만 지운다. Node cleanup의 idempotence와 실제 key/cert 소멸을 검사한다. 테스트 DB/WAL은 해당 test-owned 디렉터리에서 연결 종료 후 정리한다. 강제 process kill/OS crash가 teardown을 보장하지는 않는다. 그런 경우 operator가 소유권/경로/실행 종료를 확인한 잔여 디렉터리만 정리해야 하며 다른 작업의 temp를 전역 검색·삭제하지 않는다. 파일 삭제가 물리적 forensic 삭제를 보장하지 않는다.

## 검증 및 후속 의존성

root에서 `npm ci --ignore-scripts --prefix tools/mobile-ar-poc` 후 Sync 디렉터리에서:

```powershell
npm run test:service-tls
npm run test:https-e2e
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b2e/2026-11-02/node'
npm run verify:local
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b2e/2026-11-02/mobile-browser'
npm run test:mobile-browser
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b2e/2026-11-02/sync-browser'
npm run test:browser
```

별도로 mobile-ar-poc의 `npm run test:browser`는 `POC_EVIDENCE_DIR=C:/CarScope-External/qr-ar-01/ar-02b2e-2026-11-02`를 사용한다. Node 실제 TLS same-origin E2E와 브라우저 HTTP DOM 회귀를 구분한다. 브라우저에서 테스트 인증서를 무시하는 옵션을 추가하지 않았다. Node 전체 suite에 새 auth/service tests가 포함돼 기존 Linux/Windows CI에서 자동 실행된다. `check-boundary.py`는 새 Kotlin provider 7개 테스트와 Debug DEX/Release 제외를 검사한다. Android JVM/Robolectric/APK 빌드는 기존 CI에서 검증하며 로컬의 무거운 Gradle은 병렬 실행하지 않는다.

실행 결과와 실패 기록: [증거 인덱스](evidence/ar-02b2e/README.md).

남은 의존성은 실제 발급자·사용자/차량/앱 등록 근거와 adapter, 폐기 서비스 및 장애 정책, Android provisioning/refresh 구현, 배포 담당·접근 정책·DNS·정식 TLS·DB 운영/백업·로그 redaction 검토다. 실제 외부 배포·유료 인프라·AVD·adb 작업은 하지 않았다. **기기 네트워크, Android/휴대폰 TLS, 광학 QR, 실제 차량 인증은 NOT_RUN**이다.
