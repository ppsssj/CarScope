# P4-A4 — 전면 와이퍼 Geometry / 외부 조명 재사용 조사

2026-11-02. fetch한 `origin/main = 28c11bb7e9a373b6ba64f2b32b468ea84f4f2c43`에서 clean 상태로 `C:\dev\CarScope-front-wiper`, `feat/p4-a4-front-wiper-geometry`를 생성했다. 범위는 opt-in Geometry·검토 도구·문서다. 최종 CI는 독립 PR의 해당 HEAD checks로 확인한다.

## A — 원본 모델 조사

**FACT:** 실제 외부 GLB는 101 nodes / 44 meshes, SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`이다. 전체 이름·계층·세계 삼각형·재질·기존 `partIds()`를 조사했다. 독립 wiper/blade 노드와 새 ID 중복은 없다. 원본만 표시한 Chrome 유리 하단에서도 재사용 가능한 별도 암·블레이드를 식별하지 못했다. **Body에 통합된 묘사가 전혀 없다고 단정하지 않는다.**

`Body_Glass`는 별도 124-triangle 곡면으로, 모델 bounds는 x34.6923~106.7903 / y±71.4911 / z109.7310~145.6881 cm다. 보닛 `Door_Front_0`은 별도 1,592 triangles이며 `Grp_Door_Front_0` 아래에 있다. 보닛 bounds는 x99.5099~223.5124 / y±81.3494 / z83.5893~108.1568 cm다. 즉 원본의 유리 하단과 보닛은 별도 높이 영역이고, 그 경계/cowl에 저작한 암을 두고 유리 하부에 블레이드를 배치할 수 있다. 이 수치는 **커뮤니티 참조 메시 측정**이며 OEM 좌표가 아니다. 원본의 기존 퇴화 삼각형은 보존했으며 새 형상의 퇴화 0과 혼동하지 않는다.

**DECISION:** 두 전면 와이퍼의 추정 외관을 추가한다. 후방 와이퍼는 추가하지 않는다. 원본 차체·유리·보닛·타이어를 수정하거나 형상을 추출해 새로 존재한다고 보고하지 않는다. +Y는 차량 좌측이고 운전석 여부와 무관하다.

## B — 공식 자료와 실제 SDK 계약

[Hyundai 2022 UK 설명서 Maintenance 9-16](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf#page=16)의 전면 암/블레이드 그림과 [Convenience 5-73](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-convenience-features.pdf#page=73)의 와이퍼 조작 설명을 직접 확인했다. 존재·유리 하단 위치의 근거이며 정확한 길이·장착·축·와이핑 궤적의 근거가 아니다. 정비/서비스 절차는 구현하지 않는다. 자료는 블레이드 오염·마모에 따른 상태와 작동 모드를 별개로 다룬다.

실제 `Vehicle-2.3.2.aar` SHA-256 `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937`을 외부 폴더에 추출해 `javap -v -p`로 확인했다. 기존 [정적 API inventory](https://github.com/ppsssj/CarScope/blob/41bebe7f8d7fac8cddcb4c2c9db7f845ae27f38f/docs/api-audit/pleos-api-inventory.csv)와 대조했다. 공식 WiperState 웹 페이지는 상세 enum 설명이 비어 있어 AAR 선언을 기준으로 했다.

| SDK 공개 계약 | 확인 결과 / Geometry 매핑 |
|---|---|
| `Wiper.checkWiperStateCapabilities` | 권장 overload는 `Function2<CapabilityConfig, Map<WindowArea,List<WiperState>>,Unit>` + 오류 callback. Map만 받는 구형 overload는 WARNING deprecated이며 새 overload 사용을 권고 |
| `Wiper.getCurrentWiperState(WindowArea, …)` | `WiperState` / `Exception` callbacks, `pleos.car.permission.CAR_WINDOWS`. 반환 가능한 범위는 실제 capability에서 확인해야 함 |
| 영역 구성 | **`WindowArea.FRONT_WINDSHIELD` 정적 필드는 없음.** 실제로는 `WindowArea(WindowValue.FRONT_WINDSHIELD)` 생성자 사용. `WindowValue.REAR_WINDSHIELD`의 존재가 2022 차량의 후방 와이퍼 존재를 뜻하지 않음 |
| `WiperState` | `OTHER`, `OFF`, `ON`, `SERVICE`. 기타/정지/동작/서비스 상태 구분이다. LO/HI/AUTO 속도·빗물량·실제 블레이드 위치·마모·수명 또는 안전 판정이 아님. SERVICE에서도 실제 자세/각도를 추정하지 않음 |
| 전면 와이퍼 매핑 | 전면 유리 영역의 하나의 상태 → 상위 `wiper.front`, 좌우 두 시각 부품. 좌우 독립 와이퍼 센서가 아님 |
| `Light.checkLowBeamLightStateCapabilities` / `checkHighBeamLightStateCapabilities` | `CapabilityConfig` + `List<LightState>` callbacks, `CAR_LIGHTS` |
| `Light.getCurrentLowBeamLightState` / `getCurrentHighBeamLightState` | `LightState` / 오류 callbacks, `pleos.car.permission.CAR_LIGHTS`. 좌우 area 인자가 없는 전역 조회 |
| `LightState` | `OFF`, `ON`, `DAYTIME_RUNNING`. 개별 getter에서 어느 값이 지원되는지는 실제 capability로 확인. 좌우 개별 센서·광도·광축·고장·정비 판정으로 해석하지 않음 |

정적 API 계약 확인 **PASS**. 실제 capability·현재 값·cache/listener·권한 승인·AVD 지원은 **NOT_RUN**이다. null/unknown/오류를 OFF 또는 정상으로 바꾸거나 자동 MOCK으로 대체하지 않는다. Geometry에 SDK 호출·새 어댑터·데이터 계약을 추가하지 않는다.

## 외부 조명 재사용 계약

`exterior-light-audit.mjs`의 Node 전용 `auditExteriorLights(sourceParts)`는 기존 `partIds()`를 사용해 이름·ID·재질·bounds·삼각형 수·기하학적 평면성을 외부 JSON으로 기록한다. 새 조명 Geometry나 SDK mapper가 아니다. 기울어진 평면도 법선과 평면 거리로 검사하며 AABB 한 축 두께만으로 판단하지 않는다.

| 기존 source / ID | 원본 형상 | 재사용 범위 |
|---|---|---|
| `Light_Low_Beam_Left_0`, `Right_0` → `light-low-beam-left-0`, `light-low-beam-right-0` | 각각 2 triangles, x≈212.8 cm의 평면 `Lamp_Projector` marker | 전역 Low Beam 상태의 양측 위치/의미 연결. 좌우 센서나 상세 bulb/optics 아님 |
| `Light_High_Beam_Left_0`, `Right_0` → `light-high-beam-left-0`, `light-high-beam-right-0` | 각각 2 triangles, x≈189.7 cm의 평면 `Lamp_Projector` marker | 전역 High Beam 상태를 같은 방식으로 연결. 하우징에 가릴 수 있어 emissive 변경만으로 가시성이 보장되지 않음 |
| `Lamp_Housings` → `lamp-housings` | 3,638 triangles, 전후면 cover/trim·pixel·reflector가 합쳐진 복합 영역 | 외관 유지에 재사용. 단일 전조등 또는 좌우 bulb 조립체로 취급하지 않음 |
| `Light_Day_Left_0/Right_0` | 각각 56 triangles | 기존 DRL 표시 영역, 정밀 발광체/광학 모델 미검증 |
| `Light_Brake_Left_0/Right_0`, `Center_0` | 각각 634 / 634 / 24 triangles | 기존 제동등 영역·ID 재사용 가능. 별도 SDK 상태 매핑은 이번 범위에서 구현하지 않음 |
| `Light_Tail_Left_0/Right_0`, `Light_Reverse_Left_0/Right_0` | 각각 20 / 20, 153 / 153 triangles | 기존 tail/reverse 영역, 상태·광학 실측 아님 |
| `Light_Indicator_Left_0/1/2`, `Right_0/1/2` | 앞 범퍼 172/172, 미러 16/16, 뒤 263/264 triangles | 기존 위치·ID 재사용. 새 방향지시등이나 독립 센서 의미를 추가하지 않음 |
| `Light_License_Plate_0/1` | 각각 2 triangles의 기울어진 평면 marker | 정밀 번호판등 조립체로 오인하지 않음 |

하우징과 여러 램프 영역은 이미 모델링돼 있으므로 이번 PR에서 전조등을 중복 생성하지 않는다. **상태 요약/위치 매핑은 기존 paired marker로 가능**, 실제 광학/분리된 실체 mesh가 필요한 선택·정비 상세가 목표라면 별도 Geometry 후속 PR의 근거가 된다. 원본 marker와 housing의 가림·재질 분리는 해당 후속 렌더링 검증이 필요하다. 실제 빔·조도·안전 또는 UI 연동 완료를 주장하지 않는다.

## C — Codex B용 Geometry 계약

```js
import {measureFrontWiperSupport, buildFrontWiperGeometry} from '../ioniq5-asset/front-wiper.mjs';
const support = measureFrontWiperSupport(sourceParts); // 모든 원본 world triangles, CarScope cm
const {parts,bounds,joints,layout} = buildFrontWiperGeometry({support});
// parts[].id / meta.partId: wiper.front.left, wiper.front.right
// parts[].meta.inspectionTarget: wiper.front
```

`triangles`는 fresh Float64Array다. part별/전체 `bounds`는 `{min,max,center,size,unit:'cm',coordinateFrame}`이며 CarScope +X 전방 / +Y 차량 좌측 / +Z 위다. 신뢰도·출처는 최상위와 meta에 있고 geometry/position은 **ESTIMATED_GEOMETRY**, dimension ESTIMATED / hinge·mounting UNVERIFIED다. `joints:[]`, `moving:false`, pose `STATIC_REST_ILLUSTRATION`이다. 고정 자세를 SDK OFF 또는 현재 위치라고 표시하면 안 된다.

한 part는 암과 블레이드의 두 닫힌 외관 envelope를 포함한다(각 104, 총 208 triangles). `components`는 두 하위 envelope의 검사 용도다. 클램프·연결 기구는 생략했고 작은 암/블레이드 간격은 설명용이다. 저작한 블레이드 길이 56 / 49 cm, 폭 1.6 cm 및 모든 암 위치·폭·두께는 OEM 값이 아니다. 운전석/조수석 기준을 추정하지 않는다.

실행 시 각 저작 정점의 원본 표면 높이를 측정한다. blade footprint가 `Body_Glass` 밖이거나 필요한 유리/닫힌 보닛·높이 정보가 없으면 throw한다. 대체 모델·default support가 없다. 표본 사이의 곡면 근사는 **최종 전체 삼각형 충돌 검사로 검증**하며, support 샘플만으로 무간섭을 보장하지 않는다. 고무의 실차 접촉 대신 작은 표시 간격을 사용하고 어떤 source mesh도 충돌 검사에서 제외하지 않는다.

실제 reference에서 전체 bounds는 약 `[95.7,-52,108.4395]` ~ `[107.3112,59,116.9133]` cm다. 카메라에는 실행 시 반환한 bounds를 사용한다. compound bounds 중심은 빈 영역일 수 있으므로 선택 테스트는 실제 blade top triangle을 겨냥한다. glTF 변환은 `(x,y,z)→(x,z,-y)/100`, 법선은 회전만 적용한다. `frontWiperGlb(model)`이 두 와이퍼만 포함한 sidecar를 반환하고 동일 triangles가 SVG를 만든다.

Three.js 식별은 `mesh.userData.partId`로 한다. 재질을 공유한 채 개별 emissive를 변경하면 양쪽이 함께 변하므로 메시별 material clone이 필요하다. 전용 미리보기에 이를 적용하고 반대쪽 비강조까지 검증한다. 원본 차체를 포함한 가장 가까운 Raycast hit로 선택하므로 가려진 와이퍼를 차체 너머로 선택하지 않는다.

## D — 검증

```powershell
npm ci --ignore-scripts --prefix tools/anatomy-car
npm ci --ignore-scripts --prefix tools/three-poc
$env:IONIQ5_GLB='C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/front-wiper-report.mjs --glb=$env:IONIQ5_GLB --out=C:\CarScope-External\front-wiper\recheck\report
node tools/ioniq5-asset/front-wiper-preview-server.mjs --glb=$env:IONIQ5_GLB --report=C:\CarScope-External\front-wiper\recheck\report
# 별도 terminal, pinned Anatomy headless Chrome driver
node tools/ioniq5-asset/check-front-wiper-preview.mjs C:\CarScope-External\front-wiper\recheck\browser
npm run build --prefix tools/anatomy-car
npm test --prefix tools/anatomy-car
npm run export --prefix tools/anatomy-car
npm run verify --prefix tools/anatomy-car
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

