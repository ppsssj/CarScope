# P3-I2 — Android Tire 런타임 검증 준비와 수명주기 회귀

작성: 2026-11-01. **실제 AVD 실행은 BLOCKED**다. P3-I1의 실제 Android/WebView/Pleos 미검증을 해제하지 않는다. 이번 결과는 환경 증거, 안전한 실행 도구, 추가 합성 회귀 및 기존 검증의 재실행이다.

## 시작 상태와 환경

- 기존 Tire integration Worktree `C:\dev\CarScope-tire-integration`는 `feat/p3-i1-tire-3d-integration`, HEAD `2708d7f`, clean이었다. 기존 변경을 삭제하지 않았다.
- fetch 후 main `95806d8dd9298d766021dc022298745753031900`, PR #34 MERGED(2026-11-01 10:10:27 UTC) 확인. 최신 main에서 `test/p3-i2-tire-avd-runtime` 생성.
- 실제 호스트: Windows 10 Home x64 10.0.19045, logical CPU 4, Python3.11.9, Node22.16.0, JDK17/Gradle8.14. 호스트 RAM 약 15.9GiB, 수집 시 여유 약 4.2GiB, C: 여유 약 89.4GiB. 원본 PC 식별자/메모리/디스크 자료는 외부 증거에만 보관한다.
- SDK `C:\Android\Sdk`의 adb/emulator/API34 android.jar와 build-tools35 aapt 존재 및 debuggable APK badging 확인. `CarScope_Pleos_API34` config는 존재하지만 연결/기동된 장치는 없다. 호스트 설치 확인을 게스트 부팅 성공으로 해석하지 않는다.
- Vehicle SDK2.3.2는 프로젝트 의존성이다. Service2.3.22/API34는 기존 환경 기록이며 **이번 게스트 실제 버전은 미관측**이다.

## Health Gate와 실행 결과

`tools/tire-probe/runtime/run.py`의 읽기 전용 기본 호출 및 `--run --install` 요청 모두 gate에서 BLOCKED로 종료했다. 설치 옵션을 주어도 기록된 ADB 명령은 **`devices -l` 하나**이며 장치 목록이 비었다. 예: 2026-11-01 10:37:58 UTC, ADB 62ms / exit0. 마지막 `final-health/health.json`도 10:42:46 UTC에 동일한 부재를 확인했다.

| 항목 | 실제 결과 |
|---|---|
| 호스트 SDK/API34/ADB 설치, Debug APK offline preflight | PASS — 로컬 파일·aapt/자산 검사 |
| emulator-5554 / 대상 AVD 연결 | BLOCKED — 목록에 없음 |
| boot/SystemUI/WebView/Vehicle Service/게스트 memory/storage | NOT_RUN — 게스트 명령을 보내지 않음 |
| APK 설치·모델 주입·Activity 실행·forward/CDP | NOT_RUN — gate 차단 |
| 실제 Native endpoint fetch / Android WebView / 3D 상태 반영 | BLOCKED |
| 실제 SDK capability/getter/listener/late callback/STALE/정리 | BLOCKED |
| 실차 및 원격 SDK cleanup acknowledgement | NOT_RUN / 미검증 |

AVD 생성·재시작·이미지 재설치·SystemUI 우회·Windows 설정 변경·SDK 강제 취소/종료·자동 MOCK 전환을 하지 않았다. 이번 작업의 실제 Android 화면·SDK 수신 JSON은 없다. [증거 인덱스](evidence/p3-i2/README.md).

## 실행 도구

