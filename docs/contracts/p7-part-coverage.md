# P7 부품 · SDK · 모바일 계약

현재 제품의 선택 가능한 부품 및 원본 GLB 전체 mesh-node를 대상으로 한다. 개별 삼각형·캡·덮개 같은 자식 메시에는 부모 기능의 상태가 적용되며 별도 센서로 취급하지 않는다. Geometry를 추가하거나 이름으로 SDK area를 추측하지 않는다.

모바일 계약은 현재 main과 Codex B 작업 사본 `C:/dev/CarScope-p7-ar`의 `inspection-tasks.mjs`, `brake-result.mjs`를 읽어 대조했다. Native에서 활성화한 task는 기존 6개 + `brake-fluid` 1개다. B의 진행 중인 추가 task는 로컬 모바일 기능과 Native/서버 end-to-end 지원을 구분한다. B의 미커밋 파일을 이 PR에 복사하지 않는다.

## 선택 가능한 기능별 매핑

| 3D 부품/자식 | SDK 연결 | Native QR task / schema | 추가 모바일 계약 상태 |
| --- | --- | --- | --- |
| `washer-fluid-cap` / washer cap 자식 | Safety low-washer warning; 특정 캡 센서 아님 | `washer-fluid` / 1 | 기존 지원 |
| `brake-fluid-reservoir`, `-cap` | Safety brake fluid level | `brake-fluid` / 2 | 이번 Native 확장, 기존 모바일와 동일 |
| `coolant-reservoir`, `-cap` | 해당 냉각수 액면 API 없음: UNSUPPORTED | 미등록 | B `coolant-reservoir`; 별도 schema/서버 검증 후 Native 등록 가능 |
| `lcw-coolant-reservoir` 예약 영역 | LCW 구분/액면 API 없음: UNSUPPORTED | 미등록 | B `lcw-coolant-reservoir`; 현재 3D 선택은 준비 중 |
| `battery-12v`, `-lid`, `-terminal-1/2` | 해당 12V 전압·건강도·외관 API 없음: UNSUPPORTED; EV SoC 대입 금지 | 미등록 | B `battery-12v` |
| `fuse-box`, `-lid` | 퓨즈 상태 API 없음: UNSUPPORTED | 미등록 | B `fuse-box` |
| `ev-battery.pack` 및 하부 팩 자식 | EV SoC/charge-switch; 원시 Integer 단위 미검증 | 미등록 | 고전압 팩을 12V 점검으로 연결하지 않음 |
| `ev-charge.port`, `ev-charge.flap` 및 외곽 자식 | 단일 port-open Boolean 공유, deprecated 읽기 경로 | `ev-charge.port` / 2 | 기존 지원, flap 전용 task 생성 안 함 |
| `tire.front-left` / `Wheel_0_1` | Tire LEFT_FRONT pressure/low-pressure | `tire.front-left` / 2 | 기존 지원 |
| `tire.front-right` / `Wheel_0_0` | Tire RIGHT_FRONT pressure/low-pressure | `tire.front-right` / 2 | 기존 지원 |
| `tire.rear-left` / `Wheel_1_1` | Tire LEFT_REAR pressure/low-pressure | `tire.rear-left` / 2 | 기존 지원 |
| `tire.rear-right` / `Wheel_1_0` | Tire RIGHT_REAR pressure/low-pressure | `tire.rear-right` / 2 | 기존 지원 |
| `wiper.front.left/right` / 암·블레이드 자식 | FRONT_WINDSHIELD 작동 상태 공유, 각도·마모 센서 없음 | 미등록 | B `wiper.front.left`, `wiper.front.right` |
| `light-low-beam-left-0/right-0` | 전역 low-beam 작동 상태 공유, 외관/광도 API 없음 | 미등록 | B 각 모델 선택 ID와 동일 |
| `light-high-beam-left-0/right-0` | 전역 high-beam 작동 상태 공유, 외관/광도 API 없음 | 미등록 | B 각 모델 선택 ID와 동일 |
| 보닛·frunk·shell·zone·수납부·floor 자식 | 현 어댑터 미연동: UNVERIFIED; 형상 개폐는 SIMULATION_ONLY | 미등록 | 모바일 점검 가용성과 SDK 지원을 독립 결정 |

## 원본 GLB 전체 노드의 잔여 매핑

