# P8-A2 History 인증 어댑터 및 차량 소유권 연동 경계

기준: `main` `2435087`(PR #75 병합), `C:/dev/CarScope-p8-auth`, `feat/p8-a2-history-auth`. Android·3D·모바일 AR 코드와 P8-A1 migration은 변경하지 않았다. AVD/adb를 사용하지 않았다.

**운영 인증은 완료되지 않았다.** 이번 변경은 실제 authority를 연결할 수 있는 경계와 실패 차단 검증이다. 배포된 Render 경로는 계속 403 DENY_DEFAULT이며, 실제 issuer·차량 소유권 근거가 제공되기 전에는 활성화할 수 없다.

## 판정

| 상태 | 의미 | 범위 |
|---|---|---|
| `HISTORY_AUTH_ADAPTER_IMPLEMENTED` | `/history/*` HTTPS 어댑터와 Render 주입 경계 구현 | 코드 구현만. 어떤 운영 진입점에도 연결하지 않음 |
| `HISTORY_AUTH_CONTRACT_VERIFIED` | 합성 authority + 실제 TLS + 실제 PostgreSQL에서 실패 차단 계약 검증 | 합성 소유자·차량. 실제 소유권 증명이 아님 |
| `HISTORY_PRODUCTION_ISSUER_BLOCKED` | 신뢰 issuer, 등록/소유권 근거, 폐기 서비스, 관리 credential 부재 | 아래 차단 조건 충족 전까지 유지 |
| `HISTORY_DEVICE_E2E_NOT_RUN` | 실제 스마트폰/Native/실차 경로 미실행 | 이번 작업에서 기기·에뮬레이터 미사용 |

## 기존 코드 조사 결과

| 대상 | 판단 |
|---|---|
| `VerifiedHistoryReadAuthorizer` | 재사용. 정확한 claim/binding, 전용 scope, TTL 5분, 시간 재검증, 예외·timeout 거부가 이미 구현됨. 공개 필드로 의존성을 교체할 수 있어 private으로 변경 |
| `VerifiedSessionCreationAuthorizer` | 변경 없음. 세션에 캡처하는 바인딩은 생성 시점 증거이며 조회 권한이 아님 |
| `HttpsCreationAuthority` | 전송 코드만 `AuthorityTransport`로 분리해 공유. 라우트와 외부 동작은 그대로 |
| `server.mjs` 조회 경로 | 변경 없음. DB 조회 전후 재검증과 주체 비교를 그대로 사용 |
| `render-stateful.mjs` | History authorizer 주입 경로와 edge TLS 인증 경로가 없었음. 코드 전용 설정 추가 |
| `startHttpsMobileService` | 연결하지 않음. SQLite 경로에는 영구 History가 없음 |

저장소에는 OAuth/OIDC/JWKS 의존성·설정, 사용자·차량 등록 저장소, 폐기 서비스가 없다. 조사한 Pleos 연동 문서에도 사용자나 차량 소유권을 증명하는 API 기록이 없다. AVD 시뮬레이터 레지스트리는 실제 소유권이 아니므로 대안이 될 수 없다. 따라서 issuer·등록 서버·credential 발급기를 만들지 않았다.

## 구현 경계

```text
Bearer -> VerifiedHistoryReadAuthorizer (scope/TTL/시각/결합 최종 판정)
            -> HttpsHistoryAuthority -> AuthorityTransport (고정 origin, TLS, 응답 상한)
               POST /history/verify        {token}
               POST /history/registration  {issuer,subject,registrationId}
               POST /history/active        {issuer,credentialId,registrationId}
```

- 라우트를 `/creation/*`와 분리해 authority와 서비스 credential이 생성과 조회를 구분할 수 있게 했다. 호출에는 별도 서비스 credential을 사용하며 호출자 bearer를 Authorization으로 전달하지 않는다.
- 응답 형식과 요청/응답 필드는 [계약](contracts/p8-inspection-history-v1.md)의 인증 어댑터 절을 따른다. 일반 OAuth/OIDC 제공자와 바로 호환된다고 주장하지 않으며, 실제 제공자에는 별도 검토한 서버 측 변환이 필요하다.
- `startRenderStateful({historyAuthority})`는 검토된 bootstrap 코드만 호출할 수 있다. CLI, 환경변수, 공개 요청으로 선택하는 경로는 없다. 임의 authorizer 객체 주입은 `AUTHORIZER_OVERRIDE_FORBIDDEN`으로 거부한다.
- 이 설정을 넣어도 세션 생성은 계속 거부된다. 따라서 어댑터만으로는 새 `VERIFIED_VEHICLE` 기록이 Render에 생기지 않으며, 생성 authorizer 연결은 별도 승인 과제다.
- AVD 시뮬레이션과 History authority를 한 프로세스에서 함께 켜면 시작 시 거부한다. 시뮬레이션 credential이 실제 소유권 authority로 전달되는 구성을 막기 위해서다.

## 테스트 credential 차단

`assertHistoryAuthorizerDeployable`은 다음을 시작 시 거부한다. `testOnly` 표시 또는 예약 issuer(`.invalid`, `.test`, `.example`, `.localhost`, `example.com/net/org`, loopback)이면서, 비-loopback bind이거나 `RENDER=true`/`NODE_ENV=production`인 구성이다. 이 검사는 잘못된 구성을 막을 뿐이다. **통과가 issuer의 신뢰성을 뜻하지 않는다.** 표시 없이 예약되지 않은 도메인을 쓰는 가짜 authority는 코드로 판별할 수 없고, 운영자 검토가 필요하다.

## 의도적 한계

- **재사용 방지 범위:** 만료·폐기·회전된 credential, 다른 scope 토큰, QR receiver 토큰의 재사용을 차단한다. 유효 기간(최대 5분) 안의 같은 bearer 재사용은 허용한다. 한 조회가 DB 전후로 두 번 검증하고 목록 페이지도 이어서 호출하므로 일회용으로 소모할 수 없다. 탈취 대응은 짧은 TTL과 즉시 폐기, 그리고 authority의 폐기 반영 속도에 달려 있다.
- **응답 경계:** 마지막 재검증 뒤 응답이 전송되는 사이에 폐기되면 그 응답은 막지 못한다. 세 조회는 별도 HTTP 호출이라 원자적 스냅샷도 아니다.
- **소유권 변경:** 저장된 기록의 소유자를 바꾸지 않는다. 판매자는 등록 폐기 후 조회가 거부되고, 구매자에게 기록이 이전되지 않는다. 소유권 변경 사실의 판단은 authority 책임이다.
- **credential 발급:** 구현하지 않았다. Native의 read credential 획득·갱신은 `app/**` 범위이며 issuer가 필요해 후속 과제다.
- **동시성 검증:** 정해진 경합 지점을 재현하는 검사이며 모든 interleaving의 증명이 아니다.

## 운영 활성화 차단 조건

| 항목 | 상태 | 필요한 근거 |
|---|---|---|
| 신뢰 issuer·audience·authority origin | BLOCKED | 승인된 제공자, 서명/introspection 검증, 정규화 계층 |
| 사용자·차량 등록 및 소유권 근거 | BLOCKED | `ownershipVerified`의 실제 근거(OEM 또는 동등한 증명), VIN이 아닌 opaque ID 정책 |
| 폐기 서비스 | BLOCKED | credential/등록/소유권 이전 폐기, 반영 지연 SLA, 장애 정책 |
| 서비스 관리 credential | BLOCKED | secret provider, 최소 권한, 회전. 생성용과 분리 |
| 운영 bootstrap·생성 authorizer | BLOCKED | 검토된 진입점, Render 설정 변경 승인, 생성 경로 연결 |
| Native read credential | BLOCKED | 로그인/등록 proof, 발급·갱신·폐기 신호 |
| 운영 DB migration·보존 정책 | NOT_RUN | P8-A1 기존 조건. 이번 작업에서 운영 DB 접근 없음 |
| 실제 기기·실차 E2E | NOT_RUN | 위 조건 충족 후 별도 작업 |

## 재현

```powershell
Set-Location tools/inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
npm run check
npm test
node --test test/history-auth.test.mjs
# loopback 격리 PostgreSQL 전용. 공유·운영 DB에서 실행 금지.
$env:PG_TEST_URL='<loopback 격리 PostgreSQL URL>'
node --test test/history-auth-postgres.test.mjs
```

`PG_TEST_URL`이 없으면 PG 항목은 skip이며 PASS로 세지 않는다. CI는 `postgres-store-ci.yml`의 postgres:16 임시 서비스에서 같은 파일을 실행한다. 결과는 [증거 인덱스](evidence/p8-history-auth/README.md)에 기록한다.
