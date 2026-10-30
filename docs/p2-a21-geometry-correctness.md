# P2-A2.1 — Geometry Correctness

작성: 2026-10-31 (Asia/Seoul). 기준 main: `40f97790ee32d10f183028193c2b49dc861849ec` (PR #6 병합).
작업 브랜치: `fix/p2-a2-geometry-correctness`. 구현·검증은 `C:\dev\CarScope`에서 수행했다. 별도 Documents 작업 사본은 변경하지 않았다.

## 범위와 계약

세계 좌표 cm, +X 전방 / +Y 차량 좌측 / +Z 위, `ROW_1_LEFT → FRONT_LEFT`와 DoorId를 유지한다.
glTF는 `(x,y,z) → (x,z,-y)/100` m이다. Pleos SDK 처리, STALE 5000ms, 메인 WebView JS 설정, 출시 설정은 변경하지 않았다.
Anatomy 원본을 수정하지 않았다. pin은 `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`이다. 로더는 전체 SHA와 tracked 파일의 clean 상태를 검사한다.
프로젝트 경계와 기존 설계는 [AGENTS](../AGENTS.md), [architecture](architecture.md), [SDK 연동](pleos-sdk-integration.md), [3D PoC](p2-a2-geometry-poc.md)를 참조한다.

## 원인 분석: 화면 기저와 차량 좌표의 연결

P2-A2에서 “kit의 버그/거울상”이라고 표현했던 부분은 **CarScope가 두 투영의 화면 기저를 같은 것으로 간주한 통합 문제**로 정정한다. Anatomy의 투영 관례 자체를 잘못이라고 판정하지 않는다.

pin의 `iso()` 수식에서 a=azimuth, e=elevation일 때, 배율과 원점을 제외하면:

```text
screenRight R = (sin a, -cos a, 0)
screenDown  D = (cos a sin e, sin a sin e, -cos e)
towardViewer V = (cos a cos e, sin a cos e, sin e)
R × D = V
```

동일한 V를 바라보는 Three.js 오른손 카메라는 `right = normalize(worldUp × V) = -R`, `down = D`이다.
그래서 세계의 +Y를 차량 좌측으로 정의한 CarScope에서 기존 SVG와 3D의 화면 좌우가 반대였다. azimuth만 바꿔도 위 기저의 관계는 바뀌지 않는다.

### 선택과 비교

| 안 | 영향 | 결정 |
| --- | --- | --- |
| 세계 y 반전 / DoorId 교환 | SDK 의미·회전·축 변환 변경 | 제외 |
| Anatomy 원본 투영 변경 | 외부 pin 수정, upstream 관례 변경 | 제외 |
| azimuth 변경만 | 관찰 위치는 바꾸지만 기저 차이는 해소하지 못함 | 제외 |
| 출력 화면 X 기저 보정 | `u'=VIEW.width-u`, v 유지 | 선택 |

`camera.mjs`의 adapter를 SVG 출력의 path·circle·accent에 정확히 한 번 적용한다. 카드 텍스트와 Kotlin 상태 inset은 보정하지 않는다.
세계 꼭짓점, 법선, 가시면 판정, 세계 조명, painter 순서는 그대로다. 화면 반사는 거리·교차·앞뒤 순서를 보존하므로 기존 Anatomy audit은 원래 kit 좌표에서 수행한다. 출력 후 선 끝 검사와 실제 화면도 별도로 확인한다.
`VIEW`를 SVG 카메라와 GLB `extras.svgCamera`가 함께 사용한다. Three.js의 세계 반전 옵션은 제거했다.

### 비대칭 랜드마크

`automotive/coordinates.mjs`는 서로 다른 길이·색·표시 크기의 FRONT/REAR/LEFT/RIGHT/UP 진단점을 생성한다. 차량의 생산 자산에 점을 추가하지 않는다.
`build/coordinate-contract.{html,json}`은 세계, Anatomy 화면, 보정 SVG 화면, glTF 좌표를 각각 기록한다.
GLB에는 같은 진단점의 미터 좌표를 extras로 넣으며 debug viewer의 `?landmarks=1`로 표시한다.
테스트는 별도의 외적 기반 카메라 수식과 실제 GLB BIN의 Float32 좌표·법선·힌지·parent를 대조한다. 변환 함수를 호출한 값끼리만 비교하지 않는다.
SDK → FRONT_LEFT 매핑의 기존 app 합성 테스트도 재실행했다. 이번에는 실제 SDK 이벤트를 새로 주입하지 않았다.

## 원인 분석: 뒷도어와 힌지 간섭

원래 `body.flare-rear`의 앞 모서리가 뒷도어 안쪽 구조의 아래·뒤 경계를 개폐 중 침범한다. 닫힘/열림 정지 자세의 audit만으로는 드러나지 않았다.
원래 prism을 `test/fixtures/rear-inner-poc.json`에 고정했다. 5°의 (−92.9,90,37.9), 6°의 (−92.9,91.3,37.9) cm를 역회전하면 원래 안쪽 구조에 각각 약 0.36 / 0.33cm 들어간다.
모델 수정 전 전체 스윕 회귀 테스트가 exit 1로 실패하는 것을 기록했다.

### 형상 선택

| 안 | 실제 확인 | 결정 |
| --- | --- | --- |
| A: 공통 NOTCH_R 44.2→45.2 | 차체 문턱도 커져 `body.band-sill × seat.rear.back` audit에서 1.07cm sunk 발생 | 제외, 원래 값 복원 |
| B: 도어 안쪽 구조만 relief | 기존 개구부·외판 유지, 알려진 5°/6° 점이 내부에서 벗어남 | 선택 |

`REAR_INNER_NOTCH_R=45.2`를 적용한 안쪽 구조만 재생성한다. 외판·recess·차체 개구부의 기존 프로파일은 유지한다. 허용 침투값을 키우지 않았다.

강화한 검사에서 이전 스윕에 빠져 있던 **고정 힌지 너클**의 추가 간섭도 발견했다. 원래 원기둥 중심은 실제 도어 pivot에서 (−0.95,+0.55)cm 벗어나 있었다.
너클을 실제 pivot에 동축으로 놓고 반경을 앞 모서리 gap과 같은 0.5cm로 만들어 회전 중 접하도록 고쳤다. 고정 힌지를 검사에서 제외하지 않았다. audit도 통과했다.

## 생성과 검증 실행

```powershell
npm ci --ignore-scripts --prefix tools/anatomy-car
npm run build --prefix tools/anatomy-car
npm run export --prefix tools/anatomy-car
npm test --prefix tools/anatomy-car
npm run verify --prefix tools/anatomy-car
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
```

- `generate.mjs`: 파일을 쓰지 않는 공통 모델 → mesh/IR/GLB/보고서 계산.
- `export.mjs`: 생성물 작성만 담당. 생성 exit 0을 검증 PASS로 사용하지 않는다.
- `verify.mjs`: 생성물을 읽고 pin 모델에서 다시 생성해 stale/변조를 확인한다. 검증 불량은 exit 1, 정상은 exit 0이다.
- Khronos 공식 `gltf-validator 2.0.0-dev.3.10`을 lockfile로 고정한다. GLB 오류·경고 모두 0이어야 한다.
- 검증 성공 보고서는 `build/geometry/verification.json`이다. 커밋하는 생산 자산은 `.parts`이며 GLB·IR·원본 증거는 Git 제외다.

### 검사 정책과 허용 오차

| 검사 | 실패 조건 / 허용 오차 |
| --- | --- |
| 입력 | 비유한 좌표·법선, 잘못된 index, 불완전/빈 삼각형 거부 |
| degenerate | 면적 < 1e-8 cm² 또는 weld된 꼭짓점 중복, 0개 요구 |
| topology weld | 좌표 1e-4 cm 격자; 부품별 검증 |
| 법선 / winding | 면과 반대 또는 수직 법선, winding conflict 모두 0 |
| non-manifold | 0개 요구, 열린 inlay도 동일 |
| watertight / outward | 닫힌 부품마다 boundary=0, manifold, 양의 부호 부피 |
| 열린 형상 | 원래 평면 inlay만 허용. 두께가 없으므로 충돌의 solid 내부는 정의하지 않음 |
| 도어 강체성 | 두 자세에서 공통으로 존재하는 부품의 역회전 편차 ≤ 1e-8 cm, 유한 값·비어 있지 않은 비교 요구 |
| GLB 위치 | 독립 cm→m oracle과 Float32 BIN 비교 ≤ 1e-6 m |
| GLB 법선 | 축 회전 후 오차 ≤ 1e-6, index/winding·부모·pivot도 검사 |
| 접촉 허용 범위 | 기존 PoC의 0.3cm 유지. 초과하면 실패. 실제 최대값도 기록 |
| 표면 수치 epsilon | 1e-7 cm. coplanar/접선 접촉은 점 포함 및 침투 깊이로 판정 |

91부품·7,573삼각형은 P2-A2 기준선이고 이번 최종 모델도 같은 수가 나왔다. 테스트는 이 수를 불변 계약으로 고정하지 않는다.
85개 닫힌 메시의 watertight는 각 부품의 성질이며 전체 차량 외피가 완성됐다는 뜻이 아니다.

### 충돌 검사 범위와 한계

- 도어 전체 범위 0~64° / 0~58°를 1° 간격, 4~7°를 추가로 0.1° 간격 검사한다. 총 FL 92 / RL 86 자세다.
- 움직이는 모든 닫힌 도어 메시와 모든 고정 닫힌 메시 64개를 검사한다. 휠·고정 힌지도 포함한다.
- 점 포함: 꼭짓점, 삼각형 중심, 간선 최대 2cm 간격의 표본, 역방향 차체 꼭짓점.
- 표면 교차: BVH/AABB로 후보를 찾고 삼각형 양쪽 간선의 segment–triangle 교차를 계산한다. 교차로 나뉜 간선 구간의 1/4·1/2·3/4 점을 내부 판정한다. 서로의 꼭짓점이 내부에 없는 crossed-slab fixture도 검출한다.
- 앞·뒷도어는 같은 열림 비율만 검사하지 않는다. 92×86=7,912개 독립 각도 조합을 비교한다. 이번 모델은 AABB가 분리돼 narrow-phase 대상 0쌍이다.
- 시간·표면 모두 표본 검사다. 연속 회전 전체, 모든 face 내부 또는 자기 교차까지 완전히 증명하는 알고리즘은 아니다.

최종 결과:

| 항목 | 결과 |
| --- | --- |
| 원래 5°/6° fixture의 침투 | 약 0.36 / 0.33cm → 수정한 inner에서 0 |
| 전체 스윕의 FL 최대 | 약 7.1e-15cm (수치 경계) |
| 전체 스윕의 RL 최대 | 약 0.159887cm, 3°의 recess–rear flare 접촉 |
| 기존 0.3cm 초과 | 점 포함·표면 구간·도어 상호 간섭 모두 0 |

**기하학적 침투가 완전히 0이라고 주장하지 않는다.** 약 1.6mm의 얕은 recess 접촉은 기존 허용 범위 안에 남아 있다. 제작 공차·차량 안전성 근거로 이 정책을 사용할 수 없다.

## 검증 보고서

| Gate | 상태 | 명령 / 근거 |
| --- | --- | --- |
| 기준 결함 재현 | PASS | 수정 전 모델 회귀 exit 1, 기존 exporter는 충돌이 있어도 exit 0 기록 |
| Node 자동 테스트 | PASS | `npm test --prefix tools/anatomy-car`, 34 tests / 실패·skip 0 |
| 실패 프로세스 검증 | PASS | 9개 CLI 오류 fixture에서 exit 1 확인 |
| Anatomy audit | PASS | `npm run build --prefix tools/anatomy-car`, audit passed |
| GLB / 스윕 | PASS | `npm run verify --prefix tools/anatomy-car`, exit 0, Khronos errors=0/warnings=0 |
| core / app 합성 테스트 | PASS | 새 실행 XML: core 24, app 19, 실패·오류·skip 0 |
| Android debug / lint | PASS | assembleDebug, lintDebug 성공; debug assets 갱신 후 APK 재생성 |
| release 경계 | PASS | processReleaseMainManifest에서 Lab Activity / INTERNET 없음 |
| Workflow 정적 검사 | PASS | 공식 checksum 확인한 actionlint 1.7.12로 신규 Geometry·기존 JVM workflow 검사 |
| SVG 화면 / 선 끝 | PASS | 4 조합×2 테마×1×/4× 캡처; 8개 페이지 line ends 0; 직접 검토 |
| Three.js 브라우저 | PASS | 정면/후면/좌/우·SVG 카메라·두 도어 열림·RL 0/5/5.5/6/15/30/58° 캡처·검토 |
| AVD 정적 SVG | PASS | MOCK CLOSED / FRONT_LEFT OPEN의 네이티브 화면·SVG 4개 상태 ID, 기존 STALE 표시 확인 |
| AVD WebGL Lab | PASS | WebGL2, 91개 메시 로드, RL 5.5° 프레임, context loss/restore 후 재그리기 확인 |

자동 테스트는 실제 불량 메시, 입력 불량, 강체성 불량, GLB 단위/BIN 좌표 변조, flush 접촉과 무꼭짓점 교차, 비대칭 좌표 oracle, 원래 결함 fixture, 최종 모델 스윕을 포함한다.
브라우저 확인 중 resize가 정면/좌측 등의 선택을 SVG 시점으로 되돌리는 debug 결함을 발견했다. resize는 frustum만 갱신하도록 고쳤고, 캡처 후 실제 카메라 방향을 검사해 회귀를 방지했다.

AVD Lab 최초 실행은 컨트롤만 보이고 모델이 비어 있었다. CDP의 security 오류가 import-map CSP 해시 불일치를 명시했고 `window.__lab`은 undefined였다.
Windows checkout의 CRLF 원문을 hash했지만 HTML 파서는 LF로 정규화하기 때문이었다. `prepareLabHtml`에서 문서를 LF로 정규화한 뒤 같은 내용으로 CSP를 계산한다.
LF/CRLF 회귀 테스트와 실제 AVD 재실행으로 모델 로드·WebGL2·복구를 확인했다. CSP를 완화하거나 메인 WebView의 JS를 켜지 않았다. favicon 요청의 차단 404는 그대로다.
초기 AVD cold launch는 timeout을 반환했으나 이후 실제 화면과 DOM을 확인했다. 최초 2초 대기만으로 촬영한 navigation 화면은 앱 검증 증거로 사용하지 않았다.
일부 4× 캡처는 100ms 대기로 paint가 완성되지 않아 폐기했고, 도구의 대기를 2000ms로 바꾸어 다시 촬영·검토했다.

GitHub 실행 결과는 게시된 PR의 Checks를 기준으로 확인한다. 위 표는 로컬 새 실행의 결과이며 CI 실행으로 대체한 것이 아니다.
최초 게시에서 job-level env에 `runner.temp`를 사용해 workflow 등록이 실패했다. actionlint가 해당 위치에서 runner context를 사용할 수 없음을 재현했다.
runner step에서 `RUNNER_TEMP`로 경로를 정하고 `GITHUB_ENV`로 후속 step에 전달하도록 수정했다. 실패한 실행 기록을 숨기지 않는다.

## CI와 후속 과제

기존 `jvm-ci.yml`은 변경하지 않는다. 별도 `geometry-ci.yml`은 Node 22.16.0 / JDK 17, 정확한 Anatomy SHA를 설치·대조하고 locked npm 의존성을 설치한다.
SVG 생성/audit → 생성 자산 diff 확인 → export → 자동 테스트 → GLB/충돌 검증 → Kotlin SVG 계약을 실행한다. pin 우회 옵션은 사용하지 않는다.
PR #2 Android CI는 미병합으로 유지한다. 17개 기대값과 과거 요약을 별도 과제에서 갱신해야 한다.

360° 모델의 우측·후면·하부 누락, 캐빈 창 개구부, smooth 타이어 일치, 실제 Pleos 하드웨어 성능, 제품 WebGL 보안/fallback은 P2-A2 잔여 과제다.
STALE 정책, SDK 오류 경로 런타임, Service 측 release 완료도 별도 과제다. 실차·성능 비교는 NOT_RUN이다.
원본 로그/캡처/측정값은 [증거 인덱스](evidence/p2-a21/2026-10-31-codex/README.md)에 구분한다. PR을 자동 병합하지 않는다.
