# CarScope 차량 점검 UX

P8-B1: [저장된 과거 점검 기록 UI](../../docs/p8-b1-inspection-history-ui.md). 현재 세션의 메모리 기록과 별개인 읽기 전용 화면이며, 검증된 read provider가 없는 현재 배포에서는 `UNAVAILABLE`을 표시하고 요청을 보내지 않습니다.

P5-A5: [UX 검토·검증](../../docs/p5-a5-state-map-mobile-integration-preparation.md)과 [모바일 결과 연결 계약(설계)](../../docs/contracts/mobile-result-to-3d-session-v1.md). 상태색을 보존하는 선택 강조, 결과 우선 요약, 접을 수 있는 기록 범위/모델 정보와 원래 확정 시각을 제공합니다. 모바일 수신·적용 경로는 아직 없으며 기존 화면 직접 입력 기록만 표시합니다.

최신 P5-A4는 [세션 기반 3D 점검 상태 지도](../../docs/p5-a4-inspection-state-map.md)를 따른다. 네 타이어의 이 화면 직접 입력/확정 기록만 `미점검 / 이상 징후 보고 / 확인 불가 / 발견 사항 없음`으로 표시한다. 기존 고무 재질에 상태색을 입히고 목록·상세·전체 요약에서 문자/기호·출처·원래 확정 시각을 함께 보여 준다. 미확정/수정 기록은 미점검이며 SDK 관측이나 미수신 모바일 결과로 채우지 않는다. 영구 보존은 제공하지 않는다.

# P4-A1과 기존 타이어 점검 흐름

최신 전체 경로·Android 차이·저장 후속 요구사항은 [P4-A1 보고서](../../docs/p4-a1-inspection-product-flow.md)를 따른다. 기존 [P3-I3 타이어 모델](../../docs/p3-i3-tire-inspection.md), P3-A4 보닛 흐름과 P3-A6 네 preview 부품을 재사용한다.

## 전체 경로와 종료

3D 차량 홈 → 차량 점검 → 보닛/타이어 선택 → 상세 → 전체 점검 요약 → 계속 점검 또는 종료·기록 지우기 → 홈. 전체 요약은 응답 전에도 열 수 있다. 열려 있는 모델의 보닛은 먼저 닫고 요약으로 이동한다. 종료 버튼은 모든 활성 단계에 있고, 홈으로 들어가면 메모리 기록을 지운다. 뒤로 가기/타이어 전환/다른 부위 탐색/요약 왕복 중에는 같은 기록을 유지한다.

전체 요약의 타이어 결과는 USER_REPORTED이고 차량 안전·정상·주행 가능 판정이 아니다. 워셔액 안내/QR 표시는 점검 완료로 집계하지 않는다. 워셔액 모바일 결과와 Native Receiver 결과는 이 3D 화면에 수집되지 않으며 별도 관리한다. Pleos capability/availability/관측 시각은 타이어 상세에서 별도 확인한다.

기록은 메모리 전용이다. 영구 저장·새로고침/Activity 재생성/프로세스 종료 복구는 제공하지 않는다. 홈/점검 종료/화면 닫기/새로고침 시 삭제된다. localStorage·DB를 추가하기 전에 보존 기간·사용자/차량 경계·동의·복원/삭제 정책을 별도 결정한다.

## Android Debug 경계

같은 HTML/JS를 `build-android-inspection.mjs`로 Debug 전용 패키징한다. 시스템 Back도 웹의 한 단계 BACK을 호출하며 홈 또는 JS 미준비 상태에서만 화면을 종료한다. 별도 닫기 버튼은 기존 GL dispose→private `/close` 경로를 유지한다. 외부 PDF/직접 링크는 기존 차단 정책과 함께 사용자 안내를 표시한다. Native 워셔액 수신 버튼과 SyncReceiverActivity는 기존 구현을 유지하며 JS/타이어 데이터로 연결하지 않는다. Release 기본 MainActivity 정적 SVG는 그대로다.

