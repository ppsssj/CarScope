# AR-01 · 워셔액 모바일 AR 셀프 점검

2026-11-01, 기준 main `a6c740c`(P3-A5.2 PR #24 병합 포함). QR-AR PoC 페이지를 사용자가 **워셔액 점검 한 항목을 처음부터 끝까지 직접 완료**하는 스마트폰 화면으로 바꿨다. 카메라는 위치를 찾는 보조 수단이다. 상태는 사용자가 눈으로 확인하고 고른다. AI 판정, 자동 진단, 백엔드 전송은 없다.

## 1. 사용자 흐름

| 단계 | 화면 | 동작 |
| --- | --- | --- |
| 1 시작 | QR 진입 | `#v=1&task=washer-fluid` 확인. 점검 목적·주의사항. **카메라로 점검 시작**, 또는 **카메라 없이 점검하기**(수동 경로) |
| 2 위치 찾기 | 카메라 안내 | 후면 카메라, 파란색 후보 상자(미검증). 사용자가 **화면을 탭해 위치를 지정**하면 링·화살표·"내가 지정한 위치" 라벨이 표시된다. 다시 탭하면 옮겨지고 **위치 지정 해제**로 지운다. 화면 위 칩에 현재 단계와 짧은 안내를 보여 준다. 카메라 거부·미지원 시 **카메라 없이 다음 단계로**. 주입구를 찾지 못하면 **주입구를 찾을 수 없음 · ‘확인 불가’로 기록** |
| 3 셀프 점검 | 체크리스트 | ① 안전 정차·보닛 열기 ② 설명서로 주입구 확인 ③ 워셔액 상태 직접 확인. 세 항목을 모두 표시해야 다음으로 간다. "위치가 확실하지 않으면 캡을 열지 마세요" 경고. 카메라 모드면 카메라 화면이 위에 계속 보인다. 끝까지 확인할 수 없으면 **확인할 수 없음 · ‘확인 불가’로 기록** |
| 4 결과 | 선택 → 확정 → 완료 | **정상 확인 / 보충 필요 / 확인 불가** 중 선택 → 요약 확인 → **이 결과로 점검 완료** → 완료 화면(항목·결과·시각·SELF·USER_REPORTED·후속 안내·"이 휴대폰 화면에서만 확정, 차량 앱 미전송") |

공통 조작:
- 상단 **점검 취소**: 확인 질문 후 시작 화면으로. 결과는 만들어지지 않는다.
- 하단 **뒤로**: 한 단계씩.
- **수동 안내 보기**: 카메라를 끄고 안내로 이동.
- 완료 후 **새 점검 시작**: 새 점검 ID로 다시 시작.

진행 표시는 4단계다. 큰 버튼은 화면 하단에 고정해 한 손으로 누를 수 있게 했다.

### ‘확인할 수 없음’ 경로 (2026-11-01 추가)

주입구를 찾지 못했거나 상태를 확인하지 못한 사용자가 체크리스트를 거짓으로 표시하지 않고 **확인 불가(UNSURE)** 를 기록하는 경로다.
- 위치 찾기·셀프 점검 단계에서 누르면 곧바로 **확인 불가 결과 확정 화면**으로 간다. 확정 화면에는 "체크리스트를 모두 확인하지 않고 확인 불가로 기록합니다. 표시하지 않은 항목은 확인한 것으로 기록되지 않습니다"가 표시되고, 확인 근거는 "사용자 보고 · 확인하지 못함"이다.
- 체크리스트는 사용자가 표시한 그대로 둔다. 자동으로 체크하지 않는다.
- 뒤로 가면 출발한 단계로 돌아가고 선택이 지워진다.
- 정상 확인·보충 필요는 지금처럼 체크리스트 3개를 모두 표시하고 결과 단계를 거쳐야만 고를 수 있다.
- 기록은 같은 schema v1 레코드(`status: UNSURE`, `confirmation: USER_REPORTED`)다. 필드를 추가하지 않았다.

### 위치 표시의 한계 (화면에도 표시)

- 사용자가 지정한 위치는 **영상 프레임 안의 2D 좌표**다. 3D 공간 고정, ARCore/ARKit 앵커, 추적이 아니다. 휴대폰을 움직이면 표시가 실제 부품과 어긋난다.
- 카메라가 멈추거나 다시 시작될 때, 영상 크기가 바뀔 때(회전, 다른 카메라)는 표시를 지우고 다시 지정하라고 안내한다. 같은 영상 크기에서 화면만 바뀌면(레이아웃) 같은 영상 지점으로 다시 투영한다.
- 파란색 후보는 PoC의 색상 휴리스틱 그대로다. 사용자가 탭하기 전에는 아무것도 워셔액 주입구로 확정하지 않는다. 사용자가 탭한 위치도 "사용자가 지정한 위치"일 뿐 판정이 아니다.

## 2. 점검 결과 데이터 모델 — [inspection-result.mjs](public/inspection-result.mjs)

AR-02의 차량 앱 동기화·점검 이력에서 다시 쓸 수 있도록 화면과 분리한 순수 모듈이다.

| 필드 | 값 | 비고 |
| --- | --- | --- |
| `schemaVersion` | `1` | |
| `inspectionId` | UUID v4 | 점검 시도마다 무작위. 기기·차량에서 파생하지 않음 |
| `taskId` | `washer-fluid` | QR 계약의 task와 같음 |
| `method` | `SELF` | |
| `source` | `MOBILE` | |
| `state` | `IN_PROGRESS` → `COMPLETED` | 미완료와 완료를 구분. 미완료 레코드에는 결과 필드가 없음 |
| `startedAt` / `completedAt` | ISO 8601 UTC | `completedAt ≥ startedAt` |
| `aids` | `{ cameraUsed, locationMarked }` | 불리언만. 좌표·영상·이미지 없음 |
| `status` | `OK` / `NEEDS_REFILL` / `UNSURE` | 완료 시에만 |
| `confirmation` | `USER_REPORTED` | 완료 시에만. "정상 확인"도 안전 인증이 아님 |
| `sync` | `NOT_SENT` | AR-01에는 전송이 없음. AR-02에서 상태를 추가 |

규칙:
- `validateResult()`는 상태별 정확한 필드 집합만 허용한다. VIN·CRN·번호판·이미지·영상·위치·계정·기기 ID 같은 필드가 있으면 거부한다.
- `completeInspection()`은 진행 중인 레코드에만 한 번 적용된다. 완료된 레코드에 다시 적용하면 예외가 나므로, 한 시도에서 완료 결과가 둘 생기지 않는다.
- 화면은 결과를 메모리에만 둔다. 로컬 저장, 업로드, 전송이 없다. 완료 화면의 "결과 데이터 보기"는 레코드 JSON을 그대로 보여 준다.

## 3. 구성과 호환성

| 파일 | 변경 |
| --- | --- |
| [inspection-result.mjs](public/inspection-result.mjs) | 신규. 데이터 모델 |
| [self-inspection.mjs](public/self-inspection.mjs) | 신규. 단계 상태 머신(순수). 맞지 않는 이벤트는 같은 상태를 반환하므로 연타·늦은 이벤트가 단계를 건너뛰지 못함. `CANNOT_CONFIRM`(확인할 수 없음)은 위치 찾기·셀프 점검 단계에서만 받음 |
| [marker.mjs](public/marker.mjs) | 신규. 탭 ↔ 영상 정규 좌표 변환(기존 `containRect` 재사용), 표시 그리기 |
| [app.mjs](public/app.mjs), [index.html](public/index.html), [style.css](public/style.css) | 단계형 모바일 화면으로 재작성. 카메라 수명주기·후보 스캔·정지 감지·숨김/pagehide 중지는 PoC 코드를 그대로 옮김 |
| [camera.mjs](public/camera.mjs), [detector.mjs](public/detector.mjs), [handoff.mjs](public/handoff.mjs) | **변경 없음** |
| [server.mjs](server.mjs), [staging/build.mjs](staging/build.mjs), `package.json` | 새 모듈 3개를 허용 목록·정적 빌드·문법 검사에 추가. 헤더·CSP·Vercel 설정은 그대로 |

- QR 계약 `#v=1&task=washer-fluid`는 변경 없음. 차량 식별정보·세션 ID를 넣지 않으며, 그런 필드가 붙은 QR은 거부한다(단위 테스트).
- 직접 방문(해시 없음)은 기존처럼 허용한다. 잘못된 QR은 카메라와 점검 시작을 모두 막는다.
- CSP(`style-src 'self'` 등)를 바꾸지 않는다. 화면 전환은 `body[data-step]` 속성과 CSS로 하며 인라인 스타일이 없다.
- Android·Pleos·vehicle-core·Geometry·Three.js 코드와 P3-A6 작업 공간은 건드리지 않았다. 새 라이브러리도 없다.

## 4. 검증 (2026-11-01)

| 항목 | 결과 | 비고 |
| --- | --- | --- |
| `npm run check` | PASS | 모듈 9개 문법 |
| `npm test` (Node) | PASS 31/31 | 기존 16 + AR-01 15: 데이터 모델(필드·민감 필드 거부·상태·중복 완료·타임스탬프·ID), 흐름(경로·체크 게이트·뒤로·취소·재시작·중복 확정·확인할 수 없음 3건), 2D 좌표 변환, QR v1 계약 |
| `npm run test:browser` (Edge 헤드리스, 합성 카메라) | PASS 16/16, 2회 연속(확인할 수 없음 추가 후) | 아래 표 |
| 정적 스테이징 빌드(로컬, 배포 없음) | PASS | 12개 파일. 페이지·모듈은 원본과 바이트 동일. `handoff.json`은 v1 계약 URL |

브라우저 자동화 항목:
- 진입: v1 QR 수신, 시작 화면, 수동 안내. 서버가 만든 QR SVG를 독립 디코드하면 v1 계약과 일치.
- 카메라와 위치 지정:
  - 키보드로 시작, 후보 상자(미검증)와 단계 칩 표시.
  - 탭 → 위치 지정(오버레이 픽셀 확인) → 다시 탭하면 이동 → 해제.
  - 가로 화면에서 같은 영상 지점으로 재투영, 넘침 없음.
  - 중지하면 트랙 종료와 함께 표시가 지워지고, 재시작해도 이전 표시가 남지 않음.
- 후보 회귀: 후보 없음 → 오버레이 지움 → 후보 다시 표시.
- 체크리스트: 3개 모두 표시해야 다음으로 진행, 오주입 경고 표시, 카메라 화면 유지.
- 결과:
  - 결과 단계로 가면 카메라가 꺼짐. 선택을 바꿀 수 있고, 뒤로 갔다 와도 선택이 유지됨.
  - 확정 버튼 **더블 탭**에도 완료 레코드는 1개이고 완료 화면이 유지됨(아래 발견 사항).
  - 레코드는 검증 통과, `SELF`·`USER_REPORTED`·`NOT_SENT`, VIN·미디어 필드 없음.
- 수동 경로: 카메라를 열지 않고 `OK`·`UNSURE` 결과 생성, 새 ID. `OK` 안내에 "인증하지 않습니다" 문구.
- 확인할 수 없음:
  - 카메라 단계에서 누르면 확인 불가 확정 화면과 안내가 나오고 카메라가 꺼짐. 뒤로 가면 카메라 단계로 돌아감.
  - 체크리스트 1개만 표시한 상태에서 누르고 확정(더블 탭)하면 `UNSURE`·`USER_REPORTED` 레코드 1개가 생기고, 나머지 2개는 표시되지 않은 채로 남음.
- 취소: 확인 질문 → 계속 / 취소. 취소하면 레코드·표시가 없고 트랙이 종료됨.
- 수명주기 회귀: 수동 안내로 포커스 이동하며 트랙 종료, 정지 프레임 감지, 화면 숨김 시 중지와 표시 해제.
- 잘못된 QR: 시작 불가. 권한 거부: 안내 후 카메라 없이 계속. 카메라 미지원 처리, 데스크톱 화면.

테스트 중 발견해 고친 문제:
1. 확정 버튼을 더블 탭하면 두 번째 탭이 같은 자리의 **새 점검 시작**을 눌러 완료 화면이 바로 사라졌다. 레코드는 1개였다. 완료 직후 1초 동안 그 버튼을 비활성화한다.
2. 이전 단계의 스크롤 위치가 남아 카메라 화면이 상단바 밑으로 밀렸다. 단계가 바뀌면 맨 위로 이동한다.
3. 좁은 화면에서 카메라 버튼 글자가 줄바꿈됐고, 지정 위치 라벨이 후보 라벨과 겹쳤다. 위치를 지정한 뒤에는 후보 상자만 그린다.

증거(캡처·결과 JSON)는 `C:\CarScope-External\qr-ar-01\ar-01\run5`–`run8`, `unsure-run1`–`unsure-run2`, 정적 빌드는 `...\ar-01\staging-build`, `staging-build-2`에 있다. 저장소에는 넣지 않았다.

### 4.1 보호된 Preview 배포 결과 (2026-11-01)

| 항목 | 결과 |
| --- | --- |
| Vercel 팀 / 프로젝트 | `ppsssj-projects` / `carscope-qr-ar-staging` (`prj_INDdBXXPy5QFnKbQR92akFYglofT`). 기존 프로젝트에 연결했고 새 프로젝트는 만들지 않음 |
| 프로젝트 설정(실제 값) | Root Directory **`.`**(`tools/mobile-ar-poc`가 아님), Framework Other, Build `npm run build:staging`, Output `build/staging`, Install `npm ci --ignore-scripts`, Node 22.x. 그래서 `tools/mobile-ar-poc` 내용을 업로드 루트로 배포함 |
| 배포 방식 | Vercel CLI 65.9.0, 계정 소유자 브라우저 로그인. `git archive <commit> tools/mobile-ar-poc`로 만든 저장소 밖 폴더에서 `vercel deploy --target=preview --scope ppsssj-projects`(`--prod` 없음). 업로드는 `package*.json`, `vercel.json`, `public/`, `staging/`로 제한. `vercel link`가 만든 `.env.local`(OIDC 토큰)은 업로드 전에 삭제 |
| **Preview** | `dpl_BUGv5qyS8G6QvaLynpzfErdGoxhG` · https://carscope-qr-ar-staging-qbd4pucq0-ppsssj-projects.vercel.app · target preview · **READY** |
| 배포된 Git SHA | `afa92fe59f3aaf6f0970cd508c6081b971c88fac`(PR #26). 서버의 `/build-info.json` revision과 일치. 제공되는 페이지·모듈·아이콘 10개 파일이 이 커밋과 **바이트 동일** |
| HTTPS·보안 헤더 | 200, HSTS, CSP(`default-src 'none'` …), `Permissions-Policy: camera=(self), microphone=()`, `no-store`, `nosniff`, `no-referrer`, `noindex` |
| 인증 보호 | 로그인하지 않은 요청은 `/`, `/app.mjs`, `/handoff.json`, `/qr.svg`, `/favicon.svg` 모두 Vercel SSO로 302. 보호 설정은 변경하지 않음 |
| QR 실제 디코딩 | 서버의 `/qr.svg`를 렌더링해 jsQR로 디코드 → `https://carscope-qr-ar-staging-qbd4pucq0-ppsssj-projects.vercel.app/#v=1&task=washer-fluid`. **Preview 자신의 주소**이며 운영 주소가 아님. `/handoff.json`도 같은 값 |
| 브라우저 확인 | Preview에서 받은 파일을 `vercel.json` 헤더(CSP 적용)로 로컬 제공하고 합성 카메라로 진행: 시작 → 위치 찾기 → 확인할 수 없음 → 완료, `UNSURE`·`USER_REPORTED`·`NOT_SENT`. **콘솔 오류 0, HTTP 오류 0**. Preview 출처를 헤드리스 브라우저로 직접 열려면 SSO 세션이나 보호 우회 비밀값이 필요한데, 보호 설정 변경이 금지라 직접 열지는 않음 |
| Production 영향 | 없음. 배포 전후 모두 `dpl_B2WgK4MVekTj6m1pSPt7Szd4pW7R`(Ready), 별칭 `carscope-qr-ar-staging.vercel.app`, `carscope-qr-ar-staging-ppsssj-projects.vercel.app` 그대로. 운영 QR·Android QR 자산도 변경 없음 |

진행 중 발견해 고친 것:
- 첫 Preview(`dpl_H6L4JctwCCzawiEEFuAbJCFP3Yji`, 커밋 `c720076`)에서 브라우저가 자동으로 요청하는 `/favicon.ico`가 404였다. 흐름 중 유일한 콘솔 오류였다.
- 같은 출처 SVG 아이콘을 추가하고(`afa92fe`) 다시 배포했다. 첫 Preview는 삭제하지 않았으며 위 배포로 대체됐다.
- 이후 이 문서를 고친 커밋은 제공 파일에 영향이 없다(정적 출력에 `.md` 미포함).

### 미검증 (실제 기기)

| 항목 | 상태 |
| --- | --- |
| 실제 스마트폰에서 AR-01 흐름 전체 | **NOT_RUN** — 이 PC에 연결된 실제 휴대폰 없음(ADB에는 Pleos 에뮬레이터만). 위 Preview URL로 사용자 검증 필요 |
| 실제 후면 카메라에서 탭 위치 정합, 회전·앱 전환 후 동작 | NOT_RUN |
| 실제 권한 거부 UI, iPhone Safari | NOT_RUN |
| 워셔액 주입구 의미 인식 정확도 | UNVERIFIED (PoC와 같음) |
| 보호된 Preview 배포 | **READY** (2026-11-01, 아래 §4.1) |

QR-AR PoC 단계의 실기기 기록(Galaxy Z Flip8 / Android Chrome, 사용자 보고 13개 항목)은 [HTTPS_STAGING.md](HTTPS_STAGING.md)에 있다. 이는 **이전 화면**에 대한 결과이며 AR-01 화면의 결과가 아니다.

## 5. 실제 스마트폰 검증 절차 (다음 단계)

### 보호된 Preview 준비 (기존 스테이징에 영향 없음)

2026-11-01 이 절차로 배포했다(§4.1). 아래는 다시 배포할 때의 절차이며, 운영 별칭과 다른 서비스는 바꾸지 않는다. 실제 프로젝트의 Root Directory는 `.`이므로 `tools/mobile-ar-poc` 안에서 배포한다.

| 항목 | 내용 |
| --- | --- |
| 배포 대상 | 기존 전용 프로젝트 `carscope-qr-ar-staging`(팀 `ppsssj-projects`)의 **Preview** 배포 1개. 새 프로젝트를 만들 필요 없음 |
| 배포 소스 | PR #26 브랜치 커밋의 `tools/mobile-ar-poc`만. 기존 `vercel.json`(정적 출력 `build/staging`, CSP·카메라 self·noindex 헤더)을 그대로 사용 |
| 바꾸지 않는 것 | production 배포·별칭(`carscope-qr-ar-staging.vercel.app` 등), 프로젝트 보호 설정(All Deployments 인증), 환경 변수, Git 연동(없음 유지), Android 앱의 QR 자산 |
| QR | Preview의 `VERCEL_URL`로 `handoff.json`·`qr.svg`가 생성됨(같은 v1 계약). 운영 QR과 다름 |

```powershell
# 계정 소유자 PC. 토큰을 명령줄이나 Git에 넣지 않는다(브라우저 로그인 사용).
git -C C:\dev\CarScope-ar01 checkout feat/ar-01-mobile-self-inspection
Set-Location C:\dev\CarScope-ar01\tools\mobile-ar-poc
npx vercel@latest login
npx vercel@latest link --scope ppsssj-projects --project carscope-qr-ar-staging
# --prod를 붙이지 않는다: production 별칭은 그대로, 새 Preview URL만 생성
npx vercel@latest deploy --target preview
# 확인: 로그인 없이 열면 Vercel 인증 화면이어야 함. 로그인 후 /build-info.json, /handoff.json, 카메라 동작 확인
```

`.vercel/` 링크 폴더는 Git에 넣지 않는다. 테스트가 끝나면 이 Preview 배포만 삭제할 수 있다. 다른 방법(운영자가 준비한 신뢰 HTTPS 주소에서 `npm run serve`, README의 TLS·reverse proxy 안내)도 있다.

기록: 기기 모델, OS·브라우저 버전, 실행 커밋, 항목별 PASS/FAIL/NOT_RUN, 관측 메모를 남긴다. 영상·사진은 사용자가 동의한 경우에만 외부 폴더에 둔다.

| # | 동작 | PASS 조건 |
| --- | --- | --- |
| 0 | 휴대폰 브라우저로 Preview URL을 열고 Vercel 계정으로 로그인 | 로그인 후 시작 화면 표시. 로그인 전에는 Vercel 인증 화면 |
| 1 | PC 화면 QR 스캔 | `…/#v=1&task=washer-fluid`로 열리고 "QR 작업 수신: 워셔액 점검" 표시. Preview QR은 Preview 자신의 주소 |
| 2 | 카메라로 점검 시작 | 권한 요청(마이크 요청 없음) 후 **후면** 영상과 2단계 칩 표시 |
| 3 | 주입구 부근을 비추고 탭 | 탭한 자리에 링·화살표·라벨. 다시 탭하면 이동, 해제하면 사라짐 |
| 4 | 휴대폰을 움직임 | 표시가 화면에 남아 실제 위치와 어긋남을 확인(정상 동작). 안내 문구 확인 |
| 5 | 세로↔가로 회전 | 영상 크기가 바뀌면 표시가 해제되고 다시 지정하라는 안내. 버튼·글자 넘침 없음 |
| 6 | 체크리스트 3개 → 결과 선택 → 확정 | 각 결과(정상/보충/확인 불가)마다 완료 화면에 결과·시각·SELF·사용자 보고·미전송 문구 |
| 6b | 위치 찾기 또는 체크리스트 일부만 표시한 상태에서 ‘확인할 수 없음’ | 확인 불가 확정 화면과 안내. 뒤로 가면 출발 단계로 복귀. 확정하면 확인 불가 완료 화면 |
| 7 | 확정 버튼 빠르게 두 번 | 완료 화면이 유지됨 |
| 8 | 진행 중 점검 취소 / 뒤로 | 확인 후 시작 화면, 카메라 표시등 꺼짐 |
| 9 | 앱 전환 후 복귀 | 카메라가 꺼져 있고 자동 재시작 없음. 카메라 시작으로 다시 사용 가능, 이전 표시 없음 |
| 10 | 권한 거부 | 거부 안내 → 카메라 없이 다음 단계로 진행해 완료 가능 |
| 11 | 카메라 없이 점검하기 | 카메라 권한 요청 없이 완료까지 진행 |

모두 통과해도 워셔액 잔량이나 주입구를 자동으로 판정한 것은 아니다. 결과는 사용자 보고다.
