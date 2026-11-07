# P12-D 학습 없는 사전학습 탐지 모델 비교

새 데이터를 학습하기 전에, 텍스트 프롬프트만으로 워셔액 캡을 찾을 수 있는지 검증했다. 사전학습 모델 3종을 실제 사진 12장에서 추론하고 P12-C의 YOLOv8 및 색상 규칙과 비교했다. 실행 근거는 [증거 인덱스](evidence/p12-d/README.md)에 있다.

## 판정

**세 모델 모두 `NOT_RELIABLE`이다. 텍스트 프롬프트만으로는 워셔액 캡을 안정적으로 찾지 못하며, 성공으로 판정하지 않는다.**

| 항목 | 판정 |
|---|---|
| CarScope 적용 | **불가.** 오탐이 많고 다른 액체 캡을 구분하지 못하며, 휴대폰 안에서 돌리기에 무겁다 |
| 제품 권장 모델 | **없음** |
| 연구 권장 모델 | **OWLv2** (`owlv2-base-patch16-ensemble`). 위치 후보 생성과 라벨링 보조 후보. 제품용이 아니다 |
| 정식 평가 | `DATASET_REQUIRED`. `DATASET_GATE` 변경 없음 |
| Z Flip8 | `NOT_RUN` |

가장 중요한 발견은 **모델이 캡을 보지 못하는 것이 아니라 어떤 캡인지 구분하지 못한다는 점이다.** OWLv2는 11개 캡 모두에 상자를 놓았고 위치도 정확했지만, 분홍 냉각수 탱크를 워셔액이라 하고 검은 워셔 캡을 엔진오일이라 했다.

## 1. 결과 (`EXPLORATORY_EVALUATION`, 예비)

공식 지표가 아니다. 사진 12장(양성 11, 음성 1), IoU 0.5, `contrast` 프롬프트로 상자의 라벨이 워셔일 때만 인정했다.

| 모델 | 기준 | TP / FP / FN | Precision (95%) | Recall (95%) | mAP@0.5 | 판정 |
|---|---|---|---|---|---|---|
| OWLv2 | 0.1 | 10 / 69 / 1 | 0.13 (0.07~0.22) | 0.91 (0.62~0.98) | 0.72 | NOT_RELIABLE |
| Grounding DINO Tiny | 0.3 | 0 / 9 / 11 | 0.00 (0~0.30) | 0.00 (0~0.26) | 0.08 | NOT_RELIABLE |
| OmDet-Turbo Tiny | 0.3 | 6 / 23 / 5 | 0.21 (0.10~0.38) | 0.55 (0.28~0.79) | 0.20 | NOT_RELIABLE |
| YOLOv8 (`engine-bay-parts/1`, P12-C) | 0.3 | 7 / 1 / 4 | 0.88 (0.53~0.98) | 0.64 (0.35~0.85) | 0.64 | NOT_RELIABLE |
| 색상 규칙 | 없음 | 5 / 7 / 6 | 0.42 (0.19~0.68) | 0.45 (0.21~0.72) | 계산 불가 | |

**실행 전에 고정한 기준(`935f210`):** 프롬프트, 모델별 임계값, 그리고 Recall 0.8 이상, Precision 0.8 이상, 검은 캡 탐지, 혼동 부품 오인 0건. 이를 모두 넘어도 "더 큰 평가의 가치 있음"일 뿐 성공이 아니다. **어떤 모델도 넘지 못했다.**

**OWLv2의 mAP 0.72가 YOLOv8의 0.64보다 높다고 더 낫다는 뜻은 아니다.** 12장에서 차이가 작고, 실제 쓰는 임계값에서는 오탐이 69건이다. 임계값을 이 사진에 가장 유리하게 고르면(0.4) 7 / 1 / 4로 YOLOv8과 같아지지만, 사후에 고른 값이라 낙관적이다. 이때도 0.4에서 0.5로 올리면 TP가 7에서 2로 떨어져 안정적이지 않다.

## 2. 위치 정확도

| 모델 | 캡 위에 상자 (라벨 무관) | TP의 IoU |
|---|---|---|
| OWLv2 | 11 / 11 | 0.84~0.97 |
| Grounding DINO Tiny | 10 / 11 | TP 없음 |
| OmDet-Turbo Tiny | 6 / 11 | 0.65~0.92 |
| YOLOv8 | 9 / 11 (숫자 클래스 포함) | 0.52~0.81 |
| 색상 규칙 | 5 / 11 | 0.81~0.91 |

OWLv2는 상자가 가장 정확하다. 겹쳐 그린 이미지에서도 좌표가 캡과 일치함을 확인했다.

## 3. 검은 캡, 작은 캡, 다른 액체 캡

표본이 매우 작다. 검은 캡 1장, 작은 캡(사진의 0.25% 미만) 4장, 혼동 부품 라벨 4개뿐이어서 일반화할 수 없다.

