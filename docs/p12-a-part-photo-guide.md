# P12-A 모바일 부품 사진 가이드

점검 중인 사람이 실제 부품을 찾도록 돕는 안내 화면을 모바일 점검에 넣었다. 워셔액 주입구부터 적용했고 다른 부품은 데이터만 추가하면 같은 화면을 쓴다. **실제 사진은 아직 없다.** 현재는 직접 그린 설명용 그림 2장과 텍스트로 안내하며 `PHOTO_NEEDED`로 표시한다. 결과는 [증거 인덱스](evidence/p12-a/README.md)에 있다.

> **이후 결정:** 실제 사진을 추가하지 않고 설명용 그림을 최종 방식으로 쓴다. 현재 값은 `SCHEMATIC_ONLY`다. [P12-A3](p12-a3-schematic-only.md). 이 문서의 사진 관련 내용은 당시 기록이다.

## 화면

```text
시작 단계        안전 확인 → 점검 방법 → [워셔액 주입구 찾는 법 보기] (접힘)
위치 찾기·체크리스트  어디에 있나요? · 워셔액 (접힘) → 기존 위치 문구 + 같은 안내
```

| 구성 | 내용 |
|---|---|
| 역할과 영역 | 앞유리를 닦는 워셔액을 넣는 입구, 찾아볼 곳은 보닛 안쪽 |
| 전체 그림 (`overviewImage`) | 위에서 본 일반적인 차. 보닛 전체만 강조하고 특정 지점을 찍지 않는다 |
| 상세 그림 (`detailImage`) | 앞유리·물줄기 모양 표시가 있는 캡. 색으로 구별하지 않도록 무채색으로 그렸다 |
| 확대 | 그림을 탭하면 전체 화면, `더 크게`로 확대·이동. 닫기 버튼, Esc, Back으로 닫는다 |
| 구별 특징, 안전 | 기존 점검 문구와 같은 규칙. 색만으로 판단 금지, 불확실하면 캡을 열지 않기 |
| 적용 범위 | 특정 차종의 위치가 아니라는 안내와 라벨 붙은 참고 설명서 링크 |

**별도 단계가 아니다.** 접힌 한 줄이라 그냥 지나갈 수 있고, 카메라와 WebXR 없이 볼 수 있으며 점검 상태를 읽거나 바꾸지 않는다. 안내가 없는 부품은 카드 자체가 나타나지 않고 기존 위치 문구를 유지한다.

## 데이터

`tools/mobile-ar-poc/public/part-guides.mjs`. 키는 `tools/three-poc/inspection-parts.mjs`의 부품 ID다. 레지스트리는 모바일 호스트가 제공하지 않으므로 복사하지 않고, `part-guide.test.mjs`가 `partId`와 `taskId`의 일치를 검사한다.

| 필드 | 뜻 |
|---|---|
| `partId`, `taskId` | 레지스트리의 값 |
| `title`, `role`, `area` | 이름, 역할, 찾아볼 영역 |
| `overviewImage`, `detailImage` | 그림 기록 또는 `null` |
| `identifyingFeatures`, `safetyNotes` | 구별 특징, 안전 주의 |
| `vehicleApplicability` | 적용 범위. 현재 `ANY_VEHICLE` |
| `manualReference` | 선택. 라벨, HTTPS 주소, 적용 범위 |
| `photoStatus` | `PHOTO_NEEDED` 등 |

`imageSource`와 `licenseStatus`는 **그림별로** 둔다. 한 안내의 두 그림은 출처가 다를 수 있기 때문이다. 그림 기록은 `file`, `kind`(`PHOTO`/`SCHEMATIC`), `alt`, `caption`, `imageSource`, `licenseStatus`, `vehicle`이다.

**표시 규칙(`imageProblems`):** 아래 중 하나라도 어기면 없는 그림으로 처리한다.

- `file`은 로컬 파일 이름만. 외부 주소 불가.
- `alt`, `caption`, `imageSource` 필수.
- `licenseStatus`가 `CARSCOPE_ORIGINAL`, `LICENSED`, `PERMISSION_GRANTED` 중 하나. `UNVERIFIED`는 표시하지 않는다.
- `PHOTO`는 `vehicle`의 제조사, 모델, 연식이 필수이고 화면에 함께 표시한다.
- `SCHEMATIC`에 `vehicle`을 붙일 수 없다. 그림이 특정 차량처럼 보이지 않게 한다.

**차종 단정 금지:** AVD 메타데이터와 IONIQ 5 참고 모델은 같은 실차가 아니다. 안내 본문과 그림에는 차종을 쓰지 않고, 설명서 링크에만 `Hyundai IONIQ 5 (2022, 영국판)`과 "참고 자료"를 표시한다. [P3-A2.3](p3-a2-3-service-components.md) 등 프로젝트 문서가 근거로 쓰는 주소이며 파일을 복제하지 않고 링크만 건다. 2026-11-07에 HTTP 200 PDF 응답을 확인했다.

