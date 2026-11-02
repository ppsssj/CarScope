# P4-A3 외부 증거 인덱스

2026-11-02. 원본 모델·PDF·AAR/JAR·로그·파생 GLB/SVG·PNG는 Git 밖에 보관한다.
로컬 루트 `C:\CarScope-External\ev-charge-port\`. [Geometry/Gate 보고서](../../p4-a3-ev-charge-port-geometry.md).

| 외부 경로 | 근거 / 판정 |
|---|---|
| `20261102-research/ioniq5-2022-uk.pdf`, `manual-hits.txt`, `manual-31.png` | 공식 UK 2022 PDF 원문, 인쇄 1-27의 덮개·개방 그림 직접 확인. 정밀 힌지축 미확인 |
| `20261102-research/classes.jar`, `EvBattery.javap.txt`, `EvBatteryImpl.javap.txt` | 실제 AAR 2.3.2의 공개 메서드·권한·WARNING deprecation·권고 Google property 참조 |
| `20261102-research/read-callback.javap.txt`, `listener.txt`, `access-type.txt` | nullable Boolean 전달·문자열 변환, listener, Capability access enum. 실제 SDK 실행 아님 |
| `20261102-research/hierarchy.json`, `body-candidates.json`, `body-components.json`, `components.mjs` | 101 node / 44 mesh, Body 후보 면 index·재질·연결 성분 조사. 원본 파생 자료 |
| `20261102-research/rear-right.png`, `candidate-close.png`, `candidate-wire.png`, `browser.log` | 원본 GLB Chrome 사전 조사, console clean. 재사용 가능한 전용 덮개 경계 미식별 |
| `20261102-run01/tests.log` | 초기 전용 테스트 6/6 PASS |
| `20261102-run01/browser/`, `report/` | 초기 추정 배치와 렌더링. 투영상 램프 영역과 겹쳐 보여 배치를 보정함. 최종 근거와 구분 |
| `20261102-final/report.log` | 최종 배치의 전체 충돌·거리·support·GLB 검증 결과 |
| `20261102-final/report/ev-charge-port.json` | 전체 원본 hierarchy·mesh hash, runtime 정렬, per-part/combined bounds, metadata, 10개 검사·부품 간 검사 |
| `20261102-final/report/ev-charge-port.glb` | 독립 sidecar, SHA-256 `aada90552d594ee523af70abc3116e77a0d2639ea7607146f40054dbf7d13f23` |
| `20261102-final/report/ev-charge-port.svg` | 동일 triangles, SHA-256 `9b0d642169daf12b47c4f5b771dc3ef466f8fed899054c77047f02472fccdf46` |
| `20261102-final/charge-tests.log`, `all-ioniq-tests.log` | 최종 전용 6/6, 전체 68 PASS / 원본 Blend 선택 case 1 SKIP / 0 FAIL |
| `20261102-final/browser/` | Chrome actions·결과·원본 transform/카메라 복원·선택 로그, 캡처 7장, console clean |
| `20261102-final/svg-actions.json`, `svg-browser.log`, `svg-review.png` | 공통 triangles SVG를 Chrome에서 별도로 렌더링·직접 검토, console clean |
| `20261102-final/authoring-history.txt` | 중간 배치 실패의 세션 도구 출력 요약. 중간 원본 TAP는 최종 재실행에 덮어써져 별도 보존되지 않았음을 명시 |
| `20261102-run01/anatomy-build.log`, `anatomy-tests.log` | pinned Anatomy audit PASS, 기존 테스트 58/58 PASS, parts 출력 불변 |
| `20261102-run01/anatomy-export.log`, `anatomy-verify.log` | 기존 91 parts / 7,573 triangles 회귀, Khronos 0/0 PASS |
| `20261102-run01/core-tests.log` | core JVM 37 PASS / 선택 외부 시각 자산 1 SKIP / 0 FAIL |

중간의 낮은 배치가 최소 간격 검사에 실패한 이력은 최종 결과와 섞지 않는다. 최종 테스트에서 기준을 낮추지 않고 배치를 보정했다. OEM 검증이나 실차 안전 여유를 의미하지 않는다.

원본 GLB: `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb`, SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1` 불변.
AAR SHA-256 `e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937`.

SDK capability/read/cache/listener·대체 Android property·AVD/실차는 NOT_RUN. 정밀 OEM 치수·힌지·시장별 소켓은 미검증이다. CI는 PR의 해당 HEAD checks를 참고하며 실제 외부 GLB·Chrome 결과와 구분한다. 이 로컬 경로는 다른 PC에서 자동 접근할 수 있는 공유 링크가 아니다.
