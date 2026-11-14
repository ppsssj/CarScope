# P22 AVD → Vision QR 인증(401) 진단과 E2E 자동화

Branch `fix/p22-avd-qr-auth-diagnostics`, based on `origin/main` `8916b9d`. 운영 DB, Render 설정, 등록 발급·폐기는 바꾸지 않았다. 유료 AI 호출은 없다.

## 1. 증상과 실제 확인한 근거 (2026-11-14, 읽기 전용)

| 확인 | 결과 | 방법 |
|---|---|---|
| AVD | `emulator-5554` device, boot 완료, Android user 10 | `adb devices`, `getprop`, `am get-current-user` |
| Debug APK | 설치, run-as 가능. **설치 APK의 dex에 Vision origin 문자열 존재** | `pm path`, APK pull 후 dex 검색(메모리) |
| endpoint | `apiOrigin`/`mobileRoot` = `https://carscope-vision-experiment.onrender.com` | private 파일(비밀 아님) |
| enrollment | `avd-vision-enrollment.json` mode 600, 190 bytes. 키·mode·UUID·proof 형식 정상. registration `5551d5e5-…`, 만료 11:50Z(미만료) | 파일을 Node 메모리로 파싱. proof는 출력하지 않음 |
| 운영자 state | `C:\CarScope-External\avd-vision\registration-emulator-5554.json`의 registration이 기기와 **같음**(18:50 KST 발급) | 비밀 없는 파일 |
| 시각 | 기기-호스트 1–2 s, 서버 Date와 0 s 차이 | `date`, HTTP `Date` |
| 서버 | `/healthz` 200 UP, `STATEFUL_AVD_SIMULATION`, `OPERATOR_APPROVED_AVD_ONLY`, vision·detection EXPERIMENT | GET만 |
| 앱 로그 | `PROVISION_HTTP_UNAUTHORIZED` 2회, **30초 간격**, 10:06Z(발급 16분 뒤) | `logcat -d` (지우지 않음) |

새 진단 도구의 실제 실행(읽기 전용, DB 미제공)도 같은 결론이다. AVD, APK, origin, 서버, enrollment, 시계는 모두 PASS다. 남은 항목은 DB와 실제 승인 테스트뿐이다.

## 2. 401이 나는 정확한 조건 (코드 추적)

`InspectionActivity`(3D 요청) → `SyncReceiverActivity.createWhenAuthorized` → `refreshAuthority` → `RefreshingAvdSimulatorCredentialSource.refresh` → `HttpsAvdSimulatorGrantExchange.fetch`: `POST {origin}/simulator/provision`, `Authorization: Bearer <enrollmentProof>`, body `{apiOrigin, audience}`.

서버 `serveAvdSimulatorProvision` → `AvdSimulatorCredentialStore.provision`:

| 서버 응답 | 조건 |
|---|---|
| 429 | 주소별 또는 proof 해시별(4회/분) 제한 |
| **401** | Bearer가 없거나 43자 형식이 아님 |
| 415, 413 | content-type, 크기 |
| 400 | body 키, `apiOrigin`≠서버 `publicOrigin`(=`RENDER_EXTERNAL_URL`), audience |
| **401** | `SELECT … FROM cs_avd_registrations WHERE enrollment_hash=sha256(proof)`에서 **행이 없거나**, `revoked_at`이 있거나, `expires_at`≤서버 시각 |
| 503 | DB 오류 등 예외 |

앱은 연결 조건(`endpointAllowed`: 컴파일된 Vision origin)과 형식을 만족해야 요청을 보낸다. 이번 요청은 실제로 나갔고 형식도 맞다. 따라서 401의 원인은 **서버가 읽는 DB/스키마에서 그 proof의 해시 행이 없거나, 취소됐거나, 만료된 것** 중 하나다. 만료는 발급 16분 뒤라 제외된다.

## 3. 원인 판단