Windows 10 / Node 22.16.0 / Three.js 0.160.0 / Chrome headless / JDK17. Anatomy pin `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`와 원본 clean을 확인했다. [외부 증거 인덱스](evidence/p4-a4/README.md).

| 판정 | 검증 범위 | 결과 |
|---|---|---|
| PASS | 새 전용 테스트 | 7/7: support 오류·ID·bounds·좌우·manifold·winding·퇴화·교차·GLB·marker 구분·실제 원본 |
| PASS | IONIQ 전체 | 75 pass / optional Blend 1 skip / 0 fail. 배터리·충전구·보닛·타이어·service 회귀 포함 |
| PASS | 메시 충돌 77건 | 전체 원본, 기존 추정 부품, frunk 0/30/60, 네 하위 envelope 사이, 보닛 A축 0~60도 정수 샘플: 교차 0 |
| PASS | 원본과 간격 | left 약 0.2289491 cm / right 0.2072243 cm. 참조 모델 표시 간격이며 OEM 장착 여유·안전 기준 아님 |
| PASS | GLB | Khronos errors/warnings 0/0, 최대 변환 정점 오차 약 0.000005944 cm |
| PASS | Chrome/SVG | 실제 GLB 원본/와이퍼·조명 영역 검토, 좌우 클릭·Raycast·독립 강조·해제, 카메라 복귀·원본 transform 보존, 최종 console clean. SVG 별도 렌더링·검토 |
| PASS | 기존 Geometry | Anatomy audit 및 58/58 tests, export/verify 91 parts / 7,573 triangles, Khronos 0/0. 기존 parts 출력 불변 |
| PASS | Core JVM | 37 pass / 선택 외부 시각 자산 1 skip / 0 fail |
| NOT_RUN | SDK/AVD/실차 | 실제 capability·값·listener·권한 및 차량 상태 미관측. adb 실행 없음 |
| NOT_RUN | 대체 보닛 축·연속 회전 | 신규 와이퍼와의 검사는 기존 모델링 A축 정수 샘플에 한정. 실제 힌지/연속 동작 무충돌 증명 아님 |
| BLOCKED | OEM 정밀 와이퍼·광학 모델 검증 | 장착점·길이·실제 축·궤적·클램프·마모·광학 성능 자료 없음 |

최초 Chrome 실행은 공유 material로 좌측 강조가 지워져 실패했다. 진단 로그에서 선택 ID/Raycast는 맞지만 emissive=0임을 확인했다. 메시별 clone으로 전용 미리보기를 수정하고 비선택 메시의 비강조를 포함한 전체 시나리오를 다시 PASS했다. 초기 실패·진단·최종 결과를 분리 보존했다.

금지된 제품 UI·Android·SDK DataSource·Native→WebView 계약·Release·Sync/인증/모바일·Codex B Worktree·PR #41 변경 없음. 다른 작업 프로세스를 종료하지 않았다. 원본/파생 모델·SVG·PDF·SDK 바이너리·캡처·로그는 Git 밖에 보관한다.
