# P13-A 하이브리드 AI 부품 상태 분석 (로컬 PoC)

P12-E/F의 부품 위치 후보(Roboflow `engine-bay-parts/1`) 위에 **사용자가 고른 영역을 주변까지 잘라 Vision 모델로 외관을 살피는 단계**를 붙였다. 실행 근거는 [증거 인덱스](evidence/p13-a/README.md)에 있다.

## 판정: `IMPLEMENTED_LOCAL_POC`

- 자동 Crop, 공급자 인터페이스, OpenAI 어댑터, MOCK 공급자, 결과 계약, 서버 중계, 모바일 화면을 구현했고 MOCK과 가짜 탐지기로 끝에서 끝까지 검증했다.
- **실제 OpenAI 호출은 하지 않았다: `REAL_PROVIDER_NOT_RUN`.** 유료 호출은 소유자 승인 대상이다. 그래서 **실제 사진 분석 정확도는 알 수 없다.** MOCK은 사진을 보지 않는다.
- **Roboflow 추가 호출 0회.** 원장은 19/20 그대로다(파일 SHA-256 불변).
- 기본은 꺼져 있다. Render 진입점은 이 기능을 모르고 새 정적 게이트 `PART_ANALYSIS_OFF`가 이를 지킨다. Render, Supabase, 환경변수는 바꾸지 않았다.
- 실제 분석 프로파일은 **워셔액 주입구 하나**(`EXPERIMENTAL`)다. 냉각수·브레이크액·퓨즈박스는 `DRAFT`로 계약과 지침만 있고 화면에 나오지 않는다. 12V와 저전도 냉각수는 `UNSUPPORTED`다. `VERIFIED`는 없다.

## 현재 구조와 AI 경계

```text
[차량 앱 3D에서 부품 선택] → QR v2 (기존 그대로)
        ↓
휴대폰 점검 페이지 (mobile-ar-poc/public, 기존 상태 머신·결과 계약 그대로)
  └ 'AI로 부품 위치 찾기 · 실험' 대화상자 (P12-E part-detection-ui.mjs)
      ├ 동의 ① Roboflow  → POST /v1/part-detections/:partId (P12-E 그대로)
      │                    축소 JPEG(긴 변 1280) 1장
      └ [P13-A] 부품 상태 AI 분석 (part-analysis-ui.mjs, 대화상자 안의 한 칸)
          후보 선택 또는 직접 지정 → context-crop.mjs로 원본에서 잘라 미리 보기
          동의 ② Vision 서비스 → POST /v1/part-analyses/:partId
                                  잘라낸 JPEG 1장 + 부품 위치(잘라낸 사진 기준 비율) + 영역 출처
서버 (inspection-sync-poc)
  part-analysis-route.mjs: 동의·QR 토큰·부품·세션 상태·중복·호출 수·크기 확인 → 공급자 → 결과 계약 검사
  공급자(VehicleVisionProvider): openai-vision.mjs | mock-vision-provider.mjs (tools/vision-poc, Render 코드 그래프 밖)
```

| 경계 | 내용 |
|---|---|
| 키 | 서버 프로세스 안 공급자 클로저에만 있다. 저장소 밖 파일에서 읽고, 브라우저·응답·로그·오류에 나오지 않는다. 브라우저는 자기 출처(`connect-src 'self'`)만 부른다 |
| 켜는 방법 | `startMobileDevServer`/`startSyncServer`의 `partAnalysis` 인자뿐이다. 탐지(`partDetection`) 없이 켜면 시작을 거부한다. 페이지 표시 `data-part-analysis`와 모듈 3개는 켜진 호스트만 보낸다 |
| 점검 결과 | AI 결과는 점검 답변·`inspection-result` 계약·전송에 들어가지 않는다. 화면을 닫아도 기존 점검이 그대로 이어진다 |
| 진입점 | `tools/vision-poc/scripts/part-analysis-local.mjs`(127.0.0.1, 로컬 시험 세션). 기본은 고정 탐지기 + MOCK이라 외부 호출이 없다 |

## Roboflow 탐지 연결

P12-E/F의 `candidatesFor`, 클래스 매핑, 상태(실험 4 / 미지원 2), 임계값 0.4를 바꾸지 않았다. 선택 부품의 클래스만 후보가 된다. 점수는 화면에 보이지 않고 정답 확률로 다루지 않는다.

