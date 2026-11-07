# 워셔액 주입구 탐지 PoC (P12-B)

연구용 로컬 도구다. **학습된 모델이 없고 판정은 `DATASET_REQUIRED`다.** 모바일 페이지와 배포에 포함되지 않는다. 판단 근거는 [설계 문서](../../docs/p12-b-vision-poc.md)에 있다.

공개 모델 재사용과 예비 평가(`EXPLORATORY_EVALUATION`)는 [P12-C 문서](../../docs/p12-c-existing-model.md)에 있다. 수치는 정식 지표가 아니며 API 키와 이미지는 저장소 밖에 둔다.

## 실행

```powershell
npm ci --ignore-scripts --prefix tools/vision-poc
npm ci --ignore-scripts --prefix tools/mobile-ar-poc   # 기준선 파일과 브라우저 테스트의 Playwright
Set-Location tools/vision-poc
npm run check
npm test
npm run test:browser
npm run dataset:status   # 데이터가 없으면 종료 코드 2
npm run serve            # http://127.0.0.1:8199
```

모델이 없으면 화면은 `MODEL_REQUIRED`를 표시하고 색상 규칙만 실행한다.

## 학습된 모델 연결

모델 정보 파일을 저장소 밖에 만든다. `role`과 `labels`가 맞아야 후보를 표시하고, `sha256`이 다르면 서버가 시작되지 않는다.

```json
{ "modelId": "...", "role": "TARGET_CANDIDATE", "labels": ["washer-fluid-cap"], "sha256": "..." }
```

```powershell
$env:CARSCOPE_VISION_MODEL='C:\CarScope-External\p12-b\models\model.tflite'
$env:CARSCOPE_VISION_MODEL_MANIFEST='C:\CarScope-External\p12-b\models\model.json'
npm run serve
```

## 런타임 측정

COCO 모델로 런타임만 측정한다. 대상 모델의 성능이 아니다. 모델은 [MediaPipe 저장소](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite)에서 받아 저장소 밖에 둔다.

```powershell
$env:CARSCOPE_VISION_MODEL='C:\CarScope-External\p12-b\models\efficientdet_lite0_int8_v1.tflite'
$env:CARSCOPE_EVIDENCE_DIR='C:\CarScope-External\p12-b\YOUR-RUN-ID'
npm run measure:runtime
```

## 데이터셋과 평가

```powershell
python scripts/fingerprint_images.py <image>...   # sha256, dhash. Pillow 필요
node scripts/dataset-status.mjs <manifest.json> --root <dataset folder>
node scripts/evaluate.mjs <manifest.json> <dataset folder> <predictions.json>
```

`evaluate.mjs`는 게이트를 통과하지 못하면 수치 없이 `NOT_MEASURED`를 출력한다. 항목 형식은 `src/dataset.mjs`, 수량은 `DATASET_GATE`에 있다. 이미지와 모델은 Git에 넣지 않는다.

## P12-H AI 보조 검수

`npm run review`는 외부 `C:/CarScope-External/p12-h/assisted-labels.json`이 있으면 Codex 후보와 근거를 별도 레이어로 표시한다. `--assisted <파일>`로 바꿀 수 있다. 파일이 없거나 잘못되면 후보만 비활성화하며 사람 검수 기능은 유지한다. 후보 가져오기는 `UNREVIEWED` 편집 초안을 만들고 사람 검수를 완료하지 않는다. IONIQ 5는 별도 참고 세트이며 편집 내용은 현재 창에만 남는다.

`npm run assisted:report`는 저장 추론과의 `PROVISIONAL_AI_ASSISTED` 비교 목록을 출력한다. 추론을 호출하거나 사람 검수 파일을 쓰지 않는다. `npm run test:browser:assisted`는 합성 데이터로 가져오기 게이트를 확인한다. 공식 자료·차량 사양의 한계와 실제 26+1장 분석은 [P12-H 기록](../../docs/p12-h-assisted-identification.md)을 참조한다.
