# STALE 표시 정책 검토 (후속 작업)

작성: 2026-10-30, P1-B2 런타임 검증 중 관측. **이 문서는 문제 정리와 제안만 담습니다.** 이번 PR에서는 TTL 변경, STALE 검사 삭제, 새 SDK API 추정 구현을 하지 않았습니다. 코드와 테스트의 현재 동작은 그대로입니다.

## 1. 현재 동작 (코드·테스트로 확인)

| 위치 | 동작 |
| --- | --- |
| `VehicleDiagramMapper.MAX_AGE_MILLIS = 5_000` | 모든 `Reading.Available`에 동일 적용. `now - observedAtMillis > 5000`이면 OPEN/CLOSED 대신 `STALE` |
| `PleosVehicleDataSource.publish` | SDK 이벤트 또는 초기 read 콜백을 받은 **앱 수신 시각**을 `observedAtMillis`로 저장 |
| `MainActivity.refreshDisplay` (1초) | 나이만 재평가. 새 관측을 만들지 않음 (`pollingCacheNeverRefreshesObservationTimestamp` 테스트로 고정) |
| MOCK | 시나리오 버튼을 누를 때만 새 관측. 이후 5초가 지나면 STALE (`age boundary is inclusive...`, `stale open and closed readings never look fresh` 테스트) |
| 세션 정지/해제 | `DISCONNECTED`로 즉시 Unavailable. STALE과 별개 경로 |

즉 현재 STALE은 "값이 바뀐 지 5초가 지났다"이며, "값을 믿을 수 없다"와 같은 의미로 쓰이고 있습니다.

## 2. 실제 관측 (집 PC Pleos AVD, 2026-10-30)

- `DOOR_POS`는 변경 시에만 이벤트가 옵니다. 구독 직후 1회(`event raw=0`)와 Console OPEN/CLOSE 시점에만 이벤트가 관측됐고, 그 사이에는 이벤트가 없었습니다.
- 서비스 연결·구독이 정상인 상태에서도 초기 값 수신 후 5초가 지나면 FRONT_LEFT가 STALE로 표시됐습니다 (H1: 초기 read 18초 후 화면, P1-B2: Activity 재생성 8초 후 화면).
- 같은 세션에서 Console 변경 시 이벤트는 즉시 들어와 OPEN/CLOSED가 갱신됐습니다. 즉 STALE 표시 시점에도 연결은 살아 있었습니다.

## 3. 문제

1. **이벤트 부재 ≠ 연결 끊김.** on-change 신호에서 이벤트가 없다는 것은 대개 "값이 그대로"라는 뜻입니다. 현재 정책은 정상적으로 닫힌 도어를 대부분의 시간 STALE로 보여 줍니다.
2. **경고 피로.** 정상 상태에서 STALE이 상시 표시되면 사용자는 STALE을 무시하게 되고, 실제 연결 장애 시 경고의 가치가 사라집니다.
3. **조용한 단절 감지를 TTL에만 의존.** 현재 설계에서 리스너 `onFailed`나 SDK 예외 없이 서비스가 사라지는 경우를 잡는 유일한 장치가 5초 TTL입니다. TTL을 늘리거나 없애면 이 감지가 약해지므로, 단순히 값을 바꾸는 것은 해결책이 아닙니다.
4. **MOCK과 PLEOS가 같은 정책을 공유.** MOCK의 STALE은 의도된 데모 동작이지만, 실제 신호에 같은 TTL을 적용할 근거는 없습니다 (`MAX_AGE_MILLIS` 주석: "P0 display policy, not a Pleos sampling guarantee").

## 4. 구분해야 할 상태

| 상황 | 현재 표시 | 바람직한 의미 |
| --- | --- | --- |
| 구독 정상, 값 변화 없음 | 5초 후 STALE | 마지막 값 유효 (OPEN/CLOSED) |
| 리스너 `onFailed` / SDK 예외 | UNKNOWN 등 Unavailable | 신뢰 불가 |
| 앱 세션 정지·해제 | DISCONNECTED | 신뢰 불가 (현재도 올바름) |
| 서비스가 오류 없이 응답 중단 | 5초 후 STALE | 신뢰 불가. 감지 방법 필요 |
| 초기 값 수신 전 | DISCONNECTED | 알 수 없음 (현재도 올바름) |

## 5. 제안 (결정 필요)

**A. 마지막 관측값과 연결 상태를 분리합니다.** `Reading`(값 + 관측 시각)과 별도로 세션 건강 상태(예: SUBSCRIBED / LOST / ERROR)를 snapshot에 담고, mapper는 두 정보를 함께 보고 판정합니다.

**B. 신호 종류별 신선도 규칙.** on-change 신호(Door)는 구독이 건강한 동안 마지막 값을 유효로 봅니다. 연속 샘플 신호가 추가되면 그때 TTL을 따로 정합니다. MOCK은 기존 데모 정책을 유지할 수 있습니다.

**C. 건강 상태의 근거는 검증된 API만 사용합니다.** SDK 2.3.2에 연결 상태 콜백이 있는지는 **미확인**이며 추정해서 구현하지 않습니다. 이미 검증된 수단은 리스너 `onFailed`, SDK 예외, `getCurrentDoorPosition` 응답입니다. 후보안은 구독 중 주기적 확인 read(heartbeat)로, 응답 성공 시 "마지막 접촉 시각"을 갱신하고 TTL은 값 변경이 아닌 마지막 접촉에 적용하는 방식입니다. 확인 read의 응답은 실제 관측이므로 관측 시각을 꾸며내는 것이 아닙니다. IPC 비용, 주기, 서비스 부하는 측정 후 결정합니다.

**D. 신뢰할 수 없을 때의 표시.** 마지막 값을 숨기지 않되 신선한 값과 다른 스타일로 "마지막 값 · n초 전 · 연결 확인 불가"처럼 표시합니다. 근거가 없으면 UNAVAILABLE이며 CLOSED를 기본값으로 쓰지 않습니다. 주행 중 표시 정책은 별도 검토가 필요합니다.

## 6. 후속 작업 범위

- 위 A~D 중 방향 결정 (제품 판단 필요)
- core 모델/mapper 변경과 기존 STALE 테스트 3종의 의도 재정의
- heartbeat 채택 시 SDK read 비용·주기 측정, 서비스 단절 오류 주입 검증
- MOCK 데모 정책 유지 여부

P2 제품 UI에서 도어 상태를 사용자에게 보여 주기 전에 이 결정을 끝내는 것을 권장합니다.
