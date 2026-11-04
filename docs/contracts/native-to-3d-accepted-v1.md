# P7-C1 Native ACCEPTED → 3D 전달 계약 v1

> P7-C2 후속: 고정 Android 자산 RPC 어댑터와 Native 소유자를 [구현](../p7-c2-native-3d-bridge.md)했다. 아래 C1 당시 ‘경로 미완료’ 기록은 이력이다. P7-C3가 서버 코드에 serverNow를 추가했으나 Render 미배포라 실전 binding은 여전히 BLOCKED이며 Native/스마트폰 E2E PASS가 아니다. 인터페이스/필수 proof 검증은 유지한다.

상태: **프런트엔드 소비자 구현, 실제 Native 전달 경로 미완료**. 시작 main `18403af`에서 PR #71 head `f9a61c2`를 읽기만 했다. 작업 중 PR #71/#73이 병합되어 최종 기준을 최신 main `b396394`로 재정렬했다. Native 17-task decoder/수락 지원은 기준 코드에 포함되지만 아래 전달 채널은 아직 없다. 이 변경은 `app/**`·모바일/Sync 서버·운영 설정·GLB를 수정하지 않는다. 아래 인터페이스를 Codex A에게 인계한다.

## 결정과 신뢰 경계

기존 [3D 세션 설계](mobile-result-to-3d-session-v1.md)의 별도 모바일 저장소·명시적 선택 방식을 구현한다. 로컬 타이어 row 덮어쓰기와 3D의 Sync 직접 polling은 제외했다. 전자는 출처·원문·draft를 잃고, 후자는 인증 소유자와 세션 수명주기를 새로 만들기 때문이다. 3D는 초기화 시 받은 **검토된 Native 어댑터 capability**만 소비한다.

생산 `inspect.js`의 `createNativeInspectionResults()`는 어댑터 없이 생성된다. 따라서 기본 상태는 `INCOMPLETE_NATIVE`, 후보 0, 실제 통합 미완료다. 어댑터를 URL/fragment/localStorage/window 속성/postMessage/일반 JSON에서 선택·등록하는 기능은 없다. `window.__inspect`는 복사된 읽기 전용 snapshot과 기존 시각화 조작만 제공하며 수신 함수·저장소를 노출하지 않는다. 테스트용 authority는 `test/`에만 있고 Android 패키지에서 제외한다.

Codex A가 실제 전달 경로를 구현할 때 검토한 고정 모듈 import를 composition에 추가하고 `{adapter}`를 전달해야 한다. `sessionState: ACCEPTED`나 `trusted:true`가 들어 있는 JSON을 받았다는 이유로 proof를 발급하면 안 된다. `verifyAccepted`는 Native가 인증된 receiver 권한으로 받은 엄격한 원문, canonical digest, 명시적 accept의 검증된 응답을 보유하고 그 소유권을 입증하는 경로여야 한다. 허용된 origin·main frame·현재 WebView 소유자·앱 수명주기·비공개 채널 binding을 Native에서 확인한다. 임의 `window.postMessage` listener 또는 단순 echo verifier는 이 계약을 충족하지 않는다.

PR #71의 `SyncReceiverView(sessionId,sessionState,expiresAt,result,resultDigest,taskId)`와 `SyncInspection.canonicalJson()/digest()`는 검증 입력으로 재사용할 수 있다. 그러나 해당 View는 `receivedAt`, `acceptedAt`, 3D local session/generation/binding 및 비공개 전달 채널을 제공하지 않는다. 필드를 현재 시각으로 합성하거나 누락 proof를 허용하지 말고 Native 소유자가 실제 검증한 값과 수명주기를 전달해야 한다. 이 작업은 Kotlin 모델을 바꾸지 않는다.

## 초기화 인터페이스

```js
const consumer = createNativeInspectionResults({ adapter });
consumer.startSession(localSessionId); // page-owned ID; generation은 소비자가 발급
// adapter.open(context) -> unsubscribe function (필수, 동기)
// adapter.verifyAccepted(frozenDelivery, frozenBinding) -> Promise<verifiedProof>
// adapter.requestTask({localSessionId,generation,taskId,partId}) -> void/Promise (선택)
```

`open`의 context는 `{localSessionId,generation,onBinding,onAccepted,onTerminal,onUnavailable}`다. Native는 전달받은 ID/generation과 현재 차량/점검 화면의 소유권을 고정하고 그 문맥에서 기존 인증 정책으로 QR v2 세션을 생성한다. `requestTask`는 생성 요청 의도만 전달하며 토큰/차량 ID를 3D에 반환하지 않는다. 프런트엔드는 QR v1 안내를 QR v2 인증 세션으로 간주하지 않는다.

`onBinding`은 **검증된 create 응답 이후** 아래 정확한 키만 호출한다. opaque 식별자는 `[A-Za-z0-9._:-]{1,128}`, generation은 양의 safe integer, epoch는 0 이상 실제 JavaScript Date 범위의 safe integer다.

```js
{
  bindingId, localSessionId, generation, syncSessionId,
  taskId, partId, serverNow, expiresAt
}
```

task/part 매핑은 `mobile-result-contract.mjs`의 정확한 17개이며 [P7-B 신규 10개 계약](p7-b-mobile-tasks-v2.md)과 기존 7개 계약을 그대로 따른다. `serverNow <= expiresAt`, 남은 기간은 검증된 서버 clock domain에서 계산하고 수신 시점의 `performance.now()`에 더해 monotonic deadline을 만든다. 브라우저 벽시계나 폰 completedAt으로 deadline을 늘리지 않는다. 같은 binding 재전송은 deadline을 연장하지 않는다. 한 Sync 세션을 다른 binding/task로 다시 묶지 않는다.

