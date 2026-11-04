# 모바일 결과 → 3D 세션 연결 계약 v1 (설계)

> P7-C1 후속: 17개 매핑과 별도 모바일 후보/선택 소비자는 [Native→3D ACCEPTED 계약 v1](native-to-3d-accepted-v1.md)에서 구현한다. 아래 7개 설계 표는 당시 기준으로 보존한다. 실제 Native 전달 경로는 여전히 미완료이며 일반 JSON 주입 경로를 추가하지 않는다.

P5-A5, 기준 main fdffd96. **설계 계약이며 수신/적용 구현은 아직 없다.** 아래 JSON은 계약 메타데이터이며 실제 수신 결과가 아니다. 3D UI는 이를 import하지 않으며 임의 JSON, URL fragment, postMessage, 전역 함수, localStorage로 모바일 결과를 주입하는 경로를 제공하지 않는다.

## 현재 경계와 선택

현재 모바일 결과는 `tools/mobile-ar-poc/public/inspection-result.mjs` (워셔액 v1), `checklist-result.mjs`와 각 task validator (v2)가 정의한다. Sync는 `tools/inspection-sync-poc/src/protocol.mjs`/`sessions.mjs`, Native는 `SyncHttpDecoder`/`SyncReceiverClient`가 별도로 검증한다. 3D는 `tire-inspection.mjs`의 화면 내 직접 입력만 읽는다. Native/Node에서 수락한 결과가 자동으로 3D에 도착한다는 계약은 없다.

| 선택지 | 이점 | 비용/위험 | 결정 |
|---|---|---|---|
| mobile JSON을 기존 tire row로 덮어쓰기 | 코드가 작음 | sessionId/출처/원본 digest 손실, 로컬 응답 덮어쓰기, 미수신 주입 가능 | 제외 |
| 3D가 Sync 서버를 직접 polling | 브라우저에서 직접 연결 | 인증/TLS/토큰/수명주기 경계 변경 필요, 이번 제약 밖 | 제외 |
| 검증된 수신 소유자 → 명시적 세션 binding → 별도 모바일 기록 → 사용자 선택 → 공통 상태 projection | 원본과 로컬 기록을 보존, SDK 분리, 기존 전송 계약 유지 | 수신 소유자 전달과 binding API를 후속 구현해야 함 | 채택한 후속 구조, 현재 비활성 |

실제 수신/검증을 소유하는 host가 생기기 전에는 마지막 구조의 입구도 만들지 않는다. 현재 PR은 UX와 설계/계약 일치 검사만 구현한다. 아래 trust gate는 단순 boolean 필드나 클라이언트가 주장한 ACCEPTED 문자열로 대체할 수 없다.

## ID와 시각

| 필드 | 소유자·의미 | 규칙 |
|---|---|---|
| inspectionId | 모바일 결과의 시도 UUID v4 | 원본 그대로. 재전송은 동일 ID/동일 digest, 다시 점검은 새 ID. SDK나 차량 식별자가 아님 |
| taskId | 원본 결과·Sync 생성/초대/claim/receiver view | 모두 정확히 일치. 선택 중인 3D 부품에서 역추정하지 않음 |
| sessionId | 3D 페이지가 만든 로컬 세션 ID (`userInspection.sessionId`) | 결과 본문에는 없음. host가 현재 화면에서 캡처한 opaque ID이며 외부 입력으로 교체하지 않음 |
| syncSessionId | Sync receiver view의 sessionId | 위 로컬 sessionId와 다른 namespace. 원본 view의 이름은 바꾸지 않고 binding 안에서 구분. QR에는 추가하지 않음 |
| bindingId / generation | 향후 수신 소유자가 발급한 연결 인스턴스·수명 세대 | 하나의 로컬 sessionId와 syncSessionId/taskId/partId를 고정. 종료/재생성/취소 시 무효화하고 지연 콜백 거절 |
| source / confirmation | 원본은 MOBILE / USER_REPORTED | 두 의미를 합치지 않음. 기존 로컬 row의 source=USER_REPORTED와 이름이 같아도 모바일 원본 source를 덮어쓰지 않음 |
| startedAt / completedAt | 원본 폰 시각, UTC ISO | 타입·실재 날짜·시작≤완료 엄격 검증. 표시 시 ‘사용자 확정 시각’. SDK 관측·수신 시각으로 바꾸지 않음 |
| receivedAt / acceptedAt | 검증된 수신 소유자의 서버 view/proof 시각 | 원본 폰 시각과 별개. 이를 가지고 폰의 시계 정확성·실제 점검 시점·차량 일치를 보증하지 않음 |
| expiresAt | 기존 Sync 세션의 서버 deadline | 기존 전송 정책 유지. 3D binding deadline은 이를 넘기지 않고 host가 monotonic 잔여 시간으로 관리 |

