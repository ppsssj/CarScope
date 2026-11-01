# AR-02B-2B evidence index

실행일: 2026-11-01 KST. 자체 Worktree `C:\Users\박성진\.codex\worktrees\0b30\CarScope-sync-infra`, branch `feat/ar-02b2b-android-https-receiver`. 기준 PR #35 merge `24b3902`, 최신 main PR #36 `7c90ecf` 반영. 원본 로그/DB/bitmap/키/APK는 커밋하지 않는다.

로컬 외부 evidence root: `C:\CarScope-External\ar-02b2b\2026-11-01`.

| 근거 | 위치/재현 | 결과 |
| --- | --- | --- |
| Node command별 로그/summary | `node/summary.json`, `node/*.txt` | check, legacy48, full69, SQLite21, AR0131 PASS |
| 통합 모바일 Playwright | `mobile-browser/mobile-summary.json` | 17 checks, errors=[] |
| AR-02A browser | `legacy-browser/summary.json` | 11 checks |
| AR-01 browser | `C:\CarScope-External\qr-ar-01\ar-02b2b-2026-11-01\browser-results.json` | PASS 16 checks |
| Gradle final task graph | `gradle-final.txt` | BUILD SUCCESSFUL; 최종 확인은 변경된 입력의 완료 산출물을 재사용한 incremental 실행 |
| App XML | `app/build/test-results/testDebugUnitTest/TEST-*.xml` (ignored build) | 110 tests, 실패/오류/skip 0 |
| Core XML | `vehicle-core/build/test-results/test/TEST-*.xml` (ignored build) | 38 tests, 기존 skip1, 실패0 |
| lint | `app/build/reports/lint-results-debug.txt` | 0 errors/21 warnings |
| APK/AAB 격리 | `python tools/inspection-sync-poc/android/check-boundary.py` | PASS receiver/HTTPS/decoder/QR Debug only, INTERNET Debug only, cleartext false |
| Identity/Tire 및 Kotlin→JS | network validation 문서의 build-contract 명령 | PASS |

추가 외부 보관본은 `android-test-results/`, `core-test-results/`, `lint-results-debug.txt`, `boundary-final.txt`다. 원본 browser screenshots/DB는 토큰 등 민감정보를 포함할 수 있으므로 공개 첨부하지 않는다. 이번 Android UI 검증은 Robolectric view tree와 QR bitmap 역해독이며, AVD screenshot은 생성하지 않았다. 테스트 TLS 키는 저장소 밖 OS 임시 디렉터리에 생성하며 Git에 저장하지 않는다.

정확한 테스트 범위/중간 실패 기록: [네트워크 검증](../../ar-02b2b-network-validation.md). A Kotlin 계약/B JVM HTTPS/C Robolectric UI는 PASS. D Android HTTPS/E 광학 스캔/F 스마트폰 E2E/G 실제 차량 인증은 BLOCKED. 코드 준비와 실제 기기 성공을 구분한다.

Git 변경 격리: main 대비 sync Debug 패키지/테스트, Debug manifest, Gradle, android fixture/boundary checker, 위 문서만 변경한다. Codex A의 P3-I2를 main에서 반영했으며 다른 Worktree/브랜치를 수정하지 않았다. PR은 자동 병합하지 않는다. CI 최종 결과는 PR checks와 최종 보고에 기록한다.
