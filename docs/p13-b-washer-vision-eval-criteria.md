# P13-B 워셔액 캡 Vision 평가 기준 (사전 등록)

**이 문서는 실제 호출 전에 커밋한다.** 호출 뒤 기준·지표·대상 사진을 바꾸지 않는다. 바꿔야 하면 새 판으로 커밋하고 이전 결과와 섞지 않는다.

- 대상: P13-A 분석 계약(`part-analysis.mjs`, `PROMPT_VERSION p13-a-1`)의 **워셔액 주입구만**. 계약·프롬프트·검증 규칙은 바꾸지 않는다.
- 평가셋 목록: [`tools/vision-poc/dataset/p13-b-washer-eval.json`](../tools/vision-poc/dataset/p13-b-washer-eval.json). 사진 해시, 권리, 실제 탐지 수만 있고 **정답은 없다.**
- 정답 상태: **`AWAITING_HUMAN_REVIEW`, 0 / 26장.** Claude는 정답을 입력하지 않는다.

## 1. 사진과 권리

P12-F의 Wikimedia Commons 사진 26장이다(사진 해시는 P12-F 라벨 파일과 같음). 원본은 `C:/CarScope-External/`에만 있고 Git에 넣지 않는다.

| 라이선스 | 장 수 |
|---|---:|
| CC0-1.0 / PDM-1.0 | 4 / 2 |
| CC-BY-2.0, 3.0, 4.0 | 2, 3, 4 |
| CC-BY-SA-2.0, 3.0, 4.0 | 2, 2, 7 |

- 라이선스는 재사용을 허락하지만 **외부 AI 서비스 전송의 적합성은 법무 확인이 아니다.** 잘라낸 사진은 2차적 저작물일 수 있고 BY·SA 조건이 따른다. 공개 배포하지 않고 평가 기록에 출처·저작자를 남긴다.
- 사람이 **보낼 잘라낸 사진 두 장**에서 번호판·사람·개인 정보가 안 보인다고 확인한 사진만 보낸다(`personalData = NONE_VISIBLE`).
- IONIQ 5 사진(P12-H, CC BY-SA 3.0)은 실제 탐지 응답이 없어 이번 세트에 넣지 않았다.

## 2. 쓰지 않는 것

| 자료 | 이유 |
|---|---|
| P12-F 라벨 (`labelsReviewedByPerson: false`) | 단일 자동 작업자 초안 |
| P12-H 보조 후보 (`humanReviewed: false`) | 사람 미승인 |
| 고정 탐지기 fixture (`FIXTURE_PREDICTIONS`) | 실제 탐지가 아님. 영역 출처로 받지 않는다 |

검수 화면은 위 초안을 보여 주지 않는다. 정답이 기울지 않게 하기 위해서다.

## 3. 영역

| 출처 | 내용 |
|---|---|
| `DETECTION` | 저장된 실제 `engine-bay-parts/1` 응답(P12-F run1, P12-C run2 재사용)에서 P13-A와 같은 규칙(`candidatesFor`, 점수 0.4, 최대 3개)으로 나온 후보. 26장 중 **11장, 11개**. 사람이 고르고, 저장된 값과 다르면 거부 |
| `HUMAN` | 사람이 그린 박스, 또는 완료된 P12-G 사람 검수 박스(현재 `commons-029` 1장) |
| `NONE` | 캡이 안 보임. 식별을 `UNKNOWN`으로만 완료 가능. 보내지 않는다 |

새 Roboflow 호출은 없다(원장 19/20).

## 4. 사람이 입력하는 정답

| 항목 | 값 |
|---|---|
| 이 영역이 워셔액 캡인가 (`identification`) | `WASHER_CAP` / `NOT_WASHER_CAP` / `UNKNOWN` |
| 캡 누락 (`capMissing`) · 개방 (`capOpen`) · 캡·주입구 손상 (`capDamage`) | `YES` / `NO` / `UNKNOWN` |
| 캡 상태를 판단할 수 있는 사진인가 (`judgeable`) | `JUDGEABLE` / `NOT_JUDGEABLE` / `UNKNOWN` |
| 두 잘라낸 사진의 개인 정보 (`personalData`) | `NONE_VISIBLE` / `VISIBLE` / `UNKNOWN` |

