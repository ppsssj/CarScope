# P4-B3 충전구 조회 및 UI 통합 결정

## Context / Constraints

기준 main `28c11bb7e9a373b6ba64f2b32b468ea84f4f2c43`, 독립 worktree `C:/dev/CarScope-charge-port-integration`. PR #47 Geometry/원본 GLB/vehicle-core/Sync/Release 정책과 PR #41 및 A worktree는 변경하지 않는다. AVD/adb·실차 관측은 NOT_RUN이다.

## API 근거와 Gate

Vehicle 2.3.2 AAR의 공개 `checkEvChargePortOpenCapabilities`는 CapabilityConfig callback, `isEvChargePortOpen`은 Boolean? callback, register/unregister는 같은 EvChargePortOpenListener 인스턴스를 사용한다. 오류는 Exception callback이다. 개별 annotation의 조회 권한은 `pleos.car.permission.CAR_ENERGY`이며 기존 Debug manifest에 이미 있다. Getter/listener의 deprecated WARNING은 제거·ERROR/HIDDEN이 아니다. 호출은 해당 함수에 한해 deprecation을 명시하고 checkSelfPermission 성공 및 READ/READ_WRITE capability 이후에만 한다. setter/control은 도입하지 않는다. 실제 UID의 grant·property 지원·getter/listener 수신을 정적 선언만으로 PASS 처리하지 않는다.

[Pleos 권한 가이드](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-permission)는 개별 RequiresPermission 확인을 요구한다. 상세 getter 웹 문서 본문은 읽을 수 없어 실제 고정 AAR와 PR #47 조사로 대조한다. AAR hash 및 재현은 증거 인덱스에 기록한다.

권고 대체인 [Android EV_CHARGE_PORT_OPEN](https://developer.android.com/reference/android/car/VehiclePropertyIds#EV_CHARGE_PORT_OPEN)은 Boolean/GLOBAL/ONCHANGE, 여러 포트 중 하나라도 열리면 true이다. 읽기는 normal [Car.PERMISSION_ENERGY_PORTS](https://developer.android.com/reference/android/car/Car#PERMISSION_ENERGY_PORTS) (`android.car.permission.CAR_ENERGY_PORTS`) 또는 signature/privileged control 권한이다. 이 앱에는 해당 Android 조회 권한 선언이 없고 실제 UID/CarService/property config 접근을 검증하지 않았다. Pleos CAR_ENERGY와 동일 권한으로 간주하지 않는다. 플랫폼 client·권한·자동 fallback은 추가하지 않는다.

**Gate: 공개 Pleos 조회 어댑터 구현 가능, 실제 차량 접근 NOT_RUN.** 지원/권한은 런타임에서 확인하며 실패를 명시적으로 보존한다. SDK bridge의 non-null 문자열 Boolean.parseBoolean 때문에 비정상 raw 문자열과 false를 공개 Boolean callback에서 구별할 수 없다는 PR #47의 제한도 유지한다. 앱에서 UNKNOWN/null/오류를 false로 변환하지 않는다. Boolean은 SDK 보고이며 충전·잠금·안전·개방 각도/우측 단일 포트의 실측 증거가 아니다.

## Invariants / Options

| 선택 | 장점 | 비용 |
| --- | --- | --- |
| Component UI v2로 전환 | 하나의 통합 envelope | 기존 네 Feature consumer의 migration 필요 |
| 독립 고정 충전구 채널 | 기존 v1 네 Feature/스키마 유지 | 작은 독립 validator와 cache endpoint 필요 |

## Decision / Trade-offs

독립 **EV Charge UI v1**, GET `/ev-charge-status.json`, feature `ev-charge.port-open`, part `ev-charge.port` 한 행만 허용한다. 기존 Component UI v1에 다섯 번째 행을 넣지 않는다. Native Component cache에만 새 feature를 추가하고 기존 Vehicle session/worker/lease를 공유한다. 두 projection은 같은 ownership 세대와 증가 sequence를 공유하되 각 consumer는 자신의 채널만 검증한다. GET은 SDK를 호출하지 않는다. 추가 Vehicle client를 만들지 않아 기존 Safety/EV/Tire client 수를 늘리지 않는다. 두 채널의 phase는 같은 로컬 SDK 세션 진단이며 차량 상태가 아니다.

## Risks / Migration / Verification

Native 계약과 UI를 B3a/B3b 두 PR로 나눈다. B3b는 B3a 브랜치를 base로 하며 선행 병합 뒤 main retarget/재검증한다. Native 변경은 enum/cache projection·typed adapter·고정 WebView endpoint·테스트만, UI 변경은 기존 Geometry builder를 읽어 배치하는 어댑터·목록/카메라/선택/패널·회귀만 포함한다.

Geometry는 모든 원본 GLB mesh의 world triangles를 CarScope cm로 변환한 뒤 support를 측정한다. 실패하면 충전구 탐색을 비활성화하고 실패 사실을 표시한다. 기본 위치 fallback/원본 transform 변경/임의 회전·힌지·치수 변경이 없다. SDK 보고 변경은 상태 DOM만 갱신한다.

검증: 실제 AAR/권한/deprecation 재대조, Kotlin callback·오류·stop/resume·재생성·lease·release 격리, v1 호환성과 독립 strict JSON, Kotlin MOCK→JS, 실제 GLB Chrome의 두 part raycast·차폐·정적 pose·기존 Safety/EV/Tire/제품 흐름, Debug packaging 및 CI. 실제 차량 grant/capability/getter/listener·서비스 병행 정리는 NOT_RUN으로 남긴다.
