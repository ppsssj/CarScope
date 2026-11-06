# P11 모바일 점검 UX 증거 인덱스

합성 모바일 Chrome 결과다. **실제 스마트폰, 폴더블, AVD에서 실행하지 않았다.**

| 항목 | 위치 |
|---|---|
| 변경 전·후 스크린샷 | 작업 PC `C:\CarScope-External\p11-mobile-ux\before`, `after` (Git 미포함) |
| 재생성 | `POC_EVIDENCE_DIR=C:/CarScope-External/<run> node tools/mobile-ar-poc/test/ux-capture.mjs <label>` |
| 동작 시험 | `tools/mobile-ar-poc/test/ux-browser.mjs` (`npm run test:browser`에 포함) |
| 문구·계약 시험 | `tools/mobile-ar-poc/test/inspection-copy.test.mjs` |

시험 크기: 320×568, 344×882, 360×740, 390×844, 667×375(가로), 884×1104(펼친 폴더블 크기). 화면 분할 API(`horizontal-viewport-segments`) 규칙은 실행해 보지 않았다.

## 바꾸지 않은 것

저장되는 답변 값(`FOUND`, `NOT_FOUND`, `UNABLE`)과 상태(`OK`, `NEEDS_REFILL`, `UNSURE` 등), 결과 스키마, QR·연결·전송 API, 인증, DB. 부품별 전체 안전·한계 문구는 지우지 않고 `자세한 안내`로 옮겼다. 원본 결과와 진단 상태는 완료 화면의 `개발자 정보`에 있다.
