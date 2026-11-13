# carscope-account (P15)

Google sign-in through Supabase Auth and a per-user "내 차량" list, as three small browser pages, a local static server,
one SQL migration and a server-side JWT verifier. Trial mode (3D, QR, AVD) does not use this package.

- Design, security review and operator steps: [docs/p15-supabase-auth-vehicles.md](../../docs/p15-supabase-auth-vehicles.md)
- Evidence: [docs/evidence/p15-auth/README.md](../../docs/evidence/p15-auth/README.md)

```powershell
npm ci --ignore-scripts
npm run check; npm test                    # MOCK / unit, no network
npm run serve                              # http://127.0.0.1:8097/account/ (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY optional)
npm run test:rls                           # needs a LOCAL `supabase start` stack (CARSCOPE_LOCAL_SUPABASE_*)
npm run test:browser                       # same, plus CARSCOPE_EVIDENCE_DIR under C:\CarScope-External\
```

`supabase/config.toml` is for a local stack only. Never `supabase link` / `db push` it to the hosted project.
