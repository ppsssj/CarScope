# P9-A4 Supabase migration preflight evidence index

## 판정

| 표식 | 상태 | 근거와 범위 |
|---|---|---|
| `SUPABASE_PREFLIGHT_LOCAL_PASS` | PASS (범위 한정) | Docker PostgreSQL 16.15·17.11, 합성 데이터, 로컬 대역. Supabase의 동작을 증명하지 않는다 |
| 변형 검사 | **CI에서 완주** | 32건: 31 KILLED, 1 예상 동등 변형. 아래 참조 |
| `S2_ROLE_NOT_CREATED` | NOT_RUN | `carscope_app` 없음. 운영 Supabase에 SQL을 실행하지 않았다 |
| Render Auto-Deploy, 운영 `DATABASE_URL` 호스트 형식 | **NOT_VERIFIED** | 사용자 확인 전까지 유지 |
| `SUPABASE_CONNECTION_NOT_RUN` | NOT_RUN | 프로젝트는 사용자가 만들었다(S1). 이 작업은 연결하지 않았다. 인증서, Supavisor, Data API 미관찰 |
| `SUPABASE_DATA_MIGRATION_NOT_RUN` | NOT_RUN | S2~S4 미실행. AICS_Web 접근 없음 |
| `PRODUCTION_DB_NOT_RUN` | NOT_RUN | Render 운영 DB 접근·백업 없음 |
| `RENDER_DEPLOY_NOT_RUN` | NOT_RUN | 배포, 환경변수 변경, 대시보드 확인 없음. `/healthz`도 호출하지 않았다 |

Supabase 사실은 공식 문서를 읽은 것이며 실행 근거가 아니다(2026-11-06, connecting-to-postgres, psql, ssl-enforcement, using-custom-schemas, migrating-to-supabase/postgres, postgres/roles, supavisor-faq).

## 환경

Windows 10, Node 22.16.0, Docker 29.8.1. `postgres:16` `sha256:933463a6…a66a32`(16.15), `postgres:17` `sha256:748a18a5…04a6b3`(17.11). 서버는 일회용 CA의 TLS를 켜고, 한 역할은 TLS 없이 거부한다. 기준은 `main` `fa1ea94` 위의 작업 트리다.

## 요구별 실행

`npm run test:pg-matrix`로 16과 17에 같은 스위트를 실행했다. 합성 데이터만 사용했다.

| 요구 | 테스트 | 합격 근거 |
|---|---|---|
| 1. 빈 DB 초기화, 2. 스키마 적용 | 회귀, `private schema` | 세 스키마 파일 적용. 재적용은 무변경 |
| 3. 합성 기록과 세션 | 시드, QR v2 | 세션 5, 기록 17 + 실제 HTTP 흐름의 세션과 기록 |
| 4. 서버 재시작 | `QR v2 through the real server` | 제출 후 정지·재시작에도 `RESULT_SUBMITTED` 유지, 잘못된 digest 409, Accept 뒤 재시작에도 `ACCEPTED` |
| 5. 스키마 권한 | `anon, authenticated and service_role`, `gates fail when` | 각 역할로 실제 쿼리 42501, 대조군으로 같은 역할의 `public` 접근 성공. 앱 역할은 `auth`·`public`·`CREATE ROLE` 42501 |
| 6. 읽기·쓰기, QR v2 회귀 | 회귀, QR v2 | 시뮬레이터 모드의 provision→생성→claim→제출→Accept. `AVD_SIMULATOR`, 소유자 없음, records 403 |
| 7. 백업·복원 | `migrationArchive`, `relocated copy`, 교차 버전 | 1차 백업→복원→이동→2차 백업→복원·검증 |
| 8. 행 수·다이제스트 | `compare`, `gates fail when` | 전용 스키마 범위로 일치. 행 하나를 바꾸면 FAIL |
| 9. 연결 중단·복구 | `outage`, `backend killed` | `docker stop`에 503, 프로세스 유지, 새 인스턴스 시작 거부. `docker start` 뒤 재시작 없이 200, 세션 유지, Accept 성공 |
| TLS | `TLS: a pinned` | 올바른 CA로 시작하고 `pg_stat_ssl` true. 틀린 CA, 인증서에 없는 호스트, CA 없는 평문은 exit 1 |
| 스키마 fail-closed | `fail closed`, `drifts` | 틀린 search_path는 DDL 전 거부. 대조군으로 가드 없이는 `public`에 생성됨을 확인. 운영 중 변경은 503 |
| 인증 유지 | `DENY_DEFAULT is unchanged`, `environment gates` | `DENIED`, records 403, 생성 403, provision 404. 새 모듈에 인증 판단 없음 |

## 결과

| 실행 | 결과 |
|---|---|
| 매트릭스 | 최종 수치는 CI 절과 PR 체크를 따른다. 로컬은 메모리 제한으로 영향받은 테스트만 컨테이너 1개로 실행했다 |
| `npm test` (`PG_TEST_URL` 없음) | 230 중 200 PASS / 30 SKIP / 0 FAIL. SKIP은 실제 PG 항목이다 |
| `npm run check` | PASS |
| S0 CLI (로컬, 합성) | `relocate` 9 tables, 35 rows `unchanged`. 2차 아카이브 26601 bytes. `inspect` PASS, `compare`의 구조·행 수·다이제스트 PASS |
| 같은 `compare`의 게이트 | `COMPARE_DB_ROLE_ATTRIBUTES` **FAIL** (일회용 superuser로 접속해서 나온 정상 탐지), `COMPARE_DB_API_ROLES_DENIED` MANUAL (로컬에 역할 없음). 실제 역할 경로는 테스트가 다룬다 |
| S2·S3 SQL | 로컬 대역에서 비 superuser 관리자로 실행. **실제 Supabase에서는 NOT_RUN** |
| `verify-full`이 쓰는 CA 경로의 Pooler 검증 | NOT_RUN |

