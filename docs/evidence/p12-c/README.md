# P12-C 증거 인덱스

[설계와 판정](../../p12-c-existing-model.md). 원본은 `C:/CarScope-External/p12-c/`에 있으며 Git에 넣지 않는다. API 키는 저장소, 로그, 결과 파일 어디에도 없다. `run2` 결과와 저장소 파일에서 키 문자열을 검색해 없음을 확인했다.

환경: Windows 10, Node 22.16.0, headless Chrome 157.0.8103.38, Python 3.11.9.

| 범위 | 판정 |
|---|---|
| `engine-bay-parts/1` 호스팅 추론 | **실행.** 12/12 응답, 실패 0, 재시도 없음 |
| Precision, Recall, mAP@0.5 | **예비 측정** (`EXPLORATORY_EVALUATION`), 공식 지표 아님 |
| 정식 평가 (`DATASET_GATE`) | **DATASET_REQUIRED**, 수치 변경 없음 |
| 가중치 다운로드, 자체 호스팅, MediaPipe 호환성 | **NOT_RUN** |
| 라벨의 사람 검수, IONIQ 5 사진 | **없음** |
| Z Flip8, AVD, 실차 | **NOT_RUN** (`adb devices`에 기기 없음) |
| 새 모델 학습, Render, Supabase, QR, WebXR, 모바일 UI | 변경 없음 |

## run2: 실제 추론

| 항목 | 값 |
|---|---|
| 사진 해시 | 12/12 일치 |
| 호출 | 12회, HTTP 오류 없음 |
| 응답 필드 | `x, y, width, height, confidence, class, class_id, detection_id`. 이미지 크기 포함 |
| 클래스 | 응답 173건: 이름 18종 87건, 숫자 16종 86건 |
| confidence | 0.05 요청에 최소 0.052 반환. 비율 단위로 동작 확인 |
| 모델 정보 (`resolved_model`) | `onnx`, `fp32` |
| 왕복 시간 (이 PC) | 중앙값 364ms, 최소 285ms, 최대(첫 호출) 6,736ms |

사진은 공개 Commons 12장만 전송했다. Roboflow의 데이터 활용 옵트아웃은 설정하지 않았다.

| 신뢰도 기준 | TP / FP / FN | Precision | Recall | 95% (P) | 95% (R) |
|---|---|---|---|---|---|
| 0.05, 0.25, 0.3 | 7 / 1 / 4 | 0.875 | 0.636 | 0.53~0.98 | 0.35~0.85 |
| 0.4 | 6 / 0 / 5 | 1.000 | 0.545 | 0.61~1.00 | 0.28~0.79 |
| 0.5 | 5 / 0 / 6 | 1.000 | 0.455 | 0.57~1.00 | 0.21~0.72 |
| 0.6 | 2 / 0 / 9 | 1.000 | 0.182 | 0.34~1.00 | 0.05~0.48 |
| 0.7 | 1 / 0 / 10 | 1.000 | 0.091 | 0.21~1.00 | 0.02~0.38 |

**mAP@0.5 = 0.636** (신뢰도 0.05 이상 전체 예측). 기준별 AP는 평가 전에 걸러 낸 값이라 mAP로 쓰지 않는다.

### 사진별

| 사진 | 차량 | `Windshield Wiper Fluid` (신뢰도, IoU, 면적비) | `"3"` | 결과 (0.05) |
|---|---|---|---|---|
| `commons-029` | Nissan President | 0.335, 0.00, 캡 아닌 곳 | 0.71 | 미탐, 오탐 1 |
| `commons-032` | Skoda Rapid | 0.772, 0.77, 1.31 | | 탐지 |
| `commons-040` | Kia K5 GT | 0.603, 0.61, 1.63 | 0.15 | 탐지 |
| `commons-041` | Kia Sportage Hybrid | 0.508, 0.71, 1.40 | 0.49 | 탐지 |
| `commons-045` | Toyota Corolla Hybrid | 0.524, 0.63, 1.58 | 0.58 | 탐지 |
| `commons-086` | Dacia Spring | 없음 | 없음 | 미탐 |
| `commons-094` | Toyota Yaris Hybrid | 없음 | 0.67 | 미탐 |
| `commons-123` | Toyota Prius V (검은 캡) | 없음 | 없음 | 미탐 |
| `commons-159` | Mercedes-Benz C200 | 0.398, 0.81, 1.17 | 0.59 | 탐지 |
| `commons-170` | Ora Funky Cat | 0.521, 0.54, 1.85 | 0.42 | 탐지 |
| `commons-171` | Peugeot e-208 | 0.436, 0.52, 1.93 | 0.07 | 탐지 |
| `commons-066` | Skoda Fabia (브레이크액, 대상 없음) | 없음 | | 오탐 없음 |

`"3"` 칸은 캡과 겹친 상자의 최고 신뢰도다. 혼동 부품 라벨 4개(냉각수 3, 브레이크액 1)와 겹친 `Windshield Wiper Fluid` 상자는 0개다.

`run2/overlay-caps.jpg`, `run2/overlay-far.jpg`에서 상자 위치를 눈으로 확인했다. 캡과 목 윗부분을 감싸며 리저버 전체가 아니다.

### 민감도 분석: `"3"`을 같은 부품으로 볼 때

