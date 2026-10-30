# 아키텍처와 P0 계약

## 계층

```text
VehicleDataSource
    ├── MockVehicleDataSource         구현 및 JVM 검증 완료
    └── PleosVehicleDataSource        app 모듈, SDK 2.3.2의 ROW_1_LEFT 읽기 전용
             ↓
VehicleSnapshot / Reading<T>          Vehicle State Model
             ↓ VehicleDiagramMapper
VehicleDiagram / DoorVisualState      Vehicle Diagram Model
             ↓ VehicleSvgRenderer
자체 완결 SVG 문자열
             ↓
Android MainActivity / WebView        P1-A Mock 실행 검증, P1-B 결과는 별도 기록
```

`vehicle-core`는 Android와 Pleos SDK를 import하지 않습니다. Android 앱만 core와 SDK에 의존합니다. `app/pleos`의 순수 controller와 typed `SdkDoorSession` 경계를 통해 SDK 클래스·권한·연결 수명주기를 core 밖에 둡니다. 실제 AAR와 공식 샘플로 시그니처를 대조했습니다. 자세한 상태·정리 계약과 실행 결과는 [연동 문서](pleos-sdk-integration.md)에 있습니다.

## 상태 모델

`VehicleSnapshot`은 `DataOrigin`과 4개 DoorId에 대한 `Map<DoorId, Reading<DoorPosition>>`를 갖습니다. Available은 OPEN/CLOSED 값과 **관측 시점의 Unix epoch milliseconds**를 보관합니다. Unavailable은 UNSUPPORTED/PERMISSION_DENIED/DISCONNECTED/UNKNOWN 원인을 보관합니다. 누락 key는 Unavailable과 동일하게 표시합니다.

| 입력 | 다이어그램 상태 |
| --- | --- |
| 관측 시각이 음수, 현재 시각이 음수, 미래 관측 | UNAVAILABLE |
| 유효한 관측의 나이가 0~5,000ms | OPEN 또는 CLOSED |
| 나이가 5,000ms 초과 | STALE |
| Unavailable 또는 누락 key | UNAVAILABLE |

음수/미래 시각을 뺄셈 전에 검사하므로 `Long.MIN_VALUE` 차감 overflow로 현재 값처럼 보이지 않습니다. 관측 시각 0은 유효한 epoch 경계입니다. 5초는 P0의 표시 정책이며 SDK 갱신 주기 또는 차량 안전 기준이 아닙니다. 시스템 시각 변경의 영향이 있으므로 실제 어댑터에서는 SDK 타임스탬프의 clock domain, epoch 변환과 monotonic 수명 관리 정책을 먼저 정해야 합니다.

Kotlin 공개 모델은 null을 받지 않습니다. SDK의 nullable 결과, 알 수 없는 정수 값, 권한 거부, 미지원, 서비스 단절은 미래 어댑터 경계에서 명시적인 Unavailable로 변환해야 합니다. `null → CLOSED`, 실패 후 자동 MOCK 전환, 렌더링 시각으로 관측 시각 덮어쓰기는 금지합니다. 프로그래밍 오류나 주입한 Mock clock 예외는 숨기지 않습니다. 예상 가능한 서비스 오류의 변환은 어댑터 책임입니다.

Unavailable 원인은 snapshot에 남고 다이어그램에서는 하나의 상태로 축약됩니다. STALE 시 마지막 OPEN/CLOSED 값은 snapshot에 남지만 다이어그램은 STALE만 표시합니다. 외부 어댑터는 갱신 중인 mutable map을 노출하지 말고 일관된 사본을 게시해야 합니다. Kotlin `Map` 타입 자체가 deep immutability나 스레드 안전성을 보장하지는 않습니다.

## Mock과 출처

Mock은 ALL_CLOSED / FRONT_LEFT_OPEN / UNAVAILABLE 세 시나리오를 제공합니다. 한 번의 read에서 clock과 scenario를 각각 한 번 채집하고 새 map을 만듭니다. 이전 성공값을 Unavailable 시나리오로 가져오지 않습니다.

`DataOrigin`은 snapshot → diagram → SVG title까지 유지됩니다. 합성 PLEOS 단위 테스트는 실제 연동 증거가 아닙니다. Activity의 명시적 MOCK/PLEOS 선택, 출처별 안내, 텍스트 출처, HTML/SVG title로 구별합니다. 실패 시에도 SDK snapshot은 PLEOS이며 자동 Mock 대체가 없습니다. 아직 연결하지 않은 세 도어는 UNSUPPORTED입니다.

## SVG 계약

원본 P0 평면 도식이며 Anatomy 결과물이 아닙니다. 고정 viewBox `0 0 520 300`, SVG namespace, title/desc와 접근성 연결을 사용합니다.

| DoorId | 안정적인 SVG group id |
| --- | --- |
| FRONT_LEFT | door-front-left |
| FRONT_RIGHT | door-front-right |
| REAR_LEFT | door-rear-left |
| REAR_RIGHT | door-rear-right |

각 group은 `data-state`, 서로 다른 fill, 상태 텍스트를 포함합니다. 색에만 의존하지 않습니다. 누락된 diagram key도 UNAVAILABLE로 렌더링합니다. title/desc는 XML 특수문자 5종을 escape합니다. 공개 입력은 enum으로 제한되어 임의 XML, URL, XML 1.0 금지 제어문자가 들어오는 경로가 없습니다. escape 함수는 범용 외부 SVG sanitizer가 아닙니다.

외부 이미지·폰트·JavaScript·foreignObject·HTML bridge가 필요 없습니다. JVM 검증은 XML 파싱, escaping round trip, ID, 출처, 상태별 텍스트/색 차이까지 확인합니다. 픽셀 표시와 접근성 서비스 동작은 별도 실행 검증입니다.

## Android 화면과 수명주기

Mock은 Activity 생성/시나리오 버튼에서 읽은 snapshot을 저장합니다. PLEOS는 worker에서 콜백으로 게시한 snapshot을 UI가 읽습니다. 화면이 시작된 동안 1초마다 관측 나이를 재평가하고 SVG가 달라질 때만 WebView를 로드합니다. 재평가 때문에 관측 시간이 갱신되지는 않습니다. onStop에서 Handler 및 SDK 구독을 정리하고 onDestroy에서 비동기 요청 완료 후 SDK를 release합니다. 재생성 시 출처/scenario를 복원하고 새 세션으로 조회합니다. 이전 세션의 늦은 콜백은 새 화면을 갱신하지 않습니다. SDK가 콜백을 끝내지 않는 경우 release 대기가 남는 제한도 연동 문서에 기록합니다.

자체 SVG를 메모리 HTML에 포함하여 HTTPS 형식의 예약된 `.invalid` base URL과 `loadDataWithBaseURL`로 로드합니다. 이 주소에서 서버 콘텐츠를 받는 구조가 아닙니다. JavaScript, DOM storage, file/content 접근, network loads를 끄고 CSP와 navigation 차단을 사용합니다. WebView 제공자가 없거나 초기화/주 프레임 로딩이 실패하면 텍스트 상태를 유지합니다. 로드 완료 콜백은 SVG가 그려졌다는 증거로 취급하지 않습니다.

관측 시각으로 잘못 표시하던 UI 시각 문구는 화면 갱신 시각(UTC)으로 수정했습니다. 주행 제한, 화면 크기·고대비·rotary 포커스, WebView renderer process 사망 및 기기별 callback 순서는 아직 실행 검증하지 않았습니다.
