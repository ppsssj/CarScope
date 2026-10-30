# CarScope 작업 지침

## 문맥과 작업 범위
- 시작할 때 저장소 경로, `git status`, 브랜치/HEAD, remote와 기준 main을 확인한다. 서로 다른 작업 사본을 혼동하지 않는다.
- 기존 변경을 보존한다. `reset --hard`, `git clean`, force push를 하지 않는다.
- 구조·상태 계약은 [architecture](docs/architecture.md), 단계와 잔여 조건은 [roadmap](docs/roadmap.md)을 따른다.
- 환경과 재실행은 [development-setup](docs/development-setup.md), 기존 실행 근거는 [validation-report](docs/validation-report.md)를 확인한다.
- 읽기 전용 요청에서는 파일 생성·빌드·자산 생성·브랜치 변경도 하지 않는다.

## Pleos 데이터 계약
- [SDK 연동 기록](docs/pleos-sdk-integration.md)과 [STALE 검토](docs/stale-policy-review.md)를 읽고 해당 범위의 검증된 API만 사용한다.
- `vehicle-core`는 Android/Pleos SDK에 의존하지 않는다. SDK는 app 경계에 둔다.
- 현재 SDK는 2.3.2, 읽기 전용 `ROW_1_LEFT → FRONT_LEFT`이다. 미구현 영역은 UNSUPPORTED이다.
- null/unknown/오류를 CLOSED로 바꾸거나 실패를 자동 MOCK 전환으로 감추지 않는다. 데이터 출처를 보존한다.
- 관측 시각을 화면 갱신 시각으로 덮어쓰지 않는다. STALE 5000ms 정책은 별도 승인된 과제 없이 변경하지 않는다.

## Anatomy·SVG·GLB
- [Anatomy 통합](docs/anatomy-visualization.md)과 [3D PoC](docs/p2-a2-geometry-poc.md)를 확인한다.
- Anatomy는 `1482e84` (전체 SHA `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`)를 유지한다. 원본을 수정하거나 `--any-anatomy`로 우회하지 않는다.
- 차량 세계 좌표는 cm, +X 전방 / +Y 차량 좌측 / +Z 위이다. DoorId 교환이나 임의 세계 y 반전으로 화면 문제를 감추지 않는다.
- glTF는 m, `(x,y,z) → (x,z,-y)/100`이다. 방향·법선은 단위 변환 없이 회전한다.
- 공통 모델에서 SVG와 GLB를 생성한다. SVG path에서 3D를 역추정하지 않는다.
- 생성 자산은 생성기로 갱신한다. 카메라·투영 변경은 가시면·음영·순서·accent·inset·bounds와 함께 검증한다.
- 메인 화면은 정적 SVG/JS 비활성이다. Three.js/WebGL Lab은 debug 실험이며 release 포함 여부를 구분한다.

## 검증과 PR
- 모든 변경에 재현 가능한 테스트를 남긴다. 실행 명령은 저장소의 task·스크립트·문서에서 확인한다.
- core 기본 검증: `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain`.
- 형상 변경은 Anatomy audit, SVG 계약, 메시/GLB/좌표/강체성/충돌 검사를 실행하고 실제 화면을 확인한다.
- 샘플링 검사를 연속 회전 전체의 완전한 무충돌 증명이라고 주장하지 않는다. 임계값 상향이나 검사 대상 제외로 통과시키지 않는다.
- 기존 산출물과 새 실행을 구분한다. PASS/FAIL/NOT_RUN/BLOCKED와 환경·명령·근거를 기록한다.
- CI 성공은 해당 job의 범위에 한정한다. 브라우저·AVD·실차 결과와 성능 수치를 섞지 않는다.
- 원본 캡처·로그·SDK·APK·개인 설정·인증 정보·서명 키는 Git에 넣지 않는다. 공유 문서는 증거 인덱스를 사용한다.
- 사용자 허락 없이 PR을 병합하지 않는다. 기존 미병합 PR을 작업 범위에 임의 포함하지 않는다.
