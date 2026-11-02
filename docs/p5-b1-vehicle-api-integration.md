# P5-B1 Vehicle API 및 3D 점검 연동

기준 `origin/main=5951b1ddbd1b63464b32db1093c36f4cde3c46d0`, worktree `C:/dev/CarScope-p5-b1-vehicle-api`, branch `feat/p5-b1-vehicle-api-integration`. A의 모바일 타이어 AR/다른 worktree/Geometry/외부 GLB/Sync/vehicle-core/Release 정책은 변경하지 않는다. 연구·아키텍처·구현·검증 스킬을 기존 구조에 적용한다.

## 근거와 결정

FACT: 고정 Vehicle 2.3.2 AAR의 `checkWiperStateCapabilities(Function2<CapabilityConfig,Map<WindowArea,List<WiperState>>,...>)`, `getCurrentWiperState(WindowArea,...)`, register/unregisterWiperState와 WiperStateListener의 nullable enum callback을 대조했다. 권한은 CAR_WINDOWS. 영역은 WindowArea(WindowValue.FRONT_WINDSHIELD)이며 exact single area만 사용한다. OTHER/OFF/ON/SERVICE의 실제 광고 집합 안 값만 수신한다. OTHER는 정상/정지로 바꾸지 않고 원시 OTHER + UNVERIFIED로 표시한다.

FACT: Light의 low/high capability(Function2<CapabilityConfig,List<LightState>>), getter, register/unregister 및 LightStateListener를 확인했다. 권한은 CAR_LIGHTS. OFF/ON/DAYTIME_RUNNING 중 실제 광고 집합만 사용한다. 두 상태는 좌우 영역 인자가 없는 전역 보고다. setter/속도·각도·마모·광도·광축·고장 판정을 추가하지 않는다.

공식 상세 웹 문서는 일부 제목만 읽을 수 있어 AAR가 선언 근거다: [Wiper](https://document.pleos.ai/api-reference/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/wiper/get-current-wiper-state), [Light](https://document.pleos.ai/api-reference/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/light/get-current-low-beam-light-state). 웹에서 확인되지 않은 단위·의미를 다른 업체/API 지식으로 채우지 않는다.

DECISION: 기존 Component SDK session/worker/cache/lease를 재사용한다. 새 Wiper/Light domain은 lazy 초기화하여 해당 domain 접근 실패가 기존 Safety/EV 초기화를 깨뜨리지 않게 한다. Debug에 조회 CAR_WINDOWS/CAR_LIGHTS만 추가한다. 기존 Component v1 네 행 및 EV Charge v1 한 행은 유지하고 독립 `/visibility-status.json`의 고정 세 행으로 확장한다. SDK polling을 추가하지 않고 Native cache GET만 제공한다. 기존 callback 시간/우선순위/실제 pending drain/timeout≠cancel/cleanup 격리를 유지한다.

| 대안 | 판단 |
| --- | --- |
| Component UI v1에 행 추가 | 기존 strict contract를 깨므로 사용하지 않음 |
| 도메인별 새 Vehicle/DataSource | 무거운 중복 및 lifecycle 경합이 늘어 사용하지 않음 |
| 기존 세션 + 독립 Visibility UI v1 | 기존 wire와 client 수를 보존하므로 선택 |

UI는 A의 measured front-wiper builder와 기존 GLB low/high marker/housing을 재사용한다. 전면 유리 한 상태를 좌우 두 와이퍼에 공통 표시하며 실제 자세를 합성하지 않는다. 전조등 marker는 위치/의미 표식일 뿐 광학 bulb/좌우 센서가 아니다. housing이 가리는 marker는 차체를 뚫어 선택하거나 전후 전체 housing을 단일 bulb로 재분류하지 않고 목록/확보된 시점으로 접근한다.

## 실제 기기 Gate

기존 `python tools/tire-probe/runtime/run.py --sdk C:/Android/Sdk --serial emulator-5554 --out C:/CarScope-External/p5-b1/health-initial`을 --run/--install 없이 실행했다. **BLOCKED: 지정 target absent/offline**. 다른 기기에 guest 명령을 보내거나 emulator/SystemUI/Service를 시작·재시작하지 않았다. SDK Capability/getter/listener·실제 Android 종료 안정성은 BLOCKED/NOT_RUN이며 합성 성공으로 승격하지 않는다.

## 타이어 수치·SoC 및 Release 범위

타이어 pressure는 PRIVATE_CAR_SAFETY, low-pressure는 CAR_SAFETY이며 둘 다 nullable Float다. 현재 Tire UI v1은 raw value/unit/reason을 금지한다. 단위·의미·실제 권한 grant와 수신이 확인되지 않아 수치 v2/psi/kPa/bar 환산을 도입하지 않는다. SoC도 raw Integer/단위·범위 UNVERIFIED를 유지한다. 실제 unit + exact WheelArea + grant + capability + 유효 callback을 증명한 다음 별도 수치 계약을 검토한다. private 권한 미획득 시 수치는 표시하지 않는다.

Release는 기존 정적 SVG/기존 Door 조회 권한만 유지한다. Debug 3D/API/권한을 Release로 옮기지 않는다. SDK AAR 안 공개 클래스가 Release에 존재하는 것과 새 어댑터가 제품에 포함되는 것은 별개다. 3D 제공에는 외부 GLB 배포 권리/CC BY attribution/패키징 크기·공급 경로, 최소 조회 권한 승인, driving restriction/사용성, 미지원 기기의 실패·종료/복원, 메모리/renderer/SDK Service 실측, 보안·origin 정책 및 별도 제품 승인이 필요하다. 외부 GLB를 무단 포함하지 않는다.

검증 결과·API별 7단계 상태·Release 후속 항목은 증거 인덱스와 PR 최종 HEAD에 기록한다. PR은 생성만 하며 병합하지 않는다.
