# P3-I4 — Android 통합 Tire Runtime 검증

2026-11-02 KST. **실제 Android 통합 Runtime은 BLOCKED**다. 다중 사용자 SystemUI를 단일 PID로 제한한 오탐은 원인을 확인해 수정했다. 새 실제 표본에서는 사용자별 SystemUI 검사가 통과했으나 CPU/load 초과가 남았고, 이후 대상 AVD가 연결 목록에서 사라졌다. 설치·Activity 조작·SDK 호출은 수행하지 않았다. 아래 오프라인 검증은 Android WebView/Pleos 실측을 대신하지 않는다.

## CI 최종 확인 및 QEMU 종료 증거 검토 — 2026-11-02

이번 단계는 기존 Windows 이벤트/파일 읽기와 문서 갱신만 수행했다. 시작 clean HEAD `09f4b77a0c2e2d794c757f788e5e03f142d4fa6d`가 PR #41 HEAD와 일치했고 fetch 후 main은 `7a4c77a`였다. 새 Health Gate/adb/앱/SDK 실행, AVD 부팅·재설치, 프로세스 종료, 전역 설정·권한 변경은 하지 않았다.

### SystemUI 수정 코드의 CI 결과

`09f4b77`의 모든 Checks가 완료됐고 **7/7 SUCCESS**다. 실행별 성공은 해당 오프라인 job 범위에 한정한다.

