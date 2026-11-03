# P5-A5 실행 증거 인덱스

원본은 `C:/CarScope-External/p5-a5/`에 보존한다. Git에는 이 인덱스만 포함한다. [구현·검증 보고](../../p5-a5-state-map-mobile-integration-preparation.md).

기준 main fdffd96, Chrome156.0.8078.80. baseline/portrait는 변경 전20 assertions. 아래15개 새 실행의 합계363 assertions PASS이며 중간 run01 지도 결과와 기준 실행은 합산하지 않는다.

| 외부 상대 경로 | assertions | SHA-256 |
|---|---|---|
| `2026-11-03-run02/desktop/results.json` | 23 | `187d8cecf8bc09316a4fb71cd4c6c6f70610756b6cb5b4d1c921a69832722ac4` |
| `2026-11-03-run02/portrait/results.json` | 23 | `1fc76fad56d2cfabb83914f1042d57196a54bba0a837891ccfddc21358758a3b` |
| `2026-11-03-run01/desktop-regression/check-inspection-product.mjs/results.json` | 17 | `4de13296286097b9fa9f9d17fe1ec4a90b4aa6b49335766a50227caa29657494` |
| `2026-11-03-run01/desktop-regression/check-tire-inspection.mjs/results.json` | 34 | `93d58da9d824e709f948cdbf5437fc0fb411c2396d1be62e4ec7c66b458bb775` |
| `2026-11-03-run01/desktop-regression/check-tires.mjs/results.json` | 39 | `86fa34a4ec0df6c5df8de824d57f2403afc1e09ed7168725e72b2ea2dfb81dbf` |
| `2026-11-03-run01/desktop-regression/check-inspection-components.mjs/results.json` | 35 | `992e1f33bc89ca662ad6cac473d7330ffa860853dff28f48769815651ab8fcf3` |
| `2026-11-03-run01/portrait-regression/check-inspection-product.mjs/results.json` | 17 | `33d12779d75f1992cdeb30dd3c53780dca725184dc93a709f08e522f22a99450` |
| `2026-11-03-run01/portrait-regression/check-tire-inspection.mjs/results.json` | 34 | `ba3feaa87f43bd23bc77d791e8472f952cb717cfb737b9863137472e744552ce` |
| `2026-11-03-run01/portrait-regression/check-tires.mjs/results.json` | 36 | `aae08e00863c1f44f50cbf00d4427d2bc5b797427d823ad55e4ddce456621f93` |
| `2026-11-03-run01/portrait-regression/check-inspection-components.mjs/results.json` | 35 | `70c46d06d691d16181a57131d72f54cce1dac830dce54be4ea19b8b0b9acc43c` |
| `2026-11-03-run01/desktop-regression/check-inspection.mjs/browser-results.json` | 17 | `180212148e8e301027eae2ebb11bdd5de3d8e8cc36a9c0cd8a07194cdd505215` |
| `2026-11-03-run01/sdk-regression/check-component-status.mjs/results.json` | 10 | `f77fde67ce0566ec4b9adf09394660e80495117d4466ad352c2295f2cb5b4e08` |
| `2026-11-03-run01/sdk-regression/check-ev-status.mjs/results.json` | 8 | `770b7e7f62fcb29a01004a29438df54a9f1343b3a206d22e8c2edcead8d64dc4` |
| `2026-11-03-run01/sdk-regression/check-charge-port.mjs/results.json` | 14 | `1b0191fbb4b8a278f13138d9bd8596865d4fd3382738d5a7986a1f64a8d8a203` |
| `2026-11-03-run01/sdk-regression/check-visibility.mjs/results.json` | 21 | `54b6c64d6c5d64bd58ddde3e6bb9521d2a4ade5bb21282836d314b9a343c8a14` |

시각 근거: 2026-11-03-baseline/portrait 및 run02/{desktop,portrait}의 02-mixed-map.png,02-mixed-map-rows.png,03-whole-summary.png,04-selected-report.png. 기준/변경 후의 첫 결과 노출·선택 상태색·상세/요약을 직접 열어 확인했다.

기존 Kotlin MOCK 입력: `C:/CarScope-External/p5-b1/native-{component,charge,visibility}.json`. 이번 browser는 새 실행이지만 fixture 생성은 이전 작업이다. Android/SDK/실차 실행으로 해석하지 않는다.

Core XML은 독립 worktree `vehicle-core/build/test-results/test/` (Git 제외),38 total/37 pass/1 optional skip. 패키징 검사는 OS 임시 사본에서 실행해 실제 app 자산을 생성하지 않았다.

설계 일치 Node 테스트는 문서7 task/response/status와 실제 모바일 생산 코드를 비교한다. 테스트의 합성 모바일 결과를 browser에 주입하지 않으며 실제 수신·중복/만료 처리 구현의 증거가 아니다. 실제 폰/Native/AVD/실차/스크린리더 E2E는 NOT_RUN.
