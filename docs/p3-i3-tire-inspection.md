# P3-I3 — 네 타이어 육안 셀프 점검

작성: 2026-11-02. 사용자 응답 기록을 기존 타이어 선택 화면에 연결했다. **정상·안전·주행 가능 판정, 압력 수치 및 SDK 기능 추가는 없다.** AVD/실차는 요청에 따라 NOT_RUN이다.

## 기준과 변경 경계

시작한 `C:\dev\CarScope-geometry`는 clean, `feat/p3-a6-inspection-geometry`, HEAD `bf1aa08`이었다. remote는 `https://github.com/ppsssj/CarScope.git`다. fetch 후 main은 `c89b6e47765b0950610842c97270f504258024ab`, PR #37 MERGED(2026-11-01 16:17:19 UTC)를 확인했다. 기존 P3-I3 브랜치/Worktree가 없어 `feat/p3-i3-tire-self-inspection`, `C:\dev\CarScope-tire-guide`를 새로 만들었다. 기존 작업을 삭제·초기화하지 않았다.

주요 변경은 `tools/three-poc/`와 이 보고서/증거 인덱스다. Android Activity/Manifest/Gradle, Native sync/Receiver, Pleos transport, 모바일/AR 서버, vehicle-core와 Geometry 생성기는 변경하지 않았다. 기존 Codex B Worktree는 접근·수정하지 않았다.

외부 GLB는 기존 경로를 읽기만 했다. SHA256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`로 기존 기록과 같다. 새 형상·proxy·메시를 생성하지 않고 기존 매핑을 유지한다.

| tireId | 기존 GLB wheel node |
|---|---|
| tire.front-left | Wheel_0_1 |
| tire.front-right | Wheel_0_0 |
| tire.rear-left | Wheel_1_1 |
| tire.rear-right | Wheel_1_0 |

## 사용자 흐름과 UI

차량 점검 → 타이어 목록 또는 실제 3D 타이어 선택 → 기존 Bounds 기반 근접 카메라/고무 강조 → 체크리스트 → 결과 확정 → 이전/다음 타이어 → 위치별 요약. 0/4·일부 완료 상태에서도 요약을 열 수 있다. 요약 카드 선택 또는 3D 선택으로 다시 점검한다.

세 체크 항목은 외관 손상/균열, 눈에 띄는 이물질, 불균일한 마모의 육안상 징후다. 각 항목은 FOUND(이상 징후 발견), NOT_FOUND(발견하지 못함), UNABLE(확인 불가) 중 하나를 기록한다. UNABLE도 응답이며 확인 필요 항목에 남는다. 미응답이 있으면 결과 확정 버튼은 비활성이다. 세 응답을 모두 입력한 후 별도 확정해야 COMPLETED다.

요약은 차량 전방을 위로 표시하고 앞 왼쪽/오른쪽, 뒤 왼쪽/오른쪽을 2×2로 배치한다. NOT_STARTED/IN_PROGRESS/COMPLETED를 각각 점검 전/진행 중/점검 완료로 표시하며 FOUND·UNABLE 항목, 미응답 안내와 전체 확정 개수를 표시한다. 완료는 사용자 기록의 확정이며 안전 판단이 아니라고 명시한다. 초록/빨강 건강 배지를 사용하지 않는다.

기존 디자인을 보존했다: 어두운 패널/색상 토큰, 기존 버튼·상태 머신·카메라 tween·OrbitControls·고무 강조를 재사용한다. 새 표면은 요청된 native radio/fieldset 체크리스트와 위치 요약이며 별도 UI 라이브러리를 추가하지 않았다. 입력/레이블은 최소 44 CSS px이고 레이블 클릭 및 키보드 Space 선택 후 포커스를 유지한다. 확정 후에는 결과 안내에 포커스를 둔다. 초기 모바일 캡처에서 sticky 하단 버튼이 긴 폼을 가리는 문제가 보여, 타이어 상세/요약의 portrait 버튼 영역만 일반 스크롤로 바꿨다. 보닛 화면의 레이아웃은 그대로다.

## 상태와 데이터 모델

`tire-inspection.mjs`는 DOM/Three/SDK에 의존하지 않는 immutable reducer다. 외부 API 계약이 아니라 이 화면 내부의 사용자 기록 모델이다.

```text
session { sessionId, tires: { [tireId]: row } }
row { tireId, sessionId, source: USER_REPORTED,
      responses: { damage?, debris?, wear? },
      status: NOT_STARTED | IN_PROGRESS | COMPLETED,
      completedAt: epoch milliseconds | null }
