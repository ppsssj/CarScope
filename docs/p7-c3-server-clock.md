# P7-C3 서버 시각 계약 구현

[P7-C2 시각 계약](contracts/p7-c2-server-clock-proposal.md)의 서버 쪽을 구현했다. 인증된 `POST /v1/sessions` 응답에 `serverNow` 한 필드를 추가했다. 서버 코드 변경은 `tools/inspection-sync-poc/src/sessions.mjs` 하나다. 인증 정책, DB schema, QR, 토큰, 만료 정책, Android·3D 구현, Render 설정은 바꾸지 않았다.

## 상태

| 표식 | 상태 | 의미 |
|---|---|---|
| `SERVER_CLOCK_CONTRACT_IMPLEMENTED` | PASS | 서버 코드가 계약대로 `serverNow`를 반환한다. |
| `SERVER_CLOCK_CONTRACT_VERIFIED` | PASS (범위 한정) | 아래 검증 표의 범위에 한정한다. 실제 PostgreSQL은 CI job 결과에 따른다. |
| `RENDER_SERVER_CLOCK_NOT_DEPLOYED` | NOT_RUN | Render에 배포하지 않았다. 배포 서버의 응답은 달라지지 않았고 실제 ACCEPTED는 여전히 `SERVER_CLOCK_UNAVAILABLE`에서 멈춘다. |
| `NATIVE_3D_DEVICE_E2E_NOT_RUN` | NOT_RUN | AVD·스마트폰·실차를 실행하지 않았다. |

## 동작

- `serverNow`는 세션 서비스의 `now()`를 저장 **후** 읽는다. `expiresAt`, `receivedAt`, `acceptedAt`과 같은 시계다. HTTP `Date`, 클라이언트 시각, TTL 역산을 쓰지 않으며 DB에 저장하지 않는다.
- 저장 전 검사: `createdAt`과 두 만료 시각이 0 이상 8.64e15 이하의 안전한 정수이고 `createdAt < inviteExpiresAt <= expiresAt`일 것. 위반하면 저장과 토큰 발급 없이 500 `INTERNAL`.
- 저장 후 검사: `serverNow`가 같은 범위의 정수이고 `createdAt <= serverNow < inviteExpiresAt`일 것. 위반하면 토큰을 반환하지 않고 500 `INTERNAL`. 값을 보정하지 않는다. 이미 저장된 행은 토큰이 전달되지 않았으므로 쓸 수 없고, 응답이 유실된 세션처럼 만료된다.
- 인증 거부, 다른 경로의 응답, 오류 응답에는 시각이 없다.

`sessionTtlMs`만 줄이던 테스트 fixture 3개(`durable`, `mobile-ui`, `race`)는 `inviteExpiresAt > expiresAt`을 만들었고, 이 값은 Native decoder가 이미 거부한다. 같은 값의 `inviteTtlMs`를 함께 주도록 고쳤다. 이 경우 만료는 항상 `expiresAt`이 먼저 판정하므로 해당 테스트의 동작은 같다. 운영 경로는 기본값(10분/30분)을 쓴다.

## 검증

