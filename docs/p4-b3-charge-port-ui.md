# P4-B3b 충전구 3D 선택 및 상태 패널

B3a [PR #48](https://github.com/ppsssj/CarScope/pull/48)의 Native/독립 EV Charge UI v1 위에서 UI를 연결한다. 이 PR은 선행 브랜치를 base로 하며 #48 병합 뒤 main retarget/재검증이 필요하다. 자동 병합하지 않는다.

## 구현 범위

- `sourceWorldParts`는 아직 synthetic part/hood pivot이 없는 원본 GLB 전체 mesh를 읽는다. indexed/nonindexed, 중첩 월드 transform을 반영해 `(x,y,z)m → (100x,-100z,100y)cm`로 변환한다. 원본 vertex/index/local transform은 쓰지 않는다. skinned/활성 morph/잘못된 triangle은 거부한다.
- PR #47의 `measureEvChargePortSupport(sourceParts)` → `buildEvChargePort({support})`를 그대로 사용한다. build 전후 모든 source world triangles의 동일성을 비교한다. 정렬 실패는 항목을 비활성화하며 기본 위치나 부분 표면만의 측정으로 대체하지 않는다.
- 목록 `EV 충전구`, 우측 후방 카메라, `userData.partId` 기반 port/flap 각각의 canvas 선택·강조, Back→전체 보기 및 요약·종료를 제공한다. 전체 scene의 가장 가까운 visible mesh Raycast를 사용해 차체 뒤 관통 선택을 막는다.
- 형상은 `ESTIMATED_GEOMETRY` / `STATIC_CLOSED_ILLUSTRATION`으로 유지한다. SDK 보고 변경은 독립 상태 DOM만 갱신하고 position/rotation/vertex/index/선택/카메라/USER_REPORTED 기록을 변경하지 않는다. 충전·잠금·안전/실차 닫힘·힌지각을 합성하지 않는다.
- 세로 화면에서 전체 보기의 기존 고정 카메라가 충전구 투영점을 화면 위(-27.56 px)로 보내는 문제를 실제 Chrome에서 발견했다. 원본 차량 AABB와 기존 boxDistance를 재사용하여 전체 보기/요약을 usable viewport에 맞춘다. 모델을 옮기거나 테스트 투영점 조건을 완화하지 않았다.

변경 공통 파일은 inspect.js/inspection-flow.mjs의 새 독립 상태와 카메라/선택/패널, serve.mjs의 고정 module·MOCK fixture 경로, Debug asset 복사 목록과 패키징 검사다. Geometry·치수·좌표·GLB·Native SDK·권한·vehicle-core·모바일/Sync·Release 정책은 변경하지 않는다. README/다른 모델 문서도 범위에 포함하지 않는다.

## 재현과 범위

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm test --prefix tools/three-poc
npm run test:android-assets --prefix tools/three-poc
$env:CARSCOPE_IONIQ5_GLB='C:/CarScope-External/ioniq5-carscope/hyundai_ioniq_5_2022.glb'
# PR #48 CI serializer의 EV_CHARGE_UI_SYNTHETIC_JSON을 외부 파일로 추출한다.
node tools/three-poc/check-charge-port.mjs C:/CarScope-External/p4-b3/browser-fit C:/CarScope-External/p4-b3/native-charge.json
node tools/three-poc/check-charge-port.mjs C:/CarScope-External/p4-b3/browser-portrait-fit C:/CarScope-External/p4-b3/native-charge.json 900 1200
# 기존 check-component-status / check-ev-status / check-tire-status / check-inspection-product도 그대로 실행한다.
```

실제 Kotlin MOCK JSON과 실제 외부 GLB를 Chrome에 연결한 desktop 검증이다. Android WebView Runtime/AVD/실차 권한·capability·getter·listener는 NOT_RUN이다. Kotlin/Robolectric은 B3a와 전체 CI로 확인한다. 캡처/로그는 Git 밖에 보관하고 [증거 인덱스](evidence/p4-b3-ui/README.md)에 결과를 둔다.
