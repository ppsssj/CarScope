# P12-C 증거 인덱스

[설계와 판정](../../p12-c-existing-model.md). 원본은 `C:/CarScope-External/p12-c/`에 있으며 Git에 넣지 않는다.

환경: 기준 main `58d86ab`(PR #101 병합), Windows 10, Node 22.16.0, headless Chrome 157.0.8103.38, Python 3.11.9.

| 범위 | 판정 |
|---|---|
| `engine-bay-parts/1` 실제 추론 | **BLOCKED_API_KEY_REQUIRED**, 0회 호출 |
| 모델의 Precision, Recall, mAP, 탐지·오탐·미탐 사례 | **NOT_MEASURED** |
| 정식 평가 (`DATASET_GATE`) | **DATASET_REQUIRED**, 수치 변경 없음 |
| 모델 가중치 확보, MediaPipe 호환성 | **NOT_RUN** |
| Universe 페이지의 클래스, MIT 표시, 아키텍처 | **BLOCKED** (자동 접근 403, API는 키 필요) |
| Z Flip8, AVD, 실차 | **NOT_RUN** (`adb devices`에 기기 없음) |
| 실제 Roboflow 서버와 어댑터의 왕복 | **NOT_RUN**. 로컬 가짜 엔드포인트로만 확인 |
| Render, Supabase, QR, WebXR, 모바일 UI | 변경 없음 |

## 실행

| 검사 | 명령 (`tools/vision-poc`) | 결과 |
|---|---|---|
| 문법 | `npm run check` | PASS |
| 전체 Node 테스트 | `npm test` | PASS 76, FAIL 0 |
| 사진 화면 (**스크립트 탐지기**) | `npm run test:browser` | PASS 11, FAIL 0 |
| 키 없는 모델 실행 | `node scripts/roboflow-infer.mjs …` | `BLOCKED_API_KEY_REQUIRED`, 호출 0, 종료 코드 3 |
| 결과 없는 평가 | `node scripts/exploratory-evaluate.mjs …` | `EXPLORATORY_NOT_RUN`, `NOT_MEASURED` |
| 정식 게이트 | `npm run dataset:status` | `DATASET_REQUIRED` |
| 사진 재다운로드 | `node scripts/fetch-exploratory.mjs …` | 12장, 해시 일치 |
| 색상 규칙 (실제 사진 12장) | `node scripts/color-baseline-run.mjs …` | 아래 |

원본: `run1/baseline-results.json`, `run1/baseline-report.json`, `run1/browser/`.

### 공식 엔드포인트 응답 (키 없음)

| URL | 응답 |
|---|---|
| `https://api.roboflow.com/stephens-workspace-gjyrj/engine-bay-parts` | 401 `This method requires your API key.` |
| `https://api.roboflow.com/stephens-workspace-gjyrj/engine-bay-parts/1` | 401 |
| `https://serverless.roboflow.com/engine-bay-parts/1` | 401 `Unauthorized api_key` |
| `https://detect.roboflow.com/engine-bay-parts/1` | 401 `Unauthorized api_key` |

이 401은 키가 없어서 나온 응답이며, 키가 있을 때 호출이 허용되는지는 보여 주지 않는다. 키를 찾기 위해 저장소나 디스크를 뒤지지 않았다. 환경변수 `ROBOFLOW_API_KEY`의 존재 여부만 확인했다(없음).

## 예비 결과: 색상 규칙

**`EXPLORATORY_EVALUATION`. AI 모델의 결과가 아니며 공식 지표가 아니다.** 사진 12장(양성 11, 음성 1), 임계값 없음.

| 지표 | 값 | 95% 구간 |
|---|---|---|
| TP / FP / FN | 5 / 7 / 6 | |
| Precision | 0.417 | 0.193~0.680 |
| Recall | 0.455 | 0.213~0.720 |
| mAP@0.5 | `NOT_APPLICABLE` | |

| 사진 | 차량 | 결과 |
|---|---|---|
| `commons-029` | Nissan President | 미탐 |
| `commons-032` | Skoda Rapid | 탐지, 냉각수 캡 오탐 1 |
| `commons-040` | Kia K5 GT | 미탐 |
| `commons-041` | Kia Sportage Hybrid | 탐지 |
| `commons-045` | Toyota Corolla Hybrid | 탐지 |
| `commons-086` | Dacia Spring | 미탐, 다른 곳 오탐 3 |
| `commons-094` | Toyota Yaris Hybrid | 탐지 |
| `commons-123` | Toyota Prius V (검은 캡) | 미탐 |
| `commons-159` | Mercedes-Benz C200 | 미탐 |
| `commons-170` | Ora Funky Cat | 탐지 |
| `commons-171` | Peugeot e-208 | 미탐, 다른 곳 오탐 3 |
| `commons-066` | Skoda Fabia (브레이크액, 캡 없음) | 보고 없음 |

**라벨의 한계:** 상자와 기호 판단은 자동화된 단일 작업자가 했으며 사람의 검수가 없다. 사진은 쉬운 쪽으로 치우쳐 있고 일반 성능을 나타내지 않는다.

## 변이 (선택한 조건만 대상, 완전성 증명이 아님)

규칙을 하나씩 임시로 깨고 원본으로 복원했다. 스크립트는 저장소에 남기지 않았다. 14건 모두 테스트가 실패했다(정상).

모든 클래스 매핑, 대상과 같은 이름의 원본 클래스 인정, 중심 좌표를 좌상단으로 해석, 잘못된 응답을 빈 결과로 처리, 게이트 수치 낮춤, 예비 사진의 정식 분할 통과, 정식 게이트의 BY-SA 허용, 예비 표시 제거, 실패한 호출을 빈 결과로 처리, URL로 키 전송, 거부 뒤 호출 계속, 동의 없는 소유자 사진 전송, 저장소 안의 키 파일 허용, 상태 스크립트의 첫 인자 누락.

## P12-B에서 발견해 고친 결함

`dataset-status.mjs`는 `--root` 없이 매니페스트 경로를 받으면 그 인자를 버리고 저장소의 빈 목록을 읽었다. 저장소 기본 목록으로 실행한 P12-B의 기록(`DATASET_REQUIRED`)은 영향이 없지만, 다른 매니페스트를 검사한 결과라면 틀릴 수 있었다. 고치고 회귀 테스트를 추가했다. 같은 패턴을 쓴 새 스크립트의 테스트 실패로 발견했다.

## 외부 자료 확인 범위

| 자료 | 확인 |
|---|---|
| [가중치 다운로드](https://docs.roboflow.com/deploy/download-roboflow-model-weights), [자체 호스팅](https://docs.roboflow.com/deployment/self-hosted/self-hosted.md), [요금](https://roboflow.com/pricing), [라이선스](https://roboflow.com/licensing), [약관](https://roboflow.com/terms) | 내용 확인 (2026-11-07). 타인의 Universe 모델 가중치, 호스팅 이미지 보관, Universe 라이선스 표시의 범위는 문서에 없음 |
| [Roboflow Inference 원본](https://github.com/roboflow/inference) | 예측 좌표 정의, SDK의 인증 헤더와 요청 파라미터 확인 |
| `universe.roboflow.com` | **읽지 못함.** 프로젝트 존재만 검색 결과로 확인 |
| Wikimedia Commons | 파일별 라이선스는 Commons API 메타데이터 기준. 업로더의 권리 자체를 독립 검증하지는 않음 |
