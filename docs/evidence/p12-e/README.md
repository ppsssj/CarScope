# P12-E 증거 인덱스

**모든 동작 시험은 가짜 공급자로 실행했다. 사진을 Roboflow로 보내지 않았고 이번 작업에서 API를 호출하지 않았다.** 그래서 아래 결과는 화면과 서버 동작의 근거이고, **모델 정확도의 근거가 아니다.** 판정은 [P12-E](../../p12-e-bonnet-part-detection.md)에 있다.

환경: Windows 10, Node 22.16.0, Chrome 157.0.8103.38. 캡처와 결과 JSON은 작업 PC `C:\CarScope-External\p12-e\run2\p12-e`에 있고 Git에 넣지 않았다. 시험 사진은 코드로 만든 단색 이미지다.

## 모델 근거의 출처

새로 측정하지 않았다. P12-C의 저장본을 읽기만 했다.

| 자료 | 내용 |
|---|---|
| `C:\CarScope-External\p12-c\run2\model-info.json` | Roboflow 메타데이터: 클래스, 라벨 수, 소유자 수치 |
| `C:\CarScope-External\p12-c\run2\results.json` | 공개 사진 12장의 실제 응답 |
| PR #102 (작업 중 병합됨) | 예비 평가와 클라이언트. 수정하지 않았다 |

`universe.roboflow.com`은 자동 접근이 막혀 있다(403). 저장소 밖의 키 파일은 안내받지 않아 열지 않았다.

## 로컬 실행

| 명령 | 결과 | 범위 |
|---|---|---|
| `tools/inspection-sync-poc: node --test test/part-detection.test.mjs` | PASS 19 | 지원표, 매핑 52개 클래스, 인증, 동의, 제한, 키, 게이트 우회, 실제 클라이언트·파서 호환(가짜 `fetch`) |
| `tools/inspection-sync-poc: npm test` | 283 중 PASS 246, 실패 0, SKIP 37 | SKIP은 `PG_TEST_URL` 없음으로 이 로컬에서 NOT_RUN |
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

- **PG 시험 계산 오류:** 첫 CI에서 FAIL. 거부된 요청 3건도 분당 제한에 들어가는데(의도한 동작) 시험이 10건 모두 성공한다고 가정했다. 시험을 고쳤다.

## 페이지 시작 시간 초과 조사

**결론:** 이 PR의 새 모듈이 원인이라는 근거는 없다. `main`에서도 같은 빈도로 났다. 직접 원인은 모듈 파일 요청 하나의 `net::ERR_NO_BUFFER_SPACE`(Windows `WSAENOBUFS`)이고, 그 결과 페이지가 메시지 없이 멈추는 것은 제품 결함이어서 고쳤다. **Windows가 왜 이 오류를 내는지는 확인하지 못했다.**

### 처음 실패 기록

Windows WebXR job에서 15초 대기를 넘는 실패가 이 브랜치에서 4회 났다. 이때는 네트워크 진단이 없어서, 아래 원인과 같은 것이라는 연결은 **증상이 같다는 데서 나온 추론**이다.

| 커밋 | run | 결과 | 멈춘 곳 |
|---|---|---|---|
| `bbd2cdd` | 42360684434 | FAIL | `webxr-browser.mjs` 416번째 줄, 워셔액 |
| `8d82a42` | 42360869311 | FAIL | `webxr-browser.mjs` 624번째 줄, 다른 부품 반복 |
| `d644fae` | 42364460406 | FAIL | `webxr-qr-browser.mjs` 297번째 줄 |
| `c751d19` | 42365423746 | PASS | 진단 추가 후. 이 run에서는 실패가 나지 않았다 |
| `8e68ee5` (문서만 변경) | 42366469823 1차 | FAIL | `mobile-browser.mjs` 36번째 줄, Edge |
| `main` | 42361748358, 42365420405 | PASS, PASS | 비교용 수동 실행 |

같은 증상이 `main` `686b016`의 `ux-browser.mjs`에도 있었다. 로컬에서는 재현되지 않았다.

### A/B 측정

[`page-start-probe.mjs`](../../../tools/mobile-ar-poc/test/page-start-probe.mjs)로 **같은 Windows 러너에서** `main` `5cf2441`과 PR 커밋을 번갈아 불러왔다. 네 번 실행한 결과를 **모두** 적었다. Chrome과 Edge, QR·직접 진입 4가지 경로를 썼고 대기 시간은 15초 그대로다.

| run | 러너 | PR 커밋 | `main` 시작 실패 | PR 시작 실패 | PR에서 실제 오류 후 자동 복구 |
|---|---|---|---|---|---|
| 42369713122 | 4 | `84ad6a0` (수정 전) | 1/1152 | 2/1152 | 해당 없음 |
| 42370897177 | 4 | `84ad6a0` (수정 전) | 2/1152 | 0/1152 | 해당 없음 |
| 42371976790 | 8 | `b9307c6` (수정 후) | 1/2304 | 0/2304 | 0건 (오류가 나지 않았다) |
| 42372556115 | 8 | `b9307c6` (수정 후) | 0/2304 | 0/2304 | 1건 |
| **합계** | | | **4/6912** | **수정 전 2/2304, 수정 후 0/4608** | **1건 중 1건** |

