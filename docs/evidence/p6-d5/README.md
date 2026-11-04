# P6-D5 evidence index

2026-11-04 KST, `C:\dev\CarScope`, main baseline
`f58c575609c48c4b4ffb6c903cd821dbae031df5`.
[조사·최종 결과·재실행 명령](../../p6-d5-avd-auth-runtime.md).

원본 로그, 캡처, JSON 인증 파일, APK/AAB, DB URL과 credential은 이 디렉터리에
넣지 않는다. 자동 검사의 로컬 XML은 Git 제외 build 경로에 있으며 재실행 시 교체된다.

| 근거 위치 | 범위 |
| --- | --- |
| `app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.AvdSimulatorProvisioningTest.xml` | JSON/시간 계약, generation, 중복·동기·늦은 callback |
| `app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.HttpsAvdSimulatorGrantExchangeTest.xml` | fake HTTPS connection을 이용한 실제 exchange/provider 연동; 실제 TLS 검증 아님 |
| `app/build/test-results/testDebugUnitTest/TEST-io.carscope.app.sync.AvdSimulatorActivityTest.xml` | Robolectric 버튼 gating, 만료, stop/recreate; 실제 AVD 아님 |
| `app/build/test-results/testDebugUnitTest/TEST-*.xml` | 전체 Android JVM/Robolectric 검사 |
| `vehicle-core/build/test-results/test/TEST-*.xml` | fresh coreOnly 재실행 |
| `app/build/outputs/apk/{debug,release}/`, `app/build/outputs/bundle/release/` | 새 빌드 후 boundary checker 입력. 저장소에 추가하지 않음 |
| 터미널 `npm test` 요약 | Node 111개 중 107 PASS / 4 SKIP(PG_TEST_URL 없음) |
| credential-free `/healthz` 필드만 확인 | UP / STATEFUL_DENY_DEFAULT / DENIED; Android TLS/인증 성공의 근거가 아님 |
| `adb devices` 및 host process/memory 조회 | exact AVD 부재; 실제 grant/QR/폰 E2E NOT_RUN |
| `C:\CarScope-External\p6-d5-readiness-20261104.json` (Git 외부) | 2026-11-04T05:08:06Z read-only gate: NO_EXACT_CONNECTED_DEVICE. 이 도구의 host probe는 NOT_RUN이며 별도 health 관측과 구분 |

수정 전 중복 callback 회귀 테스트는 4개 중 1개 FAIL이었다. 이 실패와 과거 실제 AVD
장애를 같은 원인으로 간주하지 않는다. 최종 수치와 실패/중단 후 재실행은 보고서에 구분한다.
