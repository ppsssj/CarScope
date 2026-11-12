# P14-B 외부 차량 데이터 API 통합 (Hyundai Developers · Pleos Vehicle Data API)

기준 `origin/main` `b12ff79` (PR #123 병합 후).

**한 일:**
- 서버 측 라이브러리 `tools/vehicle-data-api`를 추가했다. 공통 모델, 두 provider 어댑터, OAuth·동의·철회 흐름, 정규화를 담는다.
- 3D 부품 상태 카드에 외부 데이터 블록을 넣었다. 이 블록은 MOCK fixture에서만 켜진다.

**하지 않은 것:**
- 실제 provider 호출, 실제 OAuth 로그인, 토큰 저장소 연결을 하지 않았다.
- 라우트 노출, Render 배포, AVD 실행, Android 코드 변경을 하지 않았다.

**결론:** 두 provider 모두 실서비스 연결은 **BLOCKED**이다(아래 「활성화 차단 사유」). 테스트는 공식 문서의 예시 응답으로만 했다(**MOCK_PASS**, LIVE 아님).

## 1. 공식 문서 조사 (2026-11-12 열람)

### Hyundai Developers (국내)

**열람한 페이지:**
- `developers.hyundai.com/web/v1/hyundai/` 아래의 `data_api`, `guide_api`, `guide_console`, `specification/account`
- 규격서 19개(`specification/account/*`, `specification/data/*`)
  - 규격 본문은 페이지가 `/api/v1/specification/contents/{grp}/{api}`에서 불러오는 markdown이다. 그 원문을 직접 읽었다.
  - 이 사이트는 TLS 중간 인증서를 보내지 않는다. Node 기반 도구는 인증서 검증에 실패하고, Windows의 curl(schannel)로는 읽혔다.

**지원 조건:**
- CCS(Bluelink) 계약 차량이다.
- 개발 단계에서는 콘솔 「내 차량 등록」에서 **본인 명의 CCS 차량**을 활성화한 경우에만 실제 차량을 연동한다.
- 상용화 신청이 승인되면 상용 프로젝트가 생성된다.
- 공유받은 차량은 목록에 나오지 않는다.

**인증:**

| 항목 | 내용 |
|---|---|
| 로그인 | `GET https://prd.kr-ccapi.hyundai.com/api/v1/user/oauth2/authorize?response_type=code&client_id&redirect_uri&state` |
| 토큰 엔드포인트 | `POST …/api/v1/user/oauth2/token` (`Authorization: Basic base64(id:secret)`, form) |
| `grant_type` | `authorization_code` / `refresh_token` / `delete`(폐기) |
| 수명 | access 24시간, refresh 1년. 단 예시의 `expires_in`은 7200이다. 응답 값이 있으면 그 값을 쓴다. |

**동의와 철회:**
- 동의 요청: `POST …/api/v1/car-service/terms/agreement`(form `token=Bearer {access_token}`, `state`). 동의하면 `redirect_url?userId=&state=`로 돌아온다.
- 철회 요청: `GET …/api/v1/car-service/terms/reject`.
- 데이터 제공 불가 알림: 콜백 POST `{type: account|vehicle|agreement, action: delete|reject, userId?, carId?, vin?}`. 받으면 즉시 일괄 삭제해야 한다.

**API 호스트:**
- 규격서에는 `prd.kr-ccapi.hyundai.com`만 있다.
- 가이드 예제 코드에는 `dev.kr-ccapi.hyundai.com`이 나오지만 설명이 없다. 그래서 허용하지 않았다.

**Rate Limit·비용·갱신 주기:**
- Rate Limit과 비용: 열람한 페이지에 없다.
- 갱신 시점: 데이터별로 "시동 종료 시점", "시동 종료, EV/PHEV 충전 종료 시점"에 업데이트된다.
- 주행 가능 거리(DTE): "2개월 미운행 차량은 조회 불가"이다.

**시각:**
- `YYYYMMDDHHmmSS`이며 **시간대가 명시되지 않았다.** 그래서 UTC 시각으로 바꾸지 않고 원문과 「시간대 미기재」로만 보존한다.
- 경고등 API는 시각을 주지 않는다.

**오류:**
- 형식: `{errId, errCode, errMsg}`
- 규격서에 나온 코드: `4002`, `4045`(No data), `4046`(보유 차량 없음)
- HTTP 401·403의 의미는 문서화되어 있지 않다.

### Pleos Vehicle Data API (유럽)

**열람한 페이지:**
- intro, faq, error-code, api-compatibility
- getting-started: overview, api-access-request, request-for-data-sharing, notify-data-sharing-consent-withdraw
- 인증: get-access-token, get-access-token-refresh, login-api
- 차량: get-vehicles, select-vehicles, stop-data-sharing
- 상태: get-vehicle-status, get-battery-charging-status, get-vehicle-operation-status, get-vehicle-data, get-vehicle-operation-data, get-powertrain-status

**지원 지역:**
- intro: "현재(2026.8월) 유럽 지역에서만 사용 가능".
- FAQ에 34개국이 나열되어 있다. **한국은 없다.**
- Bluelink·Kia Connect·Genesis Connected Services 차량만 대상이다.

**인증:**

| 항목 | 내용 |
|---|---|
| 로그인 | `GET https://api.pleos.ai/v1/auth/login?clientId&brand&redirectUrl&state` → 302 `code`, `state` |
| 토큰 발급 | `POST /v1/auth/token` `{clientId, clientSecret, code, redirectUrl}` (`Brand` 헤더). access 1시간, refresh 90일·1회용 |
| 토큰 갱신 | `POST /v1/auth/token-refresh`. refresh 토큰이 교체된다. |
| 토큰 폐기 | **문서 없음** |

**동의와 철회:**
- 차량 선택: `POST /v1/vehicles/selections`. 단 request-for-data-sharing 페이지는 GET으로 적어 메서드가 불일치한다.
- 동의 결과: `vehicles` 파라미터로 온다(Base64 JSON 배열).
- 동의 목록: `GET /v1/vehicles/consent`.
- 동의 철회: `DELETE /v1/vehicles/consent?vin=`.
- 철회 알림: 콜백 POST `{userIds, vins}`. 서명·발신자 인증은 문서에 없다.

**Rate Limit·비용·갱신 주기·개발/상용 구분·샌드박스:** 문서에 없다.

**오류:**
- 형식: `{error:{code,message,details,timestamp,requestId}}`
- 코드: 401, 403, 404, 4002, 4009, 4011, 40002, 5006(동의 없음·철회), 4045(No Data), 4101(미등록 차량), 5001

### 기능별 제공 범위 매트릭스

- **「문서 확인」:** 공식 규격에 필드·단위가 있다는 뜻이다.
- **「실계정 확인」:** 실제 계정으로 호출해 확인했다는 뜻이다. 두 provider 모두 **없음**이다(계정·승인 없음).

| CarScope 기능 | Hyundai Developers | Pleos Vehicle Data API | 실계정 확인 |
|---|---|---|---|
| 누적 주행거리 | `GET /car/status/:carId/odometer`. `odometers[].value`(소수점 절사), `unit` 0 feet / 1 km / 2 meter / 3 miles | `GET /vehicles/{vin}/driving`. `odometer.value`(0~16777214), `unit` km / mile / meter / feet / invalid | 없음 |
| 주행 가능 거리 | `GET …/dte`. `value`, `unit` 같은 코드. PHEV 합계 필드 별도 | `GET …/powertrains`. `distanceToEmpties[].value`(문자열 1~4095), `unit`(…`miles`…) | 없음 |
| EV 배터리 잔량 | `GET …/ev/battery`. `soc` % | `GET …/batteries`. `charge.stateOfCharge` % (255 invalid) | 없음 |
| 충전 케이블·충전 여부 | `GET …/ev/charging`. `batteryPlugin` 0/1/2, `batteryCharge` | `charge.plugin`, `charge.charging` | 없음 |
| 워셔액 경고 | `GET …/warning/:carId/washerFluid`. `status`(시각 없음) | `GET …/status`. `warnings`에 `washFluid` | 없음 |
| 브레이크 오일 경고 | `…/breakOil` | `brakeOil` | 없음 |
| 타이어 공기압 | **없음.** 차량 전체 경고등 `…/tirePressure`만 | 바퀴별 `tire[0앞,1뒤].left/right` + `unit`(psi 그대로, kpa ×5, bar ÷10, 255 invalid) | 없음 |
| 타이어 바퀴별 경고 | 없음 | `tirePressureFrontLeft` 등. 바퀴 구분이 없는 차량은 `tirePressureLow` | 없음 |
| 전조등 | `lampWire` 경고등은 의미가 불명확해 **부품에 연결하지 않음** | `frontHeadLamp` 경고(좌우 구분 없음) | 없음 |
| 엔진오일·스마트키·주유 경고 | 있음 | 있음 | 없음 |
| 차량 제원 | 소개 페이지에만 언급되고 규격서 목록에 없다. **UNSUPPORTED** | 없음 | — |
| 운행 이력(트립) | 이번 범위 아님 | `…/status/data`, `…/driving/data`(최대 7일). 운전 행태 데이터라 **개수만** 확인 | 없음 |

## 2. 구현 (`tools/vehicle-data-api`)

| 모듈 | 역할 |
|---|---|
| `src/model.mjs` | 공통 모델(아래 3) |
| `src/http.mjs` | 고정 Origin 클라이언트(아래 5) |
| `src/strict-json.mjs` | 응답 JSON 검증: 중복 키·잘못된 UTF-8·깊이 초과 거부 |
| `src/credentials.mjs` | OAuth state, 토큰·비밀 보관, 토큰 저장소 승인 목록 |
| `src/normalizer.mjs` (VehicleDataNormalizer) | 문서화된 응답만 값으로 만든다. 그 밖은 값 없음 + 사유 |
| `src/providers/hyundai-developers.mjs` (HyundaiDevelopersProvider) | 로그인 URL, 토큰 발급·갱신·폐기, 차량 목록, 데이터 11종, 동의 결과·철회, 데이터 제공 불가 알림 파서 |
| `src/providers/pleos-vehicle-data.mjs` (PleosVehicleDataProvider) | 로그인, 토큰·회전 갱신, 동의 차량 목록, status / batteries / driving / powertrains, 트립(개수만), Stop Data Sharing(VIN 필수), 철회 콜백 파서, 지역 목록 |
| `src/availability.mjs` (VehicleDataAvailability) | 운영자 설정으로 provider 상태를 정한다. 네트워크를 쓰지 않는다. |
| `src/service.mjs` (ExternalVehicleDataService) | 세션·계정·동의·차량 바인딩·호출 제한·캐시·철회·연결 해제 |
| `src/projection.mjs` | 페이지로 보내는 투영. 상태와 보고 단어만 담는다. |
| `src/fixture.mjs` (ExternalVehicleDataFixture) | 공식 예시 응답과 호출을 기록하는 가짜 fetch |

**provider 경계:**
- Pleos Vehicle SDK는 서버 provider로 가장하지 않는다. 기존 Native 채널을 그대로 쓴다.
- REST reading은 `source`에 `PLEOS`를 쓸 수 없다(모델 검증).

## 3. 공통 차량 데이터 모델

reading 필드:
- `provider`, `featureId`, `vehicleBinding`(서버의 `vb_` id. carId·VIN이 아니다), `source`(`EXTERNAL_REST` | `MOCK`), `availability`
- `observedAt`: provider가 시간대를 밝힌 경우에만 ISO UTC
- `observedAtRaw`, `observedAtZone`(`UTC` | `UNSPECIFIED`), `fetchedAt`(서버 수신 시각), `value`, `unit`, `dataQuality`(`DOCUMENTED` | `UNIT_UNVERIFIED` | `MOCK` | `NONE`), `reason`

검증 규칙:
- 값은 RECEIVED·STALE에만 있다.
- 시간대가 없는 시각은 instant가 될 수 없다.
- 등록된 단위만 허용한다.
- 원본 응답 필드는 reading에 넣을 수 없다.

시각의 의미를 섞지 않는다:
- SDK의 callback 수신 시각, REST의 `observedAt`(차량 데이터 시각), `fetchedAt`(서버 수신 시각)은 서로 다른 값이다.
- REST의 **STALE**은 서버 사본이 15분보다 오래됐다는 뜻이다(`freshness`). 차량 관측 시각은 시동 종료 시점 기준이라 오래됐는지 판정하지 않는다.
- SDK의 5000ms 정책은 바꾸지 않았다.

## 4. OAuth·권한·동의 설계

1. **세션:** `sessionKey`는 서버가 인증한 CarScope 사용자이다. AVD Enrollment나 모바일 QR 토큰은 provider 로그인으로 쓰지 않는다.
2. **로그인:**
   - `beginLogin`은 32바이트 state를 만든다. state는 1회용이고 10분 동안 유효하며 세션·provider·목적에 묶인다.
   - `completeLogin`은 state를 상수 시간 비교로 확인한다. 다른 세션, 재사용, 만료, 목적이 다른 state는 거부한다. 거부하면 토큰 요청도 하지 않는다.
3. **토큰:**
   - `TokenRecord`와 `Secret`은 JSON, 문자열, `inspect`로 출력되지 않는다.
   - 저장소는 `APPROVED_TOKEN_STORES`에 등록된 것만 허용한다. **현재 이 목록은 비어 있다.**
   - 테스트 전용 메모리 저장소는 `testMode`일 때만 쓸 수 있다. `RENDER`나 `NODE_ENV=production` 환경에서는 생성을 거부한다.
4. **동의:**
   - 동의 화면을 여는 단계는 두 provider 모두 **BLOCKED**이다.
     - Hyundai는 브라우저 form에 access token을 담는다.
     - Pleos의 `redirectUrl` 예시에 `gwToken=Bearer <ACCESS_TOKEN>`가 들어 있다.
     - 두 경우 모두 토큰이 클라이언트에 노출되므로, provider가 토큰 없이 여는 방법을 확인해 줄 때까지 열지 않는다.
   - 동의 결과(redirect)를 처리하는 부분과 그 뒤 흐름은 구현하고 테스트했다.
5. **차량:**
   - provider가 이 계정에 대해 나열한 차량, 그리고 Pleos는 동의한 VIN만 선택할 수 있다.
   - 출력에는 불투명 handle만 나간다(carId·VIN 없음).
6. **바인딩:**
   - `ownerConfirmed: true`일 때만 CarScope 차량에 연결한다.
   - 다른 계정의 handle과 다른 세션의 조회는 거부한다.
   - AVD나 IONIQ 5 GLB와 외형이 비슷하다고 같은 차량으로 보지 않는다. 바인딩이 없으면 SDK와 REST 데이터를 결합하지 않는다.
7. **철회:**
   - 콜백을 받으면 바인딩, 캐시, handle, 동의를 즉시 지운다. 계정 삭제 알림이면 토큰도 지운다.
   - 진행 중이던 응답도 버린다.
   - 새로 동의하기 전까지 재조회와 재바인딩을 막는다.
   - 철회 표시의 적용 범위:
     - 차량 단위 provider 알림은 그 차량을 가진 모든 계정에 적용한다.
     - 연결 해제로 생긴 철회는 그 계정에만 적용한다. 같은 차량을 가진 다른 계정은 계속 조회한다.
     - Hyundai는 계정 단위로 동의하므로, 그 계정이 새로 동의하면 그 계정의 철회 표시만 풀린다. Pleos는 동의 결과의 VIN 목록으로 푼다.
   - 콜백은 발신자 인증이 문서에 없어서 **어떤 서버에도 라우트로 열지 않았다.**
8. **연결 해제:**
   - **먼저 로컬 접근을 끊는다.** provider 호출을 시작하기 전에 동기적으로 바인딩, 캐시, handle, 동의, 토큰을 지우고 계정 세대(epoch)를 올린다. provider가 느리거나 실패해도 그 사이에 조회할 수 없다.
   - provider에 알릴 때 쓰는 토큰은 이 호출의 메모리에만 잠시 들고 있고, 저장소에 다시 넣지 않는다. 만료된 토큰이어도 갱신하지 않는다.
   - Hyundai: `terms/reject`를 보낸 뒤 토큰을 폐기(`grant_type=delete`)한다.
   - Pleos: VIN별로 `DELETE /vehicles/consent`를 보낸다. 토큰 폐기 API는 없어서 로컬에서만 지운다(`localOnly`).
   - 결과는 두 가지를 따로 보고한다.
     - `localAccessBlocked: true`
     - `remoteWithdrawal`: `CONFIRMED` | `FAILED` | `NOT_ATTEMPTED`(보관된 토큰 없음). 단계별 결과는 `steps`에 담는다.
   - provider가 오류를 돌려주거나 예외를 던져도 로컬 차단은 유지된다.
9. **비동기 경합:**
   - 계정마다 세대 값이 있다. 연결 해제, 계정 삭제 알림, provider의 인증 만료·동의 없음 응답이 오면 올라간다.
   - 바인딩마다 세대 값이 따로 있다.
   - 시작할 때의 세대와 끝날 때의 세대가 다르거나 그 차량이 철회됐으면, 결과를 저장·캐시·반환하지 않는다. 대상은 코드 교환, 토큰 갱신, 차량 목록, 데이터 조회이다.
     - 늦게 온 토큰 갱신 결과는 저장소에 다시 들어가지 않는다.
     - 늦게 온 조회 응답은 캐시에 남지 않고, 그 호출에서 먼저 받은 값도 함께 버린다(`ACCESS_WITHDRAWN_DURING_REQUEST`).
   - 토큰 갱신은 계정당 한 번에 하나만 한다. Pleos refresh 토큰은 1회용이라 동시에 두 번 갱신하면 안 된다.
   - 다른 계정과 같은 계정의 다른 차량은 영향을 받지 않는다(테스트로 확인).
10. **호출 제한:**
   - CarScope 자체 제한이다: 세션당 인증 10/분, 계정당 조회 30/분, provider 전체 600/분, 같은 호출 60초 캐시.
   - provider 공식 Rate Limit이 아니다. 공식 값은 문서에 없다.

## 5. 네트워크 보안

**요청 대상:**
- 허용 Origin은 코드에 고정되어 있다: `https://prd.kr-ccapi.hyundai.com`, `https://api.pleos.ai`.
- 클라이언트·토큰·응답에서 온 URL은 쓰지 않는다.
- 경로는 고정 템플릿이다. 차량 id는 형식을 검사하고 인코딩한다.
- `//`, `..`, `%2e`, `%2f`, `\`, `?`, `#`가 들어간 템플릿은 거부한다.

**전송:**
- `redirect: 'manual'`을 쓰고, 3xx는 `REDIRECT_REFUSED` 실패로 처리한다.
- `credentials: 'omit'`, no-referrer.
- 인증서·호스트 검증은 플랫폼 기본값을 쓴다. `NODE_TLS_REJECT_UNAUTHORIZED=0`이면 생성 자체를 거부한다.

**응답:**
- 타임아웃(기본 5초, 최대 10초)과 호출자 취소를 구분한다.
- 응답 크기 상한(64 KiB, Pleos 256 KiB), `application/json`만, 압축 응답 거부, 엄격 JSON을 적용한다.

**구분하는 오류 상태:**
- AUTH_EXPIRED / CONSENT_REQUIRED / RATE_LIMITED / PROVIDER_ERROR / NO_DATA / INVALID_VALUE
- HTTP 429는 일반 의미로만 분류한다. 두 provider 모두 429를 문서화하지 않았다.

**로그:**
- 라이브러리는 로그를 남기지 않는다(`console` 없음, 테스트로 확인).
- 오류에는 코드만 담는다. 토큰, carId, VIN, userId, 닉네임은 출력하지 않는다.

**노출 범위:**
- 이 패키지를 import하는 실행 진입점이 없다.
- 기본 Render, AVD 데모, WebXR, Vision 실험 서버의 import 그래프에 포함되지 않는다(테스트로 확인).
- 기본 DENY와 기존 Render·Enrollment·QR 인증은 그대로이다.

## 6. 3D 상태 카드 통합

**블록 위치:**
- PR #123 카드에 네 번째 블록 「외부 커넥티드카 데이터」를 추가했다.
- 차량 SDK 블록 바로 뒤, AI·직접 점검 블록 앞에 놓인다.
- 주행거리 카드(전체 요약)에도 같은 블록을 추가했다.

**표시하는 상태:**
- 연결 안 됨, 개발자 프로젝트 미설정, 사용 안 함, 조건 미충족(BLOCKED), 동의 필요, 지원 지역 아님, 기능 미지원
- 권한 만료, 조회 한도, 외부 서비스 장애, 데이터 없음, 유효하지 않은 값, 오래됨, 수신 완료

**표시 원칙:**
- 숫자는 보여 주지 않는다(`NUMBER_HIDDEN`). 단위는 문서로 확인했지만 실제 계정으로는 확인하지 않았다.
- 경고는 "켜짐으로 보고됨" 또는 "보고되지 않음(판정 아님)"으로만 쓴다.
- 판정어를 쓰지 않는다. 어느 출처도 다른 출처를 덮어쓰지 않는다.

**켜지는 조건:**
- 기본은 **표시하지 않음**이다. `?externalVehicleData=fixture`일 때만 MOCK fixture로 켜진다.
- Android shell은 이 플래그를 쓰지 않는다.
- `external-vehicle-data.mjs`에는 네트워크 코드가 없다(테스트로 확인).

**Android 자산:**
- Debug 자산에만 포함된다(`check.py boundary`).
- Release APK·AAB에는 이 파일도, provider 호스트 문자열도 없다.

**변경하지 않은 것:** 3D 형상, QR, 17개 점검 결과, History, 카메라, PartLabel.

## 7. 검증

| 항목 | 결과 | 비고 |
|---|---|---|
| Hyundai 공식 응답 계약 (`providers.test.mjs`) | MOCK_PASS | 토큰 발급·갱신·폐기 form과 Basic 헤더, 차량 목록, 데이터 11종, 계약 밖 값, 동의 결과, 철회 콜백 |
| Pleos 공식 응답 계약 | MOCK_PASS | 로그인 URL, 토큰 회전, 공기압 변환(psi/kpa/bar, 255), 경고 목록, 배터리·주행거리·DTE, 오류 코드 매핑, 트립 7일 제한, 지역 |
| 철회 순서·비동기 경합 (`race.test.mjs`) | MOCK_PASS 7 | 느린 provider 철회 중에도 즉시 차단, 철회 실패·예외에도 로컬 삭제 유지, 진행 중 토큰 갱신 결과 재저장 방지(연결 해제·계정 삭제 알림), 갱신 1회만, 진행 중 조회·목록 응답 폐기와 캐시 미기록, 재동의 후 정상 재조회, 차량별·사용자별 격리(같은 차량을 가진 다른 계정 포함). 각 보호 장치를 하나씩 지운 변형에서 해당 테스트가 실패함을 확인 |
| 서비스 흐름 (`service.test.mjs`) | MOCK_PASS | state 불일치·재사용·만료·다른 세션, 동의 미완료, 바인딩 없음, 차량 ID 불일치, 토큰 만료와 갱신 실패, 오류 구분, Rate Limit, 철회(진행 중 응답 폐기 포함), 계정 삭제, 연결 해제, 지역 제한(KR은 요청 0회), 비밀·식별자 비노출, SDK/REST 블록 분리 |
| HTTP·SSRF (`http.test.mjs`) | PASS | Origin 고정, 경로 주입, Redirect 거부, TLS 비활성 거부, 타임아웃·취소·네트워크 오류, 크기·Content-Type·압축·중복 키 |
| 모델·가용성 (`model.test.mjs`) | PASS | 기본 DISABLED → NOT_CONFIGURED → REGION_UNSUPPORTED → BLOCKED. 실연결 상태가 되는 경우 없음 |
| 경계 (`boundary.test.mjs`) | PASS | Render 진입점 6개 import 그래프, server·Android·mobile·3D 소스와 workflow에 provider 호스트 없음, fixture 전용 플래그, 의존성 없음 |
| 3D 카드 외부 블록 (`external-vehicle-data.test.mjs`) | PASS 5 | 기본 미표시(기존 카드와 동일), MOCK 표시, 숫자 비노출, 투영 계약 거부 13종, 상태 문구 |
| three-poc 전체 / 패키징 | PASS 348 (기존 TODO 1) / 4 | |
| 차량 브라우저 회귀 (실제 GLB): consistency·panels·part-labels·results·history·toast·part-UX 기준선 | 7/7 PASS | 로컬 Chrome. 증거는 저장소 밖 `C:\CarScope-External\p14b` |
| 실제 페이지 fixture 확인 | 확인 | 기본 페이지에는 외부 블록 없음. `?externalVehicleData=fixture`에서 PLEOS > MOCK > AI > 직접 점검 순서. 페이지 오류 0, 외부 Origin 요청 0 |
| Android 단위 / lint / Debug·Release APK·AAB | 288/288 / PASS / PASS | Android 코드 변경 없음 |
| `check.py boundary`·`sdk-audit`, sync boundary, Kotlin→JS 계약(타이어·컴포넌트), core | PASS | |
| inspection-sync-poc 전체 | 270 pass / 1 fail / 41 skip | 실패는 기존 `avd-setup-script`(한글 사용자 경로의 임시 디렉터리). 이번 변경과 무관 |
| 실제 Hyundai·Pleos 호출, OAuth 로그인, 동의, 실차 데이터 | **NOT_RUN / BLOCKED** | 자격 증명·승인·토큰 저장소 없음 |
| AVD, Render 배포 | NOT_RUN | 범위 밖 |

## 8. 활성화 차단 사유와 필요한 것

| 필요 항목 | Hyundai Developers | Pleos Vehicle Data API |
|---|---|---|
| 개발자 계정·프로젝트 | Developers 회원가입, 콘솔 신규 프로젝트(Client ID·Secret) | Pleos Playground 가입, My Project, Vehicle Data API 신청과 **심사 승인** |
| Redirect·Callback URL | 계정 API Redirect URL, 데이터 API Redirect URL, 데이터 API Callback URL 등록 | 로그인 리다이렉트 URL, 동의완료 리다이렉트 URL, 동의철회 콜백 URL 등록 |
| 차량·지역 | 본인 명의 CCS(Bluelink) 가입 차량을 콘솔 「내 차량 등록」에서 활성화. 대고객은 상용화 승인 후 | **유럽 34개국** 차량과 커넥티드 서비스. 한국 차량은 불가 |
| 토큰 저장소 | 암호화 저장소(DB 밖에서 관리하는 키)를 구현·검토해 `APPROVED_TOKEN_STORES`에 등록 | 같음 |
| 바인딩·동의·철회 상태 | 지금은 프로세스 메모리에만 있다. 재시작 후에도 철회 차단이 유지되도록 영속 저장소가 필요하다 | 같음 |
| 동의 화면 | 토큰 없이 동의 화면을 여는 방법을 Hyundai에 확인 | `select-vehicles`의 `gwToken`을 노출하지 않는 방법과 GET/POST 불일치를 Pleos에 확인 |
| 콜백 인증 | 데이터 제공 불가 알림의 발신자 검증 방법을 확인한 뒤 별도 승인된 서버에만 라우트 노출 | 동의 철회 콜백도 같음 |
| 운영자 설정 | `CARSCOPE_HYUNDAI_DEVELOPERS_APPROVAL=OPERATOR_APPROVED`, `HYUNDAI_DEVELOPERS_CLIENT_ID`·`_CLIENT_SECRET`·`_REDIRECT_URI` | `CARSCOPE_PLEOS_VEHICLE_DATA_APPROVAL`, `PLEOS_VEHICLE_DATA_CLIENT_ID`·`_CLIENT_SECRET`·`_LOGIN_REDIRECT_URL`·`_BRAND`, `CARSCOPE_PLEOS_VEHICLE_DATA_COUNTRY` |
| 서버 | 이 서비스를 호출하는 별도 진입점과 라우트(기본 Render 아님), 인증된 CarScope 세션 연결 | 같음 |
| 기타 확인 | Rate Limit·비용, 시각의 시간대, HTTP 401/403 의미, `dev.kr-ccapi` 용도 | Rate Limit·비용, 개발/상용 구분, 토큰 폐기 API |

## 9. 후속 E2E 절차 (승인 후, 별도 PR)

1. 위 8의 차단 사유를 해소한다. 토큰 저장소 승인, 동의 화면 방식 확인, 콜백 인증이 필요하다.
2. 별도 실험 서버에 진입점을 추가한다. 기본 Render는 DENY를 유지한다.
3. 개발 프로젝트에 본인 차량을 활성화한다. 그 뒤 로그인 → 토큰 → 동의 → 차량 목록 → 소유자 확인 바인딩 → 데이터 조회 순서로 진행하며, 각 응답이 이 문서의 계약과 맞는지 확인한다(LIVE 결과를 MOCK과 분리해 기록).
4. 실제 응답으로 단위·시간대·갱신 시점을 확인한 뒤에만 숫자 표시와 계산을 검토한다.
5. 별도 E2E에서 다음 순서를 검증한다: AVD 3D 점검 → 모바일 QR → 스마트폰 점검 → 차량 자동 반영 → SDK 상태 카드 → 외부 차량 데이터 연동 상태. 마지막에 철회 콜백 → 즉시 삭제와 재조회 차단을 확인한다.
