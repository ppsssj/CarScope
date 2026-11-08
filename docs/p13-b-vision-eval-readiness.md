# P13-B 실제 Vision 평가 준비 (워셔액 주입구)

판정: **`READY_FOR_HUMAN_REVIEW`.** 평가 환경, 검수 도구, 실행·채점 도구, 사전 등록 기준이 준비됐다. **정답은 0 / 26장이고 실제 OpenAI 호출은 하지 않았다.** 정답이 생기고 소유자가 승인하기 전에는 측정할 수 없다.

- 기준 문서(먼저 커밋): [p13-b-washer-vision-eval-criteria.md](p13-b-washer-vision-eval-criteria.md), 커밋 `f4e89e7`
- 증거: [evidence/p13-b/README.md](evidence/p13-b/README.md)
- P13-A 계약, 운영 OFF 게이트, Render·Supabase·환경변수는 그대로다. Roboflow 추가 호출 0회.

## 1. 기존 자료 조사 결과

| 자료 | 상태 | 이번 사용 |
|---|---|---|
| P12-F 사진 26장 (Commons) | 해시 일치, 라이선스·출처·저작자 기록. CC0 4, PDM 2, CC-BY 9, CC-BY-SA 11 | 평가 후보 사진 |
| P12-F 라벨 | `labelsReviewedByPerson: false`(단일 자동 작업자) | **정답으로 쓰지 않음.** 검수 화면에도 안 보임 |
| P12-F/C 저장 응답 `answers.json` | 실제 `engine-bay-parts/1` 응답, 해시 `d4ea96be…` | 실제 탐지 영역의 출처(11장 11개) |
| P12-G 사람 검수 | **1 / 26장 완료**(`commons-029`, 워셔 `PRESENT`, 박스 1) | 사람 영역 선택지로만 제공. 이 검수는 워셔 상태 정답이 아님 |
| P12-H 보조 후보 | `humanReviewed: false` | **쓰지 않음** |
| P13-A 고정 탐지기 fixture | 실제 탐지 아님 | **영역으로 거부**(시험으로 확인) |
| IONIQ 5 사진 (P12-H) | CC BY-SA 3.0, 실제 탐지 응답 없음 | 이번 세트 제외. 다음 단계 |

## 2. 구성

```text
dataset/p13-b-washer-eval.json (Git)   사진 26장의 해시·권리·실제 탐지 수. 정답 없음
        │
washer-eval/washer-truth-server.mjs    127.0.0.1 검수 화면. 사람이 영역·정답·개인정보를 입력
        │  → C:/CarScope-External/p13-b/washer-truth.json (+ history.jsonl)
scripts/washer-prepare.mjs             Chrome에서 P13-A cropWithContext로 40%·80% 크롭 생성, 검수자가 본 크롭과 대조
        │  → C:/CarScope-External/p13-b/prepared/ (JPEG, 해시, 미리보기 시트)
scripts/washer-eval.mjs status|plan    정답 진행, 호출 대상, 승인 체크리스트 (호출 없음)
scripts/washer-eval.mjs run            --mock: 외부 호출 없음 / --real-openai: 승인·키·모델·원장 5회 필요
        │  → C:/CarScope-External/p13-b/runs/<runId>/records.jsonl
scripts/washer-eval.mjs report         여백별 지표와 사전 게이트 (호출 없음)
```

| 파일 | 내용 |
|---|---|
| `washer-eval/washer-eval-model.mjs` | 순수 규칙: 정답 형식, 기대 결과 표, 영역 출처 검사, 호출 대상·예산, 채점, 게이트 |
| `washer-eval/washer-eval-data.mjs` | P12-G 로더 재사용(사진 해시·응답 검사, 하나라도 빠지면 `BLOCKED`), 실제 탐지 영역, 완료된 P12-G 사람 박스, 저장소 밖 경로 강제 |
| `washer-eval/public/*` | 검수 화면. 처음에는 영역·답이 모두 비어 있음 |
| `src/openai-vision.mjs` | `onResponse` 선택 훅 추가: OpenAI가 보고한 토큰 수와 상태만 전달(본문 아님). 없으면 P13-A와 동일 |

## 3. 검수 절차 (사람이 할 일)

```powershell
Set-Location tools\vision-poc
npm ci --ignore-scripts; Push-Location ..\mobile-ar-poc; npm ci --ignore-scripts; Pop-Location
npm run washer:truth          # http://127.0.0.1:8211
```

1. 검수자 이름을 직접 입력한다(기본값 없음, 저장되지 않음).
2. 사진을 고르고 영역을 고른다: **AI 탐지 n 사용**(저장된 실제 탐지), **P12-G 사람 박스**, 사진 위를 끌어 **직접 그리기**, 또는 **영역 없음**.
3. 아래 두 미리 보기(여백 40%, 80%)는 실제로 보낼 사진이다. 번호판·사람이 없는지 본다.
4. 6개 질문에 답한다. 모르면 `UNKNOWN`. 정상 외관이 확실하지 않으면 `아니요`가 아니라 `UNKNOWN`.
5. 화면 아래의 기대 결과 문장으로 답을 확인하고 **검수 완료 저장**. 중간이면 **임시 저장**.

권장 순서(정답 아님): 실제 탐지가 있는 11장부터. P12-F에서 탐지가 다른 부품 위였다고 관찰된 `new-08`, `commons-039`를 포함하면 `WRONG_PART` 기대도 시험된다.

