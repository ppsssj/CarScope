# P12-E 보닛 내부 6개 부품 AI 후보 탐지 PoC

스마트폰 사진 한 장에서 보닛 내부 부품의 후보 위치를 표시하는 흐름을 모바일과 서버에 구현했다. **기능 플래그는 꺼져 있고 실제 모델은 호출하지 않는다.** 모든 동작 시험은 가짜 공급자로 했으므로 모델 정확도의 근거가 아니다. 결과는 [증거 인덱스](evidence/p12-e/README.md)에 있다.

## 판정

| 부품 | `partId` / `taskId` | 모델 클래스 | 상태 | 근거 |
|---|---|---|---|---|
| 워셔액 주입구 | `washer-fluid-cap` / `washer-fluid` | `Windshield Wiper Fluid` | `EXPERIMENTAL` | P12-C 12장 예비 평가. 상자가 캡 위에 놓임 |
| 냉각수 리저버 | `coolant-reservoir` / 같음 | `Engine Coolant Reservoir` | `EXPERIMENTAL` | 혼동 부품으로 표시된 캡 3개 모두에 상자가 겹침(IoU 0.21~0.79). 정답 평가는 아님 |
| 저전도 냉각수 리저버 | `lcw-coolant-reservoir` / 같음 | 없음 | `UNSUPPORTED` | 저전도 클래스 없음 |
| 브레이크액 리저버 | `brake-fluid-reservoir` / `brake-fluid` | `Brake Fluid` | `EXPERIMENTAL` | 소유자 수치뿐. 라벨된 근접 사진 1장은 **놓침** |
| 12V 보조 배터리 | `battery-12v` / 같음 | 없음 | `UNSUPPORTED` | 클래스 이름이 `Battery`뿐이라 12V와 고전압을 구별한다는 근거가 없음 |
| 모터룸 퓨즈박스 | `fuse-box` / 같음 | `Fuse Box` | `EXPERIMENTAL` | 소유자 수치뿐. 라벨된 사진으로 확인한 적 없음 |

**실험 가능 4개, 미지원 2개, `VERIFIED` 0개.** `EXPERIMENTAL`은 시험해 볼 수 있다는 뜻이지 동작한다는 뜻이 아니다. 어느 부품도 사전 정의한 기준으로 평가하지 않았다.

## 모델 분석

이번에 새로 호출하지 않았다. P12-C가 저장한 `run2/model-info.json`(Roboflow 메타데이터)과 `run2/results.json`(공개 사진 12장의 실제 응답)을 읽어 분석했다. 공개 페이지는 자동 접근이 막혀 있다(403). 저장소 밖의 키 파일은 열지 않았다.

### 클래스 목록

이름 26개와 숫자 `0`~`25` 26개다.

`ABS Unit`, `ATF Oil Reservoir`, `Air Filter`, `Air Filter Cover`, `Alternator`, `Battery`, `Brake Fluid`, `Cabin Air Filter Housing`, `Clutch Fluid Reservoir`, `Cold Air Intake`, `Electric Motor`, `Engine Coolant Reservoir`, `Engine Cover`, `Engine Oil Dip Stick`, `Engine Oil Fill Cap`, `Fuse Box`, `Intercooler Coolant Reservoir`, `Inverter Coolant Reservoir`, `Oil Filter`, `Oil Filter Housing`, `Power Steering Reservoir`, `Radiator`, `Radiator Cap`, `Secondary Coolant Reservoir`, `Transmission Oil Dip Stick`, `Windshield Wiper Fluid`.

### 대상 클래스의 소유자 수치

학습한 쪽이 공개한 값이며 이번 측정이 아니다. 숫자 클래스와 라벨이 나뉜 상태의 값이어서 해석에 주의가 필요하다.

