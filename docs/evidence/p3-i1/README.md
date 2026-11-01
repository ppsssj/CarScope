# P3-I1 외부 증거 인덱스

원본 위치: `C:\CarScope-External\p3-i1`. 로그·캡처·APK·SDK·GLB·개인 설정은 Git에 포함하지 않는다. 이 PC의 로컬 경로이며 CI에서 다운로드 가능한 artifact 링크가 아니다. [보고서](../../p3-i1-tire-3d-integration.md), [UI 계약](../../contracts/vehicle-tire-ui-v1.md).

| 경로 | 내용 |
|---|---|
| `health/health.json`, `health-final/health.json` | 시작/종료 AVD gate BLOCKED, emulator-5554 없음 |
| `baseline.log`, `baseline-ui.log` | 초기 core/app 및 기존 18개 UI 테스트 |
| `status-unit-final.log`, `kotlin-tests.log`, `full.log`, `core-only.log` | 최종 상태 계약·소유권·기존 회귀 및 필수 빌드/lint |
| `packaging-final.log`, `final-assets.log` | 상태 모듈 복사·상대 import·최종 Debug APK 재생성 |
| `status-wide-badges/`, `status-portrait-badges/` | 실제 Chrome 1600×1000 / 420×860, **합성 MOCK 상태만**. actions/results/browser-log와 캡처 |
| 위 두 폴더의 `01-kotlin-mock.png` | 실제 Kotlin serializer의 합성 JSON → 브라우저. raw 값 없이 상태/시각만 표시 |
| `02-varied-states.png`, `tire.*.png` | 네 ID × 두 feature 매핑과 선택 유지 |
| `03-stopped.png`, `04-invalid-rejected.png` | lifecycle 무효화, 잘못된 packet 거부·ERROR 표시 |
| `tire-final-wide/`, `tire-final-portrait/` | 기존 실제 raycast/목록·강조·시점/scroll/focus 복원·회전/resize 회귀 |
| `components/`, `washer/` | 기존 4개 부품·보닛·LCW·QR 회귀 |
| `verification.json` | suite별 결과, Debug APK 모듈 바이트 대조, Release 격리와 artifact hash |

초기 `status-wide/`, `status-portrait/`, `tire-wide/`와 `debug-actions.json`은 timer receiver / 테스트 URL 인자 문제 조사 자료다. 최종 PASS 폴더와 구분한다. 중간 `status-*-final`은 배지 스타일 적용 전 결과이며 최종 캡처는 `status-*-badges`다.

실제 Android WebView/private HTTPS endpoint/Activity 재생성/Pleos SDK 데이터 수신/실차의 이번 실행 증거는 **없다**. JVM 계약 검사와 데스크톱 Chrome 합성 결과를 실제 AVD PASS로 해석하지 않는다. 합성 timestamp 100ms는 unit test의 가상 clock이며 실제 관측 날짜가 아니다.
