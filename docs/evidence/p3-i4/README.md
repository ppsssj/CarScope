# P3-I4 evidence index

2026-11-02 KST. [검증 보고서](../../p3-i4-android-runtime-validation.md).

## CI 최종 상태 및 QEMU 종료 증거 검토

새 외부 루트: `C:\CarScope-External\p3-i4\20261102-qemu-exit-review-01`. 이벤트와 기존 로그·metadata를 읽기만 했다. 새 AVD/adb/SDK 실행 및 프로세스 종료 없음. 원본 이벤트·개인 환경 파일·dump는 Git에 넣지 않는다.

| 위치 | 범위 / 한계 |
|---|---|
| `ci-09f4b77.json` | 수정 코드 HEAD의7/7 최종 SUCCESS. 후속 문서 HEAD의 CI와 구분 |
| `event-query.json`, `Application-events.json`, `System-events.json` | 15:25–16:20 KST 조건의 Application8/System2. 해당 조회에서 QEMU/OOM/driver 관련 이벤트 근거 없음; 종료 원인 배제 아님 |
| `wer-inventory.json`, `wer-archive-folders.json` | Archive 상위 metadata와 Queue. 일부 Archive 본문 ACL 접근 거부, 전체 본문 조사 BLOCKED |
| `crashpad-inventory.json`, `local-crashdump-status.json` | 확인한 Crashpad reports 파일0, 사용자 CrashDumps에서 qemu/emulator 이름0. crash 부재 증명 아님 |
| `emulator-log-inventory.json`, `historical-emulator-tails.json` | 이전 세션 로그11개 metadata 및 bounded tail. 10/30–11/1 기록이므로 이번 PID38600 종료 근거로 사용하지 않음 |
| `avd-file-metadata.json`, `emu-launch-params.txt`, `emulator-user.ini`, `quickbootChoice.ini`, `AVD.conf`, `bootcompleted.ini` | 기존 파일 복사·hash·시각. 16:03:30–32 파일 수정 및 설정을 종료 주체/exit code로 해석하지 않음 |
| `review-summary-complete.json` | 조사 범위별 결과 요약. 앞선 `review-summary.json`은 CrashDumps 명시적 상태 수집 전 중간 요약 |

QEMU가 마지막으로 보인 기존 CIM16:02:57과 다음 부재 표본16:05:18 사이의 정확한 종료 시각·주체·exit code는 확보하지 못했다. **사용자 종료/비정상 종료/OOM/driver 중 원인 미확정**이다. SystemUI 합성 회귀·CI PASS와 실제 Android Runtime 미검증을 분리하며 Draft를 유지한다. 후속 문서 HEAD의 최종 CI는 PR Checks와 별도 외부 CI snapshot으로 확인한다.

## SystemUI Health Gate 정확성 및 CPU 조사

새 외부 루트: `C:\CarScope-External\p3-i4\20261102-health-accuracy-01`. 실제 소유권 오탐 수정과 미해결 CPU 부하를 분리한다.

| 위치 | 근거 / 범위 |
|---|---|
| `before/` | 06:58:39 UTC, 기존 단일 PID 오탐 + 실제 CPU/load 초과 |
| `after-first/` | 07:02:58 UTC, 수정 중 사용자별 UID/PID/starttime 세 표본 일치; CPU/load만 BLOCKED. 최종 추가 stat 재조회 전 중간 코드의 실제 표본 |
| `final/` | 07:06:18 UTC, 최종 코드의 새 Gate. 연결 목록 비어 있음, BLOCKED. 앱 실행 없음 |
| `ps-initial.txt`, 각 Gate의 `commands.json` | UID10121/user0/PID1096, UID1010121/user10/PID1600, Package Manager/`proc` 대조 |
| `cpuinfo.txt`, `top-threads.txt`, `diagnostic-commands.json` | 캐시된 프로세스 CPU와 짧은 thread 표본을 구분. 실제 CPU 부하; CarScope 성능 수치 아님 |
| `activity.txt`, `surfaceflinger.txt`, `maps-gfx.txt`, `driving-gfx.txt` | 두 resumed task·SurfaceView·렌더링 경로. gfxinfo 누적 통계를 CarScope FPS로 해석하지 않음 |
| `maps-log.txt`, `driving-log.txt` | 제한된 warning 로그. 위치를 포함할 수 있어 raw 공개 금지; checksum warning과 CPU의 인과는 미확정 |
| `host.json`, `host-processes-{first,second}.json`, `host-interval-summary.json`, `host-{cpu,cim}-window.json` | process metadata/CPU 시간 delta. 관측 구간에 무거운 Gradle 경쟁 근거 없음. 마지막 CIM에서는 QEMU 없음; 이 시점 메모리를 기동 중 값으로 혼합하지 않음 |
| `python-verified-23.log`, `node-verified.log`, `driver-syntax.log`, `tests.json` | 최종 Python23/Node4/syntax PASS. 앞선 `*-final.log`는 중간22개 실행이며 최종과 구분 |
| `cli-baseline-rejection.{log,json}` | 실제 공유 helper CLI에서 BLOCKED baseline 거부 exit2 확인. 양성 Runtime 검증과 구분 |
| `test-development-failure.txt` | 테스트 작성 중 replacement PID의 proc fixture 누락과 수정 기록 |

