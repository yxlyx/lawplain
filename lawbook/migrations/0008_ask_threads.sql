CREATE TABLE IF NOT EXISTS ask_threads (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  messages TEXT NOT NULL,           -- JSON array of persisted conversation messages
  messageCount INTEGER NOT NULL DEFAULT 0,
  cite TEXT,                        -- optional grounding citation
  kind TEXT,                        -- judgment | statute | ...
  sourceHref TEXT,                  -- deep link to grounded source, when available
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ask_threads_user_updated
  ON ask_threads (userId, updatedAt DESC, id DESC);
