# P4-B3 검증 증거 인덱스

기준 origin/main `28c11bb7e9a373b6ba64f2b32b468ea84f4f2c43`, B3a branch `feat/p4-b3-charge-port-integration`, 별도 요청 worktree. 원본 SDK·GLB·캡처·로그·APK는 Git 밖 `C:/CarScope-External/p4-b3/`에만 둔다.

| Gate | 결과 | 근거 |
| --- | --- | --- |
| 실제 SDK 2.3.2 AAR/권한/deprecation | PASS | `python tools/component-probe/check.py sdk-audit --out C:/CarScope-External/p4-b3/sdk-audit`, 고정 AAR SHA e11fdfe498cad3ecc0d5a2a6992b0c4a4d135195f1455018127bc069fd5ef937. 충전구 4개 공개 메서드/Boolean listener/RequiresPermission/3개 WARNING 검사 |
| Node | PASS 56/56 | `npm test --prefix tools/three-poc`, 새 충전구 계약·lifecycle 7개, 기존 49개 유지 |
| Debug 자산 | PASS 1/1 | `npm run test:android-assets --prefix tools/three-poc`, 새 독립 consumer 포함, 원본 자산 byte 동일성 |
| Kotlin/Robolectric/Release 경계 | PASS 26/26 | 기존 Component 20개 + charge 6개, 실제 Activity stop/resume/recreation 및 WebView cache GET 포함. Debug/Release APK·AAB·lint·권한 검사 PASS |
| Kotlin MOCK → JS | PASS | 실제 serializer의 `ev-charge-ui-v1.json`, 기존 네 Feature 및 Tire도 함께 독립 검증. CI의 EV_CHARGE_UI_SYNTHETIC_JSON 줄을 외부 native-charge.json으로 추출 |
| 실제 GLB/UI/기존 패널 회귀 | B3b 예정 | B3a는 Native 계약과 consumer만 제공 |
| AVD/adb/실차 UID grant·capability·getter·listener/병행 Service 정리 | NOT_RUN | 실행하지 않음. 정적 permission 선언이나 합성 성공으로 승격하지 않음 |

공통 파일 변경 범위: Component enum/cache projection·typed SDK adapter, DebugWebScreen의 고정 endpoint 및 InspectionActivity의 같은 channel provider 연결, 기존 JS store/client의 기본값을 보존하는 validator/endpoint 주입, Debug asset 복사 및 기존 CI 검사 도구. Geometry/GLB/vehicle-core/Sync/Release 정책·A worktree/PR #41 변경 없음. 기존 SDK session을 재사용해 client 수를 늘리지 않는다.

PR [#48](https://github.com/ppsssj/CarScope/pull/48), 구현 SHA `f57dc56` 전체 CI PASS: [Android/Kotlin/권한](https://github.com/ppsssj/CarScope/actions/runs/41444921166), [Geometry/Node](https://github.com/ppsssj/CarScope/actions/runs/41444921026), [JVM](https://github.com/ppsssj/CarScope/actions/runs/41444921007), [Sync 양 OS](https://github.com/ppsssj/CarScope/actions/runs/41444921163), [Tire](https://github.com/ppsssj/CarScope/actions/runs/41444921077), GitGuardian. 증거 문서만 갱신한 최종 HEAD 결과는 PR checks에서 확인한다. B3b의 UI 검증은 별도 보고서로 분리한다. 자동 병합 없음.
