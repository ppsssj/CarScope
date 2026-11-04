# P8-C1 배포 준비와 통합 Preflight

기준: `main` `40344d6`(PR #76, #77 병합)에서 작성하고 `a99d7aa`(PR #79 병합)를 merge했다. PR #79는 `tools/inspection-sync-poc/**`와 `app/**`를 바꾸지 않아 이 문서의 게이트·DDL·호환성 표에 영향이 없다. 이후 PR #78(`serverNow`)이 병합되어 현재 main은 `8a6f559`이고, P9-A1에서 절차를 이에 맞췄다. **서버 코드는 main에 있지만 Render에는 아직 배포되지 않았다.** 이 작업은 배포 준비와 검증 자동화다. **Render 배포, 운영 DB 변경, 운영 migration, AVD 실행은 하지 않았다.** 실행 근거는 [증거 인덱스](evidence/p8-c1/README.md), 기기 검증 준비는 [P9 체크리스트](p9-e2e-checklist.md)에 있다.

## 판정

| 표식 | 상태 | 범위 |
|---|---|---|
| `DEPLOYMENT_PREFLIGHT_IMPLEMENTED` | PASS | 게이트 CLI, 호환성 도구, 격리 PG 통합 테스트, CI, 문서 |
| `DEPLOYMENT_PREFLIGHT_VERIFIED` | PASS (범위 한정) | 격리 PG 16 + 합성 authority. 운영 Render·DB·실제 소유권 검증이 아니다 |
| `RENDER_DEPLOYMENT_NOT_RUN` | NOT_RUN | 도구에 배포 명령이 없다 |
| `PRODUCTION_AUTH_BLOCKED` | BLOCKED | [P8-A2 차단 조건](p8-a2-history-auth.md) 그대로. 신뢰 issuer·소유권 근거·폐기 서비스 없음 |
| `DEVICE_E2E_NOT_RUN` | NOT_RUN | AVD·스마트폰·실차 미실행 |

## 배포 전에 알아야 할 사실

조사와 테스트에서 확인한 내용이다. 앞의 네 개는 절차에 직접 영향을 준다.

1. **배포가 곧 migration이다.** `render-stateful.mjs`는 시작할 때 `PostgreSQLSessionStore.open()`을 호출하고, 이 호출이 base·History DDL을 `DATABASE_URL`에 적용한다. 별도 migration 단계가 없다. Deploy를 누르기 전에 백업해야 한다.
2. **Auto-Deploy가 켜져 있으면 PR 병합만으로 DDL과 응답 변경이 운영에 적용된다.** 2026-11-05 사용자가 OFF를 확인했다. 도구가 읽은 값은 아니므로 게이트는 MANUAL이며, Manual Deploy 전에 다시 확인한다.
3. **서비스 DB 역할은 스키마 CREATE 권한과 테이블 소유권이 있어야 한다.** `CREATE ... IF NOT EXISTS`는 객체가 이미 있어도 권한을 먼저 검사하므로, DML만 가진 역할은 migration이 끝난 뒤에도 시작할 때마다 `42501`로 실패한다(`deployment-postgres.test.mjs`로 재현). 최소 권한 런타임 역할은 현재 불가능하다. 서버 코드를 고칠 사안이라 이번 범위에서는 재현과 보고만 했고, `database` 게이트가 `DB_STARTUP_PRIVILEGE`로 잡는다.
4. **운영의 `serverNow`는 직접 관찰할 수 없다.** 2026-11-05 `/healthz`는 `STATEFUL_DENY_DEFAULT`, `sessionCreation: DENIED`다. 이 상태에서는 어떤 APK로도 세션을 만들 수 없다. 시뮬레이터 모드를 승인해 켜도 기기는 값을 표시·기록하지 않으므로 배포 커밋과 3D binding 결과로 간접 판정한다([P9 C5](p9-e2e-checklist.md#c5-servernow-확인)).
5. `/v1` 요청은 거부되더라도 PostgreSQL rate limiter를 지나며 `cs_rate_windows`에 쓴다. 그래서 `probe`는 기본적으로 `/healthz`만 호출한다. `/v1` 프로브는 `--approve-rate-window-writes`가 있어야 실행한다.
6. `CREATE INDEX IF NOT EXISTS`는 인덱스가 있어도 시작할 때마다 대상 테이블에 잠깐 ShareLock을 잡을 수 있다(PostgreSQL 동작에 근거, 이 환경에서 측정하지 않음). 재시작 순간 쓰기가 짧게 대기할 수 있다.

## 안전 경계

`bin/deployment-preflight.mjs`에는 배포·재시작·환경변수 변경·DDL 명령이 없고 Render API도 호출하지 않는다. `deploy`, `migrate` 인자는 사용법 오류(exit 2)다.

- DB URL은 인자로 받지 않고 `--url-env <변수 이름>`으로만 받는다. URL·비밀번호·호스트는 출력하지 않으며 드라이버 오류도 코드만 남긴다.
- DB 검사는 `BEGIN TRANSACTION READ ONLY`에서 수행하고 항상 ROLLBACK한다. 카탈로그와 행 수만 읽는다. loopback이 아닌 DB는 `--allow-remote-read-only`가 없으면 연결하지 않는다.
- `regression`은 loopback이 아닌 `PG_TEST_URL`이나 `DATABASE_URL`과 같은 값을 거부하고, 하위 테스트 환경에서 서비스 변수를 제거한다.
- 보고서(`--report`)는 저장소 밖 새 파일에만 쓴다.
- 자동 판단할 수 없는 항목은 PASS로 올리지 않는다. 운영자가 입력한 값(`--auto-deploy off`)도 MANUAL이다.

종료 코드는 0(FAIL 없음, 미해결 항목은 남을 수 있음), 1(FAIL 있음), 2(사용법 오류)다. **exit 0은 배포 가능 판정이 아니다.** 출력의 `open` 수와 각 항목을 확인한다.

## 실행 명령

```powershell
Set-Location tools/inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false

# 네트워크·DB 없음
node bin/deployment-preflight.mjs static
node bin/deployment-preflight.mjs compat --apk ..\..\app\build\outputs\apk\debug\app-debug.apk
node bin/deployment-preflight.mjs render

# loopback 격리 DB 전용
$env:PG_TEST_URL = '<loopback 격리 PostgreSQL URL>'
node bin/deployment-preflight.mjs database --url-env PG_TEST_URL
npm run test:deployment
node bin/deployment-preflight.mjs regression
Remove-Item Env:PG_TEST_URL

# 실제 Kotlin decoder 실행. 저장소 밖 새 폴더, APK 설치 없음
node preflight/run-decoder-probe.mjs --work C:\CarScope-External\p8-c1\decoder-probe --sdk C:\Android\Sdk
```

운영을 읽는 아래 명령은 **사용자가 실행 여부를 정한다.** 쓰기는 없지만 첫 번째를 제외하면 운영 자원을 사용한다.

```powershell
# 인증 없는 GET /healthz 한 번
node bin/deployment-preflight.mjs probe --origin https://carscope-lluo.onrender.com

# 대시보드에서 관찰한 값을 입력. 파일에는 변수 이름만 한 줄씩 적는다. 값이 있으면 거부한다.
node bin/deployment-preflight.mjs render --deployed-commit <SHA> --auto-deploy off --env-names-file C:\CarScope-External\render-env-names.txt

# 승인 시: 운영 cs_rate_windows에 레코드가 쓰인다
node bin/deployment-preflight.mjs probe --origin https://carscope-lluo.onrender.com --approve-rate-window-writes

# 승인 시: 운영 DB 읽기 전용 검사. External URL을 터미널 기록에 남기지 않는다
$secure = Read-Host -AsSecureString
$env:CARSCOPE_READONLY_DB = [Net.NetworkCredential]::new('', $secure).Password
node bin/deployment-preflight.mjs database --url-env CARSCOPE_READONLY_DB --allow-remote-read-only
Remove-Item Env:CARSCOPE_READONLY_DB
```

## 게이트 목록

| 요구 | 게이트 | 판정 방식 |
|---|---|---|
| DB 접속, 스키마, History 버전, 테이블 | `DB_*` | 실제 카탈로그 조회. 미적용 MANUAL, 부분 적용·미지원 버전 FAIL |
| Sync TTL | `SYNC_TTL_CONTRACT` | `DEFAULT_LIMITS` 10m/30m/10m/60m 비교 |
| DENY_DEFAULT | `HISTORY_DENY_DEFAULT`, `RENDER_BOOTSTRAP_DENY_DEFAULT` | 실제 HTTP 403, CLI 블록에 authority 전달 없음 |
| 환경변수로 해제 불가 | `ENV_CANNOT_ENABLE_AUTH` | Render import 폐쇄 전체의 환경변수 읽기를 허용 목록과 대조. 실제 CLI에 적대적 변수를 준 PG 테스트 |
| 미검증 인증 차단 | `UNVERIFIED_AUTHORITY_BLOCKED`, `RENDER_CLI_REFUSES_UNSAFE_CONFIG` | 실제 시작 경로 실행. 위험 구성 10종이 exit 1과 정제된 한 줄로 끝나고 DB에 연결하지 않음. 대조군으로 DB 도달 불가도 확인 |
| `serverNow` | `SERVER_NOW_CONTRACT` | 이 트리의 실제 생성 응답. 필드 없음 BLOCKED, 범위 위반 FAIL |
| QR·Accept·토큰 경계 | `REGRESSION_*` | 기존 스위트 재실행. skip은 NOT_RUN이며 PASS가 아니다 |
| 테스트·운영 credential 분리 | `TEST_PROD_CREDENTIAL_SEPARATION`, `RENDER_BOOTSTRAP_DENY_DEFAULT` | scope 분리, 런타임이 `test/`·`preflight/`를 import하지 않음, 비밀 형태 파일 미추적 |
| Render 상태 | `RENDER_*` | 접근 불가 항목은 NOT_VERIFIED |

## APK와 서버 호환성

| APK decoder | 서버 | Native 세션 생성 | Native→3D |
|---|---|---|---|
| 구버전(`2435087`까지) | 기존 | PASS | UNSUPPORTED (브리지 없음) |
| 구버전 | 신규 `serverNow` | **FAIL** (`INVALID`) | UNSUPPORTED |
| 신규(`09f3490` PR #76부터) | 기존 | PASS | UNSUPPORTED (`SERVER_CLOCK_UNAVAILABLE`) |
| 신규 | 신규 | PASS | PASS (계약 수준. 기기 E2E는 NOT_RUN) |

표는 코드·계약 수준의 호환성이다. 운영이 `DENIED`인 동안 Native 세션 생성은 APK와 무관하게 거부되므로 시뮬레이터 모드 전에는 이 표의 PASS를 기기에서 관찰할 수 없다. 표는 세 경로로 고정했다. `compat`은 Kotlin 소스의 `fun created`에서 정책을 읽어 이 트리의 실제 응답에 적용한다. 구버전 소스는 `preflight/legacy-decoder-created-2435087.kt.txt`이며 git 이력과 같은지 검사한다. `run-decoder-probe.mjs`는 두 리비전의 실제 Kotlin decoder를 JVM에서 실행한다. `classifyApk`는 빌드된 APK의 DEX 문자열로 세대를 구분한다. 어떤 APK가 기기에 설치됐는지는 증명하지 못한다.

## 배포 순서

**신규 APK를 먼저 설치하고, 그 다음 서버를 배포한다.** 반대 순서면 구버전 APK의 세션 생성이 `INVALID`로 실패한다. 각 단계는 별도 사용자 승인이 필요하다.

| 순서 | 작업 | 확인 |
|---|---|---|
| 0 | Auto-Deploy Off 재확인. 2026-11-05 사용자 확인 | `render --auto-deploy off` (MANUAL) |
| 1 | Debug APK 확보. **완료:** `8a6f559`, SHA-256 `b11f3a79…dd3d4`, `NEW_DECODER` | [P9 A](p9-e2e-checklist.md#a-apk-식별과-설치) |
| 2 | 사용 중인 모든 AVD·기기에 이 APK 설치와 endpoint·GLB 배치 | [P9 A](p9-e2e-checklist.md#a-apk-식별과-설치), [B](p9-e2e-checklist.md#b-기기-준비). 구버전 기기를 남기지 않는다 |
| 3 | 현재 서버의 기본 상태 확인. `DENIED`이므로 **세션 생성 비활성이 합격이다** | [P9 C1](p9-e2e-checklist.md#c1-기본-서버-상태-deny_default) |
| 4 | PR #78 병합. **완료:** `8a6f559`. 운영은 아직 바뀌지 않았다 | `static`의 `SERVER_NOW_CONTRACT` PASS |
| 5 | 운영 DB 백업, 읽기 전용 검사, 별도 DB 복원 리허설 | 아래 절차 |
| 6 | Render Manual Deploy로 main 배포. 이때 DDL이 적용된다. **시뮬레이터 변수는 함께 넣지 않는다** | `/healthz`, `render --deployed-commit` |
| 7 | 배포 후 확인. 신규 코드도 `STATEFUL_DENY_DEFAULT`, `DENIED`여야 한다 | 아래 절차, P9 C1 재확인 |
| 8 | 시뮬레이터 활성화, enrollment, Native 세션, `serverNow`, Native→3D를 단계별 승인으로 진행 | [P9 C2~C6](p9-e2e-checklist.md#c-서버와-세션-단계) |
| 9 | 실행 후 시뮬레이터 모드 복원 | [P9 H](p9-e2e-checklist.md#h-실행-후-복원-g9) |

서버만 되돌리는 것은 신규 APK에 안전하다(신규 + 기존 = PASS). 구버전 APK를 다시 설치하는 롤백은 서버가 기존 버전일 때만 가능하다.

## 운영 DB에 적용되는 DDL

전부 `IF NOT EXISTS` 또는 `ON CONFLICT DO NOTHING`이며 기존 열을 바꾸지 않고 backfill하지 않는다. `DDL_ADDITIVE`가 다른 문장을 FAIL 처리하고, 테스트가 아래 표와 SQL의 일치를 검사한다. SHA-256은 줄바꿈을 LF로 정규화해 계산한다.

| 파일 | 적용 시점 | 테이블 | 인덱스 | SHA-256 |
|---|---|---|---|---|
| `src/postgres-schema.sql` | 모든 시작 | `cs_schema_meta`, `cs_sessions`, `cs_session_tokens`, `cs_rate_windows` | `cs_rate_expiry` | `70207b6911648085a3dda78ec7eaf6e41ff4f1b0228b304706e24e05fb7f9361` |
| `src/postgres-history-schema.sql` | 모든 시작. **P8-A1 이전 커밋에서 올리면 처음 적용된다** | `cs_history_schema_meta`, `cs_inspection_records` | `cs_history_owner_page`, `cs_history_owner_task_page` | `877ba1427367caee7a03d03cea331c9daa0da28a3642c81ba6382546b4b04e8a` |
| `src/avd-simulator-schema.sql` | 시뮬레이터 모드 또는 관리자 CLI | `cs_avd_auth_meta`, `cs_avd_registrations`, `cs_avd_creation_grants` | `cs_avd_grants_expiry`, `cs_avd_grants_registration` | `b198ba83b7201e2284a6e0e015cc11e020ab10e7946870886c866333f77a4ee9` |

PR #78은 DDL을 바꾸지 않는다. 운영 DB에 History 테이블이 이미 있는지는 `NOT_VERIFIED`다. 배포된 커밋과 `database` 검사로 확인한다.

## 운영 환경변수

| 변수 | 요구 |
|---|---|
| `DATABASE_URL` | 필수. Internal URL, secret. 쿼리 문자열이 있으면 시작 거부 |
| `NODE_VERSION` | `22.16.0` |
| `RENDER`, `RENDER_EXTERNAL_URL`, `PORT` | Render 제공 |
| `CARSCOPE_AVD_SIMULATOR_MODE` | 기본 없음. 값은 `OPERATOR_APPROVED`만 허용. 켜면 생성이 시뮬레이터에 한해 열린다. OEM 소유권이 아니다 |
| `SYNC_LOCAL_TEST_AUTH`, `SYNC_FIXTURE_TOKEN`, `SYNC_DEBUG_PAGE`, `SYNC_ALLOWED_ORIGIN` | 있으면 시작 거부 |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | 시작 거부 |
| `PG_TEST_URL`, `PG_ADMIN_DATABASE_URL` | 서비스에 두지 않는다 |

History를 여는 환경변수는 없다. `startRenderStateful({historyAuthority})`는 검토된 bootstrap 코드에서만 호출할 수 있다. Build/Start Command는 [P6-D2](p6-d2-postgres-store.md)를 따른다.

## Render 안전 점검

실제 Render 설정에 접근하지 않았다.

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| `/healthz` | PASS (2026-11-05 단일 관측) | `probe`. `STATEFUL_DENY_DEFAULT`, `DENIED`, `historyRead` 없음 |
| main과 배포 커밋 일치 | NOT_VERIFIED | 대시보드 Events의 최근 Deploy 커밋을 `render --deployed-commit`에 입력 |
| Auto-Deploy | MANUAL (2026-11-05 사용자 OFF 확인) | Settings > Build & Deploy > Auto-Deploy. Deploy 직전 재확인 |
| 환경변수 | NOT_VERIFIED | Environment 화면의 **이름만** `--env-names-file`로 입력 |
| 운영 DB 스키마·버전 | NOT_VERIFIED | 승인 후 읽기 전용 `database` |
| 운영 History 403 | NOT_VERIFIED | 승인 후 `--approve-rate-window-writes`. 코드 경로는 PG 테스트로 검증 |
| DB 플랜·백업·만료일 | NOT_VERIFIED | 대시보드. [P6-D2](p6-d2-postgres-store.md)는 Free DB의 30일 만료와 백업 부재를 기록한다 |

## 백업과 복구

**이 절차는 실행하지 않았다. 복원 리허설도 NOT_RUN이다.** 이번 환경의 임베디드 PostgreSQL에는 `pg_dump`가 없다.

### 배포 전

1. 운영자 PC에서 PostgreSQL 16 클라이언트로 논리 백업을 만든다. 파일은 Git 밖에 두고 공유하지 않는다. 세션 결과와 점검 기록이 들어 있다.

   ```powershell
   $secure = Read-Host -AsSecureString   # URL과 비밀번호를 명령줄에 넣지 않는다
   $env:PGPASSWORD = [Net.NetworkCredential]::new('', $secure).Password
   pg_dump --host <External host> --username <user> --dbname <db> --format=custom --no-owner --file C:\CarScope-External\backup\carscope-<UTC시각>.dump
   pg_restore --list C:\CarScope-External\backup\carscope-<UTC시각>.dump | Select-String 'cs_sessions|cs_inspection_records'
   Remove-Item Env:PGPASSWORD
   ```

2. 파일의 SHA-256을 기록한다. 유료 플랜이면 관리형 백업이나 복구 시점도 대시보드에서 확인한다.
3. **새로 만든 빈 DB**에 복원을 한 번 연습한다. 운영 DB에는 복원하지 않는다.

   ```powershell
   pg_restore --host <새 DB host> --username <user> --dbname <새 DB> --no-owner --exit-on-error C:\CarScope-External\backup\carscope-<UTC시각>.dump
   ```

4. 복원본에 `database` 검사를 실행해 FAIL이 없는지와 행 수를 원본과 비교한다.

### 실패 대응

| 증상 | 의미 | 조치 |
|---|---|---|
| 배포 로그 `RENDER_STATEFUL_CONFIGURATION_FAILED`, health 실패 | 설정 오류, DB 연결 실패, DDL 권한 부족, 미지원 스키마 버전 중 하나. CLI는 비밀 유출을 막으려고 사유를 구분해 출력하지 않는다. DDL이 실패하면 해당 트랜잭션은 롤백된다 | 이전 인스턴스가 유지되는지 대시보드에서 확인한다(이번에 관찰하지 않음). 환경변수 이름과 읽기 전용 `database`로 원인을 좁힌다 |
| `/healthz` 503 `UNAVAILABLE` | 서버는 떠 있으나 DB 응답 없음 | DB 상태 확인. 자동으로 다른 저장소로 전환하지 않는다 |
| `database`의 `DB_BASE_SCHEMA`/`DB_HISTORY_MIGRATION`이 미지원 버전 FAIL | DB가 코드보다 새 버전 | 코드를 더 새 버전으로 맞춘다. 버전 행을 수정하지 않는다 |
| 구버전 APK에서 `INVALID` | 신규 서버와 구버전 decoder 조합 | 신규 APK 설치. 서버 롤백은 최후 수단 |
| 신규 APK에서 `3D 연결 차단` 문구 (`SERVER_CLOCK_UNAVAILABLE`) | 기존 서버, RTT 5000ms 초과 또는 전달 예산 초과. 화면으로 구분되지 않는다 | 배포 커밋 확인. 시간 조건을 완화하지 않는다 |

### 코드 롤백

1. Render Dashboard의 Rollback 또는 이전 커밋 Manual Deploy를 사용한다. **DB는 복원하지 않는다.** DDL은 추가만 하므로 이전 코드가 무시할 수 있다. 테스트는 migration 뒤 base DDL 재실행, 메타 버전 유지, 세션-기록 FK 부재를 확인한다. 실제 과거 커밋의 서버를 실행한 검증은 아니다.
2. History 테이블을 DROP하지 않는다. 롤백 명령도 제공하지 않는다.
3. P8-A1 이전 코드로 되돌리면 그 기간의 Accept는 기록으로 남지 않는다.
4. 롤백 뒤 `/healthz`와 `render --deployed-commit`을 다시 실행한다.

DB 복원은 데이터 손상이 확인되고 사용자가 별도로 승인한 경우에만 한다. 백업 이후의 기록이 사라지므로 새 DB에 복원해 `DATABASE_URL` 전환을 먼저 검토한다.

### 배포 후 확인

1. `probe`: `STATEFUL_DENY_DEFAULT`, `DENIED`, `historyRead` 없음
2. 승인 시 `probe --approve-rate-window-writes`: records 403, session 401, 생성 403
3. 승인 시 읽기 전용 `database`: `DB_HISTORY_MIGRATION` PASS, 행 수가 백업과 모순되지 않음
4. 시뮬레이터 모드 승인 뒤 `serverNow` 간접 판정: [P9 C5](p9-e2e-checklist.md#c5-servernow-확인)

## 통합 테스트가 추가한 경계

기존 스위트가 다루는 항목(17개 task 왕복, keyset 페이지, 경합, 어댑터 장애 모드)은 다시 작성하지 않았다. `test/deployment-postgres.test.mjs`는 비어 있던 경계만 채운다.

| 경계 | 기존 | 추가 |
|---|---|---|
| Render **CLI 프로세스** 부팅 | 함수 호출만 | 실제 `node src/render-stateful.mjs` 기동. 적대적 환경변수에도 DENY_DEFAULT 유지 |
| History 이전 DB 업그레이드 | 새 스키마만 | 기존 행 유지, backfill 없음, 기존 열 불변, 실패 시 무변경 |
| 비소유자 역할, 부분 스키마 | 없음 | 시작 실패 재현, `database` 게이트 탐지 |
| 한 기록의 전체 수명 | 구간별 | 생성→제출→Accept→세션 삭제→범위 조회→폐기를 같은 기록으로 |
| 시뮬레이터 Accept와 archive | 생성까지 | 실제 CLI에서 `AVD_SIMULATOR` 기록, 소유자 없음, 조회 403, 폐기 |

`PG_TEST_URL`이 없으면 skip이며 PASS로 세지 않는다. 격리는 loopback 검사와 UUID 스키마로 하고, 테스트 역할은 끝나면 삭제한다. 샘플링한 시나리오의 통과이며 모든 interleaving의 증명이 아니다.

## 남은 위험

- 구버전 판정은 `2435087` 기준이다. 더 오래된 APK는 task 목록 등 다른 이유로도 실패할 수 있어 지원 대상으로 삼지 않는다.
- `classifyApk`는 문자열 존재로 세대를 구분한다. 난독화된 빌드에는 쓸 수 없다.
- `ENV_CANNOT_ENABLE_AUTH`는 정적 스캔이다. `pg`가 읽는 `PG*` 변수 같은 외부 라이브러리는 범위 밖이며, 인증 판단에는 관여하지 않는다.
- 시계 안정성, 빠른 제출의 거짓 거부, WebView Referer는 [P7-C3](p7-c3-server-clock.md)가 남긴 미해결 항목 그대로다.
- 최소 권한 DB 역할 불가(사실 3)는 별도 과제가 필요하다. 예를 들어 migration을 시작 경로에서 분리하는 방안이 있으나 이번에 변경하지 않았다.