| 근거 | 내용 |
|---|---|
| 발급 도구 기본값 | `setup-avd-simulator.ps1`은 `-Schema carscope`를 기본으로 쓰고, DB 입력 안내가 메인 서비스 역할(`carscope_app`)이었다. `-VisionOrigin`을 줘도 그대로였다 |
| Vision DB | 2026-11-09 기록에서 Vision 서비스 역할은 `carscope_vision_app`, `current_schema`는 **`carscope_vision`**이었다 |
| 이번 설정 | 요청서는 스키마를 `carscope`로 적었다 |
| 관리자 CLI | 연결한 역할의 `current_schema()`가 `CARSCOPE_DB_SCHEMA`와 같을 때만 발급한다. 그래서 `carscope`로 성공한 발급은 `carscope`가 기본 스키마인 역할, 즉 메인 DB에 쓰였을 가능성이 높다 |
| state 파일 | origin 구분이 없었다(`registration-<serial>.json`). 다른 origin의 `-Action Remove`가 이 등록을 폐기했을 수도 있다 |

**판정: 가장 유력한 원인은 Vision 등록이 Vision 서비스가 읽지 않는 DB/스키마(메인 `carscope`)에 발급된 것이다(가능성 높음, DB로 미확정).** 두 번째 후보는 다른 origin 작업이 이 등록을 취소한 것이다. 두 경우 모두 서버는 같은 401을 준다. DB 접속 정보가 없어 어느 쪽인지 DB에서 직접 확인하지 못했다. 아래 진단 도구가 이를 확정한다. 한 번의 명령으로 `NO_REGISTRATION`, `SCHEMA_MISMATCH`, `REVOKED`, `PROOF_MISMATCH`, `STORE_MISMATCH` 중 하나로 구분한다.

## 4. 진단 도구

```powershell
cd tools\inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
.\android\test-vision-qr.ps1 -Serial emulator-5554 `
  -VisionOrigin https://carscope-vision-experiment.onrender.com `
  -Schema carscope_vision -CaPemFile C:\CarScope-External\supabase\prod-ca-2021.crt
