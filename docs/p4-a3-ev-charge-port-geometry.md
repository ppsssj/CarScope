# P4-A3 — EV 충전구 Geometry 계약과 검증

2026-11-02. 기준 `origin/main = 5c0664652037359ae0b08aa34b69bc4d74bff409`를 fetch·확인하고 clean 상태에서 `C:\dev\CarScope-ev-charge-port`, `feat/p4-a3-ev-charge-port-geometry`를 생성했다. 기존 A/B Worktree 및 PR #41은 수정하지 않았다.

판정: **로컬 Geometry 검증 PASS, 정적 Geometry 리뷰 가능**. 최종 HEAD의 CI 판정은 독립 PR checks에 기록한다. SDK 실측·정밀 OEM 모델 완료를 뜻하지 않는다.

## Phase A와 Gate

### 기존 GLB 조사 — FACT / 한계

외부 원본 SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`을 직접 열었다. 총 **101개 node / 44개 mesh node**다. Body·유리·측면 도어·보닛·tailgate·램프·바퀴 등의 계층과 원본 transform을 확인했다. 충전구·덮개 이름의 독립 노드나 관련 empty/pivot은 없다. 측면 도어는 별도 노드이며 충전구 후보는 우측 뒤쪽의 **Body 후방 quarter panel**, 뒷도어 뒤·rear lamp 옆·wheel arch 위 영역이다. 세계 +X 전방 / +Y 차량 좌측이므로 우측 후방은 x<0, y<0이다.

넓은 후보 영역(x -225~-165, y<-65, z 65~110 cm)을 조사했을 때 Body의 146개 삼각형과 `Body`, `Black_Plastic`, `Trim_Grey`, `Black_Gloss` 재질이 걸린다. 이들은 충전구 전용 재질이 아니다. 위치 근처 Body 면은 큰 연결 성분(3,907 triangles)에 이어져 있으며 독립 덮개 경계로 분리된 성분을 찾지 못했다. 실제 원본 Chrome close-up과 wireframe에서도 재사용 가능한 충전구 폐곡선·소켓을 식별하지 못했다. 따라서 **독립 형상이 없음은 확인했지만 Body 안에도 어떤 묘사가 전혀 없다고 단정하지 않는다.** 원본 면을 충전구로 재분류하거나 잘라 내지 않았다. 계층·면 index·재질·후보 좌표의 원본 자료는 Git 밖에 보관한다.

### 공식 차량 자료 — FACT / ASSUMPTION

- [Hyundai USA 2022 IONIQ 5 Emergency Response Guide, PDF p4 / 인쇄 p3](https://sweb-owners.hyundaiusa.com/content/dam/hyundai/us/myhyundai/manuals/erg/2022/ioniq-5/Ioniq5-erg.pdf#page=4): 충전구를 우측 후방으로 설명하고 차량 사진으로 위치를 보여 준다. 긴급 대응 절차는 이번 도구에 구현하지 않는다.
- [Hyundai UK 2022 사용설명서, PDF p32 / 인쇄 1-27, ONE1Q011040](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022.pdf#page=32): 넓은 상단과 좁은 하단의 덮개 윤곽, 열린 덮개 그림을 직접 확인했다. 그림에 위로 들어 올린 모습은 있으나 정확한 회전축·피벗 위치·각도는 얻지 못했다. **그림에서 힌지 좌표를 역추정하지 않는다.**
- [Hyundai Australia July 2022 사양표, PDF p1](https://www.hyundai.com/content/dam/hyundai/au/en/models/ioniq5/images/IONIQ5_Spec-Table_July_2022.pdf): AU의 AC Type 2 / DC CCS Combo2를 명시한다. 이를 모든 시장·연식의 소켓으로 일반화하지 않는다. [Hyundai USA CCS/NACS 안내](https://owners.hyundaiusa.com/us/en/resources/general-information/hyundai-nacs-adapter-faqs) 역시 미국 IONIQ 5의 CCS1과 다른 연식의 NACS 구성을 구분한다. 해당 참조 GLB의 충전 규격은 미확정이다.

**ASSUMPTION:** 이번 윤곽·치수·두께·방향·미세 간격은 위 위치·외형의 설명을 위한 저작 추정값이다. OEM 치수·차체 장착 좌표가 아니다. 덮개가 닫힌 외부 설명도만 만들며, 소켓은 생략한다. 내부 전기 구조·핀·배선·잠금/정비 절차는 추측하지 않는다.

### 실제 SDK 2.3.2 계약 — 정적 FACT

기존 [API inventory](https://github.com/ppsssj/CarScope/blob/41bebe7f8d7fac8cddcb4c2c9db7f845ae27f38f/docs/api-audit/pleos-api-inventory.csv)와 로컬 `Vehicle-2.3.2.aar`를 대조했다. AAR SHA-256: `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937`. `classes.jar`를 외부 디렉터리에 추출해 `javap -v -p`로 공개 선언·annotation을, `javap -c -p`로 구현의 property 참조를 확인했다. SDK·API 호출이나 Android 코드 변경은 없다.

| 실제 공개 API | 계약 | Deprecated / 권한 |
|---|---|---|
| `EvBattery.checkEvChargePortOpenCapabilities(onComplete, onFailed)` | `CapabilityConfig`, `Exception` callback. `accessType`은 NONE / READ / WRITE / READ_WRITE | 이 선언은 deprecated 아님. `pleos.car.permission.CAR_ENERGY` |
| `EvBattery.isEvChargePortOpen(onComplete, onFailed)` | `Boolean`, `Exception` callback | **WARNING** deprecated. 동일 CAR_ENERGY |
| `registerEvChargePortOpen(listener)` / `unregisterEvChargePortOpen(listener)` | `EvChargePortOpenListener.onEvChargePortOpenUpdated(Boolean)` | WARNING deprecated. 동일 CAR_ENERGY |
| `setEvChargePortOpen(boolean, …)` | 제어 API도 존재 | 조회가 아니며 이번 범위에서 사용·실행하지 않음 |

`isEvChargePortOpen`의 실제 annotation은 `This API is deprecated, use the Google EV_CHARGE_PORT_OPEN property.`이며 제거 또는 ERROR/HIDDEN deprecation이 아니다. 이 charge-port getter에는 `ReplaceWith` 표현식이 없다. 확인한 inventory/AAR의 공개 계약에서 별도 새 이름의 Pleos 충전구 getter는 찾지 못했다. [Pleos 공식 릴리스 노트](https://document.pleos.ai/en/docs/pleos-only/release-note/sdk-release-note)는 v2.3.1 설명이며 listener가 문서에서 숨겨지는 것과 선언 제거를 구분한다. **2.3.2의 근거는 실제 AAR**다.

권고 대체 경로는 [Android `VehiclePropertyIds.EV_CHARGE_PORT_OPEN`](https://developer.android.com/reference/android/car/VehiclePropertyIds#EV_CHARGE_PORT_OPEN)과 `CarPropertyManager`다. 이는 새 Pleos 메서드 이름이 아니다. 공식 Android 계약은 Boolean / GLOBAL / ONCHANGE이며 여러 포트가 있으면 어느 하나라도 열린 경우 true다. 이 Android 경로의 권한을 Pleos의 CAR_ENERGY와 동일하다고 가정하지 않는다. 문서의 에너지 포트 권한과 대상 OS·권한 승인·property config는 Codex B의 후속 연동 단계에서 확인해야 한다. 이번에는 플랫폼 API를 추가하지 않는다.

조회 의미는 **포트 외부 덮개 개방 상태**이며 소켓 연결·충전 중·잠금·충전 완료·안전 판정·개방 각도가 아니다. Pleos 구현은 `EV_CHARGE_PORT_OPEN`을 참조하고, callback bridge는 null을 null로 전달한다. non-null 문자열에는 `Boolean.parseBoolean`을 쓴다. 공개 callback만으로는 비정상 raw 문자열과 유효한 false를 구별할 수 없는 제한이 있다. 실측 raw 계약은 미검증이며 null/오류/권한 거부를 CLOSED로 바꾸면 안 된다. 여러 포트 여부와 차량별 매핑도 검증이 필요하다.

**Gate DECISION: PASS (정적 Geometry 범위).** 우측 후방 위치 근거와 제거되지 않은 상태 조회/Capability/권한 계약이 충분하다. Deprecated 경고와 런타임 지원은 별개다. 실제 capability·cache·listener·Google 대체 경로는 **NOT_RUN**이다. Wiper로 범위를 확장하지 않는다.

## Phase B/C — Codex B 재사용 계약

```js
import {
  measureEvChargePortSupport, buildEvChargePort, EV_CHARGE_IDS,
} from '../ioniq5-asset/ev-charge-port.mjs';
// sourceParts: existing loader/adapter's world triangles in CarScope cm, all original meshes
const support = measureEvChargePortSupport(sourceParts);
const { parts, bounds, joints, layout } = buildEvChargePort({ support });
// EV_CHARGE_IDS.port === 'ev-charge.port'; EV_CHARGE_IDS.flap === 'ev-charge.flap'
```

이 ID는 CarScope 내부 ID이며 SDK 식별자가 아니다. `ev-charge.port`는 외곽 surround, `ev-charge.flap`은 정적 닫힌 덮개다. 두 part의 `meta.inspectionTarget`은 상위 대상 `ev-charge.port`다. 개별 Raycast·강조에는 `meta.partId`를 쓴다. `geometryConfidence`, `positionConfidence`, `source`, `bounds`는 part 최상위 및 meta에 제공한다. 신뢰도는 **ESTIMATED_GEOMETRY**, dimension ESTIMATED / hinge·variant placement UNVERIFIED다.

반환값은 `{parts, bounds, joints:[], layout}`이다. `parts[].triangles`는 새 Float64Array, bounds는 `{min,max,center,size,unit:'cm',coordinateFrame}`이며 part별 bounds도 있다. `layout`은 동결된 저작 파라미터, 원점 `[-190,-87,98]` cm와 우측 후방의 추정 면 방향을 포함한다. 프레임 48 / 덮개 20, 총 68 triangles. reference 정렬 결과의 전체 bounds는 약 `[-207.24,-93.64,88]` ~ `[-176.11,-85.54,108]` cm다. 매 실행의 실제 반환값이 기준이며 OEM 좌표가 아니다.

support는 원본 삼각형을 추정 convex footprint에 정확히 clipping하고 해당 영역의 가장 바깥 면으로 정렬한다. 격자 샘플 또는 원본 정점만 검사해 내부를 가로지르는 큰 삼각형을 놓치는 방식이 아니다. 누락·비유한 triangles·후보 면 부재·참조 모델 적용 범위 밖이면 throw한다. `buildEvChargePort()`를 인자 없이 호출하면 실패하며, fallback 모델을 만들지 않는다. 현재 참조를 벗어난 자산은 원본 조사부터 다시 해야 한다.

원본 차체를 절삭하지 않는 **STATIC_SURFACE_OVERLAY**다. 정확한 OEM recess/장착 형상이 아니다. 접선 support 기준에서 프레임은 0.2~0.55 cm, 덮개는 0.45~0.85 cm 바깥에 둬 z-fighting을 피한다. 접선 기준과 실제 메시 접촉을 혼동하지 않는다. 프레임의 aperture 안에 더 작은 덮개가 들어가며 material 부피가 겹치지 않는다. 현재 메시에는 실제 접촉이 없어 contact 예외가 필요하지 않다. 임계값 변경·차체 면 제외 없이 전체 source와 교차 0을 요구한다. 향후 실측 장착 면을 구현한다면 접촉을 별도로 모델링·검증해야 한다.

`evChargePortGlb(model)`은 별도 sidecar Buffer를 반환한다. PR #44 패턴처럼 공통 triangles에서 GLB와 SVG를 생성하며 `(x,y,z)→(x,z,-y)/100`, 법선은 회전만 적용한다. 원본 GLB는 덮어쓰지 않는다. Three.js는 이름의 점을 정규화하므로 **`mesh.userData.partId`로 탐색**하고 hit의 같은 값을 사용한다. 검토 페이지는 차체를 포함한 가장 가까운 Raycast hit를 판별하여 차체 뒤 선택을 막는다.

가시성: 우측 후방 외부에서 덮개가 보이고 프레임은 얇아 선택 영역이 작다. 좌측·정면에서는 가려질 수 있다. 전용 focus/frame 카메라와 isolated 보기를 제공한다. 덮개 숨김은 검토용 visibility 변경이며 OPEN 상태나 실제 소켓 노출이 아니다. Boolean true를 회전각으로 변환하거나 이 정적 닫힘 형상을 실제 OPEN으로 표시하면 안 된다. UI·데이터 모듈은 별도 파일/후속 작업에서 이 제한을 지켜야 한다.

## Phase D — 재현과 결과

```powershell
npm ci --ignore-scripts --prefix tools/anatomy-car
npm ci --ignore-scripts --prefix tools/three-poc
$env:IONIQ5_GLB='C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/ev-charge-port-report.mjs --glb=$env:IONIQ5_GLB --out=C:\CarScope-External\ev-charge-port\recheck\report
node tools/ioniq5-asset/ev-charge-port-preview-server.mjs --glb=$env:IONIQ5_GLB --report=C:\CarScope-External\ev-charge-port\recheck\report
# 별도 terminal, pinned Anatomy Chrome driver 사용
node tools/ioniq5-asset/check-ev-charge-port-preview.mjs C:\CarScope-External\ev-charge-port\recheck\browser
# 기존 형상 회귀 (별도 terminal)
npm run build --prefix tools/anatomy-car
npm test --prefix tools/anatomy-car
npm run export --prefix tools/anatomy-car
npm run verify --prefix tools/anatomy-car
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

