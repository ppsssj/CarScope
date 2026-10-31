# QR-AR — 보호된 HTTPS 스테이징과 스마트폰 인계

2026-11-01 갱신. 현재 판정: **`AR012_USER_REPORTED_PASS`**. 2026-10-31의 8개 항목과 2026-11-01의 추가 5개 항목(기기·후면 렌즈 확인, 대상 소실, 권한 거부, 회전, 중지·앱 전환/복귀)이 모두 사용자 보고 PASS다. 단, 기종·OS 버전·브라우저 명칭은 아직 전달되지 않아 Android Chrome/iPhone Safari 중 어느 플랫폼의 결과인지 귀속하지 않는다. 워셔액 주입구 의미 인식 정확도는 계속 미검증이다. 이전 판정 `AR012_PARTIAL`(2026-10-31), `AR012_BLOCKED_HTTPS`, `AR012_READY_FOR_MANUAL_TEST`는 이전 단계의 결과다. Draft 해제/병합은 사용자 결정으로 남긴다.

## 실제 접근 주소

- 검증한 배포: https://carscope-qr-ar-staging-59shu9i64-ppsssj-projects.vercel.app/
- QR 작업 연결: https://carscope-qr-ar-staging-59shu9i64-ppsssj-projects.vercel.app/#v=1&task=washer-fluid
- 프로젝트 별칭: https://carscope-qr-ar-staging.vercel.app/ 및 https://carscope-qr-ar-staging-ppsssj-projects.vercel.app/
- 프로젝트: `carscope-qr-ar-staging` / `prj_INDdBXXPy5QFnKbQR92akFYglofT`
- 팀: `ppsssj-projects` / `team_wtn5yu4nUr52ssi9GbLxUFFt`
- 배포: `dpl_B2WgK4MVekTj6m1pSPt7Szd4pW7R`, READY
- 배포 코드: `1328325682a01170365d85b093e8942d15cea22f`. 이후 문서 커밋과 구분한다.

**접근 방식: Vercel Authentication, All Deployments.** PC·스마트폰에서 프로젝트 접근 권한이 있는 Vercel 계정(현재 소유자)으로 직접 로그인한다. 이 문서의 URL과 QR에는 인증 토큰·VIN·사용자 정보가 없다. 익명 방문자가 로그인 화면을 보는 것은 정상이다. 스마트폰에 Tailscale을 설치할 필요가 없고 PC가 꺼져도 접근 가능한 외부 호스팅이다. 인증 후 작업 표시가 “직접 방문”이면 QR 작업 링크를 다시 열어 fragment를 확인한다.

## 방식 선택과 배포 범위

| 방식 | 장점/제약 | 결정 |
| --- | --- | --- |
| Tailscale Serve | 사설 tailnet. PC 상시 실행, PC·폰 VPN 설치/로그인, 방화벽·DNS·접근 정책 점검 필요 | 승인된 대안으로 유지. 이번에는 설치/구성하지 않음 |
| 전용 Vercel 정적 스테이징 | PC와 독립적인 HTTPS. 기존 계정 인증 보호 사용. 폰에서 Vercel 로그인 필요 | 선택·배포 완료 |

팀 연결 재인증 후 새 전용 프로젝트만 생성했다. 기존 Vercel 프로젝트·운영 서비스·기존 Android/Pleos 앱은 배포하지 않았다. 자동 Git 연결도 만들지 않아 다른 브랜치/Geometry 변경이 자동 배포되지 않는다. 명시한 모바일 파일 10개만 업로드했다.

새 프로젝트 생성 시부터 `ssoProtection.deploymentType=all`을 적용하고 재조회한 뒤에만 배포했다. Preview로 요청했으나 첫 배포가 Vercel API상 `production`으로 분류됐다. 이는 이 전용 테스트 프로젝트의 플랫폼 환경 이름이며 기존 제품 서비스의 배포/승격이 아니다. 모든 production/preview/별칭은 동일하게 인증 보호된다. 플랫폼의 [`All Deployments` 인증 보호](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan)를 사용했고 요금제 전환·유료 보호 옵션·도메인 구매·고급 빌드 머신은 요청하지 않았다. 기존 플랜의 사용량 과금 전체가 0이라고 보장하는 것은 아니다.

