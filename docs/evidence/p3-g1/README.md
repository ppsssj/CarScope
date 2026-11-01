# P3-G1 증거 인덱스

원본 저장 위치: `C:\CarScope-External\p3-g1-tire`. 이 PC의 로컬 증거이며 원본 GLB/Blender·로그·캡처·APK/AAB를 Git에 포함하지 않는다. [보고서](../../p3-g1-tire-geometry.md).

| 상대 경로 | 내용 |
|---|---|
| `source-analysis.json` | 원본 hash, GLB hierarchy/material primitive 원시 조사 |
| `mapping/tire-mapping.json` | 실제 GLTFLoader mapping, 고무/assembly Bounds, 전후 anchor |
| `final-wide-v5/` | 1600×1000 실제 목록/3D 클릭·드래그·강조·복원, 선택 중 420×860/1024×600 viewport 변경, 캡처/결과/actions/log |
| `final-portrait-v5/` | 420×860 실제 브라우저 조작, 네 타이어별 캡처와 결과 |
| `final-landscape-v5/` | 1024×600 실제 브라우저 조작, 네 타이어별 캡처와 결과 |
| 위 세 폴더의 `01-tire-list.png`, `tire.*.png`, `06-exit.png` | 목록, 각 위치의 고무만 강조, 선택 종료 |
| `final-wide-v5/resize-*.png` | 실제 child viewport 변경 후 선택 유지 |
| `regression-components/`, `components-portrait/` | 기존 4개 부품·시점 복원·LCW·종료 회귀 캡처/결과 |
| `washer-wide/` | 기존 보닛 애니메이션·취소·워셔액 QR·연속 입력 회귀 |
| `baseline-ui.log`, `unit-ui-final.log`, `ioniq-regression.log` | 기존 기준 및 Node tests |
| `anatomy-audit.log`, `anatomy-export.log`, `anatomy-tests.log`, `anatomy-verify.log` | pinned audit·SVG·mesh·GLB/좌표·강체성·sampled collision 회귀 |
| `collision/`, `component-collision.log` | 기존 361개 점검 부품 exact triangle 검사 및 GLB/SVG 회귀 |
| `android.log`, `core-only.log`, `final-apk.log`, `packaging-release-check.log` | Kotlin 테스트, Debug/Release 빌드·lint, 최종 Debug 자산 재패키징 |
| `avd-health/health.json` | fresh gate BLOCKED: emulator-5554 없음, GUI 미실행 |
| `verification.json` | 최종 결과·artifact/source hash 인덱스 |

초기 `final-portrait/`의 목록 camera framing 실패와 `final-*-v4/`의 highlight 진단 hook 오류는 최종 PASS와 분리해 보존한다. 중간 `browser-wide`, `fixed-portrait`, `final-*-v2/v3`도 최종 결과를 대체하지 않는다.

실제 Pleos AVD/실기기 GUI, 실차 형상 정확도, 실제 Tire capability·값·이벤트·단위의 이번 증거는 **없다**. 데스크톱 Chrome의 모바일 viewport 검증을 실기기 검증으로 표시하지 않는다.
