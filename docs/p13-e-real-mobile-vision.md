# P13-E — 실제 모바일 Vision 연결 준비

기준: PR #113 병합 main `1b64e3d`. 별도 브랜치 `feat/p13-e-real-mobile-vision`.
6개 부품 모두 탐지 없이 사진 촬영/선택 → 직접 영역 지정 → Crop 확인 → OpenAI 전송 동의 → 분석 → 사용자 확인 → 기존 점검으로 돌아갈 수 있다.
**실제 유료 호출·Render 배포·비밀 변수 등록·실기기 시험은 수행하지 않았다.**

## 구조 결정

| 선택지 | 판단 |
|---|---|
| 기존 Render CLI를 환경변수로 활성화 | 제외. 기존 DENY_DEFAULT/OFF 경계를 바꿈 |
| 기존 runtime에 Vision 공급자를 추가해 같은 CLI에서 선택 | 제외. 기존 운영 진입점 파일을 바꾸지 않는 요구를 우선 |
| 별도 Vision 진입점, 기존 저장소·세션·인증·라우터·어댑터 재사용 | 선택. 운영자가 명령을 바꿔야만 활성화되며 기본 진입점의 import closure와 환경 allowlist는 유지됨 |

`src/render-vision-experiment.mjs`가 형제 runtime이다. `render-stateful.mjs`, WebXR/History 진입점 파일과 Render 설정은 변경하지 않았다.
소규모 HTTP ingress 조합은 별도이며 같은 Host/Origin/forwarded-HTTPS 거부 규칙을 적용한다. 실제 CLI를 자식 프로세스로 실행하는 검사와 브라우저에서 두 진입점을 비교하는 검사가 경계의 차이를 검증한다.
배포 probe는 `vision:EXPERIMENT / detection:OFF`를 `RENDER_VISION_EXPERIMENT:MANUAL`로 표시해 운영자가 승인·예산을 확인하게 한다. 유료 분석 경로를 probe하지 않는다.
일반 sync handler의 `partAnalysis`는 기본 null이며, 명시적 공급자가 있을 때만 분석 route가 열린다. 탐지기가 없으면 서버가 `AI_CANDIDATE`를 거부하고 `MANUAL`만 허용한다.

## 기능과 보존한 계약

- 워셔액 캡·냉각수 리저버·브레이크액 리저버·퓨즈박스·12V 배터리·저전도 냉각수 모두 수동 지정 분석을 제공한다.
- 탐지기가 있는 별도 host에서도 탐지 동의 없이 수동 지정을 선택할 수 있다. 탐지 상태와 지원 부품 표는 그대로다.
- OpenAI는 기존 `openai-vision.mjs`의 Responses API, 부품별 prompt/schema, JPEG Crop, `store:false`, 응답 크기·시간 제한을 사용한다. 공급자 오류·refusal·잘린 응답·잘못된 schema·안전/성능 단정은 성공으로 복구하지 않는다.
- 사용자 확인 전 기존 점검 계속 버튼은 비활성이다. 결과는 점검 답변이나 차량 전송에 자동 입력되지 않는다. 실패·취소·한도 초과 시 직접 점검을 계속한다.
- QR submit 자격, CLAIMED 상태, task/part 일치, 동의, 이미지 크기·형식 검증을 유지한다. 본문 수신 후 세션 상태도 재확인한다.
- 사진·Crop·AI 응답은 서버 디스크/DB/로그에 저장하지 않는다. 기존 명시적 제출/차량 Accept가 만든 사용자 점검 기록은 그대로 보존한다.
- 생성/기록 조회의 기본 권한은 DENY_DEFAULT다. 환경변수나 AI 승인이 차량 소유권이나 기록 조회 권한을 만들지 않는다.

OpenAI 계약 근거: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). `store:false`를 외부 제공자의 모든 보관·처리가 없다는 의미로 해석하지 않는다. 운영 전 계정의 데이터 처리 조건과 안내 검토가 남아 있다.

## Roboflow는 운영 비활성

`approvedDetectionProvider`는 기존 hosted client/parser를 재사용해 탐지 지원 4부품을 연결할 준비가 돼 있다. 단위 검사는 합성 응답만 사용한다. `rightsApproved:true`라는 코드 입력이 필요하고 **Vision CLI는 이 함수를 호출하지 않는다.** 키나 임의 환경변수를 넣어도 탐지 route/동의/버튼은 켜지지 않는다.
모델 라이선스·학습 데이터 권리·이미지 처리 조건의 기존 미해결 사항을 보존한다. 승인 후 별도 변경으로 활성화해야 한다. 12V·저전도는 탐지 미지원 그대로다.

