# P3-A6 외부 증거 인덱스

2026-11-01 KST, `C:\dev\CarScope-geometry`, `feat/p3-a6-inspection-geometry`에서 새로 실행.
전용 외부 루트: `C:\CarScope-External\p3-a6-geometry\`. 다른 작업의 출력 폴더를 사용하지 않는다.

| 경로 | 내용 |
|---|---|
| `sources/2022-maintenance.pdf` | 공식 Hyundai UK 2022 설명서 읽기 전용 자료 사본 |
| `sources/page-3.png`, `page-7.png`, `page-8.png`, `page-15.png`, `page-27.png` | 실제 검토한 9-3/9-12/9-13/9-20/9-32 그림. page-28은 초기 페이지 확인 사본이며 형상 근거로 사용하지 않음 |
| `report/inspection-components.json` | 원본·축 SHA, 직접 작성한 추정 치수, 신뢰도, 361 정확 충돌 행, GLB/SVG 검증 |
| `report/inspection-0.glb`, `inspection-60.glb` | 새 공통 형상에서 생성한 Shell/프렁크/서비스 sidecar, 원본 차량 메시 미포함 |
| `report/svg/*.svg` | 닫힘 baseline/신규 동일성 및 열린 45°/60° 프레임 |
| `browser/actions.json`, `browser-log.txt`, `browser-results.json` | 실제 브라우저 로드·bounds·선택·출처·console 검사 |
| `browser/01-bay.png` … `09-closed.png` 및 부품 ID별 PNG | 캡처 9장: 전체, 보닛 숨김 top, side, 덮개 열림, 네 부품 선택, 닫힘 |
| `regression/gates.json`, `*.txt` | 기존 자산/Anatomy/Geometry/core/Shell/프렁크/워셔액 새 실행의 명령·상태·원본 로그 |
| `regression/unchanged.json` | 원본 GLB와 기본 정적 parts의 실행 전후 SHA 비교 |
| `regression/frunk/`, `front-compartment/`, `service-components/` | 각 기존 보고서 전체 새 실행 결과와 SVG·sidecar |

원본 GLB: `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb` (읽기만 함).
원본 Blender: `C:\CarScope-External\openx-assets\src\vehicles\hyundai_ioniq_5_2022\hyundai_ioniq_5_2022.blend` (읽기만 함).
모든 원본·생성 파일·캡처·로그는 로컬에 유지하며 커밋하지 않는다.

검증 범위와 재실행 명령은 [P3-A6 보고서](../../p3-a6-inspection-geometry.md)에 있다. 실차·Android·AR·성능 실행 증거가 아니다.
