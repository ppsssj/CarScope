# P2-A3-0 — Default vehicle identity probe

검증일: 2026-10-31 KST. 저장소는 `C:\dev\CarScope`이며 Documents 작업 사본은 변경하지 않았다. PR [#7](https://github.com/ppsssj/CarScope/pull/7)의 병합을 GitHub에서 확인한 뒤 clean main을 fast-forward했다. 기준 main은 `69db27d5c8c3ae3b4d2fac83c0a71d3cb884e65e`, 작업 브랜치는 `feat/p2-a3-0-vehicle-identity-probe`이다.

**판정: CONDITIONAL GO — 명시적으로 선택한 수동 reference profile 연구는 진행할 수 있다. OEM 차량을 자동 식별하거나 그 모델이라고 표시하는 작업은 NO-GO이다.** AAOS 메타데이터는 읽혔지만 실제 양산 모델과 OEM 3D 화면의 대응 관계는 검증되지 않았다. 전체 차량 모델은 구현하지 않았다.

## 실제 반환값과 해석

다음은 현재 AVD에서 debug 앱 UID로 읽은 결과이다. 제조사 문자열·연식·모델 문자열을 조합해 새로운 차량명을 만들지 않는다.

```json
{
  "source": "aaos",
  "make": "Hyundai 42dot",
  "model": "Connect",
  "trim": null,
  "modelYear": 2024,
  "dimensionsMm": [1776, 4950, 2008, 2140, 2984, 1665, 1667, 11800],
  "identityStatus": "PARTIAL",
  "oemVisualMatch": "UNVERIFIED"
}
```

치수 배열의 순서는 height, length, width, width including mirrors, wheelbase, front track, rear track, curb-to-curb turning diameter이며 단위는 mm이다. 모델링에서 사용하는 cm로 자동 변환하거나 기존 Geometry에 적용하지 않았다. [Android 공식 property 정의](https://developer.android.google.cn/reference/android/car/VehiclePropertyIds.html#INFO_EXTERIOR_DIMENSIONS).

Pleos SDK 경로의 정규화 결과는 make/model/trim/modelYear/dimensionsMm 모두 null, `identityStatus=UNAVAILABLE`, `oemVisualMatch=UNVERIFIED`이다. SDK 경로가 실패하면 AAOS 값을 SDK 출처로 표시하지 않는다. JSON에는 두 출처를 따로 보존한다.

`PARTIAL`은 안전한 공개 메타데이터가 일부 존재한다는 의미이다. API 값만으로 `VERIFIED`를 생성하는 코드 경로는 없다. 사용자가 외부 이미지를 보고 비슷하다고 관찰한 점은 후보 근거이며, 공식 모델 식별 또는 renderer mapping 증거로 취급하지 않는다. 특히 `Hyundai 42dot`은 제조사 필드, `2024`는 연식 필드이고 반환 모델명은 `Connect`이다.

## 설치 SDK 2.3.2 조사

캐시된 `ai.pleos.playground:Vehicle:2.3.2` AAR의 SHA-256은 `E11FDFE498CAD3ECC0D5A2A6992B0C4A4D135195F1455018127BC069FD5EF937`이다. 공개 클래스의 `javap` 결과와 [CarInfo 공식 reference](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/car-info/entry)를 대조했다. SDK 의존성 버전은 변경하지 않았다.

| 실제 CarInfo 메서드 | 결과/요구 권한 | 이번 호출 |
| --- | --- | --- |
| `checkCRNInfoCapabilities(onComplete, onFailed)` | `api.model.capability.CapabilityConfig`; `pleos.car.permission.CAR_INFO` | 호출하지 않음 |
| `checkVINInfoCapabilities(onComplete, onFailed)` | 같은 capability 타입/권한 | 호출하지 않음 |
| `getCRNInfo(onComplete, onFailed)` | String callback; 같은 권한 | 호출하지 않음 |
| `getVINInfo(onComplete, onFailed)` | String callback; 같은 권한 | 호출하지 않음 |
| `getCapabilityInfo(onComplete, onFailed)` | `Map<String, data.CapabilityConfig<Object>>`; `@RestrictTo(LIBRARY_GROUP)`, `PRIVATE_CAR_INFO` | 사용하지 않음 |

진입점 `Vehicle(context)`, `initialize()`, `getCarInfo()`, `release()`도 존재한다. 그러나 이번에 필요한 make/model/trim/year/exterior dimensions getter는 **설치된 CarInfo public interface에 없다**. 따라서 프로브는 Vehicle을 초기화하거나 식별자 capability/getter를 호출하지 않는다. 일반 소개 문서의 CarInfo 설명에는 제조사·치수·연식이 언급되지만, 실제 설치 바이너리와 상세 reference가 그 메서드를 제공하지 않으므로 설명만으로 API를 추정하지 않았다. [소개 문서](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/intro).

capability callback은 현재 값 자체가 아니라 접근 capability를 전달한다. 비동기 API는 `onComplete`/`onFailed(Exception)`를 사용한다. 공식 오류 계약은 `VehicleException.errorCode`로 미지원 property/area/type, 권한, 서비스 연결/내부 오류, 빈 결과 등을 구분하며 모든 Exception이 VehicleException인 것은 아니다. 이번 CarInfo 오류 응답은 **NOT_RUN**이다. 금지된 식별자 호출로 오류를 유발하지 않았다. [권한](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-permission), [오류 계약](https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-error-code).

## AAOS public API와 실제 접근

컴파일 기준은 기존 Android API 34이다. 설치된 `platforms/android-34/optional/android.car.jar`의 공개 stub을 `debugCompileOnly`로 사용하고, debug manifest에 optional `android.car` uses-library와 **normal** `android.car.permission.CAR_INFO`만 추가했다. SDK/hidden jar를 device에서 추출해 컴파일하지 않는다.

사용한 public 호출은 `Car.createCar(context)`, `getCarManager(Car.PROPERTY_SERVICE)`, `CarPropertyManager.getCarPropertyConfig(id)`, `getProperty<Any>(id, 0)`, `CarPropertyValue.status/value`, `disconnect()`이다. worker thread에서 실행하며 property 전체 목록을 열거하지 않는다. setter/control/listener는 없다. [CarPropertyManager 공식 계약](https://developer.android.com/reference/android/car/hardware/property/CarPropertyManager).

| API source / property | support | permission | 실제 결과 |
| --- | --- | --- | --- |
| AAOS INFO_MAKE | SUPPORTED, config exposed | GRANTED | AVAILABLE: `Hyundai 42dot` (String) |
| AAOS INFO_MODEL | SUPPORTED, config exposed | GRANTED | AVAILABLE: `Connect` (String) |
| AAOS INFO_MODEL_TRIM | UNKNOWN | GRANTED | NOT_IN_PUBLIC_API_34; 조회하지 않음 |
| AAOS INFO_MODEL_YEAR | SUPPORTED, config exposed | GRANTED | AVAILABLE: `2024` (Integer) |
| AAOS INFO_EXTERIOR_DIMENSIONS | SUPPORTED, config exposed | GRANTED | AVAILABLE: 위 8개 Integer 값 |
| Pleos SDK / 다섯 정보 항목 | UNSUPPORTED (SDK surface) | DENIED (미선언) | NOT_EXPOSED_BY_SDK_2_3_2; 호출하지 않음 |

`INFO_MODEL_TRIM`은 최신 Android reference에는 있지만 설치된 API 34 public jar에는 없다. 숫자 ID를 하드코딩하거나 reflection으로 우회하지 않았다. 이 결과를 VHAL 자체 미지원 또는 빈 base trim이라고 해석하지 않는다. [최신 property reference](https://developer.android.google.cn/reference/android/car/VehiclePropertyIds.html#INFO_MODEL_TRIM).

현재 앱은 AAOS manager에 실제로 연결됐고 네 property는 config 조회와 read 모두 성공했다. preflight grant만으로 접근 성공을 주장하지 않았다. 반대로 null config는 미지원 또는 접근 불가일 수 있으므로 같은 allowlist property의 read 결과까지 확인한다. `SecurityException`은 PERMISSION_DENIED, `IllegalArgumentException`은 UNSUPPORTED, `PropertyNotAvailableException`/`PropertyNotAvailableAndRetryException`은 UNAVAILABLE, 기타 오류는 ERROR로 남긴다. 반환 status가 AVAILABLE일 때만 value를 사용한다. 빈 값·잘못된 타입·누락·오류를 차량명으로 채우지 않는다. 오류 메시지는 저장/표시하지 않고 예외 타입만 남긴다.

이번 AVD에서는 네 read의 permission error/error/unavailable은 발생하지 않았다. 실제 AAOS 거부 응답은 **NOT_RUN**이며 해당 분류는 합성 JVM 테스트로 검증했다. Pleos CAR_INFO의 DENIED는 `checkSelfPermission` 관측이고 서비스 오류 callback이 아니다. 추가 권한을 요청할 근거가 없어 선언하지 않았다. Service package는 관련 Pleos permissions를 normal로 정의하지만 PRIVATE API를 사용하지 않는다. 실차 접근 허용은 검증하지 않았다. [Pleos 공식 availability 정책](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/api-compatibility-availability)도 모델명 대신 실제 property 접근을 확인하도록 안내한다.

## 기본 프로필과 OEM 화면 조사 범위

| 근거 | 관측 / 한계 |
| --- | --- |
| 현재 AVD | `CarScope_Pleos_API34`, Android 14/API 34/x86_64, Pleos Connect image 2.1.0, SDK package revision 2 |
| 이미지 내부 label | `RELEASE.release_connect_v2.1.0 test-keys`; legacy source.properties는 revision 1이지만 SDK package.xml은 revision 2임을 구분 |
| Vehicle Service | 실제 설치 package `2.3.22`, code 74; 앱 SDK는 `2.3.2` |
| AVD hardware config | `hw.device.manufacturer=42dot`, `hw.device.name=Pleos_Connect_v2_0`, image path `android-34/pleos_car_emulator/x86_64`; 양산 차종을 선택한 설정이라는 근거 없음 |
| 메타데이터 | 별도 새 Activity 실행에서도 같은 네 값. Android가 이 정보 property들을 static으로 정의한다는 사실과, 이미지 내부 기본값 구현이 영구 고정인지 여부는 별개 |
| 실제 OEM 화면 | 왼쪽 흰색 차량 visualization과 오른쪽 API 결과를 한 화면에 캡처. 화면 자체에서 `Connect` 또는 연식과 3D 모델의 연결 표시는 확인하지 못함 |
| 문서상 설정 | 공식 AVD 가이드는 Pleos 2.1.0 hardware/image 선택을 설명함. Console 가이드는 상태 제어와 시각화 테마/시점을 설명함. 확인한 문서에 차량 make/model 선택 및 OEM asset↔metadata 연결 계약이 없음 |
| Console GUI | NOT_RUN. browser access host unavailable; Windows Chrome UI 도구가 URL을 충분히 확신하지 못해 중단. 다른 브라우저 제어 방식으로 우회하지 않음 |
| OEM HMI 내부 resources | 미추출/미분석. proprietary 3D asset, 모델 이름 목록 또는 private resource contract를 가져오지 않음 |

공식 [AVD 생성](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator), [에뮬레이터 설정](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator), [Console 설정](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/use-vehicle-emulator), [Console controls 목록](https://document.pleos.ai/docs/pleos-only/app-test-guide/virtual-console-guide)을 확인했다. 이 조사만으로 모든 숨겨진/관리자용 설정에 모델 선택이 없다고 단정하지 않는다. 공개 검색에서도 `Hyundai 42dot`/`Connect`와 OEM 화면 모델의 공식 mapping을 확보하지 못했다.

**FACT:** 현재 이미지가 위 메타데이터를 제공한다. **INFERENCE:** 플랫폼용 simulated profile일 가능성은 있지만 양산 모델명으로 확정할 수 없다. **DECISION:** identity PARTIAL / visual match UNVERIFIED를 유지한다. 캡처의 외관 유사성이나 치수 유사성만으로 특정 Hyundai 차종을 기입하지 않는다.

## 구현 경계와 재현

- `app/src/debug/.../identity`: 수동 adb 실행 diagnostic Activity, 5항목 enum allowlist, public AAOS reader, 정규화/오류 분류. 프로브 결과는 앱 private debug 파일 `files/vehicle-identity.json`과 화면에만 남기며 Logcat에 값을 출력하지 않는다.
- `app/src/testDebug/.../IdentityProbeTest.kt`: allowlist, 오류·permission 우선순위, empty/null/타입·치수 검증, 출처, 미확인 identity/visual 상태 보호.
- `tools/identity-probe/check.py`: 실제 debug/release manifest·DEX 검사, 현재 Android user를 확인한 새 AVD 결과 수집 및 JSON 계약 검사. 이미 있던 결과를 재사용하지 않는다.
- 별도 `Identity probe CI`: 앱 JVM tests, public API 컴파일, debug/release build, lint, manifest/DEX 경계 검사. 기존 JVM CI·Geometry CI는 수정하지 않았다. CI에서 Pleos AVD를 실행한 것으로 보고하지 않는다.

release manifest의 permission 집합은 기존 CAR_DOORS와 SDK VEHICLE_BINDING 두 개이며 identity Activity/AAOS library/AAOS CAR_INFO가 없다. 프로브 클래스도 release DEX에 없다. main source, Pleos door 처리, STALE 5000ms, 메인 JavaScript 설정, SVG/GLB 및 Geometry CI는 변경하지 않았다. VIN/CRN/ANDROID_ID/serial 등 지속 식별자를 조회하거나 기록하지 않는다.

JDK 17, `ANDROID_HOME=C:\Android\Sdk`, `ANDROID_USER_HOME=C:\Android\.android`, `ANDROID_AVD_HOME=C:\Android\.android\avd`, `GRADLE_USER_HOME=C:\gradle-home` 기준:

```powershell
.\gradlew.bat :vehicle-core:test :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 "-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8" -Pkotlin.compiler.execution.strategy=in-process
python tools/identity-probe/check.py build-contract
C:\Android\Sdk\platform-tools\adb.exe -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
python tools/identity-probe/check.py capture --adb C:/Android/Sdk/platform-tools/adb.exe --serial emulator-5554 --output .tools/p2-a30/final
python tools/identity-probe/check.py report .tools/p2-a30/final/vehicle-identity.json
```

AVD 부팅은 기존 hardware 설정의 cold boot/WHPX/host GPU를 사용했다. 캡처에는 API 응답과 UI 실행 근거가 있으며 이것을 Android instrumentation suite 또는 실차 검증으로 부르지 않는다. 기존 저장소에 instrumentation test suite는 없다. 새로운 Android 화면은 위 device smoke 검사로 실행한다.

## 검증과 남은 단계

| Gate | 상태 / 범위 |
| --- | --- |
| JVM | core 24, 기존 adapter 19, probe 7; 실패/오류/skip 0을 확인 |
| Android build/lint | debug/release assemble와 lintDebug 실행. debug 진단 텍스트의 literal JSON은 localization 대상에서 제외; 기존 lint warning은 별도 유지 |
| Release 격리 | merged manifest permission/library/activity 및 APK DEX 경계 자동 검사 |
| AVD 실행 | 현재 Pleos AVD의 실제 manager 연결·네 read 성공, trim API surface 구분, SDK 미노출과 권한 미선언 구분 |
| 오류 경로 | 보안·미지원·일시 unavailable·일반 오류는 JVM 합성 검사. 실제 거부/서비스 장애 주입 NOT_RUN |
| OEM 비교 | 동일 화면에서 시각 비교. mapping 검증 실패를 숨기지 않고 UNVERIFIED 유지 |
| CI | PR의 해당 head 결과를 evidence index에 별도 기록 |
| Geometry | 변경 없음. 기존 Geometry CI 결과와 기존 SVG/GLB를 보존 |
| Console GUI / 실차 | NOT_RUN |

첫 host capture는 Android user 0을 기본값으로 사용해 120초 timeout이었다. 화면의 프로브 자체는 성공했지만 host가 user 10의 파일을 읽지 못한 문제였다. 현재 사용자 조회와 `run-as --user`로 수정하고 fresh capture를 재실행했다. 이 실패를 API 접근 거부로 보고하지 않는다. 초기 부팅 중 전체 화면/검은 home 프레임은 OEM 비교 증거에서 제외하고 이후 합성된 OEM+probe 화면을 사용한다.

첫 Identity probe CI는 runner PATH에 `sdkmanager`가 없어 설치 단계 exit 127로 실패했다. 공식 runner의 SDK 절대 경로를 참조하도록 수정했다. 앱 테스트 실패로 바꾸어 설명하지 않으며 최초 실패와 후속 head 결과를 분리한다.

원본 화면·로그·SDK/APK는 Git 제외 로컬 경로에 보존하고 [증거 인덱스](evidence/p2-a30/2026-10-31-codex/README.md)에 재현·hash를 기록한다.

다음 단계는 수동으로 선택한 reference를 `manual-reference-v1` 같은 이름과 `source=manual`, `oemVisualMatch=UNVERIFIED`로 관리하는 것이다. 사용 권한이 명확한 자체 제작 geometry/사용자 소유 측정·사진/명시적 재사용 라이선스 자료를 고르고 provenance·차량 연식/trim·치수 출처·축/단위·hinge 위치의 검증 수준을 함께 기록해야 한다. 현재 AAOS 치수를 사용할 경우에도 `Pleos AVD simulated metadata`라는 출처를 유지하고 실제 양산 제원으로 표시하지 않는다. 특정 모델의 공식 제원·법적 사용 가능한 3D reference 조사는 그 모델이 명시적으로 선택되거나 공식 mapping이 확보된 후 별도 진행한다. 이 PR에서는 VehicleGeometryProfile 코드나 전체 차량을 구현하지 않는다.
