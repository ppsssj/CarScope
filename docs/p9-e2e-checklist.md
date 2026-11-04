# P9 기기 E2E 체크리스트

**전체 NOT_RUN.** P8-C1은 이 명령들을 실행하지 않았고, AVD와 스마트폰을 사용하지 않았다. 표의 명령은 준비된 것이지 검증된 결과가 아니다. 설치, Render 변경, 등록 발급은 단계마다 사용자 승인이 필요하다.

선행 조건은 [P8-C1 배포 순서](p8-c1-deployment-readiness.md#배포-순서)와 [백업](p8-c1-deployment-readiness.md#백업과-복구)이다. 인증 절차의 원본은 [P6-D4](p6-d4-avd-android-provisioning.md), [P6-D5](p6-d5-avd-auth-runtime.md), 부하 기준은 [P6-D6](p6-d6-avd-phone-e2e.md), Native→3D 합격 기준은 [시각 계약](contracts/p7-c2-server-clock-proposal.md)과 PR #78의 `docs/p7-c3-server-clock.md` AVD 항목을 따른다.

증거는 Git 밖에 저장하고 이 문서 형식의 인덱스만 `docs/evidence/`에 남긴다. 캡처와 로그에 토큰, QR 원문, enrollment proof, DB URL이 없는지 공유 전에 확인한다. 공통 변수는 다음과 같다.

```powershell
$adb = 'C:\Android\Sdk\platform-tools\adb.exe'
$serial = 'emulator-5554'          # 자동 선택 금지
$user = 10
$out = 'C:\CarScope-External\p9\<UTC시각>'
New-Item -ItemType Directory -Force $out | Out-Null
```

## A. APK 식별과 설치

| # | 확인 | 명령 | 합격 기준 |
|---|---|---|---|
| A1 | 빌드 APK 세대 | `node tools/inspection-sync-poc/bin/deployment-preflight.mjs compat --apk app\build\outputs\apk\debug\app-debug.apk --report $out\compat.json` | `NEW_DECODER` |
| A2 | SHA-256 | `Get-FileHash -Algorithm SHA256 app\build\outputs\apk\debug\app-debug.apk` | A1의 값과 일치 |
| A3 | 버전 | `& C:\Android\Sdk\build-tools\35.0.0\aapt2.exe dump badging app\build\outputs\apk\debug\app-debug.apk \| Select-String 'package:'` | `io.carscope.app`. `versionName`은 고정값이라 **세대 구분에 쓸 수 없다.** A1·A2로 구분한다 |
| A4 | 빌드 커밋 | `git rev-parse HEAD`, `git status --short` | 깨끗한 트리, 기록한 SHA |
| A5 | 설치 (승인 후) | `& $adb -s $serial install --user $user -r app\build\outputs\apk\debug\app-debug.apk` | 서명 충돌 시 uninstall하지 말고 중단 |
| A6 | 설치본 대조 | `& $adb -s $serial shell pm path --user $user io.carscope.app` 후 `& $adb -s $serial pull <base.apk 경로> $out\installed.apk`, `Get-FileHash $out\installed.apk` | A2와 일치. 일치해야 최신 APK를 설치했다고 말할 수 있다 |

## B. AVD 기본 상태 (읽기 전용)

| # | 확인 | 명령 | 합격 기준 |
|---|---|---|---|
| B1 | readiness | `python tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial $serial --report $out\readiness.json` | PASS. identity snapshot 범위 |
| B2 | 사용자 | `& $adb -s $serial shell am get-current-user` | `10` |
| B3 | 부하·메모리 | `& $adb -s $serial shell cat /proc/loadavg`, `... cat /proc/meminfo` | P6-D6 기준으로 지속 과부하 없음. 불안정하면 중단 |
| B4 | WebView | `& $adb -s $serial shell dumpsys webviewupdate` | `ai.pleos.android.webview`, 버전 기록 |
| B5 | 기존 ANR | `& $adb -s $serial shell dumpsys activity lastanr` | 시작 전 상태를 기록 |
| B6 | 서버 | `node tools/inspection-sync-poc/bin/deployment-preflight.mjs probe --origin https://carscope-lluo.onrender.com` | 현재 모드 기록 |
| B7 | 단독 Native (기존 서버) | [P6-D4](p6-d4-avd-android-provisioning.md) 순서 | 세션 생성 성공, 3D는 `SERVER_CLOCK_UNAVAILABLE`. 이 상태는 정상이다 |

## C. 서버 모드와 세션 binding

배포 순서 6단계 이후에 진행한다. `DENIED` 상태에서는 생성 응답을 볼 수 없으므로 시뮬레이터 모드가 필요하다. 이는 OEM 소유권이 아니다. History 조회는 계속 403이어야 한다.

| # | 확인 | 방법 | 합격 기준 |
|---|---|---|---|
| C1 | 시뮬레이터 모드 (승인 후) | Render에 `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`, 재배포, `probe` | `STATEFUL_AVD_SIMULATION`, `OPERATOR_APPROVED_AVD_ONLY` |
| C2 | 등록 발급 (승인 후) | `node bin/avd-simulator-admin.mjs issue --label CarScope_Pleos_API34 --out C:\CarScope-External\avd-enrollment-<시각>.json --hours 2` | stdout에 secret 없음. **기존 파일을 덮어쓰지 않는다** |
| C3 | proof 전달 | P6-D4 3단계 `run-as` 표준입력 | 명령줄, 공용 저장소, logcat에 proof 없음 |
| C4 | `serverNow` | 앱 진단 또는 Native 흐름. 응답 원문을 기록하지 않는다 | 정수, `serverNow < inviteExpiresAt <= expiresAt`, 수신 시각과 수 초 이내 |
| C5 | binding | 3D 페이지에서 Native 세션 시작 | `SERVER_CLOCK_UNAVAILABLE` 사라짐. 실패 시 RTT 5000ms 초과 여부 확인 |

## D. WebView Referer와 첫 RPC

P7-C2가 가장 먼저 확인할 항목으로 남긴 위험이다. 실패해도 잘못된 전달은 없고 채널이 동작하지 않을 뿐이다.

```powershell
& $adb -s $serial shell am start --user $user -n io.carscope.app/.lab.InspectionActivity
& $adb -s $serial shell "cat /proc/net/unix | grep webview_devtools_remote"
& $adb -s $serial forward tcp:9222 localabstract:webview_devtools_remote_<PID>
# Chrome chrome://inspect 에서 페이지 연결, Network 탭 기록
& $adb -s $serial forward --remove tcp:9222
```

| # | 확인 | 합격 기준 | 실패 시 의미 |
|---|---|---|---|
| D1 | 어댑터 `open`/`poll` | 200, 연결 상태가 `UNAVAILABLE`이 아님 | 404면 Referer 또는 `currentPage` 문제 |
| D2 | RPC 요청 헤더 | `Referer: https://carscope-inspection.invalid/index.html?...` | Pleos 포크의 헤더 변경 가능성 |
| D3 | 페이지 로드 직후 첫 RPC, 5회 반복 | 첫 RPC가 404가 아님 | `currentPage` 경합 |

디버그 포트 전달이 AVD 정책으로 막히면 BLOCKED로 기록하고 D1 결과만 사용한다.

## E. QR → 제출 → Accept → 3D → History

17개 task 전체가 아니라 대표 경로부터 수행한다. 각 단계 시각과 digest를 기록한다.

| # | 확인 | 합격 기준 |
|---|---|---|
| E1 | 부품 요청 → QR 표시 | `washer-fluid` 다음 `tire.front-left`, 그 다음 `brake-fluid` 순서 |
| E2 | 실제 스마트폰 광학 스캔 → 제출 | 폰 receipt의 digest 표시 |
| E3 | Native 화면 결과 확인 | 자동 수락 없음. digest가 폰과 일치 |
| E4 | 명시적 Accept | 폰 상태 ACCEPTED |
| E5 | 3D 결과 후보 | `receivedAt`/`acceptedAt`이 서버 값 그대로. 관측 시각을 화면 시각으로 덮어쓰지 않음 |
| E6 | 사용자 선택 | 선택 전 자동 적용 없음. SDK 관측값과 합치지 않음 |
| E7 | History 저장 (승인 후 읽기 전용 SQL) | `SELECT authority_namespace,task_id,result_digest,accepted_at FROM cs_inspection_records ORDER BY created_at DESC LIMIT 5`, `authority_namespace=AVD_SIMULATOR`, 소유자 열 NULL |
| E8 | History 조회 | 현재 **403이 합격이다.** `PRODUCTION_AUTH_BLOCKED`. 빈 목록이나 성공으로 표시하면 FAIL. 실제 소유자 조회는 issuer가 생긴 뒤의 별도 과제다 |

## F. 취소·만료·복귀·재생성

| # | 시나리오 | 합격 기준 |
|---|---|---|
| F1 | QR 표시 중 취소 | 폰 제출 거부, 후보 없음, 기록 없음 |
| F2 | 초대 10분 만료 | 스캔 거부, QR 숨김. 정책을 줄이지 말고 실제로 기다린다 |
| F3 | 제출 후 Accept 전 30분 만료 | 기록 없음, 늦은 Accept 거부 |
| F4 | Home 후 복귀 | 세션 상태 복구 또는 명확한 실패. 수명주기 뒤 늦은 callback이 전달되지 않음 |
| F5 | 회전, renderer 종료 | 권한 폐기, 늦은 결과 미전달. renderer 강제 종료는 승인 후 |
| F6 | 재생성 | 새 session/binding. 이전 session 결과가 새 화면에 나오지 않음 |
| F7 | credential 만료 | grant 120초 경과 후 재발급 대기 동작, enrollment 재발급 없음 |

## G. ANR과 RenderThread

이전 P7-A에서 focus-event ANR이 있었다. 각 세션 전후와 실패 직후에 수집한다.

```powershell
& $adb -s $serial logcat -b crash -d > $out\logcat-crash.txt
& $adb -s $serial logcat -d -s ActivityManager:E WindowManager:W chromium:E > $out\logcat-focus.txt
& $adb -s $serial shell dumpsys activity lastanr > $out\lastanr.txt
& $adb -s $serial shell dumpsys gfxinfo io.carscope.app > $out\gfxinfo.txt
& $adb -s $serial shell dumpsys meminfo io.carscope.app > $out\meminfo.txt
& $adb -s $serial shell "pidof io.carscope.app"
& $adb -s $serial shell "ps -T -p <PID> | grep -iE 'RenderThread|CrRendererMain|main'"
```

logcat에는 토큰이 없어야 한다. 공유 전에 `Bearer`, `receiverToken`, `inviteToken`, `enrollmentProof`, `postgresql://`를 검색한다.

| # | 확인 | 합격 기준 |
|---|---|---|
| G1 | ANR | 시작 시점 이후 새 ANR 없음. 있으면 해당 단계 FAIL |
| G2 | RenderThread | 스레드 존재, 프로세스 유지. 이 수치를 성능 결론으로 쓰지 않는다 |
| G3 | focus 전환 | 화면 전환 후 입력 응답. P7-A의 재현 시나리오 포함 |

## H. 정리 (승인 후)

| # | 작업 | 명령 |
|---|---|---|
| H1 | 등록 폐기 | `node bin/avd-simulator-admin.mjs revoke --id <registration UUID>` |
| H2 | AVD proof 삭제 | `& $adb -s $serial shell "run-as io.carscope.app --user 10 rm files/avd-simulator-enrollment.json"` |
| H3 | 운영자 PC 파일 삭제 | 정확한 파일 경로만 |
| H4 | 서버 모드 복원 | Render에서 시뮬레이터 변수 제거, 재배포, `probe`로 `STATEFUL_DENY_DEFAULT` 확인 |
| H5 | 포트 전달 제거 | `& $adb -s $serial forward --remove-all` |

## 결과 기록

각 행을 PASS / FAIL / NOT_RUN / BLOCKED로 적고 APK SHA-256, 서버 커밋, `/healthz` 모드, AVD 이미지, WebView 버전, 폰 기종을 함께 남긴다. 브라우저·AVD·실차 결과와 성능 수치를 섞지 않는다. AVD 통과는 실차나 실제 소유권의 증거가 아니다.
