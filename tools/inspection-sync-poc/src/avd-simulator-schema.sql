-- P6-D3: operator-approved AVD simulation ONLY, never a real-vehicle ownership registry.
-- The operator uses a local DB-admin CLI. No public registration/admin mutation endpoint.
CREATE TABLE IF NOT EXISTS cs_avd_auth_meta (
  id INTEGER PRIMARY KEY CHECK (id=1),
  version INTEGER NOT NULL CHECK (version=1)
);
INSERT INTO cs_avd_auth_meta(id,version) VALUES (1,1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cs_avd_registrations (
  id UUID PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  enrollment_hash TEXT UNIQUE NOT NULL CHECK (enrollment_hash ~ '^[a-f0-9]{64}$'),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL CHECK(expires_at > created_at),
  revoked_at BIGINT
);
CREATE TABLE IF NOT EXISTS cs_avd_creation_grants (
  id UUID PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES cs_avd_registrations(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL CHECK(expires_at > issued_at),
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS cs_avd_grants_expiry ON cs_avd_creation_grants(expires_at);
CREATE INDEX IF NOT EXISTS cs_avd_grants_registration ON cs_avd_creation_grants(registration_id);
