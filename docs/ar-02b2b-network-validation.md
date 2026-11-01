# AR-02B-2B network validation

실행일 2026-11-01 KST. Windows, Node 22.16.0, Temurin JDK 17.0.20, Android public API34/AGP 8.10.0. 기존 Worktree를 유지했고, Java 경로 문제를 피하기 위해 일시적인 ASCII `R:` alias만 사용했다. 별도 Worktree나 소스 복사본을 만들지 않았다.

## 검증 등급

| 등급 | 결과 | 실제 수행/제한 |
| --- | --- | --- |
| A Kotlin 계약 | PASS | 기존 Receiver 17 + Decoder 8. Node canonical golden digest, 엄격한 key/type/state/result 검사 |
| B HTTPS adapter | PASS (JVM) | 10 tests. 실제 SSLServerSocket fixture 및 실제 Node HTTPS API create→phone claim/submit→Kotlin view/accept, 별도 cancel |
| C Android UI | PASS (Robolectric) | 7 tests. Android view/button/lifecycle, main Handler, bitmap 역해독. AVD 렌더링/계측 테스트는 아님 |
| D AVD HTTPS | BLOCKED | adb device 없음. 부팅/SystemUI/네트워크/Android CA 신뢰/hostname 도달성 검증 불가 |
| E 스마트폰 QR 광학 스캔 | BLOCKED | 스마트폰·신뢰 HTTPS 모바일 주소 미준비. 메모리 bitmap 역해독만 수행 |
| F 스마트폰→서버→Android 수락 | BLOCKED | 각 기기의 신뢰 TLS·도달성·인증 공급자 미확보 |
| G 실제 차량 인증 | BLOCKED | 서버 Production authorizer와 Android credential provider 모두 기본 거부 유지 |

TLS fixture는 OS 임시 디렉터리에 OpenSSL로 CA/leaf/private key/PKCS12를 생성한다. 저장소에 인증서나 키를 넣지 않는다. JVM 연결 인스턴스에 해당 fixture CA만 신뢰하는 SSLContext를 제공하며 기본 hostname verifier를 유지한다. 이는 Android trust anchor 설정이나 Android Runtime handshake 검증이 아니다. 일반 transport는 플랫폼 기본 trust를 사용한다.

실제 handshake로 정상 chain, 미신뢰 CA, hostname mismatch, 2020년에 만료된 leaf를 구분했다. 301/302/303/307/308 및 HTTPS→HTTP 이동, timeout/cancel/close, 연결 끊김, 401/403/404/409/410/429/500, 잘못된 Content-Type/JSON/size/digest, credential 비노출 정규화를 검증했다. 테스트 provider는 testDebug에서 정확한 loopback origin에만 허용되며 일반 APK에는 없다. 실제 Node fixture도 loopback에만 bind하며 기존 Fake authorizer 제한을 우회하지 않는다.

Activity 테스트는 endpoint private 설정이 생성 권한을 제공하지 않는지, Intent credential 무시, 결과 전 수락 차단, 중복 수락/취소 차단, 취소 실패, onStop/destroy/recreate, 늦은 이전 callback, 초대 QR 만료와 세션 만료, FLAG_SECURE와 QR bitmap 저장 비활성화를 검증한다.

## 회귀 및 빌드

| 검사 | 결과 |
| --- | --- |
| App Debug JVM | PASS 110 tests, failure/error/skip 0 (PR #36 반영 후) |
| vehicle-core | PASS 38 tests 중 기존 1 skipped, 실패 0 |
| assembleDebug / assembleRelease / bundleRelease | PASS |
| lintDebug | PASS: 0 errors, 21 warnings (경고를 오류 0과 구분) |
| Receiver / Identity / Tire build-contract | PASS, 실제 merged manifest와 APK/AAB DEX 검사 |
| Kotlin Tire serializer→JS consumer | PASS, 합성 JVM 데이터 범위 |
| Sync legacy | PASS 48 |
| Sync 전체 | PASS 69 |
| SQLite | PASS 21 (동시성/다중 프로세스/재시작 포함) |
| AR-01 unit | PASS 기존 31 assertions, 기존 테스트 전용 fixed clock harness 유지 |
| AR-01 Edge browser | PASS 16 checks, 합성 카메라/로컬 서버 |
| AR-02A Edge browser | PASS 11 checks, Claim 유실 포함 |
| 통합 모바일 Edge E2E | PASS 17 checks, SQLite 재시작/Receipt/ACCEPTED/실패 경로 포함 |

브라우저는 Edge 156.0.4314.58 headless, loopback 단일 PC 합성 환경이다. 실제 QR 카메라 스캔/스마트폰 네트워크 성공과 구분한다. 기존 서버, AR-01, Tire/Identity/Geometry assertion을 삭제하거나 완화하지 않았다. Geometry/Tire 전체 CI 판정은 PR의 실제 job 결과로 확인한다.

재현 명령(저장소 root, 필요한 SDK/JDK/Node/OpenSSL과 기존 npm ci 준비):

```powershell
./gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --console=plain --max-workers=1 -Pkotlin.compiler.execution.strategy=in-process
python tools/inspection-sync-poc/android/check-boundary.py
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
node tools/three-poc/check-tire-native-contract.mjs app/build/test-results/tire-ui-v1.json
```

Sync 디렉터리에서 `npm run verify:local`, `npm run test:browser`, `npm run test:mobile-browser`; mobile-ar-poc에서 `npm run test:browser`. `verify:local`이 check/legacy/full/sqlite/ar01을 각각 기록한다. CI의 기존 독립 receiver boundary step이 새 suite 수와 실패/skip 0도 확인한다. AVD 실행을 CI 필수 조건으로 추가하지 않았다.

## 실패 및 보정 기록

개발 중 com.sun HTTP server 클래스가 Android unit compile classpath에 없어 fixture를 표준 SSLServerSocket으로 교체했다. UI 초대 만료 테스트는 Robolectric 가상 Handler 시계와 실제 wall clock 차이로 실패하여 테스트에서 주입 가능한 clock을 사용했다. Production clock은 System.currentTimeMillis다.

중간 전체 실행에서 HTTPS 6개가 NETWORK로 실패한 실행도 있었다. 당시 원인은 확정하지 못했다. 격리 재실행 및 이후 전체 실행은 통과했고, 인증서 chain 자체의 양성 handshake 검사와 실제 Node HTTPS 왕복을 유지했다. TLS/hostname 검증을 완화하지 않았다. 최종 main 반영 후 전체 App 110개는 실패 없이 완료했다. 향후 CI에서 재발하면 환경/fixture 초기화 원인을 조사하며 통과로 숨기지 않는다.

## Health gate 및 잔여 조건

`adb devices -l`은 empty, `emulator -list-avds`에는 CarScope_Pleos_API34가 있다. 호스트 free RAM은 점검 시 약 3GiB였다. 연결 기기가 없으므로 boot_completed/SystemUI/기기 네트워크/인증서 신뢰 gate는 BLOCKED다. 임의 부팅/재설치/reset/강제 재시작을 하지 않았다. Node HTTPS 성공을 Android HTTPS 성공으로 승격하지 않았다.

후속 검증은 건강한 연결 AVD, 검증된 Android trust store와 SAN hostname, 호스트 도달성, 제한된 테스트 인증 공급자, 신뢰 가능한 모바일 HTTPS origin이 필요하다. adb reverse/10.0.2.2를 사용하더라도 hostname/신뢰를 별도로 통과해야 한다. 외부 인프라/CA 설치/Production 변경은 수행하지 않았다.
