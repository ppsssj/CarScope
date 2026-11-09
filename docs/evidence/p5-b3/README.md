# P5-B3 증거 인덱스

2026-11-03 새 실행. `origin/main bcfb83e` 기반 독립 브랜치. Windows 10 / JDK 17.0.20 / Node 22.16 / Android API 34. 실제 기기 E2E 결론은 **BLOCKED**다.

원본 health/에뮬레이터 로그는 Git 밖 `C:/CarScope-External/p5-b3/run01/`, JVM XML/빌드/lint는 새 worktree의 Git 제외 `app/build/`에 보관한다. PKI/SQLite는 test-owned OS temp에서 생성·정리하며 Git에 넣지 않는다. SDK·APK·토큰·QR·원본 화면·개인 설정을 commit하지 않는다.

| Gate | 결과 | 실행 근거 / 범위 |
|---|---|---|
| main/병합 | PASS | `git fetch origin main`; GitHub #56/#57 merged 및 각 merge commit ancestry 확인 |
| AVD 준비 | PASS | 기존 기기 없음, 설치된 exact AVD 확인, `-accel-check` WHPX usable; 한 번 시작, 마지막에 이번 AVD만 종료 |
| Health 1 | BLOCKED | `health/health.json`: 2 vCPU, load 8.2~10.27; SystemUI PID `1086 1672`가 기존 single numeric PID 조건을 충족하지 못함. boot/API/WebView/Service 존재는 관측했지만 Health PASS 아님 |
| Health 2 | BLOCKED | `health-settled/health.json`: load 36.85~40.63, `dumpsys webviewupdate` 5초 timeout. 설치/앱 실행·기기 CA/endpoint·forward/reverse 없음 |
| Sync readiness | BLOCKED | `device-readiness.json`: inventory prerequisite missing. default creation deny, Android/phone TLS와 two-device E2E 미실행 |
| 실제 HTTPS 대상 | NOT_RUN | 승인된 주소/실제 서비스 구성 미제공. SYNC 환경 설정 없음; 인터넷 서비스의 존재 여부를 추정하지 않음 |
| 실제 Native/폰 생성→수락 | BLOCKED | 일반 앱 provider·서버 CLI default deny, 실제 provisioning 미연결, Health 미통과. 광학 QR·폰 점검·기기 전송/수신/Accept NOT_RUN |
| 새 loopback 통합 | PASS | focused `NativeTireHttpsE2eTest` 1개, failures/errors/skipped=0. 실제 JS/Node TLS/SQLite/Kotlin JVM·메모리 QR·ACK 유실 재시도·명시 Accept·모바일 최종 proof·소유 temp 정리. 스마트폰/Android runtime 아님 |
| 전체 app/빌드/lint | PASS | 문서의 전체 Gradle 명령: 24 suites / 177 tests / failures=errors=skipped=0, 106 tasks, Debug/Release APK·Release AAB·lintDebug 성공. lint errors=0 / warnings=23 |
| Core JVM | PASS | `./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 37 PASS / failures=errors=0 / 1 skipped (`IONIQ5_PARTS not set`, 기존 선택적 외부 자산 검사). 형상 검증 완료 주장이 아님 |
| Node 회귀 | PASS | `npm test --prefix tools/inspection-sync-poc`: 101 tests / failures=skipped=0. 인증·TLS·SQLite·워셔액/타이어/충전구/브레이크액 기존 범위 |
| Readiness 도구 회귀 | PASS | `python -B tools/inspection-sync-poc/android/test-device-readiness.py` 7개, `python -B tools/tire-probe/test_health.py` 2개. 합성/단위 검사이며 AVD Health 성공 아님 |
| Debug/Release 경계 | PASS | 기존 `python -B tools/inspection-sync-poc/android/check-boundary.py` PASS. 추가 ZIP/DEX 검사에서 새 test class·`SYNC_NATIVE_E2E_CREDENTIAL`·fixture JS가 Debug/Release APK·Release AAB 모두에 없음. hash/결과는 외부 `artifact-isolation.json` |

실제 기기의 실패/차단을 합성 성공으로 대체하지 않는다. 전체 GitHub CI 결과는 현재 PR HEAD Checks와 PR 본문의 실행별 링크로 기록한다. queued/in-progress는 PASS가 아니다. 분석·정확한 재실행 명령·보안 조건은 [검증 기록](../../p5-b3-sync-e2e.md)에 있다.
