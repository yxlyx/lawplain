ALTER TABLE ask_trajectories
  ADD COLUMN feedbackReason TEXT
  CHECK (feedbackReason IS NULL OR length(feedbackReason) <= 1000);

ALTER TABLE ask_trajectories
  ADD COLUMN feedbackReasonAt INTEGER;
