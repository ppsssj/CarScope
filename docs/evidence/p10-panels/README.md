# P10 통합 점검 패널 (PR #2) 증거 인덱스

[설계](../../p10-unified-inspection-panels.md). 원본(캡처, `results.json`, `measured.json`, `roles.json`, `labels.json`, 실행 로그)은 `C:/CarScope-External/p10/p10-panels/`에 있고 Git에 넣지 않았다.

환경: 기준 main `10a63be`(PR #117 병합), Windows 10, Node 22.16.0, 실제 참조 GLB(`hyundai_ioniq_5_2022.glb`), headless Chrome 157.0.8103.39. 화면 1600×1000, 1224×880, 1024×600, 420×860. QR handoff 출처는 접속하지 않는 `https://qr-test.invalid/`.

| 범위 | 판정 |
|---|---|
| Node 규칙 테스트, Android 자산 패키징, CI와 같은 DOM 브라우저 테스트 | 실행 |
| 데스크톱 Chrome, 실제 GLB 페이지 | 실행 |
| 모바일 결과 수신 | 스크립트 어댑터(`test/native-results-browser-fixture.mjs`). 실제 Native 아님 |
| AVD, Android WebView, 실제 손가락 터치, 스마트폰, 실차, 운영 서버 | **NOT_RUN** |
| GitHub CI | PR에서 확인 (PR 본문 참조) |

## 실행

| 실행 | 코드 | 결과 | 폴더 |
|---|---|---|---|
| Before 캡처 | main `10a63be` (원본 체크아웃을 읽기 전용으로 서빙, 포트 8198) | 캡처만(`CARSCOPE_PANELS_MODE=capture`), 검사 없음 | `before-main-10a63be/` |
| Before Known Issue 판정 | PR #117 최종 실행(같은 코드) | **기존 산출물** PASS, MATCH. FIXED 13, KNOWN_ISSUE 12, NOT_MEASURED 3 | `../p10-unified/run5-final-compare/` |
| 패널 검사 1회차 | 1차 구현 | PASS 32/32 | `after-run1/` |
| 기준선 1회차, 수정 미선언 | 1차 구현, P0-3·P1-7만 선언 | FAIL(의도): P1-10·P1-12·P2-2·P2-3·P2-5·P2-7 `FIXED_UNDECLARED`, 차이 489건 | `baseline-run1-undeclared/` |
| 기준선 2회차 | 6건 선언 | PASS, `WRITTEN` | `baseline-run2-write/` |
| 기준선 3회차 | 같은 코드 | PASS, MATCH | `baseline-run3-compare/` |
| 회귀 1차 | 같은 코드 | 라벨 PASS 172, 결과 PASS. 토스트·일관성·이력 FAIL(아래) | `regression/` |
| 수정 | 결과 화면의 출처 구역(이번 점검·과거 기록·SDK) 복원, 테스트 2건 수정 | — | — |
| 회귀 2차 | 최종 코드 | 토스트·일관성·이력 PASS | `regression/`, `regression2/` |
| 패널 검사, 최종 | 최종 코드 | **PASS 32/32** | `after-final/` |
| 기준선 4회차, 최종 | 최종 코드 | **PASS, MATCH (차이 0)**. FIXED 21, KNOWN_ISSUE 4, NOT_MEASURED 3 | `baseline-run4-final-compare/` |
| CI 동등 DOM | 최종 코드 | results·consistency·history PASS | `ci-dom-final/` |

회귀 1차 실패 3건과 처리:
- 토스트: History 진입 버튼 2개(부품 과거 기록, 세션 메뉴)로 선택자가 모호. 테스트가 세션 메뉴 버튼을 가리키도록 수정.
- 일관성 A5·B6: 제거한 로컬 기록 카드를 읽음 → 로컬 투영으로 읽도록 수정. 종료 확인은 데이터가 있을 때만 나오므로 B6은 대화상자가 있을 때만 확인.
- 이력: 결과 화면에서 "이번 점검" 구역과 SDK 구역 표식을 지운 것이 원인. **테스트가 아니라 화면을 고쳤다**(현재 점검과 과거 기록 구분이 이번 과제 요구사항이다).

## 최종 명령과 결과

| 명령 | 결과 |
|---|---|
| `npm test --prefix tools/three-poc` | 313건: pass 312, fail 0, todo 1 (P2-9, 범위 밖) |
| `npm run check:results`, `npm run test:android-assets` | PASS, 4/4 |
| `npm run test:results-browser` / `test:consistency-browser` / `test:history-browser` (GLB 없음) | PASS / PASS / PASS |
| 같은 세 명령 + `CARSCOPE_3D_TEST_URL` (실제 GLB) | PASS / PASS / PASS |
| `npm run test:toast-browser` (실제 GLB) | PASS (5) |
| `npm run test:part-labels-browser` (실제 GLB, PR #117 회귀) | PASS 172, NOT_RUN 0 |
| `npm run test:panels-browser` (실제 GLB, 신규) | PASS 32 (4개 화면 × 8) |
| `npm run test:part-ux-baseline` (실제 GLB) | PASS, MATCH |

## Known Issue

| ID | 수정 전 | 수정 후 | 판정 |
|---|---|---|---|
| P0-3 결과에서 뒤로 가기가 진입 경로를 무시 | 보닛 목록 → 결과 → 뒤로 = `INSPECTION_SUMMARY` (4개 화면) | `COMPONENT_SELECTION` (4개 화면), Node 테스트 통과 | **FIXED** |
| P1-7 범례가 타이어 4개만 셈 | 개요에 "타이어 4개" (4개 화면) | 없음. 범례·진행 현황은 17개 부품 | **FIXED** |
| P1-10 EV 배터리가 점검 가능으로 표시 | `점검 가능` | `형상 보기` | **FIXED** |
| P1-12 절차 없음 문구 옆에 절차 시작 버튼 | 보닛 4개 부품 `noProcedureText:true` + 스마트폰 버튼 | 4개 모두 `false`. 화면은 보닛 안전 확인과 스마트폰 점검을 함께 안내 | **FIXED** |
| P2-2 뒤로 버튼 문구가 여러 가지 | 5종(`뒤로 · 차량 전체 보기`, `선택 해제 · 이전 시점으로`, `점검 목록과 이전 시점으로`, `점검 부위로`, `점검 항목으로`) | `뒤로` 1종 | **FIXED** |
| P2-3 내부 값 노출 | 타이어 4개·EV 배터리 등 미리보기에 `USER_REPORTED`·`ESTIMATED_GEOMETRY` | 0건. 신규 패널 검사는 더 넓은 목록(`Native`, `Capability`, `Availability`, `inspectionId`, `bindingId`, `digest`, `sessionPhase`, `MOBILE` 등)으로 모든 방문 화면 0건 | **FIXED** |
| P2-5 토스트가 창 가운데 | 1600×1000: 800 vs 빈 영역 601 | 601 vs 601 (측면 패널 3개 화면, 420×860은 원래 일치) | **FIXED** |
| P2-7 프로그램 초점의 제목 테두리 | 18개 부품 | 0 | **FIXED** (스크립트 입력. 손가락 입력에서의 표시는 NOT_RUN) |
| P1-8 상세 화면에서 다른 부위 선택 불가 | `changed:false` | 변화 없음 | **OPEN**. PR #117 터치 선택 규칙(`pickExact`)을 바꾸는 일이라 이번 범위(보호 대상)에서 제외 |
| P1-11 형상 없는 부품 행의 class | `preview:false` | 변화 없음 | **OPEN**. 테두리는 #117에서 이미 중립색. 형상 없는 저전도 냉각수에 `preview` class를 붙이는 것은 잘못된 의미라 하지 않음 |
| P1-13 얇은 부품의 작은 터치 대상 | #117 기록과 같음 | 변화 없음 | **OPEN**. 이번 작업으로 해결됐다고 보지 않는다 |
| P2-1 충전구·와이퍼가 화면마다 나타났다 사라짐 | 같음 | 변화 없음 | **OPEN** |

PR #117·#98에서 FIXED였던 13건(P0-1, P0-2, P0-4, P1-1, P1-3, P1-4, P1-5, P1-6, P1-9, P1-14, P1-15, P2-4, P2-6)은 4회차에서도 FIXED다.

## 기준선 차이 (PR #117 기준선 → 이번 기준선, 489건)

전부 의도한 변화이며 카메라 위치·거리·방향·점유율, 형상, 라벨·가림, 터치, 3D 선택, 강조 역할 값에는 차이가 없다.

| 값 | 건수 | 변화 |
|---|---|---|
| `preview.*.internalWords` | 144 | `USER_REPORTED`/`ESTIMATED_GEOMETRY` → 없음 |
| `preview.*.backButtons`, `flows.backLabels` | 92 | 여러 문구 → `뒤로` |
| `preview.*.badge` | 72 | `위치·형상 추정` 등 → `추정 모델`/`참조 모델`/`위치 표식` |
| `preview.*.focusOutline` | 72 | `true` → `false` |
| `result.*.backTo` | 68 | 개요에서 연 결과의 뒤로 = 요약 → 개요 |
| `preview.*.noProcedureText` | 16 | `true` → `false` |
| `flows.resultBackFromList` | 4 | 요약 → 보닛 목록 |
| `overviewFacts.*` | 15 | 범례 없음, 배터리 태그, 토스트 위치, 사용법 문장 없음 |
| `preview.washer-fluid-cap.listName` | 4 | 워셔액 화면에 보닛 부품 목록이 생김 |
| `mobile.exit` | 2 | QR 표시 중 종료가 바로 끝나지 않고 확인을 받음(`askedFirst:true`) |

## 신규 패널 검사 (`test/browser-inspection-panels.mjs`) 항목, 화면별

17개 부품 진행 현황과 결과 지도 일치(로컬 1건 + 스크립트 결과 4건), 요약 목록 17행의 상태가 결과 지도와 같음, 부위 카드 6개의 폭·테두리·반경 동일·높이 차 ≤ 24px, 방문한 15개 화면의 내부 값·뒤로 문구·잘린 버튼·가로 스크롤·기본으로 펼친 details 없음, 상세 화면의 모델 고지와 안전 문구, 보닛 목록 → 결과 → 뒤로(보닛 열린 채), 미리보기 → 요약 → 상단 바 뒤로(같은 부품·보닛), 요약 → 결과 → Escape → Escape, 개요 뒤로 가기·종료의 확인과 범위, 대화상자에서 Escape 취소, QR 표시 중 종료 확인과 취소 후 기록 유지·초점 복귀, 확인 후 세션 초기화, 기록 없을 때 즉시 종료, 토스트 위치.

## Before / After 캡처

같은 장면 이름으로 `before-main-10a63be/<화면>/`와 `after-final/<화면>/`(1600×1000, 420×860)에 있다: `overview-empty`, `overview-results`, `summary`, `summary-bottom`, `hood-list`, `washer-detail`, `brake-detail`, `tire-detail`, `tire-list`, `tire-summary`, `battery-detail`, `charge-detail`, `wiper-detail`, `light-detail`, `result-brake`, `result-lcw`. After에만 `exit-confirm`이 있다.
