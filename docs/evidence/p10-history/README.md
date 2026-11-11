# P10 History UX 최종 보완 증거 인덱스

[설계](../../p10-history-ux-final.md). 원본(캡처, `results.json`, 로그)은 `C:/CarScope-External/p10/p10-history/`에 있고 Git에 넣지 않았다.

환경: 기준 main `d557f1c`(PR #118 병합), Windows 10, Node 22.16.0, 실제 참조 GLB(`hyundai_ioniq_5_2022.glb`), headless Chrome 157.0.8103.39. History 기록은 테스트 컨텍스트에서만 넣은 데모 provider(`test/history-demo-provider.mjs`)다. 배포 페이지는 provider가 없어 `UNAVAILABLE`이다.

| 범위 | 판정 |
|---|---|
| Node 규칙, Android 자산 패키징, CI와 같은 DOM 브라우저 테스트 | 실행 |
| 데스크톱 Chrome, 실제 GLB 페이지(1440·430 폭, 패널 검사는 4개 화면) | 실행 |
| AVD, Android WebView(실제 Back 키), 실제 손가락 터치, 스마트폰, 실차, 운영 History API | **NOT_RUN** |

## History 복귀 시나리오

| 시나리오 | Node(`test/inspection-history-nav.test.mjs`) | 실제 GLB(`test/browser-inspection-history.mjs`) |
|---|---|---|
| 개요 → History 목록 → 이번 점검 부품 결과 → 뒤로 → History 목록 | PASS | PASS (패널 뒤로·상단 바·Escape 각각, 1440·430) |
| History 상세 → 이번 점검 부품 결과 → 뒤로 → History 상세 | PASS (보닛 부품: 보닛 닫힘 → 상세) | PASS (브레이크액 결과, 보닛 60° → 0°, 같은 기록·상세 데이터) |
| History 상세 → 뒤로 → History 목록 | PASS | PASS |
| History 목록 → 뒤로 → 진입 화면 | PASS (개요, 요약 → 그 요약의 원래 화면까지) | PASS (기존 시나리오: 부품 결과로 복귀, 기록 지움) |
| 필터 유지 | — | PASS (부품 필터 그대로, 다시 조회 없음) |
| 페이지·스크롤 유지 | — | PASS (두 번째 페이지까지 불러온 목록 → 상세 → 결과 → 뒤로 → 뒤로: 같은 기록 목록과 스크롤 위치) |
| 반복 이동 시 스택 증가 없음 | PASS (40회, History 상태 크기 1종, 깊이 ≤ `BACK_DEPTH`) | PASS (3회 왕복, 상태 크기 동일) |
| 결과에서 History 다시 열기 → 같은 History (중첩 없음) | PASS | — |
| 카메라·보닛이 History 진입 화면 기준으로 복귀 | PASS | PASS (보닛 각도) |
| History에서 결과를 열어도 이번 점검·저장 기록 불변 | PASS | PASS (기존 세션·SDK 불변 검사) |
| Android Back = 같은 BACK | PASS (`inspectionBack`) | Escape로 같은 경로. 실제 Android Back은 NOT_RUN |

## 문구

Node: History 목록 패널·필터·v1/v2 상세의 보이는 문장에 `USER_REPORTED`, `taskId`, `partId`, `recordId`, `inspectionId`, `digest`, `schema v`, 6개 상태 enum, `SELF`, `MOBILE`이 없고, 같은 값이 개발자 정보·데이터 속성에 남아 있음을 확인. 실제 GLB: 목록과 상세의 `innerText`에 같은 목록이 없음.

## 최종 명령과 결과

| 명령 | 결과 |
|---|---|
| `npm test --prefix tools/three-poc` | 323건: pass 322, fail 0, todo 1 (P2-9, 범위 밖) |
| `npm run check:results`, `npm run test:android-assets` | PASS, 4/4 |
| `test:results-browser` / `test:consistency-browser` / `test:history-browser` (GLB 없음, CI 방식) | PASS / PASS / PASS |
| `test:history-browser` (실제 GLB, 최종 코드) | PASS 5 (DOM 2 + 배포 페이지 1 + 실제 GLB 2) |
| `test:panels-browser` (PR #118 이동·종료·QR, 실제 GLB) | PASS 32 |
| `test:consistency-browser` / `test:results-browser` / `test:toast-browser` (실제 GLB) | PASS / PASS / PASS |
| `test:part-labels-browser` (PR #117, 실제 GLB) | PASS 172 |
| `test:part-ux-baseline` (실제 GLB, 1회, 기록 없음) | PASS, MATCH (차이 0). FIXED 21, KNOWN_ISSUE 4, NOT_MEASURED 3 |

## 폴더

`ci-dom/`, `ci-dom-final/` (GLB 없음), `glb/history/`, `glb/history-final/` (캡처 `3d-list-*.png`, `3d-detail-*.png`, `3d-part-zones-*.png`), `glb/panels/`, `glb/consistency/`, `glb/results/`, `glb/toast/`, `glb/part-labels/`, `baseline-compare/`.
