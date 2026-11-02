# P5-A1 외부 증거 인덱스

2026-11-03 KST, Windows / Node 22.16.0. 기준 main `5951b1ddbd1b63464b32db1093c36f4cde3c46d0`. 생성 데이터는 **합성**이며 실제 스마트폰·카메라·Android 결과로 해석하지 않는다. 로그·캡처·SQLite 파일은 Git에 포함하지 않는다.

기존 회귀/Sync 실행 루트: `C:\CarScope-External\qr-ar-01\p5-a1\20261103-final`.
최신 타이어 실행 루트: `C:\CarScope-External\qr-ar-01\p5-a1\20261103-lifecycle-fixed`.
아래 타이어 행의 위치만 두 번째 루트 기준이다. 실패한 `20261103-final/tires`를 PASS 근거로 사용하지 않는다.

| 위치 (루트 기준) | 내용 | 결과 |
|---|---|---|
| `browser-results.json`, `01-*.png` 등 | 기존 워셔액 Edge 156.0.4314.58, 16개 검사 그룹 | PASS 합성 |
| `tires/browser-results.json`, `tires/01-manual-confirmed.png` | Chrome 156.0.8078.79, 타이어 7개 검사 그룹/USER_REPORTED 결과 | PASS 합성 |
| `tires/02-camera-marker.png`, `tires/03-landscape.png` | canvas.captureStream 영상, 수동 2D 표시/가로 화면 | PASS 합성 |
| `tires/04-synthetic-sync-accepted.png` | Node receiver 명시적 수락 이후 표시, Native 아님 | PASS 합성 |
| `sync-final/summary.json`, `check.txt`, `test.txt` | check 및 Sync 전체 89/89 | PASS |
| `sync-final/test-legacy.txt`, `test-sqlite.txt`, `test-ar01.txt` | 기존 48/48, SQLite 21/21, 모바일 40/40 (중복 포함) | PASS |
| `sync-browser-rerun/summary.json`, `01-invite.png` 등 | 기존 Sync debug Edge 11개 검사 그룹 | PASS 합성 |
| `sync-browser-rerun/mobile-summary.json`, `01-completed-not-sent.png` 등 | 기존 워셔액 v2 통합 Edge 19개 검사 그룹 | PASS 합성 |

외부 텍스트 로그(`C:\CarScope-External\`):

- `p5-a1-final-mobile-tests.log`: 모바일 단위 40/40.
- `p5-a1-final-browser.log`: 워셔액 16 + 초기 타이어 7 그룹. 타이어 추가 수명주기/키보드 검사 후 최신 PASS 로그는 `p5-a1-lifecycle-fixed.log`.
- `p5-a1-final-sync-browser-rerun.log`, `p5-a1-final-sync-mobile-browser.log`: 기존 Sync 브라우저 통과.
- 초기 실패도 보존: `p5-a1-baseline-mobile.log`(기존 fixture 시작/완료 시계 혼용), `p5-a1-final-sync-browser.log`(debug import allowlist 누락). 수정 후 위 최신 실행 모두 PASS.
- `p5-a1-tire-browser-run02.log`와 `20261103-run01/tires/browser-results.json`: 새 하네스 hashchange 대기 수정 전/후. run01 context 파괴는 재탐색 완료 대기 추가로 해결. 제품 PASS 근거는 위에 구분한 최신 실행 폴더다.
- `p5-a1-final-tire-browser.log`, `p5-a1-tire-lifecycle-diagnostic.log`: 추가 재시작 검사에서 가로 화면 밖 영상 좌표를 탭한 하네스 실패. 재생 준비/영상 스크롤 대기를 추가한 뒤 `20261103-lifecycle-fixed/tires/browser-results.json`에서 7개 그룹 모두 PASS. 해당 실패도 보존한다.

화면 검토는 합성 타이어 카메라·결과·가로 화면을 대상으로 수행했다. 토큰·실제 차량 식별자·위치·개인 영상·사진은 수집하지 않았다. 브라우저 테스트의 임시 서버와 합성 자격 증명은 테스트가 소유한다.

실제 스마트폰 카메라/OS 권한·회전·백그라운드와 두 기기 E2E: **NOT_RUN**. 현재 Native tire schema v2 지원: **BLOCKED**, [수신 명세](../../contracts/tire-mobile-result-v2.md). AVD/adb/실기기/Android 로컬 빌드는 실행하지 않았다. CI는 PR 해당 HEAD의 결과만 별도로 보고한다.
