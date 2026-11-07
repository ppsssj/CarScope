# P12-B 워셔액 주입구 AI 객체 탐지 PoC

사진에서 워셔액 주입구 후보를 찾을 수 있는지 검증하기 위한 독립 PoC다. **현재 판정은 `DATASET_REQUIRED`다.** 사용 권한과 라벨이 확인된 이미지가 0장이라 모델을 학습하지 않았고, 워셔액 주입구 탐지 성능은 존재하지 않는다. 운영 서비스, 모바일 화면, QR, 결과 계약, WebXR 코드는 바꾸지 않았다. 실행 결과는 [증거 인덱스](evidence/p12-b/README.md)에 있다.

## 판정

| 항목 | 판정 |
|---|---|
| 워셔액 주입구 탐지 | `DATASET_REQUIRED`. 모델 없음 |
| Precision, Recall, mAP@0.5, 부품 오인식, 조건별 실패 | `NOT_MEASURED` |
| 대상 모델의 추론 시간, 메모리, 파일 크기 | `NOT_MEASURED` |
| 사진 → 후보 → 사용자 확인 흐름 | 구현. 스크립트 탐지기로 검증 |
| MediaPipe 런타임 동작 | 데스크톱 Chrome에서 COCO 모델로 확인. 대상 모델이 아님 |
| Z Flip8 | `NOT_MEASURED`. 연결된 기기 없음 |
| WebXR 연동 | 조사만 함. 코드 변경 없음 |

## 기존 색상 탐지의 한계

`tools/mobile-ar-poc/public/detector.mjs`는 객체 인식 모델이 아니다. 파란색 픽셀의 연결 영역을 찾는 규칙이며 코드 첫 줄에 의미 인식이나 확률이 없다고 적혀 있다. 일반 카메라 경로에서 `app.mjs`가 250ms마다 320×240 이하 프레임으로 호출하고, 화면에는 `후보 · 미검증`으로 표시한다. 3D AR 안내가 열려 있으면 `canCamera`가 일반 카메라를 막으므로 함께 실행되지 않는다.

`detection-contract.test.mjs`가 수정하지 않은 원본으로 고정한 동작은 다음과 같다. 그린 프레임에서 규칙이 어떻게 동작하는지 보인 것이며 현장 오류율은 아니다.

| 한계 | 확인된 동작 |
|---|---|
| 부품을 구분하지 못함 | 파란 영역이면 무엇이든 후보 |
| 다른 색 캡 | 노랑, 흰색, 검정, 빨강 영역은 후보 없음 |
| 크기 규칙 | 프레임의 약 0.03%와 약 19% 영역은 제외 |
| 그림자 | 영역 한가운데를 가르는 선이 있으면 후보 2개로 분리 |
| 어두운 조명 | 파랑 값 75 미만이면 제외 |
| 신뢰도 | 없음. 그래서 mAP는 계산할 수 없고 `NOT_APPLICABLE` |

과거 스마트폰 관측에서도 다른 파란 영역이 후보로 잡혔다([HTTPS_STAGING](../tools/mobile-ar-poc/HTTPS_STAGING.md)). 이 규칙은 평가기에서 비교 기준으로 유지하며, PoC 화면에서도 `AI 아님`으로 구분해 표시한다.

## 기술 선택

**런타임은 MediaPipe Tasks Vision 1.2.2를 브라우저에서 CPU로 실행하고, 입력은 사진 1장으로 시작한다. 학습 도구는 아직 정하지 않았다.**

| 후보 | 평가 | 결정 |
|---|---|---|
| MediaPipe Tasks Vision, 브라우저 | Apache-2.0(npm 메타데이터). 서버 추론이 필요 없어 사진이 기기를 떠나지 않는다. 런타임을 CDN 없이 제공할 수 있다 | **선택** |
| 커스텀 모델 | 필수. 사전 학습 모델은 COCO 80개 라벨뿐이고 라벨 목록에 washer, cap, fluid, reservoir, engine이 없다. LiteRT 형식과 메타데이터가 필요하다 | **필수, 학습은 데이터 후** |
| 사전 학습 EfficientDet-Lite0 그대로 사용 | 실행 결과 3D 워셔액 캡처에서 `keyboard 0.45`만 나왔다 | **제외.** 런타임 측정용 |
| 사진 1장 | 흔들림이 적고, 실패 분석과 평가가 쉬우며, 카메라 수명주기를 건드리지 않는다 | **1차** |
| 카메라 프레임 | 공식 문서상 웹 태스크는 동기 실행이다. 메인 스레드를 막지 않으려면 Worker와 속도 제한, 발열 측정이 필요하다 | **사진 평가 후** |
| 서버 추론 | 사진 전송과 운영 의존성이 생긴다 | **제외** |
| Ultralytics YOLO | AGPL-3.0 또는 상용 라이선스로 알려져 있다. 이번에 원문을 다시 확인하지 않았다 | **라이선스 검토 전 제외** |

