# P11-XR 증거 인덱스

합성 XR 런타임 결과다. **실제 스마트폰, 실제 추적, Native QR, 실제 Render에서 실행하지 않았다.** 설계는 [P11-XR](../../p11-xr-webxr-render-entry.md)이다.

환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38, Edge(Sync 스위트). 원본 캡처와 결과 JSON은 작업 PC `C:\CarScope-External\p11-xr\run1\p9-xr-c`에 있고 Git에 넣지 않았다.

## 로컬 실행

| 명령 | 결과 | 범위 |
|---|---|---|
| `tools/mobile-ar-poc: npm run check` | PASS | 문법 |
| `tools/mobile-ar-poc: npm test` | PASS 130, 실패 0 | 상태 머신, 컨트롤러, 호스트 경계 |
| `node test/webxr-browser.mjs` | PASS | 실제 점검 화면, Chrome 가짜 카메라, 가짜 XR 런타임 |
| `node test/webxr-qr-browser.mjs` | PASS 7개 그룹 | 실제 `mobile-dev-entry.mjs`, 동기화 HTTP, 메모리 저장소 |
| `browser`, `tire-browser`, `charge-browser`, `brake-browser`, `mobile-ar-browser`, `ux-browser` | 모두 PASS | 플래그 없는 2D·17개 부품·P11 UX 회귀 |
| `tools/inspection-sync-poc: npm run check` | PASS | 문법 |
| `tools/inspection-sync-poc: npm test` | 262 중 PASS 226, 실패 0, SKIP 36 | SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
| `npm run test:browser`, `npm run test:mobile-browser` | PASS | Edge 디버그 페이지, QR v2 Edge E2E |
| `node test/webxr-render-browser.mjs` | **NOT_RUN (로컬)** | 로컬 Docker daemon이 꺼져 있고 임시 PostgreSQL 바이너리 실행은 권한 정책에 막혔다. CI `webxr-render`에서 실행 |

## 새로 확인한 것

- **방법 선택:** AR 지원 시 3가지 방법이 순서대로 390×844 첫 화면 안에 있고 하단 버튼이 없다. 미지원이면 선택 화면 없이 기존 버튼과 이유 한 줄.
- **앱 전환:** 세션 숨김과 문서 숨김을 합성했을 때 세션 종료, 자원 해제, 폴링 중지(2.6초 동안 요청 0), 복귀 뒤 재개, 답변·시도 ID 유지.
- **재진입:** 앱 전환 → AR 다시 시작 → Back → AR → 종료 → 체크리스트. 세션 3개 모두 종료, claim 1회, 전송 0회. 이어서 같은 인증 정보로 전송과 수락.
- **QR 폴백:** 권한 거부와 미지원 기기 모두 연결을 유지한 채 전송까지 완료. 미지원 기기는 Three.js를 받지 않음.
- **빠른 재진입:** 닫기 직후 같은 틱에 다시 열어도 Back이 안내만 닫음. 코드 수정 없이 PASS.
- **Render 게이트:** `WEBXR_EXPERIMENT_ENTRY_ONLY`의 우회 12가지를 복사본에 넣어 모두 FAIL 확인(`webxr-render-activation.test.mjs`). 환경변수 스위치는 기존 `ENV_CANNOT_ENABLE_AUTH`도 FAIL.
- **시작 거부:** `three`가 없는 복사본에서 진입점이 `WEBXR_GUIDE_ASSET_MISSING` 한 줄로 종료. 안전하지 않은 설정은 기본 명령과 같은 코드로 종료.

캡처를 직접 열어 확인했다: `entry-intro`, `ready`, `placed`, `ended`, `permission-denied`, `entry-locate`. DOM 스크린샷에는 XR 프레임이 담기지 않아 AR 화면 배경이 비어 있다. 3D 프레임은 `frame-*.png`다.

## 바꾸지 않은 것

`index.html`, `style.css`, `self-inspection.mjs`, `inspection-sync-poc/public`, `protocol.mjs`, `sessions.mjs`, DB 스키마, `tools/three-poc`, `inspect.js`, P10 카메라 파일. `git diff origin/main`으로 확인했다.

이 PR에서 바꾼 기존 테스트는 문구, 버튼 위치, Render 소스 검사뿐이다. Render 소스에 `webxr` 문자열이 없어야 한다는 검사는 `render-preflight.mjs`만 그대로 두고, `render-stateful.mjs`는 더 구체적인 게이트로 옮겼다. 안전 판정 조건이나 임계값은 완화하지 않았다.

## NOT_RUN

| 항목 | 상태 |
|---|---|
| Z Flip8 AR 세션, Hit Test, Anchor, DOM overlay | NOT_RUN |
| 실차 엔진룸 표면 검출, 표시 오차, 공간 고정 품질 | NOT_RUN |
| 실제 Back, 앱 전환, 탭 폐기, 잠금, 접기, 회전 | NOT_RUN |
| 실제 스마트폰 QR 스캔, Native QR | NOT_RUN |
| 실제 Render 배포, 운영 활성화 | NOT_RUN (승인 대상) |
| iOS Safari | NOT_RUN |

## CI

`.github/workflows/webxr-poc-ci.yml`에 `webxr-render` job을 추가했다. Linux `postgres:16` 서비스, 문서에 적은 Build Command, 실제 Start Command, Chrome, 가짜 XR 런타임이다. Render·실기기·Native를 포함하지 않는다. 실행 결과는 PR에 기록한다.
