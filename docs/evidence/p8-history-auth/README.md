# P8-A2 History auth evidence index

## 판정 범위

- `HISTORY_AUTH_ADAPTER_IMPLEMENTED`: 코드 구현. 운영 진입점에 연결하지 않음.
- `HISTORY_AUTH_CONTRACT_VERIFIED`: **합성 authority·소유자·차량**, 실제 TLS, 격리 PostgreSQL에서 확인. 실제 소유권 인증을 뜻하지 않음.
- `HISTORY_PRODUCTION_ISSUER_BLOCKED`: 신뢰 issuer·등록/소유권·폐기·관리 credential 없음. 배포 경로 403 DENY_DEFAULT 유지.
- `HISTORY_DEVICE_E2E_NOT_RUN`: 실제 스마트폰·Native·AVD·실차 미실행.

## 새 로컬 실행 (2026-11-04)

환경: Windows 10, Node 22.16.0, loopback 전용 PostgreSQL 16.15. PG는 CI의 `postgres:16` 이미지와 다른 npm 배포 바이너리(`@embedded-postgres/windows-x64@16.15.0-beta.19`)를 Git 밖 임시 경로에서 실행했다. Docker daemon은 꺼져 있어 사용하지 않았다.

| 실행 | 결과 |
|---|---|
| `npm run check` | PASS |
| `npm run test:legacy` | 48 PASS / 0 FAIL |
| `npm test` (`PG_TEST_URL` 없음) | 152 중 146 PASS / 6 SKIP / 0 FAIL. SKIP은 실제 PG 항목 |
| `npm run test:sqlite` | 21 PASS / 0 FAIL |
| `npm run test:ar01` | 80 PASS / 0 FAIL |
| `test/history-auth.test.mjs` | 13 PASS (위 `npm test`에 포함) |
| PG `history-auth-postgres` | 10 PASS (최상위 1 + subtest 9) |
| PG 회귀 `postgres-store` / `avd-simulator` / `avd-simulator-admin` / `history-postgres` | 8 / 6 / 2 / 15 PASS, 0 FAIL |
| 신규 테스트 5회 반복 | 매회 23/23 PASS. 안정성 참고치이며 flake 부재의 증명은 아님 |
| 보안 조건 mutation 17종 | 17 KILLED / 0 SURVIVED. 선택한 조건만 대상으로 함 |

변경 전 기준선: `npm test` 138 중 133 PASS / 5 SKIP, PG `history-postgres` 15 PASS.

개발 중 실패도 기록한다. 최초 실행의 테스트 코드 오류 2건(자기 속성 검사, `render.stop` 이중 pool 종료)과 시각 경합 1건(`issued after notBefore`)을 테스트 쪽에서 수정했다. 시각 경합을 고칠 때 만료·동시성 테스트의 실제 시간 의존도 함께 제거했다. 제품 판정 조건이나 임계값은 완화하지 않았다.

## CI

PR의 PostgreSQL workflow와 Sync workflow 결과는 PR 체크에서 확인한다. CI 성공은 해당 job 범위(Node·SQLite·실제 PG16 합성 인증)에 한정한다.

## 미실행

운영 Render/DB 접근, 실제 issuer 연동, 실제 소유권 검증, 스마트폰·AVD·실차: NOT_RUN / BLOCKED.

원본 로그는 작업 PC `C:/CarScope-External/p8-auth/logs/`에 있으며 Git에 포함하지 않는다. DB URL·비밀번호·인증서·토큰은 기록하지 않는다. 설계와 차단 조건은 [P8-A2 문서](../../p8-a2-history-auth.md)를 따른다.
