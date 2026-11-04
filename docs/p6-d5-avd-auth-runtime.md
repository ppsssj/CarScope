# P6-D5 — AVD 인증 런타임 조사와 재실행

최초 AVD 장애 원인은 **미확인**이다. 이 PR은 P6-D5 완료나 실제 QR 성공을 주장하지
않는다. 별도로 재현한 refresh 중복 callback 결함을 수정하고 다음 실측의 진단을
보강한다. 서버 인증·TLS·호스트·시각 검증을 완화하지 않는다.

## 기준과 증거

- 작업 사본 `C:\dev\CarScope`, 브랜치 `fix/p6-d5-avd-auth-runtime-20261105`.
- 시작 시 clean. fetch한 `origin/main`과 HEAD 모두
  `f58c575609c48c4b4ffb6c903cd821dbae031df5`; PR #67 MERGED 확인.
- 이번 실행: Windows, Node 22.16.0, Temurin JDK 17.0.20.1, SDK `C:\Android\Sdk`.
- 2026-11-04 KST 새 관측: `adb devices`에 장치 없음. qemu/emulator 프로세스 없음.
  host 가용 메모리 약 3360 MiB / 총 16277 MiB. 4096 MiB AVD를 강제로 시작하지 않음.
  guest CPU/load/memory/시각/등록 파일 상태와 과거 logcat은 수집 불가.
- `/healthz` 첫 시도는 20초 내 실패. 두 번째 credential-free GET은
  `UP / STATEFUL_DENY_DEFAULT / DENIED`. 첫 실패를 서버 인증 실패로 해석하지 않음.
- 사용자 제공 과거 사실(PC provision 200, 약 95분 enrollment 잔여, AVD-PC 약 -1초,
  private file 존재)은 이번 실행의 재검증 결과가 아니다. 현재 유효성은 가정하지 않음.

## 조사 A–H

| 경로 | 코드 근거와 판단 |
| --- | --- |
| A enrollment | exact JSON fields, UTF-8, UUIDv4, 43자 proof, 최대 24h, 만료·symlink 거부. API/mobile origin 모두 고정 origin과 일치해야 함 |
| B HTTPS | 고정 HTTPS URI가 Host/SNI를 결정. 플랫폼 CA/hostname verifier 유지. POST JSON, redirect 금지, 5초 connect/read/전체 deadline, 응답 크기/encoding 검사. 실제 AVD ingress 결과는 미확인 |
| C grant | Node 반환 12개 필드와 Kotlin exact keys 일치. mode/origin/audience/scope/registration/flags/token/UUID/정수 검증. Any/Boolean identity 비교 경고는 존재하나 이번 조사에서 최초 장애 원인으로 입증되지 않음 |
| D 시각 | 서버 issuedAt=notBefore, expiresAt=issuedAt+120000. Android는 notBefore<=now<expiresAt 요구. AVD가 뒤처지고 응답이 빠르면 거부될 수 있으나 과거 응답 당시 시각·코드가 없어 가설에 그침. 허용 오차 추가 없음 |
| E refresh | generation으로 이전 refresh/close callback 차단. 동일 generation의 두 번째 callback은 기존에 차단하지 않았음. 실패 뒤 성공으로 재인가되거나 성공 뒤 실패로 grant가 유실됨을 새 테스트로 재현 |
| F provider | 동일 endpoint의 유효한 메모리 snapshot만 반환. transport.creationAuthorized는 provider!=null이며 closed면 false. 별도 grant 복사/저장 경로 없음 |
| G Activity | onStart가 source→transport→controller 생성 후 refresh. callback과 1초 tick에서 render. IDLE/FAILED/CANCELLED/EXPIRED이면서 not busy이고 authorized일 때 Create 활성화. onStop에서 generation/handler/source/transport/QR 정리 |
| H callback | exchange는 AtomicBoolean으로 deadline/worker 완료 중 하나만 dispatcher에 전달. Activity dispatcher도 수명주기 generation 검사. source의 중복 callback 방어 누락은 재현됐지만 실제 exchange에서 이 경로가 발생했다는 증거는 없음 |

