# P5-B2A — Native mobile tire schema v2 integration

Base: `origin/main` `227571de6143cb12ad1dffa754f7b4b2c1570748` (PR #51 and #52 merged).
Independent branch: `feat/p5-b2a-native-tire-sync`. PR #53 and its worktree are untouched.

## Boundary and implementation

The Debug receiver supports `washer-fluid` schema 1 and the four exact tire tasks in
[tire-mobile-result-v2](contracts/tire-mobile-result-v2.md). The enclosing inspection-sync protocol remains 1;
pairing URLs remain QR v2. No mobile, server or Three.js source is changed.

- `SyncInspection` is a sealed union. Existing `CompletedInspection` preserves washer fields/canonical bytes;
  `CompletedTireInspection` contains immutable damage/debris/wear responses, aids and the derived tire status.
- The streaming decoder rejects unknown/duplicate/missing fields, coercions, null responses, wrong versions,
  unsupported tasks, invalid enums, noncanonical/impossible UTC timestamps, reversed times, inconsistent
  derived status and mismatched digests. It also requires view task = result task.
- Selected task = create request = create response = QR = subsequent view/result task. Changing tasks requires
  a new session. Cancel's minimal response inherits the task from the created session, never from an untrusted default.
- The client preserves digest immutability and state progression. Accept requires a previously received result's
  digest. Polling never accepts. The controller blocks overlapping writes and retains the displayed report when
  an accepted proof omits its already received result body.
- The Native screen has a task selector (locked during a session), per-tire labels, all three independent answers,
  status, completion time and `SELF · USER_REPORTED`. No SDK pressure, units or safety judgment is introduced.
  Receipt of a result and user acceptance remain separate states. Stop discards credentials and late callbacks.
- The existing `InspectionSyncEntry` label and its assertion are minimally updated to mention tires, so the new
  choice is discoverable without changing InspectionActivity or its WebView. This additional shared entry change
  is confined to the Debug sync package and does not overlap PR #53.

`DenyByDefaultCredentialProvider`, provisioning, authentication and TLS trust/hostname checking remain unchanged.
No test credentials enter Debug APK or Release. No new service, trust installation or external deployment is made.
Release remains outside this feature's policy and source sets.

## Reproducible validation

Node 22.16+ is required alongside the repository's JDK 17 / Android toolchain.

```powershell
# Focused Native regression; use the existing local JDK/SDK/cache configuration.
./gradlew.bat :app:testDebugUnitTest --tests 'io.carscope.app.sync.TireSyncReceiverTest' --tests 'io.carscope.app.sync.SyncReceiverTest' --tests 'io.carscope.app.sync.SyncHttpDecoderTest' --tests 'io.carscope.app.sync.HttpsSyncReceiverTransportTest' --tests 'io.carscope.app.sync.SyncReceiverActivityTest' --tests 'io.carscope.app.sync.ProvisionedSessionCredentialProviderTest' --console=plain --max-workers=1 '-Pkotlin.compiler.execution.strategy=in-process'

# Standalone vector generation; synthetic records only.
node tools/native-tire-sync/vectors.mjs
```

`TireSyncReceiverTest` invokes the Node vector generator and consumes its actual JS wire records, recursively
sorted canonical JSON and SHA-256 digests. It checks 109 vectors: washer v1 plus 27 answer combinations for
each of four tire tasks. The script imports the shipped JS validator and protocol functions read-only.
This is a cross-language contract test, not smartphone/optical QR or real server/device evidence.

The existing Android CI (`Identity probe CI`) already installs Node and packages the Debug web assets before
running **all** JVM/Robolectric tests, Debug/Release APK and Release bundle builds, lint and the unchanged sync
DEX/manifest boundary checker. No CI test filters or thresholds are relaxed for this work.

## Evidence and limits

See [evidence index](evidence/p5-b2a/README.md) for fresh outcomes and failure history.
AVD, adb, real phones, optical scanning, real vehicle identity and external network/TLS: **NOT_RUN**.
Real integration still requires valid provisioned session-creation credentials and a reachable service with a
trusted CA chain and matching hostname. Without these, production creation remains **BLOCKED by design**.
Charge-port mobile result reception is unsupported in this branch and intentionally deferred.