실행일 2026-11-04, Windows 10, Node 22.16.0, 기준 main `09f3490`. 원본 로그는 Git 밖 `C:\carscope-external\p7-c3\`에 있다.

| 범위 | 결과 | 명령·근거 |
|---|---|---|
| Memory, SQLite 생성 응답과 시각 도메인 | PASS | `test/server-clock.test.mjs` |
| 경계값, 역행, 만료, 비정수·범위 초과 시각, 뒤집힌 TTL | PASS | 같은 파일 |
| 실제 TLS: 17개 task, 인증 거부, 다른 경로, HTTP `Date`와 독립, 로그에 토큰 없음 | PASS | 같은 파일. 시계를 2033년으로 주입했다 |
| 실제 HTTPS 서비스 구성(SQLite, 검증 authorizer, 폐기) | PASS | 같은 파일 |
| Sync 전체 | PASS: Node 140 PASS / 5 SKIP(`PG_TEST_URL` 없음), legacy 48건, SQLite 21건 | `npm run check`, `npm run test:legacy`, `npm test`, `npm run test:sqlite` |
| 실제 Kotlin decoder ↔ 실제 Node HTTPS 서버 | PASS: 집중 실행 31건 실패 0 (`HttpsSyncReceiverTransportTest`, `SyncHttpDecoderTest`, `NativeInspectionBridgeTest`). Android 전체는 CI | `HttpsSyncReceiverTransportTest`. `created.serverNow`와 `created.clock`을 실제 응답으로 단언한다(테스트 한 줄 추가, Android 구현 무변경) |
| 변형 검사 | PASS: 7개 모두 검출 (`createdAt` 사용, `Date.now`, TTL 역산, 역행 검사 제거, 경계 off-by-one, TTL 순서 검사 제거, 필드 제거) | `sessions.mjs`를 일시 변형해 테스트가 잡는지 확인한 뒤 복원 |
| 실제 PostgreSQL 16 생성 응답 | 로컬 NOT_RUN, CI 참조 | `postgres-store.test.mjs` 신규 subtest. `postgres-integration` job이 실행한다 |
| Render, AVD, 스마트폰 | NOT_RUN | 범위 밖 |

로컬 PostgreSQL을 실행하지 못한 이유: 설치본이 없고 Docker daemon이 꺼져 있었다. 다른 작업의 임시 바이너리를 잠시 빌려 격리 인스턴스를 띄웠으나 실행 중 그 바이너리가 삭제되어 연결이 끊겼다(`ECONNRESET`, 코드 무관). 이 실행은 근거로 쓰지 않는다.

이 검증은 Android 전체 흐름이나 실제 ACCEPTED의 3D 전달을 증명하지 않는다. 합성 authority와 주입 시계를 사용했다.

## 배포 순서

**Debug APK를 먼저 갱신한 뒤 서버를 배포한다.** P7-C2 이전 decoder(`2435087`까지)는 생성 응답 키를 정확히 비교해 추가 필드를 거부한다. 구버전 APK가 새 서버에 연결하면 세션 생성이 `INVALID`로 실패한다. P7-C2 이후 decoder는 두 응답을 모두 받으므로 이 순서에서는 호환이 깨지지 않는다.

Render 자동 배포는 [운영 문서](p6-d2-postgres-store.md)상 꺼져 있어야 하지만 실제 설정은 이번에 확인하지 않았다. 병합 전에 대시보드에서 확인한다. 구버전 APK가 남아 있는데 자동 배포가 켜져 있으면 병합만으로 위 실패가 발생한다.

배포 후 확인:

1. 인증된 생성 응답에 정수 `serverNow`가 있고 `serverNow < inviteExpiresAt <= expiresAt`인지 확인한다. 토큰은 기록하지 않는다.
2. `serverNow`가 응답 수신 시각과 수 초 안에서 일치하는지 확인한다.
3. 새 세션으로 아래 AVD 항목을 수행한다.

## 남은 위험

- **시계 보장은 미해결이다.** `now()`의 기본값은 `Date.now`인 wall clock이라 NTP 보정이나 재시작으로 움직일 수 있고, 계약의 ‘세션 중 역행·점프 없음’을 코드로 보장하지 않는다. `create` 안의 역행만 감지한다. 세션 도중 역행하면 `receivedAt`이 binding 하한보다 앞서 거부되고, 앞으로 크게 뛰면 Native의 만료 검사에 걸린다. 큰 점프는 모두 전달 거부 쪽으로 실패하지만, 상한 안의 작은 어긋남은 탐지하지 못한다. Render 시계의 실제 안정성은 측정하지 않았다.
- **빠른 제출의 거짓 거부.** `serverNow + RTT + 4000ms`보다 이른 `receivedAt`은 거부한다. QR 스캔과 점검 시간을 고려하면 드문 경우로 보이지만 실측하지 않았다.
- 저장 후 검사가 실패하면 쓸 수 없는 행이 만료까지 남아 세션 용량을 차지한다. 응답 유실과 같은 기존 특성이다.

## WebView Referer 정적 분석

P7-C2가 가장 큰 미검증 위험으로 남긴 항목이다. 코드를 바꾸지 않고 분석했고, 기기 검증을 대신하지 않는다.

**결론: 실제 WebView가 Referer를 노출할 가능성이 높다. 위험을 ‘높음’에서 ‘낮음, AVD 확인 필요’로 낮춘다.** 근거의 한계는 업스트림 Chromium 소스라는 점이다. 실제 AVD WebView는 Pleos 포크 패키지 `ai.pleos.android.webview 131.0.6752.0`이며, 포크의 변경 여부는 확인할 수 없다.

| 단계 | 근거 | 판단 |
|---|---|---|
| 페이지가 Referer를 보낸다 | `android-native-inspection-adapter.mjs:13` `referrerPolicy:'same-origin'`, 같은 origin 요청. 저장소 HTML에 이를 막는 meta가 없고 자산 응답에 `Referrer-Policy`가 없다 | fragment를 뺀 전체 문서 URL이 `request.referrer`가 된다 |
| WebView가 헤더로 복사한다 | Chromium `aw_proxying_url_loader_factory.cc`: `shouldInterceptRequest` 호출 직전에 유효한 referrer를 `Referer` 헤더에 설정한다. 131.0.6752.0 태그와 main 모두 확인, 2019-02 커밋 `593261e` 이후 유지 | 인터셉트 전에 헤더가 존재한다 |
| Java API로 전달된다 | `aw_web_resource_request.cc`: `request.headers`를 그대로 변환한다 | `getRequestHeaders()`에 포함된다 |
| Chromium이 테스트한다 | `AwContentsClientShouldInterceptRequestTest.testCalledWithCorrectRefererHeader` (131 태그에도 존재). 하위 리소스 요청에 페이지 URL이 Referer로 온다 | 의도된 동작이다. 단 테스트는 `<img>`이고 `fetch`가 아니다 |
| 앱 검사를 통과한다 | `NativeInspectionOrigin.pageAllowed`는 scheme, authority, path `/index.html`, fragment 없음만 본다. 쿼리는 허용하고 헤더 이름은 대소문자를 구분하지 않는다. `isForMainFrame`은 `fetch`에서 false다(destination이 document가 아님) | Referer `https://carscope-inspection.invalid/index.html?<query>`가 통과한다 |
| CSP | `connect-src 'self'` (`lab-assets.mjs:10`) | 같은 origin `fetch`를 허용한다 |