## 비용·동시성·취소

실험 진입점만 기존 private schema에 다음 두 additive 테이블과 expiry index를 준비한다. 기본 운영 진입점은 이 DDL을 import/실행하지 않는다.

| 항목 | 동작 |
|---|---|
| `cs_vision_calls` | provider/UTC day·month별 시도 수. advisory transaction lock으로 두 카운터를 함께 검사·예약하여 다중 인스턴스 경합에서도 상한을 지킴 |
| 일/월 상한 | 둘 다 명시적인 양의 정수 필수, day ≤ month ≤ 1,000,000. 기본값 없음. DB 실패 시 외부 호출하지 않음 |
| 오류/취소 | 이미 예약한 시도는 환불하지 않음. 제공자가 청구했을 가능성을 보수적으로 셈. 자동 재시도 없음 |
| `cs_vision_inflight` | raw token 대신 SHA-256과 90초 lease. 같은 QR의 동시 분석을 인스턴스 간 차단하며 이전 lease의 해제가 새 lease를 지우지 않음 |
| 기존 제한 | 분·세션 rate limit, 이미지 상한, process in-flight 제한 유지. 거부된 요청이 기존 점검을 막지 않음 |
| 취소/시간 제한 | 모바일 Abort → 서버 연결 종료 → 공급자 Abort 전달. route deadline 종료도 공급자를 중단. Roboflow client도 signal/redirect 거부 지원 |

이는 **호출 수 제한**이다. 모델별 원화/달러 지출 보장은 아니며 모델 선택과 제공자 계정의 지출 제한도 운영자가 확인한다. 재시작·프로세스 수 변경으로 카운터가 초기화되지 않는다. 기존 로컬 API 원장(OpenAI 4/5, Roboflow 19/20)은 변경하지 않았다.

## 승인 후 필요한 환경과 실행

이 절의 등록·배포·실제 호출 명령은 이번 작업에서 실행하지 않았다. 소유자가 별도 승인한 실험 서비스에서만 적용한다. 기존 서비스를 바꿀 필요 없이 별도 실험 서비스로 둘 수 있지만, 그 경우 Native의 API origin/QR 기본 주소도 실험 origin으로 맞춰야 한다.

| 설정 | 조건 |
|---|---|
| 기존 Render/DB | `RENDER`, `RENDER_EXTERNAL_URL`, `PORT`, `DATABASE_URL`, 필요한 `CARSCOPE_DB_CA_PEM_BASE64` |
| `CARSCOPE_DB_SCHEMA` | 기존 private schema 이름 필수. DB 역할/search_path가 실제로 이 schema를 가리켜야 하며 일치하지 않으면 시작 거부. public/예약 schema 금지 |
| `OPENAI_API_KEY` | Render의 서버 비밀 변수. 브라우저·APK·Git에 등록하지 않음 |
| `OPENAI_VISION_MODEL` | 소유자가 승인한 image input + strict structured output 지원 모델. 기본값 없음 |
| `CARSCOPE_VISION_APPROVAL` | 데이터 처리·비용·실험 공개 범위 승인 후 `OPERATOR_APPROVED` |
| `CARSCOPE_VISION_DAILY_CALL_LIMIT`, `CARSCOPE_VISION_MONTHLY_CALL_LIMIT` | 소유자가 정한 호출 상한. 실제 한 번 확인을 위한 예는 day=1/month=1이며 승인을 대신하지 않음 |
| 기존 QR 생성 자격 | 기존 운영자 승인 AVD grant 설정 유지. 필요한 경우 기존 `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`와 해당 origin용 등록/자격 사용. 실제 OEM 차량 소유권 증명이 아님 |

Build Command (저장소 root 기준, 추가 ML/평가 의존성 설치 없음):

```text
npm install --prefix tools/inspection-sync-poc --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false
```

승인된 실험 Start Command:

```text
node tools/inspection-sync-poc/src/render-vision-experiment.mjs
```

같은 명령의 npm 별칭은 `npm run serve:render-vision` (`tools/inspection-sync-poc`에서)이다. 기존 운영 명령은 `node tools/inspection-sync-poc/src/render-stateful.mjs` 그대로다. 되돌릴 때는 기존 명령을 선택하고 재배포한다. 호출 카운터/세션/기록을 삭제하지 않는다.
이 진입점은 WebXR 또는 AVD History **조회 시연 진입점을 동시에 켜지 않는다**. 수락된 기록의 저장은 유지하며 `/v1/inspection-records`는 계속 DENY_DEFAULT다. 조회/소유자 인증 확대는 별도 과제다.

