# P2-A6 · IONIQ 5 실제 3D 모델 자동 변환 및 통합 준비

판정: **CONVERTED_AND_VERIFIED / POC_ONLY** — OpenX `hyundai_ioniq_5_2022.blend`를 Blender 없이 GLB로 변환했고, 원본 메타데이터·원본 좌표 재계산·Khronos validator·브라우저 레이캐스트로 검증했다. 앱 기본 차량, 릴리스 경로, 기존 Geometry/SVG/GLB 계약은 바꾸지 않았다. 원본과 변환 GLB는 저장소에 넣지 않는다.

실행 환경: 홈 PC Windows 10, Node 22.16.0, Git LFS 3.6.1, Blender **미설치**, 2026-10-31. 도구 사용법은 [tools/ioniq5-asset/README.md](../tools/ioniq5-asset/README.md).

## 1. 원본 파일 검증

| 항목 | 결과 |
|---|---|
| 경로 | `C:\CarScope-External\openx-assets\src\vehicles\hyundai_ioniq_5_2022\hyundai_ioniq_5_2022.blend` (upstream `1a63f13`) |
| 크기 / SHA-256 | 839,941 B / `e8e8788d…6abd8a` = `git lfs ls-files -l` oid, `git lfs fsck` OK |
| 첫 바이트 | `28 B5 2F FD` → **Zstandard 프레임** (LFS pointer 아님, gzip 아님) |
| 컨테이너 | Blender seekable zstd: 4 프레임 + seek table(skippable `0x184D2A5E`, footer `0x8F92EAB1`) |
| 해제 결과 | 3,893,940 B, 헤더 `BLENDER17-01v0502` (Blender 5.2, 64-bit block header 형식), SDNA 구조체 993개, 블록 5,111개, `ENDB` 종결 |
| 내용 | OB 101 / ME 44 / MA 30. `.xoma`의 `meshCount 44`, `triangleCount 37350`과 일치(아래 3절) |

기존 `get-openx-source.ps1`의 실패 원인은 파일 손상이 아니라 **압축된 바이트에서 `BLENDER`를 찾은 것**이다. 스크립트를 바이트 기반 판별(LFS pointer / 비압축 / zstd / gzip / UNKNOWN) → SHA-256과 LFS oid 비교 → `convert.mjs --check`로 해제·구조 파싱 순서로 다시 작성했다. 기존 clone이 있으면 덮어쓰지 않고 origin이 openx-assets인지 확인한 뒤 재사용한다.

주의: Node의 `zstdDecompressSync`를 파일 전체에 한 번 적용하면 **첫 프레임(67,137 B)만** 반환되고 오류가 나지 않는다. 잘린 데이터를 정상으로 오인하지 않도록 seek table로 프레임별로 해제하고 크기를 대조한다(테스트 포함).

## 2. 자동 변환 경로

Blender CLI가 없고 설치는 지시에 따라 하지 않았다. 대신 `.blend` 자체의 SDNA(파일 안의 구조 정의)를 읽는 의존성 없는 Node 리더를 만들었다. 실행 코드는 없고 읽기만 한다.

- 객체 계층·`loc`/XYZ Euler(`rotmode=1`)/scale, `parentinv`(전부 identity 확인), delta transform(없음), 모디파이어·constraint(0개 — 있으면 `issues`로 보고).
- 메시: Blender 5.x `AttributeStorage`의 `position`, `.corner_vert`, `poly_offset_indices`, `material_index`, `sharp_face`. 정점은 그대로 재사용하고 면만 삼각분할한다(사각형은 짧은 대각선, n각형은 ear clipping).
- 재질: Principled BSDF의 링크되지 않은 상수(Base Color/Metallic/Roughness/Alpha/Transmission/Emission). 30개 모두 상수, 텍스처·UV 없음. `blend_flag`의 backface-culling 비트가 모두 꺼져 있어 Blender glTF exporter와 같이 `doubleSided: true`.
- Blender 5.x는 블록 주소를 ID별로 만든다. 파일 전체에서 45개 주소가 중복되므로 포인터는 소속 ID 범위에서 먼저 해석한다(합성 테스트 포함).
- 결과는 결정적이다: 같은 입력에서 GLB SHA-256 `cfe0d754…00139e1`이 반복 생성됨.

