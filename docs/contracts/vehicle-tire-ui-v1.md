# Vehicle Tire UI v1 — 상태 전용 Native → WebView 계약

P3-I1. [vehicle-tire-v1](vehicle-tire-v1.md)의 상태 metadata만 투영한다. 원시 계약과 SDK API/enum은 변경하지 않는다. 압력 값·단위·정상 판정·제어 기능은 이 계약에 없다.

## 채널과 수명주기

Android Debug `InspectionActivity`의 private origin `https://carscope-inspection.invalid`에서 **GET `/tire-status.json`**만 제공한다. query/fragment/userinfo/다른 port/다른 origin/POST는 허용하지 않는다(기본 HTTPS 443은 같은 origin). 다른 Debug 화면에는 provider가 없어 이 경로를 제공하지 않는다. `DebugWebScreen`의 자체 asset interception, `Cache-Control: no-store`, 기존 CSP `connect-src 'self'`, file/content access 및 외부 navigation 차단을 유지한다.

요청은 `TireProcessOwner → TireProbeOwner.ownedSnapshot(lease) → PleosTireDataSource.readSnapshot()`의 즉시 캐시 조회다. HTTP polling은 SDK getter·initialize·새 listener·새 session을 만들지 않는다. SDK 객체나 callable JavaScript Interface를 노출하지 않는다. 직렬화는 Native의 명시적 allowlist이며 임의 진단 문자열을 사용하지 않는다.

원격 연결 완료와 앱의 lease 소유권을 구분한다. `sessionId`는 UUID 형식의 **WebView 소유권 세대**이며 차량/사용자/SDK session 식별자가 아니다. resume마다 새 UUID, 같은 세대에서 증가하는 sequence를 사용한다. 두 Debug Activity는 한 process owner/controller/worker를 공유하고 최신 lease만 데이터를 받는다. 이전 lease의 stop/detach는 새 소유자를 중지하지 못한다.

고정 이벤트 `carscope-tire-inactive`는 Native pause 전에, `carscope-tire-active`는 resume 때 발생시킨다. evaluateJavascript에 데이터·URI·예외 문자열을 삽입하지 않으며 두 고정 이벤트 외의 native 함수를 노출하지 않는다. 웹은 inactive/visibility hidden/dispose에서 요청을 abort하고 request generation을 무효화해 늦은 응답을 폐기한다. Native도 stop에서 lease를 해제하고 epoch를 무효화한다. resume 시 fresh cache projection만 받는다.

## JSON envelope

허용된 키 외의 필드는 거부한다. 최대 8,192 JS 문자, 전체 8개 행을 한 packet으로 검증한 뒤 교체한다.

| 필드 | 값 |
|---|---|
| schemaVersion | 정수 `1` |
| sessionId | 소문자 hexadecimal UUID 형식 |
| sequence | `1..9007199254740991` 정수, 같은 세대에서 증가 |
| connectionStatus | `ATTACHED`, `STOPPED`, `SUPERSEDED` |
| sessionPhase | `IDLE`, `ACTIVE`, `STOPPING`, `UNRESOLVED`, `CLOSED`, `UNVERIFIED` |
| readings | 정확히 8개 행 |

`ATTACHED`는 화면이 앱의 cache lease를 소유한다는 뜻이며 SDK 서비스 연결 성공이나 센서 수신 증거가 아니다. `STOPPED`/`SUPERSEDED`에서는 각 행의 source/observedAt을 null로, 두 상태를 UNVERIFIED로 비운다. 원격 release 완료는 모든 phase에서 미검증이다. 특히 `UNRESOLVED`는 요청·정리 미완료 진단이며 TireStatus에 추가하지 않는다.

## 행: 2 feature × 4 부품

| featureId | vehiclePartId |
|---|---|
| tire.pressure | tire.front-left / tire.front-right / tire.rear-left / tire.rear-right |
| tire.low-pressure | tire.front-left / tire.front-right / tire.rear-left / tire.rear-right |

좌우는 차량 진행 방향 기준이다. `(featureId, vehiclePartId)` 8개 조합은 중복·누락 없이 존재해야 한다. SDK WheelArea나 GLB 메시명은 전달하지 않는다. 소비자는 `vehiclePartId`로만 기존 3D 대상을 찾는다.

| 행 필드 | 제한 |
|---|---|
| featureId / vehiclePartId | 위 고정 집합 |
| capabilityStatus | SUPPORTED / UNSUPPORTED / PERMISSION_DENIED / UNVERIFIED / ERROR |
| availabilityStatus | 위 상태 + STALE |
| observedAt | null 또는 비음수 정수 Unix epoch ms, JS Date 범위 이내. PLEOS는 앱 SDK callback 수신 시각, MOCK은 명시적 합성 시각 |
| source | PLEOS / MOCK / null. packet 안에서 혼합하지 않음. ATTACHED에서는 null 불가 |

STALE은 observedAt이 있어야 한다. 관측 시각이 있으면 capability는 SUPPORTED, availability는 SUPPORTED/UNVERIFIED/STALE 중 하나여야 한다. 시각을 전달해도 raw value는 전달하지 않는다. Native snapshot의 기존 `>5000ms` STALE 판정을 사용하며 화면 갱신 시각으로 관측을 만들지 않는다.

**전달 금지:** `value`, `unit`, `reason`, raw Float, SDK 객체, 예외 메시지, 차량 식별 정보, 진단 결과·건강 점수. null 값의 금지 필드도 추가하지 않는다. SUPPORTED는 API 지원 여부이고 정상 공기압을 뜻하지 않는다. 단위 환산·저압·안전 판정은 하지 않는다.

## 수신과 화면 갱신

- 단일 in-flight fetch, 완료 후 1초 재조회. transport timeout 3초는 fetch abort일 뿐 SDK 요청 취소가 아니다.
- 같은 세대의 이전/중복 sequence와 다른 sessionId는 적용하지 않는다. 예상 밖의 세대 변경은 이전 관측을 비우고 UNAVAILABLE로 표시한다. lifecycle reset 후에만 새 세대를 수용한다.
- 구조·ID·상태·origin 혼합·추가 필드가 잘못되면 적용하지 않는다. transport/검증 실패 시 이전 관측을 비우고 Availability ERROR 및 내부 연결 상태 UNAVAILABLE을 표시한다. 이전 선택 출처는 보존하며 MOCK으로 전환하지 않는다.
- 초기 미연동은 내부 DETACHED, source/observedAt null 및 UNVERIFIED다. DETACHED/UNAVAILABLE은 웹 연결 진단이며 Native wire의 TireStatus가 아니다.
- UI에는 두 feature의 Capability/Availability/최근 관측 시각을 각각 표시한다. session 진단은 별도 영역이다. 같은 metadata에 sequence만 바뀌면 DOM을 갱신하지 않는다.
- 실제 변경도 상태 영역만 교체한다. 3D 모델·선택·강조·카메라·목록 버튼을 다시 만들지 않는다.

Android에는 mock 선택 경로를 추가하지 않았다. 데스크톱 합성 검사는 로컬 서버의 명시적 `CARSCOPE_TIRE_UI_FIXTURE`와 `?tireStatus=fixture`로만 켜며 전 행을 MOCK으로 표시한다. 이 경로는 Android asset에 포함되지 않는다. 실제 Pleos AVD 및 실차 검증은 별도다.
