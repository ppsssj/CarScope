# P3-V1 외부 증거 인덱스

2026-11-01 KST, `C:\dev\CarScope-pleos-tire`, 기준 main `1ea76982fd59cdfd46d928bccf47dbfd86a5457d`.
전용 외부 루트: `C:\CarScope-External\p3-v1\`.

| 외부 경로 | 의미 |
|---|---|
| `sdk-sha.json` | Maven AAR/classes.jar SHA, 이전 api-audit classes.jar와 바이트 동일성 |
| `sdk-audit/sdk-audit.json`, `*.javap.txt` | 새 공개 AAR 감사 결과: 7개 메서드/permission/Float listener/바퀴 enum. runtime 미검증 명시 |
| `tire-javap.txt`, `tire-impl-javap.txt`, `followup-javap.txt` | 선언·annotation·참고용 내부 바이트코드·후속 도메인 선언 조사. 내부 API는 구현에서 호출하지 않음 |
| `tire-reference.html` | 상세 참조 URL의 Page Not Found 응답. 단위 근거로 사용하지 않음 |
| `gates.json`, `verified-core.txt`, `verified-android.txt` | 최종 명령·exit code와 실제 로그. core 37 pass/1 skip, app 51/51, 빌드/lint 성공 |
| `verified-tire-boundary.txt`, `verified-existing-boundary.txt` | 새 Tire 격리와 기존 identity/profile/3D debug 경계 검사 |
| `runtime/health.json`, `verified-avd-health.txt` | 실제 CarScope_Pleos_API34·CPU 2개·부하/메모리·시각과 BLOCKED 사유. SDK init/capability/getter/event는 NOT_RUN |
| `artifact-sha.json` | 최종 debug APK·release APK/AAB SHA |
| `debug-build-tests.txt`, `debug-build-tests-run2.txt`, `final-build.txt`, `core-tests.txt` | 초기 명령 파싱 FAIL과 이후 실제 테스트/전체 106 task 성공 로그 구분 |

테스트 XML은 이 worktree의 무시되는 `vehicle-core/build/test-results/test/`, `app/build/test-results/testDebugUnitTest/`에 있다. APK/AAB는 `app/build/outputs/`에 있다. 원본 SDK 바이너리와 모든 raw 로그·APK·개인 설정은 로컬에만 유지한다.

새 AVD Tire probe 실행 로그·데이터·화면 캡처는 **없다**. 이전 Door/Pleos 또는 정적 AAR 검사를 Tire 런타임 PASS로 재사용하지 않는다. [상세 보고서](../../p3-v1-pleos-tire.md), [공통 데이터 계약](../../contracts/vehicle-tire-v1.md).
