# P9-S2 증거 인덱스

원본 로그와 캡처는 `C:/CarScope-External/p9-s2/`에 두고 Git에는 요약만 남긴다. [설계](../../p9-s2-inspection-ui-consistency.md).

**판정 범위:** 실제 `inspect.html`, 참조 GLB, 실제 Chrome에 **스크립트로 답하는 테스트 어댑터**를 쓴 합성 검증이다. `AVD_NOT_RUN`. Native와 실기기는 NOT_RUN이다.

병합 전 실행 환경: 기준 main `542ee164bf635b483852360250e6eea165436c76`, Windows 10, Node 22.16.0, Chrome 156.0.8078.80, Edge 156.0.4314.58.

## 수정 전후

수정 전 코드에서 먼저 실행했다(`red-before-fix/`).

| 시나리오 | 수정 전 | 수정 후 |
|---|---|---|
| 타이어 로컬 확정 직후 카드 | FAIL: 모델 `FINDINGS_REPORTED`, 카드 `NOT_INSPECTED` | PASS: 같은 작업 안에서 모두 일치 |
| 카메라·선택·스크롤·포커스 유지 | FAIL: 카드 불일치에서 먼저 실패 | PASS |
| 모바일 후보가 있을 때 로컬 확정 | FAIL: 카드 `NOT_INSPECTED` | PASS: 로컬 표시, 후보 미선택 |
| Native 승인 | FAIL: 응답 전에 `수신 화면을 요청했습니다` | PASS: 전달 중 → 접수 |
| 다른 부품 요청 거부 | FAIL: 거부됐는데 `수신 화면을 요청했습니다` | PASS: `점검 요청을 시작할 수 없습니다`, 패널 안내, 포커스 유지 |
| 연결 실패 | FAIL: 같은 시작 문구 | PASS: `Native 연결을 확인하지 못했습니다`, 다음 요청에서 해제 |
| 연속 클릭 | FAIL: Native 요청 3건 | PASS: 1건 |

수정 전에도 통과한 시나리오는 그 사실만으로 근거가 되지 않는다. 중복 확정·답변 수정은 카드가 계속 `미점검`이어서, Back·세션 종료 중 늦은 응답은 늦은 토스트 경로가 없어서 통과했다. 수정 후 다시 검사했다.

## main 병합 후 재실행 (PR #85 `8e8c7e3` 반영, 2026-11-06)

아래 "병합 전 로컬 실행"과 별개의 새 실행이다. 환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38, Edge 156.0.4314.58. 근거 경로는 `C:/CarScope-External/p9-s2/merge-main-8e8c7e3/` 기준이다. `AVD_NOT_RUN`. Native와 실기기는 NOT_RUN이다.

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 충돌 표시만 해결한 상태 | FAIL (의도한 기준선) | `fixed adapter maps the conflict answer…`가 `REJECTED` 대신 `FAILED`, reliability 파일은 없어진 `mobileRequestToast` import로 로드 실패 |
| 문법 | PASS | `npm run check:results` |
| three-poc Node | PASS 220건, SKIP 0 | `npm test`, `node.txt` |
| Android asset | PASS 4건 | `npm run test:android-assets` |
| DOM (CI 범위) 결과·일관성·History | PASS | `test:results-browser`, `test:consistency-browser`, `test:history-browser`, `dom-*/` |
| 실제 GLB 페이지 일관성 | PASS 15개 시나리오 | `test:consistency-browser`, `real-consistency/` |
| 실제 GLB 페이지 토스트·결과·History | PASS | `test:toast-browser`, `test:results-browser`, `test:history-browser`, `real-*/` |
| mobile-ar-poc Node | PASS 122건 | `npm test` |
| 17개 모바일 점검과 QR v2 회귀 | PASS 5개 스위트 | `npm run test:browser`, `regression-17.txt` |
| Sync, Kotlin, 형상 | 이 로컬에서 NOT_RUN | 이번 병합 해결이 건드리지 않음. PR CI 결과로 확인 |

