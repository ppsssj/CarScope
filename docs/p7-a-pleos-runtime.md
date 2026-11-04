# P7-A — SDK 2.3.2 공개 API 및 AVD 검증

기준 `C:/dev/CarScope-p7-api`, `feat/p7-sdk-api`, main/HEAD `b99f177ec044b58a93279b7341d7885116a2dd48`에서 시작. 기존 변경 없음. SDK는 app 경계에 유지하며 Geometry·모바일 AR·인증/TLS·Render 운영 설정은 변경하지 않는다.

## 공개 API 전수조사

[생성된 선언 목록](contracts/pleos-public-api-inventory.md)은 실제 SHA 고정 AAR의 공개 domain interface 20개와 오버로드 포함 517개 선언을 수록한다. 권한은 메서드 annotation을 추출하고 누락은 UNDECLARED로 표시한다. 제어 선언도 조사하되 앱에서 호출하거나 권한을 추가하지 않는다. 선언의 존재는 runtime 지원 증거가 아니다. 소스 중복 구현 없이 기존 typed Door/Tire/Component session과 3D 패널을 사용한다.

| 공개 도메인 | 선언 수 | 기존 앱 연동 / UI | 이 작업의 runtime 범위 |
| --- | --- | --- | --- |
| Brake | 4 | 없음 | NOT_RUN |
| CarInfo | 5 | 기존 Debug identity probe | NOT_RUN (상태 점검 데이터와 별개) |
| Display | 4 | 없음 | NOT_RUN |
| Door | 17 | ROW_1_LEFT → FRONT_LEFT, 메인 정적 SVG | 기존 회귀 유지 |
| DrivingMode | 12 | 없음 | NOT_RUN |
| EvBattery | 38 | SoC / charge switch / port-open, 기존 3D 패널 | 우선 검증 |
| Fuel | 20 | 없음 | NOT_RUN |
| Gear | 3 | 없음 | NOT_RUN |
| HVAC | 86 | 없음 | NOT_RUN |
| Light | 78 | 전역 low/high beam, 기존 좌우 표식 패널 | 우선 검증 |
| Odometer | 38 | 없음 | NOT_RUN |
| Safety | 39 | washer warning / brake fluid level, 기존 부품 패널 | 우선 검증 |
| Seat | 101 | 없음 | NOT_RUN |
| SideMirror | 6 | 없음 | NOT_RUN |
| SteeringWheel | 10 | 없음 | NOT_RUN |
| Tire | 7 | 네 바퀴 pressure / low-pressure, 기존 상태 패널 | 우선 검증 |
| Toll | 5 | 없음 | NOT_RUN |
| TurnSignal | 4 | 없음 | NOT_RUN |
| Window | 31 | 없음 | NOT_RUN |
| Wiper | 9 | FRONT_WINDSHIELD, 기존 전면 와이퍼 패널 | 우선 검증 |

## 우선 부품 매트릭스

아래 권한에는 공통 접두사 `pleos.car.permission.`이 붙는다. `check…Capabilities`의 READ 또는 READ_WRITE 확인 후에만 읽고, enum/area는 advertised 집합을 추가 검증한다. 단위/범위를 확인하지 않은 SoC를 %로, 충전 스위치를 충전 진행으로, 좌우 공유 신호를 개별 센서로 해석하지 않는다.

