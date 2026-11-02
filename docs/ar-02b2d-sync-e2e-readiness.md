# AR-02B-2D — Mobile-to-Vehicle Sync E2E readiness

2026-11-02 KST. 시작 worktree `C:/dev/CarScope-ar02b2d`, branch `feat/ar-02b2d-e2e-readiness`, HEAD/origin/main `7a4c77a60485146cf5baef248390fec46b53d608`. `git fetch origin` 후 일치, 시작 변경 없음. GitHub에서 PR #26/#31/#33/#35/#37/#38 병합 확인. #39는 별도 타이어 기능으로 연결하지 않는다.

**현재 일반 Debug APK와 기존 서버 CLI만으로 실제 세션 생성은 불가능하다.** 준비 가능한 로컬 검증은 구현했지만 두 기기 인증/TLS/서비스와 실행 시간은 별도 진입 조건이다. 이 문서는 과거 [2A 네트워크 경계](ar-02b2-network-boundary.md)의 당시 미구현 목록 대신 현재 #37/#38 코드 상태를 기준으로 한다. 기존 계약과 기본 거부 정책은 유지한다.

## 현재 아키텍처와 차단 조건

| 구간 | 구현/차단 | 필요한 후속 작업 |
| --- | --- | --- |
| Native 진입 | Debug Inspection → SyncReceiverActivity 구현됨 | Codex A 사용 종료 후 지정 기기에서 실행 |
| endpoint | private `files/sync-endpoint.json`: 정확히 apiOrigin/mobileRoot, HTTPS root, 2048 bytes 이하 | 승인된 실제 주소 설정. 파일은 인증 또는 CA 신뢰를 제공하지 않음 |
| 앱 생성 인증 | Activity.credentialProvider → DenyByDefaultCredentialProvider, 네트워크 전 UNAUTHORIZED, 생성 버튼 비활성 | 별도 검토한 앱/기기 credential 공급자. Intent/endpoint/테스트 토큰 주입으로 해제 금지 |
| 서버 생성 인증 | ProductionSessionCreationAuthorizer.authorize는 항상 false, CLI 기본 경로 403 | 실제 verifier와 등록/발급/폐기 운영. 현재 provisioning 경로 없음 |
| testDebug 인증 | ExplicitDebugTestCredentialProvider는 정확한 fixture origin + loopback만. 일반 APK/AAB 미포함 | 실기기 공급자로 재사용하거나 범위 확대하지 않음 |
| HTTPS API | HttpsURLConnection, 기본 CA/hostname, redirect 차단, strict decoder/Digest 구현 | 각 기기의 DNS/경로/체인/SAN/유효기간 검증 |
| QR | v2 fragment는 invite만. receiver/creation/submit credential 미포함 | 실제 화면 광학 스캔 별도 관측 |
| 모바일 | v2 AR-01 통합은 `serve:mobile-dev`의 loopback HTTP에만 존재. 정적 staging은 v1/직접 진입만 | 검토된 HTTPS 모바일 서비스에 v2 모듈과 same-origin `/v1/*` 제공. 현재 실행 가능한 배포 구성 없음 |
| 서버 Claim/Submit/View/Accept | 일회 Claim, COMPLETED만, Receipt/Digest, 명시적 Accept, 취소/만료, SQLite 재시작 구현 | 실제 인증 서비스와 신뢰 경계 안에서 검증 |

Native API origin과 mobileRoot는 서로 다를 수 있지만 폰의 SyncClient는 `location.origin`만 사용한다. 따라서 mobileRoot에도 같은 세션 저장소를 사용하는 `/v1/*`가 있어야 한다. 다른 서버의 정상 401만으로 동일 저장소를 증명할 수 없다. 실제 생성 세션의 Digest/상태 일치를 확인해야 한다. wildcard CORS/CSP 변경은 이번 해결책이 아니다.

