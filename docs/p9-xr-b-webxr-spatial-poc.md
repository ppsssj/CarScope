# P9-XR-B WebXR 공간 고정 마커 PoC

워셔액 점검을 대상으로, 사용자가 지정한 실제 공간 위치에 3D 화살표를 남기는 격리된 화면이다. 경로는 `/webxr/`이고 소스는 `tools/mobile-ar-poc/public/webxr/`에 있다.

**현재 판정:**

- `WEBXR_POC_IMPLEMENTED`: 구현 완료.
- `WEBXR_SYNTHETIC_VERIFIED`: 데스크톱 Chrome과 가짜 XR 런타임으로 검증.
- `WEBXR_DEVICE_NOT_RUN`: 이 코드를 Z Flip8에서 실행한 적이 없음.

사용자가 같은 기기의 Chrome에서 확인한 공간 고정은 WebXR 공개 샘플의 결과이며 이 PoC의 결과가 아니다.

## 범위

| 포함 | 제외 |
|---|---|
| immersive-ar·Hit Test·Anchor 지원 검사 | AI 자동 부품 인식 |
| AR 세션 시작·종료, 수동 위치 지정 | 17개 전체 공간 앵커 |
| 3D 마커 배치·재지정·제거 | QR·세션 인증, Render·PostgreSQL 변경 |
| 추적 손실·세션 종료 대응, 2D 안내 복귀 | Android Native, 기존 점검 화면의 기본 동작 변경 |

점검 결과를 만들거나 저장하거나 전송하지 않는다. 마커를 남겨도 체크리스트 항목이 확인 처리되지 않는다.

## 사용자 흐름

```text
/webxr/ → 지원 검사 ┬ 미지원 → 이유 표시 → 2D 안내(/#v=1&task=washer-fluid)
                   └ 지원 → AR 시작(사용자 탭) → 표면 찾기 → 탭으로 위치 지정 → 3D 화살표
                       → 위치 다시 지정 / 표시 제거 / 체크리스트로 / AR 종료
```

세션 시작 실패(권한 거부 등)도 이유와 2D 안내, 재시도를 표시한다.

## 구조

| 파일 | 역할 |
|---|---|
| `webxr-state.mjs` | 순수 상태 머신과 화면 문구 |
| `webxr-capability.mjs` | 지원 검사, 세션 옵션, 시작 오류 분류 |
| `webxr-controller.mjs` | 세션, Hit Test source, Anchor의 수명 관리 |
| `webxr-view.mjs` | Three.js 마커·조준 원 렌더링 |
| `webxr-entry.mjs`, `index.html`, `webxr.css` | 화면 연결 |
| `../../webxr-modules.mjs` | PoC 파일 목록. `MOBILE_MODULES`와 분리 |

Three.js는 `tools/three-poc`와 같은 `0.160.0`이다. 미지원 기기에서는 내려받지 않는다.

### 격리

- 기본 `npm run serve`와 기본 staging 빌드, Sync 동일 출처 호스팅은 `/webxr/`을 제공하지 않는다(404).
- `npm run serve:webxr`, `--webxr-poc`, `POC_WEBXR_POC=1` 중 하나를 명시해야 포함된다.
- 기존 점검 화면에는 이 화면으로 가는 링크가 없다. CSP는 기존과 같다.
- 워셔액 문구는 기존 `WASHER_TASK`와 `CHECK_ITEMS`를 읽기만 한다.

### 마커의 상태 규칙

