# P9 기기 E2E 실행 절차

이 문서는 절차이며 실행 결과가 아니다. **I장(WebXR)은 사용자 결정으로 전부 `NOT_RUN_DEFERRED_TO_E2E`다.** **A·B와 C1b·C1c, D1, E2, G는 [P9-A2](evidence/p9-a2/README.md)에서 AVD로 실행했고, 서버 단계(C1a·C1d·C1e, C2~C6)와 스마트폰 E2E를 포함한 나머지는 NOT_RUN이다.** 그 외 명령은 코드와 대조했을 뿐([P9-A1 증거](evidence/p9-a1/README.md)) 기기에서 실행하지 않았으므로, 기기 동작 차이는 실행할 때 기록한다.

기준 코드는 `main` `8a6f559`다. 서버의 `serverNow`는 main에 병합됐지만 **Render에는 아직 배포되지 않았다.** 사용자 확인에 따른 상태이며 정확한 배포 커밋은 NOT_VERIFIED다. 2026-11-05 운영 `/healthz`는 `STATEFUL_DENY_DEFAULT`, `sessionCreation: DENIED`였다.

인증 절차의 배경은 [P6-D4](p6-d4-avd-android-provisioning.md)와 [P6-D5](p6-d5-avd-auth-runtime.md), 시각 합격 기준은 [P7-C3](p7-c3-server-clock.md), 배포·백업은 [P8-C1](p8-c1-deployment-readiness.md)이다. 실행 순서가 다르면 이 문서를 따른다. P6-D4는 enrollment 뒤에 시뮬레이터 모드를 켜지만, 여기서는 proof 유효 시간을 아끼기 위해 모드를 먼저 켠다. 코드상 두 순서 모두 동작한다.

증거는 Git 밖에 저장하고 인덱스만 `docs/evidence/`에 남긴다. 토큰, QR 원문, enrollment proof, DB URL을 로그·캡처·채팅에 넣지 않는다.

## 승인 게이트

아래는 각각 **별도 사용자 승인**이 필요하다. 한 항목의 승인이 다음 항목으로 이어지지 않는다.

| 게이트 | 내용 | 운영 영향 |
|---|---|---|
| G1 | 호스트 메모리 확보 후 AVD 시작, APK·endpoint·GLB 배치 | AVD만 변경 |
| G2 | `/v1` 프로브(`--approve-rate-window-writes`) 또는 "서비스 연결 확인" 클릭 | 운영 `cs_rate_windows`에 쓰기 |
| G3 | 운영 DB 백업, 읽기 전용 검사, 별도 DB 복원 리허설 | 운영 DB 읽기, 새 DB 사용 |
| G4 | 최신 main Render Manual Deploy | **운영 DDL 적용**, 응답에 `serverNow` 추가 |
| G5 | `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED` 설정과 재배포 | 시뮬레이터 등록자에게 세션 생성 개방, `cs_avd_*` DDL |
| G6 | enrollment 발급과 AVD 주입 | 운영 DB DDL 확인·행 추가, bearer proof 생성 |
| G7 | 등록 후 Activity 시작 | 시작 즉시 운영으로 grant 요청 |
| G8 | 실제 제출·Accept | 운영 세션과 `AVD_SIMULATOR` 기록 생성. 기록 삭제 도구 없음 |
| G9 | 복원: 폐기, proof 삭제, 모드 제거와 재배포 | 운영 설정 복원 |
| G10 | Render에 WebXR 안내 활성화 (코드 연결, `three` 빌드 추가, 플래그, 재배포). 현재 미구현 | 운영 QR을 여는 지원 기기에 실험 버튼 노출 |

공통 변수(저장소 루트, Windows PowerShell 5.1). 자동 선택을 쓰지 않는다.

```powershell
$adb = 'C:\Android\Sdk\platform-tools\adb.exe'
$serial = 'emulator-5554'
$user = (& $adb -s $serial shell am get-current-user).Trim()   # 10이 아니면 중단
$out = 'C:\CarScope-External\p9\<UTC시각>'
New-Item -ItemType Directory -Force $out | Out-Null
```

## A. APK 식별과 설치

P9-A0 빌드: `C:\carscope-external\p9-a0\apk\carscope-debug-8a6f559.apk`, SHA-256 `b11f3a799a9970b541aa9a114e405d8cbce6e13b89896f6610a94c70be7dd3d4`. 다른 커밋에서 다시 빌드하면 값을 새로 기록한다. `versionName`은 `0.1.0-p0`로 고정이라 세대 구분에 쓸 수 없다.

