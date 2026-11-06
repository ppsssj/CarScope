# P9-S1 Native 브리지 신뢰성 조사

기준 `main` `542ee16`.

**판정: `ROOT_CAUSE_UNCONFIRMED`.** 관측된 차단의 원인을 재현하지 못했다. 이 작업은 원인을 고치지 않았고, 다음 발생 때 원인을 구분할 진단과 합성 테스트, 재시작 안내를 추가했다. 실제 AVD 실행은 `AVD_NOT_RUN`이다.

## 관측된 문제

P9-UX-A Fix1 AVD 검증에서 약 4~5회 화면 실행 중 1회, 설치 후 처음 띄운 화면(pid 22063)에서 패널이 열리지 않았다. 사용자가 백그라운드로 전환하지 않았고, 3D 화면을 다시 실행하자 복구됐다. 차단 시점의 앱 로그는 보존되지 않았다.

4750ms 프레임 정지는 다른 프로세스(pid 3356)의 값이므로 원인 근거로 쓰지 않는다.

## 당시 기록에서 확인한 사실

당시 화면과 접근성 트리의 문구를 코드와 대조하면 다음이 확정된다.

| 관측 | 코드상 의미 |
|---|---|
| `Native 전달 불가 · 새 결과 적용 중단` | `connection === 'UNAVAILABLE'`. `open`이나 `poll`의 실패, `poll`의 `unavailable` 값에서 온다. `adapter.open`의 동기 예외도 같은 상태가 되지만 이 어댑터의 `open`에는 그런 경로가 없다 |
| `Native 전달 경로가 없어 모바일 요청을 시작할 수 없습니다.` | `NATIVE_NOT_CONNECTED`. `request()`가 어댑터를 호출하기 전에 거부했다 |
| `Native 전달 경로 미완료 · 요청을 시작할 수 없습니다.` | `request()`가 `false`를 돌려줬다 |

**결론: 첫 요청을 누르기 전에 채널이 이미 닫혀 있었다.** 요청 RPC는 보내지지 않았다. 차단은 세션 시작(`차량 점검`)과 첫 요청 사이에 일어났다.

**이전 기록 정정:** [P9-UX-A 증거](../p9-ux-a/README.md)는 그 탭을 "다시 그려지기 전 좌표로 나갔고 동작 변화가 없었다"고 적었다. 틀렸다. 탭은 요청 버튼에 맞았고, 위 안내가 추가되며 버튼이 y 928에서 1022로 밀린 것으로 보인다.

## 상태 전이

```text
Activity 생성 → bridge active=true, 페이지 로드
차량 점검 → startSession → adapter.open → RPC open → (성공) poll 250ms 반복
요청 버튼 → request() → 연결 상태면 RPC request → Native 패널
poll 또는 open 실패 → onUnavailable → UNAVAILABLE. 자동 복구 없음
onPause·onStop → bridge.suspend: active=false, 세션 삭제
onResume → bridge.resume: active=true만 복원, 세션은 삭제된 채로
다음 세션 → endSession + startSession → 더 큰 generation으로 open
```

각 RPC는 직렬 큐에서 차례가 된 뒤 시작한다. 한 번이라도 다음 중 하나면 채널이 닫힌다: `AbortSignal.timeout(2000)`, 응답 처리 시점에 2000ms 초과, 404·형식 오류, `{"error":...}`.

## 가설별 판정

`코드 경로`는 그 경로가 실제로 차단을 만드는지, `관측 사례`는 이번 차단의 원인이 맞는지다. 합성 결과는 후자의 근거가 아니다.

