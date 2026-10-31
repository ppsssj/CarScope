# QR-AR — 보호된 HTTPS 스테이징과 스마트폰 인계

2026-10-31. 판정: **`AR012_READY_FOR_MANUAL_TEST`**. 실제 HTTPS 배포와 QR 주소 일치를 확인했으며, 실제 스마트폰의 카메라·오버레이는 사용자 검증 대기(`NOT_RUN`)다. PR #18은 Draft를 유지한다.

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
| 새 회귀 | PASS: `npm run check`; Node 15/15(기존 12+정적 빌드 3); 합성 브라우저 11개 그룹 |
| 정적 배포 빌드 | PASS: Vercel READY, 출력 생성·배포 완료 로그, 실제 `/build-info.json`의 소스 SHA 일치 |
| 로컬 CLI 재현 | PASS: `npm run build:staging`의 QR/handoff/build-info가 실제 HTTPS 응답과 바이트 단위로 동일 |
| 인증 HTTP | PASS: 페이지·handoff·QR·6개 공개 파일/메타데이터 HTTP 200, 원본 6개 파일과 정확히 일치 |
| QR | PASS: 실제 HTTPS에서 받은 SVG를 PNG로 렌더하고 독립 jsQR로 디코딩. 위 실제 배포 origin + 정확한 작업 fragment와 일치 |
| 응답 정책 | PASS: 실제 CSP·카메라 self/마이크 차단·no-store·nosniff·no-referrer·noindex 헤더 확인 |
| 미인증 차단 | PASS: `/`, `/handoff.json`, `/qr.svg`, `/app.mjs`가 Vercel 로그인으로 302. 두 별칭과 원 배포 URL도 일시 검사 권한 정리 후 로그인으로 302, 앱 본문 없음 |
| 브라우저 UI 자동제어 | NOT_RUN: Computer Use가 Windows 브라우저 URL을 충분히 식별하지 못해 중단. 다른 UI 제어로 우회하지 않음. 배포 검증은 인증 HTTP/소스 대조/QR 렌더·디코드로 수행 |
| 실제 폰·성능 | NOT_RUN: 사용자 직접 실행 대기. 합성 브라우저 PASS를 실기기 결과로 대체하지 않음 |

연결 도구의 자동 인증 fetch는 새 팀 배포를 찾지 못했다. 대신 팀 ID를 지정한 API로 **15분짜리 일시 검사 권한**을 발급해 HTTP 응답을 확인한 뒤 폐기했다. 진단 중 출력된 첫 일시 권한도 즉시 폐기·교체했으며, 사용한 권한을 모두 폐기하고 메모리 참조를 지웠다. 일시 권한/쿠키는 QR·Git·사용자 링크·공유 문서에 넣지 않았다. 영구 automation bypass나 무인증 예외는 만들지 않았다. 사용자 테스트는 일반 Vercel 로그인 경로만 이용한다.

빌드 로그의 기존 `engines >=22` 향후 자동 major 선택 경고와 플랫폼 npm `cache-dir` 경고는 빌드 실패가 아니었다. 향후 Node major 변경 시 재검증이 필요하다. 현재 프로젝트 설정 `22.x`와 로컬 Node 22.16.0의 검증 범위를 구분한다.

## 사용자 스마트폰 테스트

1. PC에서 위 QR 작업 연결 URL을 열고 Vercel 소유자 계정으로 직접 로그인한다. 화면 아래 QR을 표시한다. 또는 외부 증거 폴더의 `deployed-qr.png`를 PC에서 열어 스캔한다.
2. 폰의 기본 카메라로 스캔해 Android **Chrome** 또는 iPhone **Safari**에서 연다. 폰에서도 동일하게 Vercel 로그인이 필요하다. 로그인 완료 후 원래 작업 링크를 다시 열어 “QR 작업 수신: 워셔액 안내”를 확인한다.
3. **카메라 시작** → 카메라 권한 허용 → 실제 후면 렌즈를 가려 후면 영상인지 확인한다. 마이크 권한은 요청하지 않아야 한다.
4. 일반 파란색 물체를 비추고 “후보 · 미검증” box의 위치·이동 갱신을 확인한다. 물체를 치워 box와 잔상이 사라지는지 관찰한다. 색상 후보 성공을 주입구 인식 성공으로 기록하지 않는다.
5. 세로↔가로 전환, 중지 후 카메라 indicator/box 정리, 명시적 재시작, 앱 전환/복귀 시 자동 재시작 없음, 권한 거부 후 수동 안내를 확인한다. 권한 요청 재시험은 해당 사이트 권한만 조정한다.
6. 기종·OS·브라우저 버전, 항목별 PASS/FAIL/NOT_RUN, 관측한 지연/정지/오류를 전달한다. 실제 수행하지 못한 항목은 NOT_RUN이다. 비밀번호·OTP·토큰은 전달하지 않는다.

| 실제 폰 항목 | Android Chrome | iPhone Safari |
| --- | --- | --- |
| QR 스캔·HTTPS 로드·작업 표시 | NOT_RUN | NOT_RUN |
| 카메라 권한·실제 후면 영상 | NOT_RUN | NOT_RUN |
| 파란 후보·카메라 이동·대상 소실 | NOT_RUN | NOT_RUN |
| 화면 비율/box 정합·회전·지연/정지 | NOT_RUN | NOT_RUN |
| 중지/자원 해제·재시작·앱 전환/복귀 | NOT_RUN | NOT_RUN |
| 권한 거부·수동 안내 | NOT_RUN | NOT_RUN |

최소 한 물리 기기의 실제 결과가 확인되기 전 Draft 해제나 병합을 제안하지 않는다. 자동 병합하지 않는다.

## 외부 증거와 원격 리소스 수명

`C:\CarScope-External\qr-ar-01\https-staging\`에 이번 결과를 보관한다: `syntax.txt`, `node-tests.txt`, `browser.txt`와 합성 캡처, `build-tests/` 합성 정적 출력, `local-build.txt`/`local-build/`, `authenticated-http.json`, `unauthenticated.json`, `protection-after-revoke.json`, 실제 배포의 `deployed-*` 파일/QR PNG, `deployment-verification.json`, `remote-resources.json`, 최신 `ci-after.json`과 최종 요약. 사용자 폰 결과는 별도 실행 폴더/기록으로 구분한다. 원본 로그·캡처·빌드 산출물은 Git에 포함하지 않는다.

전용 프로젝트와 보호된 배포는 사용자 수동 테스트를 위해 유지한다. 로컬 Node 서버·Tailscale 서비스/Serve·방화벽/DNS/VPN 변경은 이번 방식에서 만들지 않았다. 테스트 종료 후에는 **이 전용 프로젝트/배포만** 비활성화·삭제 대상으로 검토하고, 별칭의 인증 보호를 해제해 종료하지 않는다. 다른 서비스는 변경하지 않는다.
