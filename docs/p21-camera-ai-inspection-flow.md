# P21 카메라 AI 점검 흐름: 부품 탐지 → 사용자 확인 → 자동 외관 분석

Branch `feat/p21-camera-ai-inspection-flow`, based on `origin/main` `797c466`. P21 connects the existing pieces into one mobile flow: the React camera (`CameraSession`), the hosted part detector (`detectPart`), the context crop (`cropWithContext`), the vision analysis (`analyzePart` + `validateAnalysisResult`), and the existing checklist and QR v2 sync. It adds no API, server route, schema or provider, and it does not change the inspection reducers (`flowFor`).

> 핵심: 사용자가 카메라로 부품을 탐지하고 올바른 부품임을 **직접 확인**하면, 사전에 동의한 범위에서 그 부분만 잘라 **추가 조작 없이** AI 분석에 보낸다. 결과를 확인한 뒤 기존 직접 점검으로 돌아간다. AI는 체크리스트를 채우거나 확정하지 않는다.

## 1. 흐름: 이전과 이후

| 단계 | P20까지 | P21 |
|---|---|---|
| 입력 | 갤러리 사진 파일 선택 | **카메라 프레임 1장 캡처**. 사진 파일은 대안으로 접힌 영역에 남김 |
| 동의 | 탐지·분석 동의를 각 단계 직전에 따로 | 캡처 전에 두 항목(Roboflow 탐지, OpenAI 외관 분석)을 **각각** 동의. 둘 다 있어야 캡처 가능 |
| 탐지 | `AI 위치 후보 찾기` 버튼 | `AI로 부품 찾기` 한 번 = 프레임 1장 업로드 1회 |
| 확인 | `후보 N 선택` → 바로 crop | 후보를 사진 위에 강조 → **`이 부품이 맞아요`** (명시적). `다른 후보 선택`, `다시 찾기`, `직접 위치 지정하기` |
| 수동 지정 | 탭 지점 중심의 고정 크기 상자(`boxAroundPoint`) | **드래그로 위치·크기 지정** (Pointer Events, 터치·마우스·펜) → `이 영역이 맞아요` / `다시 선택`. 키보드 대체 수단 있음 |
| 분석 | crop 뒤 동의 체크 + `사진 상태 분석` 버튼 | 확인 즉시 **자동** crop → 분석 → 응답 검증 → 결과. 추가 버튼 없음 |
| 결과 | 결과 카드 | 결과 먼저(출처·참고 정보·의심 부분과 근거·관찰·한계·재촬영), 보낸 crop 아래. `직접 점검 계속하기` / `다시 촬영하기` |

갤러리 사진 경로(`PhotoAnalysis`)도 수동 지정을 같은 드래그 선택기로 바꿨다. 이 경로는 crop 뒤 분석 동의와 버튼을 그대로 요구한다(자동 분석은 카메라 흐름만).

## 2. 구조와 호출 관계

```
Locate (2단계 위치 찾기)
 ├─ useCamera()            단일 CameraSession. captureFrame(maxSide): 라이브일 때만 1장
 ├─ aiOffer(taskId)        part-capabilities(유일한 기능 정의) + QR v2 연결 + 서버 body 마커 → plan DETECT | MARK | null
 ├─ useCameraAi()          camera-ai-flow.mjs 리듀서를 ref로 동기 구동 (중복 탭·늦은 응답 차단)
 │    capture()  → captureFrame(2048) → 축소본(≤1280) JPEG → transport.detectPart(DETECTION_CONSENT) → acceptCandidates
 │    confirm()  → cropWithContext(원본 still, box, profile.crop) → transport.analyzePart(ANALYSIS_CONSENT, targetInCrop, regionSource)
 │                 → validateAnalysisResult → RESULT
 ├─ CameraAiStage / cameraAiActions   화면과 하단 Dock(주요 CTA 1개)
 └─ RegionSelector         정지 사진 + 후보 + 드래그 영역 (PhotoAnalysis와 공용)
```

| 파일 | 역할 |
|---|---|
| `public/camera-ai-flow.mjs` (신규) | 순수 상태 머신(IDLE, CAMERA_READY, CAPTURING, DETECTING, CANDIDATE_FOUND, NONE_FOUND, MANUAL_REGION, CONFIRMING_PART, CROPPING, ANALYZING, RESULT, ERROR, CANCELLED)과 좌표·드래그·크기 검증. Node 테스트 대상 |
| `src/ai/useCameraAi.ts` (신규) | 요청 실행, attempt/AbortController로 취소·무효화 |
| `src/ai/CameraAiPanel.tsx` (신규) | 상태별 제목·안내·동의·결과·Dock 동작 |
| `src/ai/RegionSelector.tsx` (신규) | Pointer Events 드래그, 키보드 대체, 후보 표시 |
| `src/ai/offer.ts`, `src/ai/AiResult.tsx` (신규) | 제공 범위 판정, 결과 표시(두 경로 공용) |
| `src/Camera.tsx` | `captureFrame()` 추가, 정지 사진 표시 중에도 `<video>`를 마운트한 채 숨김 |
| `src/screens/Locate.tsx` | AI 제공 시 카메라 AI 흐름, 갤러리 사진은 접힌 대안 |
| `src/PhotoAnalysis.tsx` | 탭 고정 상자 → 드래그 선택기 + `이 영역이 맞아요` |