## 최소 구현 변경

- `staging/build.mjs`: 기존 `public/` 파일 6개를 수정 없이 복사하고 `handoff.json`, `qr.svg`, `build-info.json`을 생성한다. QR origin은 Vercel의 실제 `VERCEL_URL`을 사용한다. 명시적 `POC_BASE_URL`도 같은 계약으로 검증하며, origin 누락/HTTP/인증정보/쿼리/fragment/하위 경로/loopback은 거부한다.
- `vercel.json`: 정적 출력 `build/staging`만 제공하고 기존 CSP·Permissions-Policy·no-store·nosniff·no-referrer와 noindex 헤더를 적용한다. 디렉터리 전체나 미추적 초안/테스트 로그는 업로드하지 않는다.
- `package.json`: `build:staging`과 해당 파일 문법 검사 추가. 의존성 추가 없음. 프로젝트 Node 설정은 `22.x`다.
- 전용 프로젝트의 `POC_SOURCE_REVISION`: 비밀이 아닌 배포 소스 SHA, preview/production에만 설정. 인증 토큰이나 영상용 환경변수는 없다.

카메라·후보 탐지·2D 오버레이·수동 안내 코드는 바뀌지 않았고 배포 응답과 원본 소스가 정확히 일치한다. 업로드 API/서버 함수/저장소는 추가하지 않았다. 브라우저 영상은 계속 기기 메모리에서만 처리한다. `SEMANTIC_RECOGNITION_UNVERIFIED` / `REAL_VEHICLE_DATA_INSUFFICIENT`를 유지한다.

로컬에서 동일 정적 빌드를 재현할 때 (이 명령은 배포/인증 설정을 변경하지 않음):

```powershell
Set-Location C:\dev\CarScope-qr-ar01\tools\mobile-ar-poc
$env:POC_BASE_URL = 'https://carscope-qr-ar-staging-59shu9i64-ppsssj-projects.vercel.app/'
$env:POC_SOURCE_REVISION = '1328325682a01170365d85b093e8942d15cea22f'
$env:POC_STAGING_OUTPUT = 'C:\CarScope-External\qr-ar-01\https-staging\local-build'
npm run build:staging
```

향후 재배포는 이 전용 프로젝트/팀에만 모바일 allowlist 소스를 업로드하고, 새 `VERCEL_URL`로 생성된 QR과 모든 URL의 인증 차단을 재확인한다. 기존 일반 `npm run serve` localhost 경로도 그대로 유지한다.

## PC/배포 검증 결과

| 검사 | 결과와 근거 |
| --- | --- |
| 배포 단계 회귀(기존 근거) | PASS: `npm run check`; Node 15/15(기존 12+정적 빌드 3); 합성 브라우저 11개 그룹. 이번 사용자 관측 반영은 문서만 변경하므로 재실행하지 않음 |
| 정적 배포 빌드 | PASS: Vercel READY, 출력 생성·배포 완료 로그, 실제 `/build-info.json`의 소스 SHA 일치 |
| 로컬 CLI 재현 | PASS: `npm run build:staging`의 QR/handoff/build-info가 실제 HTTPS 응답과 바이트 단위로 동일 |
| 인증 HTTP | PASS: 페이지·handoff·QR·6개 공개 파일/메타데이터 HTTP 200, 원본 6개 파일과 정확히 일치 |
| QR | PASS: 실제 HTTPS에서 받은 SVG를 PNG로 렌더하고 독립 jsQR로 디코딩. 위 실제 배포 origin + 정확한 작업 fragment와 일치 |
| 응답 정책 | PASS: 실제 CSP·카메라 self/마이크 차단·no-store·nosniff·no-referrer·noindex 헤더 확인 |
| 미인증 차단 | PASS: `/`, `/handoff.json`, `/qr.svg`, `/app.mjs`가 Vercel 로그인으로 302. 두 별칭과 원 배포 URL도 일시 검사 권한 정리 후 로그인으로 302, 앱 본문 없음 |
| 브라우저 UI 자동제어 | NOT_RUN: Computer Use가 Windows 브라우저 URL을 충분히 식별하지 못해 중단. 다른 UI 제어로 우회하지 않음. 배포 검증은 인증 HTTP/소스 대조/QR 렌더·디코드로 수행 |
| 실제 폰 기본 흐름 | PASS — 아래 사용자 보고 8개 항목에 한정. Codex 직접 기기 제어/독립 재현 아님 |
| 실기기 성능 계측 | NOT_RUN: 이동 시 따라 움직인다는 정성 관측만 있음. ms/FPS/발열/배터리 측정값 없음 |

