# P14 Pleos SDK 통합 상태 카드와 Odometer (PR #123)

기준 `origin/main` `1328a94` (PR #122 병합 후).

**한 일:**
- 기존 SDK 연결을 다시 만들지 않았다.
- Odometer 하나를 기존 Debug 컴포넌트 데이터 소스에 추가했다.
- 이미 수집하던 차량 데이터를 운전자가 읽을 수 있는 부품별 **읽기 전용 상태 카드**로 보여 준다.

**하지 않은 것:** Release 권한·코드 변경, 실제 AVD 실행, 외부 REST API(Phase B).

## A1. 기능별 실제 연결 상태 (코드 기준)

| # | 기능 | Vehicle 2.3.2 API / 권한 | capability → getter → listener | Native 캐시 | WebView 채널 | 3D 표시 |
|---|---|---|---|---|---|---|
| 1 | 타이어 공기압 ×4 | `Tire.getTirePressure` / `PRIVATE_CAR_SAFETY` | ○ → ○ → ○ (`registerTirePressure`) | `PleosTireDataSource` (Debug) | `tire-status.json` (**상태만**. 수치는 계약상 전달 안 함) | 개발자 정보 + **새 카드**(상태만) |
| 1 | 타이어 저압 경고 ×4 | `Tire.checkLowTirePressureCapabilities`, `getLowTirePressure` / `CAR_SAFETY` | ○ → ○ → **listener 연결 안 함** (기존 구현은 공기압만 구독) | 같음 | 같음 (상태만) | 같음 |
| 2 | 워셔액 부족 경고 | `Safety.hasLowWasherFluidWarning` / `CAR_SAFETY` | ○ → ○ → ○ | `PleosComponentDataSource` | `component-status.json` | 개발자 정보 + **새 카드** |
| 3 | 브레이크액 레벨 | `Safety.getBrakeFluidLevelState` / `CAR_SAFETY` | ○ → ○ → ○ | 같음 | 같음 | 같음 |
| 4 | 전면 와이퍼 상태 | `Wiper.getCurrentWiperState(FRONT_WINDSHIELD)` / `CAR_WINDOWS` | ○ → ○ → ○ | 같음 | `visibility-status.json` | 같음 (좌우 구분 없음) |
| 5 | 하향등·상향등 | `Light.getCurrentLow/HighBeamLightState` / `CAR_LIGHTS` | ○ → ○ → ○ | 같음 | 같음 | 같음 (좌우 구분 없음) |
| 6 | EV 배터리 SoC | `EvBattery.getEvBatteryStateOfCharge` / `CAR_ENERGY` | ○ → ○ → ○ | 같음 | `component-status.json` | 같음. 단위·범위 미확인이라 카드에 숫자 없음 |
| 7 | EV 충전 스위치 | `EvBattery.getEvChargeSwitchState` / `CAR_ENERGY` | ○ → ○ → **listener 없음** (공개 API 없음) | 같음 | 같음 | 같음 |
| 8 | EV 충전구 개폐 | `EvBattery.isEvChargePortOpen` (WARNING-deprecated) / `CAR_ENERGY` | ○ → ○ → ○ | 같음 | `ev-charge-status.json` | 같음 |
| 9 | 도어(앞 왼쪽) | `Door` / `CAR_DOORS` (Release 포함) | ○ → ○ → ○ | `PleosVehicleDataSource` (main) | 3D 점검 페이지와 무관 (MainActivity SVG 화면) | 이번에 변경하지 않음 |
| 10 | **Odometer (신규)** | `Odometer.checkCurrentDistanceDrivenCapabilities`, `getCurrentDistanceDriven`(`Float`), `registerDistanceDriven`/`unregisterDistanceDriven` (`DistanceDrivenListener.onDistanceDrivenUpdated(Float)`, `onFailed`) / **`CAR_DRIVE`** | ○ → ○ → ○ | `PleosComponentDataSource` (같은 세션) | **`odometer-status.json`** (신규, 독립 채널) | 전체 요약의 「차량 정보」 카드 |

- 시그니처와 권한은 캐시된 AAR(SHA-256 `e11fdfe4…ef937`, 인벤토리와 동일)을 `javap -v`로 다시 확인했다. 네 메서드 모두 `@RequiresPermission("pleos.car.permission.CAR_DRIVE")`이고 deprecated가 아니다.
- `tools/component-probe/check.py sdk-audit`가 이를 검사한다(PASS, runtime NOT_RUN).
- 냉각수·저전도 냉각수·12V 배터리·퓨즈박스는 이 앱이 연결한 차량 SDK 데이터가 없다. 카드에도 "연동하지 않았어요"라고 쓰고, 사용자 점검으로 대신하지 않는다.

## A2. Odometer

- **새 SDK 세션 없음:** `ComponentFeature.ODOMETER` (domain `Odometer` → `CAR_DRIVE`, `vehicle.odometer`, subscribed)를 추가했다. 같은 `Vehicle` 인스턴스, worker, 10초 timeout, revision 기반 늦은 callback 무시, 5초 STALE, 정지 시 `unregisterDistanceDriven`, release 규칙을 그대로 쓴다.
- **값:** `ComponentValue.Decimal(Float)`. 유한하고 0 이상일 때만 받는다. NaN·무한대·음수는 값 없이 `UNVERIFIED` + `INVALID_FLOAT`이고, null은 `UNAVAILABLE`이다.
- **상태:** 받은 값도 `SUPPORTED`가 아니라 **`UNVERIFIED`**(`FLOAT_UNIT_AND_MEANING_UNVERIFIED`)이다. 단위·의미를 확인하기 전까지 km로 바꾸지 않고 정비 주기도 계산하지 않는다.
- **시각:** 관측 시각은 callback 수신 시각이다. 화면 조회 시각으로 덮어쓰지 않는다.
- **채널:** `odometer-status.json`. 같은 lease와 캐시를 쓰므로 조회해도 getter를 다시 부르지 않는다. 고정 v1 채널(component 4행, visibility 3행, charge 1행)은 그대로이다(테스트로 확인).
- **JSON 값:** Float의 짧은 10진 표기(`12345.6`). `unit`은 항상 null이다.
- **권한:** Debug 매니페스트에만 `CAR_DRIVE`를 넣었다. Release 권한은 `CAR_DOORS`·`VEHICLE_BINDING` 그대로이다(boundary 검사).

## A3·A4. 부품 상태 카드 (`tools/three-poc/vehicle-status-card.mjs`)

**위치:**
- 17개 부품 결과 화면: 「현재 점검 결과」 아래
- 충전구 덮개·고전압 배터리 팩 화면
- 전체 요약: 「차량 정보」(Odometer)

**구성:** 출처별로 블록을 나눈다.
- **차량 SDK 데이터 (`PLEOS`/`MOCK`):** 부품에 해당하는 보고를 차량의 말로 보여 준다(예: "차량이 워셔액 부족 경고를 보고했어요", "보고하지 않았어요. 양이 충분하다는 판정은 아니에요"). 마지막 관측 시각과 출처도 함께 보여 준다.
  - 미지원 / 권한 없음 / 오류 / 값 없음 / 확인 중 / STALE(「오래된 보고예요… 지금 상태로 보지 마세요」) / 연결 안 됨을 구분한다. 값이 없으면 문장도 만들지 않는다.
  - SoC와 Odometer는 숫자를 보여 주지 않는다(단위 미확인). 타이어는 계약상 상태만 온다.
  - 와이퍼·전조등에는 "좌우를 따로 보고하지 않아요"를 함께 표시한다.
- **AI 외관 분석 (`AI_EXPERIMENT`):** 부품의 단계(실험/시험 단계)를 보여 주고 "결과는 스마트폰에서만, 차량으로 보내지 않아요. 정확도 미확인"이라고 적는다. 차량은 AI 결과를 받지 않는다.
- **직접 점검 (`USER_REPORTED`/`MOBILE`):** 기존 17개 투영의 상태·출처·시각이다. 기존 결과 카드와 History를 바꾸지 않는다.

**출처 충돌:**
- 신선한(`SUPPORTED`) 차량 보고와 직접 점검이 다르면 "서로 달라요. 어느 쪽도 자동으로 정답으로 정하지 않아요"를 표시한다. 어느 값도 덮어쓰지 않는다.
- 대상은 워셔액 경고 ↔ 결과, 브레이크액 LOW·CRITICALLY_LOW ↔ "발견 사항 없음"이다.
- STALE이거나 연결이 없으면 충돌로 판단하지 않는다.

**공통 안내:** 차량 보고는 3D 참조 모델의 위치·형상 근거가 아니며 정상·안전 판정이 아니다. 원시 값·capability 코드·불확실한 진단은 기존 개발자 정보에 남겨 두었다.

## A5. 성능·계약

- WebView는 Native 캐시만 조회한다. 새 SDK 세션이나 추가 getter polling은 없다(Odometer 채널 50회 조회 후에도 getter 수 불변, `initialize` 1회).
- 카드는 기존 store 구독(`refreshResultSdk`, 결과 변경 `syncResultSurfaces`)에서 HTML이 바뀔 때만 해당 영역만 다시 쓴다. Three.js 장면은 다시 만들지 않는다.
- Component·Tire·Visibility·Charge v1 계약과 패키지 경로는 그대로이다.

## 검증

| 항목 | 결과 | 비고 |
|---|---|---|
| Odometer SDK 대조 (`check.py sdk-audit`, 실제 AAR) | PASS | runtime NOT_RUN |
| Odometer Native (`OdometerDataTest` 6, `OdometerWebTest` 1) | PASS | capability 미지원·null·권한 거부·SDK 오류, NaN/무한대/음수/null, STALE, 늦은 getter, 중복 완료, 정지 후 해제·늦은 이벤트 무시, v1 채널 불변, 캐시만 조회, 정확한 GET 경로만 허용 |
| 기존 컴포넌트 테스트 | PASS | 고정 수 `8`을 `ComponentFeature.entries.size`로 바꿨다(의미 유지) |
| 상태 카드·Odometer 소비자 (`vehicle-status-card.test.mjs` 7) | PASS | 19개 부품, 상태별 문구, STALE, MOCK, 연결 끊김, 충돌 표시(해결하지 않음), 판정·단위 단어 없음, Odometer 숫자 비노출 |
| three-poc 단위·패키징·문법 | PASS 343 (기존 TODO 1), 패키징 4/4 | |
| 차량 브라우저 (실제 GLB): consistency·panels·part-labels·results·history·toast·part-UX 기준선 | 7/7 PASS | 로컬 Chrome |
| 카드 실제 페이지 확인 (MOCK fixture: 워셔액·와이퍼·Odometer, 타이어 fixture 없음) | 확인 | 워셔액·와이퍼는 MOCK 보고를 출처와 함께 표시하고, 타이어는 "연결되지 않았어요"로 표시해 값을 만들지 않았다. 캡처는 저장소 밖 `C:\CarScope-External\p14\shots` |
| Android 단위 / lint / Debug·Release APK·AAB | 288/288 / PASS / PASS | |
| `check.py boundary` (CAR_ENERGY·CAR_DRIVE Debug 전용, Release 권한 불변, Odometer 자산 Release 미포함) / sync boundary / Kotlin→JS 계약 / core | PASS / PASS / PASS / PASS | |
| 실제 AVD (capability·getter·listener·화면) | **NOT_RUN** | 이번 작업에서 AVD를 실행하지 않았다. Odometer 단위·의미, AVD 콘솔에서 주행거리를 바꿀 수 있는지도 미확인 |