이번 단계의 desktop shell JS simulation과 Robolectric은 실제 Android 입력/렌더·수명주기 증거가 아니다. **AVD·adb는 실행하지 않으며**, 최종 실측은 별도 통합 단계에서 수행한다.

## P3-I3 타이어 셀프 점검

차량 점검 → 타이어 → 네 바퀴 중 선택 → 육안 체크리스트 3개 응답 → 결과 확정 → 이전/다음 타이어 → 점검 요약. 일부 타이어만 응답한 중간 요약도 열 수 있다. 요약의 앞/뒤·좌/우는 차량 진행 방향 기준이다.

`tire-inspection.mjs`는 SDK와 독립된 immutable `USER_REPORTED` 세션 모델이다. 모든 항목에 응답해도 확정 전에는 IN_PROGRESS다. 완료 후 응답을 수정하면 완료 시각을 지우고 재확정을 요구한다. 점검 종료·페이지 재로드는 기록을 지우며, 서버·DB·storage API로 저장하지 않는다. 정상·안전·주행 가능 판정이나 압력 수치를 생성하지 않는다.

`tire-inspection-view.mjs`는 체크리스트와 위치별 요약을 그린다. `TIRE_SUMMARY`와 전체 `INSPECTION_SUMMARY`는 같은 사용자 기록을 소비하며 카메라/OrbitControls, 고무 강조, mesh 매핑을 재사용한다. Pleos 상태는 접기 영역에서 확인하고 기존 endpoint·SDK 세션 계약을 유지한다. 긴 폼·요약·공통 세션 버튼은 같은 스크롤 흐름에 두어 입력을 가리지 않는다.

추가 검사: `node tools/three-poc/check-tire-inspection.mjs <외부-증거-폴더> http://127.0.0.1:8123/inspect.html?capture=1 420 860` (데스크톱은 `1600 1000`). Node 및 Android 자산 검사는 아래 기존 명령을 그대로 사용한다.

