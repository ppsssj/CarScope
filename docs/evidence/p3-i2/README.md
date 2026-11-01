# P3-I2 증거 인덱스

로컬 원본: `C:\CarScope-External\p3-i2`. PC/장치 원본 자료·캡처·로그·JSON·APK·SDK·GLB는 Git에 넣지 않는다. [보고서](../../p3-i2-tire-avd-runtime.md), [재실행 계획](../../p3-i2-runtime-test-plan.md).

| 경로 | 내용 |
|---|---|
| `initial-health/` | 첫 읽기 전용 환경 수집, AVD 부재 BLOCKED |
| `blocked-run/`, `final-health/`, `final-guarded-request/` | `--run --install` 요청도 gate에서 차단. commands.json에는 devices -l만 존재, 실제 설치·실행 없음 |
| `host-inventory.json` | Windows/SDK/CPU/RAM/disk/AVD config 존재, 원본 GLB hash |
| `runtime-python.log`, `runtime-evidence.log` | 새 도구의 가짜 ADB/합성 응답 분류·안전 차단 테스트. 실제 SDK 결과 아님 |
| `baseline-ui.log`, `baseline.log` | 기존 P3-I1 검사 시작 기준 |
| `ui-tests.log`, `lifecycle-tests.log`, `full.log`, `core-only.log`, `packaging.log` | 기존 재실행 + 추가 lifecycle 및 필수 빌드/lint |
| `status-wide/`, `status-portrait/` | 기존 P3-I1 합성 MOCK 상태 Chrome 검사 재실행, actions/results/log/PNG |
| `tire-wide/`, `tire-portrait/` | 기존 G1 실제 CDP pointer·회전·선택·확대/복원·resize 재실행 |
| `components/`, `washer/` | 기존 4부품·LCW·보닛·QR 회귀 |
| `verification.json` | 최종 JUnit suite, 브라우저 결과, Debug APK 자산 byte 일치·Release 격리 및 artifact hash |

이번 실제 Android 화면/endpoint/SDK snapshot/Vehicle Service 관측 자료는 **없다**. screenshot은 데스크톱 Chrome의 합성/3D 회귀이며 Android WebView/실차 증거가 아니다. 도구의 실제 AVD 양의 경로는 NOT_RUN이다. BLOCKED 기존 결과를 합성 PASS로 대체하지 않았다.
