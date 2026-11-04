# P8-A1 History evidence index

## 판정 범위

- `HISTORY_STORAGE_VERIFIED`: 격리된 실제 PostgreSQL 16에서 확인. Render 운영 DB 배포/기록은 확인하지 않음.
- `HISTORY_READ_API_VERIFIED`: 실제 TLS/SQL과 **합성 issuer·등록·소유권·credential·17-task 결과**로 인증된 조회 확인. 실제 소유권 인증기관 연동을 뜻하지 않음.
- `HISTORY_AUTH_BLOCKED`: 운영 history-read credential 발급/사용자·차량 등록/소유권/폐기 adapter 미연동. Render 공개 조회 403 DENY_DEFAULT 유지.
- `HISTORY_DEVICE_E2E_NOT_RUN`: 실제 스마트폰 → Render → Native/AVD → archive/조회 흐름 미실행. 기기/실차 검증 성공 주장 없음.

## 새 실행

| 실행 | 환경 / 결과 | 근거 |
|---|---|---|
| `npm run check` + `npm test` | Windows, Node 22.16.0: syntax PASS; 138 중 133 PASS / 5 SKIP / 0 FAIL | 외부 `local-final.log` |
| `npm run test:sqlite` | Windows, Node 22.16.0: 기존 service/race 21 PASS / 0 FAIL | 외부 `sqlite-final.log` |
| PostgreSQL workflow 최초 구현 | Ubuntu / Node 22.16.0 / 실제 postgres:16: 기존 PG 8 + AVD 6 + admin 2 + History 12 PASS | [61205e2 CI](https://github.com/ppsssj/CarScope/actions/runs/41812199011) |
| PostgreSQL workflow 경계 보강 | 동일 격리 CI: 기존 16 + History 15 PASS, 0 FAIL / 0 SKIP | [aeb3816 CI](https://github.com/ppsssj/CarScope/actions/runs/41813028521) |
| PR PostgreSQL / 별도 Node 프로세스 재시작 조회 | 실제 PG16: 기존 16 + History 15 PASS / 0 FAIL / 0 SKIP. 새 서버·pool 재시작, 원본 세션 purge 및 별도 Node 프로세스 조회 모두 PASS | [5c7d976 PR CI](https://github.com/ppsssj/CarScope/actions/runs/41813698330), `test/history-restart-child.mjs` |
| Render migration / 실 소유권 / 스마트폰 / AVD | NOT_RUN / AUTH_BLOCKED | 운영 접근·데이터 변경 없음 |

History PG의 15는 최상위 테스트 1개 + subtest 14개이며 17-task 반복을 17개 독립 TAP 테스트로 부풀리지 않는다. 로컬 `npm test`의 실제 PG 항목 5개는 PG_TEST_URL 미설정으로 skip이다. 로컬 Docker daemon은 연결 불가였고 PG를 로컬에서 실행한 것으로 주장하지 않는다. 임시 PostgreSQL CI는 실제 SQL/transaction 검증이고 사용자 입력/소유권은 합성이다.

검증 항목: 17-task Accept/archive/detail, strict schema/digest, 같은 세션·다른 세션 동시 수락, 중복/다른 digest·owner 충돌, trigger INSERT 실패 롤백/복구, pool 장애/복구, 취소/만료, row lock 후 만료 경쟁, owner 격리·권한 폐기·조회 중 바인딩 변경, 목록 정렬/필터/cursor, AVD/UNVERIFIED 격리, 새 pool/service 재시작 및 Sync result/tombstone purge 후 조회, 반복/동시 migration, base schema v1 유지, 손상된 digest 조회 거부, legacy pre-epoch 호환성.

원본 로그 위치는 작업 PC `C:/CarScope-External/p8-history/`이다. 로그/DB URL/인증서/원본 캡처는 Git에 포함하지 않는다. 이전 P7 SDK/기기 증거는 이번 실행 결과와 별개이며 기존 문서를 보존한다. API·DB 결정과 재현 명령은 [설계](../../p8-a1-inspection-history-backend.md), UI 연결은 [계약](../../contracts/p8-inspection-history-v1.md)을 따른다.