`inspect.html`은 기존 IONIQ 5 참조 모델을 사용하는 제품형 PoC다. 기존 엔지니어링 화면 `ioniq5-hood.html`은 그대로 두며 개발자 패널(`?dev=1` 또는 `` ` `` 키)에서 링크한다. Android `MainActivity`는 바꾸지 않았다.

## 실행

```powershell
# 저장소 루트에서
npm ci --ignore-scripts --prefix tools/three-poc
$env:CARSCOPE_IONIQ5_GLB = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'
# 선택: 스마트폰 QR 대상. HTTPS 루트 origin만 허용. 설정하지 않으면 QR 단계는 비활성으로 표시된다.
$env:CARSCOPE_QR_AR_BASE_URL = 'https://YOUR-QR-AR-ORIGIN/'
$env:PORT = '8098'
node tools/three-poc/serve.mjs
# http://127.0.0.1:8098/inspect.html
```

GLB와 파생 자산은 저장소 밖에 둔다. QR origin은 코드에 넣지 않고 서버 실행 시 환경 변수로만 받는다. 서버는 `/inspection-handoff.json`과 `/inspection-qr.svg`를 제공하며, URL은 QR-AR 계약(`tools/mobile-ar-poc/public/handoff.mjs`)이 만드는 `https://origin/#v=1&task=washer-fluid`이며, QR-AR 정적 스테이징 빌드와 같은 loopback 거부 규칙을 쓴다. fragment에는 작업 종류만 있고 차량·계정 정보는 없다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `inspection-flow.mjs` | 순수 상태 머신. 보닛/워셔액/QR, 타이어 상세/요약, 전체 `INSPECTION_SUMMARY` 및 닫힘/취소 전이. 점검 부위 목록과 보닛/카메라 목표 |
| `inspection-product.mjs` | 전체 요약, 공통 세션 버튼, 브라우저/Android shell의 Back 의미. SDK나 저장소를 쓰지 않음 |
| `tire-inspection.mjs` / `tire-inspection-view.mjs` | 기존 immutable USER_REPORTED reducer와 육안 입력/위치별 요약 |
| `inspection-handoff.mjs` | 서버 측 어댑터. 검증은 QR-AR의 `tools/mobile-ar-poc/public/handoff.mjs`(`handoffURL`, `isLoopbackHost`)를 그대로 사용하며, 실패를 예외 대신 “비활성(configured: false)”으로 돌려준다. 브라우저 페이지는 이 모듈을 import하지 않는다 |
| `inspect.js` | 상태를 화면에 반영: 보닛·카메라 tween, 강조, 워셔액 라벨, 패널, 클릭 판정 |
| `inspection-toast.mjs` | `#toast`의 단일 소유자. 새 안내가 이전 안내와 타이머를 대체하고 4초 뒤 사라진다. 실제 페이지 검사는 `npm run test:toast-browser --prefix tools/three-poc` |
| `check-inspection.mjs` | headless Chrome 흐름 검사와 화면 캡처 (외부 폴더에 저장) |
| `test/inspection-flow.test.mjs` | 상태 전이·중복 입력·취소·종료·QR 계약 단위 테스트 (CI 포함) |

보닛과 카메라는 **목표 기반**으로 움직인다. 상태가 바뀌면 현재 자세에서 새 목표로 다시 출발하고, 애니메이션이 끝나면 `HOOD_OPENED`/`HOOD_CLOSED` 이벤트로 상태 머신에 알린다. 그래서 열리는 중 취소, 중복 클릭, 늦게 도착한 완료 이벤트가 화면과 상태를 어긋나게 만들지 않는다. 적용되지 않는 이벤트는 같은 상태를 반환하고 로그에 `ignored`로 남는다.

새 점검 부위·부품은 `INSPECTION_AREAS`에 추가한다. `planned`는 준비 중으로 선택되지 않는다. 현재 보닛·워셔액·네 타이어를 선택할 수 있고, 냉각수·브레이크액·12V 배터리·퓨즈박스는 `preview`로 추정 형상만 탐색한다. 저전도 냉각수는 형상이 없는 예약 영역이다. preview 선택을 점검 완료로 기록하지 않는다.

## 형상과 동작의 근거

- 보닛 개방: P3-A1 축 A(OpenX 그룹 원점, `UNVERIFIED`), 0→60°. P3-A1/A2 시뮬레이션에서 이 범위에 새 메시 간섭이 없었다. 실제 힌지와 최대 개방각은 미검증이다.
- 전방 Shell, 프렁크(닫힌 상태), 워셔액 주입구 몸체·캡: `tools/ioniq5-asset`의 기존 빌더를 그대로 사용한다. 모두 `ESTIMATED_GEOMETRY`이며 OEM 형상이나 측정값이 아니다.
- 점검 방법과 주의 문구는 일반적인 절차와 `service-components.mjs`의 안내를 따르며, 출처로 Hyundai 2022 UK 정비 설명서 9-14를 연결한다. 대상 시장과 좌우 배치는 미검증이다.

## 검사

```powershell
# 저장소 루트에서. 실행 중인 로컬 서버와 새 외부 증거 폴더를 지정한다.
node --test tools/three-poc/test/*.test.mjs
npm run test:android-assets --prefix tools/three-poc
node tools/three-poc/check-inspection-product.mjs C:/CarScope-External/p4-a1/NEW-product 'http://127.0.0.1:8098/inspect.html?capture=1' 1600 1000
# 420 860으로도 실행한다. 기존 check-tire-inspection/check-tires/check-inspection-components/check-inspection도 회귀 검사한다.
```

브라우저 검사는 외부 GLB와 기존 고정 Anatomy Chrome driver가 필요하며 CI의 합성 테스트와 구분한다. 새 제품 검사는 전체 요약/다른 부위 왕복/종료/기록 초기화, desktop에서 Android shell JS의 Back/링크 안내를 확인한다. 기존 tire 검사 Desktop에는 선택 중 실제 child viewport resize도 포함한다. Native Back 경계는 SDK lease를 시작하지 않는 실제 InspectionActivity create 단계의 Robolectric 테스트로 확인한다. Debug/Release 빌드·격리·새 실행 수치는 P4-A1 보고서를 따른다.