이 상태는 사진 보조의 임시 UI 상태다. 결과 레코드, 체크리스트 응답, 전송 상태와 연결되지 않는다.

## 3. 캡처·좌표·Crop

- **캡처:** `captureFrame()`은 카메라가 지금 라이브이고 `<video>`에 스트림이 있을 때만 그린다. 정지 직후의 늦은 캡처는 `CAMERA_OFF`로 거부된다. `videoWidth/Height`가 없거나 축소 후 64px 미만이면 거부한다. 브라우저가 회전을 적용한 프레임을 canvas로 다시 그리므로 EXIF가 없고 방향이 일관된다.
- **두 이미지, 한 좌표계:** crop 원본은 최대 2048px, 탐지 업로드는 같은 프레임을 1280px 이하로 축소한 JPEG(0.85, 4MiB 이하)다. 박스는 탐지 계약대로 프레임 비율 `[left, top, width, height]`이므로 두 이미지에서 같은 위치다. 축소 크기는 서버의 0.02 비율 검사를 넘지 않는다(단위 테스트).
- **화면 → 원본:** 정지 사진 요소는 사진과 같은 종횡비(레터박스 없음)다. 포인터 좌표는 매번 현재 레이아웃에서 `elementToImagePoint()`(object-fit: contain 계산 포함)로 변환하므로 확대·축소·회전·리사이즈와 무관하게 같은 원본 픽셀을 가리킨다. 사진 밖은 가장자리로 제한된다.
- **Crop:** 확인된 박스를 `cropWithContext()`에 그대로 넘긴다(부품 프로필의 여백). 원본 전체는 보내지 않는다. 결과 JPEG는 2MiB 이하일 때만 보낸다.
- **검증 방법:** 브라우저 테스트가 합성 장면(빨간 캡, 파란 통)을 카메라로 쓰고, 서버의 MOCK 공급자가 받은 crop JPEG에서 `targetInCrop` 중심 픽셀 색을 확인한다. 후보 확인, 역방향 드래그, 터치 드래그 모두 해당 부품 색이었다.

## 4. 드래그 영역 지정

| 규칙 | 값 |
|---|---|
| 입력 | Pointer Events, `setPointerCapture`, `touch-action: none`(드래그가 스크롤되지 않음) |
| 표시 | 드래그 중 점선 사각형, 놓으면 실선 + 바깥 어둡게 |
| 방향 | 어느 방향이든 같은 상자 |
| 경계 | 사진 밖으로 끌면 가장자리로 제한. 거의 전체 화면(배터리·퓨즈박스)도 가능 |
| 최소 크기 | 각 변이 사진의 3% 이상이고 원본 24px 이상. 작으면 `영역이 너무 작아요…` 안내, 확인 버튼 비활성 |
| 키보드 | 사진 선택 → Enter로 가운데 40% 영역, 화살표 이동, Shift+화살표 크기, Esc 지우기. 같은 확인 버튼 |
| 확인 | `이 영역이 맞아요`. 그 전에는 아무것도 보내지 않음 |

## 5. 동의와 요청 시점

| 요청 | 언제 | 조건 |
|---|---|---|
| 카메라 권한 | `카메라 켜기`를 눌렀을 때만 | — |
| 탐지 업로드 1회 | `AI로 부품 찾기` | QR v2 연결, 서버 탐지 승인, 탐지 클래스가 있는 부품, **두 동의 모두**. 탐지 동의는 이 업로드에 소모 |
| 분석 업로드 1회 | `이 부품이 맞아요` / `이 영역이 맞아요` | 분석 동의가 유효. 분석 동의는 이 업로드에 소모 |
| 재분석 | 오류·취소 뒤 `다시 분석` | 새 동의 체크 필요, 명시적 버튼 |
| 새 촬영 | `다시 찾기`, `다시 촬영하기` | 두 동의를 다시 받음 |

동의는 메모리 상태로만 두고 저장하지 않는다. 라이브 영상은 업로드하지 않고 프레임마다 호출하지도 않는다(라이브 1.5초 동안 탐지 요청 0건 확인). 중복 탭, 빠른 이동, 늦은 응답은 attempt 번호와 리듀서로 막는다. 확인 이중 클릭에도 분석은 1회만 보낸다. 컴포넌트 해제, `pagehide`, 화면 숨김, 나가기 대화상자는 진행 중 요청을 abort하고 결과 적용을 막는다.

