# P2-A2 — Anatomy-to-3D Geometry PoC

> 후속 정정 (2026-10-31): [P2-A2.1](p2-a21-geometry-correctness.md)에서 화면 기저를 명시적으로 연결하고 도어 안쪽 relief·힌지 동축화·실패하는 검증 gate를 추가했습니다. 아래 수치·결함은 P2-A2 당시 기록입니다. “Anatomy 투영이 잘못”이라는 뜻으로 해석하지 않으며, CarScope의 세계 좌표와 화면 기저 연결 문제로 정정합니다.

작성: 2026-10-30. P2-A1의 자동차 전용 kit에서 실제 3D 메시를 만들 수 있는지 검증했습니다.

- 기존 SVG 출력은 바이트 단위로 같습니다. `anatomy-car.parts`의 SHA-256은 `13d2d0d9…a032` 그대로입니다.
- Pleos SDK 동작과 메인 화면은 바꾸지 않았습니다.

**판정: CONDITIONAL GO.**
- 3D 메시 생성, 브라우저 Three.js 데모, Pleos AVD WebView의 WebGL2 렌더링은 모두 동작했습니다.
- 다만 제품에 적용하기 전에 해결할 조건이 있습니다(아래 9절).

## 1. 방식: 투영 전 입력을 그대로 기록

SVG 경로를 역변환하지 않습니다. kit 함수가 투영하기 직전의 입력을 경로 객체에 **열거되지 않는 `geo` 속성**으로 붙입니다(`automotive/geometry.mjs`의 `withGeo`). 마크업 출력 함수는 이 속성을 읽지 않으므로 SVG는 바뀌지 않습니다.

| 생성 함수 | 기록되는 입력 |
| --- | --- |
| `prismPaths`, kit `prismOf` | frame F(o, u, v, a), 다각형 (u, v), s0, s1 |
| `convexPaths` | 꼭짓점, 면 index loop |
| kit `lathe` / `disc` / `ringBand`, `k.cylinder` | frame F, 단면 meridian [s, r, smooth?], 분할 수 |
| `poly` (평면 inlay) | 3D 점 목록 (원래부터 3D) |

`automotive/model.mjs`가 SVG build와 exporter가 함께 쓰는 단일 모델 생성 함수입니다.

## 2. 부품 분류

| 분류 | 원시 도형 | 개수 | 내용 |
| --- | --- | --- | --- |
| A | prism (오목 포함) | 66 | frame, 다각형, 두께가 곧 그린 형상 |
| A | 볼록 다면체 | 1 | 캐빈. 꼭짓점과 면이 곧 그린 형상 |
| A | 회전체 (smooth 아님) | 16 | 디스크, 링, 힌지 원기둥. meridian과 축이 정확 |
| B | 회전체 (smooth) | 2 | 타이어. SVG는 smooth 꼭짓점 구간을 Hermite 곡선으로 그리지만, 3D는 꼭짓점을 직선으로 잇고 법선만 공유 |
| B | 평면 inlay | 6 | 유리, frit, 라이너, 램프 렌즈. 두께가 없어 양면 재질로 내보냄 |
| C | 선 | 13 | shut line, 크리스 표시, 와이퍼, 반사선. 3D 정의 없음 |
| C | 점 | 4 | 휠 너트, 와이퍼 피벗. 3D 정의 없음 |
| C | halo | 1 | 화면 공간 그림자 |

**보완이 필요한 상태 의존 부품 (B):**
- **열린 도어 전용 부품**: 힌지 너클과, 창문 자리의 실내 패치는 차체에 고정된 부품으로 내보내고 `visibleWhen: "open"`을 붙였습니다.
  - 실내 패치는 캐빈이 속이 찬 다면체라서 생긴 대체물입니다. 3D에서 맞게 하려면 캐빈에 실제 창 개구부를 모델링해야 합니다.
- **도어 안쪽 구조**: SVG에서는 열린 자세에만 그리지만, 3D에서는 항상 존재합니다(z-buffer가 처리).
- **SVG에서 보이지 않던 면**: 우측면(도어, 휠, 유리), 뒷유리, 테일램프, 하부는 모델링되어 있지 않습니다. 360° 회전에서 평판으로 보입니다.

### audit 근사와 실제 형상

