# P15 Supabase Auth Google 로그인과 내 차량 관리

기준 `origin/main` `f03ff19` (PR #124 병합 후). 새 패키지 `tools/carscope-account`, 마이그레이션 1개, CI 1개, 이 문서와 [증거 인덱스](evidence/p15-auth/README.md).

**한 일:**
- Supabase Auth(PKCE)로 Google 로그인하는 브라우저 화면 3개(로그인, 콜백, 내 차량)와 로컬 서버.
- 사용자별 차량 등록·조회·수정·삭제. 모든 차량은 `SELF_REPORTED_UNVERIFIED`이다.
- 새 스키마 `carscope_account`의 테이블 3개, RLS, 열 단위 권한, 운영자 적용·검증 SQL.
- 서버가 Supabase 액세스 토큰을 JWKS로 검증하는 모듈과, 검증된 사용자를 P14 `ExternalVehicleDataService`의 `sessionKey`로 바꾸는 경계(라우트 없음).

**하지 않은 것:** 실제 Google OAuth 로그인, 운영 Supabase 프로젝트 접속·SQL 실행·설정 변경·사용자 생성, Render 배포, 3D 점검 화면·QR·AVD·Android 코드 변경, 현대자동차 OAuth·차량 데이터 호출.

## 판정

| 항목 | 상태 | 범위 |
|---|---|---|
| 로그인·세션·로그아웃 흐름 | **MOCK_PASS** | 실제 `@supabase/supabase-js` 2.119.0 + 저장소의 모의 Auth 서버(`test/support/mock-gotrue.mjs`). Google 없음 |
| RLS·권한·검증 상태 보호 | **LOCAL_PASS** | `supabase start`로 띄운 로컬 스택(GoTrue v2.197.0, PostgREST, PostgreSQL 17.11.0.018 이미지)에서 서로 다른 사용자 2명의 실제 JWT로 Data API 호출. 결함 8종을 하나씩 넣어 모두 실패로 잡히는지 확인 |
| 서버 JWT 검증 | **LOCAL_PASS** | 생성한 ES256/RS256 키, 그리고 로컬 GoTrue가 발급한 실제 토큰 |
| 실제 브라우저 화면 | **LOCAL_PASS** | 시스템 Chrome 157 + 로컬 스택. 로그인은 Google이 아니라 로컬 이메일 사용자의 세션을 넣어 확인 |
| Google OAuth 실로그인 | **BLOCKED** | Google Cloud OAuth 클라이언트와 운영 프로젝트의 Google Provider 설정이 없다 |
| 운영 Supabase 프로젝트 | **NOT_RUN** | 접속하지 않았다. 마이그레이션 미적용, Data API 노출 미설정 |
| 화면 호스팅(운영) | **NOT_RUN** | 로컬 서버(`127.0.0.1:8097`)만 있다. 어디에 배포할지는 별도 결정 |
| 현대자동차·Pleos 외부 데이터 | **BLOCKED** (변경 없음) | Google 로그인은 외부 데이터 권한을 주지 않는다 |
| LIVE_PASS | 없음 | 실제 계정·운영 DB로 확인한 항목이 없다 |

## 1. 기존 시스템 분석

| 대상 | 확인한 사실 | 이번 설계에 준 영향 |
|---|---|---|
| [P9-A4](p9-a4-supabase-migration.md) | 운영 Supabase 프로젝트(ref `kapd…mxdt`, PG 17.11, 사용자 보고)가 있지만 연결·`carscope_app` 생성·데이터 이전은 모두 NOT_RUN. 세션·점검 기록은 전용 스키마 `carscope`에 두고 **Data API에 노출하지 않으며** anon/authenticated/service_role에 권한을 주지 않는다. `carscope_private`는 빈 스키마로 그대로 둔다 | 계정 데이터는 별도 스키마 `carscope_account`. `carscope`·`carscope_private`·`public`을 만들거나 참조하지 않는다(정적 테스트) |
| [P8-A2](p8-a2-history-auth.md), [P9-H1](p9-h1-inspection-history-read.md) | `/v1/inspection-records`는 차량 소유자 credential 경로이며 운영은 DENY_DEFAULT(403). AVD 기록은 `AVD_REGISTRATION_BINDING`일 뿐 사람·차량 증명이 아니다. 기록 namespace는 `UNVERIFIED`·`AVD_SIMULATOR`·`VERIFIED_VEHICLE` | 연결 테이블은 `VERIFIED_VEHICLE`만 가리킬 수 있고, API 역할은 쓸 수 없다. 기존 기록을 옮기지 않는다 |
| [P14-B](p14-external-vehicle-data.md) | `sessionKey`는 "서버가 인증한 CarScope 신원". 저장소 승인 목록은 비어 있고 두 provider는 DISABLED/BLOCKED | 검증된 Supabase 신원만 `csu_` 키로 바꾸는 함수를 두되 어디서도 호출하지 않는다 |
| QR·AVD 인증 (`inspection-sync-poc`) | QR receiver 토큰, AVD enrollment proof, 생성 grant가 서로 분리되어 있고 Supabase 의존성이 없다 | 바꾸지 않았다. Render 진입점 6개의 import 그래프에 계정 패키지·`@supabase`가 없음을 테스트로 고정 |
| Android Debug/Release | 3D 화면은 Debug WebView 자산이며 `shouldOverrideUrlLoading`이 모든 이동을 막는다. 자산은 `build-android-*.mjs`가 파일을 지정해 복사 | 계정 화면은 Android 자산에 들어가지 않는다(테스트). 페이지도 WebView UA에서 Google 로그인을 시작하지 않는다 |
| 기존 Supabase 구현 | 코드에 Supabase Auth·OAuth·사용자 테이블이 없었다(`database-config.mjs`의 Supabase 호스트 판정만 있음) | 새로 만든다 |

## 2. 구성

```text
tools/carscope-account/
  web/            index.html(로그인) callback.html vehicles.html account.css
                  login-page.mjs callback-page.mjs vehicles-page.mjs
                  lib/ public-config auth-flow account-session vehicle-repository account-runtime account-copy
  serve.mjs       127.0.0.1 전용 정적 서버. /account/config.json에 URL과 publishable key만 싣는다
  src/            supabase-identity.mjs (서버 JWT 검증), external-data-identity.mjs (P14 경계)
  supabase/       config.toml (로컬 스택 전용), migrations/20261113000000_p15_account_vehicles.sql,
                  operator/verify-account-schema.sql (읽기 전용 확인)
  test/           단위·흐름·경계·RLS·브라우저
```

- 3D 점검 화면은 React로 다시 쓰지 않았고 **한 줄도 바꾸지 않았다.** 계정 화면은 프레임워크 없는 ES 모듈이며 `inspect.html`의 색·버튼·44px 터치 영역을 따른다.
- 브라우저 의존성은 `@supabase/supabase-js` 2.119.0 하나(고정, lockfile 포함). UMD 빌드를 같은 출처에서 내려준다. 개발 의존성은 `pg` 8.23.1, `playwright` 1.56.1(저장소의 다른 패키지와 같은 버전).

## 3. 로그인 UX

| 모드 | 내용 |
|---|---|
| 체험 모드 | 3D 탐색, 부품 선택, QR 점검, 기존 세션 결과, AVD 기능. 로그인 요구 없음. 이번 PR은 이 경로의 파일을 바꾸지 않았다 |
| 내 차량 모드 | `/account/vehicles.html`. 서버(Auth)가 확인한 사용자에게만 프로필·차량·연결 상태를 보여 준다 |

- **로그인 화면:** "Google로 계속하기", "로그인 없이 체험하기"(`CARSCOPE_TRIAL_URL`), 개인정보 처리 안내 5항목, 상태 문구. 설정이 없거나, Provider가 꺼져 있거나, 취소·실패해도 체험 링크는 그대로 보인다.
- **내 차량 화면:** 프로필(이름·이메일·사진), 현대자동차 계정 연결 "사용할 수 없음(준비 중)", 차량 카드(제조사·모델·연식·별칭, `직접 등록 · 소유 확인 안 됨`, 차량 데이터 연결 "연결 안 됨", 점검 기록 연결 "없음"), 추가·수정·삭제(2단계 확인), 다른 Google 계정으로 로그인, 로그아웃.
- **비로그인 접근:** "로그인이 필요합니다" 안내와 로그인·체험 버튼. 차량 정보는 요청하지 않는다.
- **차량 입력:** 제조사(필수, 40자), 모델명(필수, 60자), 연식(선택, 1950~올해+2), 별칭(선택, 40자). VIN·번호판·위치는 묻지 않으며 다른 필드를 보내면 요청 전에 거부한다. 계정당 20대.
- 3D 모델에서 고른 차종으로 차량을 자동 등록하는 경로는 없다.

## 4. 인증 흐름

Supabase 공식 문서(2026-11-13 열람: auth-google, redirect-urls, creating-a-client, row-level-security, pkce-flow, getClaims, api-keys, securing-your-api)를 따랐다. 문서에 없는 내용은 NOT_STATED로 적는다.

```text
[로그인 화면] beginGoogleLogin
  ├─ WebView UA(; wv) → 중단            ├─ /auth/v1/settings의 google=false → 중단(PROVIDER_NOT_ENABLED)
  ├─ sessionStorage에 1회용 nonce(32바이트, 10분) 저장
  └─ signInWithOAuth({provider:'google', redirectTo: <origin>/account/callback.html?cs_flow=<nonce>})
       supabase-js가 PKCE verifier를 localStorage에 두고 Supabase /authorize로 이동 → Google → Supabase
[콜백] URL을 읽은 즉시 history.replaceState로 query·fragment 제거
  ├─ access_token·refresh_token이 URL에 있으면 거부(implicit 흐름 금지)
  ├─ error / error_code → CANCELLED(access_denied) 또는 PROVIDER_ERROR
  ├─ nonce: 없음 → NO_PENDING_LOGIN, 10분 초과 → LOGIN_EXPIRED, 불일치(상수 시간 비교) → STATE_MISMATCH  ※ 토큰 요청 전
  ├─ exchangeCodeForSession(code): verifier 없음 → CALLBACK_NOT_FOR_THIS_BROWSER, 거부 → CODE_REJECTED, 장애 → AUTH_UNAVAILABLE
  └─ getUser()로 서버 확인 → id가 교환 결과와 다르면 로컬 로그아웃(IDENTITY_MISMATCH) → 내 차량
```

- **client 설정:** `flowType:'pkce'`, `detectSessionInUrl:false`(nonce 검사 뒤에 직접 교환하려고), `persistSession:true`, `autoRefreshToken:true`, `storageKey:'carscope-account-auth'`.
- **OAuth state:** Google과의 `state`는 Supabase Auth 서버가 처리한다. 앱이 무엇을 검증해야 하는지는 문서에 **NOT_STATED**다. 그래서 PKCE(코드는 이 브라우저의 verifier 없이는 쓸 수 없음) 위에 CarScope nonce를 더했다. 로그인 CSRF·콜백 주입·재사용을 네트워크 호출 전에 막는다.
- **콜백 재사용:** nonce는 첫 콜백에서 지워진다. 같은 탭에서 새 nonce로 옛 코드를 다시 보내도 verifier가 없고 서버가 사용된 코드를 거부한다(모의 서버는 404 `flow_state_not_found`. 실제 GoTrue의 재사용 오류 형식은 문서상 NOT_STATED).
- **복구·새로고침:** `getSession()`은 저장소 값만 읽으므로 신원으로 쓰지 않는다. 화면은 `getUser()`가 성공한 뒤에만 사용자를 보여 준다. 위조 서명 토큰을 저장소에 넣으면 로그인 상태가 되지 않는다(테스트).
- **토큰 갱신:** supabase-js가 만료 전에 회전 갱신한다. 갱신 실패(폐기된 refresh token)면 세션을 지우고 로그아웃 화면이 된다.
- **만료·폐기:** 서버가 세션을 거부하면(`/user` 401/403) 로컬 세션을 지우고 "로그인이 만료되었습니다". 로그아웃으로 폐기된 세션을 저장소에서 되살려도 거부된다(브라우저 테스트).
- **인증 서버 장애:** `AUTH_UNAVAILABLE`. 세션은 지우지 않지만 확인 전에는 아무 계정 데이터도 보여 주지 않고 "다시 확인"을 제공한다.
- **로그아웃:** 화면의 계정 데이터를 **동기적으로 먼저** 지우고(세대 값 증가) 그다음 `signOut({scope:'local'})`. 서버 호출이 실패해도 로컬 세션은 지운다.
- **계정 전환:** 다른 사용자 id가 들어오면(같은 탭·다른 탭·재로그인) 이전 계정의 목록·프로필·폼을 즉시 지우고, 이전 계정으로 시작한 응답은 세대 값이 달라 버린다(`STALE_IDENTITY`). "다른 Google 계정으로 로그인"은 로그아웃 후 `prompt=select_account`로 시작한다.
- **시스템 브라우저:** Google 로그인은 일반 브라우저에서만 연다. Pleos Android WebView는 이 화면을 싣지 않고, 이동을 모두 막으며, 페이지도 WebView UA에서는 시작하지 않는다.

## 5. 데이터베이스

`carscope_account` (마이그레이션 `20261113000000_p15_account_vehicles.sql`, 한 트랜잭션, 재실행 시 `create schema`에서 멈춤)

| 테이블 | 열 | 비고 |
|---|---|---|
| `profiles` | `id`(= `auth.users.id`, PK, cascade), `display_name`(≤80), `avatar_url`(https, ≤2048), `created_at`, `updated_at` | 이메일은 저장하지 않는다(`auth.users`에만 있음). 첫 로그인 때 본인이 만든다 |
| `vehicles` | `id`, `owner_id`(기본값 `auth.uid()`), `manufacturer`, `model`, `model_year`, `nickname`, `verification_status`(기본 `SELF_REPORTED_UNVERIFIED` \| `OEM_VERIFIED`), `verified_at`, `verification_provider`, 시각 | CHECK: 미검증이면 검증 시각·출처가 없고, 검증이면 둘 다 있다. 계정당 20대(advisory lock으로 동시 요청 직렬화) |
| `vehicle_inspection_links` | `vehicle_id`+`owner_id`(복합 FK로 같은 소유자만), `record_namespace`(**`VERIFIED_VEHICLE`만**), `record_id`, `evidence`(`OWNER_VERIFIED_RECORD`), `linked_at` | 구조만. API 역할은 읽기만 가능. `carscope` 스키마로의 FK 없음, 자동 이전 없음 |

### 권한과 RLS

- 스키마 USAGE: `authenticated`만. `anon`, `service_role`, `PUBLIC`은 테이블·열·함수 권한 0(시작할 때 전부 회수 후 필요한 것만 부여).
- `authenticated`: 세 테이블 SELECT, `vehicles` DELETE, `vehicles` INSERT/UPDATE는 `manufacturer, model, model_year, nickname` 열만, `profiles` INSERT는 `id, display_name, avatar_url`, UPDATE는 `display_name, avatar_url`만.
  → `owner_id`와 검증 열은 API로 쓸 수 없다(42501). 트리거가 한 번 더 막는다(권한이 실수로 넓어져도 소유자 이동·검증 승격 불가).
- 정책 8개, 모두 `to authenticated`, 조건은 `(select auth.uid()) = owner_id`(또는 `= id`). UPDATE는 USING과 WITH CHECK 둘 다. `user_metadata`·`app_metadata`를 쓰지 않는다.
- SECURITY DEFINER 함수 없음. 트리거 함수 2개는 `security invoker`, `search_path=''`, API 역할 EXECUTE 없음. 뷰 없음.
- 검증 상태 승격(`OEM_VERIFIED`)은 미래의 별도 서버 역할이 필요하다. 지금은 그런 역할도 경로도 없다. `service_role`에도 권한을 주지 않았다.
- **Data API 노출:** RLS와 별개로, 운영자가 `carscope_account`를 Exposed schemas에 **추가해야** 브라우저가 쓸 수 있다. `carscope`는 계속 노출하지 않는다.

## 6. 인증 경계

| 신원 | 증명하는 것 | 이번 PR |
|---|---|---|
| Google / Supabase Auth | CarScope 사용자(사람) | 신규. 내 차량 화면과 `carscope_account`에만 쓰인다 |
| AVD Enrollment | 등록된 시뮬레이터 | 변경 없음. 사용자·차량 소유가 아니다 |
| QR Receiver Token | 스마트폰 점검 세션 | 변경 없음. QR에 사용자 id·Supabase 토큰을 넣지 않는다 |
| Pleos SDK Permission | 차량 내부 읽기 권한 | 변경 없음 |
| Hyundai Developers OAuth | 별도 현대차 계정과 데이터 제공 동의 | 변경 없음(BLOCKED). Google 토큰과 섞지 않는다 |

- 로그인했다고 기존 QR·AVD 점검 기록을 그 사용자 것으로 보지 않는다. 계정 화면은 기록을 조회하지 않는다.
- Supabase 토큰은 URL·QR·로그·콘솔·페이지 상태에 나오지 않는다(흐름 테스트에서 console 가로채기, 브라우저 테스트에서 URL·console 검사).

## 7. P14 외부 API 연결 준비

- `createSupabaseIdentityVerifier`: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`만 읽는다(리다이렉트 거부, 5초, 64 KiB). ES256/RS256만, `kid` 필수, `jku`·`jwk`·`x5u`·`crit` 거부, 개인키·대칭키 JWK는 가져오지 않는다. 서명 확인 뒤 `iss`, `aud=authenticated`, `role=authenticated`, `is_anonymous≠true`, `exp`, `nbf`/`iat`(30초 허용), `sub`(UUID)를 본다. 알 수 없는 `kid`는 30초에 한 번만 다시 받는다. JWKS 장애는 `AUTH_UNAVAILABLE`로 "잘못된 토큰"과 구분한다.
- 대칭 키(HS256, 레거시 JWT secret) 프로젝트는 지원하지 않는다. 비밀을 서버에 두지 않으려는 선택이다. 운영 프로젝트의 서명 키 종류는 **NOT_VERIFIED**(문서상 새 프로젝트 기본은 비대칭).
- `carscopeSessionKey(identity, {salt})`: 이 프로세스의 검증기가 만든 객체만 받아 `csu_` + HMAC-SHA256(salt, issuer, sub)를 돌려준다. Supabase UUID가 provider 코드로 가지 않는다.
- Google 로그인만으로는 아무것도 열리지 않는다: 기본 가용성은 두 provider 모두 DISABLED, 테스트 모드 서비스도 provider 로그인·동의·소유자 확인 바인딩 없이 `NO_OWNER_CONFIRMED_BINDING`을 돌려주고 provider를 호출하지 않는다(테스트).
- 이 모듈을 import하는 진입점과 라우트는 없다.

## 8. 개인정보·자격 증명 검토

| 항목 | 처리 |
|---|---|
| 받는 정보 | Google 기본 범위(이메일, 프로필). 이메일은 화면 표시용이며 계정 테이블에 저장하지 않는다 |
| 저장하는 정보 | 표시 이름, 프로필 사진 URL(https만), 차량 4개 필드. VIN·번호판·위치 없음 |
| 브라우저 키 | URL과 publishable key(`sb_publishable_…`, 레거시 anon JWT 허용)만. `sb_secret_…`·`service_role` JWT는 서버와 페이지 모두 거부하고 내보내지 않는다. 서버는 비밀 환경변수를 읽지 않는다 |
| Google Client Secret | Supabase 대시보드 Provider 설정에만. 저장소의 `config.toml`은 `env(...)` 치환만 쓰며 로컬 기본값은 꺼짐 |
| 토큰 위치 | supabase-js 기본대로 `localStorage`(`carscope-account-auth`). 세션 유지에 필요하다. XSS가 곧 토큰 탈취이므로 CSP를 엄격히 했다 |
| HTTP 헤더 | CSP `default-src 'none'; script-src 'self'; connect-src 'self' <Supabase>; img-src 'self' https://lh3.googleusercontent.com; frame-ancestors 'none'; form-action 'none'`, `Referrer-Policy: no-referrer`(콜백 code가 Referer로 새지 않게), `nosniff`, COOP, `no-store` |
| DOM | 모든 사용자 값은 `textContent`. `innerHTML`·`eval` 없음(정적 테스트) |
| 로그 | 계정 패키지 코드에 `console` 없음. 오류 문구는 코드값만 쓴다 |
| 커밋 | 서명 키는 `supabase/.temp`(gitignore), 증거는 저장소 밖 `C:\CarScope-External\p15-auth`. 로컬 스택의 키는 기록하지 않았다 |
| 남은 위험 | 로컬 저장소 토큰은 같은 출처의 스크립트에 노출된다(문서상 일반적 SPA 방식). 같은 출처에 다른 앱을 두지 않아야 한다 |

## 9. 운영자 설정 (각 단계 별도 승인)

이 PR은 아래 어떤 것도 실행하지 않았다.

### 9.1 Google Cloud

1. Google Auth Platform에서 OAuth 클라이언트(웹 애플리케이션)를 만든다.
2. Authorized JavaScript origins: 계정 화면을 서비스할 origin(예: `https://<account host>`). 개발 중에는 `http://127.0.0.1:8097`을 넣고 운영에서는 뺀다.
3. Authorized redirect URIs: 운영 프로젝트의 Supabase 콜백 URL(대시보드 Google Provider 화면에 나오는 `…/auth/v1/callback`).
4. 동의 화면: 범위는 `openid`, 이메일, 프로필. 앱 이름·개인정보 처리방침 URL.

### 9.2 Supabase 대시보드 (운영 프로젝트, ref 대조 후)

| 설정 | 값 |
|---|---|
| Authentication → Providers → Google | Enable, Client ID, Client Secret(여기에만), Skip nonce check **끔** |
| Authentication → URL Configuration → Site URL | `https://<account host>/account/` |
| Redirect URLs | `https://<account host>/account/callback.html*` — 허용 목록은 query까지 비교하고 `*`는 `.`·`/`가 없는 문자열과 맞는다. nonce는 base64url이라 맞는다 |
| Data API → Exposed schemas | `carscope_account` **추가**. `carscope`는 추가하지 않는다 |
| JWT Signing Keys | 비대칭(ES256 또는 RS256)인지 확인. 대칭이면 서버 검증 모듈이 거부한다 |
| Anonymous sign-ins | 꺼짐 유지 |
| API Keys | 브라우저에는 publishable key. secret key는 이 기능에 필요 없다 |

### 9.3 마이그레이션 적용 (운영 DB 쓰기, 별도 승인)

```powershell
# 관리자 연결. 프로젝트 ref를 대시보드와 대조한 뒤. carscope_account가 없어야 한다.
psql "<admin connection, sslmode=verify-full>" --single-transaction -v ON_ERROR_STOP=1 -f tools\carscope-account\supabase\migrations\20261113000000_p15_account_vehicles.sql
psql "<admin connection>" -v ON_ERROR_STOP=1 -f tools\carscope-account\supabase\operator\verify-account-schema.sql
```

- 확인 SQL은 10줄 모두 `t`여야 한다. 읽기 전용 트랜잭션이며 마지막에 rollback한다.
- `carscope`·`carscope_private`를 건드리는 문장이 없다. `supabase db push`로 프로젝트를 연결하지 않는다(로컬 `config.toml`이 운영 설정을 덮어쓰지 않게).
- 되돌리기는 `drop schema carscope_account cascade`이며 **사용자 데이터 삭제**에 해당하므로 별도 승인.

### 9.4 화면 실행

```powershell
cd tools\carscope-account
npm ci --ignore-scripts
$env:SUPABASE_URL = 'https://<ref>.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = '<sb_publishable_...>'
$env:CARSCOPE_TRIAL_URL = 'http://127.0.0.1:8095/inspect.html'   # 체험 링크
npm run serve    # http://127.0.0.1:8097/account/
```

변수가 없으면 "로그인이 설정되어 있지 않습니다"를 보여 주고 체험 링크만 동작한다. 운영 호스팅(도메인·TLS·배포 대상)은 정해지지 않았다.

### 9.5 로컬 Supabase 스택으로 재현

```powershell
cd tools\carscope-account
npx supabase@3.1.0 gen signing-key --algorithm ES256   # 출력을 supabase\.temp\signing_keys.json에 배열로 저장(다른 폴더에서 실행)
npx supabase@3.1.0 start -x realtime,storage-api,imgproxy,studio,postgres-meta,mailpit,logflare,vector,supavisor,edge-runtime
npx supabase@3.1.0 status -o env                       # API_URL, PUBLISHABLE_KEY, DB_URL
$env:CARSCOPE_LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:CARSCOPE_LOCAL_SUPABASE_PUBLISHABLE_KEY = '<local publishable key>'
$env:CARSCOPE_LOCAL_SUPABASE_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run test:rls
$env:CARSCOPE_EVIDENCE_DIR = 'C:\CarScope-External\p15-auth'; npm run test:browser
npx supabase@3.1.0 stop --no-backup
```

RLS 테스트는 loopback이 아닌 URL을 거부한다.

## 10. 검증

결과와 명령은 [증거 인덱스](evidence/p15-auth/README.md)에 있다.

## 11. 한계와 남은 일

- **Google 실로그인 미확인:** 실제 Google 동의 화면, 취소 시 Supabase가 붙이는 오류 파라미터 형식, `redirect_to`에 query가 있을 때 code가 붙는 모양은 모의 서버 기준이다. 운영 설정 후 LIVE로 다시 확인해야 한다.
- **운영 Data API 기본 권한:** 문서상 기존 프로젝트는 `public`의 새 객체에 기본 권한을 준다. 이 마이그레이션은 자기 스키마에서 전부 회수 후 부여하지만, 운영 프로젝트의 이벤트 트리거·기본 권한은 확인하지 못했다. 적용 직후 확인 SQL이 필요하다.
- **세션 저장 위치:** localStorage. 쿠키 기반 SSR로 바꾸려면 서버 런타임이 필요하다.
- **차량 수 제한 20:** CarScope 자체 값이다.
- **연결 테이블:** 쓰는 경로가 없다. `VERIFIED_VEHICLE` 기록을 만드는 소유자 authority는 [P8-A2](p8-a2-history-auth.md)의 BLOCKED 조건을 그대로 따른다.
- **3D 화면 진입점:** 체험 화면에서 내 차량으로 가는 링크는 넣지 않았다. Android WebView에서 Google 로그인으로 이어지지 않게 하려는 것이며, 브라우저용 진입점은 화면 호스팅이 정해진 뒤 별도 과제다.
- **계정 삭제:** 화면에 없다. `auth.users` 삭제 시 cascade로 프로필·차량이 지워진다(운영자 작업).
