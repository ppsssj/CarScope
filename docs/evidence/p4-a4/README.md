# P4-A4 외부 증거 인덱스

2026-11-02. 로컬 루트 `C:\CarScope-External\front-wiper\`. [검증·재사용 계약](../../p4-a4-front-wiper-geometry.md). 경로는 다른 PC에 자동 공유되지 않는다. 원본/파생 자산·캡처·로그·SDK는 Git 제외다.

| 외부 경로 | 내용 / 판정 |
|---|---|
| `20261102-research/model-inventory.json`, `inventory.mjs` | 실제 101 nodes / 44 meshes, 기존 partIds·source bounds·재질 조사 |
| `20261102-research/classes.jar`, `Wiper.txt`, `WiperState.txt`, `WindowArea.txt`, `WindowValue.txt`, `Light.txt`, `Light-annotations.txt`, `LightState.txt` | 실제 SDK 2.3.2 javap 정적 계약. AAR SHA `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937` |
| `20261102-research/manual-extract.txt`, `manual-267.png`, `manual-615.png` | 공식 2022 설명서 5-73 / 9-16 직접 검토. PDF 원문은 기존 `C:\CarScope-External\ev-charge-port\20261102-research\ioniq5-2022-uk.pdf`를 읽기 전용 재사용 |
| `20261102-final/wiper-tests.log`, `all-ioniq-tests.log` | 전용 7/7, 전체 75 PASS / optional Blend 1 SKIP / 0 FAIL |
| `20261102-final/report/front-wiper.json`, `report.log` | source mesh hash·부품 bounds·runtime support·22개 조명 영역 audit·77개 충돌 검사·변환 검증 |
| `20261102-final/report/front-wiper.glb` | sidecar SHA `e96fe33fa3e2af39ddd2557df184e624f0c391843ab1b3b144c12804fe9cc640` |
| `20261102-final/report/front-wiper.svg` | 공통 triangles SVG SHA `a638c86aef0e64a4f9580854f86182c55b6c3fff3c6527dc9bacce8b213381ae` |
| `20261102-final/browser/` | 최초 FAIL 및 단일/순차 클릭 진단. 좌측 선택 자체와 Raycast는 동작 |
| `20261102-final/browser-pass/` | material 미수정 상태 FAIL, diagnostic-log에서 left emissive=0·right emissive 값 확인. 폴더명은 성공 판정을 의미하지 않음 |
| `20261102-final/browser-final/` | 수정 후 전체 PASS, 좌우 독립 강조·비선택 해제·카메라 복귀·원본 transform·console clean, 캡처 7장 |
| `20261102-final/svg-actions.json`, `svg-browser.log`, `svg-review.png` | SVG Chrome 렌더링·직접 검토 PASS |
| `20261102-final/anatomy-build.log`, `anatomy-tests.log`, `anatomy-export.log`, `anatomy-verify.log` | 기존 audit, 58/58, 91 parts / 7,573 triangles, Khronos 0/0 PASS |
| `20261102-final/core-tests.log` | core JVM 37 PASS / 선택 외부 시각 자산 1 SKIP |

원본 GLB `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb`의 SHA는 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`로 유지됐다. 정밀 OEM 형상·축·와이핑·마모·조도는 미검증이다. SDK/AVD/실차는 NOT_RUN. CI는 해당 PR HEAD checks에서 확인하며 실제 GLB/Chrome 결과와 구분한다.