| 부품 | audit 기록 | 실제 렌더 형상 | 차이 |
| --- | --- | --- | --- |
| 캐빈 | 내부 계단 y-prism 5단 + 지붕 2단 | 볼록 다면체 | 부피 1,029,587 / 1,125,423 cm³ = 91.5%. 실제보다 작게 기록(의도) |
| 그 밖의 prism, 회전체 | 같은 frame, 다각형, meridian | 같음 | 없음 |
| 타이어 | meridian (A.lathe, Hermite 추적) | 3D는 꼭짓점 직선 연결 | 어깨 곡면에서 작은 차이 |

## 3. 중간 표현 (IR)과 출력

`node tools/anatomy-car/geometry-export/export.mjs` → `tools/anatomy-car/build/geometry/`(Git 제외)

- `ir.json`: `format: carscope-geometry-ir`, 단위 cm, 축 x 전방 / y 좌측 / z 위. 부품마다 다음 필드를 담습니다.
  - `partId`, `cls`, `classification`(A/B/C), `materialId`
  - `parent`(body 또는 door id), `pivot`, `axis`
  - `states { closed, open }`(라디안), `visibleWhen`
  - `vertices`, `normals`, `triangleIndices`
- `car.glb`: glTF 2.0(706KB). 좌표는 (x, y, z) → (x, z, −y)/100 m로 바꿨습니다. 행렬식이 +1이라 winding이 보존됩니다.
  - 노드 구조: `car` → `body` / `door-front-left` / `door-rear-left`
  - 도어 노드는 힌지 축 위치에 있고, `extras.states`에 열림 각도를 담습니다.
  - 루트 `extras`에 SVG 카메라 방향을 담습니다.
- `report.json`: 부품별 메시 검사, 도어 강체성, 스윕 결과

재질은 SVG 팔레트 색을 baseColor로 쓰고(sRGB → linear), metallic/roughness는 재질별 추정값입니다.

## 4. 메시 검사

| 항목 | 결과 |
| --- | --- |
| 부품 / 삼각형 | 91 / 7,573 |
| degenerate 삼각형 | 0 |
| 법선이 면과 반대 | 0 |
| winding 충돌 | 0 |
| 닫힌 메시 85개 | watertight 85, 바깥 방향(부호 부피 > 0) 85, non-manifold 간선 0 |
| 열린 메시 | 평면 inlay 6개 (의도, 양면) |
| 도어 강체성 | 열린 자세 SVG 입력을 힌지 기준으로 되돌린 결과와 닫힌 자세 입력의 최대 오차: 앞도어 2.6e-14, 뒷도어 3.2e-14 cm |

도어 강체성은 열림/닫힘을 따로 그린 SVG 자세가 **하나의 강체를 힌지 축으로 돌린 것과 같다**는 수치 증거입니다. 그래서 3D에서는 도어 메시 하나에 노드 회전만 주면 됩니다.

## 5. 도어 개폐 충돌

검사 방법은 다음과 같습니다.
- 도어를 0°부터 최대 각도까지 1° 간격으로 돌렸습니다.
- 도어 점(꼭짓점, 삼각형 중심, 간선 2cm 간격)이 차체 prism이나 캐빈 다면체 안으로 들어가는지 정확한 점-포함 판정으로 검사했습니다.
- 반대로 차체 꼭짓점이 회전하는 도어 prism 안으로 들어가는지도 검사했습니다.
- 침투 깊이가 0.3(3mm)을 넘으면 충돌로 봅니다.

| 도어 | 도어 → 차체 | 차체 → 도어 |
| --- | --- | --- |
| FRONT_LEFT (0~64°) | 0 | 0 |
| REAR_LEFT (0~58°) | 0 | **5°: 3.6mm, 6°: 3.3mm** |
| 두 도어 동시(같은 비율) | x 범위 겹침 없음 | — |

**발견된 결함**:
- 뒤 휠 아치 플레어의 앞쪽 모서리(x −92.9, z 37.9)가 뒷도어 안쪽 구조(두께 −6.5~−2.4 층)를 5~6°에서 스칩니다.
- 닫힘/열림 두 자세만 그리는 SVG에서는 보이지 않는, 회전 도중의 간섭입니다.
- 수정안: notch 반경을 키우거나 안쪽 구조 아래 뒤 모서리를 깎습니다.
- 열린 도어 SVG가 바뀌므로 이번에는 고치지 않았습니다(SVG 불변 조건).

## 6. Three.js PoC (`tools/three-poc/`)

