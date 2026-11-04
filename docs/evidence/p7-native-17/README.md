# Native 17-task 통합 증거 인덱스

새 실행의 원본은 `C:/CarScope-External/p7-native-17/`에 보관한다. 기존 #71의 실제 SDK 값/캡처/ANR 증거는 [P7-A 인덱스](../p7-a/README.md)에 그대로 남긴다. 로그·QR 토큰·인증 fixture·APK·기기 설정은 Git에 넣지 않는다.

환경: Windows, JDK17, Node22.16.0, Python3.11, Gradle8.14, Android compile/target34. main `18403af`(#72 병합)와 #71 `e9c055e`를 일반 merge한 `f9a61c2`가 새 브랜치의 기준이다. 미커밋 작업이 없었고 rebase/force push/PR 병합은 수행하지 않았다.

| 증거 | 범위 / 판정 |
| --- | --- |
| `focused.log` | Native 17 task 계약·모바일 1,740 조합·strict 오류·QR bitmap/화면/Accept·HTTPS transport/provisioning·entry 31 tests PASS |
| `full-build.log` | 전체 app 211 PASS, Debug/Release APK·Release AAB·lint PASS. 중간 소스의 기록이며 최종 실행과 구분 |
| `latest-cases.log` | 추가한 wrong calendar/metadata/동일 schema task 교환 등 NativeTaskCoverageTest 6 tests 및 lint PASS |
| `final-build.log` | 최종 소스 app 211 PASS, Debug/Release APK·Release AAB·lint PASS(0 error/22 warning), 25 executed/81 up-to-date |
| `core-sequential.log` | 표준 coreOnly 명령 재실행 PASS: 37 PASS/1 SKIP(외부 GLB parts 미지정) |
| `mobile-tests-ready.log` | 실제 모바일 Node 80 PASS. 실제 폰/카메라 아님 |
| `sync-tests.log` | Node 127 PASS/4 SKIP(PG_TEST_URL 미설정). Node의 신규 10 task idempotency/취소/만료 포함 |
| `three-tests.log` | 기존 3D UI Node 81 PASS. Geometry 변경 없음, 실제 렌더/AVD 증거 아님 |
| `native-tasks-v2.json` (app build/test-results) | 실제 Kotlin allowlist/part/schema/responseKeys를 Node/mobile/P7-B exact 계약과 대조하는 합성 metadata. 사용자/차량/인증 데이터 없음 |
| `gates.json`, `*-boundary.log`, `task-contract.log` | 다섯 artifact/계약 검사 모두 exit=0. Debug 문자열 리소스의 Release APK/AAB 부재 포함 |

`NativeTaskCoverageTest` 6개 method는 모든 17개 task에 루프를 적용한다. washer 12 + schema-v2 16×108 = 1,740 실제 모바일 생성기 벡터와 Native canonical bytes/SHA256 일치를 확인한다. 각 task에서 schema/type/constant/key/time/UUID/task/digest 오류, 반복 결과와 결과 교체 거부, 단일 Accept 및 잘못된 proof, 취소·만료·pending 만료·close 이후 늦은 callback을 검사한다. LCW/일반, 좌우·상하향처럼 response key가 같은 다른 task도 교환할 수 없다.

Robolectric은 17개 Native 선택 항목의 실제 QR bitmap을 읽고 정확한 invite/task를 확인한다. 사용자 보고 질문/답변은 각각 독립 표시하며 수신 전 Accept 불가, 수신 뒤 명시적 단일 Accept를 확인한다. 실제 loopback TLS/SQLite와 테스트용 인증기관·실제 모바일 생성기/SyncClient·Native controller E2E도 17개 task를 순회한다. 운영 인증/Render/외부 서비스는 사용하지 않는다. 기존 rate limit을 유지하기 위해 최대 8개씩 별도 서비스로 실행한다.

## 실패·재실행

- 모바일 Node 첫 실행은 이 작업 사본에 qrcode 의존성이 없어 2개 파일이 FAIL. 잠금 파일 그대로 `npm ci --ignore-scripts --prefix tools/mobile-ar-poc` 후 80 PASS. 소스/의존성 버전 변경 없음.
- Android와 core를 같은 checkout에서 동시 실행한 첫 core 검증은 공유 `vehicle-core.jar` 파일 생성 충돌로 FAIL. Android 종료 후 같은 표준 core 명령을 순차 재실행해 PASS. `core.log`와 `core-sequential.log`를 모두 보존한다. 검사 제외·JAR 삭제·임계값 변경은 하지 않았다.
- 테스트/수정 중 실행과 최종 source 실행을 구분한다. 최종 artifact 경계는 전체 JUnit report가 완성된 뒤 실행한다.

실제 AVD/스마트폰/실차/광학 QR 스캔/외부 인증/ANR 해결 검증은 **NOT_RUN**이다. #71의 실제 API 관측은 보존한 과거 증거이며 이 PR의 새 센서 실행으로 세지 않는다. 이번 성공은 Native 구현 및 합성 JVM/Robolectric·실제 로컬 TLS 서비스 연결 범위다. 3D 상태에 USER_REPORTED 결과를 자동 적용하는 구현도 포함하지 않는다.
