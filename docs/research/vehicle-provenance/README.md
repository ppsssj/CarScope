# Vehicle provenance audit — Pleos AVD 메타데이터와 외형 치수의 출처

조사일: 2026-10-31. 기준 main `f6db6d8` (PR #11 병합 후). 브랜치 `research/p2-a3-identity-provenance`. **문서 조사만 수행했다.** AVD 관측값, `vehicle-profile.mjs`, Geometry, SVG/GLB는 변경하지 않았다.

## 결론

| 질문 | 판정 | 근거 등급 |
| --- | --- | --- |
| AVD 치수 8개는 어디서 왔는가 | **AOSP 참조 VHAL 기본값과 8/8 정확히 일치한다.** android11–15, 현재 main에 같은 배열이 있다. | AVD_OBSERVED + AOSP_DEFAULT_MATCH |
| AVD make/model/year는 어디서 왔는가 | **AOSP 기본값(`Toy Vehicle`/`Speedy Model`/`2023`)과 다르다.** Pleos 이미지가 이 세 값만 바꾼 것으로 보이지만, 어느 구성 요소가 바꿨는지는 공개 자료로 확인되지 않는다. | AVD_OBSERVED, 출처 UNVERIFIED |
| `Hyundai 42dot / Connect / 2024`는 양산차인가 | **양산 차종 근거가 없다.** 공개 발표에서 Pleos Connect 첫 적용 차종은 "new GRANDEUR"와 "IONIQ 3"이며, "Connect"라는 차종은 나오지 않는다. | UNVERIFIED (추정만 가능) |
| 치수는 Volvo XC90인가 | **식별 근거가 아니다.** 공식 Volvo 페이지는 읽지 못했다(HTTP 403). 읽은 제3자 제원 1건은 4개 항목만 일치하고 폭·트랙은 다르다. | REFERENCE_VEHICLE_SPEC, 부분 일치·미검증 |
| 공식 차량 외형 이미지/3D 자산을 쓸 수 있는가 | **공개된 재배포 가능 자산을 찾지 못했다.** 이용약관은 서비스 데이터 추출·복제와 개발도구 리버스 엔지니어링을 금지한다. | 약관 확인, 자산 NOT_FOUND |

**정리:** AVD 치수는 "특정 차량의 제원"이 아니라 **Android AOSP 참조 VHAL이 적어도 Android 11(2020)부터 제공해 온 기본값**이다. 이 값이 실차(예: Volvo XC90 일부 연식)와 비슷한 것은 AOSP 작성자가 실제 차량 제원을 참고했을 가능성을 시사할 뿐이다. 이 사실로 Pleos AVD 차량이나 현재 Geometry를 특정 OEM 모델로 식별해서는 안 된다.

## 근거 등급 정의

이 디렉터리의 모든 문장은 다음 중 하나로 분류한다.

| 등급 | 의미 | 예 |
| --- | --- | --- |
| **AVD_OBSERVED** | 이 저장소가 현재 AVD에서 public API로 직접 읽은 값 | [P2-A3-0](../../p2-a3-0-vehicle-identity-probe.md)의 make/model/year/dimensions |
| **AOSP_DEFAULT_MATCH** | AOSP 공개 소스의 기본값과 값이 일치한다는 사실. 출처를 강하게 시사하지만 Pleos 빌드 내부를 본 것은 아니다. | `DefaultProperties.json` 8개 치수 |
| **REFERENCE_VEHICLE_SPEC** | 실차의 공개 제원. 비교용일 뿐 식별 근거가 아니다. | XC90 제원 |
| **INFERENCE / UNVERIFIED** | 공개 자료로 확인되지 않은 추정 | "Connect"가 제품명 Pleos Connect에서 왔을 가능성 |

## 문서

- [metadata-sources.md](metadata-sources.md): INFO_MAKE/MODEL/MODEL_YEAR의 AVD 값, AOSP 기본값, Pleos/Hyundai 공개 자료 대조
- [dimension-sources.md](dimension-sources.md): INFO_EXTERIOR_DIMENSIONS의 정의, AOSP 기본값 이력, 실차 제원 비교와 한계
- [geometry-asset-options.md](geometry-asset-options.md): 공식 이미지·3D 자산 여부, 약관상 제약, 현재 Geometry에 대한 권고

## 하지 않은 일

- AVD system image, OEM HMI APK, Vehicle Service 내부 리소스를 추출하거나 분석하지 않았다. Pleos 약관 제14조·제15조도 이를 금지한다. 따라서 "Pleos가 어떤 파일에서 make/model/year를 덮어쓰는지"는 확인하지 않았다.
- 공식 Volvo 페이지가 HTTP 403을 반환했고, 접근 차단을 우회하지 않았다. XC90 공식 제원은 이번 조사에서 **직접 확인하지 못했다**.
- Pleos 약관은 한국어 원문을 fetch 도구로 읽고 번역한 내용이다. 법률 판단이 아니다. 실제 자산 사용 전에는 원문과 별도 계약을 확인해야 한다.
- `tools/anatomy-car/profiles/vehicle-profile.mjs`의 출처 표기(`AAOS_SIMULATED_METADATA`)는 바꾸지 않았다. 표기 보강은 후속 과제로 제안한다([geometry-asset-options.md](geometry-asset-options.md#권고)).

## 재현

AOSP 파일은 공개 Gitiles에서 `?format=TEXT`(base64)로 받아 확인했다.

```bash
B=https://android.googlesource.com/platform/hardware/interfaces/+
curl -s "$B/refs/heads/android14-release/automotive/vehicle/aidl/impl/default_config/config/DefaultProperties.json?format=TEXT" | base64 -d > a14.json
curl -s "$B/refs/heads/android14-release/automotive/vehicle/aidl_property/android/hardware/automotive/vehicle/VehicleProperty.aidl?format=TEXT" | base64 -d > VehicleProperty.aidl
```

확인한 커밋과 SHA-256은 [dimension-sources.md](dimension-sources.md#aosp-기본값)에 기록했다.