변환하지 않은 것(추정으로 채우지 않음): Blender custom split normal(`custom_normal`, corner normal space 기준 int16×2 인코딩)은 **NOT_DECODED**. 법선은 sharp face는 면 법선, 나머지는 각도 가중 평균으로 생성한다. 위치·토폴로지에는 영향이 없고, 도어 측면에 사선 모양 음영 차이가 보인다.

## 3. 변환 결과와 메시 분석

전체 분석: [ioniq5-analysis.json](visuals/p2-a6/ioniq5-analysis.json), 메시별 변환 기록: [ioniq5-conversion.json](visuals/p2-a6/ioniq5-conversion.json). 좌표는 CarScope 세계 cm(+X 전방, +Y 좌측, +Z 상단).

| 항목 | 값 |
|---|---|
| 노드 / 메시 노드 / 그룹(Empty) | 101 / 44 / 57 |
| 원본 정점 / 면 | 46,655 / 25,274 |
| glTF 정점(법선 분할 후) / 삼각형 / draw call | 65,953 / **37,350** / 117 |
| 재질 / 텍스처 | 30 / 0 |
| 전체 bbox | x −232.87…232.87, y −108.53…108.53, z 0…162.77 |
| 계층 | `Grp_Root › Grp_Exterior/Grp_Interior › *_Static/*_Dynamic › Grp_Door_*/Grp_Wheel_*/Grp_Light_*…` (ASAM OpenMATERIAL 3D v1.1.0 구조) |

원본 규약(OpenX `src/README.md`): +X 전방, +Y 좌측, +Z 상단, m, 원점은 지면 위 bbox 중심, 휠은 `Wheel_<축 앞→뒤>_<우→좌>`. **CarScope 차량 축과 같고 단위만 다르다.**

부품 분리 상태 — 이름이 있는 것과 정밀 메시가 있는 것을 구분한다(밀도 = 삼각형 / bbox 표면적 m²):

| 분류 | 노드 | 형상 근거 |
|---|---|---|
| 차체 | `Body` | 4,031 tri, DETAILED |
| 측면 도어 4 | `Door_Left_0/1`, `Door_Right_0/1` | 649–806 tri, 창유리 포함 하나의 메시, DETAILED |
| 후드 / 테일게이트 | `Door_Front_0` / `Door_Rear_0` | 1,592 / 7,842 tri, DETAILED |
| 휠 4 | `Wheel_*_*` | 각 3,009 tri, 타이어·림·디스크가 재질 구역으로만 구분 |
| 유리 | `Body_Glass` | 124 tri, 평면 위주(COARSE 표시는 평면성 때문) |
| 미러 2 | `Mirror_Side_*_0` | 309 tri, 미러 측 방향지시등은 별도 노드 |
| 램프 | `Lamp_Housings` + `Light_*` 21개 | 하우징 3,638 tri; low/high beam·번호판등 6개는 **2 tri 평면 marker**, 7개는 PROXY |
| 브레이크 캘리퍼 4 | `Brake_Caliper_*` | 각 52 tri, 8×8×10 cm **PROXY** |
| 실내 | `Interior_Static` | 636 tri 하나, 박스형 시트·평판 바닥 **COARSE_PLACEHOLDER** |
| 스티어링 휠 | `Steering_Wheel` | 692 tri |

서비스 부품 가용성: 고전압 배터리·구동 모터·서스펜션·충전 포트·열관리 = **NOT_AVAILABLE**(노드·재질 모두 없음). 브레이크 디스크·시트 = **MATERIAL_REGION_ONLY**(휠/실내 메시의 재질 구역일 뿐 별도 메시 아님). 캘리퍼 = **PROXY_ONLY**. 없는 데이터는 만들지 않았다.

도어 식별: 이름이 아니라 메시 위치로 `FRONT_LEFT=Door_Left_0`, `REAR_LEFT=Door_Left_1`, `FRONT_RIGHT=Door_Right_0`, `REAR_RIGHT=Door_Right_1`를 도출했고 이름과 일치했다. 도어 그룹 원점(피벗 후보)은 앞 (95.4, ±94.0, 91.4) cm, 뒤 (−21.8, ±94.9, 93.6) cm. **힌지 회전축은 원본 문서에 없으므로 UNVERIFIED**이고 PoC는 도어를 움직이지 않는다.

