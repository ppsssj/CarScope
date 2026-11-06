# P9-A4 Supabase PostgreSQL 이전 사전 검증

Render PostgreSQL을 독립된 Supabase 프로젝트로 옮기기 위한 호환성 분석, 코드 수정, 격리 테스트, 이전 절차다. Render Web Service의 Node.js API, QR v2, enrollment, 차량 연동 구조는 그대로 둔다. **프로젝트는 사용자가 별도로 만들었다. 이 작업은 Supabase에 연결하거나 SQL을 실행하지 않았고, Render 운영 DB 접근, 배포, 환경변수 변경, 데이터 이전도 하지 않았다.** 기존 AICS_Web 프로젝트에는 접근하지 않는다. 실행 근거는 [증거 인덱스](evidence/p9-a4/README.md)에 있다.

## 판정

| 표식 | 상태 | 범위 |
|---|---|---|
| `SUPABASE_PREFLIGHT_LOCAL_PASS` | [증거](evidence/p9-a4/README.md) 참조 | Docker PostgreSQL 16·17, 합성 데이터. `platform`은 문서를 본뜬 로컬 대역이며 Supabase가 아니다 |
| `SUPABASE_CONNECTION_NOT_RUN` | NOT_RUN | 프로젝트는 있으나(S1, 사용자 보고) 이 작업은 연결하지 않았다. 실제 인증서, Supavisor, Data API는 관찰하지 않았다 |
| `S2_ROLE_NOT_CREATED` | NOT_RUN | `carscope_app` 없음. 운영 Supabase에 SQL을 실행하지 않았다 |
| Render Auto-Deploy, 운영 `DATABASE_URL` 호스트 형식 | **NOT_VERIFIED** | 대시보드 확인 전까지 유지. 병합과 배포의 전제다 |
| `SUPABASE_DATA_MIGRATION_NOT_RUN` | NOT_RUN | S3 별도 승인 |
| `PRODUCTION_DB_NOT_RUN`, `RENDER_DEPLOY_NOT_RUN` | NOT_RUN | G3·G4 그대로 |

## 호환성 분석

Supabase 사실은 2026-11-06에 읽은 공식 문서 기준이다. 문서에 없으면 NOT_STATED로 적었다.

| 항목 | 현재 코드 | 판정 |
|---|---|---|
| PostgreSQL 16·17 | DDL과 쿼리에 버전 의존 기능이 없다 | 두 버전 실행. 16→17 복원은 행과 구조 일치. 대상 프로젝트는 17.11(사용자 보고)이고 시험 이미지와 같다. Render 원본 버전은 NOT_VERIFIED |
| JSONB, UUID, CHECK, INDEX, FK | 내장 타입과 함수만 쓰고 확장이 필요 없다 | 복원 후 CHECK·FK·PK 동작 확인(P9-A3), 두 버전 실행 |
| 자동 DDL | `render-stateful`이 시작할 때 적용. 이름에 스키마를 붙이지 않는다 | search_path가 틀리면 `public`에 생성된다. **수정:** 예상 스키마를 먼저 확인 |
| 연결 Pool | `max: 3`, 이름 있는 prepared statement 없음, `pg_advisory_xact_lock`은 트랜잭션 범위 | Session Pooler에서 문제될 기능을 쓰지 않는다(코드 분석). 실제 Supavisor는 NOT_RUN |
| 연결 끝점 | Render 아웃바운드의 IPv6 지원은 NOT_VERIFIED | **Session Pooler(5432) 권장.** Direct는 IPv4 add-on 없으면 IPv6 전용이고, Shared Pooler는 모든 플랜에서 IPv4다. Transaction Pooler는 쓰지 않는다 |
| 사용자 이름 | URL에서 그대로 전달 | Shared Pooler는 `carscope_app.<project-ref>` 형식(단위 테스트로 보존 확인) |
| TLS | **수정 전:** `ssl` 옵션이 없고 URL 쿼리를 거부해 항상 평문 시도 | 차단 사유였다. **수정:** CA 고정과 전체 검증. 문서상 SSL 강제는 기본이 아닌 것으로 보이므로(명시 없음) S1에서 켠다 |
| 인증서 | 문서는 CA를 Database Settings에서 내려받는다고 하며, 공개 CA 여부는 NOT_STATED | CA를 고정한다. **Pooler가 이 CA와 호스트 이름으로 검증되는지는 NOT_VERIFIED.** 실패하면 시작이 거부되며 검증을 끄지 않는다 |
| Fail-closed | DB 없으면 시작 거부, 대체 저장소 없음 | 실행 확인. **수정:** 트랜잭션 중 연결 끊김 처리 |
| 세션 보존 | 세션은 `cs_sessions`에 있다 | 재시작과 DB 중단 후에도 유지, 이후 Accept 가능 |

