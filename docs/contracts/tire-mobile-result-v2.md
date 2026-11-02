# 타이어 모바일 결과 schema v2 · Codex B 수신 연결 명세

P5-A1의 **제안이자 JavaScript 구현 계약**. Android Native 변경/실제 두 기기 검증은 포함하지 않는다. 기존 [inspection-sync v1](inspection-sync-v1.md) 인증·전송·영수증 계약을 그대로 사용한다.

## 작업과 버전 분기

| taskId | 결과 validator | 의미 |
|---|---|---|
| `washer-fluid` | 기존 schemaVersion 1 `validateResult()` | 기존 워셔액 결과, 필드/상태 변경 없음 |
| `tire.front-left` | schemaVersion 2 `validateTireResult()` | 앞 왼쪽 타이어 사용자 육안 응답 |
| `tire.front-right` | 위와 같음 | 앞 오른쪽 |
| `tire.rear-left` | 위와 같음 | 뒤 왼쪽 |
| `tire.rear-right` | 위와 같음 | 뒤 오른쪽 |

좌우는 운전석 착석 후 전방을 보는 차량 기준. taskId는 내부 점검 ID이며 SDK 센서 ID가 아니다. `wiper.front` 등 다른 작업은 지원하지 않는다.

Envelope는 정확히 `{ protocol: 'inspection-sync', protocolVersion: 1, result }`. **결과 schema v2와 QR v2/전송 protocolVersion 1은 별개**다. 기존 QR `#v=1&task=washer-fluid` 유지. Pairing은 기존 `#v=2&task=<정확한 ID>&invite=<43자 base64url 토큰>`으로 세 키를 한 번씩만 허용한다. 작업 힌트 `#task=<tire ID>`는 인증/페어링이 아니다.

## 완료 결과

아래는 합성 예시이며 개인정보·실제 관측값이 아니다.

```json
{
  "schemaVersion": 2,
  "inspectionId": "11111111-1111-4111-8111-111111111111",
  "taskId": "tire.front-left",
  "method": "SELF",
  "source": "MOBILE",
  "state": "COMPLETED",
  "startedAt": "2026-11-03T00:00:00.000Z",
  "aids": { "cameraUsed": true, "locationMarked": true },
  "responses": { "damage": "NOT_FOUND", "debris": "FOUND", "wear": "UNABLE" },
  "status": "REVIEW_NEEDED",
  "confirmation": "USER_REPORTED",
  "completedAt": "2026-11-03T00:02:00.000Z",
  "sync": "NOT_SENT"
}
```

상위 필드는 위 13개를 정확히 요구한다. `inspectionId`는 소문자 UUID v4. 시각은 실제 존재하는 UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, 완료 ≥ 시작. `aids`는 위 boolean 두 개만 허용하며 영상·위치의 정확성이나 객체 탐지 성공이 아니다. `responses`는 아래 세 키를 정확히 요구한다. 미응답/부분 결과/추가 키는 전송 거절이다.

| 키 | 대상 | 값 |
|---|---|---|
| `damage` | 눈에 띄는 균열·찢어짐·불룩함 등 | `FOUND` / `NOT_FOUND` / `UNABLE` |
| `debris` | 눈에 띄는 이물질 | 위와 같음 |
| `wear` | 고르지 않게 닳아 보이는 모습 | 위와 같음 |

`FOUND`: 사용자가 징후를 보았음. `NOT_FOUND`: 보이는 범위에서 발견하지 못함. `UNABLE`: 확인할 수 없음. 기존 차량 타이어 체크리스트 의미를 보존한다. `wear`는 홈 깊이/교체 기준/수명 측정이 아니다.

`status`는 세 응답에서 결정되며 별도 임의 판정을 허용하지 않는다.

1. `FOUND`가 하나라도 있으면 `REVIEW_NEEDED`.
2. 그 외 `UNABLE`이 하나라도 있으면 `UNABLE`.
3. 모두 `NOT_FOUND`일 때만 `NO_FINDINGS_REPORTED`.

발견/확인 불가가 동시에 있어도 개별 응답은 모두 보존한다. 어느 상태도 안전/정상/주행 가능 인증이 아니다. SDK 공기압·온도·관측 시각/STALE·기타 차량 데이터는 이 객체에 넣지 않는다. 추가 VIN/토큰/사진/영상/GPS/탭 좌표도 거절한다.

## 전송·수락과 멱등성

- 생성한 세션의 task = QR task = claim 응답 task = 결과 task를 강제한다. 작업 변경은 새 세션이 필요하다. 기본 `washer-fluid` 호출은 계속 유효하다.
- `canonicalJson(result)`의 객체 키를 **재귀적으로** 정렬한다. 새 `responses`와 기존 `aids`도 포함한다. `sha256:<64자리 소문자 hex>` 산출/검증은 기존 규칙 그대로다.
- 세션당 하나의 확정 결과. 같은 ID·동일 전체 결과 재전송은 같은 영수증, 다른 내용은 conflict. 확정/전송은 명시적 동작이며 자동 수락하지 않는다.
- 모바일 `SENT`: 해당 inspectionId + digest가 일치하는 서버 영수증 검증 후. 차량 `ACCEPTED`: 수신기의 명시적 동일 digest 수락과 일치하는 최종 영수증 확인 후. 결과 내부 `sync`는 계속 `NOT_SENT`.
- 역할/토큰/인증·세션 TTL·크기 제한·TLS/동일 출처·기본 생성 거절을 약화하지 않는다.

## Android 담당자의 후속 범위

기준 `5951b1d`의 아래 파일은 워셔액 고정이며 이번 PR에서 수정하지 않았다.

| 경계 | 필요한 후속 지원 |
|---|---|
| `HttpsSyncReceiverTransport` / 생성 호출 | 선택한 정확한 task를 전달. 임의 문자열 허용 대신 위 작업 목록으로 제한 |
| `SyncReceiverContract` / invite.fragment | task별 QR v2, schema v1/v2 결과 모델 분기. 새 완료 모델에 개별 응답 보존 |
| `SyncHttpDecoder` | 생성/상태 task 검증과 엄격한 schema v2 필드·enum·시간·계산 status 검증. 구버전은 명시적 unsupported/invalid 처리 |
| `SyncReceiverClient` | 세션의 기대 task와 모든 상태/결과 비교. 기존 monotonic/immutable/accepted proof 보존 |
| 결과 canonical 직렬화/수락 UI | nested responses digest 보존, 세 타이어 항목과 USER_REPORTED 명시, 기존 SDK 카드와 분리 |

회귀 기대값: 워셔액 schema v1 유지, 네 task별 QR/응답 검증, 교차 타이어/부분 응답/unknown field/잘못된 enum/status 거절, nested digest 일치·불일치, 동일 제출 멱등/다른 결과 conflict, 명시적 수락 전후 구분, 만료/취소/지연 응답. JS 측 `tools/inspection-sync-poc/test/tire-e2e.test.mjs`를 참고한다. Node 수신기 성공은 Native 구현/기기 capability 검증이 아니다.

모바일 재진입 복구·영구 이력·삭제 정책은 후속 설계다. 현재 모바일 메모리 정책과 기존 서버 세션 보존 정책을 유지한다. 실제 폰↔Android E2E는 Native 지원과 별도 안정화된 환경에서 수행한다.