## 6. 부품별 제공 범위

`part-capabilities.mjs`의 `partCapabilities(..., { host })`가 유일한 기준이다.

| 부품 | 카메라 흐름 | 조건 |
|---|---|---|
| 워셔액, 일반 냉각수, 브레이크액, 퓨즈박스 | 자동 탐지 → 확인 → 자동 분석. 후보가 없거나 틀리면 드래그 | QR v2, 서버 탐지 + 분석 승인 |
| 12V 보조 배터리, 저전도 냉각수 | 캡처 → 드래그 → 확인 → 자동 분석. 탐지 동의·호출 없음 | QR v2, 서버 분석 승인 |
| 타이어 4, 와이퍼 2, 전조등 4, 충전구 (DRAFT) | 제공 안 함 | 운영자가 `CARSCOPE_VISION_DRAFT_PROFILES=OPERATOR_APPROVED`로 따로 승인할 때만 기존 규칙대로 영역 지정 분석 |
| QR 없이 직접 접속, QR v1, AI 없는 서비스(메인) | 기존 화면 그대로 | — |

탐지 응답에는 공급자 식별자가 없다(서버 계약). 그래서 후보는 "AI 탐지 후보 · 확정되지 않음"으로만 표시하고 Roboflow나 MOCK이라고 단정하지 않는다. 분석 결과의 출처는 응답의 `analysis.provider`로 표시한다(`로컬 시험용 MOCK` / `OpenAI`). 기존 갤러리 경로의 탐지 출처 문구("Roboflow 실험")는 바꾸지 않았다.

## 7. 오류와 복구

| 상황 | 표시 | 복구 |
|---|---|---|
| 카메라 거부·미지원 | 기존 문구, AI 버튼 없음 | 카메라 없이 계속 |
| 동의 미체크 | 시작 버튼 비활성 + 이유 | — |
| 후보 0건 | "부품 후보를 찾지 못했어요" | 같은 사진에서 드래그, 다시 찾기 |
| 잘못된 후보 | 확정되지 않은 후보 표시 | 다른 후보, 직접 위치 지정 |
| 429 한도 | "AI 사용 한도에 도달했어요" | 자동 재시도 없음. 직접 점검, 다시 촬영 |
| 413, 읽기 실패 | 크기/읽기 안내 | 다시 촬영 |
| 잘못된 응답 스키마 | "약속된 형식과 맞지 않아 보여 주지 않았어요" | 다시 분석(새 동의), 직접 점검 |
| 탐지 서버 실패 | "AI 요청을 마치지 못했어요" | 직접 점검 |
| 분석 중 취소·이탈 | "AI 요청을 취소했어요", 늦은 결과 무시 | 다시 분석(새 동의) |

## 8. 테스트 (2026-11-14, Windows, Node 22.16.0, Edge 157 headless)

| 게이트 | 결과 | 범위 |
|---|---|---|
| `npm run check`, `npm run build` | PASS | TS + 모듈 문법, Vite |
| `npm test` (mobile) | PASS | 기존 + `camera-ai-flow.test.mjs` 10개 + `vision-host-page.test.mjs` 2개 |
| `test:browser:react` = 기존 React E2E + `camera-ai-browser.mjs` | PASS 23/23 + 15/15 | 아래 시나리오, axe 0건(후보·드래그·결과 포함), 콘솔 오류 0 |
| `test:browser:hosting`, `test:browser:webxr` | PASS | Vite·정적 staging, WebXR QR |
| inspection-sync `test:https-e2e`, `npm test`, `test:legacy`, Kotlin core | 증거 인덱스 참조 | |
| Vision render(`vision-render-browser.mjs`), PostgreSQL 예산 | NOT_RUN 로컬 | `PG_TEST_URL` 필요. CI 작업에서 실행 |
| 실제 스마트폰 카메라, 실제 Roboflow, 실제 OpenAI | **NOT_RUN** | 유료 호출·운영 설정 승인 없음. MOCK PASS를 LIVE로 보고하지 않는다 |

P21 브라우저 시나리오(합성 카메라, 고정 탐지기, MOCK 분석, 실제 로컬 QR v2 relay):

