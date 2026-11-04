# P7-B 증거 인덱스

2026-11-04, Windows, Node 22.16.0. 원본 로그·캡처·연구용 설명서 PDF는 Git 밖에 보관한다. 이 문서는 재현 명령과 위치를 연결하며 실제 스마트폰 증거를 만들지 않는다.

- 초기 조사/공통 카메라 회귀: `C:/CarScope-External/qr-ar-01/p7-b-20261104/` (기존 washer/tire/charge/brake browser PASS, 새 harness의 같은 URL 재방문 FAIL 포함).
- 확장 17-task 첫 PASS: `C:/CarScope-External/qr-ar-01/p7-b-20261104-final/p7-b/browser-results.json` — 17개 lifecycle 그룹 + 17개 QR v2→Node 수락 그룹, Edge 156.0.4314.58. 실제 폰/실물 인식 NOT_RUN.
- Node/Sync 최종 로그: `C:/CarScope-External/qr-ar-01/p7-b-20261104-final2/`의 `mobile-node.txt`, `mobile-clock-regression.txt`, `sync-syntax.txt`, `sync-node.txt`. Sync 실제 DOM 회귀는 `sync-mobile/mobile-summary.json`(19개 그룹), debug 회귀는 `sync-debug/`(11개 그룹)다.
- 최종 모바일 브라우저: `C:/CarScope-External/qr-ar-01/p7-b-20261104-final3/`의 `mobile-syntax.txt`, 기존 4개 browser JSON, `p7-b/browser-results.json`과 냉각수/와이퍼/조명/12V 캡처. 전체 `npm run test:browser`에 기존 네 suite와 신규 35개 그룹(17 lifecycle + 영상 준비 실패 + 17 QR v2→Node 수락)이 포함된다. 캡처를 직접 열어 세로·가로와 표시 해제를 확인했다.
- 실행 명령·범위·제약은 [구현 문서](../../p7-b-mobile-ar-coverage.md#검증재현), 기기 실행은 [HTTPS/스마트폰 절차](../../../tools/mobile-ar-poc/P7_B_DEVICE_TEST.md), Native 인계는 [고정 task 계약](../../contracts/p7-b-mobile-tasks-v2.md).

로컬 PASS: 모바일 80 Node tests, Sync 127 pass/4 skip(PG_TEST_URL 없음), SQLite 별도 21 tests, Three-poc 81 tests, core Gradle 38 tests. 초기 Sync `npm ci`는 기존 lockfile 부재로 실패했으며 필수 Node 검사는 설치 없이 PASS했다. 실제 Postgres·새 HTTPS 배포·실제 폰·Native 신규 task 수락은 NOT_RUN이다. CI는 PR run을 확인하며 로컬 실행 결과와 구분한다.
