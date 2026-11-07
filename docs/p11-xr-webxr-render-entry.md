# P11-XR WebXR 모바일 점검 통합과 Render 진입 경로

P9-XR-C의 3D AR 위치 찾기를 P11 모바일 화면에 통합하고, Render에서 선택적으로 켤 수 있는 경로를 준비했다. 대상은 워셔액 점검뿐이다. **기본은 꺼져 있으며 Render 배포와 운영 활성화는 하지 않았다.**

**현재 판정:**

- `WEBXR_P11_UI_INTEGRATED`: 방법 선택, 안내, AR 화면을 P11 화면과 문구로 통합.
- `WEBXR_RENDER_ENTRY_PREPARED`: 별도 진입점 준비. 실제 Render에는 적용하지 않음.
- `WEBXR_SYNTHETIC_VERIFIED`: 가짜 XR 런타임까지. 실제 기기·추적은 `NOT_RUN`.

## 사용자 흐름

```text
차량 3D 화면 → 모바일 점검 → QR 스캔 → 자동 연결 → 안전 확인
  → 점검 방법을 골라 주세요
     ├ 3D AR로 위치 찾기 · 실험 → 안내 → AR 시작 → 표면 조준 → 탭으로 화살표 배치
     │     → 공간 고정 상태 확인 → 체크리스트로 ───┐
     ├ 일반 카메라로 찾기 → 위치 찾기 → 다음 ─────┤
     └ 카메라 없이 점검하기 ───────────────────────┤
                                                 ▼
                        기존 체크리스트 → 결과 확인 → 사용자가 전송
```

| 화면 | 동작 |
|---|---|
| 방법 선택 | AR 지원 기기의 시작 단계에서만 세 줄로 표시하고 하단 버튼을 대신한다. 실험 기능을 채운 버튼으로 권하지 않는다. |
| 미지원 기기 | 선택 화면 없음. 이유 한 줄과 기존 하단 버튼, 수동 점검. Three.js를 받지 않는다. |
| 공간 고정 상태 | 앵커는 `공간에 고정됨 · 내가 지정한 위치`, 표면 좌표는 경고 색의 `표면에 표시됨 · 공간 고정 안 됨`. 추적 상태만 말하며 부품 인식이나 정확도를 뜻하지 않는다. |
| 권한 거부·세션 실패 | 이유를 표시하고 체크리스트, 일반 카메라, 다시 시작 중에서 고른다. |

`index.html`, `style.css`, 상태 머신은 바꾸지 않았다. 플래그가 꺼지면 페이지는 `webxr` 파일을 요청하지 않으므로 화면이 그대로다. 위치 찾기·셀프 점검 단계의 진입 버튼은 P9-XR-C와 같은 자리에 있다.

**재사용:** `webxr-controller`, `webxr-capability`, `webxr-view`, 상태 전이, 카메라 교대, history 처리, `USE_CAMERA`, 가짜 XR 런타임. Hit Test와 Anchor 로직은 고치지 않았다. 바꾼 것은 안내 화면 구성, 문구, 진입 표시다.

## 상태와 인증 정보

P9-XR-C의 구조 그대로 같은 문서에서 실행한다. 토큰과 답변은 페이지 메모리에만 있으므로 페이지가 유지되는 한 AR을 몇 번 거쳐도 그대로다.

| 상황 | 보장 | 시험 |
|---|---|---|
| AR 종료, 재진입 | claim 1회, 답변·시도 ID 유지, 세션·앵커·Hit Test source 해제 | `webxr-qr-browser.mjs` |
| Back | AR만 닫고 페이지에 남음. fragment가 돌아오지 않음 | 〃 |
| 앱 전환(세션 숨김) | 세션 종료, 숨긴 동안 폴링 중지, 복귀 뒤 재개, 같은 인증 정보로 전송 | 〃 (이벤트를 합성) |
| 빠른 재진입 | 닫기 직후 다시 열어도 Back이 안내만 닫음 | `webxr-browser.mjs` |
| AR 중 차량 취소 | 복귀 뒤 표시 | `webxr-qr-browser.mjs` |

**복구하지 못하는 경우:** OS가 백그라운드 탭을 폐기하거나 페이지를 새로 고치면 메모리의 토큰과 답변이 사라진다. 일회용 invite는 이미 쓰였으므로 새 QR이 필요하다. 저장소에 토큰을 두지 않는 것은 기존 인증 계약이라 바꾸지 않았다. **AR 중 앱 전환에서 실제로 탭이 폐기되는지는 실기기에서만 알 수 있다.**

## Render 진입 경로

P9-H2와 같은 방식이다. **환경변수를 추가하지 않았다.** 코드 배포로는 바뀌지 않고, 운영자가 Start Command를 바꿔야만 켜진다.

| Start Command | WebXR |
|---|---|
| `node tools/inspection-sync-poc/src/render-stateful.mjs` (현재) | 꺼짐. 파일 404, 권한 없음, 표시 없음. 어떤 환경변수로도 켜지지 않음 |
| `node tools/inspection-sync-poc/src/render-webxr-experiment.mjs` | 켜짐. 세션·인증·결과는 같은 모드의 기본 명령과 같음 |

