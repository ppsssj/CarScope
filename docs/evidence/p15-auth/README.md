# P15 증거 인덱스 (Supabase Auth · 내 차량)

원본 캡처와 브라우저 요약은 `C:/CarScope-External/p15-auth/`에 두고 Git에는 이 요약만 남긴다. [설계와 운영 절차](../../p15-supabase-auth-vehicles.md).

## 환경 (2026-11-13, 새 실행)

- 기준 `origin/main` `f03ff198154ef315745f69b4f47e55b83bce7f45`, 브랜치 `feat/p15-supabase-auth-vehicles`, worktree `C:\dev\CarScope-p15-auth`
- Windows 10 Home 19045, Node 22.16.0, npm 10.9.2, Docker 29.8.1, Chrome 157.0.8103.78 (Playwright 1.56.1, 시스템 Chrome)
- `@supabase/supabase-js` 2.119.0 (auth-js 2.119.0), Supabase CLI 3.1.0
- 로컬 스택 이미지: `supabase/postgres:17.11.0.018`, `supabase/gotrue:v2.197.0`, `supabase/postgrest:v16.5`, `supabase/kong:2.8.1`. 서명 키는 실행마다 만든 ES256(`supabase/.temp`, Git 제외)
- 운영 Supabase, Google, Render, AVD, 실기기: 사용하지 않음

## 결과

| 검사 | 결과 | 명령·근거 |
|---|---|---|
| 문법 | PASS | `tools/carscope-account`: `npm run check` |
| 로그인·콜백·세션·갱신·로그아웃·계정 전환 22건 | **MOCK_PASS** 22/22 | `npm test` 중 `test/auth-flow.test.mjs`. 실제 supabase-js + 모의 Auth 서버. 3회 반복 모두 통과 |
| 서버 JWT 검증·P14 경계 8건 | PASS 8/8 (LOCAL) | `test/identity.test.mjs` |
| 입력 규칙·저장소 7건, 로컬 서버 5건, 경계 8건 | PASS 20/20 | `test/vehicle-repository.test.mjs`, `test/server.test.mjs`, `test/boundary.test.mjs` |
| 단위 합계 | PASS 50/50 | `npm test` |
| RLS·권한 (로컬 Supabase Data API, 사용자 2명 이상) | **LOCAL_PASS** 14/14 | `npm run test:rls` (`CARSCOPE_LOCAL_SUPABASE_*`) |
| RLS 테스트의 민감도 (결함 주입) | 8/8 검출 | 전체 SELECT 허용 정책, 검증 열 UPDATE 권한+트리거 끔, anon SELECT, UPDATE 정책 `using(true)`, DELETE 정책 `using(true)`, `owner_id` INSERT 권한, RLS 끔. 처음에는 UPDATE 정책 완화가 SELECT 정책에 가려 통과했다 → 정책 전체를 고정하는 검사를 추가한 뒤 검출. 되돌린 뒤 14/14 |
| 운영자 확인 SQL | 10/10 `t` (LOCAL) | `supabase/operator/verify-account-schema.sql`을 로컬 스택 DB에 실행 |
| 실제 브라우저 화면 13건 | **LOCAL_PASS** 13/13 | `npm run test:browser`. 캡처 12장과 `summary.json`. 실패한 요청은 의도한 두 건뿐(`/auth/v1/user` 연결 거부 시뮬레이션, 로그아웃으로 폐기된 세션 재사용 403). CSP 위반·페이지 오류·URL/콘솔 토큰 0 |
| 기존 패키지 회귀 | 아래 표 | 이 PR은 해당 패키지 파일을 바꾸지 않았다(`git diff f03ff19` 비어 있음) |
| Google OAuth 실로그인 | **BLOCKED** | Google Cloud 클라이언트·운영 Provider 설정 없음 |
| 운영 Supabase 마이그레이션·접속 | **NOT_RUN** | 별도 승인 |
| Render 배포, AVD, 실기기, Android 빌드 | NOT_RUN | 범위 밖. Android 코드·자산 빌더 변경 없음(경계 테스트) |

### 기존 패키지 회귀 (같은 worktree, 같은 날)

| 패키지 | 결과 | 비고 |
|---|---|---|
| `vehicle-core` | BUILD SUCCESSFUL | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain` |
| `tools/vehicle-data-api` | PASS 51/51 | `npm run check && npm test`. 외부 API 기본 비활성 유지 |
| `tools/three-poc` | PASS 348, TODO 1 (기존 P2-9) | `npm run check:results && npm test` |
| `tools/mobile-ar-poc` | PASS 183/183 | `npm test` (17개 모바일 점검 포함) |
| `tools/inspection-sync-poc` | 270 pass / **1 fail** / 41 skip | `npm run check && npm test`. 실패는 기존 `avd-setup-script` 4번: 가짜 adb `.cmd`가 한글 사용자 경로를 잃는 환경 문제(P14 보고와 같음). SKIP은 `PG_TEST_URL` 없음으로 NOT_RUN. DENY_DEFAULT·QR·AVD 인증 코드 변경 없음 |

## 화면 캡처 (저장소 밖)

`01-login-unconfigured` 설정 없음 · `02-login` · `03-login-provider-off` · `04-login-cancelled-message` · `05-vehicles-signed-out` · `06-vehicle-form-errors` · `07-vehicles-one` · `08-vehicle-delete-confirm` · `09-signed-out-after-logout` · `10-auth-unavailable` · `11-webview-refused`(Android WebView UA, 390px) · `12-mobile-vehicles`(390px)

## 표식의 뜻

- **MOCK_PASS:** 실제 클라이언트 라이브러리를 모의 Auth 서버에 연결해 통과. Google·Supabase 서버의 실제 동작은 아니다.
- **LOCAL_PASS:** 이 PC(또는 CI 러너)의 로컬 Supabase 스택. 운영 프로젝트의 설정·기본 권한·서명 키와 다를 수 있다.
- **LIVE_PASS:** 없음.
