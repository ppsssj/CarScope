# P16 — 내 차량에서 3D 점검으로 이동

기준: `282f8d66df943dd4550b8508aec5ae32ba9c181d` (PR #125), 작업 사본 `C:\dev\CarScope-p16-integration`, 브랜치 `feat/p16-account-inspection-integration`.

## 인수 상태와 구현

Claude Code 중단 시 HEAD는 기준 커밋이고, 미커밋 변경은 `tools/three-poc/serve.mjs`와 신규 `vehicle-selection.mjs`(108줄), `reference-model.mjs`, `inspection-link-policy.mjs`였다. 이 파일들은 보존·검토한 뒤 사용했다. 당시 호출자는 없었고 repository에 `get()`도 없어 화면 통합은 미완성이었다. 서버 handler 분리는 진행 중, 참조 모델/기록 정책은 구현됐지만 미검증, 카드·배너·라우팅·회귀 테스트는 미구현으로 분류했다.

Codex는 기존 세션/PKCE/차량 CRUD를 재사용해 다음을 연결했다.

- 내 차량 카드의 **3D 점검 시작** → `/inspect/inspect.html?vehicle=<UUID>` → **내 차량** 복귀.
- `createVehicleRepository().get(id)`가 기존 `carscope_account.vehicles`를 RLS로 다시 읽는다. 타인 차량과 삭제된 차량은 동일한 NOT_FOUND이며 UUID는 인증 수단이 아니다.
- 선택 상태는 메모리에만 둔다. 계정 변경·로그아웃·삭제 알림은 동기적으로 표시를 지우며 늦은 응답은 epoch로 무시한다. 확정적으로 종료한 선택은 URL에서도 제거한다. 탭 복귀 때 Auth 서버와 RLS를 재확인한다.
- 차량 이름은 URL에서 읽지 않으며 DOM `textContent`로 표시한다. 2022 IONIQ 5 참조 모델과 차종·연식 차이를 안내하고 같은 모델명도 실제 차량 형상/옵션/상태 반영으로 표시하지 않는다.
- UUID 없는 체험은 Auth client를 생성하지 않는다. 로그인 설정이 없어도 체험 링크는 같은 서버의 3D 화면을 연다. 기존 별도 trial URL 설정도 유지한다.
- Android용 원본 HTML/JS·자산 builder에는 계정 코드를 넣지 않는다. 브라우저 서버가 HTML에만 배너 모듈을 추가한다. WebView 사용자 에이전트 또는 Native 전역이 감지되면 계정 배너와 선택을 제거하고 Auth client를 만들지 않는다. WebView에서 Google OAuth를 실행하지 않는다.

## 보안 경계 결정

요구: 토큰을 URL/postMessage/QR로 옮기지 않고 기존 브라우저 세션을 복구해야 한다.

| 대안 | 판단 |
| --- | --- |
| 별도 origin 사이에 토큰을 전달 | 기존 세션 공유를 위해 별도 credential 전달 경로가 필요해 제외 |
| 새 서버 세션/BFF 도입 | 별도 세션 저장소와 배포가 필요해 이번 범위에서 제외 |
| 기존 loopback 계정 서버에 검토한 3D 실행 리소스만 mount | 선택. 기존 Auth storage key와 RLS를 재사용하고 추가 DB/배포가 없음 |

**동일 origin의 3D 코드는 계정 코드와 같은 신뢰 경계**이다. 디렉터리 전체를 계정 origin에 공개하지 않는다. `publicOnly` allowlist는 점검 런타임 모듈, 필요한 Three.js 모듈, 참조 GLB, QR 설정/이미지만 허용한다. 테스트 fixture, 서버/build 소스, engineering HTML, 임의 SVG 폴더는 거부한다. 별도 3D 개발 서버의 기존 실험 경로는 유지한다.

통합 HTML은 import map의 SHA-256을 허용하는 CSP를 사용한다(Windows CRLF를 LF로 정규화). 스크립트는 self와 해당 hash만, 네트워크 연결은 self 및 설정된 Supabase origin만 허용한다. 외부 모델 URL query는 거부한다. 계정 페이지의 기존 CSP는 완화하지 않는다. 통합 화면의 inline style 허용은 기존 Three.js UI의 동적 스타일을 위한 것이다. no-referrer/no-store/nosniff/frame-ancestors:none도 유지한다. 검토된 same-origin 코드에서 XSS가 발생하면 저장 세션에도 영향을 줄 수 있다는 신뢰 경계 자체는 남는다.

판단 근거: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), 저장소의 P15 session/repository 및 Android 자산 builder. Supabase changelog에서 현재 고정 JS 클라이언트 사용에 적용할 추가 변경은 발견하지 않았다.

## 기록과 후속 E2E 경계

Google 신원, 직접 입력 차량, QR 세션, 모바일 사진 판단, AVD 등록, 차량 앱 수신, OEM 소유권은 독립된 사실이다. 차량 선택은 현재 점검 세션을 사용자 이력으로 저장하거나 연결하지 않는다. `inspection-link-policy.mjs`는 SESSION_RESULT/AVD_SIMULATOR/미검증 차량에 대한 연결 거부를 명시하며, 미래에 OEM 증거가 있더라도 현재 write API가 없어 연결 불가다. `vehicle_inspection_links` 제약·권한·migration은 변경하지 않았다.

후속 기능은 수행자 신원과 차량 연결 근거를 서버에서 별도 검증해야 한다. 선택 UUID를 QR에 넣어 소유권으로 해석하거나 AVD 기록을 VERIFIED_VEHICLE로 바꾸면 안 된다. AI 판단→사용자 확인→차량 앱 수신→지속 이력 조회의 최종 E2E는 이번 PR의 완료 범위가 아니다.

## 재실행

```powershell
npm ci --ignore-scripts --prefix tools/carscope-account
npm ci --ignore-scripts --prefix tools/three-poc
# 기존 P15의 public Supabase URL/키 설정만 사용. 비밀 키는 설정하지 않는다.
$env:CARSCOPE_IONIQ5_GLB = '<저장소 밖 기존 참조 GLB 절대 경로>'
npm run serve --prefix tools/carscope-account
# http://127.0.0.1:8097/account/ → Google 로그인 → 내 차량 → 3D 점검 시작
```

GLB는 라이선스/기존 자산 경로 정책대로 저장소 밖에 둔다. 미설정 시 선택/인증 UI는 동작하지만 3D 모델은 불러올 수 없다. Render Start Command나 운영 Supabase 설정을 변경하지 않는다. Node 22.16.0, 로컬 Chrome 157.0.8103.78에서 검증했다.

검증 명령·등급·미검증 범위와 원본 위치는 [P16 증거 인덱스](evidence/p16-integration/README.md)에 있다.
