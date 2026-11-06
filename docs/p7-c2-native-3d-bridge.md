# P7-C2 Native ACCEPTED → 3D

`8cb87c9`(PR #71/#72/#73/#74 병합)에서 `feat/p7-c2-native-3d-bridge`로 시작해 Codex B 중단 후 인계받았고, main `2435087`(P8-A1 포함) 위로 재정렬했다. 이 문서는 구현 경계이며 실기기 E2E 성공 증거가 아니다.

## 소유 구조와 결정

| 접근 | 판단 |
|---|---|
| 별도 수신 Activity로 이동하고 전역 owner/token을 남김 | 기존 onStop 권한 폐기와 충돌하므로 제외 |
| Activity result에 JSON ACCEPTED를 싣고 일반 JS 함수로 주입 | 생성 binding/원본 수락 소유권과 WebView 검증이 불충분하므로 제외 |
| 동일 InspectionActivity에서 기존 Native 수신 UI/controller와 현재 WebView를 소유 | 채택. Native QR/수락 UI를 패널로 표시하고 WebView 인스턴스는 유지 |

`InspectionActivity`는 기존 `SyncReceiverActivity`의 endpoint/AVD 등록/provisioning/HTTPS/controller/QR/수락 UI를 재사용한다. 3D의 요청은 부품을 고정한 Native UI를 연다. P9-I1부터 이 요청이 세션을 한 번 생성한다. P9-UX부터 QR은 부품 패널에 표시되고 시뮬레이터에서는 자동 수신 확인한다([규칙](p9-i1-vehicle-mobile-flow.md#이번에-바꾼-규칙)). 다른 자격의 수락은 Native 버튼으로만 실행한다. Native 패널의 Back/‘패널 닫기 · 점검 요청 유지’는 패널을 숨기며 원격 취소를 주장하지 않는다. P9-UX-A부터 패널은 WebView를 숨기지 않는 오버레이다([P9-UX-A](evidence/p9-ux-a/README.md)). 같은 대기 task를 다시 요청하면 같은 패널을 다시 연다. 다른 대기 task로 덮어쓰지 않는다. 단독 SyncReceiverActivity는 계속 사용할 수 있다.

## 실제 코드 경로

```text
inspect.js의 고정 Android adapter import
 → 기존 createNativeInspectionResults({adapter})
 → 앱 자산 전용 /native-inspection-v1 RPC (open/request/poll/verify/close)
 → 현재 InspectionActivity의 NativeInspectionBridge
 → 기존 SyncReceiverController + SyncReceiverClient + HTTPS transport
 → Native 명시적 Accept 성공 callback
 → Native 전용 immutable proof/원본 결과 저장소
 → poll delivery → C1 canonical SHA-256 재검증
 → verify RPC가 Native 저장소를 다시 조회·대조
 → 기존 C1 후보 → 사용자 ‘이 기록 적용’ → 기존 부품/상태/요약 projection
```

서버 clock 필드가 없는 응답(P7-C3 이전 서버, 현재 미배포 Render 포함)에서는 binding 단계에서 중단한다. 이후 사용자가 Native에서 수락해도 첫 차단 원인을 유지해 3D에 `SERVER_CLOCK_UNAVAILABLE`로 표시한다. 이를 우회하는 생산 테스트 어댑터는 없다. `NATIVE_3D_BRIDGE_IMPLEMENTED`는 전송 코드가 있다는 뜻이며 운영 완료/실제 ACCEPTED 전달 PASS를 뜻하지 않는다. 배포 연결 상태는 `NATIVE_3D_BLOCKED`다.

## 신뢰·proof·수명주기

- 자산 원점은 정확히 `https://carscope-inspection.invalid/index.html`이다. 다른 origin/port/page/frame/navigation/fragment/채널은 거부한다. `DebugWebScreen`이 현재 WebView 인스턴스, main-page 위치, 동일 자산 Referer와 전용 GET subresource 경로를 확인한다. main-frame navigation은 차단한다. WebView URL은 UI callback에서 캡처하며 IO thread에서 WebView API를 호출하지 않는다. CSP의 default-src none/connect-src self도 유지한다.
- `addJavascriptInterface`, 일반 postMessage, 전역 adapter/receive 함수, localStorage, URL fragment로 결과를 받지 않는다. RPC JSON은 제한된 명령/검증 식별자뿐이다. ACCEPTED/result/proof를 입력하는 명령은 없다. QR·receiver·submit·생성 credential은 JS 및 proof 저장소에 들어가지 않는다.
- Native controller는 HTTP decode 후 원본 `receivedAt`/`acceptedAt`을 상태에 보존한다. `explicitlyAccepted`는 **이 소유자의 실제 accept 요청 성공**에서만 설정한다. polling의 ACCEPTED/RESULT_SUBMITTED는 전달 자격이 없다. 제출 후 receipt 시각이 바뀌어도 거부한다.
- binding은 localSessionId/generation, syncSessionId, 정확한 taskId/partId, 원본 expiry, 보수적인 서버 시각 상한을 고정한다. IDs/digest/원본 결과/수신·수락 시각을 검증한 뒤 Native가 proofId를 발급한다. 중복 Accept는 처음 proof를 유지한다. verifyAccepted는 입력을 echo하지 않고 이 Native 저장소의 결과를 재해시하고 보관된 proof와 정확히 대조한다.
- Native UI 열기 콜백도 localSessionId/generation/taskId를 캡처한다. 현재 요청인지 확인하고 이전 controller 세대를 reset한 뒤에만 수신 콜백을 arm한다. 새 요청 등록과 UI 실행 사이에 도착한 이전 HTTP callback은 binding을 만들 수 없다.
- Native `onPause`에서 binding/proof를 폐기하고 `onStop`에서 기존 receiver의 HTTP/poll/provisioning/credential을 닫는다. destroy는 영구 폐기한다. 저장 상태/프로세스 싱글턴에 권한을 넣지 않는다. 재생성 시 새 owner이며, 기존 WebView 세션은 새 로컬 점검을 시작해야 한다. 이전 generation의 open도 재사용하지 않는다. renderer 종료 시 현재 WebView를 없애고 Activity를 종료한다.
- 상속한 `FLAG_SECURE`는 Native 패널이 보이는 동안만 켠다. QR·수신 결과를 보호하되 기존 3D 화면의 캡처를 막지 않는다. stop 없는 pause로 bridge가 폐기되면 패널도 닫아 잠금 해제된 receiver를 남기지 않는다.
- C1 소비자의 검증·원본 timestamp·별도 모바일 후보/명시 선택·17개 매핑·로컬 타이어/SDK 분리·재질 복구를 유지한다. LCW 등 미구현 형상은 기존 목록 상세를 사용한다. 이미 사용자가 선택한 보고는 C1의 기존 정책대로 전달 종료 표시와 함께 로컬 점검 종료까지 보존하며, 새 후보 적용은 막는다.

## 서버 인계 및 검증

서버 시각 차단의 근거·최소 제안은 [시각 계약안](contracts/p7-c2-server-clock-proposal.md)을 참조한다. Sync 서버/모바일 AR/DB/Render/Geometry/Release 정책은 변경하지 않는다.

검증 명령·환경·PASS/NOT_RUN/BLOCKED는 [검증 기록](p7-c2-validation.md)에 구분한다. Native test와 브라우저 테스트의 synthetic 입력은 실차·스마트폰·Render 광학 E2E 성공이 아니다. 실제 스마트폰 E2E는 서버 계약이 준비된 후에 진행한다.