## 확인된 결함과 최소 수정

`AvdSimulatorProvisioningTest`의 신규 중복 callback 테스트는 수정 전 4개 중 1개 FAIL.
첫 callback=null 후 같은 callback에 정상 grant를 전달하면 snapshot이 null이어야
하지만 grant가 남았다. refresh마다 첫 callback만 소비하도록 수정했다. 동기 완료된
요청을 pending에 다시 넣지 않으며, 이미 callback을 전달한 exchange가 예외를 던져도
두 번째 실패 callback을 만들지 않는다. 기존 generation/close/expiry 조건은 유지한다.

시각 계약의 판정 자체는 유지하고 `PROVISION_GRANT_NOT_YET_VALID`와
`PROVISION_GRANT_EXPIRED`로 분류한다. 전체 deadline timeout도 고정
`PROVISION_TIMEOUT`을 남긴다. HTTP 상태는 미리 정의한
`PROVISION_HTTP_UNAUTHORIZED`, `PROVISION_HTTP_FORBIDDEN`,
`PROVISION_HTTP_RATE_LIMITED`, `PROVISION_HTTP_REJECTED`만 기록한다.
본문·bearer·proof·인증 URL·예외 메시지/스택은 기록하지 않는다.

## 변경 파일

- `app/src/debug/java/io/carscope/app/sync/AvdSimulatorProvisioning.kt`: 첫 완료 소비,
  동기 완료 pending 처리, 고정 시각/HTTP/deadline 진단.
- `app/src/testDebug/java/io/carscope/app/sync/AvdSimulatorProvisioningTest.kt`:
  중복·동기 callback과 notBefore/expiry 경계 회귀.
- `app/src/testDebug/java/io/carscope/app/sync/HttpsAvdSimulatorGrantExchangeTest.kt`:
  실제 exchange 코드를 fake platform connection으로 실행. 정상 응답→provider→
  creationAuthorized, 잘못된 JSON/401/403/만료/encoding/socket timeout,
  deadline 뒤 늦은 성공 및 큐에 들어간 callback 취소. 네트워크/TLS 실측이 아님.
- `tools/inspection-sync-poc/android/check-boundary.py`: 새 테스트의 APK/AAB 미포함 및
  신규 회귀 테스트 실행을 기존 경계 검사에 포함.
- 이 문서와 검증 인덱스. 서버/DB/Render/Release 정책·SDK·형상·UI 디자인 변경 없음.

## 자동 검증

아래는 이번 실행 결과와 명령이다. 기존 XML/빌드 파일만으로 PASS를 부여하지 않았다.
전체 Android 검사의 첫 시도는 기존 ChargePort/Component/Navigation/Visibility WebView
테스트에서 생성 자산 FileNotFoundException이 발생하여 중단했다. CI에 명시된
`npm ci --ignore-scripts --prefix tools/three-poc`와 두 자산 패키징 스크립트를 실행하고
다시 검증하여 통과했다. 첫 패키징 시도 역시 qrcode 의존성이 없어 실패했으며 npm ci 후 해결했다.
기존 geometry 소스나 GLB를 수정한 것은 아니다. 생성된 Debug 자산은 git-ignored다.

| 검사 | 이번 결과 |
| --- | --- |
| 수정 전 중복 callback 재현 | FAIL: 4개 중 1개 실패, 예상한 regression red |
| 수정 후 집중 검사 | PASS: 당시 9개, 이후 전체 실행에 시간 경계 포함 10개 |
| 전체 app JVM/Robolectric | PASS: 29 suites, 193 tests, 실패/오류/SKIP 0 |
| coreOnly fresh rerun | PASS 37 / SKIP 1 (`IONIQ5_PARTS not set`), 실패/오류 0 |
| Node `npm test` | PASS 107 / SKIP 4 / FAIL 0; 로컬 PG_TEST_URL 없는 PostgreSQL 검사 4개 |
| Node `npm run test:avd-simulator` | SKIP 2; 실제 PostgreSQL 연동 성공 주장 없음 |
| Node `npm run check` | PASS |
| Debug/Release APK, Release AAB, lint | PASS: Gradle BUILD SUCCESSFUL (증분 빌드, 실행 30 / up-to-date 76 tasks); lint 오류 0, warning 23 |
| Debug/Release boundary | PASS: sync DEX/QR/INTERNET Debug-only, Release APK/AAB clean; readiness 단위 검사 7 PASS |
| 실제 AVD 120초 grant / Create / session 201 / QR | BLOCKED: exact AVD 없음, 서버 DENY_DEFAULT, 실제 인증 요청 미승인·미실행 |
| 실제 QR 만료·취소 / 재시작·권한 만료 기본 거부 | NOT_RUN |
| 실제 스마트폰 washer-fluid / 타이어 E2E | NOT_RUN (P2 선행 조건 미충족) |

