# P6-D7 — 동일 HTTPS Grant의 유효 시작 대기

기준: `C:\dev\CarScope`, clean main `ef6f2afe8e90257ea0a3d095df4c8187555f6b84`
(PR #69 병합), fetch한 origin/main과 0/0. 변경 브랜치
`fix/avd-grant-not-before-wait`. 기존 변경/앱 데이터/Enrollment를 삭제하지 않는다.

## 원인과 수정

사용자 실측: 실제 Android에서 `PROVISION_GRANT_NOT_YET_VALID`, AVD 시계가
Windows보다 약 1,139ms 느림. 이번 세션에서 이 오류를 새로 재현한 것은 아니다.
기존 코드는 HTTPS 응답을 받은 즉시 단 한 번 현재 시각으로 검증해, 아직 유효하지
않은 grant를 즉시 거부했다. 시계 오차를 허용하는 대신 유효 시작까지 기다린다.

Debug `HttpsAvdSimulatorGrantExchange`만 변경한다. 응답 bytes/contentType을 한 번
보존하고 `GrantNotYetValid`에만 worker에서 50ms 간격으로 동일 정책 검증을 반복한다.
대기는 단조 시계로 최대 3초이며, 원래 fetch 시작부터 5초 전체 deadline 안에서만
가능하다. 유효 시작에 도달해도 만료됐다면 거부한다. deadline/취소/close를 검증 전후에
확인하고 기존 AtomicBoolean callback 중복 방지와 Activity generation 정책을 유지한다.
추가 HTTP 요청은 없다. 3초 한도에서는 기존 NOT_YET_VALID 코드로 실패한다.

`AvdSimulatorPolicy.grant`의 `notBefore <= now < expiresAt`, 120초 TTL,
TLS/hostname/고정 origin/registrationId/audience/scope/승인 flag는 그대로다.
응답·proof·토큰·예외 메시지를 로그에 추가하지 않는다. 테스트 clock/pause 주입은
Debug 생성자 내부 경계이며 Activity는 기본 System.nanoTime/Thread.sleep을 사용한다.

## 회귀 범위

- 가상 로컬 시계가 1.2초 뒤 유효 시작에 도달한 동일 응답으로 provider 생성 권한 확인.
  그 전에는 callback/생성 권한/VERIFIED 로그 없음, HTTP 요청 1회.
- 고정 wall clock 또는 3초 시점의 clock jump에도 단조 시계 한도에서 거부.
- 대기 중 만료 및 기존 즉시 만료 거부.
- 5초 원래 deadline, 대기 중 invalidate/close/실제 scheduled timeout 이후 늦은 성공 차단.
- callback 1회 이하, 고정 코드만 로그 출력, 기존 HTTP/TLS/DNS/JSON 회귀 유지.

## 실행 근거

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests 'io.carscope.app.sync.AvdSimulator*' --tests 'io.carscope.app.sync.HttpsAvdSimulatorGrantExchangeTest' --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
.\gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx768m -Dfile.encoding=UTF-8'
```

최초 집중 실행은 16 tests PASS(5초 monotonic 추가 회귀 전).
core 새 실행은 37 PASS / 1 SKIP(외부 IONIQ5_PARTS 미설정), failure/error 0.
최종 app/빌드/경계 결과는 아래에 별도 기록한다. 과거 XML/APK만으로 새 PASS를 부여하지 않는다.

첫 전체 app 실행은 200개 중 199 PASS / 1 FAIL. 기존 80ms deadline fixture의
disconnect 대기 assertion이 실패했다. 요청 시작 전에도 deadline이 끝날 수 있으므로,
fixture는 실제 연결이 생성된 경우에만 disconnect를 요구하도록 수정했다.
callback 중복/늦은 성공 차단 assertion은 그대로이며, 신규 대기 중 timeout 테스트는
worker가 대기에 진입했음을 latch로 확인한 뒤 timeout을 검증한다.
첫 전체 실행 당시 후속 빌드 task는 실행되지 않았다.

최종 재실행: `:app:testDebugUnitTest :app:assembleDebug :app:assembleRelease
:app:bundleRelease` (위와 같은 workers/JVM 옵션), BUILD SUCCESSFUL.
app 200 PASS / failure/error/skip 0, 그 중 AvdSimulator 관련 17 PASS.
Debug는 재컴파일했고 Release는 변경 범위가 없어 대부분 UP-TO-DATE였다.
`python tools/inspection-sync-poc/android/check-boundary.py` PASS:
Debug-only DEX/권한, Release APK/AAB 미포함 및 readiness 9 tests PASS.
`git diff --check` PASS. 기존 컴파일 경고와 SDK XML version 경고는 남아 있다.

새 Debug APK SHA256:
`80C4433E866A40CB8B7EBD5822291CED9D17F5EB34E601CA1997D6F4C9E55331`.
`adb -s emulator-5554 install --user 10 -r app/build/outputs/apk/debug/app-debug.apk`
Success. 설치 전후 `run-as`로 Enrollment/endpoint 파일의 hash를 메모리에서 비교해
각각 동일함을 확인했다. 파일 내용과 hash 값은 출력하거나 문서에 저장하지 않았다.

## 실제 E2E 상태

이번 세션 ADB는 emulator-5554 device, boot=1/API34/user10 확인 PASS.
credential-free health GET은 UP / STATEFUL_AVD_SIMULATION /
OPERATOR_APPROVED_AVD_ONLY. 고정 auth 로그 조회에는 코드가 없었다.
`SyncReceiverActivity` 실행 명령은 자동 승인 검토에서 blocked by policy로 거부됐다.
구체적인 규칙은 제공되지 않았으며 실행 성공 또는 인증 성공으로 기록하지 않는다.

실제 grant/HTTP201/session/QR/광학 스캔/제출/수신/사용자 Accept/폰 ACCEPTED 및
동일 session/task/digest 확인은 완료 근거가 생기기 전까지 NOT_RUN이다.
Render/DB/Enrollment 변경은 하지 않았다. 운영 복구는 미확인이다.
이 로컬 셸에 운영자 DB 환경변수와 Render CLI가 없음을 값 노출 없이 확인했다.
E2E 종료 시 운영자는 해당 등록 revoke 및 Render simulator mode 제거/재배포 후
health `STATEFUL_DENY_DEFAULT / DENIED`를 확인해야 한다. 진행 중인 E2E를 위해
이 세션에서 기존 설정/등록을 임의 변경하지 않았다.
