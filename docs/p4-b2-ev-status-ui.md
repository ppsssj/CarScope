# P4-B2 EV 배터리 선택 및 상태 패널

선행 조건: A의 모델 PR #44(main `5c06646`)가 병합됐다. B의 데이터 PR #45를 기반으로 한 별도 UI 통합 PR이다. PR #45를 임의 병합하지 않으며 해당 브랜치를 base로 사용한다. #45 병합 후 main으로 retarget해야 한다.

공통 파일 변경 이유/범위: `tools/three-poc/inspection-flow.mjs`에 보닛과 독립적인 EV 배터리 보기 상태, `inspect.js`에 기존 A builder 사용과 하부 카메라/상태 패널, Android 자산 패키징 검사에 해당 모듈 포함을 추가한다. A의 Geometry 파일, 치수, 부품 ID, GLB, InspectionActivity와 SDK·Sync 코드에는 변경하지 않는다. A의 모델 변경과 겹치는 파일은 없다.

기존 `ev-battery.pack` 외함을 좌표·삼각형·메타데이터 그대로 사용한다. 하부 보기 동안 바닥 장식만 숨기고 차체와 배터리의 실제 깊이 검사를 유지한다. 차체를 뚫고 선택하지 않는다. `battery-12v`와 별개이며 내부 모듈·커넥터·정비 절차를 추가하지 않는다.

SoC는 SDK raw Int32, 단위/범위 미검증으로 표시한다. 충전 스위치 Boolean은 충전 진행 상태가 아니다. 데이터 source/capability/availability/observedAt은 PR #45의 캐시 계약을 유지하며 사용자 점검 기록과 모델의 ESTIMATED_GEOMETRY를 별개로 표시한다. 정상·안전 판정을 만들지 않는다.

공통 문서 README에는 이 데이터 경로와 검증 제한을 안내하는 짧은 링크만 추가한다. desktop 서버에는 해당 모델 모듈 하나의 허용 경로를 추가한다. 광범위한 파일 노출이나 WebView 네트워크 정책 변경은 없다.

AVD/adb/실차 API·권한·capability·실측은 NOT_RUN이다. 실행 결과는 [증거 인덱스](evidence/p4-b2/README.md)에 기록한다.
