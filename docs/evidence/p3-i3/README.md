# P3-I3 증거 인덱스

로컬 원본: `C:\CarScope-External\p3-i3`. [구현·검증 보고서](../../p3-i3-tire-inspection.md). 원본 GLB, PNG, JSON, 로그, 테스트 XML 및 생성 Android 자산은 Git에 포함하지 않는다.

| 외부 경로 | 내용 / 출처 |
|---|---|
| `node-final.log` | 최종 Node 34개. 기존 28 + 신규 6 |
| `packaging-final.log` | Debug WebView 자산 계약 1개, 새 모듈 byte·import·CSP·GLB 미포함 |
| `core.log`, `core-final.log` | 최초 외부 wrapper 인용 오류와 수정 후 core 37 pass / 기존 선택적 자산 1 skip |
| `review-guide-wide/`, `review-guide-narrow/` | 최종 Chrome 1600×1000 / 420×860, 각각 34 assertions. actions/results/browser-log와 실제 PNG |
| `review-guide-*/01-empty-summary.png`, `01-checklist-start.png` | 미점검 중간 요약, 타이어 선택/체크리스트 진입 |
| `review-guide-*/02-checklist-completed.png`, `03-partial-summary.png` | 응답·확정·수정·재확정, 1/4 중간 결과 |
| `review-guide-*/04-full-summary.png`, `04-summary-rear.png` | 4/4 위치별 요약. Narrow의 앞/뒤 행은 스크롤한 두 캡처로 확인 |
| `review-guide-*/05-new-session.png` | 종료 후 새 식별자와 미점검 세션 |
| `tires-wide/`, `tires-narrow/` | 기존 G1 실제 GLB Raycast/고무 강조/카메라·scroll·focus 복원, 각각 39/36 assertions. Wide에 실제 resize 캡처 포함 |
| `components-wide/`, `components-narrow/` | 기존 네 부품/보닛 가림/LCW 준비 중·선택 회귀, 각각 34 assertions |
| `washer-wide/` | 기존 보닛/워셔액/QR 회귀 17 assertions, browser-results.json 및 PNG |
| `verification.json` | JUnit core suite 및 브라우저 결과 집계 |
| `guide-*`, `final-guide-*` | 초기/중간 검증. 모바일 sticky 버튼 가림 관찰과 개선 후 결과를 보존. 최종은 review-guide-* |

테스트 응답은 **USER_REPORTED_TEST_INPUT_NO_SDK**다. 실제 사용자 차량 점검 결과나 Pleos 수신 데이터가 아니다. Chrome은 실제 브라우저/GLB 렌더링 증거이고 Android WebView 실행 증거가 아니다. AVD·실차는 이번 요청에 따라 **NOT_RUN**이다. Android 원본 화면·SDK 수신 증거를 새로 생성하지 않았다.