`npm install` 후 `node tools/three-poc/serve.mjs`를 실행하고 `http://127.0.0.1:8095/`를 엽니다. three는 `0.160.0`으로 고정했고, MIT 라이선스는 `node_modules/three/LICENSE`에 있습니다.

| 기능 | 결과 |
| --- | --- |
| 360° 회전, 확대·축소 | OrbitControls |
| 도어 힌지 개폐 | 슬라이더와 애니메이션. 노드 회전이 GLB `extras.states`를 따름 |
| 부품 선택 | raycast 후 강조. partId, 분류, 재질, 삼각형 수 표시 (예: `body.outer-front/0`, prism, paint, 200) |
| wireframe, 표면 법선 | 재질 wireframe, VertexNormalsHelper |
| SVG와 같은 카메라 | 직교 투영. GLB에 기록된 kit 시선 방향 사용 |
| 자동 측정 (`?auto=1`) | GPU 정보, 회전·도어 프레임 시간, context loss·복구 |

여러 시점(뒤, 오른쪽, 위, 아래, 앞쪽 낮은 곳)에서 빈 면이나 뒤집힌 면은 보이지 않았습니다. 다만 우측면, 뒷면, 하부는 2절대로 모델링되어 있지 않아 평판으로 보입니다.

## 7. SVG와 3D의 기하 차이

