# P9-H1 점검 이력 조회

차량 부품 패널이 저장된 점검 기록을 읽는 경로를 구현했다. **조회 로직과 인터페이스는 완성됐지만 배포 서버에서는 열 수 없다.** 프로젝트 정책이 환경변수로 이력 조회를 켜는 것을 금지하기 때문이다(아래 [활성화 차단](#활성화-차단)). 결과는 [증거 인덱스](evidence/p9-h1/README.md)에 있다.

## 조회 범위

| 경로 | 인증 | 범위 | 상태 |
|---|---|---|---|
| `GET /v1/inspection-records` | 차량 소유자 read credential | 사용자 + 차량 (`VERIFIED_VEHICLE`) | 변경 없음. 운영 403. 모든 AVD credential도 403 |
| `GET /simulator/inspection-records` | AVD enrollment proof | 그 proof의 등록 하나 (`AVD_SIMULATOR` + `registration_id`) | 신규. 코드 옵션으로만 열림. 배포 CLI는 열지 않음 |

### 소유 범위를 어디까지 검증할 수 있는가

AVD 기록에는 사용자·차량·기기 ID가 없다. 대신 스키마 CHECK가 `registration_id`를 필수로 하고, 세션 생성 때 grant에서 등록을 찾아 기록에 남긴다. 따라서 **"이 기록을 만든 enrollment를 지금 가지고 있다"** 까지는 증명할 수 있다.

증명하지 못하는 것은 사람과 차량이다. 같은 enrollment 파일을 가진 사람은 누구든 같은 기록을 읽는다. 그래서 응답은 `ownershipEvidence: "AVD_REGISTRATION_BINDING"`으로 표시하고, 소유자 경로와 UI 파서는 이 기록을 거부한다.

### 기본 거부를 유지한 방법

- `HistoryService`, `/v1/inspection-records`, `DenyHistoryAuthorizer`는 동작을 바꾸지 않았다. 공통 페이지 처리만 함수로 분리했다.
- `HISTORY_AUTHORITY_WITH_AVD_SIMULATION_FORBIDDEN` 제한을 유지한다. 이 조회는 소유자 authority가 아니므로 그 제한을 풀지 않고도 동작한다.
- SQL의 namespace는 리터럴이다. 등록 ID가 같은 `VERIFIED_VEHICLE` 기록도 나오지 않는다.

### 왜 enrollment proof인가

| 후보 | 판단 |
|---|---|
| 생성 grant | 불가. 계약상 조회 권한이 아니고 수명이 2분이다 |
| 새 읽기 grant 테이블 | 불가. 운영 스키마 변경이 필요하다 |
| **enrollment proof** | 선택. 보유자는 이미 이 등록으로 세션을 만들 수 있어 다른 기록으로 범위가 넓어지지 않는다. Native에 이미 있고 스키마 변경이 없다 |

**계약 변경:** 지금까지 enrollment proof는 어떤 기록도 읽지 못했다. 경로를 열면 자기 등록의 기록을 읽는다. 수명이 최대 24시간이므로 소유자 경로의 5분 credential보다 약하며, Debug AVD 전용으로만 허용한다.

## API

```http
GET /simulator/inspection-records?partId=coolant-reservoir&limit=1
GET /simulator/inspection-records/:recordId
Authorization: Bearer <enrollment proof>
```

Query, 정렬, cursor, 오류 형식, DTO 키는 [P8 계약](contracts/p8-inspection-history-v1.md)과 같다.

- **최근 점검:** `limit=1`
- **제한:** `limit` 1~100, 기본 20. 중복·미지정 파라미터는 400이다. 전체 개수는 제공하지 않는다.
- **cursor:** 등록에 묶여 있어 다른 등록에서 쓰면 400이다.
- **SQL:** 모든 값은 파라미터로 바인딩한다.
- **다른 등록의 기록:** 없는 기록과 같은 404이다.
- **요청 제한:** `client`, `read`, proof별 `token` 예산을 쓴다. QR을 만드는 `avd-provision` 예산은 쓰지 않는다.
- **재검증:** DB 조회 전후로 등록을 확인한다. 조회 중 폐기되면 응답하지 않는다.

## 활성화 차단

`startRenderStateful({enableAvdSimulation: true, enableAvdHistoryRead: true})`로만 경로가 열린다. 배포 CLI는 이 옵션을 넘기지 않으므로 **이 PR을 배포해도 운영 동작은 바뀌지 않는다.** 경로를 열면 `/healthz`에 `historyRead: "AVD_REGISTRATION_ONLY"`가 나타난다.

**차단하는 규칙 세 가지:**

| 규칙 | 위치 |
|---|---|
| Render 경로가 읽을 수 있는 환경변수 목록 (`ALLOWED_ENV`, "history switch"를 예시로 명시) | `preflight/static-gates.mjs` |
| `process.env.*HISTORY*` 금지 | `test/history-auth.test.mjs`, `runtime entrypoints never load fixtures…` |
| "환경변수만으로 켜는 우회도 제공하지 않는다" | [P8 계약](contracts/p8-inspection-history-v1.md) |

처음에는 `CARSCOPE_AVD_HISTORY_READ` 환경변수로 구현했다가 이 게이트에 걸려 제거했다. 게이트와 테스트는 수정하지 않았다.

**활성화 방식:** [P9-H2](p9-h2-avd-history-activation.md)가 정했다. 기본 CLI에 옵션을 넣으면 시뮬레이터 모드 서버가 코드 배포만으로 열리므로, 별도 진입점과 Start Command 변경을 쓴다.

**꺼져 있을 때 클라이언트 결과:** `/simulator/inspection-records`는 서버에서 404, query가 있으면 400이다. 패널에는 `NOT_FOUND` 또는 `INVALID_QUERY`로 보이며 `EMPTY`가 되지 않는다. 기록 없음으로 표시되지 않고 조회 실패로 처리된다.

## UI 연결

`inspect.js`는 수정하지 않았다. 부품 패널에서 다음과 같이 호출한다.

```js
import {createInspectionHistoryClient} from './inspection-history-client.mjs';
import {createNativeHistoryProvider} from './native-history-provider.mjs';

const history = createInspectionHistoryClient({provider: createNativeHistoryProvider()});

let reading = null;
async function showLastInspection(partId) {
  reading?.abort();                      // 부품을 바꾸면 이전 조회를 취소한다
  const mine = reading = new AbortController();
  const latest = await history.getLatestInspection(partId, {signal: mine.signal});
  if (mine.signal.aborted) return;       // 늦은 응답은 버린다
  if (latest.status === 'SUCCESS') { /* latest.inspection */ }
  else if (latest.status === 'EMPTY') { /* 저장된 기록 없음 */ }
  else { /* 이력을 불러오지 못함. 3D와 현재 점검은 그대로 둔다 */ }
}
```

| 함수 | 결과 |
|---|---|
| `getLatestInspection(partId, {signal})` | `{status, inspection}` |
| `getInspectionHistory(partId, {limit, cursor, status, signal})` | `{status, items, hasMore, nextCursor}` |
| `getInspectionDetail(recordId, {signal})` | `{status, inspection}` + `responses`, `originalResult`, `resultDigest`, `receivedAt` |

```ts
type InspectionHistory = {
  recordId: string;        // 상세 조회 키. 제안 인터페이스에 추가
  inspectionId: string;
  taskId: string;
  partId: string;          // 워셔액은 washer-fluid-cap, 브레이크액은 brake-fluid-reservoir
  schemaVersion: 1 | 2;    // 추가
  status: string;
  reportState: string;     // 표시용 상태. 추가
  completedAt: number;     // 사용자 기기 보고 시각. 서버 시계가 아니다
  acceptedAt: number;
  source: "USER_REPORTED";
  authorityNamespace: "AVD_SIMULATOR" | "VERIFIED_VEHICLE"; // 추가
};
```

**제안과 달라진 점:** `getInspectionDetail`은 `inspectionId`가 아닌 `recordId`를 받는다. API와 목록 항목이 쓰는 키이기 때문이다.

**표시 규칙:**

- 함수는 reject하지 않는다. `EMPTY`만 "기록 없음"이고, 다른 실패를 기록 없음으로 표시하면 안 된다.
- `status: "OK"`를 정상 판정으로 표시하지 않는다. `reportState`(`NO_FINDINGS_REPORTED`)를 쓴다.
- `authorityNamespace`가 `AVD_SIMULATOR`면 시뮬레이터 기록임을 표시하고 차량 소유자의 기록이라고 쓰지 않는다.
- 현재 세션 결과나 SDK 상태와 합치지 않는다. 이 모듈은 어느 쪽도 읽거나 쓰지 않는다.

기존 P8 기록 화면은 `VERIFIED_NATIVE` provider만 받으므로 이 provider를 연결해도 `UNAVAILABLE`이다. 시뮬레이터 기록은 이 클라이언트로 읽는다.

## 차량 쪽 경계

```text
부품 패널 → inspection-history-client → native-history-provider
  → GET /native-history-v1 (WebView 내부) → AvdHistoryChannel → HTTPS 고정 origin
```

- proof는 Native에만 있고 페이지로 넘어가지 않는다. 요청마다 파일을 읽어 만료나 삭제가 바로 반영된다.
- 페이지가 보내는 값은 허용 목록으로 검사한다. 경로, origin, 헤더를 고를 수 없다.
- 채널은 `/native-inspection-v1`과 분리돼 있고, 현재 WebView의 `index.html`에서만 응답한다.
- `src/debug`에만 있어 Release에 포함되지 않는다.

## 남은 제약

1. **등록 수명이 이력 수명을 제한한다 (가장 큰 제약).** 등록은 최대 24시간(기본 2시간)이고 연장 기능이 없다. 만료되면 그 기록은 저장돼 있어도 읽을 수 없고, 새 등록은 이전 등록의 기록을 보지 못한다. 운영의 두 기록도 등록이 이미 만료됐다면 읽히지 않는다. "앱을 다시 열어도 이력이 보인다"는 목표는 등록이 유효한 동안만 충족된다.
   - **최소 해결:** 오래 유지하는 AVD 등록을 별도로 승인하거나, 읽기 전용으로 만료를 분리하는 운영 결정이 필요하다. 어느 쪽이든 proof 수명 정책을 바꾸는 일이라 임의로 하지 않았다.
2. **운영 기록의 등록 값은 직접 확인하지 않았다.** 운영 DB에 접속하지 않았다. 코드상 시뮬레이터 모드로 만든 기록은 `AVD_SIMULATOR`이지만, 실제 값은 아래 조회로 확인해야 한다.
   ```sql
   SELECT r.task_id, r.authority_namespace, a.expires_at, a.revoked_at
   FROM cs_inspection_records r LEFT JOIN cs_avd_registrations a ON a.id::text = r.registration_id;
   ```
3. **차량 소유자 조회는 그대로 차단이다.** issuer, 소유권 근거, 폐기 서비스, read credential이 필요하다. [P8-A2 차단 조건](p8-a2-history-auth.md).
4. **조회 성능:** 소유자용 인덱스의 선두 열만 쓴다. 인덱스 추가는 스키마 변경이라 하지 않았다. AVD 기록 규모에서는 문제가 되지 않을 것으로 보지만 측정하지 않았다.
5. **요청 제한 키:** 다른 경로와 마찬가지로 소켓 주소를 쓰므로, Render에서는 프록시 주소로 묶일 수 있다.
6. **실제 WebView에서 실행하지 않았다.** AVD와 실기기는 이번 작업 범위 밖이다.

## 재현

```powershell
docker run -d --rm --name carscope-h1-pg -e POSTGRES_USER=carscope_ci -e POSTGRES_PASSWORD=local_test_only -e POSTGRES_DB=carscope_ci -p 127.0.0.1:55433:5432 postgres:16
Set-Location tools/inspection-sync-poc
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
$env:PG_TEST_URL='postgresql://carscope_ci:local_test_only@127.0.0.1:55433/carscope_ci'
node --test test/avd-history.test.mjs test/avd-history-postgres.test.mjs
Set-Location ../three-poc
npm ci --ignore-scripts
node --test test/inspection-history-client.test.mjs
```

`enableAvdHistoryRead`가 켜진 서버는 PostgreSQL 테스트 안에서만 실행된다. Kotlin 검사는 `gradlew.bat :app:testDebugUnitTest --tests "*AvdHistoryChannelTest" --tests "*NativeInspectionOriginTest" --tests "*NativeInspectionWebChannelTest"`이다.
