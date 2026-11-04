# P7 — Native 17-task 수신 통합

작업 사본 `C:/dev/CarScope-p7-api`. 시작은 #71의 `e9c055e`, 미커밋 변경 없음. #72 병합 main `18403af`를 #71 브랜치에 일반 merge한 `f9a61c2`에서 `feat/p7-native-17-tasks`를 분리했다. rebase/force push/PR 병합은 하지 않는다. 새 PR의 base는 미병합 #71의 `feat/p7-sdk-api`이며, 새 10개 Native 지원과 해당 검증만 별도 diff로 검토한다. #71 병합 후 base를 main으로 전환할 수 있다.

## #71의 미완료 범위와 보존할 결과

이전 [실제 SDK/AVD 결과](p7-a-pleos-runtime.md#실제-avd-결과)는 변경하지 않는다. SoC 원시 Integer 100, charge-switch/port-open false, wiper OFF, low-beam OFF, high-beam ON 수신 및 7개 기존 상태 패널 표시 증거가 있다. washer/brake/tire의 오류·미확인도 그대로 보존하며 센서 성공으로 바꾸지 않는다.

별도 미완료는 화면 전환의 focus-event ANR이다. 이전 bugreport에서 main→HWUI drawFrame 대기와 RenderThread→QEMU GL encoder pipe 경로가 관측됐고 SDK workers는 queue 대기였다. 전체 원인과 앱/에뮬레이터/GPU 각각의 기여는 확정되지 않았다. 이번 Native 수신 확장은 ANR 수정·재현·해결 증거가 아니다. AVD/스마트폰/실차/외부 인증을 실행하지 않는다. 이전 실제 수신값과 이번 합성 사용자 보고 테스트를 혼합하지 않는다.

## exact 계약과 구현

[병합된 P7-B 인계](contracts/p7-b-mobile-tasks-v2.md)의 JSON 블록과 실제 `extra-tasks.mjs`/Node `SUPPORTED_TASKS`를 대조한다. 아래 모두 schemaVersion=2이며 partId=taskId다. `partId`/`responseKeys`는 등록 메타데이터이고 결과 JSON에 추가하지 않는다.

| 신규 taskId / partId | 정확한 responseKeys |
| --- | --- |
| `coolant-reservoir` | `levelMarking`, `leakTrace`, `exteriorDamage` |
| `lcw-coolant-reservoir` | `levelMarking`, `leakTrace`, `exteriorDamage` |
| `battery-12v` | `caseDamage`, `leakTrace`, `visibleCorrosion` |
| `fuse-box` | `coverDamage`, `visibleContamination`, `heatDamage` |
| `wiper.front.left` | `bladeDamage`, `visibleDebris`, `armDamage` |
| `wiper.front.right` | `bladeDamage`, `visibleDebris`, `armDamage` |
| `light-low-beam-left-0` | `lensDamage`, `obstruction`, `visibleMoisture` |
| `light-low-beam-right-0` | `lensDamage`, `obstruction`, `visibleMoisture` |
| `light-high-beam-left-0` | `lensDamage`, `obstruction`, `visibleMoisture` |
| `light-high-beam-right-0` | `lensDamage`, `obstruction`, `visibleMoisture` |

기존 `washer-fluid` schema 1과 tire 4개/ev-charge.port/brake-fluid schema 2를 유지한다. Native `SyncChecklistTasks.profiles`에 10개 profile을 추가하여 기존 공통 strict decoder·canonical digest·QR·polling·결과 표시·명시적 Accept를 사용한다. 공통 질문 정의는 재사용하지만 각 task의 답변·session·digest는 별개다. 좌우, 상하향, 일반/LCW 결과를 대체하거나 복제하지 않는다. SDK 지원 여부로 모바일 점검을 차단하지 않는다.

Native는 정확한 root/aids/responses key 집합, 버전·타입·상수·enum·상태 계산·UUID·날짜·세션 task·digest를 재검증한다. 누락/unknown을 UNABLE로 보정하지 않는다. 표시된 digest의 명시적 Accept만 허용하고 중복 Accept·결과 교체·만료·취소·늦은 callback은 기존 client/controller 계약으로 처리한다. Geometry/SDK adapter/vehicle-core/모바일 기능/외부 인증/Render/Release 설정은 변경하지 않는다.

## 자동 검증 설계

- `NativeTaskCoverageTest`가 실제 컴파일된 Native allowlist/part/schema/responseKeys를 `app/build/test-results/native-tasks-v2.json`으로 내보낸다. `tools/native-task-sync/contract.mjs`는 이것을 실제 모바일 task/Node allowlist 및 P7-B 문서 JSON과 정확히 비교한다. 정규식으로 Kotlin 소스를 읽어 통과시키는 검사가 아니다.
- 실제 모바일 생성기와 Node validator로 1,740개 조합을 만든다: washer 3상태×4 aids=12, schema-v2 task 16개×27응답×4 aids=1,728. 모든 조합의 Native strict decoding·canonical bytes·SHA256을 대조한다.
- 17개 task 각각 wrong schema/type, task mismatch, 동일 key 집합의 LCW/좌우/상하향 교환, digest mismatch, 잘못된 상수/날짜/UUID, 추가·누락·unknown·중복 key를 거부한다. 동일 결과 반복 수신, 결과 교체 거부, 단일 명시적 Accept, 잘못된 수락 proof, 취소·만료·pending 만료·화면 종료 후 늦은 callback을 검사한다.
- Robolectric은 실제 Native Activity의 17개 선택, QR bitmap 판독, exact task 표시와 세 응답 표시, 수락 전 대기·명시적 단일 Accept를 검사한다. 일반 JVM TLS 테스트는 17개 task의 생성/view/accept/cancel HTTP 계약도 검사한다.
- 테스트용 인증기관 및 CA를 명시적으로 신뢰하는 실제 loopback TLS/SQLite 서비스와 실제 모바일 SyncClient/생성기, Native controller의 QR invitation→claim→제출/영수증→RESULT_SUBMITTED→명시적 Accept→모바일 ACCEPTED를 연결한다. 변경 없는 create 10회/분 제한을 지키도록 최대 8개 task씩 별도의 단명 서비스에서 검증한다. 제한을 상향하지 않는다.

## 재실행

```powershell
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:testDebugUnitTest :app:lintDebug --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'
# 같은 checkout의 Gradle 빌드는 공유 JAR 충돌을 피하도록 순차 실행한다.
.\gradlew.bat '-PcoreOnly=true' :vehicle-core:test --rerun-tasks --console=plain
node tools/native-task-sync/contract.mjs app/build/test-results/native-tasks-v2.json
python tools/inspection-sync-poc/android/check-boundary.py
python tools/component-probe/check.py boundary
python tools/identity-probe/check.py build-contract
python tools/tire-probe/check.py build-contract
npm test --prefix tools/mobile-ar-poc
npm test --prefix tools/inspection-sync-poc
npm test --prefix tools/three-poc
```

증거는 [새 실행 인덱스](evidence/p7-native-17/README.md)에 기록한다. 실제 폰 광학 스캔/AVD Native 수신·Accept/실차 및 ANR 해결은 NOT_RUN이다. 합성 테스트가 통과해도 이 범위의 실제 기기 성공을 뜻하지 않는다.

## 최종 로컬 검증

| Gate | 결과 | 근거 |
| --- | --- | --- |
| 전체 app JVM/Robolectric | PASS | 211 tests, failure/error/skip=0 |
| 17 task 집중 검사 | PASS | 31 tests; 실제 모바일 1,740 벡터, Native QR/표시/수락, 17-task TLS 및 기존 인증 회귀 |
| coreOnly 재실행 | PASS / 1 SKIP | 37 PASS, 외부 GLB parts 미지정 검사 1개 SKIP |
| 모바일 / sync / 3D Node | PASS | 각각 80 / 127 / 81 PASS; sync의 PG 미설정 4개 SKIP |
| Debug APK / Release APK / Release AAB | PASS | 마지막 빌드 25 task executed / 81 up-to-date; app 테스트는 실제 재실행 |
| lint | PASS | 0 errors / 22 warnings |
| Native/mobile/Node/P7-B 계약 일치 | PASS | 컴파일된 `native-tasks-v2.json`과 Node 비교 exit=0 |
| Sync/Component/Identity/Tire 경계 | PASS | 모든 스크립트 exit=0. 신규 문자열 리소스도 Debug APK에만 존재 |
| diff 검사 | PASS | `git diff --check` |
| 실제 AVD·스마트폰 / ANR 재검증 | NOT_RUN | 이번 작업에서 기기/외부 인증 실행 없음 |

런타임용 Debug APK SHA256 `223319bef985cabc851d3e20e5a25c2aceb9977430019be2d45e93e575ccdd49`는 빌드 식별자이며 실제 설치/실행 증거가 아니다. CI는 별도 PR/동일 commit의 workflow 결과에 한정하며 실제 기기 결과로 확대하지 않는다. #71이 아직 미병합이므로 새 PR은 해당 브랜치 위에 쌓은 Draft로 검토하며 자동 병합하지 않는다.
