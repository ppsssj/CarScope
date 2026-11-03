# P5-B2B 증거 인덱스

2026-11-03 새 실행. Windows, JDK 17.0.20, Node 22.16.0, Android API 34 / Build Tools 35.0.0. 원본 XML·로그·APK/AAB는 새 작업 트리의 Git 제외 `app/build/`에 둔다. TLS fixture PKI는 기존 테스트가 임시 디렉터리에 만들고 정리한다. 토큰·개인 설정·SDK·원본 화면은 commit하지 않는다.

| Gate | 상태 | 명령 / 관찰 | 근거와 범위 |
|---|---|---|---|
| 시작점 | PASS | `git fetch origin main`, GitHub PR #51~#55 조회 | 모두 merged, main `158a619` |
| JS 충전구 벡터 | PASS | `node tools/native-charge-sync/vectors.mjs` | 합성 108행, 실제 validator 승인 |
| Gradle 초기 실행 | BLOCKED | focused `:app:testDebugUnitTest` | sandbox가 공유 Gradle cache lock 쓰기를 거절. 승인받아 동일 검사를 재실행, 보안 설정 변경 없음 |
| Debug 자산 준비 | PASS | `npm ci --ignore-scripts --prefix tools/three-poc`, 두 build-android 생성기 | 기존 생성기, GLB/credential 미포함 |
| Native focused | PASS | 충전구·타이어·Activity·TLS suite | 최초 31 tests / failures=errors=skipped=0. 수락 proof/대기 중 만료 2개 추가 후 전체 실행에서도 통과 |
| App JVM/Robolectric | PASS | 전체 `:app:testDebugUnitTest` | 23 suites, 176 tests / failures=errors=skipped=0; 충전구 7, 타이어 6, 기존 sync 55 포함 |
| Node Sync 회귀 | PASS | `npm test` (`tools/inspection-sync-poc`) | 95 tests / failures=skipped=0; 기존 충전구·타이어·워셔액·auth·TLS·멱등/conflict |
| Android 전체 | PASS | 문서의 전체 Gradle 명령 | 106 tasks, BUILD SUCCESSFUL. Debug/Release APK·Release AAB·lintDebug 완료; lint errors=0, warnings=23 |
| Core JVM | PASS | `./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | 38 tests: 37 PASS / failures=errors=0 / 1 skipped (`IONIQ5_PARTS` 미지정인 기존 선택적 외부 자산 검사); 형상 검증 완료 주장 없음 |
| APK/AAB 경계 | PASS | `python tools/inspection-sync-poc/android/check-boundary.py` | 기존 7개 readiness unit 검사도 PASS; Debug-only sync DEX·권한·manifest·credential fixture 격리·Release APK/AAB 검사. 추가로 충전구 모델 5개가 Debug에만 존재함을 DEX에서 확인 |
| AVD·실기기 E2E | NOT_RUN | 사용자 지정 별도 검증 | adb/AVD/폰 조작 없음 |

Robolectric/합성 벡터/TLS loopback 검사를 실제 스마트폰·차량·외부 서비스 수신 결과로 해석하지 않는다. 코드·재현 명령·잔여 조건은 [구현 기록](../../p5-b2b-native-charge-port-sync.md)에 있다.

GitHub 전체 CI는 PR의 현재 HEAD Checks가 기준이다. PR 본문에 완료된 실행별 링크와 결과를 기록한다. queued/in-progress 실행은 PASS가 아니다. 로컬 Gradle 성공을 Geometry·Core·양 OS Sync·Tire workflow 성공으로 대체하지 않는다.
