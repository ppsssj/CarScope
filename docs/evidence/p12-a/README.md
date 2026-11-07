# P12-A 증거 인덱스

합성 모바일 Chrome 결과다. **실제 Z Flip8, 실제 폴더블, 실제 Render에서 실행하지 않았다. 실제 부품 사진은 없다.** 설계는 [P12-A](../../p12-a-part-photo-guide.md)다.

환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. 캡처와 결과 JSON은 작업 PC `C:\CarScope-External\p12-a\run1\p12-a`에 있고 Git에 넣지 않았다.

## 그림 목록

| 파일 | 종류 | 출처 | 라이선스 상태 | 차종 범위 |
|---|---|---|---|---|
| `tools/mobile-ar-poc/public/guide-washer-area.svg` | 설명용 그림 | CarScope 제작 | `CARSCOPE_ORIGINAL` | 특정 차종 아님. 보닛 영역만 표시 |
| `tools/mobile-ar-poc/public/guide-washer-mark.svg` | 설명용 그림 | CarScope 제작 | `CARSCOPE_ORIGINAL` | 특정 차종 아님. 표시 모양 예시 |
| 실제 엔진룸 사진 | 없음 | - | `PHOTO_NEEDED` | - |
| 실제 캡 클로즈업 사진 | 없음 | - | `PHOTO_NEEDED` | - |

외부 자료는 복제하지 않았다. 설명서는 링크만 건다: `https://manuals.hyundai.co.uk/umanuals/ioniq-5/ioniq-5-2022-maintenance.pdf`(2026-11-07 HTTP 200). 라벨에 차종, 연식, 판매 지역과 "참고 자료"를 표시한다.

## 로컬 실행

| 명령 | 결과 | 범위 |
|---|---|---|
| `tools/mobile-ar-poc: npm run check` | PASS | 문법 |
| `tools/mobile-ar-poc: npm test` | PASS 139, 실패 0 | 데이터, 표시 규칙, 호스트 |
| `node test/part-guide-browser.mjs` | PASS 8개 그룹 | 새 화면 |
| `browser`, `tire-browser`, `charge-browser`, `brake-browser`, `mobile-ar-browser`, `ux-browser` | 모두 PASS | 기존 모바일 회귀 |
| `node test/webxr-browser.mjs`, `node test/webxr-qr-browser.mjs` | PASS | WebXR, QR v2 (가짜 XR 런타임) |
| `tools/inspection-sync-poc: npm test` | 263 중 PASS 227, 실패 0, SKIP 36 | SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
| `npm run test:mobile-browser` | PASS | QR v2 Edge E2E |
| `deployment-preflight static` | PASS 13, FAIL 0, MANUAL 1, BLOCKED 1 | 열린 2건은 시작 DDL 안내와 운영 인증 차단으로 기존과 같다 |

## 새 화면에서 확인한 것

- **기본:** 접힌 상태에서 그림 요청 0회, 열면 2회. 대체 텍스트, 실제 사진이 아니라는 표시, 구별 특징, 안전, 적용 범위 표시. 카메라 요청 0회. 점검 상태 변화 없음.
- **크기:** 320×568, 344×882, 360×740, 390×844, 412×1007, 844×390, 884×1104에서 가로 스크롤 없음, 확대 화면 컨트롤이 화면 안에 있음. viewport 시뮬레이션이다.
- **확대:** 버튼, Esc, Back으로 닫힘. Back이 페이지를 떠나지 않고 fragment가 돌아오지 않음. history가 쌓이지 않음. 포커스 복귀.
- **실패·지연:** 로드 실패 시 깨진 이미지와 빈 틀 없이 설명문 표시. 지연 중 자리 유지, 확대 비활성, 점검 진행 가능.
- **QR:** 체크리스트 답변, 시도 ID 유지. claim 1회, 전송 1회. 전송된 `inspectionId`가 안내 전 시도와 같고 `aids`가 바뀌지 않음. 토큰이 DOM, 주소, history, 저장소, 요청에 없음.
- **WebXR:** 3가지 방법이 첫 화면에 그대로 들어감. AR 진입·종료 뒤 답변, 연결, 열린 안내 유지. Back은 위에 있는 것 하나만 닫음.
- **다른 부품:** 안내가 없는 부품은 카드와 요청 없음. 같은 화면이 사진 기록을 차종·출처와 함께 표시. 라이선스나 차종이 없는 사진은 표시하지 않음(고정 데이터 시험).

캡처를 직접 열어 확인했다: `intro-open`, `webxr-methods`, `zoom`, `image-failed`, `check-open`, `size-wide-884`. 전체 페이지 캡처 중간의 버튼은 sticky 하단 바가 찍힌 것이다.

## 개발 중 수정 기록

**첫 실행 FAIL:** "사진 옆을 탭하면 닫힘" 검사가 실패했다. 확대 화면이 전체 화면이라 옆 영역이 없어 그 코드는 실행될 수 없었다. 실행되지 않는 코드와 검사를 함께 삭제했고 닫기 경로는 버튼, Esc, Back이다.

## NOT_RUN

| 항목 | 상태 |
|---|---|
| Z Flip8 화면, 접기·펼치기, 실제 터치와 핀치 | NOT_RUN |
| 실제 저속 네트워크 | NOT_RUN. 요청 지연을 합성했다 |
| Render 운영 서비스 제공 | NOT_RUN. 배포하지 않았다 |
| `webxr-render-browser.mjs` 로컬 | NOT_RUN. CI `webxr-render` 범위 |
| 설명서 PDF 내용과 실제 차량의 대조 | NOT_RUN |
| 스크린 리더 | NOT_RUN. 대체 텍스트와 라벨 존재만 검사했다 |

## CI

`npm run test:browser`에 `part-guide-browser.mjs`를 추가해 Windows Sync job이 실행한다. `webxr-render` job은 Render 경로의 그림 응답도 확인한다. 실행 결과는 PR에 기록한다.