외부 참조 GLB SHA256 `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1`. mesh를 가진 node 44개를 실제 JSON chunk에서 열거했다. Wheel 및 low/high-beam 8개는 위 표에 대응하고 나머지 36개는 아래에 모두 기록한다. SDK API의 존재와 차량/좌우/area의 대응을 확인하지 않은 노드는 연결하지 않는다.

| 노드 (정확한 이름) | SDK 연결 가능성 / 현재 경계 | 모바일 |
| --- | --- | --- |
| `Body`, `Body_Glass`, `Interior_Static`, `Lamp_Housings` | 집합 메시, 단일 부품 센서가 아님. 외관 상태 API UNSUPPORTED | task 미정 |
| `Brake_Caliper_0_0`, `Brake_Caliper_0_1`, `Brake_Caliper_1_0`, `Brake_Caliper_1_1` | Brake pedal 신호는 캘리퍼 마모/상태가 아님. 해당 API UNSUPPORTED | task 미정 |
| `Door_Left_0`, `Door_Left_1`, `Door_Right_0`, `Door_Right_1` | 공개 Door API 존재. 기존 ROW_1_LEFT → FRONT_LEFT만 메인 SVG에서 검증. GLB node와 SDK area identity는 UNVERIFIED, 임의 재매핑 금지 | task 미정 |
| `Door_Front_0`, `Door_Rear_0` | 모델 보닛/후부 개폐 메시. SDK 대응·area 미검증, UNVERIFIED | task 미정 |
| `License_Plate_0`, `License_Plate_1` | 번호판 외관 API UNSUPPORTED. identity/VIN 조회로 대체하지 않음 | task 미정 |
| `Light_Brake_Center_0`, `Light_Brake_Left_0`, `Light_Brake_Right_0` | 외관/고장 진단 API UNSUPPORTED. Brake pedal을 램프 점등으로 해석하지 않음 | task 미정 |
| `Light_Day_Left_0`, `Light_Day_Right_0` | DAYTIME_RUNNING enum을 별도 DRL node 센서로 해석하지 않음, UNVERIFIED | task 미정 |
| `Light_Indicator_Left_0`, `Light_Indicator_Left_1`, `Light_Indicator_Left_2`, `Light_Indicator_Right_0`, `Light_Indicator_Right_1`, `Light_Indicator_Right_2` | 공개 TurnSignal 후보 존재, node/area 대응과 실제 지원 UNVERIFIED | task 미정 |
| `Light_License_Plate_0`, `Light_License_Plate_1` | 해당 node의 독립 외관/고장 신호 없음, UNSUPPORTED | task 미정 |
| `Light_Reverse_Left_0`, `Light_Reverse_Right_0`, `Light_Tail_Left_0`, `Light_Tail_Right_0` | Gear/Light 도메인의 선언을 이 node에 임의 대응하지 않음, UNVERIFIED | task 미정 |
| `Mirror_Side_Left_0`, `Mirror_Side_Right_0` | 공개 SideMirror 후보 존재. area·capability·실제 수신 UNVERIFIED | task 미정 |
| `Steering_Wheel` | 공개 SteeringWheel 후보 존재. 데이터 의미·실제 지원 UNVERIFIED | task 미정 |

## Native 체크리스트 확장 규칙

`SyncChecklistTasks.profiles`는 명시적 taskId, 표시 이름, 정확한 response key와 라벨을 보관한다. decoder는 profile의 정확한 key 집합, schemaVersion=2, 허용 enum, status 재계산, canonical timestamp, USER_REPORTED/MOBILE/SELF, digest 및 session task 일치를 검사한다. runtime 파일/Intent/SDK 응답으로 profile을 등록하지 않는다.

브레이크액은 response key `levelMarking`, `leakTrace`, `exteriorDamage`, answer `FOUND|NOT_FOUND|UNABLE`다. 하나라도 FOUND면 REVIEW_NEEDED, 없고 UNABLE이 있으면 UNABLE, 모두 NOT_FOUND면 NO_FINDINGS_REPORTED다. `%`, SDK 값, 좌표, 차량 인증 필드를 추가하지 않는다. SDK capability가 UNSUPPORTED여도 이 사용자 점검을 차단하지 않는다.

추가 부품은 B의 taskId·response key와 서버 validator가 병합된 후 profile 및 모바일→서버→Native 계약 벡터를 함께 추가한다. 공통 QR 생성·단일 초대 claim·polling·digest 고정·명시적 Accept·취소·만료·lifecycle·인증/TLS 경로를 그대로 재사용한다. Native 수신 성공은 3D의 SDK 관측 또는 육안 점검 완료를 자동으로 만들지 않는다.