연결 도구의 자동 인증 fetch는 새 팀 배포를 찾지 못했다. 대신 팀 ID를 지정한 API로 **15분짜리 일시 검사 권한**을 발급해 HTTP 응답을 확인한 뒤 폐기했다. 진단 중 출력된 첫 일시 권한도 즉시 폐기·교체했으며, 사용한 권한을 모두 폐기하고 메모리 참조를 지웠다. 일시 권한/쿠키는 QR·Git·사용자 링크·공유 문서에 넣지 않았다. 영구 automation bypass나 무인증 예외는 만들지 않았다. 사용자 테스트는 일반 Vercel 로그인 경로만 이용한다.

빌드 로그의 기존 `engines >=22` 향후 자동 major 선택 경고와 플랫폼 npm `cache-dir` 경고는 빌드 실패가 아니었다. 향후 Node major 변경 시 재검증이 필요하다. 현재 프로젝트 설정 `22.x`와 로컬 Node 22.16.0의 검증 범위를 구분한다.

## 사용자 실기기 관측 기록 — 2026-10-31

출처는 사용자가 이 대화로 전달한 실기기 테스트 결과(`USER_REPORTED`)다. 테스트 URL은 위 immutable 배포 주소이며 배포 소스는 `1328325`다. 기종·OS 세부 버전·브라우저 종류/버전은 미확인이다. Android Chrome 또는 iPhone Safari 중 어느 플랫폼인지 추정하지 않는다. 원본 스크린샷 파일은 이번 요청에 첨부되지 않았으므로 아래 사진/화면 설명을 Codex의 이미지 분석 결과로 취급하지 않는다.

촬영 대상은 **PC 모니터에 표시한 워셔액 주입구 사진**이다. 실제 스마트폰 카메라를 사용했지만 실차/실물 캡 직접 촬영이나 권한·라벨을 확인한 원본 사진 데이터셋 평가는 아니다.

| 사용자 수행 항목 | 결과 | 관측 출처/범위 |
| --- | --- | --- |
| HTTPS 페이지 접근 | PASS | 사용자 직접 관측 |
| QR 직접 스캔 후 페이지 진입 | PASS | 사용자 직접 관측 |
| 실제 카메라 영상 표시 | PASS | 사용자 직접 관측. 후면 렌즈인지 별도 확인하지 않음 |
| 파란 후보 Bounding Box 표시 | PASS | 사용자 직접 관측. 모니터 사진의 파란 캡 주변 후보 |
| 카메라 이동 시 box 갱신 | PASS | 사용자 표현상 실시간으로 따라 움직임. 지연 수치/FPS는 측정하지 않음 |
| 카메라 중지 | PASS | 중지 동작의 사용자 관측. OS indicator/track 해제는 별도 미확인 |
| 카메라 재시작 후 정상 복귀 | PASS | 사용자 직접 관측 |
| 수동 안내 보기 | PASS | 사용자 직접 관측. 권한 거부 후 전환 경로를 시험한 것은 아님 |

다른 파란색 영역도 후보로 탐지됐다는 사용자 관측을 **비특이 후보 사례(워셔액 주입구 의미 식별 관점의 오탐)**로 기록한다. 개수·정답 box·IoU가 없어 오탐률/precision/recall을 계산하지 않는다. 사진에 캡 후보가 표시된 것만으로 실제 워셔액 주입구를 인식했다고 판정하지 않는다.

