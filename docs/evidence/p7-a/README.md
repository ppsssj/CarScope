# P7-A 증거 인덱스 — 2026-11-04

원본은 `C:/CarScope-External/p7-a/`에 보관한다. 캡처·로그·SDK·APK·기기 설정·토큰은 Git에 넣지 않는다. 이 인덱스와 [보고서](../../p7-a-pleos-runtime.md)는 실행 범위 및 재현 명령만 공유한다.

환경: Windows / JDK 17.0.20 / Node 22.16.0 / Python 3.11 / Gradle 8.14 / SDK 2.3.2. `CarScope_Pleos_API34`, emulator-5554, API34, user10, Vehicle Service 2.3.22/code74. 시작 때 연결 AVD가 없어 기존 정의를 `-gpu host -no-snapshot`으로 시작했다. 앱 데이터·기존 등록 파일은 보존했다.

| 외부 증거 | 결과와 한계 |
| --- | --- |
| `sdk-audit/summary.json` | 고정 AAR SHA 및 공개 capability/get/listener/permission 검사 PASS. runtime 증거 아님 |
| `core.log` | `-PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 37 PASS/1 SKIP, 외부 자산 미지정 |
| `verified-build.log`, 모듈 JUnit XML | app 205 PASS; Debug/Release APK·Release AAB·lint PASS(0 error/23 warnings). 마지막 실행은 10 task executed/96 up-to-date. 직전 `build-retry.log`는 106 task rerun PASS(기존 200 tests), 신규 변경 후 마지막 app 205 tests를 새 실행 |
| `focused-retry.log` | Native brake, actual TLS 7-task E2E, Activity QR/Accept, component diagnostics 등 40 tests PASS |
| `node-tests.log`, `node-assets.log` | 3D UI 81 PASS, Android 자산 통합 1 PASS |
| `sync-node.log` | sync Node 107 PASS/4 SKIP(PG_TEST_URL 미설정); 실제 Postgres 검증 아님 |
| `*-boundary-final.log`, `sync-boundary-verified.log`, `final-gates.json` | Component/Tire/Identity/Sync Debug·Release 경계 PASS; 체크리스트 profile도 Release APK/AAB 부재 확인 |
| `native-contracts-final.log` | 실제 Kotlin 합성 serializer→JS strict consumer. AVD 증거 아님 |
| `avd-first/results.json` | 실제 Native JSON 4채널과 JS store reading 일치, PLEOS 출처·STALE·관측 시각 보존 PASS |
| `avd-first/{washer,brake,battery,charge,wiper,light,tire}.png` | 실제 AVD 7개 상태 패널 캡처. 배터리 화면을 직접 열어 PLEOS/100/false/STALE 및 3D 표시 확인. 오류/미확인도 그대로 캡처 |
| `runtime-current.log`, `runtime-first.log` | 실제 capability/current/event 분리. SoC 100, switch false, port false, wiper OFF, low OFF, high ON. washer timeout·brake SDK 오류·tire timeout을 성공으로 취급하지 않음 |
| `exit-info.txt`, `lastanr.txt`, `bugreport.zip` | 앱 pid4495 focus-event ANR, main→HWUI drawFrame 대기, RenderThread→QEMU GL pipe/encoder read. Component/Tire workers는 queue 대기. 전체 원인 미확정이며 SDK worker deadlock으로 단정하지 않음 |
| `bugreport-extracted/FS/data/anr/anr_2026-11-04-08-19-47-683` | bugreport로 확보한 ANR 원본. 직접 shell read는 permission denied였고 보안 우회 없이 bugreport 사용 |

런타임 APK SHA256 `d47f3907ba999774922b14b49ca5465316069fabfc6e595279124da3fbdce2a9`, 모델 SHA256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`. debug APK는 user10에 `install -r`로 설치하고 기존 private 모델 경로에 동일 GLB를 hash 검증해 배치했다. 읽은 상태를 주입한 것이 아니다. AVD Console 차량 제어·실차 호출·외부 인증 요청·Render/DB 설정 변경은 하지 않았다.

## 실패 이력과 중단

처음 asset 준비는 npm dependencies 부재로 FAIL, `npm ci --ignore-scripts --prefix tools/three-poc` 후 재생성 PASS. 첫 Gradle 호출은 PowerShell의 비인용 `-Pkotlin.compiler.execution.strategy=in-process` 분할로 FAIL, 인용 후 PASS. 브레이크 음성 테스트 중 한 mutation이 canonical key 순서 때문에 원문을 바꾸지 않아 FAIL; 정확한 삭제 문자열로 고쳤다. 7-task E2E를 기존 revocation 시나리오와 한 fixture에 결합하면 기본 rate limit에 도달해 권한 거부 기대가 FAIL; 별도 fixture 실행으로 분리했고 rate limit을 늘리지 않았다. 수정 후 40 focused 및 전체 205 tests PASS.

boundary의 첫 시도는 전체 테스트가 기존 XML을 교체하는 동안 실행하여 일부 report가 없어 FAIL. 테스트 완료 뒤 재실행 PASS. unittest stderr 리디렉션을 PowerShell이 NativeCommandError로 처리한 wrapper 실패도 있었으며, subprocess exit code를 별도로 저장해 두 검사의 실제 exit=0을 확인했다.

화면 7종 검증 뒤 Home/복귀·night config 전환 중 앱 focus-event ANR 종료가 관측됐다. 마지막 정상 패널은 확인됐지만 이후 lifecycle PASS는 주장하지 않는다. WebView DevTools 연결도 끊겨 recreation 수집 FAIL. 이후 AVD 입력·앱 재실행·추가 SDK 실험은 중단하고 read-only 진단만 수집했다. 할당한 tcp:62284 forward는 제거했고 기존 AVD는 종료/재설정하지 않았다.

실제 폰 광학 QR 스캔, AVD Native QR 생성·수신·Accept, Door 실제 재검증, lifecycle 정상 복귀, 원격 SDK cleanup acknowledgement는 NOT_RUN/BLOCKED다. 기존 단위 테스트의 Door/lifecycle 회귀 및 실제 TLS 합성 E2E와 혼합하지 않는다. CI는 PR의 해당 commit checks에 따로 기록한다.
