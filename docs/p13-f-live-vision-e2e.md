# P13-F — Roboflow + GPT 모바일 연결

기준 main: PR #114 merge `7752ae5fe774db5c38f08d5b09b0b05f01b3fda1`.
브랜치: `feat/p13-f-live-vision-e2e`. 기존 운영 서비스·Start Command·P13-A~E 원장은 변경하지 않는다.

## 연결된 기능

별도 `render-vision-experiment.mjs` CLI가 기존 `approvedDetectionProvider` → `hostedDetectionProvider` → Roboflow client/parser를 사용한다.
고정 모델은 `engine-bay-parts/1`, 고정 HTTPS 공급자이며 API 키는 Authorization 헤더에만 있다. 클라이언트가 모델/URL을 지정하지 않는다.
워셔액·냉각수·브레이크액·퓨즈박스의 정확한 class, confidence, 좌표·종횡비를 검증한다. 탐지 후보는 사용자가 선택한다.
12V 배터리·저전도 냉각수는 UNSUPPORTED를 유지하고, 6부품 모두 수동 지정 + GPT가 가능하다.
후보 없음·다른 부품·탐지 오류에서는 같은 사진으로 직접 영역을 지정할 수 있다.

기존 Crop·OpenAI Responses strict schema·부품별 프롬프트·동의·결과 확인을 재사용한다.
위치 찾기의 Roboflow 전체 축소 사진 전송 동의와, 상태 분석의 OpenAI Crop 전송 동의는 별개이다.
AI는 안전/작동을 확정하지 않으며 점검 답변을 자동 작성하지 않는다. 기존 제출 → 차량 Accept → 기록 저장은 유지한다.
탐지 Back/닫기·분석 취소는 서버와 공급자까지 Abort를 전파한다. 자동 재시도는 없다.
QR별 PostgreSQL lease를 탐지/분석이 공유하고, 본문 수신 뒤 세션 상태를 재검증한다.
두 공급자의 UTC 일/월 시도 수는 별도 행에 기록한다. 한도 소진 시 429와 수동 점검 안내를 반환한다.

## 사용 조건 확인 — 2026-11-08