`127.0.0.1`은 PC/폰/Android 각각 자신이다. AVD `10.0.2.2`는 호스트 경로이지 인증서 hostname 해결책이 아니다. LAN IP를 쓸 경우 그 IP SAN과 각 기기의 신뢰 체인이 필요하다. adb reverse, VPN, 터널도 인증과 hostname 검증을 대신하지 않는다. Fake/LocalTest authorizer는 non-loopback bind 거부뿐 아니라 **터널·reverse proxy·포트 전달로 외부에 노출해서도 안 된다**. loopback peer로 보이게 하면 테스트 인증의 의미가 무너지므로 금지한다.

## 이번 구현

- `bin/host-readiness.mjs`: 인증 없는 GET만 보내는 host preflight. HTTPS root 인자만, redirect 미추적, CA/hostname 기본 검사, 5초 요청 deadline/256KiB 응답 상한. API와 mobile same-origin API의 dummy UUID 401 계약 및 v2 entry/CSP 표면 확인. 주소/응답 원문/토큰을 보고서에 넣지 않는다.
- `npm run test:https-e2e`: 임시 테스트 CA, loopback TLS 서버, 무작위 메모리 생성 credential, 실제 SyncClient/MobileSync로 QR v2 → Claim → COMPLETED → 명시적 Submit → 응답 유실/동일 envelope 재시도/duplicate Receipt → View → 잘못된 Digest 거부 → 명시적 Accept/동일 Accept 재실행 → ACCEPTED → Cancel/Expire를 실행한다. 테스트 PKI는 OS temp에만 생성하며 trust store를 변경하지 않는다.
- 모바일 결함 수정: status의 바깥 `ACCEPTED`와 Receipt의 `RESULT_SUBMITTED`가 불일치해도 수락으로 표시하던 누락을 거부한다. 반대 불일치도 거부. 기존 AR-01 레코드/페이지는 수정하지 않는다.
- SyncClient bearer 요청은 `redirect: 'error'`. 브라우저가 인증 요청을 다른 경로로 이동시키지 않는다. 실패는 성공으로 바꾸지 않고 기존 bounded retry를 유지한다.
- 기존 Kotlin 실제 Node HTTPS 테스트에 동일 제출의 Receipt 유지 및 모바일 최종 ACCEPTED/Receipt/Digest 확인을 추가했다. testDebug 공급자/일반 앱 transport/production authorizer는 변경하지 않았다.

Host PASS는 endpoint의 표면 검사다. 모든 모듈 실행, 동일 저장소, 차량 인증, Android/폰 신뢰, QR 광학 스캔을 증명하지 않는다. 명시한 `--ca-file`은 해당 Node 요청에서만 신뢰할 CA이며 Android/폰에 자동 설치하지 않는다. 공개 서비스는 각 기기가 이미 신뢰하는 정상 체인을 우선한다. 사설 CA 설치/Android debug trust 설정은 별도 보안 검토와 기기 소유자 승인 없이는 진행하지 않는다. 현재 앱의 release 정책은 변경하지 않는다.

## 재현 가능한 로컬 검증

Node 22.16.0, OpenSSL, 기존 Edge/AR-01 Playwright 의존성을 사용한다. B 전용 새 증거 폴더를 사용하며 기존 CarScope 프로세스는 종료하지 않는다. 아래 경로는 실행 예시이며 매 실행 새 하위 경로를 정한다.

```powershell
Set-Location C:/dev/CarScope-ar02b2d
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
git fetch origin
git rev-parse origin/main
git worktree list
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
Set-Location tools/inspection-sync-poc
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b2d/2026-11-02/node'
npm run verify:local
npm run test:https-e2e
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b2d/2026-11-02/sync-browser'
npm run test:browser
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b2d/2026-11-02/mobile-browser'
npm run test:mobile-browser
Set-Location ../mobile-ar-poc
$env:POC_EVIDENCE_DIR='C:/CarScope-External/qr-ar-01/ar-02b2d-2026-11-02'
npm run test:browser
```