1. 허용 → 프레임 → 후보 2개 위치 정확 → 다른 후보 → 확인 이중 탭 → 분석 정확히 1회, crop 중심이 확인한 부품 → 결과 → 직접 점검 → 확정 → 전송·차량 수락
2. 동의 하나만 체크하면 캡처 불가·요청 0, 새 촬영은 두 동의 초기화
3. 후보 0 → 마우스 역방향 드래그, 상자 정확, 확인 전 분석 0, 확인 후 1회(MANUAL), crop 정확
4. 잘못된 후보 → 드래그, 작은 상자 거부, 경계 밖 드래그 제한, 다시 선택, 큰 부품 상자
5. 12V: 탐지 동의·호출 없음, 터치 드래그, crop 정확
6. 키보드 영역 지정
7. 분석 중 취소 → 늦은 결과 무시, 재분석은 새 동의, 1회
8. 이전 탐지 응답이 늦게 와도 새 사진 후보를 바꾸지 않음
9. 429 한도, 잘못된 스키마, 413, 탐지 실패: 각각 1회, 자동 재시도 없음, 직접 점검 가능
10. 분석 중 `pagehide`, 탐지 중 나가기 대화상자 → 취소, 결과 없음, 카메라 정지
11. 카메라 거부·미지원: AI 버튼 없음, 요청 없음
12. QR v1/직접 접속, AI 없는 QR v2 서비스, DRAFT 외부 부품: 카메라 AI 없음
13. 기존 체크리스트 응답이 AI 왕복 뒤에도 그대로
14. 320px·글자 200%: 결과 화면 가로 넘침 없음, CTA 본문 흐름

이 과정에서 실제 결함 두 건을 고쳤다. 첫째, P20의 `.cb-tag`가 줄바꿈을 막아 200% 글자에서 출처 태그가 넘쳤다. 둘째, 결과 화면에서 전체 사진이 AI 결과를 아래로 밀어냈다. 이제 결과를 먼저 보여 준다.

## 9. Vision Render 배포 준비 (실행하지 않음)

메인 서비스(`render-webxr-experiment.mjs`)와 그 설정은 바꾸지 않는다. 카메라 AI는 탐지·분석이 켜진 Vision 실험 서비스에서만 보인다.

| 항목 | 상태 |
|---|---|
| Start Command | `node tools/inspection-sync-poc/src/render-vision-experiment.mjs` 그대로 |
| 페이지 | 이 진입점은 `/`를 `serveMobilePage` → `readReactPage()`로 제공한다. **`build/react`가 없으면 `/`가 500이다** |
| Build Command | 기존 [P13-F](p13-f-live-vision-e2e.md) 값은 sync 의존성만 설치한다. **React 빌드를 추가해야 한다** (아래) |
| 확인한 것 | `vision-host-page.test.mjs`: Vision 옵션(tls, detection, `openai`)으로 `/`가 React 번들과 `data-part-detection`, `data-part-analysis-service="openai"` 마커를 주고, DRAFT 마커는 없고, 번들에 P21 흐름이 있다 |
| 런타임 의존성 | `vision-providers.mjs` → `vision-poc/src`(OpenAI·Roboflow 클라이언트)는 Node 내장만 사용. 추가 설치 없음 |
| 설정 | `CARSCOPE_VISION_APPROVAL`, `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`, 호출 한도, Roboflow는 `ROBOFLOW_API_KEY` + `CARSCOPE_ROBOFLOW_APPROVAL`. 기존 P13-F와 같고 바뀌지 않음 |
| QR v2 | 실험 서비스의 AVD 시뮬레이터 모드와 단기 enrollment. 기존 절차 |
| 휴대폰 | HTTPS Vision origin. 카메라는 HTTPS에서만 동작(`Permissions-Policy: camera=(self)`) |
| APK | Debug 앱의 고정 API origin은 메인 서비스다. Vision origin으로 QR을 만들려면 P13-F의 별도 origin 절차(APK/endpoint)가 필요하다 |

제안 Build Command (저장소 root, 운영자가 적용):

```text
npm install --prefix tools/inspection-sync-poc --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false && npm ci --prefix tools/mobile-ar-poc --include=dev --ignore-scripts --no-audit --no-fund && npm run build --prefix tools/mobile-ar-poc
```

적용 후 확인:
1. 배포 로그에 Vite `✓ built`.
2. `node tools/inspection-sync-poc/bin/deployment-preflight.mjs probe --origin <Vision origin>` 결과가 `vision: EXPERIMENT`, 탐지 승인 시 `detection: EXPERIMENT`. 유료 호출 없음.
3. 휴대폰에서 실험 QR로 연 워셔액 화면에 `AI 사진 보조 · 실험`과 두 동의가 보임.
4. 한도 1/1로 시작해 탐지 1회와 분석 1회만 관찰한다.

## 10. 남은 한계

- 실제 기기의 세로 스트림, 자동 초점, 손떨림, 빛 반사에서 탐지와 crop 품질은 확인하지 않았다. 합성 장면은 좌표 일치만 증명한다.
- 탐지 응답에 공급자 id가 없어 후보 출처는 일반 문구로만 표시한다.
- 위치 찾기에서 관찰로 넘어가면 카메라가 다시 시작된다(기존 동작).
- 정지 사진이 세로로 길면 화면을 많이 차지한다. 레터박스 없이 좌표를 정확히 맞추기 위한 선택이다.
