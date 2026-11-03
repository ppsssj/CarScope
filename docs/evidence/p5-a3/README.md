# P5-A3 실행 증거 인덱스

원본은 아래 로컬 외부 디렉터리에만 보관하며 Git에는 인덱스만 넣는다. 토큰·세션 초대·SDK·APK·개인 설정은 포함하지 않는다. 합성 PC 브라우저/Node 테스트이며 실기기·Native/AVD/실차 근거가 아니다.

- 검증 보고: [P5-A3](../../p5-a3-brake-fluid-mobile-ar.md)
- 외부 루트: `C:/CarScope-External/qr-ar-01/p5-a3/`
- run01/sync: verify:local의 check/legacy/전체/SQLite/AR-01 로그·summary, 모두 PASS
- run03/mobile: 워셔액 16·타이어 7·충전구 6·브레이크액 6 검사 그룹 PASS
- run03/sync-debug: 11 검사 그룹 PASS
- run03/sync-mobile: 19 검사 그룹 PASS·SQLite 재시작
- run01/mobile/brake 및 run02/mobile/brake: Sync review 포인터 차단 FAIL 원본 보존
- core XML: 독립 작업 트리 `vehicle-core/build/test-results/test/` (Git 제외), 38 tests/0 failure/0 error/1 skip (`IONIQ5_PARTS not set`)

캡처는 합성 카메라와 headless 모바일 뷰포트다. full-page 캡처의 sticky header/footer는 스크롤 위치에 따라 페이지 중간에 나타날 수 있다. 02-camera/03-landscape/04-sync-review/04-node-accepted를 직접 열어 확인했다.

| 외부 상대 경로 | SHA-256 |
|---|---|

| `2026-11-03-run01/sync/summary.json` | `286bf5e902dd0047558ff6c21a5fe9def22b278a94f41f9ef46e29e98fdd8e96` |

| `2026-11-03-run03/mobile/browser-results.json` | `2ed81bc94ae8f3ea30793f41495643a3222d7db12918df38059369778b14955b` |

| `2026-11-03-run03/mobile/tires/browser-results.json` | `59b1f487673e48cf56d479cab2119db109a8876f21854a74418c13953f3557cd` |

| `2026-11-03-run03/mobile/charge/browser-results.json` | `650dc5e5e8f74d06a6089a910256abe196ebd2f274c14821b1b71cb646e242ef` |

| `2026-11-03-run03/mobile/brake/browser-results.json` | `e4bcd2b913b05408144b34854cad761d7b6a055af29621fe8c5101427c8b5079` |

| `2026-11-03-run03/sync-mobile/mobile-summary.json` | `f7447399709995f4027c7dacd139d425d5d75869827df4de91da62fdd9882efe` |

| `2026-11-03-run03/mobile/brake/01-confirmed.png` | `a4de00c03030c7af041da2aa2772bf67a7991e198d4c866ffa8eb03c809e85be` |

| `2026-11-03-run03/mobile/brake/02-camera.png` | `ce6e423e8833140dda58f4ee85c398f41f88d67d1f6f529f53cac8ac65362ace` |

| `2026-11-03-run03/mobile/brake/03-landscape.png` | `aa3162587fcd9e48a5397754c93649ff477300812f05d988b98f7a2e14c6ceb5` |

| `2026-11-03-run03/mobile/brake/04-node-accepted.png` | `bff9756f4050347ca6d1dffa8e65045d4019b4917407ed23f35d554132f1709c` |

| `2026-11-03-run03/mobile/brake/04-sync-review.png` | `e5d2f0c656e8101e0ba25f66fdd5306a6dd1c6d3f36c58d29cd60dd0a4824b48` |
