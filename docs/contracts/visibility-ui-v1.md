# Visibility UI v1

Debug private origin의 정확한 GET `/visibility-status.json`, no query/fragment/userinfo/encoded path/다른 host·port·method. CSP/no-store, JS bridge/file/content 경계 유지. 기존 Component v1 네 행, Charge v1 한 행, Tire v1 8행은 바꾸지 않는다.

Envelope는 `{schemaVersion,sessionId,sequence,connectionStatus,sessionPhase,readings}`만 허용한다. schemaVersion=1은 독립 Visibility 채널 버전이다. 나머지 UUID/sequence 범위·세션/owner/phase·즉시 stop/재개 reset 의미는 [Component](vehicle-component-ui-v1.md)·[Charge](ev-charge-ui-v1.md)와 같다. 기존 채널과 한 Native owner/counter를 공유하여 번호가 건너뛸 수 있으나 각 consumer에서는 증가해야 한다.

| featureId | vehiclePartId | 값 |
| --- | --- | --- |
| wiper.front.state | wiper.front | OTHER/OFF/ON/SERVICE 또는 null |
| light.low-beam | light.low-beam | OFF/ON/DAYTIME_RUNNING 또는 null |
| light.high-beam | light.high-beam | OFF/ON/DAYTIME_RUNNING 또는 null |

세 행은 중복/누락 없이 고정이다. 행은 `{featureId,vehiclePartId,capabilityStatus,availabilityStatus,source,observedAt,value,unit}`만 허용한다. unit=null. source=PLEOS/MOCK/null, capability=UNVERIFIED/SUPPORTED/UNSUPPORTED/PERMISSION_DENIED/ERROR, availability는 여기에 UNAVAILABLE/STALE 추가. 관측 시각의 JS Date 범위·null과 값의 동시성·단일 출처·STOPPED/SUPERSEDED의 null/UNVERIFIED 규칙은 기존 계약과 같다.

타입과 실제 capability 광고 집합이 확인된 수신값만 보존한다. 전면 exact single WindowArea가 없으면 UNSUPPORTED, 광고 목록 null은 UNVERIFIED, 목록 empty는 UNSUPPORTED. known OTHER는 원시 OTHER+UNVERIFIED, 그 외 valid mode는 SUPPORTED. 유효 관측 5000ms 초과 시 STALE, null은 UNAVAILABLE, UNKNOWN/타입·광고 불일치는 값을 비운 UNVERIFIED, 권한 실패는 PERMISSION_DENIED, 예외/timeout/invalid clock은 ERROR. null/UNKNOWN을 OFF·false·0·정상으로 바꾸지 않는다. 화면 polling으로 timestamp나 SDK getter를 만들지 않는다.

callback 수신 시각/source와 USER_REPORTED는 독립이다. callback 중복/역순·listener 우선·epoch 무효화·실제 pending drain 이후 release·cleanup 실패 격리는 기존 cache/controller를 재사용한다. visibility 상태는 새 Vehicle client가 아니다. 세 projection은 같은 lease를 공유한다.

automotive feature가 없는 host는 SDK 생성 전에 명시적인 UNSUPPORTED가 된다. 이를 일반 SDK 초기화 실패의 ERROR, 권한 거부의 PERMISSION_DENIED와 구분한다. 이 환경 gate도 실제 차량의 domain capability/UID grant를 대신하지 않는다.

Web의 단일 요청/no-store/credentials omit/redirect error/3초 abort/완료 후 1초 cache polling, replay/foreign owner 차단, lifecycle reset, 오류 시 값·관측 시간 비우기와 source 보존은 동일하다. 허용하지 않은 value/unit/reason/SDK 객체/예외/차량 ID/마모/광도/각도는 전달하지 않는다.

전면 유리 하나의 보고를 두 정적 와이퍼에 연결하고, 전역 low/high 보고를 좌우 기존 marker 선택에 연결한다. 좌우 센서·실제 블레이드 자세·속도·마모·광도·광축·고장 판정이 아니다. SDK 상태 변경은 모델/선택/카메라를 바꾸지 않는다. 실제 SDK 지원/권한·수신·Android 실측은 별도 gate다.