- **앵커 생성 시점:** `createAnchor`는 활성 프레임이 필요하므로, 탭은 요청만 남기고 다음 렌더 프레임의 Hit Test 결과로 생성한다.
- **재지정:** 새 앵커가 생긴 뒤에 이전 앵커를 삭제한다. 실패하면 기존 표시를 유지한다.
- **늦은 응답:** 세션 종료 후 도착한 앵커는 즉시 삭제한다.
- **추적 손실:** viewer pose가 없거나 위치가 추정값(`emulatedPosition`)이면, 또는 앵커 추적이 끊기면 마커를 그리지 않고 경고한다. 화면에 고정된 듯 보이는 잘못된 표시를 막기 위해서다. 추적이 돌아오면 같은 앵커로 복구한다.
- **앵커 미지원:** Hit Test 좌표로만 표시하고 그 사실을 화면에 알린다. 기준 공간 reset이 오면 표시를 지운다.
- **세션 종료:** Hit Test source와 앵커, 렌더러를 해제한다. 표시는 저장되지 않으며 재시작하면 다시 지정해야 한다.

Hit Test는 엔진룸처럼 평면이 적은 곳을 위해 `plane`과 `point`를 요청하고, 거부되면 기본값(`plane`)으로 재시도한다.

## 현재 2D AR과의 차이

| 항목 | 기존 2D (`/`) | WebXR PoC (`/webxr/`) |
|---|---|---|
| 표시 위치 | 화면 좌표. 휴대폰을 움직이면 어긋남 | 공간 좌표. 기기 추적으로 유지를 시도 |
| 카메라 | `getUserMedia` | XR 세션이 관리, JS가 프레임을 읽지 않음 |
| 파란색 후보 탐지 | 있음(휴리스틱) | 없음 |
| 위치 지정 | 화면 탭 | 표면 위 조준 원을 맞추고 탭 |
| 지원 범위 | 카메라가 되는 대부분의 브라우저 | ARCore와 WebXR이 있는 Android Chrome 계열 |
| 추적 상태 표시 | 해당 없음 | 끊김·불안정·앵커 중단을 구분 |
| 점검 기록 | 체크리스트로 확정 | 없음. 체크리스트로 복귀 |

## 검증

```powershell
Set-Location C:\dev\CarScope-p9-webxr\tools\mobile-ar-poc
npm ci --ignore-scripts
npm run check
npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p9-xr-b\YOUR-RUN-ID'
npm run test:browser:webxr
```

브라우저 검사는 실제 Chrome, WebGL(소프트웨어), Three.js, 서버 CSP 위에서 동작한다. XR 런타임은 `test/fake-webxr.mjs`의 가짜이며, 첫 시나리오만 Chrome 자체 WebXR의 미지원 경로를 쓴다. 가짜 런타임 시나리오는 가짜 카메라를 옮겼을 때 마커의 화면 위치가 투영 계산만큼 움직이는지 픽셀로 확인한다. **페이지 로직과 렌더링의 검증이며 실제 추적 품질의 증거가 아니다.**

결과 요약은 [증거 인덱스](evidence/p9-xr-b/README.md)에 있다.

## Z Flip8 실행 방법

WebXR은 secure context가 필요하므로 PC의 LAN IP를 HTTP로 열면 동작하지 않는다.

**A. USB 포트 전달 (권장, 공개 배포 없음).** `localhost`는 secure context이므로 HTTPS 인증서가 필요 없다.

```powershell
Set-Location C:\dev\CarScope-p9-webxr\tools\mobile-ar-poc
npm run serve:webxr
# 다른 터미널. 휴대폰의 USB 디버깅을 켠 뒤:
adb reverse tcp:4174 tcp:4174
# 휴대폰 Chrome에서 http://localhost:4174/webxr/ 열기
```

**B. 사설 HTTPS (Tailscale Serve 또는 운영자 인증서).** 기존 `POC_TLS_CERT`, `POC_TLS_KEY`, `POC_HOST`를 그대로 쓰고 `--webxr-poc`를 붙인다. [HTTPS_STAGING](../tools/mobile-ar-poc/HTTPS_STAGING.md) 참고.