| 클래스 | 라벨 수 | 테스트 대상 | Precision | Recall | mAP@0.5 |
|---|---|---|---|---|---|
| `Windshield Wiper Fluid` | 807 | 84 | 0.47 | 0.82 | 0.44 |
| `Engine Coolant Reservoir` | 901 | 96 | 0.49 | 0.89 | 0.47 |
| `Brake Fluid` | 989 | 100 | 0.47 | 0.79 | 0.41 |
| `Battery` | 706 | 73 | 0.44 | 0.78 | 0.40 |
| `Fuse Box` | 533 | 58 | 0.51 | 0.76 | 0.44 |
| `Inverter Coolant Reservoir` | 24 | 4 | 0.87 | 0.75 | 0.95 |
| `Secondary Coolant Reservoir` | 8 | 테스트 분할에 없음 | | | |

Precision이 0.5 안팎이라 **후보의 절반가량이 틀릴 수 있다고 보는 것이 맞다.** 전체 mAP@0.5도 검증 42%다.

### 질문별 답

| 질문 | 답 | 근거 |
|---|---|---|
| 6개에 대응 클래스가 있는가 | 4개는 이름이 있음. 저전도는 없음. `Battery`는 12V라고 하지 않음 | 클래스 목록 |
| 부품 전체인가 캡인가 | 워셔액만 캡으로 관찰(P12-C). 나머지는 **미확인**. 응답 상자의 중앙 면적은 사진의 0.6%(워셔액), 0.9%(브레이크액), 1.8%(냉각수), 2.5%(퓨즈박스), 5.2%(배터리)로 뜻이 다를 수 있음 | `results.json` |
| 일반과 저전도 냉각수 구별 | **못 함.** `Engine Coolant Reservoir`가 저전도 통에 나올 수 있고, `Inverter`·`Secondary`가 저전도라는 근거도 없음 | 라벨 정의 없음 |
| 브레이크액과 다른 통의 혼동 | **측정 안 됨.** 라벨된 브레이크액 캡 1개에서 `Brake Fluid`가 안 나오고 `Engine Cover` 0.55가 나옴 | P12-C |
| 12V와 퓨즈박스 구별 | **측정 안 됨.** 응답 상자가 있어도 정답 라벨이 없음 | |
| 숫자와 이름의 중복 | 대부분 쌍으로 보임(`3`=807=`Windshield Wiper Fluid`). 다만 `8`=706은 `Battery`(706)와 `Engine Oil Dip Stick`(707) 사이에서 불분명 | 라벨 수 |

**숫자 클래스는 매핑하지 않았다.** 소유자의 설명이 없고 사후 추론이기 때문이다. 이 때문에 Recall이 낮아질 수 있다(P12-C의 `3` 민감도 분석). 이름만 정확히 일치해야 후보가 되며, 시험이 전체 52개 클래스를 부품별로 돌려 확인한다.

### 왜 12V 배터리가 `UNSUPPORTED`인가

`Battery`로 상자를 내면 화면에 "12V 보조 배터리 후보"라고 말하게 된다. 그 상자가 고전압 부품이면 가장 위험한 혼동이다. 학습 사진의 대부분이 내연기관으로 보이는 점도 불리하다(`Electric Motor` 라벨 27개). 이름이 맞아 보여도 뜻이 확인되지 않아 제외했다. 위치 그림 안내는 그대로다.

## 사용자 흐름

```text
QR 점검 → 그림 안내 → [AI로 부품 위치 찾기 · 실험] (실험 부품만)
  → 외부 전송 안내와 동의 → 사진 찍기 / 갤러리 → 분석
  → 후보 표시 또는 "찾지 못했어요" → 점검으로 돌아가기 (점검은 그대로)
```

- **QR 점검에서만** 나타난다. 로컬 페이지에는 인증 수단이 없어 버튼이 없다.
- **미지원 부품에는 버튼이 없다.** 그림 안내만 나온다.
- **후보만 표시:** 점수를 숫자로 보여 주지 않는다. `확정된 위치가 아니에요`와 부품별 주의를 함께 낸다.
- **답을 바꾸지 않는다.** 점검 상태와 결과를 읽지도 쓰지도 않는다.
- **권유 금지:** 캡을 열거나 보충하거나 만지라는 문구가 있으면 시험이 실패한다.
- **동의는 사진마다** 다시 받는다.