```

- DB URL은 `PG_VISION_DATABASE_URL` 또는 숨김 입력으로 받는다. **Vision 서비스가 쓰는 DB와 역할**을 넣는다. Enter를 누르거나 `-SkipDatabase`를 주면 DB 항목은 NOT_RUN이다.
- 기본은 읽기 전용이다. DB는 `BEGIN TRANSACTION READ ONLY`로 조회한 뒤 ROLLBACK한다. proof는 기기에서 Node 메모리로만 읽고, 해시 비교는 `timingSafeEqual`로 메모리에서 한다. proof, 해시, grant, 토큰, DB URL은 화면과 보고서(`C:\CarScope-External\p22-avd-qr\vision-qr-*.json`)에 남지 않는다.
- `-ApproveProvision`: `/simulator/provision`을 1회 호출한다. 짧은 grant 행 1개를 쓴다. 성공하면 grant를 앱과 같은 계약으로 검증한다. 401이면 DB 결과와 합쳐 원인을 이름 붙인다. DB에서는 유효한데 서버가 거부하면 `STORE_MISMATCH`(서버가 다른 DB/스키마를 읽음)다.
- `-ApproveSession`(`-ApproveProvision`과 함께): 세션 1개를 만들어 QR 페이로드를 검증하고 바로 취소한다.
- 실제 승인 테스트는 serial마다 **1분에 1회**만 한다(서버 한도 4회/분 이내). 같은 실행에서 두 번 보내지 않는다.
- 판정: `READY_FOR_QR_E2E`는 1–10 모두 PASS(경고 허용), `NOT_VERIFIED`는 실행하지 않은 항목이 있을 때, `BLOCKED`는 실패가 있을 때다. 첫 실패 지점과 수정 방법을 출력한다.

| 항목 | 실패 원인 이름 |
|---|---|
| AVD | `AVD_NOT_CONNECTED`, `AVD_NOT_BOOTED` |
| APK | `APK_MISSING`, `APK_NOT_DEBUGGABLE` |
| Origin | `ENDPOINT_MISSING`, `ORIGIN_MISMATCH`, `APK_ORIGIN_MISMATCH` |
| 서버 | `SERVER_STARTING`(502/503/504), `SERVER_TIMEOUT`, `NETWORK_TLS`, `NOT_SIMULATION_MODE`, `NOT_VISION_SERVICE` |
| enrollment | `ENROLLMENT_MISSING`, `ENROLLMENT_PERMISSIONS`, `ENROLLMENT_INVALID`, `ENROLLMENT_EXPIRED`, `CLOCK_SKEW`, `STATE_MISMATCH` |
| DB | `DB_NOT_PROVIDED`, `DB_CONNECT_FAILED`, `SCHEMA_MISMATCH`, `TABLES_MISSING`, `NO_REGISTRATION`, `REVOKED`, `EXPIRED`, `PROOF_MISMATCH`, `DB_PERMISSIONS` |
| 실제 승인 테스트 | `STORE_MISMATCH`, `AUTH_REJECTED`, `RATE_LIMITED`, `REQUEST_ORIGIN_REJECTED`, `GRANT_INVALID`, `LIVE_GUARD`, `SESSION_REJECTED`, `SESSION_INVALID` |

공개 HTTP 응답은 바꾸지 않았다. 원인은 운영자 로컬 진단에서만 구분한다. 메인 서비스의 `/healthz` 키도 그대로다.

## 5. 재발 방지 (`setup-avd-simulator.ps1`)

- `-VisionOrigin`으로 Install/Remove할 때 `-Schema`를 **반드시 명시**해야 한다. 생략하면 아무것도 발급하지 않고 멈춘다.
- DB 입력 안내가 "Vision 서비스가 쓰는 DB와 역할"로 바뀌었다.
- state 파일을 origin마다 따로 쓴다: `registration-<serial>-<host>.json`. 메인 서비스는 기존 이름을 유지한다. 한쪽의 Remove가 다른 쪽 등록을 폐기하지 않는다.
- 이전 이름의 파일만 있으면 Vision Install/Remove는 어느 origin의 것인지 추측하지 않고 멈춘다.
- 발급 직후 진단 명령을 안내한다.

## 6. 앱 재시도 정책 (Kotlin)

| 실패 | 이전 | 이후 |
|---|---|---|
| 401, 403 | 패널이 열린 동안 30초마다 무한 재시도 | **자동 재시도 없음**. 새 부품 요청, `서비스 연결 확인`, 화면 재진입 때만 다시 |
| 502/503/504, 타임아웃, 네트워크 | 30초마다 | 30 s → 60 s → 120 s, 3회 뒤 중단 |
| 429 | 30초마다 | 120 s 뒤 1회 |
| TLS, 응답 계약, 시각, enrollment 만료 | 30초마다 | 자동 재시도 없음 |

- 로그 범주 `PROVISION_SERVER_UNAVAILABLE`(502/503/504)를 추가했다. 이전에는 `PROVISION_HTTP_REJECTED`였다.
- 화면 문구를 원인별로 나눴다. 예: "AVD 등록 거부 · 같은 등록으로는 자동 재시도하지 않습니다", "서버 준비 중 · 잠시 뒤 다시 확인합니다 (1/3)".
- 3D 페이지에서는 재시도가 예약된 동안 `AUTH_WAITING`, 거부는 `AUTH_FAILED`다. `AUTH_FAILED` 문구는 이제 "자동으로 다시 시도하지 않습니다"라고 쓴다.
- 거부된 뒤 예약된 재시도가 없으면 3D 페이지에 **`다시 확인`**이 나온다(`retryAvailable`). 누르면 grant를 1회 다시 요청한다. 같은 부품을 다시 눌러도 브리지가 같은 요청을 다시 무장하지 않기 때문에, 이 버튼이 사람이 직접 재시도하는 경로다. 테스트 중에 발견해 고쳤다.
- 세션과 QR 중복 생성 방지는 기존 그대로다: 요청 하나가 세션 하나를 만들고, 다시 열어도 새로 만들지 않는다.
- OEM provisioning 경로의 30초 갱신은 바꾸지 않았다.

## 7. E2E (MOCK, 실제 HTTP)

`npm test`에 포함된 `test/avd-qr-e2e.test.mjs`는 실제 `AvdSimulatorCredentialStore`와 `/simulator/provision`, 세션 API, `SyncClient`를 쓴다. 저장소 자리에는 스토어의 SQL을 그대로 실행하는 메모리 풀을 쓴다. PostgreSQL 변형은 `PG_TEST_URL`이 있을 때 실행되며 `postgres-store-ci`에 추가했다.

- 성공 경로: 등록 → 진단(승인 테스트 포함, `READY_FOR_QR_E2E`, provision 정확히 1회) → grant → 세션 → QR → 폰 Claim → 제출 → 차량 `RESULT_SUBMITTED` → 수락 `ACCEPTED`.
- 오류: 등록 없음(다른 스키마 발급), proof 불일치, 취소, 만료, 다른 저장소, 스키마 불일치, 429(5번째 요청), 400 origin, 503(저장소 예외), 지연 응답, 잘못된 grant, 타임아웃, TLS/네트워크, AVD 미연결, 잘못된 origin, 앱 재설치(파일 없음, 등록은 유지), AVD 재시작(같은 파일로 새 grant), 시계 차이, 잘못된 파일, state 불일치.
- 공개 응답에는 사유가 없다(`{"error":{"code":"UNAUTHORIZED"}}`). 진단 결과에는 proof와 해시가 없다.

Kotlin: `ProvisionRetryPolicy` 단위 테스트, HTTP 상태와 예외별 범주, 3D 요청 흐름(401 비재시도, 503 3회 백오프 뒤 중단, 429 1회).

## 8. 실제 환경에서 남은 실행 (승인 필요)

1. `test-vision-qr.ps1`을 Vision DB URL과 `-Schema carscope_vision`(Vision 서비스의 실제 값)으로 실행한다. 읽기 전용이다. 원인 이름을 확인한다.
2. `NO_REGISTRATION` 또는 `SCHEMA_MISMATCH`면 Vision DB에서 새로 발급한다(G6). 이전 Vision state 파일은 이전 이름이므로 먼저 옮긴다.
   ```powershell
   .\android\setup-avd-simulator.ps1 -Serial emulator-5554 -VisionOrigin https://carscope-vision-experiment.onrender.com -Schema carscope_vision -StateDir C:\CarScope-External\avd-vision -CaPemFile <CA>
   ```
3. `test-vision-qr.ps1 … -ApproveProvision -ApproveSession`으로 `READY_FOR_QR_E2E`를 확인한 뒤 앱에서 QR을 연다.
4. 메인 DB에 잘못 들어간 등록이 있으면, 확인한 뒤 따로 승인을 받아 `avd-simulator-admin.mjs revoke --id …`로 폐기한다. 이번 작업에서는 폐기하지 않았다.

## 9. 검증 결과 (2026-11-14, Windows, Node 22.16.0, JDK 17, Robolectric)

| 게이트 | 결과 |
|---|---|
| 실제 AVD·Vision 서비스 대상 진단(읽기 전용, DB 미제공) | 1–5 PASS, DB 4항목과 실제 승인 테스트 2항목 NOT_RUN, `NOT_VERIFIED` |
| `vision-qr-diagnose.test.mjs` | PASS 5/5 |
| `avd-qr-e2e.test.mjs` (MOCK, 실제 HTTP) | PASS 4/4, PostgreSQL 변형 1개 NOT_RUN(로컬 `PG_TEST_URL` 없음, CI `postgres-store-ci`에서 실행) |
| `avd-setup-script.test.mjs` | PASS 7/7 (영문 `TEMP`. 한글 사용자 경로의 fake adb 1건은 기존 환경 문제) |
| inspection-sync `npm test` | 283 pass, 0 fail, 42 skip(PostgreSQL) |
| inspection-sync `check`, `test:legacy`, `test:https-e2e` | PASS (48/48, 3/3) |
| app `:app:testDebugUnitTest` (전체) | PASS 291/291 |
| three-poc `check:results`, `npm test`, android-assets, results·consistency·history 브라우저 | PASS |
| Kotlin core | PASS |
| 실제 DB 진단, 실제 grant·세션 생성, 새 발급, 실제 폰 QR 스캔 | **NOT_RUN** (DB 접속 정보와 승인 필요) |
