# P3-A2.1 · IONIQ 5 전방 구획 Shell 모델링

판정: **P3A21_SHELL_VALIDATED**.

검증한 것:
- 새 Shell(패널 9개, 1,330 tri)이 정상적으로 구성된다. 퇴화 삼각형 0, 법선 방향 일관.
- 기존 차체·보닛과의 통합을 정확한 삼각형 검사로 확인했다.
  - 차체 결함 교차 0, 패널 간 결함 교차 0, 닫힌 보닛 교차 0.
  - 보닛 축 A·C로 0–60°를 1° 간격으로 돌려도 Shell과 새 교차 0.
- 보닛을 열었을 때 바닥판과 실내가 보이지 않는다(광선 측정과 캡처).

이 판정의 범위:
- **OEM 차체 형상이나 치수가 정확하다는 뜻이 아니다.** 새 패널은 모두 `ESTIMATED_GEOMETRY`다. 실내 경계 두 개(벌크헤드, 카울 커버)는 `ESTIMATED_BOUNDARY`다.
- 보닛 각도는 모두 `SIMULATION_ONLY`다. 힌지 좌표와 실제 최대 개방 각도는 P3-A1과 같이 UNVERIFIED다.

기준: main `e394bdc`(PR #16 병합), Anatomy pin `1482e84`. 홈 PC(i5-4690, GTX 1060, Windows 10), 2026-10-31.
- 입력 GLB: `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb` (SHA-256 `cfe0d754…`). 수정하지 않았다.
- 파생 출력: `C:\CarScope-External\p3-a2-1\`.

## 1. 목표와 기존 모델의 문제

P3-A1에서 보닛을 열면 빈 외피가 보였다. 같은 측정을 Shell 적용 전후로 했다(보닛 제외, 열린 상태 시야).

| 측정 (광선 수) | 기존 모델 | Shell 적용 |
|---|---|---|
| 위에서 수직 아래 (483) | 하부 바닥판 388, 휠하우스 등 Body 71, 램프 하우징 24 | **Shell 388**, Body 71, 램프 24. 바닥판 0 |
| 구획 중앙에서 뒤쪽 (391) | **실내 270**, 스티어링 휠 6, Body 115 | **Shell 391**. 실내 0 |
| BAY 시점 사선 (420) | 바닥판 302, Body 114, 램프 4 | **Shell 356**, Body 60, 램프 4. 바닥판 0 |

추가로 남아 있던 문제:
- 헤드램프 하우징 뒷면이 구획 앞쪽 모서리로 들어와 있다. 원본 메시이며 실차에도 있는 부품이므로 그대로 두었다.
- 실내와 구획 사이에 격벽이 없었다. 벌크헤드로 막았다.

## 2. 실제 차량 참고 자료와 출처

| # | 출처 | 확인한 내용 | 한계 |
|---|---|---|---|
| S1 | [Hyundai UK IONIQ 5 2022 사용설명서, Maintenance](https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf) p.9-3 그림 ONE1091001 "Motor compartment" | 중앙에 큰 프렁크 덮개(7)와 공조 필터(6). 한쪽에 냉각수(1)·LCW 냉각수(2)·워셔액(4), 다른 쪽에 브레이크액(3)·퓨즈박스(5)·12V 배터리(8). 뒤 모서리에 둥근 스트럿 타워 상단, 뒤쪽 카울 띠, 앞쪽 래치가 있는 평평한 상부 지지대, 좌우 어두운 측면 커버 | 문서 스스로 "실제 모터 구획은 그림과 다를 수 있다"고 적고 있다. 치수 없음. 그림의 좌우 배치가 어느 시장·핸들 위치 기준인지 표시 없음 |
| S2 | 같은 문서 "Cabin air filter" | 공조 필터는 프렁크 덮개를 열고 그 아래에서 교체한다 | 위치 치수 없음 |
| S3 | Convenience features p.5-48, Hyundai 뉴스룸 | 프렁크는 보닛 아래 별도 덮개. 2WD(북미 외) 57 L, AWD/북미 24 L | 프렁크 통 형상·고정점 없음 |
| S4 | 변환 GLB 측정 | 아래 5절의 모델 기준값(단일 경계값). 보닛 하면 높이는 실행 시 측정(5a절) | 커뮤니티 모델 값이며 실차 값이 아님 |

시도했지만 얻지 못한 것:
- 요청서의 Hyundai Canada 정비 PDF 링크는 HTTP 404였다. 같은 Maintenance 장을 Hyundai UK 판으로 대신 확인했다.
- 정품 부품 카탈로그 도면과 공식 프렁크 사진은 이번에 확보하지 못했다.
- 사진이나 그림만으로 부품 위치를 확정하지 않았다. 서비스 부품의 좌우 배정은 UNVERIFIED다.

## 3. 새 Shell의 구조

```text
FrontCompartment (tools/ioniq5-asset/front-compartment.mjs, layout: front-compartment-layout.mjs)
├── RearBoundary       fc-rear-bulkhead, fc-cowl-cover              ESTIMATED_BOUNDARY
├── Aprons             fc-apron-left/right, fc-strut-tower-left/right
├── LowerLiner         fc-lower-liner (중앙 웰 + 좌우 선반)
├── FrontUpperSupport  fc-front-upper-support (래치 보스), fc-front-shroud
└── ReservedZones      zone-frunk, zone-service-left/right           SYNTHETIC_DEBUG_PLACEHOLDER
```

각 부품에 저장하는 메타데이터:
- `id`, `name`, `geometryConfidence`, `positionConfidence`, `source`
- `vehicleVariant`, `coordinateFrame`, `isSynthetic`, `visibility`, `futureInteraction`
- 경계 패널은 `boundary`도 저장한다.

구성 원칙:
- 모든 Geometry는 레이아웃 상수에서 결정적으로 생성되고 브라우저와 Node가 같은 모듈을 쓴다.
- Shell은 GLB에서 형상을 복사하지 않고 원본 메시를 수정하지 않는다.
- 저장소에는 생성 코드와 측정 상수만 있다.

## 4. 각 패널의 Geometry 생성 근거

| 패널 | 형상 | 근거 / 가정 |
|---|---|---|
| `fc-rear-bulkhead` | x 108 → 106.2 기울어진 면, z 26–95.5. 수평 비드 2줄(z 50, 66, 깊이 1.2). z 74 위로 폭 \|y\| 57 → 74 | 실내 대시보드 앞면(x 104)을 가리는 시각적 경계. 실제 방화벽 형상이 아니다 |
| `fc-cowl-cover` | x 106.2–122.6, z 95.5, \|y\| ≤ 66, 앞 립 z 92.5 | S1의 뒤쪽 어두운 띠. Body 카울(z ≥ 98.2)과 보닛 뒤 플랜지(z 98.2–98.4) 아래 |
| `fc-apron-left/right` | \|y\| 57 수직벽(z 66–86) → 꺾임(\|y\| 60, z 89) → 바깥 플랜지(\|y\| 72). 플랜지 높이는 보닛 하면 −3 cm(최대 97). x 107–183 | 휠하우스 벽(\|y\| 58–63.8) 위 빈 공간을 막음. 좌우 대칭은 가정이다(실차는 좌우 탑재 부품이 다름) |
| `fc-strut-tower-left/right` | x 145.86(모델 앞차축), \|y\| 63, 반지름 6, z 85–93 원통 + 캡 | S1의 둥근 타워 상단. 크기와 횡위치는 추정 |
| `fc-lower-liner` | x 108.6–213.4. 중앙 웰 z 46–47(\|y\| ≤ 28), 경사, 좌우 선반 z 52–52.6, 앞뒤 립 z 56 | 바닥판 노출을 막는 얇은 판. 모델에 없는 구동 유닛 위의 예약 공간 하한이다. 실제 부품 형상이 아니다 |
| `fc-front-upper-support` | 모자 단면 크로스멤버 x 198–214, 상면 z 82.5, \|y\| ≤ 42, 래치 보스 6×8×1.6 | S1의 앞쪽 지지대와 래치 위치. 래치 기구는 만들지 않았다 |
| `fc-front-shroud` | x 214 수직판, z 49–71, \|y\| ≤ 56.5 | 범퍼 내부가 보이지 않게 막는 판. 램프 하우징 아래, 방향지시등(z ≤ 45) 위 |

## 5. 모델 기준 좌표·크기 (CarScope cm)

| 기준값 (변환 GLB 측정, 모델 기준 VERIFIED) | 값 |
|---|---|
| 하부 바닥판 | z 23.0 |
| 실내 대시보드 앞면 | x 104.0 (z 74–94) |
| Body 카울 띠 최저점 | z 98.2 (x 97–122.7, \|y\| ≤ 69.4) |
| 휠하우스 안쪽 벽 | \|y\| 58–63.8, x 101.5–189.6, z 24.9–81.9 |
| 앞바퀴 상단 / 앞차축 | z 75.1 / x 145.86 |
| 구획 안 램프 하우징 | x 184.8–212.4, \|y\| 43–63.2, z 71.8–84.0 |
| 보닛 하면 | **저장소에 없음.** 샘플 격자(x 110–225 5 cm 간격, \|y\| 10행)만 저장하고, 높이는 실행 시 로컬 GLB의 보닛 메시에서 측정(`measureHoodSurface`, 5a절) |

| 패널 | tri | 면적 cm² | 경계 min → max |
|---|---|---|---|
| fc-rear-bulkhead | 476 | 8,811 | (105.7, −74, 26) → (108, 74, 95.5) |
| fc-cowl-cover | 84 | 2,489 | (106.2, −66, 92.5) → (122.6, 66, 95.5) |
| fc-apron-left / right | 64 / 64 | 2,937 / 2,937 | (107, ±57, 66) → (183, ±72, 97) |
| fc-strut-tower-left / right | 120 / 120 | 388 / 388 | (139.9, ±57, 85) → (151.9, ±69, 93) |
| fc-lower-liner | 264 | 13,189 | (108.6, −56.5, 46) → (213.4, 56.5, 56) |
| fc-front-upper-support | 90 | 2,884 | (198, −42, 71) → (214, 42, 84.1) |
| fc-front-shroud | 48 | 2,472 | (214, −56.5, 49) → (214, 56.5, 71) |

## 5a. 모델 파생 데이터 정책 (PR #17 수정)

처음 커밋에는 `MODEL_REFERENCES.hoodUnderside`가 있었다. OpenX 보닛 메시에서 5 cm 격자로 뽑은 높이 240개다.
- 이는 모델 표면을 표본화한 **모델 파생 Geometry 데이터**다.
- P2-A6 커밋 정책(저장소에는 도구, 정점 데이터 없는 측정 JSON, 저작자 표시 렌더 3장만)과 맞지 않는다. 라이선스 승인 전이라 배포 허용 여부도 명확하지 않다.

수정:
- 표를 제거하고 샘플 격자(`HOOD_SAMPLE_GRID`, 우리의 표본화 계획)만 남겼다.
- `measureHoodSurface(hood triangles)`가 실행 시 보닛 메시에서 같은 격자의 최저 하면을 측정한다. 이제 +y와 −y 중 낮은 쪽을 쓴다.
  - Node 보고서는 로컬 GLB에서 측정한다.
  - 브라우저 PoC는 로드한 GLB에서 측정한다.
  - 측정값은 저장소 밖 보고서 JSON(`hoodSurface`)에만 남는다.
- `buildFrontCompartment`는 측정한 하면이 없으면 실행을 거부한다.
- CI는 합성 보닛 판(fixture)에서 측정한 하면으로 검증한다. 실제 모델 기준 테스트는 `IONIQ5_GLB`가 없으면 SKIP이다.
- 남은 `MODEL_REFERENCES` 값은 바닥 z, 대시보드 x, 카울 최저 z, 바퀴 상단, 램프 하우징 경계 등 단일 경계값이다. P2-A6/P3-A1 문서에 이미 있는 경계 상자와 같은 종류다. 테스트가 배열 길이 ≤ 3을 강제한다.

기존 측정값과의 비교. 같은 GLB와 같은 PC에서, 이전 보고서는 `C:\CarScope-External\p3-a2-1\report-table-baseline`에 보존했다.

| 항목 | 표 방식 → 실행 시 측정 |
|---|---|
| 하면 높이 240칸 | 최대 차이 0.049 cm(표의 0.1 cm 반올림). null 위치 동일. −y 쪽이 0.05 cm 넘게 낮은 칸 0 |
| 패널 경계(0.1 cm 단위) | 변화 없음. 에이프런 플랜지 상단만 ≤ 0.05 cm 이동 |
| 예약 영역 상자·부피 | 동일 |
| 차체 결함, Shell 간 결함, 닫힌 보닛 교차 | 0 / 0 / 0, 동일 |
| 닫힌 보닛 ↔ 에이프런 최소 간격 | 2.302 → 2.285 cm |
| 보닛 개방 ↔ Shell (A/C, 0–60°, 1°) | 판정 변화 0, 최소 간격 변화 ≤ 0.017 cm, 새 교차 0 |
| 노출 광선, 프렁크 덮개 간격 | 동일 |
| SVG | 닫힌 상태 2장 바이트 동일. 열린 상태 2장은 좌표 반올림만 달라짐(크기 동일, 172,484 / 171,640 B). 결정성 유지 |
| 브라우저 검사 | Shell 표시 상태 12자세 결과 동일(새 교차 0). P3-A1 검사 통과 |
| 비용 | 하면 측정 Node 60 ms. 브라우저 Shell 준비 6.6 → 46 ms(측정 포함) |

## 6. 정확도 및 추정 수준

| 항목 | 분류 |
|---|---|
| 5절 모델 기준값 | VERIFIED_GEOMETRY. 모델에 대해서만 |
| 모든 새 패널의 형상·위치 | ESTIMATED_GEOMETRY |
| 벌크헤드·카울 커버 | 추가로 `ESTIMATED_BOUNDARY`. 실제 방화벽·카울 구조라고 주장하지 않음 |
| 예약 영역 3개 | SYNTHETIC_DEBUG_PLACEHOLDER |
| 서비스 부품의 좌우 배정, 프렁크 통 형상, 실제 패널 디테일 | UNVERIFIED |
| 보닛 각도 | SIMULATION_ONLY. 힌지와 최대 개방 각도는 UNVERIFIED |

## 7. 보닛 개폐 통합 결과

- **PoC**: P3-A1 페이지 `tools/three-poc/ioniq5-hood.html`을 재사용했다. Shell 코드는 `front-compartment-view.js`로 분리했다.
  - Shell은 장면에 별도 그룹으로 추가되며 보닛 피벗 아래에 두지 않는다.
  - 기능:
    - Shell 표시·숨김, 투명도, 부품 선택과 강조(클릭 또는 목록, 메타데이터 표시)
    - FrunkZone/서비스 영역 디버그 표시
    - 기존 축 A/C 전환, 각도 슬라이더, 열기·닫기
    - 시점: Front/Side/ISO/Top/BAY와 구획 근접 시점(bayiso, baytop, bayside)
  - 화면에 `ESTIMATED_GEOMETRY · not Hyundai CAD`와 `SIMULATION_ONLY`를 표시한다.
  - P3-A1의 BAY 시점 카메라는 열린 보닛에 가리지 않고 구획을 앞쪽 위에서 내려다보도록 조정했다. 회전·충돌 로직은 그대로다.
- **0° 원본 동일성 유지**:
  - 보닛 월드 행렬 차이 0, 로컬 행렬 변화 없음.
  - 피벗 삽입 전후 변한 픽셀은 25로, 같은 장면을 다시 렌더할 때의 잡음 15와 같은 수준이다.
- **Shell 표시 상태의 보닛 회전**: 축 A/C × 0/5/15/30/45/60°에서 브라우저 피벗과 Node 회전의 정점 차이 ≤ 1e-13 cm.
  - 같은 12개 자세에서 원본과 Shell을 합친 실시간 검사 결과 새 교차 0. 가장 가까운 형상은 P3-A1과 같은 A필러 밑 이음새다.
- **SVG에서의 원본 보존**: Shell을 숨긴 0° SVG는 P2-A7과 바이트 단위로 같다.
- **CLI**: `node tools/ioniq5-asset/front-compartment-report.mjs --glb=… --out=…`. 출력 경로가 저장소 안이면 거부한다.

## 8. 차체 간섭 검사

방법은 `collision.mjs` 정확 검사다(`MESH_TRIANGLE_EXACT`, 광역 판정만으로 판정하지 않음).
- 교차 위치는 새 `crossingPoint`(교차선 위의 실제 점)로 구한다.
- 미리 선언한 이음새 상자(`JOINTS`) 안의 교차는 의도된 접합으로, 밖의 교차는 결함으로 센다.
- 원본 GLB의 보닛·차체 이음새(P3-A1의 36쌍)는 Shell과 무관하다. Shell 결함으로 세지 않는다.

| 검사 | 결과 |
|---|---|
| Shell ↔ 원본 메시(보닛 제외 43개) | 결함 0, 접합 교차 0 |
| 패널별 원본과의 최소 간격 | 벌크헤드 0.56(Body), 상부 지지대 0.31(Body), 슈라우드 1.57(Body), 에이프런 1.83(램프 하우징), 카울 2.75, 라이너 3.63, 스트럿 타워 4.10 cm |
| Shell ↔ Shell | 결함 0 |
| 선언된 접합 교차 | 벌크헤드–카울 58, 타워–에이프런 각 57, 지지대–슈라우드 44, 카울–에이프런 3/2 |
| Shell ↔ 닫힌 보닛 | 교차 0. 최소 2.29 cm(에이프런 플랜지, 보닛 측면 끝이 말려 내려간 곳) |
| 보닛 개방 ↔ Shell (0–60°, 1°, 61 × 2축) | **A·C 모두 새 교차 0**. 최소 간격 2.29 cm(0°) |
| 같은 검사, 주요 각도 (A / C) | 5° 4.21 / 4.31 (카울), 15° 6.58 / 6.81 (에이프런), 30° 9.36 / 9.65, 45°·60° ≥ 10 cm |
| 예약 영역 ↔ 원본·Shell·보닛 | 교차 0. FrunkZone은 Shell에서 2.0 cm. 서비스 영역은 선반에서 0.44 cm(1 cm 위에 놓임). 닫힌 보닛과 3.84 / 3.52 / 2.92 cm. 0–60° 열림 중 교차 0 |

한계:
- 1° 샘플링이며 연속 회전 증명이 아니다.
- 일부 패널과 원본 사이에는 0.3–4.1 cm 틈이 있다. 시각적으로는 보이지 않거나(캡처 03·04·05) 플랜지 아래에 가려진다. 스트럿 타워는 휠 아치 위로 4.1 cm 떠 있지만 에이프런 플랜지 아래다.
- 패널 사이 구멍은 따로 판정하지 않았다. 구획에서 쏜 광선 391개가 모두 Shell에 맞았으므로, 뒤쪽 방향으로는 새는 곳이 없다.

## 9. 프렁크·서비스 부품 배치 공간

| 영역 | 상자 (cm) | 포락 부피 | 의미 |
|---|---|---|---|
| `zone-frunk` | x 126–196, \|y\| ≤ 27, z 52–91.8 | 150.4 L | 2WD(북미 외) **57 L 프렁크를 목표로 둔 예약 포락선**. 일부러 57 L보다 크게 잡았고, 통 형상이 아니다 |
| `zone-service-left` | x 124–180, y 33–55, z 53–94.7 | 51.4 L | 냉각수·워셔·브레이크액·퓨즈박스·12V 중 한쪽 그룹. 어느 쪽인지는 UNVERIFIED |
| `zone-service-right` | x 124–180, y −55 – −33, z 53–95.3 | 52.1 L | 같음(미러) |

- 영역 상단은 보닛 하면에서 4 cm 아래로 자동 결정된다. 영역끼리 겹치지 않고, 예약 영역은 라이너의 중앙 웰과 좌우 선반 위에 놓인다.
- 프렁크 덮개가 열릴 공간: FrunkZone 상단과 보닛 사이 간격은 다음과 같다(A / C, SIMULATION_ONLY).

  | 보닛 각도 | 간격 (A / C) |
  |---|---|
  | 0° | 3.8 cm |
  | 15° | 12.8 / 13.3 cm |
  | 30° | 18.8 / 19.3 cm |
  | 45° | 24.8 / 25.5 cm |
  | 60° | 30.7 / 31.3 cm |

  덮개의 힌지와 크기는 미확보라서 필요한 간격은 판정하지 않았다.
- 포락 부피는 수납 용량이 아니다. 57 L를 직육면체로 역산해 실차 형상이라고 하지 않는다.

## 10. 시각적 비교

캡처는 `C:\CarScope-External\p3-a2-1\captures\`에 있다. 저장소와 PR에는 넣지 않았다.

| 요구 | 파일 |
|---|---|
| 1. 전체, 보닛 닫힘 | `01-closed-full-shell.png` |
| 2. 전체, 보닛 열림 | `02-open45-full-shell-axisA.png` |
| 3. 내부 ISO | `03-interior-iso-shell.png` |
| 4. 내부 Top | `04-interior-top-shell-60.png` |
| 5. 내부 BAY | `05-interior-bay-shell.png` |
| 6. 기존 vs Shell | `06a/06b`(BAY), `06c/06d`(ISO) |
| 7. Shell 반투명 | `07-shell-translucent.png` (불투명도 0.35) |
| 8. FrunkZone·서비스 영역 | `08-frunk-and-service-zones.png`, `08b-zones-top-60.png` |
| 9. 힌지 A/C와 Shell | `09a/09b`(45°), `09c/09d`(30°), 측면 반투명 차체 |
| 부품 선택 | `10-part-selected.png` |
| 개폐 영상 | `hood-open-close-shell-axisA.webm` (546 KB) |
| SVG 시트 | `..\report\svg-sheet.png` |

관찰:
- 기존 모델은 열면 휠하우스 돔, 바닥판, 대시보드가 보인다.
- Shell 적용 후에는 다음이 보인다.
  - 앞 래치 크로스멤버
  - 중앙 웰과 좌우 선반
  - 스트럿 타워 캡이 있는 에이프런
  - 뒤쪽 카울·벌크헤드
- 배치는 S1 그림의 중앙 프렁크/좌우 서비스 구도와 같다.
- 외관(보닛, 펜더)은 그대로다.
- 남은 시각적 단순함:
  - 중앙 웰이 비어 있다. P3-A2.2의 프렁크 몫이다.
  - 헤드램프 하우징 뒷면이 단순한 상자 형상이다. 원본 그대로다.

## 11. 성능 측정

같은 PC와 같은 페이지에서 측정했다. Chrome headless, 실제 GPU(ANGLE D3D11, GTX 1060), 1280×800, DPR 1.

| 항목 | Shell 숨김 | Shell 표시 |
|---|---|---|
| 추가 메시 / 삼각형 | – | 9 / 1,330 |
| draw call / 프레임 삼각형 | 120 / 37,414 | 129 / 38,744 |
| 개폐 애니메이션 프레임 간격 p50 / p95 | 16.7 / 16.9 ms | 16.7 / 16.9 ms |
| 렌더 CPU 시간 p50 / p95 (`renderer.render`) | 1.0 / 1.6 ms | 1.1 / 1.6 ms |
| GPU 시간 p50 / p95 (`EXT_disjoint_timer_query_webgl2`) | 3.09 / 4.79 ms | 3.09 / 4.62 ms |
| 충돌 검사(한 자세, 30°) | 36.4 ms | 37.0 ms |

- 프레임 간격은 60 Hz vsync 상한이다. CPU 1 ms와 GPU 3 ms 모두 16.7 ms보다 훨씬 작아 병목이 없다. 그 이상의 GPU 여유는 추정하지 않는다.
- 페이지 로드 → 준비: 1,359 ms. 이 중 Shell 생성은 9.3 ms(Node에서는 24 ms)였다. P3-A1 측정은 1,495 ms였다. 하면 측정을 실행 시로 옮긴 뒤 브라우저 Shell 준비는 46 ms다(5a절).
- 표시 전환 비용(두 번째 프레임까지): 켜기 29.4 ms, 끄기 23.6 ms.
- Node 보고서 전체는 131 s다: 축 C 탐색, 1° 스윕 2축 × 61, 노출 광선 9.5 s, SVG 5장.

## 12. SVG 출력 가능성

`buildIoniqSvg`의 `nodes`/`projection` 확장(P3-A1)을 그대로 사용했다. 축 A 45° 프레임에 맞춘 공유 카메라다.

| 프레임 | 크기 | 생성 | 브라우저 decode / draw | 보이는 Shell ID |
|---|---|---|---|---|
| closed-no-shell | 157,272 B | 1.8 s | 11.7 / 1.2 ms | – |
| closed-shell | 157,272 B (**바이트 동일**) | 1.5 s | 9.0 / 0.5 ms | 0 |
| open45-no-shell | 167,286 B | 0.9 s | 28.9 / 3.1 ms | – |
| open45-shell | 172,484 B | 1.2 s | 14.9 / 0.6 ms | 8개(슈라우드는 지지대 뒤에 가려짐) |
| open45-shell-frunkzone (디버그) | 171,640 B | 1.3 s | 10.7 / 1.7 ms | 7개 + `zone-frunk` |

- 깊이 가림이 동작한다. 열린 보닛이 구획 뒤쪽을 가리고, FrunkZone이 웰 패널을 가린다.
- 패널마다 고유 ID 영역이 생긴다.
- 닫힌 보닛 외관은 변하지 않는다. 보닛 영역 경로가 같고, 닫힌 상태 SVG 전체가 바이트 단위로 같다.
- 같은 입력이면 같은 SHA가 나온다.
- Android에는 통합하지 않았다.

## 13. 남은 불확실성

- 모든 패널 형상이 추정이다. 실제 방화벽, 에이프런, 지지대, 카울 단면과 치수는 확인하지 못했다.
- 좌우 대칭 가정. S1의 서비스 부품 좌우 배정이 이 변형(시장, 핸들 위치)에 맞는지 미확인이다.
- 부품 카탈로그 도면과 공식 프렁크 사진을 확보하지 못했다.
- 보닛 힌지와 개방 각도: UNVERIFIED / SIMULATION_ONLY(P3-A1 유지).
- 일부 패널과 원본 사이에 0.3–4.1 cm 틈이 있다(대부분 가려짐).
- 라이선스: 모델 파생 출력은 공개 배포를 보류한다.

## 14. P3-A2.2 진입 조건

**진입 가능**하다. Shell 구조와 예약 공간이 준비됐다. 다음을 지킨다.

1. **프렁크 통**: `zone-frunk` 안에 만든다. 57 L는 목표 프로필이다. 통 치수나 덮개 힌지 자료가 없으면 형상은 ESTIMATED로 둔다.
2. **서비스 부품**: 좌우 서비스 영역 안에 둔다. 좌우 배정은 부품별로 출처를 붙여 결정한다. S1만으로는 확정하지 않는다.
3. **부착 방식**: 새 부품은 `front-compartment.mjs`와 같은 메타데이터 형식을 쓴다. 이음새는 `JOINTS`로 선언하고 같은 보고서 CLI로 검사한다.
4. **보닛 개폐 검사**: 축 A/C, 1° 스윕, 새 교차 0을 회귀 조건으로 유지한다.
5. **Android 통합**: 단계형 SVG 프레임 권고(P3-A1)를 유지한다.

## 변경 파일

| 파일 | 내용 |
|---|---|
| `tools/ioniq5-asset/front-compartment-layout.mjs` | 모델 기준 단일값, 보닛 하면 샘플 격자(높이 없음), 패널·영역 파라미터, 출처·정확도, 이음새 선언 |
| `tools/ioniq5-asset/front-compartment.mjs` | 결정적 패널 생성, 법선 정렬, 통계 |
| `tools/ioniq5-asset/front-compartment-report.mjs` | 검증 CLI: 간섭, 보닛 스윕, 영역, 노출, SVG |
| `tools/ioniq5-asset/collision.mjs` | `crossingPoint` 추가(기존 함수 변경 없음) |
| `tools/ioniq5-asset/test/front-compartment.test.mjs` | 합성 테스트 10개 + 실제 자산 테스트 2개 |
| `tools/three-poc/front-compartment-view.js`, `ioniq5-hood.{html,js}`, `serve.mjs` | PoC 통합(Shell UI, 구획 시점, CPU/GPU 측정) |
| `tools/three-poc/check-ioniq5-shell.mjs` | 브라우저 검사·캡처·성능·영상 |

변경하지 않은 것:
- 원본 GLB, 외관 메시
- Android 앱, Pleos SDK, WebView JavaScript 설정
- 기존 차량 프로필, `anatomy-car.parts`
- P3-A1 보닛 회전 코드와 측정값