- 확실하지 않으면 `UNKNOWN`이다. 정상 외관인지 확실하지 않으면 `NO`가 아니라 `UNKNOWN`이다.
- 검수 완료 저장은 검수자 직접 입력, 모든 항목 응답, 두 미리 보기 확인이 있어야 한다. 사진 해시가 바뀌면 기록은 무효다.
- 정답 파일은 `C:/CarScope-External/p13-b/washer-truth.json`(저장소 밖), 저장마다 이력 파일에 덧붙인다.

## 5. 기대 결과 (정답 → 분석이 내야 할 결과)

| 정답 | 기대 `partMatch` | 기대 `assessment` |
|---|---|---|
| 영역 없음 | 보내지 않음 | |
| 식별 `UNKNOWN` | 채점 안 함 | 채점 안 함 |
| `NOT_WASHER_CAP` | `NOT_MATCH` | `WRONG_PART` |
| 캡, `NOT_JUDGEABLE` | `LIKELY_MATCH` | `INDETERMINATE` |
| 캡, 판단 가능, 누락·개방·손상 중 `YES`가 있음 | `LIKELY_MATCH` | `SUSPECTED_ISSUE` |
| 캡, 판단 가능, 세 항목 모두 `NO` | `LIKELY_MATCH` | `NO_VISIBLE_ISSUE_DETECTED` |
| 캡, 판단 여부 `UNKNOWN` 또는 `YES` 없이 `UNKNOWN` 포함 | `LIKELY_MATCH` | 채점 안 함 |

`UNCERTAIN`은 기대값과 다르게 세고 따로 센다. P13-A 계약상 `UNCERTAIN`이면 `INDETERMINATE`다.

## 6. 여백 40% · 80% 비교

**P13-A 워셔 프로파일 그대로는 비교가 되지 않는다.** 최소 크기(320px, 짧은 변 35%)가 크롭을 정해서, 후보 영역 12개 중 11개에서 40%와 80%가 **같은 픽셀**이다(`npm run washer:prepare -- --candidates`). 같은 입력을 두 번 보내면 여백이 아니라 모델의 흔들림만 잰다.

| 갈래 | 설정 | 쓰임 |
|---|---|---|
| 여백 분리 (보냄) | P13-A `cropWithContext`, 여백 0.4 / 0.8, 최소 64px(중계가 받는 최소), 짧은 변 비율 0, 긴 변 1024, JPEG 0.9 | 같은 사진·같은 영역의 두 크롭을 각각 1회 호출 |
| 제품 크롭 (보내지 않음) | P13-A 워셔 프로파일 | 두 여백이 같은 크롭이 되는 비율을 호출 없이 보고 |

후보 12개 기준 여백 분리 크롭은 97×102 ~ 372×230px이다. 두 크롭이 바이트까지 같으면 1회만 호출해 두 여백에 같이 쓰고, 비교 쌍에서 뺀다. 이 비교 결과로 P13-A 설정을 바꾸지 않는다. 바꾸려면 별도 과제다.

## 7. 지표

여백별로 따로 계산한다. 크롭이 같아 1회만 부른 경우 지연·토큰·비용은 한 번만 센다.

| 지표 | 정의 |
|---|---|
| 스키마 성공률 | P13-A `validateAnalysisResult` 통과 / 호출. 실패는 사유 코드별(거절, 미완료, JSON, 금지 문장, 모순 등) |
| 부품 일치율 | 기대 `partMatch`가 있는 유효 응답 중 일치 / 채점 수, Wilson 95% 구간, `UNCERTAIN` 수 |
| 상태 일치율 | 기대 `assessment`가 있는 유효 응답 중 일치 / 채점 수, Wilson 95% 구간 |
| 근거 없는 이상 의심 | 유효 응답의 의심 코드 중 사람이 그 항목에 `NO`라고 답했거나, 캡이 아니라고 했거나, 판단 불가라고 한 것의 수. `UNKNOWN` 항목은 세지 않는다 |
| 판단 불가 비율 | `INDETERMINATE` / 유효 응답 |
| 지연 | 요청 시작~응답 해석 완료, 중앙값·p95·최대(ms). 이 PC의 네트워크 기준이다 |
| 토큰·비용 | OpenAI가 보고한 `usage`의 입력·출력 토큰. 비용 = 토큰 × 승인 파일의 100만 토큰당 가격(출처 URL 필수). 가격이 없으면 계산하지 않는다(`PRICE_NOT_CONFIGURED`) |
| 여백 쌍 불일치 | 두 크롭이 다른 쌍에서 `partMatch/assessment` 조합이 다른 수 |