```

첫 응답부터 IN_PROGRESS다. 완료 후 **응답이 실제로 바뀌면** completedAt을 지우고 IN_PROGRESS로 돌아간다. 같은 응답/중복 확정은 동일 객체를 반환한다. 재확정 시 새 시각을 기록한다. 각 타이어 행을 독립적으로 갱신하며 다른 행은 보존한다. 잘못된 ID/항목/응답, 이전 sessionId 및 잘못된 완료 시각은 거부한다. sessionId는 페이지의 `crypto.randomUUID()`로 생성하고 점검 종료로 IDLE에 진입하면 모든 기록과 식별자를 새로 만든다. 뒤로 가기·타이어 전환·보닛 탐색은 같은 점검 세션의 기록을 보존한다. 페이지 재로드도 메모리를 초기화한다. DB/서버/URL/localStorage/sessionStorage로 내보내지 않는다.

기존 흐름에 `TIRE_SUMMARY`/`SHOW_TIRE_SUMMARY`를 추가했다. 요약은 선택·강조를 해제하고 기존 목록 시점을 복원한다. 이전/다음은 동일한 SELECT_TIRE 경로를 사용하며, 빠른 입력도 최신 카메라 목표로 수렴한다. 응답 갱신은 `tireGuide` 영역만 교체하고 카메라·선택·모델을 다시 만들지 않는다. 오래된 타이어/세션 이벤트와 reducer의 no-op은 화면을 갱신하지 않는다.

Pleos의 capability/availability/source/observedAt 및 UNRESOLVED 진단은 기존 status store 그대로다. 별도 접기 영역에서 두 feature를 확인할 수 있다. Native endpoint, TireProcessOwner, TireUiChannel, STALE 정책과 `tire-status.mjs`는 변경하지 않았다. 사용자 응답이 SUPPORTED/정상 상태로 변환되거나 SDK 실패가 MOCK으로 대체되는 경로는 없다.

## 검증

Windows / Node22.16.0 / 기존 Chrome·Anatomy driver를 사용했다. 실제 외부 GLB를 렌더링한 Chrome 결과와 사용자 응답 테스트 데이터이며 Android/Pleos 실제 수신 증거가 아니다. [외부 증거 인덱스](evidence/p3-i3/README.md).

| Gate | 판정 | 명령 / 관측 |
|---|---|---|
| Node 단위/회귀 | PASS | `npm test --prefix tools/three-poc`: 기존 28 + 신규 6 = 34개, 실패/skip 0 |
| 신규 모델·상태 검사 | PASS | 타이어별 독립성/immutable, 3응답+명시 확정, 수정·재확정·중복, 잘못된 값/세션 거부, 빠른 전환·요약·종료, 중간 결과/위치별 요약 |
| Android Debug 자산 계약 | PASS | `npm run test:android-assets --prefix tools/three-poc`: 1개. 새 두 모듈 원본 byte 대조, 상대 import 존재, CSP 유지, GLB 미포함 |
| 신규 실제 Chrome Desktop | PASS | `check-tire-inspection.mjs … 1600 1000`: 34 assertions, 실제 클릭/키보드 응답·확정·수정·재진입·부분/전체 요약·시점 복원·새 세션 |
| 신규 실제 Chrome Narrow | PASS | 같은 검사 `420 860`: 34 assertions. 44px 입력, 수평 overflow 없음, 가림 개선 및 두 요약 행 캡처 |
| 기존 타이어 실제 Chrome | PASS | `check-tires.mjs … 1600 1000` / `420 860`: 39 / 36 assertions. 실제 Raycast, 고무만 강조, 차체 가림, 카메라/scroll/focus 복원, 넓은 검사에서 선택 중 420×860·1024×600 resize |
| 기존 부품 실제 Chrome | PASS | `check-inspection-components.mjs … 1600 1000` / `420 860`: 각각 34 assertions. 4개 부품/10메시, 보닛 가림, LCW 준비 중, 연속 선택·복원·종료 |
| 기존 보닛·워셔액·QR | PASS | `check-inspection.mjs … 1600 1000`: 17 assertions. 개폐 애니메이션·중복/취소·QR·종료. 테스트 HTTPS origin만 구성 |
| Core JVM | PASS | `gradlew.bat -PcoreOnly=true :vehicle-core:test --rerun-tasks --console=plain --max-workers=1 -Dorg.gradle.jvmargs=-Xmx768m -Pkotlin.compiler.execution.strategy=in-process`: 37 pass / 기존 optional IONIQ5_PARTS 1 skip |
| 변경 경계/원본/공백 | PASS | 금지 범위 diff 0, GLB SHA 동일, `git diff --check` |
| Android APK/AAB 로컬 빌드·설치 | NOT_RUN | 이번 범위는 WebView 패키징 자산 계약. APK 설치나 실제 WebView 호환성 결과로 확대하지 않음 |
| AVD / 실제 Pleos / 실차 | NOT_RUN | 사용자 지시로 AVD 진단·기동·호출도 실행하지 않음 |

Core의 첫 로컬 호출은 외부 실행 wrapper의 옵션 인용 오류로 Gradle task 탐색 단계에서 실패했다. 명령을 고쳐 위 테스트를 실행했으며 최초 `core.log`와 성공한 `core-final.log`를 구분해 보존했다. 테스트 assertion과 임계값을 약화하거나 삭제하지 않았다. 초기/중간 캡처도 최종 review 캡처와 구분한다.

## 재실행과 한계

기존 `INSPECTION_UI.md`의 npm 설치·서버 절차를 사용한다. 모델은 `CARSCOPE_IONIQ5_GLB`, QR 테스트 origin은 `CARSCOPE_QR_AR_BASE_URL`, port는 `PORT=8123`으로 구성했다. 브라우저 명령은 `node tools/three-poc/<검사>.mjs C:/CarScope-External/p3-i3/<새-폴더> http://127.0.0.1:8123/inspect.html?capture=1 <width> <height>`다. 새 전용 검사는 `check-tire-inspection.mjs`이며 기존 검사를 그대로 재실행한다. 캡처/JSON/로그/생성 자산을 Git에 넣지 않는다.

실차 형상 정확도·가려진 타이어 면·실제 마모/손상 유무·주행 가능 여부를 이 화면이 판단하지 않는다. USER_REPORTED 기록은 검증된 센서 관측이 아니다. 실제 Android WebView 입력/렌더링 및 SDK 수신은 기존 P3-I2 런타임 미검증 상태를 해제하지 않는다. 영구 저장·앱 재생성 복구·서버 전송·AR 동기화는 제공하지 않는다. 이후 연동은 별도 승인된 과제에서 데이터 보존과 출처 정책을 정해야 한다. 이번 PR은 자동 병합하지 않는다.
