CREATE TABLE IF NOT EXISTS ask_question_history (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  question TEXT NOT NULL,
  cite TEXT,
  kind TEXT,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ask_question_history_user_created
  ON ask_question_history(userId, createdAt DESC, id DESC);
