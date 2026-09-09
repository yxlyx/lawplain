-- MCP is opt-in per key and requires an approved account. Existing REST keys
-- retain their existing behavior; they do not silently gain MCP permissions.
ALTER TABLE api_keys ADD COLUMN mcpEnabled INTEGER NOT NULL DEFAULT 0 CHECK (mcpEnabled IN (0, 1));

CREATE TABLE mcp_access (
  userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
  canSearch INTEGER NOT NULL DEFAULT 1 CHECK (canSearch IN (0, 1)),
  canRead INTEGER NOT NULL DEFAULT 1 CHECK (canRead IN (0, 1)),
  requestsPerMinute INTEGER NOT NULL DEFAULT 60 CHECK (requestsPerMinute BETWEEN 1 AND 600),
  requestedAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  updatedBy TEXT
);

CREATE TABLE mcp_settings (
  id TEXT PRIMARY KEY CHECK (id = 'global'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
INSERT INTO mcp_settings (id, enabled) VALUES ('global', 1);

CREATE TABLE mcp_rate_windows (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  windowStart INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY (userId, windowStart)
);
CREATE INDEX idx_mcp_rate_time ON mcp_rate_windows (windowStart);

-- Metadata only: no prompts, search terms, document contents, tokens or IPs.
CREATE TABLE mcp_activity (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  keyId TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL,
  durationMs INTEGER NOT NULL DEFAULT 0,
  responseBytes INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_mcp_activity_user ON mcp_activity (userId, createdAt DESC);
CREATE INDEX idx_mcp_activity_time ON mcp_activity (createdAt DESC);

CREATE TABLE mcp_admin_audit (
  id TEXT PRIMARY KEY,
  actorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  targetUserId TEXT,
  action TEXT NOT NULL,
  settingsJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_mcp_admin_audit_time ON mcp_admin_audit (createdAt DESC);