## 4. 공식 제원과의 차이

보정 없음(`calibration.applied=false`). 기준값 출처: 축거·전폭은 [Hyundai India 사양](https://www.hyundai.com/in/en/find-a-car/ioniq-5/specification), 전장·전고·지상고는 2022 전기형 기준 2차 집계([CarExpert](https://www.carexpert.com.au/hyundai/ioniq-5/2022/dimensions), [EV Specifications](https://www.evspecifications.com/en/model/558213f)).

| 항목 | 모델 | 기준 | 차이 |
|---|---:|---:|---:|
| 전장 | 4,657.3 mm | 4,635 | +22.3 (+0.48%) |
| 전폭(미러 제외) | 1,912.6 | 1,890 | +22.6 (+1.20%) |
| 전폭(미러 포함) | 2,170.5 | — | 공식값 미확인 |
| 전고 | 1,627.7 | 1,605 | +22.7 (+1.42%) |
| 축거 | 3,022.4 | 3,000 | +22.4 (+0.75%) |
| 윤거 앞/뒤 | 1,544.6 / 1,544.6 | 출처 간 1,552–1,647로 불일치 | 판정 보류 |
| Body 최저점 | 229.9 | 지상고 160 | 측정 정의가 달라 비교 불가 |
| 휠 지름 | 751.2 | `.xoma` 751.2 | 0 |

모든 외형 치수가 비례가 아니라 거의 일정하게 **약 +22 mm** 크다. 균일 스케일 오차로 설명되지 않으므로 축별·균일 재스케일을 하지 않았다. 원인(원본 모델링 차이, 측정 정의 차이)은 미확인이다. 미러 제외 전폭은 미러 그룹 하위 전체(미러 측 방향지시등 포함)를 제외한 값이다.

## 5. CarScope 통합 설계와 구현 범위

- 프로필 분리: [profile.mjs](../tools/ioniq5-asset/profile.mjs)의 `VEHICLE_PROFILES` = `pleos-avd-reference`(기존 `ENVELOPE_SUV`를 그대로 재노출, `profileId: manual-pleos-avd-envelope-v1` 불변, **기본값**) + `hyundai-ioniq5-2022`(`kind: EXTERNAL_MESH`, `oemGeometry: false`, 출처·SHA-256·저작자 표시·`redistribution: NOT_IN_REPOSITORY`). AVD 메타데이터(`Hyundai 42dot / Connect / 2024`)를 IONIQ 5로 재라벨하지 않는다.
- 좌표 계층: ① 변환기는 기존 계약과 같은 회전 `(x,y,z) → (x,z,−y)`만 적용(이미 m, scale/matrix 노드 없음; 원본의 float 반올림 scale `0.99999994` 3개는 그대로 유지) ② `gltfToCarCm`이 glTF m → CarScope cm 역변환 ③ 치수 보정 계층은 `REPORT_ONLY`. 원본 메시를 재사용하고 procedural 모델을 다시 그리지 않았다.
- PoC: [tools/three-poc/ioniq5.html](../tools/three-poc/ioniq5.html) (debug 전용). `serve.mjs`는 `CARSCOPE_IONIQ5_GLB`가 설정됐을 때만 `/external/ioniq5.glb`를 제공한다. 클릭 레이캐스트로 부품 선택, CarScope cm bounds·계층 경로 표시, 외피 숨기기, 6방향 뷰, CC BY 저작자 표시. 금속 도장이 환경광 없이 검게 보여 RoomEnvironment를 썼다.
- 변경하지 않은 것: 앱 기본 차량, Android 앱/APK, `VehicleSvgRenderer`, Anatomy 출력, 기존 `car.glb`/Envelope GLB 생성기, AVD 데이터.

![ISO 뷰](visuals/p2-a6/iso.png)
![FRONT_LEFT 선택](visuals/p2-a6/selected-door-front-left.png)
![외피 숨김: 실내 placeholder, 내부 구동계 없음](visuals/p2-a6/shell-hidden.png)

이미지: “Hyundai Ioniq 5” © 2022 andikapratamaw, CC BY 4.0; 수정 © 2026 Dogan Ulus (OpenX Assets, MPL-2.0 AND CC-BY-4.0); CarScope 변환·렌더. 커뮤니티 모델이며 Hyundai 데이터가 아니다.

## 6. 검증 결과

| 검사 | 결과 | 근거 |
|---|---|---|
| 원본 무결성 | PASS | SHA-256 = LFS oid, zstd 4프레임 크기 일치, SDNA 크기 합 일치, ENDB |
| 변환 | PASS | 44 메시, 37,350 tri, issues 0 |
| glTF 유효성 | PASS | Khronos glTF-Validator 2.0.0-dev.3.10: 오류 0 / 경고 0 / 정보 0 / 힌트 0 |
| `.xoma` 대조 | PASS | bbox 최대 편차 0.04 mm, 메시 수·삼각형 수 일치, 차축 위치 편차 0 mm, 휠 지름 일치 |
| 좌표·스케일 독립 재계산 | PASS | `.blend` 원본 좌표계(glTF 코드 미사용)로 계산한 44개 메시 월드 bbox와 GLB 결과의 최대 편차 0 cm |
| 축 방향 | PASS | 전조등 +X, 후미등 −X, 좌측 미러 +Y, 최저점 z=0 |
| 계층 보존 | PASS | 101 노드 원본 부모-자식 그대로, 메시 노드 이름 44개 고유 |
| 부품 선택 | PASS | 브라우저 레이캐스트(화면 좌표 → ray): 도어 4·후드·테일게이트·휠 2·실내 기대값과 일치, 콘솔 clean |
| 단위 테스트 | PASS | `node --test tools/ioniq5-asset/test/*.test.mjs` 10 PASS + 실제 자산 1 SKIP; `IONIQ5_BLEND` 지정 시 11 PASS |
| 기존 회귀 | PASS | Anatomy audit, `anatomy-car.parts` diff 없음, export, Envelope, anatomy-car 테스트 52/52, Geometry verify(Khronos 0/0), `:vehicle-core:test` BUILD SUCCESSFUL |
| Blender 원본 렌더와 시각 비교 | NOT_RUN | Blender 없음 |
| Android WebGL Lab/AVD 로딩 | NOT_RUN | 이번 범위는 브라우저 PoC |

테스트 중 발견해 고친 리더 결함: SDNA 4바이트 정렬을 파일 절대 오프셋 기준으로 하던 것을 SDNA 시작 기준으로 수정(실제 파일은 우연히 정렬이 맞았음).

## 7. 라이선스와 커밋 정책

`.xoma`·`src/REUSE.toml` 선언: `MPL-2.0 AND CC-BY-4.0`, 저작권 (c) 2026 Dogan Ulus, (c) 2022 andikapratamaw (CC BY 4.0). OpenX README: 재배포·표시 시 원저작자 표시 필요. 라이선스 자체는 명시돼 있지만 ① 파생 GLB에 대한 MPL-2.0 파일 단위 고지 의무, ② Hyundai 디자인·상표 관련 판단이 남아 있다. 그래서 `.blend`와 변환 GLB는 커밋하지 않았다(저장소는 현재 PRIVATE). 저장소에는 도구, 측정 JSON(정점 데이터 없음), 저작자 표시가 있는 렌더 이미지 3장만 있다.

## 8. 다음 단계

1. 파생 GLB 배포 여부 결정(MPL 고지 파일·저작자 표시 위치·상표 문구).
2. 도어 힌지 축: OpenX/esmini에 문의하거나 도어 메시 앞 가장자리에서 축을 도출해 검증한 뒤 애니메이션.
3. custom split normal 디코딩(Blender corner normal space 재현) 또는 Blender CLI 사용 승인 후 Blender export와 시각 비교.
4. Android WebGL Lab에 external profile 로딩 경로 추가(debug 한정)와 AVD 성능 측정.
5. 약 +22 mm 일정 오차의 원인 조사; 윤거·타이어 규격의 신뢰 가능한 1차 출처 확보.
6. 배터리·모터·서스펜션은 이 원본에 없다. 필요하면 출처가 분명한 별도 자산이 있어야 하며, 그 전까지 `NOT_AVAILABLE`로 표시한다.
