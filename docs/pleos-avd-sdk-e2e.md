# Pleos Vehicle SDK — AVD E2E (Virtual Console → SDK → 3D card)

Date: 2026-11-14. AVD `CarScope_Pleos_API34` (`emulator-5554`, user 10), Vehicle Service 2.3.22 / code 74, app SDK 2.3.2.
The installed Debug APK was used as is (not reinstalled). Raw logs, screens and JSON stay outside Git: see [evidence](#evidence).

## What is judged

Each item has three separate verdicts. They are never merged into one PASS.

| Layer | Source | Meaning |
|---|---|---|
| sdk | `CarScopeComponent` / `CarScopeDoor` log line from the app's SDK callback or getter | the real SDK path delivered the value |
| store | the Inspection WebView store fed by the Native cache channel (`component/ev-charge/visibility-status.json`) | the value crossed the Native → WebView channel |
| card | the text in the 3D page card (door: MainActivity's diagram) | the driver sees it, from `출처 차량 SDK` |

`UNVERIFIED` means the app withholds unit or meaning (SoC, odometer). A received value under `UNVERIFIED` is a received value, not a failure.
`STALE` (no new report for 5 s) keeps and shows the last value as old; the value check still applies. A `MOCK` source is never a PASS.

## Result (actual AVD, approved run)

| Item | Console change | sdk | store | card | Card shows |
|---|---|---|---|---|---|
| Odometer (summary → 차량 정보) | none: read-only | PASS (`Decimal(951700.0)`) | — (no store getter) | PASS | "주행거리 … 보고했어요", developer info `SDK 원시 Float 951700`, 출처 차량 SDK |
| EV SoC (고전압 배터리) | 100 → 80 → 100 | PASS | PASS (80, 100) | PASS | "충전량 값이 보고됐어요" (no number by design), 출처 차량 SDK |
| Charge switch (고전압 배터리) | off → on → off, new session getter | PASS | PASS | PASS | "충전 스위치가 켜짐/꺼짐으로 보고됐어요" (STALE note: getter only) |
| Charge port (EV 충전구 result) | closed → open → closed | PASS | PASS | PASS | "충전구가 열려/닫혀 있다고 보고됐어요" |
| Front wiper (전면 왼쪽 와이퍼 result) | Off → Low → Off | PASS | PASS (ON, OFF) | PASS | "와이퍼 상태: 켜짐/꺼짐" |
| High beam (왼쪽 상향등 result) | off → on → off | PASS | PASS | PASS | "켜짐/꺼짐" |
| Low beam (왼쪽 하향등 result) | headlamp Off → LowBeam → Off | PASS | PASS | PASS | "켜짐/꺼짐" |
| Door FRONT_LEFT (MainActivity, PLEOS mode) | closed → open → closed | PASS (`raw=1`, `raw=0`) | — | PASS | diagram `FRONT_LEFT: OPEN/CLOSED`, title `CarScope PLEOS`; MOCK mode selected again afterwards |

Console before/after: every tested property and the gear (`Drive`) are the same; the app is back on MainActivity in MOCK mode.
The odometer stays at 951700 km (an earlier run raised it from 951613; the console refuses decreases). This tool never writes it.

Not supported on this AVD (from the earlier diagnosis, unchanged): tire pressure (TIRE_PRESSURE absent from the HAL config, service
`ERROR_NOT_SUPPORTED_PROPERTY`), low tire pressure (capability READ with no areas), washer fluid and brake fluid (service error 60001).
These are AVD data gaps; whether a real vehicle provides them is unverified.

## Diagnostics change

`PleosComponentDataSource` (Debug) now logs a failed SDK call as
`failed <feature> status=ERROR type=a class=ai.pleos.playground.vehicle.callback.exception.a sdkError=ERROR_NOT_SUPPORTED_PROPERTY`.
Only a message shaped like an SDK error code is shown; other text is withheld with its length, and a permission failure's text is never
shown. The status contract is unchanged: the code never turns ERROR into UNSUPPORTED.

## Running it

```powershell
adb -s emulator-5554 forward tcp:8088 tcp:8088
# read-only: console GET, app log, the visible Inspection page's stores
node tools/component-probe/avd-sdk-e2e.mjs --out=C:/CarScope-External/pleos-avd-e2e/<run>
# state-changing run, only with approval: reversible properties only, each set back; Park for screens, gear set back
node tools/component-probe/avd-sdk-e2e.mjs --out=C:/CarScope-External/pleos-avd-e2e/<run> --approve-ui-navigation --approve-console-writes --park
node --test tools/component-probe/test/*.test.mjs
```

- `--approve-console-writes` changes console properties through the same PUT requests the console page sends, with its browser-session
  heartbeat on a worker thread. The odometer and usage time are never written by any flag.
- `--approve-ui-navigation` drives the Inspection page through its `window.__inspect.dispatch` hook (flow events only), taps the
  MainActivity source buttons found by uiautomator text, and uses Back. The cards themselves are rendered by the app as usual.
- The WebView is read over the debuggable app's DevTools socket via a loopback `adb forward`, removed at the end.
- Output: `results.json` (per item and phase: console value, HTTP status, log lines, store reading, card text, screenshot), `summary.txt`,
  `console-before.json`, `console-after.json`, `shots/`. Exit 0 only when nothing failed and the console ended as it started.
- Only `CarScope*` log tags are read; there is no `logcat -c`. The log ring buffer is small, so read-only log status can be empty.

## Evidence

Outside Git, `C:\CarScope-External\pleos-avd-e2e\`:

- `README.md`: the first diagnosis (SDK receipt per item, unsupported causes)
- `p0-final/`: the full approved run with this tool (`summary.txt`, `results.json`, `shots/`)
- `p0-run-readonly/`: read-only mode, console unchanged
- `p0-run-1`, `p0-run-2`, `p0-run-3-door/`: earlier runs while fixing the tool (store/card location, heartbeat, door timing)
