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

CREATE TABLE IF NOT EXISTS saved_result_set (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) > 0),
  tab TEXT NOT NULL CHECK (tab IN ('judgments', 'statutes', 'hansard', 'bills', 'subsidiary', 'practice')),
  query TEXT NOT NULL CHECK (length(query) > 0),
  filters TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters)),
  resultCount INTEGER NOT NULL DEFAULT 0 CHECK (resultCount >= 0),
  results TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(results)),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_result_set_user_updated
  ON saved_result_set (userId, updatedAt DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_saved_result_set_user_created
  ON saved_result_set (userId, createdAt DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_saved_result_set_user_tab_updated
  ON saved_result_set (userId, tab, updatedAt DESC, id DESC);
