# P13-E 증거 인덱스

기준 main `1b64e3d` (PR #113 병합), 작업 브랜치 `feat/p13-e-real-mobile-vision`.
원본 로그·합성 PNG·브라우저 결과 JSON·개인 설정은 Git에 넣지 않는다.

| 새 검증 | 상태 | 근거 / 범위 |
|---|---|---|
| 서버/어댑터 및 PostgreSQL budgets/실제 CLI | PASS | `run-pg-matrix --only 16`의 Vision 3개 test file. 실제 사설 schema, 동시성·월/일 상한·재구성·lease·CLI ingress/OFF·설정 거부. 기존 deployment/detection PG 회귀 포함 실행도 PASS |
| 실제 QR/PostgreSQL + Chrome 6부품 | PASS | `vision-render-browser.mjs`, 4 시나리오 묶음. 전체 수동 경로·Crop·동의·확인, 탐지 가능 host의 4부품 수동 우회, HTTP 오류/잘못된 응답/취소/예산, 기존 Render OFF, 명시적 제출·Accept·기록 저장 |
| 기존 P13-D / P13-A 브라우저 회귀 | PASS | `test:browser:multipart` 3, `test:browser:analysis` 7. 기존 후보 4부품·직접 지정 2부품·실패/취소·작은 화면 |
| 모바일 단위 | PASS | 기존 172개 |
| vision-poc 단위 | PASS | 기존 164개, 실제 호출 없음 |
| 기존 모바일 전체 브라우저 | PASS | `npm run test:browser`, 11개 실행기 전부 성공 (카메라/체크리스트/QR/7~17 task/탐지/분석/복구 포함) |
| 기존 sync 단위 | PASS | DB 환경 없는 일반 실행 305개 중 265 PASS / 40 SKIP, 실패 0. 별도 실제 PG 회귀는 28 PASS/skip 0; 이후 probe를 포함한 분석/실험 검사는 14 PASS |
| core Gradle | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`, 38개 중 37 PASS / 1 SKIP(외부 IONIQ5_PARTS 미제공), 실패/오류 0 |
| 기존 기본 진입점 / 외부 평가 기록 | PASS | `render-stateful.mjs`, `render-webxr-experiment.mjs`, 기존 API 원장·P13-A~D 실험 기록 변경 없음 |
| 실제 OpenAI/Roboflow·폰·AVD·Render 배포 | NOT_RUN | 유료 호출 0, 운영/비밀 변수/실기기 변경·검증 없음 |

로컬 환경: Windows, Node 22.16.0, Chrome 157, Docker의 일회성 PostgreSQL 16. 브라우저 화면은 390×844 모바일 viewport이며 실제 휴대폰이 아니다.
외부 증거: `C:/carscope-external/p13-e-20261108/`의 `mobile-final-complete/vision-mobile-results.json`, `washer-crop.png`, `battery-result.png`, `regression/p13-d/` 및 기존 분석 브라우저 결과. 전체 브라우저 회귀는 기존 실행기의 경로 계약에 맞춰 `C:/carscope-external/qr-ar-01/p13-e-20261108-final/`에 둔다. 링크 가능한 원본 파일은 해당 PC에서만 존재한다.

실행 중 발견한 실패: 처음 budget 예외가 공급자 일반 오류로 바뀌어 한도 안내가 안 보였다. 예산 예약을 어댑터 바깥으로 이동해 보존했고, 같은 실패·취소·한도 시나리오가 이후 PASS였다. UI 캡처에서 탐지를 쓰지 않은 경로에도 Roboflow를 썼다는 문구가 보여, 실제 경로에 맞춰 동의 문구를 분리했다. 기존 테스트를 제거하거나 한도를 높여 통과시키지 않았다.

병렬 브라우저 실행 중 한 차례 기존 제출 상태의 15초 대기에서 timeout이 있었다. 원인은 미확정이다. 토큰을 제외한 UI 상태/서버 상태/HTTP 실패 진단을 추가하고 같은 시간 기준으로 순차 재실행해 4개 시나리오 모두 PASS했다. 시간 기준을 늘리거나 실패를 무시하지 않았다. 기존 전체 브라우저 실행기의 첫 시도는 증거 경로 계약 때문에 시작 거부됐고, 정해진 외부 경로로 재실행해 PASS했다.

명령·실기기 경계는 [구현 문서](../../p13-e-real-mobile-vision.md)에 있다. PR의 최종 HEAD별 CI 상태는 GitHub Checks를 확인한다. CI 결과와 위 로컬 실행은 별개이며 실제 AI/폰/운영 결과는 NOT_RUN으로 유지한다.
