# P8-C1 deployment readiness evidence index

## 판정

- `DEPLOYMENT_PREFLIGHT_IMPLEMENTED`: PASS. 게이트 CLI, 호환성 도구, 격리 PG 통합 테스트, CI, 문서.
- `DEPLOYMENT_PREFLIGHT_VERIFIED`: PASS (범위 한정). 격리 PostgreSQL 16 + 합성 authority + JVM 단위 실행. 운영 Render·운영 DB·실제 소유권 증거가 아니다.
- `RENDER_DEPLOYMENT_NOT_RUN`: 배포, 재시작, 환경변수 변경 없음.
- `PRODUCTION_AUTH_BLOCKED`: 신뢰 issuer·소유권 근거·폐기 서비스 없음. 운영 History는 DENY_DEFAULT.
- `DEVICE_E2E_NOT_RUN`: AVD·스마트폰·실차 미실행. APK는 빌드만 하고 설치하지 않았다.

## 새 로컬 실행 (2026-11-04)

환경: Windows 10, Node 22.16.0, 코드 기준 main `40344d6` 위의 작업 트리. PostgreSQL은 loopback 전용 16.15 (`@embedded-postgres/windows-x64@16.15.0-beta.19`, Git 밖 임시 경로). Docker daemon이 꺼져 있어 CI의 `postgres:16` 이미지와 다른 배포본이다.

| 실행 | 결과 |
|---|---|
| 변경 전 기준선 `npm test` (`PG_TEST_URL` 없음) | 152 중 146 PASS / 6 SKIP / 0 FAIL |
| `npm run check` | PASS |
| `npm run test:legacy` | 48 PASS / 0 FAIL |
| `npm test` (`PG_TEST_URL` 없음) | 178 중 169 PASS / 9 SKIP / 0 FAIL. SKIP은 실제 PG 항목이며 PASS가 아니다 |
| `npm run test:sqlite` | 21 PASS / 0 FAIL |
| `npm run test:ar01` | 80 PASS / 0 FAIL. 첫 실행은 `tools/mobile-ar-poc` 의존성(`qrcode`) 미설치로 2 FAIL, `npm ci` 후 재실행 |
| core `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS. core 변경 없음 |
| `test/deployment-preflight.test.mjs` | 23 PASS (위 `npm test`에 포함) |
| PG `test/deployment-postgres.test.mjs` | 20 PASS (최상위 3 + subtest 17) |
| PG 회귀, `preflight regression` | `REGRESSION_SYNC_HISTORY` pass=52, `REGRESSION_POSTGRES` pass=61, 모두 fail=0 skip=0 |
| `deployment-preflight all` | PASS 14, FAIL 0, MANUAL 1, BLOCKED 3, NOT_VERIFIED 4, NOT_RUN 2. BLOCKED 3건은 `SERVER_NOW_CONTRACT`(2회 출력)와 `PRODUCTION_AUTH_BLOCKED` |
| `pg` 미설치 재현 (Sync CI 조건) | 26 중 23 PASS / 3 SKIP / 0 FAIL |

### APK·서버 호환성

| 실행 | 결과 | 범위 |
|---|---|---|
| `preflight/run-decoder-probe.mjs`, 실제 Kotlin decoder | `2435087`: 기존 응답 ACCEPTED, `serverNow` 응답 **REJECTED**. `40344d6`: 둘 다 ACCEPTED | JVM 단위 실행. 기기 아님 |
| Debug APK 빌드 후 `classifyApk` | `2435087` → `LEGACY_DECODER` (`f1e358f9…cc7a6`). `40344d6` → `NEW_DECODER` (`b6e0d87b…e7e37`) | Git 밖 export에서 빌드. 설치하지 않음. 이 APK들은 배포본이 아니다 |
| PR #78 서버 파일을 Git 밖 복사본에 겹쳐 실행 | 새 테스트와 `server-clock` 50 PASS. `SERVER_NOW_CONTRACT`가 PASS로 전환, 표 동일 | 임시 겹침. PR #78 병합이나 main 변경이 아니다 |

### 변형 검사

선택한 조건만 대상으로 하며 완전성의 증명이 아니다. Git 밖 복사본에 결함을 넣어 새 테스트의 검출 여부를 봤다.

- 1차: 26종 중 21 KILLED, 5 SURVIVED.
- 생존 5종 처리:
  - TLS 우회 거부 제거: **테스트 약점**. 닫힌 DB 포트에서 설정 거부와 연결 실패의 출력이 같았다. 게이트가 DB 접속 수를 세도록 강화했다.
  - 원격 DB 승인 제거, 붙여넣은 환경변수 값 허용: **테스트 약점**. 단언을 강화했다.
  - AVD grant의 조회 허용: `HistoryService`의 namespace 거부가 이중으로 막아 결과가 같았다. 이 층을 통과하는 변형으로 바꿨다.
  - History DDL 실패 무시: 실패한 트랜잭션이 다음 쿼리도 거부하므로 동등 변형으로 판단했다.
- 2차: 강화 후 해당 4종 모두 KILLED.

개발 중 수정: CRLF 체크아웃에서 SQL 주석이 제거되지 않던 DDL 파서, 레거시 스냅샷 들여쓰기, Windows의 `gradlew.bat` 호출. 제품 판정 조건이나 임계값은 완화하지 않았다.

## 운영 관측

| 관측 | 결과 |
|---|---|
| `GET https://carscope-lluo.onrender.com/healthz`, 인증 없음, 2026-11-04 | `UP`, `STATEFUL_DENY_DEFAULT`, `DENIED`, `historyRead` 없음 |
| `/v1` 프로브 | NOT_RUN. 운영 `cs_rate_windows`에 쓰기 때문이다 |
| Render 대시보드, 배포 커밋, Auto-Deploy, 환경변수 | NOT_VERIFIED |
| 운영 DB 스키마·백업 | NOT_VERIFIED. 접근하지 않았다 |
| `pg_dump` 백업·복원 리허설 | NOT_RUN. 임베디드 PostgreSQL에 `pg_dump` 없음 |

## CI

`4e82d31` PR 실행: [PostgreSQL 16 통합](https://github.com/ppsssj/CarScope/actions/runs/41844166725) PASS, [Preflight gates·Kotlin decoder](https://github.com/ppsssj/CarScope/actions/runs/41844166988) PASS, [Sync Ubuntu/Windows](https://github.com/ppsssj/CarScope/actions/runs/41844166898) PASS, Android·core·geometry·tire·3D 결과 CI PASS.

**GitGuardian은 FAIL이다.** 탐지 2건은 판정 표식 문자열 `PRODUCTION_AUTH_BLOCKED`가 있는 줄(`bin/deployment-preflight.mjs:104`, `test/deployment-preflight.test.mjs:354`)의 Generic High Entropy 오탐으로 판단했다. 실제 자격 증명이 아니고 임시 PG 비밀번호는 diff에 없다. 커밋 이력에 남아 있어 force push 없이는 체크가 해소되지 않으므로, 대시보드에서 소유자가 판단해야 한다.

`postgres-integration`은 PG16 합성 인증 범위, `preflight-gates`는 네트워크·DB 없는 게이트 범위, `decoder-probe`는 JVM decoder 범위에 한정한다. 운영 Render·브라우저·AVD·실차 결과가 아니다.

원본 로그는 작업 PC `C:\carscope-external\p8-c1\logs\`에 있으며 Git에 포함하지 않는다. DB URL·비밀번호·토큰·APK는 기록하지 않는다. 설계와 절차는 [P8-C1 문서](../../p8-c1-deployment-readiness.md)를 따른다.
