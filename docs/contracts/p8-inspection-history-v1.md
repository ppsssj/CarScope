# P8-A1 Inspection History API / Native 연동 계약 v1

## 적용 범위와 공개 상태

PostgreSQL 경로에서 새로 명시적 Accept된 사용자 점검만 보존한다. 기존 QR/Sync/result schema와 17-task allowlist는 변경하지 않는다. History DTO의 `schemaVersion: 1`과 원본 점검의 `schemaVersion: 1 | 2`는 별도 버전이다.

**운영 Render 라우트는 DENY_DEFAULT(403)** 이다. 현재 설치된 issuer/차량 소유권 등록/폐기 확인 연동이 없으므로 실제 차량 소유자 조회를 활성화하지 않는다. QR receiverToken, 생성용 credential, AVD credential은 조회 권한이 아니다. 환경변수만으로 켜는 우회도 제공하지 않는다.

별도 경로 `/simulator/inspection-records`는 이 계약의 소유자 조회가 아니다. 기본 CLI는 열지 않고 별도 진입점의 Debug AVD 시연에서만 열리며, 범위는 enrollment proof의 등록 하나이다. [P9-H1](../p9-h1-inspection-history-read.md), [P9-H2](../p9-h2-avd-history-activation.md).

내부 `HistoryService({store})`와 `VerifiedHistoryReadAuthorizer`가 조회 계약을 제공한다. 서버는 DB 조회 전후에 권한을 확인한다. DTO에는 credential, 원본 QR, VIN, 이미지, 위치, 내부 사용자/차량/등록 식별자를 반환하지 않는다. 클라이언트의 userId/vehicleId/헤더로 조회 범위를 지정할 수 없다.

## 인증 어댑터 선행 조건

향후 서비스 구성자가 신뢰 가능한 아래 인터페이스를 구현하고 별도 검증한 뒤 `historyAuthorizer`를 주입해야 한다. 현재 CLI/Render는 이 주입을 하지 않는다.

- `credentialVerifier.verify({token,signal})`: 신뢰 issuer가 서명/발급한 opaque credential을 검증해 정확한 정규화 claim을 반환한다.
- `registrationProvider.resolve({issuer,subject,registrationId,signal})`: 현재 활성 사용자·차량·기기 등록과 **실제 ownershipVerified**를 서버 측에서 검증한다. vehicleId 등은 VIN이 아닌 내부 opaque 식별자여야 한다.
- `revocations.isActive({issuer,credentialId,registrationId,signal})`: credential과 등록의 현재 폐기 상태를 확인한다.

claim의 정확한 필드는 `active, issuer, audience, subject, scope, issuedAt, notBefore, expiresAt, credentialId, registrationId`이다. `scope`는 **`["inspection:history:read"]`** 만 허용한다. 발급~만료는 최대 5분, issuer/audience 일치와 현재 유효성을 검사한다. 등록 반환 필드는 `issuer, subject, registrationId, userId, vehicleId, deviceId, active, ownershipVerified, expiresAt`이다. 누락/추가 필드, 연결 장애, timeout(기본 1500ms), 폐기, 만료, 소유권 미검증은 모두 거부하며 성공 캐시가 없다. `secure: true`는 실제 TLS 또는 기존 검증된 managed-edge 경로만 부여한다. 임의 X-Forwarded-Proto를 신뢰하지 않는다.

생성 권한은 기존 **`inspection:session:create`** 계약을 그대로 사용한다. 생성 시 검증된 바인딩만 세션에 캡처한다. 바인딩은 **생성 시점 증거**이며 Accept 시 운전자/OEM 재인증의 증거가 아니다. History 조회는 새로 현재 소유권을 검증하고 namespace + issuer + userId + vehicleId 모두로 SQL을 제한한다. 기기/등록이 갱신돼도 같은 사용자·차량의 기록은 조회할 수 있다. 소유자 변경 시 과거 소유자 기록을 새 소유자에게 이전하지 않는다.

### P8-A2 HTTPS 어댑터 경계

`httpsHistoryAuthorizer`는 위 세 인터페이스를 고정 HTTPS authority의 아래 경로에 연결한다. 실제 authority는 연결되어 있지 않으며(`HISTORY_PRODUCTION_ISSUER_BLOCKED`), 합성 fixture 검증은 실제 소유권 증명이 아니다. [설계와 차단 조건](../p8-a2-history-auth.md).

| 고정 경로 | 요청 JSON | 200 응답 |
|---|---|---|
| `POST /history/verify` | `{token}` | 위 claim 10개 필드 또는 null |
| `POST /history/registration` | `{issuer,subject,registrationId}` | 위 등록 9개 필드 또는 null |
| `POST /history/active` | `{issuer,credentialId,registrationId}` | 정확히 `{"active":true}`일 때만 활성 |

호출은 별도 서비스 관리 credential을 Authorization에 사용한다. 호출자 bearer는 verify 본문으로만 전달하며 TLS(`secure:true`) 요청에서만 전달한다. verify는 credential을 소모하지 않아야 한다(요청당 DB 전후 2회 검증). HTTP 200, JSON content type, 16KiB 상한, 중복 키 거부, redirect 거부를 적용하고 그 외 응답은 거부로 처리한다. Render는 `startRenderStateful({historyAuthority})`를 코드로 호출한 경우에만 이 어댑터를 쓰며 CLI·환경변수 경로는 없다.

## 목록

```http
GET /v1/inspection-records?limit=20&taskId=brake-fluid
Authorization: Bearer <별도 history-read credential>
```