기존 Sync view는 이미 `receivedAt`/`acceptedAt`을 보내므로 서버를 바꿀 필요가 없다. Native decoder는 이를 검증한 뒤 View에 보존하도록 확장해야 한다. 생성 시점의 `serverNow`/남은 기간 산정에는 인증된 응답의 검증 가능한 서버 clock anchor와 전달 지연 처리가 필요하다. 현재 Native 모델에 없는 값을 `Date.now()`로 합성하거나 신뢰할 clock 정보 없이 binding을 열지 않는다. 실제 clock anchor/전달 경로는 Native 소유자가 구현하고 검증할 잔여 조건이다.

## 결과와 검증된 수락 proof

`onAccepted(delivery)`의 정확한 키:

```js
{
  bindingId, localSessionId, generation, syncSessionId, taskId,
  inspectionId, resultDigest, result // 원본 schema v1/v2 완료 JSON
}
```

소비자는 입력을 복사·동결하고 schema/키/타입/시간/집계를 재검증한다. v1의 UTC 초/밀리초 원문을 유지하며 실재하지 않는 날짜·문자열 강제변환을 거절한다. v2는 기존 UTC 밀리초 형식과 정확한 response key를 검사한다. `MOBILE`, `SELF`, `USER_REPORTED`, `COMPLETED`, `NOT_SENT`를 고정한다. canonical JSON의 SHA-256을 독립 재계산해 `resultDigest`와 비교한 뒤에만 어댑터의 `verifyAccepted`를 호출한다.

`verifyAccepted`가 반환해야 하는 정확한 proof:

```js
{
  version: 1, proofId, sessionState: 'ACCEPTED',
  bindingId, localSessionId, generation, syncSessionId, taskId,
  inspectionId, resultDigest, receivedAt, acceptedAt
}
```

모든 binding 식별자·task·inspectionId·digest가 일치하고 `serverNow <= receivedAt <= acceptedAt <= expiresAt`여야 한다. 원본 `startedAt/completedAt`은 별도의 폰 시각이며 서버 시각으로 교체하거나 서버 시각과 대소 비교해 정렬하지 않는다. proof의 `proofId`는 Native가 관리하는 검증 근거 식별자이며 토큰이 아니다. digest만 또는 RESULT_SUBMITTED 영수증만으로 ACCEPTED proof를 만들 수 없다. 실제 검증 증거가 없으면 verifier는 reject/null로 응답하며 후보가 생성되지 않는다.

해시·Native 검증 await 전후에 현재 local session/generation과 live binding을 다시 확인한다. 동일 inspectionId/task/digest는 첫 proof와 시각을 보존하는 no-op, 같은 ID의 다른 task/내용은 conflict다. 다른 Sync 세션에서 같은 결과가 와도 원본 proof를 덮어쓰지 않는다. 다른 inspectionId는 별도 후보이며 최신 시각이라고 자동 선택하지 않는다.

## 종료·표시·사용자 선택

- `onTerminal({bindingId,syncSessionId,state})`는 `CANCELLED|EXPIRED|CLOSED`만 허용한다. onUnavailable/중지/소유권 상실도 새 적용을 차단한다. 만료 경계는 기존 정책대로 `now > deadline`이며 주기적으로 검사하고 수신/선택 시에도 다시 검사한다.
- 수신 후보는 3D 색·완료 수를 바꾸지 않는다. `consumer.select(taskId,inspectionId)`를 해당 부품의 UI 버튼에서 사용자가 직접 호출한 뒤에만 표시한다. `LOCAL` 선택은 기존 타이어 기록 또는 미점검으로 돌아가며 모바일 원문을 삭제·병합하지 않는다.
- 후보가 만료/취소된 뒤에는 새로 선택할 수 없다. **이미 선택한 검증된 ACCEPTED 보고**는 전송 세션 만료 후에도 페이지 종료까지 보존하며 “연결 종료/만료, 수락 기록 보존”을 표시한다. 전송 만료를 사용자 UNABLE이나 SDK STALE로 변환하지 않는다.
- 홈/점검 종료/재생성/dispose는 local session/generation, binding, 후보, 선택, 중복 index를 비운다. unsubscribe 후 도착한 이전 callback과 같은 local ID를 재사용한 이전 generation도 거부한다. 저장/복원·자동 재적용은 없다.
- 메모리 상한은 binding/기록 각 100개다. 초과 시 CAPACITY로 거부하며 기존 기록을 퇴출하거나 다른 부품에 적용하지 않는다. 서버 rate limit/TTL은 바꾸지 않는다.

## Codex A 완료 기준

1. 병합된 Native 17개 exact task 수신·엄격한 schema·명시적 accept 검증을 재사용하고 현재 페이지 소유권과 실제 생성 시점 binding을 구현한다.
2. 검증된 서버 수신/수락 시각, 원문 canonical bytes/digest 및 위 식별자를 토큰 없이 비공개 전달한다. 전달이 끊기면 unsubscribe/onUnavailable이 실행돼야 한다.
3. 실제 Native ACCEPTED → 후보 → 사용자의 선택 → 정확한 3D part와 17개 요약을 실기기에서 검증한다. 취소/만료/화면 종료/늦은 callback·다른 task/digest·새 시도를 포함한다.
4. 이 PR의 synthetic test authority와 실제 Native 연결을 구분한다. 프런트엔드 Node/브라우저 PASS는 Native 경계 완료를 뜻하지 않는다. 실제 E2E 전까지 통합 상태는 미완료다.
