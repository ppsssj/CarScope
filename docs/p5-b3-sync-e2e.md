# P5-B3 — 스마트폰 → Node HTTPS → Native 동기화 검증

**실제 스마트폰/Android 전체 E2E는 BLOCKED다. 성공으로 판정하지 않는다.** 승인된 서비스 주소·실제 생성 credential provisioning 연결이 제공되지 않았고, 실행한 Pleos AVD는 Health Gate를 두 번 통과하지 못했다. 새 합성 통합 검사는 모바일 JS → Node TLS/SQLite → Native JVM을 한 호스트에서 연결한다. 이것은 실제 폰·AVD 실행의 대체 증거가 아니다.

시작점은 fetch한 `origin/main` `bcfb83e90f5369803aa73f7450629eaed08aca5c`다. PR #56 (`277608d`)·#57 (`bcfb83e`)의 merged 상태와 main ancestry를 확인했다. 독립 worktree `CarScope-p5-b3-sync-e2e`, 브랜치 `feat/p5-b3-sync-e2e`를 만들었다. B1/B2B/A 작업 사본·기존 프로세스는 보존했다. 이번에 시작한 AVD만 종료했다.

## 대표 시나리오와 현재 구조

대표 task는 **`tire.front-left`**다. 워셔액은 v1, 타이어·EV 충전구는 v2로 Native에 구현되어 있다. 타이어는 개별 응답 3개·중첩 canonical JSON·정확한 task 결합을 함께 확인할 수 있다. P5-A3 브레이크액 모바일 기능이나 Codex A의 3D UI를 이번 작업에 추가 연결하지 않는다.

| 구간 | 실제 코드와 불변 계약 | 이번 검증 |
|---|---|---|
| Native 생성 | `SyncReceiverActivity` → `SyncReceiverController` → `SyncReceiverClient` → `HttpsSyncReceiverTransport.create(taskId)`. 일반 Activity의 provider는 `DenyByDefaultCredentialProvider` | 일반 provider가 네트워크 전 UNAUTHORIZED를 반환함을 합성 JVM 검사. 실제 Android 생성은 BLOCKED |
| 서버 인증 | CLI는 `ProductionSessionCreationAuthorizer`의 false 유지. `VerifiedSessionCreationAuthorizer`는 검토한 verifier·등록 관계·폐기 provider가 있어야 승인 | 실제 issuer/verifier/registry/revocation 연결 및 앱 provisioning이 미충족. 합성 fixture만 loopback에서 명시 주입 |
| 같은 출처 HTTPS | `startHttpsMobileService`가 모바일 allow-list/API/SessionService/SQLite를 한 listener·store로 공유 | 합성 실제 TLS/SQLite에서 모바일 module GET·API를 같은 origin으로 검사. 승인된 실제 서비스는 미지정/미검증 |
| QR | 생성 task = response task = `#v=2&task=tire.front-left&invite=...` = Claim task = result task. receiver/creation credential은 QR에 없음 | Native client가 만든 payload의 메모리 QR encode/decode와 모바일 history 제거. **광학 스캔 아님** |
| 모바일 완료/전송 | shipped `tire-result.mjs`의 시작→개별 응답→완료, `MobileSync.setResult`만으로 전송하지 않음. `send()`가 명시 전송 | 합성 NOT_SENT → send → SENT. damage=NOT_FOUND / debris=FOUND / wear=UNABLE, USER_REPORTED |
| 서버 수신/Native 조회 | 정확한 schema·task·key set·시간·status 검증. `RESULT_SUBMITTED`, immutable SHA-256, `SyncHttpDecoder`와 client task/상태 결합 | 합성 201 제출 후 ACK 유실, 200 duplicate 및 동일 receipt, Native 반복 poll에도 결과 유지. JS canonical/Digest와 Kotlin 결과 일치 |
| 명시적 수락 | controller의 `accept()`만 Accept 요청. 표시한 Digest의 최종 ACCEPTED proof 필요 | 합성 수락 전 모바일 SENT 유지, 명시적 Native Accept 후 모바일 refresh → ACCEPTED 및 일치하는 receipt. 중복 클릭 차단 |

인증 기본 거부·TLS chain/hostname·redirect 차단·세션/초대 TTL·토큰 역할·credential 수명·Release 정책은 변경하지 않았다. Native 제품 코드 변경은 없다. 추가 파일은 testDebug 검사·독립 test subprocess·문서뿐이다.

## 실제 환경에서 관측한 차단 조건