`verify:local`은 check/legacy/full/SQLite/AR-01을 개별 기록한다. 전체 Node suite는 HTTPS E2E/preflight도 자동 실행한다. 기존 durable suite의 독립 프로세스/재시작 검사와 test:sqlite를 유지한다. 로컬 fixture를 두 기기용 서버로 외부에 노출하지 않는다.

승인된 실제 endpoint가 있을 때만 root에서 host 사전 점검을 실행한다.

```powershell
node tools/inspection-sync-poc/bin/host-readiness.mjs --api-origin https://api.example.test/ --mobile-root https://mobile.example.test/
# 검토한 host 테스트 CA가 있을 때만 --ca-file <외부CA.pem>
# stdout을 외부 <run>/host-readiness.json에 저장. exit 1/host FAIL이면 기기 실행을 중단한다.
```

보고서의 생성 인증은 항상 BLOCKED, Android/phone/optical은 NOT_RUN이다. 이 도구는 credential을 전송하거나 세션을 생성하지 않는다. `.test`는 예시 주소이며 배포된 서비스가 아니다.

## 실기기 실행 gate와 절차

먼저 **Codex A의 대상 사용 종료, 대상 serial, 실행 시간**을 확인한다. 이번 단계에서는 install/기기 실행/재시작/reverse/CA 설정을 하지 않았다. 아래 기기 명령은 조건을 충족한 후의 별도 검증용이다.

| 단계 | 실행 명령/조작 | 성공 조건 | 실패 시 외부 증거 |
| --- | --- | --- | --- |
| 1 인증/접근 | 서비스 담당자가 verifier와 app provider provisioning. `npm run test:https-e2e`는 별도 로컬 gate | issuer/audience/create scope/만료/폐기/등록 identity 검증. 잘못된·만료·폐기 credential 거부. 소유권 미검증을 차량 인증으로 부르지 않음 | `<run>/auth-policy.md`: 담당/버전/scope/유효기간/거부 code만. token/header 금지 |
| 2 도달성 | 위 host-readiness와 아래 device-readiness 명령. Android와 폰 각각 DNS/firewall/routing 확인 | host API 및 mobile API/표면 PASS, 정확한 대상 inventory. 각 기기 도달성은 따로 확인 | `host-readiness.json`, `device-readiness.json`, 비밀 없는 경로 메모 |
| 3 TLS | 아래 OpenSSL 명령, Android Native 서비스 연결 확인, 폰에서 mobile HTTPS 열기 | 각 클라이언트 chain/기간/SAN/hostname 검증, 경고·redirect·인증 중간 페이지 없음. IP URL은 IP SAN 별도 검증 | `<run>/tls-host.txt`, `tls-android.md`, `tls-phone.md`. 공개 인증서 메타데이터만. 경고 무시/trust-all 금지 |
| 4 생성 권한 | 별도 구현·검토한 provider/verifier 일치 확인. 현재 일반 APK의 disabled 표시는 정상 | 단기 credential이 QR/endpoint/Intent/log에 들어가지 않고 생성 201. 401/403이면 중단, Fake fallback 금지 | `<run>/creation.md`: status/기간/UI만. 응답 body/token 저장 금지 |
| 5 Debug 초기화 | CI 상당 검증 후 승인된 APK hash/variant 확인. private endpoint 설정 후 Native 워셔액 수신 버튼으로 진입 | endpoint 2 fields, release receiver/provider 없음, cleartext=false. Native 연결 확인과 생성 인증 구분 | `<run>/artifact-boundary.txt`, `receiver-init.md`. QR가 표시된 화면/전체 로그 수집 금지 |
| 6 모바일 QR | 실제 폰 카메라로 화면 QR 광학 스캔. fragment 제거 확인 후 사용자가 연결·점검·제출 | v2 washer-fluid, 유효한 미사용 QR, 완료만으로 자동 전송하지 않음. 명시 제출 1회 | `<run>/phone-steps.md`: 기종/OS/browser/시각/조작. QR URL/invite 기록 금지 |
| 7 상태 일치 | 폰 Submit → Native View → 사용자가 결과 확인 후 Accept → 폰 refresh | COMPLETED/USER_REPORTED, 같은 inspectionId/Digest/Receipt. RESULT_SUBMITTED와 ACCEPTED 구분, 센서 진단 아님 | `<run>/state-match.json`: 비밀 없는 id/digest/state/timestamp 선별 표. credential 금지 |
| 8 만료/정리 | 새 세션으로 Cancel/session expiry를 따로 검증. 서버 sweep/retention 확인 | 결과 삭제, 이전 QR/credential 제출 불가. accepted result 10분, terminal tombstone 60분 후 정리. invite 10분/session 30분 구분 | `<run>/cleanup.md`: 상태/삭제 건수만. DB/WAL은 Git 밖에서 보관 정책에 따라 폐기 |

