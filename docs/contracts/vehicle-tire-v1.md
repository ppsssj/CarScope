# Vehicle Tire v1 · CarScope 공통 데이터 계약

상태: **v1 구현**, Pleos SDK 2.3.2 정적 API 대조 완료. AVD 실제 지원/관측은 별도 검증이며, 이 문서는 실행 성공을 의미하지 않는다. 3D 매핑 브랜치나 메시를 참조하지 않는다.

## 식별자

좌우는 차량이 전방으로 진행하는 기준이다. SDK area 명칭과 3D 메시 이름을 wire ID로 사용하지 않는다.

| vehiclePartId | 의미 | app 경계에서만 사용하는 SDK 단일 영역 |
|---|---|---|
| `tire.front-left` | 앞 왼쪽 | `WheelArea(WheelValue.LEFT_FRONT)` |
| `tire.front-right` | 앞 오른쪽 | `WheelArea(WheelValue.RIGHT_FRONT)` |
| `tire.rear-left` | 뒤 왼쪽 | `WheelArea(WheelValue.LEFT_REAR)` |
| `tire.rear-right` | 뒤 오른쪽 | `WheelArea(WheelValue.RIGHT_REAR)` |

featureId는 `tire.pressure` 또는 `tire.low-pressure`다. 두 feature × 네 ID = 8행이며 `(featureId, vehiclePartId)`가 고유 key다. `low-pressure`는 SDK `getLowTirePressure` 원시 채널 이름이다. boolean 경고나 정비 기준으로 해석하지 않는다.

## 행의 필드

| 필드 | v1 자료형과 의미 |
|---|---|
| `featureId` | 위 두 문자열 중 하나 |
| `vehiclePartId` | 위 네 문자열 중 하나 |
| `apiDomain` | `Tire` |
| `capabilityStatus` | CarScope 상태. `SUPPORTED`, `UNSUPPORTED`, `PERMISSION_DENIED`, `UNVERIFIED`, `ERROR` |
| `availabilityStatus` | 위 상태 + `STALE`. capability와 관측 가용성은 독립 |
| `value` | nullable finite Float. 실제 콜백 원시 값이며 변환된 PSI/kPa나 경고 enum이 아님 |
| `unit` | **v1은 null**. 단위를 확인하지 못했으므로 label/변환/가정을 하지 않음 |
| `observedAt` | nullable 비음수 Long, Unix epoch milliseconds. 앱의 실제 SDK 콜백 진입 시각. 차량 하드웨어 관측 시각이 아님 |
| `source` | `PLEOS` 또는 `MOCK`. 실패·미지원·정지 중에도 선택 출처 보존 |
| `reason` | null/timeout/오류/미검증의 진단 문자열. 소비자는 이를 파싱해 상태를 추측하지 않음 |

Kotlin 정의는 `vehicle-core/.../vehicle/tire/TireData.kt`이며 Android/Pleos import가 없다. `TireSnapshot`은 방어적으로 복사한 변경 불가능한 8행 목록을 제공한다. 한 snapshot 안에서 출처를 혼합하지 않는다. `TireDataSource.readSnapshot()`은 SDK를 호출하지 않는 즉시 cache 조회다. `MockTireDataSource`는 호출자가 명시적으로 제공한 MOCK 관측만 사용하며 기본 공기압을 생성하지 않는다.

Debug probe의 JSON 표현은 `schemaVersion: 1`, `sdk: "2.3.2"`, `timestampBasis: "APP_CALLBACK_RECEIPT_UNIX_MS"`, `readings: [위 8행]`이다. 부품 식별자에는 SDK 클래스·enum·3D 메시 이름을 사용하지 않는다. `reason`에는 예외 클래스명 등 진단 정보가 포함될 수 있지만 통합 key가 아니다. null 필드는 JSON null로 유지한다. 소비자는 차량 부품 ID로만 3D 대상에 연결한다.

## 상태의 해석

