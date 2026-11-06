# P9-A4 Supabase migration preflight evidence index

## 판정

| 표식 | 상태 | 근거와 범위 |
|---|---|---|
| `SUPABASE_PREFLIGHT_LOCAL_PASS` | PASS (범위 한정) | Docker PostgreSQL 16.15·17.11, 합성 데이터, 로컬 대역. Supabase의 동작을 증명하지 않는다 |
| `MUTATION_CHECK_INCOMPLETE` | **미완료** | 30건 중 2건 실행. 아래 참조 |
| `SUPABASE_CONNECTION_NOT_RUN` | NOT_RUN | 프로젝트 없음. 인증서, Supavisor, Data API 미관찰 |
| `SUPABASE_DATA_MIGRATION_NOT_RUN` | NOT_RUN | S1~S4 미실행. AICS_Web 접근 없음 |
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
| 매트릭스 (음성 테스트 추가 전 최종) | PG 16·17 회귀 `REGRESSION_POSTGRES` pass=96 skipped=1 → **NOT_RUN** 표기(skip은 원격 경로, 별도 CI job). 신규 스위트 각 19 PASS / 1 SKIP. 16→17 복원 1 PASS |
| 음성 테스트 추가 후, PG 17만 | `supabase-preflight*` 36 중 35 PASS / 1 SKIP(교차 버전) / 0 FAIL. **PG 16과 교차 버전의 재실행은 CI에 맡겼다** |
| `npm test` (`PG_TEST_URL` 없음) | 230 중 200 PASS / 30 SKIP / 0 FAIL. SKIP은 실제 PG 항목이다 |
| `npm run check` | PASS |
| S0 CLI (로컬, 합성) | `relocate` 9 tables, 35 rows `unchanged`. 2차 아카이브 26601 bytes. `inspect` PASS, `compare`의 구조·행 수·다이제스트 PASS |
| 같은 `compare`의 게이트 | `COMPARE_DB_ROLE_ATTRIBUTES` **FAIL** (일회용 superuser로 접속해서 나온 정상 탐지), `COMPARE_DB_API_ROLES_DENIED` MANUAL (로컬에 역할 없음). 실제 역할 경로는 테스트가 다룬다 |
| S2·S3 SQL | 로컬 대역에서 비 superuser 관리자로 실행. **실제 Supabase에서는 NOT_RUN** |
| `verify-full`이 쓰는 CA 경로의 Pooler 검증 | NOT_RUN |

## 변형 검사: 미완료

대조군과 로드 실패 분리를 넣어 실행했으나 **시스템 메모리 부족으로 중단되었고 재시작하지 않았다.**

- 대조군 15개 패턴 OK.
- 30건 중 **2건 실행, 2 KILLED** (평문 허용, TLS 검증 끄기).
- **28건 NOT_RUN.** 테스트가 나머지 결함을 잡는다는 근거가 아직 없다.

스크립트는 Git 밖에 있다. 재개 여부는 사용자가 정한다.

## 개발 중 찾은 결함

| 결함 | 찾은 방법 | 조치 |
|---|---|---|
| Supabase에 평문 연결 시도 | 코드 조사 | CA 고정 |
| 트랜잭션 중 연결이 끊기면 프로세스 종료 (`Connection terminated unexpectedly`) | 수정 전에 테스트로 재현 | 오류 리스너, 끊긴 클라이언트 폐기 |
| `supabase-post-restore.sql`의 `REVOKE`가 42501로 실패 | 비 superuser 대역 실행 | 문장 제거. 실제 S3에서 복원 후 드러났을 문제 |
| 스키마가 없으면 게이트 전체 중단 | 대조군 테스트 | 부재를 FAIL·NOT_RUN으로 보고 |
| P9-A3 테스트의 16 하드코딩 | PG 17 실행 | 서버 버전과 비교 |
| 매트릭스의 임의 포트가 재시작 때 바뀌어 복구 실패처럼 보임 | 실행 | 고정 포트. 제품 결함 아님 |

## CI

`a56936e` PR 실행, 13개 job 전부 PASS. `pg-matrix`는 Docker PostgreSQL 16·17 합성 범위이고 `PG_MATRIX_BIND=0.0.0.0`으로 Linux 게이트웨이를 사용한다. Supabase·Render·기기 결과가 아니다.

| job | 결과 |
|---|---|
| [`pg-matrix`](https://github.com/ppsssj/CarScope/actions/runs/42185639725) | PG 16·17 신규 스위트 각 27 중 26 PASS / 1 SKIP(교차 버전, 다음 단계에서 실행). 16→17 복원 1 PASS. 음성 테스트 포함 전체 실행이다 |
| 같은 job의 회귀 | 16·17 모두 `REGRESSION_SYNC_HISTORY` pass=52, `REGRESSION_POSTGRES` pass=96 skipped=1 → **NOT_RUN** 표기. skip은 원격 경로 테스트로, `postgres-integration` job이 PG 16에서만 실행한다. **원격 경로의 PG 17 실행은 없다** |
| `postgres-integration`, preflight, decoder, Sync Ubuntu/Windows, geometry, core, identity, tire, 3D 결과, WebXR, GitGuardian | PASS. 각 job 범위 |

위 "PG 16과 교차 버전의 재실행"은 이 job으로 완료되었다. Linux Docker의 `--docker-image` 경로도 여기서 실행됐다.

원본 로그와 합성 산출물은 작업 PC `C:\CarScope-External\p9-a4\20261106T080729Z`에 있으며 Git에 포함하지 않는다. DB URL과 비밀번호는 기록하지 않는다.
