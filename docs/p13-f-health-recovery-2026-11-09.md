# P13-F Health 장애 후속 — 2026-11-09 KST

기준 main `5e96f2bdcea3d8df1a2bdd01ab936cd0ebd966f2`. 별도 worktree/브랜치 `fix/p13-f-vision-health-deadline`.
기존 main의 미추적 `p13-f-avd-enrollment-2026-11-09.md`는 보존했다. 기존 운영 Render/`carscope` 스키마, PR #115, API 원장을 변경하지 않는다.

## 실제 HTTPS 분리 진단

대상: `https://carscope-vision-experiment.onrender.com`, 서비스 `srv-dbo7ir6i0phs73eoqf5g`.
`curl.exe -4 --http1.1 --connect-timeout 10 --max-time 120`을 `/`, `/healthz` 순서로 실행했다.
원문 응답·키·DB URL·토큰은 이 문서에 넣지 않는다.

| 요청 | HTTP | TTFB | 전체 시간 | exit |
|---|---|---|---|---|
| `/` | 000 | 0.000000 s | 120.001511 s | 28 |
| `/healthz` | 000 | 0.000000 s | 120.001453 s | 28 |
| 대조 `https://render.com` | 200 | 0.340408 s | 0.494204 s | 0 |

두 주소 모두 수신 바이트가 0이다. curl의 TLS verification result는 0이었다.
이는 `/healthz`의 DB 조회만 지연되는 패턴이 아니다. 루트는 DB를 조회하지 않고 정적 HTML을 제공한다.
Render 서비스 HTTP 경로·인스턴스와 요청 도달 여부를 우선 확인해야 한다. 콜드 스타트, DB, PowerShell 버그로 원인을 확정하지 않았다.
요청 중 Supabase의 전용 역할 연결 관측은 0건이었지만 단일 관측으로 Render DB 장애를 확정하지 않는다.
이 대화에 Render 서비스/로그/배포 도구가 노출되지 않고, CLI/자격도 없으며 브라우저 접근 host가 unavailable이어서 현재 서비스 요청 로그를 확인하지 못했다.

## 확인한 코드 문제와 별도 보완

기존 Pool의 `connectionTimeoutMillis=5000`은 연결 획득 제한이며, 실행 중 SQL 전체 대기 시간을 보장하지 않는다.
Vision `/healthz`는 `pool.query('SELECT current_schema() AS name')`를 별도 deadline 없이 기다렸다.
`server.requestTimeout`은 이 비동기 응답 대기를 제한하는 대체 수단이 아니다.

이 변경은 **확인된 Health 무기한 대기 가능성의 보완**이며, 현재 두 외부 URL 타임아웃의 원인이 밝혀졌거나 복구됐다는 뜻이 아니다.

- `vision-health.mjs`: checkout + 실제 schema query 전체 5초 deadline 및 개별 query timeout.
- timeout 시 빌린 연결 폐기, 늦게 얻은 연결은 SQL 실행 없이 폐기, 늦은 성공이 UP으로 변하지 않게 함.
- 실패는 HTTP 503 / `status:DOWN`과 고정 분류 `DATABASE_TIMEOUT`, `DATABASE_UNAVAILABLE`, `DATABASE_SCHEMA_MISMATCH`만 반환.
- CLI의 고정 로그 `VISION_HEALTH_REQUEST`, `VISION_HEALTH_PASS`, `VISION_HEALTH_DATABASE_*`로 Node 핸들러 도달/결과 구분. 인증정보·SQL 파라미터·예외 원문 없음.
- 실제 DB 조회와 schema 일치가 완료됐을 때만 기존 UP/모드 JSON 반환.
- 기존 `render-stateful.mjs`와 PowerShell Health 검증은 변경하지 않음. 승인·비용·QR 정책도 그대로다.

**현재 로컬 수정이다. Render 배포 및 실제 Health 복구는 NOT_RUN/BLOCKED이며 운영 반영 완료가 아니다.**

## 검증

