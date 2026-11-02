# P4-A1 evidence index

[제품 흐름·설계·검증 보고서](../../p4-a1-inspection-product-flow.md).

외부 루트 `C:\CarScope-External\p4-a1`. 원본 GLB·APK/AAB·JUnit·로그·스크린샷·개인 설정은 Git에 넣지 않는다. AVD/adb/실제 Pleos Runtime은 사용자 지시로 NOT_RUN이며 desktop shell simulation과 구분한다.

| 경로 | 결과 / 범위 |
|---|---|
| `20261102-run01/` | 초기 Node39/assets1/Navigation3/core37+skip1. 공유 JVM HTTPS7 실패와 `junit-initial-failed/` 보존, 단독 HTTPS10 PASS, 초기 desktop 링크 실패 |
| `20261102-run02/{node,android-assets,core,geometry}.log` | 최종 frontend Node39/assets1/core37+skip1/IONIQ5 57+skip1 PASS |
| `20261102-run02/browser-*/{actions.json,browser-log.txt,results.json 또는 browser-results.json,*.png}` | 실제 외부 GLB Chrome9회/262 assertions PASS. 제품17×2, checklist34×2, tire39/36, component34×2, hood/washer/QR17 |
| `20261102-run02/browser-summary.json`, `commands-browser.json`, `browser-server.log` | 최종 frontend 검사 exit/viewport/assertions 및 본 실행 서버. synthetic-tire-fixture.json은 JVM 합성 상태, 실제 SDK 아님 |
| `20261102-run02/android-build.log`, `junit-combined-failed/` | 공유 JVM worker의 재현 실패. 테스트가 중단돼 APK/manifest가 없던 후속 boundary 실패도 별도 로그에 남음 |
| `20261102-isolated/{isolate-jvm.gradle,android-build.log,junit.json}` | 외부 init script로 worker 분리 진단: app118 PASS. 최종 기본 명령 결과와 구분 |
| `20261102-final/android-build.log`, `junit-{app,core}/`, `junit.json` | 저장소 테스트 설정을 사용한 기본 명령(외부 init 없음): app118 PASS, core37+기존skip1; Debug/Release APK/AAB/lint PASS |
| `20261102-final/{identity-boundary,tire-boundary,receiver-boundary,native-js}.log` | 최종 격리 및 합성 Kotlin→JS PASS. 새 테스트 클래스도 APK/AAB에 없음 |
| `20261102-final/{artifacts.json,debug-bytes.json,apk-signature.log,lint.xml,*.apk,*.aab}` | APK/자산 source/hash, v2 서명, lint0 errors/23 warnings. Debug SHA `5473b015…12c2ad11`; Release APK/AAB와 GLB는 기존 hash 유지 |

Native Back은 실제 Activity create 단계의 Robolectric4로 확인하고 lease resume는 하지 않았다. 최종 Native generation은 pause/destroy 시 late callback을 무효화한다. desktop에서 import한 Android shell JS는 실기기 입력·렌더 증거가 아니다. PR 최종 CI는 Checks와 외부 CI snapshot으로 별도 확인한다. 이전 P3-I4/CI 수치를 새 실행으로 재사용하지 않는다.