폰 시각은 서버와 clock domain이 다르므로 `completedAt`만으로 현재 세션 소속/최신 기록을 정하지 않는다. 오프셋을 임의 보정하거나 현재 시각으로 교체하지 않는다. 시계 신뢰가 필요한 제품 흐름은 별도 검증 후 제공한다. v1 validator의 문자열 강제 변환/날짜 정규식만으로 향후 경계를 통과시켜서는 안 된다. 후속 boundary는 문자열 타입·Date.parse 유한성·실제 날짜 round-trip을 추가 확인해야 한다. v1의 초 단위 또는 밀리초 단위 UTC 표기는 허용하되 원문을 유지한다. v2는 기존 밀리초 UTC 형식을 따른다.

## 정확한 task와 의미 매핑

현재 활성 3D 결과 producer는 로컬 타이어뿐이다. 아래 표는 **후속 수신 연결의 대상 정의**이며 활성 지원 목록이 아니다. schema v1/v2, QR v1/v2, inspection-sync protocolVersion=1은 서로 다른 버전 축이다.

<!-- mobile-3d-contract:v1 -->
```json
{
  "proposalVersion": 1,
  "integrationState": "DESIGN_ONLY_NO_INGRESS",
  "taskBindings": [
    {"taskId":"washer-fluid","schemaVersion":1,"partId":"washer-fluid-cap","responseKeys":[]},
    {"taskId":"tire.front-left","schemaVersion":2,"partId":"tire.front-left","responseKeys":["damage","debris","wear"]},
    {"taskId":"tire.front-right","schemaVersion":2,"partId":"tire.front-right","responseKeys":["damage","debris","wear"]},
    {"taskId":"tire.rear-left","schemaVersion":2,"partId":"tire.rear-left","responseKeys":["damage","debris","wear"]},
    {"taskId":"tire.rear-right","schemaVersion":2,"partId":"tire.rear-right","responseKeys":["damage","debris","wear"]},
    {"taskId":"ev-charge.port","schemaVersion":2,"partId":"ev-charge.port","responseKeys":["flapDamage","debris","visibleDamage"]},
    {"taskId":"brake-fluid","schemaVersion":2,"partId":"brake-fluid-reservoir","responseKeys":["levelMarking","leakTrace","exteriorDamage"]}
  ],
  "statusMap": {
    "1":{"OK":"NO_FINDINGS_REPORTED","NEEDS_REFILL":"FINDINGS_REPORTED","UNSURE":"UNABLE"},
    "2":{"NO_FINDINGS_REPORTED":"NO_FINDINGS_REPORTED","REVIEW_NEEDED":"FINDINGS_REPORTED","UNABLE":"UNABLE"}
  },
  "applicationPrerequisites":["TRUSTED_RECEIVER","LIVE_BINDING","EXACT_TASK","STRICT_RESULT","MATCHING_DIGEST","EXPLICIT_ACCEPTED_PROOF","USER_SELECTS_RECORD"]
}
```