### 학습 도구의 위험

- [커스텀 모델 안내 URL](https://developers.google.com/edge/mediapipe/solutions/customization/object_detector)이 이제 일반 Object Detector 문서를 돌려준다. Model Maker 내용이 없고, 폐기 여부를 밝힌 문구도 찾지 못했다.
- PyPI `mediapipe-model-maker`의 최신 버전은 0.2.1.4이고 2024-04-22에 올라왔다. `tensorflow<2.16`을 요구한다.
- 이 PC(Windows, Python 3.11.9)에서 `pip install --dry-run`이 `tensorflow-text`를 찾지 못해 **실패**했다. Linux와 Colab은 `NOT_RUN`이다.

따라서 데이터 수집 전에 Linux에서 소량으로 학습과 변환, 메타데이터 작성, 브라우저 로드까지 확인해야 한다. Model Maker가 안 되면 Apache 계열 검출기를 LiteRT로 변환하는 방법을 비교한다.

### 크기

| 파일 | 원본 | gzip |
|---|---|---|
| `vision_wasm_internal.wasm` | 14,603,354 B | 4,120,661 B |
| `vision_wasm_internal.js` | 334,128 B | 80,672 B |
| `vision_bundle.mjs` | 156,062 B | 44,926 B |
| 런타임 합계 | 15,093,544 B | 4,246,259 B |
| EfficientDet-Lite0 int8 (참고, 대상 모델 아님) | 4,602,795 B | 측정 안 함 |

웹 모드의 Chrome 지연은 대상 모델로 측정해야 한다. 모바일 페이지에 넣으면 첫 로드가 크게 늘어나므로, 점검 흐름에 넣을 때는 요청 시 로드가 조건이다.

## PoC 구성

`tools/vision-poc`에만 있고 모바일 페이지와 배포 진입점은 이 경로를 참조하지 않는다. 테스트가 이를 검사한다.

```text
사진 선택 → 브라우저 안에서 탐지 → 후보 상자와 모델 점수 → 사용자가 맞아요/아니에요/모르겠어요
```

| 파일 | 역할 |
|---|---|
| `src/detection-contract.mjs` | 모델 자격, 탐지 해석, 상태 값 |
| `src/dataset.mjs` | 권한, 라벨, 누수, 수량 게이트 |
| `src/evaluate.mjs` | IoU 0.5 일대일 매칭, Precision, Recall, AP, 부품 오인식, 조건별 집계 |
| `public/` | 사진 PoC 화면. MediaPipe는 `detector-runtime.mjs`에서만 사용 |
| `server.mjs` | 127.0.0.1 전용, 읽기 전용, 고정 경로만 제공. 업로드 경로 없음 |
| `scripts/` | 데이터셋 상태, 평가, 이미지 지문 |

| 상태 | 뜻 |
|---|---|
| `MODEL_REQUIRED` | 학습된 모델이 없음. 지금 상태 |
| `MODEL_NOT_TARGET` | 이 클래스로 학습된 모델이 아님. 탐지기를 만들지 않음 |
| `MODEL_LOAD_FAILED`, `INFERENCE_FAILED`, `IMAGE_UNREADABLE` | 오류. 탐지 없음과 구분 |
| `NO_DETECTION` | 추론이 끝났고 기준을 넘는 대상 클래스가 없음. 주입구가 없다는 뜻은 아님 |
| `CANDIDATES` | 사용자가 확인할 위치. `verified: false` |

사용자의 답은 페이지 메모리에만 있다. 점검 결과 계약으로 가는 경로가 없고, 화면은 점검 성공이나 캡 개방, 보충을 권하지 않는다. 안내 문구는 PR #97의 비접촉 원칙과 같다. 점수 기준 0.5는 데이터가 없어 보정하지 못한 값이므로 화면에 `보정되지 않은 점수`라고 표시한다.

## 데이터셋 현황

**권한과 라벨이 확인된 이미지 0장, 차량 0대.** 저장소의 [실제 목록](../tools/vision-poc/dataset/manifest.json)은 비어 있다.

| 출처 | 확인 내용 | 판정 |
|---|---|---|
| `C:/CarScope-External` | 3D 렌더 캡처와 차량 썸네일. 실제 엔진룸 사진 없음 | 학습 불가 |
| Open Images | [boxable 클래스 목록](https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv)에 해당 클래스 없음 | 사용 불가 |
| Roboflow Universe | 페이지가 자동 접근에 403. 검색 요약에 CC BY 4.0으로 표시된 engine bay 계열 데이터셋이 있으나 클래스는 미확인 | **BLOCKED**, 로그인 후 사람이 확인 |
| Wikimedia Commons | 파일 이름·설명 검색 건수만 조회: `washer fluid reservoir` 24, `windshield washer fluid cap` 0, `brake fluid reservoir` 9, `coolant reservoir` 523. 내용은 보지 않았고 라벨이 없다 | 미검토, 보조 후보 |

어떤 이미지도 내려받아 학습 자료로 쓰지 않았다. 공개 데이터셋의 라이선스 표기는 올린 사람의 주장이므로, 사용한다면 사진의 원출처까지 확인해야 한다.

## 수집 계획

수량은 첫 평가의 진입 조건이며 데이터가 생기기 전에 `DATASET_GATE`로 고정했다. 결과를 본 뒤 낮추지 않는다. 통계적 보증은 아니다. 예를 들어 테스트 양성 60장에서 Recall 0.90이 나오면 95% Wilson 구간은 0.80~0.95다.

| 항목 | 필요 수량 |
|---|---|
| 서로 다른 차량 / 제조사 | 30대 / 5곳 |
| 워셔액 캡이 있는 이미지 | 300장 |
| 파란색이 아닌 캡 이미지 | 30장 |
| 워셔액 캡 없이 혼동 부품만 있는 이미지 | 150장 |
| 테스트 양성 / 테스트 차량 | 60장 / 6대 |
| 테스트의 IONIQ 5 양성 | 10장 |
| 테스트의 냉각수 캡, 브레이크액 캡 | 각 20개 |
| 테스트의 저조도, 부분 가림, 비스듬한 각도, 반사 | 조건별 양성 15장 |

**촬영:** 차량당 전체 엔진룸과 확대 사진을 섞어 약 15장을 Z Flip8로 찍는다. 정차, 전원 끔, 보닛 고정, 냉각 후 **눈으로만** 촬영하며 부품을 만지거나 캡을 열지 않는다.

**권한:** 차량 소유자의 서면 동의를 기록한다. 번호판, 차대번호, 사람은 촬영 전에 피하거나 가리고 검토 표시를 남긴다. 공개 이미지는 CC0, PDM, CC BY 4.0만 받고 NC, ND, SA, 출처 불명은 거부한다.

**라벨:** 정답은 색이 아니라 **워셔 기호 또는 사용설명서**로 정한다. 근거를 확인할 수 없으면 라벨을 달지 않는다. 혼동 부품(냉각수, 브레이크액, 오일, 기타 액체 캡, 파란 물체)도 상자를 그린다.

**누수 방지:** 차량 단위로 먼저 train, val, test를 나눈다. 차량, 촬영 세션, 파일 해시, 근접 중복(dHash 해밍 거리 6 이하)이 분할을 넘으면 `DATASET_INVALID`다. 테스트는 평가에 한 번만 쓰고 임계값 조정은 val에서 한다.

원본은 `C:/CarScope-External/p12-b/dataset/`에 두고 Git에는 넣지 않는다.

## Z Flip8 적용 가능성

**판단할 수 없다(`NOT_MEASURED`).** 이번 실행에 연결된 기기가 없었고 대상 모델도 없다.

| 근거 | 내용 |
|---|---|
| [ARCore 지원 기기](https://developers.google.com/ar/devices) | Galaxy Z Flip8 등재, Depth API 지원 |
| 공개 사양 | 12GB RAM, Exynos 2600으로 다수 표기. 일부 페이지는 Snapdragon도 표기해 지역별 차이는 미확인 |
| [공식 벤치마크](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector) | EfficientDet-Lite0 int8 CPU 29.31ms. **Pixel 6 수치이며 네이티브와 웹 구분을 확인하지 못했다.** Z Flip8 수치로 쓰지 않는다 |
| 이번 데스크톱 측정 | i5-4690에서 약 90ms, 렌더러 작업 메모리 약 132MB 증가. 휴대폰 수치가 아니다 |

긍정적인 신호는 있지만 입증은 아니다. 실기기 측정 항목은 첫 로드 시간, 단일 추론 시간, 렌더러 메모리, 접힌 화면과 펼친 화면의 표시, 연속 실행 발열이다.

## WebXR 연동

**1차 목표는 일반 카메라나 사진에서 후보를 보여 주는 것이고, 3D 자동 정합은 하지 않는다.**

| 제약 | 근거 |
|---|---|
| 일반 카메라와 AR 동시 사용 불가 | 프로젝트 정책. `canCamera`가 AR 안내 중 카메라를 막고, 교대 시 정리한다 |
| 현재 AR 세션은 카메라 프레임을 받지 않음 | `webxr-capability.mjs`: 필수 `local`, `hit-test`, 선택 `anchors`, `dom-overlay`. `camera-access` 없음 |
| Raw Camera Access는 불투명 WebGL 텍스처 | [명세 초안](https://immersive-web.github.io/raw-camera-access/): 활성 프레임 안에서만 유효. 탐지기에 넣으려면 GPU 처리나 픽셀 읽기가 필요 |
| 지원 범위가 좁음 | [web-features](https://web-platform-dx.github.io/web-features-explorer/features/webxr-camera): Chrome Android 107 이상. Safari 반대, Firefox 보류, Baseline 가능성 낮음 |
| 개인정보 부담이 가장 큼 | 명세: 모든 WebXR 기능 중 개인정보 영향이 가장 크고, 표시기가 필수이며, 대안이 있으면 요청하지 말라고 권고 |
| 동기 추론이 프레임을 막음 | 데스크톱에서도 약 90ms로 AR 프레임 간격보다 길다. 휴대폰 값은 미측정 |
| 2D 상자에는 깊이가 없음 | 상자만으로 3D 좌표를 정할 수 없다 |
| Hit Test는 부품 표면을 보장하지 않음 | [명세](https://immersive-web.github.io/hit-test/): 기기가 이해한 환경과의 교차점. 평면과 특징점이 부족한 엔진룸에서는 맞으리라 가정할 수 없다 |

Raw Camera Access의 Z Flip8 실동작은 `NOT_RUN`이다. 지원 표는 API 존재를 말할 뿐 이 흐름의 성능을 보장하지 않는다.

**2차 흐름(미구현):** 사진에서 사용자가 후보를 확인 → 일반 카메라 종료 → AR 시작 → 확인한 사진을 참고 이미지로 표시 → 기존 흐름대로 사용자가 조준하고 탭해 표시 배치. 상자 좌표를 3D로 넘기지 않는다. `내가 지정한 위치`라는 기존 표현을 유지한다. 자동 3D 정합은 별도 단계로 남기며, 실차에서 실측 오차를 재는 방법부터 정해야 한다.

## 다음 단계

1. Roboflow 후보의 클래스와 원출처를 사람이 확인한다.
2. Linux에서 소량 이미지로 학습, 변환, 메타데이터, 브라우저 로드를 확인하고 학습 도구를 정한다.
3. 수집 동의 양식을 승인받고 위 계획대로 수집과 라벨링을 한다.
4. `dataset:status`가 `DATASET_READY`가 되면 학습하고, 색상 규칙과 AI 모델을 같은 테스트 분할로 평가한다.
5. Z Flip8에서 대상 모델을 측정한다.
6. 그 결과로 모바일 통합, 프레임 추론, 2차 AR 흐름의 진행 여부를 별도 승인받는다.

이 단계를 마치기 전에는 AI 탐지를 운영에 넣지 않는다.