## 변형 검사

`test/run-mutations.mjs`가 CI의 일회용 PostgreSQL 17에서 결함을 하나씩 넣어 순차 실행한다. 선택한 조건만 대상이며 완전성의 증명이 아니다.

| 실행 | 결과 |
|---|---|
| 로컬 1차 | 메모리 부족으로 시스템이 중단. 30건 중 2건 실행 후 재시작하지 않았다. 이후 격리 CI로 옮겼다 |
| CI 1차 (`54c83bc`) | 무효 처리. 새 S2 테스트 2건의 대조군이 실패했고, `pass=-1`, `pass=0 fail=0`처럼 시간 초과·취소가 KILLED로 집계됐다 |
| [CI 유효 실행 (`676f778`)](https://github.com/ppsssj/CarScope/actions/runs/42194984214) | 대조군 16개 패턴 OK. **32건: 31 KILLED, 1 EQUIVALENT**, SURVIVED·TIMEOUT·INVALID·NOT_APPLIED 0. 전부 assertion 실패로 잡혔다 |

KILLED는 이제 실패한 테스트가 있어야 하며, 시간 초과는 TIMEOUT으로 따로 세어 job을 실패시킨다. 동등 변형은 `relocate`의 행 비교 제거다. `ALTER TABLE SET SCHEMA`는 행을 바꿀 수 없어 테스트로 도달할 수 없다. 이 비교는 방어 코드로 남겼으며 **동작이 검증된 것은 아니다.**

PG 16에서는 변형 검사를 실행하지 않았다. P9-A3의 38건은 이번에 다시 실행하지 않았다.

## S2 권한 전제

**운영 Supabase에 연결하거나 SQL을 실행하지 않았다.** 비 superuser 관리 역할을 로컬 PostgreSQL 16·17에서 시험했다. 실제 관리 역할의 속성은 NOT_VERIFIED다.

| 관리 역할 | 결과 |
|---|---|
| `CREATEROLE` + DB 소유자 | 성공. 역할 속성, search_path, 비밀번호, 복원, 회수, 스키마 소유자 확인 |
| `CREATEROLE` + DB CREATE, grant option 없음 | PostgreSQL은 경고만 낸다. 스크립트가 P0001로 중단, 역할 롤백 |
| `CREATEROLE` + PUBLIC 권한만 | 같은 경고. P0001로 중단, 역할 롤백 |
| `CREATEROLE` 없음 | 42501, 롤백 |

`supabase-s2-premise-check.sql`은 SELECT 하나이며 위 경우를 미리 구분한다. 변형 검사가 grant 확인 제거와 전제 검사의 grant option 누락을 모두 잡았다. **대안 경로(관리 역할이 스키마를 먼저 생성)는 NOT_RUN이다.**

`carscope_private`는 로컬 대역에 같은 이름의 빈 스키마를 두어 시험했다. 전체 이전 뒤에도 소유자와 객체 0개가 그대로이고 앱·API 역할이 접근하지 못한다. 운영자 SQL 어디에도 이 이름과 `DROP`이 없음을 테스트가 고정한다.

## 개발 중 찾은 결함

| 결함 | 찾은 방법 | 조치 |
|---|---|---|
| Supabase에 평문 연결 시도 | 코드 조사 | CA 고정 |
| 트랜잭션 중 연결이 끊기면 프로세스 종료 (`Connection terminated unexpectedly`) | 수정 전에 테스트로 재현 | 오류 리스너, 끊긴 클라이언트 폐기 |
| `supabase-post-restore.sql`의 `REVOKE`가 42501로 실패 | 비 superuser 대역 실행 | 문장 제거. 실제 S3에서 복원 후 드러났을 문제 |
| 스키마가 없으면 게이트 전체 중단 | 대조군 테스트 | 부재를 FAIL·NOT_RUN으로 보고 |
| P9-A3 테스트의 16 하드코딩 | PG 17 실행 | 서버 버전과 비교 |
| 매트릭스의 임의 포트가 재시작 때 바뀌어 복구 실패처럼 보임 | 실행 | 고정 포트. 제품 결함 아님 |
| `GRANT`가 grant option 없이 경고만 내어 S2가 성공한 것처럼 보임 | 권한 전제 점검 | 스크립트가 직접 확인 후 롤백. 복원 단계에서야 드러났을 문제 |
| 시험 정리가 실패를 삼켜 역할과 DB가 다음 테스트로 남음. DB 중단 뒤 프로세스가 끝나지 않음 | CI 시간 초과, 로컬 재현 | 새 연결로 정리. 제품 결함 아님 |
| 변형 검사가 시간 초과를 KILLED로 집계 | 결과 검토 | TIMEOUT 분리, 종료 대기에 시한 |

## CI

최종 결과는 [PR #88](https://github.com/ppsssj/CarScope/pull/88) 체크를 따른다. `pg-matrix`와 `mutation-check`는 Docker PostgreSQL 합성 범위이고 `PG_MATRIX_BIND=0.0.0.0`으로 Linux 게이트웨이를 사용한다. Supabase·Render·기기 결과가 아니다.

`REGRESSION_POSTGRES`는 16·17 모두 pass=96 skipped=1로 **NOT_RUN** 표기다. skip은 원격 경로 테스트로, `postgres-integration` job이 PG 16에서만 실행한다. **원격 경로의 PG 17 실행은 없다.**

원본 로그와 합성 산출물은 작업 PC `C:\CarScope-External\p9-a4\20261106T080729Z`에 있으며 Git에 포함하지 않는다. DB URL과 비밀번호는 기록하지 않는다.