## 4. 재현 명령

```powershell
Set-Location tools\vision-poc
node scripts/washer-eval.mjs manifest       # 목록 재생성 (커밋된 파일과 같아야 함)
npm run washer:prepare -- --candidates      # 실제 탐지·P12-G 박스 12개의 크롭 미리보기 (보내지 않음)
npm run washer:prepare                      # 검수 완료 사진의 보낼 크롭
node scripts/washer-eval.mjs status         # 진행, 대상, 체크리스트
node scripts/washer-eval.mjs plan --budget 5
node scripts/washer-eval.mjs run --mock dry-1   # 외부 호출 없음, MOCK_NOT_A_MEASUREMENT
node scripts/washer-eval.mjs report dry-1
# 승인 후에만:
# $env:OPENAI_API_KEY_FILE='C:\CarScope-External\openai.key'; $env:OPENAI_VISION_MODEL='<승인 파일의 모델>'
# $env:CARSCOPE_VISION_LEDGER='C:\CarScope-External\p13-b\vision-calls.json'
# node scripts/washer-eval.mjs run --real-openai real-1; node scripts/washer-eval.mjs report real-1
```

## 5. 크롭 미리보기에서 확인한 것

실제 탐지 11개와 P12-G 사람 박스 1개의 크롭을 Chrome으로 만들어 직접 봤다(`prepared/candidates/preview/*.png`, Git 밖).

| 확인 | 결과 |
|---|---|
| 영역 | 11개 실제 탐지 중 다수는 파란·검은 워셔 캡 위. `new-08`은 라디에이터 캡으로 보이는 금속 캡, `commons-039`는 녹색 캡 통 위. 이것은 관찰이며 정답이 아니다 |
| P13-A 제품 크롭 | 12개 중 11개에서 40%와 80%가 **같은 픽셀**(최소 320px·짧은 변 35%가 결정) |
| 여백 분리 크롭(보내는 것) | 12개 모두 두 여백이 다름, 97×102 ~ 372×230px. 80%는 옆 리저버·호스까지 들어온다 |
| 좌표 일치 | 검수 화면 크롭과 prepare 크롭의 사각형이 같다(합성 시험, 실제 `commons-040` 읽기 전용 확인) |

작은 크롭(약 100px)은 Vision 모델에 정보가 적을 수 있다. 그 영향이 이 비교가 재려는 것이다.

## 6. 실제 호출 전 승인 체크리스트

`node scripts/washer-eval.mjs status`가 출력한다. 현재 상태:

| 항목 | 현재 | 소유자가 할 일 |
|---|---|---|
| `OWNER_APPROVAL_FILE` | BLOCKED | `C:/CarScope-External/p13-b/approval.json` 작성 |
| `CALL_CAP` | BLOCKED | `maxCalls` 1~5 (원장 상한 5회 유지) |
| `MODEL_CHOSEN` | BLOCKED | 호출 당일 공식 문서로 모델 확인, 승인 파일과 환경변수에 같은 값 |
| `PRICE_RECORDED` | BLOCKED | 100만 토큰당 입력·출력 가격과 출처 URL |
| `KEY_FILE_OUTSIDE_REPOSITORY` | BLOCKED | 저장소 밖 키 파일 |
| `LEDGER_SET` | BLOCKED | 저장소 밖 원장 경로 |
| `DATA_TERMS_ACCEPTED` | BLOCKED | 이 계정의 OpenAI 데이터 사용·보관 조건 확인 |
| `PHOTOS_PLANNED` | BLOCKED | 사진 2장 이상 검수 완료 + `npm run washer:prepare` |
| `NOT_RENDER` | PASS | |

승인 파일 예시(값은 소유자가 정한다):

```json
{ "approvedBy": "", "approvedAt": "", "scope": "p13-b-washer-eval", "maxCalls": 4, "model": "",
  "price": { "inputPerMillionUsd": null, "outputPerMillionUsd": null, "source": "" }, "dataTermsReviewed": false }
```

## 7. 한계

- 5회는 스모크 시험이다. 정확도는 `INSUFFICIENT_SAMPLE`로만 보고한다(기준 문서 8절).
- 26장은 P12-C/F에서 이미 쓴 사진이고 IONIQ 5는 없다. 선별 편향과 학습 데이터 중복 가능성이 있다.
- 캡 개방·누락·손상 사례가 이 사진들에 있는지 모른다. 없으면 `SUSPECTED_ISSUE` 기대는 시험되지 않는다.
- 검수 도구는 사람임을 증명하지 못한다. 기본값·자동 채우기를 막고, 합성 파일은 실제 도구에서 열리지 않는다.
- 크롭 사각형이 같아도 JPEG 바이트는 Chrome 버전에 따라 다를 수 있다. 실행은 prepare가 만든 파일의 해시로 고정한다.

## 8. 다음 단계

1. 사람이 최소 2장(권장 11장) 검수 완료 → `npm run washer:prepare`.
2. 소유자가 승인 파일 작성 → `status`에서 체크리스트 모두 PASS 확인.
3. `run --real-openai`(최대 5회) → `report`. 게이트 FAIL이면 중단·검토.
4. 정확도 판정을 원하면 검수 30장 이상, 새 판 기준 커밋, 별도 호출 승인.
5. IONIQ 5 사진: 소유자 촬영·동의, 사람 영역으로 별도 세트.
