# P9-H2 증거 인덱스

[설계와 절차](../../p9-h2-avd-history-activation.md). 기준 main `5cb7be2`(PR #91 병합), Windows 10, Node 22.16.0, PostgreSQL 16 (Docker, loopback 임시 컨테이너).

**판정 범위:** 실제 Render 진입점을 자식 프로세스로 실행한 로컬 검증이다. 합성 기록을 쓴다. Render는 흉내만 냈으며(`RENDER=true`, 전달 헤더) 실제 Render와 Supabase는 `NOT_RUN`이다. Debug APK, AVD, 실기기도 `NOT_RUN`이다.

| 판정 | 의미 |
|---|---|
| `AVD_HISTORY_ACTIVATION_PREPARED` | 별도 진입점과 게이트 구현 |
| `AVD_HISTORY_NOT_ACTIVATED` | 운영 서버 배포·활성화 없음 |
| `APK_CHANNEL_NOT_EXERCISED` | 패널 호출 코드가 없어 APK에서 실행할 수 없음. PR #90 이후 |
| `SUPABASE_READ_NOT_RUN` | 계획만 작성. 운영 DB 접속 없음 |
| `OWNER_HISTORY_DENY_DEFAULT` | `/v1/inspection-records`는 시연 중에도 모든 AVD credential에 403 |

## 새 로컬 실행 (2026-11-06)

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 활성화 경계, DB 없음 | PASS 6 | `test/avd-history-activation.test.mjs` |
| 활성화 경계, 실제 진입점 + PostgreSQL | PASS 9개 하위 검사 | `test/avd-history-activation-postgres.test.mjs` |
| Sync 관련 스위트 16개 | PASS 150, FAIL 0, SKIP 14 | avd-*, history-*, deployment-*, supabase-*, postgres-store, render-preflight |
| Supabase 복구 스위트 14건 | **NOT_RUN** | 로컬에 `pg_dump`가 없어 SKIP. CI 범위 |

### 요구 사례

| 사례 | 검사 |
|---|---|
| 코드 배포만으로 열리지 않음 | 기존 명령 + 시뮬레이터 모드: 404, 400, `historyRead` 없음 |
| 환경변수로 열리지 않음 | `CARSCOPE_AVD_HISTORY_READ` 등 4개를 두 모드에 설정: 닫힘. 코드에 추가하면 `ENV_CANNOT_ENABLE_AUTH` 실패 |
| 서버 비활성 | 위 두 경우, 원복 후 |
| 시뮬레이터 모드 없는 시연 명령 | exit 1, 한 줄 출력, DB 연결 없음 |
| 등록 만료 | 목록·상세 403, 기록 유지 |
| 등록 폐기 | 목록·상세 403, 다른 등록은 정상 |
| 다른 등록 접근 | 상세 404, 목록에 없음 (양방향) |
| 권한 없는 조회 | credential 없음, grant, QR 토큰, 임의 값: 403 |
| `/v1/inspection-records` | 세 가지 서버 상태 모두 모든 AVD credential에 403 |
| 만료 정책 불변 | `AVD_MAX_ENROLLMENT_MS`가 24시간 |
| 로그 | proof, grant, receiver 토큰 없음 |

만료 검사는 시험 스키마에서 등록의 `expires_at`을 과거로 바꿔 실행했다. 운영 절차가 아니다.

### 변이 검사 5종 (선택한 조건만 대상, 완전성 증명이 아님)

| 변이 | 결과 |
|---|---|
| 기존 CLI가 시뮬레이터 모드에서 열림 | KILLED |
| 환경변수로 기존 CLI가 열림 | KILLED |
| 시연 명령이 시뮬레이터 모드 없이 시작 | KILLED |
| 시연 명령이 경로를 열지 않음 | KILLED |
| probe가 시뮬레이터 모드 없는 표시를 허용 | KILLED |

## 개발 중 판단

- **PR #91 제안 폐기:** PR #91 보고와 문서는 기존 CLI에 옵션 한 줄을 넣는 방법을 제안했다. 시뮬레이터 모드 서버에서는 코드 배포만으로 열리므로 이번 요구사항에 맞지 않아 폐기했다.
- **`render-stateful.mjs` 분할:** 두 진입점이 같은 검사를 쓰도록 나눴다. `startRenderStateful` 호출은 기존 게이트가 검사하는 CLI 블록에 그대로 있다.
- **PR #90 파일:** `docs/roadmap.md`, `docs/p9-e2e-checklist.md`, `inspect.js`, `SyncReceiverActivity.kt`를 수정하지 않았다. 로드맵 항목과 체크리스트의 `historyRead` 기준(C2a)은 PR #90 뒤에 반영해야 한다.

## CI

`postgres-store-ci.yml`에 `test/avd-history-activation-postgres.test.mjs`를 추가했다. CI 결과는 PR에 기록한다.
