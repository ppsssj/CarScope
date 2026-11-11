# P10 History UX 최종 보완

PR #118 이후 남은 History 문제 두 가지를 고쳤다. History UI와 이동 상태 전이만 바꿨다. 결과는 [증거 인덱스](evidence/p10-history/README.md)에 있다. **데스크톱 Chrome 측정이며 AVD, Android WebView, 실제 손가락 터치, 스마트폰, 실차는 `NOT_RUN`이다.**

## History에서 연 부품 결과의 뒤로 가기

| 경로 | 이전 | 이후 |
|---|---|---|
| History 목록 → 이번 점검의 부품 결과 → 뒤로 | 차량 점검 개요 | **같은 History 목록** (필터·불러온 페이지·스크롤·초점 유지, 다시 조회하지 않음) |
| History 상세 → 이번 점검의 부품 결과 → 뒤로 | 차량 점검 개요 | **같은 기록의 상세** (상세 데이터 유지) |
| 위에서 돌아온 History → 뒤로 | — | History 상세 → 목록 → History를 연 화면(기존 규칙) |
| 이번 점검의 부품 결과(History에서 연 것) → 과거 기록 보기 | 새 History를 하나 더 엶 | 같은 History로 돌아감(중첩 없음) |

구현(`inspection-flow.mjs`):
- History의 `OPEN_RESULT`가 만드는 결과 화면의 `back`은 그 History 화면(`historyPoint`)이다. History 화면에는 자기 진입 경로만 들어가고 결과 화면은 들어가지 않으므로 History와 결과를 몇 번 오가도 상태가 커지지 않는다. 진입 경로는 기존 `returnPoint`로 `BACK_DEPTH` 안에서 잘린다.
- 보닛 부품 결과에서 돌아갈 때는 기존 `HOOD_CLOSING`의 `resume`이 History 화면으로 끝난다. 카메라와 보닛은 History를 연 화면 기준으로 돌아간다.
- `historyHeld(state)`: History 화면, History에서 연 결과 화면, History로 돌아가며 보닛을 닫는 중인 상태. 이 동안 `inspect.js`는 History 저장소를 닫지 않는다(필터·페이지·상세 유지, 새 요청 없음). 다른 화면(요약, 다른 부위, 종료)으로 가면 기존대로 닫고 기록을 지운다. 화면 숨김·일시 중지 시 기록을 지우는 기존 규칙은 그대로다.
- 패널 `뒤로`, 상단 바, Escape, Android Back은 같은 `BACK` 하나를 쓴다.

`history-session-part`의 의미는 바꾸지 않았다. 이 버튼은 **이번 점검**의 부품 결과(17개 투영)를 연다. 과거 기록을 현재 결과로 바꾸거나 합치지 않는다. 버튼 문구를 "이번 점검의 이 부품 결과 보기", 구역 이름을 "이번 점검 · 이 화면"으로 바꿔 PR #118의 결과 화면과 같은 말을 쓴다.

## History 문구

| 위치 | 이전 | 이후 |
|---|---|---|
| 목록 카드 | `USER_REPORTED · 스마트폰 자가 점검`, `taskId washer-fluid` | `스마트폰으로 사용자가 직접 보고`. 워셔액은 자기 선택(`워셔액 보충 필요 보고` 등)을 함께 표시(배지가 다른 결과와 같으므로). `taskId`·`source`·원본 상태값은 카드의 `data-task`·`data-source`·`data-status` 속성 |
| 결과 필터 | `이상 징후 보고 (REVIEW_NEEDED)` | `이상 징후 보고`. 선택 값(`value`)은 그대로 |
| 상세 | `원본 상태값 NEEDS_REFILL`, `점검 항목 washer-fluid / washer-fluid-cap`, `데이터 출처 USER_REPORTED`, `SDK 관측` | 상태 문구, `점검 부품 워셔액`, `결과 출처 스마트폰으로 사용자가 직접 보고`, `차량 연동 데이터 포함하지 않음` |
| 상세 v1 | `사용자 선택: … (NEEDS_REFILL)`, `schema v1 워셔액 기록에는…` | `사용자 선택: 워셔액 보충 필요 보고`, `이 워셔액 기록은 질문별 응답 없이 하나의 선택으로 저장됩니다. 오류가 아닙니다.` |
| 원본 정보 | `원본 기록·무결성 정보` | `개발자 정보 · 원본 기록과 무결성`(접힘). `taskId / partId`, 원본 상태값, `source / method / channel`, SDK 포함 여부, recordId·inspectionId·digest·원본 JSON을 모두 보존 |

"스마트폰으로 사용자가 직접 보고"는 History 계약이 받는 유일한 출처 조합(`source=USER_REPORTED`, `method=SELF`, `channel=MOBILE`)을 그대로 옮긴 말이다. 다른 값은 계약 검증에서 거부되며, 만약 들어오면 "출처를 확인할 수 없음"으로 보이고 원본 값은 개발자 정보에 남는다.

서버 응답, History 계약·저장소·클라이언트, 필터·더 보기·로딩·실패·재시도·빈 결과 동작은 바꾸지 않았다.

## 바꾸지 않은 것

Android Native 인증·QR·수신, 모바일 Vision·Roboflow·GPT, Render, Supabase·DB, History 저장소·조회 API·계약, 모바일 결과 원본·검증, PR #117 라벨·선택·터치, PR #118 17개 요약·종료 확인, Pleos SDK.

## 남은 위험

- History 조회 경로는 여전히 연결되지 않았다(배포 페이지는 `UNAVAILABLE`). 목록·상세 검증은 테스트 컨텍스트의 데모 provider로만 했다.
- History에서 연 결과를 보는 동안 불러온 과거 기록이 메모리에 남는다(돌아왔을 때 다시 조회하지 않기 위해). 다른 화면으로 가거나 화면이 숨겨지면 기존처럼 지운다.
- AVD·Android WebView의 실제 Back 키는 NOT_RUN.