## 사용자 실기기 추가 관측 기록 — 2026-11-01

출처는 사용자가 대화로 전달한 추가 체크리스트 완료 보고(`USER_REPORTED`)다. 위 2026-10-31 기록에서 NOT_RUN/UNVERIFIED였던 경로를 대상으로 한다. 사용자는 기기 정보 확인을 완료했다고 보고했으나 **기종·OS 버전·브라우저 명칭 자체는 전달되지 않았다**. 아래 표에 값을 추정해 넣지 않는다. 스크린샷·로그·측정값은 받지 않았다.

| # | 사용자 수행 항목 | 결과 | 출처/범위 |
| --- | --- | --- | --- |
| 9 | 스마트폰 기종·OS·브라우저 확인 및 후면 렌즈 사용 확인 | PASS | `USER_REPORTED`. 후면 렌즈 사용은 사용자 확인. 기종·OS·브라우저 값은 미전달 |
| 10 | 파란색 대상 제거 후 Bounding Box 소실 | PASS | `USER_REPORTED`. 제거까지 걸린 시간은 측정/전달되지 않음 |
| 11 | 카메라 권한 거부 후 수동 안내 전환 | PASS | `USER_REPORTED` |
| 12 | 세로·가로 회전 후 box 위치 정합 | PASS | `USER_REPORTED`. 정합 오차 수치 없음 |
| 13 | 카메라 중지 후 권한 표시등 소멸, 앱 전환 및 복귀 | PASS | `USER_REPORTED`. 표시등 소멸까지의 시간 미측정 |

