# P4-A2 Geometry 증거 인덱스

2026-11-02, Windows / Node 22.16.0. 원본 로그·캡처·GLB·SVG는 Git 밖에 보관한다. [검증 문서](../../p4-a2-ev-battery-geometry.md).

로컬 증거 루트: `C:\CarScope-External\ev-battery\`.

| 경로 | 증거 / 판정 |
|---|---|
| `20261102-run01/battery-tests.log` | 새 Node 테스트 5/5 PASS, 실제 GLB 포함 |
| `20261102-run01/all-ioniq-tests.log` | IONIQ 62 pass / 1 optional Blend skip / 0 fail |
| `20261102-run01/report/ev-battery.json` | 원본 44개 메시 inventory·bounds·정점 SHA, 원본 SHA, pack metadata, 교차 0 및 AABB 분리, Khronos 0/0, 변환 오차 |
| `20261102-run01/report/ev-battery.glb` | 신규 팩만 포함하는 sidecar, SHA-256 `4f2bb9da8cfd4333895c2443c412abeee5bf3210921d7f6e96ce458e23d4e99d` |
| `20261102-run01/report/ev-battery.svg` | 동일 triangles의 정적 SVG, SHA-256 `94830a4552895f0c46e3911b5c23aca1c148f74a4f7f7029588d15c9d0a791f6` |
| `20261102-run01/anatomy-build.log` | pinned Anatomy audit PASS, 원래 parts 내용 불변 |
| `20261102-run01/anatomy-tests.log` | 기존 형상 58/58 PASS |
| `20261102-run01/anatomy-export.log`, `anatomy-verify.log` | 기존 GLB/좌표/강체/샘플 충돌 회귀 PASS: 91 parts / 7,573 triangles, Khronos 0/0 |
| `20261102-run01/core-tests.log` | core JVM 37 pass / 1 optional external-visual skip / 0 fail |
| `20261102-run01/browser/` | 최초 FAIL: name 기반 탐색 실패. preload/debug 로그로 GLTFLoader 이름 정규화 확인 |
| `20261102-run02/browser/` | metadata 기반 수정 후 PASS. 이후 카메라를 뒤로 이동하여 전체 차체가 화면에 들어오도록 보정 |
| `20261102-final/browser/` | 최종 PASS: actions.json, browser-log.txt, browser-results.json, 차량/하부/배치/팩/선택/복원 캡처 6장, console clean |

원본 외부 GLB는 `C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb`, SHA-256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`로 유지했다. 원본 보닛·바퀴를 재작성하지 않았다. 로컬 경로는 다른 PC에서 자동 접근할 수 있는 공유 링크가 아니다.

SDK는 기존 정적 조사만 참조했다. 실제 SDK·Android WebView·AVD·실차 검증은 NOT_RUN이며, OEM 팩 치수·장착·정비·안전 검증은 미완료다. 합성 CI 결과와 로컬 실제 GLB/Chrome 결과를 혼합하지 않는다.
