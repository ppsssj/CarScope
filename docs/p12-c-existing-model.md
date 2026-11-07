# P12-C 기존 학습 모델 재사용 검증

공개 모델 `engine-bay-parts/1`을 재학습 없이 CarScope에 쓸 수 있는지 검증한다. **적용 성공 여부는 아직 판단할 수 없다(`BLOCKED_API_KEY_REQUIRED`).** 모델을 한 번도 실행하지 못했기 때문이다. 어댑터와 예비 평가 경로는 준비했으며, 키가 생기면 명령 한 줄로 실행된다. 실행 결과는 [증거 인덱스](evidence/p12-c/README.md)에 있다.

Render, Supabase, QR, WebXR, 모바일 화면은 바꾸지 않았다. API 키와 이미지는 Git에 없다.

## 결과 구분

| 항목 | 판정 | 내용 |
|---|---|---|
| 기존 모델 적용 | **BLOCKED** | 추론 0회. 키 없이는 호스팅 API와 모델 정보 API 모두 401 |
| 어댑터, 평가 경로 | 구현 | 가짜 로컬 엔드포인트와 자동 테스트로만 확인. 실제 Roboflow 응답은 미확인 |
| 모델 성능 | **NOT_MEASURED** | 탐지 성공·오탐·미탐 사례 없음 |
| 정식 평가 | **DATASET_REQUIRED** | `DATASET_GATE` 수치 변경 없음 |
| 색상 규칙 예비 측정 | 실행 | 실제 사진 12장. 아래 참고 |
| 라이선스 | **조건부, 미확정** | 아키텍처 확인 전에는 판단 불가. 자체 호스팅 상업 사용에 제약 가능성 큼 |
| 비용 | 소액으로 추정, **미확정** | 아키텍처별 크레딧이 달라 실측 필요 |
| Z Flip8 통합 | **NOT_MEASURED** | 기기와 모델 파일 모두 없음 |

## 1. 실행 경로

