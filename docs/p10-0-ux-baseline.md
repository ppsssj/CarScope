# P10-0 3D 부품 UX 기준선

P10 개편 전의 카메라, 선택, 강조, 라벨, 상태 전환을 19개 부품과 4개 화면에서 측정해 고정했다. **제품 코드는 바꾸지 않았다.** 측정은 데스크톱 Chrome이며 AVD, Android WebView, 실제 터치, 스마트폰은 `NOT_RUN`이다. 결과는 [증거 인덱스](evidence/p10-0/README.md)에 있다.

## 구성

| 파일 | 역할 | 실행 위치 |
|---|---|---|
| `tools/three-poc/test/browser-part-ux-baseline.mjs` | 실제 GLB 페이지 측정과 판정 | 로컬 (GLB가 저장소에 없음) |
| `tools/three-poc/test/part-ux-known-issues.mjs` | Known Issue 26건 목록 | 공통 |
| `tools/three-poc/test/part-ux-metrics.mjs` | 판정 규칙 | 공통 |
| `tools/three-poc/test/part-ux-known-issues.test.mjs` | 목록과 규칙 검사, GLB 없이 볼 수 있는 결함 | CI |
| `tools/three-poc/test/part-ux-baseline.json` | 기준 수치 | 비교 기준 |

## 결함이 CI를 막지 않는 방식

**CI:** GLB 없이 확인할 수 있는 결함 3건(P0-3, P1-7, P2-9)은 `todo` 테스트다. 의도적으로 실패하고 `# TODO`로 표시되며 실행 결과는 성공이다. 같은 항목에 현재 동작을 고정하는 일반 테스트를 함께 두어, 수정 PR 전에 동작이 우연히 바뀌면 CI가 실패한다.

**로컬 측정:** 항목마다 "수정됐다"는 조건이 있고 결과를 다음과 같이 나눈다.

| 결과 | 뜻 | 실행 실패 |
|---|---|---|
| `KNOWN_ISSUE` | 아직 열려 있음 | 아니요 |
| `FIXED` | 목록에 수정으로 표시했고 조건도 충족 | 아니요 |
| `FIXED_UNDECLARED` | 고쳐졌는데 목록에 표시하지 않음 | **예** |
| `REGRESSION` | 수정으로 표시했는데 조건이 깨짐 | **예** |
| `NOT_MEASURED` | 스크립트로 판정할 수 없음 (`PASS`로 세지 않음) | 아니요 |

기준 수치와 달라져도 실패한다(`DRIFT`). 의도한 변경이면 그 PR에서 기준선을 다시 쓰고 차이를 리뷰한다.

## 수정 PR의 절차

1. 목록의 `status`를 `FIXED`로 바꾼다.
2. 해당 `todo`를 일반 테스트로 바꾸고, 현재 동작 고정 테스트를 지운다.
3. 측정을 다시 실행하고 기준선을 갱신한다. `part-ux-baseline.json` 차이가 의도한 변경만 담는지 리뷰한다.

조건 완화, 검사 제외로 통과시키지 않는다.

## 재현

```powershell
npm ci --ignore-scripts --prefix tools/three-poc
npm ci --ignore-scripts --prefix tools/mobile-ar-poc
Set-Location tools/three-poc
$env:PORT='8198'; $env:CARSCOPE_IONIQ5_GLB='C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb'; node serve.mjs
# 다른 터미널 (약 8분)
$env:CARSCOPE_3D_TEST_URL='http://127.0.0.1:8198/inspect.html?capture=1'
$env:CARSCOPE_EVIDENCE_DIR='C:\CarScope-External\p10\p10-0\YOUR-RUN-ID'
npm run test:part-ux-baseline
# 의도한 변경의 기준선 갱신에만
$env:CARSCOPE_P10_WRITE_BASELINE='1'; npm run test:part-ux-baseline
```

CI 범위는 `npm test --prefix tools/three-poc`이다.

## 측정 방법의 한계

- **입력:** 데스크톱 포인터다. 손가락 크기, 핀치, 실제 터치는 측정하지 않았다.
- **동작 줄이기:** 자세 측정은 `reducedMotion`으로 대기를 줄였다. 카메라 경로만 일반 동작으로 측정한다.
- **차체 통과:** 차체 근사 상자로 판정한다. 상자 안 프레임은 강한 근거지만 정확한 충돌 판정이 아니고, 샘플링이므로 연속 경로의 증명도 아니다. 프레임 수는 실행 속도에 따라 달라, 기준선에는 전환별 통과 여부만 남긴다.
- **터치 폭:** 화면 상자를 격자로 나눈 추정치다.
- **색:** 선택 부품 픽셀의 평균이며 조명과 시점의 영향을 받는다. 기준 비교에는 쓰지 않는다.
- **QR 단계:** 스크립트 어댑터로 넣었다. 실제 Native 동작이 아니다.
- **강조 강도:** 타이어만 페이지에서 읽을 수 있다. 다른 부품은 코드 값이다.
