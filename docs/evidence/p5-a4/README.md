# P5-A4 실행 증거 인덱스

원본 로그·캡처·JSON은 `C:/CarScope-External/p5-a4/`에 보존한다. Git에는 인덱스만 포함한다. 실제 GLB desktop Chrome과 UI 입력의 새 실행이며 모바일 수신·Android/AVD·실차 증거가 아니다.

[구현/검증 보고](../../p5-a4-inspection-state-map.md). 기준 main `bcfb83e90f5369803aa73f7450629eaed08aca5c`.

| 외부 상대 경로 | 결과 | assertion 수 | SHA-256 |
|---|---|---|---|
| `2026-11-03-run03/desktop/results.json` | PASS | 20 | `e12a806e300c0e663f4919468d9928aedd931f03bf6c2fbcd628b7c99ff8821a` |
| `2026-11-03-run03/portrait/results.json` | PASS | 20 | `484845b13a5a9c8ada50101e514df095e516083560cd64c365010051204690f9` |
| `2026-11-03-run02/regression-desktop/check-inspection-product.mjs/results.json` | PASS | 17 | `4de13296286097b9fa9f9d17fe1ec4a90b4aa6b49335766a50227caa29657494` |
| `2026-11-03-run02/regression-desktop/check-tire-inspection.mjs/results.json` | PASS | 34 | `93d58da9d824e709f948cdbf5437fc0fb411c2396d1be62e4ec7c66b458bb775` |
| `2026-11-03-run02/regression-desktop/check-tires.mjs/results.json` | PASS | 39 | `86fa34a4ec0df6c5df8de824d57f2403afc1e09ed7168725e72b2ea2dfb81dbf` |
| `2026-11-03-run02/regression-portrait/check-inspection-product.mjs/results.json` | PASS | 17 | `33d12779d75f1992cdeb30dd3c53780dca725184dc93a709f08e522f22a99450` |
| `2026-11-03-run02/regression-portrait/check-tire-inspection.mjs/results.json` | PASS | 34 | `ba3feaa87f43bd23bc77d791e8472f952cb717cfb737b9863137472e744552ce` |
| `2026-11-03-run02/regression-portrait/check-tires.mjs/results.json` | PASS | 36 | `aae08e00863c1f44f50cbf00d4427d2bc5b797427d823ad55e4ddce456621f93` |
| `2026-11-03-run04/components-desktop/results.json` | PASS | 35 | `992e1f33bc89ca662ad6cac473d7330ffa860853dff28f48769815651ab8fcf3` |
| `2026-11-03-run04/components-portrait/results.json` | PASS | 35 | `70c46d06d691d16181a57131d72f54cce1dac830dce54be4ea19b8b0b9acc43c` |
| `2026-11-03-run04/components-baseline/results.json` | PASS | 35 | `992e1f33bc89ca662ad6cac473d7330ffa860853dff28f48769815651ab8fcf3` |
| `2026-11-03-run02/washer/browser-results.json` | PASS | 17 | `180212148e8e301027eae2ebb11bdd5de3d8e8cc36a9c0cd8a07194cdd505215` |
| `2026-11-03-run02/sdk-regression/check-component-status.mjs/results.json` | PASS | 10 | `f77fde67ce0566ec4b9adf09394660e80495117d4466ad352c2295f2cb5b4e08` |
| `2026-11-03-run02/sdk-regression/check-ev-status.mjs/results.json` | PASS | 8 | `770b7e7f62fcb29a01004a29438df54a9f1343b3a206d22e8c2edcead8d64dc4` |
| `2026-11-03-run02/sdk-regression/check-charge-port.mjs/results.json` | PASS | 14 | `1b0191fbb4b8a278f13138d9bd8596865d4fd3382738d5a7986a1f64a8d8a203` |
| `2026-11-03-run02/sdk-regression/check-visibility.mjs/results.json` | PASS | 21 | `54b6c64d6c5d64bd58ddde3e6bb9521d2a4ade5bb21282836d314b9a343c8a14` |


새 지도 캡처: run03/desktop 및 run03/portrait의 01-empty-map, 02-mixed-map, 02-mixed-map-rows, 03-whole-summary, 04-selected-report.png. 혼합 색/문자·상세·세로 스크롤 목록을 직접 열어 확인했다.

실패 보존: run01/desktop 문구 인코딩 실패, run02/regression-*/check-inspection-components.mjs의 오래된 부품 수 가정, 2026-11-03-baseline-components의 수정 전 main 동일 실패. run03/components-*는 원래 전조등 재질 발광 가정 실패. run04/components-baseline(기준 main)과 desktop/portrait 모두 보정 하네스 PASS.

Kotlin MOCK 입력은 이전 `C:/CarScope-External/p5-b1/native-{component,charge,visibility}.json`이다. 이번 작업에서 Android/Kotlin serializer는 다시 실행하지 않았다. 기존 입력 생성과 새 browser 실행을 구분하며 SDK/Native 성공으로 주장하지 않는다.

Core JVM XML: 독립 worktree `vehicle-core/build/test-results/test/` (Git 제외),38 total/37 PASS/1 skip (`IONIQ5_PARTS not set`).

패키징 계약은 OS 임시 `carscope-state-map-packaging-*` 소스 사본에서 실행했다. 작업 worktree의 `app/src/debug/assets/inspection`은 생성하지 않았다.
