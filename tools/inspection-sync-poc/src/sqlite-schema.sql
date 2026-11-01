-- Local single-host database only. Schema version 1; no raw bearer tokens.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id)
) STRICT;
CREATE TABLE IF NOT EXISTS session_tokens (
  hash TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('invite', 'submit', 'receiver')),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, kind)
) STRICT;
CREATE TABLE IF NOT EXISTS rate_windows (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK(count > 0),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_windows(expires_at);
PRAGMA user_version = 1;
