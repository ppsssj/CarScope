# P12-E 증거 인덱스

**모든 동작 시험은 가짜 공급자로 실행했다. 사진을 Roboflow로 보내지 않았고 이번 작업에서 API를 호출하지 않았다.** 그래서 아래 결과는 화면과 서버 동작의 근거이고, **모델 정확도의 근거가 아니다.** 판정은 [P12-E](../../p12-e-bonnet-part-detection.md)에 있다.

환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. 캡처와 결과 JSON은 작업 PC `C:\CarScope-External\p12-e\run1\p12-e`에 있고 Git에 넣지 않았다. 시험 사진은 코드로 만든 단색 이미지다.

## 모델 근거의 출처

새로 측정하지 않았다. P12-C의 저장본을 읽기만 했다.

| 자료 | 내용 |
|---|---|
| `C:\CarScope-External\p12-c\run2\model-info.json` | Roboflow 메타데이터: 클래스, 라벨 수, 소유자 수치 |
| `C:\CarScope-External\p12-c\run2\results.json` | 공개 사진 12장의 실제 응답 |
| PR #102 (미병합) | 예비 평가와 클라이언트. 읽기만 했고 수정하지 않았다 |

`universe.roboflow.com`은 자동 접근이 막혀 있다(403). 저장소 밖의 키 파일은 안내받지 않아 열지 않았다.

## 로컬 실행

| 명령 | 결과 | 범위 |
|---|---|---|
| `tools/inspection-sync-poc: node --test test/part-detection.test.mjs` | PASS 18 | 지원표, 매핑 52개 클래스, 인증, 동의, 제한, 키, 게이트 우회 |
| `tools/inspection-sync-poc: npm test` | 282 중 PASS 245, 실패 0, SKIP 37 | SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
| `tools/mobile-ar-poc: npm test` | PASS 150 | |
| `node test/part-detection-browser.mjs` | PASS 7개 그룹 | 가짜 공급자, 실제 QR HTTP, 합성 Chrome |
| `part-guide-browser`, `webxr-browser`, `webxr-qr-browser` | PASS 12개, 14개, 7개 그룹 | 그림 안내, WebXR, QR v2 회귀 |
| `ux`, `mobile-ar`, `browser`, `tire`, `charge`, `brake` browser | 모두 PASS | 기존 모바일 회귀 |
| `npm run test:mobile-browser` | PASS | QR v2 Edge E2E |
| `deployment-preflight static` | PASS 14, FAIL 0, MANUAL 1, BLOCKED 1 | 새 `PART_DETECTION_OFF` PASS. 열린 2건은 기존과 같다 |
| `test/part-detection-postgres.test.mjs` | **로컬 NOT_RUN** | CI `postgres-integration` 범위. Docker 데몬이 꺼져 있다 |

## 필수 검증 대응

| # | 항목 | 근거 |
|---|---|---|
| 1, 2 | 6개 등록, `partId`·`taskId` 일치 | 레지스트리와 대조 |
| 3, 4 | 상태와 매핑, 잘못된 클래스 제외 | 6개 부품 × 52개 클래스 전수, 유사 이름, 실제 화면 |
| 5 | 키 비노출 | 응답, 로그, 페이지, 가짜 공급자의 오류 문구 |
| 6 | 전송 동의 | 동의 전 파일 이벤트로 요청 0회, 서버 헤더 확인, 사진마다 다시 동의 |
| 7 | 인증과 호출 제한 | 토큰 없음·임의·다른 부품·끝난 점검, 클라이언트·점검·동시 제한 |
| 8 | 좌표 표시 | 상태의 좌표와 캔버스 픽셀 대조 |
| 9 | 미탐·오류 대체 | 문구와 그림 안내 |
| 10 | 부품 전환 초기화 | 상태 머신 시험. 실제 화면은 QR마다 새 페이지다 |
| 11 | QR·WebXR·점검 회귀 | claim 1회, 답변·시도 유지, 결과 전송, Back |
| 12 | 모델 미실행 | 게이트: 런타임·의존성·모델 파일 없음 |

## 개발 중 수정 기록

- **게이트가 잡음:** `PART_DETECTION_OFF`가 주석 속 단어에 FAIL했다. 게이트는 그대로 두고 주석을 고쳤다. 우회 6가지를 복사본에 넣어 FAIL을 확인했다.
- **임의 토큰 응답:** 시험이 401을 기대했지만 기존 API는 다른 코드를 준다. 기존 요청과 같은 응답을 내는지 비교하도록 시험을 고쳤다. 제품 코드의 거부는 그대로다.
- **허술한 시험 수정:** PG 시험의 호출 제한 검사가 오류를 삼키는 구조여서, 실제로 11번째 요청이 429인지 보도록 고쳤다.

## NOT_RUN

| 항목 | 상태 |
|---|---|
| 실제 Roboflow 호출, 모델 정확도(6개 부품 모두) | NOT_RUN |
| 냉각수, 브레이크액, 퓨즈박스의 라벨 평가 | NOT_RUN |
| 실제 Render, Render 메모리·CPU 측정 | NOT_RUN. 영향은 계산값 |
| Z Flip8 카메라 앱·갤러리, 탭 폐기 | NOT_RUN |
| 라이선스, 개인정보 검토 | NOT_RUN. 법률 판단이 아니다 |
