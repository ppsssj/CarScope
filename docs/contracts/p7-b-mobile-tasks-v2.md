# P7-B 추가 모바일 점검 계약 — Codex A 인계

기존 7개 task/schema/인증 계약을 그대로 두고 10개 task를 **추가**한다. 이 문서는 모바일/Node 구현의 정확한 wire 계약이다. Native Kotlin 구현·SDK adapter·3D 수락 결과 적용은 이 PR에 없다. Codex A는 아래 task allowlist·엄격한 schema v2 decoder·수락 화면을 구현한 뒤 자체 검증해야 한다. 기존 [모바일→3D 설계 v1](mobile-result-to-3d-session-v1.md)은 수정하지 않으며 신규 task의 3D 적용 완료를 뜻하지 않는다.

기존 task: `washer-fluid` schema 1, `tire.front-left`, `tire.front-right`, `tire.rear-left`, `tire.rear-right`, `ev-charge.port`, `brake-fluid` schema 2. 신규 task는 기존 모델의 선택 ID와 정확히 같다. `coolant`, `lcw`, `12v`, `wiper.front`, `light.low-beam` 같은 별칭·SDK feature는 허용하지 않는다. 캡·덮개·좌우·상하향에 응답을 복제하지 않는다.

<!-- p7-b-task-contract -->
```json
{
  "extensionVersion": 1,
  "nativeIntegration": "NOT_IMPLEMENTED_IN_THIS_PR",
  "tasks": [
    {"taskId":"coolant-reservoir","schemaVersion":2,"partId":"coolant-reservoir","responseKeys":["levelMarking","leakTrace","exteriorDamage"]},
    {"taskId":"lcw-coolant-reservoir","schemaVersion":2,"partId":"lcw-coolant-reservoir","responseKeys":["levelMarking","leakTrace","exteriorDamage"]},
    {"taskId":"battery-12v","schemaVersion":2,"partId":"battery-12v","responseKeys":["caseDamage","leakTrace","visibleCorrosion"]},
    {"taskId":"fuse-box","schemaVersion":2,"partId":"fuse-box","responseKeys":["coverDamage","visibleContamination","heatDamage"]},
    {"taskId":"wiper.front.left","schemaVersion":2,"partId":"wiper.front.left","responseKeys":["bladeDamage","visibleDebris","armDamage"]},
    {"taskId":"wiper.front.right","schemaVersion":2,"partId":"wiper.front.right","responseKeys":["bladeDamage","visibleDebris","armDamage"]},
    {"taskId":"light-low-beam-left-0","schemaVersion":2,"partId":"light-low-beam-left-0","responseKeys":["lensDamage","obstruction","visibleMoisture"]},
    {"taskId":"light-low-beam-right-0","schemaVersion":2,"partId":"light-low-beam-right-0","responseKeys":["lensDamage","obstruction","visibleMoisture"]},
    {"taskId":"light-high-beam-left-0","schemaVersion":2,"partId":"light-high-beam-left-0","responseKeys":["lensDamage","obstruction","visibleMoisture"]},
    {"taskId":"light-high-beam-right-0","schemaVersion":2,"partId":"light-high-beam-right-0","responseKeys":["lensDamage","obstruction","visibleMoisture"]}
  ]
}
```

`partId`와 `responseKeys`는 인계 메타데이터이며 결과 JSON에 새로 넣지 않는다. `extra-tasks.mjs`와 위 표의 정확한 일치를 Node 테스트가 검사한다. 기존 모델의 LCW는 예약/미구현 형상일 수 있지만 모바일 수동 점검은 설명서·실차 표기를 대조해 진행할 수 있다. 실차에 없거나 구분 불가하면 UNABLE이다. 3D 선택·QR 발급 연결은 별도 소유자가 이 표를 사용한다.

## schema v2

기존 `checklist-result.mjs`를 재사용한다. 완료 결과의 키는 정확히 다음 13개이며, 각 task의 세 response key와 aids의 두 key도 정확한 집합이어야 한다.

