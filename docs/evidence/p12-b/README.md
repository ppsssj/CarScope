# P12-B 증거 인덱스

[설계와 판정](../../p12-b-vision-poc.md). 원본은 `C:/CarScope-External/p12-b/`에 있으며 Git에 넣지 않는다.

환경: 기준 main `686b016`, Windows 10, Intel i5-4690(4스레드), RAM 15.9GB, Node 22.16.0, headless Chrome 157.0.8103.38, `@mediapipe/tasks-vision` 1.2.2.

| 범위 | 판정 |
|---|---|
| 워셔액 주입구 탐지 모델과 성능 | **DATASET_REQUIRED**, 모델 없음 |
| Precision, Recall, mAP@0.5, 부품 오인식, 조건별 실패 | **NOT_MEASURED** |
| 대상 모델의 추론 시간, 메모리, 파일 크기 | **NOT_MEASURED** |
| Z Flip8, AVD, Android WebView, 실제 터치, 실차 | **NOT_RUN** (`adb devices`에 기기 없음) |
| Raw Camera Access, WebXR 연동 | **NOT_RUN**, 문서 조사만 |
| Model Maker 학습 | Windows Python 3.11.9 **FAIL** (`tensorflow-text` 없음). Linux, Colab **NOT_RUN** |
| Roboflow 데이터셋 내용 | **BLOCKED** (자동 접근 403) |
| Render, Supabase, QR, 결과 계약, WebXR, 모바일 UI | 변경 없음 |

## 실행

| 검사 | 명령 (`tools/vision-poc`) | 결과 | 폴더 |
|---|---|---|---|
| 문법 | `npm run check` | PASS | |
| 계약, 데이터셋, 평가, 서버, 기준선 동작 | `npm test` | PASS 45, FAIL 0 | |
| 데이터셋 상태 | `npm run dataset:status` | `DATASET_REQUIRED`, 종료 코드 2, 전 항목 0 | |
| 사진 화면 (실제 Chrome, **스크립트 탐지기**) | `npm run test:browser` | PASS 11, FAIL 0 | `run3-browser/` |
| 런타임 (실제 MediaPipe, **COCO 모델**) | `npm run measure:runtime` | PASS | `run3-runtime/` |

스크립트 탐지기는 화면 동작만 확인한다. 어떤 모델이 캡을 찾을 수 있다는 근거가 아니다. CI(`vision-poc-ci.yml`)는 모델과 런타임 측정 없이 위 앞쪽 네 항목을 실행한다.

## 런타임 측정

**EfficientDet-Lite0 int8(COCO), 데스크톱, CPU 위임.** 대상 모델과 휴대폰의 값이 아니다. 서버의 실제 CSP 아래에서 실행했고 외부 요청은 없었다. 모델 SHA-256 `0720bf24…23bb`, 4,602,795 B, 저장소에 넣지 않았다.

| 항목 | 값 |
|---|---|
| 런타임과 모델 로드 | 249.1ms |
| 640×480 | 첫 실행 230.9ms, 이후 30회 중앙값 89.6ms, p95 97.1ms |
| 1280×960 | 첫 실행 102.5ms, 이후 30회 중앙값 92.5ms, p95 97.5ms |
| 1600×1200 | 첫 실행 104.2ms, 이후 30회 중앙값 94.6ms, p95 98.2ms |
| 전체 렌더러 작업 메모리 | 180,703,232 B → 312,385,536 B (+131,682,304 B) |
| `measureUserAgentSpecificMemory` | 1,137,861 B → 24,062,118 B. WASM 힙 포함 여부가 불명확해 대표값으로 쓰지 않음 |
| JS 힙 | 1,777,976 B → 4,250,980 B |

1회차는 값이 더 높았고(중앙값 122.8~188.4ms) 원인은 확인하지 않았다. 2·3회차는 약 90~95ms로 비슷했다. 대표값은 코드가 최종인 3회차다.

### 실제 파일의 원시 출력

| 입력 | 모델 출력 | 계약 판정 |
|---|---|---|
| IONIQ 5 썸네일 (렌더) | `car 0.83` | `NO_DETECTION` |
| P10 3D 워셔액 캡처 | `keyboard 0.45` | `NO_DETECTION` |

추론이 실제로 동작하고, 범용 모델이 이 부품을 알지 못하며, 계약이 다른 라벨을 후보로 만들지 않음을 보인다. 두 장은 성능 표본이 아니다.

## 변이 (선택한 조건만 대상, 완전성 증명이 아님)

규칙을 하나씩 임시로 깨고 원본으로 복원했다. 스크립트는 저장소에 남기지 않았다.

| 임시 변경 | 결과 |
|---|---|
| 모든 클래스를 후보로 인정 | 실패 (정상) |
| 모든 모델을 사용 가능으로 판정 | 실패 (정상) |
| 잘못된 출력을 `NO_DETECTION`으로 처리 | 실패 (정상) |
| 차량 누수 허용 | 실패 (정상) |
| 근접 중복 누수 허용 | 실패 (정상) |
| 미허용 라이선스 허용 | 실패 (정상) |
| 데이터 부족도 `DATASET_READY` | 실패 (정상) |
| 일대일 매칭 제거 | 실패 (정상) |
| IoU 경계 0.5 제외 | 실패 (정상) |
| 서버 쓰기 허용 | 실패 (정상) |
| 탐지 예외를 `NO_DETECTION`으로 표시 | 실패 (정상) |
| 박스 라벨 미표시 | 실패 (정상) |
| 늦게 온 이전 사진 결과 유지 | 실패 (정상) |
| EXIF 옵션을 `none`으로 변경 | **통과.** Chrome 157에서 결과가 바뀌지 않아 이 변이는 판별력이 없다. 같은 사진의 태그 없는 대조군(400×200)과 태그 있는 사진(200×400)을 비교하도록 테스트를 보강했다 |

보강 후 테스트는 통과했으나 변이 전체를 다시 돌리지는 않았다.

## 화면 확인

1회차 `candidates.png`(1000폭)와 `candidates-420.png`(420폭), 수정 후 3회차 `candidates-420.png`를 눈으로 확인했다. 3회차 1000폭은 픽셀 검사만 했다.

**개발 중 발견:** 첫 캡처에서 상자 라벨이 보이지 않았다. `parseFloat(ctx.font)`가 `bold …px`에서 `NaN`을 돌려준 결함으로, 자동 테스트는 통과한 상태였다. 코드를 고치고 라벨 픽셀 검사를 추가했다.

**측정 수정:** 페이지 메모리 API의 WebAssembly 집계가 0으로 나와 렌더러 작업 메모리 측정을 추가했다.

## 외부 자료 확인 범위

| 자료 | 확인 |
|---|---|
| [MediaPipe Object Detector](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector) | 커스텀 모델 요건, COCO, 지연 수치. 모델 라이선스 표기는 해당 페이지에 없음 |
| [Raw Camera Access](https://immersive-web.github.io/raw-camera-access/), [Hit Test](https://immersive-web.github.io/hit-test/), [web-features](https://web-platform-dx.github.io/web-features-explorer/features/webxr-camera), [Chromium Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/LoCH4tthbsI) | 내용 확인. [Chrome Status](https://chromestatus.com/feature/5759984304390144)는 읽지 못함 |
| [ARCore 기기 목록](https://developers.google.com/ar/devices) | Z Flip8 행 직접 확인 |
| PyPI, npm 메타데이터 | 버전, 날짜, 라이선스, 의존성 |
| Z Flip8 사양 | 제3자 사양 페이지 검색 결과. 칩셋 지역 차이는 미확인 |
