# P9-XR-C WebXR 모바일 점검 통합

P9-XR-B의 공간 고정 마커를 워셔액 점검 화면에 선택 기능으로 넣었다. 사용자는 2D 카메라, 3D AR, 카메라 없는 점검 중에서 고른다. 기본은 꺼져 있다.

**현재 판정:**

- `WEBXR_INSPECTION_INTEGRATED`: 점검 화면과 QR v2 진입 경로에 통합.
- `WEBXR_SYNTHETIC_VERIFIED`: 실제 Chrome, 실제 동기화 HTTP와 가짜 XR 런타임으로 검증.
- `NOT_RUN_DEFERRED_TO_E2E`: Z Flip8과 실제 QR E2E는 사용자 결정으로 최종 통합 단계로 연기. PASS로 기록하지 않는다.

**미리 알아 둘 제약:** 운영 Native QR이 여는 Render에서는 이 기능이 나타나지 않는다. [P11-XR](p11-xr-webxr-render-entry.md)이 화면을 P11로 통합하고 Render 진입점을 준비했으며, 활성화는 승인 대상이다. 아래의 화면 구성과 Render 항목은 P11-XR이 대체한다.

## 사용자 흐름

```text
워셔액 점검 ┬ 카메라로 점검 시작 (2D)
            ├ 3D AR로 위치 찾기 · 실험 → 안내 화면 → AR 시작 → 표면 조준 → 탭으로 위치 지정
            │     → 위치 다시 지정 / 표시 제거
            │     → 체크리스트로 ─────────────────┐
            │     → AR 종료 → 체크리스트로 / 2D 카메라로 / AR 다시 시작
            └ 카메라 없이 점검하기 ─────────────────┤
                                                    ▼
                              기존 체크리스트 → 사용자가 결과 확정 → (QR v2) 결과 전송
```

진입 버튼은 시작, 위치 찾기, 셀프 점검 단계에 나타난다. 결과 단계 이후에는 나타나지 않는다. 다른 16개 부품과 잘못된 QR에는 나타나지 않는다.

미지원 기기에서는 버튼 대신 시작 단계에 이유를 한 줄로 보여 주며 2D와 수동 점검은 그대로다. 세션 실패와 3D 모듈 로드 실패는 안내 화면에 이유를 표시하고 2D 카메라나 체크리스트로 돌아가게 한다.

## 진입 경로 조사

실제 QR v2 경로는 로컬 AR-01 페이지와 다르다.

| 호스트 | 진입 파일 | QR v2 | WebXR 플래그 |
|---|---|---|---|
| `mobile-ar-poc/server.mjs`, staging | `app-entry.mjs` | 없음(로컬 전용) | `--webxr-guide` 또는 환경변수 |
| `inspection-sync-poc` `mobile-dev-server.mjs` | `mobile-dev-entry.mjs` | 있음 | 환경변수 |
| `inspection-sync-poc` `https-mobile-service.mjs` | `mobile-dev-entry.mjs` | 있음 | 환경변수 |
| `render-stateful.mjs`, `render-preflight.mjs` | `mobile-dev-entry.mjs` | 있음 | **연결하지 않음** |

두 진입 파일 모두 `app.mjs`의 `startWasherInspectionPage`로 모이므로 통합 지점을 여기에 두었다.

## 점검 상태와 인증 컨텍스트

**같은 문서에서 실행해 해결했다.** 독립 페이지 `/webxr/`는 제거했다.

| 대상 | 위치 | 보장 |
|---|---|---|
| 체크 항목, 시도 ID, 단계 | 페이지 메모리의 `state` | 안내 동안 그대로 유지 |
| invite, submit token | `MobileSync`, `SyncClient`의 private 필드 | 페이지 이동이 없어 다시 전달할 필요가 없음 |
| 3D 마커, 앵커 | XR 세션 | 세션과 함께 사라지고 기록에 들어가지 않음 |

- 토큰이 든 fragment는 진입 파일이 안내 코드가 실행되기 전에 지운다. 안내는 URL, storage, 네트워크를 쓰지 않는다. `webxr-poc.test.mjs`가 소스를, `webxr-qr-browser.mjs`가 실제 DOM, 주소, `history.state`, storage, 요청 URL과 본문을 검사한다.
- **뒤로 가기:** 페이지를 떠나면 QR v2 연결을 복구할 수 없으므로, 안내를 열 때 같은 URL로 history 항목을 하나 쌓아 Back이 안내만 닫게 한다.
- **결과:** 안내는 `reduce`를 직접 호출하지 않는다. 사용자가 고른 경우에만 기존 버튼과 같은 이벤트(`START`, `TO_CHECK`)를 보낸다. `USE_CAMERA`만 새로 추가했으며, 수동 체크리스트에서 답을 유지한 채 2D 카메라로 옮긴다.
- **세션:** `/v1/sessions`, `/v1/claim`을 추가로 호출하지 않는다. 안내 중에는 기존 상태 조회만 계속되어 차량 측 취소가 돌아온 뒤 표시된다.

