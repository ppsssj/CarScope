# P4-B1 검증 증거 인덱스

기준 main `846df27`, branch `feat/p4-b1-pleos-component-data`. Windows/Node 22.16.0/JDK 17, SDK 2.3.2 정적 대조. 원본 SDK·javap·GLB·캡처·로그·APK·개인 설정은 Git에 넣지 않는다.

| Gate | 현재 결과 | 범위/근거 |
| --- | --- | --- |
| public AAR audit | PASS | `python tools/component-probe/check.py sdk-audit --out C:/CarScope-External/p4-b1/sdk-audit/repro`. AAR hash/14개 Safety·EV 메서드/permission/반환 타입, Light·Wiper 인벤토리 |
| JS 전체 | PASS 46/46 | `npm test --prefix tools/three-poc`, 새 component 7개 + 기존 39개 |
| Android 자산 패키징 | PASS 1/1 | `npm run test:android-assets --prefix tools/three-poc`, component-status 포함 모든 상대 import/바이트 동일성, GLB 제외 |
| Component Kotlin/Robolectric | PASS 20/20 | controller 14 + projection/SDK mapping 4 + WebView boundary 2, SDK 타입 실제 compile 포함 |
| Native→JS golden | PASS | 실제 Kotlin serializer의 합성 MOCK 4행을 독립 JS consumer가 검증 |
| 실제 GLB Chrome status | PASS 10 assertions | `browser-visible/results.json`, 1600×1000. 권한 거부, invalid packet, replay, resume/dispose 및 선택/카메라/기록 보존. 캡처 직접 확인 |
| 기존 제품 Chrome 회귀 | PASS 17 assertions | `product-browser-configured/results.json`, 실제 GLB + Android shell JS desktop simulation |
| 기존 Tire Chrome 회귀 | PENDING | Kotlin 합성 golden을 CI에서 내보낸 뒤 실행 |
| Debug/Release APK/AAB·권한·lint | PASS | component package/assets 및 CAR_ENERGY Debug 전용. Release 권한 유지 |
| 전체 CI | PASS at f47107b | [Android/identity](https://github.com/ppsssj/CarScope/actions/runs/41437610332), Geometry 41437610383, JVM 41437610367, Sync 양 OS 41437610326, Tire 41437610321. 최종 HEAD는 PR checks 확인 |
| AVD/adb/실차 Safety·EV·병행 SDK client | NOT_RUN | 사용자 지침에 따라 실행하지 않음. 합성/정적 결과로 승격하지 않음 |

원본 위치: `C:/CarScope-External/p4-b1/sdk-audit/`, 이후 `C:/CarScope-External/p4-b1/browser/` 및 각 회귀 하위 디렉터리. 테스트의 `source=MOCK`는 합성 fixture다. Native adapter 단위 테스트에서 사용한 `source=PLEOS`도 fake SDK callback 입력 검증일 뿐 실제 차량 관측이 아니다.

PR #41 및 다른 작업 사본 변경 없음. geometry/GLB/Anatomy/core/Sync 코드 수정 없음. UI 연결은 기존 두 부품 상세의 독립 상태 영역에만 적용하고 EV 모델은 만들지 않았다. 자동 병합 없음.

실패 이력: 최초 제품 브라우저 실행은 QR 환경변수가 없는 서버를 사용하여 handoff 버튼을 찾지 못했다 (`product-browser/`). `CARSCOPE_QR_AR_BASE_URL=https://mobile.example.test`로 자체 loopback 서버를 시작한 뒤 같은 기존 스크립트가 통과했다. 실제 모바일 연결은 하지 않았다. 초기 캡처에서 summary 라벨의 `?` 문자를 발견하여 한국어로 수정하고 패널을 펼친 캡처까지 재검증했다.

작업 도중 A의 모델 PR #44가 main `5c06646`에 병합되어 충돌 없이 반영했다. A의 파일을 수정하지 않았다. EV 선택/UI는 모델 병합 후 별도 후속 PR로 연결한다.
