-- Personal API keys: let a signed-in user mint keys so their own agents/scripts
-- can call the Lawplain API (proxied to the sgjudge corpus). Only the SHA-256
-- hash of the raw key is stored; the plaintext is shown once at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  keyHash TEXT NOT NULL,           -- SHA-256 hex of the raw key
  prefix TEXT NOT NULL,            -- leading chars of the raw key, for display
  createdAt INTEGER NOT NULL,
  lastUsedAt INTEGER,
  revokedAt INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (keyHash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (userId, createdAt DESC);