- **모든 실패가 같은 모습이다.** 6건 모두 모듈 하나가 `ERR_NO_BUFFER_SPACE`로 실패했고 진입 훅이 끝까지 생기지 않았다. 실패 파일은 `app.mjs` 3회, `inspection-camera.mjs`, `sync-client.mjs`, `self-inspection.mjs`로 모두 기존 파일이다.
- **불러오는 파일:** 수정 전에는 양쪽 34개로 같았다. 수정 후 PR에만 `page-start-guard.js` 1개가 더 있다. `part-detection` 요청은 플래그 OFF에서 0건이다.
- **시작 시간:** 러너별 p50은 양쪽 모두 약 140~270ms로 비슷하다. PR의 p99가 `main`보다 나쁘다는 경향은 없다.
- **자원:** 실패 시점 힙 약 2MB, long task 0~1회, 서버 루프 지연 15~51ms, 여유 메모리 약 13GB, 대기 요청 0건, 4xx·5xx 0건.
- **기각한 가설:** Playwright의 rAF 폴링 정지. 실패 때도 프레임이 돌았고, 100ms 직접 관측도 훅을 보지 못했다.
- **뒷받침되지 않는 가설:** 임시 포트 고갈. TCP를 기록한 실패 3건의 `TIME_WAIT`는 164~1792개이고, 두 번째 run의 최고치도 약 2054개로, 동적 포트 16384개에 못 미친다. 어떤 OS 자원이 모자랐는지는 모른다.
- 첫 run에서는 실제 스위트 `webxr-browser`, `webxr-qr-browser`, `mobile-browser`도 양쪽에서 각 12회씩, 총 72회 돌렸고 실패는 없었다.

프로브 재실행: `node test/page-start-probe.mjs --roots <main>,<pr> --rounds 12 --loads 12 --channels chrome,msedge`. 임시 워크플로와 run 요약은 `C:\CarScope-External\p12-e\page-start-probe`에 있다.

### 수정과 그 범위

[`page-start-guard.js`](../../../tools/mobile-ar-poc/public/page-start-guard.js)가 모듈 시작 실패를 감지해 한 번 다시 불러오고, 또 실패하면 안내와 버튼을 보여 준다. 시간 제한은 바꾸지 않았다.

- **`page-start-browser.mjs` PASS (Chrome 157, 합성):** `route.abort`로 실패를 만든다. 모듈 5종의 자동 복구, 쓰이지 않은 QR 초대로 연결 1회, 두 번째 실패 안내, 재시도 무한 반복 없음, 정상 시작과 사진·일반 스크립트·CSS 실패에는 반응 안 함을 확인했다.
- **실제 오류 PASS, 1건뿐:** run 42372556115 job 4의 Chrome에서 `app.mjs`가 `ERR_NO_BUFFER_SPACE`로 실패했고 224ms에 시작했다. 복구의 효과를 빈도로 입증하기에는 표본이 적다. `main`도 마지막 run은 0/2304였다.
- **시험 쪽 변경:** WebXR·부품 안내 스위트 4개의 콘솔 오류 검사에서 `ERR_NO_BUFFER_SPACE`만 제외했다. 복구된 첫 시도가 콘솔에 남기 때문이다. 페이지가 끝내 시작하지 않으면 여전히 시간 초과로 FAIL한다.

### 남은 위험

- Windows CI에서 **두 번 연달아** 실패하면 안내 화면이 뜨고 시험은 FAIL한다. 빈도는 낮을 것으로 보지만 측정하지 못했다.
- 가드 파일 자체가 실패하면 보호가 없다. 이때 모듈까지 실패하면 예전처럼 멈춘다.
- 실제 휴대폰의 네트워크 끊김에서 가드가 동작하는지는 **NOT_RUN**이다.

## CI 테스트 경쟁 상태 (원인 확인, 일부 수정)

위 `8e68ee5` run의 2차 시도는 다른 이유로 실패했다. `mobile-browser.mjs`가 차량 쪽 수락 뒤 `#sync-refresh`를 누르는데, 2초 폴링이 먼저 최종 상태를 받으면 그 버튼이 숨겨져 클릭이 15초 뒤 실패한다. **제품 결함이 아니고 이 PR과 무관한 기존 시험의 문제다.** 이 파일의 4곳에서 클릭을 빼고 상태 도달만 기다리게 했다. 단언은 그대로다.

**남은 같은 패턴 7곳:** `mobile-ar-browser`, `tire-browser`, `charge-browser`, `brake-browser`, `webxr-render-browser`, `webxr-qr-browser` 2곳. 범위 밖이라 고치지 않았다.

## NOT_RUN

| 항목 | 상태 |
|---|---|
| 실제 휴대폰에서 페이지 시작 복구 | NOT_RUN. CI의 Chrome·Edge와 합성 시험만 있다 |
| 실제 Roboflow 호출, 모델 정확도(6개 부품 모두) | NOT_RUN |
| 냉각수, 브레이크액, 퓨즈박스의 라벨 평가 | NOT_RUN |
| 실제 Render, Render 메모리·CPU 측정 | NOT_RUN. 영향은 계산값 |
| Z Flip8 카메라 앱·갤러리, 탭 폐기 | NOT_RUN |
| 라이선스, 개인정보 검토 | NOT_RUN. 법률 판단이 아니다 |
