# P8-A1 영구 점검 기록: 데이터베이스 설계와 검증

범위: `tools/inspection-sync-poc` backend, PostgreSQL CI, API/DB 문서. Android/3D/모바일/Pleos/Release/Render 운영 설정은 수정하지 않는다. 시작 시 작업 트리는 깨끗했고 PR #71/#72/#73이 병합된 origin/main `b396394695dcf47ccd17a9761b9b2fb374d7a4ba`에서 독립 브랜치를 만들었다. 기존 SDK/기기 검증 자료를 변경하지 않는다.

## 결정: 기존 PostgreSQL 트랜잭션 안에서 archive

`PostgreSQLSessionStore.update`는 이미 세션 행의 `SELECT ... FOR UPDATE`와 세션/토큰 갱신을 한 트랜잭션에 묶는다. 여기에 ACCEPTED 최초 전이의 result 재검증·canonical SHA-256 계산·history INSERT를 추가했다. 세션 mutation의 만료 검사는 행 잠금을 얻은 뒤 실행한다. 네트워크 인증이나 외부 I/O는 이 트랜잭션에 넣지 않는다.

```
BEGIN → 세션 FOR UPDATE → 만료/전이 검사 → 세션·토큰 갱신
      → strict result/digest 검사 → archive INSERT → COMMIT
오류  → ROLLBACK (세션·토큰·history 전체)
```

동일 DB에 짧은 INSERT만 추가하므로 durable outbox보다 단순하고 즉시 archive 완료를 보장한다. 대가는 archive 장애 시 Accept도 실패하며 사용자가 재시도해야 한다는 것이다. 별도 비동기 적재/재처리 큐와 부분 성공은 도입하지 않는다. COMMIT 응답이 네트워크에서 유실된 경우 클라이언트에는 결과가 불명확할 수 있으나 DB 안의 원자성은 유지되고 동일 Accept 재시도로 확인한다.

동일 세션은 행 잠금으로 직렬화한다. 다른 세션의 같은 inspectionId는 UNIQUE + `ON CONFLICT DO NOTHING`으로 중복을 막는다. INSERT 후 **별도 SELECT**로 경쟁에서 먼저 커밋한 기록의 digest와 authority/owner/registration을 검사한다. 다른 값은 CONFLICT이며 세션 전이도 롤백한다. 같은 값이면 첫 recordId/원본/수락 시각을 유지한다. `UPDATE history` 경로는 없다. 동일 digest라도 다른 소유자/등록으로 기록을 재명명하지 않는다.