### 실제 API 단일 smoke 명령 (승인 후에만)

먼저 실제 모바일 QR을 claim해 해당 부품의 유효한 submit token을 확보하고, 전송할 JPEG Crop과 외부 전송 동의를 확인한다. 아래 `curl.exe`는 실제 과금 시도 1회를 만들 수 있으며 자동 반복하지 않는다. key는 서버에만 둔다. 토큰은 메모리 환경변수로 전달하고 기록/화면 캡처에 남기지 않는다.

```powershell
curl.exe --fail-with-body --request POST "$env:VISION_ORIGIN/v1/part-analyses/washer-fluid-cap" `
  --header "Authorization: Bearer $env:SUBMIT_TOKEN" `
  --header "Content-Type: image/jpeg" `
  --header "X-CarScope-External-Processing: external-vision-v1" `
  --header "X-CarScope-Region-Source: MANUAL" `
  --header "X-CarScope-Target-Box: 0.25,0.25,0.5,0.5" `
  --data-binary "@<approved-crop.jpg>"
```

`target box`는 Crop 안에서 부품이 차지하는 실제 정규화 좌표로 바꾼다. 원본 전체 사진을 테스트 편의로 보내지 않는다. 다른 부품의 QR 자격은 403이며 한도 초과는 429다. 실제 모바일 UI는 이 헤더/Crop을 자동 생성하므로 폰의 버튼으로 1회 확인하는 것이 우선이다.

## 실제 휴대폰 확인 절차

1. 승인된 실험 환경의 `/healthz`에서 `vision:EXPERIMENT`, `detection:OFF` 확인. 잘못된 Host/Origin/HTTP forwarded scheme 거부 확인.
2. 기존 차량/AVD 앱에서 6부품 중 한 부품 선택, **같은 실험 origin**의 기존 생성 자격으로 QR 발급. 표준 운영은 여전히 생성 DENIED이며 AI 설정으로 우회하지 않음.
3. 폰에서 QR 연결, 세션 claim 후 사진 촬영. 갤러리/촬영만으로 업로드하지 않는지 확인.
4. 부품 영역을 직접 지정하고 Crop·주변 맥락·OpenAI 안내 확인. 동의 전 분석 버튼 비활성, Roboflow 동의/요청 없음 확인.
5. 승인한 한도 안에서 실제 분석 1회. 분석 중 중복 탭·취소, 통신 오류/한도 초과 안내, 재촬영 시 재동의 확인. 위험하거나 식별 안 되는 사진을 정상으로 단정하지 않는지 확인.
6. 결과를 직접 확인하고 확인 체크 후 기존 점검으로 복귀. 답변이 자동 입력되지 않고 직접 점검→제출→차량 Accept→기록 저장 흐름이 유지되는지 확인.
7. 작은 화면/가로 화면/Back/앱 전환/불안정 통신/만료/차량 취소 확인. 탭 폐기·새로고침이면 토큰을 저장하지 않는 기존 계약 때문에 새 QR이 필요함.
8. 스크린샷·로그는 토큰/개인 사진을 제외한 외부 증거 인덱스로만 공유. 실제 데이터·제공자 정확도·실기기 결과는 MOCK 결과와 분리해 기록.

## 자동 검증

새 `Vision mobile experiment CI`는 loopback PostgreSQL 16, 실제 QR 자격·세션, Chrome 모바일 화면과 실제 OpenAI 어댑터를 사용하되 outbound fetch만 MOCK이다. 유료 API나 운영 DB를 호출하지 않는다.

```powershell
cd tools/inspection-sync-poc
node test/run-pg-matrix.mjs --only 16 -- --test test/vision-budget-postgres.test.mjs test/vision-experiment.test.mjs test/vision-runtime-postgres.test.mjs
$env:POC_EVIDENCE_DIR = '<outside-repository-evidence-directory>'
node test/run-pg-matrix.mjs --only 16 -- ../mobile-ar-poc/test/vision-render-browser.mjs
```

이미 격리된 loopback `PG_TEST_URL`이 있으면 `npm run test:vision`, 그리고 `tools/mobile-ar-poc`의 `npm run test:browser:vision:render`를 사용할 수 있다. browser gate는 PG가 없으면 skip/PASS가 아니라 실패한다.
결과·환경·원본 위치는 [증거 인덱스](evidence/p13-e/README.md)에 구분한다. 실제 폰·Render·유료 API smoke는 `NOT_RUN`이다.