| 항목 | 공식 근거 및 남은 확인 |
|---|---|
| 프로젝트/데이터셋 | [Stephens Workspace, engine-bay-parts v1](https://universe.roboflow.com/stephens-workspace-gjyrj/engine-bay-parts/dataset/1)에 MIT 표시 확인. 웹 표기가 원본 데이터의 모든 권리 보증은 아님 |
| 모델 런타임 | [공식 Licensing](https://roboflow.com/licensing), 2026-10-27판: Roboflow 3.0의 기본 라이선스 AGPL-3.0과 Cloud에서의 포함 상용 라이선스 구분. 가중치 다운로드·자체 호스팅은 수행하지 않음 |
| 요금제/API | [Pricing](https://roboflow.com/pricing): Cloud Serverless API는 크레딧을 사용. Free/Core의 Cloud 사용과 구형 계정 계약을 동일하다고 추정하지 않음. 실제 계정 요금제·잔여 크레딧·모델 접근·초과과금은 소유자 확인 대기 |
| 개인/공모전 | [Terms](https://roboflow.com/terms)의 Public Plan 내부 비상업 사용 조건과 현재 Cloud 정책을 함께 확인. 실제 계정에 적용되는 계약 및 외부 공모전 시연 범위는 미확인. 구매·요금제 변경·계약 수락을 하지 않음 |
| 처리/보관 | [Privacy](https://roboflow.com/privacy)와 Pricing의 데이터 이용/opt-out 설명 확인. 현재 계정 설정과 Hosted 이미지의 구체적인 보관 기간·데이터 이용 적용 범위는 미확인. 무보관·학습 미사용이라고 주장하지 않음 |
| 출처 | 모바일 탐지 동의 화면에 Stephens Workspace / engine-bay-parts/1 / MIT 표시. 공개 모델/데이터셋 URL은 이 문서에 보존. 바이너리/데이터셋을 재배포하지 않음 |
| OpenAI | [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Data controls](https://developers.openai.com/api/docs/guides/your-data), [Pricing](https://developers.openai.com/api/docs/pricing). 기존 `store:false` 유지. 이는 모든 보관이 없다는 뜻이 아님. 실제 모델·계정 권한·과금은 소유자 확인 대기 |

위 확인이 끝난 운영자만 `CARSCOPE_ROBOFLOW_APPROVAL=OPERATOR_APPROVED`를 설정한다.
이 값은 계정 조건을 API로 검증했다는 증명이 아니라, 소유자가 조건과 비용·이미지 전송을 확인했다는 명시적 설정이다.
조건 확인 전에는 이 변수를 비우고 수동 지정 + GPT 경로를 사용한다. 키나 `ENABLE_ROBOFLOW=true`만으로는 켜지지 않는다.

## 실험 Render 서비스 구성

기존 서비스를 수정하지 않는다. 기존 Vision 실험 서비스가 있으면 그 서비스만 갱신한다. 서비스 존재·URL·관리 권한은 현재 미확인이다.
별도 DB 또는 승인된 private schema/전용 역할을 사용하고 기존 운영 enrollment·QR·사용자 기록을 복사하지 않는다.
[P13-E 환경 계약](p13-e-real-mobile-vision.md)의 DB TLS/CA/search_path 검증을 유지한다.

| 환경변수 | 설정 |
|---|---|
| Render 기본 | `RENDER`, `RENDER_EXTERNAL_URL`, `PORT`는 실제 실험 서비스 값 |
| DB | `DATABASE_URL`, `CARSCOPE_DB_SCHEMA`, 필요 시 `CARSCOPE_DB_CA_PEM_BASE64`. 역할의 실제 current_schema가 설정과 일치해야 함 |
| OpenAI | 서버 비밀 `OPENAI_API_KEY`, 소유자가 가격/이미지/strict schema 지원을 확인한 `OPENAI_VISION_MODEL` |
| Vision 승인 | `CARSCOPE_VISION_APPROVAL=OPERATOR_APPROVED` |
| 호출 한도 | 최초 테스트는 `CARSCOPE_VISION_DAILY_CALL_LIMIT=1`, `CARSCOPE_VISION_MONTHLY_CALL_LIMIT=1`. **공급자 각각** 1회이며 통화 지출 보장은 아님 |
| Roboflow | 서버 비밀 `ROBOFLOW_API_KEY`; 조건 확인 후 `CARSCOPE_ROBOFLOW_APPROVAL=OPERATOR_APPROVED` |
| 실험 QR | 기존 `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`, 실험 DB에서 새로 발급한 단기 enrollment |

Build Command (저장소 root):

```text
npm install --prefix tools/inspection-sync-poc --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false
```

Start Command:

```text
node tools/inspection-sync-poc/src/render-vision-experiment.mjs
```

배포 후 `/healthz`: `vision:EXPERIMENT`, 탐지 승인 시 `detection:EXPERIMENT`, `detectionModel:engine-bay-parts/1`.
AVD 모드에서도 무자격 session 생성/기록 조회/다른 부품 QR 분석은 거부한다. 아래 probe는 유료 API를 호출하지 않는다.

```powershell
node tools/inspection-sync-poc/bin/deployment-preflight.mjs probe --origin $env:VISION_ORIGIN
# 다음 검사는 rate-window DB 쓰기를 포함하며 승인된 실험 서버에서만 실행한다.
node tools/inspection-sync-poc/bin/deployment-preflight.mjs probe --origin $env:VISION_ORIGIN --approve-rate-window-writes
```

## 차량/AVD Debug 앱과 별도 Origin

기존 앱은 기존 Origin 하나만 허용하므로, 같은 인증을 재사용하기 위해 Debug APK를 명시적으로 빌드한다.
`carscopeVisionOrigin`은 정확한 HTTPS onrender.com Origin 하나만 허용한다. 파일/Intent가 허용 Origin을 추가할 수 없다.
속성이 없으면 기존 Origin만 허용한다. Release에 실험 인증을 추가하지 않는다.

```powershell
.\gradlew.bat :app:assembleDebug "-PcarscopeVisionOrigin=$env:VISION_ORIGIN" --console=plain
# 설치 대상은 승인된 테스트 AVD만 사용한다. 기존 앱/설정은 작업 전 보관한다.
adb -s <approved-avd-serial> install -r app/build/outputs/apk/debug/app-debug.apk
```

DB 관리자 URL은 키와 마찬가지로 명령행에 적지 않고 보호된 환경/기존 숨김 입력으로 제공한다.
다음 기존 operator 도구는 실험 DB에 단기 enrollment를 발급하고 앱의 private file로 넣는다.

```powershell
& tools/inspection-sync-poc/android/setup-avd-simulator.ps1 `
  -Serial <approved-avd-serial> -VisionOrigin $env:VISION_ORIGIN `
  -Schema <approved-private-schema> -StateDir <outside-repository-vision-state-directory> `
  -CaPemFile <approved-database-ca-file>
```

실험 enrollment는 `avd-vision-enrollment.json`으로 기존 파일과 구분한다. API/QR mobileRoot는 같은 Origin이다.
기존 History 조회 채널은 기존 호스트에 고정돼 있으므로 실험 enrollment를 그 채널에 보내지 않는다.
실험 서버에서도 Accept한 기록의 DB 저장은 유지한다. 기존 조회 권한을 새로 부여하지 않는다.
이는 AVD 운영자 승인이며 OEM 실제 차량 소유권 인증이 아니다.

## 실제 휴대폰 1 + 1 실행

자동 호출 도구/대량 평가 도구는 추가하지 않았다. 아래 실제 UI 조작이 곧 실제 API 스모크다.

1. 소유자 사진/차량 권한, Roboflow 계정 조건·과금·처리 설정, OpenAI 모델/과금, 외부 전송 동의와 서버 1/1 한도를 먼저 확인한다.
2. 실험 서비스의 HEAD와 `/healthz`, 기본 거부 검사를 확인한다. 차량/AVD에서 워셔액 점검을 선택하고 QR을 발급한다.
3. 실제 휴대폰으로 QR 스캔/claim, 현재 부품 확인 → 위치 찾기 → **Roboflow 전송 동의** → 실제 카메라 촬영. 최초 Roboflow 1회.
4. 후보가 있으면 직접 선택하고 Crop 확인. 없거나 잘못된 후보면 같은 사진에서 직접 영역 지정. 이 경우 탐지 성공으로 기록하지 않는다.
5. **OpenAI Crop 전송 동의** 후 분석 버튼 한 번. 실제 OpenAI 1회. 오류·취소도 한도를 소모할 수 있으므로 재시도하지 않는다.
6. 관찰·이상 의심·한계·재촬영 안내 표시 → 사용자 확인 → 기존 점검 복귀. AI 답변의 자동 입력이 없는지 확인한다.
7. 기존 체크리스트를 직접 완료하고 제출 → 차량 수락 → 실험 DB의 기록 저장을 확인한다.
8. 작은 화면/회전/Back/중복 탭/네트워크 오류/만료는 자동 회귀 결과와 실제 관찰을 구분한다. 실패 주입을 위해 유료 호출을 추가하지 않는다.

카메라 실제 촬영·QR 광학 스캔은 브라우저의 합성 파일 입력 테스트로 증명할 수 없다.
개인 사진/QR/토큰은 캡처·Git에 넣지 않는다. 결과 화면 캡처는 개인 정보/차량 식별정보가 없는지 사람이 확인하고 외부 증거 디렉터리에 보관한다.

호출 수 확인은 실험 DB에서 다음 읽기 전용 SQL을 사용한다. 원장/한도 행을 삭제하거나 초기화하지 않는다.

```sql
SELECT provider, period, calls FROM cs_vision_calls ORDER BY provider, period;
```

비용은 선택 모델의 공식 단가와 해당 요청의 공급자 사용량/청구 내역으로 기록한다. 이미지 토큰과 출력 토큰 없이 임의의 달러 금액을 만들지 않는다.
키·QR 토큰·요청/응답 원문·사진 대신 시간/HEAD/공급자/모델/HTTP 상태/스키마 결과/호출 수/비용 근거만 새 증거에 기록한다.
FULL_E2E_PASS는 실제 휴대폰과 Render에서 Roboflow → GPT → 점검 복귀를 확인했을 때만 사용한다.

검증 결과와 현재 차단 요인은 [P13-F 증거 인덱스](evidence/p13-f/README.md)에 기록한다.