워셔액 OK는 기존 wire 이름을 보존하되 3D에는 ‘발견 사항 없음’으로 표시하며 ‘정상’으로 번역하지 않는다. v1은 세 질문별 응답을 담지 않으므로 v2 responses를 만들지 않는다. v2 FOUND > UNABLE > 모두 NOT_FOUND 집계를 재검증하고 원래 개별 응답을 모두 보존한다. 잘못된/미수신/부분 결과는 UNABLE로 바꾸지 않고 **지도 미적용**이다. UNABLE은 사용자가 확정한 응답의 의미다.

충전구 결과 한 건을 port와 flap 두 부품의 완료로 복제하지 않는다. binding은 port 한 건이며 후속 flap 상세에서 참조할 수 있어도 완료 수는 하나다. brake-fluid는 SDK safety.brake-fluid-level과 별개다. 타이어 ID의 앞/뒤·좌/우를 바꾸지 않는다. 와이퍼·조명은 현재 모바일 schema가 없으므로 위 목록에서 제외한다. 다른 부품을 preview했다고 결과를 만들지 않는다.

## 수신부터 적용까지 (후속 설계)

1. 사용자가 현재 3D 세션에서 요청할 task/part를 선택한다. 신뢰할 수 있는 수신 소유자가 기존 방식으로 Sync 세션을 만들고, 양쪽 세션을 메모리 binding에 묶는다. 로컬 sessionId·차량/계정 정보·토큰을 결과나 QR에 추가하지 않는다. 현재 로컬 QR v1은 task hint만 있으므로 binding/수신 증거가 아니다.
2. 수신 소유자는 기존 역할·토큰·인증/TLS 경계를 그대로 지킨다. 생성/claim/view의 task, 세션 ID/deadline, schema별 정확한 필드/enum/시간·상태를 검증한다. JSON 붙여넣기·테스트 fixture를 trusted receiver로 간주하지 않는다.
3. result 원문을 보존하며 기존 canonicalJson의 재귀 key 정렬 SHA-256을 재계산한다. v1/v2 원문 시각 문자열이나 sync=NOT_SENT를 고쳐 digest를 맞추지 않는다. inspectionId·taskId·digest와 RESULT_SUBMITTED가 일치해도 아직 지도에는 적용하지 않는다.
4. 기존 수신기의 명시적 동일 digest 수락과 검증된 ACCEPTED proof를 확인한다. proof는 binding의 syncSessionId/taskId, 결과 inspectionId/digest와 묶여야 한다. 현재 receipt에는 sessionId/taskId가 없으므로 receipt 단독으로 연결하지 않는다. Native SyncReceiverView에는 receivedAt/acceptedAt가 보존되지 않으므로 후속 host adapter가 필요한 proof/시간을 어떻게 제공할지 먼저 구현·검증해야 한다. 이번에 Native 모델을 바꾸지 않는다.
5. host의 staging 후보에 원본을 보관한다. 정규화 metadata는 `sessionId`, `syncSessionId`, `bindingId`, `generation`, `inspectionId`, `taskId`, `partId`, `wireSource:MOBILE`, `reportKind:USER_REPORTED`, `origin:MOBILE_RECEIVER`, 원문 completedAt 및 proof를 각각 보존한다. 이 구조는 현재 tire row의 fields/source 형태를 재사용해 속이지 않는다.
6. 사용자가 출처·질문/결과·확정 시각을 보고 이 세션에서 표시할 기록을 명시적으로 선택한다. 별도 mobileRecords에 보관하고 `activeRecordRef[partId]`로 표시 대상을 고른다. 기존 local tire row와 draft를 덮어쓰거나 질문별로 섞지 않는다. 기본값은 기존 로컬 기록이며 후보 수신만으로 바뀌지 않는다. 동시 수신/수정은 세대와 원자적 precondition을 다시 확인한다.
7. 공통 projection은 선택된 **하나의** 검증된 기록에서 네 상태·출처·원래 확정 시각을 계산한다. SDK store는 입력으로 받지 않는다. 종료/새로고침/dispose는 binding·후보·적용 기록·중복 index를 함께 버린다. 영구 저장/복구는 별도 과제다.

