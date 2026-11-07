# P12-D 증거 인덱스

[설계와 판정](../../p12-d-zero-shot-comparison.md). 원본은 `C:/CarScope-External/p12-d/`에 있으며 Git에 넣지 않는다. 가중치, 사진, 가상 환경도 저장소에 없다.

환경: 기준 main `a8015bf`, Windows 10, Intel i5-4690(4스레드), RAM 15.9GB, CPU 추론(GTX 1060은 사용하지 않음), Python 3.11.9, torch 2.15.0+cpu, transformers 5.22.2, Node 22.16.0.

| 범위 | 판정 |
|---|---|
| OWLv2, Grounding DINO Tiny, OmDet-Turbo Tiny 추론 | **실행**, 사진 12장, 프롬프트 모드 3개 |
| 성능 지표 | **예비** (`EXPLORATORY_EVALUATION`), 공식 지표 아님 |
| 정식 평가 (`DATASET_GATE`) | **DATASET_REQUIRED**, 수치 변경 없음 |
| 모델 학습, 300장 수집 | **하지 않음** |
| Z Flip8, AVD, 브라우저 추론, 실차 | **NOT_RUN** |
| 라벨의 사람 검수, IONIQ 5 사진 | **없음** |
| Render, Supabase, QR, WebXR, 운영 모바일 코드 | 변경 없음 |

## 사전 고정

`935f210`을 모델 실행 전에 커밋했다.

| 항목 | 값 |
|---|---|
| 보고 프롬프트 (`contrast`) | `windshield washer fluid cap`, `radiator coolant cap`, `brake fluid cap`, `engine oil cap` |
| 진단 프롬프트 | `single`: `windshield washer fluid cap`. `generic`: `cap` |
| 임계값 | OWLv2 0.1, Grounding DINO 0.3, OmDet-Turbo 0.3 |
| 기준 | Recall ≥ 0.8, Precision ≥ 0.8, 검은 캡 탐지, 혼동 부품 오인 0 |

사진은 #102 `343f33b`의 `exploratory-commons.json`(SHA-256 앞자리 `81821629e823157e`)이다. YOLOv8과 색상 규칙의 값은 P12-C의 `run2/results.json`, `run1/baseline-results.json`에서 다시 계산했다. Roboflow는 이번에 호출하지 않았다.

| 모델 | 저장소 | 리비전 |
|---|---|---|
| OWLv2 | `google/owlv2-base-patch16-ensemble` | `cfd3195b` |
| Grounding DINO Tiny | `IDEA-Research/grounding-dino-tiny` | `a2bb814d` |
| OmDet-Turbo Tiny | `omlab/omdet-turbo-swin-tiny-hf` | `7fe93cec` |

## 결과 (`run1/compare.json`)

`contrast`, 사전 고정 임계값. 워셔 라벨의 상자만 골라 NMS(IoU 0.5)를 적용했다.

| 모델 | TP / FP / FN | P | R | mAP@0.5 | 작은 캡 | 검은 캡 | 혼동 오인 | 판정 |
|---|---|---|---|---|---|---|---|---|
| OWLv2 | 10 / 69 / 1 | 0.13 | 0.91 | 0.72 | 4/4 | 0/1 | 냉각수 2 | NOT_RELIABLE |
| Grounding DINO Tiny | 0 / 9 / 11 | 0.00 | 0.00 | 0.08 | 0/4 | 0/1 | 0 | NOT_RELIABLE |
| OmDet-Turbo Tiny | 6 / 23 / 5 | 0.21 | 0.55 | 0.20 | 2/4 | 0/1 | 브레이크액 1 | NOT_RELIABLE |
| YOLOv8 (0.3) | 7 / 1 / 4 | 0.88 | 0.64 | 0.64 | 2/4 | 0/1 | 0 | NOT_RELIABLE |
| 색상 규칙 | 5 / 7 / 6 | 0.42 | 0.45 | 해당 없음 | 1/4 | 0/1 | 냉각수 1 | |

### 진단 프롬프트

| 모델 | `single` | `generic` (`cap`, 위치만) |
|---|---|---|
| OWLv2 | 11 / 212 / 0, mAP 0.75 | 2 / 0 / 9, mAP 0.62 |
| Grounding DINO Tiny | 8 / 18 / 3, mAP 0.34 | 9 / 7 / 2, mAP 0.64 |
| OmDet-Turbo Tiny | 0 / 19 / 11, mAP 0.18 | 0 / 14 / 11, mAP 0.17 |

### 임계값별 (`contrast`, TP/FP/FN)

| 기준 | OWLv2 | Grounding DINO | OmDet-Turbo |
|---|---|---|---|
| 0.05 | 10/219/1 | 9/155/2 | 10/366/1 |
| 0.1 | **10/69/1** | 6/69/5 | 10/147/1 |
| 0.2 | 9/21/2 | 1/28/10 | 10/44/1 |
| 0.3 | 8/7/3 | **0/9/11** | **6/23/5** |
| 0.4 | 7/1/4 | 0/1/11 | 2/12/9 |
| 0.5 | 2/0/9 | 0/1/11 | 0/7/11 |

