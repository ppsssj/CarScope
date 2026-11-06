# P9-A3 PostgreSQL 백업·복원과 Render 배포 준비

실제 QR E2E 전에 필요한 백업·복원 도구와 절차를 준비했다. **운영 DB 접근, 운영 백업, Render 배포, enrollment 발급, QR 세션 생성은 하지 않았다.** G3과 G4는 별도 승인 대상이고, 이 문서의 승인 체크리스트를 통과하기 전에는 실행하지 않는다. 실행 근거는 [증거 인덱스](evidence/p9-a3/README.md)에 있다.

## 판정

| 표식 | 상태 | 범위 |
|---|---|---|
| `LOCAL_BACKUP_RESTORE_PASS` | PASS (범위 한정) | 격리 PostgreSQL 16 + 합성 데이터. 운영 데이터 복구 가능성의 증거가 아니다 |
| `PRODUCTION_DB_NOT_RUN` | NOT_RUN | 운영 DB에 연결하지 않았다 |
| `RENDER_DEPLOY_NOT_RUN` | NOT_RUN | 도구에 배포 명령이 없다 |
| `READY_FOR_G3_APPROVAL` | [G 체크리스트](#g-운영-g3-실행-전-승인-체크리스트)의 도구 항목 충족 | 승인 자체가 아니다. 운영자 확인 항목은 남아 있다 |

`LOCAL_BACKUP_RESTORE_BLOCKED`는 해당하지 않는다. Docker Desktop을 켜서 실행했다.

## 구조

복원은 쓰기이므로 "아무것도 쓰지 않는다"가 약속인 `deployment-preflight`에 넣지 않고 `bin/db-recovery.mjs`로 분리했다. `pg_dump`와 `pg_restore`를 실행하는 모듈은 `preflight/recovery.mjs` 하나다. 기존 `inspectDatabase`, `PostgreSQLSessionStore.open`, `assertOutsideRepository`를 재사용한다.

| 경계 | 동작 |
|---|---|
| 복원 대상 | loopback이고 DB 이름이 `carscope_rehearsal_`로 시작하며 `DATABASE_URL`·`PG_ADMIN_DATABASE_URL`과 다른 DB일 때만. Render 위에서는 거부. **넓히는 인자가 없다** |
| 비어 있지 않은 대상 | 테이블·시퀀스·스키마·함수·확장이 하나라도 있으면 거부. 중복 복원과 원본 복원도 여기서 막힌다 |
| 원격 백업 | `--allow-remote-read-only`와 오늘(UTC) 날짜의 `--g3-approved-on`이 함께 있어야 한다. 기록에 남은 명령을 다른 날 다시 실행하면 멈춘다 |
| 백업 읽기 전용 | 트랜잭션 `READ ONLY`, `pg_dump`는 `default_transaction_read_only=on` |
| 일관성 | 트랜잭션에서 내보낸 스냅샷을 `pg_dump --snapshot`이 사용한다. 쓰기가 계속되어도 manifest와 아카이브가 일치한다 |
| 무결성 | 복원 전에 SHA-256을 먼저 비교한다. `pg_restore --list`는 목차만 읽어 손상된 데이터를 볼 수 없다 |
| 복원 실패 | `--single-transaction`. 어느 단계에서 실패해도 대상은 비어 있고, 실패 후 다시 확인해 `RESTORE_ROLLED_BACK`으로 보고한다 |
| 비밀 | URL은 환경변수 이름으로만 받는다. 접속 정보는 자식 프로세스 환경으로만 넘기며 argv·출력·manifest·보고서에 넣지 않는다. 클라이언트 stderr는 고정 코드로 줄이고 버린다 |
| 파일 | 저장소 안에는 쓰지 않고 덮어쓰지 않는다. 실패한 덤프의 임시 파일은 지운다 |

`verify`는 구조(열·제약·인덱스·트리거·함수), 테이블별 행 수, 행 다이제스트를 manifest와 비교하고 `inspectDatabase`를 실행한다. `--startup-ddl`은 실제 서버 migration을 **복원본에** 실행하고 기존 행이 그대로인지 확인한다. G4가 운영에 할 일을 복사본에서 먼저 해 보는 것이다. 이 단계까지 통과해야 판정이 나온다.

복원 도구는 운영 DB를 복구하는 수단이 아니다. 실제 복구가 필요하면 [P8-C1](p8-c1-deployment-readiness.md#코드-롤백)대로 새 DB에 복원한 뒤 `DATABASE_URL` 전환을 별도 승인으로 검토한다. 이 CLI는 loopback 이외 대상에 복원하지 않으므로 그 절차를 대신하지 못한다.

## PowerShell 실행 절차

Windows PowerShell 5.1, 저장소 루트 기준이다. **A~F는 로컬 전용이고 운영에 닿지 않는다.** A~F는 이 문구 그대로 실행했다([증거](evidence/p9-a3/README.md#runbook-실행)). PostgreSQL 클라이언트가 PC에 없어도 Docker 이미지로 실행된다.

### A. 로컬 환경 확인

```powershell
Set-Location tools\inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
docker version --format '{{.Server.Version}}'     # 실패하면: docker desktop start
node bin/db-recovery.mjs environment --docker-image postgres:16
node bin/deployment-preflight.mjs static
```

합격: `CLIENT_PG_DUMP`, `CLIENT_PG_RESTORE` PASS. `static`의 FAIL 0.

### B. 격리 DB 생성

비밀번호는 이 터미널의 변수에만 둔다. 포트는 loopback에만 연다.

```powershell
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pw = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$env:POSTGRES_PASSWORD = $pw
docker run -d --name carscope-rehearsal-pg16 --memory 768m -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD -e POSTGRES_USER=carscope_rehearsal -e POSTGRES_DB=carscope_rehearsal_admin postgres:16
Remove-Item Env:POSTGRES_PASSWORD
do { Start-Sleep 1; docker exec carscope-rehearsal-pg16 pg_isready -h 127.0.0.1 -U carscope_rehearsal -d carscope_rehearsal_admin | Out-Null } until ($LASTEXITCODE -eq 0)

$base = "postgresql://carscope_rehearsal:$pw@127.0.0.1:55433"
$env:CARSCOPE_REHEARSAL_ADMIN = "$base/carscope_rehearsal_admin"
$env:CARSCOPE_REHEARSAL_SOURCE = "$base/carscope_rehearsal_local_source"
$env:CARSCOPE_REHEARSAL_TARGET = "$base/carscope_rehearsal_local_target"
$out = "C:\CarScope-External\p9-a3\$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
New-Item -ItemType Directory -Force $out | Out-Null

node bin/db-recovery.mjs create-isolated --admin-url-env CARSCOPE_REHEARSAL_ADMIN --name local
```

합격: `ISOLATED_DATABASES` PASS, `5 sessions, 17 records, synthetic`. 같은 이름의 DB가 있으면 멈춘다.

### C. 테스트 데이터 백업

```powershell
node bin/db-recovery.mjs environment --url-env CARSCOPE_REHEARSAL_SOURCE --docker-image postgres:16
node bin/db-recovery.mjs backup --source-url-env CARSCOPE_REHEARSAL_SOURCE --out $out\local.dump --docker-image postgres:16
```

합격: `BACKUP_READ_ONLY`, `BACKUP_ARCHIVE`, `BACKUP_SNAPSHOT_STATE` PASS. 결과는 `local.dump`, `local.dump.sha256`, `local.dump.manifest.json` 세 파일이다.

### D. 백업 파일 검사

DB에 연결하지 않는다.

```powershell
node bin/db-recovery.mjs inspect --archive $out\local.dump --docker-image postgres:16
(Get-FileHash -Algorithm SHA256 $out\local.dump).Hash.ToLower()
Get-Content $out\local.dump.sha256
```

합격: `ARCHIVE_SHA256`, `ARCHIVE_LIST` PASS. `Get-FileHash` 값이 `.sha256`과 같다.

### E. 별도 DB 복원

```powershell
node bin/db-recovery.mjs restore --archive $out\local.dump --target-url-env CARSCOPE_REHEARSAL_TARGET --docker-image postgres:16
```

합격: `RESTORE_TARGET_EMPTY`, `RESTORE_APPLY` PASS. 같은 명령을 다시 실행하면 `RESTORE_TARGET_EMPTY` FAIL로 **거부되는 것이 정상**이다.

### F. 복원본 검증

```powershell
node bin/db-recovery.mjs verify --archive $out\local.dump --target-url-env CARSCOPE_REHEARSAL_TARGET --startup-ddl --report $out\verify.json
node bin/deployment-preflight.mjs render --recovery-report $out\verify.json
```

합격: `VERIFY_STRUCTURE`, `VERIFY_ROW_COUNTS`, `VERIFY_ROW_DIGESTS`, `VERIFY_STARTUP_DDL` PASS, 마지막 줄 `LOCAL_BACKUP_RESTORE_PASS RENDER_DEPLOY_NOT_RUN PRODUCTION_DB_NOT_RUN`. `render`의 `RENDER_BACKUP_READY`는 **`NOT_VERIFIED`로 남는 것이 정상이다.** 합성 리허설은 운영 백업의 증거가 아니다.

정리. 컨테이너와 그 안의 합성 데이터만 지운다.

```powershell
docker rm -f carscope-rehearsal-pg16
Remove-Item Env:CARSCOPE_REHEARSAL_ADMIN,Env:CARSCOPE_REHEARSAL_SOURCE,Env:CARSCOPE_REHEARSAL_TARGET
Remove-Variable pw,base,bytes
```

### G. 운영 G3 실행 전 승인 체크리스트

**G3은 운영 DB를 읽고, 결과 파일에 세션 결과와 점검 기록이 들어간다. 아래를 모두 확인하고 사용자가 승인한 뒤에만 실행한다.**

도구 조건 (이 작업에서 준비):

- [x] 격리 환경 리허설 통과: `LOCAL_BACKUP_RESTORE_PASS`
- [x] 실패·부분 데이터·권한 오류 테스트 통과 ([증거](evidence/p9-a3/README.md))
- [x] 원격 경로를 일회용 TLS 서버에서 실행 (CI. Render 아님)

운영자 확인 (전부 NOT_VERIFIED):

- [ ] 사용자의 G3 승인을 이번 실행에 대해 받았다. 다른 게이트 승인으로 대신하지 않는다
- [ ] Render 대시보드에서 DB 플랜·만료일·External 접속 허용 범위를 확인했다. [P6-D2](p6-d2-postgres-store.md)는 Free DB의 30일 만료와 백업 부재를 기록한다
- [ ] 서버 메이저 버전을 확인했다. `postgres:16`보다 새 서버면 `pg_dump`가 거부한다. 이미지 태그를 올리면 CI 검증 범위를 벗어난다
- [ ] 저장 위치가 Git 밖이고 암호화·접근 제한이 되어 있다. Windows에서는 파일 모드가 적용되지 않으므로 폴더 권한으로 보호한다
- [ ] 백업 후 파일을 공유하지 않으며, 보관·삭제 시점을 정했다
- [ ] 격리 PostgreSQL을 B와 같이 준비했고 빈 DB `carscope_rehearsal_g3_target`을 만들었다

승인 후 명령. 승인 날짜를 **직접 입력**한다. 계산해서 넣으면 날짜 게이트의 의미가 없어진다.

```powershell
# 1. External URL을 터미널 기록에 남기지 않는다
$secure = Read-Host -AsSecureString
$env:CARSCOPE_G3_SOURCE = [Net.NetworkCredential]::new('', $secure).Password
node bin/deployment-preflight.mjs database --url-env CARSCOPE_G3_SOURCE --allow-remote-read-only
node bin/db-recovery.mjs backup --source-url-env CARSCOPE_G3_SOURCE --out $out\g3.dump --docker-image postgres:16 --allow-remote-read-only --g3-approved-on <오늘 UTC YYYY-MM-DD>
Remove-Item Env:CARSCOPE_G3_SOURCE; Remove-Variable secure

# 2. 격리 DB에 복원하고 migration까지 복사본에서 실행. 운영 DB에는 쓰지 않는다
docker exec carscope-rehearsal-pg16 createdb -U carscope_rehearsal carscope_rehearsal_g3_target
$env:CARSCOPE_REHEARSAL_TARGET = "$base/carscope_rehearsal_g3_target"
node bin/db-recovery.mjs inspect --archive $out\g3.dump --docker-image postgres:16
node bin/db-recovery.mjs restore --archive $out\g3.dump --target-url-env CARSCOPE_REHEARSAL_TARGET --docker-image postgres:16
node bin/db-recovery.mjs verify --archive $out\g3.dump --target-url-env CARSCOPE_REHEARSAL_TARGET --startup-ddl --report $out\g3-verify.json
```

합격: 마지막 줄의 `G3_REHEARSAL_VERIFIED`. `BACKUP_TLS_IDENTITY` MANUAL은 `sslmode=require`가 암호화만 하고 서버를 인증하지 않는다는 뜻이다. Render DB의 CA를 얻을 수 있으면 URL에 `?sslmode=verify-full`을 붙인다(이 경로는 **신뢰하지 않는 인증서를 거부하는 것만** 확인했고 Render에서 실행하지 않았다). 연결 풀러 뒤에서는 스냅샷 공유가 실패할 수 있으며, 그 경우 파일을 남기지 않고 실패한다(NOT_VERIFIED).

**읽기 전용 검사의 주의:** `database --allow-remote-read-only`에 쓰는 기존 코드는 URL의 SSL 설정을 드라이버에 맡긴다. External URL에 TLS가 강제되면 `?sslmode=require`가 필요할 수 있다(NOT_VERIFIED). 실패해도 쓰기는 없다.

### H. Render G4 배포 전 승인 체크리스트

**G4는 배포이자 migration이다.** 서버가 시작하면서 base·History DDL을 `DATABASE_URL`에 적용한다([P8-C1 사실 1](p8-c1-deployment-readiness.md#배포-전에-알아야-할-사실)). 백업 검증(G3)이 끝나기 전에는 진행하지 않는다.

```powershell
# 네트워크와 DB를 쓰지 않는다. 값은 대시보드에서 관찰해 입력한다
git fetch origin
node bin/deployment-preflight.mjs static
node bin/deployment-preflight.mjs compat --apk <설치한 APK>
node bin/deployment-preflight.mjs render --deployed-commit <대시보드의 배포 커밋> --target-commit <배포할 커밋> --auto-deploy off --env-names-file C:\CarScope-External\render-env-names.txt --recovery-report $out\g3-verify.json
```

| # | 확인 | 게이트 | 합격 |
|---|---|---|---|
| H1 | 사용자의 G4 승인 | 사람 | 이번 배포 커밋에 대한 승인 |
| H2 | 현재 main과 배포 대상 구분 | `RENDER_TARGET_COMMIT` | PASS, 또는 MANUAL이면 뒤처진 이유를 설명할 수 있음. main 밖이면 FAIL |
| H3 | 현재 배포 커밋 | `RENDER_COMMIT_MATCHES_MAIN` | 대시보드 Events에서 읽은 값. P9-A4 포함 커밋을 배포하면 `DATABASE_URL` 호스트에 점이 없어야 한다([이유](p9-a4-supabase-migration.md#코드-수정)) |
| H4 | DDL 변화 | `RENDER_TARGET_DDL_DELTA`, `DDL_ADDITIVE`, `STARTUP_APPLIES_DDL` | 차이나는 파일을 설명할 수 있음. 비가산 문장 없음 |
| H5 | Auto-Deploy | `RENDER_AUTO_DEPLOY` | Settings > Build & Deploy에서 Off 직접 확인. 켜져 있으면 FAIL |
| H6 | 환경변수 이름 | `RENDER_ENV_NAMES` | `DATABASE_URL`, `NODE_VERSION` 있음. `SYNC_*` 등 거부 변수 없음. **`CARSCOPE_AVD_SIMULATOR_MODE`를 함께 넣지 않는다** |
| H7 | `DATABASE_URL` 전제 | 사람 | Internal URL, secret, 쿼리 문자열 없음. 쿼리가 있으면 서버가 시작을 거부한다 |
| H8 | 런타임 권한 | `DB_STARTUP_PRIVILEGE` (G3의 `database`) | PASS. 서비스 역할이 스키마 CREATE와 테이블 소유권을 가져야 시작한다 |
| H9 | 백업 | `RENDER_BACKUP_READY`, `RENDER_RESTORE_REHEARSED` | 둘 다 MANUAL(운영자 파일). `NOT_VERIFIED`·`NOT_RUN`·FAIL이면 진행하지 않는다. 합성 리허설 보고서와 24시간 넘은 백업은 통과하지 못한다 |
| H10 | `serverNow` 호환 | `SERVER_NOW_CONTRACT`, `RENDER_TARGET_SERVER_CLOCK` | PASS, MANUAL 내용 확인 |
| H11 | DENY_DEFAULT | `HISTORY_DENY_DEFAULT`, `RENDER_BOOTSTRAP_DENY_DEFAULT`, `ENV_CANNOT_ENABLE_AUTH` | PASS. 복원본 위 실제 CLI에서도 `STATEFUL_DENY_DEFAULT`, `DENIED`, records 403 확인 |
| H12 | APK 호환 | `APK_GENERATION`, `DECODER_SERVER_MATRIX` | 모든 기기가 `NEW_DECODER`. 구버전이 남아 있으면 `INVALID`로 실패하므로 **APK 먼저, 서버 나중** |
| H13 | 실패 복구 | 아래 표 | 담당자가 절차를 읽었다 |

#### 배포 실패 시 복구

[P8-C1 실패 대응](p8-c1-deployment-readiness.md#실패-대응)을 따른다. 요점은 다음과 같다.

| 상황 | 조치 |
|---|---|
| `RENDER_STATEFUL_CONFIGURATION_FAILED`, health 실패 | 이전 인스턴스 유지 여부를 대시보드에서 확인한다. 환경변수 이름과 읽기 전용 `database`로 원인을 좁힌다. DDL 실패는 트랜잭션 단위로 롤백된다 |
| 코드 문제 | Rollback 또는 이전 커밋 Manual Deploy. **DB는 복원하지 않는다.** DDL은 추가만 하므로 이전 코드가 무시한다 |
| 데이터 손상 확인 | 별도 승인. 운영 DB에 덮어쓰지 않고 새 DB에 복원한 뒤 `DATABASE_URL` 전환을 검토한다. 백업 이후 기록은 사라진다 |
| DROP, 버전 행 수정 | 하지 않는다 |

## CI

`postgres-store-ci.yml`의 기존 `postgres:16` 서비스를 재사용해 `test/db-recovery*.test.mjs`를 `PG_RECOVERY_REQUIRED=1`로 실행한다. 클라이언트가 없으면 skip이 아니라 실패한다. 원격 경로용 일회용 TLS 컨테이너를 추가로 띄운다. `PG_TEST_URL`이 없는 다른 CI에서는 skip이고 PASS로 세지 않는다. `deployment-preflight regression`의 PG 묶음에도 포함했다.

CI 성공은 해당 job 범위에 한정한다. Render·운영 DB·기기 결과가 아니다.

## 남은 위험

- **합성 데이터의 한계:** 운영 DB의 크기, 확장, 역할, 플랜 제약은 알 수 없다. 큰 덤프의 소요 시간과 메모리는 측정하지 않았다. `captureState`의 테이블별 집계는 120초로 제한되며, 넘으면 파일을 남기지 않고 실패한다.
- **다이제스트 범위:** 행 내용은 비교하지만 테이블 물리 순서, 통계, 소유자, 권한은 비교하지 않는다. 소유자와 권한은 의도적으로 복원하지 않는다. 시퀀스는 존재만 비교하고 현재 값은 비교하지 않는다. 현재 CarScope 스키마에는 시퀀스가 없다.
- **보고서 신뢰:** `--recovery-report`는 운영자가 넘기는 파일이라 도구가 인증할 수 없다. 그래서 PASS가 아니라 MANUAL이다. 24시간 기준은 제안 값이며 측정으로 정한 값이 아니다.
- **Docker 클라이언트 경로:** Windows Docker Desktop에서 실행했다. Linux 기본 Docker의 `host-gateway`는 실행하지 않았다(CI는 네이티브 클라이언트를 쓴다).
- **PR 병합과 Render:** 이 PR은 런타임 코드(`src/`)와 DDL을 바꾸지 않는다. 그래도 Auto-Deploy가 켜져 있으면 main 병합이 배포로 이어지므로 H5를 먼저 확인한다.