SystemUI 사용자별 안정성은 실제 연결 표본에서 확인했지만, 새 Runtime pulse 양성 경로와 최종 추가 표본 내 stat 재조회는 기기 해제 후 실기기 NOT_RUN이다. CPU 기준은 그대로이며 저부하 안정 상태를 확보하지 못했다. 기기를 재시작/종료하거나 Sync/SDK를 호출하지 않았다.

## 사용자 수동 부팅 후 재개

새 외부 증거 루트: `C:\CarScope-External\p3-i4\20261102-resume-01`. 아래 최초 실행과 별개이며 덮어쓰지 않았다.

| 위치 | 의미 |
|---|---|
| `health/health.json` | `2026-11-02T06:34:52.722024+00:00` 실제 AVD 연결/이름/boot/API34/user10/WebView131/Service2.3.22 및 메모리·저장 공간 확인. Gate는 BLOCKED |
| `health/commands.json` | 읽기 전용 기존 Harness 명령과 응답 시간. 설치·실행·입력·forward·SDK 호출 없음 |
| `health/apk-preflight.json` | 기존 APK 정적 preflight PASS 및 동일 SHA256. 추가 APK/GLB 검사/설치는 Gate 미통과로 NOT_RUN |
| `health/results.json` | Runtime BLOCKED. 2 vCPU의 load `11.87–12.12 / 8.60` 초과 및 세 표본의 두 SystemUI PID `1096 1600`으로 단일 PID 조건 불충족 |

두 PID 문자열은 표본 간 동일하며 SystemUI 재시작/crash 증거로 해석하지 않는다. 필터된 최근 로그에서 fatal/ANR 흔적이 없다는 사실도 Gate PASS로 대체하지 않는다. 실제 3D/Tire/Receiver/SDK Runtime은 실행하지 않았다. PR #41의 기존 HEAD `268eae7` CI 7/7 SUCCESS는 오프라인 CI 범위다. Codex B 코드·서버·Worktree 변경 없음.

## 최초 오프라인 검증 및 AVD 부재 기록

외부 증거 루트: `C:\CarScope-External\p3-i4\20261102-integrated`. 원본 로그·JSON·PNG·JUnit XML·APK/AAB·개인 환경은 Git에 넣지 않는다. 이 경로는 실행 PC의 로컬 증거이며 저장소에서 내려받을 수 있는 첨부물이 아니다.

| 위치 | 의미 |
|---|---|
| `health-initial/{health,commands,results,apk-preflight}.json` | 초기 읽기 전용 gate: 기기 목록 비어 있음, BLOCKED. 빌드 전 APK 없음 |
| `host.json`, `process-inventory.json` | 읽기 전용 host 관측. 전체 command line/credential 수집 없음 |
| `commands-offline.json`, `*.log` | 저장소 명령별 exit code·실행 시간·원본 출력 |
| `commands-android.json`, `android-build.log`, `core-jvm.log`, `junit-{app,core}/`, `junit-totals.json`, `lint-results-debug.xml` | fresh JVM/Debug/Release 빌드·lint. App114 PASS, core37 PASS/1 skip, lint0 errors/23 warnings |
| `*-boundary.log`, `native-js-contract.log` | Debug/Release 격리 및 합성 JVM serializer→JS 계약 |
| `artifacts.json`, `app-debug.apk`, `app-release-unsigned.apk`, `app-release.aab` | 최종 산출물 byte 수/hash 및 외부 사본. Debug SHA256 `a62dd72b94d21c7ba6bfebea5729e9c4ea9fdcb6e4015b21218a12a60ed6ada8` |
| `debug-badging.log`, `debug-signature.log`, `debug-source-bytes.json` | package/debuggable/min/target, v2 서명, 9개 원본 모듈 및 전체 생성 inspection 자산 APK 바이트 일치/GLB 미포함 |
| `commands-archive.json`, `commands-archive-final.json`, `archive-initial-failure.json` | 증거 수집기의 잘못된 CSS 파일명 가정 FAIL과 수정 후 PASS 구분. 제품/공식 Harness 수정 없음 |
| `health-final/`, `health-final.log` | `2026-11-02T05:52:29.922596+00:00` 최종 Gate BLOCKED, APK preflight PASS. 연결 기기 없어 guest 명령 미실행 |
| `commands-browser.json`, `browser-summary.json`, `browser-*/*.json`, `browser-*/*.log`, `browser-*/*.png` | 실제 GLB 기반 desktop Chrome. 7개 실행/228 assertions PASS, USER_REPORTED 입력, 실제 Android/SDK 아님 |
| `geometry-*.log`, `ioniq5-tests.log` | Anatomy audit/pin/회귀/GLB/샘플 충돌, IONIQ5 57 pass/기존 Blender optional1 skip |
| `evidence-manifest.json` | 외부 증거 141개 파일의 상대 경로·크기·SHA256. manifest 자체는 제외 |

이전 P3-I1/I2/I3 또는 CI 결과를 이번 실행으로 복사하지 않는다. 실제 AVD Runtime 증거는 없으며, 데스크톱 Chrome/테스트 fixture/JVM 결과를 실제 Pleos callback으로 해석하지 않는다.
