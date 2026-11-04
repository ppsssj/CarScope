# P8-B1 3D 차량 점검 기록 UI

기준: `C:/dev/CarScope-p8-ui`, 브랜치 `feat/p8-b1-inspection-history-ui`, main `40344d6`(PR #77 병합). 시작 시 작업 트리는 깨끗했고 로컬 HEAD와 origin/main이 같았다. PR #78(`serverNow`)은 조사 시점에 OPEN이며 포함하지 않았다. 이 UI는 `serverNow`에 의존하지 않는다.

**UI와 데이터 소비 경계는 구현했다. 실제 History 조회는 하지 않았다.** 운영 경로는 `403 DENY_DEFAULT`이고 검증된 Native read provider가 없어 배포 화면은 `UNAVAILABLE`을 표시한다. 합성 데이터 화면과 계약 검증을 실제 기록 조회 성공으로 해석하지 않는다.

## 판정

| 판정 | 의미 | 범위 |
|---|---|---|
| `HISTORY_UI_IMPLEMENTED` | 진입·목록·필터·더 보기·상세·상태 화면·현재 세션 비교 구현 | 코드·브라우저. 표시 데이터는 합성 |
| `HISTORY_UI_CONTRACT_VERIFIED` | 실제 백엔드 `HistoryService`/`historyQuery`/`historyDto` 코드의 응답·cursor를 클라이언트가 소비 | 합성 소유자·행, stub 저장소. HTTP·인증·PostgreSQL 경로 아님 |
| `HISTORY_UI_AUTH_BLOCKED` | issuer·소유권 근거·폐기·Native read credential 부재 | [P8-A2 차단 조건](p8-a2-history-auth.md) 충족 전까지 유지 |
| `HISTORY_UI_DEVICE_E2E_NOT_RUN` | AVD·스마트폰·실차 미실행 | 후순위. 에뮬레이터 미사용 |

## 사용자 화면 흐름

```text
홈 → 차량 점검 ─┬─ 현재 점검: 부위/부품 → 부품별 점검 결과
               ├─ 전체 점검 요약
               └─ 점검 기록 · 저장된 과거 기록 → 목록 → 기록 상세
```

- 진입 지점은 점검 부위 선택, 전체 점검 요약, 부품별 점검 결과 세 곳이다. 부품 화면에서 열면 그 부품 필터로 시작하고 보닛·카메라·선택 강조를 그대로 유지한다.
- Back(`#back`, Esc, Android `inspectionBack`)은 상세→목록→진입 화면으로 한 단계씩 이동한다. 종료는 기존 점검 종료와 같고, 보닛이 열려 있으면 먼저 닫는다.
- 목록 복귀 시 스크롤 위치와 선택했던 카드의 포커스를 복원한다.

## 구조

| 파일 | 책임 |
|---|---|
| `inspection-history-contract.mjs` | DTO·필터 검증, 쿼리 생성, HTTP 상태 분류. 네트워크·DOM 없음 |
| `inspection-history-store.mjs` | 요청 수명, 취소, 페이지 병합, 권한 상실 정리, provider 경계 |
| `inspection-history-view.mjs` | 읽기 전용 HTML. SDK 상태 모듈과 세션 저장소를 import하지 않음 |
| `inspection-flow.mjs` | `HISTORY_LIST`/`HISTORY_DETAIL` 상태와 이벤트. 기존 전이에는 관여하지 않음 |
| `inspect.js` | 고정 조합(`provider:null`), 이벤트 연결, 포커스·수명주기 |
| `test/history-demo-provider.mjs` | 합성 provider. `test/`에만 있고 패키징하지 않음 |

기존 재사용: `mobile-result-contract`의 strict 원본 검증·digest·17개 task 매핑, 상태 배지·색, `RESPONSE_LABELS`, 패널·버튼 CSS. 변경은 두 가지다. `validateMobileResult`에 `allowPreEpoch` 옵션을 추가했고(기본값 동작 불변, 저장 기록 파서만 사용), `inspection-results-view`의 라벨을 export했다.

### Provider 인터페이스

```js
// 검토된 고정 import로만 조합한다. URL·window·postMessage·JSON으로 선택하지 않는다.
provider = {
  origin: 'VERIFIED_NATIVE',                 // 합성은 'DEMO'. 그 외 값은 UNAVAILABLE
  list({query, signal}),                     // query: limit,cursor,taskId,partId,status,from,to의 문자열
  detail({recordId, signal}),
  onAccessRevoked(callback),                 // 선택. unsubscribe 반환
}
// 응답: {status, body} 또는 {unavailable:'AUTH_REQUIRED'|'UNAVAILABLE'}
```

Native provider가 credential 획득·갱신과 `Authorization` 헤더, HTTP 요청, 응답 크기 제한을 소유한다. 토큰·bearer·endpoint는 이 인터페이스를 넘지 않으며 JS 모듈에 History API 경로조차 없다. 연결 시에는 기존 `/native-inspection-v1`을 재사용하지 말고 별도 자산 RPC와 별도 권한으로 구현한다. `verifyAccepted`·binding·proof는 한 점검의 수락 증거일 뿐 조회 권한이 아니다.

## 신뢰 경계

| 출처 | 소유자 | 수명 | 화면 |
|---|---|---|---|
| 현재 세션 사용자 보고 | `userInspection`, `mobileResults` | 페이지 메모리, 종료 시 삭제 | `data-source-zone="SESSION"` |
| 저장된 과거 기록 | History store | 기록 화면에 있는 동안만 | `data-source-zone="HISTORY"`, 읽기 전용 |
| Pleos SDK 관측 | 기존 status 모듈 | 기존 정책 | `data-source-zone="SDK"` |

세 출처는 서로 입력되지 않는다. 기록을 열어도 세션 기록, 17개 집계, 재질 색, 모바일 후보, SDK 상태가 바뀌지 않음을 실제 페이지에서 비교했다. 상세의 `USER_REPORTED`·`sdkDataIncluded:false` 표시는 DTO를 그대로 보여 준다.

배포 페이지에는 `provider:null`이 고정되어 요청이 나가지 않는다. 합성 데이터는 Playwright 테스트 컨텍스트의 응답 치환으로만 들어가며 목록 배너·카드·상세·상태 화면에 **데모 데이터**를 표시한다.

## 계약 적용

- **필터:** `taskId`·`status`·`from`·`to`를 사용한다. `partId`도 검증하지만 taskId와 1:1이라 UI는 taskId만 보낸다. 종료일은 사용자에게 포함이고 서버 범위가 `[from,to)`이므로 다음 현지 자정으로 보낸다. 잘못된 조건은 요청 전에 거부한다.
- **페이지:** 정렬을 다시 하지 않고 서버 순서를 검증만 한다. cursor는 opaque 값으로 그대로 돌려주며 snapshot에 노출하지 않는다. 전체 개수 대신 "불러온 기록 N건 · 전체 개수는 제공되지 않습니다"를 표시한다.
- **목록 검증:** 정확한 키, 17개 task↔part↔schema, schema별 status, `VERIFIED_VEHICLE`, 고정 출처 값, 시각 범위, `acceptedAt >= receivedAt`, 필터 일치, 완료 시각·recordId 내림차순, 페이지 간 중복(recordId·inspectionId), `limit`/`hasMore`/`nextCursor` 일관성.
- **상세 검증:** 위 항목과 요청 recordId 일치, strict 원본, `originalResult`와 DTO의 task·ID·schema·status·완료 시각 일치, canonical digest 재계산, 목록 항목과 일치. 위반은 표시하지 않고 `INVALID_RESPONSE`로 처리한다. 결과는 deep-freeze한다.
- **시각:** DTO는 epoch ms를 현지 시각+시간대로, 원본은 ISO 문자열 그대로 "원본 시작/완료 (ISO)"로 구분해 표시한다. 완료 시각에는 "사용자 기기 보고 시각 · 서버 시계가 아님"을 함께 쓴다. `completedAt`은 계약대로 pre-epoch를 허용하고 서버 시각 3종은 허용하지 않는다.
- **판정 금지:** `NO_FINDINGS_REPORTED`와 워셔액 `OK`는 "발견 사항 없음" 배지다. 모바일 화면의 `OK` 라벨은 "정상 확인"이지만 이 UI에서는 쓰지 않고 "워셔액 충분 확인 보고 (OK)"로 표시한다.
- **v1/v2:** v1의 빈 `responses`는 정상 처리하고 "질문별 응답이 없습니다. 오류가 아닙니다"를 표시한다. v2는 기존 task 메타데이터의 라벨을 쓴다.

## 상태와 동시성

| 상태 | 조건 | 화면 |
|---|---|---|
| `UNAVAILABLE` | provider 없음 또는 provider가 보고 | "저장된 기록이 없다는 뜻이 아닙니다". 재시도 없음 |
| `LOADING` | 요청 중 | `aria-busy`. 이전 행을 섞지 않음 |
| `EMPTY` | 성공 응답의 첫 페이지가 0건 | 인증된 응답에서만 도달 |
| `AUTH_REQUIRED` | 401/403, provider 보고, 폐기 신호 | 행·상세 삭제 후 안내 |
| `NOT_FOUND` | 404 | 없음 또는 접근 불가. 재시도 없음 |
| `INVALID_QUERY` | 400 또는 로컬 필터 오류 | 필터 초기화. cursor 거부면 첫 페이지 재조회 |
| `RATE_LIMITED` / `SERVER_ERROR` / `NETWORK_ERROR` | 429 / 5xx / 예외·15초 timeout | 재시도. "더 보기" 실패 시 기존 행 유지, 같은 cursor로 재시도 |
| `INVALID_RESPONSE` | 계약 위반 | 표시하지 않음, 처음부터 재조회 |

요청마다 호출 객체를 새로 만들고 현재 호출만 결과를 반영한다. 필터 변경·재조회·화면 이탈·일시 중지·권한 상실·dispose는 이전 요청을 abort하고 늦은 응답을 버린다(digest 계산 중 교체된 응답 포함). provider가 abort를 무시해도 timeout이 동작한다.

영구 저장이나 캐시는 없다. 기록 화면을 나가면 행과 상세를 지운다. 숨김·Native pause(`visibilitychange`, 기존 고정 이벤트 `carscope-tire-inactive`)도 데이터를 지우고, 복귀 시 다시 읽는다. Activity 재생성은 새 페이지이므로 복원할 것이 없다.

## 범위 밖과 잔여 조건

수정하지 않음: PostgreSQL schema·migration, 서버 인증, issuer·credential 발급, `tools/inspection-sync-poc/**`, 모바일 AR, GLB·geometry, Pleos 의미·STALE 정책, Render 설정, `app/**`. Back과 패키징은 기존 경로로 충분해 Android 코드 변경이 없다.

운영 연결에 필요한 것: P8-A2의 issuer·소유권·폐기·서비스 credential, Native read credential, 위 인터페이스의 Native provider와 별도 자산 RPC, 그 조합을 `inspect.js`에 넣는 검토된 변경, 실제 Android WebView 입력·Back·수명주기·날짜 입력 검증. 현재 인증 정책에서는 세션 생성도 거부되므로 새 `VERIFIED_VEHICLE` 기록이 운영에 생기지 않는다. P7-C2의 `serverNow` 차단은 별도 과제다.

## 재현

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm run check:results --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:CARSCOPE_EVIDENCE_DIR='C:/CarScope-External/p8-b1/NEW-RUN'
npm run test:history-browser --prefix tools/three-poc   # DOM_ONLY, 합성 provider

# 실제 참조 GLB. 별도 터미널에서 기존 서버 실행
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:CARSCOPE_QR_AR_BASE_URL='https://poc.example/'
$env:PORT='8141'
node tools/three-poc/serve.mjs
# 다른 터미널
$env:CARSCOPE_3D_TEST_URL='http://127.0.0.1:8141/inspect.html?capture=1'
npm run test:history-browser --prefix tools/three-poc
npm run test:results-browser --prefix tools/three-poc
```

실행 결과는 [증거 인덱스](evidence/p8-b1-history-ui/README.md)에 기록한다.
