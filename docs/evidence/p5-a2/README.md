# P5-A2 외부 증거 인덱스

2026-11-03 KST, Windows / Node 22.16.0. 기준 main `0a054ca1685cbe198247c278ab831d6eb4d614e1`. 원본 로그·캡처·합성 SQLite는 Git 밖에 보관한다. 이 실행은 **합성/브라우저/Node** 증거이며 실제 스마트폰·차량·Android SDK 수신 증거가 아니다.

최종 실행 루트: `C:\CarScope-External\qr-ar-01\p5-a2\20261103-final`.

| 루트 기준 경로 | 내용/결과 |
|---|---|
| `mobile-check.log`, `mobile-unit.log` | 모바일 syntax, 47/47 PASS |
| `mobile-browser.log`, `mobile/browser-results.json` | 기존 워셔액 Edge 156.0.4314.58, 16 검사 그룹 PASS |
| `mobile/tires/browser-results.json` | 기존 네 타이어 Chrome 156.0.8078.79, 7 그룹 PASS |
| `mobile/charge/browser-results.json` | 충전구 Chrome, 6 그룹 PASS |
| `mobile/charge/01-confirmed.png` | 개별 응답 검토/수정 후 사용자 보고 확정 |
| `mobile/charge/02-camera.png`, `03-landscape.png` | 합성 canvas 영상 + 수동 위치, 가로 화면 위치 초기화. 실제 인식/실물 영상 아님 |
| `mobile/charge/04-node-accepted.png` | Node 수신기의 명시적 수락 후 ACCEPTED. Native 수신 아님 |
| `sync/summary.json`, `check.txt`, `test.txt` | check, 전체 95/95 PASS |
| `sync/test-legacy.txt`, `test-sqlite.txt`, `test-ar01.txt` | 기존 48/48, SQLite 21/21, 모바일 wrapper 47/47 PASS. 중복 실행 합산 금지 |
| `sync-browser/summary.json`, `01-invite.png` 등 | 기존 Sync debug Edge, 11 그룹 PASS |
| `sync-browser/mobile-summary.json`, `01-completed-not-sent.png` 등 | 기존 워셔액 v2 통합 Edge, 19 그룹 PASS |

Sync 브라우저 텍스트 로그는 `C:\CarScope-External\qr-ar-01\p5-a2\20261103-run05\sync-browser.log`, `sync-mobile-browser.log`다. 위 final/sync-browser JSON과 대응한다.

이전 실패/진단도 외부에 보존했다.

- `C:\CarScope-External\p5-a2\20261103-run01\legacy-browser.log`: 기존 하네스의 외부 경로 정책 미충족. 올바른 qr-ar-01 하위 경로로 재실행했으며 정책을 완화하지 않았다.
- `20261103-run02/sync-unit.log`, `20261103-run03/sync/test.txt`: 새 테스트가 기존 201/200 및 duplicate 플래그 차이를 잘못 기대한 실패. 서버 변경 없이 정확한 계약 검증으로 수정했고 final은 95/95 PASS.
- `20261103-run03/charge-browser.log`: pause 이벤트 완료 전에 즉시 track 상태를 검사한 실패. 비동기 정리 완료 대기로 수정.
- `20261103-run04/charge-browser.log`: 동일 fragment 재탐색을 새 페이지로 가정한 하네스 실패. 새 시도 fixture의 명시적 reload로 수정. run05 및 final의 6 그룹 모두 PASS.

소스 검토와 최종 합성 카메라/확정/가로/수락 화면을 실제 이미지로 확인했다. 테스트의 가짜 자격 증명은 프로세스 메모리에만 사용하며 URL/DOM/storage 노출을 검사했다. 개인 영상·사진·GPS·VIN·실제 토큰을 수집하지 않았다.

실제 폰 후면 카메라·OS 권한/회전·백그라운드, 실제 차량 위치 일치, 두 기기 E2E는 **NOT_RUN**. 타이어/충전구 Native 수신은 **BLOCKED**인 [후속 계약](../../contracts/charge-port-mobile-result-v2.md)이다. AVD/adb/실차를 조작하지 않았다. 기존 사용자 보고 및 CI 결과는 각 실행 범위와 구분한다. CI는 PR의 해당 HEAD checks를 별도로 확인한다.
