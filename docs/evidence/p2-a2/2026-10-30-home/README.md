# P2-A2 증거 — 3D geometry PoC, 집 PC, 2026-10-30

이 README만 Git에 포함합니다. GLB·IR·검사 보고서, 3D 캡처, AVD 캡처, logcat은 집 PC 로컬에 보존했습니다.

## 생성
- Anatomy `1482e84`. `node tools/anatomy-car/build.mjs --audit`: `audit passed`, SVG 자산 SHA-256 `13d2d0d9…a032` 불변
- `node tools/anatomy-car/geometry-export/export.mjs`
  - `car.glb` 706KB
  - 91 부품, 7,573 삼각형
  - degenerate 0, 뒤집힌 법선 0, winding 충돌 0
  - 닫힌 메시 85/85 watertight·바깥 방향
- 도어 강체성: 최대 오차 2.6e-14 / 3.2e-14 cm
- 스윕 충돌: REAR_LEFT 5°, 6°에서 `body.flare-rear`의 점 (−92.9, 90~91.3, 37.9)이 도어 안쪽 구조로 0.36 / 0.33 침투. 그 밖은 0

## 브라우저 (헤드리스 Chrome, Anatomy `capture.mjs` / `drive.mjs`)
- 캡처한 화면:
  - SVG 카메라: 일반 / 거울상 / 거울상 + 도어 열림
  - 자유 카메라: 닫힘·열림
  - wireframe, 법선
  - 시점 5개(뒤, 오른쪽, 위, 아래, 앞쪽 낮은 곳)
  - 부품 선택
- 선택 결과 예: `body.outer-front/0 · prism · paint · 200 triangles`
- 실험 assets를 같은 CSP 헤더로 서빙했을 때 console clean
- 측정: 로드 106ms, 프레임 16.7 / 16.9ms(중앙값 / p95), context loss·복구 후 그리기 정상, JS heap 13MB

## Pleos AVD (2.1.0, 2 vCPU / 4GB, `-gpu host`)
- 실험 화면: `adb shell am start -n io.carscope.app/.lab.WebGlLabActivity --es query 'auto=1&cam=svg'`
- WebGL2, renderer `ANGLE (Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2), OpenGL ES 3.1)`
- 기본 DPR 1.375: 로드 450ms, 회전 66.6 / 166.6ms, 도어 66.7 / 366.6ms, PSS 114.6MB
- DPR 1: 로드 429ms, 회전 50.1 / 100ms, 도어 66.7 / 116.7ms, PSS 115.1MB
- context loss → 복구: 그리기 정상
  - 첫 실행에서 복구 후 배경이 검정으로 남는 결함을 발견해 고쳤고, 재실행에서 정상임을 확인했습니다.
- ANR 0. 메인 화면(MainActivity)은 바꾸지 않았습니다.
- release 병합 manifest에 실험 Activity가 없음을 확인했습니다.