PostgreSQL READ COMMITTED의 INSERT 충돌은 해당 INSERT snapshot에서 보이지 않는 경쟁 행에 의해 발생할 수 있으므로 별도 statement로 조회한다. 근거: [PostgreSQL 16 isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [INSERT / ON CONFLICT](https://www.postgresql.org/docs/16/sql-insert.html).

## Additive migration v1

`src/postgres-history-schema.sql`을 기존 초기화 트랜잭션에서 적용한다. `pg_advisory_xact_lock(821801)`로 동시 초기화를 직렬화한다. 기존 `postgres-schema.sql` 및 `cs_schema_meta.version=1`을 유지하고 별도 `cs_history_schema_meta.version=1`을 추가한다. 알 수 없는 버전은 초기화 전체 롤백/거부한다. migration은 반복 가능하며 Render 배포 시 DDL 권한/DB 크기/운영 검토가 필요하다. 이번 작업에서 운영 DB에 적용하지 않았다.

| cs_inspection_records 필드 | 타입 / 의미 |
|---|---|
| record_id | UUID PK; 최초 archive에서 생성 |
| inspection_id | UUID NOT NULL UNIQUE; 원본 점검의 전역 idempotency key |
| sync_session_id | TEXT NOT NULL UNIQUE; 출처 참조, **FK 없음** |
| task_id / part_id | TEXT; 기존 17개 exact task / 모델 부품 제약 |
| schema_version | INTEGER; washer v1 / 나머지 v2 |
| inspection_status | TEXT; 기존 v1/v2 상태 enum |
| original_result | JSONB; strict 원본, task/UUID/schema/status/고정값·키 제약 |
| result_digest | TEXT; sha256: + lowercase hex 64자리 |
| completed_at | BIGINT; 사용자 보고 완료 시각, 기존 schema의 유효한 pre-epoch도 보존 |
| received_at / accepted_at | BIGINT; 서버 epoch ms, accepted >= received |
| authority_namespace / authority_issuer | TEXT; 신뢰 출처 영역/issuer |
| user_id / vehicle_id / device_id / registration_id | nullable TEXT; 서버 검증 opaque 바인딩 식별자만 |
| binding_verified_at | nullable BIGINT; 생성 시점 바인딩 검증 시각 |
| created_at | BIGINT; archive 쓰기 시각 |

owner+완료시각+recordId 및 owner+task+완료시각+recordId 복합 인덱스를 둔다. JSONB는 의미상 원본을 유지하며 JSON 공백/키 순서의 byte-for-byte 보존을 뜻하지 않는다. digest는 기존 canonical JSON 규칙을 사용한다. 조회에서도 원본 schema/digest/메타데이터를 검증하고 손상은 500으로 거부한다. 애플리케이션 외부의 DBA 직접 SQL 수정까지 불가능하다는 뜻은 아니다.

QR 원문/token/hash, bearer, VIN, 미디어/좌표/인증 비밀은 복사하지 않는다. 기존 strict 원본 schema에 존재하는 cameraUsed/locationMarked는 사용 여부 boolean이며 이미지/위치 데이터가 아니다. 전체 세션 JSON을 archive하지 않는다.

**기존 ACCEPTED 행을 자동 backfill하지 않는다.** 배포 이후 새 Accept 전이에 적용된다. 과거 result가 이미 purge됐다면 복원할 수 없다. 기록과 세션 사이 cascade/FK가 없어 기존 10분 invite / 30분 session / 10분 accepted result retention / tombstone 정리와 독립적으로 보존한다. Memory/SQLite 저장 정책은 유지한다. 이 migration을 롤백한다고 테이블을 DROP하는 명령은 제공하지 않는다.

향후 삭제·보존 정책은 이 테이블의 namespace/owner/시각과 별도 migration을 기준으로 구현한다. 이번에는 삭제 API, 무기한 보존의 운영 승인, 자동 retention purge, 차량 소유권 이전을 구현하지 않는다. 운영 활성화 전에 정책/접근 감사/DB 역할 분리 검토가 필요하다.

## 인증 경계와 조회

전체 wire DTO/필터/오류와 Codex B 연결 지침은 [API 계약](contracts/p8-inspection-history-v1.md)에 있다.

| namespace | 보존 권한 증거 | 공개 owner 조회 |
|---|---|---|
| VERIFIED_VEHICLE | 기존 verified 생성 authorizer가 확인한 사용자/차량/기기/등록 | 별도 현재 read 인증 필요 |
| AVD_SIMULATOR | 운영자가 승인한 simulator registration; user/vehicle/device는 null | 거부 |
| UNVERIFIED | 기존/내부 세션, 소유권 증거 없음 | 거부 |

AVD는 실제 차량 소유권을 증명하지 않는다. 현재 Render는 History read authorizer가 설치되지 않아 403 DENY_DEFAULT를 유지한다. 테스트 issuer/ownership은 fixture이며 실제 OEM/user 인증이 아니다. 내부 테스트가 실제 인증기관 연동을 증명하지 않는다.

## 재현 명령

Node >=22.16.0, OpenSSL(local TLS fixture) 및 pg dependency가 필요하다.

```powershell
Set-Location tools/inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
npm run check
npm test
# 독립 폐기 가능한 loopback PostgreSQL 테스트 DB에서만 실행
$env:PG_TEST_URL = '<local isolated test database URL>'
npm run test:history
```

History PG 테스트는 loopback만 허용하고 UUID 기반 전용 schema를 생성·정리한다. Render URL은 거부한다. 다른 기존 PG 테스트는 자체 테스트 DB를 쓰므로 공유/운영 DB에서 실행하면 안 된다. CI는 postgres:16 임시 service에 기존 PG/AVD/관리자/History 테스트를 순서대로 실행한다. `PG_TEST_URL`이 없으면 실제 PG 항목은 skip이며 PASS로 세지 않는다.

검증 결과 및 CI 실행 인덱스는 [증거 인덱스](evidence/p8-history/README.md)에 기록한다. 원본 로그·인증서·DB URL·QR·이미지·기기 자료는 Git에 넣지 않는다.

## 변경 파일 목록 (18개)

| 그룹 | 파일 |
|---|---|
| CI | `.github/workflows/postgres-store-ci.yml` |
| 실행/검사 | `tools/inspection-sync-poc/package.json` |
| 영구 저장/조회 | `src/history.mjs`, `src/postgres-history-schema.sql`, `src/postgres-store.mjs` |
| HTTP/인증/세션 | `src/history-authorizer.mjs`, `src/server.mjs`, `src/render-stateful.mjs`, `src/sessions.mjs`, `src/verified-creation-authorizer.mjs`, `src/avd-simulator-credentials.mjs` |
| 테스트 | `test/history.test.mjs`, `test/history-postgres.test.mjs`, `test/history-fixtures.mjs`, `test/history-restart-child.mjs` |
| 문서 | `docs/contracts/p8-inspection-history-v1.md`, `docs/p8-a1-inspection-history-backend.md`, `docs/evidence/p8-history/README.md` |

표의 `src/`, `test/`는 `tools/inspection-sync-poc/` 기준이다. 기존 base PostgreSQL DDL 파일은 변경하지 않는다.