| # | 확인 | 명령 | 합격 기준 |
|---|---|---|---|
| A1 | 세대 | `node tools/inspection-sync-poc/bin/deployment-preflight.mjs compat --apk <APK> --report $out\compat.json` | `NEW_DECODER`. Release는 `NO_SYNC_DECODER`로 FAIL이 정상이며 쓰지 않는다 |
| A2 | SHA-256 | `Get-FileHash -Algorithm SHA256 <APK>` | A1과 일치 |
| A3 | 기존 설치본 대조 | `& $adb -s $serial shell pm path --user $user io.carscope.app` 후 `& $adb -s $serial pull <base.apk 경로> $out\before.apk`, A1 적용 | 세대 기록. `LEGACY_DECODER`면 G4 전에 교체 필수 |
| A4 | 설치 (G1) | `& $adb -s $serial install --user $user -r <APK>` | 서명 충돌 시 **uninstall 금지**. uninstall은 app-private 파일을 지운다 |
| A5 | 설치 후 대조 | A3과 같은 방법으로 pull | SHA-256이 A2와 일치 |

구버전 APK는 신규 서버의 응답을 `INVALID`로 거부한다([호환성 표](p8-c1-deployment-readiness.md#apk와-서버-호환성)). 사용 중인 모든 기기를 G4 전에 교체한다.

## B. 기기 준비

### B1. 상태와 중단 기준

| # | 확인 | 명령 |
|---|---|---|
| B1a | identity snapshot | `python tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial $serial --report $out\readiness.json` |
| B1b | 사용자 | `& $adb -s $serial shell am get-current-user` |
| B1c | 부하 (1분 간격 3회) | `& $adb -s $serial shell cat /proc/loadavg`, `... cat /proc/meminfo`, `... getconf _NPROCESSORS_ONLN` |
| B1d | 호스트 메모리 | `Get-CimInstance Win32_OperatingSystem \| Select-Object FreePhysicalMemory,TotalVisibleMemorySize` (KiB) |
| B1e | WebView | `& $adb -s $serial shell dumpsys webviewupdate` |
| B1f | 기존 ANR | `& $adb -s $serial shell dumpsys activity lastanr > $out\lastanr-before.txt` |
| B1g | 남은 enrollment | `& $adb -s $serial shell "run-as io.carscope.app --user $user ls -l files/avd-simulator-enrollment.json"`. 내용은 읽지 않는다. 있으면 **Activity를 시작하기 전에 확인한다.** `InspectionActivity`도 `SyncReceiverActivity`를 상속하므로, 유효한 파일이 있으면 3D 화면을 여는 것만으로 grant를 요청한다(G7) |

readiness PASS는 identity 범위다. 안정성 판정이 아니다. 저장소에 수치 기준이 없어 아래 값을 **이번 P9의 제안 기준**으로 둔다. 과거 관측에서 정한 보수적 값이며 측정으로 조정한 값이 아니다. 기준을 넘기면 중단하고 사용자 프로세스를 종료하거나 AVD를 reset하지 않는다.

**P9-A2 예외(사용자 결정):** P9-A2에서는 사용자가 CPU·메모리·Load Average를 자동 중단 조건으로 쓰지 않도록 승인했다. 해당 수치는 참고용으로만 기록했고, 부하만을 이유로 BLOCKED를 판정하지 않았다. ANR은 증거를 수집한 뒤 복구 가능 여부를 판단하고, 데이터 손상·비정상 종료·시스템 불안정은 안전을 우선한다. 이 결정은 G2~G9 승인을 대신하지 않으며, 다음 단계에 적용하려면 다시 결정한다.

**성능 수치 해석:** load, 메모리, `gfxinfo`, 프레임 통계는 보존하되 성능 PASS의 근거로 쓰지 않는다. 화면이 동작했다는 사실이 성능 합격을 뜻하지 않으며, 수치 기준을 넘지 않았다는 것도 마찬가지다.

| 항목 | 중단 기준 | 근거 |
|---|---|---|
| AVD 시작 전 호스트 가용 메모리 | 4096 MiB 이하 | AVD RAM 4096 MB. P6-D5는 3360 MiB에서 시작하지 않음 |
| AVD 실행 중 호스트 가용 메모리 | 1024 MiB 미만 지속 | P6-D6은 305–560 MiB에서 BLOCKED |
| guest 1분 load | 3회 연속 코어 수 × 4 초과 | P6-D6은 2코어에서 17–30으로 BLOCKED |
| 새 ANR | 1건 | P7-A focus-event ANR 미해결 |

### B2. `sync-endpoint.json`

`SyncReceiverActivity.endpoint()`는 app-private `files/sync-endpoint.json`을 시작할 때마다 읽는다. 파일이 없거나 조건을 어기면 화면이 `연결 설정 미완료`로 표시되고 모든 버튼이 비활성이다. 비밀이 아니지만 인증도 아니다.

| 규칙 | 내용 |
|---|---|
| 크기 | 최대 2048 bytes |
| 키 | 정확히 `apiOrigin`, `mobileRoot`. 추가 키, 중복 키는 거부 |
| 값 | `https`, 호스트 필수, userinfo·query·fragment 금지, 경로는 비어 있거나 `/` |
| 시뮬레이터 조건 | 끝의 `/`를 빼고 **둘 다 정확히** `https://carscope-lluo.onrender.com` (`AvdSimulatorPolicy.API_ORIGIN`). 다른 origin은 로드돼도 enrollment를 읽지 않아 생성이 계속 거부된다 |

```powershell
$endpoint = '{"apiOrigin":"https://carscope-lluo.onrender.com","mobileRoot":"https://carscope-lluo.onrender.com/"}'
$endpoint | & $adb -s $serial shell "run-as io.carscope.app --user $user sh -c 'umask 077; mkdir -p files; cat > files/sync-endpoint.json && chmod 600 files/sync-endpoint.json'"
& $adb -s $serial shell "run-as io.carscope.app --user $user cat files/sync-endpoint.json"
& $adb -s $serial shell "run-as io.carscope.app --user $user ls -l files/sync-endpoint.json"
```

**권한 확인:** 마지막 명령의 결과가 `-rw-------`여야 한다. `umask`는 새 파일에만 적용되므로 기존 파일의 권한을 바꾸지 못한다. P9-A2의 기존 파일은 `0666`이었고 `chmod 600`을 실행한 뒤에야 `0600`이 됐다. 그 파일에는 UTF-8 BOM이 있었고 `mobileRoot` 끝에 `/`가 없어 새 값으로 교체했다. 이전 파일을 앱이 수락했는지는 확인하지 않았다.

**파싱 확인:** 파일 검사만으로 끝내지 않는다. 화면이 `HTTPS 주소 설정됨 · …`이면 앱의 파서가 수락한 것이고, `연결 설정 미완료`면 거부한 것이다.

PowerShell 5.1 파이프는 ASCII에 CRLF를 붙이며, 이 형식은 JVM의 실제 파서에서 통과함을 확인했다. P9-A2의 기기 배치는 Git Bash의 `printf '%s'`(101 bytes, CRLF 없음)로 실행했으므로 위 PowerShell 명령 자체는 기기에서 실행하지 않았다. 내용이 틀리면 같은 명령으로 덮어쓴다.

### B3. GLB

APK에는 GLB가 없다. `tools/three-poc/push-android-lab-model.mjs`가 app-private `files/debug-3d-assets/ioniq5.glb`로 복사하며, WebView는 이를 `external/ioniq5.glb`로만 제공한다. 파일이 없으면 이 경로가 404다. 원본 모델을 변경하지 않는다.

| 항목 | 내용 |
|---|---|
| 실행 위치 | 저장소 루트. Node만 필요 |
| 입력 | `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb` (1,902,820 bytes, SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`). 도구 상한 32 MiB |
| adb | `ANDROID_HOME`이 있으면 그 아래 `platform-tools\adb.exe`, 없으면 PATH |
| 사용자 | 도구가 `am get-current-user`로 읽는다. `run-as`가 되는 Debug 설치본만 가능 |

```powershell
node tools/three-poc/push-android-lab-model.mjs --serial=$serial --glb=C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb
& $adb -s $serial shell "run-as io.carscope.app --user $user ls -l files/debug-3d-assets/ioniq5.glb"
```

**성공 확인:** 도구는 기기의 SHA-256을 입력과 비교하고 일치할 때만 `Pushed ... (1902820 B, sha256 ...)`을 출력한다. 화면을 연 뒤 `logcat -d -s CarScopeInspection:I`의 `lifecycle create files=[external/ioniq5.glb:1902820]`로도 확인한다. `-1`이면 파일이 없다.

| 실패 | 안전한 복구 |
|---|---|
| `Cannot read the current Android user` | adb 연결과 serial 확인 |
| `run-as failed` | A4·A5 확인. Debug가 아니거나 해당 사용자에 미설치. uninstall하지 않는다 |
| `Size ... outside` | 입력 파일 확인. 상한을 바꾸지 않는다 |
| `SHA mismatch` | 임시 파일은 자동 삭제된다. `--serial=$serial --remove` 뒤 다시 실행 |
| 화면에서 모델 로드 실패 | 위 logcat으로 크기 확인 후 다시 push. GLB·geometry·생성 자산을 고치지 않는다 |

제거는 `node tools/three-poc/push-android-lab-model.mjs --serial=$serial --remove`다. 대상 파일만 지운다.

## C. 서버와 세션 단계

**C1~C6은 순서대로 진행하고 앞 단계가 합격해야 다음으로 간다.** Native 수신 화면은 `FLAG_SECURE`이므로 캡처가 비어 있을 수 있다. 문구는 눈으로 확인해 기록한다.

### C1. 기본 서버 상태 (DENY_DEFAULT)

**이 상태에서 세션 생성 성공을 기대하지 않는다.** 서버가 생성을 거부하고, enrollment가 없으면 앱도 `DenyByDefaultCredentialProvider`를 쓴다.

```powershell
node tools/inspection-sync-poc/bin/deployment-preflight.mjs probe --origin https://carscope-lluo.onrender.com
& $adb -s $serial shell am start --user $user -n io.carscope.app/.sync.SyncReceiverActivity
```

| # | 합격 기준 |
|---|---|
| C1a | `/healthz`: `STATEFUL_DENY_DEFAULT`, `DENIED`, `historyRead` 없음 |
| C1b | 화면: `HTTPS 주소 설정됨 · 연결/TLS 미확인 · 생성 인증 기본 거부`, `실제 차량 인증 미구현 · 생성 권한이 없으면 세션을 만들 수 없습니다.` |
| C1c | **`점검 요청 생성` 비활성.** 활성이면 FAIL |
| C1d | (G2 선택) `서비스 연결 확인`: `HTTPS 응답 확인 · 서버 인증서 검증 성공 · 차량 인증과는 별개입니다.` 이것은 인증 성공이 아니다 |
| C1e | (G2 선택) `probe --approve-rate-window-writes`: records 403, session 401, 생성 403 |

**이어서 [배포 순서](p8-c1-deployment-readiness.md#배포-순서)의 백업(G3)과 Manual Deploy(G4)를 수행한 뒤 C1a~C1c를 다시 확인한다.** 신규 코드도 DENY_DEFAULT여야 한다. `render --deployed-commit <SHA>`가 `returns serverNow`를 출력해야 한다.

### C2. 승인된 AVD 시뮬레이터 활성화 (G5)

Render Environment에 `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`를 추가하고 재배포한다. 값은 이 문자열만 허용되며 다른 값이면 서버가 시작을 거부한다. OEM 소유권이 아니다. 저장 화면의 재배포 옵션이 어떤 커밋을 배포하는지 실행 전에 확인한다(NOT_VERIFIED).

| # | 합격 기준 |
|---|---|
| C2a | `probe`: `STATEFUL_AVD_SIMULATION`, `OPERATOR_APPROVED_AVD_ONLY`, `historyRead` 없음 |
| C2b | 배포 커밋이 C1과 같음 |

### C3. enrollment 발급과 주입 (G6)

`issue`는 DB에 등록을 만들며 시작 시 `cs_avd_*` DDL도 확인한다. URL을 명령줄에 넣지 않는다. 출력 폴더는 저장소 밖에 이미 있어야 하고, 기존 파일은 덮어쓰지 않는다. `--hours`는 1~24, 기본 2다.

```powershell
npm install --prefix tools/inspection-sync-poc --ignore-scripts --no-audit --no-fund --package-lock=false
$secure = Read-Host -AsSecureString
$env:PG_ADMIN_DATABASE_URL = [Net.NetworkCredential]::new('', $secure).Password
node tools/inspection-sync-poc/bin/avd-simulator-admin.mjs issue --label CarScope_Pleos_API34 --out C:\CarScope-External\p9\avd-enrollment-<UTC시각>.json --hours 2
Remove-Item Env:PG_ADMIN_DATABASE_URL
Get-Content -Raw -Encoding UTF8 C:\CarScope-External\p9\avd-enrollment-<UTC시각>.json | & $adb -s $serial shell "run-as io.carscope.app --user $user sh -c 'umask 077; mkdir -p files; cat > files/avd-simulator-enrollment.json'"
& $adb -s $serial shell "run-as io.carscope.app --user $user wc -c files/avd-simulator-enrollment.json"
```

| # | 합격 기준 |
|---|---|
| C3a | stdout: `status:"ISSUED"`, `secret:"SAVED_LOCALLY_NOT_PRINTED"`. registration UUID를 기록한다 |
| C3b | 크기가 1~512 bytes. **내용을 `cat`하지 않는다** |

앱은 정확히 `mode`, `registrationId`, `enrollmentProof`, `expiresAt` 필드만 받고, 만료됐거나 24시간을 넘거나 심볼릭 링크이면 거부한다.

### C4. Native 세션 생성 (G7)

Activity가 시작되면 grant를 한 번 요청한다. **grant 수명은 120초이고 자동 재요청은 없다.** 만료되면 `점검 요청 생성`이 다시 비활성이 되며, `서비스 연결 확인` 클릭(G2) 또는 Activity 재시작으로 다시 요청한다. 기기 시계가 조금 느리면 앱이 유효 시작까지 최대 3초 기다린다.

```powershell
& $adb -s $serial shell am start --user $user -n io.carscope.app/.sync.SyncReceiverActivity
& $adb -s $serial logcat -d -s CarScopeAvdAuth:V '*:S' | ForEach-Object { if ($_ -match '\b(PROVISION_[A-Z_]+)\s*$') { $Matches[1] } }
```

| # | 합격 기준 | 실패 시 |
|---|---|---|
| C4a | `PROVISION_GRANT_VERIFIED`, 화면 `운영자 승인 AVD 시뮬레이션 전용 · 실제 차량 소유권/차량 인증이 아닙니다.` | `PROVISION_HTTP_UNAUTHORIZED`: 등록 만료·폐기 확인. `PROVISION_GRANT_NOT_YET_VALID`: 시각 차이 기록 |
| C4b | `점검 요청 생성` 활성. 120초 안에 진행 | 비활성이면 endpoint(B2), enrollment(C3), grant 만료 순으로 확인 |
| C4c | **명시적 클릭** 뒤 QR 표시 | `INVALID`면 구버전 APK 의심(A) |

### C5. `serverNow` 확인

**기기 화면과 로그에는 `serverNow` 값이 나오지 않는다.** 응답 본문과 토큰을 로그로 남기지 않는 것이 의도된 동작이며, 이를 우회하는 진단을 추가하지 않는다. 숫자 값을 운영에서 직접 보는 검증 도구는 없으므로 아래의 간접 근거로 판정하고 그 범위를 기록한다. 필드 자체는 CI의 실제 Kotlin↔Node HTTPS 테스트가 검증한다.

3D 화면에서 시작해야 한다. `SyncReceiverActivity`를 직접 열면 브리지가 없어 판정할 수 없다.

```powershell
& $adb -s $serial shell am start --user $user -n io.carscope.app/.lab.InspectionActivity
```

| # | 합격 기준 | 실패 시 의미 |
|---|---|---|
| C5a | 배포 커밋이 `returns serverNow` (C1) | 신규 서버 미배포 |
| C5b | 부품 결과 화면의 `이 부품 모바일 점검 요청`으로 수신 패널 진입, 세션 생성 후 패널 문구가 `Native에서 수락한 뒤 3D에서 기록을 직접 선택하세요.` | `3D 연결 차단: 서버 기준 시각 계약이 없습니다...`는 **필드 부재, RTT 5000ms 초과, 전달 지연 예산 초과를 구분하지 못한다.** C5a를 먼저 본다. 시간 조건을 완화하지 않는다 |

### C6. Native → 3D 전달 (G8)

대표 경로 `washer-fluid`, `tire.front-left`, `brake-fluid` 순으로 진행한다. 빠른 제출은 시각 상한 때문에 거짓 거부될 수 있으며([P7-C3](p7-c3-server-clock.md)) 발생하면 조건을 바꾸지 않고 기록한다.

| # | 확인 | 합격 기준 |
|---|---|---|
| C6a | 실제 스마트폰 광학 스캔 → 제출 | 폰 receipt의 digest 표시 |
| C6b | Native 결과 확인 | 자동 수락 없음. digest가 폰과 일치 |
| C6c | `이 결과 수락` | 폰 상태 ACCEPTED |
| C6d | `패널 닫기 · 점검 요청 유지` → 3D 후보 (P9-UX-A 전 APK는 `3D로 돌아가기`) | `receivedAt`/`acceptedAt`이 서버 값 그대로. 관측 시각을 화면 시각으로 덮어쓰지 않음 |
| C6e | 사용자 선택 | 선택 전 자동 적용 없음. SDK 관측값과 합치지 않음 |

## D. WebView Referer와 첫 RPC

P7-C2가 먼저 확인하라고 남긴 위험이다. RPC는 앱 내부이므로 서버 상태와 무관하게 C1 이후 언제든 볼 수 있다. 실패해도 잘못된 전달은 없고 채널이 동작하지 않을 뿐이다.

앱은 `setWebContentsDebuggingEnabled`를 호출하지 않는다. 이전에 같은 AVD의 Debug APK에서 소켓을 사용한 기록이 있으나([검증 보고](validation-report.md)) 이번 빌드에서는 확인이 필요하다. JS 평가는 하지 않는다.

```powershell
$appPid = (& $adb -s $serial shell pidof io.carscope.app).Trim()
& $adb -s $serial forward tcp:9223 localabstract:webview_devtools_remote_$appPid
# Chrome chrome://inspect > Configure에 localhost:9223 추가 후 페이지 연결, Network 탭 확인
& $adb -s $serial forward --remove tcp:9223
```

| # | 확인 | 합격 기준 | 실패 시 의미 |
|---|---|---|---|
| D1 | 3D 연결 문구 | `전달 어댑터 연결 · 실제 Native E2E 검증과 별개` | `Native 전달 불가 · 새 결과 적용 중단`이면 RPC 실패(Referer 또는 `currentPage`) |
| D2 | RPC 요청 헤더 | `Referer: https://carscope-inspection.invalid/index.html?...` | Pleos 포크의 헤더 변경 가능성 |
| D3 | 페이지 로드 직후 첫 RPC, 5회 반복 | 첫 RPC가 404가 아님 | `currentPage` 경합 |

소켓을 쓸 수 없으면 D2·D3은 BLOCKED로 기록하고 D1만 판정한다.

## E. History

| # | 확인 | 합격 기준 |
|---|---|---|
| E1 | 저장 (G3 수준의 승인, 읽기 전용) | `database` 검사의 records 증가. 필요하면 읽기 전용 트랜잭션에서 `SELECT authority_namespace,task_id,result_digest,accepted_at FROM cs_inspection_records ORDER BY created_at DESC LIMIT 5`. `AVD_SIMULATOR`, 소유자 열 NULL |
| E2 | History 화면 ([P8-B1](p8-b1-inspection-history-ui.md)) | read provider가 없어 요청을 보내지 않는다. `UNAVAILABLE`과 "저장된 기록이 없다는 뜻이 아닙니다"가 합격. 빈 목록, 데모 데이터, History 요청은 FAIL |
| E3 | History API (G2) | `probe --approve-rate-window-writes`에서 **403이 합격**. `PRODUCTION_AUTH_BLOCKED`. 시뮬레이터 모드에서도 같다 |

## F. 취소·만료·복귀·재생성

| # | 시나리오 | 합격 기준 |
|---|---|---|
| F1 | QR 표시 중 취소 | 폰 제출 거부, 후보 없음, 기록 없음 |
| F2 | 초대 10분 만료 | 스캔 거부, QR 숨김. 정책을 줄이지 말고 실제로 기다린다 |
| F3 | 제출 후 Accept 전 30분 만료 | 기록 없음, 늦은 Accept 거부 |
| F4 | [Settings 전환](#포커스-전환-절차) 후 복귀 | 세션 상태 복구 또는 명확한 실패. 늦은 callback 미전달 |
| F5 | 회전, renderer 종료 | 권한 폐기, 늦은 결과 미전달. renderer 강제 종료는 별도 승인 |
| F6 | 재생성 | 새 session/binding. 이전 결과가 새 화면에 나오지 않음 |
| F7 | grant 만료 | 120초 경과 후 `점검 요청 생성` 비활성. 진행 중 세션은 자체 TTL 유지. `서비스 연결 확인` 후 다시 활성. enrollment 재발급 없음 |

## G. ANR과 RenderThread

P7-A에서 focus-event ANR(5018ms)로 앱이 종료됐고 원인은 확정되지 않았다. 각 세션 전후와 실패 직후에 수집한다.

```powershell
& $adb -s $serial logcat -b crash -d > $out\logcat-crash.txt
& $adb -s $serial logcat -d -s CarScopeInspection:I CarScopeAvdAuth:V ActivityManager:E chromium:E > $out\logcat.txt
& $adb -s $serial shell dumpsys activity lastanr > $out\lastanr.txt
& $adb -s $serial shell dumpsys activity exit-info io.carscope.app > $out\exit-info.txt
& $adb -s $serial shell dumpsys gfxinfo io.carscope.app > $out\gfxinfo.txt
& $adb -s $serial shell dumpsys meminfo io.carscope.app > $out\meminfo.txt
& $adb -s $serial shell "ps -T -p $appPid | grep -iE 'RenderThread|CrRendererMain|main'"
```

ANR 원본은 `/data/anr`를 직접 읽을 수 없어 P7-A에서 `adb bugreport`로 확보했다. bugreport에는 개인 정보가 들어갈 수 있으므로 Git 밖에 두고 공유하지 않는다. 공유 전에 로그에서 `Bearer`, `receiverToken`, `inviteToken`, `enrollmentProof`, `postgresql://`를 검색한다.

| # | 확인 | 합격 기준 |
|---|---|---|
| G1 | ANR | B1f 이후 새 ANR 없음. 있으면 해당 단계 FAIL, 조작 중단 |
| G2 | RenderThread | 스레드 존재, 프로세스 유지. 성능 결론으로 쓰지 않는다 |
| G3 | focus 전환 | 아래 절차로 복귀한 뒤 입력 응답. P7-A 재현 시나리오 포함 |

### 포커스 전환 절차

**`input keyevent 3`(HOME)은 pause·복귀 검증으로 인정하지 않는다.** P9-A2에서 이 패널의 앱은 HOME을 받아도 `topResumedActivity`로 남았고 lifecycle 로그가 바뀌지 않았다. 대신 같은 패널에 Settings를 띄운다.

```powershell
& $adb -s $serial shell am start --user $user -a android.settings.SETTINGS
# 몇 초 뒤 확인
& $adb -s $serial shell dumpsys activity activities | Select-String topResumedActivity
& $adb -s $serial shell am start --user $user -n io.carscope.app/.lab.InspectionActivity
& $adb -s $serial logcat -d -s CarScopeInspection:I | Select-String 'lifecycle|"event":"visibility"'
```

| 순서 | 합격 기준 |
|---|---|
| Settings 실행 뒤 | `topResumedActivity`가 `com.android.car.settings`, 로그에 `lifecycle pause finishing=false`, `"hidden":true` |
| 복귀 뒤 | `am start`가 `its current task has been brought to the front`, 로그에 `lifecycle resume`, `"hidden":false`, 새 `lifecycle create` 없음 |
| 입력 | 복귀 후 터치와 Back으로 상태가 전이되고, 메모리 기록이 유지된다 |

이 절차는 Settings 전환 1회의 관측이다. P7-A focus-event ANR의 재현이나 해결을 뜻하지 않는다.

## H. 실행 후 복원 (G9)

성공과 실패 모두에서 이 순서로 수행한다.

| # | 작업 | 명령·확인 |
|---|---|---|
| H1 | 등록 폐기 | `PG_ADMIN_DATABASE_URL` 설정 후 `node tools/inspection-sync-poc/bin/avd-simulator-admin.mjs revoke --id <registration UUID>`, `status:"REVOKED"` |
| H2 | AVD proof 삭제 | `& $adb -s $serial shell "run-as io.carscope.app --user $user rm files/avd-simulator-enrollment.json"` |
| H3 | 운영자 PC 파일 삭제 | 해당 enrollment 파일 한 개만 |
| H4 | 모드 제거 | Render에서 `CARSCOPE_AVD_SIMULATOR_MODE` 제거, 재배포 |
| H5 | 복원 확인 | `probe`가 `STATEFUL_DENY_DEFAULT`, `DENIED`. 앱의 `점검 요청 생성` 비활성 |
| H6 | 포트 전달 제거 | `& $adb -s $serial forward --remove tcp:9223` |

남는 것: `cs_avd_*` 테이블과 폐기된 등록 메타데이터, `AVD_SIMULATOR` 기록(삭제 도구 없음), 이미 만든 세션(자체 TTL로 만료), AVD의 endpoint와 GLB(비밀 아님). 테이블을 DROP하지 않는다. 서버 코드는 되돌리지 않는다. 신규 코드도 DENY_DEFAULT이기 때문이다.

## I. WebXR 3D AR 안내 (P9-XR-C)

**전부 `NOT_RUN_DEFERRED_TO_E2E`다.** 합성 검증([증거](evidence/p9-xr-c/README.md))으로 대체하지 않으며 PASS로 옮겨 적지 않는다. 설계와 제약은 [P9-XR-C](p9-xr-c-webxr-inspection-integration.md)다.

### I0. 경로

| 경로 | 범위 | 준비 |
|---|---|---|
| 개발 QR (먼저 실행) | 실제 QR v2 프로토콜, 로컬 시험 세션. Native·Render 없음. 차량 측은 `receiver.mjs` | 아래 명령. 공개 배포 없음 |
| Native QR → Render | 전체 경로 | **현재 불가.** G10 필요. 그 전에는 버튼이 나오지 않는 것이 정상이다 |

```powershell
Set-Location tools\inspection-sync-poc
$env:SYNC_LOCAL_TEST_AUTH='1'; $env:CARSCOPE_WEBXR_GUIDE='EXPERIMENT'; $env:SYNC_MOBILE_PORT='4182'
npm run serve:mobile-dev
# 다른 터미널. 휴대폰 USB 디버깅을 켠 뒤:
& $adb -s <휴대폰 serial> reverse tcp:4182 tcp:4182
node bin/receiver.mjs --server=http://127.0.0.1:4182 --mobile-base=http://127.0.0.1:4182/ --wait=600
```

`receiver.mjs`가 한 번 출력하는 주소를 휴대폰 Chrome에서 연다. 로컬 시험 토큰이지만 로그와 캡처에 남기지 않는다. 주소는 `localhost`가 아니라 `127.0.0.1`이어야 한다. 이 서버는 정확한 Host만 받는다. 서버와 receiver 실행은 데스크톱에서 확인했고 `adb reverse`와 휴대폰 접속은 실행하지 않았다.

기록: 기기, Android·Chrome 버전, 커밋, 플래그 값, 경로.

### I1. 진입과 지원

| # | 확인 | 합격 기준 |
|---|---|---|
| I1a | 플래그 끈 서버의 워셔액 QR | `3D AR로 위치 찾기` 없음. 기존 흐름 완료 |
| I1b | 플래그 켠 서버의 워셔액 QR | 버튼 표시. 주소창에 fragment 없음 |
| I1c | 다른 부품 QR | 버튼 없음 |
| I1d | 안내 → `AR 시작` | 지원 표 세 항목 표시. 권한 프롬프트 후 카메라 AR 시작 |
| I1e | 카메라 권한 거부 | 이유 표시, 2D 카메라와 체크리스트로 복귀 가능 |

### I2. 공간 고정과 추적

| # | 확인 | 합격 기준 |
|---|---|---|
| I2a | 표면 조준 후 탭 | 조준 원이 표면에 나타나고 그 자리에 화살표 생성 |
| I2b | 패널 버튼 탭 | 화살표가 함께 배치되지 않음 (DOM overlay, `beforexrselect`) |
| I2c | 좌우 이동, 접근, 화면 밖으로 나갔다 복귀 | 화살표가 실제 공간의 같은 지점에 머묾. 어긋남은 관측값으로 기록 |
| I2d | 렌즈 가리기, 빠른 흔들기 | 경고, 표시 숨김. 복구되면 다시 나타남 |
| I2e | 위치 다시 지정, 표시 제거 | 동작. 실패 시 기존 표시 유지 |
| I2f | 실제 엔진룸 | 표면 검출 여부와 화살표·캡 어긋남 기록. 정확도 PASS로 해석하지 않음 |

### I3. 점검 상태와 QR 컨텍스트

| # | 확인 | 합격 기준 |
|---|---|---|
| I3a | 연결 후 AR → 체크리스트로 | 같은 화면으로 복귀, 재로드 없음, `연결됨` 유지 |
| I3b | 체크 항목 일부 표시 → AR → 복귀 | 표시 유지 |
| I3c | AR 진입과 복귀만 수행 | `receiver.mjs`에 결과 없음. 체크 항목 자동 표시 없음 |
| I3d | 복귀 후 결과 확정·전송 → 수락 | 전송 성공, 수락 표시. 새 QR 불필요 |
| I3e | 연결 전 AR → Back → 연결 | 연결 성공 1회 |
| I3f | AR 중 차량 측 취소 | 복귀 후 취소 표시 |

### I4. 카메라와 수명주기

| # | 확인 | 합격 기준 |
|---|---|---|
| I4a | 2D 카메라 사용 중 안내 열기 → AR 시작 | 카메라 충돌 오류 없음 |
| I4b | AR 종료 → 2D 카메라로 | 2D 영상 재개. 지연이나 오류 기록 |
| I4c | AR 중 시스템 Back | 세션 종료, 점검 화면 유지. QR 연결 유지 |
| I4d | AR 중 앱 전환, 화면 잠금 후 복귀 | 카메라 표시등 꺼짐, 복귀 후 안내 화면에서 선택 가능 |
| I4e | 회전, 접기·펼치기 | 컨트롤 접근 가능, 오류 시 복귀 가능 |
| I4f | 안내 3회 반복 | 세션 재시작 가능. 발열·배터리·프레임률은 관측값으로만 기록 |

### I5. 미지원 환경

| # | 확인 | 합격 기준 |
|---|---|---|
| I5a | iOS Safari 또는 ARCore 미지원 기기 | 버튼 없음, 이유 표시, 2D와 수동 점검 가능 |
| I5b | 플래그 켠 정적 서버(`POC_HOST` 지정)를 HTTP LAN 주소로 접속. QR 개발 서버는 loopback 전용이라 대상이 아니다 | 버튼 없음, HTTPS 또는 localhost가 필요하다는 이유 표시 |

## 결과 기록

각 행을 PASS / FAIL / NOT_RUN / BLOCKED로 적고 APK SHA-256, 서버 커밋, `/healthz` 모드, AVD 이미지, WebView 버전, 폰 기종을 함께 남긴다. 브라우저·AVD·실차 결과와 성능 수치를 섞지 않는다. 성능 수치는 관측값으로만 남기고 성능 PASS로 해석하지 않는다. AVD 통과는 실차나 실제 소유권의 증거가 아니다.