| Query | 규칙 |
|---|---|
| limit | 기본 20, 1~100 정수 |
| cursor | 이전 페이지 `page.nextCursor`; opaque 문자열로 취급 |
| taskId | 기존 17개 exact taskId 중 하나 |
| partId | 아래 partId 매핑 중 하나 |
| status | OK, NEEDS_REFILL, UNSURE, REVIEW_NEEDED, UNABLE, NO_FINDINGS_REPORTED |
| from / to | canonical UTC ISO millisecond 시각; completedAt 기준 `[from,to)` |

중복/알 수 없는 query는 400이다. 필터는 AND이며 날짜 범위는 from < to여야 한다. 최신 **점검 완료 시각(completedAt)** 내림차순, 동률 recordId 내림차순이다. 서버 수신/수락 시각순이 아니다. cursor는 사용자·차량·issuer·필터와 결합하며 인증을 대신하지 않는다. cursor 재사용 시 필터를 유지한다. 페이지 조회 중 더 최신 기록이 추가되면 첫 페이지를 새로 조회해야 보인다. 전체 count는 제공하지 않는다.

```json
{
  "schemaVersion": 1,
  "items": [{
    "recordId": "12345678-1234-4234-8234-123456789abc",
    "inspectionId": "22345678-1234-4234-8234-123456789abc",
    "taskId": "brake-fluid",
    "partId": "brake-fluid-reservoir",
    "schemaVersion": 2,
    "inspectionStatus": "UNABLE",
    "resultDigest": "sha256:<64 lowercase hex>",
    "completedAt": 1793779200000,
    "receivedAt": 1793779201000,
    "acceptedAt": 1793779202000,
    "createdAt": 1793779202001,
    "source": "USER_REPORTED",
    "method": "SELF",
    "channel": "MOBILE",
    "authorityNamespace": "VERIFIED_VEHICLE",
    "ownershipEvidence": "SESSION_CREATION_BINDING",
    "sdkDataIncluded": false
  }],
  "page": {"limit": 20, "hasMore": false, "nextCursor": null}
}
```

DTO 시각은 epoch milliseconds이다. originalResult의 startedAt/completedAt은 기존 ISO 문자열을 유지한다. `createdAt`은 archive DB 쓰기 시각, `acceptedAt`은 Native 명시적 수락의 서버 시각이다. 사용자 completedAt은 사용자 보고이며 서버의 신뢰 시계로 간주하지 않는다.

## 상세

```http
GET /v1/inspection-records/:recordId
Authorization: Bearer <별도 history-read credential>
```

`{"schemaVersion":1,"record":{...목록항목,"responses":{...},"originalResult":{...}}}`를 반환한다. `originalResult`는 기존 strict result JSON 전체이며 canonical digest를 다시 검증한다. 전송/수락 이후에도 원본 `sync: "NOT_SENT"` 값을 수정하지 않는다. v1 워셔액에는 questions/responses가 없으므로 `responses: {}`이며 결과는 originalResult.status로 표시한다. v2 질문 응답은 기존 task 계약을 따른다. 질문 문구는 task 메타데이터를 사용하고 응답 키를 임의 번역/변환하지 않는다.

| taskId | partId | 원본 schema |
|---|---|---|
| washer-fluid | washer-fluid-cap | 1 |
| brake-fluid | brake-fluid-reservoir | 2 |
| tire.front-left / tire.front-right / tire.rear-left / tire.rear-right | taskId와 동일 | 2 |
| ev-charge.port | taskId와 동일 | 2 |
| coolant-reservoir / lcw-coolant-reservoir / battery-12v / fuse-box | taskId와 동일 | 2 |
| wiper.front.left / wiper.front.right | taskId와 동일 | 2 |
| light-low-beam-left-0 / light-low-beam-right-0 / light-high-beam-left-0 / light-high-beam-right-0 | taskId와 동일 | 2 |

## 오류와 UI 처리

응답 오류는 기존 `{"error":{"code":"..."}}` 형식이다. 400 BAD_REQUEST(필터/ID/cursor), 403 FORBIDDEN(미설정·인증·권한), 404 NOT_FOUND(없는 기록 또는 다른 소유자), 409 CONFLICT(Accept의 동일 inspectionId 다른 digest/owner), 429 RATE_LIMITED, 500 INTERNAL(DB/원본 무결성 실패)을 구분한다. API 응답은 no-store이다.

Codex B는 403을 빈 기록 목록이나 인증 성공으로 표시하지 않는다. 목록 선택 후 recordId로 상세 조회하고 page.nextCursor를 그대로 전달한다. `NO_FINDINGS_REPORTED`를 안전/정상 판정으로 바꾸지 않는다. `source: USER_REPORTED` 및 `sdkDataIncluded:false`를 유지하고 Pleos SDK 관측값·STALE 시각과 합치지 않는다. Native Accept 성공 응답은 기존 형식이며 recordId 추가는 없다. 목록 갱신으로 기록을 찾는다. Memory/SQLite 실행에는 영구 History 보장이 없다.

클라이언트 소비자는 [P8-B1 UI](../p8-b1-inspection-history-ui.md)에 있다. 이 절의 지침을 구현하며 read provider가 없어 운영 조회는 BLOCKED다.

추가 task/schema는 기존 protocol 검증, migration task/part/schema 제약, fixtures/테스트를 함께 확장해야 한다. DTO v1은 이 17개 task만 지원한다.
