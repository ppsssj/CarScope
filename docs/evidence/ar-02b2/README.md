# AR-02B-2A 증거 인덱스

2026-11-01, Windows x64 / Node 22.16.0 / JDK 17 / Edge 156.0.4314.58.
시작 main `6eedb3b` (PR #33 MERGED), 작업 중 PR #34 main `95806d8` 반영.
새 worktree는 만들지 않았다. 원본 로그·DB·키·APK·캡처는 Git 제외이며 이 인덱스만 공유한다.

## 검증 등급

| 등급 | 상태 | 실제 범위 |
| --- | --- | --- |
| A. 순수 계약 | PASS | v1/v2 strict parser, Receipt/Digest, 결과 allow-list, 상태·재시도·lifecycle |
| B. Node/Playwright E2E | PASS | 같은 PC의 AR-01 DOM + loopback API + SQLite + Node receiver 시뮬레이터 |
| C. Kotlin Fake transport | PASS | Debug 수신기 client/controller 17개; 실제 HTTP/Activity 아님 |
| D. Android AVD Runtime | BLOCKED | adb 기기 없음, 수신 Activity/HTTP/auth/TLS 미준비; AVD 조작 안 함 |
| E. 실제 스마트폰↔Android↔HTTPS API | BLOCKED | 등록·실제 차량 인증, endpoint, 폰/Android TLS trust 미검증 |

브라우저 v2 E2E는 fragment URL로 진입하며 광학 QR 스캔을 실행한 것이 아니다. 카메라 회귀는 합성 fixture다.
기존 실행 결과와 이번 실행을 섞지 않으며, Node의 테스트 CA 성공을 폰/AVD 신뢰로 간주하지 않는다.

## 실행 명령과 근거

기본 준비: `npm ci --ignore-scripts --prefix tools/mobile-ar-poc` (기존 lockfile, 새 dependency 없음).
sync package에서:

| 상태 | 명령 | 결과 |
| --- | --- | --- |
| PASS | `npm run check` | 기존·신규 모듈 syntax |
| PASS | `npm run test:legacy` | 기존 AR-02A 48개 assertion 보존 |
| PASS | `npm test` | 기존 60개 + 모바일 계약 9개 = 69개 |
| PASS | `npm run test:sqlite` | 기존 21개, race 8개 전체 포함; memory-loss 자체 사례는 memory 유지 |
| PASS | `npm run test:ar01` | 기존 AR-01 31개 assertion, PR #33의 테스트 전용 시계 유지 |
| PASS | `npm run test:mobile-browser` | 통합 v2 Edge 17개 시나리오 |
| PASS | `npm run test:browser` | 기존 AR-02A Edge 11개 |
| PASS | mobile package `npm run test:browser` | 기존 AR-01 Edge 16개 |

`SYNC_EVIDENCE_DIR=C:/CarScope-External/ar-02b2/2026-11-01/final`에서 `npm run verify:local`이
summary.json과 check/test-legacy/test/test-sqlite/test-ar01 로그를 기록했다.
브라우저 원본은 같은 ar-02b2 디렉터리의 mobile-browser-final/ 및 legacy-browser/,
AR-01은 `C:/CarScope-External/qr-ar-01/ar-02b2-2026-11-01/`에 있다.
추가 브라우저 실행은 해당 script와 SYNC_EVIDENCE_DIR/POC_EVIDENCE_DIR를 명시해 재현한다.

통합 17개는 direct/v1 보존, malformed v2 제거, 완료→중복 Send→Receipt, 명시적 수락,
reload, used QR, cancel, expire, lost Claim, offline, lost submitted response의 idempotent retry,
500 bounded retry, 429, 잘못된 Digest, SQLite/API restart, 401, CSP/module/no-page-error/viewport를 포함한다.
테스트는 주입 시계를 시나리오 사이 다음 rate window로 진행하며 서버 제한 숫자를 올리지 않는다.
토큰 원문은 테스트 로그/스크린샷/DOM/storage에 남기지 않는다. invite와 submit token을 URL/DOM 검사에 사용한 뒤 테스트 메모리만 버린다.

Android 명령(같은 worktree의 임시 영문 R: 매핑, JDK 17, SDK C:/Android/Sdk):

```powershell
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
python tools/inspection-sync-poc/android/check-boundary.py
```

core PASS: 38개, 실패 0, 기존 skip 1. PR #34 반영 후 app debug unit 83개/실패 0/skip 0,
APK/AAB/lint와 release 격리 검사 PASS다. 수신기 새 테스트는 17개다.
PR #34 반영 후 기존 Debug 자산은 저장소의 build-android-inspection/build-android-lab 생성기로 재생성했으며
생성 자산은 Git에 넣지 않는다. SDK/모델 원본·Pleos API·공통 Activity/Gradle/manifest는 수정하지 않는다.

## 최초 실패와 수정

- 최초 Gradle 호출은 PowerShell에서 점이 있는 `-Pkotlin.compiler.execution.strategy` 인자가 분리되어 task-not-found였다.
  인자 전체를 quote한 같은 task 재실행으로 해결했다. 테스트를 삭제/skip하지 않았다.
- 브라우저 자동 polling 중지 문제는 native timer를 객체 메서드로 호출한 바인딩 문제였다.
  unbound wrapper와 계약 회귀를 추가했고 만료 UI를 점검 완료 전에도 확인했다.
- 서버 restart의 Node read는 오래된 keepalive socket으로 ECONNRESET이 가능했다.
  합성 receiver의 읽기만 1회 제한 재시도하고 같은 credential/세션으로 복원 상태를 검증했다.
- Host 거부 검사는 fetch가 Host를 정규화해 처음 실패했다. raw Node HTTP로 실제 Host를 전송해 403을 검증했다.
- AR-01 원래 시계 혼용 결함은 수정/은폐하지 않고 PR #33의 독립 clock harness를 유지했다.
- 최초 PR의 [Geometry CI](https://github.com/ppsssj/CarScope/actions/runs/41297999818)는 새 테스트의 staging builder import가
  설치되지 않은 qrcode를 요구해 FAIL이었다. Geometry 검사를 변경하지 않고 core sync 테스트의 외부 import를 제거했다.
  실제 staging 산출물의 개발 모듈 제외 검사는 기존 AR-01 staging 사례에 assertion을 추가했다. 원래 assertion은 모두 유지한다.

## 변경 격리와 CI

최신 main 대비 app 변경은 신규 debug/sync와 testDebug/sync뿐이다.
InspectionActivity/DebugWebScreen/debug manifest/app Gradle/Tire/tools-three-poc/vehicle-core 변경은 없다.
main 반영 때 충돌한 identity CI는 기존 Tire·Identity 검사와 신규 sync release 검사를 모두 유지했다.
Codex A의 미병합 브랜치를 포함하지 않았다.

Inspection sync CI는 Linux/Windows 계약·SQLite·TLS와 AR-01 시계 회귀를 실행하고 Windows에 통합 mobile E2E를 추가했다.
Identity CI는 기존 APK/AAB/lint/격리 검사에 sync DEX/권한/테스트 검사를 추가했다. Geometry CI는 변경하지 않았다.
PR 최종 HEAD의 실제 check 결과와 링크는 PR 설명/최종 보고에서 확인한다.