1. **인증 연결 미구현/미설정**: 일반 Activity는 여전히 deny provider를 선택한다. 선택적 `ProvisionedSessionCreationCredentialProvider`의 기본 source는 null이며 실제 등록/로그인/refresh 연결을 자동 제공하지 않는다. 서버 CLI도 기본 생성 403이다. 유효해 보이는 endpoint JSON·Intent·기기 ID·임의 토큰으로 이 경계를 해제할 수 없다. 실제 신뢰 발급자, 등록 관계, 폐기 서비스와 검토된 앱 source/bootstrap을 연결해야 한다. [기존 인증 계약](ar-02b2e-auth-service-integration.md)을 따른다.
2. **실제 HTTPS 대상 미지정**: 이번 세션에 승인된 apiOrigin/mobileRoot와 운영 인증서/서비스가 주어지지 않았다. 관련 SYNC 환경 설정도 없었다. 따라서 실제 host/Android/phone HTTPS 도달성·체인·SAN·hostname은 NOT_RUN이다. 서비스가 어디에도 없다고 단정하지 않는다. `127.0.0.1`은 각각 자기 기기이며, `10.0.2.2`나 포트 전달은 hostname/CA 신뢰를 해결하지 않는다.
3. **AVD Health Gate BLOCKED**: 설치된 `CarScope_Pleos_API34`, WHPX 사용 가능을 확인하고 기존 기기가 없는 상태에서 한 번 시작했다. 정확한 `emulator-5554`에서 read-only gate를 실행했다. 첫 gate는 API 34·boot=1·WebView `131.0.6752.0`·Vehicle Service `2.3.22` enabled를 관측했으나, SystemUI `pidof`가 `1086 1672`로 복수 PID여서 기존 gate의 단일 numeric PID 조건을 충족하지 않았다. 2 vCPU에서 1분 load는 8.2~10.27이었다. 복수 PID만으로 crash를 단정하지 않는다. 안정화 후 두 번째 gate는 1분 load 36.85~40.63, `dumpsys webviewupdate`가 5초 timeout으로 BLOCKED였다. 기준/timeout을 완화하거나 OS/Service/SystemUI를 재시작하지 않았다.
4. **기기 실행 중단**: Health PASS가 없으므로 APK 설치·Activity 실행·기기 endpoint 쓰기·CA 설치·reverse/forward·광학 QR·Native 수신/Accept를 하지 않았다. 최초 gate 당시 새 worktree의 APK는 아직 빌드 전이었으며, 그 preflight의 APK 없음은 이후 별도 빌드 결과와 구분한다. 실제 폰 대상도 지정되지 않았다. 이번에 시작한 AVD만 identity 재확인 후 `emu kill`로 정리했다.

차단 원인과 합성 성공을 합쳐 실제 E2E PASS로 표시하지 않는다. 실제 E2E의 session creation/QR/inspection/send/receive/Accept 단계는 모두 **BLOCKED/NOT_RUN**이다.

## 합성 통합 검사 재현

JDK 17, Node 22.16 이상, OpenSSL, Android API 34/Build Tools 35.0.0을 사용한다. 기존 Gradle/SDK 개인 설정을 사용하고 Git에 복사하지 않는다.

```powershell
./gradlew.bat :app:testDebugUnitTest --tests 'io.carscope.app.sync.NativeTireHttpsE2eTest' --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'

# 전체 검사와 제품 artifact 경계
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'
python -B tools/inspection-sync-poc/android/check-boundary.py
./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
npm test --prefix tools/inspection-sync-poc
```

`NativeTireHttpsE2eTest`는 `tools/native-sync-e2e/tire-fixture.mjs`를 private stdio로 호출한다. 테스트 credential은 매번 난수로 JVM 메모리에 생성하고 child 환경으로만 전달하며 Node는 이를 환경에서 즉시 제거한다. QR/invite는 private pipe에만 전달하고 출력/보고서에 복사하지 않는다. Node는 무작위 loopback port의 실제 TLS listener, 임시 SQLite 및 기존 모바일 JS를 사용한다. PKI는 기존 `localPki`가 OS temp에 생성한다. Node 요청과 JVM의 요청별 trust manager만 해당 CA를 신뢰한다. 기본 hostname 검증과 TLS 검증을 유지하고 global trust·OS/Android CA store·APK를 바꾸지 않는다.

testOnly authorizer와 credential provider는 test subprocess/testDebug에만 있다. 이 fixture를 AVD·폰·LAN에 연결하거나 터널/프록시로 노출하지 않는다. CLI 인자로 token을 받거나 실제 서비스 배포에 사용하는 도구가 아니다. 정상/실패 시 EOF로 서버·SQLite를 닫고 소유 temp만 정리한다. 비정상 강제 종료 시 cleanup이 보장되지는 않으므로 잔여물은 소유권·정규 경로·프로세스 종료를 확인한 뒤만 정리한다. 성공 테스트는 PKI/DB 디렉터리가 제거됐는지도 확인한다.

## 실제 기기 E2E 재실행 순서

아래 명령은 **앞 단계가 충족됐을 때만** 실행한다. 실제 credential을 명령·문서·QR·endpoint·로그에 넣지 않는다. 승인된 서비스/소유 기기/동시 사용 여부와 실행 시간을 먼저 확정한다.