- `health.py`: 명시적 serial + 정확한 AVD identity, SDK 설치, boot/API34, CPU/load, memory/disk, SystemUI 안정성, WebView provider, 현재 user의 활성 Vehicle Service/version과 응답 시간 수집. 구체적인 예산은 [실행 계획](p3-i2-runtime-test-plan.md)에 기록했다.
- `run.py`: 기본 읽기 전용, 새 gate PASS 후에만 선택적 설치/실행. 실행 중인 CarScope는 다른 작업 소유 가능성이 있어 차단한다. 로컬 debuggable APK 및 설치된 APK hash를 대조하고 기존 app-private/run-as/SHA 모델 주입 절차를 사용한다. 원본 GLB는 읽기만 한다.
- `webview.mjs`: 이 앱 PID의 기존 DevTools socket만 사용한다. private origin의 단일 보이는 page, 실제 Network GET/JSON/header와 JS store, 네 타이어 선택/강조/시점 복원, Probe 화면 전환을 관측하도록 작성했다. 소켓이 없으면 BLOCKED이며 native bridge/debug 설정을 추가하지 않는다.
- `evidence.mjs`: strict 8행 계약, PLEOS source, no-store, 검증한 APK와 동일한 CSP, UI store 일치를 대조한다. 일부 capability 결과나 MOCK·오류를 전체 SDK 지원 성공으로 바꾸지 않는다.
- 매 실행 새 evidence 디렉터리와 run ID를 사용한다. 기존 결과 덮어쓰기, 다른 run ID 결과/비정상 exit의 PASS 재사용을 막는다. 포트는 이번 run의 forward만 정리하고 전역 remove-all/logcat clear/force-stop을 사용하지 않는다.

**양의 AVD 경로는 실제 장치에서 실행하지 못했다.** 도구의 구문·증거 classifier·오프라인 차단 경로 검증과 실제 Android 호환성은 구분한다. SDK callback/release ack, OS 회전/renderer 종료처럼 도구로 증명하지 못한 항목은 자동 PASS하지 않는다. 앱이 중단 시 남을 수 있으며 이를 강제 종료해 정리하지 않는다.

## 신규 검증과 기존 재실행

| 구분 | 명령/대상 | fresh 결과 |
|---|---|---|
| 신규 | Runtime Python guard 테스트 | PASS — 10개, 잘못된 장치/identity race/실행 중 앱/자원·서비스/증거 재사용 차단 |
| 신규 | Runtime response classifier 및 경로 guard | PASS — Node 4개, private GET/CSP/no-store/8행/PLEOS·부분 capability·금지 필드/잘못된 output 거부 |
| 신규 | visibility/native lifecycle binding | PASS — 1개 추가, 가짜 Window/Document와 late response/dispose 검증 |
| 신규 | Kotlin channel 세대·경쟁·정리 실패 | PASS — 2개 추가, source의 실제 pending gate를 fake SDK로 검증 |
| 기존 재실행 포함 | `node --test tools/three-poc/test/*.test.mjs` | PASS — 28개(기존 27 + 신규 1) |
| 기존 재실행 포함 | `:app:testDebugUnitTest --rerun-tasks` | PASS — 68개(기존 66 + 신규 2), Door 19 / 기존 projection·origin 포함 |
| 기존 재실행 | `:vehicle-core:test` 및 별도 `-PcoreOnly=true :vehicle-core:test --rerun-tasks` | PASS — 37 pass / 기존 optional IONIQ5_PARTS 1 skip |
| 기존 재실행 | Kotlin serializer → JavaScript validator | PASS — 합성 MOCK metadata 8행, raw 수치 없음 |
| 기존 재실행 | 상태 UI Chrome 1600×1000 / 420×860 | PASS — 각각 14 assertions, MOCK 합성 상태·선택/pose/load 유지 |
| 기존 재실행 | G1 Chrome 1600×1000 / 420×860 | PASS — 각각 39 / 36 assertions, 실제 pointer·선택·강조·확대/복원·회전/resize |
| 기존 재실행 | 부품·보닛·QR Chrome | PASS — 부품 34 / 워셔액·보닛·QR 17 assertions |
| 기존 재실행 | Debug module packaging | PASS — 상대 import/CSP/최종 자산 일치 |
| 기존 재실행 | assembleDebug / assembleRelease / bundleRelease / lintDebug | PASS — full build 106 tasks 실행, lint 오류 0 / 기존 warning 14 |
| 기존 재실행 | `identity-probe` / `tire-probe` build-contract 및 APK byte 검사 | PASS — Debug 상태 모듈 6개 소스 일치, Release 자산·권한·클래스 격리, 외부 GLB 없음 |
| 정적 검사 | WebView driver `node --check` | PASS — 구문만, 실제 WebView 명령 호환성은 NOT_RUN |
| 실제 환경 | 도구 기본/설치·실행 요청 | BLOCKED — 실제 ADB 목록 수집과 차단 경로만 실행 |

