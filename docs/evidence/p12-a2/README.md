# P12-A2 증거 인덱스

합성 모바일 Chrome 결과다. **실제 Z Flip8, 실제 폴더블, 실제 Render에서 실행하지 않았다. 실제 부품 사진은 0장이다.** 설계와 부품별 현황은 [P12-A2](../../p12-a2-all-part-guides.md)에 있다.

환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. 캡처, 갤러리, 결과 JSON은 작업 PC `C:\CarScope-External\p12-a2\run2`에 있고 Git에 넣지 않았다.

| 산출물 | 위치 |
|---|---|
| HTML 갤러리 | `gallery\index.html` |
| 연락처 시트 | `gallery\contact-sheet.png` |
| 대표 화면 | `p12-a\info-ev-battery.pack.png`, `info-ev-charge.flap.png`, `tire-check-open.png`, `intro-open.png`, `webxr-methods.png`, `zoom.png`, `image-failed.png` |
| 재생성 | `npm run build:guide-art`, `npm run guide:gallery` |

## 그림과 라이선스

38장 모두 `tools/mobile-ar-poc/public/guide-<부품>-{area,detail}.svg`, 종류 `SCHEMATIC`, 상태 `CARSCOPE_ORIGINAL`, 차종 없음. 외부 그림과 사진을 복제하거나 옮겨 그리지 않았다. `photoStatus`는 19개 모두 `PHOTO_NEEDED`다.

## 로컬 실행

실행 결과는 PR에 기록한 최종 커밋 기준이다.

| 명령 | 결과 | 범위 |
|---|---|---|
| `tools/mobile-ar-poc: npm run check`, `npm test` | PASS 148, 실패 0 | 데이터, 표시 규칙, 생성기 일치, 호스트 |
| `node test/part-guide-browser.mjs` | PASS 12개 그룹 | 17개 점검 부품, 정보 페이지, 확대, 실패, 지연, QR, WebXR |
| `webxr-browser`, `webxr-qr-browser` | PASS 14개, 7개 그룹 | WebXR, QR v2 (가짜 XR 런타임) |
| `ux`, `mobile-ar`, `browser`, `tire`, `charge`, `brake` browser | 모두 PASS | 기존 모바일 회귀 |
| `tools/inspection-sync-poc: npm test` | 263 중 PASS 227, 실패 0, SKIP 36 | SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
| `npm run test:mobile-browser` | PASS | QR v2 Edge E2E |
| `deployment-preflight static` | PASS 13, FAIL 0, MANUAL 1, BLOCKED 1 | 열린 2건은 기존과 같다 |

## 개발 중 찾은 결함

테스트 조건을 완화하지 않았다. 아래 3과 4는 사람이 화면을 보고 찾았고 그 뒤 검사를 추가했다.

1. **대체 텍스트 중복(4장):** 전조등의 좌우, 상향·하향 설명이 같았다. 스크린 리더로 구별되지 않아 문구를 고쳤다.
2. **판별식 오판(2건):** "열어 확인하지 마세요"를 권유로, `location.hash` 읽기를 쓰기로 잡았다. 권유와 쓰기만 잡도록 좁혔다.
3. **라벨 겹침:** 충전구 라벨이 `오른쪽` 글자와, `크게 보기` 표시가 타이어·배터리 팩 그림의 글자와 겹쳤다. 표시를 그림 아래 띠로 옮기고 겹침 검사를 추가했다.
4. **안전 문구 모순:** 배터리 팩에 `찾아볼 곳: 차 바닥 아래`가 나왔다. 점검 없는 부품은 `있는 곳`으로 바꾸고 검사를 추가했다.

**미해결 1건:** `guide:gallery`가 첫 일괄 실행에서 한 번 비정상 종료했고 바로 다시 실행하니 정상이었다. 오류 내용을 남기지 못해 원인은 미확인이다. 제품 코드가 아닌 저장소 밖 산출물 도구다.

## NOT_RUN

| 항목 | 상태 |
|---|---|
| Z Flip8 화면, 접기·펼치기, 실제 터치와 핀치 | NOT_RUN |
| 실제 Render 제공 | NOT_RUN. 배포하지 않았다 |
| 그림과 실제 차량의 대조, 실제로 찾는 데 도움이 되는지 | NOT_RUN |
| 정비·안전 전문가의 문구 검토 | NOT_RUN |
| 스크린 리더 | NOT_RUN. 대체 텍스트의 존재와 고유함만 검사했다 |
| `webxr-render-browser.mjs` 로컬 | NOT_RUN. CI `webxr-render` 범위 |
