# P9-XR-C 증거 인덱스

원본 로그와 캡처는 `C:/CarScope-External/p9-xr-c/`에 두고 Git에는 요약만 남긴다. [통합 설계](../../p9-xr-c-webxr-inspection-integration.md).

## 판정 범위

- `WEBXR_INSPECTION_INTEGRATED`: 워셔액 점검 화면과 QR v2 진입 경로에 통합.
- `WEBXR_SYNTHETIC_VERIFIED`: 실제 Chrome·WebGL·Three.js·서버 CSP·동기화 HTTP와 Chrome 가짜 카메라, 그리고 **가짜 XR 런타임**. 실제 추적을 포함하지 않는다.
- `NOT_RUN_DEFERRED_TO_E2E`: Z Flip8과 실제 QR E2E. 사용자 결정으로 최종 통합 단계로 연기했다.

## 새 로컬 실행 (2026-11-05~06)

기준 main `6077fdd5647ea709180601cb27a850e46497efa4`. 환경: Windows 10, Node 22.16.0, Chrome 156.0.8078.80, Edge 156.0.4314.58, Three 0.160.0.

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 문법 | PASS | 두 도구의 `npm run check` |
| mobile-ar-poc Node | PASS, 122건 실패 0 | `npm test` |
| WebXR 점검 흐름 | PASS, 14개 그룹 | `npm run test:browser:webxr`의 `webxr-browser.mjs`, `results.json` |
| WebXR QR v2 | PASS, 5개 그룹 | 같은 명령의 `webxr-qr-browser.mjs`, `qr-v2/results.json` |
| 기존 2D와 17개 점검 회귀 | PASS, 5개 스위트 | `npm run test:browser`, `run4/regression-2d.txt` |
| QR v2 Edge E2E 회귀 | PASS | `tools/inspection-sync-poc`의 `npm run test:mobile-browser`, `run4/mobile-browser.txt` |
| Sync 전체 | PASS 177, 실패 0, SKIP 9 | `npm test`. SKIP은 모두 `PG_TEST_URL` 없음으로 이 로컬 실행에서 NOT_RUN. CI `postgres-integration`은 별도 |
| AR-01 단위 | PASS 122 | `test:ar01`, run4 |
| Sync legacy, SQLite, 디버그 브라우저 | PASS (48, 21, 11) | `test:legacy`, `test:sqlite`, `test:browser`. run2, 이후 변경은 안내 모듈의 스크롤과 테스트뿐이라 다시 실행하지 않음 |
| CLI 진입점 | PASS | 플래그 켠 dev·정적 서버 응답, `receiver.mjs` QR 주소 출력, 플래그 끈 dev 서버 404, 잘못된 플래그는 세 호스트 모두 시작 거부 |
| mutation 27종 | 1차 25 KILLED, 2 SURVIVED. 검사 추가 후 2종 재실행 2 KILLED | 임시 사본에서 조건을 하나씩 변경. 스크롤 수정 전에 실행했으며 스크롤 조건은 대상 밖(아래 수정 기록의 실패 확인으로 대신함). 선택한 조건만 대상이며 완전성 증명이 아님 |

## 합성 검증 내용

**점검 상태와 QR**

- 연결된 QR v2: AR 진입·복귀 후 `/v1/sessions` 0회, `/v1/claim` 1회 유지, `/v1/submissions` 0회. 서버 세션 상태 불변, 기록 `IN_PROGRESS`, `aids` 불변.
- 같은 인증 정보로 결과 확정, 전송, 차량 측 수락까지 완료.
- 연결 전 AR과 Back 후에도 일회용 invite로 1회 연결. Back이 fragment를 되돌리지 않음.
- invite와 submit token이 DOM, 주소, `history.state`, storage, cookie, 요청 URL·본문에 없음.
- AR 중 차량 측 취소가 복귀 후 표시됨.
- 체크 항목, 시도 ID, 모드가 AR 전후로 동일.

**카메라와 수명주기**

- XR 요청 시점의 live 카메라 트랙 0, 카메라 요청 시점의 live XR 세션 0. 안내 중 2D 시작 불가, 늦은 카메라 응답 폐기, 닫아도 자동으로 켜지지 않음.
- Back, 돌아가기, 세션 숨김, 시스템 종료, `pagehide`, 시작 중 취소에서 세션 해제. 3회 반복 뒤 세션·앵커·Hit Test source 잔존 없음.

**폴백과 범위**

- Chrome 자체 WebXR의 실제 미지원 경로에서 버튼 없음, 이유 표시, 2D·수동 유지, Three.js 미다운로드.
- 권한 거부, 기능 미지원, 설정 실패, Three.js 로드 실패, 안내 모듈 로드 실패의 복귀.
- 플래그를 켜도 다른 16개 부품, 다른 부품 QR, 잘못된 QR에는 버튼과 요청이 없음.
- 플래그를 끄면 XR 지원 기기와 URL 매개변수로도 표시와 요청이 없고 파일은 404.

**P9-XR-B에서 유지**

마커의 화면 위치가 투영 계산만큼 이동(허용 오차 6px), 추적 손실 숨김과 복구, 재지정, 제거, 앵커 미지원 라벨, 412×1007·844×390·320×640 배치.

