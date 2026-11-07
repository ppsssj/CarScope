# P12-A2 19개 부품 시각 안내

[P12-A](p12-a-part-photo-guide.md)의 화면을 `INSPECTION_PARTS` 19개 전체로 넓혔다. 부품마다 위치 그림과 상세 그림이 있고, 모바일 점검이 있는 17개는 점검 화면에, 점검이 없는 2개는 별도 정보 페이지에 나타난다. **그림 38장은 모두 CarScope가 그린 설명용 그림이고 이것이 최종 방식이다([P12-A3](p12-a3-schematic-only.md)).** 결과는 [증거 인덱스](evidence/p12-a2/README.md)에 있다.

## 그림

`tools/mobile-ar-poc/build-guide-art.mjs`의 공통 템플릿이 만든다. 고칠 때는 생성기를 바꾸고 `npm run build:guide-art`를 실행한다. 커밋된 파일과 생성 결과가 다르면 테스트가 실패한다. 설명서 그림, 사진, 3D 모델 데이터는 옮겨 그리지 않았다.

| 그룹 | 위치 그림 | 상세 그림 |
|---|---|---|
| 보닛 6개 | 위에서 본 차와 보닛 안 구역 지도. 해당 구역 강조, 나머지 구역은 흐리게 | 캡 표시, 눈금 통, 12V 상자, 닫힌 퓨즈 덮개 |
| 타이어 4개 | 위에서 본 차, 해당 바퀴 강조 | 옆면·바닥 면과 작은 위치 표시 |
| 와이퍼 2개 | 앞유리 아래 해당 쪽 강조 | 암과 고무 날, 쪽 표시 |
| 전조등 4개 | 앞쪽 해당 모서리 강조 | 하향·상향 빛줄기 표시 |
| 충전구, 덮개 | 차체 뒤쪽 오른쪽 옆 | 단자 일반 모양, 닫힌 덮개 |
| 배터리 팩 | 옆에서 본 차의 바닥 아래, 주황색 점선 | 팩과 주황색 케이블, 고전압 경고 |

### 위치의 근거와 한계

**구역은 실제 위치가 아니다.** `참고 배치 예시`라고 그림에 쓰고 `vehicleApplicability.scope`를 `REFERENCE_LAYOUT_EXAMPLE`로 둔다. P12-A의 워셔액 그림은 보닛 전체만 강조했으나, 이번 요청에 따라 구역을 표시하고 예시임을 명시했다.

| 부품 | 구역 | 근거 |
|---|---|---|
| 워셔액 | 오른쪽 바깥 뒤 | [P3-A2.3](p3-a2-3-service-components.md) 관찰, 추정 형상 y −52~−44 |
| 냉각수 | 오른쪽 안쪽 가운데 | 레지스트리 `location` |
| 저전도 냉각수 | 오른쪽 안쪽 앞, **점선** | P3-A2.3 관찰만. 레지스트리 형상 `NONE`, 없는 차도 있음 |
| 브레이크액 | 왼쪽 안쪽 뒤 | 레지스트리 `location` |
| 12V 배터리 | 왼쪽 안쪽 앞 | 레지스트리 `location` |
| 퓨즈박스 | 왼쪽 바깥 가운데 | 레지스트리 `location` |

- 레지스트리와 그림의 좌우·앞뒤가 어긋나면 테스트가 실패한다. 근거 자체는 한 차종의 설명서 그림 해석이며 `ESTIMATED`다.
- **좌우:** 차에 앉아 앞을 보는 기준이다. 위에서 코를 위로 본 그림의 왼쪽이 차량 왼쪽이다.
- **같은 위치인 부품:** 하향·상향등은 같은 모서리, 충전구와 덮개는 같은 자리다. 내부 배치나 분리를 단정하지 않기 위해 위치를 일부러 같게 그렸고, 이름과 상세 그림으로 구분한다. 그래서 위치 강조가 서로 다른 조합은 19개 전부가 아니다.
- **상향·하향등:** 상세 그림은 일반 표시 예시이며 램프 내부 구조가 아니다. 한 램프에 함께 있을 수 있다고 글과 그림에 모두 쓴다.

## 데이터와 연결

`part-guides.mjs`에 19개 항목이 있고 `partId`, `taskId`는 레지스트리와 같다. 테스트가 이를 검사한다.

- **안전 문구:** 점검이 있는 16개는 `inspection-copy.mjs`의 항상 보이는 문구를 그대로 가져온다. 복사하지 않아 점검 화면과 어긋날 수 없다. 워셔액은 P12-A 문구, 배터리 팩은 새 문구다.
- **설명서 링크:** 근거가 있는 부품에만 둔다. 충전구, 덮개, 배터리 팩은 링크가 없다.
- **문구 제한:** 열기, 만지기, 분해, 차 아래로 들어가기를 권하는 표현이 있으면 테스트가 실패한다.

