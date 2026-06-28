-- Track in-flight Ask runs so a thread is visible (and resumable) across tabs
-- while it is still researching — not only after it completes. status is
-- 'running' during a live DO run, 'done' once settled; NULL on legacy rows
-- (treated as done). runId binds the thread to its Durable Object run so any of
-- the owner's tabs can reconnect to the live stream.
ALTER TABLE ask_threads ADD COLUMN runId TEXT;
ALTER TABLE ask_threads ADD COLUMN status TEXT;