| 항목 | 켜졌을 때 |
|---|---|
| 페이지 | `data-webxr-guide="enabled"` 표시 |
| 파일 | `webxr-modules.mjs`에 나열한 7개만 제공. `three` 패키지의 다른 파일은 404 |
| `Permissions-Policy` | `, xr-spatial-tracking=(self)` 추가 |
| CSP | **변경 없음** |
| `/healthz` | `mobileGuide: "WEBXR_EXPERIMENT"` 추가. `deployment-preflight probe`가 `RENDER_WEBXR_GUIDE` `MANUAL`로 표시 |
| 빌드 파일 누락 | `WEBXR_GUIDE_ASSET_MISSING`으로 시작 거부. 실패할 버튼을 내보내지 않으며 DB에 접속하지 않음 |

`WEBXR_EXPERIMENT_ENTRY_ONLY` 게이트가 이 경계를 고정한다. 기본 CLI가 옵션을 넘기거나, 기본값이 켜지거나, 다른 파일이 옵션을 넘기거나, 진입점이 환경을 읽거나 History 경로를 열거나 모듈을 추가하면 FAIL이다. `webxr-flag.mjs`는 계속 Render import closure 밖에 있고, `ENV_CANNOT_ENABLE_AUTH`는 변경 없이 PASS다. `CARSCOPE_WEBXR_GUIDE`는 개발 서버 전용이다.

### 활성화 전 승인 항목

**아무것도 적용하지 않았다.** 각각 사용자 승인이 필요하다.

1. **Build Command에 설치 추가.** 현재 빌드는 `tools/inspection-sync-poc`만 설치한다.
   ```text
   npm install --prefix tools/inspection-sync-poc --ignore-scripts --no-audit --no-fund --package-lock=false && npm ci --prefix tools/mobile-ar-poc --omit=dev --ignore-scripts --no-audit --no-fund && node --check tools/inspection-sync-poc/src/render-webxr-experiment.mjs
   ```
   `three`와 `qrcode`만 설치되고 Playwright는 없다. 모바일 페이지 외부 의존성이 처음 운영 빌드에 들어가므로 검토가 필요하다.
2. **Start Command 변경**과 재배포. 시뮬레이터 모드는 `CARSCOPE_AVD_SIMULATOR_MODE`로 기존과 같이 결정된다.
3. **권한 정책 완화:** 이 서비스의 페이지에 `xr-spatial-tracking=(self)`가 추가된다.
4. **공개 범위:** 켜진 동안 이 서비스의 워셔액 QR을 여는 모든 지원 기기에 실험 기능이 보인다. 사용자별 제한은 없다.
5. **AVD History 시연과 동시에 쓸 수 없다.** Start Command는 하나이고 `render-avd-history-demo.mjs`와 별개다. 함께 필요하면 별도 결정과 PR이 필요하다.

**원복:** Start Command를 되돌리고 재배포한다. Build Command의 추가 설치는 남아도 쓰이지 않는다. 저장 데이터와 스키마에 변화가 없다.

## 검증

```powershell
Set-Location tools\mobile-ar-poc
npm ci --ignore-scripts
npm run check; npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p11-xr\YOUR-RUN-ID'
npm run test:browser:webxr
# 격리된 loopback PostgreSQL이 있을 때. 없으면 실행을 거부하며 NOT_RUN이다.
$env:PG_TEST_URL = 'postgresql://...'
npm run test:browser:webxr:render
```

`webxr-render-browser.mjs`는 실제 Start Command를 자식 프로세스로 띄우고 실제 PostgreSQL, 실제 QR v2 HTTP, Chrome을 쓴다. Render edge는 Host와 전달 스킴을 붙이는 작은 프록시로 대신하고 XR 런타임은 가짜다. **Render, 실제 기기, Native QR의 증거가 아니다.** 결과는 [증거 인덱스](evidence/p11-xr/README.md)에 있다.

## 실기기 미검증 항목

절차는 [E2E 체크리스트 I장](p9-e2e-checklist.md#i-webxr-3d-ar-안내-p9-xr-c)에 있다. 아래는 모두 `NOT_RUN`이다.

- Z Flip8과 실차: AR 시작, 권한 프롬프트, 실제 Hit Test·Anchor, DOM overlay, 엔진룸 표면 검출, 표시 오차, 드리프트.
- 시스템 Back, 앱 전환, 화면 잠금, 접기·펼치기, 회전의 실제 이벤트. 특히 탭 폐기로 연결이 끊기는지.
- AR 직후 일반 카메라 재시작, 발열, 배터리, 프레임률.
- Native QR → 실제 Render → AR → 전송 전체 경로, 공인 HTTPS에서의 권한 정책.

## 알려진 제약

- 체크리스트로 돌아가면 3D 표시가 사라진다. 화면에도 알린다.
- 3D AR은 탭이 두 번 필요하다(안내 열기, AR 시작).
- AR 사용 여부는 결과에 기록되지 않는다. 결과 계약을 바꾸지 않았다.
- 차량 3D 화면 쪽 코드는 이번 PR에서 바꾸지 않았다. QR 생성까지는 P9-UX의 기존 경로다.
- 실차 부품 자동 인식, AI 탐지, 3D 모델과 실차 좌표 정합은 범위 밖이다.
