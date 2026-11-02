# P4-B2 검증 증거 인덱스

기반: B의 PR #45 `3b6d36e` + A의 병합된 모델 PR #44 `5c06646`. Worktree `C:/dev/CarScope-pleos-ev-ui`, branch `feat/p4-b2-ev-status-ui`. 원본 GLB/캡처/로그/SDK/APK는 Git 밖에 보관한다.

| Gate | 결과 | 근거/범위 |
| --- | --- | --- |
| Node 상태/계약/레이스 회귀 | PASS 49/49 | `npm test --prefix tools/three-poc`, EV 3개 추가 |
| Debug 자산 패키징 | PASS 1/1 | `npm run test:android-assets --prefix tools/three-poc`, A의 builder/모든 상대 import/원본 바이트 일치 |
| 실제 GLB + Kotlin MOCK EV Chrome | PASS | `browser-routed/results.json` 1600×1000, `browser-portrait/results.json` 900×1200, 각각 8 assertions. 모델 metadata 동일성, 실제 mesh ray hit, raw SoC/스위치, pause/resume, Back/summary/exit. 캡처 직접 확인 |
| 기존 제품 Chrome 회귀 | PASS 17 assertions | `product-browser-routed/results.json`, QR handoff configured, Android shell JS desktop simulation 포함 |
| SDK/Kotlin/Robolectric/APK/권한 | PASS on base | PR #45 [Android CI](https://github.com/ppsssj/CarScope/actions/runs/41439046278), 이 PR은 Kotlin/manifest/Release를 수정하지 않음. 이 PR 최종 결과는 PR checks 확인 |
| 최종 CI | PENDING | PR 생성 후 모든 job 확인 |
| AVD/adb/실차/실제 SoC 단위·capability·권한 | NOT_RUN | 사용자 지침에 따라 실행하지 않았고 합성 결과로 승격하지 않음 |

실패 이력: 최초 브라우저 `browser/`는 신규 builder의 desktop 서버 route가 없어서 초기화하지 못했다. `/ioniq5-asset/ev-battery.mjs` 단일 허용 경로를 추가했다. 기존 장기 실행 서버도 route 이전 버전이어서 제품 회귀 `product-browser/`가 실패했다. 이 작업이 시작한 서버만 재시작한 뒤 두 시나리오 모두 통과했다. A의 서버·AVD·다른 실행 프로세스를 종료하지 않았다.

재현 (Golden은 PR #45 실제 Kotlin serializer가 출력한 합성 MOCK JSON):

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
node tools/three-poc/check-ev-status.mjs C:/CarScope-External/p4-b2/browser-routed C:/CarScope-External/p4-b1/native-contract.json
node tools/three-poc/check-ev-status.mjs C:/CarScope-External/p4-b2/browser-portrait C:/CarScope-External/p4-b1/native-contract.json 900 1200
```

UI 스크립트는 loopback 임시 port의 자체 자식만 종료한다. PR #41 및 다른 worktree 보존. Geometry/모델/좌표/GLB·Sync·Tire SDK·Release 정책 변경 없음. 자동 병합 없음.