캡처를 직접 열어 확인했다(`run4/p9-xr-c/*.png`). DOM 스크린샷에는 XR 프레임이 담기지 않아 AR 화면 배경이 비어 있으며, 3D 프레임은 `frame-*.png`로 따로 저장했다.

## NOT_RUN_DEFERRED_TO_E2E

절차는 [E2E 체크리스트 I장](../../p9-e2e-checklist.md#i-webxr-3d-ar-안내-p9-xr-c)에 있다.

| 항목 | 상태 |
|---|---|
| Z Flip8 등 실기기의 AR 세션, Hit Test, Anchor, DOM overlay | NOT_RUN_DEFERRED_TO_E2E |
| 실제 공간 고정 품질, 드리프트, 추적 복구 | NOT_RUN_DEFERRED_TO_E2E |
| AR 중 시스템 Back, 앱 전환, 회전, 접기·펼치기의 실제 동작 | NOT_RUN_DEFERRED_TO_E2E |
| XR 종료 직후 카메라 재시작 | NOT_RUN_DEFERRED_TO_E2E |
| 엔진룸 표면 검출과 표시 오차 | NOT_RUN_DEFERRED_TO_E2E |
| 발열, 배터리, 프레임률 | NOT_RUN_DEFERRED_TO_E2E |
| 실제 스마트폰 QR 스캔 | NOT_RUN_DEFERRED_TO_E2E |
| Native QR → Render에서 WebXR | 현재 기능 없음. Render 연결과 배포 승인(G10) 필요 |
| iOS Safari | NOT_RUN |

## 개발 중 수정 기록

제품 판정 조건이나 임계값을 완화한 수정은 없다.

- **QR 테스트 첫 실행 FAIL:** `main`이 두 개여서 locator가 모호했다. 테스트 수정이며 제품 코드는 그대로다.
- **화면 검토 1:** "위치 표시는 3D 공간에 고정되지 않습니다" 바로 아래에 3D AR 버튼이 있어 모순으로 읽혔고, "남깁니다"는 미검증 상태에 과한 표현이었다. 안내 문구를 고쳤다.
- **화면 검토 2 (결함):** 테스트는 통과했지만 QR v2 캡처에서 체크리스트가 스크롤된 채 시작했다. `history.back()`의 스크롤 복원이 페이지의 `scrollTo(0, 0)`을 덮어썼다. 검사를 먼저 추가해 실패(487 ≠ 0)를 확인한 뒤 수동 복원으로 고쳤다.
- **mutation 생존 2건:** "닫을 때 2D 카메라 자동 시작"은 돌아가기 경로를 검사하지 않아 살아남았고, "이후 단계에도 제공"은 부모가 CSS로 숨겨져 드러나지 않았다. 검사를 추가해 둘 다 KILLED로 바꿨다.

## CI

`.github/workflows/webxr-poc-ci.yml`을 확장했다. 이 job은 문법, Node, 가짜 XR 런타임 브라우저 검사, 로컬 동기화 HTTP만 포함하며 실기기, 실제 추적, Native, Render를 포함하지 않는다.

**PR #84 첫 CI의 간헐 실패 (`628cbad`, run 42053107868):** Windows Sync job의 `SQLite: four processes serialize 200 updates without lost writes`가 첫 실행에서 FAIL(10.4초), 실패 job 재실행에서 PASS였다. 이 PR은 SQLite store, 세션 서비스, 해당 테스트 파일을 바꾸지 않았고 로컬에서 5회 반복 통과했다. busy timeout 5초와 부하로 인한 `SQLITE_BUSY`로 추정하지만 worker 오류가 로그에 남지 않아 **원인은 미확정이다.** 임계값은 바꾸지 않았다.

## P9-UX-A 병합 후 재검증 (2026-11-06)

`main` `447b1fa`(PR #83)를 병합한 `1676d73`에서 다시 실행했다(`run5-after-main/`).

- **충돌:** `docs/roadmap.md` 1건. 같은 자리에 추가된 P9-XR-C, P9-UX-A, P9-A2.1 절을 모두 유지했다. `docs/p9-e2e-checklist.md`는 서로 다른 줄이라 자동 병합됐고 양쪽 변경이 남아 있다.
- **코드 대조:** `app/`은 main과 같고, `tools/`와 `.github/`는 병합 전 `628cbad`와 같다. 두 PR이 함께 수정한 코드 파일은 없다.
- **Render·DB:** `render-stateful.mjs`, `render-preflight.mjs`, PostgreSQL store와 스키마, `vercel.json`이 main과 같다.
- **로컬 PASS:** mobile-ar-poc Node 122, WebXR 브라우저 19개 그룹, 2D·17개 점검 회귀 5개 스위트, Sync legacy 48, Sync 전체 177(SKIP 9, `PG_TEST_URL` 없음), SQLite 21, AR-01 122, 디버그 브라우저 11, QR v2 Edge E2E.
- **이 로컬 실행 범위 밖:** Kotlin·Native 오버레이는 CI의 해당 job만 실행했다. AVD와 실기기는 다시 실행하지 않았다. 오버레이의 시각 확인 3건과 간헐적 브리지 차단은 [P9-UX-A 증거](../p9-ux-a/README.md)의 상태 그대로다.
