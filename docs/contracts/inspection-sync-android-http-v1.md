# Inspection sync Android HTTP adapter v1

기존 [inspection-sync-v1](inspection-sync-v1.md)의 wire protocol을 변경하지 않는다. Kotlin Debug adapter가 아래 응답을 엄격하게 검증한다. 서버 응답에 존재하지 않는 최상위 schema 필드를 새로 요구하지 않는다. 결과 schemaVersion은 정확히 숫자 1이다.

## HTTPS와 실행

API/mobile 주소는 HTTPS root origin, credential/userinfo/query/fragment 없음, 유효 port만 허용한다. API 경로와 UUID는 코드에서 구성한다. 인증 정보는 Authorization Bearer header로만 전송한다. Android 기본 HttpsURLConnection의 CA/hostname 검증을 유지한다. trust-all, hostname verifier 교체, 전역 TLS 변경, cleartext 허용은 없다.

IO는 소유한 2-thread executor에서 실행한다. 대기 queue는 8개, connect timeout 5초/read timeout 8초다. 필수 callback dispatcher를 Activity가 main Handler로 제공한다. cancellation은 disconnect와 future cancel을 수행하며 close/cancel 후 callback을 억제한다. 자동 쓰기 재시도/redirect는 없다. read timeout은 전체 작업 deadline을 보장하지 않는다.

request/response는 각각 최대 16KiB, response는 선언 Content-Length와 스트리밍 누적 길이 양쪽을 검사한다. `application/json` 또는 UTF-8 charset만 허용한다. 압축 Content-Encoding은 거부한다. 3xx는 HTTPS 내 이동과 HTTP downgrade 모두 거부한다. 로그/예외에 URL payload, credential, 원문 body/cause를 남기지 않고 정규화한 실패 enum만 전달한다.

## API

| 호출 | 요청 | 성공 |
| --- | --- | --- |
| POST /v1/sessions | 생성 credential, `{taskId: washer-fluid}` | 201, 정확히 sessionId/taskId/receiverToken/inviteToken/inviteExpiresAt/expiresAt |
| GET /v1/sessions/:id | receiver credential | 200, 정확히 sessionId/taskId/sessionState/expiresAt/result/resultDigest/receivedAt/acceptedAt |
| POST /v1/sessions/:id/accept | receiver credential, resultDigest | 200, 위 full view, 반드시 ACCEPTED |
| POST /v1/sessions/:id/cancel | receiver credential, body 없음 | 200, 정확히 sessionId/sessionState=CANCELLED |

Cancel의 minimal response를 임의로 full wire response로 바꾸지 않는다. adapter가 이전 create/view에서 기억한 해당 세션 expiry와 결합해 typed view를 만든다. 알려진 expiry가 없거나 id가 다르면 INVALID다. close 시 expiry cache를 폐기한다.

연결 확인은 고정 dummy UUID GET에 대한 strict 401 UNAUTHORIZED를 검증한다. 인증된 TLS 서버가 계약대로 응답한다는 뜻이며, 세션 생성 권한/차량 인증/서비스 운영 준비 증거가 아니다.

## Decoder 불변식

Streaming strict JSON은 duplicate/추가/누락 키, 배열, 잘못된 UTF-8, trailing JSON, 깊이 8 초과, lenient 문법을 거부한다. null/문자열/숫자/boolean을 변환하지 않는다. 시각 숫자는 0 이상 safe integer(2^53−1 이하) lexical 정수만 허용한다. UUID는 lowercase v4, token은 base64url 43자, digest는 `sha256:` + lowercase hex 64자다. 생성 토큰은 서로 달라야 하고 초대 expiry > 0 및 session expiry >= invite expiry다.

COMPLETED 결과는 기존 allow-list만 허용한다: schemaVersion=1, taskId=washer-fluid, method=SELF, source=MOBILE, state=COMPLETED, confirmation=USER_REPORTED, sync=NOT_SENT, inspectionId, startedAt/completedAt, status, aids.cameraUsed/locationMarked. ISO UTC 시각/순서와 boolean을 검증한다. 원본 result.sync를 변경하지 않는다. Kotlin canonical digest를 재계산해 서버 digest와 비교하며 기존 Node golden vector 및 실제 Node HTTPS 왕복으로 상호운용을 검증한다.

CREATED/CLAIMED에는 result/digest/receivedAt/acceptedAt이 없다. RESULT_SUBMITTED에는 result/digest/receivedAt이 필요하고 acceptedAt은 없다. ACCEPTED는 digest/receivedAt/acceptedAt이 필요하며 acceptedAt >= receivedAt이다. 보존 기한 후 ACCEPTED result=null은 허용한다. CANCELLED는 result/digest/acceptedAt이 없다. EXPIRED는 result/acceptedAt이 없으며 digest/receivedAt의 존재가 일치해야 한다. Client도 요청한 id, result, digest와 상태를 검증한 후 수락을 허용한다.

## 오류

오류는 정확히 `{error:{code}}`이며 HTTP status/code 조합도 검사한다. 401/403/404는 UNAUTHORIZED로 최소화하고 410 EXPIRED, 429 RATE_LIMITED, 409 CONFLICT 또는 CLOSED/INVALID, 500/503 SERVER로 정규화한다. 지원하지 않는 조합, malformed JSON/Content-Type, digest 불일치는 INVALID다. SocketTimeoutException은 TIMEOUT, TLS/연결 실패는 NETWORK다. 원문 예외나 body를 UI에 전달하지 않는다.

생성 credential 공급자는 별도 인터페이스이며 기본값 null이다. 실제 인증이 없는 일반 Debug APK에서 세션 생성을 허용하지 않는다. 이 계약은 실제 차량 소유권 인증을 정의하지 않는다.
