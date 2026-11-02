# P4-B3b 검증 증거 인덱스

기준 main `28c11bb` + B3a #48, worktree `C:/dev/CarScope-charge-port-ui`, branch `feat/p4-b3-charge-port-ui`. 외부 증거 `C:/CarScope-External/p4-b3/`, GLB/SDK/캡처/로그/APK는 Git에 넣지 않는다.

| Gate | 결과 | 근거 |
| --- | --- | --- |
| Node 상태/계약/좌표/실패 경로 | PASS 60/60 | `npm test --prefix tools/three-poc`, B3a 56개 + source world/실패 차단/제품 상태 4개 |
| Debug asset packaging | PASS 1/1 | `npm run test:android-assets --prefix tools/three-poc`, 두 새 consumer/model adapter와 원본 A builder import/바이트 동일성 |
| 실제 GLB Chrome + 실제 Kotlin MOCK | PASS 14 assertions × 2 | `browser-fit/results.json` 1600×1000, `browser-portrait-fit/results.json` 900×1200. source 무변경, 각각 canvas 클릭/강조, rear-right camera, SDK true 시 정적 pose, invalid UNKNOWN, pause/resume, 차체 차폐·실제 canvas 클릭, Back/summary/exit. 주요 캡처 직접 확인 |
| Safety/EV 패널 회귀 | PASS 10/8 assertions | `safety-browser-final/results.json`, `ev-browser-final/results.json`. 전체 보기 카메라 수정 후 다시 실행 |
| Tire/제품 흐름 회귀 | 실행 후 최종 결과는 PR 본문 | 최초 수정 전 각각 14/17 PASS, 전체 보기 카메라 수정 후 final 하위 폴더에서 재실행 |
| Native/Debug·Release | PASS on B3a | [#48 Android CI](https://github.com/ppsssj/CarScope/actions/runs/41444921166), Component/charge 26개, 권한·APK/AAB·실제 Activity lifecycle |
| 최종 전체 CI | PR workflow_dispatch | 선행 브랜치 대상 PR이라 main 전용 자동 trigger가 없음. 동일한 5개 workflow를 최종 HEAD에서 수동 실행하고 SHA/run 링크는 PR 본문에 기록 |
| AVD/adb/실차 UID grant·capability·getter·listener·Service 병행 실측 | NOT_RUN | 실행하지 않았고 합성/정적 결과로 승격하지 않음 |

실패 보존: `browser-portrait/`, `browser-portrait-diagnose/`는 전체 보기의 충전구 투영점이 y=-27.56px로 화면 밖이어서 실제 canvas 차폐 검사에 실패했다. 첫 가로 통과 결과로 이를 감추지 않았다. 실제 GLB AABB에 기존 boxDistance를 적용한 뒤 같은 강화 검사와 실제 클릭이 가로·세로 모두 통과했다. 원본 Geometry/transform이나 기준을 변경하지 않았다.

자체 loopback 서버만 생성·종료한다. PR #41/A worktree/기존 서버·AVD 보존. 자동 병합 없음.