## 8. 사전 판정 기준

| 게이트 | 기준 | 결과가 미달이면 |
|---|---|---|
| `SCHEMA_ALL_VALID` | 스키마 성공률 100% | `FAIL`. 다음 호출 전 원인 검토 |
| `NO_UNSUPPORTED_SUSPICION` | 근거 없는 이상 의심 **0건** | `FAIL`. 1건이라도 있으면 중단하고 검토 |
| `ACCURACY` | 채점 30장 미만이면 수치를 보고만 한다 | `INSUFFICIENT_SAMPLE`. 합격·불합격을 말하지 않는다 |

- **5회 호출은 스모크 시험이다.** 실제 공급자가 계약을 지키는지, 지연·토큰·비용, 근거 없는 의심이 있는지를 본다. 정확도를 주장하지 않는다.
- 정확도 판정은 검수 완료 30장 이상과 별도 호출 승인, 이 문서의 새 판이 필요하다. 그때 부품 일치율 Wilson 하한, 상태 일치율 기준을 미리 정해 커밋한다.

## 9. 호출 대상 선정

- 조건: 검수 완료, 영역 있음, `personalData = NONE_VISIBLE`, 준비된 크롭이 검수자가 본 크롭과 같고(사각형 일치), 크롭 변 64px 이상.
- 순서: 평가셋 목록 순서. 두 크롭이 다른 쌍을 먼저, 같은 크롭은 뒤에 1회씩.
- 상한: 승인 파일의 `maxCalls`(1~5)와 기존 원장 상한 5회(`VISION_CALL_LIMIT`) 중 작은 값, 남은 원장 횟수를 넘지 않음. 쌍은 쪼개지 않는다. 5회면 보통 사진 2장 4회다.
- 탐지가 WRONG_PART일 수 있는 영역(P12-F 관찰: `new-08`, `commons-039`)과 캡 영역을 함께 검수해 두면 두 기대 결과를 모두 시험할 수 있다. 이것은 검수 순서 제안이며 정답이 아니다.

## 10. 호출 전 승인 체크리스트

`node scripts/washer-eval.mjs status`가 아래를 확인하고, `run --real-openai`는 하나라도 `BLOCKED`면 시작하지 않는다.

| 항목 | 조건 |
|---|---|
| `OWNER_APPROVAL_FILE` | `C:/CarScope-External/p13-b/approval.json`: `approvedBy`, `approvedAt`, `scope: "p13-b-washer-eval"` (소유자가 작성, Git 밖) |
| `CALL_CAP` | `maxCalls` 1~5 |
| `MODEL_CHOSEN` | `OPENAI_VISION_MODEL` = `approval.model`. 호출 당일 공식 문서로 확인 |
| `PRICE_RECORDED` | `approval.price.inputPerMillionUsd`, `outputPerMillionUsd`, `source` |
| `KEY_FILE_OUTSIDE_REPOSITORY` | `OPENAI_API_KEY_FILE`이 저장소 밖 |
| `LEDGER_SET` | `CARSCOPE_VISION_LEDGER`가 저장소 밖. 원장이 5회를 넘으면 거부 |
| `DATA_TERMS_ACCEPTED` | `approval.dataTermsReviewed: true`. 이 계정의 OpenAI 데이터 사용·보관 조건을 소유자가 확인 |
| `PHOTOS_PLANNED` | 9절 조건을 만족한 호출이 1건 이상 |
| `NOT_RENDER` | 로컬 실행 |

## 11. 결과 보고

- 실행 기록: `C:/CarScope-External/p13-b/runs/<runId>/`(`run.json`, `records.jsonl`, `report.json`). 응답 JSON과 토큰 수만 남기고 사진·키·요청 본문은 남기지 않는다.
- MOCK 실행은 `MOCK_NOT_A_MEASUREMENT`로 표시하고 수치를 성능으로 쓰지 않는다.
- 보고에는 정답 완료 장수, 호출 수, 여백별 지표, 게이트, 쌍 비교, 모델 ID, 실행일, 원장 사용 수를 함께 적는다.
