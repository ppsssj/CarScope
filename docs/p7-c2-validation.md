# P7-C2 검증 기록

> 후속: [P7-C3](p7-c3-server-clock.md)가 서버 코드에 `serverNow`를 추가했다. PR #78이 main(`8a6f559`)에 병합됐다. 아래 검증 표는 P7-C2 실행 시점 기록이다. **Render에는 아직 배포되지 않았고** E2E도 남아 있다. 실행 절차는 [P9](p9-e2e-checklist.md)다. Referer 항목의 정적 분석 결과도 P7-C3 문서에 있다.

코드 기준 `9097eed8f1e06d496fe4dae58fe0353ba38b570f`(main `2435087` 위). 실행일 2026-11-04, Windows 10, Node 22.16.0, Chrome 156.0.8078.80. 원본 로그·캡처는 Git 밖 `C:\carscope-external\p7-c2-claude\`에 있고, 이 문서가 증거 인덱스다. Codex B의 이전 실행(`C:\carscope-external\p7-c2\`)은 새 실행 근거로 쓰지 않았다.

## 상태 요약

| 표식 | 상태 | 의미 |
|---|---|---|
| `NATIVE_3D_BRIDGE_IMPLEMENTED` | PASS | Kotlin 소유자·RPC·고정 어댑터·C1 소비자 연결 코드가 있고 빌드된다. |
| `NATIVE_3D_CONTRACT_VERIFIED` | PASS (합성 clock 한정) | 컴파일된 Kotlin 저장소와 실제 JS 소비자가 17개 task 계약을 통과한다. `serverNow`는 테스트가 주입했다. |
| `NATIVE_3D_BLOCKED` | **BLOCKED** (운영) | 서버 코드에는 `serverNow`가 있다(PR #78). 운영 Render는 최신 코드로 배포되지 않았고 세션 생성도 `DENIED`이므로 실제 ACCEPTED는 아직 3D에 전달되지 않는다. P7-C2 실행 당시에는 서버 코드에도 필드가 없었다. |
| `NATIVE_3D_DEVICE_E2E_NOT_RUN` | NOT_RUN | AVD·스마트폰·Render 광학 E2E를 실행하지 않았다. |

## 새 실행

| 검사 | 결과 | 명령 | 근거 |
|---|---|---|---|
| Android 단위·빌드·lint | PASS, 229건 실패 0 | `gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:lintDebug --rerun-tasks --console=plain --max-workers=1 -Pkotlin.compiler.execution.strategy=in-process` | `android-final.log` |
| core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` | `core-final.log` |
| 3D Node | PASS, 110건 | `npm test --prefix tools/three-poc`, `npm run check:results --prefix tools/three-poc` | 터미널 출력 |
| Android 자산 패키징 | PASS, 1건 | `npm run test:android-assets --prefix tools/three-poc` | 터미널 출력 |
| 브라우저 DOM + 실제 참조 GLB | PASS, 합성 authority | [재실행 절차](p7-c1-3d-mobile-results.md)와 같은 `test:results-browser` (GLB SHA-256 `cfe0d754…139e1`) | `3d\` |
| state-map / product 회귀 | PASS | `check-inspection-state-map.mjs`, `check-inspection-product.mjs` | `state\`, `product\` |
| Release 경계 | PASS | `python tools/identity-probe/check.py build-contract`; release APK에 `assets/inspection`·`native-inspection` 항목 0, dex의 `NativeInspectionBridge`·`native-inspection-v1` 문자열 0 | 터미널 출력 |
| GitHub CI | PR 참조 | 각 job은 자기 범위만 증명한다. 브라우저·AVD·실차 결과가 아니다. | PR checks |
| AVD / 스마트폰 / 실차 E2E | NOT_RUN | 사용자가 에뮬레이터를 별도 관리하므로 자동 실행하지 않았다. | - |

브라우저 단계는 rebase 전에 실행했다. rebase가 `tools/three-poc/**`를 바꾸지 않아(#75는 해당 경로 미변경) 코드 내용은 같다. Node 검사는 위 기준 커밋에서 다시 실행했다.

## 요구사항별 근거

| 요구 | 테스트 |
|---|---|
| 서버 `receivedAt`/`acceptedAt` 보존·불변 | `SyncHttpDecoderTest`, `HttpsSyncReceiverTransportTest`, `SyncReceiverTest` |
| 17개 task/part/schema/digest | `real Kotlin vault is consumed by fixed JS adapter and existing C1 consumer for all 17 tasks` |
| 세션·generation binding, 늦은 callback | `callback before current UI activation…`, `cancel close background recreation…`, `detached pending open response…` |
| 명시적 Accept만 전달 | `only explicit accepted state with matching digest and times enters vault once` |
| 다른 task·digest·시각·중복·내용 충돌 거부 | `digest mismatch impossible times…`, `arbitrary JSON proof…`, `same inspection ID…` |
| JSON `trusted`/임의 proof 불인정 | `JSON trusted/ACCEPTED fields and an unverified delivery…`, `asset RPC rejects…` |
| WebView origin·main frame·소유권 | `NativeInspectionOriginTest`, `NativeInspectionWebChannelTest` |
| 수명주기·FLAG_SECURE | `NativeInspectionActivityTest` |
| 서버 clock 없을 때 차단 | `current server without serverNow blocks the real JS consumer…`, `Native server-clock block reaches 3D…` |
| 로컬·SDK 분리, 명시적 선택 UX | `native-bridge-consumer.mjs`, `test:results-browser` |

## 테스트가 증명하지 않는 것

아래는 실제 Chromium WebView에서만 확인할 수 있으며 현재 미검증이다. 실패해도 모두 fail-closed(전달 안 됨)이지만 그 경우 채널이 동작하지 않는다.

1. **`Referer` 전달:** `NativeInspectionOrigin`은 `shouldInterceptRequest`의 요청 헤더에 Referer가 있어야 통과시킨다. Robolectric 테스트는 헤더를 직접 넣는다. 실제 WebView가 이 헤더를 노출하지 않으면 모든 RPC가 404가 된다. **기기 E2E에서 가장 먼저 확인할 항목이다.**
2. **`fetch`와 WebView 인터셉트의 실제 조합:** CSP `connect-src 'self'`, `AbortSignal.timeout`(대상 WebView 버전 필요), 응답 처리.
3. **실제 Activity 전환·회전·renderer 종료·렌더링:** Robolectric은 수명주기 콜백만 호출한다.
4. **보수적 시각 상한의 실효성:** `serverNow + RTT + 4000ms`보다 이른 `receivedAt`은 거부한다. 실제 점검 소요 시간에서 false-negative가 없는지는 서버 필드 배포 후 확인한다.

## 해제 조건

1. Sync 서버의 [시각 계약](contracts/p7-c2-server-clock-proposal.md) `serverNow`: 구현 완료(PR #78). **배포는 미완료**다.
2. 신규 서버 배포와 시뮬레이터 활성화 뒤 새 세션으로 AVD·스마트폰 E2E를 수행한다. 기기는 값을 표시하지 않으므로 배포 커밋과 3D binding 결과로 판정한다([P9 C5](p9-e2e-checklist.md#c5-servernow-확인)).
3. 완료 범위: 부품 요청 → QR → 제출 → Native Accept → 3D 후보 → 사용자 선택, 그리고 취소·만료·화면 종료·재생성.
