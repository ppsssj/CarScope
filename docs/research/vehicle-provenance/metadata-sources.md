# Metadata sources — INFO_MAKE / INFO_MODEL / INFO_MODEL_YEAR

## 1. AVD 관측값 (AVD_OBSERVED, 변경 없음)

[P2-A3-0 identity probe](../../p2-a3-0-vehicle-identity-probe.md)가 2026-10-31에 `CarScope_Pleos_API34` AVD에서 읽은 값이다. 측정 조건은 Pleos Connect image 2.1.0, Android 14/API 34, Vehicle Service 2.3.22이고, public `CarPropertyManager`와 normal `android.car.permission.CAR_INFO`를 사용했다.

| Property | AVD 값 | 타입 |
| --- | --- | --- |
| `INFO_MAKE` | `Hyundai 42dot` | String |
| `INFO_MODEL` | `Connect` | String |
| `INFO_MODEL_YEAR` | `2024` | Integer |
| `INFO_MODEL_TRIM` | 조회하지 않음. API 34 public stub에 없다. | — |

Pleos Vehicle SDK 2.3.2의 `CarInfo` 공개 인터페이스에는 make/model/year getter가 없다. 따라서 위 값은 **SDK가 아니라 AAOS VHAL 경로**에서 왔다(P2-A3-0 기록).

## 2. AOSP 참조 기본값 (AOSP_DEFAULT_MATCH: 불일치)

AOSP `hardware/interfaces`의 참조(fake) VHAL 기본 설정:

| Property | AOSP 기본값 | AVD 값 | 일치 |
| --- | --- | --- | --- |
| `INFO_MAKE` | `Toy Vehicle` | `Hyundai 42dot` | ✗ |
| `INFO_MODEL` | `Speedy Model` | `Connect` | ✗ |
| `INFO_MODEL_YEAR` | `2023` | `2024` | ✗ |
| `INFO_MODEL_TRIM` | `Sport` (main에만 있음, android14/15에는 없음) | 미조회 | — |
| `INFO_VIN` | `1GCARVIN123456789` | 미조회 (P2-A3-0 정책상 지속 식별자를 읽지 않음) | — |

출처 파일과 커밋:

- `automotive/vehicle/aidl/impl/default_config/config/DefaultProperties.json`
  - android14-release `40e9f1537e308ed49e3b561ce333e3f2bb64f31e`, 68–86행
  - android15-release `488942f82bd1bc9ad1cb65a02c71421dc3a6a3d6`
- 현재 main `1a56e38edc2f2f6189ef405ee1edce554e15cbc0`: `.../impl/current/default_config/config/DefaultProperties.json`
- android12/13의 HIDL `automotive/vehicle/2.0/default/impl/vhal_v2_0/DefaultConfig.h`에도 같은 `Toy Vehicle`/`Speedy Model`이 있다.

AOSP 정의(`VehicleProperty.aidl`, android14-release)는 세 property를 각각 "Manufacturer of vehicle", "Model of vehicle", "Model year of vehicle."로 설명한다. change mode는 모두 `STATIC`, access는 `READ`이다. Android SDK reference는 make를 "the vehicle's public brand name", model을 "public model name"으로 설명한다(fetch 도구 요약이며 원문 인용은 미확인).

**FACT:** 치수는 AOSP 기본값과 같은데, make/model/year 세 값은 AOSP 기본값과 다르다.
**INFERENCE:** Pleos 이미지가 AOSP 참조 VHAL 기본 설정을 바탕으로 식별 문자열 세 개만 바꾼 것으로 보인다. 어느 파일·overlay·서비스가 바꿨는지는 이미지 내부를 분석하지 않았으므로 **UNVERIFIED**이다.

## 3. Pleos 공개 문서 (확인한 범위)

| 문서 | 내용 | make/model 근거 |
| --- | --- | --- |
| [Vehicle SDK 소개](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro) | CarInfo = "차량 기본 정보(외부 크기, 제조사, 연식 등) 조회". SDK v2.3.2 / Vehicle Service v2.3.21 기준이다. | 없음. 에뮬레이터 값의 출처를 설명하지 않는다. |
| [CarInfo reference](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/car-info/entry) | 메서드는 `checkCRNInfoCapabilities`, `checkVINInfoCapabilities`, `getCRNInfo`, `getVINInfo`뿐이다. | make/model/year getter가 없다. |
| [에뮬레이터 설정](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator) | 그래픽, 언어, 마이크, cold boot, Bluetooth 동글 | 차량 make/model/year/치수 선택 항목이 없다. |
| [Virtual Console](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/use-vehicle-emulator) | 상태 제어 도메인(Vehicle/Motion/ADAS 등)과 주행 시각화 테마(Highway/Forest) | 시각화에 표시되는 차량이 무엇인지 설명하지 않는다. |
| [AVD 생성](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator) | Pleos 2.1.0 hardware/image 선택 (P2-A3-0에서 확인) | 차종 선택이 없다. |

`https://pleos.ai/playground/develop`은 `developers.pleos.ai`로 리다이렉트된 뒤 HTTP 404였다. 공개 문서에서 make/model 선택 기능이나 OEM 시각화 자산과 메타데이터의 연결 계약을 찾지 못했다. 이것이 비공개·관리자용 설정까지 없다는 증거는 아니다.

## 4. 문자열별 출처 검토

| 문자열 | 확인된 사실 | 추정 (UNVERIFIED) |
| --- | --- | --- |
| `Hyundai 42dot` | 42dot(포티투닷 주식회사)은 Pleos Playground 이용약관의 운영 "회사"이다([이용약관](https://developers.pleos.ai/playground/external/use-policy?partnerId=672505ad-2e37-4500-8162-000bcfc05b5c&locale=ko-KR) 제1조). Hyundai 뉴스룸에서 42dot 소속 발표자가 Pleos Connect를 소개한다. | 차량 브랜드명이 아니라 플랫폼 개발 주체(그룹 + 자회사)를 표기한 문자열일 가능성이 있다. |
| `Connect` | [Hyundai 뉴스룸 (2026-04-30)](https://www.hyundai.com/worldwide/en/newsroom/detail/0000001168): Pleos Connect는 "new GRANDEUR"에서 데뷔하고 이후 유럽 "IONIQ 3"로 확대된다. "Connect"라는 차종명은 나오지 않는다. | 제품명 "Pleos Connect"에서 따온 placeholder 모델명일 가능성이 있다. |
| `2024` | 공개 출처를 찾지 못했다. AOSP 기본값은 2023이다. | 이미지 빌드 시점 등과 관련된 임의 값일 수 있다. 근거는 없다. |

뉴스룸의 GRANDEUR·IONIQ 3 언급은 **Pleos Connect가 탑재될 양산 차종**에 대한 발표이다. AVD가 그 차종을 시뮬레이션한다는 근거가 아니다. AVD 치수(아래 문서)는 두 차종의 제원과 비교하지도 않았다. 비교할 이유가 생기면 별도 과제로 진행한다.

## 5. 판정

- `identityStatus=PARTIAL`, `oemVisualMatch=UNVERIFIED`(P2-A3-0)를 그대로 유지한다.
- make/model/year는 "Pleos AVD가 제공하는 시뮬레이션 메타데이터"로만 표시한다. 양산 차종명으로 바꾸거나 조합하지 않는다.
