# P3-A2.2 · IONIQ 5 프렁크 수납함과 덮개

판정: **P3A22_ESTIMATED_FRUNK_VALIDATED**. 추정 모델의 통합·샘플 자세·브라우저 동작을 검증했다. OEM 형상·실차 힌지·VDA 용량의 검증 판정이 아니다.

기준: `feat/p3-a2-2-frunk-modeling`, main `142862ffc86d623fa8d1aaf2580180fdfcda65c2`. 시작 시 GitHub PR #17의 merged 상태와 `git ls-remote origin refs/heads/main`을 대조했다. QR-AR-01 worktree와 PR #18은 작업에 포함하지 않았다.

## 자료와 추정의 경계

| 근거 | 확인한 사실 | 모델링에 적용한 범위 / 한계 |
|---|---|---|
| [Hyundai UK 2022 사용설명서, Convenience features](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-convenience-features.pdf), p.5-48, ONE1051213 | 보닛을 연 뒤 별도 덮개를 레버로 연다. 프렁크는 모터 구획 중앙에 있다. 2WD 적재 중량은 25 kg | 중앙 수납함·별도 덮개·전방 레버를 표현했다. 레버 형상·치수·힌지 좌표는 자료에서 측정하지 않았다. 25 kg 하중 해석은 수행하지 않았다 |
| [Hyundai UK Maintenance](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf), p.9-3, ONE1091001 | 중앙 프렁크와 주변 서비스 부품의 구성 | 기존 Shell과 서비스 예약 영역을 유지했다. 그림은 실제 차량과 다를 수 있고 치수가 없다 |
| [Hyundai Motor Group, A Cozy, Comfy, Home Sweet EV](https://www.hyundaimotorgroup.com/en/story/CONT0000000000002758) | RWD 57 L / 4WD 24 L | 북미 외 2022 Long Range RWD의 57 L 목표 프로필에 적용. VDA 블록 적재나 실물 내부 치수의 근거가 아니다 |
| [Hyundai 초기 IONIQ 5 브로슈어](https://www.hyundai.com/content/dam/hyundai/wallan/en/data/marketing/brochure/product/ioniq5/NE_-52p_main_06212021_REV5.pdf), PDF p.8 | 앞 수납공간 사진 및 최대 57 L 설명 | 외형 참고 자료이며 정사영 CAD가 아니다 |
| 로컬 OpenX 변환 GLB + P3-A2.1 Shell | 모델 기준 외피·보닛 하면·예약 영역 | 실행 시 로컬 GLB로 보닛 하면을 재측정한다. 실차 측정으로 격상하지 않는다 |

새 부품의 형상·위치는 모두 `ESTIMATED_GEOMETRY`, 덮개 힌지는 `UNVERIFIED`, 각도는 `SIMULATION_ONLY`다. 모든 부품은 기존 Shell과 같은 출처·좌표·차종·가시성 메타데이터를 갖는다. 실제 고정부품·씰·래치 내부 기구는 모델링하지 않았다. 수납함이 Shell에 고정되는 구조를 검증한 것은 아니다.

## 공통 형상과 개폐

`tools/ioniq5-asset/frunk.mjs`는 저장소에 직접 작성한 치수로 결정적 형상을 만든다. 차량 좌표는 cm, +X 전방 / +Y 차량 좌측 / +Z 위다.

| 부품 | 형상 / 범위(cm) | 삼각형 |
|---|---|---|
| `frunk-tub` | 모서리를 깎은 테이퍼 통, 안팎 벽·바닥·상단 림이 연결된 닫힌 재질 메시. 외곽 x 129.8–192.2, y ±24.2, z 55.69–84 | 60 |
| `frunk-cover` | 두께 2, 모서리 챔퍼가 있는 별도 덮개. x 129–193, y ±25, z 85.5–87.5 | 28 |
| `frunk-lever` | 덮개 전방의 간단한 추정 레버. x 186–190, y ±5, z 87.5–88.7 | 12 |

수납공간 상단은 60×46 cm, 하단은 46×36 cm, 코너 챔퍼는 3 cm다. 테이퍼 단면의 면적 적분으로 깊이 26.3077 cm를 정했고, 닫힌 cavity 메시의 부호 있는 부피로 **57.000 L**를 독립 확인했다. 이는 57 L 목표에 맞춘 수학적 내부 부피다. 실차 수납 용량이 정확히 재현됐다는 뜻은 아니다. 새 부품의 닫힌 형상은 모두 `zone-frunk` 안에 들어간다. 서비스 예약 영역을 침범하지 않는다.

덮개는 추정 축 `(129, 0, 85.5)`, 방향 `(0, -1, 0)`으로 0–60° 회전한다. 레버도 같은 강체 조립체 아래에서 움직인다. Shell·수납함·원본 차체는 회전하지 않는다.

PoC에는 표시/숨김, 각도 슬라이더, 열기/닫기 애니메이션, raycast 선택·강조·출처 표시가 있다. 캔버스의 덮개/레버 클릭으로도 개폐한다. 원본 차체와 Shell이 클릭을 가리므로 닫힌 보닛을 통과해 덮개를 클릭하지 않는다.

공통 `frunkTransition`은 보닛 45° 미만에서 덮개 열기, 덮개가 열린 상태에서 보닛을 45° 미만으로 내리기를 거부한다. 축 A/C만 덮개 개방을 허용한다. 버튼·슬라이더·애니메이션·자동화가 같은 제약을 사용한다. 이것은 검사한 자세를 사용하는 **PoC 순서 제약**이며 실차의 전자식 인터록이나 제조사 권장 각도가 아니다. 원래 보닛 축 B의 간섭 문제는 P3-A1 기록대로 남아 있다.

## 검증 결과

2026-10-31 UTC / Windows, Node v22.16.0. 브라우저는 Chrome headless, ANGLE D3D11 / NVIDIA GTX 1060 6GB다. 새 실행 결과만 아래에 기재했다.

| Gate | 상태 | 명령 / 관측 | 결과 |
|---|---|---|---|
| 프렁크 정적 통합 | PASS | `frunk-report.mjs`, 모든 원본 메시(보닛 별도)와 Shell 전체에 정확 삼각형 검사 | 결함 0. 통↔덮개 최소 1.5 cm. 레버↔덮개 10쌍은 미리 선언한 접합면 위 접촉 |
| 보닛 스윕 | PASS | A/C 각각 0–60°, 1°, 덮개 닫힘 | 프렁크와 새 교차 0 |
| 덮개/보닛 허용 격자 | PASS | A/C × 보닛 45–60°(1°) × 덮개 0–60°(1°), 덮개와 레버 각각 검사 | 새 교차 0. 고정 원본·Shell·통과도 덮개 0–60° 전체를 검사. 총 4,148개 검사 행 |
| 메시·강체성 | PASS | `test/frunk.test.mjs` | 퇴화 0, 부품별 모든 edge에 정확히 반대 방향 face 2개, 양의 부피, 강체 거리 보존, 0° 복원 |
| SVG 회귀 | PASS | `frunk-report.mjs` | 닫힌 원본과 Shell/프렁크 포함 SVG 바이트 동일(156,363 B). 열린 덮개 0/30/60°에서 부품 ID 표시, 재생성 결정성 |
| GLB | PASS | `frunk-glb.mjs` + Khronos validator + 독립 `glbParts` 역변환 | 0°/60° sidecar 각각 오류/경고 0/0. 좌표·강체 계층 round trip 최대 오차 0.0000105 cm |
| 브라우저 | PASS | `check-ioniq5-frunk.mjs` | A/C × 보닛 45/60° × 덮개 0/15/30/45/60° = 20자세. Node/브라우저 정점 차이 ≤0.0000058 cm. 제약 거부·실제 캔버스 클릭·애니메이션·복원·선택 확인. console clean, 캡처 8장, SVG 3장 decode 성공 |
| 기존 Shell 회귀 | PASS | `front-compartment-report.mjs`, quick 아님 | 차체/Shell 간 결함 0, 닫힌 보닛 교차 0, A/C 스윕 새 교차 0, 노출 광선의 바닥/실내 노출 0, SVG 결정성/닫힌 동일성 유지 |
| IONIQ 자산 테스트 | PASS | `node --test tools/ioniq5-asset/test/*.test.mjs`, `IONIQ5_GLB`와 `IONIQ5_BLEND` 설정 | 47/47, SKIP 0 |
| Anatomy audit | PASS | `npm run build` in `tools/anatomy-car` | pin `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`, audit passed. 기본 parts SHA `a6f19a53…` 유지 |
| 기존 메시/GLB·좌표·도어 충돌 회귀 | PASS | 같은 폴더에서 `npm run export`, `npm run verify`, `npm test` | Geometry PASS, Khronos 0/0, 58/58 |
| core 정적 SVG | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | 33/33, 실패/오류 0 |
| AVD·실차·실제 힌지·구조 하중·성능 비교 | NOT_RUN | 이번 범위는 데스크톱 debug PoC | Android 통합·제품 release 포함·배포 승인을 의미하지 않음 |

초기 환경 실패도 구분한다. 첫 전체 테스트는 의존성 `gltf-validator` 미설치와 샌드박스 계정의 Anatomy Git 소유권 제한 때문에 FAIL이었다. 저장소의 고정 의존성을 설치하고 사용자 환경에서 재실행했다. pin 변경·원본 수정·`--any-anatomy` 우회는 하지 않았다. 최종 결과가 위 PASS다.

첫 프렁크 보고서는 레버 접합을 2건의 결함으로 분류해 FAIL이었다. 기존 `crossingPoint`가 공면 접촉에서 큰 삼각형의 중심을 반환해 접합면 밖의 점을 보고했다. 두 삼각형에 실제로 속하는 꼭짓점/edge 교차점을 반환하도록 수정했고, 포함·edge 교차 회귀 테스트와 기존 Shell 전체 검사를 통과했다. 충돌 대상 제외나 임계값 상향은 없다.

1° 격자 검사는 연속 회전 전체의 완전한 무충돌 증명이 아니다. 보고서 `rows.minCm=null`은 cutoff 5 cm 이상이라는 뜻이며 전역 최소 거리를 측정했다는 뜻이 아니다. 45° 제약은 이 추정 모델에서 선택한 실험 범위다.

## 재실행과 로컬 증거

루트에서 실행한다. 출력은 저장소 밖만 허용한다.

```powershell
$env:IONIQ5_GLB = 'C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
$env:IONIQ5_BLEND = 'C:/CarScope-External/openx-assets/src/vehicles/hyundai_ioniq_5_2022/hyundai_ioniq_5_2022.blend'
node --test tools/ioniq5-asset/test/*.test.mjs
node tools/ioniq5-asset/frunk-report.mjs --glb=C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb --axes=C:/CarScope-External/p3-a1/report/hood-feasibility.json --out=C:/CarScope-External/p3-a2-2/report
node tools/ioniq5-asset/front-compartment-report.mjs --glb=C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb --out=C:/CarScope-External/p3-a2-2/shell-regression
```

`--axes`는 같은 GLB SHA의 기존 P3-A1 보고서다. 축 A는 원본 GLB 계층에서 다시 구하고 C는 해당 보고서의 탐색 결과를 쓴다. 새 환경에서는 [P3-A1 재실행](p3-a1-hood-hinge-feasibility.md)으로 그 보고서를 먼저 생성한다.

```powershell
$env:PORT = '8096'
$env:CARSCOPE_IONIQ5_GLB = $env:IONIQ5_GLB
$env:CARSCOPE_P3A1_DIR = 'C:/CarScope-External/p3-a1/report'
$env:CARSCOPE_P3A22_DIR = 'C:/CarScope-External/p3-a2-2/report'
node tools/three-poc/serve.mjs
# 별도 터미널:
node tools/three-poc/check-ioniq5-frunk.mjs C:/CarScope-External/p3-a2-2/browser
```

브라우저: `http://127.0.0.1:8096/ioniq5-hood.html`. 프렁크 표시 → 보닛 A 또는 C 45° 이상 → 덮개 열기. `npm install`은 `tools/three-poc`와 `tools/anatomy-car` 각각에서 필요하다. 브라우저 드라이버도 기존 `ANATOMY_HOME/scripts/drive.mjs`를 사용한다.

외부 결과 루트 `C:\CarScope-External\p3-a2-2\`의 증거 인덱스:

| 파일/폴더 | 용도 |
|---|---|
| `report/frunk-report.json` | 입력 SHA, 출처, 치수 통계, 정확 검사 행, GLB 검사, SVG SHA |
| `report/shell-frunk-0.glb`, `report/shell-frunk-60.glb` | 같은 공통 형상의 Shell/프렁크 sidecar. 원본 GLB와 같은 좌표로 배치. 원본 차체 미포함 |
| `report/svg/*.svg` | 닫힘 회귀와 열린 단계 프레임 6장 |
| `browser/browser-results.json`, `browser/browser-log.txt`, `browser/actions.json` | 실제 브라우저 자세 대조·UI 제약·클릭·SVG decode |
| `browser/01-closed.png` … `08-restored.png` | 닫힘/덮개 0·30·60°/top/side/C축/복원 캡처 |
| `shell-regression/front-compartment.json`, `shell-regression/svg/` | 기존 P3-A2.1 전체 재실행 |
| `asset-tests.txt` | 최종 실제 자산 테스트 TAP 로그 |

Git에는 생성기·작은 추정 치수·테스트·이 문서만 추가한다. 모델 파생 고밀도 표면 데이터·GLB·SVG·캡처·로그는 커밋하지 않는다. 기존 원본 GLB·Android 앱·Pleos 계약·기본 프로필은 그대로다. 자동 병합하지 않는다.
