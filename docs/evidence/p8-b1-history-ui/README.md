# P8-B1 History UI 증거 인덱스

원본 로그·캡처는 `C:/CarScope-External/p8-b1/`에 두고 Git에는 요약만 남긴다. [설계·경계](../../p8-b1-inspection-history-ui.md).

## 판정 범위

- `HISTORY_UI_IMPLEMENTED`: UI 구현. 화면에 표시한 기록은 모두 합성이며 **데모 데이터**로 표시된다.
- `HISTORY_UI_CONTRACT_VERIFIED`: 합성 소유자·행 + 실제 `HistoryService`/`historyQuery`/`historyDto` 코드 + stub 저장소. HTTP 서버·인증·PostgreSQL 경로는 포함하지 않는다.
- `HISTORY_UI_AUTH_BLOCKED`: issuer·소유권·폐기·Native read credential 부재.
- `HISTORY_UI_DEVICE_E2E_NOT_RUN`: AVD·스마트폰·실차 미실행.

## 새 로컬 실행 (2026-11-04)

환경: Windows 10, Node 22.16.0, Chrome 156.0.8078.80, Three 0.160.0, JDK 17. GLB는 기존 외부 참조 파일이며 변경하지 않았다. Anatomy는 `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`을 확인했고 `--any-anatomy`를 쓰지 않았다.

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 문법 | PASS | `npm run check:results --prefix tools/three-poc` |
| 3D Node | PASS, 152건 실패 0 (기존 110 + 신규 42) | `npm test --prefix tools/three-poc` |
| Android 자산·Release 경계 | PASS, 4건 실패 0 (기존 1 + 신규 3) | `npm run test:android-assets --prefix tools/three-poc`. OS 임시 사본에서 builder 실행 |
| History 브라우저 DOM | PASS, 1440×960·390×844 | `npm run test:history-browser`, `final-history/results.json` |
| History 실제 페이지 (provider 없음) | PASS | 같은 실행. UNAVAILABLE, History·demo 요청 없음, window·fragment·postMessage로 provider 주입 불가 |
| History 실제 GLB + 합성 provider | PASS, 1440×960·430×900 | 같은 실행. provider는 테스트 컨텍스트의 응답 치환으로만 주입 |
| 기존 결과 브리지 회귀 | PASS, DOM·실제 GLB | `npm run test:results-browser`, `final-results/results.json`. 합성 authority |
| 기존 제품 흐름 회귀 | PASS, 1600×1000·430×900 | `check-inspection-product.mjs`, `regression/product-{desktop,mobile}/`. Android shell JS의 Desktop 시뮬레이션 |
| 기존 상태 지도 회귀 | PASS, 1600×1000 | `check-inspection-state-map.mjs`, `regression/state-desktop/` |
| core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` |
| Android 단위 | PASS, 229건 실패 0 | `gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease --console=plain --continue`, `android-run2/gradle.txt` |
| Debug APK | PASS | 신규 3개 모듈 포함, demo·test 파일 없음 |
| Release APK | PASS | `assets/inspection` 없음. DEX에서 `inspection-records`, `inspection:history:read`, `inspection-history`, `native-inspection-v1` 미검출(바이트 검색) |
| mutation 25종 | 25 KILLED / 0 SURVIVED | 임시 사본에서 안전 조건을 하나씩 제거. 선택한 조건만 대상이며 완전성 증명이 아님 |

캡처를 직접 열어 확인했다(`final-history/3d-*.png`, `dom-*.png`).

## NOT_RUN / BLOCKED

| 항목 | 상태 | 이유 |
|---|---|---|
| 운영 History API 조회 | BLOCKED | Render는 403 DENY_DEFAULT. 무인증 호출·우회를 시도하지 않음 |
| 실제 Native read provider | BLOCKED | Native credential·issuer 없음. 인터페이스만 정의 |
| AVD·스마트폰·실차 | NOT_RUN | 후순위. 에뮬레이터 미실행 |
| 실제 Android WebView의 Back·날짜 입력·수명주기 | NOT_RUN | Back은 기존 shell 경로의 Node 테스트·Esc, pause는 고정 이벤트의 Desktop 시뮬레이션으로만 확인 |
| 실제 PostgreSQL·TLS를 거친 조회 | NOT_RUN | 백엔드는 P8-A1/A2 증거 범위. 이번 변경 없음 |
| `:app:bundleRelease`, `:app:lintDebug` | NOT_RUN | `app/**` 변경 없음. 로컬에서 실행하지 않음 |

## 개발 중 실패 기록

제품 판정 조건이나 임계값을 완화한 수정은 없다.

- **Android 단위 첫 실행 FAIL (229건 중 14건, `FileNotFoundException`):** 새 worktree에 Git 제외 Debug 자산이 없었다. `build-android-inspection.mjs`로 생성한 뒤 같은 명령이 PASS(`android-run1` → `android-run2`). CI나 새 checkout의 재현에도 이 선행 단계가 필요하다.
- **화면 검토:** 부품 필터 진입 시 펼쳐진 필터 폼이 1440×960에서 기록 카드를 첫 화면 밖으로 밀어냈다. 단정문은 통과한 상태였다. 필터를 접고 요약 줄로 표시하도록 고치고 첫 카드 가시성 검사를 추가했다.
- **mutation 생존 1건:** strict 원본 검증 제거가 digest 검사에 가려져 생존했다. digest를 다시 계산한 변조 원본 테스트를 추가해 KILLED로 전환했다.
- **초기 테스트 오류:** 시각 형식 기댓값, 동률 fixture의 digest 불일치, 지나치게 넓은 정규식(CSS class `tire-status`), UUID 대문자 변형이 문자가 없는 값이었던 문제, Playwright locator 중복을 테스트 쪽에서 수정했다.

## CI

PR checks 결과는 해당 job 범위에 한정한다. `inspection-results-ci`는 DOM_ONLY 합성 검사이며 GLB·Native·운영 API를 포함하지 않는다. 실행 링크는 PR에 기록한다.