탐지 실패와 후보 없음은 P12-E 문구("부품이 없다는 뜻은 아니에요")를 그대로 두고, 그 아래에서 **재촬영**, **직접 영역 지정**, **그림 안내 복귀**(대화상자 닫기)를 고를 수 있다. 직접 지정한 영역은 화면과 요청(`X-CarScope-Region-Source: MANUAL`)에 "AI 위치 찾기 결과가 아님"으로 표시된다.

## Automatic Context-aware Crop (`tools/mobile-ar-poc/public/context-crop.mjs`)

AI를 부르지 않는다. 기하 계산(`contextCropPlan`)은 순수 함수이고, `cropWithContext(image, box, options)`가 브라우저에서 디코딩·자르기·인코딩을 한다.

| 요구 | 구현 |
|---|---|
| 좌표 검증 | 숫자 4개, 넓이 > 0, 사진 안. 아니면 `CROP_BOX_INVALID`(잘라 맞추지 않는다). 1e-6 이하 부동소수 오차만 다듬는다 |
| 픽셀 변환·여백 | 상자 너비·높이의 `margin`만큼 사방으로 넓힌다. 기본 0.4(검증된 값 아님), 워셔액 프로파일 0.8 |
| 최소 크기 | 한 변이 `max(320px, 짧은 변 × 0.3)` 이상(워셔액 0.35). 작은 캡도 주변이 남는다 |
| 경계 | 자르는 크기를 줄이지 않고 **사진 안으로 민다**. 사진이 더 작을 때만 사진 크기로 제한(`limitedByImage`) |
| 정수 픽셀 | 바깥쪽으로 반올림해 부품이 잘리지 않는다 |
| EXIF 방향 | `createImageBitmap(..., { imageOrientation: 'from-image' })`. 탐지 단계와 같은 방향으로 읽으므로 같은 상자가 같은 곳을 가리킨다(방향 6 브라우저 시험) |
| 해상도·비율 | **원본 사진**(탐지용 축소본이 아님)에서 자른다. 보내는 크기는 긴 변 1024 이하로 같은 비율로만 줄이고 키우지 않는다 |
| 분석용 JPEG | 품질 0.9로 다시 인코딩해 원본의 EXIF·위치 정보가 빠진다. 미리 보기의 테두리는 보내는 사진에 그려지지 않는다 |
| 좌표 관계 | `rect`(원본 픽셀), `sourceRect`(원본 비율), `targetInCrop`(잘라낸 사진 속 부품), `cropPointToSource`로 되돌림 |
| 자원 해제 | 디코딩한 비트맵은 바로 `close()`. 원본 파일 참조와 캔버스는 다른 영역·재촬영·닫기 때 비운다. 저장소(`localStorage` 등)에 쓰지 않는다 |

원본 사진과 잘라낸 사진은 메모리에만 있고, 외부로는 **잘라낸 사진만** 간다. 원본 전체를 보내는 경로는 만들지 않았다.

## Vision 공급자

```ts
interface VehicleVisionProvider {
  id: 'openai' | 'mock';      // 동의 문구에 쓰는 서비스 이름 목록(ANALYSIS_SERVICES)에 있어야 함
  model: string;
  analyzePart(input: PartAnalysisInput, { signal }): Promise<unknown>; // 반환값은 신뢰하지 않고 서버가 검사
}
PartAnalysisInput = { partId, image /* JPEG */, imageSize, targetInCrop, regionSource, instructions, userText, schema, promptVersion }
```

지침·사용자 문장·JSON 스키마는 공급자가 아니라 계약 모듈(`part-analysis.mjs`)이 만든다. 공급자는 그대로 보낸다. 그래서 Claude 등 다른 공급자를 같은 입력으로 A/B 비교할 수 있다(이번에는 만들지 않음).

**OpenAI 어댑터** (`tools/vision-poc/src/openai-vision.mjs`): Responses API, 사용자 메시지 하나에 `input_text`와 `input_image`(data URL, `detail: high`), `text.format`의 `json_schema` `strict: true`, `store: false`, `max_output_tokens`. 2026-11-08 공식 문서(images-vision, structured-outputs, responses)로 형태를 확인했다. 문서상 strict 모드의 `maxLength` 지원은 확인되지 않아 길이는 서버가 검사한다. `temperature`는 추론 모델 지원이 확인되지 않아 보내지 않는다.

