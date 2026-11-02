# EV 고전압 배터리팩 개략 형상 — P4-A2

2026-11-02. 기준 main `846df27d8b2bcf325a278768076af30ab50cf6ef`에서 독립 Worktree `C:\dev\CarScope-ev-battery-pack`, 브랜치 `feat/p4-a2-ev-battery-pack`를 생성했다. 점검 UI·Android·SDK·Sync 연결은 범위 밖이며, `ev-battery.pack` 형상과 재사용 인터페이스만 추가한다.

## 근거와 우선순위

**FACT:** 외부 원본 GLB SHA-256은 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`이다. 44개 메시를 직접 열어 이름·삼각형·bounds를 조사했다. 별도 HV pack, 충전구, 와이퍼 메시 노드는 없다. 차체에 통합된 작은 외형의 의미는 확인하지 못했으므로 이 부품들이 차체 메시에도 전혀 없다고 단정하지 않는다. 원본 `Body`의 하부 면을 배터리팩으로 재분류하지 않는다. 기존 `battery-12v` 추정 형상은 보닛 아래 보조배터리이며 HV pack과 다르다.

**FACT:** [현대 E-GMP 발표(2020-12-02)](https://www.hyundai.com/worldwide/en/newsroom/detail/0000000812)와 [IONIQ 5 공식 자료](https://www.hyundai.news/uk/models/electrified/ioniq-5/press-kit/hyundai-ioniq-5-redefines-electric-mobility-lifestyle.html)는 바닥 아래, 전후 차축 사이 배치를 설명한다. 이 자료에서 해당 2022 참조 자산에 대응하는 팩의 정확한 외곽 치수·장착 좌표는 확보하지 못했다. 공식 배치 설명과 아래 저작 치수는 별개다.

기존 SDK 2.3.2 [정적 조사 요약](https://github.com/ppsssj/CarScope/blob/41bebe7f8d7fac8cddcb4c2c9db7f845ae27f38f/docs/api-audit/pleos-capability-summary.md) 및 [API inventory](https://github.com/ppsssj/CarScope/blob/41bebe7f8d7fac8cddcb4c2c9db7f845ae27f38f/docs/api-audit/pleos-api-inventory.csv)를 읽기 전용으로 대조했다. 해당 조사 브랜치를 병합하거나 수정하지 않았다. main의 [Tire 후속 후보](p3-v1-pleos-tire.md)와도 일치한다. API 존재는 capability PASS, 실제 값·listener 수신 또는 차량 상태 검증을 뜻하지 않는다.

| 순서 | 부품 | 기존 구현 / 정적 API 근거 | 결정 |
|---|---|---|---|
| 1 | HV pack | 별도 메시 없음. `EvBattery.getEvBatteryStateOfCharge` 조회 존재, CAR_ENERGY | 이번 단계의 단일 대상 |
| 후속 | 충전구 | 별도 노드 없음, 통합 외형 미확인. `isEvChargePortOpen`은 deprecated로 조사됨 | 대체 권장 API·capability·문 위치 조사 후 결정 |
| 후속 | 와이퍼 | 별도 노드 없음, 통합 외형 미확인. `Wiper.getCurrentWiperState(WindowArea, …)`, CAR_WINDOWS | 영역·상태 enum·기존 외형 조사 후 결정 |
| 제외 | 12V 배터리 | 기존 추정 형상 있음. SDK 조사에서 EV 배터리와 구분 | 중복 추가하지 않음 |

**DECISION:** 얇은 모서리 절삭 직육면체 하우징 하나를 opt-in builder로 제공한다. 원본에 팩을 합치거나 기존 생성 경로의 반환값을 바꾸지 않는다. 셀·배선·커넥터·장착 브래킷·정비 접근·전기 상태는 추가하지 않는다.

## Geometry 계약 — Codex B 재사용

```js
import { buildEvBatteryPack, EV_BATTERY_ID } from '../ioniq5-asset/ev-battery.mjs';
const { parts, bounds, joints, layout } = buildEvBatteryPack();
// parts[0].id === EV_BATTERY_ID === 'ev-battery.pack'
// triangles: Float64Array, 28 triangles, CarScope world cm
// bounds: { min, max, center, size, unit:'cm', coordinateFrame }
// joints: [] ; moving: false
// metadata: parts[0].meta, including partId / inspectionTarget / bounds
```

호출마다 새로운 triangles·bounds·metadata를 반환한다. `layout`은 동결된 고정 추정 파라미터다. 좌표는 기존과 동일한 **cm, +X 전방 / +Y 차량 좌측 / +Z 위**다.

| 항목 | 값 (모두 추정, OEM 값 아님) |
|---|---|
| min / max cm | `[-115,-58,12]` / `[90,58,22]` |
| center cm | `[-12.5,0,17]` |
| size cm | `[205,116,10]` |
| 평면 모서리 chamfer | 4 cm |
| geometry / position | `ESTIMATED_GEOMETRY` |
| dimension / mounting / variant placement | `ESTIMATED` / `UNVERIFIED` / `UNVERIFIED` |

기존 모델의 바닥과 바퀴 외곽을 침범하지 않는 설명용 배치다. z=12 cm는 저작한 메시의 하단 위치이며 실차 지상고 사양이 아니다. 본체가 불투명한 일반 카메라에서는 바닥에 가려질 수 있다. 선택과 카메라 이동은 이 bounds로 구성할 수 있지만 제품 UI에는 연결하지 않았다.

`ev-battery-glb.mjs`의 `evBatteryGlb()`는 새 팩만 포함하는 GLB Buffer를 반환한다. `(x,y,z) → (x,z,-y)/100`으로 변환하고 법선에는 회전만 적용한다. GLB node extras는 CarScope cm bounds와 출처를 그대로 보존한다. **Three.js GLTFLoader는 이름의 점을 제거할 수 있으므로 `getObjectByName('ev-battery.pack')`에 의존하지 말고 `mesh.userData.partId === 'ev-battery.pack'`으로 식별한다.** Raycast hit의 userData에도 같은 ID가 있다. GLB의 Node 이름과 생성기 ID 자체는 고정 문자열을 유지한다.

## 재현

```powershell
npm ci --ignore-scripts --prefix tools/anatomy-car
npm ci --ignore-scripts --prefix tools/three-poc
$env:IONIQ5_GLB = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/ev-battery-report.mjs --glb=$env:IONIQ5_GLB --out=C:\CarScope-External\ev-battery\recheck\report
node tools/ioniq5-asset/ev-battery-preview-server.mjs --glb=$env:IONIQ5_GLB --report=C:\CarScope-External\ev-battery\recheck\report
# 별도 터미널. 기존 pinned Anatomy driver가 headless Chrome을 실행한다.
node tools/ioniq5-asset/check-ev-battery-preview.mjs C:\CarScope-External\ev-battery\recheck\browser
```

외부 GLB가 없으면 대체 파일을 만들지 않는다. 단위 테스트의 실제 GLB case는 명시적으로 skip한다. 보고서 생성에는 실제 파일이 필요하며 누락·충돌·중복 후보를 성공으로 바꾸지 않는다. 보고서/GLB/SVG/캡처 출력 디렉터리는 저장소 밖이어야 한다.

## 검증 결과

Windows 10 / Node 22.16.0 / locked Three.js 0.160.0 / Chrome headless. Anatomy `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`, 원본 clean. 원본 로그와 캡처 위치는 [증거 인덱스](evidence/p4-a2/README.md)에 있다.

| 결과 | 검증 | 실제 범위 |
|---|---|---|
| PASS | 새 Node 테스트 5/5 | bounds·ID·출처, fresh buffers, manifold·winding·volume·퇴화·자기 교차, GLB 위치/법선/metadata, 출력 경로, 실제 GLB |
| PASS | IONIQ 전체 62 pass / 1 skip / 0 fail | 기존 보닛·frunk·service·inspection 및 실제 GLB 회귀 포함 |
| NOT_RUN | 위 skip 1개 | 선택 사항인 원본 `.blend` 변환 재검증; IONIQ5_BLEND 미설정 |
| PASS | 교차 0, 전체 원본 44개와 AABB 분리 | 표면 교차 외 완전 포함도 배제. 기존 추정 부품과 frunk 0/30/60도 검사 |
| PASS | 원본과 최소 거리 약 1.058575 cm | 참조 메시 간 측정치. 실차 장착 여유·안전 기준 아님. 5 cm cutoff 밖은 null로 기록 |
| PASS | GLB Khronos errors 0 / warnings 0 | cm↔m 최대 정점 오차 0.000002385 cm 미만, 양의 부피·정상 법선 |
| PASS | 공통 triangles → SVG / GLB | 외부 sidecar만 생성, 원본 SHA 불변 |
| PASS | Chrome WebGL2 | 차량 전체·하부·반투명 배치·팩 단독 화면을 직접 검토. Raycast, 선택/해제, 강조, bounds, 원본 transform 보존; 최종 console clean |
| PASS | Anatomy audit / 기존 형상 회귀 58/58 | 원래 parts 출력 byte 불변. 기존 export/verify: 91 parts / 7,573 triangles, Khronos 0/0 |
| PASS | core JVM 37 pass / 1 skip | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`. 선택 사항 외부 시각 자산 case skip |
| NOT_RUN | 실제 SDK / Android / AVD / 실차 | 이번 모델링 범위 밖. adb 실행 없음 |
| BLOCKED | OEM 정밀 형상·장착 검증 | 팩 규격·위치·고정점 및 차량/배터리 변형별 자료 미확보 |

첫 브라우저 실행은 점이 포함된 node name 조회 때문에 준비 대기에서 실패했다. metadata 기반 탐색으로 국소 수정 후 최종 전체 브라우저 시나리오를 다시 통과했다. 기존 제품 UI에 대한 결함 또는 런타임 검증으로 해석하지 않는다. frunk 3개 각도 검사와 기존 보닛 회귀는 연속 회전 전체의 무충돌 증명이 아니다.

CI 상태는 독립 PR의 해당 HEAD checks에서 확인한다. CI는 합성 자산 테스트이며 로컬 실제 GLB·Chrome 증거와 구분한다. `tools/three-poc/inspect.js`, `inspection-flow.mjs`, Android/API·Sync·인증·서버 및 PR #41 변경 없음. Codex B 작업 사본을 수정하거나 프로세스를 조작하지 않았다.