```powershell
cd tools/inspection-sync-poc
node test/run-pg-matrix.mjs --only 16 -- --test test/vision-experiment.test.mjs test/vision-budget-postgres.test.mjs test/vision-runtime-postgres.test.mjs test/vision-health.test.mjs test/vision-health-postgres.test.mjs
npm run check
npm test
```

- PG16 Vision 검증: **16 PASS / 0 FAIL / 0 SKIP**.
- 실제 Node HTTP + 실제 PG16 초기화 후 query stall 주입: root 200 유지, Health 5초 deadline 후 503, 연결 1회 폐기, 실제 DB 조회 복구 후에만 UP 확인.
- 늦은 checkout/응답, schema mismatch, 비민감 오류 분류, 기존 CLI 탐지 OFF/ON·기본 거부·예산 검사 통과.
- `npm run check`, `git diff --check`: PASS.
- 최초 테스트 실행은 runner 뒤에 `npm run`을 넘겨 테스트 시작 전 MODULE_NOT_FOUND가 났다. 기존 runner는 Node 인자를 받으므로 위 명령으로 바로잡았다. 이를 제품 테스트 실패 또는 성공으로 집계하지 않았다.
- 전체 sync 회귀: **272 PASS / 42 명시적 SKIP / 실패 0**, 총 314개. PG 전용 검사는 위 격리 실행 결과와 구분한다.
- GitHub CI 결과는 PR의 최신 실행 근거로 구분한다. 기존 CI 성공을 이 변경의 새 CI로 표시하지 않는다.

## 실환경 Gate

| Gate | 현재 결과 |
|---|---|
| VISION_HEALTH_PASS | BLOCKED: 실제 두 URL 120초 무응답 |
| VISION_DATABASE_PASS | PASS: 현재 Windows 계정 DPAPI, CA+호스트 검증, TLS authorized=true, 실제 `carscope_vision_app` / `carscope_vision`, 관리자 list 성공 |
| AVD_ENROLLMENT_ISSUED | NOT_RUN: 실제 등록 0건. Health 미확인 상태에서 발급하지 않음. ID/만료 시각 없음 |
| AVD_PRIVATE_FILES_VERIFIED | PARTIAL: endpoint 600/128 bytes/앱 소유자/JSON exact Origin 확인, enrollment 없음 |
| QR_READY | BLOCKED: 실제 QR 미발급 |

설치 APK를 읽기 전용 확인해 실제 Vision Origin과 `avd-vision-enrollment.json` 경로 포함을 확인했다. 재설치/데이터 초기화는 하지 않았다.
기존 CA/DPAPI 파일을 보존했고 평문 비밀번호는 디스크·출력에 남기지 않았다. 실제 AI 호출 0회, 새 enrollment 0건이다.
원본 테스트·APK·상태 근거는 Git 밖 `C:/CarScope-External/avd-vision`에 둔다.

## 다음 실행

1. Render에서 해당 요청 시각 HTTP/런타임 로그를 확인한다. 위 코드 배포 시 REQUEST 로그가 없으면 Node 이전 경로/기동을, timeout 분류가 있으면 Pool/DB를 조사한다.
2. 변경 배포가 필요하면 CI/리뷰 후 **위 Vision 실험 서비스에만** 반영하고 실제 `/healthz` UP/EXPERIMENT/STATEFUL_AVD_SIMULATION/OPERATOR_APPROVED_AVD_ONLY를 확인한다. 기존 운영 서비스를 바꾸지 않는다.
3. 전용 DB registration 재조회 → 기존 관리자 CLI로 2시간 enrollment 1회 → 기존 script로 private file 주입 → 앱 인증/QR 화면 확인. 토큰/QR 원문은 출력하지 않는다.
4. QR_READY 이후 휴대폰에서 스캔·촬영·명시적 외부 전송 동의 → Roboflow/GPT → 수동 점검 제출 → 차량 수락 → 기록 저장을 별도 실행한다. 이번 단계는 유료 API를 실행하지 않는다.

현재 FULL_E2E_PASS가 아니다.
