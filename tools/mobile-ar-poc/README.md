# QR-AR-01 · 워셔액 주입구 모바일 안내 PoC

**독립 개발 도구 / 실물 탐지 정확도 UNVERIFIED.** QR handoff → 사용자 동작으로 카메라 실행 → 파란색 영역 후보 → 2D 화면 오버레이 → 수동 안내를 구현한다. 학습된 워셔액 주입구 인식 모델, 워셔 기호 OCR, 주입 승인, 차량 위치 추정, WebXR/SLAM이 아니다. 실제 파란색 물체는 오탐할 수 있고 다른 색 캡은 놓친다. 확률·정확도 수치를 출력하지 않는다.

기존 Android 앱·Pleos SDK·vehicle-core·Geometry·Three.js에는 연결하지 않는다. 앱에서 QR을 표시하는 통합도 이번 범위에 없다. PC의 독립 도구 화면에서 QR을 표시하고 스마트폰의 기본 카메라/QR 리더로 연다. release 앱에는 포함하지 않는다.

QR-AR-01.1의 최신 실기기 준비/결과는 [실제 스마트폰 검증 문서](REAL_DEVICE_VALIDATION.md)에 있다. Android Chrome/iPhone Safari 9개 시나리오, 접근 제한이 있는 HTTPS 준비 명령, 실물 사진 평가/성능 기록 절차를 제공한다. 현재 실기기는 NOT_RUN, 실물 사진은 DATA_INSUFFICIENT다.

## 감사와 구현 결정 (2026-10-31)