| 사례 | OWLv2 | Grounding DINO | OmDet-Turbo | YOLOv8 | 색상 규칙 |
|---|---|---|---|---|---|
| **검은 캡** (Prius v) | 실패. 상자는 있으나 `engine oil cap` 0.34 | 실패. 상자 없음 | 실패. 상자 없음 | 실패. 상자 없음 | 실패 |
| **작은 캡** | 4 / 4 | 0 / 4 | 2 / 4 | 2 / 4 | 1 / 4 |
| **냉각수 캡을 워셔로 오인** | **2건** (Skoda, Ora) | 0 | 0 | 0 | 1건 (Skoda) |
| **브레이크액 캡을 워셔로 오인** | 0 | 0 | **1건** (Fabia) | 0 | 0 |

Grounding DINO의 오인 0건은 구분을 잘해서가 아니라 워셔 라벨을 거의 내지 않아서다(TP도 0). OWLv2도 프롬프트를 `windshield washer fluid cap` 하나만 주면 검은 캡을 찾지만(11 / 212 / 0), 브레이크액 캡까지 워셔로 부르며 오탐이 212건이 된다.

## 4. 속도, 크기, 메모리

i5-4690 CPU 4스레드에서 측정했다(사진당 중앙값, `contrast`). 휴대폰 값이 아니다. OWLv2 실행 중에는 웹 조회가 함께 돌았으나 영향은 작을 것으로 본다.

| 모델 | 추론 | 가중치 | 파라미터 | 프로세스 최대 메모리 |
|---|---|---|---|---|
| OWLv2 | 5.1초 | 620MB | 1.55억 | 1.08GB |
| Grounding DINO Tiny | 8.8초 | 689MB | 1.72억 | 1.43GB |
| OmDet-Turbo Tiny | 1.3초 | 462MB | 1.15억 | 1.04GB |
| YOLOv8 (`yolov8n`) | 호스팅 왕복 0.36초 (직접 비교 불가) | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| 색상 규칙 | `NOT_MEASURED` (브라우저) | 사실상 없음 | 없음 | `NOT_MEASURED` |

가중치 크기는 Hugging Face 메타데이터 값이고, YOLOv8 왕복 시간에는 네트워크가 포함된다.

## 5. 라이선스

**"상용에 유리"하다고 단정할 수 없다.** 코드와 가중치의 Apache-2.0 태그는 분명하지만, 학습 데이터 조건까지 해결되지는 않는다. 법률 판단이 아니라 공개 자료를 읽은 결과다.

