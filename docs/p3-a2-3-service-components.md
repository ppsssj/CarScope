# P3-A2.3 · 전방 구획 점검 부품

판정: **WASHER_INSPECTION_POC_VALIDATED**. 워셔액 주입구 몸체와 독립 캡을 추정 모델로 구현했다. 나머지 5종은 조사 결과를 가진 예약 영역이다. 실제 차량의 정확한 부품 형상·위치를 검증했다는 뜻은 아니다.

시작 기준은 PR #19 병합 main `d5df08809a97d1c6234e4695b5446293dc34c1c9`다. GitHub의 merged 상태와 원격 main을 확인한 뒤 `feat/p3-a2-3-service-components`를 생성했다. PR #18과 QR-AR worktree/code는 작업에 포함하지 않았다.

## 공식 자료와 정확도

[Hyundai UK IONIQ 5 2022 Maintenance](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf)의 p.9-3 `ONE1091001`과 각 점검 절을 직접 확인했다. 로컬 PDF SHA-256은 `313dda4e0545c3a4240181ad6ac384cfa84df3ced19d273f6a792e9e02be1398`이다. 배치도와 워셔액 그림은 PNG로 렌더해 검토했다.

| 부품 / 그림 번호 | CONFIRMED: 2022 UK 자료에서 확인 | 그림에서 관찰한 방향(차량 앞을 바라보는 독자 기준) | 이번 표현 |
|---|---|---|---|
| 워셔액 / 4 | 리저버와 수위 점검·주입 위치, p.9-14 `ONE1091005` | 그림 왼쪽 바깥·뒤쪽, 냉각수 부품의 바깥쪽 | 주입구 몸체 + 독립 캡, ESTIMATED |
| 냉각수 / 1 | 일반 냉각수 리저버, p.9-12 `ONE1091002` | 그림 왼쪽 중간·안쪽 | 예약 영역, 형상 UNVERIFIED |
| LCW / 2 | 저전도 냉각수 리저버, p.9-12 `ONE1091003` | 그림 왼쪽 앞·안쪽 | 예약 영역, 형상 UNVERIFIED |
| 브레이크액 / 3 | 리저버와 MIN/MAX 점검, p.9-13 `ONE1091004` | 그림 오른쪽 뒤·안쪽 | 예약 영역, 형상 UNVERIFIED |
| 12V 배터리 / 8 | 12V 배터리, p.9-19 | 그림 오른쪽 앞·안쪽 | 예약 영역, 형상 UNVERIFIED |
| 퓨즈박스 / 5 | 모터 구획 퓨즈 패널, p.9-32 `ONE1091034/35` | 그림 오른쪽 중간·바깥쪽 | 예약 영역, 형상 UNVERIFIED |

CONFIRMED는 **해당 설명서에서의 존재와 그림 관찰**을 뜻한다. 설명서는 실제 구획이 그림과 다를 수 있다고 명시한다. 정확한 Long Range RWD의 시장·핸들 위치별 좌우 일치, 부품 번호·치수·고정점은 **UNVERIFIED**다. 그림 왼쪽을 차량 우측(-Y)으로 해석한 배치는 앞에서 보는 그림이라는 해석에 근거한 **ESTIMATED** 배치이며 OEM 확인 좌표가 아니다. 다른 시장 그림을 섞어 확정하지 않았다.

