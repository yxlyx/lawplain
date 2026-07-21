-- Support the atomic per-user active-key cap without scanning revoked keys.
CREATE INDEX IF NOT EXISTS idx_api_keys_active_user
  ON api_keys (userId)
  WHERE revokedAt IS NULL;
