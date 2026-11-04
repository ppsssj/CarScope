# P7-B 실제 스마트폰 HTTPS 점검 절차

이 코드 revision의 **실제 스마트폰·후면 렌즈·실물 부품·실제 Native 수락은 NOT_RUN**이다. 과거 [HTTPS 스테이징](HTTPS_STAGING.md)의 사용자 PASS는 과거 배포에만 해당하며 이번 17-task 결과로 전용하지 않는다. 테스트할 HTTPS 배포의 `/build-info.json` revision 또는 서버의 운영자 배포 SHA와 이 PR commit을 먼저 대조한다. 최신 코드를 실제 HTTPS에 배포했다는 주장은 하지 않는다.

## A. 카메라/수동 점검만 테스트

PC `http://127.0.0.1` synthetic 테스트는 폰 HTTPS 검증이 아니다. 폰에서 PC의 localhost를 열 수 없으며 LAN HTTP는 일반적으로 카메라 secure context가 아니다. 신뢰하는 HTTPS 인증서/SAN·전체 체인·유효기간·폰 DNS·방화벽/라우팅과 정확한 origin이 필요하다. 인증서 경고 무시·전역 TLS 검증 해제·개발 서버의 인증 우회 공개는 사용하지 않는다.

권한 있는 운영자가 준비한 HTTPS 정적 호스트에 `npm run build:staging`의 allowlist 출력만 배포하는 기존 방법을 사용할 수 있다. 기존 전용 Vercel 스테이징의 모든 배포 인증 보호를 유지한다. 기존 URL은 새 revision의 배포 증거가 아니다.

직접 TLS를 제공하는 기존 로컬 도구를 사용할 때의 설정 형식:

```powershell
Set-Location C:\dev\CarScope-p7-ar\tools\mobile-ar-poc
$env:POC_BASE_URL='https://YOUR-APPROVED-HOST:4174/'
$env:POC_TLS_CERT='C:/YOUR-PRIVATE-EXTERNAL-DIRECTORY/fullchain.pem'
$env:POC_TLS_KEY='C:/YOUR-PRIVATE-EXTERNAL-DIRECTORY/private-key.pem'
$env:POC_HOST='YOUR-APPROVED-LISTEN-ADDRESS'
$env:POC_PORT='4174'
npm run serve
```

값은 운영자가 준비한 실제 hostname/경로/주소로 대체한다. 이 정적 도구는 점검 결과의 로컬 확정까지만 지원한다. `/#v=1&task=washer-fluid` 또는 각 `/#task=<exact-id>`로 17개를 선택할 수 있다. 정적 URL에서 QR v2 인증·전송을 지원하는 것으로 안내하지 않는다.

## B. 결과 제출과 차량 수락까지 테스트

모바일 페이지와 `/v1/*`를 같은 검토된 HTTPS origin에서 제공한다. [기존 인증/TLS 서비스 계약](../../docs/ar-02b2e-auth-service-integration.md)과 현재 운영 환경의 인증 bootstrap을 사용한다. 기본 `npm run serve:https`는 인증 adapter가 없어 **세션 생성 403이 정상**이다. `SYNC_LOCAL_TEST_AUTH`나 합성 token을 외부에 공개해 해제하지 않는다. `serve:mobile-dev`는 loopback 합성 검사 전용이며 폰용 터널/proxy로 노출하지 않는다.

직접 TLS 서비스의 기존 설정은 `SYNC_HOST`, `SYNC_PORT`, `SYNC_PUBLIC_ORIGIN`, `SYNC_TLS_CERT`, `SYNC_TLS_KEY`, `SYNC_DB_PATH`다. 승인된 issuer/차량 등록/폐기 검증 authorizer를 검토한 bootstrap으로 주입해야 실제 생성이 가능하다. 인증 구현 변경·운영자 credential 발급·현재 배포 교체는 이 모바일 PR에서 하지 않았다. 관리형 HTTPS/P6 AVD simulation도 기존 운영자 승인·보호 정책을 유지하며 실제 차량 인증으로 보고하지 않는다.