**결과 계약은 그대로다.** 3D AR을 써도 `aids.cameraUsed`, `aids.locationMarked`는 바뀌지 않으므로 기록만 보고 3D AR 사용 여부를 알 수 없다. 이를 기록하려면 계약 변경이 필요해 하지 않았다.

## 카메라 수명주기

| 시점 | 동작 |
|---|---|
| 안내 열기 | XR 요청 전에 `getUserMedia` 트랙 중지. 진행 중인 카메라 요청은 늦게 와도 폐기 |
| 안내 동안 | `canCamera`가 false이므로 2D 카메라를 시작할 수 없음 |
| 안내 닫기 | 어떤 카메라도 자동으로 켜지 않음. 사용자가 선택 |
| 세션 `hidden`, 시스템 종료, Back, `pagehide`, 시작 중 취소 | 세션 종료, Hit Test source·앵커·렌더러 해제 |

세션이 `visible`인데 문서만 `hidden`인 경우는 세션을 끝내지 않는다. 기기가 AR 중에 문서를 숨김으로 보고한다면 AR이 시작하자마자 꺼지기 때문이다. 백그라운드 전환 때 세션 쪽 상태가 함께 바뀌는지는 실기기에서 확인해야 한다.

## 실험 기능 제어

- **기본은 꺼짐.** 플래그가 없으면 페이지 표시, 파일 제공, `xr-spatial-tracking` 권한 정책이 모두 없다. 기본 staging의 `index.html`은 원본과 바이트까지 같다.
- **스위치:** `CARSCOPE_WEBXR_GUIDE=EXPERIMENT`. 다른 값이면 서버가 시작을 거부한다. 정적 서버는 `--webxr-guide`도 받는다.
- **전달:** 호스트가 `<body data-webxr-guide="enabled">`로 표시한다. URL이나 클라이언트에서 켤 수 없다.
- **Render:** `render-stateful.mjs`가 값을 읽지 않는다. `webxr-flag.mjs`가 Render import closure 밖에 있어 기존 `ENV_CANNOT_ENABLE_AUTH` 게이트가 그대로 PASS이고, 끌어들이면 FAIL한다.
- **Vercel:** `vercel.json`은 바꾸지 않았다. `xr-spatial-tracking`은 브라우저 기본 허용에 의존하며 정적 배포에는 QR v2가 없다.

## 검증

```powershell
Set-Location C:\dev\CarScope-p9-webxr\tools\mobile-ar-poc
npm ci --ignore-scripts
npm run check
npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p9-xr-c\YOUR-RUN-ID'
npm run test:browser:webxr
```

`test:browser:webxr`는 `webxr-browser.mjs`(실제 점검 화면, Chrome 가짜 카메라)와 `webxr-qr-browser.mjs`(실제 `mobile-dev-entry.mjs`, 세션 서비스, 동기화 HTTP)를 실행한다. XR 런타임은 가짜이므로 **페이지 로직과 렌더링의 검증이며 실제 추적 품질이나 실기기 동작의 증거가 아니다.** 결과는 [증거 인덱스](evidence/p9-xr-c/README.md)에 있다.

## 최종 E2E 전에 필요한 작업

절차는 [P9 E2E 체크리스트 I장](p9-e2e-checklist.md#i-webxr-3d-ar-안내-p9-xr-c)에 있다.

1. **개발 QR 경로로 먼저 시험.** 공개 배포 없이 USB 포트 전달로 가능하다. 실제 QR v2 프로토콜을 쓰지만 세션은 로컬 시험용이며 Native와 Render를 거치지 않는다.
2. **Native QR → Render 경로:** P11-XR이 환경변수 없는 별도 진입점으로 준비했다. 활성화 조건은 [승인 항목](p11-xr-webxr-render-entry.md#활성화-전-승인-항목)을 본다.

## 실기기 미검증 항목

- 세션 시작과 권한 프롬프트, 실제 Hit Test·Anchor.
- 구조가 바뀐 DOM overlay: 루트가 `body` 직계에서 `#xr-guide` 내부로 옮겨졌다. 기존 페이지는 `display: none`으로 숨긴다.
- AR 중 시스템 Back이 세션 종료와 `popstate` 중 어느 쪽으로 오는지. 코드는 양쪽을 처리한다.
- 앱 전환, 화면 잠금, 접기·펼치기, 회전. 합성 검증은 이벤트만 흉내 냈다.
- AR 종료 직후 `getUserMedia` 재시작의 하드웨어 전환 시간. 기기가 카메라를 바로 내주지 않으면 2D 카메라가 오류를 표시할 수 있다.
- 공간 고정 품질, 엔진룸 표면 검출, 표시 오차, 발열, 배터리, 프레임률.

## 알려진 제약

- 체크리스트로 돌아가면 3D 표시가 사라진다. 앵커는 세션 안에서만 유효하다. 다시 보려면 AR을 다시 시작해 지정한다.
- 3D AR은 탭이 두 번 필요하다(안내 열기, AR 시작). Three.js를 미리 받아 두어야 `requestSession`의 사용자 동작을 소모하지 않기 때문이다.
