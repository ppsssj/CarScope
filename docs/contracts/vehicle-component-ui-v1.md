# Vehicle Component UI v1 — Safety / EV 상태 계약

SDK 2.3.2의 공개 조회 선언과 합성 검증 범위다. 실제 차량 지원·권한·수신은 NOT_RUN이다. Geometry ID를 변경하지 않으며 USER_REPORTED 점검 기록과 결합하지 않는다.

| featureId | vehiclePartId | 공개 경로/형식 | 이번 표시 범위 |
| --- | --- | --- | --- |
| `safety.washer-fluid-warning` | `washer-fluid-cap` | Safety.checkLowWasherFluidWarningStateCapabilities / hasLowWasherFluidWarning, Boolean? | 기존 워셔액 상세, SDK true/false 보고만. false를 차량 정상/액량 충분으로 변환하지 않음 |
| `safety.brake-fluid-level` | `brake-fluid-reservoir` | Safety.checkBrakeFluidLevelStateCapabilities / getBrakeFluidLevelState, OilLevelState? | 기존 브레이크액 형상 상세. 선언된 LOW/HIGH/NORMAL/CRITICALLY_LOW를 SDK enum으로만 표시. NORMAL도 안전 판정이 아님 |
| `ev-battery.soc` | `ev-battery.pack` | EvBattery.checkEvBatteryStateOfChargeCapabilities / getEvBatteryStateOfCharge, Int? | 데이터/캐시/JSON 및 P4-B2 하부 보기 패널. 단위·범위 UNVERIFIED, `%`·0~100 범위·배터리 건강도 추정 금지 |
| `ev-battery.charge-switch` | `ev-battery.pack` | EvBattery.checkEvChargeSwitchCapabilities / getEvChargeSwitchState, Boolean? | 데이터/캐시/JSON 및 P4-B2 하부 보기 패널. switch 보고이며 실제 충전 진행/완료/전력 상태로 사용 금지 |

Safety의 위 메서드와 register/unregister는 `pleos.car.permission.CAR_SAFETY`, 위 EV 메서드와 SoC register/unregister는 `pleos.car.permission.CAR_ENERGY`다. READ/READ_WRITE capability만 읽으며 제어/SET/CONTROL 권한은 추가하지 않는다. brake는 capability의 advertised enum 집합도 확인한다. 공개 listener는 washer/brake/SoC에만 등록한다. charge-switch listener는 만들어 내지 않는다.

## Native cache와 lifecycle

`Vehicle → SdkComponentSession → PleosComponentDataSource → immutable ComponentSnapshot → ComponentUiProjection`이다. Android/Pleos 타입은 Debug app 경계에만 있다. 공용 vehicle-core를 수정하지 않는다. SDK는 단일 ComponentWorker에서 처리하며 화면/GET은 즉시 cache만 조회한다. capability와 availability를 독립 보존한다.

- capability: `UNVERIFIED`, `SUPPORTED`, `UNSUPPORTED`, `PERMISSION_DENIED`, `ERROR`. 메서드 존재를 SUPPORTED로 만들지 않는다. 초기/NULL capability는 UNVERIFIED, access에 읽기 권한이 없으면 UNSUPPORTED다. READ가 있어도 brake advertised 집합이 null이면 UNVERIFIED, 빈 집합이면 UNSUPPORTED다.
- availability: 위 상태 + `UNAVAILABLE`, `STALE`. capability 이후 getter 대기는 UNVERIFIED, null getter는 UNAVAILABLE다. 알려지지 않은 타입/enum/advertised 밖 값은 UNVERIFIED이며 값을 지운다. SDK OilLevelState.ERROR 또는 잘못된 clock/예외/timeout은 ERROR다. UNKNOWN을 NORMAL로 바꾸지 않는다.
- 값이 있는 행은 capability SUPPORTED이고 실제 callback이 수신된 것이다. Boolean/검증된 enum은 SUPPORTED availability, 원시 SoC Int는 의미/단위가 미검증이므로 UNVERIFIED다. SDK ERROR/unknown/null은 value/observedAt을 비우고 source는 PLEOS로 유지한다.
- observedAt은 **APP_CALLBACK_RECEIPT_UNIX_MS**, callback 진입 직후 worker queue 전에 채집한다. SDK가 제공한 차량 하드웨어 관측 시각은 아니다. cache 조회/render tick/재직렬화는 이를 덮어쓰지 않는다. 유효 관측 age가 5000ms를 초과하면 STALE이며 마지막 value/source/observedAt을 유지한다. 미래/음수 clock은 ERROR다.
- 먼저 listener를 등록하고 초기 getter를 보낸다. 더 최근 listener 값/오류 뒤에 도착한 getter는 무시한다. complete/failed 중복은 한 번만 소비한다. charge-switch는 초기 getter만 있으며 주기적 재조회나 가상 listener를 추가하지 않는다.
- stop/close는 atomic epoch를 즉시 무효화한다. queue에 들어온 이전 callback도 다시 publish하지 못한다. process owner의 새 lease가 이전 소유자를 대체하고 이전 Activity의 detach는 새 owner를 멈추지 못한다. resume 때 새 WebView 세대로 시작한다.
- 10000ms callback timeout은 ERROR 표시이며 취소가 아니다. 실제 pending이 남으면 release/reinitialize를 강행하지 않는다. 늦은 callback은 pending을 한 번 소진하지만 값은 적용하지 않는다. unregister/release 실패는 UNRESOLVED 격리이며 새 session을 열지 않는다. 원격 정리 완료를 로컬 CLOSED/반환으로 증명하지 않는다.
- SDK 메서드 자체가 worker를 영구 block하면 timer/cleanup도 지연된다. 영구 무응답이면 worker/session 참조가 남을 수 있다. 실제 Tire/Door/새 Component SDK client의 병행 동작과 Service 정리는 기기 통합 검증 항목이다.

