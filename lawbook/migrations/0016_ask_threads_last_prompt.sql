ALTER TABLE ask_threads ADD COLUMN lastPromptAt INTEGER NOT NULL DEFAULT 0;

-- Legacy messages did not timestamp user prompts. Creation time is the only
-- click-independent ordering signal available for those existing threads.
UPDATE ask_threads
SET lastPromptAt = createdAt
WHERE lastPromptAt = 0;

CREATE INDEX IF NOT EXISTS idx_ask_threads_user_last_prompt
  ON ask_threads (userId, lastPromptAt DESC, createdAt DESC, id DESC);
