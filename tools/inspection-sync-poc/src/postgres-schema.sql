-- CarScope sync persistence schema v1. The caller must use a dedicated least-privilege database.
-- Never store plaintext invite, receiver, submit or session-creation bearer credentials.
CREATE TABLE IF NOT EXISTS cs_schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version > 0)
);
INSERT INTO cs_schema_meta (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cs_sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'id' = id)
);
CREATE TABLE IF NOT EXISTS cs_session_tokens (
  hash TEXT PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'submit', 'receiver')),
  session_id TEXT NOT NULL REFERENCES cs_sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, kind)
);
CREATE TABLE IF NOT EXISTS cs_rate_windows (
  key TEXT PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS cs_rate_expiry ON cs_rate_windows(expires_at);