Windows 10 / Node 22.16.0 / Three.js 0.160.0 / Chrome headless. Anatomy `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`, 원본 clean. [외부 증거 인덱스](evidence/p4-a3/README.md).

| 판정 | 범위 | 결과 |
|---|---|---|
| PASS | 새 전용 Node 테스트 | 6/6, clipping·bad input·ID·bounds·manifold·volume·winding·퇴화·자기교차·GLB 법선/metadata·실제 GLB |
| PASS | IONIQ 전체 회귀 | 68 pass / 1 skip / 0 fail. EV battery / 보닛·타이어·service·inspection 포함 |
| NOT_RUN | 선택 사항 원본 Blend case | IONIQ5_BLEND 미설정에 따른 위 skip 1개. 실제 GLB case는 실행 |
| PASS | 메시 충돌 | 원본 44개 + 기존 EV battery·shell·service·inspection·frunk 0/30/60도와 교차 0 |
| PASS | 간격 | 원본과 frame 최소 0.1901596 cm, flap 0.9235575 cm. 두 신규 부품 사이 0.4 cm. 실차 장착 여유/안전 기준 아님 |
| PASS | GLB | Khronos errors 0 / warnings 0. cm↔m 최대 정점 오차 약 0.00001046 cm |
| PASS | 공통 triangles SVG | 별도 Chrome SVG 렌더링·직접 검토, console clean |
| PASS | 원본 무결성 | 원본 SHA 불변, 원본 보닛·타이어·차체 및 기존 생성기 코드 변경 없음 |
| PASS | 실제 Chrome | WebGL2, 두 ID의 실제 canvas 클릭·Raycast·강조·해제, 카메라 이동/복귀, source transform 보존, 최종 console clean |
| PASS | 기존 Anatomy 회귀 | audit / tests 58/58 / export / verify. 기존 91 parts / 7,573 triangles, Khronos 0/0, 기존 parts 출력 불변 |
| PASS | core JVM | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 37 pass / 외부 시각 자산 선택 case 1 skip |
| NOT_RUN | AVD/adb·Android·실차·SDK 실측 | 이번 범위에서 실행하지 않음 |
| BLOCKED | OEM 정밀 치수·힌지축·장착·시장별 소켓 | 근거 미확보, 형상은 설명용 추정 외관만 제공 |

첫 추정 배치는 렌더링상 rear lamp 영역과 겹쳐 보였다. 위치 조정 중 낮은 후보는 동일 최소 간격 검사(0.19 cm)를 통과하지 못했다(약 0.17998 cm). 기준을 낮추지 않고 quarter panel 위쪽으로 옮겨 최종 재검증을 통과했다. 이는 신규 저작 배치의 보정이며 기존 GLB 결함을 뜻하지 않는다. 최종 로그와 중간 결과를 분리 보존했다. frunk의 세 각도 검사는 연속 회전 전체의 무충돌 증명이 아니다.

금지된 Inspection UI·Activity/Manifest/Gradle·SDK DataSource·Mobile QR/AR·Sync/HTTPS/인증 코드 변경 없음. 기존 Worktree·원본 모델·PR #41 변경 없음. 원본 PDF·AAR/JAR·파생 GLB/SVG·캡처·로그는 저장소 밖에 보관한다.
