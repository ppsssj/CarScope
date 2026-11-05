# P9-S2 점검 화면 상태 일관성

3D 점검 화면에서 관측된 UX 결함 2건을 고쳤다. **AVD와 실기기는 `AVD_NOT_RUN`이다.** 결과는 [증거 인덱스](evidence/p9-s2/README.md)에 있다.

## 결함 A: 결과 카드 갱신 지연

**원인:** 결과 표면을 그리는 경로가 둘이었다. `renderGuide()`는 입력 영역, 타이어 배지, 3D 색상만 갱신했고, `#mobilePartResults`와 `#allResults`는 `mobileResults.subscribe`에서만 갱신했다. 로컬 확정은 모바일 이벤트를 내지 않으므로 카드가 다음 전체 렌더까지 `미점검`으로 남았다.

**수정:** 로컬과 모바일 변경이 모두 `syncResultSurfaces()`를 지난다. 이 함수는 3D 색상을 맞춘 뒤 `refreshResultRegions()`를 호출하며, 카드·요약·목록 배지를 한 번의 투영으로 그린다.

- **재렌더링 범위:** 두 영역과 배지만 다룬다. 카메라, 선택, 나머지 패널은 건드리지 않는다. 내용이 같으면 쓰지 않는다.
- **유지되는 것:** 스크롤, 같은 컨트롤의 포커스, 펼친 `<details>`.
- **출처 분리:** 로컬 확정은 모바일 후보를 선택하지 않는다. 모바일 기록을 고르면 카드는 그 기록을, `로컬 타이어 직접 입력 기록`은 로컬 기록을 계속 보여 준다. 전체 요약의 타이어 지도도 로컬 기록만 표시한다.

## 결함 B: 모바일 요청 토스트

**원인 두 가지:**

1. `request()`가 Promise를 기다리지 않고 바로 `true`를 반환했다. 토스트는 Native의 답을 보기 전에 결정됐다.
2. 어댑터가 Native 거부와 지연을 같은 오류로 던져 구별할 수 없었다.

**수정:** `request()`는 확인된 결과로 끝나는 Promise를 반환하며 reject하지 않는다.

| 결과 | 뜻 | 토스트 |
|---|---|---|
| (전송 직후) | 답을 아직 모름 | `Native 점검 요청 전달 중입니다` |
| `ACCEPTED` | 응답이 정확히 `ok: true` | `Native 수신 화면 요청이 접수됐습니다 · 세션 생성 전입니다` |
| `ACCEPTED_ACTIVE_BINDING` | 같은 부품의 유효한 연결이 이미 있음 | `Native 수신 화면 요청이 접수됐습니다 · 이미 연결된 점검 요청입니다` |
| `IN_FLIGHT` | 이전 요청이 대기 중. 보내지도, 교체하지도 않음 | `이전 요청의 Native 응답을 기다리는 중입니다 · 새 요청을 보내지 않았습니다` |
| `REJECTED` | Native가 `REJECTED`로 답함 | `점검 요청을 시작할 수 없습니다` |
| `FAILED` | 통신 실패, `UNAVAILABLE`, 지연, 형식 불명, 8초 무응답 | `Native 연결을 확인하지 못했습니다` |
| `NOT_CONNECTED` | 전달 경로가 없어 보내지 않음 | `Native 전달 경로 미완료 · 요청을 시작할 수 없습니다.` |
| `STALE` | 요청한 세션이 끝남 | 없음 |

`ACCEPTED`는 QR이나 서버 세션 생성을 뜻하지 않는다. 거부 사유를 페이지가 알 수 없으므로 `다른 부품 요청 중`이라고 말하지 않는다.

**늦은 응답:**

- **세션 종료·교체·화면 닫기:** 대기 중인 요청을 즉시 `STALE`로 끝낸다. 늦은 응답은 토스트도 안내도 남기지 않고, 새 세션의 요청을 막지 않는다.
- **Back 등 화면 이동:** 토스트는 요청한 화면에서만 표시한다. 거부와 실패는 패널 안내로 남아 사라지지 않는다.
- **토스트 타이머:** 4초 자동 해제와 이전 타이머 취소는 그대로다.

## 변경 범위

Android, 브리지 RPC, QR·토큰 계약, 결과 계약, Render, PostgreSQL, WebXR은 변경하지 않았다.

JS 어댑터 `android-native-inspection-adapter.mjs`는 한 곳을 고쳤다. 기존 응답의 `error: "REJECTED"`를 오류 표시로 구별할 뿐이며 RPC 명령과 응답 형식은 같다.

## Native 담당에게 넘기는 사항 (수정하지 않음)

1. **거부 사유 없음:** `NativeInspectionBridge`는 다른 부품 대기 중, 입력 오류, 용량 초과를 모두 `error: "REJECTED"`로 답한다. 정확한 문구가 필요하면 안전한 사유 코드가 필요하다.
2. **세션 존재 여부 없음:** 같은 부품 재요청은 패널만 다시 열고 `ok: true`를 답한다. JS는 전달받은 연결로만 추정하므로, 세션이 있어도 연결 전달 전이면 `세션 생성 전입니다`가 표시될 수 있다.

## 알려진 제약

- 합성 어댑터 검증이다. 실제 Native의 응답 시간과 패널 표시 순서는 확인하지 않았다.
- CI에는 GLB가 없어 DOM과 Node 검사만 실행한다. 실제 페이지 검사는 `CARSCOPE_3D_TEST_URL`을 지정한 로컬에서 실행한다.

## 실행

```powershell
Set-Location tools\three-poc
npm ci --ignore-scripts
npm test
$env:PORT='8098'; $env:CARSCOPE_IONIQ5_GLB='C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'; node serve.mjs
# 다른 터미널
$env:CARSCOPE_3D_TEST_URL='http://127.0.0.1:8098/inspect.html?capture=1'
$env:CARSCOPE_EVIDENCE_DIR='C:\CarScope-External\p9-s2\YOUR-RUN-ID'
npm run test:consistency-browser
```

브라우저 검사에는 `tools/mobile-ar-poc`의 `npm ci`도 필요하다.
