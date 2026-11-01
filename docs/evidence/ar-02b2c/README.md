# AR-02B-2C evidence index

2026-11-02 KST. 독립 Worktree `C:\dev\CarScope-sync-device`, branch `feat/ar-02b2c-device-sync-readiness`, base main/PR #37 merge `c89b6e47765b0950610842c97270f504258024ab`. 기존 Codex B 사본은 clean 상태로 보존했다. Codex A의 다른 Worktree/브랜치를 변경하지 않았다.

외부 원본: `C:\CarScope-External\ar-02b2c\2026-11-02`. 인증서/개인키/로그/APK/DB/QR screenshot 원본을 Git에 넣지 않는다. Android 화면 캡처는 생성하지 않았다. 브라우저 캡처는 합성 환경이며 민감한 QR 영역을 공개 첨부하지 않는다.

## 실제 실행 결과

| 검사/명령 | 결과 | 근거 및 범위 |
| --- | --- | --- |
| `:app:testDebugUnitTest --tests io.carscope.app.sync.*` | PASS 46 | `gradle-focused-recheck.txt`; 기존 Receiver17 + Decoder8 + HTTPS10 + UI8 + 진입3 |
| `:vehicle-core:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug` | PASS | `gradle-full.txt`, BUILD SUCCESSFUL. App114, 실패/오류/skip0. Core38 중 기존 skip1, 실패0 |
| Native 진입/복귀 | PASS (Robolectric) | 실제 InspectionActivity의 Native sibling/WebView 배치. test host에서 explicit Intent/연타/Back/pause/resume 검사. 실제 Inspection SDK lease Runtime 검증 아님 |
| QR/credential lifecycle, decoder/Digest | PASS (JVM/Robolectric) | 기존 assertion 유지. invite 만료 UI/NETWORK·TIMEOUT·INVALID 안내 추가. actual Node HTTPS 수락 왕복도 기존 10개 suite에서 실행 |
| `python tools/inspection-sync-poc/android/check-boundary.py` | PASS | 실제 Debug APK, Release APK/AAB DEX/manifest. 새 entry Debug only, test host/provider 모두 패키지 제외. 기존 Receiver17 유지 |
| `python tools/identity-probe/check.py build-contract` | PASS | 기존 Identity/visual/WebView 격리 |
| `python tools/tire-probe/check.py build-contract` | PASS | 기존 Tire Debug/Release 격리 |
| `node tools/three-poc/check-tire-native-contract.mjs app/build/test-results/tire-ui-v1.json` | PASS | 기존 Kotlin→JS 합성 계약, SDK Runtime 아님 |
| `python tools/inspection-sync-poc/android/test-device-readiness.py` | PASS 7 | serial/AVD 불일치 시 중단, read-only 명령, HTTPS origin/evidence 경계, host GET/redirect/TLS 실패 비노출 |
| readiness CLI, `adb devices -l` | BLOCKED device | `readiness.json`: 연결 기기 없음. boot/WebView/Vehicle Service/Android TLS 미검증 |
| `npm run verify:local` | PASS | `node/summary.json`: check, legacy48, full69, SQLite21, AR0131. Node22.16.0 |
| `npm run test:browser` (sync) | PASS 11 | `legacy-browser/summary.json` |
| `npm run test:browser` (mobile-ar-poc) | PASS 16 | 별도 `C:\CarScope-External\qr-ar-01\ar-02b2c-2026-11-02\browser-results.json` |
| `npm run test:mobile-browser` | PASS 17 | `mobile-browser/mobile-summary.json`, errors=[] |
| `git diff --check`, scope/secret review | PASS | 새 dependency/manifest/Gradle/Vercel 변경 없음. 실제 token/인증서/DB/생성 asset 포함 없음 |

Windows/JDK17.0.20/Node22.16.0/Android public API34, 기존 Gradle cache 사용. `npm ci --ignore-scripts` 후 기존 inspection/lab asset 생성기를 실행했으며 ignored Debug build assets만 생성했다. tools/three-poc 소스는 변경하지 않았다. 브라우저 Edge156 headless, loopback 동일 PC 합성 환경이다.

lint는 **0 errors/23 warnings**다. 기존 21개에 새 Native Debug 버튼의 번역 리소스 관련 SetTextI18n 2개가 추가됐다. 경고를 숨기거나 lint 기준을 완화하지 않았다. 다국어 리소스 정리는 후속 UI 과제로 남긴다.

## 실패 기록

첫 집중 실행은 새 테스트 Activity의 public 속성이 internal 타입을 노출한 Kotlin compile 오류로 실패했다(`gradle-focused.txt`). 해당 테스트 속성을 private으로 수정했고 이후 집중46/전체114가 통과했다. 기존 assertion을 삭제/완화하지 않았다. PR #37의 간헐적 TLS NETWORK 실패는 이번 집중/전체 로컬 실행에서 재발하지 않았다. CI에서도 재발 시 원인을 조사하고 실패로 기록한다.

## 실제 기기 상태 및 실행하지 못한 범위

readiness에 준 `emulator-5554`는 **명시적 후보 serial**이며 연결된 실제 장치를 확인했다는 뜻이 아니다. adb devices empty로 다른 기기를 자동 선택하지 않았다. 호스트 free RAM은 관측 시 약 4GiB(`host-memory.json`). AVD 생성/설치/강제 부팅/재시작/SystemUI·SDK 종료/다른 앱 세션 덮어쓰기는 하지 않았다.

| 범위 | 판정 |
| --- | --- |
| Host에서 임의 API HTTPS probe | NOT_RUN — 검증된 대상 origin 미제공. JVM TLS fixture와 구분 |
| 실제 Android boot/API/WebView/Vehicle Service/SystemUI 안정성 | BLOCKED — 연결 장치 없음 |
| 실제 Inspection pause/resume Tire lease·3D 복귀 | BLOCKED Runtime — 소스 호출 유지와 Robolectric 진입 계약만 PASS |
| Android HTTPS checkConnection / 인증서 신뢰·도달성 | BLOCKED |
| 폰 HTTPS·광학 QR·점검·전송·ACCEPTED | BLOCKED |
| 실제 두 기기 E2E 1~12 및 실패 시나리오 | NOT_RUN/BLOCKED — [절차](../../ar-02b2c-device-sync-readiness.md)의 조건 미충족 |
| 생성 인증/차량 소유권/Production Sync | BLOCKED — 기존 양쪽 기본 거부 유지 |

따라서 실제 두 기기 성공이나 차량 센서 진단 성공을 주장하지 않는다. 로컬 합성 환경 PASS와 실기기 결과를 합치지 않는다. 후속 인증 서비스/기기 trust/모바일 same-origin 준비와 안전한 승인 대안은 실행 절차 문서에 명시했다.

## 변경 격리 및 CI

공통 Android 변경은 InspectionActivity의 Native entry 연결 6행 추가/1행 교체뿐이다. 기존 Tire/WebView lifecycle 호출을 유지했다. DebugWebScreen, Three.js/Geometry/모델, Tire SDK/Controller, vehicle-core, AR-01 schema, 서버 API/authorizer, Vercel 설정은 base main 대비 변경 없음이다. 새 Native entry와 테스트, Sync UX, readiness 도구, boundary 검사, 문서만 포함한다.

기존 Android CI의 Receiver boundary step이 새 suite 수/패키징과 Python readiness 테스트도 실행한다. CI workflow 자체는 수정하지 않았다. 최종 CI와 PR 준비 판정은 PR Checks/본문 및 최종 보고에서 확인한다. 자동 병합하지 않는다.
