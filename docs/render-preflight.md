# Render preflight — 연결 검증 전용

이 엔트리포인트는 실제 인증 발급·등록·폐기·영구 저장소 연결을 수행하지 않는다.
**모든 세션 생성은 기본 거부**다. 기존 직접 HTTPS 리스너나 운영 adapter를 변경하지 않는다.
Vercel의 기존 보호된 스테이징과 독립이다.

## 왜 별도 엔트리포인트인가?

Render는 외부 HTTPS를 로드 밸런서에서 종료하고 내부 HTTP로 Node에 전달한다.
현재 `serve:https`는 인증서·키로 직접 HTTPS를 열기 때문에 Render Web Service의 요청을 받는 실행 명령이 아니다.
이 preflight는 Render의 관리형 외부 HTTPS에서 **모바일 same-origin 정적 페이지와 인증 실패 응답**만 검사한다.
HTTP 내부 홉이 승인된 보안 경계인지, 실제 credential issuer/소유권 검증과 SQLite 영속화는
향후 운영 설계에서 별도로 판단해야 한다.

## Render Web Service 설정

- 연결 저장소: `ppssj/CarScope`가 아닌 **`ppsssj/CarScope`**
- Runtime: Node / Branch: 이 PR을 병합한 뒤 `main`
- Root Directory: **비워 둠** (모바일 모듈이 다른 폴더에 존재함)
- Build Command: `node --check tools/inspection-sync-poc/src/render-preflight.mjs && node --test tools/inspection-sync-poc/test/render-preflight.test.mjs`
- Start Command: `node tools/inspection-sync-poc/src/render-preflight.mjs`
- Health Check Path: `/healthz`
- Environment: `NODE_VERSION=22.16.0` (Render 플랫폼 기본 RENDER, RENDER_EXTERNAL_URL, PORT 사용)
- 테스트 단계: Free 인스턴스, 1개 인스턴스, 자동 배포 끄기 권장. 비용은 화면에서 최종 확인

기밀 키/테스트 credential/SDK 설정을 환경변수나 APK에 넣지 않는다.
`SYNC_LOCAL_TEST_AUTH`, `SYNC_FIXTURE_TOKEN`, `SYNC_DEBUG_PAGE`, `SYNC_ALLOWED_ORIGIN`,
`NODE_TLS_REJECT_UNAUTHORIZED=0` 활성화 시 CLI가 시작을 거부한다.

## 배포 후 검증

1. Render `/healthz` → 200, `sessionCreation:DENIED`
2. Render `/` → 200, 보호 헤더 및 모바일 점검 화면
3. 무인증 GET `/v1/sessions/00000000-0000-4000-8000-000000000000` → 401
4. 정상 형식의 가짜 생성 credential로 POST `/v1/sessions` → 403, 실제 세션 없음
5. 사용자 스마트폰 Chrome에서 HTTPS 페이지 접근, 카메라 UI 확인
6. AVD에서 HTTPS CA/연결을 별도로 검사. 점검 세션 E2E **미진행**으로 기록

preflight는 **MemorySessionStore**만 사용한다. 실제 세션 생성이 항상 거부되므로
운영 기록을 저장하지 않는다. SQLite 데이터를 유실시키면서 실사용하는 구성이 아니다.

실제 E2E 활성화 전에는 Render에 적합한 영속 저장소(유료 persistent disk+단일호스트
SQLite 또는 atomic contract가 검증된 외부 DB adapter), 신뢰된 issuer/registration/
revocation authority 및 Android enrollment/provisioning, proxy 보안 경계를 **별도 PR로**
구현·검증한다. 이 preflight 파일의 기본 거부를 운영 환경변수로 해제하지 않는다.
