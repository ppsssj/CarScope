# AR-02B-1 — 로컬 영속 동기화 기반

2026-11-01. 기준 main/PR #31: `97ef8088d7fb5e35f9734cf193c545ec7180a6e6`.
현재 독립 worktree `C:\Users\박성진\.codex\worktrees\0b30\CarScope-sync-infra`,
브랜치 `feat/ar-02b1-sync-infrastructure-local`에서 작업했다. 기존 권장 경로의 worktree는 사용하지 않았다.
P3-I1의 app/debug, Three.js, Tire 및 모델 파일을 수정하지 않는다.

이 단계는 **로컬 개발 기반**이다. 서버·계정·DB 인스턴스·배포를 생성하지 않았고 Android/운영 모바일의 통신을 활성화하지 않았다.
[인증 설계](ar-02b1-authentication-design.md), [네트워크·배포 비교](ar-02b1-deployment-options.md),
[새 실행 증거](evidence/ar-02b1/README.md)를 함께 읽는다.

## 설계 결정

필요한 것은 기존 `SessionStore`의 선형화 가능한 연산과 재시작 복구다.
메모리는 기존 합성 회귀용으로 유지하고, 외부 의존성이 없는 별도 `SQLiteSessionStore`를 추가했다.
`sessions.mjs`, `protocol.mjs`, 모바일 클라이언트와 결과 레코드를 변경하지 않는다.
외부 DB 도입은 계정·네트워크·운영 승인이 필요하므로 이번 범위에서 선택하지 않았다.

실제 Windows Node **22.16.0**에서 `DatabaseSync` import와 파일 DB 동작을 확인했다.
별도 `--experimental-sqlite` 플래그 없이 실행되지만 ExperimentalWarning이 발생한다.
[해당 버전 공식 문서](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html)는 stability 1.1이며
동기 API와 22.16.0에 추가된 busy timeout 옵션을 설명한다.
따라서 이 어댑터를 운영 준비 완료 DB로 주장하지 않는다. 동기 lock 대기는 이벤트 루프도 막는다.
Linux/Windows 동일 버전 검증은 독립 `inspection-sync-ci.yml`의 실제 결과로 구분한다.
새 npm 런타임 의존성·네이티브 애드온·라이선스 추가는 없다. Node/SQLite 업데이트 검증 책임은 남는다.

## 파일과 트랜잭션

| 구현 | 역할 |
| --- | --- |
| `src/sqlite-store.mjs` | 외부 파일 경로 확인, SQLiteSessionStore, SQLiteRateLimiter |
| `src/sqlite-schema.sql` | schema v1: sessions, session_tokens, rate_windows |
| `src/creation-authorizer.mjs` | 생성 권한 경계와 기본 거부, 명시적 로컬 fake |
| `src/server.mjs` | 인증 주입, 공유 limiter 주입, 시작 전 sweep, TLS 설정 |
| `test/durable.test.mjs`, `test/process-worker.mjs` | 독립 연결·독립 프로세스·재시작·강제 종료 |
| `test/store-fixture.mjs`, `test/run-sqlite.mjs` | 기존 서비스/경쟁 테스트를 SQLite에도 적용 |

DB는 절대경로여야 하며 기존 부모의 realpath를 확인한다. checkout 안과 `.git` 조상 아래의 DB 생성을 거부한다.
부모 디렉터리는 운영자가 미리 준비한다. DB/WAL/SHM/개발 인증서와 키는 Git 제외다.
schema v1은 JSON 세션 행과 별도 토큰 인덱스를 쓴다. 토큰 hash는 **모든 역할에 걸쳐 unique**이며,
각 `(session_id, kind)`도 unique다. FK cascade로 세션 삭제와 인덱스 삭제를 결합한다.
스키마 버전이 0/1이 아니면 자동 마이그레이션하지 않고 실패한다.