## 중복·충돌·만료 규칙

| 상황 | 후속 adapter의 필수 동작 |
|---|---|
| 같은 로컬 세션, 같은 inspectionId/taskId/digest | idempotent no-op. 시각·출처·응답·완료 수를 갱신하지 않음 |
| 같은 inspectionId, 다른 task 또는 digest | CONFLICT. 후보/적용 모두 거절하고 기존 기록 보존. UUID만 같다고 덮어쓰지 않음 |
| 같은 결과가 다른 Sync 세션으로 다시 도착 | 현재 로컬 세션의 중복 index에서 no-op. 최초 proof/수신 시각을 보존하며 새 기록으로 세지 않음 |
| 다른 inspectionId, 같은 part | 별도 후보. 사용자의 명시적 교체 선택 전까지 현재 기록/draft 유지. 폰 completedAt의 최신순으로 자동 교체하지 않음 |
| 다른/종료된 3D sessionId, 무효 generation, 취소 binding | 지연 콜백 즉시 거절. 새로운 세션에 재연결하지 않음 |
| now가 binding/Sync deadline을 초과, CANCELLED/EXPIRED, 결과 삭제/누락 | 새 적용 불가. 기존 전송의 `>` deadline 경계를 유지하고 SDK STALE 5000ms와 연결하지 않음 |
| 이미 적용한 ACCEPTED 기록 이후 전송 세션 만료/서버 retention purge | 현재 페이지의 사용자 기록은 종료까지 유지. 자동 UNABLE/STALE/미점검으로 변환하지 않음. 재수신/복원 성공으로 표시하지 않음 |
| 적용 전 서버에서 result가 purge됨, digest만 있음 | 원문 없는 완료 기록을 합성하지 않음. 새 QR/실제 결과 재수신 필요 |
| 로컬 세션의 정확한 duplicate가 deadline 뒤에 재등장 | 기존 적용 여부 확인만 하는 no-op 가능. 신규 적용·다른 binding 재활성화·timestamp 갱신은 불가 |
| schema/task 미지원, 인증·네트워크·검증 오류 | 지도는 기존 상태 유지. 새 결과 없음과 사용자 UNABLE을 구분 |

서버의 기존 기본 초대 10분·세션 30분·수락 결과 retention 10분은 설명을 위한 현재 값이며 변경하지 않는다. 적용 기록의 유효성/재점검 주기를 이 TTL에서 추정하지 않는다. 서버가 수락했더라도 현재 차량/세션과 점검 대상의 실질적 일치는 자동 증명되지 않으며, host의 binding/사용자 선택/제품 검증이 남아 있다.

## 후속 구현 완료 조건

- 실제 receiver 소유자와 허용 origin/호출 주체가 검증된 전달 경로, create 시점 binding, 현재 페이지/차량 문맥·종료/generation 격리.
- schema v1/v2 strict boundary, 전체7 task 정확 매핑, v1 OK 문구 안전성, unknown/배열/추가 필드/실재하지 않는 날짜·부분 결과 거절.
- 동일 canonical digest와 명시 수락 proof, 수신/확정 시각 보존, 현재 Native 모델의 proof 전달 조건 구현.
- 중복·내용 충돌·교차 task/세션·교체 선택·동시 수정·타임아웃·만료/취소·purge·지연 콜백 회귀.
- 로컬 기록과 모바일 기록 별도 보존/사용자 선택 UI, SDK polling·관측 시각/STALE 불변.
- 실제 폰→실제 수신기→해당 3D 세션→선택→요약까지 E2E. Node 수신·Native 수신·합성 UI 검사를 이 E2E로 부르지 않음.

P5-A5의 계약 일치 테스트는 문서의 task/응답/status 매핑을 기존 모바일 생산 코드와 대조할 뿐이며, 이 후속 수신 검증/적용 정책의 실행 구현이나 보안 증거가 아니다.