CI에는 emulator를 기동하지 않는 독립 `Tire runtime guards (no emulator)` job을 추가했다. 기존 Geometry/Android/JVM job을 줄이거나 AR 검사·배포 설정을 변경하지 않았다. 전체 빌드에는 `--max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" "-Pkotlin.compiler.execution.strategy=in-process"`를 사용했다.

새 검증은 visibility/native lifecycle binding의 duplicate enable·hidden 상태 active·late body·dispose 후 listener 제거, UI 세대/sequence 재생성 및 중복 start/read의 SDK 중복 생성 차단, unregister 실패 후 channel 재생성과 이전 Probe stop의 격리를 다룬다. 이는 가짜 SDK/이벤트 타깃을 사용한 seam 테스트이며 실제 Activity 복원 결과가 아니다.

기존 P3-I1의 27 UI / 66 app 및 브라우저 합성 결과는 이번 main에서 재실행한 회귀다. 새 SDK 성과로 다시 계산하지 않는다. 새 도구 작성 중 import 경로·출력 경로·증거 freshness·부분 capability 집계의 오류를 테스트/검토로 바로잡았다. 기존 제품 코드의 실제 결함은 재현되지 않아 **SDK/Native 상태/WebView/UI 운영 코드를 수정하지 않았다.** 기존 assertion이나 상태 정책을 약화하지 않았다.

## 8개 실제 SDK 상태

| vehiclePartId | tire.pressure Capability / Availability | tire.low-pressure Capability / Availability | 근거 |
|---|---|---|---|
| tire.front-left | BLOCKED / 미관측 | BLOCKED / 미관측 | AVD 없음 |
| tire.front-right | BLOCKED / 미관측 | BLOCKED / 미관측 | AVD 없음 |
| tire.rear-left | BLOCKED / 미관측 | BLOCKED / 미관측 | AVD 없음 |
| tire.rear-right | BLOCKED / 미관측 | BLOCKED / 미관측 | AVD 없음 |

위 BLOCKED는 시험 판정이며 wire의 TireStatus 값이 아니다. 실제 UI에 임의의 UNSUPPORTED/0/정상 값으로 채우지 않는다. 모든 raw 수치·단위·저압/안전 판정 비노출 정책과 두 feature의 독립성, 별도의 sessionPhase UNRESOLVED를 유지했다.

## 보안·수명주기 판단과 잔여 위험

기존 private HTTPS GET, 정확한 host/path와 query/fragment/method 검사, no-store/CSP, JavaScript Interface 미사용, Native allowlist/JS strict validation 및 Release 격리가 회귀를 통과했다. 실제 WebView transport에 대한 성공 증거는 없다. HTTP 요청 URL 정규화와 parser의 fragment 검증을 혼동하지 않는다.

실제 AVD가 없으므로 SDK 초기화/연결 완료, 두 feature의 실제 지원 영역, 권한 부여, getter/listener 수신, Android lifecycle/renderer 종료, 원격 release 완료를 보증할 수 없다. initialize/release 호출 반환을 callback 또는 원격 완료 acknowledgement로 표시하지 않는다. 기존 영구 pending/worker 보유 한계도 남아 있다. 강제 복구를 추가하지 않았다.

READY_TO_MERGE 판단은 **AVD 부재 시 허용된 도구·회귀 완료 범위**에 한정한다. 실제 Tire Android 런타임 승인과 실차·수치 표시 준비는 BLOCKED다. 건강한 격리 AVD에서 [체크리스트](p3-i2-runtime-test-plan.md)를 수행하고 공식 단위/의미·실제 업데이트 주기·실차 매핑을 확인한 뒤 수치 표시를 별도 검토한다. PR 자동 병합은 하지 않는다.