| 모델 | 표시 라이선스 | 학습 데이터 | 남은 위험 |
|---|---|---|---|
| OWLv2 | Apache-2.0 ([모델 카드](https://huggingface.co/google/owlv2-base-patch16-ensemble)) | WebLI 자기학습, LVIS 미세조정 ([논문](https://arxiv.org/abs/2306.09683)) | 카드에 `research output`, 주요 사용자는 AI 연구자라고 적혀 있음. 상용 언급 없음 |
| Grounding DINO Tiny | Apache-2.0 ([저장소](https://github.com/IDEA-Research/GroundingDINO)) | O365, GoldG, Cap4M | [Objects365 페이지](https://www.objects365.org/overview.html)에 이용 조건 없음. GoldG·Cap4M은 미확인 |
| OmDet-Turbo Tiny | Apache-2.0 ([저장소](https://github.com/om-ai-lab/OmDet)) | O365, GoldG | 같음 |
| YOLOv8 (P12-C) | AGPL 계열 | 원출처 미확인 | P12-C 문서 참고 |

[Roboflow 안내](https://roboflow.com/licensing)도 OwlV2와 GroundingDINO를 허용 라이선스로 분류한다. 제외한 후보는 AGPL로 안내된 YOLO-World와 YOLOE다. NVIDIA의 상용 표시 Grounding DINO는 페이지마다 라이선스 설명이 달라 보였고, 카드 원문을 읽지 못해 평가하지 않았다.

## 6. 실패 원인

"관찰"은 결과에서 확인한 사실이고 "추정"은 12장으로 검증하지 못한 가설이다.

| 원인 | 관찰 | 추정 |
|---|---|---|
| **이름 구분 실패 (핵심)** | 캡 위에 상자가 있어도 다른 이름을 붙임. Grounding DINO는 `cap`만 물으면 9/11을 찾지만, 4개 이름을 주면 0/11 | 텍스트 임베딩이 액체 종류를 구분할 만큼 학습되지 않음. 드문 전문 어휘 |
| **기호를 읽지 못함** | 사람이 정답 근거로 쓴 워셔 기호와 무관하게 분홍 탱크를 워셔로 부름 | 큰 사진에서 약 50px인 캡은 입력 축소 후 기호 해상도가 부족함 |
| **색·형태 일반화** | 탱크, 전조등, 엠블럼에도 상자가 나옴 | 투명 탱크가 "액체" 개념과 가까움 |
| **임계값 불안정** | OWLv2는 0.4→0.5에서 TP 7→2, Grounding DINO는 0.1→0.15에서 6→1 | 점수 분포가 좁아 사진이 바뀌면 기준이 어긋날 수 있음 |
| **무거운 모델** | 가중치 460~690MB, 메모리 1GB 이상 | 휴대폰 브라우저에는 부적합 |

## 7. CarScope 적용 가능성

| 경로 | 평가 |
|---|---|
| 휴대폰 브라우저 안에서 실행 | **부적합.** Grounding DINO의 양자화 ONNX도 [검색 결과](https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX) 기준 151MB 이상이며 Z Flip8 실측은 없음. OWLv2의 ONNX 공개판은 확인하지 못함 |
| 서버에서 실행 | 정확도 문제가 남고 사진 전송과 운영 부담이 생김 |
| 앱의 사용자 기능 | **도입하지 않음.** 다른 액체 캡을 워셔로 부르는 것은 안전 안내 측면에서 받아들일 수 없음 |
| 오프라인 라벨링 보조 | **유망, 미검증.** OWLv2의 후보 상자를 사람이 확인하면 수집한 사진의 상자 작업을 줄일 가능성이 있음. 이름은 사람이 정해야 함 |

## 8. 권장 다음 단계

1. **제품은 현재의 수동 안내를 유지한다.** P12-A의 안내와 사용자의 직접 확인이 지금 가장 안전하다.
2. 텍스트 프롬프트 모델에 프롬프트 조정을 더 투자하지 않는다. 12장에 맞춰 조정하면 수치만 좋아지고 일반성을 잃는다.
3. P12-C 권장안(권리가 확보된 자체 데이터로 허용 라이선스 모델 학습)이 여전히 유력하다. 이번 결과는 **구분 능력은 부품 전용 학습이 필요함**을 뒷받침한다. YOLOv8이 작은 모델인데도 오탐이 훨씬 적었기 때문이다. 다만 12장의 예비 결과이며, 학습과 300장 수집은 별도 승인 후 진행한다.
4. 승인 전 저비용 시험: OWLv2 라벨링 보조로 상자 작업 시간이 실제로 줄어드는지 소량으로 잰다.
5. 두 단계 구조(OWLv2로 후보 → 부품 분류기로 판별)는 가능성이 있지만 이번에 시험하지 않았다.

## 9. 평가의 한계

- **표본:** 12장이고 선별됐다. 워셔 기호가 보이는 사진만 양성으로 삼아 쉬운 쪽으로 치우친다. 구간이 대부분 겹치므로 순위를 입증하지 못한다.
- **라벨:** 자동화된 단일 작업자가 달았고 사람의 검수를 받지 않았다.
- **프롬프트:** 사전에 고정한 한 벌만 시험했다. 다른 문구의 성능은 모른다. 모델별 임계값은 문서의 예시에서 가져왔다.
- **상자 수:** 프롬프트마다 상위 150개만 저장했다. OWLv2는 이 한도에 가까워 저점수 구간의 mAP가 약간 과소평가될 수 있다.
- **학습 데이터 중복:** 공개 사진이어서 WebLI 등과 겹칠 수 있다. 겹쳐도 성공하지 못했으므로 판정에는 영향이 없다.
- **대상 차량:** IONIQ 5 사진이 없다. 실차와 휴대폰 촬영 사진은 시험하지 않았다.
- **YOLOv8의 비교 기준:** P12-C 결과를 그대로 썼고 임계값 0.3은 그 표에서 고른 값이다.

## 10. 평가 경로의 분리

정식 평가는 계속 `DATASET_GATE`뿐이고 수치는 변경하지 않았다. 이 세트는 `split`이 `exploratory`여서 `validateDataset`이 `DATASET_INVALID`를 반환한다. 보고서는 `preliminary: true`, `formalEvaluation: NOT_MEASURED`를 담는다. 모델 학습과 300장 수집은 하지 않았다.

## 재현

사진 목록은 P12-C(PR #102)에서 병합된 `tools/vision-poc/dataset/exploratory-commons.json`이다. 실행 당시에는 #102가 미병합이어서 내용이 같은 저장소 밖 복사본(`343f33b`)을 썼다. YOLOv8과 색상 규칙의 원본 결과는 저장소 밖 P12-C 실행 폴더에 있다.

```powershell
python -m venv C:\CarScope-External\p12-denv
C:\CarScope-External\p12-denv\Scripts\pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
C:\CarScope-External\p12-denv\Scripts\pip install -r toolsision-poc\zero-shotequirements.txt
Set-Location toolsision-poc
node scripts/fetch-exploratory.mjs dataset/exploratory-commons.json C:\CarScope-External\p12-c\exploratory
$env:HF_HOME='C:\CarScope-External\p12-d\hf'
foreach ($model in 'owlv2','grounding-dino-tiny','omdet-turbo') {
  C:\CarScope-External\p12-denv\Scripts\python -B zero-shotun_zero_shot.py --model $model --manifest dataset\exploratory-commons.json --images C:\CarScope-External\p12-c\exploratory --out "C:\CarScope-External\p12-dun1\$model.json"
}
$E='C:\CarScope-External\p12-dun1'
node scripts/zero-shot-compare.mjs dataset\exploratory-commons.json $E\compare.json --zero-shot "$E\owlv2.json,$E\grounding-dino-tiny.json,$E\omdet-turbo.json" --roboflow C:\CarScope-External\p12-cun2esults.json --colour C:\CarScope-External\p12-cun1aseline-results.json
```