| 연산 | 원자성 |
| --- | --- |
| insert | `BEGIN IMMEDIATE` → 중복 ID 확인 → count/capacity → 행/토큰 insert → COMMIT |
| update | write lock → 최신 행 읽기 → 동기 mutate → 상태 순서·digest/결과 검사 → 행/인덱스 갱신 → COMMIT |
| delete | write lock → 최신 행으로 동기 predicate 재평가 → 조건 충족 시 삭제 → COMMIT |
| 예외/unique 충돌 | ROLLBACK: 행과 인덱스가 함께 이전 값 유지 |
| get/all | 복원된 JSON 복사본; all은 sweep 후보일 뿐 전이 권한이 아님 |

트랜잭션 내부에는 await가 없고 async callback/predicate는 거부한다. 서비스의 기존 마감 시각 재평가는
write lock을 획득한 뒤 실행된다. `RESULT_SUBMITTED`의 다른 결과 덮어쓰기 및 종료 상태 교체를 거부한다.
`WAL`, `synchronous=FULL`, `foreign_keys=ON`, `secure_delete=ON`, 기본 busy timeout 5초를 사용한다.
busy/파일/스키마 오류는 메모리로 대체하지 않고 실패한다. API는 내부 세부사항 없는 500을 반환한다.
[SQLite WAL 제한](https://www.sqlite.org/wal.html)에 따라 **동일 호스트의 로컬 디스크 프로세스만** 대상이다.
NFS/SMB, 여러 서버, serverless 임시 파일시스템을 위한 분산 DB가 아니다.

## 계약과 복구

CREATED → CLAIMED → RESULT_SUBMITTED → ACCEPTED 순서 및 CANCELLED/EXPIRED 종료 상태를 유지한다.
invite 10분, session 30분, accepted 결과 10분, tombstone 60분, 기본 500개 제한을 변경하지 않았다.
서버 시작 전에 sweep하고 이후 30초 간격으로 sweep한다. 요청도 기존 lazy expiry를 수행한다.
정지 중에는 정리가 실행되지 않지만 재시작 sweep이 요청 수신 전에 만료·보존기한을 반영한다.
정리 오류는 비밀 없는 `housekeeping failed` 로그로 남긴다.

취소/만료는 결과를 즉시 **논리 삭제**하고, accepted는 보존기한 뒤 결과를 삭제한다. 종료 상태는 유지하다 tombstone 기한 뒤 삭제한다.
파일·WAL·백업의 포렌식 삭제나 SSD의 물리 삭제는 검증하지 않았다. 디스크 ACL/암호화와 백업 보존 정책은 배포 선행 조건이다.
전원 차단, 디스크 손상, 백업 복원·대규모 부하·HA는 미검증이다.

QR v1/v2, AR-01 schema v1 allow-list, 완료 레코드만 제출, Digest, Receipt, 동일 결과 중복과 다른 결과 409는 그대로다.
VIN/번호판/계정/GPS/미디어를 추가하지 않는다. SENT와 차량 ACCEPTED도 구분한다.
claim 응답이 유실되면 재시작해도 ALREADY_CLAIMED이며 submit token을 재발급하지 않는다. 차량에서 취소 후 새 QR로 복구한다.

## 요청 제한

| 키/경로 | 기본 분당 제한 |
| --- | ---: |
| socket client 전체(OPTIONS/미등록 경로 포함) | 300 |
| bearer token 전체 | 120 |
| 생성 / claim / 제출 / read / static (client별) | 10 / 20 / 30 / 120 / 240 |

SQLite 모드에서는 같은 파일의 rate_windows를 트랜잭션으로 공유한다. 키는 SHA-256으로 저장하며
token/IP 원문을 DB에 남기지 않는다. 만료 window를 지우고 새 키 공간은 기본 10,000개로 제한한다.
공간이 가득 차면 새 키를 거부하며, 현재 키의 budget이나 capacity를 늘리지 않는다. 동일 제한은 프로세스 재시작 후에도 유지된다.
메모리 limiter도 maxKeys 도달 시 거부하도록 수정했다. 여러 budget 검사 중 앞서 소비한 budget은 뒤 단계 실패 때 환불하지 않는다.
fixed window 경계에서 burst가 가능하며 DDoS 보호·인증 주체별 quota·분산 호스트별 budget은 미구현이다.
socket 주소만 사용하고 임의 X-Forwarded-For는 신뢰하지 않는다. 프록시 앞에서는 전체 요청이 한 주소로 묶일 수 있으므로
배포 전에 신뢰 프록시/엣지 제한 정책이 필요하다. 가짜 토큰을 바꾸는 공격은 client budget도 소비한다.

## 로컬 실행과 검증

```powershell
cd tools/inspection-sync-poc
# 기본: 세션 생성 거부. DB 부모는 checkout 밖에 미리 준비한다.
$env:SYNC_DB_PATH = 'C:/CarScope-External/ar-02b1/local/sync.sqlite'
npm run serve
# 과거 loopback 합성 데모만 명시적으로 허용 (차량 인증이 아님)
$env:SYNC_LOCAL_TEST_AUTH = '1'
$env:SYNC_DEBUG_PAGE = '1'
npm run serve
```

SQLite를 선택하지 않으면 메모리 저장소이고 재시작 시 유실된다. SQLite CLI는 공유 limiter도 함께 선택한다.
인증 기본값은 모든 환경에서 deny다. 테스트 인증/debug 페이지는 non-loopback bind에서 거부한다.
TLS cert/key는 둘 다 필요하며 non-loopback HTTP bind는 거부한다.

```powershell
npm run check
npm run test:legacy  # 기존 AR-02A 48개, assertion 유지
npm test             # legacy + durable + security
npm run test:sqlite  # race 8개 전부 + 서비스 회귀(메모리 소실 자체 테스트는 메모리 유지)
npm run test:ar01    # 원래 AR-01 파일/31개 assertion, 테스트 전용 시계
$env:SYNC_EVIDENCE_DIR = 'C:/CarScope-External/ar-02b1/<run>'
npm run verify:local # 위 5개 결과/로그 저장
```

TLS 테스트에는 OpenSSL이 필요하다. Windows는 설치된 Git의 OpenSSL, Linux는 PATH, 필요 시 `SYNC_OPENSSL`을 쓴다.
테스트 CA와 키는 외부 임시 폴더에 생성하며 OS 신뢰 저장소에 설치하지 않는다. CA를 명시적으로 신뢰한 Node 클라이언트만 성공이다.
브라우저 두 종류의 실행 명령과 최초 실패/보정 조건은 [evidence](evidence/ar-02b1/README.md)에 기록한다.

## AR-02B-2 진입 조건

Android에는 INTERNET permission, HTTPS 전용 설정, 검증된 생성 권한, QR v2 표시, receiver 결과 polling/backoff,
Digest로 사용자 수락·취소, Activity stop/recreate/process death 정책이 필요하다. 네트워크를 정적 SVG WebView에 열지 말고
앱 네트워크 경계에 둔다. receiver token은 메모리 우선, 영속화가 필요하면 Keystore로 보호한 저장소와 삭제 정책을 설계한다.
QR 재표시를 위해 일회용 invite를 서버에서 다시 받지 않는다. 잃으면 취소/새 세션이다.

Mobile은 기존 UI와 v1 분기를 유지하고 v2 fragment 소거→claim→COMPLETED 뒤 명시적 전송→Receipt 검증→ACCEPTED 표시를
연결해야 한다. timeout/오프라인/429/401/409/410 UI와 같은 결과의 bounded retry를 검증한다. claim은 자동 재발급하지 않는다.
실기기 TLS trust, AVD 네트워크 경로, Preview 보호, 운영 인증 제공자와 폐기 정책, 배포/비용 승인이 선행돼야 한다.
