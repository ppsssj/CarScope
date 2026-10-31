# P3-A4 — 차량 점검 UI (Three.js)

`inspect.html`은 IONIQ 5 참조 모델 위에서 **차량 홈 → 차량 점검 → 보닛 → 워셔액 → 점검 방법 → 스마트폰 QR** 흐름을 한 화면에서 수행하는 제품형 PoC다. 기존 엔지니어링 화면 `ioniq5-hood.html`은 그대로 두며, 개발자 패널(`?dev=1` 또는 `` ` `` 키)에서 링크한다. Android `MainActivity`는 이 단계에서 바꾸지 않았다.

## 실행

```powershell
Set-Location C:\dev\CarScope-inspect\tools\three-poc
npm ci --ignore-scripts
$env:CARSCOPE_IONIQ5_GLB = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
# 선택: 스마트폰 QR 대상. HTTPS 루트 origin만 허용. 설정하지 않으면 QR 단계는 비활성으로 표시된다.
$env:CARSCOPE_QR_AR_BASE_URL = 'https://YOUR-QR-AR-ORIGIN/'
$env:PORT = '8098'
npm run serve
# http://127.0.0.1:8098/inspect.html
```

GLB와 파생 자산은 저장소 밖에 둔다. QR origin은 코드에 넣지 않고 서버 실행 시 환경 변수로만 받는다. 서버는 `/inspection-handoff.json`과 `/inspection-qr.svg`를 제공하며, URL은 QR-AR 계약(`tools/mobile-ar-poc`, PR #18)과 같은 `https://origin/#v=1&task=washer-fluid`이다. fragment에는 작업 종류만 있고 차량·계정 정보는 없다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `inspection-flow.mjs` | 순수 상태 머신. `IDLE → INSPECTION_OVERVIEW → HOOD_OPENING → COMPONENT_SELECTION → WASHER_SELECTED → MOBILE_HANDOFF_READY`, 닫힘 전이용 `HOOD_CLOSING`. 점검 부위 목록(`INSPECTION_AREAS`)과 상태별 보닛 목표 각도·카메라 목표 |
| `inspection-handoff.mjs` | QR 대상 URL 검증. HTTPS 루트가 아니거나 계정·경로·쿼리·fragment·loopback이 있으면 비활성 |
| `inspect.js` | 상태를 화면에 반영: 보닛·카메라 tween, 강조, 워셔액 라벨, 패널, 클릭 판정 |
| `check-inspection.mjs` | headless Chrome 흐름 검사와 화면 캡처 (외부 폴더에 저장) |
| `test/inspection-flow.test.mjs` | 상태 전이·중복 입력·취소·종료·QR 계약 단위 테스트 (CI 포함) |

보닛과 카메라는 **목표 기반**으로 움직인다. 상태가 바뀌면 현재 자세에서 새 목표로 다시 출발하고, 애니메이션이 끝나면 `HOOD_OPENED`/`HOOD_CLOSED` 이벤트로 상태 머신에 알린다. 그래서 열리는 중 취소, 중복 클릭, 늦게 도착한 완료 이벤트가 화면과 상태를 어긋나게 만들지 않는다. 적용되지 않는 이벤트는 같은 상태를 반환하고 로그에 `ignored`로 남는다.

새 점검 부위·부품은 `INSPECTION_AREAS`에 추가한다. `status: 'planned'` 항목은 목록에 “준비 중”으로만 보이고 선택되지 않는다. 현재 선택 가능한 항목은 보닛과 `washer-fluid-cap`뿐이며, 냉각수·저전도 냉각수·브레이크액·12V 배터리·퓨즈박스는 실제 형상이 없는 예약 영역이라 3D에 그리지 않는다.

## 형상과 동작의 근거

- 보닛 개방: P3-A1 축 A(OpenX 그룹 원점, `UNVERIFIED`), 0→60°. P3-A1/A2 시뮬레이션에서 이 범위에 새 메시 간섭이 없었다. 실제 힌지와 최대 개방각은 미검증이다.
- 전방 Shell, 프렁크(닫힌 상태), 워셔액 주입구 몸체·캡: `tools/ioniq5-asset`의 기존 빌더를 그대로 사용한다. 모두 `ESTIMATED_GEOMETRY`이며 OEM 형상이나 측정값이 아니다.
- 점검 방법과 주의 문구는 일반적인 절차와 `service-components.mjs`의 안내를 따르며, 출처로 Hyundai 2022 UK 정비 설명서 9-14를 연결한다. 대상 시장과 좌우 배치는 미검증이다.

## 검사

```powershell
Set-Location C:\dev\CarScope-inspect
node --test tools/three-poc/test/*.test.mjs
node tools/three-poc/check-inspection.mjs 'C:\CarScope-External\p3-a4\desktop' http://127.0.0.1:8098/inspect.html 1600 1000
node tools/three-poc/check-inspection.mjs 'C:\CarScope-External\p3-a4\narrow-420' http://127.0.0.1:8098/inspect.html 420 860
```

브라우저 검사는 GLB가 필요하므로 CI에서는 실행하지 않는다. 화면 크기별 검사는 각 크기로 새로 연 페이지에서 흐름을 확인하는 것이며, 열린 창의 크기를 바꾸는 동작은 자동 검사하지 않는다.
