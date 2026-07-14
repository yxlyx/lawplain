ALTER TABLE ask_trajectories
  ADD COLUMN rating TEXT CHECK (rating IN ('helpful', 'not_helpful'));

ALTER TABLE ask_trajectories
  ADD COLUMN ratedAt INTEGER;

CREATE INDEX IF NOT EXISTS idx_ask_trajectories_rating_started
  ON ask_trajectories (rating, startedAt DESC)
  WHERE rating IS NOT NULL;