## 점검이 없는 2개

`ev-battery.pack`, `ev-charge.flap`은 `taskId`가 `null`이고 그대로 둔다.

- **정보 페이지:** `public/part-info.html#<partId>`. 답변, 결과, 세션 요청이 없고, 이 두 부품 외에는 표시하지 않는다.
- **QR을 건드리지 않는다.** `parseInspectionHandoff`와 `takeMobileHandoff`를 바꾸지 않으려고 별도 페이지로 만들었다.
- **들어가는 길:** 충전구 안내(덮개, 배터리 팩)와 12V 안내(배터리 팩)의 `함께 알아 두기` 링크. 점검 중인 탭을 유지하도록 새 탭으로 연다.
- **문구:** `찾아볼 곳` 대신 `있는 곳`을 쓴다. 배터리 팩은 찾아가는 곳이 아니기 때문이다.

3D 차량 화면에서 이 페이지로 가는 경로는 없다. `tools/three-poc`는 이번 범위가 아니다.

## 부품별 지원 현황

| 부품 ID | 작업 | 연결 위치 | 3D 근거 | 위치 표시 | 안내 방식 | 설명서 링크 |
|---|---|---|---|---|---|---|
| `washer-fluid-cap` | `washer-fluid` | 점검 화면 | ESTIMATED | 구역 예시 | `SCHEMATIC_ONLY` | 있음 |
| `coolant-reservoir` | 같은 ID | 점검 화면 | ESTIMATED | 구역 예시 | `SCHEMATIC_ONLY` | 있음 |
| `lcw-coolant-reservoir` | 같은 ID | 점검 화면 | NONE | 구역 예시(점선) | `SCHEMATIC_ONLY` | 있음 |
| `brake-fluid-reservoir` | `brake-fluid` | 점검 화면 | ESTIMATED | 구역 예시 | `SCHEMATIC_ONLY` | 있음 |
| `battery-12v` | 같은 ID | 점검 화면 | ESTIMATED | 구역 예시 | `SCHEMATIC_ONLY` | 있음 |
| `fuse-box` | 같은 ID | 점검 화면 | ESTIMATED | 구역 예시 | `SCHEMATIC_ONLY` | 있음 |
| `tire.front-left`, `tire.front-right`, `tire.rear-left`, `tire.rear-right` | 같은 ID | 점검 화면 | GLB_ORIGINAL | 해당 바퀴 | `SCHEMATIC_ONLY` | 있음 |
| `ev-charge.port` | 같은 ID | 점검 화면 | ESTIMATED | 참고 예시 | `SCHEMATIC_ONLY` | 없음 |
| `ev-charge.flap` | 없음 | **정보 페이지** | ESTIMATED | 충전구와 같은 자리 | `SCHEMATIC_ONLY` | 없음 |
| `ev-battery.pack` | 없음 | **정보 페이지** | ESTIMATED | 바닥 아래 | `SCHEMATIC_ONLY` | 없음 |
| `wiper.front.left`, `wiper.front.right` | 같은 ID | 점검 화면 | ESTIMATED | 해당 쪽 | `SCHEMATIC_ONLY` | 있음 |
| 전조등 4개 (`light-*`) | 같은 ID | 점검 화면 | GLB_MARKER | 해당 모서리 | `SCHEMATIC_ONLY` | 있음 |

## 호스트와 보안

CSP, Permissions-Policy, `render-stateful.mjs`는 그대로다. `MOBILE_ASSETS`가 38개로 늘고 `MOBILE_PAGES`에 `part-info.html`이 추가됐다. P12-A의 그림 2장은 새 이름으로 교체했다. 안내와 정보 페이지는 WebXR 플래그와 무관하게 제공되므로 다음 Render 배포부터 나타난다.

## 재현

```powershell
Set-Location tools\mobile-ar-poc
npm ci --ignore-scripts
npm run check; npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p12-a2\YOUR-RUN-ID'
npm run test:browser:guide
npm run guide:gallery
```

`guide:gallery`는 19개 부품의 그림을 모은 HTML 갤러리와 PNG 연락처 시트를 저장소 밖에 만든다.

## 알려진 제약

- 그림은 위치와 표시의 개념을 설명할 뿐 실제 부품을 찾을 수 있다고 보장하지 않는다.
- 안내 문구는 저장소 규칙과 대조했지만 정비·안전 전문가의 검토를 거치지 않았다.
- Z Flip8, 실제 폴더블, 실제 Render는 `NOT_RUN`이다. 화면 크기는 viewport 시뮬레이션이다.