- `SUPPORTED` capability: 해당 실행에서 READ/READ_WRITE와 **정확한 단일 바퀴 area**가 확인됨. AAR에 메서드가 있다는 뜻과 구별한다.
- `UNSUPPORTED`: capability에서 읽기 접근 또는 해당 단일 영역이 없음. `value=null`, `observedAt=null`이다. API 오류나 미실행을 UNSUPPORTED로 대체하지 않는다.
- `PERMISSION_DENIED`: 사전 permission 검사 또는 `SecurityException`으로 거부됨. capability 요청 거부는 capability에도 반영한다. 이후 getter/listener에서 거부되면 이미 확인한 capability는 보존하고 availability만 거부한다.
- `UNVERIFIED`: 아직 미조회, null capability/값, 결합된 바퀴 영역의 단일 바퀴 해석 미검증, 또는 단위·의미가 미검증인 실제 원시 값이다. capability가 SUPPORTED인 성공 콜백의 finite 비음수 원시 Float만 value에 보존할 수 있다. **0이 반환되어도 정상 공기압이나 정상 상태를 뜻하지 않는다.**
- `ERROR`: 예외·요청 timeout·NaN/Infinity/음수·잘못된 clock. 오류를 빈 값·0·정상 상태로 바꾸지 않는다.
- `STALE`: 유효한 원시 관측의 나이가 **5,000 ms 초과**. 기존 CarScope 보수적 표시 정책을 유지한 값이며 Tire 주기 보장이 아니다. 마지막 원시 값과 수신 시각·출처를 보존하되 신선한 값으로 표시하지 않는다. 단위 미검증 조건도 계속 적용된다.

모든 상태는 CarScope 내부 모델이며 Pleos SDK enum이 아니다. 현재 SDK callback에 검증된 단위가 없으므로 v1 어댑터는 raw 수신 성공 후 availability를 UNVERIFIED로 유지한다. SUPPORTED availability를 근거 없이 출력하지 않는다. 단위/의미를 확인해 변경하려면 이 계약과 테스트를 함께 갱신한다.

화면 갱신·cache 조회·capability 응답은 새 관측이 아니다. 동일 값의 실제 새 listener 이벤트는 새 관측이다. getter의 중복 complete/failed는 한 번만 소비하고, 더 최근 listener 이벤트나 실패 뒤에 온 초기 getter는 무시한다. 음수/미래 clock은 ERROR, age 0~5,000 ms는 경계 안이다.

## 비동기와 수명주기

SDK와 controller는 app debug 경계에 있고 모든 상태 변경은 단일 worker에서 직렬화한다. 기능별 capability를 독립 조회하며, raw pressure에만 존재하는 listener를 등록한다. Low 계열 listener를 만들어 내지 않는다. 콜백 수신 시각은 worker 대기 전에 채집한다.

요청 timeout은 **10,000 ms**이며 STALE 5,000 ms와 별개다. timeout은 ERROR이고 미지원 증거가 아니다. SDK 공개 취소 API를 확인하지 못했으므로 timeout으로 실제 IPC가 취소됐다고 간주하지 않는다. stop은 소유권을 무효화하고 등록한 같은 영역/listener를 해제한다. 실제 진행 중 콜백을 회수한 뒤 release한다. 정리 중 재시작 요청은 해당 source의 이전 session 정리 뒤 처리한다.

SDK가 콜백을 영원히 보내지 않으면 release/worker 종료가 pending으로 남을 수 있다. SDK 메서드 자체가 worker를 막으면 timeout/정리 실행도 지연될 수 있다. 해제 호출 반환도 Service 완료 acknowledgement가 아니다. 이 경우 종료 성공으로 보고하지 않는다. 새 Activity/source는 이전 관측을 복원하지 않고 UNVERIFIED부터 시작하며, 이전 소유자의 콜백은 그 source의 cache를 갱신하지 못한다.

v1은 센서 진단, 임계값 판정, 타이어 공기압 권고, 차량 제어, UI 색상 의미, 3D 메시 매핑을 정의하지 않는다. 값과 상태의 표시 방식은 이 계약의 미검증/미지원 구분을 유지해야 한다.
