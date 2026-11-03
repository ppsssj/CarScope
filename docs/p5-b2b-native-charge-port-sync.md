# P5-B2B — EV 충전구 모바일 결과 Native 수신

기준 `origin/main`: `158a619218ba7ff97b5bc94945ceeda99f75d276`. PR #51~#55 모두 merged임을 GitHub에서 확인하고 fetch한 main에 각 merge commit이 포함됨을 확인했다. 기존 B1 작업 사본과 B2A·A 작업 사본은 보존하고 독립 `feat/p5-b2b-native-charge-port-sync` 브랜치를 사용한다.

## 구현과 경계

[충전구 결과 v2 계약](contracts/charge-port-mobile-result-v2.md)에 따라 P5-B2A의 Debug Native 생성·QR·HTTPS transport·client·controller 흐름을 재사용한다. protocolVersion은 1, QR은 2다.

- 선택한 `ev-charge.port` = 생성 request/response = QR task = 조회 결과 task. `ev-charge.flap`과 알 수 없는 task는 거절한다. 세션 중 부품 선택은 잠긴다.
- `CompletedChargeInspection`은 불변 `ChargeResponses`와 `ChargeAids`를 보존한다. 덮개 손상·이물질/오염·눈에 보이는 변형/변색을 각각 표시하고 종합 상태·완료 시각·`SELF · USER_REPORTED`를 함께 표시한다. SDK 개방 보고·충전 가능·고전압 시스템 안전 판정과 합치지 않는다.
- Decoder는 정확한 13개 상위 키, nested 키, boolean, UUID v4, 실제 UTC 밀리초 시각과 순서, 상수·enum·계산 status·Digest를 검증한다. 중복/누락/추가 키와 타이어 키 혼합을 거절한다. 충전구 canonical responses 순서는 `debris,flapDamage,visibleDamage`다.
- 워셔액 v1 canonical bytes와 타이어 v2 모델은 보존한다. 타이어 task 목록을 별도로 고정해 충전구가 타이어 모델로 승인되지 않게 한다.
- 수신은 `RESULT_SUBMITTED`, 사용자의 수락과 동일 Digest의 최종 proof 확인 후 `ACCEPTED`다. polling은 수락을 요청하지 않는다. 같은 결과 재수신은 유지하고 다른 결과·task·잘못된 수락 proof는 거절한다. 세션 만료·취소·화면 종료 뒤 지연 응답은 결과를 다시 표시하지 않는다.
- 인증 기본 거부, 역할별 credential 격리, TLS chain/hostname 검증, redirect 차단, FLAG_SECURE, 메모리 내 credential 수명은 기존 구현을 유지한다. 테스트 credential provider는 testDebug에만 있다. Release 소스·권한·의존성·모바일/Sync JS·SDK·geometry는 수정하지 않는다.

## 재현

JDK 17, Android API 34/Build Tools 35.0.0, Node 22.16 이상과 기존 PC의 Gradle 캐시 설정을 사용한다. 개인 설정·credential은 복사하거나 commit하지 않는다.

```powershell
node tools/native-charge-sync/vectors.mjs
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'
./gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain
python tools/inspection-sync-poc/android/check-boundary.py
```

새 `ChargeSyncReceiverTest`가 실제 JS validator/canonicalizer를 읽기 전용 import하는 독립 벡터 도구를 실행한다. 27개 응답 조합 × aids 네 조합 = 108개의 JS/Kotlin canonical JSON과 SHA-256을 비교한다. 기존 타이어 suite의 109개 워셔액/타이어 벡터도 보존한다. semantic 오류 입력은 Digest를 다시 계산해 Digest 불일치만으로 거절되는 검사가 되지 않게 한다.

실제 JDK TLS fixture는 충전구 생성 body·조회·수락·취소를 검사하며, 기존 미신뢰/만료 인증서·hostname 불일치·redirect·권한 거절 검사를 유지한다. Robolectric는 task 선택, 실제 QR bitmap decode, 세 응답 텍스트, 수신 전 수락 차단, 중복 클릭 방지를 검증한다. Android CI는 필터 없이 모든 JVM/Robolectric 검사와 Debug/Release APK·Release AAB·lint·DEX/manifest 경계를 실행한다.

실행 결과와 실패 이력은 [증거 인덱스](evidence/p5-b2b/README.md)에 기록한다. AVD·실제 폰 두 기기 E2E·광학 QR·실차 인증은 **NOT_RUN**, 별도 검증이다. 유효한 생성 credential과 신뢰 가능한 HTTPS 서비스가 없을 때 생성 거부는 의도된 정책이다. 서버의 멱등 영수증/HTTP 201·200·conflict 검증은 기존 JS suite 범위이며 Native fake 검사와 구분한다.
