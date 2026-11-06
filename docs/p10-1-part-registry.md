# P10-1 부품 레지스트리와 이름 통일

19개 부품의 ID, 이름, 영역, 모델링 출처, 카메라 분류를 `tools/three-poc/inspection-parts.mjs` 한 곳에서 관리한다. **구조 정리이며 카메라, 상태 전환, QR, 결과 계약은 그대로다.** 결과는 [증거 인덱스](evidence/p10-1/README.md)에 있다.

## 레지스트리

| 필드 | 뜻 |
|---|---|
| `id` | 부품 ID. 계약 값이므로 바꾸지 않는다 |
| `taskId` | 결과 작업 ID. 결과 대상이 아니면 `null` (EV 배터리, 충전구 덮개) |
| `area` | 점검 영역 |
| `label` | 화면에 표시하는 이름 |
| `geometrySource` | `GLB_ORIGINAL`, `GLB_MARKER`(평면 표식), `ESTIMATED`(추정), `NONE`(형상 없음) |
| `cameraClass` | `PART`, `MARKER`, `UNDERBODY`, `NONE`. **아직 동작에 쓰지 않는다.** P10-2부터 사용 |
| `status` | `available`, `preview`, `planned`. 기존 선택 규칙 그대로 |
| `location` | 패널의 모델 위치 안내 |

`INSPECTION_AREAS`, `TIRES`, `LIGHT_PARTS`, `MOBILE_TARGETS`의 이름은 이제 레지스트리에서 온다. 타이어 노드와 전조등 노드 같은 모델 연결값은 원래 파일에 남겼다.

## 이름 기준

모바일, Native, 결과 계약이 이미 같은 이름을 쓰고 있어 **그 이름을 기준으로 삼았다.** 결과 화면과 History의 이름은 바뀌지 않고, 3D 목록과 상세만 바뀐다.

| 부품 | 이전 3D 표시 | 통일 후 |
|---|---|---|
| 워셔액 | 목록 `워셔액`, 상세 `워셔액 점검` | `워셔액` |
| 저전도 냉각수 | `저전도 냉각수` | `저전도 냉각수 리저버` |
| 브레이크액 | `브레이크액 리저버` | `브레이크액` |
| 퓨즈박스 | `퓨즈박스` | `모터룸 퓨즈박스` |
| 충전구 | `충전구 외곽` | `EV 충전구` |
| 충전구 덮개 | `충전구 덮개` | `EV 충전구 덮개` |
| 와이퍼 | `차량 좌측 전면 와이퍼` | `전면 왼쪽 와이퍼` |
| 전조등 | `차량 좌측 하향등 표식` | `왼쪽 하향등` |

**유지한 안내:**

- 전조등 이름에서 `표식`이 빠져도, 실제 램프가 아니라는 배지와 본문은 그대로다.
- `차량 좌측`이 `왼쪽`이 되면서 기준이 사라지지 않도록, 와이퍼·전조등 패널에 `좌우는 운전자가 전방을 보는 기준입니다.`를 추가했다.

## 남은 이름 차이 (결정 필요)

모바일과 Native는 전조등을 `왼쪽 하향등 외관`으로 부른다. 결과 계약과 History는 `왼쪽 하향등`이다. 모바일은 다른 담당의 파일이고 결과 이름은 유지 범위라 바꾸지 않았다. **나머지 13개 결과 부품은 모든 화면에서 같다.** 테스트는 이 4건만 허용하므로 다른 차이가 생기면 실패한다.

## 변경하지 않은 것

- 부품 ID, 작업 ID, 응답 키, schema, digest, QR, 저장 기록
- 카메라, 강조, 라벨 동작, 상태 전이
- 모바일 UI, 서버, Supabase, 인증, History 코드, Android

## 재현

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
npm test --prefix tools/three-poc
```

실제 GLB 측정은 [P10-0 절차](p10-0-ux-baseline.md#재현)와 같다.
