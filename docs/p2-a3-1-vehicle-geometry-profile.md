# P2-A3-1 — Vehicle Envelope Geometry Profile

2026-10-31 KST. 기준 main `088573401c3a6735b0fbd56938a236ab46995b19` (PR #8 merged 확인 후 clean main fast-forward). 작업 사본 `C:\dev\CarScope`, 브랜치 `feat/p2-a3-1-vehicle-geometry-profile`. `Documents\CarScope`는 변경하지 않았다. Anatomy는 `1482e8469b0a9e0d8cc18ea2740a01423d29ae80` 그대로이다.

**CONDITIONAL GO: 수동 envelope 형상 실험. OEM 모델 일치·제품 렌더러 전환은 미검증이다.** 이 작업은 새로운 procedural SUV/Crossover를 별도 생성하며 기존 Generic Sedan의 기본 SVG/GLB와 Android 앱은 보존한다. 메타데이터의 `Hyundai 42dot / Connect / 2024`를 실제 양산차 이름으로 해석하지 않는다.

## 프로필과 출처

[VehicleGeometryProfile](../tools/anatomy-car/profiles/vehicle-profile.mjs)의 `manual-pleos-avd-envelope-v1`은 `source=AAOS_SIMULATED_METADATA`, `identityStatus=PARTIAL`, `oemVisualMatch=UNVERIFIED`, `actualVehicleIdentity=null`이다. 원본 관측은 [P2-A3-0 결과](p2-a3-0-vehicle-identity-probe.md)와 [비식별 증거 인덱스](evidence/p2-a30/2026-10-31-codex/README.md)에 있다. 이번 단계에서 AVD API를 다시 읽지 않았다.

모든 관측 치수에는 `unit=mm`, `source`, `property=INFO_EXTERIOR_DIMENSIONS`, 배열 index가 들어 있다. `envelopeParameters()` 경계에서만 `/10`하여 cm로 사용한다. 세계 좌표는 +X 전방, +Y 차량 좌측, +Z 위이며 GLB는 `(x,z,-y)/100` m이다.

| AAOS 항목 (index) | 관측 mm | 실제 생성 형상 mm | 형상 편차 mm | 인코딩 GLB 편차 mm |
| --- | ---: | ---: | ---: | ---: |
| height (0) | 1776 | 1776 | 0 | +0.000022888 |
| length (1) | 4950 | 4950 | 0 | -0.000190735 |
| width (2) | 2008 | 2008 | 0 | +0.000000216 |
| widthWithMirrors (3) | 2140 | 2140 | 0 | -0.000001431 |
| wheelbase (4) | 2984 | 2984 | 0 | -0.000032425 |
| frontTrack (5) | 1665 | 1665 | 0 | -0.000038147 |
| rearTrack (6) | 1667 | 1667 | 0 | +0.000055313 |
| turningDiameter (7) | 11800 | null | null | null |

편차는 닫힌 전체 mesh의 실제 vertices 및 GLB Float32 BIN/node translation을 독립적으로 읽어 계산한다. 전폭은 mirror housing/arm만 제외하고, 미러 포함 폭은 전 부품을 포함한다. 전고는 타이어 접지면부터 roof crown까지이다. wheelbase/track은 실제 tyre mesh bounds 중심으로 측정한다. 기준값을 그대로 출력해 측정을 대체하지 않는다. turning diameter는 provenance만 보존하며 steering kinematics가 없어 검증하지 않는다. 치수 일치는 시뮬레이터 envelope와의 일치이며 실차 측정 정확도가 아니다.

## 관측되지 않은 설계 변수

`unknown`의 wheelRadius, front/rearOverhang, groundClearance, bodyCurvature, hoodOpeningGeometry, internalPartPlacements는 null이다. 형상에 필요한 값은 별도 `estimates`에 `DESIGN_ESTIMATE`, mm, 선택 근거를 기록한다.

| 설계 추정 | 값 / 근거 |
| --- | --- |
| wheel radius / tyre width | 380 / 250 mm; reference crossover wheel |
| 앞/뒤 overhang | 각 983 mm; `(4950-2984)/2`의 임의 균등 분배 |
| ground clearance / door sill | 230 / 310 mm; 참고 외피 구조 |
| belt / roof edge / crown | 1160 / 1726 / 1776 mm; 높은 cabin, crown 50 mm |
| roof half width | 830 mm; 추정 tumblehome |
| windshield base / roof front / roof rear / rear glass base X | +900 / +270 / -1840 / -2280 mm; axle midpoint 기준 추정 실루엣 |
| arch / flare / door notch radius | 460 / 485 / 510 mm; 추정 wheel clearance |
| panel / door thickness | 18 / 24 mm; OEM 구조가 아닌 참고 solid |
| front/rear aperture | hinge X +84/-35 cm, 끝 X -21/-111 cm, 최대 64°/58°; 별도 design estimate |

나머지 lamp, hub support, hinge, panel band, trim 등 procedural 상수도 `design.unobservedConstruction`에 설계 추정임을 명시한다. 보닛 개방과 내부 부품 배치는 구현하지 않는다. shape profile을 다른 실차의 측정 프로필이라고 재사용해서는 안 된다.

## 형상 설계와 파일 경계

- [새 SUV builder](../tools/anatomy-car/envelope/model.mjs)는 기존 Sedan builder를 호출하거나 일괄 scale하지 않는다. 긴 roof, 높은 greenhouse, 짧은 rear deck/hatch, 별도 hood, 4개 도어 개구부, 윤거가 다른 앞/뒤 차축을 직접 만든다. 차축 X는 ±149.2 cm, 앞 Y는 ±83.25 cm, 뒤 Y는 ±83.35 cm이다.
- roof crown은 quadratic 단면을 샘플링해 하나의 실제 prism shell로 만들고 hood와 wheel arch에도 샘플링한 단면을 사용한다. SVG path는 기존 adapter가 지원하는 M/L/Z로 tessellate하며, unsupported Q path가 조용히 허용되지 않는 회귀 검사가 있다. Anatomy 원본은 수정하지 않는다.
- arch 외피와 door relief는 실제 polygon이다. flare trim은 두께 없는 planar inlay 4개이며 watertight solid라고 주장하지 않는다. fascia는 lamp/grille 개구부 주변의 실제 panel로 나눈다. SVG/GLB의 동일 recorder primitive를 사용하며 audit proxy로 대체하지 않는다.
- shared exporter는 optional door definition/pivot/openSign/profile/measurementRole을 받는다. 기존 기본값을 유지하면서 오른쪽 도어를 반대 회전 부호로 추가한다. 충돌 sweep는 4개 도어의 모든 6개 쌍을 검사한다.
- 기존 `dims.mjs`의 body/wheel/greenhouse 기준을 `GENERIC_SEDAN_PARAMETERS`로 분리하되 값과 기본 projection을 보존했다. 비교 페이지에서만 선택적 projection을 전달한다.
- Three.js debug preview에 별도 `/envelope.glb`, 오른쪽 도어 controls, TOP, 선택적 exact orthographic views를 추가했다. 기본 Sedan camera/controls는 기존 동작을 유지한다. 프로덕션 WebView·SVG, SDK mapping, STALE, 출시 설정은 변경하지 않았다.

최종 SUV는 **143 parts / 11,120 triangles**, 그중 closed solids 139개, open planes 4개다. Sedan 91 parts / 7,573 triangles는 이번 회귀 기준선이며 모든 미래 모델이 지켜야 하는 부품 수 계약은 아니다.

## 자동 검증과 정책

[envelope artifacts](../tools/anatomy-car/envelope/artifacts.mjs)는 generation과 verification을 분리한다. verify는 산출물을 새 모델과 byte 비교하고, GLB binary oracle/차원/metadata/mesh/rigidity/Khronos/audit/collision을 실행한다. 이전 PASS가 있어도 시작 시 FAIL/incomplete로 바꾸며, stale/corrupt/불량 결과는 nonzero이다.

기존 [검사 정책](../tools/anatomy-car/geometry-export/policy.mjs)은 그대로이다. collision 0.3 cm (3 mm), surface epsilon 1e-7 cm, rigidity 1e-8 cm, GLB position 1e-6 m. 치수 oracle은 double geometry 1e-6 mm, GLB 치수는 양 끝점 Float32 오차를 위해 기존 position 허용 오차의 두 배인 0.002 mm이다. 이는 충돌 허용치와 별개다.

도어는 front 0–64°, rear 0–58°를 1° 간격, 4–7°를 0.1° 간격으로 검사한다. 좌우 앞도어 각 92개, 뒷도어 각 86개 자세에서 점 포함 및 삼각형 표면 교차 검사를 수행했고 penetration 최대 0 cm였다. 6쌍의 독립 개방 각도 조합은 총 47,508개이다. 이 조합의 door-door AABB가 분리되어 narrow phase `testedPairs=0`; 47,508번의 삼각형 교차 검사라고 해석하면 안 된다. 연속 회전 전체의 무충돌 증명은 아니다.

| Gate | 상태 | 재현 명령 / 근거 |
| --- | --- | --- |
| 기존 Sedan SVG/audit | PASS | `npm run build --prefix tools/anatomy-car` |
| 기존 Sedan GLB/충돌 | PASS | `npm run export --prefix tools/anatomy-car`, `npm run verify --prefix tools/anatomy-car` |
| SUV generate + verify | PASS | `npm run envelope --prefix tools/anatomy-car`; audit 0, degenerate/flipped/winding/non-manifold 0, closed watertight/outward 139/139, Khronos errors/warnings 0/0 |
| Node unit/regression | PASS | `npm test --prefix tools/anatomy-car`; 기존 34 + 신규 11 = 45, failures/skipped 0 |
| Kotlin core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`; 24 tests |
| Workflow lint | PASS | actionlint 1.7.12, `.github/workflows/geometry-ci.yml` |
| Headless SVG/GLB/browser | PASS | 아래 32개 capture, SVG line checks 10개 console clean, 축 방향/도어 inventory assert |
| 기존 Three Lab 회귀 | PASS | `node tools/three-poc/check-views.mjs http://127.0.0.1:8096/?cam=svg&landmarks=1 .tools/p2-a31/legacy-views`; 기존 91 mesh / 7,573 triangles, 방향 assert 및 console clean |
| 새 AVD/Android runtime | NOT_RUN | Android 코드·생성 제품 자산 변경 없음. C 이미지는 P2-A3-0 실제 AVD 캡처를 재사용 |
| CI | PR checks 참조 | 기존 JVM/Identity CI 유지. Geometry CI에 독립 envelope generation/verification 추가. 현재 head 결과는 PR 본문과 checks에 기록 |

신규 테스트는 provenance/단위 및 invalid input, 실제 mesh/GLB 치수, Sedan SHA, 4개 도어의 watertight/rigidity/physical orientation/GLB 부호, curved path adapter, 모든 도어 자세의 SVG bounds, mirror 간섭 fixture, 전체 sampled collision, stale/corrupt CLI nonzero를 다룬다. 필요 설치는 기존 lockfile과 정확한 Anatomy pin만 사용한다.

## 화면 비교와 재현

이번 HEAD에서 새로 캡처해 Git에 포함한 [Sedan·SUV SVG/GLB 이미지 갤러리](visuals/p2-a3-1/README.md)는 README에서 별도 설치 없이 볼 수 있다. 11개 PNG는 실제 Anatomy headless SVG 및 Three.js GLB 렌더링이며, 각 파일의 출처·해상도·제한은 갤러리에 기록했다. 정면·측면·후면·상면 이미지는 GLB 렌더링으로 표기하며 OEM AVD 화면 원본을 포함하지 않는다.

```powershell
npm ci --ignore-scripts --prefix tools/anatomy-car
npm run build --prefix tools/anatomy-car
npm run export --prefix tools/anatomy-car
npm run envelope --prefix tools/anatomy-car
node tools/anatomy-car/envelope/compare.mjs --oem-screen .tools/p2-a30/final/probe.png
$env:PORT='8096'
node tools/three-poc/serve.mjs
# 별도 터미널
node tools/anatomy-car/envelope/check-visuals.mjs .tools/p2-a31/review http://127.0.0.1:8096/
```

Anatomy 위치는 기존 `ANATOMY_HOME` 탐색을 따른다. 비교용 OEM 이미지가 없는 환경에서는 `compare.mjs`에 `--oem-screen`을 생략하면 C가 NOT_RUN placeholder로 표시된다. 원본 캡처·생성 GLB/HTML은 Git에서 제외한다. 결과 경로와 hash는 [이번 증거 인덱스](evidence/p2-a31/2026-10-31-codex/README.md)에 있다.

- A/B는 azimuth 56° / elevation 28°, 같은 pixel/cm scale와 projection origin의 front 3/4이다. 독립적으로 fit한 이미지를 크기 비교로 오해하지 않도록 `comparison-camera.json`을 남긴다. C는 기존 AVD screenshot에서 OEM 차량이 보이는 영역을 CSS crop한 2D 참고 이미지다. 그 카메라/scale는 미보정이므로 3D ground truth가 아니다.
- A는 낮은 roof와 긴 sedan deck을 보이며 B는 높은 cabin과 길어진 roof, 짧은 rear deck이 보인다. 관측 wheelbase/track/height에 맞춰 B의 wheel centers와 전체 비율이 달라졌다. C는 더 매끄러운 곡면과 자세한 OEM lamp/fascia/wheel을 보인다. B의 실루엣이나 lamp를 특정 실제 모델과 일치시킨 것은 아니다.
- B는 light/dark × closed/FL OPEN/RL OPEN/left OPEN/all OPEN × 1×/4× = 20개 SVG, 비교 2개, GLB controls/3/4/front/left/rear/right/top/all OPEN/RL 5.5°/30° = 10개를 캡처한다. 방향은 screenshot 이후 camera vector를 assert한다. FL/RL hinge와 앞뒤/좌우 의미, 가시 면·음영·clipping을 확인한다.
- Windows GUI/AVD를 새로 실행한 것으로 보고하지 않는다. 실제 렌더링 검사는 pinned Anatomy의 headless browser capture/drive이다. 성능 benchmark는 수행하지 않았다.

## 실패 이력과 한계

초기 SUV mirror arm이 A-pillar와 약 0.966 cm 간섭해 FAIL이었다. [고정 fixture](../tools/anatomy-car/test/fixtures/envelope-mirror-interference.json)로 재현하고 mirror arm을 뒤로 이동했으며, front window 상단도 pillar와 겹치지 않도록 실제 형상을 줄였다. threshold/검사 대상은 바꾸지 않았다. 초기 audit의 support/depth 문제는 hub/hinge support 연결, band 분할, wheel compound painter order와 arch trim 형상 수정으로 해결했다.

초기 headless 검사는 TOP camera가 OrbitControls에 의해 바뀌어 FAIL이었다. 선택적 exact view의 controls update를 정지시키고 capture 뒤 방향 assertion을 유지했다. 일부 4× capture의 초기 빈 타일은 capture wait을 100→2000 ms로 늘린 후 다시 저장했으며, 비교 card caption clipping은 `.iso-page` capture로 수정했다. 이전 실패 폴더는 PASS 근거로 쓰지 않는다. 최종 fascia의 lamp/grille 가림은 panel 개구부로 수정했다.

roof/hood crown은 샘플링한 면이며 자동차 Class-A surface가 아니다. 옆면과 fascia는 여전히 평면적이고 panel seams가 강하다. 복합 곡률, wheel-arch 두께 변화, detailed lights, underbody closure, interior, hood opening, 실제 부품 배치는 없다. 139개 개별 closed solids의 watertight 결과를 차량 전체가 하나의 수밀 shell이라는 뜻으로 해석하면 안 된다. joint G1/G2 surface continuity도 증명하지 않았다. 열린 door에서 빈 cabin이 보이는 것은 미구현 내부의 한계다.

후속은 reference 프로필을 사용자가 고른 합법적 도면/실측 자료와 연결하고, 별도 승인된 shape revision에서 곡률·panel integration을 개선하는 것이다. 이번 envelope를 OEM exact replica 또는 자동 식별 결과로 승격하지 않는다. PR 자동 병합 없음.