| 부품 / feature | 공개 capability → getter | 권한 | callback 및 기존 UI |
| --- | --- | --- | --- |
| 워셔액 `safety.washer-fluid-warning` | Safety.checkLowWasherFluidWarningStateCapabilities → hasLowWasherFluidWarning | CAR_SAFETY | LowWasherFluidWaringListener, `washer-fluid-cap` |
| 브레이크액 `safety.brake-fluid-level` | Safety.checkBrakeFluidLevelStateCapabilities → getBrakeFluidLevelState | CAR_SAFETY | OilLevelStateListener, `brake-fluid-reservoir` |
| 고전압 배터리 `ev-battery.soc` | EvBattery.checkEvBatteryStateOfChargeCapabilities → getEvBatteryStateOfCharge | CAR_ENERGY | EvBatteryStateOfChargeListener, `ev-battery.pack`; 원시 Integer의 의미 UNVERIFIED |
| 충전 스위치 `ev-battery.charge-switch` | EvBattery.checkEvChargeSwitchCapabilities → getEvChargeSwitchState | CAR_ENERGY | 공개 listener 없음, 초기 getter만; 기존 배터리 패널 |
| 충전구 `ev-charge.port-open` | EvBattery.checkEvChargePortOpenCapabilities → isEvChargePortOpen | CAR_ENERGY | EvChargePortOpenListener; WARNING-deprecated API, 기존 충전구 패널. 플랫폼 fallback 없음 |
| 타이어 압력 `tire.pressure` | Tire.checkTirePressureCapabilities → getTirePressure | PRIVATE_CAR_SAFETY | TirePressureListener; 네 바퀴 상태만 공개, raw 값/단위는 Debug probe 전용 |
| 타이어 저압 `tire.low-pressure` | Tire.checkLowTirePressureCapabilities → getLowTirePressure | CAR_SAFETY | 공개 listener 없음, 기존 네 바퀴 상태 패널 |
| 전면 와이퍼 `wiper.front.state` | Wiper.checkWiperStateCapabilities → getCurrentWiperState(FRONT_WINDSHIELD) | CAR_WINDOWS | WiperStateListener, 좌우 와이퍼가 전면 유리 공통 신호 공유 |
| 하향등 `light.low-beam` | Light.checkLowBeamLightStateCapabilities → getCurrentLowBeamLightState | CAR_LIGHTS | LightStateListener; 좌우 기존 표식이 전역 신호 공유 |
| 상향등 `light.high-beam` | Light.checkHighBeamLightStateCapabilities → getCurrentHighBeamLightState | CAR_LIGHTS | LightStateListener; 좌우 기존 표식이 전역 신호 공유 |

실제 권한 grant, capability 응답, getter 수신, listener 수신, 패널 표시는 각각 별도의 증거다. 권한 annotation/선언만으로 위 항목을 runtime PASS로 표시하지 않는다. 조사 밖 도메인은 UNVERIFIED/NOT_RUN이며 API가 없다는 의미의 UNSUPPORTED로 바꾸지 않는다.

## 상태·출처·변경

기존 상태 계약을 유지한다: 읽기/area/enum capability 미지원은 UNSUPPORTED, 권한 거부는 PERMISSION_DENIED, 초기·의미 미확인은 UNVERIFIED, SDK null은 UNAVAILABLE, 예외·timeout·오류 enum은 ERROR, 마지막 관측 age >5000ms는 STALE이다. SDK 경로는 실패해도 PLEOS이고 USER_REPORTED 육안 기록과 별개다. GET/render는 callback 수신 시각을 갱신하지 않는다.

변경은 재생 가능한 전수 목록 생성기·검증기, 기존 Component adapter의 Debug 관측 로그, 실제 WebView 검증 도구다. 로그는 capability/current/event 및 로컬 unsubscribe/release를 구분하며 예외 메시지를 기록하지 않는다. 로컬 release 반환은 원격 정리 acknowledgement가 아니다. 기존 SDK·UI 연결을 다시 만들지 않는다.

## 재실행

```powershell
python -B -m unittest discover -s tools/component-probe -p 'test_*.py' -v
python tools/component-probe/inventory.py --out docs/contracts/pleos-public-api-inventory.md
python tools/component-probe/check.py sdk-audit --out C:/CarScope-External/p7-a/sdk-audit
npm ci --ignore-scripts --prefix tools/three-poc
node tools/three-poc/build-android-inspection.mjs
node tools/three-poc/build-android-lab.mjs
.\gradlew.bat '-PcoreOnly=true' :vehicle-core:test --rerun-tasks --console=plain
.\gradlew.bat :app:assembleDebug :app:assembleRelease :app:bundleRelease :app:testDebugUnitTest :app:lintDebug --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'
python tools/component-probe/check.py boundary
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
```

AVD는 정확히 `CarScope_Pleos_API34`, serial `emulator-5554`, API34/user10을 확인한다. 기존 AVD를 재사용하며 CPU load/RAM 경고만으로 보류하지 않는다. 원본 로그·캡처·AAR·APK는 Git 밖에 둔다. 실제 실행 결과와 명령/증거 인덱스는 [P7-A evidence](evidence/p7-a/README.md)에 기록한다.

## 실제 AVD 결과

SDK 2.3.2, Service 2.3.22/code74. 모든 상태 채널은 PLEOS였고 MOCK 대체가 없었다. Native cache JSON과 실제 JS store의 readings가 네 채널 모두 일치했다. 기존 washer/brake/battery/charge/wiper/light/tire 7개 상세 패널을 실제 CDP pointer로 선택하고 native 화면을 캡처했다. 수신 후 5초가 지난 값은 STALE이고 이전 callback 수신 시각과 원시 값을 유지했다.

