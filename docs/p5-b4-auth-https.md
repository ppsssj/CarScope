# P5-B4 — 인증·HTTPS 연결 기반

실제 서비스 연결은 **BLOCKED**다. 이번 변경은 기존 opaque credential·등록 관계·폐기 계약을 고정 HTTPS authority에 연결하고, Android의 비동기 provisioning/refresh를 준비한다. 실제 issuer·등록/소유권 증명·운영 credential·승인된 서비스가 제공된 것은 아니다. 실제 폰/Android E2E는 **NOT_RUN**이며 합성 TLS/SQLite/JVM 결과와 구분한다.

기준 main은 fetch한 `fdffd96`(PR #59 포함)이다. 별도 `CarScope-p5-b4-auth-https`, `feat/p5-b4-auth-https`에서 작업한다. Draft PR #58은 OPEN/draft, HEAD `0ff0934`임을 확인했으며 해당 worktree/브랜치/파일을 수정하거나 미병합 구현을 가져오지 않았다. Codex A의 3D UI·모바일 결과·Geometry·SDK·STALE·Release 코드는 변경하지 않는다. **이번 작업에서는 AVD/adb 명령, 실행·재부팅·종료·설치를 하지 않는다. 외부 서비스 변경·배포도 없다.**

## 설계 결정

목표는 [기존 인증 계약](ar-02b2e-auth-service-integration.md)의 인터페이스만 존재하던 부분을 실행 가능한 I/O 및 lifecycle로 연결하는 것이다.

| 선택 | 검토 | 결정 |
|---|---|---|
| 임의 JWT 발급/로컬 사용자·차량 등록 서버 | 실제 issuer·신뢰 키·등록 근거·폐기 운영이 없다. 현재 opaque token 문법과 다르다 | 구현하지 않음 |
| test credential을 APK/CLI에 넣어 연결 | 기본 거부·역할 격리·운영 trust를 위반한다 | 금지 유지 |
| 고정 authority의 정규화된 HTTPS 응답을 기존 verifier/registry/revocation에 연결 | 운영자가 검토한 authority와 credential provider를 코드에서 선택한다. 누락/장애/만료/폐기는 거부 가능 | 선택 |

authority는 원래 issuer/registry를 검증하는 신뢰 relay일 수도 있다. 아래는 **CarScope 전용 정규화 계약**이며 일반 OAuth/JWT provider와 바로 호환된다고 주장하지 않는다. 실제 provider가 다른 형식/인증 방식을 사용하면 별도 검토한 서버 측 adapter가 필요하다. issuer 선택·서명/introspection·등록 증명의 의미를 HTTP 200 또는 JSON decode로 대신하지 않는다.

`HttpsCreationAuthority`는 고정 HTTPS root에만 POST한다. caller token의 URL/issuer/kid를 사용해 주소를 선택하지 않는다. CLI는 계속 생성 기본 거부이며, `startAuthorizedHttpsMobileService`를 명시적으로 선택한 검토된 bootstrap만 새 연결을 사용한다. 인증 dependency가 `testOnly`면 marker가 기존 authorizer에 전파되어 non-loopback bind가 거절된다. public endpoint/모바일 요청으로 bootstrap을 바꾸는 경로는 없다.

## 서버 authority 연결 계약

호출은 별도 서비스 관리 credential(`credentials.credential({signal})`)로 인증한다. 이 credential은 생성 요청의 사용자 token·QR invite·receiver/submit token과 다르다. provider는 검토한 secret manager/메모리 snapshot에서 가져와야 하며 누락/만료/회전/장애 시 null을 반환한다. 실제 source·관리 credential은 제공하지 않는다. 일반 CLI의 환경변수로 로드하지 않는다.

| 고정 경로 | 요청 JSON | 200 응답 |
|---|---|---|
| `POST /creation/verify` | `{token}` | 기존 assertion 10개 필드 또는 null |
| `POST /creation/registration` | `{issuer,subject,registrationId}` | 기존 binding 9개 필드 또는 null |
| `POST /creation/active` | `{issuer,credentialId,registrationId}` | 정확히 `{active:boolean}`. true만 허용 |

assertion은 정확히 `active,issuer,audience,subject,scope,issuedAt,notBefore,expiresAt,credentialId,registrationId`, binding은 `issuer,subject,registrationId,userId,vehicleId,deviceId,active,ownershipVerified,expiresAt`다. scope는 기존 한 항목 배열, 시간은 safe integer epoch milliseconds다. 기존 `VerifiedSessionCreationAuthorizer`가 정책 issuer/audience·등록 결합·active/ownership·5분 이하 TTL·현재 시각을 최종 검사한다. HTTP adapter만으로 허용하지 않는다.

기본 전체 authorization deadline 1500ms와 하위 HTTPS 호출 deadline 1200ms를 유지한다. AbortSignal, 응답 16KiB 상한, fatal UTF-8·중복 키/깊이·정확한 JSON/content type, HTTP 200만을 적용한다. redirect·인코딩된 응답·네트워크/TLS 오류는 null/false다. 승인 결과를 캐시하지 않으며 매 생성 요청에서 기존 본문 전/후 검증을 수행한다. 재연결 후에도 현재 authority 상태를 다시 검사한다. 기존 rate limit·세션/초대 TTL·SQLite 행에는 변경이 없다.

세 조회는 서로 다른 HTTP 호출이며 분산된 등록/폐기의 원자적 transaction을 보장하지 않는다. 실제 authority의 일관성·폐기 반영 지연·응답시간/요청량 운영 계약도 검토해야 한다.

TLS는 기본 CA/hostname 검증, `rejectUnauthorized:true`, TLS 1.2 이상을 사용한다. `NODE_TLS_REJECT_UNAUTHORIZED=0`은 거절한다. `ca`는 검토된 private CA가 있을 때의 요청별 명시 설정이며 global trust를 바꾸지 않는다. 테스트는 소유 임시 CA만 사용한다. Node의 HTTPS 요청 옵션과 Android 기본 hostname 검증에 대한 기준은 [Node 22 HTTPS 문서](https://nodejs.org/docs/latest-v22.x/api/https.html#httpsrequesturl-options-callback), [Android HttpsURLConnection](https://developer.android.com/reference/javax/net/ssl/HttpsURLConnection)이다.

검토된 운영 bootstrap의 연결 형태(이번에 실행/배포하지 않음):

```javascript
// 아래 값/credentials는 운영자가 검토한 구성·secret provider이며 저장소에 포함하지 않는다.
await startAuthorizedHttpsMobileService({
  authority: { origin: approvedAuthorityOrigin, issuer: approvedIssuer, audience: approvedAudience,
    credentials: reviewedServiceCredentialSource },
  host: approvedBindAddress, publicOrigin: approvedSameOrigin,
  tlsCert: externalFullChainFile, tlsKey: externalPrivateKeyFile, databasePath: externalPrivateSqliteFile,
});
```

TLS chain/SAN/기간·DNS·접근 정책·로그 redaction·DB 백업/retention 운영은 별도 조건이다. issuer·등록·폐기 서비스에 쓰기/등록/발급 API를 만들거나 기존 운영 데이터/권한을 변경하지 않았다. 등록 관계 조회는 이미 검증된 관계를 확인하는 것이며 새 소유권을 만들어 내지 않는다.

## Android provisioning·refresh

`HttpsProvisioningExchange`가 고정 authority의 `POST /creation/provision`을 worker에서 호출한다. 신뢰한 로그인/enrollment 모듈이 제공하는 별도 `EnrollmentCredentialSource.snapshot()`을 Authorization에 사용한다. 이 getter는 로컬 메모리 snapshot이며 네트워크/로그인/Keystore I/O를 UI thread에서 수행하지 않는다. 해당 proof의 발급·refresh·저장은 실제 로그인 제공자의 책임으로 **BLOCKED**다. 사용자/차량/기기 ID를 request에 보내 등록으로 승격하지 않는다.

요청은 정확히 `{apiOrigin,audience}`다. authority는 proof를 인증하고 허용된 서비스/등록 관계를 확인한 뒤에만 다음 11개 필드를 반환해야 한다.

```text
apiOrigin, credential, issuer, audience, credentialId,
scope, issuedAt, notBefore, expiresAt, active, identity
identity = {registrationId,subject,userId,vehicleId,deviceId,active,ownershipVerified,expiresAt}
scope = "inspection:session:create"  (이 endpoint의 scalar projection; 서버 assertion 배열과 구분)
```

응답의 정확한 API origin·issuer/audience·scope·opaque credential 문법·identity·boolean·숫자·TTL을 strict streaming Decoder와 기존 provider의 공통 정책으로 검사한다. 중복/추가/누락 필드·null·coercion은 거절한다. HttpsURLConnection의 기본 trust/hostname, redirect 차단, 총 deadline·크기 상한·취소를 적용한다. 예외/응답 원문/credential은 로그에 남기지 않고 실패는 null이다.

`RefreshingProvisionedCredentialSource`는 명시 refresh 시작 시 이전 lease를 먼저 제거한다. 실패 시 옛 성공값으로 fallback하지 않는다. snapshot은 I/O 없이 만료를 재검사한다. refresh 간 generation, invalidate/logout/revoke, close 뒤 지연 응답은 cache를 복원하지 못한다. startup/명시 서비스 재확인에서 refresh하고 expiry는 버튼을 비활성화한다. 로그인/등록 폐기 event를 받은 실제 integration은 `invalidate()`를 호출해야 한다. 자동 로그인·background token 발급·Create 재시도는 하지 않는다.

일반 `SyncReceiverActivity.newProvisioningSource(...)`는 null이다. 검토한 코드 integration만 이 hook에서 source를 구성할 수 있다. authority/issuer/enrollment source는 신뢰한 코드 구성으로 선택하고 endpoint 파일/Intent/QR/global setter에서 받지 않는다. provider는 source가 없으면 기존 DenyByDefault로 남는다. trusted hook을 연결하면 onStart refresh → 성공 시 명시 생성 가능, 서비스 재확인으로 명시 refresh, onStop/transport.close → provider/source/exchange/enrollment close가 이어진다. UI tick은 expiry 표시/버튼만 재평가하고 네트워크를 호출하지 않는다. Activity 재생성은 새 메모리·새 source로 시작한다.

폐기는 **향후 세션 생성**을 차단한다. 이미 발급된 receiver/invite/submit 권한을 자동 취소하는 기능은 추가하지 않았다. 기존 세션은 명시 Cancel/TTL 정책을 따른다. 서버는 Native의 cached grant가 아직 유효해 보여도 폐기된 credential의 생성 요청을 거부한다. principal→session 강제 폐기·refresh token·Keystore 등록/복원·실제 사용자 로그인 및 차량 소유권 검증은 별도 운영/설계 조건이다. JVM String의 물리적 zeroization은 보장하지 않는다.

## 합성 검증과 재현

Node 22.16+, JDK 17, Android API 34/Build Tools 35.0.0, OpenSSL과 기존 PC 캐시를 사용한다.

```powershell
node --test tools/inspection-sync-poc/test/https-authority.test.mjs
./gradlew.bat :app:testDebugUnitTest --tests 'io.carscope.app.sync.ProvisioningLifecycleTest' --tests 'io.carscope.app.sync.ProvisioningActivityTest' --tests 'io.carscope.app.sync.HttpsProvisioningIntegrationTest' --tests 'io.carscope.app.sync.ProvisionedSessionCredentialProviderTest' --tests 'io.carscope.app.sync.SyncReceiverActivityTest' --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'
npm test --prefix tools/inspection-sync-poc
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'
python -B tools/inspection-sync-poc/android/check-boundary.py
./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

새 authority fixture는 test 디렉터리의 loopback 합성 서버이며 실제 발급자가 아니다. 테스트 credential/PKI/SQLite는 APK나 공개 페이지에 포함되지 않고 소유 temp에만 생성된다.

JVM 통합은 private stdio로 Node fixture를 호출한다. 난수 enrollment proof는 child 환경으로만 전달 후 Node에서 제거한다. 실제 Node authority → service 관리 credential → verifier/registry/revocation → HTTPS/SQLite 서비스와 Native provisioning→refresh→생성을 연결한다. 만료/폐기/장애/회전/재연결/미신뢰 CA/redirect/timeout을 검사하고, Robolectric는 생성 버튼·expiry·stop/recreate·late callback을 검사한다. 테스트 authority·proof·identity는 합성이며 실제 발급·차량 인증 증거가 아니다.

PKI/DB는 기존 소유 OS temp helper로 생성·정리한다. JVM 정상 teardown은 제거 여부도 검사한다. 강제 process 종료는 cleanup을 보장하지 않으므로 임시 자료가 남으면 소유권·정규 경로·프로세스 종료를 확인한 뒤만 정리한다. 전역 temp 삭제를 하지 않는다. 테스트 credential·fixture source·test classes의 APK/AAB 제외와 provisioning 제품 클래스의 Debug 전용 포함을 기존 CI boundary checker에서 검사한다. 필터/기존 임계값을 완화하지 않는다.

## 실제 연결까지 남은 조건

| 항목 | 상태 | 필요한 근거 |
|---|---|---|
| 실제 issuer/authority protocol | BLOCKED | 승인된 issuer·audience·고정 authority와 실제 서명/introspection 검증·정규화 adapter |
| 등록/폐기 서비스 | BLOCKED | 사용자/차량/앱 등록 및 소유·이용 권한 근거, active/ownershipVerified 의미, grant/등록/키 폐기 정책·운영 lookup |
| 서비스 관리 credential | BLOCKED | secret provider·최소 권한·수명·회전·장애 정책. 관리 credential을 caller token과 분리 |
| Android enrollment | BLOCKED | 실제 로그인/등록 proof source·발급/refresh·안전한 저장·logout/revoke signal. trusted hook 연결 코드 리뷰 |
| 실제 HTTPS 서비스 | BLOCKED | 승인된 주소·full chain/hostname SAN·DNS·접근제어·운영 DB·검토된 bootstrap. 이번 배포 없음 |
| 실제 폰/기존 AVD | NOT_RUN | 위 조건 충족 후 별도 작업. 이번 AVD/adb 호출 없음 |

## 기존 emulator-5554 후속 검증 제안 — 이번 PR에서는 실행하지 않음

사용자가 직접 실행해 둔 기기에만 연결한다. 시작·재부팅·종료·최적화·설치 명령은 포함하지 않는다. 현재 APK의 인증/TLS 조건을 해제하지 않으며 실제 발급자·승인된 HTTPS·검토된 provisioning이 먼저 준비돼야 한다. #58의 과거 Health 실패를 현재 기기 관측으로 전용하지 않는다.

기존 Health Gate 코드·단일 numeric PID·load/시간 기준은 **그대로 유지**한다. 제안은 다음 세 판정을 분리해 기록하는 것이며 현재 BLOCKED를 우회하는 옵션이 아니다. 별도 작업에서 정책·도구 변경을 검토하기 전에는 기존 gate가 BLOCKED면 앱 실행을 중단한다.

1. 대상/준비 진단: exact serial/AVD·boot/API·current user·WebView·Service 존재를 확인한다.
2. 부하·SystemUI 진단: load와 vCPU 수, PID 집합의 시간별 변화, PID별 사용자/역할을 함께 기록한다. `pidof` 복수 PID만으로 crash나 안정성을 단정하지 않는다. current-user와 system-user의 SystemUI인지 확인하는 개선을 별도 검토한다. 진단값을 임의 제외하거나 threshold를 올리지 않는다.
3. 실제 앱 기능: 별도 PASS/FAIL/NOT_RUN으로 TLS probe·생성·QR task·모바일 전송·Native 결과/Digest·명시 Accept·재연결을 기록한다. 진단 수치만으로 기능 성공을 주장하지 않는다. 반대로 앱 조작 성공 한 번으로 시스템 안정성 전체를 보장하지 않는다.

별도 검증 시작 시의 read-only 명령 예시:

```powershell
# 사용자가 실행한 exact 기기만. 다른 serial로 자동 전환하지 않는다.
& "$env:ANDROID_HOME/platform-tools/adb.exe" devices -l
& "$env:ANDROID_HOME/platform-tools/adb.exe" -s emulator-5554 emu avd name
python -B tools/tire-probe/runtime/run.py --sdk C:/Android/Sdk --serial emulator-5554 --out C:/CarScope-External/p5-b4/future-run/health
python -B tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial emulator-5554 --report C:/CarScope-External/p5-b4/future-run/device-readiness.json
```

이미 설치된 검토된 Debug 앱, fresh Health PASS 및 인증/HTTPS 조건을 확인한 별도 작업에서만 `adb -s emulator-5554 shell am start -W -n io.carscope.app/.sync.SyncReceiverActivity`로 진입한다. 인증 없는 endpoint 파일은 두 HTTPS root만 담고 token/CA를 제공하지 않는다. Native 서비스 연결 확인과 폰의 TLS를 따로 검증한 뒤 `tire.front-left` 명시 생성→QR 광학 스캔→모바일 점검/명시 전송→Native RESULT_SUBMITTED 및 개별 응답/Digest→명시 Accept→모바일 ACCEPTED proof를 확인한다. 사진/QR/Authorization/body를 기록하지 않고 비밀 없는 상태·Digest·시간만 외부 증거에 남긴다.

**실제 시스템 응답이 불안정하면 즉시 중단한다.** ADB/service timeout·응답 중단, SystemUI 재시작/ANR·Activity/renderer 이상·예기치 않은 lifecycle 변화가 있으면 추가 조작·자동 재시도/재부팅을 하지 않고 시각과 비밀 없는 오류를 보존한다. 401/403·만료·폐기·TLS/hostname 실패는 성공으로 바꾸지 않는다. 기록은 기능 실패/환경 BLOCKED를 구분하고, 재개 조건을 별도 결정한다.

[실행 결과/CI 인덱스](evidence/p5-b4/README.md). 독립 PR만 생성하며 자동 병합하지 않는다.