**병합으로 바뀐 기존 테스트:** `native-bridge-reliability.test.mjs`의 동기 `true/false` 기대값을 확인된 결과로 옮겼다. 중복·동시 요청 2건은 대기 중 `IN_FLIGHT`로 보내지 않는 동작을 검사하고, 응답 뒤의 요청으로 Native까지의 전달과 충돌을 계속 검사한다. UNAVAILABLE 뒤의 요청을 보는 2건은 기대값이 `CHANNEL_CLOSED`가 됐다. 임계값을 바꾸거나 검사를 제외하지 않았다. 토스트와 진단 코드를 함께 보는 검사 2건을 추가했다.

## 병합 전 로컬 실행 (2026-11-06)

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 문법 | PASS | `npm run check:results` |
| three-poc Node (17개 부품 계약 포함) | PASS 196건, SKIP 0 | `npm test`, `run2/node.txt` |
| Android asset | PASS 4건 | `npm run test:android-assets` |
| 상태 일관성, 실제 GLB 페이지 | PASS 15개 시나리오 | `test:consistency-browser`, `run2/consistency/results.json` |
| 상태 일관성, DOM (CI 범위) | PASS 3개 시나리오 | URL 없이 같은 명령 |
| 토스트 실제 페이지 | PASS | `test:toast-browser` |
| 17개 결과 실제 페이지 | PASS | `test:results-browser` |
| History 실제 페이지 | PASS | `test:history-browser` |
| 17개 모바일 점검과 QR v2 회귀 | PASS 5개 스위트 | `tools/mobile-ar-poc`의 `npm run test:browser`, `run2/regression-17.txt` |
| mobile-ar-poc Node | PASS 122건 | `npm test` |
| Sync 전체 | PASS 177, SKIP 9 | `npm test`. SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
| mutation 25종 | 1차 23 KILLED, 2 SURVIVED. 검사 강화 후 2종 재실행 2 KILLED | 임시 사본에서 조건을 하나씩 변경. 선택한 조건만 대상이며 완전성 증명이 아님 |

## 필수 사례와 검사

| # | 사례 | 검사 |
|---|---|---|
| 1 | 타이어 로컬 결과 확정 즉시 카드 갱신 | A1 (같은 작업에서 읽음) |
| 2 | 카드와 전체 요약 동기화 | A4, DOM, Node |
| 3 | 선택·카메라·스크롤 유지 | A2, DOM |
| 4 | 같은 결과 중복 확정 방지 | A3, Node |
| 5 | 정상 Native 승인 | B1, Node, 고정 어댑터 |
| 6 | 비동기 거절 | B2, Node, 고정 어댑터 |
| 7 | 동시 부품 요청 | B4, Node |
| 8 | 연속 클릭 | B4, Node |
| 9 | 늦은 성공 응답 | B5, B6, Node |
| 10 | 화면 종료와 세션 변경 | B6, Node |
| 11 | 토스트 4초 해제 | B7, Node |
| 12 | Native 후보 선택 | A5, `test:results-browser` |

## 개발 중 수정 기록

제품 조건이나 임계값을 완화한 수정은 없다.

- **기존 테스트 변경:** `request()`의 반환이 `false`에서 Promise로 바뀌어 기대값을 `'NOT_CONNECTED'`로 옮겼다. 토스트 페이지 검사의 문구도 새 문구로 바꿨다. 테스트 어댑터는 `undefined` 대신 `{ ok: true }`를 답한다. 실제 브리지의 응답과 같다.
- **화면 검토:** 요청 거부 안내에 `새 결과를 완료로 적용하지 않았습니다`가 붙어 결과가 있었던 것처럼 읽혔다. 요청 안내에서는 뺐다.
- **mutation 생존 2건:** `세션 종료 후 대기`는 8초 타임아웃이 대신 끝내 느리게 통과했고, `스크롤 복원`은 카드가 위쪽에서 커지는 경우를 시험하지 않았다. 검사를 강화했다.
- **복사 실수:** mutation 사본에서 `/XD android`가 playwright 내부 폴더까지 제외해 기준 실행이 실패했다. 옵션을 빼고 다시 실행했다.

## CI

`inspection-results-ci.yml`에 DOM 검사 단계를 추가했다. 이 단계에는 GLB, Native, AVD가 포함되지 않는다.