| feature | 실제 capability / 수신 | 3D 상태 |
| --- | --- | --- |
| washer | capability timeout | ERROR, 값 없음 |
| brake | SDK failure callback, type `a` | ERROR, 값 없음; 지원 부재로 추측 분류하지 않음 |
| SoC | readable=true, current/event 100 | 원시 Integer 의미 UNVERIFIED → age 초과 STALE, `%` 아님 |
| charge switch | readable=true, current false | STALE, 충전 진행 판정 아님 |
| charge port | readable=true, event false | STALE; 늦은 current 무시 |
| wiper | OFF/ON/SERVICE advertised, event OFF | STALE; 전면 유리 공통 |
| low beam | OFF/ON advertised, event OFF | STALE; 전역 보고 |
| high beam | OFF/ON advertised, event ON | STALE; 전역 보고 |
| tire pressure ×4 | capability timeout | ERROR, raw 관측 없음 |
| tire low-pressure ×4 | READ/areas=[] | 기존 계약의 UNVERIFIED 유지, 관측 없음 |

기존 error/unsupported 경로를 실제 지원 성공으로 세지 않는다. 권한 grant와 실제 capability 응답도 서로 다르다. **AVD 화면 전환 회귀는 FAIL**: 마지막 정상 패널 뒤 focus-loss 5018ms ANR 및 앱 종료가 발생하여 이후 기기 조작을 중단했다. bugreport에서 main은 HWUI drawFrame을 기다리고 RenderThread는 QEMU GL encoder pipe에서 관측됐으며, SDK workers는 queue를 기다리고 있었다. root cause 전체를 확정하거나 GPU/메모리/SDK 단독 원인으로 단정할 근거가 부족하다. 진단 단계는 원인 분석 스킬에 따라 미확정 상태로 남기고 증명되지 않은 완화 패치를 추가하지 않았다.

## Native QR · 최대 부품 커버리지 추가 범위

전체 선택 부품/자식 및 외부 GLB의 mesh node 44개는 [부품 매핑](contracts/p7-part-coverage.md)에 정리했다. SDK UNSUPPORTED가 모바일 사용자 점검을 차단하지 않는다. schema와 Native/서버가 아직 연결되지 않은 기능은 임의 성공 처리하지 않는다.

Native 기존 6개 task(washer-fluid, tire.front-left/right/rear-left/rear-right, ev-charge.port)에 `brake-fluid`를 추가했다. 기존 모바일 schema v2의 정확한 response key 세 개를 `SyncChecklistTasks.profiles`에 등록한다. 공통 QR·HTTPS·polling·만료·취소·digest·명시적 Accept 구조를 재사용하고 추가 task도 검토된 profile과 계약 벡터로 확장한다. B 작업 사본의 기존 brake task와 key를 대조했고 B의 추가 작업/미커밋 파일은 가져오지 않았다.

실제 모바일 생성기로 만든 브레이크액 108개 응답/aids 조합의 canonical bytes와 SHA256이 Native와 일치했다. 로컬 테스트 인증기관·실제 TLS/SQLite 서비스·실제 모바일 SyncClient·Native controller를 사용한 7-task E2E는 QR invitation → claim → 모바일 제출/ACK → Native RESULT_SUBMITTED → 명시적 Accept → 모바일 ACCEPTED까지 PASS다. Native Activity Robolectric 테스트는 새 task 선택, 실제 QR bitmap decode, 세 응답 표시, 중복 Accept 방지까지 확인한다. 이는 실제 폰 광학 스캔 또는 AVD Native QR 실행 증거가 아니다.

## 최종 기계 검증과 잔여 조건

app 205 tests PASS, core 37 PASS/1 SKIP(외부 자산), 3D Node 81 PASS, Android assets 1 PASS, sync Node 107 PASS/4 SKIP(Postgres 미설정). Debug APK/Release APK/Release AAB/lint PASS(0 errors, 23 warnings). Component/Tire/Identity/Sync 경계와 Native 합성 serializer 계약 PASS. 신규 체크리스트 코드·QR·HTTP·권한은 Debug에만 남고 Release 경계는 유지된다. Geometry 변경이 없어 자산 생성/Anatomy geometry 검사는 이 변경의 로컬 gate로 실행하지 않았다.

실제 기기 lifecycle/도어 전체 회귀, 워셔액·브레이크액·타이어 실제 성공값, AVD Native QR/실제 폰 E2E, B 추가 task의 Native/서버 연결은 미완료다. CI 성공으로 이 제한을 덮지 않는다. ANR가 해소되기 전 PR은 draft 검토 상태로 두며 자동 병합하지 않는다.
