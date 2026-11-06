# P11 모바일 점검 UX 증거 인덱스

합성 모바일 Chrome 결과다. **실제 스마트폰, 폴더블, AVD에서 실행하지 않았다.**

| 항목 | 위치 |
|---|---|
| 변경 전·후 스크린샷 | 작업 PC `C:\CarScope-External\p11-mobile-ux\before`, `after` (Git 미포함) |
| 재생성 | `POC_EVIDENCE_DIR=C:/CarScope-External/<run> node tools/mobile-ar-poc/test/ux-capture.mjs <label>` |
| 동작 시험 | `tools/mobile-ar-poc/test/ux-browser.mjs` (`npm run test:browser`에 포함) |
| 문구·계약 시험 | `tools/mobile-ar-poc/test/inspection-copy.test.mjs` |

시험 크기: 320×568, 344×882, 360×740, 390×844, 667×375(가로), 884×1104(펼친 폴더블 크기). 화면 분할 API(`horizontal-viewport-segments`) 규칙은 실행해 보지 않았다.

## 안전 문구 대조

`test/inspection-copy.test.mjs`의 `COMPARISON`이 부품별로 `safetyText`, `safetyHelp`, `limitations`, `stopAdvice`의 조건과 항상 보이는 문구를 한 행씩 대조한다. 원문이나 요약 어느 쪽이 바뀌어도 실패한다. 질문별 금지사항도 같은 방식으로 대조한다.

첫 요약에서 대조로 찾아 보완한 누락: 보닛의 화기·흡연·스파크·금속 도구, 전원을 꺼도 움직이는 팬, 단자·배선 / 충전구의 분해·수리, 충전 상태 변경 시 중단, 커넥터 / 브레이크의 전장품·팬 / 전조등의 광축 / 와이퍼의 전원을 켠 시험 / 배터리의 냄새 맡기 금지와 누액 시 중단 / 모든 부품의 "안전 조건을 지킬 수 없으면 시작하지 않기"와 측정·판정 한계. 정지 기준은 접힌 안내에서 점검 화면의 상시 문구로 옮겼다. 원문 전체는 `자세한 안내`에 남아 있다.

대조는 문구의 존재를 확인한다. 법적·안전 문구로 충분한지는 사람의 검토가 필요하다.

## 수신 표시

`ACCEPTED`는 AVD 시뮬레이션에서 자동으로 일어난다. 모바일은 "차량 앱이 결과를 받아 점검 이력에 저장했어요. 차량 소유자의 승인이나 차량 안전 판정을 뜻하지 않아요."로 표시하고, Debug Native 패널은 자동 수신 확인일 때 "차량 소유자 승인·안전 판정 아님"을 표시한다. 3D 패널의 `AVD 시뮬레이션 자동 수신 · 차량 소유자 승인 아님`은 PR #90의 문구다. `tools/three-poc/inspection-history-view.mjs`의 `서버 수락`은 P10 영역이라 바꾸지 않았고, AVD 기록을 그 화면에 연결할 때 함께 정리해야 한다.

## 바꾸지 않은 것

저장되는 답변 값(`FOUND`, `NOT_FOUND`, `UNABLE`)과 상태(`OK`, `NEEDS_REFILL`, `UNSURE` 등), 결과 스키마, QR·연결·전송 API, 인증, DB. 부품별 전체 안전·한계 문구는 지우지 않고 `자세한 안내`로 옮겼다. 원본 결과와 진단 상태는 완료 화면의 `개발자 정보`에 있다.