```powershell
# 아래 명령은 Codex A 사용 종료 및 지정 대상 사용 허가 후에만 실행한다.
python tools/inspection-sync-poc/android/device-readiness.py --sdk C:/Android/Sdk --serial <확인한emulator-serial> --report <외부run>/device-readiness.json
openssl s_client -connect <host>:443 -servername <DNS-host> -verify_hostname <DNS-host> -verify_return_error -showcerts
# 외부 endpoint.json: 정확히 apiOrigin/mobileRoot 두 HTTPS root 문자열. 인증 값 없음.
Get-Content -Raw <외부endpoint.json> | adb -s <확인한serial> shell run-as io.carscope.app sh -c 'cat > files/sync-endpoint.json'
# private 파일 쓰기는 인증을 제공하지 않는다. Native 화면으로 설정을 검증하고 자동 실행하지 않는다.
```

실패 시나리오도 별도 세션에서 기록한다. Claim 응답 유실은 재발급하지 않고 차량의 명시적 Cancel→새 QR로 복구한다. Submit ACK 유실은 동일 envelope의 유한 retry와 동일 Receipt를 확인한다. Accept 응답 유실은 View로 확정 상태를 다시 조회하며 성공을 추측하지 않는다. Create 응답 유실/Activity 종료 후 receiver credential 복원은 없으므로 orphan은 TTL/sweep에 의존한다. 생성을 자동 재시도하지 않는다. 페이지 종료/BFCache/재진입은 credential이나 SENT를 복구하지 않는다. 만료 QR은 신규 Claim 불가이며, 이미 Claim한 세션은 invite 만료만으로 session EXPIRED가 되지 않는다.

인증 공급자 후속 설계는 최소한 발급 주체/등록 identity/차량 소유권 의미, 짧은 수명과 create scope, 회전·폐기, 앱 메모리 수명, server verifier, 접근 제어/방화벽, 로그 비노출, 부정 테스트를 구체화해야 한다. 기존 testDebug provider를 일반 APK로 옮기는 것은 이 설계의 대체물이 아니다. 공개 인프라·도메인·CA 설치·유료 자원은 별도 승인 범위이며 이번에 생성하지 않았다.

## 검증 결과와 격리

실행 결과·환경·실패 이력·CI는 [증거 인덱스](evidence/ar-02b2d/README.md)를 참조한다. Node/브라우저는 fresh local, JVM/Robolectric/APK는 기존 GitHub CI로 별도 판정한다. 로컬의 무거운 Gradle은 실행하지 않는다. 기존 CI 명령은 다음과 같다.

```powershell
./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 -Pkotlin.compiler.execution.strategy=in-process
python tools/inspection-sync-poc/android/check-boundary.py
```

Codex A의 worktree/AVD/SystemUI/Vehicle Service/APK/기존 실행 프로세스에 조작 없음. 공통 파일 수정 없음. InspectionActivity, DebugWebScreen, Tire, Geometry, vehicle-core, tools/three-poc, Release 인증·네트워크 정책에 차이 없음. 인증된 서비스 배포/실기기 광학 E2E는 **BLOCKED**이며 실기기 성공이나 Release 준비 완료로 판정하지 않는다.