| 경로 | 가능 여부 | 근거 |
|---|---|---|
| 키 없는 호출 | **불가** | `serverless.roboflow.com`, `detect.roboflow.com`, `api.roboflow.com` 모두 401을 직접 확인 |
| 호스팅 API (키 사용) | 문서상 가능, **NOT_RUN** | 다른 사람의 Universe 모델이 무료 플랜에서 호출되는지는 문서에 없음 |
| 자체 호스팅 서버 (Docker) | 문서상 가능, **NOT_RUN** | [Universe 모델도 키 필요](https://docs.roboflow.com/deployment/self-hosted/self-hosted.md). 최소 4GB RAM, 20GB 디스크 |
| 가중치 파일 다운로드 | **미확인** | [문서](https://docs.roboflow.com/deploy/download-roboflow-model-weights)의 예시는 소유한 프로젝트 기준. 타인의 Universe 모델은 언급 없음 |
| 오프라인 실행 | **미확인** | 가중치는 첫 사용 때 캐시되지만, 캐시 후 키 없이 실행되는지 문서에 없음 |

이 PC에는 Docker가 있지만 Roboflow 이미지는 받지 않았다. 키 없이는 모델을 불러올 수 없기 때문이다.

## 2. 클래스 매핑

`src/roboflow-adapter.mjs`는 `Windshield Wiper Fluid` 한 클래스만 정확히 일치할 때 `washer-fluid-cap`으로 바꾼다. 나머지는 `unmapped:` 접두사를 붙여 기존 계약(`detection-contract.mjs`)이 버리게 한다. 원본 클래스 이름이 우연히 `washer-fluid-cap`이어도 인정하지 않는다. 다른 클래스는 실패 분석에만 보존한다.

좌표는 [Roboflow Inference 원본](https://github.com/roboflow/inference/blob/main/inference/core/entities/responses/inference.py)에서 확인했다. `x`, `y`는 상자 중심의 픽셀 좌표다.

**의미 차이가 남아 있다.** `Windshield Wiper Fluid`는 이름만 봐서는 캡이 아니라 리저버 전체를 가리킬 수도 있다. 그렇다면 캡 기준 IoU 0.5에서는 대부분 미탐이 된다. 평가 보고서는 탐지 지표와 별도로 "캡이 예측 상자 안에 있었는가"를 보조로 기록해, 위치가 틀린 경우와 상자가 큰 경우를 나눈다. 보조 값을 탐지 성공으로 세지 않는다. 또한 클래스 목록 자체를 직접 확인하지 못했다. 이 이름은 요청서에 적힌 값이다.

## 3. 평가 경로의 분리

| | 정식 (`DATASET_GATE`) | 예비 (`EXPLORATORY_EVALUATION`) |
|---|---|---|
| 코드 | `src/dataset.mjs`, `scripts/evaluate.mjs` | `src/exploratory.mjs`, `scripts/exploratory-evaluate.mjs` |
| 수량 기준 | 차량 30대, 양성 300장 등 (변경 없음) | 없음 |
| 라이선스 | CC0, PDM, CC BY 4.0, 소유자 동의 | 저작자 표시를 전제로 CC BY·BY-SA 2.0~4.0 추가. 학습과 Git 복제 없음 |
| 수치의 의미 | 공식 지표 | 예비. `preliminary: true`, 95% 구간과 한계 목록 포함 |

예비 세트의 `split`은 `exploratory`이므로 정식 게이트에서 항상 `DATASET_INVALID`다. `test`로 바꿔도 게이트를 통과하지 못함을 테스트로 고정했다. 호출이 실패한 사진을 빈 결과로 세지 않으며, 그런 경우 보고서를 만들지 않는다.

## 4. 평가 세트

[`dataset/exploratory-commons.json`](../tools/vision-poc/dataset/exploratory-commons.json): **Wikimedia Commons 12장**(양성 11, 음성 1). 파일별 라이선스, 출처, 저작자, 해시, 라벨을 담고 이미지는 Git에 없다. 차량 12종, 제조사 8곳이며, 혼동 부품 라벨이 4개 있다(냉각수 3, 브레이크액 1).

- **선별:** 라이선스가 있는 후보를 제목순으로 최대 180건까지 받아(그 뒤는 보지 않음) 제목으로 최신 승용차 46장으로 좁혔고, 확대해서 **워셔 기호를 읽을 수 있는 캡만** 양성으로 삼았다. 기호가 안 보이면 뺐다(116, 122, 174, 39, 47번 등). 정답을 색으로 정하지 않기 위해서다.
- **한계:** 상자와 기호 판단은 자동화된 단일 작업자(Claude)가 했고 **사람의 검수를 받지 않았다.** 차량 정보는 파일 제목과 설명 기준이다. 공개 사진이어서 모델 학습 데이터와 겹칠 수 있고, 겹치면 점수가 부풀려진다. 기호가 보이는 사진만 골랐으므로 쉬운 쪽으로 치우쳐 있다.
- **IONIQ 5 사진은 0장이다.** 최소 1장의 대상 차량 사진이 필요하다.

## 5. 예비 결과: 색상 규칙

키가 필요 없어 실제로 실행했다. 모바일 페이지와 같은 경로(브라우저 디코딩, 320×240 이하, 수정 없는 `detector.mjs`)다. **AI 모델의 결과가 아니라 이후 비교의 기준이다.**

| 지표 | 값 | 95% Wilson 구간 |
|---|---|---|
| 탐지 / 오탐 / 미탐 | 5 / 7 / 6 | |
| Precision | 0.42 | 0.19~0.68 |
| Recall | 0.45 | 0.21~0.72 |
| mAP@0.5 | `NOT_APPLICABLE` | 점수 없음 |

| 사례 | 내용 |
|---|---|
| 탐지 | Kia Sportage, Corolla, Yaris, Ora Funky Cat, Skoda Rapid (IoU 0.81~0.91) |
| 미탐, 비파란색 | Prius v의 **검은 캡** (상자 없음) |
| 미탐, 색 판정 | Mercedes 청록 캡, Nissan 연한 파랑 캡 (상자 없음) |
| 미탐, 크기·위치 | Kia K5(상자 없음), Dacia·Peugeot(캡이 아닌 곳에만 상자) |
| 오탐, 다른 액체 캡 | Skoda의 **파란 냉각수 캡** |
| 오탐, 차체 | 파란 차량인 Dacia, Peugeot에서 차체로 보이는 영역에 각 3건 |

조건별 결과는 Recall이 그늘 0.60(3/5), 주광 0.40(2/5), 저조도 0(0/1)이다. 표본이 너무 적어 조건의 효과로 해석할 수 없다. 12장을 일부러 골랐으므로 일반 성능으로 쓰면 안 된다. 다만 색상 규칙이 부품을 구분하지 못한다는 P12-B의 분석을 실제 사진에서 처음 확인했다.

## 6. 라이선스와 사용 조건

**공개 데이터는 복제하지 않았다.** `universe.roboflow.com`이 자동 접근을 403으로 막아 MIT 표시, 클래스 목록, 원출처를 직접 확인하지 못했다(`BLOCKED`). 검색 결과에서는 프로젝트의 존재(이미지 2.38k, 모델 1개)만 확인했고 라이선스 표시는 찾지 못했다.

| 층 | 내용 | 판정 |
|---|---|---|
| 데이터셋의 MIT 표시 | 요청서 기준. 직접 미확인. Universe 표시는 올린 사람의 선언이고 사진의 원저작권을 증명하지 않는다 | **미검증** |
| MIT 표시가 모델까지 적용되는가 | [문서](https://docs.roboflow.com/datasets/universe/universe/what-is-roboflow-universe.md)에 설명 없음. [라이선스 안내](https://roboflow.com/licensing)는 **아키텍처별로** 정함 | **적용된다고 가정하지 않음** |
| 모델 아키텍처 | 키가 있어야 확인 가능 | **미확인, 핵심 결정 요인** |
| Roboflow 3.0, YOLOv8 계열인 경우 | AGPL-3.0 또는 GPL 계열. Roboflow 클라우드 안에서는 상업 사용 포함, **자체 호스팅 상업 사용은 무료·Core 미포함**(Enterprise 추가 옵션) | 사실이면 CarScope 내장에 큰 제약 |
| RF-DETR Nano~Large인 경우 | Apache-2.0, 자체 호스팅 가능 | 가장 유리 |
| Roboflow 약관 | [약관](https://roboflow.com/terms) 5절: 다운로드 콘텐츠는 저작자 허가 없이 재호스팅 불가. 공개 플랜은 내부·비상업 사용 조항. 2024-05 기준으로 현재 요금제 이름과 다름 | 사용 전 확인 필요 |
| 호스팅 추론 이미지 | 보관·학습 사용은 문서에 없음. 요금 페이지에 콘텐츠가 제품 개선에 쓰일 수 있고 옵트아웃이 가능하다고 적힘 | 사용자 사진 전송 전 확인 필요 |

법률 판단이 아니라 공개 문서를 읽은 결과다. 상용 출시 전에는 법률 검토가 필요하다.

**안전장치:** 소유자 동의 사진은 `hostedInferenceConsent`가 있어야 호스팅 API로 보낸다. 실제 사용자의 사진을 Roboflow로 보내는 흐름은 만들지 않았다.

## 7. 비용

[요금 페이지](https://roboflow.com/pricing) 기준이며 실제 청구는 확인하지 않았다.

| 항목 | 내용 |
|---|---|
| 무료 플랜 | $0, 월 10 크레딧 |
| 호출당 크레딧 | YOLOv8 Nano, RF-DETR Nano 0.000125, RF-DETR Medium 약 0.000188. **이 모델의 값은 미확인** |
| 이번 예비 평가 12장 | 위 단가라면 0.003 크레딧 미만, 무료 한도 안의 추정 |
| 자체 호스팅 | 크레딧 없음. 라이선스 조건은 별도 |
| 추가 크레딧 | 선불 $4부터, 온디맨드 $6 |

`roboflow-infer.mjs`는 호출 전 수량을 제한하고(기본 100회), 401·403·402·429를 받으면 즉시 멈춘다.

## 8. MediaPipe 호환성과 별도 어댑터

**모델 파일을 확보하지 못해 평가하지 않았다(`NOT_EVALUATED`).**

[MediaPipe](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector)는 LiteRT 형식, 메타데이터, 정해진 네 개의 출력 텐서(boxes, classes, scores, num_boxes)를 요구한다. Roboflow 문서는 Roboflow 3.0·YOLOv8의 TFLite(int8), ONNX, TF.js 형식을 나열한다. YOLO 계열 내보내기는 보통 후처리 전 원시 출력이므로 **그대로 호환되지 않을 가능성이 높지만, 파일을 보기 전에는 단정하지 않는다.**

파일을 받으면 다음 순서로 본다.

1. 아키텍처와 라이선스를 먼저 확인한다. 자체 호스팅 권리가 없으면 여기서 멈춘다.
2. TFLite의 입출력 텐서와 메타데이터를 검사한다. 네 텐서와 메타데이터가 있으면 기존 `detector-runtime.mjs`로 시험한다.
3. 호환되지 않으면 아래 어댑터를 만든다.

```text
createDetector() ── 기존 계약 ──> detect(canvas) → [{categories, boundingBox}]
                                        ▲
      MediaPipe 런타임 (detector-runtime.mjs)
      또는 ONNX Runtime Web + 전처리(리사이즈·정규화) + 후처리(디코딩·NMS) + 클래스 매핑
```

교체 지점은 `detector-runtime.mjs` 하나다. 어댑터가 같은 형태를 돌려주면 화면, 계약, 평가기는 바꾸지 않는다. 후처리와 전처리는 원본 프레임워크 결과와 수치 비교로 검증한다. ONNX Runtime Web의 라이선스와 번들 크기, WebGPU·WASM 성능은 그때 측정한다.

## 9. Z Flip8 통합 가능성

**`NOT_MEASURED`.** 연결된 기기가 없고 모델도 실행하지 못했다. 경로별 조건만 정리한다.

| 경로 | 조건 | 문제 |
|---|---|---|
| 기기 안 추론 (TF.js, ONNX, TFLite) | 파일 확보, 상업 권리, 실기기 측정 | 권리가 가장 큰 불확실성. 사진이 기기를 떠나지 않는 P12-B 방향에 맞음 |
| 호스팅 API 경유 | 서버 프록시 신설 | 키를 페이지에 넣을 수 없음. 사진이 외부로 나감. 운영 변경이라 별도 승인 필요 |

## 10. 재학습 여부

**지금은 제안하지 않는다.** 판단할 평가 결과가 없다. 모델을 실행한 뒤 다음의 경우에 다시 검토한다.

- 클래스가 리저버 전체를 가리켜 캡 위치 안내에 쓸 수 없을 때
- 라이선스 때문에 쓸 수 없을 때. 이때는 재학습도 허용 라이선스 아키텍처로 해야 한다
- 비파란색 캡이나 다른 액체 캡에서 색상 규칙보다 나아지지 않을 때

이 경우에도 입력 데이터는 `DATASET_GATE`의 권리 조건을 따른다.

## 11. 키가 생기면 실행할 명령

키는 저장소 밖에 둔다. 저장소 안의 키 파일은 스크립트가 거부한다. 다음은 **공개 Commons 사진만** 호스팅 API로 보낸다.

```powershell
Set-Location tools/vision-poc
node scripts/fetch-exploratory.mjs dataset/exploratory-commons.json C:\CarScope-External\p12-c\exploratory
$env:ROBOFLOW_API_KEY_FILE='C:\CarScope-External\roboflow.key'
node scripts/roboflow-infer.mjs dataset/exploratory-commons.json C:\CarScope-External\p12-c\exploratory C:\CarScope-External\p12-c\run2\results.json
node scripts/exploratory-evaluate.mjs dataset/exploratory-commons.json C:\CarScope-External\p12-c\run2\results.json
```

먼저 확인할 것은 첫 응답의 클래스 이름, 아키텍처, 상자가 캡과 리저버 중 어느 쪽을 감싸는지다. 실제 요청 형식은 Roboflow SDK 코드와 문서로 맞췄지만 실제 서버에서 시험하지 않았으므로, 첫 실행에서 어긋날 수 있다.
