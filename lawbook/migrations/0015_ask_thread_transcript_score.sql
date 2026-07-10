ALTER TABLE ask_threads ADD COLUMN transcriptScore INTEGER NOT NULL DEFAULT 0;

UPDATE ask_threads
SET transcriptScore = LENGTH(messages) + (messageCount * 1000)
WHERE transcriptScore = 0;