- **모델 ID 기본값 없음.** `OPENAI_VISION_MODEL`로 반드시 지정한다. 오래된 ID가 하드코딩되지 않는다. 문서의 현재 권장 목록(2026-11-08)은 `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna`, `gpt-6.1-terra`이고 모두 이미지 입력을 지원한다고 적혀 있다. **어느 것으로도 실행하지 않았다.**
- 실패는 고정 코드(`OPENAI_HTTP_401`, `OPENAI_REFUSED`, `OPENAI_INCOMPLETE`, `OPENAI_JSON_INVALID`, `OPENAI_RESPONSE_TOO_LARGE`, `OPENAI_ABORTED` 등)만 남기고 상류 메시지·키는 담지 않는다.
- 응답 본문은 읽는 도중 256KB에서 끊는다. 40초 시간 제한, 휴대폰 취소는 `signal`로 전달된다.
- 실제 모드는 `--real-openai`, 저장소 밖 키 파일, 모델 ID, 저장소 밖 호출 원장(상한 5회)이 모두 있어야 시작하고 `RENDER` 환경에서는 거부한다.

## 결과 계약 (`tools/mobile-ar-poc/public/part-analysis.mjs`)

```json
{
  "partId": "washer-fluid-cap",
  "partMatch": "UNCERTAIN",
  "assessment": "INDETERMINATE",
  "observations": ["둥근 캡 모양이 보이지만 표시는 보이지 않습니다."],
  "suspectedIssues": [],
  "limitations": ["빛 반사 때문에 캡의 표시를 읽을 수 없습니다."],
  "retakeRequired": true,
  "retakeInstructions": ["캡 윗면의 표시가 보이도록 조금 더 가까이에서 찍어 주세요."],
  "requiresUserConfirmation": true
}
```

`assessment`: `NO_VISIBLE_ISSUE_DETECTED`, `SUSPECTED_ISSUE`, `INDETERMINATE`, `WRONG_PART`, `UNSUPPORTED`(서버 전용, 모델은 고를 수 없음). `partMatch`: `LIKELY_MATCH`, `UNCERTAIN`, `NOT_MATCH`. `suspectedIssues`는 `{ code, description, evidence }`이고 `code`는 프로파일 허용 목록에서만 고른다. 자기 보고 신뢰도 필드는 없다.

서버와 페이지가 같은 `validateAnalysisResult`로 검사하고 하나라도 어긋나면 **전체를 거부**한다(고쳐 쓰지 않음). 서버는 502 `PART_ANALYSIS_INVALID_RESPONSE`, 화면은 "AI 응답을 확인할 수 없어 결과를 표시하지 않았어요".

- 키 9개 정확히, 다른 키 금지. 목록 5개, 문장 200자, 제어 문자 금지, 빈 문장 금지.
- 관찰 1개 이상. `NOT_MATCH` ⇔ `WRONG_PART`. **`UNCERTAIN`이면 반드시 `INDETERMINATE`**(식별이 불확실하면 상태 판정 금지).
- `SUSPECTED_ISSUE` ⇔ 근거 있는 의심 1개 이상. `INDETERMINATE`는 이유 1개 이상. 재촬영 필요 ⇔ 방법 1개 이상. `requiresUserConfirmation`은 항상 `true`.
- 금지 문장: 정상·안전 단정("정상입니다", "안전합니다", "운행해도", "safe to drive" 등)과 부품 조작 권유("열어 확인", "보충해", "만져", "분리해", "분해해"). P12-E 화면 문구 규칙을 모델 문장에도 적용했다.

화면은 `NO_VISIBLE_ISSUE_DETECTED`를 "사진에서 보이는 이상 징후를 찾지 못했어요"와 "부품이나 차량이 정상이라는 뜻은 아니에요. 사진에 보이지 않는 부분은 살피지 않았어요"로 보여 준다.

## 부품별 분석 프로파일

