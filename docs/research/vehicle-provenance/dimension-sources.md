# Dimension sources — INFO_EXTERIOR_DIMENSIONS

## 1. 정의 (AOSP 원문)

`automotive/vehicle/aidl_property/android/hardware/automotive/vehicle/VehicleProperty.aidl`, android14-release `40e9f15`:

```text
Exterior dimensions of vehicle.
 int32Values[0] = height
 int32Values[1] = length
 int32Values[2] = width
 int32Values[3] = width including mirrors
 int32Values[4] = wheel base
 int32Values[5] = track width front
 int32Values[6] = track width rear
 int32Values[7] = curb to curb turning radius
@change_mode VehiclePropertyChangeMode.STATIC
@access VehiclePropertyAccess.READ
@unit VehicleUnit:MILLIMETER
```

정의상 주의할 점이 두 가지 있다.

- **index 7 용어 불일치.** AOSP AIDL은 "turning **radius**"라고 쓰고, Android SDK reference(`VehiclePropertyIds`)와 P2-A3-0 기록은 "curb to curb turning **diameter**"라고 쓴다. 값 11,800 mm는 승용차의 회전 *직경*으로 보면 자연스럽고 *반경*으로 보면 비현실적이지만, 이는 추정이다. 현재 Geometry는 이 값을 쓰지 않는다(`turningDiameter` → `null`).
- **index 2 "width"의 미러 처리 미정의.** index 3이 "width including mirrors"이므로 index 2는 미러를 제외한 폭으로 읽히지만, 접은 미러를 포함하는지 아니면 차체 폭인지는 정의되어 있지 않다.

## 2. AVD 관측값과 AOSP 기본값

| index | 의미 | AVD_OBSERVED (mm) | AOSP 기본값 (mm) | 일치 |
| --- | --- | ---: | ---: | --- |
| 0 | height | 1776 | 1776 | ✓ |
| 1 | length | 4950 | 4950 | ✓ |
| 2 | width | 2008 | 2008 | ✓ |
| 3 | width including mirrors | 2140 | 2140 | ✓ |
| 4 | wheel base | 2984 | 2984 | ✓ |
| 5 | track width front | 1665 | 1665 | ✓ |
| 6 | track width rear | 1667 | 1667 | ✓ |
| 7 | turning radius/diameter | 11800 | 11800 | ✓ |

**8/8 정확히 일치한다.** AVD 값은 [P2-A3-0](../../p2-a3-0-vehicle-identity-probe.md)에서 관측했고, [vehicle-profile.mjs](../../../tools/anatomy-car/profiles/vehicle-profile.mjs)에 같은 값이 보존되어 있다(변경 없음).

### AOSP 기본값

| Branch | 파일 | 커밋 | 값 |
| --- | --- | --- | --- |
| android11-release | HIDL `vhal_v2_0/DefaultConfig.h` | — | 같은 8개 숫자. 단, **`floatValues`**로 저장 |
| android12-release, android13-release | HIDL `vhal_v2_0/DefaultConfig.h` | — | 같은 8개, `int32Values` |
| android14-release | AIDL `impl/default_config/config/DefaultProperties.json` 88–100행 | `40e9f1537e308ed49e3b561ce333e3f2bb64f31e` | 같은 8개 |
| android15-release | 같은 경로 | `488942f82bd1bc9ad1cb65a02c71421dc3a6a3d6` | 같은 8개 |
| main (2026-10-31) | `impl/current/default_config/config/DefaultProperties.json` | `1a56e38edc2f2f6189ef405ee1edce554e15cbc0` | 같은 8개 |

조사 시 내려받은 JSON의 SHA-256(디코딩한 원문):

- android14 `569c95499f53461be1e7372762c03abe4a9e5d0c373f3a3e790799580055646c`
- android15 `6fc2803160acf7229624ca024aeca493c597cfe180f85e49556a54c0d3733cb2`
- main `7b84c0d2388666f59565e29272517f21e83e9a8700b64766cfb7fc815cf3b9d5`

