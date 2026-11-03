# 브레이크액 모바일 결과 schema v2

P5-A3. 작업 ID는 정확히 `brake-fluid`이며 SDK 상태 키 `safety.brake-fluid-level`이나 3D 부품 ID `brake-fluid-reservoir`와 다르다. 이 작업은 센서값과 합치지 않는 사용자 외관 보고다.

공통 `checklist-result.mjs`를 사용한다. method SELF, source MOBILE, confirmation USER_REPORTED, sync NOT_SENT를 유지한다. 결과 내부의 sync는 서버 수신/수락 후에도 바뀌지 않는다. 전송 상태와 결과를 분리한다.

| 응답 키 | 의미 |
|---|---|
| levelMarking | 외부에서 함께 보이는 액면과 MIN·MAX 표시 범위의 이상 징후 |
| leakTrace | 리저버 주변의 보이는 누출 의심 흔적. 액체 종류·원인은 단정하지 않음 |
| exteriorDamage | 리저버·캡의 보이는 균열·변형·손상 흔적 |

각 값은 FOUND / NOT_FOUND / UNABLE 세 문자열 중 하나다. 가려짐·불투명·어두움·위치 불확실 등으로 확인할 수 없는 항목은 사용자가 UNABLE을 선택한다. 미응답을 자동 채우지 않는다. 모든 키에 응답하고 검토 후 명시적으로 확정해야 COMPLETED가 된다.

FOUND가 하나라도 있으면 REVIEW_NEEDED, 그렇지 않고 UNABLE이 있으면 UNABLE, 전부 NOT_FOUND이면 NO_FINDINGS_REPORTED다. NOT_FOUND는 보이는 범위의 보고이며 제동 성능·정상·안전·주행 가능 판정이 아니다. FOUND를 기록하면 관찰을 중단하고 카메라를 정리한다. 이후 응답을 수정해도 해당 시도에서 카메라 관찰을 재개하지 않는다.

합성 예시:

```json
{
  "schemaVersion": 2,
  "inspectionId": "22222222-2222-4222-8222-222222222222",
  "taskId": "brake-fluid",
  "method": "SELF",
  "source": "MOBILE",
  "state": "COMPLETED",
  "startedAt": "2026-11-03T00:00:00.000Z",
  "aids": {"cameraUsed": false, "locationMarked": false},
  "responses": {"levelMarking": "UNABLE", "leakTrace": "NOT_FOUND", "exteriorDamage": "NOT_FOUND"},
  "status": "UNABLE",
  "confirmation": "USER_REPORTED",
  "completedAt": "2026-11-03T00:01:00.000Z",
  "sync": "NOT_SENT"
}
```

UUID v4, 정확한 UTC ISO 시각과 순서, 상태·집계 일치, boolean aids, 정확한 필드·응답 키·문자열 enum을 검증한다. 임의 필드·사진·영상·GPS·VIN·탭 좌표·토큰·SDK 수치는 받지 않는다. 배열/객체의 문자열 강제 변환을 허용하지 않는다.

Node Sync는 기존 inspection-sync/protocolVersion 1, QR v2 `#v=2&task=brake-fluid&invite=<token>`을 사용한다. QR v1은 계속 washer-fluid만 허용한다. 로컬 `#task=brake-fluid`는 연결/인증 정보가 없는 작업 힌트다. 정렬된 canonical JSON SHA-256과 inspectionId를 확인한 영수증에 한해 SENT를 표시하며, Node receiver의 명시적 수락 후 ACCEPTED를 표시한다. 기대 task가 다른 세션·부분 결과·구버전 schema·잘못된 digest는 거절한다. 재전송 idempotency·충돌·취소·만료는 기존 정책을 따른다.

Android Native 브레이크액 수신은 이번 범위에서 구현/검증하지 않았다. PR #54의 타이어 수신을 이 작업의 수신 성공으로 해석하지 않는다. 후속 Native 작업은 이 정확한 task와 키, enum/시각/필드 검증, 동일 digest, 명시적 수락, task 격리를 구현한 뒤 두 기기 E2E를 별도 검증해야 한다. 브레이크액 QR을 타이어 작업으로 바꾸거나 schema v1으로 축소하지 않는다.
