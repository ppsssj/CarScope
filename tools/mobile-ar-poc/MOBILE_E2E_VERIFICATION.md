# QR-AR-01.2 — 모바일 End-to-End 검증

2026-10-31. 시작 커밋 `9225bfcbe13e352f3b71421d4001f9884f6c0357`, 기존 [Draft PR #18](https://github.com/ppsssj/CarScope/pull/18).

**현재 판정: `AR012_BLOCKED_HTTPS`.** 안전한 실제 HTTPS 경로를 확보하지 못했다. 설치·로그인·사설 Serve 노출에 대한 사용자 승인을 요청했으며 아직 실행하지 않았다. 실제 스마트폰 제어도 불가능하므로 Android Chrome/iPhone Safari는 모두 NOT_RUN이다. 실행 절차가 있다는 이유로 READY_FOR_MANUAL_TEST나 E2E_VALIDATED로 판정하지 않는다.

`SEMANTIC_RECOGNITION_UNVERIFIED` / `REAL_VEHICLE_DATA_INSUFFICIENT`를 유지한다. 파란색 물체 후보는 워셔액 주입구 의미 식별의 성공이 아니다. ML 학습이나 기존 런타임 변경은 하지 않았다.

## 환경 감사와 접근 방식 선정

- 경로·브랜치는 사용자 지정과 일치하고 local/remote 작업 HEAD는 `9225bfc`였다. 기존 미추적 초안 5개는 보존한다.
- PR #17은 원격 main `142862ffc86d623fa8d1aaf2580180fdfcda65c2`로 병합됐다. 로컬 main은 `e394bdc`이며 자동 merge/rebase하지 않았다. P3-A2.2와 다른 worktree를 수정하지 않았다.
- README, VERIFICATION, REAL_DEVICE_VALIDATION, server, app, camera, detector를 재검토했다. Android/Pleos/Geometry/Three.js는 변경하지 않는다.
- PATH·표준 설치 경로·서비스에서 Tailscale이 없고, cloudflared/ngrok/caddy/Vercel CLI도 발견하지 못했다. 저장소에 Vercel 링크/배포 설정이나 HTTPS 프록시 설정이 없으며 모바일 PoC TLS 폴더도 없다. 443/4174/4181 listener는 감사 시 없었다. 방화벽/DNS는 변경하지 않았다.
- 연결된 Vercel 계정의 프로젝트 목록은 읽기 조회가 가능했다. 조회된 8개 중 CarScope 전용 프로젝트는 없고, 다른 프로젝트를 재사용할 승인도 없으므로 배포하지 않았다. 다른 계정/팀에 환경이 없다고 단정하지 않는다.
- `adb devices -l`에는 기존 Pleos emulator만 있다. 물리 Android/iPhone은 제어할 수 없고 에뮬레이터를 실기기 증거로 사용하지 않았다.

| 방식 | 기존 구현과의 관계 | 현재 실행 가능성/결정 |
| --- | --- | --- |
| Tailscale Serve + loopback Node | URL/QR/카메라 계약 그대로. PC·폰을 사설망으로 연결하고 HTTPS 종료 | 우선 선택. 설치·사용자 로그인·HTTPS 설정과 접근 정책 확인·노출 승인이 필요하여 대기 |
| 기존 승인된 인증 HTTPS 프록시 | loopback Node 앞에서 전체 경로 인증. QR fragment 유지 필요 | 제공된 주소/설정 없음. 사용자가 기존 경로를 제공하면 재사용 검토 |
| Vercel 보호 호스팅 | 신뢰 HTTPS 가능. 현재 Node CLI 서버의 배포 방식·QR origin·접근 보호 설정을 추가 검증해야 함 | 전용 프로젝트/배포 승인 없음. 이번에는 생성/배포하지 않음 |
| LAN HTTP / 자체 서명 인증서 우회 / 무인증 공개 터널 | secure context 또는 접근 제한 조건을 충족하지 못함 | 사용하지 않음 |

Tailscale의 [Windows 설치](https://tailscale.com/docs/install/windows), [Serve](https://tailscale.com/docs/features/tailscale-serve), [CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)를 확인했다. Serve는 사설 tailnet HTTPS 경로를 제공한다. 앱이 영상을 업로드하지 않는 기존 구조는 유지한다. tailnet 가입만으로 최소 접근 권한이 확인된 것은 아니므로 테스트 계정/기기 → 해당 노드 TCP 443으로 정책을 한정하고 허용/거부 기기에서 각각 검증해야 한다. 기존 서비스를 덮어쓰거나 Funnel로 공개하지 않는다.

## 승인 후 실행 명령 — 주소 수동 조립 불필요

다음은 **설치·로그인·사설 Serve 구성 승인을 받은 뒤에만** 실행한다. 현재 실제 HTTPS URL은 없으며 아래 명령을 실행 완료했다고 주장하지 않는다. 정책 관리/인증서 설정의 자세한 확인 항목은 [01.1 문서](REAL_DEVICE_VALIDATION.md#신뢰되는-모바일-https-접근-준비)에 있다.

1. PC와 스마트폰에 공식 Tailscale을 설치하고 사용자가 직접 같은 테스트 tailnet에 로그인한다. 새 계정·유료 플랜을 자동 생성하지 않는다. 관리자가 테스트 기기만 허용하는 정책, MagicDNS와 HTTPS 설정을 확인한다. 인증서 발급에 따른 노드 DNS 이름의 공개 원장 기록도 기존 문서대로 확인한다.
2. PC 터미널 A에서 로그인 상태와 기존 Serve 설정을 확인한 다음 기존 서버를 시작한다. 실제 노드 DNS 이름에서 QR 주소를 자동으로 만든다.

   ```powershell
   Set-Location C:\dev\CarScope-qr-ar01\tools\mobile-ar-poc
   $ts = 'C:\Program Files\Tailscale\tailscale.exe'
   if (-not (Test-Path -LiteralPath $ts)) { throw 'Tailscale installation approval/setup required' }
   $tsState = (& $ts status --json | ConvertFrom-Json)
   if ($LASTEXITCODE -ne 0 -or $tsState.BackendState -ne 'Running') { throw 'User login required' }
   $nodeDns = ([string]$tsState.Self.DNSName).TrimEnd('.')
   if (-not $nodeDns.EndsWith('.ts.net')) { throw 'Tailnet HTTPS DNSName unavailable' }
   & $ts serve status
   # 443을 기존 서비스가 사용 중이면 여기서 중단한다
   $env:POC_BASE_URL = 'https://' + $nodeDns + '/'
   $env:POC_HOST = '127.0.0.1'
   $env:POC_PORT = '4174'
   $env:POC_TLS_CERT = ''
   $env:POC_TLS_KEY = ''
   npm run serve
   ```

3. PC 터미널 B에서 이번 도구에 사용할 443이 비어 있고 노출 승인이 확인된 경우에만 사설 프록시를 실행한다. 기존 Serve 경로가 있으면 덮어쓰지 말고 중단한다. 이 터미널도 실행 상태로 둔다.

   ```powershell
   & 'C:\Program Files\Tailscale\tailscale.exe' serve --https=443 http://127.0.0.1:4174
   ```

4. PC 터미널 C에서 신뢰 HTTPS와 QR 설정을 확인한다. 인증서 검증을 끄거나 무시하지 않는다. PC HTTP 페이지는 QR 표시용이며 폰이 여는 대상은 handoff의 실제 HTTPS 주소다.

   ```powershell
   $ts = 'C:\Program Files\Tailscale\tailscale.exe'
   $state = (& $ts status --json | ConvertFrom-Json)
   $origin = 'https://' + ([string]$state.Self.DNSName).TrimEnd('.') + '/'
   $page = Invoke-WebRequest -UseBasicParsing -Uri $origin -TimeoutSec 15
   $handoff = Invoke-RestMethod -Uri ($origin + 'handoff.json') -TimeoutSec 15
   if ($page.StatusCode -ne 200 -or -not $handoff.configured -or $handoff.url -ne ($origin + '#v=1&task=washer-fluid')) {
     throw 'HTTPS or QR handoff check failed'
   }
   Start-Process 'http://127.0.0.1:4174/'
   ```

5. PC 화면의 생성된 QR을 폰으로 스캔하고 Chrome 또는 Safari에서 연다. 허용된 폰에서 인증서 경고 없이 페이지가 열리는지, tailnet 연결을 끄거나 정책상 거부된 기기에서는 본문·JS·QR/config를 받지 못하는지 기록한다. 이는 접근 준비 확인이며 아직 카메라 E2E 통과가 아니다. 하나라도 실패하면 해당 상태로 기록하고 종속 단계는 NOT_RUN으로 남긴다.
6. 아래 10단계를 같은 물리 기기에서 실행한다. 폰에서만 필요한 작업은 VPN 로그인·QR 스캔·권한 선택·후면 장면/파란 물체 촬영·기기 회전/앱 전환·중지/재시작 확인이다. 계정 비밀번호나 토큰을 Codex/로그/Git에 전달하지 않는다.
7. 종료 시 터미널 B와 A에서 각각 Ctrl+C. `& $ts serve status`로 이번 경로 종료를 확인한다. 남아 있으면 **이번에 만든 전용 경로에만** `& $ts serve --https=443 off`를 적용한다. 전체 Serve reset, 다른 프로세스 종료, 방화벽 변경은 하지 않는다.

## 실제 기기 10단계 결과

외부 `e2e-results.csv`에 플랫폼별 10행을 준비했다. 기기 모델·OS/브라우저 버전·실행 SHA·실제 origin·관측·원본 증거·측정 시간을 기록한다. 실제 주소·계정·원본 캡처는 Git에 넣지 않는다. 최초 목표는 Android 또는 iPhone 한 대의 전체 흐름이며 다른 플랫폼은 따로 유지한다.

| 단계 | 직접 관측할 PASS 조건 | Android Chrome | iPhone Safari |
| --- | --- | --- | --- |
| 1 PC QR 표시 | 실제 허용 HTTPS origin으로 생성된 QR 표시 | NOT_RUN | NOT_RUN |
| 2 폰 스캔 | 물리 폰 QR 리더가 정확한 HTTPS + 작업 fragment를 읽음 | NOT_RUN | NOT_RUN |
| 3 HTTPS 페이지 | 지정 브라우저에서 인증서 경고 없이 로드 | NOT_RUN | NOT_RUN |
| 4 작업 표시 | “QR 작업 수신: 워셔액 안내”·미검증 문구·수동 안내 확인 | NOT_RUN | NOT_RUN |
| 5 카메라 버튼 | 사용자 동작 후 카메라 권한 요청, 마이크 요청 없음 | NOT_RUN | NOT_RUN |
| 6 후면 영상 | 실제 후면 렌즈를 가려 해당 영상인지 확인. ideal 요청만으로 판정하지 않음 | NOT_RUN | NOT_RUN |
| 7 후보 오버레이 | 파란 물체와 후보 box 위치 대응, “미검증” 표시 | NOT_RUN | NOT_RUN |
| 8 카메라 이동 | 이동 중 box가 장면에 따라 갱신. 지연/잔상/프레임 정지 기록 | NOT_RUN | NOT_RUN |
| 9 물체 제거 | 후보 box 제거와 후보 없음 안내. 제거 지연 직접 측정 | NOT_RUN | NOT_RUN |
| 10 중지·수동 안내 | 카메라/box/indicator 정리, 수동 안내 사용 가능 | NOT_RUN | NOT_RUN |

화면 품질은 외부 `camera-quality.csv`로 별도 기록한다. 비율/box 정합, 세로↔가로, overlay 지연, 프레임 정지, 권한 거부, 앱 전환/복귀, 중지 후 자원 해제, 명시적 재시작을 양 플랫폼에서 확인한다. 모두 현재 NOT_RUN이다. 권한을 처음부터 허용한 상태라 요청창을 보지 못했다면 해당 origin의 권한을 초기화한 뒤 재시험한다. 앱/브라우저 전체 보안 설정을 해제하지 않는다.

실기기 결함은 아직 관측하지 못했으므로 새 원인이나 수정 효과를 만들어 보고하지 않는다. 기존 합성 회귀의 box/resize/frozen-frame/denial PASS는 위 실기기 결과를 채우지 않는다. 성능도 아직 NOT_RUN이며 250ms 설정을 측정 latency로 쓰지 않는다.

## 회귀·CI·외부 증거

새 `npm run check` PASS, `npm test` 12/12 PASS, `npm run test:browser` 11개 합성 그룹 PASS. `npm run serve`의 시작을 확인하고 같은 진입점인 `node server.mjs`를 순차 smoke로 검증했다: `127.0.0.1:4174` HTTP 200, QR `configured=false/url=null`, 종료 후 listener 없음. 최초 수동 smoke는 HTTP 조회 완료 전에 서버를 종료한 테스트 순서 오류가 있어 무효 처리했다. 해당 기록의 null 값을 PASS로 인정하지 않고 strict assertion과 소유한 자식 프로세스 종료를 사용하는 외부 smoke에서 재검증했다. 제품 코드 결함/수정으로 보고하지 않는다. 모바일 URL을 꾸며 QR을 생성하지 않았다. 위 PowerShell 3개 블록은 parser 문법 검사만 PASS이며 설치/노출 명령을 실행한 결과가 아니다. 시작 HEAD의 Geometry/Identity probe/JVM/GitGuardian CI는 모두 SUCCESS였다. 이 CI는 모바일 E2E 검증을 포함하지 않는다. 최신 문서 커밋의 Checks는 PR에서 별도로 확인한다. 기존 코드 재작성/새 기능/ML 학습은 하지 않았다.

외부 폴더 `C:\CarScope-External\qr-ar-01\qr-ar-01.2\`:

- `access-audit.json`: 환경 조사, 시작 SHA·원격 main·접근 경로 부재·승인 대기.
- `devices.txt`: 읽기 전용 장치 목록. 물리 스마트폰 없음.
- `syntax.txt`, `node-tests.txt`, `browser.txt`, `browser/browser-results.json`과 캡처: 이번 새 합성 회귀.
- `local-serve.json`, `local-server.txt`, `local-smoke.mjs`: localhost 서버 순차 검증·종료와 재현 스크립트. `local-serve-initial-invalid.json`은 최초 순서 오류의 무효 기록이며 PASS 근거로 사용하지 않는다. `local-cleanup.json`은 최초 서버 종료 확인. `runbook-syntax.json`: 명령 3개 블록의 문법 검사만 PASS.
- `ci-before.json`: 시작 HEAD의 CI 스냅샷. 갱신 후 `ci-after.json`과 PR 본문에 최신 상태를 기록한다.
- `e2e-results.csv`, `camera-quality.csv`: 실제 기기 20행/품질 16행, 모두 NOT_RUN.

실제 HTTPS 경로가 차단된 현재는 Draft 해제/병합을 제안하지 않는다. `AR012_E2E_VALIDATED` 및 테스트·CI 통과 후에만 실험용 PoC의 Draft 해제/병합을 제안할 수 있으며 자동 병합하지 않는다. 다음 최소 작업은 Tailscale 설치·사용자 로그인·사설 Serve 구성 승인 또는 기존 승인된 HTTPS 경로 제공이다. 승인/접근 준비 후 물리 폰 한 대로 10단계를 수행해야 한다.
