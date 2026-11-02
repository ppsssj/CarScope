# P3-I4 evidence index

2026-11-02 KST. [검증 보고서](../../p3-i4-android-runtime-validation.md).

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
