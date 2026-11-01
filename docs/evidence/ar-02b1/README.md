# AR-02B-1 실행 증거 인덱스

2026-11-01, Windows x64 / Node 22.16.0 / Edge 156.0.4314.58.
기준 main `97ef8088d7fb5e35f9734cf193c545ec7180a6e6` (PR #31 MERGED).
이번 실행과 과거 AR-02A/AR-01/실기기 기록은 별개다. 원본 DB·개발 키·로그·캡처는 Git에 넣지 않는다.

## 실제 새 실행

| 상태 | 명령/범위 | 결과 |
| --- | --- | --- |
| PASS | sync `npm run check` | 기존/신규 모듈 syntax |
| PASS | sync `npm run test:legacy` | 기존 AR-02A 48개, 보안 assertion 유지·명시적 local test auth 주입 |
| PASS | sync `npm test` | 60개: legacy + durable 8개 + security 4개 |
| PASS | sync `npm run test:sqlite` | 21개: race 8개 전부와 서비스 회귀; memory-loss 자체 테스트 1개는 메모리 유지 |
| PASS | sync `npm run test:ar01` | AR-01 원본 파일의 31개, 명시적 테스트 시계로 실행 |
| PASS | sync `npm run test:browser` | Edge 합성 11개, lost claim·Receipt·주소 소거·명시적 수락 |
| PASS | mobile `npm run test:browser` | Edge 합성 16개, 오류 0, 카메라는 합성 fixture |
| PASS | core 기본 명령, 동일 worktree의 임시 영문 R: 경로 | 38개 중 37 실행/실패 0/기존 skip 1 |
| FAIL (원인 구분) | 원래 mobile `npm test`, 보정 전 | 30/31: 기존 UUID/aids 테스트의 real start clock과 고정 completion clock 혼용 |
| FAIL (환경) | 한글 경로에서 core 기본 명령 최초 실행 | 테스트 클래스 4종 ClassNotFoundException, 아래 재실행으로 구분 |
| NOT_RUN | 실제 폰 ↔ Android/Pleos ↔ HTTPS API | 앱 통신 미활성, 인증/CA/네트워크 설정 후 AR-02B-2 |
| BLOCKED | 실차 앱/기기·소유자 인증 | 검증된 발급/등록/증명 제공자 없음; production authorizer deny |
| NOT_RUN | 공개 HTTPS/Preview 배포, 외부 DB, 부하/HA/전원차단 | 이번 승인 범위 밖 |

AR-01 원본 실패는 `self-inspection.test.mjs`의 UUID/aids 사례에서 real Date.now로 만든 startedAt보다
고정 ctx 완료시각이 과거가 되는 문제다. AR-01 소스/테스트/보안 assertion은 변경하지 않았다.
sync의 `test/ar01-clock.mjs`를 별도 test process에 preload해 기본 Date.now만 같은 fixture 시작시각으로 맞춘다.
이 보정 결과를 원래 `npm test`의 무조건 성공으로 보고하지 않는다. CI도 이 명시적 경로를 사용한다.
core는 파일을 복사하거나 worktree를 추가하지 않고 같은 경로를 잠시 R:로 매핑해 기본 명령을 실제 재실행한 뒤 매핑을 해제했다.

## 검증 항목 대응

| 요구 항목 | 근거 |
| --- | --- |
| 메모리 회귀/기존 48개 | test:legacy |
| 영속 생성/재접속/재시작 | durable: close/open, HTTP restart, 별도 API 프로세스 2회 시작·종료 |
| 만료/취소/accepted 보존/삭제 | 기존 service를 SQLite에 적용 + 시작 전 sweep과 재시작 restore |
| 중복/다른 결과 충돌/토큰 unique | service/sqlite + durable의 unique insert/update 실패 rollback |
| 만료·수락 경쟁 | 기존 race의 forced gates/300회 seeded fuzz + 독립 프로세스 accept/sweep |
| 생성 capacity | 기존 race + 4프로세스 40회 생성 시 cap 3 |
| 다중 프로세스 갱신 | 4프로세스 × 50회 = counter 200, claim/submit 경쟁 |
| 프로세스 비정상 종료 | 미커밋 SQL 변경 후 exit(17), 이후 기존 값/lock 해제 확인 |
| 공유 rate limit | 4프로세스 40회 중 7회만 허용, 재접속/기한/키 용량 거부 |
| 무권한 생성/만료/인증 실패 | security의 default deny와 fake rotation/revoke, TLS HTTP 실제 응답 |
| HTTPS 정상/실패 | 임시 CA 명시적 trust 성공; untrusted/hostname mismatch/expired 실패 |
| CSP/CORS/로그 | 기존 server + security HTTPS의 header/preflight/비밀 미노출 검사 |
| AR-01 단위/브라우저 | 31개 clock harness, 16개 Edge 합성 |

## 외부 산출물과 재현

`C:/CarScope-External/ar-02b1/2026-11-01/final/`:
`summary.json`, `check.txt`, `test-legacy.txt`, `test.txt`, `test-sqlite.txt`, `test-ar01.txt`.
생성 명령(sync 디렉터리):

```powershell
$env:SYNC_EVIDENCE_DIR='C:/CarScope-External/ar-02b1/2026-11-01/final'
npm run verify:local
```

브라우저 원본은 `C:/CarScope-External/ar-02b1/2026-11-01/sync-browser/`와
`C:/CarScope-External/qr-ar-01/ar-02b1-2026-11-01/`에 있다. 각기 SYNC_EVIDENCE_DIR/POC_EVIDENCE_DIR로 지정해
해당 package의 `npm run test:browser`를 실행했다. 의존성은 기존 mobile lockfile로 `npm ci --ignore-scripts`했다.
개발 CA·키와 합성 DB는 OS 임시 디렉터리에 생성됐다. 인증서를 시스템 신뢰 저장소에 설치하지 않았다.

core 명령은 `.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`이다.
XML: `vehicle-core/build/test-results/test/TEST-*.xml` (Tire 5, Pipeline 17, Renderer 7, Asset 9 중 skip 1).
성능 측정·실기기·SDK 인증의 증거가 아니다. Windows의 R: 재실행 성공과 Linux CI 결과도 별개로 보고한다.

## CI

독립 `inspection-sync-ci.yml`은 Node 22.16.0의 ubuntu/windows에서 syntax, legacy, durable/TLS,
SQLite race, AR-01 clock harness를 실행한다. Windows만 Edge 브라우저 두 종류를 실행한다.
기존 Geometry CI는 변경하지 않는다. PR/최종 HEAD와 실제 CI 결과는 PR checks와 최종 보고에서 확인한다.
workflow 정의만으로 Linux 검증 성공을 주장하지 않는다.

최초 PR head `0e7b7ea`의 [CI 실행](https://github.com/ppsssj/CarScope/actions/runs/41294677204)은
Linux PASS, Windows FAIL이었다. Windows runner의 새 OpenSSL이 음수 `-days`를 거부한 것이 원인이다.
만료 검사를 생략하지 않고 `openssl ca`로 2020년의 유효한 시작/종료 구간을 가진 인증서를 발급하도록 수정했다.
보정 후 결과는 최종 PR head의 checks로 구분한다.
