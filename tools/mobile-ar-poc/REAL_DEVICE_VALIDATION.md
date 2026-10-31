# QR-AR-01.1 — 실제 스마트폰 검증 준비와 실행 기록

2026-10-31 / PR [#18](https://github.com/ppsssj/CarScope/pull/18), **Draft 유지**. 검증 시작 HEAD: `9e402131bc83709adfa714974b5aec6de16fdc0f`. 이번 변경은 검증 문서뿐이며 기존 구현을 재작성하지 않았다.

## 이번 실행 결과

| 보고 항목 | 결과 | 근거와 제한 |
| --- | --- | --- |
| Android Chrome 실제 기기 | NOT_RUN | `adb devices -l`에는 기존 Pleos 에뮬레이터만 있음. 물리 기기 제어 경로 없음. 에뮬레이터는 조작하지 않음 |
| iPhone Safari 실제 기기 | NOT_RUN | 연결/제어 가능한 iPhone 없음. Windows PnP 조회에서도 해당 장치가 확인되지 않음 |
| QR→페이지→권한→후면 영상 end-to-end | NOT_RUN | 폰과 신뢰되는 실제 HTTPS 경로 미준비. desktop 합성 검증으로 대체 판정하지 않음 |
| 실제 워셔액 캡 사진 | DATA_INSUFFICIENT | 사용 권한과 정답 라벨이 확인된 양성 0장, 음성 0장. 기존 합성 테스트 캡처만 있음 |
| 실물 사진 오탐/미탐·IoU | NOT_RUN | 계산할 허가된 실물 자료 없음. 값은 0%가 아니라 미측정 |
| 알려진 오탐 | 재현됨 — 합성만 | 일반 파란 사각형도 후보로 반환. 새 Node/브라우저 회귀에서 재현. 실물 주입구 인식 성공이 아님 |
| 스마트폰 성능·발열·배터리 | NOT_RUN | 실제 폰 미측정. 250ms 주기는 설정값이며 측정 latency/FPS가 아님 |
| 기존 Node 회귀 | PASS | `npm run check`, `npm test` 12/12 |
| 기존 합성 브라우저 회귀 | PASS | `npm run test:browser`, Edge 156.0.4314.50, 11개 assertion 그룹. 실제 권한/카메라 사용 아님 |
| CLI 실행·접근 경계 | PASS — PC loopback만 | 기존 `node server.mjs`, `127.0.0.1:4181`만 listen, 페이지 HTTP 200, handoff `configured=false/url=null`. 종료 후 listener 없음 |
| TLS 설정 오류 경로 | PASS | cert 경로만 설정하고 key를 비우면 `Set both POC_TLS_CERT and POC_TLS_KEY`로 비정상 종료, listen 전 거부. TLS 연결 성공 검증은 아님 |
| 기존 HEAD CI | PASS | 아래 4개 완료. 실패가 없어 실패 원인 분석/수정 대상 없음 |

기존 HEAD의 CI: [Geometry](https://github.com/ppsssj/CarScope/actions/runs/41206086971), [Identity probe](https://github.com/ppsssj/CarScope/actions/runs/41206086976), [JVM](https://github.com/ppsssj/CarScope/actions/runs/41206086978), GitGuardian 모두 SUCCESS. 각 job의 범위에만 유효하며 모바일 테스트를 실행하는 CI는 아니다. 문서 커밋 이후 최신 결과는 PR Checks에서 별도로 확인한다.

차단 요소: 테스트용 실제 Android/iPhone, 테스트 주체가 신뢰하는 HTTPS 주소와 접근 정책, 사용 권한을 확인한 실물 사진과 정답 라벨. 무인증 공개 배포, 인증서 경고 우회, 신규 CA 강제 설치, 방화벽 변경은 수행하지 않았다. 기존 앱·SDK·Geometry·다른 worktree도 변경하지 않았다.

## 외부 기록 폴더

`C:\CarScope-External\qr-ar-01\qr-ar-01.1\`에 이번 원본 결과와 아래 빈 평가 양식을 준비했다. Git에는 이 문서의 인덱스만 포함한다. 새 기기 실행 때는 별도 run 하위 폴더에 양식을 복사해 이전 결과를 덮어쓰지 않는다.

| 파일 | 내용 |
| --- | --- |
| `ci-before.json` | 시작 HEAD의 최종 CI 4개 SUCCESS 스냅샷 |
| `adb-devices.txt` | 읽기 전용 장치 목록, 에뮬레이터만 있음 |
| `syntax.txt`, `node-tests.txt` | 새 문법/Node 회귀 결과 |
| `browser.txt`, `browser/browser-results.json` | 새 합성 브라우저 결과와 기존 테스트의 캡처 |
| `local-access.json`, `local-cleanup.json` | PC loopback CLI smoke 및 종료 확인 |
| `tls-partial-config.txt` | 불완전한 TLS 설정의 예상 거부 로그 |
| `device-results.csv` | Android Chrome/iPhone Safari × 9개 시나리오, 전부 NOT_RUN. 기기·OS·버전·관측·증거·시간 입력 칸 |
| `photo-evaluation.json` | DATA_INSUFFICIENT, 허가된 실제 사진 수 0/0 |
| `photo-labels.csv` | 사용 권한/촬영 조건/정답·후보 box/IoU/FP·FN 기록용 헤더만 있음 |
| `performance.csv` | 기기·실행·측정값·방법·근거 기록용 헤더만 있음 |

## 신뢰되는 모바일 HTTPS 접근 준비

현재 준비한 것은 기존 loopback 서버의 실행 검증과 아래 설정 절차다. 폰에서 도달 가능한 서비스가 이미 떠 있다고 주장하지 않는다. 기존의 직접 TLS 방식은 유효한 인증서·키·도메인이 있을 때만 사용할 수 있고, 현재 인증서가 없으므로 실행하지 않았다.

### 경로 A: 테스트 계정/기기로 제한한 사설 HTTPS 프록시

기존에 관리자가 승인한 Tailscale 환경이 있다면 PC와 폰을 같은 tailnet에 연결하고, 접근 정책을 **지정 테스트 계정/기기 → 이 PC의 TCP 443**으로 한정한다. tailnet 기본 허용 정책만으로 지정 테스트 사용자 제한을 검증했다고 판단하지 않는다. 이 PC에는 Tailscale이 없어서 아래 명령은 여기서 실행하지 않았다.

Tailscale Serve는 tailnet 내부용 HTTPS reverse proxy를 제공한다. [공식 Serve 문서](https://tailscale.com/docs/reference/tailscale-cli/serve)와 [테스트 서버 공유 안내](https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-team)를 따른다. 관리자는 MagicDNS·HTTPS 발급 설정 및 실제 grants/ACL을 확인해야 한다. 발급 시 노드 DNS 이름이 공개 인증서 원장에 기록되는 점도 [HTTPS 안내](https://tailscale.com/docs/how-to/set-up-https-certificates)에서 확인한다.

1. PC와 폰의 VPN 로그인, 허용 계정, HTTPS 설정을 준비한다. 외부 인터넷 공개용 Funnel은 사용하지 않는다. 기존 Serve 설정을 먼저 확인하며 다른 서비스의 포트/설정을 덮어쓰지 않는다.

   ```powershell
   tailscale status
   tailscale serve status
   # node DNSName 확인: 주소는 Git이나 공유 로그에 복사하지 않음
   ((tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
   ```

2. PC 터미널 A에서 기존 PoC를 **loopback**에 실행한다. 아래 도메인은 실제 출력된 전체 DNSName으로 치환한다. 이 예시 주소를 QR 성공 증거로 쓰지 않는다.

   ```powershell
   Set-Location C:\dev\CarScope-qr-ar01\tools\mobile-ar-poc
   $env:POC_HOST = '127.0.0.1'
   $env:POC_PORT = '4174'
   $env:POC_BASE_URL = 'https://YOUR-NODE.YOUR-TAILNET.ts.net/'
   # TLS는 사설 프록시에서 종료. 이전 직접 TLS 설정이 남지 않게 함
   $env:POC_TLS_CERT = ''
   $env:POC_TLS_KEY = ''
   npm run serve
   ```

3. PC 터미널 B에서 이번 도구 전용으로 비어 있는 443에만 연결한다. 이미 사용 중이면 중단하고 전용 노드/포트를 준비한다.

   ```powershell
   tailscale serve --https=443 http://127.0.0.1:4174
   # foreground 실행을 유지. 테스트 후 이 터미널에서 Ctrl+C
   ```

4. 허용 PC에서 다음을 실행한다. 시스템 기본 인증서 검증을 유지하고 인증서 오류 시 중단한다. HTTP 200과 정확한 QR 대상은 HTTP 도달성만 확인하며 폰 카메라 성공을 뜻하지 않는다.

   ```powershell
   $pocOrigin = 'https://YOUR-NODE.YOUR-TAILNET.ts.net/'
   (Invoke-WebRequest -UseBasicParsing -Uri $pocOrigin -TimeoutSec 15).StatusCode
   $handoff = Invoke-RestMethod -Uri ($pocOrigin + 'handoff.json') -TimeoutSec 15
   if (-not $handoff.configured -or $handoff.url -ne ($pocOrigin + '#v=1&task=washer-fluid')) {
     throw 'QR handoff target mismatch'
   }
   ```

5. **폰 자체에서도** 경고 없는 동일 HTTPS 주소 로드와 QR 스캔을 확인한다. VPN을 끈 폰 및 로그인하지 않은/정책상 거부된 기기에서는 본문과 `/handoff.json`, `/qr.svg`, `/app.mjs`를 받지 못해야 한다. 허용 폰과 거부 기기 결과를 모두 외부 기록에 남긴다. 다른 기기 접근 제한이 확인되지 않으면 접근 준비는 BLOCKED다.
6. 종료 시 두 foreground 터미널에서 Ctrl+C 후 `tailscale serve status`로 이번 경로가 내려갔는지 확인한다. 남아 있으면 이번에 만든 설정에만 `tailscale serve --https=443 off`를 적용한다. 전체 `reset`은 다른 서비스를 지울 수 있으므로 사용하지 않는다.

### 경로 B: 이미 운영 중인 인증 HTTPS reverse proxy 또는 직접 TLS

사설 VPN이 없으면 기존에 관리되는 HTTPS 프록시/도메인을 사용한다. **테스트 계정 인증·허용 목록·짧은 접근 기간을 전체 경로에 적용하고**, 미로그인 요청은 로그인 페이지/401/403으로 차단한다. QR fragment는 인증 수단이 아니다. `/`, 정적 JS/CSS, QR/config 경로를 모두 보호하고 인증 후 원래 QR fragment가 유지되는지 실제 폰에서 확인한다. 백엔드는 `127.0.0.1:4174`로 두어 proxy 우회를 막는다. 현재 이런 프록시는 제공되지 않아 미실행이다.

직접 TLS가 필요한 경우 기존 README의 `POC_TLS_CERT`/`POC_TLS_KEY` 설정을 사용하되, 폰 OS가 기본 신뢰하는 유효한 체인과 정확한 SAN 도메인이 필요하다. 기존의 `POC_HOST=0.0.0.0` 예시는 모든 인터페이스를 열고 앱 자체에 인증이 없으므로, 접속 제한을 별도 검증하지 않은 공유망/인터넷 환경에서 사용하지 않는다. LAN IP의 일반 HTTP나 PC의 localhost QR은 폰 연결 경로가 아니다. 브라우저 보안 예외, `--ignore-certificate-errors`, TLS 검증 비활성화로 검증을 통과시키지 않는다.

## Android Chrome / iPhone Safari 실행 체크리스트

실행마다 기기 모델, 실제 물리 기기 여부, OS/브라우저 전체 버전, 실행 SHA, origin, 네트워크/접근 정책, 인증서 경고 유무, 카메라 권한 초기값, 세로/가로 해상도를 외부 기록에 남긴다. 개인 계정·기기 serial·실제 주소는 공유 문서에 넣지 않는다. 앱은 사진을 저장하지 않으므로 필요한 화면 증거는 사용 동의를 받고 기기 기능으로 캡처하여 PC의 외부 폴더에만 보관한다.

Android는 기본 QR 카메라/리더의 링크를 **Chrome**에서, iPhone은 카메라의 QR 링크를 **Safari**에서 연다. 인앱 브라우저/다른 브라우저면 해당 결과로 분리한다. [Apple QR 안내](https://support.apple.com/en-euro/guide/iphone/iphe8bda8762/27/ios/27), [Android Chrome 권한 안내](https://support.google.com/chrome/answer/2693767?hl=en&co=GENIE.Platform%3DAndroid)를 참고한다. 권한은 테스트 origin에 대해서만 조정한다.

| # | 동작과 PASS 조건 | Android Chrome 이번 결과 | iPhone Safari 이번 결과 |
| --- | --- | --- | --- |
| 1 QR 스캔 | PC의 실제 설정 QR을 스캔. 지정 HTTPS origin + `#v=1&task=washer-fluid`가 열림. 인증 필요 시 지정 계정으로 로그인 후 fragment 유지. 다른 주소/경고/로그인 루프는 FAIL | NOT_RUN | NOT_RUN |
| 2 페이지 로드 | 경고 없이 로드되고 “QR 작업 수신”, “실물 식별 정확도 미검증”, 수동 안내가 보임. 시작 전 카메라 indicator 없음 | NOT_RUN | NOT_RUN |
| 3 권한 요청 | 해당 사이트의 이전 카메라 허용을 해제/초기화 후 시작 버튼. 카메라 권한 요청 발생, 마이크는 요청하지 않음. 기존 허용 상태로 요청창을 못 본 경우 재시험 전 NOT_RUN | NOT_RUN | NOT_RUN |
| 4 후면 카메라 | 허용 후 실제 후면 장면 표시, 후면 렌즈를 가려 확인. 전면만 나오면 FAIL. `ideal: environment` 요청 자체는 증거 아님 | NOT_RUN | NOT_RUN |
| 5 파란 후보 | 평범한 파란 물체로 기능 시험. 후보 상자/“미검증”과 실제 물체 위치 대응. 위치 어긋남과 오탐 기록. 이 통과는 색상 후보 표시 기능에만 해당 | NOT_RUN | NOT_RUN |
| 6 회전 | 회전 잠금 해제 후 세로→가로→세로. 각 상태의 box 정합/letterbox/텍스트/터치/넘침 확인. 영상이 중단되면 현상 기록, 자동 복구를 추정하지 않음 | NOT_RUN | NOT_RUN |
| 7 물체 소실 | 파란 물체를 프레임 밖으로 제거. 상자가 제거되고 후보 없음 안내. 약 3초 후 수동 안내 문구. 실제 소요 시간과 잔상 기록 | NOT_RUN | NOT_RUN |
| 8 중지·복귀 | 중지 버튼으로 영상·상자·indicator 정리 확인. 다시 시작 후 앱 전환/화면 잠금, 복귀 시 자동 재시작 없음 확인. 명시적 시작으로 다시 영상 사용 가능. 필요 시 OS indicator 종료 시각도 기록 | NOT_RUN | NOT_RUN |
| 9 권한 거부 | 사이트 권한을 다시 초기화하고 시작→거부. 영상·후보 없이 거부 안내와 읽을 수 있는 수동 안내. “수동 안내 보기”로 안내에 이동, 재허용 후 재시도 가능 | NOT_RUN | NOT_RUN |

기능 PASS/FAIL/NOT_RUN을 시나리오마다 따로 기록한다. 앞 단계가 막히면 종속 단계는 NOT_RUN과 차단 이유를 쓴다. 전체 end-to-end PASS는 같은 실기기/실행에서 1–9가 모두 관측된 경우에만 기록하며, 이 경우에도 워셔액 캡 인식의 의미적 정확도를 증명하지 않는다.

권한 재시험은 Chrome의 해당 사이트/카메라 설정과 Safari의 해당 사이트 카메라 권한에서 진행한다. Safari 설정 위치는 iOS 버전에 따라 달라질 수 있으므로 정확한 메뉴명과 초기값을 실행 기록에 남긴다. OS에서 브라우저 카메라 자체를 차단했거나 관리 정책이 있으면 이 사실을 구분한다. 전역 보안 설정을 완화하지 않는다.

## 실제 사진 확보 후 평가 절차

현재는 허가된 실제 사진이 없어 실행하지 않았다. 웹에서 임의 사진을 수집하거나 합성 이미지에 실제 캡 라벨을 붙이지 않는다. 아래 절차를 시작하려면 소유/사용 허가·비식별 처리 조건·정답 확인 수단이 먼저 있어야 한다.

1. 양성: 실제 워셔액 캡과 워셔 기호가 확인되고 해당 차종/연식 설명서로 위치를 대조한 사진. 음성: 실제 파란 비워셔 부품/캡/물체 및 워셔액 캡이 없는 구도. 다른 거리·빛·각도·가림과 파란색 이외의 캡도 포함한다. 흐리거나 정답 불명확한 사진은 UNKNOWN, 평가에서 분리한다.
2. 원본은 외부 `photos/`에 보관하고 `photo-labels.csv`에 허가 근거, 차종/연식, 거리, 조명, 각도와 정답 box를 기록한다. box는 원본의 EXIF 회전 적용 후 기준으로 `x,y,w,h`를 0–1 정규화한다. 튜닝/평가는 차량·촬영 세션 단위로 분리한다.
3. 현재 UI는 live camera용으로 **직접 사진 불러오기/evaluator가 없다**. 실제 자료 확보 후 동일 `public/detector.mjs`에 RGBA 입력을 제공하는 로컬 평가 경로를 별도 검증해야 한다. 가로 320/세로 240 상한으로 종횡비를 유지한 동일 전처리를 사용하고, 원본 좌표로 후보를 대응시킨다. 화면에 띄운 사진을 다시 촬영한 결과를 원본 사진 직접 평가로 보고하지 않는다. 사진이 없는 이번 작업에서는 이 경로를 추가하거나 평가했다고 주장하지 않았다.
4. 고정 IoU 기준 0.5를 평가 전에 기록하고 변경하지 않는다. `IoU = 교집합 면적 / (정답 면적 + 후보 면적 - 교집합 면적)`. 일대일 매칭으로 TP, 남은 후보는 FP, 매칭되지 않은 정답은 FN. 음성의 모든 후보는 FP. 분모가 0인 지표는 N/A로 둔다. 낮은 표본 수는 DATA_INSUFFICIENT로 명시한다.
5. 모든 FP/FN의 사진 ID·조건·후보/정답 box·IoU와 실패 유형을 기록한다. 워셔액 캡 box와 겹친 것은 **후보 위치 매칭**이지 워셔 기호/의미 식별 성공이 아니다. 기존 파란 사각형 오탐은 합성 사례로 별도 유지한다.

## 성능 기록과 재실행

실제 기기에서 권한 응답→첫 영상, 물체 등장→첫 후보, 소실→상자 제거, 중지→indicator 종료 시간을 측정한다. 기기/해상도/측정 도구와 반복별 원시 시간을 기록한 뒤 표본 수·중앙값·p95를 표시한다. 반복 수가 p95를 해석하기에 부족하면 개별 값만 보고한다. 관찰 가능한 발열/프레임 정지와 5분 연속 사용 상태를 기록하되 별도 계측 없는 배터리/온도 수치를 만들지 않는다. 앱 처리 시간과 네트워크 로드 시간은 분리한다. 이 PoC에는 실기기 성능 계측 UI가 없고 이번에는 값을 측정하지 않았다.

기존 회귀 테스트 재실행 (합성 입력):

```powershell
Set-Location C:\dev\CarScope-qr-ar01\tools\mobile-ar-poc
$runDir = 'C:\CarScope-External\qr-ar-01\YOUR-NEW-RUN-ID'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
npm run check 2>&1 | Tee-Object -FilePath (Join-Path $runDir 'syntax.txt')
if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed' }
npm test 2>&1 | Tee-Object -FilePath (Join-Path $runDir 'node-tests.txt')
if ($LASTEXITCODE -ne 0) { throw 'Node tests failed' }
$env:POC_EVIDENCE_DIR = Join-Path $runDir 'browser'
npm run test:browser 2>&1 | Tee-Object -FilePath (Join-Path $runDir 'browser.txt')
if ($LASTEXITCODE -ne 0) { throw 'Synthetic browser tests failed' }
```

최신 CI 확인: `gh pr view 18 --repo ppsssj/CarScope --json isDraft,headRefOid,statusCheckRollup`. 실패가 있으면 해당 run의 `gh run view RUN_ID --repo ppsssj/CarScope --log-failed`를 외부 폴더에 저장하고 변경 범위와 로그를 대조한다. 관련 없는 모듈을 임의로 수정하거나 성공으로 덮어쓰지 않는다. PR은 실기기/실물 데이터 검증과 별개로 Draft를 유지한다.