## 구조

```text
모바일 페이지 ── POST /v1/part-detections/:partId (JPEG 1장) ──> 서버 ── provider ──> 호스팅 API
              <─ 이 부품의 후보 좌표만 ────────────────────────
```

| 파일 | 역할 |
|---|---|
| `tools/mobile-ar-poc/public/part-detection.mjs` | 지원표, 클래스 매핑, 후보 검증, 패널 상태. 순수 코드 |
| `tools/mobile-ar-poc/public/part-detection-ui.mjs` | 동의, 사진 축소, 후보 표시 |
| `tools/inspection-sync-poc/src/part-detection-route.mjs` | 인증된 중계, 제한, `hostedDetectionProvider` |
| `SessionService.detectionScope` | 전화 토큰이 어느 점검의 것인지 읽기만 함 |
| `SyncClient.detectPart`, `MobileSync.detectPart` | 토큰은 비공개 필드 그대로. 전송·상태 흐름과 분리 |

새 부품은 지원표에 한 줄을 넣으면 같은 흐름을 쓴다. 공급자는 `detect({ image })` 하나다.

## 보안과 서버

| 항목 | 값 | 방식 |
|---|---|---|
| 인증 | 이 점검의 전화 토큰 | 기존 `submitToken`. 다른 부품 403, 끝난 점검 거부 |
| 사진 | JPEG 1장, 4MiB 이하, 변 64~2048px | 본문을 읽기 전에 인증·동의·부품·호출 제한 검사 |
| 호출 제한 | 클라이언트당 분당 10, 점검당 10분에 12, 동시 2 | 기존 limiter. Render에서는 기존 `cs_rate_windows` |
| 시간 제한 | 공급자 10초, 전화 15초, 재시도 없음 | |
| API 키 | 공급자 클로저 안 | 응답, 로그, 페이지에 없음을 시험 |
| 저장 | 없음 | 메모리뿐. 파일, DB, 로그에 쓰지 않음 |
| 위치 정보 | 전화에서 다시 그려 JPEG로 인코딩 | EXIF가 빠짐. 단, 이미지에 찍힌 번호판 등은 그대로 |
| 실패 | 503 고정 코드 | 공급자 메시지를 전달하지 않음 |

**스트리밍 없음:** 페이지는 파일 입력만 쓰고 `getUserMedia`, 타이머 반복이 없다.

### Render 영향

**측정이 아니라 계산이다.** 실제 Render에서 실행하지 않았다.

| 항목 | 값 |
|---|---|
| 모델, 가중치, 추론 | 없음. 새 패키지 없음(`PART_DETECTION_OFF` 게이트) |
| 메모리 | 요청당 최대 4MiB + base64 약 5.3MiB. 동시 2개면 최대 약 19MiB |
| CPU | 크기 검사와 base64뿐 |
| 네트워크 | 사진당 최대 4MiB 받고 약 5.3MiB 보냄. 호출 제한상 점검당 10분에 최대 12장 |
| 플래그 꺼짐 | 경로, 파일, 표시 없음(404). 영향 없음 |

## 기능 플래그

- **기본 꺼짐.** 공급자를 코드로 넘겨야만 켜지고 환경변수가 없다. `PART_DETECTION_OFF` 게이트가 기본 CLI, 다른 파일, 환경변수, 모델 런타임, 새 의존성을 막는다.
- **실제 Render 진입점은 만들지 않았다.** 키 환경변수와 호스팅 클라이언트가 필요하므로 별도 승인 대상이다.

## 활성화 전 차단 사항