| 부품 | 상태 | 살피는 것 | 판단 금지 | 의심 코드 |
|---|---|---|---|---|
| 워셔액 주입구 | `EXPERIMENTAL` | 캡 식별(앞유리·분사 표시, 냉각수·라디에이터·브레이크·오일 캡과 구별), 닫힘, 누락·개방 의심, 캡·주입구 손상 | 워셔액 양(통이 보통 안 보임), 펌프·노즐 작동 | `CAP_MISSING_SUSPECTED`, `CAP_OPEN_SUSPECTED`, `CAP_OR_NECK_DAMAGE_SUSPECTED` |
| 일반 냉각수 | `DRAFT` | 리저버 식별(저전도와 표기로 구별 못 하면 `UNCERTAIN`), 액면·MIN/MAX 가시성, 둘 다 보일 때만 MIN 아래 의심, 누출 흔적 | 냉각수 품질·농도·온도, 냉각 계통 | `LEVEL_BELOW_MIN_SUSPECTED`, `LEAK_TRACE_SUSPECTED`, `RESERVOIR_DAMAGE_SUSPECTED` |
| 브레이크액 | `DRAFT` | 리저버 식별(클러치·파워스티어링과 구별), 액면·MIN/MAX, 누출 흔적 | **제동 성능·안전**, 액 품질·수분 | 위와 같음 |
| 퓨즈박스 | `DRAFT` | 하우징 식별, 덮개 존재·닫힘, 외관 손상 | **내부 퓨즈·릴레이**, 전기 계통 | `COVER_MISSING_SUSPECTED`, `COVER_DAMAGE_SUSPECTED` |
| 12V 배터리 | `UNSUPPORTED` | 탐지 미지원(P12-F). 수동 영역 VLM PoC도 만들지 않았다 | | |
| 저전도 냉각수 | `UNSUPPORTED` | 모델 클래스 없음(P12-F) | | |

`DRAFT`는 지침과 스키마가 시험으로만 확인되었고, 서버가 404 `PART_ANALYSIS_UNSUPPORTED`로 거부하며 화면에 나오지 않는다. 실제 사진 시험 없이 지원으로 올리지 않는다.

## 모바일 흐름

```text
부품 선택(QR) → 'AI로 부품 위치 찾기' → 동의 ① → 사진 → 후보 표시 (P12-E 그대로)
  → [부품 상태 AI 분석 · 실험 · 워셔액 주입구]
     후보 1/2 분석하기 · 직접 영역 지정  ← 위치 선택
     → 분석에 보낼 사진(잘라낸 미리 보기, 원본·보내는 크기) → 동의 ② (서비스 이름, 보내는 범위, 보관)
     → 상태 분석 시작 → AI가 사진을 살펴보고 있어요… [분석 취소]
     → 결과: 제목·안내 / 선택한 부품인지 / AI가 본 것 / 의심 부분과 근거 / 판단하지 못한 이유 / 다시 찍는 방법
     → [AI 결과는 참고용이고, 부품은 직접 확인할게요] 체크 → 기존 점검 계속하기
       또는 다시 촬영하기 · 다른 영역으로 다시 분석
  → 기존 체크리스트 (사람이 답하고 보냄)
```

- 위치 선택과 상태 분석은 다른 단계이고 동의도 따로다. 위치 찾기 동의는 Vision 서비스를 덮지 않는다(서버도 별도 헤더 `external-vision-v1`을 요구).
- 분석 중에는 잘라낸 사진이 그대로 보이고 조작은 꺼진다. 상태와 취소 버튼이 시작 버튼 자리에 오며, 시작 직후 0.6초는 취소를 무시해 두 번 누름이 취소가 되지 않는다.
- 취소·다시 시도는 동의를 다시 받는다. 다른 후보·새 사진·닫기는 진행 중 요청을 끊고, 늦게 온 응답은 시도 번호로 버린다.
- AI 결과 확인만으로 점검 답이 정해지거나 전송되지 않는다(브라우저 시험에서 답·기록·전송 결과 불변 확인).

## 개인정보와 외부 전송

| 항목 | 내용 |
|---|---|
| 서비스별 안내 | 동의 ①은 Roboflow, 동의 ②는 페이지가 호스트에서 받은 서비스 이름(`OpenAI` 또는 `로컬 시험용 MOCK`). 이름은 고정 목록에서만 온다 |
| 보내는 범위 | ① 축소한 사진 전체, ② **잘라낸 사진 한 장**("처음 고른 사진 전체는 보내지 않아요") |
| 보관 | CarScope 서버는 사진·결과를 쓰지 않고 로그에 남기지 않는다. 결과는 휴대폰 메모리에만 있고 점검 결과에 들어가지 않는다 |
| 외부 보관 조건 | 화면: "처리·보관 조건은 CarScope가 확인하지 못했어요". OpenAI 문서상 `store:false`여도 남용 감시 로그는 최대 30일, 이미지 입력은 수동 검토로 남을 수 있다고 적혀 있다. **계약·DPA 검토 전 확인된 사실로 표시하지 않는다** |
| 제한 | 업로드 2MB, JPEG만, 변 64~2048px, 서버 45초·클라이언트 50초·공급자 40초, 응답 256KB, 동시 2건, 휴대폰당 진행 중 1건(409), 분당 6회(경로), 세션 10분 6회 |
| 인증 | P12-E와 같은 QR 제출 토큰, 해당 점검 부품만, `CLAIMED` 상태만. 인증 우회 없음 |

