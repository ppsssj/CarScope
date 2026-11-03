# P5-B4 증거 인덱스

2026-11-03, main `fdffd96` 기반 새 worktree. Windows / JDK 17.0.20 / Node 22.16 / Android API 34. AVD·adb·실제 서버/외부 서비스 변경·배포는 **NOT_RUN**이다. 실제 연결은 issuer/등록/폐기·운영 credential·승인된 HTTPS·enrollment 제공 전까지 **BLOCKED**다.

원본 XML/빌드/lint는 ignored `app/build/`, PKI/DB는 test-owned OS temp다. token·QR·identity assertion·키·SDK·APK·원본 로그를 Git에 넣지 않는다. Draft PR #58과 worktree는 보존했다. 구현·계약·재실행·기존 기기 후속 제안은 [구현 기록](../../p5-b4-auth-https.md)을 따른다.

| Gate | 상태 | 새 실행 근거 |
|---|---|---|
| 시작점/격리 | PASS | fetch main `fdffd96`, #58 OPEN/draft/head `0ff0934`; 별도 브랜치 생성, 기존 worktree clean |
| Node 최초 집중 | FAIL | 생성 요청 11번째가 기존 10/min 제한으로 429, 403 기대와 달랐다. 임계값 변경 없이 추가 정책 검사를 adapter 호출로 분리. fixture 종료 순서도 service→authority로 고쳐 재실행 |
| Node 집중 재실행 | PASS | `node --test tools/inspection-sync-poc/test/https-authority.test.mjs`: 3 tests / failures=skipped=0. 실제 loopback TLS·SQLite + 합성 authority |
| 기존 Native 집중 | PASS | provider 7 + Activity 9 tests. 기존 기본 거부/수명주기 회귀 |
| 신규/기존 Native 집중 | PASS | provisioning lifecycle 4 + Robolectric 2 + Node TLS 통합 1 + provider 7 + 기존 Activity 9 = 23, failures=errors=skipped=0 |
| 전체 Node | PASS | `npm test --prefix tools/inspection-sync-poc`: 104 tests / failures=skipped=0. 기존 인증·TLS·SQLite·모바일 결과 회귀 포함 |
| 전체 app/빌드/lint | PASS | 문서의 전체 Gradle 명령: 26 suites / 183 tests / failures=errors=skipped=0. Debug/Release APK·Release AAB·lintDebug 통과, lint errors=0 / warnings=23. 정책 검증 공통화 후 `--rerun-tasks`만 생략한 같은 gates의 최종 증분 재실행과 boundary 재검사도 PASS |
| Debug/Release 경계 | PASS | `python -B tools/inspection-sync-poc/android/check-boundary.py`: 새 클래스 Debug 전용·test fixture/credential APK/AAB 제외·기존 Release 권한/cleartext/receiver 및 readiness 단위 7개 검사 PASS |
| Core JVM | PASS | `./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 37 PASS / failures=errors=0 / 1 skipped (`IONIQ5_PARTS not set`, 기존 선택적 외부 자산 검사) |
| 실제 기기 E2E | NOT_RUN | 이번 AVD/adb 실행 없음. 합성 검사를 실제 발급·로그인·폰/Android 수신으로 해석하지 않음 |

첫 실패 때 종료되지 않은 해당 test subprocess는 명령/PID를 확인해 그 child만 종료했다. 강제 종료 이전 temp cleanup은 보장하지 않으며 전역 temp 삭제를 하지 않았다. 수정 후 정상 테스트는 bounded 종료와 소유 PKI/DB 제거를 검증한다. GitHub CI 결과는 현재 PR HEAD Checks와 PR 본문의 실행별 링크를 기준으로 기록한다. queued/in-progress를 PASS로 표시하지 않는다.
