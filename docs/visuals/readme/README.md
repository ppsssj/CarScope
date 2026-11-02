# README 이미지 출처와 편집 기록

기준 main `e9cb10901c21a0958c2c26a98c4c75ad26fde7f1`에서 기존 캡처만 선별했다. 새 촬영·앱 기능 개발·AVD·Android 빌드·GLB 변환은 실행하지 않았다. 원본 파일은 이동·변경하지 않았다. 이 폴더에는 사용자가 요청한 **선별·최적화 파생 이미지**만 보관하며 SDK/GLB/원본 로그·캡처를 복사하지 않는다.

## 선택한 화면

| WebP | 기존 원본 | 화면의 의미와 한계 |
|---|---|---|
| `hero-vehicle.webp` | 저장소 `docs/visuals/p3-a4/hero-home.webp` | 실제 Chrome의 3D 차량 홈. 기존 README Hero를 재사용 |
| `hood-open.webp` | 저장소 `docs/visuals/p3-a4/flow-2-hood-open-components.webp` | P3-A4 보닛 개방·워셔액 안내, 추정 형상·축 시뮬레이션 |
| `tire-inspection.webp` | 외부 `p4-a1/20261102-run02/browser-tire-inspection-1600/02-checklist-completed.png` | 차량 3D 타이어 선택과 USER_REPORTED 체크리스트. 실제 차량 진단 아님 |
| `charge-port.webp` | 외부 `p5-b1/charge-browser/00-static-geometry.png` | 정적 추정 충전구와 MOCK 상태 패널 |
| `wiper-selection.webp` | 외부 `p5-b1/browser-final/01-wiper-sdk-on.png` | 실제 UI의 와이퍼 선택/강조, 정적 추정 형상·MOCK 상태 |
| `headlight-selection.webp` | 외부 `p5-b1/browser-final/02-light-sdk-global.png` | 기존 조명 메시 선택과 전역 MOCK 상태. 좌우 센서/실제 점등 아님 |
| `mobile-assistance.webp` | 외부 `qr-ar-01/p5-a1/20261103-run02/tires/02-camera-marker.png` + `qr-ar-01/p5-a2/20261103-types-final/mobile/charge/01-confirmed.png` | 실제 구현 UI의 합성 타이어 카메라 수동 표시 + 충전구 확정. 두 캡처의 편집본이며 실제 폰·실물 인식 아님 |

외부 경로의 루트는 `C:/CarScope-External/`다. P5-B1은 PR #51로 main에 병합된 구현이며 작업 브랜치의 미병합 기능을 가져오지 않았다. 출처별 검증은 [P5-B1 증거](../../evidence/p5-b1/README.md), [P4-A1 제품 흐름](../../p4-a1-inspection-product-flow.md), [P5-A1 증거](../../evidence/p5-a1/README.md), [P5-A2 증거](../../evidence/p5-a2/README.md)를 따른다. 새 Runtime·실기기 결과로 전용하지 않는다.

## 변환과 재현

Pillow 12.0.0의 WebP encoder로 RGB 변환 후 원래 비율을 유지해 최대 1280×900으로 축소했다(확대 없음). 일반 캡처는 quality 88/method 6. Hero는 기존 WebP에서 같은 설정으로 재인코딩했다. 메타데이터(EXIF/XMP/ICC)는 복사하지 않았다.

모바일 편집본은 두 기존 캡처의 상단 390×844 영역을 각각 비율 유지 축소하여 1200×750 배경에 나란히 배치했다(quality 90/method 6). UI 요소를 그리거나 상태·문구·응답을 조작하지 않았다. 프레임 아래 긴 안내 일부는 잘렸으므로 README 캡션에 2D 수동 표시·합성 영상·미측정 한계를 명시한다. 원본의 실제 점검 상태를 바꾼 합성 화면이 아니다.

[manifest.json](manifest.json)에 입력 경로·SHA-256·원본 크기·crop 좌표·출력 크기·파일 크기·편집 방법을 기록했다. 독립 실행 소스가 없는 외부 캡처를 재촬영하지 않고 기존 입력을 확인할 수 있도록 했다.

## 민감정보·출처 검토

- 각 원본/출력 화면을 육안 검토했다. 새 선별 이미지에는 QR, invite/submit/receiver 토큰, 실제 VIN·GPS·개인 연락처·계정·개인 영상이 없다. 3D 차량의 `VEVALABS` 번호판 표시는 커뮤니티 모델의 텍스처이며 실제 사용자 차량 번호가 아니다.
- 상태 패널의 MOCK·관측 시각은 테스트 fixture다. 실차 데이터 또는 실제 기기 수신 성공으로 표시하지 않는다. 기존 README의 과거 QR 캡처는 이번 작업에서 수정하지 않았으며 새 갤러리에는 QR 화면을 넣지 않았다.
- 모델/상표는 기존 [출처 정책](../../p2-a6-ioniq5-asset.md)을 유지한다. 3D 6장: “Hyundai Ioniq 5” © 2022 [andikapratamaw](https://sketchfab.com/andikapratamaw), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); OpenX Assets 수정 © 2026 Dogan Ulus (`MPL-2.0 AND CC-BY-4.0`). CarScope 변환·추정 Geometry·UI 렌더링·축소/WebP 변환을 표시한다. 원본 메시·GLB·Blender 파일은 배포하지 않는다.
- CarScope는 Hyundai와 무관한 프로토타입이다. 저작권 라이선스가 차량 디자인·상표 사용에 대한 공식 보증을 뜻하지 않는다는 기존 고지를 유지한다. 모바일 1장은 CarScope UI/자체 합성 입력만 포함하며 외부 3D 모델을 포함하지 않는다.

검증 범위는 WebP 디코딩/크기·출처 hash, 로컬 이미지 경로, README 기존 본문 보존, 화면 검토다. 기능 테스트·실기기/AVD·성능 실측은 새로 실행하지 않았다.

최종 확인: WebP 7장 총 **389,894 bytes(약 381 KiB)**, 입력 해시 8개 일치, README 이미지 참조 14개 모두 존재, EXIF/XMP/ICC 미포함. GitHub GFM API로 렌더링한 HTML을 로컬 GitHub 유사 CSS로 확인했다(실제 github.com 화면 캡처는 아님). Chrome 1100px/390px에서 깨진 이미지 0, 페이지 가로 넘침 없음. 외부 검토 산출물은 `C:/CarScope-External/readme-visuals/preview-results.json`, `readme-1100.png`, `readme-390.png`다. 기존 Features부터 Model/References 전까지의 기술·실행·검증·로드맵 본문은 원문과 동일하게 보존했다.