1. **P2-A2 당시 SVG와 3D의 화면 좌우가 달랐습니다 (P2-A2.1에서 정정).**
   - kit의 `iso()`에서 화면 오른쪽 R, 아래쪽 D, 관찰자 쪽 V를 놓고 계산하면 R × D = V가 됩니다. 즉 투영이 오른손 좌표계 세계의 반사입니다.
   - 차량 모델은 "y = 좌측" 오른손 좌표계이고, 3D는 FRONT_LEFT를 물리적으로 왼쪽에 그립니다.
   - **P2-A/P2-A1 SVG는 거울상이라, 앞이 오른쪽이고 FRONT_LEFT 도어가 그림상 차의 오른쪽 면으로 읽힙니다.** OEM 홈 화면의 차량 이미지는 앞이 왼쪽이고 왼쪽 면을 보여 줍니다.
   - 따라서 이전 문서의 "좌측면과 전면이 보이는 시점"이라는 설명은 시각적으로 맞지 않습니다.
   - PoC의 "mirror like the SVG" 옵션은 차량을 y 방향으로 뒤집어 SVG 구도를 그대로 재현합니다.
   - 후속 결론: 모델의 y 또는 DoorId를 바꾸지 않습니다. 같은 물리적 시점의 화면 X 기저만 보정합니다. azimuth 변경만으로 두 기저의 차이가 없어지는 것은 아닙니다. [원인·검증](p2-a21-geometry-correctness.md#원인-분석-화면-기저와-차량-좌표의-연결)
2. 타이어 smooth 곡면은 3D에서 꼭짓점 직선 연결입니다(2절).
3. 선과 점(shut line, 너트, 와이퍼 등)은 3D에 없습니다. 노멀맵이나 얇은 형상으로 보완해야 합니다.
4. 평면 inlay는 두께가 없습니다.
5. 열린 도어 전용 패치(창 개구부 실내)는 3D에서 대체물입니다.
6. 그림자는 3D 조명과 바닥으로 대신합니다.

## 8. 렌더링 성능과 Android WebView

### 데스크톱 (헤드리스 Chrome, GTX 1060 / ANGLE D3D11)
- 로드: 106ms
- 회전·도어 프레임: 중앙값 16.7ms, p95 16.9ms(60fps)
- context loss → 복구 → 다시 그리기 정상
- JS heap: 13MB

### Pleos AVD (2 vCPU / 4GB, `-gpu host`)
실험 화면은 debug 빌드 전용 `io.carscope.app.lab.WebGlLabActivity`입니다. 메인 화면은 그대로입니다.

| 항목 | 기본 (DPR 1.375, 1683×1210) | DPR 1 (1224×880) |
| --- | --- | --- |
| WebGL | WebGL2. ANGLE → Android Emulator OpenGL ES Translator (GTX 1060), ES 3.1, max texture 4096 | 같음 |
| 로드 | 450ms | 429ms |
| 회전 프레임 (중앙값 / p95 / 최대) | 66.6 / 166.6 / 200ms | 50.1 / 100 / 233ms |
| 도어 애니메이션 프레임 (중앙값 / p95) | 66.7 / 366.6ms | 66.7 / 116.7ms |
| context loss → 복구 | 복구 후 그리기 정상 | 정상 |
| 앱 PSS | 114.6MB | 115.1MB |
| ANR | 0 | 0 |

- 프레임 시간은 게스트 load가 높은(약 8.8) 2코어 에뮬레이터 값이라, 실차 하드웨어 성능을 뜻하지 않습니다.
- context 복구 후 배경이 검정으로 남는 결함을 AVD 캡처에서 발견했습니다. 복구 시 clear color를 다시 지정하도록 고쳤습니다.

### 보안 (실험 화면만 해당)
- JavaScript는 실험 화면에서만 켭니다. 메인 WebView는 계속 JS를 끈 상태입니다.
- 파일·콘텐츠 접근을 끄고, 앱 assets를 사설 출처 `https://carscope-lab.invalid/`에서 `shouldInterceptRequest`로 내려줍니다.
  - 그 밖의 모든 요청은 404입니다. 앱에 INTERNET 권한도 없습니다.
- 응답 헤더 CSP: `default-src 'none'; script-src 'self' 'sha256-…'`(inline import map 하나만 해시로 허용), `connect-src 'self'`
- 데스크톱에서 같은 CSP 헤더로 위반 없이 로드되는 것을 확인했습니다.
- 실험 Activity는 debug 병합 manifest에만 있고, release 병합 manifest에는 없습니다. adb로 열 수 있도록 debug에서만 exported입니다.
- three 등 실험 assets(2.1MB)는 `node tools/three-poc/build-lab.mjs`로 생성하며 Git에서 제외합니다. debug APK는 9.5 → 10.0MB입니다.

## 9. 판정과 조건

**CONDITIONAL GO.** 3D 데이터 경로는 성립합니다. 형상 정의 대부분(A 83개)이 정확한 3D 입력이고, 메시는 watertight이며, 도어 강체성이 증명됐고, GLB를 Three.js가 바로 읽습니다. 제품에 적용하기 전 조건은 다음과 같습니다.

1. **SVG 거울상 정정**: FRONT_LEFT가 그림상 왼쪽 면에 오도록 SVG를 고칩니다. 3D는 이미 맞습니다.
2. **360° 모델링**: 우측 도어, 휠, 유리, 뒷유리, 테일램프, 하부, 캐빈의 실제 창 개구부를 만듭니다.
3. **뒷도어 간섭 수정**: 5~6° 구간 3.6mm입니다.
4. **실제 Pleos 하드웨어 성능 측정**: 에뮬레이터 15~20fps는 판단 근거로 부족합니다. DPR 1이 유리합니다.
5. **보안 검토**: 메인 WebView에서 JS를 켜야 하므로 CSP와 출처 격리 설계를 검토합니다. 지금은 실험 화면에만 적용했습니다.
6. **SVG fallback 유지**: WebGL 미지원이나 context loss가 반복될 때 SVG로 돌아갑니다.

## 10. 전체 차량 GLB 확장 가능성

- kit 입력이 3D이므로 같은 exporter로 모든 부품을 내보낼 수 있습니다.
- 막힌 것은 형상 데이터가 아니라 SVG에서 보이지 않던 면의 모델링(2절 B)입니다.
- 선·점 디테일은 노멀맵이나 얇은 형상으로 바꿔야 합니다.
- 타이어 smooth 곡면은 Hermite 곡선을 따라 표본을 뽑으면 SVG와 일치시킬 수 있습니다.

## 11. Anatomy upstream 기여 후보

- kit 투영이 반사(왼손 좌표계)라는 점을 문서에 명시하고, 3D 연동 시 주의사항을 안내합니다.
- 생성 함수에 3D 입력을 남기는 공식 hook을 둡니다(이번의 `withGeo`). 3D·glTF export의 기반이 됩니다.
- audit에 일반 볼록 다면체 형상(`A.convex`)을 추가합니다. 이번에는 계단 근사로 대신했습니다.
- 오목 다각형 prism(`prismPaths`)을 kit 본체로 올립니다(현재는 예제 코드).
- 회전 스윕 충돌 검사를 추가합니다. 이번에 열림/닫힘 정지 자세로는 잡히지 않던 간섭을 찾았습니다.