| Job | 결과 / 실행 |
|---|---|
| Tire runtime guards (no emulator) | PASS — [41404771319](https://github.com/ppsssj/CarScope/actions/runs/41404771319), Python23/Node4 및 driver 구문 검사 |
| Core JVM tests | PASS — [41404771388](https://github.com/ppsssj/CarScope/actions/runs/41404771388) |
| Debug identity probe tests and release boundary | PASS — [41404771271](https://github.com/ppsssj/CarScope/actions/runs/41404771271) |
| SVG and geometry correctness | PASS — [41404771386](https://github.com/ppsssj/CarScope/actions/runs/41404771386) |
| Sync Linux / Windows | PASS / PASS — [41404771268](https://github.com/ppsssj/CarScope/actions/runs/41404771268) |
| GitGuardian | PASS — 해당 HEAD의 PR Checks 확인 |

### 종료 조사 범위와 결과

새 외부 근거는 `C:\CarScope-External\p3-i4\20261102-qemu-exit-review-01`이다. 기존 host 표본에서 QEMU가 마지막으로 보인 시각은 16:02:57 KST, QEMU/emulator가 없음을 확인한 다음 CIM 표본은 16:05:18 KST다. 이는 관측 경계이며 정확한 종료 시각·exit code·종료 주체를 뜻하지 않는다.

| 근거 | 읽기 전용 관측 | 해석 한계 |
|---|---|---|
| Windows Application / System | Korea Standard Time(+09:00)의 15:25–16:20 조건으로 조회. Application8건(Security-SPP/AutoEnrollment/Edge), System2건(IsolatedUserMode). 각 최대2000건 제한에 도달하지 않음 | 조회 당시 존재하는 기록에서 QEMU Application Error/WER, Resource-Exhaustion/OOM, Display/nvlddmkm 오류를 찾지 못함. 로그 부재가 원인 배제나 정상 종료의 증명은 아님 |
| WER ReportArchive / ReportQueue | Archive 상위 폴더500개 중 qemu/emulator 이름 또는 해당 시간대 수정일 후보 없음. Queue 파일0개 | Archive 하위 파일 열거는 일부 ACL 접근 거부. 전체 보고서 본문 검사는 **BLOCKED**이며 권한을 변경하지 않음. 사용자별 WER 경로는 없음 |
| 사용자 CrashDumps / Emulator Crashpad | CrashDumps 파일10개 중 qemu/emulator 이름0개. `emu-crash-37.2.13.db/reports`에 보고서 파일 없음; metadata는10/30, settings.dat는11/2 15:30 수정 | 확인한 경로에 이번 종료와 연결할 dump/report가 없음. crash 미발생을 증명하지 않음 |
| 기존 emulator stdout/stderr 로그 | `C:\Android\_logs`와 `C:\CarScope-External`의 제한된 깊이에서 찾은11개 로그의 metadata와 각 최대64KiB/마지막60줄 검토. 모두10/30–11/1 세션 | 과거 shutdown/OpenGL/Vulkan 문구와 다른 PID를 이번 PID38600의 종료 근거로 재사용하지 않음. 이번 수동 부팅 세션의 stdout/stderr·종료 exit code는 조사 경로에서 확보하지 못함 |
| 현재 AVD 텍스트 metadata | launch 인자에 `-no-snapshot -gpu host`. `quickbootChoice.ini`는16:03:30, `emulator-user.ini`는16:03:32 수정. `saveOnExit=true` 설정 존재 | 파일 수정 시각·설정은 사용자 종료, 정상 종료, snapshot 저장 성공, 드라이버 실패 중 어느 하나의 직접 증거도 아님 |

**종료 원인 판정: 미확정.** 사용자 종료·비정상 종료·OOM·드라이버 문제 각각을 확정하거나 배제할 직접 근거가 없다. 앞서 관측한 높은 CPU/load와 QEMU 소멸 사이의 인과도 입증하지 못했다. 기존 파일·로그의 metadata/구간을 보존했고 다른 세션의 로그를 혼합하지 않았다. OS 이벤트 감사나 emulator verbose logging을 새로 켜거나 재현을 위해 부팅하지 않았다.

### 검증 완료 범위와 남은 조건

| 범위 | 판정 |
|---|---|
| 사용자별 SystemUI 판정 로직·오류/소유권/PID/user 전환 회귀 | PASS — 로컬23/4 및 수정 코드 HEAD의 CI7/7 |
| 실제 연결 AVD의 사용자별 UID/PID/starttime 안정성 | 기존 중간 코드의 세 표본 PASS만 유지. 최종 추가 표본 내 stat 재조회·Runtime pulse의 실제 양성 경로는 NOT_RUN |
| CPU/load 건강성 | BLOCKED — 기존8.25/8.55 기준 초과; 이번에 새 측정으로 바꾸지 않음 |
| QEMU 종료 원인 | 미확정 / 일부 WER 본문 접근 BLOCKED |
| 실제 Android3D·Tire 체크리스트/요약·Receiver/Back·WebView/Tire lease·SDK callback | BLOCKED / 미검증. 별도 환경 안정화 이후 재개 |

이번 문서 변경은 `git diff --check`로 확인하고, push 후 **그 새 HEAD의 CI 최종 상태도 별도로 확인**한다. 이 절의 `09f4b77` 결과를 후속 HEAD의 성공으로 미리 간주하지 않는다. PR #41은 Draft, **READY_TO_MERGE: NO**를 유지하고 자동 병합하지 않는다.

## Health Gate 정확성 개선과 CPU 원인 조사 — 2026-11-02

시작 Worktree/branch는 동일하며 clean HEAD `82c4f8a0d26dd68315e957c5128642c4f11a57f3`와 PR #41 HEAD가 일치했다. fetch 후 main도 `7a4c77a`로 유지됐다. 이 단계의 코드 변경은 `tools/tire-probe/runtime/health.py`, `test_harness.py`, `webview.mjs`의 Health Gate 검사에 한정한다. 앱·SDK·Sync·Geometry·설치 동작은 변경하지 않았다.

### SystemUI 판정: 기존 오탐 확인, 사용자별 검사로 수정

기존 조건은 `pidof com.android.systemui`의 전체 문자열에 `isdigit()`을 적용했다. 실제 `1096 1600`은 두 개의 정상적인 사용자별 프로세스여서, 문자열이 동일하게 유지돼도 이 조건을 통과할 수 없었다. [AOSP 다중 사용자 설명](https://source.android.com/docs/automotive/users_accounts/user_system)은 시스템 user0과 foreground 사용자의 동시 실행을 설명한다. [AOSP UID 범위 정의](https://android.googlesource.com/platform/system/core/+/80112f73cd926077f0682c22d0744bebd1b2d47e/include/private/android_filesystem_config.h)의 `AID_USER_OFFSET=100000`을 사용하되 실제 Package Manager UID 및 `/proc` 소유권도 함께 대조한다. 문서만으로 Pleos의 정확한 프로세스 구성을 가정하지 않았다.

| 실제 SystemUI | user0 | 현재 user10 |
|---|---:|---:|
| PID | 1096 | 1600 |
| `ps` UID / Package Manager UID / `/proc/status` UID | 10121 | 1010121 |
| `/proc/stat` starttime ticks | 2731 | 3295 |
| 수정 중 Gate의 세 표본 | 동일한 UID/PID/starttime, state S | 동일한 UID/PID/starttime, state S |

새 검사는 개수 제한을 지우지 않는다. 이 전용 Gate는 user0과 현재 사용자 각각 정확히 한 개의 **정확한 이름** `com.android.systemui`를 요구한다(현재 사용자가 0이면 한 개). 예상 밖 사용자·중복·누락은 BLOCKED다. UID를 사용자와 app ID로 분해하고 두 사용자의 app ID가 같은지, 패키지 UID와 `/proc/status` 네 UID가 모두 같은지 확인한다. 표본 앞뒤 process table과 `/proc/stat` 재조회로 PID 소멸·교체·재사용을 검사하고, 세 표본의 `(user,uid,pid,startTicks)`가 같은지 비교한다. 표본 앞뒤 및 최종 current user가 바뀌어도 차단한다. 정상 R/S 등 상태 변화는 허용하지만 zombie/dead/stopped·파싱 실패·권한 부족은 차단한다.

기존 최근 SystemUI fatal/ANR 차단을 유지하고 process-death 문구도 검사한다. 새 소유권 조회는 요청당 2초 예산을 적용한다. Runtime driver의 `pulse()`에 있던 동일한 단일 PID 가정도 제거하고 **같은 Python 검사**를 호출해 이 실행의 PASS `health.json` baseline과 비교하도록 했다. baseline이 BLOCKED/이전 schema/불일치이면 차단하며 helper 부재·timeout도 차단한다. 새 앱 bridge/SDK API는 없다.

이는 표본 구간의 관측으로, 모든 시간의 정상 동작을 증명하지 않는다. 현재 사용자 외 추가 background SystemUI 사용자가 있는 다른 구성은 자동 허용하지 않는다. 새 Runtime pulse의 실제 양성 경로와 최종 추가 `/proc/stat` 표본 내 재검사는 마지막 기기 연결 해제 때문에 **실기기 NOT_RUN**, 합성 회귀만 PASS다.

### CPU 판정: 실제 고부하 유지, 내부 근본 원인은 미확정

CPU/load 식과 수치는 변경하지 않았다: 2 vCPU이면 1분 load≤2, 5분 load≤3, echo≤1초, 기존 service 조회≤2초, 메모리≥512MiB, /data≥256MiB다. 15분 load는 기존과 동일하게 유효성만 검사한다.

외부 원본 루트 `C:\CarScope-External\p3-i4\20261102-health-accuracy-01`에서 `dumpsys cpuinfo`, 2회 thread top, Activity/SurfaceFlinger/gfxinfo 및 두 앱의 제한된 warning 로그를 읽기만 했다. 화면 전환·설정 변경·서비스 중단·profiler/trace 활성화는 하지 않았다.

- `dumpsys cpuinfo`의 보고 구간은 maps 64%, DrivingView 61%, graphics composer 13%, SurfaceFlinger 13%였다. 이 값은 해당 도구의 캐시된 구간이며 현재 순간 CPU나 CarScope 수치가 아니다. guest 표기 시각도 host UTC와 같다고 가정하지 않았다.
- 더 짧은 두 번째 thread top 표본은 DrivingView RHIThread 27%, GameThread 7.5%, RenderThread 3.5%; maps main 15%, MbxRendermapNam 14.5%, RenderThread 12.5%; graphics composer binder 14%, SurfaceFlinger 7%였다. thread 값은 프로세스 합계와 별개이고 2 vCPU top의 총 용량은 200%다. top 자체도 CPU를 쓰므로 측정 overhead가 있다.
- 두 앱이 별도 task의 resumed Activity로 존재하고 관련 SurfaceView layer가 합성 중이며 GPU 경로는 NVIDIA GTX1060의 Emulator OpenGL ES Translator였다. **지도/DrivingView의 지속적인 렌더 작업과 compositor 작업이 부하에 기여한다는 관측**은 확보했다. 지도 warning 로그에는 NMEA checksum 불일치가 반복됐으나 그 CPU 기여도는 측정하지 못했다. 지도/Unreal 내부 코드, renderer 병목·driver·emulator 비용 중 하나를 확정 원인으로 단정하지 않는다. raw 위치·로그 내용은 Git에 넣지 않는다.
- host CIM 표본의 약 249.85초 구간에서 QEMU CPU 시간은 약 515.594초 증가했다. Java/Gradle daemon 네 개의 CPU 시간 증가는 각각 0.172/0.234/0.250/0.578초이며 관측한 Gradle client는 없었다. **이 구간의 무거운 Gradle 빌드 경쟁 근거는 없었다.** daemon 존재를 활성 빌드로 간주하지 않았고 다른 작업의 프로세스를 종료하지 않았다. 그 밖의 host 경쟁이 전혀 없었다는 증명은 아니다.

### 재실행·회귀와 잔여 조건

| 새 실행 | 결과 | 실제 근거 |
|---|---|---|
| `before/` 06:58:39 UTC | BLOCKED | 기존 코드: 단일 PID 오탐 + CPU/load 초과 |
| `after-first/` 07:02:58 UTC | BLOCKED | 수정 중 사용자별 소유권/시작 시각 세 표본은 통과. load `8.62/8.63/8.06`, `8.62/8.63/8.06`, `8.25/8.55/8.04`; echo94/109/93ms. **남은 이유는 CPU/load뿐** |
| `final/` 07:06:18 UTC | BLOCKED | 최종 코드로 새 디렉터리에 실행. 연결 목록이 비어 있음; guest 명령 없음. QEMU/emulator 프로세스도 후속 host 표본에서 없음. 종료 주체·원인은 미확정 |
| Python Harness | PASS | `python -B -m unittest discover -s tools/tire-probe/runtime -p 'test_*.py' -v`: **23 tests**, 실패0 |
| Node evidence guards / driver syntax | PASS | `node --test tools/tire-probe/runtime/evidence.test.mjs`: 4 tests; `node --check tools/tire-probe/runtime/webview.mjs` |
| 공유 helper CLI 거부 | PASS | 실제 `health.py --sdk=… --serial=emulator-5554 --baseline=…/after-first/health.json --expected-user=10` 호출은 BLOCKED baseline을 exit2로 거부. 앱/SDK 미실행 |
| 변경 경계 / 공백 | PASS | Health Gate·테스트·문서만 변경, `git diff --check` |
| APK/빌드/JVM/UI/SDK Runtime | NOT_RUN / BLOCKED | 이번 단계는 Gate/읽기 전용 조사. 이전 빌드·114 JVM·228 desktop assertions를 재실행 결과로 표시하지 않음 |

23개에는 정상 user0/10 및 user0 단독, 소유 UID/Package Manager/`proc` 불일치, 예상 밖 사용자·중복/소멸, PID 교체·재사용/starttime 변경, zombie/dead/stopped, 표본 내·표본 간·마지막 사용자 전환, fatal/ANR/death, 조회 시간 초과·권한 부족, Runtime PASS baseline 비교 및 기존 CPU 경계값 검사가 포함된다. 개발 중 replacement PID fixture의 `/proc/201` 응답 누락으로 테스트 1건이 실패했고 fixture를 완성해 최종 통과했다. 검사 기준을 약화하지 않았고 외부 `test-development-failure.txt`에 구분했다.

안정된 **저부하** 상태는 확보하지 못했다. 최종적으로 대상 연결도 없어 추가 대기/재부팅을 반복하지 않았다. 앱 설치·실행·SDK 호출·강제 종료는 없고 Codex B Worktree·서버·Sync 파일은 변경하지 않았다. **SystemUI 오탐 수정 PASS / CPU 문제 BLOCKED / 통합 Runtime BLOCKED**, PR #41 Draft 및 **READY_TO_MERGE: NO** 유지다.

## 수동 부팅 후 재개 — 2026-11-02 15:34 KST

Worktree `C:\dev\CarScope-p3i4-avd`, branch `test/p3-i4-avd-integration`, clean HEAD `268eae7660309ec91c2cdfc3cc030b5ba4bfc6ea`가 PR #41의 원격 HEAD와 일치했다. fetch 후 `origin/main`은 기존 `7a4c77a60485146cf5baef248390fec46b53d608`다. PR은 Draft이며 이 HEAD의 기존 CI 7/7 SUCCESS를 확인했다. CI는 실제 AVD 검증과 별개다.

기존 도구를 변경 없이 새 외부 폴더에서 실행했다.

```powershell
python -B tools/tire-probe/runtime/run.py --sdk=C:/Android/Sdk --serial=emulator-5554 --out=C:/CarScope-External/p3-i4/20261102-resume-01/health
```

| Gate 항목 | 새 실제 관측 | 판정 |
|---|---|---|
| 시각 / 연결 | `2026-11-02T06:34:52.722024+00:00`, `emulator-5554 device`, model `Connect_on_x86_64_emulator` | PASS |
| 대상 / boot / API | `CarScope_Pleos_API34`, `sys.boot_completed=1`, API34, current user10 | PASS |
| WebView | `ai.pleos.android.webview`, `131.0.6752.0` | PASS — 현재 provider 조회 |
| Vehicle Service | `ai.pleos.playground.service.vehicle`, version `2.3.22`, user10 enabled | PASS — package inventory만, SDK 수신 아님 |
| 메모리 / 저장 공간 | MemAvailable `2,262,020 KiB`, /data available `7,560,316 KiB` | PASS — 최소 512MiB / 256MiB 충족 |
| CPU/load 표본1 | 2 vCPU, `12.12 / 8.60 / 3.66` | BLOCKED |
| CPU/load 표본2 | `12.12 / 8.60 / 3.66` | BLOCKED |
| CPU/load 표본3 | `11.87 / 8.60 / 3.69` | BLOCKED |
| ADB echo / service 응답 | echo `250 / 94 / 94 ms`, service 조회 `156 / 110 / 750 / 140 ms` | PASS — 각각 ≤1s / ≤2s |
| SystemUI 표본 | 세 표본 모두 `1096 1600` | BLOCKED — 기존 단일 숫자 PID 조건 불충족 |
| 최근 선택 로그 | `systemUiFatal=false`, 해당 필터/최근 200줄 결과 비어 있음 | 수집 범위 내 오류 흔적 없음. 전체 안정성 보증 아님 |
| 최종 Health Gate | `SystemUI not stable over three samples`, `CPU/load or ADB response budget exceeded` | **BLOCKED** |
| 기존 APK preflight | PASS, SHA256 `a62dd72b94d21c7ba6bfebea5729e9c4ea9fdcb6e4015b21218a12a60ed6ada8` | 정적 APK 검사만 |

기존 load 예산은 1분 load≤2, 5분 load≤3이며 두 항목 모두 초과했다. 이는 CPU 사용률 백분율이나 CarScope 성능 수치가 아니다. SystemUI의 두 PID 문자열은 세 표본에서 같으므로 실제 PID 변경·재시작·crash를 관측했다고 주장하지 않는다. 다중 사용자별 프로세스인지 등 원인은 이번에 진단하지 않았고, PID를 임의 선택하거나 단일 PID 기준을 완화하지 않았다. load 초과는 이와 독립적인 차단 사유다.

Health Gate가 PASS일 때만 Runtime을 수행하라는 조건에 따라 `--run`/`--install`, app-private GLB 주입, 앱 소유권 조회·설치·실행·입력·forward·SDK 호출을 진행하지 않았다. 기존 도구가 수행한 APK preflight 외 추가 APK/GLB hash 재검증과 빌드는 NOT_RUN이며 이전 GLB hash를 새 실행으로 재사용하지 않는다. 에뮬레이터/SystemUI/Vehicle Service/다른 Codex 프로세스를 재시작·종료하지 않았다.

이번 재개의 실제 3D 렌더·네 타이어 선택/강조·체크리스트 확정/수정/재확정·요약, Native Receiver 진입/Back·WebView/Tire lease 복원, 실제 SDK capability/cache/listener/observedAt/STALE/원격 정리 확인은 모두 **BLOCKED — Health Gate 미통과**다. 오류 주입·회전·장시간 성능 측정·실차·폰 Sync E2E는 **NOT_RUN**이다. Vehicle Service 설치/활성화 조회를 실제 capability 또는 data callback 성공으로 해석하지 않는다.

새 원본은 `C:\CarScope-External\p3-i4\20261102-resume-01\health\{health,commands,apk-preflight,results}.json`에 보존했다. 아래 최초 오프라인·AVD 부재 기록은 이 재개 실행과 구분한다. 앱/공식 Harness 및 Codex B의 Worktree·서버·Sync 코드는 변경하지 않았다. **READY_TO_MERGE: NO**를 유지하고 PR #41은 Draft로 둔다.

## 최초 실행의 기준과 범위

- Worktree: `C:\dev\CarScope-p3i4-avd`, branch: `test/p3-i4-avd-integration`. 시작 working tree clean.
- HEAD 및 fetch 후 `origin/main`: `7a4c77a60485146cf5baef248390fec46b53d608`.
- origin: `https://github.com/ppsssj/CarScope.git`. GitHub에서 PR #32/#34/#36/#37/#38/#39의 MERGED metadata와 설명을 직접 확인했다.
- [PR #39](https://github.com/ppsssj/CarScope/pull/39) merge `09785712874710150932bbc6acfaa454c00e0000`, [PR #38](https://github.com/ppsssj/CarScope/pull/38) merge `7a4c77a60485146cf5baef248390fec46b53d608`가 기준 main에 포함된다.
- [P3-I1](p3-i1-tire-3d-integration.md), [P3-I2 계획](p3-i2-runtime-test-plan.md)·[결과](p3-i2-tire-avd-runtime.md), [P3-I3](p3-i3-tire-inspection.md), [Receiver 준비](ar-02b2c-device-sync-readiness.md), AGENTS 및 architecture/roadmap/development-setup/validation-report/SDK/STALE/Anatomy/3D PoC 문서를 확인했다.

최초 제출 변경은 이 보고서와 [증거 인덱스](evidence/p3-i4/README.md)였다. 당시 앱·SDK·Runtime Harness·Geometry·Sync 인증/HTTP/QR·AR-01을 수정하지 않았다. 이후 Health Gate 검사 변경은 위 정확성 개선 절에서 별도 설명한다. 기존 AVD를 생성·부팅·재시작하거나 SystemUI/Vehicle Service/다른 Codex 프로세스를 종료하지 않았다. 전역 Android/JDK/Git 설정을 변경하지 않았다.

## 환경과 Health Gate

| 항목 | 이번 관측 |
|---|---|
| Host | Windows 10 Home `10.0.19045`, 논리 CPU 4, RAM 16,667,484 KiB, 최초 free 2,824,088 KiB |
| Node / npm / Python | 22.16.0 / 10.9.2 / 3.11.9 |
| JDK / Gradle | Eclipse Adoptium 17.0.20.1 / wrapper 8.14 |
| Android SDK | `C:\Android\Sdk`, adb/emulator/API34 android.jar 존재 |
| Pleos SDK | 빌드 의존성 `Vehicle:2.3.2`; 실제 Service 버전은 NOT_RUN |
| 대상 | 명시적 `emulator-5554`, 요구 AVD `CarScope_Pleos_API34` |
| 초기 Gate | **BLOCKED** — `2026-11-02T05:42:58.529100+00:00`, `adb devices -l` exit 0, 연결 목록 비어 있음 |
| 최종 Gate | **BLOCKED** — `2026-11-02T05:52:29.922596+00:00`, 새 `health-final/` 실행도 연결 목록 비어 있음. 최종 APK preflight는 PASS |
| Guest 상태 | boot/API/CPU/load/RAM/storage/SystemUI/WebView/Vehicle Service **NOT_RUN**, 대상 없음 |

초기 adb 명령은 목록 조회뿐이다. adb 자체가 기존 서버 부재를 보고하고 daemon을 시작했으며 emulator는 시작하지 않았다. 최초 APK preflight의 BLOCKED는 아직 빌드 전 APK 부재이며 빌드 실패로 집계하지 않는다. Sandbox에서 fetch의 외부 Git metadata 접근, CIM 조회, Anatomy 소유권 검사가 차단되어 승인된 실행으로 다시 확인했다. 안전 검사·pin·전역 설정을 완화하지 않았다.

## 새 오프라인 검증

원본은 외부 `C:\CarScope-External\p3-i4\20261102-integrated`에 보존한다. 과거 PR/CI 수치를 이번 실행으로 재사용하지 않는다.

| Gate | 판정 | 새 명령 / 관측 | 외부 근거 |
|---|---|---|---|
| Node UI / Tire inspection | PASS | `npm test --prefix tools/three-poc`: 34 pass, fail/skip 0. 기존 28 + P3-I3 reducer/flow/summary 6 포함 | `ui-node.log` |
| Android 자산 계약 | PASS | `npm run test:android-assets --prefix tools/three-poc`: 1 pass. 실제 Debug inspection 자산 생성, 상대 import/원본 바이트/CSP/GLB 미포함 | `android-assets.log` |
| Debug Lab 자산 | PASS | `node tools/three-poc/build-android-lab.mjs` | `lab-assets.log` |
| Runtime Harness guards | PASS | `python -B -m unittest discover -s tools/tire-probe/runtime -p 'test_*.py' -v`: 10 pass; `node --test tools/tire-probe/runtime/evidence.test.mjs`: 4 pass | `runtime-{python,node}.log` |
| Anatomy pin / clean | PASS | `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`, 원본 working tree clean | `anatomy-{pin,clean}.log` |
| Anatomy audit / GLB / Envelope | PASS | `npm run build`, `export`, `envelope`, `verify` 각각 `--prefix tools/anatomy-car`. Sedan 91 parts / 7573 triangles, Khronos 0 errors/0 warnings. Envelope 143 parts / 14988 triangles | `geometry-{build,export,envelope,verify}.log` |
| Anatomy 회귀 | PASS | `npm test --prefix tools/anatomy-car`: 58 pass, fail/skip 0 | `geometry-test.log` |
| IONIQ 5 회귀 | PASS | `node --test tools/ioniq5-asset/test/*.test.mjs`: 57 pass / 기존 optional `.blend` 변환 1 skip (`IONIQ5_BLEND` 미설정). `IONIQ5_GLB`는 기존 외부 GLB 지정 | `ioniq5-tests.log` |
| Core JVM | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` + 아래 저메모리 옵션. 총 38, 37 pass / 기존 optional 자산 1 skip, fail/error 0 | `core-jvm.log`, `junit-core/` |
| App JVM / Android 빌드 | PASS | `:app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks`: 114 pass, fail/error/skip 0, 106 tasks 실행 | `android-build.log`, `junit-app/` |
| Lint | PASS | 오류 0 / 경고 23. 경고가 없는 빌드라고 해석하지 않음. Gradle deprecated feature 안내 별도 존재 | `lint-results-debug.xml` |
| Identity/Tire/Receiver 격리 | PASS | `python tools/identity-probe/check.py build-contract`, `python tools/tire-probe/check.py build-contract`, `python tools/inspection-sync-poc/android/check-boundary.py` | `*-boundary.log` |
| Receiver JVM 상세 | PASS | Entry 3 / Activity 8 / HTTPS 10 / Decoder 8 / 기존 Receiver 17; app 114에 포함, 별도 추가 합산하지 않음. boundary에서 readiness Python 7 pass | `receiver-boundary.log` |
| Kotlin → JS | PASS | `node tools/three-poc/check-tire-native-contract.mjs app/build/test-results/tire-ui-v1.json`: 실제 serializer의 합성 JVM 출력. 실제 SDK 수신 아님 | `native-js-contract.log` |
| APK 바이트 / 서명 | PASS | 아래 최종 APK. 직접 복사된 9개 모듈이 소스와 동일하고 inspection 전체 생성 파일이 APK와 동일. GLB 미포함, APK v2 서명 검증 | `debug-source-bytes.json`, `debug-signature.log` |
| 생성 자산 결정성 | PASS | 재생성 후 tracked `anatomy-car.parts` diff 0 | `geometry-source-diff.log` |

Geometry 충돌 검사는 해당 샘플 자세에 한정하며 연속 회전 전체의 완전한 무충돌 증명이 아니다. Core skip 및 `.blend` skip을 새 PASS로 합산하지 않았다. 실제 외부 GLB 사용과 원본 Blender 재변환 검증은 별개다.

### 최종 APK와 Release 경계

| 산출물 | bytes | SHA-256 |
|---|---:|---|
| Debug APK | 11,213,154 | `a62dd72b94d21c7ba6bfebea5729e9c4ea9fdcb6e4015b21218a12a60ed6ada8` |
| Release unsigned APK | 7,950,970 | `77ec8fa6b11e365ebc9ed85d68cd97751a4eb674bf86d79896b8d1f21a57e10d` |
| Release AAB | 2,761,821 | `840ade102c917d63076be12fca43d9a3cb40e1bd1dbdede5bb9667e9d7efb650` |
| 외부 GLB | 1,902,820 | `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1` |

APK: `app/build/outputs/apk/debug/app-debug.apk`, applicationId `io.carscope.app`, minSdk28/targetSdk34, debuggable, versionCode1/versionName `0.1.0-p0`. 원본 GLB hash는 P3-I3 기록과 같고 변경하지 않았다. APK/AAB 사본은 외부 evidence에 보관했다.

Debug에는 InspectionActivity/Native entry/Receiver/Tire 상태·새 checklist/summary 모듈이 함께 포함된다. Release APK/AAB에는 Inspection/Lab 자산·클래스·private host·모델 경로·Receiver/Tire Debug 클래스가 없고, 테스트 전용 credential provider/Activity는 모든 APK/AAB에서 제외된다. INTERNET은 Debug만, cleartext 거부는 두 variant 모두 유지된다. 이는 패키징 근거이며 설치·기동·실제 Android rendering PASS가 아니다.

### 데스크톱 Chrome 회귀

실제 외부 GLB와 USER_REPORTED 테스트 입력을 사용하며 Android Native endpoint나 실제 Pleos callback 증거가 아니다. 기존 고정 Anatomy driver로 실행한 headless Chrome이며 두 viewport의 실제 렌더 캡처를 직접 검토했다.

| 기존 검사 | 1600×1000 | 420×860 | 관측 범위 |
|---|---|---|---|
| `check-tire-inspection.mjs` | PASS 34 assertions | PASS 34 assertions | 네 타이어 체크리스트·키보드 입력·44px 대상·확정/수정/재확정·이전/다음·부분/전체 요약·기록 초기화 |
| `check-tires.mjs` | PASS 39 | PASS 36 | 실제 Raycast·고무 강조·차체 가림·카메라/scroll/focus 복원·연속 선택/취소. Desktop에는 선택 중 420×860/1024×600 viewport resize 포함 |
| `check-inspection-components.mjs` | PASS 34 | PASS 34 | 기존 네 부품·보닛 가림·연속 전환/취소·강조/카메라 복원 |
| `check-inspection.mjs` | PASS 17 | NOT_RUN | 보닛·워셔액·QR 테스트 origin·중복/취소·종료 회귀 |

7개 실행 모두 console clean, 총 228 assertions다. `browser-summary.json`과 각 `browser-*/{results.json 또는 browser-results.json,browser-log.txt,*.png}`가 근거다. SDK 접기 영역의 두 feature/미연동 상태 확인은 실제 Pleos 수신을 뜻하지 않는다. 별도 합성 상태 Chrome fixture 시나리오는 이번에 NOT_RUN이며 Node·Kotlin→JS 계약 결과와 구분한다. localhost 테스트 서버는 이번 프로세스만 종료했다.

### 재실행 명령

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/anatomy-car
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
node tools/three-poc/build-android-lab.mjs
python -B -m unittest discover -s tools/tire-probe/runtime -p 'test_*.py' -v
node --test tools/tire-probe/runtime/evidence.test.mjs
# ANATOMY_HOME은 위 고정 SHA의 clean checkout. 원본을 수정하지 않는다.
npm run build --prefix tools/anatomy-car
npm run export --prefix tools/anatomy-car
npm run envelope --prefix tools/anatomy-car
npm test --prefix tools/anatomy-car
npm run verify --prefix tools/anatomy-car
$env:IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
node --test tools/ioniq5-asset/test/*.test.mjs
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
python tools/inspection-sync-poc/android/check-boundary.py
node tools/three-poc/check-tire-native-contract.mjs app/build/test-results/tire-ui-v1.json
# --out은 매번 새 외부 경로. 연결 대상이 없으면 exit 2/BLOCKED가 정상적인 차단 결과다.
python -B tools/tire-probe/runtime/run.py --sdk=C:/Android/Sdk --out=C:/CarScope-External/p3-i4/NEW-health
```

브라우저는 `CARSCOPE_IONIQ5_GLB`에 같은 GLB, `CARSCOPE_QR_AR_BASE_URL=https://inspection.example.test/`, `PORT=8127`을 이 서버 프로세스에만 지정하고 `node tools/three-poc/serve.mjs`로 실행했다. 별도 터미널에서 `node tools/three-poc/<표의 검사>.mjs <새 외부 증거 폴더> 'http://127.0.0.1:8127/inspect.html?capture=1' <width> <height>`를 실행한다. 다른 작업 서버의 port/process를 재사용·종료하지 않는다.

## 실제 AVD Runtime 시나리오 — 최초 실행 및 재개 후 잔여 조건

| 범위 | 판정 | 실제 관측 / 잔여 조건 |
|---|---|---|
| A: InspectionActivity 시작·WebView 렌더·외부 GLB | BLOCKED | 최초 AVD 없음 → 재개는 연결됐으나 Health Gate 미통과. APK 정적 검사/데스크톱 Chrome과 구분 |
| A: WebGL 오류·프레임 상태 | BLOCKED | Android 화면/로그/프레임 미수집, 성능 수치 없음 |
| B: 4개 타이어 선택·Raycast·Highlight·카메라 이동/복원 | BLOCKED | 실제 Android 입력·픽셀 미관측 |
| B: 체크리스트·확정·수정·재확정 | BLOCKED | 실제 Android WebView 미관측 |
| B: 이전/다음·중간/전체 요약·종료 초기화 | BLOCKED | 실제 Android WebView 미관측 |
| C: Debug 워셔액 수신 버튼·Receiver 진입·Back | BLOCKED | 실제 Activity 전환 미관측; JVM/Robolectric 근거와 구분 |
| C: WebView/Tire lease 복원·반복 진입 | BLOCKED | 실제 pause/resume·세대 교체·수명주기 미관측 |
| D: 실제 SDK capability·cache·listener | BLOCKED | 실제 SDK 세션 없음; 아래 8행 미관측 |
| D: observedAt·STALE >5000ms·세션 정리 | BLOCKED | 관측값 없음; UI poll 시각을 관측 시각으로 대체하지 않음 |
| 회전·재생성·늦은 SDK callback·renderer 종료·장시간 profiling | NOT_RUN | 실제 SDK/Android 실패 주입·장시간 시나리오 미수행 |
| 실차·센서 의미·단위·안전/주행 가능 판단 | NOT_RUN | 이번 상태 전용 UI 검증 범위 밖 |
| Android HTTPS·광학 QR·두 기기 Sync E2E·차량 인증 | NOT_RUN | 이번 진입/복귀 범위 밖. 일반 Debug 기본 생성 권한 거부 유지 |

| vehiclePartId | tire.pressure capability / cache / listener | tire.low-pressure capability / cache / listener | observedAt / source |
|---|---|---|---|
| tire.front-left | BLOCKED / BLOCKED / BLOCKED | BLOCKED / BLOCKED / BLOCKED | 미관측 / 미관측 |
| tire.front-right | BLOCKED / BLOCKED / BLOCKED | BLOCKED / BLOCKED / BLOCKED | 미관측 / 미관측 |
| tire.rear-left | BLOCKED / BLOCKED / BLOCKED | BLOCKED / BLOCKED / BLOCKED | 미관측 / 미관측 |
| tire.rear-right | BLOCKED / BLOCKED / BLOCKED | BLOCKED / BLOCKED / BLOCKED | 미관측 / 미관측 |

미관측 행을 UNSUPPORTED/0/정상으로 채우지 않았다. MOCK 자동 전환은 하지 않았다. initialize/register 반환, 실제 capability/getter/listener callback, 로컬 lease 종료, 원격 release acknowledgement는 각각 별도 증거가 필요하다.

## 결함·충돌·후속 판정

실제 앱 오류는 Runtime 진입 조건 미충족으로 확인하지 못했다. 재개에서는 실제 guest inventory와 Health Gate 차단 근거만 수집했다. 이 사유로 앱 수정이나 Runtime Harness의 검증되지 않은 양성 경로 확장을 하지 않았다. Codex B 소유 Sync/공유 Kotlin/Manifest/Gradle/서버/모바일 파일 변경은 0이며 다른 Worktree에 쓰지 않았다. 파일 변경 충돌은 없고, 다른 Codex의 현재 원격 작업 상태는 확인했다고 주장하지 않는다.

**FAIL 이력:** 로컬 증거 수집 보조 스크립트가 APK의 존재하지 않는 `inspect.css`를 요청해 KeyError로 중단됐다. 실제 빌더는 CSS를 HTML에 유지하고 9개 JS 모듈을 복사한다. 빌더의 정확한 목록으로 보조 검사만 수정한 뒤 9개 소스 및 전체 생성 자산의 바이트 대조가 PASS했다. `archive-initial-failure.json`에 이 오류를 보존했다. 제품 결함이나 APK 빌드 실패는 아니며 앱/공식 검사 기준을 변경하지 않았다. 그 외 실행한 제품/오프라인 gate의 FAIL은 없다.

성능 수치는 이번 Host inventory 및 명령 시간에 한정한다. Android 빌드 244.17초(Gradle 출력 4m3s), core 명령 55.31초는 호스트 실행 시간이며 Android launch/FPS/jank/SDK 지연 수치가 아니다. Android 성능·안정성은 NOT_RUN이다.

건강하고 소유권이 분리된 기존 AVD가 실행 중일 때 [P3-I2 계획](p3-i2-runtime-test-plan.md)의 새 Health Gate와 기존 Harness를 먼저 실행한다. 기존 Harness의 네 타이어 선택/상태/Probe 복귀 PASS만으로 P3-I3 체크리스트나 PR #38 Receiver 왕복을 PASS로 확대하지 않는다. 같은 통합 세션에서 위 B/C를 실제 입력으로 추가 관측하고, Android 화면·Activity/WebView lifecycle·lease 세대·SDK callback을 별도 기록해야 한다.

**READY_TO_MERGE: NO — 실제 통합 Runtime 완료 기준은 미충족.** 문서 PR은 BLOCKED 결과와 오프라인 근거를 검토하기 위한 것이다. 자동 병합하지 않는다.
