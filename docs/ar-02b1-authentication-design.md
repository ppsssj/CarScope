# AR-02B-1 — 차량 수신자 인증 경계

상태: **인터페이스/기본 거부/로컬 fake 검증 완료, 실제 차량 인증 BLOCKED**.
기존 loopback 주소 확인은 차량·앱·소유자 인증이 아니다. QR를 보는 것도 소유권 증명이 아니다.
Pleos SDK 2.3.2의 검증된 범위는 [읽기 전용 Door 연동](pleos-sdk-integration.md)이며
차량 인증/디바이스 증명 API가 확인된 것은 아니다. 그런 API를 가정하거나 SDK 함수를 추가하지 않았다.

## 구현

`SessionCreationAuthorizer.authorize({ token, remoteAddress, secure }): Promise<boolean>`를 HTTP 생성 경계에 주입한다.
`POST /v1/sessions`는 성공한 authorizer만 통과하며, 실패는 입력을 되돌려주지 않는 403 FORBIDDEN이다.
authorizer 예외는 내부 세부사항을 숨긴 500이며 세션을 만들지 않는다. 기본 ProductionSessionCreationAuthorizer는 항상 false다.
이 이름은 운영 인증을 구현했다는 뜻이 아니라 **아직 구현되지 않아 닫힌 경계**라는 뜻이다.

| 구현 | 정책/검증 |
| --- | --- |
| ProductionSessionCreationAuthorizer | loopback 포함 모든 요청 거부; 외부 환경도 deny |
| LocalTestSessionCreationAuthorizer | 기존 AR-02A 합성 회귀용 loopback stand-in, 명시적 opt-in |
| FakeSessionCreationAuthorizer | 테스트용 credential hash, 일정 시각 미만, TLS와 loopback 필수, rotate/revoke |

fake는 테스트에서만 만들며 고정 운영 API 키·JWT 발급기·attestation 대체물이 아니다. 테스트 토큰은 실제 자격증명이 아니다.
`SYNC_LOCAL_TEST_AUTH=1`만 CLI 데모를 허용하고 non-loopback bind에서는 testOnly authorizer와 debug 페이지를 거부한다.
테스트는 누락/위조/만료/폐기/회전된 이전 credential, HTTP 및 외부 주소 거부와 실제 TLS 위 성공/만료를 포함한다.
X-Forwarded-Proto나 임의 헤더로 secure를 올리지 않고 실제 socket TLS 여부를 사용한다.

## 후속 인증 아키텍처

1. 승인된 등록 절차가 앱 설치/디바이스 공개키를 서비스 principal과 연결한다. 패키지명·앱 서명 확인만으로 소유권이 증명되지는 않는다.
2. 디바이스별 비대칭키를 Android Keystore에 생성한다. 서버가 준 일회용 nonce 서명 검증과 검증 가능한 등록 근거로
   인증 서버에서 짧은 수명의 자격증명을 발급한다. 인증 제공자·증명 형식·nonce 재사용 방지는 아직 미구현이다.
3. API verifier가 issuer, audience, signature/알고리즘 allow-list, scope `inspection:session:create`,
   expiry/not-before, device status와 폐기 정보를 검증한다. 단순히 payload를 decode해서 허용하지 않는다.
4. 제안 access 수명은 최대 5분이며 실제 정책은 제공자 결정 후 확정한다. 장기 private key는 앱 번들/일반 저장소/로그에 두지 않는다.
5. 기기 분실·앱 재설치·키 변경 때 registration 폐기와 재등록을 수행한다. signing key rotation은 kid allow-list와 짧은 중첩 기간,
   폐기 반영 지연 한계, 인증 서비스 장애 시 fail closed 정책으로 운영한다.

이 흐름은 설계이며 구현된 자격증명 발급·등록·폐기 서버는 없다. 앱에 공용 API 키를 넣는 방식은 선택하지 않는다.
서버 인증(TLS)과 앱 인증은 별개이며, 검증된 앱/디바이스라도 실제 차량과 소유자 관계를 확인하려면 OEM/서비스의 별도 근거가 필요하다.
이 근거·테스트 환경·운영 책임자가 확보되지 않아 실차 인증은 BLOCKED다.

## 권한과 탈취 위험

생성 credential과 receiver/invite/submit bearer는 목적이 다르다. 생성 credential은 결과 조회/수락 권한을 주지 않는다.
기존 역할별 토큰·hash·마감·일회성 계약은 유지한다. 생성 credential 탈취는 유효기간 동안 가짜 세션과 quota 소모 위험이 있다.
receiver 탈취는 해당 세션 조회/수락/취소 위험, invite 탈취는 첫 claim 선점 위험, submit 탈취는 제출/상태 조회 위험이 있다.
단기 expiry만으로 이미 탈취된 receiver token을 개별 기기 폐기와 연동할 수는 없다. principal→session 폐기 연동은 후속 과제다.

서비스 접근 제한은 향후 승인된 TLS ingress·인증된 생성 principal·shared quota·엣지 DDoS 제한으로 구성해야 한다.
Preview 로그인/배포 보호 토큰을 앱 credential로 사용하거나 모바일 JS/QR에 포함하지 않는다.
로그에는 route template/status/duration만 남긴다. request body/header/token/세션 ID/credential claim은 로깅하지 않는다.

AR-02B-2는 실제 verifier를 연결하기 전 공개 생성 권한을 열면 안 된다. 현재 default deny를 완화해 연동 성공처럼 보이게 하지 않는다.
