# P2-A7 · IONIQ 5 GLB → Anatomy SVG

판정: **SVG_POC_VERIFIED / NOT_INTEGRATED** — P2-A6 GLB(37,350 tri)에서 기존 CarScope 시점·팔레트·선 규칙을 따르는 Anatomy 스타일 SVG를 Blender 없이 자동 생성했다. 같은 카메라로 렌더링한 GLB(Three.js GPU 깊이 버퍼)와 픽셀 단위로 비교해 실루엣 IoU 0.998, 부품 일치 99.6%를 확인했다. 기존 Kotlin 렌더러는 코드 변경 없이 이 자산의 4개 상태를 그렸다(로컬 평가). 앱 기본 차량, Pleos AVD 모델, 기존 SVG/GLB 계약, Anatomy pin `1482e84`는 바꾸지 않았다. 모델에서 생성한 SVG·이미지·`.parts`는 저장소에 넣지 않았다.

기준: main `7fcbb6f`(PR #13 병합). 홈 PC, Node 22.16.0, Chrome headless(Anatomy `drive.mjs`), 2026-10-31. 실행 명령은 [tools/ioniq5-asset/README.md](../tools/ioniq5-asset/README.md).

## 1. 기존 Anatomy 규칙 조사와 어댑터 결정

Anatomy kit(pin)는 prism·lathe·box·tube 같은 **해석적 도형**만 기록하고, 깊이 순서와 audit도 그 도형을 대상으로 한다. 임의 메시 입력은 없다. Envelope의 fender처럼 삼각형마다 얇은 도형으로 기록하는 방식은 37k 삼각형에는 맞지 않는다. 그래서 CarScope 측 어댑터 [tools/anatomy-car/mesh-svg/](../tools/anatomy-car/mesh-svg/)를 만들었다. 모델에 의존하지 않는 범용 어댑터이며, IONIQ 바인딩은 [anatomy-svg.mjs](../tools/ioniq5-asset/anatomy-svg.mjs)에 있다.

| 요소 | 재사용한 기존 규칙(변경 없음) | 어댑터가 추가한 것 |
|---|---|---|
| 카메라 | `VIEW` 640×330, azimuth 56°, elevation 28°, pad 18; `k.fitProjection`(메시 bbox 8개 꼭짓점) | — |
| 투영·깊이 | `k.iso`, `k.depthOf` | — |
| 화면 기저 | P2-A2.1 보정 `u' = width − u`를 정확히 한 번 | — |
| 음영 | `G.toneOf`(kit 광원 `(−sinA, cosA, 1.2)`, 밴드 0/.2/.42/.62): 0–3 = `shades`, 4 = `top` | 양면 메시는 시점 쪽 면의 법선 사용 |
| 색·선 | `PALETTES`, `LINE`, `LINE_W` 0.6, 같은 색 0.3 hairline(kit의 seamless) | 재질 30개 → 기존 팔레트 매핑. 빨강은 OPEN 강조 전용이라 적색 램프는 `lampSmoke` |
| 가림 | kit은 기록된 도형의 painter 순서 | **4× 슈퍼샘플 깊이 버퍼**: 샘플마다 보이는 삼각형 결정. 같은 깊이(0.02 cm 이내)에서는 작은 부품 우선(렌즈가 하우징 위에 놓이는 경우) |
| 경로 | `k.pathOf`(0.1 단위 반올림) | (부품, 팔레트, 톤) 라벨 맵을 **경계 체인 단위로 한 번만** Douglas-Peucker 단순화. 이웃 영역이 같은 체인을 공유하므로 틈·겹침이 없음. `fill-rule="evenodd"` |
| 선 | 외곽 `hi`, 보조선 `lo` | 부품 경계·배경 경계 = `hi`, 같은 부품 안의 재질 경계 = `lo`, 톤 경계 = 선 없음 |
| 정리 | 유리·렌즈·번호판은 kit에서 평면 `poly` | `glass/lamp/lampSmoke/plate/amber`는 부품당 하나의 톤. 12 px² 미만 톤 얼룩은 같은 부품·같은 재질의 이웃에 병합(부품·재질 경계는 이동 안 함) |
| 부품 ID | `door-front-left` 등 기존 DoorId 문자열 | `<g id="part-…" data-part="…">`. 도어·휠은 **메시 위치로** 정하고 OpenX 이름과 불일치하면 실패 |

유리는 기존 kit 차량처럼 불투명 `glass`로 칠한다. 그래서 GLB(투명 유리)에서 보이는 실내는 SVG에서 보이지 않는다. 약 +22 mm 치수 차이는 보정하지 않았다(P2-A6 정책 유지).

## 2. 결과

| 항목 | 값 |
|---|---|
| 입력 / 보이는 삼각형 | 37,350 / 8,163 |
| 라벨(부품×팔레트×톤) / 출력 영역 | 275 / 98 |
| 경계 체인 / 단순화 후 점 | 2,205 / 5,834 |
| SVG 크기 / 요소 | **156,363 B / 118** (기존 세단 렌더러 SVG 177,293 B, 554 요소) |
| 변환 시간 | 약 0.9 s (래스터 0.47 s, 벡터화 0.18 s) |
| 결정성 | 두 번 실행 SHA-256 동일 |
| 이 시점에서 보이지 않는 부품 | 27/44: 우측 도어 2, 우측 휠 2, 캘리퍼 4, 실내, 스티어링, 후방 램프 등 |

## 3. GLB와 SVG 비교 (같은 카메라)

[tools/three-poc/ioniq5-svg.html](../tools/three-poc/ioniq5-svg.html)은 SVG 투영을 정확히 재현하는 Three.js 직교 카메라를 만든다. 카메라 값은 kit 기저 R/D/V와 `P.origin`, `scale·√1.6`에서 계산한다. GLB를 부품별 단색 ID로 GPU 렌더링(1280×660)하고, SVG ID 버전을 같은 해상도로 래스터화해 픽셀마다 비교한다. 제 래스터라이저를 거치지 않는 독립 검증이다. [check-ioniq5-svg.mjs](../tools/three-poc/check-ioniq5-svg.mjs)는 실루엣 IoU < 0.98, 부품 일치 < 0.97, 히트 테스트 하나라도 불일치면 실패한다.

| 지표 | 결과 |
|---|---|
| 실루엣 IoU (차량 방향·비율·위치) | **0.998** |
| 부품 일치(양쪽 모두 차량인 픽셀) | **99.64%** |
| 부품 IoU | body 0.991, glass 0.994, hood 0.994, tailgate 0.973, door-front-left 0.994, door-rear-left 0.995, wheel-front-left 0.993, wheel-rear-left 0.991, 좌측 미러 0.960 |
| 불일치 상위 | 모두 경계 1–2 px: hood↔body 75 px, glass↔body 63 px 등 |
| 히트 테스트(`elementFromPoint` → `data-part`) | 9/9: body, glass, hood, tailgate, 도어 2, 휠 2, 미러 |
| 휠·도어 위치 | 위 부품 IoU로 확인(위치가 어긋나면 IoU가 급락) |
| 브라우저 콘솔 | clean |

단순화 수준별 비교. 단순화로 크기는 74% 줄지만 정확도는 사실상 같아서 기본값을 t=1.5로 정했다.

| tolerance(raster px) / 얼룩 병합 | 크기 | 실루엣 IoU | 부품 일치 | 최저 부품 IoU | 히트 |
|---|---:|---:|---:|---:|---:|
| 0.75 / 0 | 594,977 B | 0.9980 | 0.9965 | 0.966 | 9/9 |
| 1 / 6 px² | 239,913 B | 0.9985 | 0.9968 | 0.962 | 9/9 |
| **1.5 / 12 px² (기본)** | **156,363 B** | 0.9981 | 0.9964 | 0.960 | 9/9 |
| 2 / 16 px² | 150,937 B | 0.9979 | 0.9959 | 0.955 | 9/9 |

성능(호스트 Chrome, 인라인 삽입 → 두 프레임까지, 15회): 중앙값 33.3 ms. 기존 세단 측정(33.5 ms)과 같은 방식이며, 대부분 vsync 대기라 차이를 구분하지 못한다. 최댓값 184 ms는 첫 삽입(콜드)이다. AVD/실기기 수치는 NOT_RUN.

시각 비교 캡처는 모델 파생물이라 저장소 밖(`C:\CarScope-External\ioniq5-svg\compare.png`)에만 있다.

## 4. Android 적용 가능성

[eval-android-renderer.ps1](../tools/ioniq5-asset/eval-android-renderer.ps1)은 `anatomy-car.parts`를 잠시 IONIQ `.parts`로 바꾸고 `:vehicle-core:exportSvgSamples`를 실행한다. 이후 원본으로 되돌리고 SHA-256(`A6F19A53…2197`) 일치를 확인하며, 원복에 실패하면 명시적으로 실패한다.

| 확인 | 결과 |
|---|---|
| 기존 `AnatomyCarAsset.parse` / `VehicleSvgRenderer` 코드 변경 | 없음. 파싱·렌더 성공 |
| closed / front-left-open / stale / unavailable | 4개 생성(약 161 KB). 도어 accent가 상태 색·투명도·점선으로 표시됨 |
| accent | 도어 가시 영역의 닫힌 링. 미러에 가린 부분은 nonzero 구멍 |
| 우측 도어 | 이 시점에서 보이지 않아 기존 세단과 같이 inset 칩만 표시 |
| 마크업 안전성 | 생성 마크업은 `svg/g/path`와 허용 속성만 사용(실제 자산 테스트에서 검사). 스크립트·텍스트·링크 없음 |

적용 전 필요한 결정과 변경(이번 PR에서 구현하지 않음):
1. `AnatomyCarAsset.instance`가 단일 리소스에 고정되어 있다. 프로필별 자산 로딩(`pleos-avd-reference` 기본 유지)과 렌더러 입력 확장이 필요하다.
2. 도어 회전축이 UNVERIFIED라 열린 자세가 없다. 현재 `open` 변형은 닫힌 형상을 반복하고 상태는 accent로만 구분된다. 기존 계약(OPEN = 열린 형상)과 다르므로 "고정 형상 + 상태 강조"를 제품 규칙으로 승인받거나, 축을 검증한 뒤 열린 자세를 만들어야 한다.
3. 모델 파생 자산을 APK에 넣는 것은 라이선스 승인 전까지 보류한다.
4. AVD WebView 실제 표시·성능은 NOT_RUN.

## 5. 검증과 회귀

| 검사 | 결과 |
|---|---|
| mesh-svg 합성 테스트 [mesh-svg.test.mjs](../tools/anatomy-car/test/mesh-svg.test.mjs) | 6/6: 깊이·우선순위, 계단 단순화, 단순화 없이 모든 픽셀을 구멍까지 정확히 복원, 열린 경계 실패, 얼룩·평면 톤이 부품/재질 경계를 넘지 않음, 합성 박스에서 kit 투영·화면 보정·가림 면적·kit 톤 일치 |
| IONIQ 바인딩 테스트 [anatomy-svg.test.mjs](../tools/ioniq5-asset/test/anatomy-svg.test.mjs) | 합성 4 PASS + 실제 자산 1 SKIP. `IONIQ5_GLB` 지정 시 5/5(크기 < 200 KB, 우측 부품 비가시, 마크업 안전성, 카메라 방향) |
| `tools/ioniq5-asset` 전체 | 14 PASS / 2 SKIP; 실제 자산 env 지정 시 16/16 |
| SVG↔GLB 비교 | PASS(3절) |
| P2-A6 PoC(`check-ioniq5.mjs`) | 8/8 선택 PASS(serve.mjs 변경 후 회귀 없음) |
| Anatomy audit(기존 차량) / `anatomy-car.parts` | audit passed / SHA-256 변경 없음 |
| export, Envelope, Geometry verify | PASS(Khronos 0/0) |
| anatomy-car 테스트 | 58/58(기존 52 + mesh-svg 6) |
| `:vehicle-core:test` | BUILD SUCCESSFUL |
| Anatomy audit을 IONIQ SVG에 적용 | 해당 없음: kit audit은 기록된 해석적 도형 대상. 대신 독립 GPU 비교를 사용 |

CI(Geometry CI)는 합성 fixture만 사용한다. 기존 단계 `npm test`와 `node --test tools/ioniq5-asset/test/*.test.mjs`가 새 테스트를 실행한다.

## 6. 미해결 사항

- **Custom normal:** 해석하지 않으므로 면 법선을 쓴다. 그래서 차체 곡면의 톤 경계가 삼각형 모서리를 따라 생긴다. 12 px² 얼룩 병합으로 완화했지만 매끈한 곡면 밴드는 아니다.
- **유리:** 불투명 처리라 실내가 보이지 않는다.
- **시점:** 앞-왼쪽 하나만 있고, 우측 도어·휠은 이 시점에서 보이지 않는다.
- **열린 도어:** 열린 자세가 없다(힌지 축 UNVERIFIED).
- **크기 대비:** 156 KB는 기존 세단 자산과 비슷하지만, 경로당 점이 많아 확대하면 다각형 느낌이 남는다. 곡선 맞춤(베지어)은 NOT_RUN이다.
- **실행 범위:** AVD/WebView 실행과 실기기 성능 측정은 하지 않았다.
- **라이선스:** 모델 파생 SVG·이미지의 공개 배포는 승인 전까지 보류한다.