## 제한된 JSON

Debug Inspection private origin의 **GET `/component-status.json`**만 제공한다. HTTPS, 정확한 host, port -1/443, raw path 일치, query/fragment/userinfo 없음만 허용한다. callable JS Interface, 외부 URL, file/content 권한을 추가하지 않는다. 다른 Debug 화면에는 provider가 없어 404다. API 상태 응답은 no-store 및 기존 CSP를 유지한다.

Envelope는 정확히 `{schemaVersion,sessionId,sequence,connectionStatus,sessionPhase,readings}`다. schemaVersion=1, sessionId=소문자 UUID 형식의 **WebView 소유권 세대**(차량/사용자 ID 아님), sequence=1..2^53-1, readings는 위 4개 feature가 중복/누락 없이 존재한다. connectionStatus=ATTACHED/STOPPED/SUPERSEDED, sessionPhase=IDLE/ACTIVE/STOPPING/UNRESOLVED/CLOSED. 이는 앱 소유권/로컬 정리 진단이며 SDK 연결 성공이 아니다.

각 행은 정확히 `{featureId,vehiclePartId,capabilityStatus,availabilityStatus,source,observedAt,value,unit}`다. unit은 항상 null이다. value는 feature별 Boolean/허용된 enum/32-bit signed Int 또는 null이다. 임의 reason/예외/SDK 객체/VIN/계정/좌표/모델 정보를 전달하지 않는다. unknown/ERROR enum 문자열을 신선한 값으로 직렬화하지 않는다. observedAt은 null 또는 0..8640000000000000의 정수이며 value와 함께 존재하거나 함께 null이다. 유효 value의 availability는 Boolean/enum에서 SUPPORTED/STALE, SoC에서 UNVERIFIED/STALE만 허용한다.

ATTACHED의 source는 모두 PLEOS 또는 모두 MOCK이다. Native 일반 경로는 PLEOS만 사용한다. STOPPED/SUPERSEDED는 source/value/observedAt을 null, 두 상태를 UNVERIFIED로 비운다. 같은 세대의 old/duplicate sequence와 예상 밖 세대는 적용하지 않는다. 세대 변경은 lifecycle reset 뒤에만 허용한다. transport/schema 오류는 이전 값·관측 시각을 비우고 ERROR/UNAVAILABLE로 표시하며 기존 선택 source를 보존한다. 자동 MOCK fallback은 없다.

Web client는 단일 in-flight 요청과 완료 후 1초 polling, 3초 fetch abort를 사용한다. 이것은 SDK 호출/취소가 아니다. inactive/hidden/dispose에서 abort와 request generation 무효화로 늦은 응답을 버린다. 데이터 변경은 상세의 상태 영역만 갱신하고 선택/Geometry/카메라/USER_REPORTED 기록을 재생성하지 않는다. API 데이터 출처와 기존 모델의 ESTIMATED/UNVERIFIED 정확도 안내는 서로 독립이다.

Desktop 합성 실행은 loopback 서버의 `CARSCOPE_COMPONENT_UI_FIXTURE`와 `?componentStatus=fixture`를 명시해야 한다. 파일의 모든 행이 MOCK이어야 한다. fixture와 외부 GLB는 Android/Release에 포함하지 않는다. Android shell은 Native cache client만 활성화한다. EV pack 선택 UI는 A의 모델 PR #44 병합 후 P4-B2 별도 통합 PR에서 연결하며 wire v1과 데이터 의미는 변경하지 않는다.