추가 확인을 시도한 [Canada 2022 Maintenance 링크](https://www.hyundaicanada.com/-/media/hyundai/feature/ownerssection/manuals/english/2022/ioniq-5/009_maintenance_ioniq5_ne_eng.pdf)는 404였다. 검색 결과의 요약을 실제 열람 자료처럼 사용하지 않았다. 2025/2026 구성이나 일반 IONIQ(AE)의 부품을 NE 2022에 적용하지 않았다.

`service-components.mjs`의 `SERVICE_EVIDENCE`는 6종의 출처·그림 번호·관찰 방향을 갖는다. 부품 메타데이터는 기존 Shell 형식을 재사용한다.

- `existenceConfidence: CONFIRMED` + `evidenceContext`로 자료 범위를 제한한다.
- 실제로 만든 몸체/캡: `geometryConfidence: ESTIMATED_GEOMETRY`, `shapeConfidence: ESTIMATED`.
- 예약 형상: `SYNTHETIC_DEBUG_PLACEHOLDER`, `shapeConfidence: UNVERIFIED`, `representation: RESERVATION_ONLY`.
- 위치/치수: `ESTIMATED_GEOMETRY`, 대상 시장/좌우 일치: `UNVERIFIED`.

## 단계별 구현과 표시

워셔액 우선 단계의 몸체·캡 생성, 실제 GLB 통합 검사, Node/브라우저 선택 검증을 수행했다. 나머지 다섯 부품은 상세 형상 근거가 부족하므로 확정된 리저버·배터리처럼 만들지 않았다. 출처가 있는 이름과 명시적인 예약 박스만 추가했고, 기본 화면과 일반 GLB 출력에서는 숨긴다. 별도 체크박스로 황색 wireframe 예약 영역을 볼 수 있으며 선택 시 미구현 상태를 표시한다.

| ID | 형상 / 차량 cm 경계 | tri |
|---|---|---|
| `washer-fluid-filler` | 얇은 벽을 가진 원통형 목과 벌어진 림. x 125.9–134.1, y −52.1–−43.9, z 72–87.5 | 288 |
| `washer-fluid-cap` | 둥근 층형 캡. x 125.2–134.8, y −52.8–−43.2, z 87.8–90.1 | 188 |

몸체와 캡의 재질 메시 각각은 닫혀 있고 바깥 방향이다. 몸체의 내부 통로는 비어 있다. 캡은 몸체와 독립된 Geometry이며 분리 동작은 구현하지 않았다. 숨겨진 전체 워셔 탱크·펌프·배관·실제 장착 브래킷·캡 테더·씰은 미구현이다. 색상도 스타일 값이며 실제 캡 색을 확인했다는 뜻은 아니다.

모든 값은 직접 작성한 낮은 복잡도의 추정 파라미터다. 로컬 GLB에서 보닛 하면을 실행 시 측정해 만든 기존 서비스 영역 안에 배치한다. 원본 GLB나 고밀도 표면 데이터를 코드로 복사하지 않는다. SVG와 GLB, 브라우저가 같은 `buildServiceComponents` 출력을 사용한다.

`워셔액 점검 위치 보기`는 Shell·프렁크·워셔액을 표시하고 A축 보닛을 60°(SIMULATION_ONLY)로 연 뒤 가까운 시점을 잡는다. 기존 BAY/ISO 시점의 카메라는 유지했다. 새 카메라는 원본 좌표계·DoorId·세계 y를 변경하지 않는다.

캡 또는 몸체를 실제 raycast나 목록으로 선택하면 강조와 부품명·점검 대상·출처가 표시된다. 보닛과 차체는 선택을 가리므로 닫힌 보닛 너머로 선택되지 않는다. 안정적인 `washer-fluid-cap` ID를 Node/SVG/GLB/브라우저에서 유지했지만 QR-AR와 연결하지 않았다.

점검 안내는 p.9-14를 근거로 수위 확인, 해당 차량·기후에 맞는 워셔액 사용, 냉각계용 냉각수·부동액을 넣지 말라는 내용이다. 실제 액량·센서·차량 상태를 읽는 화면이 아니며 추정 모델 안내를 함께 표시한다.

## 검증

환경: Windows, Node v22.16.0, Chrome headless / ANGLE D3D11 / NVIDIA GTX 1060 6GB. 기존 산출물을 그대로 PASS로 인용하지 않고 아래 명령을 새로 실행했다.

| Gate | 상태 | 새 실행 결과 |
|---|---|---|
| 서비스 메시 | PASS | 몸체/캡 퇴화 0, 각 edge에 반대 방향 face 2개, 양의 재질 부피, 결정성. cap/body 사이 0.300 cm |
| 원본·Shell·닫힌 프렁크 | PASS | 각 실제 부품과 예약 5종을 각각 전체 메시와 정확 삼각형 검사. 교차 0. 몸체↔Shell 5.124 cm, 캡↔Shell 3.970 cm. 워셔액↔원본/프렁크는 cutoff 10 cm 이상 |
| 보닛과 서비스 | PASS | A/C × 0–60°, 1° 간격. 전체 서비스 형상과 교차 0. 예약 영역 포함 최소 8.214 cm |
| 프렁크와 서비스 | PASS | 덮개·레버 각각 0–60°, 1° 간격. 전체 서비스 형상과 교차 0, cutoff 10 cm 이상 |
| 서비스 전체 보고서 | PASS | 정적 비교·서비스끼리·보닛·프렁크를 합쳐 286행. 접합 제외나 임계값 상향 없음 |
| P3-A2.2 회귀 | PASS | `frunk-report.mjs` 4,148행, 결함 0, 기존 SVG 결정성·닫힌 동일성·강체성 유지 |
| SVG | PASS | 서비스 포함 닫힌 출력이 순수 원본 및 Shell/프렁크 기준 출력과 바이트 동일(156,363 B). 열린 45/60°에서 두 서비스 ID 표시. 재생성 결정성 |
| GLB | PASS | 기존 exporter에 선택적 고정 부품 입력을 추가. 0/60° sidecar 모두 Khronos 오류/경고 0/0. 독립 역변환 좌표 오차 ≤0.0000105 cm. 기본 호출의 형상/계층은 유지 |
| 서비스 브라우저 | PASS | 실제 CDP 클릭, 강조·부품명·안내·예약 메타데이터·보닛 occlusion 확인. 서비스 정점 Node 차이 ≤0.0000059 cm. A/C 10개 보닛 자세 회귀, console clean, 캡처 6장, SVG decode 3장 |
| 프렁크 브라우저 | PASS | 기존 `check-ioniq5-frunk.mjs`를 같은 페이지에서 재실행. 20자세·개폐 제약·캔버스 클릭·강체 대조 PASS, 캡처 8장 |
| 전체 IONIQ 자산 테스트 | PASS | 실제 GLB와 blend를 설정한 `node --test tools/ioniq5-asset/test/*.test.mjs`: 52/52, SKIP 0. 최종 메타데이터 수정 후 서비스 5/5 재검증 |
| Anatomy / 기존 Geometry | PASS | `tools/anatomy-car`에서 `npm run build`, `npm run export`, `npm run verify`, `npm test`: audit PASS, Geometry PASS, Khronos 0/0, 58/58. pin `1482e8469b0a9e0d8cc18ea2740a01423d29ae80` 유지 |
| core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`: 33개, 실패/오류 0 |
| AVD·실차·OEM 실측·장착/유체/정비 절차 전체·Android/Pleos/Release | NOT_RUN | 이번 범위는 데스크톱 debug PoC와 외부 산출물 |

거리의 `minCm=null`은 `distanceBoundCm` 이상이라는 뜻이며 전역 최소값을 계산한 것으로 읽지 않는다. 1° 표본 검사는 연속 회전 전체의 무충돌 증명이 아니다. 검사 각도는 실제 힌지·실차 최대 개방 각도와 무관한 SIMULATION_ONLY다.

초기 브라우저 자동화는 합성 PointerEvent가 OrbitControls의 실제 pointer capture 조건을 만족하지 않아 console 오류로 FAIL이었다. 실제 CDP 마우스 입력으로 수정한 뒤 PASS했다. 초기 로그는 외부 `browser-initial-log.txt`에 보존했다. 새 근접 시점 캡처에서 기존 애니메이션이 첫 rAF 시각과 시작 시각의 순서 때문에 음수 진행률을 잠깐 보낼 수 있음을 발견했다. 보닛/덮개 진행률을 0–1로 제한하고 기존 개폐 회귀를 재실행했다. 각도·충돌 임계값은 변경하지 않았다.

## 성능

같은 페이지·BAY 카메라·1600×1100 / DPR 1·Shell/프렁크 표시 상태에서 워셔액 두 메시 숨김/표시를 비교했다. 각 경우 1회 워밍업 후 보닛 0↔45°를 2회 왕복했다. 이 최종 측정 중 다른 자동 브라우저 검사를 병렬 실행하지 않았다. `browser/browser-results.json`의 `services:false/true` 행:

| 측정 | 숨김 | 표시 |
|---|---|---|
| draw calls / triangles | 90 / 20,028 | 92 / 20,504 |
| frame p50 / p95 / max (ms) | 16.7 / 16.8 / 38.7 | 16.7 / 16.8 / 16.9 |
| render CPU p50 / p95 (ms) | 1.0 / 1.4 | 1.0 / 1.3 |
| GPU p50 / p95 (ms) | 3.19 / 4.48 | 3.27 / 4.55 |

워밍업 로그에는 최대 1,154 ms의 긴 frame interval도 남아 있다. 위 표는 워밍업 이후 측정 행이며 cold start나 장시간 안정성 PASS로 해석하지 않는다. 전체 로그를 보존했다.

추가 기하량은 **2 draw calls / 476 triangles**다. 60 Hz의 frame p50 상한을 처리량 증명으로 해석하지 않으며, 데스크톱 CPU/GPU 측정은 AVD·실차 성능이 아니다. 단일 숨김→표시 순서의 짧은 비교이므로 미세한 차이의 인과나 장시간 안정성을 주장하지 않는다.

## 재실행과 외부 증거 인덱스

외부 루트는 `C:\CarScope-External\p3-a2-3\`다. `ANATOMY_HOME`은 기존의 깨끗한 pinned checkout을 사용하고 `npm install`은 `tools/anatomy-car`와 `tools/three-poc`에서 각각 실행한다.

```powershell
$env:IONIQ5_GLB = 'C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:IONIQ5_BLEND = 'C:/CarScope-External/openx-assets/src/vehicles/hyundai_ioniq_5_2022/hyundai_ioniq_5_2022.blend'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/service-components-report.mjs --glb=C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a2-3/report
node tools/ioniq5-asset/frunk-report.mjs --glb=C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a2-3/frunk-regression
```

축 C는 같은 SHA의 입력에 대해 생성한 P3-A1 보고서를 사용한다. 축 A는 현재 GLB 계층에서 다시 읽는다. 새 환경에서는 [P3-A1 재실행](p3-a1-hood-hinge-feasibility.md)으로 보고서를 먼저 생성한다.

```powershell
$env:PORT = '8097'
$env:CARSCOPE_IONIQ5_GLB = $env:IONIQ5_GLB
$env:CARSCOPE_P3A1_DIR = 'C:/CarScope-External/p3-a1/report'
$env:CARSCOPE_P3A22_DIR = 'C:/CarScope-External/p3-a2-3/frunk-regression'
$env:CARSCOPE_P3A23_DIR = 'C:/CarScope-External/p3-a2-3/report'
node tools/three-poc/serve.mjs
# 별도 터미널에서 순차 실행:
node tools/three-poc/check-ioniq5-services.mjs C:/CarScope-External/p3-a2-3/browser
node tools/three-poc/check-ioniq5-frunk.mjs C:/CarScope-External/p3-a2-3/browser-frunk http://127.0.0.1:8097/ioniq5-hood.html
```

| 외부 파일 | 근거 |
|---|---|
| `sources/ioniq-5-2022-maintenance.pdf`, `sources/page-3.png`, `sources/page-9.png` 등 | 공식 원문·배치도·워셔액 그림 검토. 원문은 Git 제외 |
| `report/service-components.json` | 출처·신뢰도·통계·286행의 정확 교차/간격 검사·SVG/GLB SHA |
| `report/shell-frunk-services-{0,60}.glb` | Shell/프렁크/실제 구현 워셔액 sidecar, 원본 차량 미포함. 예약 박스 제외 |
| `report/svg/*.svg` | 닫힘/열린 단계/예약 디버그 5장 |
| `browser/01-washer-cap-selected.png` | 캡 실제 선택·강조·점검 안내 |
| `browser/02-washer-filler.png`, `03-service-layout.png`, `04-frunk-open.png`, `05-reservations.png`, `06-closed-regression.png` | 몸체·전체 배치·프렁크 동작·예약 영역·닫힘 |
| `browser/browser-results.json`, `browser/browser-log.txt`, `browser/actions.json` | 서비스/보닛 대조·UI·SVG decode·CPU/GPU/frame 측정 |
| `frunk-regression/`, `browser-frunk/` | 기존 프렁크 Node/브라우저 재실행 |
| `asset-tests.txt`, `core-tests.txt` | 실제 자산 전체 테스트와 core 실행 로그 |

저장소에는 생성기·추정 파라미터·검증 코드·문서만 넣는다. 외부 원본 GLB·SVG·GLB 파생물·캡처·로그·고밀도 모델 파생 측정 배열은 넣지 않는다. Android/Pleos/Release·QR-AR 연결·PR #18은 변경하지 않는다. 독립 PR로 검토하며 자동 병합하지 않는다.