운영자가 배포한 정확한 origin의 credential 없는 호스트 점검:

```powershell
Set-Location C:\dev\CarScope-p7-ar\tools\inspection-sync-poc
npm run readiness:host -- --api-origin https://YOUR-APPROVED-HOST/ --mobile-root https://YOUR-APPROVED-HOST/
```

호스트 PASS는 폰의 CA 신뢰·후면 카메라·Native 수락 검증이 아니다. Native 소유자는 [신규 task 계약](../../docs/contracts/p7-b-mobile-tasks-v2.md)을 구현·검증한 수신기에서 exact task를 선택해 QR v2 세션을 생성한다. 기존 Native가 미지원이면 미지원으로 남기고 다른 task로 바꾸지 않는다.

## 폰에서 수행할 매트릭스

먼저 기종/OS/브라우저 버전, 배포 SHA, 설명서의 차종/연식/시장과 부품 존재 여부를 외부 기록에 남긴다. Android Chrome과 iOS Safari는 각각 별도 결과다. 한 부품의 PASS를 다른 부품으로 복제하지 않는다.

1. 정차·주차·전원·냉각/소등·보닛 지지 등 해당 화면의 조건을 충족한 뒤 시작한다. 불충족하면 접근하지 않는다. 부품/램프 영역을 구별하지 못하거나 가려졌으면 UNABLE을 기록한다.
2. 카메라 시작을 눌러 실제 권한 UI와 후면 영상인지 확인한다. 화면 탭으로 직접 표시하고 letterbox 바깥 탭이 기록되지 않는지 확인한다. 2D 표시는 추적/자동 인식이 아니다.
3. 세로↔가로 회전, 폴더블 화면 크기 변경, 중지/재시작, 앱 전환/잠금/복귀를 각각 수행한다. 마커 해제·카메라 indicator 종료·복귀 후 자동 시작 없음·기존 응답 보존을 확인한다. 권한 prompt 중 이탈 후 허용했을 때도 카메라가 되살아나면 FAIL이다.
4. 권한 거부·브라우저 카메라 차단·장치 사용 중/영상 중단을 가능한 범위에서 재현한다. 오류가 명시되고 수동 경로로 기록할 수 있어야 한다. 권한 설정 변경 후 재시도 절차도 확인한다. 미재현 항목은 NOT_RUN이다.
5. 각 질문에 직접 본 응답을 고른다. 일부 응답만으로 완료 불가, 뒤로 수정, 취소 후 새 시도, 완료 double tap 시 단일 결과를 확인한다. 이상 징후를 시험 목적으로 만들거나 부품에 접근하지 않는다. 이상 발견/관찰 중단은 미응답을 자동 채우지 않아야 한다.
6. QR v2 화면은 exact task 이름을 확인하고 연결한 뒤 결과를 확정한다. 전송 버튼 전 NOT_SENT, 명시적 전송과 검증된 영수증 후 SENT(수락 전), Native 화면의 질문/응답·동일 digest 확인과 명시적 수락 후 ACCEPTED를 확인한다. Native와 Node simulator의 결과를 구분한다.
7. 연결 끊김/전송 응답 소실은 같은 기록 재시도로 복구하는지, 이미 사용한 QR·만료·차량 취소는 새 QR 안내인지 확인한다. 토큰을 캡처·공유·로그/Git에 남기지 않는다. 개발자 도구 응답 성공만으로 ACCEPTED를 판정하지 않는다.

외부 결과표의 권장 열은 `배포 SHA / exact taskId / 기기·OS·브라우저 / 실제 부품 식별 / 카메라·수동 / 회전 / 거부 / pending 이탈 / background / 영상 중단 / 확정 / 제출 / 수락자 종류 / 최종 상태 / 증거 경로`다. 각 셀에 PASS/FAIL/NOT_RUN과 실제 관찰을 쓴다. 원본 사진·영상·로그·인증서·키·개인 설정은 Git 밖에 보관하고 공유 문서에는 비밀 없는 인덱스만 남긴다. 지연/FPS/발열·배터리 수치는 실제 계측 없이는 보고하지 않는다.