같은 기간에 PC에서 다시 실행한 자동 회귀(2026-11-01, PR HEAD `9be1d20` 코드, 합성 입력): `npm run check` PASS, Node `npm test` 15/15 PASS, `npm run test:browser` 11/11 그룹 PASS (Edge 156.0.4314.50, `SYNTHETIC_BROWSER_ONLY`). 원본 출력은 `C:\CarScope-External\qr-ar-01\user-device-2026-11-01\browser\`에 둔다. 자동 회귀는 실기기 결과를 대신하지 않는다.

| 미수행/미확인 항목 | 상태 |
| --- | --- |
| 기종·OS 세부 버전·브라우저 명칭 | NOT_PROVIDED — 사용자 확인 완료 보고는 있으나 값 미전달. Android/iPhone 결과로 귀속하지 않음 |
| 마이크 권한을 요청하지 않음 | 명시적 보고 없음. 앱 코드는 `audio: false`만 요청하고 응답 헤더가 마이크를 차단함(자동 검증 범위) |
| 지연/FPS·발열·배터리 계측 | NOT_RUN |
| 두 번째 플랫폼(Android Chrome과 iPhone Safari 중 나머지) | NOT_RUN — 한 기기 보고만 있음 |
| 실제 워셔액 캡의 의미 인식 정확도 | UNVERIFIED — 촬영 대상은 PC 모니터의 사진, 일반 파란 영역도 후보로 표시됨 |

`SEMANTIC_RECOGNITION_UNVERIFIED` / `REAL_VEHICLE_DATA_INSUFFICIENT`를 유지한다. 현재 기록은 **플랫폼 미상의 한 실제 폰에서 사용자가 체크리스트 13개 항목을 모두 PASS로 보고한 결과**이며, 특정 플랫폼 전체 지원이나 주입구 인식 정확도를 증명하지 않는다.

## 후속 스마트폰 검증 절차

1. PC에서 위 QR 작업 연결 URL을 열고 Vercel 소유자 계정으로 직접 로그인한다. 화면 아래 QR을 표시한다. 또는 외부 증거 폴더의 `deployed-qr.png`를 PC에서 열어 스캔한다.
2. 폰의 기본 카메라로 스캔해 Android **Chrome** 또는 iPhone **Safari**에서 연다. 폰에서도 동일하게 Vercel 로그인이 필요하다. 로그인 완료 후 원래 작업 링크를 다시 열어 “QR 작업 수신: 워셔액 안내”를 확인한다.
3. **카메라 시작** → 카메라 권한 허용 → 실제 후면 렌즈를 가려 후면 영상인지 확인한다. 마이크 권한은 요청하지 않아야 한다.
4. 일반 파란색 물체를 비추고 “후보 · 미검증” box의 위치·이동 갱신을 확인한다. 물체를 치워 box와 잔상이 사라지는지 관찰한다. 색상 후보 성공을 주입구 인식 성공으로 기록하지 않는다.
5. 세로↔가로 전환, 중지 후 카메라 indicator/box 정리, 명시적 재시작, 앱 전환/복귀 시 자동 재시작 없음, 권한 거부 후 수동 안내를 확인한다. 권한 요청 재시험은 해당 사이트 권한만 조정한다.
6. 기종·OS·브라우저 버전, 항목별 PASS/FAIL/NOT_RUN, 관측한 지연/정지/오류를 전달한다. 실제 수행하지 못한 항목은 NOT_RUN이다. 비밀번호·OTP·토큰은 전달하지 않는다.

Android Chrome/iPhone Safari별 검증은 기기/브라우저 정보가 확인될 때 위 사용자 관측과 연결해 기록한다. 현재 두 플랫폼 모두 전체 검증 여부는 미확인이다. 기존 자동 검증 및 미수행 실기기 표를 사용자 PASS로 일괄 채우지 않는다.

## 실험용 PoC 병합 판단

**2026-11-01 재평가: `READY_TO_MERGE` (실험용 PoC 범위, 사용자 승인 조건).** 이전에 병합 보류 사유였던 후면 렌즈, 대상 소실, 권한 거부, 회전, 중지·앱 전환/복귀가 모두 사용자 보고 PASS로 보완됐다. 자동 회귀(문법·Node 15/15·합성 브라우저 11/11)가 다시 통과했고, 최신 `main`(`0842b6b`)과 충돌이 없으며 변경은 `tools/mobile-ar-poc/`에 한정된다.

병합해도 유지되는 제한: 기종·OS·브라우저 명칭 미전달(재현성 기록 보완 필요), 한 기기 보고만 있음, 성능 미측정, 워셔액 주입구 의미 인식 `UNVERIFIED`. 이 PR은 "QR handoff와 색상 후보 표시 PoC"로만 병합하며 실차 인식 기능으로 소개하지 않는다. Draft 해제와 병합은 사용자가 직접 수행한다. 자동 병합이나 임의 Draft 해제는 하지 않는다.

(2026-10-31 이전 판단: 위 경로 미검증으로 Draft 유지·병합 보류.)

## 외부 증거와 원격 리소스 수명

`C:\CarScope-External\qr-ar-01\https-staging\`에 이번 결과를 보관한다: `syntax.txt`, `node-tests.txt`, `browser.txt`와 합성 캡처, `build-tests/` 합성 정적 출력, `local-build.txt`/`local-build/`, `authenticated-http.json`, `unauthenticated.json`, `protection-after-revoke.json`, 실제 배포의 `deployed-*` 파일/QR PNG, `deployment-verification.json`, `remote-resources.json`, 최신 `ci-after.json`과 최종 요약. 사용자 폰 결과는 별도 실행 폴더/기록으로 구분한다. 원본 로그·캡처·빌드 산출물은 Git에 포함하지 않는다.

이번 사용자 보고는 `user-device-2026-10-31/`에 따로 보존한다: `user-report.md`, `observations.json`, `ci-before.json`, `ci-after.json`, `deployment-status.json`, `summary.json`. 스크린샷/실물 사진 원본을 확보하거나 측정한 것처럼 기록하지 않는다. 이전 배포 단계의 NOT_RUN/READY 기록도 덮어쓰지 않는다.

전용 프로젝트와 보호된 배포는 사용자 수동 테스트를 위해 유지한다. 로컬 Node 서버·Tailscale 서비스/Serve·방화벽/DNS/VPN 변경은 이번 방식에서 만들지 않았다. 테스트 종료 후에는 **이 전용 프로젝트/배포만** 비활성화·삭제 대상으로 검토하고, 별칭의 인증 보호를 해제해 종료하지 않는다. 다른 서비스는 변경하지 않는다.