- 작업 사본 `C:\dev\CarScope-qr-ar01`, 지정 브랜치 `feat/qr-ar-01-washer-fluid-mobile-assist`. 시작 HEAD·main·원격 main: `e394bdc1bb12a1a72699e1c6ce0f92d95ea897b9`. origin: `https://github.com/ppsssj/CarScope.git`. 다른 worktree는 합치지 않는다.
- architecture, roadmap, development-setup, validation-report, pleos-sdk-integration, stale-policy-review, anatomy-visualization, p2-a2-geometry-poc 문서를 확인했다. 기존 main 화면은 정적 SVG/JS 비활성, Three.js는 별도 debug lab이다. QR·카메라 구현이나 검증된 주입구 데이터셋은 발견하지 못했다. 다른 에이전트의 전방 구획 개발은 사용하지 않는다.
- 사용 가능: Node 22.16.0/npm 10.9.2, 브라우저 `getUserMedia`, Canvas 2D. Node 내장 HTTP/TLS 서버와 고정 `qrcode@1.5.4`를 선택했다. 런타임에 CDN·추론 서버·외부 모델이 필요 없다. QR 생성만 서버에서 수행한다.
- [getUserMedia 문서](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): secure context와 사용자 권한이 필요하며 `facingMode`로 후면 카메라를 요청할 수 있다. `ideal: environment`는 후면 선택 보장이 아니다. 실제 카메라 선택은 기기 검증 대상이다.
- [node-qrcode 공식 README](https://github.com/soldair/node-qrcode): SVG 생성 지원. 서버의 신뢰한 설정 주소만 인코딩한다. QR 스캔 자체는 휴대폰 기본 기능에 맡겨 인앱 QR 검출기 의존성을 피한다.
- UI는 기존 `tools/three-poc/index.html`의 시스템 글꼴, `#f4f5f7` 배경, `#233448` 본문, 단순 패널/컨트롤을 따른다. 터치 버튼·줄바꿈·수동 안내와 명확한 미검증 문구를 모바일 작업에 맞춘다. 별도 제품 시각 디자인 작업은 아니다.

계획: ① 작은 버전형 QR 계약·정적 서버 ② 카메라와 취소/종료 수명주기 ③ 후보 baseline과 화면 오버레이 ④ 상시 수동 안내 ⑤ 합성/브라우저 테스트·외부 증거·독립 PR. 구현 및 검증 범위는 [VERIFICATION.md](VERIFICATION.md)에 기록한다.

## 실행

```powershell
Set-Location C:\dev\CarScope-qr-ar01\tools\mobile-ar-poc
npm ci --ignore-scripts
npm run serve
# PC: http://127.0.0.1:4174 (기본 loopback 바인딩, QR 미설정)
```

스마트폰에서는 **폰에서 신뢰되는 HTTPS 인증서와 접근 가능한 주소**가 필요하다. PC의 `localhost`는 폰에서 PC를 가리키지 않으며, LAN IP의 일반 HTTP는 카메라를 사용할 수 없다. 아래는 운영자가 준비한 인증서·DNS를 사용하는 예시다. 인증서 신뢰 설정이나 방화벽/공개 호스팅은 자동으로 바꾸지 않는다. 실제 환경 값으로 치환한다.

```powershell
$env:POC_HOST = '0.0.0.0'
$env:POC_PORT = '4174'
$env:POC_BASE_URL = 'https://YOUR-PC-NAME:4174/'
$env:POC_TLS_CERT = 'C:\CarScope-External\qr-ar-01\tls\cert.pem'
$env:POC_TLS_KEY = 'C:\CarScope-External\qr-ar-01\tls\private.key'
npm run serve
```

또는 신뢰하는 HTTPS reverse proxy 뒤에 기본 loopback 서버를 두고 `POC_BASE_URL`을 해당 HTTPS 루트 주소로 설정한다. 이 서버는 배포·인증·차량 세션 관리 기능을 제공하지 않는다. 키·원본 영상·로그를 Git에 넣지 않는다. TLS 파일은 운영자가 준비한다. TLS 양쪽 경로 중 하나만 설정하면 서버는 시작을 거부한다.

PC 화면 QR을 스캔하고 폰 브라우저에서 주소를 연 다음 **카메라 시작**을 누른다. QR 주소는 `<configured-https-origin>/#v=1&task=washer-fluid`이다. fragment에는 작업 힌트만 있으며 VIN·센서 값·인증 정보·부품 좌표를 담지 않는다. 버전/작업/중복/추가 필드가 맞지 않으면 카메라를 차단한다. 직접 루트 방문은 허용한다. QR 설정이 없으면 QR 미설정 상태를 명시하고 거짓 접속 주소를 생성하지 않는다.

## 탐지·오버레이의 계약과 한계

- 최대 320×240 분석 프레임, 250ms 주기. RGB에서 파란색 조건을 만족하는 픽셀을 4방향 연결 성분으로 묶고 면적·종횡비·채움 비율로 최대 3개를 제안한다. 임계값은 baseline 휴리스틱이며 실차 보정값이 아니다.
- 후보의 `source=blue-component-heuristic`, `verified=false`. 파란색 사각형도 검출하는 알려진 오탐을 회귀 테스트로 명시한다. 성공 상태나 신뢰도 점수는 없다. 캡 색상·형상·표식의 다양성, 조명, 모션 블러, 가림, 복잡한 엔진룸은 검증하지 못했다.
- 원본 영상과 오버레이는 같은 `object-fit: contain` 영역을 사용한다. 정규화 화면 좌표와 letterbox 오프셋을 사용하며 차량 세계 좌표와 관계가 없다. 영상은 미러링하지 않는다. 실제 회전·렌즈·기기별 정합은 미검증이다.
- 후보가 없어지면 다음 분석에서 상자를 지우며, 12회 연속 후보 없음(명목 약 3초)에는 수동 안내 문구를 표시한다. 수동 안내 본문은 처음부터 항상 보인다. 캡의 워셔 기호와 정확한 차종 사용설명서를 직접 확인해야 한다.
- 권한 거부, 장치 부재/사용 중, 미지원·비보안 브라우저, 영상 재생/분석 오류, 트랙 종료에는 수동 안내가 남는다. 수동 전환·중지·pagehide·화면 숨김은 카메라 트랙과 타이머·오버레이를 정리한다. 늦은 권한 응답이 중지된 카메라를 다시 시작하지 않는다. 복귀 시 자동 카메라 재실행은 없다.
- 영상은 기기 메모리에서만 분석한다. 업로드·녹화·원격 분석·저장 기능은 없다. HTTP는 정적 파일 allowlist와 QR 설정/이미지만 제공하며 CSP, camera self, microphone 차단, no-store 헤더를 설정한다.

## 자체 테스트와 외부 증거

```powershell
npm run check
npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\qr-ar-01\YOUR-RUN-ID'
npm run test:browser
```

단위 테스트 데이터는 메모리 안에서 합성한다. 파일로 저장하는 합성 테스트 이미지·스크린샷·원본 결과는 위 외부 경로만 사용한다. 브라우저 테스트는 설치된 Microsoft Edge를 Playwright로 실행한다. Edge가 없으면 NOT AVAILABLE로 기록하고 실제 기기를 테스트한 것처럼 보고하지 않는다. 실행 로그도 같은 외부 run 폴더에 리다이렉트한다. 저장소에는 소스와 요약/증거 인덱스만 둔다.

브라우저 테스트는 `canvas.captureStream()`으로 만든 **합성 입력**과 주입한 거부 오류를 쓴다. 실제 QR SVG 디코딩은 별도 jsQR로 검증한다. 스마트폰 기본 QR 스캐너, 네트워크·HTTPS 인증서, 실제 권한 UI, 실제 후면 카메라 및 워셔액 캡의 정확도 검증을 대체하지 않는다.

## 실제 평가 후속 조건

현재 라벨이 있는 실차 데이터와 스마트폰 검증 결과가 없어 precision/recall, 실물 탐지 성공, QR→폰 카메라 end-to-end 성공을 보고하지 않는다. 다음 평가 때 외부 폴더에 원본과 라벨/결과를 보관한다.

1. 사용 권한을 확보한 여러 차종·캡 색상·폰/브라우저·조명/각도 조건의 양성 및 음성 프레임을 수집한다. 냉각수·브레이크액·일반 파란 부품을 음성 예로 포함한다.
2. 캡의 실제 워셔 기호와 차종 설명서로 ground truth를 확인하고 bounding box와 차종/연식·조건을 라벨링한다. 불명확한 프레임은 UNKNOWN으로 기록한다.
3. 같은 차량/연속 영상이 튜닝과 평가 세트에 섞이지 않게 분리한다. 임계값 변경 전후와 모든 실패/오탐을 보존한다.
4. 평가 세트의 IoU 기준, 후보 precision/recall, false positives/frame, 미탐, 처리 지연과 발열을 측정한다. 후보 위치 지표와 주입구 의미 식별 정확도를 구분한다. 작은 데이터로 제품 사용 가능성을 단정하지 않는다.
5. 실기기에서 QR 스캔→신뢰한 HTTPS→후면 영상→회전/크기 변경→후보/실패→수동 안내→중지/백그라운드/복귀를 직접 검증한다. 모두 통과해도 주입구 자동 확정은 별도 검토 대상이다.
