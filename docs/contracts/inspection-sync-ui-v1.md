# Contract: inspection-sync UI v1

AR-02B-2A의 개발 모바일 UI 및 Android Debug 구성요소에 적용한다.
[inspection-sync-v1](inspection-sync-v1.md)의 wire payload/서버 상태 머신과 AR-01 schema v1은 유지한다.
transport/connection 상태를 record의 sync 필드에 덮어쓰지 않는다.

## 진입과 연결

v1 `#v=1&task=washer-fluid` 및 직접 방문은 기존 로컬 점검이다. v2는 정확히 v/task/invite 세 키를 한 번씩만 허용하는
기존 parser를 사용한다. v2/invalid fragment는 읽은 직후 지우며 query로 옮기지 않는다.
정적 진입점에서는 v2를 거부하고 API를 호출하지 않는다. 별도 loopback 개발 진입점만 v2를 연결한다.

invite는 한 페이지 인스턴스에 한 번만 Claim한다. 중복 버튼은 요청을 늘리지 않는다.
Claim 실패/응답 유실 후에는 새 QR 안내이며 재발급·자동 재Claim·storage 복원은 없다.
reload/pagehide/BFCache 복귀는 연결을 복원하지 않는다. 토큰은 DOM·storage·analytics·로그에 넣지 않는다.

## 표시 상태와 행동

| 상태 | 사용자 의미 | 동작 |
| --- | --- | --- |
| INVITED / CLAIMING / CLAIMED | 요청 수신 / 연결 중 / 연결됨 | 명시적 연결 1회, 완료 전 전송 불가 |
| NOT_SENT | 전송 안 됨 | 연결+COMPLETED일 때만 결과 전송 |
| SENDING | 전송 중 | 중복 전송 불가 |
| SENT | 서버 수신 확인·차량 수락 전 | 재전송 버튼 비활성, 상태 조회 |
| ACCEPTED | 차량 측 수락 완료 | 서버 조회+같은 record Receipt 검증, polling 중지 |
| CANCELLED | 차량 측 취소 | 전송·polling 중지, 새 QR |
| FAILED_NETWORK | 네트워크 오류, 5xx 포함 | 실패를 성공으로 표시하지 않음; 같은 결과만 제한 재시도 |
| FAILED_TIMEOUT | 요청 시간 초과 | 동일 |
| REJECTED_EXPIRED | 만료 | 새 QR, 기존 세션 재사용 금지 |
| REJECTED_CLOSED | 연결 종료/사용한 QR | 새 QR |
| REJECTED_CONFLICT | 다른 결과 충돌 | 덮어쓰기 금지, 새 QR |
| REJECTED_INVALID | 결과/응답 계약 불일치 | 성공 표시 금지 |
| REJECTED_UNAUTHORIZED | 인증 실패/잘못된 토큰 | 새 QR, Fake fallback 금지 |
| RATE_LIMITED | 요청 제한 | 자동 제출 반복 없음, 잠시 뒤 수동 재시도 |

SENT는 HTTP 2xx만으로 얻을 수 없다. 정확한 Receipt 6필드, protocol/version, inspectionId,
SHA-256 Digest, 유효한 receivedAt과 허용된 상태가 필요하다. 다른 record는 과거 Receipt를 재사용할 수 없다.
ACCEPTED는 서버 상태 조회가 확인해야 하며 해당 레코드의 Receipt도 맞아야 한다.
이미 Receipt를 확인한 뒤 통신이 실패하면 서버 수신 사실과 ‘최종 차량 처리 미확인’을 함께 설명한다.

모든 결과는 USER_REPORTED / SELF다. 차량 센서 진단·차량 소유권 인증·차량 안전 보증으로 표현하지 않는다.
서버 상태 RESULT_SUBMITTED와 ACCEPTED는 구분하고 CANCELLED/EXPIRED도 하나로 합치지 않는다.

## Android 표시 모델

ReceiverState는 토큰 없이 phase/result/digest/QR wrapper/작업 가능 여부를 제공한다.
QR payload에는 invite만 들어가며 receiver token이 들어가면 안 된다. QR wrapper와 credential의 toString은 REDACTED다.
RESULT_SUBMITTED에서 검증된 결과와 Digest를 표시한 뒤 사용자 동작으로만 accept한다.
accept/cancel이 진행 중일 때 중복 동작을 막고, 성공 응답의 상태와 표시한 Digest를 검증한다.
close/onStop 이후 콜백은 무효이며 token·QR·결과를 버린다. 새 소유자는 이전 세션을 자동 복구하지 않는다.
이번 단계에는 실제 Activity/HTTP decoder가 없으며, Fake transport 검증을 Runtime 증거로 취급하지 않는다.
