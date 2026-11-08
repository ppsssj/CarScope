# P13-F 실행 근거

P13-A~E 원장·증거는 변경하지 않았다. 실제 API 시도: **Roboflow 0 / OpenAI 0**, 신규 호출 비용 0.

| 대상 | 상태 | 근거 |
|---|---|---|
| 기준선 | PASS | PR #114 MERGED, main `7752ae5`에서 별도 worktree/브랜치 |
| 실험 CLI/예산 | PASS | `node test/run-pg-matrix.mjs --only 16 -- --test test/vision-experiment.test.mjs test/vision-budget-postgres.test.mjs test/vision-runtime-postgres.test.mjs`; PG16 실제 DB, 탐지 OFF/ON CLI startup 무호출, 기본 거부 |
| PG16 탐지/예산 재검증 | PASS | 위 명령에 `test/part-detection-postgres.test.mjs` 추가: 12 PASS, SKIP/FAIL 0 |
| 모바일 단위 | PASS | `tools/mobile-ar-poc`: `npm test`, 172 PASS |
| Vision 어댑터 | PASS | `tools/vision-poc`: `npm test`, 164 PASS |
| sync 전체 단위 | PASS | `tools/inspection-sync-poc`: `npm test`, 267 PASS / 41 SKIP, FAIL 0. PG/SQLite/실제 CLI가 없는 환경의 명시적 skip이며 별도 PG 검증과 구분. 추가 QR 재검증 테스트 1개는 이후 focused 실행에서 PASS |
| 구문 검사 | PASS | `tools/inspection-sync-poc`: `npm run check`, `git diff --check` |
| Android 기본 Origin | PASS | `gradlew.bat :app:testDebugUnitTest --tests io.carscope.app.sync.AvdSimulatorProvisioningTest --tests io.carscope.app.sync.SyncReceiverActivityTest --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process' --no-daemon`: 16 tests, 실패/오류 0 |
| Android 실험 Origin | PASS | 위 명령에 `--tests io.carscope.app.sync.HttpsAvdSimulatorGrantExchangeTest '-PcarscopeVisionOrigin=https://carscope-vision-test.onrender.com'` 추가: 26 tests, 실패/오류 0. 실제 AVD/실서버 인증 결과가 아님 |
| 모바일 통합 | PASS | `node test/run-pg-matrix.mjs --only 16 -- ../mobile-ar-poc/test/vision-render-browser.mjs`; 7개 그룹. 실제 QR grant/DB/HTTP/Chrome, Roboflow/OpenAI outbound만 MOCK |
| 실제 촬영/API/Render | NOT RUN | Render 서비스 URL/권한/서버 비밀 변수/계정·사진 권한·모델 과금 확인 미확보. 브라우저 접근 host도 unavailable |
| 실제 휴대폰 | NOT RUN | 실제 휴대폰 조작/촬영/광학 QR 스캔 미실행 |

원본은 Git 밖 `C:/carscope-external/p13-f-*`에 보관한다. 모바일 결과 JSON/합성 화면은 `p13-f-mobile/vision-mobile-results.json`, `p13-f-candidate-crop.png`, `p13-f-analysis-result.png`.
합성 이미지/합성 OpenAI 관찰은 실제 탐지 성능·진단 정확도·실제 기기 결과가 아니다.

검증 중 발견/수정: 기존 AVD Origin 고정으로 별도 서비스 인증이 불가능했음 → Debug 빌드의 명시적 Origin과 분리 enrollment 추가.
기존 탐지 CLI OFF gate가 의도한 실험 연결을 거부했음 → 기본 운영 OFF 검사는 유지하고 별도 approval/budget bootstrap gate를 통과한 정확한 진입점만 예외.
초기 Android 명령의 따옴표 누락으로 Gradle 속성이 task로 파싱되어 테스트 시작 전 실패 → 속성을 따옴표로 묶어 재실행. 실패를 제품 테스트 성공으로 집계하지 않음.

계정/라이선스 판단은 [공식 출처와 미확인 항목](../../p13-f-live-vision-e2e.md)에 구분했다. 운영자 승인 플래그를 실제로 설정하지 않았다.
현재 라이브 목표는 자격/서비스/사진 동의 확인이 필요하며 FULL_E2E_PASS가 아니다.