**보고 결과가 아니다.** 라벨 수 일치(807=807)와 응답을 본 뒤 세운 가설이다. 어댑터의 매핑은 바꾸지 않았다. 겹치는 상자는 IoU 0.5에서 합쳤다.

| 기준 | TP / FP / FN | Precision | Recall | AP |
|---|---|---|---|---|
| 0.05 | 9 / 2 / 2 | 0.818 | 0.818 | 0.818 |
| 0.3 | 9 / 1 / 2 | 0.900 | 0.818 | 0.818 |
| 0.5 | 8 / 0 / 3 | 1.000 | 0.727 | 0.727 |

### 모델 메타데이터 (`run2/model-info.json`)

Roboflow API를 읽기 전용으로 조회했다. 수치는 소유자 쪽 학습 결과이며 이번 측정이 아니다.

| 항목 | 값 |
|---|---|
| 프로젝트 | `Stephens Workspace`, 공개, 라이선스 표시 `MIT`, 2,378장 |
| 버전 1 | 2,313장 (학습 1,622, 검증 461, 테스트 230), 640×640 늘림, 증강 없음 |
| 모델 | `yolov8n`, `Roboflow 3.0 Object Detection (Fast)`, COCO 체크포인트에서 시작 |
| 전체 (검증) | mAP@0.5 42.09%, Precision 42.93%, Recall 73.60% |
| `Windshield Wiper Fluid` (테스트) | 대상 84, P 0.468, R 0.821, mAP@0.5 0.438 |
| `3` (테스트) | 대상 68, P 0.384, R 0.868, mAP@0.5 0.392 |
| 라벨 수 | 이름 26종, 숫자 26종. `3`=807=`Windshield Wiper Fluid` |

응답에 포함된 학습 데이터 내보내기 링크는 사용하지 않았고 저장본에서 삭제했다.

## run1: 색상 규칙

같은 사진 12장. 모바일 페이지와 같은 경로(브라우저 디코딩, 320×240 이하, 수정 없는 `detector.mjs`)다.

| TP / FP / FN | Precision (95%) | Recall (95%) | mAP@0.5 |
|---|---|---|---|
| 5 / 7 / 6 | 0.417 (0.19~0.68) | 0.455 (0.21~0.72) | `NOT_APPLICABLE` |

TP는 Skoda, Kia Sportage, Corolla, Yaris, Ora다. FP는 Skoda 냉각수 캡 1건, Dacia·Peugeot의 다른 영역 6건이다. 사진 원본 해시와 재다운로드 일치를 확인했고, P12-A 병합 후 재실행 결과도 같았다.

## 테스트

| 검사 | 명령 (`tools/vision-poc`) | 결과 |
|---|---|---|
| 문법 | `npm run check` | PASS |
| 전체 Node 테스트 | `npm test` | PASS 81, FAIL 0 |
| 사진 화면 (**스크립트 탐지기**) | `npm run test:browser` | PASS 11, FAIL 0 |
| 정식 게이트 | `npm run dataset:status` | `DATASET_REQUIRED` |

CI는 키와 네트워크 없이 테스트만 실행한다. **CI 성공은 실제 Roboflow 추론의 증거가 아니다.** 추론 근거는 위 `run2`다. 어댑터 테스트에는 실제 응답의 형태를 넣었다.

### 변이 (선택한 조건만 대상, 완전성 증명이 아님)

이전 실행에서 규칙을 하나씩 임시로 깨고 복원했다. 14건 모두 테스트가 실패했다(정상). 대상은 매핑, 좌표 해석, 잘못된 응답, 게이트, 예비 표시, 키 전송, 거부 뒤 호출, 동의 없는 전송 등이다. 이번 실행의 민감도 분석 코드에는 변이를 돌리지 않았다.

## 진행 중 수정 기록

- **평가 출력 오류:** 처음 PowerShell 집계에서 `$r`이 경로 변수 `$R`을 덮어써 `t=0.05` 값이 이전 값으로 표시됐다. 임계값 0.5로 걸러 낸 AP도 mAP가 아니었다. 결과 파일이 아닌 집계의 문제였고, Node로 다시 계산한 값만 기록했다.
- **P12-B 결함:** `dataset-status.mjs`가 `--root` 없이 받은 매니페스트를 무시하던 문제를 고치고 회귀 테스트를 추가했다.

## 외부 자료 확인 범위

| 자료 | 확인 |
|---|---|
| Roboflow API | 프로젝트와 버전 메타데이터, 호스팅 추론 |
| [가중치 다운로드](https://docs.roboflow.com/deploy/download-roboflow-model-weights), [자체 호스팅](https://docs.roboflow.com/deployment/self-hosted/self-hosted.md), [요금](https://roboflow.com/pricing), [라이선스](https://roboflow.com/licensing), [약관](https://roboflow.com/terms) | 내용 확인 (2026-11-07). 타인의 Universe 모델 가중치, 호스팅 이미지 보관, Universe 라이선스 표시의 범위는 문서에 없음 |
| [Roboflow Inference 원본](https://github.com/roboflow/inference) | 예측 좌표 정의, 인증 방식. 이번 실행으로 실제 응답과 일치 확인 |
| `universe.roboflow.com` | 읽지 못함 (자동 접근 403) |
| Wikimedia Commons | 파일별 라이선스는 Commons API 메타데이터 기준. 업로더의 권리 자체를 독립 검증하지는 않음 |