## 테스트

| 범위 | 결과 |
|---|---|
| Crop 기하 (`context-crop.test.mjs`) | 정상·경계·모서리·작은·큰 객체, 잘못된 좌표·사진·옵션, 0·음수 영역, 비율 유지, 확대 없음, 좌표 되돌림. 9 PASS |
| 결과 계약·프로파일·상태 머신 (`part-analysis.test.mjs`) | 9 PASS |
| 서버 중계 (`inspection-sync-poc/test/part-analysis.test.mjs`) | 동의·인증·부품·영역·형식·크기, 잘못된 응답 502, 오류·시간 초과 503(상류 문장 없음), 중복 409, 세션 상한 429, 연결 끊김 시 공급자 취소, 휴대폰 클라이언트, 페이지 표시·파일·게이트. 8 PASS |
| OpenAI 어댑터 (`vision-poc/test/openai-vision.test.mjs`) | 가짜 fetch로 요청 형태, 키 위치, 거절·미완료·잘못된 JSON·HTTP 오류·크기 초과·시간 초과·취소, 로컬 진입점 거부 조건과 원장 상한. 6 PASS |
| 브라우저 E2E (`part-analysis-browser.mjs`) | Chrome, 실제 QR v2 동기화, 고정 탐지기, MOCK. 7 PASS. 상세는 증거 인덱스 |

MOCK 결과는 계약과 화면을 움직이는 데만 쓴다. **실제 분석 정확도의 근거가 아니다.**

## 미검증 (NOT_RUN)

- 실제 OpenAI 호출, 모델별 응답 품질·거절률·스키마 준수율·지연·비용
- 실제 엔진룸 사진에서 워셔액 캡 식별·누락·개방·손상 판단의 정확도. 평가 세트와 사전 합격 기준이 없다
- Crop 여백 0.4/0.8과 최소 크기 0.3/0.35가 판단에 충분한지
- 냉각수·브레이크액·퓨즈박스 프로파일의 실제 동작
- Z Flip8 등 실기기 촬영, 메모리, 시간. Render, AVD
- OpenAI의 이미지 처리·보관 조건에 대한 법무·개인정보 검토

## 다음 단계 권장

1. **승인 후 소량 실제 호출**: 소유자 동의 사진(또는 P12-F 공개 사진) 10~20장, 원장 상한 5회 단위. 모델 ID는 그때 문서로 다시 고른다.
2. **사전 기준 고정 후 평가**: 워셔액 캡의 `WRONG_PART`/`INDETERMINATE` 비율, 근거 없는 의심(허위 이상) 0건을 먼저 정해 커밋한 뒤 실행한다. P12-G 검수 도구로 사람이 정답을 붙인다.
3. **Crop 비교**: 여백·최소 크기 조합별로 같은 사진의 판단을 비교한다.
4. **Claude Vision 공급자 추가와 A/B**: 같은 입력·계약으로 비교한다.
5. **개인정보·계약 검토** 뒤에만 운영 진입점을 별도 과제로 만든다.

## 재현

```powershell
Set-Location tools\mobile-ar-poc
npm ci; npm run check; npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p13-a\YOUR-RUN'
npm run test:browser:analysis

Set-Location ..\inspection-sync-poc
npm install; npm run check; node --test test/part-analysis.test.mjs test/part-detection.test.mjs test/deployment-preflight.test.mjs

Set-Location ..\vision-poc
npm ci; npm run check; npm test
npm run analysis:local   # 127.0.0.1:4184, 고정 탐지기 + MOCK. 외부 호출 없음
# 실제 OpenAI (승인 후에만):
# $env:OPENAI_API_KEY_FILE='C:\CarScope-External\openai.key'; $env:OPENAI_VISION_MODEL='<문서로 확인한 ID>'
# $env:CARSCOPE_VISION_LEDGER='C:\CarScope-External\p13-a\vision-calls.json'; node scripts/part-analysis-local.mjs --real-openai
```