```powershell
# 저장소 루트, JDK17 / SDK34. 첫 실행은 위 CI 자산 준비를 먼저 수행.
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain --max-workers=1
.\gradlew.bat :app:testDebugUnitTest --tests 'io.carscope.app.sync.AvdSimulator*' --tests 'io.carscope.app.sync.HttpsAvdSimulatorGrantExchangeTest' --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
python tools/inspection-sync-poc/android/check-boundary.py
npm --prefix tools/inspection-sync-poc run check
npm --prefix tools/inspection-sync-poc test
npm --prefix tools/inspection-sync-poc run test:avd-simulator
git diff --check
```

이번 실행은 Render 환경변수·실제 DB 발급/폐기·private proof 주입을 수행하지 않았다.
제품 코드 변경은 Debug source set에만 있다. Release manifest/권한/배포 정책은 그대로다.

## 승인 후 실제 AVD 절차

실측은 **BLOCKED**. AVD 부재와 DENY_DEFAULT 상태이며 실제 인증 요청은 하지 않았다.
Render 환경변수 변경, 실제 DB 발급/폐기, private 인증 파일 주입, 외부 인증 요청은
각각 사용자 승인이 필요하다(이번 작업 요청의 P2 조건). 아래는 실행하지 않은 절차다.
운영자 DB 환경변수 비밀값은 안전한 로컬 세션으로만 공급하고 터미널/대화에 출력하지 않는다.

1. 여유 메모리를 확보하고 사용자가 AVD를 시작한 뒤 read-only readiness 실행:

   ```powershell
   python tools/inspection-sync-poc/android/device-readiness.py --sdk C:\Android\Sdk --serial emulator-5554 --report C:\CarScope-External\p6-d5-readiness.json
   $adb = 'C:\Android\Sdk\platform-tools\adb.exe'
   & $adb -s emulator-5554 shell cat /proc/loadavg
   & $adb -s emulator-5554 shell cat /proc/meminfo
   & $adb -s emulator-5554 shell getconf _NPROCESSORS_ONLN
   & $adb -s emulator-5554 shell date -u
   [DateTime]::UtcNow.ToString('o')
   & $adb -s emulator-5554 shell am get-current-user
   Invoke-RestMethod https://carscope-lluo.onrender.com/healthz -TimeoutSec 20 |
     Select-Object status,mode,sessionCreation
   ```

   정확한 AVD/API34/user10, 부팅·SystemUI·WebView, CPU 대비 지속 과부하/메모리
   부족/ANR 여부를 먼저 확인한다. 불안정하면 중단한다. 시각 차이는 기록하되
   grant 검증을 우회하지 않는다. 기존 파일의 내용은 읽어 출력하지 않는다.
2. 자동 검증을 통과한 Debug APK만 user10에 설치한다. 서명 충돌 시 uninstall하지
   말고 데이터 보존을 먼저 판단한다. 설치/실행 명령:

   ```powershell
   & $adb -s emulator-5554 install --user 10 -r app/build/outputs/apk/debug/app-debug.apk
   ```

3. 실제 DB 발급 승인 후 [P6-D4 운영자 절차](p6-d4-avd-android-provisioning.md)의
   `admin:avd issue`를 사용한다. 최신의 고유한 외부 파일명을 사용하고 기존 파일을
   덮어쓰지 않는다. `PG_ADMIN_DATABASE_URL`은 외부 DB TLS verify-full 계약을 유지한다.
   새 registration의 expiresAt만 확인하고 secret 파일 내용을 출력하지 않는다.