| # | 가설 | 코드 경로 | 관측 사례 | 근거 |
|---|---|---|---|---|
| 1 | 최초 open 실패 | `SYNTHETIC_VERIFIED` | 미확정 | open이 2초를 넘으면 poll 없이 닫힘 |
| 2 | WebView 요청 가로채기 지연 | 재현 안 함 | 미확정 | JVM에서 측정 불가. 새 진단으로 구분 |
| 3 | 직렬 큐 대기 | **제외** | 제외 | 제한 시간은 차례가 된 뒤 시작. 대기와 실행 합계가 2초를 넘어도 연결 유지 (`SYNTHETIC_VERIFIED`) |
| 4 | 요청 자체의 timeout | `SYNTHETIC_VERIFIED` | 미확정 | poll 한 번의 2초 초과로 영구 차단. 관측 증상과 같음 |
| 5 | Activity·WebView 생명주기 경합 | `SYNTHETIC_VERIFIED` | 미확정 | pause 뒤 resume하면 세션이 사라지고 같은 generation으로 복구 불가. 아래 단서 참고 |
| 6 | 세션 generation 변경 | `SYNTHETIC_VERIFIED` | 낮음, 미확정 | 같은 Activity에서 페이지가 재로드되면 거부. 앱에 재로드 경로는 없음 |
| 7 | 늦게 도착한 콜백 | **제외** | 제외 | 이전 세션의 응답과 실패는 새 세션에 영향 없음 (`SYNTHETIC_VERIFIED`) |
| 8 | Native의 명시적 REJECTED | 일부 | `request` 거부는 **제외** | `request` 거부는 `UNAVAILABLE`을 만들지 않고, 요청도 보내지지 않았음. `poll` 거부는 세션이 삭제된 뒤에만 발생해 5번에 포함 |
| 9 | 동시 요청, `pendingTask` 충돌 | 일부 | **제외** | 충돌은 `request` 실패일 뿐이고, 요청이 보내지지 않았음 |
| 10 | 렌더링 부하와 RPC 지연의 관계 | `SYNTHETIC_VERIFIED` | 미확정 | 메인 스레드가 2초 넘게 멈추면 빈 poll로도 영구 차단. 실제 부하와의 관계는 새 진단으로 측정 |

남은 후보는 1, 2, 4, 5, 10이다.

**5번 단서 (원인 근거 아님):** 차단이 난 실행에서 설치 직후 시스템 로그에 `startSpecificActivity ... hasSavedState=true`가 약 200ms 안에 3번, `am start`의 `LAUNCH_MULTIPLE`이 함께 기록됐다. 복원되는 task와 새 실행이 겹쳤을 수 있으나, 그 인스턴스의 이후 생명주기 로그가 없어 판단할 수 없다.

**확인된 설계 특성:** 페이로드가 없는 빈 poll이 늦어도 채널이 영구히 닫힌다. 결함이라고 판정하지 않았고 바꾸지도 않았다. 이 제한은 fail-closed 경계의 일부이며, 늦은 빈 poll을 허용할 근거가 아직 없다.

## 추가한 것

| 항목 | 내용 |
|---|---|
| 진단 | `native-bridge-diagnostics.mjs`, `NativeInspectionBridge`의 `diag` 인자. Debug 자산과 Debug 소스에만 있음 |
| 재시작 안내 | 닫힌 채널에서 요청하면 토스트 `Native 연결이 종료되었습니다 · 3D 점검 화면을 닫고 새로 열어 주세요` |

바꾸지 않은 것: 2000ms 제한, 인증과 검증, 자동 재전송 없음, 자동 세션 생성 없음, proof 재사용 없음, 만료 바인딩 복원 없음, 서버 재시도 정책, `native-inspection-results.mjs`, `inspection-results-view.mjs`.

`inspect.js`는 토스트에 연결 상태를 넘기도록 한 줄만 바꿨다.

**Claude B에게 넘길 항목:** `inspection-results-view.mjs`는 차단 뒤에도 "검증된 Native 전달 경로가 없는 현재 배포에서는…"이라고 표시한다. 연결이 끊긴 상황과 맞지 않지만 소유 범위 밖이라 바꾸지 않았다.

### 진단 기록

정상 poll은 기록하지 않는다. 초당 4회 기록하면 실패 로그가 다시 버퍼에서 밀려나기 때문이다.

