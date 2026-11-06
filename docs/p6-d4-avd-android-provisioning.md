# P6-D4 — Pleos AVD Debug-only simulator provisioning

**Scope:** enables a Native Debug Activity to consume an **operator-approved AVD simulation
grant** and request `POST /v1/sessions`. Does not implement OEM device attestation,
real vehicle identity, real vehicle ownership or login. Does not enable the feature by default
and does not change the Render deployment.

## Native trust and state boundaries

- The code-selected simulation authority is **exactly**
  `https://carscope-lluo.onrender.com`. BOTH `SyncEndpoint.apiOrigin` and
  `SyncEndpoint.mobileRoot` must match that origin (optional trailing slash).
  It is **not** selected from an Intent, QR payload, endpoint file or grant response.
- To opt in for an approved AVD, the operator places one JSON file named
  `avd-simulator-enrollment.json` into the **Debug app-private filesDir** using
  Android's `run-as` command. The registration proof is not in the APK,
  Git history, public URL, Intent, QR or `sync-endpoint.json`.
- The app accepts ONLY the exact CLI-produced fields
  `{mode,registrationId,enrollmentProof,expiresAt}` with a 256-bit URL-safe
  enrollment proof, UUIDv4, exact simulation mode and unexpired maximum 24h window.
  Strict UTF-8/JSON parser rejects duplicates/unknowns, malformed values and
  symbolic-link file targets.
- `POST https://carscope-lluo.onrender.com/simulator/provision` sends the
  enrollment proof in the Authorization header and requests a simulator-only,
  2-minute creation bearer. Standard Android TLS CA/hostname verification is
  untouched; redirects, oversized responses, wrong content types and timeout fail closed.
- The returned grant must exactly match the fixed simulator API origin, scope,
  audience, mode and **registered UUID**, with
  `simulatorApproved=true` and `realVehicleOwnershipVerified=false`.
  An OEM-provisioned lease is NOT synthesized or downgraded:
  this is a distinct `SessionCreationCredentialProvider` used only in Debug.
- The "점검 요청 생성" button becomes available only while a locally validated
  short-lived grant exists. No network I/O in the provider getter or UI tick.
  `onStart` and manual "서비스 연결 확인" explicitly refresh. P9-I1 exception: `InspectionActivity`
  refreshes on a 3D request instead of `onStart`, and retries every 30 seconds while its panel is open. Refresh clears old
  permission BEFORE async HTTPS I/O; expired/revoked/error responses never grant local access.
- Activity `onStop` cancels in-flight requests and clears grants, receiver tokens
  and QR in memory; stale callbacks and recreation cannot reauthorize.
- Server revocation remains authoritative at `/v1/sessions` even during a cached
  unexpired two-minute lease. A pre-existing session can remain active until
  cancellation/TTL; revocation is NOT a forced existing-session cancellation.

## Verification

- `AvdSimulatorProvisioningTest` checks strict file/provision parsing,
  wrong endpoint, fields, TTL and token, single-use refresh/expiry/close.
- `AvdSimulatorActivityTest` checks Robolectric button gating, expiry,
  manual refresh, lifecycle cancellation and ignored stale callbacks.
- Debug/Release APK/AAB DEX boundary checker explicitly checks all new
  production Debug classes and excludes simulator test fixture classes.
- The existing GitHub CI compiles Debug & Release and runs all testDebug tests.
- **Real AVD and phone tests are NOT_RUN until P6-D5.** No test credential,
  fake server or TLS trust bypass is shipped.

## Operator steps — only AFTER this PR passes CI and is merged

1. Keep Render `CARSCOPE_AVD_SIMULATOR_MODE` **unset** until reviewing the
   operator enrollment setup, ingress trust boundary and DB access.
2. On the operator PC with the repo updated to this PR's merge commit and an
   ephemeral `PG_ADMIN_DATABASE_URL` (the Postgres **External** URL), run:

   ```powershell
   cd C:\dev\CarScope\tools\inspection-sync-poc
   npm install --ignore-scripts --no-audit --no-fund --package-lock=false
   New-Item -ItemType Directory -Force C:\CarScope-External | Out-Null
   node bin/avd-simulator-admin.mjs issue --label CarScope_Pleos_API34 --out C:\CarScope-External\avd-enrollment.json --hours 2
   Remove-Item Env:PG_ADMIN_DATABASE_URL
   ```

   The issued file is SECRET and must remain outside the checkout. CLI only prints
   registration metadata, not the bearer. It is short-lived and explicitly
   revocable with `revoke --id <registration UUID>`.
3. Using a Debug APK installed for AAOS user 10, transfer the file WITHOUT using
   public device storage, shell command-line tokens or logcat:

   ```powershell
   $adb = 'C:\Android\Sdk\platform-tools\adb.exe'
   $serial = 'emulator-5554'
   Get-Content -Raw -Encoding UTF8 'C:\CarScope-External\avd-enrollment.json' |
     & $adb -s $serial shell "run-as io.carscope.app --user 10 sh -c 'umask 077; cat > files/avd-simulator-enrollment.json'"
   ```

   Never `cat` the target file into the terminal, screenshots or ChatGPT.
4. Once the server/Android readiness checks pass, only then manually opt in on
   Render `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED` and redeploy. Confirm
   `/healthz` reports `STATEFUL_AVD_SIMULATION` and
   `OPERATOR_APPROVED_AVD_ONLY`, NOT real-vehicle ownership.
5. Start the Debug receiver on user 10. The grant must be issued by the real
   Render server before "점검 요청 생성" can become enabled. Show the QR, scan
   optically using a phone, explicitly submit results, view and accept on AVD,
   and check phone ACCEPTED receipt/digest. These steps are for P6-D5 and
   must be marked NOT_RUN until actually observed.
6. On completion, revoke the registration, delete the AVD app-private proof via
   `run-as` (only the exact named file), and remove the operator-PC secret file
   via an authorized operator cleanup.

## Security limitations

- `run-as` is Debug-only and an app-private file is **not** hardware attestation.
  The simulator enrollment proof is a bearer credential: copying it permits
  provisioning while it remains valid and unrevoked. Do not store it in the release
  application or share it.
- The Render internal HTTP hop is trusted only within the approved Render ingress.
  A non-Render deployment must NOT reuse client-supplied forwarded scheme headers as
  a secure-channel assertion.
- The exact production origin is intentionally pinned. Rotating to a new Render
  domain requires a reviewed code change; do not broaden trust via configuration.
