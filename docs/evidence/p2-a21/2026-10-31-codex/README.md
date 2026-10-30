# P2-A2.1 증거 인덱스 — 2026-10-31, Codex

이 README만 Git에 포함한다. 원본은 작업 저장소의 `.tools/p2-a21/`, `tools/anatomy-car/build/`, `tools/three-poc/build/`, 모듈별 `build/`에 보존했다.
기준 main `40f97790ee32d10f183028193c2b49dc861849ec`. [설계·원인·정책·검증 보고서](../../../p2-a21-geometry-correctness.md)

## 새 실행

| 항목 | 결과 | 원본 |
| --- | --- | --- |
| 기준 audit/export | audit PASS, exporter exit 0에도 RL 5°/6° 충돌 존재 | `baseline-audit.log`, `baseline-export.log`, `before/` |
| 수정 전 실패 테스트 | FAIL / exit 1 (예상한 재현) | `red-collision.log`, `red-sweep.json` |
| Anatomy audit | PASS / 전체 pin 일치·외부 tracked 변경 없음 | `audit-final.log` |
| Node 테스트 | 34 PASS, 9개 불량 CLI가 exit 1 및 stale PASS 제거 | `node-final.log` |
| GLB / sampled sweep | PASS / 공식 validator 오류·경고 0, 0.3cm 초과 0 | `verify-final.log`, `build/geometry/verification.json` |
| Android tests/build | core 24 + app 19 / 실패·오류·skip 0, debug APK 및 release manifest 성공 | `android-final.log`, JUnit XML |
| Android lint | PASS | `android-first.log`, `app/build/reports/lint-results-debug.html` |
| CSP 수정 후 APK | PASS / debug assets 포함 재생성·AVD install -r 성공 | `lab-csp-build.log` |

최종 `.parts` SHA-256: `a6f19a53bf6b6453a2255a67de1ab15b976e68b07facf0e4a527558a3d7c2197`.
GLB SHA-256: `5c1bb7cfe0daeae700d3b857423d06d8a0a05042bb092a8e12786bf336709f00`.
실행 APK SHA-256: `ddbba04bfce8ca7a5e2c5373d2d99804bd4cef42a84477853545d153c2a84bb9`.
생성물은 재생성·해시 대조를 하고, APK는 PC별 debug 서명 차이를 고려한다.

## 브라우저와 화면 비교

Chrome, Windows, Node 22.16.0, JDK 17. 원본 PNG를 직접 열어 검토했다.

- `node tools/anatomy-car/check-visuals.mjs`: 4개 도어 조합 × light/dark × 1×/4×, 8개 페이지의 line ends 0.
- `compare-svg-{light,dark}.png`, `compare-4x-{light,dark}.png`: 수정 전후 비교. `closeup-*.png`: 4× 원본에서 앞/뒤 도어·휠·유리 연결부 crop.
- `coordinate-contract.png`: 서로 다른 길이·색의 물리 FRONT/REAR/LEFT/RIGHT/UP 진단.
- `node tools/three-poc/serve.mjs`, `node tools/three-poc/check-views.mjs`: 정면/후면/좌측/우측, SVG 시점, 두 도어 열림, RL 0/5/5.5/6/15/30/58°.
- P2-A2 GLB도 같은 viewer에서 별도 로드해 비교: `three-before/`, `three-before.log`, `three-before-contact-sheet.png`, `three-contact-sheet.png`.
- 캡처 후 방향을 assertion으로 확인했다. 우측·후면·하부가 평판인 것은 원래 불완전한 360° 모델의 한계다.
- 최초 100ms 대기의 불완전한 4× paint는 사용하지 않았다. 2000ms로 다시 촬영했다.

## Pleos AVD — 실제 실행 범위

Android 14/API 34, Pleos AVD 2.1.0, 2 vCPU/4GB, WHPX, host GPU GTX 1060.
WebView `ai.pleos.android.webview 131.0.6752.0`.

- 메인: 실제 MOCK CLOSED와 FRONT_LEFT OPEN, 4개 ID·상태, accent와 inset, 기존 STALE를 확인했다.
  - `avd-closed.png`, `avd-open.png`, `avd-main2.png`, `avd-{closed,open}-states.log`.
  - 앱 로드 완료·DOM만으로 PASS하지 않고 전체 네이티브 화면도 확인했다.
- Lab: `auto=1&cam=svg&dpr=1&landmarks=1`, WebGL2 / ANGLE Emulator OpenGL ES Translator.
  - `avd-lab-fixed.png`, `avd-lab-mid.png` (RL 5.5°), `avd-lab-cdp.log`.
  - 91개 메시/7,573삼각형 로드, context loss/restored, 복구 후 중심 pixel `[71,81,91,255]`, draw calls 102.
  - 이 draw count는 바닥과 진단용 랜드마크도 포함하며 차량 부품 수와 다르다.
- 초기 Lab 실패의 원인: `lab-before-csp-cdp.log`에 import-map CSP 오류·기대 LF hash·undefined runtime 기록. 수정 후 같은 정책 제한으로 다시 실행했다.
- 초기 cold launch timeout과 navigation 화면은 실패/중간 상태로 남기고, 준비된 앱의 화면만 최종 판정에 사용했다.
- favicon 404는 앱 출처 차단 정책에 의한 것이다. 외부 요청이나 임의 script 허용을 추가하지 않았다.
- 실제 SDK 이벤트 재주입, 권한 거부·서비스 단절, 실차, 성능 비교는 NOT_RUN이다. 이번 AVD 결과를 제품 WebGL 승인이나 성능 보장으로 사용하지 않는다.

## CI

기존 JVM CI를 보존하고 별도 Geometry CI를 추가했다. 실행 SHA와 실제 결론은 PR Checks의 기록을 확인한다.
로컬 성공을 GitHub CI 성공으로 표시하지 않는다. PR #2 Android CI는 이번 작업에서 병합하지 않는다.