### 코드 수정

런타임을 바꾸는 PR이다. 병합 후 Render에 배포되어야 적용된다.

| 파일 | 변경 | 기존 Render 영향 |
|---|---|---|
| `src/database-config.mjs` (신규) | 평문은 loopback과 점 없는 내부 호스트만. 그 외는 CA 필수. Supabase 호스트는 전용 스키마 필수. URL 쿼리 거부 유지 | **있음.** 점이 있는 호스트를 CA 없이 쓰면 시작이 거부된다. Internal URL 형식이면 영향 없다. 운영 URL 형식은 NOT_VERIFIED이므로 [G4 전 확인](#render-전환-runbook) |
| `postgres-store`, `render-stateful` | `CARSCOPE_DB_SCHEMA`가 있으면 DDL 전과 `/healthz`에서 `current_schema()` 확인 | 변수가 없으면 없음. `/healthz`의 쿼리 문장만 바뀐다 |
| `postgres-store`, `avd-simulator-credentials` | 트랜잭션 중 연결이 끊겨도 프로세스가 죽지 않게 처리 | 장애 때만 동작 변경 |
| `avd-simulator-admin` | 두 변수가 있으면 같은 규칙 적용 | 변수가 없으면 없음 |
| `preflight/*`, `db-recovery` | PG 17 인정, `database --expect-schema --ca-env`, `relocate`, `compare` | 도구만 |

`restore`의 loopback·리허설 이름 제한은 그대로다. 넓히는 인자를 추가하지 않았고, `compare`는 쓰기 문장이 없다.

새 환경변수 두 개는 DB 연결만 정한다. History와 세션 생성 인증에 관여하지 않으며 `ENV_CANNOT_ENABLE_AUTH`가 허용 목록으로 고정한다.

## 보안 설계

**`public`을 쓰지 않는다.** 문서상 `public`은 Data API에 자동 노출된다. CarScope 테이블에는 세션 결과와 점검 기록이 있고, 지금 인증 정책은 DENY_DEFAULT다. 노출되면 그 정책을 건너뛰게 된다.

| 결정 | 내용 | 근거 |
|---|---|---|
| 스키마 | 전용 `carscope`. Data API의 Exposed schemas에 **추가하지 않는다** | 문서상 노출은 추가와 GRANT가 함께 필요하다 |
| API 역할 | `anon`, `authenticated`, `service_role`에 아무것도 주지 않는다. 문서의 노출용 GRANT를 실행하지 않는다 | 각 역할로 실제 쿼리해 42501 확인(로컬 대역) |
| RLS | 추가하지 않는다 | DDL 변경이 되고, 소유자에게는 적용되지 않는다. 경계는 스키마 권한이다 |
| 역할 | `carscope_app` 전용. superuser·CREATEROLE·CREATEDB·REPLICATION·BYPASSRLS 없음, 연결 한도 10 | 관리 스키마 읽기·쓰기가 42501로 실패함을 확인 |
| 최소 권한의 한계 | 서버가 시작마다 DDL을 실행하므로 런타임 역할이 스키마와 테이블을 **소유해야 한다** ([P8-C1 사실 3](p8-c1-deployment-readiness.md#배포-전에-알아야-할-사실)) | DML만 있는 역할은 현재 불가능하다. 소유 범위를 `carscope`로 제한한다 |
| search_path | `ALTER ROLE carscope_app SET search_path = carscope` | 연결 경로와 무관하게 서버가 적용한다. 코드에는 URL 쿼리가 없고 Pooler의 `options` 전달은 NOT_VERIFIED다 |
| 잘못된 search_path | `CARSCOPE_DB_SCHEMA`와 다르면 DDL 전에 시작 거부, 운영 중이면 `/healthz` 503 | 가드 없이 실제로 `public`에 생기는 대조군까지 테스트 |
| 인증 | DENY_DEFAULT 유지. 복원본·전용 스키마 위 실제 CLI에서 `DENIED`, records 403 | 임의 완화 없음 |

`preflight/supabase-bootstrap.sql`과 `supabase-post-restore.sql`은 운영자가 승인 후 실행하는 파일이다. 저장소의 어떤 도구도 원격에 실행하지 않는다. 비밀번호는 파일에 넣지 않고 `\password`로 정한다.

**한계:** 문서가 `anon`·`authenticated`의 기본 권한을 명시하지 않는다. Supabase의 이벤트 트리거나 플랫폼 기본값이 새 스키마에 권한을 주는지 관찰하지 못했다. 그래서 S3 후 `DB_API_ROLES_DENIED`를 실제 서버에서 다시 확인해야 한다.

## 이전 절차

각 단계는 **별도 승인**이다. 앞 단계의 승인이 다음으로 이어지지 않는다. S1부터 Supabase를 건드린다.

| 단계 | 내용 | 영향 | 승인 |
|---|---|---|---|
| 준비 | 이 PR 병합, 전환 코드 배포(G4 절차), 신규 APK 확인 | Render 배포 | G4 |
| G3 | Render 백업과 격리 복원 리허설 | 운영 DB 읽기 | G3 |
| S0 | 로컬 사본을 `carscope` 스키마로 이동, 2차 아카이브 생성 | 로컬 | G3 범위의 데이터이므로 같은 보관 규칙 |
| S1 | 프로젝트 생성 **완료(사용자 보고)**. SSL 강제와 Data API 확인은 남아 있다 | 운영 프로젝트 설정 | 남은 항목만 승인 |
| S2 | 역할 생성, 읽기 전용 검사 | 새 프로젝트 쓰기 | S2 |
| S3 | **데이터 이전:** 2차 아카이브 복원, 비교 | 새 프로젝트에 운영 데이터 복사 | S3 |
| S4 | Render `DATABASE_URL` 전환, 상태 확인 | **운영 전환** | S4 |
| S5 | QR E2E 재검증 | [P9 C2~C6](p9-e2e-checklist.md#c-서버와-세션-단계) | G5~G8 |

G3에서 만든 백업은 쓰기가 계속되면 낡는다. 지금 운영은 `DENIED`라 주된 쓰기는 `cs_rate_windows`지만 확인은 하지 못했다. **S3 전에 다시 받고, 전환 시점까지의 쓰기를 어떻게 다룰지 S4에서 정한다.**

### S0. 로컬 스키마 이동 (로컬 전용)

[P9-A3 B와 G](p9-a3-db-recovery-readiness.md#g-운영-g3-실행-전-승인-체크리스트)로 `$out\g3.dump`를 격리 DB `carscope_rehearsal_g3_target`에 복원·검증한 터미널에서 실행한다. 클라이언트 메이저는 Render 서버 이상이어야 한다. 대상이 17이므로 S3의 복원 클라이언트는 17을 쓴다. 16으로 만든 아카이브를 17이 복원하는 경로는 시험했다. 반대로 **17 클라이언트로 만든 아카이브는 16 클라이언트가 읽지 못한다.**

```powershell
node bin/db-recovery.mjs relocate --target-url-env CARSCOPE_REHEARSAL_TARGET --schema carscope
node bin/db-recovery.mjs backup --source-url-env CARSCOPE_REHEARSAL_TARGET --out $out\migration.dump --docker-image postgres:16
node bin/db-recovery.mjs inspect --archive $out\migration.dump --docker-image postgres:16
```

합격: `RELOCATE_APPLY` PASS(`rows and definitions unchanged`), `ARCHIVE_*` PASS. `public`에 다른 테이블이 있으면 멈춘다. 마지막 줄의 `PRODUCTION_DB_NOT_RUN`은 loopback을 읽었다는 뜻일 뿐이다. **이 파일에는 운영 데이터가 들어 있다.**

### S1. 프로젝트 (생성 완료, 일부 항목 미확인)

**프로젝트는 이미 있다.** 아래 값은 사용자가 대시보드에서 확인해 알려 준 것이며, 이 작업은 프로젝트에 연결하지 않았다. 저장소가 공개라 전체 ref와 조직 이름은 적지 않는다. S2 전에 대시보드와 대조한다.

| 항목 | 값 | 출처 |
|---|---|---|
| 프로젝트 ref | `kapd…mxdt` | 사용자 보고 |
| PostgreSQL | 17.11. 매트릭스의 `postgres:17`과 같은 버전 | 사용자 보고 |
| 리전 | Tokyo | 사용자 보고 |
| `carscope` 스키마, `carscope_app` 역할 | 없음 | 사용자 보고 |
| `carscope_private` 스키마 | 있음. 객체 0개, 소유자 `postgres`. `anon`, `authenticated`, `service_role` 접근 차단 | 사용자 보고 |

**운영 스키마는 `carscope`다. 기존 `carscope_private`는 쓰지 않고 그대로 둔다.** 재사용하거나 지우는 SQL을 만들지 않는다. `carscope_private`를 `CARSCOPE_DB_SCHEMA`에 넣지 않는다. 격리 테스트는 같은 이름의 빈 스키마가 전체 이전 뒤에도 소유자와 객체 0개 그대로이고 앱 역할이 접근하지 못함을 확인한다.

남은 확인 (전부 NOT_VERIFIED):

- [ ] **AICS_Web과 다른 프로젝트**이고 조직과 ref를 두 번 확인했다
- [ ] 플랜과 비용, Free 플랜이면 일시 중지 조건
- [ ] Settings에서 **SSL 강제 켜기.** 문서상 재부팅이 있으나 객체가 없는 지금이 영향이 작다. **운영 변경이므로 승인 후 실행**
- [ ] Server root certificate를 내려받아 `C:\CarScope-External\p9-a4\`에 둔다
- [ ] Data API Exposed schemas에 `carscope`가 **없다**
- [ ] Render DB 메이저 버전이 17 이하다. 새 서버로만 복원할 수 있다. Render 버전은 G3의 `database`로 확인한다
- [ ] 비밀번호와 연결 문자열을 Git·채팅·로그에 넣지 않는다

### S2. 역할 생성

**아직 실행하지 않았다. `carscope_app`은 없다.** 관리 역할이 superuser라고 가정하지 않는다. 문서는 `postgres`가 관리자 권한이라고만 하고 superuser 여부와 `CREATEROLE`은 NOT_STATED다.

#### 권한 전제

`supabase-bootstrap.sql`이 요구하는 것은 superuser가 아니라 다음 두 가지다. PostgreSQL 16·17에서 비 superuser 관리 역할로 시험했다(로컬 대역).

| 관리 역할의 상태 | 결과 | 시험 |
|---|---|---|
| `CREATEROLE` + DB 소유자 | **성공.** 역할 생성, search_path, 비밀번호, 임시 권한, 회수까지 동작 | PASS |
| `CREATEROLE` + DB의 CREATE, **grant option 없음** | PostgreSQL은 오류가 아니라 경고 `no privileges were granted`만 낸다. **스크립트가 직접 확인해 중단하고 전체 롤백** | PASS. 수정 전에는 조용히 성공할 경로였다 |
| `CREATEROLE`, PUBLIC 권한만 | 위와 같다. 모든 역할이 PUBLIC으로 `CONNECT`를 가져 42501이 아니라 **경고만** 나온다. 스크립트가 중단하고 전체 롤백 | PASS |
| `CREATEROLE` 없음 | 42501, 전체 롤백 | PASS |

`carscope_private`의 소유자가 `postgres`라는 사실은 `postgres`가 스키마를 만들 수 있음을 시사할 뿐, 그 권한을 **남에게 줄 수 있음**(grant option)을 뜻하지 않는다. DB 소유자가 누구인지는 **NOT_VERIFIED**이므로 먼저 읽기 전용으로 확인한다.

```powershell
# 관리자 연결. S2 승인 후. 읽기만 한다. psql이 없으면 postgres:17 이미지를 쓴다
psql "sslmode=verify-full sslrootcert=C:\CarScope-External\p9-a4\prod-ca.crt host=<pooler host> port=5432 dbname=postgres user=postgres.<ref>" -f tools\inspection-sync-poc\preflight\supabase-s2-premise-check.sql
```

| 열 | 합격 | 아니면 |
|---|---|---|
| `can_create_roles` | `t` | **멈춘다** |
| `can_grant_create_on_database` | `t` | **멈춘다.** 아래 대안 참조 |
| `server_major` | `17` | 멈춘다. 예상과 다른 프로젝트일 수 있다 |
| `carscope_schema_absent`, `carscope_app_absent` | `t` | 멈춘다. 이미 실행됐거나 다른 프로젝트다 |
| `connection_uses_tls` | `t` | 멈춘다 |
| `is_superuser`, `database_owner` | 기록만 | 합격 조건이 아니다 |

**전제가 맞지 않을 때:** 권한을 넓히거나 플랫폼 역할을 변경하지 않는다. 대안은 관리 역할이 `CREATE SCHEMA carscope AUTHORIZATION carscope_app`으로 스키마를 먼저 만들고 복원 목록에서 스키마 항목을 빼는 것이다(DB 권한을 앱 역할에 주지 않는다). **이 대안은 구현·시험하지 않았다(NOT_RUN).** 별도로 검증한 뒤 쓴다.

Supabase에서만 확인되는 것(NOT_VERIFIED): 플랫폼의 이벤트 트리거가 새 역할과 스키마에 관여하는지, 새 역할이 Shared Pooler(`carscope_app.<ref>`)로 바로 인증되는지.

#### 실행

전제가 모두 맞으면 S2 승인 후 실행한다. 단일 트랜잭션이므로 실패하면 남는 것이 없다.

```powershell
psql "<위와 같은 관리자 연결>" -v ON_ERROR_STOP=1 -f tools\inspection-sync-poc\preflight\supabase-bootstrap.sql
# 같은 연결에서 \password carscope_app
```

### S3. 데이터 이전 (별도 승인)

**`db-recovery restore`는 이 단계에 쓰지 못한다.** 일부러 그렇게 두었으며 우회하지 않는다. 운영자가 `pg_restore`를 직접 실행한다. 쓰는 대상은 `carscope_app`이 만든 `carscope` 스키마뿐이다.

- [ ] 사용자의 S3 승인, 이번 아카이브 SHA-256 기록
- [ ] 최신 G3 리허설 `G3_REHEARSAL_VERIFIED`
- [ ] 대상 프로젝트 ref를 대시보드와 대조
- [ ] 대상에 `carscope` 스키마가 없다. `carscope_private`는 건드리지 않는다

```powershell
$secure = Read-Host -AsSecureString
$env:PGPASSWORD = [Net.NetworkCredential]::new('', $secure).Password
pg_restore --host <pooler host> --port 5432 --username carscope_app.<ref> --dbname postgres --exit-on-error --single-transaction --no-owner --no-privileges $out\migration.dump
Remove-Item Env:PGPASSWORD; Remove-Variable secure
# 관리자 연결로 실행
psql "<S2와 같은 관리자 연결>" -v ON_ERROR_STOP=1 -f tools\inspection-sync-poc\preflight\supabase-post-restore.sql
```

`pg_restore`는 `PGSSLMODE=verify-full`, `PGSSLROOTCERT`를 함께 설정한다. 실패하면 단일 트랜잭션이므로 객체가 남지 않는다. 관리 스키마를 내려받거나 덮어쓰는 단계가 없다.

읽기 전용 검증:

```powershell
$env:CARSCOPE_DB_CA = [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\CarScope-External\p9-a4\prod-ca.crt'))
$secure = Read-Host -AsSecureString
$env:CARSCOPE_S3_TARGET = [Net.NetworkCredential]::new('', $secure).Password   # carscope_app의 Session Pooler URL. 쿼리 없이
node bin/db-recovery.mjs compare --archive $out\migration.dump --url-env CARSCOPE_S3_TARGET --schema carscope --ca-env CARSCOPE_DB_CA --allow-remote-read-only --approved-on <오늘 UTC YYYY-MM-DD>
Remove-Item Env:CARSCOPE_S3_TARGET; Remove-Variable secure
```

| 합격 | 뜻 |
|---|---|
| `VERIFY_STRUCTURE`, `VERIFY_ROW_COUNTS`, `VERIFY_ROW_DIGESTS` PASS | 아카이브와 일치 |
| `COMPARE_DB_TLS_IN_USE` PASS | 전체 검증된 TLS로 연결 |
| `COMPARE_DB_PRIVATE_SCHEMA`, `COMPARE_DB_PUBLIC_HOLDS_NO_CARSCOPE` PASS | 전용 스키마로 해석 |
| `COMPARE_DB_API_ROLES_DENIED` PASS | **MANUAL이면 멈춘다.** 역할이 없다는 뜻이고 예상과 다른 프로젝트일 수 있다 |
| `COMPARE_DB_ROLE_ATTRIBUTES`, `COMPARE_DB_STARTUP_PRIVILEGE` PASS | 최소 권한, 시작 가능 |

이어서 대시보드 Table Editor와 API Docs에 CarScope 테이블이 없음을 확인한다. Data API 설정은 PostgreSQL에서 보이지 않는다.

## Render 전환 Runbook

**S4는 운영 변경이다. 승인 전에 실행하지 않는다.**

### 전환 전

- [ ] 사용자의 S4 승인, 시간대 결정
- [ ] 이 PR이 포함된 커밋이 Render에 배포되어 `/healthz`가 정상. **먼저 확인 (현재 NOT_VERIFIED):** 지금 `DATABASE_URL` 호스트에 점이 없다(대시보드에서 값을 보지 않고 Internal URL인지만 확인). 점이 있으면 이 코드는 시작을 거부하므로 전환 코드 배포를 멈춘다
- [ ] Auto-Deploy Off (**현재 NOT_VERIFIED**)
- [ ] S3 비교 PASS, 최신 아카이브 SHA 기록
- [ ] 현재 Render `DATABASE_URL`을 비밀 저장소에 보관. **롤백에 필요하다**
- [ ] Render Free DB면 만료일까지 롤백할 시간이 남았다
- [ ] 시뮬레이터 모드 없음. 다른 변수를 함께 바꾸지 않는다

### 전환

1. 서비스를 멈춘다(Suspend). **최종 백업이 일관되도록 쓰기를 멈추는 단계다.** QR 사용자가 없는 시간에 한다.
2. G3 절차로 최종 백업 → S0 → S3. 대상을 다시 만들 때는 `carscope` 스키마를 지우는 것이 **운영 데이터 삭제에 해당하므로** 별도로 확인한다. 첫 S3가 충분히 최근이고 쓰기가 없었음을 행 수로 확인했다면 생략 여부를 사용자가 정한다.
3. Render Environment에서 함께 변경한다. Save 화면의 재배포 옵션이 어떤 커밋을 배포하는지 확인한다.

   | 변수 | 값 |
   |---|---|
   | `DATABASE_URL` | `postgresql://carscope_app.<ref>:<비밀번호>@<pooler host>:5432/postgres`. 쿼리 없음 |
   | `CARSCOPE_DB_SCHEMA` | `carscope` |
   | `CARSCOPE_DB_CA_PEM_BASE64` | S3의 Base64 값 |

4. 재배포한다. 시작할 때 CA 검증과 스키마 확인이 끝나야 서비스를 연다.

### 상태 점검

```powershell
node bin/deployment-preflight.mjs probe --origin https://carscope-lluo.onrender.com
node bin/deployment-preflight.mjs render --deployed-commit <SHA> --target-commit <SHA> --auto-deploy off --env-names-file C:\CarScope-External\render-env-names.txt
```

| # | 합격 |
|---|---|
| 1 | `/healthz`: `STATEFUL_DENY_DEFAULT`, `DENIED`, `historyRead` 없음 |
| 2 | `RENDER_ENV_NAMES` PASS. 두 변수가 함께 있다 |
| 3 | (G2 승인 시) `probe --approve-rate-window-writes`: records 403, session 401, 생성 403 |
| 4 | Render 로그에 `RENDER_STATEFUL_CONFIGURATION_FAILED` 없음 |
| 5 | `compare`는 전환 뒤 쓰기로 `cs_rate_windows`가 달라질 수 있다. 다른 테이블로 판단한다 |
| 6 | Supabase 연결 수가 한도 안이다. 문서는 등급별 한도를 이 범위에 적지 않아 대시보드에서 본다 |
| 7 | 이후 QR E2E는 [P9 C2~C6](p9-e2e-checklist.md#c-서버와-세션-단계)와 G5~G9. enrollment는 `CARSCOPE_DB_SCHEMA`, `CARSCOPE_DB_CA_PEM_BASE64`를 함께 설정해 발급한다 |

### 롤백

| 시점 | 조치 |
|---|---|
| S4 3번 전 | 서비스를 다시 켠다. 변경 없음 |
| 재배포 실패, `/healthz` 실패 | `DATABASE_URL`을 보관한 값으로 되돌리고 **`CARSCOPE_DB_SCHEMA`, `CARSCOPE_DB_CA_PEM_BASE64`를 제거**한 뒤 재배포. Render DB는 전환 중 쓰지 않았으므로 데이터 손실이 없다 |
| 전환 후 쓰기가 있었던 뒤 | 같은 조치. **그 사이 Supabase에 쓰인 세션과 점검 기록은 Render에 없다.** 롤백 전에 Supabase를 읽기 전용으로 백업하고, 옮길지는 별도 판단한다. 자동 동기화 도구는 없다 |
| Pooler 인증서 검증 실패 | 시작 거부가 정상이다. **검증을 끄거나 `NODE_TLS_REJECT_UNAUTHORIZED`를 쓰지 않는다.** 서버가 그 값을 거부한다. CA 파일과 끝점을 확인하고 안 되면 롤백한다 |

- Render DB는 안정 기간이 지날 때까지 지우지 않는다. 삭제는 별도 승인이다.
- Supabase에서 `DROP`이 필요하면 프로젝트 ref를 확인하고 승인받는다.

## 남은 위험

- **Supavisor 미검증:** Session Pooler의 인증서, 사용자 이름, 연결 유지, 재시작 시 대기(문서상 Session mode는 최대 1분 대기)는 실제 프로젝트에서만 확인된다. 코드의 연결 대기는 5초라 대기가 길면 시작 실패나 503으로 보인다.
- **`pg_export_snapshot`:** 문서에 없다. 이 설계는 Supabase에서 백업하지 않으므로 전환 전에는 쓰지 않는다. 전환 후 Supabase를 `db-recovery backup`할 때는 NOT_VERIFIED다.
- **CA 회전:** `CARSCOPE_DB_CA_PEM_BASE64`가 낡으면 재시작 때 시작이 거부된다. 회전 일정은 NOT_STATED다.
- **Render 호스트 형식 가정:** Internal URL에 점이 없다는 것은 [P6-D2](p6-d2-postgres-store.md) 운영 절차와 일반적 형식에서 추정했고 운영 값을 보지 않았다.
- **로컬 대역의 한계:** `platform`은 역할과 기본 권한만 본뜬다. 실제 이벤트 트리거, 기본 권한, 플랫폼 확장은 다를 수 있다.
- **S2 전제:** 실제 관리 역할의 `CREATEROLE`과 DB grant option을 확인하지 못했다. 맞지 않으면 S2는 실패로 끝나고 대안은 미검증이다.
- **최소 권한 부족:** 런타임 역할이 자기 스키마의 DDL을 실행할 수 있다. migration을 시작 경로에서 분리하는 것은 별도 과제다.
- **재해 대비:** 이전 후 Supabase 플랜의 백업 범위는 확인하지 않았다.
