# P9-XR-B 증거 인덱스

**이 기록은 제거된 독립 페이지 `/webxr/` 기준의 과거 실행이다.** 현재 코드의 결과는 [P9-XR-C 증거](../p9-xr-c/README.md)를 본다.

원본 로그와 캡처는 `C:/CarScope-External/p9-xr-b/`에 두고 Git에는 요약만 남긴다. [설계·실행·제약](../../p9-xr-b-webxr-spatial-poc.md).

## 판정 범위

- `WEBXR_POC_IMPLEMENTED`: `/webxr/` 화면 구현.
- `WEBXR_SYNTHETIC_VERIFIED`: 실제 Chrome·WebGL·Three.js·서버 CSP + 가짜 XR 런타임. 실제 카메라와 추적을 포함하지 않는다.
- `WEBXR_DEVICE_NOT_RUN`: 이 코드를 Z Flip8에서 실행하지 않았다. 사용자가 보고한 공간 고정은 WebXR 공개 샘플의 결과이며 이 코드의 증거로 쓰지 않는다.

## 새 로컬 실행 (2026-11-05)

기준 main `6077fdd5647ea709180601cb27a850e46497efa4`. 환경: Windows 10, Node 22.16.0, Chrome 156.0.8078.80, Edge 156.0.4314.58, Three 0.160.0.

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 문법 | PASS | `npm run check` |
| Node 전체 | PASS, 120건 실패 0 (기존 80 + 신규 40) | `npm test` |
| WebXR 브라우저 | PASS, 10개 그룹 | `npm run test:browser:webxr`, `run2/p9-xr-b/results.json` |
| 기존 2D 브라우저 회귀 | PASS, 5개 스위트 | `npm run test:browser`, `regression-browser.txt` |
| AR-01 단위 회귀 | PASS | `tools/inspection-sync-poc`의 `npm run test:ar01` |
| mutation 27종 | 27 KILLED / 0 SURVIVED | 임시 사본에서 조건을 하나씩 제거. 선택한 조건만 대상이며 완전성 증명이 아님 |

WebXR 브라우저 검사 내용:

- Chrome 자체 WebXR의 미지원 경로에서 이유 표시와 2D 복귀, Three.js 미다운로드.
- 가짜 카메라를 옆으로 옮겼을 때 마커의 화면 위치가 투영 계산만큼 이동(허용 오차 6px). 화면 고정 mutation은 이 검사에서 실패한다.
- 추적 손실 시 마커 숨김과 경고, 복구, 재지정, 제거, 종료 후 재시작.
- 패널 탭이 배치를 일으키지 않음. 권한 거부 등 오류별 이유와 복귀 경로.
- 앵커 미지원 라벨, 412×1007·844×390·320×640 배치.
- 저장소 사용 없음, 동일 출처 GET만 발생, CSP 위반 없음, 기본 서버에서 `/webxr/` 404.

캡처를 직접 열어 확인했다(`run2/p9-xr-b/*.png`). 3D 프레임의 회색 배경은 카메라 영상을 대신한 것이다.

## NOT_RUN

| 항목 | 이유 |
|---|---|
| Z Flip8 등 실기기의 AR 세션, Hit Test, Anchor, DOM overlay | 사용자가 접근할 페이지 준비 후 진행 |
| 실제 공간 고정 품질, 드리프트, 추적 복구 | 가짜 런타임으로 측정할 수 없음 |
| 엔진룸의 표면 검출과 표시 오차 | 실차 미실행 |
| 발열, 배터리, 프레임률 | 미측정 |
| 회전·접기·앱 전환의 실제 동작 | 실기기 필요. 화면 배치만 Desktop에서 확인 |
| iOS Safari | 미실행 |
| 공개 또는 보호된 HTTPS 배포 | 승인 전 수행하지 않음 |

## 개발 중 수정 기록

제품 판정 조건이나 임계값을 완화한 수정은 없다.

- **Node 첫 실행 FAIL (1건):** `/webxr/index.html`이 라우팅되지 않았다. 정적 호스팅과 맞추도록 서버를 고쳤다.
- **화면 검토:** 테스트는 통과했지만 시작 버튼의 강조 누락, 가로 화면에서 패널이 조준 영역을 가리는 문제, 밝은 표면에서 조준 원이 안 보일 위험을 고쳤다.
- **코드 검토:** 오버레이 루트의 `pointer-events: none`을 제거하고, bfcache 복귀 시 다시 로드하도록 했다. 모두 실기기 확인 전의 예방 조치다.
- **기존 2D 회귀 첫 실행:** 증거 폴더 경로 지정 오류로 시작 전에 종료됐다. `qr-ar-01` 아래로 지정해 다시 실행했다.

## CI

`.github/workflows/webxr-poc-ci.yml`을 추가했다. 이 job은 문법, Node, 가짜 XR 런타임 브라우저 검사만 포함하며 실기기와 실제 추적을 포함하지 않는다.