정적으로 확정할 수 없는 부분:

1. Android API 문서는 Referer 포함을 계약하지 않는다. 구현 동작에 의존한다.
2. Pleos 포크의 변경 여부, `fetch` 경로의 실제 헤더.
3. **`currentPage` 경합.** `currentPage`는 UI 스레드의 `onPageStarted`에서 설정되고 RPC는 백그라운드 스레드에서 검사한다. 첫 RPC가 먼저 도착하면 404가 된다. 모듈 로드와 사용자 세션 시작 뒤에 호출되므로 드물겠지만, 어댑터의 `open`이 실패하면 그 세션은 `UNAVAILABLE`로 남는다.

## AVD 검증 항목 (NOT_RUN)

APK를 P7-C2 이후 빌드로 설치하고 배포된 서버를 쓴다.

| 순서 | 확인 | 합격 기준 | 실패 시 의미 |
|---|---|---|---|
| 1 | 3D 페이지에서 Native 세션 시작 | 어댑터 `open`/`poll` 200, 연결 상태가 `UNAVAILABLE`이 아님 | 404면 Referer 또는 `currentPage` 문제. 채널이 동작하지 않고 잘못된 전달은 없다 |
| 2 | DevTools에서 RPC 요청 | `Referer`가 `https://carscope-inspection.invalid/index.html?...` | 포크가 헤더를 바꿨을 가능성 |
| 3 | 페이지 로드 직후 반복 실행 | 첫 RPC가 404가 되지 않음 | `currentPage` 경합 |
| 4 | 부품 요청 → 세션 생성 | `SERVER_CLOCK_UNAVAILABLE`이 사라지고 binding 생성 | 서버 미배포 또는 RTT 5000ms 초과 |
| 5 | QR → 제출 → Native Accept → 3D 후보 → 사용자 선택 | `receivedAt`/`acceptedAt`이 서버 값 그대로 표시 | 시각 상한 또는 proof 경로 문제 |
| 6 | 취소, 만료, 화면 종료, 회전, renderer 종료 | 권한 폐기, 늦은 결과 미전달 | 수명주기 경계 문제 |
