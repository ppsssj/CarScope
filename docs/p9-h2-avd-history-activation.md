# P9-H2 Debug AVD 점검 이력 조회 활성화 준비

승인된 시뮬레이터 시연에서만 [P9-H1](p9-h1-inspection-history-read.md)의 조회 경로를 켤 수 있게 했다. **운영 서버를 배포하거나 활성화하지 않았다.** 이 문서의 운영 절차는 모두 실행 전 계획이다. 결과는 [증거 인덱스](evidence/p9-h2/README.md)에 있다.

**이 조회는 차량 소유자 인증이 아니다.** enrollment proof는 "기록을 만든 등록을 지금 가지고 있다"만 증명한다. 실제 사용자 기능의 근거로 쓰지 않는다.

## 활성화 방식

Render의 **Start Command**로만 켜진다.

| Start Command | `CARSCOPE_AVD_SIMULATOR_MODE` | `/simulator/inspection-records` |
|---|---|---|
| `render-stateful.mjs` (현재) | 없음 | 닫힘 |
| `render-stateful.mjs` (현재) | `OPERATOR_APPROVED` | 닫힘 |
| `render-avd-history-demo.mjs` | 없음 또는 다른 값 | 시작 거부, DB 연결 없음 |
| `render-avd-history-demo.mjs` | `OPERATOR_APPROVED` | **열림** |

### 다른 방식을 쓰지 않은 이유

저장소에는 `render.yaml`이 없고 Start Command는 Render 설정이 정한다. `enableAvdHistoryRead`는 PR #91에서 코드 옵션으로만 존재했고, 어떤 진입점도 넘기지 않았다.