| 위치 | 태그 | 줄 | 기록 시점 |
|---|---|---|---|
| Web | `CARSCOPE_NATIVE_BRIDGE {JSON}` | `SESSION_OPEN` | 세션 시작 |
| Web | 위와 같음 | `RPC_ANOMALY` | RPC가 실패했거나 1000ms 이상 걸림 |
| Web | 위와 같음 | `CHANNEL_FAILED` | 채널이 닫힘. 최근 RPC 16개 포함 |
| Web | 위와 같음 | `SESSION_CLOSE_FAILED` | close 실패 |
| Native | `CARSCOPE_NATIVE_BRIDGE ...` | `open`, `suspend`, `resume`, `destroy` | 생명주기 |
| Native | 위와 같음 | `rejected reply=... stage=...` | 거부 |
| Native | 위와 같음 | `slow op=... ms=...` | 처리 500ms 이상 |

필드: `op`, `code`, `queueWaitMs`, `runMs`, `sinceLastOkMs`, `sinceOpenMs`, `visibility`, `previousClose`, `rpcCount`, `maxRunMs`, `maxQueueWaitMs`, `longTask`, `recent`, `session`(세션 순번).

식별자, digest, proof, 결과, URL, 오류 원문을 담을 필드가 없다. 코드는 허용 목록을 통과해야 하며, 아니면 `OTHER`가 된다. 진단 sink가 실패해도 브리지 결과는 바뀌지 않는다.

## 검증

**`SYNTHETIC_VERIFIED`:** 실제 어댑터와 소비자를 Node에서 실행하고, 스크립트 fetch로 실제 시간 지연이나 이벤트 루프 정지를 넣었다. 코드가 주어진 지연에 어떻게 반응하는지 보여 줄 뿐, Pleos WebView의 타이밍을 보장하지 않으며 관측 사례의 원인을 증명하지 않는다.

| 검사 | 결과 |
|---|---|
| `test/native-bridge-reliability.test.mjs` | 21/21 PASS |
| `npm test` (three-poc) | 179/179 PASS |
| `npm run test:android-assets` | 4/4 PASS |
| `:app:testDebugUnitTest` (JDK 17, Robolectric) | 246/246 PASS |
| 변이 시험 12종 (timeout 상향, 늦은 응답 검사 제거, 자동 재시도, 재전송, 원문 기록 등) | 12종 모두 테스트 실패로 검출 |
| `:app:assembleDebug`, `:app:assembleRelease` | PASS. Debug `756bda96a5273b216fde514b5a3cd589194094d9dbc4c06f62f0334ed7e87e96`, `NEW_DECODER` |
| Release APK 경계 | inspection 자산 0개, 진단 모듈 0개, dex에 진단 태그 없음 |
| `check-boundary.py` | 로컬 NOT_RUN (AAB 필요). CI job으로 판정 |

| 요구 시나리오 | 테스트 |
|---|---|
| 정상 open·request | `normal open and request…` |
| 최초 open timeout | `first open timeout…` |
| poll timeout | `one poll timeout reproduces…` |
| 메인 스레드 정지 | `main-thread stall…` |
| Promise queue 지연 | `Promise queue wait…` |
| Native request REJECTED | `Native request REJECTED…`, `request timeout…` |
| 중복 request | `duplicate requests…`, Kotlin `each rejection names its stage…` |
| 서로 다른 부품 동시 요청 | `simultaneous requests…`, Kotlin 같은 테스트 |
| Activity pause·stop | `Activity pause and stop…`, Kotlin `a transient suspend…`, `a pause then the resume bridge step…` |
| 종료 후 늦은 응답 | `a response that arrives after…`, `a late failure of the old generation…` |
| generation 불일치 | `generation change…`, `a request from an old generation…`, Kotlin `a reloaded page…` |
| 세션 종료 후 복구 | `after UNAVAILABLE only a new session reconnects…` |
| 실패 UI 안내 | `failure guidance…` |
| 민감정보 | `diagnostic records hold no…`, Kotlin `a slow handler…` |

