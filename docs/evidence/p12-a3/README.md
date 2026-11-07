# P12-A3 증거 인덱스

합성 모바일 Chrome 결과다. **실제 Z Flip8, 실제 Render에서 실행하지 않았다.** 결정과 변경은 [P12-A3](../../p12-a3-schematic-only.md)에 있다.

환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. 캡처, 갤러리, 결과 JSON은 작업 PC `C:\CarScope-External\p12-a3\run2`에 있고 Git에 넣지 않았다.

## 로컬 실행

| 명령 | 결과 | 범위 |
|---|---|---|
| `tools/mobile-ar-poc: npm run check`, `npm test` | PASS 150, 실패 0 | 데이터, 문구, 생성기 일치, 호스트 |
| `node test/part-guide-browser.mjs` | PASS 12개 그룹 | 17개 점검 부품, 정보 페이지 2개, 확대, 실패, 지연, QR, WebXR |
| `webxr-browser`, `webxr-qr-browser` | PASS 14개, 7개 그룹 | WebXR, QR v2 (가짜 XR 런타임) |
| `ux`, `mobile-ar`, `browser`, `tire`, `charge`, `brake` browser | 모두 PASS | 기존 모바일 회귀 |
| `tools/inspection-sync-poc: npm test` | 263 중 PASS 227, 실패 0, SKIP 36 | SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
| `npm run test:mobile-browser` | PASS | QR v2 Edge E2E |
| `deployment-preflight static` | PASS 13, FAIL 0, MANUAL 1, BLOCKED 1 | 열린 2건은 기존과 같다 |

## 확인한 것

- **상태:** 19개 모두 `SCHEMATIC_ONLY`(`part-guide.test.mjs`).
- **문구:** 17개 점검 화면과 정보 페이지 2개의 안내에 `사진`, `출처`, 배지가 없다. 그림마다 자기 설명이 있고, `설명용 그림이며 실제 차량과 위치·형태가 다를 수 있습니다`는 안내 맨 아래에 한 번만 있다. 확대 화면은 그림별 설명만 보여 준다.
- **데이터:** `imageSource`, `licenseStatus`와 사진 검증 코드는 그대로이며 38장 모두 검사를 통과한다. 사진 고정 데이터는 여전히 차종과 출처를 표시하고, 차종이나 권리가 없는 사진은 표시되지 않는다.
- **SVG:** `npm run build:guide-art`를 다시 실행해도 38장의 Git 변경이 없다. 생성기도 바뀌지 않았다.
- **유지:** 확대·닫기, 이미지 실패 대체, 접힌 상태에서 요청 없음, 답변과 QR 유지, WebXR 진입·종료 상태. 기존 시험이 그대로 PASS다.

캡처를 직접 열어 확인했다: `p12-a\intro-open.png`, `p12-a\info-ev-charge.flap.png`. 갤러리는 이번 정리의 영향을 받지 않아 다시 만들지 않았다(`run1\gallery`).

## NOT_RUN

| 항목 | 상태 |
|---|---|
| Z Flip8 화면, 실제 터치 | NOT_RUN |
| 실제 Render 제공 | NOT_RUN. 배포하지 않았다 |
| 그림만으로 실차에서 부품을 찾을 수 있는지 | NOT_RUN |
| `webxr-render-browser.mjs` 로컬 | NOT_RUN. CI `webxr-render` 범위 |
