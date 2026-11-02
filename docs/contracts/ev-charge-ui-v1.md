# EV Charge UI v1 — 독립 충전구 상태 채널

정확한 Debug private-origin GET `/ev-charge-status.json`만 제공한다. query/fragment/userinfo/다른 host·port·method/encoded path는 거부한다. 다른 화면에는 provider가 없어서 404다. no-store/CSP 및 file/content/JS bridge 경계를 유지한다.

Envelope는 `{schemaVersion,sessionId,sequence,connectionStatus,sessionPhase,readings}`만 허용한다. schemaVersion=1은 **EV Charge UI 채널의 버전**이며 Component UI v1 확장이 아니다. sessionId는 동일 Native channel lease의 UUID, sequence는 1..2^53-1이다. 네 Feature projection과 sequence를 공유하므로 한 consumer에서 번호가 건너뛰는 것은 정상이며 반드시 증가해야 한다. 서로의 packet은 validator가 거부한다. phase와 connection enum/소유권 의미는 [Component UI v1](vehicle-component-ui-v1.md)과 같다.

readings는 한 행이며 정확히 `{featureId,vehiclePartId,capabilityStatus,availabilityStatus,source,observedAt,value,unit}`이다. featureId=`ev-charge.port-open`, vehiclePartId=`ev-charge.port`, value=Boolean 또는 null, unit=null이다. raw reason/예외/VIN/계정·차량 identity/geometry/각도를 전달하지 않는다. `ev-charge.flap` 선택도 같은 포트 보고 패널을 참조하지만 별도의 센서나 API ID로 만들지 않는다.

capabilityStatus는 UNVERIFIED/SUPPORTED/UNSUPPORTED/PERMISSION_DENIED/ERROR. READ/READ_WRITE 확인 후에만 getter/listener를 요청한다. availabilityStatus는 위 값 + UNAVAILABLE/STALE. 초기·대기·unknown 타입은 UNVERIFIED, null은 UNAVAILABLE, 권한 실패는 PERMISSION_DENIED, 기타 실패/timeout/잘못된 clock은 ERROR다. 유효 Boolean 보고가 수신된 경우만 SUPPORTED이며 5000ms 초과 시 STALE. value와 observedAt은 함께 존재하거나 함께 null이다. observedAt은 앱 callback 진입 시 수신 Unix ms로, 차량 하드웨어 시각이나 화면 갱신 시각이 아니다. Boolean의 false도 유효한 SDK 보고이며 정상·충전·잠금·안전 판단이 아니다. SDK parseBoolean 변환의 원본 raw 한계는 [결정 기록](../p4-b3-charge-port-integration.md)에 둔다.

ATTACHED의 source는 PLEOS 또는 명시적인 합성 MOCK다. STOPPED/SUPERSEDED는 source/value/observedAt=null, 두 status=UNVERIFIED. consumer는 old/duplicate sequence와 예상 밖 owner를 거부하며 lifecycle reset 뒤에만 새 owner를 받는다. 실패 시 이전 값/시각을 지우고 ERROR/UNAVAILABLE로 표시하되 source를 자동 MOCK으로 바꾸지 않는다.

기존 Component SDK session/worker/immutable cache를 공유한다. 별도 Vehicle 초기화, platform property fallback, polling 기반 SDK 재조회가 없다. listener 우선 순서/중복 callback/즉시 stop epoch/timeout≠cancel/실제 pending drain 후 release/cleanup 실패 격리는 기존 계약과 동일하다. lease를 두 개 attach하여 서로 supersede하지 않고 같은 ComponentUiChannel에서 두 projection을 만든다. Activity stop/resume/recreation은 두 채널에 같은 ownership 생명주기를 적용한다.

Web client는 기존 단일 in-flight/no-store/credentials omit/redirect error/3초 abort/완료 후 1초 polling을 사용한다. 이는 Native cache 조회이며 SDK 호출 주기가 아니다. component active/inactive, visibility hidden, renderer dispose에서 generation을 무효화한다. 채널 업데이트는 선택/카메라/Geometry/USER_REPORTED를 변경하지 않는다.

정적 닫힘 형상과 API Boolean은 독립이다. OPEN 보고에 힌지/각도/소켓/충전 동작을 합성하지 않는다. 형상은 ESTIMATED_GEOMETRY, 실차 UID grant/capability/getter/listener는 NOT_RUN이다. Release에는 채널·권한·자산을 포함하지 않는다.
