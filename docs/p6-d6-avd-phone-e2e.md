# P6-D6 — 실제 AVD 사전 점검과 E2E 실행 상태

2026-11-04 KST. **최종 목표 미완료**: 실제 Android 인증, QR 생성 및 스마트폰 왕복은
NOT_RUN이다. 아래 PASS는 해당 검사 범위에만 해당한다.

## 기준과 새 관측

- 작업 사본 `C:\dev\CarScope`, 시작 clean main/HEAD
  `88a7e06f21d6f2ba467c70dc92b7649b475f25c4`. `git fetch origin main` 후
  HEAD와 origin/main 차이 0/0. PR #68 MERGED 및 해당 PR check SUCCESS 확인.
- 수정 브랜치 `fix/p6-d6-readiness-multi-user`. 기존 PR을 변경하거나 병합하지 않았다.
- 실제 로컬 Windows 10 Home, SDK `C:\Android\Sdk`. emulator/qemu 프로세스와
  `adb devices -l`의 `emulator-5554 device` 확인. AVD 부재/remote 환경 문제가 아니다.
- 정확한 AVD `CarScope_Pleos_API34`, boot_completed=1, Android14/API34, 현재 user10.
  user0/user10 모두 running. user10에 `io.carscope.app` 설치 확인(최신 APK 입증 아님).
- WebView `ai.pleos.android.webview 131.0.6752.0`, relro 1/1, dirty=false,
  모든 사용자 installed/enabled. Vehicle Service 2.3.22, user10 enabled 및 프로세스 존재.
- SystemUI PID 1064(user0), 1560(user10)를 실제 `ps -A`로 대조했다.
  `dumpsys activity lastanr`는 부팅 이후 ANR 없음. 장시간 안정성 입증은 아니다.
- AVD 2 CPU, loadavg 1분 값 30.27 → 28.04 → 17.91 → 17.19.
  guest MemAvailable 약 1.90GiB. host 총 약 15.9GiB 중 가용 305–560MiB 수준.
  CPU/메모리 안정성은 BLOCKED로 유지하고 Gradle 빌드/설치/Activity 실행을 하지 않았다.
  사용자 프로세스 종료, AVD reset/wipe/reboot 또는 안전 기준 변경은 하지 않았다.
- credential-free `/healthz`: 첫 20초 요청 실패(WebException), 두 번째
  `UP / STATEFUL_DENY_DEFAULT / DENIED`. Android TLS/인증 성공의 증거가 아니다.
- 단일 순차 guest/host millisecond 관측은 ADB 왕복 지연을 포함하므로 정확한 시계
  오차로 판정하지 않았다. grant 요청 직전/직후의 bracket 측정은 NOT_RUN.

## 확인된 inventory 결함과 최소 수정

기존 `device-readiness.py`는 `pidof com.android.systemui` 전체 문자열에
`isdigit()`을 적용하여 정상적인 두 사용자 PID를 DEVICE_HEALTH_PREREQUISITE_MISSING으로
분류했다. 실제 장치 재현 후 동일 두 PID fixture로 회귀를 재현했다.

공백으로 분리한 모든 PID가 양의 ASCII 정수일 때만 SystemUI 존재를 인정한다.
빈 값/0/음수/혼합 오류/비ASCII 숫자는 차단한다. 원래 PID 문자열을 증거에 보존한다.
이 PASS는 기존 READ_ONLY_IDENTITY_SNAPSHOT_ONLY이며 성능/안정성 판정을 대신하지 않는다.
SDK/인증/TTL/TLS/UI/Geometry 및 서버 정책은 변경하지 않았다.

## 새 실행 결과

| 검사 | 상태와 근거 |
| --- | --- |
| 수정 전 readiness 회귀 | FAIL: 9 tests, 3 failures(복수 PID, 0, 비ASCII 숫자) |
| 수정 후 readiness 회귀 | PASS: 9 tests, failures/errors 0 |
| 실제 AVD inventory 최초 | BLOCKED: 정상 복수 SystemUI PID를 단일 PID로 처리 |
| 수정 후 실제 AVD inventory | PASS: identity snapshot만 해당 |
| 별도 CPU/메모리 안정성 | BLOCKED: 위 load/host 메모리 관측 |
| Node auth/operator 계약 | PASS 7 / SKIP 1(PG_TEST_URL 없음), FAIL 0; 실제 운영 DB 시험 아님 |
| diff whitespace | PASS: `git diff --check` |
| PR #67/#68 Android 회귀 재실행, core, 최신 Debug 빌드 | NOT_RUN: 자원 부족으로 Gradle 실행 보류. 과거 빌드/XML을 새 PASS로 사용하지 않음 |
| Debug 설치, 신규 enrollment/주입, Render 변경, 외부 인증 POST | NOT_RUN: 안전 선행 조건 및 개별 승인 미충족 |
| 실제 Android grant/오류/creationAuthorized/Create | NOT_RUN |
| HTTP201/session/QR, 만료/취소/재시작/권한 만료 | NOT_RUN |
| 실제 폰 washer-fluid 및 tire.front-left E2E/digest/ACCEPTED | NOT_RUN |
| revoke/임시 인증 파일 삭제/Render 복원/남은 세션 DB 확인 | NOT_RUN: 이 실행에서 운영 변경 없음; 기존 등록/세션 상태는 추정하지 않음 |

```powershell
python tools/inspection-sync-poc/android/test-device-readiness.py
python tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial emulator-5554 --report C:/CarScope-External/p6-d6-readiness-fixed-20261104T150248.json
# tools/inspection-sync-poc에서 실행
node --test test/auth-contract.test.mjs test/avd-simulator-admin.test.mjs
# 저장소 루트
git diff --check
```

기존 CI의 `android/check-boundary.py`가 readiness 단위 검사를 실행한다.
이 작업에서 boundary checker 전체를 실행하지 않았다.

## 재개 조건

사용자가 불필요한 IDE/브라우저 등을 닫아 host 메모리를 확보한 뒤 정확한 serial의
load/메모리/SystemUI/ANR와 inventory를 다시 확인한다. 기존 부하 기준을 우회하지 않는다.
안정성이 확보되면 [P6-D5 재실행 명령](p6-d5-avd-auth-runtime.md)의 자동 회귀와
Debug 빌드를 먼저 실행한다. 승인 전에 설치/등록/주입/Render 변경/Activity 시작을 하지 않는다.

설치는 user10 `install --user 10 -r`만 사용하고 서명 충돌 시 uninstall하지 않는다.
등록은 고유한 외부 파일로 발급하고 proof/DB URL을 출력하지 않는다. 각 운영 단계는
사용자의 별도 승인 후 [P6-D4](p6-d4-avd-android-provisioning.md)를 따른다.
washer-fluid 실제 광학 스캔 왕복과 명시적 Accept/폰 ACCEPTED 및 digest 일치를 관측한 뒤
tire.front-left를 수행한다. 운영 복구 역시 각 승인 후 수행한다.

원본 readiness 보고서는 `C:\CarScope-External\p6-d6-readiness-20261104T150138.json`과
`p6-d6-readiness-fixed-20261104T150248.json`에 있다. 원본 캡처/로그/secret/APK는 Git에 넣지 않는다.
