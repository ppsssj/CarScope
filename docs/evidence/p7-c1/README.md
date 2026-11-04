# P7-C1 증거 인덱스

원본은 `C:/CarScope-External/p7-c1/`에 보존하고 Git에는 요약/계약만 남긴다. [구현·재현](../../p7-c1-3d-mobile-results.md), [Native 인계](../../contracts/native-to-3d-accepted-v1.md).

- `final/syntax.txt`, `final/node.txt`: 새 모듈 문법 및 전체 Node 테스트. Native adapter는 `test/`의 합성 authority다.
- `browser-reviewed/results.json`: DOM Desktop 1440×960/모바일 430×900에서 17개 후보·명시 선택, 실제 GLB 페이지의 기본 주입 거절/로컬 분리/16개 선택+1개 미점검/독립 등화/SDK 불변/종료·이전 세션 callback, Native 실제 연결 NOT_RUN. 만료/취소와 비동기 검증 경합은 Node 검사에서 별도로 확인한다.
- `browser-reviewed/3d-desktop-summary.png`, `3d-detail-{1440,430}.png`, `dom-*.png`: 원본 시각·출처·상태 배지·기록 선택과 viewport. 캡처를 직접 열어 확인했다. 합성 수락 데이터이며 실제 Native 수신 캡처가 아니다.
- `regression/state-desktop-final/results.json`: 기존 로컬 타이어 상태 지도, 실제 canvas 선택·강조, 카메라 복귀, 원래 시각, 홈/재시작/새로고침/dispose.
- `regression/product-mobile-final/results.json`: 기존 제품 탐색/기록/QR/Back, Android shell JS의 Desktop 시뮬레이션. 실제 Android 실행 아님.
- `regression/visibility/`: 기존 Kotlin MOCK JSON(`C:/CarScope-External/p5-b1/native-visibility.json`) + 실제 GLB의 와이퍼/조명 선택·차폐·SDK 표시 회귀. MOCK 입력 생성은 기존 근거이며 브라우저 실행은 이번 실행이다.
- OS 임시 사본의 Android Debug 패키징 검사는 새 모듈 바이트 일치, 상대 import 해석, fake authority/GLB/Release 자산 부재를 검사한다. 실제 worktree의 `app/**`는 쓰지 않는다.

Anatomy driver SHA `1482e8469b0a9e0d8cc18ea2740a01423d29ae80`, 외부 GLB SHA `cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1` 불변. 최초 QR 미설정 회귀 FAIL은 `regression/{state-desktop,product-mobile}`에 남겼고 설정을 바로잡은 `*-final`과 혼동하지 않는다. 문법의 초기 잘못된 상대 경로는 수정 후 재실행했다.

CI는 PR의 정확한 HEAD checks에 별도로 기록한다. 실제 Native ACCEPTED→3D 적용, AVD/실차/스마트폰, 실제 app 설치·운영 HTTPS 변경은 NOT_RUN이다. 생산 페이지는 어댑터 미연결이며 실제 통합 미완료를 표시한다.

| 새 실행 gate | 결과와 범위 |
|---|---|
| `npm run check:results` | PASS, 생산 JS/새 결과 모듈 문법 |
| `npm test` (three-poc) | PASS, 106 tests. 기존 81 + 신규 mapping/상태/경계/경합 회귀 |
| `npm run test:android-assets` | PASS, 1 packaging test; OS 임시 사본, 실제 APK/AVD 실행 아님 |
| `npm run test:results-browser` | PASS, 1440×960/430×900 DOM 및 실제 참조 GLB + test-only authority, Native 실제 수락 NOT_RUN |
| 기존 state-map/product browser | PASS, 각각 Desktop 실제 canvas/타이어/카메라와 모바일 제품/Android shell JS 회귀 |
| 기존 visibility browser | PASS, 21 assertions, Kotlin MOCK 입력 + 실제 GLB의 와이퍼/등화/차폐/선택 회귀 |
| core Gradle | PASS, 38 total / 37 pass / 1 optional external-asset skip; 소스·수명주기·좌표 정책 불변 |
| app/mobile/Sync/Geometry 변경 검사 | PASS, 해당 경로 diff 없음; 원본 GLB SHA 동일 |
