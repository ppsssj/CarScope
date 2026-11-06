# P9-H1 증거 인덱스

[설계](../../p9-h1-inspection-history-read.md). 기준 main `3918ce4`, Windows 10, Node 22.16.0, JDK 17, PostgreSQL 16 (Docker, loopback 임시 컨테이너).

**판정 범위:** 합성 기록을 쓴 로컬 검증이다. 운영 DB에는 접속하지 않았고 Render 환경변수, 스키마, 배포를 변경하지 않았다. AVD, 실기기, 실제 WebView는 `NOT_RUN`이다.

| 판정 | 의미 |
|---|---|
| `AVD_HISTORY_READ_IMPLEMENTED` | 조회 API, JS 모듈, Native 채널 구현 |
| `AVD_HISTORY_READ_DEPLOY_BLOCKED` | 배포 CLI는 경로를 열지 않음. 정책 승인 전까지 유지 |
| `OWNER_HISTORY_DENY_DEFAULT` | `/v1/inspection-records`는 변경 없음. 모든 AVD credential에 403 |
| `PRODUCTION_RECORDS_NOT_READ` | 운영의 두 기록은 이번 작업에서 읽지 않음. 등록 유효 여부 미확인 |

## 새 로컬 실행 (2026-11-06)

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 조회 경계, DB 없음 | PASS | `node --test test/avd-history.test.mjs` |
| 조회 경계, 실제 PostgreSQL + HTTP | PASS 9개 하위 검사 | `test/avd-history-postgres.test.mjs`. 임시 스키마, 실제 provision → QR → Accept로 생성 |
| Sync 관련 스위트 11개 (`PG_TEST_URL` 있음) | PASS 123, SKIP 0 | avd-*, history-*, deployment-*, postgres-store |
| 정적 게이트 | PASS | `test/deployment-preflight.test.mjs`. 게이트와 그 테스트는 수정하지 않음 |
| JS 조회 모듈 | PASS 10 | `test/inspection-history-client.test.mjs`. DTO는 실제 서버 코드로 생성 |
| three-poc Node | PASS 230, SKIP 0 | `npm test` |
| Android asset, Release 경계 | PASS 4 | `npm run test:android-assets` |
| Kotlin 채널 | PASS 12 (7 + 2 + 3) | `AvdHistoryChannelTest`, `NativeInspectionOriginTest`, `NativeInspectionWebChannelTest`. Robolectric이며 실제 Chromium이 아님 |

**변이 검사 9종 (선택한 조건만 대상, 완전성 증명이 아님):**

| 변이 | 결과 |
|---|---|
| 목록 SQL에서 `registration_id` 제거 | KILLED |
| 상세 SQL에서 `registration_id` 제거 | KILLED |
| 목록 SQL에서 namespace 제거 | 1차 SURVIVED, 같은 issuer·등록의 소유자 행을 추가한 뒤 KILLED |
| 만료·폐기 무시 | KILLED |
| 조회 후 재검증 제거 | KILLED |
| 시뮬레이터 모드면 항상 열림 | KILLED |
| 소유자 서비스가 AVD 허용 | KILLED |
| 클라이언트가 출처 표시 무시 | KILLED |
| 빈 결과를 성공으로 보고 | KILLED |

## 개발 중 수정 기록

- **환경변수 스위치 제거:** 처음에는 `CARSCOPE_AVD_HISTORY_READ`로 활성화하도록 구현했다. 기존 게이트 3건이 실패했다(`gates catch an environment switch…`, `static gates pass on this tree…`, `runtime entrypoints never load fixtures…`). 이력 조회를 환경변수로 켜지 못하게 하는 정책이므로 게이트가 아닌 구현을 고쳤다.
- **테스트 오류:** fixture의 기본 상태가 이미 `UNABLE`이어서 불일치 검사가 불일치를 만들지 못했다. 값을 고쳤다.

## CI

`postgres-store-ci.yml`에 `test/avd-history-postgres.test.mjs`를 추가했다. CI 결과는 PR에 기록한다.