4. 별도 private 파일 주입 승인 후 P6-D4의 stdin→run-as/user10 명령을 실행한다.
   `sync-endpoint.json`은 비밀 없는 apiOrigin/mobileRoot만 고정 origin으로 설정한다.
5. 별도 Render 변경 승인 후에만 `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`
   설정/재배포. health의 `STATEFUL_AVD_SIMULATION / OPERATOR_APPROVED_AVD_ONLY` 확인.
6. 별도 외부 인증 요청 승인 후에만 Activity를 실행한다. onStart가 즉시 인증 요청한다.

   ```powershell
   & $adb -s emulator-5554 shell am start --user 10 -n io.carscope.app/.sync.SyncReceiverActivity
   & $adb -s emulator-5554 logcat -d -s CarScopeAvdAuth:V '*:S' |
     ForEach-Object { if ($_ -match '\b(PROVISION_[A-Z_]+)\s*$') { $Matches[1] } }
   ```

   `PROVISION_GRANT_VERIFIED`, 120초 서버 TTL, Create 활성화, 명시 클릭 후
   POST /v1/sessions 201 및 QR 표시를 각각 확인한다. 연결 확인 성공만으로 인증
   성공이라고 판단하지 않는다. 상태코드/TTL만 안전하게 기록하고 응답 body나
   Authorization을 dump하지 않는다. QR/토큰 포함 캡처·로그는 Git/PR/대화에 넣지 않는다.
   NOT_YET_VALID이면 요청 직전/직후 host/guest 시각으로 가설을 검증한다.
   HTTP_UNAUTHORIZED면 새 등록의 만료/폐기를 운영자가 확인한다.
7. QR 초대 만료까지 기다려 숨김/재스캔 거부 확인, 별도 세션 취소의 서버 확인,
   Activity 재시작 시 새 grant 전 기본 거부, 인증 만료 시 Create 비활성화를 확인한다.
   다음 거부 실험은 별도 승인된 DB 폐기 또는 Render 기본 거부 복원 후 실행한다.

## 스마트폰 E2E — P2 성공 이후만

모두 **NOT_RUN**. washer-fluid 선택→AVD QR 생성→실제 폰 카메라 광학 스캔→
HTTPS 모바일 점검→제출→차량 RESULT_SUBMITTED→차량에서 명시적 Accept→폰 ACCEPTED.
동일 sessionId/taskId, schemaVersion=1, SELF/MOBILE/COMPLETED/USER_REPORTED,
정확한 결과 Digest와 수신 ACK, 명시 수락 후 ACCEPTED receipt를 대조한다.
원본 JSON·토큰을 공유하지 않고 스키마/일치 여부만 기록한다.
중복 제출은 기존 결과와 일관적인지, 만료/취소 뒤 제출이 거부되는지 별도 세션에서 확인한다.
이후 tire.front-left 대표 경로(schemaVersion=2, damage/debris/wear)를 동일하게 검증한다.
이 두 경로의 성공을 다른 모든 부품의 성공으로 확대하지 않는다.

## 정리와 다음 우선순위

1. 안정된 AVD와 개별 승인 확보 후 신규 grant의 고정 코드·시각·버튼 상태를 수집하여
   최초 장애를 특정한다. 지금은 Draft PR이며 병합 전 CI 및 코드 리뷰가 필요하다.
2. 실제 서버 grant로 QR 생성/만료/취소/기본 거부를 검증한다.
3. washer-fluid 광학 스캔 E2E, 그다음 타이어 대표 E2E를 수행한다.
4. 종료 시 각각 승인받아 DB 등록 revoke, Render 환경변수 제거/재배포 및 deny health
   확인, 정확한 private 파일과 운영자 외부 secret 파일만 삭제한다. 삭제 명령에
   wildcard를 사용하지 않는다. 기존 활성 세션 취소는 별도로 확인한다.
5. 모바일 결과를 3D 점검 기록에 반영하는 기능은 후속 과제다.
