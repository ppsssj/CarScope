# EV 충전구 모바일 결과 schema v2 · Android Native 후속 계약

P5-A2 JavaScript 구현 계약. Android 구현·기기 수신 완료를 뜻하지 않는다. [Sync 전송 계약](inspection-sync-v1.md), [기존 타이어 계약](tire-mobile-result-v2.md)을 유지한다.

## 작업·스키마

- 정확한 task ID: **`ev-charge.port`**. 충전구와 덮개의 외부 육안 관찰을 하나의 작업으로 다룬다. `ev-charge.flap`은 독립 작업으로 허용하지 않는다.
- SDK feature `ev-charge.port-open` 또는 충전 상태/충전 가능 여부와 동일하지 않다. SDK raw data·관측 시각·STALE는 모바일 결과에 넣지 않는다.
- `schemaVersion: 2`, `method: SELF`, `source: MOBILE`, `confirmation: USER_REPORTED`.
- 워셔액은 기존 schema v1, 네 타이어는 기존 schema v2/`damage,debris,wear`를 유지한다. 같은 버전 번호여도 task별 정확한 키 집합을 검증한다.
- QR v1은 여전히 `#v=1&task=washer-fluid`만 허용한다. QR v2는 `#v=2&task=ev-charge.port&invite=<43자 base64url token>`, 정확히 세 키를 각각 한 번만 허용한다.
- 별도 로컬 힌트 `#task=ev-charge.port`는 인증·페어링이 아니다.

합성 완료 결과 예시:

```json
{
  "schemaVersion": 2,
  "inspectionId": "22222222-2222-4222-8222-222222222222",
  "taskId": "ev-charge.port",
  "method": "SELF",
  "source": "MOBILE",
  "state": "COMPLETED",
  "startedAt": "2026-11-03T00:00:00.000Z",
  "aids": { "cameraUsed": true, "locationMarked": true },
  "responses": { "flapDamage": "NOT_FOUND", "debris": "UNABLE", "visibleDamage": "FOUND" },
  "status": "REVIEW_NEEDED",
  "confirmation": "USER_REPORTED",
  "completedAt": "2026-11-03T00:02:00.000Z",
  "sync": "NOT_SENT"
}
```

상위 키는 위 13개로 엄격히 제한한다.

| 필드 | 검증 |
|---|---|
| `inspectionId` | 소문자 UUID v4 |
| `startedAt`, `completedAt` | 실제 존재하는 UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, 완료 ≥ 시작 |
| `aids` | 정확히 `cameraUsed`, `locationMarked` boolean. 성공한 객체 인식·실차 위치 증명이 아님 |
| `responses` | 정확히 `flapDamage`, `debris`, `visibleDamage` 세 키, 누락/추가 키 거절 |
| `state`, `sync` | 전송 시 `COMPLETED`, `NOT_SENT` 고정 |
| `status` | 아래 계산 정책과 정확히 일치 |

`flapDamage`: 덮개와 주변 외관의 눈에 띄는 손상. `debris`: 외부에서 보이는 이물질·오염. `visibleDamage`: 접근 없이 보이는 변형·변색 등 징후.

각 값은 정확히 `FOUND / NOT_FOUND / UNABLE`. 각각 사용자가 징후를 발견함 / 보이는 범위에서 발견하지 못함 / 확인할 수 없음을 뜻한다. 미응답을 `NOT_FOUND`나 `UNABLE`로 자동 변환하지 않는다.

집계: 하나라도 FOUND → `REVIEW_NEEDED`; FOUND 없이 UNABLE 존재 → `UNABLE`; 모두 NOT_FOUND → `NO_FINDINGS_REPORTED`. 정상·안전·충전 가능·고전압 시스템 인증이 아니다. 개별 응답을 집계 상태로 대체하지 않는다.

추가 top-level/nested 필드, 잘못된 enum·버전·task·시간·상태를 거절한다. 영상·사진·GPS·VIN·탭 좌표·SDK 값·토큰은 허용하지 않는다. 주차/충전 중 아님 확인과 관찰 중단 latch는 모바일 세션 UI 상태이며 결과 JSON 필드를 임의 추가하지 않는다. 안전 상태의 실측 증거로 해석하지 않는다.

## 전송·Digest·상태 전이

Envelope는 정확히 `{protocol:'inspection-sync', protocolVersion:1, result}`. 세션 생성 task = QR task = Claim 응답 task = 결과 task를 강제한다. 임의 task 수락이나 다른 작업으로 fallback하지 않는다.