**C. 보호된 Vercel 정적 배포 (사용자 승인 필요, 실행하지 않음).** 빌드 환경에 `POC_WEBXR_POC=1`을 지정한다. 기존 전용 프로젝트에 올리려면 승인이 필요하며, 플래그를 켠 빌드는 그 배포에서 PoC를 노출한다. `vercel.json`의 헤더는 그대로 두었으므로 `xr-spatial-tracking`은 브라우저 기본 허용에 의존한다. 이 경로를 쓰면 세션 시작을 먼저 확인한다.

### 실기기 체크리스트

모두 `WEBXR_DEVICE_NOT_RUN` 상태다. 기기·Android·Chrome 버전과 항목별 PASS/FAIL/NOT_RUN을 기록한다.

1. 지원 표가 세 항목 모두 지원으로 나오고, `AR 시작`이 카메라 AR을 연다.
2. 조준 원이 표면에 나타나고, 탭하면 그 자리에 화살표가 생긴다.
3. 패널의 버튼을 눌러도 화살표가 함께 배치되지 않는다.
4. 좌우로 걷고 가까이 다가가도 화살표가 실제 공간의 같은 지점에 머문다. 화면을 벗어났다 돌아와도 마찬가지인지 확인한다.
5. 렌즈를 가리거나 빠르게 흔들면 경고가 나오고 표시가 사라지며, 복구되면 다시 나타난다.
6. 위치 다시 지정, 표시 제거, 체크리스트 복귀, AR 종료가 동작한다.
7. 카메라 권한 거부와 시스템 Back, 앱 전환 후 복귀, 화면 회전, 접기·펼치기를 확인한다.
8. 실제 보닛을 열고 엔진룸에서 표면이 잡히는지, 화살표와 캡의 어긋남이 어느 정도인지 관찰한다.

## 미검증 항목과 제약

**실기기 미검증**

- 이 코드의 세션 시작, 실제 Hit Test·Anchor 동작, DOM overlay 표시와 `beforexrselect`.
- `point` 타입 요청의 실제 지원 여부.
- 공간 고정 품질과 드리프트, 추적 복구.
- 접기·펼치기, 회전, 앱 전환 중 동작.
- 엔진룸에서 표면 검출 여부와 표시 오차.

**호환성과 성능 제약**

- iOS Safari에는 immersive-ar WebXR이 없어 2D 안내로 복귀한다(미실행).
- ARCore 미지원 기기와 WebView는 대상이 아니다. 앵커와 DOM overlay는 선택 기능이라 기기마다 다를 수 있다.
- 어둡고 반사가 많거나 무늬 없는 표면에서는 Hit Test가 실패할 수 있다. 이때는 체크리스트로 돌아가 직접 확인한다.
- 깊이 가림 처리가 없어 화살표가 실제 물체 앞에 그려진다.
- 앵커는 세션 안에서만 유효하며 표시 위치를 저장하지 않는다.
- 발열·배터리·프레임률은 측정하지 않았다. Three.js 최소 파일은 약 670KB이고 지원 기기에서만 내려받는다.
- 추적 상태 문구에 지연 처리를 넣지 않았다. 기기에서 깜빡이면 후속으로 조정한다.

## 후속 AI 모델 연결 지점

구현하지 않았다. 연결할 경우 지점은 다음과 같다.

- **입력:** XR 세션에서 카메라 프레임을 읽으려면 별도 기능(Raw Camera Access)이 필요하며, 기기 지원과 권한 문구를 먼저 검증해야 한다.
- **좌표 변환:** 모델의 화면 좌표를 `XRRay`로 바꿔 `offsetRay` 또는 일회성 Hit Test source로 표면 위 점을 얻는다.
- **연결 위치:** `webxr-controller.mjs`의 `placeFromFrame`은 앵커 생성만 맡으므로, 후보 Hit Test 결과를 이 함수에 넘기면 수명 관리를 재사용할 수 있다.
- **확정 규칙:** 모델 결과는 후보로만 표시하고 사용자가 확정해야 앵커를 만든다. 별도 라벨 데이터로 평가하기 전까지 인식 정확도를 표시하지 않는다.
