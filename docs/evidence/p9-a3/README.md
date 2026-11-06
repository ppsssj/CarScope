# P9-A3 database recovery readiness evidence index

## 판정

| 표식 | 상태 | 근거와 범위 |
|---|---|---|
| `LOCAL_BACKUP_RESTORE_PASS` | PASS (범위 한정) | 격리 PostgreSQL 16.15 + 합성 데이터. 운영 데이터의 복구 가능성을 증명하지 않는다 |
| `LOCAL_BACKUP_RESTORE_BLOCKED` | 해당 없음 | Docker Desktop이 꺼져 있어 실행해서 사용했다. 새로 설치한 소프트웨어는 없다. `postgres:16` 이미지는 내려받았다 |
| `PRODUCTION_DB_NOT_RUN` | NOT_RUN | 운영 DB 연결, 백업, 읽기 전용 검사 모두 없음 |
| `RENDER_DEPLOY_NOT_RUN` | NOT_RUN | 배포, 재시작, 환경변수 변경, 대시보드 확인 없음. 이번 작업에서 `/healthz`도 호출하지 않았다 |
| `READY_FOR_G3_APPROVAL` | 도구 조건 충족 | 승인 자체가 아니다. [G 체크리스트](../../p9-a3-db-recovery-readiness.md#g-운영-g3-실행-전-승인-체크리스트)의 운영자 확인 항목은 모두 남아 있다 |

enrollment, QR 세션, G2~G10은 실행하지 않았다.

## 환경

Windows 10, Node 22.16.0, Docker 29.8.1(Docker Desktop, WSL2). 서버와 클라이언트는 모두 `postgres:16`, `postgres@sha256:933463a6c8eba2b9f5cd414138738cd8d5519cd2c471214c222652f547a66a32`, 16.15. 포트는 `127.0.0.1`에만 공개했고 비밀번호는 실행마다 임의 생성했다. PC에 PostgreSQL 클라이언트는 없어 `--docker-image`로 실행했다. 실행 대부분의 코드 기준은 `main` `8e8c7e3` 위의 작업 트리이고, 작업 중 PR #86(`7a8494c`)이 병합되어 rebase했다. PR #86과 겹치는 파일은 `docs/roadmap.md`뿐이며 `tools/inspection-sync-poc`를 바꾸지 않는다. rebase 후에는 첫 행의 테스트만 다시 실행했다.

## 새 로컬 실행 (2026-11-06)

| 실행 | 결과 |
|---|---|
| `test/db-recovery*.test.mjs`, `7a8494c` 위로 rebase한 트리, 실제 `pg_dump`·`pg_restore` | 49 중 48 PASS / 1 SKIP / 0 FAIL. SKIP은 원격 경로 테스트이며 CI에서 실행한다 |
| `deployment-preflight regression` (rebase 전) | `REGRESSION_SYNC_HISTORY` pass=52. `REGRESSION_POSTGRES` pass=96 skipped=1 → **NOT_RUN**. skip은 원격 경로 테스트(`PG_REMOTE_SIM_URL` 없음)다 |
| `deployment-preflight database` (격리 DB) | FAIL 0, MANUAL 1 (`DB_LEAST_PRIVILEGE`: 일회용 DB의 superuser) |
| `npm run check` | PASS |
| `npm test` (`PG_TEST_URL` 없음) | 211 중 191 PASS / 20 SKIP / 0 FAIL. SKIP은 실제 PG 항목이며 PASS가 아니다 |
| `npm run test:legacy`, `test:sqlite` | 48, 21 PASS |
| `pg` 미설치 재현 (`db-recovery*` 두 파일) | 25 중 13 PASS / 12 SKIP / 0 FAIL |
| core, Android, 3D, geometry | 로컬 NOT_RUN. 이 PR은 `tools/inspection-sync-poc`, 문서, PG CI만 바꾼다. 아래 CI 참조 |

### Runbook 실행

[A~F](../../p9-a3-db-recovery-readiness.md#powershell-실행-절차)를 문서의 명령 그대로 새 컨테이너에서 실행했다. 합성 5 sessions, 17 records, 합계 9 tables, 35 rows.

| 단계 | 결과 |
|---|---|
| A 환경 | `pg_dump`·`pg_restore` 16.15, `static` FAIL 0 |
| B 격리 DB | `ISOLATED_DATABASES` PASS |
| C 백업 | 26168 bytes, SHA-256 `cd16328f1c5bfc4dd4d0f8bde3ed3d41fce5183b25fda09c6ec86af462a1d554`, `READ ONLY` |
| D 검사 | SHA 일치. `Get-FileHash`와 동일. CUSTOM, 9 tables, 16 constraints, 5 indexes |
| E 복원 | `RESTORE_APPLY` PASS. 반복 실행은 `target holds 28 objects: restore refused` (exit 1) |
| F 검증 | 구조·행 수·다이제스트·`VERIFY_STARTUP_DDL` PASS. `LOCAL_BACKUP_RESTORE_PASS` |
| F 게이트 | 이 보고서를 넣어도 `RENDER_BACKUP_READY` NOT_VERIFIED, `RENDER_RESTORE_REHEARSED` NOT_RUN |
| G `createdb` 한 줄 | 로컬 컨테이너에서만 실행. **G의 나머지는 NOT_RUN** |

## 시나리오

| 요구 | 테스트 | 합격 근거 |
|---|---|---|
| 클라이언트·서버 버전 | `version rules`, CLI `environment` | 구버전 클라이언트 FAIL, 미확인 BLOCKED, 16 외 MANUAL. 타 메이저 실제 서버는 실행하지 않았다 |
| 파일 무결성 | `damaged archives` | 잘림·일부 손상·쓰레기 파일 × 기록된 digest / 다시 계산한 digest 6종. 대상 비어 있음 |
| 구조·제약 복원 | `full rehearsal` | 구조 일치, FK·CHECK·PK 실제 거부, ON DELETE CASCADE 동작 |
| 세션·점검 기록 보존 | `full rehearsal` | 5개 세션과 17개 task 기록이 값까지 동일, 한글 유지. `store.get`으로 읽기 |
| 행 수 일치 | `full rehearsal` | 테이블별 행 수와 다이제스트. 행 삭제·수정·제약 삭제를 탐지 |
| 중복·비어 있지 않은 복원 차단 | `not empty` | 테이블·스키마·시퀀스·함수별 거부, 원본 대상 거부, 상태 불변 |
| 데이터 단계 실패 | `data phase` | COPY 도중 CHECK 위반. 전체 롤백, 대상 비어 있음 |
| 권한 부족 | `insufficient privileges` | 읽기 권한 없음(42501, 파일 없음), `pg_dump` 중단(임시 파일 삭제), CREATE 없음, `pg_restore` 내부 권한 오류(롤백), 비소유자 시작 불가 |
| 원본 보존 | 각 시나리오 끝 | 실패 후 원본 구조·다이제스트 동일 |
| 소유자·권한 비복제 | `source owners` | 비 superuser가 복원, 다른 역할에 권한이 넘어가지 않음 |
| 스키마 호환 | `schema compatibility` | History 이전 백업은 복사본에서 migration 후 기존 행 유지·backfill 없음·원본 미변경. 미래 버전은 복원되지만 검증 실패, migration 미실행 |
| 스냅샷 일관성 | `writer keeps` | 쓰기가 계속되는 중 백업해도 복원본이 manifest와 일치 |
| 실제 서버 | `full rehearsal` | 복원본에서 실제 CLI 기동: `STATEFUL_DENY_DEFAULT`, `DENIED`, records 403 |
| 운영 연결 차단 | `restore target`, `remote backup`, `refused operations` | 원격·이름·서비스 변수·Render 환경 거부. 클라이언트와 연결에 도달하지 않음 |
| 비밀 비노출 | `connection details`, `client stderr`, `CLI output`, `CLI end to end` | argv·stdout·stderr·manifest·보고서에 비밀번호, URL, 호스트, DB 이름 없음 |

샘플링한 시나리오의 통과이며 모든 실패 지점의 증명이 아니다.

## 변형 검사

Git 밖 복사본에 결함을 넣어 선택한 테스트의 검출 여부를 봤다. 선택한 조건만 대상이다.

- **첫 실행은 무효로 버렸다.** 38건 모두 KILLED였지만 `passed=0`이었다. 복사본에 `mobile-ar-poc` 일부가 빠져 모듈 로드에서 실패한 것이었고, 동등 변형까지 KILLED로 나와 드러났다. 대조군과 로드 실패 분리를 넣어 다시 실행했다.
- **유효 실행:** 대조군 17개 패턴 전부 OK. 38건 중 **37 KILLED, 1 SURVIVED**, INVALID 0.
- 생존 1건은 `--exit-on-error` 제거다. `--single-transaction`이 이를 포함하므로 사전에 동등 변형으로 예상했다.

## Render 사전 검사 (네트워크·DB 없음)

| 명령 | 결과 |
|---|---|
| `static` | PASS 10, MANUAL 1(`STARTUP_APPLIES_DDL`), BLOCKED 1(`PRODUCTION_AUTH_BLOCKED`), FAIL 0 |
| `compat` | PASS 3, NOT_VERIFIED 1 (`APK_GENERATION`: APK 미지정) |
| `render --target-commit 8e8c7e3…` | `RENDER_TARGET_COMMIT` PASS, `RENDER_TARGET_SERVER_CLOCK` MANUAL, 나머지 NOT_VERIFIED·NOT_RUN. 대시보드 값을 넣지 않았으므로 **배포 가능 판정이 아니다** |

`8e8c7e3`은 작성 시점의 origin/main이다. 이 PR의 병합 커밋이 아니므로 G4 때 다시 실행한다.

## 개발 중 발견

- 테스트가 찾은 결함: 시드의 `completedAt` 형식, `TABLE`이 `TABLE DATA`까지 매칭하던 목록 파서.
- CI가 찾은 테스트 결함: 첫 CI에서 4개 job이 같은 테스트 하나로 실패했다. 얕은 체크아웃에는 `origin/main`이 없는데 `git rev-parse`가 exit 128과 함께 인자를 stdout에 출력해 skip 조건을 통과했다. 게이트 코드가 아니라 테스트를 고쳤고, 전체 이력이 있는 `preflight-gates`에서 skip 없이 실행하도록 했다.
- 검토로 추가: 덤프 스트림 backpressure, 소유자·권한 비복제 테스트, 원격 경로 CI.
- 기존 위험 확인: 쓰기 권한 역할 없이는 복원본도 서버가 시작하지 못한다(P8-C1 사실 3 재현).

## CI

`f7c01d3` PR 실행, 11개 job 전부 PASS.

| job | 결과 | 범위 |
|---|---|---|
| [`postgres-integration`](https://github.com/ppsssj/CarScope/actions/runs/42173173009) | 기존 PG 스위트 PASS. 복구 테스트 49 중 48 PASS / 1 SKIP / 0 FAIL. 네이티브 `pg_dump`·`pg_restore` 16.15 | PG16 합성 데이터. SKIP은 얕은 체크아웃의 커밋 게이트 테스트이며 아래 job에서 실행 |
| 같은 job의 원격 경로 테스트 | PASS | 자체 서명 인증서의 일회용 컨테이너. **Render에 대한 증거가 아니다** |
| [`Preflight gates`](https://github.com/ppsssj/CarScope/actions/runs/42173173044) | `db-recovery.test.mjs` 14 PASS / 0 SKIP, 게이트 PASS | 네트워크·DB 없음 |
| Sync Ubuntu/Windows, Kotlin decoder, geometry, core, identity, tire, 3D 결과, WebXR | PASS | 각 job 범위. 브라우저·AVD·실차 결과가 아니다 |

GitGuardian은 첫 커밋 실행에서 PASS였고, `f7c01d3`의 체크 목록에는 나타나지 않았다.

원본 산출물은 작업 PC `C:\CarScope-External\p9-a3\20261106T055107Z`에 있으며 Git에 포함하지 않는다. 내용은 합성 데이터다. DB URL과 비밀번호는 기록하지 않는다. 절차는 [P9-A3 문서](../../p9-a3-db-recovery-readiness.md)를 따른다.