`canonicalJson(result)`는 **중첩 객체까지 키를 재귀 정렬**한 공백 없는 JSON이다. `responses`의 세 키와 `aids`를 포함한 전체 결과에 SHA-256을 적용해 `sha256:<64자리 소문자 hex>`를 만든다. 동일 결과 재전송은 같은 영수증, 다른 유효 결과는 conflict이며 덮어쓰지 않는다. 최초 제출은 HTTP 201, 중복은 200이고 응답의 `duplicate`만 달라지며 영수증은 동일하다.

상태는 기존대로 `CREATED → CLAIMED → RESULT_SUBMITTED → ACCEPTED`; `CANCELLED / EXPIRED`는 terminal이다. 모바일은 사용자의 명시적 전송 동작 후 inspectionId/Digest가 일치하는 영수증을 검증해야 SENT를 표시한다. SENT는 서버 수신 확인이며 Native 수락 전이다. 수신기에서 동일 Digest를 명시적으로 수락한 최종 영수증을 검증해야 ACCEPTED를 표시한다. 결과 내부 `sync`는 계속 NOT_SENT다.

TLS·세션 TTL·토큰·역할 권한·deny-by-default 생성·redirect 차단·동일 출처·실패 처리는 기존 규칙을 유지한다. 영상/사진 업로드 경로를 추가하지 않는다.

## Kotlin 후속 모델·디코더 요구사항

아래는 **설계 예시**이며 이번 PR에서 app 파일에 추가하지 않는다. 실제 JSON 키/enum은 위 계약이 기준이다.

```kotlin
enum class ChargeAnswer { FOUND, NOT_FOUND, UNABLE }
enum class ChargeReportedStatus { REVIEW_NEEDED, UNABLE, NO_FINDINGS_REPORTED }
data class ChargeResponses(
    val flapDamage: ChargeAnswer,
    val debris: ChargeAnswer,
    val visibleDamage: ChargeAnswer,
)
// CompletedChargeInspection:
// schemaVersion=2, taskId="ev-charge.port", method="SELF", source="MOBILE",
// state="COMPLETED", confirmation="USER_REPORTED", sync="NOT_SENT";
// inspectionId, startedAt, completedAt, aids(cameraUsed,locationMarked),
// responses: ChargeResponses, status: ChargeReportedStatus.
```

Native 담당자는 다음 경계를 확장해야 한다.

1. 세션 생성/QR 생성에 선택한 정확한 task를 전달한다. 기존 워셔액 기본값은 보존하고 `ev-charge.flap`을 허용하지 않는다.
2. `SyncReceiverContract`의 완료 모델을 task별 엄격한 분기로 확장한다. 워셔액 v1, 타이어 v2, 충전구 v2의 필드 집합을 섞지 않는다.
3. `SyncHttpDecoder`에서 정확한 key set/UUID/시간/enum/계산 status/상수 필드를 검증한다. 알 수 없는 버전을 지원한 것으로 표시하지 않는다.
4. `SyncReceiverClient`의 기대 task·immutable result·monotonic state·accepted proof 검사를 보존한다. canonical 직렬화에 새 nested responses가 누락되면 안 된다.
5. 수신 화면에 부품명·세 응답·USER_REPORTED와 명시적 수락을 표시한다. SDK의 개방 보고를 점검 응답/충전 가능 판정으로 합치지 않는다.

기준 main의 Native 생성/QR/디코더는 워셔액/schema v1 고정이다. 충전구와 타이어 Native 수신은 **BLOCKED**인 후속 작업이며 이번 Node 수신기 검증과 별개다.

## 필수 후속 회귀

워셔액 v1 및 네 타이어 v2 보존, 충전구 정확한 task와 키 세트, flap 작업 거절, 부분/추가 필드/잘못된 enum·상태·시간 거절, 다른 task의 유효 결과 거절, 재귀 canonical/Digest 교차 검증, 동일 결과 멱등/다른 결과 conflict, 잘못된 영수증·수락 Digest 거절, 만료/취소/지연 응답, 명시적 전송/수락 단계 분리. JS 근거는 `test/charge-e2e.test.mjs`와 `test/charge-browser.mjs`다.

실제 Native 구현 후 폰↔Android 두 기기 E2E와 실제 폰의 권한/회전/백그라운드를 별도 실행해야 한다. 현재 모바일 메모리 보존 정책과 기존 서버 TTL/store 정책은 유지한다.
