# P7-C2: 서버 시각 확장안 — P7-C3에서 서버 구현

> P7-C3가 이 계약의 서버 쪽을 구현했다([구현·검증](../p7-c3-server-clock.md)). Render 배포는 아직 없으므로 배포 서버의 동작은 달라지지 않았다. 아래 ‘현재’와 ‘후속 작업’ 서술은 P7-C2 시점 이력이다. 시각 의미와 검증 규칙은 그대로 유효하다.

현재 `POST /v1/sessions`는 session/task/receiver/invite/두 만료 시각만 반환한다. `GET`/`accept` view에는 원본 `receivedAt`, `acceptedAt`이 있다. `serverNow`는 없다. Node HTTP가 자동으로 붙이는 초 단위 `Date`는 서비스의 주입 가능한 `now()` 및 Render 프록시 시계와의 오차 상한을 계약하지 않는다. `expiresAt - 고정 TTL`, Android wall clock, JS `Date.now()`도 대체 근거로 사용하지 않는다.

**현재 서버 응답으로 Native–3D binding은 `SERVER_CLOCK_UNAVAILABLE`로 차단된다. 운영 연결 완료가 아니다.** P8-A1 서버/DB/Render 파일은 이 변경에서 수정하지 않는다.

최소 제안은 인증된 생성 응답에 아래 **한 필드**를 추가하는 것이다. 기존 QR v2/결과 schema v1/v2/task 목록/토큰/수락 정책은 유지한다.

```json
{"serverNow": 1793740000000}
```

필수 의미와 검증:

- 응답 본문을 생성하는 시점에 세션 서비스의 동일한 `now()`를 캡처한다. `expiresAt`, `receivedAt`, `acceptedAt`과 같은 epoch ms/clock domain이다. 저장된 생성 시각이나 캐시된 과거 응답 시각을 보내지 않는다.
- `serverNow`는 JSON 정수이고 `0 <= serverNow < inviteExpiresAt <= expiresAt`이다. 중복 필드/문자열/null/과학 표기/분수는 거부한다. 응답은 기존 HTTPS 인증/redirect 금지/no-store 정책을 유지한다.
- 세션이 살아 있는 동안 이 clock domain이 역행하거나 deadline을 늘리는 점프가 없어야 한다. 이를 보장할 수 없다면 clock 오차 상한과 별도 만료 프로토콜이 필요하다. HTTP Date와 동등하다고 가정하지 않는다.
- Native는 생성 요청 직전부터 전체 응답 decode까지 monotonic RTT를 측정한다. RTT > 5000ms/역행이면 bridge clock을 발급하지 않는다. 단독 Native 점검은 기존 정책대로 동작한다.
- Native 기준 상한 = `serverNow + RTT`. binding의 `serverNow`에는 추가 4000ms를 더한다. 생성 decode→Native poll이 최대 2000ms, JS RPC 시작→binding 적용 전후가 최대 2000ms인 경우만 연결한다. 초과/백그라운드/렌더러 중단은 새 적용을 차단한다. 이는 실제 서버 필드를 보수적으로 이동한 상한이며 기기 wall clock 합성이 아니다.
- Native는 매 검증에서 상한+monotonic 경과로 expiry를 검사한다. JS는 기존 C1 deadline을 그대로 사용하며 중복 binding으로 갱신하지 않는다. 빠르게 끝난 결과의 `receivedAt`이 보수적 상한보다 이르면 false-negative로 거부한다. 시각 조건을 완화하지 않는다.

클라이언트는 기존 생성 응답과 이 제안의 선택적 `serverNow`를 엄격하게 decode한다. 필드가 없으면 단독 Native 호환성을 유지하고 3D만 차단한다. **서버 구현/배포 및 시계 보장 검토는 Codex A의 후속 작업이며 완료했다고 주장하지 않는다.** 실제 Render 응답에 필드가 확인되고 새 세션을 만든 다음에만 광학 QR E2E를 진행한다.
