# P2-A3-1.1 — Parametric Surface Loft MVP

## 설계 감사와 선택

기준 `main`은 PR #9 merge `0dd1f4924433c08566fe4f3e6ce2e01929bdb96c`다. `suv.hood`는 `envelope/model.mjs`에서 Y 방향으로 압출한 X/Z 다각형 프리즘이다. X 방향 상단은 분할되어 있지만 좌우 높이는 일정하다. `scene.prism`은 Anatomy recorder와 SVG `prismPaths`를 함께 기록하고 `generateGeometry`가 같은 `geo`로 GLB를 만든다. 충돌·메시 검증은 exporter의 실제 삼각형을 대상으로 한다. SVG는 카메라와 painter order를 Anatomy recorder가 결정한다.

선택지는 (1) 기존 프리즘만 더 분할, (2) SVG 전용 곡선과 별도 GLB, (3) 단면 기반 opt-in `loft`다. (1)은 좌우 복합 곡률을 만들지 못하고 (2)는 공통 geometry 계약을 어긴다. (3)을 선택한다. 입력은 동일한 Y 정렬과 같은 정점 수의 X 단면, 각 점의 상·하단 Z다. Catmull–Rom Hermite 보간을 X/Y 양쪽에 적용하되 각 구간의 입력 범위로 clamp하여 overshoot를 막는다. 외곽선 X/Y와 양 끝 Z는 기존 보닛에 맞춘다.

Loft는 indexed closed triangle mesh를 만들고 top vertex normals는 인접 기하에서 계산한다. 옆면과 바닥은 별도 flat normals를 갖는다. SVG는 바로 그 mesh의 표면 삼각형을 투영하며, Anatomy에는 실제 상부 삼각형을 얇은 prism으로 기록한다. 기록 prism의 상부 면은 mesh의 실제 top 삼각형과 일치한다. 별도 SVG path에서 3D를 역추정하지 않는다. Sedan 경로는 변경하지 않는다. 최대 centre crown 55 mm는 `DESIGN_ESTIMATE`로 프로필에 기록한다.

MVP는 평행한 Y 샘플 위치와 단일 사각 패치, 일정한 단면 topology만 지원한다. 임의 NURBS, 비정형 구멍, 자기 교차 surface, bonnet opening, 펜더/루프 Loft는 지원하지 않는다. 보닛 외측·끝점은 고정하며 중심 crown만 들어 올려 실차 외형 일치를 주장하지 않는다. Anatomy audit, watertight·법선·치수·4도어 충돌 및 실제 SVG/GLB 렌더링을 통과해야 채택한다. P2-A3-1의 보닛은 `hoodLoft:false` 비교 옵션으로 보존한다.

## 결과

재현 가능한 [Before/After SVG·GLB PNG 갤러리](visuals/p2-a3-1-1/README.md)를 Git에 포함한다. 보닛 centre crown은 기존 형상의 같은 X 지점보다 최대 약 5 cm 높으며, 전후·좌우 양방향의 실제 정점 좌표가 달라진다. 폭·길이·전체 높이는 같은 AAOS envelope를 유지한다. SVG에서는 보닛의 넓은 명암 변화, GLB에서는 약한 측면 윤곽 변화와 새 wireframe이 보인다. 차량 전체 GLB shaded view만으로는 곡률 차이가 작으므로 detail/wireframe도 함께 평가한다.

`compare-loft.mjs` 최종 코드의 한 번의 로컬 실행 관측값: Before 143 parts / 11,120 triangles / hood 28 triangles / model build 10,802.1 ms / GLB export 421.7 ms. After 143 parts / 11,340 triangles / hood 248 triangles / model build 10,020.1 ms / GLB export 248.9 ms. 이 단일 순차 실행의 시간은 캐시·OS 부하가 섞인 진단값으로, Loft가 더 빠르다는 성능 결론이 아니다. **triangle 비용은 +220 (약 2.0%)**다. 동일 환경의 반복 benchmark는 별도 과제다.

MVP의 sampled surface는 watertight/outward이며 퇴화·뒤집힌 법선·비 manifold edge가 0이다. 0.3 cm 충돌 기준은 유지한다. SUV bonnet과 fender 접합의 G1/G2 연속성, OEM 실차 외관, 전체 연속 도어 회전 무충돌은 증명하지 않는다. 펜더·루프 적용은 별도 단면 설계와 경계 continuity 검사를 추가한 뒤 가능하다.

간격을 반영한 C1 보간 실험은 recorder의 표면 지지/깊이 audit에서 실패했다. 보간 기울기를 단면 인덱스 기준 MVP로 되돌렸으며 이 실험을 PASS 근거로 사용하지 않는다. 현재 patch는 연속된 위치(C0)와 샘플 정점 법선을 제공하지만, 불균일 단면 간격의 물리적 C1 연속성은 증명하지 않는다.

| Gate | 최종 로컬 결과 |
| --- | --- |
| `npm run build --prefix tools/anatomy-car` / `npm run export --prefix tools/anatomy-car` / `npm run verify --prefix tools/anatomy-car` | PASS, Sedan SVG hash·GLB byte 회귀 유지, Khronos 0 errors/warnings |
| `npm run envelope --prefix tools/anatomy-car` | PASS, Anatomy audit 0, 143 parts / 11,340 triangles, 치수·GLB·4도어 sampled collision 검사 통과 |
| `npm test --prefix tools/anatomy-car` | PASS, 48/48, Loft 단면·인덱스·수밀성·SVG/GLB 정점 공유 검사 포함 |
| `.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | PASS, BUILD SUCCESSFUL |
| `compare-loft.mjs`, `capture-loft.mjs`, pinned Anatomy capture | PASS, 실제 SVG/GLB 8개 PNG를 열어 비교, console clean. 원본 AVD/OEM 캡처는 포함하지 않음 |
| Android AVD / 실차 / 연속회전 전구간 | NOT_RUN / UNVERIFIED |