굵은 글씨가 사전 고정 기준이다. 나머지는 사후 확인이며, 사진에 맞춰 고른 값을 보고 지표로 쓰지 않는다.

### 측정

| 모델 | 로드 (첫 실행) | 추론 중앙값 | 파라미터 | 최대 RSS | 가중치 (HF 메타데이터) |
|---|---|---|---|---|---|
| OWLv2 | 62.3초 | 5,066ms | 154,966,792 | 1,075,134,464 B | 620MB |
| Grounding DINO Tiny | 67.5초 (다운로드 포함), 재실행 2.7초 | 8,807ms | 172,250,626 | 1,431,719,936 B | 689MB |
| OmDet-Turbo Tiny | 45.1초 | 1,253ms | 115,406,806 | 1,044,344,832 B | 462MB |

첫 실행 로드에는 다운로드가 포함된다. OWLv2 실행 중에는 웹 문서 조회가 함께 돌았다.

### 화면 확인

`run1/overlay-owlv2.jpg`, `overlay-grounding-dino-tiny.jpg`, `overlay-omdet-turbo.jpg`를 눈으로 확인했다. 좌표는 사진과 일치한다. 분홍 냉각수 탱크의 워셔 라벨, 엠블럼과 이미지 전체를 덮는 상자를 확인했다.

## 테스트

| 검사 | 명령 (`tools/vision-poc`) | 결과 |
|---|---|---|
| 전체 Node 테스트 | `npm test` | PASS 68, FAIL 0 |
| 비교 스크립트 왕복 | `test/zero-shot-compare.test.mjs` | 포함. 합성 수치만 사용 |

CI는 모델과 사진 없이 판정 코드만 시험한다. **CI 성공은 모델 추론의 증거가 아니다.** Python 추론 스크립트는 CI에서 실행되지 않고 이번 실행으로만 확인했다.

### 변이 (선택한 조건만 대상, 완전성 증명이 아님)

규칙을 하나씩 임시로 깨고 복원했다. 스크립트는 저장소에 남기지 않았다. 13건 모두 테스트가 실패했다(정상): 합쳐진 문구 인정, 모든 라벨 인정, Recall 기준 낮춤, Precision 기준 제거, 검은 캡 요건 제거, 혼동 검사 제거, 임계값 변경, 판정을 성공으로 변경, 중복 미병합, 결과 누락을 빈 결과로 처리, 예비 표시 제거, 라벨 무관 집계, 게이트 검사 제거.

## 진행 중 수정 기록

- **Grounding DINO 라벨 결함 (`935f210` 이후 수정):** 첫 실행에서 낮은 `text_threshold` 때문에 라이브러리가 네 프롬프트를 하나의 라벨로 합쳤고, 판정 코드는 모든 상자를 워셔로 세어 **Recall 0.91이라는 잘못된 값**이 나왔다. 각 상자를 토큰 점수가 가장 높은 프롬프트로 명명하도록 고치고, 합쳐진 문구를 거부하는 검사를 넣어 다시 실행했다. 올바른 값은 0 / 9 / 11이다. 프롬프트, 임계값, 기준은 바꾸지 않았다. 잘못된 결과는 파일을 덮어써 남아 있지 않다.
- **가중치 크기:** HF 캐시 폴더 집계가 1~2MB로 나와 쓸 수 없었고(원인 미확인), Hugging Face 메타데이터 값을 썼다. 실제 내려받은 파일 크기를 측정한 값이 아니다.

## 외부 자료 확인 범위

| 자료 | 확인 |
|---|---|
| Hugging Face 모델 API와 카드 (OWLv2, Grounding DINO, OmDet-Turbo) | 라이선스 태그, 크기, 리비전, 사용 목적 문구 |
| [OWLv2 논문](https://arxiv.org/abs/2306.09683) | 학습 데이터. 일부는 HTML 요약 경유 |
| [GroundingDINO](https://github.com/IDEA-Research/GroundingDINO), [OmDet](https://github.com/om-ai-lab/OmDet) 저장소 | 체크포인트별 학습 데이터, 코드 라이선스 |
| [Objects365](https://www.objects365.org/overview.html) | 이용 조건 문구 없음. Flickr30k, GQA, Cap4M 조건은 미확인 |
| [Roboflow 라이선스](https://roboflow.com/licensing) | OwlV2, GroundingDINO 허용. YOLO-World, YOLOE AGPL-3.0 |
| NVIDIA Grounding DINO 카드 | 읽지 못함. 검색 요약에서 라이선스 설명이 페이지마다 달랐음 |
| `onnx-community/owlv2-base-patch16-ensemble` | 401. 존재 여부 미확인 |
