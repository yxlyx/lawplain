CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  tab TEXT NOT NULL CHECK (tab IN ('judgments', 'statutes', 'hansard', 'bills', 'subsidiary', 'practice')),
  query TEXT NOT NULL CHECK (length(query) > 0),
  filters TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters)),
  resultCount INTEGER NOT NULL DEFAULT 0 CHECK (resultCount >= 0),
  topResults TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topResults)),
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_created
  ON search_history (userId, createdAt DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_search_history_user_tab_created
  ON search_history (userId, tab, createdAt DESC, id DESC);
