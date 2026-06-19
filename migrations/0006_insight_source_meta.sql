ALTER TABLE insights ADD COLUMN sender TEXT DEFAULT '';
ALTER TABLE insights ADD COLUMN input_chars INTEGER DEFAULT 0;
ALTER TABLE insights ADD COLUMN read_chars INTEGER DEFAULT 0;
UPDATE insights
SET sender = (
  SELECT sender FROM messages
  WHERE messages.chat_id = insights.chat_id
    AND messages.message_id = insights.source_ref
  LIMIT 1
)
WHERE sender = '' AND source_type = 'message';