```json
{
  "schemaVersion": 2,
  "inspectionId": "12345678-1234-4234-8234-123456789abc",
  "taskId": "battery-12v",
  "method": "SELF",
  "source": "MOBILE",
  "state": "COMPLETED",
  "startedAt": "2026-11-04T08:00:00.000Z",
  "aids": {"cameraUsed": true, "locationMarked": true},
  "responses": {"caseDamage": "NOT_FOUND", "leakTrace": "UNABLE", "visibleCorrosion": "UNABLE"},
  "status": "UNABLE",
  "confirmation": "USER_REPORTED",
  "completedAt": "2026-11-04T08:02:00.000Z",
  "sync": "NOT_SENT"
}
```

정확한 enum은 `FOUND`, `NOT_FOUND`, `UNABLE`. 집계는 하나라도 FOUND → `REVIEW_NEEDED`, 그 외 하나라도 UNABLE → `UNABLE`, 모두 NOT_FOUND → `NO_FINDINGS_REPORTED`. 마지막 상태는 관찰 범위 내 발견 보고 없음이며 정상·안전 판정이 아니다. 사진·위치 좌표·VIN·진단·센서값·전압·액면 수치·객체 인식 점수는 금지한다. `cameraUsed`/`locationMarked`는 이번 시도에서 사용한 적이 있다는 booleans이며 현재 카메라/표시 활성 여부가 아니다.

부분 응답은 완료/전송할 수 없다. UNKNOWN·누락·잘못된 enum을 UNABLE로 자동 보정하지 않는다. UUID v4 문자열, 실제 달력 날짜로 round-trip되는 UTC 밀리초 ISO 문자열, `completedAt >= startedAt`, 모든 고정값·키·타입·집계를 재검증한다. 추가 필드·배열에 의한 문자열 강제 변환·다른 task를 거부한다. 같은 response key를 쓰는 일반/LCW 냉각수도 **세션의 exact taskId와 다르면 거부**한다.

## QR·전송·수락

QR은 기존 `#v=2&task=<exact-taskId>&invite=<43자 base64url>` 세 key만 허용한다. 로컬 `#task=<id>`는 점검 선택 힌트이며 인증/세션이 아니다. QR v1은 washer-fluid만 지원한다. 기존 `SyncClient`, `MobileSync`, 세션 생성 인증, 1회 claim, 역할별 토큰, 만료/취소, rate limit, 영수증 검증, idempotency·충돌·명시적 accept 정책을 그대로 사용한다.

봉투는 `{protocol:"inspection-sync",protocolVersion:1,result:<원문>}`. canonical JSON의 재귀 key 정렬 SHA-256 및 inspectionId를 대조한 영수증 후에만 SENT, 같은 digest의 수신자 명시적 수락 확인 후에만 ACCEPTED다. 전송 후에도 원문 `sync=NOT_SENT`를 바꾸지 않는다. 수신자 accept는 사용자 보고 수락이며 차량 정상 판정이 아니다. Native 지원이 없으면 명시적으로 미지원으로 처리하고 다른 task로 대체하지 않는다.

## Codex A 재현·수락 기준

- 실제 실행 가능한 정상/오류 예시는 `tools/inspection-sync-poc/test/extra-e2e.test.mjs`, 27가지 응답 조합은 `tools/mobile-ar-poc/test/extra-inspection.test.mjs`에 있다. fixture UUID·시각은 테스트용이며 실차 증거가 아니다.
- 각 task의 QR 생성 → claim → schema 검증 → digest/영수증 확인 → 수신 화면의 정확한 질문/응답 → 명시적 수락을 Native에서 검증한다. 좌우·LCW·상하향 응답을 공유하지 않는다.
- wrong task/schema/key/enum·부분 결과·추가 media field·잘못된 digest를 거부하고, 동일 재전송은 같은 receipt, 다른 결과는 conflict, 취소/만료 후 제출은 거부한다.
- 이 PR의 Node receiver ACCEPTED와 실제 Android/차량 앱 ACCEPTED는 서로 다른 증거다. Native와 실제 폰 결과는 별도로 PASS/NOT_RUN을 기록한다.