**JVM의 한계:** Robolectric 테스트에서 pause는 실제 `onPause`를 실행하지만 resume은 `onResume`의 브리지 단계만 호출한다. 나머지가 프로세스 공유 차량 서비스를 바인딩하기 때문이다. 전체 경로는 아래 체크리스트 대상이다.

## 남은 AVD 체크리스트 (`AVD_NOT_RUN`, 별도 승인 필요)

APK 해시는 설치 전에 보고한다. 금지: `logcat -c`, `FLAG_SECURE` 우회, `서비스 연결 확인`·`점검 요청 생성` 클릭, uninstall, wipe.

1. 설치: `adb -s emulator-5554 install --user 10 -r <APK>`. 해시, 서명, `NEW_DECODER` 확인.
2. **실행 전에** 로그를 파일로 받기 시작한다. 이번에는 로그가 버퍼에서 밀려나 원인을 잃었다.
   `adb -s emulator-5554 logcat -v threadtime CarScopeInspection:I ActivityTaskManager:I "*:S" > <작업 PC 경로>`
3. 반복 실행한다. 회차마다 `차량 점검` → `타이어` → `앞 왼쪽 타이어`로 들어가 60초 대기하고, 연결 문구와 부하를 기록한다.
   - 일반 실행 20회 이상
   - 설치 직후 첫 실행 5회 이상 (관측 조건, 재설치마다 승인 범위 확인)
4. 차단이 나면 그 회차의 `CHANNEL_FAILED`와 Native 줄을 아래 표로 판정한다.
5. 차단이 없어도 `RPC_ANOMALY`의 최대 `runMs`와 `longTask`를 기록한다. 2초에 얼마나 가까운지 알 수 있다.
6. 패널을 연 채와 닫은 채 각각 앱 전환 후 복귀: `suspend`, `resume` 줄과 `CHANNEL_FAILED`의 코드를 확인한다.
7. 차단 뒤 토스트 문구가 재시작을 안내하는지, 3D 화면을 다시 열면 연결되는지 확인한다.
8. 기록에 세션 ID, digest, 결과, URL이 없는지 검색한다.
9. 필요하면 진단이 없는 `main` APK로 같은 횟수를 실행해 발생률을 비교한다. 진단 추가의 영향과 `main` 재현 여부를 가리는 용도다.

| `CHANNEL_FAILED` | 함께 볼 것 | 후보 |
|---|---|---|
| `NATIVE_UNAVAILABLE`, `NATIVE_REJECTED` | Native `suspend`, `stage=INACTIVE` 또는 `SESSION_CLEARED` | 5번 생명주기 |
| `NATIVE_REJECTED` | `stage=GENERATION_NOT_NEWER` | 6번 generation |
| `LATE_RESPONSE`, `TIMEOUT` | `longTask.maxMs`가 큼, Native `slow` 없음 | 4·10번 메인 스레드 정지 |
| `TIMEOUT` | `longTask` 작음, Native `slow` 없음 | 2번 가로채기 지연 (`rejected`도 없으면 Native에 도달하지 않았을 수 있음) |
| `TIMEOUT`, `LATE_RESPONSE` | Native `slow` 있음 | Native 처리 지연 |
| `HTTP_404` | Referer·페이지 검사 | origin 검사 |
| `op=open` | 위와 같이 코드로 구분 | 1번 |

`longTask`는 WebView에서 지원될 때만 값이 있고 아니면 `null`이다. 지원 여부도 위 실행에서 확인한다.

원인이 확정되기 전에는 코드를 고치지 않는다. 시각 확인 3건(`NOT_RUN_DEFERRED_TO_E2E`)은 [P9-UX-A](../p9-ux-a/README.md) 그대로이며, G5~G8 전에 이 조사를 먼저 진행한다.

원본 로그는 작업 PC `C:\CarScope-External\p9-s1\`에 있고 Git에 넣지 않았다.