AOSP [reference implementation 문서](https://source.android.com/docs/automotive/vhal/reference-implementation)는 `FakeVehicleHardware`를 "intended to run on an emulator"라고 설명한다. 또 "Vendor implementations must not use it as-is"라고 명시한다. 기본값을 "test value"라고 직접 부르지는 않는다.

**FACT:** 이 8개 값은 적어도 Android 11부터 AOSP 참조 VHAL의 기본값이다. Pleos AVD는 같은 값을 반환한다.
**INFERENCE:** Pleos AVD의 치수는 AOSP 참조 기본값을 그대로 물려받은 것으로 보인다. 정확히 일치하고 make/model/year만 바뀐 점이 근거이다. Pleos 이미지 내부 설정은 확인하지 않았다(추출 금지).

## 3. 실차 참고 제원 (REFERENCE_VEHICLE_SPEC — 식별 근거 아님)

조사 요청서는 "Volvo XC90 공식 제원도 해당 치수와 일치한다"고 전제했다. 이번 조사 결과는 다음과 같다.

| 출처 | 상태 |
| --- | --- |
| volvocars.com 지원 페이지 3건 (XC90 15w46 / 19w46 / 22w22 dimensions 문서) | 검색으로 위치를 찾았으나 직접 fetch가 **HTTP 403**이었다. 차단을 우회하지 않았다. **공식 수치를 직접 읽지 못했다.** |
| 웹 검색 요약 | Volvo 표에 wheelbase 2984, width 2008(접은 미러), 2140(펼친 미러)이 있다고 요약했다. 검색 도구의 요약이며 원문 대조는 하지 않았다. |
| [autotijd.be — XC90 B5 AWD (2019–2024)](https://autotijd.be/en/dimensions/volvo/xc90/b5-249-hp-awd-1831), 제3자 | 직접 읽었다. 아래 표 참고 |

| 항목 | AVD/AOSP | autotijd XC90 B5 AWD 2019–2024 | 비교 |
| --- | ---: | ---: | --- |
| height | 1776 | 1776 | 일치 |
| length | 4950 | 4950 | 일치 |
| width | 2008 | 1958 ("without mirrors") | **불일치 (−50)** |
| width including mirrors | 2140 | 2140 | 일치 |
| wheelbase | 2984 | 2984 | 일치 |
| track front | 1665 | 1668 | **불일치 (+3)** |
| track rear | 1667 | 1671 | **불일치 (+4)** |
| turning | 11800 | 표기 없음 | — |

해석:

- 확인 가능한 범위에서 **4개 항목은 일치하고 3개는 다르다.** width 2008은 검색 요약에 따르면 Volvo 공식 표의 "접은 미러" 폭일 수 있지만 확인하지 못했다. 트랙은 트림·휠에 따라 다르며, 검색 요약은 일부 트림에서 1665/1667이라고 했지만 원문으로 확인하지 않았다.
- 2025년 이후 XC90은 제원이 달라진다(검색 요약: 폭 1923, 트랙 1673/1675). 직접 확인하지 않았다.
- **판정: 부분 일치, UNVERIFIED.** AOSP 작성자가 2015년 이후 XC90 같은 대형 SUV 제원을 참고했을 가능성은 있다. 그러나 그 의도를 확인할 출처가 없다. 이 값으로 Pleos AVD 차량, AOSP 예시 차량, CarScope Geometry 중 어느 것도 Volvo로 식별하지 않는다.

같은 치수 집합이 여러 대형 SUV와 부분적으로 겹칠 수 있다. 실차 제원 일치는 **"이 치수는 실재하는 차급의 그럴듯한 값"**이라는 정도의 근거로만 쓴다.

## 4. CarScope Geometry에 대한 의미

- 현재 SUV Geometry([P2-A3-1](../../p2-a3-1-vehicle-geometry-profile.md))는 이 8개 값을 `source=AAOS_SIMULATED_METADATA`, `property=INFO_EXTERIOR_DIMENSIONS`로 사용한다. 이번 조사로 그 값의 상위 출처가 **AOSP 참조 VHAL 기본값**임을 확인했다(AOSP_DEFAULT_MATCH).
- 오버행 배분, 벨트라인, 보닛·펜더 곡면 등 나머지 형상은 모두 DESIGN_ESTIMATE이다. 이번 조사는 이를 바꾸지 않는다.
- index 2 폭의 의미(차체 폭인지 접은 미러 폭인지)가 정의되지 않았으므로, 현재 모델이 이 값을 차체 폭으로 쓰는 것은 **해석상의 선택**이다. 관측값 0 mm 오차라는 기존 검증은 "AVD 값을 그대로 썼다"는 뜻이지, 실차 차체 폭과 일치한다는 뜻이 아니다.
