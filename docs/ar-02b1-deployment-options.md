# AR-02B-1 — HTTPS·네트워크·배포 대안

2026-11-01 검토. **배포 결정이나 인프라 생성 승인이 아니다.** 기존 Vercel 프로젝트/Production/Preview 보호를 변경하지 않았다.
현재 Vercel 산출물은 `tools/mobile-ar-poc/vercel.json`의 정적 파일이며 API/DB가 존재한다고 가정하지 않는다.

| 기준 | A: 별도 HTTPS API | B: 모바일과 same-origin API | C: 개발 전용 로컬/사설망 |
| --- | --- | --- | --- |
| 스마트폰 | 인터넷에서 인증된 API host 접근 가능해야 함 | 페이지/API를 함께 접근 가능해야 함 | localhost는 폰 자신; 승인된 LAN 주소·방화벽·같은 망 필요 |
| AVD | API DNS/인증서 신뢰 필요 | 동일 origin DNS/신뢰 필요 | host alias 10.0.2.2 경로를 실제 이미지에서 검증해야 함; SAN도 일치해야 함 |
| 인증서 | 공인 CA·host 일치·갱신·TLS 전 구간 | 같은 요구사항, 프록시→API도 보호 | 개발 CA 신뢰와 실제 접근 주소 SAN 필요; 신뢰 없으면 실패 |
| Android | INTERNET + HTTPS 전용 클라이언트 | 동일 | cleartext 허용/인증서 오류 우회 금지 |
| CORS | 정확한 모바일 origin + Authorization preflight | 보통 불필요 | local debug same-origin 우선 |
| CSP | 기존 connect-src self로 차단됨; 향후 승인된 host만 명시 | connect-src self 유지 가능 | 현재 debug CSP self 유지 |
| Preview 보호 | 페이지 보호와 API 인증을 각각 설계 | /api가 로그인 HTML/redirect를 반환하는지 실제 확인 필요 | Vercel 사용하지 않음 |
| 서버/차량 인증 | TLS 서버 인증 + 별도 생성 principal verifier 필요 | 동일 | fake 결과를 차량 인증으로 취급 금지 |
| 원자성 | 한 호스트 SQLite 또는 별도 트랜잭션 DB | 함수별 임시 SQLite는 불가; shared DB 필요 | 같은 디스크 다중 프로세스 SQLite 검증 범위 |
| 운영 부담 | 별도 host·CA·CORS·모니터링 | routing/proxy·데이터 서비스 추가 | 외부 요금 없음, 장비/신뢰 설정의 수동 관리 |

선호 방향은 B다. 모바일 보안 정책을 유지하기 쉽기 때문이다. 그러나 정적 Preview에 rewrite 하나를 추가한다고
API·인증·원자성이 생기지는 않는다. 실제 same-origin hosting/proxy와 영속 DB는 별도 승인/구현 과제다.
A도 가능하지만 모바일 CSP와 exact CORS를 함께 검토해야 한다. 이번 구현은 C의 **loopback Node 테스트까지만** 검증했다.

## 실제 보안 검증

`security.test.mjs`는 외부 임시 폴더에 개발 CA/서버 인증서와 localhost/127.0.0.1 SAN을 생성한다.
Node HTTPS 클라이언트가 해당 CA를 명시적으로 신뢰할 때만 정상 요청이 성공한다.
미신뢰 CA, 다른 host, 만료된 서버 인증서는 실제 TLS handshake에서 실패한다. HTTPS 응답의 HSTS,
debug `connect-src 'self'`, exact-origin CORS preflight 허용/거부, 생성 인증 실패/expiry 및 토큰 없는 로그도 검증한다.
`rejectUnauthorized:false`, 인증서 오류 무시, cleartext opt-in을 쓰지 않았다. HTTP는 기존 합성 loopback 회귀에만 사용한다.
OS·폰·AVD에 CA를 설치하지 않았고 실기기 TLS 성공으로 기록하지 않는다.

TLS 종단 프록시가 생기면 현재의 direct socket trust 모델을 검토해야 한다. 외부에서 조작 가능한 forwarded header를
auth/IP 근거로 바로 쓰면 안 된다. TLS cert/key 한쪽만 지정하면 시작을 거부하고 외부 HTTP bind도 거부한다.
CORS는 브라우저의 응답 접근 정책이지 차량 인증이나 네이티브 클라이언트 차단 수단이 아니다.
현재 응답은 no-store/nosniff/no-referrer이며 쿠키를 쓰지 않는다.

## 비용 비교 (USD/월, 세금·트래픽·인증·인건비 별도)

아래는 소규모 실험의 산정 예시이며 구매 견적이 아니다. 실제 제공 지역/팀/이용 자격/사용량과 승인 시점 가격을 다시 확인한다.

| 대안 | 예상 하한/계산 | 주의점 |
| --- | --- | --- |
| C: 기존 PC 로컬 | 외부 서비스 비용 $0 | 전기·장비·수동 운영 비용은 별도; 공개 서비스가 아님 |
| A 또는 B: 단일 유료 Node host + 1GB persistent disk | Render Starter $7 + disk $0.25/GB라면 약 $7.25 | 계산 예시. SQLite experimental·단일 장애 지점, 백업/인증/HA 비용 미포함 |
| B: Vercel 함수 + 외부 managed DB | Hobby 자격 시 hosting $0부터, Pro 기준 $20부터 + DB/초과 사용 | 현 정적 프로젝트와 별도 아키텍처; SQLite 파일을 함수 간 공유할 수 없음 |

요금 근거는 [Render 공식 가격표](https://render.com/pricing?trk=article-ssr-frontend-pulse_little-text-block)와
[Vercel 공식 가격표](https://vercel.com/pricing)다. Render는
[persistent disk 문서](https://render.com/docs/disks)에서 기본 파일시스템의 임시성과 유료 disk의 보존 범위를 설명한다.
단일 디스크의 여러 프로세스 원자성은 여러 서버에 대한 분산 원자성/HA와 다르다.
실제 managed DB를 선택한다면 SQL 트랜잭션/unique/capacity/shared-rate 계약을 다시 구현·검증해야 한다.

## 배포 전 미충족 조건

실제 차량 인증/등록/폐기 제공자, principal별 제한, trust proxy, 실기기 CA/hostname, Vercel 보호와 모바일 접근성,
비밀 관리/디스크 ACL·암호화/백업 보존·복구, 경보·부하/lock timeout·장애 대응, 비용/리소스 생성 승인이 필요하다.
AR-02B-2가 Android/모바일 실제 기능을 연결한 뒤에도 이 조건을 대신 충족했다고 간주하지 않는다.