| 후보 | 판단 |
|---|---|
| 환경변수 | 금지. `ALLOWED_ENV`, `process.env.*HISTORY*` 금지 테스트, P8 계약 |
| 기존 CLI에 옵션 추가 (PR #91 문서의 제안) | **폐기.** 시뮬레이터 모드 서버는 코드 배포만으로 열린다 |
| 새 Render 서비스 | Debug APK의 `API_ORIGIN`이 고정돼 있어 APK 변경도 필요하다 |
| **별도 진입점 + Start Command** | 선택. 코드 배포로는 안 열리고, 운영자의 설정 변경이 필요하며, 원복이 쉽다 |

### 재발 방지

- `AVD_HISTORY_DEMO_ENTRY_ONLY` 게이트: `src`, `bin`에서 데모 진입점만 옵션을 넘길 수 있다. 진입점의 환경변수 읽기, 추가 import, 소유자 authority 전달, `HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN` 제거도 실패한다.
- `AVD_HISTORY_DEMO_REFUSES_UNSAFE_CONFIG` 게이트: 안전하지 않은 설정은 DB 연결 전에 거부한다.
- 기존 `ENV_CANNOT_ENABLE_AUTH` 게이트와 `ALLOWED_ENV`는 바꾸지 않았다.
- `probe`: 시연 중이면 `RENDER_HISTORY_AUTHORITY`가 `MANUAL`이다. 정확히 `AVD_REGISTRATION_ONLY` + `STATEFUL_AVD_SIMULATION`일 때만이며, 다른 조합은 계속 FAIL이다.
- `render` 보고서에 `RENDER_START_COMMAND`(`NOT_VERIFIED`)를 추가했다. 이 도구는 Render 설정을 읽지 못하므로 사람이 확인한다.

## 권한 경계

| 요청 | 결과 |
|---|---|
| 자기 등록의 enrollment proof | 자기 등록의 기록만 |
| 다른 등록의 기록 | 404 |
| 만료·폐기된 등록 | 403. 기록은 저장된 채로 남는다 |
| 생성 grant, QR 토큰, 임의 값, credential 없음 | 403 |
| `/v1/inspection-records`에 모든 AVD credential | 403 (시연 중에도) |
| 서버 비활성 | 목록 404, query가 있으면 400. 패널에서는 `EMPTY`가 아닌 조회 실패 |

바꾸지 않은 것: 등록 수명 최대 24시간, 스키마, `HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN`.

**알려진 한계:**

- 등록이 만료되면 과거 기록을 읽지 못한다. 별도 과제로 유지한다.
- 같은 enrollment 파일을 가진 사람은 같은 기록을 읽는다. 파일 관리가 곧 접근 통제다.
- Render 서비스 하나를 공유하므로, 시연 중에는 같은 서비스의 모든 등록에 경로가 열린다.

## 운영 영향

**이 PR을 병합하고 배포해도 동작은 바뀌지 않는다.**

| 항목 | 영향 |
|---|---|
| 조회 권한 | 없음. Start Command를 바꾸기 전까지 닫혀 있다 |
| DB 스키마 | 없음. 스키마 파일 변경 없음 |
| 환경변수 | 없음 |
| `render-stateful.mjs` | CLI 내부를 함수로 나눴다. 시작 검사, 순서, 출력은 같고 기존 CLI 테스트가 같은 파일을 실행한다 |

**Auto-Deploy가 켜져 있으면** 병합이 곧 배포다. 위 이유로 권한은 바뀌지 않지만, 배포 시점은 운영자가 확인한다.

**시연 중 쓰기:** 조회도 `cs_rate_windows`를 기록한다. 기록 테이블은 쓰지 않는다.

## 활성화 절차 (실행 전 승인 필요)

1. **현재 상태 기록:** Start Command, Auto-Deploy, 배포 커밋을 기록한다. `deployment-preflight.mjs probe --origin <origin>` 결과가 `historyRead` 없음이어야 한다.
2. **시뮬레이터 모드 확인:** `mode`가 `STATEFUL_AVD_SIMULATION`이어야 한다. 아니면 [G5](p9-e2e-checklist.md#c2-승인된-avd-시뮬레이터-활성화-g5)를 먼저 승인받는다. 이 단계는 세션 생성을 여는 별도 결정이다.
3. **변경:** Start Command만 `node tools/inspection-sync-poc/src/render-avd-history-demo.mjs`로 바꾸고 재배포한다. 다른 설정을 함께 바꾸지 않는다.
4. **확인:** `probe`에서 `historyRead: AVD_REGISTRATION_ONLY`, `RENDER_HISTORY_AUTHORITY=MANUAL`을 확인한다.

**원복:** Start Command를 `node tools/inspection-sync-poc/src/render-stateful.mjs`로 되돌리고 재배포한다. `probe`에서 `historyRead`가 없어지고 경로가 404면 끝이다. 기록은 그대로 남는다. 기존 proof를 즉시 막으려면 `avd-simulator-admin.mjs revoke --id <등록 UUID>`를 쓴다.

## Debug APK 연동 절차

### 현재 상태

| 구성 | 상태 |
|---|---|
| Native 채널 `/native-history-v1` | Debug APK에 포함 (PR #91) |
| JS 모듈 | 패키징됨 |
| **패널에서 호출** | **없음.** `inspect.js`가 모듈을 호출하지 않는다 |

`inspect.js`는 PR #90의 작업 파일이라 이 PR에서 수정하지 않았다. WebView 원격 디버깅도 없어, 호출 코드가 들어오기 전에는 **APK 안에서 채널을 실행할 방법이 없다.** 시험용으로 디버깅을 켜거나 페이지에 credential을 노출하지 않는다.

### 절차

1. **PR #90 병합 후 패널 연결:** [P9-H1 예시](p9-h1-inspection-history-read.md#ui-연결)대로 호출하는 별도 PR을 만든다. 표시 규칙도 따른다. `EMPTY`만 기록 없음이고, `AVD_SIMULATOR`는 시뮬레이터 기록으로 표시한다.
2. **빌드:** `node tools/three-poc/build-android-inspection.mjs` 후 Debug APK를 빌드한다. [P9 체크리스트 A](p9-e2e-checklist.md)로 설치한다. 서명 충돌 시 uninstall하지 않는다.
3. **endpoint:** `files/sync-endpoint.json`은 체크리스트 B2 그대로다. 앱은 고정 origin만 허용한다.
4. **enrollment:** 체크리스트 C3으로 발급하고 주입한다. **내용을 출력하지 않는다.**
   - 기록을 같은 등록으로 읽어야 하므로, **점검과 조회에 같은 파일을 쓴다.**
   - 파일을 교체하면 새 등록이 되어 이전 기록이 보이지 않는다.
5. **판정:**

| # | 동작 | 합격 기준 |
|---|---|---|
| D1 | 기록이 있는 부품 선택 | 최근 점검 표시. 시뮬레이터 기록 표시 |
| D2 | 이력·상세 | 완료 시각 내림차순, 상세의 원본이 DB와 일치 |
| D3 | 기록 없는 부품 | `EMPTY` |
| D4 | enrollment 파일 삭제 후 다시 조회 | `AUTH_REQUIRED`. 3D와 현재 점검 유지 |
| D5 | 서버 원복 후 조회 | 조회 실패 표시. 기록 없음으로 표시하지 않음 |
| D6 | 앱 재시작 후 조회 (등록 유효) | 같은 기록 표시 |

## Supabase 실제 조회 검증 계획

운영 DB를 수정하지 않는다. 이번 작업에서는 실행하지 않았다.

### 사전 질문: 운영의 두 기록을 읽을 수 있는가

읽기 전용 연결로 등록 상태를 확인한다. URL은 명령줄이나 채팅에 넣지 않는다. 스키마는 `carscope`이다.

```sql
BEGIN READ ONLY;
SELECT r.task_id, r.inspection_status, r.authority_namespace,
       r.registration_id IS NOT NULL AS has_registration,
       a.expires_at > (extract(epoch FROM now()) * 1000)::bigint AS registration_live,
       a.revoked_at IS NOT NULL AS revoked
FROM carscope.cs_inspection_records r
LEFT JOIN carscope.cs_avd_registrations a ON a.id::text = r.registration_id
ORDER BY r.completed_at;
ROLLBACK;
```

| 결과 | 의미 | 다음 단계 |
|---|---|---|
| `AVD_SIMULATOR`, `registration_live` true, 해당 proof 파일 보유 | 두 기록을 그대로 읽을 수 있다 | V1부터 |
| `registration_live` false 또는 proof 파일 없음 | **이 경로로 읽을 수 없다** (24시간 정책) | V0으로 새 기록을 만든다 |
| `UNVERIFIED` | 등록이 없어 어떤 경로로도 읽을 수 없다 | V0 |

**24시간 정책상 두 기록은 이미 읽을 수 없을 가능성이 높다.** 이 경우 `BLOCKED_BY_REGISTRATION_EXPIRY`로 기록하며 실패가 아니다. 등록 값을 고쳐 읽게 만들지 않는다.

### 단계

| # | 단계 | 쓰기 | 합격 기준 |
|---|---|---|---|
| V0 | 새 등록 발급 후 실제 QR → 모바일 → 수락 (필요할 때) | 등록, 세션, 기록 1건 | 새 기록의 `registration_id`가 발급한 등록과 일치 |
| V1 | 목록과 최근 점검 | `cs_rate_windows` | 기록이 DB 행과 일치 (`inspection_id`, 상태, 시각) |
| V2 | 상세 | `cs_rate_windows` | `result_digest` 재계산 일치 |
| V3 | 다른 유효 등록으로 V1의 기록 조회 | `cs_rate_windows` | 404, 목록에 없음 |
| V4 | proof 없이, 생성 grant로 조회 | `cs_rate_windows` | 403 |
| V5 | `/v1/inspection-records`에 proof | `cs_rate_windows` | 403 |
| V6 | 시험 등록 폐기 후 조회 | 등록 `revoked_at` | 403, 기록 유지 |
| V7 | 기록 불변 확인 | 없음 | 시연 전후 `count`, `md5`가 같다 (V0 기록 제외) |
| V8 | 원복 후 `probe` | 없음 | `historyRead` 없음, 경로 404 |

서버 쪽 조회는 운영자 PC에서 실행한다. proof를 출력하거나 명령줄에 넣지 않는다.

```powershell
$proof = (Get-Content -Raw C:\CarScope-External\p9\avd-enrollment-<시각>.json | ConvertFrom-Json).enrollmentProof
$reply = Invoke-RestMethod -Uri 'https://carscope-lluo.onrender.com/simulator/inspection-records?limit=20' -Headers @{ Authorization = "Bearer $proof" }
Remove-Variable proof
$reply.items | Select-Object taskId, partId, inspectionStatus, completedAt, acceptedAt, authorityNamespace, ownershipEvidence
```

기록 불변 확인은 다음 조회로 한다.

```sql
BEGIN READ ONLY;
SELECT count(*), md5(string_agg(t::text, '|' ORDER BY record_id)) FROM carscope.cs_inspection_records t;
ROLLBACK;
```

증거는 Git 밖에 두고 [증거 인덱스](evidence/p9-h2/README.md)에 요약만 남긴다. proof, URL, 비밀번호, 원본 결과는 기록하지 않는다.

## 재현

```powershell
docker run -d --rm --name carscope-h2-pg -e POSTGRES_USER=carscope_ci -e POSTGRES_PASSWORD=local_test_only -e POSTGRES_DB=carscope_ci -p 127.0.0.1:55434:5432 postgres:16
Set-Location tools/inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
$env:PG_TEST_URL='postgresql://carscope_ci:local_test_only@127.0.0.1:55434/carscope_ci'
node --test test/avd-history-activation.test.mjs test/avd-history-activation-postgres.test.mjs
```