1. 검토된 issuer/verifier·등록/소유 관계·폐기 adapter를 실제 서비스 bootstrap에 연결하고, Android의 검토된 provisioning source를 연결한다. 일반 APK의 disabled 생성은 정상적인 거부이며 테스트 provider로 해제하지 않는다. 인증 코드를 변경한다면 별도 리뷰·부정 테스트·APK 경계 확인을 먼저 완료한다.
2. 승인된 같은 출처 모바일/API 주소를 준비한다. OS/Android/폰이 신뢰하는 full chain과 hostname/IP SAN·유효기간을 확보한다. 아래 host probe는 세션을 만들지 않으며, PASS도 폰/Android 신뢰나 동일 store의 최종 증거가 아니다.

```powershell
node tools/inspection-sync-poc/bin/host-readiness.mjs --api-origin https://approved-host/ --mobile-root https://approved-host/
# 원본 stdout은 Git 밖 새 run 디렉터리에 보관. 예시 hostname을 실제 승인된 주소로 치환.
```

3. 별도 승인된 AVD 실행 시간에 기존 기기를 재시작/탈취하지 않고 준비한다. 이번 실행에서 사용한 시작 형태는 다음과 같다. emulator 실행은 GUI 창을 만들지 않으며 명시 serial만 사용한다.

```powershell
# 기기가 이미 실행 중이면 새로 시작하지 않고 정확한 identity/소유권을 먼저 확인한다.
& "$env:ANDROID_HOME/emulator/emulator.exe" -avd CarScope_Pleos_API34 -port 5554 -no-window -no-snapshot -no-boot-anim -no-audio -memory 4096 -cores 2 -gpu auto
# 새 외부 폴더만 사용. --run/--install 없이 read-only Health Gate부터 실행.
python -B tools/tire-probe/runtime/run.py --sdk C:/Android/Sdk --serial emulator-5554 --out C:/CarScope-External/p5-b3/new-run/health
python -B tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial emulator-5554 --report C:/CarScope-External/p5-b3/new-run/device-readiness.json
```

Health exit 2/BLOCKED이면 설치/Activity/TLS 실행을 중단한다. `boot_completed=1`만으로 통과시키지 않는다. 이 gate는 단일 SystemUI PID를 요구하므로 복수 PID에 대한 원인/사용자 범위 검토도 별도 필요하다. timeout/CPU 기준을 올려 통과시키지 않는다.

4. fresh Health PASS와 검증된 Debug APK hash/서명, 대상의 기존 앱·데이터 보존 조건을 확인한 뒤에만 설치한다. 기존 프로세스/다른 작업을 중단하거나 서명 불일치 시 uninstall하지 않는다. 승인된 외부 endpoint 파일은 정확히 `apiOrigin/mobileRoot` 두 HTTPS root이며 credential/CA 설정이 아니다.

```powershell
Get-FileHash app/build/outputs/apk/debug/app-debug.apk -Algorithm SHA256
& "$env:ANDROID_HOME/platform-tools/adb.exe" -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
# 최초 파일 경로를 준비하고 실제 HTTPS 주소만 기록한 승인된 endpoint.json 사용.
Get-Content -Raw <external>/endpoint.json | & "$env:ANDROID_HOME/platform-tools/adb.exe" -s emulator-5554 shell "run-as io.carscope.app sh -c 'mkdir -p files && cat > files/sync-endpoint.json'"
& "$env:ANDROID_HOME/platform-tools/adb.exe" -s emulator-5554 shell am start -W -n io.carscope.app/.sync.SyncReceiverActivity
```

5. Native **서비스 연결 확인**으로 기기 TLS/401 계약을 검증한다. 폰에서도 같은 HTTPS 모바일 페이지를 경고 없이 열어 각 기기의 도달성·CA·hostname을 따로 확인한다. 생성 인증 실패·TLS 경고·redirect가 있으면 중단한다.
6. Native에서 **앞 왼쪽 타이어** 선택 → 명시 생성(HTTP 201) → 실제 폰으로 QR 광학 스캔 → 연결/주차 후 세 응답 → 완료. 완료만으로 전송되지 않음을 확인하고 **명시 전송**한다. 손상/이물질/마모 응답은 USER_REPORTED이며 실제 센서 진단이 아니다.
7. 모바일 SENT는 서버 영수증 확인까지만 의미한다. Native RESULT_SUBMITTED의 task·세 응답·inspectionId·Digest를 확인하고 사람이 **이 결과 수락**을 누른다. Native ACCEPTED와 모바일 refresh 후 ACCEPTED 영수증의 inspectionId/Digest 일치를 각각 확인한다. QR/토큰 포함 화면·body·header를 저장하지 않고 비밀 없는 상태/응답/Digest/시각만 외부 증거에 선별 기록한다.
8. 별도 세션으로 취소/만료/ACK 유실·중복/다른 결과 conflict/앱 stop 후 지연 응답을 검증한다. TTL을 줄이거나 상태를 직접 주입해 실제 결과처럼 만들지 않는다. 정리 때는 이번 실행의 앱/포트/서비스/임시 자료만 다루며 화면 종료와 서버 Cancel을 구분한다.

[새 실행과 CI 증거 인덱스](evidence/p5-b3/README.md). PR만 생성하고 병합하지 않는다.
