# CarScope P6-D3: operator-approved Pleos AVD simulator credential lifecycle

**Scope:** A manually approved AVD *simulator* only. This is not Hyundai/Pleos OEM vehicle identity,
VIN ownership, hardware attestation, user login, or production vehicle authorization.
Do not treat operator approval as `ownershipVerified=true`. The existing
`VerifiedSessionCreationAuthorizer` remains the path for any future real-vehicle provider.

## Current deployed system

The live Render service currently runs `render-stateful.mjs` with
`CARSCOPE_AVD_SIMULATOR_MODE` absent. It continues to return
`{"status":"UP","mode":"STATEFUL_DENY_DEFAULT","sessionCreation":"DENIED"}`.
**Do not change Render settings or deploy this PR before code review and GitHub CI pass.**

## Design

- No public enrollment/admin registration endpoint and no static shared test credential.
- A trusted operator uses `bin/avd-simulator-admin.mjs` from a local machine, with a dedicated
  PostgreSQL connection in `PG_ADMIN_DATABASE_URL` (never send this URL in chat or commit it).
- `issue --label ... --out ... --hours ...` writes a randomly generated 256-bit enrollment proof
  exactly once to a new file **outside** the repository. The command does not print secrets or tokens.
  Existing target file fails instead of being overwritten. Default expiry: 2 hours, maximum 24 hours.
- DB stores SHA-256 proof hash, registration UUID, operator label and expiry. Neither the raw
  enrollment proof nor short-lived creation bearer is stored.
- In the separate, explicit Render mode `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED`, the
  authenticated HTTPS `POST /simulator/provision` route accepts only
  `Authorization: Bearer <256-bit enrollment proof>` and exactly
  `{"apiOrigin":"https://your-onrender-host","audience":"carscope-avd-simulator"}`.
  The server checks active operator registration and issues an independently random 256-bit
  session-creation bearer for **120 seconds**. HTTP status 200 returns:
  `mode=OPERATOR_APPROVED_AVD_SIMULATION`, `scope=inspection:session:create`,
  `simulatorApproved=true`, `realVehicleOwnershipVerified=false`, `apiOrigin`,
  `audience`, `credential`, `credentialId`, `issuedAt`, `notBefore`,
  `expiresAt`, and `registrationId`. This is **not** the existing OEM-oriented
  `/creation/provision` or `ownershipVerified=true` payload.
- Authenticated `POST /v1/sessions` checks that the short-lived bearer hash still exists,
  is unexpired and has a non-revoked registration **both before and after** request body read.
  Existing QR `invite`/`submit`/`receiver` roles remain isolated.
- The already established API health is unchanged with the mode unset. With explicit AVD
  simulation opt-in, health reports `mode=STATEFUL_AVD_SIMULATION` and
  `sessionCreation=OPERATOR_APPROVED_AVD_ONLY`. This is **never** a real-car ownership claim.
- `revoke --id <registration UUID>` is admin-only: blocks further provisioning and creation,
  marks existing grants revoked in one DB transaction. Sessions previously created continue
  to follow their own cancel/expiry policy; revocation does NOT recall an invite already scanned.
- Missing database, invalid proof, unknown registration, revoked/expired grant and disabled
  mode are fail-closed. TLS bypass and fixture credential switches remain forbidden.
- HTTPS public-to-Render-edge is provided by Render; back-end HTTP uses a reviewed explicit
  trusted edge adapter and checks canonical Host/Origin/Forwarded-Proto **before** API handling.
  Do not deploy this on an open untrusted HTTP listener or infer TLS from client-supplied
  forwarding headers. The proxy trust boundary must be reviewed for any non-simulator service.

## Implementation and verification

- `src/avd-simulator-schema.sql`: additive, independently versioned PostgreSQL registration
  and credential-grant tables. No `cs_schema_meta` migration is needed.
- `src/avd-simulator-credentials.mjs`: operator registration, provision, current grant verification,
  expiry, revocation, grant pruning. No plaintext proofs/grants in DB.
- `src/avd-simulator-http.mjs`: bounded authenticated simulator provisioning. Not a generic issuer.
- `src/render-stateful.mjs`: explicit optional simulator mode; otherwise the exact previous deny-default behavior.
- `src/server.mjs`: optional trust adapter for Render TLS termination; direct TLS default unchanged.
- `test/avd-simulator.test.mjs`: real PostgreSQL 16 + HTTP: no opt-in deny,
  issuance / no ownership claim, short-lived validity, expired proof, unauthorized requests,
  simulator-only session creation, TLS forwarding rejection, revocation and existing-session semantics.
- GitHub Actions: use a disposable local Postgres container; never test against Render DB.
  `PG_TEST_URL` missing locally means **SKIP/NOT_RUN**, never PASS.

## How the operator will provision an AVD (NOT yet executed)

1. After this PR passes review, keep the existing Render mode disabled while reviewing the proxy
   trust and operator provisioning details. Never enable an authorization path by accident.
2. From the operator PC with trusted PostgreSQL administrative access, set
   `PG_ADMIN_DATABASE_URL` privately to the Render PostgreSQL **External Database URL**
   (only for the operator CLI; the deployed Web Service continues using its Internal URL).
   Do not place it in terminal history, GitHub, chat or screenshots. Use a dedicated
   least-privilege role when available.
3. Create an external directory and run:
   ```powershell
   cd C:\dev\CarScope\tools\inspection-sync-poc
   npm install --ignore-scripts --no-audit --no-fund --package-lock=false
   node bin/avd-simulator-admin.mjs issue --label CarScope_Pleos_API34 --out C:\CarScope-External\avd-enrollment.json --hours 2
   ```
   The issued secret file contains a simulator enrollment proof. Protect it, do not paste or upload it.
4. A separate P6-D4 Android Debug-only integration must consume the proof through an app-private,
   reviewed path and call the **simulator** provisioning response decoder. The current
   `SyncReceiverActivity.newProvisioningSource` is still null, so merely setting a URL does
   not enable the QR Create button. No secret may be embedded in APK, Intent, QR or endpoint file.
5. **Only after** operator enrollment and approved Android integration, manually add
   `CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED` as a Render environment variable, redeploy,
   and observe the simulator-only health value.
6. A revoked registration can be disabled locally via:
   ```powershell
   node bin/avd-simulator-admin.mjs revoke --id <registration UUID>
   ```
   This call uses private `PG_ADMIN_DATABASE_URL`. Never expose an admin endpoint to the public.
7. After verification, remove `PG_ADMIN_DATABASE_URL` from the local session:
   `Remove-Item Env:PG_ADMIN_DATABASE_URL` and securely remove the temporary enrollment file
   when no longer needed.

## Pending after P6-D3

**NOT_RUN:** real Render registration/provision, Android Debug enrollment, QR session creation,
phone optical scanning, RESULT_SUBMITTED, Native Accept, phone ACCEPTED. These require P6-D4/D5.
No OEM hardware attestation / vehicle registration API has been established.
Time-bounded enrollment proofs are bearer secrets; leakage permits impersonating the
approved simulator until expiry/revocation. Debug app-private storage is not an assurance
of hardware-backed identity. Multi-tenant user/vehicle access is not implemented.