1. **실제 진입점:** PR #102가 병합되어 호스팅 클라이언트와 응답 파서가 `tools/vision-poc`에 있다. 복제하지 않았고, `hostedDetectionProvider`가 그 함수들과 맞는지 가짜 `fetch`로 시험했다. 이를 불러오고 키를 읽는 진입점은 만들지 않았다. Render 빌드에 `tools/vision-poc`가 필요한지도 그때 정한다.
2. **라이선스:** `yolov8n`의 AGPL-3.0 계열과 호스팅 경유의 적용 범위, 타인 소유 모델 의존([P12-C](p12-c-existing-model.md)). 법률 검토 전 공개 활성화 금지.
3. **학습 데이터 출처:** 2,378장의 원출처 미확인.
4. **외부 사진 처리:** Roboflow의 호스팅 이미지 보관 조건이 문서에서 확인되지 않았다. 동의 문구에도 그렇게 적었다. 개인정보 검토가 필요하다.
5. **정확도:** 아래 평가 전까지 `VERIFIED` 금지.
6. **운영 변경 승인:** 키 환경변수, 진입점, Start Command. WebXR 진입점과 함께 쓰려면 합친 진입점이 필요하다.

## 필요한 정확도 평가

부품별로, 권리가 확보된 사진과 사람이 검수한 라벨로 사전에 기준을 정해 평가한다.

| 부품 | 꼭 볼 혼동 |
|---|---|
| 워셔액 | 냉각수 캡. 라벨 검수, 표본 확대 |
| 냉각수 | 저전도·인버터 통, 라디에이터 캡. 캡인지 통인지 |
| 브레이크액 | 클러치액, 파워 스티어링 통. 근접 사진 미탐 |
| 퓨즈박스 | ABS, 다른 전장 상자 |
| 12V 배터리 | 고전압 부품. 통과 전까지 `UNSUPPORTED` |
| 저전도 냉각수 | 대응 클래스가 없어 이 모델로는 불가 |

실제 사용자 사진은 평가에 보내지 않는다.

## 페이지 시작 실패

CI의 시간 초과가 이 기능 때문이라는 근거는 찾지 못했고, 같은 실패가 `main`에도 있었다. 수치는 [증거](evidence/p12-e/README.md#페이지-시작-시간-초과-조사)에 있다.

- **현상:** 모듈 파일 요청 하나가 실패하면 ES 모듈 그래프 전체가 실행되지 않는다. 페이지는 메시지 없이 멈춘다. CI에서 본 트리거는 Windows의 `net::ERR_NO_BUFFER_SPACE`이다. 휴대폰의 네트워크 끊김도 같은 경로를 탈 것으로 보지만 실제 기기에서는 NOT_RUN이다.
- **수정:** `public/page-start-guard.js`. 모듈 시작 실패를 감지하면 **한 번만 자동으로 다시 불러오고**, 또 실패하면 안내와 `다시 불러오기` 버튼을 보여 준다. 진입점이 실행되기 전이라 QR 초대는 아직 쓰이지 않았다. 재시도 표시는 `history.state`에만 두고 시작에 성공하면 지운다.
- **그대로인 것:** 시간 제한, 저장소 미사용, QR·인증 계약.
- **OS 원인은 미확인:** 어떤 자원이 모자랐는지는 모른다. 측정한 수치는 임시 포트 고갈을 뒷받침하지 않는다.

## 알려진 제약

- 임계값 0.4는 평가로 정한 값이 아니라 P12-C 12장에서 오탐이 사라진 값이다.
- 네이티브 카메라로 사진을 찍는 동안 브라우저 탭이 폐기될 수 있다. 그러면 QR 연결을 복구할 수 없다. 실기기 확인이 필요하다.
- 차량 앱에서 부품을 바꾸면 새 QR이므로 새 페이지가 된다. 패널의 부품 변경 초기화는 상태 머신에서 시험했다.

## 재현

```powershell
Set-Location tools\inspection-sync-poc
npm run check; node --test test/part-detection.test.mjs
Set-Location ..\mobile-ar-poc
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p12-e\YOUR-RUN-ID'
npm run test:browser:detect
```
