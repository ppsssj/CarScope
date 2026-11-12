# P11 부품별 점검 방법·AI 지원 범위 통합 (PR #121)

기준 `origin/main` `0c15598` (PR #120 병합 후). 19개 부품의 점검 방법을 코드와 기록된 증거로 전수 조사했다. 조사 결과를 하나의 계산으로 묶었고, 차량 3D 화면과 스마트폰 점검 화면이 같은 값을 보여 주게 했다.

**이 PR은 AI 기능을 새로 켜거나 새 부품에 AI를 추가하지 않는다.** 유료 Roboflow/OpenAI 호출, API 키 사용, Render 배포, DB 변경, enrollment 발급, AVD 실행, 실제 QR 세션 생성은 하지 않았다.

## 하나의 지원 상태 (`tools/mobile-ar-poc/public/part-capabilities.mjs`)

- `PART_AI_SUPPORT`가 부품별 AI 지원(탐지·분석)의 **유일한 출처**이다. `PART_DETECTION`(모델 class·근거)과 `ANALYSIS_PROFILES`(프롬프트·금지 항목·근거)는 상태를 직접 적지 않고 이 표에서 읽는다. 테스트가 이를 강제한다. `offersDetection()`, `offersAnalysis()`, `ANALYSIS_SUPPORT`의 값은 바뀌지 않았다.
- 이 모듈은 import가 없는 순수 데이터이므로 모든 호스트가 제공한다. AI 파일(`part-detection*.mjs`, `part-analysis*.mjs`, `context-crop.mjs`)은 기존처럼 AI를 켠 호스트만 제공한다. 서버 게이트는 바꾸지 않았다.
- `partCapabilities(partId, {taskId, host})`의 반환 값은 다음과 같다.
  - `partPlan`: 부품이 가진 방법. `DETECT_AND_ANALYZE`, `MARK_AND_ANALYZE`, `DETECT_ONLY`, `MANUAL_ONLY`, `INFO_ONLY`
  - `offered`: 이 화면에서 실제로 제공하는 방법
  - `ai`: AI 상태
    - `AVAILABLE`
    - `SERVER_DISABLED`: 부품은 지원하지만 이 서버가 제공하지 않음
    - `NOT_CONNECTED`: 차량 QR로 연결한 점검이 아님
    - `UNSUPPORTED`: 부품 자체가 미지원
    - `UNKNOWN`: 차량 화면. 휴대폰 쪽 서버 설정을 알 수 없음
- `host`는 휴대폰 페이지만 넘긴다. 자기 서버가 표시한 `data-part-detection`/`data-part-analysis`와 QR 연결 여부(detector 채널)이다. 이 조건식은 기존 `offerPartDetection`/`mountPartDetection`과 같다. **차량 화면은 `host`를 넘기지 않으므로 "사용 가능"을 표시할 수 없다.** 프론트엔드 상태만으로 AI 호출을 열 수도 없다. 서버 경로, 동의, 한도는 그대로이다.

## 19개 부품 지원 매트릭스

범례:
- **3D**: ◎ 모델과 목록에서 선택, △ 목록에서만 선택(형상 없음)
- **수동**: 스마트폰 직접 점검. 체크리스트 질문 수
- **카메라 표시**: 실시간 카메라 화면에 손으로 표시. 기기 안에서만 쓰고 어디에도 보내지 않음
- **사진 영역**: AI 분석용으로 사진에서 직접 지정
- **탐지** / **분석**: Roboflow `engine-bay-parts/1` / GPT Vision 프로필
- **배포**: 아래 「서버 활성화」 참고
- **실기 E2E**: 실제 휴대폰

| # | 부품 (`partId`) | 3D | task | 수동 | 카메라 표시 | 사진 영역 | 탐지 | 분석 | 실기 E2E |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 워셔액 (`washer-fluid-cap`) | ◎ | `washer-fluid` | 상태 선택 1 | ○ | ○ | 실험 | 실험 (실제 호출 4회 스모크, 정확도 미확립) | NOT_RUN |
| 2 | 냉각수 리저버 | ◎ | `coolant-reservoir` | 3 | ○ | ○ | 실험 | 실험 (MOCK만) | NOT_RUN |
| 3 | 브레이크액 (`brake-fluid-reservoir`) | ◎ | `brake-fluid` | 3 | ○ | ○ | 실험 | 실험 (MOCK만) | NOT_RUN |
| 4 | 모터룸 퓨즈박스 | ◎ | `fuse-box` | 3 | ○ | ○ | 실험 | 실험 (MOCK만) | NOT_RUN |
| 5 | 12V 보조 배터리 | ◎ | `battery-12v` | 3 | ○ | ○ (유일한 경로) | 미지원 | 실험 (MOCK만) | NOT_RUN |
| 6 | 저전도 냉각수 리저버 | △ | `lcw-coolant-reservoir` | 3 | ○ | ○ (유일한 경로) | 미지원 | 실험 (MOCK만) | NOT_RUN |
| 7–10 | 타이어 4개 | ◎ | `tire.*` | 3 | ○ | — | 없음 | 없음 | NOT_RUN |
| 11–12 | 전면 와이퍼 좌·우 | ◎(표식) | `wiper.front.*` | 3 | ○ | — | 없음 | 없음 | NOT_RUN |
| 13–16 | 하향등·상향등 좌·우 | ◎(표식, 가려질 수 있음) | `light-*` | 3 | ○ | — | 없음 | 없음 | NOT_RUN |
| 17 | EV 충전구 | ◎ | `ev-charge.port` | 3 | ○ | — | 없음 | 없음 | NOT_RUN |
| 18 | EV 충전구 덮개 | ◎ | 없음 (충전구 점검의 덮개 항목에 포함) | — | — | — | 없음 | 없음 | 해당 없음 |
| 19 | 고전압 배터리 팩 | ◎(하부) | 없음 | — | — | — | 없음 | 없음 | 해당 없음 |

계획(plan) 요약:
- **탐지 + 분석:** 4개. 워셔액, 냉각수, 브레이크액, 퓨즈박스
- **직접 지정 + 분석:** 2개. 12V 배터리, 저전도 냉각수
- **수동만:** 11개. 타이어 4개, 와이퍼 2개, 전조등 4개, 충전구
- **정보만:** 2개. 충전구 덮개, 고전압 배터리 팩

사진 영역 표시가 있는 2개는 탐지 모델에 해당 class가 없다(P12-F). 그래서 사진에서 부품 위치를 자동으로 찾는다고 안내하지 않는다.

### 서버 활성화 (G)

코드에 기능이 있는 것과 서버에서 켜져 있는 것은 별개이다.

| 서비스 | 진입점 | 탐지 | 분석 | 근거 |
|---|---|---|---|---|
| 기본 Render (`carscope-lluo`) | `render-stateful.mjs` | **꺼짐** | **꺼짐** | 진입점이 detector·analyzer를 넘기지 않는다(코드). 페이지에 AI 표시가 없고 AI 파일은 404이다 |
| Vision 실험 서비스 | `render-vision-experiment.mjs` | 탐지 승인 환경일 때만 | `CARSCOPE_VISION_APPROVAL=OPERATOR_APPROVED`, 키, 모델이 있을 때만 | **현재 상태 미확인.** 마지막 기록(2026-11-09)은 `/healthz` 시간 초과(BLOCKED)이다. 이번 작업에서 호출하지 않았다 |
| 로컬 dev 서버 | `mobile-dev-server.mjs` | fixture 또는 키 | MOCK 또는 승인된 공급자 | 테스트 전용 |

### 실패하거나 막히는 조건 (I)

**모든 수동 점검**
- 안전 확인 체크 전에는 시작할 수 없다.
- 충전구는 "충전 중이 아님" 확인도 필요하다.
- 보닛 부품·와이퍼·전조등은 관찰 중단 규칙이 있다.
- 저전도 냉각수 리저버는 차량에 없을 수 있다. 그때는 "확인하기 어려워요"로 답한다.
- 전조등 표식은 참조 모델에서 가려질 수 있다(3D 안내 문구가 있음).

**AI (6개 부품)**
- 차량 QR로 연결하지 않은 로컬 링크에서는 쓸 수 없다 → `NOT_CONNECTED`.
- 서버가 제공하지 않으면 쓸 수 없다 → `SERVER_DISABLED`.
- 전송 동의를 하지 않으면 보내지 않는다.
- 공급자 거절 코드: 일·월 한도 소진(`BUDGET_EXHAUSTED`), 같은 QR에서 처리 중(`IN_PROGRESS`), 요청 과다(`RATE_LIMITED`), 사진 과대·판독 불가, 공급자 연결 실패.
- AI 답변이 `WRONG_PART`/`INDETERMINATE`이면 재촬영 안내만 하고 결과로 쓰지 않는다.
- AI 결과는 체크리스트에 자동 입력되지 않는다(기존 계약).

## 화면에서 바뀐 것

### 스마트폰 (17개 task 모두)

시작 화면에 **「점검 방법」 카드**를 둔다. 위치는 기존 AI 진입 버튼 자리(시작 버튼 아래, 부품 찾는 법 안내 위)이다. 첫 화면에 안전 확인과 시작 버튼이 모두 보여야 한다는 기존 규칙(WebXR 방법 선택 포함, `part-guide-browser`)을 지키기 위해서이다. 안전 조건 위에 두는 안을 먼저 시도했지만, 390×844 화면에서 시작 버튼이 첫 화면 밖으로 밀려 기존 테스트가 실패했다.

| 상태 | 카드 |
|---|---|
| 탐지 + 분석 사용 가능 | 버튼 `AI로 외관 살펴보기 · 실험`, "AI가 사진에서 부품 후보를 찾고, 고른 부분의 겉모습만 살펴봐요", "참고용이에요. 결과는 직접 확인해 주세요. 점검 답변을 대신 정하지 않아요", 그 아래 `직접 점검하기` |
| 직접 지정 + 분석 사용 가능 | 버튼 `사진에서 부품 직접 지정하기`, "자동으로 위치를 찾지 않아요. 사진에서 부품을 직접 지정하면 그 부분의 겉모습만 AI가 살펴봐요", `직접 점검하기` |
| 탐지만 켜진 서버 | 버튼 `AI로 부품 위치 찾기 · 실험`(분석 없음을 명시) |
| 서버 비활성 | 버튼 없음. "이 부품은 AI 외관 분석(실험)을 지원하지만, 지금 연결된 서비스에서는 사용할 수 없어요." |
| QR 미연결 | 버튼 없음. "AI 외관 분석(실험)은 차량 화면의 QR로 연결한 점검에서만 쓸 수 있어요." |
| 미지원 (11개) | 버튼 없음. `직접 점검하기`, "살펴볼 것: (기존 체크리스트 항목)", "현재 AI 외관 분석은 지원하지 않습니다." |

- 일반 화면에는 enum, 환경변수, 공급자 내부 이름이 나오지 않는다(테스트로 검사).
- 대화상자 제목도 같은 이름을 쓴다. 기존 "AI로 부품 상태 보기"는 직접 지정 흐름을 위치 찾기처럼 읽히게 했다.
- **전조등:** 카드에 "○○ 영역만 기록해요. 설명서로 왼쪽·오른쪽과 상향등·하향등 영역을 먼저 구별해 주세요."를 넣었다. 한계 문구를 "켜지는지, 밝기나 광축은 사진이나 이 점검으로 판정하지 않아요"로 바꿨다.
- **타이어·충전구:** 기존 한계 문구가 이미 공기압·마모 깊이·고전압·충전 가능 판정을 하지 않는다고 말하므로 유지했다. 결과 계약과 체크리스트 질문은 바꾸지 않았다.
- **보닛·와이퍼:** 시작 화면 한계 문구의 "부품을 자동으로 찾지 않아요"를 지웠다. AI 위치 찾기가 있는 부품에서 모순이었다. 이제 자동 위치 찾기 여부는 카드가 말한다.
- **이름 일치:** 휴대폰과 Native 수신 화면의 전조등 이름에서 "외관"을 빼 3D·History와 같게 했다(`왼쪽 하향등` 등). P10-1에서 보고된 유일한 이름 차이였고, 표시용 이름일 뿐 저장 계약에는 없다. 테스트의 예외 목록을 지웠다.

### 차량 3D 화면

- **부품 목록:** AI 방법이 있는 6개 행에만 중립 태그 `AI 실험`을 붙인다.
- **부품 결과 패널:** 「스마트폰으로 점검」에 한 줄을 넣는다.
  - 수동만: "스마트폰에서 직접 점검할 수 있어요. 현재 AI 외관 분석은 지원하지 않습니다."
  - AI 부품: "…AI 위치 찾기와 외관 분석(실험)도 지원하지만, 사용할 수 있는지는 연결된 서비스에 따라 스마트폰 화면에 표시돼요."
- **정보 부품(덮개, 배터리 팩):** "따로 점검 기록이 없는 부품입니다."
- 데이터는 휴대폰과 같은 `part-capabilities.mjs`에서 온다. 브라우저 서버는 저장소 경로 그대로, Android 패키지는 `mobile-ar-poc/public/part-capabilities.mjs`로 원본을 복사해 제공한다(패키징 테스트로 동일성 확인).

## 후속 AI 확장 검토 (구현하지 않음)

| 부품 | 재사용 가능 | 필요한 것 | 판단하면 안 되는 것(`never`) |
|---|---|---|---|
| 타이어 4개 | 사진 입력, `MANUAL` 영역 지정, Vision 어댑터, 결과 검증, 동의·한도 | 측면·접지면 외관 프로필. 바퀴별 사진 수집 | 공기압, 트레드 깊이, 주행 가능 |
| 와이퍼 2개 | 위와 같음 | 블레이드 고무·암 외관 프로필 | 닦임 성능, 작동 |
| 전조등 4개 | 위와 같음 | 렌즈 균열·가림·내부 물기 프로필. 좌우·상하 영역 확인 | 점등, 밝기, 광축 |
| EV 충전구 | 위와 같음 | 덮개·외부 오염·손상 프로필 | 충전 가능, 고전압 상태, 단자 내부 |

- **탐지:** `engine-bay-parts/1`에 이 부품들의 class가 없다. 처음에는 사용자가 사진에서 직접 지정하는 `MARK_AND_ANALYZE`로만 시작하는 것이 맞다.
- **순서:**
  1. `ANALYSIS_PROFILES`에 프로필을 추가하되 `PART_AI_SUPPORT`에는 `DRAFT` 상태를 새로 둔다(`partPlan`이 DRAFT를 제공하지 않도록).
  2. MOCK과 스키마 테스트를 한다.
  3. 실제 사진으로 평가한다.
  4. 승인 후 `EXPERIMENTAL`로 바꾼다.
- **데이터:** 부품마다 사람이 검토한 라벨이 있는 실제 사진을 손상 있음·없음·다른 부품 포함으로 준비한다. 수량은 평가 기준과 함께 정한다.
- **평가 기준:**
  - 스키마 통과율 100%
  - 금지 주장(`claims`·`FORBIDDEN_TEXT`) 0건
  - 다른 부품을 `LIKELY_MATCH`로 답한 비율
  - 손상이 알려진 사진을 `NO_VISIBLE_ISSUE_DETECTED`로 답한 비율(가장 중요)
  - `INDETERMINATE` 비율과 재촬영 안내의 적절성

  P13-B 워셔액 평가 기준(`p13-b-washer-vision-eval-criteria.md`)의 형식을 따른다.

## 검증

| 항목 | 결과 | 명령·환경 |
|---|---|---|
| 19개 매트릭스, 단일 출처, 17 task, 3D↔휴대폰 이름, host 상태표, 사용자 문구 | PASS 6 | `node --test tools/mobile-ar-poc/test/part-capabilities.test.mjs` |
| 모바일 단위 전체 | PASS 178 | `npm test --prefix tools/mobile-ar-poc` |
| 차량 화면 지원 표시 (19개, 태그 6개, 패널 문구) | PASS 4 | `tools/three-poc/test/part-capabilities-view.test.mjs` |
| three-poc 단위 전체 | PASS 336, TODO 1(기존 P2-9) | `npm test --prefix tools/three-poc` |
| Android 자산 패키징 | PASS 4 | `npm run test:android-assets --prefix tools/three-poc` |
| Vision 어댑터 단위 | PASS 164 | `npm test --prefix tools/vision-poc` |
| sync 서버 단위 | PASS 267 / SKIP 41 / **FAIL 1 (환경)** | `npm test --prefix tools/inspection-sync-poc`. `avd-setup-script` 1건은 fake adb 경로가 한글 사용자명 임시 경로에서 깨지는 로컬 문제이다. 변경 전 코드에서도 같은 실패를 확인했다 |
| 휴대폰 점검 방법 카드 (실제 페이지, QR v2, 17 task × AI 켬/끔, 탐지만, QR 없음, 와이퍼 수동 완료까지) | PASS 5그룹 | `POC_EVIDENCE_DIR=C:/CarScope-External/... node tools/mobile-ar-poc/test/inspection-methods-browser.mjs`. fixture detector, MOCK vision, Chrome |

| 휴대폰 브라우저 전체 (`test:browser`, 12개 묶음: 기존 11 + 새 방법 카드) | PASS | Chrome, `POC_EVIDENCE_DIR=C:/CarScope-External/qr-ar-01/...`. 처음에는 `part-guide-browser`의 첫 화면 규칙이 카드를 안전 조건 위에 둔 배치를 잡아내 FAIL이었다. 배치를 고친 뒤 PASS |
| 차량 브라우저 (실제 GLB): consistency·panels·part-labels·results·history·toast·part-UX 기준선 | PASS 7 | Chrome, 로컬 `serve.mjs` + 외부 GLB. consistency·results·history는 DOM 전용(CI 모드)에서도 PASS. 세 테스트의 자체 fixture 서버가 공유 파일 하나를 제공하도록 고쳤다(첫 실행은 404로 FAIL) |
| Android 단위 | PASS 281/281 | 자산 패키징 후 `gradlew.bat :app:testDebugUnitTest` |
| core | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` |
| AVD 3D 화면, 실제 휴대폰, Render | **NOT_RUN** | 이번 범위에서 실행하지 않음(아래) |

합성 브라우저 결과를 실제 휴대폰·Render·AVD 결과로 표시하지 않는다. 화면 캡처는 저장소 밖 `C:\CarScope-External\p11\pr121\`에 있다(합성 세션, QR·인증 정보 없음).

## 미해결·다음 단계 E2E에서 확인할 것

- 실제 휴대폰으로 확인할 것:
  - 17개 task 각각의 카드 표시
  - 기본 Render(AI 꺼짐)에서 6개 AI 부품의 "서비스에서 사용할 수 없어요" 표시
  - 수동 점검 제출 → 차량 반영
- Vision 실험 서비스가 정상 응답할 때 확인할 것:
  - AI 부품의 버튼 표시와 동의 흐름
  - 결과가 체크리스트에 자동 입력되지 않음

  유료 호출이 포함되므로 별도 승인 후 진행한다.
- AVD 3D 화면에서 확인할 것:
  - `AI 실험` 태그와 패널 문구
  - 패키지 경로 `mobile-ar-poc/public/part-capabilities.mjs`의 로딩(실제 WebView)
- 아래 6개 부품의 AI 정확도는 확립되지 않았다:
  - 탐지 4개: 라벨 검토 없는 P12-F
  - 분석 5개: MOCK만
  - 워셔액 분석: 정확도 근거 부족(INSUFFICIENT_SAMPLE)
