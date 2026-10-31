# QR-AR-01 검증 · 2026-10-31

후속 QR-AR-01.1: [실기기 검증 준비와 새 실행 결과](REAL_DEVICE_VALIDATION.md). 기존 구현을 유지한 새 회귀는 Node 12/12·합성 브라우저 11개 그룹 PASS. 실기기/QR→카메라는 NOT_RUN, 실제 사진은 DATA_INSUFFICIENT이며 이전 합성 결과와 구분한다. 아래 내용은 최초 QR-AR-01 실행 기록이다.

판정: **독립 PoC의 합성 기능 검증 PASS / 실물 식별 UNVERIFIED / 실기기 end-to-end NOT_RUN**. 배포·주입 작업 사용 승인 또는 실차 정확도 성공 판정이 아니다.

환경: Windows, Node v22.16.0, npm 10.9.2, Microsoft Edge 156.0.4314.50 headless, Playwright 1.56.1. 브라우저 영상은 Canvas captureStream 합성 입력이다. 거부·미지원·정지·visibilitychange는 테스트가 주입한다. 최종 실행의 12개 Node 테스트와 11개 브라우저 assertion 그룹이 PASS다. 기존 보고서 결과를 새 실행으로 재사용하지 않았다.

모든 npm 명령의 작업 디렉터리는 `C:\dev\CarScope-qr-ar01\tools\mobile-ar-poc`이다.

| Gate | Status | 명령/관측 | 근거·범위 |
| --- | --- | --- | --- |
| 문법 | PASS | `npm run check` | 최종 `syntax.txt` |
| QR·detector·camera·server | PASS | `npm test` | 12/12, 최종 `unit-tests.txt` |
| 브라우저 흐름 | PASS | `$env:POC_EVIDENCE_DIR='C:\CarScope-External\qr-ar-01\2026-10-31-final02'; npm run test:browser` | 최종 `browser-results.json`: 11개 그룹, errors 없음 |
| 실제 QR 이미지 | PASS | 서버 SVG 렌더 결과를 PNG로 읽고 jsQR로 독립 디코딩 | 합성 `.example` 주소의 정확한 fragment 복원, 스마트폰 스캔 검증 아님 |
| 후보 위치·미탐 경로 | PASS | 합성 blue-component/빈 영상·red/transparent/noise/전면 파랑 입력 | 후보 있음/없음과 오버레이 제거, 실제 캡 의미 식별 아님 |
| 알려진 오탐 | PASS (한계 재현) | 일반 파란 사각형도 후보를 반환하는지 검사 | 정확도 성공을 뜻하지 않음 |
| 카메라 정리·취소 | PASS | stop/늦은 permission/play 오류/track ended 단위 테스트, 수동/영상 시간 정지/visibility 브라우저 테스트 | 실제 권한 UI·기기 백그라운드 검증 아님 |
| 렌더·기본 접근성 | PASS (제한적) | 390×844, 844×390, 1280×900, 직접 캡처 확인, Tab/Enter·수동 안내 focus·overflow 검사 | 헤드리스 desktop viewport. 실제 폰 회전·스크린리더·OS 글자 배율 NOT_RUN |
| HTTP 경계 | PASS | allowlist 외 경로 404, POST 405, HEAD, CSP/no-store 확인 | 외부 보안 감사 아님 |
| diff·범위 | PASS | `git diff --cached --check`, staged 파일 목록 검토 | 추가 파일은 `tools/mobile-ar-poc/`만. Android/SDK/Geometry/Three.js 변경 없음 |
| 별도 lint/typecheck/build | NOT AVAILABLE | 순수 ES modules/정적 파일, 별도 단계 없음 | 문법 검사와 Node/브라우저 실행을 사용 |
| core·Android·Anatomy·GLB | NOT_RUN | 기존 모듈/형상을 변경하지 않음 | 이번 합성 결과로 기존 모듈 회귀 성공을 주장하지 않음 |
| 신뢰한 HTTPS·폰 QR→카메라 | NOT_RUN | 폰·인증서·도달 가능한 실제 URL 미준비 | TLS 실행 옵션만 제공. 연결 성공 주장 없음 |
| 실물 탐지 accuracy/precision/recall | NOT_RUN | 라벨이 있는 실제 캡/음성 데이터 부재 | 데이터 부족. 실물 식별은 UNVERIFIED |
| 실기기 지연·발열·배터리 | NOT_RUN | 실제 폰 미측정 | 250ms는 스케줄 설정이며 측정 성능이 아님 |

## 외부 증거 인덱스

원본 이미지·로그·테스트 결과는 Git에 포함하지 않는다. 로컬 저장 루트는 `C:\CarScope-External\qr-ar-01\`이다. 다른 PC에는 해당 파일이 없을 수 있다.

- `2026-10-31-final02/`: 최종 실행. `syntax.txt`, `unit-tests.txt`, `browser.txt`, `browser-results.json`, `synthetic-blue-component.png`, `mobile-synthetic-candidate.png`, `landscape-synthetic-candidate.png`, `mobile-no-candidate.png`, `mobile-denied.png`, `desktop-unsupported.png`.
- `2026-10-31-run01/`: 최초 문법·Node 테스트 PASS. 브라우저는 권한 거부 mock이 초기화된 CameraSession 대신 navigator만 교체해 FAIL(timeout). 부분 통과와 FAIL 결과를 보존했다.
- `2026-10-31-run02/`: 브라우저 FAIL. 수정한 합성 프레임이 재시작 때 여전히 “파란 물체 없음” 상태여서 후보 대기 timeout. 제품 탐지 성공으로 해석하지 않았다.
- `2026-10-31-run03/`: 테스트 mock 수정 후 브라우저 PASS. 이후 정지 프레임 보호와 키보드·가로 viewport 검증을 추가하고 `final`에서 전부 재실행했다.
- `2026-10-31-final/`: 자동 검증 PASS였지만 직접 캡처 검토에서 가로 resize 직후 후보 상자가 비는 상태를 발견했다. resize observer를 단순 지우기에서 즉시 재분석/그리기로 수정하고 가로 화면의 overlay 픽셀 존재 assertion을 추가해 `final02`에서 전체 재실행했다.

미추적 별도 초안 `tools/mobile-ar-poc/{app.mjs,assist.html,detector.mjs,handoff.mjs,index.html}`은 삭제하지 않고 이번 PR에서 제외했다. 실행 서버는 `public/` allowlist만 제공하여 이 파일들을 사용하지 않는다.

PR은 실물·폰 검증 미완료를 드러내는 Draft로 생성한다. CI가 실행되더라도 해당 job 범위만 평가하며 위 NOT_RUN 항목을 대체하지 않는다. 후속 실기기·데이터셋 평가 절차는 [README.md](README.md)에 있다.
