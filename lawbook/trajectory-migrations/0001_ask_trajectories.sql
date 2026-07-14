CREATE TABLE IF NOT EXISTS ask_trajectories (
  runId TEXT PRIMARY KEY,
  threadId TEXT,
  userId TEXT NOT NULL,
  title TEXT,
  question TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  cite TEXT,
  kind TEXT,
  sourceHref TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error', 'stopped')),
  output TEXT NOT NULL DEFAULT '',
  outputEventSeq INTEGER NOT NULL DEFAULT -1,
  error TEXT,
  costUsd REAL,
  contextTokens INTEGER,
  eventCount INTEGER NOT NULL DEFAULT 0,
  startedAt INTEGER NOT NULL,
  completedAt INTEGER,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ask_trajectories_started
  ON ask_trajectories (startedAt DESC, runId DESC);

CREATE INDEX IF NOT EXISTS idx_ask_trajectories_user_started
  ON ask_trajectories (userId, startedAt DESC, runId DESC);

CREATE TABLE IF NOT EXISTS ask_trajectory_events (
  runId TEXT NOT NULL REFERENCES ask_trajectories(runId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  PRIMARY KEY (runId, seq)
);

CREATE INDEX IF NOT EXISTS idx_ask_trajectory_events_created
  ON ask_trajectory_events (createdAt DESC, runId, seq);