## 쓰지 않은 자료

| 자료 | 이유 |
|---|---|
| 3D 렌더 (`docs/visuals/p3-a4/flow-3-washer-detail.webp` 등) | 워셔액 형상과 위치가 `ESTIMATED`라 실제 위치처럼 보일 위험이 크다. 모델 파생 이미지의 제품 내 배포는 라이선스·상표 판단이 남아 있다([P2-A6 7장](p2-a6-ioniq5-asset.md#7-라이선스와-커밋-정책), [P2-A7](p2-a7-ioniq5-anatomy-svg.md)). 쓰려면 별도 승인과 CC BY 표시가 필요하다 |
| 공식 설명서의 그림, 검색·쇼핑몰 사진 | 사용 허가 미확인. 복제하지 않았다 |

## 필요한 사진

| 항목 | 조건 |
|---|---|
| 워셔액: 엔진룸 전체에서 주입구 위치 | 직접 촬영 또는 서면 허가. 제조사·모델·연식·판매 지역 기록. 번호판과 개인정보 제외 |
| 워셔액: 캡 클로즈업 | 위와 같음. 표시가 읽혀야 한다 |

추가 절차: 파일을 `public/`에 넣고 `MOBILE_ASSETS`에 등록한 뒤 `kind: 'PHOTO'`와 기록을 채운다. 등록된 차종 외에는 "내 차와 다를 수 있어요"가 표시된다. 차종별로 다른 사진을 고르는 기능은 없다.

## 부품별 지원 현황

| 부품 ID | 안내 데이터 | 실제 사진 | 지금 화면의 안내 |
|---|---|---|---|
| `washer-fluid-cap` | **있음** | 필요 | 안내 + 설명용 그림 2장 |
| `coolant-reservoir`, `lcw-coolant-reservoir`, `brake-fluid-reservoir`, `battery-12v`, `fuse-box` | 없음 | 필요 | 기존 위치 문구 |
| `tire.front-left`, `tire.front-right`, `tire.rear-left`, `tire.rear-right` | 없음 | 필요 | 기존 문구와 바퀴 위치 그림 |
| `ev-charge.port` | 없음 | 필요 | 기존 위치 문구 |
| `wiper.front.left`, `wiper.front.right`, 전조등 4개 | 없음 | 필요 | 기존 위치 문구 |
| `ev-battery.pack`, `ev-charge.flap` | 없음 | 해당 없음 | 모바일 점검 작업이 아님 (`taskId` 없음) |

## 호스트와 보안

- **모듈과 그림:** `public-modules.mjs`의 `MOBILE_MODULES`, 새 `MOBILE_ASSETS`. 로컬, staging, QR·Render 호스트가 같은 목록을 쓰고 나머지는 404다.
- **CSP, Permissions-Policy 변경 없음.** 기존 `img-src 'self' blob:`로 충분하다.
- **Render 코드 변경 없음.** `mobile-page.mjs`의 목록만 늘었고 플래그와 무관하게 제공된다.
- **네트워크:** 접힌 상태에서는 그림을 요청하지 않는다. 그림은 파일당 8KiB 미만의 SVG이고 스크립트, 외부 참조를 넣을 수 없다(테스트).
- **QR:** Back이 페이지를 떠나면 일회용 연결을 복구할 수 없으므로 확대 화면을 열 때 같은 URL로 history 항목을 쌓아 Back이 확대만 닫게 한다. 설명서는 새 탭으로 연다.

## 바꾸지 않은 것

`detector.mjs`, 상태 머신, QR·인증·세션, 결과 계약, DB, Supabase, `index.html`, `tools/three-poc`, Android, Render 운영 서비스.

## 재현

```powershell
Set-Location tools\mobile-ar-poc
npm ci --ignore-scripts
npm run check; npm test
$env:POC_EVIDENCE_DIR = 'C:\CarScope-External\p12-a\YOUR-RUN-ID'
npm run test:browser:guide
```

## 알려진 제약

- 실제 사진이 없어 "실제 엔진룸 위치 사진"과 "부품 클로즈업 사진"의 목적은 아직 일부만 달성한다.
- 합성 모바일 Chrome 결과다. Z Flip8과 실제 폴더블 동작은 `NOT_RUN`이다. 화면 크기 시험은 viewport 시뮬레이션이다.
- 설명서 링크는 영국판 PDF 하나다. 한국 시장용 자료나 다른 차종의 링크는 없다.
- `그림을 불러오지 못했어요`로 바뀐 그림은 페이지를 다시 열기 전까지 재시도하지 않는다. QR 경로에서는 다시 열 수 없으므로 설명문으로 계속 진행한다.
